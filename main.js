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
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...spec.env
        }
      });
      child.stdin?.on("error", (error) => {
        if (error.code !== "EPIPE") {
          reject(error);
        }
      });
      if (spec.stdin != null) {
        child.stdin?.end(spec.stdin);
      } else {
        child.stdin?.destroy();
      }
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
      stdin: spec.stdin,
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
        ...context.stdin != null ? ["-i"] : [],
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        ...command
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        command,
        stdin: context.stdin
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
          command,
          stdin: context.stdin
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
      signal: context.signal,
      stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
      signal: context.signal,
      stdin: context.stdin
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
      signal: context.signal,
      stdin: context.stdin
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
      stdin: context.stdin,
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
        signal: context.signal,
        stdin: mode === "run" ? context.stdin : void 0
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
      signal: context.signal,
      stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
          signal: context.signal,
          stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
      signal: context.signal,
      stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
        signal: context.signal,
        stdin: context.stdin
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
  outputVisibleLines: 0,
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
    new import_obsidian3.Setting(containerEl).setName("Visible output lines").setDesc("Limit each stdout, stderr, and warning panel to this many visible lines. Use 0 for unlimited output.").addText(
      (text) => text.setPlaceholder("0").setValue(String(this.loomPlugin.settings.outputVisibleLines ?? 0)).onChange(async (value) => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          this.loomPlugin.settings.outputVisibleLines = Math.min(parsed, 2e3);
          await this.loomPlugin.saveSettings();
        }
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
  toolbar.appendChild(createButton("Toggle stdin input", "text-cursor-input", handlers.onToggleInput, false));
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
function createOutputPanel(output, options) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output, options);
  return panel;
}
function renderOutputPanel(panel, output, options) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const visibleLines = resolveVisibleLines(output, options.defaultVisibleLines);
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian5.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout, visibleLines);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning, visibleLines);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr, visibleLines);
  }
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content, visibleLines) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  const lineCount = countLines(content);
  section.createDiv({ cls: "loom-output-stream-label", text: formatStreamLabel(label, lineCount, visibleLines) });
  const pre = section.createEl("pre", { cls: "loom-output-pre", text: content });
  if (visibleLines > 0 && lineCount > visibleLines) {
    pre.addClass("is-scroll-limited");
    pre.style.setProperty("--loom-output-visible-lines", String(visibleLines));
  }
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
function resolveVisibleLines(output, defaultVisibleLines) {
  const override = output.block.attributes["loom-output-lines"] ?? output.block.attributes["output-lines"];
  if (override != null) {
    return normalizeVisibleLines(Number.parseInt(override.trim(), 10));
  }
  return normalizeVisibleLines(defaultVisibleLines);
}
function normalizeVisibleLines(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), 2e3);
}
function countLines(content) {
  return content.replace(/\n$/, "").split("\n").length;
}
function formatStreamLabel(label, lineCount, visibleLines) {
  if (visibleLines > 0 && lineCount > visibleLines) {
    return `${label} \xB7 ${lineCount} lines \xB7 showing ${visibleLines}`;
  }
  return label;
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
    this.plugin.renderOutputInto(this.block, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block, this.panelContainer);
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
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
  }
  eq(other) {
    return false;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.block, wrapper);
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
    this.stdinInputs = /* @__PURE__ */ new Map();
    this.stdinPanels = /* @__PURE__ */ new Set();
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
      onToggleInput: () => {
        if (this.stdinPanels.has(block.id)) {
          this.stdinPanels.delete(block.id);
        } else {
          this.stdinPanels.add(block.id);
        }
        this.notifyOutputChanged(block.id);
      },
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
  renderOutputInto(block, container) {
    container.empty();
    const blockId = block.id;
    if (this.shouldRenderStdinPanel(block)) {
      container.appendChild(this.createStdinPanel(block));
    }
    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }
    if (!output || !output.visible) {
      return;
    }
    container.appendChild(createOutputPanel(output, {
      defaultVisibleLines: this.settings.outputVisibleLines ?? 0
    }));
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
    const stdin = await this.resolveBlockStdin(file, block);
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal,
      stdin
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
      await this.writeOutputFileIfRequested(file, block, result);
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
            if (plugin.outputs.has(block.id) || plugin.running.has(block.id) || plugin.shouldRenderStdinPanel(block)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                import_view2.Decoration.widget({
                  widget: new loomOutputWidget(plugin, block),
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
  async writeOutputFileIfRequested(file, block, result) {
    try {
      const target = this.readOutputFileTarget(file, block);
      if (!target) {
        return;
      }
      await this.ensureVaultParentFolder(target.path);
      const rendered = target.format === "json" ? this.renderOutputFileJson(file, block, result, target) : this.renderOutputFileText(result, target);
      const current = target.mode === "append" && await this.app.vault.adapter.exists(target.path) ? await this.app.vault.adapter.read(target.path) : "";
      const next = target.mode === "append" && current ? `${current.replace(/\s*$/, "\n")}${rendered}` : rendered;
      await this.app.vault.adapter.write(target.path, next);
      const streamList = target.streams.join(",");
      const notice = `Wrote output file ${target.path} (${target.mode}, ${target.format}, ${streamList}).`;
      result.warning = result.warning ? `${notice}
${result.warning}` : notice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = `Failed to write output file: ${message}`;
      result.warning = result.warning ? `${notice}
${result.warning}` : notice;
    }
  }
  readOutputFileTarget(file, block) {
    const rawPath = block.attributes["loom-output-file"] ?? block.attributes["output-file"];
    if (!rawPath?.trim()) {
      return null;
    }
    return {
      path: this.resolveOutputVaultPath(file, rawPath),
      mode: this.readOutputFileMode(block),
      format: this.readOutputFileFormat(block),
      streams: this.readOutputFileStreams(block)
    };
  }
  readOutputFileMode(block) {
    const append = block.attributes["loom-output-append"] ?? block.attributes["output-append"];
    if (append && !["0", "false", "no", "off"].includes(append.trim().toLowerCase())) {
      return "append";
    }
    const mode = (block.attributes["loom-output-file-mode"] ?? block.attributes["output-file-mode"] ?? "replace").trim().toLowerCase();
    if (mode === "append") {
      return "append";
    }
    if (mode === "replace") {
      return "replace";
    }
    throw new Error(`Unsupported loom-output-file-mode: ${mode}. Use replace or append.`);
  }
  readOutputFileFormat(block) {
    const format = (block.attributes["loom-output-file-format"] ?? block.attributes["output-file-format"] ?? "text").trim().toLowerCase();
    if (format === "text" || format === "json") {
      return format;
    }
    throw new Error(`Unsupported loom-output-file-format: ${format}. Use text or json.`);
  }
  readOutputFileStreams(block) {
    const value = block.attributes["loom-output-file-streams"] ?? block.attributes["output-file-streams"] ?? "stdout";
    const parsed = value.split(",").map((stream) => stream.trim().toLowerCase()).filter(Boolean);
    const expanded = parsed.includes("all") ? ["metadata", "stdout", "warning", "stderr"] : parsed;
    const streams = expanded.map((stream) => {
      if (stream === "stdout" || stream === "stderr" || stream === "warning" || stream === "metadata") {
        return stream;
      }
      throw new Error(`Unsupported loom-output-file-streams entry: ${stream}.`);
    });
    return streams.length ? [...new Set(streams)] : ["stdout"];
  }
  resolveOutputVaultPath(file, rawPath) {
    const trimmed = rawPath.trim();
    if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      throw new Error("loom-output-file must be a vault-relative path.");
    }
    const path = trimmed.startsWith("/") ? (0, import_obsidian6.normalizePath)(trimmed.slice(1)) : (0, import_obsidian6.normalizePath)((0, import_path10.dirname)(file.path) === "." ? trimmed : `${(0, import_path10.dirname)(file.path)}/${trimmed}`);
    const parts = path.split("/").filter(Boolean);
    if (!parts.length || parts.includes("..") || path.startsWith(".obsidian/") || path === ".obsidian" || path.startsWith(".git/") || path === ".git") {
      throw new Error(`Invalid loom-output-file path: ${rawPath}`);
    }
    return path;
  }
  async ensureVaultParentFolder(path) {
    const folder = (0, import_path10.dirname)(path);
    if (!folder || folder === ".") {
      return;
    }
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
  renderOutputFileText(result, target) {
    const sections = target.streams.flatMap((stream) => {
      switch (stream) {
        case "metadata":
          return [
            `runner=${result.runnerName}`,
            `exit=${result.exitCode ?? "?"}`,
            `duration=${result.durationMs}ms`,
            `timestamp=${result.finishedAt}`
          ].join("\n");
        case "stdout":
          return result.stdout ? [result.stdout] : [];
        case "warning":
          return result.warning ? [result.warning] : [];
        case "stderr":
          return result.stderr ? [result.stderr] : [];
      }
    });
    return `${sections.join("\n\n").replace(/\s*$/, "")}
`;
  }
  renderOutputFileJson(file, block, result, target) {
    const payload = {
      note: file.path,
      blockId: block.id,
      language: block.language,
      runner: result.runnerName,
      exitCode: result.exitCode,
      success: result.success,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      streams: {
        ...target.streams.includes("stdout") ? { stdout: result.stdout } : {},
        ...target.streams.includes("warning") ? { warning: result.warning ?? "" } : {},
        ...target.streams.includes("stderr") ? { stderr: result.stderr } : {}
      }
    };
    return `${JSON.stringify(payload, null, 2)}
`;
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
  shouldRenderStdinPanel(block) {
    return this.stdinPanels.has(block.id) || this.hasEnabledStdinAttribute(block);
  }
  hasEnabledStdinAttribute(block) {
    const input = block.attributes["loom-input"] ?? block.attributes.input;
    if (input && !["0", "false", "no", "off"].includes(input.trim().toLowerCase())) {
      return true;
    }
    return block.attributes["loom-stdin"] != null || block.attributes.stdin != null || block.attributes["loom-stdin-file"] != null || block.attributes["stdin-file"] != null;
  }
  createStdinPanel(block) {
    const panel = document.createElement("div");
    panel.className = "loom-stdin-panel";
    const header = panel.createDiv({ cls: "loom-stdin-header" });
    header.createSpan({ text: "stdin" });
    const actions = header.createDiv({ cls: "loom-stdin-actions" });
    const runButton = actions.createEl("button", { text: "Run" });
    const clearButton = actions.createEl("button", { text: "Clear" });
    const textarea = panel.createEl("textarea", { cls: "loom-stdin-input" });
    textarea.placeholder = this.getStdinPlaceholder(block);
    textarea.value = this.stdinInputs.get(block.id) ?? block.attributes["loom-stdin"] ?? block.attributes.stdin ?? "";
    textarea.addEventListener("input", () => {
      this.stdinInputs.set(block.id, textarea.value);
    });
    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stdinInputs.set(block.id, textarea.value);
      void this.runActiveBlockById(block.id);
    });
    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      textarea.value = "";
      this.stdinInputs.set(block.id, "");
    });
    return panel;
  }
  getStdinPlaceholder(block) {
    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    return stdinFile ? `stdin file: ${stdinFile}` : "standard input for this block";
  }
  async resolveBlockStdin(file, block) {
    if (this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id);
    }
    const inline = block.attributes["loom-stdin"] ?? block.attributes.stdin;
    if (inline != null) {
      return decodeEscapedAttribute(inline);
    }
    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    if (!stdinFile?.trim()) {
      return void 0;
    }
    const stdinPath = this.resolveReferencedVaultPath(file, stdinFile);
    const inputFile = this.app.vault.getAbstractFileByPath(stdinPath);
    if (!(inputFile instanceof import_obsidian6.TFile)) {
      throw new Error(`stdin file not found: ${stdinPath}`);
    }
    return this.app.vault.cachedRead(inputFile);
  }
};
function decodeEscapedAttribute(value) {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "	");
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBFYnBmUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9lYnBmXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcbmltcG9ydCB7IGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xudHlwZSBsb29tT3V0cHV0RmlsZU1vZGUgPSBcInJlcGxhY2VcIiB8IFwiYXBwZW5kXCI7XG50eXBlIGxvb21PdXRwdXRGaWxlRm9ybWF0ID0gXCJ0ZXh0XCIgfCBcImpzb25cIjtcbnR5cGUgbG9vbU91dHB1dEZpbGVTdHJlYW0gPSBcInN0ZG91dFwiIHwgXCJzdGRlcnJcIiB8IFwid2FybmluZ1wiIHwgXCJtZXRhZGF0YVwiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dEZpbGVUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG1vZGU6IGxvb21PdXRwdXRGaWxlTW9kZTtcbiAgZm9ybWF0OiBsb29tT3V0cHV0RmlsZUZvcm1hdDtcbiAgc3RyZWFtczogbG9vbU91dHB1dEZpbGVTdHJlYW1bXTtcbn1cblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jaywgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgRWJwZlJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGRpbklucHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RkaW5QYW5lbHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24odGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlSW5wdXQ6ICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuc3RkaW5QYW5lbHMuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgICAgIHRoaXMuc3RkaW5QYW5lbHMuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnN0ZGluUGFuZWxzLmFkZChibG9jay5pZCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgICBvblRvZ2dsZU91dHB1dDogKCkgPT4ge1xuICAgICAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrLmlkKTtcbiAgICAgICAgaWYgKCFvdXRwdXQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgb3V0cHV0LnZpc2libGUgPSAhb3V0cHV0LnZpc2libGU7XG4gICAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyT3V0cHV0SW50byhibG9jazogbG9vbUNvZGVCbG9jaywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuICAgIGNvbnN0IGJsb2NrSWQgPSBibG9jay5pZDtcblxuICAgIGlmICh0aGlzLnNob3VsZFJlbmRlclN0ZGluUGFuZWwoYmxvY2spKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQodGhpcy5jcmVhdGVTdGRpblBhbmVsKGJsb2NrKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0LCB7XG4gICAgICBkZWZhdWx0VmlzaWJsZUxpbmVzOiB0aGlzLnNldHRpbmdzLm91dHB1dFZpc2libGVMaW5lcyA/PyAwLFxuICAgIH0pKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgaWYgKCFibG9jaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnJ1bm5pbmcuZ2V0KGJsb2NrSWQpPy5hYm9ydCgpO1xuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XG4gICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9ja0lkKTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFuYWdlZFJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XG4gICAgICBjb25zdCByZW1vdmFsRW5kID0gbWFuYWdlZFJhbmdlID8gbWFuYWdlZFJhbmdlLmVuZCA6IGN1cnJlbnRCbG9jay5lbmRMaW5lO1xuICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgcmVtb3ZhbEVuZCAtIHJlbW92YWxTdGFydCArIDEpO1xuXG4gICAgICB3aGlsZSAocmVtb3ZhbFN0YXJ0IDwgbGluZXMubGVuZ3RoIC0gMSAmJiBsaW5lc1tyZW1vdmFsU3RhcnRdID09PSBcIlwiICYmIGxpbmVzW3JlbW92YWxTdGFydCArIDFdID09PSBcIlwiKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIG5ldyBOb3RpY2UoXCJsb29tIHNuaXBwZXQgcmVtb3ZlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5BbGxCbG9ja3NJbkZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBzdXBwb3J0ZWRCbG9ja3MgPSBibG9ja3MuZmlsdGVyKChibG9jaykgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgICByZXR1cm4gZXhlY3V0aW9uQ29udGV4dC5jb250YWluZXJHcm91cCB8fCB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICB9KTtcblxuICAgIGlmICghc3VwcG9ydGVkQmxvY2tzLmxlbmd0aCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrcyBmb3VuZCBpbiB0aGUgY3VycmVudCBub3RlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIHN1cHBvcnRlZEJsb2Nrcykge1xuICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLnBhdGgsIGJsb2NrLmlkKTtcbiAgICB9XG4gICAgbmV3IE5vdGljZShcImxvb20gb3V0cHV0cyBjbGVhcmVkLlwiKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlLnBhdGg7XG4gICAgaWYgKHRoaXMucnVubmluZy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiVGhpcyBsb29tIGJsb2NrIGlzIGFscmVhZHkgcnVubmluZy5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5lbnN1cmVFeGVjdXRpb25FbmFibGVkKCkpKSB7XG4gICAgICBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBjb250YWluZXJHcm91cCA9IGV4ZWN1dGlvbkNvbnRleHQuY29udGFpbmVyR3JvdXA7XG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmICghY29udGFpbmVyR3JvdXApIHtcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBzdGRpbiA9IGF3YWl0IHRoaXMucmVzb2x2ZUJsb2NrU3RkaW4oZmlsZSwgYmxvY2spO1xuICAgIGNvbnN0IHJ1bkNvbnRleHQgPSB7XG4gICAgICBmaWxlLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBleGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICBzdGRpbixcbiAgICB9O1xuICAgIHRoaXMucnVubmluZy5zZXQoYmxvY2suaWQsIGNvbnRyb2xsZXIpO1xuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNvbHZlZEJsb2NrID0gYXdhaXQgdGhpcy5yZXNvbHZlRXhlY3V0YWJsZUJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKHJlc29sdmVkQmxvY2suYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MsIGNvbnRhaW5lckdyb3VwKVxuICAgICAgICA6IGF3YWl0IHJ1bm5lciEucnVuKHJlc29sdmVkQmxvY2suYmxvY2ssIHJ1bkNvbnRleHQsIHRoaXMuc2V0dGluZ3MpO1xuXG4gICAgICBpZiAocmVzdWx0LnRpbWVkT3V0KSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSByZXN1bHQuc3RkZXJyIHx8IGBFeGVjdXRpb24gdGltZWQgb3V0IGFmdGVyICR7dGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zfSBtcy5gO1xuICAgICAgfSBlbHNlIGlmIChyZXN1bHQuY2FuY2VsbGVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSByZXN1bHQuc3RkZXJyIHx8IFwiRXhlY3V0aW9uIGNhbmNlbGxlZC5cIjtcbiAgICAgIH0gZWxzZSBpZiAoIXJlc3VsdC5zdWNjZXNzICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gXCJQcm9jZXNzIGV4aXRlZCB1bnN1Y2Nlc3NmdWxseS5cIjtcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc29sdmVkQmxvY2suc291cmNlUHJldmlldykge1xuICAgICAgICBjb25zdCBzb3VyY2VOb3RpY2UgPSBgUmFuIGV4dHJhY3RlZCBzb3VyY2UgZnJvbSAke3Jlc29sdmVkQmxvY2suc291cmNlUHJldmlldy5kZXNjcmlwdGlvbn0uYDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3NvdXJjZU5vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBzb3VyY2VOb3RpY2U7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5oYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoZXhlY3V0aW9uQ29udGV4dCkpIHtcbiAgICAgICAgY29uc3QgY29udGV4dE5vdGljZSA9IHRoaXMuZm9ybWF0RXhlY3V0aW9uQ29udGV4dE5vdGljZShleGVjdXRpb25Db250ZXh0KTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke2NvbnRleHROb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogY29udGV4dE5vdGljZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMud3JpdGVPdXRwdXRGaWxlSWZSZXF1ZXN0ZWQoZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG5cbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIHNvdXJjZVByZXZpZXc6IHJlc29sdmVkQmxvY2suc291cmNlUHJldmlldyxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkge1xuICAgICAgICBhd2FpdCB0aGlzLndyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUsIGJsb2NrLCByZXN1bHQpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBydW5uZXJOYW1lID0gY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lciEuZGlzcGxheU5hbWU7XG4gICAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gcmFuICR7cnVubmVyTmFtZX0gYmxvY2suYCA6IGBsb29tIHJ1biBmYWlsZWQgZm9yICR7cnVubmVyTmFtZX0uYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgcnVubmVySWQ6IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lcjoke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmlkID8/IFwidW5rbm93blwiLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGNvbnRhaW5lckdyb3VwID8gYENvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmRpc3BsYXlOYW1lID8/IFwiVW5rbm93blwiLFxuICAgICAgICAgIHN0YXJ0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGZpbmlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgICBzdGRvdXQ6IFwiXCIsXG4gICAgICAgICAgc3RkZXJyOiBtZXNzYWdlLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBuZXcgTm90aWNlKGBsb29tIGVycm9yOiAke21lc3NhZ2V9YCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVFeGVjdXRpb25FbmFibGVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzaykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlPGJvb2xlYW4+KChyZXNvbHZlKSA9PiB7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xuICAgICAgY29uc3Qgc2V0dGxlID0gKHZhbHVlOiBib29sZWFuKSA9PiB7XG4gICAgICAgIGlmICghc2V0dGxlZCkge1xuICAgICAgICAgIHNldHRsZWQgPSB0cnVlO1xuICAgICAgICAgIHJlc29sdmUodmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtb2RhbCA9IG5ldyBFeGVjdXRpb25Db25zZW50TW9kYWwodGhpcy5hcHAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHRydWU7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHNldHRsZSh0cnVlKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvcmlnaW5hbENsb3NlID0gbW9kYWwuY2xvc2UuYmluZChtb2RhbCk7XG4gICAgICBtb2RhbC5jbG9zZSA9ICgpID0+IHtcbiAgICAgICAgb3JpZ2luYWxDbG9zZSgpO1xuICAgICAgICBzZXR0bGUodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spO1xuICAgICAgfTtcbiAgICAgIG1vZGFsLm9wZW4oKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHsgYmxvY2s6IGxvb21Db2RlQmxvY2s7IHNvdXJjZVByZXZpZXc/OiBsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXSB9PiB7XG4gICAgaWYgKCFibG9jay5zb3VyY2VSZWZlcmVuY2UpIHtcbiAgICAgIHJldHVybiB7IGJsb2NrIH07XG4gICAgfVxuXG4gICAgY29uc3QgcmVmZXJlbmNlUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgYmxvY2suc291cmNlUmVmZXJlbmNlLmZpbGVQYXRoKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHJlZmVyZW5jZVBhdGgpO1xuICAgIGlmICghKHNvdXJjZUZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVmZXJlbmNlZCBzb3VyY2UgZmlsZSBub3QgZm91bmQ6ICR7cmVmZXJlbmNlUGF0aH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYXJuZXNzID0gYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzKGJsb2NrKTtcbiAgICBjb25zdCBleHRlcm5hbEV4dHJhY3RvciA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2ssIGZpbGUpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UoXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKHNvdXJjZUZpbGUpLFxuICAgICAgeyAuLi5ibG9jay5zb3VyY2VSZWZlcmVuY2UsIGZpbGVQYXRoOiByZWZlcmVuY2VQYXRoIH0sXG4gICAgICBibG9jay5sYW5ndWFnZSxcbiAgICAgIGhhcm5lc3MsXG4gICAgICB7XG4gICAgICAgIHB5dGhvbkV4ZWN1dGFibGU6IHRoaXMuc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCIsXG4gICAgICAgIGV4dGVybmFsRXh0cmFjdG9yLFxuICAgICAgICByZWFkRmlsZTogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0ZWRGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZVBhdGgoZmlsZVBhdGgpKTtcbiAgICAgICAgICByZXR1cm4gaW1wb3J0ZWRGaWxlIGluc3RhbmNlb2YgVEZpbGUgPyB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGltcG9ydGVkRmlsZSkgOiBudWxsO1xuICAgICAgICB9LFxuICAgICAgICByZXNvbHZlUHl0aG9uSW1wb3J0OiBhc3luYyAoZnJvbUZpbGVQYXRoLCBtb2R1bGVOYW1lLCBsZXZlbCkgPT4gdGhpcy5yZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpLFxuICAgICAgfSxcbiAgICApO1xuICAgIGNvbnN0IGNhcGFiaWxpdHkgPSBnZXRMYW5ndWFnZUNhcGFiaWxpdHkoYmxvY2subGFuZ3VhZ2UsIEJvb2xlYW4oZXh0ZXJuYWxFeHRyYWN0b3IpKTtcbiAgICBjb25zdCBzaG91bGRTaG93UHJldmlldyA9ICh0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpICE9PSBcImhpZGRlblwiO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJsb2NrOiB7XG4gICAgICAgIC4uLmJsb2NrLFxuICAgICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgfSxcbiAgICAgIHNvdXJjZVByZXZpZXc6IHNob3VsZFNob3dQcmV2aWV3ID8ge1xuICAgICAgICBkZXNjcmlwdGlvbjogcmVzb2x2ZWQuZGVzY3JpcHRpb24sXG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgICAgY2FwYWJpbGl0eSxcbiAgICAgICAgZXhwYW5kZWQ6IHRoaXMuc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgPT09IFwiZXhwYW5kZWRcIixcbiAgICAgICAgc2hvd0NhcGFiaWxpdHlNZXRhZGF0YTogdGhpcy5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSxcbiAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZTogVEZpbGUsIHJlZmVyZW5jZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHJlZmVyZW5jZVBhdGgudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUGF0aCh0cmltbWVkLnNsaWNlKDEpKTtcbiAgICB9XG5cbiAgICBjb25zdCBiYXNlRGlyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIHJldHVybiBub3JtYWxpemVQYXRoKGJhc2VEaXIgPT09IFwiLlwiID8gdHJpbW1lZCA6IGAke2Jhc2VEaXJ9LyR7dHJpbW1lZH1gKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGg6IHN0cmluZywgbW9kdWxlTmFtZTogc3RyaW5nLCBsZXZlbDogbnVtYmVyKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgbW9kdWxlUGF0aCA9IG1vZHVsZU5hbWVcbiAgICAgIC5zcGxpdChcIi5cIilcbiAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIvXCIpO1xuICAgIGNvbnN0IGZyb21EaXIgPSBkaXJuYW1lKGZyb21GaWxlUGF0aCk7XG4gICAgY29uc3QgYmFzZURpcnMgPSBsZXZlbCA+IDBcbiAgICAgID8gW3RoaXMuYXNjZW5kVmF1bHRQYXRoKGZyb21EaXIgPT09IFwiLlwiID8gXCJcIiA6IGZyb21EaXIsIGxldmVsIC0gMSldXG4gICAgICA6IFtmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBcIlwiXTtcblxuICAgIGZvciAoY29uc3QgYmFzZURpciBvZiBiYXNlRGlycykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHRoaXMuZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyLCBtb2R1bGVQYXRoKTtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVBhdGgoY2FuZGlkYXRlKTtcbiAgICAgICAgaWYgKHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVkKSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyOiBzdHJpbmcsIG1vZHVsZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwcmVmaXggPSBiYXNlRGlyID8gYCR7YmFzZURpcn0vYCA6IFwiXCI7XG4gICAgaWYgKCFtb2R1bGVQYXRoKSB7XG4gICAgICByZXR1cm4gW2Ake3ByZWZpeH1fX2luaXRfXy5weWBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0ucHlgLFxuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0vX19pbml0X18ucHlgLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGFzY2VuZFZhdWx0UGF0aChwYXRoOiBzdHJpbmcsIGxldmVsczogbnVtYmVyKTogc3RyaW5nIHtcbiAgICBsZXQgY3VycmVudCA9IHBhdGg7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxldmVsczsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgbmV4dCA9IGRpcm5hbWUoY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gbmV4dCA9PT0gXCIuXCIgPyBcIlwiIDogbmV4dDtcbiAgICB9XG4gICAgcmV0dXJuIGN1cnJlbnQ7XG4gIH1cblxuICBhc3luYyBnZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRHcm91cFN1bW1hcmllcygpO1xuICB9XG5cbiAgYXN5bmMgYnVpbGRDb250YWluZXJHcm91cChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLmJ1aWxkR3JvdXAobmFtZSwgTWF0aC5tYXgodGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udHJvbGxlci5zaWduYWwpO1xuICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSBidWlsdCBjb250YWluZXIgZ3JvdXAgJHtuYW1lfS5gIDogYGxvb20gY29udGFpbmVyIGJ1aWxkIGZhaWxlZCBmb3IgJHtuYW1lfS5gLCA4MDAwKTtcbiAgfVxuXG4gIHJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGFsaWFzIG9mIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyh0aGlzLnNldHRpbmdzKSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEFsaWFzID0gYWxpYXMudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICh0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmhhcyhub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoL1teYS16QS1aMC05Xy1dLy50ZXN0KG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuYWRkKG5vcm1hbGl6ZWRBbGlhcyk7XG4gICAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3Iobm9ybWFsaXplZEFsaWFzLCBhc3luYyAoc291cmNlLCBlbCwgY3R4KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gY3R4LnNvdXJjZVBhdGg7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnVsbFRleHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgZnVsbFRleHQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gKGN0eCAmJiB0eXBlb2YgY3R4LmdldFNlY3Rpb25JbmZvID09PSBcImZ1bmN0aW9uXCIpID8gY3R4LmdldFNlY3Rpb25JbmZvKGVsKSA6IG51bGw7XG4gICAgICAgIGxldCBibG9jazogbG9vbUNvZGVCbG9jayB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKHNlY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBsaW5lU3RhcnQgPSBzZWN0aW9uLmxpbmVTdGFydDtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5zdGFydExpbmUgPT09IGxpbmVTdGFydCAmJiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJlID0gZWwucXVlcnlTZWxlY3RvcihcInByZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcHJlKSB7XG4gICAgICAgICAgcHJlID0gZWwuY3JlYXRlRWwoXCJwcmVcIik7XG4gICAgICAgICAgcHJlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb25zdCBjb2RlID0gcHJlLmNyZWF0ZUVsKFwiY29kZVwiKTtcbiAgICAgICAgICBjb2RlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb2RlLnNldFRleHQoc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICBjb25zdCBjb2RlID0gKHByZS5xdWVyeVNlbGVjdG9yKFwiY29kZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGwpID8/IHByZTtcbiAgICAgICAgICBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlLCBzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgY3R4LmFkZENoaWxkKG5ldyBsb29tVG9vbGJhclJlbmRlckNoaWxkKGVsLCB0aGlzLCBibG9jaywgcHJlKSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBjb25zdCBhY3RpdmVSdW5zID0gdGhpcy5ydW5uaW5nLnNpemU7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwuc2V0VGV4dChhY3RpdmVSdW5zID8gYGxvb206ICR7YWN0aXZlUnVuc30gQWN0aXZlIFJ1biR7YWN0aXZlUnVucyA9PT0gMSA/IFwiXCIgOiBcInNcIn1gIDogXCJsb29tOiBJZGxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZm9yRWFjaCgobGlzdGVuZXIpID0+IGxpc3RlbmVyKCkpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hBbGxWaWV3cygpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBNYXJrZG93blZpZXc7XG4gICAgICBjb25zdCBwcmV2aWV3TW9kZSA9ICh2aWV3IGFzIHsgcHJldmlld01vZGU/OiB7IHJlcmVuZGVyPzogKGZvcmNlPzogYm9vbGVhbikgPT4gdm9pZCB9IH0pLnByZXZpZXdNb2RlO1xuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xuICAgICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7IGVmZmVjdHM6IGxvb21SZWZyZXNoRWZmZWN0Lm9mKHVuZGVmaW5lZCkgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRBY3RpdmVNYXJrZG93bkZpbGUoKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICByZXR1cm4gdmlldz8uZmlsZSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgfVxuXG4gIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZih2aWV3LmxlYWYpO1xuICB9XG5cbiAgYXN5bmMgZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB2aWV3LmxlYWY7XG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHN0YXRlLnNvdXJjZSA9IGZhbHNlO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAuLi52aWV3U3RhdGUsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGVhZi5pc0RlZmVycmVkKSB7XG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBpZiAoISh2aWV3IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB8fCAhdmlldy5maWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlID0gdmlldy5lZGl0b3I/LmdldFZhbHVlPy4oKSA/PyAoYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh2aWV3LmZpbGUpKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN0YXRlLm1vZGUgPSBcInNvdXJjZVwiO1xuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XG5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAuLi52aWV3U3RhdGUsXG4gICAgICBzdGF0ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGU7XG4gICAgY29uc3QgZWRpdG9yID0gdmlldz8uZWRpdG9yO1xuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBibG9jay5pZCA9PT0gYmxvY2tJZCkgPz8gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSB7XG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcblxuICAgIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICAgIGNsYXNzIHtcbiAgICAgICAgZGVjb3JhdGlvbnM7XG5cbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmFkZCh2aWV3KTtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xuICAgICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGx1Z2luLmdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpO1xuICAgICAgICAgIGlmICghZmlsZVBhdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBzb3VyY2UsIHBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4oKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMSk7XG4gICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbVRvb2xiYXJXaWRnZXQocGx1Z2luLCBibG9jayksXG4gICAgICAgICAgICAgICAgc2lkZTogLTEsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSB8fCBwbHVnaW4uc2hvdWxkUmVuZGVyU3RkaW5QYW5lbChibG9jaykpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBjb250ZXh0LnNvdXJjZS5jb250YWluZXIgIT09IFwibm9uZVwiIHx8IGNvbnRleHQuc291cmNlLndvcmtpbmdEaXJlY3RvcnkgIT09IFwiZGVmYXVsdFwiIHx8IGNvbnRleHQuc291cmNlLnRpbWVvdXQgIT09IFwiZ2xvYmFsXCI7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGllY2VzID0gW1xuICAgICAgYGNvbnRhaW5lcj0ke2NvbnRleHQuY29udGFpbmVyR3JvdXAgPz8gXCJuYXRpdmVcIn0gKCR7Y29udGV4dC5zb3VyY2UuY29udGFpbmVyfSlgLFxuICAgICAgYGN3ZD0ke2NvbnRleHQud29ya2luZ0RpcmVjdG9yeX0gKCR7Y29udGV4dC5zb3VyY2Uud29ya2luZ0RpcmVjdG9yeX0pYCxcbiAgICAgIGB0aW1lb3V0PSR7Y29udGV4dC50aW1lb3V0TXN9bXMgKCR7Y29udGV4dC5zb3VyY2UudGltZW91dH0pYCxcbiAgICBdO1xuICAgIHJldHVybiBgRXhlY3V0aW9uIGNvbnRleHQ6ICR7cGllY2VzLmpvaW4oXCIsIFwiKX0uYDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGZpbGU6IFRGaWxlKTogeyBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjsgbGFuZ3VhZ2U6IHN0cmluZzsgZXhlY3V0YWJsZTogc3RyaW5nOyBhcmdzOiBzdHJpbmdbXTsgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nOyB0aW1lb3V0TXM6IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsYW5ndWFnZUlkID0gYmxvY2subGFuZ3VhZ2U7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmd1YWdlSWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBjYW5kaWRhdGUubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBjYW5kaWRhdGUuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIjtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gbW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gbGFuZ3VhZ2UudHJhbnNwaWxlRXhlY3V0YWJsZT8udHJpbSgpIDogbGFuZ3VhZ2UuZXh0cmFjdG9yRXhlY3V0YWJsZT8udHJpbSgpO1xuICAgIGNvbnN0IGFyZ3MgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVBcmdzIHx8IFwie3JlcXVlc3R9XCIgOiBsYW5ndWFnZS5leHRyYWN0b3JBcmdzIHx8IFwie3JlcXVlc3R9XCI7XG4gICAgaWYgKCFleGVjdXRhYmxlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIHJldHVybiB7XG4gICAgICBtb2RlLFxuICAgICAgbGFuZ3VhZ2U6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShhcmdzKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGV4ZWN1dGlvbkNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrLmlkKTtcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGhpcy5yZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2suaWQsIHJlc3VsdCk7XG4gICAgICBjb25zdCBleGlzdGluZ1JhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9jay5pZCk7XG5cbiAgICAgIGlmIChleGlzdGluZ1JhbmdlKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShleGlzdGluZ1JhbmdlLnN0YXJ0LCBleGlzdGluZ1JhbmdlLmVuZCAtIGV4aXN0aW5nUmFuZ2Uuc3RhcnQgKyAxLCAuLi5yZW5kZXJlZCk7XG4gICAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgbGluZXMuc3BsaWNlKGN1cnJlbnRCbG9jay5lbmRMaW5lICsgMSwgMCwgLi4ucmVuZGVyZWQpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlT3V0cHV0RmlsZUlmUmVxdWVzdGVkKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHRoaXMucmVhZE91dHB1dEZpbGVUYXJnZXQoZmlsZSwgYmxvY2spO1xuICAgICAgaWYgKCF0YXJnZXQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZVZhdWx0UGFyZW50Rm9sZGVyKHRhcmdldC5wYXRoKTtcbiAgICAgIGNvbnN0IHJlbmRlcmVkID0gdGFyZ2V0LmZvcm1hdCA9PT0gXCJqc29uXCJcbiAgICAgICAgPyB0aGlzLnJlbmRlck91dHB1dEZpbGVKc29uKGZpbGUsIGJsb2NrLCByZXN1bHQsIHRhcmdldClcbiAgICAgICAgOiB0aGlzLnJlbmRlck91dHB1dEZpbGVUZXh0KHJlc3VsdCwgdGFyZ2V0KTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSB0YXJnZXQubW9kZSA9PT0gXCJhcHBlbmRcIiAmJiBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyh0YXJnZXQucGF0aClcbiAgICAgICAgPyBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQodGFyZ2V0LnBhdGgpXG4gICAgICAgIDogXCJcIjtcbiAgICAgIGNvbnN0IG5leHQgPSB0YXJnZXQubW9kZSA9PT0gXCJhcHBlbmRcIiAmJiBjdXJyZW50XG4gICAgICAgID8gYCR7Y3VycmVudC5yZXBsYWNlKC9cXHMqJC8sIFwiXFxuXCIpfSR7cmVuZGVyZWR9YFxuICAgICAgICA6IHJlbmRlcmVkO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZSh0YXJnZXQucGF0aCwgbmV4dCk7XG5cbiAgICAgIGNvbnN0IHN0cmVhbUxpc3QgPSB0YXJnZXQuc3RyZWFtcy5qb2luKFwiLFwiKTtcbiAgICAgIGNvbnN0IG5vdGljZSA9IGBXcm90ZSBvdXRwdXQgZmlsZSAke3RhcmdldC5wYXRofSAoJHt0YXJnZXQubW9kZX0sICR7dGFyZ2V0LmZvcm1hdH0sICR7c3RyZWFtTGlzdH0pLmA7XG4gICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7bm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IG5vdGljZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGNvbnN0IG5vdGljZSA9IGBGYWlsZWQgdG8gd3JpdGUgb3V0cHV0IGZpbGU6ICR7bWVzc2FnZX1gO1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke25vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBub3RpY2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZVRhcmdldChmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZVRhcmdldCB8IG51bGwge1xuICAgIGNvbnN0IHJhd1BhdGggPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWZpbGVcIl07XG4gICAgaWYgKCFyYXdQYXRoPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBwYXRoOiB0aGlzLnJlc29sdmVPdXRwdXRWYXVsdFBhdGgoZmlsZSwgcmF3UGF0aCksXG4gICAgICBtb2RlOiB0aGlzLnJlYWRPdXRwdXRGaWxlTW9kZShibG9jayksXG4gICAgICBmb3JtYXQ6IHRoaXMucmVhZE91dHB1dEZpbGVGb3JtYXQoYmxvY2spLFxuICAgICAgc3RyZWFtczogdGhpcy5yZWFkT3V0cHV0RmlsZVN0cmVhbXMoYmxvY2spLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlTW9kZShibG9jazogbG9vbUNvZGVCbG9jayk6IGxvb21PdXRwdXRGaWxlTW9kZSB7XG4gICAgY29uc3QgYXBwZW5kID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWFwcGVuZFwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWFwcGVuZFwiXTtcbiAgICBpZiAoYXBwZW5kICYmICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhhcHBlbmQudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICByZXR1cm4gXCJhcHBlbmRcIjtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gKGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlLW1vZGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLW1vZGVcIl0gPz8gXCJyZXBsYWNlXCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChtb2RlID09PSBcImFwcGVuZFwiKSB7XG4gICAgICByZXR1cm4gXCJhcHBlbmRcIjtcbiAgICB9XG4gICAgaWYgKG1vZGUgPT09IFwicmVwbGFjZVwiKSB7XG4gICAgICByZXR1cm4gXCJyZXBsYWNlXCI7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbG9vbS1vdXRwdXQtZmlsZS1tb2RlOiAke21vZGV9LiBVc2UgcmVwbGFjZSBvciBhcHBlbmQuYCk7XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlRm9ybWF0KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbG9vbU91dHB1dEZpbGVGb3JtYXQge1xuICAgIGNvbnN0IGZvcm1hdCA9IChibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZS1mb3JtYXRcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLWZvcm1hdFwiXSA/PyBcInRleHRcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGZvcm1hdCA9PT0gXCJ0ZXh0XCIgfHwgZm9ybWF0ID09PSBcImpzb25cIikge1xuICAgICAgcmV0dXJuIGZvcm1hdDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsb29tLW91dHB1dC1maWxlLWZvcm1hdDogJHtmb3JtYXR9LiBVc2UgdGV4dCBvciBqc29uLmApO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZVN0cmVhbXMoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZVN0cmVhbVtdIHtcbiAgICBjb25zdCB2YWx1ZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlLXN0cmVhbXNcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlLXN0cmVhbXNcIl0gPz8gXCJzdGRvdXRcIjtcbiAgICBjb25zdCBwYXJzZWQgPSB2YWx1ZVxuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgoc3RyZWFtKSA9PiBzdHJlYW0udHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGNvbnN0IGV4cGFuZGVkID0gcGFyc2VkLmluY2x1ZGVzKFwiYWxsXCIpXG4gICAgICA/IFtcIm1ldGFkYXRhXCIsIFwic3Rkb3V0XCIsIFwid2FybmluZ1wiLCBcInN0ZGVyclwiXVxuICAgICAgOiBwYXJzZWQ7XG4gICAgY29uc3Qgc3RyZWFtcyA9IGV4cGFuZGVkLm1hcCgoc3RyZWFtKSA9PiB7XG4gICAgICBpZiAoc3RyZWFtID09PSBcInN0ZG91dFwiIHx8IHN0cmVhbSA9PT0gXCJzdGRlcnJcIiB8fCBzdHJlYW0gPT09IFwid2FybmluZ1wiIHx8IHN0cmVhbSA9PT0gXCJtZXRhZGF0YVwiKSB7XG4gICAgICAgIHJldHVybiBzdHJlYW07XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxvb20tb3V0cHV0LWZpbGUtc3RyZWFtcyBlbnRyeTogJHtzdHJlYW19LmApO1xuICAgIH0pO1xuICAgIHJldHVybiBzdHJlYW1zLmxlbmd0aCA/IFsuLi5uZXcgU2V0KHN0cmVhbXMpXSA6IFtcInN0ZG91dFwiXTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZU91dHB1dFZhdWx0UGF0aChmaWxlOiBURmlsZSwgcmF3UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0cmltbWVkID0gcmF3UGF0aC50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IC9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6Ly50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb29tLW91dHB1dC1maWxlIG11c3QgYmUgYSB2YXVsdC1yZWxhdGl2ZSBwYXRoLlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gdHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKVxuICAgICAgPyBub3JtYWxpemVQYXRoKHRyaW1tZWQuc2xpY2UoMSkpXG4gICAgICA6IG5vcm1hbGl6ZVBhdGgoZGlybmFtZShmaWxlLnBhdGgpID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtkaXJuYW1lKGZpbGUucGF0aCl9LyR7dHJpbW1lZH1gKTtcbiAgICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCB8fCBwYXJ0cy5pbmNsdWRlcyhcIi4uXCIpIHx8IHBhdGguc3RhcnRzV2l0aChcIi5vYnNpZGlhbi9cIikgfHwgcGF0aCA9PT0gXCIub2JzaWRpYW5cIiB8fCBwYXRoLnN0YXJ0c1dpdGgoXCIuZ2l0L1wiKSB8fCBwYXRoID09PSBcIi5naXRcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGxvb20tb3V0cHV0LWZpbGUgcGF0aDogJHtyYXdQYXRofWApO1xuICAgIH1cbiAgICByZXR1cm4gcGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlVmF1bHRQYXJlbnRGb2xkZXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZm9sZGVyID0gZGlybmFtZShwYXRoKTtcbiAgICBpZiAoIWZvbGRlciB8fCBmb2xkZXIgPT09IFwiLlwiKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICAgIGZvciAoY29uc3QgcGFydCBvZiBmb2xkZXIuc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKSkge1xuICAgICAgY3VycmVudCA9IGN1cnJlbnQgPyBgJHtjdXJyZW50fS8ke3BhcnR9YCA6IHBhcnQ7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhjdXJyZW50KSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5ta2RpcihjdXJyZW50KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck91dHB1dEZpbGVUZXh0KHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSwgdGFyZ2V0OiBsb29tT3V0cHV0RmlsZVRhcmdldCk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2VjdGlvbnMgPSB0YXJnZXQuc3RyZWFtcy5mbGF0TWFwKChzdHJlYW0pID0+IHtcbiAgICAgIHN3aXRjaCAoc3RyZWFtKSB7XG4gICAgICAgIGNhc2UgXCJtZXRhZGF0YVwiOlxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgICAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICAgICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICAgICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG4gICAgICAgIGNhc2UgXCJzdGRvdXRcIjpcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LnN0ZG91dCA/IFtyZXN1bHQuc3Rkb3V0XSA6IFtdO1xuICAgICAgICBjYXNlIFwid2FybmluZ1wiOlxuICAgICAgICAgIHJldHVybiByZXN1bHQud2FybmluZyA/IFtyZXN1bHQud2FybmluZ10gOiBbXTtcbiAgICAgICAgY2FzZSBcInN0ZGVyclwiOlxuICAgICAgICAgIHJldHVybiByZXN1bHQuc3RkZXJyID8gW3Jlc3VsdC5zdGRlcnJdIDogW107XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGAke3NlY3Rpb25zLmpvaW4oXCJcXG5cXG5cIikucmVwbGFjZSgvXFxzKiQvLCBcIlwiKX1cXG5gO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJPdXRwdXRGaWxlSnNvbihmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSwgdGFyZ2V0OiBsb29tT3V0cHV0RmlsZVRhcmdldCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIG5vdGU6IGZpbGUucGF0aCxcbiAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgcnVubmVyOiByZXN1bHQucnVubmVyTmFtZSxcbiAgICAgIGV4aXRDb2RlOiByZXN1bHQuZXhpdENvZGUsXG4gICAgICBzdWNjZXNzOiByZXN1bHQuc3VjY2VzcyxcbiAgICAgIGR1cmF0aW9uTXM6IHJlc3VsdC5kdXJhdGlvbk1zLFxuICAgICAgc3RhcnRlZEF0OiByZXN1bHQuc3RhcnRlZEF0LFxuICAgICAgZmluaXNoZWRBdDogcmVzdWx0LmZpbmlzaGVkQXQsXG4gICAgICBzdHJlYW1zOiB7XG4gICAgICAgIC4uLih0YXJnZXQuc3RyZWFtcy5pbmNsdWRlcyhcInN0ZG91dFwiKSA/IHsgc3Rkb3V0OiByZXN1bHQuc3Rkb3V0IH0gOiB7fSksXG4gICAgICAgIC4uLih0YXJnZXQuc3RyZWFtcy5pbmNsdWRlcyhcIndhcm5pbmdcIikgPyB7IHdhcm5pbmc6IHJlc3VsdC53YXJuaW5nID8/IFwiXCIgfSA6IHt9KSxcbiAgICAgICAgLi4uKHRhcmdldC5zdHJlYW1zLmluY2x1ZGVzKFwic3RkZXJyXCIpID8geyBzdGRlcnI6IHJlc3VsdC5zdGRlcnIgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICByZXR1cm4gYCR7SlNPTi5zdHJpbmdpZnkocGF5bG9hZCwgbnVsbCwgMil9XFxuYDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBzaG91bGRSZW5kZXJTdGRpblBhbmVsKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuc3RkaW5QYW5lbHMuaGFzKGJsb2NrLmlkKSB8fCB0aGlzLmhhc0VuYWJsZWRTdGRpbkF0dHJpYnV0ZShibG9jayk7XG4gIH1cblxuICBwcml2YXRlIGhhc0VuYWJsZWRTdGRpbkF0dHJpYnV0ZShibG9jazogbG9vbUNvZGVCbG9jayk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGlucHV0ID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20taW5wdXRcIl0gPz8gYmxvY2suYXR0cmlidXRlcy5pbnB1dDtcbiAgICBpZiAoaW5wdXQgJiYgIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKGlucHV0LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpblwiXSAhPSBudWxsIHx8XG4gICAgICBibG9jay5hdHRyaWJ1dGVzLnN0ZGluICE9IG51bGwgfHxcbiAgICAgIGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluLWZpbGVcIl0gIT0gbnVsbCB8fFxuICAgICAgYmxvY2suYXR0cmlidXRlc1tcInN0ZGluLWZpbGVcIl0gIT0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3RkaW5QYW5lbChibG9jazogbG9vbUNvZGVCbG9jayk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLXN0ZGluLXBhbmVsXCI7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zdGRpbi1oZWFkZXJcIiB9KTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IHRleHQ6IFwic3RkaW5cIiB9KTtcbiAgICBjb25zdCBhY3Rpb25zID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXN0ZGluLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBydW5CdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJSdW5cIiB9KTtcbiAgICBjb25zdCBjbGVhckJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNsZWFyXCIgfSk7XG5cbiAgICBjb25zdCB0ZXh0YXJlYSA9IHBhbmVsLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwgeyBjbHM6IFwibG9vbS1zdGRpbi1pbnB1dFwiIH0pO1xuICAgIHRleHRhcmVhLnBsYWNlaG9sZGVyID0gdGhpcy5nZXRTdGRpblBsYWNlaG9sZGVyKGJsb2NrKTtcbiAgICB0ZXh0YXJlYS52YWx1ZSA9IHRoaXMuc3RkaW5JbnB1dHMuZ2V0KGJsb2NrLmlkKSA/PyBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpblwiXSA/PyBibG9jay5hdHRyaWJ1dGVzLnN0ZGluID8/IFwiXCI7XG4gICAgdGV4dGFyZWEuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHtcbiAgICAgIHRoaXMuc3RkaW5JbnB1dHMuc2V0KGJsb2NrLmlkLCB0ZXh0YXJlYS52YWx1ZSk7XG4gICAgfSk7XG4gICAgcnVuQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuc3RkaW5JbnB1dHMuc2V0KGJsb2NrLmlkLCB0ZXh0YXJlYS52YWx1ZSk7XG4gICAgICB2b2lkIHRoaXMucnVuQWN0aXZlQmxvY2tCeUlkKGJsb2NrLmlkKTtcbiAgICB9KTtcbiAgICBjbGVhckJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0ZXh0YXJlYS52YWx1ZSA9IFwiXCI7XG4gICAgICB0aGlzLnN0ZGluSW5wdXRzLnNldChibG9jay5pZCwgXCJcIik7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcGFuZWw7XG4gIH1cblxuICBwcml2YXRlIGdldFN0ZGluUGxhY2Vob2xkZXIoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0ZGluRmlsZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluLWZpbGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcInN0ZGluLWZpbGVcIl07XG4gICAgcmV0dXJuIHN0ZGluRmlsZSA/IGBzdGRpbiBmaWxlOiAke3N0ZGluRmlsZX1gIDogXCJzdGFuZGFyZCBpbnB1dCBmb3IgdGhpcyBibG9ja1wiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlQmxvY2tTdGRpbihmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICh0aGlzLnN0ZGluSW5wdXRzLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnN0ZGluSW5wdXRzLmdldChibG9jay5pZCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5saW5lID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW5cIl0gPz8gYmxvY2suYXR0cmlidXRlcy5zdGRpbjtcbiAgICBpZiAoaW5saW5lICE9IG51bGwpIHtcbiAgICAgIHJldHVybiBkZWNvZGVFc2NhcGVkQXR0cmlidXRlKGlubGluZSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RkaW5GaWxlID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW4tZmlsZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wic3RkaW4tZmlsZVwiXTtcbiAgICBpZiAoIXN0ZGluRmlsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHN0ZGluUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgc3RkaW5GaWxlKTtcbiAgICBjb25zdCBpbnB1dEZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoc3RkaW5QYXRoKTtcbiAgICBpZiAoIShpbnB1dEZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc3RkaW4gZmlsZSBub3QgZm91bmQ6ICR7c3RkaW5QYXRofWApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChpbnB1dEZpbGUpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRlY29kZUVzY2FwZWRBdHRyaWJ1dGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cXFxcbi9nLCBcIlxcblwiKS5yZXBsYWNlKC9cXFxcdC9nLCBcIlxcdFwiKTtcbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJ3c2xcIiB8IFwiY3VzdG9tXCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgd3NsPzogbG9vbVdzbENvbmZpZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICBhY3Rpb246IFwiYnVpbGRcIiB8IFwicnVuXCIgfCBcInRlYXJkb3duXCI7XG4gIGdyb3VwTmFtZTogc3RyaW5nO1xuICBncm91cFBhdGg6IHN0cmluZztcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGltYWdlPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogc3RyaW5nO1xuICBsYW5ndWFnZUFsaWFzPzogc3RyaW5nO1xuICBmaWxlTmFtZT86IHN0cmluZztcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIHN0ZGluPzogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgY29uZmlnOiB7XG4gICAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gICAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkgeyB9XG5cbiAgZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGU6IFRGaWxlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgdmFsdWUgPSBmcm9udG1hdHRlcj8uW1wibG9vbS1jb250YWluZXJcIl07XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiBudWxsO1xuICB9XG5cbiAgYXN5bmMgZ2V0R3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICBjb25zdCBjb250YWluZXJzUGF0aCA9IHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoY29udGFpbmVyc1BhdGgpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIoY29udGFpbmVyc1BhdGgsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICBlbnRyaWVzXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgICAubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGdyb3VwUGF0aCA9IGpvaW4oY29udGFpbmVyc1BhdGgsIGVudHJ5Lm5hbWUpO1xuICAgICAgICAgIGNvbnN0IGhhc0NvbmZpZyA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIikpO1xuICAgICAgICAgIGNvbnN0IGhhc0RvY2tlcmZpbGUgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpO1xuICAgICAgICAgIGlmICghaGFzQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwibWlzc2luZyBjb25maWcuanNvblwiLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgICAgICAgICAgY29uc3QgcGllY2VzID0gW2BydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWBdO1xuICAgICAgICAgICAgaWYgKChjb25maWcucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIikgJiYgaGFzRG9ja2VyZmlsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChcIkRvY2tlcmZpbGVcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5zc2hUYXJnZXQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHNzaDogJHtjb25maWcucWVtdS5zc2hUYXJnZXR9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmIGNvbmZpZy5xZW11Py5tYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBtYW5hZ2VyOiAke2F3YWl0IHRoaXMuZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoLCBjb25maWcucWVtdS5tYW5hZ2VyKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiBjb25maWcuY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGB3cmFwcGVyOiAke2NvbmZpZy5jdXN0b20uZXhlY3V0YWJsZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGxhbmd1YWdlQ291bnQgPSBPYmplY3Qua2V5cyhjb25maWcubGFuZ3VhZ2VzKS5sZW5ndGg7XG4gICAgICAgICAgICBwaWVjZXMucHVzaChgJHtsYW5ndWFnZUNvdW50fSBsYW5ndWFnZSR7bGFuZ3VhZ2VDb3VudCA9PT0gMSA/IFwiXCIgOiBcInNcIn1gKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogcGllY2VzLmpvaW4oXCIsIFwiKSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogYGludmFsaWQgY29uZmlnLmpzb246ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsIGdyb3VwTmFtZTogc3RyaW5nKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29uZmlnTGFuZyA9IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VdID8/IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VBbGlhc107XG5cbiAgICBsZXQgaXNGYWxsYmFjayA9IGZhbHNlO1xuICAgIGxldCBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCA9IG51bGw7XG5cbiAgICBpZiAoY29uZmlnTGFuZykge1xuICAgICAgaWYgKGNvbmZpZ0xhbmcudXNlRGVmYXVsdCkge1xuICAgICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSBjb25maWdMYW5nO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsYW5ndWFnZSA9IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykgPz8gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2VBbGlhcywgc2V0dGluZ3MpO1xuICAgICAgaXNGYWxsYmFjayA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSB8fCAhbGFuZ3VhZ2UuY29tbWFuZCB8fCAhbGFuZ3VhZ2UuZXh0ZW5zaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBncm91cCAke2dyb3VwTmFtZX0gaGFzIG5vIGNvbW1hbmQgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgIH1cblxuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgdGVtcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9JHtub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uKX1gO1xuICAgIGNvbnN0IHRlbXBGaWxlUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCB0ZW1wRmlsZU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZVBhdGgsIGJsb2NrLmNvbnRlbnQsIFwidXRmOFwiKTtcbiAgICAgIGxldCByZXN1bHQ6IGxvb21SdW5SZXN1bHQ7XG4gICAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuT2NpQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1blFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBibG9jaywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgdGVtcEZpbGVQYXRoLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuV3NsQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcnVudGltZTogJHtjb25maWcucnVudGltZX1gKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGlzRmFsbGJhY2spIHtcbiAgICAgICAgY29uc3QgZmFsbGJhY2tNc2cgPSBgW0xvb21dIExhbmd1YWdlICcke2Jsb2NrLmxhbmd1YWdlfScgd2FzIG5vdCBkZWNsYXJlZCBpbiBjb250YWluZXIgZ3JvdXAuIFJ1bm5pbmcgdXNpbmcgZGVmYXVsdCBjb21tYW5kOiAke2xhbmd1YWdlLmNvbW1hbmR9YDtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke3Jlc3VsdC53YXJuaW5nfVxcbiR7ZmFsbGJhY2tNc2d9YCA6IGZhbGxiYWNrTXNnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwiYnVpbGRcIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zKSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsOmJ1aWxkYCxcbiAgICAgICAgICBgV1NMICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgICAgYFdTTCBlbnZpcm9ubWVudCAke2NvbmZpZy5pbWFnZSB8fCBcIihkZWZhdWx0KVwifSBkb2VzIG5vdCByZXF1aXJlIGEgYnVpbGQgc3RlcC5cXG5gLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT2NpQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XG4gICAgaWYgKCFjb21tYW5kLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1xuICAgICAgICBcInJ1blwiLFxuICAgICAgICBcIi0tcm1cIixcbiAgICAgICAgLi4uKGNvbnRleHQuc3RkaW4gIT0gbnVsbCA/IFtcIi1pXCJdIDogW10pLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blFlbXUoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS5zdGFydENvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnN0YXJ0YCwgYFFFTVUgJHtncm91cE5hbWV9IHN0YXJ0YCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmhlYWx0aGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZW1vdGVGaWxlID0gcG9zaXhQYXRoLmpvaW4ocWVtdS5yZW1vdGVXb3Jrc3BhY2UsIHRlbXBGaWxlTmFtZSk7XG4gICAgICBjb25zdCByZW1vdGVDb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCBzaGVsbFF1b3RlKHJlbW90ZUZpbGUpKTtcbiAgICAgIGlmICghcmVtb3RlQ29tbWFuZC50cmltKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBRRU1VICR7Z3JvdXBOYW1lfWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IHFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcInNzaFwiLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgLi4uc3BsaXRDb21tYW5kTGluZShxZW11LnNzaEFyZ3MgfHwgXCJcIiksXG4gICAgICAgICAgcWVtdS5zc2hUYXJnZXQsXG4gICAgICAgICAgYGNkICR7c2hlbGxRdW90ZShxZW11LnJlbW90ZVdvcmtzcGFjZSl9ICYmICR7cmVtb3RlQ29tbWFuZH1gLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICB0ZW1wRmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pLFxuICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICApO1xuXG4gICAgaWYgKGNvbmZpZy5jdXN0b20/LnRlYXJkb3duKSB7XG4gICAgICBjb25zdCB0ZWFyZG93biA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgICAgZ3JvdXBOYW1lLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwidGVhcmRvd25cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgICAgY29tbWFuZCxcbiAgICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgICAgfSksXG4gICAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICAgICk7XG4gICAgICBpZiAoIXRlYXJkb3duLnN1Y2Nlc3MpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgQ3VzdG9tIHJ1bnRpbWUgdGVhcmRvd24gZmFpbGVkOiAke3RlYXJkb3duLnN0ZGVyciB8fCB0ZWFyZG93bi5zdGRvdXQgfHwgYGV4aXQgJHt0ZWFyZG93bi5leGl0Q29kZX1gfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuV3NsQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCB3c2xHcm91cFBhdGggPSB0aGlzLnRyYW5zbGF0ZVRvV3NsUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSk7XG4gICAgaWYgKCFjb21tYW5kLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV1NMIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHNoZWxsRmxhZ3MgPSBjb25maWcud3NsPy5pbnRlcmFjdGl2ZSA/IFtcIi1pXCIsIFwiLWxcIiwgXCItY1wiXSA6IFtcIi1sXCIsIFwiLWNcIl07XG4gICAgY29uc3Qgd3NsQXJncyA9IFtcImJhc2hcIiwgLi4uc2hlbGxGbGFncywgYGNkIFwiJHt3c2xHcm91cFBhdGgucmVwbGFjZUFsbCgnXCInLCAnXFxcXFwiJyl9XCIgJiYgJHtjb21tYW5kfWBdO1xuICAgIGlmIChjb25maWcuaW1hZ2U/LnRyaW0oKSkge1xuICAgICAgd3NsQXJncy51bnNoaWZ0KFwiLWRcIiwgY29uZmlnLmltYWdlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OndzbGAsXG4gICAgICBydW5uZXJOYW1lOiBgV1NMICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiBcIndzbFwiLFxuICAgICAgYXJnczogd3NsQXJncyxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRyYW5zbGF0ZVRvV3NsUGF0aCh3aW5kb3dzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgZHJpdmUgPSBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgICAgcmV0dXJuIGAvbW50LyR7ZHJpdmV9LyR7cmVzdH1gO1xuICAgIH1cbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XG4gICAgICByZXR1cm4gd2luZG93c1BhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICB3c2w/OiB1bmtub3duO1xuICAgICAgaGVhbHRoQ2hlY2s/OiB1bmtub3duO1xuICAgICAgcWVtdT86IHVua25vd247XG4gICAgICBjdXN0b20/OiB1bmtub3duO1xuICAgICAgbGFuZ3VhZ2VzPzogdW5rbm93bjtcbiAgICB9O1xuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XG4gICAgaWYgKGRhdGEuZXhlY3V0YWJsZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKGRhdGEuaW1hZ2UgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5pbWFnZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBpbWFnZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKCFkYXRhLmxhbmd1YWdlcyB8fCB0eXBlb2YgZGF0YS5sYW5ndWFnZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhLmxhbmd1YWdlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbGFuZ3VhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsYW5ndWFnZUNvbmZpZyA9IHZhbHVlIGFzIHsgY29tbWFuZD86IHVua25vd247IGV4dGVuc2lvbj86IHVua25vd247IHVzZURlZmF1bHQ/OiB1bmtub3duIH07XG4gICAgICBjb25zdCB1c2VEZWZhdWx0ID0gbGFuZ3VhZ2VDb25maWcudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgaWYgKCF1c2VEZWZhdWx0ICYmICh0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhbGFuZ3VhZ2VDb25maWcuY29tbWFuZC50cmltKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQgb3IgdXNlRGVmYXVsdC5gKTtcbiAgICAgIH1cblxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiB1c2VEZWZhdWx0ID8gdW5kZWZpbmVkIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICAgIHVzZURlZmF1bHQ6IHVzZURlZmF1bHQgfHwgdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcnVudGltZSxcbiAgICAgIGV4ZWN1dGFibGU6IHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgPT09IFwic3RyaW5nXCIgJiYgZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA/IGRhdGEuZXhlY3V0YWJsZS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxuICAgICAgd3NsOiB0aGlzLnJlYWRXc2xDb25maWcoZGF0YS53c2wpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBoZWFsdGhDaGVja1wiKSxcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcbiAgICAgIGN1c3RvbTogdGhpcy5yZWFkQ3VzdG9tQ29uZmlnKGRhdGEuY3VzdG9tKSxcbiAgICAgIGxhbmd1YWdlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiZG9ja2VyXCI7XG4gICAgfVxuICAgIGlmICh2YWx1ZSA9PT0gXCJkb2NrZXJcIiB8fCB2YWx1ZSA9PT0gXCJwb2RtYW5cIiB8fCB2YWx1ZSA9PT0gXCJxZW11XCIgfHwgdmFsdWUgPT09IFwiY3VzdG9tXCIgfHwgdmFsdWUgPT09IFwid3NsXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBydW50aW1lIG11c3QgYmUgZG9ja2VyLCBwb2RtYW4sIHFlbXUsIGN1c3RvbSwgb3Igd3NsLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFdzbENvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21Xc2xDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgeyBpbnRlcmFjdGl2ZT86IHVua25vd24gfTtcbiAgICByZXR1cm4ge1xuICAgICAgaW50ZXJhY3RpdmU6IGRhdGEuaW50ZXJhY3RpdmUgPT09IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSGVhbHRoQ2hlY2soXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaGVhbHRoQ2hlY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGhlYWx0aENoZWNrLmNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlICYmIGNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gcmV0dXJuZWQgbmVnYXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UgJiYgIWNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZGlkIG5vdCByZXR1cm4gcG9zaXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICBjb21tYW5kOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghY29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ29tbWFuZExpbmUoXG4gICAgY29tbWFuZDogc3RyaW5nLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Q29tbWFuZExpbmUoY29tbWFuZCk7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBwYXJ0c1swXSxcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgZXhpc3RpbmdQaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1BpZCkge1xuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoLCBtYW5hZ2VyKTtcbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xuICAgIGNvbnN0IGxvZ0ZkID0gbG9nUGF0aCA/IG9wZW5TeW5jKGxvZ1BhdGgsIFwiYVwiKSA6IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgICBjd2Q6IGdyb3VwUGF0aCxcbiAgICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgY2hpbGQudW5yZWYoKTtcblxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBkaWQgbm90IHJldHVybiBhIHByb2Nlc3MgaWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShwaWRQYXRoLCBgJHtjaGlsZC5waWR9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKGxvZ0ZkICE9IG51bGwpIHtcbiAgICAgICAgY2xvc2VTeW5jKGxvZ0ZkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUobWFuYWdlci5hcmdzIHx8IFwiXCIpO1xuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XG4gICAgICBjb25zdCBpbWFnZVBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5pbWFnZSk7XG4gICAgICBhcmdzLnB1c2goXCItZHJpdmVcIiwgYGZpbGU9JHtpbWFnZVBhdGh9LGlmPXZpcnRpbyxmb3JtYXQ9JHttYW5hZ2VyLmltYWdlRm9ybWF0IHx8IFwicWNvdzJcIn1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBxZW11OiBsb29tUWVtdUNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcWVtdS5oZWFsdGhDaGVjaykge1xuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKG1hbmFnZXIuYm9vdERlbGF5TXMgPz8gMCwgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcbiAgICBjb25zdCBpbnRlcnZhbCA9IG1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNcyA/PyAxXzAwMDtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xuXG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dCkge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIHdhaXQgY2FuY2VsbGVkLmApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgTWF0aC5taW4oaW50ZXJ2YWwsIHRpbWVvdXQpLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6cmVhZHlgLCBgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIGNoZWNrYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKGludGVydmFsLCBzaWduYWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gZGlkIG5vdCBiZWNvbWUgcmVhZHkgd2l0aGluICR7dGltZW91dH0gbXMke2xhc3RFcnJvciA/IGA6ICR7bGFzdEVycm9yfWAgOiBcIi5cIn1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCB8fCBtYW5hZ2VyLnBlcnNpc3QgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1hbmFnZXIuc2h1dGRvd25Db21tYW5kKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICAgICAgbWFuYWdlci5zaHV0ZG93bkNvbW1hbmQsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzaHV0ZG93bmAsXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XG4gICAgaWYgKCFzdG9wcGVkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBcIlNJR0tJTExcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xuICAgIH1cblxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuIFwic3RvcHBlZFwiO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gKGF3YWl0IHJlYWRGaWxlKHBpZFBhdGgsIFwidXRmOFwiKSkudHJpbSgpO1xuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwaWQpICYmIHBpZCA+IDAgPyBwaWQgOiBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Byb2Nlc3NSdW5uaW5nKHBpZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgdHJ5IHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUHJvY2Vzc0V4aXQocGlkOiBudW1iZXIsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKDI1MCwgc2lnbmFsKTtcbiAgICB9XG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgcmVxdWVzdDogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0LFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGN1c3RvbSA9IHRoaXMucmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICBjb25zdCByZXF1ZXN0RmlsZU5hbWUgPSBgcmVxdWVzdF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9Lmpzb25gO1xuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0UGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMil9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XG4gICAgICAgIGFyZ1xuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHJlcXVlc3RQYXRoKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXBQYXRofVwiLCBncm91cFBhdGgpLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbToke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBDdXN0b20gJHtncm91cE5hbWV9ICR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBzaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0ocmVxdWVzdFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDdXN0b21SZXF1ZXN0KFxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBleHRyYTogUGFydGlhbDxsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Q+ID0ge30sXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIHJ1bnRpbWU6IGNvbmZpZy5ydW50aW1lLFxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcbiAgICAgIGJ1aWxkOiBjb25maWcuY3VzdG9tPy5idWlsZCxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IGNvbmZpZy5jdXN0b20/LmNvbW1hbmRTdHJ1Y3R1cmUsXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXG4gICAgICAgIGN1c3RvbTogY29uZmlnLmN1c3RvbSxcbiAgICAgICAgcWVtdTogY29uZmlnLnFlbXUsXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjdXN0b20gbGFuZ3VhZ2VzIGZpcnN0XG4gICAgY29uc3QgY3VzdG9tID0gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGMpID0+IHtcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgcmV0dXJuIG5hbWVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmIChjdXN0b20pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmQ6IGAke2N1c3RvbS5leGVjdXRhYmxlfSAke2N1c3RvbS5hcmdzfWAudHJpbSgpLFxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN0YW5kYXJkIGJ1aWx0LWluc1xuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgY2FzZSBcInB5XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJqc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgY2FzZSBcInRzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnRzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic2hlbGxcIjpcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcImJhc2hcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYmFzaFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc2hcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydWJ5XCI6XG4gICAgICBjYXNlIFwicmJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydWJ5XCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yYlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBlcmxcIjpcbiAgICAgIGNhc2UgXCJwbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBlcmxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBlcmxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibHVhXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmx1YVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBocFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBocEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGhwXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJnb1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmdvRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnb1wifSBydW4ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmdvXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgY2FzZSBcImhzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVuZ2hjXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICBjYXNlIFwibWxcIjpcbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImR1bmVcIn0gZXhlYyAtLSBvY2FtbCB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJvY2FtbGNcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sY1wifSAtbyAvdG1wL2xvb20tb2NhbWwgXCIkMVwiICYmIC90bXAvbG9vbS1vY2FtbGApLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnY2NcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jICYmIC90bXAvbG9vbS1jYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY3BwXCI6XG4gICAgICBjYXNlIFwiYysrXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZysrXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tY3BwICYmIC90bXAvbG9vbS1jcHBgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNwcFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImVicGZcIjpcbiAgICAgIGNhc2UgXCJlYnBmLWNcIjpcbiAgICAgIGNhc2UgXCJicGZcIjpcbiAgICAgIGNhc2UgXCJicGYtY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5lYnBmQ2xhbmdFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNsYW5nXCJ9IC10YXJnZXQgYnBmIC1PMiAtZyAtV2FsbCBcIiQxXCIgLWMgLW8gL3RtcC9sb29tLWVicGYubyAmJiBwcmludGYgJ2NvbXBpbGVkIC90bXAvbG9vbS1lYnBmLm9cXFxcbidgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmJwZi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiYnBmdHJhY2VcIjpcbiAgICAgIGNhc2UgXCJidFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtZCB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuYnRcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydXN0XCI6XG4gICAgICBjYXNlIFwicnNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVzdGNcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1ydXN0ICYmIC90bXAvbG9vbS1ydXN0YCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFcIjoge1xuICAgICAgICBjb25zdCBjb21waWxlciA9IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YWNcIjtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYHRtcD0vdG1wL2xvb20tamF2YS0kJCAmJiBta2RpciAtcCBcIiR0bXBcIiAmJiBjcCBcIiQxXCIgXCIkdG1wL01haW4uamF2YVwiICYmICR7Y29tcGlsZXJ9IFwiJHRtcC9NYWluLmphdmFcIiAmJiAke3NldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFcIn0gLWNwIFwiJHRtcFwiIE1haW5gKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmphdmFcIixcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICBjYXNlIFwibGx2bVwiOlxuICAgICAgY2FzZSBcImxsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsbGlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibGVhblwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxlYW5cIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjb3FcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNvcWNcIn0gLXEge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzbXRsaWJcIjpcbiAgICAgIGNhc2UgXCJzbXRcIjpcbiAgICAgIGNhc2UgXCJzbXQtbGliXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkgfHwgXCJ6M1wifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBzaCAtbGMgJHtxdW90ZUNvbW1hbmRBcmcoY29tbWFuZCl9IHNoIHtmaWxlfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0RvY2tlck5vdGljZShtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShtZXNzYWdlLCA4MDAwKTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU2lnbmFsKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogTm9kZUpTLlNpZ25hbHMgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCAhL15TSUdbQS1aMC05XSskLy50ZXN0KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHNpZ25hbCBuYW1lIGxpa2UgU0lHVEVSTS5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgTm9kZUpTLlNpZ25hbHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwV2l0aFNpZ25hbChkdXJhdGlvbk1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKGR1cmF0aW9uTXMgPD0gMCB8fCBzaWduYWwuYWJvcnRlZCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQocmVzb2x2ZSwgZHVyYXRpb25Ncyk7XG4gICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfTtcbiAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBydW50aW1lTGFiZWwocnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKHJ1bnRpbWUpIHtcbiAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICByZXR1cm4gXCJEb2NrZXJcIjtcbiAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICByZXR1cm4gXCJQb2RtYW5cIjtcbiAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgcmV0dXJuIFwiUUVNVVwiO1xuICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgIHJldHVybiBcIkN1c3RvbVwiO1xuICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgIHJldHVybiBcIldTTFwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsUXVvdGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuXG5mdW5jdGlvbiBxdW90ZUNvbW1hbmRBcmcodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuIiwgImltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tUHJvY2Vzc1NwZWMge1xuICBydW5uZXJJZDogc3RyaW5nO1xuICBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIHNpZ25hbDogQWJvcnRTaWduYWw7XG4gIHN0ZGluPzogc3RyaW5nO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNoaWxkLnN0ZGluPy5vbihcImVycm9yXCIsIChlcnJvcjogTm9kZUpTLkVycm5vRXhjZXB0aW9uKSA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBcIkVQSVBFXCIpIHtcbiAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChzcGVjLnN0ZGluICE9IG51bGwpIHtcbiAgICAgICAgY2hpbGQuc3RkaW4/LmVuZChzcGVjLnN0ZGluKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNoaWxkLnN0ZGluPy5kZXN0cm95KCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgICBjYW5jZWxsZWQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9O1xuICAgICAgYWJvcnRIYW5kbGVyID0gYWJvcnQ7XG5cbiAgICAgIGlmIChzcGVjLnNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIGFib3J0KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGVjLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICAgIH1cblxuICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aW1lZE91dCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH0sIHNwZWMudGltZW91dE1zKTtcblxuICAgICAgY2hpbGQuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZG91dCArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRlcnIgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgICAgZXhpdENvZGUgPSBjb2RlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBzdGRlcnIgPSBzdGRlcnIgfHwgZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yLCBzcGVjLmV4ZWN1dGFibGUpO1xuICAgIGV4aXRDb2RlID0gZXhpdENvZGUgPz8gLTE7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFib3J0SGFuZGxlcikge1xuICAgICAgc3BlYy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0SGFuZGxlcik7XG4gICAgfVxuICAgIGlmICh0aW1lb3V0SGFuZGxlKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGR1cmF0aW9uTXMgPSBmaW5pc2hlZEF0LmdldFRpbWUoKSAtIHN0YXJ0ZWRBdC5nZXRUaW1lKCk7XG4gIGNvbnN0IHN1Y2Nlc3MgPSAhdGltZWRPdXQgJiYgIWNhbmNlbGxlZCAmJiBleGl0Q29kZSA9PT0gMDtcblxuICByZXR1cm4ge1xuICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICBzdGFydGVkQXQ6IHN0YXJ0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGZpbmlzaGVkQXQ6IGZpbmlzaGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBkdXJhdGlvbk1zLFxuICAgIGV4aXRDb2RlLFxuICAgIHN0ZG91dCxcbiAgICBzdGRlcnIsXG4gICAgc3VjY2VzcyxcbiAgICB0aW1lZE91dCxcbiAgICBjYW5jZWxsZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvcjogdW5rbm93biwgZXhlY3V0YWJsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgIHJldHVybiBgRXhlY3V0YWJsZSBub3QgZm91bmQ6ICR7ZXhlY3V0YWJsZX1gO1xuICB9XG5cbiAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRlbXBGaWxlUHJvY2VzcyhzcGVjOiBsb29tVGVtcFNvdXJjZVNwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShzcGVjLmZpbGVFeHRlbnNpb24sIHNwZWMuc291cmNlLCBhc3luYyAoeyB0ZW1wRmlsZSwgdGVtcERpciB9KSA9PlxuICAgIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MubWFwKCh2YWx1ZSkgPT4gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHNwZWMudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBzcGVjLnNpZ25hbCxcbiAgICAgIHN0ZGluOiBzcGVjLnN0ZGluLFxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kVGVtcGxhdGVkRW52KGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQsIHRlbXBGaWxlOiBzdHJpbmcsIHRlbXBEaXI6IHN0cmluZyk6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFlbnYpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnYpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBbXG4gICAgICBrZXksXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpIDogdmFsdWUsXG4gICAgXSksXG4gICk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIHNwbGl0Q29tbWFuZExpbmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgbGV0IHF1b3RlOiBcIidcIiB8IFwiXFxcIlwiIHwgbnVsbCA9IG51bGw7XG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3QgY2hhciBvZiBpbnB1dC50cmltKCkpIHtcbiAgICBpZiAoZXNjYXBpbmcpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgICAgIGVzY2FwaW5nID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGVzY2FwaW5nID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgoY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJcXFwiXCIpICYmICFxdW90ZSkge1xuICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IHF1b3RlKSB7XG4gICAgICBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcbiAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQpIHtcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuIiwgImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbm9ybWFsaXplUGF0aCwgdHlwZSBBcHAsIHR5cGUgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29udGFpbmVyR3JvdXA/OiBzdHJpbmc7XG4gIGRpc2FibGVDb250YWluZXI/OiBib29sZWFuO1xuICB3b3JraW5nRGlyZWN0b3J5Pzogc3RyaW5nO1xuICB0aW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRXhlY3V0aW9uQ29udGV4dChcbiAgYXBwOiBBcHAsXG4gIGZpbGU6IFRGaWxlLFxuICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQge1xuICBjb25zdCBub3RlID0gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcCwgZmlsZSk7XG4gIGNvbnN0IGRlZmF1bHRXb3JraW5nRGlyZWN0b3J5ID0gcmVzb2x2ZURlZmF1bHRXb3JraW5nRGlyZWN0b3J5KGZpbGUsIHNldHRpbmdzKTtcbiAgY29uc3Qgbm90ZVdvcmtpbmdEaXJlY3RvcnkgPSBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KG5vdGUud29ya2luZ0RpcmVjdG9yeSk7XG4gIGNvbnN0IGJsb2NrV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3RvcnkoYmxvY2suZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3Qgbm90ZVRpbWVvdXQgPSBub3RlLnRpbWVvdXRNcztcbiAgY29uc3QgYmxvY2tUaW1lb3V0ID0gYmxvY2suZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXM7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogcmVzb2x2ZUNvbnRhaW5lckdyb3VwKHNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCwgbm90ZSwgYmxvY2suZXhlY3V0aW9uQ29udGV4dCksXG4gICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8/IG5vdGVXb3JraW5nRGlyZWN0b3J5ID8/IGRlZmF1bHRXb3JraW5nRGlyZWN0b3J5LFxuICAgIHRpbWVvdXRNczogYmxvY2tUaW1lb3V0ID8/IG5vdGVUaW1lb3V0ID8/IHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgc291cmNlOiB7XG4gICAgICBjb250YWluZXI6IHJlc29sdmVDb250YWluZXJTb3VyY2Uoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGJsb2NrV29ya2luZ0RpcmVjdG9yeSA/IFwiYmxvY2tcIiA6IG5vdGVXb3JraW5nRGlyZWN0b3J5ID8gXCJub3RlXCIgOiBzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSA/IFwiZ2xvYmFsXCIgOiBcImRlZmF1bHRcIixcbiAgICAgIHRpbWVvdXQ6IGJsb2NrVGltZW91dCA/IFwiYmxvY2tcIiA6IG5vdGVUaW1lb3V0ID8gXCJub3RlXCIgOiBcImdsb2JhbFwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb250YWluZXJHcm91cChcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmIChibG9jay5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoYmxvY2suY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBibG9jay5jb250YWluZXJHcm91cC50cmltKCk7XG4gIH1cbiAgaWYgKG5vdGUuZGlzYWJsZUNvbnRhaW5lcikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBub3RlLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb250YWluZXJTb3VyY2UoXG4gIGdsb2JhbENvbnRhaW5lcjogc3RyaW5nLFxuICBub3RlOiBOb3RlRXhlY3V0aW9uQ29udGV4dCxcbiAgYmxvY2s6IGxvb21FeGVjdXRpb25Db250ZXh0T3ZlcnJpZGUsXG4pOiBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0W1wic291cmNlXCJdW1wiY29udGFpbmVyXCJdIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIgfHwgYmxvY2suY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcImJsb2NrXCI7XG4gIH1cbiAgaWYgKG5vdGUuZGlzYWJsZUNvbnRhaW5lciB8fCBub3RlLmNvbnRhaW5lckdyb3VwPy50cmltKCkpIHtcbiAgICByZXR1cm4gXCJub3RlXCI7XG4gIH1cbiAgaWYgKGdsb2JhbENvbnRhaW5lci50cmltKCkpIHtcbiAgICByZXR1cm4gXCJnbG9iYWxcIjtcbiAgfVxuICByZXR1cm4gXCJub25lXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWROb3RlRXhlY3V0aW9uQ29udGV4dChhcHA6IEFwcCwgZmlsZTogVEZpbGUpOiBOb3RlRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IGZyb250bWF0dGVyID0gYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgaWYgKCFmcm9udG1hdHRlcikge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIGNvbnN0IGNvbnRhaW5lciA9IGZyb250bWF0dGVyW1wibG9vbS1jb250YWluZXJcIl07XG4gIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSBmcm9udG1hdHRlcltcImxvb20tY3dkXCJdID8/IGZyb250bWF0dGVyW1wibG9vbS13b3JraW5nLWRpcmVjdG9yeVwiXTtcbiAgY29uc3QgdGltZW91dCA9IGZyb250bWF0dGVyW1wibG9vbS10aW1lb3V0XCJdO1xuXG4gIHJldHVybiB7XG4gICAgY29udGFpbmVyR3JvdXA6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICBkaXNhYmxlQ29udGFpbmVyOiB0eXBlb2YgY29udGFpbmVyID09PSBcInN0cmluZ1wiID8gaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgOiB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogdHlwZW9mIHdvcmtpbmdEaXJlY3RvcnkgPT09IFwic3RyaW5nXCIgPyB3b3JraW5nRGlyZWN0b3J5IDogdW5kZWZpbmVkLFxuICAgIHRpbWVvdXRNczogdHlwZW9mIHRpbWVvdXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHRpbWVvdXQpICYmIHRpbWVvdXQgPiAwXG4gICAgICA/IE1hdGgudHJ1bmModGltZW91dClcbiAgICAgIDogdHlwZW9mIHRpbWVvdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZURlZmF1bHRXb3JraW5nRGlyZWN0b3J5KGZpbGU6IFRGaWxlLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgaWYgKHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpO1xuICB9XG5cbiAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKGZpbGUudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gIGNvbnN0IGZpbGVGb2xkZXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICByZXR1cm4gcmVzb2x2ZWQgfHwgcHJvY2Vzcy5jd2QoKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHZhbHVlPy50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUudHJpbSgpLCAxMCk7XG4gIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBhcnNlZCkgJiYgcGFyc2VkID4gMCA/IHBhcnNlZCA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNEaXNhYmxlZFZhbHVlKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIFtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCIsIFwibm9uZVwiLCBcIm5hdGl2ZVwiXS5pbmNsdWRlcyh2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKSk7XG59XG4iLCAiaW1wb3J0IHsgRGVjb3JhdGlvbiwgdHlwZSBFZGl0b3JWaWV3IH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB0eXBlIHsgUmFuZ2VTZXRCdWlsZGVyIH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTGx2bVRva2VuIHtcbiAgZnJvbTogbnVtYmVyO1xuICB0bzogbnVtYmVyO1xuICBjbGFzc05hbWU6IHN0cmluZztcbn1cblxuY29uc3QgTExWTV9LRVlXT1JEUyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KFtcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb250cm9sXCIsIFtcbiAgICBcInJldFwiLCBcImJyXCIsIFwic3dpdGNoXCIsIFwiaW5kaXJlY3RiclwiLCBcImludm9rZVwiLCBcImNhbGxiclwiLCBcInJlc3VtZVwiLCBcInVucmVhY2hhYmxlXCIsIFwiY2xlYW51cHJldFwiLCBcImNhdGNocmV0XCIsIFwiY2F0Y2hzd2l0Y2hcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtZGVjbGFyYXRpb25cIiwgW1xuICAgIFwiZGVmaW5lXCIsIFwiZGVjbGFyZVwiLCBcInR5cGVcIiwgXCJnbG9iYWxcIiwgXCJjb25zdGFudFwiLCBcImFsaWFzXCIsIFwiaWZ1bmNcIiwgXCJjb21kYXRcIiwgXCJhdHRyaWJ1dGVzXCIsIFwic2VjdGlvblwiLCBcImdjXCIsIFwicHJlZml4XCIsIFwicHJvbG9ndWVcIixcbiAgICBcInBlcnNvbmFsaXR5XCIsIFwidXNlbGlzdG9yZGVyXCIsIFwidXNlbGlzdG9yZGVyX2JiXCIsIFwibW9kdWxlXCIsIFwiYXNtXCIsIFwic291cmNlX2ZpbGVuYW1lXCIsIFwidGFyZ2V0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1lbW9yeVwiLCBbXG4gICAgXCJhbGxvY2FcIiwgXCJsb2FkXCIsIFwic3RvcmVcIiwgXCJnZXRlbGVtZW50cHRyXCIsIFwiZmVuY2VcIiwgXCJjbXB4Y2hnXCIsIFwiYXRvbWljcm13XCIsIFwiZXh0cmFjdHZhbHVlXCIsIFwiaW5zZXJ0dmFsdWVcIiwgXCJleHRyYWN0ZWxlbWVudFwiLFxuICAgIFwiaW5zZXJ0ZWxlbWVudFwiLCBcInNodWZmbGV2ZWN0b3JcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtYXJpdGhtZXRpY1wiLCBbXG4gICAgXCJhZGRcIiwgXCJzdWJcIiwgXCJtdWxcIiwgXCJ1ZGl2XCIsIFwic2RpdlwiLCBcInVyZW1cIiwgXCJzcmVtXCIsIFwic2hsXCIsIFwibHNoclwiLCBcImFzaHJcIiwgXCJhbmRcIiwgXCJvclwiLCBcInhvclwiLCBcImZuZWdcIiwgXCJmYWRkXCIsIFwiZnN1YlwiLCBcImZtdWxcIixcbiAgICBcImZkaXZcIiwgXCJmcmVtXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbXBhcmlzb25cIiwgW1wiaWNtcFwiLCBcImZjbXBcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNhc3RcIiwgW1xuICAgIFwidHJ1bmNcIiwgXCJ6ZXh0XCIsIFwic2V4dFwiLCBcImZwdHJ1bmNcIiwgXCJmcGV4dFwiLCBcImZwdG91aVwiLCBcImZwdG9zaVwiLCBcInVpdG9mcFwiLCBcInNpdG9mcFwiLCBcInB0cnRvaW50XCIsIFwiaW50dG9wdHJcIiwgXCJiaXRjYXN0XCIsIFwiYWRkcnNwYWNlY2FzdFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1vdGhlclwiLCBbXCJwaGlcIiwgXCJzZWxlY3RcIiwgXCJmcmVlemVcIiwgXCJjYWxsXCIsIFwibGFuZGluZ3BhZFwiLCBcImNhdGNocGFkXCIsIFwiY2xlYW51cHBhZFwiLCBcInZhX2FyZ1wiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbW9kaWZpZXJcIiwgW1xuICAgIFwicHJpdmF0ZVwiLCBcImludGVybmFsXCIsIFwiYXZhaWxhYmxlX2V4dGVybmFsbHlcIiwgXCJsaW5rb25jZVwiLCBcIndlYWtcIiwgXCJjb21tb25cIiwgXCJhcHBlbmRpbmdcIiwgXCJleHRlcm5fd2Vha1wiLCBcImxpbmtvbmNlX29kclwiLCBcIndlYWtfb2RyXCIsXG4gICAgXCJleHRlcm5hbFwiLCBcImRlZmF1bHRcIiwgXCJoaWRkZW5cIiwgXCJwcm90ZWN0ZWRcIiwgXCJkbGxpbXBvcnRcIiwgXCJkbGxleHBvcnRcIiwgXCJkc29fbG9jYWxcIiwgXCJkc29fcHJlZW1wdGFibGVcIiwgXCJleHRlcm5hbGx5X2luaXRpYWxpemVkXCIsXG4gICAgXCJ0aHJlYWRfbG9jYWxcIiwgXCJsb2NhbGR5bmFtaWNcIiwgXCJpbml0aWFsZXhlY1wiLCBcImxvY2FsZXhlY1wiLCBcInVubmFtZWRfYWRkclwiLCBcImxvY2FsX3VubmFtZWRfYWRkclwiLCBcImF0b21pY1wiLCBcInVub3JkZXJlZFwiLCBcIm1vbm90b25pY1wiLFxuICAgIFwiYWNxdWlyZVwiLCBcInJlbGVhc2VcIiwgXCJhY3FfcmVsXCIsIFwic2VxX2NzdFwiLCBcInN5bmNzY29wZVwiLCBcInZvbGF0aWxlXCIsIFwic2luZ2xldGhyZWFkXCIsIFwiY2NjXCIsIFwiZmFzdGNjXCIsIFwiY29sZGNjXCIsIFwid2Via2l0X2pzY2NcIixcbiAgICBcImFueXJlZ2NjXCIsIFwicHJlc2VydmVfbW9zdGNjXCIsIFwicHJlc2VydmVfYWxsY2NcIiwgXCJjeHhfZmFzdF90bHNjY1wiLCBcInN3aWZ0Y2NcIiwgXCJ0YWlsY2NcIiwgXCJjZmd1YXJkX2NoZWNrY2NcIiwgXCJ0YWlsXCIsIFwibXVzdHRhaWxcIiwgXCJub3RhaWxcIixcbiAgICBcImZhc3RcIiwgXCJubmFuXCIsIFwibmluZlwiLCBcIm5zelwiLCBcImFyY3BcIiwgXCJjb250cmFjdFwiLCBcImFmblwiLCBcInJlYXNzb2NcIiwgXCJudXdcIiwgXCJuc3dcIiwgXCJleGFjdFwiLCBcImluYm91bmRzXCIsIFwidG9cIiwgXCJ4XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1wcmVkaWNhdGVcIiwgW1xuICAgIFwiZXFcIiwgXCJuZVwiLCBcInVndFwiLCBcInVnZVwiLCBcInVsdFwiLCBcInVsZVwiLCBcInNndFwiLCBcInNnZVwiLCBcInNsdFwiLCBcInNsZVwiLCBcIm9lcVwiLCBcIm9ndFwiLCBcIm9nZVwiLCBcIm9sdFwiLCBcIm9sZVwiLCBcIm9uZVwiLCBcIm9yZFwiLCBcInVlcVwiLCBcInVuZVwiLFxuICAgIFwidW5vXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1hdHRyaWJ1dGVcIiwgW1xuICAgIFwiYWx3YXlzaW5saW5lXCIsIFwiYXJnbWVtb25seVwiLCBcImJ1aWx0aW5cIiwgXCJieXJlZlwiLCBcImJ5dmFsXCIsIFwiY29sZFwiLCBcImNvbnZlcmdlbnRcIiwgXCJkZXJlZmVyZW5jZWFibGVcIiwgXCJkZXJlZmVyZW5jZWFibGVfb3JfbnVsbFwiLCBcImRpc3RpbmN0XCIsXG4gICAgXCJpbW1hcmdcIiwgXCJpbmFsbG9jYVwiLCBcImlucmVnXCIsIFwibXVzdHByb2dyZXNzXCIsIFwibmVzdFwiLCBcIm5vYWxpYXNcIiwgXCJub2NhbGxiYWNrXCIsIFwibm9jYXB0dXJlXCIsIFwibm9mcmVlXCIsIFwibm9pbmxpbmVcIiwgXCJub25sYXp5YmluZFwiLFxuICAgIFwibm9ubnVsbFwiLCBcIm5vcmVjdXJzZVwiLCBcIm5vcmVkem9uZVwiLCBcIm5vcmV0dXJuXCIsIFwibm9zeW5jXCIsIFwibm91bndpbmRcIiwgXCJudWxsX3BvaW50ZXJfaXNfdmFsaWRcIiwgXCJvcGFxdWVcIiwgXCJvcHRub25lXCIsIFwib3B0c2l6ZVwiLFxuICAgIFwicHJlYWxsb2NhdGVkXCIsIFwicmVhZG5vbmVcIiwgXCJyZWFkb25seVwiLCBcInJldHVybmVkXCIsIFwicmV0dXJuc190d2ljZVwiLCBcInNhbml0aXplX2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9od2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9tZW1vcnlcIixcbiAgICBcInNhbml0aXplX3RocmVhZFwiLCBcInNpZ25leHRcIiwgXCJzcGVjdWxhdGFibGVcIiwgXCJzcmV0XCIsIFwic3NwXCIsIFwic3NwcmVxXCIsIFwic3Nwc3Ryb25nXCIsIFwic3dpZnRhc3luY1wiLCBcInN3aWZ0c2VsZlwiLCBcInN3aWZ0ZXJyb3JcIiwgXCJ1d3RhYmxlXCIsXG4gICAgXCJ3aWxscmV0dXJuXCIsIFwid3JpdGVvbmx5XCIsIFwiemVyb2V4dFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tY29uc3RhbnRcIiwgW1widHJ1ZVwiLCBcImZhbHNlXCIsIFwibnVsbFwiLCBcIm5vbmVcIiwgXCJ1bmRlZlwiLCBcInBvaXNvblwiLCBcInplcm9pbml0aWFsaXplclwiXSksXG5dKTtcblxuY29uc3QgTExWTV9QUklNSVRJVkVfVFlQRVMgPSBuZXcgU2V0KFtcbiAgXCJ2b2lkXCIsIFwibGFiZWxcIiwgXCJ0b2tlblwiLCBcIm1ldGFkYXRhXCIsIFwieDg2X21teFwiLCBcIng4Nl9hbXhcIiwgXCJoYWxmXCIsIFwiYmZsb2F0XCIsIFwiZmxvYXRcIiwgXCJkb3VibGVcIiwgXCJmcDEyOFwiLCBcIng4Nl9mcDgwXCIsIFwicHBjX2ZwMTI4XCIsIFwicHRyXCIsXG5dKTtcblxuY29uc3QgUFVOQ1RVQVRJT05fQ0xBU1MgPSBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LCBzb3VyY2U6IHN0cmluZyk6IHZvaWQge1xuICBjb2RlRWxlbWVudC5lbXB0eSgpO1xuICBjb2RlRWxlbWVudC5hZGRDbGFzcyhcImxvb20tbGx2bS1jb2RlXCIpO1xuXG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBsaW5lcy5mb3JFYWNoKChsaW5lLCBpbmRleCkgPT4ge1xuICAgIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb2RlRWxlbWVudCwgbGluZSk7XG4gICAgaWYgKGluZGV4IDwgbGluZXMubGVuZ3RoIC0gMSkge1xuICAgICAgY29kZUVsZW1lbnQuYXBwZW5kVGV4dChcIlxcblwiKTtcbiAgICB9XG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkTGx2bURlY29yYXRpb25zKFxuICBidWlsZGVyOiBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4sXG4gIHZpZXc6IEVkaXRvclZpZXcsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRMaW5lQ291bnQgPSBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrKTtcbiAgaWYgKCFjb250ZW50TGluZUNvdW50KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29udGVudExpbmVDb3VudDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF0gPz8gXCJcIjtcbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpO1xuICAgIGlmICghdG9rZW5zLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZG9jTGluZSA9IHZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMiArIGluZGV4KTtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgICAgaWYgKHRva2VuLmZyb20gPT09IHRva2VuLnRvKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLmZyb20sXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLnRvLFxuICAgICAgICBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogdG9rZW4uY2xhc3NOYW1lIH0pLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxpbmU6IHN0cmluZyk6IHZvaWQge1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2VuaXplTGx2bUxpbmUobGluZSkpIHtcbiAgICBpZiAodG9rZW4uZnJvbSA+IGN1cnNvcikge1xuICAgICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IsIHRva2VuLmZyb20pKTtcbiAgICB9XG5cbiAgICBjb25zdCBzcGFuID0gY29udGFpbmVyLmNyZWF0ZVNwYW4oeyBjbHM6IHRva2VuLmNsYXNzTmFtZSB9KTtcbiAgICBzcGFuLnNldFRleHQobGluZS5zbGljZSh0b2tlbi5mcm9tLCB0b2tlbi50bykpO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgaWYgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b2tlbml6ZUxsdm1MaW5lKGxpbmU6IHN0cmluZyk6IExsdm1Ub2tlbltdIHtcbiAgY29uc3QgdG9rZW5zOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgaW5kZXggPSAwO1xuXG4gIGFkZExhYmVsVG9rZW4obGluZSwgdG9rZW5zKTtcblxuICB3aGlsZSAoaW5kZXggPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSBsaW5lW2luZGV4XTtcbiAgICBpZiAoY3VycmVudCA9PT0gXCI7XCIpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBsaW5lLmxlbmd0aCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1jb21tZW50XCIgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjdXJyZW50KSkge1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0cmluZ1Rva2VuID0gcmVhZFN0cmluZ1Rva2VuKGxpbmUsIGluZGV4KTtcbiAgICBpZiAoc3RyaW5nVG9rZW4pIHtcbiAgICAgIGlmIChzdHJpbmdUb2tlbi5wcmVmaXhFbmQgPiBpbmRleCkge1xuICAgICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogc3RyaW5nVG9rZW4ucHJlZml4RW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZy1wcmVmaXhcIiB9KTtcbiAgICAgIH1cbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogc3RyaW5nVG9rZW4udmFsdWVTdGFydCwgdG86IHN0cmluZ1Rva2VuLnZhbHVlRW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZ1wiIH0pO1xuICAgICAgaW5kZXggPSBzdHJpbmdUb2tlbi52YWx1ZUVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoZWQgPVxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQGxsdm1cXC5bQS1aYS16JC5fMC05XSsveSwgXCJsb29tLWxsdm0taW50cmluc2ljXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfEBcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWdsb2JhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8lW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkK1xcYi95LCBcImxvb20tbGx2bS1sb2NhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8hW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwhXFxkK1xcYi95LCBcImxvb20tbGx2bS1tZXRhZGF0YVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXCRbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qL3ksIFwibG9vbS1sbHZtLWNvbWRhdFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8jXFxkK1xcYi95LCBcImxvb20tbGx2bS1hdHRyaWJ1dGUtZ3JvdXBcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFxiYWRkcnNwYWNlXFxzKlxcKFxccypcXGQrXFxzKlxcKS95LCBcImxvb20tbGx2bS10eXBlXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/MHhbMC05QS1GYS1mXStcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkK3xcXGQrKSg/OltlRV1bLStdP1xcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdP1xcZCtcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcLlxcLlxcLi95LCBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiLCB0b2tlbnMpO1xuXG4gICAgaWYgKG1hdGNoZWQpIHtcbiAgICAgIGluZGV4ID0gbWF0Y2hlZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmQgPSByZWFkV29yZChsaW5lLCBpbmRleCk7XG4gICAgaWYgKHdvcmQpIHtcbiAgICAgIHRva2Vucy5wdXNoKHtcbiAgICAgICAgZnJvbTogaW5kZXgsXG4gICAgICAgIHRvOiB3b3JkLmVuZCxcbiAgICAgICAgY2xhc3NOYW1lOiBjbGFzc2lmeVdvcmQod29yZC52YWx1ZSksXG4gICAgICB9KTtcbiAgICAgIGluZGV4ID0gd29yZC5lbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoXCIoKVtde308Piw6PSpcIi5pbmNsdWRlcyhjdXJyZW50KSkge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGluZGV4ICsgMSwgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyB9KTtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpbmRleCArPSAxO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnMpO1xufVxuXG5mdW5jdGlvbiBhZGRMYWJlbFRva2VuKGxpbmU6IHN0cmluZywgdG9rZW5zOiBMbHZtVG9rZW5bXSk6IHZvaWQge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxzKikoPzooW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxcXGQrKXwoJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCspKSg6KS8pO1xuICBpZiAoIW1hdGNoIHx8IG1hdGNoLmluZGV4ID09IG51bGwpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsYWJlbFN0YXJ0ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICBjb25zdCBsYWJlbFRleHQgPSBtYXRjaFsyXSA/PyBtYXRjaFszXTtcbiAgaWYgKCFsYWJlbFRleHQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1sYWJlbFwiLFxuICB9KTtcbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCArIDEsXG4gICAgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5V29yZCh3b3JkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoL15pXFxkKyQvLnRlc3Qod29yZCkgfHwgTExWTV9QUklNSVRJVkVfVFlQRVMuaGFzKHdvcmQpKSB7XG4gICAgcmV0dXJuIFwibG9vbS1sbHZtLXR5cGVcIjtcbiAgfVxuXG4gIHJldHVybiBMTFZNX0tFWVdPUkRTLmdldCh3b3JkKSA/PyBcImxvb20tbGx2bS1wbGFpblwiO1xufVxuXG5mdW5jdGlvbiByZWFkV29yZChsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHZhbHVlOiBzdHJpbmc7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvW0EtWmEtel9dW0EtWmEtejAtOV8uLV0qL3k7XG4gIG1hdGNoLmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCByZXN1bHQgPSBtYXRjaC5leGVjKGxpbmUpO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogcmVzdWx0WzBdLFxuICAgIGVuZDogbWF0Y2gubGFzdEluZGV4LFxuICB9O1xufVxuXG5mdW5jdGlvbiByZWFkU3RyaW5nVG9rZW4obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyBwcmVmaXhFbmQ6IG51bWJlcjsgdmFsdWVTdGFydDogbnVtYmVyOyB2YWx1ZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgbGV0IGN1cnNvciA9IGluZGV4O1xuICBpZiAobGluZVtjdXJzb3JdID09PSBcImNcIiAmJiBsaW5lW2N1cnNvciArIDFdID09PSBcIlxcXCJcIikge1xuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgaWYgKGxpbmVbY3Vyc29yXSAhPT0gXCJcXFwiXCIpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHZhbHVlU3RhcnQgPSBjdXJzb3I7XG4gIGN1cnNvciArPSAxO1xuICB3aGlsZSAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXFxcIikge1xuICAgICAgY3Vyc29yICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFwiXCIpIHtcbiAgICAgIGN1cnNvciArPSAxO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwcmVmaXhFbmQ6IHZhbHVlU3RhcnQsXG4gICAgdmFsdWVTdGFydCxcbiAgICB2YWx1ZUVuZDogY3Vyc29yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaFJlZ2V4VG9rZW4oXG4gIGxpbmU6IHN0cmluZyxcbiAgaW5kZXg6IG51bWJlcixcbiAgcmVnZXg6IFJlZ0V4cCxcbiAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gIHRva2VuczogTGx2bVRva2VuW10sXG4pOiBudW1iZXIgfCBudWxsIHtcbiAgcmVnZXgubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IG1hdGNoID0gcmVnZXguZXhlYyhsaW5lKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHJlZ2V4Lmxhc3RJbmRleCwgY2xhc3NOYW1lIH0pO1xuICByZXR1cm4gcmVnZXgubGFzdEluZGV4O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUb2tlbnModG9rZW5zOiBMbHZtVG9rZW5bXSk6IExsdm1Ub2tlbltdIHtcbiAgdG9rZW5zLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmZyb20gLSByaWdodC5mcm9tIHx8IGxlZnQudG8gLSByaWdodC50byk7XG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgaWYgKHRva2VuLnRvIDw9IGN1cnNvcikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbSA9IE1hdGgubWF4KHRva2VuLmZyb20sIGN1cnNvcik7XG4gICAgbm9ybWFsaXplZC5wdXNoKHsgLi4udG9rZW4sIGZyb20gfSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGVudExpbmVDb3VudChibG9jazogbG9vbUNvZGVCbG9jayk6IG51bWJlciB7XG4gIGlmIChibG9jay5lbmRMaW5lID09PSBibG9jay5zdGFydExpbmUpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGlmIChibG9jay5jb250ZW50Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBibG9jay5lbmRMaW5lID4gYmxvY2suc3RhcnRMaW5lICsgMSA/IDEgOiAwO1xuICB9XG5cbiAgcmV0dXJuIGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBtYXBXb3JkcyhjbGFzc05hbWU6IHN0cmluZywgd29yZHM6IHN0cmluZ1tdKTogQXJyYXk8W3N0cmluZywgc3RyaW5nXT4ge1xuICByZXR1cm4gd29yZHMubWFwKCh3b3JkKSA9PiBbd29yZCwgY2xhc3NOYW1lXSk7XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHNob3J0SGFzaChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKGlucHV0KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uIHtcbiAgaWQ6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGFsaWFzZXM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZVBhY2thZ2Uge1xuICBpZDogc3RyaW5nO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICBsYW5ndWFnZXM6IGxvb21MYW5ndWFnZURlZmluaXRpb25bXTtcbn1cblxuZXhwb3J0IGNvbnN0IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTOiBsb29tTGFuZ3VhZ2VQYWNrYWdlW10gPSBbXG4gIHtcbiAgICBpZDogXCJpbnRlcnByZXRlZFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkludGVycHJldGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiU2NyaXB0IGFuZCBSRVBMLW9yaWVudGVkIGxhbmd1YWdlcyBmb3Igb3BlcmF0aW9uYWwgbm90ZXMgYW5kIHF1aWNrIGV4cGVyaW1lbnRzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJweXRob25cIiwgZGlzcGxheU5hbWU6IFwiUHl0aG9uXCIsIGFsaWFzZXM6IFtcInB5dGhvblwiLCBcInB5XCJdIH0sXG4gICAgICB7IGlkOiBcImphdmFzY3JpcHRcIiwgZGlzcGxheU5hbWU6IFwiSmF2YVNjcmlwdFwiLCBhbGlhc2VzOiBbXCJqYXZhc2NyaXB0XCIsIFwianNcIl0gfSxcbiAgICAgIHsgaWQ6IFwidHlwZXNjcmlwdFwiLCBkaXNwbGF5TmFtZTogXCJUeXBlU2NyaXB0XCIsIGFsaWFzZXM6IFtcInR5cGVzY3JpcHRcIiwgXCJ0c1wiXSB9LFxuICAgICAgeyBpZDogXCJzaGVsbFwiLCBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLCBhbGlhc2VzOiBbXCJzaGVsbFwiLCBcInNoXCIsIFwiYmFzaFwiLCBcInpzaFwiXSB9LFxuICAgICAgeyBpZDogXCJydWJ5XCIsIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIiwgYWxpYXNlczogW1wicnVieVwiLCBcInJiXCJdIH0sXG4gICAgICB7IGlkOiBcInBlcmxcIiwgZGlzcGxheU5hbWU6IFwiUGVybFwiLCBhbGlhc2VzOiBbXCJwZXJsXCIsIFwicGxcIl0gfSxcbiAgICAgIHsgaWQ6IFwibHVhXCIsIGRpc3BsYXlOYW1lOiBcIkx1YVwiLCBhbGlhc2VzOiBbXCJsdWFcIl0gfSxcbiAgICAgIHsgaWQ6IFwicGhwXCIsIGRpc3BsYXlOYW1lOiBcIlBIUFwiLCBhbGlhc2VzOiBbXCJwaHBcIl0gfSxcbiAgICAgIHsgaWQ6IFwiZ29cIiwgZGlzcGxheU5hbWU6IFwiR29cIiwgYWxpYXNlczogW1wiZ29cIiwgXCJnb2xhbmdcIl0gfSxcbiAgICAgIHsgaWQ6IFwiaGFza2VsbFwiLCBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsIGFsaWFzZXM6IFtcImhhc2tlbGxcIiwgXCJoc1wiXSB9LFxuICAgICAgeyBpZDogXCJvY2FtbFwiLCBkaXNwbGF5TmFtZTogXCJPQ2FtbFwiLCBhbGlhc2VzOiBbXCJvY2FtbFwiLCBcIm1sXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm5hdGl2ZS1jb21waWxlZFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIk5hdGl2ZSBDb21waWxlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkxhbmd1YWdlcyBjb21waWxlZCBpbnRvIG5hdGl2ZSBiaW5hcmllcyBieSBsb2NhbCB0b29sY2hhaW5zLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJjXCIsIGRpc3BsYXlOYW1lOiBcIkNcIiwgYWxpYXNlczogW1wiY1wiLCBcImhcIl0gfSxcbiAgICAgIHsgaWQ6IFwiY3BwXCIsIGRpc3BsYXlOYW1lOiBcIkMrK1wiLCBhbGlhc2VzOiBbXCJjcHBcIiwgXCJjeHhcIiwgXCJjY1wiLCBcImMrK1wiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJtYW5hZ2VkLWNvbXBpbGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTWFuYWdlZCBDb21waWxlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkNvbXBpbGVkIGxhbmd1YWdlcyB3aXRoIG1hbmFnZWQgcnVudGltZXMgb3Igc3RydWN0dXJlZCBidWlsZC9ydW4gcGhhc2VzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJydXN0XCIsIGRpc3BsYXlOYW1lOiBcIlJ1c3RcIiwgYWxpYXNlczogW1wicnVzdFwiLCBcInJzXCJdIH0sXG4gICAgICB7IGlkOiBcImphdmFcIiwgZGlzcGxheU5hbWU6IFwiSmF2YVwiLCBhbGlhc2VzOiBbXCJqYXZhXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcInByb29mc1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlByb29mc1wiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlByb29mIGFzc2lzdGFudHMgYW5kIHNvbHZlci1vcmllbnRlZCBsYW5ndWFnZXMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImxlYW5cIiwgZGlzcGxheU5hbWU6IFwiTGVhblwiLCBhbGlhc2VzOiBbXCJsZWFuXCIsIFwibGVhbjRcIl0gfSxcbiAgICAgIHsgaWQ6IFwiY29xXCIsIGRpc3BsYXlOYW1lOiBcIkNvcVwiLCBhbGlhc2VzOiBbXCJjb3FcIiwgXCJ2XCJdIH0sXG4gICAgICB7IGlkOiBcInNtdGxpYlwiLCBkaXNwbGF5TmFtZTogXCJTTVQtTElCXCIsIGFsaWFzZXM6IFtcInNtdFwiLCBcInNtdDJcIiwgXCJzbXRsaWJcIiwgXCJzbXQtbGliXCIsIFwiejNcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibGx2bVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkxMVk1cIixcbiAgICBkZXNjcmlwdGlvbjogXCJMTFZNIElSIHRvb2xpbmcgZm9yIGNvbXBpbGVyIGFuZCBQTCByZXNlYXJjaCB2YXVsdHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImxsdm0taXJcIiwgZGlzcGxheU5hbWU6IFwiTExWTSBJUlwiLCBhbGlhc2VzOiBbXCJsbHZtXCIsIFwibGx2bWlyXCIsIFwibGx2bS1pclwiLCBcImxsXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcImVicGZcIixcbiAgICBkaXNwbGF5TmFtZTogXCJlQlBGXCIsXG4gICAgZGVzY3JpcHRpb246IFwiS2VybmVsIGluc3RydW1lbnRhdGlvbiBsYW5ndWFnZXMgZm9yIEJQRiBvYmplY3QgY29tcGlsYXRpb24sIHZlcmlmaWVyIGNoZWNrcywgYW5kIGJwZnRyYWNlIHNjcmlwdHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImVicGYtY1wiLCBkaXNwbGF5TmFtZTogXCJlQlBGIENcIiwgYWxpYXNlczogW1wiZWJwZlwiLCBcImVicGYtY1wiLCBcImJwZi1jXCIsIFwiYnBmXCJdIH0sXG4gICAgICB7IGlkOiBcImJwZnRyYWNlXCIsIGRpc3BsYXlOYW1lOiBcImJwZnRyYWNlXCIsIGFsaWFzZXM6IFtcImJwZnRyYWNlXCIsIFwiYnRcIl0gfSxcbiAgICBdLFxuICB9LFxuXTtcblxuZXhwb3J0IGNvbnN0IENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lEID0gXCJjdXN0b21cIjtcbmV4cG9ydCBjb25zdCBMQU5HVUFHRV9DT05GSUdVUkFUSU9OX1ZFUlNJT04gPSAyO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbLi4uQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMubWFwKChwYWNrKSA9PiBwYWNrLmlkKSwgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSURdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLmZsYXRNYXAoKHBhY2spID0+IHBhY2subGFuZ3VhZ2VzLm1hcCgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLmlkKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHZvaWQge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MpIHx8ICFzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyA9IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyA9IGdldERlZmF1bHRMYW5ndWFnZUlkcygpO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24pKSB7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IDE7XG4gIH1cbiAgaWYgKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24gPCAyKSB7XG4gICAgZW5hYmxlTGFuZ3VhZ2VQYWNrYWdlKHNldHRpbmdzLCBcImVicGZcIik7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTjtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgcGFja2FnZUlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcGFjayA9IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBwYWNrYWdlSWQpO1xuICBpZiAoIXBhY2spIHtcbiAgICByZXR1cm47XG4gIH1cbiAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBwYWNrLmlkKTtcbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgIGFwcGVuZFVuaXF1ZShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLCBsYW5ndWFnZS5pZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kVW5pcXVlKHZhbHVlczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKCF2YWx1ZXMuaW5jbHVkZXModmFsdWUpKSB7XG4gICAgdmFsdWVzLnB1c2godmFsdWUpO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgY29uc3QgZW5hYmxlZFBhY2tzID0gbmV3IFNldChzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyk7XG4gIGNvbnN0IGVuYWJsZWRMYW5ndWFnZXMgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMpO1xuXG4gIHJldHVybiBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFU1xuICAgIC5maWx0ZXIoKHBhY2spID0+IGVuYWJsZWRQYWNrcy5oYXMocGFjay5pZCkpXG4gICAgLmZsYXRNYXAoKHBhY2spID0+IHBhY2subGFuZ3VhZ2VzKVxuICAgIC5maWx0ZXIoKGxhbmd1YWdlKSA9PiBlbmFibGVkTGFuZ3VhZ2VzLmhhcyhsYW5ndWFnZS5pZCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuZmxhdE1hcCgobGFuZ3VhZ2UpID0+XG4gICAgICBsYW5ndWFnZS5hbGlhc2VzLm1hcCgoYWxpYXMpID0+IFthbGlhcy50b0xvd2VyQ2FzZSgpLCBsYW5ndWFnZS5pZF0gYXMgY29uc3QpLFxuICAgICksXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0xhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuc29tZSgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLmlkID09PSBsYW5ndWFnZUlkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICByZXR1cm4gc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMoQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQpO1xufVxuIiwgImltcG9ydCB7IHNob3J0SGFzaCB9IGZyb20gXCIuL3V0aWxzL2hhc2hcIjtcbmltcG9ydCB7IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQsIGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBPVVRQVVRfU1RBUlQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6c3RhcnRcXHMraWQ9KFthLWYwLTldKylcXHMqLS0+JC9pO1xuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xuY29uc3QgRkVOQ0VfU1RBUlQgPSAvXihgYGArfH5+fispXFxzKihbXlxcc2BdKik/KC4qKSQvO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2UocmF3TGFuZ3VhZ2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTm9ybWFsaXplZExhbmd1YWdlIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICBpZiAoIXNldHRpbmdzKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBpZiAoYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5ncykpIHtcbiAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgICBpZiAobmFtZSAmJiAobmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSkge1xuICAgICAgICByZXR1cm4gbGFuZ3VhZ2UubmFtZS50cmltKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3QgYWxpYXNlcyA9IGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwKHNldHRpbmdzKTtcbiAgcmV0dXJuIGFsaWFzZXNbbm9ybWFsaXplZF0gPz8gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyhzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZ1tdIHtcbiAgaWYgKCFzZXR0aW5ncykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGN1c3RvbUFsaWFzZXMgPSBhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKVxuICAgID8gKHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkuZmxhdE1hcCgobGFuZ3VhZ2UpID0+IHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIHJldHVybiBbbmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldO1xuICAgIH0pXG4gICAgOiBbXTtcblxuICByZXR1cm4gW1xuICAgIC4uLk9iamVjdC5rZXlzKGdldEVuYWJsZWRMYW5ndWFnZUFsaWFzTWFwKHNldHRpbmdzKSksXG4gICAgLi4uY3VzdG9tQWxpYXNlcyxcbiAgXS5tYXAoKGFsaWFzKSA9PiBhbGlhcy50b0xvd2VyQ2FzZSgpKS5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29kZUJsb2NrW10ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBibG9ja3M6IGxvb21Db2RlQmxvY2tbXSA9IFtdO1xuICBsZXQgb3JkaW5hbCA9IDA7XG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcblxuICAgIGlmIChpbnNpZGVNYW5hZ2VkT3V0cHV0KSB7XG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZlbmNlTWF0Y2ggPSBsaW5lLm1hdGNoKEZFTkNFX1NUQVJUKTtcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0TGluZSA9IGk7XG4gICAgY29uc3QgZmVuY2VJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKTtcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcbiAgICBjb25zdCBzb3VyY2VMYW5ndWFnZSA9IChmZW5jZU1hdGNoWzJdID8/IFwiXCIpLnRyaW0oKTtcbiAgICBjb25zdCBpbmZvQXR0cmlidXRlcyA9IHBhcnNlSW5mb0F0dHJpYnV0ZXMoZmVuY2VNYXRjaFszXSA/PyBcIlwiKTtcbiAgICBjb25zdCBzb3VyY2VSZWZlcmVuY2UgPSBwYXJzZVNvdXJjZVJlZmVyZW5jZShpbmZvQXR0cmlidXRlcyk7XG4gICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHBhcnNlRXhlY3V0aW9uQ29udGV4dChpbmZvQXR0cmlidXRlcyk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBub3JtYWxpemVMYW5ndWFnZShzb3VyY2VMYW5ndWFnZSwgc2V0dGluZ3MpO1xuXG4gICAgbGV0IGVuZExpbmUgPSBpO1xuICAgIGNvbnN0IGNvbnRlbnRMaW5lczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICBjb25zdCBpbm5lckxpbmUgPSBsaW5lc1tqXTtcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSBpbm5lckxpbmUudHJpbSgpO1xuXG4gICAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKGZlbmNlVG9rZW4pICYmIC9eKGBgYCt8fn5+KylcXHMqJC8udGVzdCh0cmltbWVkKSkge1xuICAgICAgICBlbmRMaW5lID0gajtcbiAgICAgICAgaSA9IGo7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb250ZW50TGluZXMucHVzaChzdHJpcEZlbmNlSW5kZW50KGlubmVyTGluZSwgZmVuY2VJbmRlbnQpKTtcbiAgICAgIGVuZExpbmUgPSBqO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIG9yZGluYWwgKz0gMTtcbiAgICBjb25zdCBjb250ZW50ID0gY29udGVudExpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgY29uc3QgcmVmZXJlbmNlSGFzaCA9IHNvdXJjZVJlZmVyZW5jZSA/IGA6JHtKU09OLnN0cmluZ2lmeShzb3VyY2VSZWZlcmVuY2UpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGV4ZWN1dGlvbkhhc2ggPSBleGVjdXRpb25Db250ZXh0SGFzVmFsdWVzKGV4ZWN1dGlvbkNvbnRleHQpID8gYDoke0pTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbkNvbnRleHQpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGF0dHJpYnV0ZUhhc2ggPSBPYmplY3Qua2V5cyhpbmZvQXR0cmlidXRlcykubGVuZ3RoID8gYDoke0pTT04uc3RyaW5naWZ5KGluZm9BdHRyaWJ1dGVzKX1gIDogXCJcIjtcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChgJHtjb250ZW50fSR7cmVmZXJlbmNlSGFzaH0ke2V4ZWN1dGlvbkhhc2h9JHthdHRyaWJ1dGVIYXNofWApO1xuICAgIGNvbnN0IGlkID0gc2hvcnRIYXNoKGAke2ZpbGVQYXRofToke29yZGluYWx9OiR7bGFuZ3VhZ2V9OiR7Y29udGVudEhhc2h9YCk7XG5cbiAgICBibG9ja3MucHVzaCh7XG4gICAgICBpZCxcbiAgICAgIG9yZGluYWwsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgbGFuZ3VhZ2VBbGlhczogc291cmNlTGFuZ3VhZ2UudG9Mb3dlckNhc2UoKSxcbiAgICAgIHNvdXJjZUxhbmd1YWdlLFxuICAgICAgY29udGVudCxcbiAgICAgIGF0dHJpYnV0ZXM6IGluZm9BdHRyaWJ1dGVzLFxuICAgICAgc291cmNlUmVmZXJlbmNlLFxuICAgICAgZXhlY3V0aW9uQ29udGV4dCxcbiAgICAgIHN0YXJ0TGluZSxcbiAgICAgIGVuZExpbmUsXG4gICAgICBmZW5jZVN0YXJ0OiAwLFxuICAgICAgZmVuY2VFbmQ6IDAsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBleGVjdXRpb25Db250ZXh0SGFzVmFsdWVzKGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIHBhcnNlRXhlY3V0aW9uQ29udGV4dD4pOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oY29udGV4dC5jb250YWluZXJHcm91cCB8fCBjb250ZXh0LmRpc2FibGVDb250YWluZXIgfHwgY29udGV4dC53b3JraW5nRGlyZWN0b3J5IHx8IGNvbnRleHQudGltZW91dE1zKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNvdXJjZVJlZmVyZW5jZShhdHRyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IGxvb21Tb3VyY2VSZWZlcmVuY2UgfCB1bmRlZmluZWQge1xuICBjb25zdCBmaWxlUGF0aCA9IGF0dHJzW1wibG9vbS1maWxlXCJdID8/IGF0dHJzLmZpbGUgPz8gYXR0cnMuc3JjID8/IGF0dHJzLnNvdXJjZTtcbiAgaWYgKCFmaWxlUGF0aCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGF0dHJzW1wibG9vbS1saW5lc1wiXSA/PyBhdHRycy5saW5lcyA/PyBhdHRycy5saW5lO1xuICBjb25zdCBsaW5lUmFuZ2UgPSBsaW5lcyA/IHBhcnNlTGluZVJhbmdlKGxpbmVzKSA6IG51bGw7XG4gIGNvbnN0IHN5bWJvbE5hbWUgPSBhdHRyc1tcImxvb20tc3ltYm9sXCJdID8/IGF0dHJzLnN5bWJvbCA/PyBhdHRycy5mbiA/PyBhdHRycy5mdW5jdGlvbjtcbiAgY29uc3QgdHJhY2VWYWx1ZSA9IGF0dHJzW1wibG9vbS1kZXBzXCJdID8/IGF0dHJzLmRlcHMgPz8gYXR0cnMudHJhY2U7XG4gIGNvbnN0IGNhbGxFeHByZXNzaW9uID0gYXR0cnNbXCJsb29tLWNhbGxcIl0gPz8gYXR0cnMuY2FsbDtcbiAgY29uc3QgY2FsbEFyZ3MgPSBhdHRyc1tcImxvb20tYXJnc1wiXSA/PyBhdHRycy5hcmdzO1xuICBjb25zdCBwcmludFZhbHVlID0gYXR0cnNbXCJsb29tLXByaW50XCJdID8/IGF0dHJzLnByaW50O1xuICBjb25zdCBjYWxsID0gY2FsbEV4cHJlc3Npb24gIT0gbnVsbCB8fCBjYWxsQXJncyAhPSBudWxsXG4gICAgPyB7XG4gICAgICBleHByZXNzaW9uOiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKGNhbGxFeHByZXNzaW9uKSA9PT0gXCJ0cnVlXCIgPyB1bmRlZmluZWQgOiBjYWxsRXhwcmVzc2lvbixcbiAgICAgIGFyZ3M6IGNhbGxBcmdzLFxuICAgICAgcHJpbnQ6IHByaW50VmFsdWUgPT0gbnVsbCA/IHRydWUgOiAhW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIl0uaW5jbHVkZXMocHJpbnRWYWx1ZS50b0xvd2VyQ2FzZSgpKSxcbiAgICB9XG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlUGF0aCxcbiAgICBsaW5lU3RhcnQ6IGxpbmVSYW5nZT8uc3RhcnQsXG4gICAgbGluZUVuZDogbGluZVJhbmdlPy5lbmQsXG4gICAgc3ltYm9sTmFtZSxcbiAgICB0cmFjZURlcGVuZGVuY2llczogdHJhY2VWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyh0cmFjZVZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIGNhbGwsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXhlY3V0aW9uQ29udGV4dChhdHRyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICBjb25zdCBjb250YWluZXIgPSBhdHRyc1tcImxvb20tY29udGFpbmVyXCJdID8/IGF0dHJzLmNvbnRhaW5lcjtcbiAgY29uc3QgdGltZW91dCA9IGF0dHJzW1wibG9vbS10aW1lb3V0XCJdID8/IGF0dHJzLnRpbWVvdXQ7XG4gIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSBhdHRyc1tcImxvb20tY3dkXCJdID8/IGF0dHJzLmN3ZCA/PyBhdHRyc1tcIndvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0ID8gcGFyc2VQb3NpdGl2ZUludGVnZXIodGltZW91dCkgOiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogY29udGFpbmVyICYmICFpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA/IGNvbnRhaW5lciA6IHVuZGVmaW5lZCxcbiAgICBkaXNhYmxlQ29udGFpbmVyOiBjb250YWluZXIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgIHRpbWVvdXRNcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQm9vbGVhbkF0dHJpYnV0ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB1bmRlZmluZWQgOiB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VJbmZvQXR0cmlidXRlcyhpbnB1dDogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IHBhdHRlcm4gPSAvKFtBLVphLXowLTlfLV0rKVxccyo9XFxzKig/OlwiKFteXCJdKilcInwnKFteJ10qKSd8KFteXFxzXSspKS9nO1xuICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobWF0Y2ggPSBwYXR0ZXJuLmV4ZWMoaW5wdXQpKSAhPSBudWxsKSB7XG4gICAgYXR0cnNbbWF0Y2hbMV0udG9Mb3dlckNhc2UoKV0gPSBtYXRjaFsyXSA/PyBtYXRjaFszXSA/PyBtYXRjaFs0XSA/PyBcIlwiO1xuICB9XG4gIHJldHVybiBhdHRycztcbn1cblxuZnVuY3Rpb24gcGFyc2VMaW5lUmFuZ2UodmFsdWU6IHN0cmluZyk6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHZhbHVlLnRyaW0oKS5tYXRjaCgvXkw/KFxcZCspKD86XFxzKlstOl1cXHMqTD8oXFxkKykpPyQvaSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICBjb25zdCBlbmQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMl0gPz8gbWF0Y2hbMV0sIDEwKTtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHN0YXJ0KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihlbmQpIHx8IHN0YXJ0IDw9IDAgfHwgZW5kIDwgc3RhcnQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gbGluZSA+PSBibG9jay5zdGFydExpbmUgJiYgbGluZSA8PSBibG9jay5lbmRMaW5lKSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFmZW5jZUluZGVudCkge1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbGluZS5zbGljZShpbmRleCk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIHN5bWJvbEV4dHJhY3Rpb246IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiIHwgXCJ0b3AtbGV2ZWxcIiB8IFwiZ2VuZXJpY1wiIHwgXCJleHRlcm5hbFwiO1xuICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiIHwgXCJyYXdcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgc291cmNlUHJldmlldzogYm9vbGVhbjtcbn1cblxuY29uc3QgQlVJTFRfSU5fQ0FQQUJJTElUSUVTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5PiA9IHtcbiAgcHl0aG9uOiB7XG4gICAgbGFuZ3VhZ2U6IFwicHl0aG9uXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJhc3RcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmFzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIHR5cGVzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJ0eXBlc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGM6IHtcbiAgICBsYW5ndWFnZTogXCJjXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGNwcDoge1xuICAgIGxhbmd1YWdlOiBcImNwcFwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwiYnVpbHQtaW5cIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBcImxsdm0taXJcIjoge1xuICAgIGxhbmd1YWdlOiBcImxsdm0taXJcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGhhc2tlbGw6IHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBvY2FtbDoge1xuICAgIGxhbmd1YWdlOiBcIm9jYW1sXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmE6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBcImVicGYtY1wiOiB7XG4gICAgbGFuZ3VhZ2U6IFwiZWJwZi1jXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBicGZ0cmFjZToge1xuICAgIGxhbmd1YWdlOiBcImJwZnRyYWNlXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGFuZ3VhZ2VDYXBhYmlsaXR5KGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBoYXNFeHRlcm5hbEV4dHJhY3RvciA9IGZhbHNlKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eSB7XG4gIGlmIChoYXNFeHRlcm5hbEV4dHJhY3Rvcikge1xuICAgIHJldHVybiB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHN5bWJvbEV4dHJhY3Rpb246IFwiZXh0ZXJuYWxcIixcbiAgICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImV4dGVybmFsXCIsXG4gICAgICBjYWxsSGFybmVzczogXCJleHRlcm5hbFwiLFxuICAgICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIEJVSUxUX0lOX0NBUEFCSUxJVElFU1tsYW5ndWFnZV0gPz8ge1xuICAgIGxhbmd1YWdlLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwiZ2VuZXJpY1wiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImdlbmVyaWNcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QnVpbHRJbkxhbmd1YWdlQ2FwYWJpbGl0aWVzKCk6IGxvb21MYW5ndWFnZUNhcGFiaWxpdHlbXSB7XG4gIHJldHVybiBPYmplY3QudmFsdWVzKEJVSUxUX0lOX0NBUEFCSUxJVElFUyk7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5vZGVSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5vZGVcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5vZGUuanNcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiamF2YXNjcmlwdFwiLCBcInR5cGVzY3JpcHRcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5qc1wiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPT09IFwidHN4XCIgPyBcIlR5cGVTY3JpcHQgKHRzeClcIiA6IFwiVHlwZVNjcmlwdCAodHMtbm9kZSlcIjtcblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7c2V0dGluZ3MudHlwZXNjcmlwdE1vZGV9YCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIEN1c3RvbUxhbmd1YWdlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJjdXN0b21cIjtcbiAgZGlzcGxheU5hbWUgPSBcIkN1c3RvbSBsYW5ndWFnZVwiO1xuICBsYW5ndWFnZXMgPSBbXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk/LmV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGN1c3RvbSBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2xhbmd1YWdlLm5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBsYW5ndWFnZS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuYXJncyB8fCBcIntmaWxlfVwiKSxcbiAgICAgIGZpbGVFeHRlbnNpb246IG5vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24sIGxhbmd1YWdlLm5hbWUpLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ3VzdG9tTGFuZ3VhZ2UgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICByZXR1cm4gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gYC4ke25hbWV9YDtcbiAgfVxuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBJbnRlcnByZXRlZFNwZWMge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpID0+IHN0cmluZztcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nW107XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xuICBtaW5pbXVtVGltZW91dE1zPzogbnVtYmVyO1xufVxuXG5jb25zdCBJTlRFUlBSRVRFRF9TUEVDUzogSW50ZXJwcmV0ZWRTcGVjW10gPSBbXG4gIHtcbiAgICBsYW5ndWFnZTogXCJzaGVsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuc2hcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInJ1YnlcIixcbiAgICBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5yYlwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGVybFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBlcmxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBlcmxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBsXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJsdWFcIixcbiAgICBkaXNwbGF5TmFtZTogXCJMdWFcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmx1YUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIubHVhXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwaHBcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQSFBcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBocEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGhwXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJnb1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkdvXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5nb0V4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuZ29cIixcbiAgICBhcmdzOiBbXCJydW5cIiwgXCJ7ZmlsZX1cIl0sXG4gICAgZW52OiB7XG4gICAgICBHT0NBQ0hFOiBcInt0ZW1wRGlyfS9nb2NhY2hlXCIsXG4gICAgfSxcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSGFza2VsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuaHNcIixcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgSW50ZXJwcmV0ZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImludGVycHJldGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJJbnRlcnByZXRlZFwiO1xuICBsYW5ndWFnZXMgPSBJTlRFUlBSRVRFRF9TUEVDUy5tYXAoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UpO1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIHJldHVybiBCb29sZWFuKHNwZWM/LmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgaWYgKCFzcGVjKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9YCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncyA/PyBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBzcGVjLmZpbGVFeHRlbnNpb24sXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzcGVjLm1pbmltdW1UaW1lb3V0TXMgPz8gMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICBlbnY6IHNwZWMuZW52LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTcGVjKGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogSW50ZXJwcmV0ZWRTcGVjIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gSU5URVJQUkVURURfU1BFQ1MuZmluZCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSA9PT0gbGFuZ3VhZ2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgRWJwZkNNb2RlID0gXCJjb21waWxlXCIgfCBcImxvYWRcIjtcbnR5cGUgQnBmdHJhY2VNb2RlID0gXCJjaGVja1wiIHwgXCJydW5cIjtcblxuZXhwb3J0IGNsYXNzIEVicGZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImVicGZcIjtcbiAgZGlzcGxheU5hbWUgPSBcImVCUEZcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiZWJwZi1jXCIsIFwiYnBmdHJhY2VcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImVicGYtY1wiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5lYnBmQ2xhbmdFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJicGZ0cmFjZVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJlYnBmLWNcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuRWJwZkMoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImJwZnRyYWNlXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkJwZnRyYWNlKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgZUJQRiBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuRWJwZkMoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHJlYWRFYnBmQ01vZGUoYmxvY2spO1xuICAgIGNvbnN0IGNmbGFncyA9IHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1jZmxhZ3NcIiwgXCJlYnBmLWNmbGFnc1wiKS5mbGF0TWFwKHNwbGl0Q29tbWFuZExpbmUpO1xuICAgIGNvbnN0IGluY2x1ZGVQYXRocyA9IFtcbiAgICAgIC4uLnNwbGl0Q3N2KHNldHRpbmdzLmVicGZJbmNsdWRlUGF0aHMpLFxuICAgICAgLi4ucmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLWluY2x1ZGVzXCIsIFwiZWJwZi1pbmNsdWRlc1wiKSxcbiAgICBdO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5icGYuY1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBvYmplY3RQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQuYnBmLm9cIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjbGFuZ2AsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiZUJQRiBjbGFuZ1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5lYnBmQ2xhbmdFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIFwiLXRhcmdldFwiLFxuICAgICAgICAgIFwiYnBmXCIsXG4gICAgICAgICAgXCItTzJcIixcbiAgICAgICAgICBcIi1nXCIsXG4gICAgICAgICAgXCItV2FsbFwiLFxuICAgICAgICAgIC4uLmluY2x1ZGVQYXRocy5mbGF0TWFwKChpbmNsdWRlUGF0aCkgPT4gW1wiLUlcIiwgaW5jbHVkZVBhdGhdKSxcbiAgICAgICAgICAuLi5jZmxhZ3MsXG4gICAgICAgICAgXCItY1wiLFxuICAgICAgICAgIHRlbXBGaWxlLFxuICAgICAgICAgIFwiLW9cIixcbiAgICAgICAgICBvYmplY3RQYXRoLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIGNvbXBpbGVSZXN1bHQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihjb21waWxlUmVzdWx0LnN0ZG91dCwgXCJDb21waWxlXCIsIGBlQlBGIG9iamVjdCBjb21waWxlZCBzdWNjZXNzZnVsbHk6ICR7b2JqZWN0UGF0aH1gKTtcbiAgICAgIGF3YWl0IHRoaXMuYXBwZW5kT2JqZWN0SW5zcGVjdGlvbihjb21waWxlUmVzdWx0LCBvYmplY3RQYXRoLCBjb250ZXh0LCBzZXR0aW5ncyk7XG5cbiAgICAgIGlmIChtb2RlID09PSBcImNvbXBpbGVcIikge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMubG9hZEVicGZPYmplY3QoYmxvY2ssIG9iamVjdFBhdGgsIGNvbnRleHQsIHNldHRpbmdzLCBjb21waWxlUmVzdWx0KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwZW5kT2JqZWN0SW5zcGVjdGlvbihyZXN1bHQ6IGxvb21SdW5SZXN1bHQsIG9iamVjdFBhdGg6IHN0cmluZywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBvYmpkdW1wID0gc2V0dGluZ3MuZWJwZkxsdm1PYmpkdW1wRXhlY3V0YWJsZS50cmltKCk7XG4gICAgaWYgKCFvYmpkdW1wKSB7XG4gICAgICByZXN1bHQud2FybmluZyA9IGFwcGVuZExpbmUocmVzdWx0Lndhcm5pbmcsIFwiZUJQRiBvYmplY3QgaW5zcGVjdGlvbiBza2lwcGVkIGJlY2F1c2Ugbm8gb2JqZWN0IGluc3BlY3RvciBpcyBjb25maWd1cmVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBpbnNwZWN0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2JqZHVtcGAsXG4gICAgICBydW5uZXJOYW1lOiBcImVCUEYgb2JqZWN0IGluc3BlY3Rpb25cIixcbiAgICAgIGV4ZWN1dGFibGU6IG9iamR1bXAsXG4gICAgICBhcmdzOiBbXCItaFwiLCBvYmplY3RQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgaWYgKGluc3BlY3Quc3VjY2Vzcykge1xuICAgICAgcmVzdWx0LnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24ocmVzdWx0LnN0ZG91dCwgXCJPYmplY3Qgc2VjdGlvbnNcIiwgaW5zcGVjdC5zdGRvdXQudHJpbSgpIHx8IFwiKG5vIHNlY3Rpb25zIHJlcG9ydGVkKVwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSBhcHBlbmRMaW5lKHJlc3VsdC53YXJuaW5nLCBgZUJQRiBvYmplY3QgaW5zcGVjdGlvbiBmYWlsZWQ6ICR7aW5zcGVjdC5zdGRlcnIgfHwgaW5zcGVjdC5zdGRvdXQgfHwgYGV4aXQgJHtpbnNwZWN0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkRWJwZk9iamVjdChcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBvYmplY3RQYXRoOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgICBjb21waWxlUmVzdWx0OiBsb29tUnVuUmVzdWx0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoIXNldHRpbmdzLmVicGZBbGxvd0tlcm5lbExvYWQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmNvbXBpbGVSZXN1bHQsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgIHN0ZGVycjogYXBwZW5kTGluZShjb21waWxlUmVzdWx0LnN0ZGVyciwgXCJlQlBGIGtlcm5lbCBsb2FkaW5nIGlzIGRpc2FibGVkLiBFbmFibGUgQWxsb3cgZUJQRiBrZXJuZWwgbG9hZCBpbiBzZXR0aW5ncyBiZWZvcmUgdXNpbmcgbG9vbS1lYnBmLW1vZGU9bG9hZC5cIiksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHBpblBhdGggPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1waW5cIiwgXCJlYnBmLXBpblwiKTtcbiAgICBpZiAoIXBpblBhdGgpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmNvbXBpbGVSZXN1bHQsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgIHN0ZGVycjogYXBwZW5kTGluZShjb21waWxlUmVzdWx0LnN0ZGVyciwgXCJsb29tLWVicGYtbW9kZT1sb2FkIHJlcXVpcmVzIGxvb20tZWJwZi1waW49L3N5cy9mcy9icGYvPHBhdGg+LlwiKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgbG9hZCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmJwZnRvb2w6bG9hZGAsXG4gICAgICBydW5uZXJOYW1lOiBcImJwZnRvb2wgZUJQRiBsb2FkXCIsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5lYnBmQnBmdG9vbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYnBmdG9vbFwiLFxuICAgICAgYXJnczogW1wiLWRcIiwgXCJwcm9nXCIsIFwibG9hZGFsbFwiLCBvYmplY3RQYXRoLCBwaW5QYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgbG9hZC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKGNvbXBpbGVSZXN1bHQuc3Rkb3V0LCBcImJwZnRvb2wgc3Rkb3V0XCIsIGxvYWQuc3Rkb3V0LnRyaW0oKSk7XG4gICAgbG9hZC5zdGRlcnIgPSBhcHBlbmRTZWN0aW9uKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImJwZnRvb2wgc3RkZXJyXCIsIGxvYWQuc3RkZXJyLnRyaW0oKSk7XG4gICAgbG9hZC53YXJuaW5nID0gYXBwZW5kTGluZShjb21waWxlUmVzdWx0Lndhcm5pbmcsIGBlQlBGIG9iamVjdCBsb2FkIHJlcXVlc3RlZCB3aXRoIHBpbiBwYXRoICR7cGluUGF0aH0uYCk7XG4gICAgcmV0dXJuIGxvYWQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkJwZnRyYWNlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSByZWFkQnBmdHJhY2VNb2RlKGJsb2NrKTtcbiAgICBjb25zdCBleHRyYUFyZ3MgPSByZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWJwZnRyYWNlLWFyZ3NcIiwgXCJicGZ0cmFjZS1hcmdzXCIpLmZsYXRNYXAoc3BsaXRDb21tYW5kTGluZSk7XG4gICAgY29uc3QgYXJncyA9IG1vZGUgPT09IFwiY2hlY2tcIlxuICAgICAgPyBbXCItZFwiLCAuLi5leHRyYUFyZ3MsIFwie2ZpbGV9XCJdXG4gICAgICA6IFsuLi5leHRyYUFyZ3MsIFwie2ZpbGV9XCJdO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5idFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRmlsZSB9KSA9PlxuICAgICAgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpicGZ0cmFjZToke21vZGV9YCxcbiAgICAgICAgcnVubmVyTmFtZTogbW9kZSA9PT0gXCJjaGVja1wiID8gXCJicGZ0cmFjZSBjaGVja1wiIDogXCJicGZ0cmFjZVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBhcmdzLm1hcCgoYXJnKSA9PiBhcmcucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkpLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBtb2RlID09PSBcInJ1blwiID8gY29udGV4dC5zdGRpbiA6IHVuZGVmaW5lZCxcbiAgICAgIH0pLFxuICAgICk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVhZEVicGZDTW9kZShibG9jazogbG9vbUNvZGVCbG9jayk6IEVicGZDTW9kZSB7XG4gIGNvbnN0IHZhbHVlID0gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtbW9kZVwiLCBcImVicGYtbW9kZVwiKSB8fCBcImNvbXBpbGVcIjtcbiAgaWYgKHZhbHVlID09PSBcImNvbXBpbGVcIiB8fCB2YWx1ZSA9PT0gXCJsb2FkXCIpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBlQlBGIG1vZGU6ICR7dmFsdWV9LiBVc2UgY29tcGlsZSBvciBsb2FkLmApO1xufVxuXG5mdW5jdGlvbiByZWFkQnBmdHJhY2VNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogQnBmdHJhY2VNb2RlIHtcbiAgY29uc3QgdmFsdWUgPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tYnBmdHJhY2UtbW9kZVwiLCBcImJwZnRyYWNlLW1vZGVcIikgfHwgXCJjaGVja1wiO1xuICBpZiAodmFsdWUgPT09IFwiY2hlY2tcIiB8fCB2YWx1ZSA9PT0gXCJydW5cIikge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGJwZnRyYWNlIG1vZGU6ICR7dmFsdWV9LiBVc2UgY2hlY2sgb3IgcnVuLmApO1xufVxuXG5mdW5jdGlvbiByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBwcmltYXJ5OiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gYmxvY2suYXR0cmlidXRlc1twcmltYXJ5XT8udHJpbSgpIHx8IGJsb2NrLmF0dHJpYnV0ZXNbZmFsbGJhY2tdPy50cmltKCkgfHwgdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiByZWFkTGlzdEF0dHJpYnV0ZShibG9jazogbG9vbUNvZGVCbG9jaywgcHJpbWFyeTogc3RyaW5nLCBmYWxsYmFjazogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gc3BsaXRDc3YocmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgcHJpbWFyeSwgZmFsbGJhY2spIHx8IFwiXCIpO1xufVxuXG5mdW5jdGlvbiBzcGxpdENzdih2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoaXRlbSkgPT4gaXRlbS50cmltKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kTGluZShleGlzdGluZzogc3RyaW5nIHwgdW5kZWZpbmVkLCBsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW2V4aXN0aW5nLCBsaW5lXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQ/LnRyaW0oKSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kU2VjdGlvbihleGlzdGluZzogc3RyaW5nLCB0aXRsZTogc3RyaW5nLCBib2R5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBjb250ZW50ID0gYm9keS50cmltKCk7XG4gIGlmICghY29udGVudCkge1xuICAgIHJldHVybiBleGlzdGluZztcbiAgfVxuICByZXR1cm4gW2V4aXN0aW5nLnRyaW0oKSwgYCR7dGl0bGV9OlxcbiR7Y29udGVudH1gXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIlxcblxcblwiKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTGx2bVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibGx2bS1pclwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTExWTSBJUlwiO1xuICBsYW5ndWFnZXMgPSBbXCJsbHZtLWlyXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3VsdC50aW1lZE91dCAmJiAhcmVzdWx0LmNhbmNlbGxlZCAmJiByZXN1bHQuZXhpdENvZGUgIT0gbnVsbCAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcbiAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBQcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uIFVuZGVyIGxsaSwgdGhhdCBiZWNvbWVzIHRoZSBwcm9jZXNzIGV4aXQgc3RhdHVzLmA7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxuICAgICAgICAgID8gXCJMTFZNIHByb2dyYW0gZXhpdGVkIHdpdGggY29kZSAwLlwiXG4gICAgICAgICAgOiBgTExWTSBwcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uXFxuVXNlIHN0ZG91dCBpbiB0aGUgSVIgaXRzZWxmIGlmIHlvdSB3YW50IHByaW50YWJsZSBwcm9ncmFtIG91dHB1dC5gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTWFuYWdlZENvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJtYW5hZ2VkLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcInJ1c3RcIiwgXCJqYXZhXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuUnVzdChibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIucnNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShcIk1haW4uamF2YVwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAoIXNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpzb3VyY2VgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRlbXBEaXIsXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wiLWNwXCIsIHRlbXBEaXIsIFwiTWFpblwiXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5hdGl2ZS1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTmF0aXZlIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY3BwXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IGZpbGVFeHRlbnNpb24gPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIi5jXCIgOiBcIi5jcHBcIjtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCJDIChHQ0MpXCIgOiBcIkMrKyAoRysrKVwiO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShmaWxlRXh0ZW5zaW9uLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCBydW5UZW1wRmlsZVByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBPY2FtbFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwib2NhbWxcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XG4gIGxhbmd1YWdlcyA9IFtcIm9jYW1sXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJvY2FtbFwiICYmIEJvb2xlYW4oc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm9jYW1sTW9kZTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIGlmIChtb2RlID09PSBcIm9jYW1sXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmR1bmVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkR1bmUgLyBPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJleGVjXCIsIFwiLS1cIiwgXCJvY2FtbFwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5tbFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLWNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItb1wiLCBiaW5hcnlQYXRoLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1ydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHl0aG9uUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJweXRob25cIjtcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xuICBsYW5ndWFnZXMgPSBbXCJweXRob25cIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIEJvb2xlYW4oc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFByb29mUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJwcm9vZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJsZWFuXCIsIFwiY29xXCIsIFwic210bGliXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpsZWFuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJMZWFuXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjb3FgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkNvcVwiLFxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXG4gICAgICAgIGFyZ3M6IFtcIi1xXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpzbXRsaWJgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlNNVC1MSUIgKFozKVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvb2YgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQgJiYgY29uZmlndXJlZCAhPT0gXCJjb3FjXCIpIHtcbiAgICByZXR1cm4gY29uZmlndXJlZDtcbiAgfVxuXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3BhbUNvcWMpID8gb3BhbUNvcWMgOiBjb25maWd1cmVkIHx8IFwiY29xY1wiO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgeyBhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkLCBpc0xhbmd1YWdlRW5hYmxlZCB9IGZyb20gXCIuLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tUnVubmVyUmVnaXN0cnkge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHJ1bm5lcnM6IGxvb21SdW5uZXJbXSkge31cblxuICBnZXRSdW5uZXJGb3JCbG9jayhibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21SdW5uZXIgfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuaXNCbG9ja0xhbmd1YWdlRW5hYmxlZChibG9jaywgc2V0dGluZ3MpKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucnVubmVycy5maW5kKChydW5uZXIpID0+ICghcnVubmVyLmxhbmd1YWdlcy5sZW5ndGggfHwgcnVubmVyLmxhbmd1YWdlcy5pbmNsdWRlcyhibG9jay5sYW5ndWFnZSkpICYmIHJ1bm5lci5jYW5SdW4oYmxvY2ssIHNldHRpbmdzKSkgPz8gbnVsbDtcbiAgfVxuXG4gIGdldFN1cHBvcnRlZExhbmd1YWdlcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRoaXMucnVubmVycy5mbGF0TWFwKChydW5uZXIpID0+IHJ1bm5lci5sYW5ndWFnZXMpKV07XG4gIH1cblxuICBwcml2YXRlIGlzQmxvY2tMYW5ndWFnZUVuYWJsZWQoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoaXNMYW5ndWFnZUVuYWJsZWQoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKSAmJiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc29tZSgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gYmxvY2subGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCkgfHwgYWxpYXNlcy5pbmNsdWRlcyhibG9jay5sYW5ndWFnZUFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGdldERlZmF1bHRMYW5ndWFnZUlkcywgZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcyB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IHtcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxuICBoYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrOiBmYWxzZSxcbiAgcHJlc2VydmVTb3VyY2VNb2RlOiB0cnVlLFxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxuICB3b3JraW5nRGlyZWN0b3J5OiBcIlwiLFxuICBweXRob25FeGVjdXRhYmxlOiBcInB5dGhvbjNcIixcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxuICB0eXBlc2NyaXB0TW9kZTogXCJ0cy1ub2RlXCIsXG4gIHR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZTogXCJ0cy1ub2RlXCIsXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxuICBvY2FtbEV4ZWN1dGFibGU6IFwib2NhbWxcIixcbiAgY0V4ZWN1dGFibGU6IFwiZ2NjXCIsXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXG4gIHNoZWxsRXhlY3V0YWJsZTogXCJiYXNoXCIsXG4gIHJ1YnlFeGVjdXRhYmxlOiBcInJ1YnlcIixcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxuICBsdWFFeGVjdXRhYmxlOiBcImx1YVwiLFxuICBwaHBFeGVjdXRhYmxlOiBcInBocFwiLFxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcbiAgcnVzdEV4ZWN1dGFibGU6IFwicnVzdGNcIixcbiAgaGFza2VsbEV4ZWN1dGFibGU6IFwicnVuZ2hjXCIsXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXG4gIGphdmFFeGVjdXRhYmxlOiBcImphdmFcIixcbiAgbGx2bUludGVycHJldGVyRXhlY3V0YWJsZTogXCJsbGlcIixcbiAgZWJwZkNsYW5nRXhlY3V0YWJsZTogXCJjbGFuZ1wiLFxuICBlYnBmQnBmdG9vbEV4ZWN1dGFibGU6IFwiYnBmdG9vbFwiLFxuICBlYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlOiBcImxsdm0tb2JqZHVtcFwiLFxuICBlYnBmSW5jbHVkZVBhdGhzOiBcIlwiLFxuICBlYnBmQWxsb3dLZXJuZWxMb2FkOiBmYWxzZSxcbiAgYnBmdHJhY2VFeGVjdXRhYmxlOiBcImJwZnRyYWNlXCIsXG4gIGxlYW5FeGVjdXRhYmxlOiBcImxlYW5cIixcbiAgY29xRXhlY3V0YWJsZTogXCJjb3FjXCIsXG4gIHNtdEV4ZWN1dGFibGU6IFwiejNcIixcbiAgd3JpdGVPdXRwdXRUb05vdGU6IGZhbHNlLFxuICBvdXRwdXRWaXNpYmxlTGluZXM6IDAsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgZXh0cmFjdGVkU291cmNlUHJldmlld01vZGU6IFwiY29sbGFwc2VkXCIsXG4gIHNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YTogdHJ1ZSxcbiAgbGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbjogMixcbiAgZW5hYmxlZExhbmd1YWdlUGFja3M6IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKSxcbiAgZW5hYmxlZExhbmd1YWdlczogZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCksXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXG4gIHBkZkV4cG9ydE1vZGU6IFwiYm90aFwiLFxuICBkZWZhdWx0Q29udGFpbmVyR3JvdXA6IFwiXCIsXG59O1xuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgeyBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUywgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQsIGdldERlZmF1bHRMYW5ndWFnZUlkcywgZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcywgaXNMYW5ndWFnZUVuYWJsZWQsIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbiB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgeyBERUZBVUxUX1NFVFRJTkdTIH0gZnJvbSBcIi4vZGVmYXVsdFNldHRpbmdzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4pIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJSdW4gc3VwcG9ydGVkIGNvZGUgZmVuY2VzIGRpcmVjdGx5IGZyb20gbm90ZXMgd2hpbGUgcHJlc2VydmluZyBuYXRpdmUgc3ludGF4IGhpZ2hsaWdodGluZy5cIiB9KTtcblxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcbiAgICB0aGlzLnJlbmRlckxhbmd1YWdlUGFja2FnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkxhbmd1YWdlIFBhY2thZ2VzXCIpKTtcbiAgICB0aGlzLnJlbmRlckJ1aWx0SW5SdW50aW1lcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQnVpbHQtaW4gUnVudGltZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDdXN0b20gTGFuZ3VhZ2VzXCIpKTtcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb25cIiB9KTtcbiAgICBkZXRhaWxzLm9wZW4gPSBvcGVuO1xuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcbiAgICByZXR1cm4gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uLWJvZHlcIiB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyR2VuZXJhbFNldHRpbmdzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc2FibGVkIGJ5IGRlZmF1bHQuIGxvb20gcnVucyBjb2RlIG9uIHlvdXIgbG9jYWwgbWFjaGluZSBhbmQgZG9lcyBub3QgcHJvdmlkZSBzYW5kYm94aW5nLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB2YWx1ZTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiS2VlcCBsb29tIG5vdGVzIGluIHNvdXJjZSBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlByZXNlcnZlIHJhdyBmZW5jZWQgY29kZSBpbiB0aGUgZWRpdG9yIGluc3RlYWQgb2YgbGV0dGluZyBsaXZlIHByZXZpZXcgY29sbGFwc2UgcmVzZWFyY2ggc25pcHBldHMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlZmF1bHQgdGltZW91dFwiKVxuICAgICAgLnNldERlc2MoXCJNYXhpbXVtIGV4ZWN1dGlvbiB0aW1lIGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgbG9vbSB0ZXJtaW5hdGVzIHRoZSBwcm9jZXNzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCI4MDAwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBwYXJzZWQ7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV29ya2luZyBkaXJlY3RvcnlcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJWYXVsdCByb290XCIpLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxuICAgICAgLnNldERlc2MoXCJJbnNlcnQgbWFuYWdlZCBsb29tIG91dHB1dCBzZWN0aW9ucyBiZW5lYXRoIGNvZGUgYmxvY2tzIGluc3RlYWQgb2Yga2VlcGluZyByZXN1bHRzIHB1cmVseSBpbiB0aGUgVUkuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlZpc2libGUgb3V0cHV0IGxpbmVzXCIpXG4gICAgICAuc2V0RGVzYyhcIkxpbWl0IGVhY2ggc3Rkb3V0LCBzdGRlcnIsIGFuZCB3YXJuaW5nIHBhbmVsIHRvIHRoaXMgbWFueSB2aXNpYmxlIGxpbmVzLiBVc2UgMCBmb3IgdW5saW1pdGVkIG91dHB1dC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiMFwiKS5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm91dHB1dFZpc2libGVMaW5lcyA/PyAwKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLnRyaW0oKSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID49IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMgPSBNYXRoLm1pbihwYXJzZWQsIDIwMDApO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tcnVuIG9uIGZpbGUgb3BlblwiKVxuICAgICAgLnNldERlc2MoXCJSdW4gYWxsIHN1cHBvcnRlZCBibG9ja3MgaW4gdGhlIGFjdGl2ZSBub3RlIHdoZW4gaXQgb3BlbnMuIERpc2FibGVkIGJ5IGRlZmF1bHQuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3BlbiA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkV4dHJhY3RlZCBzb3VyY2UgcHJldmlld1wiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IGxvb20gc2hvd3MgdGhlIG1hdGVyaWFsaXplZCBzb3VyY2UgZm9yIGJsb2NrcyB0aGF0IHVzZSBsb29tLWZpbGUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2xsYXBzZWRcIiwgXCJDb2xsYXBzZWRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZXhwYW5kZWRcIiwgXCJFeHBhbmRlZFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJoaWRkZW5cIiwgXCJIaWRkZW5cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID0gdmFsdWUgYXMgXCJjb2xsYXBzZWRcIiB8IFwiZXhwYW5kZWRcIiB8IFwiaGlkZGVuXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlNob3cgY2FwYWJpbGl0eSBtZXRhZGF0YVwiKVxuICAgICAgLnNldERlc2MoXCJTaG93IHN5bWJvbCwgZGVwZW5kZW5jeSwgYW5kIGhhcm5lc3MgY2FwYWJpbGl0eSBtZXRhZGF0YSBpbiBleHRyYWN0ZWQgc291cmNlIHByZXZpZXcgaGVhZGVycy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlBERiBleHBvcnQgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29kZVwiLCBcIkNvZGUgQmxvY2sgT25seVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvdXRwdXRcIiwgXCJPdXRwdXQgT25seVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9IHZhbHVlIGFzIFwiYm90aFwiIHwgXCJjb2RlXCIgfCBcIm91dHB1dFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQnVpbHRJblJ1bnRpbWVzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcInB5dGhvblwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQeXRob24gZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBQeXRob24uXCIsIFwicHl0aG9uRXhlY3V0YWJsZVwiKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiamF2YXNjcmlwdFwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJOb2RlIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgSmF2YVNjcmlwdCBleGVjdXRpb24uXCIsIFwibm9kZUV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwidHlwZXNjcmlwdFwiKSkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVHlwZVNjcmlwdCBydW5uZXIgbW9kZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlVzZSB0cy1ub2RlIG9yIHRzeCBmb3IgVHlwZVNjcmlwdCBibG9ja3MuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cy1ub2RlXCIsIFwidHMtbm9kZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRzeFwiLCBcInRzeFwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID0gdmFsdWUgYXMgXCJ0cy1ub2RlXCIgfCBcInRzeFwiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJUeXBlU2NyaXB0IHRyYW5zcGlsZXIgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgdHMtbm9kZSBvciB0c3guXCIsIFwidHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcIm9jYW1sXCIpKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJPQ2FtbCBtb2RlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbGNcIiwgXCJvY2FtbGNcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkdW5lXCIsIFwiZHVuZVwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUgPSB2YWx1ZSBhcyBcIm9jYW1sXCIgfCBcIm9jYW1sY1wiIHwgXCJkdW5lXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk9DYW1sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIG9jYW1sLCBvY2FtbGMsIG9yIGR1bmUgZGVwZW5kaW5nIG9uIHRoZSBzZWxlY3RlZCBtb2RlLlwiLCBcIm9jYW1sRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY1wiXSwgXCJDIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQyBibG9ja3MuXCIsIFwiY0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNwcFwiXSwgXCJDKysgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDKysgYmxvY2tzLlwiLCBcImNwcEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInNoZWxsXCJdLCBcIlNoZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNoZWxsLCBCYXNoLCBhbmQgc2ggYmxvY2tzLlwiLCBcInNoZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicnVieVwiXSwgXCJSdWJ5IGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFJ1YnkgYmxvY2tzLlwiLCBcInJ1YnlFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJwZXJsXCJdLCBcIlBlcmwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUGVybCBibG9ja3MuXCIsIFwicGVybEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImx1YVwiXSwgXCJMdWEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgTHVhIGJsb2Nrcy5cIiwgXCJsdWFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJwaHBcIl0sIFwiUEhQIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBIUCBibG9ja3MuXCIsIFwicGhwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiZ29cIl0sIFwiR28gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgR28gYmxvY2tzLlwiLCBcImdvRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicnVzdFwiXSwgXCJSdXN0IGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgUnVzdCBibG9ja3MuXCIsIFwicnVzdEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImhhc2tlbGxcIl0sIFwiSGFza2VsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBIYXNrZWxsIGJsb2Nrcy4gRGVmYXVsdHMgdG8gcnVuZ2hjLlwiLCBcImhhc2tlbGxFeGVjdXRhYmxlXCIpO1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImphdmFcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIGNvbXBpbGVkIEphdmEgYmxvY2tzLlwiLCBcImphdmFFeGVjdXRhYmxlXCIpO1xuICAgIH1cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibGx2bS1pclwiXSwgXCJMTFZNIElSIGludGVycHJldGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIExMVk0gSVIgYmxvY2tzIHdpdGggbGxpLlwiLCBcImxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGVcIik7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiZWJwZi1jXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgY2xhbmcgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2xhbmcgd2l0aCBCUEYgdGFyZ2V0IHN1cHBvcnQuXCIsIFwiZWJwZkNsYW5nRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBicGZ0b29sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGJwZnRvb2wgdmVyaWZpZXIgYW5kIGxvYWQgb3BlcmF0aW9ucy5cIiwgXCJlYnBmQnBmdG9vbEV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgb2JqZWN0IGluc3BlY3RvclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgbGx2bS1vYmpkdW1wLiBMZWF2ZSBlbXB0eSB0byBza2lwIG9iamVjdCBzZWN0aW9uIGluc3BlY3Rpb24uXCIsIFwiZWJwZkxsdm1PYmpkdW1wRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBpbmNsdWRlIHBhdGhzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGluY2x1ZGUgZGlyZWN0b3JpZXMgcGFzc2VkIHRvIGNsYW5nIHdpdGggLUkuXCIsIFwiZWJwZkluY2x1ZGVQYXRoc1wiKTtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFsbG93IGVCUEYga2VybmVsIGxvYWRcIilcbiAgICAgICAgLnNldERlc2MoXCJSZXF1aXJlZCBiZWZvcmUgYW55IGJsb2NrIGNhbiB1c2UgbG9vbS1lYnBmLW1vZGU9bG9hZC4gQ29tcGlsZS1vbmx5IG1vZGUgc3RheXMgYXZhaWxhYmxlIHdpdGhvdXQgdGhpcy5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH1cbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiYnBmdHJhY2VcIl0sIFwiYnBmdHJhY2UgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgYnBmdHJhY2Ugc2NyaXB0cy5cIiwgXCJicGZ0cmFjZUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImxlYW5cIl0sIFwiTGVhbiBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBMZWFuIGJsb2Nrcy5cIiwgXCJsZWFuRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY29xXCJdLCBcIkNvcSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBDb3EgYmxvY2tzIHdpdGggY29xYy5cIiwgXCJjb3FFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJzbXRsaWJcIl0sIFwiU01UIHNvbHZlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU01ULUxJQiBibG9ja3MuIERlZmF1bHRzIHRvIHozLlwiLCBcInNtdEV4ZWN1dGFibGVcIik7XG4gIH1cblxuICBwcml2YXRlIGFkZFJ1bnRpbWVUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIGxhbmd1YWdlSWRzOiBzdHJpbmdbXSwgbmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IEspOiB2b2lkIHtcbiAgICBpZiAobGFuZ3VhZ2VJZHMuc29tZSgobGFuZ3VhZ2VJZCkgPT4gdGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZCkpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBuYW1lLCBkZXNjcmlwdGlvbiwga2V5KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaXNMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZCwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTGFuZ3VhZ2VQYWNrYWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24odGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcblxuICAgIGZvciAoY29uc3QgcGFjayBvZiBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUykge1xuICAgICAgY29uc3QgcGFja0VsID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtcGFja2FnZVwiIH0pO1xuICAgICAgcGFja0VsLm9wZW4gPSB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCk7XG4gICAgICBwYWNrRWwuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogcGFjay5kaXNwbGF5TmFtZSB9KTtcbiAgICAgIHBhY2tFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBwYWNrLmRlc2NyaXB0aW9uLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKHBhY2tFbClcbiAgICAgICAgLnNldE5hbWUoXCJFbmFibGUgcGFja2FnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRpc2FibGUgdGhpcyB0byByZW1vdmUgdGhlIHBhY2thZ2UgbGFuZ3VhZ2VzIGZyb20gcGFyc2luZywgY29tbWFuZCBtZW51cywgYW5kIHJ1bm5lcnMgZm9yIHRoaXMgdmF1bHQuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcywgcGFjay5pZCwgdmFsdWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBwYWNrYWdlRW5hYmxlZCA9IHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKTtcbiAgICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2YgcGFjay5sYW5ndWFnZXMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcocGFja0VsKVxuICAgICAgICAgIC5zZXROYW1lKGxhbmd1YWdlLmRpc3BsYXlOYW1lKVxuICAgICAgICAgIC5zZXREZXNjKGBBbGlhc2VzOiAke2xhbmd1YWdlLmFsaWFzZXMuam9pbihcIiwgXCIpfWApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZCghcGFja2FnZUVuYWJsZWQpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShwYWNrYWdlRW5hYmxlZCAmJiB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5pbmNsdWRlcyhsYW5ndWFnZS5pZCkpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkN1c3RvbSBsYW5ndWFnZXNcIilcbiAgICAgIC5zZXREZXNjKFwiRW5hYmxlIHVzZXItZGVmaW5lZCBsYW5ndWFnZXMgZnJvbSB0aGUgQ3VzdG9tIExhbmd1YWdlcyBzZWN0aW9uLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lEKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCwgdmFsdWUpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJlc2V0IGxhbmd1YWdlIHBhY2thZ2VzXCIpXG4gICAgICAuc2V0RGVzYyhcIlJlLWVuYWJsZSBldmVyeSBidWlsdC1pbiBwYWNrYWdlIGFuZCBldmVyeSBidWlsdC1pbiBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJSZXNldFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MgPSBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCk7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMgPSBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0RW5hYmxlZFZhbHVlKHZhbHVlczogc3RyaW5nW10sIGlkOiBzdHJpbmcsIGVuYWJsZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBjb25zdCBpbmRleCA9IHZhbHVlcy5pbmRleE9mKGlkKTtcbiAgICBpZiAoZW5hYmxlZCAmJiBpbmRleCA8IDApIHtcbiAgICAgIHZhbHVlcy5wdXNoKGlkKTtcbiAgICB9IGVsc2UgaWYgKCFlbmFibGVkICYmIGluZGV4ID49IDApIHtcbiAgICAgIHZhbHVlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1saXN0XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QobGlzdEVsKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBZGQgY3VzdG9tIGxhbmd1YWdlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBsb2NhbCBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBcImN1c3RvbS1sYW5ndWFnZVwiLFxuICAgICAgICAgICAgYWxpYXNlczogXCJcIixcbiAgICAgICAgICAgIGV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBhcmdzOiBcIntmaWxlfVwiLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi50eHRcIixcbiAgICAgICAgICAgIGV4dHJhY3Rvck1vZGU6IFwiY29tbWFuZFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yRXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGV4dHJhY3RvckFyZ3M6IFwie3JlcXVlc3R9XCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgdHJhbnNwaWxlQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBpZiAoIXRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIGN1c3RvbSBsYW5ndWFnZXMgY29uZmlndXJlZC5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5mb3JFYWNoKChsYW5ndWFnZSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2VcIiB9KTtcbiAgICAgIGRldGFpbHMub3BlbiA9IHRydWU7XG4gICAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGxhbmd1YWdlLm5hbWUgfHwgYEN1c3RvbSBsYW5ndWFnZSAke2luZGV4ICsgMX1gIH0pO1xuICAgICAgY29uc3QgYm9keSA9IGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWJvZHlcIiB9KTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIk5hbWVcIiwgXCJOb3JtYWxpemVkIGxhbmd1YWdlIGlkIHVzZWQgYnkgbG9vbS5cIiwgXCJuYW1lXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFsaWFzZXNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgZmVuY2UgYWxpYXNlcy5cIiwgXCJhbGlhc2VzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4ZWN1dGFibGVcIiwgXCJMb2NhbCBjb21tYW5kIG9yIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aC5cIiwgXCJleGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFyZ3VtZW50c1wiLCBcIlNwYWNlLXNlcGFyYXRlZCBhcmd1bWVudHMuIFVzZSB7ZmlsZX0gZm9yIHRoZSB0ZW1wIHNvdXJjZSBmaWxlLlwiLCBcImFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0ZW5zaW9uXCIsIFwiVGVtcCBzb3VyY2UgZmlsZSBleHRlbnNpb24sIGZvciBleGFtcGxlIC5weS5cIiwgXCJleHRlbnNpb25cIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiUGFydGlhbCBleHRyYWN0aW9uIHN0cmF0ZWd5XCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyB0aGlzIGN1c3RvbSBsYW5ndWFnZSBzdXBwb3J0cyBwYXJ0aWFsIHJ1bm5hYmxlIHNvdXJjZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImNvbW1hbmRcIiwgXCJFeHRyYWN0b3IgY29tbWFuZFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRyYW5zcGlsZS1jXCIsIFwiVHJhbnNwaWxlIHRvIENcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBsYW5ndWFnZS5leHRyYWN0b3JNb2RlID0gdmFsdWUgYXMgXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGV4ZWN1dGFibGVcIiwgXCJPcHRpb25hbCBjb21tYW5kIGZvciBwYXJ0aWFsIHNvdXJjZSBleHRyYWN0aW9uLiBMZWF2ZSBlbXB0eSB0byB1c2UgZ2VuZXJpYyBsaW5lIGFuZCBzeW1ib2wgZXh0cmFjdGlvbi5cIiwgXCJleHRyYWN0b3JFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dHJhY3RvciBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSBleHRyYWN0b3IuIFVzZSB7cmVxdWVzdH0sIHtzb3VyY2V9LCB7aGFybmVzc30sIHtzeW1ib2x9LCB7bGluZVN0YXJ0fSwge2xpbmVFbmR9LCB7ZGVwc30sIGFuZCB7bGFuZ3VhZ2V9LlwiLCBcImV4dHJhY3RvckFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiVHJhbnNwaWxlIHRvIEMgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgdGhhdCBlbWl0cyBnZW5lcmF0ZWQgQyBhbmQgYSBzeW1ib2wgbWFwIGFzIEpTT04uXCIsIFwidHJhbnNwaWxlRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSB0cmFuc3BpbGVyLiBVc2UgdGhlIHNhbWUgcGxhY2Vob2xkZXJzIGFzIGV4dHJhY3RvciBhcmd1bWVudHMuXCIsIFwidHJhbnNwaWxlQXJnc1wiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdmUgdGhpcyBjdXN0b20gbGFuZ3VhZ2UuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmxvb21QbHVnaW4uZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVGhlIGNvbnRhaW5lciBncm91cCB0byBydW4gY29kZSBibG9ja3MgaW4gYnkgZGVmYXVsdCBpZiB0aGUgbm90ZSBkb2VzIG5vdCBzcGVjaWZ5IG9uZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcIlwiLCBcIk5vbmVcIik7XG4gICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihncm91cC5uYW1lLCBncm91cC5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCB8fCBcIlwiKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFkZCBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwIGNvbmZpZ3VyYXRpb24gZm9sZGVyLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgbmV3IENvbnRhaW5lckdyb3VwTmFtZU1vZGFsKHRoaXMuYXBwLCBhc3luYyAoZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGNsZWFuTmFtZSA9IGdyb3VwTmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8tXS9nLCBcIi1cIik7XG4gICAgICAgICAgICAgIGlmICghY2xlYW5OYW1lKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgZ3JvdXAgbmFtZS5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgY29uc3QgZ3JvdXBSZWxhdGl2ZVBhdGggPSBgJHtwbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHtjbGVhbk5hbWV9YDtcbiAgICAgICAgICAgICAgY29uc3QgY29uZmlnUGF0aCA9IGAke2dyb3VwUmVsYXRpdmVQYXRofS9jb25maWcuanNvbmA7XG5cbiAgICAgICAgICAgICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgICAgICAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhncm91cFJlbGF0aXZlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGZvbGRlciBhbHJlYWR5IGV4aXN0cy5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci5ta2Rpcihncm91cFJlbGF0aXZlUGF0aCk7XG4gICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcnVudGltZTogXCJkb2NrZXJcIixcbiAgICAgICAgICAgICAgICBpbWFnZTogXCJ1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2VzOiB7XG4gICAgICAgICAgICAgICAgICBweXRob246IHtcbiAgICAgICAgICAgICAgICAgICAgY29tbWFuZDogXCJweXRob24zIHtmaWxlfVwiLFxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCJcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGVmYXVsdENvbmZpZywgbnVsbCwgMikpO1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKGBDb250YWluZXIgZ3JvdXAgXCIke2NsZWFuTmFtZX1cIiBjcmVhdGVkLmApO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY29udGFpbmVyLWdyb3VwLWxpc3RcIiB9KTtcbiAgICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xuICAgICAgICBsaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgICB0ZXh0OiBcIk5vIGNvbnRhaW5lciBncm91cHMgZm91bmQgaW4gLm9ic2lkaWFuL3BsdWdpbnMvbG9vbS9jb250YWluZXJzLlwiLFxuICAgICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxuICAgICAgICAgIC5zZXROYW1lKGdyb3VwLm5hbWUpXG4gICAgICAgICAgLnNldERlc2MoZ3JvdXAuc3RhdHVzKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQnVpbGQgLyByZWJ1aWxkXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uYnVpbGRDb250YWluZXJHcm91cChncm91cC5uYW1lKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkVkaXRcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIG5ldyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCh0aGlzLmxvb21QbHVnaW4sIGdyb3VwLm5hbWUsIHBsdWdpbkRpciwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYEVycm9yIGxvYWRpbmcgY29udGFpbmVyIGdyb3VwczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgY2xzOiBcImxvb20tc2V0dGluZ3MtZXJyb3JcIixcbiAgICAgICAgYXR0cjogeyBzdHlsZTogXCJjb2xvcjogdmFyKC0tdGV4dC1lcnJvcik7IGZvbnQtd2VpZ2h0OiBib2xkOyBtYXJnaW46IDFlbSAwO1wiIH1cbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5lcnJvcihcImxvb206IGZhaWxlZCB0byByZW5kZXIgY29udGFpbmVyIGdyb3VwczpcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gYXMgc3RyaW5nKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbUN1c3RvbUxhbmd1YWdlPihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICBrZXk6IEssXG4gICk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKGxhbmd1YWdlW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIChsYW5ndWFnZVtrZXldIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShcImxvb20gbG9jYWwgZXhlY3V0aW9uIGlzIGRpc2FibGVkLiBFbmFibGUgaXQgaW4gc2V0dGluZ3Mgb3IgY29uZmlybSB0aGUgZXhlY3V0aW9uIHdhcm5pbmcgZmlyc3QuXCIpO1xufVxuXG5jbGFzcyBDb250YWluZXJHcm91cE5hbWVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBuYW1lID0gXCJcIjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU3VibWl0OiAobmFtZTogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJOZXcgQ29udGFpbmVyIEdyb3VwIE5hbWVcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiR3JvdXAgTmFtZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgbG93ZXJjYXNlIGxldHRlcnMsIG51bWJlcnMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3Jlcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubmFtZSA9IHZhbHVlO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5vblN1Ym1pdCh0aGlzLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5jbGFzcyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBhY3RpdmVUYWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIiA9IFwiZ2VuZXJhbFwiO1xuICBwcml2YXRlIGNvbmZpZ09iajogYW55ID0ge307XG4gIHByaXZhdGUgcmF3SnNvblRleHQgPSBcIlwiO1xuICBwcml2YXRlIGRvY2tlcmZpbGVUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICBwcml2YXRlIHRhYkhlYWRlckVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgdGFiQ29udGVudEVsITogSFRNTEVsZW1lbnQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU2F2ZTogKCkgPT4gdm9pZFxuICApIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBgRWRpdCBDb25maWc6ICR7dGhpcy5ncm91cE5hbWV9YCB9KTtcblxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByYXdDb25maWcgPSBhd2FpdCBhZGFwdGVyLnJlYWQoY29uZmlnUGF0aCk7XG4gICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UocmF3Q29uZmlnKTtcbiAgICAgIHRoaXMucmF3SnNvblRleHQgPSByYXdDb25maWc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbmV3IE5vdGljZShcIkNvdWxkIG5vdCByZWFkIGNvbmZpZ3VyYXRpb24gZmlsZS5cIik7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhkb2NrZXJmaWxlUGF0aCkpIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IGF3YWl0IGFkYXB0ZXIucmVhZChkb2NrZXJmaWxlUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBjb250YWluZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBIZWFkZXJcbiAgICB0aGlzLnRhYkhlYWRlckVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1oZWFkZXJcIiB9KTtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcblxuICAgIC8vIFJlbmRlciBUYWIgQ29udGVudCBBcmVhXG4gICAgdGhpcy50YWJDb250ZW50RWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRlbnRcIiB9KTtcblxuICAgIC8vIFJlbmRlciBBY3Rpb25zIEZvb3RlclxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IHNhdmVCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJTYXZlXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG4gICAgc2F2ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlQW5kQ2xvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJUYWJzKCkge1xuICAgIHRoaXMudGFiSGVhZGVyRWwuZW1wdHkoKTtcbiAgICBjb25zdCB0YWJzOiBBcnJheTx7IGlkOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gICAgICB7IGlkOiBcImdlbmVyYWxcIiwgbGFiZWw6IFwiR2VuZXJhbFwiIH0sXG4gICAgICB7IGlkOiBcImxhbmd1YWdlc1wiLCBsYWJlbDogXCJMYW5ndWFnZXNcIiB9LFxuICAgICAgeyBpZDogXCJkb2NrZXJmaWxlXCIsIGxhYmVsOiBcIkRvY2tlcmZpbGVcIiB9LFxuICAgICAgeyBpZDogXCJyYXdcIiwgbGFiZWw6IFwiUmF3IEpTT05cIiB9LFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHRhYiBvZiB0YWJzKSB7XG4gICAgICBjb25zdCBidG4gPSB0aGlzLnRhYkhlYWRlckVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgICAgdGV4dDogdGFiLmxhYmVsLFxuICAgICAgICBjbHM6IFwibG9vbS10YWItYnRuXCIgKyAodGhpcy5hY3RpdmVUYWIgPT09IHRhYi5pZCA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIiksXG4gICAgICB9KTtcbiAgICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuc3dpdGNoVGFiKHRhYi5pZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzd2l0Y2hUYWIodGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIpIHtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzd2l0Y2hpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWN0aXZlVGFiID0gdGFiO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJBY3RpdmVUYWIoKSB7XG4gICAgdGhpcy50YWJDb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZ2VuZXJhbFwiKSB7XG4gICAgICB0aGlzLnJlbmRlckdlbmVyYWxUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwibGFuZ3VhZ2VzXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VzVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImRvY2tlcmZpbGVcIikge1xuICAgICAgdGhpcy5yZW5kZXJEb2NrZXJmaWxlVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0aGlzLnJlbmRlclJhd1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyR2VuZXJhbFRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICAvLyBSdW50aW1lIHNlbGVjdCBkcm9wZG93blxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJSdW50aW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB0aGUgY29udGFpbmVyL2Vudmlyb25tZW50IG1hbmFnZXIgcnVudGltZS5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZG9ja2VyXCIsIFwiRG9ja2VyXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInBvZG1hblwiLCBcIlBvZG1hblwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ3c2xcIiwgXCJXU0xcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicWVtdVwiLCBcIlFFTVVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY3VzdG9tXCIsIFwiQ3VzdG9tXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgfHwgXCJkb2NrZXJcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAvLyBDb25kaXRpb25hbCBpbWFnZS9kaXN0cm8gbmFtZVxuICAgIGlmIChcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICApIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiID8gXCJXU0wgRGlzdHJvXCIgOiBcIkJhc2UgSW1hZ2VcIilcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICAgICAgICAgPyBcIk9wdGlvbmFsLiBUaGUgdGFyZ2V0IFdTTCBkaXN0cm8gbmFtZSAobGVhdmUgZW1wdHkgZm9yIGRlZmF1bHQgZGlzdHJvKS5cIlxuICAgICAgICAgICAgOiBcIkZhbGxiYWNrIERvY2tlci9Qb2RtYW4gaW1hZ2UgaWYgbm8gRG9ja2VyZmlsZSBpcyBwcmVzZW50LlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouaW1hZ2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmltYWdlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai53c2wpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoud3NsID0ge307XG4gICAgICB9XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJVc2UgSW50ZXJhY3RpdmUgU2hlbGxcIilcbiAgICAgICAgLnNldERlc2MoXCJVc2UgaW50ZXJhY3RpdmUgbG9naW4gc2hlbGwgZmxhZ3MgKC1pIC1sKSB0byBlbnN1cmUgfi8uYmFzaHJjIGluaXRpYWxpemF0aW9uIHdvcmtzIChlLmcuLCBmb3IgTlZNKS5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID8/IGZhbHNlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID0gdmFsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIFFFTVUgU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoucWVtdSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11ID0geyBzc2hUYXJnZXQ6IFwiXCIsIHJlbW90ZVdvcmtzcGFjZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggVGFyZ2V0XCIpXG4gICAgICAgIC5zZXREZXNjKFwiU1NIIHRhcmdldCBhZGRyZXNzIChlLmcuIHVzZXJAaG9zdG5hbWUgb3IgbG9jYWxob3N0IC1wIDIyMjIpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJSZW1vdGUgV29ya3NwYWNlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3RlIGZvbGRlciBwYXRoIHRvIGNvcHkgY29kZSBzbmlwcGV0cyBhbmQgcnVuIGNvbW1hbmRzIChlLmcuLCAvaG9tZS91c2VyL3dvcmtzcGFjZSkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIFBhdGggdG8gU1NIIGNsaWVudCBleGVjdXRhYmxlIChkZWZhdWx0cyB0byBzc2gpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEFkZGl0aW9uYWwgU1NIIENMSSBmbGFncy5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBDdXN0b20gU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5jdXN0b20pIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tID0geyBleGVjdXRhYmxlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUGF0aCB0byBjdXN0b20gcnVudGltZSB3cmFwcGVyIGV4ZWN1dGFibGUgb3Igc2NyaXB0LlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIENvbW1hbmQgYXJndW1lbnRzLiBVc2Uge3JlcXVlc3R9IGZvciBKU09OIGNvbmZpZyBwYXRoLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJMYW5ndWFnZXNUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQ29uZmlndXJlZCBMYW5ndWFnZXNcIiB9KTtcblxuICAgIGlmICghdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzKSB7XG4gICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgPSB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5nc0xpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlcy1saXN0XCIgfSk7XG4gICAgY29uc3QgbGFuZ3VhZ2VzID0gT2JqZWN0LmVudHJpZXModGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHsgY29tbWFuZD86IHN0cmluZzsgZXh0ZW5zaW9uPzogc3RyaW5nOyB1c2VEZWZhdWx0PzogYm9vbGVhbiB9Pik7XG5cbiAgICBpZiAobGFuZ3VhZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbGFuZ3NMaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJObyBsYW5ndWFnZXMgY29uZmlndXJlZCBmb3IgdGhpcyBncm91cC5cIiwgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IFtsYW5nTmFtZSwgbGFuZ0NvbmZpZ10gb2YgbGFuZ3VhZ2VzKSB7XG4gICAgICAgIGNvbnN0IGNhcmQgPSBsYW5nc0xpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZS1jYXJkXCIgfSk7XG4gICAgICAgIGNhcmQuY3JlYXRlRWwoXCJzdHJvbmdcIiwgeyB0ZXh0OiBsYW5nTmFtZSwgYXR0cjogeyBzdHlsZTogXCJkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogMC41cmVtOyBmb250LXNpemU6IDEuMWVtO1wiIH0gfSk7XG5cbiAgICAgICAgY29uc3QgaXNEZWZhdWx0ID0gKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJVc2UgZGVmYXVsdCBjb25maWd1cmF0aW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJJZiBjaGVja2VkLCBMb29tIHdpbGwgcnVuIHRoaXMgbGFuZ3VhZ2UgdXNpbmcgaXRzIGJ1aWx0LWluIGNvbW1hbmRzL2V4dGVuc2lvbnMuXCIpXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodmFsKSB7XG4gICAgICAgICAgICAgICAgICAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuY29tbWFuZDtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmV4dGVuc2lvbjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdDtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSBkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSBkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJDb21tYW5kXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJFeGVjdXRpb24gY29tbWFuZC4gVXNlIHtmaWxlfSBmb3IgdGhlIGNvZGUgc25pcHBldCBmaWxlbmFtZS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiRXh0ZW5zaW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJTb3VyY2UgZmlsZSBleHRlbnNpb24gKGUuZy4gLnB5LCAuanMpLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgICBidG5cbiAgICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZW1vdmUgTGFuZ3VhZ2VcIilcbiAgICAgICAgICAgICAgLnNldFdhcm5pbmcoKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1tsYW5nTmFtZV07XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIExhbmd1YWdlIFNlY3Rpb25cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJBZGQgTGFuZ3VhZ2UgTWFwcGluZ1wiLCBhdHRyOiB7IHN0eWxlOiBcIm1hcmdpbi10b3A6IDEuNXJlbTtcIiB9IH0pO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJMYW5ndWFnZSBJRFwiKVxuICAgICAgLnNldERlc2MoXCJlLmcuIHB5dGhvbiwgamF2YXNjcmlwdCwgbm9kZSwgc2hcIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5uZXdMYW5ndWFnZU5hbWUpLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IHZhbC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiKyBBZGRcIikuc2V0Q3RhKCkub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLm5ld0xhbmd1YWdlTmFtZSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBlbnRlciBhIGxhbmd1YWdlIG5hbWUuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIkxhbmd1YWdlIGFscmVhZHkgY29uZmlndXJlZC5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0gPSB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX0ge2ZpbGV9YCxcbiAgICAgICAgICAgIGV4dGVuc2lvbjogYC4ke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfWAsXG4gICAgICAgICAgfTtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJlbmRlckRvY2tlcmZpbGVUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwiZG9ja2VyXCIgJiYgdGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJwb2RtYW5cIikge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYERvY2tlcmZpbGUgZWRpdGluZyBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgRG9ja2VyIGFuZCBQb2RtYW4gcnVudGltZXMuIEN1cnJlbnRseSB1c2luZzogJHt0aGlzLmNvbmZpZ09iai5ydW50aW1lfWAsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ID09PSBudWxsKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIERvY2tlcmZpbGUgZXhpc3RzIGluIHRoaXMgY29udGFpbmVyIGdyb3VwIGRpcmVjdG9yeS5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICBidG5cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlIERvY2tlcmZpbGVcIilcbiAgICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gW1xuICAgICAgICAgICAgICAgIFwiRlJPTSB1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgICBcIiMgSW5zdGFsbCBwYWNrYWdlc1wiLFxuICAgICAgICAgICAgICAgIFwiUlVOIGFwdC1nZXQgdXBkYXRlICYmIGFwdC1nZXQgaW5zdGFsbCAteSBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgcHl0aG9uMyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgbm9kZWpzIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICAmJiBybSAtcmYgL3Zhci9saWIvYXB0L2xpc3RzLypcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkRvY2tlcmZpbGUgQ29udGVudFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRlZmluZSB0aGUgYnVpbGQgc3RlcHMgZm9yIHlvdXIgZW52aXJvbm1lbnQgY29udGFpbmVyLlwiKVxuICAgICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMuZG9ja2VyZmlsZVRleHQgfHwgXCJcIik7XG4gICAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gdmFsO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJSYXdUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgdGhpcy5yYXdKc29uVGV4dCA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQ29uZmlndXJhdGlvbiBKU09OXCIpXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVBbmRDbG9zZSgpIHtcbiAgICAvLyBJZiB0aGUgYWN0aXZlIHRhYiBpcyByYXcgSlNPTiwgcGFyc2UgaXQgZmlyc3QgdG8gZW5zdXJlIHdlIGNhcHR1cmUgZWRpdHNcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzYXZpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQmFzaWMgVmFsaWRhdGlvblxuICAgIGlmICghdGhpcy5jb25maWdPYmoucnVudGltZSkge1xuICAgICAgbmV3IE5vdGljZShcIlJ1bnRpbWUgaXMgcmVxdWlyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIgJiYgKCF0aGlzLmNvbmZpZ09iai5xZW11Py5zc2hUYXJnZXQgfHwgIXRoaXMuY29uZmlnT2JqLnFlbXU/LnJlbW90ZVdvcmtzcGFjZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgU1NIIFRhcmdldCBhbmQgUmVtb3RlIFdvcmtzcGFjZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiICYmICF0aGlzLmNvbmZpZ09iai5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBDdXN0b20gRXhlY3V0YWJsZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNhdmUgY29uZmlnLmpzb25cbiAgICAgIGNvbnN0IGNvbmZpZ1N0ciA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgY29uZmlnU3RyKTtcblxuICAgICAgLy8gU2F2ZSBEb2NrZXJmaWxlXG4gICAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiKSB7XG4gICAgICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ICE9PSBudWxsKSB7XG4gICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShkb2NrZXJmaWxlUGF0aCwgdGhpcy5kb2NrZXJmaWxlVGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBjb25maWd1cmF0aW9ucyBzYXZlZC5cIik7XG4gICAgICB0aGlzLm9uU2F2ZSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBuZXcgTm90aWNlKGBTYXZlIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuICB9XG59XG4iLCAiaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB0eXBlIHsgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuXG5pbnRlcmZhY2UgU291cmNlUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNvdXJjZURlZmluaXRpb24gZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbmFtZXM/OiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkFsaWFzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBhc25hbWU6IHN0cmluZyB8IG51bGw7XG59XG5cbmludGVyZmFjZSBQeXRob25JbXBvcnQgZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIGtpbmQ6IFwiaW1wb3J0XCIgfCBcImZyb21cIjtcbiAgbW9kdWxlOiBzdHJpbmc7XG4gIGxldmVsOiBudW1iZXI7XG4gIG5hbWVzOiBQeXRob25BbGlhc1tdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uTW9kdWxlSW5mbyB7XG4gIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW107XG4gIGltcG9ydHM6IFB5dGhvbkltcG9ydFtdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uVXNhZ2Uge1xuICBuYW1lczogc3RyaW5nW107XG4gIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSB7XG4gIHJlYWRvbmx5IGluY2x1ZGVkUmFuZ2VzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgaW5jbHVkZWRJbXBvcnRzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgYWxpYXNlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IG5hbWVzcGFjZUJpbmRpbmdzOiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gIHJlYWRvbmx5IHZpc2l0aW5nU3ltYm9sczogU2V0PHN0cmluZz47XG4gIG5lZWRzTmFtZXNwYWNlUnVudGltZTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tU291cmNlRXh0cmFjdGlvbkhvc3Qge1xuICBweXRob25FeGVjdXRhYmxlPzogc3RyaW5nO1xuICBleHRlcm5hbEV4dHJhY3Rvcj86IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcjtcbiAgcmVhZEZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG4gIHJlc29sdmVQeXRob25JbXBvcnQoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yIHtcbiAgbW9kZTogXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gIGxhbmd1YWdlOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIGNvbnRlbnQ/OiBzdHJpbmc7XG4gIHNlbGVjdGVkPzogc3RyaW5nO1xuICBkZXBlbmRlbmNpZXM/OiBzdHJpbmdbXTtcbiAgaW1wb3J0cz86IHN0cmluZ1tdO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFRyYW5zcGlsZVRvQ1Jlc3VsdCB7XG4gIGdlbmVyYXRlZFNvdXJjZTogc3RyaW5nO1xuICBzeW1ib2xzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgaGFybmVzcz86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBcImNcIiB8IFwiY3BwXCI7XG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnRlbnQ6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0PzogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgaWYgKGhvc3Q/LmV4dGVybmFsRXh0cmFjdG9yPy5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgIHJldHVybiBob3N0LmV4dGVybmFsRXh0cmFjdG9yLm1vZGUgPT09IFwidHJhbnNwaWxlLWNcIlxuICAgICAgPyByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MsIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IpXG4gICAgICA6IHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKTtcbiAgfVxuXG4gIGlmIChsYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBob3N0KSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25SZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBoYXJuZXNzLCBob3N0KTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcyk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2soXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4pOiBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRTeW1ib2xSYW5nZShsaW5lcywgbGFuZ3VhZ2UsIHJlZmVyZW5jZS5zeW1ib2xOYW1lKVxuICAgIDogZmluZExpbmVSYW5nZShsaW5lcywgcmVmZXJlbmNlKTtcblxuICBpZiAoIXNlbGVjdGVkUmFuZ2UpIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IGBzeW1ib2wgJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gIDogXCJsaW5lIHJhbmdlXCI7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZXh0cmFjdCAke3RhcmdldH0gZnJvbSAke3JlZmVyZW5jZS5maWxlUGF0aH0uYCk7XG4gIH1cblxuICBjb25zdCBzZWxlY3RlZCA9IHJlbmRlclJhbmdlKGxpbmVzLCBzZWxlY3RlZFJhbmdlKTtcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzXG4gICAgPyBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkKVxuICAgIDogXCJcIjtcbiAgY29uc3QgY29udGVudCA9IFtkZXBlbmRlbmNpZXMsIHNlbGVjdGVkLCBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udGVudCxcbiAgICBkZXNjcmlwdGlvbjogZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBzZWxlY3RlZFJhbmdlKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUV4dGVybmFsUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBjb250ZW50ID0gcmVzdWx0LmNvbnRlbnQgPz8gW1xuICAgICAgLi4uKHJlc3VsdC5pbXBvcnRzID8/IFtdKSxcbiAgICAgIC4uLihyZXN1bHQuZGVwZW5kZW5jaWVzID8/IFtdKSxcbiAgICAgIHJlc3VsdC5zZWxlY3RlZCA/PyBcIlwiLFxuICAgICAgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIixcbiAgICBdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICBpZiAoIWNvbnRlbnQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBubyBjb250ZW50LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIG51bGwpLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVUcmFuc3BpbGVUb0NSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3Rvcixcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1leHRyYWN0LVwiKSk7XG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBqb2luKHRlbXBEaXIsIFwic291cmNlLnR4dFwiKTtcbiAgY29uc3QgaGFybmVzc0ZpbGUgPSBqb2luKHRlbXBEaXIsIFwiaGFybmVzcy50eHRcIik7XG4gIGNvbnN0IHJlcXVlc3RGaWxlID0gam9pbih0ZW1wRGlyLCBcInJlcXVlc3QuanNvblwiKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiByZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiByZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiByZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHRhcmdldExhbmd1YWdlOiBcImNcIixcbiAgICB9O1xuICAgIGF3YWl0IHdyaXRlRmlsZShzb3VyY2VGaWxlLCBzb3VyY2UsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoaGFybmVzc0ZpbGUsIGhhcm5lc3MsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdEZpbGUsIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpLCBcInV0ZjhcIik7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5FeHRlcm5hbEV4dHJhY3RvcihleHRyYWN0b3IsIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgcmVxdWVzdEZpbGUsXG4gICAgICByZWZlcmVuY2UsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBnZW5lcmF0ZWRMYW5ndWFnZSA9IHJlc3VsdC5sYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIjtcbiAgICBjb25zdCBtYXBwZWRTeW1ib2wgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IHJlc3VsdC5zeW1ib2xzPy5bcmVmZXJlbmNlLnN5bWJvbE5hbWVdID8/IHJlZmVyZW5jZS5zeW1ib2xOYW1lIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGdlbmVyYXRlZFJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSA9IHtcbiAgICAgIC4uLnJlZmVyZW5jZSxcbiAgICAgIGZpbGVQYXRoOiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9OmdlbmVyYXRlZC4ke2dlbmVyYXRlZExhbmd1YWdlID09PSBcImNwcFwiID8gXCJjcHBcIiA6IFwiY1wifWAsXG4gICAgICBzeW1ib2xOYW1lOiBtYXBwZWRTeW1ib2wsXG4gICAgfTtcbiAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2socmVzdWx0LmdlbmVyYXRlZFNvdXJjZSwgZ2VuZXJhdGVkUmVmZXJlbmNlLCBnZW5lcmF0ZWRMYW5ndWFnZSwgcmVzdWx0Lmhhcm5lc3MgPz8gaGFybmVzcyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJnZW5lcmF0ZWQtY1wifWAsXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuRXh0ZXJuYWxFeHRyYWN0b3IoXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuICB2YWx1ZXM6IHtcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIHNvdXJjZUZpbGU6IHN0cmluZztcbiAgICBoYXJuZXNzRmlsZTogc3RyaW5nO1xuICAgIHJlcXVlc3RGaWxlOiBzdHJpbmc7XG4gICAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlO1xuICB9LFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYXJncyA9IGV4dHJhY3Rvci5hcmdzLm1hcCgoYXJnKSA9PiBhcmdcbiAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCB2YWx1ZXMucmVxdWVzdEZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c291cmNlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntmaWxlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntoYXJuZXNzfVwiLCB2YWx1ZXMuaGFybmVzc0ZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c3ltYm9sfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJcIilcbiAgICAucmVwbGFjZUFsbChcIntsaW5lU3RhcnR9XCIsIHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0KSlcbiAgICAucmVwbGFjZUFsbChcIntsaW5lRW5kfVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kKSlcbiAgICAucmVwbGFjZUFsbChcIntkZXBzfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzID8gXCJ0cnVlXCIgOiBcImZhbHNlXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGFuZ3VhZ2V9XCIsIHZhbHVlcy5sYW5ndWFnZSkpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleHRyYWN0b3IuZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgY3dkOiBleHRyYWN0b3Iud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0sXG4gICAgfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciB0aW1lZCBvdXQgYWZ0ZXIgJHtleHRyYWN0b3IudGltZW91dE1zfSBtcy5gKSk7XG4gICAgfSwgZXh0cmFjdG9yLnRpbWVvdXRNcyk7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKChzdGRlcnIgfHwgc3Rkb3V0IHx8IGBDdXN0b20gc291cmNlIGV4dHJhY3RvciBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0uYCkudHJpbSgpKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJlc29sdmUoc3Rkb3V0KTtcbiAgICB9KTtcblxuICAgIGNoaWxkLnN0ZGluLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICByZXF1ZXN0RmlsZTogdmFsdWVzLnJlcXVlc3RGaWxlLFxuICAgICAgc291cmNlRmlsZTogdmFsdWVzLnNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZTogdmFsdWVzLmhhcm5lc3NGaWxlLFxuICAgICAgbGFuZ3VhZ2U6IHZhbHVlcy5sYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiB2YWx1ZXMucmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShvdXRwdXQpIGFzIEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciBtdXN0IHJldHVybiBhIEpTT04gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBUcmFuc3BpbGVUb0NSZXN1bHQ7XG4gICAgaWYgKHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgcGFyc2VkID09IG51bGwgfHwgdHlwZW9mIHBhcnNlZC5nZW5lcmF0ZWRTb3VyY2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGV4dHJhY3RvciBtdXN0IHJldHVybiBnZW5lcmF0ZWRTb3VyY2UuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLmxhbmd1YWdlICE9IG51bGwgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNcIiAmJiBwYXJzZWQubGFuZ3VhZ2UgIT09IFwiY3BwXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGxhbmd1YWdlIG11c3QgYmUgYyBvciBjcHAuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLnN5bWJvbHMgIT0gbnVsbCAmJiAodHlwZW9mIHBhcnNlZC5zeW1ib2xzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGFyc2VkLnN5bWJvbHMpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgc3ltYm9scyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgcmV0dXJuZWQgaW52YWxpZCBKU09OOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IHN0YXRlID0gY3JlYXRlUHl0aG9uRGVwZW5kZW5jeVN0YXRlKCk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UuZmlsZVBhdGgsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkLCBoYXJuZXNzLCBob3N0LCBzdGF0ZSlcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpOiBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZXR1cm4ge1xuICAgIGluY2x1ZGVkUmFuZ2VzOiBuZXcgU2V0KCksXG4gICAgaW5jbHVkZWRJbXBvcnRzOiBuZXcgU2V0KCksXG4gICAgYWxpYXNlczogbmV3IFNldCgpLFxuICAgIG5hbWVzcGFjZUJpbmRpbmdzOiBuZXcgTWFwKCksXG4gICAgdmlzaXRpbmdTeW1ib2xzOiBuZXcgU2V0KCksXG4gICAgbmVlZHNOYW1lc3BhY2VSdW50aW1lOiBmYWxzZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VsZWN0ZWQ6IHN0cmluZyxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBgJHtzZWxlY3RlZH1cXG4ke2hhcm5lc3N9YCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgY29uc3QgbmFtZXNwYWNlID0gcmVuZGVyUHl0aG9uTmFtZXNwYWNlQmluZGluZ3Moc3RhdGUpO1xuICByZXR1cm4gWy4uLnN0YXRlLmluY2x1ZGVkSW1wb3J0cywgLi4ucGFydHMsIG5hbWVzcGFjZV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhcbiAgc291cmNlOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzZWVkOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgbGV0IGhheXN0YWNrID0gc2VlZDtcbiAgbGV0IGNvbGxlY3RlZCA9IFwiXCI7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBjb25zdCB1c2FnZSA9IGF3YWl0IGluc3BlY3RQeXRob25Vc2FnZShoYXlzdGFjaywgaG9zdCk7XG5cbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgaWYgKHJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkgfHwgIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGV4dCA9IGFkZFB5dGhvblJhbmdlKGxpbmVzLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgdGV4dCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBpZiAobmVzdGVkKSB7XG4gICAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7bmVzdGVkfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29sbGVjdGVkICs9IGAke25lc3RlZH1cXG4ke3RleHR9XFxuYDtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBpbXBvcnROb2RlIG9mIG1vZHVsZUluZm8uaW1wb3J0cykge1xuICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBoYXlzdGFjayArPSBgXFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjb2xsZWN0ZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmIChpbXBvcnROb2RlLmtpbmQgPT09IFwiZnJvbVwiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICB9XG5cbiAgcmV0dXJuIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvbkZyb21JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgaW1wb3J0Tm9kZS5tb2R1bGUsIGltcG9ydE5vZGUubGV2ZWwpO1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGlmIChhbGlhcy5uYW1lID09PSBcIipcIikge1xuICAgICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgICAgaWYgKHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZSkgJiYgYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUobG9jYWxNb2R1bGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBtb2R1bGVJbmZvLmRlZmluaXRpb25zKSB7XG4gICAgICAgIGlmICghcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uLCB1c2FnZSkpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBkZWZpbml0aW9uLm5hbWUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHBvc2VkTmFtZSA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lO1xuICAgIGlmICghdXNhZ2UubmFtZXMuaW5jbHVkZXMoZXhwb3NlZE5hbWUpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJtb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBqb2luUHl0aG9uTW9kdWxlKGltcG9ydE5vZGUubW9kdWxlLCBhbGlhcy5uYW1lKSwgaW1wb3J0Tm9kZS5sZXZlbCk7XG4gICAgY29uc3QgaW1wb3J0VGFyZ2V0UGF0aCA9IGxvY2FsTW9kdWxlUGF0aCA/PyBzdWJtb2R1bGVQYXRoO1xuICAgIGlmICghaW1wb3J0VGFyZ2V0UGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RlZCA9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShpbXBvcnRUYXJnZXRQYXRoLCBhbGlhcy5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgIGFkZGVkICs9IGV4dHJhY3RlZDtcbiAgICAgIGlmIChhbGlhcy5hc25hbWUgJiYgYWxpYXMuYXNuYW1lICE9PSBhbGlhcy5uYW1lKSB7XG4gICAgICAgIGFkZGVkICs9IGFkZFB5dGhvbkFsaWFzKGFsaWFzLm5hbWUsIGFsaWFzLmFzbmFtZSwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZHVsZUJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBjb25zdCBtb2R1bGVBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1ttb2R1bGVCaW5kaW5nXSA/PyBbXTtcbiAgICBpZiAoc3VibW9kdWxlUGF0aCAmJiBtb2R1bGVBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgbW9kdWxlQXR0cmlidXRlcykge1xuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoc3VibW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKG1vZHVsZUJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblBsYWluSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGNvbnN0IGJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZS5zcGxpdChcIi5cIilbMF07XG4gICAgY29uc3QgdXNlZEF0dHJpYnV0ZXMgPSB1c2FnZS5hdHRyaWJ1dGVzW2JpbmRpbmddID8/IFtdO1xuICAgIGNvbnN0IGJpbmRpbmdJc1VzZWQgPSB1c2FnZS5uYW1lcy5pbmNsdWRlcyhiaW5kaW5nKSB8fCB1c2VkQXR0cmlidXRlcy5sZW5ndGggPiAwO1xuICAgIGlmICghYmluZGluZ0lzVXNlZCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxNb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBhbGlhcy5uYW1lLCAwKTtcbiAgICBpZiAoIWxvY2FsTW9kdWxlUGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIHVzZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBhdHRyaWJ1dGUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzeW1ib2xOYW1lOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgdmlzaXRLZXkgPSBgJHtmaWxlUGF0aH0jJHtzeW1ib2xOYW1lfWA7XG4gIGlmIChzdGF0ZS52aXNpdGluZ1N5bWJvbHMuaGFzKHZpc2l0S2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgY29uc3Qgc291cmNlID0gYXdhaXQgaG9zdC5yZWFkRmlsZShmaWxlUGF0aCk7XG4gIGlmICghc291cmNlKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBzdGF0ZS52aXNpdGluZ1N5bWJvbHMuYWRkKHZpc2l0S2V5KTtcbiAgdHJ5IHtcbiAgICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoY2FuZGlkYXRlKSA9PiAoY2FuZGlkYXRlLm5hbWVzID8/IFtjYW5kaWRhdGUubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgICBpZiAoIWRlZmluaXRpb24pIHtcbiAgICAgIHJldHVybiBcIlwiO1xuICAgIH1cblxuICAgIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbik7XG4gICAgY29uc3QgZGVwZW5kZW5jeVRleHQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgY29uc3QgYWRkZWQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgcmV0dXJuIFtkZXBlbmRlbmN5VGV4dCwgYWRkZWRdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cIik7XG4gIH0gZmluYWxseSB7XG4gICAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmRlbGV0ZSh2aXNpdEtleSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uUmFuZ2UoXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHtmaWxlUGF0aH06TCR7cmFuZ2Uuc3RhcnQgKyAxfS1MJHtyYW5nZS5lbmQgKyAxfWA7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZFJhbmdlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkUmFuZ2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIHJhbmdlKTtcbiAgcGFydHMucHVzaCh0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXM6IHN0cmluZ1tdLCByYW5nZTogU291cmNlUmFuZ2UsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBib29sZWFuIHtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZEltcG9ydHMuaGFzKHRleHQpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkSW1wb3J0cy5hZGQodGV4dCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25BbGlhcyhuYW1lOiBzdHJpbmcsIGFzbmFtZTogc3RyaW5nLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLCBwYXJ0czogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHthc25hbWV9PSR7bmFtZX1gO1xuICBpZiAoc3RhdGUuYWxpYXNlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmFsaWFzZXMuYWRkKGtleSk7XG4gIGNvbnN0IHRleHQgPSBgJHthc25hbWV9ID0gJHtuYW1lfWA7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiBgJHt0ZXh0fVxcbmA7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcoYmluZGluZzogc3RyaW5nLCBhdHRyaWJ1dGU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IHZvaWQge1xuICBzdGF0ZS5uZWVkc05hbWVzcGFjZVJ1bnRpbWUgPSB0cnVlO1xuICBjb25zdCBhdHRyaWJ1dGVzID0gc3RhdGUubmFtZXNwYWNlQmluZGluZ3MuZ2V0KGJpbmRpbmcpID8/IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBhdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGUpO1xuICBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zZXQoYmluZGluZywgYXR0cmlidXRlcyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBzdHJpbmcge1xuICBpZiAoIXN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLnNpemUpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID8gW1wiaW1wb3J0IHR5cGVzIGFzIF9sb29tX3R5cGVzXCJdIDogW107XG4gIGZvciAoY29uc3QgW2JpbmRpbmcsIGF0dHJpYnV0ZXNdIG9mIHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzKSB7XG4gICAgbGluZXMucHVzaChgJHtiaW5kaW5nfSA9IF9sb29tX3R5cGVzLlNpbXBsZU5hbWVzcGFjZSgpYCk7XG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgbGluZXMucHVzaChgJHtiaW5kaW5nfS4ke2F0dHJpYnV0ZX0gPSAke2F0dHJpYnV0ZX1gKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvOiBQeXRob25Nb2R1bGVJbmZvLCBzeW1ib2xOYW1lOiBzdHJpbmcpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBleGFjdCA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgcmV0dXJuIGV4YWN0ID8geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb246IFNvdXJjZURlZmluaXRpb24sIHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLnNvbWUoKG5hbWUpID0+IHVzYWdlLm5hbWVzLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuZnVuY3Rpb24gdXNlc1Vua25vd25JbXBvcnRlZE5hbWVzKHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gdXNhZ2UubmFtZXMubGVuZ3RoID4gMDtcbn1cblxuZnVuY3Rpb24gam9pblB5dGhvbk1vZHVsZShtb2R1bGVOYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBtb2R1bGVOYW1lID8gYCR7bW9kdWxlTmFtZX0uJHtuYW1lfWAgOiBuYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvbk1vZHVsZUluZm8+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Nb2R1bGVJbmZvPihzb3VyY2UsIFwibW9kdWxlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uVXNhZ2Uoc291cmNlOiBzdHJpbmcsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8UHl0aG9uVXNhZ2U+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Vc2FnZT4oc291cmNlLCBcInVzYWdlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBydW5QeXRob25Bc3Q8VD4oc291cmNlOiBzdHJpbmcsIG1vZGU6IFwibW9kdWxlXCIgfCBcInVzYWdlXCIsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8VD4ge1xuICBjb25zdCBjb21tYW5kID0gc3BsaXRDb21tYW5kTGluZShob3N0LnB5dGhvbkV4ZWN1dGFibGU/LnRyaW0oKSB8fCBcInB5dGhvbjNcIik7XG4gIGNvbnN0IGV4ZWN1dGFibGUgPSBjb21tYW5kWzBdID8/IFwicHl0aG9uM1wiO1xuICBjb25zdCBhcmdzID0gWy4uLmNvbW1hbmQuc2xpY2UoMSksIFwiLWNcIiwgUFlUSE9OX0FTVF9IRUxQRVJdO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7IHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0gfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgUHl0aG9uIEFTVCBoZWxwZXIgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXNvbHZlKEpTT04ucGFyc2Uoc3Rkb3V0KSBhcyBUKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoeyBtb2RlLCBzb3VyY2UgfSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZmluZExpbmVSYW5nZShsaW5lczogc3RyaW5nW10sIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoKHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gMSkgLSAxLCAwKTtcbiAgY29uc3QgZW5kID0gTWF0aC5taW4oKHJlZmVyZW5jZS5saW5lRW5kID8/IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbGluZXMubGVuZ3RoKSAtIDEsIGxpbmVzLmxlbmd0aCAtIDEpO1xuICBpZiAoc3RhcnQgPiBlbmQgfHwgc3RhcnQgPj0gbGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBmaW5kU3ltYm9sUmFuZ2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKTtcbiAgY29uc3QgZXhhY3QgPSBkZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICBpZiAoZXhhY3QpIHtcbiAgICByZXR1cm4geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH07XG4gIH1cblxuICBjb25zdCBzeW1ib2xQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KHN5bWJvbE5hbWUpfVxcXFxiYCk7XG4gIGNvbnN0IGxpbmUgPSBsaW5lcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gc3ltYm9sUGF0dGVybi50ZXN0KGNhbmRpZGF0ZSkpO1xuICBpZiAobGluZSA8IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gbGluZXNbbGluZV0uaW5jbHVkZXMoXCJ7XCIpID8geyBzdGFydDogbGluZSwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgbGluZSkgfSA6IHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSwgc2VsZWN0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHByb2xvZ3VlID0gY29sbGVjdFByb2xvZ3VlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZS5zdGFydCk7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSlcbiAgICAuZmlsdGVyKChkZWZpbml0aW9uKSA9PiAhcmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSk7XG4gIGNvbnN0IHNlbGVjdGVkRGVmaW5pdGlvbnMgPSB0cmFjZURlZmluaXRpb25zKHNlbGVjdGVkLCBkZWZpbml0aW9ucywgbGluZXMpO1xuICByZXR1cm4gWy4uLnByb2xvZ3VlLCAuLi5zZWxlY3RlZERlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pKV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuZnVuY3Rpb24gdHJhY2VEZWZpbml0aW9ucyhzZWVkOiBzdHJpbmcsIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10sIGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IHNlbGVjdGVkOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgY29uc3Qgc2VsZWN0ZWRLZXlzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgZGVmaW5pdGlvbnMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke2RlZmluaXRpb24uc3RhcnR9OiR7ZGVmaW5pdGlvbi5lbmR9OiR7ZGVmaW5pdGlvbi5uYW1lfWA7XG4gICAgICBpZiAoc2VsZWN0ZWRLZXlzLmhhcyhrZXkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuc29tZSgobmFtZSkgPT4gc291cmNlVXNlc05hbWUoaGF5c3RhY2ssIG5hbWUpKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkS2V5cy5hZGQoa2V5KTtcbiAgICAgIHNlbGVjdGVkLnB1c2goZGVmaW5pdGlvbik7XG4gICAgICBoYXlzdGFjayArPSBgXFxuJHtyZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbil9XFxuYDtcbiAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzZWxlY3RlZC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zdGFydCAtIHJpZ2h0LnN0YXJ0KTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdFByb2xvZ3VlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGJlZm9yZUxpbmU6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgY29uc3QgcHJvbG9ndWU6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KGJlZm9yZUxpbmUsIDApO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbWF4OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAoaXNQcm9sb2d1ZUxpbmUobGluZSwgbGFuZ3VhZ2UpKSB7XG4gICAgICBwcm9sb2d1ZS5wdXNoKGxpbmUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcHJvbG9ndWUubGVuZ3RoID8gW3Byb2xvZ3VlLmpvaW4oXCJcXG5cIildIDogW107XG59XG5cbmZ1bmN0aW9uIGlzUHJvbG9ndWVMaW5lKGxpbmU6IHN0cmluZywgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBib29sZWFuIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiAvXihmcm9tXFxzK1xcUytcXHMraW1wb3J0XFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gL14oaW1wb3J0XFxzK3xleHBvcnRcXHMrLipcXHMrZnJvbVxccyt8KD86Y29uc3R8bGV0fHZhcilcXHMrXFx3K1xccyo9XFxzKnJlcXVpcmVcXHMqXFwoKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgIGNhc2UgXCJjcHBcIjpcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwidGFyZ2V0IFwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCJzb3VyY2VfZmlsZW5hbWVcIik7XG4gICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIHJldHVybiAvXihtb2R1bGVcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIC9eKG9wZW5cXHMrfGluY2x1ZGVcXHMrfCN1c2VcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIC9eKHBhY2thZ2VcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29sbGVjdERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXig/OmV4cG9ydFxccyspPyg/OmFzeW5jXFxzKyk/ZnVuY3Rpb25cXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/Y2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/KD86Y29uc3R8bGV0fHZhcilcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccyo9Lyk7XG4gICAgY2FzZSBcImNcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCBmYWxzZSk7XG4gICAgY2FzZSBcImNwcFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXMsIHRydWUpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8YWJzdHJhY3R8XFxzKSpcXHMqKD86Y2xhc3N8aW50ZXJmYWNlfGVudW18cmVjb3JkKVxccysoW0EtWmEtel9dXFx3KilcXGJ8XlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfHN5bmNocm9uaXplZHxuYXRpdmV8XFxzKStbXFx3PD5cXFtcXF0sLj9dK1xccysoW0EtWmEtel9dXFx3KilcXHMqXFwoW147XSpcXClcXHMqXFx7Lyk7XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBhc3NpZ25tZW50ID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFtBLVphLXpfXVxcdyopXFxzKls6PV0vKTtcbiAgICBpZiAoYXNzaWdubWVudCkge1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IGFzc2lnbm1lbnRbMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFxccyopKD86YXN5bmNcXHMrKT8oPzpkZWZ8Y2xhc3MpXFxzKyhbQS1aYS16X11cXHcqKVxcYi8pO1xuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmRlbnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gICAgbGV0IHN0YXJ0ID0gaW5kZXg7XG4gICAgd2hpbGUgKHN0YXJ0ID4gMCAmJiBsaW5lc1tzdGFydCAtIDFdLnRyaW0oKS5zdGFydHNXaXRoKFwiQFwiKSAmJiBnZXRJbmRlbnQobGluZXNbc3RhcnQgLSAxXSkgPT09IGluZGVudCkge1xuICAgICAgc3RhcnQgLT0gMTtcbiAgICB9XG4gICAgbGV0IGVuZCA9IGluZGV4O1xuICAgIGZvciAobGV0IGN1cnNvciA9IGluZGV4ICsgMTsgY3Vyc29yIDwgbGluZXMubGVuZ3RoOyBjdXJzb3IgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2N1cnNvcl0udHJpbSgpICYmIGdldEluZGVudChsaW5lc1tjdXJzb3JdKSA8PSBpbmRlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBlbmQgPSBjdXJzb3I7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBtYXRjaFsyXSwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgbGV0IGRlcHRoID0gMDtcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgY29uc3QgdG9wTGV2ZWwgPSBkZXB0aCA9PT0gMDtcblxuICAgIGlmICh0b3BMZXZlbCAmJiB0cmltbWVkKSB7XG4gICAgICBjb25zdCBtYWNybyA9IHRyaW1tZWQubWF0Y2goL14jXFxzKmRlZmluZVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICAgIGlmIChtYWNybykge1xuICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWFjcm9bMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIH0gZWxzZSBpZiAoIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIWlzQ0NvbW1lbnRMaW5lKHRyaW1tZWQpKSB7XG4gICAgICAgIGNvbnN0IHR5cGVEZWZpbml0aW9uID0gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXMsIGluZGV4LCBpc0NwcCk7XG4gICAgICAgIGlmICh0eXBlRGVmaW5pdGlvbikge1xuICAgICAgICAgIGRlZmluaXRpb25zLnB1c2godHlwZURlZmluaXRpb24pO1xuICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIHR5cGVEZWZpbml0aW9uLmVuZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25EZWZpbml0aW9uID0gbWF0Y2hDRnVuY3Rpb25EZWZpbml0aW9uKGxpbmVzLCBpbmRleCk7XG4gICAgICAgICAgaWYgKGZ1bmN0aW9uRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgZGVmaW5pdGlvbnMucHVzaChmdW5jdGlvbkRlZmluaXRpb24pO1xuICAgICAgICAgICAgaW5kZXggPSBNYXRoLm1heChpbmRleCwgZnVuY3Rpb25EZWZpbml0aW9uLmVuZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGdsb2JhbERlZmluaXRpb24gPSBtYXRjaENHbG9iYWxEZWZpbml0aW9uKGxpbmUsIGluZGV4KTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxEZWZpbml0aW9uKSB7XG4gICAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZ2xvYmFsRGVmaW5pdGlvbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVwdGggKz0gYnJhY2VEZWx0YShsaW5lKTtcbiAgICBpZiAoZGVwdGggPCAwKSB7XG4gICAgICBkZXB0aCA9IDA7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBtYXRjaENUeXBlRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzQ3BwOiBib29sZWFuKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXIgPSBsaW5lcy5zbGljZShzdGFydCwgTWF0aC5taW4obGluZXMubGVuZ3RoLCBzdGFydCArIDgpKS5qb2luKFwiIFwiKTtcbiAgY29uc3Qga2V5d29yZFBhdHRlcm4gPSBpc0NwcCA/IFwiKD86dHlwZWRlZlxcXFxzKyk/KD86c3RydWN0fGNsYXNzfGVudW18dW5pb24pXCIgOiBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxlbnVtfHVuaW9uKVwiO1xuICBjb25zdCBuYW1lZCA9IGhlYWRlci5tYXRjaChuZXcgUmVnRXhwKGBeXFxcXHMqJHtrZXl3b3JkUGF0dGVybn1cXFxccysoW0EtWmEtel9dXFxcXHcqKVxcXFxiYCkpO1xuICBjb25zdCBhbm9ueW1vdXNUeXBlZGVmID0gaGVhZGVyLm1hdGNoKC9eXFxzKnR5cGVkZWZcXHMrKD86c3RydWN0fGVudW18dW5pb24pXFxiW1xcc1xcU10qP1xcfVxccyooW0EtWmEtel9dXFx3KilcXHMqOy8pO1xuICBjb25zdCBuYW1lID0gbmFtZWQ/LlsxXSA/PyBhbm9ueW1vdXNUeXBlZGVmPy5bMV07XG4gIGlmICghbmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgZW5kID0gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lcywgc3RhcnQpO1xuICByZXR1cm4geyBuYW1lLCBuYW1lczogW25hbWVdLCBzdGFydCwgZW5kIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IGhlYWRlckxpbmVzID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyAxMikpO1xuICBjb25zdCBqb2luZWQgPSBoZWFkZXJMaW5lcy5qb2luKFwiIFwiKTtcbiAgY29uc3QgYnJhY2VPZmZzZXQgPSBoZWFkZXJMaW5lcy5maW5kSW5kZXgoKGxpbmUpID0+IGxpbmUuaW5jbHVkZXMoXCJ7XCIpKTtcbiAgaWYgKGJyYWNlT2Zmc2V0IDwgMCB8fCBqb2luZWQuaW5kZXhPZihcIjtcIikgPj0gMCAmJiBqb2luZWQuaW5kZXhPZihcIjtcIikgPCBqb2luZWQuaW5kZXhPZihcIntcIikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSBbLi4uam9pbmVkLm1hdGNoQWxsKC8oW0EtWmEtel9dXFx3Kig/Ojo6W0EtWmEtel9dXFx3Kik/fG9wZXJhdG9yXFxzKlteXFxzKF0rKVxccypcXChbXjt7fV0qXFwpXFxzKig/OmNvbnN0XFxiW157fV0qKT8oPzpub2V4Y2VwdFxcYltee31dKik/KD86LT5cXHMqW157fV0rKT9cXHsvZyldO1xuICBjb25zdCBuYW1lID0gbWF0Y2hlc1swXT8uWzFdPy5yZXBsYWNlKC9cXHMrL2csIFwiXCIpO1xuICBpZiAoIW5hbWUgfHwgaXNDQ29udHJvbEtleXdvcmQobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGJyYWNlTGluZSA9IHN0YXJ0ICsgYnJhY2VPZmZzZXQ7XG4gIGNvbnN0IHNob3J0TmFtZSA9IG5hbWUuaW5jbHVkZXMoXCI6OlwiKSA/IG5hbWUuc3BsaXQoXCI6OlwiKS5wb3AoKSA/PyBuYW1lIDogbmFtZTtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBzaG9ydE5hbWUsXG4gICAgbmFtZXM6IFsuLi5uZXcgU2V0KFtzaG9ydE5hbWUsIG5hbWVdKV0sXG4gICAgc3RhcnQsXG4gICAgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgYnJhY2VMaW5lKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkLmVuZHNXaXRoKFwiO1wiKSB8fCB0cmltbWVkLmluY2x1ZGVzKFwiKFwiKSB8fCAvXihyZXR1cm58dXNpbmd8bmFtZXNwYWNlfHRlbXBsYXRlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgd2l0aG91dEluaXRpYWxpemVyID0gdHJpbW1lZC5zcGxpdChcIj1cIilbMF0ucmVwbGFjZSgvXFxbW15cXF1dKl0vZywgXCJcIik7XG4gIGNvbnN0IG1hdGNoID0gd2l0aG91dEluaXRpYWxpemVyLm1hdGNoKC8oW0EtWmEtel9dXFx3KilcXHMqKD86Wyw7XXwkKS9nKT8ucG9wKCk/Lm1hdGNoKC8oW0EtWmEtel9dXFx3KikvKTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoPy5bMV07XG4gIGlmICghbmFtZSB8fCAvXihjb25zdHxzdGF0aWN8ZXh0ZXJufHZvbGF0aWxlfHVuc2lnbmVkfHNpZ25lZHxsb25nfHNob3J0fGludHxjaGFyfGZsb2F0fGRvdWJsZXx2b2lkfGF1dG8pJC8udGVzdChuYW1lKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHsgbmFtZSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH07XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RMbHZtRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCBzeW1ib2wgPSBsaW5lLm1hdGNoKC9eXFxzKig/OmRlZmluZXxkZWNsYXJlKVxcYi4qQChbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qKVxccypcXCgvKTtcbiAgICBpZiAoc3ltYm9sKSB7XG4gICAgICBjb25zdCBlbmQgPSBsaW5lLnRyaW1TdGFydCgpLnN0YXJ0c1dpdGgoXCJkZWZpbmVcIikgPyBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIDogaW5kZXg7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogc3ltYm9sWzFdLCBuYW1lczogW3N5bWJvbFsxXSwgYEAke3N5bWJvbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBnbG9iYWwgPSBsaW5lLm1hdGNoKC9eXFxzKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqPS8pO1xuICAgIGlmIChnbG9iYWwpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBnbG9iYWxbMV0sIG5hbWVzOiBbZ2xvYmFsWzFdLCBgQCR7Z2xvYmFsWzFdfWBdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG1vZHVsZXxpbXBvcnQpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lcyA9IGdldEhhc2tlbGxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRIYXNrZWxsUmFuZ2VFbmQobGluZXMsIGluZGV4LCBuYW1lc1swXSk7XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG5hbWVzWzBdLCBuYW1lcywgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgaW5kZXggPSBlbmQ7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0T2NhbWxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG9wZW58aW5jbHVkZXwjdXNlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkKTtcbiAgICBpZiAoIW5hbWVzLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZW5kID0gZmluZExheW91dFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgaXNPY2FtbFRvcExldmVsU3RhcnQpO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBwYXR0ZXJuOiBSZWdFeHApOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaChwYXR0ZXJuKTtcbiAgICBjb25zdCBuYW1lID0gbWF0Y2g/LnNsaWNlKDEpLmZpbmQoQm9vbGVhbik7XG4gICAgaWYgKCFuYW1lKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gZmluZEJyYWNlUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFsaW5lc1tzdGFydF0uaW5jbHVkZXMoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIHN0YXJ0O1xuICB9XG5cbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHNhd0JyYWNlICYmIGRlcHRoIDw9IDApIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBmaW5kQ0RlY2xhcmF0aW9uRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCghc2F3QnJhY2UgfHwgZGVwdGggPD0gMCkgJiYgbGluZXNbaW5kZXhdLmluY2x1ZGVzKFwiO1wiKSkge1xuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RhcnQ7XG59XG5cbmZ1bmN0aW9uIGJyYWNlRGVsdGEobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGRlbHRhID0gMDtcbiAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmUpIHtcbiAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgIGRlbHRhICs9IDE7XG4gICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgZGVsdGEgLT0gMTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRlbHRhO1xufVxuXG5mdW5jdGlvbiBpc0NDb21tZW50TGluZSh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi8vXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIi8qXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIipcIik7XG59XG5cbmZ1bmN0aW9uIGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiaWZcIiwgXCJmb3JcIiwgXCJ3aGlsZVwiLCBcInN3aXRjaFwiLCBcImNhdGNoXCJdLmluY2x1ZGVzKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2lnbmF0dXJlID0gdHJpbW1lZC5tYXRjaCgvXihbYS16X11bXFx3J10qKVxccyo6Oi8pO1xuICBpZiAoc2lnbmF0dXJlKSB7XG4gICAgcmV0dXJuIFtzaWduYXR1cmVbMV1dO1xuICB9XG5cbiAgY29uc3QgYmluZGluZyA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXGIuKj0vKTtcbiAgaWYgKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gW2JpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUxpa2UgPSB0cmltbWVkLm1hdGNoKC9eKD86ZGF0YXxuZXd0eXBlfHR5cGV8Y2xhc3MpXFxzKyhbQS1aXVtcXHcnXSopXFxiLyk7XG4gIGlmICh0eXBlTGlrZSkge1xuICAgIHJldHVybiBbdHlwZUxpa2VbMV1dO1xuICB9XG5cbiAgY29uc3QgaW5zdGFuY2UgPSB0cmltbWVkLm1hdGNoKC9eaW5zdGFuY2VcXGIuKj9cXGIoW0EtWl1bXFx3J10qKVxcYi8pO1xuICByZXR1cm4gaW5zdGFuY2UgPyBbaW5zdGFuY2VbMV1dIDogW107XG59XG5cbmZ1bmN0aW9uIGdldE9jYW1sRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGV0QmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15sZXRcXHMrKD86cmVjXFxzKyk/KD86XFwoKFteKV0rKVxcKXwoW2Etel9dW1xcdyddKikpLyk7XG4gIGlmIChsZXRCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtsZXRCaW5kaW5nWzFdID8/IGxldEJpbmRpbmdbMl1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9edHlwZVxccysoW2Etel9dW1xcdyddKikvKTtcbiAgaWYgKHR5cGVCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFt0eXBlQmluZGluZ1sxXV07XG4gIH1cblxuICBjb25zdCBtb2R1bGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXm1vZHVsZVxccysoW0EtWl1bXFx3J10qKS8pO1xuICBpZiAobW9kdWxlQmluZGluZykge1xuICAgIHJldHVybiBbbW9kdWxlQmluZGluZ1sxXV07XG4gIH1cblxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzVG9wTGV2ZWxTdGFydDogKGxpbmU6IHN0cmluZykgPT4gYm9vbGVhbik6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAobGluZS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmUpID09PSAwICYmIGlzVG9wTGV2ZWxTdGFydChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgbmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGVuZCA9IHN0YXJ0O1xuICBsZXQgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gbGluZXNbc3RhcnRdLnRyaW0oKS5zdGFydHNXaXRoKGAke25hbWV9IDo6YCk7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQpKSB7XG4gICAgICBpZiAoYWxsb3dNYXRjaGluZ0VxdWF0aW9uICYmIHRyaW1tZWQuc3RhcnRzV2l0aChgJHtuYW1lfSBgKSAmJiB0cmltbWVkLmluY2x1ZGVzKFwiPVwiKSkge1xuICAgICAgICBhbGxvd01hdGNoaW5nRXF1YXRpb24gPSBmYWxzZTtcbiAgICAgICAgZW5kID0gaW5kZXg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGVuZCA9IGluZGV4O1xuICB9XG4gIHJldHVybiBlbmQ7XG59XG5cbmZ1bmN0aW9uIGlzSGFza2VsbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihtb2R1bGV8aW1wb3J0fGRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzfGluc3RhbmNlKVxcYi8udGVzdCh0cmltbWVkKVxuICAgIHx8IC9eW2Etel9dW1xcdyddKlxccyooPzo6OnwuKj0pLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiBpc09jYW1sVG9wTGV2ZWxTdGFydCh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eKG9wZW58aW5jbHVkZXwjdXNlfGxldHx0eXBlfG1vZHVsZSlcXGIvLnRlc3QodHJpbW1lZCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGxpbmVzLnNsaWNlKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQgKyAxKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiByYW5nZXNPdmVybGFwKGxlZnQ6IFNvdXJjZVJhbmdlLCByaWdodDogU291cmNlUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGxlZnQuc3RhcnQgPD0gcmlnaHQuZW5kICYmIHJpZ2h0LnN0YXJ0IDw9IGxlZnQuZW5kO1xufVxuXG5mdW5jdGlvbiBnZXRJbmRlbnQobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGxpbmUubWF0Y2goL15cXHMqLyk/LlswXS5sZW5ndGggPz8gMDtcbn1cblxuZnVuY3Rpb24gZXNjYXBlUmVnZXgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG59XG5cbmZ1bmN0aW9uIGRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uKTogc3RyaW5nW10ge1xuICByZXR1cm4gZGVmaW5pdGlvbi5uYW1lcz8ubGVuZ3RoID8gZGVmaW5pdGlvbi5uYW1lcyA6IFtkZWZpbml0aW9uLm5hbWVdO1xufVxuXG5mdW5jdGlvbiBzb3VyY2VVc2VzTmFtZShzb3VyY2U6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoXCJAXCIpKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYCR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChuYW1lKX1cXFxcYmApLnRlc3Qoc291cmNlKTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLCByYW5nZTogU291cmNlUmFuZ2UgfCBudWxsKTogc3RyaW5nIHtcbiAgaWYgKHJlZmVyZW5jZS5zeW1ib2xOYW1lKSB7XG4gICAgcmV0dXJuIGAke3JlZmVyZW5jZS5maWxlUGF0aH0jJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gO1xuICB9XG4gIGlmIChyYW5nZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICB9XG4gIHJldHVybiByZWZlcmVuY2UuZmlsZVBhdGg7XG59XG5cbmNvbnN0IFBZVEhPTl9BU1RfSEVMUEVSID0gU3RyaW5nLnJhd2BcbmltcG9ydCBhc3RcbmltcG9ydCBqc29uXG5pbXBvcnQgc3lzXG5cbnBheWxvYWQgPSBqc29uLmxvYWRzKHN5cy5zdGRpbi5yZWFkKCkpXG5zb3VyY2UgPSBwYXlsb2FkLmdldChcInNvdXJjZVwiLCBcIlwiKVxubW9kZSA9IHBheWxvYWQuZ2V0KFwibW9kZVwiLCBcIm1vZHVsZVwiKVxuXG5kZWYgcmFuZ2Vfc3RhcnQobm9kZSk6XG4gICAgbGluZW5vID0gZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKVxuICAgIGRlY29yYXRvcnMgPSBnZXRhdHRyKG5vZGUsIFwiZGVjb3JhdG9yX2xpc3RcIiwgTm9uZSkgb3IgW11cbiAgICBpZiBkZWNvcmF0b3JzOlxuICAgICAgICBsaW5lbm8gPSBtaW4obGluZW5vLCAqKGdldGF0dHIoZGVjb3JhdG9yLCBcImxpbmVub1wiLCBsaW5lbm8pIGZvciBkZWNvcmF0b3IgaW4gZGVjb3JhdG9ycykpXG4gICAgcmV0dXJuIGxpbmVubyAtIDFcblxuZGVmIHJhbmdlX2VuZChub2RlKTpcbiAgICByZXR1cm4gZ2V0YXR0cihub2RlLCBcImVuZF9saW5lbm9cIiwgZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKSkgLSAxXG5cbmRlZiB0YXJnZXRfbmFtZXModGFyZ2V0KTpcbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgYXN0Lk5hbWUpOlxuICAgICAgICByZXR1cm4gW3RhcmdldC5pZF1cbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgKGFzdC5UdXBsZSwgYXN0Lkxpc3QpKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgaXRlbSBpbiB0YXJnZXQuZWx0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXMoaXRlbSkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIHJldHVybiBbXVxuXG5kZWYgZGVmaW5pdGlvbl9uYW1lcyhub2RlKTpcbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIChhc3QuRnVuY3Rpb25EZWYsIGFzdC5Bc3luY0Z1bmN0aW9uRGVmLCBhc3QuQ2xhc3NEZWYpKTpcbiAgICAgICAgcmV0dXJuIFtub2RlLm5hbWVdXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuQXNzaWduKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgdGFyZ2V0IGluIG5vZGUudGFyZ2V0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXModGFyZ2V0KSlcbiAgICAgICAgcmV0dXJuIG5hbWVzXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkFubkFzc2lnbiwgYXN0LkF1Z0Fzc2lnbikpOlxuICAgICAgICByZXR1cm4gdGFyZ2V0X25hbWVzKG5vZGUudGFyZ2V0KVxuICAgIHJldHVybiBbXVxuXG5kZWYgaW5zcGVjdF9tb2R1bGUodHJlZSk6XG4gICAgZGVmaW5pdGlvbnMgPSBbXVxuICAgIGltcG9ydHMgPSBbXVxuICAgIGZvciBub2RlIGluIHRyZWUuYm9keTpcbiAgICAgICAgbmFtZXMgPSBkZWZpbml0aW9uX25hbWVzKG5vZGUpXG4gICAgICAgIGlmIG5hbWVzOlxuICAgICAgICAgICAgZGVmaW5pdGlvbnMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcIm5hbWVcIjogbmFtZXNbMF0sXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBuYW1lcyxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5JbXBvcnQpOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImltcG9ydFwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiAwLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0RnJvbSk6XG4gICAgICAgICAgICBpbXBvcnRzLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJraW5kXCI6IFwiZnJvbVwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IG5vZGUubW9kdWxlIG9yIFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiBub2RlLmxldmVsLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgIHJldHVybiB7XCJkZWZpbml0aW9uc1wiOiBkZWZpbml0aW9ucywgXCJpbXBvcnRzXCI6IGltcG9ydHN9XG5cbmRlZiBhdHRyaWJ1dGVfY2hhaW4obm9kZSk6XG4gICAgY2hhaW4gPSBbXVxuICAgIGN1cnJlbnQgPSBub2RlXG4gICAgd2hpbGUgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuQXR0cmlidXRlKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuYXR0cilcbiAgICAgICAgY3VycmVudCA9IGN1cnJlbnQudmFsdWVcbiAgICBpZiBpc2luc3RhbmNlKGN1cnJlbnQsIGFzdC5OYW1lKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuaWQpXG4gICAgICAgIGNoYWluLnJldmVyc2UoKVxuICAgICAgICByZXR1cm4gY2hhaW5cbiAgICByZXR1cm4gW11cblxuY2xhc3MgVXNhZ2VWaXNpdG9yKGFzdC5Ob2RlVmlzaXRvcik6XG4gICAgZGVmIF9faW5pdF9fKHNlbGYpOlxuICAgICAgICBzZWxmLm5hbWVzID0gc2V0KClcbiAgICAgICAgc2VsZi5hdHRyaWJ1dGVzID0ge31cblxuICAgIGRlZiB2aXNpdF9OYW1lKHNlbGYsIG5vZGUpOlxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUuY3R4LCBhc3QuTG9hZCk6XG4gICAgICAgICAgICBzZWxmLm5hbWVzLmFkZChub2RlLmlkKVxuXG4gICAgZGVmIHZpc2l0X0F0dHJpYnV0ZShzZWxmLCBub2RlKTpcbiAgICAgICAgY2hhaW4gPSBhdHRyaWJ1dGVfY2hhaW4obm9kZSlcbiAgICAgICAgaWYgbGVuKGNoYWluKSA+PSAyOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQoY2hhaW5bMF0pXG4gICAgICAgICAgICBzZWxmLmF0dHJpYnV0ZXMuc2V0ZGVmYXVsdChjaGFpblswXSwgc2V0KCkpLmFkZChjaGFpblsxXSlcbiAgICAgICAgc2VsZi5nZW5lcmljX3Zpc2l0KG5vZGUpXG5cbmRlZiBpbnNwZWN0X3VzYWdlKHRyZWUpOlxuICAgIHZpc2l0b3IgPSBVc2FnZVZpc2l0b3IoKVxuICAgIHZpc2l0b3IudmlzaXQodHJlZSlcbiAgICByZXR1cm4ge1xuICAgICAgICBcIm5hbWVzXCI6IHNvcnRlZCh2aXNpdG9yLm5hbWVzKSxcbiAgICAgICAgXCJhdHRyaWJ1dGVzXCI6IHtrZXk6IHNvcnRlZCh2YWx1ZSkgZm9yIGtleSwgdmFsdWUgaW4gdmlzaXRvci5hdHRyaWJ1dGVzLml0ZW1zKCl9LFxuICAgIH1cblxudHJ5OlxuICAgIHRyZWUgPSBhc3QucGFyc2Uoc291cmNlKVxuZXhjZXB0IFN5bnRheEVycm9yOlxuICAgIHByaW50KGpzb24uZHVtcHMoe1wiZGVmaW5pdGlvbnNcIjogW10sIFwiaW1wb3J0c1wiOiBbXX0gaWYgbW9kZSA9PSBcIm1vZHVsZVwiIGVsc2Uge1wibmFtZXNcIjogW10sIFwiYXR0cmlidXRlc1wiOiB7fX0pKVxuICAgIHJhaXNlIFN5c3RlbUV4aXQoMClcblxuaWYgbW9kZSA9PSBcIm1vZHVsZVwiOlxuICAgIHByaW50KGpzb24uZHVtcHMoaW5zcGVjdF9tb2R1bGUodHJlZSkpKVxuZWxzZTpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfdXNhZ2UodHJlZSkpKVxuYDtcbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogc3RyaW5nIHtcbiAgY29uc3QgY2FsbCA9IGJsb2NrLnNvdXJjZVJlZmVyZW5jZT8uY2FsbDtcbiAgaWYgKCFjYWxsKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRlbnQ7XG4gIH1cblxuICBjb25zdCBzeW1ib2xOYW1lID0gYmxvY2suc291cmNlUmVmZXJlbmNlPy5zeW1ib2xOYW1lPy50cmltKCk7XG4gIGNvbnN0IGlucHV0ID0gYmxvY2suY29udGVudC50cmltKCk7XG4gIGNvbnN0IGV4cHJlc3Npb24gPSBjYWxsLmV4cHJlc3Npb24/LnRyaW0oKVxuICAgID8gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKGNhbGwuZXhwcmVzc2lvbiwgaW5wdXQsIHN5bWJvbE5hbWUpXG4gICAgOiByZW5kZXJEZWZhdWx0U291cmNlQ2FsbChzeW1ib2xOYW1lLCBjYWxsLmFyZ3MsIGlucHV0KTtcblxuICByZXR1cm4gcmVuZGVyTGFuZ3VhZ2VDYWxsSGFybmVzcyhibG9jay5sYW5ndWFnZSwgZXhwcmVzc2lvbiwgY2FsbC5wcmludCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckRlZmF1bHRTb3VyY2VDYWxsKHN5bWJvbE5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgYXJnczogc3RyaW5nIHwgdW5kZWZpbmVkLCBpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFzeW1ib2xOYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwibG9vbS1jYWxsIG5lZWRzIGxvb20tc3ltYm9sIHdoZW4gbm8gY2FsbCBleHByZXNzaW9uIGlzIHByb3ZpZGVkLlwiKTtcbiAgfVxuXG4gIGNvbnN0IHJlbmRlcmVkQXJncyA9IHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZShhcmdzPy50cmltKCkgfHwgXCJ7aW5wdXR9XCIsIGlucHV0LCBzeW1ib2xOYW1lKTtcbiAgcmV0dXJuIGAke3N5bWJvbE5hbWV9KCR7cmVuZGVyZWRBcmdzfSlgO1xufVxuXG5mdW5jdGlvbiByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUodGVtcGxhdGU6IHN0cmluZywgaW5wdXQ6IHN0cmluZywgc3ltYm9sTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRlbXBsYXRlXG4gICAgLnJlcGxhY2VBbGwoXCJ7aW5wdXR9XCIsIGlucHV0KVxuICAgIC5yZXBsYWNlQWxsKFwie3N5bWJvbH1cIiwgc3ltYm9sTmFtZSA/PyBcIlwiKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTGFuZ3VhZ2VDYWxsSGFybmVzcyhsYW5ndWFnZTogc3RyaW5nLCBleHByZXNzaW9uOiBzdHJpbmcsIHByaW50OiBib29sZWFuKTogc3RyaW5nIHtcbiAgaWYgKCFwcmludCkge1xuICAgIHJldHVybiByZW5kZXJFeHByZXNzaW9uU3RhdGVtZW50KGxhbmd1YWdlLCBleHByZXNzaW9uKTtcbiAgfVxuXG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gYHByaW50KCR7ZXhwcmVzc2lvbn0pYDtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gYGNvbnNvbGUubG9nKCR7ZXhwcmVzc2lvbn0pO2A7XG4gICAgY2FzZSBcImNcIjpcbiAgICAgIHJldHVybiBgI2luY2x1ZGUgPHN0ZGlvLmg+XFxuaW50IG1haW4odm9pZCkgeyBwcmludGYoXCIlZFxcXFxuXCIsICR7ZXhwcmVzc2lvbn0pOyByZXR1cm4gMDsgfWA7XG4gICAgY2FzZSBcImNwcFwiOlxuICAgICAgcmV0dXJuIGAjaW5jbHVkZSA8aW9zdHJlYW0+XFxuaW50IG1haW4oKSB7IHN0ZDo6Y291dCA8PCAoJHtleHByZXNzaW9ufSkgPDwgXCJcXFxcblwiOyByZXR1cm4gMDsgfWA7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gYGxldCAoKSA9IHByaW50X2VuZGxpbmUgKCR7ZXhwcmVzc2lvbn0pYDtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBsb29tLWNhbGwgY2Fubm90IGdlbmVyYXRlIGEgcHJpbnRlZCBoYXJuZXNzIGZvciAke2xhbmd1YWdlfS4gVXNlIGxvb20tcHJpbnQ9ZmFsc2Ugb3Igd3JpdGUgdGhlIGhhcm5lc3MgaW4gdGhlIGJsb2NrIGJvZHkuYCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyRXhwcmVzc2lvblN0YXRlbWVudChsYW5ndWFnZTogc3RyaW5nLCBleHByZXNzaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGV4cHJlc3Npb247XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBleHByZXNzaW9uLmVuZHNXaXRoKFwiO1wiKSA/IGV4cHJlc3Npb24gOiBgJHtleHByZXNzaW9ufTtgO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Ub29sYmFySGFuZGxlcnMge1xuICBvblJ1bjogKCkgPT4gdm9pZDtcbiAgb25Db3B5OiAoKSA9PiB2b2lkO1xuICBvblJlbW92ZTogKCkgPT4gdm9pZDtcbiAgb25Ub2dnbGVJbnB1dDogKCkgPT4gdm9pZDtcbiAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHZvaWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKFxuICBibG9ja0lkOiBzdHJpbmcsXG4gIGlzUnVubmluZzogYm9vbGVhbixcbiAgaGFuZGxlcnM6IGxvb21Ub29sYmFySGFuZGxlcnMsXG4pOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHRvb2xiYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICB0b29sYmFyLmNsYXNzTmFtZSA9IFwibG9vbS1jb2RlLXRvb2xiYXJcIjtcbiAgdG9vbGJhci5kYXRhc2V0Lmxvb21CbG9ja0lkID0gYmxvY2tJZDtcblxuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJ1biBibG9ja1wiLCBpc1J1bm5pbmcgPyBcImxvYWRlci1jaXJjbGVcIiA6IFwicGxheVwiLCBoYW5kbGVycy5vblJ1biwgaXNSdW5uaW5nKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiVG9nZ2xlIHN0ZGluIGlucHV0XCIsIFwidGV4dC1jdXJzb3ItaW5wdXRcIiwgaGFuZGxlcnMub25Ub2dnbGVJbnB1dCwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJDb3B5IGNvZGVcIiwgXCJjb3B5XCIsIGhhbmRsZXJzLm9uQ29weSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSZW1vdmUgc25pcHBldFwiLCBcInRyYXNoLTJcIiwgaGFuZGxlcnMub25SZW1vdmUsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiVG9nZ2xlIG91dHB1dFwiLCBcInBhbmVsLWJvdHRvbS1vcGVuXCIsIGhhbmRsZXJzLm9uVG9nZ2xlT3V0cHV0LCBmYWxzZSkpO1xuXG4gIHJldHVybiB0b29sYmFyO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdXR0b24obGFiZWw6IHN0cmluZywgaWNvbk5hbWU6IHN0cmluZywgb25DbGljazogKCkgPT4gdm9pZCwgc3Bpbm5pbmc6IGJvb2xlYW4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XG4gIGNvbnN0IGJ1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gIGJ1dHRvbi5jbGFzc05hbWUgPSBgbG9vbS10b29sYmFyLWJ1dHRvbiR7c3Bpbm5pbmcgPyBcIiBpcy1ydW5uaW5nXCIgOiBcIlwifWA7XG4gIGJ1dHRvbi50eXBlID0gXCJidXR0b25cIjtcbiAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgbGFiZWwpO1xuICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgb25DbGljaygpO1xuICB9KTtcbiAgc2V0SWNvbihidXR0b24sIGljb25OYW1lKTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIGxvb21PdXRwdXRQYW5lbE9wdGlvbnMge1xuICBkZWZhdWx0VmlzaWJsZUxpbmVzOiBudW1iZXI7XG59XG5cbmZ1bmN0aW9uIGdldFN0YXR1c0tpbmQob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogXCJzdWNjZXNzXCIgfCBcIndhcm5pbmdcIiB8IFwiZmFpbHVyZVwiIHtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3VjY2Vzcykge1xuICAgIHJldHVybiBvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgfHwgb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgPyBcIndhcm5pbmdcIiA6IFwic3VjY2Vzc1wiO1xuICB9XG5cbiAgcmV0dXJuIFwiZmFpbHVyZVwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0LCBvcHRpb25zOiBsb29tT3V0cHV0UGFuZWxPcHRpb25zKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2dldFN0YXR1c0tpbmQob3V0cHV0KX0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifWA7XG4gIHBhbmVsLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBvdXRwdXQuYmxvY2tJZDtcbiAgcmVuZGVyT3V0cHV0UGFuZWwocGFuZWwsIG91dHB1dCwgb3B0aW9ucyk7XG4gIHJldHVybiBwYW5lbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsOiBIVE1MRWxlbWVudCwgb3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0LCBvcHRpb25zOiBsb29tT3V0cHV0UGFuZWxPcHRpb25zKTogdm9pZCB7XG4gIGNvbnN0IGtpbmQgPSBnZXRTdGF0dXNLaW5kKG91dHB1dCk7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2tpbmR9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn0ke291dHB1dC5jb2xsYXBzZWQgPyBcIiBpcy1jb2xsYXBzZWRcIiA6IFwiXCJ9YDtcbiAgcGFuZWwuZW1wdHkoKTtcbiAgY29uc3QgdmlzaWJsZUxpbmVzID0gcmVzb2x2ZVZpc2libGVMaW5lcyhvdXRwdXQsIG9wdGlvbnMuZGVmYXVsdFZpc2libGVMaW5lcyk7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBiYWRnZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYmFkZ2VcIiB9KTtcbiAgc2V0SWNvbihiYWRnZSwga2luZCA9PT0gXCJzdWNjZXNzXCIgPyBcImNoZWNrLWNpcmNsZS0yXCIgOiBraW5kID09PSBcIndhcm5pbmdcIiA/IFwiYWxlcnQtdHJpYW5nbGVcIiA6IFwieC1jaXJjbGVcIik7XG5cbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5ydW5uZXJOYW1lfSBcdTAwQjcgZXhpdCAke291dHB1dC5yZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCk7XG5cbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5kdXJhdGlvbk1zfSBtcyBcdTAwQjcgJHtuZXcgRGF0ZShvdXRwdXQucmVzdWx0LmZpbmlzaGVkQXQpLnRvTG9jYWxlVGltZVN0cmluZygpfWApO1xuXG4gIGNvbnN0IGJvZHkgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYm9keVwiIH0pO1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3Rkb3V0XCIsIG91dHB1dC5yZXN1bHQuc3Rkb3V0LCB2aXNpYmxlTGluZXMpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIldhcm5pbmdcIiwgb3V0cHV0LnJlc3VsdC53YXJuaW5nLCB2aXNpYmxlTGluZXMpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRlcnJcIiwgb3V0cHV0LnJlc3VsdC5zdGRlcnIsIHZpc2libGVMaW5lcyk7XG4gIH1cbiAgaWYgKG91dHB1dC5zb3VyY2VQcmV2aWV3Py5jb250ZW50LnRyaW0oKSkge1xuICAgIGNyZWF0ZVNvdXJjZVByZXZpZXcoYm9keSwgb3V0cHV0LnNvdXJjZVByZXZpZXcpO1xuICB9XG4gIGlmICghb3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpICYmICFvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpICYmICFvdXRwdXQuc291cmNlUHJldmlldz8uY29udGVudC50cmltKCkpIHtcbiAgICBjb25zdCBlbXB0eSA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWVtcHR5XCIgfSk7XG4gICAgZW1wdHkuc2V0VGV4dChcIk5vIG91dHB1dFwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGFiZWw6IHN0cmluZywgY29udGVudDogc3RyaW5nLCB2aXNpYmxlTGluZXM6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBzZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW1cIiB9KTtcbiAgY29uc3QgbGluZUNvdW50ID0gY291bnRMaW5lcyhjb250ZW50KTtcbiAgc2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtLWxhYmVsXCIsIHRleHQ6IGZvcm1hdFN0cmVhbUxhYmVsKGxhYmVsLCBsaW5lQ291bnQsIHZpc2libGVMaW5lcykgfSk7XG4gIGNvbnN0IHByZSA9IHNlY3Rpb24uY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlXCIsIHRleHQ6IGNvbnRlbnQgfSk7XG4gIGlmICh2aXNpYmxlTGluZXMgPiAwICYmIGxpbmVDb3VudCA+IHZpc2libGVMaW5lcykge1xuICAgIHByZS5hZGRDbGFzcyhcImlzLXNjcm9sbC1saW1pdGVkXCIpO1xuICAgIHByZS5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tbG9vbS1vdXRwdXQtdmlzaWJsZS1saW5lc1wiLCBTdHJpbmcodmlzaWJsZUxpbmVzKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU291cmNlUHJldmlldyhjb250YWluZXI6IEhUTUxFbGVtZW50LCBwcmV2aWV3OiBOb25OdWxsYWJsZTxsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXT4pOiB2b2lkIHtcbiAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lci5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlld1wiIH0pO1xuICBkZXRhaWxzLm9wZW4gPSBwcmV2aWV3LmV4cGFuZGVkO1xuICBjb25zdCBzdW1tYXJ5ID0gZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlldy1zdW1tYXJ5XCIgfSk7XG4gIHN1bW1hcnkuY3JlYXRlU3Bhbih7IHRleHQ6IFwiRXh0cmFjdGVkIHNvdXJjZVwiIH0pO1xuICBzdW1tYXJ5LmNyZWF0ZVNwYW4oeyBjbHM6IFwibG9vbS1zb3VyY2UtcHJldmlldy1tZXRhXCIsIHRleHQ6IGZvcm1hdFNvdXJjZVByZXZpZXdNZXRhKHByZXZpZXcpIH0pO1xuICBkZXRhaWxzLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZSBsb29tLXNvdXJjZS1wcmV2aWV3LXByZVwiLCB0ZXh0OiBwcmV2aWV3LmNvbnRlbnQgfSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFNvdXJjZVByZXZpZXdNZXRhKHByZXZpZXc6IE5vbk51bGxhYmxlPGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdPik6IHN0cmluZyB7XG4gIGNvbnN0IGNhcGFiaWxpdHkgPSBwcmV2aWV3LmNhcGFiaWxpdHk7XG4gIGlmICghY2FwYWJpbGl0eSB8fCAhcHJldmlldy5zaG93Q2FwYWJpbGl0eU1ldGFkYXRhKSB7XG4gICAgcmV0dXJuIGAke3ByZXZpZXcubGFuZ3VhZ2V9IFx1MDBCNyAke3ByZXZpZXcuZGVzY3JpcHRpb259YDtcbiAgfVxuICByZXR1cm4gW1xuICAgIHByZXZpZXcubGFuZ3VhZ2UsXG4gICAgcHJldmlldy5kZXNjcmlwdGlvbixcbiAgICBgc3ltYm9sczoke2NhcGFiaWxpdHkuc3ltYm9sRXh0cmFjdGlvbn1gLFxuICAgIGBkZXBzOiR7Y2FwYWJpbGl0eS5kZXBlbmRlbmN5VHJhY2luZ31gLFxuICAgIGBjYWxsOiR7Y2FwYWJpbGl0eS5jYWxsSGFybmVzc31gLFxuICBdLmpvaW4oXCIgXHUwMEI3IFwiKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVZpc2libGVMaW5lcyhvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQsIGRlZmF1bHRWaXNpYmxlTGluZXM6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IG92ZXJyaWRlID0gb3V0cHV0LmJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1saW5lc1wiXSA/PyBvdXRwdXQuYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1saW5lc1wiXTtcbiAgaWYgKG92ZXJyaWRlICE9IG51bGwpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplVmlzaWJsZUxpbmVzKE51bWJlci5wYXJzZUludChvdmVycmlkZS50cmltKCksIDEwKSk7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZVZpc2libGVMaW5lcyhkZWZhdWx0VmlzaWJsZUxpbmVzKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVmlzaWJsZUxpbmVzKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHJldHVybiAwO1xuICB9XG4gIHJldHVybiBNYXRoLm1pbihNYXRoLmZsb29yKHZhbHVlKSwgMjAwMCk7XG59XG5cbmZ1bmN0aW9uIGNvdW50TGluZXMoY29udGVudDogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZSgvXFxuJC8sIFwiXCIpLnNwbGl0KFwiXFxuXCIpLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U3RyZWFtTGFiZWwobGFiZWw6IHN0cmluZywgbGluZUNvdW50OiBudW1iZXIsIHZpc2libGVMaW5lczogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKHZpc2libGVMaW5lcyA+IDAgJiYgbGluZUNvdW50ID4gdmlzaWJsZUxpbmVzKSB7XG4gICAgcmV0dXJuIGAke2xhYmVsfSBcdTAwQjcgJHtsaW5lQ291bnR9IGxpbmVzIFx1MDBCNyBzaG93aW5nICR7dmlzaWJsZUxpbmVzfWA7XG4gIH1cbiAgcmV0dXJuIGxhYmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUnVubmluZ1BhbmVsKCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBcImxvb20tb3V0cHV0LXBhbmVsIGlzLXJ1bm5pbmdcIjtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IHNwaW5uZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3Bpbm5lclwiIH0pO1xuICBzZXRJY29uKHNwaW5uZXIsIFwibG9hZGVyLWNpcmNsZVwiKTtcbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoXCJSdW5uaW5nXCIpO1xuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChcIkV4ZWN1dGluZy4uLlwiKTtcbiAgc3Bpbm5lci5zZXRBdHRyaWJ1dGUoXCJhcmlhLWhpZGRlblwiLCBcInRydWVcIik7XG5cbiAgcmV0dXJuIHBhbmVsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBU087QUFDUCxtQkFBNkM7QUFDN0MsSUFBQUMsZUFBMkU7QUFDM0UsSUFBQUMsZ0JBQXdCOzs7QUNaeEIsc0JBQTZDO0FBQzdDLGdCQUFnRDtBQUNoRCxJQUFBQyxtQkFBd0Q7QUFDeEQsSUFBQUMsZUFBaUY7QUFDakYsSUFBQUMs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QkFBUTtBQUNqQyxZQUFNLElBQUksTUFBTSx5QkFBeUIsU0FBUyxFQUFFO0FBQUEsSUFDdEQ7QUFDQSxXQUFPLEtBQUssSUFBSSxNQUFNLFdBQVcsU0FBUztBQUFBLEVBQzVDO0FBQ0Y7QUFFQSxTQUFTLHVCQUF1QixPQUF1QjtBQUNyRCxTQUFPLE1BQU0sUUFBUSxRQUFRLElBQUksRUFBRSxRQUFRLFFBQVEsR0FBSTtBQUN6RDsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJhbGlhc2VzIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgInBhcnNlUG9zaXRpdmVJbnRlZ2VyIiwgImlzRGlzYWJsZWRWYWx1ZSIsICJub3JtYWxpemVFeHRlbnNpb24iLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2ZzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJsb29tUGx1Z2luIiwgImltcG9ydF9jaGlsZF9wcm9jZXNzIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfb3MiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
