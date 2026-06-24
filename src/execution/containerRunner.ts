import type { App, TFile } from "obsidian";
import { closeSync, existsSync, openSync } from "fs";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { basename, join, normalize as normalizeFsPath, posix as posixPath } from "path";
import { spawn } from "child_process";
import { isCompileContainerGroupAllowed, isCompileContainerRuntimeAllowed, isCompileFeatureAllowed } from "../buildProfile";
import { runProcess } from "./processRunner";
import { splitCommandLine } from "../utils/command";
import { findEnabledCommandLanguage } from "../languagePackages";
import type { lotusCodeBlock, lotusPluginSettings, lotusRunContext, lotusRunResult } from "../types";

type lotusContainerRuntime = "docker" | "podman" | "qemu" | "wsl" | "ssh" | "custom";
type lotusContainerElevationMode = "default" | "root";

interface lotusContainerLanguageConfig {
  command?: string;
  extension?: string;
  useDefault?: boolean;
}

interface lotusCommandExpectation {
  command: string;
  positiveResponse?: string;
  negativeResponse?: string;
}

interface lotusQemuConfig {
  sshTarget: string;
  remoteWorkspace: string;
  sshExecutable?: string;
  sshArgs?: string;
  sshAuthSock?: string;
  scpExecutable?: string;
  scpArgs?: string;
  cleanupRemoteFile?: boolean;
  startCommand?: string;
  buildCommand?: string;
  teardownCommand?: string;
  healthCheck?: lotusCommandExpectation;
  manager?: lotusQemuManagerConfig;
}

interface lotusRemoteConfig {
  target: string;
  workspace: string;
  sshExecutable?: string;
  sshArgs?: string;
  sshAuthSock?: string;
  scpExecutable?: string;
  scpArgs?: string;
  cleanupRemoteFile?: boolean;
  mkdirCommand?: string;
  cleanupCommand?: string;
  healthCheck?: lotusCommandExpectation;
}

interface lotusQemuManagerConfig {
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

interface lotusCustomRuntimeConfig {
  executable: string;
  args?: string;
  build?: string;
  commandStructure?: string;
  teardown?: string;
  healthCheck?: lotusCommandExpectation;
}

interface lotusWslConfig {
  interactive?: boolean;
}

interface lotusContainerElevationConfig {
  mode: lotusContainerElevationMode;
  commandPrefix?: string;
}

interface lotusContainerConfig {
  runtime: lotusContainerRuntime;
  executable?: string;
  image?: string;
  elevation: lotusContainerElevationConfig;
  wsl?: lotusWslConfig;
  healthCheck?: lotusCommandExpectation;
  outputFilters?: lotusOutputFilterConfig;
  ssh?: lotusRemoteConfig;
  qemu?: lotusQemuConfig;
  custom?: lotusCustomRuntimeConfig;
  languages: Record<string, lotusContainerLanguageConfig>;
}

interface lotusOutputFilterConfig {
  stripAnsi?: boolean;
  stdoutStart?: RegExp;
  stdoutEnd?: RegExp;
  stderrStart?: RegExp;
  stderrEnd?: RegExp;
  stripStdout?: RegExp[];
  stripStderr?: RegExp[];
}

interface lotusCustomRuntimeRequest {
  action: "build" | "run" | "teardown";
  groupName: string;
  groupPath: string;
  runtime: lotusContainerRuntime;
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
    custom?: lotusCustomRuntimeConfig;
    ssh?: lotusRemoteConfig;
    qemu?: lotusQemuConfig;
    healthCheck?: lotusCommandExpectation;
    elevation?: lotusContainerElevationConfig;
    outputFilters?: {
      stripAnsi?: boolean;
      stdoutStart?: string;
      stdoutEnd?: string;
      stderrStart?: string;
      stderrEnd?: string;
      stripStdout?: string[];
      stripStderr?: string[];
    };
  };
}

