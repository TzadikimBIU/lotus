import { Notice, type App, type TFile } from "obsidian";
import { closeSync, existsSync, openSync } from "fs";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { basename, join, normalize as normalizeFsPath, posix as posixPath } from "path";
import { spawn } from "child_process";
import { runProcess } from "./processRunner";
import { splitCommandLine } from "../utils/command";
import { findEnabledCommandLanguage } from "../languagePackages";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult } from "../types";

type loomContainerRuntime = "docker" | "podman" | "qemu" | "wsl" | "custom";
type loomContainerElevationMode = "default" | "root";

interface loomContainerLanguageConfig {
  command?: string;
  extension?: string;
  useDefault?: boolean;
}

interface loomCommandExpectation {
  command: string;
  positiveResponse?: string;
  negativeResponse?: string;
}

interface loomQemuConfig {
  sshTarget: string;
  remoteWorkspace: string;
  sshExecutable?: string;
  sshArgs?: string;
  startCommand?: string;
  buildCommand?: string;
  teardownCommand?: string;
  healthCheck?: loomCommandExpectation;
  manager?: loomQemuManagerConfig;
}

interface loomQemuManagerConfig {
  enabled: boolean;
  executable?: string;
  args?: string;
  image?: string;
  imageFormat?: string;
  pidFile?: string;
  logFile?: string;
  readinessTimeoutMs?: number;
  readinessIntervalMs?: number;
  bootDelayMs?: number;
  shutdownCommand?: string;
  shutdownTimeoutMs?: number;
  killSignal?: NodeJS.Signals;
  persist?: boolean;
}

interface loomCustomRuntimeConfig {
  executable: string;
  args?: string;
  build?: string;
  commandStructure?: string;
  teardown?: string;
  healthCheck?: loomCommandExpectation;
}

interface loomWslConfig {
  interactive?: boolean;
}

interface loomContainerElevationConfig {
  mode: loomContainerElevationMode;
  commandPrefix?: string;
}

interface loomContainerConfig {
  runtime: loomContainerRuntime;
  executable?: string;
  image?: string;
  elevation: loomContainerElevationConfig;
  wsl?: loomWslConfig;
  healthCheck?: loomCommandExpectation;
  qemu?: loomQemuConfig;
  custom?: loomCustomRuntimeConfig;
  languages: Record<string, loomContainerLanguageConfig>;
}

interface loomCustomRuntimeRequest {
  action: "build" | "run" | "teardown";
  groupName: string;
  groupPath: string;
  runtime: loomContainerRuntime;
  image?: string;
  build?: string;
  commandStructure?: string;
  teardown?: string;
  language?: string;
  languageAlias?: string;
  fileName?: string;
  filePath?: string;
  command?: string;
  stdin?: string;
  timeoutMs: number;
  config: {
    executable?: string;
    custom?: loomCustomRuntimeConfig;
    qemu?: loomQemuConfig;
    healthCheck?: loomCommandExpectation;
    elevation?: loomContainerElevationConfig;
  };
}

