"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => loomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path7 = require("path");

// src/execution/containerRunner.ts
var import_obsidian = require("obsidian");
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_path2 = require("path");
var import_child_process2 = require("child_process");

// src/execution/processRunner.ts
var import_promises = require("fs/promises");
var import_os = require("os");
var import_path = require("path");
var import_child_process = require("child_process");
async function withNamedTempSourceFile(fileName, source, callback) {
  const tempDir = await (0, import_promises.mkdtemp)((0, import_path.join)((0, import_os.tmpdir)(), "loom-"));
  const tempFile = (0, import_path.join)(tempDir, fileName);
  try {
    await (0, import_promises.writeFile)(tempFile, normalizeExecutableSource(source), "utf8");
    return await callback({ tempDir, tempFile });
  } finally {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
  }
}
async function withTempSourceFile(fileExtension, source, callback) {
  return withNamedTempSourceFile(`snippet${fileExtension}`, source, callback);
}
function normalizeExecutableSource(source) {
  const lines = source.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (!nonEmptyLines.length) {
    return source;
  }
  let sharedIndent = getLeadingWhitespace(nonEmptyLines[0]);
  for (const line of nonEmptyLines.slice(1)) {
    sharedIndent = sharedWhitespacePrefix(sharedIndent, getLeadingWhitespace(line));
    if (!sharedIndent) {
      return source;
    }
  }
  if (!sharedIndent) {
    return source;
  }
  return lines.map((line) => line.trim().length === 0 ? line : line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join("\n");
}
function getLeadingWhitespace(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function sharedWhitespacePrefix(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}
async function runProcess(spec) {
  const startedAt = /* @__PURE__ */ new Date();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;
  let cancelled = false;
  let child = null;
  let timeoutHandle = null;
  let abortHandler = null;
  try {
    await new Promise((resolve, reject) => {
      child = (0, import_child_process.spawn)(spec.executable, spec.args, {
        cwd: spec.workingDirectory,
        shell: false,
        env: {
          ...process.env,
          ...spec.env
        }
      });
      const abort = () => {
        cancelled = true;
        child?.kill("SIGTERM");
      };
      abortHandler = abort;
      if (spec.signal.aborted) {
        abort();
      } else {
        spec.signal.addEventListener("abort", abort, { once: true });
      }
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child?.kill("SIGTERM");
      }, spec.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolve();
      });
    });
  } catch (error) {
    stderr = stderr || formatProcessError(error, spec.executable);
    exitCode = exitCode ?? -1;
  } finally {
    if (abortHandler) {
      spec.signal.removeEventListener("abort", abortHandler);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  const finishedAt = /* @__PURE__ */ new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = !timedOut && !cancelled && exitCode === 0;
  return {
    runnerId: spec.runnerId,
    runnerName: spec.runnerName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    exitCode,
    stdout,
    stderr,
    success,
    timedOut,
    cancelled
  };
}
function formatProcessError(error, executable) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `Executable not found: ${executable}`;
  }
  return error instanceof Error ? error.message : String(error);
}
async function runTempFileProcess(spec) {
  return withTempSourceFile(
    spec.fileExtension,
    spec.source,
    async ({ tempFile, tempDir }) => runProcess({
      runnerId: spec.runnerId,
      runnerName: spec.runnerName,
      executable: spec.executable,
      args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
      workingDirectory: spec.workingDirectory,
      timeoutMs: spec.timeoutMs,
      signal: spec.signal,
      env: expandTemplatedEnv(spec.env, tempFile, tempDir)
    })
  );
}
function expandTemplatedEnv(env, tempFile, tempDir) {
  if (!env) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir) : value
    ])
  );
}

// src/utils/command.ts
function splitCommandLine(input) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