export class lotusContainerRunner {
  private readonly builtImages = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
  ) { }

  getContainerGroupName(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["lotus-execution"] ?? frontmatter?.["lotus-container"];
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
        .filter((entry) => entry.isDirectory() && isCompileContainerGroupAllowed(entry.name))
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
            if (config.runtime === "ssh" && config.ssh?.target) {
              pieces.push(`ssh: ${config.ssh.target}`);
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

  async run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings, groupName: string): Promise<lotusRunResult> {
    if (!isCompileContainerGroupAllowed(groupName)) {
      throw new Error(`Container group ${groupName} is not included in this Lotus build.`);
    }
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];

    let isFallback = false;
    let language: lotusContainerLanguageConfig | null = null;

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
      let result: lotusRunResult;
      switch (config.runtime) {
        case "docker":
        case "podman":
          result = await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
          break;
        case "qemu":
          result = await this.runQemu(groupName, groupPath, config, language, tempFileName, tempFilePath, context);
          break;
        case "custom":
          result = await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
          break;
        case "wsl":
          result = await this.runWslContainer(groupName, groupPath, config, language, tempFileName, context);
          break;
        case "ssh":
          result = await this.runSshRemote(groupName, groupPath, config, language, tempFileName, tempFilePath, context);
          break;
        default:
          throw new Error(`Unsupported runtime: ${config.runtime}`);
      }

      this.applyOutputFilters(result, config.outputFilters);

      if (isFallback) {
        const fallbackMsg = `[Lotus] Language '${block.language}' was not declared in container group. Running using default command: ${language.command}`;
        result.warning = result.warning ? `${result.warning}\n${fallbackMsg}` : fallbackMsg;
      }
      if (config.elevation.mode === "root") {
        const elevationMsg = `[Lotus] Container elevation: root${config.elevation.commandPrefix ? ` via ${config.elevation.commandPrefix}` : ""}.`;
        result.warning = result.warning ? `${result.warning}\n${elevationMsg}` : elevationMsg;
      }
      return result;
    } finally {
      await rm(tempFilePath, { force: true });
    }
  }

  async buildGroup(groupName: string, timeoutMs: number, signal: AbortSignal): Promise<lotusRunResult> {
    if (!isCompileContainerGroupAllowed(groupName)) {
      throw new Error(`Container group ${groupName} is not included in this Lotus build.`);
    }
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
      case "ssh":
        return this.createSyntheticResult(
          `container:${groupName}:ssh:build`,
          `SSH ${groupName} build`,
          `SSH remote ${config.ssh?.target ?? "(unconfigured)"} does not require a build step.\n`,
        );
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
    config: lotusContainerConfig,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    context: lotusRunContext,
    settings: lotusPluginSettings,
  ): Promise<lotusRunResult> {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const workspacePath = "/workspace";
    const containerFile = posixPath.join(workspacePath, tempFileName);
    const workingDirectory = normalizeFsPath(context.workingDirectory || groupPath);
    const useContextWorkingDirectory = workingDirectory !== normalizeFsPath(groupPath);
    const command = splitCommandLine(language.command!.replaceAll("{file}", containerFile));
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
        `${groupPath}:${workspacePath}`,
        ...(useContextWorkingDirectory
          ? ["-v", `${workingDirectory}:/lotus-cwd`, "-w", "/lotus-cwd"]
          : ["-w", workspacePath]),
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
    config: lotusContainerConfig,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: lotusRunContext,
  ): Promise<lotusRunResult> {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);

    try {
      return await this.runRemoteLanguage(
        groupName,
        groupPath,
        "qemu",
        `QEMU ${groupName}`,
        config,
        this.remoteConfigFromQemu(qemu),
        language,
        tempFileName,
        tempFilePath,
        context,
      );
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    }
  }

  private async runSshRemote(
    groupName: string,
    groupPath: string,
    config: lotusContainerConfig,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: lotusRunContext,
  ): Promise<lotusRunResult> {
    return this.runRemoteLanguage(
      groupName,
      groupPath,
      "ssh",
      `SSH ${groupName}`,
      config,
      this.requireSshConfig(config),
      language,
      tempFileName,
      tempFilePath,
      context,
    );
  }

  private async runRemoteLanguage(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    config: lotusContainerConfig,
    remote: lotusRemoteConfig,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: lotusRunContext,
  ): Promise<lotusRunResult> {
    const remoteFile = posixPath.join(remote.workspace, tempFileName);
    await this.ensureRemoteWorkspace(groupName, groupPath, runtimeId, runnerName, remote, context.timeoutMs, context.signal);
    await this.runRemoteHealthCheck(groupName, groupPath, runtimeId, runnerName, remote, context.timeoutMs, context.signal);
    await this.uploadRemoteFile(groupName, groupPath, runtimeId, runnerName, remote, tempFilePath, remoteFile, context.timeoutMs, context.signal);

    let result: lotusRunResult | undefined;
    try {
      const remoteCommand = this.applyCommandPrefix(config, language.command!.replaceAll("{file}", shellQuote(remoteFile)));
      if (!remoteCommand.trim()) {
        throw new Error(`${runnerName} command is empty.`);
      }
      result = await this.runRemoteCommand(
        groupName,
        groupPath,
        runtimeId,
        runnerName,
        remote,
        `cd ${shellQuote(remote.workspace)} && ${remoteCommand}`,
        context.timeoutMs,
        context.signal,
        context.stdin,
        "run",
      );
      return result;
    } finally {
      if (remote.cleanupRemoteFile !== false) {
        const cleanup = await this.cleanupRemoteFile(groupName, groupPath, runtimeId, runnerName, remote, remoteFile, context.timeoutMs, context.signal);
        if (result && !cleanup.success) {
          const warning = `Remote cleanup failed: ${cleanup.stderr || cleanup.stdout || `exit ${cleanup.exitCode}`}`;
          result.warning = result.warning ? `${result.warning}\n${warning}` : warning;
        }
      }
    }
  }

  private async runCustom(
    groupName: string,
    groupPath: string,
    config: lotusContainerConfig,
    block: lotusCodeBlock,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: lotusRunContext,
  ): Promise<lotusRunResult> {
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
    config: lotusContainerConfig,
    language: lotusContainerLanguageConfig,
    tempFileName: string,
    context: lotusRunContext,
  ): Promise<lotusRunResult> {
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

  private remoteConfigFromQemu(qemu: lotusQemuConfig): lotusRemoteConfig {
    return {
      target: qemu.sshTarget,
      workspace: qemu.remoteWorkspace,
      sshExecutable: qemu.sshExecutable,
      sshArgs: qemu.sshArgs,
      sshAuthSock: qemu.sshAuthSock,
      scpExecutable: qemu.scpExecutable,
      scpArgs: qemu.scpArgs,
      cleanupRemoteFile: qemu.cleanupRemoteFile,
    };
  }

  private async ensureRemoteWorkspace(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    remote: lotusRemoteConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const command = (remote.mkdirCommand || "mkdir -p {workspace}").replaceAll("{workspace}", shellQuote(remote.workspace));
    const result = await this.runRemoteCommand(groupName, groupPath, runtimeId, `${runnerName} mkdir`, remote, command, timeoutMs, signal, undefined, "mkdir");
    if (!result.success) {
      throw new Error(`${runnerName} workspace setup failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }

  private async runRemoteHealthCheck(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    remote: lotusRemoteConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (!remote.healthCheck) {
      return;
    }
    const result = await this.runRemoteCommand(groupName, groupPath, runtimeId, `${runnerName} remote health check`, remote, remote.healthCheck.command, timeoutMs, signal, undefined, "health");
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    if (!result.success) {
      throw new Error(`${runnerName} remote health check failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    if (remote.healthCheck.negativeResponse && combinedOutput.includes(remote.healthCheck.negativeResponse)) {
      throw new Error(`${runnerName} remote health check returned negative response: ${remote.healthCheck.negativeResponse}`);
    }
    if (remote.healthCheck.positiveResponse && !combinedOutput.includes(remote.healthCheck.positiveResponse)) {
      throw new Error(`${runnerName} remote health check did not return positive response: ${remote.healthCheck.positiveResponse}`);
    }
  }

  private async uploadRemoteFile(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    remote: lotusRemoteConfig,
    localFile: string,
    remoteFile: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const result = await runProcess({
      runnerId: `container:${groupName}:${runtimeId}:upload`,
      runnerName: `${runnerName} upload`,
      executable: remote.scpExecutable || "scp",
      args: [
        ...splitCommandLine(remote.scpArgs || ""),
        localFile,
        `${remote.target}:${remoteFile}`,
      ],
      workingDirectory: groupPath,
      timeoutMs,
      signal,
      env: this.remoteProcessEnv(remote),
    });
    if (!result.success) {
      throw new Error(`${runnerName} upload failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }

  private async cleanupRemoteFile(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    remote: lotusRemoteConfig,
    remoteFile: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<lotusRunResult> {
    const command = (remote.cleanupCommand || "rm -f {file}").replaceAll("{file}", shellQuote(remoteFile));
    return this.runRemoteCommand(groupName, groupPath, runtimeId, `${runnerName} cleanup`, remote, command, timeoutMs, signal, undefined, "cleanup");
  }

  private async runRemoteCommand(
    groupName: string,
    groupPath: string,
    runtimeId: "ssh" | "qemu",
    runnerName: string,
    remote: lotusRemoteConfig,
    command: string,
    timeoutMs: number,
    signal: AbortSignal,
    stdin: string | undefined,
    action: string,
  ): Promise<lotusRunResult> {
    return runProcess({
      runnerId: `container:${groupName}:${runtimeId}:${action}`,
      runnerName,
      executable: remote.sshExecutable || "ssh",
      args: [
        ...splitCommandLine(remote.sshArgs || ""),
        remote.target,
        command,
      ],
      workingDirectory: groupPath,
      timeoutMs,
      signal,
      stdin,
      env: this.remoteProcessEnv(remote),
    });
  }

  private remoteProcessEnv(remote: lotusRemoteConfig): NodeJS.ProcessEnv | undefined {
    return remote.sshAuthSock ? { SSH_AUTH_SOCK: remote.sshAuthSock } : undefined;
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
    config: lotusContainerConfig,
    context: lotusRunContext,
    settings: lotusPluginSettings,
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
    config: lotusContainerConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<lotusRunResult> {
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

  private async buildQemu(groupName: string, groupPath: string, config: lotusContainerConfig, timeoutMs: number, signal: AbortSignal): Promise<lotusRunResult> {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }

  private async readConfig(groupPath: string): Promise<lotusContainerConfig> {
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
      outputFilters?: unknown;
      outputFilter?: unknown;
      ssh?: unknown;
      remote?: unknown;
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

    const languages: Record<string, lotusContainerLanguageConfig> = {};
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
      outputFilters: this.readOutputFilters(data.outputFilters ?? data.outputFilter),
      ssh: this.readSshConfig(data.ssh ?? data.remote, runtime),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages,
    };
  }

  private readRuntime(value: unknown): lotusContainerRuntime {
    let runtime: lotusContainerRuntime;
    if (value == null) {
      runtime = "docker";
    } else if (value === "remote") {
      runtime = "ssh";
    } else if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl" || value === "ssh") {
      runtime = value;
    } else {
      throw new Error("Container config runtime must be docker, podman, qemu, custom, wsl, ssh, or remote.");
    }

    if (!isCompileContainerRuntimeAllowed(runtime)) {
      throw new Error(`Container runtime ${runtime} is not included in this Lotus build.`);
    }
    return runtime;
  }

  private readWslConfig(value: unknown): lotusWslConfig | undefined {
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

  private readElevationConfig(value: unknown): lotusContainerElevationConfig {
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

  private readSshConfig(value: unknown, runtime: lotusContainerRuntime): lotusRemoteConfig | undefined {
    if (value == null) {
      if (runtime === "ssh") {
        throw new Error("SSH runtime requires an ssh config object.");
      }
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config ssh must be an object.");
    }
    const data = value as Record<string, unknown>;
    const target = optionalString(data.target ?? data.sshTarget);
    const workspace = optionalString(data.workspace ?? data.remoteWorkspace);
    if (!target) {
      throw new Error("Container config ssh.target must be a string.");
    }
    if (!workspace) {
      throw new Error("Container config ssh.workspace must be a string.");
    }
    return {
      target,
      workspace,
      sshExecutable: optionalString(data.sshExecutable),
      sshArgs: optionalString(data.sshArgs),
      sshAuthSock: optionalString(data.sshAuthSock ?? data.authSock ?? data.sshAgentSocket),
      scpExecutable: optionalString(data.scpExecutable),
      scpArgs: optionalString(data.scpArgs),
      cleanupRemoteFile: typeof data.cleanupRemoteFile === "boolean" ? data.cleanupRemoteFile : undefined,
      mkdirCommand: optionalString(data.mkdirCommand),
      cleanupCommand: optionalString(data.cleanupCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config ssh.healthCheck"),
    };
  }

  private readOutputFilters(value: unknown): lotusOutputFilterConfig | undefined {
    if (!isCompileFeatureAllowed("output-filters")) {
      return undefined;
    }
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config outputFilters must be an object.");
    }
    const data = value as Record<string, unknown>;
    return {
      stripAnsi: data.stripAnsi === true,
      stdoutStart: optionalRegex(data.stdoutStart, "Container config outputFilters.stdoutStart"),
      stdoutEnd: optionalRegex(data.stdoutEnd, "Container config outputFilters.stdoutEnd"),
      stderrStart: optionalRegex(data.stderrStart, "Container config outputFilters.stderrStart"),
      stderrEnd: optionalRegex(data.stderrEnd, "Container config outputFilters.stderrEnd"),
      stripStdout: optionalRegexList(data.stripStdout, "Container config outputFilters.stripStdout"),
      stripStderr: optionalRegexList(data.stripStderr, "Container config outputFilters.stripStderr"),
    };
  }

  private readQemuConfig(value: unknown): lotusQemuConfig | undefined {
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
      sshAuthSock: optionalString(data.sshAuthSock ?? data.authSock ?? data.sshAgentSocket),
      scpExecutable: optionalString(data.scpExecutable),
      scpArgs: optionalString(data.scpArgs),
      cleanupRemoteFile: typeof data.cleanupRemoteFile === "boolean" ? data.cleanupRemoteFile : undefined,
      startCommand: optionalString(data.startCommand),
      buildCommand: optionalString(data.buildCommand),
      teardownCommand: optionalString(data.teardownCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck"),
      manager: this.readQemuManagerConfig(data.manager),
    };
  }

  private readQemuManagerConfig(value: unknown): lotusQemuManagerConfig | undefined {
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

  private readCustomConfig(value: unknown): lotusCustomRuntimeConfig | undefined {
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

  private readHealthCheck(value: unknown, label: string): lotusCommandExpectation | undefined {
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

  private requireQemuConfig(config: lotusContainerConfig): lotusQemuConfig {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }

  private requireSshConfig(config: lotusContainerConfig): lotusRemoteConfig {
    if (!config.ssh) {
      throw new Error("SSH runtime requires an ssh config object.");
    }
    return config.ssh;
  }

  private requireCustomConfig(config: lotusContainerConfig): lotusCustomRuntimeConfig {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }

  private runtimeExecutable(config: lotusContainerConfig): string {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }

  private ociElevationArgs(config: lotusContainerConfig): string[] {
    return config.elevation.mode === "root" ? ["--user", "root"] : [];
  }

  private applyCommandPrefix(config: lotusContainerConfig, command: string): string {
    const prefix = config.elevation.mode === "root" ? config.elevation.commandPrefix?.trim() : "";
    return prefix ? `${prefix} ${command}` : command;
  }

  private applyOutputFilters(result: lotusRunResult, filters: lotusOutputFilterConfig | undefined): void {
    if (!filters) {
      return;
    }
    result.stdout = this.filterOutputStream(result.stdout, filters.stdoutStart, filters.stdoutEnd, filters.stripStdout, filters.stripAnsi);
    result.stderr = this.filterOutputStream(result.stderr, filters.stderrStart, filters.stderrEnd, filters.stripStderr, filters.stripAnsi);
  }

  private filterOutputStream(
    value: string,
    start: RegExp | undefined,
    end: RegExp | undefined,
    strip: RegExp[] | undefined,
    stripAnsi: boolean | undefined,
  ): string {
    let output = stripAnsi ? value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") : value;
    if (start) {
      start.lastIndex = 0;
      const match = start.exec(output);
      if (match) {
        output = output.slice(match.index + match[0].length);
      }
    }
    if (end) {
      end.lastIndex = 0;
      const match = end.exec(output);
      if (match) {
        output = output.slice(0, match.index);
      }
    }
    for (const pattern of strip ?? []) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, "");
    }
    return output;
  }

  private async runHealthCheck(
    healthCheck: lotusCommandExpectation | undefined,
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
  ): Promise<lotusRunResult> {
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

  private async ensureManagedQemu(groupName: string, groupPath: string, qemu: lotusQemuConfig, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }

    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".lotus-qemu.pid");
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

  private buildManagedQemuArgs(groupPath: string, manager: lotusQemuManagerConfig): string[] {
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
    qemu: lotusQemuConfig,
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

  private async stopManagedQemuIfNeeded(groupName: string, groupPath: string, qemu: lotusQemuConfig, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const manager = qemu.manager;
    if (!manager?.enabled || manager.persist !== false) {
      return;
    }

    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".lotus-qemu.pid");
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

  private async getManagedQemuStatus(groupPath: string, manager: lotusQemuManagerConfig): Promise<string> {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".lotus-qemu.pid");
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
    config: lotusContainerConfig,
    request: lotusCustomRuntimeRequest,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<lotusRunResult> {
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
    action: lotusCustomRuntimeRequest["action"],
    groupName: string,
    groupPath: string,
    config: lotusContainerConfig,
    timeoutMs: number,
    extra: Partial<lotusCustomRuntimeRequest> = {},
  ): lotusCustomRuntimeRequest {
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

  private createSyntheticResult(runnerId: string, runnerName: string, stdout: string, success = true): lotusRunResult {
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
    return `lotus-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }

  public getDefaultLanguageConfig(langId: string, settings: lotusPluginSettings): lotusContainerLanguageConfig | null {
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
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/lotus-ocaml "$1" && /tmp/lotus-ocaml`),
            extension: ".ml",
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml",
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/lotus-c && /tmp/lotus-c`),
          extension: ".c",
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/lotus-cpp && /tmp/lotus-cpp`),
          extension: ".cpp",
        };
      case "ebpf":
      case "ebpf-c":
      case "bpf":
      case "bpf-c":
        return {
          command: shellCommand(`${settings.ebpfClangExecutable.trim() || "clang"} -target bpf -O2 -g -Wall "$1" -c -o /tmp/lotus-ebpf.o && printf 'compiled /tmp/lotus-ebpf.o\\n'`),
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
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/lotus-rust && /tmp/lotus-rust`),
          extension: ".rs",
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/lotus-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalRegex(value: unknown, label: string): RegExp | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return regexFromString(value, label);
}

function optionalRegexList(value: unknown, label: string): RegExp[] | undefined {
  if (value == null) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : null;
  if (!values) {
    throw new Error(`${label} must be a string or array of strings.`);
  }
  const patterns = values
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean)
    .map((entry, index) => regexFromString(entry, `${label}[${index}]`, "g"));
  return patterns.length ? patterns : undefined;
}

function regexFromString(value: string, label: string, fallbackFlags = ""): RegExp {
  const literal = value.match(/^\/(.+)\/([a-z]*)$/i);
  const source = literal ? literal[1] : value;
  const flags = literal ? literal[2] : fallbackFlags;
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(`${label} is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function runtimeLabel(runtime: lotusContainerRuntime): string {
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
    case "ssh":
      return "SSH";
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteCommandArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
