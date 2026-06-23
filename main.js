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
var import_obsidian6 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path10 = require("path");

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
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : useDefault ? void 0 : `.${language}`,
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
        if (settings.ocamlMode === "dune") {
          return {
            command: `${settings.ocamlExecutable.trim() || "dune"} exec -- ocaml {file}`,
            extension: ".ml"
          };
        }
        if (settings.ocamlMode === "ocamlc") {
          return {
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/loom-ocaml "$1" && /tmp/loom-ocaml`),
            extension: ".ml"
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml"
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/loom-c && /tmp/loom-c`),
          extension: ".c"
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/loom-cpp && /tmp/loom-cpp`),
          extension: ".cpp"
        };
      case "ebpf":
      case "ebpf-c":
      case "bpf":
      case "bpf-c":
        return {
          command: shellCommand(`${settings.ebpfClangExecutable.trim() || "clang"} -target bpf -O2 -g -Wall "$1" -c -o /tmp/loom-ebpf.o && printf 'compiled /tmp/loom-ebpf.o\\n'`),
          extension: ".bpf.c"
        };
      case "bpftrace":
      case "bt":
        return {
          command: `${settings.bpftraceExecutable.trim() || "bpftrace"} -d {file}`,
          extension: ".bt"
        };
      case "rust":
      case "rs":
        return {
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/loom-rust && /tmp/loom-rust`),
          extension: ".rs"
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/loom-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
          extension: ".java"
        };
      }
      case "llvm-ir":
      case "llvm":
      case "ll":
        return {
          command: `${settings.llvmInterpreterExecutable.trim() || "lli"} {file}`,
          extension: ".ll"
        };
      case "lean":
        return {
          command: `${settings.leanExecutable.trim() || "lean"} {file}`,
          extension: ".lean"
        };
      case "coq":
        return {
          command: `${settings.coqExecutable.trim() || "coqc"} -q {file}`,
          extension: ".v"
        };
      case "smtlib":
      case "smt":
      case "smt-lib":
        return {
          command: `${settings.smtExecutable.trim() || "z3"} {file}`,
          extension: ".smt2"
        };
    }
    return null;
  }
};
function shellCommand(command) {
  return `sh -lc ${quoteCommandArg(command)} sh {file}`;
}
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
function quoteCommandArg(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/executionContext.ts
var import_path3 = require("path");
var import_obsidian2 = require("obsidian");
function resolveExecutionContext(app, file, block, settings) {
  const note = readNoteExecutionContext(app, file);
  const defaultWorkingDirectory = resolveDefaultWorkingDirectory(file, settings);
  const noteWorkingDirectory = normalizeWorkingDirectory(note.workingDirectory);
  const blockWorkingDirectory = normalizeWorkingDirectory(block.executionContext.workingDirectory);
  const noteTimeout = note.timeoutMs;
  const blockTimeout = block.executionContext.timeoutMs;
  return {
    containerGroup: resolveContainerGroup(settings.defaultContainerGroup, note, block.executionContext),
    workingDirectory: blockWorkingDirectory ?? noteWorkingDirectory ?? defaultWorkingDirectory,
    timeoutMs: blockTimeout ?? noteTimeout ?? settings.defaultTimeoutMs,
    source: {
      container: resolveContainerSource(settings.defaultContainerGroup, note, block.executionContext),
      workingDirectory: blockWorkingDirectory ? "block" : noteWorkingDirectory ? "note" : settings.workingDirectory.trim() ? "global" : "default",
      timeout: blockTimeout ? "block" : noteTimeout ? "note" : "global"
    }
  };
}
function resolveContainerGroup(globalContainer, note, block) {
  if (block.disableContainer) {
    return void 0;
  }
  if (block.containerGroup?.trim()) {
    return block.containerGroup.trim();
  }
  if (note.disableContainer) {
    return void 0;
  }
  if (note.containerGroup?.trim()) {
    return note.containerGroup.trim();
  }
  return globalContainer.trim() || void 0;
}
function resolveContainerSource(globalContainer, note, block) {
  if (block.disableContainer || block.containerGroup?.trim()) {
    return "block";
  }
  if (note.disableContainer || note.containerGroup?.trim()) {
    return "note";
  }
  if (globalContainer.trim()) {
    return "global";
  }
  return "none";
}
function readNoteExecutionContext(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) {
    return {};
  }
  const container = frontmatter["loom-container"];
  const workingDirectory = frontmatter["loom-cwd"] ?? frontmatter["loom-working-directory"];
  const timeout = frontmatter["loom-timeout"];
  return {
    containerGroup: typeof container === "string" && !isDisabledValue(container) ? container.trim() : void 0,
    disableContainer: typeof container === "string" ? isDisabledValue(container) : void 0,
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : void 0,
    timeoutMs: typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : typeof timeout === "string" ? parsePositiveInteger(timeout) : void 0
  };
}
function resolveDefaultWorkingDirectory(file, settings) {
  if (settings.workingDirectory.trim()) {
    return (0, import_obsidian2.normalizePath)(settings.workingDirectory.trim());
  }
  const adapterBasePath = file.vault.adapter.basePath ?? "";
  const fileFolder = (0, import_path3.dirname)(file.path);
  const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
  return resolved || process.cwd();
}
function normalizeWorkingDirectory(value) {
  return value?.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : void 0;
}
function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
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

// src/languagePackages.ts
var BUILT_IN_LANGUAGE_PACKAGES = [
  {
    id: "interpreted",
    displayName: "Interpreted",
    description: "Script and REPL-oriented languages for operational notes and quick experiments.",
    languages: [
      { id: "python", displayName: "Python", aliases: ["python", "py"] },
      { id: "javascript", displayName: "JavaScript", aliases: ["javascript", "js"] },
      { id: "typescript", displayName: "TypeScript", aliases: ["typescript", "ts"] },
      { id: "shell", displayName: "Shell", aliases: ["shell", "sh", "bash", "zsh"] },
      { id: "ruby", displayName: "Ruby", aliases: ["ruby", "rb"] },
      { id: "perl", displayName: "Perl", aliases: ["perl", "pl"] },
      { id: "lua", displayName: "Lua", aliases: ["lua"] },
      { id: "php", displayName: "PHP", aliases: ["php"] },
      { id: "go", displayName: "Go", aliases: ["go", "golang"] },
      { id: "haskell", displayName: "Haskell", aliases: ["haskell", "hs"] },
      { id: "ocaml", displayName: "OCaml", aliases: ["ocaml", "ml"] }
    ]
  },
  {
    id: "native-compiled",
    displayName: "Native Compiled",
    description: "Languages compiled into native binaries by local toolchains.",
    languages: [
      { id: "c", displayName: "C", aliases: ["c", "h"] },
      { id: "cpp", displayName: "C++", aliases: ["cpp", "cxx", "cc", "c++"] }
    ]
  },
  {
    id: "managed-compiled",
    displayName: "Managed Compiled",
    description: "Compiled languages with managed runtimes or structured build/run phases.",
    languages: [
      { id: "rust", displayName: "Rust", aliases: ["rust", "rs"] },
      { id: "java", displayName: "Java", aliases: ["java"] }
    ]
  },
  {
    id: "proofs",
    displayName: "Proofs",
    description: "Proof assistants and solver-oriented languages.",
    languages: [
      { id: "lean", displayName: "Lean", aliases: ["lean", "lean4"] },
      { id: "coq", displayName: "Coq", aliases: ["coq", "v"] },
      { id: "smtlib", displayName: "SMT-LIB", aliases: ["smt", "smt2", "smtlib", "smt-lib", "z3"] }
    ]
  },
  {
    id: "llvm",
    displayName: "LLVM",
    description: "LLVM IR tooling for compiler and PL research vaults.",
    languages: [
      { id: "llvm-ir", displayName: "LLVM IR", aliases: ["llvm", "llvmir", "llvm-ir", "ll"] }
    ]
  },
  {
    id: "ebpf",
    displayName: "eBPF",
    description: "Kernel instrumentation languages for BPF object compilation, verifier checks, and bpftrace scripts.",
    languages: [
      { id: "ebpf-c", displayName: "eBPF C", aliases: ["ebpf", "ebpf-c", "bpf-c", "bpf"] },
      { id: "bpftrace", displayName: "bpftrace", aliases: ["bpftrace", "bt"] }
    ]
  }
];
var CUSTOM_LANGUAGE_PACKAGE_ID = "custom";
var LANGUAGE_CONFIGURATION_VERSION = 2;
function getDefaultLanguagePackIds() {
  return [...BUILT_IN_LANGUAGE_PACKAGES.map((pack) => pack.id), CUSTOM_LANGUAGE_PACKAGE_ID];
}
function getDefaultLanguageIds() {
  return BUILT_IN_LANGUAGE_PACKAGES.flatMap((pack) => pack.languages.map((language) => language.id));
}
function normalizeLanguageConfiguration(settings) {
  if (!Array.isArray(settings.enabledLanguagePacks) || !settings.enabledLanguagePacks.length) {
    settings.enabledLanguagePacks = getDefaultLanguagePackIds();
  }
  if (!Array.isArray(settings.enabledLanguages) || !settings.enabledLanguages.length) {
    settings.enabledLanguages = getDefaultLanguageIds();
  }
  if (!Number.isFinite(settings.languageConfigurationVersion)) {
    settings.languageConfigurationVersion = 1;
  }
  if (settings.languageConfigurationVersion < 2) {
    enableLanguagePackage(settings, "ebpf");
    settings.languageConfigurationVersion = LANGUAGE_CONFIGURATION_VERSION;
  }
}
function enableLanguagePackage(settings, packageId) {
  const pack = BUILT_IN_LANGUAGE_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pack) {
    return;
  }
  appendUnique(settings.enabledLanguagePacks, pack.id);
  for (const language of pack.languages) {
    appendUnique(settings.enabledLanguages, language.id);
  }
}
function appendUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
  }
}
function getEnabledLanguageDefinitions(settings) {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);
  return BUILT_IN_LANGUAGE_PACKAGES.filter((pack) => enabledPacks.has(pack.id)).flatMap((pack) => pack.languages).filter((language) => enabledLanguages.has(language.id));
}
function getEnabledLanguageAliasMap(settings) {
  return Object.fromEntries(
    getEnabledLanguageDefinitions(settings).flatMap(
      (language) => language.aliases.map((alias) => [alias.toLowerCase(), language.id])
    )
  );
}
function isLanguageEnabled(languageId, settings) {
  normalizeLanguageConfiguration(settings);
  return getEnabledLanguageDefinitions(settings).some((language) => language.id === languageId);
}
function areCustomLanguagesEnabled(settings) {
  normalizeLanguageConfiguration(settings);
  return settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID);
}

// src/parser.ts
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  if (!settings) {
    return null;
  }
  if (areCustomLanguagesEnabled(settings)) {
    for (const language of settings.customLanguages ?? []) {
      const name = language.name.trim().toLowerCase();
      const aliases2 = parseAliasList(language.aliases);
      if (name && (name === normalized || aliases2.includes(normalized))) {
        return language.name.trim();
      }
    }
  }
  const aliases = getEnabledLanguageAliasMap(settings);
  return aliases[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  if (!settings) {
    return [];
  }
  const customAliases = areCustomLanguagesEnabled(settings) ? (settings.customLanguages ?? []).flatMap((language) => {
    const name = language.name.trim().toLowerCase();
    return [name, ...parseAliasList(language.aliases)];
  }) : [];
  return [
    ...Object.keys(getEnabledLanguageAliasMap(settings)),
    ...customAliases
  ].map((alias) => alias.toLowerCase()).filter(Boolean);
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
    const infoAttributes = parseInfoAttributes(fenceMatch[3] ?? "");
    const sourceReference = parseSourceReference(infoAttributes);
    const executionContext = parseExecutionContext(infoAttributes);
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
    const referenceHash = sourceReference ? `:${JSON.stringify(sourceReference)}` : "";
    const executionHash = executionContextHasValues(executionContext) ? `:${JSON.stringify(executionContext)}` : "";
    const attributeHash = Object.keys(infoAttributes).length ? `:${JSON.stringify(infoAttributes)}` : "";
    const contentHash = shortHash(`${content}${referenceHash}${executionHash}${attributeHash}`);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      attributes: infoAttributes,
      sourceReference,
      executionContext,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function executionContextHasValues(context) {
  return Boolean(context.containerGroup || context.disableContainer || context.workingDirectory || context.timeoutMs);
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function parseSourceReference(attrs) {
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return void 0;
  }
  const lines = attrs["loom-lines"] ?? attrs.lines ?? attrs.line;
  const lineRange = lines ? parseLineRange(lines) : null;
  const symbolName = attrs["loom-symbol"] ?? attrs.symbol ?? attrs.fn ?? attrs.function;
  const traceValue = attrs["loom-deps"] ?? attrs.deps ?? attrs.trace;
  const callExpression = attrs["loom-call"] ?? attrs.call;
  const callArgs = attrs["loom-args"] ?? attrs.args;
  const printValue = attrs["loom-print"] ?? attrs.print;
  const call = callExpression != null || callArgs != null ? {
    expression: normalizeBooleanAttribute(callExpression) === "true" ? void 0 : callExpression,
    args: callArgs,
    print: printValue == null ? true : !["0", "false", "no", "off"].includes(printValue.toLowerCase())
  } : void 0;
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase()),
    call
  };
}
function parseExecutionContext(attrs) {
  const container = attrs["loom-container"] ?? attrs.container;
  const timeout = attrs["loom-timeout"] ?? attrs.timeout;
  const workingDirectory = attrs["loom-cwd"] ?? attrs.cwd ?? attrs["working-directory"];
  const timeoutMs = timeout ? parsePositiveInteger2(timeout) : void 0;
  return {
    containerGroup: container && !isDisabledValue2(container) ? container : void 0,
    disableContainer: container ? isDisabledValue2(container) : void 0,
    workingDirectory,
    timeoutMs
  };
}
function parsePositiveInteger2(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue2(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
}
function normalizeBooleanAttribute(value) {
  return value == null ? void 0 : value.trim().toLowerCase();
}
function parseInfoAttributes(input) {
  const attrs = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(input)) != null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
function parseLineRange(value) {
  const match = value.trim().match(/^L?(\d+)(?:\s*[-:]\s*L?(\d+))?$/i);
  if (!match) {
    return null;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2] ?? match[1], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }
  return { start, end };
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

// src/languageCapabilities.ts
var BUILT_IN_CAPABILITIES = {
  python: {
    language: "python",
    symbolExtraction: "ast",
    dependencyTracing: "ast",
    callHarness: "built-in",
    sourcePreview: true
  },
  javascript: {
    language: "javascript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  typescript: {
    language: "typescript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  c: {
    language: "c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  cpp: {
    language: "cpp",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  "llvm-ir": {
    language: "llvm-ir",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  haskell: {
    language: "haskell",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  ocaml: {
    language: "ocaml",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  java: {
    language: "java",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  "ebpf-c": {
    language: "ebpf-c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  bpftrace: {
    language: "bpftrace",
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  }
};
function getLanguageCapability(language, hasExternalExtractor = false) {
  if (hasExternalExtractor) {
    return {
      language,
      symbolExtraction: "external",
      dependencyTracing: "external",
      callHarness: "external",
      sourcePreview: true
    };
  }
  return BUILT_IN_CAPABILITIES[language] ?? {
    language,
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  };
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

// src/runners/ebpf.ts
var import_path4 = require("path");
var EbpfRunner = class {
  constructor() {
    this.id = "ebpf";
    this.displayName = "eBPF";
    this.languages = ["ebpf-c", "bpftrace"];
  }
  canRun(block, settings) {
    if (block.language === "ebpf-c") {
      return Boolean(settings.ebpfClangExecutable.trim());
    }
    if (block.language === "bpftrace") {
      return Boolean(settings.bpftraceExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "ebpf-c") {
      return this.runEbpfC(block, context, settings);
    }
    if (block.language === "bpftrace") {
      return this.runBpftrace(block, context, settings);
    }
    throw new Error(`Unsupported eBPF language: ${block.language}`);
  }
  async runEbpfC(block, context, settings) {
    const mode = readEbpfCMode(block);
    const cflags = readListAttribute(block, "loom-ebpf-cflags", "ebpf-cflags").flatMap(splitCommandLine);
    const includePaths = [
      ...splitCsv(settings.ebpfIncludePaths),
      ...readListAttribute(block, "loom-ebpf-includes", "ebpf-includes")
    ];
    return withTempSourceFile(".bpf.c", block.content, async ({ tempDir, tempFile }) => {
      const objectPath = (0, import_path4.join)(tempDir, "snippet.bpf.o");
      const compileResult = await runProcess({
        runnerId: `${this.id}:clang`,
        runnerName: "eBPF clang",
        executable: settings.ebpfClangExecutable.trim(),
        args: [
          "-target",
          "bpf",
          "-O2",
          "-g",
          "-Wall",
          ...includePaths.flatMap((includePath) => ["-I", includePath]),
          ...cflags,
          "-c",
          tempFile,
          "-o",
          objectPath
        ],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      compileResult.stdout = appendSection(compileResult.stdout, "Compile", `eBPF object compiled successfully: ${objectPath}`);
      await this.appendObjectInspection(compileResult, objectPath, context, settings);
      if (mode === "compile") {
        return compileResult;
      }
      return this.loadEbpfObject(block, objectPath, context, settings, compileResult);
    });
  }
  async appendObjectInspection(result, objectPath, context, settings) {
    const objdump = settings.ebpfLlvmObjdumpExecutable.trim();
    if (!objdump) {
      result.warning = appendLine(result.warning, "eBPF object inspection skipped because no object inspector is configured.");
      return;
    }
    const inspect = await runProcess({
      runnerId: `${this.id}:objdump`,
      runnerName: "eBPF object inspection",
      executable: objdump,
      args: ["-h", objectPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (inspect.success) {
      result.stdout = appendSection(result.stdout, "Object sections", inspect.stdout.trim() || "(no sections reported)");
    } else {
      result.warning = appendLine(result.warning, `eBPF object inspection failed: ${inspect.stderr || inspect.stdout || `exit ${inspect.exitCode}`}`);
    }
  }
  async loadEbpfObject(block, objectPath, context, settings, compileResult) {
    if (!settings.ebpfAllowKernelLoad) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "eBPF kernel loading is disabled. Enable Allow eBPF kernel load in settings before using loom-ebpf-mode=load.")
      };
    }
    const pinPath = readStringAttribute(block, "loom-ebpf-pin", "ebpf-pin");
    if (!pinPath) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "loom-ebpf-mode=load requires loom-ebpf-pin=/sys/fs/bpf/<path>.")
      };
    }
    const load = await runProcess({
      runnerId: `${this.id}:bpftool:load`,
      runnerName: "bpftool eBPF load",
      executable: settings.ebpfBpftoolExecutable.trim() || "bpftool",
      args: ["-d", "prog", "loadall", objectPath, pinPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    load.stdout = appendSection(compileResult.stdout, "bpftool stdout", load.stdout.trim());
    load.stderr = appendSection(compileResult.stderr, "bpftool stderr", load.stderr.trim());
    load.warning = appendLine(compileResult.warning, `eBPF object load requested with pin path ${pinPath}.`);
    return load;
  }
  async runBpftrace(block, context, settings) {
    const mode = readBpftraceMode(block);
    const extraArgs = readListAttribute(block, "loom-bpftrace-args", "bpftrace-args").flatMap(splitCommandLine);
    const args = mode === "check" ? ["-d", ...extraArgs, "{file}"] : [...extraArgs, "{file}"];
    return withTempSourceFile(
      ".bt",
      block.content,
      async ({ tempFile }) => runProcess({
        runnerId: `${this.id}:bpftrace:${mode}`,
        runnerName: mode === "check" ? "bpftrace check" : "bpftrace",
        executable: settings.bpftraceExecutable.trim(),
        args: args.map((arg) => arg.replaceAll("{file}", tempFile)),
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      })
    );
  }
};
function readEbpfCMode(block) {
  const value = readStringAttribute(block, "loom-ebpf-mode", "ebpf-mode") || "compile";
  if (value === "compile" || value === "load") {
    return value;
  }
  throw new Error(`Unsupported eBPF mode: ${value}. Use compile or load.`);
}
function readBpftraceMode(block) {
  const value = readStringAttribute(block, "loom-bpftrace-mode", "bpftrace-mode") || "check";
  if (value === "check" || value === "run") {
    return value;
  }
  throw new Error(`Unsupported bpftrace mode: ${value}. Use check or run.`);
}
function readStringAttribute(block, primary, fallback) {
  return block.attributes[primary]?.trim() || block.attributes[fallback]?.trim() || void 0;
}
function readListAttribute(block, primary, fallback) {
  return splitCsv(readStringAttribute(block, primary, fallback) || "");
}
function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function appendLine(existing, line) {
  return [existing, line].filter((part) => part?.trim()).join("\n");
}
function appendSection(existing, title, body) {
  const content = body.trim();
  if (!content) {
    return existing;
  }
  return [existing.trim(), `${title}:
${content}`].filter(Boolean).join("\n\n");
}

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
var import_path5 = require("path");
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
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
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
var import_path6 = require("path");
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
      const binaryPath = (0, import_path6.join)(tempDir, "snippet.out");
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
var import_path7 = require("path");
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
      const binaryPath = (0, import_path7.join)(tempDir, "snippet.out");
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
var import_path8 = require("path");
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
  const opamCoqc = (0, import_path8.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    if (!this.isBlockLanguageEnabled(block, settings)) {
      return null;
    }
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
  isBlockLanguageEnabled(block, settings) {
    if (isLanguageEnabled(block.language, settings)) {
      return true;
    }
    return areCustomLanguagesEnabled(settings) && settings.customLanguages.some((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === block.language.trim().toLowerCase() || aliases.includes(block.languageAlias.trim().toLowerCase());
    });
  }
};

// src/defaultSettings.ts
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
  ebpfClangExecutable: "clang",
  ebpfBpftoolExecutable: "bpftool",
  ebpfLlvmObjdumpExecutable: "llvm-objdump",
  ebpfIncludePaths: "",
  ebpfAllowKernelLoad: false,
  bpftraceExecutable: "bpftrace",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  autoRunOnFileOpen: false,
  extractedSourcePreviewMode: "collapsed",
  showLanguageCapabilityMetadata: true,
  languageConfigurationVersion: 2,
  enabledLanguagePacks: getDefaultLanguagePackIds(),
  enabledLanguages: getDefaultLanguageIds(),
  customLanguages: [],
  pdfExportMode: "both",
  defaultContainerGroup: ""
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var loomSettingTab = class extends import_obsidian3.PluginSettingTab {
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
    this.renderLanguagePackages(this.createSection(containerEl, "Language Packages"));
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
    new import_obsidian3.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
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
    new import_obsidian3.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian3.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Extracted source preview").setDesc("Choose how loom shows the materialized source for blocks that use loom-file.").addDropdown(
      (dropdown) => dropdown.addOption("collapsed", "Collapsed").addOption("expanded", "Expanded").addOption("hidden", "Hidden").setValue(this.loomPlugin.settings.extractedSourcePreviewMode || "collapsed").onChange(async (value) => {
        this.loomPlugin.settings.extractedSourcePreviewMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show capability metadata").setDesc("Show symbol, dependency, and harness capability metadata in extracted source preview headers.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.showLanguageCapabilityMetadata ?? true).onChange(async (value) => {
        this.loomPlugin.settings.showLanguageCapabilityMetadata = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    if (this.isRuntimeLanguageEnabled("python")) {
      this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    }
    if (this.isRuntimeLanguageEnabled("javascript")) {
      this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    }
    if (this.isRuntimeLanguageEnabled("typescript")) {
      new import_obsidian3.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
        (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
          this.loomPlugin.settings.typescriptMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    }
    if (this.isRuntimeLanguageEnabled("ocaml")) {
      new import_obsidian3.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
        (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
          this.loomPlugin.settings.ocamlMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["c"], "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addRuntimeTextSetting(containerEl, ["cpp"], "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addRuntimeTextSetting(containerEl, ["shell"], "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addRuntimeTextSetting(containerEl, ["ruby"], "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addRuntimeTextSetting(containerEl, ["perl"], "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addRuntimeTextSetting(containerEl, ["lua"], "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addRuntimeTextSetting(containerEl, ["php"], "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addRuntimeTextSetting(containerEl, ["go"], "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addRuntimeTextSetting(containerEl, ["rust"], "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addRuntimeTextSetting(containerEl, ["haskell"], "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    if (this.isRuntimeLanguageEnabled("java")) {
      this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
      this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["llvm-ir"], "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    if (this.isRuntimeLanguageEnabled("ebpf-c")) {
      this.addTextSetting(containerEl, "eBPF clang executable", "Command or path for clang with BPF target support.", "ebpfClangExecutable");
      this.addTextSetting(containerEl, "eBPF bpftool executable", "Command or path for bpftool verifier and load operations.", "ebpfBpftoolExecutable");
      this.addTextSetting(containerEl, "eBPF object inspector", "Command or path for llvm-objdump. Leave empty to skip object section inspection.", "ebpfLlvmObjdumpExecutable");
      this.addTextSetting(containerEl, "eBPF include paths", "Comma-separated include directories passed to clang with -I.", "ebpfIncludePaths");
      new import_obsidian3.Setting(containerEl).setName("Allow eBPF kernel load").setDesc("Required before any block can use loom-ebpf-mode=load. Compile-only mode stays available without this.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.ebpfAllowKernelLoad).onChange(async (value) => {
          this.loomPlugin.settings.ebpfAllowKernelLoad = value;
          await this.loomPlugin.saveSettings();
        })
      );
    }
    this.addRuntimeTextSetting(containerEl, ["bpftrace"], "bpftrace executable", "Command or path for bpftrace scripts.", "bpftraceExecutable");
    this.addRuntimeTextSetting(containerEl, ["lean"], "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addRuntimeTextSetting(containerEl, ["coq"], "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addRuntimeTextSetting(containerEl, ["smtlib"], "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  addRuntimeTextSetting(containerEl, languageIds, name, description, key) {
    if (languageIds.some((languageId) => this.isRuntimeLanguageEnabled(languageId))) {
      this.addTextSetting(containerEl, name, description, key);
    }
  }
  isRuntimeLanguageEnabled(languageId) {
    return isLanguageEnabled(languageId, this.loomPlugin.settings);
  }
  renderLanguagePackages(containerEl) {
    normalizeLanguageConfiguration(this.loomPlugin.settings);
    for (const pack of BUILT_IN_LANGUAGE_PACKAGES) {
      const packEl = containerEl.createEl("details", { cls: "loom-language-package" });
      packEl.open = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      packEl.createEl("summary", { text: pack.displayName });
      packEl.createEl("p", { text: pack.description, cls: "setting-item-description" });
      new import_obsidian3.Setting(packEl).setName("Enable package").setDesc("Disable this to remove the package languages from parsing, command menus, and runners for this vault.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id)).onChange(async (value) => {
          this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, pack.id, value);
          for (const language of pack.languages) {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
          }
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
      const packageEnabled = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      for (const language of pack.languages) {
        new import_obsidian3.Setting(packEl).setName(language.displayName).setDesc(`Aliases: ${language.aliases.join(", ")}`).addToggle(
          (toggle) => toggle.setDisabled(!packageEnabled).setValue(packageEnabled && this.loomPlugin.settings.enabledLanguages.includes(language.id)).onChange(async (value) => {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
            await this.loomPlugin.saveSettings();
          })
        );
      }
    }
    new import_obsidian3.Setting(containerEl).setName("Custom languages").setDesc("Enable user-defined languages from the Custom Languages section.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID)).onChange(async (value) => {
        this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, CUSTOM_LANGUAGE_PACKAGE_ID, value);
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Reset language packages").setDesc("Re-enable every built-in package and every built-in language.").addButton(
      (button) => button.setButtonText("Reset").onClick(async () => {
        this.loomPlugin.settings.enabledLanguagePacks = getDefaultLanguagePackIds();
        this.loomPlugin.settings.enabledLanguages = getDefaultLanguageIds();
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  setEnabledValue(values, id, enabled) {
    const index = values.indexOf(id);
    if (enabled && index < 0) {
      values.push(id);
    } else if (!enabled && index >= 0) {
      values.splice(index, 1);
    }
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian3.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt",
          extractorMode: "command",
          extractorExecutable: "",
          extractorArgs: "{request}",
          transpileExecutable: "",
          transpileArgs: "{request}"
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
      new import_obsidian3.Setting(body).setName("Partial extraction strategy").setDesc("Choose how this custom language supports partial runnable source.").addDropdown(
        (dropdown) => dropdown.addOption("command", "Extractor command").addOption("transpile-c", "Transpile to C").setValue(language.extractorMode || "command").onChange(async (value) => {
          language.extractorMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addCustomLanguageTextSetting(body, language, "Extractor executable", "Optional command for partial source extraction. Leave empty to use generic line and symbol extraction.", "extractorExecutable");
      this.addCustomLanguageTextSetting(body, language, "Extractor arguments", "Arguments for the extractor. Use {request}, {source}, {harness}, {symbol}, {lineStart}, {lineEnd}, {deps}, and {language}.", "extractorArgs");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C executable", "Optional command that emits generated C and a symbol map as JSON.", "transpileExecutable");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C arguments", "Arguments for the transpiler. Use the same placeholders as extractor arguments.", "transpileArgs");
      new import_obsidian3.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
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
      new import_obsidian3.Setting(containerEl).setName("Default containerization group").setDesc("The container group to run code blocks in by default if the note does not specify one.").addDropdown((dropdown) => {
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
      new import_obsidian3.Setting(containerEl).setName("Add new containerization group").setDesc("Create a new containerization group configuration folder.").addButton(
        (button) => button.setButtonText("+").onClick(() => {
          new ContainerGroupNameModal(this.app, async (groupName) => {
            const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!cleanName) {
              new import_obsidian3.Notice("Invalid group name.");
              return;
            }
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
            const configPath = `${groupRelativePath}/config.json`;
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(groupRelativePath)) {
              new import_obsidian3.Notice("Container group folder already exists.");
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
            new import_obsidian3.Notice(`Container group "${cleanName}" created.`);
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
        new import_obsidian3.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
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
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(language[key] ?? "")).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian3.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
var ContainerGroupNameModal = class extends import_obsidian3.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.name = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });
    new import_obsidian3.Setting(contentEl).setName("Group Name").setDesc("Use lowercase letters, numbers, hyphens, and underscores.").addText(
      (text) => text.onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian3.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(async () => {
        await this.onSubmit(this.name);
        this.close();
      })
    );
  }
};
var EditContainerGroupModal = class extends import_obsidian3.Modal {
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
      new import_obsidian3.Notice("Could not read configuration file.");
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
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
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
    new import_obsidian3.Setting(containerEl).setName("Runtime").setDesc("Choose the container/environment manager runtime.").addDropdown((dropdown) => {
      dropdown.addOption("docker", "Docker").addOption("podman", "Podman").addOption("wsl", "WSL").addOption("qemu", "QEMU").addOption("custom", "Custom").setValue(this.configObj.runtime || "docker").onChange((value) => {
        this.configObj.runtime = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman" || this.configObj.runtime === "wsl") {
      new import_obsidian3.Setting(containerEl).setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image").setDesc(
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
      new import_obsidian3.Setting(containerEl).setName("Use Interactive Shell").setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).").addToggle((toggle) => {
        toggle.setValue(this.configObj.wsl.interactive ?? false).onChange((val) => {
          this.configObj.wsl.interactive = val;
        });
      });
    }
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("SSH Target").setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).").addText((text) => {
        text.setValue(this.configObj.qemu.sshTarget || "").onChange((val) => {
          this.configObj.qemu.sshTarget = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Remote Workspace").setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).").addText((text) => {
        text.setValue(this.configObj.qemu.remoteWorkspace || "").onChange((val) => {
          this.configObj.qemu.remoteWorkspace = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Executable").setDesc("Optional. Path to SSH client executable (defaults to ssh).").addText((text) => {
        text.setValue(this.configObj.qemu.sshExecutable || "").onChange((val) => {
          this.configObj.qemu.sshExecutable = val.trim() || void 0;
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Arguments").setDesc("Optional. Additional SSH CLI flags.").addText((text) => {
        text.setValue(this.configObj.qemu.sshArgs || "").onChange((val) => {
          this.configObj.qemu.sshArgs = val.trim() || void 0;
        });
      });
    }
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("Custom Executable").setDesc("Path to custom runtime wrapper executable or script.").addText((text) => {
        text.setValue(this.configObj.custom.executable || "").onChange((val) => {
          this.configObj.custom.executable = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Custom Arguments").setDesc("Optional. Command arguments. Use {request} for JSON config path.").addText((text) => {
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
        new import_obsidian3.Setting(card).setName("Use default configuration").setDesc("If checked, Loom will run this language using its built-in commands/extensions.").addToggle((toggle) => {
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
        new import_obsidian3.Setting(card).setName("Command").setDesc("Execution command. Use {file} for the code snippet filename.").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.command || "").setValue(langConfig.command || "").setDisabled(isDefault).onChange((val) => {
            langConfig.command = val.trim();
          });
        });
        new import_obsidian3.Setting(card).setName("Extension").setDesc("Source file extension (e.g. .py, .js).").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.extension || "").setValue(langConfig.extension || "").setDisabled(isDefault).onChange((val) => {
            langConfig.extension = val.trim();
          });
        });
        new import_obsidian3.Setting(card).addButton((btn) => {
          btn.setButtonText("Remove Language").setWarning().onClick(() => {
            delete this.configObj.languages[langName];
            this.renderActiveTab();
          });
        });
      }
    }
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new import_obsidian3.Setting(containerEl).setName("Language ID").setDesc("e.g. python, javascript, node, sh").addText((text) => {
      text.setValue(this.newLanguageName).onChange((val) => {
        this.newLanguageName = val.trim().toLowerCase();
      });
    }).addButton((btn) => {
      btn.setButtonText("+ Add").setCta().onClick(() => {
        if (!this.newLanguageName) {
          new import_obsidian3.Notice("Please enter a language name.");
          return;
        }
        if (this.configObj.languages[this.newLanguageName]) {
          new import_obsidian3.Notice("Language already configured.");
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
      new import_obsidian3.Setting(containerEl).addButton((btn) => {
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
      new import_obsidian3.Setting(containerEl).setName("Dockerfile Content").setDesc("Define the build steps for your environment container.").addTextArea((text) => {
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
    new import_obsidian3.Setting(containerEl).setName("Configuration JSON").addTextArea((text) => {
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
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }
    if (!this.configObj.runtime) {
      new import_obsidian3.Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new import_obsidian3.Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new import_obsidian3.Notice("Custom runtime requires Custom Executable.");
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
      new import_obsidian3.Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new import_obsidian3.Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

// src/sourceExtract.ts
var import_child_process3 = require("child_process");
var import_promises3 = require("fs/promises");
var import_os2 = require("os");
var import_path9 = require("path");
async function resolveReferencedSource(source, reference, language, harness, host) {
  if (host?.externalExtractor?.executable.trim()) {
    return host.externalExtractor.mode === "transpile-c" ? resolveTranspileToCReferencedSource(source, reference, language, harness, host.externalExtractor) : resolveExternalReferencedSource(source, reference, language, harness, host.externalExtractor);
  }
  if (language === "python" && host) {
    return resolvePythonReferencedSource(source, reference, harness, host);
  }
  return resolveReferencedSourceFallback(source, reference, language, harness);
}
function resolveReferencedSourceFallback(source, reference, language, harness) {
  const lines = source.split(/\r?\n/);
  const selectedRange = reference.symbolName ? findSymbolRange(lines, language, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const dependencies = reference.traceDependencies ? collectDependencySource(lines, language, selectedRange, selected) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
async function resolveExternalReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseExternalExtractorResult(output);
    const content = result.content ?? [
      ...result.imports ?? [],
      ...result.dependencies ?? [],
      result.selected ?? "",
      harness.trim() ? harness : ""
    ].filter((part) => part.trim()).join("\n\n");
    if (!content.trim()) {
      throw new Error("Custom source extractor returned no content.");
    }
    return {
      content,
      description: result.description?.trim() || formatSourceDescription(reference, null)
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function resolveTranspileToCReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile,
      targetLanguage: "c"
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseTranspileToCResult(output);
    const generatedLanguage = result.language === "cpp" ? "cpp" : "c";
    const mappedSymbol = reference.symbolName ? result.symbols?.[reference.symbolName] ?? reference.symbolName : void 0;
    const generatedReference = {
      ...reference,
      filePath: `${reference.filePath}:generated.${generatedLanguage === "cpp" ? "cpp" : "c"}`,
      symbolName: mappedSymbol
    };
    const resolved = resolveReferencedSourceFallback(result.generatedSource, generatedReference, generatedLanguage, result.harness ?? harness);
    return {
      content: resolved.content,
      description: result.description?.trim() || `${reference.filePath}#${reference.symbolName ?? "generated-c"}`
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function runExternalExtractor(extractor, values) {
  const args = extractor.args.map((arg) => arg.replaceAll("{request}", values.requestFile).replaceAll("{source}", values.sourceFile).replaceAll("{file}", values.sourceFile).replaceAll("{harness}", values.harnessFile).replaceAll("{symbol}", values.reference.symbolName ?? "").replaceAll("{lineStart}", values.reference.lineStart == null ? "" : String(values.reference.lineStart)).replaceAll("{lineEnd}", values.reference.lineEnd == null ? "" : String(values.reference.lineEnd)).replaceAll("{deps}", values.reference.traceDependencies ? "true" : "false").replaceAll("{language}", values.language));
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(extractor.executable, args, {
      cwd: extractor.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Custom source extractor timed out after ${extractor.timeoutMs} ms.`));
    }, extractor.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Custom source extractor exited with code ${code}.`).trim()));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({
      requestFile: values.requestFile,
      sourceFile: values.sourceFile,
      harnessFile: values.harnessFile,
      language: values.language,
      filePath: values.reference.filePath,
      symbolName: values.reference.symbolName ?? null,
      lineStart: values.reference.lineStart ?? null,
      lineEnd: values.reference.lineEnd ?? null,
      traceDependencies: values.reference.traceDependencies
    }));
  });
}
function parseExternalExtractorResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null) {
      throw new Error("Custom source extractor must return a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Custom source extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function parseTranspileToCResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null || typeof parsed.generatedSource !== "string") {
      throw new Error("Transpile to C extractor must return generatedSource.");
    }
    if (parsed.language != null && parsed.language !== "c" && parsed.language !== "cpp") {
      throw new Error("Transpile to C language must be c or cpp.");
    }
    if (parsed.symbols != null && (typeof parsed.symbols !== "object" || Array.isArray(parsed.symbols))) {
      throw new Error("Transpile to C symbols must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Transpile to C extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function resolvePythonReferencedSource(source, reference, harness, host) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  const selectedRange = reference.symbolName ? findPythonSymbolRange(moduleInfo, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const state = createPythonDependencyState();
  const dependencies = reference.traceDependencies ? await collectPythonDependencySource(source, reference.filePath, selectedRange, selected, harness, host, state) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
function createPythonDependencyState() {
  return {
    includedRanges: /* @__PURE__ */ new Set(),
    includedImports: /* @__PURE__ */ new Set(),
    aliases: /* @__PURE__ */ new Set(),
    namespaceBindings: /* @__PURE__ */ new Map(),
    visitingSymbols: /* @__PURE__ */ new Set(),
    needsNamespaceRuntime: false
  };
}
async function collectPythonDependencySource(source, filePath, selectedRange, selected, harness, host, state) {
  const parts = [];
  await collectPythonDependencies(source, filePath, selectedRange, `${selected}
${harness}`, host, state, parts);
  const namespace = renderPythonNamespaceBindings(state);
  return [...state.includedImports, ...parts, namespace].filter((part) => part.trim()).join("\n\n");
}
async function collectPythonDependencies(source, filePath, selectedRange, seed, host, state, parts) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  let haystack = seed;
  let collected = "";
  let changed = true;
  while (changed) {
    changed = false;
    const usage = await inspectPythonUsage(haystack, host);
    for (const definition of moduleInfo.definitions) {
      if (rangesOverlap(definition, selectedRange) || !pythonDefinitionIsUsed(definition, usage)) {
        continue;
      }
      const text = addPythonRange(lines, filePath, definition, state, parts);
      if (text) {
        const nested = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
        haystack += `
${text}
`;
        if (nested) {
          haystack += `
${nested}
`;
        }
        collected += `${nested}
${text}
`;
        changed = true;
      }
    }
    for (const importNode of moduleInfo.imports) {
      const text = await resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts);
      if (text) {
        haystack += `
${text}
`;
        collected += `${text}
`;
        changed = true;
      }
    }
  }
  return collected;
}
async function resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  if (importNode.kind === "from") {
    return resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts);
  }
  return resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts);
}
async function resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  const localModulePath = await host.resolvePythonImport(filePath, importNode.module, importNode.level);
  let added = "";
  for (const alias of importNode.names) {
    if (alias.name === "*") {
      if (!localModulePath) {
        if (usesUnknownImportedNames(usage) && addPythonImportLine(lines, importNode, state)) {
          added += `${renderRange(lines, importNode)}
`;
        }
        continue;
      }
      const source = await host.readFile(localModulePath);
      if (!source) {
        continue;
      }
      const moduleInfo = await inspectPythonModule(source, host);
      for (const definition of moduleInfo.definitions) {
        if (!pythonDefinitionIsUsed(definition, usage)) {
          continue;
        }
        added += await extractPythonSymbolFromFile(localModulePath, definition.name, host, state, parts);
      }
      continue;
    }
    const exposedName = alias.asname ?? alias.name;
    if (!usage.names.includes(exposedName)) {
      continue;
    }
    const submodulePath = await host.resolvePythonImport(filePath, joinPythonModule(importNode.module, alias.name), importNode.level);
    const importTargetPath = localModulePath ?? submodulePath;
    if (!importTargetPath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    const extracted = await extractPythonSymbolFromFile(importTargetPath, alias.name, host, state, parts);
    if (extracted) {
      added += extracted;
      if (alias.asname && alias.asname !== alias.name) {
        added += addPythonAlias(alias.name, alias.asname, state, parts);
      }
      continue;
    }
    const moduleBinding = alias.asname ?? alias.name;
    const moduleAttributes = usage.attributes[moduleBinding] ?? [];
    if (submodulePath && moduleAttributes.length) {
      for (const attribute of moduleAttributes) {
        added += await extractPythonSymbolFromFile(submodulePath, attribute, host, state, parts);
        addPythonNamespaceBinding(moduleBinding, attribute, state);
      }
    }
  }
  return added;
}
async function resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  let added = "";
  for (const alias of importNode.names) {
    const binding = alias.asname ?? alias.name.split(".")[0];
    const usedAttributes = usage.attributes[binding] ?? [];
    const bindingIsUsed = usage.names.includes(binding) || usedAttributes.length > 0;
    if (!bindingIsUsed) {
      continue;
    }
    const localModulePath = await host.resolvePythonImport(filePath, alias.name, 0);
    if (!localModulePath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    for (const attribute of usedAttributes) {
      added += await extractPythonSymbolFromFile(localModulePath, attribute, host, state, parts);
      addPythonNamespaceBinding(binding, attribute, state);
    }
  }
  return added;
}
async function extractPythonSymbolFromFile(filePath, symbolName, host, state, parts) {
  const visitKey = `${filePath}#${symbolName}`;
  if (state.visitingSymbols.has(visitKey)) {
    return "";
  }
  const source = await host.readFile(filePath);
  if (!source) {
    return "";
  }
  state.visitingSymbols.add(visitKey);
  try {
    const lines = source.split(/\r?\n/);
    const moduleInfo = await inspectPythonModule(source, host);
    const definition = moduleInfo.definitions.find((candidate) => (candidate.names ?? [candidate.name]).includes(symbolName));
    if (!definition) {
      return "";
    }
    const text = renderRange(lines, definition);
    const dependencyText = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
    const added = addPythonRange(lines, filePath, definition, state, parts);
    return [dependencyText, added].filter((part) => part.trim()).join("\n");
  } finally {
    state.visitingSymbols.delete(visitKey);
  }
}
function addPythonRange(lines, filePath, range, state, parts) {
  const key = `${filePath}:L${range.start + 1}-L${range.end + 1}`;
  if (state.includedRanges.has(key)) {
    return "";
  }
  state.includedRanges.add(key);
  const text = renderRange(lines, range);
  parts.push(text);
  return text;
}
function addPythonImportLine(lines, range, state) {
  const text = renderRange(lines, range);
  if (state.includedImports.has(text)) {
    return false;
  }
  state.includedImports.add(text);
  return true;
}
function addPythonAlias(name, asname, state, parts) {
  const key = `${asname}=${name}`;
  if (state.aliases.has(key)) {
    return "";
  }
  state.aliases.add(key);
  const text = `${asname} = ${name}`;
  parts.push(text);
  return `${text}
`;
}
function addPythonNamespaceBinding(binding, attribute, state) {
  state.needsNamespaceRuntime = true;
  const attributes = state.namespaceBindings.get(binding) ?? /* @__PURE__ */ new Set();
  attributes.add(attribute);
  state.namespaceBindings.set(binding, attributes);
}
function renderPythonNamespaceBindings(state) {
  if (!state.namespaceBindings.size) {
    return "";
  }
  const lines = state.needsNamespaceRuntime ? ["import types as _loom_types"] : [];
  for (const [binding, attributes] of state.namespaceBindings) {
    lines.push(`${binding} = _loom_types.SimpleNamespace()`);
    for (const attribute of attributes) {
      lines.push(`${binding}.${attribute} = ${attribute}`);
    }
  }
  return lines.join("\n");
}
function findPythonSymbolRange(moduleInfo, symbolName) {
  const exact = moduleInfo.definitions.find((definition) => (definition.names ?? [definition.name]).includes(symbolName));
  return exact ? { start: exact.start, end: exact.end } : null;
}
function pythonDefinitionIsUsed(definition, usage) {
  return (definition.names ?? [definition.name]).some((name) => usage.names.includes(name));
}
function usesUnknownImportedNames(usage) {
  return usage.names.length > 0;
}
function joinPythonModule(moduleName, name) {
  return moduleName ? `${moduleName}.${name}` : name;
}
async function inspectPythonModule(source, host) {
  return runPythonAst(source, "module", host);
}
async function inspectPythonUsage(source, host) {
  return runPythonAst(source, "usage", host);
}
async function runPythonAst(source, mode, host) {
  const command = splitCommandLine(host.pythonExecutable?.trim() || "python3");
  const executable = command[0] ?? "python3";
  const args = [...command.slice(1), "-c", PYTHON_AST_HELPER];
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Python AST helper exited with code ${code}.`).trim()));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ mode, source }));
  });
}
function findLineRange(lines, reference) {
  const start = Math.max((reference.lineStart ?? 1) - 1, 0);
  const end = Math.min((reference.lineEnd ?? reference.lineStart ?? lines.length) - 1, lines.length - 1);
  if (start > end || start >= lines.length) {
    return null;
  }
  return { start, end };
}
function findSymbolRange(lines, language, symbolName) {
  const definitions = collectDefinitions(lines, language);
  const exact = definitions.find((definition) => definitionNames(definition).includes(symbolName));
  if (exact) {
    return { start: exact.start, end: exact.end };
  }
  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  if (line < 0) {
    return null;
  }
  return lines[line].includes("{") ? { start: line, end: findBraceRangeEnd(lines, line) } : { start: line, end: line };
}
function collectDependencySource(lines, language, selectedRange, selected) {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language).filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))].filter((part) => part.trim()).join("\n\n");
}
function traceDefinitions(seed, definitions, lines) {
  const selected = [];
  const selectedKeys = /* @__PURE__ */ new Set();
  let haystack = seed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      const key = `${definition.start}:${definition.end}:${definition.name}`;
      if (selectedKeys.has(key)) {
        continue;
      }
      if (!definitionNames(definition).some((name) => sourceUsesName(haystack, name))) {
        continue;
      }
      selectedKeys.add(key);
      selected.push(definition);
      haystack += `
${renderRange(lines, definition)}
`;
      changed = true;
    }
  }
  return selected.sort((left, right) => left.start - right.start);
}
function collectPrologue(lines, language, beforeLine) {
  const prologue = [];
  const max = Math.max(beforeLine, 0);
  for (let index = 0; index < max; index += 1) {
    const line = lines[index];
    if (isPrologueLine(line, language)) {
      prologue.push(line);
    }
  }
  return prologue.length ? [prologue.join("\n")] : [];
}
function isPrologueLine(line, language) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  switch (language) {
    case "python":
      return /^(from\s+\S+\s+import\s+|import\s+)/.test(trimmed);
    case "javascript":
    case "typescript":
      return /^(import\s+|export\s+.*\s+from\s+|(?:const|let|var)\s+\w+\s*=\s*require\s*\()/.test(trimmed);
    case "c":
    case "cpp":
    case "llvm-ir":
      return trimmed.startsWith("#") || trimmed.startsWith("target ") || trimmed.startsWith("source_filename");
    case "haskell":
      return /^(module\s+|import\s+)/.test(trimmed);
    case "ocaml":
      return /^(open\s+|include\s+|#use\s+)/.test(trimmed);
    case "java":
      return /^(package\s+|import\s+)/.test(trimmed);
    default:
      return false;
  }
}
function collectDefinitions(lines, language) {
  switch (language) {
    case "python":
      return collectPythonDefinitions(lines);
    case "javascript":
    case "typescript":
      return collectBraceDefinitions(lines, /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    case "c":
      return collectCDefinitions(lines, false);
    case "cpp":
      return collectCDefinitions(lines, true);
    case "haskell":
      return collectHaskellDefinitions(lines);
    case "ocaml":
      return collectOcamlDefinitions(lines);
    case "java":
      return collectBraceDefinitions(lines, /^\s*(?:public|private|protected|static|final|abstract|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b|^\s*(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    case "llvm-ir":
      return collectLlvmDefinitions(lines);
    default:
      return [];
  }
}
function collectPythonDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = lines[index].match(/^([A-Za-z_]\w*)\s*[:=]/);
    if (assignment) {
      definitions.push({ name: assignment[1], start: index, end: index });
      continue;
    }
    const match = lines[index].match(/^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("@") && getIndent(lines[start - 1]) === indent) {
      start -= 1;
    }
    let end = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() && getIndent(lines[cursor]) <= indent) {
        break;
      }
      end = cursor;
    }
    definitions.push({ name: match[2], start, end });
  }
  return definitions;
}
function collectCDefinitions(lines, isCpp) {
  const definitions = [];
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const topLevel = depth === 0;
    if (topLevel && trimmed) {
      const macro = trimmed.match(/^#\s*define\s+([A-Za-z_]\w*)\b/);
      if (macro) {
        definitions.push({ name: macro[1], start: index, end: index });
      } else if (!trimmed.startsWith("#") && !isCCommentLine(trimmed)) {
        const typeDefinition = matchCTypeDefinition(lines, index, isCpp);
        if (typeDefinition) {
          definitions.push(typeDefinition);
          index = Math.max(index, typeDefinition.end);
        } else {
          const functionDefinition = matchCFunctionDefinition(lines, index);
          if (functionDefinition) {
            definitions.push(functionDefinition);
            index = Math.max(index, functionDefinition.end);
          } else {
            const globalDefinition = matchCGlobalDefinition(line, index);
            if (globalDefinition) {
              definitions.push(globalDefinition);
            }
          }
        }
      }
    }
    depth += braceDelta(line);
    if (depth < 0) {
      depth = 0;
    }
  }
  return definitions;
}
function matchCTypeDefinition(lines, start, isCpp) {
  const header = lines.slice(start, Math.min(lines.length, start + 8)).join(" ");
  const keywordPattern = isCpp ? "(?:typedef\\s+)?(?:struct|class|enum|union)" : "(?:typedef\\s+)?(?:struct|enum|union)";
  const named = header.match(new RegExp(`^\\s*${keywordPattern}\\s+([A-Za-z_]\\w*)\\b`));
  const anonymousTypedef = header.match(/^\s*typedef\s+(?:struct|enum|union)\b[\s\S]*?\}\s*([A-Za-z_]\w*)\s*;/);
  const name = named?.[1] ?? anonymousTypedef?.[1];
  if (!name) {
    return null;
  }
  const end = findCDeclarationEnd(lines, start);
  return { name, names: [name], start, end };
}
function matchCFunctionDefinition(lines, start) {
  const headerLines = lines.slice(start, Math.min(lines.length, start + 12));
  const joined = headerLines.join(" ");
  const braceOffset = headerLines.findIndex((line) => line.includes("{"));
  if (braceOffset < 0 || joined.indexOf(";") >= 0 && joined.indexOf(";") < joined.indexOf("{")) {
    return null;
  }
  const matches = [...joined.matchAll(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?|operator\s*[^\s(]+)\s*\([^;{}]*\)\s*(?:const\b[^{}]*)?(?:noexcept\b[^{}]*)?(?:->\s*[^{}]+)?\{/g)];
  const name = matches[0]?.[1]?.replace(/\s+/g, "");
  if (!name || isCControlKeyword(name)) {
    return null;
  }
  const braceLine = start + braceOffset;
  const shortName = name.includes("::") ? name.split("::").pop() ?? name : name;
  return {
    name: shortName,
    names: [.../* @__PURE__ */ new Set([shortName, name])],
    start,
    end: findBraceRangeEnd(lines, braceLine)
  };
}
function matchCGlobalDefinition(line, index) {
  const trimmed = line.trim();
  if (!trimmed.endsWith(";") || trimmed.includes("(") || /^(return|using|namespace|template)\b/.test(trimmed)) {
    return null;
  }
  const withoutInitializer = trimmed.split("=")[0].replace(/\[[^\]]*]/g, "");
  const match = withoutInitializer.match(/([A-Za-z_]\w*)\s*(?:[,;]|$)/g)?.pop()?.match(/([A-Za-z_]\w*)/);
  const name = match?.[1];
  if (!name || /^(const|static|extern|volatile|unsigned|signed|long|short|int|char|float|double|void|auto)$/.test(name)) {
    return null;
  }
  return { name, start: index, end: index };
}
function collectLlvmDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const symbol = line.match(/^\s*(?:define|declare)\b.*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*\(/);
    if (symbol) {
      const end = line.trimStart().startsWith("define") ? findBraceRangeEnd(lines, index) : index;
      definitions.push({ name: symbol[1], names: [symbol[1], `@${symbol[1]}`], start: index, end });
      continue;
    }
    const global = line.match(/^\s*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*=/);
    if (global) {
      definitions.push({ name: global[1], names: [global[1], `@${global[1]}`], start: index, end: index });
    }
  }
  return definitions;
}
function collectHaskellDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(module|import)\b/.test(trimmed)) {
      continue;
    }
    const names = getHaskellDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findHaskellRangeEnd(lines, index, names[0]);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectOcamlDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(open|include|#use)\b/.test(trimmed)) {
      continue;
    }
    const names = getOcamlDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findLayoutRangeEnd(lines, index, isOcamlTopLevelStart);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectBraceDefinitions(lines, pattern) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    const name = match?.slice(1).find(Boolean);
    if (!name) {
      continue;
    }
    definitions.push({ name, start: index, end: findBraceRangeEnd(lines, index) });
  }
  return definitions;
}
function findBraceRangeEnd(lines, start) {
  if (!lines[start].includes("{")) {
    return start;
  }
  let depth = 0;
  let sawBrace = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) {
      return index;
    }
  }
  return start;
}
function findCDeclarationEnd(lines, start) {
  let sawBrace = false;
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if ((!sawBrace || depth <= 0) && lines[index].includes(";")) {
      return index;
    }
  }
  return start;
}
function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}
function isCCommentLine(trimmed) {
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}
function isCControlKeyword(name) {
  return ["if", "for", "while", "switch", "catch"].includes(name);
}
function getHaskellDefinitionNames(trimmed) {
  const signature = trimmed.match(/^([a-z_][\w']*)\s*::/);
  if (signature) {
    return [signature[1]];
  }
  const binding = trimmed.match(/^([a-z_][\w']*)\b.*=/);
  if (binding) {
    return [binding[1]];
  }
  const typeLike = trimmed.match(/^(?:data|newtype|type|class)\s+([A-Z][\w']*)\b/);
  if (typeLike) {
    return [typeLike[1]];
  }
  const instance = trimmed.match(/^instance\b.*?\b([A-Z][\w']*)\b/);
  return instance ? [instance[1]] : [];
}
function getOcamlDefinitionNames(trimmed) {
  const letBinding = trimmed.match(/^let\s+(?:rec\s+)?(?:\(([^)]+)\)|([a-z_][\w']*))/);
  if (letBinding) {
    return [letBinding[1] ?? letBinding[2]];
  }
  const typeBinding = trimmed.match(/^type\s+([a-z_][\w']*)/);
  if (typeBinding) {
    return [typeBinding[1]];
  }
  const moduleBinding = trimmed.match(/^module\s+([A-Z][\w']*)/);
  if (moduleBinding) {
    return [moduleBinding[1]];
  }
  return [];
}
function findLayoutRangeEnd(lines, start, isTopLevelStart) {
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) === 0 && isTopLevelStart(line.trim())) {
      break;
    }
    end = index;
  }
  return end;
}
function findHaskellRangeEnd(lines, start, name) {
  let end = start;
  let allowMatchingEquation = lines[start].trim().startsWith(`${name} ::`);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed && getIndent(line) === 0 && isHaskellTopLevelStart(trimmed)) {
      if (allowMatchingEquation && trimmed.startsWith(`${name} `) && trimmed.includes("=")) {
        allowMatchingEquation = false;
        end = index;
        continue;
      }
      break;
    }
    end = index;
  }
  return end;
}
function isHaskellTopLevelStart(trimmed) {
  return /^(module|import|data|newtype|type|class|instance)\b/.test(trimmed) || /^[a-z_][\w']*\s*(?:::|.*=)/.test(trimmed);
}
function isOcamlTopLevelStart(trimmed) {
  return /^(open|include|#use|let|type|module)\b/.test(trimmed);
}
function renderRange(lines, range) {
  return lines.slice(range.start, range.end + 1).join("\n");
}
function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}
function getIndent(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function definitionNames(definition) {
  return definition.names?.length ? definition.names : [definition.name];
}
function sourceUsesName(source, name) {
  if (name.startsWith("@")) {
    return new RegExp(`${escapeRegex(name)}\\b`).test(source);
  }
  return new RegExp(`\\b${escapeRegex(name)}\\b`).test(source);
}
function formatSourceDescription(reference, range) {
  if (reference.symbolName) {
    return `${reference.filePath}#${reference.symbolName}`;
  }
  if (range) {
    return `${reference.filePath}:L${range.start + 1}-L${range.end + 1}`;
  }
  return reference.filePath;
}
var PYTHON_AST_HELPER = String.raw`
import ast
import json
import sys

payload = json.loads(sys.stdin.read())
source = payload.get("source", "")
mode = payload.get("mode", "module")

def range_start(node):
    lineno = getattr(node, "lineno", 1)
    decorators = getattr(node, "decorator_list", None) or []
    if decorators:
        lineno = min(lineno, *(getattr(decorator, "lineno", lineno) for decorator in decorators))
    return lineno - 1

def range_end(node):
    return getattr(node, "end_lineno", getattr(node, "lineno", 1)) - 1

def target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(target_names(item))
        return names
    return []

def definition_names(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        names = []
        for target in node.targets:
            names.extend(target_names(target))
        return names
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return target_names(node.target)
    return []

def inspect_module(tree):
    definitions = []
    imports = []
    for node in tree.body:
        names = definition_names(node)
        if names:
            definitions.append({
                "name": names[0],
                "names": names,
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.Import):
            imports.append({
                "kind": "import",
                "module": "",
                "level": 0,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.ImportFrom):
            imports.append({
                "kind": "from",
                "module": node.module or "",
                "level": node.level,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
    return {"definitions": definitions, "imports": imports}

def attribute_chain(node):
    chain = []
    current = node
    while isinstance(current, ast.Attribute):
        chain.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        chain.append(current.id)
        chain.reverse()
        return chain
    return []

class UsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.names = set()
        self.attributes = {}

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_Attribute(self, node):
        chain = attribute_chain(node)
        if len(chain) >= 2:
            self.names.add(chain[0])
            self.attributes.setdefault(chain[0], set()).add(chain[1])
        self.generic_visit(node)

def inspect_usage(tree):
    visitor = UsageVisitor()
    visitor.visit(tree)
    return {
        "names": sorted(visitor.names),
        "attributes": {key: sorted(value) for key, value in visitor.attributes.items()},
    }

try:
    tree = ast.parse(source)
except SyntaxError:
    print(json.dumps({"definitions": [], "imports": []} if mode == "module" else {"names": [], "attributes": {}}))
    raise SystemExit(0)

if mode == "module":
    print(json.dumps(inspect_module(tree)))
else:
    print(json.dumps(inspect_usage(tree)))
`;

// src/sourceHarness.ts
function buildSourceReferenceHarness(block) {
  const call = block.sourceReference?.call;
  if (!call) {
    return block.content;
  }
  const symbolName = block.sourceReference?.symbolName?.trim();
  const input = block.content.trim();
  const expression = call.expression?.trim() ? renderSourceCallTemplate(call.expression, input, symbolName) : renderDefaultSourceCall(symbolName, call.args, input);
  return renderLanguageCallHarness(block.language, expression, call.print);
}
function renderDefaultSourceCall(symbolName, args, input) {
  if (!symbolName) {
    throw new Error("loom-call needs loom-symbol when no call expression is provided.");
  }
  const renderedArgs = renderSourceCallTemplate(args?.trim() || "{input}", input, symbolName);
  return `${symbolName}(${renderedArgs})`;
}
function renderSourceCallTemplate(template, input, symbolName) {
  return template.replaceAll("{input}", input).replaceAll("{symbol}", symbolName ?? "");
}
function renderLanguageCallHarness(language, expression, print) {
  if (!print) {
    return renderExpressionStatement(language, expression);
  }
  switch (language) {
    case "python":
      return `print(${expression})`;
    case "javascript":
    case "typescript":
      return `console.log(${expression});`;
    case "c":
      return `#include <stdio.h>
int main(void) { printf("%d\\n", ${expression}); return 0; }`;
    case "cpp":
      return `#include <iostream>
int main() { std::cout << (${expression}) << "\\n"; return 0; }`;
    case "ocaml":
      return `let () = print_endline (${expression})`;
    default:
      throw new Error(`loom-call cannot generate a printed harness for ${language}. Use loom-print=false or write the harness in the block body.`);
  }
}
function renderExpressionStatement(language, expression) {
  switch (language) {
    case "python":
    case "ocaml":
      return expression;
    default:
      return expression.endsWith(";") ? expression : `${expression};`;
  }
}

// src/ui/codeBlockToolbar.ts
var import_obsidian4 = require("obsidian");
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
  (0, import_obsidian4.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian5 = require("obsidian");
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
  (0, import_obsidian5.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
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
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}
function createSourcePreview(container, preview) {
  const details = container.createEl("details", { cls: "loom-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "loom-source-preview-summary" });
  summary.createSpan({ text: "Extracted source" });
  summary.createSpan({ cls: "loom-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  details.createEl("pre", { cls: "loom-output-pre loom-source-preview-pre", text: preview.content });
}
function formatSourcePreviewMeta(preview) {
  const capability = preview.capability;
  if (!capability || !preview.showCapabilityMetadata) {
    return `${preview.language} \xB7 ${preview.description}`;
  }
  return [
    preview.language,
    preview.description,
    `symbols:${capability.symbolExtraction}`,
    `deps:${capability.dependencyTracing}`,
    `call:${capability.callHarness}`
  ].join(" \xB7 ");
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian5.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian6.Modal {
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
var loomToolbarRenderChild = class extends import_obsidian6.MarkdownRenderChild {
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
var loomPlugin = class extends import_obsidian6.Plugin {
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
      new EbpfRunner(),
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
          new import_obsidian6.Notice("No supported loom block at the current cursor.");
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
        new import_obsidian6.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
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
        if (ctx instanceof import_obsidian6.MarkdownView) {
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
    normalizeLanguageConfiguration(this.settings);
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
          new import_obsidian6.Notice("Code copied");
        } catch {
          new import_obsidian6.Notice("Clipboard write failed.");
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
    if (!(file instanceof import_obsidian6.TFile)) {
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
    new import_obsidian6.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });
    if (!supportedBlocks.length) {
      new import_obsidian6.Notice("No supported loom blocks found in the current note.");
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
    new import_obsidian6.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian6.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    const containerGroup = executionContext.containerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian6.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
      }
      if (this.hasExplicitExecutionContext(executionContext)) {
        const contextNotice = this.formatExecutionContextNotice(executionContext);
        result.warning = result.warning ? `${contextNotice}
${result.warning}` : contextNotice;
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian6.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
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
      new import_obsidian6.Notice(`loom error: ${message}`);
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
  async resolveExecutableBlock(file, block) {
    if (!block.sourceReference) {
      return { block };
    }
    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof import_obsidian6.TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }
    const harness = buildSourceReferenceHarness(block);
    const externalExtractor = this.getCustomLanguageExtractor(block, file);
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      harness,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor,
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath((0, import_obsidian6.normalizePath)(filePath));
          return importedFile instanceof import_obsidian6.TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level)
      }
    );
    const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourcePreview: shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true
      } : void 0
    };
  }
  resolveReferencedVaultPath(file, referencePath) {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return (0, import_obsidian6.normalizePath)(trimmed.slice(1));
    }
    const baseDir = (0, import_path10.dirname)(file.path);
    return (0, import_obsidian6.normalizePath)(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
  }
  resolvePythonImportVaultPath(fromFilePath, moduleName, level) {
    const modulePath = moduleName.split(".").map((part) => part.trim()).filter(Boolean).join("/");
    const fromDir = (0, import_path10.dirname)(fromFilePath);
    const baseDirs = level > 0 ? [this.ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)] : [fromDir === "." ? "" : fromDir, ""];
    for (const baseDir of baseDirs) {
      const candidates = this.getPythonImportCandidates(baseDir, modulePath);
      for (const candidate of candidates) {
        const normalized = (0, import_obsidian6.normalizePath)(candidate);
        if (this.app.vault.getAbstractFileByPath(normalized) instanceof import_obsidian6.TFile) {
          return normalized;
        }
      }
    }
    return null;
  }
  getPythonImportCandidates(baseDir, modulePath) {
    const prefix = baseDir ? `${baseDir}/` : "";
    if (!modulePath) {
      return [`${prefix}__init__.py`];
    }
    return [
      `${prefix}${modulePath}.py`,
      `${prefix}${modulePath}/__init__.py`
    ];
  }
  ascendVaultPath(path, levels) {
    let current = path;
    for (let index = 0; index < levels; index += 1) {
      const next = (0, import_path10.dirname)(current);
      current = next === "." ? "" : next;
    }
    return current;
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian6.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
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
        if (!(file instanceof import_obsidian6.TFile)) {
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async disableSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
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
    if (!(view instanceof import_obsidian6.MarkdownView) || !view.file) {
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
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
  hasExplicitExecutionContext(context) {
    return context.source.container !== "none" || context.source.workingDirectory !== "default" || context.source.timeout !== "global";
  }
  formatExecutionContextNotice(context) {
    const pieces = [
      `container=${context.containerGroup ?? "native"} (${context.source.container})`,
      `cwd=${context.workingDirectory} (${context.source.workingDirectory})`,
      `timeout=${context.timeoutMs}ms (${context.source.timeout})`
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }
  getCustomLanguageExtractor(block, file) {
    const languageId = block.language;
    const normalized = languageId.trim().toLowerCase();
    const language = this.settings.customLanguages.find((candidate) => {
      const name = candidate.name.trim().toLowerCase();
      const aliases = candidate.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
    if (!language) {
      return void 0;
    }
    const mode = language.extractorMode || "command";
    const executable = mode === "transpile-c" ? language.transpileExecutable?.trim() : language.extractorExecutable?.trim();
    const args = mode === "transpile-c" ? language.transpileArgs || "{request}" : language.extractorArgs || "{request}";
    if (!executable) {
      return void 0;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs
    };
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
    if (!(file instanceof import_obsidian6.TFile)) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBFYnBmUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9lYnBmXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcbmltcG9ydCB7IGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xuXG5jbGFzcyBFeGVjdXRpb25Db25zZW50TW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogUGx1Z2luW1wiYXBwXCJdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25Db25maXJtOiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJFbmFibGUgbG9vbSBsb2NhbCBleGVjdXRpb24/XCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcImxvb20gcnVucyBjb2RlIGZyb20geW91ciBub3RlcyBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgdXNpbmcgdGhlIGNvbmZpZ3VyZWQgZXhlY3V0YWJsZXMuIEl0IGRvZXMgbm90IHNhbmRib3ggb3IgaXNvbGF0ZSB0aGUgcHJvY2Vzcy5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNhbmNlbEJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pO1xuICAgIGNvbnN0IGVuYWJsZUJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkVuYWJsZSBhbmQgcnVuXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG5cbiAgICBjYW5jZWxCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgZW5hYmxlQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQgZXh0ZW5kcyBNYXJrZG93blJlbmRlckNoaWxkIHtcbiAgcHJpdmF0ZSBwYW5lbENvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB1bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LFxuICApIHtcbiAgICBzdXBlcihjb250YWluZXJFbCk7XG4gIH1cblxuICBvbmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5jb2RlRWxlbWVudC5wYXJlbnRFbGVtZW50Py5hZGRDbGFzcyhcImxvb20tY29kZWJsb2NrLXNoZWxsXCIpO1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYXBwZW5kQ2hpbGQodGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jaykpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwib3V0cHV0XCIpIHtcbiAgICAgIHRoaXMuY29kZUVsZW1lbnQuY2xhc3NMaXN0LmFkZChcImxvb20tcHJpbnQtaGlkZS1jb2RlXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhvc3RDbGFzc2VzID0gW1wibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIl07XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwiY29kZVwiKSB7XG4gICAgICBob3N0Q2xhc3Nlcy5wdXNoKFwibG9vbS1wcmludC1oaWRlLW91dHB1dFwiKTtcbiAgICB9XG4gICAgdGhpcy5wYW5lbENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBob3N0Q2xhc3Nlcy5qb2luKFwiIFwiKSB9KTtcblxuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIgPSB0aGlzLnBsdWdpbi5yZWdpc3Rlck91dHB1dExpc3RlbmVyKHRoaXMuYmxvY2suaWQsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLnBhbmVsQ29udGFpbmVyKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnVucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcj8uKCk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbVRvb2xiYXJXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpc1J1bm5pbmc6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmlzUnVubmluZyA9IHBsdWdpbi5pc0Jsb2NrUnVubmluZyhibG9jay5pZCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIuaXNSdW5uaW5nID09PSB0aGlzLmlzUnVubmluZztcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBFYnBmUnVubmVyKCksXG4gICAgbmV3IExsdm1SdW5uZXIoKSxcbiAgICBuZXcgUHJvb2ZSdW5uZXIoKSxcbiAgICBuZXcgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIoKSxcbiAgXSk7XG4gIC8vIEV4cG9zZWQgYXMgcHVibGljIGFuZCByZWFkb25seSBzbyB0aGUgc2V0dGluZ3MgcGFuZWwgYW5kIG1vZGFscyBjYW4gYWNjZXNzIGNvbnRhaW5lciBjb25maWd1cmF0aW9ucyBhbmQgZGVmYXVsdCBsYW5ndWFnZSBtYXBwaW5nIGhlbHBlcnMuXG4gIHB1YmxpYyByZWFkb25seSBjb250YWluZXJSdW5uZXIgPSBuZXcgbG9vbUNvbnRhaW5lclJ1bm5lcih0aGlzLmFwcCwgdGhpcy5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCIpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBsb29tU3RvcmVkT3V0cHV0PigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJ1bm5pbmcgPSBuZXcgTWFwPHN0cmluZywgQWJvcnRDb250cm9sbGVyPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dExpc3RlbmVycyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8KCkgPT4gdm9pZD4+KCk7XG4gIHByaXZhdGUgc3RhdHVzQmFySXRlbUVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgZWRpdG9yVmlld3MgPSBuZXcgU2V0PEVkaXRvclZpZXc+KCk7XG4gIHByaXZhdGUgbGFzdE1hcmtkb3duRmlsZVBhdGg6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgbG9vbVNldHRpbmdUYWIodGhpcykpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsID0gdGhpcy5hZGRTdGF0dXNCYXJJdGVtKCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tcnVuLWN1cnJlbnQtY29kZS1ibG9ja1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBSdW4gQ3VycmVudCBDb2RlIEJsb2NrXCIsXG4gICAgICBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvciwgdmlldykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdmlldy5maWxlO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3QgYmxvY2sgPSBmaW5kQmxvY2tBdExpbmUoYmxvY2tzLCBlZGl0b3IuZ2V0Q3Vyc29yKCkubGluZSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2sgYXQgdGhlIGN1cnJlbnQgY3Vyc29yLlwiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tcnVuLWFsbC1jb2RlLWJsb2Nrc1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBSdW4gQWxsIFN1cHBvcnRlZCBDb2RlIEJsb2NrcyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMucnVuQWxsQmxvY2tzSW5GaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLWNsZWFyLW5vdGUtb3V0cHV0c1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBDbGVhciBsb29tIE91dHB1dHMgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmNsZWFyT3V0cHV0c0ZvckZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24odGhpcy5jcmVhdGVMaXZlUHJldmlld0V4dGVuc2lvbigpKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCAoZmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gZmlsZT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgIGlmIChmaWxlICYmIHRoaXMuc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pIHtcbiAgICAgICAgICB2b2lkIHRoaXMucnVuQWxsQmxvY2tzSW5GaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tdmFsaWRhdGUtY29udGFpbmVyLWdyb3Vwc1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBWYWxpZGF0ZSBDb250YWluZXIgR3JvdXBzXCIsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XG4gICAgICAgIG5ldyBOb3RpY2UoZ3JvdXBzLmxlbmd0aCA/IGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBgJHtncm91cC5uYW1lfTogJHtncm91cC5zdGF0dXN9YCkuam9pbihcIlxcblwiKSA6IFwiTm8gbG9vbSBjb250YWluZXIgZ3JvdXBzIGZvdW5kLlwiLCA4MDAwKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLWNoYW5nZVwiLCAoX2VkaXRvciwgY3R4KSA9PiB7XG4gICAgICAgIGlmIChjdHggaW5zdGFuY2VvZiBNYXJrZG93blZpZXcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGN0eC5sZWFmKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiB0aGlzLnJ1bm5pbmcudmFsdWVzKCkpIHtcbiAgICAgIGNvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IHtcbiAgICAgIC4uLkRFRkFVTFRfU0VUVElOR1MsXG4gICAgICAuLi4oYXdhaXQgdGhpcy5sb2FkRGF0YSgpKSxcbiAgICB9O1xuICAgIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbih0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIGlzQmxvY2tSdW5uaW5nKGJsb2NrSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpO1xuICB9XG5cbiAgcmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcihibG9ja0lkOiBzdHJpbmcsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLnNldChibG9ja0lkLCBuZXcgU2V0KCkpO1xuICAgIH1cbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZGVsZXRlKGxpc3RlbmVyKTtcbiAgICB9O1xuICB9XG5cbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoYmxvY2suaWQsIHRoaXMuaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpLCB7XG4gICAgICBvblJ1bjogKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCksXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChibG9jay5jb250ZW50KTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDbGlwYm9hcmQgd3JpdGUgZmFpbGVkLlwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uUmVtb3ZlOiAoKSA9PiB2b2lkIHRoaXMucmVtb3ZlU25pcHBldEJ5SWQoYmxvY2suaWQpLFxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9jay5pZCk7XG4gICAgICAgIGlmICghb3V0cHV0KSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG91dHB1dC52aXNpYmxlID0gIW91dHB1dC52aXNpYmxlO1xuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlck91dHB1dEludG8oYmxvY2tJZDogc3RyaW5nLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG5cbiAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUnVubmluZ1BhbmVsKCkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghb3V0cHV0IHx8ICFvdXRwdXQudmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgaWYgKCFibG9jaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnJ1bm5pbmcuZ2V0KGJsb2NrSWQpPy5hYm9ydCgpO1xuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XG4gICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9ja0lkKTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFuYWdlZFJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XG4gICAgICBjb25zdCByZW1vdmFsRW5kID0gbWFuYWdlZFJhbmdlID8gbWFuYWdlZFJhbmdlLmVuZCA6IGN1cnJlbnRCbG9jay5lbmRMaW5lO1xuICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgcmVtb3ZhbEVuZCAtIHJlbW92YWxTdGFydCArIDEpO1xuXG4gICAgICB3aGlsZSAocmVtb3ZhbFN0YXJ0IDwgbGluZXMubGVuZ3RoIC0gMSAmJiBsaW5lc1tyZW1vdmFsU3RhcnRdID09PSBcIlwiICYmIGxpbmVzW3JlbW92YWxTdGFydCArIDFdID09PSBcIlwiKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIG5ldyBOb3RpY2UoXCJsb29tIHNuaXBwZXQgcmVtb3ZlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5BbGxCbG9ja3NJbkZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBzdXBwb3J0ZWRCbG9ja3MgPSBibG9ja3MuZmlsdGVyKChibG9jaykgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dC5jb250YWluZXJHcm91cCB8fCB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICB9KTtcblxuICAgIGlmICghc3VwcG9ydGVkQmxvY2tzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrcyBmb3VuZCBpbiB0aGUgY3VycmVudCBub3RlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIHN1cHBvcnRlZEJsb2Nrcykge1xuICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLnBhdGgsIGJsb2NrLmlkKTtcbiAgICB9XG4gICAgbmV3IE5vdGljZShcImxvb20gb3V0cHV0cyBjbGVhcmVkLlwiKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlLnBhdGg7XG4gICAgaWYgKHRoaXMucnVubmluZy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiVGhpcyBsb29tIGJsb2NrIGlzIGFscmVhZHkgcnVubmluZy5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVFeGVjdXRpb25FbmFibGVkKCkpKSB7XG4gICAgICBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBjb250YWluZXJHcm91cCA9IGV4ZWN1dGlvbkNvbnRleHQuY29udGFpbmVyR3JvdXA7XG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmICghY29udGFpbmVyR3JvdXApIHtcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBydW5Db250ZXh0ID0ge1xuICAgICAgZmlsZSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGV4ZWN1dGlvbkNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQmxvY2sgPSBhd2FpdCB0aGlzLnJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgY29uc3QgcmVzdWx0ID0gY29udGFpbmVyR3JvdXBcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncywgY29udGFpbmVyR3JvdXApXG4gICAgICAgIDogYXdhaXQgcnVubmVyIS5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVzb2x2ZWRCbG9jay5zb3VyY2VQcmV2aWV3KSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZU5vdGljZSA9IGBSYW4gZXh0cmFjdGVkIHNvdXJjZSBmcm9tICR7cmVzb2x2ZWRCbG9jay5zb3VyY2VQcmV2aWV3LmRlc2NyaXB0aW9ufS5gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7c291cmNlTm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IHNvdXJjZU5vdGljZTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmhhc0V4cGxpY2l0RXhlY3V0aW9uQ29udGV4dChleGVjdXRpb25Db250ZXh0KSkge1xuICAgICAgICBjb25zdCBjb250ZXh0Tm90aWNlID0gdGhpcy5mb3JtYXRFeGVjdXRpb25Db250ZXh0Tm90aWNlKGV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7Y29udGV4dE5vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBjb250ZXh0Tm90aWNlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBzb3VyY2VQcmV2aWV3OiByZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcsXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLCBibG9jaywgcmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcnVubmVyTmFtZSA9IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXIhLmRpc3BsYXlOYW1lO1xuICAgICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIHJhbiAke3J1bm5lck5hbWV9IGJsb2NrLmAgOiBgbG9vbSBydW4gZmFpbGVkIGZvciAke3J1bm5lck5hbWV9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xuICAgICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgICAgYmxvY2ssXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHJ1bm5lcklkOiBjb250YWluZXJHcm91cCA/IGBjb250YWluZXI6JHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5pZCA/PyBcInVua25vd25cIixcbiAgICAgICAgICBydW5uZXJOYW1lOiBjb250YWluZXJHcm91cCA/IGBDb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5kaXNwbGF5TmFtZSA/PyBcIlVua25vd25cIixcbiAgICAgICAgICBzdGFydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBmaW5pc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgICAgc3Rkb3V0OiBcIlwiLFxuICAgICAgICAgIHN0ZGVycjogbWVzc2FnZSxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgbmV3IE5vdGljZShgbG9vbSBlcnJvcjogJHttZXNzYWdlfWApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZTxib29sZWFuPigocmVzb2x2ZSkgPT4ge1xuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IHNldHRsZSA9ICh2YWx1ZTogYm9vbGVhbikgPT4ge1xuICAgICAgICBpZiAoIXNldHRsZWQpIHtcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcbiAgICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbW9kYWwgPSBuZXcgRXhlY3V0aW9uQ29uc2VudE1vZGFsKHRoaXMuYXBwLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB0cnVlO1xuICAgICAgICB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBzZXR0bGUodHJ1ZSk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxDbG9zZSA9IG1vZGFsLmNsb3NlLmJpbmQobW9kYWwpO1xuICAgICAgbW9kYWwuY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIG9yaWdpbmFsQ2xvc2UoKTtcbiAgICAgICAgc2V0dGxlKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKTtcbiAgICAgIH07XG4gICAgICBtb2RhbC5vcGVuKCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx7IGJsb2NrOiBsb29tQ29kZUJsb2NrOyBzb3VyY2VQcmV2aWV3PzogbG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0gfT4ge1xuICAgIGlmICghYmxvY2suc291cmNlUmVmZXJlbmNlKSB7XG4gICAgICByZXR1cm4geyBibG9jayB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlZmVyZW5jZVBhdGggPSB0aGlzLnJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGUsIGJsb2NrLnNvdXJjZVJlZmVyZW5jZS5maWxlUGF0aCk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZWZlcmVuY2VQYXRoKTtcbiAgICBpZiAoIShzb3VyY2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlZmVyZW5jZWQgc291cmNlIGZpbGUgbm90IGZvdW5kOiAke3JlZmVyZW5jZVBhdGh9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgaGFybmVzcyA9IGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jayk7XG4gICAgY29uc3QgZXh0ZXJuYWxFeHRyYWN0b3IgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlRXh0cmFjdG9yKGJsb2NrLCBmaWxlKTtcbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChzb3VyY2VGaWxlKSxcbiAgICAgIHsgLi4uYmxvY2suc291cmNlUmVmZXJlbmNlLCBmaWxlUGF0aDogcmVmZXJlbmNlUGF0aCB9LFxuICAgICAgYmxvY2subGFuZ3VhZ2UsXG4gICAgICBoYXJuZXNzLFxuICAgICAge1xuICAgICAgICBweXRob25FeGVjdXRhYmxlOiB0aGlzLnNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwicHl0aG9uM1wiLFxuICAgICAgICBleHRlcm5hbEV4dHJhY3RvcixcbiAgICAgICAgcmVhZEZpbGU6IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGltcG9ydGVkRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVQYXRoKGZpbGVQYXRoKSk7XG4gICAgICAgICAgcmV0dXJuIGltcG9ydGVkRmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChpbXBvcnRlZEZpbGUpIDogbnVsbDtcbiAgICAgICAgfSxcbiAgICAgICAgcmVzb2x2ZVB5dGhvbkltcG9ydDogYXN5bmMgKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpID0+IHRoaXMucmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGgsIG1vZHVsZU5hbWUsIGxldmVsKSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gZ2V0TGFuZ3VhZ2VDYXBhYmlsaXR5KGJsb2NrLmxhbmd1YWdlLCBCb29sZWFuKGV4dGVybmFsRXh0cmFjdG9yKSk7XG4gICAgY29uc3Qgc2hvdWxkU2hvd1ByZXZpZXcgPSAodGhpcy5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSB8fCBcImNvbGxhcHNlZFwiKSAhPT0gXCJoaWRkZW5cIjtcblxuICAgIHJldHVybiB7XG4gICAgICBibG9jazoge1xuICAgICAgICAuLi5ibG9jayxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIH0sXG4gICAgICBzb3VyY2VQcmV2aWV3OiBzaG91bGRTaG93UHJldmlldyA/IHtcbiAgICAgICAgZGVzY3JpcHRpb246IHJlc29sdmVkLmRlc2NyaXB0aW9uLFxuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICAgIGNhcGFiaWxpdHksXG4gICAgICAgIGV4cGFuZGVkOiB0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID09PSBcImV4cGFuZGVkXCIsXG4gICAgICAgIHNob3dDYXBhYmlsaXR5TWV0YWRhdGE6IHRoaXMuc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID8/IHRydWUsXG4gICAgICB9IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGU6IFRGaWxlLCByZWZlcmVuY2VQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRyaW1tZWQgPSByZWZlcmVuY2VQYXRoLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgodHJpbW1lZC5zbGljZSgxKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYmFzZURpciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChiYXNlRGlyID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtiYXNlRGlyfS8ke3RyaW1tZWR9YCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVQeXRob25JbXBvcnRWYXVsdFBhdGgoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IG1vZHVsZVBhdGggPSBtb2R1bGVOYW1lXG4gICAgICAuc3BsaXQoXCIuXCIpXG4gICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiL1wiKTtcbiAgICBjb25zdCBmcm9tRGlyID0gZGlybmFtZShmcm9tRmlsZVBhdGgpO1xuICAgIGNvbnN0IGJhc2VEaXJzID0gbGV2ZWwgPiAwXG4gICAgICA/IFt0aGlzLmFzY2VuZFZhdWx0UGF0aChmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBsZXZlbCAtIDEpXVxuICAgICAgOiBbZnJvbURpciA9PT0gXCIuXCIgPyBcIlwiIDogZnJvbURpciwgXCJcIl07XG5cbiAgICBmb3IgKGNvbnN0IGJhc2VEaXIgb2YgYmFzZURpcnMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLmdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpciwgbW9kdWxlUGF0aCk7XG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmICh0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobm9ybWFsaXplZCkgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICAgIHJldHVybiBub3JtYWxpemVkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpcjogc3RyaW5nLCBtb2R1bGVQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcHJlZml4ID0gYmFzZURpciA/IGAke2Jhc2VEaXJ9L2AgOiBcIlwiO1xuICAgIGlmICghbW9kdWxlUGF0aCkge1xuICAgICAgcmV0dXJuIFtgJHtwcmVmaXh9X19pbml0X18ucHlgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9LnB5YCxcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9L19faW5pdF9fLnB5YCxcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBhc2NlbmRWYXVsdFBhdGgocGF0aDogc3RyaW5nLCBsZXZlbHM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgbGV0IGN1cnJlbnQgPSBwYXRoO1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsZXZlbHM7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9IG5leHQgPT09IFwiLlwiID8gXCJcIiA6IG5leHQ7XG4gICAgfVxuICAgIHJldHVybiBjdXJyZW50O1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsZWFmID0gdmlldy5sZWFmO1xuICAgIGNvbnN0IHZpZXdTdGF0ZSA9IGxlYWYuZ2V0Vmlld1N0YXRlKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLih2aWV3U3RhdGUuc3RhdGUgPz8ge30pIH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgXG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XG4gICAgICBzdGF0ZS5zb3VyY2UgPSBmYWxzZTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgICBzdGF0ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBjb250ZXh0LnNvdXJjZS5jb250YWluZXIgIT09IFwibm9uZVwiIHx8IGNvbnRleHQuc291cmNlLndvcmtpbmdEaXJlY3RvcnkgIT09IFwiZGVmYXVsdFwiIHx8IGNvbnRleHQuc291cmNlLnRpbWVvdXQgIT09IFwiZ2xvYmFsXCI7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGllY2VzID0gW1xuICAgICAgYGNvbnRhaW5lcj0ke2NvbnRleHQuY29udGFpbmVyR3JvdXAgPz8gXCJuYXRpdmVcIn0gKCR7Y29udGV4dC5zb3VyY2UuY29udGFpbmVyfSlgLFxuICAgICAgYGN3ZD0ke2NvbnRleHQud29ya2luZ0RpcmVjdG9yeX0gKCR7Y29udGV4dC5zb3VyY2Uud29ya2luZ0RpcmVjdG9yeX0pYCxcbiAgICAgIGB0aW1lb3V0PSR7Y29udGV4dC50aW1lb3V0TXN9bXMgKCR7Y29udGV4dC5zb3VyY2UudGltZW91dH0pYCxcbiAgICBdO1xuICAgIHJldHVybiBgRXhlY3V0aW9uIGNvbnRleHQ6ICR7cGllY2VzLmpvaW4oXCIsIFwiKX0uYDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGZpbGU6IFRGaWxlKTogeyBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjsgbGFuZ3VhZ2U6IHN0cmluZzsgZXhlY3V0YWJsZTogc3RyaW5nOyBhcmdzOiBzdHJpbmdbXTsgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nOyB0aW1lb3V0TXM6IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsYW5ndWFnZUlkID0gYmxvY2subGFuZ3VhZ2U7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmd1YWdlSWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBjYW5kaWRhdGUubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBjYW5kaWRhdGUuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIjtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gbW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gbGFuZ3VhZ2UudHJhbnNwaWxlRXhlY3V0YWJsZT8udHJpbSgpIDogbGFuZ3VhZ2UuZXh0cmFjdG9yRXhlY3V0YWJsZT8udHJpbSgpO1xuICAgIGNvbnN0IGFyZ3MgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVBcmdzIHx8IFwie3JlcXVlc3R9XCIgOiBsYW5ndWFnZS5leHRyYWN0b3JBcmdzIHx8IFwie3JlcXVlc3R9XCI7XG4gICAgaWYgKCFleGVjdXRhYmxlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIHJldHVybiB7XG4gICAgICBtb2RlLFxuICAgICAgbGFuZ3VhZ2U6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShhcmdzKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGV4ZWN1dGlvbkNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrLmlkKTtcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGhpcy5yZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2suaWQsIHJlc3VsdCk7XG4gICAgICBjb25zdCBleGlzdGluZ1JhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9jay5pZCk7XG5cbiAgICAgIGlmIChleGlzdGluZ1JhbmdlKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShleGlzdGluZ1JhbmdlLnN0YXJ0LCBleGlzdGluZ1JhbmdlLmVuZCAtIGV4aXN0aW5nUmFuZ2Uuc3RhcnQgKyAxLCAuLi5yZW5kZXJlZCk7XG4gICAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgbGluZXMuc3BsaWNlKGN1cnJlbnRCbG9jay5lbmRMaW5lICsgMSwgMCwgLi4ucmVuZGVyZWQpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbW92ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlUGF0aDogc3RyaW5nLCBibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCByYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuICAgICAgbGluZXMuc3BsaWNlKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQgLSByYW5nZS5zdGFydCArIDEpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9ja0lkOiBzdHJpbmcsIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBib2R5ID0gW1xuICAgICAgYHJ1bm5lcj0ke3Jlc3VsdC5ydW5uZXJOYW1lfWAsXG4gICAgICBgZXhpdD0ke3Jlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gLFxuICAgICAgYGR1cmF0aW9uPSR7cmVzdWx0LmR1cmF0aW9uTXN9bXNgLFxuICAgICAgYHRpbWVzdGFtcD0ke3Jlc3VsdC5maW5pc2hlZEF0fWAsXG4gICAgICByZXN1bHQuc3Rkb3V0ID8gYHN0ZG91dDpcXG4ke3Jlc3VsdC5zdGRvdXR9YCA6IFwiXCIsXG4gICAgICByZXN1bHQud2FybmluZyA/IGB3YXJuaW5nOlxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IFwiXCIsXG4gICAgICByZXN1bHQuc3RkZXJyID8gYHN0ZGVycjpcXG4ke3Jlc3VsdC5zdGRlcnJ9YCA6IFwiXCIsXG4gICAgXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICByZXR1cm4gW1xuICAgICAgYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gLFxuICAgICAgXCJgYGB0ZXh0XCIsXG4gICAgICBib2R5LFxuICAgICAgXCJgYGBcIixcbiAgICAgIFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lczogc3RyaW5nW10sIGJsb2NrSWQ6IHN0cmluZyk6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICAgIGNvbnN0IHN0YXJ0TWFya2VyID0gYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGlmIChsaW5lc1tpXS50cmltKCkgIT09IHN0YXJ0TWFya2VyKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgICBpZiAobGluZXNbal0udHJpbSgpID09PSBcIjwhLS0gbG9vbTpvdXRwdXQ6ZW5kIC0tPlwiKSB7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGksIGVuZDogaiB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgTm90aWNlLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBvcGVuU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCByZWFkZGlyLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiwgbm9ybWFsaXplIGFzIG5vcm1hbGl6ZUZzUGF0aCwgcG9zaXggYXMgcG9zaXhQYXRoIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG50eXBlIGxvb21Db250YWluZXJSdW50aW1lID0gXCJkb2NrZXJcIiB8IFwicG9kbWFuXCIgfCBcInFlbXVcIiB8IFwid3NsXCIgfCBcImN1c3RvbVwiO1xuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHtcbiAgY29tbWFuZD86IHN0cmluZztcbiAgZXh0ZW5zaW9uPzogc3RyaW5nO1xuICB1c2VEZWZhdWx0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Db21tYW5kRXhwZWN0YXRpb24ge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIHBvc2l0aXZlUmVzcG9uc2U/OiBzdHJpbmc7XG4gIG5lZ2F0aXZlUmVzcG9uc2U/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdUNvbmZpZyB7XG4gIHNzaFRhcmdldDogc3RyaW5nO1xuICByZW1vdGVXb3Jrc3BhY2U6IHN0cmluZztcbiAgc3NoRXhlY3V0YWJsZT86IHN0cmluZztcbiAgc3NoQXJncz86IHN0cmluZztcbiAgc3RhcnRDb21tYW5kPzogc3RyaW5nO1xuICBidWlsZENvbW1hbmQ/OiBzdHJpbmc7XG4gIHRlYXJkb3duQ29tbWFuZD86IHN0cmluZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBtYW5hZ2VyPzogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGltYWdlRm9ybWF0Pzogc3RyaW5nO1xuICBwaWRGaWxlPzogc3RyaW5nO1xuICBsb2dGaWxlPzogc3RyaW5nO1xuICByZWFkaW5lc3NUaW1lb3V0TXM/OiBudW1iZXI7XG4gIHJlYWRpbmVzc0ludGVydmFsTXM/OiBudW1iZXI7XG4gIGJvb3REZWxheU1zPzogbnVtYmVyO1xuICBzaHV0ZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIHNodXRkb3duVGltZW91dE1zPzogbnVtYmVyO1xuICBraWxsU2lnbmFsPzogTm9kZUpTLlNpZ25hbHM7XG4gIHBlcnNpc3Q/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmc7XG4gIGJ1aWxkPzogc3RyaW5nO1xuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xuICB0ZWFyZG93bj86IHN0cmluZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xufVxuXG5pbnRlcmZhY2UgbG9vbVdzbENvbmZpZyB7XG4gIGludGVyYWN0aXZlPzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJDb25maWcge1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIHdzbD86IGxvb21Xc2xDb25maWc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgcWVtdT86IGxvb21RZW11Q29uZmlnO1xuICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+O1xufVxuXG5pbnRlcmZhY2UgbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgYWN0aW9uOiBcImJ1aWxkXCIgfCBcInJ1blwiIHwgXCJ0ZWFyZG93blwiO1xuICBncm91cE5hbWU6IHN0cmluZztcbiAgZ3JvdXBQYXRoOiBzdHJpbmc7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBpbWFnZT86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBsYW5ndWFnZT86IHN0cmluZztcbiAgbGFuZ3VhZ2VBbGlhcz86IHN0cmluZztcbiAgZmlsZU5hbWU/OiBzdHJpbmc7XG4gIGZpbGVQYXRoPzogc3RyaW5nO1xuICBjb21tYW5kPzogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgY29uZmlnOiB7XG4gICAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gICAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkgeyB9XG5cbiAgZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGU6IFRGaWxlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgdmFsdWUgPSBmcm9udG1hdHRlcj8uW1wibG9vbS1jb250YWluZXJcIl07XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiBudWxsO1xuICB9XG5cbiAgYXN5bmMgZ2V0R3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICBjb25zdCBjb250YWluZXJzUGF0aCA9IHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoY29udGFpbmVyc1BhdGgpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIoY29udGFpbmVyc1BhdGgsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICBlbnRyaWVzXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGdyb3VwUGF0aCA9IGpvaW4oY29udGFpbmVyc1BhdGgsIGVudHJ5Lm5hbWUpO1xuICAgICAgICAgIGNvbnN0IGhhc0NvbmZpZyA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIikpO1xuICAgICAgICAgIGNvbnN0IGhhc0RvY2tlcmZpbGUgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpO1xuICAgICAgICAgIGlmICghaGFzQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwibWlzc2luZyBjb25maWcuanNvblwiLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgICAgICAgICAgY29uc3QgcGllY2VzID0gW2BydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWBdO1xuICAgICAgICAgICAgaWYgKChjb25maWcucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIikgJiYgaGFzRG9ja2VyZmlsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChcIkRvY2tlcmZpbGVcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5zc2hUYXJnZXQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHNzaDogJHtjb25maWcucWVtdS5zc2hUYXJnZXR9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5tYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBtYW5hZ2VyOiAke2F3YWl0IHRoaXMuZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoLCBjb25maWcucWVtdS5tYW5hZ2VyKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiBjb25maWcuY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGB3cmFwcGVyOiAke2NvbmZpZy5jdXN0b20uZXhlY3V0YWJsZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGxhbmd1YWdlQ291bnQgPSBPYmplY3Qua2V5cyhjb25maWcubGFuZ3VhZ2VzKS5sZW5ndGg7XG4gICAgICAgICAgICBwaWVjZXMucHVzaChgJHtsYW5ndWFnZUNvdW50fSBsYW5ndWFnZSR7bGFuZ3VhZ2VDb3VudCA9PT0gMSA/IFwiXCIgOiBcInNcIn1gKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogcGllY2VzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogYGludmFsaWQgY29uZmlnLmpzb246ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsIGdyb3VwTmFtZTogc3RyaW5nKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29uZmlnTGFuZyA9IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VdID8/IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VBbGlhc107XG5cbiAgICBsZXQgaXNGYWxsYmFjayA9IGZhbHNlO1xuICAgIGxldCBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCA9IG51bGw7XG5cbiAgICBpZiAoY29uZmlnTGFuZykge1xuICAgICAgaWYgKGNvbmZpZ0xhbmcudXNlRGVmYXVsdCkge1xuICAgICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSBjb25maWdMYW5nO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgaXNGYWxsYmFjayA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSB8fCAhbGFuZ3VhZ2UuY29tbWFuZCB8fCAhbGFuZ3VhZ2UuZXh0ZW5zaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBncm91cCAke2dyb3VwTmFtZX0gaGFzIG5vIGNvbW1hbmQgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgIH1cblxuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgdGVtcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9JHtub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uKX1gO1xuICAgIGNvbnN0IHRlbXBGaWxlUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCB0ZW1wRmlsZU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZVBhdGgsIGJsb2NrLmNvbnRlbnQsIFwidXRmOFwiKTtcbiAgICAgIGxldCByZXN1bHQ6IGxvb21SdW5SZXN1bHQ7XG4gICAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuT2NpQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1blFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBibG9jaywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgdGVtcEZpbGVQYXRoLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuV3NsQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcnVudGltZTogJHtjb25maWcucnVudGltZX1gKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGlzRmFsbGJhY2spIHtcbiAgICAgICAgY29uc3QgZmFsbGJhY2tNc2cgPSBgW0xvb21dIExhbmd1YWdlICcke2Jsb2NrLmxhbmd1YWdlfScgd2FzIG5vdCBkZWNsYXJlZCBpbiBjb250YWluZXIgZ3JvdXAuIFJ1bm5pbmcgdXNpbmcgZGVmYXVsdCBjb21tYW5kOiAke2xhbmd1YWdlLmNvbW1hbmR9YDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3Jlc3VsdC53YXJuaW5nfVxcbiR7ZmFsbGJhY2tNc2d9YCA6IGZhbGxiYWNrTXNnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwiYnVpbGRcIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zKSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsOmJ1aWxkYCxcbiAgICAgICAgICBgV1NMICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgICAgYFdTTCBlbnZpcm9ubWVudCAke2NvbmZpZy5pbWFnZSB8fCBcIihkZWZhdWx0KVwifSBkb2VzIG5vdCByZXF1aXJlIGEgYnVpbGQgc3RlcC5cXG5gLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT2NpQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XG4gICAgaWYgKCFjb21tYW5kLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1xuICAgICAgICBcInJ1blwiLFxuICAgICAgICBcIi0tcm1cIixcbiAgICAgICAgXCItdlwiLFxuICAgICAgICBgJHtncm91cFBhdGh9Oi93b3Jrc3BhY2VgLFxuICAgICAgICBcIi13XCIsXG4gICAgICAgIFwiL3dvcmtzcGFjZVwiLFxuICAgICAgICBpbWFnZSxcbiAgICAgICAgLi4uY29tbWFuZCxcbiAgICAgIF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUWVtdShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChxZW11LnN0YXJ0Q29tbWFuZCwgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6c3RhcnRgLCBgUUVNVSAke2dyb3VwTmFtZX0gc3RhcnRgKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZU1hbmFnZWRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6aGVhbHRoYCwgYFFFTVUgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlbW90ZUZpbGUgPSBwb3NpeFBhdGguam9pbihxZW11LnJlbW90ZVdvcmtzcGFjZSwgdGVtcEZpbGVOYW1lKTtcbiAgICAgIGNvbnN0IHJlbW90ZUNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHNoZWxsUXVvdGUocmVtb3RlRmlsZSkpO1xuICAgICAgaWYgKCFyZW1vdGVDb21tYW5kLnRyaW0oKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11YCxcbiAgICAgICAgcnVubmVyTmFtZTogYFFFTVUgJHtncm91cE5hbWV9YCxcbiAgICAgICAgZXhlY3V0YWJsZTogcWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwic3NoXCIsXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICAuLi5zcGxpdENvbW1hbmRMaW5lKHFlbXUuc3NoQXJncyB8fCBcIlwiKSxcbiAgICAgICAgICBxZW11LnNzaFRhcmdldCxcbiAgICAgICAgICBgY2QgJHtzaGVsbFF1b3RlKHFlbXUucmVtb3RlV29ya3NwYWNlKX0gJiYgJHtyZW1vdGVDb21tYW5kfWAsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChxZW11LnRlYXJkb3duQ29tbWFuZCwgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6dGVhcmRvd25gLCBgUUVNVSAke2dyb3VwTmFtZX0gdGVhcmRvd25gKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b20oXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgdGVtcEZpbGVQYXRoOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgY29uZmlnLFxuICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwicnVuXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgY29tbWFuZCxcbiAgICAgIH0pLFxuICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICApO1xuXG4gICAgaWYgKGNvbmZpZy5jdXN0b20/LnRlYXJkb3duKSB7XG4gICAgICBjb25zdCB0ZWFyZG93biA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgICAgZ3JvdXBOYW1lLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwidGVhcmRvd25cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgICAgY29tbWFuZCxcbiAgICAgICAgfSksXG4gICAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICAgICk7XG4gICAgICBpZiAoIXRlYXJkb3duLnN1Y2Nlc3MpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgQ3VzdG9tIHJ1bnRpbWUgdGVhcmRvd24gZmFpbGVkOiAke3RlYXJkb3duLnN0ZGVyciB8fCB0ZWFyZG93bi5zdGRvdXQgfHwgYGV4aXQgJHt0ZWFyZG93bi5leGl0Q29kZX1gfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuV3NsQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCB3c2xHcm91cFBhdGggPSB0aGlzLnRyYW5zbGF0ZVRvV3NsUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSk7XG4gICAgaWYgKCFjb21tYW5kLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV1NMIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHNoZWxsRmxhZ3MgPSBjb25maWcud3NsPy5pbnRlcmFjdGl2ZSA/IFtcIi1pXCIsIFwiLWxcIiwgXCItY1wiXSA6IFtcIi1sXCIsIFwiLWNcIl07XG4gICAgY29uc3Qgd3NsQXJncyA9IFtcImJhc2hcIiwgLi4uc2hlbGxGbGFncywgYGNkIFwiJHt3c2xHcm91cFBhdGgucmVwbGFjZUFsbCgnXCInLCAnXFxcXFwiJyl9XCIgJiYgJHtjb21tYW5kfWBdO1xuICAgIGlmIChjb25maWcuaW1hZ2U/LnRyaW0oKSkge1xuICAgICAgd3NsQXJncy51bnNoaWZ0KFwiLWRcIiwgY29uZmlnLmltYWdlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OndzbGAsXG4gICAgICBydW5uZXJOYW1lOiBgV1NMICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiBcIndzbFwiLFxuICAgICAgYXJnczogd3NsQXJncyxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB0cmFuc2xhdGVUb1dzbFBhdGgod2luZG93c1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbWF0Y2ggPSB3aW5kb3dzUGF0aC5tYXRjaCgvXihbQS1aYS16XSk6XFxcXCguKikvKTtcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IGRyaXZlID0gbWF0Y2hbMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IHJlc3QgPSBtYXRjaFsyXS5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICAgIHJldHVybiBgL21udC8ke2RyaXZlfS8ke3Jlc3R9YDtcbiAgICB9XG4gICAgaWYgKHdpbmRvd3NQYXRoLmluY2x1ZGVzKFwiXFxcXFwiKSkge1xuICAgICAgcmV0dXJuIHdpbmRvd3NQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIH1cbiAgICByZXR1cm4gd2luZG93c1BhdGg7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBkb2NrZXJmaWxlID0gam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoZG9ja2VyZmlsZSkpIHtcbiAgICAgIHJldHVybiBjb25maWcuaW1hZ2UgfHwgXCJ1YnVudHU6bGF0ZXN0XCI7XG4gICAgfVxuXG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY2FjaGVLZXkgPSBgJHt0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyl9OiR7aW1hZ2V9YDtcbiAgICBpZiAodGhpcy5idWlsdEltYWdlcy5oYXMoY2FjaGVLZXkpKSB7XG4gICAgICByZXR1cm4gaW1hZ2U7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udGV4dC5zaWduYWwpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gYnVpbGQgZmFpbGVkIGZvciAke2dyb3VwTmFtZX0uYCk7XG4gICAgfVxuXG4gICAgdGhpcy5idWlsdEltYWdlcy5hZGQoY2FjaGVLZXkpO1xuICAgIHJldHVybiBpbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgICAgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgYE5vIERvY2tlcmZpbGUgY29uZmlndXJlZC4gVXNpbmcgaW1hZ2UgJHtjb25maWcuaW1hZ2UgfHwgXCJ1YnVudHU6bGF0ZXN0XCJ9LlxcbmAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcbiAgICAgIGFyZ3M6IFtcImJ1aWxkXCIsIFwiLXRcIiwgaW1hZ2UsIGdyb3VwUGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBzaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGlmICghcWVtdS5idWlsZENvbW1hbmQ/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6YnVpbGRgLCBgUUVNVSAke2dyb3VwTmFtZX0gYnVpbGRgLCBcIk5vIFFFTVUgYnVpbGQgY29tbWFuZCBjb25maWd1cmVkLlxcblwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucnVuQ29tbWFuZExpbmUocWVtdS5idWlsZENvbW1hbmQsIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6YnVpbGRgLCBgUUVNVSAke2dyb3VwTmFtZX0gYnVpbGRgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZENvbmZpZyhncm91cFBhdGg6IHN0cmluZyk6IFByb21pc2U8bG9vbUNvbnRhaW5lckNvbmZpZz4ge1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKTtcbiAgICBsZXQgcmF3OiB1bmtub3duO1xuICAgIHRyeSB7XG4gICAgICByYXcgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGNvbmZpZ1BhdGgsIFwidXRmOFwiKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIHJlYWQgY29udGFpbmVyIGNvbmZpZyAke2NvbmZpZ1BhdGh9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IHJhdyBhcyB7XG4gICAgICBydW50aW1lPzogdW5rbm93bjtcbiAgICAgIGV4ZWN1dGFibGU/OiB1bmtub3duO1xuICAgICAgaW1hZ2U/OiB1bmtub3duO1xuICAgICAgd3NsPzogdW5rbm93bjtcbiAgICAgIGhlYWx0aENoZWNrPzogdW5rbm93bjtcbiAgICAgIHFlbXU/OiB1bmtub3duO1xuICAgICAgY3VzdG9tPzogdW5rbm93bjtcbiAgICAgIGxhbmd1YWdlcz86IHVua25vd247XG4gICAgfTtcbiAgICBjb25zdCBydW50aW1lID0gdGhpcy5yZWFkUnVudGltZShkYXRhLnJ1bnRpbWUpO1xuICAgIGlmIChkYXRhLmV4ZWN1dGFibGUgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmIChkYXRhLmltYWdlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuaW1hZ2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgaW1hZ2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICghZGF0YS5sYW5ndWFnZXMgfHwgdHlwZW9mIGRhdGEubGFuZ3VhZ2VzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGF0YS5sYW5ndWFnZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGxhbmd1YWdlcyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+ID0ge307XG4gICAgZm9yIChjb25zdCBbbGFuZ3VhZ2UsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhkYXRhLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcbiAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgICAgfVxuICAgICAgY29uc3QgbGFuZ3VhZ2VDb25maWcgPSB2YWx1ZSBhcyB7IGNvbW1hbmQ/OiB1bmtub3duOyBleHRlbnNpb24/OiB1bmtub3duOyB1c2VEZWZhdWx0PzogdW5rbm93biB9O1xuICAgICAgY29uc3QgdXNlRGVmYXVsdCA9IGxhbmd1YWdlQ29uZmlnLnVzZURlZmF1bHQgPT09IHRydWU7XG5cbiAgICAgIGlmICghdXNlRGVmYXVsdCAmJiAodHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWxhbmd1YWdlQ29uZmlnLmNvbW1hbmQudHJpbSgpKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGRlZmluZSBjb21tYW5kIG9yIHVzZURlZmF1bHQuYCk7XG4gICAgICB9XG5cbiAgICAgIGxhbmd1YWdlc1tsYW5ndWFnZV0gPSB7XG4gICAgICAgIGNvbW1hbmQ6IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kID09PSBcInN0cmluZ1wiID8gbGFuZ3VhZ2VDb25maWcuY29tbWFuZCA6IHVuZGVmaW5lZCxcbiAgICAgICAgZXh0ZW5zaW9uOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuZXh0ZW5zaW9uID09PSBcInN0cmluZ1wiID8gbGFuZ3VhZ2VDb25maWcuZXh0ZW5zaW9uIDogdXNlRGVmYXVsdCA/IHVuZGVmaW5lZCA6IGAuJHtsYW5ndWFnZX1gLFxuICAgICAgICB1c2VEZWZhdWx0OiB1c2VEZWZhdWx0IHx8IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bnRpbWUsXG4gICAgICBleGVjdXRhYmxlOiB0eXBlb2YgZGF0YS5leGVjdXRhYmxlID09PSBcInN0cmluZ1wiICYmIGRhdGEuZXhlY3V0YWJsZS50cmltKCkgPyBkYXRhLmV4ZWN1dGFibGUudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgaW1hZ2U6IHR5cGVvZiBkYXRhLmltYWdlID09PSBcInN0cmluZ1wiID8gZGF0YS5pbWFnZSA6IHVuZGVmaW5lZCxcbiAgICAgIHdzbDogdGhpcy5yZWFkV3NsQ29uZmlnKGRhdGEud3NsKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgaGVhbHRoQ2hlY2tcIiksXG4gICAgICBxZW11OiB0aGlzLnJlYWRRZW11Q29uZmlnKGRhdGEucWVtdSksXG4gICAgICBjdXN0b206IHRoaXMucmVhZEN1c3RvbUNvbmZpZyhkYXRhLmN1c3RvbSksXG4gICAgICBsYW5ndWFnZXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFJ1bnRpbWUodmFsdWU6IHVua25vd24pOiBsb29tQ29udGFpbmVyUnVudGltZSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiBcImRvY2tlclwiO1xuICAgIH1cbiAgICBpZiAodmFsdWUgPT09IFwiZG9ja2VyXCIgfHwgdmFsdWUgPT09IFwicG9kbWFuXCIgfHwgdmFsdWUgPT09IFwicWVtdVwiIHx8IHZhbHVlID09PSBcImN1c3RvbVwiIHx8IHZhbHVlID09PSBcIndzbFwiKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcnVudGltZSBtdXN0IGJlIGRvY2tlciwgcG9kbWFuLCBxZW11LCBjdXN0b20sIG9yIHdzbC5cIik7XG4gIH1cblxuICBwcml2YXRlIHJlYWRXc2xDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tV3NsQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgd3NsIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIHsgaW50ZXJhY3RpdmU/OiB1bmtub3duIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIGludGVyYWN0aXZlOiBkYXRhLmludGVyYWN0aXZlID09PSB0cnVlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRRZW11Q29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11IG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5zc2hUYXJnZXQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuc3NoVGFyZ2V0LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnNzaFRhcmdldCBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBkYXRhLnJlbW90ZVdvcmtzcGFjZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5yZW1vdGVXb3Jrc3BhY2UudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUucmVtb3RlV29ya3NwYWNlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzc2hUYXJnZXQ6IGRhdGEuc3NoVGFyZ2V0LnRyaW0oKSxcbiAgICAgIHJlbW90ZVdvcmtzcGFjZTogZGF0YS5yZW1vdGVXb3Jrc3BhY2UudHJpbSgpLFxuICAgICAgc3NoRXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hFeGVjdXRhYmxlKSxcbiAgICAgIHNzaEFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3NoQXJncyksXG4gICAgICBzdGFydENvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3RhcnRDb21tYW5kKSxcbiAgICAgIGJ1aWxkQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZENvbW1hbmQpLFxuICAgICAgdGVhcmRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duQ29tbWFuZCksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIHFlbXUuaGVhbHRoQ2hlY2tcIiksXG4gICAgICBtYW5hZ2VyOiB0aGlzLnJlYWRRZW11TWFuYWdlckNvbmZpZyhkYXRhLm1hbmFnZXIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRRZW11TWFuYWdlckNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21RZW11TWFuYWdlckNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlciBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogZGF0YS5lbmFibGVkICE9PSBmYWxzZSxcbiAgICAgIGV4ZWN1dGFibGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuZXhlY3V0YWJsZSksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgaW1hZ2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEuaW1hZ2UpLFxuICAgICAgaW1hZ2VGb3JtYXQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuaW1hZ2VGb3JtYXQpLFxuICAgICAgcGlkRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5waWRGaWxlKSxcbiAgICAgIGxvZ0ZpbGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEubG9nRmlsZSksXG4gICAgICByZWFkaW5lc3NUaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEucmVhZGluZXNzVGltZW91dE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc1RpbWVvdXRNc1wiKSxcbiAgICAgIHJlYWRpbmVzc0ludGVydmFsTXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEucmVhZGluZXNzSW50ZXJ2YWxNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zXCIpLFxuICAgICAgYm9vdERlbGF5TXM6IG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKGRhdGEuYm9vdERlbGF5TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuYm9vdERlbGF5TXNcIiksXG4gICAgICBzaHV0ZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc2h1dGRvd25Db21tYW5kKSxcbiAgICAgIHNodXRkb3duVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnNodXRkb3duVGltZW91dE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnNodXRkb3duVGltZW91dE1zXCIpLFxuICAgICAga2lsbFNpZ25hbDogb3B0aW9uYWxTaWduYWwoZGF0YS5raWxsU2lnbmFsLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLmtpbGxTaWduYWxcIiksXG4gICAgICBwZXJzaXN0OiB0eXBlb2YgZGF0YS5wZXJzaXN0ID09PSBcImJvb2xlYW5cIiA/IGRhdGEucGVyc2lzdCA6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkQ3VzdG9tQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20gbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuZXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBleGVjdXRhYmxlOiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGJ1aWxkOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkKSxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuY29tbWFuZFN0cnVjdHVyZSksXG4gICAgICB0ZWFyZG93bjogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93biksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5oZWFsdGhDaGVja1wiKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkSGVhbHRoQ2hlY2sodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5jb21tYW5kLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfS5jb21tYW5kIG11c3QgYmUgYSBzdHJpbmcuYCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBjb21tYW5kOiBkYXRhLmNvbW1hbmQudHJpbSgpLFxuICAgICAgcG9zaXRpdmVSZXNwb25zZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5wb3NpdGl2ZVJlc3BvbnNlID8/IGRhdGEucG9zaXRpdmVfcmVzcG9uc2UgPz8gZGF0YVtcInBvc2l0aXZlIHJlc3BvbnNlXCJdID8/IGRhdGEucG9zc2l0aXZlUmVzcG9uc2UpLFxuICAgICAgbmVnYXRpdmVSZXNwb25zZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5uZWdhdGl2ZVJlc3BvbnNlID8/IGRhdGEubmVnYXRpdmVfcmVzcG9uc2UgPz8gZGF0YVtcIm5lZ2F0aXZlIHJlc3BvbnNlXCJdKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZXF1aXJlUWVtdUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tUWVtdUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcucWVtdSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIGEgcWVtdSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5xZW11O1xuICB9XG5cbiAgcHJpdmF0ZSByZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5jdXN0b20pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIGEgY3VzdG9tIGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLmN1c3RvbTtcbiAgfVxuXG4gIHByaXZhdGUgcnVudGltZUV4ZWN1dGFibGUoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogc3RyaW5nIHtcbiAgICBpZiAoY29uZmlnLmV4ZWN1dGFibGU/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5leGVjdXRhYmxlLnRyaW0oKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiID8gXCJwb2RtYW5cIiA6IFwiZG9ja2VyXCI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkhlYWx0aENoZWNrKFxuICAgIGhlYWx0aENoZWNrOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWhlYWx0aENoZWNrKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShoZWFsdGhDaGVjay5jb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGNvbnN0IGNvbWJpbmVkT3V0cHV0ID0gYCR7cmVzdWx0LnN0ZG91dH1cXG4ke3Jlc3VsdC5zdGRlcnJ9YDtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSAmJiBjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IHJldHVybmVkIG5lZ2F0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlICYmICFjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGRpZCBub3QgcmV0dXJuIHBvc2l0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PcHRpb25hbENvbW1hbmQoXG4gICAgY29tbWFuZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbW1hbmQ/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkNvbW1hbmRMaW5lKFxuICAgIGNvbW1hbmQ6IHN0cmluZyxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcGFydHMgPSBzcGxpdENvbW1hbmRMaW5lKGNvbW1hbmQpO1xuICAgIGlmICghcGFydHMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gY29tbWFuZCBpcyBlbXB0eS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogcGFydHNbMF0sXG4gICAgICBhcmdzOiBwYXJ0cy5zbGljZSgxKSxcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBzaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZU1hbmFnZWRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgcWVtdTogbG9vbVFlbXVDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IGV4aXN0aW5nUGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoZXhpc3RpbmdQaWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKGV4aXN0aW5nUGlkKSkge1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdQaWQpIHtcbiAgICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IG1hbmFnZXIuZXhlY3V0YWJsZSB8fCBcInFlbXUtc3lzdGVtLXg4Nl82NFwiO1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aCwgbWFuYWdlcik7XG4gICAgaWYgKCFhcmdzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBuZWVkcyBxZW11Lm1hbmFnZXIuYXJncyBvciBxZW11Lm1hbmFnZXIuaW1hZ2UuYCk7XG4gICAgfVxuXG4gICAgY29uc3QgbG9nUGF0aCA9IG1hbmFnZXIubG9nRmlsZSA/IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmxvZ0ZpbGUpIDogbnVsbDtcbiAgICBjb25zdCBsb2dGZCA9IGxvZ1BhdGggPyBvcGVuU3luYyhsb2dQYXRoLCBcImFcIikgOiBudWxsO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4ZWN1dGFibGUsIGFyZ3MsIHtcbiAgICAgICAgY3dkOiBncm91cFBhdGgsXG4gICAgICAgIGRldGFjaGVkOiB0cnVlLFxuICAgICAgICBzdGRpbzogW1wiaWdub3JlXCIsIGxvZ0ZkID8/IFwiaWdub3JlXCIsIGxvZ0ZkID8/IFwiaWdub3JlXCJdLFxuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKCkgPT4gdW5kZWZpbmVkKTtcbiAgICAgIGNoaWxkLnVucmVmKCk7XG5cbiAgICAgIGlmICghY2hpbGQucGlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gZGlkIG5vdCByZXR1cm4gYSBwcm9jZXNzIGlkLmApO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB3cml0ZUZpbGUocGlkUGF0aCwgYCR7Y2hpbGQucGlkfVxcbmAsIFwidXRmOFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChsb2dGZCAhPSBudWxsKSB7XG4gICAgICAgIGNsb3NlU3luYyhsb2dGZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBidWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGg6IHN0cmluZywgbWFuYWdlcjogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKG1hbmFnZXIuYXJncyB8fCBcIlwiKTtcbiAgICBpZiAobWFuYWdlci5pbWFnZSkge1xuICAgICAgY29uc3QgaW1hZ2VQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIuaW1hZ2UpO1xuICAgICAgYXJncy5wdXNoKFwiLWRyaXZlXCIsIGBmaWxlPSR7aW1hZ2VQYXRofSxpZj12aXJ0aW8sZm9ybWF0PSR7bWFuYWdlci5pbWFnZUZvcm1hdCB8fCBcInFjb3cyXCJ9YCk7XG4gICAgfVxuICAgIHJldHVybiBhcmdzO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgcWVtdTogbG9vbVFlbXVDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXFlbXUuaGVhbHRoQ2hlY2spIHtcbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChtYW5hZ2VyLmJvb3REZWxheU1zID8/IDAsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZW91dCA9IE1hdGgubWluKG1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zID8/IDYwXzAwMCwgTWF0aC5tYXgodGltZW91dE1zLCAxKSk7XG4gICAgY29uc3QgaW50ZXJ2YWwgPSBtYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXMgPz8gMV8wMDA7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICBsZXQgbGFzdEVycm9yID0gXCJcIjtcblxuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXQpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgJHtncm91cE5hbWV9IHJlYWRpbmVzcyB3YWl0IGNhbmNlbGxlZC5gKTtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIE1hdGgubWluKGludGVydmFsLCB0aW1lb3V0KSwgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnJlYWR5YCwgYFFFTVUgJHtncm91cE5hbWV9IHJlYWRpbmVzcyBjaGVja2ApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChpbnRlcnZhbCwgc2lnbmFsKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgJHtncm91cE5hbWV9IGRpZCBub3QgYmVjb21lIHJlYWR5IHdpdGhpbiAke3RpbWVvdXR9IG1zJHtsYXN0RXJyb3IgPyBgOiAke2xhc3RFcnJvcn1gIDogXCIuXCJ9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgcWVtdTogbG9vbVFlbXVDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQgfHwgbWFuYWdlci5wZXJzaXN0ICE9PSBmYWxzZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQoXG4gICAgICAgIG1hbmFnZXIuc2h1dGRvd25Db21tYW5kLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIE1hdGgubWluKG1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXMgPz8gdGltZW91dE1zLCB0aW1lb3V0TXMpLFxuICAgICAgICBzaWduYWwsXG4gICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6c2h1dGRvd25gLFxuICAgICAgICBgUUVNVSAke2dyb3VwTmFtZX0gc2h1dGRvd25gLFxuICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBtYW5hZ2VyLmtpbGxTaWduYWwgfHwgXCJTSUdURVJNXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHN0b3BwZWQgPSBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIG1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXMgPz8gMTBfMDAwLCBzaWduYWwpO1xuICAgIGlmICghc3RvcHBlZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgXCJTSUdLSUxMXCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCAyXzAwMCwgc2lnbmFsKTtcbiAgICB9XG5cbiAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGg6IHN0cmluZywgbWFuYWdlcjogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybiBcInN0b3BwZWRcIjtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpID8gYHJ1bm5pbmcgcGlkICR7cGlkfWAgOiBgc3RhbGUgcGlkICR7cGlkfWA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRQaWRGaWxlKHBpZFBhdGg6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IChhd2FpdCByZWFkRmlsZShwaWRQYXRoLCBcInV0ZjhcIikpLnRyaW0oKTtcbiAgICAgIGNvbnN0IHBpZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGlkKSAmJiBwaWQgPiAwID8gcGlkIDogbnVsbDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNQcm9jZXNzUnVubmluZyhwaWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHRyeSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCAwKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvclByb2Nlc3NFeGl0KHBpZDogbnVtYmVyLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dE1zKSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKCF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbCgyNTAsIHNpZ25hbCk7XG4gICAgfVxuICAgIHJldHVybiAhdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHJlcXVlc3Q6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjdXN0b20gPSB0aGlzLnJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGN1c3RvbS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOmhlYWx0aGAsIGBDdXN0b20gJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgY29uc3QgcmVxdWVzdEZpbGVOYW1lID0gYHJlcXVlc3RfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfS5qc29uYDtcbiAgICBjb25zdCByZXF1ZXN0UGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCByZXF1ZXN0RmlsZU5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdFBhdGgsIGAke0pTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpfVxcbmAsIFwidXRmOFwiKTtcbiAgICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKGN1c3RvbS5hcmdzIHx8IFwie3JlcXVlc3R9XCIpLm1hcCgoYXJnKSA9PlxuICAgICAgICBhcmdcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCByZXF1ZXN0UGF0aClcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cH1cIiwgZ3JvdXBOYW1lKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwUGF0aH1cIiwgZ3JvdXBQYXRoKSxcbiAgICAgICk7XG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206JHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBydW5uZXJOYW1lOiBgQ3VzdG9tICR7Z3JvdXBOYW1lfSAke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IGN1c3RvbS5leGVjdXRhYmxlLFxuICAgICAgICBhcmdzLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHJtKHJlcXVlc3RQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQ3VzdG9tUmVxdWVzdChcbiAgICBhY3Rpb246IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdFtcImFjdGlvblwiXSxcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgZXh0cmE6IFBhcnRpYWw8bG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0PiA9IHt9LFxuICApOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb24sXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBydW50aW1lOiBjb25maWcucnVudGltZSxcbiAgICAgIGltYWdlOiBjb25maWcuaW1hZ2UsXG4gICAgICBidWlsZDogY29uZmlnLmN1c3RvbT8uYnVpbGQsXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBjb25maWcuY3VzdG9tPy5jb21tYW5kU3RydWN0dXJlLFxuICAgICAgdGVhcmRvd246IGNvbmZpZy5jdXN0b20/LnRlYXJkb3duLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgY29uZmlnOiB7XG4gICAgICAgIGV4ZWN1dGFibGU6IGNvbmZpZy5leGVjdXRhYmxlLFxuICAgICAgICBjdXN0b206IGNvbmZpZy5jdXN0b20sXG4gICAgICAgIHFlbXU6IGNvbmZpZy5xZW11LFxuICAgICAgICBoZWFsdGhDaGVjazogY29uZmlnLmhlYWx0aENoZWNrLFxuICAgICAgfSxcbiAgICAgIC4uLmV4dHJhLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChydW5uZXJJZDogc3RyaW5nLCBydW5uZXJOYW1lOiBzdHJpbmcsIHN0ZG91dDogc3RyaW5nLCBzdWNjZXNzID0gdHJ1ZSk6IGxvb21SdW5SZXN1bHQge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICByZXR1cm4ge1xuICAgICAgcnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgc3RhcnRlZEF0OiBub3csXG4gICAgICBmaW5pc2hlZEF0OiBub3csXG4gICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgZXhpdENvZGU6IHN1Y2Nlc3MgPyAwIDogLTEsXG4gICAgICBzdGRvdXQsXG4gICAgICBzdGRlcnI6IFwiXCIsXG4gICAgICBzdWNjZXNzLFxuICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250YWluZXJzUGF0aCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4oYWRhcHRlckJhc2VQYXRoLCB0aGlzLnBsdWdpbkRpciwgXCJjb250YWluZXJzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZU5hbWUgPSBiYXNlbmFtZShncm91cE5hbWUpO1xuICAgIGlmICghc2FmZU5hbWUgfHwgc2FmZU5hbWUgIT09IGdyb3VwTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNvbnRhaW5lciBncm91cCBuYW1lOiAke2dyb3VwTmFtZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKSwgc2FmZU5hbWUpKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVQYXRoID0gbm9ybWFsaXplRnNQYXRoKGpvaW4oZ3JvdXBQYXRoLCBmaWxlUGF0aCkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRHcm91cFBhdGggPSBub3JtYWxpemVGc1BhdGgoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBwb3NpeFNhZmVQYXRoID0gc2FmZVBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgY29uc3QgcG9zaXhHcm91cFBhdGggPSBub3JtYWxpemVkR3JvdXBQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIGlmIChwb3NpeFNhZmVQYXRoICE9PSBwb3NpeEdyb3VwUGF0aCAmJiAhcG9zaXhTYWZlUGF0aC5zdGFydHNXaXRoKGAke3Bvc2l4R3JvdXBQYXRofS9gKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIFFFTVUgbWFuYWdlciBwYXRoIG91dHNpZGUgY29udGFpbmVyIGdyb3VwOiAke2ZpbGVQYXRofWApO1xuICAgIH1cbiAgICByZXR1cm4gc2FmZVBhdGg7XG4gIH1cblxuICBwcml2YXRlIGltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYGxvb20tY29udGFpbmVyLSR7Z3JvdXBOYW1lLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTlfLi1dL2csIFwiLVwiKX1gO1xuICB9XG5cbiAgcHVibGljIGdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nSWQ6IHN0cmluZywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB8IG51bGwge1xuICAgIGlmICghbGFuZ0lkKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbGFuZ0lkLnRvTG93ZXJDYXNlKCkudHJpbSgpO1xuXG4gICAgLy8gQ2hlY2sgY3VzdG9tIGxhbmd1YWdlcyBmaXJzdFxuICAgIGNvbnN0IGN1c3RvbSA9IHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjKSA9PiB7XG4gICAgICBjb25zdCBuYW1lcyA9IFtjLm5hbWUsIC4uLmMuYWxpYXNlcy5zcGxpdChcIixcIikubWFwKChzKSA9PiBzLnRyaW0oKSldLm1hcCgobikgPT4gbi50b0xvd2VyQ2FzZSgpKTtcbiAgICAgIHJldHVybiBuYW1lcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgICBpZiAoY3VzdG9tKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21tYW5kOiBgJHtjdXN0b20uZXhlY3V0YWJsZX0gJHtjdXN0b20uYXJnc31gLnRyaW0oKSxcbiAgICAgICAgZXh0ZW5zaW9uOiBjdXN0b20uZXh0ZW5zaW9uIHx8IFwiLnR4dFwiLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBTdGFuZGFyZCBidWlsdC1pbnNcbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIGNhc2UgXCJweVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwicHl0aG9uM1wifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucHlcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgICBjYXNlIFwianNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJub2RlXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5qc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJ0c1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJ0cy1ub2RlXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInNoZWxsXCI6XG4gICAgICBjYXNlIFwic2hcIjpcbiAgICAgIGNhc2UgXCJiYXNoXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Muc2hlbGxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImJhc2hcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNoXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicnVieVwiOlxuICAgICAgY2FzZSBcInJiXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucnVieUV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVieVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucmJcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJwZXJsXCI6XG4gICAgICBjYXNlIFwicGxcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5wZXJsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJwZXJsXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5wbFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImx1YVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmx1YUV4ZWN1dGFibGUudHJpbSgpIHx8IFwibHVhXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJwaHBcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5waHBFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBocFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucGhwXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiZ29cIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5nb0V4ZWN1dGFibGUudHJpbSgpIHx8IFwiZ29cIn0gcnVuIHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIGNhc2UgXCJoc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmhhc2tlbGxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1bmdoY1wifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuaHNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgY2FzZSBcIm1sXCI6XG4gICAgICAgIGlmIChzZXR0aW5ncy5vY2FtbE1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJkdW5lXCJ9IGV4ZWMgLS0gb2NhbWwge2ZpbGV9YCxcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChzZXR0aW5ncy5vY2FtbE1vZGUgPT09IFwib2NhbWxjXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbGNcIn0gLW8gL3RtcC9sb29tLW9jYW1sIFwiJDFcIiAmJiAvdG1wL2xvb20tb2NhbWxgKSxcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpIHx8IFwiZ2NjXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tYyAmJiAvdG1wL2xvb20tY2ApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuY1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNwcFwiOlxuICAgICAgY2FzZSBcImMrK1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImcrK1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLWNwcCAmJiAvdG1wL2xvb20tY3BwYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jcHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJlYnBmXCI6XG4gICAgICBjYXNlIFwiZWJwZi1jXCI6XG4gICAgICBjYXNlIFwiYnBmXCI6XG4gICAgICBjYXNlIFwiYnBmLWNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuZWJwZkNsYW5nRXhlY3V0YWJsZS50cmltKCkgfHwgXCJjbGFuZ1wifSAtdGFyZ2V0IGJwZiAtTzIgLWcgLVdhbGwgXCIkMVwiIC1jIC1vIC90bXAvbG9vbS1lYnBmLm8gJiYgcHJpbnRmICdjb21waWxlZCAvdG1wL2xvb20tZWJwZi5vXFxcXG4nYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5icGYuY1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImJwZnRyYWNlXCI6XG4gICAgICBjYXNlIFwiYnRcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYnBmdHJhY2VcIn0gLWQge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmJ0XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicnVzdFwiOlxuICAgICAgY2FzZSBcInJzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1c3RjXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tcnVzdCAmJiAvdG1wL2xvb20tcnVzdGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucnNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJqYXZhXCI6IHtcbiAgICAgICAgY29uc3QgY29tcGlsZXIgPSBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFjXCI7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGB0bXA9L3RtcC9sb29tLWphdmEtJCQgJiYgbWtkaXIgLXAgXCIkdG1wXCIgJiYgY3AgXCIkMVwiIFwiJHRtcC9NYWluLmphdmFcIiAmJiAke2NvbXBpbGVyfSBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhXCJ9IC1jcCBcIiR0bXBcIiBNYWluYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5qYXZhXCIsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgY2FzZSBcImxsdm1cIjpcbiAgICAgIGNhc2UgXCJsbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGxpXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImxlYW5cIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsZWFuXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY29xXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCkgfHwgXCJjb3FjXCJ9IC1xIHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic210bGliXCI6XG4gICAgICBjYXNlIFwic210XCI6XG4gICAgICBjYXNlIFwic210LWxpYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiejNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2ggLWxjICR7cXVvdGVDb21tYW5kQXJnKGNvbW1hbmQpfSBzaCB7ZmlsZX1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dEb2NrZXJOb3RpY2UobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UobWVzc2FnZSwgODAwMCk7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFNpZ25hbCh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IE5vZGVKUy5TaWduYWxzIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgIS9eU0lHW0EtWjAtOV0rJC8udGVzdCh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBzaWduYWwgbmFtZSBsaWtlIFNJR1RFUk0uYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIE5vZGVKUy5TaWduYWxzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzbGVlcFdpdGhTaWduYWwoZHVyYXRpb25NczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChkdXJhdGlvbk1zIDw9IDAgfHwgc2lnbmFsLmFib3J0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KHJlc29sdmUsIGR1cmF0aW9uTXMpO1xuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcnVudGltZUxhYmVsKHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lKTogc3RyaW5nIHtcbiAgc3dpdGNoIChydW50aW1lKSB7XG4gICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgcmV0dXJuIFwiRG9ja2VyXCI7XG4gICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgcmV0dXJuIFwiUG9kbWFuXCI7XG4gICAgY2FzZSBcInFlbXVcIjpcbiAgICAgIHJldHVybiBcIlFFTVVcIjtcbiAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICByZXR1cm4gXCJDdXN0b21cIjtcbiAgICBjYXNlIFwid3NsXCI6XG4gICAgICByZXR1cm4gXCJXU0xcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbFF1b3RlKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cblxuZnVuY3Rpb24gcXVvdGVDb21tYW5kQXJnKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cbiIsICJpbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVByb2Nlc3NTcGVjIHtcbiAgcnVubmVySWQ6IHN0cmluZztcbiAgcnVubmVyTmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBzaWduYWw6IEFib3J0U2lnbmFsO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kVGVtcGxhdGVkRW52KGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQsIHRlbXBGaWxlOiBzdHJpbmcsIHRlbXBEaXI6IHN0cmluZyk6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFlbnYpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnYpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBbXG4gICAgICBrZXksXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpIDogdmFsdWUsXG4gICAgXSksXG4gICk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIHNwbGl0Q29tbWFuZExpbmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgbGV0IHF1b3RlOiBcIidcIiB8IFwiXFxcIlwiIHwgbnVsbCA9IG51bGw7XG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3QgY2hhciBvZiBpbnB1dC50cmltKCkpIHtcbiAgICBpZiAoZXNjYXBpbmcpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgICAgIGVzY2FwaW5nID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGVzY2FwaW5nID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgoY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJcXFwiXCIpICYmICFxdW90ZSkge1xuICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IHF1b3RlKSB7XG4gICAgICBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcbiAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQpIHtcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuIiwgImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbm9ybWFsaXplUGF0aCwgdHlwZSBBcHAsIHR5cGUgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29udGFpbmVyR3JvdXA/OiBzdHJpbmc7XG4gIGRpc2FibGVDb250YWluZXI/OiBib29sZWFuO1xuICB3b3JraW5nRGlyZWN0b3J5Pzogc3RyaW5nO1xuICB0aW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRXhlY3V0aW9uQ29udGV4dChcbiAgYXBwOiBBcHAsXG4gIGZpbGU6IFRGaWxlLFxuICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQge1xuICBjb25zdCBub3RlID0gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcCwgZmlsZSk7XG4gIGNvbnN0IGRlZmF1bHRXb3JraW5nRGlyZWN0b3J5ID0gcmVzb2x2ZURlZmF1bHRXb3JraW5nRGlyZWN0b3J5KGZpbGUsIHNldHRpbmdzKTtcbiAgY29uc3Qgbm90ZVdvcmtpbmdEaXJlY3RvcnkgPSBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KG5vdGUud29ya2luZ0RpcmVjdG9yeSk7XG4gIGNvbnN0IGJsb2NrV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3RvcnkoYmxvY2suZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3Qgbm90ZVRpbWVvdXQgPSBub3RlLnRpbWVvdXRNcztcbiAgY29uc3QgYmxvY2tUaW1lb3V0ID0gYmxvY2suZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXM7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogcmVzb2x2ZUNvbnRhaW5lckdyb3VwKHNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCwgbm90ZSwgYmxvY2suZXhlY3V0aW9uQ29udGV4dCksXG4gICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8/IG5vdGVXb3JraW5nRGlyZWN0b3J5ID8/IGRlZmF1bHRXb3JraW5nRGlyZWN0b3J5LFxuICAgIHRpbWVvdXRNczogYmxvY2tUaW1lb3V0ID8/IG5vdGVUaW1lb3V0ID8/IHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgc291cmNlOiB7XG4gICAgICBjb250YWluZXI6IHJlc29sdmVDb250YWluZXJTb3VyY2Uoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGJsb2NrV29ya2luZ0RpcmVjdG9yeSA/IFwiYmxvY2tcIiA6IG5vdGVXb3JraW5nRGlyZWN0b3J5ID8gXCJub3RlXCIgOiBzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSA/IFwiZ2xvYmFsXCIgOiBcImRlZmF1bHRcIixcbiAgICAgIHRpbWVvdXQ6IGJsb2NrVGltZW91dCA/IFwiYmxvY2tcIiA6IG5vdGVUaW1lb3V0ID8gXCJub3RlXCIgOiBcImdsb2JhbFwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb250YWluZXJHcm91cChcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmIChibG9jay5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoYmxvY2suY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBibG9jay5jb250YWluZXJHcm91cC50cmltKCk7XG4gIH1cbiAgaWYgKG5vdGUuZGlzYWJsZUNvbnRhaW5lcikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBub3RlLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb250YWluZXJTb3VyY2UoXG4gIGdsb2JhbENvbnRhaW5lcjogc3RyaW5nLFxuICBub3RlOiBOb3RlRXhlY3V0aW9uQ29udGV4dCxcbiAgYmxvY2s6IGxvb21FeGVjdXRpb25Db250ZXh0T3ZlcnJpZGUsXG4pOiBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0W1wic291cmNlXCJdW1wiY29udGFpbmVyXCJdIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIgfHwgYmxvY2suY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcImJsb2NrXCI7XG4gIH1cbiAgaWYgKG5vdGUuZGlzYWJsZUNvbnRhaW5lciB8fCBub3RlLmNvbnRhaW5lckdyb3VwPy50cmltKCkpIHtcbiAgICByZXR1cm4gXCJub3RlXCI7XG4gIH1cbiAgaWYgKGdsb2JhbENvbnRhaW5lci50cmltKCkpIHtcbiAgICByZXR1cm4gXCJnbG9iYWxcIjtcbiAgfVxuICByZXR1cm4gXCJub25lXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWROb3RlRXhlY3V0aW9uQ29udGV4dChhcHA6IEFwcCwgZmlsZTogVEZpbGUpOiBOb3RlRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IGZyb250bWF0dGVyID0gYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgaWYgKCFmcm9udG1hdHRlcikge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIGNvbnN0IGNvbnRhaW5lciA9IGZyb250bWF0dGVyW1wibG9vbS1jb250YWluZXJcIl07XG4gIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSBmcm9udG1hdHRlcltcImxvb20tY3dkXCJdID8/IGZyb250bWF0dGVyW1wibG9vbS13b3JraW5nLWRpcmVjdG9yeVwiXTtcbiAgY29uc3QgdGltZW91dCA9IGZyb250bWF0dGVyW1wibG9vbS10aW1lb3V0XCJdO1xuXG4gIHJldHVybiB7XG4gICAgY29udGFpbmVyR3JvdXA6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICBkaXNhYmxlQ29udGFpbmVyOiB0eXBlb2YgY29udGFpbmVyID09PSBcInN0cmluZ1wiID8gaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgOiB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogdHlwZW9mIHdvcmtpbmdEaXJlY3RvcnkgPT09IFwic3RyaW5nXCIgPyB3b3JraW5nRGlyZWN0b3J5IDogdW5kZWZpbmVkLFxuICAgIHRpbWVvdXRNczogdHlwZW9mIHRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRpbWVvdXQpICYmIHRpbWVvdXQgPiAwXG4gICAgICA/IE1hdGgudHJ1bmModGltZW91dClcbiAgICAgIDogdHlwZW9mIHRpbWVvdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZURlZmF1bHRXb3JraW5nRGlyZWN0b3J5KGZpbGU6IFRGaWxlLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgaWYgKHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpO1xuICB9XG5cbiAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKGZpbGUudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gIGNvbnN0IGZpbGVGb2xkZXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICByZXR1cm4gcmVzb2x2ZWQgfHwgcHJvY2Vzcy5jd2QoKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHZhbHVlPy50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUudHJpbSgpLCAxMCk7XG4gIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBhcnNlZCkgJiYgcGFyc2VkID4gMCA/IHBhcnNlZCA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNEaXNhYmxlZFZhbHVlKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIFtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCIsIFwibm9uZVwiLCBcIm5hdGl2ZVwiXS5pbmNsdWRlcyh2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKSk7XG59XG4iLCAiaW1wb3J0IHsgRGVjb3JhdGlvbiwgdHlwZSBFZGl0b3JWaWV3IH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB0eXBlIHsgUmFuZ2VTZXRCdWlsZGVyIH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTGx2bVRva2VuIHtcbiAgZnJvbTogbnVtYmVyO1xuICB0bzogbnVtYmVyO1xuICBjbGFzc05hbWU6IHN0cmluZztcbn1cblxuY29uc3QgTExWTV9LRVlXT1JEUyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KFtcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb250cm9sXCIsIFtcbiAgICBcInJldFwiLCBcImJyXCIsIFwic3dpdGNoXCIsIFwiaW5kaXJlY3RiclwiLCBcImludm9rZVwiLCBcImNhbGxiclwiLCBcInJlc3VtZVwiLCBcInVucmVhY2hhYmxlXCIsIFwiY2xlYW51cHJldFwiLCBcImNhdGNocmV0XCIsIFwiY2F0Y2hzd2l0Y2hcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtZGVjbGFyYXRpb25cIiwgW1xuICAgIFwiZGVmaW5lXCIsIFwiZGVjbGFyZVwiLCBcInR5cGVcIiwgXCJnbG9iYWxcIiwgXCJjb25zdGFudFwiLCBcImFsaWFzXCIsIFwiaWZ1bmNcIiwgXCJjb21kYXRcIiwgXCJhdHRyaWJ1dGVzXCIsIFwic2VjdGlvblwiLCBcImdjXCIsIFwicHJlZml4XCIsIFwicHJvbG9ndWVcIixcbiAgICBcInBlcnNvbmFsaXR5XCIsIFwidXNlbGlzdG9yZGVyXCIsIFwidXNlbGlzdG9yZGVyX2JiXCIsIFwibW9kdWxlXCIsIFwiYXNtXCIsIFwic291cmNlX2ZpbGVuYW1lXCIsIFwidGFyZ2V0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1lbW9yeVwiLCBbXG4gICAgXCJhbGxvY2FcIiwgXCJsb2FkXCIsIFwic3RvcmVcIiwgXCJnZXRlbGVtZW50cHRyXCIsIFwiZmVuY2VcIiwgXCJjbXB4Y2hnXCIsIFwiYXRvbWljcm13XCIsIFwiZXh0cmFjdHZhbHVlXCIsIFwiaW5zZXJ0dmFsdWVcIiwgXCJleHRyYWN0ZWxlbWVudFwiLFxuICAgIFwiaW5zZXJ0ZWxlbWVudFwiLCBcInNodWZmbGV2ZWN0b3JcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtYXJpdGhtZXRpY1wiLCBbXG4gICAgXCJhZGRcIiwgXCJzdWJcIiwgXCJtdWxcIiwgXCJ1ZGl2XCIsIFwic2RpdlwiLCBcInVyZW1cIiwgXCJzcmVtXCIsIFwic2hsXCIsIFwibHNoclwiLCBcImFzaHJcIiwgXCJhbmRcIiwgXCJvclwiLCBcInhvclwiLCBcImZuZWdcIiwgXCJmYWRkXCIsIFwiZnN1YlwiLCBcImZtdWxcIixcbiAgICBcImZkaXZcIiwgXCJmcmVtXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbXBhcmlzb25cIiwgW1wiaWNtcFwiLCBcImZjbXBcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNhc3RcIiwgW1xuICAgIFwidHJ1bmNcIiwgXCJ6ZXh0XCIsIFwic2V4dFwiLCBcImZwdHJ1bmNcIiwgXCJmcGV4dFwiLCBcImZwdG91aVwiLCBcImZwdG9zaVwiLCBcInVpdG9mcFwiLCBcInNpdG9mcFwiLCBcInB0cnRvaW50XCIsIFwiaW50dG9wdHJcIiwgXCJiaXRjYXN0XCIsIFwiYWRkcnNwYWNlY2FzdFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1vdGhlclwiLCBbXCJwaGlcIiwgXCJzZWxlY3RcIiwgXCJmcmVlemVcIiwgXCJjYWxsXCIsIFwibGFuZGluZ3BhZFwiLCBcImNhdGNocGFkXCIsIFwiY2xlYW51cHBhZFwiLCBcInZhX2FyZ1wiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbW9kaWZpZXJcIiwgW1xuICAgIFwicHJpdmF0ZVwiLCBcImludGVybmFsXCIsIFwiYXZhaWxhYmxlX2V4dGVybmFsbHlcIiwgXCJsaW5rb25jZVwiLCBcIndlYWtcIiwgXCJjb21tb25cIiwgXCJhcHBlbmRpbmdcIiwgXCJleHRlcm5fd2Vha1wiLCBcImxpbmtvbmNlX29kclwiLCBcIndlYWtfb2RyXCIsXG4gICAgXCJleHRlcm5hbFwiLCBcImRlZmF1bHRcIiwgXCJoaWRkZW5cIiwgXCJwcm90ZWN0ZWRcIiwgXCJkbGxpbXBvcnRcIiwgXCJkbGxleHBvcnRcIiwgXCJkc29fbG9jYWxcIiwgXCJkc29fcHJlZW1wdGFibGVcIiwgXCJleHRlcm5hbGx5X2luaXRpYWxpemVkXCIsXG4gICAgXCJ0aHJlYWRfbG9jYWxcIiwgXCJsb2NhbGR5bmFtaWNcIiwgXCJpbml0aWFsZXhlY1wiLCBcImxvY2FsZXhlY1wiLCBcInVubmFtZWRfYWRkclwiLCBcImxvY2FsX3VubmFtZWRfYWRkclwiLCBcImF0b21pY1wiLCBcInVub3JkZXJlZFwiLCBcIm1vbm90b25pY1wiLFxuICAgIFwiYWNxdWlyZVwiLCBcInJlbGVhc2VcIiwgXCJhY3FfcmVsXCIsIFwic2VxX2NzdFwiLCBcInN5bmNzY29wZVwiLCBcInZvbGF0aWxlXCIsIFwic2luZ2xldGhyZWFkXCIsIFwiY2NjXCIsIFwiZmFzdGNjXCIsIFwiY29sZGNjXCIsIFwid2Via2l0X2pzY2NcIixcbiAgICBcImFueXJlZ2NjXCIsIFwicHJlc2VydmVfbW9zdGNjXCIsIFwicHJlc2VydmVfYWxsY2NcIiwgXCJjeHhfZmFzdF90bHNjY1wiLCBcInN3aWZ0Y2NcIiwgXCJ0YWlsY2NcIiwgXCJjZmd1YXJkX2NoZWNrY2NcIiwgXCJ0YWlsXCIsIFwibXVzdHRhaWxcIiwgXCJub3RhaWxcIixcbiAgICBcImZhc3RcIiwgXCJubmFuXCIsIFwibmluZlwiLCBcIm5zelwiLCBcImFyY3BcIiwgXCJjb250cmFjdFwiLCBcImFmblwiLCBcInJlYXNzb2NcIiwgXCJudXdcIiwgXCJuc3dcIiwgXCJleGFjdFwiLCBcImluYm91bmRzXCIsIFwidG9cIiwgXCJ4XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1wcmVkaWNhdGVcIiwgW1xuICAgIFwiZXFcIiwgXCJuZVwiLCBcInVndFwiLCBcInVnZVwiLCBcInVsdFwiLCBcInVsZVwiLCBcInNndFwiLCBcInNnZVwiLCBcInNsdFwiLCBcInNsZVwiLCBcIm9lcVwiLCBcIm9ndFwiLCBcIm9nZVwiLCBcIm9sdFwiLCBcIm9sZVwiLCBcIm9uZVwiLCBcIm9yZFwiLCBcInVlcVwiLCBcInVuZVwiLFxuICAgIFwidW5vXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1hdHRyaWJ1dGVcIiwgW1xuICAgIFwiYWx3YXlzaW5saW5lXCIsIFwiYXJnbWVtb25seVwiLCBcImJ1aWx0aW5cIiwgXCJieXJlZlwiLCBcImJ5dmFsXCIsIFwiY29sZFwiLCBcImNvbnZlcmdlbnRcIiwgXCJkZXJlZmVyZW5jZWFibGVcIiwgXCJkZXJlZmVyZW5jZWFibGVfb3JfbnVsbFwiLCBcImRpc3RpbmN0XCIsXG4gICAgXCJpbW1hcmdcIiwgXCJpbmFsbG9jYVwiLCBcImlucmVnXCIsIFwibXVzdHByb2dyZXNzXCIsIFwibmVzdFwiLCBcIm5vYWxpYXNcIiwgXCJub2NhbGxiYWNrXCIsIFwibm9jYXB0dXJlXCIsIFwibm9mcmVlXCIsIFwibm9pbmxpbmVcIiwgXCJub25sYXp5YmluZFwiLFxuICAgIFwibm9ubnVsbFwiLCBcIm5vcmVjdXJzZVwiLCBcIm5vcmVkem9uZVwiLCBcIm5vcmV0dXJuXCIsIFwibm9zeW5jXCIsIFwibm91bndpbmRcIiwgXCJudWxsX3BvaW50ZXJfaXNfdmFsaWRcIiwgXCJvcGFxdWVcIiwgXCJvcHRub25lXCIsIFwib3B0c2l6ZVwiLFxuICAgIFwicHJlYWxsb2NhdGVkXCIsIFwicmVhZG5vbmVcIiwgXCJyZWFkb25seVwiLCBcInJldHVybmVkXCIsIFwicmV0dXJuc190d2ljZVwiLCBcInNhbml0aXplX2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9od2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9tZW1vcnlcIixcbiAgICBcInNhbml0aXplX3RocmVhZFwiLCBcInNpZ25leHRcIiwgXCJzcGVjdWxhdGFibGVcIiwgXCJzcmV0XCIsIFwic3NwXCIsIFwic3NwcmVxXCIsIFwic3Nwc3Ryb25nXCIsIFwic3dpZnRhc3luY1wiLCBcInN3aWZ0c2VsZlwiLCBcInN3aWZ0ZXJyb3JcIiwgXCJ1d3RhYmxlXCIsXG4gICAgXCJ3aWxscmV0dXJuXCIsIFwid3JpdGVvbmx5XCIsIFwiemVyb2V4dFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tY29uc3RhbnRcIiwgW1widHJ1ZVwiLCBcImZhbHNlXCIsIFwibnVsbFwiLCBcIm5vbmVcIiwgXCJ1bmRlZlwiLCBcInBvaXNvblwiLCBcInplcm9pbml0aWFsaXplclwiXSksXG5dKTtcblxuY29uc3QgTExWTV9QUklNSVRJVkVfVFlQRVMgPSBuZXcgU2V0KFtcbiAgXCJ2b2lkXCIsIFwibGFiZWxcIiwgXCJ0b2tlblwiLCBcIm1ldGFkYXRhXCIsIFwieDg2X21teFwiLCBcIng4Nl9hbXhcIiwgXCJoYWxmXCIsIFwiYmZsb2F0XCIsIFwiZmxvYXRcIiwgXCJkb3VibGVcIiwgXCJmcDEyOFwiLCBcIng4Nl9mcDgwXCIsIFwicHBjX2ZwMTI4XCIsIFwicHRyXCIsXG5dKTtcblxuY29uc3QgUFVOQ1RVQVRJT05fQ0xBU1MgPSBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LCBzb3VyY2U6IHN0cmluZyk6IHZvaWQge1xuICBjb2RlRWxlbWVudC5lbXB0eSgpO1xuICBjb2RlRWxlbWVudC5hZGRDbGFzcyhcImxvb20tbGx2bS1jb2RlXCIpO1xuXG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBsaW5lcy5mb3JFYWNoKChsaW5lLCBpbmRleCkgPT4ge1xuICAgIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb2RlRWxlbWVudCwgbGluZSk7XG4gICAgaWYgKGluZGV4IDwgbGluZXMubGVuZ3RoIC0gMSkge1xuICAgICAgY29kZUVsZW1lbnQuYXBwZW5kVGV4dChcIlxcblwiKTtcbiAgICB9XG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkTGx2bURlY29yYXRpb25zKFxuICBidWlsZGVyOiBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4sXG4gIHZpZXc6IEVkaXRvclZpZXcsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRMaW5lQ291bnQgPSBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrKTtcbiAgaWYgKCFjb250ZW50TGluZUNvdW50KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29udGVudExpbmVDb3VudDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF0gPz8gXCJcIjtcbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpO1xuICAgIGlmICghdG9rZW5zLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZG9jTGluZSA9IHZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMiArIGluZGV4KTtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgICAgaWYgKHRva2VuLmZyb20gPT09IHRva2VuLnRvKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLmZyb20sXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLnRvLFxuICAgICAgICBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogdG9rZW4uY2xhc3NOYW1lIH0pLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxpbmU6IHN0cmluZyk6IHZvaWQge1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2VuaXplTGx2bUxpbmUobGluZSkpIHtcbiAgICBpZiAodG9rZW4uZnJvbSA+IGN1cnNvcikge1xuICAgICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IsIHRva2VuLmZyb20pKTtcbiAgICB9XG5cbiAgICBjb25zdCBzcGFuID0gY29udGFpbmVyLmNyZWF0ZVNwYW4oeyBjbHM6IHRva2VuLmNsYXNzTmFtZSB9KTtcbiAgICBzcGFuLnNldFRleHQobGluZS5zbGljZSh0b2tlbi5mcm9tLCB0b2tlbi50bykpO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgaWYgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b2tlbml6ZUxsdm1MaW5lKGxpbmU6IHN0cmluZyk6IExsdm1Ub2tlbltdIHtcbiAgY29uc3QgdG9rZW5zOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgaW5kZXggPSAwO1xuXG4gIGFkZExhYmVsVG9rZW4obGluZSwgdG9rZW5zKTtcblxuICB3aGlsZSAoaW5kZXggPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSBsaW5lW2luZGV4XTtcbiAgICBpZiAoY3VycmVudCA9PT0gXCI7XCIpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBsaW5lLmxlbmd0aCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1jb21tZW50XCIgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjdXJyZW50KSkge1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0cmluZ1Rva2VuID0gcmVhZFN0cmluZ1Rva2VuKGxpbmUsIGluZGV4KTtcbiAgICBpZiAoc3RyaW5nVG9rZW4pIHtcbiAgICAgIGlmIChzdHJpbmdUb2tlbi5wcmVmaXhFbmQgPiBpbmRleCkge1xuICAgICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogc3RyaW5nVG9rZW4ucHJlZml4RW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZy1wcmVmaXhcIiB9KTtcbiAgICAgIH1cbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogc3RyaW5nVG9rZW4udmFsdWVTdGFydCwgdG86IHN0cmluZ1Rva2VuLnZhbHVlRW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZ1wiIH0pO1xuICAgICAgaW5kZXggPSBzdHJpbmdUb2tlbi52YWx1ZUVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoZWQgPVxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQGxsdm1cXC5bQS1aYS16JC5fMC05XSsveSwgXCJsb29tLWxsdm0taW50cmluc2ljXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfEBcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWdsb2JhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8lW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkK1xcYi95LCBcImxvb20tbGx2bS1sb2NhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8hW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwhXFxkK1xcYi95LCBcImxvb20tbGx2bS1tZXRhZGF0YVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXCRbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qL3ksIFwibG9vbS1sbHZtLWNvbWRhdFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8jXFxkK1xcYi95LCBcImxvb20tbGx2bS1hdHRyaWJ1dGUtZ3JvdXBcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFxiYWRkcnNwYWNlXFxzKlxcKFxccypcXGQrXFxzKlxcKS95LCBcImxvb20tbGx2bS10eXBlXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/MHhbMC05QS1GYS1mXStcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkK3xcXGQrKSg/OltlRV1bLStdP1xcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdP1xcZCtcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcLlxcLlxcLi95LCBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiLCB0b2tlbnMpO1xuXG4gICAgaWYgKG1hdGNoZWQpIHtcbiAgICAgIGluZGV4ID0gbWF0Y2hlZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmQgPSByZWFkV29yZChsaW5lLCBpbmRleCk7XG4gICAgaWYgKHdvcmQpIHtcbiAgICAgIHRva2Vucy5wdXNoKHtcbiAgICAgICAgZnJvbTogaW5kZXgsXG4gICAgICAgIHRvOiB3b3JkLmVuZCxcbiAgICAgICAgY2xhc3NOYW1lOiBjbGFzc2lmeVdvcmQod29yZC52YWx1ZSksXG4gICAgICB9KTtcbiAgICAgIGluZGV4ID0gd29yZC5lbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoXCIoKVtde308Piw6PSpcIi5pbmNsdWRlcyhjdXJyZW50KSkge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGluZGV4ICsgMSwgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyB9KTtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpbmRleCArPSAxO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnMpO1xufVxuXG5mdW5jdGlvbiBhZGRMYWJlbFRva2VuKGxpbmU6IHN0cmluZywgdG9rZW5zOiBMbHZtVG9rZW5bXSk6IHZvaWQge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxzKikoPzooW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxcXGQrKXwoJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCspKSg6KS8pO1xuICBpZiAoIW1hdGNoIHx8IG1hdGNoLmluZGV4ID09IG51bGwpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsYWJlbFN0YXJ0ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICBjb25zdCBsYWJlbFRleHQgPSBtYXRjaFsyXSA/PyBtYXRjaFszXTtcbiAgaWYgKCFsYWJlbFRleHQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1sYWJlbFwiLFxuICB9KTtcbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCArIDEsXG4gICAgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5V29yZCh3b3JkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoL15pXFxkKyQvLnRlc3Qod29yZCkgfHwgTExWTV9QUklNSVRJVkVfVFlQRVMuaGFzKHdvcmQpKSB7XG4gICAgcmV0dXJuIFwibG9vbS1sbHZtLXR5cGVcIjtcbiAgfVxuXG4gIHJldHVybiBMTFZNX0tFWVdPUkRTLmdldCh3b3JkKSA/PyBcImxvb20tbGx2bS1wbGFpblwiO1xufVxuXG5mdW5jdGlvbiByZWFkV29yZChsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHZhbHVlOiBzdHJpbmc7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvW0EtWmEtel9dW0EtWmEtejAtOV8uLV0qL3k7XG4gIG1hdGNoLmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCByZXN1bHQgPSBtYXRjaC5leGVjKGxpbmUpO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogcmVzdWx0WzBdLFxuICAgIGVuZDogbWF0Y2gubGFzdEluZGV4LFxuICB9O1xufVxuXG5mdW5jdGlvbiByZWFkU3RyaW5nVG9rZW4obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyBwcmVmaXhFbmQ6IG51bWJlcjsgdmFsdWVTdGFydDogbnVtYmVyOyB2YWx1ZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgbGV0IGN1cnNvciA9IGluZGV4O1xuICBpZiAobGluZVtjdXJzb3JdID09PSBcImNcIiAmJiBsaW5lW2N1cnNvciArIDFdID09PSBcIlxcXCJcIikge1xuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgaWYgKGxpbmVbY3Vyc29yXSAhPT0gXCJcXFwiXCIpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHZhbHVlU3RhcnQgPSBjdXJzb3I7XG4gIGN1cnNvciArPSAxO1xuICB3aGlsZSAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXFxcIikge1xuICAgICAgY3Vyc29yICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFwiXCIpIHtcbiAgICAgIGN1cnNvciArPSAxO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwcmVmaXhFbmQ6IHZhbHVlU3RhcnQsXG4gICAgdmFsdWVTdGFydCxcbiAgICB2YWx1ZUVuZDogY3Vyc29yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaFJlZ2V4VG9rZW4oXG4gIGxpbmU6IHN0cmluZyxcbiAgaW5kZXg6IG51bWJlcixcbiAgcmVnZXg6IFJlZ0V4cCxcbiAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gIHRva2VuczogTGx2bVRva2VuW10sXG4pOiBudW1iZXIgfCBudWxsIHtcbiAgcmVnZXgubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IG1hdGNoID0gcmVnZXguZXhlYyhsaW5lKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHJlZ2V4Lmxhc3RJbmRleCwgY2xhc3NOYW1lIH0pO1xuICByZXR1cm4gcmVnZXgubGFzdEluZGV4O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUb2tlbnModG9rZW5zOiBMbHZtVG9rZW5bXSk6IExsdm1Ub2tlbltdIHtcbiAgdG9rZW5zLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmZyb20gLSByaWdodC5mcm9tIHx8IGxlZnQudG8gLSByaWdodC50byk7XG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgaWYgKHRva2VuLnRvIDw9IGN1cnNvcikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbSA9IE1hdGgubWF4KHRva2VuLmZyb20sIGN1cnNvcik7XG4gICAgbm9ybWFsaXplZC5wdXNoKHsgLi4udG9rZW4sIGZyb20gfSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGVudExpbmVDb3VudChibG9jazogbG9vbUNvZGVCbG9jayk6IG51bWJlciB7XG4gIGlmIChibG9jay5lbmRMaW5lID09PSBibG9jay5zdGFydExpbmUpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGlmIChibG9jay5jb250ZW50Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBibG9jay5lbmRMaW5lID4gYmxvY2suc3RhcnRMaW5lICsgMSA/IDEgOiAwO1xuICB9XG5cbiAgcmV0dXJuIGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBtYXBXb3JkcyhjbGFzc05hbWU6IHN0cmluZywgd29yZHM6IHN0cmluZ1tdKTogQXJyYXk8W3N0cmluZywgc3RyaW5nXT4ge1xuICByZXR1cm4gd29yZHMubWFwKCh3b3JkKSA9PiBbd29yZCwgY2xhc3NOYW1lXSk7XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHNob3J0SGFzaChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKGlucHV0KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uIHtcbiAgaWQ6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGFsaWFzZXM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZVBhY2thZ2Uge1xuICBpZDogc3RyaW5nO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICBsYW5ndWFnZXM6IGxvb21MYW5ndWFnZURlZmluaXRpb25bXTtcbn1cblxuZXhwb3J0IGNvbnN0IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTOiBsb29tTGFuZ3VhZ2VQYWNrYWdlW10gPSBbXG4gIHtcbiAgICBpZDogXCJpbnRlcnByZXRlZFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkludGVycHJldGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiU2NyaXB0IGFuZCBSRVBMLW9yaWVudGVkIGxhbmd1YWdlcyBmb3Igb3BlcmF0aW9uYWwgbm90ZXMgYW5kIHF1aWNrIGV4cGVyaW1lbnRzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJweXRob25cIiwgZGlzcGxheU5hbWU6IFwiUHl0aG9uXCIsIGFsaWFzZXM6IFtcInB5dGhvblwiLCBcInB5XCJdIH0sXG4gICAgICB7IGlkOiBcImphdmFzY3JpcHRcIiwgZGlzcGxheU5hbWU6IFwiSmF2YVNjcmlwdFwiLCBhbGlhc2VzOiBbXCJqYXZhc2NyaXB0XCIsIFwianNcIl0gfSxcbiAgICAgIHsgaWQ6IFwidHlwZXNjcmlwdFwiLCBkaXNwbGF5TmFtZTogXCJUeXBlU2NyaXB0XCIsIGFsaWFzZXM6IFtcInR5cGVzY3JpcHRcIiwgXCJ0c1wiXSB9LFxuICAgICAgeyBpZDogXCJzaGVsbFwiLCBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLCBhbGlhc2VzOiBbXCJzaGVsbFwiLCBcInNoXCIsIFwiYmFzaFwiLCBcInpzaFwiXSB9LFxuICAgICAgeyBpZDogXCJydWJ5XCIsIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIiwgYWxpYXNlczogW1wicnVieVwiLCBcInJiXCJdIH0sXG4gICAgICB7IGlkOiBcInBlcmxcIiwgZGlzcGxheU5hbWU6IFwiUGVybFwiLCBhbGlhc2VzOiBbXCJwZXJsXCIsIFwicGxcIl0gfSxcbiAgICAgIHsgaWQ6IFwibHVhXCIsIGRpc3BsYXlOYW1lOiBcIkx1YVwiLCBhbGlhc2VzOiBbXCJsdWFcIl0gfSxcbiAgICAgIHsgaWQ6IFwicGhwXCIsIGRpc3BsYXlOYW1lOiBcIlBIUFwiLCBhbGlhc2VzOiBbXCJwaHBcIl0gfSxcbiAgICAgIHsgaWQ6IFwiZ29cIiwgZGlzcGxheU5hbWU6IFwiR29cIiwgYWxpYXNlczogW1wiZ29cIiwgXCJnb2xhbmdcIl0gfSxcbiAgICAgIHsgaWQ6IFwiaGFza2VsbFwiLCBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsIGFsaWFzZXM6IFtcImhhc2tlbGxcIiwgXCJoc1wiXSB9LFxuICAgICAgeyBpZDogXCJvY2FtbFwiLCBkaXNwbGF5TmFtZTogXCJPQ2FtbFwiLCBhbGlhc2VzOiBbXCJvY2FtbFwiLCBcIm1sXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm5hdGl2ZS1jb21waWxlZFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIk5hdGl2ZSBDb21waWxlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkxhbmd1YWdlcyBjb21waWxlZCBpbnRvIG5hdGl2ZSBiaW5hcmllcyBieSBsb2NhbCB0b29sY2hhaW5zLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJjXCIsIGRpc3BsYXlOYW1lOiBcIkNcIiwgYWxpYXNlczogW1wiY1wiLCBcImhcIl0gfSxcbiAgICAgIHsgaWQ6IFwiY3BwXCIsIGRpc3BsYXlOYW1lOiBcIkMrK1wiLCBhbGlhc2VzOiBbXCJjcHBcIiwgXCJjeHhcIiwgXCJjY1wiLCBcImMrK1wiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJtYW5hZ2VkLWNvbXBpbGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTWFuYWdlZCBDb21waWxlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkNvbXBpbGVkIGxhbmd1YWdlcyB3aXRoIG1hbmFnZWQgcnVudGltZXMgb3Igc3RydWN0dXJlZCBidWlsZC9ydW4gcGhhc2VzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJydXN0XCIsIGRpc3BsYXlOYW1lOiBcIlJ1c3RcIiwgYWxpYXNlczogW1wicnVzdFwiLCBcInJzXCJdIH0sXG4gICAgICB7IGlkOiBcImphdmFcIiwgZGlzcGxheU5hbWU6IFwiSmF2YVwiLCBhbGlhc2VzOiBbXCJqYXZhXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcInByb29mc1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlByb29mc1wiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlByb29mIGFzc2lzdGFudHMgYW5kIHNvbHZlci1vcmllbnRlZCBsYW5ndWFnZXMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImxlYW5cIiwgZGlzcGxheU5hbWU6IFwiTGVhblwiLCBhbGlhc2VzOiBbXCJsZWFuXCIsIFwibGVhbjRcIl0gfSxcbiAgICAgIHsgaWQ6IFwiY29xXCIsIGRpc3BsYXlOYW1lOiBcIkNvcVwiLCBhbGlhc2VzOiBbXCJjb3FcIiwgXCJ2XCJdIH0sXG4gICAgICB7IGlkOiBcInNtdGxpYlwiLCBkaXNwbGF5TmFtZTogXCJTTVQtTElCXCIsIGFsaWFzZXM6IFtcInNtdFwiLCBcInNtdDJcIiwgXCJzbXRsaWJcIiwgXCJzbXQtbGliXCIsIFwiejNcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibGx2bVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkxMVk1cIixcbiAgICBkZXNjcmlwdGlvbjogXCJMTFZNIElSIHRvb2xpbmcgZm9yIGNvbXBpbGVyIGFuZCBQTCByZXNlYXJjaCB2YXVsdHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImxsdm0taXJcIiwgZGlzcGxheU5hbWU6IFwiTExWTSBJUlwiLCBhbGlhc2VzOiBbXCJsbHZtXCIsIFwibGx2bWlyXCIsIFwibGx2bS1pclwiLCBcImxsXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcImVicGZcIixcbiAgICBkaXNwbGF5TmFtZTogXCJlQlBGXCIsXG4gICAgZGVzY3JpcHRpb246IFwiS2VybmVsIGluc3RydW1lbnRhdGlvbiBsYW5ndWFnZXMgZm9yIEJQRiBvYmplY3QgY29tcGlsYXRpb24sIHZlcmlmaWVyIGNoZWNrcywgYW5kIGJwZnRyYWNlIHNjcmlwdHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImVicGYtY1wiLCBkaXNwbGF5TmFtZTogXCJlQlBGIENcIiwgYWxpYXNlczogW1wiZWJwZlwiLCBcImVicGYtY1wiLCBcImJwZi1jXCIsIFwiYnBmXCJdIH0sXG4gICAgICB7IGlkOiBcImJwZnRyYWNlXCIsIGRpc3BsYXlOYW1lOiBcImJwZnRyYWNlXCIsIGFsaWFzZXM6IFtcImJwZnRyYWNlXCIsIFwiYnRcIl0gfSxcbiAgICBdLFxuICB9LFxuXTtcblxuZXhwb3J0IGNvbnN0IENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lEID0gXCJjdXN0b21cIjtcbmV4cG9ydCBjb25zdCBMQU5HVUFHRV9DT05GSUdVUkFUSU9OX1ZFUlNJT04gPSAyO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbLi4uQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMubWFwKChwYWNrKSA9PiBwYWNrLmlkKSwgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSURdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLmZsYXRNYXAoKHBhY2spID0+IHBhY2subGFuZ3VhZ2VzLm1hcCgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLmlkKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHZvaWQge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MpIHx8ICFzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyA9IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyA9IGdldERlZmF1bHRMYW5ndWFnZUlkcygpO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24pKSB7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IDE7XG4gIH1cbiAgaWYgKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24gPCAyKSB7XG4gICAgZW5hYmxlTGFuZ3VhZ2VQYWNrYWdlKHNldHRpbmdzLCBcImVicGZcIik7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTjtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgcGFja2FnZUlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcGFjayA9IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBwYWNrYWdlSWQpO1xuICBpZiAoIXBhY2spIHtcbiAgICByZXR1cm47XG4gIH1cbiAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBwYWNrLmlkKTtcbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgIGFwcGVuZFVuaXF1ZShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLCBsYW5ndWFnZS5pZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kVW5pcXVlKHZhbHVlczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKCF2YWx1ZXMuaW5jbHVkZXModmFsdWUpKSB7XG4gICAgdmFsdWVzLnB1c2godmFsdWUpO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgY29uc3QgZW5hYmxlZFBhY2tzID0gbmV3IFNldChzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyk7XG4gIGNvbnN0IGVuYWJsZWRMYW5ndWFnZXMgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMpO1xuXG4gIHJldHVybiBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFU1xuICAgIC5maWx0ZXIoKHBhY2spID0+IGVuYWJsZWRQYWNrcy5oYXMocGFjay5pZCkpXG4gICAgLmZsYXRNYXAoKHBhY2spID0+IHBhY2subGFuZ3VhZ2VzKVxuICAgIC5maWx0ZXIoKGxhbmd1YWdlKSA9PiBlbmFibGVkTGFuZ3VhZ2VzLmhhcyhsYW5ndWFnZS5pZCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuZmxhdE1hcCgobGFuZ3VhZ2UpID0+XG4gICAgICBsYW5ndWFnZS5hbGlhc2VzLm1hcCgoYWxpYXMpID0+IFthbGlhcy50b0xvd2VyQ2FzZSgpLCBsYW5ndWFnZS5pZF0gYXMgY29uc3QpLFxuICAgICksXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0xhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuc29tZSgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLmlkID09PSBsYW5ndWFnZUlkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICByZXR1cm4gc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMoQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQpO1xufVxuIiwgImltcG9ydCB7IHNob3J0SGFzaCB9IGZyb20gXCIuL3V0aWxzL2hhc2hcIjtcbmltcG9ydCB7IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQsIGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBPVVRQVVRfU1RBUlQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6c3RhcnRcXHMraWQ9KFthLWYwLTldKylcXHMqLS0+JC9pO1xuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xuY29uc3QgRkVOQ0VfU1RBUlQgPSAvXihgYGArfH5+fispXFxzKihbXlxcc2BdKik/KC4qKSQvO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2UocmF3TGFuZ3VhZ2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTm9ybWFsaXplZExhbmd1YWdlIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICBpZiAoIXNldHRpbmdzKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBpZiAoYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5ncykpIHtcbiAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgICBpZiAobmFtZSAmJiAobmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSkge1xuICAgICAgICByZXR1cm4gbGFuZ3VhZ2UubmFtZS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3QgYWxpYXNlcyA9IGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwKHNldHRpbmdzKTtcbiAgcmV0dXJuIGFsaWFzZXNbbm9ybWFsaXplZF0gPz8gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyhzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZ1tdIHtcbiAgaWYgKCFzZXR0aW5ncykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGN1c3RvbUFsaWFzZXMgPSBhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKVxuICAgID8gKHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkuZmxhdE1hcCgobGFuZ3VhZ2UpID0+IHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIHJldHVybiBbbmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldO1xuICAgIH0pXG4gICAgOiBbXTtcblxuICByZXR1cm4gW1xuICAgIC4uLk9iamVjdC5rZXlzKGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwKHNldHRpbmdzKSksXG4gICAgLi4uY3VzdG9tQWxpYXNlcyxcbiAgXS5tYXAoKGFsaWFzKSA9PiBhbGlhcy50b0xvd2VyQ2FzZSgpKS5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29kZUJsb2NrW10ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBibG9ja3M6IGxvb21Db2RlQmxvY2tbXSA9IFtdO1xuICBsZXQgb3JkaW5hbCA9IDA7XG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcblxuICAgIGlmIChpbnNpZGVNYW5hZ2VkT3V0cHV0KSB7XG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZlbmNlTWF0Y2ggPSBsaW5lLm1hdGNoKEZFTkNFX1NUQVJUKTtcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0TGluZSA9IGk7XG4gICAgY29uc3QgZmVuY2VJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKTtcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcbiAgICBjb25zdCBzb3VyY2VMYW5ndWFnZSA9IChmZW5jZU1hdGNoWzJdID8/IFwiXCIpLnRyaW0oKTtcbiAgICBjb25zdCBpbmZvQXR0cmlidXRlcyA9IHBhcnNlSW5mb0F0dHJpYnV0ZXMoZmVuY2VNYXRjaFszXSA/PyBcIlwiKTtcbiAgICBjb25zdCBzb3VyY2VSZWZlcmVuY2UgPSBwYXJzZVNvdXJjZVJlZmVyZW5jZShpbmZvQXR0cmlidXRlcyk7XG4gICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHBhcnNlRXhlY3V0aW9uQ29udGV4dChpbmZvQXR0cmlidXRlcyk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBub3JtYWxpemVMYW5ndWFnZShzb3VyY2VMYW5ndWFnZSwgc2V0dGluZ3MpO1xuXG4gICAgbGV0IGVuZExpbmUgPSBpO1xuICAgIGNvbnN0IGNvbnRlbnRMaW5lczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICBjb25zdCBpbm5lckxpbmUgPSBsaW5lc1tqXTtcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSBpbm5lckxpbmUudHJpbSgpO1xuXG4gICAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKGZlbmNlVG9rZW4pICYmIC9eKGBgYCt8fn5+KylcXHMqJC8udGVzdCh0cmltbWVkKSkge1xuICAgICAgICBlbmRMaW5lID0gajtcbiAgICAgICAgaSA9IGo7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb250ZW50TGluZXMucHVzaChzdHJpcEZlbmNlSW5kZW50KGlubmVyTGluZSwgZmVuY2VJbmRlbnQpKTtcbiAgICAgIGVuZExpbmUgPSBqO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIG9yZGluYWwgKz0gMTtcbiAgICBjb25zdCBjb250ZW50ID0gY29udGVudExpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgY29uc3QgcmVmZXJlbmNlSGFzaCA9IHNvdXJjZVJlZmVyZW5jZSA/IGA6JHtKU09OLnN0cmluZ2lmeShzb3VyY2VSZWZlcmVuY2UpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGV4ZWN1dGlvbkhhc2ggPSBleGVjdXRpb25Db250ZXh0SGFzVmFsdWVzKGV4ZWN1dGlvbkNvbnRleHQpID8gYDoke0pTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbkNvbnRleHQpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGF0dHJpYnV0ZUhhc2ggPSBPYmplY3Qua2V5cyhpbmZvQXR0cmlidXRlcykubGVuZ3RoID8gYDoke0pTT04uc3RyaW5naWZ5KGluZm9BdHRyaWJ1dGVzKX1gIDogXCJcIjtcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChgJHtjb250ZW50fSR7cmVmZXJlbmNlSGFzaH0ke2V4ZWN1dGlvbkhhc2h9JHthdHRyaWJ1dGVIYXNofWApO1xuICAgIGNvbnN0IGlkID0gc2hvcnRIYXNoKGAke2ZpbGVQYXRofToke29yZGluYWx9OiR7bGFuZ3VhZ2V9OiR7Y29udGVudEhhc2h9YCk7XG5cbiAgICBibG9ja3MucHVzaCh7XG4gICAgICBpZCxcbiAgICAgIG9yZGluYWwsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgbGFuZ3VhZ2VBbGlhczogc291cmNlTGFuZ3VhZ2UudG9Mb3dlckNhc2UoKSxcbiAgICAgIHNvdXJjZUxhbmd1YWdlLFxuICAgICAgY29udGVudCxcbiAgICAgIGF0dHJpYnV0ZXM6IGluZm9BdHRyaWJ1dGVzLFxuICAgICAgc291cmNlUmVmZXJlbmNlLFxuICAgICAgZXhlY3V0aW9uQ29udGV4dCxcbiAgICAgIHN0YXJ0TGluZSxcbiAgICAgIGVuZExpbmUsXG4gICAgICBmZW5jZVN0YXJ0OiAwLFxuICAgICAgZmVuY2VFbmQ6IDAsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBleGVjdXRpb25Db250ZXh0SGFzVmFsdWVzKGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIHBhcnNlRXhlY3V0aW9uQ29udGV4dD4pOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oY29udGV4dC5jb250YWluZXJHcm91cCB8fCBjb250ZXh0LmRpc2FibGVDb250YWluZXIgfHwgY29udGV4dC53b3JraW5nRGlyZWN0b3J5IHx8IGNvbnRleHQudGltZW91dE1zKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNvdXJjZVJlZmVyZW5jZShhdHRyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IGxvb21Tb3VyY2VSZWZlcmVuY2UgfCB1bmRlZmluZWQge1xuICBjb25zdCBmaWxlUGF0aCA9IGF0dHJzW1wibG9vbS1maWxlXCJdID8/IGF0dHJzLmZpbGUgPz8gYXR0cnMuc3JjID8/IGF0dHJzLnNvdXJjZTtcbiAgaWYgKCFmaWxlUGF0aCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGF0dHJzW1wibG9vbS1saW5lc1wiXSA/PyBhdHRycy5saW5lcyA/PyBhdHRycy5saW5lO1xuICBjb25zdCBsaW5lUmFuZ2UgPSBsaW5lcyA/IHBhcnNlTGluZVJhbmdlKGxpbmVzKSA6IG51bGw7XG4gIGNvbnN0IHN5bWJvbE5hbWUgPSBhdHRyc1tcImxvb20tc3ltYm9sXCJdID8/IGF0dHJzLnN5bWJvbCA/PyBhdHRycy5mbiA/PyBhdHRycy5mdW5jdGlvbjtcbiAgY29uc3QgdHJhY2VWYWx1ZSA9IGF0dHJzW1wibG9vbS1kZXBzXCJdID8/IGF0dHJzLmRlcHMgPz8gYXR0cnMudHJhY2U7XG4gIGNvbnN0IGNhbGxFeHByZXNzaW9uID0gYXR0cnNbXCJsb29tLWNhbGxcIl0gPz8gYXR0cnMuY2FsbDtcbiAgY29uc3QgY2FsbEFyZ3MgPSBhdHRyc1tcImxvb20tYXJnc1wiXSA/PyBhdHRycy5hcmdzO1xuICBjb25zdCBwcmludFZhbHVlID0gYXR0cnNbXCJsb29tLXByaW50XCJdID8/IGF0dHJzLnByaW50O1xuICBjb25zdCBjYWxsID0gY2FsbEV4cHJlc3Npb24gIT0gbnVsbCB8fCBjYWxsQXJncyAhPSBudWxsXG4gICAgPyB7XG4gICAgICBleHByZXNzaW9uOiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKGNhbGxFeHByZXNzaW9uKSA9PT0gXCJ0cnVlXCIgPyB1bmRlZmluZWQgOiBjYWxsRXhwcmVzc2lvbixcbiAgICAgIGFyZ3M6IGNhbGxBcmdzLFxuICAgICAgcHJpbnQ6IHByaW50VmFsdWUgPT0gbnVsbCA/IHRydWUgOiAhW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIl0uaW5jbHVkZXMocHJpbnRWYWx1ZS50b0xvd2VyQ2FzZSgpKSxcbiAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlUGF0aCxcbiAgICBsaW5lU3RhcnQ6IGxpbmVSYW5nZT8uc3RhcnQsXG4gICAgbGluZUVuZDogbGluZVJhbmdlPy5lbmQsXG4gICAgc3ltYm9sTmFtZSxcbiAgICB0cmFjZURlcGVuZGVuY2llczogdHJhY2VWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyh0cmFjZVZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIGNhbGwsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXhlY3V0aW9uQ29udGV4dChhdHRyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICBjb25zdCBjb250YWluZXIgPSBhdHRyc1tcImxvb20tY29udGFpbmVyXCJdID8/IGF0dHJzLmNvbnRhaW5lcjtcbiAgY29uc3QgdGltZW91dCA9IGF0dHJzW1wibG9vbS10aW1lb3V0XCJdID8/IGF0dHJzLnRpbWVvdXQ7XG4gIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSBhdHRyc1tcImxvb20tY3dkXCJdID8/IGF0dHJzLmN3ZCA/PyBhdHRyc1tcIndvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0ID8gcGFyc2VQb3NpdGl2ZUludGVnZXIodGltZW91dCkgOiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogY29udGFpbmVyICYmICFpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA/IGNvbnRhaW5lciA6IHVuZGVmaW5lZCxcbiAgICBkaXNhYmxlQ29udGFpbmVyOiBjb250YWluZXIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgIHRpbWVvdXRNcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQm9vbGVhbkF0dHJpYnV0ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB1bmRlZmluZWQgOiB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VJbmZvQXR0cmlidXRlcyhpbnB1dDogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IHBhdHRlcm4gPSAvKFtBLVphLXowLTlfLV0rKVxccyo9XFxzKig/OlwiKFteXCJdKilcInwnKFteJ10qKSd8KFteXFxzXSspKS9nO1xuICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobWF0Y2ggPSBwYXR0ZXJuLmV4ZWMoaW5wdXQpKSAhPSBudWxsKSB7XG4gICAgYXR0cnNbbWF0Y2hbMV0udG9Mb3dlckNhc2UoKV0gPSBtYXRjaFsyXSA/PyBtYXRjaFszXSA/PyBtYXRjaFs0XSA/PyBcIlwiO1xuICB9XG4gIHJldHVybiBhdHRycztcbn1cblxuZnVuY3Rpb24gcGFyc2VMaW5lUmFuZ2UodmFsdWU6IHN0cmluZyk6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHZhbHVlLnRyaW0oKS5tYXRjaCgvXkw/KFxcZCspKD86XFxzKlstOl1cXHMqTD8oXFxkKykpPyQvaSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICBjb25zdCBlbmQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMl0gPz8gbWF0Y2hbMV0sIDEwKTtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHN0YXJ0KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihlbmQpIHx8IHN0YXJ0IDw9IDAgfHwgZW5kIDwgc3RhcnQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gbGluZSA+PSBibG9jay5zdGFydExpbmUgJiYgbGluZSA8PSBibG9jay5lbmRMaW5lKSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFmZW5jZUluZGVudCkge1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbGluZS5zbGljZShpbmRleCk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIHN5bWJvbEV4dHJhY3Rpb246IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiIHwgXCJ0b3AtbGV2ZWxcIiB8IFwiZ2VuZXJpY1wiIHwgXCJleHRlcm5hbFwiO1xuICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiIHwgXCJyYXdcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgc291cmNlUHJldmlldzogYm9vbGVhbjtcbn1cblxuY29uc3QgQlVJTFRfSU5fQ0FQQUJJTElUSUVTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5PiA9IHtcbiAgcHl0aG9uOiB7XG4gICAgbGFuZ3VhZ2U6IFwicHl0aG9uXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJhc3RcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmFzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIHR5cGVzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJ0eXBlc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGM6IHtcbiAgICBsYW5ndWFnZTogXCJjXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGNwcDoge1xuICAgIGxhbmd1YWdlOiBcImNwcFwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwiYnVpbHQtaW5cIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBcImxsdm0taXJcIjoge1xuICAgIGxhbmd1YWdlOiBcImxsdm0taXJcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGhhc2tlbGw6IHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBvY2FtbDoge1xuICAgIGxhbmd1YWdlOiBcIm9jYW1sXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmE6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBcImVicGYtY1wiOiB7XG4gICAgbGFuZ3VhZ2U6IFwiZWJwZi1jXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBicGZ0cmFjZToge1xuICAgIGxhbmd1YWdlOiBcImJwZnRyYWNlXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGFuZ3VhZ2VDYXBhYmlsaXR5KGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBoYXNFeHRlcm5hbEV4dHJhY3RvciA9IGZhbHNlKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eSB7XG4gIGlmIChoYXNFeHRlcm5hbEV4dHJhY3Rvcikge1xuICAgIHJldHVybiB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHN5bWJvbEV4dHJhY3Rpb246IFwiZXh0ZXJuYWxcIixcbiAgICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImV4dGVybmFsXCIsXG4gICAgICBjYWxsSGFybmVzczogXCJleHRlcm5hbFwiLFxuICAgICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIEJVSUxUX0lOX0NBUEFCSUxJVElFU1tsYW5ndWFnZV0gPz8ge1xuICAgIGxhbmd1YWdlLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwiZ2VuZXJpY1wiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImdlbmVyaWNcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QnVpbHRJbkxhbmd1YWdlQ2FwYWJpbGl0aWVzKCk6IGxvb21MYW5ndWFnZUNhcGFiaWxpdHlbXSB7XG4gIHJldHVybiBPYmplY3QudmFsdWVzKEJVSUxUX0lOX0NBUEFCSUxJVElFUyk7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5vZGVSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5vZGVcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5vZGUuanNcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiamF2YXNjcmlwdFwiLCBcInR5cGVzY3JpcHRcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5qc1wiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIEN1c3RvbUxhbmd1YWdlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJjdXN0b21cIjtcbiAgZGlzcGxheU5hbWUgPSBcIkN1c3RvbSBsYW5ndWFnZVwiO1xuICBsYW5ndWFnZXMgPSBbXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk/LmV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGN1c3RvbSBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2xhbmd1YWdlLm5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBsYW5ndWFnZS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuYXJncyB8fCBcIntmaWxlfVwiKSxcbiAgICAgIGZpbGVFeHRlbnNpb246IG5vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24sIGxhbmd1YWdlLm5hbWUpLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldEN1c3RvbUxhbmd1YWdlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUN1c3RvbUxhbmd1YWdlIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gYmxvY2subGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgcmV0dXJuIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChsYW5ndWFnZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gbGFuZ3VhZ2UuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGAuJHtuYW1lfWA7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgSW50ZXJwcmV0ZWRTcGVjIHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKSA9PiBzdHJpbmc7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgYXJncz86IHN0cmluZ1tdO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0VudjtcbiAgbWluaW11bVRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuY29uc3QgSU5URVJQUkVURURfU1BFQ1M6IEludGVycHJldGVkU3BlY1tdID0gW1xuICB7XG4gICAgbGFuZ3VhZ2U6IFwic2hlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3Muc2hlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnNoXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJydWJ5XCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUnVieVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucnVieUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucmJcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBlcmxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQZXJsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5wZXJsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5wbFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwibHVhXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTHVhXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmx1YVwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGhwXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUEhQXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5waHBFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBocFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiZ29cIixcbiAgICBkaXNwbGF5TmFtZTogXCJHb1wiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuZ29FeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmdvXCIsXG4gICAgYXJnczogW1wicnVuXCIsIFwie2ZpbGV9XCJdLFxuICAgIGVudjoge1xuICAgICAgR09DQUNIRTogXCJ7dGVtcERpcn0vZ29jYWNoZVwiLFxuICAgIH0sXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiaGFza2VsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmhhc2tlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmhzXCIsXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuXTtcblxuZXhwb3J0IGNsYXNzIEludGVycHJldGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJpbnRlcnByZXRlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiSW50ZXJwcmV0ZWRcIjtcbiAgbGFuZ3VhZ2VzID0gSU5URVJQUkVURURfU1BFQ1MubWFwKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlKTtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICByZXR1cm4gQm9vbGVhbihzcGVjPy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIGlmICghc3BlYykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfWAsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCksXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MgPz8gW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogc3BlYy5maWxlRXh0ZW5zaW9uLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc3BlYy5taW5pbXVtVGltZW91dE1zID8/IDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIGVudjogc3BlYy5lbnYsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNwZWMobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBJbnRlcnByZXRlZFNwZWMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBJTlRFUlBSRVRFRF9TUEVDUy5maW5kKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlID09PSBsYW5ndWFnZSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBFYnBmQ01vZGUgPSBcImNvbXBpbGVcIiB8IFwibG9hZFwiO1xudHlwZSBCcGZ0cmFjZU1vZGUgPSBcImNoZWNrXCIgfCBcInJ1blwiO1xuXG5leHBvcnQgY2xhc3MgRWJwZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiZWJwZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiZUJQRlwiO1xuICBsYW5ndWFnZXMgPSBbXCJlYnBmLWNcIiwgXCJicGZ0cmFjZVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiZWJwZi1jXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImJwZnRyYWNlXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImVicGYtY1wiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5FYnBmQyhibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiYnBmdHJhY2VcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQnBmdHJhY2UoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBlQlBGIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5FYnBmQyhibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gcmVhZEVicGZDTW9kZShibG9jayk7XG4gICAgY29uc3QgY2ZsYWdzID0gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLWNmbGFnc1wiLCBcImVicGYtY2ZsYWdzXCIpLmZsYXRNYXAoc3BsaXRDb21tYW5kTGluZSk7XG4gICAgY29uc3QgaW5jbHVkZVBhdGhzID0gW1xuICAgICAgLi4uc3BsaXRDc3Yoc2V0dGluZ3MuZWJwZkluY2x1ZGVQYXRocyksXG4gICAgICAuLi5yZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtaW5jbHVkZXNcIiwgXCJlYnBmLWluY2x1ZGVzXCIpLFxuICAgIF07XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLmJwZi5jXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IG9iamVjdFBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5icGYub1wiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNsYW5nYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJlQlBGIGNsYW5nXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgXCItdGFyZ2V0XCIsXG4gICAgICAgICAgXCJicGZcIixcbiAgICAgICAgICBcIi1PMlwiLFxuICAgICAgICAgIFwiLWdcIixcbiAgICAgICAgICBcIi1XYWxsXCIsXG4gICAgICAgICAgLi4uaW5jbHVkZVBhdGhzLmZsYXRNYXAoKGluY2x1ZGVQYXRoKSA9PiBbXCItSVwiLCBpbmNsdWRlUGF0aF0pLFxuICAgICAgICAgIC4uLmNmbGFncyxcbiAgICAgICAgICBcIi1jXCIsXG4gICAgICAgICAgdGVtcEZpbGUsXG4gICAgICAgICAgXCItb1wiLFxuICAgICAgICAgIG9iamVjdFBhdGgsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgY29tcGlsZVJlc3VsdC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKGNvbXBpbGVSZXN1bHQuc3Rkb3V0LCBcIkNvbXBpbGVcIiwgYGVCUEYgb2JqZWN0IGNvbXBpbGVkIHN1Y2Nlc3NmdWxseTogJHtvYmplY3RQYXRofWApO1xuICAgICAgYXdhaXQgdGhpcy5hcHBlbmRPYmplY3RJbnNwZWN0aW9uKGNvbXBpbGVSZXN1bHQsIG9iamVjdFBhdGgsIGNvbnRleHQsIHNldHRpbmdzKTtcblxuICAgICAgaWYgKG1vZGUgPT09IFwiY29tcGlsZVwiKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5sb2FkRWJwZk9iamVjdChibG9jaywgb2JqZWN0UGF0aCwgY29udGV4dCwgc2V0dGluZ3MsIGNvbXBpbGVSZXN1bHQpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhcHBlbmRPYmplY3RJbnNwZWN0aW9uKHJlc3VsdDogbG9vbVJ1blJlc3VsdCwgb2JqZWN0UGF0aDogc3RyaW5nLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG9iamR1bXAgPSBzZXR0aW5ncy5lYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBpZiAoIW9iamR1bXApIHtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gYXBwZW5kTGluZShyZXN1bHQud2FybmluZywgXCJlQlBGIG9iamVjdCBpbnNwZWN0aW9uIHNraXBwZWQgYmVjYXVzZSBubyBvYmplY3QgaW5zcGVjdG9yIGlzIGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGluc3BlY3QgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvYmpkdW1wYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiZUJQRiBvYmplY3QgaW5zcGVjdGlvblwiLFxuICAgICAgZXhlY3V0YWJsZTogb2JqZHVtcCxcbiAgICAgIGFyZ3M6IFtcIi1oXCIsIG9iamVjdFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoaW5zcGVjdC5zdWNjZXNzKSB7XG4gICAgICByZXN1bHQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihyZXN1bHQuc3Rkb3V0LCBcIk9iamVjdCBzZWN0aW9uc1wiLCBpbnNwZWN0LnN0ZG91dC50cmltKCkgfHwgXCIobm8gc2VjdGlvbnMgcmVwb3J0ZWQpXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQud2FybmluZyA9IGFwcGVuZExpbmUocmVzdWx0Lndhcm5pbmcsIGBlQlBGIG9iamVjdCBpbnNwZWN0aW9uIGZhaWxlZDogJHtpbnNwZWN0LnN0ZGVyciB8fCBpbnNwZWN0LnN0ZG91dCB8fCBgZXhpdCAke2luc3BlY3QuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRFYnBmT2JqZWN0KFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIG9iamVjdFBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICAgIGNvbXBpbGVSZXN1bHQ6IGxvb21SdW5SZXN1bHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmICghc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImVCUEYga2VybmVsIGxvYWRpbmcgaXMgZGlzYWJsZWQuIEVuYWJsZSBBbGxvdyBlQlBGIGtlcm5lbCBsb2FkIGluIHNldHRpbmdzIGJlZm9yZSB1c2luZyBsb29tLWVicGYtbW9kZT1sb2FkLlwiKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgcGluUGF0aCA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLXBpblwiLCBcImVicGYtcGluXCIpO1xuICAgIGlmICghcGluUGF0aCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImxvb20tZWJwZi1tb2RlPWxvYWQgcmVxdWlyZXMgbG9vbS1lYnBmLXBpbj0vc3lzL2ZzL2JwZi88cGF0aD4uXCIpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2FkID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdG9vbDpsb2FkYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdG9vbCBlQlBGIGxvYWRcIixcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZCcGZ0b29sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0b29sXCIsXG4gICAgICBhcmdzOiBbXCItZFwiLCBcInByb2dcIiwgXCJsb2FkYWxsXCIsIG9iamVjdFBhdGgsIHBpblBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBsb2FkLnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRvdXQsIFwiYnBmdG9vbCBzdGRvdXRcIiwgbG9hZC5zdGRvdXQudHJpbSgpKTtcbiAgICBsb2FkLnN0ZGVyciA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwiYnBmdG9vbCBzdGRlcnJcIiwgbG9hZC5zdGRlcnIudHJpbSgpKTtcbiAgICBsb2FkLndhcm5pbmcgPSBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQud2FybmluZywgYGVCUEYgb2JqZWN0IGxvYWQgcmVxdWVzdGVkIHdpdGggcGluIHBhdGggJHtwaW5QYXRofS5gKTtcbiAgICByZXR1cm4gbG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQnBmdHJhY2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2spO1xuICAgIGNvbnN0IGV4dHJhQXJncyA9IHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tYnBmdHJhY2UtYXJnc1wiLCBcImJwZnRyYWNlLWFyZ3NcIikuZmxhdE1hcChzcGxpdENvbW1hbmRMaW5lKTtcbiAgICBjb25zdCBhcmdzID0gbW9kZSA9PT0gXCJjaGVja1wiXG4gICAgICA/IFtcIi1kXCIsIC4uLmV4dHJhQXJncywgXCJ7ZmlsZX1cIl1cbiAgICAgIDogWy4uLmV4dHJhQXJncywgXCJ7ZmlsZX1cIl07XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLmJ0XCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBGaWxlIH0pID0+XG4gICAgICBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmJwZnRyYWNlOiR7bW9kZX1gLFxuICAgICAgICBydW5uZXJOYW1lOiBtb2RlID09PSBcImNoZWNrXCIgPyBcImJwZnRyYWNlIGNoZWNrXCIgOiBcImJwZnRyYWNlXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IGFyZ3MubWFwKChhcmcpID0+IGFyZy5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKSksXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pLFxuICAgICk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVhZEVicGZDTW9kZShibG9jazogbG9vbUNvZGVCbG9jayk6IEVicGZDTW9kZSB7XG4gIGNvbnN0IHZhbHVlID0gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtbW9kZVwiLCBcImVicGYtbW9kZVwiKSB8fCBcImNvbXBpbGVcIjtcbiAgaWYgKHZhbHVlID09PSBcImNvbXBpbGVcIiB8fCB2YWx1ZSA9PT0gXCJsb2FkXCIpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBlQlBGIG1vZGU6ICR7dmFsdWV9LiBVc2UgY29tcGlsZSBvciBsb2FkLmApO1xufVxuXG5mdW5jdGlvbiByZWFkQnBmdHJhY2VNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogQnBmdHJhY2VNb2RlIHtcbiAgY29uc3QgdmFsdWUgPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tYnBmdHJhY2UtbW9kZVwiLCBcImJwZnRyYWNlLW1vZGVcIikgfHwgXCJjaGVja1wiO1xuICBpZiAodmFsdWUgPT09IFwiY2hlY2tcIiB8fCB2YWx1ZSA9PT0gXCJydW5cIikge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGJwZnRyYWNlIG1vZGU6ICR7dmFsdWV9LiBVc2UgY2hlY2sgb3IgcnVuLmApO1xufVxuXG5mdW5jdGlvbiByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBwcmltYXJ5OiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gYmxvY2suYXR0cmlidXRlc1twcmltYXJ5XT8udHJpbSgpIHx8IGJsb2NrLmF0dHJpYnV0ZXNbZmFsbGJhY2tdPy50cmltKCkgfHwgdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiByZWFkTGlzdEF0dHJpYnV0ZShibG9jazogbG9vbUNvZGVCbG9jaywgcHJpbWFyeTogc3RyaW5nLCBmYWxsYmFjazogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gc3BsaXRDc3YocmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgcHJpbWFyeSwgZmFsbGJhY2spIHx8IFwiXCIpO1xufVxuXG5mdW5jdGlvbiBzcGxpdENzdih2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoaXRlbSkgPT4gaXRlbS50cmltKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kTGluZShleGlzdGluZzogc3RyaW5nIHwgdW5kZWZpbmVkLCBsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW2V4aXN0aW5nLCBsaW5lXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQ/LnRyaW0oKSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kU2VjdGlvbihleGlzdGluZzogc3RyaW5nLCB0aXRsZTogc3RyaW5nLCBib2R5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBjb250ZW50ID0gYm9keS50cmltKCk7XG4gIGlmICghY29udGVudCkge1xuICAgIHJldHVybiBleGlzdGluZztcbiAgfVxuICByZXR1cm4gW2V4aXN0aW5nLnRyaW0oKSwgYCR7dGl0bGV9OlxcbiR7Y29udGVudH1gXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIlxcblxcblwiKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTGx2bVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibGx2bS1pclwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTExWTSBJUlwiO1xuICBsYW5ndWFnZXMgPSBbXCJsbHZtLWlyXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXN1bHQudGltZWRPdXQgJiYgIXJlc3VsdC5jYW5jZWxsZWQgJiYgcmVzdWx0LmV4aXRDb2RlICE9IG51bGwgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICBpZiAocmVzdWx0LmV4aXRDb2RlICE9PSAwKSB7XG4gICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgUHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LiBVbmRlciBsbGksIHRoYXQgYmVjb21lcyB0aGUgcHJvY2VzcyBleGl0IHN0YXR1cy5gO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRvdXQgPSByZXN1bHQuZXhpdENvZGUgPT09IDBcbiAgICAgICAgICA/IFwiTExWTSBwcm9ncmFtIGV4aXRlZCB3aXRoIGNvZGUgMC5cIlxuICAgICAgICAgIDogYExMVk0gcHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LlxcblVzZSBzdGRvdXQgaW4gdGhlIElSIGl0c2VsZiBpZiB5b3Ugd2FudCBwcmludGFibGUgcHJvZ3JhbSBvdXRwdXQuYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoTmFtZWRUZW1wU291cmNlRmlsZSwgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE1hbmFnZWRDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibWFuYWdlZC1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTWFuYWdlZCBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJydXN0XCIsIFwiamF2YVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1blJ1c3QoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5KYXZhKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUnVzdChibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLnJzXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShcIk1haW4uamF2YVwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAoIXNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpzb3VyY2VgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRlbXBEaXIsXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wiLWNwXCIsIHRlbXBEaXIsIFwiTWFpblwiXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOYXRpdmVDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibmF0aXZlLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOYXRpdmUgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiY1wiLCBcImNwcFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjcHBcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpIDogc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgZmlsZUV4dGVuc2lvbiA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiLmNcIiA6IFwiLmNwcFwiO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIkMgKEdDQylcIiA6IFwiQysrIChHKyspXCI7XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKGZpbGVFeHRlbnNpb24sIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcywgcnVuVGVtcEZpbGVQcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgT2NhbWxSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm9jYW1sXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJPQ2FtbFwiO1xuICBsYW5ndWFnZXMgPSBbXCJvY2FtbFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwib2NhbWxcIiAmJiBCb29sZWFuKHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5vY2FtbE1vZGU7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCk7XG5cbiAgICBpZiAobW9kZSA9PT0gXCJvY2FtbFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmR1bmVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkR1bmUgLyBPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJleGVjXCIsIFwiLS1cIiwgXCJvY2FtbFwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLm1sXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtY29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIi1vXCIsIGJpbmFyeVBhdGgsIHRlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtcnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFB5dGhvblJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHl0aG9uXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQeXRob25cIjtcbiAgbGFuZ3VhZ2VzID0gW1wicHl0aG9uXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBCb29sZWFuKHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIucHlcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJvb2ZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInByb29mXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQcm9vZiBjaGVja2VyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxlYW5cIiwgXCJjb3FcIiwgXCJzbXRsaWJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmxlYW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkxlYW5cIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y29xYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJDb3FcIixcbiAgICAgICAgZXhlY3V0YWJsZTogcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLFxuICAgICAgICBhcmdzOiBbXCItcVwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpzbXRsaWJgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlNNVC1MSUIgKFozKVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm9vZiBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IHNldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpO1xuICBpZiAoY29uZmlndXJlZCAmJiBjb25maWd1cmVkICE9PSBcImNvcWNcIikge1xuICAgIHJldHVybiBjb25maWd1cmVkO1xuICB9XG5cbiAgY29uc3Qgb3BhbUNvcWMgPSBqb2luKHByb2Nlc3MuZW52LkhPTUUgPz8gXCJcIiwgXCIub3BhbVwiLCBcImRlZmF1bHRcIiwgXCJiaW5cIiwgXCJjb3FjXCIpO1xuICByZXR1cm4gZXhpc3RzU3luYyhvcGFtQ29xYykgPyBvcGFtQ29xYyA6IGNvbmZpZ3VyZWQgfHwgXCJjb3FjXCI7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQsIGlzTGFuZ3VhZ2VFbmFibGVkIH0gZnJvbSBcIi4uL2xhbmd1YWdlUGFja2FnZXNcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21SdW5uZXJSZWdpc3RyeSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcnVubmVyczogbG9vbVJ1bm5lcltdKSB7fVxuXG4gIGdldFJ1bm5lckZvckJsb2NrKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbVJ1bm5lciB8IG51bGwge1xuICAgIGlmICghdGhpcy5pc0Jsb2NrTGFuZ3VhZ2VFbmFibGVkKGJsb2NrLCBzZXR0aW5ncykpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGhpcy5ydW5uZXJzLmZsYXRNYXAoKHJ1bm5lcikgPT4gcnVubmVyLmxhbmd1YWdlcykpXTtcbiAgfVxuXG4gIHByaXZhdGUgaXNCbG9ja0xhbmd1YWdlRW5hYmxlZChibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChpc0xhbmd1YWdlRW5hYmxlZChibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3MpICYmIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5zb21lKChsYW5ndWFnZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gbGFuZ3VhZ2UuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKSB8fCBhbGlhc2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlQWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZ2V0RGVmYXVsdExhbmd1YWdlSWRzLCBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogbG9vbVBsdWdpblNldHRpbmdzID0ge1xuICBlbmFibGVMb2NhbEV4ZWN1dGlvbjogZmFsc2UsXG4gIGhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2s6IGZhbHNlLFxuICBwcmVzZXJ2ZVNvdXJjZU1vZGU6IHRydWUsXG4gIGRlZmF1bHRUaW1lb3V0TXM6IDgwMDAsXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IFwiXCIsXG4gIHB5dGhvbkV4ZWN1dGFibGU6IFwicHl0aG9uM1wiLFxuICBub2RlRXhlY3V0YWJsZTogXCJub2RlXCIsXG4gIHR5cGVzY3JpcHRNb2RlOiBcInRzLW5vZGVcIixcbiAgdHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlOiBcInRzLW5vZGVcIixcbiAgb2NhbWxNb2RlOiBcIm9jYW1sXCIsXG4gIG9jYW1sRXhlY3V0YWJsZTogXCJvY2FtbFwiLFxuICBjRXhlY3V0YWJsZTogXCJnY2NcIixcbiAgY3BwRXhlY3V0YWJsZTogXCJnKytcIixcbiAgc2hlbGxFeGVjdXRhYmxlOiBcImJhc2hcIixcbiAgcnVieUV4ZWN1dGFibGU6IFwicnVieVwiLFxuICBwZXJsRXhlY3V0YWJsZTogXCJwZXJsXCIsXG4gIGx1YUV4ZWN1dGFibGU6IFwibHVhXCIsXG4gIHBocEV4ZWN1dGFibGU6IFwicGhwXCIsXG4gIGdvRXhlY3V0YWJsZTogXCJnb1wiLFxuICBydXN0RXhlY3V0YWJsZTogXCJydXN0Y1wiLFxuICBoYXNrZWxsRXhlY3V0YWJsZTogXCJydW5naGNcIixcbiAgamF2YUNvbXBpbGVyRXhlY3V0YWJsZTogXCJcIixcbiAgamF2YUV4ZWN1dGFibGU6IFwiamF2YVwiLFxuICBsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlOiBcImxsaVwiLFxuICBlYnBmQ2xhbmdFeGVjdXRhYmxlOiBcImNsYW5nXCIsXG4gIGVicGZCcGZ0b29sRXhlY3V0YWJsZTogXCJicGZ0b29sXCIsXG4gIGVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGU6IFwibGx2bS1vYmpkdW1wXCIsXG4gIGVicGZJbmNsdWRlUGF0aHM6IFwiXCIsXG4gIGVicGZBbGxvd0tlcm5lbExvYWQ6IGZhbHNlLFxuICBicGZ0cmFjZUV4ZWN1dGFibGU6IFwiYnBmdHJhY2VcIixcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxuICBjb3FFeGVjdXRhYmxlOiBcImNvcWNcIixcbiAgc210RXhlY3V0YWJsZTogXCJ6M1wiLFxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgZXh0cmFjdGVkU291cmNlUHJldmlld01vZGU6IFwiY29sbGFwc2VkXCIsXG4gIHNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YTogdHJ1ZSxcbiAgbGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbjogMixcbiAgZW5hYmxlZExhbmd1YWdlUGFja3M6IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKSxcbiAgZW5hYmxlZExhbmd1YWdlczogZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCksXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXG4gIHBkZkV4cG9ydE1vZGU6IFwiYm90aFwiLFxuICBkZWZhdWx0Q29udGFpbmVyR3JvdXA6IFwiXCIsXG59O1xuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgeyBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUywgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQsIGdldERlZmF1bHRMYW5ndWFnZUlkcywgZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcywgaXNMYW5ndWFnZUVuYWJsZWQsIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbiB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgeyBERUZBVUxUX1NFVFRJTkdTIH0gZnJvbSBcIi4vZGVmYXVsdFNldHRpbmdzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4pIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJSdW4gc3VwcG9ydGVkIGNvZGUgZmVuY2VzIGRpcmVjdGx5IGZyb20gbm90ZXMgd2hpbGUgcHJlc2VydmluZyBuYXRpdmUgc3ludGF4IGhpZ2hsaWdodGluZy5cIiB9KTtcblxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcbiAgICB0aGlzLnJlbmRlckxhbmd1YWdlUGFja2FnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkxhbmd1YWdlIFBhY2thZ2VzXCIpKTtcbiAgICB0aGlzLnJlbmRlckJ1aWx0SW5SdW50aW1lcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQnVpbHQtaW4gUnVudGltZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDdXN0b20gTGFuZ3VhZ2VzXCIpKTtcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb25cIiB9KTtcbiAgICBkZXRhaWxzLm9wZW4gPSBvcGVuO1xuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcbiAgICByZXR1cm4gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uLWJvZHlcIiB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyR2VuZXJhbFNldHRpbmdzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc2FibGVkIGJ5IGRlZmF1bHQuIGxvb20gcnVucyBjb2RlIG9uIHlvdXIgbG9jYWwgbWFjaGluZSBhbmQgZG9lcyBub3QgcHJvdmlkZSBzYW5kYm94aW5nLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB2YWx1ZTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiS2VlcCBsb29tIG5vdGVzIGluIHNvdXJjZSBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlByZXNlcnZlIHJhdyBmZW5jZWQgY29kZSBpbiB0aGUgZWRpdG9yIGluc3RlYWQgb2YgbGV0dGluZyBsaXZlIHByZXZpZXcgY29sbGFwc2UgcmVzZWFyY2ggc25pcHBldHMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlZmF1bHQgdGltZW91dFwiKVxuICAgICAgLnNldERlc2MoXCJNYXhpbXVtIGV4ZWN1dGlvbiB0aW1lIGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgbG9vbSB0ZXJtaW5hdGVzIHRoZSBwcm9jZXNzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCI4MDAwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBwYXJzZWQ7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV29ya2luZyBkaXJlY3RvcnlcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJWYXVsdCByb290XCIpLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxuICAgICAgLnNldERlc2MoXCJJbnNlcnQgbWFuYWdlZCBsb29tIG91dHB1dCBzZWN0aW9ucyBiZW5lYXRoIGNvZGUgYmxvY2tzIGluc3RlYWQgb2Yga2VlcGluZyByZXN1bHRzIHB1cmVseSBpbiB0aGUgVUkuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tcnVuIG9uIGZpbGUgb3BlblwiKVxuICAgICAgLnNldERlc2MoXCJSdW4gYWxsIHN1cHBvcnRlZCBibG9ja3MgaW4gdGhlIGFjdGl2ZSBub3RlIHdoZW4gaXQgb3BlbnMuIERpc2FibGVkIGJ5IGRlZmF1bHQuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3BlbiA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkV4dHJhY3RlZCBzb3VyY2UgcHJldmlld1wiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IGxvb20gc2hvd3MgdGhlIG1hdGVyaWFsaXplZCBzb3VyY2UgZm9yIGJsb2NrcyB0aGF0IHVzZSBsb29tLWZpbGUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2xsYXBzZWRcIiwgXCJDb2xsYXBzZWRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZXhwYW5kZWRcIiwgXCJFeHBhbmRlZFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJoaWRkZW5cIiwgXCJIaWRkZW5cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID0gdmFsdWUgYXMgXCJjb2xsYXBzZWRcIiB8IFwiZXhwYW5kZWRcIiB8IFwiaGlkZGVuXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlNob3cgY2FwYWJpbGl0eSBtZXRhZGF0YVwiKVxuICAgICAgLnNldERlc2MoXCJTaG93IHN5bWJvbCwgZGVwZW5kZW5jeSwgYW5kIGhhcm5lc3MgY2FwYWJpbGl0eSBtZXRhZGF0YSBpbiBleHRyYWN0ZWQgc291cmNlIHByZXZpZXcgaGVhZGVycy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlBERiBleHBvcnQgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29kZVwiLCBcIkNvZGUgQmxvY2sgT25seVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvdXRwdXRcIiwgXCJPdXRwdXQgT25seVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9IHZhbHVlIGFzIFwiYm90aFwiIHwgXCJjb2RlXCIgfCBcIm91dHB1dFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQnVpbHRJblJ1bnRpbWVzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcInB5dGhvblwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQeXRob24gZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBQeXRob24uXCIsIFwicHl0aG9uRXhlY3V0YWJsZVwiKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiamF2YXNjcmlwdFwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJOb2RlIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgSmF2YVNjcmlwdCBleGVjdXRpb24uXCIsIFwibm9kZUV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwidHlwZXNjcmlwdFwiKSkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVHlwZVNjcmlwdCBydW5uZXIgbW9kZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlVzZSB0cy1ub2RlIG9yIHRzeCBmb3IgVHlwZVNjcmlwdCBibG9ja3MuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cy1ub2RlXCIsIFwidHMtbm9kZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRzeFwiLCBcInRzeFwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID0gdmFsdWUgYXMgXCJ0cy1ub2RlXCIgfCBcInRzeFwiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJUeXBlU2NyaXB0IHRyYW5zcGlsZXIgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgdHMtbm9kZSBvciB0c3guXCIsIFwidHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcIm9jYW1sXCIpKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJPQ2FtbCBtb2RlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbGNcIiwgXCJvY2FtbGNcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkdW5lXCIsIFwiZHVuZVwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUgPSB2YWx1ZSBhcyBcIm9jYW1sXCIgfCBcIm9jYW1sY1wiIHwgXCJkdW5lXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk9DYW1sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIG9jYW1sLCBvY2FtbGMsIG9yIGR1bmUgZGVwZW5kaW5nIG9uIHRoZSBzZWxlY3RlZCBtb2RlLlwiLCBcIm9jYW1sRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY1wiXSwgXCJDIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQyBibG9ja3MuXCIsIFwiY0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNwcFwiXSwgXCJDKysgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDKysgYmxvY2tzLlwiLCBcImNwcEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInNoZWxsXCJdLCBcIlNoZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNoZWxsLCBCYXNoLCBhbmQgc2ggYmxvY2tzLlwiLCBcInNoZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicnVieVwiXSwgXCJSdWJ5IGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFJ1YnkgYmxvY2tzLlwiLCBcInJ1YnlFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJwZXJsXCJdLCBcIlBlcmwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUGVybCBibG9ja3MuXCIsIFwicGVybEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImx1YVwiXSwgXCJMdWEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgTHVhIGJsb2Nrcy5cIiwgXCJsdWFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJwaHBcIl0sIFwiUEhQIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBIUCBibG9ja3MuXCIsIFwicGhwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiZ29cIl0sIFwiR28gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgR28gYmxvY2tzLlwiLCBcImdvRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicnVzdFwiXSwgXCJSdXN0IGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgUnVzdCBibG9ja3MuXCIsIFwicnVzdEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImhhc2tlbGxcIl0sIFwiSGFza2VsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBIYXNrZWxsIGJsb2Nrcy4gRGVmYXVsdHMgdG8gcnVuZ2hjLlwiLCBcImhhc2tlbGxFeGVjdXRhYmxlXCIpO1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImphdmFcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIGNvbXBpbGVkIEphdmEgYmxvY2tzLlwiLCBcImphdmFFeGVjdXRhYmxlXCIpO1xuICAgIH1cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibGx2bS1pclwiXSwgXCJMTFZNIElSIGludGVycHJldGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIExMVk0gSVIgYmxvY2tzIHdpdGggbGxpLlwiLCBcImxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGVcIik7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiZWJwZi1jXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgY2xhbmcgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2xhbmcgd2l0aCBCUEYgdGFyZ2V0IHN1cHBvcnQuXCIsIFwiZWJwZkNsYW5nRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBicGZ0b29sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGJwZnRvb2wgdmVyaWZpZXIgYW5kIGxvYWQgb3BlcmF0aW9ucy5cIiwgXCJlYnBmQnBmdG9vbEV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgb2JqZWN0IGluc3BlY3RvclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgbGx2bS1vYmpkdW1wLiBMZWF2ZSBlbXB0eSB0byBza2lwIG9iamVjdCBzZWN0aW9uIGluc3BlY3Rpb24uXCIsIFwiZWJwZkxsdm1PYmpkdW1wRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBpbmNsdWRlIHBhdGhzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGluY2x1ZGUgZGlyZWN0b3JpZXMgcGFzc2VkIHRvIGNsYW5nIHdpdGggLUkuXCIsIFwiZWJwZkluY2x1ZGVQYXRoc1wiKTtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFsbG93IGVCUEYga2VybmVsIGxvYWRcIilcbiAgICAgICAgLnNldERlc2MoXCJSZXF1aXJlZCBiZWZvcmUgYW55IGJsb2NrIGNhbiB1c2UgbG9vbS1lYnBmLW1vZGU9bG9hZC4gQ29tcGlsZS1vbmx5IG1vZGUgc3RheXMgYXZhaWxhYmxlIHdpdGhvdXQgdGhpcy5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH1cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiYnBmdHJhY2VcIl0sIFwiYnBmdHJhY2UgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgYnBmdHJhY2Ugc2NyaXB0cy5cIiwgXCJicGZ0cmFjZUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImxlYW5cIl0sIFwiTGVhbiBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBMZWFuIGJsb2Nrcy5cIiwgXCJsZWFuRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY29xXCJdLCBcIkNvcSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBDb3EgYmxvY2tzIHdpdGggY29xYy5cIiwgXCJjb3FFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJzbXRsaWJcIl0sIFwiU01UIHNvbHZlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU01ULUxJQiBibG9ja3MuIERlZmF1bHRzIHRvIHozLlwiLCBcInNtdEV4ZWN1dGFibGVcIik7XG4gIH1cblxuICBwcml2YXRlIGFkZFJ1bnRpbWVUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIGxhbmd1YWdlSWRzOiBzdHJpbmdbXSwgbmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IEspOiB2b2lkIHtcbiAgICBpZiAobGFuZ3VhZ2VJZHMuc29tZSgobGFuZ3VhZ2VJZCkgPT4gdGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZCkpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBuYW1lLCBkZXNjcmlwdGlvbiwga2V5KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaXNMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZCwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTGFuZ3VhZ2VQYWNrYWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24odGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcblxuICAgIGZvciAoY29uc3QgcGFjayBvZiBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUykge1xuICAgICAgY29uc3QgcGFja0VsID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtcGFja2FnZVwiIH0pO1xuICAgICAgcGFja0VsLm9wZW4gPSB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCk7XG4gICAgICBwYWNrRWwuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogcGFjay5kaXNwbGF5TmFtZSB9KTtcbiAgICAgIHBhY2tFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBwYWNrLmRlc2NyaXB0aW9uLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKHBhY2tFbClcbiAgICAgICAgLnNldE5hbWUoXCJFbmFibGUgcGFja2FnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRpc2FibGUgdGhpcyB0byByZW1vdmUgdGhlIHBhY2thZ2UgbGFuZ3VhZ2VzIGZyb20gcGFyc2luZywgY29tbWFuZCBtZW51cywgYW5kIHJ1bm5lcnMgZm9yIHRoaXMgdmF1bHQuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcywgcGFjay5pZCwgdmFsdWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBwYWNrYWdlRW5hYmxlZCA9IHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKTtcbiAgICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2YgcGFjay5sYW5ndWFnZXMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcocGFja0VsKVxuICAgICAgICAgIC5zZXROYW1lKGxhbmd1YWdlLmRpc3BsYXlOYW1lKVxuICAgICAgICAgIC5zZXREZXNjKGBBbGlhc2VzOiAke2xhbmd1YWdlLmFsaWFzZXMuam9pbihcIiwgXCIpfWApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZCghcGFja2FnZUVuYWJsZWQpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShwYWNrYWdlRW5hYmxlZCAmJiB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5pbmNsdWRlcyhsYW5ndWFnZS5pZCkpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkN1c3RvbSBsYW5ndWFnZXNcIilcbiAgICAgIC5zZXREZXNjKFwiRW5hYmxlIHVzZXItZGVmaW5lZCBsYW5ndWFnZXMgZnJvbSB0aGUgQ3VzdG9tIExhbmd1YWdlcyBzZWN0aW9uLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lEKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCwgdmFsdWUpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJlc2V0IGxhbmd1YWdlIHBhY2thZ2VzXCIpXG4gICAgICAuc2V0RGVzYyhcIlJlLWVuYWJsZSBldmVyeSBidWlsdC1pbiBwYWNrYWdlIGFuZCBldmVyeSBidWlsdC1pbiBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJSZXNldFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MgPSBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCk7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMgPSBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0RW5hYmxlZFZhbHVlKHZhbHVlczogc3RyaW5nW10sIGlkOiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBjb25zdCBpbmRleCA9IHZhbHVlcy5pbmRleE9mKGlkKTtcbiAgICBpZiAoZW5hYmxlZCAmJiBpbmRleCA8IDApIHtcbiAgICAgIHZhbHVlcy5wdXNoKGlkKTtcbiAgICB9IGVsc2UgaWYgKCFlbmFibGVkICYmIGluZGV4ID49IDApIHtcbiAgICAgIHZhbHVlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1saXN0XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QobGlzdEVsKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBZGQgY3VzdG9tIGxhbmd1YWdlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBsb2NhbCBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBcImN1c3RvbS1sYW5ndWFnZVwiLFxuICAgICAgICAgICAgYWxpYXNlczogXCJcIixcbiAgICAgICAgICAgIGV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBhcmdzOiBcIntmaWxlfVwiLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi50eHRcIixcbiAgICAgICAgICAgIGV4dHJhY3Rvck1vZGU6IFwiY29tbWFuZFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yRXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGV4dHJhY3RvckFyZ3M6IFwie3JlcXVlc3R9XCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgdHJhbnNwaWxlQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBpZiAoIXRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIGN1c3RvbSBsYW5ndWFnZXMgY29uZmlndXJlZC5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5mb3JFYWNoKChsYW5ndWFnZSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2VcIiB9KTtcbiAgICAgIGRldGFpbHMub3BlbiA9IHRydWU7XG4gICAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGxhbmd1YWdlLm5hbWUgfHwgYEN1c3RvbSBsYW5ndWFnZSAke2luZGV4ICsgMX1gIH0pO1xuICAgICAgY29uc3QgYm9keSA9IGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWJvZHlcIiB9KTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIk5hbWVcIiwgXCJOb3JtYWxpemVkIGxhbmd1YWdlIGlkIHVzZWQgYnkgbG9vbS5cIiwgXCJuYW1lXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFsaWFzZXNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgZmVuY2UgYWxpYXNlcy5cIiwgXCJhbGlhc2VzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4ZWN1dGFibGVcIiwgXCJMb2NhbCBjb21tYW5kIG9yIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aC5cIiwgXCJleGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFyZ3VtZW50c1wiLCBcIlNwYWNlLXNlcGFyYXRlZCBhcmd1bWVudHMuIFVzZSB7ZmlsZX0gZm9yIHRoZSB0ZW1wIHNvdXJjZSBmaWxlLlwiLCBcImFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0ZW5zaW9uXCIsIFwiVGVtcCBzb3VyY2UgZmlsZSBleHRlbnNpb24sIGZvciBleGFtcGxlIC5weS5cIiwgXCJleHRlbnNpb25cIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiUGFydGlhbCBleHRyYWN0aW9uIHN0cmF0ZWd5XCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyB0aGlzIGN1c3RvbSBsYW5ndWFnZSBzdXBwb3J0cyBwYXJ0aWFsIHJ1bm5hYmxlIHNvdXJjZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImNvbW1hbmRcIiwgXCJFeHRyYWN0b3IgY29tbWFuZFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRyYW5zcGlsZS1jXCIsIFwiVHJhbnNwaWxlIHRvIENcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBsYW5ndWFnZS5leHRyYWN0b3JNb2RlID0gdmFsdWUgYXMgXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGV4ZWN1dGFibGVcIiwgXCJPcHRpb25hbCBjb21tYW5kIGZvciBwYXJ0aWFsIHNvdXJjZSBleHRyYWN0aW9uLiBMZWF2ZSBlbXB0eSB0byB1c2UgZ2VuZXJpYyBsaW5lIGFuZCBzeW1ib2wgZXh0cmFjdGlvbi5cIiwgXCJleHRyYWN0b3JFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dHJhY3RvciBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSBleHRyYWN0b3IuIFVzZSB7cmVxdWVzdH0sIHtzb3VyY2V9LCB7aGFybmVzc30sIHtzeW1ib2x9LCB7bGluZVN0YXJ0fSwge2xpbmVFbmR9LCB7ZGVwc30sIGFuZCB7bGFuZ3VhZ2V9LlwiLCBcImV4dHJhY3RvckFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiVHJhbnNwaWxlIHRvIEMgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgdGhhdCBlbWl0cyBnZW5lcmF0ZWQgQyBhbmQgYSBzeW1ib2wgbWFwIGFzIEpTT04uXCIsIFwidHJhbnNwaWxlRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSB0cmFuc3BpbGVyLiBVc2UgdGhlIHNhbWUgcGxhY2Vob2xkZXJzIGFzIGV4dHJhY3RvciBhcmd1bWVudHMuXCIsIFwidHJhbnNwaWxlQXJnc1wiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdmUgdGhpcyBjdXN0b20gbGFuZ3VhZ2UuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmxvb21QbHVnaW4uZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVGhlIGNvbnRhaW5lciBncm91cCB0byBydW4gY29kZSBibG9ja3MgaW4gYnkgZGVmYXVsdCBpZiB0aGUgbm90ZSBkb2VzIG5vdCBzcGVjaWZ5IG9uZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcIlwiLCBcIk5vbmVcIik7XG4gICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihncm91cC5uYW1lLCBncm91cC5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCB8fCBcIlwiKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFkZCBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwIGNvbmZpZ3VyYXRpb24gZm9sZGVyLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgbmV3IENvbnRhaW5lckdyb3VwTmFtZU1vZGFsKHRoaXMuYXBwLCBhc3luYyAoZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGNsZWFuTmFtZSA9IGdyb3VwTmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8tXS9nLCBcIi1cIik7XG4gICAgICAgICAgICAgIGlmICghY2xlYW5OYW1lKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgZ3JvdXAgbmFtZS5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgY29uc3QgZ3JvdXBSZWxhdGl2ZVBhdGggPSBgJHtwbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHtjbGVhbk5hbWV9YDtcbiAgICAgICAgICAgICAgY29uc3QgY29uZmlnUGF0aCA9IGAke2dyb3VwUmVsYXRpdmVQYXRofS9jb25maWcuanNvbmA7XG5cbiAgICAgICAgICAgICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgICAgICAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhncm91cFJlbGF0aXZlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGZvbGRlciBhbHJlYWR5IGV4aXN0cy5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci5ta2Rpcihncm91cFJlbGF0aXZlUGF0aCk7XG4gICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcnVudGltZTogXCJkb2NrZXJcIixcbiAgICAgICAgICAgICAgICBpbWFnZTogXCJ1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2VzOiB7XG4gICAgICAgICAgICAgICAgICBweXRob246IHtcbiAgICAgICAgICAgICAgICAgICAgY29tbWFuZDogXCJweXRob24zIHtmaWxlfVwiLFxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCJcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGVmYXVsdENvbmZpZywgbnVsbCwgMikpO1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKGBDb250YWluZXIgZ3JvdXAgXCIke2NsZWFuTmFtZX1cIiBjcmVhdGVkLmApO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY29udGFpbmVyLWdyb3VwLWxpc3RcIiB9KTtcbiAgICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xuICAgICAgICBsaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgICB0ZXh0OiBcIk5vIGNvbnRhaW5lciBncm91cHMgZm91bmQgaW4gLm9ic2lkaWFuL3BsdWdpbnMvbG9vbS9jb250YWluZXJzLlwiLFxuICAgICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxuICAgICAgICAgIC5zZXROYW1lKGdyb3VwLm5hbWUpXG4gICAgICAgICAgLnNldERlc2MoZ3JvdXAuc3RhdHVzKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQnVpbGQgLyByZWJ1aWxkXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uYnVpbGRDb250YWluZXJHcm91cChncm91cC5uYW1lKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkVkaXRcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIG5ldyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCh0aGlzLmxvb21QbHVnaW4sIGdyb3VwLm5hbWUsIHBsdWdpbkRpciwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYEVycm9yIGxvYWRpbmcgY29udGFpbmVyIGdyb3VwczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgY2xzOiBcImxvb20tc2V0dGluZ3MtZXJyb3JcIixcbiAgICAgICAgYXR0cjogeyBzdHlsZTogXCJjb2xvcjogdmFyKC0tdGV4dC1lcnJvcik7IGZvbnQtd2VpZ2h0OiBib2xkOyBtYXJnaW46IDFlbSAwO1wiIH1cbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5lcnJvcihcImxvb206IGZhaWxlZCB0byByZW5kZXIgY29udGFpbmVyIGdyb3VwczpcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gYXMgc3RyaW5nKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbUN1c3RvbUxhbmd1YWdlPihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICBrZXk6IEssXG4gICk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKGxhbmd1YWdlW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIChsYW5ndWFnZVtrZXldIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShcImxvb20gbG9jYWwgZXhlY3V0aW9uIGlzIGRpc2FibGVkLiBFbmFibGUgaXQgaW4gc2V0dGluZ3Mgb3IgY29uZmlybSB0aGUgZXhlY3V0aW9uIHdhcm5pbmcgZmlyc3QuXCIpO1xufVxuXG5jbGFzcyBDb250YWluZXJHcm91cE5hbWVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBuYW1lID0gXCJcIjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU3VibWl0OiAobmFtZTogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJOZXcgQ29udGFpbmVyIEdyb3VwIE5hbWVcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiR3JvdXAgTmFtZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgbG93ZXJjYXNlIGxldHRlcnMsIG51bWJlcnMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3Jlcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubmFtZSA9IHZhbHVlO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5vblN1Ym1pdCh0aGlzLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5jbGFzcyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBhY3RpdmVUYWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIiA9IFwiZ2VuZXJhbFwiO1xuICBwcml2YXRlIGNvbmZpZ09iajogYW55ID0ge307XG4gIHByaXZhdGUgcmF3SnNvblRleHQgPSBcIlwiO1xuICBwcml2YXRlIGRvY2tlcmZpbGVUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICBwcml2YXRlIHRhYkhlYWRlckVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgdGFiQ29udGVudEVsITogSFRNTEVsZW1lbnQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU2F2ZTogKCkgPT4gdm9pZFxuICApIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBgRWRpdCBDb25maWc6ICR7dGhpcy5ncm91cE5hbWV9YCB9KTtcblxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByYXdDb25maWcgPSBhd2FpdCBhZGFwdGVyLnJlYWQoY29uZmlnUGF0aCk7XG4gICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UocmF3Q29uZmlnKTtcbiAgICAgIHRoaXMucmF3SnNvblRleHQgPSByYXdDb25maWc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbmV3IE5vdGljZShcIkNvdWxkIG5vdCByZWFkIGNvbmZpZ3VyYXRpb24gZmlsZS5cIik7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhkb2NrZXJmaWxlUGF0aCkpIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IGF3YWl0IGFkYXB0ZXIucmVhZChkb2NrZXJmaWxlUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBjb250YWluZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBIZWFkZXJcbiAgICB0aGlzLnRhYkhlYWRlckVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1oZWFkZXJcIiB9KTtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcblxuICAgIC8vIFJlbmRlciBUYWIgQ29udGVudCBBcmVhXG4gICAgdGhpcy50YWJDb250ZW50RWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRlbnRcIiB9KTtcblxuICAgIC8vIFJlbmRlciBBY3Rpb25zIEZvb3RlclxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IHNhdmVCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJTYXZlXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG4gICAgc2F2ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlQW5kQ2xvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJUYWJzKCkge1xuICAgIHRoaXMudGFiSGVhZGVyRWwuZW1wdHkoKTtcbiAgICBjb25zdCB0YWJzOiBBcnJheTx7IGlkOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gICAgICB7IGlkOiBcImdlbmVyYWxcIiwgbGFiZWw6IFwiR2VuZXJhbFwiIH0sXG4gICAgICB7IGlkOiBcImxhbmd1YWdlc1wiLCBsYWJlbDogXCJMYW5ndWFnZXNcIiB9LFxuICAgICAgeyBpZDogXCJkb2NrZXJmaWxlXCIsIGxhYmVsOiBcIkRvY2tlcmZpbGVcIiB9LFxuICAgICAgeyBpZDogXCJyYXdcIiwgbGFiZWw6IFwiUmF3IEpTT05cIiB9LFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHRhYiBvZiB0YWJzKSB7XG4gICAgICBjb25zdCBidG4gPSB0aGlzLnRhYkhlYWRlckVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgICAgdGV4dDogdGFiLmxhYmVsLFxuICAgICAgICBjbHM6IFwibG9vbS10YWItYnRuXCIgKyAodGhpcy5hY3RpdmVUYWIgPT09IHRhYi5pZCA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIiksXG4gICAgICB9KTtcbiAgICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuc3dpdGNoVGFiKHRhYi5pZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzd2l0Y2hUYWIodGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIpIHtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzd2l0Y2hpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWN0aXZlVGFiID0gdGFiO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJBY3RpdmVUYWIoKSB7XG4gICAgdGhpcy50YWJDb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZ2VuZXJhbFwiKSB7XG4gICAgICB0aGlzLnJlbmRlckdlbmVyYWxUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwibGFuZ3VhZ2VzXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VzVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImRvY2tlcmZpbGVcIikge1xuICAgICAgdGhpcy5yZW5kZXJEb2NrZXJmaWxlVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0aGlzLnJlbmRlclJhd1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyR2VuZXJhbFRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICAvLyBSdW50aW1lIHNlbGVjdCBkcm9wZG93blxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJSdW50aW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB0aGUgY29udGFpbmVyL2Vudmlyb25tZW50IG1hbmFnZXIgcnVudGltZS5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZG9ja2VyXCIsIFwiRG9ja2VyXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInBvZG1hblwiLCBcIlBvZG1hblwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ3c2xcIiwgXCJXU0xcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicWVtdVwiLCBcIlFFTVVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY3VzdG9tXCIsIFwiQ3VzdG9tXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgfHwgXCJkb2NrZXJcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAvLyBDb25kaXRpb25hbCBpbWFnZS9kaXN0cm8gbmFtZVxuICAgIGlmIChcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICApIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiID8gXCJXU0wgRGlzdHJvXCIgOiBcIkJhc2UgSW1hZ2VcIilcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICAgICAgICAgPyBcIk9wdGlvbmFsLiBUaGUgdGFyZ2V0IFdTTCBkaXN0cm8gbmFtZSAobGVhdmUgZW1wdHkgZm9yIGRlZmF1bHQgZGlzdHJvKS5cIlxuICAgICAgICAgICAgOiBcIkZhbGxiYWNrIERvY2tlci9Qb2RtYW4gaW1hZ2UgaWYgbm8gRG9ja2VyZmlsZSBpcyBwcmVzZW50LlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouaW1hZ2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmltYWdlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai53c2wpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoud3NsID0ge307XG4gICAgICB9XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJVc2UgSW50ZXJhY3RpdmUgU2hlbGxcIilcbiAgICAgICAgLnNldERlc2MoXCJVc2UgaW50ZXJhY3RpdmUgbG9naW4gc2hlbGwgZmxhZ3MgKC1pIC1sKSB0byBlbnN1cmUgfi8uYmFzaHJjIGluaXRpYWxpemF0aW9uIHdvcmtzIChlLmcuLCBmb3IgTlZNKS5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID8/IGZhbHNlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID0gdmFsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIFFFTVUgU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoucWVtdSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11ID0geyBzc2hUYXJnZXQ6IFwiXCIsIHJlbW90ZVdvcmtzcGFjZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggVGFyZ2V0XCIpXG4gICAgICAgIC5zZXREZXNjKFwiU1NIIHRhcmdldCBhZGRyZXNzIChlLmcuIHVzZXJAaG9zdG5hbWUgb3IgbG9jYWxob3N0IC1wIDIyMjIpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJSZW1vdGUgV29ya3NwYWNlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3RlIGZvbGRlciBwYXRoIHRvIGNvcHkgY29kZSBzbmlwcGV0cyBhbmQgcnVuIGNvbW1hbmRzIChlLmcuLCAvaG9tZS91c2VyL3dvcmtzcGFjZSkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIFBhdGggdG8gU1NIIGNsaWVudCBleGVjdXRhYmxlIChkZWZhdWx0cyB0byBzc2gpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEFkZGl0aW9uYWwgU1NIIENMSSBmbGFncy5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBDdXN0b20gU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5jdXN0b20pIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tID0geyBleGVjdXRhYmxlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUGF0aCB0byBjdXN0b20gcnVudGltZSB3cmFwcGVyIGV4ZWN1dGFibGUgb3Igc2NyaXB0LlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIENvbW1hbmQgYXJndW1lbnRzLiBVc2Uge3JlcXVlc3R9IGZvciBKU09OIGNvbmZpZyBwYXRoLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJMYW5ndWFnZXNUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQ29uZmlndXJlZCBMYW5ndWFnZXNcIiB9KTtcblxuICAgIGlmICghdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzKSB7XG4gICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgPSB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5nc0xpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlcy1saXN0XCIgfSk7XG4gICAgY29uc3QgbGFuZ3VhZ2VzID0gT2JqZWN0LmVudHJpZXModGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHsgY29tbWFuZD86IHN0cmluZzsgZXh0ZW5zaW9uPzogc3RyaW5nOyB1c2VEZWZhdWx0PzogYm9vbGVhbiB9Pik7XG5cbiAgICBpZiAobGFuZ3VhZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbGFuZ3NMaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJObyBsYW5ndWFnZXMgY29uZmlndXJlZCBmb3IgdGhpcyBncm91cC5cIiwgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IFtsYW5nTmFtZSwgbGFuZ0NvbmZpZ10gb2YgbGFuZ3VhZ2VzKSB7XG4gICAgICAgIGNvbnN0IGNhcmQgPSBsYW5nc0xpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZS1jYXJkXCIgfSk7XG4gICAgICAgIGNhcmQuY3JlYXRlRWwoXCJzdHJvbmdcIiwgeyB0ZXh0OiBsYW5nTmFtZSwgYXR0cjogeyBzdHlsZTogXCJkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogMC41cmVtOyBmb250LXNpemU6IDEuMWVtO1wiIH0gfSk7XG5cbiAgICAgICAgY29uc3QgaXNEZWZhdWx0ID0gKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJVc2UgZGVmYXVsdCBjb25maWd1cmF0aW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJJZiBjaGVja2VkLCBMb29tIHdpbGwgcnVuIHRoaXMgbGFuZ3VhZ2UgdXNpbmcgaXRzIGJ1aWx0LWluIGNvbW1hbmRzL2V4dGVuc2lvbnMuXCIpXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodmFsKSB7XG4gICAgICAgICAgICAgICAgICAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuY29tbWFuZDtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmV4dGVuc2lvbjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdDtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSBkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSBkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJDb21tYW5kXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJFeGVjdXRpb24gY29tbWFuZC4gVXNlIHtmaWxlfSBmb3IgdGhlIGNvZGUgc25pcHBldCBmaWxlbmFtZS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiRXh0ZW5zaW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJTb3VyY2UgZmlsZSBleHRlbnNpb24gKGUuZy4gLnB5LCAuanMpLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgICBidG5cbiAgICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZW1vdmUgTGFuZ3VhZ2VcIilcbiAgICAgICAgICAgICAgLnNldFdhcm5pbmcoKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1tsYW5nTmFtZV07XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIExhbmd1YWdlIFNlY3Rpb25cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJBZGQgTGFuZ3VhZ2UgTWFwcGluZ1wiLCBhdHRyOiB7IHN0eWxlOiBcIm1hcmdpbi10b3A6IDEuNXJlbTtcIiB9IH0pO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJMYW5ndWFnZSBJRFwiKVxuICAgICAgLnNldERlc2MoXCJlLmcuIHB5dGhvbiwgamF2YXNjcmlwdCwgbm9kZSwgc2hcIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5uZXdMYW5ndWFnZU5hbWUpLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IHZhbC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiKyBBZGRcIikuc2V0Q3RhKCkub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLm5ld0xhbmd1YWdlTmFtZSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBlbnRlciBhIGxhbmd1YWdlIG5hbWUuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIkxhbmd1YWdlIGFscmVhZHkgY29uZmlndXJlZC5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0gPSB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX0ge2ZpbGV9YCxcbiAgICAgICAgICAgIGV4dGVuc2lvbjogYC4ke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfWAsXG4gICAgICAgICAgfTtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJlbmRlckRvY2tlcmZpbGVUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwiZG9ja2VyXCIgJiYgdGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJwb2RtYW5cIikge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYERvY2tlcmZpbGUgZWRpdGluZyBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgRG9ja2VyIGFuZCBQb2RtYW4gcnVudGltZXMuIEN1cnJlbnRseSB1c2luZzogJHt0aGlzLmNvbmZpZ09iai5ydW50aW1lfWAsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ID09PSBudWxsKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIERvY2tlcmZpbGUgZXhpc3RzIGluIHRoaXMgY29udGFpbmVyIGdyb3VwIGRpcmVjdG9yeS5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICBidG5cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlIERvY2tlcmZpbGVcIilcbiAgICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gW1xuICAgICAgICAgICAgICAgIFwiRlJPTSB1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgICBcIiMgSW5zdGFsbCBwYWNrYWdlc1wiLFxuICAgICAgICAgICAgICAgIFwiUlVOIGFwdC1nZXQgdXBkYXRlICYmIGFwdC1nZXQgaW5zdGFsbCAteSBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgcHl0aG9uMyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgbm9kZWpzIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICAmJiBybSAtcmYgL3Zhci9saWIvYXB0L2xpc3RzLypcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkRvY2tlcmZpbGUgQ29udGVudFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRlZmluZSB0aGUgYnVpbGQgc3RlcHMgZm9yIHlvdXIgZW52aXJvbm1lbnQgY29udGFpbmVyLlwiKVxuICAgICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMuZG9ja2VyZmlsZVRleHQgfHwgXCJcIik7XG4gICAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gdmFsO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJSYXdUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgdGhpcy5yYXdKc29uVGV4dCA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQ29uZmlndXJhdGlvbiBKU09OXCIpXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVBbmRDbG9zZSgpIHtcbiAgICAvLyBJZiB0aGUgYWN0aXZlIHRhYiBpcyByYXcgSlNPTiwgcGFyc2UgaXQgZmlyc3QgdG8gZW5zdXJlIHdlIGNhcHR1cmUgZWRpdHNcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzYXZpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQmFzaWMgVmFsaWRhdGlvblxuICAgIGlmICghdGhpcy5jb25maWdPYmoucnVudGltZSkge1xuICAgICAgbmV3IE5vdGljZShcIlJ1bnRpbWUgaXMgcmVxdWlyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIgJiYgKCF0aGlzLmNvbmZpZ09iai5xZW11Py5zc2hUYXJnZXQgfHwgIXRoaXMuY29uZmlnT2JqLnFlbXU/LnJlbW90ZVdvcmtzcGFjZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgU1NIIFRhcmdldCBhbmQgUmVtb3RlIFdvcmtzcGFjZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiICYmICF0aGlzLmNvbmZpZ09iai5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBDdXN0b20gRXhlY3V0YWJsZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNhdmUgY29uZmlnLmpzb25cbiAgICAgIGNvbnN0IGNvbmZpZ1N0ciA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgY29uZmlnU3RyKTtcblxuICAgICAgLy8gU2F2ZSBEb2NrZXJmaWxlXG4gICAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiKSB7XG4gICAgICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ICE9PSBudWxsKSB7XG4gICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShkb2NrZXJmaWxlUGF0aCwgdGhpcy5kb2NrZXJmaWxlVGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBjb25maWd1cmF0aW9ucyBzYXZlZC5cIik7XG4gICAgICB0aGlzLm9uU2F2ZSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBuZXcgTm90aWNlKGBTYXZlIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuICB9XG59XG4iLCAiaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB0eXBlIHsgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuXG5pbnRlcmZhY2UgU291cmNlUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNvdXJjZURlZmluaXRpb24gZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbmFtZXM/OiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkFsaWFzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBhc25hbWU6IHN0cmluZyB8IG51bGw7XG59XG5cbmludGVyZmFjZSBQeXRob25JbXBvcnQgZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIGtpbmQ6IFwiaW1wb3J0XCIgfCBcImZyb21cIjtcbiAgbW9kdWxlOiBzdHJpbmc7XG4gIGxldmVsOiBudW1iZXI7XG4gIG5hbWVzOiBQeXRob25BbGlhc1tdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uTW9kdWxlSW5mbyB7XG4gIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW107XG4gIGltcG9ydHM6IFB5dGhvbkltcG9ydFtdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uVXNhZ2Uge1xuICBuYW1lczogc3RyaW5nW107XG4gIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSB7XG4gIHJlYWRvbmx5IGluY2x1ZGVkUmFuZ2VzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgaW5jbHVkZWRJbXBvcnRzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgYWxpYXNlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IG5hbWVzcGFjZUJpbmRpbmdzOiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gIHJlYWRvbmx5IHZpc2l0aW5nU3ltYm9sczogU2V0PHN0cmluZz47XG4gIG5lZWRzTmFtZXNwYWNlUnVudGltZTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tU291cmNlRXh0cmFjdGlvbkhvc3Qge1xuICBweXRob25FeGVjdXRhYmxlPzogc3RyaW5nO1xuICBleHRlcm5hbEV4dHJhY3Rvcj86IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcjtcbiAgcmVhZEZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG4gIHJlc29sdmVQeXRob25JbXBvcnQoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yIHtcbiAgbW9kZTogXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gIGxhbmd1YWdlOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIGNvbnRlbnQ/OiBzdHJpbmc7XG4gIHNlbGVjdGVkPzogc3RyaW5nO1xuICBkZXBlbmRlbmNpZXM/OiBzdHJpbmdbXTtcbiAgaW1wb3J0cz86IHN0cmluZ1tdO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFRyYW5zcGlsZVRvQ1Jlc3VsdCB7XG4gIGdlbmVyYXRlZFNvdXJjZTogc3RyaW5nO1xuICBzeW1ib2xzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgaGFybmVzcz86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBcImNcIiB8IFwiY3BwXCI7XG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnRlbnQ6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0PzogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgaWYgKGhvc3Q/LmV4dGVybmFsRXh0cmFjdG9yPy5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgIHJldHVybiBob3N0LmV4dGVybmFsRXh0cmFjdG9yLm1vZGUgPT09IFwidHJhbnNwaWxlLWNcIlxuICAgICAgPyByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MsIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IpXG4gICAgICA6IHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKTtcbiAgfVxuXG4gIGlmIChsYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBob3N0KSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25SZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBoYXJuZXNzLCBob3N0KTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcyk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2soXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4pOiBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRTeW1ib2xSYW5nZShsaW5lcywgbGFuZ3VhZ2UsIHJlZmVyZW5jZS5zeW1ib2xOYW1lKVxuICAgIDogZmluZExpbmVSYW5nZShsaW5lcywgcmVmZXJlbmNlKTtcblxuICBpZiAoIXNlbGVjdGVkUmFuZ2UpIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IGBzeW1ib2wgJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gIDogXCJsaW5lIHJhbmdlXCI7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZXh0cmFjdCAke3RhcmdldH0gZnJvbSAke3JlZmVyZW5jZS5maWxlUGF0aH0uYCk7XG4gIH1cblxuICBjb25zdCBzZWxlY3RlZCA9IHJlbmRlclJhbmdlKGxpbmVzLCBzZWxlY3RlZFJhbmdlKTtcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzXG4gICAgPyBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkKVxuICAgIDogXCJcIjtcbiAgY29uc3QgY29udGVudCA9IFtkZXBlbmRlbmNpZXMsIHNlbGVjdGVkLCBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udGVudCxcbiAgICBkZXNjcmlwdGlvbjogZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBzZWxlY3RlZFJhbmdlKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUV4dGVybmFsUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBjb250ZW50ID0gcmVzdWx0LmNvbnRlbnQgPz8gW1xuICAgICAgLi4uKHJlc3VsdC5pbXBvcnRzID8/IFtdKSxcbiAgICAgIC4uLihyZXN1bHQuZGVwZW5kZW5jaWVzID8/IFtdKSxcbiAgICAgIHJlc3VsdC5zZWxlY3RlZCA/PyBcIlwiLFxuICAgICAgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIixcbiAgICBdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICBpZiAoIWNvbnRlbnQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBubyBjb250ZW50LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIG51bGwpLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVUcmFuc3BpbGVUb0NSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3Rvcixcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1leHRyYWN0LVwiKSk7XG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBqb2luKHRlbXBEaXIsIFwic291cmNlLnR4dFwiKTtcbiAgY29uc3QgaGFybmVzc0ZpbGUgPSBqb2luKHRlbXBEaXIsIFwiaGFybmVzcy50eHRcIik7XG4gIGNvbnN0IHJlcXVlc3RGaWxlID0gam9pbih0ZW1wRGlyLCBcInJlcXVlc3QuanNvblwiKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiByZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiByZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiByZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHRhcmdldExhbmd1YWdlOiBcImNcIixcbiAgICB9O1xuICAgIGF3YWl0IHdyaXRlRmlsZShzb3VyY2VGaWxlLCBzb3VyY2UsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoaGFybmVzc0ZpbGUsIGhhcm5lc3MsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdEZpbGUsIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpLCBcInV0ZjhcIik7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5FeHRlcm5hbEV4dHJhY3RvcihleHRyYWN0b3IsIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgcmVxdWVzdEZpbGUsXG4gICAgICByZWZlcmVuY2UsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBnZW5lcmF0ZWRMYW5ndWFnZSA9IHJlc3VsdC5sYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIjtcbiAgICBjb25zdCBtYXBwZWRTeW1ib2wgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IHJlc3VsdC5zeW1ib2xzPy5bcmVmZXJlbmNlLnN5bWJvbE5hbWVdID8/IHJlZmVyZW5jZS5zeW1ib2xOYW1lIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGdlbmVyYXRlZFJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSA9IHtcbiAgICAgIC4uLnJlZmVyZW5jZSxcbiAgICAgIGZpbGVQYXRoOiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9OmdlbmVyYXRlZC4ke2dlbmVyYXRlZExhbmd1YWdlID09PSBcImNwcFwiID8gXCJjcHBcIiA6IFwiY1wifWAsXG4gICAgICBzeW1ib2xOYW1lOiBtYXBwZWRTeW1ib2wsXG4gICAgfTtcbiAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2socmVzdWx0LmdlbmVyYXRlZFNvdXJjZSwgZ2VuZXJhdGVkUmVmZXJlbmNlLCBnZW5lcmF0ZWRMYW5ndWFnZSwgcmVzdWx0Lmhhcm5lc3MgPz8gaGFybmVzcyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJnZW5lcmF0ZWQtY1wifWAsXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuRXh0ZXJuYWxFeHRyYWN0b3IoXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuICB2YWx1ZXM6IHtcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIHNvdXJjZUZpbGU6IHN0cmluZztcbiAgICBoYXJuZXNzRmlsZTogc3RyaW5nO1xuICAgIHJlcXVlc3RGaWxlOiBzdHJpbmc7XG4gICAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlO1xuICB9LFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYXJncyA9IGV4dHJhY3Rvci5hcmdzLm1hcCgoYXJnKSA9PiBhcmdcbiAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCB2YWx1ZXMucmVxdWVzdEZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c291cmNlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntmaWxlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntoYXJuZXNzfVwiLCB2YWx1ZXMuaGFybmVzc0ZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c3ltYm9sfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJcIilcbiAgICAucmVwbGFjZUFsbChcIntsaW5lU3RhcnR9XCIsIHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0KSlcbiAgICAucmVwbGFjZUFsbChcIntsaW5lRW5kfVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kKSlcbiAgICAucmVwbGFjZUFsbChcIntkZXBzfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzID8gXCJ0cnVlXCIgOiBcImZhbHNlXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGFuZ3VhZ2V9XCIsIHZhbHVlcy5sYW5ndWFnZSkpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleHRyYWN0b3IuZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgY3dkOiBleHRyYWN0b3Iud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0sXG4gICAgfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciB0aW1lZCBvdXQgYWZ0ZXIgJHtleHRyYWN0b3IudGltZW91dE1zfSBtcy5gKSk7XG4gICAgfSwgZXh0cmFjdG9yLnRpbWVvdXRNcyk7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKChzdGRlcnIgfHwgc3Rkb3V0IHx8IGBDdXN0b20gc291cmNlIGV4dHJhY3RvciBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0uYCkudHJpbSgpKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJlc29sdmUoc3Rkb3V0KTtcbiAgICB9KTtcblxuICAgIGNoaWxkLnN0ZGluLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICByZXF1ZXN0RmlsZTogdmFsdWVzLnJlcXVlc3RGaWxlLFxuICAgICAgc291cmNlRmlsZTogdmFsdWVzLnNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZTogdmFsdWVzLmhhcm5lc3NGaWxlLFxuICAgICAgbGFuZ3VhZ2U6IHZhbHVlcy5sYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiB2YWx1ZXMucmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShvdXRwdXQpIGFzIEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciBtdXN0IHJldHVybiBhIEpTT04gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBUcmFuc3BpbGVUb0NSZXN1bHQ7XG4gICAgaWYgKHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgcGFyc2VkID09IG51bGwgfHwgdHlwZW9mIHBhcnNlZC5nZW5lcmF0ZWRTb3VyY2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGV4dHJhY3RvciBtdXN0IHJldHVybiBnZW5lcmF0ZWRTb3VyY2UuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLmxhbmd1YWdlICE9IG51bGwgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNcIiAmJiBwYXJzZWQubGFuZ3VhZ2UgIT09IFwiY3BwXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGxhbmd1YWdlIG11c3QgYmUgYyBvciBjcHAuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLnN5bWJvbHMgIT0gbnVsbCAmJiAodHlwZW9mIHBhcnNlZC5zeW1ib2xzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGFyc2VkLnN5bWJvbHMpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgc3ltYm9scyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgcmV0dXJuZWQgaW52YWxpZCBKU09OOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IHN0YXRlID0gY3JlYXRlUHl0aG9uRGVwZW5kZW5jeVN0YXRlKCk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UuZmlsZVBhdGgsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkLCBoYXJuZXNzLCBob3N0LCBzdGF0ZSlcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpOiBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZXR1cm4ge1xuICAgIGluY2x1ZGVkUmFuZ2VzOiBuZXcgU2V0KCksXG4gICAgaW5jbHVkZWRJbXBvcnRzOiBuZXcgU2V0KCksXG4gICAgYWxpYXNlczogbmV3IFNldCgpLFxuICAgIG5hbWVzcGFjZUJpbmRpbmdzOiBuZXcgTWFwKCksXG4gICAgdmlzaXRpbmdTeW1ib2xzOiBuZXcgU2V0KCksXG4gICAgbmVlZHNOYW1lc3BhY2VSdW50aW1lOiBmYWxzZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VsZWN0ZWQ6IHN0cmluZyxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBgJHtzZWxlY3RlZH1cXG4ke2hhcm5lc3N9YCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgY29uc3QgbmFtZXNwYWNlID0gcmVuZGVyUHl0aG9uTmFtZXNwYWNlQmluZGluZ3Moc3RhdGUpO1xuICByZXR1cm4gWy4uLnN0YXRlLmluY2x1ZGVkSW1wb3J0cywgLi4ucGFydHMsIG5hbWVzcGFjZV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhcbiAgc291cmNlOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzZWVkOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgbGV0IGhheXN0YWNrID0gc2VlZDtcbiAgbGV0IGNvbGxlY3RlZCA9IFwiXCI7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBjb25zdCB1c2FnZSA9IGF3YWl0IGluc3BlY3RQeXRob25Vc2FnZShoYXlzdGFjaywgaG9zdCk7XG5cbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgaWYgKHJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkgfHwgIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGV4dCA9IGFkZFB5dGhvblJhbmdlKGxpbmVzLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgdGV4dCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBpZiAobmVzdGVkKSB7XG4gICAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7bmVzdGVkfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29sbGVjdGVkICs9IGAke25lc3RlZH1cXG4ke3RleHR9XFxuYDtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBpbXBvcnROb2RlIG9mIG1vZHVsZUluZm8uaW1wb3J0cykge1xuICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBoYXlzdGFjayArPSBgXFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjb2xsZWN0ZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmIChpbXBvcnROb2RlLmtpbmQgPT09IFwiZnJvbVwiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICB9XG5cbiAgcmV0dXJuIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvbkZyb21JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgaW1wb3J0Tm9kZS5tb2R1bGUsIGltcG9ydE5vZGUubGV2ZWwpO1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGlmIChhbGlhcy5uYW1lID09PSBcIipcIikge1xuICAgICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgICAgaWYgKHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZSkgJiYgYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUobG9jYWxNb2R1bGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBtb2R1bGVJbmZvLmRlZmluaXRpb25zKSB7XG4gICAgICAgIGlmICghcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uLCB1c2FnZSkpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBkZWZpbml0aW9uLm5hbWUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHBvc2VkTmFtZSA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lO1xuICAgIGlmICghdXNhZ2UubmFtZXMuaW5jbHVkZXMoZXhwb3NlZE5hbWUpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJtb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBqb2luUHl0aG9uTW9kdWxlKGltcG9ydE5vZGUubW9kdWxlLCBhbGlhcy5uYW1lKSwgaW1wb3J0Tm9kZS5sZXZlbCk7XG4gICAgY29uc3QgaW1wb3J0VGFyZ2V0UGF0aCA9IGxvY2FsTW9kdWxlUGF0aCA/PyBzdWJtb2R1bGVQYXRoO1xuICAgIGlmICghaW1wb3J0VGFyZ2V0UGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RlZCA9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShpbXBvcnRUYXJnZXRQYXRoLCBhbGlhcy5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgIGFkZGVkICs9IGV4dHJhY3RlZDtcbiAgICAgIGlmIChhbGlhcy5hc25hbWUgJiYgYWxpYXMuYXNuYW1lICE9PSBhbGlhcy5uYW1lKSB7XG4gICAgICAgIGFkZGVkICs9IGFkZFB5dGhvbkFsaWFzKGFsaWFzLm5hbWUsIGFsaWFzLmFzbmFtZSwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZHVsZUJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBjb25zdCBtb2R1bGVBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1ttb2R1bGVCaW5kaW5nXSA/PyBbXTtcbiAgICBpZiAoc3VibW9kdWxlUGF0aCAmJiBtb2R1bGVBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgbW9kdWxlQXR0cmlidXRlcykge1xuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoc3VibW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKG1vZHVsZUJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblBsYWluSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGNvbnN0IGJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZS5zcGxpdChcIi5cIilbMF07XG4gICAgY29uc3QgdXNlZEF0dHJpYnV0ZXMgPSB1c2FnZS5hdHRyaWJ1dGVzW2JpbmRpbmddID8/IFtdO1xuICAgIGNvbnN0IGJpbmRpbmdJc1VzZWQgPSB1c2FnZS5uYW1lcy5pbmNsdWRlcyhiaW5kaW5nKSB8fCB1c2VkQXR0cmlidXRlcy5sZW5ndGggPiAwO1xuICAgIGlmICghYmluZGluZ0lzVXNlZCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxNb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBhbGlhcy5uYW1lLCAwKTtcbiAgICBpZiAoIWxvY2FsTW9kdWxlUGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIHVzZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBhdHRyaWJ1dGUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzeW1ib2xOYW1lOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgdmlzaXRLZXkgPSBgJHtmaWxlUGF0aH0jJHtzeW1ib2xOYW1lfWA7XG4gIGlmIChzdGF0ZS52aXNpdGluZ1N5bWJvbHMuaGFzKHZpc2l0S2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgY29uc3Qgc291cmNlID0gYXdhaXQgaG9zdC5yZWFkRmlsZShmaWxlUGF0aCk7XG4gIGlmICghc291cmNlKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBzdGF0ZS52aXNpdGluZ1N5bWJvbHMuYWRkKHZpc2l0S2V5KTtcbiAgdHJ5IHtcbiAgICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoY2FuZGlkYXRlKSA9PiAoY2FuZGlkYXRlLm5hbWVzID8/IFtjYW5kaWRhdGUubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgICBpZiAoIWRlZmluaXRpb24pIHtcbiAgICAgIHJldHVybiBcIlwiO1xuICAgIH1cblxuICAgIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbik7XG4gICAgY29uc3QgZGVwZW5kZW5jeVRleHQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgY29uc3QgYWRkZWQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgcmV0dXJuIFtkZXBlbmRlbmN5VGV4dCwgYWRkZWRdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cIik7XG4gIH0gZmluYWxseSB7XG4gICAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmRlbGV0ZSh2aXNpdEtleSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uUmFuZ2UoXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHtmaWxlUGF0aH06TCR7cmFuZ2Uuc3RhcnQgKyAxfS1MJHtyYW5nZS5lbmQgKyAxfWA7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZFJhbmdlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkUmFuZ2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIHJhbmdlKTtcbiAgcGFydHMucHVzaCh0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXM6IHN0cmluZ1tdLCByYW5nZTogU291cmNlUmFuZ2UsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBib29sZWFuIHtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZEltcG9ydHMuaGFzKHRleHQpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkSW1wb3J0cy5hZGQodGV4dCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25BbGlhcyhuYW1lOiBzdHJpbmcsIGFzbmFtZTogc3RyaW5nLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLCBwYXJ0czogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHthc25hbWV9PSR7bmFtZX1gO1xuICBpZiAoc3RhdGUuYWxpYXNlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmFsaWFzZXMuYWRkKGtleSk7XG4gIGNvbnN0IHRleHQgPSBgJHthc25hbWV9ID0gJHtuYW1lfWA7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiBgJHt0ZXh0fVxcbmA7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcoYmluZGluZzogc3RyaW5nLCBhdHRyaWJ1dGU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IHZvaWQge1xuICBzdGF0ZS5uZWVkc05hbWVzcGFjZVJ1bnRpbWUgPSB0cnVlO1xuICBjb25zdCBhdHRyaWJ1dGVzID0gc3RhdGUubmFtZXNwYWNlQmluZGluZ3MuZ2V0KGJpbmRpbmcpID8/IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBhdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGUpO1xuICBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zZXQoYmluZGluZywgYXR0cmlidXRlcyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBzdHJpbmcge1xuICBpZiAoIXN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLnNpemUpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID8gW1wiaW1wb3J0IHR5cGVzIGFzIF9sb29tX3R5cGVzXCJdIDogW107XG4gIGZvciAoY29uc3QgW2JpbmRpbmcsIGF0dHJpYnV0ZXNdIG9mIHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzKSB7XG4gICAgbGluZXMucHVzaChgJHtiaW5kaW5nfSA9IF9sb29tX3R5cGVzLlNpbXBsZU5hbWVzcGFjZSgpYCk7XG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgbGluZXMucHVzaChgJHtiaW5kaW5nfS4ke2F0dHJpYnV0ZX0gPSAke2F0dHJpYnV0ZX1gKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvOiBQeXRob25Nb2R1bGVJbmZvLCBzeW1ib2xOYW1lOiBzdHJpbmcpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBleGFjdCA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgcmV0dXJuIGV4YWN0ID8geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb246IFNvdXJjZURlZmluaXRpb24sIHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLnNvbWUoKG5hbWUpID0+IHVzYWdlLm5hbWVzLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuZnVuY3Rpb24gdXNlc1Vua25vd25JbXBvcnRlZE5hbWVzKHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gdXNhZ2UubmFtZXMubGVuZ3RoID4gMDtcbn1cblxuZnVuY3Rpb24gam9pblB5dGhvbk1vZHVsZShtb2R1bGVOYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBtb2R1bGVOYW1lID8gYCR7bW9kdWxlTmFtZX0uJHtuYW1lfWAgOiBuYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvbk1vZHVsZUluZm8+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Nb2R1bGVJbmZvPihzb3VyY2UsIFwibW9kdWxlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uVXNhZ2Uoc291cmNlOiBzdHJpbmcsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8UHl0aG9uVXNhZ2U+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Vc2FnZT4oc291cmNlLCBcInVzYWdlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBydW5QeXRob25Bc3Q8VD4oc291cmNlOiBzdHJpbmcsIG1vZGU6IFwibW9kdWxlXCIgfCBcInVzYWdlXCIsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8VD4ge1xuICBjb25zdCBjb21tYW5kID0gc3BsaXRDb21tYW5kTGluZShob3N0LnB5dGhvbkV4ZWN1dGFibGU/LnRyaW0oKSB8fCBcInB5dGhvbjNcIik7XG4gIGNvbnN0IGV4ZWN1dGFibGUgPSBjb21tYW5kWzBdID8/IFwicHl0aG9uM1wiO1xuICBjb25zdCBhcmdzID0gWy4uLmNvbW1hbmQuc2xpY2UoMSksIFwiLWNcIiwgUFlUSE9OX0FTVF9IRUxQRVJdO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7IHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0gfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgUHl0aG9uIEFTVCBoZWxwZXIgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXNvbHZlKEpTT04ucGFyc2Uoc3Rkb3V0KSBhcyBUKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoeyBtb2RlLCBzb3VyY2UgfSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZmluZExpbmVSYW5nZShsaW5lczogc3RyaW5nW10sIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoKHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gMSkgLSAxLCAwKTtcbiAgY29uc3QgZW5kID0gTWF0aC5taW4oKHJlZmVyZW5jZS5saW5lRW5kID8/IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbGluZXMubGVuZ3RoKSAtIDEsIGxpbmVzLmxlbmd0aCAtIDEpO1xuICBpZiAoc3RhcnQgPiBlbmQgfHwgc3RhcnQgPj0gbGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBmaW5kU3ltYm9sUmFuZ2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKTtcbiAgY29uc3QgZXhhY3QgPSBkZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICBpZiAoZXhhY3QpIHtcbiAgICByZXR1cm4geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH07XG4gIH1cblxuICBjb25zdCBzeW1ib2xQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KHN5bWJvbE5hbWUpfVxcXFxiYCk7XG4gIGNvbnN0IGxpbmUgPSBsaW5lcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gc3ltYm9sUGF0dGVybi50ZXN0KGNhbmRpZGF0ZSkpO1xuICBpZiAobGluZSA8IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gbGluZXNbbGluZV0uaW5jbHVkZXMoXCJ7XCIpID8geyBzdGFydDogbGluZSwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgbGluZSkgfSA6IHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSwgc2VsZWN0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHByb2xvZ3VlID0gY29sbGVjdFByb2xvZ3VlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZS5zdGFydCk7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSlcbiAgICAuZmlsdGVyKChkZWZpbml0aW9uKSA9PiAhcmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSk7XG4gIGNvbnN0IHNlbGVjdGVkRGVmaW5pdGlvbnMgPSB0cmFjZURlZmluaXRpb25zKHNlbGVjdGVkLCBkZWZpbml0aW9ucywgbGluZXMpO1xuICByZXR1cm4gWy4uLnByb2xvZ3VlLCAuLi5zZWxlY3RlZERlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pKV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuZnVuY3Rpb24gdHJhY2VEZWZpbml0aW9ucyhzZWVkOiBzdHJpbmcsIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10sIGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IHNlbGVjdGVkOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgY29uc3Qgc2VsZWN0ZWRLZXlzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgZGVmaW5pdGlvbnMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke2RlZmluaXRpb24uc3RhcnR9OiR7ZGVmaW5pdGlvbi5lbmR9OiR7ZGVmaW5pdGlvbi5uYW1lfWA7XG4gICAgICBpZiAoc2VsZWN0ZWRLZXlzLmhhcyhrZXkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuc29tZSgobmFtZSkgPT4gc291cmNlVXNlc05hbWUoaGF5c3RhY2ssIG5hbWUpKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkS2V5cy5hZGQoa2V5KTtcbiAgICAgIHNlbGVjdGVkLnB1c2goZGVmaW5pdGlvbik7XG4gICAgICBoYXlzdGFjayArPSBgXFxuJHtyZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbil9XFxuYDtcbiAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzZWxlY3RlZC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zdGFydCAtIHJpZ2h0LnN0YXJ0KTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdFByb2xvZ3VlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGJlZm9yZUxpbmU6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgY29uc3QgcHJvbG9ndWU6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KGJlZm9yZUxpbmUsIDApO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbWF4OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAoaXNQcm9sb2d1ZUxpbmUobGluZSwgbGFuZ3VhZ2UpKSB7XG4gICAgICBwcm9sb2d1ZS5wdXNoKGxpbmUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcHJvbG9ndWUubGVuZ3RoID8gW3Byb2xvZ3VlLmpvaW4oXCJcXG5cIildIDogW107XG59XG5cbmZ1bmN0aW9uIGlzUHJvbG9ndWVMaW5lKGxpbmU6IHN0cmluZywgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBib29sZWFuIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiAvXihmcm9tXFxzK1xcUytcXHMraW1wb3J0XFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gL14oaW1wb3J0XFxzK3xleHBvcnRcXHMrLipcXHMrZnJvbVxccyt8KD86Y29uc3R8bGV0fHZhcilcXHMrXFx3K1xccyo9XFxzKnJlcXVpcmVcXHMqXFwoKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgIGNhc2UgXCJjcHBcIjpcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwidGFyZ2V0IFwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCJzb3VyY2VfZmlsZW5hbWVcIik7XG4gICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIHJldHVybiAvXihtb2R1bGVcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIC9eKG9wZW5cXHMrfGluY2x1ZGVcXHMrfCN1c2VcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIC9eKHBhY2thZ2VcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29sbGVjdERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXig/OmV4cG9ydFxccyspPyg/OmFzeW5jXFxzKyk/ZnVuY3Rpb25cXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/Y2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/KD86Y29uc3R8bGV0fHZhcilcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccyo9Lyk7XG4gICAgY2FzZSBcImNcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCBmYWxzZSk7XG4gICAgY2FzZSBcImNwcFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXMsIHRydWUpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8YWJzdHJhY3R8XFxzKSpcXHMqKD86Y2xhc3N8aW50ZXJmYWNlfGVudW18cmVjb3JkKVxccysoW0EtWmEtel9dXFx3KilcXGJ8XlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfHN5bmNocm9uaXplZHxuYXRpdmV8XFxzKStbXFx3PD5cXFtcXF0sLj9dK1xccysoW0EtWmEtel9dXFx3KilcXHMqXFwoW147XSpcXClcXHMqXFx7Lyk7XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBhc3NpZ25tZW50ID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFtBLVphLXpfXVxcdyopXFxzKls6PV0vKTtcbiAgICBpZiAoYXNzaWdubWVudCkge1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IGFzc2lnbm1lbnRbMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFxccyopKD86YXN5bmNcXHMrKT8oPzpkZWZ8Y2xhc3MpXFxzKyhbQS1aYS16X11cXHcqKVxcYi8pO1xuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmRlbnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gICAgbGV0IHN0YXJ0ID0gaW5kZXg7XG4gICAgd2hpbGUgKHN0YXJ0ID4gMCAmJiBsaW5lc1tzdGFydCAtIDFdLnRyaW0oKS5zdGFydHNXaXRoKFwiQFwiKSAmJiBnZXRJbmRlbnQobGluZXNbc3RhcnQgLSAxXSkgPT09IGluZGVudCkge1xuICAgICAgc3RhcnQgLT0gMTtcbiAgICB9XG4gICAgbGV0IGVuZCA9IGluZGV4O1xuICAgIGZvciAobGV0IGN1cnNvciA9IGluZGV4ICsgMTsgY3Vyc29yIDwgbGluZXMubGVuZ3RoOyBjdXJzb3IgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2N1cnNvcl0udHJpbSgpICYmIGdldEluZGVudChsaW5lc1tjdXJzb3JdKSA8PSBpbmRlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBlbmQgPSBjdXJzb3I7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBtYXRjaFsyXSwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgbGV0IGRlcHRoID0gMDtcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgY29uc3QgdG9wTGV2ZWwgPSBkZXB0aCA9PT0gMDtcblxuICAgIGlmICh0b3BMZXZlbCAmJiB0cmltbWVkKSB7XG4gICAgICBjb25zdCBtYWNybyA9IHRyaW1tZWQubWF0Y2goL14jXFxzKmRlZmluZVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICAgIGlmIChtYWNybykge1xuICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWFjcm9bMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIH0gZWxzZSBpZiAoIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIWlzQ0NvbW1lbnRMaW5lKHRyaW1tZWQpKSB7XG4gICAgICAgIGNvbnN0IHR5cGVEZWZpbml0aW9uID0gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXMsIGluZGV4LCBpc0NwcCk7XG4gICAgICAgIGlmICh0eXBlRGVmaW5pdGlvbikge1xuICAgICAgICAgIGRlZmluaXRpb25zLnB1c2godHlwZURlZmluaXRpb24pO1xuICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIHR5cGVEZWZpbml0aW9uLmVuZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25EZWZpbml0aW9uID0gbWF0Y2hDRnVuY3Rpb25EZWZpbml0aW9uKGxpbmVzLCBpbmRleCk7XG4gICAgICAgICAgaWYgKGZ1bmN0aW9uRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgZGVmaW5pdGlvbnMucHVzaChmdW5jdGlvbkRlZmluaXRpb24pO1xuICAgICAgICAgICAgaW5kZXggPSBNYXRoLm1heChpbmRleCwgZnVuY3Rpb25EZWZpbml0aW9uLmVuZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGdsb2JhbERlZmluaXRpb24gPSBtYXRjaENHbG9iYWxEZWZpbml0aW9uKGxpbmUsIGluZGV4KTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxEZWZpbml0aW9uKSB7XG4gICAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZ2xvYmFsRGVmaW5pdGlvbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVwdGggKz0gYnJhY2VEZWx0YShsaW5lKTtcbiAgICBpZiAoZGVwdGggPCAwKSB7XG4gICAgICBkZXB0aCA9IDA7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBtYXRjaENUeXBlRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzQ3BwOiBib29sZWFuKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXIgPSBsaW5lcy5zbGljZShzdGFydCwgTWF0aC5taW4obGluZXMubGVuZ3RoLCBzdGFydCArIDgpKS5qb2luKFwiIFwiKTtcbiAgY29uc3Qga2V5d29yZFBhdHRlcm4gPSBpc0NwcCA/IFwiKD86dHlwZWRlZlxcXFxzKyk/KD86c3RydWN0fGNsYXNzfGVudW18dW5pb24pXCIgOiBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxlbnVtfHVuaW9uKVwiO1xuICBjb25zdCBuYW1lZCA9IGhlYWRlci5tYXRjaChuZXcgUmVnRXhwKGBeXFxcXHMqJHtrZXl3b3JkUGF0dGVybn1cXFxccysoW0EtWmEtel9dXFxcXHcqKVxcXFxiYCkpO1xuICBjb25zdCBhbm9ueW1vdXNUeXBlZGVmID0gaGVhZGVyLm1hdGNoKC9eXFxzKnR5cGVkZWZcXHMrKD86c3RydWN0fGVudW18dW5pb24pXFxiW1xcc1xcU10qP1xcfVxccyooW0EtWmEtel9dXFx3KilcXHMqOy8pO1xuICBjb25zdCBuYW1lID0gbmFtZWQ/LlsxXSA/PyBhbm9ueW1vdXNUeXBlZGVmPy5bMV07XG4gIGlmICghbmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgZW5kID0gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lcywgc3RhcnQpO1xuICByZXR1cm4geyBuYW1lLCBuYW1lczogW25hbWVdLCBzdGFydCwgZW5kIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IGhlYWRlckxpbmVzID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyAxMikpO1xuICBjb25zdCBqb2luZWQgPSBoZWFkZXJMaW5lcy5qb2luKFwiIFwiKTtcbiAgY29uc3QgYnJhY2VPZmZzZXQgPSBoZWFkZXJMaW5lcy5maW5kSW5kZXgoKGxpbmUpID0+IGxpbmUuaW5jbHVkZXMoXCJ7XCIpKTtcbiAgaWYgKGJyYWNlT2Zmc2V0IDwgMCB8fCBqb2luZWQuaW5kZXhPZihcIjtcIikgPj0gMCAmJiBqb2luZWQuaW5kZXhPZihcIjtcIikgPCBqb2luZWQuaW5kZXhPZihcIntcIikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSBbLi4uam9pbmVkLm1hdGNoQWxsKC8oW0EtWmEtel9dXFx3Kig/Ojo6W0EtWmEtel9dXFx3Kik/fG9wZXJhdG9yXFxzKlteXFxzKF0rKVxccypcXChbXjt7fV0qXFwpXFxzKig/OmNvbnN0XFxiW157fV0qKT8oPzpub2V4Y2VwdFxcYltee31dKik/KD86LT5cXHMqW157fV0rKT9cXHsvZyldO1xuICBjb25zdCBuYW1lID0gbWF0Y2hlc1swXT8uWzFdPy5yZXBsYWNlKC9cXHMrL2csIFwiXCIpO1xuICBpZiAoIW5hbWUgfHwgaXNDQ29udHJvbEtleXdvcmQobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGJyYWNlTGluZSA9IHN0YXJ0ICsgYnJhY2VPZmZzZXQ7XG4gIGNvbnN0IHNob3J0TmFtZSA9IG5hbWUuaW5jbHVkZXMoXCI6OlwiKSA/IG5hbWUuc3BsaXQoXCI6OlwiKS5wb3AoKSA/PyBuYW1lIDogbmFtZTtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBzaG9ydE5hbWUsXG4gICAgbmFtZXM6IFsuLi5uZXcgU2V0KFtzaG9ydE5hbWUsIG5hbWVdKV0sXG4gICAgc3RhcnQsXG4gICAgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgYnJhY2VMaW5lKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkLmVuZHNXaXRoKFwiO1wiKSB8fCB0cmltbWVkLmluY2x1ZGVzKFwiKFwiKSB8fCAvXihyZXR1cm58dXNpbmd8bmFtZXNwYWNlfHRlbXBsYXRlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgd2l0aG91dEluaXRpYWxpemVyID0gdHJpbW1lZC5zcGxpdChcIj1cIilbMF0ucmVwbGFjZSgvXFxbW15cXF1dKl0vZywgXCJcIik7XG4gIGNvbnN0IG1hdGNoID0gd2l0aG91dEluaXRpYWxpemVyLm1hdGNoKC8oW0EtWmEtel9dXFx3KilcXHMqKD86Wyw7XXwkKS9nKT8ucG9wKCk/Lm1hdGNoKC8oW0EtWmEtel9dXFx3KikvKTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoPy5bMV07XG4gIGlmICghbmFtZSB8fCAvXihjb25zdHxzdGF0aWN8ZXh0ZXJufHZvbGF0aWxlfHVuc2lnbmVkfHNpZ25lZHxsb25nfHNob3J0fGludHxjaGFyfGZsb2F0fGRvdWJsZXx2b2lkfGF1dG8pJC8udGVzdChuYW1lKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHsgbmFtZSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH07XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RMbHZtRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCBzeW1ib2wgPSBsaW5lLm1hdGNoKC9eXFxzKig/OmRlZmluZXxkZWNsYXJlKVxcYi4qQChbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qKVxccypcXCgvKTtcbiAgICBpZiAoc3ltYm9sKSB7XG4gICAgICBjb25zdCBlbmQgPSBsaW5lLnRyaW1TdGFydCgpLnN0YXJ0c1dpdGgoXCJkZWZpbmVcIikgPyBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIDogaW5kZXg7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogc3ltYm9sWzFdLCBuYW1lczogW3N5bWJvbFsxXSwgYEAke3N5bWJvbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBnbG9iYWwgPSBsaW5lLm1hdGNoKC9eXFxzKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqPS8pO1xuICAgIGlmIChnbG9iYWwpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBnbG9iYWxbMV0sIG5hbWVzOiBbZ2xvYmFsWzFdLCBgQCR7Z2xvYmFsWzFdfWBdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG1vZHVsZXxpbXBvcnQpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lcyA9IGdldEhhc2tlbGxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRIYXNrZWxsUmFuZ2VFbmQobGluZXMsIGluZGV4LCBuYW1lc1swXSk7XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG5hbWVzWzBdLCBuYW1lcywgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgaW5kZXggPSBlbmQ7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0T2NhbWxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG9wZW58aW5jbHVkZXwjdXNlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkKTtcbiAgICBpZiAoIW5hbWVzLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZW5kID0gZmluZExheW91dFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgaXNPY2FtbFRvcExldmVsU3RhcnQpO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBwYXR0ZXJuOiBSZWdFeHApOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaChwYXR0ZXJuKTtcbiAgICBjb25zdCBuYW1lID0gbWF0Y2g/LnNsaWNlKDEpLmZpbmQoQm9vbGVhbik7XG4gICAgaWYgKCFuYW1lKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gZmluZEJyYWNlUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFsaW5lc1tzdGFydF0uaW5jbHVkZXMoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIHN0YXJ0O1xuICB9XG5cbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHNhd0JyYWNlICYmIGRlcHRoIDw9IDApIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBmaW5kQ0RlY2xhcmF0aW9uRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCghc2F3QnJhY2UgfHwgZGVwdGggPD0gMCkgJiYgbGluZXNbaW5kZXhdLmluY2x1ZGVzKFwiO1wiKSkge1xuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RhcnQ7XG59XG5cbmZ1bmN0aW9uIGJyYWNlRGVsdGEobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGRlbHRhID0gMDtcbiAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmUpIHtcbiAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgIGRlbHRhICs9IDE7XG4gICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgZGVsdGEgLT0gMTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRlbHRhO1xufVxuXG5mdW5jdGlvbiBpc0NDb21tZW50TGluZSh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi8vXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIi8qXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIipcIik7XG59XG5cbmZ1bmN0aW9uIGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiaWZcIiwgXCJmb3JcIiwgXCJ3aGlsZVwiLCBcInN3aXRjaFwiLCBcImNhdGNoXCJdLmluY2x1ZGVzKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2lnbmF0dXJlID0gdHJpbW1lZC5tYXRjaCgvXihbYS16X11bXFx3J10qKVxccyo6Oi8pO1xuICBpZiAoc2lnbmF0dXJlKSB7XG4gICAgcmV0dXJuIFtzaWduYXR1cmVbMV1dO1xuICB9XG5cbiAgY29uc3QgYmluZGluZyA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXGIuKj0vKTtcbiAgaWYgKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gW2JpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUxpa2UgPSB0cmltbWVkLm1hdGNoKC9eKD86ZGF0YXxuZXd0eXBlfHR5cGV8Y2xhc3MpXFxzKyhbQS1aXVtcXHcnXSopXFxiLyk7XG4gIGlmICh0eXBlTGlrZSkge1xuICAgIHJldHVybiBbdHlwZUxpa2VbMV1dO1xuICB9XG5cbiAgY29uc3QgaW5zdGFuY2UgPSB0cmltbWVkLm1hdGNoKC9eaW5zdGFuY2VcXGIuKj9cXGIoW0EtWl1bXFx3J10qKVxcYi8pO1xuICByZXR1cm4gaW5zdGFuY2UgPyBbaW5zdGFuY2VbMV1dIDogW107XG59XG5cbmZ1bmN0aW9uIGdldE9jYW1sRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGV0QmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15sZXRcXHMrKD86cmVjXFxzKyk/KD86XFwoKFteKV0rKVxcKXwoW2Etel9dW1xcdyddKikpLyk7XG4gIGlmIChsZXRCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtsZXRCaW5kaW5nWzFdID8/IGxldEJpbmRpbmdbMl1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9edHlwZVxccysoW2Etel9dW1xcdyddKikvKTtcbiAgaWYgKHR5cGVCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFt0eXBlQmluZGluZ1sxXV07XG4gIH1cblxuICBjb25zdCBtb2R1bGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXm1vZHVsZVxccysoW0EtWl1bXFx3J10qKS8pO1xuICBpZiAobW9kdWxlQmluZGluZykge1xuICAgIHJldHVybiBbbW9kdWxlQmluZGluZ1sxXV07XG4gIH1cblxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzVG9wTGV2ZWxTdGFydDogKGxpbmU6IHN0cmluZykgPT4gYm9vbGVhbik6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAobGluZS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmUpID09PSAwICYmIGlzVG9wTGV2ZWxTdGFydChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgbmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGVuZCA9IHN0YXJ0O1xuICBsZXQgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gbGluZXNbc3RhcnRdLnRyaW0oKS5zdGFydHNXaXRoKGAke25hbWV9IDo6YCk7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQpKSB7XG4gICAgICBpZiAoYWxsb3dNYXRjaGluZ0VxdWF0aW9uICYmIHRyaW1tZWQuc3RhcnRzV2l0aChgJHtuYW1lfSBgKSAmJiB0cmltbWVkLmluY2x1ZGVzKFwiPVwiKSkge1xuICAgICAgICBhbGxvd01hdGNoaW5nRXF1YXRpb24gPSBmYWxzZTtcbiAgICAgICAgZW5kID0gaW5kZXg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGVuZCA9IGluZGV4O1xuICB9XG4gIHJldHVybiBlbmQ7XG59XG5cbmZ1bmN0aW9uIGlzSGFza2VsbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihtb2R1bGV8aW1wb3J0fGRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzfGluc3RhbmNlKVxcYi8udGVzdCh0cmltbWVkKVxuICAgIHx8IC9eW2Etel9dW1xcdyddKlxccyooPzo6OnwuKj0pLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiBpc09jYW1sVG9wTGV2ZWxTdGFydCh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eKG9wZW58aW5jbHVkZXwjdXNlfGxldHx0eXBlfG1vZHVsZSlcXGIvLnRlc3QodHJpbW1lZCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGxpbmVzLnNsaWNlKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQgKyAxKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiByYW5nZXNPdmVybGFwKGxlZnQ6IFNvdXJjZVJhbmdlLCByaWdodDogU291cmNlUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGxlZnQuc3RhcnQgPD0gcmlnaHQuZW5kICYmIHJpZ2h0LnN0YXJ0IDw9IGxlZnQuZW5kO1xufVxuXG5mdW5jdGlvbiBnZXRJbmRlbnQobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGxpbmUubWF0Y2goL15cXHMqLyk/LlswXS5sZW5ndGggPz8gMDtcbn1cblxuZnVuY3Rpb24gZXNjYXBlUmVnZXgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG59XG5cbmZ1bmN0aW9uIGRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uKTogc3RyaW5nW10ge1xuICByZXR1cm4gZGVmaW5pdGlvbi5uYW1lcz8ubGVuZ3RoID8gZGVmaW5pdGlvbi5uYW1lcyA6IFtkZWZpbml0aW9uLm5hbWVdO1xufVxuXG5mdW5jdGlvbiBzb3VyY2VVc2VzTmFtZShzb3VyY2U6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoXCJAXCIpKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYCR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChuYW1lKX1cXFxcYmApLnRlc3Qoc291cmNlKTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLCByYW5nZTogU291cmNlUmFuZ2UgfCBudWxsKTogc3RyaW5nIHtcbiAgaWYgKHJlZmVyZW5jZS5zeW1ib2xOYW1lKSB7XG4gICAgcmV0dXJuIGAke3JlZmVyZW5jZS5maWxlUGF0aH0jJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gO1xuICB9XG4gIGlmIChyYW5nZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICB9XG4gIHJldHVybiByZWZlcmVuY2UuZmlsZVBhdGg7XG59XG5cbmNvbnN0IFBZVEhPTl9BU1RfSEVMUEVSID0gU3RyaW5nLnJhd2BcbmltcG9ydCBhc3RcbmltcG9ydCBqc29uXG5pbXBvcnQgc3lzXG5cbnBheWxvYWQgPSBqc29uLmxvYWRzKHN5cy5zdGRpbi5yZWFkKCkpXG5zb3VyY2UgPSBwYXlsb2FkLmdldChcInNvdXJjZVwiLCBcIlwiKVxubW9kZSA9IHBheWxvYWQuZ2V0KFwibW9kZVwiLCBcIm1vZHVsZVwiKVxuXG5kZWYgcmFuZ2Vfc3RhcnQobm9kZSk6XG4gICAgbGluZW5vID0gZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKVxuICAgIGRlY29yYXRvcnMgPSBnZXRhdHRyKG5vZGUsIFwiZGVjb3JhdG9yX2xpc3RcIiwgTm9uZSkgb3IgW11cbiAgICBpZiBkZWNvcmF0b3JzOlxuICAgICAgICBsaW5lbm8gPSBtaW4obGluZW5vLCAqKGdldGF0dHIoZGVjb3JhdG9yLCBcImxpbmVub1wiLCBsaW5lbm8pIGZvciBkZWNvcmF0b3IgaW4gZGVjb3JhdG9ycykpXG4gICAgcmV0dXJuIGxpbmVubyAtIDFcblxuZGVmIHJhbmdlX2VuZChub2RlKTpcbiAgICByZXR1cm4gZ2V0YXR0cihub2RlLCBcImVuZF9saW5lbm9cIiwgZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKSkgLSAxXG5cbmRlZiB0YXJnZXRfbmFtZXModGFyZ2V0KTpcbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgYXN0Lk5hbWUpOlxuICAgICAgICByZXR1cm4gW3RhcmdldC5pZF1cbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgKGFzdC5UdXBsZSwgYXN0Lkxpc3QpKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgaXRlbSBpbiB0YXJnZXQuZWx0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXMoaXRlbSkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIHJldHVybiBbXVxuXG5kZWYgZGVmaW5pdGlvbl9uYW1lcyhub2RlKTpcbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIChhc3QuRnVuY3Rpb25EZWYsIGFzdC5Bc3luY0Z1bmN0aW9uRGVmLCBhc3QuQ2xhc3NEZWYpKTpcbiAgICAgICAgcmV0dXJuIFtub2RlLm5hbWVdXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuQXNzaWduKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgdGFyZ2V0IGluIG5vZGUudGFyZ2V0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXModGFyZ2V0KSlcbiAgICAgICAgcmV0dXJuIG5hbWVzXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkFubkFzc2lnbiwgYXN0LkF1Z0Fzc2lnbikpOlxuICAgICAgICByZXR1cm4gdGFyZ2V0X25hbWVzKG5vZGUudGFyZ2V0KVxuICAgIHJldHVybiBbXVxuXG5kZWYgaW5zcGVjdF9tb2R1bGUodHJlZSk6XG4gICAgZGVmaW5pdGlvbnMgPSBbXVxuICAgIGltcG9ydHMgPSBbXVxuICAgIGZvciBub2RlIGluIHRyZWUuYm9keTpcbiAgICAgICAgbmFtZXMgPSBkZWZpbml0aW9uX25hbWVzKG5vZGUpXG4gICAgICAgIGlmIG5hbWVzOlxuICAgICAgICAgICAgZGVmaW5pdGlvbnMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcIm5hbWVcIjogbmFtZXNbMF0sXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBuYW1lcyxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5JbXBvcnQpOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImltcG9ydFwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiAwLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0RnJvbSk6XG4gICAgICAgICAgICBpbXBvcnRzLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJraW5kXCI6IFwiZnJvbVwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IG5vZGUubW9kdWxlIG9yIFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiBub2RlLmxldmVsLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgIHJldHVybiB7XCJkZWZpbml0aW9uc1wiOiBkZWZpbml0aW9ucywgXCJpbXBvcnRzXCI6IGltcG9ydHN9XG5cbmRlZiBhdHRyaWJ1dGVfY2hhaW4obm9kZSk6XG4gICAgY2hhaW4gPSBbXVxuICAgIGN1cnJlbnQgPSBub2RlXG4gICAgd2hpbGUgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuQXR0cmlidXRlKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuYXR0cilcbiAgICAgICAgY3VycmVudCA9IGN1cnJlbnQudmFsdWVcbiAgICBpZiBpc2luc3RhbmNlKGN1cnJlbnQsIGFzdC5OYW1lKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuaWQpXG4gICAgICAgIGNoYWluLnJldmVyc2UoKVxuICAgICAgICByZXR1cm4gY2hhaW5cbiAgICByZXR1cm4gW11cblxuY2xhc3MgVXNhZ2VWaXNpdG9yKGFzdC5Ob2RlVmlzaXRvcik6XG4gICAgZGVmIF9faW5pdF9fKHNlbGYpOlxuICAgICAgICBzZWxmLm5hbWVzID0gc2V0KClcbiAgICAgICAgc2VsZi5hdHRyaWJ1dGVzID0ge31cblxuICAgIGRlZiB2aXNpdF9OYW1lKHNlbGYsIG5vZGUpOlxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUuY3R4LCBhc3QuTG9hZCk6XG4gICAgICAgICAgICBzZWxmLm5hbWVzLmFkZChub2RlLmlkKVxuXG4gICAgZGVmIHZpc2l0X0F0dHJpYnV0ZShzZWxmLCBub2RlKTpcbiAgICAgICAgY2hhaW4gPSBhdHRyaWJ1dGVfY2hhaW4obm9kZSlcbiAgICAgICAgaWYgbGVuKGNoYWluKSA+PSAyOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQoY2hhaW5bMF0pXG4gICAgICAgICAgICBzZWxmLmF0dHJpYnV0ZXMuc2V0ZGVmYXVsdChjaGFpblswXSwgc2V0KCkpLmFkZChjaGFpblsxXSlcbiAgICAgICAgc2VsZi5nZW5lcmljX3Zpc2l0KG5vZGUpXG5cbmRlZiBpbnNwZWN0X3VzYWdlKHRyZWUpOlxuICAgIHZpc2l0b3IgPSBVc2FnZVZpc2l0b3IoKVxuICAgIHZpc2l0b3IudmlzaXQodHJlZSlcbiAgICByZXR1cm4ge1xuICAgICAgICBcIm5hbWVzXCI6IHNvcnRlZCh2aXNpdG9yLm5hbWVzKSxcbiAgICAgICAgXCJhdHRyaWJ1dGVzXCI6IHtrZXk6IHNvcnRlZCh2YWx1ZSkgZm9yIGtleSwgdmFsdWUgaW4gdmlzaXRvci5hdHRyaWJ1dGVzLml0ZW1zKCl9LFxuICAgIH1cblxudHJ5OlxuICAgIHRyZWUgPSBhc3QucGFyc2Uoc291cmNlKVxuZXhjZXB0IFN5bnRheEVycm9yOlxuICAgIHByaW50KGpzb24uZHVtcHMoe1wiZGVmaW5pdGlvbnNcIjogW10sIFwiaW1wb3J0c1wiOiBbXX0gaWYgbW9kZSA9PSBcIm1vZHVsZVwiIGVsc2Uge1wibmFtZXNcIjogW10sIFwiYXR0cmlidXRlc1wiOiB7fX0pKVxuICAgIHJhaXNlIFN5c3RlbUV4aXQoMClcblxuaWYgbW9kZSA9PSBcIm1vZHVsZVwiOlxuICAgIHByaW50KGpzb24uZHVtcHMoaW5zcGVjdF9tb2R1bGUodHJlZSkpKVxuZWxzZTpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfdXNhZ2UodHJlZSkpKVxuYDtcbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogc3RyaW5nIHtcbiAgY29uc3QgY2FsbCA9IGJsb2NrLnNvdXJjZVJlZmVyZW5jZT8uY2FsbDtcbiAgaWYgKCFjYWxsKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRlbnQ7XG4gIH1cblxuICBjb25zdCBzeW1ib2xOYW1lID0gYmxvY2suc291cmNlUmVmZXJlbmNlPy5zeW1ib2xOYW1lPy50cmltKCk7XG4gIGNvbnN0IGlucHV0ID0gYmxvY2suY29udGVudC50cmltKCk7XG4gIGNvbnN0IGV4cHJlc3Npb24gPSBjYWxsLmV4cHJlc3Npb24/LnRyaW0oKVxuICAgID8gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKGNhbGwuZXhwcmVzc2lvbiwgaW5wdXQsIHN5bWJvbE5hbWUpXG4gICAgOiByZW5kZXJEZWZhdWx0U291cmNlQ2FsbChzeW1ib2xOYW1lLCBjYWxsLmFyZ3MsIGlucHV0KTtcblxuICByZXR1cm4gcmVuZGVyTGFuZ3VhZ2VDYWxsSGFybmVzcyhibG9jay5sYW5ndWFnZSwgZXhwcmVzc2lvbiwgY2FsbC5wcmludCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckRlZmF1bHRTb3VyY2VDYWxsKHN5bWJvbE5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgYXJnczogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFzeW1ib2xOYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwibG9vbS1jYWxsIG5lZWRzIGxvb20tc3ltYm9sIHdoZW4gbm8gY2FsbCBleHByZXNzaW9uIGlzIHByb3ZpZGVkLlwiKTtcbiAgfVxuXG4gIGNvbnN0IHJlbmRlcmVkQXJncyA9IHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZShhcmdzPy50cmltKCkgfHwgXCJ7aW5wdXR9XCIsIGlucHV0LCBzeW1ib2xOYW1lKTtcbiAgcmV0dXJuIGAke3N5bWJvbE5hbWV9KCR7cmVuZGVyZWRBcmdzfSlgO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUodGVtcGxhdGU6IHN0cmluZywgaW5wdXQ6IHN0cmluZywgc3ltYm9sTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRlbXBsYXRlXG4gICAgLnJlcGxhY2VBbGwoXCJ7aW5wdXR9XCIsIGlucHV0KVxuICAgIC5yZXBsYWNlQWxsKFwie3N5bWJvbH1cIiwgc3ltYm9sTmFtZSA/PyBcIlwiKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTGFuZ3VhZ2VDYWxsSGFybmVzcyhsYW5ndWFnZTogc3RyaW5nLCBleHByZXNzaW9uOiBzdHJpbmcsIHByaW50OiBib29sZWFuKTogc3RyaW5nIHtcbiAgaWYgKCFwcmludCkge1xuICAgIHJldHVybiByZW5kZXJFeHByZXNzaW9uU3RhdGVtZW50KGxhbmd1YWdlLCBleHByZXNzaW9uKTtcbiAgfVxuXG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gYHByaW50KCR7ZXhwcmVzc2lvbn0pYDtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gYGNvbnNvbGUubG9nKCR7ZXhwcmVzc2lvbn0pO2A7XG4gICAgY2FzZSBcImNcIjpcbiAgICAgIHJldHVybiBgI2luY2x1ZGUgPHN0ZGlvLmg+XFxuaW50IG1haW4odm9pZCkgeyBwcmludGYoXCIlZFxcXFxuXCIsICR7ZXhwcmVzc2lvbn0pOyByZXR1cm4gMDsgfWA7XG4gICAgY2FzZSBcImNwcFwiOlxuICAgICAgcmV0dXJuIGAjaW5jbHVkZSA8aW9zdHJlYW0+XFxuaW50IG1haW4oKSB7IHN0ZDo6Y291dCA8PCAoJHtleHByZXNzaW9ufSkgPDwgXCJcXFxcblwiOyByZXR1cm4gMDsgfWA7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gYGxldCAoKSA9IHByaW50X2VuZGxpbmUgKCR7ZXhwcmVzc2lvbn0pYDtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBsb29tLWNhbGwgY2Fubm90IGdlbmVyYXRlIGEgcHJpbnRlZCBoYXJuZXNzIGZvciAke2xhbmd1YWdlfS4gVXNlIGxvb20tcHJpbnQ9ZmFsc2Ugb3Igd3JpdGUgdGhlIGhhcm5lc3MgaW4gdGhlIGJsb2NrIGJvZHkuYCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyRXhwcmVzc2lvblN0YXRlbWVudChsYW5ndWFnZTogc3RyaW5nLCBleHByZXNzaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGV4cHJlc3Npb247XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBleHByZXNzaW9uLmVuZHNXaXRoKFwiO1wiKSA/IGV4cHJlc3Npb24gOiBgJHtleHByZXNzaW9ufTtgO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Ub29sYmFySGFuZGxlcnMge1xuICBvblJ1bjogKCkgPT4gdm9pZDtcbiAgb25Db3B5OiAoKSA9PiB2b2lkO1xuICBvblJlbW92ZTogKCkgPT4gdm9pZDtcbiAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHZvaWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKFxuICBibG9ja0lkOiBzdHJpbmcsXG4gIGlzUnVubmluZzogYm9vbGVhbixcbiAgaGFuZGxlcnM6IGxvb21Ub29sYmFySGFuZGxlcnMsXG4pOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHRvb2xiYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICB0b29sYmFyLmNsYXNzTmFtZSA9IFwibG9vbS1jb2RlLXRvb2xiYXJcIjtcbiAgdG9vbGJhci5kYXRhc2V0Lmxvb21CbG9ja0lkID0gYmxvY2tJZDtcblxuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJ1biBibG9ja1wiLCBpc1J1bm5pbmcgPyBcImxvYWRlci1jaXJjbGVcIiA6IFwicGxheVwiLCBoYW5kbGVycy5vblJ1biwgaXNSdW5uaW5nKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiQ29weSBjb2RlXCIsIFwiY29weVwiLCBoYW5kbGVycy5vbkNvcHksIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUmVtb3ZlIHNuaXBwZXRcIiwgXCJ0cmFzaC0yXCIsIGhhbmRsZXJzLm9uUmVtb3ZlLCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBvdXRwdXRcIiwgXCJwYW5lbC1ib3R0b20tb3BlblwiLCBoYW5kbGVycy5vblRvZ2dsZU91dHB1dCwgZmFsc2UpKTtcblxuICByZXR1cm4gdG9vbGJhcjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnV0dG9uKGxhYmVsOiBzdHJpbmcsIGljb25OYW1lOiBzdHJpbmcsIG9uQ2xpY2s6ICgpID0+IHZvaWQsIHNwaW5uaW5nOiBib29sZWFuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICBjb25zdCBidXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICBidXR0b24uY2xhc3NOYW1lID0gYGxvb20tdG9vbGJhci1idXR0b24ke3NwaW5uaW5nID8gXCIgaXMtcnVubmluZ1wiIDogXCJcIn1gO1xuICBidXR0b24udHlwZSA9IFwiYnV0dG9uXCI7XG4gIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGxhYmVsKTtcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIG9uQ2xpY2soKTtcbiAgfSk7XG4gIHNldEljb24oYnV0dG9uLCBpY29uTmFtZSk7XG4gIHJldHVybiBidXR0b247XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmZ1bmN0aW9uIGdldFN0YXR1c0tpbmQob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogXCJzdWNjZXNzXCIgfCBcIndhcm5pbmdcIiB8IFwiZmFpbHVyZVwiIHtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3VjY2Vzcykge1xuICAgIHJldHVybiBvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgfHwgb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgPyBcIndhcm5pbmdcIiA6IFwic3VjY2Vzc1wiO1xuICB9XG5cbiAgcmV0dXJuIFwiZmFpbHVyZVwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2dldFN0YXR1c0tpbmQob3V0cHV0KX0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifWA7XG4gIHBhbmVsLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBvdXRwdXQuYmxvY2tJZDtcbiAgcmVuZGVyT3V0cHV0UGFuZWwocGFuZWwsIG91dHB1dCk7XG4gIHJldHVybiBwYW5lbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsOiBIVE1MRWxlbWVudCwgb3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogdm9pZCB7XG4gIGNvbnN0IGtpbmQgPSBnZXRTdGF0dXNLaW5kKG91dHB1dCk7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2tpbmR9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn0ke291dHB1dC5jb2xsYXBzZWQgPyBcIiBpcy1jb2xsYXBzZWRcIiA6IFwiXCJ9YDtcbiAgcGFuZWwuZW1wdHkoKTtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IGJhZGdlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1iYWRnZVwiIH0pO1xuICBzZXRJY29uKGJhZGdlLCBraW5kID09PSBcInN1Y2Nlc3NcIiA/IFwiY2hlY2stY2lyY2xlLTJcIiA6IGtpbmQgPT09IFwid2FybmluZ1wiID8gXCJhbGVydC10cmlhbmdsZVwiIDogXCJ4LWNpcmNsZVwiKTtcblxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LnJ1bm5lck5hbWV9IFx1MDBCNyBleGl0ICR7b3V0cHV0LnJlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gKTtcblxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LmR1cmF0aW9uTXN9IG1zIFx1MDBCNyAke25ldyBEYXRlKG91dHB1dC5yZXN1bHQuZmluaXNoZWRBdCkudG9Mb2NhbGVUaW1lU3RyaW5nKCl9YCk7XG5cbiAgY29uc3QgYm9keSA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1ib2R5XCIgfSk7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRvdXRcIiwgb3V0cHV0LnJlc3VsdC5zdGRvdXQpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIldhcm5pbmdcIiwgb3V0cHV0LnJlc3VsdC53YXJuaW5nKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3RkZXJyXCIsIG91dHB1dC5yZXN1bHQuc3RkZXJyKTtcbiAgfVxuICBpZiAob3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY3JlYXRlU291cmNlUHJldmlldyhib2R5LCBvdXRwdXQuc291cmNlUHJldmlldyk7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgJiYgIW91dHB1dC5zb3VyY2VQcmV2aWV3Py5jb250ZW50LnRyaW0oKSkge1xuICAgIGNvbnN0IGVtcHR5ID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtZW1wdHlcIiB9KTtcbiAgICBlbXB0eS5zZXRUZXh0KFwiTm8gb3V0cHV0XCIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsYWJlbDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtXCIgfSk7XG4gIHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgc2VjdGlvbi5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmVcIiwgdGV4dDogY29udGVudCB9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU291cmNlUHJldmlldyhjb250YWluZXI6IEhUTUxFbGVtZW50LCBwcmV2aWV3OiBOb25OdWxsYWJsZTxsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXT4pOiB2b2lkIHtcbiAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lci5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlld1wiIH0pO1xuICBkZXRhaWxzLm9wZW4gPSBwcmV2aWV3LmV4cGFuZGVkO1xuICBjb25zdCBzdW1tYXJ5ID0gZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlldy1zdW1tYXJ5XCIgfSk7XG4gIHN1bW1hcnkuY3JlYXRlU3Bhbih7IHRleHQ6IFwiRXh0cmFjdGVkIHNvdXJjZVwiIH0pO1xuICBzdW1tYXJ5LmNyZWF0ZVNwYW4oeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlldy1tZXRhXCIsIHRleHQ6IGZvcm1hdFNvdXJjZVByZXZpZXdNZXRhKHByZXZpZXcpIH0pO1xuICBkZXRhaWxzLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZSBsb29tLXNvdXJjZS1wcmV2aWV3LXByZVwiLCB0ZXh0OiBwcmV2aWV3LmNvbnRlbnQgfSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFNvdXJjZVByZXZpZXdNZXRhKHByZXZpZXc6IE5vbk51bGxhYmxlPGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdPik6IHN0cmluZyB7XG4gIGNvbnN0IGNhcGFiaWxpdHkgPSBwcmV2aWV3LmNhcGFiaWxpdHk7XG4gIGlmICghY2FwYWJpbGl0eSB8fCAhcHJldmlldy5zaG93Q2FwYWJpbGl0eU1ldGFkYXRhKSB7XG4gICAgcmV0dXJuIGAke3ByZXZpZXcubGFuZ3VhZ2V9IFx1MDBCNyAke3ByZXZpZXcuZGVzY3JpcHRpb259YDtcbiAgfVxuICByZXR1cm4gW1xuICAgIHByZXZpZXcubGFuZ3VhZ2UsXG4gICAgcHJldmlldy5kZXNjcmlwdGlvbixcbiAgICBgc3ltYm9sczoke2NhcGFiaWxpdHkuc3ltYm9sRXh0cmFjdGlvbn1gLFxuICAgIGBkZXBzOiR7Y2FwYWJpbGl0eS5kZXBlbmRlbmN5VHJhY2luZ31gLFxuICAgIGBjYWxsOiR7Y2FwYWJpbGl0eS5jYWxsSGFybmVzc31gLFxuICBdLmpvaW4oXCIgXHUwMEI3IFwiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJ1bm5pbmdQYW5lbCgpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLW91dHB1dC1wYW5lbCBpcy1ydW5uaW5nXCI7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBzcGlubmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNwaW5uZXJcIiB9KTtcbiAgc2V0SWNvbihzcGlubmVyLCBcImxvYWRlci1jaXJjbGVcIik7XG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KFwiUnVubmluZ1wiKTtcbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoXCJFeGVjdXRpbmcuLi5cIik7XG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1oaWRkZW5cIiwgXCJ0cnVlXCIpO1xuXG4gIHJldHVybiBwYW5lbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQVNPO0FBQ1AsbUJBQTZDO0FBQzdDLElBQUFDLGVBQTJFO0FBQzNFLElBQUFDLGdCQUF3Qjs7O0FDWnhCLHNCQUE2QztBQUM3QyxnQkFBZ0Q7QUFDaEQsSUFBQUMsbUJBQXdEO0FBQ3hELElBQUFDLGVBQWlGO0FBQ2pGLElBQUFDLHdCQUFzQjs7O0FDSnRCLHNCQUF1QztBQUN2QyxnQkFBdUI7QUFDdkIsa0JBQXFCO0FBQ3JCLDJCQUFzQjtBQXdCdEIsZUFBc0Isd0JBQ3BCLFVBQ0EsUUFDQSxVQUNZO0FBQ1osUUFBTSxVQUFVLFVBQU0sNkJBQVEsc0JBQUssa0JBQU8sR0FBRyxPQUFPLENBQUM7QUFDckQsUUFBTSxlQUFXLGtCQUFLLFNBQVMsUUFBUTtBQUV2QyxNQUFJO0FBQ0YsY0FBTSwyQkFBVSxVQUFVLDBCQUEwQixNQUFNLEdBQUcsTUFBTTtBQUNuRSxXQUFPLE1BQU0sU0FBUyxFQUFFLFNBQVMsU0FBUyxDQUFDO0FBQUEsRUFDN0MsVUFBRTtBQUNBLGNBQU0sb0JBQUcsU0FBUyxFQUFFLFdBQVcsTUFBTSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3BEO0FBQ0Y7QUFFQSxlQUFzQixtQkFDcEIsZUFDQSxRQUNBLFVBQ1k7QUFDWixTQUFPLHdCQUF3QixVQUFVLGFBQWEsSUFBSSxRQUFRLFFBQVE7QUFDNUU7QUFFQSxTQUFTLDBCQUEwQixRQUF3QjtBQUN6RCxRQUFNLFFBQVEsT0FBTyxNQUFNLElBQUk7QUFDL0IsUUFBTSxnQkFBZ0IsTUFBTSxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssRUFBRSxTQUFTLENBQUM7QUFDbkUsTUFBSSxDQUFDLGNBQWMsUUFBUTtBQUN6QixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksZUFBZSxxQkFBcUIsY0FBYyxDQUFDLENBQUM7QUFDeEQsYUFBVyxRQUFRLGNBQWMsTUFBTSxDQUFDLEdBQUc7QUFDekMsbUJBQWUsdUJBQXVCLGNBQWMscUJBQXFCLElBQUksQ0FBQztBQUM5RSxRQUFJLENBQUMsY0FBYztBQUNqQixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFFQSxNQUFJLENBQUMsY0FBYztBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sTUFDSixJQUFJLENBQUMsU0FBVSxLQUFLLEtBQUssRUFBRSxXQUFXLElBQUksT0FBTyxLQUFLLFdBQVcsWUFBWSxJQUFJLEtBQUssTUFBTSxhQUFhLE1BQU0sSUFBSSxJQUFLLEVBQ3hILEtBQUssSUFBSTtBQUNkO0FBRUEsU0FBUyxxQkFBcUIsTUFBc0I7QUFDbEQsUUFBTSxRQUFRLEtBQUssTUFBTSxTQUFTO0FBQ2xDLFNBQU8sUUFBUSxDQUFDLEtBQUs7QUFDdkI7QUFFQSxTQUFTLHVCQUF1QixNQUFjLE9BQXVCO0FBQ25FLE1BQUksUUFBUTtBQUNaLFNBQU8sUUFBUSxLQUFLLFVBQVUsUUFBUSxNQUFNLFVBQVUsS0FBSyxLQUFLLE1BQU0sTUFBTSxLQUFLLEdBQUc7QUFDbEYsYUFBUztBQUFBLEVBQ1g7QUFDQSxTQUFPLEtBQUssTUFBTSxHQUFHLEtBQUs7QUFDNUI7QUFFQSxlQUFzQixXQUFXLE1BQStDO0FBQzlFLFFBQU0sWUFBWSxvQkFBSSxLQUFLO0FBQzNCLE1BQUksU0FBUztBQUNiLE1BQUksU0FBUztBQUNiLE1BQUksV0FBMEI7QUFDOUIsTUFBSSxXQUFXO0FBQ2YsTUFBSSxZQUFZO0FBQ2hCLE1BQUksUUFBeUM7QUFDN0MsTUFBSSxnQkFBdUM7QUFDM0MsTUFBSSxlQUFvQztBQUV4QyxNQUFJO0FBQ0YsVUFBTSxJQUFJLFFBQWMsQ0FBQyxTQUFTLFdBQVc7QUFDM0Msa0JBQVEsNEJBQU0sS0FBSyxZQUFZLEtBQUssTUFBTTtBQUFBLFFBQ3hDLEtBQUssS0FBSztBQUFBLFFBQ1YsT0FBTztBQUFBLFFBQ1AsS0FBSztBQUFBLFVBQ0gsR0FBRyxRQUFRO0FBQUEsVUFDWCxHQUFHLEtBQUs7QUFBQSxRQUNWO0FBQUEsTUFDRixDQUFDO0FBRUQsWUFBTSxRQUFRLE1BQU07QUFDbEIsb0JBQVk7QUFDWixlQUFPLEtBQUssU0FBUztBQUFBLE1BQ3ZCO0FBQ0EscUJBQWU7QUFFZixVQUFJLEtBQUssT0FBTyxTQUFTO0FBQ3ZCLGNBQU07QUFBQSxNQUNSLE9BQU87QUFDTCxhQUFLLE9BQU8saUJBQWlCLFNBQVMsT0FBTyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQUEsTUFDN0Q7QUFFQSxzQkFBZ0IsV0FBVyxNQUFNO0FBQy9CLG1CQUFXO0FBQ1gsZUFBTyxLQUFLLFNBQVM7QUFBQSxNQUN2QixHQUFHLEtBQUssU0FBUztBQUVqQixZQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsVUFBVTtBQUNsQyxrQkFBVSxNQUFNLFNBQVM7QUFBQSxNQUMzQixDQUFDO0FBRUQsWUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFVBQVU7QUFDbEMsa0JBQVUsTUFBTSxTQUFTO0FBQUEsTUFDM0IsQ0FBQztBQUVELFlBQU0sR0FBRyxTQUFTLENBQUMsVUFBVTtBQUMzQixlQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFFRCxZQUFNLEdBQUcsU0FBUyxDQUFDLFNBQVM7QUFDMUIsbUJBQVc7QUFDWCxnQkFBUTtBQUFBLE1BQ1YsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0gsU0FBUyxPQUFPO0FBQ2QsYUFBUyxVQUFVLG1CQUFtQixPQUFPLEtBQUssVUFBVTtBQUM1RCxlQUFXLFlBQVk7QUFBQSxFQUN6QixVQUFFO0FBQ0EsUUFBSSxjQUFjO0FBQ2hCLFdBQUssT0FBTyxvQkFBb0IsU0FBUyxZQUFZO0FBQUEsSUFDdkQ7QUFDQSxRQUFJLGVBQWU7QUFDakIsbUJBQWEsYUFBYTtBQUFBLElBQzVCO0FBQUEsRUFDRjtBQUVBLFFBQU0sYUFBYSxvQkFBSSxLQUFLO0FBQzVCLFFBQU0sYUFBYSxXQUFXLFFBQVEsSUFBSSxVQUFVLFFBQVE7QUFDNUQsUUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLGFBQWEsYUFBYTtBQUV4RCxTQUFPO0FBQUEsSUFDTCxVQUFVLEtBQUs7QUFBQSxJQUNmLFlBQVksS0FBSztBQUFBLElBQ2pCLFdBQVcsVUFBVSxZQUFZO0FBQUEsSUFDakMsWUFBWSxXQUFXLFlBQVk7QUFBQSxJQUNuQztBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsbUJBQW1CLE9BQWdCLFlBQTRCO0FBQ3RFLE1BQUksaUJBQWlCLFNBQVMsVUFBVSxTQUFVLE1BQWdDLFNBQVMsVUFBVTtBQUNuRyxXQUFPLHlCQUF5QixVQUFVO0FBQUEsRUFDNUM7QUFFQSxTQUFPLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDOUQ7QUFFQSxlQUFzQixtQkFBbUIsTUFBa0Q7QUFDekYsU0FBTztBQUFBLElBQW1CLEtBQUs7QUFBQSxJQUFlLEtBQUs7QUFBQSxJQUFRLE9BQU8sRUFBRSxVQUFVLFFBQVEsTUFDcEYsV0FBVztBQUFBLE1BQ1QsVUFBVSxLQUFLO0FBQUEsTUFDZixZQUFZLEtBQUs7QUFBQSxNQUNqQixZQUFZLEtBQUs7QUFBQSxNQUNqQixNQUFNLEtBQUssS0FBSyxJQUFJLENBQUMsVUFBVSxNQUFNLFdBQVcsVUFBVSxRQUFRLEVBQUUsV0FBVyxhQUFhLE9BQU8sQ0FBQztBQUFBLE1BQ3BHLGtCQUFrQixLQUFLO0FBQUEsTUFDdkIsV0FBVyxLQUFLO0FBQUEsTUFDaEIsUUFBUSxLQUFLO0FBQUEsTUFDYixLQUFLLG1CQUFtQixLQUFLLEtBQUssVUFBVSxPQUFPO0FBQUEsSUFDckQsQ0FBQztBQUFBLEVBQ0g7QUFDRjtBQUVBLFNBQVMsbUJBQW1CLEtBQW9DLFVBQWtCLFNBQWdEO0FBQ2hJLE1BQUksQ0FBQyxLQUFLO0FBQ1IsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLE9BQU87QUFBQSxJQUNaLE9BQU8sUUFBUSxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLE1BQU07QUFBQSxNQUN4QztBQUFBLE1BQ0EsT0FBTyxVQUFVLFdBQVcsTUFBTSxXQUFXLFVBQVUsUUFBUSxFQUFFLFdBQVcsYUFBYSxPQUFPLElBQUk7QUFBQSxJQUN0RyxDQUFDO0FBQUEsRUFDSDtBQUNGOzs7QUNqTk8sU0FBUyxpQkFBaUIsT0FBeUI7QUFDeEQsUUFBTSxRQUFrQixDQUFDO0FBQ3pCLE1BQUksVUFBVTtBQUNkLE1BQUksUUFBMkI7QUFDL0IsTUFBSSxXQUFXO0FBRWYsYUFBVyxRQUFRLE1BQU0sS0FBSyxHQUFHO0FBQy9CLFFBQUksVUFBVTtBQUNaLGlCQUFXO0FBQ1gsaUJBQVc7QUFDWDtBQUFBLElBQ0Y7QUFFQSxRQUFJLFNBQVMsTUFBTTtBQUNqQixpQkFBVztBQUNYO0FBQUEsSUFDRjtBQUVBLFNBQUssU0FBUyxPQUFPLFNBQVMsUUFBUyxDQUFDLE9BQU87QUFDN0MsY0FBUTtBQUNSO0FBQUEsSUFDRjtBQUVBLFFBQUksU0FBUyxPQUFPO0FBQ2xCLGNBQVE7QUFDUjtBQUFBLElBQ0Y7QUFFQSxRQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssQ0FBQyxPQUFPO0FBQzdCLFVBQUksU0FBUztBQUNYLGNBQU0sS0FBSyxPQUFPO0FBQ2xCLGtCQUFVO0FBQUEsTUFDWjtBQUNBO0FBQUEsSUFDRjtBQUVBLGVBQVc7QUFBQSxFQUNiO0FBRUEsTUFBSSxTQUFTO0FBQ1gsVUFBTSxLQUFLLE9BQU87QUFBQSxFQUNwQjtBQUVBLFNBQU87QUFDVDs7O0FGdURPLElBQU0sc0JBQU4sTUFBMEI7QUFBQSxFQUcvQixZQUNtQixLQUNBLFdBQ2pCO0FBRmlCO0FBQ0E7QUFKbkIsU0FBaUIsY0FBYyxvQkFBSSxJQUFZO0FBQUEsRUFLM0M7QUFBQSxFQUVKLHNCQUFzQixNQUE0QjtBQUNoRCxVQUFNLGNBQWMsS0FBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLEdBQUc7QUFDL0QsVUFBTSxRQUFRLGNBQWMsZ0JBQWdCO0FBQzVDLFdBQU8sT0FBTyxVQUFVLFlBQVksTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUk7QUFBQSxFQUNwRTtBQUFBLEVBRUEsTUFBTSxvQkFBc0U7QUFDMUUsVUFBTSxpQkFBaUIsS0FBSyxrQkFBa0I7QUFDOUMsUUFBSSxLQUFDLHNCQUFXLGNBQWMsR0FBRztBQUMvQixhQUFPLENBQUM7QUFBQSxJQUNWO0FBRUEsVUFBTSxVQUFVLFVBQU0sMEJBQVEsZ0JBQWdCLEVBQUUsZUFBZSxLQUFLLENBQUM7QUFDckUsV0FBTyxRQUFRO0FBQUEsTUFDYixRQUNHLE9BQU8sQ0FBQyxVQUFVLE1BQU0sWUFBWSxDQUFDLEVBQ3JDLElBQUksT0FBTyxVQUFVO0FBQ3BCLGNBQU0sZ0JBQVksbUJBQUssZ0JBQWdCLE1BQU0sSUFBSTtBQUNqRCxjQUFNLGdCQUFZLDBCQUFXLG1CQUFLLFdBQVcsYUFBYSxDQUFDO0FBQzNELGNBQU0sb0JBQWdCLDBCQUFXLG1CQUFLLFdBQVcsWUFBWSxDQUFDO0FBQzlELFlBQUksQ0FBQyxXQUFXO0FBQ2QsaUJBQU87QUFBQSxZQUNMLE1BQU0sTUFBTTtBQUFBLFlBQ1osUUFBUTtBQUFBLFVBQ1Y7QUFBQSxRQUNGO0FBQ0EsWUFBSTtBQUNGLGdCQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVcsU0FBUztBQUM5QyxnQkFBTSxTQUFTLENBQUMsWUFBWSxPQUFPLE9BQU8sRUFBRTtBQUM1QyxlQUFLLE9BQU8sWUFBWSxZQUFZLE9BQU8sWUFBWSxhQUFhLGVBQWU7QUFDakYsbUJBQU8sS0FBSyxZQUFZO0FBQUEsVUFDMUI7QUFDQSxjQUFJLE9BQU8sWUFBWSxVQUFVLE9BQU8sTUFBTSxXQUFXO0FBQ3ZELG1CQUFPLEtBQUssUUFBUSxPQUFPLEtBQUssU0FBUyxFQUFFO0FBQUEsVUFDN0M7QUFDQSxjQUFJLE9BQU8sWUFBWSxVQUFVLE9BQU8sTUFBTSxTQUFTLFNBQVM7QUFDOUQsbUJBQU8sS0FBSyxZQUFZLE1BQU0sS0FBSyxxQkFBcUIsV0FBVyxPQUFPLEtBQUssT0FBTyxDQUFDLEVBQUU7QUFBQSxVQUMzRjtBQUNBLGNBQUksT0FBTyxZQUFZLFlBQVksT0FBTyxRQUFRLFlBQVk7QUFDNUQsbUJBQU8sS0FBSyxZQUFZLE9BQU8sT0FBTyxVQUFVLEVBQUU7QUFBQSxVQUNwRDtBQUNBLGdCQUFNLGdCQUFnQixPQUFPLEtBQUssT0FBTyxTQUFTLEVBQUU7QUFDcEQsaUJBQU8sS0FBSyxHQUFHLGFBQWEsWUFBWSxrQkFBa0IsSUFBSSxLQUFLLEdBQUcsRUFBRTtBQUN4RSxpQkFBTztBQUFBLFlBQ0wsTUFBTSxNQUFNO0FBQUEsWUFDWixRQUFRLE9BQU8sS0FBSyxJQUFJO0FBQUEsVUFDMUI7QUFBQSxRQUNGLFNBQVMsT0FBTztBQUNkLGlCQUFPO0FBQUEsWUFDTCxNQUFNLE1BQU07QUFBQSxZQUNaLFFBQVEsd0JBQXdCLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQztBQUFBLFVBQ3hGO0FBQUEsUUFDRjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLElBQUksT0FBc0IsU0FBeUIsVUFBOEIsV0FBMkM7QUFDaEksVUFBTSxZQUFZLEtBQUssaUJBQWlCLFNBQVM7QUFDakQsVUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXLFNBQVM7QUFDOUMsVUFBTSxhQUFhLE9BQU8sVUFBVSxNQUFNLFFBQVEsS0FBSyxPQUFPLFVBQVUsTUFBTSxhQUFhO0FBRTNGLFFBQUksYUFBYTtBQUNqQixRQUFJLFdBQStDO0FBRW5ELFFBQUksWUFBWTtBQUNkLFVBQUksV0FBVyxZQUFZO0FBQ3pCLG1CQUFXLEtBQUsseUJBQXlCLE1BQU0sVUFBVSxRQUFRLEtBQUssS0FBSyx5QkFBeUIsTUFBTSxlQUFlLFFBQVE7QUFBQSxNQUNuSSxPQUFPO0FBQ0wsbUJBQVc7QUFBQSxNQUNiO0FBQUEsSUFDRixPQUFPO0FBQ0wsaUJBQVcsS0FBSyx5QkFBeUIsTUFBTSxVQUFVLFFBQVEsS0FBSyxLQUFLLHlCQUF5QixNQUFNLGVBQWUsUUFBUTtBQUNqSSxtQkFBYTtBQUFBLElBQ2Y7QUFFQSxRQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsV0FBVyxDQUFDLFNBQVMsV0FBVztBQUN6RCxZQUFNLElBQUksTUFBTSxtQkFBbUIsU0FBUyx1QkFBdUIsTUFBTSxRQUFRLEdBQUc7QUFBQSxJQUN0RjtBQUVBLGNBQU0sd0JBQU0sV0FBVyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQzFDLFVBQU0sS0FBSyxlQUFlLE9BQU8sYUFBYSxXQUFXLFFBQVEsV0FBVyxRQUFRLFFBQVEsYUFBYSxTQUFTLFdBQVcsYUFBYSxTQUFTLGVBQWU7QUFDbEssVUFBTSxlQUFlLFFBQVEsS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxHQUFHLG1CQUFtQixTQUFTLFNBQVMsQ0FBQztBQUN2SCxVQUFNLG1CQUFlLG1CQUFLLFdBQVcsWUFBWTtBQUVqRCxRQUFJO0FBQ0YsZ0JBQU0sNEJBQVUsY0FBYyxNQUFNLFNBQVMsTUFBTTtBQUNuRCxVQUFJO0FBQ0osY0FBUSxPQUFPLFNBQVM7QUFBQSxRQUN0QixLQUFLO0FBQUEsUUFDTCxLQUFLO0FBQ0gsbUJBQVMsTUFBTSxLQUFLLGdCQUFnQixXQUFXLFdBQVcsUUFBUSxVQUFVLGNBQWMsU0FBUyxRQUFRO0FBQzNHO0FBQUEsUUFDRixLQUFLO0FBQ0gsbUJBQVMsTUFBTSxLQUFLLFFBQVEsV0FBVyxXQUFXLFFBQVEsVUFBVSxjQUFjLE9BQU87QUFDekY7QUFBQSxRQUNGLEtBQUs7QUFDSCxtQkFBUyxNQUFNLEtBQUssVUFBVSxXQUFXLFdBQVcsUUFBUSxPQUFPLFVBQVUsY0FBYyxjQUFjLE9BQU87QUFDaEg7QUFBQSxRQUNGLEtBQUs7QUFDSCxtQkFBUyxNQUFNLEtBQUssZ0JBQWdCLFdBQVcsV0FBVyxRQUFRLFVBQVUsY0FBYyxPQUFPO0FBQ2pHO0FBQUEsUUFDRjtBQUNFLGdCQUFNLElBQUksTUFBTSx3QkFBd0IsT0FBTyxPQUFPLEVBQUU7QUFBQSxNQUM1RDtBQUVBLFVBQUksWUFBWTtBQUNkLGNBQU0sY0FBYyxvQkFBb0IsTUFBTSxRQUFRLHlFQUF5RSxTQUFTLE9BQU87QUFDL0ksZUFBTyxVQUFVLE9BQU8sVUFBVSxHQUFHLE9BQU8sT0FBTztBQUFBLEVBQUssV0FBVyxLQUFLO0FBQUEsTUFDMUU7QUFDQSxhQUFPO0FBQUEsSUFDVCxVQUFFO0FBQ0EsZ0JBQU0scUJBQUcsY0FBYyxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsSUFDeEM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFdBQVcsV0FBbUIsV0FBbUIsUUFBNkM7QUFDbEcsVUFBTSxZQUFZLEtBQUssaUJBQWlCLFNBQVM7QUFDakQsVUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXLFNBQVM7QUFDOUMsY0FBTSx3QkFBTSxXQUFXLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFDMUMsVUFBTSxLQUFLLGVBQWUsT0FBTyxhQUFhLFdBQVcsV0FBVyxRQUFRLGFBQWEsU0FBUyxXQUFXLGFBQWEsU0FBUyxlQUFlO0FBQ2xKLFlBQVEsT0FBTyxTQUFTO0FBQUEsTUFDdEIsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU8sS0FBSyxXQUFXLFdBQVcsV0FBVyxRQUFRLFdBQVcsTUFBTTtBQUFBLE1BQ3hFLEtBQUs7QUFDSCxlQUFPLEtBQUssVUFBVSxXQUFXLFdBQVcsUUFBUSxXQUFXLE1BQU07QUFBQSxNQUN2RSxLQUFLO0FBQ0gsZUFBTyxLQUFLLGlCQUFpQixXQUFXLFdBQVcsUUFBUSxLQUFLLG9CQUFvQixTQUFTLFdBQVcsV0FBVyxRQUFRLFNBQVMsR0FBRyxXQUFXLE1BQU07QUFBQSxNQUMxSixLQUFLO0FBQ0gsZUFBTyxLQUFLO0FBQUEsVUFDVixhQUFhLFNBQVM7QUFBQSxVQUN0QixPQUFPLFNBQVM7QUFBQSxVQUNoQixtQkFBbUIsT0FBTyxTQUFTLFdBQVc7QUFBQTtBQUFBLFFBQ2hEO0FBQUEsSUFDSjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsZ0JBQ1osV0FDQSxXQUNBLFFBQ0EsVUFDQSxjQUNBLFNBQ0EsVUFDd0I7QUFDeEIsVUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhLFdBQVcsV0FBVyxRQUFRLFNBQVMsUUFBUTtBQUNyRixVQUFNLFVBQVUsaUJBQWlCLFNBQVMsUUFBUyxXQUFXLFVBQVUsWUFBWSxDQUFDO0FBQ3JGLFFBQUksQ0FBQyxRQUFRLFFBQVE7QUFDbkIsWUFBTSxJQUFJLE1BQU0sNkJBQTZCO0FBQUEsSUFDL0M7QUFFQSxXQUFPLE1BQU0sV0FBVztBQUFBLE1BQ3RCLFVBQVUsYUFBYSxTQUFTO0FBQUEsTUFDaEMsWUFBWSxHQUFHLGFBQWEsT0FBTyxPQUFPLENBQUMsSUFBSSxTQUFTO0FBQUEsTUFDeEQsWUFBWSxLQUFLLGtCQUFrQixNQUFNO0FBQUEsTUFDekMsTUFBTTtBQUFBLFFBQ0o7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsR0FBRyxTQUFTO0FBQUEsUUFDWjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQSxHQUFHO0FBQUEsTUFDTDtBQUFBLE1BQ0Esa0JBQWtCO0FBQUEsTUFDbEIsV0FBVyxRQUFRO0FBQUEsTUFDbkIsUUFBUSxRQUFRO0FBQUEsSUFDbEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsUUFDWixXQUNBLFdBQ0EsUUFDQSxVQUNBLGNBQ0EsU0FDd0I7QUFDeEIsVUFBTSxPQUFPLEtBQUssa0JBQWtCLE1BQU07QUFDMUMsVUFBTSxLQUFLLG1CQUFtQixLQUFLLGNBQWMsV0FBVyxRQUFRLFdBQVcsUUFBUSxRQUFRLGFBQWEsU0FBUyxlQUFlLFFBQVEsU0FBUyxRQUFRO0FBQzdKLFVBQU0sS0FBSyxrQkFBa0IsV0FBVyxXQUFXLE1BQU0sUUFBUSxXQUFXLFFBQVEsTUFBTTtBQUMxRixVQUFNLEtBQUssZUFBZSxLQUFLLGFBQWEsV0FBVyxRQUFRLFdBQVcsUUFBUSxRQUFRLGFBQWEsU0FBUyxnQkFBZ0IsUUFBUSxTQUFTLGVBQWU7QUFFaEssUUFBSTtBQUNGLFlBQU0sYUFBYSxhQUFBQyxNQUFVLEtBQUssS0FBSyxpQkFBaUIsWUFBWTtBQUNwRSxZQUFNLGdCQUFnQixTQUFTLFFBQVMsV0FBVyxVQUFVLFdBQVcsVUFBVSxDQUFDO0FBQ25GLFVBQUksQ0FBQyxjQUFjLEtBQUssR0FBRztBQUN6QixjQUFNLElBQUksTUFBTSx3QkFBd0I7QUFBQSxNQUMxQztBQUVBLGFBQU8sTUFBTSxXQUFXO0FBQUEsUUFDdEIsVUFBVSxhQUFhLFNBQVM7QUFBQSxRQUNoQyxZQUFZLFFBQVEsU0FBUztBQUFBLFFBQzdCLFlBQVksS0FBSyxpQkFBaUI7QUFBQSxRQUNsQyxNQUFNO0FBQUEsVUFDSixHQUFHLGlCQUFpQixLQUFLLFdBQVcsRUFBRTtBQUFBLFVBQ3RDLEtBQUs7QUFBQSxVQUNMLE1BQU0sV0FBVyxLQUFLLGVBQWUsQ0FBQyxPQUFPLGFBQWE7QUFBQSxRQUM1RDtBQUFBLFFBQ0Esa0JBQWtCO0FBQUEsUUFDbEIsV0FBVyxRQUFRO0FBQUEsUUFDbkIsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUFBLElBQ0gsVUFBRTtBQUNBLFlBQU0sS0FBSyxtQkFBbUIsS0FBSyxpQkFBaUIsV0FBVyxRQUFRLFdBQVcsUUFBUSxRQUFRLGFBQWEsU0FBUyxrQkFBa0IsUUFBUSxTQUFTLFdBQVc7QUFDdEssWUFBTSxLQUFLLHdCQUF3QixXQUFXLFdBQVcsTUFBTSxRQUFRLFdBQVcsUUFBUSxNQUFNO0FBQUEsSUFDbEc7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFVBQ1osV0FDQSxXQUNBLFFBQ0EsT0FDQSxVQUNBLGNBQ0EsY0FDQSxTQUN3QjtBQUN4QixVQUFNLFVBQVUsU0FBUyxRQUFTLFdBQVcsVUFBVSxZQUFZO0FBQ25FLFVBQU0sU0FBUyxNQUFNLEtBQUs7QUFBQSxNQUN4QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxLQUFLLG9CQUFvQixPQUFPLFdBQVcsV0FBVyxRQUFRLFFBQVEsV0FBVztBQUFBLFFBQy9FLFVBQVUsTUFBTTtBQUFBLFFBQ2hCLGVBQWUsTUFBTTtBQUFBLFFBQ3JCLFVBQVU7QUFBQSxRQUNWLFVBQVU7QUFBQSxRQUNWO0FBQUEsTUFDRixDQUFDO0FBQUEsTUFDRCxRQUFRO0FBQUEsTUFDUixRQUFRO0FBQUEsSUFDVjtBQUVBLFFBQUksT0FBTyxRQUFRLFVBQVU7QUFDM0IsWUFBTSxXQUFXLE1BQU0sS0FBSztBQUFBLFFBQzFCO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLEtBQUssb0JBQW9CLFlBQVksV0FBVyxXQUFXLFFBQVEsUUFBUSxXQUFXO0FBQUEsVUFDcEYsVUFBVSxNQUFNO0FBQUEsVUFDaEIsZUFBZSxNQUFNO0FBQUEsVUFDckIsVUFBVTtBQUFBLFVBQ1YsVUFBVTtBQUFBLFVBQ1Y7QUFBQSxRQUNGLENBQUM7QUFBQSxRQUNELFFBQVE7QUFBQSxRQUNSLFFBQVE7QUFBQSxNQUNWO0FBQ0EsVUFBSSxDQUFDLFNBQVMsU0FBUztBQUNyQixlQUFPLFVBQVUsbUNBQW1DLFNBQVMsVUFBVSxTQUFTLFVBQVUsUUFBUSxTQUFTLFFBQVEsRUFBRTtBQUFBLE1BQ3ZIO0FBQUEsSUFDRjtBQUVBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLGdCQUNaLFdBQ0EsV0FDQSxRQUNBLFVBQ0EsY0FDQSxTQUN3QjtBQUN4QixVQUFNLGVBQWUsS0FBSyxtQkFBbUIsU0FBUztBQUN0RCxVQUFNLFVBQVUsU0FBUyxRQUFTLFdBQVcsVUFBVSxZQUFZO0FBQ25FLFFBQUksQ0FBQyxRQUFRLEtBQUssR0FBRztBQUNuQixZQUFNLElBQUksTUFBTSx1QkFBdUI7QUFBQSxJQUN6QztBQUVBLFVBQU0sYUFBYSxPQUFPLEtBQUssY0FBYyxDQUFDLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLElBQUk7QUFDN0UsVUFBTSxVQUFVLENBQUMsUUFBUSxHQUFHLFlBQVksT0FBTyxhQUFhLFdBQVcsS0FBSyxLQUFLLENBQUMsUUFBUSxPQUFPLEVBQUU7QUFDbkcsUUFBSSxPQUFPLE9BQU8sS0FBSyxHQUFHO0FBQ3hCLGNBQVEsUUFBUSxNQUFNLE9BQU8sTUFBTSxLQUFLLENBQUM7QUFBQSxJQUMzQztBQUVBLFdBQU8sTUFBTSxXQUFXO0FBQUEsTUFDdEIsVUFBVSxhQUFhLFNBQVM7QUFBQSxNQUNoQyxZQUFZLE9BQU8sU0FBUztBQUFBLE1BQzVCLFlBQVk7QUFBQSxNQUNaLE1BQU07QUFBQSxNQUNOLGtCQUFrQjtBQUFBLE1BQ2xCLFdBQVcsUUFBUTtBQUFBLE1BQ25CLFFBQVEsUUFBUTtBQUFBLElBQ2xCLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFUSxtQkFBbUIsYUFBNkI7QUFDdEQsVUFBTSxRQUFRLFlBQVksTUFBTSxvQkFBb0I7QUFDcEQsUUFBSSxPQUFPO0FBQ1QsWUFBTSxRQUFRLE1BQU0sQ0FBQyxFQUFFLFlBQVk7QUFDbkMsWUFBTSxPQUFPLE1BQU0sQ0FBQyxFQUFFLFFBQVEsT0FBTyxHQUFHO0FBQ3hDLGFBQU8sUUFBUSxLQUFLLElBQUksSUFBSTtBQUFBLElBQzlCO0FBQ0EsUUFBSSxZQUFZLFNBQVMsSUFBSSxHQUFHO0FBQzlCLGFBQU8sWUFBWSxRQUFRLE9BQU8sR0FBRztBQUFBLElBQ3ZDO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsYUFDWixXQUNBLFdBQ0EsUUFDQSxTQUNBLFVBQ2lCO0FBQ2pCLFVBQU0saUJBQWEsbUJBQUssV0FBVyxZQUFZO0FBQy9DLFFBQUksS0FBQyxzQkFBVyxVQUFVLEdBQUc7QUFDM0IsYUFBTyxPQUFPLFNBQVM7QUFBQSxJQUN6QjtBQUVBLFVBQU0sUUFBUSxLQUFLLGtCQUFrQixTQUFTO0FBQzlDLFVBQU0sV0FBVyxHQUFHLEtBQUssa0JBQWtCLE1BQU0sQ0FBQyxJQUFJLEtBQUs7QUFDM0QsUUFBSSxLQUFLLFlBQVksSUFBSSxRQUFRLEdBQUc7QUFDbEMsYUFBTztBQUFBLElBQ1Q7QUFFQSxVQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVcsV0FBVyxXQUFXLFFBQVEsS0FBSyxJQUFJLFFBQVEsV0FBVyxTQUFTLGtCQUFrQixJQUFPLEdBQUcsUUFBUSxNQUFNO0FBQ2xKLFFBQUksQ0FBQyxPQUFPLFNBQVM7QUFDbkIsWUFBTSxJQUFJLE1BQU0sT0FBTyxVQUFVLE9BQU8sVUFBVSxHQUFHLGFBQWEsT0FBTyxPQUFPLENBQUMscUJBQXFCLFNBQVMsR0FBRztBQUFBLElBQ3BIO0FBRUEsU0FBSyxZQUFZLElBQUksUUFBUTtBQUM3QixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBYyxXQUNaLFdBQ0EsV0FDQSxRQUNBLFdBQ0EsUUFDd0I7QUFDeEIsVUFBTSxRQUFRLEtBQUssa0JBQWtCLFNBQVM7QUFDOUMsUUFBSSxLQUFDLDBCQUFXLG1CQUFLLFdBQVcsWUFBWSxDQUFDLEdBQUc7QUFDOUMsYUFBTyxLQUFLO0FBQUEsUUFDVixhQUFhLFNBQVM7QUFBQSxRQUN0QixHQUFHLGFBQWEsT0FBTyxPQUFPLENBQUMsSUFBSSxTQUFTO0FBQUEsUUFDNUMseUNBQXlDLE9BQU8sU0FBUyxlQUFlO0FBQUE7QUFBQSxNQUMxRTtBQUFBLElBQ0Y7QUFDQSxXQUFPLFdBQVc7QUFBQSxNQUNoQixVQUFVLGFBQWEsU0FBUztBQUFBLE1BQ2hDLFlBQVksR0FBRyxhQUFhLE9BQU8sT0FBTyxDQUFDLElBQUksU0FBUztBQUFBLE1BQ3hELFlBQVksS0FBSyxrQkFBa0IsTUFBTTtBQUFBLE1BQ3pDLE1BQU0sQ0FBQyxTQUFTLE1BQU0sT0FBTyxTQUFTO0FBQUEsTUFDdEMsa0JBQWtCO0FBQUEsTUFDbEI7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyxVQUFVLFdBQW1CLFdBQW1CLFFBQTZCLFdBQW1CLFFBQTZDO0FBQ3pKLFVBQU0sT0FBTyxLQUFLLGtCQUFrQixNQUFNO0FBQzFDLFFBQUksQ0FBQyxLQUFLLGNBQWMsS0FBSyxHQUFHO0FBQzlCLGFBQU8sS0FBSyxzQkFBc0IsYUFBYSxTQUFTLGVBQWUsUUFBUSxTQUFTLFVBQVUscUNBQXFDO0FBQUEsSUFDekk7QUFDQSxXQUFPLEtBQUssZUFBZSxLQUFLLGNBQWMsV0FBVyxXQUFXLFFBQVEsYUFBYSxTQUFTLGVBQWUsUUFBUSxTQUFTLFFBQVE7QUFBQSxFQUM1STtBQUFBLEVBRUEsTUFBYyxXQUFXLFdBQWlEO0FBQ3hFLFVBQU0saUJBQWEsbUJBQUssV0FBVyxhQUFhO0FBQ2hELFFBQUk7QUFDSixRQUFJO0FBQ0YsWUFBTSxLQUFLLE1BQU0sVUFBTSwyQkFBUyxZQUFZLE1BQU0sQ0FBQztBQUFBLElBQ3JELFNBQVMsT0FBTztBQUNkLFlBQU0sSUFBSSxNQUFNLG1DQUFtQyxVQUFVLEtBQUssaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxJQUM1SDtBQUVBLFFBQUksQ0FBQyxPQUFPLE9BQU8sUUFBUSxZQUFZLE1BQU0sUUFBUSxHQUFHLEdBQUc7QUFDekQsWUFBTSxJQUFJLE1BQU0scUNBQXFDO0FBQUEsSUFDdkQ7QUFFQSxVQUFNLE9BQU87QUFVYixVQUFNLFVBQVUsS0FBSyxZQUFZLEtBQUssT0FBTztBQUM3QyxRQUFJLEtBQUssY0FBYyxRQUFRLE9BQU8sS0FBSyxlQUFlLFVBQVU7QUFDbEUsWUFBTSxJQUFJLE1BQU0sK0NBQStDO0FBQUEsSUFDakU7QUFDQSxRQUFJLEtBQUssU0FBUyxRQUFRLE9BQU8sS0FBSyxVQUFVLFVBQVU7QUFDeEQsWUFBTSxJQUFJLE1BQU0sMENBQTBDO0FBQUEsSUFDNUQ7QUFDQSxRQUFJLENBQUMsS0FBSyxhQUFhLE9BQU8sS0FBSyxjQUFjLFlBQVksTUFBTSxRQUFRLEtBQUssU0FBUyxHQUFHO0FBQzFGLFlBQU0sSUFBSSxNQUFNLCtDQUErQztBQUFBLElBQ2pFO0FBRUEsVUFBTSxZQUF5RCxDQUFDO0FBQ2hFLGVBQVcsQ0FBQyxVQUFVLEtBQUssS0FBSyxPQUFPLFFBQVEsS0FBSyxTQUFvQyxHQUFHO0FBQ3pGLFVBQUksQ0FBQyxTQUFTLE9BQU8sVUFBVSxZQUFZLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDL0QsY0FBTSxJQUFJLE1BQU0sc0JBQXNCLFFBQVEscUJBQXFCO0FBQUEsTUFDckU7QUFDQSxZQUFNLGlCQUFpQjtBQUN2QixZQUFNLGFBQWEsZUFBZSxlQUFlO0FBRWpELFVBQUksQ0FBQyxlQUFlLE9BQU8sZUFBZSxZQUFZLFlBQVksQ0FBQyxlQUFlLFFBQVEsS0FBSyxJQUFJO0FBQ2pHLGNBQU0sSUFBSSxNQUFNLHNCQUFzQixRQUFRLHFDQUFxQztBQUFBLE1BQ3JGO0FBRUEsZ0JBQVUsUUFBUSxJQUFJO0FBQUEsUUFDcEIsU0FBUyxPQUFPLGVBQWUsWUFBWSxXQUFXLGVBQWUsVUFBVTtBQUFBLFFBQy9FLFdBQVcsT0FBTyxlQUFlLGNBQWMsV0FBVyxlQUFlLFlBQVksYUFBYSxTQUFZLElBQUksUUFBUTtBQUFBLFFBQzFILFlBQVksY0FBYztBQUFBLE1BQzVCO0FBQUEsSUFDRjtBQUVBLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxZQUFZLE9BQU8sS0FBSyxlQUFlLFlBQVksS0FBSyxXQUFXLEtBQUssSUFBSSxLQUFLLFdBQVcsS0FBSyxJQUFJO0FBQUEsTUFDckcsT0FBTyxPQUFPLEtBQUssVUFBVSxXQUFXLEtBQUssUUFBUTtBQUFBLE1BQ3JELEtBQUssS0FBSyxjQUFjLEtBQUssR0FBRztBQUFBLE1BQ2hDLGFBQWEsS0FBSyxnQkFBZ0IsS0FBSyxhQUFhLDhCQUE4QjtBQUFBLE1BQ2xGLE1BQU0sS0FBSyxlQUFlLEtBQUssSUFBSTtBQUFBLE1BQ25DLFFBQVEsS0FBSyxpQkFBaUIsS0FBSyxNQUFNO0FBQUEsTUFDekM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsWUFBWSxPQUFzQztBQUN4RCxRQUFJLFNBQVMsTUFBTTtBQUNqQixhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUksVUFBVSxZQUFZLFVBQVUsWUFBWSxVQUFVLFVBQVUsVUFBVSxZQUFZLFVBQVUsT0FBTztBQUN6RyxhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sSUFBSSxNQUFNLHdFQUF3RTtBQUFBLEVBQzFGO0FBQUEsRUFFUSxjQUFjLE9BQTJDO0FBQy9ELFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSx5Q0FBeUM7QUFBQSxJQUMzRDtBQUNBLFVBQU0sT0FBTztBQUNiLFdBQU87QUFBQSxNQUNMLGFBQWEsS0FBSyxnQkFBZ0I7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFBQSxFQUVRLGVBQWUsT0FBNEM7QUFDakUsUUFBSSxTQUFTLE1BQU07QUFDakIsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLENBQUMsU0FBUyxPQUFPLFVBQVUsWUFBWSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQy9ELFlBQU0sSUFBSSxNQUFNLDBDQUEwQztBQUFBLElBQzVEO0FBQ0EsVUFBTSxPQUFPO0FBQ2IsUUFBSSxPQUFPLEtBQUssY0FBYyxZQUFZLENBQUMsS0FBSyxVQUFVLEtBQUssR0FBRztBQUNoRSxZQUFNLElBQUksTUFBTSxtREFBbUQ7QUFBQSxJQUNyRTtBQUNBLFFBQUksT0FBTyxLQUFLLG9CQUFvQixZQUFZLENBQUMsS0FBSyxnQkFBZ0IsS0FBSyxHQUFHO0FBQzVFLFlBQU0sSUFBSSxNQUFNLHlEQUF5RDtBQUFBLElBQzNFO0FBRUEsV0FBTztBQUFBLE1BQ0wsV0FBVyxLQUFLLFVBQVUsS0FBSztBQUFBLE1BQy9CLGlCQUFpQixLQUFLLGdCQUFnQixLQUFLO0FBQUEsTUFDM0MsZUFBZSxlQUFlLEtBQUssYUFBYTtBQUFBLE1BQ2hELFNBQVMsZUFBZSxLQUFLLE9BQU87QUFBQSxNQUNwQyxjQUFjLGVBQWUsS0FBSyxZQUFZO0FBQUEsTUFDOUMsY0FBYyxlQUFlLEtBQUssWUFBWTtBQUFBLE1BQzlDLGlCQUFpQixlQUFlLEtBQUssZUFBZTtBQUFBLE1BQ3BELGFBQWEsS0FBSyxnQkFBZ0IsS0FBSyxhQUFhLG1DQUFtQztBQUFBLE1BQ3ZGLFNBQVMsS0FBSyxzQkFBc0IsS0FBSyxPQUFPO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBQUEsRUFFUSxzQkFBc0IsT0FBbUQ7QUFDL0UsUUFBSSxTQUFTLE1BQU07QUFDakIsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLENBQUMsU0FBUyxPQUFPLFVBQVUsWUFBWSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQy9ELFlBQU0sSUFBSSxNQUFNLGtEQUFrRDtBQUFBLElBQ3BFO0FBQ0EsVUFBTSxPQUFPO0FBQ2IsV0FBTztBQUFBLE1BQ0wsU0FBUyxLQUFLLFlBQVk7QUFBQSxNQUMxQixZQUFZLGVBQWUsS0FBSyxVQUFVO0FBQUEsTUFDMUMsTUFBTSxlQUFlLEtBQUssSUFBSTtBQUFBLE1BQzlCLE9BQU8sZUFBZSxLQUFLLEtBQUs7QUFBQSxNQUNoQyxhQUFhLGVBQWUsS0FBSyxXQUFXO0FBQUEsTUFDNUMsU0FBUyxlQUFlLEtBQUssT0FBTztBQUFBLE1BQ3BDLFNBQVMsZUFBZSxLQUFLLE9BQU87QUFBQSxNQUNwQyxvQkFBb0Isd0JBQXdCLEtBQUssb0JBQW9CLGtEQUFrRDtBQUFBLE1BQ3ZILHFCQUFxQix3QkFBd0IsS0FBSyxxQkFBcUIsbURBQW1EO0FBQUEsTUFDMUgsYUFBYSwyQkFBMkIsS0FBSyxhQUFhLDJDQUEyQztBQUFBLE1BQ3JHLGlCQUFpQixlQUFlLEtBQUssZUFBZTtBQUFBLE1BQ3BELG1CQUFtQix3QkFBd0IsS0FBSyxtQkFBbUIsaURBQWlEO0FBQUEsTUFDcEgsWUFBWSxlQUFlLEtBQUssWUFBWSwwQ0FBMEM7QUFBQSxNQUN0RixTQUFTLE9BQU8sS0FBSyxZQUFZLFlBQVksS0FBSyxVQUFVO0FBQUEsSUFDOUQ7QUFBQSxFQUNGO0FBQUEsRUFFUSxpQkFBaUIsT0FBcUQ7QUFDNUUsUUFBSSxTQUFTLE1BQU07QUFDakIsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLENBQUMsU0FBUyxPQUFPLFVBQVUsWUFBWSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQy9ELFlBQU0sSUFBSSxNQUFNLDRDQUE0QztBQUFBLElBQzlEO0FBQ0EsVUFBTSxPQUFPO0FBQ2IsUUFBSSxPQUFPLEtBQUssZUFBZSxZQUFZLENBQUMsS0FBSyxXQUFXLEtBQUssR0FBRztBQUNsRSxZQUFNLElBQUksTUFBTSxzREFBc0Q7QUFBQSxJQUN4RTtBQUNBLFdBQU87QUFBQSxNQUNMLFlBQVksS0FBSyxXQUFXLEtBQUs7QUFBQSxNQUNqQyxNQUFNLGVBQWUsS0FBSyxJQUFJO0FBQUEsTUFDOUIsT0FBTyxlQUFlLEtBQUssS0FBSztBQUFBLE1BQ2hDLGtCQUFrQixlQUFlLEtBQUssZ0JBQWdCO0FBQUEsTUFDdEQsVUFBVSxlQUFlLEtBQUssUUFBUTtBQUFBLE1BQ3RDLGFBQWEsS0FBSyxnQkFBZ0IsS0FBSyxhQUFhLHFDQUFxQztBQUFBLElBQzNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsZ0JBQWdCLE9BQWdCLE9BQW1EO0FBQ3pGLFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSxHQUFHLEtBQUsscUJBQXFCO0FBQUEsSUFDL0M7QUFDQSxVQUFNLE9BQU87QUFDYixRQUFJLE9BQU8sS0FBSyxZQUFZLFlBQVksQ0FBQyxLQUFLLFFBQVEsS0FBSyxHQUFHO0FBQzVELFlBQU0sSUFBSSxNQUFNLEdBQUcsS0FBSyw0QkFBNEI7QUFBQSxJQUN0RDtBQUNBLFdBQU87QUFBQSxNQUNMLFNBQVMsS0FBSyxRQUFRLEtBQUs7QUFBQSxNQUMzQixrQkFBa0IsZUFBZSxLQUFLLG9CQUFvQixLQUFLLHFCQUFxQixLQUFLLG1CQUFtQixLQUFLLEtBQUssaUJBQWlCO0FBQUEsTUFDdkksa0JBQWtCLGVBQWUsS0FBSyxvQkFBb0IsS0FBSyxxQkFBcUIsS0FBSyxtQkFBbUIsQ0FBQztBQUFBLElBQy9HO0FBQUEsRUFDRjtBQUFBLEVBRVEsa0JBQWtCLFFBQTZDO0FBQ3JFLFFBQUksQ0FBQyxPQUFPLE1BQU07QUFDaEIsWUFBTSxJQUFJLE1BQU0sNkNBQTZDO0FBQUEsSUFDL0Q7QUFDQSxXQUFPLE9BQU87QUFBQSxFQUNoQjtBQUFBLEVBRVEsb0JBQW9CLFFBQXNEO0FBQ2hGLFFBQUksQ0FBQyxPQUFPLFFBQVE7QUFDbEIsWUFBTSxJQUFJLE1BQU0saURBQWlEO0FBQUEsSUFDbkU7QUFDQSxXQUFPLE9BQU87QUFBQSxFQUNoQjtBQUFBLEVBRVEsa0JBQWtCLFFBQXFDO0FBQzdELFFBQUksT0FBTyxZQUFZLEtBQUssR0FBRztBQUM3QixhQUFPLE9BQU8sV0FBVyxLQUFLO0FBQUEsSUFDaEM7QUFDQSxXQUFPLE9BQU8sWUFBWSxXQUFXLFdBQVc7QUFBQSxFQUNsRDtBQUFBLEVBRUEsTUFBYyxlQUNaLGFBQ0Esa0JBQ0EsV0FDQSxRQUNBLFVBQ0EsWUFDZTtBQUNmLFFBQUksQ0FBQyxhQUFhO0FBQ2hCO0FBQUEsSUFDRjtBQUVBLFVBQU0sU0FBUyxNQUFNLEtBQUssZUFBZSxZQUFZLFNBQVMsa0JBQWtCLFdBQVcsUUFBUSxVQUFVLFVBQVU7QUFDdkgsVUFBTSxpQkFBaUIsR0FBRyxPQUFPLE1BQU07QUFBQSxFQUFLLE9BQU8sTUFBTTtBQUN6RCxRQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLFlBQU0sSUFBSSxNQUFNLEdBQUcsVUFBVSxZQUFZLE9BQU8sVUFBVSxPQUFPLFVBQVUsUUFBUSxPQUFPLFFBQVEsRUFBRSxFQUFFO0FBQUEsSUFDeEc7QUFDQSxRQUFJLFlBQVksb0JBQW9CLGVBQWUsU0FBUyxZQUFZLGdCQUFnQixHQUFHO0FBQ3pGLFlBQU0sSUFBSSxNQUFNLEdBQUcsVUFBVSxnQ0FBZ0MsWUFBWSxnQkFBZ0IsRUFBRTtBQUFBLElBQzdGO0FBQ0EsUUFBSSxZQUFZLG9CQUFvQixDQUFDLGVBQWUsU0FBUyxZQUFZLGdCQUFnQixHQUFHO0FBQzFGLFlBQU0sSUFBSSxNQUFNLEdBQUcsVUFBVSxzQ0FBc0MsWUFBWSxnQkFBZ0IsRUFBRTtBQUFBLElBQ25HO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxtQkFDWixTQUNBLGtCQUNBLFdBQ0EsUUFDQSxVQUNBLFlBQ2U7QUFDZixRQUFJLENBQUMsU0FBUyxLQUFLLEdBQUc7QUFDcEI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxTQUFTLE1BQU0sS0FBSyxlQUFlLFNBQVMsa0JBQWtCLFdBQVcsUUFBUSxVQUFVLFVBQVU7QUFDM0csUUFBSSxDQUFDLE9BQU8sU0FBUztBQUNuQixZQUFNLElBQUksTUFBTSxHQUFHLFVBQVUsWUFBWSxPQUFPLFVBQVUsT0FBTyxVQUFVLFFBQVEsT0FBTyxRQUFRLEVBQUUsRUFBRTtBQUFBLElBQ3hHO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxlQUNaLFNBQ0Esa0JBQ0EsV0FDQSxRQUNBLFVBQ0EsWUFDd0I7QUFDeEIsVUFBTSxRQUFRLGlCQUFpQixPQUFPO0FBQ3RDLFFBQUksQ0FBQyxNQUFNLFFBQVE7QUFDakIsWUFBTSxJQUFJLE1BQU0sR0FBRyxVQUFVLG9CQUFvQjtBQUFBLElBQ25EO0FBQ0EsV0FBTyxXQUFXO0FBQUEsTUFDaEI7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFZLE1BQU0sQ0FBQztBQUFBLE1BQ25CLE1BQU0sTUFBTSxNQUFNLENBQUM7QUFBQSxNQUNuQjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyxrQkFBa0IsV0FBbUIsV0FBbUIsTUFBc0IsV0FBbUIsUUFBb0M7QUFDakosVUFBTSxVQUFVLEtBQUs7QUFDckIsUUFBSSxDQUFDLFNBQVMsU0FBUztBQUNyQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsS0FBSyxxQkFBcUIsV0FBVyxRQUFRLFdBQVcsZ0JBQWdCO0FBQ3hGLFVBQU0sY0FBYyxNQUFNLEtBQUssWUFBWSxPQUFPO0FBQ2xELFFBQUksZUFBZSxLQUFLLGlCQUFpQixXQUFXLEdBQUc7QUFDckQsWUFBTSxLQUFLLDRCQUE0QixXQUFXLFdBQVcsTUFBTSxXQUFXLE1BQU07QUFDcEY7QUFBQSxJQUNGO0FBRUEsUUFBSSxhQUFhO0FBQ2YsZ0JBQU0scUJBQUcsU0FBUyxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsSUFDbkM7QUFFQSxVQUFNLGFBQWEsUUFBUSxjQUFjO0FBQ3pDLFVBQU0sT0FBTyxLQUFLLHFCQUFxQixXQUFXLE9BQU87QUFDekQsUUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQixZQUFNLElBQUksTUFBTSxvQkFBb0IsU0FBUyxpREFBaUQ7QUFBQSxJQUNoRztBQUVBLFVBQU0sVUFBVSxRQUFRLFVBQVUsS0FBSyxxQkFBcUIsV0FBVyxRQUFRLE9BQU8sSUFBSTtBQUMxRixVQUFNLFFBQVEsY0FBVSxvQkFBUyxTQUFTLEdBQUcsSUFBSTtBQUNqRCxRQUFJO0FBQ0YsWUFBTSxZQUFRLDZCQUFNLFlBQVksTUFBTTtBQUFBLFFBQ3BDLEtBQUs7QUFBQSxRQUNMLFVBQVU7QUFBQSxRQUNWLE9BQU8sQ0FBQyxVQUFVLFNBQVMsVUFBVSxTQUFTLFFBQVE7QUFBQSxNQUN4RCxDQUFDO0FBRUQsWUFBTSxHQUFHLFNBQVMsTUFBTSxNQUFTO0FBQ2pDLFlBQU0sTUFBTTtBQUVaLFVBQUksQ0FBQyxNQUFNLEtBQUs7QUFDZCxjQUFNLElBQUksTUFBTSxvQkFBb0IsU0FBUywrQkFBK0I7QUFBQSxNQUM5RTtBQUVBLGdCQUFNLDRCQUFVLFNBQVMsR0FBRyxNQUFNLEdBQUc7QUFBQSxHQUFNLE1BQU07QUFDakQsWUFBTSxLQUFLLDRCQUE0QixXQUFXLFdBQVcsTUFBTSxXQUFXLE1BQU07QUFBQSxJQUN0RixVQUFFO0FBQ0EsVUFBSSxTQUFTLE1BQU07QUFDakIsaUNBQVUsS0FBSztBQUFBLE1BQ2pCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLHFCQUFxQixXQUFtQixTQUEwQztBQUN4RixVQUFNLE9BQU8saUJBQWlCLFFBQVEsUUFBUSxFQUFFO0FBQ2hELFFBQUksUUFBUSxPQUFPO0FBQ2pCLFlBQU0sWUFBWSxLQUFLLHFCQUFxQixXQUFXLFFBQVEsS0FBSztBQUNwRSxXQUFLLEtBQUssVUFBVSxRQUFRLFNBQVMscUJBQXFCLFFBQVEsZUFBZSxPQUFPLEVBQUU7QUFBQSxJQUM1RjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLDRCQUNaLFdBQ0EsV0FDQSxNQUNBLFdBQ0EsUUFDZTtBQUNmLFVBQU0sVUFBVSxLQUFLO0FBQ3JCLFFBQUksQ0FBQyxTQUFTLFNBQVM7QUFDckI7QUFBQSxJQUNGO0FBRUEsUUFBSSxDQUFDLEtBQUssYUFBYTtBQUNyQixZQUFNLGdCQUFnQixRQUFRLGVBQWUsR0FBRyxNQUFNO0FBQ3REO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxLQUFLLElBQUksUUFBUSxzQkFBc0IsS0FBUSxLQUFLLElBQUksV0FBVyxDQUFDLENBQUM7QUFDckYsVUFBTSxXQUFXLFFBQVEsdUJBQXVCO0FBQ2hELFVBQU0sWUFBWSxLQUFLLElBQUk7QUFDM0IsUUFBSSxZQUFZO0FBRWhCLFdBQU8sS0FBSyxJQUFJLElBQUksYUFBYSxTQUFTO0FBQ3hDLFVBQUksT0FBTyxTQUFTO0FBQ2xCLGNBQU0sSUFBSSxNQUFNLFFBQVEsU0FBUyw0QkFBNEI7QUFBQSxNQUMvRDtBQUVBLFVBQUk7QUFDRixjQUFNLEtBQUssZUFBZSxLQUFLLGFBQWEsV0FBVyxLQUFLLElBQUksVUFBVSxPQUFPLEdBQUcsUUFBUSxhQUFhLFNBQVMsZUFBZSxRQUFRLFNBQVMsa0JBQWtCO0FBQ3BLO0FBQUEsTUFDRixTQUFTLE9BQU87QUFDZCxvQkFBWSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQUEsTUFDbkU7QUFFQSxZQUFNLGdCQUFnQixVQUFVLE1BQU07QUFBQSxJQUN4QztBQUVBLFVBQU0sSUFBSSxNQUFNLFFBQVEsU0FBUyxnQ0FBZ0MsT0FBTyxNQUFNLFlBQVksS0FBSyxTQUFTLEtBQUssR0FBRyxFQUFFO0FBQUEsRUFDcEg7QUFBQSxFQUVBLE1BQWMsd0JBQXdCLFdBQW1CLFdBQW1CLE1BQXNCLFdBQW1CLFFBQW9DO0FBQ3ZKLFVBQU0sVUFBVSxLQUFLO0FBQ3JCLFFBQUksQ0FBQyxTQUFTLFdBQVcsUUFBUSxZQUFZLE9BQU87QUFDbEQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUFVLEtBQUsscUJBQXFCLFdBQVcsUUFBUSxXQUFXLGdCQUFnQjtBQUN4RixVQUFNLE1BQU0sTUFBTSxLQUFLLFlBQVksT0FBTztBQUMxQyxRQUFJLENBQUMsS0FBSztBQUNSO0FBQUEsSUFDRjtBQUVBLFFBQUksUUFBUSxpQkFBaUI7QUFDM0IsWUFBTSxLQUFLO0FBQUEsUUFDVCxRQUFRO0FBQUEsUUFDUjtBQUFBLFFBQ0EsS0FBSyxJQUFJLFFBQVEscUJBQXFCLFdBQVcsU0FBUztBQUFBLFFBQzFEO0FBQUEsUUFDQSxhQUFhLFNBQVM7QUFBQSxRQUN0QixRQUFRLFNBQVM7QUFBQSxNQUNuQjtBQUFBLElBQ0YsV0FBVyxLQUFLLGlCQUFpQixHQUFHLEdBQUc7QUFDckMsY0FBUSxLQUFLLEtBQUssUUFBUSxjQUFjLFNBQVM7QUFBQSxJQUNuRDtBQUVBLFVBQU0sVUFBVSxNQUFNLEtBQUssbUJBQW1CLEtBQUssUUFBUSxxQkFBcUIsS0FBUSxNQUFNO0FBQzlGLFFBQUksQ0FBQyxXQUFXLEtBQUssaUJBQWlCLEdBQUcsR0FBRztBQUMxQyxjQUFRLEtBQUssS0FBSyxTQUFTO0FBQzNCLFlBQU0sS0FBSyxtQkFBbUIsS0FBSyxLQUFPLE1BQU07QUFBQSxJQUNsRDtBQUVBLGNBQU0scUJBQUcsU0FBUyxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsRUFDbkM7QUFBQSxFQUVBLE1BQWMscUJBQXFCLFdBQW1CLFNBQWlEO0FBQ3JHLFVBQU0sVUFBVSxLQUFLLHFCQUFxQixXQUFXLFFBQVEsV0FBVyxnQkFBZ0I7QUFDeEYsVUFBTSxNQUFNLE1BQU0sS0FBSyxZQUFZLE9BQU87QUFDMUMsUUFBSSxDQUFDLEtBQUs7QUFDUixhQUFPO0FBQUEsSUFDVDtBQUNBLFdBQU8sS0FBSyxpQkFBaUIsR0FBRyxJQUFJLGVBQWUsR0FBRyxLQUFLLGFBQWEsR0FBRztBQUFBLEVBQzdFO0FBQUEsRUFFQSxNQUFjLFlBQVksU0FBeUM7QUFDakUsUUFBSTtBQUNGLFlBQU0sU0FBUyxVQUFNLDJCQUFTLFNBQVMsTUFBTSxHQUFHLEtBQUs7QUFDckQsWUFBTSxNQUFNLE9BQU8sU0FBUyxPQUFPLEVBQUU7QUFDckMsYUFBTyxPQUFPLFVBQVUsR0FBRyxLQUFLLE1BQU0sSUFBSSxNQUFNO0FBQUEsSUFDbEQsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRVEsaUJBQWlCLEtBQXNCO0FBQzdDLFFBQUk7QUFDRixjQUFRLEtBQUssS0FBSyxDQUFDO0FBQ25CLGFBQU87QUFBQSxJQUNULFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsbUJBQW1CLEtBQWEsV0FBbUIsUUFBdUM7QUFDdEcsVUFBTSxZQUFZLEtBQUssSUFBSTtBQUMzQixXQUFPLEtBQUssSUFBSSxJQUFJLGFBQWEsV0FBVztBQUMxQyxVQUFJLE9BQU8sU0FBUztBQUNsQixlQUFPO0FBQUEsTUFDVDtBQUNBLFVBQUksQ0FBQyxLQUFLLGlCQUFpQixHQUFHLEdBQUc7QUFDL0IsZUFBTztBQUFBLE1BQ1Q7QUFDQSxZQUFNLGdCQUFnQixLQUFLLE1BQU07QUFBQSxJQUNuQztBQUNBLFdBQU8sQ0FBQyxLQUFLLGlCQUFpQixHQUFHO0FBQUEsRUFDbkM7QUFBQSxFQUVBLE1BQWMsaUJBQ1osV0FDQSxXQUNBLFFBQ0EsU0FDQSxXQUNBLFFBQ3dCO0FBQ3hCLFVBQU0sU0FBUyxLQUFLLG9CQUFvQixNQUFNO0FBQzlDLFVBQU0sS0FBSyxlQUFlLE9BQU8sYUFBYSxXQUFXLFdBQVcsUUFBUSxhQUFhLFNBQVMsa0JBQWtCLFVBQVUsU0FBUyxlQUFlO0FBRXRKLFVBQU0sa0JBQWtCLFdBQVcsS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUNwRixVQUFNLGtCQUFjLG1CQUFLLFdBQVcsZUFBZTtBQUNuRCxRQUFJO0FBQ0YsZ0JBQU0sNEJBQVUsYUFBYSxHQUFHLEtBQUssVUFBVSxTQUFTLE1BQU0sQ0FBQyxDQUFDO0FBQUEsR0FBTSxNQUFNO0FBQzVFLFlBQU0sT0FBTyxpQkFBaUIsT0FBTyxRQUFRLFdBQVcsRUFBRTtBQUFBLFFBQUksQ0FBQyxRQUM3RCxJQUNHLFdBQVcsYUFBYSxXQUFXLEVBQ25DLFdBQVcsV0FBVyxTQUFTLEVBQy9CLFdBQVcsZUFBZSxTQUFTO0FBQUEsTUFDeEM7QUFDQSxhQUFPLE1BQU0sV0FBVztBQUFBLFFBQ3RCLFVBQVUsYUFBYSxTQUFTLFdBQVcsUUFBUSxNQUFNO0FBQUEsUUFDekQsWUFBWSxVQUFVLFNBQVMsSUFBSSxRQUFRLE1BQU07QUFBQSxRQUNqRCxZQUFZLE9BQU87QUFBQSxRQUNuQjtBQUFBLFFBQ0Esa0JBQWtCO0FBQUEsUUFDbEI7QUFBQSxRQUNBO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSCxVQUFFO0FBQ0EsZ0JBQU0scUJBQUcsYUFBYSxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsSUFDdkM7QUFBQSxFQUNGO0FBQUEsRUFFUSxvQkFDTixRQUNBLFdBQ0EsV0FDQSxRQUNBLFdBQ0EsUUFBMkMsQ0FBQyxHQUNsQjtBQUMxQixXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxTQUFTLE9BQU87QUFBQSxNQUNoQixPQUFPLE9BQU87QUFBQSxNQUNkLE9BQU8sT0FBTyxRQUFRO0FBQUEsTUFDdEIsa0JBQWtCLE9BQU8sUUFBUTtBQUFBLE1BQ2pDLFVBQVUsT0FBTyxRQUFRO0FBQUEsTUFDekI7QUFBQSxNQUNBLFFBQVE7QUFBQSxRQUNOLFlBQVksT0FBTztBQUFBLFFBQ25CLFFBQVEsT0FBTztBQUFBLFFBQ2YsTUFBTSxPQUFPO0FBQUEsUUFDYixhQUFhLE9BQU87QUFBQSxNQUN0QjtBQUFBLE1BQ0EsR0FBRztBQUFBLElBQ0w7QUFBQSxFQUNGO0FBQUEsRUFFUSxzQkFBc0IsVUFBa0IsWUFBb0IsUUFBZ0IsVUFBVSxNQUFxQjtBQUNqSCxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQSxXQUFXO0FBQUEsTUFDWCxZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsTUFDWixVQUFVLFVBQVUsSUFBSTtBQUFBLE1BQ3hCO0FBQUEsTUFDQSxRQUFRO0FBQUEsTUFDUjtBQUFBLE1BQ0EsVUFBVTtBQUFBLE1BQ1YsV0FBVztBQUFBLElBQ2I7QUFBQSxFQUNGO0FBQUEsRUFFUSxvQkFBNEI7QUFDbEMsVUFBTSxrQkFBbUIsS0FBSyxJQUFJLE1BQU0sUUFBa0MsWUFBWTtBQUN0RixlQUFPLGFBQUFDLGVBQWdCLG1CQUFLLGlCQUFpQixLQUFLLFdBQVcsWUFBWSxDQUFDO0FBQUEsRUFDNUU7QUFBQSxFQUVRLGlCQUFpQixXQUEyQjtBQUNsRCxVQUFNLGVBQVcsdUJBQVMsU0FBUztBQUNuQyxRQUFJLENBQUMsWUFBWSxhQUFhLFdBQVc7QUFDdkMsWUFBTSxJQUFJLE1BQU0saUNBQWlDLFNBQVMsRUFBRTtBQUFBLElBQzlEO0FBQ0EsZUFBTyxhQUFBQSxlQUFnQixtQkFBSyxLQUFLLGtCQUFrQixHQUFHLFFBQVEsQ0FBQztBQUFBLEVBQ2pFO0FBQUEsRUFFUSxxQkFBcUIsV0FBbUIsVUFBMEI7QUFDeEUsVUFBTSxlQUFXLGFBQUFBLGVBQWdCLG1CQUFLLFdBQVcsUUFBUSxDQUFDO0FBQzFELFVBQU0sMEJBQXNCLGFBQUFBLFdBQWdCLFNBQVM7QUFDckQsVUFBTSxnQkFBZ0IsU0FBUyxRQUFRLE9BQU8sR0FBRztBQUNqRCxVQUFNLGlCQUFpQixvQkFBb0IsUUFBUSxPQUFPLEdBQUc7QUFDN0QsUUFBSSxrQkFBa0Isa0JBQWtCLENBQUMsY0FBYyxXQUFXLEdBQUcsY0FBYyxHQUFHLEdBQUc7QUFDdkYsWUFBTSxJQUFJLE1BQU0sc0RBQXNELFFBQVEsRUFBRTtBQUFBLElBQ2xGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLGtCQUFrQixXQUEyQjtBQUNuRCxXQUFPLGtCQUFrQixVQUFVLFlBQVksRUFBRSxRQUFRLGlCQUFpQixHQUFHLENBQUM7QUFBQSxFQUNoRjtBQUFBLEVBRU8seUJBQXlCLFFBQWdCLFVBQWtFO0FBQ2hILFFBQUksQ0FBQyxPQUFRLFFBQU87QUFDcEIsVUFBTSxhQUFhLE9BQU8sWUFBWSxFQUFFLEtBQUs7QUFHN0MsVUFBTSxTQUFTLFNBQVMsZ0JBQWdCLEtBQUssQ0FBQyxNQUFNO0FBQ2xELFlBQU0sUUFBUSxDQUFDLEVBQUUsTUFBTSxHQUFHLEVBQUUsUUFBUSxNQUFNLEdBQUcsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUM7QUFDL0YsYUFBTyxNQUFNLFNBQVMsVUFBVTtBQUFBLElBQ2xDLENBQUM7QUFDRCxRQUFJLFFBQVE7QUFDVixhQUFPO0FBQUEsUUFDTCxTQUFTLEdBQUcsT0FBTyxVQUFVLElBQUksT0FBTyxJQUFJLEdBQUcsS0FBSztBQUFBLFFBQ3BELFdBQVcsT0FBTyxhQUFhO0FBQUEsTUFDakM7QUFBQSxJQUNGO0FBR0EsWUFBUSxZQUFZO0FBQUEsTUFDbEIsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGlCQUFpQixLQUFLLEtBQUssU0FBUztBQUFBLFVBQ3pELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZUFBZSxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3BELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsK0JBQStCLEtBQUssS0FBSyxTQUFTO0FBQUEsVUFDdkUsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLEdBQUcsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLE1BQU07QUFBQSxVQUNyRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGVBQWUsS0FBSyxLQUFLLE1BQU07QUFBQSxVQUNwRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGVBQWUsS0FBSyxLQUFLLE1BQU07QUFBQSxVQUNwRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGNBQWMsS0FBSyxLQUFLLEtBQUs7QUFBQSxVQUNsRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGNBQWMsS0FBSyxLQUFLLEtBQUs7QUFBQSxVQUNsRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGFBQWEsS0FBSyxLQUFLLElBQUk7QUFBQSxVQUNoRCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGtCQUFrQixLQUFLLEtBQUssUUFBUTtBQUFBLFVBQ3pELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsWUFBSSxTQUFTLGNBQWMsUUFBUTtBQUNqQyxpQkFBTztBQUFBLFlBQ0wsU0FBUyxHQUFHLFNBQVMsZ0JBQWdCLEtBQUssS0FBSyxNQUFNO0FBQUEsWUFDckQsV0FBVztBQUFBLFVBQ2I7QUFBQSxRQUNGO0FBQ0EsWUFBSSxTQUFTLGNBQWMsVUFBVTtBQUNuQyxpQkFBTztBQUFBLFlBQ0wsU0FBUyxhQUFhLEdBQUcsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLFFBQVEsNkNBQTZDO0FBQUEsWUFDakgsV0FBVztBQUFBLFVBQ2I7QUFBQSxRQUNGO0FBQ0EsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZ0JBQWdCLEtBQUssS0FBSyxPQUFPO0FBQUEsVUFDdEQsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLGFBQWEsR0FBRyxTQUFTLFlBQVksS0FBSyxLQUFLLEtBQUsscUNBQXFDO0FBQUEsVUFDbEcsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLGFBQWEsR0FBRyxTQUFTLGNBQWMsS0FBSyxLQUFLLEtBQUsseUNBQXlDO0FBQUEsVUFDeEcsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLGFBQWEsR0FBRyxTQUFTLG9CQUFvQixLQUFLLEtBQUssT0FBTyxnR0FBZ0c7QUFBQSxVQUN2SyxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLG1CQUFtQixLQUFLLEtBQUssVUFBVTtBQUFBLFVBQzVELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxhQUFhLEdBQUcsU0FBUyxlQUFlLEtBQUssS0FBSyxPQUFPLDJDQUEyQztBQUFBLFVBQzdHLFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLLFFBQVE7QUFDWCxjQUFNLFdBQVcsU0FBUyx1QkFBdUIsS0FBSyxLQUFLO0FBQzNELGVBQU87QUFBQSxVQUNMLFNBQVMsYUFBYSwyRUFBMkUsUUFBUSx3QkFBd0IsU0FBUyxlQUFlLEtBQUssS0FBSyxNQUFNLGtCQUFrQjtBQUFBLFVBQzNMLFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRjtBQUFBLE1BQ0EsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLDBCQUEwQixLQUFLLEtBQUssS0FBSztBQUFBLFVBQzlELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZUFBZSxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3BELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsY0FBYyxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ25ELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsY0FBYyxLQUFLLEtBQUssSUFBSTtBQUFBLFVBQ2pELFdBQVc7QUFBQSxRQUNiO0FBQUEsSUFDSjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFFQSxTQUFTLGFBQWEsU0FBeUI7QUFDN0MsU0FBTyxVQUFVLGdCQUFnQixPQUFPLENBQUM7QUFDM0M7QUFFQSxTQUFTLG1CQUFtQixXQUEyQjtBQUNyRCxRQUFNLFVBQVUsVUFBVSxLQUFLO0FBQy9CLFNBQU8sUUFBUSxXQUFXLEdBQUcsSUFBSSxVQUFVLElBQUksT0FBTztBQUN4RDtBQU1BLFNBQVMsZUFBZSxPQUFvQztBQUMxRCxTQUFPLE9BQU8sVUFBVSxZQUFZLE1BQU0sS0FBSyxJQUFJLE1BQU0sS0FBSyxJQUFJO0FBQ3BFO0FBRUEsU0FBUyx3QkFBd0IsT0FBZ0IsT0FBbUM7QUFDbEYsTUFBSSxTQUFTLE1BQU07QUFDakIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLE9BQU8sVUFBVSxZQUFZLENBQUMsT0FBTyxVQUFVLEtBQUssS0FBSyxTQUFTLEdBQUc7QUFDdkUsVUFBTSxJQUFJLE1BQU0sR0FBRyxLQUFLLDhCQUE4QjtBQUFBLEVBQ3hEO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUywyQkFBMkIsT0FBZ0IsT0FBbUM7QUFDckYsTUFBSSxTQUFTLE1BQU07QUFDakIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLE9BQU8sVUFBVSxZQUFZLENBQUMsT0FBTyxVQUFVLEtBQUssS0FBSyxRQUFRLEdBQUc7QUFDdEUsVUFBTSxJQUFJLE1BQU0sR0FBRyxLQUFLLGtDQUFrQztBQUFBLEVBQzVEO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLE9BQWdCLE9BQTJDO0FBQ2pGLE1BQUksU0FBUyxNQUFNO0FBQ2pCLFdBQU87QUFBQSxFQUNUO0FBQ0EsTUFBSSxPQUFPLFVBQVUsWUFBWSxDQUFDLGlCQUFpQixLQUFLLEtBQUssR0FBRztBQUM5RCxVQUFNLElBQUksTUFBTSxHQUFHLEtBQUssc0NBQXNDO0FBQUEsRUFDaEU7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLGdCQUFnQixZQUFvQixRQUFvQztBQUNyRixNQUFJLGNBQWMsS0FBSyxPQUFPLFNBQVM7QUFDckM7QUFBQSxFQUNGO0FBRUEsUUFBTSxJQUFJLFFBQWMsQ0FBQyxZQUFZO0FBQ25DLFVBQU0sVUFBVSxXQUFXLFNBQVMsVUFBVTtBQUM5QyxVQUFNLFFBQVEsTUFBTTtBQUNsQixtQkFBYSxPQUFPO0FBQ3BCLGNBQVE7QUFBQSxJQUNWO0FBQ0EsV0FBTyxpQkFBaUIsU0FBUyxPQUFPLEVBQUUsTUFBTSxLQUFLLENBQUM7QUFBQSxFQUN4RCxDQUFDO0FBQ0g7QUFFQSxTQUFTLGFBQWEsU0FBdUM7QUFDM0QsVUFBUSxTQUFTO0FBQUEsSUFDZixLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFFQSxTQUFTLFdBQVcsT0FBdUI7QUFDekMsU0FBTyxJQUFJLE1BQU0sV0FBVyxLQUFLLE9BQU8sQ0FBQztBQUMzQztBQUVBLFNBQVMsZ0JBQWdCLE9BQXVCO0FBQzlDLFNBQU8sSUFBSSxNQUFNLFdBQVcsS0FBSyxPQUFPLENBQUM7QUFDM0M7OztBR2p2Q0EsSUFBQUMsZUFBd0I7QUFDeEIsSUFBQUMsbUJBQW9EO0FBVTdDLFNBQVMsd0JBQ2QsS0FDQSxNQUNBLE9BQ0EsVUFDOEI7QUFDOUIsUUFBTSxPQUFPLHlCQUF5QixLQUFLLElBQUk7QUFDL0MsUUFBTSwwQkFBMEIsK0JBQStCLE1BQU0sUUFBUTtBQUM3RSxRQUFNLHVCQUF1QiwwQkFBMEIsS0FBSyxnQkFBZ0I7QUFDNUUsUUFBTSx3QkFBd0IsMEJBQTBCLE1BQU0saUJBQWlCLGdCQUFnQjtBQUMvRixRQUFNLGNBQWMsS0FBSztBQUN6QixRQUFNLGVBQWUsTUFBTSxpQkFBaUI7QUFFNUMsU0FBTztBQUFBLElBQ0wsZ0JBQWdCLHNCQUFzQixTQUFTLHVCQUF1QixNQUFNLE1BQU0sZ0JBQWdCO0FBQUEsSUFDbEcsa0JBQWtCLHlCQUF5Qix3QkFBd0I7QUFBQSxJQUNuRSxXQUFXLGdCQUFnQixlQUFlLFNBQVM7QUFBQSxJQUNuRCxRQUFRO0FBQUEsTUFDTixXQUFXLHVCQUF1QixTQUFTLHVCQUF1QixNQUFNLE1BQU0sZ0JBQWdCO0FBQUEsTUFDOUYsa0JBQWtCLHdCQUF3QixVQUFVLHVCQUF1QixTQUFTLFNBQVMsaUJBQWlCLEtBQUssSUFBSSxXQUFXO0FBQUEsTUFDbEksU0FBUyxlQUFlLFVBQVUsY0FBYyxTQUFTO0FBQUEsSUFDM0Q7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLHNCQUNQLGlCQUNBLE1BQ0EsT0FDb0I7QUFDcEIsTUFBSSxNQUFNLGtCQUFrQjtBQUMxQixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksTUFBTSxnQkFBZ0IsS0FBSyxHQUFHO0FBQ2hDLFdBQU8sTUFBTSxlQUFlLEtBQUs7QUFBQSxFQUNuQztBQUNBLE1BQUksS0FBSyxrQkFBa0I7QUFDekIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLEtBQUssZ0JBQWdCLEtBQUssR0FBRztBQUMvQixXQUFPLEtBQUssZUFBZSxLQUFLO0FBQUEsRUFDbEM7QUFDQSxTQUFPLGdCQUFnQixLQUFLLEtBQUs7QUFDbkM7QUFFQSxTQUFTLHVCQUNQLGlCQUNBLE1BQ0EsT0FDcUQ7QUFDckQsTUFBSSxNQUFNLG9CQUFvQixNQUFNLGdCQUFnQixLQUFLLEdBQUc7QUFDMUQsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLEtBQUssb0JBQW9CLEtBQUssZ0JBQWdCLEtBQUssR0FBRztBQUN4RCxXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksZ0JBQWdCLEtBQUssR0FBRztBQUMxQixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMseUJBQXlCLEtBQVUsTUFBbUM7QUFDN0UsUUFBTSxjQUFjLElBQUksY0FBYyxhQUFhLElBQUksR0FBRztBQUMxRCxNQUFJLENBQUMsYUFBYTtBQUNoQixXQUFPLENBQUM7QUFBQSxFQUNWO0FBRUEsUUFBTSxZQUFZLFlBQVksZ0JBQWdCO0FBQzlDLFFBQU0sbUJBQW1CLFlBQVksVUFBVSxLQUFLLFlBQVksd0JBQXdCO0FBQ3hGLFFBQU0sVUFBVSxZQUFZLGNBQWM7QUFFMUMsU0FBTztBQUFBLElBQ0wsZ0JBQWdCLE9BQU8sY0FBYyxZQUFZLENBQUMsZ0JBQWdCLFNBQVMsSUFBSSxVQUFVLEtBQUssSUFBSTtBQUFBLElBQ2xHLGtCQUFrQixPQUFPLGNBQWMsV0FBVyxnQkFBZ0IsU0FBUyxJQUFJO0FBQUEsSUFDL0Usa0JBQWtCLE9BQU8scUJBQXFCLFdBQVcsbUJBQW1CO0FBQUEsSUFDNUUsV0FBVyxPQUFPLFlBQVksWUFBWSxPQUFPLFNBQVMsT0FBTyxLQUFLLFVBQVUsSUFDNUUsS0FBSyxNQUFNLE9BQU8sSUFDbEIsT0FBTyxZQUFZLFdBQ2pCLHFCQUFxQixPQUFPLElBQzVCO0FBQUEsRUFDUjtBQUNGO0FBRUEsU0FBUywrQkFBK0IsTUFBYSxVQUFzQztBQUN6RixNQUFJLFNBQVMsaUJBQWlCLEtBQUssR0FBRztBQUNwQyxlQUFPLGdDQUFjLFNBQVMsaUJBQWlCLEtBQUssQ0FBQztBQUFBLEVBQ3ZEO0FBRUEsUUFBTSxrQkFBbUIsS0FBSyxNQUFNLFFBQWtDLFlBQVk7QUFDbEYsUUFBTSxpQkFBYSxzQkFBUSxLQUFLLElBQUk7QUFDcEMsUUFBTSxXQUFXLGVBQWUsTUFBTSxrQkFBa0IsR0FBRyxlQUFlLElBQUksVUFBVTtBQUN4RixTQUFPLFlBQVksUUFBUSxJQUFJO0FBQ2pDO0FBRUEsU0FBUywwQkFBMEIsT0FBK0M7QUFDaEYsU0FBTyxPQUFPLEtBQUssUUFBSSxnQ0FBYyxNQUFNLEtBQUssQ0FBQyxJQUFJO0FBQ3ZEO0FBRUEsU0FBUyxxQkFBcUIsT0FBbUM7QUFDL0QsUUFBTSxTQUFTLE9BQU8sU0FBUyxNQUFNLEtBQUssR0FBRyxFQUFFO0FBQy9DLFNBQU8sT0FBTyxVQUFVLE1BQU0sS0FBSyxTQUFTLElBQUksU0FBUztBQUMzRDtBQUVBLFNBQVMsZ0JBQWdCLE9BQXdCO0FBQy9DLFNBQU8sQ0FBQyxLQUFLLFNBQVMsTUFBTSxPQUFPLFFBQVEsUUFBUSxFQUFFLFNBQVMsTUFBTSxLQUFLLEVBQUUsWUFBWSxDQUFDO0FBQzFGOzs7QUNySEEsa0JBQTRDO0FBVTVDLElBQU0sZ0JBQWdCLElBQUksSUFBb0I7QUFBQSxFQUM1QyxHQUFHLFNBQVMsNkJBQTZCO0FBQUEsSUFDdkM7QUFBQSxJQUFPO0FBQUEsSUFBTTtBQUFBLElBQVU7QUFBQSxJQUFjO0FBQUEsSUFBVTtBQUFBLElBQVU7QUFBQSxJQUFVO0FBQUEsSUFBZTtBQUFBLElBQWM7QUFBQSxJQUFZO0FBQUEsRUFDOUcsQ0FBQztBQUFBLEVBQ0QsR0FBRyxTQUFTLGlDQUFpQztBQUFBLElBQzNDO0FBQUEsSUFBVTtBQUFBLElBQVc7QUFBQSxJQUFRO0FBQUEsSUFBVTtBQUFBLElBQVk7QUFBQSxJQUFTO0FBQUEsSUFBUztBQUFBLElBQVU7QUFBQSxJQUFjO0FBQUEsSUFBVztBQUFBLElBQU07QUFBQSxJQUFVO0FBQUEsSUFDeEg7QUFBQSxJQUFlO0FBQUEsSUFBZ0I7QUFBQSxJQUFtQjtBQUFBLElBQVU7QUFBQSxJQUFPO0FBQUEsSUFBbUI7QUFBQSxFQUN4RixDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsNEJBQTRCO0FBQUEsSUFDdEM7QUFBQSxJQUFVO0FBQUEsSUFBUTtBQUFBLElBQVM7QUFBQSxJQUFpQjtBQUFBLElBQVM7QUFBQSxJQUFXO0FBQUEsSUFBYTtBQUFBLElBQWdCO0FBQUEsSUFBZTtBQUFBLElBQzVHO0FBQUEsSUFBaUI7QUFBQSxFQUNuQixDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsZ0NBQWdDO0FBQUEsSUFDMUM7QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFRO0FBQUEsSUFBTztBQUFBLElBQVE7QUFBQSxJQUFRO0FBQUEsSUFBTztBQUFBLElBQU07QUFBQSxJQUFPO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFRO0FBQUEsSUFDeEg7QUFBQSxJQUFRO0FBQUEsRUFDVixDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsZ0NBQWdDLENBQUMsUUFBUSxNQUFNLENBQUM7QUFBQSxFQUM1RCxHQUFHLFNBQVMsMEJBQTBCO0FBQUEsSUFDcEM7QUFBQSxJQUFTO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFXO0FBQUEsSUFBUztBQUFBLElBQVU7QUFBQSxJQUFVO0FBQUEsSUFBVTtBQUFBLElBQVU7QUFBQSxJQUFZO0FBQUEsSUFBWTtBQUFBLElBQVc7QUFBQSxFQUMxSCxDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsMkJBQTJCLENBQUMsT0FBTyxVQUFVLFVBQVUsUUFBUSxjQUFjLFlBQVksY0FBYyxRQUFRLENBQUM7QUFBQSxFQUM1SCxHQUFHLFNBQVMsOEJBQThCO0FBQUEsSUFDeEM7QUFBQSxJQUFXO0FBQUEsSUFBWTtBQUFBLElBQXdCO0FBQUEsSUFBWTtBQUFBLElBQVE7QUFBQSxJQUFVO0FBQUEsSUFBYTtBQUFBLElBQWU7QUFBQSxJQUFnQjtBQUFBLElBQ3pIO0FBQUEsSUFBWTtBQUFBLElBQVc7QUFBQSxJQUFVO0FBQUEsSUFBYTtBQUFBLElBQWE7QUFBQSxJQUFhO0FBQUEsSUFBYTtBQUFBLElBQW1CO0FBQUEsSUFDeEc7QUFBQSxJQUFnQjtBQUFBLElBQWdCO0FBQUEsSUFBZTtBQUFBLElBQWE7QUFBQSxJQUFnQjtBQUFBLElBQXNCO0FBQUEsSUFBVTtBQUFBLElBQWE7QUFBQSxJQUN6SDtBQUFBLElBQVc7QUFBQSxJQUFXO0FBQUEsSUFBVztBQUFBLElBQVc7QUFBQSxJQUFhO0FBQUEsSUFBWTtBQUFBLElBQWdCO0FBQUEsSUFBTztBQUFBLElBQVU7QUFBQSxJQUFVO0FBQUEsSUFDaEg7QUFBQSxJQUFZO0FBQUEsSUFBbUI7QUFBQSxJQUFrQjtBQUFBLElBQWtCO0FBQUEsSUFBVztBQUFBLElBQVU7QUFBQSxJQUFtQjtBQUFBLElBQVE7QUFBQSxJQUFZO0FBQUEsSUFDL0g7QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFPO0FBQUEsSUFBUTtBQUFBLElBQVk7QUFBQSxJQUFPO0FBQUEsSUFBVztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBUztBQUFBLElBQVk7QUFBQSxJQUFNO0FBQUEsRUFDaEgsQ0FBQztBQUFBLEVBQ0QsR0FBRyxTQUFTLHVCQUF1QjtBQUFBLElBQ2pDO0FBQUEsSUFBTTtBQUFBLElBQU07QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFDNUg7QUFBQSxFQUNGLENBQUM7QUFBQSxFQUNELEdBQUcsU0FBUyx1QkFBdUI7QUFBQSxJQUNqQztBQUFBLElBQWdCO0FBQUEsSUFBYztBQUFBLElBQVc7QUFBQSxJQUFTO0FBQUEsSUFBUztBQUFBLElBQVE7QUFBQSxJQUFjO0FBQUEsSUFBbUI7QUFBQSxJQUEyQjtBQUFBLElBQy9IO0FBQUEsSUFBVTtBQUFBLElBQVk7QUFBQSxJQUFTO0FBQUEsSUFBZ0I7QUFBQSxJQUFRO0FBQUEsSUFBVztBQUFBLElBQWM7QUFBQSxJQUFhO0FBQUEsSUFBVTtBQUFBLElBQVk7QUFBQSxJQUNuSDtBQUFBLElBQVc7QUFBQSxJQUFhO0FBQUEsSUFBYTtBQUFBLElBQVk7QUFBQSxJQUFVO0FBQUEsSUFBWTtBQUFBLElBQXlCO0FBQUEsSUFBVTtBQUFBLElBQVc7QUFBQSxJQUNySDtBQUFBLElBQWdCO0FBQUEsSUFBWTtBQUFBLElBQVk7QUFBQSxJQUFZO0FBQUEsSUFBaUI7QUFBQSxJQUFvQjtBQUFBLElBQXNCO0FBQUEsSUFDL0c7QUFBQSxJQUFtQjtBQUFBLElBQVc7QUFBQSxJQUFnQjtBQUFBLElBQVE7QUFBQSxJQUFPO0FBQUEsSUFBVTtBQUFBLElBQWE7QUFBQSxJQUFjO0FBQUEsSUFBYTtBQUFBLElBQWM7QUFBQSxJQUM3SDtBQUFBLElBQWM7QUFBQSxJQUFhO0FBQUEsRUFDN0IsQ0FBQztBQUFBLEVBQ0QsR0FBRyxTQUFTLHNCQUFzQixDQUFDLFFBQVEsU0FBUyxRQUFRLFFBQVEsU0FBUyxVQUFVLGlCQUFpQixDQUFDO0FBQzNHLENBQUM7QUFFRCxJQUFNLHVCQUF1QixvQkFBSSxJQUFJO0FBQUEsRUFDbkM7QUFBQSxFQUFRO0FBQUEsRUFBUztBQUFBLEVBQVM7QUFBQSxFQUFZO0FBQUEsRUFBVztBQUFBLEVBQVc7QUFBQSxFQUFRO0FBQUEsRUFBVTtBQUFBLEVBQVM7QUFBQSxFQUFVO0FBQUEsRUFBUztBQUFBLEVBQVk7QUFBQSxFQUFhO0FBQ3JJLENBQUM7QUFFRCxJQUFNLG9CQUFvQjtBQUVuQixTQUFTLHFCQUFxQixhQUEwQixRQUFzQjtBQUNuRixjQUFZLE1BQU07QUFDbEIsY0FBWSxTQUFTLGdCQUFnQjtBQUVyQyxRQUFNLFFBQVEsT0FBTyxNQUFNLElBQUk7QUFDL0IsUUFBTSxRQUFRLENBQUMsTUFBTSxVQUFVO0FBQzdCLDBCQUFzQixhQUFhLElBQUk7QUFDdkMsUUFBSSxRQUFRLE1BQU0sU0FBUyxHQUFHO0FBQzVCLGtCQUFZLFdBQVcsSUFBSTtBQUFBLElBQzdCO0FBQUEsRUFDRixDQUFDO0FBQ0g7QUFFTyxTQUFTLG1CQUNkLFNBQ0EsTUFDQSxPQUNNO0FBQ04sUUFBTSxtQkFBbUIsb0JBQW9CLEtBQUs7QUFDbEQsTUFBSSxDQUFDLGtCQUFrQjtBQUNyQjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFFBQVEsTUFBTSxRQUFRLE1BQU0sSUFBSTtBQUN0QyxXQUFTLFFBQVEsR0FBRyxRQUFRLGtCQUFrQixTQUFTLEdBQUc7QUFDeEQsVUFBTSxPQUFPLE1BQU0sS0FBSyxLQUFLO0FBQzdCLFVBQU0sU0FBUyxpQkFBaUIsSUFBSTtBQUNwQyxRQUFJLENBQUMsT0FBTyxRQUFRO0FBQ2xCO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sWUFBWSxJQUFJLEtBQUs7QUFDL0QsZUFBVyxTQUFTLFFBQVE7QUFDMUIsVUFBSSxNQUFNLFNBQVMsTUFBTSxJQUFJO0FBQzNCO0FBQUEsTUFDRjtBQUNBLGNBQVE7QUFBQSxRQUNOLFFBQVEsT0FBTyxNQUFNO0FBQUEsUUFDckIsUUFBUSxPQUFPLE1BQU07QUFBQSxRQUNyQix1QkFBVyxLQUFLLEVBQUUsT0FBTyxNQUFNLFVBQVUsQ0FBQztBQUFBLE1BQzVDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsc0JBQXNCLFdBQXdCLE1BQW9CO0FBQ3pFLE1BQUksU0FBUztBQUViLGFBQVcsU0FBUyxpQkFBaUIsSUFBSSxHQUFHO0FBQzFDLFFBQUksTUFBTSxPQUFPLFFBQVE7QUFDdkIsZ0JBQVUsV0FBVyxLQUFLLE1BQU0sUUFBUSxNQUFNLElBQUksQ0FBQztBQUFBLElBQ3JEO0FBRUEsVUFBTSxPQUFPLFVBQVUsV0FBVyxFQUFFLEtBQUssTUFBTSxVQUFVLENBQUM7QUFDMUQsU0FBSyxRQUFRLEtBQUssTUFBTSxNQUFNLE1BQU0sTUFBTSxFQUFFLENBQUM7QUFDN0MsYUFBUyxNQUFNO0FBQUEsRUFDakI7QUFFQSxNQUFJLFNBQVMsS0FBSyxRQUFRO0FBQ3hCLGNBQVUsV0FBVyxLQUFLLE1BQU0sTUFBTSxDQUFDO0FBQUEsRUFDekM7QUFDRjtBQUVBLFNBQVMsaUJBQWlCLE1BQTJCO0FBQ25ELFFBQU0sU0FBc0IsQ0FBQztBQUM3QixNQUFJLFFBQVE7QUFFWixnQkFBYyxNQUFNLE1BQU07QUFFMUIsU0FBTyxRQUFRLEtBQUssUUFBUTtBQUMxQixVQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFFBQUksWUFBWSxLQUFLO0FBQ25CLGFBQU8sS0FBSyxFQUFFLE1BQU0sT0FBTyxJQUFJLEtBQUssUUFBUSxXQUFXLG9CQUFvQixDQUFDO0FBQzVFO0FBQUEsSUFDRjtBQUVBLFFBQUksS0FBSyxLQUFLLE9BQU8sR0FBRztBQUN0QixlQUFTO0FBQ1Q7QUFBQSxJQUNGO0FBRUEsVUFBTSxjQUFjLGdCQUFnQixNQUFNLEtBQUs7QUFDL0MsUUFBSSxhQUFhO0FBQ2YsVUFBSSxZQUFZLFlBQVksT0FBTztBQUNqQyxlQUFPLEtBQUssRUFBRSxNQUFNLE9BQU8sSUFBSSxZQUFZLFdBQVcsV0FBVywwQkFBMEIsQ0FBQztBQUFBLE1BQzlGO0FBQ0EsYUFBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFlBQVksSUFBSSxZQUFZLFVBQVUsV0FBVyxtQkFBbUIsQ0FBQztBQUNyRyxjQUFRLFlBQVk7QUFDcEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUNKLGdCQUFnQixNQUFNLE9BQU8sMkJBQTJCLHVCQUF1QixNQUFNLEtBQ3JGLGdCQUFnQixNQUFNLE9BQU8seUNBQXlDLG9CQUFvQixNQUFNLEtBQ2hHLGdCQUFnQixNQUFNLE9BQU8seUNBQXlDLG1CQUFtQixNQUFNLEtBQy9GLGdCQUFnQixNQUFNLE9BQU8seUNBQXlDLHNCQUFzQixNQUFNLEtBQ2xHLGdCQUFnQixNQUFNLE9BQU8sbUNBQW1DLG9CQUFvQixNQUFNLEtBQzFGLGdCQUFnQixNQUFNLE9BQU8sV0FBVyw2QkFBNkIsTUFBTSxLQUMzRSxnQkFBZ0IsTUFBTSxPQUFPLGdDQUFnQyxrQkFBa0IsTUFBTSxLQUNyRixnQkFBZ0IsTUFBTSxPQUFPLDBCQUEwQixvQkFBb0IsTUFBTSxLQUNqRixnQkFBZ0IsTUFBTSxPQUFPLGtEQUFrRCxvQkFBb0IsTUFBTSxLQUN6RyxnQkFBZ0IsTUFBTSxPQUFPLDhCQUE4QixvQkFBb0IsTUFBTSxLQUNyRixnQkFBZ0IsTUFBTSxPQUFPLGVBQWUsb0JBQW9CLE1BQU0sS0FDdEUsZ0JBQWdCLE1BQU0sT0FBTyxXQUFXLHlCQUF5QixNQUFNO0FBRXpFLFFBQUksU0FBUztBQUNYLGNBQVE7QUFDUjtBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU8sU0FBUyxNQUFNLEtBQUs7QUFDakMsUUFBSSxNQUFNO0FBQ1IsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixJQUFJLEtBQUs7QUFBQSxRQUNULFdBQVcsYUFBYSxLQUFLLEtBQUs7QUFBQSxNQUNwQyxDQUFDO0FBQ0QsY0FBUSxLQUFLO0FBQ2I7QUFBQSxJQUNGO0FBRUEsUUFBSSxlQUFlLFNBQVMsT0FBTyxHQUFHO0FBQ3BDLGFBQU8sS0FBSyxFQUFFLE1BQU0sT0FBTyxJQUFJLFFBQVEsR0FBRyxXQUFXLGtCQUFrQixDQUFDO0FBQ3hFLGVBQVM7QUFDVDtBQUFBLElBQ0Y7QUFFQSxhQUFTO0FBQUEsRUFDWDtBQUVBLFNBQU8sZ0JBQWdCLE1BQU07QUFDL0I7QUFFQSxTQUFTLGNBQWMsTUFBYyxRQUEyQjtBQUM5RCxRQUFNLFFBQVEsS0FBSyxNQUFNLHNGQUFzRjtBQUMvRyxNQUFJLENBQUMsU0FBUyxNQUFNLFNBQVMsTUFBTTtBQUNqQztBQUFBLEVBQ0Y7QUFFQSxRQUFNLGFBQWEsTUFBTSxDQUFDLEVBQUU7QUFDNUIsUUFBTSxZQUFZLE1BQU0sQ0FBQyxLQUFLLE1BQU0sQ0FBQztBQUNyQyxNQUFJLENBQUMsV0FBVztBQUNkO0FBQUEsRUFDRjtBQUVBLFNBQU8sS0FBSztBQUFBLElBQ1YsTUFBTTtBQUFBLElBQ04sSUFBSSxhQUFhLFVBQVU7QUFBQSxJQUMzQixXQUFXO0FBQUEsRUFDYixDQUFDO0FBQ0QsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNLGFBQWEsVUFBVTtBQUFBLElBQzdCLElBQUksYUFBYSxVQUFVLFNBQVM7QUFBQSxJQUNwQyxXQUFXO0FBQUEsRUFDYixDQUFDO0FBQ0g7QUFFQSxTQUFTLGFBQWEsTUFBc0I7QUFDMUMsTUFBSSxTQUFTLEtBQUssSUFBSSxLQUFLLHFCQUFxQixJQUFJLElBQUksR0FBRztBQUN6RCxXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sY0FBYyxJQUFJLElBQUksS0FBSztBQUNwQztBQUVBLFNBQVMsU0FBUyxNQUFjLE9BQXNEO0FBQ3BGLFFBQU0sUUFBUTtBQUNkLFFBQU0sWUFBWTtBQUNsQixRQUFNLFNBQVMsTUFBTSxLQUFLLElBQUk7QUFDOUIsTUFBSSxDQUFDLFFBQVE7QUFDWCxXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU87QUFBQSxJQUNMLE9BQU8sT0FBTyxDQUFDO0FBQUEsSUFDZixLQUFLLE1BQU07QUFBQSxFQUNiO0FBQ0Y7QUFFQSxTQUFTLGdCQUFnQixNQUFjLE9BQW1GO0FBQ3hILE1BQUksU0FBUztBQUNiLE1BQUksS0FBSyxNQUFNLE1BQU0sT0FBTyxLQUFLLFNBQVMsQ0FBQyxNQUFNLEtBQU07QUFDckQsY0FBVTtBQUFBLEVBQ1o7QUFFQSxNQUFJLEtBQUssTUFBTSxNQUFNLEtBQU07QUFDekIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLGFBQWE7QUFDbkIsWUFBVTtBQUNWLFNBQU8sU0FBUyxLQUFLLFFBQVE7QUFDM0IsUUFBSSxLQUFLLE1BQU0sTUFBTSxNQUFNO0FBQ3pCLGdCQUFVO0FBQ1Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxLQUFLLE1BQU0sTUFBTSxLQUFNO0FBQ3pCLGdCQUFVO0FBQ1Y7QUFBQSxJQUNGO0FBQ0EsY0FBVTtBQUFBLEVBQ1o7QUFFQSxTQUFPO0FBQUEsSUFDTCxXQUFXO0FBQUEsSUFDWDtBQUFBLElBQ0EsVUFBVTtBQUFBLEVBQ1o7QUFDRjtBQUVBLFNBQVMsZ0JBQ1AsTUFDQSxPQUNBLE9BQ0EsV0FDQSxRQUNlO0FBQ2YsUUFBTSxZQUFZO0FBQ2xCLFFBQU0sUUFBUSxNQUFNLEtBQUssSUFBSTtBQUM3QixNQUFJLENBQUMsT0FBTztBQUNWLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTyxLQUFLLEVBQUUsTUFBTSxPQUFPLElBQUksTUFBTSxXQUFXLFVBQVUsQ0FBQztBQUMzRCxTQUFPLE1BQU07QUFDZjtBQUVBLFNBQVMsZ0JBQWdCLFFBQWtDO0FBQ3pELFNBQU8sS0FBSyxDQUFDLE1BQU0sVUFBVSxLQUFLLE9BQU8sTUFBTSxRQUFRLEtBQUssS0FBSyxNQUFNLEVBQUU7QUFDekUsUUFBTSxhQUEwQixDQUFDO0FBQ2pDLE1BQUksU0FBUztBQUViLGFBQVcsU0FBUyxRQUFRO0FBQzFCLFFBQUksTUFBTSxNQUFNLFFBQVE7QUFDdEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLE1BQU0sTUFBTTtBQUN4QyxlQUFXLEtBQUssRUFBRSxHQUFHLE9BQU8sS0FBSyxDQUFDO0FBQ2xDLGFBQVMsTUFBTTtBQUFBLEVBQ2pCO0FBRUEsU0FBTztBQUNUO0FBRUEsU0FBUyxvQkFBb0IsT0FBOEI7QUFDekQsTUFBSSxNQUFNLFlBQVksTUFBTSxXQUFXO0FBQ3JDLFdBQU87QUFBQSxFQUNUO0FBRUEsTUFBSSxNQUFNLFFBQVEsV0FBVyxHQUFHO0FBQzlCLFdBQU8sTUFBTSxVQUFVLE1BQU0sWUFBWSxJQUFJLElBQUk7QUFBQSxFQUNuRDtBQUVBLFNBQU8sTUFBTSxRQUFRLE1BQU0sSUFBSSxFQUFFO0FBQ25DO0FBRUEsU0FBUyxTQUFTLFdBQW1CLE9BQTBDO0FBQzdFLFNBQU8sTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sU0FBUyxDQUFDO0FBQzlDOzs7QUMvVEEsb0JBQTJCO0FBRXBCLFNBQVMsVUFBVSxPQUF1QjtBQUMvQyxhQUFPLDBCQUFXLFFBQVEsRUFBRSxPQUFPLEtBQUssRUFBRSxPQUFPLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUNyRTs7O0FDV08sSUFBTSw2QkFBb0Q7QUFBQSxFQUMvRDtBQUFBLElBQ0UsSUFBSTtBQUFBLElBQ0osYUFBYTtBQUFBLElBQ2IsYUFBYTtBQUFBLElBQ2IsV0FBVztBQUFBLE1BQ1QsRUFBRSxJQUFJLFVBQVUsYUFBYSxVQUFVLFNBQVMsQ0FBQyxVQUFVLElBQUksRUFBRTtBQUFBLE1BQ2pFLEVBQUUsSUFBSSxjQUFjLGFBQWEsY0FBYyxTQUFTLENBQUMsY0FBYyxJQUFJLEVBQUU7QUFBQSxNQUM3RSxFQUFFLElBQUksY0FBYyxhQUFhLGNBQWMsU0FBUyxDQUFDLGNBQWMsSUFBSSxFQUFFO0FBQUEsTUFDN0UsRUFBRSxJQUFJLFNBQVMsYUFBYSxTQUFTLFNBQVMsQ0FBQyxTQUFTLE1BQU0sUUFBUSxLQUFLLEVBQUU7QUFBQSxNQUM3RSxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsSUFBSSxFQUFFO0FBQUEsTUFDM0QsRUFBRSxJQUFJLFFBQVEsYUFBYSxRQUFRLFNBQVMsQ0FBQyxRQUFRLElBQUksRUFBRTtBQUFBLE1BQzNELEVBQUUsSUFBSSxPQUFPLGFBQWEsT0FBTyxTQUFTLENBQUMsS0FBSyxFQUFFO0FBQUEsTUFDbEQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxLQUFLLEVBQUU7QUFBQSxNQUNsRCxFQUFFLElBQUksTUFBTSxhQUFhLE1BQU0sU0FBUyxDQUFDLE1BQU0sUUFBUSxFQUFFO0FBQUEsTUFDekQsRUFBRSxJQUFJLFdBQVcsYUFBYSxXQUFXLFNBQVMsQ0FBQyxXQUFXLElBQUksRUFBRTtBQUFBLE1BQ3BFLEVBQUUsSUFBSSxTQUFTLGFBQWEsU0FBUyxTQUFTLENBQUMsU0FBUyxJQUFJLEVBQUU7QUFBQSxJQUNoRTtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksS0FBSyxhQUFhLEtBQUssU0FBUyxDQUFDLEtBQUssR0FBRyxFQUFFO0FBQUEsTUFDakQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxPQUFPLE9BQU8sTUFBTSxLQUFLLEVBQUU7QUFBQSxJQUN4RTtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsSUFBSSxFQUFFO0FBQUEsTUFDM0QsRUFBRSxJQUFJLFFBQVEsYUFBYSxRQUFRLFNBQVMsQ0FBQyxNQUFNLEVBQUU7QUFBQSxJQUN2RDtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsT0FBTyxFQUFFO0FBQUEsTUFDOUQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxPQUFPLEdBQUcsRUFBRTtBQUFBLE1BQ3ZELEVBQUUsSUFBSSxVQUFVLGFBQWEsV0FBVyxTQUFTLENBQUMsT0FBTyxRQUFRLFVBQVUsV0FBVyxJQUFJLEVBQUU7QUFBQSxJQUM5RjtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksV0FBVyxhQUFhLFdBQVcsU0FBUyxDQUFDLFFBQVEsVUFBVSxXQUFXLElBQUksRUFBRTtBQUFBLElBQ3hGO0FBQUEsRUFDRjtBQUFBLEVBQ0E7QUFBQSxJQUNFLElBQUk7QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLGFBQWE7QUFBQSxJQUNiLFdBQVc7QUFBQSxNQUNULEVBQUUsSUFBSSxVQUFVLGFBQWEsVUFBVSxTQUFTLENBQUMsUUFBUSxVQUFVLFNBQVMsS0FBSyxFQUFFO0FBQUEsTUFDbkYsRUFBRSxJQUFJLFlBQVksYUFBYSxZQUFZLFNBQVMsQ0FBQyxZQUFZLElBQUksRUFBRTtBQUFBLElBQ3pFO0FBQUEsRUFDRjtBQUNGO0FBRU8sSUFBTSw2QkFBNkI7QUFDbkMsSUFBTSxpQ0FBaUM7QUFFdkMsU0FBUyw0QkFBc0M7QUFDcEQsU0FBTyxDQUFDLEdBQUcsMkJBQTJCLElBQUksQ0FBQyxTQUFTLEtBQUssRUFBRSxHQUFHLDBCQUEwQjtBQUMxRjtBQUVPLFNBQVMsd0JBQWtDO0FBQ2hELFNBQU8sMkJBQTJCLFFBQVEsQ0FBQyxTQUFTLEtBQUssVUFBVSxJQUFJLENBQUMsYUFBYSxTQUFTLEVBQUUsQ0FBQztBQUNuRztBQUVPLFNBQVMsK0JBQStCLFVBQW9DO0FBQ2pGLE1BQUksQ0FBQyxNQUFNLFFBQVEsU0FBUyxvQkFBb0IsS0FBSyxDQUFDLFNBQVMscUJBQXFCLFFBQVE7QUFDMUYsYUFBUyx1QkFBdUIsMEJBQTBCO0FBQUEsRUFDNUQ7QUFDQSxNQUFJLENBQUMsTUFBTSxRQUFRLFNBQVMsZ0JBQWdCLEtBQUssQ0FBQyxTQUFTLGlCQUFpQixRQUFRO0FBQ2xGLGFBQVMsbUJBQW1CLHNCQUFzQjtBQUFBLEVBQ3BEO0FBQ0EsTUFBSSxDQUFDLE9BQU8sU0FBUyxTQUFTLDRCQUE0QixHQUFHO0FBQzNELGFBQVMsK0JBQStCO0FBQUEsRUFDMUM7QUFDQSxNQUFJLFNBQVMsK0JBQStCLEdBQUc7QUFDN0MsMEJBQXNCLFVBQVUsTUFBTTtBQUN0QyxhQUFTLCtCQUErQjtBQUFBLEVBQzFDO0FBQ0Y7QUFFQSxTQUFTLHNCQUFzQixVQUE4QixXQUF5QjtBQUNwRixRQUFNLE9BQU8sMkJBQTJCLEtBQUssQ0FBQyxjQUFjLFVBQVUsT0FBTyxTQUFTO0FBQ3RGLE1BQUksQ0FBQyxNQUFNO0FBQ1Q7QUFBQSxFQUNGO0FBQ0EsZUFBYSxTQUFTLHNCQUFzQixLQUFLLEVBQUU7QUFDbkQsYUFBVyxZQUFZLEtBQUssV0FBVztBQUNyQyxpQkFBYSxTQUFTLGtCQUFrQixTQUFTLEVBQUU7QUFBQSxFQUNyRDtBQUNGO0FBRUEsU0FBUyxhQUFhLFFBQWtCLE9BQXFCO0FBQzNELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxHQUFHO0FBQzNCLFdBQU8sS0FBSyxLQUFLO0FBQUEsRUFDbkI7QUFDRjtBQUVPLFNBQVMsOEJBQThCLFVBQXdEO0FBQ3BHLGlDQUErQixRQUFRO0FBQ3ZDLFFBQU0sZUFBZSxJQUFJLElBQUksU0FBUyxvQkFBb0I7QUFDMUQsUUFBTSxtQkFBbUIsSUFBSSxJQUFJLFNBQVMsZ0JBQWdCO0FBRTFELFNBQU8sMkJBQ0osT0FBTyxDQUFDLFNBQVMsYUFBYSxJQUFJLEtBQUssRUFBRSxDQUFDLEVBQzFDLFFBQVEsQ0FBQyxTQUFTLEtBQUssU0FBUyxFQUNoQyxPQUFPLENBQUMsYUFBYSxpQkFBaUIsSUFBSSxTQUFTLEVBQUUsQ0FBQztBQUMzRDtBQUVPLFNBQVMsMkJBQTJCLFVBQXNFO0FBQy9HLFNBQU8sT0FBTztBQUFBLElBQ1osOEJBQThCLFFBQVEsRUFBRTtBQUFBLE1BQVEsQ0FBQyxhQUMvQyxTQUFTLFFBQVEsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLFlBQVksR0FBRyxTQUFTLEVBQUUsQ0FBVTtBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUNGO0FBRU8sU0FBUyxrQkFBa0IsWUFBb0MsVUFBdUM7QUFDM0csaUNBQStCLFFBQVE7QUFDdkMsU0FBTyw4QkFBOEIsUUFBUSxFQUFFLEtBQUssQ0FBQyxhQUFhLFNBQVMsT0FBTyxVQUFVO0FBQzlGO0FBRU8sU0FBUywwQkFBMEIsVUFBdUM7QUFDL0UsaUNBQStCLFFBQVE7QUFDdkMsU0FBTyxTQUFTLHFCQUFxQixTQUFTLDBCQUEwQjtBQUMxRTs7O0FDcEpBLElBQU0sZUFBZTtBQUNyQixJQUFNLGFBQWE7QUFDbkIsSUFBTSxjQUFjO0FBRWIsU0FBUyxrQkFBa0IsYUFBcUIsVUFBOEQ7QUFDbkgsUUFBTSxhQUFhLFlBQVksS0FBSyxFQUFFLFlBQVk7QUFFbEQsTUFBSSxDQUFDLFVBQVU7QUFDYixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksMEJBQTBCLFFBQVEsR0FBRztBQUN2QyxlQUFXLFlBQVksU0FBUyxtQkFBbUIsQ0FBQyxHQUFHO0FBQ3JELFlBQU0sT0FBTyxTQUFTLEtBQUssS0FBSyxFQUFFLFlBQVk7QUFDOUMsWUFBTUMsV0FBVSxlQUFlLFNBQVMsT0FBTztBQUMvQyxVQUFJLFNBQVMsU0FBUyxjQUFjQSxTQUFRLFNBQVMsVUFBVSxJQUFJO0FBQ2pFLGVBQU8sU0FBUyxLQUFLLEtBQUs7QUFBQSxNQUM1QjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxVQUFVLDJCQUEyQixRQUFRO0FBQ25ELFNBQU8sUUFBUSxVQUFVLEtBQUs7QUFDaEM7QUFFTyxTQUFTLDRCQUE0QixVQUF5QztBQUNuRixNQUFJLENBQUMsVUFBVTtBQUNiLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFFQSxRQUFNLGdCQUFnQiwwQkFBMEIsUUFBUSxLQUNuRCxTQUFTLG1CQUFtQixDQUFDLEdBQUcsUUFBUSxDQUFDLGFBQWE7QUFDekQsVUFBTSxPQUFPLFNBQVMsS0FBSyxLQUFLLEVBQUUsWUFBWTtBQUM1QyxXQUFPLENBQUMsTUFBTSxHQUFHLGVBQWUsU0FBUyxPQUFPLENBQUM7QUFBQSxFQUNuRCxDQUFDLElBQ0MsQ0FBQztBQUVMLFNBQU87QUFBQSxJQUNMLEdBQUcsT0FBTyxLQUFLLDJCQUEyQixRQUFRLENBQUM7QUFBQSxJQUNuRCxHQUFHO0FBQUEsRUFDTCxFQUFFLElBQUksQ0FBQyxVQUFVLE1BQU0sWUFBWSxDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQ3REO0FBRU8sU0FBUyx3QkFBd0IsVUFBa0IsUUFBZ0IsVUFBZ0Q7QUFDeEgsUUFBTSxRQUFRLE9BQU8sTUFBTSxPQUFPO0FBQ2xDLFFBQU0sU0FBMEIsQ0FBQztBQUNqQyxNQUFJLFVBQVU7QUFDZCxNQUFJLHNCQUFzQjtBQUUxQixXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBTSxPQUFPLE1BQU0sQ0FBQztBQUVwQixRQUFJLHFCQUFxQjtBQUN2QixVQUFJLFdBQVcsS0FBSyxLQUFLLEtBQUssQ0FBQyxHQUFHO0FBQ2hDLDhCQUFzQjtBQUFBLE1BQ3hCO0FBQ0E7QUFBQSxJQUNGO0FBRUEsUUFBSSxhQUFhLEtBQUssS0FBSyxLQUFLLENBQUMsR0FBRztBQUNsQyw0QkFBc0I7QUFDdEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxhQUFhLEtBQUssTUFBTSxXQUFXO0FBQ3pDLFFBQUksQ0FBQyxZQUFZO0FBQ2Y7QUFBQSxJQUNGO0FBRUEsVUFBTSxZQUFZO0FBQ2xCLFVBQU0sY0FBY0Msc0JBQXFCLElBQUk7QUFDN0MsVUFBTSxhQUFhLFdBQVcsQ0FBQztBQUMvQixVQUFNLGtCQUFrQixXQUFXLENBQUMsS0FBSyxJQUFJLEtBQUs7QUFDbEQsVUFBTSxpQkFBaUIsb0JBQW9CLFdBQVcsQ0FBQyxLQUFLLEVBQUU7QUFDOUQsVUFBTSxrQkFBa0IscUJBQXFCLGNBQWM7QUFDM0QsVUFBTSxtQkFBbUIsc0JBQXNCLGNBQWM7QUFDN0QsVUFBTSxXQUFXLGtCQUFrQixnQkFBZ0IsUUFBUTtBQUUzRCxRQUFJLFVBQVU7QUFDZCxVQUFNLGVBQXlCLENBQUM7QUFFaEMsYUFBUyxJQUFJLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDNUMsWUFBTSxZQUFZLE1BQU0sQ0FBQztBQUN6QixZQUFNLFVBQVUsVUFBVSxLQUFLO0FBRS9CLFVBQUksUUFBUSxXQUFXLFVBQVUsS0FBSyxtQkFBbUIsS0FBSyxPQUFPLEdBQUc7QUFDdEUsa0JBQVU7QUFDVixZQUFJO0FBQ0o7QUFBQSxNQUNGO0FBRUEsbUJBQWEsS0FBSyxpQkFBaUIsV0FBVyxXQUFXLENBQUM7QUFDMUQsZ0JBQVU7QUFBQSxJQUNaO0FBRUEsUUFBSSxDQUFDLFVBQVU7QUFDYjtBQUFBLElBQ0Y7QUFFQSxlQUFXO0FBQ1gsVUFBTSxVQUFVLGFBQWEsS0FBSyxJQUFJO0FBQ3RDLFVBQU0sZ0JBQWdCLGtCQUFrQixJQUFJLEtBQUssVUFBVSxlQUFlLENBQUMsS0FBSztBQUNoRixVQUFNLGdCQUFnQiwwQkFBMEIsZ0JBQWdCLElBQUksSUFBSSxLQUFLLFVBQVUsZ0JBQWdCLENBQUMsS0FBSztBQUM3RyxVQUFNLGdCQUFnQixPQUFPLEtBQUssY0FBYyxFQUFFLFNBQVMsSUFBSSxLQUFLLFVBQVUsY0FBYyxDQUFDLEtBQUs7QUFDbEcsVUFBTSxjQUFjLFVBQVUsR0FBRyxPQUFPLEdBQUcsYUFBYSxHQUFHLGFBQWEsR0FBRyxhQUFhLEVBQUU7QUFDMUYsVUFBTSxLQUFLLFVBQVUsR0FBRyxRQUFRLElBQUksT0FBTyxJQUFJLFFBQVEsSUFBSSxXQUFXLEVBQUU7QUFFeEUsV0FBTyxLQUFLO0FBQUEsTUFDVjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsZUFBZSxlQUFlLFlBQVk7QUFBQSxNQUMxQztBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVk7QUFBQSxNQUNaO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFZO0FBQUEsTUFDWixVQUFVO0FBQUEsSUFDWixDQUFDO0FBQUEsRUFDSDtBQUVBLFNBQU87QUFDVDtBQUVBLFNBQVMsMEJBQTBCLFNBQTREO0FBQzdGLFNBQU8sUUFBUSxRQUFRLGtCQUFrQixRQUFRLG9CQUFvQixRQUFRLG9CQUFvQixRQUFRLFNBQVM7QUFDcEg7QUFFQSxTQUFTLGVBQWUsT0FBeUI7QUFDL0MsU0FBTyxNQUNKLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxVQUFVLE1BQU0sS0FBSyxFQUFFLFlBQVksQ0FBQyxFQUN6QyxPQUFPLE9BQU87QUFDbkI7QUFFQSxTQUFTLHFCQUFxQixPQUFnRTtBQUM1RixRQUFNLFdBQVcsTUFBTSxXQUFXLEtBQUssTUFBTSxRQUFRLE1BQU0sT0FBTyxNQUFNO0FBQ3hFLE1BQUksQ0FBQyxVQUFVO0FBQ2IsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQVEsTUFBTSxZQUFZLEtBQUssTUFBTSxTQUFTLE1BQU07QUFDMUQsUUFBTSxZQUFZLFFBQVEsZUFBZSxLQUFLLElBQUk7QUFDbEQsUUFBTSxhQUFhLE1BQU0sYUFBYSxLQUFLLE1BQU0sVUFBVSxNQUFNLE1BQU0sTUFBTTtBQUM3RSxRQUFNLGFBQWEsTUFBTSxXQUFXLEtBQUssTUFBTSxRQUFRLE1BQU07QUFDN0QsUUFBTSxpQkFBaUIsTUFBTSxXQUFXLEtBQUssTUFBTTtBQUNuRCxRQUFNLFdBQVcsTUFBTSxXQUFXLEtBQUssTUFBTTtBQUM3QyxRQUFNLGFBQWEsTUFBTSxZQUFZLEtBQUssTUFBTTtBQUNoRCxRQUFNLE9BQU8sa0JBQWtCLFFBQVEsWUFBWSxPQUMvQztBQUFBLElBQ0EsWUFBWSwwQkFBMEIsY0FBYyxNQUFNLFNBQVMsU0FBWTtBQUFBLElBQy9FLE1BQU07QUFBQSxJQUNOLE9BQU8sY0FBYyxPQUFPLE9BQU8sQ0FBQyxDQUFDLEtBQUssU0FBUyxNQUFNLEtBQUssRUFBRSxTQUFTLFdBQVcsWUFBWSxDQUFDO0FBQUEsRUFDbkcsSUFDRTtBQUVKLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxXQUFXLFdBQVc7QUFBQSxJQUN0QixTQUFTLFdBQVc7QUFBQSxJQUNwQjtBQUFBLElBQ0EsbUJBQW1CLGNBQWMsT0FBTyxPQUFPLENBQUMsQ0FBQyxLQUFLLFNBQVMsTUFBTSxLQUFLLEVBQUUsU0FBUyxXQUFXLFlBQVksQ0FBQztBQUFBLElBQzdHO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxzQkFBc0IsT0FBK0I7QUFDNUQsUUFBTSxZQUFZLE1BQU0sZ0JBQWdCLEtBQUssTUFBTTtBQUNuRCxRQUFNLFVBQVUsTUFBTSxjQUFjLEtBQUssTUFBTTtBQUMvQyxRQUFNLG1CQUFtQixNQUFNLFVBQVUsS0FBSyxNQUFNLE9BQU8sTUFBTSxtQkFBbUI7QUFDcEYsUUFBTSxZQUFZLFVBQVVDLHNCQUFxQixPQUFPLElBQUk7QUFFNUQsU0FBTztBQUFBLElBQ0wsZ0JBQWdCLGFBQWEsQ0FBQ0MsaUJBQWdCLFNBQVMsSUFBSSxZQUFZO0FBQUEsSUFDdkUsa0JBQWtCLFlBQVlBLGlCQUFnQixTQUFTLElBQUk7QUFBQSxJQUMzRDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTRCxzQkFBcUIsT0FBbUM7QUFDL0QsUUFBTSxTQUFTLE9BQU8sU0FBUyxNQUFNLEtBQUssR0FBRyxFQUFFO0FBQy9DLFNBQU8sT0FBTyxVQUFVLE1BQU0sS0FBSyxTQUFTLElBQUksU0FBUztBQUMzRDtBQUVBLFNBQVNDLGlCQUFnQixPQUF3QjtBQUMvQyxTQUFPLENBQUMsS0FBSyxTQUFTLE1BQU0sT0FBTyxRQUFRLFFBQVEsRUFBRSxTQUFTLE1BQU0sS0FBSyxFQUFFLFlBQVksQ0FBQztBQUMxRjtBQUVBLFNBQVMsMEJBQTBCLE9BQStDO0FBQ2hGLFNBQU8sU0FBUyxPQUFPLFNBQVksTUFBTSxLQUFLLEVBQUUsWUFBWTtBQUM5RDtBQUVBLFNBQVMsb0JBQW9CLE9BQXVDO0FBQ2xFLFFBQU0sUUFBZ0MsQ0FBQztBQUN2QyxRQUFNLFVBQVU7QUFDaEIsTUFBSTtBQUNKLFVBQVEsUUFBUSxRQUFRLEtBQUssS0FBSyxNQUFNLE1BQU07QUFDNUMsVUFBTSxNQUFNLENBQUMsRUFBRSxZQUFZLENBQUMsSUFBSSxNQUFNLENBQUMsS0FBSyxNQUFNLENBQUMsS0FBSyxNQUFNLENBQUMsS0FBSztBQUFBLEVBQ3RFO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLE9BQXNEO0FBQzVFLFFBQU0sUUFBUSxNQUFNLEtBQUssRUFBRSxNQUFNLGtDQUFrQztBQUNuRSxNQUFJLENBQUMsT0FBTztBQUNWLFdBQU87QUFBQSxFQUNUO0FBQ0EsUUFBTSxRQUFRLE9BQU8sU0FBUyxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQzFDLFFBQU0sTUFBTSxPQUFPLFNBQVMsTUFBTSxDQUFDLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRTtBQUNwRCxNQUFJLENBQUMsT0FBTyxVQUFVLEtBQUssS0FBSyxDQUFDLE9BQU8sVUFBVSxHQUFHLEtBQUssU0FBUyxLQUFLLE1BQU0sT0FBTztBQUNuRixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sRUFBRSxPQUFPLElBQUk7QUFDdEI7QUFFTyxTQUFTLGdCQUFnQixRQUF5QixNQUFvQztBQUMzRixTQUFPLE9BQU8sS0FBSyxDQUFDLFVBQVUsUUFBUSxNQUFNLGFBQWEsUUFBUSxNQUFNLE9BQU8sS0FBSztBQUNyRjtBQUVBLFNBQVNGLHNCQUFxQixNQUFzQjtBQUNsRCxRQUFNLFFBQVEsS0FBSyxNQUFNLFNBQVM7QUFDbEMsU0FBTyxRQUFRLENBQUMsS0FBSztBQUN2QjtBQUVBLFNBQVMsaUJBQWlCLE1BQWMsYUFBNkI7QUFDbkUsTUFBSSxDQUFDLGFBQWE7QUFDaEIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxNQUFJLFFBQVE7QUFDWixTQUFPLFFBQVEsWUFBWSxVQUFVLFFBQVEsS0FBSyxVQUFVLEtBQUssS0FBSyxNQUFNLFlBQVksS0FBSyxHQUFHO0FBQzlGLGFBQVM7QUFBQSxFQUNYO0FBRUEsU0FBTyxLQUFLLE1BQU0sS0FBSztBQUN6Qjs7O0FDMU9BLElBQU0sd0JBQWdFO0FBQUEsRUFDcEUsUUFBUTtBQUFBLElBQ04sVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxZQUFZO0FBQUEsSUFDVixVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLFlBQVk7QUFBQSxJQUNWLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsR0FBRztBQUFBLElBQ0QsVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxLQUFLO0FBQUEsSUFDSCxVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLFdBQVc7QUFBQSxJQUNULFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsVUFBVTtBQUFBLElBQ1IsVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxVQUFVO0FBQUEsSUFDUixVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFDRjtBQUVPLFNBQVMsc0JBQXNCLFVBQWtDLHVCQUF1QixPQUErQjtBQUM1SCxNQUFJLHNCQUFzQjtBQUN4QixXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0Esa0JBQWtCO0FBQUEsTUFDbEIsbUJBQW1CO0FBQUEsTUFDbkIsYUFBYTtBQUFBLE1BQ2IsZUFBZTtBQUFBLElBQ2pCO0FBQUEsRUFDRjtBQUVBLFNBQU8sc0JBQXNCLFFBQVEsS0FBSztBQUFBLElBQ3hDO0FBQUEsSUFDQSxrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFDRjs7O0FDekdPLElBQU0sYUFBTixNQUF1QztBQUFBLEVBQXZDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxjQUFjLFlBQVk7QUFBQTtBQUFBLEVBRXZDLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsY0FBYztBQUNuQyxhQUFPLFFBQVEsU0FBUyxlQUFlLEtBQUssQ0FBQztBQUFBLElBQy9DO0FBRUEsV0FBTyxRQUFRLFNBQVMsK0JBQStCLEtBQUssQ0FBQztBQUFBLEVBQy9EO0FBQUEsRUFFQSxNQUFNLElBQUksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDN0csUUFBSSxNQUFNLGFBQWEsY0FBYztBQUNuQyxhQUFPLG1CQUFtQjtBQUFBLFFBQ3hCLFVBQVUsS0FBSztBQUFBLFFBQ2YsWUFBWSxLQUFLO0FBQUEsUUFDakIsWUFBWSxTQUFTLGVBQWUsS0FBSztBQUFBLFFBQ3pDLE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxRQUFRO0FBQUEsUUFDbkIsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUFBLElBQ0g7QUFFQSxVQUFNLGFBQWEsU0FBUywrQkFBK0IsS0FBSztBQUNoRSxVQUFNLGFBQWEsU0FBUyxtQkFBbUIsUUFBUSxxQkFBcUI7QUFFNUUsV0FBTyxtQkFBbUI7QUFBQSxNQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksU0FBUyxjQUFjO0FBQUEsTUFDL0M7QUFBQSxNQUNBO0FBQUEsTUFDQSxNQUFNLENBQUMsUUFBUTtBQUFBLE1BQ2YsZUFBZTtBQUFBLE1BQ2YsUUFBUSxNQUFNO0FBQUEsTUFDZCxrQkFBa0IsUUFBUTtBQUFBLE1BQzFCLFdBQVcsUUFBUTtBQUFBLE1BQ25CLFFBQVEsUUFBUTtBQUFBLElBQ2xCLENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQzFDTyxJQUFNLHVCQUFOLE1BQWlEO0FBQUEsRUFBakQ7QUFDTCxjQUFLO0FBQ0wsdUJBQWM7QUFDZCxxQkFBWSxDQUFDO0FBQUE7QUFBQSxFQUViLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsV0FBTyxRQUFRLEtBQUssa0JBQWtCLE9BQU8sUUFBUSxHQUFHLFdBQVcsS0FBSyxDQUFDO0FBQUEsRUFDM0U7QUFBQSxFQUVBLElBQUksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDdkcsVUFBTSxXQUFXLEtBQUssa0JBQWtCLE9BQU8sUUFBUTtBQUN2RCxRQUFJLENBQUMsVUFBVTtBQUNiLFlBQU0sSUFBSSxNQUFNLGdDQUFnQyxNQUFNLFFBQVEsRUFBRTtBQUFBLElBQ2xFO0FBRUEsV0FBTyxtQkFBbUI7QUFBQSxNQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksU0FBUyxJQUFJO0FBQUEsTUFDckMsWUFBWSxTQUFTO0FBQUEsTUFDckIsWUFBWSxTQUFTLFdBQVcsS0FBSztBQUFBLE1BQ3JDLE1BQU0saUJBQWlCLFNBQVMsUUFBUSxRQUFRO0FBQUEsTUFDaEQsZUFBZUcsb0JBQW1CLFNBQVMsV0FBVyxTQUFTLElBQUk7QUFBQSxNQUNuRSxRQUFRLE1BQU07QUFBQSxNQUNkLGtCQUFrQixRQUFRO0FBQUEsTUFDMUIsV0FBVyxRQUFRO0FBQUEsTUFDbkIsUUFBUSxRQUFRO0FBQUEsSUFDbEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVRLGtCQUFrQixPQUFzQixVQUE4RDtBQUM1RyxVQUFNLGFBQWEsTUFBTSxTQUFTLEtBQUssRUFBRSxZQUFZO0FBQ3JELFdBQU8sU0FBUyxnQkFBZ0IsS0FBSyxDQUFDLGFBQWE7QUFDakQsWUFBTSxPQUFPLFNBQVMsS0FBSyxLQUFLLEVBQUUsWUFBWTtBQUM5QyxZQUFNLFVBQVUsU0FBUyxRQUN0QixNQUFNLEdBQUcsRUFDVCxJQUFJLENBQUMsVUFBVSxNQUFNLEtBQUssRUFBRSxZQUFZLENBQUMsRUFDekMsT0FBTyxPQUFPO0FBQ2pCLGFBQU8sU0FBUyxjQUFjLFFBQVEsU0FBUyxVQUFVO0FBQUEsSUFDM0QsQ0FBQztBQUFBLEVBQ0g7QUFDRjtBQUVBLFNBQVNBLG9CQUFtQixXQUFtQixNQUFzQjtBQUNuRSxRQUFNLFVBQVUsVUFBVSxLQUFLO0FBQy9CLE1BQUksQ0FBQyxTQUFTO0FBQ1osV0FBTyxJQUFJLElBQUk7QUFBQSxFQUNqQjtBQUNBLFNBQU8sUUFBUSxXQUFXLEdBQUcsSUFBSSxVQUFVLElBQUksT0FBTztBQUN4RDs7O0FDdENBLElBQU0sb0JBQXVDO0FBQUEsRUFDM0M7QUFBQSxJQUNFLFVBQVU7QUFBQSxJQUNWLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxhQUFhLFNBQVM7QUFBQSxJQUNuQyxlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBO0FBQUEsSUFDRSxVQUFVO0FBQUEsSUFDVixhQUFhO0FBQUEsSUFDYixZQUFZLENBQUMsYUFBYSxTQUFTO0FBQUEsSUFDbkMsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQTtBQUFBLElBQ0UsVUFBVTtBQUFBLElBQ1YsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGFBQWEsU0FBUztBQUFBLElBQ25DLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0E7QUFBQSxJQUNFLFVBQVU7QUFBQSxJQUNWLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxhQUFhLFNBQVM7QUFBQSxJQUNuQyxlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBO0FBQUEsSUFDRSxVQUFVO0FBQUEsSUFDVixhQUFhO0FBQUEsSUFDYixZQUFZLENBQUMsYUFBYSxTQUFTO0FBQUEsSUFDbkMsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQTtBQUFBLElBQ0UsVUFBVTtBQUFBLElBQ1YsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGFBQWEsU0FBUztBQUFBLElBQ25DLGVBQWU7QUFBQSxJQUNmLE1BQU0sQ0FBQyxPQUFPLFFBQVE7QUFBQSxJQUN0QixLQUFLO0FBQUEsTUFDSCxTQUFTO0FBQUEsSUFDWDtBQUFBLElBQ0Esa0JBQWtCO0FBQUEsRUFDcEI7QUFBQSxFQUNBO0FBQUEsSUFDRSxVQUFVO0FBQUEsSUFDVixhQUFhO0FBQUEsSUFDYixZQUFZLENBQUMsYUFBYSxTQUFTO0FBQUEsSUFDbkMsZUFBZTtBQUFBLElBQ2Ysa0JBQWtCO0FBQUEsRUFDcEI7QUFDRjtBQUVPLElBQU0sb0JBQU4sTUFBOEM7QUFBQSxFQUE5QztBQUNMLGNBQUs7QUFDTCx1QkFBYztBQUNkLHFCQUFZLGtCQUFrQixJQUFJLENBQUMsU0FBUyxLQUFLLFFBQVE7QUFBQTtBQUFBLEVBRXpELE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsVUFBTSxPQUFPLEtBQUssUUFBUSxNQUFNLFFBQVE7QUFDeEMsV0FBTyxRQUFRLE1BQU0sV0FBVyxRQUFRLEVBQUUsS0FBSyxDQUFDO0FBQUEsRUFDbEQ7QUFBQSxFQUVBLElBQUksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDdkcsVUFBTSxPQUFPLEtBQUssUUFBUSxNQUFNLFFBQVE7QUFDeEMsUUFBSSxDQUFDLE1BQU07QUFDVCxZQUFNLElBQUksTUFBTSx5QkFBeUIsTUFBTSxRQUFRLEVBQUU7QUFBQSxJQUMzRDtBQUVBLFdBQU8sbUJBQW1CO0FBQUEsTUFDeEIsVUFBVSxHQUFHLEtBQUssRUFBRSxJQUFJLE1BQU0sUUFBUTtBQUFBLE1BQ3RDLFlBQVksS0FBSztBQUFBLE1BQ2pCLFlBQVksS0FBSyxXQUFXLFFBQVEsRUFBRSxLQUFLO0FBQUEsTUFDM0MsTUFBTSxLQUFLLFFBQVEsQ0FBQyxRQUFRO0FBQUEsTUFDNUIsZUFBZSxLQUFLO0FBQUEsTUFDcEIsUUFBUSxNQUFNO0FBQUEsTUFDZCxrQkFBa0IsUUFBUTtBQUFBLE1BQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxLQUFLLG9CQUFvQixDQUFDO0FBQUEsTUFDakUsUUFBUSxRQUFRO0FBQUEsTUFDaEIsS0FBSyxLQUFLO0FBQUEsSUFDWixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsUUFBUSxVQUErRDtBQUM3RSxXQUFPLGtCQUFrQixLQUFLLENBQUMsU0FBUyxLQUFLLGFBQWEsUUFBUTtBQUFBLEVBQ3BFO0FBQ0Y7OztBQ2pHQSxJQUFBQyxlQUFxQjtBQVFkLElBQU0sYUFBTixNQUF1QztBQUFBLEVBQXZDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxVQUFVLFVBQVU7QUFBQTtBQUFBLEVBRWpDLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsVUFBVTtBQUMvQixhQUFPLFFBQVEsU0FBUyxvQkFBb0IsS0FBSyxDQUFDO0FBQUEsSUFDcEQ7QUFDQSxRQUFJLE1BQU0sYUFBYSxZQUFZO0FBQ2pDLGFBQU8sUUFBUSxTQUFTLG1CQUFtQixLQUFLLENBQUM7QUFBQSxJQUNuRDtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLElBQUksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDN0csUUFBSSxNQUFNLGFBQWEsVUFBVTtBQUMvQixhQUFPLEtBQUssU0FBUyxPQUFPLFNBQVMsUUFBUTtBQUFBLElBQy9DO0FBQ0EsUUFBSSxNQUFNLGFBQWEsWUFBWTtBQUNqQyxhQUFPLEtBQUssWUFBWSxPQUFPLFNBQVMsUUFBUTtBQUFBLElBQ2xEO0FBQ0EsVUFBTSxJQUFJLE1BQU0sOEJBQThCLE1BQU0sUUFBUSxFQUFFO0FBQUEsRUFDaEU7QUFBQSxFQUVBLE1BQWMsU0FBUyxPQUFzQixTQUF5QixVQUFzRDtBQUMxSCxVQUFNLE9BQU8sY0FBYyxLQUFLO0FBQ2hDLFVBQU0sU0FBUyxrQkFBa0IsT0FBTyxvQkFBb0IsYUFBYSxFQUFFLFFBQVEsZ0JBQWdCO0FBQ25HLFVBQU0sZUFBZTtBQUFBLE1BQ25CLEdBQUcsU0FBUyxTQUFTLGdCQUFnQjtBQUFBLE1BQ3JDLEdBQUcsa0JBQWtCLE9BQU8sc0JBQXNCLGVBQWU7QUFBQSxJQUNuRTtBQUVBLFdBQU8sbUJBQW1CLFVBQVUsTUFBTSxTQUFTLE9BQU8sRUFBRSxTQUFTLFNBQVMsTUFBTTtBQUNsRixZQUFNLGlCQUFhLG1CQUFLLFNBQVMsZUFBZTtBQUNoRCxZQUFNLGdCQUFnQixNQUFNLFdBQVc7QUFBQSxRQUNyQyxVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLG9CQUFvQixLQUFLO0FBQUEsUUFDOUMsTUFBTTtBQUFBLFVBQ0o7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxHQUFHLGFBQWEsUUFBUSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sV0FBVyxDQUFDO0FBQUEsVUFDNUQsR0FBRztBQUFBLFVBQ0g7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUEsUUFDQSxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUVELFVBQUksQ0FBQyxjQUFjLFNBQVM7QUFDMUIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxvQkFBYyxTQUFTLGNBQWMsY0FBYyxRQUFRLFdBQVcsc0NBQXNDLFVBQVUsRUFBRTtBQUN4SCxZQUFNLEtBQUssdUJBQXVCLGVBQWUsWUFBWSxTQUFTLFFBQVE7QUFFOUUsVUFBSSxTQUFTLFdBQVc7QUFDdEIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxhQUFPLEtBQUssZUFBZSxPQUFPLFlBQVksU0FBUyxVQUFVLGFBQWE7QUFBQSxJQUNoRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsUUFBdUIsWUFBb0IsU0FBeUIsVUFBNkM7QUFDcEosVUFBTSxVQUFVLFNBQVMsMEJBQTBCLEtBQUs7QUFDeEQsUUFBSSxDQUFDLFNBQVM7QUFDWixhQUFPLFVBQVUsV0FBVyxPQUFPLFNBQVMsMkVBQTJFO0FBQ3ZIO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxNQUFNLFdBQVc7QUFBQSxNQUMvQixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsTUFDcEIsWUFBWTtBQUFBLE1BQ1osWUFBWTtBQUFBLE1BQ1osTUFBTSxDQUFDLE1BQU0sVUFBVTtBQUFBLE1BQ3ZCLGtCQUFrQixRQUFRO0FBQUEsTUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxNQUM3QyxRQUFRLFFBQVE7QUFBQSxJQUNsQixDQUFDO0FBRUQsUUFBSSxRQUFRLFNBQVM7QUFDbkIsYUFBTyxTQUFTLGNBQWMsT0FBTyxRQUFRLG1CQUFtQixRQUFRLE9BQU8sS0FBSyxLQUFLLHdCQUF3QjtBQUFBLElBQ25ILE9BQU87QUFDTCxhQUFPLFVBQVUsV0FBVyxPQUFPLFNBQVMsa0NBQWtDLFFBQVEsVUFBVSxRQUFRLFVBQVUsUUFBUSxRQUFRLFFBQVEsRUFBRSxFQUFFO0FBQUEsSUFDaEo7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQ1osT0FDQSxZQUNBLFNBQ0EsVUFDQSxlQUN3QjtBQUN4QixRQUFJLENBQUMsU0FBUyxxQkFBcUI7QUFDakMsYUFBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsU0FBUztBQUFBLFFBQ1QsVUFBVTtBQUFBLFFBQ1YsUUFBUSxXQUFXLGNBQWMsUUFBUSw4R0FBOEc7QUFBQSxNQUN6SjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsb0JBQW9CLE9BQU8saUJBQWlCLFVBQVU7QUFDdEUsUUFBSSxDQUFDLFNBQVM7QUFDWixhQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxTQUFTO0FBQUEsUUFDVCxVQUFVO0FBQUEsUUFDVixRQUFRLFdBQVcsY0FBYyxRQUFRLGdFQUFnRTtBQUFBLE1BQzNHO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxNQUFNLFdBQVc7QUFBQSxNQUM1QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsTUFDcEIsWUFBWTtBQUFBLE1BQ1osWUFBWSxTQUFTLHNCQUFzQixLQUFLLEtBQUs7QUFBQSxNQUNyRCxNQUFNLENBQUMsTUFBTSxRQUFRLFdBQVcsWUFBWSxPQUFPO0FBQUEsTUFDbkQsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLE1BQzdDLFFBQVEsUUFBUTtBQUFBLElBQ2xCLENBQUM7QUFFRCxTQUFLLFNBQVMsY0FBYyxjQUFjLFFBQVEsa0JBQWtCLEtBQUssT0FBTyxLQUFLLENBQUM7QUFDdEYsU0FBSyxTQUFTLGNBQWMsY0FBYyxRQUFRLGtCQUFrQixLQUFLLE9BQU8sS0FBSyxDQUFDO0FBQ3RGLFNBQUssVUFBVSxXQUFXLGNBQWMsU0FBUyw0Q0FBNEMsT0FBTyxHQUFHO0FBQ3ZHLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLFlBQVksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDN0gsVUFBTSxPQUFPLGlCQUFpQixLQUFLO0FBQ25DLFVBQU0sWUFBWSxrQkFBa0IsT0FBTyxzQkFBc0IsZUFBZSxFQUFFLFFBQVEsZ0JBQWdCO0FBQzFHLFVBQU0sT0FBTyxTQUFTLFVBQ2xCLENBQUMsTUFBTSxHQUFHLFdBQVcsUUFBUSxJQUM3QixDQUFDLEdBQUcsV0FBVyxRQUFRO0FBRTNCLFdBQU87QUFBQSxNQUFtQjtBQUFBLE1BQU8sTUFBTTtBQUFBLE1BQVMsT0FBTyxFQUFFLFNBQVMsTUFDaEUsV0FBVztBQUFBLFFBQ1QsVUFBVSxHQUFHLEtBQUssRUFBRSxhQUFhLElBQUk7QUFBQSxRQUNyQyxZQUFZLFNBQVMsVUFBVSxtQkFBbUI7QUFBQSxRQUNsRCxZQUFZLFNBQVMsbUJBQW1CLEtBQUs7QUFBQSxRQUM3QyxNQUFNLEtBQUssSUFBSSxDQUFDLFFBQVEsSUFBSSxXQUFXLFVBQVUsUUFBUSxDQUFDO0FBQUEsUUFDMUQsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxjQUFjLE9BQWlDO0FBQ3RELFFBQU0sUUFBUSxvQkFBb0IsT0FBTyxrQkFBa0IsV0FBVyxLQUFLO0FBQzNFLE1BQUksVUFBVSxhQUFhLFVBQVUsUUFBUTtBQUMzQyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sSUFBSSxNQUFNLDBCQUEwQixLQUFLLHdCQUF3QjtBQUN6RTtBQUVBLFNBQVMsaUJBQWlCLE9BQW9DO0FBQzVELFFBQU0sUUFBUSxvQkFBb0IsT0FBTyxzQkFBc0IsZUFBZSxLQUFLO0FBQ25GLE1BQUksVUFBVSxXQUFXLFVBQVUsT0FBTztBQUN4QyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sSUFBSSxNQUFNLDhCQUE4QixLQUFLLHFCQUFxQjtBQUMxRTtBQUVBLFNBQVMsb0JBQW9CLE9BQXNCLFNBQWlCLFVBQXNDO0FBQ3hHLFNBQU8sTUFBTSxXQUFXLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxXQUFXLFFBQVEsR0FBRyxLQUFLLEtBQUs7QUFDcEY7QUFFQSxTQUFTLGtCQUFrQixPQUFzQixTQUFpQixVQUE0QjtBQUM1RixTQUFPLFNBQVMsb0JBQW9CLE9BQU8sU0FBUyxRQUFRLEtBQUssRUFBRTtBQUNyRTtBQUVBLFNBQVMsU0FBUyxPQUF5QjtBQUN6QyxTQUFPLE1BQ0osTUFBTSxHQUFHLEVBQ1QsSUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDekIsT0FBTyxPQUFPO0FBQ25CO0FBRUEsU0FBUyxXQUFXLFVBQThCLE1BQXNCO0FBQ3RFLFNBQU8sQ0FBQyxVQUFVLElBQUksRUFBRSxPQUFPLENBQUMsU0FBUyxNQUFNLEtBQUssQ0FBQyxFQUFFLEtBQUssSUFBSTtBQUNsRTtBQUVBLFNBQVMsY0FBYyxVQUFrQixPQUFlLE1BQXNCO0FBQzVFLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFNBQVM7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sQ0FBQyxTQUFTLEtBQUssR0FBRyxHQUFHLEtBQUs7QUFBQSxFQUFNLE9BQU8sRUFBRSxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssTUFBTTtBQUMvRTs7O0FDN01PLElBQU0sYUFBTixNQUF1QztBQUFBLEVBQXZDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxTQUFTO0FBQUE7QUFBQSxFQUV0QixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLGFBQWEsUUFBUSxTQUFTLDBCQUEwQixLQUFLLENBQUM7QUFBQSxFQUMxRjtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFVBQU0sU0FBUyxNQUFNLG1CQUFtQjtBQUFBLE1BQ3RDLFVBQVUsS0FBSztBQUFBLE1BQ2YsWUFBWSxLQUFLO0FBQUEsTUFDakIsWUFBWSxTQUFTLDBCQUEwQixLQUFLO0FBQUEsTUFDcEQsTUFBTSxDQUFDLFFBQVE7QUFBQSxNQUNmLGVBQWU7QUFBQSxNQUNmLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLE1BQzdDLFFBQVEsUUFBUTtBQUFBLElBQ2xCLENBQUM7QUFFRCxRQUFJLENBQUMsT0FBTyxZQUFZLENBQUMsT0FBTyxhQUFhLE9BQU8sWUFBWSxRQUFRLENBQUMsT0FBTyxPQUFPLEtBQUssR0FBRztBQUM3RixVQUFJLE9BQU8sYUFBYSxHQUFHO0FBQ3pCLGVBQU8sVUFBVTtBQUNqQixlQUFPLFVBQVUsd0JBQXdCLE9BQU8sUUFBUTtBQUFBLE1BQzFEO0FBRUEsVUFBSSxDQUFDLE9BQU8sT0FBTyxLQUFLLEdBQUc7QUFDekIsZUFBTyxTQUFTLE9BQU8sYUFBYSxJQUNoQyxxQ0FDQSw2QkFBNkIsT0FBTyxRQUFRO0FBQUE7QUFBQSxNQUNsRDtBQUFBLElBQ0Y7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUNGOzs7QUN4Q0EsSUFBQUMsZUFBcUI7QUFJZCxJQUFNLHdCQUFOLE1BQWtEO0FBQUEsRUFBbEQ7QUFDTCxjQUFLO0FBQ0wsdUJBQWM7QUFDZCxxQkFBWSxDQUFDLFFBQVEsTUFBTTtBQUFBO0FBQUEsRUFFM0IsT0FBTyxPQUFzQixVQUF1QztBQUNsRSxRQUFJLE1BQU0sYUFBYSxRQUFRO0FBQzdCLGFBQU8sUUFBUSxTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQUEsSUFDL0M7QUFFQSxRQUFJLE1BQU0sYUFBYSxRQUFRO0FBQzdCLGFBQU8sUUFBUSxTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQUEsSUFDL0M7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxLQUFLLFFBQVEsT0FBTyxTQUFTLFFBQVE7QUFBQSxJQUM5QztBQUVBLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxLQUFLLFFBQVEsT0FBTyxTQUFTLFFBQVE7QUFBQSxJQUM5QztBQUVBLFVBQU0sSUFBSSxNQUFNLHlCQUF5QixNQUFNLFFBQVEsRUFBRTtBQUFBLEVBQzNEO0FBQUEsRUFFQSxNQUFjLFFBQVEsT0FBc0IsU0FBeUIsVUFBc0Q7QUFDekgsV0FBTyxtQkFBbUIsT0FBTyxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQy9FLFlBQU0saUJBQWEsbUJBQUssU0FBUyxhQUFhO0FBQzlDLFlBQU0sZ0JBQWdCLE1BQU0sV0FBVztBQUFBLFFBQ3JDLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWixZQUFZLFNBQVMsZUFBZSxLQUFLO0FBQUEsUUFDekMsTUFBTSxDQUFDLFVBQVUsTUFBTSxVQUFVO0FBQUEsUUFDakMsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFFRCxVQUFJLENBQUMsY0FBYyxTQUFTO0FBQzFCLGVBQU87QUFBQSxNQUNUO0FBRUEsYUFBTyxXQUFXO0FBQUEsUUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxRQUNaLE1BQU0sQ0FBQztBQUFBLFFBQ1Asa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLFFBQVEsT0FBc0IsU0FBeUIsVUFBc0Q7QUFDekgsV0FBTyx3QkFBd0IsYUFBYSxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQzFGLFVBQUksQ0FBQyxTQUFTLHVCQUF1QixLQUFLLEdBQUc7QUFDM0MsZUFBTyxXQUFXO0FBQUEsVUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFVBQ3BCLFlBQVk7QUFBQSxVQUNaLFlBQVksU0FBUyxlQUFlLEtBQUs7QUFBQSxVQUN6QyxNQUFNLENBQUMsUUFBUTtBQUFBLFVBQ2Ysa0JBQWtCLFFBQVE7QUFBQSxVQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFVBQzdDLFFBQVEsUUFBUTtBQUFBLFFBQ2xCLENBQUM7QUFBQSxNQUNIO0FBRUEsWUFBTSxnQkFBZ0IsTUFBTSxXQUFXO0FBQUEsUUFDckMsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVksU0FBUyx1QkFBdUIsS0FBSztBQUFBLFFBQ2pELE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixrQkFBa0I7QUFBQSxRQUNsQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFFRCxVQUFJLENBQUMsY0FBYyxTQUFTO0FBQzFCLGVBQU87QUFBQSxNQUNUO0FBRUEsYUFBTyxXQUFXO0FBQUEsUUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVksU0FBUyxlQUFlLEtBQUs7QUFBQSxRQUN6QyxNQUFNLENBQUMsT0FBTyxTQUFTLE1BQU07QUFBQSxRQUM3QixrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDckdBLElBQUFDLGVBQXFCO0FBSWQsSUFBTSx1QkFBTixNQUFpRDtBQUFBLEVBQWpEO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxLQUFLLEtBQUs7QUFBQTtBQUFBLEVBRXZCLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsS0FBSztBQUMxQixhQUFPLFFBQVEsU0FBUyxZQUFZLEtBQUssQ0FBQztBQUFBLElBQzVDO0FBRUEsUUFBSSxNQUFNLGFBQWEsT0FBTztBQUM1QixhQUFPLFFBQVEsU0FBUyxjQUFjLEtBQUssQ0FBQztBQUFBLElBQzlDO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUM3RyxVQUFNLGFBQWEsTUFBTSxhQUFhLE1BQU0sU0FBUyxZQUFZLEtBQUssSUFBSSxTQUFTLGNBQWMsS0FBSztBQUN0RyxVQUFNLGdCQUFnQixNQUFNLGFBQWEsTUFBTSxPQUFPO0FBQ3RELFVBQU0sYUFBYSxNQUFNLGFBQWEsTUFBTSxZQUFZO0FBRXhELFdBQU8sbUJBQW1CLGVBQWUsTUFBTSxTQUFTLE9BQU8sRUFBRSxTQUFTLFNBQVMsTUFBTTtBQUN2RixZQUFNLGlCQUFhLG1CQUFLLFNBQVMsYUFBYTtBQUM5QyxZQUFNLGdCQUFnQixNQUFNLFdBQVc7QUFBQSxRQUNyQyxVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRO0FBQUEsUUFDdEM7QUFBQSxRQUNBO0FBQUEsUUFDQSxNQUFNLENBQUMsVUFBVSxNQUFNLFVBQVU7QUFBQSxRQUNqQyxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUVELFVBQUksQ0FBQyxjQUFjLFNBQVM7QUFDMUIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxhQUFPLFdBQVc7QUFBQSxRQUNoQixVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRO0FBQUEsUUFDdEM7QUFBQSxRQUNBLFlBQVk7QUFBQSxRQUNaLE1BQU0sQ0FBQztBQUFBLFFBQ1Asa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQ3JEQSxJQUFBQyxlQUFxQjtBQUlkLElBQU0sY0FBTixNQUF3QztBQUFBLEVBQXhDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxPQUFPO0FBQUE7QUFBQSxFQUVwQixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLFdBQVcsUUFBUSxTQUFTLGdCQUFnQixLQUFLLENBQUM7QUFBQSxFQUM5RTtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFVBQU0sT0FBTyxTQUFTO0FBQ3RCLFVBQU0sYUFBYSxTQUFTLGdCQUFnQixLQUFLO0FBRWpELFFBQUksU0FBUyxTQUFTO0FBQ3BCLGFBQU8sbUJBQW1CO0FBQUEsUUFDeEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaO0FBQUEsUUFDQSxNQUFNLENBQUMsUUFBUTtBQUFBLFFBQ2YsZUFBZTtBQUFBLFFBQ2YsUUFBUSxNQUFNO0FBQUEsUUFDZCxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsUUFBUTtBQUFBLFFBQ25CLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBRUEsUUFBSSxTQUFTLFFBQVE7QUFDbkIsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1o7QUFBQSxRQUNBLE1BQU0sQ0FBQyxRQUFRLE1BQU0sU0FBUyxRQUFRO0FBQUEsUUFDdEMsZUFBZTtBQUFBLFFBQ2YsUUFBUSxNQUFNO0FBQUEsUUFDZCxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsUUFBUTtBQUFBLFFBQ25CLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTyxtQkFBbUIsT0FBTyxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQy9FLFlBQU0saUJBQWEsbUJBQUssU0FBUyxhQUFhO0FBQzlDLFlBQU0sZ0JBQWdCLE1BQU0sV0FBVztBQUFBLFFBQ3JDLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWjtBQUFBLFFBQ0EsTUFBTSxDQUFDLE1BQU0sWUFBWSxRQUFRO0FBQUEsUUFDakMsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLFFBQVE7QUFBQSxRQUNuQixRQUFRLFFBQVE7QUFBQSxNQUNsQixDQUFDO0FBRUQsVUFBSSxDQUFDLGNBQWMsU0FBUztBQUMxQixlQUFPO0FBQUEsTUFDVDtBQUVBLGFBQU8sV0FBVztBQUFBLFFBQ2hCLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWixZQUFZO0FBQUEsUUFDWixNQUFNLENBQUM7QUFBQSxRQUNQLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxRQUFRO0FBQUEsUUFDbkIsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDckVPLElBQU0sZUFBTixNQUF5QztBQUFBLEVBQXpDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxRQUFRO0FBQUE7QUFBQSxFQUVyQixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLFlBQVksUUFBUSxTQUFTLGlCQUFpQixLQUFLLENBQUM7QUFBQSxFQUNoRjtBQUFBLEVBRUEsSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUN2RyxXQUFPLG1CQUFtQjtBQUFBLE1BQ3hCLFVBQVUsS0FBSztBQUFBLE1BQ2YsWUFBWSxLQUFLO0FBQUEsTUFDakIsWUFBWSxTQUFTLGlCQUFpQixLQUFLO0FBQUEsTUFDM0MsTUFBTSxDQUFDLFFBQVE7QUFBQSxNQUNmLGVBQWU7QUFBQSxNQUNmLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLFFBQVE7QUFBQSxNQUNuQixRQUFRLFFBQVE7QUFBQSxJQUNsQixDQUFDO0FBQUEsRUFDSDtBQUNGOzs7QUN6QkEsSUFBQUMsYUFBMkI7QUFDM0IsSUFBQUMsZUFBcUI7QUFJZCxJQUFNLGNBQU4sTUFBd0M7QUFBQSxFQUF4QztBQUNMLGNBQUs7QUFDTCx1QkFBYztBQUNkLHFCQUFZLENBQUMsUUFBUSxPQUFPLFFBQVE7QUFBQTtBQUFBLEVBRXBDLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsUUFBUTtBQUM3QixhQUFPLFFBQVEsU0FBUyxlQUFlLEtBQUssQ0FBQztBQUFBLElBQy9DO0FBRUEsUUFBSSxNQUFNLGFBQWEsT0FBTztBQUM1QixhQUFPLFFBQVEscUJBQXFCLFFBQVEsRUFBRSxLQUFLLENBQUM7QUFBQSxJQUN0RDtBQUVBLFFBQUksTUFBTSxhQUFhLFVBQVU7QUFDL0IsYUFBTyxRQUFRLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFBQSxJQUM5QztBQUVBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQ3ZHLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLGVBQWUsS0FBSztBQUFBLFFBQ3pDLE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxNQUNsQixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUksTUFBTSxhQUFhLE9BQU87QUFDNUIsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxxQkFBcUIsUUFBUTtBQUFBLFFBQ3pDLE1BQU0sQ0FBQyxNQUFNLFFBQVE7QUFBQSxRQUNyQixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxNQUNsQixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUksTUFBTSxhQUFhLFVBQVU7QUFDL0IsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLGNBQWMsS0FBSztBQUFBLFFBQ3hDLE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxNQUNsQixDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sSUFBSSxNQUFNLCtCQUErQixNQUFNLFFBQVEsRUFBRTtBQUFBLEVBQ2pFO0FBQ0Y7QUFFQSxTQUFTLHFCQUFxQixVQUFzQztBQUNsRSxRQUFNLGFBQWEsU0FBUyxjQUFjLEtBQUs7QUFDL0MsTUFBSSxjQUFjLGVBQWUsUUFBUTtBQUN2QyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sZUFBVyxtQkFBSyxRQUFRLElBQUksUUFBUSxJQUFJLFNBQVMsV0FBVyxPQUFPLE1BQU07QUFDL0UsYUFBTyx1QkFBVyxRQUFRLElBQUksV0FBVyxjQUFjO0FBQ3pEOzs7QUM5RU8sSUFBTSxxQkFBTixNQUF5QjtBQUFBLEVBQzlCLFlBQTZCLFNBQXVCO0FBQXZCO0FBQUEsRUFBd0I7QUFBQSxFQUVyRCxrQkFBa0IsT0FBc0IsVUFBaUQ7QUFDdkYsUUFBSSxDQUFDLEtBQUssdUJBQXVCLE9BQU8sUUFBUSxHQUFHO0FBQ2pELGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTyxLQUFLLFFBQVEsS0FBSyxDQUFDLFlBQVksQ0FBQyxPQUFPLFVBQVUsVUFBVSxPQUFPLFVBQVUsU0FBUyxNQUFNLFFBQVEsTUFBTSxPQUFPLE9BQU8sT0FBTyxRQUFRLENBQUMsS0FBSztBQUFBLEVBQ3JKO0FBQUEsRUFFQSx3QkFBa0M7QUFDaEMsV0FBTyxDQUFDLEdBQUcsSUFBSSxJQUFJLEtBQUssUUFBUSxRQUFRLENBQUMsV0FBVyxPQUFPLFNBQVMsQ0FBQyxDQUFDO0FBQUEsRUFDeEU7QUFBQSxFQUVRLHVCQUF1QixPQUFzQixVQUF1QztBQUMxRixRQUFJLGtCQUFrQixNQUFNLFVBQVUsUUFBUSxHQUFHO0FBQy9DLGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTywwQkFBMEIsUUFBUSxLQUFLLFNBQVMsZ0JBQWdCLEtBQUssQ0FBQyxhQUFhO0FBQ3hGLFlBQU0sT0FBTyxTQUFTLEtBQUssS0FBSyxFQUFFLFlBQVk7QUFDOUMsWUFBTSxVQUFVLFNBQVMsUUFDdEIsTUFBTSxHQUFHLEVBQ1QsSUFBSSxDQUFDLFVBQVUsTUFBTSxLQUFLLEVBQUUsWUFBWSxDQUFDLEVBQ3pDLE9BQU8sT0FBTztBQUNqQixhQUFPLFNBQVMsTUFBTSxTQUFTLEtBQUssRUFBRSxZQUFZLEtBQUssUUFBUSxTQUFTLE1BQU0sY0FBYyxLQUFLLEVBQUUsWUFBWSxDQUFDO0FBQUEsSUFDbEgsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDM0JPLElBQU0sbUJBQXVDO0FBQUEsRUFDbEQsc0JBQXNCO0FBQUEsRUFDdEIsOEJBQThCO0FBQUEsRUFDOUIsb0JBQW9CO0FBQUEsRUFDcEIsa0JBQWtCO0FBQUEsRUFDbEIsa0JBQWtCO0FBQUEsRUFDbEIsa0JBQWtCO0FBQUEsRUFDbEIsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsZ0NBQWdDO0FBQUEsRUFDaEMsV0FBVztBQUFBLEVBQ1gsaUJBQWlCO0FBQUEsRUFDakIsYUFBYTtBQUFBLEVBQ2IsZUFBZTtBQUFBLEVBQ2YsaUJBQWlCO0FBQUEsRUFDakIsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsY0FBYztBQUFBLEVBQ2QsZ0JBQWdCO0FBQUEsRUFDaEIsbUJBQW1CO0FBQUEsRUFDbkIsd0JBQXdCO0FBQUEsRUFDeEIsZ0JBQWdCO0FBQUEsRUFDaEIsMkJBQTJCO0FBQUEsRUFDM0IscUJBQXFCO0FBQUEsRUFDckIsdUJBQXVCO0FBQUEsRUFDdkIsMkJBQTJCO0FBQUEsRUFDM0Isa0JBQWtCO0FBQUEsRUFDbEIscUJBQXFCO0FBQUEsRUFDckIsb0JBQW9CO0FBQUEsRUFDcEIsZ0JBQWdCO0FBQUEsRUFDaEIsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsbUJBQW1CO0FBQUEsRUFDbkIsbUJBQW1CO0FBQUEsRUFDbkIsNEJBQTRCO0FBQUEsRUFDNUIsZ0NBQWdDO0FBQUEsRUFDaEMsOEJBQThCO0FBQUEsRUFDOUIsc0JBQXNCLDBCQUEwQjtBQUFBLEVBQ2hELGtCQUFrQixzQkFBc0I7QUFBQSxFQUN4QyxpQkFBaUIsQ0FBQztBQUFBLEVBQ2xCLGVBQWU7QUFBQSxFQUNmLHVCQUF1QjtBQUN6Qjs7O0FDL0NBLElBQUFDLG1CQUE2RTtBQU90RSxJQUFNLGlCQUFOLGNBQTZCLGtDQUFpQjtBQUFBLEVBQ25ELFlBQTZCQyxhQUF3QjtBQUNuRCxVQUFNQSxZQUFXLEtBQUtBLFdBQVU7QUFETCxzQkFBQUE7QUFBQSxFQUU3QjtBQUFBLEVBRUEsVUFBZ0I7QUFDZCxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLGdCQUFZLE1BQU07QUFDbEIsZ0JBQVksU0FBUyxNQUFNLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFDM0MsZ0JBQVksU0FBUyxLQUFLLEVBQUUsTUFBTSw2RkFBNkYsQ0FBQztBQUVoSSxTQUFLLHNCQUFzQixLQUFLLGNBQWMsYUFBYSxvQkFBb0IsSUFBSSxDQUFDO0FBQ3BGLFNBQUssdUJBQXVCLEtBQUssY0FBYyxhQUFhLG1CQUFtQixDQUFDO0FBQ2hGLFNBQUssc0JBQXNCLEtBQUssY0FBYyxhQUFhLG1CQUFtQixDQUFDO0FBQy9FLFNBQUssc0JBQXNCLEtBQUssY0FBYyxhQUFhLGtCQUFrQixDQUFDO0FBQzlFLFNBQUssS0FBSyxzQkFBc0IsS0FBSyxjQUFjLGFBQWEseUJBQXlCLENBQUM7QUFBQSxFQUM1RjtBQUFBLEVBRVEsY0FBYyxhQUEwQixPQUFlLE9BQU8sT0FBb0I7QUFDeEYsVUFBTSxVQUFVLFlBQVksU0FBUyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsQ0FBQztBQUNoRixZQUFRLE9BQU87QUFDZixZQUFRLFNBQVMsV0FBVyxFQUFFLE1BQU0sT0FBTyxLQUFLLHdCQUF3QixDQUFDO0FBQ3pFLFdBQU8sUUFBUSxVQUFVLEVBQUUsS0FBSyw2QkFBNkIsQ0FBQztBQUFBLEVBQ2hFO0FBQUEsRUFFUSxzQkFBc0IsYUFBZ0M7QUFDNUQsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsd0JBQXdCLEVBQ2hDLFFBQVEsNEZBQTRGLEVBQ3BHO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLG9CQUFvQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3ZGLGFBQUssV0FBVyxTQUFTLHVCQUF1QjtBQUNoRCxZQUFJLE9BQU87QUFDVCxlQUFLLFdBQVcsU0FBUywrQkFBK0I7QUFBQSxRQUMxRDtBQUNBLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGdDQUFnQyxFQUN4QyxRQUFRLG9HQUFvRyxFQUM1RztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxrQkFBa0IsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNyRixhQUFLLFdBQVcsU0FBUyxxQkFBcUI7QUFDOUMsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxZQUFJLE9BQU87QUFDVCxlQUFLLEtBQUssV0FBVywrQkFBK0I7QUFBQSxRQUN0RCxPQUFPO0FBQ0wsZUFBSyxLQUFLLFdBQVcsK0JBQStCO0FBQUEsUUFDdEQ7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsaUJBQWlCLEVBQ3pCLFFBQVEsNEVBQTRFLEVBQ3BGO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxlQUFlLE1BQU0sRUFBRSxTQUFTLE9BQU8sS0FBSyxXQUFXLFNBQVMsZ0JBQWdCLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNoSCxjQUFNLFNBQVMsT0FBTyxTQUFTLE9BQU8sRUFBRTtBQUN4QyxZQUFJLENBQUMsT0FBTyxNQUFNLE1BQU0sS0FBSyxTQUFTLEdBQUc7QUFDdkMsZUFBSyxXQUFXLFNBQVMsbUJBQW1CO0FBQzVDLGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsbUJBQW1CLEVBQzNCLFFBQVEsdUZBQXVGLEVBQy9GO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxlQUFlLFlBQVksRUFBRSxTQUFTLEtBQUssV0FBVyxTQUFTLGdCQUFnQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQzlHLGFBQUssV0FBVyxTQUFTLG1CQUFtQixNQUFNLEtBQUssUUFBSSxnQ0FBYyxNQUFNLEtBQUssQ0FBQyxJQUFJO0FBQ3pGLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLDJCQUEyQixFQUNuQyxRQUFRLHNHQUFzRyxFQUM5RztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxpQkFBaUIsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNwRixhQUFLLFdBQVcsU0FBUyxvQkFBb0I7QUFDN0MsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLE1BQ3JDLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsdUJBQXVCLEVBQy9CLFFBQVEsaUZBQWlGLEVBQ3pGO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLGlCQUFpQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3BGLGFBQUssV0FBVyxTQUFTLG9CQUFvQjtBQUM3QyxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsTUFDckMsQ0FBQztBQUFBLElBQ0g7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSwwQkFBMEIsRUFDbEMsUUFBUSw4RUFBOEUsRUFDdEY7QUFBQSxNQUFZLENBQUMsYUFDWixTQUNHLFVBQVUsYUFBYSxXQUFXLEVBQ2xDLFVBQVUsWUFBWSxVQUFVLEVBQ2hDLFVBQVUsVUFBVSxRQUFRLEVBQzVCLFNBQVMsS0FBSyxXQUFXLFNBQVMsOEJBQThCLFdBQVcsRUFDM0UsU0FBUyxPQUFPLFVBQVU7QUFDekIsYUFBSyxXQUFXLFNBQVMsNkJBQTZCO0FBQ3RELGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDTDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLDBCQUEwQixFQUNsQyxRQUFRLCtGQUErRixFQUN2RztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxrQ0FBa0MsSUFBSSxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3pHLGFBQUssV0FBVyxTQUFTLGlDQUFpQztBQUMxRCxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsTUFDckMsQ0FBQztBQUFBLElBQ0g7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxpQkFBaUIsRUFDekIsUUFBUSxpRkFBaUYsRUFDekY7QUFBQSxNQUFZLENBQUMsYUFDWixTQUNHLFVBQVUsUUFBUSxzQkFBc0IsRUFDeEMsVUFBVSxRQUFRLGlCQUFpQixFQUNuQyxVQUFVLFVBQVUsYUFBYSxFQUNqQyxTQUFTLEtBQUssV0FBVyxTQUFTLGlCQUFpQixNQUFNLEVBQ3pELFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGFBQUssV0FBVyxTQUFTLGdCQUFnQjtBQUN6QyxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsTUFDckMsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKO0FBQUEsRUFFUSxzQkFBc0IsYUFBZ0M7QUFDNUQsUUFBSSxLQUFLLHlCQUF5QixRQUFRLEdBQUc7QUFDM0MsV0FBSyxlQUFlLGFBQWEscUJBQXFCLG9DQUFvQyxrQkFBa0I7QUFBQSxJQUM5RztBQUNBLFFBQUksS0FBSyx5QkFBeUIsWUFBWSxHQUFHO0FBQy9DLFdBQUssZUFBZSxhQUFhLG1CQUFtQixrREFBa0QsZ0JBQWdCO0FBQUEsSUFDeEg7QUFFQSxRQUFJLEtBQUsseUJBQXlCLFlBQVksR0FBRztBQUMvQyxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSx3QkFBd0IsRUFDaEMsUUFBUSwyQ0FBMkMsRUFDbkQ7QUFBQSxRQUFZLENBQUMsYUFDWixTQUNHLFVBQVUsV0FBVyxTQUFTLEVBQzlCLFVBQVUsT0FBTyxLQUFLLEVBQ3RCLFNBQVMsS0FBSyxXQUFXLFNBQVMsY0FBYyxFQUNoRCxTQUFTLE9BQU8sVUFBVTtBQUN6QixlQUFLLFdBQVcsU0FBUyxpQkFBaUI7QUFDMUMsZ0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxRQUNyQyxDQUFDO0FBQUEsTUFDTDtBQUVGLFdBQUssZUFBZSxhQUFhLG9DQUFvQyx1Q0FBdUMsZ0NBQWdDO0FBQUEsSUFDOUk7QUFFQSxRQUFJLEtBQUsseUJBQXlCLE9BQU8sR0FBRztBQUMxQyxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxZQUFZLEVBQ3BCLFFBQVEsc0VBQXNFLEVBQzlFO0FBQUEsUUFBWSxDQUFDLGFBQ1osU0FDRyxVQUFVLFNBQVMsT0FBTyxFQUMxQixVQUFVLFVBQVUsUUFBUSxFQUM1QixVQUFVLFFBQVEsTUFBTSxFQUN4QixTQUFTLEtBQUssV0FBVyxTQUFTLFNBQVMsRUFDM0MsU0FBUyxPQUFPLFVBQVU7QUFDekIsZUFBSyxXQUFXLFNBQVMsWUFBWTtBQUNyQyxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLFFBQ3JDLENBQUM7QUFBQSxNQUNMO0FBRUYsV0FBSyxlQUFlLGFBQWEsb0JBQW9CLDhFQUE4RSxpQkFBaUI7QUFBQSxJQUN0SjtBQUVBLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxHQUFHLEdBQUcsY0FBYywyQ0FBMkMsYUFBYTtBQUNySCxTQUFLLHNCQUFzQixhQUFhLENBQUMsS0FBSyxHQUFHLGdCQUFnQiw2Q0FBNkMsZUFBZTtBQUM3SCxTQUFLLHNCQUFzQixhQUFhLENBQUMsT0FBTyxHQUFHLG9CQUFvQixtREFBbUQsaUJBQWlCO0FBQzNJLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxNQUFNLEdBQUcsbUJBQW1CLG9DQUFvQyxnQkFBZ0I7QUFDekgsU0FBSyxzQkFBc0IsYUFBYSxDQUFDLE1BQU0sR0FBRyxtQkFBbUIsb0NBQW9DLGdCQUFnQjtBQUN6SCxTQUFLLHNCQUFzQixhQUFhLENBQUMsS0FBSyxHQUFHLGtCQUFrQixtQ0FBbUMsZUFBZTtBQUNySCxTQUFLLHNCQUFzQixhQUFhLENBQUMsS0FBSyxHQUFHLGtCQUFrQixtQ0FBbUMsZUFBZTtBQUNySCxTQUFLLHNCQUFzQixhQUFhLENBQUMsSUFBSSxHQUFHLGlCQUFpQixrQ0FBa0MsY0FBYztBQUNqSCxTQUFLLHNCQUFzQixhQUFhLENBQUMsTUFBTSxHQUFHLGlCQUFpQiw4Q0FBOEMsZ0JBQWdCO0FBQ2pJLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxTQUFTLEdBQUcsc0JBQXNCLDJEQUEyRCxtQkFBbUI7QUFDekosUUFBSSxLQUFLLHlCQUF5QixNQUFNLEdBQUc7QUFDekMsV0FBSyxlQUFlLGFBQWEsaUJBQWlCLGlGQUFpRix3QkFBd0I7QUFDM0osV0FBSyxlQUFlLGFBQWEsbUJBQW1CLHFEQUFxRCxnQkFBZ0I7QUFBQSxJQUMzSDtBQUNBLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxTQUFTLEdBQUcsdUJBQXVCLHdEQUF3RCwyQkFBMkI7QUFDL0osUUFBSSxLQUFLLHlCQUF5QixRQUFRLEdBQUc7QUFDM0MsV0FBSyxlQUFlLGFBQWEseUJBQXlCLHNEQUFzRCxxQkFBcUI7QUFDckksV0FBSyxlQUFlLGFBQWEsMkJBQTJCLDZEQUE2RCx1QkFBdUI7QUFDaEosV0FBSyxlQUFlLGFBQWEseUJBQXlCLG9GQUFvRiwyQkFBMkI7QUFDekssV0FBSyxlQUFlLGFBQWEsc0JBQXNCLGdFQUFnRSxrQkFBa0I7QUFDekksVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsd0JBQXdCLEVBQ2hDLFFBQVEsd0dBQXdHLEVBQ2hIO0FBQUEsUUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLG1CQUFtQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3RGLGVBQUssV0FBVyxTQUFTLHNCQUFzQjtBQUMvQyxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLFFBQ3JDLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDSjtBQUNBLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxVQUFVLEdBQUcsdUJBQXVCLHlDQUF5QyxvQkFBb0I7QUFDMUksU0FBSyxzQkFBc0IsYUFBYSxDQUFDLE1BQU0sR0FBRyxtQkFBbUIsNkNBQTZDLGdCQUFnQjtBQUNsSSxTQUFLLHNCQUFzQixhQUFhLENBQUMsS0FBSyxHQUFHLGtCQUFrQixzREFBc0QsZUFBZTtBQUN4SSxTQUFLLHNCQUFzQixhQUFhLENBQUMsUUFBUSxHQUFHLGNBQWMsdURBQXVELGVBQWU7QUFBQSxFQUMxSTtBQUFBLEVBRVEsc0JBQTBELGFBQTBCLGFBQXVCLE1BQWMsYUFBcUIsS0FBYztBQUNsSyxRQUFJLFlBQVksS0FBSyxDQUFDLGVBQWUsS0FBSyx5QkFBeUIsVUFBVSxDQUFDLEdBQUc7QUFDL0UsV0FBSyxlQUFlLGFBQWEsTUFBTSxhQUFhLEdBQUc7QUFBQSxJQUN6RDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLHlCQUF5QixZQUE2QjtBQUM1RCxXQUFPLGtCQUFrQixZQUFZLEtBQUssV0FBVyxRQUFRO0FBQUEsRUFDL0Q7QUFBQSxFQUVRLHVCQUF1QixhQUFnQztBQUM3RCxtQ0FBK0IsS0FBSyxXQUFXLFFBQVE7QUFFdkQsZUFBVyxRQUFRLDRCQUE0QjtBQUM3QyxZQUFNLFNBQVMsWUFBWSxTQUFTLFdBQVcsRUFBRSxLQUFLLHdCQUF3QixDQUFDO0FBQy9FLGFBQU8sT0FBTyxLQUFLLFdBQVcsU0FBUyxxQkFBcUIsU0FBUyxLQUFLLEVBQUU7QUFDNUUsYUFBTyxTQUFTLFdBQVcsRUFBRSxNQUFNLEtBQUssWUFBWSxDQUFDO0FBQ3JELGFBQU8sU0FBUyxLQUFLLEVBQUUsTUFBTSxLQUFLLGFBQWEsS0FBSywyQkFBMkIsQ0FBQztBQUVoRixVQUFJLHlCQUFRLE1BQU0sRUFDZixRQUFRLGdCQUFnQixFQUN4QixRQUFRLHVHQUF1RyxFQUMvRztBQUFBLFFBQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxxQkFBcUIsU0FBUyxLQUFLLEVBQUUsQ0FBQyxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3pHLGVBQUssZ0JBQWdCLEtBQUssV0FBVyxTQUFTLHNCQUFzQixLQUFLLElBQUksS0FBSztBQUNsRixxQkFBVyxZQUFZLEtBQUssV0FBVztBQUNyQyxpQkFBSyxnQkFBZ0IsS0FBSyxXQUFXLFNBQVMsa0JBQWtCLFNBQVMsSUFBSSxLQUFLO0FBQUEsVUFDcEY7QUFDQSxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxlQUFLLFFBQVE7QUFBQSxRQUNmLENBQUM7QUFBQSxNQUNIO0FBRUYsWUFBTSxpQkFBaUIsS0FBSyxXQUFXLFNBQVMscUJBQXFCLFNBQVMsS0FBSyxFQUFFO0FBQ3JGLGlCQUFXLFlBQVksS0FBSyxXQUFXO0FBQ3JDLFlBQUkseUJBQVEsTUFBTSxFQUNmLFFBQVEsU0FBUyxXQUFXLEVBQzVCLFFBQVEsWUFBWSxTQUFTLFFBQVEsS0FBSyxJQUFJLENBQUMsRUFBRSxFQUNqRDtBQUFBLFVBQVUsQ0FBQyxXQUNWLE9BQ0csWUFBWSxDQUFDLGNBQWMsRUFDM0IsU0FBUyxrQkFBa0IsS0FBSyxXQUFXLFNBQVMsaUJBQWlCLFNBQVMsU0FBUyxFQUFFLENBQUMsRUFDMUYsU0FBUyxPQUFPLFVBQVU7QUFDekIsaUJBQUssZ0JBQWdCLEtBQUssV0FBVyxTQUFTLGtCQUFrQixTQUFTLElBQUksS0FBSztBQUNsRixrQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLFVBQ3JDLENBQUM7QUFBQSxRQUNMO0FBQUEsTUFDSjtBQUFBLElBQ0Y7QUFFQSxRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxrQkFBa0IsRUFDMUIsUUFBUSxrRUFBa0UsRUFDMUU7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxXQUFXLFNBQVMscUJBQXFCLFNBQVMsMEJBQTBCLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUM1SCxhQUFLLGdCQUFnQixLQUFLLFdBQVcsU0FBUyxzQkFBc0IsNEJBQTRCLEtBQUs7QUFDckcsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxhQUFLLFFBQVE7QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEseUJBQXlCLEVBQ2pDLFFBQVEsK0RBQStELEVBQ3ZFO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxjQUFjLE9BQU8sRUFBRSxRQUFRLFlBQVk7QUFDaEQsYUFBSyxXQUFXLFNBQVMsdUJBQXVCLDBCQUEwQjtBQUMxRSxhQUFLLFdBQVcsU0FBUyxtQkFBbUIsc0JBQXNCO0FBQ2xFLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFDbkMsYUFBSyxRQUFRO0FBQUEsTUFDZixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0o7QUFBQSxFQUVRLGdCQUFnQixRQUFrQixJQUFZLFNBQXdCO0FBQzVFLFVBQU0sUUFBUSxPQUFPLFFBQVEsRUFBRTtBQUMvQixRQUFJLFdBQVcsUUFBUSxHQUFHO0FBQ3hCLGFBQU8sS0FBSyxFQUFFO0FBQUEsSUFDaEIsV0FBVyxDQUFDLFdBQVcsU0FBUyxHQUFHO0FBQ2pDLGFBQU8sT0FBTyxPQUFPLENBQUM7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLHNCQUFzQixhQUFnQztBQUM1RCxVQUFNLFNBQVMsWUFBWSxVQUFVLEVBQUUsS0FBSyw0QkFBNEIsQ0FBQztBQUN6RSxTQUFLLHlCQUF5QixNQUFNO0FBRXBDLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHFCQUFxQixFQUM3QixRQUFRLDZDQUE2QyxFQUNyRDtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxHQUFHLEVBQUUsUUFBUSxZQUFZO0FBQzVDLGFBQUssV0FBVyxTQUFTLGdCQUFnQixLQUFLO0FBQUEsVUFDNUMsTUFBTTtBQUFBLFVBQ04sU0FBUztBQUFBLFVBQ1QsWUFBWTtBQUFBLFVBQ1osTUFBTTtBQUFBLFVBQ04sV0FBVztBQUFBLFVBQ1gsZUFBZTtBQUFBLFVBQ2YscUJBQXFCO0FBQUEsVUFDckIsZUFBZTtBQUFBLFVBQ2YscUJBQXFCO0FBQUEsVUFDckIsZUFBZTtBQUFBLFFBQ2pCLENBQUM7QUFDRCxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQ25DLGFBQUssUUFBUTtBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQUEsRUFFUSx5QkFBeUIsYUFBZ0M7QUFDL0QsZ0JBQVksTUFBTTtBQUVsQixRQUFJLENBQUMsS0FBSyxXQUFXLFNBQVMsZ0JBQWdCLFFBQVE7QUFDcEQsa0JBQVksU0FBUyxLQUFLO0FBQUEsUUFDeEIsTUFBTTtBQUFBLFFBQ04sS0FBSztBQUFBLE1BQ1AsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUVBLFNBQUssV0FBVyxTQUFTLGdCQUFnQixRQUFRLENBQUMsVUFBVSxVQUFVO0FBQ3BFLFlBQU0sVUFBVSxZQUFZLFNBQVMsV0FBVyxFQUFFLEtBQUssdUJBQXVCLENBQUM7QUFDL0UsY0FBUSxPQUFPO0FBQ2YsY0FBUSxTQUFTLFdBQVcsRUFBRSxNQUFNLFNBQVMsUUFBUSxtQkFBbUIsUUFBUSxDQUFDLEdBQUcsQ0FBQztBQUNyRixZQUFNLE9BQU8sUUFBUSxVQUFVLEVBQUUsS0FBSyw0QkFBNEIsQ0FBQztBQUVuRSxXQUFLLDZCQUE2QixNQUFNLFVBQVUsUUFBUSx3Q0FBd0MsTUFBTTtBQUN4RyxXQUFLLDZCQUE2QixNQUFNLFVBQVUsV0FBVyxrQ0FBa0MsU0FBUztBQUN4RyxXQUFLLDZCQUE2QixNQUFNLFVBQVUsY0FBYyw4Q0FBOEMsWUFBWTtBQUMxSCxXQUFLLDZCQUE2QixNQUFNLFVBQVUsYUFBYSxtRUFBbUUsTUFBTTtBQUN4SSxXQUFLLDZCQUE2QixNQUFNLFVBQVUsYUFBYSxnREFBZ0QsV0FBVztBQUUxSCxVQUFJLHlCQUFRLElBQUksRUFDYixRQUFRLDZCQUE2QixFQUNyQyxRQUFRLG1FQUFtRSxFQUMzRTtBQUFBLFFBQVksQ0FBQyxhQUNaLFNBQ0csVUFBVSxXQUFXLG1CQUFtQixFQUN4QyxVQUFVLGVBQWUsZ0JBQWdCLEVBQ3pDLFNBQVMsU0FBUyxpQkFBaUIsU0FBUyxFQUM1QyxTQUFTLE9BQU8sVUFBVTtBQUN6QixtQkFBUyxnQkFBZ0I7QUFDekIsZ0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxRQUNyQyxDQUFDO0FBQUEsTUFDTDtBQUVGLFdBQUssNkJBQTZCLE1BQU0sVUFBVSx3QkFBd0IsMEdBQTBHLHFCQUFxQjtBQUN6TSxXQUFLLDZCQUE2QixNQUFNLFVBQVUsdUJBQXVCLDhIQUE4SCxlQUFlO0FBQ3ROLFdBQUssNkJBQTZCLE1BQU0sVUFBVSw2QkFBNkIscUVBQXFFLHFCQUFxQjtBQUN6SyxXQUFLLDZCQUE2QixNQUFNLFVBQVUsNEJBQTRCLG1GQUFtRixlQUFlO0FBRWhMLFVBQUkseUJBQVEsSUFBSSxFQUNiLFFBQVEsaUJBQWlCLEVBQ3pCLFFBQVEsOEJBQThCLEVBQ3RDO0FBQUEsUUFBVSxDQUFDLFdBQ1YsT0FBTyxjQUFjLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUSxZQUFZO0FBQzlELGVBQUssV0FBVyxTQUFTLGdCQUFnQixPQUFPLE9BQU8sQ0FBQztBQUN4RCxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxlQUFLLFFBQVE7QUFBQSxRQUNmLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDSixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyxzQkFBc0IsYUFBeUM7QUFDM0UsUUFBSTtBQUNGLFlBQU0sU0FBUyxNQUFNLEtBQUssV0FBVywyQkFBMkI7QUFFaEUsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsZ0NBQWdDLEVBQ3hDLFFBQVEsd0ZBQXdGLEVBQ2hHLFlBQVksQ0FBQyxhQUFhO0FBQ3pCLGlCQUFTLFVBQVUsSUFBSSxNQUFNO0FBQzdCLG1CQUFXLFNBQVMsUUFBUTtBQUMxQixtQkFBUyxVQUFVLE1BQU0sTUFBTSxNQUFNLElBQUk7QUFBQSxRQUMzQztBQUNBLGlCQUFTLFNBQVMsS0FBSyxXQUFXLFNBQVMseUJBQXlCLEVBQUU7QUFDdEUsaUJBQVMsU0FBUyxPQUFPLFVBQVU7QUFDakMsZUFBSyxXQUFXLFNBQVMsd0JBQXdCO0FBQ2pELGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckMsQ0FBQztBQUFBLE1BQ0gsQ0FBQztBQUVILFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGdDQUFnQyxFQUN4QyxRQUFRLDJEQUEyRCxFQUNuRTtBQUFBLFFBQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxHQUFHLEVBQUUsUUFBUSxNQUFNO0FBQ3RDLGNBQUksd0JBQXdCLEtBQUssS0FBSyxPQUFPLGNBQWM7QUFDekQsa0JBQU0sWUFBWSxVQUFVLEtBQUssRUFBRSxZQUFZLEVBQUUsUUFBUSxnQkFBZ0IsR0FBRztBQUM1RSxnQkFBSSxDQUFDLFdBQVc7QUFDZCxrQkFBSSx3QkFBTyxxQkFBcUI7QUFDaEM7QUFBQSxZQUNGO0FBRUEsa0JBQU0sWUFBWSxLQUFLLFdBQVcsU0FBUyxPQUFPO0FBQ2xELGtCQUFNLG9CQUFvQixHQUFHLFNBQVMsZUFBZSxTQUFTO0FBQzlELGtCQUFNLGFBQWEsR0FBRyxpQkFBaUI7QUFFdkMsa0JBQU0sVUFBVSxLQUFLLElBQUksTUFBTTtBQUMvQixnQkFBSSxNQUFNLFFBQVEsT0FBTyxpQkFBaUIsR0FBRztBQUMzQyxrQkFBSSx3QkFBTyx3Q0FBd0M7QUFDbkQ7QUFBQSxZQUNGO0FBRUEsa0JBQU0sUUFBUSxNQUFNLGlCQUFpQjtBQUNyQyxrQkFBTSxnQkFBZ0I7QUFBQSxjQUNwQixTQUFTO0FBQUEsY0FDVCxPQUFPO0FBQUEsY0FDUCxXQUFXO0FBQUEsZ0JBQ1QsUUFBUTtBQUFBLGtCQUNOLFNBQVM7QUFBQSxrQkFDVCxXQUFXO0FBQUEsZ0JBQ2I7QUFBQSxjQUNGO0FBQUEsWUFDRjtBQUNBLGtCQUFNLFFBQVEsTUFBTSxZQUFZLEtBQUssVUFBVSxlQUFlLE1BQU0sQ0FBQyxDQUFDO0FBQ3RFLGdCQUFJLHdCQUFPLG9CQUFvQixTQUFTLFlBQVk7QUFDcEQsaUJBQUssUUFBUTtBQUFBLFVBQ2YsQ0FBQyxFQUFFLEtBQUs7QUFBQSxRQUNWLENBQUM7QUFBQSxNQUNIO0FBRUYsWUFBTSxTQUFTLFlBQVksVUFBVSxFQUFFLEtBQUssNEJBQTRCLENBQUM7QUFDekUsVUFBSSxDQUFDLE9BQU8sUUFBUTtBQUNsQixlQUFPLFNBQVMsS0FBSztBQUFBLFVBQ25CLE1BQU07QUFBQSxVQUNOLEtBQUs7QUFBQSxRQUNQLENBQUM7QUFDRDtBQUFBLE1BQ0Y7QUFFQSxpQkFBVyxTQUFTLFFBQVE7QUFDMUIsWUFBSSx5QkFBUSxNQUFNLEVBQ2YsUUFBUSxNQUFNLElBQUksRUFDbEIsUUFBUSxNQUFNLE1BQU0sRUFDcEI7QUFBQSxVQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsaUJBQWlCLEVBQUUsUUFBUSxZQUFZO0FBQzFELGtCQUFNLEtBQUssV0FBVyxvQkFBb0IsTUFBTSxJQUFJO0FBQUEsVUFDdEQsQ0FBQztBQUFBLFFBQ0gsRUFDQztBQUFBLFVBQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxNQUFNLEVBQUUsUUFBUSxNQUFNO0FBQ3pDLGtCQUFNLFlBQVksS0FBSyxXQUFXLFNBQVMsT0FBTztBQUNsRCxnQkFBSSx3QkFBd0IsS0FBSyxZQUFZLE1BQU0sTUFBTSxXQUFXLE1BQU07QUFDeEUsbUJBQUssUUFBUTtBQUFBLFlBQ2YsQ0FBQyxFQUFFLEtBQUs7QUFBQSxVQUNWLENBQUM7QUFBQSxRQUNIO0FBQUEsTUFDSjtBQUFBLElBQ0YsU0FBUyxPQUFPO0FBQ2Qsa0JBQVksTUFBTTtBQUNsQixrQkFBWSxTQUFTLEtBQUs7QUFBQSxRQUN4QixNQUFNLG1DQUFtQyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQUM7QUFBQSxRQUMvRixLQUFLO0FBQUEsUUFDTCxNQUFNLEVBQUUsT0FBTyw4REFBOEQ7QUFBQSxNQUMvRSxDQUFDO0FBQ0QsY0FBUSxNQUFNLDRDQUE0QyxLQUFLO0FBQUEsSUFDakU7QUFBQSxFQUNGO0FBQUEsRUFFUSxlQUFtRCxhQUEwQixNQUFjLGFBQXFCLEtBQWM7QUFDcEksUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsSUFBSSxFQUNaLFFBQVEsV0FBVyxFQUNuQjtBQUFBLE1BQVEsQ0FBQyxTQUNSLEtBQUssU0FBUyxPQUFPLEtBQUssV0FBVyxTQUFTLEdBQUcsS0FBSyxFQUFFLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNuRixRQUFDLEtBQUssV0FBVyxTQUFTLEdBQUcsSUFBZSxNQUFNLEtBQUs7QUFDdkQsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLE1BQ3JDLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDSjtBQUFBLEVBRVEsNkJBQ04sYUFDQSxVQUNBLE1BQ0EsYUFDQSxLQUNNO0FBQ04sUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsSUFBSSxFQUNaLFFBQVEsV0FBVyxFQUNuQjtBQUFBLE1BQVEsQ0FBQyxTQUNSLEtBQUssU0FBUyxPQUFPLFNBQVMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ25FLFFBQUMsU0FBUyxHQUFHLElBQTJCLE1BQU0sS0FBSztBQUNuRCxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsTUFDckMsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQ0Y7QUFFTyxTQUFTLDhCQUFvQztBQUNsRCxNQUFJLHdCQUFPLGlHQUFpRztBQUM5RztBQUVBLElBQU0sMEJBQU4sY0FBc0MsdUJBQU07QUFBQSxFQUcxQyxZQUNFLEtBQ2lCLFVBQ2pCO0FBQ0EsVUFBTSxHQUFHO0FBRlE7QUFKbkIsU0FBUSxPQUFPO0FBQUEsRUFPZjtBQUFBLEVBRUEsU0FBUztBQUNQLFVBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsY0FBVSxNQUFNO0FBQ2hCLGNBQVUsU0FBUyxNQUFNLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQztBQUU3RCxRQUFJLHlCQUFRLFNBQVMsRUFDbEIsUUFBUSxZQUFZLEVBQ3BCLFFBQVEsMkRBQTJELEVBQ25FO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxTQUFTLENBQUMsVUFBVTtBQUN2QixhQUFLLE9BQU87QUFBQSxNQUNkLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxTQUFTLEVBQ2xCO0FBQUEsTUFBVSxDQUFDLFFBQ1YsSUFDRyxjQUFjLFFBQVEsRUFDdEIsT0FBTyxFQUNQLFFBQVEsWUFBWTtBQUNuQixjQUFNLEtBQUssU0FBUyxLQUFLLElBQUk7QUFDN0IsYUFBSyxNQUFNO0FBQUEsTUFDYixDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0o7QUFDRjtBQUVBLElBQU0sMEJBQU4sY0FBc0MsdUJBQU07QUFBQSxFQVMxQyxZQUNtQkEsYUFDQSxXQUNBLFdBQ0EsUUFDakI7QUFDQSxVQUFNQSxZQUFXLEdBQUc7QUFMSCxzQkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFabkIsU0FBUSxZQUE0RDtBQUNwRSxTQUFRLFlBQWlCLENBQUM7QUFDMUIsU0FBUSxjQUFjO0FBQ3RCLFNBQVEsaUJBQWdDO0FBQ3hDLFNBQVEsa0JBQWtCO0FBQUEsRUFXMUI7QUFBQSxFQUVBLE1BQU0sU0FBUztBQUNiLFVBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsY0FBVSxNQUFNO0FBQ2hCLGNBQVUsU0FBUyxNQUFNLEVBQUUsTUFBTSxnQkFBZ0IsS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUVuRSxVQUFNLGFBQWEsR0FBRyxLQUFLLFNBQVMsZUFBZSxLQUFLLFNBQVM7QUFDakUsVUFBTSxpQkFBaUIsR0FBRyxLQUFLLFNBQVMsZUFBZSxLQUFLLFNBQVM7QUFDckUsVUFBTSxVQUFVLEtBQUssSUFBSSxNQUFNO0FBRS9CLFFBQUk7QUFDRixZQUFNLFlBQVksTUFBTSxRQUFRLEtBQUssVUFBVTtBQUMvQyxXQUFLLFlBQVksS0FBSyxNQUFNLFNBQVM7QUFDckMsV0FBSyxjQUFjO0FBQUEsSUFDckIsU0FBUyxHQUFHO0FBQ1YsVUFBSSx3QkFBTyxvQ0FBb0M7QUFDL0MsV0FBSyxNQUFNO0FBQ1g7QUFBQSxJQUNGO0FBRUEsUUFBSTtBQUNGLFVBQUksTUFBTSxRQUFRLE9BQU8sY0FBYyxHQUFHO0FBQ3hDLGFBQUssaUJBQWlCLE1BQU0sUUFBUSxLQUFLLGNBQWM7QUFBQSxNQUN6RCxPQUFPO0FBQ0wsYUFBSyxpQkFBaUI7QUFBQSxNQUN4QjtBQUFBLElBQ0YsU0FBUyxHQUFHO0FBQ1YsV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUVBLFVBQU0sWUFBWSxVQUFVLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBR25FLFNBQUssY0FBYyxVQUFVLFVBQVUsRUFBRSxLQUFLLGtCQUFrQixDQUFDO0FBQ2pFLFNBQUssV0FBVztBQUdoQixTQUFLLGVBQWUsVUFBVSxVQUFVLEVBQUUsS0FBSyxtQkFBbUIsQ0FBQztBQUduRSxVQUFNLFVBQVUsVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNqRSxZQUFRLFNBQVMsVUFBVSxFQUFFLE1BQU0sU0FBUyxDQUFDLEVBQUUsaUJBQWlCLFNBQVMsTUFBTSxLQUFLLE1BQU0sQ0FBQztBQUMzRixVQUFNLFVBQVUsUUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLFFBQVEsS0FBSyxVQUFVLENBQUM7QUFDM0UsWUFBUSxpQkFBaUIsU0FBUyxZQUFZO0FBQzVDLFlBQU0sS0FBSyxhQUFhO0FBQUEsSUFDMUIsQ0FBQztBQUVELFNBQUssZ0JBQWdCO0FBQUEsRUFDdkI7QUFBQSxFQUVBLGFBQWE7QUFDWCxTQUFLLFlBQVksTUFBTTtBQUN2QixVQUFNLE9BQXFGO0FBQUEsTUFDekYsRUFBRSxJQUFJLFdBQVcsT0FBTyxVQUFVO0FBQUEsTUFDbEMsRUFBRSxJQUFJLGFBQWEsT0FBTyxZQUFZO0FBQUEsTUFDdEMsRUFBRSxJQUFJLGNBQWMsT0FBTyxhQUFhO0FBQUEsTUFDeEMsRUFBRSxJQUFJLE9BQU8sT0FBTyxXQUFXO0FBQUEsSUFDakM7QUFFQSxlQUFXLE9BQU8sTUFBTTtBQUN0QixZQUFNLE1BQU0sS0FBSyxZQUFZLFNBQVMsVUFBVTtBQUFBLFFBQzlDLE1BQU0sSUFBSTtBQUFBLFFBQ1YsS0FBSyxrQkFBa0IsS0FBSyxjQUFjLElBQUksS0FBSyxlQUFlO0FBQUEsTUFDcEUsQ0FBQztBQUNELFVBQUksaUJBQWlCLFNBQVMsTUFBTTtBQUNsQyxhQUFLLEtBQUssVUFBVSxJQUFJLEVBQUU7QUFBQSxNQUM1QixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sVUFBVSxLQUFxRDtBQUNuRSxRQUFJLEtBQUssY0FBYyxPQUFPO0FBQzVCLFVBQUk7QUFDRixhQUFLLFlBQVksS0FBSyxNQUFNLEtBQUssV0FBVztBQUFBLE1BQzlDLFNBQVMsR0FBRztBQUNWLFlBQUksd0JBQU8sc0VBQXNFO0FBQ2pGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxTQUFLLFlBQVk7QUFDakIsU0FBSyxXQUFXO0FBQ2hCLFNBQUssZ0JBQWdCO0FBQUEsRUFDdkI7QUFBQSxFQUVBLGtCQUFrQjtBQUNoQixTQUFLLGFBQWEsTUFBTTtBQUN4QixRQUFJLEtBQUssY0FBYyxXQUFXO0FBQ2hDLFdBQUssaUJBQWlCLEtBQUssWUFBWTtBQUFBLElBQ3pDLFdBQVcsS0FBSyxjQUFjLGFBQWE7QUFDekMsV0FBSyxtQkFBbUIsS0FBSyxZQUFZO0FBQUEsSUFDM0MsV0FBVyxLQUFLLGNBQWMsY0FBYztBQUMxQyxXQUFLLG9CQUFvQixLQUFLLFlBQVk7QUFBQSxJQUM1QyxXQUFXLEtBQUssY0FBYyxPQUFPO0FBQ25DLFdBQUssYUFBYSxLQUFLLFlBQVk7QUFBQSxJQUNyQztBQUFBLEVBQ0Y7QUFBQSxFQUVBLGlCQUFpQixhQUEwQjtBQUV6QyxRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxTQUFTLEVBQ2pCLFFBQVEsbURBQW1ELEVBQzNELFlBQVksQ0FBQyxhQUFhO0FBQ3pCLGVBQ0csVUFBVSxVQUFVLFFBQVEsRUFDNUIsVUFBVSxVQUFVLFFBQVEsRUFDNUIsVUFBVSxPQUFPLEtBQUssRUFDdEIsVUFBVSxRQUFRLE1BQU0sRUFDeEIsVUFBVSxVQUFVLFFBQVEsRUFDNUIsU0FBUyxLQUFLLFVBQVUsV0FBVyxRQUFRLEVBQzNDLFNBQVMsQ0FBQyxVQUFVO0FBQ25CLGFBQUssVUFBVSxVQUFVO0FBQ3pCLGFBQUssZ0JBQWdCO0FBQUEsTUFDdkIsQ0FBQztBQUFBLElBQ0wsQ0FBQztBQUdILFFBQ0UsS0FBSyxVQUFVLFlBQVksWUFDM0IsS0FBSyxVQUFVLFlBQVksWUFDM0IsS0FBSyxVQUFVLFlBQVksT0FDM0I7QUFDQSxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxLQUFLLFVBQVUsWUFBWSxRQUFRLGVBQWUsWUFBWSxFQUN0RTtBQUFBLFFBQ0MsS0FBSyxVQUFVLFlBQVksUUFDdkIsMkVBQ0E7QUFBQSxNQUNOLEVBQ0MsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxTQUFTLEVBQUUsRUFDbkMsU0FBUyxDQUFDLFFBQVE7QUFDakIsZUFBSyxVQUFVLFFBQVEsSUFBSSxLQUFLO0FBQUEsUUFDbEMsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUFBLElBQ0w7QUFFQSxRQUFJLEtBQUssVUFBVSxZQUFZLE9BQU87QUFDcEMsVUFBSSxDQUFDLEtBQUssVUFBVSxLQUFLO0FBQ3ZCLGFBQUssVUFBVSxNQUFNLENBQUM7QUFBQSxNQUN4QjtBQUNBLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHVCQUF1QixFQUMvQixRQUFRLHFHQUFxRyxFQUM3RyxVQUFVLENBQUMsV0FBVztBQUNyQixlQUNHLFNBQVMsS0FBSyxVQUFVLElBQUksZUFBZSxLQUFLLEVBQ2hELFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxJQUFJLGNBQWM7QUFBQSxRQUNuQyxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBQUEsSUFDTDtBQUdBLFFBQUksS0FBSyxVQUFVLFlBQVksUUFBUTtBQUNyQyxVQUFJLENBQUMsS0FBSyxVQUFVLE1BQU07QUFDeEIsYUFBSyxVQUFVLE9BQU8sRUFBRSxXQUFXLElBQUksaUJBQWlCLEdBQUc7QUFBQSxNQUM3RDtBQUVBLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLFlBQVksRUFDcEIsUUFBUSwrREFBK0QsRUFDdkUsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxLQUFLLGFBQWEsRUFBRSxFQUM1QyxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsS0FBSyxZQUFZLElBQUksS0FBSztBQUFBLFFBQzNDLENBQUM7QUFBQSxNQUNMLENBQUM7QUFFSCxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxrQkFBa0IsRUFDMUIsUUFBUSx5RkFBeUYsRUFDakcsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxLQUFLLG1CQUFtQixFQUFFLEVBQ2xELFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxLQUFLLGtCQUFrQixJQUFJLEtBQUs7QUFBQSxRQUNqRCxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBRUgsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsZ0JBQWdCLEVBQ3hCLFFBQVEsNERBQTRELEVBQ3BFLFFBQVEsQ0FBQyxTQUFTO0FBQ2pCLGFBQ0csU0FBUyxLQUFLLFVBQVUsS0FBSyxpQkFBaUIsRUFBRSxFQUNoRCxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsS0FBSyxnQkFBZ0IsSUFBSSxLQUFLLEtBQUs7QUFBQSxRQUNwRCxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBRUgsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsZUFBZSxFQUN2QixRQUFRLHFDQUFxQyxFQUM3QyxRQUFRLENBQUMsU0FBUztBQUNqQixhQUNHLFNBQVMsS0FBSyxVQUFVLEtBQUssV0FBVyxFQUFFLEVBQzFDLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxLQUFLLFVBQVUsSUFBSSxLQUFLLEtBQUs7QUFBQSxRQUM5QyxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBQUEsSUFDTDtBQUdBLFFBQUksS0FBSyxVQUFVLFlBQVksVUFBVTtBQUN2QyxVQUFJLENBQUMsS0FBSyxVQUFVLFFBQVE7QUFDMUIsYUFBSyxVQUFVLFNBQVMsRUFBRSxZQUFZLEdBQUc7QUFBQSxNQUMzQztBQUVBLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLG1CQUFtQixFQUMzQixRQUFRLHNEQUFzRCxFQUM5RCxRQUFRLENBQUMsU0FBUztBQUNqQixhQUNHLFNBQVMsS0FBSyxVQUFVLE9BQU8sY0FBYyxFQUFFLEVBQy9DLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxPQUFPLGFBQWEsSUFBSSxLQUFLO0FBQUEsUUFDOUMsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUVILFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGtCQUFrQixFQUMxQixRQUFRLGtFQUFrRSxFQUMxRSxRQUFRLENBQUMsU0FBUztBQUNqQixhQUNHLFNBQVMsS0FBSyxVQUFVLE9BQU8sUUFBUSxFQUFFLEVBQ3pDLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxPQUFPLE9BQU8sSUFBSSxLQUFLLEtBQUs7QUFBQSxRQUM3QyxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLG1CQUFtQixhQUEwQjtBQUMzQyxnQkFBWSxTQUFTLE1BQU0sRUFBRSxNQUFNLHVCQUF1QixDQUFDO0FBRTNELFFBQUksQ0FBQyxLQUFLLFVBQVUsV0FBVztBQUM3QixXQUFLLFVBQVUsWUFBWSxDQUFDO0FBQUEsSUFDOUI7QUFFQSxVQUFNLGNBQWMsWUFBWSxVQUFVLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQztBQUN4RSxVQUFNLFlBQVksT0FBTyxRQUFRLEtBQUssVUFBVSxTQUEyRjtBQUUzSSxRQUFJLFVBQVUsV0FBVyxHQUFHO0FBQzFCLGtCQUFZLFNBQVMsS0FBSyxFQUFFLE1BQU0sMkNBQTJDLEtBQUssMkJBQTJCLENBQUM7QUFBQSxJQUNoSCxPQUFPO0FBQ0wsaUJBQVcsQ0FBQyxVQUFVLFVBQVUsS0FBSyxXQUFXO0FBQzlDLGNBQU0sT0FBTyxZQUFZLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBQ2hFLGFBQUssU0FBUyxVQUFVLEVBQUUsTUFBTSxVQUFVLE1BQU0sRUFBRSxPQUFPLDJEQUEyRCxFQUFFLENBQUM7QUFFdkgsY0FBTSxZQUFhLFdBQW1CLGVBQWU7QUFFckQsWUFBSSx5QkFBUSxJQUFJLEVBQ2IsUUFBUSwyQkFBMkIsRUFDbkMsUUFBUSxpRkFBaUYsRUFDekYsVUFBVSxDQUFDLFdBQVc7QUFDckIsaUJBQ0csU0FBUyxTQUFTLEVBQ2xCLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGdCQUFJLEtBQUs7QUFDUCxjQUFDLFdBQW1CLGFBQWE7QUFDakMscUJBQU8sV0FBVztBQUNsQixxQkFBTyxXQUFXO0FBQUEsWUFDcEIsT0FBTztBQUNMLHFCQUFRLFdBQW1CO0FBQzNCLG9CQUFNLFdBQVcsS0FBSyxXQUFXLGdCQUFnQix5QkFBeUIsVUFBVSxLQUFLLFdBQVcsUUFBUTtBQUM1Ryx5QkFBVyxVQUFVLFVBQVUsV0FBVztBQUMxQyx5QkFBVyxZQUFZLFVBQVUsYUFBYTtBQUFBLFlBQ2hEO0FBQ0EsaUJBQUssZ0JBQWdCO0FBQUEsVUFDdkIsQ0FBQztBQUFBLFFBQ0wsQ0FBQztBQUVILFlBQUkseUJBQVEsSUFBSSxFQUNiLFFBQVEsU0FBUyxFQUNqQixRQUFRLDhEQUE4RCxFQUN0RSxRQUFRLENBQUMsU0FBUztBQUNqQixnQkFBTSxXQUFXLEtBQUssV0FBVyxnQkFBZ0IseUJBQXlCLFVBQVUsS0FBSyxXQUFXLFFBQVE7QUFDNUcsZUFDRyxlQUFlLFVBQVUsV0FBVyxFQUFFLEVBQ3RDLFNBQVMsV0FBVyxXQUFXLEVBQUUsRUFDakMsWUFBWSxTQUFTLEVBQ3JCLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLHVCQUFXLFVBQVUsSUFBSSxLQUFLO0FBQUEsVUFDaEMsQ0FBQztBQUFBLFFBQ0wsQ0FBQztBQUVILFlBQUkseUJBQVEsSUFBSSxFQUNiLFFBQVEsV0FBVyxFQUNuQixRQUFRLHdDQUF3QyxFQUNoRCxRQUFRLENBQUMsU0FBUztBQUNqQixnQkFBTSxXQUFXLEtBQUssV0FBVyxnQkFBZ0IseUJBQXlCLFVBQVUsS0FBSyxXQUFXLFFBQVE7QUFDNUcsZUFDRyxlQUFlLFVBQVUsYUFBYSxFQUFFLEVBQ3hDLFNBQVMsV0FBVyxhQUFhLEVBQUUsRUFDbkMsWUFBWSxTQUFTLEVBQ3JCLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLHVCQUFXLFlBQVksSUFBSSxLQUFLO0FBQUEsVUFDbEMsQ0FBQztBQUFBLFFBQ0wsQ0FBQztBQUVILFlBQUkseUJBQVEsSUFBSSxFQUNiLFVBQVUsQ0FBQyxRQUFRO0FBQ2xCLGNBQ0csY0FBYyxpQkFBaUIsRUFDL0IsV0FBVyxFQUNYLFFBQVEsTUFBTTtBQUNiLG1CQUFPLEtBQUssVUFBVSxVQUFVLFFBQVE7QUFDeEMsaUJBQUssZ0JBQWdCO0FBQUEsVUFDdkIsQ0FBQztBQUFBLFFBQ0wsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBR0EsZ0JBQVksU0FBUyxNQUFNLEVBQUUsTUFBTSx3QkFBd0IsTUFBTSxFQUFFLE9BQU8sc0JBQXNCLEVBQUUsQ0FBQztBQUNuRyxRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxhQUFhLEVBQ3JCLFFBQVEsbUNBQW1DLEVBQzNDLFFBQVEsQ0FBQyxTQUFTO0FBQ2pCLFdBQUssU0FBUyxLQUFLLGVBQWUsRUFBRSxTQUFTLENBQUMsUUFBUTtBQUNwRCxhQUFLLGtCQUFrQixJQUFJLEtBQUssRUFBRSxZQUFZO0FBQUEsTUFDaEQsQ0FBQztBQUFBLElBQ0gsQ0FBQyxFQUNBLFVBQVUsQ0FBQyxRQUFRO0FBQ2xCLFVBQUksY0FBYyxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsTUFBTTtBQUNoRCxZQUFJLENBQUMsS0FBSyxpQkFBaUI7QUFDekIsY0FBSSx3QkFBTywrQkFBK0I7QUFDMUM7QUFBQSxRQUNGO0FBQ0EsWUFBSSxLQUFLLFVBQVUsVUFBVSxLQUFLLGVBQWUsR0FBRztBQUNsRCxjQUFJLHdCQUFPLDhCQUE4QjtBQUN6QztBQUFBLFFBQ0Y7QUFDQSxhQUFLLFVBQVUsVUFBVSxLQUFLLGVBQWUsSUFBSTtBQUFBLFVBQy9DLFNBQVMsR0FBRyxLQUFLLGVBQWU7QUFBQSxVQUNoQyxXQUFXLElBQUksS0FBSyxlQUFlO0FBQUEsUUFDckM7QUFDQSxhQUFLLGtCQUFrQjtBQUN2QixhQUFLLGdCQUFnQjtBQUFBLE1BQ3ZCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNMO0FBQUEsRUFFQSxvQkFBb0IsYUFBMEI7QUFDNUMsUUFBSSxLQUFLLFVBQVUsWUFBWSxZQUFZLEtBQUssVUFBVSxZQUFZLFVBQVU7QUFDOUUsa0JBQVksU0FBUyxLQUFLO0FBQUEsUUFDeEIsTUFBTSx5RkFBeUYsS0FBSyxVQUFVLE9BQU87QUFBQSxRQUNySCxLQUFLO0FBQUEsTUFDUCxDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsUUFBSSxLQUFLLG1CQUFtQixNQUFNO0FBQ2hDLGtCQUFZLFNBQVMsS0FBSztBQUFBLFFBQ3hCLE1BQU07QUFBQSxRQUNOLEtBQUs7QUFBQSxNQUNQLENBQUM7QUFFRCxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsVUFBVSxDQUFDLFFBQVE7QUFDbEIsWUFDRyxjQUFjLG1CQUFtQixFQUNqQyxPQUFPLEVBQ1AsUUFBUSxNQUFNO0FBQ2IsZUFBSyxpQkFBaUI7QUFBQSxZQUNwQjtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxVQUNGLEVBQUUsS0FBSyxJQUFJO0FBQ1gsZUFBSyxnQkFBZ0I7QUFBQSxRQUN2QixDQUFDO0FBQUEsTUFDTCxDQUFDO0FBQUEsSUFDTCxPQUFPO0FBQ0wsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsb0JBQW9CLEVBQzVCLFFBQVEsd0RBQXdELEVBQ2hFLFlBQVksQ0FBQyxTQUFTO0FBQ3JCLGFBQUssUUFBUSxPQUFPO0FBQ3BCLGFBQUssUUFBUSxNQUFNLGFBQWE7QUFDaEMsYUFBSyxRQUFRLE1BQU0sUUFBUTtBQUMzQixhQUFLLFNBQVMsS0FBSyxrQkFBa0IsRUFBRTtBQUN2QyxhQUFLLFNBQVMsQ0FBQyxRQUFRO0FBQ3JCLGVBQUssaUJBQWlCO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0gsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNGO0FBQUEsRUFFQSxhQUFhLGFBQTBCO0FBQ3JDLFNBQUssY0FBYyxLQUFLLFVBQVUsS0FBSyxXQUFXLE1BQU0sQ0FBQztBQUN6RCxRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxvQkFBb0IsRUFDNUIsWUFBWSxDQUFDLFNBQVM7QUFDckIsV0FBSyxRQUFRLE9BQU87QUFDcEIsV0FBSyxRQUFRLE1BQU0sYUFBYTtBQUNoQyxXQUFLLFFBQVEsTUFBTSxRQUFRO0FBQzNCLFdBQUssU0FBUyxLQUFLLFdBQVc7QUFDOUIsV0FBSyxTQUFTLENBQUMsUUFBUTtBQUNyQixhQUFLLGNBQWM7QUFBQSxNQUNyQixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDTDtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBRW5CLFFBQUksS0FBSyxjQUFjLE9BQU87QUFDNUIsVUFBSTtBQUNGLGFBQUssWUFBWSxLQUFLLE1BQU0sS0FBSyxXQUFXO0FBQUEsTUFDOUMsU0FBUyxHQUFHO0FBQ1YsWUFBSSx3QkFBTyxtRUFBbUU7QUFDOUU7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFFBQUksQ0FBQyxLQUFLLFVBQVUsU0FBUztBQUMzQixVQUFJLHdCQUFPLHNCQUFzQjtBQUNqQztBQUFBLElBQ0Y7QUFDQSxRQUFJLEtBQUssVUFBVSxZQUFZLFdBQVcsQ0FBQyxLQUFLLFVBQVUsTUFBTSxhQUFhLENBQUMsS0FBSyxVQUFVLE1BQU0sa0JBQWtCO0FBQ25ILFVBQUksd0JBQU8sd0RBQXdEO0FBQ25FO0FBQUEsSUFDRjtBQUNBLFFBQUksS0FBSyxVQUFVLFlBQVksWUFBWSxDQUFDLEtBQUssVUFBVSxRQUFRLFlBQVk7QUFDN0UsVUFBSSx3QkFBTyw0Q0FBNEM7QUFDdkQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUFVLEtBQUssSUFBSSxNQUFNO0FBQy9CLFVBQU0sYUFBYSxHQUFHLEtBQUssU0FBUyxlQUFlLEtBQUssU0FBUztBQUNqRSxVQUFNLGlCQUFpQixHQUFHLEtBQUssU0FBUyxlQUFlLEtBQUssU0FBUztBQUVyRSxRQUFJO0FBRUYsWUFBTSxZQUFZLEtBQUssVUFBVSxLQUFLLFdBQVcsTUFBTSxDQUFDO0FBQ3hELFlBQU0sUUFBUSxNQUFNLFlBQVksU0FBUztBQUd6QyxVQUFJLEtBQUssVUFBVSxZQUFZLFlBQVksS0FBSyxVQUFVLFlBQVksVUFBVTtBQUM5RSxZQUFJLEtBQUssbUJBQW1CLE1BQU07QUFDaEMsZ0JBQU0sUUFBUSxNQUFNLGdCQUFnQixLQUFLLGNBQWM7QUFBQSxRQUN6RDtBQUFBLE1BQ0Y7QUFFQSxVQUFJLHdCQUFPLHVDQUF1QztBQUNsRCxXQUFLLE9BQU87QUFDWixXQUFLLE1BQU07QUFBQSxJQUNiLFNBQVMsT0FBTztBQUNkLFVBQUksd0JBQU8sZ0JBQWdCLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQyxFQUFFO0FBQUEsSUFDckY7QUFBQSxFQUNGO0FBQ0Y7OztBQzVnQ0EsSUFBQUMsd0JBQXNCO0FBQ3RCLElBQUFDLG1CQUF1QztBQUN2QyxJQUFBQyxhQUF1QjtBQUN2QixJQUFBQyxlQUFxQjtBQWtGckIsZUFBc0Isd0JBQ3BCLFFBQ0EsV0FDQSxVQUNBLFNBQ0EsTUFDNkI7QUFDN0IsTUFBSSxNQUFNLG1CQUFtQixXQUFXLEtBQUssR0FBRztBQUM5QyxXQUFPLEtBQUssa0JBQWtCLFNBQVMsZ0JBQ25DLG9DQUFvQyxRQUFRLFdBQVcsVUFBVSxTQUFTLEtBQUssaUJBQWlCLElBQ2hHLGdDQUFnQyxRQUFRLFdBQVcsVUFBVSxTQUFTLEtBQUssaUJBQWlCO0FBQUEsRUFDbEc7QUFFQSxNQUFJLGFBQWEsWUFBWSxNQUFNO0FBQ2pDLFdBQU8sOEJBQThCLFFBQVEsV0FBVyxTQUFTLElBQUk7QUFBQSxFQUN2RTtBQUVBLFNBQU8sZ0NBQWdDLFFBQVEsV0FBVyxVQUFVLE9BQU87QUFDN0U7QUFFQSxTQUFTLGdDQUNQLFFBQ0EsV0FDQSxVQUNBLFNBQ29CO0FBQ3BCLFFBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxRQUFNLGdCQUFnQixVQUFVLGFBQzVCLGdCQUFnQixPQUFPLFVBQVUsVUFBVSxVQUFVLElBQ3JELGNBQWMsT0FBTyxTQUFTO0FBRWxDLE1BQUksQ0FBQyxlQUFlO0FBQ2xCLFVBQU0sU0FBUyxVQUFVLGFBQWEsVUFBVSxVQUFVLFVBQVUsS0FBSztBQUN6RSxVQUFNLElBQUksTUFBTSxxQkFBcUIsTUFBTSxTQUFTLFVBQVUsUUFBUSxHQUFHO0FBQUEsRUFDM0U7QUFFQSxRQUFNLFdBQVcsWUFBWSxPQUFPLGFBQWE7QUFDakQsUUFBTSxlQUFlLFVBQVUsb0JBQzNCLHdCQUF3QixPQUFPLFVBQVUsZUFBZSxRQUFRLElBQ2hFO0FBQ0osUUFBTSxVQUFVLENBQUMsY0FBYyxVQUFVLFFBQVEsS0FBSyxJQUFJLFVBQVUsRUFBRSxFQUNuRSxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUM1QixLQUFLLE1BQU07QUFFZCxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsYUFBYSx3QkFBd0IsV0FBVyxhQUFhO0FBQUEsRUFDL0Q7QUFDRjtBQUVBLGVBQWUsZ0NBQ2IsUUFDQSxXQUNBLFVBQ0EsU0FDQSxXQUM2QjtBQUM3QixRQUFNLFVBQVUsVUFBTSw4QkFBUSx1QkFBSyxtQkFBTyxHQUFHLGVBQWUsQ0FBQztBQUM3RCxRQUFNLGlCQUFhLG1CQUFLLFNBQVMsWUFBWTtBQUM3QyxRQUFNLGtCQUFjLG1CQUFLLFNBQVMsYUFBYTtBQUMvQyxRQUFNLGtCQUFjLG1CQUFLLFNBQVMsY0FBYztBQUVoRCxNQUFJO0FBQ0YsVUFBTSxVQUFVO0FBQUEsTUFDZDtBQUFBLE1BQ0EsVUFBVSxVQUFVO0FBQUEsTUFDcEIsWUFBWSxVQUFVLGNBQWM7QUFBQSxNQUNwQyxXQUFXLFVBQVUsYUFBYTtBQUFBLE1BQ2xDLFNBQVMsVUFBVSxXQUFXO0FBQUEsTUFDOUIsbUJBQW1CLFVBQVU7QUFBQSxNQUM3QjtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQ0EsY0FBTSw0QkFBVSxZQUFZLFFBQVEsTUFBTTtBQUMxQyxjQUFNLDRCQUFVLGFBQWEsU0FBUyxNQUFNO0FBQzVDLGNBQU0sNEJBQVUsYUFBYSxLQUFLLFVBQVUsU0FBUyxNQUFNLENBQUMsR0FBRyxNQUFNO0FBRXJFLFVBQU0sU0FBUyxNQUFNLHFCQUFxQixXQUFXO0FBQUEsTUFDbkQ7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDO0FBQ0QsVUFBTSxTQUFTLDZCQUE2QixNQUFNO0FBQ2xELFVBQU0sVUFBVSxPQUFPLFdBQVc7QUFBQSxNQUNoQyxHQUFJLE9BQU8sV0FBVyxDQUFDO0FBQUEsTUFDdkIsR0FBSSxPQUFPLGdCQUFnQixDQUFDO0FBQUEsTUFDNUIsT0FBTyxZQUFZO0FBQUEsTUFDbkIsUUFBUSxLQUFLLElBQUksVUFBVTtBQUFBLElBQzdCLEVBQUUsT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFBRSxLQUFLLE1BQU07QUFFM0MsUUFBSSxDQUFDLFFBQVEsS0FBSyxHQUFHO0FBQ25CLFlBQU0sSUFBSSxNQUFNLDhDQUE4QztBQUFBLElBQ2hFO0FBRUEsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBLGFBQWEsT0FBTyxhQUFhLEtBQUssS0FBSyx3QkFBd0IsV0FBVyxJQUFJO0FBQUEsSUFDcEY7QUFBQSxFQUNGLFVBQUU7QUFDQSxjQUFNLHFCQUFHLFNBQVMsRUFBRSxXQUFXLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxFQUNwRDtBQUNGO0FBRUEsZUFBZSxvQ0FDYixRQUNBLFdBQ0EsVUFDQSxTQUNBLFdBQzZCO0FBQzdCLFFBQU0sVUFBVSxVQUFNLDhCQUFRLHVCQUFLLG1CQUFPLEdBQUcsZUFBZSxDQUFDO0FBQzdELFFBQU0saUJBQWEsbUJBQUssU0FBUyxZQUFZO0FBQzdDLFFBQU0sa0JBQWMsbUJBQUssU0FBUyxhQUFhO0FBQy9DLFFBQU0sa0JBQWMsbUJBQUssU0FBUyxjQUFjO0FBRWhELE1BQUk7QUFDRixVQUFNLFVBQVU7QUFBQSxNQUNkO0FBQUEsTUFDQSxVQUFVLFVBQVU7QUFBQSxNQUNwQixZQUFZLFVBQVUsY0FBYztBQUFBLE1BQ3BDLFdBQVcsVUFBVSxhQUFhO0FBQUEsTUFDbEMsU0FBUyxVQUFVLFdBQVc7QUFBQSxNQUM5QixtQkFBbUIsVUFBVTtBQUFBLE1BQzdCO0FBQUEsTUFDQTtBQUFBLE1BQ0EsZ0JBQWdCO0FBQUEsSUFDbEI7QUFDQSxjQUFNLDRCQUFVLFlBQVksUUFBUSxNQUFNO0FBQzFDLGNBQU0sNEJBQVUsYUFBYSxTQUFTLE1BQU07QUFDNUMsY0FBTSw0QkFBVSxhQUFhLEtBQUssVUFBVSxTQUFTLE1BQU0sQ0FBQyxHQUFHLE1BQU07QUFFckUsVUFBTSxTQUFTLE1BQU0scUJBQXFCLFdBQVc7QUFBQSxNQUNuRDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGLENBQUM7QUFDRCxVQUFNLFNBQVMsd0JBQXdCLE1BQU07QUFDN0MsVUFBTSxvQkFBb0IsT0FBTyxhQUFhLFFBQVEsUUFBUTtBQUM5RCxVQUFNLGVBQWUsVUFBVSxhQUFhLE9BQU8sVUFBVSxVQUFVLFVBQVUsS0FBSyxVQUFVLGFBQWE7QUFDN0csVUFBTSxxQkFBMEM7QUFBQSxNQUM5QyxHQUFHO0FBQUEsTUFDSCxVQUFVLEdBQUcsVUFBVSxRQUFRLGNBQWMsc0JBQXNCLFFBQVEsUUFBUSxHQUFHO0FBQUEsTUFDdEYsWUFBWTtBQUFBLElBQ2Q7QUFDQSxVQUFNLFdBQVcsZ0NBQWdDLE9BQU8saUJBQWlCLG9CQUFvQixtQkFBbUIsT0FBTyxXQUFXLE9BQU87QUFFekksV0FBTztBQUFBLE1BQ0wsU0FBUyxTQUFTO0FBQUEsTUFDbEIsYUFBYSxPQUFPLGFBQWEsS0FBSyxLQUFLLEdBQUcsVUFBVSxRQUFRLElBQUksVUFBVSxjQUFjLGFBQWE7QUFBQSxJQUMzRztBQUFBLEVBQ0YsVUFBRTtBQUNBLGNBQU0scUJBQUcsU0FBUyxFQUFFLFdBQVcsTUFBTSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3BEO0FBQ0Y7QUFFQSxlQUFlLHFCQUNiLFdBQ0EsUUFPaUI7QUFDakIsUUFBTSxPQUFPLFVBQVUsS0FBSyxJQUFJLENBQUMsUUFBUSxJQUN0QyxXQUFXLGFBQWEsT0FBTyxXQUFXLEVBQzFDLFdBQVcsWUFBWSxPQUFPLFVBQVUsRUFDeEMsV0FBVyxVQUFVLE9BQU8sVUFBVSxFQUN0QyxXQUFXLGFBQWEsT0FBTyxXQUFXLEVBQzFDLFdBQVcsWUFBWSxPQUFPLFVBQVUsY0FBYyxFQUFFLEVBQ3hELFdBQVcsZUFBZSxPQUFPLFVBQVUsYUFBYSxPQUFPLEtBQUssT0FBTyxPQUFPLFVBQVUsU0FBUyxDQUFDLEVBQ3RHLFdBQVcsYUFBYSxPQUFPLFVBQVUsV0FBVyxPQUFPLEtBQUssT0FBTyxPQUFPLFVBQVUsT0FBTyxDQUFDLEVBQ2hHLFdBQVcsVUFBVSxPQUFPLFVBQVUsb0JBQW9CLFNBQVMsT0FBTyxFQUMxRSxXQUFXLGNBQWMsT0FBTyxRQUFRLENBQUM7QUFFNUMsU0FBTyxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDdEMsVUFBTSxZQUFRLDZCQUFNLFVBQVUsWUFBWSxNQUFNO0FBQUEsTUFDOUMsS0FBSyxVQUFVO0FBQUEsTUFDZixPQUFPLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxJQUNoQyxDQUFDO0FBQ0QsUUFBSSxTQUFTO0FBQ2IsUUFBSSxTQUFTO0FBQ2IsVUFBTSxVQUFVLFdBQVcsTUFBTTtBQUMvQixZQUFNLEtBQUssU0FBUztBQUNwQixhQUFPLElBQUksTUFBTSwyQ0FBMkMsVUFBVSxTQUFTLE1BQU0sQ0FBQztBQUFBLElBQ3hGLEdBQUcsVUFBVSxTQUFTO0FBRXRCLFVBQU0sT0FBTyxZQUFZLE1BQU07QUFDL0IsVUFBTSxPQUFPLFlBQVksTUFBTTtBQUMvQixVQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsVUFBa0I7QUFDekMsZ0JBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsVUFBa0I7QUFDekMsZ0JBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLEdBQUcsU0FBUyxDQUFDLFVBQVU7QUFDM0IsbUJBQWEsT0FBTztBQUNwQixhQUFPLEtBQUs7QUFBQSxJQUNkLENBQUM7QUFDRCxVQUFNLEdBQUcsU0FBUyxDQUFDLFNBQVM7QUFDMUIsbUJBQWEsT0FBTztBQUNwQixVQUFJLFNBQVMsR0FBRztBQUNkLGVBQU8sSUFBSSxPQUFPLFVBQVUsVUFBVSw0Q0FBNEMsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO0FBQ2xHO0FBQUEsTUFDRjtBQUNBLGNBQVEsTUFBTTtBQUFBLElBQ2hCLENBQUM7QUFFRCxVQUFNLE1BQU0sSUFBSSxLQUFLLFVBQVU7QUFBQSxNQUM3QixhQUFhLE9BQU87QUFBQSxNQUNwQixZQUFZLE9BQU87QUFBQSxNQUNuQixhQUFhLE9BQU87QUFBQSxNQUNwQixVQUFVLE9BQU87QUFBQSxNQUNqQixVQUFVLE9BQU8sVUFBVTtBQUFBLE1BQzNCLFlBQVksT0FBTyxVQUFVLGNBQWM7QUFBQSxNQUMzQyxXQUFXLE9BQU8sVUFBVSxhQUFhO0FBQUEsTUFDekMsU0FBUyxPQUFPLFVBQVUsV0FBVztBQUFBLE1BQ3JDLG1CQUFtQixPQUFPLFVBQVU7QUFBQSxJQUN0QyxDQUFDLENBQUM7QUFBQSxFQUNKLENBQUM7QUFDSDtBQUVBLFNBQVMsNkJBQTZCLFFBQXlDO0FBQzdFLE1BQUk7QUFDRixVQUFNLFNBQVMsS0FBSyxNQUFNLE1BQU07QUFDaEMsUUFBSSxPQUFPLFdBQVcsWUFBWSxVQUFVLE1BQU07QUFDaEQsWUFBTSxJQUFJLE1BQU0sb0RBQW9EO0FBQUEsSUFDdEU7QUFDQSxXQUFPO0FBQUEsRUFDVCxTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksTUFBTSxrREFBa0QsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxFQUM1SDtBQUNGO0FBRUEsU0FBUyx3QkFBd0IsUUFBb0M7QUFDbkUsTUFBSTtBQUNGLFVBQU0sU0FBUyxLQUFLLE1BQU0sTUFBTTtBQUNoQyxRQUFJLE9BQU8sV0FBVyxZQUFZLFVBQVUsUUFBUSxPQUFPLE9BQU8sb0JBQW9CLFVBQVU7QUFDOUYsWUFBTSxJQUFJLE1BQU0sdURBQXVEO0FBQUEsSUFDekU7QUFDQSxRQUFJLE9BQU8sWUFBWSxRQUFRLE9BQU8sYUFBYSxPQUFPLE9BQU8sYUFBYSxPQUFPO0FBQ25GLFlBQU0sSUFBSSxNQUFNLDJDQUEyQztBQUFBLElBQzdEO0FBQ0EsUUFBSSxPQUFPLFdBQVcsU0FBUyxPQUFPLE9BQU8sWUFBWSxZQUFZLE1BQU0sUUFBUSxPQUFPLE9BQU8sSUFBSTtBQUNuRyxZQUFNLElBQUksTUFBTSwyQ0FBMkM7QUFBQSxJQUM3RDtBQUNBLFdBQU87QUFBQSxFQUNULFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSSxNQUFNLG1EQUFtRCxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQUMsRUFBRTtBQUFBLEVBQzdIO0FBQ0Y7QUFFQSxlQUFlLDhCQUNiLFFBQ0EsV0FDQSxTQUNBLE1BQzZCO0FBQzdCLFFBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxRQUFNLGFBQWEsTUFBTSxvQkFBb0IsUUFBUSxJQUFJO0FBQ3pELFFBQU0sZ0JBQWdCLFVBQVUsYUFDNUIsc0JBQXNCLFlBQVksVUFBVSxVQUFVLElBQ3RELGNBQWMsT0FBTyxTQUFTO0FBRWxDLE1BQUksQ0FBQyxlQUFlO0FBQ2xCLFVBQU0sU0FBUyxVQUFVLGFBQWEsVUFBVSxVQUFVLFVBQVUsS0FBSztBQUN6RSxVQUFNLElBQUksTUFBTSxxQkFBcUIsTUFBTSxTQUFTLFVBQVUsUUFBUSxHQUFHO0FBQUEsRUFDM0U7QUFFQSxRQUFNLFdBQVcsWUFBWSxPQUFPLGFBQWE7QUFDakQsUUFBTSxRQUFRLDRCQUE0QjtBQUMxQyxRQUFNLGVBQWUsVUFBVSxvQkFDM0IsTUFBTSw4QkFBOEIsUUFBUSxVQUFVLFVBQVUsZUFBZSxVQUFVLFNBQVMsTUFBTSxLQUFLLElBQzdHO0FBQ0osUUFBTSxVQUFVLENBQUMsY0FBYyxVQUFVLFFBQVEsS0FBSyxJQUFJLFVBQVUsRUFBRSxFQUNuRSxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUM1QixLQUFLLE1BQU07QUFFZCxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsYUFBYSx3QkFBd0IsV0FBVyxhQUFhO0FBQUEsRUFDL0Q7QUFDRjtBQUVBLFNBQVMsOEJBQXFEO0FBQzVELFNBQU87QUFBQSxJQUNMLGdCQUFnQixvQkFBSSxJQUFJO0FBQUEsSUFDeEIsaUJBQWlCLG9CQUFJLElBQUk7QUFBQSxJQUN6QixTQUFTLG9CQUFJLElBQUk7QUFBQSxJQUNqQixtQkFBbUIsb0JBQUksSUFBSTtBQUFBLElBQzNCLGlCQUFpQixvQkFBSSxJQUFJO0FBQUEsSUFDekIsdUJBQXVCO0FBQUEsRUFDekI7QUFDRjtBQUVBLGVBQWUsOEJBQ2IsUUFDQSxVQUNBLGVBQ0EsVUFDQSxTQUNBLE1BQ0EsT0FDaUI7QUFDakIsUUFBTSxRQUFrQixDQUFDO0FBQ3pCLFFBQU0sMEJBQTBCLFFBQVEsVUFBVSxlQUFlLEdBQUcsUUFBUTtBQUFBLEVBQUssT0FBTyxJQUFJLE1BQU0sT0FBTyxLQUFLO0FBQzlHLFFBQU0sWUFBWSw4QkFBOEIsS0FBSztBQUNyRCxTQUFPLENBQUMsR0FBRyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sU0FBUyxFQUNsRCxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUM1QixLQUFLLE1BQU07QUFDaEI7QUFFQSxlQUFlLDBCQUNiLFFBQ0EsVUFDQSxlQUNBLE1BQ0EsTUFDQSxPQUNBLE9BQ2lCO0FBQ2pCLFFBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxRQUFNLGFBQWEsTUFBTSxvQkFBb0IsUUFBUSxJQUFJO0FBQ3pELE1BQUksV0FBVztBQUNmLE1BQUksWUFBWTtBQUNoQixNQUFJLFVBQVU7QUFFZCxTQUFPLFNBQVM7QUFDZCxjQUFVO0FBQ1YsVUFBTSxRQUFRLE1BQU0sbUJBQW1CLFVBQVUsSUFBSTtBQUVyRCxlQUFXLGNBQWMsV0FBVyxhQUFhO0FBQy9DLFVBQUksY0FBYyxZQUFZLGFBQWEsS0FBSyxDQUFDLHVCQUF1QixZQUFZLEtBQUssR0FBRztBQUMxRjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sZUFBZSxPQUFPLFVBQVUsWUFBWSxPQUFPLEtBQUs7QUFDckUsVUFBSSxNQUFNO0FBQ1IsY0FBTSxTQUFTLE1BQU0sMEJBQTBCLFFBQVEsVUFBVSxZQUFZLE1BQU0sTUFBTSxPQUFPLEtBQUs7QUFDckcsb0JBQVk7QUFBQSxFQUFLLElBQUk7QUFBQTtBQUNyQixZQUFJLFFBQVE7QUFDVixzQkFBWTtBQUFBLEVBQUssTUFBTTtBQUFBO0FBQUEsUUFDekI7QUFDQSxxQkFBYSxHQUFHLE1BQU07QUFBQSxFQUFLLElBQUk7QUFBQTtBQUMvQixrQkFBVTtBQUFBLE1BQ1o7QUFBQSxJQUNGO0FBRUEsZUFBVyxjQUFjLFdBQVcsU0FBUztBQUMzQyxZQUFNLE9BQU8sTUFBTSw4QkFBOEIsWUFBWSxPQUFPLFVBQVUsT0FBTyxNQUFNLE9BQU8sS0FBSztBQUN2RyxVQUFJLE1BQU07QUFDUixvQkFBWTtBQUFBLEVBQUssSUFBSTtBQUFBO0FBQ3JCLHFCQUFhLEdBQUcsSUFBSTtBQUFBO0FBQ3BCLGtCQUFVO0FBQUEsTUFDWjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUNUO0FBRUEsZUFBZSw4QkFDYixZQUNBLE9BQ0EsVUFDQSxPQUNBLE1BQ0EsT0FDQSxPQUNpQjtBQUNqQixNQUFJLFdBQVcsU0FBUyxRQUFRO0FBQzlCLFdBQU8sa0NBQWtDLFlBQVksT0FBTyxVQUFVLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFBQSxFQUNqRztBQUVBLFNBQU8sbUNBQW1DLFlBQVksT0FBTyxVQUFVLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFDbEc7QUFFQSxlQUFlLGtDQUNiLFlBQ0EsT0FDQSxVQUNBLE9BQ0EsTUFDQSxPQUNBLE9BQ2lCO0FBQ2pCLFFBQU0sa0JBQWtCLE1BQU0sS0FBSyxvQkFBb0IsVUFBVSxXQUFXLFFBQVEsV0FBVyxLQUFLO0FBQ3BHLE1BQUksUUFBUTtBQUVaLGFBQVcsU0FBUyxXQUFXLE9BQU87QUFDcEMsUUFBSSxNQUFNLFNBQVMsS0FBSztBQUN0QixVQUFJLENBQUMsaUJBQWlCO0FBQ3BCLFlBQUkseUJBQXlCLEtBQUssS0FBSyxvQkFBb0IsT0FBTyxZQUFZLEtBQUssR0FBRztBQUNwRixtQkFBUyxHQUFHLFlBQVksT0FBTyxVQUFVLENBQUM7QUFBQTtBQUFBLFFBQzVDO0FBQ0E7QUFBQSxNQUNGO0FBRUEsWUFBTSxTQUFTLE1BQU0sS0FBSyxTQUFTLGVBQWU7QUFDbEQsVUFBSSxDQUFDLFFBQVE7QUFDWDtBQUFBLE1BQ0Y7QUFDQSxZQUFNLGFBQWEsTUFBTSxvQkFBb0IsUUFBUSxJQUFJO0FBQ3pELGlCQUFXLGNBQWMsV0FBVyxhQUFhO0FBQy9DLFlBQUksQ0FBQyx1QkFBdUIsWUFBWSxLQUFLLEdBQUc7QUFDOUM7QUFBQSxRQUNGO0FBQ0EsaUJBQVMsTUFBTSw0QkFBNEIsaUJBQWlCLFdBQVcsTUFBTSxNQUFNLE9BQU8sS0FBSztBQUFBLE1BQ2pHO0FBQ0E7QUFBQSxJQUNGO0FBRUEsVUFBTSxjQUFjLE1BQU0sVUFBVSxNQUFNO0FBQzFDLFFBQUksQ0FBQyxNQUFNLE1BQU0sU0FBUyxXQUFXLEdBQUc7QUFDdEM7QUFBQSxJQUNGO0FBRUEsVUFBTSxnQkFBZ0IsTUFBTSxLQUFLLG9CQUFvQixVQUFVLGlCQUFpQixXQUFXLFFBQVEsTUFBTSxJQUFJLEdBQUcsV0FBVyxLQUFLO0FBQ2hJLFVBQU0sbUJBQW1CLG1CQUFtQjtBQUM1QyxRQUFJLENBQUMsa0JBQWtCO0FBQ3JCLFVBQUksb0JBQW9CLE9BQU8sWUFBWSxLQUFLLEdBQUc7QUFDakQsaUJBQVMsR0FBRyxZQUFZLE9BQU8sVUFBVSxDQUFDO0FBQUE7QUFBQSxNQUM1QztBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sWUFBWSxNQUFNLDRCQUE0QixrQkFBa0IsTUFBTSxNQUFNLE1BQU0sT0FBTyxLQUFLO0FBQ3BHLFFBQUksV0FBVztBQUNiLGVBQVM7QUFDVCxVQUFJLE1BQU0sVUFBVSxNQUFNLFdBQVcsTUFBTSxNQUFNO0FBQy9DLGlCQUFTLGVBQWUsTUFBTSxNQUFNLE1BQU0sUUFBUSxPQUFPLEtBQUs7QUFBQSxNQUNoRTtBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sZ0JBQWdCLE1BQU0sVUFBVSxNQUFNO0FBQzVDLFVBQU0sbUJBQW1CLE1BQU0sV0FBVyxhQUFhLEtBQUssQ0FBQztBQUM3RCxRQUFJLGlCQUFpQixpQkFBaUIsUUFBUTtBQUM1QyxpQkFBVyxhQUFhLGtCQUFrQjtBQUN4QyxpQkFBUyxNQUFNLDRCQUE0QixlQUFlLFdBQVcsTUFBTSxPQUFPLEtBQUs7QUFDdkYsa0NBQTBCLGVBQWUsV0FBVyxLQUFLO0FBQUEsTUFDM0Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDtBQUVBLGVBQWUsbUNBQ2IsWUFDQSxPQUNBLFVBQ0EsT0FDQSxNQUNBLE9BQ0EsT0FDaUI7QUFDakIsTUFBSSxRQUFRO0FBRVosYUFBVyxTQUFTLFdBQVcsT0FBTztBQUNwQyxVQUFNLFVBQVUsTUFBTSxVQUFVLE1BQU0sS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDO0FBQ3ZELFVBQU0saUJBQWlCLE1BQU0sV0FBVyxPQUFPLEtBQUssQ0FBQztBQUNyRCxVQUFNLGdCQUFnQixNQUFNLE1BQU0sU0FBUyxPQUFPLEtBQUssZUFBZSxTQUFTO0FBQy9FLFFBQUksQ0FBQyxlQUFlO0FBQ2xCO0FBQUEsSUFDRjtBQUVBLFVBQU0sa0JBQWtCLE1BQU0sS0FBSyxvQkFBb0IsVUFBVSxNQUFNLE1BQU0sQ0FBQztBQUM5RSxRQUFJLENBQUMsaUJBQWlCO0FBQ3BCLFVBQUksb0JBQW9CLE9BQU8sWUFBWSxLQUFLLEdBQUc7QUFDakQsaUJBQVMsR0FBRyxZQUFZLE9BQU8sVUFBVSxDQUFDO0FBQUE7QUFBQSxNQUM1QztBQUNBO0FBQUEsSUFDRjtBQUVBLGVBQVcsYUFBYSxnQkFBZ0I7QUFDdEMsZUFBUyxNQUFNLDRCQUE0QixpQkFBaUIsV0FBVyxNQUFNLE9BQU8sS0FBSztBQUN6RixnQ0FBMEIsU0FBUyxXQUFXLEtBQUs7QUFBQSxJQUNyRDtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLDRCQUNiLFVBQ0EsWUFDQSxNQUNBLE9BQ0EsT0FDaUI7QUFDakIsUUFBTSxXQUFXLEdBQUcsUUFBUSxJQUFJLFVBQVU7QUFDMUMsTUFBSSxNQUFNLGdCQUFnQixJQUFJLFFBQVEsR0FBRztBQUN2QyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sU0FBUyxNQUFNLEtBQUssU0FBUyxRQUFRO0FBQzNDLE1BQUksQ0FBQyxRQUFRO0FBQ1gsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLGdCQUFnQixJQUFJLFFBQVE7QUFDbEMsTUFBSTtBQUNGLFVBQU0sUUFBUSxPQUFPLE1BQU0sT0FBTztBQUNsQyxVQUFNLGFBQWEsTUFBTSxvQkFBb0IsUUFBUSxJQUFJO0FBQ3pELFVBQU0sYUFBYSxXQUFXLFlBQVksS0FBSyxDQUFDLGVBQWUsVUFBVSxTQUFTLENBQUMsVUFBVSxJQUFJLEdBQUcsU0FBUyxVQUFVLENBQUM7QUFDeEgsUUFBSSxDQUFDLFlBQVk7QUFDZixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sT0FBTyxZQUFZLE9BQU8sVUFBVTtBQUMxQyxVQUFNLGlCQUFpQixNQUFNLDBCQUEwQixRQUFRLFVBQVUsWUFBWSxNQUFNLE1BQU0sT0FBTyxLQUFLO0FBQzdHLFVBQU0sUUFBUSxlQUFlLE9BQU8sVUFBVSxZQUFZLE9BQU8sS0FBSztBQUN0RSxXQUFPLENBQUMsZ0JBQWdCLEtBQUssRUFBRSxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUFFLEtBQUssSUFBSTtBQUFBLEVBQ3hFLFVBQUU7QUFDQSxVQUFNLGdCQUFnQixPQUFPLFFBQVE7QUFBQSxFQUN2QztBQUNGO0FBRUEsU0FBUyxlQUNQLE9BQ0EsVUFDQSxPQUNBLE9BQ0EsT0FDUTtBQUNSLFFBQU0sTUFBTSxHQUFHLFFBQVEsS0FBSyxNQUFNLFFBQVEsQ0FBQyxLQUFLLE1BQU0sTUFBTSxDQUFDO0FBQzdELE1BQUksTUFBTSxlQUFlLElBQUksR0FBRyxHQUFHO0FBQ2pDLFdBQU87QUFBQSxFQUNUO0FBQ0EsUUFBTSxlQUFlLElBQUksR0FBRztBQUM1QixRQUFNLE9BQU8sWUFBWSxPQUFPLEtBQUs7QUFDckMsUUFBTSxLQUFLLElBQUk7QUFDZixTQUFPO0FBQ1Q7QUFFQSxTQUFTLG9CQUFvQixPQUFpQixPQUFvQixPQUF1QztBQUN2RyxRQUFNLE9BQU8sWUFBWSxPQUFPLEtBQUs7QUFDckMsTUFBSSxNQUFNLGdCQUFnQixJQUFJLElBQUksR0FBRztBQUNuQyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sZ0JBQWdCLElBQUksSUFBSTtBQUM5QixTQUFPO0FBQ1Q7QUFFQSxTQUFTLGVBQWUsTUFBYyxRQUFnQixPQUE4QixPQUF5QjtBQUMzRyxRQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksSUFBSTtBQUM3QixNQUFJLE1BQU0sUUFBUSxJQUFJLEdBQUcsR0FBRztBQUMxQixXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sUUFBUSxJQUFJLEdBQUc7QUFDckIsUUFBTSxPQUFPLEdBQUcsTUFBTSxNQUFNLElBQUk7QUFDaEMsUUFBTSxLQUFLLElBQUk7QUFDZixTQUFPLEdBQUcsSUFBSTtBQUFBO0FBQ2hCO0FBRUEsU0FBUywwQkFBMEIsU0FBaUIsV0FBbUIsT0FBb0M7QUFDekcsUUFBTSx3QkFBd0I7QUFDOUIsUUFBTSxhQUFhLE1BQU0sa0JBQWtCLElBQUksT0FBTyxLQUFLLG9CQUFJLElBQVk7QUFDM0UsYUFBVyxJQUFJLFNBQVM7QUFDeEIsUUFBTSxrQkFBa0IsSUFBSSxTQUFTLFVBQVU7QUFDakQ7QUFFQSxTQUFTLDhCQUE4QixPQUFzQztBQUMzRSxNQUFJLENBQUMsTUFBTSxrQkFBa0IsTUFBTTtBQUNqQyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sUUFBUSxNQUFNLHdCQUF3QixDQUFDLDZCQUE2QixJQUFJLENBQUM7QUFDL0UsYUFBVyxDQUFDLFNBQVMsVUFBVSxLQUFLLE1BQU0sbUJBQW1CO0FBQzNELFVBQU0sS0FBSyxHQUFHLE9BQU8sa0NBQWtDO0FBQ3ZELGVBQVcsYUFBYSxZQUFZO0FBQ2xDLFlBQU0sS0FBSyxHQUFHLE9BQU8sSUFBSSxTQUFTLE1BQU0sU0FBUyxFQUFFO0FBQUEsSUFDckQ7QUFBQSxFQUNGO0FBQ0EsU0FBTyxNQUFNLEtBQUssSUFBSTtBQUN4QjtBQUVBLFNBQVMsc0JBQXNCLFlBQThCLFlBQXdDO0FBQ25HLFFBQU0sUUFBUSxXQUFXLFlBQVksS0FBSyxDQUFDLGdCQUFnQixXQUFXLFNBQVMsQ0FBQyxXQUFXLElBQUksR0FBRyxTQUFTLFVBQVUsQ0FBQztBQUN0SCxTQUFPLFFBQVEsRUFBRSxPQUFPLE1BQU0sT0FBTyxLQUFLLE1BQU0sSUFBSSxJQUFJO0FBQzFEO0FBRUEsU0FBUyx1QkFBdUIsWUFBOEIsT0FBNkI7QUFDekYsVUFBUSxXQUFXLFNBQVMsQ0FBQyxXQUFXLElBQUksR0FBRyxLQUFLLENBQUMsU0FBUyxNQUFNLE1BQU0sU0FBUyxJQUFJLENBQUM7QUFDMUY7QUFFQSxTQUFTLHlCQUF5QixPQUE2QjtBQUM3RCxTQUFPLE1BQU0sTUFBTSxTQUFTO0FBQzlCO0FBRUEsU0FBUyxpQkFBaUIsWUFBb0IsTUFBc0I7QUFDbEUsU0FBTyxhQUFhLEdBQUcsVUFBVSxJQUFJLElBQUksS0FBSztBQUNoRDtBQUVBLGVBQWUsb0JBQW9CLFFBQWdCLE1BQTJEO0FBQzVHLFNBQU8sYUFBK0IsUUFBUSxVQUFVLElBQUk7QUFDOUQ7QUFFQSxlQUFlLG1CQUFtQixRQUFnQixNQUFzRDtBQUN0RyxTQUFPLGFBQTBCLFFBQVEsU0FBUyxJQUFJO0FBQ3hEO0FBRUEsZUFBZSxhQUFnQixRQUFnQixNQUEwQixNQUE0QztBQUNuSCxRQUFNLFVBQVUsaUJBQWlCLEtBQUssa0JBQWtCLEtBQUssS0FBSyxTQUFTO0FBQzNFLFFBQU0sYUFBYSxRQUFRLENBQUMsS0FBSztBQUNqQyxRQUFNLE9BQU8sQ0FBQyxHQUFHLFFBQVEsTUFBTSxDQUFDLEdBQUcsTUFBTSxpQkFBaUI7QUFFMUQsU0FBTyxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDdEMsVUFBTSxZQUFRLDZCQUFNLFlBQVksTUFBTSxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsTUFBTSxFQUFFLENBQUM7QUFDekUsUUFBSSxTQUFTO0FBQ2IsUUFBSSxTQUFTO0FBRWIsVUFBTSxPQUFPLFlBQVksTUFBTTtBQUMvQixVQUFNLE9BQU8sWUFBWSxNQUFNO0FBQy9CLFVBQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxVQUFrQjtBQUN6QyxnQkFBVTtBQUFBLElBQ1osQ0FBQztBQUNELFVBQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxVQUFrQjtBQUN6QyxnQkFBVTtBQUFBLElBQ1osQ0FBQztBQUNELFVBQU0sR0FBRyxTQUFTLE1BQU07QUFDeEIsVUFBTSxHQUFHLFNBQVMsQ0FBQyxTQUFTO0FBQzFCLFVBQUksU0FBUyxHQUFHO0FBQ2QsZUFBTyxJQUFJLE9BQU8sVUFBVSxVQUFVLHNDQUFzQyxJQUFJLEtBQUssS0FBSyxDQUFDLENBQUM7QUFDNUY7QUFBQSxNQUNGO0FBQ0EsVUFBSTtBQUNGLGdCQUFRLEtBQUssTUFBTSxNQUFNLENBQU07QUFBQSxNQUNqQyxTQUFTLE9BQU87QUFDZCxlQUFPLEtBQUs7QUFBQSxNQUNkO0FBQUEsSUFDRixDQUFDO0FBRUQsVUFBTSxNQUFNLElBQUksS0FBSyxVQUFVLEVBQUUsTUFBTSxPQUFPLENBQUMsQ0FBQztBQUFBLEVBQ2xELENBQUM7QUFDSDtBQUVBLFNBQVMsY0FBYyxPQUFpQixXQUFvRDtBQUMxRixRQUFNLFFBQVEsS0FBSyxLQUFLLFVBQVUsYUFBYSxLQUFLLEdBQUcsQ0FBQztBQUN4RCxRQUFNLE1BQU0sS0FBSyxLQUFLLFVBQVUsV0FBVyxVQUFVLGFBQWEsTUFBTSxVQUFVLEdBQUcsTUFBTSxTQUFTLENBQUM7QUFDckcsTUFBSSxRQUFRLE9BQU8sU0FBUyxNQUFNLFFBQVE7QUFDeEMsV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPLEVBQUUsT0FBTyxJQUFJO0FBQ3RCO0FBRUEsU0FBUyxnQkFBZ0IsT0FBaUIsVUFBa0MsWUFBd0M7QUFDbEgsUUFBTSxjQUFjLG1CQUFtQixPQUFPLFFBQVE7QUFDdEQsUUFBTSxRQUFRLFlBQVksS0FBSyxDQUFDLGVBQWUsZ0JBQWdCLFVBQVUsRUFBRSxTQUFTLFVBQVUsQ0FBQztBQUMvRixNQUFJLE9BQU87QUFDVCxXQUFPLEVBQUUsT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLElBQUk7QUFBQSxFQUM5QztBQUVBLFFBQU0sZ0JBQWdCLElBQUksT0FBTyxNQUFNLFlBQVksVUFBVSxDQUFDLEtBQUs7QUFDbkUsUUFBTSxPQUFPLE1BQU0sVUFBVSxDQUFDLGNBQWMsY0FBYyxLQUFLLFNBQVMsQ0FBQztBQUN6RSxNQUFJLE9BQU8sR0FBRztBQUNaLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTyxNQUFNLElBQUksRUFBRSxTQUFTLEdBQUcsSUFBSSxFQUFFLE9BQU8sTUFBTSxLQUFLLGtCQUFrQixPQUFPLElBQUksRUFBRSxJQUFJLEVBQUUsT0FBTyxNQUFNLEtBQUssS0FBSztBQUNySDtBQUVBLFNBQVMsd0JBQXdCLE9BQWlCLFVBQWtDLGVBQTRCLFVBQTBCO0FBQ3hJLFFBQU0sV0FBVyxnQkFBZ0IsT0FBTyxVQUFVLGNBQWMsS0FBSztBQUNyRSxRQUFNLGNBQWMsbUJBQW1CLE9BQU8sUUFBUSxFQUNuRCxPQUFPLENBQUMsZUFBZSxDQUFDLGNBQWMsWUFBWSxhQUFhLENBQUM7QUFDbkUsUUFBTSxzQkFBc0IsaUJBQWlCLFVBQVUsYUFBYSxLQUFLO0FBQ3pFLFNBQU8sQ0FBQyxHQUFHLFVBQVUsR0FBRyxvQkFBb0IsSUFBSSxDQUFDLGVBQWUsWUFBWSxPQUFPLFVBQVUsQ0FBQyxDQUFDLEVBQzVGLE9BQU8sQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQzVCLEtBQUssTUFBTTtBQUNoQjtBQUVBLFNBQVMsaUJBQWlCLE1BQWMsYUFBaUMsT0FBcUM7QUFDNUcsUUFBTSxXQUErQixDQUFDO0FBQ3RDLFFBQU0sZUFBZSxvQkFBSSxJQUFZO0FBQ3JDLE1BQUksV0FBVztBQUNmLE1BQUksVUFBVTtBQUVkLFNBQU8sU0FBUztBQUNkLGNBQVU7QUFDVixlQUFXLGNBQWMsYUFBYTtBQUNwQyxZQUFNLE1BQU0sR0FBRyxXQUFXLEtBQUssSUFBSSxXQUFXLEdBQUcsSUFBSSxXQUFXLElBQUk7QUFDcEUsVUFBSSxhQUFhLElBQUksR0FBRyxHQUFHO0FBQ3pCO0FBQUEsTUFDRjtBQUNBLFVBQUksQ0FBQyxnQkFBZ0IsVUFBVSxFQUFFLEtBQUssQ0FBQyxTQUFTLGVBQWUsVUFBVSxJQUFJLENBQUMsR0FBRztBQUMvRTtBQUFBLE1BQ0Y7QUFDQSxtQkFBYSxJQUFJLEdBQUc7QUFDcEIsZUFBUyxLQUFLLFVBQVU7QUFDeEIsa0JBQVk7QUFBQSxFQUFLLFlBQVksT0FBTyxVQUFVLENBQUM7QUFBQTtBQUMvQyxnQkFBVTtBQUFBLElBQ1o7QUFBQSxFQUNGO0FBRUEsU0FBTyxTQUFTLEtBQUssQ0FBQyxNQUFNLFVBQVUsS0FBSyxRQUFRLE1BQU0sS0FBSztBQUNoRTtBQUVBLFNBQVMsZ0JBQWdCLE9BQWlCLFVBQWtDLFlBQThCO0FBQ3hHLFFBQU0sV0FBcUIsQ0FBQztBQUM1QixRQUFNLE1BQU0sS0FBSyxJQUFJLFlBQVksQ0FBQztBQUNsQyxXQUFTLFFBQVEsR0FBRyxRQUFRLEtBQUssU0FBUyxHQUFHO0FBQzNDLFVBQU0sT0FBTyxNQUFNLEtBQUs7QUFDeEIsUUFBSSxlQUFlLE1BQU0sUUFBUSxHQUFHO0FBQ2xDLGVBQVMsS0FBSyxJQUFJO0FBQUEsSUFDcEI7QUFBQSxFQUNGO0FBQ0EsU0FBTyxTQUFTLFNBQVMsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztBQUNwRDtBQUVBLFNBQVMsZUFBZSxNQUFjLFVBQTJDO0FBQy9FLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFNBQVM7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUNBLFVBQVEsVUFBVTtBQUFBLElBQ2hCLEtBQUs7QUFDSCxhQUFPLHNDQUFzQyxLQUFLLE9BQU87QUFBQSxJQUMzRCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTyxnRkFBZ0YsS0FBSyxPQUFPO0FBQUEsSUFDckcsS0FBSztBQUFBLElBQ0wsS0FBSztBQUFBLElBQ0wsS0FBSztBQUNILGFBQU8sUUFBUSxXQUFXLEdBQUcsS0FBSyxRQUFRLFdBQVcsU0FBUyxLQUFLLFFBQVEsV0FBVyxpQkFBaUI7QUFBQSxJQUN6RyxLQUFLO0FBQ0gsYUFBTyx5QkFBeUIsS0FBSyxPQUFPO0FBQUEsSUFDOUMsS0FBSztBQUNILGFBQU8sZ0NBQWdDLEtBQUssT0FBTztBQUFBLElBQ3JELEtBQUs7QUFDSCxhQUFPLDBCQUEwQixLQUFLLE9BQU87QUFBQSxJQUMvQztBQUNFLGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFFQSxTQUFTLG1CQUFtQixPQUFpQixVQUFzRDtBQUNqRyxVQUFRLFVBQVU7QUFBQSxJQUNoQixLQUFLO0FBQ0gsYUFBTyx5QkFBeUIsS0FBSztBQUFBLElBQ3ZDLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPLHdCQUF3QixPQUFPLG1LQUFtSztBQUFBLElBQzNNLEtBQUs7QUFDSCxhQUFPLG9CQUFvQixPQUFPLEtBQUs7QUFBQSxJQUN6QyxLQUFLO0FBQ0gsYUFBTyxvQkFBb0IsT0FBTyxJQUFJO0FBQUEsSUFDeEMsS0FBSztBQUNILGFBQU8sMEJBQTBCLEtBQUs7QUFBQSxJQUN4QyxLQUFLO0FBQ0gsYUFBTyx3QkFBd0IsS0FBSztBQUFBLElBQ3RDLEtBQUs7QUFDSCxhQUFPLHdCQUF3QixPQUFPLHVPQUF1TztBQUFBLElBQy9RLEtBQUs7QUFDSCxhQUFPLHVCQUF1QixLQUFLO0FBQUEsSUFDckM7QUFDRSxhQUFPLENBQUM7QUFBQSxFQUNaO0FBQ0Y7QUFFQSxTQUFTLHlCQUF5QixPQUFxQztBQUNyRSxRQUFNLGNBQWtDLENBQUM7QUFDekMsV0FBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3BELFVBQU0sYUFBYSxNQUFNLEtBQUssRUFBRSxNQUFNLHdCQUF3QjtBQUM5RCxRQUFJLFlBQVk7QUFDZCxrQkFBWSxLQUFLLEVBQUUsTUFBTSxXQUFXLENBQUMsR0FBRyxPQUFPLE9BQU8sS0FBSyxNQUFNLENBQUM7QUFDbEU7QUFBQSxJQUNGO0FBRUEsVUFBTSxRQUFRLE1BQU0sS0FBSyxFQUFFLE1BQU0scURBQXFEO0FBQ3RGLFFBQUksQ0FBQyxPQUFPO0FBQ1Y7QUFBQSxJQUNGO0FBQ0EsVUFBTSxTQUFTLE1BQU0sQ0FBQyxFQUFFO0FBQ3hCLFFBQUksUUFBUTtBQUNaLFdBQU8sUUFBUSxLQUFLLE1BQU0sUUFBUSxDQUFDLEVBQUUsS0FBSyxFQUFFLFdBQVcsR0FBRyxLQUFLLFVBQVUsTUFBTSxRQUFRLENBQUMsQ0FBQyxNQUFNLFFBQVE7QUFDckcsZUFBUztBQUFBLElBQ1g7QUFDQSxRQUFJLE1BQU07QUFDVixhQUFTLFNBQVMsUUFBUSxHQUFHLFNBQVMsTUFBTSxRQUFRLFVBQVUsR0FBRztBQUMvRCxVQUFJLE1BQU0sTUFBTSxFQUFFLEtBQUssS0FBSyxVQUFVLE1BQU0sTUFBTSxDQUFDLEtBQUssUUFBUTtBQUM5RDtBQUFBLE1BQ0Y7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUNBLGdCQUFZLEtBQUssRUFBRSxNQUFNLE1BQU0sQ0FBQyxHQUFHLE9BQU8sSUFBSSxDQUFDO0FBQUEsRUFDakQ7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLG9CQUFvQixPQUFpQixPQUFvQztBQUNoRixRQUFNLGNBQWtDLENBQUM7QUFDekMsTUFBSSxRQUFRO0FBRVosV0FBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3BELFVBQU0sT0FBTyxNQUFNLEtBQUs7QUFDeEIsVUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixVQUFNLFdBQVcsVUFBVTtBQUUzQixRQUFJLFlBQVksU0FBUztBQUN2QixZQUFNLFFBQVEsUUFBUSxNQUFNLGdDQUFnQztBQUM1RCxVQUFJLE9BQU87QUFDVCxvQkFBWSxLQUFLLEVBQUUsTUFBTSxNQUFNLENBQUMsR0FBRyxPQUFPLE9BQU8sS0FBSyxNQUFNLENBQUM7QUFBQSxNQUMvRCxXQUFXLENBQUMsUUFBUSxXQUFXLEdBQUcsS0FBSyxDQUFDLGVBQWUsT0FBTyxHQUFHO0FBQy9ELGNBQU0saUJBQWlCLHFCQUFxQixPQUFPLE9BQU8sS0FBSztBQUMvRCxZQUFJLGdCQUFnQjtBQUNsQixzQkFBWSxLQUFLLGNBQWM7QUFDL0Isa0JBQVEsS0FBSyxJQUFJLE9BQU8sZUFBZSxHQUFHO0FBQUEsUUFDNUMsT0FBTztBQUNMLGdCQUFNLHFCQUFxQix5QkFBeUIsT0FBTyxLQUFLO0FBQ2hFLGNBQUksb0JBQW9CO0FBQ3RCLHdCQUFZLEtBQUssa0JBQWtCO0FBQ25DLG9CQUFRLEtBQUssSUFBSSxPQUFPLG1CQUFtQixHQUFHO0FBQUEsVUFDaEQsT0FBTztBQUNMLGtCQUFNLG1CQUFtQix1QkFBdUIsTUFBTSxLQUFLO0FBQzNELGdCQUFJLGtCQUFrQjtBQUNwQiwwQkFBWSxLQUFLLGdCQUFnQjtBQUFBLFlBQ25DO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLGFBQVMsV0FBVyxJQUFJO0FBQ3hCLFFBQUksUUFBUSxHQUFHO0FBQ2IsY0FBUTtBQUFBLElBQ1Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUNUO0FBRUEsU0FBUyxxQkFBcUIsT0FBaUIsT0FBZSxPQUF5QztBQUNyRyxRQUFNLFNBQVMsTUFBTSxNQUFNLE9BQU8sS0FBSyxJQUFJLE1BQU0sUUFBUSxRQUFRLENBQUMsQ0FBQyxFQUFFLEtBQUssR0FBRztBQUM3RSxRQUFNLGlCQUFpQixRQUFRLGdEQUFnRDtBQUMvRSxRQUFNLFFBQVEsT0FBTyxNQUFNLElBQUksT0FBTyxRQUFRLGNBQWMsd0JBQXdCLENBQUM7QUFDckYsUUFBTSxtQkFBbUIsT0FBTyxNQUFNLHNFQUFzRTtBQUM1RyxRQUFNLE9BQU8sUUFBUSxDQUFDLEtBQUssbUJBQW1CLENBQUM7QUFDL0MsTUFBSSxDQUFDLE1BQU07QUFDVCxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sTUFBTSxvQkFBb0IsT0FBTyxLQUFLO0FBQzVDLFNBQU8sRUFBRSxNQUFNLE9BQU8sQ0FBQyxJQUFJLEdBQUcsT0FBTyxJQUFJO0FBQzNDO0FBRUEsU0FBUyx5QkFBeUIsT0FBaUIsT0FBd0M7QUFDekYsUUFBTSxjQUFjLE1BQU0sTUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLFFBQVEsUUFBUSxFQUFFLENBQUM7QUFDekUsUUFBTSxTQUFTLFlBQVksS0FBSyxHQUFHO0FBQ25DLFFBQU0sY0FBYyxZQUFZLFVBQVUsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLENBQUM7QUFDdEUsTUFBSSxjQUFjLEtBQUssT0FBTyxRQUFRLEdBQUcsS0FBSyxLQUFLLE9BQU8sUUFBUSxHQUFHLElBQUksT0FBTyxRQUFRLEdBQUcsR0FBRztBQUM1RixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sVUFBVSxDQUFDLEdBQUcsT0FBTyxTQUFTLGlJQUFpSSxDQUFDO0FBQ3RLLFFBQU0sT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsUUFBUSxRQUFRLEVBQUU7QUFDaEQsTUFBSSxDQUFDLFFBQVEsa0JBQWtCLElBQUksR0FBRztBQUNwQyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sWUFBWSxRQUFRO0FBQzFCLFFBQU0sWUFBWSxLQUFLLFNBQVMsSUFBSSxJQUFJLEtBQUssTUFBTSxJQUFJLEVBQUUsSUFBSSxLQUFLLE9BQU87QUFDekUsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTyxDQUFDLEdBQUcsb0JBQUksSUFBSSxDQUFDLFdBQVcsSUFBSSxDQUFDLENBQUM7QUFBQSxJQUNyQztBQUFBLElBQ0EsS0FBSyxrQkFBa0IsT0FBTyxTQUFTO0FBQUEsRUFDekM7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE1BQWMsT0FBd0M7QUFDcEYsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixNQUFJLENBQUMsUUFBUSxTQUFTLEdBQUcsS0FBSyxRQUFRLFNBQVMsR0FBRyxLQUFLLHVDQUF1QyxLQUFLLE9BQU8sR0FBRztBQUMzRyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0scUJBQXFCLFFBQVEsTUFBTSxHQUFHLEVBQUUsQ0FBQyxFQUFFLFFBQVEsY0FBYyxFQUFFO0FBQ3pFLFFBQU0sUUFBUSxtQkFBbUIsTUFBTSw4QkFBOEIsR0FBRyxJQUFJLEdBQUcsTUFBTSxnQkFBZ0I7QUFDckcsUUFBTSxPQUFPLFFBQVEsQ0FBQztBQUN0QixNQUFJLENBQUMsUUFBUSw4RkFBOEYsS0FBSyxJQUFJLEdBQUc7QUFDckgsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLEVBQUUsTUFBTSxPQUFPLE9BQU8sS0FBSyxNQUFNO0FBQzFDO0FBRUEsU0FBUyx1QkFBdUIsT0FBcUM7QUFDbkUsUUFBTSxjQUFrQyxDQUFDO0FBQ3pDLFdBQVMsUUFBUSxHQUFHLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUNwRCxVQUFNLE9BQU8sTUFBTSxLQUFLO0FBQ3hCLFVBQU0sU0FBUyxLQUFLLE1BQU0sZ0VBQWdFO0FBQzFGLFFBQUksUUFBUTtBQUNWLFlBQU0sTUFBTSxLQUFLLFVBQVUsRUFBRSxXQUFXLFFBQVEsSUFBSSxrQkFBa0IsT0FBTyxLQUFLLElBQUk7QUFDdEYsa0JBQVksS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsRUFBRSxHQUFHLE9BQU8sT0FBTyxJQUFJLENBQUM7QUFDNUY7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLEtBQUssTUFBTSx5Q0FBeUM7QUFDbkUsUUFBSSxRQUFRO0FBQ1Ysa0JBQVksS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsRUFBRSxHQUFHLE9BQU8sT0FBTyxLQUFLLE1BQU0sQ0FBQztBQUFBLElBQ3JHO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsMEJBQTBCLE9BQXFDO0FBQ3RFLFFBQU0sY0FBa0MsQ0FBQztBQUN6QyxXQUFTLFFBQVEsR0FBRyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDcEQsVUFBTSxVQUFVLE1BQU0sS0FBSyxFQUFFLEtBQUs7QUFDbEMsUUFBSSxDQUFDLFdBQVcsVUFBVSxNQUFNLEtBQUssQ0FBQyxJQUFJLEtBQUsscUJBQXFCLEtBQUssT0FBTyxHQUFHO0FBQ2pGO0FBQUEsSUFDRjtBQUVBLFVBQU0sUUFBUSwwQkFBMEIsT0FBTztBQUMvQyxRQUFJLENBQUMsTUFBTSxRQUFRO0FBQ2pCO0FBQUEsSUFDRjtBQUVBLFVBQU0sTUFBTSxvQkFBb0IsT0FBTyxPQUFPLE1BQU0sQ0FBQyxDQUFDO0FBQ3RELGdCQUFZLEtBQUssRUFBRSxNQUFNLE1BQU0sQ0FBQyxHQUFHLE9BQU8sT0FBTyxPQUFPLElBQUksQ0FBQztBQUM3RCxZQUFRO0FBQUEsRUFDVjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsd0JBQXdCLE9BQXFDO0FBQ3BFLFFBQU0sY0FBa0MsQ0FBQztBQUN6QyxXQUFTLFFBQVEsR0FBRyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDcEQsVUFBTSxVQUFVLE1BQU0sS0FBSyxFQUFFLEtBQUs7QUFDbEMsUUFBSSxDQUFDLFdBQVcsVUFBVSxNQUFNLEtBQUssQ0FBQyxJQUFJLEtBQUsseUJBQXlCLEtBQUssT0FBTyxHQUFHO0FBQ3JGO0FBQUEsSUFDRjtBQUVBLFVBQU0sUUFBUSx3QkFBd0IsT0FBTztBQUM3QyxRQUFJLENBQUMsTUFBTSxRQUFRO0FBQ2pCO0FBQUEsSUFDRjtBQUVBLFVBQU0sTUFBTSxtQkFBbUIsT0FBTyxPQUFPLG9CQUFvQjtBQUNqRSxnQkFBWSxLQUFLLEVBQUUsTUFBTSxNQUFNLENBQUMsR0FBRyxPQUFPLE9BQU8sT0FBTyxJQUFJLENBQUM7QUFDN0QsWUFBUTtBQUFBLEVBQ1Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLHdCQUF3QixPQUFpQixTQUFxQztBQUNyRixRQUFNLGNBQWtDLENBQUM7QUFDekMsV0FBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3BELFVBQU0sUUFBUSxNQUFNLEtBQUssRUFBRSxNQUFNLE9BQU87QUFDeEMsVUFBTSxPQUFPLE9BQU8sTUFBTSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQ3pDLFFBQUksQ0FBQyxNQUFNO0FBQ1Q7QUFBQSxJQUNGO0FBQ0EsZ0JBQVksS0FBSyxFQUFFLE1BQU0sT0FBTyxPQUFPLEtBQUssa0JBQWtCLE9BQU8sS0FBSyxFQUFFLENBQUM7QUFBQSxFQUMvRTtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsa0JBQWtCLE9BQWlCLE9BQXVCO0FBQ2pFLE1BQUksQ0FBQyxNQUFNLEtBQUssRUFBRSxTQUFTLEdBQUcsR0FBRztBQUMvQixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksUUFBUTtBQUNaLE1BQUksV0FBVztBQUNmLFdBQVMsUUFBUSxPQUFPLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUN4RCxlQUFXLFFBQVEsTUFBTSxLQUFLLEdBQUc7QUFDL0IsVUFBSSxTQUFTLEtBQUs7QUFDaEIsaUJBQVM7QUFDVCxtQkFBVztBQUFBLE1BQ2IsV0FBVyxTQUFTLEtBQUs7QUFDdkIsaUJBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRjtBQUNBLFFBQUksWUFBWSxTQUFTLEdBQUc7QUFDMUIsYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxvQkFBb0IsT0FBaUIsT0FBdUI7QUFDbkUsTUFBSSxXQUFXO0FBQ2YsTUFBSSxRQUFRO0FBQ1osV0FBUyxRQUFRLE9BQU8sUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3hELGVBQVcsUUFBUSxNQUFNLEtBQUssR0FBRztBQUMvQixVQUFJLFNBQVMsS0FBSztBQUNoQixpQkFBUztBQUNULG1CQUFXO0FBQUEsTUFDYixXQUFXLFNBQVMsS0FBSztBQUN2QixpQkFBUztBQUFBLE1BQ1g7QUFBQSxJQUNGO0FBRUEsU0FBSyxDQUFDLFlBQVksU0FBUyxNQUFNLE1BQU0sS0FBSyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQzNELGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsV0FBVyxNQUFzQjtBQUN4QyxNQUFJLFFBQVE7QUFDWixhQUFXLFFBQVEsTUFBTTtBQUN2QixRQUFJLFNBQVMsS0FBSztBQUNoQixlQUFTO0FBQUEsSUFDWCxXQUFXLFNBQVMsS0FBSztBQUN2QixlQUFTO0FBQUEsSUFDWDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGVBQWUsU0FBMEI7QUFDaEQsU0FBTyxRQUFRLFdBQVcsSUFBSSxLQUFLLFFBQVEsV0FBVyxJQUFJLEtBQUssUUFBUSxXQUFXLEdBQUc7QUFDdkY7QUFFQSxTQUFTLGtCQUFrQixNQUF1QjtBQUNoRCxTQUFPLENBQUMsTUFBTSxPQUFPLFNBQVMsVUFBVSxPQUFPLEVBQUUsU0FBUyxJQUFJO0FBQ2hFO0FBRUEsU0FBUywwQkFBMEIsU0FBMkI7QUFDNUQsUUFBTSxZQUFZLFFBQVEsTUFBTSxzQkFBc0I7QUFDdEQsTUFBSSxXQUFXO0FBQ2IsV0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQUEsRUFDdEI7QUFFQSxRQUFNLFVBQVUsUUFBUSxNQUFNLHNCQUFzQjtBQUNwRCxNQUFJLFNBQVM7QUFDWCxXQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7QUFBQSxFQUNwQjtBQUVBLFFBQU0sV0FBVyxRQUFRLE1BQU0sZ0RBQWdEO0FBQy9FLE1BQUksVUFBVTtBQUNaLFdBQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUFBLEVBQ3JCO0FBRUEsUUFBTSxXQUFXLFFBQVEsTUFBTSxpQ0FBaUM7QUFDaEUsU0FBTyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQ3JDO0FBRUEsU0FBUyx3QkFBd0IsU0FBMkI7QUFDMUQsUUFBTSxhQUFhLFFBQVEsTUFBTSxrREFBa0Q7QUFDbkYsTUFBSSxZQUFZO0FBQ2QsV0FBTyxDQUFDLFdBQVcsQ0FBQyxLQUFLLFdBQVcsQ0FBQyxDQUFDO0FBQUEsRUFDeEM7QUFFQSxRQUFNLGNBQWMsUUFBUSxNQUFNLHdCQUF3QjtBQUMxRCxNQUFJLGFBQWE7QUFDZixXQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7QUFBQSxFQUN4QjtBQUVBLFFBQU0sZ0JBQWdCLFFBQVEsTUFBTSx5QkFBeUI7QUFDN0QsTUFBSSxlQUFlO0FBQ2pCLFdBQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUFBLEVBQzFCO0FBRUEsU0FBTyxDQUFDO0FBQ1Y7QUFFQSxTQUFTLG1CQUFtQixPQUFpQixPQUFlLGlCQUFvRDtBQUM5RyxNQUFJLE1BQU07QUFDVixXQUFTLFFBQVEsUUFBUSxHQUFHLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUM1RCxVQUFNLE9BQU8sTUFBTSxLQUFLO0FBQ3hCLFFBQUksS0FBSyxLQUFLLEtBQUssVUFBVSxJQUFJLE1BQU0sS0FBSyxnQkFBZ0IsS0FBSyxLQUFLLENBQUMsR0FBRztBQUN4RTtBQUFBLElBQ0Y7QUFDQSxVQUFNO0FBQUEsRUFDUjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsb0JBQW9CLE9BQWlCLE9BQWUsTUFBc0I7QUFDakYsTUFBSSxNQUFNO0FBQ1YsTUFBSSx3QkFBd0IsTUFBTSxLQUFLLEVBQUUsS0FBSyxFQUFFLFdBQVcsR0FBRyxJQUFJLEtBQUs7QUFDdkUsV0FBUyxRQUFRLFFBQVEsR0FBRyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDNUQsVUFBTSxPQUFPLE1BQU0sS0FBSztBQUN4QixVQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFFBQUksV0FBVyxVQUFVLElBQUksTUFBTSxLQUFLLHVCQUF1QixPQUFPLEdBQUc7QUFDdkUsVUFBSSx5QkFBeUIsUUFBUSxXQUFXLEdBQUcsSUFBSSxHQUFHLEtBQUssUUFBUSxTQUFTLEdBQUcsR0FBRztBQUNwRixnQ0FBd0I7QUFDeEIsY0FBTTtBQUNOO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFVBQU07QUFBQSxFQUNSO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyx1QkFBdUIsU0FBMEI7QUFDeEQsU0FBTyxzREFBc0QsS0FBSyxPQUFPLEtBQ3BFLDZCQUE2QixLQUFLLE9BQU87QUFDaEQ7QUFFQSxTQUFTLHFCQUFxQixTQUEwQjtBQUN0RCxTQUFPLHlDQUF5QyxLQUFLLE9BQU87QUFDOUQ7QUFFQSxTQUFTLFlBQVksT0FBaUIsT0FBNEI7QUFDaEUsU0FBTyxNQUFNLE1BQU0sTUFBTSxPQUFPLE1BQU0sTUFBTSxDQUFDLEVBQUUsS0FBSyxJQUFJO0FBQzFEO0FBRUEsU0FBUyxjQUFjLE1BQW1CLE9BQTZCO0FBQ3JFLFNBQU8sS0FBSyxTQUFTLE1BQU0sT0FBTyxNQUFNLFNBQVMsS0FBSztBQUN4RDtBQUVBLFNBQVMsVUFBVSxNQUFzQjtBQUN2QyxTQUFPLEtBQUssTUFBTSxNQUFNLElBQUksQ0FBQyxFQUFFLFVBQVU7QUFDM0M7QUFFQSxTQUFTLFlBQVksT0FBdUI7QUFDMUMsU0FBTyxNQUFNLFFBQVEsdUJBQXVCLE1BQU07QUFDcEQ7QUFFQSxTQUFTLGdCQUFnQixZQUF3QztBQUMvRCxTQUFPLFdBQVcsT0FBTyxTQUFTLFdBQVcsUUFBUSxDQUFDLFdBQVcsSUFBSTtBQUN2RTtBQUVBLFNBQVMsZUFBZSxRQUFnQixNQUF1QjtBQUM3RCxNQUFJLEtBQUssV0FBVyxHQUFHLEdBQUc7QUFDeEIsV0FBTyxJQUFJLE9BQU8sR0FBRyxZQUFZLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxNQUFNO0FBQUEsRUFDMUQ7QUFDQSxTQUFPLElBQUksT0FBTyxNQUFNLFlBQVksSUFBSSxDQUFDLEtBQUssRUFBRSxLQUFLLE1BQU07QUFDN0Q7QUFFQSxTQUFTLHdCQUF3QixXQUFnQyxPQUFtQztBQUNsRyxNQUFJLFVBQVUsWUFBWTtBQUN4QixXQUFPLEdBQUcsVUFBVSxRQUFRLElBQUksVUFBVSxVQUFVO0FBQUEsRUFDdEQ7QUFDQSxNQUFJLE9BQU87QUFDVCxXQUFPLEdBQUcsVUFBVSxRQUFRLEtBQUssTUFBTSxRQUFRLENBQUMsS0FBSyxNQUFNLE1BQU0sQ0FBQztBQUFBLEVBQ3BFO0FBQ0EsU0FBTyxVQUFVO0FBQ25CO0FBRUEsSUFBTSxvQkFBb0IsT0FBTztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUN4c0MxQixTQUFTLDRCQUE0QixPQUE4QjtBQUN4RSxRQUFNLE9BQU8sTUFBTSxpQkFBaUI7QUFDcEMsTUFBSSxDQUFDLE1BQU07QUFDVCxXQUFPLE1BQU07QUFBQSxFQUNmO0FBRUEsUUFBTSxhQUFhLE1BQU0saUJBQWlCLFlBQVksS0FBSztBQUMzRCxRQUFNLFFBQVEsTUFBTSxRQUFRLEtBQUs7QUFDakMsUUFBTSxhQUFhLEtBQUssWUFBWSxLQUFLLElBQ3JDLHlCQUF5QixLQUFLLFlBQVksT0FBTyxVQUFVLElBQzNELHdCQUF3QixZQUFZLEtBQUssTUFBTSxLQUFLO0FBRXhELFNBQU8sMEJBQTBCLE1BQU0sVUFBVSxZQUFZLEtBQUssS0FBSztBQUN6RTtBQUVBLFNBQVMsd0JBQXdCLFlBQWdDLE1BQTBCLE9BQXVCO0FBQ2hILE1BQUksQ0FBQyxZQUFZO0FBQ2YsVUFBTSxJQUFJLE1BQU0sa0VBQWtFO0FBQUEsRUFDcEY7QUFFQSxRQUFNLGVBQWUseUJBQXlCLE1BQU0sS0FBSyxLQUFLLFdBQVcsT0FBTyxVQUFVO0FBQzFGLFNBQU8sR0FBRyxVQUFVLElBQUksWUFBWTtBQUN0QztBQUVBLFNBQVMseUJBQXlCLFVBQWtCLE9BQWUsWUFBd0M7QUFDekcsU0FBTyxTQUNKLFdBQVcsV0FBVyxLQUFLLEVBQzNCLFdBQVcsWUFBWSxjQUFjLEVBQUU7QUFDNUM7QUFFQSxTQUFTLDBCQUEwQixVQUFrQixZQUFvQixPQUF3QjtBQUMvRixNQUFJLENBQUMsT0FBTztBQUNWLFdBQU8sMEJBQTBCLFVBQVUsVUFBVTtBQUFBLEVBQ3ZEO0FBRUEsVUFBUSxVQUFVO0FBQUEsSUFDaEIsS0FBSztBQUNILGFBQU8sU0FBUyxVQUFVO0FBQUEsSUFDNUIsS0FBSztBQUFBLElBQ0wsS0FBSztBQUNILGFBQU8sZUFBZSxVQUFVO0FBQUEsSUFDbEMsS0FBSztBQUNILGFBQU87QUFBQSxtQ0FBd0QsVUFBVTtBQUFBLElBQzNFLEtBQUs7QUFDSCxhQUFPO0FBQUEsNkJBQW1ELFVBQVU7QUFBQSxJQUN0RSxLQUFLO0FBQ0gsYUFBTywyQkFBMkIsVUFBVTtBQUFBLElBQzlDO0FBQ0UsWUFBTSxJQUFJLE1BQU0sbURBQW1ELFFBQVEsZ0VBQWdFO0FBQUEsRUFDL0k7QUFDRjtBQUVBLFNBQVMsMEJBQTBCLFVBQWtCLFlBQTRCO0FBQy9FLFVBQVEsVUFBVTtBQUFBLElBQ2hCLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVDtBQUNFLGFBQU8sV0FBVyxTQUFTLEdBQUcsSUFBSSxhQUFhLEdBQUcsVUFBVTtBQUFBLEVBQ2hFO0FBQ0Y7OztBQzlEQSxJQUFBQyxtQkFBd0I7QUFTakIsU0FBUyx1QkFDZCxTQUNBLFdBQ0EsVUFDZ0I7QUFDaEIsUUFBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLFVBQVEsWUFBWTtBQUNwQixVQUFRLFFBQVEsY0FBYztBQUU5QixVQUFRLFlBQVksYUFBYSxhQUFhLFlBQVksa0JBQWtCLFFBQVEsU0FBUyxPQUFPLFNBQVMsQ0FBQztBQUM5RyxVQUFRLFlBQVksYUFBYSxhQUFhLFFBQVEsU0FBUyxRQUFRLEtBQUssQ0FBQztBQUM3RSxVQUFRLFlBQVksYUFBYSxrQkFBa0IsV0FBVyxTQUFTLFVBQVUsS0FBSyxDQUFDO0FBQ3ZGLFVBQVEsWUFBWSxhQUFhLGlCQUFpQixxQkFBcUIsU0FBUyxnQkFBZ0IsS0FBSyxDQUFDO0FBRXRHLFNBQU87QUFDVDtBQUVBLFNBQVMsYUFBYSxPQUFlLFVBQWtCLFNBQXFCLFVBQXNDO0FBQ2hILFFBQU0sU0FBUyxTQUFTLGNBQWMsUUFBUTtBQUM5QyxTQUFPLFlBQVksc0JBQXNCLFdBQVcsZ0JBQWdCLEVBQUU7QUFDdEUsU0FBTyxPQUFPO0FBQ2QsU0FBTyxhQUFhLGNBQWMsS0FBSztBQUN2QyxTQUFPLGlCQUFpQixTQUFTLENBQUMsVUFBVTtBQUMxQyxVQUFNLGVBQWU7QUFDckIsVUFBTSxnQkFBZ0I7QUFDdEIsWUFBUTtBQUFBLEVBQ1YsQ0FBQztBQUNELGdDQUFRLFFBQVEsUUFBUTtBQUN4QixTQUFPO0FBQ1Q7OztBQ3RDQSxJQUFBQyxtQkFBd0I7QUFHeEIsU0FBUyxjQUFjLFFBQTZEO0FBQ2xGLE1BQUksT0FBTyxPQUFPLFNBQVM7QUFDekIsV0FBTyxPQUFPLE9BQU8sT0FBTyxLQUFLLEtBQUssT0FBTyxPQUFPLFNBQVMsS0FBSyxJQUFJLFlBQVk7QUFBQSxFQUNwRjtBQUVBLFNBQU87QUFDVDtBQUVPLFNBQVMsa0JBQWtCLFFBQTBDO0FBQzFFLFFBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxRQUFNLFlBQVksd0JBQXdCLGNBQWMsTUFBTSxDQUFDLEdBQUcsT0FBTyxVQUFVLEtBQUssWUFBWTtBQUNwRyxRQUFNLFFBQVEsY0FBYyxPQUFPO0FBQ25DLG9CQUFrQixPQUFPLE1BQU07QUFDL0IsU0FBTztBQUNUO0FBRU8sU0FBUyxrQkFBa0IsT0FBb0IsUUFBZ0M7QUFDcEYsUUFBTSxPQUFPLGNBQWMsTUFBTTtBQUNqQyxRQUFNLFlBQVksd0JBQXdCLElBQUksR0FBRyxPQUFPLFVBQVUsS0FBSyxZQUFZLEdBQUcsT0FBTyxZQUFZLGtCQUFrQixFQUFFO0FBQzdILFFBQU0sTUFBTTtBQUVaLFFBQU0sU0FBUyxNQUFNLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBQzVELFFBQU0sUUFBUSxPQUFPLFVBQVUsRUFBRSxLQUFLLG9CQUFvQixDQUFDO0FBQzNELGdDQUFRLE9BQU8sU0FBUyxZQUFZLG1CQUFtQixTQUFTLFlBQVksbUJBQW1CLFVBQVU7QUFFekcsUUFBTSxRQUFRLE9BQU8sVUFBVSxFQUFFLEtBQUssb0JBQW9CLENBQUM7QUFDM0QsUUFBTSxRQUFRLEdBQUcsT0FBTyxPQUFPLFVBQVUsY0FBVyxPQUFPLE9BQU8sWUFBWSxHQUFHLEVBQUU7QUFFbkYsUUFBTSxPQUFPLE9BQU8sVUFBVSxFQUFFLEtBQUssbUJBQW1CLENBQUM7QUFDekQsT0FBSyxRQUFRLEdBQUcsT0FBTyxPQUFPLFVBQVUsWUFBUyxJQUFJLEtBQUssT0FBTyxPQUFPLFVBQVUsRUFBRSxtQkFBbUIsQ0FBQyxFQUFFO0FBRTFHLFFBQU0sT0FBTyxNQUFNLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixDQUFDO0FBQ3hELE1BQUksT0FBTyxPQUFPLE9BQU8sS0FBSyxHQUFHO0FBQy9CLGlCQUFhLE1BQU0sVUFBVSxPQUFPLE9BQU8sTUFBTTtBQUFBLEVBQ25EO0FBQ0EsTUFBSSxPQUFPLE9BQU8sU0FBUyxLQUFLLEdBQUc7QUFDakMsaUJBQWEsTUFBTSxXQUFXLE9BQU8sT0FBTyxPQUFPO0FBQUEsRUFDckQ7QUFDQSxNQUFJLE9BQU8sT0FBTyxPQUFPLEtBQUssR0FBRztBQUMvQixpQkFBYSxNQUFNLFVBQVUsT0FBTyxPQUFPLE1BQU07QUFBQSxFQUNuRDtBQUNBLE1BQUksT0FBTyxlQUFlLFFBQVEsS0FBSyxHQUFHO0FBQ3hDLHdCQUFvQixNQUFNLE9BQU8sYUFBYTtBQUFBLEVBQ2hEO0FBQ0EsTUFBSSxDQUFDLE9BQU8sT0FBTyxPQUFPLEtBQUssS0FBSyxDQUFDLE9BQU8sT0FBTyxTQUFTLEtBQUssS0FBSyxDQUFDLE9BQU8sT0FBTyxPQUFPLEtBQUssS0FBSyxDQUFDLE9BQU8sZUFBZSxRQUFRLEtBQUssR0FBRztBQUMzSSxVQUFNLFFBQVEsS0FBSyxVQUFVLEVBQUUsS0FBSyxvQkFBb0IsQ0FBQztBQUN6RCxVQUFNLFFBQVEsV0FBVztBQUFBLEVBQzNCO0FBQ0Y7QUFFQSxTQUFTLGFBQWEsV0FBd0IsT0FBZSxTQUF1QjtBQUNsRixRQUFNLFVBQVUsVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNqRSxVQUFRLFVBQVUsRUFBRSxLQUFLLDRCQUE0QixNQUFNLE1BQU0sQ0FBQztBQUNsRSxVQUFRLFNBQVMsT0FBTyxFQUFFLEtBQUssbUJBQW1CLE1BQU0sUUFBUSxDQUFDO0FBQ25FO0FBRUEsU0FBUyxvQkFBb0IsV0FBd0IsU0FBK0Q7QUFDbEgsUUFBTSxVQUFVLFVBQVUsU0FBUyxXQUFXLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQztBQUM1RSxVQUFRLE9BQU8sUUFBUTtBQUN2QixRQUFNLFVBQVUsUUFBUSxTQUFTLFdBQVcsRUFBRSxLQUFLLDhCQUE4QixDQUFDO0FBQ2xGLFVBQVEsV0FBVyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDL0MsVUFBUSxXQUFXLEVBQUUsS0FBSyw0QkFBNEIsTUFBTSx3QkFBd0IsT0FBTyxFQUFFLENBQUM7QUFDOUYsVUFBUSxTQUFTLE9BQU8sRUFBRSxLQUFLLDJDQUEyQyxNQUFNLFFBQVEsUUFBUSxDQUFDO0FBQ25HO0FBRUEsU0FBUyx3QkFBd0IsU0FBaUU7QUFDaEcsUUFBTSxhQUFhLFFBQVE7QUFDM0IsTUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLHdCQUF3QjtBQUNsRCxXQUFPLEdBQUcsUUFBUSxRQUFRLFNBQU0sUUFBUSxXQUFXO0FBQUEsRUFDckQ7QUFDQSxTQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixRQUFRO0FBQUEsSUFDUixXQUFXLFdBQVcsZ0JBQWdCO0FBQUEsSUFDdEMsUUFBUSxXQUFXLGlCQUFpQjtBQUFBLElBQ3BDLFFBQVEsV0FBVyxXQUFXO0FBQUEsRUFDaEMsRUFBRSxLQUFLLFFBQUs7QUFDZDtBQUVPLFNBQVMscUJBQXFDO0FBQ25ELFFBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxRQUFNLFlBQVk7QUFFbEIsUUFBTSxTQUFTLE1BQU0sVUFBVSxFQUFFLEtBQUsscUJBQXFCLENBQUM7QUFDNUQsUUFBTSxVQUFVLE9BQU8sVUFBVSxFQUFFLEtBQUssZUFBZSxDQUFDO0FBQ3hELGdDQUFRLFNBQVMsZUFBZTtBQUNoQyxRQUFNLFFBQVEsT0FBTyxVQUFVLEVBQUUsS0FBSyxvQkFBb0IsQ0FBQztBQUMzRCxRQUFNLFFBQVEsU0FBUztBQUN2QixRQUFNLE9BQU8sT0FBTyxVQUFVLEVBQUUsS0FBSyxtQkFBbUIsQ0FBQztBQUN6RCxPQUFLLFFBQVEsY0FBYztBQUMzQixVQUFRLGFBQWEsZUFBZSxNQUFNO0FBRTFDLFNBQU87QUFDVDs7O0ExQnpEQSxJQUFNLG9CQUFvQix5QkFBWSxPQUFhO0FBRW5ELElBQU0sd0JBQU4sY0FBb0MsdUJBQU07QUFBQSxFQUN4QyxZQUNFLEtBQ2lCLFdBQ2pCO0FBQ0EsVUFBTSxHQUFHO0FBRlE7QUFBQSxFQUduQjtBQUFBLEVBRUEsU0FBZTtBQUNiLFVBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsY0FBVSxNQUFNO0FBQ2hCLGNBQVUsU0FBUyxNQUFNLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQztBQUNqRSxjQUFVLFNBQVMsS0FBSztBQUFBLE1BQ3RCLE1BQU07QUFBQSxJQUNSLENBQUM7QUFFRCxVQUFNLFVBQVUsVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNqRSxVQUFNLGVBQWUsUUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLFNBQVMsQ0FBQztBQUNsRSxVQUFNLGVBQWUsUUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLGtCQUFrQixLQUFLLFVBQVUsQ0FBQztBQUUxRixpQkFBYSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQ3pELGlCQUFhLGlCQUFpQixTQUFTLFlBQVk7QUFDakQsWUFBTSxLQUFLLFVBQVU7QUFDckIsV0FBSyxNQUFNO0FBQUEsSUFDYixDQUFDO0FBQUEsRUFDSDtBQUNGO0FBRUEsSUFBTSx5QkFBTixjQUFxQyxxQ0FBb0I7QUFBQSxFQUl2RCxZQUNFLGFBQ2lCLFFBQ0EsT0FDQSxhQUNqQjtBQUNBLFVBQU0sV0FBVztBQUpBO0FBQ0E7QUFDQTtBQVBuQixTQUFRLGlCQUF3QztBQUNoRCxTQUFRLDJCQUFnRDtBQUFBLEVBU3hEO0FBQUEsRUFFQSxTQUFlO0FBQ2IsU0FBSyxZQUFZLGVBQWUsU0FBUyxzQkFBc0I7QUFDL0QsU0FBSyxZQUFZLGVBQWUsWUFBWSxLQUFLLE9BQU8scUJBQXFCLEtBQUssS0FBSyxDQUFDO0FBRXhGLFFBQUksS0FBSyxPQUFPLFNBQVMsa0JBQWtCLFVBQVU7QUFDbkQsV0FBSyxZQUFZLFVBQVUsSUFBSSxzQkFBc0I7QUFBQSxJQUN2RDtBQUVBLFVBQU0sY0FBYyxDQUFDLHlCQUF5QjtBQUM5QyxRQUFJLEtBQUssT0FBTyxTQUFTLGtCQUFrQixRQUFRO0FBQ2pELGtCQUFZLEtBQUssd0JBQXdCO0FBQUEsSUFDM0M7QUFDQSxTQUFLLGlCQUFpQixLQUFLLFlBQVksVUFBVSxFQUFFLEtBQUssWUFBWSxLQUFLLEdBQUcsRUFBRSxDQUFDO0FBRS9FLFNBQUssT0FBTyxpQkFBaUIsS0FBSyxNQUFNLElBQUksS0FBSyxjQUFjO0FBQy9ELFNBQUssMkJBQTJCLEtBQUssT0FBTyx1QkFBdUIsS0FBSyxNQUFNLElBQUksTUFBTTtBQUN0RixVQUFJLEtBQUssZ0JBQWdCO0FBQ3ZCLGFBQUssT0FBTyxpQkFBaUIsS0FBSyxNQUFNLElBQUksS0FBSyxjQUFjO0FBQUEsTUFDakU7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxXQUFpQjtBQUNmLFNBQUssMkJBQTJCO0FBQUEsRUFDbEM7QUFDRjtBQUVBLElBQU0sb0JBQU4sY0FBZ0Msd0JBQVc7QUFBQSxFQUd6QyxZQUNtQixRQUNBLE9BQ2pCO0FBQ0EsVUFBTTtBQUhXO0FBQ0E7QUFHakIsU0FBSyxZQUFZLE9BQU8sZUFBZSxNQUFNLEVBQUU7QUFBQSxFQUNqRDtBQUFBLEVBRUEsR0FBRyxPQUFtQztBQUNwQyxXQUFPLE1BQU0sTUFBTSxPQUFPLEtBQUssTUFBTSxNQUFNLE1BQU0sY0FBYyxLQUFLO0FBQUEsRUFDdEU7QUFBQSxFQUVBLFFBQXFCO0FBQ25CLFdBQU8sS0FBSyxPQUFPLHFCQUFxQixLQUFLLEtBQUs7QUFBQSxFQUNwRDtBQUNGO0FBRUEsSUFBTSxtQkFBTixjQUErQix3QkFBVztBQUFBLEVBQ3hDLFlBQ21CLFFBQ0EsU0FDakI7QUFDQSxVQUFNO0FBSFc7QUFDQTtBQUFBLEVBR25CO0FBQUEsRUFFQSxHQUFHLE9BQWtDO0FBQ25DLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxRQUFxQjtBQUNuQixVQUFNLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDNUMsWUFBUSxZQUFZO0FBQ3BCLFNBQUssT0FBTyxpQkFBaUIsS0FBSyxTQUFTLE9BQU87QUFDbEQsV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVBLElBQXFCLGFBQXJCLGNBQXdDLHdCQUFPO0FBQUEsRUFBL0M7QUFBQTtBQUNFLG9CQUErQjtBQUMvQixTQUFTLFdBQVcsSUFBSSxtQkFBbUI7QUFBQSxNQUN6QyxJQUFJLGFBQWE7QUFBQSxNQUNqQixJQUFJLFdBQVc7QUFBQSxNQUNmLElBQUksWUFBWTtBQUFBLE1BQ2hCLElBQUkscUJBQXFCO0FBQUEsTUFDekIsSUFBSSxrQkFBa0I7QUFBQSxNQUN0QixJQUFJLHNCQUFzQjtBQUFBLE1BQzFCLElBQUksV0FBVztBQUFBLE1BQ2YsSUFBSSxXQUFXO0FBQUEsTUFDZixJQUFJLFlBQVk7QUFBQSxNQUNoQixJQUFJLHFCQUFxQjtBQUFBLElBQzNCLENBQUM7QUFFRDtBQUFBLFNBQWdCLGtCQUFrQixJQUFJLG9CQUFvQixLQUFLLEtBQUssS0FBSyxTQUFTLE9BQU8sd0JBQXdCO0FBQ2pILFNBQWlCLDZCQUE2QixvQkFBSSxJQUFZO0FBQzlELFNBQWlCLFVBQVUsb0JBQUksSUFBOEI7QUFDN0QsU0FBaUIsVUFBVSxvQkFBSSxJQUE2QjtBQUM1RCxTQUFpQixrQkFBa0Isb0JBQUksSUFBNkI7QUFFcEUsU0FBUSxjQUFjLG9CQUFJLElBQWdCO0FBQzFDLFNBQVEsdUJBQXNDO0FBQUE7QUFBQSxFQUU5QyxNQUFNLFNBQXdCO0FBQzVCLFVBQU0sS0FBSyxhQUFhO0FBQ3hCLFNBQUssY0FBYyxJQUFJLGVBQWUsSUFBSSxDQUFDO0FBQzNDLFNBQUssa0JBQWtCLEtBQUssaUJBQWlCO0FBQzdDLFNBQUssZ0JBQWdCO0FBQ3JCLFNBQUssSUFBSSxVQUFVLGNBQWMsTUFBTTtBQUNyQyxXQUFLLHVCQUF1QixLQUFLLHNCQUFzQixHQUFHLFFBQVEsS0FBSztBQUN2RSxXQUFLLEtBQUssK0JBQStCO0FBQUEsSUFDM0MsQ0FBQztBQUVELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sZ0JBQWdCLE9BQU8sUUFBUSxTQUFTO0FBQ3RDLGNBQU0sT0FBTyxLQUFLO0FBQ2xCLFlBQUksQ0FBQyxNQUFNO0FBQ1Q7QUFBQSxRQUNGO0FBRUEsY0FBTSxTQUFTLHdCQUF3QixLQUFLLE1BQU0sT0FBTyxTQUFTLEdBQUcsS0FBSyxRQUFRO0FBQ2xGLGNBQU0sUUFBUSxnQkFBZ0IsUUFBUSxPQUFPLFVBQVUsRUFBRSxJQUFJO0FBQzdELFlBQUksQ0FBQyxPQUFPO0FBQ1YsY0FBSSx3QkFBTyxnREFBZ0Q7QUFDM0Q7QUFBQSxRQUNGO0FBQ0EsY0FBTSxLQUFLLFNBQVMsTUFBTSxLQUFLO0FBQUEsTUFDakM7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLGVBQWUsQ0FBQyxhQUFhO0FBQzNCLGNBQU0sT0FBTyxLQUFLLHNCQUFzQjtBQUN4QyxZQUFJLENBQUMsTUFBTTtBQUNULGlCQUFPO0FBQUEsUUFDVDtBQUNBLFlBQUksQ0FBQyxVQUFVO0FBQ2IsZUFBSyxLQUFLLG1CQUFtQixJQUFJO0FBQUEsUUFDbkM7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUVELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sZUFBZSxDQUFDLGFBQWE7QUFDM0IsY0FBTSxPQUFPLEtBQUssc0JBQXNCO0FBQ3hDLFlBQUksQ0FBQyxNQUFNO0FBQ1QsaUJBQU87QUFBQSxRQUNUO0FBQ0EsWUFBSSxDQUFDLFVBQVU7QUFDYixlQUFLLEtBQUssb0JBQW9CLElBQUk7QUFBQSxRQUNwQztBQUNBLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRixDQUFDO0FBRUQsU0FBSyw0QkFBNEI7QUFFakMsU0FBSyx3QkFBd0IsS0FBSywyQkFBMkIsQ0FBQztBQUU5RCxTQUFLO0FBQUEsTUFDSCxLQUFLLElBQUksVUFBVSxHQUFHLGFBQWEsQ0FBQyxTQUFTO0FBQzNDLGFBQUssdUJBQXVCLE1BQU0sUUFBUSxLQUFLO0FBQy9DLGFBQUssZ0JBQWdCO0FBQ3JCLGFBQUssS0FBSywrQkFBK0I7QUFDekMsWUFBSSxRQUFRLEtBQUssU0FBUyxtQkFBbUI7QUFDM0MsZUFBSyxLQUFLLG1CQUFtQixJQUFJO0FBQUEsUUFDbkM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUEsU0FBSyxXQUFXO0FBQUEsTUFDZCxJQUFJO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixVQUFVLFlBQVk7QUFDcEIsY0FBTSxTQUFTLE1BQU0sS0FBSywyQkFBMkI7QUFDckQsWUFBSSx3QkFBTyxPQUFPLFNBQVMsT0FBTyxJQUFJLENBQUMsVUFBVSxHQUFHLE1BQU0sSUFBSSxLQUFLLE1BQU0sTUFBTSxFQUFFLEVBQUUsS0FBSyxJQUFJLElBQUksbUNBQW1DLEdBQUk7QUFBQSxNQUN6STtBQUFBLElBQ0YsQ0FBQztBQUVELFNBQUs7QUFBQSxNQUNILEtBQUssSUFBSSxVQUFVLEdBQUcsc0JBQXNCLE1BQU07QUFDaEQsYUFBSyx1QkFBdUIsS0FBSyxzQkFBc0IsR0FBRyxRQUFRLEtBQUs7QUFDdkUsYUFBSyxLQUFLLCtCQUErQjtBQUFBLE1BQzNDLENBQUM7QUFBQSxJQUNIO0FBRUEsU0FBSztBQUFBLE1BQ0gsS0FBSyxJQUFJLFVBQVUsR0FBRyxpQkFBaUIsQ0FBQyxTQUFTLFFBQVE7QUFDdkQsWUFBSSxlQUFlLCtCQUFjO0FBQy9CLGVBQUssS0FBSyx5QkFBeUIsSUFBSSxJQUFJO0FBQUEsUUFDN0M7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUFBLEVBRUEsV0FBaUI7QUFDZixlQUFXLGNBQWMsS0FBSyxRQUFRLE9BQU8sR0FBRztBQUM5QyxpQkFBVyxNQUFNO0FBQUEsSUFDbkI7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLGVBQThCO0FBQ2xDLFNBQUssV0FBVztBQUFBLE1BQ2QsR0FBRztBQUFBLE1BQ0gsR0FBSSxNQUFNLEtBQUssU0FBUztBQUFBLElBQzFCO0FBQ0EsbUNBQStCLEtBQUssUUFBUTtBQUFBLEVBQzlDO0FBQUEsRUFFQSxNQUFNLGVBQThCO0FBQ2xDLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUNqQyxTQUFLLDRCQUE0QjtBQUNqQyxTQUFLLGdCQUFnQjtBQUFBLEVBQ3ZCO0FBQUEsRUFFQSxlQUFlLFNBQTBCO0FBQ3ZDLFdBQU8sS0FBSyxRQUFRLElBQUksT0FBTztBQUFBLEVBQ2pDO0FBQUEsRUFFQSx1QkFBdUIsU0FBaUIsVUFBa0M7QUFDeEUsUUFBSSxDQUFDLEtBQUssZ0JBQWdCLElBQUksT0FBTyxHQUFHO0FBQ3RDLFdBQUssZ0JBQWdCLElBQUksU0FBUyxvQkFBSSxJQUFJLENBQUM7QUFBQSxJQUM3QztBQUNBLFNBQUssZ0JBQWdCLElBQUksT0FBTyxHQUFHLElBQUksUUFBUTtBQUMvQyxXQUFPLE1BQU07QUFDWCxXQUFLLGdCQUFnQixJQUFJLE9BQU8sR0FBRyxPQUFPLFFBQVE7QUFBQSxJQUNwRDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLHFCQUFxQixPQUFtQztBQUN0RCxXQUFPLHVCQUF1QixNQUFNLElBQUksS0FBSyxlQUFlLE1BQU0sRUFBRSxHQUFHO0FBQUEsTUFDckUsT0FBTyxNQUFNLEtBQUssS0FBSyxtQkFBbUIsTUFBTSxFQUFFO0FBQUEsTUFDbEQsUUFBUSxZQUFZO0FBQ2xCLFlBQUk7QUFDRixnQkFBTSxVQUFVLFVBQVUsVUFBVSxNQUFNLE9BQU87QUFDakQsY0FBSSx3QkFBTyxhQUFhO0FBQUEsUUFDMUIsUUFBUTtBQUNOLGNBQUksd0JBQU8seUJBQXlCO0FBQUEsUUFDdEM7QUFBQSxNQUNGO0FBQUEsTUFDQSxVQUFVLE1BQU0sS0FBSyxLQUFLLGtCQUFrQixNQUFNLEVBQUU7QUFBQSxNQUNwRCxnQkFBZ0IsTUFBTTtBQUNwQixjQUFNLFNBQVMsS0FBSyxRQUFRLElBQUksTUFBTSxFQUFFO0FBQ3hDLFlBQUksQ0FBQyxRQUFRO0FBQ1g7QUFBQSxRQUNGO0FBQ0EsZUFBTyxVQUFVLENBQUMsT0FBTztBQUN6QixhQUFLLG9CQUFvQixNQUFNLEVBQUU7QUFBQSxNQUNuQztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLGlCQUFpQixTQUFpQixXQUE4QjtBQUM5RCxjQUFVLE1BQU07QUFFaEIsVUFBTSxTQUFTLEtBQUssUUFBUSxJQUFJLE9BQU87QUFDdkMsUUFBSSxLQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUc7QUFDN0IsZ0JBQVUsWUFBWSxtQkFBbUIsQ0FBQztBQUMxQztBQUFBLElBQ0Y7QUFFQSxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sU0FBUztBQUM5QjtBQUFBLElBQ0Y7QUFFQSxjQUFVLFlBQVksa0JBQWtCLE1BQU0sQ0FBQztBQUFBLEVBQ2pEO0FBQUEsRUFFQSxNQUFNLG1CQUFtQixTQUFnQztBQUN2RCxVQUFNLFFBQVEsS0FBSyxvQkFBb0IsT0FBTztBQUM5QyxVQUFNLE9BQU8sS0FBSyxzQkFBc0I7QUFDeEMsUUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNO0FBQ25CO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSyxTQUFTLE1BQU0sS0FBSztBQUFBLEVBQ2pDO0FBQUEsRUFFQSxNQUFNLGtCQUFrQixTQUFnQztBQUN0RCxVQUFNLFFBQVEsS0FBSyxvQkFBb0IsT0FBTztBQUM5QyxRQUFJLENBQUMsT0FBTztBQUNWO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsTUFBTSxRQUFRO0FBQ2hFLFFBQUksRUFBRSxnQkFBZ0IseUJBQVE7QUFDNUI7QUFBQSxJQUNGO0FBRUEsU0FBSyxRQUFRLElBQUksT0FBTyxHQUFHLE1BQU07QUFDakMsU0FBSyxRQUFRLE9BQU8sT0FBTztBQUMzQixTQUFLLFFBQVEsT0FBTyxPQUFPO0FBRTNCLFVBQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxNQUFNLENBQUMsWUFBWTtBQUM5QyxZQUFNLFFBQVEsUUFBUSxNQUFNLE9BQU87QUFDbkMsWUFBTSxTQUFTLHdCQUF3QixLQUFLLE1BQU0sU0FBUyxLQUFLLFFBQVE7QUFDeEUsWUFBTSxlQUFlLE9BQU8sS0FBSyxDQUFDLGNBQWMsVUFBVSxPQUFPLE9BQU87QUFDeEUsVUFBSSxDQUFDLGNBQWM7QUFDakIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxZQUFNLGVBQWUsS0FBSyx1QkFBdUIsT0FBTyxPQUFPO0FBQy9ELFlBQU0sZUFBZSxhQUFhO0FBQ2xDLFlBQU0sYUFBYSxlQUFlLGFBQWEsTUFBTSxhQUFhO0FBQ2xFLFlBQU0sT0FBTyxjQUFjLGFBQWEsZUFBZSxDQUFDO0FBRXhELGFBQU8sZUFBZSxNQUFNLFNBQVMsS0FBSyxNQUFNLFlBQVksTUFBTSxNQUFNLE1BQU0sZUFBZSxDQUFDLE1BQU0sSUFBSTtBQUN0RyxjQUFNLE9BQU8sY0FBYyxDQUFDO0FBQUEsTUFDOUI7QUFFQSxhQUFPLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDeEIsQ0FBQztBQUVELFNBQUssb0JBQW9CLE9BQU87QUFDaEMsU0FBSyxnQkFBZ0I7QUFDckIsUUFBSSx3QkFBTyx1QkFBdUI7QUFBQSxFQUNwQztBQUFBLEVBRUEsTUFBTSxtQkFBbUIsTUFBNEI7QUFDbkQsVUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLE1BQU0sV0FBVyxJQUFJO0FBQ25ELFVBQU0sU0FBUyx3QkFBd0IsS0FBSyxNQUFNLFFBQVEsS0FBSyxRQUFRO0FBQ3ZFLFVBQU0sa0JBQWtCLE9BQU8sT0FBTyxDQUFDLFVBQVU7QUFDL0MsWUFBTSxtQkFBbUIsd0JBQXdCLEtBQUssS0FBSyxNQUFNLE9BQU8sS0FBSyxRQUFRO0FBQ3JGLGFBQU8saUJBQWlCLGtCQUFrQixLQUFLLFNBQVMsa0JBQWtCLE9BQU8sS0FBSyxRQUFRO0FBQUEsSUFDaEcsQ0FBQztBQUVELFFBQUksQ0FBQyxnQkFBZ0IsUUFBUTtBQUMzQixVQUFJLHdCQUFPLHFEQUFxRDtBQUNoRTtBQUFBLElBQ0Y7QUFFQSxlQUFXLFNBQVMsaUJBQWlCO0FBQ25DLFlBQU0sS0FBSyxTQUFTLE1BQU0sS0FBSztBQUFBLElBQ2pDO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxvQkFBb0IsTUFBNEI7QUFDcEQsVUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLE1BQU0sV0FBVyxJQUFJO0FBQ25ELFVBQU0sU0FBUyx3QkFBd0IsS0FBSyxNQUFNLFFBQVEsS0FBSyxRQUFRO0FBQ3ZFLGVBQVcsU0FBUyxRQUFRO0FBQzFCLFdBQUssUUFBUSxPQUFPLE1BQU0sRUFBRTtBQUM1QixXQUFLLG9CQUFvQixNQUFNLEVBQUU7QUFDakMsWUFBTSxLQUFLLHlCQUF5QixLQUFLLE1BQU0sTUFBTSxFQUFFO0FBQUEsSUFDekQ7QUFDQSxRQUFJLHdCQUFPLHVCQUF1QjtBQUFBLEVBQ3BDO0FBQUEsRUFFQSxNQUFNLFNBQVMsTUFBYSxPQUFxQztBQUMvRCxTQUFLLHVCQUF1QixLQUFLO0FBQ2pDLFFBQUksS0FBSyxRQUFRLElBQUksTUFBTSxFQUFFLEdBQUc7QUFDOUIsVUFBSSx3QkFBTyxxQ0FBcUM7QUFDaEQ7QUFBQSxJQUNGO0FBRUEsUUFBSSxDQUFFLE1BQU0sS0FBSyx1QkFBdUIsR0FBSTtBQUMxQyxrQ0FBNEI7QUFDNUI7QUFBQSxJQUNGO0FBRUEsVUFBTSxtQkFBbUIsd0JBQXdCLEtBQUssS0FBSyxNQUFNLE9BQU8sS0FBSyxRQUFRO0FBQ3JGLFVBQU0saUJBQWlCLGlCQUFpQjtBQUN4QyxVQUFNLFNBQVMsaUJBQWlCLE9BQU8sS0FBSyxTQUFTLGtCQUFrQixPQUFPLEtBQUssUUFBUTtBQUMzRixRQUFJLENBQUMsUUFBUTtBQUNYLFVBQUksQ0FBQyxnQkFBZ0I7QUFDbkIsWUFBSSx3QkFBTyw0QkFBNEIsTUFBTSxRQUFRLEdBQUc7QUFDeEQ7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFVBQU0sYUFBYSxJQUFJLGdCQUFnQjtBQUN2QyxVQUFNLGFBQWE7QUFBQSxNQUNqQjtBQUFBLE1BQ0Esa0JBQWtCLGlCQUFpQjtBQUFBLE1BQ25DLFdBQVcsaUJBQWlCO0FBQUEsTUFDNUIsUUFBUSxXQUFXO0FBQUEsSUFDckI7QUFDQSxTQUFLLFFBQVEsSUFBSSxNQUFNLElBQUksVUFBVTtBQUNyQyxTQUFLLG9CQUFvQixNQUFNLEVBQUU7QUFDakMsU0FBSyxnQkFBZ0I7QUFFckIsUUFBSTtBQUNGLFlBQU0sZ0JBQWdCLE1BQU0sS0FBSyx1QkFBdUIsTUFBTSxLQUFLO0FBQ25FLFlBQU0sU0FBUyxpQkFDWCxNQUFNLEtBQUssZ0JBQWdCLElBQUksY0FBYyxPQUFPLFlBQVksS0FBSyxVQUFVLGNBQWMsSUFDN0YsTUFBTSxPQUFRLElBQUksY0FBYyxPQUFPLFlBQVksS0FBSyxRQUFRO0FBRXBFLFVBQUksT0FBTyxVQUFVO0FBQ25CLGVBQU8sU0FBUyxPQUFPLFVBQVUsNkJBQTZCLEtBQUssU0FBUyxnQkFBZ0I7QUFBQSxNQUM5RixXQUFXLE9BQU8sV0FBVztBQUMzQixlQUFPLFNBQVMsT0FBTyxVQUFVO0FBQUEsTUFDbkMsV0FBVyxDQUFDLE9BQU8sV0FBVyxDQUFDLE9BQU8sT0FBTyxLQUFLLEdBQUc7QUFDbkQsZUFBTyxTQUFTO0FBQUEsTUFDbEI7QUFFQSxVQUFJLGNBQWMsZUFBZTtBQUMvQixjQUFNLGVBQWUsNkJBQTZCLGNBQWMsY0FBYyxXQUFXO0FBQ3pGLGVBQU8sVUFBVSxPQUFPLFVBQVUsR0FBRyxZQUFZO0FBQUEsRUFBSyxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQzNFO0FBQ0EsVUFBSSxLQUFLLDRCQUE0QixnQkFBZ0IsR0FBRztBQUN0RCxjQUFNLGdCQUFnQixLQUFLLDZCQUE2QixnQkFBZ0I7QUFDeEUsZUFBTyxVQUFVLE9BQU8sVUFBVSxHQUFHLGFBQWE7QUFBQSxFQUFLLE9BQU8sT0FBTyxLQUFLO0FBQUEsTUFDNUU7QUFFQSxXQUFLLFFBQVEsSUFBSSxNQUFNLElBQUk7QUFBQSxRQUN6QixTQUFTLE1BQU07QUFBQSxRQUNmO0FBQUEsUUFDQTtBQUFBLFFBQ0EsZUFBZSxjQUFjO0FBQUEsUUFDN0IsV0FBVztBQUFBLFFBQ1gsU0FBUztBQUFBLE1BQ1gsQ0FBQztBQUVELFVBQUksS0FBSyxTQUFTLG1CQUFtQjtBQUNuQyxjQUFNLEtBQUssd0JBQXdCLE1BQU0sT0FBTyxNQUFNO0FBQUEsTUFDeEQ7QUFFQSxZQUFNLGFBQWEsaUJBQWlCLGFBQWEsY0FBYyxLQUFLLE9BQVE7QUFDNUUsVUFBSSx3QkFBTyxPQUFPLFVBQVUsWUFBWSxVQUFVLFlBQVksdUJBQXVCLFVBQVUsR0FBRztBQUFBLElBQ3BHLFNBQVMsT0FBTztBQUNkLFlBQU0sVUFBVSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQ3JFLFdBQUssUUFBUSxJQUFJLE1BQU0sSUFBSTtBQUFBLFFBQ3pCLFNBQVMsTUFBTTtBQUFBLFFBQ2Y7QUFBQSxRQUNBLFdBQVc7QUFBQSxRQUNYLFNBQVM7QUFBQSxRQUNULFFBQVE7QUFBQSxVQUNOLFVBQVUsaUJBQWlCLGFBQWEsY0FBYyxLQUFLLFFBQVEsTUFBTTtBQUFBLFVBQ3pFLFlBQVksaUJBQWlCLGFBQWEsY0FBYyxLQUFLLFFBQVEsZUFBZTtBQUFBLFVBQ3BGLFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxVQUNsQyxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsVUFDbkMsWUFBWTtBQUFBLFVBQ1osVUFBVTtBQUFBLFVBQ1YsUUFBUTtBQUFBLFVBQ1IsUUFBUTtBQUFBLFVBQ1IsU0FBUztBQUFBLFVBQ1QsVUFBVTtBQUFBLFVBQ1YsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLENBQUM7QUFDRCxVQUFJLHdCQUFPLGVBQWUsT0FBTyxFQUFFO0FBQUEsSUFDckMsVUFBRTtBQUNBLFdBQUssUUFBUSxPQUFPLE1BQU0sRUFBRTtBQUM1QixXQUFLLG9CQUFvQixNQUFNLEVBQUU7QUFDakMsV0FBSyxnQkFBZ0I7QUFBQSxJQUN2QjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMseUJBQTJDO0FBQ3ZELFFBQUksS0FBSyxTQUFTLHdCQUF3QixLQUFLLFNBQVMsOEJBQThCO0FBQ3BGLGFBQU87QUFBQSxJQUNUO0FBRUEsV0FBTyxNQUFNLElBQUksUUFBaUIsQ0FBQyxZQUFZO0FBQzdDLFVBQUksVUFBVTtBQUNkLFlBQU0sU0FBUyxDQUFDLFVBQW1CO0FBQ2pDLFlBQUksQ0FBQyxTQUFTO0FBQ1osb0JBQVU7QUFDVixrQkFBUSxLQUFLO0FBQUEsUUFDZjtBQUFBLE1BQ0Y7QUFFQSxZQUFNLFFBQVEsSUFBSSxzQkFBc0IsS0FBSyxLQUFLLFlBQVk7QUFDNUQsYUFBSyxTQUFTLHVCQUF1QjtBQUNyQyxhQUFLLFNBQVMsK0JBQStCO0FBQzdDLGNBQU0sS0FBSyxhQUFhO0FBQ3hCLGVBQU8sSUFBSTtBQUFBLE1BQ2IsQ0FBQztBQUVELFlBQU0sZ0JBQWdCLE1BQU0sTUFBTSxLQUFLLEtBQUs7QUFDNUMsWUFBTSxRQUFRLE1BQU07QUFDbEIsc0JBQWM7QUFDZCxlQUFPLEtBQUssU0FBUyx3QkFBd0IsS0FBSyxTQUFTLDRCQUE0QjtBQUFBLE1BQ3pGO0FBQ0EsWUFBTSxLQUFLO0FBQUEsSUFDYixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsTUFBYSxPQUE0RztBQUM1SixRQUFJLENBQUMsTUFBTSxpQkFBaUI7QUFDMUIsYUFBTyxFQUFFLE1BQU07QUFBQSxJQUNqQjtBQUVBLFVBQU0sZ0JBQWdCLEtBQUssMkJBQTJCLE1BQU0sTUFBTSxnQkFBZ0IsUUFBUTtBQUMxRixVQUFNLGFBQWEsS0FBSyxJQUFJLE1BQU0sc0JBQXNCLGFBQWE7QUFDckUsUUFBSSxFQUFFLHNCQUFzQix5QkFBUTtBQUNsQyxZQUFNLElBQUksTUFBTSxxQ0FBcUMsYUFBYSxFQUFFO0FBQUEsSUFDdEU7QUFFQSxVQUFNLFVBQVUsNEJBQTRCLEtBQUs7QUFDakQsVUFBTSxvQkFBb0IsS0FBSywyQkFBMkIsT0FBTyxJQUFJO0FBQ3JFLFVBQU0sV0FBVyxNQUFNO0FBQUEsTUFDckIsTUFBTSxLQUFLLElBQUksTUFBTSxXQUFXLFVBQVU7QUFBQSxNQUMxQyxFQUFFLEdBQUcsTUFBTSxpQkFBaUIsVUFBVSxjQUFjO0FBQUEsTUFDcEQsTUFBTTtBQUFBLE1BQ047QUFBQSxNQUNBO0FBQUEsUUFDRSxrQkFBa0IsS0FBSyxTQUFTLGlCQUFpQixLQUFLLEtBQUs7QUFBQSxRQUMzRDtBQUFBLFFBQ0EsVUFBVSxPQUFPLGFBQWE7QUFDNUIsZ0JBQU0sZUFBZSxLQUFLLElBQUksTUFBTSwwQkFBc0IsZ0NBQWMsUUFBUSxDQUFDO0FBQ2pGLGlCQUFPLHdCQUF3Qix5QkFBUSxLQUFLLElBQUksTUFBTSxXQUFXLFlBQVksSUFBSTtBQUFBLFFBQ25GO0FBQUEsUUFDQSxxQkFBcUIsT0FBTyxjQUFjLFlBQVksVUFBVSxLQUFLLDZCQUE2QixjQUFjLFlBQVksS0FBSztBQUFBLE1BQ25JO0FBQUEsSUFDRjtBQUNBLFVBQU0sYUFBYSxzQkFBc0IsTUFBTSxVQUFVLFFBQVEsaUJBQWlCLENBQUM7QUFDbkYsVUFBTSxxQkFBcUIsS0FBSyxTQUFTLDhCQUE4QixpQkFBaUI7QUFFeEYsV0FBTztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsU0FBUyxTQUFTO0FBQUEsTUFDcEI7QUFBQSxNQUNBLGVBQWUsb0JBQW9CO0FBQUEsUUFDakMsYUFBYSxTQUFTO0FBQUEsUUFDdEIsVUFBVSxNQUFNO0FBQUEsUUFDaEIsU0FBUyxTQUFTO0FBQUEsUUFDbEI7QUFBQSxRQUNBLFVBQVUsS0FBSyxTQUFTLCtCQUErQjtBQUFBLFFBQ3ZELHdCQUF3QixLQUFLLFNBQVMsa0NBQWtDO0FBQUEsTUFDMUUsSUFBSTtBQUFBLElBQ047QUFBQSxFQUNGO0FBQUEsRUFFUSwyQkFBMkIsTUFBYSxlQUErQjtBQUM3RSxVQUFNLFVBQVUsY0FBYyxLQUFLO0FBQ25DLFFBQUksQ0FBQyxTQUFTO0FBQ1osYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLFFBQVEsV0FBVyxHQUFHLEdBQUc7QUFDM0IsaUJBQU8sZ0NBQWMsUUFBUSxNQUFNLENBQUMsQ0FBQztBQUFBLElBQ3ZDO0FBRUEsVUFBTSxjQUFVLHVCQUFRLEtBQUssSUFBSTtBQUNqQyxlQUFPLGdDQUFjLFlBQVksTUFBTSxVQUFVLEdBQUcsT0FBTyxJQUFJLE9BQU8sRUFBRTtBQUFBLEVBQzFFO0FBQUEsRUFFUSw2QkFBNkIsY0FBc0IsWUFBb0IsT0FBOEI7QUFDM0csVUFBTSxhQUFhLFdBQ2hCLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQ3pCLE9BQU8sT0FBTyxFQUNkLEtBQUssR0FBRztBQUNYLFVBQU0sY0FBVSx1QkFBUSxZQUFZO0FBQ3BDLFVBQU0sV0FBVyxRQUFRLElBQ3JCLENBQUMsS0FBSyxnQkFBZ0IsWUFBWSxNQUFNLEtBQUssU0FBUyxRQUFRLENBQUMsQ0FBQyxJQUNoRSxDQUFDLFlBQVksTUFBTSxLQUFLLFNBQVMsRUFBRTtBQUV2QyxlQUFXLFdBQVcsVUFBVTtBQUM5QixZQUFNLGFBQWEsS0FBSywwQkFBMEIsU0FBUyxVQUFVO0FBQ3JFLGlCQUFXLGFBQWEsWUFBWTtBQUNsQyxjQUFNLGlCQUFhLGdDQUFjLFNBQVM7QUFDMUMsWUFBSSxLQUFLLElBQUksTUFBTSxzQkFBc0IsVUFBVSxhQUFhLHdCQUFPO0FBQ3JFLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLDBCQUEwQixTQUFpQixZQUE4QjtBQUMvRSxVQUFNLFNBQVMsVUFBVSxHQUFHLE9BQU8sTUFBTTtBQUN6QyxRQUFJLENBQUMsWUFBWTtBQUNmLGFBQU8sQ0FBQyxHQUFHLE1BQU0sYUFBYTtBQUFBLElBQ2hDO0FBQ0EsV0FBTztBQUFBLE1BQ0wsR0FBRyxNQUFNLEdBQUcsVUFBVTtBQUFBLE1BQ3RCLEdBQUcsTUFBTSxHQUFHLFVBQVU7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGdCQUFnQixNQUFjLFFBQXdCO0FBQzVELFFBQUksVUFBVTtBQUNkLGFBQVMsUUFBUSxHQUFHLFFBQVEsUUFBUSxTQUFTLEdBQUc7QUFDOUMsWUFBTSxXQUFPLHVCQUFRLE9BQU87QUFDNUIsZ0JBQVUsU0FBUyxNQUFNLEtBQUs7QUFBQSxJQUNoQztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLDZCQUErRTtBQUNuRixXQUFPLEtBQUssZ0JBQWdCLGtCQUFrQjtBQUFBLEVBQ2hEO0FBQUEsRUFFQSxNQUFNLG9CQUFvQixNQUE2QjtBQUNyRCxVQUFNLGFBQWEsSUFBSSxnQkFBZ0I7QUFDdkMsVUFBTSxTQUFTLE1BQU0sS0FBSyxnQkFBZ0IsV0FBVyxNQUFNLEtBQUssSUFBSSxLQUFLLFNBQVMsa0JBQWtCLElBQU8sR0FBRyxXQUFXLE1BQU07QUFDL0gsUUFBSSx3QkFBTyxPQUFPLFVBQVUsOEJBQThCLElBQUksTUFBTSxtQ0FBbUMsSUFBSSxLQUFLLEdBQUk7QUFBQSxFQUN0SDtBQUFBLEVBRUEsOEJBQW9DO0FBQ2xDLGVBQVcsU0FBUyw0QkFBNEIsS0FBSyxRQUFRLEdBQUc7QUFDOUQsWUFBTSxrQkFBa0IsTUFBTSxZQUFZO0FBQzFDLFVBQUksS0FBSywyQkFBMkIsSUFBSSxlQUFlLEdBQUc7QUFDeEQ7QUFBQSxNQUNGO0FBRUEsVUFBSSxpQkFBaUIsS0FBSyxlQUFlLEdBQUc7QUFDMUM7QUFBQSxNQUNGO0FBRUEsV0FBSywyQkFBMkIsSUFBSSxlQUFlO0FBQ25ELFdBQUssbUNBQW1DLGlCQUFpQixPQUFPLFFBQVEsSUFBSSxRQUFRO0FBQ2xGLGNBQU0sV0FBVyxJQUFJO0FBQ3JCLGNBQU0sT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsUUFBUTtBQUMxRCxZQUFJLEVBQUUsZ0JBQWdCLHlCQUFRO0FBQzVCO0FBQUEsUUFDRjtBQUVBLGNBQU0sV0FBVyxNQUFNLEtBQUssSUFBSSxNQUFNLFdBQVcsSUFBSTtBQUNyRCxjQUFNLFNBQVMsd0JBQXdCLFVBQVUsVUFBVSxLQUFLLFFBQVE7QUFDeEUsY0FBTSxVQUFXLE9BQU8sT0FBTyxJQUFJLG1CQUFtQixhQUFjLElBQUksZUFBZSxFQUFFLElBQUk7QUFDN0YsWUFBSTtBQUNKLFlBQUksU0FBUztBQUNYLGdCQUFNLFlBQVksUUFBUTtBQUMxQixrQkFBUSxPQUFPLEtBQUssQ0FBQyxjQUFjLFVBQVUsY0FBYyxhQUFhLFVBQVUsWUFBWSxNQUFNO0FBQUEsUUFDdEcsT0FBTztBQUNMLGtCQUFRLE9BQU8sS0FBSyxDQUFDLGNBQWMsVUFBVSxZQUFZLE1BQU07QUFBQSxRQUNqRTtBQUNBLFlBQUksQ0FBQyxPQUFPO0FBQ1Y7QUFBQSxRQUNGO0FBRUEsWUFBSSxNQUFNLEdBQUcsY0FBYyxLQUFLO0FBQ2hDLFlBQUksQ0FBQyxLQUFLO0FBQ1IsZ0JBQU0sR0FBRyxTQUFTLEtBQUs7QUFDdkIsY0FBSSxTQUFTLFlBQVksZUFBZSxFQUFFO0FBQzFDLGdCQUFNLE9BQU8sSUFBSSxTQUFTLE1BQU07QUFDaEMsZUFBSyxTQUFTLFlBQVksZUFBZSxFQUFFO0FBQzNDLGVBQUssUUFBUSxNQUFNO0FBQUEsUUFDckI7QUFFQSxZQUFJLE1BQU0sYUFBYSxXQUFXO0FBQ2hDLGdCQUFNLE9BQVEsSUFBSSxjQUFjLE1BQU0sS0FBNEI7QUFDbEUsK0JBQXFCLE1BQU0sTUFBTTtBQUFBLFFBQ25DO0FBRUEsWUFBSSxTQUFTLElBQUksdUJBQXVCLElBQUksTUFBTSxPQUFPLEdBQUcsQ0FBQztBQUFBLE1BQy9ELENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUFBLEVBRVEsa0JBQXdCO0FBQzlCLFVBQU0sYUFBYSxLQUFLLFFBQVE7QUFDaEMsU0FBSyxnQkFBZ0IsUUFBUSxhQUFhLFNBQVMsVUFBVSxjQUFjLGVBQWUsSUFBSSxLQUFLLEdBQUcsS0FBSyxZQUFZO0FBQUEsRUFDekg7QUFBQSxFQUVRLG9CQUFvQixTQUF1QjtBQUNqRCxTQUFLLGdCQUFnQixJQUFJLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxTQUFTLENBQUM7QUFDbkUsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRVEsa0JBQXdCO0FBQzlCLFNBQUssSUFBSSxVQUFVLGdCQUFnQixVQUFVLEVBQUUsUUFBUSxDQUFDLFNBQVM7QUFDL0QsWUFBTSxPQUFPLEtBQUs7QUFDbEIsWUFBTSxjQUFlLEtBQW9FO0FBQ3pGLG1CQUFhLFdBQVcsSUFBSTtBQUFBLElBQzlCLENBQUM7QUFFRCxlQUFXLGNBQWMsS0FBSyxhQUFhO0FBQ3pDLGlCQUFXLFNBQVMsRUFBRSxTQUFTLGtCQUFrQixHQUFHLE1BQVMsRUFBRSxDQUFDO0FBQUEsSUFDbEU7QUFBQSxFQUNGO0FBQUEsRUFFUSx3QkFBc0M7QUFDNUMsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLG9CQUFvQiw2QkFBWTtBQUNoRSxXQUFPLE1BQU0sUUFBUTtBQUFBLEVBQ3ZCO0FBQUEsRUFFUSwyQkFBMEM7QUFDaEQsV0FBTyxLQUFLLHNCQUFzQixHQUFHLFFBQVEsS0FBSztBQUFBLEVBQ3BEO0FBQUEsRUFFQSxNQUFNLGlDQUFnRDtBQUNwRCxVQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsb0JBQW9CLDZCQUFZO0FBQ2hFLFFBQUksQ0FBQyxNQUFNO0FBQ1Q7QUFBQSxJQUNGO0FBRUEsVUFBTSxLQUFLLHlCQUF5QixLQUFLLElBQUk7QUFBQSxFQUMvQztBQUFBLEVBRUEsTUFBTSxpQ0FBZ0Q7QUFDcEQsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLG9CQUFvQiw2QkFBWTtBQUNoRSxRQUFJLENBQUMsTUFBTTtBQUNUO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxLQUFLO0FBQ2xCLFVBQU0sWUFBWSxLQUFLLGFBQWE7QUFDcEMsVUFBTSxRQUFRLEVBQUUsR0FBSSxVQUFVLFNBQVMsQ0FBQyxFQUFHO0FBRTNDLFFBQUksTUFBTSxTQUFTLFlBQVksTUFBTSxXQUFXLE1BQU07QUFDcEQsWUFBTSxTQUFTO0FBQ2YsWUFBTSxLQUFLLGFBQWE7QUFBQSxRQUN0QixHQUFHO0FBQUEsUUFDSDtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLHlCQUF5QixNQUFvQztBQUN6RSxRQUFJLENBQUMsS0FBSyxTQUFTLG9CQUFvQjtBQUNyQztBQUFBLElBQ0Y7QUFFQSxRQUFJLEtBQUssWUFBWTtBQUNuQixZQUFNLEtBQUssZUFBZTtBQUFBLElBQzVCO0FBRUEsVUFBTSxPQUFPLEtBQUs7QUFDbEIsUUFBSSxFQUFFLGdCQUFnQixrQ0FBaUIsQ0FBQyxLQUFLLE1BQU07QUFDakQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLEtBQUssUUFBUSxXQUFXLEtBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxXQUFXLEtBQUssSUFBSTtBQUN0RixVQUFNLFNBQVMsd0JBQXdCLEtBQUssS0FBSyxNQUFNLFFBQVEsS0FBSyxRQUFRO0FBQzVFLFFBQUksQ0FBQyxPQUFPLFFBQVE7QUFDbEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxZQUFZLEtBQUssYUFBYTtBQUNwQyxVQUFNLFFBQVEsRUFBRSxHQUFJLFVBQVUsU0FBUyxDQUFDLEVBQUc7QUFDM0MsUUFBSSxNQUFNLFNBQVMsWUFBWSxNQUFNLFdBQVcsTUFBTTtBQUNwRDtBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU87QUFDYixVQUFNLFNBQVM7QUFFZixVQUFNLEtBQUssYUFBYTtBQUFBLE1BQ3RCLEdBQUc7QUFBQSxNQUNIO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsb0JBQW9CLFNBQXVDO0FBQ2pFLFVBQU0sT0FBTyxLQUFLLElBQUksVUFBVSxvQkFBb0IsNkJBQVk7QUFDaEUsVUFBTSxPQUFPLE1BQU07QUFDbkIsVUFBTSxTQUFTLE1BQU07QUFDckIsUUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRO0FBQ3BCLGFBQU8sS0FBSyxRQUFRLElBQUksT0FBTyxHQUFHLFNBQVM7QUFBQSxJQUM3QztBQUVBLFVBQU0sU0FBUyx3QkFBd0IsS0FBSyxNQUFNLE9BQU8sU0FBUyxHQUFHLEtBQUssUUFBUTtBQUNsRixXQUFPLE9BQU8sS0FBSyxDQUFDLFVBQVUsTUFBTSxPQUFPLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUcsU0FBUztBQUFBLEVBQzdGO0FBQUEsRUFFUSw2QkFBNkI7QUFDbkMsVUFBTSxTQUFTO0FBRWYsV0FBTyx3QkFBVztBQUFBLE1BQ2hCLE1BQU07QUFBQSxRQUdKLFlBQTZCLE1BQWtCO0FBQWxCO0FBQzNCLGlCQUFPLFlBQVksSUFBSSxJQUFJO0FBQzNCLGVBQUssY0FBYyxLQUFLLGlCQUFpQjtBQUFBLFFBQzNDO0FBQUEsUUFFQSxPQUFPLFFBQTBCO0FBQy9CLGNBQUksT0FBTyxjQUFjLE9BQU8sbUJBQW1CLE9BQU8sYUFBYSxLQUFLLENBQUMsT0FBTyxHQUFHLFFBQVEsS0FBSyxDQUFDLFdBQVcsT0FBTyxHQUFHLGlCQUFpQixDQUFDLENBQUMsR0FBRztBQUM5SSxpQkFBSyxjQUFjLEtBQUssaUJBQWlCO0FBQUEsVUFDM0M7QUFBQSxRQUNGO0FBQUEsUUFFQSxVQUFnQjtBQUNkLGlCQUFPLFlBQVksT0FBTyxLQUFLLElBQUk7QUFBQSxRQUNyQztBQUFBLFFBRVEsbUJBQW1CO0FBQ3pCLGdCQUFNLFdBQVcsT0FBTyx5QkFBeUI7QUFDakQsY0FBSSxDQUFDLFVBQVU7QUFDYixtQkFBTyx3QkFBVztBQUFBLFVBQ3BCO0FBRUEsZ0JBQU0sU0FBUyxLQUFLLEtBQUssTUFBTSxJQUFJLFNBQVM7QUFDNUMsZ0JBQU0sU0FBUyx3QkFBd0IsVUFBVSxRQUFRLE9BQU8sUUFBUTtBQUN4RSxnQkFBTSxVQUFVLElBQUksNkJBQTRCO0FBRWhELHFCQUFXLFNBQVMsUUFBUTtBQUMxQixrQkFBTSxZQUFZLEtBQUssS0FBSyxNQUFNLElBQUksS0FBSyxNQUFNLFlBQVksQ0FBQztBQUM5RCxvQkFBUTtBQUFBLGNBQ04sVUFBVTtBQUFBLGNBQ1YsVUFBVTtBQUFBLGNBQ1Ysd0JBQVcsT0FBTztBQUFBLGdCQUNoQixRQUFRLElBQUksa0JBQWtCLFFBQVEsS0FBSztBQUFBLGdCQUMzQyxNQUFNO0FBQUEsY0FDUixDQUFDO0FBQUEsWUFDSDtBQUVBLGdCQUFJLE9BQU8sUUFBUSxJQUFJLE1BQU0sRUFBRSxLQUFLLE9BQU8sUUFBUSxJQUFJLE1BQU0sRUFBRSxHQUFHO0FBQ2hFLG9CQUFNLFVBQVUsS0FBSyxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sVUFBVSxDQUFDO0FBQzFELHNCQUFRO0FBQUEsZ0JBQ04sUUFBUTtBQUFBLGdCQUNSLFFBQVE7QUFBQSxnQkFDUix3QkFBVyxPQUFPO0FBQUEsa0JBQ2hCLFFBQVEsSUFBSSxpQkFBaUIsUUFBUSxNQUFNLEVBQUU7QUFBQSxrQkFDN0MsTUFBTTtBQUFBLGdCQUNSLENBQUM7QUFBQSxjQUNIO0FBQUEsWUFDRjtBQUVBLGdCQUFJLE1BQU0sYUFBYSxXQUFXO0FBQ2hDLGlDQUFtQixTQUFTLEtBQUssTUFBTSxLQUFLO0FBQUEsWUFDOUM7QUFBQSxVQUNGO0FBRUEsaUJBQU8sUUFBUSxPQUFPO0FBQUEsUUFDeEI7QUFBQSxNQUNGO0FBQUEsTUFDQTtBQUFBLFFBQ0UsYUFBYSxDQUFDLFVBQVUsTUFBTTtBQUFBLE1BQ2hDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLDRCQUE0QixTQUFnRDtBQUNsRixXQUFPLFFBQVEsT0FBTyxjQUFjLFVBQVUsUUFBUSxPQUFPLHFCQUFxQixhQUFhLFFBQVEsT0FBTyxZQUFZO0FBQUEsRUFDNUg7QUFBQSxFQUVRLDZCQUE2QixTQUErQztBQUNsRixVQUFNLFNBQVM7QUFBQSxNQUNiLGFBQWEsUUFBUSxrQkFBa0IsUUFBUSxLQUFLLFFBQVEsT0FBTyxTQUFTO0FBQUEsTUFDNUUsT0FBTyxRQUFRLGdCQUFnQixLQUFLLFFBQVEsT0FBTyxnQkFBZ0I7QUFBQSxNQUNuRSxXQUFXLFFBQVEsU0FBUyxPQUFPLFFBQVEsT0FBTyxPQUFPO0FBQUEsSUFDM0Q7QUFDQSxXQUFPLHNCQUFzQixPQUFPLEtBQUssSUFBSSxDQUFDO0FBQUEsRUFDaEQ7QUFBQSxFQUVRLDJCQUEyQixPQUFzQixNQUFpSztBQUN4TixVQUFNLGFBQWEsTUFBTTtBQUN6QixVQUFNLGFBQWEsV0FBVyxLQUFLLEVBQUUsWUFBWTtBQUNqRCxVQUFNLFdBQVcsS0FBSyxTQUFTLGdCQUFnQixLQUFLLENBQUMsY0FBYztBQUNqRSxZQUFNLE9BQU8sVUFBVSxLQUFLLEtBQUssRUFBRSxZQUFZO0FBQy9DLFlBQU0sVUFBVSxVQUFVLFFBQ3ZCLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxVQUFVLE1BQU0sS0FBSyxFQUFFLFlBQVksQ0FBQyxFQUN6QyxPQUFPLE9BQU87QUFDakIsYUFBTyxTQUFTLGNBQWMsUUFBUSxTQUFTLFVBQVU7QUFBQSxJQUMzRCxDQUFDO0FBQ0QsUUFBSSxDQUFDLFVBQVU7QUFDYixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sT0FBTyxTQUFTLGlCQUFpQjtBQUN2QyxVQUFNLGFBQWEsU0FBUyxnQkFBZ0IsU0FBUyxxQkFBcUIsS0FBSyxJQUFJLFNBQVMscUJBQXFCLEtBQUs7QUFDdEgsVUFBTSxPQUFPLFNBQVMsZ0JBQWdCLFNBQVMsaUJBQWlCLGNBQWMsU0FBUyxpQkFBaUI7QUFDeEcsUUFBSSxDQUFDLFlBQVk7QUFDZixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sbUJBQW1CLHdCQUF3QixLQUFLLEtBQUssTUFBTSxPQUFPLEtBQUssUUFBUTtBQUNyRixXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0EsVUFBVSxTQUFTO0FBQUEsTUFDbkI7QUFBQSxNQUNBLE1BQU0saUJBQWlCLElBQUk7QUFBQSxNQUMzQixrQkFBa0IsaUJBQWlCO0FBQUEsTUFDbkMsV0FBVyxpQkFBaUI7QUFBQSxJQUM5QjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsd0JBQXdCLE1BQWEsT0FBc0IsUUFBbUQ7QUFDMUgsVUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sQ0FBQyxZQUFZO0FBQzlDLFlBQU0sUUFBUSxRQUFRLE1BQU0sT0FBTztBQUNuQyxZQUFNLFNBQVMsd0JBQXdCLEtBQUssTUFBTSxTQUFTLEtBQUssUUFBUTtBQUN4RSxZQUFNLGVBQWUsT0FBTyxLQUFLLENBQUMsY0FBYyxVQUFVLE9BQU8sTUFBTSxFQUFFO0FBQ3pFLFlBQU0sV0FBVyxLQUFLLDRCQUE0QixNQUFNLElBQUksTUFBTTtBQUNsRSxZQUFNLGdCQUFnQixLQUFLLHVCQUF1QixPQUFPLE1BQU0sRUFBRTtBQUVqRSxVQUFJLGVBQWU7QUFDakIsY0FBTSxPQUFPLGNBQWMsT0FBTyxjQUFjLE1BQU0sY0FBYyxRQUFRLEdBQUcsR0FBRyxRQUFRO0FBQzFGLGVBQU8sTUFBTSxLQUFLLElBQUk7QUFBQSxNQUN4QjtBQUVBLFVBQUksQ0FBQyxjQUFjO0FBQ2pCLGVBQU87QUFBQSxNQUNUO0FBRUEsWUFBTSxPQUFPLGFBQWEsVUFBVSxHQUFHLEdBQUcsR0FBRyxRQUFRO0FBQ3JELGFBQU8sTUFBTSxLQUFLLElBQUk7QUFBQSxJQUN4QixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyx5QkFBeUIsVUFBa0IsU0FBZ0M7QUFDdkYsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLHNCQUFzQixRQUFRO0FBQzFELFFBQUksRUFBRSxnQkFBZ0IseUJBQVE7QUFDNUI7QUFBQSxJQUNGO0FBRUEsVUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sQ0FBQyxZQUFZO0FBQzlDLFlBQU0sUUFBUSxRQUFRLE1BQU0sT0FBTztBQUNuQyxZQUFNLFFBQVEsS0FBSyx1QkFBdUIsT0FBTyxPQUFPO0FBQ3hELFVBQUksQ0FBQyxPQUFPO0FBQ1YsZUFBTztBQUFBLE1BQ1Q7QUFDQSxZQUFNLE9BQU8sTUFBTSxPQUFPLE1BQU0sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUNyRCxhQUFPLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDeEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVRLDRCQUE0QixTQUFpQixRQUE4QztBQUNqRyxVQUFNLE9BQU87QUFBQSxNQUNYLFVBQVUsT0FBTyxVQUFVO0FBQUEsTUFDM0IsUUFBUSxPQUFPLFlBQVksR0FBRztBQUFBLE1BQzlCLFlBQVksT0FBTyxVQUFVO0FBQUEsTUFDN0IsYUFBYSxPQUFPLFVBQVU7QUFBQSxNQUM5QixPQUFPLFNBQVM7QUFBQSxFQUFZLE9BQU8sTUFBTSxLQUFLO0FBQUEsTUFDOUMsT0FBTyxVQUFVO0FBQUEsRUFBYSxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQ2pELE9BQU8sU0FBUztBQUFBLEVBQVksT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUNoRCxFQUNHLE9BQU8sT0FBTyxFQUNkLEtBQUssTUFBTTtBQUVkLFdBQU87QUFBQSxNQUNMLDZCQUE2QixPQUFPO0FBQUEsTUFDcEM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsdUJBQXVCLE9BQWlCLFNBQXdEO0FBQ3RHLFVBQU0sY0FBYyw2QkFBNkIsT0FBTztBQUN4RCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sYUFBYTtBQUNuQztBQUFBLE1BQ0Y7QUFFQSxlQUFTLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUM1QyxZQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSw0QkFBNEI7QUFDbEQsaUJBQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDNUI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfdmlldyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2NoaWxkX3Byb2Nlc3MiLCAicG9zaXhQYXRoIiwgIm5vcm1hbGl6ZUZzUGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAiYWxpYXNlcyIsICJnZXRMZWFkaW5nV2hpdGVzcGFjZSIsICJwYXJzZVBvc2l0aXZlSW50ZWdlciIsICJpc0Rpc2FibGVkVmFsdWUiLCAibm9ybWFsaXplRXh0ZW5zaW9uIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9mcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAibG9vbVBsdWdpbiIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X29zIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iXQp9Cg==