// src/execution/containerRunner.ts
var loomContainerRunner = class {
  constructor(app, pluginDir) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.builtImages = /* @__PURE__ */ new Set();
  }
  getContainerGroupName(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  async getGroupSummaries() {
    const containersPath = this.getContainersPath();
    if (!(0, import_fs.existsSync)(containersPath)) {
      return [];
    }
    const entries = await (0, import_promises2.readdir)(containersPath, { withFileTypes: true });
    return Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const groupPath = (0, import_path2.join)(containersPath, entry.name);
        const hasConfig = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "config.json"));
        const hasDockerfile = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"));
        if (!hasConfig) {
          return {
            name: entry.name,
            status: "missing config.json"
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
          const languageCount = Object.keys(config.languages).length;
          pieces.push(`${languageCount} language${languageCount === 1 ? "" : "s"}`);
          return {
            name: entry.name,
            status: pieces.join(", ")
          };
        } catch (error) {
          return {
            name: entry.name,
            status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      })
    );
  }
  async run(block, context, settings, groupName) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];
    let isFallback = false;
    let language = null;
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
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      let result;
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
        result.warning = result.warning ? `${result.warning}
${fallbackMsg}` : fallbackMsg;
      }
      return result;
    } finally {
      await (0, import_promises2.rm)(tempFilePath, { force: true });
    }
  }
  async buildGroup(groupName, timeoutMs, signal) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
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
          `WSL environment ${config.image || "(default)"} does not require a build step.
`
        );
    }
  }
  async runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings) {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
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
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        ...command
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  async runQemu(groupName, groupPath, config, language, tempFileName, context) {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);
    try {
      const remoteFile = import_path2.posix.join(qemu.remoteWorkspace, tempFileName);
      const remoteCommand = language.command.replaceAll("{file}", shellQuote(remoteFile));
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
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    }
  }
  async runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context) {
    const command = language.command.replaceAll("{file}", tempFileName);
    const result = await this.runCustomWrapper(
      groupName,
      groupPath,
      config,
      this.createCustomRequest("run", groupName, groupPath, config, context.timeoutMs, {
        language: block.language,
        languageAlias: block.languageAlias,
        fileName: tempFileName,
        filePath: tempFilePath,
        command
      }),
      context.timeoutMs,
      context.signal
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
          command
        }),
        context.timeoutMs,
        context.signal
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }
    return result;
  }
  async runWslContainer(groupName, groupPath, config, language, tempFileName, context) {
    const wslGroupPath = this.translateToWslPath(groupPath);
    const command = language.command.replaceAll("{file}", tempFileName);
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
      signal: context.signal
    });
  }
  translateToWslPath(windowsPath) {
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
  async resolveImage(groupName, groupPath, config, context, settings) {
    const dockerfile = (0, import_path2.join)(groupPath, "Dockerfile");
    if (!(0, import_fs.existsSync)(dockerfile)) {
      return config.image || "ubuntu:latest";
    }
    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }
    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 12e4), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }
    this.builtImages.add(cacheKey);
    return image;
  }
  async buildImage(groupName, groupPath, config, timeoutMs, signal) {
    const image = this.imageNameForGroup(groupName);
    if (!(0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.
`
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal
    });
  }
  async buildQemu(groupName, groupPath, config, timeoutMs, signal) {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }
  async readConfig(groupPath) {
    const configPath = (0, import_path2.join)(groupPath, "config.json");
    let raw;
    try {
      raw = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }
    const data = raw;
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
    const languages = {};
    for (const [language, value] of Object.entries(data.languages)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value;
      const useDefault = languageConfig.useDefault === true;
      if (!useDefault && (typeof languageConfig.command !== "string" || !languageConfig.command.trim())) {
        throw new Error(`Container language ${language} must define command or useDefault.`);
      }
      languages[language] = {
        command: typeof languageConfig.command === "string" ? languageConfig.command : void 0,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : void 0,
        useDefault: useDefault || void 0
      };
    }
    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : void 0,
      image: typeof data.image === "string" ? data.image : void 0,
      wsl: this.readWslConfig(data.wsl),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages
    };
  }
  readRuntime(value) {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, custom, or wsl.");
  }
  readWslConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config wsl must be an object.");
    }
    const data = value;
    return {
      interactive: data.interactive === true
    };
  }
  readQemuConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value;
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
      manager: this.readQemuManagerConfig(data.manager)
    };
  }
  readQemuManagerConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu.manager must be an object.");
    }
    const data = value;
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
      persist: typeof data.persist === "boolean" ? data.persist : void 0
    };
  }
  readCustomConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck")
    };
  }
  readHealthCheck(value, label) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"])
    };
  }
  requireQemuConfig(config) {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }
  requireCustomConfig(config) {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }
  runtimeExecutable(config) {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }
  async runHealthCheck(healthCheck, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!healthCheck) {
      return;
    }
    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}
${result.stderr}`;
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
  async runOptionalCommand(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }
  async runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
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
      signal
    });
  }
  async ensureManagedQemu(groupName, groupPath, qemu, timeoutMs, signal) {
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
      await (0, import_promises2.rm)(pidPath, { force: true });
    }
    const executable = manager.executable || "qemu-system-x86_64";
    const args = this.buildManagedQemuArgs(groupPath, manager);
    if (!args.length) {
      throw new Error(`QEMU manager for ${groupName} needs qemu.manager.args or qemu.manager.image.`);
    }
    const logPath = manager.logFile ? this.resolveGroupFilePath(groupPath, manager.logFile) : null;
    const logFd = logPath ? (0, import_fs.openSync)(logPath, "a") : null;
    try {
      const child = (0, import_child_process2.spawn)(executable, args, {
        cwd: groupPath,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"]
      });
      child.on("error", () => void 0);
      child.unref();
      if (!child.pid) {
        throw new Error(`QEMU manager for ${groupName} did not return a process id.`);
      }
      await (0, import_promises2.writeFile)(pidPath, `${child.pid}
`, "utf8");
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
    } finally {
      if (logFd != null) {
        (0, import_fs.closeSync)(logFd);
      }
    }
  }
  buildManagedQemuArgs(groupPath, manager) {
    const args = splitCommandLine(manager.args || "");
    if (manager.image) {
      const imagePath = this.resolveGroupFilePath(groupPath, manager.image);
      args.push("-drive", `file=${imagePath},if=virtio,format=${manager.imageFormat || "qcow2"}`);
    }
    return args;
  }
  async waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    if (!qemu.healthCheck) {
      await sleepWithSignal(manager.bootDelayMs ?? 0, signal);
      return;
    }
    const timeout = Math.min(manager.readinessTimeoutMs ?? 6e4, Math.max(timeoutMs, 1));
    const interval = manager.readinessIntervalMs ?? 1e3;
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
  async stopManagedQemuIfNeeded(groupName, groupPath, qemu, timeoutMs, signal) {
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
        `QEMU ${groupName} shutdown`
      );
    } else if (this.isProcessRunning(pid)) {
      process.kill(pid, manager.killSignal || "SIGTERM");
    }
    const stopped = await this.waitForProcessExit(pid, manager.shutdownTimeoutMs ?? 1e4, signal);
    if (!stopped && this.isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await this.waitForProcessExit(pid, 2e3, signal);
    }
    await (0, import_promises2.rm)(pidPath, { force: true });
  }
  async getManagedQemuStatus(groupPath, manager) {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return "stopped";
    }
    return this.isProcessRunning(pid) ? `running pid ${pid}` : `stale pid ${pid}`;
  }
  async readPidFile(pidPath) {
    try {
      const value = (await (0, import_promises2.readFile)(pidPath, "utf8")).trim();
      const pid = Number.parseInt(value, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  async waitForProcessExit(pid, timeoutMs, signal) {
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
  async runCustomWrapper(groupName, groupPath, config, request, timeoutMs, signal) {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);
    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = (0, import_path2.join)(groupPath, requestFileName);
    try {
      await (0, import_promises2.writeFile)(requestPath, `${JSON.stringify(request, null, 2)}
`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map(
        (arg) => arg.replaceAll("{request}", requestPath).replaceAll("{group}", groupName).replaceAll("{groupPath}", groupPath)
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal
      });
    } finally {
      await (0, import_promises2.rm)(requestPath, { force: true });
    }
  }
  createCustomRequest(action, groupName, groupPath, config, timeoutMs, extra = {}) {
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
        healthCheck: config.healthCheck
      },
      ...extra
    };
  }
  createSyntheticResult(runnerId, runnerName, stdout, success = true) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
      cancelled: false
    };
  }
  getContainersPath() {
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    return (0, import_path2.normalize)((0, import_path2.join)(adapterBasePath, this.pluginDir, "containers"));
  }
  resolveGroupPath(groupName) {
    const safeName = (0, import_path2.basename)(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return (0, import_path2.normalize)((0, import_path2.join)(this.getContainersPath(), safeName));
  }
  resolveGroupFilePath(groupPath, filePath) {
    const safePath = (0, import_path2.normalize)((0, import_path2.join)(groupPath, filePath));
    const normalizedGroupPath = (0, import_path2.normalize)(groupPath);
    const posixSafePath = safePath.replace(/\\/g, "/");
    const posixGroupPath = normalizedGroupPath.replace(/\\/g, "/");
    if (posixSafePath !== posixGroupPath && !posixSafePath.startsWith(`${posixGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
  }
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
  getDefaultLanguageConfig(langId, settings) {
    if (!langId) return null;
    const normalized = langId.toLowerCase().trim();
    const custom = settings.customLanguages.find((c) => {
      const names = [c.name, ...c.aliases.split(",").map((s) => s.trim())].map((n) => n.toLowerCase());
      return names.includes(normalized);
    });
    if (custom) {
      return {
        command: `${custom.executable} ${custom.args}`.trim(),
        extension: custom.extension || ".txt"
      };
    }
    switch (normalized) {
      case "python":
      case "py":
        return {
          command: `${settings.pythonExecutable.trim() || "python3"} {file}`,
          extension: ".py"
        };
      case "javascript":
      case "js":
        return {
          command: `${settings.nodeExecutable.trim() || "node"} {file}`,
          extension: ".js"
        };
      case "typescript":
      case "ts":
        return {
          command: `${settings.typescriptTranspilerExecutable.trim() || "ts-node"} {file}`,
          extension: ".ts"
        };
      case "shell":
      case "sh":
      case "bash":
        return {
          command: `${settings.shellExecutable.trim() || "bash"} {file}`,
          extension: ".sh"
        };
      case "ruby":
      case "rb":
        return {
          command: `${settings.rubyExecutable.trim() || "ruby"} {file}`,
          extension: ".rb"
        };
      case "perl":
      case "pl":
        return {
          command: `${settings.perlExecutable.trim() || "perl"} {file}`,
          extension: ".pl"
        };
      case "lua":
        return {
          command: `${settings.luaExecutable.trim() || "lua"} {file}`,
          extension: ".lua"
        };
      case "php":
        return {
          command: `${settings.phpExecutable.trim() || "php"} {file}`,
          extension: ".php"
        };
      case "go":
        return {
          command: `${settings.goExecutable.trim() || "go"} run {file}`,
          extension: ".go"
        };
      case "haskell":
      case "hs":
        return {
          command: `${settings.haskellExecutable.trim() || "runghc"} {file}`,
          extension: ".hs"
        };
      case "ocaml":
      case "ml":
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml"
        };
    }
    return null;
  }
};
function normalizeExtension(extension) {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function optionalPositiveInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}
function optionalNonNegativeInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}
function optionalSignal(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "string" || !/^SIG[A-Z0-9]+$/.test(value)) {
    throw new Error(`${label} must be a signal name like SIGTERM.`);
  }
  return value;
}
async function sleepWithSignal(durationMs, signal) {
  if (durationMs <= 0 || signal.aborted) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function runtimeLabel(runtime) {
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
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/llvmHighlight.ts
var import_view = require("@codemirror/view");
var LLVM_KEYWORDS = new Map([
  ...mapWords("loom-llvm-keyword-control", [
    "ret",
    "br",
    "switch",
    "indirectbr",
    "invoke",
    "callbr",
    "resume",
    "unreachable",
    "cleanupret",
    "catchret",
    "catchswitch"
  ]),
  ...mapWords("loom-llvm-keyword-declaration", [
    "define",
    "declare",
    "type",
    "global",
    "constant",
    "alias",
    "ifunc",
    "comdat",
    "attributes",
    "section",
    "gc",
    "prefix",
    "prologue",
    "personality",
    "uselistorder",
    "uselistorder_bb",
    "module",
    "asm",
    "source_filename",
    "target"
  ]),
  ...mapWords("loom-llvm-keyword-memory", [
    "alloca",
    "load",
    "store",
    "getelementptr",
    "fence",
    "cmpxchg",
    "atomicrmw",
    "extractvalue",
    "insertvalue",
    "extractelement",
    "insertelement",
    "shufflevector"
  ]),
  ...mapWords("loom-llvm-keyword-arithmetic", [
    "add",
    "sub",
    "mul",
    "udiv",
    "sdiv",
    "urem",
    "srem",
    "shl",
    "lshr",
    "ashr",
    "and",
    "or",
    "xor",
    "fneg",
    "fadd",
    "fsub",
    "fmul",
    "fdiv",
    "frem"
  ]),
  ...mapWords("loom-llvm-keyword-comparison", ["icmp", "fcmp"]),
  ...mapWords("loom-llvm-keyword-cast", [
    "trunc",
    "zext",
    "sext",
    "fptrunc",
    "fpext",
    "fptoui",
    "fptosi",
    "uitofp",
    "sitofp",
    "ptrtoint",
    "inttoptr",
    "bitcast",
    "addrspacecast"
  ]),
  ...mapWords("loom-llvm-keyword-other", ["phi", "select", "freeze", "call", "landingpad", "catchpad", "cleanuppad", "va_arg"]),
  ...mapWords("loom-llvm-keyword-modifier", [
    "private",
    "internal",
    "available_externally",
    "linkonce",
    "weak",
    "common",
    "appending",
    "extern_weak",
    "linkonce_odr",
    "weak_odr",
    "external",
    "default",
    "hidden",
    "protected",
    "dllimport",
    "dllexport",
    "dso_local",
    "dso_preemptable",
    "externally_initialized",
    "thread_local",
    "localdynamic",
    "initialexec",
    "localexec",
    "unnamed_addr",
    "local_unnamed_addr",
    "atomic",
    "unordered",
    "monotonic",
    "acquire",
    "release",
    "acq_rel",
    "seq_cst",
    "syncscope",
    "volatile",
    "singlethread",
    "ccc",
    "fastcc",
    "coldcc",
    "webkit_jscc",
    "anyregcc",
    "preserve_mostcc",
    "preserve_allcc",
    "cxx_fast_tlscc",
    "swiftcc",
    "tailcc",
    "cfguard_checkcc",
    "tail",
    "musttail",
    "notail",
    "fast",
    "nnan",
    "ninf",
    "nsz",
    "arcp",
    "contract",
    "afn",
    "reassoc",
    "nuw",
    "nsw",
    "exact",
    "inbounds",
    "to",
    "x"
  ]),
  ...mapWords("loom-llvm-predicate", [
    "eq",
    "ne",
    "ugt",
    "uge",
    "ult",
    "ule",
    "sgt",
    "sge",
    "slt",
    "sle",
    "oeq",
    "ogt",
    "oge",
    "olt",
    "ole",
    "one",
    "ord",
    "ueq",
    "une",
    "uno"
  ]),
  ...mapWords("loom-llvm-attribute", [
    "alwaysinline",
    "argmemonly",
    "builtin",
    "byref",
    "byval",
    "cold",
    "convergent",
    "dereferenceable",
    "dereferenceable_or_null",
    "distinct",
    "immarg",
    "inalloca",
    "inreg",
    "mustprogress",
    "nest",
    "noalias",
    "nocallback",
    "nocapture",
    "nofree",
    "noinline",
    "nonlazybind",
    "nonnull",
    "norecurse",
    "noredzone",
    "noreturn",
    "nosync",
    "nounwind",
    "null_pointer_is_valid",
    "opaque",
    "optnone",
    "optsize",
    "preallocated",
    "readnone",
    "readonly",
    "returned",
    "returns_twice",
    "sanitize_address",
    "sanitize_hwaddress",
    "sanitize_memory",
    "sanitize_thread",
    "signext",
    "speculatable",
    "sret",
    "ssp",
    "sspreq",
    "sspstrong",
    "swiftasync",
    "swiftself",
    "swifterror",
    "uwtable",
    "willreturn",
    "writeonly",
    "zeroext"
  ]),
  ...mapWords("loom-llvm-constant", ["true", "false", "null", "none", "undef", "poison", "zeroinitializer"])
]);
var LLVM_PRIMITIVE_TYPES = /* @__PURE__ */ new Set([
  "void",
  "label",
  "token",
  "metadata",
  "x86_mmx",
  "x86_amx",
  "half",
  "bfloat",
  "float",
  "double",
  "fp128",
  "x86_fp80",
  "ppc_fp128",
  "ptr"
]);
var PUNCTUATION_CLASS = "loom-llvm-punctuation";
function highlightLlvmElement(codeElement, source) {
  codeElement.empty();
  codeElement.addClass("loom-llvm-code");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    appendHighlightedLine(codeElement, line);
    if (index < lines.length - 1) {
      codeElement.appendText("\n");
    }
  });
}
function addLlvmDecorations(builder, view, block) {
  const contentLineCount = getContentLineCount(block);
  if (!contentLineCount) {
    return;
  }
  const lines = block.content.split("\n");
  for (let index = 0; index < contentLineCount; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLlvmLine(line);
    if (!tokens.length) {
      continue;
    }
    const docLine = view.state.doc.line(block.startLine + 2 + index);
    for (const token of tokens) {
      if (token.from === token.to) {
        continue;
      }
      builder.add(
        docLine.from + token.from,
        docLine.from + token.to,
        import_view.Decoration.mark({ class: token.className })
      );
    }
  }
}
function appendHighlightedLine(container, line) {
  let cursor = 0;
  for (const token of tokenizeLlvmLine(line)) {
    if (token.from > cursor) {
      container.appendText(line.slice(cursor, token.from));
    }
    const span = container.createSpan({ cls: token.className });
    span.setText(line.slice(token.from, token.to));
    cursor = token.to;
  }
  if (cursor < line.length) {
    container.appendText(line.slice(cursor));
  }
}
function tokenizeLlvmLine(line) {
  const tokens = [];
  let index = 0;
  addLabelToken(line, tokens);
  while (index < line.length) {
    const current = line[index];
    if (current === ";") {
      tokens.push({ from: index, to: line.length, className: "loom-llvm-comment" });
      break;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    const stringToken = readStringToken(line, index);
    if (stringToken) {
      if (stringToken.prefixEnd > index) {
        tokens.push({ from: index, to: stringToken.prefixEnd, className: "loom-llvm-string-prefix" });
      }
      tokens.push({ from: stringToken.valueStart, to: stringToken.valueEnd, className: "loom-llvm-string" });
      index = stringToken.valueEnd;
      continue;
    }
    const matched = matchRegexToken(line, index, /@llvm\.[A-Za-z$._0-9]+/y, "loom-llvm-intrinsic", tokens) || matchRegexToken(line, index, /@[A-Za-z$._-][A-Za-z$._0-9-]*|@\d+\b/y, "loom-llvm-global", tokens) || matchRegexToken(line, index, /%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+\b/y, "loom-llvm-local", tokens) || matchRegexToken(line, index, /![A-Za-z$._-][A-Za-z$._0-9-]*|!\d+\b/y, "loom-llvm-metadata", tokens) || matchRegexToken(line, index, /\$[A-Za-z$._-][A-Za-z$._0-9-]*/y, "loom-llvm-comdat", tokens) || matchRegexToken(line, index, /#\d+\b/y, "loom-llvm-attribute-group", tokens) || matchRegexToken(line, index, /\baddrspace\s*\(\s*\d+\s*\)/y, "loom-llvm-type", tokens) || matchRegexToken(line, index, /[-+]?0x[0-9A-Fa-f]+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?\d+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /\.\.\./y, "loom-llvm-punctuation", tokens);
    if (matched) {
      index = matched;
      continue;
    }
    const word = readWord(line, index);
    if (word) {
      tokens.push({
        from: index,
        to: word.end,
        className: classifyWord(word.value)
      });
      index = word.end;
      continue;
    }
    if ("()[]{}<>,:=*".includes(current)) {
      tokens.push({ from: index, to: index + 1, className: PUNCTUATION_CLASS });
      index += 1;
      continue;
    }
    index += 1;
  }
  return normalizeTokens(tokens);
}
function addLabelToken(line, tokens) {
  const match = line.match(/^(\s*)(?:([A-Za-z$._-][A-Za-z$._0-9-]*|\d+)|(%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+))(:)/);
  if (!match || match.index == null) {
    return;
  }
  const labelStart = match[1].length;
  const labelText = match[2] ?? match[3];
  if (!labelText) {
    return;
  }
  tokens.push({
    from: labelStart,
    to: labelStart + labelText.length,
    className: "loom-llvm-label"
  });
  tokens.push({
    from: labelStart + labelText.length,
    to: labelStart + labelText.length + 1,
    className: PUNCTUATION_CLASS
  });
}
function classifyWord(word) {
  if (/^i\d+$/.test(word) || LLVM_PRIMITIVE_TYPES.has(word)) {
    return "loom-llvm-type";
  }
  return LLVM_KEYWORDS.get(word) ?? "loom-llvm-plain";
}
function readWord(line, index) {
  const match = /[A-Za-z_][A-Za-z0-9_.-]*/y;
  match.lastIndex = index;
  const result = match.exec(line);
  if (!result) {
    return null;
  }
  return {
    value: result[0],
    end: match.lastIndex
  };
}
function readStringToken(line, index) {
  let cursor = index;
  if (line[cursor] === "c" && line[cursor + 1] === '"') {
    cursor += 1;
  }
  if (line[cursor] !== '"') {
    return null;
  }
  const valueStart = cursor;
  cursor += 1;
  while (cursor < line.length) {
    if (line[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"') {
      cursor += 1;
      break;
    }
    cursor += 1;
  }
  return {
    prefixEnd: valueStart,
    valueStart,
    valueEnd: cursor
  };
}
function matchRegexToken(line, index, regex, className, tokens) {
  regex.lastIndex = index;
  const match = regex.exec(line);
  if (!match) {
    return null;
  }
  tokens.push({ from: index, to: regex.lastIndex, className });
  return regex.lastIndex;
}
function normalizeTokens(tokens) {
  tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.to <= cursor) {
      continue;
    }
    const from = Math.max(token.from, cursor);
    normalized.push({ ...token, from });
    cursor = token.to;
  }
  return normalized;
}
function getContentLineCount(block) {
  if (block.endLine === block.startLine) {
    return 0;
  }
  if (block.content.length === 0) {
    return block.endLine > block.startLine + 1 ? 1 : 0;
  }
  return block.content.split("\n").length;
}
function mapWords(className, words) {
  return words.map((word) => [word, className]);
}

// src/utils/hash.ts
var import_crypto = require("crypto");
function shortHash(input) {
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}

// src/parser.ts
var LANGUAGE_ALIASES = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  ocaml: "ocaml",
  ml: "ocaml",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ruby: "ruby",
  rb: "ruby",
  perl: "perl",
  pl: "perl",
  lua: "lua",
  php: "php",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  haskell: "haskell",
  hs: "haskell",
  java: "java",
  llvm: "llvm-ir",
  llvmir: "llvm-ir",
  "llvm-ir": "llvm-ir",
  ll: "llvm-ir",
  lean: "lean",
  lean4: "lean",
  coq: "coq",
  v: "coq",
  smt: "smtlib",
  smt2: "smtlib",
  smtlib: "smtlib",
  "smt-lib": "smtlib",
  z3: "smtlib"
};
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?.*$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  for (const language of settings?.customLanguages ?? []) {
    const name = language.name.trim().toLowerCase();
    const aliases = parseAliasList(language.aliases);
    if (name && (name === normalized || aliases.includes(normalized))) {
      return language.name.trim();
    }
  }
  return LANGUAGE_ALIASES[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  return [
    ...Object.keys(LANGUAGE_ALIASES),
    ...(settings?.customLanguages ?? []).flatMap((language) => [language.name, ...parseAliasList(language.aliases)])
  ].map((alias) => alias.toLowerCase());
}
function parseMarkdownCodeBlocks(filePath, source, settings) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let ordinal = 0;
  let insideManagedOutput = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (insideManagedOutput) {
      if (OUTPUT_END.test(line.trim())) {
        insideManagedOutput = false;
      }
      continue;
    }
    if (OUTPUT_START.test(line.trim())) {
      insideManagedOutput = true;
      continue;
    }
    const fenceMatch = line.match(FENCE_START);
    if (!fenceMatch) {
      continue;
    }
    const startLine = i;
    const fenceIndent = getLeadingWhitespace2(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const language = normalizeLanguage(sourceLanguage, settings);
    let endLine = i;
    const contentLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const innerLine = lines[j];
      const trimmed = innerLine.trim();
      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        endLine = j;
        i = j;
        break;
      }
      contentLines.push(stripFenceIndent(innerLine, fenceIndent));
      endLine = j;
    }
    if (!language) {
      continue;
    }
    ordinal += 1;
    const content = contentLines.join("\n");
    const contentHash = shortHash(content);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function findBlockAtLine(blocks, line) {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}
function getLeadingWhitespace2(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function stripFenceIndent(line, fenceIndent) {
  if (!fenceIndent) {
    return line;
  }
  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }
  return line.slice(index);
}

// src/runners/node.ts
var NodeRunner = class {
  constructor() {
    this.id = "node";
    this.displayName = "Node.js";
    this.languages = ["javascript", "typescript"];
  }
  canRun(block, settings) {
    if (block.language === "javascript") {
      return Boolean(settings.nodeExecutable.trim());
    }
    return Boolean(settings.typescriptTranspilerExecutable.trim());
  }
  async run(block, context, settings) {
    if (block.language === "javascript") {
      return runTempFileProcess({
        runnerId: this.id,
        runnerName: this.displayName,
        executable: settings.nodeExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".js",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    const executable = settings.typescriptTranspilerExecutable.trim();
    const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";
    return runTempFileProcess({
      runnerId: `${this.id}:${settings.typescriptMode}`,
      runnerName,
      executable,
      args: ["{file}"],
      fileExtension: ".ts",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/custom.ts
var CustomLanguageRunner = class {
  constructor() {
    this.id = "custom";
    this.displayName = "Custom language";
    this.languages = [];
  }
  canRun(block, settings) {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }
  run(block, context, settings) {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension2(language.extension, language.name),
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  getCustomLanguage(block, settings) {
    const normalized = block.language.trim().toLowerCase();
    return settings.customLanguages.find((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
  }
};
function normalizeExtension2(extension, name) {
  const trimmed = extension.trim();
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

// src/runners/interpreted.ts
var INTERPRETED_SPECS = [
  {
    language: "shell",
    displayName: "Shell",
    executable: (settings) => settings.shellExecutable,
    fileExtension: ".sh"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    executable: (settings) => settings.rubyExecutable,
    fileExtension: ".rb"
  },
  {
    language: "perl",
    displayName: "Perl",
    executable: (settings) => settings.perlExecutable,
    fileExtension: ".pl"
  },
  {
    language: "lua",
    displayName: "Lua",
    executable: (settings) => settings.luaExecutable,
    fileExtension: ".lua"
  },
  {
    language: "php",
    displayName: "PHP",
    executable: (settings) => settings.phpExecutable,
    fileExtension: ".php"
  },
  {
    language: "go",
    displayName: "Go",
    executable: (settings) => settings.goExecutable,
    fileExtension: ".go",
    args: ["run", "{file}"],
    env: {
      GOCACHE: "{tempDir}/gocache"
    },
    minimumTimeoutMs: 3e4
  },
  {
    language: "haskell",
    displayName: "Haskell",
    executable: (settings) => settings.haskellExecutable,
    fileExtension: ".hs",
    minimumTimeoutMs: 3e4
  }
];
var InterpretedRunner = class {
  constructor() {
    this.id = "interpreted";
    this.displayName = "Interpreted";
    this.languages = INTERPRETED_SPECS.map((spec) => spec.language);
  }
  canRun(block, settings) {
    const spec = this.getSpec(block.language);
    return Boolean(spec?.executable(settings).trim());
  }
  run(block, context, settings) {
    const spec = this.getSpec(block.language);
    if (!spec) {
      throw new Error(`Unsupported language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${block.language}`,
      runnerName: spec.displayName,
      executable: spec.executable(settings).trim(),
      args: spec.args ?? ["{file}"],
      fileExtension: spec.fileExtension,
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, spec.minimumTimeoutMs ?? 0),
      signal: context.signal,
      env: spec.env
    });
  }
  getSpec(language) {
    return INTERPRETED_SPECS.find((spec) => spec.language === language);
  }
};

// src/runners/llvm.ts
var LlvmRunner = class {
  constructor() {
    this.id = "llvm-ir";
    this.displayName = "LLVM IR";
    this.languages = ["llvm-ir"];
  }
  canRun(block, settings) {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }
  async run(block, context, settings) {
    const result = await runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (!result.timedOut && !result.cancelled && result.exitCode != null && !result.stderr.trim()) {
      if (result.exitCode !== 0) {
        result.success = true;
        result.warning = `Program returned i32 ${result.exitCode}. Under lli, that becomes the process exit status.`;
      }
      if (!result.stdout.trim()) {
        result.stdout = result.exitCode === 0 ? "LLVM program exited with code 0." : `LLVM program returned i32 ${result.exitCode}.
Use stdout in the IR itself if you want printable program output.`;
      }
    }
    return result;
  }
};

// src/runners/managedCompiled.ts
var import_path3 = require("path");
var ManagedCompiledRunner = class {
  constructor() {
    this.id = "managed-compiled";
    this.displayName = "Managed compiler";
    this.languages = ["rust", "java"];
  }
  canRun(block, settings) {
    if (block.language === "rust") {
      return Boolean(settings.rustExecutable.trim());
    }
    if (block.language === "java") {
      return Boolean(settings.javaExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "rust") {
      return this.runRust(block, context, settings);
    }
    if (block.language === "java") {
      return this.runJava(block, context, settings);
    }
    throw new Error(`Unsupported language: ${block.language}`);
  }
  async runRust(block, context, settings) {
    return withTempSourceFile(".rs", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path3.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:rust:compile`,
        runnerName: "Rust",
        executable: settings.rustExecutable.trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:rust:run`,
        runnerName: "Rust",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
  async runJava(block, context, settings) {
    return withNamedTempSourceFile("Main.java", block.content, async ({ tempDir, tempFile }) => {
      if (!settings.javaCompilerExecutable.trim()) {
        return runProcess({
          runnerId: `${this.id}:java:source`,
          runnerName: "Java",
          executable: settings.javaExecutable.trim(),
          args: [tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal
        });
      }
      const compileResult = await runProcess({
        runnerId: `${this.id}:java:compile`,
        runnerName: "Java",
        executable: settings.javaCompilerExecutable.trim(),
        args: [tempFile],
        workingDirectory: tempDir,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:java:run`,
        runnerName: "Java",
        executable: settings.javaExecutable.trim(),
        args: ["-cp", tempDir, "Main"],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/nativeCompiled.ts
var import_path4 = require("path");
var NativeCompiledRunner = class {
  constructor() {
    this.id = "native-compiled";
    this.displayName = "Native compiler";
    this.languages = ["c", "cpp"];
  }
  canRun(block, settings) {
    if (block.language === "c") {
      return Boolean(settings.cExecutable.trim());
    }
    if (block.language === "cpp") {
      return Boolean(settings.cppExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    const executable = block.language === "c" ? settings.cExecutable.trim() : settings.cppExecutable.trim();
    const fileExtension = block.language === "c" ? ".c" : ".cpp";
    const runnerName = block.language === "c" ? "C (GCC)" : "C++ (G++)";
    return withTempSourceFile(fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path4.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${block.language}:compile`,
        runnerName,
        executable,
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:${block.language}:run`,
        runnerName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/ocaml.ts
var import_path5 = require("path");
var OcamlRunner = class {
  constructor() {
    this.id = "ocaml";
    this.displayName = "OCaml";
    this.languages = ["ocaml"];
  }
  canRun(block, settings) {
    return block.language === "ocaml" && Boolean(settings.ocamlExecutable.trim());
  }
  async run(block, context, settings) {
    const mode = settings.ocamlMode;
    const executable = settings.ocamlExecutable.trim();
    if (mode === "ocaml") {
      return runTempFileProcess({
        runnerId: `${this.id}:ocaml`,
        runnerName: "OCaml",
        executable,
        args: ["{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    if (mode === "dune") {
      return runTempFileProcess({
        runnerId: `${this.id}:dune`,
        runnerName: "Dune / OCaml",
        executable,
        args: ["exec", "--", "ocaml", "{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    return withTempSourceFile(".ml", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:ocamlc-compile`,
        runnerName: "OCamlc",
        executable,
        args: ["-o", binaryPath, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:ocamlc-run`,
        runnerName: "OCamlc",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    });
  }
};

// src/runners/python.ts
var PythonRunner = class {
  constructor() {
    this.id = "python";
    this.displayName = "Python";
    this.languages = ["python"];
  }
  canRun(block, settings) {
    return block.language === "python" && Boolean(settings.pythonExecutable.trim());
  }
  run(block, context, settings) {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.pythonExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".py",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/proof.ts
var import_fs2 = require("fs");
var import_path6 = require("path");
var ProofRunner = class {
  constructor() {
    this.id = "proof";
    this.displayName = "Proof checker";
    this.languages = ["lean", "coq", "smtlib"];
  }
  canRun(block, settings) {
    if (block.language === "lean") {
      return Boolean(settings.leanExecutable.trim());
    }
    if (block.language === "coq") {
      return Boolean(resolveCoqExecutable(settings).trim());
    }
    if (block.language === "smtlib") {
      return Boolean(settings.smtExecutable.trim());
    }
    return false;
  }
  run(block, context, settings) {
    if (block.language === "lean") {
      return runTempFileProcess({
        runnerId: `${this.id}:lean`,
        runnerName: "Lean",
        executable: settings.leanExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".lean",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "coq") {
      return runTempFileProcess({
        runnerId: `${this.id}:coq`,
        runnerName: "Coq",
        executable: resolveCoqExecutable(settings),
        args: ["-q", "{file}"],
        fileExtension: ".v",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "smtlib") {
      return runTempFileProcess({
        runnerId: `${this.id}:smtlib`,
        runnerName: "SMT-LIB (Z3)",
        executable: settings.smtExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".smt2",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    throw new Error(`Unsupported proof language: ${block.language}`);
  }
};
function resolveCoqExecutable(settings) {
  const configured = settings.coqExecutable.trim();
  if (configured && configured !== "coqc") {
    return configured;
  }
  const opamCoqc = (0, import_path6.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8e3,
  workingDirectory: "",
  pythonExecutable: "python3",
  nodeExecutable: "node",
  typescriptMode: "ts-node",
  typescriptTranspilerExecutable: "ts-node",
  ocamlMode: "ocaml",
  ocamlExecutable: "ocaml",
  cExecutable: "gcc",
  cppExecutable: "g++",
  shellExecutable: "bash",
  rubyExecutable: "ruby",
  perlExecutable: "perl",
  luaExecutable: "lua",
  phpExecutable: "php",
  goExecutable: "go",
  rustExecutable: "rustc",
  haskellExecutable: "runghc",
  javaCompilerExecutable: "",
  javaExecutable: "java",
  llvmInterpreterExecutable: "lli",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  autoRunOnFileOpen: false,
  customLanguages: [],
  pdfExportMode: "both",
  defaultContainerGroup: ""
};
var loomSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(loomPlugin2) {
    super(loomPlugin2.app, loomPlugin2);
    this.loomPlugin = loomPlugin2;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }
  createSection(containerEl, title, open = false) {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }
  renderGeneralSettings(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
        this.loomPlugin.settings.preserveSourceMode = value;
        await this.loomPlugin.saveSettings();
        if (value) {
          void this.loomPlugin.enforceSourceModeForActiveView();
        } else {
          void this.loomPlugin.disableSourceModeForActiveView();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    new import_obsidian2.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
      (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
        this.loomPlugin.settings.typescriptMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    new import_obsidian2.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
      (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
        this.loomPlugin.settings.ocamlMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    this.addTextSetting(containerEl, "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addTextSetting(containerEl, "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addTextSetting(containerEl, "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addTextSetting(containerEl, "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addTextSetting(containerEl, "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addTextSetting(containerEl, "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addTextSetting(containerEl, "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addTextSetting(containerEl, "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addTextSetting(containerEl, "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addTextSetting(containerEl, "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
    this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    this.addTextSetting(containerEl, "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    this.addTextSetting(containerEl, "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addTextSetting(containerEl, "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addTextSetting(containerEl, "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian2.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt"
        });
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  renderCustomLanguageList(containerEl) {
    containerEl.empty();
    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description"
      });
      return;
    }
    this.loomPlugin.settings.customLanguages.forEach((language, index) => {
      const details = containerEl.createEl("details", { cls: "loom-custom-language" });
      details.open = true;
      details.createEl("summary", { text: language.name || `Custom language ${index + 1}` });
      const body = details.createDiv({ cls: "loom-custom-language-body" });
      this.addCustomLanguageTextSetting(body, language, "Name", "Normalized language id used by loom.", "name");
      this.addCustomLanguageTextSetting(body, language, "Aliases", "Comma-separated fence aliases.", "aliases");
      this.addCustomLanguageTextSetting(body, language, "Executable", "Local command or absolute executable path.", "executable");
      this.addCustomLanguageTextSetting(body, language, "Arguments", "Space-separated arguments. Use {file} for the temp source file.", "args");
      this.addCustomLanguageTextSetting(body, language, "Extension", "Temp source file extension, for example .py.", "extension");
      new import_obsidian2.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
        (button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.loomPlugin.settings.customLanguages.splice(index, 1);
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
    });
  }
  async renderContainerGroups(containerEl) {
    try {
      const groups = await this.loomPlugin.getContainerGroupSummaries();
      new import_obsidian2.Setting(containerEl).setName("Default containerization group").setDesc("The container group to run code blocks in by default if the note does not specify one.").addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const group of groups) {
          dropdown.addOption(group.name, group.name);
        }
        dropdown.setValue(this.loomPlugin.settings.defaultContainerGroup || "");
        dropdown.onChange(async (value) => {
          this.loomPlugin.settings.defaultContainerGroup = value;
          await this.loomPlugin.saveSettings();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Add new containerization group").setDesc("Create a new containerization group configuration folder.").addButton(
        (button) => button.setButtonText("+").onClick(() => {
          new ContainerGroupNameModal(this.app, async (groupName) => {
            const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!cleanName) {
              new import_obsidian2.Notice("Invalid group name.");
              return;
            }
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
            const configPath = `${groupRelativePath}/config.json`;
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(groupRelativePath)) {
              new import_obsidian2.Notice("Container group folder already exists.");
              return;
            }
            await adapter.mkdir(groupRelativePath);
            const defaultConfig = {
              runtime: "docker",
              image: "ubuntu:latest",
              languages: {
                python: {
                  command: "python3 {file}",
                  extension: ".py"
                }
              }
            };
            await adapter.write(configPath, JSON.stringify(defaultConfig, null, 2));
            new import_obsidian2.Notice(`Container group "${cleanName}" created.`);
            this.display();
          }).open();
        })
      );
      const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
      if (!groups.length) {
        listEl.createEl("p", {
          text: "No container groups found in .obsidian/plugins/loom/containers.",
          cls: "setting-item-description"
        });
        return;
      }
      for (const group of groups) {
        new import_obsidian2.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
          (button) => button.setButtonText("Build / rebuild").onClick(async () => {
            await this.loomPlugin.buildContainerGroup(group.name);
          })
        ).addButton(
          (button) => button.setButtonText("Edit").onClick(() => {
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            new EditContainerGroupModal(this.loomPlugin, group.name, pluginDir, () => {
              this.display();
            }).open();
          })
        );
      }
    } catch (error) {
      containerEl.empty();
      containerEl.createEl("p", {
        text: `Error loading container groups: ${error instanceof Error ? error.message : String(error)}`,
        cls: "loom-settings-error",
        attr: { style: "color: var(--text-error); font-weight: bold; margin: 1em 0;" }
      });
      console.error("loom: failed to render container groups:", error);
    }
  }
  addTextSetting(containerEl, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(language[key]).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian2.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
var ContainerGroupNameModal = class extends import_obsidian2.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.name = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });
    new import_obsidian2.Setting(contentEl).setName("Group Name").setDesc("Use lowercase letters, numbers, hyphens, and underscores.").addText(
      (text) => text.onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian2.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(async () => {
        await this.onSubmit(this.name);
        this.close();
      })
    );
  }
};
var EditContainerGroupModal = class extends import_obsidian2.Modal {
  constructor(loomPlugin2, groupName, pluginDir, onSave) {
    super(loomPlugin2.app);
    this.loomPlugin = loomPlugin2;
    this.groupName = groupName;
    this.pluginDir = pluginDir;
    this.onSave = onSave;
    this.activeTab = "general";
    this.configObj = {};
    this.rawJsonText = "";
    this.dockerfileText = null;
    this.newLanguageName = "";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Edit Config: ${this.groupName}` });
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    const adapter = this.app.vault.adapter;
    try {
      const rawConfig = await adapter.read(configPath);
      this.configObj = JSON.parse(rawConfig);
      this.rawJsonText = rawConfig;
    } catch (e) {
      new import_obsidian2.Notice("Could not read configuration file.");
      this.close();
      return;
    }
    try {
      if (await adapter.exists(dockerfilePath)) {
        this.dockerfileText = await adapter.read(dockerfilePath);
      } else {
        this.dockerfileText = null;
      }
    } catch (e) {
      this.dockerfileText = null;
    }
    const container = contentEl.createDiv({ cls: "loom-tab-container" });
    this.tabHeaderEl = container.createDiv({ cls: "loom-tab-header" });
    this.renderTabs();
    this.tabContentEl = container.createDiv({ cls: "loom-tab-content" });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.saveAndClose();
    });
    this.renderActiveTab();
  }
  renderTabs() {
    this.tabHeaderEl.empty();
    const tabs = [
      { id: "general", label: "General" },
      { id: "languages", label: "Languages" },
      { id: "dockerfile", label: "Dockerfile" },
      { id: "raw", label: "Raw JSON" }
    ];
    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        text: tab.label,
        cls: "loom-tab-btn" + (this.activeTab === tab.id ? " is-active" : "")
      });
      btn.addEventListener("click", () => {
        void this.switchTab(tab.id);
      });
    }
  }
  async switchTab(tab) {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian2.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
        return;
      }
    }
    this.activeTab = tab;
    this.renderTabs();
    this.renderActiveTab();
  }
  renderActiveTab() {
    this.tabContentEl.empty();
    if (this.activeTab === "general") {
      this.renderGeneralTab(this.tabContentEl);
    } else if (this.activeTab === "languages") {
      this.renderLanguagesTab(this.tabContentEl);
    } else if (this.activeTab === "dockerfile") {
      this.renderDockerfileTab(this.tabContentEl);
    } else if (this.activeTab === "raw") {
      this.renderRawTab(this.tabContentEl);
    }
  }
  renderGeneralTab(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Runtime").setDesc("Choose the container/environment manager runtime.").addDropdown((dropdown) => {
      dropdown.addOption("docker", "Docker").addOption("podman", "Podman").addOption("wsl", "WSL").addOption("qemu", "QEMU").addOption("custom", "Custom").setValue(this.configObj.runtime || "docker").onChange((value) => {
        this.configObj.runtime = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman" || this.configObj.runtime === "wsl") {
      new import_obsidian2.Setting(containerEl).setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image").setDesc(
        this.configObj.runtime === "wsl" ? "Optional. The target WSL distro name (leave empty for default distro)." : "Fallback Docker/Podman image if no Dockerfile is present."
      ).addText((text) => {
        text.setValue(this.configObj.image || "").onChange((val) => {
          this.configObj.image = val.trim();
        });
      });
    }
    if (this.configObj.runtime === "wsl") {
      if (!this.configObj.wsl) {
        this.configObj.wsl = {};
      }
      new import_obsidian2.Setting(containerEl).setName("Use Interactive Shell").setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).").addToggle((toggle) => {
        toggle.setValue(this.configObj.wsl.interactive ?? false).onChange((val) => {
          this.configObj.wsl.interactive = val;
        });
      });
    }
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }
      new import_obsidian2.Setting(containerEl).setName("SSH Target").setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).").addText((text) => {
        text.setValue(this.configObj.qemu.sshTarget || "").onChange((val) => {
          this.configObj.qemu.sshTarget = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Remote Workspace").setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).").addText((text) => {
        text.setValue(this.configObj.qemu.remoteWorkspace || "").onChange((val) => {
          this.configObj.qemu.remoteWorkspace = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("SSH Executable").setDesc("Optional. Path to SSH client executable (defaults to ssh).").addText((text) => {
        text.setValue(this.configObj.qemu.sshExecutable || "").onChange((val) => {
          this.configObj.qemu.sshExecutable = val.trim() || void 0;
        });
      });
      new import_obsidian2.Setting(containerEl).setName("SSH Arguments").setDesc("Optional. Additional SSH CLI flags.").addText((text) => {
        text.setValue(this.configObj.qemu.sshArgs || "").onChange((val) => {
          this.configObj.qemu.sshArgs = val.trim() || void 0;
        });
      });
    }
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }
      new import_obsidian2.Setting(containerEl).setName("Custom Executable").setDesc("Path to custom runtime wrapper executable or script.").addText((text) => {
        text.setValue(this.configObj.custom.executable || "").onChange((val) => {
          this.configObj.custom.executable = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Custom Arguments").setDesc("Optional. Command arguments. Use {request} for JSON config path.").addText((text) => {
        text.setValue(this.configObj.custom.args || "").onChange((val) => {
          this.configObj.custom.args = val.trim() || void 0;
        });
      });
    }
  }
  renderLanguagesTab(containerEl) {
    containerEl.createEl("h3", { text: "Configured Languages" });
    if (!this.configObj.languages) {
      this.configObj.languages = {};
    }
    const langsListEl = containerEl.createDiv({ cls: "loom-languages-list" });
    const languages = Object.entries(this.configObj.languages);
    if (languages.length === 0) {
      langsListEl.createEl("p", { text: "No languages configured for this group.", cls: "setting-item-description" });
    } else {
      for (const [langName, langConfig] of languages) {
        const card = langsListEl.createDiv({ cls: "loom-language-card" });
        card.createEl("strong", { text: langName, attr: { style: "display: block; margin-bottom: 0.5rem; font-size: 1.1em;" } });
        const isDefault = langConfig.useDefault === true;
        new import_obsidian2.Setting(card).setName("Use default configuration").setDesc("If checked, Loom will run this language using its built-in commands/extensions.").addToggle((toggle) => {
          toggle.setValue(isDefault).onChange((val) => {
            if (val) {
              langConfig.useDefault = true;
              delete langConfig.command;
              delete langConfig.extension;
            } else {
              delete langConfig.useDefault;
              const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
              langConfig.command = defaults?.command || "";
              langConfig.extension = defaults?.extension || "";
            }
            this.renderActiveTab();
          });
        });
        new import_obsidian2.Setting(card).setName("Command").setDesc("Execution command. Use {file} for the code snippet filename.").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.command || "").setValue(langConfig.command || "").setDisabled(isDefault).onChange((val) => {
            langConfig.command = val.trim();
          });
        });
        new import_obsidian2.Setting(card).setName("Extension").setDesc("Source file extension (e.g. .py, .js).").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.extension || "").setValue(langConfig.extension || "").setDisabled(isDefault).onChange((val) => {
            langConfig.extension = val.trim();
          });
        });
        new import_obsidian2.Setting(card).addButton((btn) => {
          btn.setButtonText("Remove Language").setWarning().onClick(() => {
            delete this.configObj.languages[langName];
            this.renderActiveTab();
          });
        });
      }
    }
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new import_obsidian2.Setting(containerEl).setName("Language ID").setDesc("e.g. python, javascript, node, sh").addText((text) => {
      text.setValue(this.newLanguageName).onChange((val) => {
        this.newLanguageName = val.trim().toLowerCase();
      });
    }).addButton((btn) => {
      btn.setButtonText("+ Add").setCta().onClick(() => {
        if (!this.newLanguageName) {
          new import_obsidian2.Notice("Please enter a language name.");
          return;
        }
        if (this.configObj.languages[this.newLanguageName]) {
          new import_obsidian2.Notice("Language already configured.");
          return;
        }
        this.configObj.languages[this.newLanguageName] = {
          command: `${this.newLanguageName} {file}`,
          extension: `.${this.newLanguageName}`
        };
        this.newLanguageName = "";
        this.renderActiveTab();
      });
    });
  }
  renderDockerfileTab(containerEl) {
    if (this.configObj.runtime !== "docker" && this.configObj.runtime !== "podman") {
      containerEl.createEl("p", {
        text: `Dockerfile editing is only available for Docker and Podman runtimes. Currently using: ${this.configObj.runtime}`,
        cls: "setting-item-description"
      });
      return;
    }
    if (this.dockerfileText === null) {
      containerEl.createEl("p", {
        text: "No Dockerfile exists in this container group directory.",
        cls: "setting-item-description"
      });
      new import_obsidian2.Setting(containerEl).addButton((btn) => {
        btn.setButtonText("Create Dockerfile").setCta().onClick(() => {
          this.dockerfileText = [
            "FROM ubuntu:latest",
            "",
            "# Install packages",
            "RUN apt-get update && apt-get install -y \\",
            "    python3 \\",
            "    nodejs \\",
            "    && rm -rf /var/lib/apt/lists/*",
            ""
          ].join("\n");
          this.renderActiveTab();
        });
      });
    } else {
      new import_obsidian2.Setting(containerEl).setName("Dockerfile Content").setDesc("Define the build steps for your environment container.").addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.width = "100%";
        text.setValue(this.dockerfileText || "");
        text.onChange((val) => {
          this.dockerfileText = val;
        });
      });
    }
  }
  renderRawTab(containerEl) {
    this.rawJsonText = JSON.stringify(this.configObj, null, 2);
    new import_obsidian2.Setting(containerEl).setName("Configuration JSON").addTextArea((text) => {
      text.inputEl.rows = 15;
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.width = "100%";
      text.setValue(this.rawJsonText);
      text.onChange((val) => {
        this.rawJsonText = val;
      });
    });
  }
  async saveAndClose() {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian2.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }
    if (!this.configObj.runtime) {
      new import_obsidian2.Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new import_obsidian2.Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new import_obsidian2.Notice("Custom runtime requires Custom Executable.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    try {
      const configStr = JSON.stringify(this.configObj, null, 2);
      await adapter.write(configPath, configStr);
      if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman") {
        if (this.dockerfileText !== null) {
          await adapter.write(dockerfilePath, this.dockerfileText);
        }
      }
      new import_obsidian2.Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new import_obsidian2.Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

// src/ui/codeBlockToolbar.ts
var import_obsidian3 = require("obsidian");
function createCodeBlockToolbar(blockId, isRunning, handlers) {
  const toolbar = document.createElement("div");
  toolbar.className = "loom-code-toolbar";
  toolbar.dataset.loomBlockId = blockId;
  toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
  toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
  toolbar.appendChild(createButton("Remove snippet", "trash-2", handlers.onRemove, false));
  toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));
  return toolbar;
}
function createButton(label, iconName, onClick, spinning) {
  const button = document.createElement("button");
  button.className = `loom-toolbar-button${spinning ? " is-running" : ""}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  (0, import_obsidian3.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian4 = require("obsidian");
function getStatusKind(output) {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }
  return "failure";
}
function createOutputPanel(output) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output);
  return panel;
}
function renderOutputPanel(panel, output) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian4.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian4.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian5.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Enable loom local execution?" });
    contentEl.createEl("p", {
      text: "loom runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process."
    });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
  }
};
var loomToolbarRenderChild = class extends import_obsidian5.MarkdownRenderChild {
  constructor(containerEl, plugin, block, codeElement) {
    super(containerEl);
    this.plugin = plugin;
    this.block = block;
    this.codeElement = codeElement;
    this.panelContainer = null;
    this.unregisterOutputListener = null;
  }
  onload() {
    this.codeElement.parentElement?.addClass("loom-codeblock-shell");
    this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));
    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("loom-print-hide-code");
    }
    const hostClasses = ["loom-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("loom-print-hide-output");
    }
    this.panelContainer = this.containerEl.createDiv({ cls: hostClasses.join(" ") });
    this.plugin.renderOutputInto(this.block.id, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block.id, this.panelContainer);
      }
    });
  }
  onunload() {
    this.unregisterOutputListener?.();
  }
};
var loomToolbarWidget = class extends import_view2.WidgetType {
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
    this.isRunning = plugin.isBlockRunning(block.id);
  }
  eq(other) {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
  }
  toDOM() {
    return this.plugin.createToolbarElement(this.block);
  }
};
var loomOutputWidget = class extends import_view2.WidgetType {
  constructor(plugin, blockId) {
    super();
    this.plugin = plugin;
    this.blockId = blockId;
  }
  eq(other) {
    return false;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.blockId, wrapper);
    return wrapper;
  }
};
var loomPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.registry = new loomRunnerRegistry([
      new PythonRunner(),
      new NodeRunner(),
      new OcamlRunner(),
      new NativeCompiledRunner(),
      new InterpretedRunner(),
      new ManagedCompiledRunner(),
      new LlvmRunner(),
      new ProofRunner(),
      new CustomLanguageRunner()
    ]);
    // Exposed as public and readonly so the settings panel and modals can access container configurations and default language mapping helpers.
    this.containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
    this.registeredCodeBlockAliases = /* @__PURE__ */ new Set();
    this.outputs = /* @__PURE__ */ new Map();
    this.running = /* @__PURE__ */ new Map();
    this.outputListeners = /* @__PURE__ */ new Map();
    this.editorViews = /* @__PURE__ */ new Set();
    this.lastMarkdownFilePath = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new loomSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });
    this.addCommand({
      id: "loom-run-current-code-block",
      name: "loom: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }
        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new import_obsidian5.Notice("No supported loom block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      }
    });
    this.addCommand({
      id: "loom-run-all-code-blocks",
      name: "loom: Run All Supported Code Blocks in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.runAllBlocksInFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: "loom-clear-note-outputs",
      name: "loom: Clear loom Outputs in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.clearOutputsForFile(file);
        }
        return true;
      }
    });
    this.registerCodeBlockProcessors();
    this.registerEditorExtension(this.createLivePreviewExtension());
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.lastMarkdownFilePath = file?.path ?? this.lastMarkdownFilePath;
        this.refreshAllViews();
        void this.enforceSourceModeForActiveView();
        if (file && this.settings.autoRunOnFileOpen) {
          void this.runAllBlocksInFile(file);
        }
      })
    );
    this.addCommand({
      id: "loom-validate-container-groups",
      name: "loom: Validate Container Groups",
      callback: async () => {
        const groups = await this.getContainerGroupSummaries();
        new import_obsidian5.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
        void this.enforceSourceModeForActiveView();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (ctx instanceof import_obsidian5.MarkdownView) {
          void this.enforceSourceModeForLeaf(ctx.leaf);
        }
      })
    );
  }
  onunload() {
    for (const controller of this.running.values()) {
      controller.abort();
    }
  }
  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
    this.refreshAllViews();
  }
  isBlockRunning(blockId) {
    return this.running.has(blockId);
  }
  registerOutputListener(blockId, listener) {
    if (!this.outputListeners.has(blockId)) {
      this.outputListeners.set(blockId, /* @__PURE__ */ new Set());
    }
    this.outputListeners.get(blockId)?.add(listener);
    return () => {
      this.outputListeners.get(blockId)?.delete(listener);
    };
  }
  createToolbarElement(block) {
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runActiveBlockById(block.id),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          new import_obsidian5.Notice("Code copied");
        } catch {
          new import_obsidian5.Notice("Clipboard write failed.");
        }
      },
      onRemove: () => void this.removeSnippetById(block.id),
      onToggleOutput: () => {
        const output = this.outputs.get(block.id);
        if (!output) {
          return;
        }
        output.visible = !output.visible;
        this.notifyOutputChanged(block.id);
      }
    });
  }
  renderOutputInto(blockId, container) {
    container.empty();
    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }
    if (!output || !output.visible) {
      return;
    }
    container.appendChild(createOutputPanel(output));
  }
  async runActiveBlockById(blockId) {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block);
  }
  async removeSnippetById(blockId) {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    this.running.get(blockId)?.abort();
    this.running.delete(blockId);
    this.outputs.delete(blockId);
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === blockId);
      if (!currentBlock) {
        return content;
      }
      const managedRange = this.findManagedOutputRange(lines, blockId);
      const removalStart = currentBlock.startLine;
      const removalEnd = managedRange ? managedRange.end : currentBlock.endLine;
      lines.splice(removalStart, removalEnd - removalStart + 1);
      while (removalStart < lines.length - 1 && lines[removalStart] === "" && lines[removalStart + 1] === "") {
        lines.splice(removalStart, 1);
      }
      return lines.join("\n");
    });
    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new import_obsidian5.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const containerGroup = this.containerRunner.getContainerGroupName(file) || this.settings.defaultContainerGroup;
    const supportedBlocks = containerGroup ? blocks : blocks.filter((block) => this.registry.getRunnerForBlock(block, this.settings));
    if (!supportedBlocks.length) {
      new import_obsidian5.Notice("No supported loom blocks found in the current note.");
      return;
    }
    for (const block of supportedBlocks) {
      await this.runBlock(file, block);
    }
  }
  async clearOutputsForFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    for (const block of blocks) {
      this.outputs.delete(block.id);
      this.notifyOutputChanged(block.id);
      await this.removeManagedOutputBlock(file.path, block.id);
    }
    new import_obsidian5.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian5.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const workingDirectory = this.resolveWorkingDirectory(file);
    const containerGroup = this.containerRunner.getContainerGroupName(file) || this.settings.defaultContainerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian5.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory,
      timeoutMs: this.settings.defaultTimeoutMs,
      signal: controller.signal
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const result = containerGroup ? await this.containerRunner.run(block, runContext, this.settings, containerGroup) : await runner.run(block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian5.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Container ${containerGroup}` : runner?.displayName ?? "Unknown",
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs: 0,
          exitCode: -1,
          stdout: "",
          stderr: message,
          success: false,
          timedOut: false,
          cancelled: false
        }
      });
      new import_obsidian5.Notice(`loom error: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }
  async ensureExecutionEnabled() {
    if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
      return true;
    }
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const modal = new ExecutionConsentModal(this.app, async () => {
        this.settings.enableLocalExecution = true;
        this.settings.hasAcknowledgedExecutionRisk = true;
        await this.saveSettings();
        settle(true);
      });
      const originalClose = modal.close.bind(modal);
      modal.close = () => {
        originalClose();
        settle(this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk);
      };
      modal.open();
    });
  }
  resolveWorkingDirectory(file) {
    if (this.settings.workingDirectory.trim()) {
      return this.settings.workingDirectory.trim();
    }
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    const fileFolder = (0, import_path7.dirname)(file.path);
    const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
    return resolved || process.cwd();
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian5.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
  }
  registerCodeBlockProcessors() {
    for (const alias of getSupportedLanguageAliases(this.settings)) {
      const normalizedAlias = alias.toLowerCase();
      if (this.registeredCodeBlockAliases.has(normalizedAlias)) {
        continue;
      }
      if (/[^a-zA-Z0-9_-]/.test(normalizedAlias)) {
        continue;
      }
      this.registeredCodeBlockAliases.add(normalizedAlias);
      this.registerMarkdownCodeBlockProcessor(normalizedAlias, async (source, el, ctx) => {
        const filePath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof import_obsidian5.TFile)) {
          return;
        }
        const fullText = await this.app.vault.cachedRead(file);
        const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
        const section = ctx && typeof ctx.getSectionInfo === "function" ? ctx.getSectionInfo(el) : null;
        let block;
        if (section) {
          const lineStart = section.lineStart;
          block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
        } else {
          block = blocks.find((candidate) => candidate.content === source);
        }
        if (!block) {
          return;
        }
        let pre = el.querySelector("pre");
        if (!pre) {
          pre = el.createEl("pre");
          pre.addClass(`language-${normalizedAlias}`);
          const code = pre.createEl("code");
          code.addClass(`language-${normalizedAlias}`);
          code.setText(source);
        }
        if (block.language === "llvm-ir") {
          const code = pre.querySelector("code") ?? pre;
          highlightLlvmElement(code, source);
        }
        ctx.addChild(new loomToolbarRenderChild(el, this, block, pre));
      });
    }
  }
  updateStatusBar() {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `loom: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "loom: Idle");
  }
  notifyOutputChanged(blockId) {
    this.outputListeners.get(blockId)?.forEach((listener) => listener());
    this.refreshAllViews();
  }
  refreshAllViews() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      const previewMode = view.previewMode;
      previewMode?.rerender?.(true);
    });
    for (const editorView of this.editorViews) {
      editorView.dispatch({ effects: loomRefreshEffect.of(void 0) });
    }
  }
  getActiveMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async disableSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view) {
      return;
    }
    const leaf = view.leaf;
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      state.source = false;
      await leaf.setViewState({
        ...viewState,
        state
      });
    }
  }
  async enforceSourceModeForLeaf(leaf) {
    if (!this.settings.preserveSourceMode) {
      return;
    }
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian5.MarkdownView) || !view.file) {
      return;
    }
    const source = view.editor?.getValue?.() ?? await this.app.vault.cachedRead(view.file);
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!blocks.length) {
      return;
    }
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      return;
    }
    state.mode = "source";
    state.source = true;
    await leaf.setViewState({
      ...viewState,
      state
    });
  }
  findActiveBlockById(blockId) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      return this.outputs.get(blockId)?.block ?? null;
    }
    const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
    return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
  }
  createLivePreviewExtension() {
    const plugin = this;
    return import_view2.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          plugin.editorViews.add(view);
          this.decorations = this.buildDecorations();
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(loomRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }
        destroy() {
          plugin.editorViews.delete(this.view);
        }
        buildDecorations() {
          const filePath = plugin.getCurrentEditorFilePath();
          if (!filePath) {
            return import_view2.Decoration.none;
          }
          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, plugin.settings);
          const builder = new import_state.RangeSetBuilder();
          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              import_view2.Decoration.widget({
                widget: new loomToolbarWidget(plugin, block),
                side: -1
              })
            );
            if (plugin.outputs.has(block.id) || plugin.running.has(block.id)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                import_view2.Decoration.widget({
                  widget: new loomOutputWidget(plugin, block.id),
                  side: 1
                })
              );
            }
            if (block.language === "llvm-ir") {
              addLlvmDecorations(builder, this.view, block);
            }
          }
          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }
  async writeManagedOutputBlock(file, block, result) {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);
      if (existingRange) {
        lines.splice(existingRange.start, existingRange.end - existingRange.start + 1, ...rendered);
        return lines.join("\n");
      }
      if (!currentBlock) {
        return content;
      }
      lines.splice(currentBlock.endLine + 1, 0, ...rendered);
      return lines.join("\n");
    });
  }
  async removeManagedOutputBlock(filePath, blockId) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const range = this.findManagedOutputRange(lines, blockId);
      if (!range) {
        return content;
      }
      lines.splice(range.start, range.end - range.start + 1);
      return lines.join("\n");
    });
  }
  renderManagedOutputMarkdown(blockId, result) {
    const body = [
      `runner=${result.runnerName}`,
      `exit=${result.exitCode ?? "?"}`,
      `duration=${result.durationMs}ms`,
      `timestamp=${result.finishedAt}`,
      result.stdout ? `stdout:
${result.stdout}` : "",
      result.warning ? `warning:
${result.warning}` : "",
      result.stderr ? `stderr:
${result.stderr}` : ""
    ].filter(Boolean).join("\n\n");
    return [
      `<!-- loom:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- loom:output:end -->"
    ];
  }
  findManagedOutputRange(lines, blockId) {
    const startMarker = `<!-- loom:output:start id=${blockId} -->`;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== startMarker) {
        continue;
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "<!-- loom:output:end -->") {
          return { start: i, end: j };
        }
      }
    }
    return null;
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XHJcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcclxuICBNYXJrZG93blZpZXcsXHJcbiAgTW9kYWwsXHJcbiAgTm90aWNlLFxyXG4gIFBsdWdpbixcclxuICBURmlsZSxcclxuICBXb3Jrc3BhY2VMZWFmLFxyXG59IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XHJcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xyXG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcclxuaW1wb3J0IHsgYWRkTGx2bURlY29yYXRpb25zLCBoaWdobGlnaHRMbHZtRWxlbWVudCB9IGZyb20gXCIuL2xsdm1IaWdobGlnaHRcIjtcclxuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XHJcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcclxuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xyXG5pbXBvcnQgeyBJbnRlcnByZXRlZFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvaW50ZXJwcmV0ZWRcIjtcclxuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xyXG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xyXG5pbXBvcnQgeyBOYXRpdmVDb21waWxlZFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWRcIjtcclxuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XHJcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XHJcbmltcG9ydCB7IFByb29mUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9wcm9vZlwiO1xyXG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XHJcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MsIGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xyXG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xyXG5pbXBvcnQgeyBjcmVhdGVPdXRwdXRQYW5lbCwgY3JlYXRlUnVubmluZ1BhbmVsIH0gZnJvbSBcIi4vdWkvb3V0cHV0UGFuZWxcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xyXG5cclxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcclxuXHJcbmNsYXNzIEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihcclxuICAgIGFwcDogUGx1Z2luW1wiYXBwXCJdLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBvbkNvbmZpcm06ICgpID0+IFByb21pc2U8dm9pZD4sXHJcbiAgKSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCk6IHZvaWQge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJFbmFibGUgbG9vbSBsb2NhbCBleGVjdXRpb24/XCIgfSk7XHJcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcclxuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcclxuICAgIGNvbnN0IGNhbmNlbEJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pO1xyXG4gICAgY29uc3QgZW5hYmxlQnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiRW5hYmxlIGFuZCBydW5cIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcclxuXHJcbiAgICBjYW5jZWxCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcbiAgICBlbmFibGVCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcclxuICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XHJcbiAgcHJpdmF0ZSBwYW5lbENvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHVucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrOiBsb29tQ29kZUJsb2NrLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsXHJcbiAgKSB7XHJcbiAgICBzdXBlcihjb250YWluZXJFbCk7XHJcbiAgfVxyXG5cclxuICBvbmxvYWQoKTogdm9pZCB7XHJcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFkZENsYXNzKFwibG9vbS1jb2RlYmxvY2stc2hlbGxcIik7XHJcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcclxuXHJcbiAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9PT0gXCJvdXRwdXRcIikge1xyXG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xyXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwiY29kZVwiKSB7XHJcbiAgICAgIGhvc3RDbGFzc2VzLnB1c2goXCJsb29tLXByaW50LWhpZGUtb3V0cHV0XCIpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5wYW5lbENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBob3N0Q2xhc3Nlcy5qb2luKFwiIFwiKSB9KTtcclxuXHJcbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xyXG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIgPSB0aGlzLnBsdWdpbi5yZWdpc3Rlck91dHB1dExpc3RlbmVyKHRoaXMuYmxvY2suaWQsICgpID0+IHtcclxuICAgICAgaWYgKHRoaXMucGFuZWxDb250YWluZXIpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIG9udW5sb2FkKCk6IHZvaWQge1xyXG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgbG9vbVRvb2xiYXJXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGlzUnVubmluZzogYm9vbGVhbjtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXHJcbiAgKSB7XHJcbiAgICBzdXBlcigpO1xyXG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xyXG4gIH1cclxuXHJcbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIuaXNSdW5uaW5nID09PSB0aGlzLmlzUnVubmluZztcclxuICB9XHJcblxyXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIHJldHVybiB0aGlzLnBsdWdpbi5jcmVhdGVUb29sYmFyRWxlbWVudCh0aGlzLmJsb2NrKTtcclxuICB9XHJcbn1cclxuXHJcbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9ja0lkOiBzdHJpbmcsXHJcbiAgKSB7XHJcbiAgICBzdXBlcigpO1xyXG4gIH1cclxuXHJcbiAgZXEob3RoZXI6IGxvb21PdXRwdXRXaWRnZXQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gICAgd3JhcHBlci5jbGFzc05hbWUgPSBcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCI7XHJcbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2tJZCwgd3JhcHBlcik7XHJcbiAgICByZXR1cm4gd3JhcHBlcjtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIGxvb21QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xyXG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXHJcbiAgICBuZXcgUHl0aG9uUnVubmVyKCksXHJcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxyXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXHJcbiAgICBuZXcgTmF0aXZlQ29tcGlsZWRSdW5uZXIoKSxcclxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxyXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxyXG4gICAgbmV3IExsdm1SdW5uZXIoKSxcclxuICAgIG5ldyBQcm9vZlJ1bm5lcigpLFxyXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXHJcbiAgXSk7XHJcbiAgLy8gRXhwb3NlZCBhcyBwdWJsaWMgYW5kIHJlYWRvbmx5IHNvIHRoZSBzZXR0aW5ncyBwYW5lbCBhbmQgbW9kYWxzIGNhbiBhY2Nlc3MgY29udGFpbmVyIGNvbmZpZ3VyYXRpb25zIGFuZCBkZWZhdWx0IGxhbmd1YWdlIG1hcHBpbmcgaGVscGVycy5cclxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcclxuICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcclxuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dExpc3RlbmVycyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8KCkgPT4gdm9pZD4+KCk7XHJcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xyXG4gIHByaXZhdGUgbGFzdE1hcmtkb3duRmlsZVBhdGg6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG5cclxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XHJcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xyXG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcclxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcclxuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcclxuICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXHJcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxyXG4gICAgICBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvciwgdmlldykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XHJcbiAgICAgICAgaWYgKCFmaWxlKSB7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcclxuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcclxuICAgICAgICBpZiAoIWJsb2NrKSB7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2sgYXQgdGhlIGN1cnJlbnQgY3Vyc29yLlwiKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcclxuICAgICAgbmFtZTogXCJsb29tOiBSdW4gQWxsIFN1cHBvcnRlZCBDb2RlIEJsb2NrcyBpbiBDdXJyZW50IE5vdGVcIixcclxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XHJcbiAgICAgICAgaWYgKCFmaWxlKSB7XHJcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcclxuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcclxuICAgICAgbmFtZTogXCJsb29tOiBDbGVhciBsb29tIE91dHB1dHMgaW4gQ3VycmVudCBOb3RlXCIsXHJcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xyXG4gICAgICAgIGlmICghZmlsZSkge1xyXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XHJcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24odGhpcy5jcmVhdGVMaXZlUHJldmlld0V4dGVuc2lvbigpKTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCAoZmlsZSkgPT4ge1xyXG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XHJcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcclxuICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XHJcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xyXG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcclxuICAgICAgbmFtZTogXCJsb29tOiBWYWxpZGF0ZSBDb250YWluZXIgR3JvdXBzXCIsXHJcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xyXG4gICAgICAgIG5ldyBOb3RpY2UoZ3JvdXBzLmxlbmd0aCA/IGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBgJHtncm91cC5uYW1lfTogJHtncm91cC5zdGF0dXN9YCkuam9pbihcIlxcblwiKSA6IFwiTm8gbG9vbSBjb250YWluZXIgZ3JvdXBzIGZvdW5kLlwiLCA4MDAwKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xyXG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcclxuICAgICAgfSksXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLWNoYW5nZVwiLCAoX2VkaXRvciwgY3R4KSA9PiB7XHJcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xyXG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBvbnVubG9hZCgpOiB2b2lkIHtcclxuICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiB0aGlzLnJ1bm5pbmcudmFsdWVzKCkpIHtcclxuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5zZXR0aW5ncyA9IHtcclxuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcclxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcclxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XHJcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xyXG4gIH1cclxuXHJcbiAgaXNCbG9ja1J1bm5pbmcoYmxvY2tJZDogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcclxuICB9XHJcblxyXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcclxuICAgICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuc2V0KGJsb2NrSWQsIG5ldyBTZXQoKSk7XHJcbiAgICB9XHJcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XHJcbiAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XHJcbiAgICByZXR1cm4gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihibG9jay5pZCwgdGhpcy5pc0Jsb2NrUnVubmluZyhibG9jay5pZCksIHtcclxuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxyXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcclxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcclxuICAgICAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrLmlkKTtcclxuICAgICAgICBpZiAoIW91dHB1dCkge1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcclxuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xyXG4gICAgY29udGFpbmVyLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcclxuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XHJcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVSdW5uaW5nUGFuZWwoKSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQpKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XHJcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcclxuICAgIGlmICghYmxvY2spIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xyXG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcclxuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XHJcbiAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrSWQpO1xyXG5cclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcclxuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XHJcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XHJcbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XHJcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XHJcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XHJcbiAgICAgIGNvbnN0IHJlbW92YWxFbmQgPSBtYW5hZ2VkUmFuZ2UgPyBtYW5hZ2VkUmFuZ2UuZW5kIDogY3VycmVudEJsb2NrLmVuZExpbmU7XHJcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcclxuXHJcbiAgICAgIHdoaWxlIChyZW1vdmFsU3RhcnQgPCBsaW5lcy5sZW5ndGggLSAxICYmIGxpbmVzW3JlbW92YWxTdGFydF0gPT09IFwiXCIgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0ICsgMV0gPT09IFwiXCIpIHtcclxuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XHJcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xyXG4gICAgbmV3IE5vdGljZShcImxvb20gc25pcHBldCByZW1vdmVkLlwiKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcclxuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcclxuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpIHx8IHRoaXMuc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwO1xyXG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xyXG5cclxuICAgIGlmICghc3VwcG9ydGVkQmxvY2tzLmxlbmd0aCkge1xyXG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCBibG9jayBvZiBzdXBwb3J0ZWRCbG9ja3MpIHtcclxuICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcclxuICAgICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9jay5pZCk7XHJcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XHJcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xyXG4gICAgfVxyXG4gICAgbmV3IE5vdGljZShcImxvb20gb3V0cHV0cyBjbGVhcmVkLlwiKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJ1bkJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcclxuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xyXG4gICAgICBuZXcgTm90aWNlKFwiVGhpcyBsb29tIGJsb2NrIGlzIGFscmVhZHkgcnVubmluZy5cIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcclxuICAgICAgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB3b3JraW5nRGlyZWN0b3J5ID0gdGhpcy5yZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlKTtcclxuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpIHx8IHRoaXMuc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwO1xyXG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XHJcbiAgICBpZiAoIXJ1bm5lcikge1xyXG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XHJcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICBjb25zdCBydW5Db250ZXh0ID0ge1xyXG4gICAgICBmaWxlLFxyXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcclxuICAgIH07XHJcbiAgICB0aGlzLnJ1bm5pbmcuc2V0KGJsb2NrLmlkLCBjb250cm9sbGVyKTtcclxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XHJcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXHJcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5ydW4oYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MsIGNvbnRhaW5lckdyb3VwKVxyXG4gICAgICAgIDogYXdhaXQgcnVubmVyIS5ydW4oYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC50aW1lZE91dCkge1xyXG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSByZXN1bHQuc3RkZXJyIHx8IGBFeGVjdXRpb24gdGltZWQgb3V0IGFmdGVyICR7dGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zfSBtcy5gO1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcclxuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQuXCI7XHJcbiAgICAgIH0gZWxzZSBpZiAoIXJlc3VsdC5zdWNjZXNzICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xyXG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XHJcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXHJcbiAgICAgICAgYmxvY2ssXHJcbiAgICAgICAgcmVzdWx0LFxyXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXHJcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcclxuICAgICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIHJhbiAke3J1bm5lck5hbWV9IGJsb2NrLmAgOiBgbG9vbSBydW4gZmFpbGVkIGZvciAke3J1bm5lck5hbWV9LmApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xyXG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxyXG4gICAgICAgIGJsb2NrLFxyXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXHJcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcclxuICAgICAgICByZXN1bHQ6IHtcclxuICAgICAgICAgIHJ1bm5lcklkOiBjb250YWluZXJHcm91cCA/IGBjb250YWluZXI6JHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5pZCA/PyBcInVua25vd25cIixcclxuICAgICAgICAgIHJ1bm5lck5hbWU6IGNvbnRhaW5lckdyb3VwID8gYENvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmRpc3BsYXlOYW1lID8/IFwiVW5rbm93blwiLFxyXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBmaW5pc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBkdXJhdGlvbk1zOiAwLFxyXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxyXG4gICAgICAgICAgc3Rkb3V0OiBcIlwiLFxyXG4gICAgICAgICAgc3RkZXJyOiBtZXNzYWdlLFxyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICB0aW1lZE91dDogZmFsc2UsXHJcbiAgICAgICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBuZXcgTm90aWNlKGBsb29tIGVycm9yOiAke21lc3NhZ2V9YCk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrLmlkKTtcclxuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcclxuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGlmICh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzaykge1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcclxuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcclxuICAgICAgY29uc3Qgc2V0dGxlID0gKHZhbHVlOiBib29sZWFuKSA9PiB7XHJcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XHJcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcclxuICAgICAgICAgIHJlc29sdmUodmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB0cnVlO1xyXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICBzZXR0bGUodHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3Qgb3JpZ2luYWxDbG9zZSA9IG1vZGFsLmNsb3NlLmJpbmQobW9kYWwpO1xyXG4gICAgICBtb2RhbC5jbG9zZSA9ICgpID0+IHtcclxuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XHJcbiAgICAgICAgc2V0dGxlKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKTtcclxuICAgICAgfTtcclxuICAgICAgbW9kYWwub3BlbigpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGU6IFRGaWxlKTogc3RyaW5nIHtcclxuICAgIGlmICh0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcclxuICAgIGNvbnN0IGZpbGVGb2xkZXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XHJcbiAgICBjb25zdCByZXNvbHZlZCA9IGZpbGVGb2xkZXIgPT09IFwiLlwiID8gYWRhcHRlckJhc2VQYXRoIDogYCR7YWRhcHRlckJhc2VQYXRofS8ke2ZpbGVGb2xkZXJ9YDtcclxuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcclxuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRHcm91cFN1bW1hcmllcygpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgYnVpbGRDb250YWluZXJHcm91cChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcclxuICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSBidWlsdCBjb250YWluZXIgZ3JvdXAgJHtuYW1lfS5gIDogYGxvb20gY29udGFpbmVyIGJ1aWxkIGZhaWxlZCBmb3IgJHtuYW1lfS5gLCA4MDAwKTtcclxuICB9XHJcblxyXG4gIHJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpOiB2b2lkIHtcclxuICAgIGZvciAoY29uc3QgYWxpYXMgb2YgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHRoaXMuc2V0dGluZ3MpKSB7XHJcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmICh0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmhhcyhub3JtYWxpemVkQWxpYXMpKSB7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICgvW15hLXpBLVowLTlfLV0vLnRlc3Qobm9ybWFsaXplZEFsaWFzKSkge1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xyXG4gICAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3Iobm9ybWFsaXplZEFsaWFzLCBhc3luYyAoc291cmNlLCBlbCwgY3R4KSA9PiB7XHJcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBjdHguc291cmNlUGF0aDtcclxuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcclxuICAgICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBmdWxsVGV4dCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XHJcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcclxuICAgICAgICBjb25zdCBzZWN0aW9uID0gKGN0eCAmJiB0eXBlb2YgY3R4LmdldFNlY3Rpb25JbmZvID09PSBcImZ1bmN0aW9uXCIpID8gY3R4LmdldFNlY3Rpb25JbmZvKGVsKSA6IG51bGw7XHJcbiAgICAgICAgbGV0IGJsb2NrOiBsb29tQ29kZUJsb2NrIHwgdW5kZWZpbmVkO1xyXG4gICAgICAgIGlmIChzZWN0aW9uKSB7XHJcbiAgICAgICAgICBjb25zdCBsaW5lU3RhcnQgPSBzZWN0aW9uLmxpbmVTdGFydDtcclxuICAgICAgICAgIGJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnN0YXJ0TGluZSA9PT0gbGluZVN0YXJ0ICYmIGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIWJsb2NrKSB7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgcHJlID0gZWwucXVlcnlTZWxlY3RvcihcInByZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICAgICAgaWYgKCFwcmUpIHtcclxuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xyXG4gICAgICAgICAgcHJlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcclxuICAgICAgICAgIGNvbnN0IGNvZGUgPSBwcmUuY3JlYXRlRWwoXCJjb2RlXCIpO1xyXG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XHJcbiAgICAgICAgICBjb2RlLnNldFRleHQoc291cmNlKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcclxuICAgICAgICAgIGNvbnN0IGNvZGUgPSAocHJlLnF1ZXJ5U2VsZWN0b3IoXCJjb2RlXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbCkgPz8gcHJlO1xyXG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgdXBkYXRlU3RhdHVzQmFyKCk6IHZvaWQge1xyXG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xyXG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwuc2V0VGV4dChhY3RpdmVSdW5zID8gYGxvb206ICR7YWN0aXZlUnVuc30gQWN0aXZlIFJ1biR7YWN0aXZlUnVucyA9PT0gMSA/IFwiXCIgOiBcInNcIn1gIDogXCJsb29tOiBJZGxlXCIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5mb3JFYWNoKChsaXN0ZW5lcikgPT4gbGlzdGVuZXIoKSk7XHJcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xyXG4gICAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3IGFzIE1hcmtkb3duVmlldztcclxuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcclxuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xyXG4gICAgICBlZGl0b3JWaWV3LmRpc3BhdGNoKHsgZWZmZWN0czogbG9vbVJlZnJlc2hFZmZlY3Qub2YodW5kZWZpbmVkKSB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XHJcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuICAgIHJldHVybiB2aWV3Py5maWxlID8/IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XHJcbiAgfVxyXG5cclxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuICAgIGlmICghdmlldykge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xyXG4gICAgaWYgKCF2aWV3KSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsZWFmID0gdmlldy5sZWFmO1xyXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcclxuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG4gICAgXHJcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcclxuICAgICAgc3RhdGUuc291cmNlID0gZmFsc2U7XHJcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcclxuICAgICAgICAuLi52aWV3U3RhdGUsXHJcbiAgICAgICAgc3RhdGUsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xyXG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcclxuICAgIGlmICghKHZpZXcgaW5zdGFuY2VvZiBNYXJrZG93blZpZXcpIHx8ICF2aWV3LmZpbGUpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XHJcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcclxuICAgIGlmICghYmxvY2tzLmxlbmd0aCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcclxuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcclxuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XHJcblxyXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xyXG4gICAgICAuLi52aWV3U3RhdGUsXHJcbiAgICAgIHN0YXRlLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xyXG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcbiAgICBjb25zdCBmaWxlID0gdmlldz8uZmlsZTtcclxuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcclxuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpPy5ibG9jayA/PyBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xyXG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcclxuXHJcbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXHJcbiAgICAgIGNsYXNzIHtcclxuICAgICAgICBkZWNvcmF0aW9ucztcclxuXHJcbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XHJcbiAgICAgICAgICBwbHVnaW4uZWRpdG9yVmlld3MuYWRkKHZpZXcpO1xyXG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xyXG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xyXG4gICAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xyXG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xyXG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwbHVnaW4uZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk7XHJcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xyXG4gICAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIHNvdXJjZSwgcGx1Z2luLnNldHRpbmdzKTtcclxuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XHJcblxyXG4gICAgICAgICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xyXG4gICAgICAgICAgICBidWlsZGVyLmFkZChcclxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcclxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcclxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XHJcbiAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tVG9vbGJhcldpZGdldChwbHVnaW4sIGJsb2NrKSxcclxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICApO1xyXG5cclxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IGVuZExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suZW5kTGluZSArIDEpO1xyXG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxyXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcclxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXHJcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XHJcbiAgICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21PdXRwdXRXaWRnZXQocGx1Z2luLCBibG9jay5pZCksXHJcbiAgICAgICAgICAgICAgICAgIHNpZGU6IDEsXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XHJcbiAgICAgICAgICAgICAgYWRkTGx2bURlY29yYXRpb25zKGJ1aWxkZXIsIHRoaXMudmlldywgYmxvY2spO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMsXHJcbiAgICAgIH0sXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xyXG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcclxuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcclxuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9jay5pZCk7XHJcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGhpcy5yZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2suaWQsIHJlc3VsdCk7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcclxuXHJcbiAgICAgIGlmIChleGlzdGluZ1JhbmdlKSB7XHJcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcclxuICAgICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcclxuICAgICAgICByZXR1cm4gY29udGVudDtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGluZXMuc3BsaWNlKGN1cnJlbnRCbG9jay5lbmRMaW5lICsgMSwgMCwgLi4ucmVuZGVyZWQpO1xyXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZVBhdGg6IHN0cmluZywgYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcclxuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcclxuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcclxuICAgICAgaWYgKCFyYW5nZSkge1xyXG4gICAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgICB9XHJcbiAgICAgIGxpbmVzLnNwbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kIC0gcmFuZ2Uuc3RhcnQgKyAxKTtcclxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xyXG4gICAgY29uc3QgYm9keSA9IFtcclxuICAgICAgYHJ1bm5lcj0ke3Jlc3VsdC5ydW5uZXJOYW1lfWAsXHJcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXHJcbiAgICAgIGBkdXJhdGlvbj0ke3Jlc3VsdC5kdXJhdGlvbk1zfW1zYCxcclxuICAgICAgYHRpbWVzdGFtcD0ke3Jlc3VsdC5maW5pc2hlZEF0fWAsXHJcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcclxuICAgICAgcmVzdWx0Lndhcm5pbmcgPyBgd2FybmluZzpcXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBcIlwiLFxyXG4gICAgICByZXN1bHQuc3RkZXJyID8gYHN0ZGVycjpcXG4ke3Jlc3VsdC5zdGRlcnJ9YCA6IFwiXCIsXHJcbiAgICBdXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgLmpvaW4oXCJcXG5cXG5cIik7XHJcblxyXG4gICAgcmV0dXJuIFtcclxuICAgICAgYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gLFxyXG4gICAgICBcImBgYHRleHRcIixcclxuICAgICAgYm9keSxcclxuICAgICAgXCJgYGBcIixcclxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcclxuICAgIF07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXM6IHN0cmluZ1tdLCBibG9ja0lkOiBzdHJpbmcpOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcclxuICAgIGNvbnN0IHN0YXJ0TWFya2VyID0gYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xyXG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpICE9PSBzdGFydE1hcmtlcikge1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xyXG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcclxuICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiBpLCBlbmQ6IGogfTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgTm90aWNlLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XHJcbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xyXG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiwgbm9ybWFsaXplIGFzIG5vcm1hbGl6ZUZzUGF0aCwgcG9zaXggYXMgcG9zaXhQYXRoIH0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xyXG5pbXBvcnQgeyBydW5Qcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzc1J1bm5lclwiO1xyXG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG50eXBlIGxvb21Db250YWluZXJSdW50aW1lID0gXCJkb2NrZXJcIiB8IFwicG9kbWFuXCIgfCBcInFlbXVcIiB8IFwid3NsXCIgfCBcImN1c3RvbVwiO1xyXG5cclxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XHJcbiAgY29tbWFuZD86IHN0cmluZztcclxuICBleHRlbnNpb24/OiBzdHJpbmc7XHJcbiAgdXNlRGVmYXVsdD86IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcclxuICBjb21tYW5kOiBzdHJpbmc7XHJcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcclxuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xyXG4gIHNzaFRhcmdldDogc3RyaW5nO1xyXG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xyXG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XHJcbiAgc3NoQXJncz86IHN0cmluZztcclxuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XHJcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xyXG4gIHRlYXJkb3duQ29tbWFuZD86IHN0cmluZztcclxuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XHJcbiAgbWFuYWdlcj86IGxvb21RZW11TWFuYWdlckNvbmZpZztcclxufVxyXG5cclxuaW50ZXJmYWNlIGxvb21RZW11TWFuYWdlckNvbmZpZyB7XHJcbiAgZW5hYmxlZDogYm9vbGVhbjtcclxuICBleGVjdXRhYmxlPzogc3RyaW5nO1xyXG4gIGFyZ3M/OiBzdHJpbmc7XHJcbiAgaW1hZ2U/OiBzdHJpbmc7XHJcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XHJcbiAgcGlkRmlsZT86IHN0cmluZztcclxuICBsb2dGaWxlPzogc3RyaW5nO1xyXG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcclxuICByZWFkaW5lc3NJbnRlcnZhbE1zPzogbnVtYmVyO1xyXG4gIGJvb3REZWxheU1zPzogbnVtYmVyO1xyXG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcclxuICBzaHV0ZG93blRpbWVvdXRNcz86IG51bWJlcjtcclxuICBraWxsU2lnbmFsPzogTm9kZUpTLlNpZ25hbHM7XHJcbiAgcGVyc2lzdD86IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XHJcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xyXG4gIGFyZ3M/OiBzdHJpbmc7XHJcbiAgYnVpbGQ/OiBzdHJpbmc7XHJcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcclxuICB0ZWFyZG93bj86IHN0cmluZztcclxuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XHJcbn1cclxuXHJcbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcclxuICBpbnRlcmFjdGl2ZT86IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBsb29tQ29udGFpbmVyQ29uZmlnIHtcclxuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcclxuICBleGVjdXRhYmxlPzogc3RyaW5nO1xyXG4gIGltYWdlPzogc3RyaW5nO1xyXG4gIHdzbD86IGxvb21Xc2xDb25maWc7XHJcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xyXG4gIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcclxuICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcclxuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XHJcbn1cclxuXHJcbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xyXG4gIGFjdGlvbjogXCJidWlsZFwiIHwgXCJydW5cIiB8IFwidGVhcmRvd25cIjtcclxuICBncm91cE5hbWU6IHN0cmluZztcclxuICBncm91cFBhdGg6IHN0cmluZztcclxuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcclxuICBpbWFnZT86IHN0cmluZztcclxuICBidWlsZD86IHN0cmluZztcclxuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xyXG4gIHRlYXJkb3duPzogc3RyaW5nO1xyXG4gIGxhbmd1YWdlPzogc3RyaW5nO1xyXG4gIGxhbmd1YWdlQWxpYXM/OiBzdHJpbmc7XHJcbiAgZmlsZU5hbWU/OiBzdHJpbmc7XHJcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XHJcbiAgY29tbWFuZD86IHN0cmluZztcclxuICB0aW1lb3V0TXM6IG51bWJlcjtcclxuICBjb25maWc6IHtcclxuICAgIGV4ZWN1dGFibGU/OiBzdHJpbmc7XHJcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcclxuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcclxuICAgIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsdEltYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxyXG4gICkgeyB9XHJcblxyXG4gIGdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlOiBURmlsZSk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcclxuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbDtcclxuICB9XHJcblxyXG4gIGFzeW5jIGdldEdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XHJcbiAgICBjb25zdCBjb250YWluZXJzUGF0aCA9IHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKTtcclxuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoXHJcbiAgICAgIGVudHJpZXNcclxuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcclxuICAgICAgICAubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XHJcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcclxuICAgICAgICAgIGNvbnN0IGhhc0RvY2tlcmZpbGUgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpO1xyXG4gICAgICAgICAgaWYgKCFoYXNDb25maWcpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxyXG4gICAgICAgICAgICAgIHN0YXR1czogXCJtaXNzaW5nIGNvbmZpZy5qc29uXCIsXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcclxuICAgICAgICAgICAgY29uc3QgcGllY2VzID0gW2BydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWBdO1xyXG4gICAgICAgICAgICBpZiAoKGNvbmZpZy5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiKSAmJiBoYXNEb2NrZXJmaWxlKSB7XHJcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/LnNzaFRhcmdldCkge1xyXG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/Lm1hbmFnZXI/LmVuYWJsZWQpIHtcclxuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgbWFuYWdlcjogJHthd2FpdCB0aGlzLmdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aCwgY29uZmlnLnFlbXUubWFuYWdlcil9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcclxuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgd3JhcHBlcjogJHtjb25maWcuY3VzdG9tLmV4ZWN1dGFibGV9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcclxuICAgICAgICAgICAgcGllY2VzLnB1c2goYCR7bGFuZ3VhZ2VDb3VudH0gbGFuZ3VhZ2Uke2xhbmd1YWdlQ291bnQgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCk7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcclxuICAgICAgICAgICAgICBzdGF0dXM6IHBpZWNlcy5qb2luKFwiLCBcIiksXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXHJcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBncm91cE5hbWU6IHN0cmluZyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XHJcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcclxuICAgIGNvbnN0IGNvbmZpZ0xhbmcgPSBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlXSA/PyBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlQWxpYXNdO1xyXG5cclxuICAgIGxldCBpc0ZhbGxiYWNrID0gZmFsc2U7XHJcbiAgICBsZXQgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB8IG51bGwgPSBudWxsO1xyXG5cclxuICAgIGlmIChjb25maWdMYW5nKSB7XHJcbiAgICAgIGlmIChjb25maWdMYW5nLnVzZURlZmF1bHQpIHtcclxuICAgICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxhbmd1YWdlID0gY29uZmlnTGFuZztcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcclxuICAgICAgaXNGYWxsYmFjayA9IHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFsYW5ndWFnZSB8fCAhbGFuZ3VhZ2UuY29tbWFuZCB8fCAhbGFuZ3VhZ2UuZXh0ZW5zaW9uKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGdyb3VwICR7Z3JvdXBOYW1lfSBoYXMgbm8gY29tbWFuZCBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XHJcbiAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgdGVtcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9JHtub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uKX1gO1xyXG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xyXG4gICAgICBsZXQgcmVzdWx0OiBsb29tUnVuUmVzdWx0O1xyXG4gICAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XHJcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxyXG4gICAgICAgIGNhc2UgXCJwb2RtYW5cIjpcclxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuT2NpQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQsIHNldHRpbmdzKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgXCJxZW11XCI6XHJcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1blFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIFwiY3VzdG9tXCI6XHJcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBibG9jaywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgdGVtcEZpbGVQYXRoLCBjb250ZXh0KTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGNhc2UgXCJ3c2xcIjpcclxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuV3NsQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcnVudGltZTogJHtjb25maWcucnVudGltZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGlzRmFsbGJhY2spIHtcclxuICAgICAgICBjb25zdCBmYWxsYmFja01zZyA9IGBbTG9vbV0gTGFuZ3VhZ2UgJyR7YmxvY2subGFuZ3VhZ2V9JyB3YXMgbm90IGRlY2xhcmVkIGluIGNvbnRhaW5lciBncm91cC4gUnVubmluZyB1c2luZyBkZWZhdWx0IGNvbW1hbmQ6ICR7bGFuZ3VhZ2UuY29tbWFuZH1gO1xyXG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtyZXN1bHQud2FybmluZ31cXG4ke2ZhbGxiYWNrTXNnfWAgOiBmYWxsYmFja01zZztcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xyXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XHJcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xyXG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xyXG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XHJcbiAgICAgIGNhc2UgXCJwb2RtYW5cIjpcclxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcclxuICAgICAgY2FzZSBcInFlbXVcIjpcclxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xyXG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XHJcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XHJcbiAgICAgIGNhc2UgXCJ3c2xcIjpcclxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXHJcbiAgICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2w6YnVpbGRgLFxyXG4gICAgICAgICAgYFdTTCAke2dyb3VwTmFtZX0gYnVpbGRgLFxyXG4gICAgICAgICAgYFdTTCBlbnZpcm9ubWVudCAke2NvbmZpZy5pbWFnZSB8fCBcIihkZWZhdWx0KVwifSBkb2VzIG5vdCByZXF1aXJlIGEgYnVpbGQgc3RlcC5cXG5gLFxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bk9jaUNvbnRhaW5lcihcclxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxyXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXHJcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXHJcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxyXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXHJcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcclxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXHJcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XHJcbiAgICBjb25zdCBpbWFnZSA9IGF3YWl0IHRoaXMucmVzb2x2ZUltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQsIHNldHRpbmdzKTtcclxuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XHJcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb21tYW5kIGlzIGVtcHR5LlwiKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XHJcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfWAsXHJcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXHJcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcclxuICAgICAgYXJnczogW1xyXG4gICAgICAgIFwicnVuXCIsXHJcbiAgICAgICAgXCItLXJtXCIsXHJcbiAgICAgICAgXCItdlwiLFxyXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXHJcbiAgICAgICAgXCItd1wiLFxyXG4gICAgICAgIFwiL3dvcmtzcGFjZVwiLFxyXG4gICAgICAgIGltYWdlLFxyXG4gICAgICAgIC4uLmNvbW1hbmQsXHJcbiAgICAgIF0sXHJcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcclxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxyXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXHJcbiAgICBncm91cFBhdGg6IHN0cmluZyxcclxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcclxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXHJcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcclxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxyXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcclxuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xyXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcclxuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6aGVhbHRoYCwgYFFFTVUgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlbW90ZUZpbGUgPSBwb3NpeFBhdGguam9pbihxZW11LnJlbW90ZVdvcmtzcGFjZSwgdGVtcEZpbGVOYW1lKTtcclxuICAgICAgY29uc3QgcmVtb3RlQ29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgc2hlbGxRdW90ZShyZW1vdGVGaWxlKSk7XHJcbiAgICAgIGlmICghcmVtb3RlQ29tbWFuZC50cmltKCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XHJcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxyXG4gICAgICAgIHJ1bm5lck5hbWU6IGBRRU1VICR7Z3JvdXBOYW1lfWAsXHJcbiAgICAgICAgZXhlY3V0YWJsZTogcWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwic3NoXCIsXHJcbiAgICAgICAgYXJnczogW1xyXG4gICAgICAgICAgLi4uc3BsaXRDb21tYW5kTGluZShxZW11LnNzaEFyZ3MgfHwgXCJcIiksXHJcbiAgICAgICAgICBxZW11LnNzaFRhcmdldCxcclxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcclxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS50ZWFyZG93bkNvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnRlYXJkb3duYCwgYFFFTVUgJHtncm91cE5hbWV9IHRlYXJkb3duYCk7XHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcclxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxyXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXHJcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXHJcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcclxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXHJcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcclxuICAgIHRlbXBGaWxlUGF0aDogc3RyaW5nLFxyXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXHJcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XHJcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxyXG4gICAgICBncm91cE5hbWUsXHJcbiAgICAgIGdyb3VwUGF0aCxcclxuICAgICAgY29uZmlnLFxyXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcclxuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXHJcbiAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcclxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxyXG4gICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXHJcbiAgICAgICAgY29tbWFuZCxcclxuICAgICAgfSksXHJcbiAgICAgIGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICBjb250ZXh0LnNpZ25hbCxcclxuICAgICk7XHJcblxyXG4gICAgaWYgKGNvbmZpZy5jdXN0b20/LnRlYXJkb3duKSB7XHJcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxyXG4gICAgICAgIGdyb3VwTmFtZSxcclxuICAgICAgICBncm91cFBhdGgsXHJcbiAgICAgICAgY29uZmlnLFxyXG4gICAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInRlYXJkb3duXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XHJcbiAgICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXHJcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxyXG4gICAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcclxuICAgICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXHJcbiAgICAgICAgICBjb21tYW5kLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICApO1xyXG4gICAgICBpZiAoIXRlYXJkb3duLnN1Y2Nlc3MpIHtcclxuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bldzbENvbnRhaW5lcihcclxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxyXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXHJcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXHJcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxyXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXHJcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcclxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IHdzbEdyb3VwUGF0aCA9IHRoaXMudHJhbnNsYXRlVG9Xc2xQYXRoKGdyb3VwUGF0aCk7XHJcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xyXG4gICAgaWYgKCFjb21tYW5kLnRyaW0oKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXU0wgY29tbWFuZCBpcyBlbXB0eS5cIik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2hlbGxGbGFncyA9IGNvbmZpZy53c2w/LmludGVyYWN0aXZlID8gW1wiLWlcIiwgXCItbFwiLCBcIi1jXCJdIDogW1wiLWxcIiwgXCItY1wiXTtcclxuICAgIGNvbnN0IHdzbEFyZ3MgPSBbXCJiYXNoXCIsIC4uLnNoZWxsRmxhZ3MsIGBjZCBcIiR7d3NsR3JvdXBQYXRoLnJlcGxhY2VBbGwoJ1wiJywgJ1xcXFxcIicpfVwiICYmICR7Y29tbWFuZH1gXTtcclxuICAgIGlmIChjb25maWcuaW1hZ2U/LnRyaW0oKSkge1xyXG4gICAgICB3c2xBcmdzLnVuc2hpZnQoXCItZFwiLCBjb25maWcuaW1hZ2UudHJpbSgpKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XHJcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2xgLFxyXG4gICAgICBydW5uZXJOYW1lOiBgV1NMICR7Z3JvdXBOYW1lfWAsXHJcbiAgICAgIGV4ZWN1dGFibGU6IFwid3NsXCIsXHJcbiAgICAgIGFyZ3M6IHdzbEFyZ3MsXHJcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcclxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB0cmFuc2xhdGVUb1dzbFBhdGgod2luZG93c1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xyXG4gICAgaWYgKG1hdGNoKSB7XHJcbiAgICAgIGNvbnN0IGRyaXZlID0gbWF0Y2hbMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xyXG4gICAgICByZXR1cm4gYC9tbnQvJHtkcml2ZX0vJHtyZXN0fWA7XHJcbiAgICB9XHJcbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XHJcbiAgICAgIHJldHVybiB3aW5kb3dzUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcclxuICAgIH1cclxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxyXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXHJcbiAgICBncm91cFBhdGg6IHN0cmluZyxcclxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcclxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxyXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcclxuICApOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgY29uc3QgZG9ja2VyZmlsZSA9IGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIik7XHJcbiAgICBpZiAoIWV4aXN0c1N5bmMoZG9ja2VyZmlsZSkpIHtcclxuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcclxuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7dGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpfToke2ltYWdlfWA7XHJcbiAgICBpZiAodGhpcy5idWlsdEltYWdlcy5oYXMoY2FjaGVLZXkpKSB7XHJcbiAgICAgIHJldHVybiBpbWFnZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XHJcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gYnVpbGQgZmFpbGVkIGZvciAke2dyb3VwTmFtZX0uYCk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5idWlsdEltYWdlcy5hZGQoY2FjaGVLZXkpO1xyXG4gICAgcmV0dXJuIGltYWdlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxyXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXHJcbiAgICBncm91cFBhdGg6IHN0cmluZyxcclxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcclxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxyXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcclxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xyXG4gICAgaWYgKCFleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcclxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXHJcbiAgICAgICAgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcclxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcclxuICAgICAgKTtcclxuICAgIH1cclxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcclxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcclxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxyXG4gICAgICBhcmdzOiBbXCJidWlsZFwiLCBcIi10XCIsIGltYWdlLCBncm91cFBhdGhdLFxyXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXHJcbiAgICAgIHRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGJ1aWxkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XHJcbiAgICBpZiAoIXFlbXUuYnVpbGRDb21tYW5kPy50cmltKCkpIHtcclxuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6YnVpbGRgLCBgUUVNVSAke2dyb3VwTmFtZX0gYnVpbGRgLCBcIk5vIFFFTVUgYnVpbGQgY29tbWFuZCBjb25maWd1cmVkLlxcblwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLnJ1bkNvbW1hbmRMaW5lKHFlbXUuYnVpbGRDb21tYW5kLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlYWRDb25maWcoZ3JvdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGxvb21Db250YWluZXJDb25maWc+IHtcclxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKTtcclxuICAgIGxldCByYXc6IHVua25vd247XHJcbiAgICB0cnkge1xyXG4gICAgICByYXcgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGNvbmZpZ1BhdGgsIFwidXRmOFwiKSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byByZWFkIGNvbnRhaW5lciBjb25maWcgJHtjb25maWdQYXRofTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZGF0YSA9IHJhdyBhcyB7XHJcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xyXG4gICAgICBleGVjdXRhYmxlPzogdW5rbm93bjtcclxuICAgICAgaW1hZ2U/OiB1bmtub3duO1xyXG4gICAgICB3c2w/OiB1bmtub3duO1xyXG4gICAgICBoZWFsdGhDaGVjaz86IHVua25vd247XHJcbiAgICAgIHFlbXU/OiB1bmtub3duO1xyXG4gICAgICBjdXN0b20/OiB1bmtub3duO1xyXG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XHJcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgaW1hZ2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XHJcbiAgICB9XHJcbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGxhbmd1YWdlcyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+ID0ge307XHJcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xyXG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93bjsgdXNlRGVmYXVsdD86IHVua25vd24gfTtcclxuICAgICAgY29uc3QgdXNlRGVmYXVsdCA9IGxhbmd1YWdlQ29uZmlnLnVzZURlZmF1bHQgPT09IHRydWU7XHJcblxyXG4gICAgICBpZiAoIXVzZURlZmF1bHQgJiYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGRlZmluZSBjb21tYW5kIG9yIHVzZURlZmF1bHQuYCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxhbmd1YWdlc1tsYW5ndWFnZV0gPSB7XHJcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGV4dGVuc2lvbjogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA6IHVuZGVmaW5lZCxcclxuICAgICAgICB1c2VEZWZhdWx0OiB1c2VEZWZhdWx0IHx8IHVuZGVmaW5lZCxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBydW50aW1lLFxyXG4gICAgICBleGVjdXRhYmxlOiB0eXBlb2YgZGF0YS5leGVjdXRhYmxlID09PSBcInN0cmluZ1wiICYmIGRhdGEuZXhlY3V0YWJsZS50cmltKCkgPyBkYXRhLmV4ZWN1dGFibGUudHJpbSgpIDogdW5kZWZpbmVkLFxyXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxyXG4gICAgICB3c2w6IHRoaXMucmVhZFdzbENvbmZpZyhkYXRhLndzbCksXHJcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgaGVhbHRoQ2hlY2tcIiksXHJcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcclxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxyXG4gICAgICBsYW5ndWFnZXMsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcclxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XHJcbiAgICAgIHJldHVybiBcImRvY2tlclwiO1xyXG4gICAgfVxyXG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIiB8fCB2YWx1ZSA9PT0gXCJ3c2xcIikge1xyXG4gICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICB9XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgY3VzdG9tLCBvciB3c2wuXCIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWFkV3NsQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVdzbENvbmZpZyB8IHVuZGVmaW5lZCB7XHJcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIHsgaW50ZXJhY3RpdmU/OiB1bmtub3duIH07XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBpbnRlcmFjdGl2ZTogZGF0YS5pbnRlcmFjdGl2ZSA9PT0gdHJ1ZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlYWRRZW11Q29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVDb25maWcgfCB1bmRlZmluZWQge1xyXG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XHJcbiAgICB9XHJcbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbiAgICBpZiAodHlwZW9mIGRhdGEuc3NoVGFyZ2V0ICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnNzaFRhcmdldC50cmltKCkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnNzaFRhcmdldCBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcclxuICAgIH1cclxuICAgIGlmICh0eXBlb2YgZGF0YS5yZW1vdGVXb3Jrc3BhY2UgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUucmVtb3RlV29ya3NwYWNlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxyXG4gICAgICByZW1vdGVXb3Jrc3BhY2U6IGRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSxcclxuICAgICAgc3NoRXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hFeGVjdXRhYmxlKSxcclxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcclxuICAgICAgc3RhcnRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnN0YXJ0Q29tbWFuZCksXHJcbiAgICAgIGJ1aWxkQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZENvbW1hbmQpLFxyXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcclxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LmhlYWx0aENoZWNrXCIpLFxyXG4gICAgICBtYW5hZ2VyOiB0aGlzLnJlYWRRZW11TWFuYWdlckNvbmZpZyhkYXRhLm1hbmFnZXIpLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcclxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlciBtdXN0IGJlIGFuIG9iamVjdC5cIik7XHJcbiAgICB9XHJcbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxyXG4gICAgICBleGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmV4ZWN1dGFibGUpLFxyXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxyXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXHJcbiAgICAgIGltYWdlRm9ybWF0OiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlRm9ybWF0KSxcclxuICAgICAgcGlkRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5waWRGaWxlKSxcclxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcclxuICAgICAgcmVhZGluZXNzVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc1RpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXNcIiksXHJcbiAgICAgIHJlYWRpbmVzc0ludGVydmFsTXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEucmVhZGluZXNzSW50ZXJ2YWxNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zXCIpLFxyXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcclxuICAgICAgc2h1dGRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnNodXRkb3duQ29tbWFuZCksXHJcbiAgICAgIHNodXRkb3duVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnNodXRkb3duVGltZW91dE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnNodXRkb3duVGltZW91dE1zXCIpLFxyXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcclxuICAgICAgcGVyc2lzdDogdHlwZW9mIGRhdGEucGVyc2lzdCA9PT0gXCJib29sZWFuXCIgPyBkYXRhLnBlcnNpc3QgOiB1bmRlZmluZWQsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWFkQ3VzdG9tQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcgfCB1bmRlZmluZWQge1xyXG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcclxuICAgIH1cclxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuICAgIGlmICh0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmV4ZWN1dGFibGUudHJpbSgpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBleGVjdXRhYmxlOiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpLFxyXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxyXG4gICAgICBidWlsZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZCksXHJcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuY29tbWFuZFN0cnVjdHVyZSksXHJcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcclxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uaGVhbHRoQ2hlY2tcIiksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWFkSGVhbHRoQ2hlY2sodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkIHtcclxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xyXG4gICAgfVxyXG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG4gICAgaWYgKHR5cGVvZiBkYXRhLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuY29tbWFuZC50cmltKCkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfS5jb21tYW5kIG11c3QgYmUgYSBzdHJpbmcuYCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb21tYW5kOiBkYXRhLmNvbW1hbmQudHJpbSgpLFxyXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXHJcbiAgICAgIG5lZ2F0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEubmVnYXRpdmVSZXNwb25zZSA/PyBkYXRhLm5lZ2F0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJuZWdhdGl2ZSByZXNwb25zZVwiXSksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZXF1aXJlUWVtdUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tUWVtdUNvbmZpZyB7XHJcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgcnVudGltZSByZXF1aXJlcyBhIHFlbXUgY29uZmlnIG9iamVjdC5cIik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xyXG4gICAgaWYgKCFjb25maWcuY3VzdG9tKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIGEgY3VzdG9tIGNvbmZpZyBvYmplY3QuXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbmZpZy5jdXN0b207XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IHN0cmluZyB7XHJcbiAgICBpZiAoY29uZmlnLmV4ZWN1dGFibGU/LnRyaW0oKSkge1xyXG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiID8gXCJwb2RtYW5cIiA6IFwiZG9ja2VyXCI7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bkhlYWx0aENoZWNrKFxyXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXHJcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXHJcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcclxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXHJcbiAgICBydW5uZXJJZDogc3RyaW5nLFxyXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFoZWFsdGhDaGVjaykge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShoZWFsdGhDaGVjay5jb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xyXG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xyXG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xyXG4gICAgfVxyXG4gICAgaWYgKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UgJiYgY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IHJldHVybmVkIG5lZ2F0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2V9YCk7XHJcbiAgICB9XHJcbiAgICBpZiAoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSAmJiAhY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGRpZCBub3QgcmV0dXJuIHBvc2l0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2V9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcclxuICAgIGNvbW1hbmQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcclxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcclxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxyXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcclxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXHJcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWNvbW1hbmQ/LnRyaW0oKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XHJcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bkNvbW1hbmRMaW5lKFxyXG4gICAgY29tbWFuZDogc3RyaW5nLFxyXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxyXG4gICAgdGltZW91dE1zOiBudW1iZXIsXHJcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxyXG4gICAgcnVubmVySWQ6IHN0cmluZyxcclxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcclxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IHBhcnRzID0gc3BsaXRDb21tYW5kTGluZShjb21tYW5kKTtcclxuICAgIGlmICghcGFydHMubGVuZ3RoKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xyXG4gICAgICBydW5uZXJJZCxcclxuICAgICAgcnVubmVyTmFtZSxcclxuICAgICAgZXhlY3V0YWJsZTogcGFydHNbMF0sXHJcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxyXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICB0aW1lb3V0TXMsXHJcbiAgICAgIHNpZ25hbCxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcclxuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcclxuICAgIGNvbnN0IGV4aXN0aW5nUGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcclxuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXhpc3RpbmdQaWQpIHtcclxuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XHJcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGgsIG1hbmFnZXIpO1xyXG4gICAgaWYgKCFhcmdzLmxlbmd0aCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xyXG4gICAgY29uc3QgbG9nRmQgPSBsb2dQYXRoID8gb3BlblN5bmMobG9nUGF0aCwgXCJhXCIpIDogbnVsbDtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xyXG4gICAgICAgIGN3ZDogZ3JvdXBQYXRoLFxyXG4gICAgICAgIGRldGFjaGVkOiB0cnVlLFxyXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xyXG4gICAgICBjaGlsZC51bnJlZigpO1xyXG5cclxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IGRpZCBub3QgcmV0dXJuIGEgcHJvY2VzcyBpZC5gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHBpZFBhdGgsIGAke2NoaWxkLnBpZH1cXG5gLCBcInV0ZjhcIik7XHJcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBpZiAobG9nRmQgIT0gbnVsbCkge1xyXG4gICAgICAgIGNsb3NlU3luYyhsb2dGZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IHN0cmluZ1tdIHtcclxuICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKG1hbmFnZXIuYXJncyB8fCBcIlwiKTtcclxuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XHJcbiAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmltYWdlKTtcclxuICAgICAgYXJncy5wdXNoKFwiLWRyaXZlXCIsIGBmaWxlPSR7aW1hZ2VQYXRofSxpZj12aXJ0aW8sZm9ybWF0PSR7bWFuYWdlci5pbWFnZUZvcm1hdCB8fCBcInFjb3cyXCJ9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXJncztcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKFxyXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXHJcbiAgICBncm91cFBhdGg6IHN0cmluZyxcclxuICAgIHFlbXU6IGxvb21RZW11Q29uZmlnLFxyXG4gICAgdGltZW91dE1zOiBudW1iZXIsXHJcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcclxuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFxZW11LmhlYWx0aENoZWNrKSB7XHJcbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChtYW5hZ2VyLmJvb3REZWxheU1zID8/IDAsIHNpZ25hbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcclxuICAgIGNvbnN0IGludGVydmFsID0gbWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zID8/IDFfMDAwO1xyXG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xyXG5cclxuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXQpIHtcclxuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3Mgd2FpdCBjYW5jZWxsZWQuYCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIE1hdGgubWluKGludGVydmFsLCB0aW1lb3V0KSwgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnJlYWR5YCwgYFFFTVUgJHtncm91cE5hbWV9IHJlYWRpbmVzcyBjaGVja2ApO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChpbnRlcnZhbCwgc2lnbmFsKTtcclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgJHtncm91cE5hbWV9IGRpZCBub3QgYmVjb21lIHJlYWR5IHdpdGhpbiAke3RpbWVvdXR9IG1zJHtsYXN0RXJyb3IgPyBgOiAke2xhc3RFcnJvcn1gIDogXCIuXCJ9YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgcWVtdTogbG9vbVFlbXVDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xyXG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkIHx8IG1hbmFnZXIucGVyc2lzdCAhPT0gZmFsc2UpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XHJcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xyXG4gICAgaWYgKCFwaWQpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCkge1xyXG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcclxuICAgICAgICBtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCxcclxuICAgICAgICBncm91cFBhdGgsXHJcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXHJcbiAgICAgICAgc2lnbmFsLFxyXG4gICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6c2h1dGRvd25gLFxyXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXHJcbiAgICAgICk7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XHJcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XHJcbiAgICBpZiAoIXN0b3BwZWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcclxuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgXCJTSUdLSUxMXCIpO1xyXG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcclxuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XHJcbiAgICBpZiAoIXBpZCkge1xyXG4gICAgICByZXR1cm4gXCJzdG9wcGVkXCI7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2YWx1ZSA9IChhd2FpdCByZWFkRmlsZShwaWRQYXRoLCBcInV0ZjhcIikpLnRyaW0oKTtcclxuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBpZCkgJiYgcGlkID4gMCA/IHBpZCA6IG51bGw7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlzUHJvY2Vzc1J1bm5pbmcocGlkOiBudW1iZXIpOiBib29sZWFuIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JQcm9jZXNzRXhpdChwaWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XHJcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcclxuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoMjUwLCBzaWduYWwpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcclxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxyXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXHJcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXHJcbiAgICByZXF1ZXN0OiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3QsXHJcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcclxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXHJcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XHJcbiAgICBjb25zdCBjdXN0b20gPSB0aGlzLnJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnKTtcclxuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XHJcblxyXG4gICAgY29uc3QgcmVxdWVzdEZpbGVOYW1lID0gYHJlcXVlc3RfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfS5qc29uYDtcclxuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdFBhdGgsIGAke0pTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpfVxcbmAsIFwidXRmOFwiKTtcclxuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XHJcbiAgICAgICAgYXJnXHJcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCByZXF1ZXN0UGF0aClcclxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXHJcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cFBhdGh9XCIsIGdyb3VwUGF0aCksXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcclxuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOiR7cmVxdWVzdC5hY3Rpb259YCxcclxuICAgICAgICBydW5uZXJOYW1lOiBgQ3VzdG9tICR7Z3JvdXBOYW1lfSAke3JlcXVlc3QuYWN0aW9ufWAsXHJcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXHJcbiAgICAgICAgYXJncyxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXHJcbiAgICAgICAgdGltZW91dE1zLFxyXG4gICAgICAgIHNpZ25hbCxcclxuICAgICAgfSk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBhd2FpdCBybShyZXF1ZXN0UGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlQ3VzdG9tUmVxdWVzdChcclxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxyXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXHJcbiAgICBncm91cFBhdGg6IHN0cmluZyxcclxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcclxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxyXG4gICAgZXh0cmE6IFBhcnRpYWw8bG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0PiA9IHt9LFxyXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBhY3Rpb24sXHJcbiAgICAgIGdyb3VwTmFtZSxcclxuICAgICAgZ3JvdXBQYXRoLFxyXG4gICAgICBydW50aW1lOiBjb25maWcucnVudGltZSxcclxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcclxuICAgICAgYnVpbGQ6IGNvbmZpZy5jdXN0b20/LmJ1aWxkLFxyXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBjb25maWcuY3VzdG9tPy5jb21tYW5kU3RydWN0dXJlLFxyXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXHJcbiAgICAgIHRpbWVvdXRNcyxcclxuICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXHJcbiAgICAgICAgY3VzdG9tOiBjb25maWcuY3VzdG9tLFxyXG4gICAgICAgIHFlbXU6IGNvbmZpZy5xZW11LFxyXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXHJcbiAgICAgIH0sXHJcbiAgICAgIC4uLmV4dHJhLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBydW5uZXJJZCxcclxuICAgICAgcnVubmVyTmFtZSxcclxuICAgICAgc3RhcnRlZEF0OiBub3csXHJcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcclxuICAgICAgZHVyYXRpb25NczogMCxcclxuICAgICAgZXhpdENvZGU6IHN1Y2Nlc3MgPyAwIDogLTEsXHJcbiAgICAgIHN0ZG91dCxcclxuICAgICAgc3RkZXJyOiBcIlwiLFxyXG4gICAgICBzdWNjZXNzLFxyXG4gICAgICB0aW1lZE91dDogZmFsc2UsXHJcbiAgICAgIGNhbmNlbGxlZDogZmFsc2UsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBnZXRDb250YWluZXJzUGF0aCgpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgc2FmZU5hbWUgPSBiYXNlbmFtZShncm91cE5hbWUpO1xyXG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBzYWZlUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChqb2luKGdyb3VwUGF0aCwgZmlsZVBhdGgpKTtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRHcm91cFBhdGggPSBub3JtYWxpemVGc1BhdGgoZ3JvdXBQYXRoKTtcclxuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcclxuICAgIGNvbnN0IHBvc2l4R3JvdXBQYXRoID0gbm9ybWFsaXplZEdyb3VwUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcclxuICAgIGlmIChwb3NpeFNhZmVQYXRoICE9PSBwb3NpeEdyb3VwUGF0aCAmJiAhcG9zaXhTYWZlUGF0aC5zdGFydHNXaXRoKGAke3Bvc2l4R3JvdXBQYXRofS9gKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2FmZVBhdGg7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XHJcbiAgICBpZiAoIWxhbmdJZCkgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gbGFuZ0lkLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xyXG5cclxuICAgIC8vIENoZWNrIGN1c3RvbSBsYW5ndWFnZXMgZmlyc3RcclxuICAgIGNvbnN0IGN1c3RvbSA9IHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjKSA9PiB7XHJcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgICByZXR1cm4gbmFtZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XHJcbiAgICB9KTtcclxuICAgIGlmIChjdXN0b20pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBjb21tYW5kOiBgJHtjdXN0b20uZXhlY3V0YWJsZX0gJHtjdXN0b20uYXJnc31gLnRyaW0oKSxcclxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gU3RhbmRhcmQgYnVpbHQtaW5zXHJcbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcclxuICAgICAgY2FzZSBcInB5dGhvblwiOlxyXG4gICAgICBjYXNlIFwicHlcIjpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXHJcbiAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcclxuICAgICAgY2FzZSBcImpzXCI6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcclxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuanNcIixcclxuICAgICAgICB9O1xyXG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxyXG4gICAgICBjYXNlIFwidHNcIjpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcclxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudHNcIixcclxuICAgICAgICB9O1xyXG4gICAgICBjYXNlIFwic2hlbGxcIjpcclxuICAgICAgY2FzZSBcInNoXCI6XHJcbiAgICAgIGNhc2UgXCJiYXNoXCI6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNoZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJiYXNoXCJ9IHtmaWxlfWAsXHJcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNoXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgY2FzZSBcInJ1YnlcIjpcclxuICAgICAgY2FzZSBcInJiXCI6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1YnlcIn0ge2ZpbGV9YCxcclxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucmJcIixcclxuICAgICAgICB9O1xyXG4gICAgICBjYXNlIFwicGVybFwiOlxyXG4gICAgICBjYXNlIFwicGxcIjpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGVybEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGVybFwifSB7ZmlsZX1gLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5wbFwiLFxyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgXCJsdWFcIjpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcclxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubHVhXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgY2FzZSBcInBocFwiOlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5waHBFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBocFwifSB7ZmlsZX1gLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcclxuICAgICAgICB9O1xyXG4gICAgICBjYXNlIFwiZ29cIjpcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuZ29FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdvXCJ9IHJ1biB7ZmlsZX1gLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5nb1wiLFxyXG4gICAgICAgIH07XHJcbiAgICAgIGNhc2UgXCJoYXNrZWxsXCI6XHJcbiAgICAgIGNhc2UgXCJoc1wiOlxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJydW5naGNcIn0ge2ZpbGV9YCxcclxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuaHNcIixcclxuICAgICAgICB9O1xyXG4gICAgICBjYXNlIFwib2NhbWxcIjpcclxuICAgICAgY2FzZSBcIm1sXCI6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbFwifSB7ZmlsZX1gLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XHJcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNob3dEb2NrZXJOb3RpY2UobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgbmV3IE5vdGljZShtZXNzYWdlLCA4MDAwKTtcclxufVxyXG5cclxuZnVuY3Rpb24gb3B0aW9uYWxTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xyXG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XHJcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgfVxyXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuYCk7XHJcbiAgfVxyXG4gIHJldHVybiB2YWx1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xyXG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xyXG4gIH1cclxuICByZXR1cm4gdmFsdWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9wdGlvbmFsU2lnbmFsKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogTm9kZUpTLlNpZ25hbHMgfCB1bmRlZmluZWQge1xyXG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBzaWduYWwgbmFtZSBsaWtlIFNJR1RFUk0uYCk7XHJcbiAgfVxyXG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGlmIChkdXJhdGlvbk1zIDw9IDAgfHwgc2lnbmFsLmFib3J0ZWQpIHtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XHJcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcclxuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xyXG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XHJcbiAgICAgIHJlc29sdmUoKTtcclxuICAgIH07XHJcbiAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XHJcbiAgc3dpdGNoIChydW50aW1lKSB7XHJcbiAgICBjYXNlIFwiZG9ja2VyXCI6XHJcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xyXG4gICAgY2FzZSBcInBvZG1hblwiOlxyXG4gICAgICByZXR1cm4gXCJQb2RtYW5cIjtcclxuICAgIGNhc2UgXCJxZW11XCI6XHJcbiAgICAgIHJldHVybiBcIlFFTVVcIjtcclxuICAgIGNhc2UgXCJjdXN0b21cIjpcclxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XHJcbiAgICBjYXNlIFwid3NsXCI6XHJcbiAgICAgIHJldHVybiBcIldTTFwiO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcclxufVxyXG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xyXG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcclxuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XHJcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XHJcbiAgcnVubmVySWQ6IHN0cmluZztcclxuICBydW5uZXJOYW1lOiBzdHJpbmc7XHJcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xyXG4gIGFyZ3M6IHN0cmluZ1tdO1xyXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcclxuICB0aW1lb3V0TXM6IG51bWJlcjtcclxuICBzaWduYWw6IEFib3J0U2lnbmFsO1xyXG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlU3BlYyBleHRlbmRzIGxvb21Qcm9jZXNzU3BlYyB7XHJcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xyXG4gIHNvdXJjZTogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcclxuICB0ZW1wRGlyOiBzdHJpbmc7XHJcbiAgdGVtcEZpbGU6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlPFQ+KFxyXG4gIGZpbGVOYW1lOiBzdHJpbmcsXHJcbiAgc291cmNlOiBzdHJpbmcsXHJcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxyXG4pOiBQcm9taXNlPFQ+IHtcclxuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tXCIpKTtcclxuICBjb25zdCB0ZW1wRmlsZSA9IGpvaW4odGVtcERpciwgZmlsZU5hbWUpO1xyXG5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlLCBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZSksIFwidXRmOFwiKTtcclxuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxyXG4gIGZpbGVFeHRlbnNpb246IHN0cmluZyxcclxuICBzb3VyY2U6IHN0cmluZyxcclxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXHJcbik6IFByb21pc2U8VD4ge1xyXG4gIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShgc25pcHBldCR7ZmlsZUV4dGVuc2lvbn1gLCBzb3VyY2UsIGNhbGxiYWNrKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XHJcbiAgY29uc3Qgbm9uRW1wdHlMaW5lcyA9IGxpbmVzLmZpbHRlcigobGluZSkgPT4gbGluZS50cmltKCkubGVuZ3RoID4gMCk7XHJcbiAgaWYgKCFub25FbXB0eUxpbmVzLmxlbmd0aCkge1xyXG4gICAgcmV0dXJuIHNvdXJjZTtcclxuICB9XHJcblxyXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcclxuICBmb3IgKGNvbnN0IGxpbmUgb2Ygbm9uRW1wdHlMaW5lcy5zbGljZSgxKSkge1xyXG4gICAgc2hhcmVkSW5kZW50ID0gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChzaGFyZWRJbmRlbnQsIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpKTtcclxuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XHJcbiAgICAgIHJldHVybiBzb3VyY2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBpZiAoIXNoYXJlZEluZGVudCkge1xyXG4gICAgcmV0dXJuIHNvdXJjZTtcclxuICB9XHJcblxyXG4gIHJldHVybiBsaW5lc1xyXG4gICAgLm1hcCgobGluZSkgPT4gKGxpbmUudHJpbSgpLmxlbmd0aCA9PT0gMCA/IGxpbmUgOiBsaW5lLnN0YXJ0c1dpdGgoc2hhcmVkSW5kZW50KSA/IGxpbmUuc2xpY2Uoc2hhcmVkSW5kZW50Lmxlbmd0aCkgOiBsaW5lKSlcclxuICAgIC5qb2luKFwiXFxuXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcclxuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgbGV0IGluZGV4ID0gMDtcclxuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XHJcbiAgICBpbmRleCArPSAxO1xyXG4gIH1cclxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IG5ldyBEYXRlKCk7XHJcbiAgbGV0IHN0ZG91dCA9IFwiXCI7XHJcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XHJcbiAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxuICBsZXQgdGltZWRPdXQgPSBmYWxzZTtcclxuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XHJcbiAgbGV0IGNoaWxkOiBSZXR1cm5UeXBlPHR5cGVvZiBzcGF3bj4gfCBudWxsID0gbnVsbDtcclxuICBsZXQgdGltZW91dEhhbmRsZTogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcclxuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgY2hpbGQgPSBzcGF3bihzcGVjLmV4ZWN1dGFibGUsIHNwZWMuYXJncywge1xyXG4gICAgICAgIGN3ZDogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcclxuICAgICAgICBlbnY6IHtcclxuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxyXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcclxuICAgICAgICBjYW5jZWxsZWQgPSB0cnVlO1xyXG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcclxuICAgICAgfTtcclxuICAgICAgYWJvcnRIYW5kbGVyID0gYWJvcnQ7XHJcblxyXG4gICAgICBpZiAoc3BlYy5zaWduYWwuYWJvcnRlZCkge1xyXG4gICAgICAgIGFib3J0KCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc3BlYy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRpbWVvdXRIYW5kbGUgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICB0aW1lZE91dCA9IHRydWU7XHJcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xyXG4gICAgICB9LCBzcGVjLnRpbWVvdXRNcyk7XHJcblxyXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcclxuICAgICAgICBzdGRvdXQgKz0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjaGlsZC5zdGRlcnI/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcclxuICAgICAgICBzdGRlcnIgKz0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xyXG4gICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xyXG4gICAgICAgIGV4aXRDb2RlID0gY29kZTtcclxuICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XHJcbiAgICBleGl0Q29kZSA9IGV4aXRDb2RlID8/IC0xO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XHJcbiAgICAgIHNwZWMuc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydEhhbmRsZXIpO1xyXG4gICAgfVxyXG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcclxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXRIYW5kbGUpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcclxuICBjb25zdCBzdWNjZXNzID0gIXRpbWVkT3V0ICYmICFjYW5jZWxsZWQgJiYgZXhpdENvZGUgPT09IDA7XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcclxuICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcclxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXHJcbiAgICBmaW5pc2hlZEF0OiBmaW5pc2hlZEF0LnRvSVNPU3RyaW5nKCksXHJcbiAgICBkdXJhdGlvbk1zLFxyXG4gICAgZXhpdENvZGUsXHJcbiAgICBzdGRvdXQsXHJcbiAgICBzdGRlcnIsXHJcbiAgICBzdWNjZXNzLFxyXG4gICAgdGltZWRPdXQsXHJcbiAgICBjYW5jZWxsZWQsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcclxuICAgIHJldHVybiBgRXhlY3V0YWJsZSBub3QgZm91bmQ6ICR7ZXhlY3V0YWJsZX1gO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRlbXBGaWxlUHJvY2VzcyhzcGVjOiBsb29tVGVtcFNvdXJjZVNwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XHJcbiAgICBydW5Qcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXHJcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcclxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlLFxyXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MubWFwKCh2YWx1ZSkgPT4gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSksXHJcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgdGltZW91dE1zOiBzcGVjLnRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsOiBzcGVjLnNpZ25hbCxcclxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcclxuICAgIH0pLFxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGV4cGFuZFRlbXBsYXRlZEVudihlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkLCB0ZW1wRmlsZTogc3RyaW5nLCB0ZW1wRGlyOiBzdHJpbmcpOiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCB7XHJcbiAgaWYgKCFlbnYpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxyXG4gICAgT2JqZWN0LmVudHJpZXMoZW52KS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW1xyXG4gICAgICBrZXksXHJcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcclxuICAgIF0pLFxyXG4gICk7XHJcbn1cclxuIiwgImV4cG9ydCBmdW5jdGlvbiBzcGxpdENvbW1hbmRMaW5lKGlucHV0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XHJcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xyXG4gIGxldCBxdW90ZTogXCInXCIgfCBcIlxcXCJcIiB8IG51bGwgPSBudWxsO1xyXG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xyXG5cclxuICBmb3IgKGNvbnN0IGNoYXIgb2YgaW5wdXQudHJpbSgpKSB7XHJcbiAgICBpZiAoZXNjYXBpbmcpIHtcclxuICAgICAgY3VycmVudCArPSBjaGFyO1xyXG4gICAgICBlc2NhcGluZyA9IGZhbHNlO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcclxuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoKGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09IFwiXFxcIlwiKSAmJiAhcXVvdGUpIHtcclxuICAgICAgcXVvdGUgPSBjaGFyO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcclxuICAgICAgcXVvdGUgPSBudWxsO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcclxuICAgICAgaWYgKGN1cnJlbnQpIHtcclxuICAgICAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xyXG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGN1cnJlbnQgKz0gY2hhcjtcclxuICB9XHJcblxyXG4gIGlmIChjdXJyZW50KSB7XHJcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHBhcnRzO1xyXG59XHJcbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xyXG5pbXBvcnQgdHlwZSB7IFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xyXG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xyXG5cclxuaW50ZXJmYWNlIExsdm1Ub2tlbiB7XHJcbiAgZnJvbTogbnVtYmVyO1xyXG4gIHRvOiBudW1iZXI7XHJcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XHJcbn1cclxuXHJcbmNvbnN0IExMVk1fS0VZV09SRFMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPihbXHJcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb250cm9sXCIsIFtcclxuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxyXG4gIF0pLFxyXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtZGVjbGFyYXRpb25cIiwgW1xyXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxyXG4gICAgXCJwZXJzb25hbGl0eVwiLCBcInVzZWxpc3RvcmRlclwiLCBcInVzZWxpc3RvcmRlcl9iYlwiLCBcIm1vZHVsZVwiLCBcImFzbVwiLCBcInNvdXJjZV9maWxlbmFtZVwiLCBcInRhcmdldFwiLFxyXG4gIF0pLFxyXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcclxuICAgIFwiYWxsb2NhXCIsIFwibG9hZFwiLCBcInN0b3JlXCIsIFwiZ2V0ZWxlbWVudHB0clwiLCBcImZlbmNlXCIsIFwiY21weGNoZ1wiLCBcImF0b21pY3Jtd1wiLCBcImV4dHJhY3R2YWx1ZVwiLCBcImluc2VydHZhbHVlXCIsIFwiZXh0cmFjdGVsZW1lbnRcIixcclxuICAgIFwiaW5zZXJ0ZWxlbWVudFwiLCBcInNodWZmbGV2ZWN0b3JcIixcclxuICBdKSxcclxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWFyaXRobWV0aWNcIiwgW1xyXG4gICAgXCJhZGRcIiwgXCJzdWJcIiwgXCJtdWxcIiwgXCJ1ZGl2XCIsIFwic2RpdlwiLCBcInVyZW1cIiwgXCJzcmVtXCIsIFwic2hsXCIsIFwibHNoclwiLCBcImFzaHJcIiwgXCJhbmRcIiwgXCJvclwiLCBcInhvclwiLCBcImZuZWdcIiwgXCJmYWRkXCIsIFwiZnN1YlwiLCBcImZtdWxcIixcclxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcclxuICBdKSxcclxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbXBhcmlzb25cIiwgW1wiaWNtcFwiLCBcImZjbXBcIl0pLFxyXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXHJcbiAgICBcInRydW5jXCIsIFwiemV4dFwiLCBcInNleHRcIiwgXCJmcHRydW5jXCIsIFwiZnBleHRcIiwgXCJmcHRvdWlcIiwgXCJmcHRvc2lcIiwgXCJ1aXRvZnBcIiwgXCJzaXRvZnBcIiwgXCJwdHJ0b2ludFwiLCBcImludHRvcHRyXCIsIFwiYml0Y2FzdFwiLCBcImFkZHJzcGFjZWNhc3RcIixcclxuICBdKSxcclxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcclxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1vZGlmaWVyXCIsIFtcclxuICAgIFwicHJpdmF0ZVwiLCBcImludGVybmFsXCIsIFwiYXZhaWxhYmxlX2V4dGVybmFsbHlcIiwgXCJsaW5rb25jZVwiLCBcIndlYWtcIiwgXCJjb21tb25cIiwgXCJhcHBlbmRpbmdcIiwgXCJleHRlcm5fd2Vha1wiLCBcImxpbmtvbmNlX29kclwiLCBcIndlYWtfb2RyXCIsXHJcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcclxuICAgIFwidGhyZWFkX2xvY2FsXCIsIFwibG9jYWxkeW5hbWljXCIsIFwiaW5pdGlhbGV4ZWNcIiwgXCJsb2NhbGV4ZWNcIiwgXCJ1bm5hbWVkX2FkZHJcIiwgXCJsb2NhbF91bm5hbWVkX2FkZHJcIiwgXCJhdG9taWNcIiwgXCJ1bm9yZGVyZWRcIiwgXCJtb25vdG9uaWNcIixcclxuICAgIFwiYWNxdWlyZVwiLCBcInJlbGVhc2VcIiwgXCJhY3FfcmVsXCIsIFwic2VxX2NzdFwiLCBcInN5bmNzY29wZVwiLCBcInZvbGF0aWxlXCIsIFwic2luZ2xldGhyZWFkXCIsIFwiY2NjXCIsIFwiZmFzdGNjXCIsIFwiY29sZGNjXCIsIFwid2Via2l0X2pzY2NcIixcclxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxyXG4gICAgXCJmYXN0XCIsIFwibm5hblwiLCBcIm5pbmZcIiwgXCJuc3pcIiwgXCJhcmNwXCIsIFwiY29udHJhY3RcIiwgXCJhZm5cIiwgXCJyZWFzc29jXCIsIFwibnV3XCIsIFwibnN3XCIsIFwiZXhhY3RcIiwgXCJpbmJvdW5kc1wiLCBcInRvXCIsIFwieFwiLFxyXG4gIF0pLFxyXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXHJcbiAgICBcImVxXCIsIFwibmVcIiwgXCJ1Z3RcIiwgXCJ1Z2VcIiwgXCJ1bHRcIiwgXCJ1bGVcIiwgXCJzZ3RcIiwgXCJzZ2VcIiwgXCJzbHRcIiwgXCJzbGVcIiwgXCJvZXFcIiwgXCJvZ3RcIiwgXCJvZ2VcIiwgXCJvbHRcIiwgXCJvbGVcIiwgXCJvbmVcIiwgXCJvcmRcIiwgXCJ1ZXFcIiwgXCJ1bmVcIixcclxuICAgIFwidW5vXCIsXHJcbiAgXSksXHJcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tYXR0cmlidXRlXCIsIFtcclxuICAgIFwiYWx3YXlzaW5saW5lXCIsIFwiYXJnbWVtb25seVwiLCBcImJ1aWx0aW5cIiwgXCJieXJlZlwiLCBcImJ5dmFsXCIsIFwiY29sZFwiLCBcImNvbnZlcmdlbnRcIiwgXCJkZXJlZmVyZW5jZWFibGVcIiwgXCJkZXJlZmVyZW5jZWFibGVfb3JfbnVsbFwiLCBcImRpc3RpbmN0XCIsXHJcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXHJcbiAgICBcIm5vbm51bGxcIiwgXCJub3JlY3Vyc2VcIiwgXCJub3JlZHpvbmVcIiwgXCJub3JldHVyblwiLCBcIm5vc3luY1wiLCBcIm5vdW53aW5kXCIsIFwibnVsbF9wb2ludGVyX2lzX3ZhbGlkXCIsIFwib3BhcXVlXCIsIFwib3B0bm9uZVwiLCBcIm9wdHNpemVcIixcclxuICAgIFwicHJlYWxsb2NhdGVkXCIsIFwicmVhZG5vbmVcIiwgXCJyZWFkb25seVwiLCBcInJldHVybmVkXCIsIFwicmV0dXJuc190d2ljZVwiLCBcInNhbml0aXplX2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9od2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9tZW1vcnlcIixcclxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcclxuICAgIFwid2lsbHJldHVyblwiLCBcIndyaXRlb25seVwiLCBcInplcm9leHRcIixcclxuICBdKSxcclxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcclxuXSk7XHJcblxyXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xyXG4gIFwidm9pZFwiLCBcImxhYmVsXCIsIFwidG9rZW5cIiwgXCJtZXRhZGF0YVwiLCBcIng4Nl9tbXhcIiwgXCJ4ODZfYW14XCIsIFwiaGFsZlwiLCBcImJmbG9hdFwiLCBcImZsb2F0XCIsIFwiZG91YmxlXCIsIFwiZnAxMjhcIiwgXCJ4ODZfZnA4MFwiLCBcInBwY19mcDEyOFwiLCBcInB0clwiLFxyXG5dKTtcclxuXHJcbmNvbnN0IFBVTkNUVUFUSU9OX0NMQVNTID0gXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIjtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgY29kZUVsZW1lbnQuZW1wdHkoKTtcclxuICBjb2RlRWxlbWVudC5hZGRDbGFzcyhcImxvb20tbGx2bS1jb2RlXCIpO1xyXG5cclxuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcclxuICBsaW5lcy5mb3JFYWNoKChsaW5lLCBpbmRleCkgPT4ge1xyXG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcclxuICAgIGlmIChpbmRleCA8IGxpbmVzLmxlbmd0aCAtIDEpIHtcclxuICAgICAgY29kZUVsZW1lbnQuYXBwZW5kVGV4dChcIlxcblwiKTtcclxuICAgIH1cclxuICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFkZExsdm1EZWNvcmF0aW9ucyhcclxuICBidWlsZGVyOiBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4sXHJcbiAgdmlldzogRWRpdG9yVmlldyxcclxuICBibG9jazogbG9vbUNvZGVCbG9jayxcclxuKTogdm9pZCB7XHJcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xyXG4gIGlmICghY29udGVudExpbmVDb3VudCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgbGluZXMgPSBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpO1xyXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XHJcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdID8/IFwiXCI7XHJcbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpO1xyXG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRvY0xpbmUgPSB2aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDIgKyBpbmRleCk7XHJcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xyXG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBidWlsZGVyLmFkZChcclxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi5mcm9tLFxyXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLnRvLFxyXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgbGV0IGN1cnNvciA9IDA7XHJcblxyXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xyXG4gICAgaWYgKHRva2VuLmZyb20gPiBjdXJzb3IpIHtcclxuICAgICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IsIHRva2VuLmZyb20pKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzcGFuID0gY29udGFpbmVyLmNyZWF0ZVNwYW4oeyBjbHM6IHRva2VuLmNsYXNzTmFtZSB9KTtcclxuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XHJcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcclxuICB9XHJcblxyXG4gIGlmIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xyXG4gICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IpKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xyXG4gIGNvbnN0IHRva2VuczogTGx2bVRva2VuW10gPSBbXTtcclxuICBsZXQgaW5kZXggPSAwO1xyXG5cclxuICBhZGRMYWJlbFRva2VuKGxpbmUsIHRva2Vucyk7XHJcblxyXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBjdXJyZW50ID0gbGluZVtpbmRleF07XHJcbiAgICBpZiAoY3VycmVudCA9PT0gXCI7XCIpIHtcclxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcclxuICAgICAgYnJlYWs7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKC9cXHMvLnRlc3QoY3VycmVudCkpIHtcclxuICAgICAgaW5kZXggKz0gMTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xyXG4gICAgaWYgKHN0cmluZ1Rva2VuKSB7XHJcbiAgICAgIGlmIChzdHJpbmdUb2tlbi5wcmVmaXhFbmQgPiBpbmRleCkge1xyXG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogc3RyaW5nVG9rZW4udmFsdWVTdGFydCwgdG86IHN0cmluZ1Rva2VuLnZhbHVlRW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZ1wiIH0pO1xyXG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtYXRjaGVkID1cclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQGxsdm1cXC5bQS1aYS16JC5fMC05XSsveSwgXCJsb29tLWxsdm0taW50cmluc2ljXCIsIHRva2VucykgfHxcclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbG9jYWxcIiwgdG9rZW5zKSB8fFxyXG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8hW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwhXFxkK1xcYi95LCBcImxvb20tbGx2bS1tZXRhZGF0YVwiLCB0b2tlbnMpIHx8XHJcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvI1xcZCtcXGIveSwgXCJsb29tLWxsdm0tYXR0cmlidXRlLWdyb3VwXCIsIHRva2VucykgfHxcclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFxiYWRkcnNwYWNlXFxzKlxcKFxccypcXGQrXFxzKlxcKS95LCBcImxvb20tbGx2bS10eXBlXCIsIHRva2VucykgfHxcclxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxyXG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCt8XFxkKykoPzpbZUVdWy0rXT9cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxyXG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XHJcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxyXG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXC5cXC5cXC4veSwgXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIiwgdG9rZW5zKTtcclxuXHJcbiAgICBpZiAobWF0Y2hlZCkge1xyXG4gICAgICBpbmRleCA9IG1hdGNoZWQ7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHdvcmQgPSByZWFkV29yZChsaW5lLCBpbmRleCk7XHJcbiAgICBpZiAod29yZCkge1xyXG4gICAgICB0b2tlbnMucHVzaCh7XHJcbiAgICAgICAgZnJvbTogaW5kZXgsXHJcbiAgICAgICAgdG86IHdvcmQuZW5kLFxyXG4gICAgICAgIGNsYXNzTmFtZTogY2xhc3NpZnlXb3JkKHdvcmQudmFsdWUpLFxyXG4gICAgICB9KTtcclxuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKFwiKClbXXt9PD4sOj0qXCIuaW5jbHVkZXMoY3VycmVudCkpIHtcclxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGluZGV4ICsgMSwgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyB9KTtcclxuICAgICAgaW5kZXggKz0gMTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgaW5kZXggKz0gMTtcclxuICB9XHJcblxyXG4gIHJldHVybiBub3JtYWxpemVUb2tlbnModG9rZW5zKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYWRkTGFiZWxUb2tlbihsaW5lOiBzdHJpbmcsIHRva2VuczogTGx2bVRva2VuW10pOiB2b2lkIHtcclxuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxzKikoPzooW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxcXGQrKXwoJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCspKSg6KS8pO1xyXG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgbGFiZWxTdGFydCA9IG1hdGNoWzFdLmxlbmd0aDtcclxuICBjb25zdCBsYWJlbFRleHQgPSBtYXRjaFsyXSA/PyBtYXRjaFszXTtcclxuICBpZiAoIWxhYmVsVGV4dCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgdG9rZW5zLnB1c2goe1xyXG4gICAgZnJvbTogbGFiZWxTdGFydCxcclxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcclxuICAgIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tbGFiZWxcIixcclxuICB9KTtcclxuICB0b2tlbnMucHVzaCh7XHJcbiAgICBmcm9tOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcclxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCArIDEsXHJcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxyXG4gIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjbGFzc2lmeVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcclxuICBpZiAoL15pXFxkKyQvLnRlc3Qod29yZCkgfHwgTExWTV9QUklNSVRJVkVfVFlQRVMuaGFzKHdvcmQpKSB7XHJcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xyXG4gIGNvbnN0IG1hdGNoID0gL1tBLVphLXpfXVtBLVphLXowLTlfLi1dKi95O1xyXG4gIG1hdGNoLmxhc3RJbmRleCA9IGluZGV4O1xyXG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XHJcbiAgaWYgKCFyZXN1bHQpIHtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHZhbHVlOiByZXN1bHRbMF0sXHJcbiAgICBlbmQ6IG1hdGNoLmxhc3RJbmRleCxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkU3RyaW5nVG9rZW4obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyBwcmVmaXhFbmQ6IG51bWJlcjsgdmFsdWVTdGFydDogbnVtYmVyOyB2YWx1ZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcclxuICBsZXQgY3Vyc29yID0gaW5kZXg7XHJcbiAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJjXCIgJiYgbGluZVtjdXJzb3IgKyAxXSA9PT0gXCJcXFwiXCIpIHtcclxuICAgIGN1cnNvciArPSAxO1xyXG4gIH1cclxuXHJcbiAgaWYgKGxpbmVbY3Vyc29yXSAhPT0gXCJcXFwiXCIpIHtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcclxuICBjdXJzb3IgKz0gMTtcclxuICB3aGlsZSAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcclxuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XHJcbiAgICAgIGN1cnNvciArPSAyO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcIlwiKSB7XHJcbiAgICAgIGN1cnNvciArPSAxO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICAgIGN1cnNvciArPSAxO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcclxuICAgIHZhbHVlU3RhcnQsXHJcbiAgICB2YWx1ZUVuZDogY3Vyc29yLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcclxuICBsaW5lOiBzdHJpbmcsXHJcbiAgaW5kZXg6IG51bWJlcixcclxuICByZWdleDogUmVnRXhwLFxyXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxyXG4gIHRva2VuczogTGx2bVRva2VuW10sXHJcbik6IG51bWJlciB8IG51bGwge1xyXG4gIHJlZ2V4Lmxhc3RJbmRleCA9IGluZGV4O1xyXG4gIGNvbnN0IG1hdGNoID0gcmVnZXguZXhlYyhsaW5lKTtcclxuICBpZiAoIW1hdGNoKSB7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcblxyXG4gIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiByZWdleC5sYXN0SW5kZXgsIGNsYXNzTmFtZSB9KTtcclxuICByZXR1cm4gcmVnZXgubGFzdEluZGV4O1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVUb2tlbnModG9rZW5zOiBMbHZtVG9rZW5bXSk6IExsdm1Ub2tlbltdIHtcclxuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcclxuICBjb25zdCBub3JtYWxpemVkOiBMbHZtVG9rZW5bXSA9IFtdO1xyXG4gIGxldCBjdXJzb3IgPSAwO1xyXG5cclxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xyXG4gICAgaWYgKHRva2VuLnRvIDw9IGN1cnNvcikge1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcclxuICAgIG5vcm1hbGl6ZWQucHVzaCh7IC4uLnRva2VuLCBmcm9tIH0pO1xyXG4gICAgY3Vyc29yID0gdG9rZW4udG87XHJcbiAgfVxyXG5cclxuICByZXR1cm4gbm9ybWFsaXplZDtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q29udGVudExpbmVDb3VudChibG9jazogbG9vbUNvZGVCbG9jayk6IG51bWJlciB7XHJcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xyXG4gICAgcmV0dXJuIDA7XHJcbiAgfVxyXG5cclxuICBpZiAoYmxvY2suY29udGVudC5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiBibG9jay5lbmRMaW5lID4gYmxvY2suc3RhcnRMaW5lICsgMSA/IDEgOiAwO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYXBXb3JkcyhjbGFzc05hbWU6IHN0cmluZywgd29yZHM6IHN0cmluZ1tdKTogQXJyYXk8W3N0cmluZywgc3RyaW5nXT4ge1xyXG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcclxufVxyXG4iLCAiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzaG9ydEhhc2goaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKGlucHV0KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpO1xyXG59XHJcbiIsICJpbXBvcnQgeyBzaG9ydEhhc2ggfSBmcm9tIFwiLi91dGlscy9oYXNoXCI7XHJcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcclxuXHJcbmNvbnN0IExBTkdVQUdFX0FMSUFTRVM6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+ID0ge1xyXG4gIHB5dGhvbjogXCJweXRob25cIixcclxuICBweTogXCJweXRob25cIixcclxuICBqYXZhc2NyaXB0OiBcImphdmFzY3JpcHRcIixcclxuICBqczogXCJqYXZhc2NyaXB0XCIsXHJcbiAgdHlwZXNjcmlwdDogXCJ0eXBlc2NyaXB0XCIsXHJcbiAgdHM6IFwidHlwZXNjcmlwdFwiLFxyXG4gIG9jYW1sOiBcIm9jYW1sXCIsXHJcbiAgbWw6IFwib2NhbWxcIixcclxuICBjOiBcImNcIixcclxuICBoOiBcImNcIixcclxuICBjcHA6IFwiY3BwXCIsXHJcbiAgY3h4OiBcImNwcFwiLFxyXG4gIGNjOiBcImNwcFwiLFxyXG4gIFwiYysrXCI6IFwiY3BwXCIsXHJcbiAgc2hlbGw6IFwic2hlbGxcIixcclxuICBzaDogXCJzaGVsbFwiLFxyXG4gIGJhc2g6IFwic2hlbGxcIixcclxuICB6c2g6IFwic2hlbGxcIixcclxuICBydWJ5OiBcInJ1YnlcIixcclxuICByYjogXCJydWJ5XCIsXHJcbiAgcGVybDogXCJwZXJsXCIsXHJcbiAgcGw6IFwicGVybFwiLFxyXG4gIGx1YTogXCJsdWFcIixcclxuICBwaHA6IFwicGhwXCIsXHJcbiAgZ286IFwiZ29cIixcclxuICBnb2xhbmc6IFwiZ29cIixcclxuICBydXN0OiBcInJ1c3RcIixcclxuICByczogXCJydXN0XCIsXHJcbiAgaGFza2VsbDogXCJoYXNrZWxsXCIsXHJcbiAgaHM6IFwiaGFza2VsbFwiLFxyXG4gIGphdmE6IFwiamF2YVwiLFxyXG4gIGxsdm06IFwibGx2bS1pclwiLFxyXG4gIGxsdm1pcjogXCJsbHZtLWlyXCIsXHJcbiAgXCJsbHZtLWlyXCI6IFwibGx2bS1pclwiLFxyXG4gIGxsOiBcImxsdm0taXJcIixcclxuICBsZWFuOiBcImxlYW5cIixcclxuICBsZWFuNDogXCJsZWFuXCIsXHJcbiAgY29xOiBcImNvcVwiLFxyXG4gIHY6IFwiY29xXCIsXHJcbiAgc210OiBcInNtdGxpYlwiLFxyXG4gIHNtdDI6IFwic210bGliXCIsXHJcbiAgc210bGliOiBcInNtdGxpYlwiLFxyXG4gIFwic210LWxpYlwiOiBcInNtdGxpYlwiLFxyXG4gIHozOiBcInNtdGxpYlwiLFxyXG59O1xyXG5cclxuY29uc3QgT1VUUFVUX1NUQVJUID0gL148IS0tXFxzKmxvb206b3V0cHV0OnN0YXJ0XFxzK2lkPShbYS1mMC05XSspXFxzKi0tPiQvaTtcclxuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xyXG5jb25zdCBGRU5DRV9TVEFSVCA9IC9eKGBgYCt8fn5+KylcXHMqKFteXFxzYF0qKT8uKiQvO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlKHJhd0xhbmd1YWdlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSB8IG51bGwge1xyXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuXHJcbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XHJcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcclxuICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XHJcbiAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiBMQU5HVUFHRV9BTElBU0VTW25vcm1hbGl6ZWRdID8/IG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMoc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmdbXSB7XHJcbiAgcmV0dXJuIFtcclxuICAgIC4uLk9iamVjdC5rZXlzKExBTkdVQUdFX0FMSUFTRVMpLFxyXG4gICAgLi4uKHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pLmZsYXRNYXAoKGxhbmd1YWdlKSA9PiBbbGFuZ3VhZ2UubmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldKSxcclxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGg6IHN0cmluZywgc291cmNlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvZGVCbG9ja1tdIHtcclxuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xyXG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XHJcbiAgbGV0IG9yZGluYWwgPSAwO1xyXG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XHJcblxyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpICs9IDEpIHtcclxuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcclxuXHJcbiAgICBpZiAoaW5zaWRlTWFuYWdlZE91dHB1dCkge1xyXG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xyXG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcclxuICAgICAgfVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XHJcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmZW5jZU1hdGNoID0gbGluZS5tYXRjaChGRU5DRV9TVEFSVCk7XHJcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcclxuICAgIGNvbnN0IGZlbmNlSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSk7XHJcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcclxuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xyXG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBub3JtYWxpemVMYW5ndWFnZShzb3VyY2VMYW5ndWFnZSwgc2V0dGluZ3MpO1xyXG5cclxuICAgIGxldCBlbmRMaW5lID0gaTtcclxuICAgIGNvbnN0IGNvbnRlbnRMaW5lczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xyXG4gICAgICBjb25zdCBpbm5lckxpbmUgPSBsaW5lc1tqXTtcclxuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XHJcblxyXG4gICAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKGZlbmNlVG9rZW4pICYmIC9eKGBgYCt8fn5+KylcXHMqJC8udGVzdCh0cmltbWVkKSkge1xyXG4gICAgICAgIGVuZExpbmUgPSBqO1xyXG4gICAgICAgIGkgPSBqO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb250ZW50TGluZXMucHVzaChzdHJpcEZlbmNlSW5kZW50KGlubmVyTGluZSwgZmVuY2VJbmRlbnQpKTtcclxuICAgICAgZW5kTGluZSA9IGo7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFsYW5ndWFnZSkge1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICBvcmRpbmFsICs9IDE7XHJcbiAgICBjb25zdCBjb250ZW50ID0gY29udGVudExpbmVzLmpvaW4oXCJcXG5cIik7XHJcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChjb250ZW50KTtcclxuICAgIGNvbnN0IGlkID0gc2hvcnRIYXNoKGAke2ZpbGVQYXRofToke29yZGluYWx9OiR7bGFuZ3VhZ2V9OiR7Y29udGVudEhhc2h9YCk7XHJcblxyXG4gICAgYmxvY2tzLnB1c2goe1xyXG4gICAgICBpZCxcclxuICAgICAgb3JkaW5hbCxcclxuICAgICAgZmlsZVBhdGgsXHJcbiAgICAgIGxhbmd1YWdlLFxyXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxyXG4gICAgICBzb3VyY2VMYW5ndWFnZSxcclxuICAgICAgY29udGVudCxcclxuICAgICAgc3RhcnRMaW5lLFxyXG4gICAgICBlbmRMaW5lLFxyXG4gICAgICBmZW5jZVN0YXJ0OiAwLFxyXG4gICAgICBmZW5jZUVuZDogMCxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGJsb2NrcztcclxufVxyXG5cclxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICByZXR1cm4gdmFsdWVcclxuICAgIC5zcGxpdChcIixcIilcclxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcclxuICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcclxuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xyXG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcclxuICBpZiAoIWZlbmNlSW5kZW50KSB7XHJcbiAgICByZXR1cm4gbGluZTtcclxuICB9XHJcblxyXG4gIGxldCBpbmRleCA9IDA7XHJcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xyXG4gICAgaW5kZXggKz0gMTtcclxuICB9XHJcblxyXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcclxufVxyXG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XHJcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIE5vZGVSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwibm9kZVwiO1xyXG4gIGRpc3BsYXlOYW1lID0gXCJOb2RlLmpzXCI7XHJcbiAgbGFuZ3VhZ2VzID0gW1wiamF2YXNjcmlwdFwiLCBcInR5cGVzY3JpcHRcIl0gYXMgY29uc3Q7XHJcblxyXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xyXG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcclxuICAgICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxyXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSxcclxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXHJcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuanNcIixcclxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXHJcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXHJcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCk7XHJcbiAgICBjb25zdCBydW5uZXJOYW1lID0gc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPT09IFwidHN4XCIgPyBcIlR5cGVTY3JpcHQgKHRzeClcIiA6IFwiVHlwZVNjcmlwdCAodHMtbm9kZSlcIjtcclxuXHJcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7c2V0dGluZ3MudHlwZXNjcmlwdE1vZGV9YCxcclxuICAgICAgcnVubmVyTmFtZSxcclxuICAgICAgZXhlY3V0YWJsZSxcclxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxyXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxyXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXHJcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcclxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XHJcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xyXG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIEN1c3RvbUxhbmd1YWdlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XHJcbiAgaWQgPSBcImN1c3RvbVwiO1xyXG4gIGRpc3BsYXlOYW1lID0gXCJDdXN0b20gbGFuZ3VhZ2VcIjtcclxuICBsYW5ndWFnZXMgPSBbXSBhcyBjb25zdDtcclxuXHJcbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk/LmV4ZWN1dGFibGUudHJpbSgpKTtcclxuICB9XHJcblxyXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xyXG4gICAgaWYgKCFsYW5ndWFnZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGN1c3RvbSBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxyXG4gICAgICBydW5uZXJOYW1lOiBsYW5ndWFnZS5uYW1lLFxyXG4gICAgICBleGVjdXRhYmxlOiBsYW5ndWFnZS5leGVjdXRhYmxlLnRyaW0oKSxcclxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxyXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uLCBsYW5ndWFnZS5uYW1lKSxcclxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxyXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXHJcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ3VzdG9tTGFuZ3VhZ2UgfCB1bmRlZmluZWQge1xyXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgcmV0dXJuIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChsYW5ndWFnZSkgPT4ge1xyXG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcclxuICAgICAgICAuc3BsaXQoXCIsXCIpXHJcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxyXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcclxuICBpZiAoIXRyaW1tZWQpIHtcclxuICAgIHJldHVybiBgLiR7bmFtZX1gO1xyXG4gIH1cclxuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xyXG59XHJcbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5pbnRlcmZhY2UgSW50ZXJwcmV0ZWRTcGVjIHtcclxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcclxuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xyXG4gIGV4ZWN1dGFibGU6IChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKSA9PiBzdHJpbmc7XHJcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xyXG4gIGFyZ3M/OiBzdHJpbmdbXTtcclxuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0VudjtcclxuICBtaW5pbXVtVGltZW91dE1zPzogbnVtYmVyO1xyXG59XHJcblxyXG5jb25zdCBJTlRFUlBSRVRFRF9TUEVDUzogSW50ZXJwcmV0ZWRTcGVjW10gPSBbXHJcbiAge1xyXG4gICAgbGFuZ3VhZ2U6IFwic2hlbGxcIixcclxuICAgIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsXHJcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcclxuICAgIGZpbGVFeHRlbnNpb246IFwiLnNoXCIsXHJcbiAgfSxcclxuICB7XHJcbiAgICBsYW5ndWFnZTogXCJydWJ5XCIsXHJcbiAgICBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsXHJcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxyXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucmJcIixcclxuICB9LFxyXG4gIHtcclxuICAgIGxhbmd1YWdlOiBcInBlcmxcIixcclxuICAgIGRpc3BsYXlOYW1lOiBcIlBlcmxcIixcclxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXHJcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5wbFwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbGFuZ3VhZ2U6IFwibHVhXCIsXHJcbiAgICBkaXNwbGF5TmFtZTogXCJMdWFcIixcclxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcclxuICAgIGZpbGVFeHRlbnNpb246IFwiLmx1YVwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbGFuZ3VhZ2U6IFwicGhwXCIsXHJcbiAgICBkaXNwbGF5TmFtZTogXCJQSFBcIixcclxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcclxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBocFwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbGFuZ3VhZ2U6IFwiZ29cIixcclxuICAgIGRpc3BsYXlOYW1lOiBcIkdvXCIsXHJcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcclxuICAgIGZpbGVFeHRlbnNpb246IFwiLmdvXCIsXHJcbiAgICBhcmdzOiBbXCJydW5cIiwgXCJ7ZmlsZX1cIl0sXHJcbiAgICBlbnY6IHtcclxuICAgICAgR09DQUNIRTogXCJ7dGVtcERpcn0vZ29jYWNoZVwiLFxyXG4gICAgfSxcclxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcclxuICB9LFxyXG4gIHtcclxuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcclxuICAgIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIixcclxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUsXHJcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxyXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxyXG4gIH0sXHJcbl07XHJcblxyXG5leHBvcnQgY2xhc3MgSW50ZXJwcmV0ZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcclxuICBkaXNwbGF5TmFtZSA9IFwiSW50ZXJwcmV0ZWRcIjtcclxuICBsYW5ndWFnZXMgPSBJTlRFUlBSRVRFRF9TUEVDUy5tYXAoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UpO1xyXG5cclxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xyXG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcclxuICB9XHJcblxyXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xyXG4gICAgaWYgKCFzcGVjKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XHJcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfWAsXHJcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMuZGlzcGxheU5hbWUsXHJcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxyXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MgPz8gW1wie2ZpbGV9XCJdLFxyXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBzcGVjLmZpbGVFeHRlbnNpb24sXHJcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzcGVjLm1pbmltdW1UaW1lb3V0TXMgPz8gMCksXHJcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIGVudjogc3BlYy5lbnYsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0U3BlYyhsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IEludGVycHJldGVkU3BlYyB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gSU5URVJQUkVURURfU1BFQ1MuZmluZCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSA9PT0gbGFuZ3VhZ2UpO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XHJcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIExsdm1SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwibGx2bS1pclwiO1xyXG4gIGRpc3BsYXlOYW1lID0gXCJMTFZNIElSXCI7XHJcbiAgbGFuZ3VhZ2VzID0gW1wibGx2bS1pclwiXSBhcyBjb25zdDtcclxuXHJcbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiICYmIEJvb2xlYW4oc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXHJcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXHJcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxyXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXHJcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxsXCIsXHJcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxyXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQudGltZWRPdXQgJiYgIXJlc3VsdC5jYW5jZWxsZWQgJiYgcmVzdWx0LmV4aXRDb2RlICE9IG51bGwgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XHJcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcclxuICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XHJcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgUHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LiBVbmRlciBsbGksIHRoYXQgYmVjb21lcyB0aGUgcHJvY2VzcyBleGl0IHN0YXR1cy5gO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XHJcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxyXG4gICAgICAgICAgPyBcIkxMVk0gcHJvZ3JhbSBleGl0ZWQgd2l0aCBjb2RlIDAuXCJcclxuICAgICAgICAgIDogYExMVk0gcHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LlxcblVzZSBzdGRvdXQgaW4gdGhlIElSIGl0c2VsZiBpZiB5b3Ugd2FudCBwcmludGFibGUgcHJvZ3JhbSBvdXRwdXQuYDtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xyXG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwibWFuYWdlZC1jb21waWxlZFwiO1xyXG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XHJcbiAgbGFuZ3VhZ2VzID0gW1wicnVzdFwiLCBcImphdmFcIl0gYXMgY29uc3Q7XHJcblxyXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcclxuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XHJcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnJ1blJ1c3QoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5yc1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XHJcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XHJcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcclxuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpjb21waWxlYCxcclxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcclxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXHJcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OnJ1bmAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXHJcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcclxuICAgICAgICBhcmdzOiBbXSxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcclxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKFwiTWFpbi5qYXZhXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcclxuICAgICAgaWYgKCFzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSkge1xyXG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcclxuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnNvdXJjZWAsXHJcbiAgICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcclxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcclxuICAgICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXHJcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxyXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxyXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxyXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpLFxyXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXHJcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGVtcERpcixcclxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnJ1bmAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXHJcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxyXG4gICAgICAgIGFyZ3M6IFtcIi1jcFwiLCB0ZW1wRGlyLCBcIk1haW5cIl0sXHJcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXHJcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwibmF0aXZlLWNvbXBpbGVkXCI7XHJcbiAgZGlzcGxheU5hbWUgPSBcIk5hdGl2ZSBjb21waWxlclwiO1xyXG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XHJcblxyXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjcHBcIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xyXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xyXG4gICAgY29uc3QgZmlsZUV4dGVuc2lvbiA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiLmNcIiA6IFwiLmNwcFwiO1xyXG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiQyAoR0NDKVwiIDogXCJDKysgKEcrKylcIjtcclxuXHJcbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKGZpbGVFeHRlbnNpb24sIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcclxuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcclxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpjb21waWxlYCxcclxuICAgICAgICBydW5uZXJOYW1lLFxyXG4gICAgICAgIGV4ZWN1dGFibGUsXHJcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpydW5gLFxyXG4gICAgICAgIHJ1bm5lck5hbWUsXHJcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcclxuICAgICAgICBhcmdzOiBbXSxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcclxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XHJcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHJ1blRlbXBGaWxlUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XHJcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIE9jYW1sUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XHJcbiAgaWQgPSBcIm9jYW1sXCI7XHJcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XHJcbiAgbGFuZ3VhZ2VzID0gW1wib2NhbWxcIl0gYXMgY29uc3Q7XHJcblxyXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcIm9jYW1sXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5vY2FtbE1vZGU7XHJcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcclxuXHJcbiAgICBpZiAobW9kZSA9PT0gXCJvY2FtbFwiKSB7XHJcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbFwiLFxyXG4gICAgICAgIGV4ZWN1dGFibGUsXHJcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxyXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXHJcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtb2RlID09PSBcImR1bmVcIikge1xyXG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06ZHVuZWAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJEdW5lIC8gT0NhbWxcIixcclxuICAgICAgICBleGVjdXRhYmxlLFxyXG4gICAgICAgIGFyZ3M6IFtcImV4ZWNcIiwgXCItLVwiLCBcIm9jYW1sXCIsIFwie2ZpbGV9XCJdLFxyXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXHJcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIubWxcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xyXG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xyXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XHJcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1jb21waWxlYCxcclxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxyXG4gICAgICAgIGV4ZWN1dGFibGUsXHJcbiAgICAgICAgYXJnczogW1wiLW9cIiwgYmluYXJ5UGF0aCwgdGVtcEZpbGVdLFxyXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcclxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xyXG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtcnVuYCxcclxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxyXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXHJcbiAgICAgICAgYXJnczogW10sXHJcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXHJcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xyXG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBQeXRob25SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwicHl0aG9uXCI7XHJcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xyXG4gIGxhbmd1YWdlcyA9IFtcInB5dGhvblwiXSBhcyBjb25zdDtcclxuXHJcbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSk7XHJcbiAgfVxyXG5cclxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XHJcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcclxuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXHJcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXHJcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpLFxyXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXHJcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnB5XCIsXHJcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxyXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxyXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XHJcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgUHJvb2ZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcclxuICBpZCA9IFwicHJvb2ZcIjtcclxuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xyXG4gIGxhbmd1YWdlcyA9IFtcImxlYW5cIiwgXCJjb3FcIiwgXCJzbXRsaWJcIl0gYXMgY29uc3Q7XHJcblxyXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xyXG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcclxuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcclxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcclxuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XHJcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmxlYW5gLFxyXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiTGVhblwiLFxyXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcclxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXHJcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGVhblwiLFxyXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcclxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcclxuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XHJcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNvcWAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJDb3FcIixcclxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXHJcbiAgICAgICAgYXJnczogW1wiLXFcIiwgXCJ7ZmlsZX1cIl0sXHJcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIudlwiLFxyXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcclxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcclxuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XHJcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnNtdGxpYmAsXHJcbiAgICAgICAgcnVubmVyTmFtZTogXCJTTVQtTElCIChaMylcIixcclxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcclxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXHJcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuc210MlwiLFxyXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcclxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXHJcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcclxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb29mIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XHJcbiAgY29uc3QgY29uZmlndXJlZCA9IHNldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpO1xyXG4gIGlmIChjb25maWd1cmVkICYmIGNvbmZpZ3VyZWQgIT09IFwiY29xY1wiKSB7XHJcbiAgICByZXR1cm4gY29uZmlndXJlZDtcclxuICB9XHJcblxyXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcclxuICByZXR1cm4gZXhpc3RzU3luYyhvcGFtQ29xYykgPyBvcGFtQ29xYyA6IGNvbmZpZ3VyZWQgfHwgXCJjb3FjXCI7XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHJ1bm5lcnM6IGxvb21SdW5uZXJbXSkge31cclxuXHJcbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XHJcbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xyXG4gIH1cclxuXHJcbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nLCBub3JtYWxpemVQYXRoIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB0eXBlIGxvb21QbHVnaW4gZnJvbSBcIi4vbWFpblwiO1xyXG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBsb29tUGx1Z2luU2V0dGluZ3MgPSB7XHJcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxyXG4gIGhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2s6IGZhbHNlLFxyXG4gIHByZXNlcnZlU291cmNlTW9kZTogdHJ1ZSxcclxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxyXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IFwiXCIsXHJcbiAgcHl0aG9uRXhlY3V0YWJsZTogXCJweXRob24zXCIsXHJcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxyXG4gIHR5cGVzY3JpcHRNb2RlOiBcInRzLW5vZGVcIixcclxuICB0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGU6IFwidHMtbm9kZVwiLFxyXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxyXG4gIG9jYW1sRXhlY3V0YWJsZTogXCJvY2FtbFwiLFxyXG4gIGNFeGVjdXRhYmxlOiBcImdjY1wiLFxyXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXHJcbiAgc2hlbGxFeGVjdXRhYmxlOiBcImJhc2hcIixcclxuICBydWJ5RXhlY3V0YWJsZTogXCJydWJ5XCIsXHJcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxyXG4gIGx1YUV4ZWN1dGFibGU6IFwibHVhXCIsXHJcbiAgcGhwRXhlY3V0YWJsZTogXCJwaHBcIixcclxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcclxuICBydXN0RXhlY3V0YWJsZTogXCJydXN0Y1wiLFxyXG4gIGhhc2tlbGxFeGVjdXRhYmxlOiBcInJ1bmdoY1wiLFxyXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXHJcbiAgamF2YUV4ZWN1dGFibGU6IFwiamF2YVwiLFxyXG4gIGxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGU6IFwibGxpXCIsXHJcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxyXG4gIGNvcUV4ZWN1dGFibGU6IFwiY29xY1wiLFxyXG4gIHNtdEV4ZWN1dGFibGU6IFwiejNcIixcclxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXHJcbiAgYXV0b1J1bk9uRmlsZU9wZW46IGZhbHNlLFxyXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXHJcbiAgcGRmRXhwb3J0TW9kZTogXCJib3RoXCIsXHJcbiAgZGVmYXVsdENvbnRhaW5lckdyb3VwOiBcIlwiLFxyXG59O1xyXG5cclxuZXhwb3J0IGNsYXNzIGxvb21TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luKSB7XHJcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XHJcbiAgfVxyXG5cclxuICBkaXNwbGF5KCk6IHZvaWQge1xyXG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIlJ1biBzdXBwb3J0ZWQgY29kZSBmZW5jZXMgZGlyZWN0bHkgZnJvbSBub3RlcyB3aGlsZSBwcmVzZXJ2aW5nIG5hdGl2ZSBzeW50YXggaGlnaGxpZ2h0aW5nLlwiIH0pO1xyXG5cclxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcclxuICAgIHRoaXMucmVuZGVyQnVpbHRJblJ1bnRpbWVzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJCdWlsdC1pbiBSdW50aW1lc1wiKSk7XHJcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ3VzdG9tIExhbmd1YWdlc1wiKSk7XHJcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvblwiIH0pO1xyXG4gICAgZGV0YWlscy5vcGVuID0gb3BlbjtcclxuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcclxuICAgIHJldHVybiBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb24tYm9keVwiIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJHZW5lcmFsU2V0dGluZ3MoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiRGlzYWJsZWQgYnkgZGVmYXVsdC4gbG9vbSBydW5zIGNvZGUgb24geW91ciBsb2NhbCBtYWNoaW5lIGFuZCBkb2VzIG5vdCBwcm92aWRlIHNhbmRib3hpbmcuXCIpXHJcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHZhbHVlO1xyXG4gICAgICAgICAgaWYgKHZhbHVlKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB9KSxcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJLZWVwIGxvb20gbm90ZXMgaW4gc291cmNlIG1vZGVcIilcclxuICAgICAgLnNldERlc2MoXCJQcmVzZXJ2ZSByYXcgZmVuY2VkIGNvZGUgaW4gdGhlIGVkaXRvciBpbnN0ZWFkIG9mIGxldHRpbmcgbGl2ZSBwcmV2aWV3IGNvbGxhcHNlIHJlc2VhcmNoIHNuaXBwZXRzLlwiKVxyXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XHJcbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSA9IHZhbHVlO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgaWYgKHZhbHVlKSB7XHJcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSksXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCB0aW1lb3V0XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiTWF4aW11bSBleGVjdXRpb24gdGltZSBpbiBtaWxsaXNlY29uZHMgYmVmb3JlIGxvb20gdGVybWluYXRlcyB0aGUgcHJvY2Vzcy5cIilcclxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XHJcbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjgwMDBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcclxuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xyXG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyA9IHBhcnNlZDtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0TmFtZShcIldvcmtpbmcgZGlyZWN0b3J5XCIpXHJcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiVmF1bHQgcm9vdFwiKS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgfSksXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkluc2VydCBtYW5hZ2VkIGxvb20gb3V0cHV0IHNlY3Rpb25zIGJlbmVhdGggY29kZSBibG9ja3MgaW5zdGVhZCBvZiBrZWVwaW5nIHJlc3VsdHMgcHVyZWx5IGluIHRoZSBVSS5cIilcclxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlID0gdmFsdWU7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgfSksXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiQXV0by1ydW4gb24gZmlsZSBvcGVuXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiUnVuIGFsbCBzdXBwb3J0ZWQgYmxvY2tzIGluIHRoZSBhY3RpdmUgbm90ZSB3aGVuIGl0IG9wZW5zLiBEaXNhYmxlZCBieSBkZWZhdWx0LlwiKVxyXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XHJcbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4gPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB9KSxcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJQREYgZXhwb3J0IG1vZGVcIilcclxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXHJcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XHJcbiAgICAgICAgZHJvcGRvd25cclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2RlXCIsIFwiQ29kZSBCbG9jayBPbmx5XCIpXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib3V0cHV0XCIsIFwiT3V0cHV0IE9ubHlcIilcclxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPSB2YWx1ZSBhcyBcImJvdGhcIiB8IFwiY29kZVwiIHwgXCJvdXRwdXRcIjtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgfSksXHJcbiAgICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlbmRlckJ1aWx0SW5SdW50aW1lcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XHJcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk5vZGUgZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBKYXZhU2NyaXB0IGV4ZWN1dGlvbi5cIiwgXCJub2RlRXhlY3V0YWJsZVwiKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJUeXBlU2NyaXB0IHJ1bm5lciBtb2RlXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiVXNlIHRzLW5vZGUgb3IgdHN4IGZvciBUeXBlU2NyaXB0IGJsb2Nrcy5cIilcclxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cclxuICAgICAgICBkcm9wZG93blxyXG4gICAgICAgICAgLmFkZE9wdGlvbihcInRzLW5vZGVcIiwgXCJ0cy1ub2RlXCIpXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXHJcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlKVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pLFxyXG4gICAgICApO1xyXG5cclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiVHlwZVNjcmlwdCB0cmFuc3BpbGVyIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHRzLW5vZGUgb3IgdHN4LlwiLCBcInR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZVwiKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJPQ2FtbCBtb2RlXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcclxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cclxuICAgICAgICBkcm9wZG93blxyXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbGNcIiwgXCJvY2FtbGNcIilcclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkdW5lXCIsIFwiZHVuZVwiKVxyXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXHJcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUgPSB2YWx1ZSBhcyBcIm9jYW1sXCIgfCBcIm9jYW1sY1wiIHwgXCJkdW5lXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pLFxyXG4gICAgICApO1xyXG5cclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiT0NhbWwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3Igb2NhbWwsIG9jYW1sYywgb3IgZHVuZSBkZXBlbmRpbmcgb24gdGhlIHNlbGVjdGVkIG1vZGUuXCIsIFwib2NhbWxFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQyBibG9ja3MuXCIsIFwiY0V4ZWN1dGFibGVcIik7XHJcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiU2hlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU2hlbGwsIEJhc2gsIGFuZCBzaCBibG9ja3MuXCIsIFwic2hlbGxFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdWJ5IGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFJ1YnkgYmxvY2tzLlwiLCBcInJ1YnlFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMdWEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgTHVhIGJsb2Nrcy5cIiwgXCJsdWFFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQSFAgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUEhQIGJsb2Nrcy5cIiwgXCJwaHBFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdXN0IGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgUnVzdCBibG9ja3MuXCIsIFwicnVzdEV4ZWN1dGFibGVcIik7XHJcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkhhc2tlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgSGFza2VsbCBibG9ja3MuIERlZmF1bHRzIHRvIHJ1bmdoYy5cIiwgXCJoYXNrZWxsRXhlY3V0YWJsZVwiKTtcclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcclxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIGNvbXBpbGVkIEphdmEgYmxvY2tzLlwiLCBcImphdmFFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMTFZNIElSIGludGVycHJldGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIExMVk0gSVIgYmxvY2tzIHdpdGggbGxpLlwiLCBcImxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGVcIik7XHJcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XHJcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkNvcSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBDb3EgYmxvY2tzIHdpdGggY29xYy5cIiwgXCJjb3FFeGVjdXRhYmxlXCIpO1xyXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJTTVQgc29sdmVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTTVQtTElCIGJsb2Nrcy4gRGVmYXVsdHMgdG8gejMuXCIsIFwic210RXhlY3V0YWJsZVwiKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xyXG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcclxuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGxpc3RFbCk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiQWRkIGN1c3RvbSBsYW5ndWFnZVwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBsb2NhbCBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZS5cIilcclxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxyXG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcclxuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXHJcbiAgICAgICAgICAgIGFsaWFzZXM6IFwiXCIsXHJcbiAgICAgICAgICAgIGV4ZWN1dGFibGU6IFwiXCIsXHJcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIudHh0XCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcclxuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcclxuICAgICAgICB0ZXh0OiBcIk5vIGN1c3RvbSBsYW5ndWFnZXMgY29uZmlndXJlZC5cIixcclxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5mb3JFYWNoKChsYW5ndWFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xyXG4gICAgICBkZXRhaWxzLm9wZW4gPSB0cnVlO1xyXG4gICAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGxhbmd1YWdlLm5hbWUgfHwgYEN1c3RvbSBsYW5ndWFnZSAke2luZGV4ICsgMX1gIH0pO1xyXG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xyXG5cclxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIk5hbWVcIiwgXCJOb3JtYWxpemVkIGxhbmd1YWdlIGlkIHVzZWQgYnkgbG9vbS5cIiwgXCJuYW1lXCIpO1xyXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XHJcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeGVjdXRhYmxlXCIsIFwiTG9jYWwgY29tbWFuZCBvciBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGguXCIsIFwiZXhlY3V0YWJsZVwiKTtcclxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFyZ3VtZW50c1wiLCBcIlNwYWNlLXNlcGFyYXRlZCBhcmd1bWVudHMuIFVzZSB7ZmlsZX0gZm9yIHRoZSB0ZW1wIHNvdXJjZSBmaWxlLlwiLCBcImFyZ3NcIik7XHJcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcclxuXHJcbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXHJcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcclxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcclxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XHJcbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5sb29tUGx1Z2luLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XHJcblxyXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAuc2V0TmFtZShcIkRlZmF1bHQgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxyXG4gICAgICAgIC5zZXREZXNjKFwiVGhlIGNvbnRhaW5lciBncm91cCB0byBydW4gY29kZSBibG9ja3MgaW4gYnkgZGVmYXVsdCBpZiB0aGUgbm90ZSBkb2VzIG5vdCBzcGVjaWZ5IG9uZS5cIilcclxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XHJcbiAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJcIiwgXCJOb25lXCIpO1xyXG4gICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGdyb3VwLm5hbWUsIGdyb3VwLm5hbWUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCB8fCBcIlwiKTtcclxuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgICAgLnNldE5hbWUoXCJBZGQgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcclxuICAgICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwIGNvbmZpZ3VyYXRpb24gZm9sZGVyLlwiKVxyXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKCgpID0+IHtcclxuICAgICAgICAgICAgbmV3IENvbnRhaW5lckdyb3VwTmFtZU1vZGFsKHRoaXMuYXBwLCBhc3luYyAoZ3JvdXBOYW1lKSA9PiB7XHJcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5OYW1lID0gZ3JvdXBOYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dL2csIFwiLVwiKTtcclxuICAgICAgICAgICAgICBpZiAoIWNsZWFuTmFtZSkge1xyXG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgZ3JvdXAgbmFtZS5cIik7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGdyb3VwUmVsYXRpdmVQYXRoID0gYCR7cGx1Z2luRGlyfS9jb250YWluZXJzLyR7Y2xlYW5OYW1lfWA7XHJcbiAgICAgICAgICAgICAgY29uc3QgY29uZmlnUGF0aCA9IGAke2dyb3VwUmVsYXRpdmVQYXRofS9jb25maWcuanNvbmA7XHJcblxyXG4gICAgICAgICAgICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xyXG4gICAgICAgICAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhncm91cFJlbGF0aXZlUGF0aCkpIHtcclxuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgZm9sZGVyIGFscmVhZHkgZXhpc3RzLlwiKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIubWtkaXIoZ3JvdXBSZWxhdGl2ZVBhdGgpO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB7XHJcbiAgICAgICAgICAgICAgICBydW50aW1lOiBcImRvY2tlclwiLFxyXG4gICAgICAgICAgICAgICAgaW1hZ2U6IFwidWJ1bnR1OmxhdGVzdFwiLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2VzOiB7XHJcbiAgICAgICAgICAgICAgICAgIHB5dGhvbjoge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbW1hbmQ6IFwicHl0aG9uMyB7ZmlsZX1cIixcclxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCJcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShkZWZhdWx0Q29uZmlnLCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShgQ29udGFpbmVyIGdyb3VwIFwiJHtjbGVhbk5hbWV9XCIgY3JlYXRlZC5gKTtcclxuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICAgICAgfSkub3BlbigpO1xyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWNvbnRhaW5lci1ncm91cC1saXN0XCIgfSk7XHJcbiAgICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xyXG4gICAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgICAgICAgdGV4dDogXCJObyBjb250YWluZXIgZ3JvdXBzIGZvdW5kIGluIC5vYnNpZGlhbi9wbHVnaW5zL2xvb20vY29udGFpbmVycy5cIixcclxuICAgICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxyXG4gICAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcclxuICAgICAgICAgIC5zZXREZXNjKGdyb3VwLnN0YXR1cylcclxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLmJ1aWxkQ29udGFpbmVyR3JvdXAoZ3JvdXAubmFtZSk7XHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxyXG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkVkaXRcIikub25DbGljaygoKSA9PiB7XHJcbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcclxuICAgICAgICAgICAgICBuZXcgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwodGhpcy5sb29tUGx1Z2luLCBncm91cC5uYW1lLCBwbHVnaW5EaXIsICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgICAgICAgIH0pLm9wZW4oKTtcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgICAgIHRleHQ6IGBFcnJvciBsb2FkaW5nIGNvbnRhaW5lciBncm91cHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXHJcbiAgICAgICAgY2xzOiBcImxvb20tc2V0dGluZ3MtZXJyb3JcIixcclxuICAgICAgICBhdHRyOiB7IHN0eWxlOiBcImNvbG9yOiB2YXIoLS10ZXh0LWVycm9yKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IG1hcmdpbjogMWVtIDA7XCIgfVxyXG4gICAgICB9KTtcclxuICAgICAgY29uc29sZS5lcnJvcihcImxvb206IGZhaWxlZCB0byByZW5kZXIgY29udGFpbmVyIGdyb3VwczpcIiwgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUobmFtZSlcclxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxyXG4gICAgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LFxyXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcclxuICAgIG5hbWU6IHN0cmluZyxcclxuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmcsXHJcbiAgICBrZXk6IEssXHJcbiAgKTogdm9pZCB7XHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUobmFtZSlcclxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHQuc2V0VmFsdWUobGFuZ3VhZ2Vba2V5XSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICBsYW5ndWFnZVtrZXldID0gdmFsdWUudHJpbSgpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpOiB2b2lkIHtcclxuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XHJcbn1cclxuXHJcbmNsYXNzIENvbnRhaW5lckdyb3VwTmFtZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xyXG4gIHByaXZhdGUgbmFtZSA9IFwiXCI7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgYXBwOiBBcHAsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU3VibWl0OiAobmFtZTogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxyXG4gICkge1xyXG4gICAgc3VwZXIoYXBwKTtcclxuICB9XHJcblxyXG4gIG9uT3BlbigpIHtcclxuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiTmV3IENvbnRhaW5lciBHcm91cCBOYW1lXCIgfSk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxyXG4gICAgICAuc2V0TmFtZShcIkdyb3VwIE5hbWVcIilcclxuICAgICAgLnNldERlc2MoXCJVc2UgbG93ZXJjYXNlIGxldHRlcnMsIG51bWJlcnMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3Jlcy5cIilcclxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XHJcbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMubmFtZSA9IHZhbHVlO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcclxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxyXG4gICAgICAgIGJ0blxyXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIilcclxuICAgICAgICAgIC5zZXRDdGEoKVxyXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU3VibWl0KHRoaXMubmFtZSk7XHJcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgcHJpdmF0ZSBhY3RpdmVUYWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIiA9IFwiZ2VuZXJhbFwiO1xyXG4gIHByaXZhdGUgY29uZmlnT2JqOiBhbnkgPSB7fTtcclxuICBwcml2YXRlIHJhd0pzb25UZXh0ID0gXCJcIjtcclxuICBwcml2YXRlIGRvY2tlcmZpbGVUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XHJcbiAgcHJpdmF0ZSB0YWJIZWFkZXJFbCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgdGFiQ29udGVudEVsITogSFRNTEVsZW1lbnQ7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cE5hbWU6IHN0cmluZyxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU2F2ZTogKCkgPT4gdm9pZFxyXG4gICkge1xyXG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHApO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25PcGVuKCkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogYEVkaXQgQ29uZmlnOiAke3RoaXMuZ3JvdXBOYW1lfWAgfSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcclxuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XHJcbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByYXdDb25maWcgPSBhd2FpdCBhZGFwdGVyLnJlYWQoY29uZmlnUGF0aCk7XHJcbiAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZShyYXdDb25maWcpO1xyXG4gICAgICB0aGlzLnJhd0pzb25UZXh0ID0gcmF3Q29uZmlnO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBuZXcgTm90aWNlKFwiQ291bGQgbm90IHJlYWQgY29uZmlndXJhdGlvbiBmaWxlLlwiKTtcclxuICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGRvY2tlcmZpbGVQYXRoKSkge1xyXG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBhd2FpdCBhZGFwdGVyLnJlYWQoZG9ja2VyZmlsZVBhdGgpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGFpbmVyXCIgfSk7XHJcblxyXG4gICAgLy8gUmVuZGVyIFRhYiBIZWFkZXJcclxuICAgIHRoaXMudGFiSGVhZGVyRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWhlYWRlclwiIH0pO1xyXG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XHJcblxyXG4gICAgLy8gUmVuZGVyIFRhYiBDb250ZW50IEFyZWFcclxuICAgIHRoaXMudGFiQ29udGVudEVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250ZW50XCIgfSk7XHJcblxyXG4gICAgLy8gUmVuZGVyIEFjdGlvbnMgRm9vdGVyXHJcbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcclxuICAgIGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG4gICAgY29uc3Qgc2F2ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlNhdmVcIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcclxuICAgIHNhdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgYXdhaXQgdGhpcy5zYXZlQW5kQ2xvc2UoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJUYWJzKCkge1xyXG4gICAgdGhpcy50YWJIZWFkZXJFbC5lbXB0eSgpO1xyXG4gICAgY29uc3QgdGFiczogQXJyYXk8eyBpZDogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xyXG4gICAgICB7IGlkOiBcImdlbmVyYWxcIiwgbGFiZWw6IFwiR2VuZXJhbFwiIH0sXHJcbiAgICAgIHsgaWQ6IFwibGFuZ3VhZ2VzXCIsIGxhYmVsOiBcIkxhbmd1YWdlc1wiIH0sXHJcbiAgICAgIHsgaWQ6IFwiZG9ja2VyZmlsZVwiLCBsYWJlbDogXCJEb2NrZXJmaWxlXCIgfSxcclxuICAgICAgeyBpZDogXCJyYXdcIiwgbGFiZWw6IFwiUmF3IEpTT05cIiB9LFxyXG4gICAgXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHRhYiBvZiB0YWJzKSB7XHJcbiAgICAgIGNvbnN0IGJ0biA9IHRoaXMudGFiSGVhZGVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICAgIHRleHQ6IHRhYi5sYWJlbCxcclxuICAgICAgICBjbHM6IFwibG9vbS10YWItYnRuXCIgKyAodGhpcy5hY3RpdmVUYWIgPT09IHRhYi5pZCA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIiksXHJcbiAgICAgIH0pO1xyXG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICB2b2lkIHRoaXMuc3dpdGNoVGFiKHRhYi5pZCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc3dpdGNoVGFiKHRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiKSB7XHJcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHN3aXRjaGluZy5cIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICB0aGlzLmFjdGl2ZVRhYiA9IHRhYjtcclxuICAgIHRoaXMucmVuZGVyVGFicygpO1xyXG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcclxuICB9XHJcblxyXG4gIHJlbmRlckFjdGl2ZVRhYigpIHtcclxuICAgIHRoaXMudGFiQ29udGVudEVsLmVtcHR5KCk7XHJcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZ2VuZXJhbFwiKSB7XHJcbiAgICAgIHRoaXMucmVuZGVyR2VuZXJhbFRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImxhbmd1YWdlc1wiKSB7XHJcbiAgICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VzVGFiKHRoaXMudGFiQ29udGVudEVsKTtcclxuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZG9ja2VyZmlsZVwiKSB7XHJcbiAgICAgIHRoaXMucmVuZGVyRG9ja2VyZmlsZVRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XHJcbiAgICAgIHRoaXMucmVuZGVyUmF3VGFiKHRoaXMudGFiQ29udGVudEVsKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJlbmRlckdlbmVyYWxUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XHJcbiAgICAvLyBSdW50aW1lIHNlbGVjdCBkcm9wZG93blxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiUnVudGltZVwiKVxyXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB0aGUgY29udGFpbmVyL2Vudmlyb25tZW50IG1hbmFnZXIgcnVudGltZS5cIilcclxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xyXG4gICAgICAgIGRyb3Bkb3duXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZG9ja2VyXCIsIFwiRG9ja2VyXCIpXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicG9kbWFuXCIsIFwiUG9kbWFuXCIpXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwid3NsXCIsIFwiV1NMXCIpXHJcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicWVtdVwiLCBcIlFFTVVcIilcclxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjdXN0b21cIiwgXCJDdXN0b21cIilcclxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lIHx8IFwiZG9ja2VyXCIpXHJcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPSB2YWx1ZTtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAvLyBDb25kaXRpb25hbCBpbWFnZS9kaXN0cm8gbmFtZVxyXG4gICAgaWYgKFxyXG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8XHJcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgfHxcclxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxyXG4gICAgKSB7XHJcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgIC5zZXROYW1lKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIgPyBcIldTTCBEaXN0cm9cIiA6IFwiQmFzZSBJbWFnZVwiKVxyXG4gICAgICAgIC5zZXREZXNjKFxyXG4gICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxyXG4gICAgICAgICAgICA/IFwiT3B0aW9uYWwuIFRoZSB0YXJnZXQgV1NMIGRpc3RybyBuYW1lIChsZWF2ZSBlbXB0eSBmb3IgZGVmYXVsdCBkaXN0cm8pLlwiXHJcbiAgICAgICAgICAgIDogXCJGYWxsYmFjayBEb2NrZXIvUG9kbWFuIGltYWdlIGlmIG5vIERvY2tlcmZpbGUgaXMgcHJlc2VudC5cIlxyXG4gICAgICAgIClcclxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xyXG4gICAgICAgICAgdGV4dFxyXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouaW1hZ2UgfHwgXCJcIilcclxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcclxuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5pbWFnZSA9IHZhbC50cmltKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiKSB7XHJcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoud3NsKSB7XHJcbiAgICAgICAgdGhpcy5jb25maWdPYmoud3NsID0ge307XHJcbiAgICAgIH1cclxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgICAgLnNldE5hbWUoXCJVc2UgSW50ZXJhY3RpdmUgU2hlbGxcIilcclxuICAgICAgICAuc2V0RGVzYyhcIlVzZSBpbnRlcmFjdGl2ZSBsb2dpbiBzaGVsbCBmbGFncyAoLWkgLWwpIHRvIGVuc3VyZSB+Ly5iYXNocmMgaW5pdGlhbGl6YXRpb24gd29ya3MgKGUuZy4sIGZvciBOVk0pLlwiKVxyXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xyXG4gICAgICAgICAgdG9nZ2xlXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPz8gZmFsc2UpXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID0gdmFsO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDb25kaXRpb25hbCBRRU1VIFNldHRpbmdzXHJcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIpIHtcclxuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5xZW11KSB7XHJcbiAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdSA9IHsgc3NoVGFyZ2V0OiBcIlwiLCByZW1vdGVXb3Jrc3BhY2U6IFwiXCIgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggVGFyZ2V0XCIpXHJcbiAgICAgICAgLnNldERlc2MoXCJTU0ggdGFyZ2V0IGFkZHJlc3MgKGUuZy4gdXNlckBob3N0bmFtZSBvciBsb2NhbGhvc3QgLXAgMjIyMikuXCIpXHJcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcclxuICAgICAgICAgIHRleHRcclxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0IHx8IFwiXCIpXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgPSB2YWwudHJpbSgpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgIC5zZXROYW1lKFwiUmVtb3RlIFdvcmtzcGFjZVwiKVxyXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3RlIGZvbGRlciBwYXRoIHRvIGNvcHkgY29kZSBzbmlwcGV0cyBhbmQgcnVuIGNvbW1hbmRzIChlLmcuLCAvaG9tZS91c2VyL3dvcmtzcGFjZSkuXCIpXHJcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcclxuICAgICAgICAgIHRleHRcclxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlIHx8IFwiXCIpXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgPSB2YWwudHJpbSgpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEV4ZWN1dGFibGVcIilcclxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBQYXRoIHRvIFNTSCBjbGllbnQgZXhlY3V0YWJsZSAoZGVmYXVsdHMgdG8gc3NoKS5cIilcclxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xyXG4gICAgICAgICAgdGV4dFxyXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwiXCIpXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggQXJndW1lbnRzXCIpXHJcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQWRkaXRpb25hbCBTU0ggQ0xJIGZsYWdzLlwiKVxyXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XHJcbiAgICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgfHwgXCJcIilcclxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcclxuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ29uZGl0aW9uYWwgQ3VzdG9tIFNldHRpbmdzXHJcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIikge1xyXG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmN1c3RvbSkge1xyXG4gICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbSA9IHsgZXhlY3V0YWJsZTogXCJcIiB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBFeGVjdXRhYmxlXCIpXHJcbiAgICAgICAgLnNldERlc2MoXCJQYXRoIHRvIGN1c3RvbSBydW50aW1lIHdyYXBwZXIgZXhlY3V0YWJsZSBvciBzY3JpcHQuXCIpXHJcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcclxuICAgICAgICAgIHRleHRcclxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlIHx8IFwiXCIpXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgPSB2YWwudHJpbSgpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEFyZ3VtZW50c1wiKVxyXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIENvbW1hbmQgYXJndW1lbnRzLiBVc2Uge3JlcXVlc3R9IGZvciBKU09OIGNvbmZpZyBwYXRoLlwiKVxyXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XHJcbiAgICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyB8fCBcIlwiKVxyXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmVuZGVyTGFuZ3VhZ2VzVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xyXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQ29uZmlndXJlZCBMYW5ndWFnZXNcIiB9KTtcclxuXHJcbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcykge1xyXG4gICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgPSB7fTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsYW5nc0xpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlcy1saXN0XCIgfSk7XHJcbiAgICBjb25zdCBsYW5ndWFnZXMgPSBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgeyBjb21tYW5kPzogc3RyaW5nOyBleHRlbnNpb24/OiBzdHJpbmc7IHVzZURlZmF1bHQ/OiBib29sZWFuIH0+KTtcclxuXHJcbiAgICBpZiAobGFuZ3VhZ2VzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBsYW5nc0xpc3RFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIk5vIGxhbmd1YWdlcyBjb25maWd1cmVkIGZvciB0aGlzIGdyb3VwLlwiLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBmb3IgKGNvbnN0IFtsYW5nTmFtZSwgbGFuZ0NvbmZpZ10gb2YgbGFuZ3VhZ2VzKSB7XHJcbiAgICAgICAgY29uc3QgY2FyZCA9IGxhbmdzTGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlLWNhcmRcIiB9KTtcclxuICAgICAgICBjYXJkLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbGFuZ05hbWUsIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDAuNXJlbTsgZm9udC1zaXplOiAxLjFlbTtcIiB9IH0pO1xyXG5cclxuICAgICAgICBjb25zdCBpc0RlZmF1bHQgPSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPT09IHRydWU7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXHJcbiAgICAgICAgICAuc2V0TmFtZShcIlVzZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cIilcclxuICAgICAgICAgIC5zZXREZXNjKFwiSWYgY2hlY2tlZCwgTG9vbSB3aWxsIHJ1biB0aGlzIGxhbmd1YWdlIHVzaW5nIGl0cyBidWlsdC1pbiBjb21tYW5kcy9leHRlbnNpb25zLlwiKVxyXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XHJcbiAgICAgICAgICAgIHRvZ2dsZVxyXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShpc0RlZmF1bHQpXHJcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcclxuICAgICAgICAgICAgICAgICAgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuY29tbWFuZDtcclxuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuZXh0ZW5zaW9uO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgZGVsZXRlIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdDtcclxuICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcclxuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIjtcclxuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSBkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXHJcbiAgICAgICAgICAuc2V0TmFtZShcIkNvbW1hbmRcIilcclxuICAgICAgICAgIC5zZXREZXNjKFwiRXhlY3V0aW9uIGNvbW1hbmQuIFVzZSB7ZmlsZX0gZm9yIHRoZSBjb2RlIHNuaXBwZXQgZmlsZW5hbWUuXCIpXHJcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xyXG4gICAgICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCIpXHJcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuY29tbWFuZCB8fCBcIlwiKVxyXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXHJcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcclxuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IHZhbC50cmltKCk7XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcclxuICAgICAgICAgIC5zZXROYW1lKFwiRXh0ZW5zaW9uXCIpXHJcbiAgICAgICAgICAuc2V0RGVzYyhcIlNvdXJjZSBmaWxlIGV4dGVuc2lvbiAoZS5nLiAucHksIC5qcykuXCIpXHJcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xyXG4gICAgICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIilcclxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5leHRlbnNpb24gfHwgXCJcIilcclxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxyXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IHZhbC50cmltKCk7XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcclxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xyXG4gICAgICAgICAgICBidG5cclxuICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBMYW5ndWFnZVwiKVxyXG4gICAgICAgICAgICAgIC5zZXRXYXJuaW5nKClcclxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW2xhbmdOYW1lXTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEFkZCBMYW5ndWFnZSBTZWN0aW9uXHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJBZGQgTGFuZ3VhZ2UgTWFwcGluZ1wiLCBhdHRyOiB7IHN0eWxlOiBcIm1hcmdpbi10b3A6IDEuNXJlbTtcIiB9IH0pO1xyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiTGFuZ3VhZ2UgSURcIilcclxuICAgICAgLnNldERlc2MoXCJlLmcuIHB5dGhvbiwgamF2YXNjcmlwdCwgbm9kZSwgc2hcIilcclxuICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcclxuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMubmV3TGFuZ3VhZ2VOYW1lKS5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IHZhbC50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSlcclxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XHJcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCIrIEFkZFwiKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcclxuICAgICAgICAgIGlmICghdGhpcy5uZXdMYW5ndWFnZU5hbWUpIHtcclxuICAgICAgICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBlbnRlciBhIGxhbmd1YWdlIG5hbWUuXCIpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAodGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSkge1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgYWxyZWFkeSBjb25maWd1cmVkLlwiKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSA9IHtcclxuICAgICAgICAgICAgY29tbWFuZDogYCR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9IHtmaWxlfWAsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbjogYC4ke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfWAsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xyXG4gICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJEb2NrZXJmaWxlVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xyXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwiZG9ja2VyXCIgJiYgdGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJwb2RtYW5cIikge1xyXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgICAgIHRleHQ6IGBEb2NrZXJmaWxlIGVkaXRpbmcgaXMgb25seSBhdmFpbGFibGUgZm9yIERvY2tlciBhbmQgUG9kbWFuIHJ1bnRpbWVzLiBDdXJyZW50bHkgdXNpbmc6ICR7dGhpcy5jb25maWdPYmoucnVudGltZX1gLFxyXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCA9PT0gbnVsbCkge1xyXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgICAgIHRleHQ6IFwiTm8gRG9ja2VyZmlsZSBleGlzdHMgaW4gdGhpcyBjb250YWluZXIgZ3JvdXAgZGlyZWN0b3J5LlwiLFxyXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcclxuICAgICAgICAgIGJ0blxyXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZSBEb2NrZXJmaWxlXCIpXHJcbiAgICAgICAgICAgIC5zZXRDdGEoKVxyXG4gICAgICAgICAgICAub25DbGljaygoKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IFtcclxuICAgICAgICAgICAgICAgIFwiRlJPTSB1YnVudHU6bGF0ZXN0XCIsXHJcbiAgICAgICAgICAgICAgICBcIlwiLFxyXG4gICAgICAgICAgICAgICAgXCIjIEluc3RhbGwgcGFja2FnZXNcIixcclxuICAgICAgICAgICAgICAgIFwiUlVOIGFwdC1nZXQgdXBkYXRlICYmIGFwdC1nZXQgaW5zdGFsbCAteSBcXFxcXCIsXHJcbiAgICAgICAgICAgICAgICBcIiAgICBweXRob24zIFxcXFxcIixcclxuICAgICAgICAgICAgICAgIFwiICAgIG5vZGVqcyBcXFxcXCIsXHJcbiAgICAgICAgICAgICAgICBcIiAgICAmJiBybSAtcmYgL3Zhci9saWIvYXB0L2xpc3RzLypcIixcclxuICAgICAgICAgICAgICAgIFwiXCIsXHJcbiAgICAgICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xyXG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgICAgLnNldE5hbWUoXCJEb2NrZXJmaWxlIENvbnRlbnRcIilcclxuICAgICAgICAuc2V0RGVzYyhcIkRlZmluZSB0aGUgYnVpbGQgc3RlcHMgZm9yIHlvdXIgZW52aXJvbm1lbnQgY29udGFpbmVyLlwiKVxyXG4gICAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xyXG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcclxuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcclxuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xyXG4gICAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmRvY2tlcmZpbGVUZXh0IHx8IFwiXCIpO1xyXG4gICAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSB2YWw7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJlbmRlclJhd1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcclxuICAgIHRoaXMucmF3SnNvblRleHQgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJDb25maWd1cmF0aW9uIEpTT05cIilcclxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XHJcbiAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcclxuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XHJcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XHJcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLnJhd0pzb25UZXh0KTtcclxuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcclxuICAgICAgICAgIHRoaXMucmF3SnNvblRleHQgPSB2YWw7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZUFuZENsb3NlKCkge1xyXG4gICAgLy8gSWYgdGhlIGFjdGl2ZSB0YWIgaXMgcmF3IEpTT04sIHBhcnNlIGl0IGZpcnN0IHRvIGVuc3VyZSB3ZSBjYXB0dXJlIGVkaXRzXHJcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHNhdmluZy5cIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQmFzaWMgVmFsaWRhdGlvblxyXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5ydW50aW1lKSB7XHJcbiAgICAgIG5ldyBOb3RpY2UoXCJSdW50aW1lIGlzIHJlcXVpcmVkLlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmICghdGhpcy5jb25maWdPYmoucWVtdT8uc3NoVGFyZ2V0IHx8ICF0aGlzLmNvbmZpZ09iai5xZW11Py5yZW1vdGVXb3Jrc3BhY2UpKSB7XHJcbiAgICAgIG5ldyBOb3RpY2UoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgU1NIIFRhcmdldCBhbmQgUmVtb3RlIFdvcmtzcGFjZS5cIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiICYmICF0aGlzLmNvbmZpZ09iai5jdXN0b20/LmV4ZWN1dGFibGUpIHtcclxuICAgICAgbmV3IE5vdGljZShcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIEN1c3RvbSBFeGVjdXRhYmxlLlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xyXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcclxuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU2F2ZSBjb25maWcuanNvblxyXG4gICAgICBjb25zdCBjb25maWdTdHIgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XHJcbiAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgY29uZmlnU3RyKTtcclxuXHJcbiAgICAgIC8vIFNhdmUgRG9ja2VyZmlsZVxyXG4gICAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgIT09IG51bGwpIHtcclxuICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoZG9ja2VyZmlsZVBhdGgsIHRoaXMuZG9ja2VyZmlsZVRleHQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBjb25maWd1cmF0aW9ucyBzYXZlZC5cIik7XHJcbiAgICAgIHRoaXMub25TYXZlKCk7XHJcbiAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIG5ldyBOb3RpY2UoYFNhdmUgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcblxyXG5cclxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRvb2xiYXJIYW5kbGVycyB7XHJcbiAgb25SdW46ICgpID0+IHZvaWQ7XHJcbiAgb25Db3B5OiAoKSA9PiB2b2lkO1xyXG4gIG9uUmVtb3ZlOiAoKSA9PiB2b2lkO1xyXG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcclxuICBibG9ja0lkOiBzdHJpbmcsXHJcbiAgaXNSdW5uaW5nOiBib29sZWFuLFxyXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxyXG4pOiBIVE1MRGl2RWxlbWVudCB7XHJcbiAgY29uc3QgdG9vbGJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XHJcbiAgdG9vbGJhci5kYXRhc2V0Lmxvb21CbG9ja0lkID0gYmxvY2tJZDtcclxuXHJcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xyXG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiQ29weSBjb2RlXCIsIFwiY29weVwiLCBoYW5kbGVycy5vbkNvcHksIGZhbHNlKSk7XHJcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSZW1vdmUgc25pcHBldFwiLCBcInRyYXNoLTJcIiwgaGFuZGxlcnMub25SZW1vdmUsIGZhbHNlKSk7XHJcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XHJcblxyXG4gIHJldHVybiB0b29sYmFyO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVCdXR0b24obGFiZWw6IHN0cmluZywgaWNvbk5hbWU6IHN0cmluZywgb25DbGljazogKCkgPT4gdm9pZCwgc3Bpbm5pbmc6IGJvb2xlYW4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XHJcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcclxuICBidXR0b24uY2xhc3NOYW1lID0gYGxvb20tdG9vbGJhci1idXR0b24ke3NwaW5uaW5nID8gXCIgaXMtcnVubmluZ1wiIDogXCJcIn1gO1xyXG4gIGJ1dHRvbi50eXBlID0gXCJidXR0b25cIjtcclxuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XHJcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcclxuICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgIG9uQ2xpY2soKTtcclxuICB9KTtcclxuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xyXG4gIHJldHVybiBidXR0b247XHJcbn1cclxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcclxuaW1wb3J0IHR5cGUgeyBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XHJcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gXCJmYWlsdXJlXCI7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBIVE1MRGl2RWxlbWVudCB7XHJcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xyXG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2dldFN0YXR1c0tpbmQob3V0cHV0KX0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifWA7XHJcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xyXG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQpO1xyXG4gIHJldHVybiBwYW5lbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsOiBIVE1MRWxlbWVudCwgb3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogdm9pZCB7XHJcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcclxuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XHJcbiAgcGFuZWwuZW1wdHkoKTtcclxuXHJcbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xyXG4gIGNvbnN0IGJhZGdlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1iYWRnZVwiIH0pO1xyXG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xyXG5cclxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcclxuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xyXG5cclxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XHJcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcclxuXHJcbiAgY29uc3QgYm9keSA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1ib2R5XCIgfSk7XHJcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xyXG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3Rkb3V0XCIsIG91dHB1dC5yZXN1bHQuc3Rkb3V0KTtcclxuICB9XHJcbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XHJcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZyk7XHJcbiAgfVxyXG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcclxuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVycik7XHJcbiAgfVxyXG4gIGlmICghb3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpICYmICFvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XHJcbiAgICBjb25zdCBlbXB0eSA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWVtcHR5XCIgfSk7XHJcbiAgICBlbXB0eS5zZXRUZXh0KFwiTm8gb3V0cHV0XCIpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xyXG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xyXG4gIHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcclxuICBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUnVubmluZ1BhbmVsKCk6IEhUTUxEaXZFbGVtZW50IHtcclxuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XHJcbiAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLW91dHB1dC1wYW5lbCBpcy1ydW5uaW5nXCI7XHJcblxyXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcclxuICBjb25zdCBzcGlubmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNwaW5uZXJcIiB9KTtcclxuICBzZXRJY29uKHNwaW5uZXIsIFwibG9hZGVyLWNpcmNsZVwiKTtcclxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcclxuICB0aXRsZS5zZXRUZXh0KFwiUnVubmluZ1wiKTtcclxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XHJcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xyXG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1oaWRkZW5cIiwgXCJ0cnVlXCIpO1xyXG5cclxuICByZXR1cm4gcGFuZWw7XHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBUU87QUFDUCxtQkFBNkM7QUFDN0MsSUFBQUMsZUFBMkU7QUFDM0UsSUFBQUMsZUFBd0I7OztBQ1h4QixzQkFBNkM7QUFDN0MsZ0JBQWdEO0FBQ2hELElBQUFDLG1CQUF3RDtBQUN4RCxJQUFBQyxlQUFpRjtBQUNqRixJQUFBQyx3QkFBc0I7OztBQ0p0QixzQkFBdUM7QUFDdkMsZ0JBQXVCO0FBQ3ZCLGtCQUFxQjtBQUNyQiwyQkFBc0I7QUF3QnRCLGVBQXNCLHdCQUNwQixVQUNBLFFBQ0EsVUFDWTtBQUNaLFFBQU0sVUFBVSxVQUFNLDZCQUFRLHNCQUFLLGtCQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3JELFFBQU0sZUFBVyxrQkFBSyxTQUFTLFFBQVE7QUFFdkMsTUFBSTtBQUNGLGNBQU0sMkJBQVUsVUFBVSwwQkFBMEIsTUFBTSxHQUFHLE1BQU07QUFDbkUsV0FBTyxNQUFNLFNBQVMsRUFBRSxTQUFTLFNBQVMsQ0FBQztBQUFBLEVBQzdD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O0FBQ25DLFlBQU0sUUFBUSxLQUFLLHVCQUF1QixPQUFPLE9BQU87QUFDeEQsVUFBSSxDQUFDLE9BQU87QUFDVixlQUFPO0FBQUEsTUFDVDtBQUNBLFlBQU0sT0FBTyxNQUFNLE9BQU8sTUFBTSxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQ3JELGFBQU8sTUFBTSxLQUFLLElBQUk7QUFBQSxJQUN4QixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsNEJBQTRCLFNBQWlCLFFBQThDO0FBQ2pHLFVBQU0sT0FBTztBQUFBLE1BQ1gsVUFBVSxPQUFPLFVBQVU7QUFBQSxNQUMzQixRQUFRLE9BQU8sWUFBWSxHQUFHO0FBQUEsTUFDOUIsWUFBWSxPQUFPLFVBQVU7QUFBQSxNQUM3QixhQUFhLE9BQU8sVUFBVTtBQUFBLE1BQzlCLE9BQU8sU0FBUztBQUFBLEVBQVksT0FBTyxNQUFNLEtBQUs7QUFBQSxNQUM5QyxPQUFPLFVBQVU7QUFBQSxFQUFhLE9BQU8sT0FBTyxLQUFLO0FBQUEsTUFDakQsT0FBTyxTQUFTO0FBQUEsRUFBWSxPQUFPLE1BQU0sS0FBSztBQUFBLElBQ2hELEVBQ0csT0FBTyxPQUFPLEVBQ2QsS0FBSyxNQUFNO0FBRWQsV0FBTztBQUFBLE1BQ0wsNkJBQTZCLE9BQU87QUFBQSxNQUNwQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSx1QkFBdUIsT0FBaUIsU0FBd0Q7QUFDdEcsVUFBTSxjQUFjLDZCQUE2QixPQUFPO0FBQ3hELGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUN4QyxVQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxhQUFhO0FBQ25DO0FBQUEsTUFDRjtBQUVBLGVBQVMsSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQzVDLFlBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLDRCQUE0QjtBQUNsRCxpQkFBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
