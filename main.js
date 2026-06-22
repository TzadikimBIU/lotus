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
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
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
    const sourceReference = parseSourceReference(fenceMatch[3] ?? "");
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
    const contentHash = shortHash(`${content}${referenceHash}`);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      sourceReference,
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
function parseSourceReference(infoTail) {
  const attrs = parseInfoAttributes(infoTail);
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return void 0;
  }
  const lines = attrs["loom-lines"] ?? attrs.lines ?? attrs.line;
  const lineRange = lines ? parseLineRange(lines) : null;
  const symbolName = attrs["loom-symbol"] ?? attrs.symbol ?? attrs.fn ?? attrs.function;
  const traceValue = attrs["loom-deps"] ?? attrs.deps ?? attrs.trace;
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase())
  };
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

// src/sourceExtract.ts
function resolveReferencedSource(source, reference, language, harness) {
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
    description: reference.symbolName ? `${reference.filePath}#${reference.symbolName}` : `${reference.filePath}:L${selectedRange.start + 1}-L${selectedRange.end + 1}`
  };
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
  const exact = definitions.find((definition) => definition.name === symbolName);
  if (exact) {
    return { start: exact.start, end: exact.end };
  }
  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  return line >= 0 ? { start: line, end: line } : null;
}
function collectDependencySource(lines, language, selectedRange, selected) {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language).filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))].filter((part) => part.trim()).join("\n\n");
}
function traceDefinitions(seed, definitions, lines) {
  const selected = [];
  const selectedNames = /* @__PURE__ */ new Set();
  let haystack = seed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      if (selectedNames.has(definition.name)) {
        continue;
      }
      if (!new RegExp(`\\b${escapeRegex(definition.name)}\\b`).test(haystack)) {
        continue;
      }
      selectedNames.add(definition.name);
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
    case "cpp":
      return collectBraceDefinitions(lines, /^\s*(?:[\w:*<>,~]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{/);
    case "java":
      return collectBraceDefinitions(lines, /^\s*(?:public|private|protected|static|final|abstract|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b|^\s*(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    case "llvm-ir":
      return collectBraceDefinitions(lines, /^\s*define\b.*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*\(/);
    default:
      return [];
  }
}
function collectPythonDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
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
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourceDescription) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourceDescription}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
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
  async resolveExecutableBlock(file, block) {
    if (!block.sourceReference) {
      return { block };
    }
    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof import_obsidian5.TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }
    const resolved = resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      block.content
    );
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourceDescription: resolved.description
    };
  }
  resolveReferencedVaultPath(file, referencePath) {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return (0, import_obsidian5.normalizePath)(trimmed.slice(1));
    }
    const baseDir = (0, import_path7.dirname)(file.path);
    return (0, import_obsidian5.normalizePath)(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc291cmNlRXh0cmFjdC50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbiAgbm9ybWFsaXplUGF0aCxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IHJlc29sdmVSZWZlcmVuY2VkU291cmNlIH0gZnJvbSBcIi4vc291cmNlRXh0cmFjdFwiO1xuaW1wb3J0IHsgY3JlYXRlQ29kZUJsb2NrVG9vbGJhciB9IGZyb20gXCIuL3VpL2NvZGVCbG9ja1Rvb2xiYXJcIjtcbmltcG9ydCB7IGNyZWF0ZU91dHB1dFBhbmVsLCBjcmVhdGVSdW5uaW5nUGFuZWwgfSBmcm9tIFwiLi91aS9vdXRwdXRQYW5lbFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xuXG5jbGFzcyBFeGVjdXRpb25Db25zZW50TW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogUGx1Z2luW1wiYXBwXCJdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25Db25maXJtOiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJFbmFibGUgbG9vbSBsb2NhbCBleGVjdXRpb24/XCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcImxvb20gcnVucyBjb2RlIGZyb20geW91ciBub3RlcyBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgdXNpbmcgdGhlIGNvbmZpZ3VyZWQgZXhlY3V0YWJsZXMuIEl0IGRvZXMgbm90IHNhbmRib3ggb3IgaXNvbGF0ZSB0aGUgcHJvY2Vzcy5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNhbmNlbEJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pO1xuICAgIGNvbnN0IGVuYWJsZUJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkVuYWJsZSBhbmQgcnVuXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG5cbiAgICBjYW5jZWxCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgZW5hYmxlQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQgZXh0ZW5kcyBNYXJrZG93blJlbmRlckNoaWxkIHtcbiAgcHJpdmF0ZSBwYW5lbENvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB1bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LFxuICApIHtcbiAgICBzdXBlcihjb250YWluZXJFbCk7XG4gIH1cblxuICBvbmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5jb2RlRWxlbWVudC5wYXJlbnRFbGVtZW50Py5hZGRDbGFzcyhcImxvb20tY29kZWJsb2NrLXNoZWxsXCIpO1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYXBwZW5kQ2hpbGQodGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jaykpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwib3V0cHV0XCIpIHtcbiAgICAgIHRoaXMuY29kZUVsZW1lbnQuY2xhc3NMaXN0LmFkZChcImxvb20tcHJpbnQtaGlkZS1jb2RlXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhvc3RDbGFzc2VzID0gW1wibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIl07XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwiY29kZVwiKSB7XG4gICAgICBob3N0Q2xhc3Nlcy5wdXNoKFwibG9vbS1wcmludC1oaWRlLW91dHB1dFwiKTtcbiAgICB9XG4gICAgdGhpcy5wYW5lbENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBob3N0Q2xhc3Nlcy5qb2luKFwiIFwiKSB9KTtcblxuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIgPSB0aGlzLnBsdWdpbi5yZWdpc3Rlck91dHB1dExpc3RlbmVyKHRoaXMuYmxvY2suaWQsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLnBhbmVsQ29udGFpbmVyKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnVucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcj8uKCk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbVRvb2xiYXJXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpc1J1bm5pbmc6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmlzUnVubmluZyA9IHBsdWdpbi5pc0Jsb2NrUnVubmluZyhibG9jay5pZCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIuaXNSdW5uaW5nID09PSB0aGlzLmlzUnVubmluZztcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIGlzQmxvY2tSdW5uaW5nKGJsb2NrSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpO1xuICB9XG5cbiAgcmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcihibG9ja0lkOiBzdHJpbmcsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLnNldChibG9ja0lkLCBuZXcgU2V0KCkpO1xuICAgIH1cbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZGVsZXRlKGxpc3RlbmVyKTtcbiAgICB9O1xuICB9XG5cbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoYmxvY2suaWQsIHRoaXMuaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpLCB7XG4gICAgICBvblJ1bjogKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCksXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChibG9jay5jb250ZW50KTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDbGlwYm9hcmQgd3JpdGUgZmFpbGVkLlwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uUmVtb3ZlOiAoKSA9PiB2b2lkIHRoaXMucmVtb3ZlU25pcHBldEJ5SWQoYmxvY2suaWQpLFxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9jay5pZCk7XG4gICAgICAgIGlmICghb3V0cHV0KSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG91dHB1dC52aXNpYmxlID0gIW91dHB1dC52aXNpYmxlO1xuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlck91dHB1dEludG8oYmxvY2tJZDogc3RyaW5nLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG5cbiAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUnVubmluZ1BhbmVsKCkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghb3V0cHV0IHx8ICFvdXRwdXQudmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgaWYgKCFibG9jaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnJ1bm5pbmcuZ2V0KGJsb2NrSWQpPy5hYm9ydCgpO1xuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XG4gICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9ja0lkKTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFuYWdlZFJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XG4gICAgICBjb25zdCByZW1vdmFsRW5kID0gbWFuYWdlZFJhbmdlID8gbWFuYWdlZFJhbmdlLmVuZCA6IGN1cnJlbnRCbG9jay5lbmRMaW5lO1xuICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgcmVtb3ZhbEVuZCAtIHJlbW92YWxTdGFydCArIDEpO1xuXG4gICAgICB3aGlsZSAocmVtb3ZhbFN0YXJ0IDwgbGluZXMubGVuZ3RoIC0gMSAmJiBsaW5lc1tyZW1vdmFsU3RhcnRdID09PSBcIlwiICYmIGxpbmVzW3JlbW92YWxTdGFydCArIDFdID09PSBcIlwiKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIG5ldyBOb3RpY2UoXCJsb29tIHNuaXBwZXQgcmVtb3ZlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5BbGxCbG9ja3NJbkZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBjb250YWluZXJHcm91cCA9IHRoaXMuY29udGFpbmVyUnVubmVyLmdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlKSB8fCB0aGlzLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cDtcbiAgICBjb25zdCBzdXBwb3J0ZWRCbG9ja3MgPSBjb250YWluZXJHcm91cCA/IGJsb2NrcyA6IGJsb2Nrcy5maWx0ZXIoKGJsb2NrKSA9PiB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKSk7XG5cbiAgICBpZiAoIXN1cHBvcnRlZEJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9ja3MgZm91bmQgaW4gdGhlIGN1cnJlbnQgbm90ZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBibG9jayBvZiBzdXBwb3J0ZWRCbG9ja3MpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNsZWFyT3V0cHV0c0ZvckZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZS5wYXRoLCBibG9jay5pZCk7XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXCJsb29tIG91dHB1dHMgY2xlYXJlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5CbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gZmlsZS5wYXRoO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgbmV3IE5vdGljZShcIlRoaXMgbG9vbSBibG9jayBpcyBhbHJlYWR5IHJ1bm5pbmcuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghKGF3YWl0IHRoaXMuZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpKSkge1xuICAgICAgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IHRoaXMucmVzb2x2ZVdvcmtpbmdEaXJlY3RvcnkoZmlsZSk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXA7XG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmICghY29udGFpbmVyR3JvdXApIHtcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBydW5Db250ZXh0ID0ge1xuICAgICAgZmlsZSxcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfTtcbiAgICB0aGlzLnJ1bm5pbmcuc2V0KGJsb2NrLmlkLCBjb250cm9sbGVyKTtcbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzb2x2ZWRCbG9jayA9IGF3YWl0IHRoaXMucmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlLCBibG9jayk7XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250YWluZXJHcm91cFxuICAgICAgICA/IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzKTtcblxuICAgICAgaWYgKHJlc3VsdC50aW1lZE91dCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBgRXhlY3V0aW9uIHRpbWVkIG91dCBhZnRlciAke3RoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNc30gbXMuYDtcbiAgICAgIH0gZWxzZSBpZiAocmVzdWx0LmNhbmNlbGxlZCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQuXCI7XG4gICAgICB9IGVsc2UgaWYgKCFyZXN1bHQuc3VjY2VzcyAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IFwiUHJvY2VzcyBleGl0ZWQgdW5zdWNjZXNzZnVsbHkuXCI7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvbHZlZEJsb2NrLnNvdXJjZURlc2NyaXB0aW9uKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZU5vdGljZSA9IGBSYW4gZXh0cmFjdGVkIHNvdXJjZSBmcm9tICR7cmVzb2x2ZWRCbG9jay5zb3VyY2VEZXNjcmlwdGlvbn0uYDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3NvdXJjZU5vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBzb3VyY2VOb3RpY2U7XG4gICAgICB9XG5cbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLCBibG9jaywgcmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcnVubmVyTmFtZSA9IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXIhLmRpc3BsYXlOYW1lO1xuICAgICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIHJhbiAke3J1bm5lck5hbWV9IGJsb2NrLmAgOiBgbG9vbSBydW4gZmFpbGVkIGZvciAke3J1bm5lck5hbWV9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xuICAgICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgICAgYmxvY2ssXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHJ1bm5lcklkOiBjb250YWluZXJHcm91cCA/IGBjb250YWluZXI6JHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5pZCA/PyBcInVua25vd25cIixcbiAgICAgICAgICBydW5uZXJOYW1lOiBjb250YWluZXJHcm91cCA/IGBDb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5kaXNwbGF5TmFtZSA/PyBcIlVua25vd25cIixcbiAgICAgICAgICBzdGFydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBmaW5pc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgICAgc3Rkb3V0OiBcIlwiLFxuICAgICAgICAgIHN0ZGVycjogbWVzc2FnZSxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgbmV3IE5vdGljZShgbG9vbSBlcnJvcjogJHttZXNzYWdlfWApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZTxib29sZWFuPigocmVzb2x2ZSkgPT4ge1xuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IHNldHRsZSA9ICh2YWx1ZTogYm9vbGVhbikgPT4ge1xuICAgICAgICBpZiAoIXNldHRsZWQpIHtcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcbiAgICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbW9kYWwgPSBuZXcgRXhlY3V0aW9uQ29uc2VudE1vZGFsKHRoaXMuYXBwLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB0cnVlO1xuICAgICAgICB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBzZXR0bGUodHJ1ZSk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxDbG9zZSA9IG1vZGFsLmNsb3NlLmJpbmQobW9kYWwpO1xuICAgICAgbW9kYWwuY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIG9yaWdpbmFsQ2xvc2UoKTtcbiAgICAgICAgc2V0dGxlKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKTtcbiAgICAgIH07XG4gICAgICBtb2RhbC5vcGVuKCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGU6IFRGaWxlKTogc3RyaW5nIHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCk7XG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IGZpbGVGb2xkZXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gICAgcmV0dXJuIHJlc29sdmVkIHx8IHByb2Nlc3MuY3dkKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx7IGJsb2NrOiBsb29tQ29kZUJsb2NrOyBzb3VyY2VEZXNjcmlwdGlvbj86IHN0cmluZyB9PiB7XG4gICAgaWYgKCFibG9jay5zb3VyY2VSZWZlcmVuY2UpIHtcbiAgICAgIHJldHVybiB7IGJsb2NrIH07XG4gICAgfVxuXG4gICAgY29uc3QgcmVmZXJlbmNlUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgYmxvY2suc291cmNlUmVmZXJlbmNlLmZpbGVQYXRoKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHJlZmVyZW5jZVBhdGgpO1xuICAgIGlmICghKHNvdXJjZUZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVmZXJlbmNlZCBzb3VyY2UgZmlsZSBub3QgZm91bmQ6ICR7cmVmZXJlbmNlUGF0aH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChzb3VyY2VGaWxlKSxcbiAgICAgIHsgLi4uYmxvY2suc291cmNlUmVmZXJlbmNlLCBmaWxlUGF0aDogcmVmZXJlbmNlUGF0aCB9LFxuICAgICAgYmxvY2subGFuZ3VhZ2UsXG4gICAgICBibG9jay5jb250ZW50LFxuICAgICk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgYmxvY2s6IHtcbiAgICAgICAgLi4uYmxvY2ssXG4gICAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICB9LFxuICAgICAgc291cmNlRGVzY3JpcHRpb246IHJlc29sdmVkLmRlc2NyaXB0aW9uLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGU6IFRGaWxlLCByZWZlcmVuY2VQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRyaW1tZWQgPSByZWZlcmVuY2VQYXRoLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgodHJpbW1lZC5zbGljZSgxKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYmFzZURpciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChiYXNlRGlyID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtiYXNlRGlyfS8ke3RyaW1tZWR9YCk7XG4gIH1cblxuICBhc3luYyBnZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRHcm91cFN1bW1hcmllcygpO1xuICB9XG5cbiAgYXN5bmMgYnVpbGRDb250YWluZXJHcm91cChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLmJ1aWxkR3JvdXAobmFtZSwgTWF0aC5tYXgodGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udHJvbGxlci5zaWduYWwpO1xuICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSBidWlsdCBjb250YWluZXIgZ3JvdXAgJHtuYW1lfS5gIDogYGxvb20gY29udGFpbmVyIGJ1aWxkIGZhaWxlZCBmb3IgJHtuYW1lfS5gLCA4MDAwKTtcbiAgfVxuXG4gIHJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGFsaWFzIG9mIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyh0aGlzLnNldHRpbmdzKSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEFsaWFzID0gYWxpYXMudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICh0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmhhcyhub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoL1teYS16QS1aMC05Xy1dLy50ZXN0KG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuYWRkKG5vcm1hbGl6ZWRBbGlhcyk7XG4gICAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3Iobm9ybWFsaXplZEFsaWFzLCBhc3luYyAoc291cmNlLCBlbCwgY3R4KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gY3R4LnNvdXJjZVBhdGg7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnVsbFRleHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgZnVsbFRleHQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gKGN0eCAmJiB0eXBlb2YgY3R4LmdldFNlY3Rpb25JbmZvID09PSBcImZ1bmN0aW9uXCIpID8gY3R4LmdldFNlY3Rpb25JbmZvKGVsKSA6IG51bGw7XG4gICAgICAgIGxldCBibG9jazogbG9vbUNvZGVCbG9jayB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKHNlY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBsaW5lU3RhcnQgPSBzZWN0aW9uLmxpbmVTdGFydDtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5zdGFydExpbmUgPT09IGxpbmVTdGFydCAmJiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJlID0gZWwucXVlcnlTZWxlY3RvcihcInByZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcHJlKSB7XG4gICAgICAgICAgcHJlID0gZWwuY3JlYXRlRWwoXCJwcmVcIik7XG4gICAgICAgICAgcHJlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb25zdCBjb2RlID0gcHJlLmNyZWF0ZUVsKFwiY29kZVwiKTtcbiAgICAgICAgICBjb2RlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb2RlLnNldFRleHQoc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICBjb25zdCBjb2RlID0gKHByZS5xdWVyeVNlbGVjdG9yKFwiY29kZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGwpID8/IHByZTtcbiAgICAgICAgICBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlLCBzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgY3R4LmFkZENoaWxkKG5ldyBsb29tVG9vbGJhclJlbmRlckNoaWxkKGVsLCB0aGlzLCBibG9jaywgcHJlKSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBjb25zdCBhY3RpdmVSdW5zID0gdGhpcy5ydW5uaW5nLnNpemU7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwuc2V0VGV4dChhY3RpdmVSdW5zID8gYGxvb206ICR7YWN0aXZlUnVuc30gQWN0aXZlIFJ1biR7YWN0aXZlUnVucyA9PT0gMSA/IFwiXCIgOiBcInNcIn1gIDogXCJsb29tOiBJZGxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZm9yRWFjaCgobGlzdGVuZXIpID0+IGxpc3RlbmVyKCkpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hBbGxWaWV3cygpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBNYXJrZG93blZpZXc7XG4gICAgICBjb25zdCBwcmV2aWV3TW9kZSA9ICh2aWV3IGFzIHsgcHJldmlld01vZGU/OiB7IHJlcmVuZGVyPzogKGZvcmNlPzogYm9vbGVhbikgPT4gdm9pZCB9IH0pLnByZXZpZXdNb2RlO1xuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xuICAgICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7IGVmZmVjdHM6IGxvb21SZWZyZXNoRWZmZWN0Lm9mKHVuZGVmaW5lZCkgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRBY3RpdmVNYXJrZG93bkZpbGUoKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICByZXR1cm4gdmlldz8uZmlsZSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgfVxuXG4gIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZih2aWV3LmxlYWYpO1xuICB9XG5cbiAgYXN5bmMgZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB2aWV3LmxlYWY7XG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHN0YXRlLnNvdXJjZSA9IGZhbHNlO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAuLi52aWV3U3RhdGUsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGVhZi5pc0RlZmVycmVkKSB7XG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBpZiAoISh2aWV3IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB8fCAhdmlldy5maWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlID0gdmlldy5lZGl0b3I/LmdldFZhbHVlPy4oKSA/PyAoYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh2aWV3LmZpbGUpKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN0YXRlLm1vZGUgPSBcInNvdXJjZVwiO1xuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XG5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAuLi52aWV3U3RhdGUsXG4gICAgICBzdGF0ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGU7XG4gICAgY29uc3QgZWRpdG9yID0gdmlldz8uZWRpdG9yO1xuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBibG9jay5pZCA9PT0gYmxvY2tJZCkgPz8gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSB7XG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcblxuICAgIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICAgIGNsYXNzIHtcbiAgICAgICAgZGVjb3JhdGlvbnM7XG5cbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmFkZCh2aWV3KTtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xuICAgICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGx1Z2luLmdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpO1xuICAgICAgICAgIGlmICghZmlsZVBhdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBzb3VyY2UsIHBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4oKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMSk7XG4gICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbVRvb2xiYXJXaWRnZXQocGx1Z2luLCBibG9jayksXG4gICAgICAgICAgICAgICAgc2lkZTogLTEsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgICAgICAgICBjb25zdCBlbmRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLmVuZExpbmUgKyAxKTtcbiAgICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBlbmRMaW5lLnRvLFxuICAgICAgICAgICAgICAgIERlY29yYXRpb24ud2lkZ2V0KHtcbiAgICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21PdXRwdXRXaWRnZXQocGx1Z2luLCBibG9jay5pZCksXG4gICAgICAgICAgICAgICAgICBzaWRlOiAxLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgICAgIGFkZExsdm1EZWNvcmF0aW9ucyhidWlsZGVyLCB0aGlzLnZpZXcsIGJsb2NrKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMsXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGNvbnRlbnQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9jay5pZCk7XG4gICAgICBjb25zdCByZW5kZXJlZCA9IHRoaXMucmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrLmlkLCByZXN1bHQpO1xuICAgICAgY29uc3QgZXhpc3RpbmdSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2suaWQpO1xuXG4gICAgICBpZiAoZXhpc3RpbmdSYW5nZSkge1xuICAgICAgICBsaW5lcy5zcGxpY2UoZXhpc3RpbmdSYW5nZS5zdGFydCwgZXhpc3RpbmdSYW5nZS5lbmQgLSBleGlzdGluZ1JhbmdlLnN0YXJ0ICsgMSwgLi4ucmVuZGVyZWQpO1xuICAgICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGxpbmVzLnNwbGljZShjdXJyZW50QmxvY2suZW5kTGluZSArIDEsIDAsIC4uLnJlbmRlcmVkKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZVBhdGg6IHN0cmluZywgYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgcmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrSWQpO1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cbiAgICAgIGxpbmVzLnNwbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kIC0gcmFuZ2Uuc3RhcnQgKyAxKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2tJZDogc3RyaW5nLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYm9keSA9IFtcbiAgICAgIGBydW5uZXI9JHtyZXN1bHQucnVubmVyTmFtZX1gLFxuICAgICAgYGV4aXQ9JHtyZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCxcbiAgICAgIGBkdXJhdGlvbj0ke3Jlc3VsdC5kdXJhdGlvbk1zfW1zYCxcbiAgICAgIGB0aW1lc3RhbXA9JHtyZXN1bHQuZmluaXNoZWRBdH1gLFxuICAgICAgcmVzdWx0LnN0ZG91dCA/IGBzdGRvdXQ6XFxuJHtyZXN1bHQuc3Rkb3V0fWAgOiBcIlwiLFxuICAgICAgcmVzdWx0Lndhcm5pbmcgPyBgd2FybmluZzpcXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBcIlwiLFxuICAgICAgcmVzdWx0LnN0ZGVyciA/IGBzdGRlcnI6XFxuJHtyZXN1bHQuc3RkZXJyfWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgcmV0dXJuIFtcbiAgICAgIGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YCxcbiAgICAgIFwiYGBgdGV4dFwiLFxuICAgICAgYm9keSxcbiAgICAgIFwiYGBgXCIsXG4gICAgICBcIjwhLS0gbG9vbTpvdXRwdXQ6ZW5kIC0tPlwiLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXM6IHN0cmluZ1tdLCBibG9ja0lkOiBzdHJpbmcpOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBjb25zdCBzdGFydE1hcmtlciA9IGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpICE9PSBzdGFydE1hcmtlcikge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgICAgaWYgKGxpbmVzW2pdLnRyaW0oKSA9PT0gXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIikge1xuICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiBpLCBlbmQ6IGogfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgImltcG9ydCB7IE5vdGljZSwgdHlwZSBBcHAsIHR5cGUgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgb3BlblN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4sIG5vcm1hbGl6ZSBhcyBub3JtYWxpemVGc1BhdGgsIHBvc2l4IGFzIHBvc2l4UGF0aCB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBsb29tQ29udGFpbmVyUnVudGltZSA9IFwiZG9ja2VyXCIgfCBcInBvZG1hblwiIHwgXCJxZW11XCIgfCBcIndzbFwiIHwgXCJjdXN0b21cIjtcblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIGV4dGVuc2lvbj86IHN0cmluZztcbiAgdXNlRGVmYXVsdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBwb3NpdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xuICBzc2hUYXJnZXQ6IHN0cmluZztcbiAgcmVtb3RlV29ya3NwYWNlOiBzdHJpbmc7XG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIHNzaEFyZ3M/OiBzdHJpbmc7XG4gIHN0YXJ0Q29tbWFuZD86IHN0cmluZztcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xuICB0ZWFyZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgbWFuYWdlcj86IGxvb21RZW11TWFuYWdlckNvbmZpZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11TWFuYWdlckNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICBpbWFnZUZvcm1hdD86IHN0cmluZztcbiAgcGlkRmlsZT86IHN0cmluZztcbiAgbG9nRmlsZT86IHN0cmluZztcbiAgcmVhZGluZXNzVGltZW91dE1zPzogbnVtYmVyO1xuICByZWFkaW5lc3NJbnRlcnZhbE1zPzogbnVtYmVyO1xuICBib290RGVsYXlNcz86IG51bWJlcjtcbiAgc2h1dGRvd25Db21tYW5kPzogc3RyaW5nO1xuICBzaHV0ZG93blRpbWVvdXRNcz86IG51bWJlcjtcbiAga2lsbFNpZ25hbD86IE5vZGVKUy5TaWduYWxzO1xuICBwZXJzaXN0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Xc2xDb25maWcge1xuICBpbnRlcmFjdGl2ZT86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyQ29uZmlnIHtcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICB3c2w/OiBsb29tV3NsQ29uZmlnO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gIGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gIGFjdGlvbjogXCJidWlsZFwiIHwgXCJydW5cIiB8IFwidGVhcmRvd25cIjtcbiAgZ3JvdXBOYW1lOiBzdHJpbmc7XG4gIGdyb3VwUGF0aDogc3RyaW5nO1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGJ1aWxkPzogc3RyaW5nO1xuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xuICB0ZWFyZG93bj86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBzdHJpbmc7XG4gIGxhbmd1YWdlQWxpYXM/OiBzdHJpbmc7XG4gIGZpbGVOYW1lPzogc3RyaW5nO1xuICBmaWxlUGF0aD86IHN0cmluZztcbiAgY29tbWFuZD86IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIGNvbmZpZzoge1xuICAgIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gICAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gICAgcWVtdT86IGxvb21RZW11Q29uZmlnO1xuICAgIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIGxvb21Db250YWluZXJSdW5uZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1aWx0SW1hZ2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICApIHsgfVxuXG4gIGdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlOiBURmlsZSk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHZhbHVlID0gZnJvbnRtYXR0ZXI/LltcImxvb20tY29udGFpbmVyXCJdO1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGdldEdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XG4gICAgY29uc3QgY29udGFpbmVyc1BhdGggPSB0aGlzLmdldENvbnRhaW5lcnNQYXRoKCk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGNvbnRhaW5lcnNQYXRoKSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgICAgICBjb25zdCBncm91cFBhdGggPSBqb2luKGNvbnRhaW5lcnNQYXRoLCBlbnRyeS5uYW1lKTtcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcbiAgICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgICBpZiAoIWhhc0NvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IHBpZWNlcyA9IFtgcnVudGltZTogJHtjb25maWcucnVudGltZX1gXTtcbiAgICAgICAgICAgIGlmICgoY29uZmlnLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpICYmIGhhc0RvY2tlcmZpbGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8uc3NoVGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8ubWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgbWFuYWdlcjogJHthd2FpdCB0aGlzLmdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aCwgY29uZmlnLnFlbXUubWFuYWdlcil9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgY29uZmlnLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgd3JhcHBlcjogJHtjb25maWcuY3VzdG9tLmV4ZWN1dGFibGV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBsYW5ndWFnZUNvdW50ID0gT2JqZWN0LmtleXMoY29uZmlnLmxhbmd1YWdlcykubGVuZ3RoO1xuICAgICAgICAgICAgcGllY2VzLnB1c2goYCR7bGFuZ3VhZ2VDb3VudH0gbGFuZ3VhZ2Uke2xhbmd1YWdlQ291bnQgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IHBpZWNlcy5qb2luKFwiLCBcIiksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IGBpbnZhbGlkIGNvbmZpZy5qc29uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBncm91cE5hbWU6IHN0cmluZyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbmZpZ0xhbmcgPSBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlXSA/PyBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlQWxpYXNdO1xuXG4gICAgbGV0IGlzRmFsbGJhY2sgPSBmYWxzZTtcbiAgICBsZXQgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB8IG51bGwgPSBudWxsO1xuXG4gICAgaWYgKGNvbmZpZ0xhbmcpIHtcbiAgICAgIGlmIChjb25maWdMYW5nLnVzZURlZmF1bHQpIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxhbmd1YWdlID0gY29uZmlnTGFuZztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIGlzRmFsbGJhY2sgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UgfHwgIWxhbmd1YWdlLmNvbW1hbmQgfHwgIWxhbmd1YWdlLmV4dGVuc2lvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgZ3JvdXAgJHtncm91cE5hbWV9IGhhcyBubyBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICB9XG5cbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgY29uc3QgdGVtcEZpbGVOYW1lID0gYHRlbXBfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfSR7bm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbil9YDtcbiAgICBjb25zdCB0ZW1wRmlsZVBhdGggPSBqb2luKGdyb3VwUGF0aCwgdGVtcEZpbGVOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGVQYXRoLCBibG9jay5jb250ZW50LCBcInV0ZjhcIik7XG4gICAgICBsZXQgcmVzdWx0OiBsb29tUnVuUmVzdWx0O1xuICAgICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bk9jaUNvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5RZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b20oZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgYmxvY2ssIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIHRlbXBGaWxlUGF0aCwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bldzbENvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc0ZhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrTXNnID0gYFtMb29tXSBMYW5ndWFnZSAnJHtibG9jay5sYW5ndWFnZX0nIHdhcyBub3QgZGVjbGFyZWQgaW4gY29udGFpbmVyIGdyb3VwLiBSdW5uaW5nIHVzaW5nIGRlZmF1bHQgY29tbWFuZDogJHtsYW5ndWFnZS5jb21tYW5kfWA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtyZXN1bHQud2FybmluZ31cXG4ke2ZhbGxiYWNrTXNnfWAgOiBmYWxsYmFja01zZztcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHJtKHRlbXBGaWxlUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBidWlsZEdyb3VwKGdyb3VwTmFtZTogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICByZXR1cm4gdGhpcy5ydW5DdXN0b21XcmFwcGVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcImJ1aWxkXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcyksIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OndzbDpidWlsZGAsXG4gICAgICAgICAgYFdTTCAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICAgIGBXU0wgZW52aXJvbm1lbnQgJHtjb25maWcuaW1hZ2UgfHwgXCIoZGVmYXVsdClcIn0gZG9lcyBub3QgcmVxdWlyZSBhIGJ1aWxkIHN0ZXAuXFxuYCxcbiAgICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9jaUNvbnRhaW5lcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IGF3YWl0IHRoaXMucmVzb2x2ZUltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICBjb25zdCBjb21tYW5kID0gc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSkpO1xuICAgIGlmICghY29tbWFuZC5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcbiAgICAgIGFyZ3M6IFtcbiAgICAgICAgXCJydW5cIixcbiAgICAgICAgXCItLXJtXCIsXG4gICAgICAgIFwiLXZcIixcbiAgICAgICAgYCR7Z3JvdXBQYXRofTovd29ya3NwYWNlYCxcbiAgICAgICAgXCItd1wiLFxuICAgICAgICBcIi93b3Jrc3BhY2VcIixcbiAgICAgICAgaW1hZ2UsXG4gICAgICAgIC4uLmNvbW1hbmQsXG4gICAgICBdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blFlbXUoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS5zdGFydENvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnN0YXJ0YCwgYFFFTVUgJHtncm91cE5hbWV9IHN0YXJ0YCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmhlYWx0aGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZW1vdGVGaWxlID0gcG9zaXhQYXRoLmpvaW4ocWVtdS5yZW1vdGVXb3Jrc3BhY2UsIHRlbXBGaWxlTmFtZSk7XG4gICAgICBjb25zdCByZW1vdGVDb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCBzaGVsbFF1b3RlKHJlbW90ZUZpbGUpKTtcbiAgICAgIGlmICghcmVtb3RlQ29tbWFuZC50cmltKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBRRU1VICR7Z3JvdXBOYW1lfWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IHFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcInNzaFwiLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgLi4uc3BsaXRDb21tYW5kTGluZShxZW11LnNzaEFyZ3MgfHwgXCJcIiksXG4gICAgICAgICAgcWVtdS5zc2hUYXJnZXQsXG4gICAgICAgICAgYGNkICR7c2hlbGxRdW90ZShxZW11LnJlbW90ZVdvcmtzcGFjZSl9ICYmICR7cmVtb3RlQ29tbWFuZH1gLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS50ZWFyZG93bkNvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnRlYXJkb3duYCwgYFFFTVUgJHtncm91cE5hbWV9IHRlYXJkb3duYCk7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIHRlbXBGaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIGNvbmZpZyxcbiAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInJ1blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgIGNvbW1hbmQsXG4gICAgICB9KSxcbiAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgKTtcblxuICAgIGlmIChjb25maWcuY3VzdG9tPy50ZWFyZG93bikge1xuICAgICAgY29uc3QgdGVhcmRvd24gPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICAgIGdyb3VwTmFtZSxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBjb25maWcsXG4gICAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInRlYXJkb3duXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICAgIGNvbW1hbmQsXG4gICAgICAgIH0pLFxuICAgICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgICApO1xuICAgICAgaWYgKCF0ZWFyZG93bi5zdWNjZXNzKSB7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYEN1c3RvbSBydW50aW1lIHRlYXJkb3duIGZhaWxlZDogJHt0ZWFyZG93bi5zdGRlcnIgfHwgdGVhcmRvd24uc3Rkb3V0IHx8IGBleGl0ICR7dGVhcmRvd24uZXhpdENvZGV9YH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bldzbENvbnRhaW5lcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgd3NsR3JvdXBQYXRoID0gdGhpcy50cmFuc2xhdGVUb1dzbFBhdGgoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xuICAgIGlmICghY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIldTTCBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzaGVsbEZsYWdzID0gY29uZmlnLndzbD8uaW50ZXJhY3RpdmUgPyBbXCItaVwiLCBcIi1sXCIsIFwiLWNcIl0gOiBbXCItbFwiLCBcIi1jXCJdO1xuICAgIGNvbnN0IHdzbEFyZ3MgPSBbXCJiYXNoXCIsIC4uLnNoZWxsRmxhZ3MsIGBjZCBcIiR7d3NsR3JvdXBQYXRoLnJlcGxhY2VBbGwoJ1wiJywgJ1xcXFxcIicpfVwiICYmICR7Y29tbWFuZH1gXTtcbiAgICBpZiAoY29uZmlnLmltYWdlPy50cmltKCkpIHtcbiAgICAgIHdzbEFyZ3MudW5zaGlmdChcIi1kXCIsIGNvbmZpZy5pbWFnZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2xgLFxuICAgICAgcnVubmVyTmFtZTogYFdTTCAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogXCJ3c2xcIixcbiAgICAgIGFyZ3M6IHdzbEFyZ3MsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdHJhbnNsYXRlVG9Xc2xQYXRoKHdpbmRvd3NQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1hdGNoID0gd2luZG93c1BhdGgubWF0Y2goL14oW0EtWmEtel0pOlxcXFwoLiopLyk7XG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBkcml2ZSA9IG1hdGNoWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCByZXN0ID0gbWF0Y2hbMl0ucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgICByZXR1cm4gYC9tbnQvJHtkcml2ZX0vJHtyZXN0fWA7XG4gICAgfVxuICAgIGlmICh3aW5kb3dzUGF0aC5pbmNsdWRlcyhcIlxcXFxcIikpIHtcbiAgICAgIHJldHVybiB3aW5kb3dzUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICB9XG4gICAgcmV0dXJuIHdpbmRvd3NQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZG9ja2VyZmlsZSA9IGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIik7XG4gICAgaWYgKCFleGlzdHNTeW5jKGRvY2tlcmZpbGUpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwiO1xuICAgIH1cblxuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7dGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpfToke2ltYWdlfWA7XG4gICAgaWYgKHRoaXMuYnVpbHRJbWFnZXMuaGFzKGNhY2hlS2V5KSkge1xuICAgICAgcmV0dXJuIGltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRleHQuc2lnbmFsKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9IGJ1aWxkIGZhaWxlZCBmb3IgJHtncm91cE5hbWV9LmApO1xuICAgIH1cblxuICAgIHRoaXMuYnVpbHRJbWFnZXMuYWRkKGNhY2hlS2V5KTtcbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGlmICghZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICAgIGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgIGBObyBEb2NrZXJmaWxlIGNvbmZpZ3VyZWQuIFVzaW5nIGltYWdlICR7Y29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwifS5cXG5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXCJidWlsZFwiLCBcIi10XCIsIGltYWdlLCBncm91cFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBpZiAoIXFlbXUuYnVpbGRDb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCwgXCJObyBRRU1VIGJ1aWxkIGNvbW1hbmQgY29uZmlndXJlZC5cXG5cIik7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bkNvbW1hbmRMaW5lKHFlbXUuYnVpbGRDb21tYW5kLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRDb25maWcoZ3JvdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGxvb21Db250YWluZXJDb25maWc+IHtcbiAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIik7XG4gICAgbGV0IHJhdzogdW5rbm93bjtcbiAgICB0cnkge1xuICAgICAgcmF3ID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShjb25maWdQYXRoLCBcInV0ZjhcIikpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byByZWFkIGNvbnRhaW5lciBjb25maWcgJHtjb25maWdQYXRofTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSByYXcgYXMge1xuICAgICAgcnVudGltZT86IHVua25vd247XG4gICAgICBleGVjdXRhYmxlPzogdW5rbm93bjtcbiAgICAgIGltYWdlPzogdW5rbm93bjtcbiAgICAgIHdzbD86IHVua25vd247XG4gICAgICBoZWFsdGhDaGVjaz86IHVua25vd247XG4gICAgICBxZW11PzogdW5rbm93bjtcbiAgICAgIGN1c3RvbT86IHVua25vd247XG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xuICAgIH07XG4gICAgY29uc3QgcnVudGltZSA9IHRoaXMucmVhZFJ1bnRpbWUoZGF0YS5ydW50aW1lKTtcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBleGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGltYWdlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBsYW5ndWFnZXMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2xhbmd1YWdlLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YS5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93bjsgdXNlRGVmYXVsdD86IHVua25vd24gfTtcbiAgICAgIGNvbnN0IHVzZURlZmF1bHQgPSBsYW5ndWFnZUNvbmZpZy51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICBpZiAoIXVzZURlZmF1bHQgJiYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBkZWZpbmUgY29tbWFuZCBvciB1c2VEZWZhdWx0LmApO1xuICAgICAgfVxuXG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgOiB1bmRlZmluZWQsXG4gICAgICAgIGV4dGVuc2lvbjogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA6IHVzZURlZmF1bHQgPyB1bmRlZmluZWQgOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgICAgdXNlRGVmYXVsdDogdXNlRGVmYXVsdCB8fCB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBydW50aW1lLFxuICAgICAgZXhlY3V0YWJsZTogdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSA9PT0gXCJzdHJpbmdcIiAmJiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpID8gZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICB3c2w6IHRoaXMucmVhZFdzbENvbmZpZyhkYXRhLndzbCksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGhlYWx0aENoZWNrXCIpLFxuICAgICAgcWVtdTogdGhpcy5yZWFkUWVtdUNvbmZpZyhkYXRhLnFlbXUpLFxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxuICAgICAgbGFuZ3VhZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRSdW50aW1lKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lclJ1bnRpbWUge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gXCJkb2NrZXJcIjtcbiAgICB9XG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIiB8fCB2YWx1ZSA9PT0gXCJ3c2xcIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgY3VzdG9tLCBvciB3c2wuXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkV3NsQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVdzbENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHdzbCBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyB7IGludGVyYWN0aXZlPzogdW5rbm93biB9O1xuICAgIHJldHVybiB7XG4gICAgICBpbnRlcmFjdGl2ZTogZGF0YS5pbnRlcmFjdGl2ZSA9PT0gdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21RZW11Q29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuc3NoVGFyZ2V0ICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnNzaFRhcmdldC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5zc2hUYXJnZXQgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgZGF0YS5yZW1vdGVXb3Jrc3BhY2UgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnJlbW90ZVdvcmtzcGFjZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3NoVGFyZ2V0OiBkYXRhLnNzaFRhcmdldC50cmltKCksXG4gICAgICByZW1vdGVXb3Jrc3BhY2U6IGRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSxcbiAgICAgIHNzaEV4ZWN1dGFibGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3NoRXhlY3V0YWJsZSksXG4gICAgICBzc2hBcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEFyZ3MpLFxuICAgICAgc3RhcnRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnN0YXJ0Q29tbWFuZCksXG4gICAgICBidWlsZENvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGRDb21tYW5kKSxcbiAgICAgIHRlYXJkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93bkNvbW1hbmQpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LmhlYWx0aENoZWNrXCIpLFxuICAgICAgbWFuYWdlcjogdGhpcy5yZWFkUWVtdU1hbmFnZXJDb25maWcoZGF0YS5tYW5hZ2VyKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdU1hbmFnZXJDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdU1hbmFnZXJDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IGRhdGEuZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICBleGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmV4ZWN1dGFibGUpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGltYWdlOiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlKSxcbiAgICAgIGltYWdlRm9ybWF0OiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlRm9ybWF0KSxcbiAgICAgIHBpZEZpbGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEucGlkRmlsZSksXG4gICAgICBsb2dGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmxvZ0ZpbGUpLFxuICAgICAgcmVhZGluZXNzVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc1RpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXNcIiksXG4gICAgICByZWFkaW5lc3NJbnRlcnZhbE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc0ludGVydmFsTXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNc1wiKSxcbiAgICAgIGJvb3REZWxheU1zOiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcihkYXRhLmJvb3REZWxheU1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLmJvb3REZWxheU1zXCIpLFxuICAgICAgc2h1dGRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnNodXRkb3duQ29tbWFuZCksXG4gICAgICBzaHV0ZG93blRpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5zaHV0ZG93blRpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5zaHV0ZG93blRpbWVvdXRNc1wiKSxcbiAgICAgIGtpbGxTaWduYWw6IG9wdGlvbmFsU2lnbmFsKGRhdGEua2lsbFNpZ25hbCwgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5raWxsU2lnbmFsXCIpLFxuICAgICAgcGVyc2lzdDogdHlwZW9mIGRhdGEucGVyc2lzdCA9PT0gXCJib29sZWFuXCIgPyBkYXRhLnBlcnNpc3QgOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEN1c3RvbUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5leGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZXhlY3V0YWJsZTogZGF0YS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBidWlsZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZCksXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBvcHRpb25hbFN0cmluZyhkYXRhLmNvbW1hbmRTdHJ1Y3R1cmUpLFxuICAgICAgdGVhcmRvd246IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd24pLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uaGVhbHRoQ2hlY2tcIiksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEhlYWx0aENoZWNrKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0uY29tbWFuZCBtdXN0IGJlIGEgc3RyaW5nLmApO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgY29tbWFuZDogZGF0YS5jb21tYW5kLnRyaW0oKSxcbiAgICAgIHBvc2l0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEucG9zaXRpdmVSZXNwb25zZSA/PyBkYXRhLnBvc2l0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJwb3NpdGl2ZSByZXNwb25zZVwiXSA/PyBkYXRhLnBvc3NpdGl2ZVJlc3BvbnNlKSxcbiAgICAgIG5lZ2F0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEubmVnYXRpdmVSZXNwb25zZSA/PyBkYXRhLm5lZ2F0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJuZWdhdGl2ZSByZXNwb25zZVwiXSksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZVFlbXVDb25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbVFlbXVDb25maWcge1xuICAgIGlmICghY29uZmlnLnFlbXUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgcnVudGltZSByZXF1aXJlcyBhIHFlbXUgY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucWVtdTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcuY3VzdG9tKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBhIGN1c3RvbSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5jdXN0b207XG4gIH1cblxuICBwcml2YXRlIHJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IHN0cmluZyB7XG4gICAgaWYgKGNvbmZpZy5leGVjdXRhYmxlPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBjb25maWcuZXhlY3V0YWJsZS50cmltKCk7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIiA/IFwicG9kbWFuXCIgOiBcImRvY2tlclwiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5IZWFsdGhDaGVjayhcbiAgICBoZWFsdGhDaGVjazogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFoZWFsdGhDaGVjaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoaGVhbHRoQ2hlY2suY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBjb25zdCBjb21iaW5lZE91dHB1dCA9IGAke3Jlc3VsdC5zdGRvdXR9XFxuJHtyZXN1bHQuc3RkZXJyfWA7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UgJiYgY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSByZXR1cm5lZCBuZWdhdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSAmJiAhY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBkaWQgbm90IHJldHVybiBwb3NpdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT3B0aW9uYWxDb21tYW5kKFxuICAgIGNvbW1hbmQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShjb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Db21tYW5kTGluZShcbiAgICBjb21tYW5kOiBzdHJpbmcsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHBhcnRzID0gc3BsaXRDb21tYW5kTGluZShjb21tYW5kKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGNvbW1hbmQgaXMgZW1wdHkuYCk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHBhcnRzWzBdLFxuICAgICAgYXJnczogcGFydHMuc2xpY2UoMSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBleGlzdGluZ1BpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKGV4aXN0aW5nUGlkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhleGlzdGluZ1BpZCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nUGlkKSB7XG4gICAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtYW5hZ2VyLmV4ZWN1dGFibGUgfHwgXCJxZW11LXN5c3RlbS14ODZfNjRcIjtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGgsIG1hbmFnZXIpO1xuICAgIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gbmVlZHMgcWVtdS5tYW5hZ2VyLmFyZ3Mgb3IgcWVtdS5tYW5hZ2VyLmltYWdlLmApO1xuICAgIH1cblxuICAgIGNvbnN0IGxvZ1BhdGggPSBtYW5hZ2VyLmxvZ0ZpbGUgPyB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5sb2dGaWxlKSA6IG51bGw7XG4gICAgY29uc3QgbG9nRmQgPSBsb2dQYXRoID8gb3BlblN5bmMobG9nUGF0aCwgXCJhXCIpIDogbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICAgIGN3ZDogZ3JvdXBQYXRoLFxuICAgICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiXSxcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsICgpID0+IHVuZGVmaW5lZCk7XG4gICAgICBjaGlsZC51bnJlZigpO1xuXG4gICAgICBpZiAoIWNoaWxkLnBpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IGRpZCBub3QgcmV0dXJuIGEgcHJvY2VzcyBpZC5gKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHBpZFBhdGgsIGAke2NoaWxkLnBpZH1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAobG9nRmQgIT0gbnVsbCkge1xuICAgICAgICBjbG9zZVN5bmMobG9nRmQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShtYW5hZ2VyLmFyZ3MgfHwgXCJcIik7XG4gICAgaWYgKG1hbmFnZXIuaW1hZ2UpIHtcbiAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmltYWdlKTtcbiAgICAgIGFyZ3MucHVzaChcIi1kcml2ZVwiLCBgZmlsZT0ke2ltYWdlUGF0aH0saWY9dmlydGlvLGZvcm1hdD0ke21hbmFnZXIuaW1hZ2VGb3JtYXQgfHwgXCJxY293MlwifWApO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIHFlbXU6IGxvb21RZW11Q29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFxZW11LmhlYWx0aENoZWNrKSB7XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwobWFuYWdlci5ib290RGVsYXlNcyA/PyAwLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVvdXQgPSBNYXRoLm1pbihtYW5hZ2VyLnJlYWRpbmVzc1RpbWVvdXRNcyA/PyA2MF8wMDAsIE1hdGgubWF4KHRpbWVvdXRNcywgMSkpO1xuICAgIGNvbnN0IGludGVydmFsID0gbWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zID8/IDFfMDAwO1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgbGV0IGxhc3RFcnJvciA9IFwiXCI7XG5cbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0KSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3Mgd2FpdCBjYW5jZWxsZWQuYCk7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBNYXRoLm1pbihpbnRlcnZhbCwgdGltZW91dCksIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpyZWFkeWAsIGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3MgY2hlY2tgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoaW50ZXJ2YWwsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSBkaWQgbm90IGJlY29tZSByZWFkeSB3aXRoaW4gJHt0aW1lb3V0fSBtcyR7bGFzdEVycm9yID8gYDogJHtsYXN0RXJyb3J9YCA6IFwiLlwifWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkIHx8IG1hbmFnZXIucGVyc2lzdCAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWFuYWdlci5zaHV0ZG93bkNvbW1hbmQpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKFxuICAgICAgICBtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBNYXRoLm1pbihtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IHRpbWVvdXRNcywgdGltZW91dE1zKSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnNodXRkb3duYCxcbiAgICAgICAgYFFFTVUgJHtncm91cE5hbWV9IHNodXRkb3duYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgbWFuYWdlci5raWxsU2lnbmFsIHx8IFwiU0lHVEVSTVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdG9wcGVkID0gYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCBtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IDEwXzAwMCwgc2lnbmFsKTtcbiAgICBpZiAoIXN0b3BwZWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIFwiU0lHS0lMTFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgMl8wMDAsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm4gXCJzdG9wcGVkXCI7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSA/IGBydW5uaW5nIHBpZCAke3BpZH1gIDogYHN0YWxlIHBpZCAke3BpZH1gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkUGlkRmlsZShwaWRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSAoYXdhaXQgcmVhZEZpbGUocGlkUGF0aCwgXCJ1dGY4XCIpKS50cmltKCk7XG4gICAgICBjb25zdCBwaWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBpZCkgJiYgcGlkID4gMCA/IHBpZCA6IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUHJvY2Vzc1J1bm5pbmcocGlkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICB0cnkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgMCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JQcm9jZXNzRXhpdChwaWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXRNcykge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoMjUwLCBzaWduYWwpO1xuICAgIH1cbiAgICByZXR1cm4gIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b21XcmFwcGVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICByZXF1ZXN0OiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3QsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY3VzdG9tID0gdGhpcy5yZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjdXN0b20uaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbTpoZWFsdGhgLCBgQ3VzdG9tICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIGNvbnN0IHJlcXVlc3RGaWxlTmFtZSA9IGByZXF1ZXN0XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0uanNvbmA7XG4gICAgY29uc3QgcmVxdWVzdFBhdGggPSBqb2luKGdyb3VwUGF0aCwgcmVxdWVzdEZpbGVOYW1lKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RQYXRoLCBgJHtKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKX1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShjdXN0b20uYXJncyB8fCBcIntyZXF1ZXN0fVwiKS5tYXAoKGFyZykgPT5cbiAgICAgICAgYXJnXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgcmVxdWVzdFBhdGgpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXB9XCIsIGdyb3VwTmFtZSlcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cFBhdGh9XCIsIGdyb3VwUGF0aCksXG4gICAgICApO1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOiR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgcnVubmVyTmFtZTogYEN1c3RvbSAke2dyb3VwTmFtZX0gJHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBleGVjdXRhYmxlOiBjdXN0b20uZXhlY3V0YWJsZSxcbiAgICAgICAgYXJncyxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybShyZXF1ZXN0UGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUN1c3RvbVJlcXVlc3QoXG4gICAgYWN0aW9uOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3RbXCJhY3Rpb25cIl0sXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIGV4dHJhOiBQYXJ0aWFsPGxvb21DdXN0b21SdW50aW1lUmVxdWVzdD4gPSB7fSxcbiAgKTogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uLFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgcnVudGltZTogY29uZmlnLnJ1bnRpbWUsXG4gICAgICBpbWFnZTogY29uZmlnLmltYWdlLFxuICAgICAgYnVpbGQ6IGNvbmZpZy5jdXN0b20/LmJ1aWxkLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogY29uZmlnLmN1c3RvbT8uY29tbWFuZFN0cnVjdHVyZSxcbiAgICAgIHRlYXJkb3duOiBjb25maWcuY3VzdG9tPy50ZWFyZG93bixcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIGNvbmZpZzoge1xuICAgICAgICBleGVjdXRhYmxlOiBjb25maWcuZXhlY3V0YWJsZSxcbiAgICAgICAgY3VzdG9tOiBjb25maWcuY3VzdG9tLFxuICAgICAgICBxZW11OiBjb25maWcucWVtdSxcbiAgICAgICAgaGVhbHRoQ2hlY2s6IGNvbmZpZy5oZWFsdGhDaGVjayxcbiAgICAgIH0sXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTeW50aGV0aWNSZXN1bHQocnVubmVySWQ6IHN0cmluZywgcnVubmVyTmFtZTogc3RyaW5nLCBzdGRvdXQ6IHN0cmluZywgc3VjY2VzcyA9IHRydWUpOiBsb29tUnVuUmVzdWx0IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgZmluaXNoZWRBdDogbm93LFxuICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgIGV4aXRDb2RlOiBzdWNjZXNzID8gMCA6IC0xLFxuICAgICAgc3Rkb3V0LFxuICAgICAgc3RkZXJyOiBcIlwiLFxuICAgICAgc3VjY2VzcyxcbiAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q29udGFpbmVyc1BhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAodGhpcy5hcHAudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVOYW1lID0gYmFzZW5hbWUoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIXNhZmVOYW1lIHx8IHNhZmVOYW1lICE9PSBncm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbih0aGlzLmdldENvbnRhaW5lcnNQYXRoKCksIHNhZmVOYW1lKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aDogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChqb2luKGdyb3VwUGF0aCwgZmlsZVBhdGgpKTtcbiAgICBjb25zdCBub3JtYWxpemVkR3JvdXBQYXRoID0gbm9ybWFsaXplRnNQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgcG9zaXhTYWZlUGF0aCA9IHNhZmVQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIGNvbnN0IHBvc2l4R3JvdXBQYXRoID0gbm9ybWFsaXplZEdyb3VwUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBpZiAocG9zaXhTYWZlUGF0aCAhPT0gcG9zaXhHcm91cFBhdGggJiYgIXBvc2l4U2FmZVBhdGguc3RhcnRzV2l0aChgJHtwb3NpeEdyb3VwUGF0aH0vYCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBRRU1VIG1hbmFnZXIgcGF0aCBvdXRzaWRlIGNvbnRhaW5lciBncm91cDogJHtmaWxlUGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHNhZmVQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBsb29tLWNvbnRhaW5lci0ke2dyb3VwTmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy4tXS9nLCBcIi1cIil9YDtcbiAgfVxuXG4gIHB1YmxpYyBnZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ0lkOiBzdHJpbmcsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsIHtcbiAgICBpZiAoIWxhbmdJZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmdJZC50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblxuICAgIC8vIENoZWNrIGN1c3RvbSBsYW5ndWFnZXMgZmlyc3RcbiAgICBjb25zdCBjdXN0b20gPSBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgoYykgPT4ge1xuICAgICAgY29uc3QgbmFtZXMgPSBbYy5uYW1lLCAuLi5jLmFsaWFzZXMuc3BsaXQoXCIsXCIpLm1hcCgocykgPT4gcy50cmltKCkpXS5tYXAoKG4pID0+IG4udG9Mb3dlckNhc2UoKSk7XG4gICAgICByZXR1cm4gbmFtZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKGN1c3RvbSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZDogYCR7Y3VzdG9tLmV4ZWN1dGFibGV9ICR7Y3VzdG9tLmFyZ3N9YC50cmltKCksXG4gICAgICAgIGV4dGVuc2lvbjogY3VzdG9tLmV4dGVuc2lvbiB8fCBcIi50eHRcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU3RhbmRhcmQgYnVpbHQtaW5zXG4gICAgc3dpdGNoIChub3JtYWxpemVkKSB7XG4gICAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICBjYXNlIFwicHlcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgICAgY2FzZSBcImpzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwibm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICBjYXNlIFwidHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwidHMtbm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzaGVsbFwiOlxuICAgICAgY2FzZSBcInNoXCI6XG4gICAgICBjYXNlIFwiYmFzaFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNoZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJiYXNoXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zaFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1YnlcIjpcbiAgICAgIGNhc2UgXCJyYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1YnlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJiXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGVybFwiOlxuICAgICAgY2FzZSBcInBsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGVybEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGVybFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsdWFcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImx1YVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubHVhXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGhwXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGhwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJwaHBcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBocFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImdvXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuZ29FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdvXCJ9IHJ1biB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuZ29cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICBjYXNlIFwiaHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJydW5naGNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmhzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIGNhc2UgXCJtbFwiOlxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcImR1bmVcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZHVuZVwifSBleGVjIC0tIG9jYW1sIHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcIm9jYW1sY1wiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxjXCJ9IC1vIC90bXAvbG9vbS1vY2FtbCBcIiQxXCIgJiYgL3RtcC9sb29tLW9jYW1sYCksXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdjY1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLWMgJiYgL3RtcC9sb29tLWNgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIGNhc2UgXCJjKytcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnKytcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jcHAgJiYgL3RtcC9sb29tLWNwcGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuY3BwXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicnVzdFwiOlxuICAgICAgY2FzZSBcInJzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1c3RjXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tcnVzdCAmJiAvdG1wL2xvb20tcnVzdGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucnNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJqYXZhXCI6IHtcbiAgICAgICAgY29uc3QgY29tcGlsZXIgPSBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFjXCI7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGB0bXA9L3RtcC9sb29tLWphdmEtJCQgJiYgbWtkaXIgLXAgXCIkdG1wXCIgJiYgY3AgXCIkMVwiIFwiJHRtcC9NYWluLmphdmFcIiAmJiAke2NvbXBpbGVyfSBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhXCJ9IC1jcCBcIiR0bXBcIiBNYWluYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5qYXZhXCIsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgY2FzZSBcImxsdm1cIjpcbiAgICAgIGNhc2UgXCJsbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGxpXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImxlYW5cIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsZWFuXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY29xXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCkgfHwgXCJjb3FjXCJ9IC1xIHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic210bGliXCI6XG4gICAgICBjYXNlIFwic210XCI6XG4gICAgICBjYXNlIFwic210LWxpYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiejNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2ggLWxjICR7cXVvdGVDb21tYW5kQXJnKGNvbW1hbmQpfSBzaCB7ZmlsZX1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dEb2NrZXJOb3RpY2UobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UobWVzc2FnZSwgODAwMCk7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFNpZ25hbCh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IE5vZGVKUy5TaWduYWxzIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgIS9eU0lHW0EtWjAtOV0rJC8udGVzdCh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBzaWduYWwgbmFtZSBsaWtlIFNJR1RFUk0uYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIE5vZGVKUy5TaWduYWxzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzbGVlcFdpdGhTaWduYWwoZHVyYXRpb25NczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChkdXJhdGlvbk1zIDw9IDAgfHwgc2lnbmFsLmFib3J0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KHJlc29sdmUsIGR1cmF0aW9uTXMpO1xuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcnVudGltZUxhYmVsKHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lKTogc3RyaW5nIHtcbiAgc3dpdGNoIChydW50aW1lKSB7XG4gICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgcmV0dXJuIFwiRG9ja2VyXCI7XG4gICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgcmV0dXJuIFwiUG9kbWFuXCI7XG4gICAgY2FzZSBcInFlbXVcIjpcbiAgICAgIHJldHVybiBcIlFFTVVcIjtcbiAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICByZXR1cm4gXCJDdXN0b21cIjtcbiAgICBjYXNlIFwid3NsXCI6XG4gICAgICByZXR1cm4gXCJXU0xcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbFF1b3RlKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cblxuZnVuY3Rpb24gcXVvdGVDb21tYW5kQXJnKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cbiIsICJpbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVByb2Nlc3NTcGVjIHtcbiAgcnVubmVySWQ6IHN0cmluZztcbiAgcnVubmVyTmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBzaWduYWw6IEFib3J0U2lnbmFsO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kVGVtcGxhdGVkRW52KGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQsIHRlbXBGaWxlOiBzdHJpbmcsIHRlbXBEaXI6IHN0cmluZyk6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFlbnYpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnYpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBbXG4gICAgICBrZXksXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpIDogdmFsdWUsXG4gICAgXSksXG4gICk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIHNwbGl0Q29tbWFuZExpbmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgbGV0IHF1b3RlOiBcIidcIiB8IFwiXFxcIlwiIHwgbnVsbCA9IG51bGw7XG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3QgY2hhciBvZiBpbnB1dC50cmltKCkpIHtcbiAgICBpZiAoZXNjYXBpbmcpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgICAgIGVzY2FwaW5nID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGVzY2FwaW5nID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgoY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJcXFwiXCIpICYmICFxdW90ZSkge1xuICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IHF1b3RlKSB7XG4gICAgICBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcbiAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQpIHtcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuIiwgImltcG9ydCB7IERlY29yYXRpb24sIHR5cGUgRWRpdG9yVmlldyB9IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgdHlwZSB7IFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIExsdm1Ub2tlbiB7XG4gIGZyb206IG51bWJlcjtcbiAgdG86IG51bWJlcjtcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG59XG5cbmNvbnN0IExMVk1fS0VZV09SRFMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPihbXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29udHJvbFwiLCBbXG4gICAgXCJyZXRcIiwgXCJiclwiLCBcInN3aXRjaFwiLCBcImluZGlyZWN0YnJcIiwgXCJpbnZva2VcIiwgXCJjYWxsYnJcIiwgXCJyZXN1bWVcIiwgXCJ1bnJlYWNoYWJsZVwiLCBcImNsZWFudXByZXRcIiwgXCJjYXRjaHJldFwiLCBcImNhdGNoc3dpdGNoXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWRlY2xhcmF0aW9uXCIsIFtcbiAgICBcImRlZmluZVwiLCBcImRlY2xhcmVcIiwgXCJ0eXBlXCIsIFwiZ2xvYmFsXCIsIFwiY29uc3RhbnRcIiwgXCJhbGlhc1wiLCBcImlmdW5jXCIsIFwiY29tZGF0XCIsIFwiYXR0cmlidXRlc1wiLCBcInNlY3Rpb25cIiwgXCJnY1wiLCBcInByZWZpeFwiLCBcInByb2xvZ3VlXCIsXG4gICAgXCJwZXJzb25hbGl0eVwiLCBcInVzZWxpc3RvcmRlclwiLCBcInVzZWxpc3RvcmRlcl9iYlwiLCBcIm1vZHVsZVwiLCBcImFzbVwiLCBcInNvdXJjZV9maWxlbmFtZVwiLCBcInRhcmdldFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tZW1vcnlcIiwgW1xuICAgIFwiYWxsb2NhXCIsIFwibG9hZFwiLCBcInN0b3JlXCIsIFwiZ2V0ZWxlbWVudHB0clwiLCBcImZlbmNlXCIsIFwiY21weGNoZ1wiLCBcImF0b21pY3Jtd1wiLCBcImV4dHJhY3R2YWx1ZVwiLCBcImluc2VydHZhbHVlXCIsIFwiZXh0cmFjdGVsZW1lbnRcIixcbiAgICBcImluc2VydGVsZW1lbnRcIiwgXCJzaHVmZmxldmVjdG9yXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWFyaXRobWV0aWNcIiwgW1xuICAgIFwiYWRkXCIsIFwic3ViXCIsIFwibXVsXCIsIFwidWRpdlwiLCBcInNkaXZcIiwgXCJ1cmVtXCIsIFwic3JlbVwiLCBcInNobFwiLCBcImxzaHJcIiwgXCJhc2hyXCIsIFwiYW5kXCIsIFwib3JcIiwgXCJ4b3JcIiwgXCJmbmVnXCIsIFwiZmFkZFwiLCBcImZzdWJcIiwgXCJmbXVsXCIsXG4gICAgXCJmZGl2XCIsIFwiZnJlbVwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb21wYXJpc29uXCIsIFtcImljbXBcIiwgXCJmY21wXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jYXN0XCIsIFtcbiAgICBcInRydW5jXCIsIFwiemV4dFwiLCBcInNleHRcIiwgXCJmcHRydW5jXCIsIFwiZnBleHRcIiwgXCJmcHRvdWlcIiwgXCJmcHRvc2lcIiwgXCJ1aXRvZnBcIiwgXCJzaXRvZnBcIiwgXCJwdHJ0b2ludFwiLCBcImludHRvcHRyXCIsIFwiYml0Y2FzdFwiLCBcImFkZHJzcGFjZWNhc3RcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtb3RoZXJcIiwgW1wicGhpXCIsIFwic2VsZWN0XCIsIFwiZnJlZXplXCIsIFwiY2FsbFwiLCBcImxhbmRpbmdwYWRcIiwgXCJjYXRjaHBhZFwiLCBcImNsZWFudXBwYWRcIiwgXCJ2YV9hcmdcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1vZGlmaWVyXCIsIFtcbiAgICBcInByaXZhdGVcIiwgXCJpbnRlcm5hbFwiLCBcImF2YWlsYWJsZV9leHRlcm5hbGx5XCIsIFwibGlua29uY2VcIiwgXCJ3ZWFrXCIsIFwiY29tbW9uXCIsIFwiYXBwZW5kaW5nXCIsIFwiZXh0ZXJuX3dlYWtcIiwgXCJsaW5rb25jZV9vZHJcIiwgXCJ3ZWFrX29kclwiLFxuICAgIFwiZXh0ZXJuYWxcIiwgXCJkZWZhdWx0XCIsIFwiaGlkZGVuXCIsIFwicHJvdGVjdGVkXCIsIFwiZGxsaW1wb3J0XCIsIFwiZGxsZXhwb3J0XCIsIFwiZHNvX2xvY2FsXCIsIFwiZHNvX3ByZWVtcHRhYmxlXCIsIFwiZXh0ZXJuYWxseV9pbml0aWFsaXplZFwiLFxuICAgIFwidGhyZWFkX2xvY2FsXCIsIFwibG9jYWxkeW5hbWljXCIsIFwiaW5pdGlhbGV4ZWNcIiwgXCJsb2NhbGV4ZWNcIiwgXCJ1bm5hbWVkX2FkZHJcIiwgXCJsb2NhbF91bm5hbWVkX2FkZHJcIiwgXCJhdG9taWNcIiwgXCJ1bm9yZGVyZWRcIiwgXCJtb25vdG9uaWNcIixcbiAgICBcImFjcXVpcmVcIiwgXCJyZWxlYXNlXCIsIFwiYWNxX3JlbFwiLCBcInNlcV9jc3RcIiwgXCJzeW5jc2NvcGVcIiwgXCJ2b2xhdGlsZVwiLCBcInNpbmdsZXRocmVhZFwiLCBcImNjY1wiLCBcImZhc3RjY1wiLCBcImNvbGRjY1wiLCBcIndlYmtpdF9qc2NjXCIsXG4gICAgXCJhbnlyZWdjY1wiLCBcInByZXNlcnZlX21vc3RjY1wiLCBcInByZXNlcnZlX2FsbGNjXCIsIFwiY3h4X2Zhc3RfdGxzY2NcIiwgXCJzd2lmdGNjXCIsIFwidGFpbGNjXCIsIFwiY2ZndWFyZF9jaGVja2NjXCIsIFwidGFpbFwiLCBcIm11c3R0YWlsXCIsIFwibm90YWlsXCIsXG4gICAgXCJmYXN0XCIsIFwibm5hblwiLCBcIm5pbmZcIiwgXCJuc3pcIiwgXCJhcmNwXCIsIFwiY29udHJhY3RcIiwgXCJhZm5cIiwgXCJyZWFzc29jXCIsIFwibnV3XCIsIFwibnN3XCIsIFwiZXhhY3RcIiwgXCJpbmJvdW5kc1wiLCBcInRvXCIsIFwieFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tcHJlZGljYXRlXCIsIFtcbiAgICBcImVxXCIsIFwibmVcIiwgXCJ1Z3RcIiwgXCJ1Z2VcIiwgXCJ1bHRcIiwgXCJ1bGVcIiwgXCJzZ3RcIiwgXCJzZ2VcIiwgXCJzbHRcIiwgXCJzbGVcIiwgXCJvZXFcIiwgXCJvZ3RcIiwgXCJvZ2VcIiwgXCJvbHRcIiwgXCJvbGVcIiwgXCJvbmVcIiwgXCJvcmRcIiwgXCJ1ZXFcIiwgXCJ1bmVcIixcbiAgICBcInVub1wiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tYXR0cmlidXRlXCIsIFtcbiAgICBcImFsd2F5c2lubGluZVwiLCBcImFyZ21lbW9ubHlcIiwgXCJidWlsdGluXCIsIFwiYnlyZWZcIiwgXCJieXZhbFwiLCBcImNvbGRcIiwgXCJjb252ZXJnZW50XCIsIFwiZGVyZWZlcmVuY2VhYmxlXCIsIFwiZGVyZWZlcmVuY2VhYmxlX29yX251bGxcIiwgXCJkaXN0aW5jdFwiLFxuICAgIFwiaW1tYXJnXCIsIFwiaW5hbGxvY2FcIiwgXCJpbnJlZ1wiLCBcIm11c3Rwcm9ncmVzc1wiLCBcIm5lc3RcIiwgXCJub2FsaWFzXCIsIFwibm9jYWxsYmFja1wiLCBcIm5vY2FwdHVyZVwiLCBcIm5vZnJlZVwiLCBcIm5vaW5saW5lXCIsIFwibm9ubGF6eWJpbmRcIixcbiAgICBcIm5vbm51bGxcIiwgXCJub3JlY3Vyc2VcIiwgXCJub3JlZHpvbmVcIiwgXCJub3JldHVyblwiLCBcIm5vc3luY1wiLCBcIm5vdW53aW5kXCIsIFwibnVsbF9wb2ludGVyX2lzX3ZhbGlkXCIsIFwib3BhcXVlXCIsIFwib3B0bm9uZVwiLCBcIm9wdHNpemVcIixcbiAgICBcInByZWFsbG9jYXRlZFwiLCBcInJlYWRub25lXCIsIFwicmVhZG9ubHlcIiwgXCJyZXR1cm5lZFwiLCBcInJldHVybnNfdHdpY2VcIiwgXCJzYW5pdGl6ZV9hZGRyZXNzXCIsIFwic2FuaXRpemVfaHdhZGRyZXNzXCIsIFwic2FuaXRpemVfbWVtb3J5XCIsXG4gICAgXCJzYW5pdGl6ZV90aHJlYWRcIiwgXCJzaWduZXh0XCIsIFwic3BlY3VsYXRhYmxlXCIsIFwic3JldFwiLCBcInNzcFwiLCBcInNzcHJlcVwiLCBcInNzcHN0cm9uZ1wiLCBcInN3aWZ0YXN5bmNcIiwgXCJzd2lmdHNlbGZcIiwgXCJzd2lmdGVycm9yXCIsIFwidXd0YWJsZVwiLFxuICAgIFwid2lsbHJldHVyblwiLCBcIndyaXRlb25seVwiLCBcInplcm9leHRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWNvbnN0YW50XCIsIFtcInRydWVcIiwgXCJmYWxzZVwiLCBcIm51bGxcIiwgXCJub25lXCIsIFwidW5kZWZcIiwgXCJwb2lzb25cIiwgXCJ6ZXJvaW5pdGlhbGl6ZXJcIl0pLFxuXSk7XG5cbmNvbnN0IExMVk1fUFJJTUlUSVZFX1RZUEVTID0gbmV3IFNldChbXG4gIFwidm9pZFwiLCBcImxhYmVsXCIsIFwidG9rZW5cIiwgXCJtZXRhZGF0YVwiLCBcIng4Nl9tbXhcIiwgXCJ4ODZfYW14XCIsIFwiaGFsZlwiLCBcImJmbG9hdFwiLCBcImZsb2F0XCIsIFwiZG91YmxlXCIsIFwiZnAxMjhcIiwgXCJ4ODZfZnA4MFwiLCBcInBwY19mcDEyOFwiLCBcInB0clwiLFxuXSk7XG5cbmNvbnN0IFBVTkNUVUFUSU9OX0NMQVNTID0gXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodExsdm1FbGVtZW50KGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCwgc291cmNlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29kZUVsZW1lbnQuZW1wdHkoKTtcbiAgY29kZUVsZW1lbnQuYWRkQ2xhc3MoXCJsb29tLWxsdm0tY29kZVwiKTtcblxuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgbGluZXMuZm9yRWFjaCgobGluZSwgaW5kZXgpID0+IHtcbiAgICBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29kZUVsZW1lbnQsIGxpbmUpO1xuICAgIGlmIChpbmRleCA8IGxpbmVzLmxlbmd0aCAtIDEpIHtcbiAgICAgIGNvZGVFbGVtZW50LmFwcGVuZFRleHQoXCJcXG5cIik7XG4gICAgfVxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExsdm1EZWNvcmF0aW9ucyhcbiAgYnVpbGRlcjogUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+LFxuICB2aWV3OiBFZGl0b3JWaWV3LFxuICBibG9jazogbG9vbUNvZGVCbG9jayxcbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50TGluZUNvdW50ID0gZ2V0Q29udGVudExpbmVDb3VudChibG9jayk7XG4gIGlmICghY29udGVudExpbmVDb3VudCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbnRlbnRMaW5lQ291bnQ7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdID8/IFwiXCI7XG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVMbHZtTGluZShsaW5lKTtcbiAgICBpZiAoIXRva2Vucy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGRvY0xpbmUgPSB2aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDIgKyBpbmRleCk7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICAgIGlmICh0b2tlbi5mcm9tID09PSB0b2tlbi50bykge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi5mcm9tLFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi50byxcbiAgICAgICAgRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IHRva2VuLmNsYXNzTmFtZSB9KSxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsaW5lOiBzdHJpbmcpOiB2b2lkIHtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpKSB7XG4gICAgaWYgKHRva2VuLmZyb20gPiBjdXJzb3IpIHtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yLCB0b2tlbi5mcm9tKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3BhbiA9IGNvbnRhaW5lci5jcmVhdGVTcGFuKHsgY2xzOiB0b2tlbi5jbGFzc05hbWUgfSk7XG4gICAgc3Bhbi5zZXRUZXh0KGxpbmUuc2xpY2UodG9rZW4uZnJvbSwgdG9rZW4udG8pKTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIGlmIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9rZW5pemVMbHZtTGluZShsaW5lOiBzdHJpbmcpOiBMbHZtVG9rZW5bXSB7XG4gIGNvbnN0IHRva2VuczogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGluZGV4ID0gMDtcblxuICBhZGRMYWJlbFRva2VuKGxpbmUsIHRva2Vucyk7XG5cbiAgd2hpbGUgKGluZGV4IDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb25zdCBjdXJyZW50ID0gbGluZVtpbmRleF07XG4gICAgaWYgKGN1cnJlbnQgPT09IFwiO1wiKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogbGluZS5sZW5ndGgsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tY29tbWVudFwiIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY3VycmVudCkpIHtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdHJpbmdUb2tlbiA9IHJlYWRTdHJpbmdUb2tlbihsaW5lLCBpbmRleCk7XG4gICAgaWYgKHN0cmluZ1Rva2VuKSB7XG4gICAgICBpZiAoc3RyaW5nVG9rZW4ucHJlZml4RW5kID4gaW5kZXgpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHN0cmluZ1Rva2VuLnByZWZpeEVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmctcHJlZml4XCIgfSk7XG4gICAgICB9XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IHN0cmluZ1Rva2VuLnZhbHVlU3RhcnQsIHRvOiBzdHJpbmdUb2tlbi52YWx1ZUVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmdcIiB9KTtcbiAgICAgIGluZGV4ID0gc3RyaW5nVG9rZW4udmFsdWVFbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaGVkID1cbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BsbHZtXFwuW0EtWmEteiQuXzAtOV0rL3ksIFwibG9vbS1sbHZtLWludHJpbnNpY1wiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxAXFxkK1xcYi95LCBcImxvb20tbGx2bS1nbG9iYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbG9jYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvIVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8IVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbWV0YWRhdGFcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwkW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKi95LCBcImxvb20tbGx2bS1jb21kYXRcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvI1xcZCtcXGIveSwgXCJsb29tLWxsdm0tYXR0cmlidXRlLWdyb3VwXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcYmFkZHJzcGFjZVxccypcXChcXHMqXFxkK1xccypcXCkveSwgXCJsb29tLWxsdm0tdHlwZVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPzB4WzAtOUEtRmEtZl0rXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCt8XFxkKykoPzpbZUVdWy0rXT9cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT9cXGQrXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXC5cXC5cXC4veSwgXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIiwgdG9rZW5zKTtcblxuICAgIGlmIChtYXRjaGVkKSB7XG4gICAgICBpbmRleCA9IG1hdGNoZWQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB3b3JkID0gcmVhZFdvcmQobGluZSwgaW5kZXgpO1xuICAgIGlmICh3b3JkKSB7XG4gICAgICB0b2tlbnMucHVzaCh7XG4gICAgICAgIGZyb206IGluZGV4LFxuICAgICAgICB0bzogd29yZC5lbmQsXG4gICAgICAgIGNsYXNzTmFtZTogY2xhc3NpZnlXb3JkKHdvcmQudmFsdWUpLFxuICAgICAgfSk7XG4gICAgICBpbmRleCA9IHdvcmQuZW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKFwiKClbXXt9PD4sOj0qXCIuaW5jbHVkZXMoY3VycmVudCkpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBpbmRleCArIDEsIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MgfSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVUb2tlbnModG9rZW5zKTtcbn1cblxuZnVuY3Rpb24gYWRkTGFiZWxUb2tlbihsaW5lOiBzdHJpbmcsIHRva2VuczogTGx2bVRva2VuW10pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxccyopKD86KFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8XFxkKyl8KCVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrKSkoOikvKTtcbiAgaWYgKCFtYXRjaCB8fCBtYXRjaC5pbmRleCA9PSBudWxsKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGFiZWxTdGFydCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgY29uc3QgbGFiZWxUZXh0ID0gbWF0Y2hbMl0gPz8gbWF0Y2hbM107XG4gIGlmICghbGFiZWxUZXh0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tbGFiZWxcIixcbiAgfSk7XG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGggKyAxLFxuICAgIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MsXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjbGFzc2lmeVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKC9eaVxcZCskLy50ZXN0KHdvcmQpIHx8IExMVk1fUFJJTUlUSVZFX1RZUEVTLmhhcyh3b3JkKSkge1xuICAgIHJldHVybiBcImxvb20tbGx2bS10eXBlXCI7XG4gIH1cblxuICByZXR1cm4gTExWTV9LRVlXT1JEUy5nZXQod29yZCkgPz8gXCJsb29tLWxsdm0tcGxhaW5cIjtcbn1cblxuZnVuY3Rpb24gcmVhZFdvcmQobGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyB2YWx1ZTogc3RyaW5nOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gL1tBLVphLXpfXVtBLVphLXowLTlfLi1dKi95O1xuICBtYXRjaC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgcmVzdWx0ID0gbWF0Y2guZXhlYyhsaW5lKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdmFsdWU6IHJlc3VsdFswXSxcbiAgICBlbmQ6IG1hdGNoLmxhc3RJbmRleCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVhZFN0cmluZ1Rva2VuKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgcHJlZml4RW5kOiBudW1iZXI7IHZhbHVlU3RhcnQ6IG51bWJlcjsgdmFsdWVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGxldCBjdXJzb3IgPSBpbmRleDtcbiAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJjXCIgJiYgbGluZVtjdXJzb3IgKyAxXSA9PT0gXCJcXFwiXCIpIHtcbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIGlmIChsaW5lW2N1cnNvcl0gIT09IFwiXFxcIlwiKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB2YWx1ZVN0YXJ0ID0gY3Vyc29yO1xuICBjdXJzb3IgKz0gMTtcbiAgd2hpbGUgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGN1cnNvciArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcIlwiKSB7XG4gICAgICBjdXJzb3IgKz0gMTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJlZml4RW5kOiB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlU3RhcnQsXG4gICAgdmFsdWVFbmQ6IGN1cnNvcixcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hSZWdleFRva2VuKFxuICBsaW5lOiBzdHJpbmcsXG4gIGluZGV4OiBudW1iZXIsXG4gIHJlZ2V4OiBSZWdFeHAsXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxuICB0b2tlbnM6IExsdm1Ub2tlbltdLFxuKTogbnVtYmVyIHwgbnVsbCB7XG4gIHJlZ2V4Lmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMobGluZSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiByZWdleC5sYXN0SW5kZXgsIGNsYXNzTmFtZSB9KTtcbiAgcmV0dXJuIHJlZ2V4Lmxhc3RJbmRleDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVG9rZW5zKHRva2VuczogTGx2bVRva2VuW10pOiBMbHZtVG9rZW5bXSB7XG4gIHRva2Vucy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5mcm9tIC0gcmlnaHQuZnJvbSB8fCBsZWZ0LnRvIC0gcmlnaHQudG8pO1xuICBjb25zdCBub3JtYWxpemVkOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgIGlmICh0b2tlbi50byA8PSBjdXJzb3IpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZyb20gPSBNYXRoLm1heCh0b2tlbi5mcm9tLCBjdXJzb3IpO1xuICAgIG5vcm1hbGl6ZWQucHVzaCh7IC4uLnRva2VuLCBmcm9tIH0pO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG59XG5cbmZ1bmN0aW9uIGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBudW1iZXIge1xuICBpZiAoYmxvY2suZW5kTGluZSA9PT0gYmxvY2suc3RhcnRMaW5lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICBpZiAoYmxvY2suY29udGVudC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gYmxvY2suZW5kTGluZSA+IGJsb2NrLnN0YXJ0TGluZSArIDEgPyAxIDogMDtcbiAgfVxuXG4gIHJldHVybiBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gbWFwV29yZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHdvcmRzOiBzdHJpbmdbXSk6IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHtcbiAgcmV0dXJuIHdvcmRzLm1hcCgod29yZCkgPT4gW3dvcmQsIGNsYXNzTmFtZV0pO1xufVxuIiwgImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG9ydEhhc2goaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShpbnB1dCkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDE2KTtcbn1cbiIsICJpbXBvcnQgeyBzaG9ydEhhc2ggfSBmcm9tIFwiLi91dGlscy9oYXNoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IExBTkdVQUdFX0FMSUFTRVM6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+ID0ge1xuICBweXRob246IFwicHl0aG9uXCIsXG4gIHB5OiBcInB5dGhvblwiLFxuICBqYXZhc2NyaXB0OiBcImphdmFzY3JpcHRcIixcbiAganM6IFwiamF2YXNjcmlwdFwiLFxuICB0eXBlc2NyaXB0OiBcInR5cGVzY3JpcHRcIixcbiAgdHM6IFwidHlwZXNjcmlwdFwiLFxuICBvY2FtbDogXCJvY2FtbFwiLFxuICBtbDogXCJvY2FtbFwiLFxuICBjOiBcImNcIixcbiAgaDogXCJjXCIsXG4gIGNwcDogXCJjcHBcIixcbiAgY3h4OiBcImNwcFwiLFxuICBjYzogXCJjcHBcIixcbiAgXCJjKytcIjogXCJjcHBcIixcbiAgc2hlbGw6IFwic2hlbGxcIixcbiAgc2g6IFwic2hlbGxcIixcbiAgYmFzaDogXCJzaGVsbFwiLFxuICB6c2g6IFwic2hlbGxcIixcbiAgcnVieTogXCJydWJ5XCIsXG4gIHJiOiBcInJ1YnlcIixcbiAgcGVybDogXCJwZXJsXCIsXG4gIHBsOiBcInBlcmxcIixcbiAgbHVhOiBcImx1YVwiLFxuICBwaHA6IFwicGhwXCIsXG4gIGdvOiBcImdvXCIsXG4gIGdvbGFuZzogXCJnb1wiLFxuICBydXN0OiBcInJ1c3RcIixcbiAgcnM6IFwicnVzdFwiLFxuICBoYXNrZWxsOiBcImhhc2tlbGxcIixcbiAgaHM6IFwiaGFza2VsbFwiLFxuICBqYXZhOiBcImphdmFcIixcbiAgbGx2bTogXCJsbHZtLWlyXCIsXG4gIGxsdm1pcjogXCJsbHZtLWlyXCIsXG4gIFwibGx2bS1pclwiOiBcImxsdm0taXJcIixcbiAgbGw6IFwibGx2bS1pclwiLFxuICBsZWFuOiBcImxlYW5cIixcbiAgbGVhbjQ6IFwibGVhblwiLFxuICBjb3E6IFwiY29xXCIsXG4gIHY6IFwiY29xXCIsXG4gIHNtdDogXCJzbXRsaWJcIixcbiAgc210MjogXCJzbXRsaWJcIixcbiAgc210bGliOiBcInNtdGxpYlwiLFxuICBcInNtdC1saWJcIjogXCJzbXRsaWJcIixcbiAgejM6IFwic210bGliXCIsXG59O1xuXG5jb25zdCBPVVRQVVRfU1RBUlQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6c3RhcnRcXHMraWQ9KFthLWYwLTldKylcXHMqLS0+JC9pO1xuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xuY29uc3QgRkVOQ0VfU1RBUlQgPSAvXihgYGArfH5+fispXFxzKihbXlxcc2BdKik/KC4qKSQvO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2UocmF3TGFuZ3VhZ2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTm9ybWFsaXplZExhbmd1YWdlIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pIHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgaWYgKG5hbWUgJiYgKG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKSkpIHtcbiAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gTEFOR1VBR0VfQUxJQVNFU1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICByZXR1cm4gW1xuICAgIC4uLk9iamVjdC5rZXlzKExBTkdVQUdFX0FMSUFTRVMpLFxuICAgIC4uLihzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4gW2xhbmd1YWdlLm5hbWUsIC4uLnBhcnNlQWxpYXNMaXN0KGxhbmd1YWdlLmFsaWFzZXMpXSksXG4gIF0ubWFwKChhbGlhcykgPT4gYWxpYXMudG9Mb3dlckNhc2UoKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29kZUJsb2NrW10ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBibG9ja3M6IGxvb21Db2RlQmxvY2tbXSA9IFtdO1xuICBsZXQgb3JkaW5hbCA9IDA7XG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcblxuICAgIGlmIChpbnNpZGVNYW5hZ2VkT3V0cHV0KSB7XG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZlbmNlTWF0Y2ggPSBsaW5lLm1hdGNoKEZFTkNFX1NUQVJUKTtcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0TGluZSA9IGk7XG4gICAgY29uc3QgZmVuY2VJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKTtcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcbiAgICBjb25zdCBzb3VyY2VMYW5ndWFnZSA9IChmZW5jZU1hdGNoWzJdID8/IFwiXCIpLnRyaW0oKTtcbiAgICBjb25zdCBzb3VyY2VSZWZlcmVuY2UgPSBwYXJzZVNvdXJjZVJlZmVyZW5jZShmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gbm9ybWFsaXplTGFuZ3VhZ2Uoc291cmNlTGFuZ3VhZ2UsIHNldHRpbmdzKTtcblxuICAgIGxldCBlbmRMaW5lID0gaTtcbiAgICBjb25zdCBjb250ZW50TGluZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgY29uc3QgaW5uZXJMaW5lID0gbGluZXNbal07XG4gICAgICBjb25zdCB0cmltbWVkID0gaW5uZXJMaW5lLnRyaW0oKTtcblxuICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChmZW5jZVRva2VuKSAmJiAvXihgYGArfH5+fispXFxzKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgICAgZW5kTGluZSA9IGo7XG4gICAgICAgIGkgPSBqO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29udGVudExpbmVzLnB1c2goc3RyaXBGZW5jZUluZGVudChpbm5lckxpbmUsIGZlbmNlSW5kZW50KSk7XG4gICAgICBlbmRMaW5lID0gajtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBvcmRpbmFsICs9IDE7XG4gICAgY29uc3QgY29udGVudCA9IGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IHJlZmVyZW5jZUhhc2ggPSBzb3VyY2VSZWZlcmVuY2UgPyBgOiR7SlNPTi5zdHJpbmdpZnkoc291cmNlUmVmZXJlbmNlKX1gIDogXCJcIjtcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChgJHtjb250ZW50fSR7cmVmZXJlbmNlSGFzaH1gKTtcbiAgICBjb25zdCBpZCA9IHNob3J0SGFzaChgJHtmaWxlUGF0aH06JHtvcmRpbmFsfToke2xhbmd1YWdlfToke2NvbnRlbnRIYXNofWApO1xuXG4gICAgYmxvY2tzLnB1c2goe1xuICAgICAgaWQsXG4gICAgICBvcmRpbmFsLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGxhbmd1YWdlQWxpYXM6IHNvdXJjZUxhbmd1YWdlLnRvTG93ZXJDYXNlKCksXG4gICAgICBzb3VyY2VMYW5ndWFnZSxcbiAgICAgIGNvbnRlbnQsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBzdGFydExpbmUsXG4gICAgICBlbmRMaW5lLFxuICAgICAgZmVuY2VTdGFydDogMCxcbiAgICAgIGZlbmNlRW5kOiAwLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNvdXJjZVJlZmVyZW5jZShpbmZvVGFpbDogc3RyaW5nKTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGF0dHJzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhpbmZvVGFpbCk7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlSW5mb0F0dHJpYnV0ZXMoaW5wdXQ6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBjb25zdCBwYXR0ZXJuID0gLyhbQS1aYS16MC05Xy1dKylcXHMqPVxccyooPzpcIihbXlwiXSopXCJ8JyhbXiddKiknfChbXlxcc10rKSkvZztcbiAgbGV0IG1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuICB3aGlsZSAoKG1hdGNoID0gcGF0dGVybi5leGVjKGlucHV0KSkgIT0gbnVsbCkge1xuICAgIGF0dHJzW21hdGNoWzFdLnRvTG93ZXJDYXNlKCldID0gbWF0Y2hbMl0gPz8gbWF0Y2hbM10gPz8gbWF0Y2hbNF0gPz8gXCJcIjtcbiAgfVxuICByZXR1cm4gYXR0cnM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlTGluZVJhbmdlKHZhbHVlOiBzdHJpbmcpOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSB2YWx1ZS50cmltKCkubWF0Y2goL15MPyhcXGQrKSg/OlxccypbLTpdXFxzKkw/KFxcZCspKT8kL2kpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3Qgc3RhcnQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcbiAgY29uc3QgZW5kID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzJdID8/IG1hdGNoWzFdLCAxMCk7XG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcihzdGFydCkgfHwgIU51bWJlci5pc0ludGVnZXIoZW5kKSB8fCBzdGFydCA8PSAwIHx8IGVuZCA8IHN0YXJ0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZmluZEJsb2NrQXRMaW5lKGJsb2NrczogbG9vbUNvZGVCbG9ja1tdLCBsaW5lOiBudW1iZXIpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gIHJldHVybiBibG9ja3MuZmluZCgoYmxvY2spID0+IGxpbmUgPj0gYmxvY2suc3RhcnRMaW5lICYmIGxpbmUgPD0gYmxvY2suZW5kTGluZSkgPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzdHJpcEZlbmNlSW5kZW50KGxpbmU6IHN0cmluZywgZmVuY2VJbmRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghZmVuY2VJbmRlbnQpIHtcbiAgICByZXR1cm4gbGluZTtcbiAgfVxuXG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGZlbmNlSW5kZW50Lmxlbmd0aCAmJiBpbmRleCA8IGxpbmUubGVuZ3RoICYmIGxpbmVbaW5kZXhdID09PSBmZW5jZUluZGVudFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG5cbiAgcmV0dXJuIGxpbmUuc2xpY2UoaW5kZXgpO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOb2RlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJub2RlXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOb2RlLmpzXCI7XG4gIGxhbmd1YWdlcyA9IFtcImphdmFzY3JpcHRcIiwgXCJ0eXBlc2NyaXB0XCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPT09IFwidHN4XCIgPyBcIlR5cGVTY3JpcHQgKHRzeClcIiA6IFwiVHlwZVNjcmlwdCAodHMtbm9kZSlcIjtcblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7c2V0dGluZ3MudHlwZXNjcmlwdE1vZGV9YCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBDdXN0b21MYW5ndWFnZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiY3VzdG9tXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJDdXN0b20gbGFuZ3VhZ2VcIjtcbiAgbGFuZ3VhZ2VzID0gW10gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpPy5leGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBjdXN0b20gbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtsYW5ndWFnZS5uYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBsYW5ndWFnZS5uYW1lLFxuICAgICAgZXhlY3V0YWJsZTogbGFuZ3VhZ2UuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmFyZ3MgfHwgXCJ7ZmlsZX1cIiksXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uLCBsYW5ndWFnZS5uYW1lKSxcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBgLiR7bmFtZX1gO1xuICB9XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIEludGVycHJldGVkU3BlYyB7XG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncykgPT4gc3RyaW5nO1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG4gIG1pbmltdW1UaW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmNvbnN0IElOVEVSUFJFVEVEX1NQRUNTOiBJbnRlcnByZXRlZFNwZWNbXSA9IFtcbiAge1xuICAgIGxhbmd1YWdlOiBcInNoZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiU2hlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zaFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicnVieVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnJiXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwZXJsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUGVybFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGxcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImx1YVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkx1YVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBocFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBIUFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImdvXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiR29cIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgIGFyZ3M6IFtcInJ1blwiLCBcIntmaWxlfVwiXSxcbiAgICBlbnY6IHtcbiAgICAgIEdPQ0FDSEU6IFwie3RlbXBEaXJ9L2dvY2FjaGVcIixcbiAgICB9LFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbl07XG5cbmV4cG9ydCBjbGFzcyBJbnRlcnByZXRlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkludGVycHJldGVkXCI7XG4gIGxhbmd1YWdlcyA9IElOVEVSUFJFVEVEX1NQRUNTLm1hcCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSk7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICBpZiAoIXNwZWMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxuICAgICAgYXJnczogc3BlYy5hcmdzID8/IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IHNwZWMuZmlsZUV4dGVuc2lvbixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNwZWMubWluaW11bVRpbWVvdXRNcyA/PyAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBlbnY6IHNwZWMuZW52LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTcGVjKGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogSW50ZXJwcmV0ZWRTcGVjIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gSU5URVJQUkVURURfU1BFQ1MuZmluZCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSA9PT0gbGFuZ3VhZ2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIExsdm1SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImxsdm0taXJcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkxMVk0gSVJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGx2bS1pclwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiICYmIEJvb2xlYW4oc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxsXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzdWx0LnRpbWVkT3V0ICYmICFyZXN1bHQuY2FuY2VsbGVkICYmIHJlc3VsdC5leGl0Q29kZSAhPSBudWxsICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgaWYgKHJlc3VsdC5leGl0Q29kZSAhPT0gMCkge1xuICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYFByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS4gVW5kZXIgbGxpLCB0aGF0IGJlY29tZXMgdGhlIHByb2Nlc3MgZXhpdCBzdGF0dXMuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3Rkb3V0ID0gcmVzdWx0LmV4aXRDb2RlID09PSAwXG4gICAgICAgICAgPyBcIkxMVk0gcHJvZ3JhbSBleGl0ZWQgd2l0aCBjb2RlIDAuXCJcbiAgICAgICAgICA6IGBMTFZNIHByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS5cXG5Vc2Ugc3Rkb3V0IGluIHRoZSBJUiBpdHNlbGYgaWYgeW91IHdhbnQgcHJpbnRhYmxlIHByb2dyYW0gb3V0cHV0LmA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm1hbmFnZWQtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk1hbmFnZWQgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wicnVzdFwiLCBcImphdmFcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5SdXN0KGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuSmF2YShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blJ1c3QoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5yc1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSmF2YShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoXCJNYWluLmphdmFcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgaWYgKCFzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6c291cmNlYCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiB0ZW1wRGlyLFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIi1jcFwiLCB0ZW1wRGlyLCBcIk1haW5cIl0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5hdGl2ZS1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTmF0aXZlIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY3BwXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IGZpbGVFeHRlbnNpb24gPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIi5jXCIgOiBcIi5jcHBcIjtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCJDIChHQ0MpXCIgOiBcIkMrKyAoRysrKVwiO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShmaWxlRXh0ZW5zaW9uLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHJ1blRlbXBGaWxlUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE9jYW1sUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJvY2FtbFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiT0NhbWxcIjtcbiAgbGFuZ3VhZ2VzID0gW1wib2NhbWxcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcIm9jYW1sXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gc2V0dGluZ3Mub2NhbWxNb2RlO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpO1xuXG4gICAgaWYgKG1vZGUgPT09IFwib2NhbWxcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChtb2RlID09PSBcImR1bmVcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpkdW5lYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJEdW5lIC8gT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiZXhlY1wiLCBcIi0tXCIsIFwib2NhbWxcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5tbFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLWNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItb1wiLCBiaW5hcnlQYXRoLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLXJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQeXRob25SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInB5dGhvblwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHl0aG9uXCI7XG4gIGxhbmd1YWdlcyA9IFtcInB5dGhvblwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnB5XCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFByb29mUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJwcm9vZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJsZWFuXCIsIFwiY29xXCIsIFwic210bGliXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpsZWFuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJMZWFuXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNvcWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiQ29xXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKSxcbiAgICAgICAgYXJnczogW1wiLXFcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06c210bGliYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJTTVQtTElCIChaMylcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvb2YgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQgJiYgY29uZmlndXJlZCAhPT0gXCJjb3FjXCIpIHtcbiAgICByZXR1cm4gY29uZmlndXJlZDtcbiAgfVxuXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3BhbUNvcWMpID8gb3BhbUNvcWMgOiBjb25maWd1cmVkIHx8IFwiY29xY1wiO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tUnVubmVyUmVnaXN0cnkge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHJ1bm5lcnM6IGxvb21SdW5uZXJbXSkge31cblxuICBnZXRSdW5uZXJGb3JCbG9jayhibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21SdW5uZXIgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGhpcy5ydW5uZXJzLmZsYXRNYXAoKHJ1bm5lcikgPT4gcnVubmVyLmxhbmd1YWdlcykpXTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IHtcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxuICBoYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrOiBmYWxzZSxcbiAgcHJlc2VydmVTb3VyY2VNb2RlOiB0cnVlLFxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxuICB3b3JraW5nRGlyZWN0b3J5OiBcIlwiLFxuICBweXRob25FeGVjdXRhYmxlOiBcInB5dGhvbjNcIixcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxuICB0eXBlc2NyaXB0TW9kZTogXCJ0cy1ub2RlXCIsXG4gIHR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZTogXCJ0cy1ub2RlXCIsXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxuICBvY2FtbEV4ZWN1dGFibGU6IFwib2NhbWxcIixcbiAgY0V4ZWN1dGFibGU6IFwiZ2NjXCIsXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXG4gIHNoZWxsRXhlY3V0YWJsZTogXCJiYXNoXCIsXG4gIHJ1YnlFeGVjdXRhYmxlOiBcInJ1YnlcIixcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxuICBsdWFFeGVjdXRhYmxlOiBcImx1YVwiLFxuICBwaHBFeGVjdXRhYmxlOiBcInBocFwiLFxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcbiAgcnVzdEV4ZWN1dGFibGU6IFwicnVzdGNcIixcbiAgaGFza2VsbEV4ZWN1dGFibGU6IFwicnVuZ2hjXCIsXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXG4gIGphdmFFeGVjdXRhYmxlOiBcImphdmFcIixcbiAgbGx2bUludGVycHJldGVyRXhlY3V0YWJsZTogXCJsbGlcIixcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxuICBjb3FFeGVjdXRhYmxlOiBcImNvcWNcIixcbiAgc210RXhlY3V0YWJsZTogXCJ6M1wiLFxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgY3VzdG9tTGFuZ3VhZ2VzOiBbXSxcbiAgcGRmRXhwb3J0TW9kZTogXCJib3RoXCIsXG4gIGRlZmF1bHRDb250YWluZXJHcm91cDogXCJcIixcbn07XG5cbmV4cG9ydCBjbGFzcyBsb29tU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4pIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJSdW4gc3VwcG9ydGVkIGNvZGUgZmVuY2VzIGRpcmVjdGx5IGZyb20gbm90ZXMgd2hpbGUgcHJlc2VydmluZyBuYXRpdmUgc3ludGF4IGhpZ2hsaWdodGluZy5cIiB9KTtcblxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcbiAgICB0aGlzLnJlbmRlckJ1aWx0SW5SdW50aW1lcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQnVpbHQtaW4gUnVudGltZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDdXN0b20gTGFuZ3VhZ2VzXCIpKTtcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb25cIiB9KTtcbiAgICBkZXRhaWxzLm9wZW4gPSBvcGVuO1xuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcbiAgICByZXR1cm4gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uLWJvZHlcIiB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyR2VuZXJhbFNldHRpbmdzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc2FibGVkIGJ5IGRlZmF1bHQuIGxvb20gcnVucyBjb2RlIG9uIHlvdXIgbG9jYWwgbWFjaGluZSBhbmQgZG9lcyBub3QgcHJvdmlkZSBzYW5kYm94aW5nLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB2YWx1ZTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiS2VlcCBsb29tIG5vdGVzIGluIHNvdXJjZSBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlByZXNlcnZlIHJhdyBmZW5jZWQgY29kZSBpbiB0aGUgZWRpdG9yIGluc3RlYWQgb2YgbGV0dGluZyBsaXZlIHByZXZpZXcgY29sbGFwc2UgcmVzZWFyY2ggc25pcHBldHMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlZmF1bHQgdGltZW91dFwiKVxuICAgICAgLnNldERlc2MoXCJNYXhpbXVtIGV4ZWN1dGlvbiB0aW1lIGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgbG9vbSB0ZXJtaW5hdGVzIHRoZSBwcm9jZXNzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCI4MDAwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBwYXJzZWQ7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV29ya2luZyBkaXJlY3RvcnlcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJWYXVsdCByb290XCIpLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxuICAgICAgLnNldERlc2MoXCJJbnNlcnQgbWFuYWdlZCBsb29tIG91dHB1dCBzZWN0aW9ucyBiZW5lYXRoIGNvZGUgYmxvY2tzIGluc3RlYWQgb2Yga2VlcGluZyByZXN1bHRzIHB1cmVseSBpbiB0aGUgVUkuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tcnVuIG9uIGZpbGUgb3BlblwiKVxuICAgICAgLnNldERlc2MoXCJSdW4gYWxsIHN1cHBvcnRlZCBibG9ja3MgaW4gdGhlIGFjdGl2ZSBub3RlIHdoZW4gaXQgb3BlbnMuIERpc2FibGVkIGJ5IGRlZmF1bHQuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3BlbiA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlBERiBleHBvcnQgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29kZVwiLCBcIkNvZGUgQmxvY2sgT25seVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvdXRwdXRcIiwgXCJPdXRwdXQgT25seVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9IHZhbHVlIGFzIFwiYm90aFwiIHwgXCJjb2RlXCIgfCBcIm91dHB1dFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQnVpbHRJblJ1bnRpbWVzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJOb2RlIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgSmF2YVNjcmlwdCBleGVjdXRpb24uXCIsIFwibm9kZUV4ZWN1dGFibGVcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVHlwZVNjcmlwdCBydW5uZXIgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgdHMtbm9kZSBvciB0c3ggZm9yIFR5cGVTY3JpcHQgYmxvY2tzLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHMtbm9kZVwiLCBcInRzLW5vZGVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJUeXBlU2NyaXB0IHRyYW5zcGlsZXIgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgdHMtbm9kZSBvciB0c3guXCIsIFwidHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9DYW1sIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxjXCIsIFwib2NhbWxjXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImR1bmVcIiwgXCJkdW5lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSA9IHZhbHVlIGFzIFwib2NhbWxcIiB8IFwib2NhbWxjXCIgfCBcImR1bmVcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk9DYW1sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIG9jYW1sLCBvY2FtbGMsIG9yIGR1bmUgZGVwZW5kaW5nIG9uIHRoZSBzZWxlY3RlZCBtb2RlLlwiLCBcIm9jYW1sRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDIGJsb2Nrcy5cIiwgXCJjRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNoZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNoZWxsLCBCYXNoLCBhbmQgc2ggYmxvY2tzLlwiLCBcInNoZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlJ1YnkgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUnVieSBibG9ja3MuXCIsIFwicnVieUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTHVhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEx1YSBibG9ja3MuXCIsIFwibHVhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlBIUCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQSFAgYmxvY2tzLlwiLCBcInBocEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUnVzdCBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIFJ1c3QgYmxvY2tzLlwiLCBcInJ1c3RFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSGFza2VsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBIYXNrZWxsIGJsb2Nrcy4gRGVmYXVsdHMgdG8gcnVuZ2hjLlwiLCBcImhhc2tlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBjb21waWxlZCBKYXZhIGJsb2Nrcy5cIiwgXCJqYXZhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxMVk0gSVIgaW50ZXJwcmV0ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgTExWTSBJUiBibG9ja3Mgd2l0aCBsbGkuXCIsIFwibGx2bUludGVycHJldGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDb3EgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgQ29xIGJsb2NrcyB3aXRoIGNvcWMuXCIsIFwiY29xRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNNVCBzb2x2ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNNVC1MSUIgYmxvY2tzLiBEZWZhdWx0cyB0byB6My5cIiwgXCJzbXRFeGVjdXRhYmxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChsaXN0RWwpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFkZCBjdXN0b20gbGFuZ3VhZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGxvY2FsIGNvbW1hbmQtYmFja2VkIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXG4gICAgICAgICAgICBhbGlhc2VzOiBcIlwiLFxuICAgICAgICAgICAgZXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLnR4dFwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY3VzdG9tIGxhbmd1YWdlcyBjb25maWd1cmVkLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xuICAgICAgZGV0YWlscy5vcGVuID0gdHJ1ZTtcbiAgICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogbGFuZ3VhZ2UubmFtZSB8fCBgQ3VzdG9tIGxhbmd1YWdlICR7aW5kZXggKyAxfWAgfSk7XG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiTmFtZVwiLCBcIk5vcm1hbGl6ZWQgbGFuZ3VhZ2UgaWQgdXNlZCBieSBsb29tLlwiLCBcIm5hbWVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXhlY3V0YWJsZVwiLCBcIkxvY2FsIGNvbW1hbmQgb3IgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRoLlwiLCBcImV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQXJndW1lbnRzXCIsIFwiU3BhY2Utc2VwYXJhdGVkIGFyZ3VtZW50cy4gVXNlIHtmaWxlfSBmb3IgdGhlIHRlbXAgc291cmNlIGZpbGUuXCIsIFwiYXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdmUgdGhpcyBjdXN0b20gbGFuZ3VhZ2UuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmxvb21QbHVnaW4uZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVGhlIGNvbnRhaW5lciBncm91cCB0byBydW4gY29kZSBibG9ja3MgaW4gYnkgZGVmYXVsdCBpZiB0aGUgbm90ZSBkb2VzIG5vdCBzcGVjaWZ5IG9uZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcIlwiLCBcIk5vbmVcIik7XG4gICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihncm91cC5uYW1lLCBncm91cC5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCB8fCBcIlwiKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFkZCBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwIGNvbmZpZ3VyYXRpb24gZm9sZGVyLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgbmV3IENvbnRhaW5lckdyb3VwTmFtZU1vZGFsKHRoaXMuYXBwLCBhc3luYyAoZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGNsZWFuTmFtZSA9IGdyb3VwTmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8tXS9nLCBcIi1cIik7XG4gICAgICAgICAgICAgIGlmICghY2xlYW5OYW1lKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgZ3JvdXAgbmFtZS5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgY29uc3QgZ3JvdXBSZWxhdGl2ZVBhdGggPSBgJHtwbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHtjbGVhbk5hbWV9YDtcbiAgICAgICAgICAgICAgY29uc3QgY29uZmlnUGF0aCA9IGAke2dyb3VwUmVsYXRpdmVQYXRofS9jb25maWcuanNvbmA7XG5cbiAgICAgICAgICAgICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgICAgICAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhncm91cFJlbGF0aXZlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGZvbGRlciBhbHJlYWR5IGV4aXN0cy5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci5ta2Rpcihncm91cFJlbGF0aXZlUGF0aCk7XG4gICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcnVudGltZTogXCJkb2NrZXJcIixcbiAgICAgICAgICAgICAgICBpbWFnZTogXCJ1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2VzOiB7XG4gICAgICAgICAgICAgICAgICBweXRob246IHtcbiAgICAgICAgICAgICAgICAgICAgY29tbWFuZDogXCJweXRob24zIHtmaWxlfVwiLFxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCJcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGVmYXVsdENvbmZpZywgbnVsbCwgMikpO1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKGBDb250YWluZXIgZ3JvdXAgXCIke2NsZWFuTmFtZX1cIiBjcmVhdGVkLmApO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY29udGFpbmVyLWdyb3VwLWxpc3RcIiB9KTtcbiAgICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xuICAgICAgICBsaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgICB0ZXh0OiBcIk5vIGNvbnRhaW5lciBncm91cHMgZm91bmQgaW4gLm9ic2lkaWFuL3BsdWdpbnMvbG9vbS9jb250YWluZXJzLlwiLFxuICAgICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxuICAgICAgICAgIC5zZXROYW1lKGdyb3VwLm5hbWUpXG4gICAgICAgICAgLnNldERlc2MoZ3JvdXAuc3RhdHVzKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQnVpbGQgLyByZWJ1aWxkXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uYnVpbGRDb250YWluZXJHcm91cChncm91cC5uYW1lKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkVkaXRcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIG5ldyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCh0aGlzLmxvb21QbHVnaW4sIGdyb3VwLm5hbWUsIHBsdWdpbkRpciwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYEVycm9yIGxvYWRpbmcgY29udGFpbmVyIGdyb3VwczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgY2xzOiBcImxvb20tc2V0dGluZ3MtZXJyb3JcIixcbiAgICAgICAgYXR0cjogeyBzdHlsZTogXCJjb2xvcjogdmFyKC0tdGV4dC1lcnJvcik7IGZvbnQtd2VpZ2h0OiBib2xkOyBtYXJnaW46IDFlbSAwO1wiIH1cbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5lcnJvcihcImxvb206IGZhaWxlZCB0byByZW5kZXIgY29udGFpbmVyIGdyb3VwczpcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gYXMgc3RyaW5nKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbUN1c3RvbUxhbmd1YWdlPihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICBrZXk6IEssXG4gICk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUobGFuZ3VhZ2Vba2V5XSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgbGFuZ3VhZ2Vba2V5XSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk6IHZvaWQge1xuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XG59XG5cbmNsYXNzIENvbnRhaW5lckdyb3VwTmFtZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIG5hbWUgPSBcIlwiO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TdWJtaXQ6IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk5ldyBDb250YWluZXIgR3JvdXAgTmFtZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJHcm91cCBOYW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSBsb3dlcmNhc2UgbGV0dGVycywgbnVtYmVycywgaHlwaGVucywgYW5kIHVuZGVyc2NvcmVzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5uYW1lID0gdmFsdWU7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU3VibWl0KHRoaXMubmFtZSk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIEVkaXRDb250YWluZXJHcm91cE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGFjdGl2ZVRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiID0gXCJnZW5lcmFsXCI7XG4gIHByaXZhdGUgY29uZmlnT2JqOiBhbnkgPSB7fTtcbiAgcHJpdmF0ZSByYXdKc29uVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgZG9ja2VyZmlsZVRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gIHByaXZhdGUgdGFiSGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSB0YWJDb250ZW50RWwhOiBIVE1MRWxlbWVudDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cE5hbWU6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TYXZlOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IGBFZGl0IENvbmZpZzogJHt0aGlzLmdyb3VwTmFtZX1gIH0pO1xuXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd0NvbmZpZyA9IGF3YWl0IGFkYXB0ZXIucmVhZChjb25maWdQYXRoKTtcbiAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZShyYXdDb25maWcpO1xuICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHJhd0NvbmZpZztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ291bGQgbm90IHJlYWQgY29uZmlndXJhdGlvbiBmaWxlLlwiKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGRvY2tlcmZpbGVQYXRoKSkge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gYXdhaXQgYWRhcHRlci5yZWFkKGRvY2tlcmZpbGVQYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGFpbmVyXCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIEhlYWRlclxuICAgIHRoaXMudGFiSGVhZGVyRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWhlYWRlclwiIH0pO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBDb250ZW50IEFyZWFcbiAgICB0aGlzLnRhYkNvbnRlbnRFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGVudFwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIEFjdGlvbnMgRm9vdGVyXG4gICAgY29uc3QgYWN0aW9ucyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1tb2RhbC1hY3Rpb25zXCIgfSk7XG4gICAgYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3Qgc2F2ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlNhdmVcIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcbiAgICBzYXZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVBbmRDbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlclRhYnMoKSB7XG4gICAgdGhpcy50YWJIZWFkZXJFbC5lbXB0eSgpO1xuICAgIGNvbnN0IHRhYnM6IEFycmF5PHsgaWQ6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgICAgIHsgaWQ6IFwiZ2VuZXJhbFwiLCBsYWJlbDogXCJHZW5lcmFsXCIgfSxcbiAgICAgIHsgaWQ6IFwibGFuZ3VhZ2VzXCIsIGxhYmVsOiBcIkxhbmd1YWdlc1wiIH0sXG4gICAgICB7IGlkOiBcImRvY2tlcmZpbGVcIiwgbGFiZWw6IFwiRG9ja2VyZmlsZVwiIH0sXG4gICAgICB7IGlkOiBcInJhd1wiLCBsYWJlbDogXCJSYXcgSlNPTlwiIH0sXG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgdGFiIG9mIHRhYnMpIHtcbiAgICAgIGNvbnN0IGJ0biA9IHRoaXMudGFiSGVhZGVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiB0YWIubGFiZWwsXG4gICAgICAgIGNsczogXCJsb29tLXRhYi1idG5cIiArICh0aGlzLmFjdGl2ZVRhYiA9PT0gdGFiLmlkID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKSxcbiAgICAgIH0pO1xuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5zd2l0Y2hUYWIodGFiLmlkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN3aXRjaFRhYih0YWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIikge1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHN3aXRjaGluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hY3RpdmVUYWIgPSB0YWI7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlckFjdGl2ZVRhYigpIHtcbiAgICB0aGlzLnRhYkNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJnZW5lcmFsXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyR2VuZXJhbFRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJsYW5ndWFnZXNcIikge1xuICAgICAgdGhpcy5yZW5kZXJMYW5ndWFnZXNUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZG9ja2VyZmlsZVwiKSB7XG4gICAgICB0aGlzLnJlbmRlckRvY2tlcmZpbGVUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRoaXMucmVuZGVyUmF3VGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJHZW5lcmFsVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIC8vIFJ1bnRpbWUgc2VsZWN0IGRyb3Bkb3duXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJ1bnRpbWVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHRoZSBjb250YWluZXIvZW52aXJvbm1lbnQgbWFuYWdlciBydW50aW1lLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkb2NrZXJcIiwgXCJEb2NrZXJcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicG9kbWFuXCIsIFwiUG9kbWFuXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIndzbFwiLCBcIldTTFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJxZW11XCIsIFwiUUVNVVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjdXN0b21cIiwgXCJDdXN0b21cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucnVudGltZSB8fCBcImRvY2tlclwiKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIC8vIENvbmRpdGlvbmFsIGltYWdlL2Rpc3RybyBuYW1lXG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIgPyBcIldTTCBEaXN0cm9cIiA6IFwiQmFzZSBJbWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgICAgICAgICA/IFwiT3B0aW9uYWwuIFRoZSB0YXJnZXQgV1NMIGRpc3RybyBuYW1lIChsZWF2ZSBlbXB0eSBmb3IgZGVmYXVsdCBkaXN0cm8pLlwiXG4gICAgICAgICAgICA6IFwiRmFsbGJhY2sgRG9ja2VyL1BvZG1hbiBpbWFnZSBpZiBubyBEb2NrZXJmaWxlIGlzIHByZXNlbnQuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5pbWFnZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouaW1hZ2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLndzbCkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wgPSB7fTtcbiAgICAgIH1cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlVzZSBJbnRlcmFjdGl2ZSBTaGVsbFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlVzZSBpbnRlcmFjdGl2ZSBsb2dpbiBzaGVsbCBmbGFncyAoLWkgLWwpIHRvIGVuc3VyZSB+Ly5iYXNocmMgaW5pdGlhbGl6YXRpb24gd29ya3MgKGUuZy4sIGZvciBOVk0pLlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPz8gZmFsc2UpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPSB2YWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgUUVNVSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5xZW11KSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUgPSB7IHNzaFRhcmdldDogXCJcIiwgcmVtb3RlV29ya3NwYWNlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBUYXJnZXRcIilcbiAgICAgICAgLnNldERlc2MoXCJTU0ggdGFyZ2V0IGFkZHJlc3MgKGUuZy4gdXNlckBob3N0bmFtZSBvciBsb2NhbGhvc3QgLXAgMjIyMikuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0IHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlJlbW90ZSBXb3Jrc3BhY2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdGUgZm9sZGVyIHBhdGggdG8gY29weSBjb2RlIHNuaXBwZXRzIGFuZCBydW4gY29tbWFuZHMgKGUuZy4sIC9ob21lL3VzZXIvd29ya3NwYWNlKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gUGF0aCB0byBTU0ggY2xpZW50IGV4ZWN1dGFibGUgKGRlZmF1bHRzIHRvIHNzaCkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQWRkaXRpb25hbCBTU0ggQ0xJIGZsYWdzLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIEN1c3RvbSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmN1c3RvbSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20gPSB7IGV4ZWN1dGFibGU6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJQYXRoIHRvIGN1c3RvbSBydW50aW1lIHdyYXBwZXIgZXhlY3V0YWJsZSBvciBzY3JpcHQuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQ29tbWFuZCBhcmd1bWVudHMuIFVzZSB7cmVxdWVzdH0gZm9yIEpTT04gY29uZmlnIHBhdGguXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckxhbmd1YWdlc1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJDb25maWd1cmVkIExhbmd1YWdlc1wiIH0pO1xuXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMpIHtcbiAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyA9IHt9O1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmdzTGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2VzLWxpc3RcIiB9KTtcbiAgICBjb25zdCBsYW5ndWFnZXMgPSBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgeyBjb21tYW5kPzogc3RyaW5nOyBleHRlbnNpb24/OiBzdHJpbmc7IHVzZURlZmF1bHQ/OiBib29sZWFuIH0+KTtcblxuICAgIGlmIChsYW5ndWFnZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBsYW5nc0xpc3RFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIk5vIGxhbmd1YWdlcyBjb25maWd1cmVkIGZvciB0aGlzIGdyb3VwLlwiLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoY29uc3QgW2xhbmdOYW1lLCBsYW5nQ29uZmlnXSBvZiBsYW5ndWFnZXMpIHtcbiAgICAgICAgY29uc3QgY2FyZCA9IGxhbmdzTGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlLWNhcmRcIiB9KTtcbiAgICAgICAgY2FyZC5jcmVhdGVFbChcInN0cm9uZ1wiLCB7IHRleHQ6IGxhbmdOYW1lLCBhdHRyOiB7IHN0eWxlOiBcImRpc3BsYXk6IGJsb2NrOyBtYXJnaW4tYm90dG9tOiAwLjVyZW07IGZvbnQtc2l6ZTogMS4xZW07XCIgfSB9KTtcblxuICAgICAgICBjb25zdCBpc0RlZmF1bHQgPSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPT09IHRydWU7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIlVzZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIklmIGNoZWNrZWQsIExvb20gd2lsbCBydW4gdGhpcyBsYW5ndWFnZSB1c2luZyBpdHMgYnVpbHQtaW4gY29tbWFuZHMvZXh0ZW5zaW9ucy5cIilcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcbiAgICAgICAgICAgICAgICAgIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5jb21tYW5kO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuZXh0ZW5zaW9uO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0O1xuICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkNvbW1hbmRcIilcbiAgICAgICAgICAuc2V0RGVzYyhcIkV4ZWN1dGlvbiBjb21tYW5kLiBVc2Uge2ZpbGV9IGZvciB0aGUgY29kZSBzbmlwcGV0IGZpbGVuYW1lLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJFeHRlbnNpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIlNvdXJjZSBmaWxlIGV4dGVuc2lvbiAoZS5nLiAucHksIC5qcykuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICAgIGJ0blxuICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBMYW5ndWFnZVwiKVxuICAgICAgICAgICAgICAuc2V0V2FybmluZygpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW2xhbmdOYW1lXTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgTGFuZ3VhZ2UgU2VjdGlvblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkFkZCBMYW5ndWFnZSBNYXBwaW5nXCIsIGF0dHI6IHsgc3R5bGU6IFwibWFyZ2luLXRvcDogMS41cmVtO1wiIH0gfSk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkxhbmd1YWdlIElEXCIpXG4gICAgICAuc2V0RGVzYyhcImUuZy4gcHl0aG9uLCBqYXZhc2NyaXB0LCBub2RlLCBzaFwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLm5ld0xhbmd1YWdlTmFtZSkub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gdmFsLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCIrIEFkZFwiKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMubmV3TGFuZ3VhZ2VOYW1lKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiUGxlYXNlIGVudGVyIGEgbGFuZ3VhZ2UgbmFtZS5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgYWxyZWFkeSBjb25maWd1cmVkLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSA9IHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IGAke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfSB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBgLiR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9YCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyRG9ja2VyZmlsZVRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJkb2NrZXJcIiAmJiB0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcInBvZG1hblwiKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRG9ja2VyZmlsZSBlZGl0aW5nIGlzIG9ubHkgYXZhaWxhYmxlIGZvciBEb2NrZXIgYW5kIFBvZG1hbiBydW50aW1lcy4gQ3VycmVudGx5IHVzaW5nOiAke3RoaXMuY29uZmlnT2JqLnJ1bnRpbWV9YCxcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgPT09IG51bGwpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gRG9ja2VyZmlsZSBleGlzdHMgaW4gdGhpcyBjb250YWluZXIgZ3JvdXAgZGlyZWN0b3J5LlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgIGJ0blxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGUgRG9ja2VyZmlsZVwiKVxuICAgICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBbXG4gICAgICAgICAgICAgICAgXCJGUk9NIHVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICAgIFwiIyBJbnN0YWxsIHBhY2thZ2VzXCIsXG4gICAgICAgICAgICAgICAgXCJSVU4gYXB0LWdldCB1cGRhdGUgJiYgYXB0LWdldCBpbnN0YWxsIC15IFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBweXRob24zIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBub2RlanMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgICYmIHJtIC1yZiAvdmFyL2xpYi9hcHQvbGlzdHMvKlwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgIF0uam9pbihcIlxcblwiKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRG9ja2VyZmlsZSBDb250ZW50XCIpXG4gICAgICAgIC5zZXREZXNjKFwiRGVmaW5lIHRoZSBidWlsZCBzdGVwcyBmb3IgeW91ciBlbnZpcm9ubWVudCBjb250YWluZXIuXCIpXG4gICAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5kb2NrZXJmaWxlVGV4dCB8fCBcIlwiKTtcbiAgICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSB2YWw7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJhd1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICB0aGlzLnJhd0pzb25UZXh0ID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJDb25maWd1cmF0aW9uIEpTT05cIilcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLnJhd0pzb25UZXh0ID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUFuZENsb3NlKCkge1xuICAgIC8vIElmIHRoZSBhY3RpdmUgdGFiIGlzIHJhdyBKU09OLCBwYXJzZSBpdCBmaXJzdCB0byBlbnN1cmUgd2UgY2FwdHVyZSBlZGl0c1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHNhdmluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBCYXNpYyBWYWxpZGF0aW9uXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5ydW50aW1lKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUnVudGltZSBpcyByZXF1aXJlZC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIiAmJiAoIXRoaXMuY29uZmlnT2JqLnFlbXU/LnNzaFRhcmdldCB8fCAhdGhpcy5jb25maWdPYmoucWVtdT8ucmVtb3RlV29ya3NwYWNlKSkge1xuICAgICAgbmV3IE5vdGljZShcIlFFTVUgcnVudGltZSByZXF1aXJlcyBTU0ggVGFyZ2V0IGFuZCBSZW1vdGUgV29ya3NwYWNlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgIXRoaXMuY29uZmlnT2JqLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgbmV3IE5vdGljZShcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIEN1c3RvbSBFeGVjdXRhYmxlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG5cbiAgICB0cnkge1xuICAgICAgLy8gU2F2ZSBjb25maWcuanNvblxuICAgICAgY29uc3QgY29uZmlnU3RyID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBjb25maWdTdHIpO1xuXG4gICAgICAvLyBTYXZlIERvY2tlcmZpbGVcbiAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgIT09IG51bGwpIHtcbiAgICAgICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGRvY2tlcmZpbGVQYXRoLCB0aGlzLmRvY2tlcmZpbGVUZXh0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGNvbmZpZ3VyYXRpb25zIHNhdmVkLlwiKTtcbiAgICAgIHRoaXMub25TYXZlKCk7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFNhdmUgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG4gIH1cbn1cblxuXG5cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgU291cmNlUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNvdXJjZURlZmluaXRpb24gZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIG5hbWU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb250ZW50OiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbik6IGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IHNlbGVjdGVkUmFuZ2UgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgID8gZmluZFN5bWJvbFJhbmdlKGxpbmVzLCBsYW5ndWFnZSwgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGNvbGxlY3REZXBlbmRlbmN5U291cmNlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZSwgc2VsZWN0ZWQpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgICAgPyBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YFxuICAgICAgOiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9Okwke3NlbGVjdGVkUmFuZ2Uuc3RhcnQgKyAxfS1MJHtzZWxlY3RlZFJhbmdlLmVuZCArIDF9YCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZmluZExpbmVSYW5nZShsaW5lczogc3RyaW5nW10sIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoKHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gMSkgLSAxLCAwKTtcbiAgY29uc3QgZW5kID0gTWF0aC5taW4oKHJlZmVyZW5jZS5saW5lRW5kID8/IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbGluZXMubGVuZ3RoKSAtIDEsIGxpbmVzLmxlbmd0aCAtIDEpO1xuICBpZiAoc3RhcnQgPiBlbmQgfHwgc3RhcnQgPj0gbGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBmaW5kU3ltYm9sUmFuZ2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKTtcbiAgY29uc3QgZXhhY3QgPSBkZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiBkZWZpbml0aW9uLm5hbWUgPT09IHN5bWJvbE5hbWUpO1xuICBpZiAoZXhhY3QpIHtcbiAgICByZXR1cm4geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH07XG4gIH1cblxuICBjb25zdCBzeW1ib2xQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KHN5bWJvbE5hbWUpfVxcXFxiYCk7XG4gIGNvbnN0IGxpbmUgPSBsaW5lcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gc3ltYm9sUGF0dGVybi50ZXN0KGNhbmRpZGF0ZSkpO1xuICByZXR1cm4gbGluZSA+PSAwID8geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSwgc2VsZWN0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHByb2xvZ3VlID0gY29sbGVjdFByb2xvZ3VlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZS5zdGFydCk7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSlcbiAgICAuZmlsdGVyKChkZWZpbml0aW9uKSA9PiAhcmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSk7XG4gIGNvbnN0IHNlbGVjdGVkRGVmaW5pdGlvbnMgPSB0cmFjZURlZmluaXRpb25zKHNlbGVjdGVkLCBkZWZpbml0aW9ucywgbGluZXMpO1xuICByZXR1cm4gWy4uLnByb2xvZ3VlLCAuLi5zZWxlY3RlZERlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pKV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuZnVuY3Rpb24gdHJhY2VEZWZpbml0aW9ucyhzZWVkOiBzdHJpbmcsIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10sIGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IHNlbGVjdGVkOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgY29uc3Qgc2VsZWN0ZWROYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIGRlZmluaXRpb25zKSB7XG4gICAgICBpZiAoc2VsZWN0ZWROYW1lcy5oYXMoZGVmaW5pdGlvbi5uYW1lKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KGRlZmluaXRpb24ubmFtZSl9XFxcXGJgKS50ZXN0KGhheXN0YWNrKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkTmFtZXMuYWRkKGRlZmluaXRpb24ubmFtZSk7XG4gICAgICBzZWxlY3RlZC5wdXNoKGRlZmluaXRpb24pO1xuICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7cmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pfVxcbmA7XG4gICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc2VsZWN0ZWQuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc3RhcnQgLSByaWdodC5zdGFydCk7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQcm9sb2d1ZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBiZWZvcmVMaW5lOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHByb2xvZ3VlOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBtYXggPSBNYXRoLm1heChiZWZvcmVMaW5lLCAwKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1heDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGlzUHJvbG9ndWVMaW5lKGxpbmUsIGxhbmd1YWdlKSkge1xuICAgICAgcHJvbG9ndWUucHVzaChsaW5lKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHByb2xvZ3VlLmxlbmd0aCA/IFtwcm9sb2d1ZS5qb2luKFwiXFxuXCIpXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBpc1Byb2xvZ3VlTGluZShsaW5lOiBzdHJpbmcsIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gL14oZnJvbVxccytcXFMrXFxzK2ltcG9ydFxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIC9eKGltcG9ydFxccyt8ZXhwb3J0XFxzKy4qXFxzK2Zyb21cXHMrfCg/OmNvbnN0fGxldHx2YXIpXFxzK1xcdytcXHMqPVxccypyZXF1aXJlXFxzKlxcKCkvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImNcIjpcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInRhcmdldCBcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwic291cmNlX2ZpbGVuYW1lXCIpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gL14ocGFja2FnZVxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gY29sbGVjdFB5dGhvbkRlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eKD86ZXhwb3J0XFxzKyk/KD86YXN5bmNcXHMrKT9mdW5jdGlvblxccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT8oPzpjb25zdHxsZXR8dmFyKVxccysoW0EtWmEtel8kXVtcXHckXSopXFxzKj0vKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL15cXHMqKD86W1xcdzoqPD4sfl0rXFxzKykrKFtBLVphLXpfXVxcdyopXFxzKlxcKFteO10qXFwpXFxzKig/OmNvbnN0XFxzKik/XFx7Lyk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL15cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxhYnN0cmFjdHxcXHMpKlxccyooPzpjbGFzc3xpbnRlcmZhY2V8ZW51bXxyZWNvcmQpXFxzKyhbQS1aYS16X11cXHcqKVxcYnxeXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8c3luY2hyb25pemVkfG5hdGl2ZXxcXHMpK1tcXHc8PlxcW1xcXSwuP10rXFxzKyhbQS1aYS16X11cXHcqKVxccypcXChbXjtdKlxcKVxccypcXHsvKTtcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXlxccypkZWZpbmVcXGIuKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqXFwoLyk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2goL14oXFxzKikoPzphc3luY1xccyspPyg/OmRlZnxjbGFzcylcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZGVudCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgICBsZXQgc3RhcnQgPSBpbmRleDtcbiAgICB3aGlsZSAoc3RhcnQgPiAwICYmIGxpbmVzW3N0YXJ0IC0gMV0udHJpbSgpLnN0YXJ0c1dpdGgoXCJAXCIpICYmIGdldEluZGVudChsaW5lc1tzdGFydCAtIDFdKSA9PT0gaW5kZW50KSB7XG4gICAgICBzdGFydCAtPSAxO1xuICAgIH1cbiAgICBsZXQgZW5kID0gaW5kZXg7XG4gICAgZm9yIChsZXQgY3Vyc29yID0gaW5kZXggKyAxOyBjdXJzb3IgPCBsaW5lcy5sZW5ndGg7IGN1cnNvciArPSAxKSB7XG4gICAgICBpZiAobGluZXNbY3Vyc29yXS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmVzW2N1cnNvcl0pIDw9IGluZGVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGVuZCA9IGN1cnNvcjtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hdGNoWzJdLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBwYXR0ZXJuOiBSZWdFeHApOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaChwYXR0ZXJuKTtcbiAgICBjb25zdCBuYW1lID0gbWF0Y2g/LnNsaWNlKDEpLmZpbmQoQm9vbGVhbik7XG4gICAgaWYgKCFuYW1lKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gZmluZEJyYWNlUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFsaW5lc1tzdGFydF0uaW5jbHVkZXMoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIHN0YXJ0O1xuICB9XG5cbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHNhd0JyYWNlICYmIGRlcHRoIDw9IDApIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiByZW5kZXJSYW5nZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSk6IHN0cmluZyB7XG4gIHJldHVybiBsaW5lcy5zbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kICsgMSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gcmFuZ2VzT3ZlcmxhcChsZWZ0OiBTb3VyY2VSYW5nZSwgcmlnaHQ6IFNvdXJjZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBsZWZ0LnN0YXJ0IDw9IHJpZ2h0LmVuZCAmJiByaWdodC5zdGFydCA8PSBsZWZ0LmVuZDtcbn1cblxuZnVuY3Rpb24gZ2V0SW5kZW50KGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBsaW5lLm1hdGNoKC9eXFxzKi8pPy5bMF0ubGVuZ3RoID8/IDA7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ2V4KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIkNvcHkgY29kZVwiLCBcImNvcHlcIiwgaGFuZGxlcnMub25Db3B5LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJlbW92ZSBzbmlwcGV0XCIsIFwidHJhc2gtMlwiLCBoYW5kbGVycy5vblJlbW92ZSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XG5cbiAgcmV0dXJuIHRvb2xiYXI7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1dHRvbihsYWJlbDogc3RyaW5nLCBpY29uTmFtZTogc3RyaW5nLCBvbkNsaWNrOiAoKSA9PiB2b2lkLCBzcGlubmluZzogYm9vbGVhbik6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9IGBsb29tLXRvb2xiYXItYnV0dG9uJHtzcGlubmluZyA/IFwiIGlzLXJ1bm5pbmdcIiA6IFwiXCJ9YDtcbiAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XG4gIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBvbkNsaWNrKCk7XG4gIH0pO1xuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xuICByZXR1cm4gYnV0dG9uO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbVN0b3JlZE91dHB1dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICByZXR1cm4gb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpIHx8IG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpID8gXCJ3YXJuaW5nXCIgOiBcInN1Y2Nlc3NcIjtcbiAgfVxuXG4gIHJldHVybiBcImZhaWx1cmVcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtnZXRTdGF0dXNLaW5kKG91dHB1dCl9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn1gO1xuICBwYW5lbC5kYXRhc2V0Lmxvb21CbG9ja0lkID0gb3V0cHV0LmJsb2NrSWQ7XG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQpO1xuICByZXR1cm4gcGFuZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJPdXRwdXRQYW5lbChwYW5lbDogSFRNTEVsZW1lbnQsIG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IHZvaWQge1xuICBjb25zdCBraW5kID0gZ2V0U3RhdHVzS2luZChvdXRwdXQpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XG4gIHBhbmVsLmVtcHR5KCk7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBiYWRnZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYmFkZ2VcIiB9KTtcbiAgc2V0SWNvbihiYWRnZSwga2luZCA9PT0gXCJzdWNjZXNzXCIgPyBcImNoZWNrLWNpcmNsZS0yXCIgOiBraW5kID09PSBcIndhcm5pbmdcIiA/IFwiYWxlcnQtdHJpYW5nbGVcIiA6IFwieC1jaXJjbGVcIik7XG5cbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5ydW5uZXJOYW1lfSBcdTAwQjcgZXhpdCAke291dHB1dC5yZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCk7XG5cbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5kdXJhdGlvbk1zfSBtcyBcdTAwQjcgJHtuZXcgRGF0ZShvdXRwdXQucmVzdWx0LmZpbmlzaGVkQXQpLnRvTG9jYWxlVGltZVN0cmluZygpfWApO1xuXG4gIGNvbnN0IGJvZHkgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYm9keVwiIH0pO1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3Rkb3V0XCIsIG91dHB1dC5yZXN1bHQuc3Rkb3V0KTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVycik7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjb25zdCBlbXB0eSA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWVtcHR5XCIgfSk7XG4gICAgZW1wdHkuc2V0VGV4dChcIk5vIG91dHB1dFwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGFiZWw6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xuICBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW0tbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gIHNlY3Rpb24uY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlXCIsIHRleHQ6IGNvbnRlbnQgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSdW5uaW5nUGFuZWwoKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1vdXRwdXQtcGFuZWwgaXMtcnVubmluZ1wiO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3Qgc3Bpbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zcGlubmVyXCIgfSk7XG4gIHNldEljb24oc3Bpbm5lciwgXCJsb2FkZXItY2lyY2xlXCIpO1xuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChcIlJ1bm5pbmdcIik7XG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICByZXR1cm4gcGFuZWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFTTztBQUNQLG1CQUE2QztBQUM3QyxJQUFBQyxlQUEyRTtBQUMzRSxJQUFBQyxlQUF3Qjs7O0FDWnhCLHNCQUE2QztBQUM3QyxnQkFBZ0Q7QUFDaEQsSUFBQUMsbUJBQXdEO0FBQ3hELElBQUFDLGVBQWlGO0FBQ2pGLElBQUFDLHdCQUFzQjs7O0FDSnRCLHNCQUF1QztBQUN2QyxnQkFBdUI7QUFDdkIsa0JBQXFCO0FBQ3JCLDJC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QUFBQSxNQUNwQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSx1QkFBdUIsT0FBaUIsU0FBd0Q7QUFDdEcsVUFBTSxjQUFjLDZCQUE2QixPQUFPO0FBQ3hELGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUN4QyxVQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxhQUFhO0FBQ25DO0FBQUEsTUFDRjtBQUVBLGVBQVMsSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQzVDLFlBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLDRCQUE0QjtBQUNsRCxpQkFBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