export class loomContainerRunner {
  private readonly builtImages = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
  ) { }

  getContainerGroupName(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  async getGroupSummaries(): Promise<Array<{ name: string; status: string }>> {
    const containersPath = this.getContainersPath();
    if (!existsSync(containersPath)) {
      return [];
    }

    const entries = await readdir(containersPath, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const groupPath = join(containersPath, entry.name);
          const hasConfig = existsSync(join(groupPath, "config.json"));
          const hasDockerfile = existsSync(join(groupPath, "Dockerfile"));
          if (!hasConfig) {
            return {
              name: entry.name,
              status: "missing config.json",
            };
          }
          try {
            const config = await this.readConfig(groupPath);
            const pieces = [`runtime: ${config.runtime}`];
            if ((config.runtime === "docker" || config.runtime === "podman") && hasDockerfile) {
              pieces.push("Dockerfile");
            }
            if (config.runtime === "qemu" && config.qemu?.sshTarget) {
              pieces.push(`ssh: ${config.qemu.sshTarget}`);
            }
            if (config.runtime === "qemu" && config.qemu?.manager?.enabled) {
              pieces.push(`manager: ${await this.getManagedQemuStatus(groupPath, config.qemu.manager)}`);
            }
            if (config.runtime === "custom" && config.custom?.executable) {
              pieces.push(`wrapper: ${config.custom.executable}`);
            }
            if (config.elevation.mode === "root") {
              pieces.push(config.elevation.commandPrefix ? `elevation: root via ${config.elevation.commandPrefix}` : "elevation: root");
            }
            const languageCount = Object.keys(config.languages).length;
            pieces.push(`${languageCount} language${languageCount === 1 ? "" : "s"}`);
            return {
              name: entry.name,
              status: pieces.join(", "),
            };
          } catch (error) {
            return {
              name: entry.name,
              status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }),
    );
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings, groupName: string): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];

    let isFallback = false;
    let language: loomContainerLanguageConfig | null = null;

    if (configLang) {
      if (configLang.useDefault) {
        language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      } else {
        language = configLang;
      }
    } else {
      language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      isFallback = true;
    }

    if (!language || !language.command || !language.extension) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }

    await mkdir(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = join(groupPath, tempFileName);

    try {
      await writeFile(tempFilePath, block.content, "utf8");
      let result: loomRunResult;
      switch (config.runtime) {
        case "docker":
        case "podman":
          result = await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
          break;
        case "qemu":
          result = await this.runQemu(groupName, groupPath, config, language, tempFileName, context);
          break;
        case "custom":
          result = await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
          break;
        case "wsl":
          result = await this.runWslContainer(groupName, groupPath, config, language, tempFileName, context);
          break;
        default:
          throw new Error(`Unsupported runtime: ${config.runtime}`);
      }

      if (isFallback) {
        const fallbackMsg = `[Loom] Language '${block.language}' was not declared in container group. Running using default command: ${language.command}`;
        result.warning = result.warning ? `${result.warning}\n${fallbackMsg}` : fallbackMsg;
      }
      if (config.elevation.mode === "root") {
        const elevationMsg = `[Loom] Container elevation: root${config.elevation.commandPrefix ? ` via ${config.elevation.commandPrefix}` : ""}.`;
        result.warning = result.warning ? `${result.warning}\n${elevationMsg}` : elevationMsg;
      }
      return result;
    } finally {
      await rm(tempFilePath, { force: true });
    }
  }

  async buildGroup(groupName: string, timeoutMs: number, signal: AbortSignal): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await mkdir(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    switch (config.runtime) {
      case "docker":
      case "podman":
        return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
      case "qemu":
        return this.buildQemu(groupName, groupPath, config, timeoutMs, signal);
      case "custom":
        return this.runCustomWrapper(groupName, groupPath, config, this.createCustomRequest("build", groupName, groupPath, config, timeoutMs), timeoutMs, signal);
      case "wsl":
        return this.createSyntheticResult(
          `container:${groupName}:wsl:build`,
          `WSL ${groupName} build`,
          `WSL environment ${config.image || "(default)"} does not require a build step.\n`,
        );
    }
  }

  private async runOciContainer(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    context: loomRunContext,
    settings: loomPluginSettings,
  ): Promise<loomRunResult> {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const command = splitCommandLine(language.command!.replaceAll("{file}", tempFileName));
    if (!command.length) {
      throw new Error("Container command is empty.");
    }

    return await runProcess({
      runnerId: `container:${groupName}`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName}`,
      executable: this.runtimeExecutable(config),
      args: [
        "run",
        "--rm",
        ...(context.stdin != null ? ["-i"] : []),
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        ...this.ociElevationArgs(config),
        image,
        ...command,
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
    });
  }

  private async runQemu(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    context: loomRunContext,
  ): Promise<loomRunResult> {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);

    try {
      const remoteFile = posixPath.join(qemu.remoteWorkspace, tempFileName);
      const remoteCommand = this.applyCommandPrefix(config, language.command!.replaceAll("{file}", shellQuote(remoteFile)));
      if (!remoteCommand.trim()) {
        throw new Error("QEMU command is empty.");
      }

      return await runProcess({
        runnerId: `container:${groupName}:qemu`,
        runnerName: `QEMU ${groupName}`,
        executable: qemu.sshExecutable || "ssh",
        args: [
          ...splitCommandLine(qemu.sshArgs || ""),
          qemu.sshTarget,
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`,
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin,
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    }
  }

  private async runCustom(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    block: loomCodeBlock,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: loomRunContext,
  ): Promise<loomRunResult> {
    const command = this.applyCommandPrefix(config, language.command!.replaceAll("{file}", tempFileName));
    const result = await this.runCustomWrapper(
      groupName,
      groupPath,
      config,
      this.createCustomRequest("run", groupName, groupPath, config, context.timeoutMs, {
        language: block.language,
        languageAlias: block.languageAlias,
        fileName: tempFileName,
        filePath: tempFilePath,
        command,
        stdin: context.stdin,
      }),
      context.timeoutMs,
      context.signal,
    );

    if (config.custom?.teardown) {
      const teardown = await this.runCustomWrapper(
        groupName,
        groupPath,
        config,
        this.createCustomRequest("teardown", groupName, groupPath, config, context.timeoutMs, {
          language: block.language,
          languageAlias: block.languageAlias,
          fileName: tempFileName,
          filePath: tempFilePath,
          command,
          stdin: context.stdin,
        }),
        context.timeoutMs,
        context.signal,
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }

    return result;
  }

  private async runWslContainer(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    context: loomRunContext,
  ): Promise<loomRunResult> {
    const wslGroupPath = this.translateToWslPath(groupPath);
    const command = this.applyCommandPrefix(config, language.command!.replaceAll("{file}", tempFileName));
    if (!command.trim()) {
      throw new Error("WSL command is empty.");
    }

    const shellFlags = config.wsl?.interactive ? ["-i", "-l", "-c"] : ["-l", "-c"];
    const wslArgs = ["bash", ...shellFlags, `cd "${wslGroupPath.replaceAll('"', '\\"')}" && ${command}`];
    if (config.image?.trim()) {
      wslArgs.unshift("-d", config.image.trim());
    }

    return await runProcess({
      runnerId: `container:${groupName}:wsl`,
      runnerName: `WSL ${groupName}`,
      executable: "wsl",
      args: wslArgs,
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
    });
  }

  private translateToWslPath(windowsPath: string): string {
    const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, "/");
      return `/mnt/${drive}/${rest}`;
    }
    if (windowsPath.includes("\\")) {
      return windowsPath.replace(/\\/g, "/");
    }
    return windowsPath;
  }

  private async resolveImage(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    context: loomRunContext,
    settings: loomPluginSettings,
  ): Promise<string> {
    const dockerfile = join(groupPath, "Dockerfile");
    if (!existsSync(dockerfile)) {
      return config.image || "ubuntu:latest";
    }

    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }

    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 120_000), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }

    this.builtImages.add(cacheKey);
    return image;
  }

  private async buildImage(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<loomRunResult> {
    const image = this.imageNameForGroup(groupName);
    if (!existsSync(join(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.\n`,
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal,
    });
  }

  private async buildQemu(groupName: string, groupPath: string, config: loomContainerConfig, timeoutMs: number, signal: AbortSignal): Promise<loomRunResult> {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }

  private async readConfig(groupPath: string): Promise<loomContainerConfig> {
    const configPath = join(groupPath, "config.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }

    const data = raw as {
      runtime?: unknown;
      executable?: unknown;
      image?: unknown;
      wsl?: unknown;
      healthCheck?: unknown;
      qemu?: unknown;
      custom?: unknown;
      elevation?: unknown;
      languages?: unknown;
    };
    const runtime = this.readRuntime(data.runtime);
    if (data.executable != null && typeof data.executable !== "string") {
      throw new Error("Container config executable must be a string.");
    }
    if (data.image != null && typeof data.image !== "string") {
      throw new Error("Container config image must be a string.");
    }
    if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) {
      throw new Error("Container config languages must be an object.");
    }

    const languages: Record<string, loomContainerLanguageConfig> = {};
    for (const [language, value] of Object.entries(data.languages as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value as { command?: unknown; extension?: unknown; useDefault?: unknown };
      const useDefault = languageConfig.useDefault === true;

      if (!useDefault && (typeof languageConfig.command !== "string" || !languageConfig.command.trim())) {
        throw new Error(`Container language ${language} must define command or useDefault.`);
      }

      languages[language] = {
        command: typeof languageConfig.command === "string" ? languageConfig.command : undefined,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : useDefault ? undefined : `.${language}`,
        useDefault: useDefault || undefined,
      };
    }

    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : undefined,
      image: typeof data.image === "string" ? data.image : undefined,
      elevation: this.readElevationConfig(data.elevation),
      wsl: this.readWslConfig(data.wsl),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages,
    };
  }

  private readRuntime(value: unknown): loomContainerRuntime {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, custom, or wsl.");
  }

  private readWslConfig(value: unknown): loomWslConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config wsl must be an object.");
    }
    const data = value as { interactive?: unknown };
    return {
      interactive: data.interactive === true,
    };
  }

  private readElevationConfig(value: unknown): loomContainerElevationConfig {
    if (value == null) {
      return { mode: "default" };
    }
    if (typeof value === "string") {
      if (value === "default" || value === "root") {
        return { mode: value };
      }
      throw new Error("Container config elevation must be default, root, or an object.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config elevation must be an object.");
    }
    const data = value as Record<string, unknown>;
    const mode = data.mode == null ? "default" : data.mode;
    if (mode !== "default" && mode !== "root") {
      throw new Error("Container config elevation.mode must be default or root.");
    }
    return {
      mode,
      commandPrefix: optionalString(data.commandPrefix),
    };
  }

  private readQemuConfig(value: unknown): loomQemuConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value as Record<string, unknown>;
    if (typeof data.sshTarget !== "string" || !data.sshTarget.trim()) {
      throw new Error("Container config qemu.sshTarget must be a string.");
    }
    if (typeof data.remoteWorkspace !== "string" || !data.remoteWorkspace.trim()) {
      throw new Error("Container config qemu.remoteWorkspace must be a string.");
    }

    return {
      sshTarget: data.sshTarget.trim(),
      remoteWorkspace: data.remoteWorkspace.trim(),
      sshExecutable: optionalString(data.sshExecutable),
      sshArgs: optionalString(data.sshArgs),
      startCommand: optionalString(data.startCommand),
      buildCommand: optionalString(data.buildCommand),
      teardownCommand: optionalString(data.teardownCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck"),
      manager: this.readQemuManagerConfig(data.manager),
    };
  }

  private readQemuManagerConfig(value: unknown): loomQemuManagerConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu.manager must be an object.");
    }
    const data = value as Record<string, unknown>;
    return {
      enabled: data.enabled !== false,
      executable: optionalString(data.executable),
      args: optionalString(data.args),
      image: optionalString(data.image),
      imageFormat: optionalString(data.imageFormat),
      pidFile: optionalString(data.pidFile),
      logFile: optionalString(data.logFile),
      readinessTimeoutMs: optionalPositiveInteger(data.readinessTimeoutMs, "Container config qemu.manager.readinessTimeoutMs"),
      readinessIntervalMs: optionalPositiveInteger(data.readinessIntervalMs, "Container config qemu.manager.readinessIntervalMs"),
      bootDelayMs: optionalNonNegativeInteger(data.bootDelayMs, "Container config qemu.manager.bootDelayMs"),
      shutdownCommand: optionalString(data.shutdownCommand),
      shutdownTimeoutMs: optionalPositiveInteger(data.shutdownTimeoutMs, "Container config qemu.manager.shutdownTimeoutMs"),
      killSignal: optionalSignal(data.killSignal, "Container config qemu.manager.killSignal"),
      persist: typeof data.persist === "boolean" ? data.persist : undefined,
    };
  }

  private readCustomConfig(value: unknown): loomCustomRuntimeConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value as Record<string, unknown>;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck"),
    };
  }

  private readHealthCheck(value: unknown, label: string): loomCommandExpectation | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value as Record<string, unknown>;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"]),
    };
  }

  private requireQemuConfig(config: loomContainerConfig): loomQemuConfig {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }

  private requireCustomConfig(config: loomContainerConfig): loomCustomRuntimeConfig {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }

  private runtimeExecutable(config: loomContainerConfig): string {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }

  private ociElevationArgs(config: loomContainerConfig): string[] {
    return config.elevation.mode === "root" ? ["--user", "root"] : [];
  }

  private applyCommandPrefix(config: loomContainerConfig, command: string): string {
    const prefix = config.elevation.mode === "root" ? config.elevation.commandPrefix?.trim() : "";
    return prefix ? `${prefix} ${command}` : command;
  }

  private async runHealthCheck(
    healthCheck: loomCommandExpectation | undefined,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<void> {
    if (!healthCheck) {
      return;
    }

    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    if (healthCheck.negativeResponse && combinedOutput.includes(healthCheck.negativeResponse)) {
      throw new Error(`${runnerName} returned negative response: ${healthCheck.negativeResponse}`);
    }
    if (healthCheck.positiveResponse && !combinedOutput.includes(healthCheck.positiveResponse)) {
      throw new Error(`${runnerName} did not return positive response: ${healthCheck.positiveResponse}`);
    }
  }

  private async runOptionalCommand(
    command: string | undefined,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<void> {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }

  private async runCommandLine(
    command: string,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<loomRunResult> {
    const parts = splitCommandLine(command);
    if (!parts.length) {
      throw new Error(`${runnerName} command is empty.`);
    }
    return runProcess({
      runnerId,
      runnerName,
      executable: parts[0],
      args: parts.slice(1),
      workingDirectory,
      timeoutMs,
      signal,
    });
  }

  private async ensureManagedQemu(groupName: string, groupPath: string, qemu: loomQemuConfig, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }

    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const existingPid = await this.readPidFile(pidPath);
    if (existingPid && this.isProcessRunning(existingPid)) {
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
      return;
    }

    if (existingPid) {
      await rm(pidPath, { force: true });
    }

    const executable = manager.executable || "qemu-system-x86_64";
    const args = this.buildManagedQemuArgs(groupPath, manager);
    if (!args.length) {
      throw new Error(`QEMU manager for ${groupName} needs qemu.manager.args or qemu.manager.image.`);
    }

    const logPath = manager.logFile ? this.resolveGroupFilePath(groupPath, manager.logFile) : null;
    const logFd = logPath ? openSync(logPath, "a") : null;
    try {
      const child = spawn(executable, args, {
        cwd: groupPath,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"],
      });

      child.on("error", () => undefined);
      child.unref();

      if (!child.pid) {
        throw new Error(`QEMU manager for ${groupName} did not return a process id.`);
      }

      await writeFile(pidPath, `${child.pid}\n`, "utf8");
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
    } finally {
      if (logFd != null) {
        closeSync(logFd);
      }
    }
  }

  private buildManagedQemuArgs(groupPath: string, manager: loomQemuManagerConfig): string[] {
    const args = splitCommandLine(manager.args || "");
    if (manager.image) {
      const imagePath = this.resolveGroupFilePath(groupPath, manager.image);
      args.push("-drive", `file=${imagePath},if=virtio,format=${manager.imageFormat || "qcow2"}`);
    }
    return args;
  }

  private async waitForManagedQemuReadiness(
    groupName: string,
    groupPath: string,
    qemu: loomQemuConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }

    if (!qemu.healthCheck) {
      await sleepWithSignal(manager.bootDelayMs ?? 0, signal);
      return;
    }

    const timeout = Math.min(manager.readinessTimeoutMs ?? 60_000, Math.max(timeoutMs, 1));
    const interval = manager.readinessIntervalMs ?? 1_000;
    const startedAt = Date.now();
    let lastError = "";

    while (Date.now() - startedAt <= timeout) {
      if (signal.aborted) {
        throw new Error(`QEMU ${groupName} readiness wait cancelled.`);
      }

      try {
        await this.runHealthCheck(qemu.healthCheck, groupPath, Math.min(interval, timeout), signal, `container:${groupName}:qemu:ready`, `QEMU ${groupName} readiness check`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await sleepWithSignal(interval, signal);
    }

    throw new Error(`QEMU ${groupName} did not become ready within ${timeout} ms${lastError ? `: ${lastError}` : "."}`);
  }

  private async stopManagedQemuIfNeeded(groupName: string, groupPath: string, qemu: loomQemuConfig, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const manager = qemu.manager;
    if (!manager?.enabled || manager.persist !== false) {
      return;
    }

    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return;
    }

    if (manager.shutdownCommand) {
      await this.runOptionalCommand(
        manager.shutdownCommand,
        groupPath,
        Math.min(manager.shutdownTimeoutMs ?? timeoutMs, timeoutMs),
        signal,
        `container:${groupName}:qemu:shutdown`,
        `QEMU ${groupName} shutdown`,
      );
    } else if (this.isProcessRunning(pid)) {
      process.kill(pid, manager.killSignal || "SIGTERM");
    }

    const stopped = await this.waitForProcessExit(pid, manager.shutdownTimeoutMs ?? 10_000, signal);
    if (!stopped && this.isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await this.waitForProcessExit(pid, 2_000, signal);
    }

    await rm(pidPath, { force: true });
  }

  private async getManagedQemuStatus(groupPath: string, manager: loomQemuManagerConfig): Promise<string> {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return "stopped";
    }
    return this.isProcessRunning(pid) ? `running pid ${pid}` : `stale pid ${pid}`;
  }

  private async readPidFile(pidPath: string): Promise<number | null> {
    try {
      const value = (await readFile(pidPath, "utf8")).trim();
      const pid = Number.parseInt(value, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForProcessExit(pid: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (signal.aborted) {
        return false;
      }
      if (!this.isProcessRunning(pid)) {
        return true;
      }
      await sleepWithSignal(250, signal);
    }
    return !this.isProcessRunning(pid);
  }

  private async runCustomWrapper(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    request: loomCustomRuntimeRequest,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<loomRunResult> {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);

    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = join(groupPath, requestFileName);
    try {
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map((arg) =>
        arg
          .replaceAll("{request}", requestPath)
          .replaceAll("{group}", groupName)
          .replaceAll("{groupPath}", groupPath),
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal,
      });
    } finally {
      await rm(requestPath, { force: true });
    }
  }

  private createCustomRequest(
    action: loomCustomRuntimeRequest["action"],
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    timeoutMs: number,
    extra: Partial<loomCustomRuntimeRequest> = {},
  ): loomCustomRuntimeRequest {
    return {
      action,
      groupName,
      groupPath,
      runtime: config.runtime,
      image: config.image,
      build: config.custom?.build,
      commandStructure: config.custom?.commandStructure,
      teardown: config.custom?.teardown,
      timeoutMs,
      config: {
        executable: config.executable,
        custom: config.custom,
        qemu: config.qemu,
        healthCheck: config.healthCheck,
        elevation: config.elevation,
      },
      ...extra,
    };
  }

  private createSyntheticResult(runnerId: string, runnerName: string, stdout: string, success = true): loomRunResult {
    const now = new Date().toISOString();
    return {
      runnerId,
      runnerName,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: success ? 0 : -1,
      stdout,
      stderr: "",
      success,
      timedOut: false,
      cancelled: false,
    };
  }

  private getContainersPath(): string {
    const adapterBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    return normalizeFsPath(join(adapterBasePath, this.pluginDir, "containers"));
  }

  private resolveGroupPath(groupName: string): string {
    const safeName = basename(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return normalizeFsPath(join(this.getContainersPath(), safeName));
  }

  private resolveGroupFilePath(groupPath: string, filePath: string): string {
    const safePath = normalizeFsPath(join(groupPath, filePath));
    const normalizedGroupPath = normalizeFsPath(groupPath);
    const posixSafePath = safePath.replace(/\\/g, "/");
    const posixGroupPath = normalizedGroupPath.replace(/\\/g, "/");
    if (posixSafePath !== posixGroupPath && !posixSafePath.startsWith(`${posixGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
  }

  private imageNameForGroup(groupName: string): string {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }

  public getDefaultLanguageConfig(langId: string, settings: loomPluginSettings): loomContainerLanguageConfig | null {
    if (!langId) return null;
    const normalized = langId.toLowerCase().trim();

    // Check command-backed languages first, including external language packs.
    const custom = findEnabledCommandLanguage(settings, normalized);
    if (custom) {
      return {
        command: `${custom.executable} ${custom.args}`.trim(),
        extension: custom.extension || ".txt",
      };
    }

    // Standard built-ins
    switch (normalized) {
      case "python":
      case "py":
        return {
          command: `${settings.pythonExecutable.trim() || "python3"} {file}`,
          extension: ".py",
        };
      case "javascript":
      case "js":
        return {
          command: `${settings.nodeExecutable.trim() || "node"} {file}`,
          extension: ".js",
        };
      case "typescript":
      case "ts":
        return {
          command: `${settings.typescriptTranspilerExecutable.trim() || "ts-node"} {file}`,
          extension: ".ts",
        };
      case "sh":
      case "shell":
        return {
          command: "sh {file}",
          extension: ".sh",
        };
      case "bash":
        return {
          command: `${settings.shellExecutable.trim() || "bash"} {file}`,
          extension: ".sh",
        };
      case "ruby":
      case "rb":
        return {
          command: `${settings.rubyExecutable.trim() || "ruby"} {file}`,
          extension: ".rb",
        };
      case "perl":
      case "pl":
        return {
          command: `${settings.perlExecutable.trim() || "perl"} {file}`,
          extension: ".pl",
        };
      case "lua":
        return {
          command: `${settings.luaExecutable.trim() || "lua"} {file}`,
          extension: ".lua",
        };
      case "php":
        return {
          command: `${settings.phpExecutable.trim() || "php"} {file}`,
          extension: ".php",
        };
      case "go":
        return {
          command: `${settings.goExecutable.trim() || "go"} run {file}`,
          extension: ".go",
        };
      case "haskell":
      case "hs":
        return {
          command: `${settings.haskellExecutable.trim() || "runghc"} {file}`,
          extension: ".hs",
        };
      case "ocaml":
      case "ml":
        if (settings.ocamlMode === "dune") {
          return {
            command: `${settings.ocamlExecutable.trim() || "dune"} exec -- ocaml {file}`,
            extension: ".ml",
          };
        }
        if (settings.ocamlMode === "ocamlc") {
          return {
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/loom-ocaml "$1" && /tmp/loom-ocaml`),
            extension: ".ml",
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml",
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/loom-c && /tmp/loom-c`),
          extension: ".c",
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/loom-cpp && /tmp/loom-cpp`),
          extension: ".cpp",
        };
      case "ebpf":
      case "ebpf-c":
      case "bpf":
      case "bpf-c":
        return {
          command: shellCommand(`${settings.ebpfClangExecutable.trim() || "clang"} -target bpf -O2 -g -Wall "$1" -c -o /tmp/loom-ebpf.o && printf 'compiled /tmp/loom-ebpf.o\\n'`),
          extension: ".bpf.c",
        };
      case "bpftrace":
      case "bt":
        return {
          command: shellCommand(`if ${settings.bpftraceExecutable.trim() || "bpftrace"} --help 2>&1 | grep -q -- '--dry-run'; then ${settings.bpftraceExecutable.trim() || "bpftrace"} --dry-run "$1"; else ${settings.bpftraceExecutable.trim() || "bpftrace"} -d "$1"; fi`),
          extension: ".bt",
        };
      case "rust":
      case "rs":
        return {
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/loom-rust && /tmp/loom-rust`),
          extension: ".rs",
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/loom-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
          extension: ".java",
        };
      }
      case "llvm-ir":
      case "llvm":
      case "ll":
        return {
          command: `${settings.llvmInterpreterExecutable.trim() || "lli"} {file}`,
          extension: ".ll",
        };
      case "lean":
        return {
          command: `${settings.leanExecutable.trim() || "lean"} {file}`,
          extension: ".lean",
        };
      case "coq":
        return {
          command: `${settings.coqExecutable.trim() || "coqc"} -q {file}`,
          extension: ".v",
        };
      case "smtlib":
      case "smt":
      case "smt-lib":
        return {
          command: `${settings.smtExecutable.trim() || "z3"} {file}`,
          extension: ".smt2",
        };
    }
    return null;
  }
}

function shellCommand(command: string): string {
  return `sh -lc ${quoteCommandArg(command)} sh {file}`;
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function showDockerNotice(message: string): void {
  new Notice(message, 8000);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function optionalSignal(value: unknown, label: string): NodeJS.Signals | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string" || !/^SIG[A-Z0-9]+$/.test(value)) {
    throw new Error(`${label} must be a signal name like SIGTERM.`);
  }
  return value as NodeJS.Signals;
}

async function sleepWithSignal(durationMs: number, signal: AbortSignal): Promise<void> {
  if (durationMs <= 0 || signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function runtimeLabel(runtime: loomContainerRuntime): string {
  switch (runtime) {
    case "docker":
      return "Docker";
    case "podman":
      return "Podman";
    case "qemu":
      return "QEMU";
    case "custom":
      return "Custom";
    case "wsl":
      return "WSL";
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteCommandArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
