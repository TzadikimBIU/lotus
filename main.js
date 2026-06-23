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
      case "sh":
      case "shell":
        return {
          command: "sh {file}",
          extension: ".sh"
        };
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
          command: shellCommand(`if ${settings.bpftraceExecutable.trim() || "bpftrace"} --help 2>&1 | grep -q -- '--dry-run'; then ${settings.bpftraceExecutable.trim() || "bpftrace"} --dry-run "$1"; else ${settings.bpftraceExecutable.trim() || "bpftrace"} -d "$1"; fi`),
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
    const executable = settings.bpftraceExecutable.trim();
    return withTempSourceFile(".bt", block.content, async ({ tempFile }) => {
      if (mode === "run") {
        return runProcess({
          runnerId: `${this.id}:bpftrace:${mode}`,
          runnerName: "bpftrace",
          executable,
          args: [...extraArgs, tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal,
          stdin: context.stdin
        });
      }
      const result = await runProcess({
        runnerId: `${this.id}:bpftrace:${mode}`,
        runnerName: "bpftrace check",
        executable,
        args: ["--dry-run", ...extraArgs, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!result.success && isUnsupportedBpftraceDryRun(result)) {
        return runProcess({
          runnerId: `${this.id}:bpftrace:${mode}:legacy-debug`,
          runnerName: "bpftrace check",
          executable,
          args: ["-d", ...extraArgs, tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal
        });
      }
      return result;
    });
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
function isUnsupportedBpftraceDryRun(result) {
  const output = `${result.stderr}
${result.stdout}`.toLowerCase();
  return output.includes("--dry-run") && (output.includes("unrecognized option") || output.includes("unknown option") || output.includes("invalid option")) || output.includes("usage:") && !output.includes("--dry-run");
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
    this.normalizeSettings();
  }
  async saveSettings() {
    this.normalizeSettings();
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
    this.notifyAllOutputsChanged();
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
  notifyAllOutputsChanged() {
    for (const listeners of this.outputListeners.values()) {
      for (const listener of listeners) {
        listener();
      }
    }
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
  normalizeSettings() {
    normalizeLanguageConfiguration(this.settings);
    this.settings.outputVisibleLines = normalizeNonNegativeInteger(this.settings.outputVisibleLines, DEFAULT_SETTINGS.outputVisibleLines, 2e3);
    this.settings.defaultTimeoutMs = normalizePositiveInteger(this.settings.defaultTimeoutMs, DEFAULT_SETTINGS.defaultTimeoutMs);
    this.settings.defaultContainerGroup = normalizeStringSetting(this.settings.defaultContainerGroup, DEFAULT_SETTINGS.defaultContainerGroup);
    this.settings.workingDirectory = normalizeStringSetting(this.settings.workingDirectory, DEFAULT_SETTINGS.workingDirectory);
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
function normalizePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function normalizeNonNegativeInteger(value, fallback, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}
function normalizeStringSetting(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBFYnBmUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9lYnBmXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcbmltcG9ydCB7IGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xudHlwZSBsb29tT3V0cHV0RmlsZU1vZGUgPSBcInJlcGxhY2VcIiB8IFwiYXBwZW5kXCI7XG50eXBlIGxvb21PdXRwdXRGaWxlRm9ybWF0ID0gXCJ0ZXh0XCIgfCBcImpzb25cIjtcbnR5cGUgbG9vbU91dHB1dEZpbGVTdHJlYW0gPSBcInN0ZG91dFwiIHwgXCJzdGRlcnJcIiB8IFwid2FybmluZ1wiIHwgXCJtZXRhZGF0YVwiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dEZpbGVUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG1vZGU6IGxvb21PdXRwdXRGaWxlTW9kZTtcbiAgZm9ybWF0OiBsb29tT3V0cHV0RmlsZUZvcm1hdDtcbiAgc3RyZWFtczogbG9vbU91dHB1dEZpbGVTdHJlYW1bXTtcbn1cblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jaywgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgRWJwZlJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGRpbklucHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RkaW5QYW5lbHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgICB0aGlzLm5vcm1hbGl6ZVNldHRpbmdzKCk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5ub3JtYWxpemVTZXR0aW5ncygpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gICAgdGhpcy5yZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTtcbiAgICB0aGlzLm5vdGlmeUFsbE91dHB1dHNDaGFuZ2VkKCk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIGlzQmxvY2tSdW5uaW5nKGJsb2NrSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpO1xuICB9XG5cbiAgcmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcihibG9ja0lkOiBzdHJpbmcsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLnNldChibG9ja0lkLCBuZXcgU2V0KCkpO1xuICAgIH1cbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZGVsZXRlKGxpc3RlbmVyKTtcbiAgICB9O1xuICB9XG5cbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoYmxvY2suaWQsIHRoaXMuaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpLCB7XG4gICAgICBvblJ1bjogKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCksXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChibG9jay5jb250ZW50KTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDbGlwYm9hcmQgd3JpdGUgZmFpbGVkLlwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uUmVtb3ZlOiAoKSA9PiB2b2lkIHRoaXMucmVtb3ZlU25pcHBldEJ5SWQoYmxvY2suaWQpLFxuICAgICAgb25Ub2dnbGVJbnB1dDogKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5zdGRpblBhbmVscy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICAgICAgdGhpcy5zdGRpblBhbmVscy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuc3RkaW5QYW5lbHMuYWRkKGJsb2NrLmlkKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgY29uc3QgYmxvY2tJZCA9IGJsb2NrLmlkO1xuXG4gICAgaWYgKHRoaXMuc2hvdWxkUmVuZGVyU3RkaW5QYW5lbChibG9jaykpIHtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0aGlzLmNyZWF0ZVN0ZGluUGFuZWwoYmxvY2spKTtcbiAgICB9XG5cbiAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUnVubmluZ1BhbmVsKCkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghb3V0cHV0IHx8ICFvdXRwdXQudmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQsIHtcbiAgICAgIGRlZmF1bHRWaXNpYmxlTGluZXM6IHRoaXMuc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID8/IDAsXG4gICAgfSkpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgIGlmICghYmxvY2sgfHwgIWZpbGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gIH1cblxuICBhc3luYyByZW1vdmVTbmlwcGV0QnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBpZiAoIWJsb2NrKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChibG9jay5maWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucnVubmluZy5nZXQoYmxvY2tJZCk/LmFib3J0KCk7XG4gICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9ja0lkKTtcbiAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrSWQpO1xuXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGNvbnRlbnQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9ja0lkKTtcbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtYW5hZ2VkUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrSWQpO1xuICAgICAgY29uc3QgcmVtb3ZhbFN0YXJ0ID0gY3VycmVudEJsb2NrLnN0YXJ0TGluZTtcbiAgICAgIGNvbnN0IHJlbW92YWxFbmQgPSBtYW5hZ2VkUmFuZ2UgPyBtYW5hZ2VkUmFuZ2UuZW5kIDogY3VycmVudEJsb2NrLmVuZExpbmU7XG4gICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCByZW1vdmFsRW5kIC0gcmVtb3ZhbFN0YXJ0ICsgMSk7XG5cbiAgICAgIHdoaWxlIChyZW1vdmFsU3RhcnQgPCBsaW5lcy5sZW5ndGggLSAxICYmIGxpbmVzW3JlbW92YWxTdGFydF0gPT09IFwiXCIgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0ICsgMV0gPT09IFwiXCIpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgMSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgbmV3IE5vdGljZShcImxvb20gc25pcHBldCByZW1vdmVkLlwiKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGNvbnN0IHN1cHBvcnRlZEJsb2NrcyA9IGJsb2Nrcy5maWx0ZXIoKGJsb2NrKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIH0pO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gZXhlY3V0aW9uQ29udGV4dC5jb250YWluZXJHcm91cDtcbiAgICBjb25zdCBydW5uZXIgPSBjb250YWluZXJHcm91cCA/IG51bGwgOiB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIXJ1bm5lcikge1xuICAgICAgaWYgKCFjb250YWluZXJHcm91cCkge1xuICAgICAgICBuZXcgTm90aWNlKGBObyBjb25maWd1cmVkIHJ1bm5lciBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHN0ZGluID0gYXdhaXQgdGhpcy5yZXNvbHZlQmxvY2tTdGRpbihmaWxlLCBibG9jayk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBleGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGV4ZWN1dGlvbkNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgIHN0ZGluLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQmxvY2sgPSBhd2FpdCB0aGlzLnJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgY29uc3QgcmVzdWx0ID0gY29udGFpbmVyR3JvdXBcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncywgY29udGFpbmVyR3JvdXApXG4gICAgICAgIDogYXdhaXQgcnVubmVyIS5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVzb2x2ZWRCbG9jay5zb3VyY2VQcmV2aWV3KSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZU5vdGljZSA9IGBSYW4gZXh0cmFjdGVkIHNvdXJjZSBmcm9tICR7cmVzb2x2ZWRCbG9jay5zb3VyY2VQcmV2aWV3LmRlc2NyaXB0aW9ufS5gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7c291cmNlTm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IHNvdXJjZU5vdGljZTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmhhc0V4cGxpY2l0RXhlY3V0aW9uQ29udGV4dChleGVjdXRpb25Db250ZXh0KSkge1xuICAgICAgICBjb25zdCBjb250ZXh0Tm90aWNlID0gdGhpcy5mb3JtYXRFeGVjdXRpb25Db250ZXh0Tm90aWNlKGV4ZWN1dGlvbkNvbnRleHQpO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7Y29udGV4dE5vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBjb250ZXh0Tm90aWNlO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy53cml0ZU91dHB1dEZpbGVJZlJlcXVlc3RlZChmaWxlLCBibG9jaywgcmVzdWx0KTtcblxuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xuICAgICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgICAgYmxvY2ssXG4gICAgICAgIHJlc3VsdCxcbiAgICAgICAgc291cmNlUHJldmlldzogcmVzb2x2ZWRCbG9jay5zb3VyY2VQcmV2aWV3LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlRXhlY3V0YWJsZUJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8eyBibG9jazogbG9vbUNvZGVCbG9jazsgc291cmNlUHJldmlldz86IGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdIH0+IHtcbiAgICBpZiAoIWJsb2NrLnNvdXJjZVJlZmVyZW5jZSkge1xuICAgICAgcmV0dXJuIHsgYmxvY2sgfTtcbiAgICB9XG5cbiAgICBjb25zdCByZWZlcmVuY2VQYXRoID0gdGhpcy5yZXNvbHZlUmVmZXJlbmNlZFZhdWx0UGF0aChmaWxlLCBibG9jay5zb3VyY2VSZWZlcmVuY2UuZmlsZVBhdGgpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocmVmZXJlbmNlUGF0aCk7XG4gICAgaWYgKCEoc291cmNlRmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWZlcmVuY2VkIHNvdXJjZSBmaWxlIG5vdCBmb3VuZDogJHtyZWZlcmVuY2VQYXRofWApO1xuICAgIH1cblxuICAgIGNvbnN0IGhhcm5lc3MgPSBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MoYmxvY2spO1xuICAgIGNvbnN0IGV4dGVybmFsRXh0cmFjdG9yID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZUV4dHJhY3RvcihibG9jaywgZmlsZSk7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoc291cmNlRmlsZSksXG4gICAgICB7IC4uLmJsb2NrLnNvdXJjZVJlZmVyZW5jZSwgZmlsZVBhdGg6IHJlZmVyZW5jZVBhdGggfSxcbiAgICAgIGJsb2NrLmxhbmd1YWdlLFxuICAgICAgaGFybmVzcyxcbiAgICAgIHtcbiAgICAgICAgcHl0aG9uRXhlY3V0YWJsZTogdGhpcy5zZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIixcbiAgICAgICAgZXh0ZXJuYWxFeHRyYWN0b3IsXG4gICAgICAgIHJlYWRGaWxlOiBhc3luYyAoZmlsZVBhdGgpID0+IHtcbiAgICAgICAgICBjb25zdCBpbXBvcnRlZEZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobm9ybWFsaXplUGF0aChmaWxlUGF0aCkpO1xuICAgICAgICAgIHJldHVybiBpbXBvcnRlZEZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoaW1wb3J0ZWRGaWxlKSA6IG51bGw7XG4gICAgICAgIH0sXG4gICAgICAgIHJlc29sdmVQeXRob25JbXBvcnQ6IGFzeW5jIChmcm9tRmlsZVBhdGgsIG1vZHVsZU5hbWUsIGxldmVsKSA9PiB0aGlzLnJlc29sdmVQeXRob25JbXBvcnRWYXVsdFBhdGgoZnJvbUZpbGVQYXRoLCBtb2R1bGVOYW1lLCBsZXZlbCksXG4gICAgICB9LFxuICAgICk7XG4gICAgY29uc3QgY2FwYWJpbGl0eSA9IGdldExhbmd1YWdlQ2FwYWJpbGl0eShibG9jay5sYW5ndWFnZSwgQm9vbGVhbihleHRlcm5hbEV4dHJhY3RvcikpO1xuICAgIGNvbnN0IHNob3VsZFNob3dQcmV2aWV3ID0gKHRoaXMuc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgfHwgXCJjb2xsYXBzZWRcIikgIT09IFwiaGlkZGVuXCI7XG5cbiAgICByZXR1cm4ge1xuICAgICAgYmxvY2s6IHtcbiAgICAgICAgLi4uYmxvY2ssXG4gICAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICB9LFxuICAgICAgc291cmNlUHJldmlldzogc2hvdWxkU2hvd1ByZXZpZXcgPyB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiByZXNvbHZlZC5kZXNjcmlwdGlvbixcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgICBjYXBhYmlsaXR5LFxuICAgICAgICBleHBhbmRlZDogdGhpcy5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSA9PT0gXCJleHBhbmRlZFwiLFxuICAgICAgICBzaG93Q2FwYWJpbGl0eU1ldGFkYXRhOiB0aGlzLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA/PyB0cnVlLFxuICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlUmVmZXJlbmNlZFZhdWx0UGF0aChmaWxlOiBURmlsZSwgcmVmZXJlbmNlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0cmltbWVkID0gcmVmZXJlbmNlUGF0aC50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSB7XG4gICAgICByZXR1cm4gdHJpbW1lZDtcbiAgICB9XG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHJldHVybiBub3JtYWxpemVQYXRoKHRyaW1tZWQuc2xpY2UoMSkpO1xuICAgIH1cblxuICAgIGNvbnN0IGJhc2VEaXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoYmFzZURpciA9PT0gXCIuXCIgPyB0cmltbWVkIDogYCR7YmFzZURpcn0vJHt0cmltbWVkfWApO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aDogc3RyaW5nLCBtb2R1bGVOYW1lOiBzdHJpbmcsIGxldmVsOiBudW1iZXIpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBtb2R1bGVQYXRoID0gbW9kdWxlTmFtZVxuICAgICAgLnNwbGl0KFwiLlwiKVxuICAgICAgLm1hcCgocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIi9cIik7XG4gICAgY29uc3QgZnJvbURpciA9IGRpcm5hbWUoZnJvbUZpbGVQYXRoKTtcbiAgICBjb25zdCBiYXNlRGlycyA9IGxldmVsID4gMFxuICAgICAgPyBbdGhpcy5hc2NlbmRWYXVsdFBhdGgoZnJvbURpciA9PT0gXCIuXCIgPyBcIlwiIDogZnJvbURpciwgbGV2ZWwgLSAxKV1cbiAgICAgIDogW2Zyb21EaXIgPT09IFwiLlwiID8gXCJcIiA6IGZyb21EaXIsIFwiXCJdO1xuXG4gICAgZm9yIChjb25zdCBiYXNlRGlyIG9mIGJhc2VEaXJzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gdGhpcy5nZXRQeXRob25JbXBvcnRDYW5kaWRhdGVzKGJhc2VEaXIsIG1vZHVsZVBhdGgpO1xuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUGF0aChjYW5kaWRhdGUpO1xuICAgICAgICBpZiAodGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZWQpIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gbm9ybWFsaXplZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRQeXRob25JbXBvcnRDYW5kaWRhdGVzKGJhc2VEaXI6IHN0cmluZywgbW9kdWxlUGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHByZWZpeCA9IGJhc2VEaXIgPyBgJHtiYXNlRGlyfS9gIDogXCJcIjtcbiAgICBpZiAoIW1vZHVsZVBhdGgpIHtcbiAgICAgIHJldHVybiBbYCR7cHJlZml4fV9faW5pdF9fLnB5YF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICBgJHtwcmVmaXh9JHttb2R1bGVQYXRofS5weWAsXG4gICAgICBgJHtwcmVmaXh9JHttb2R1bGVQYXRofS9fX2luaXRfXy5weWAsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgYXNjZW5kVmF1bHRQYXRoKHBhdGg6IHN0cmluZywgbGV2ZWxzOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGxldCBjdXJyZW50ID0gcGF0aDtcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGV2ZWxzOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBuZXh0ID0gZGlybmFtZShjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSBuZXh0ID09PSBcIi5cIiA/IFwiXCIgOiBuZXh0O1xuICAgIH1cbiAgICByZXR1cm4gY3VycmVudDtcbiAgfVxuXG4gIGFzeW5jIGdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XG4gICAgcmV0dXJuIHRoaXMuY29udGFpbmVyUnVubmVyLmdldEdyb3VwU3VtbWFyaWVzKCk7XG4gIH1cblxuICBhc3luYyBidWlsZENvbnRhaW5lckdyb3VwKG5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIuYnVpbGRHcm91cChuYW1lLCBNYXRoLm1heCh0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250cm9sbGVyLnNpZ25hbCk7XG4gICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIGJ1aWx0IGNvbnRhaW5lciBncm91cCAke25hbWV9LmAgOiBgbG9vbSBjb250YWluZXIgYnVpbGQgZmFpbGVkIGZvciAke25hbWV9LmAsIDgwMDApO1xuICB9XG5cbiAgcmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgYWxpYXMgb2YgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHRoaXMuc2V0dGluZ3MpKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkQWxpYXMgPSBhbGlhcy50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuaGFzKG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmICgvW15hLXpBLVowLTlfLV0vLnRlc3Qobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5hZGQobm9ybWFsaXplZEFsaWFzKTtcbiAgICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93bkNvZGVCbG9ja1Byb2Nlc3Nvcihub3JtYWxpemVkQWxpYXMsIGFzeW5jIChzb3VyY2UsIGVsLCBjdHgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBjdHguc291cmNlUGF0aDtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmdWxsVGV4dCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBmdWxsVGV4dCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSAoY3R4ICYmIHR5cGVvZiBjdHguZ2V0U2VjdGlvbkluZm8gPT09IFwiZnVuY3Rpb25cIikgPyBjdHguZ2V0U2VjdGlvbkluZm8oZWwpIDogbnVsbDtcbiAgICAgICAgbGV0IGJsb2NrOiBsb29tQ29kZUJsb2NrIHwgdW5kZWZpbmVkO1xuICAgICAgICBpZiAoc2VjdGlvbikge1xuICAgICAgICAgIGNvbnN0IGxpbmVTdGFydCA9IHNlY3Rpb24ubGluZVN0YXJ0O1xuICAgICAgICAgIGJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnN0YXJ0TGluZSA9PT0gbGluZVN0YXJ0ICYmIGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwcmUgPSBlbC5xdWVyeVNlbGVjdG9yKFwicHJlXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgaWYgKCFwcmUpIHtcbiAgICAgICAgICBwcmUgPSBlbC5jcmVhdGVFbChcInByZVwiKTtcbiAgICAgICAgICBwcmUuYWRkQ2xhc3MoYGxhbmd1YWdlLSR7bm9ybWFsaXplZEFsaWFzfWApO1xuICAgICAgICAgIGNvbnN0IGNvZGUgPSBwcmUuY3JlYXRlRWwoXCJjb2RlXCIpO1xuICAgICAgICAgIGNvZGUuYWRkQ2xhc3MoYGxhbmd1YWdlLSR7bm9ybWFsaXplZEFsaWFzfWApO1xuICAgICAgICAgIGNvZGUuc2V0VGV4dChzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgIGNvbnN0IGNvZGUgPSAocHJlLnF1ZXJ5U2VsZWN0b3IoXCJjb2RlXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbCkgPz8gcHJlO1xuICAgICAgICAgIGhpZ2hsaWdodExsdm1FbGVtZW50KGNvZGUsIHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBjdHguYWRkQ2hpbGQobmV3IGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQoZWwsIHRoaXMsIGJsb2NrLCBwcmUpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlU3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIGNvbnN0IGFjdGl2ZVJ1bnMgPSB0aGlzLnJ1bm5pbmcuc2l6ZTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbC5zZXRUZXh0KGFjdGl2ZVJ1bnMgPyBgbG9vbTogJHthY3RpdmVSdW5zfSBBY3RpdmUgUnVuJHthY3RpdmVSdW5zID09PSAxID8gXCJcIiA6IFwic1wifWAgOiBcImxvb206IElkbGVcIik7XG4gIH1cblxuICBwcml2YXRlIG5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5mb3JFYWNoKChsaXN0ZW5lcikgPT4gbGlzdGVuZXIoKSk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5QWxsT3V0cHV0c0NoYW5nZWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBsaXN0ZW5lcnMgb2YgdGhpcy5vdXRwdXRMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICAgIGxpc3RlbmVyKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbm9ybWFsaXplU2V0dGluZ3MoKTogdm9pZCB7XG4gICAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHRoaXMuc2V0dGluZ3MpO1xuICAgIHRoaXMuc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID0gbm9ybWFsaXplTm9uTmVnYXRpdmVJbnRlZ2VyKHRoaXMuc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzLCBERUZBVUxUX1NFVFRJTkdTLm91dHB1dFZpc2libGVMaW5lcywgMjAwMCk7XG4gICAgdGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zID0gbm9ybWFsaXplUG9zaXRpdmVJbnRlZ2VyKHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgREVGQVVMVF9TRVRUSU5HUy5kZWZhdWx0VGltZW91dE1zKTtcbiAgICB0aGlzLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCA9IG5vcm1hbGl6ZVN0cmluZ1NldHRpbmcodGhpcy5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAsIERFRkFVTFRfU0VUVElOR1MuZGVmYXVsdENvbnRhaW5lckdyb3VwKTtcbiAgICB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkgPSBub3JtYWxpemVTdHJpbmdTZXR0aW5nKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSwgREVGQVVMVF9TRVRUSU5HUy53b3JraW5nRGlyZWN0b3J5KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsZWFmID0gdmlldy5sZWFmO1xuICAgIGNvbnN0IHZpZXdTdGF0ZSA9IGxlYWYuZ2V0Vmlld1N0YXRlKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLih2aWV3U3RhdGUuc3RhdGUgPz8ge30pIH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgXG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XG4gICAgICBzdGF0ZS5zb3VyY2UgPSBmYWxzZTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgICBzdGF0ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnNob3VsZFJlbmRlclN0ZGluUGFuZWwoYmxvY2spKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGVuZExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suZW5kTGluZSArIDEpO1xuICAgICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgICBlbmRMaW5lLnRvLFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbU91dHB1dFdpZGdldChwbHVnaW4sIGJsb2NrKSxcbiAgICAgICAgICAgICAgICAgIHNpZGU6IDEsXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICAgICAgYWRkTGx2bURlY29yYXRpb25zKGJ1aWxkZXIsIHRoaXMudmlldywgYmxvY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFzRXhwbGljaXRFeGVjdXRpb25Db250ZXh0KGNvbnRleHQ6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gY29udGV4dC5zb3VyY2UuY29udGFpbmVyICE9PSBcIm5vbmVcIiB8fCBjb250ZXh0LnNvdXJjZS53b3JraW5nRGlyZWN0b3J5ICE9PSBcImRlZmF1bHRcIiB8fCBjb250ZXh0LnNvdXJjZS50aW1lb3V0ICE9PSBcImdsb2JhbFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRFeGVjdXRpb25Db250ZXh0Tm90aWNlKGNvbnRleHQ6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQpOiBzdHJpbmcge1xuICAgIGNvbnN0IHBpZWNlcyA9IFtcbiAgICAgIGBjb250YWluZXI9JHtjb250ZXh0LmNvbnRhaW5lckdyb3VwID8/IFwibmF0aXZlXCJ9ICgke2NvbnRleHQuc291cmNlLmNvbnRhaW5lcn0pYCxcbiAgICAgIGBjd2Q9JHtjb250ZXh0LndvcmtpbmdEaXJlY3Rvcnl9ICgke2NvbnRleHQuc291cmNlLndvcmtpbmdEaXJlY3Rvcnl9KWAsXG4gICAgICBgdGltZW91dD0ke2NvbnRleHQudGltZW91dE1zfW1zICgke2NvbnRleHQuc291cmNlLnRpbWVvdXR9KWAsXG4gICAgXTtcbiAgICByZXR1cm4gYEV4ZWN1dGlvbiBjb250ZXh0OiAke3BpZWNlcy5qb2luKFwiLCBcIil9LmA7XG4gIH1cblxuICBwcml2YXRlIGdldEN1c3RvbUxhbmd1YWdlRXh0cmFjdG9yKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBmaWxlOiBURmlsZSk6IHsgbW9kZTogXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7IGxhbmd1YWdlOiBzdHJpbmc7IGV4ZWN1dGFibGU6IHN0cmluZzsgYXJnczogc3RyaW5nW107IHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZzsgdGltZW91dE1zOiBudW1iZXIgfSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbGFuZ3VhZ2VJZCA9IGJsb2NrLmxhbmd1YWdlO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5ndWFnZUlkLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgoY2FuZGlkYXRlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gY2FuZGlkYXRlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gY2FuZGlkYXRlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgfHwgXCJjb21tYW5kXCI7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IG1vZGUgPT09IFwidHJhbnNwaWxlLWNcIiA/IGxhbmd1YWdlLnRyYW5zcGlsZUV4ZWN1dGFibGU/LnRyaW0oKSA6IGxhbmd1YWdlLmV4dHJhY3RvckV4ZWN1dGFibGU/LnRyaW0oKTtcbiAgICBjb25zdCBhcmdzID0gbW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gbGFuZ3VhZ2UudHJhbnNwaWxlQXJncyB8fCBcIntyZXF1ZXN0fVwiIDogbGFuZ3VhZ2UuZXh0cmFjdG9yQXJncyB8fCBcIntyZXF1ZXN0fVwiO1xuICAgIGlmICghZXhlY3V0YWJsZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4ge1xuICAgICAgbW9kZSxcbiAgICAgIGxhbmd1YWdlOiBsYW5ndWFnZS5uYW1lLFxuICAgICAgZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwbGl0Q29tbWFuZExpbmUoYXJncyksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBleGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGV4ZWN1dGlvbkNvbnRleHQudGltZW91dE1zLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGNvbnRlbnQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9jay5pZCk7XG4gICAgICBjb25zdCByZW5kZXJlZCA9IHRoaXMucmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrLmlkLCByZXN1bHQpO1xuICAgICAgY29uc3QgZXhpc3RpbmdSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2suaWQpO1xuXG4gICAgICBpZiAoZXhpc3RpbmdSYW5nZSkge1xuICAgICAgICBsaW5lcy5zcGxpY2UoZXhpc3RpbmdSYW5nZS5zdGFydCwgZXhpc3RpbmdSYW5nZS5lbmQgLSBleGlzdGluZ1JhbmdlLnN0YXJ0ICsgMSwgLi4ucmVuZGVyZWQpO1xuICAgICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGxpbmVzLnNwbGljZShjdXJyZW50QmxvY2suZW5kTGluZSArIDEsIDAsIC4uLnJlbmRlcmVkKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU91dHB1dEZpbGVJZlJlcXVlc3RlZChmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnJlYWRPdXRwdXRGaWxlVGFyZ2V0KGZpbGUsIGJsb2NrKTtcbiAgICAgIGlmICghdGFyZ2V0KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVWYXVsdFBhcmVudEZvbGRlcih0YXJnZXQucGF0aCk7XG4gICAgICBjb25zdCByZW5kZXJlZCA9IHRhcmdldC5mb3JtYXQgPT09IFwianNvblwiXG4gICAgICAgID8gdGhpcy5yZW5kZXJPdXRwdXRGaWxlSnNvbihmaWxlLCBibG9jaywgcmVzdWx0LCB0YXJnZXQpXG4gICAgICAgIDogdGhpcy5yZW5kZXJPdXRwdXRGaWxlVGV4dChyZXN1bHQsIHRhcmdldCk7XG4gICAgICBjb25zdCBjdXJyZW50ID0gdGFyZ2V0Lm1vZGUgPT09IFwiYXBwZW5kXCIgJiYgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHModGFyZ2V0LnBhdGgpXG4gICAgICAgID8gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkKHRhcmdldC5wYXRoKVxuICAgICAgICA6IFwiXCI7XG4gICAgICBjb25zdCBuZXh0ID0gdGFyZ2V0Lm1vZGUgPT09IFwiYXBwZW5kXCIgJiYgY3VycmVudFxuICAgICAgICA/IGAke2N1cnJlbnQucmVwbGFjZSgvXFxzKiQvLCBcIlxcblwiKX0ke3JlbmRlcmVkfWBcbiAgICAgICAgOiByZW5kZXJlZDtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUodGFyZ2V0LnBhdGgsIG5leHQpO1xuXG4gICAgICBjb25zdCBzdHJlYW1MaXN0ID0gdGFyZ2V0LnN0cmVhbXMuam9pbihcIixcIik7XG4gICAgICBjb25zdCBub3RpY2UgPSBgV3JvdGUgb3V0cHV0IGZpbGUgJHt0YXJnZXQucGF0aH0gKCR7dGFyZ2V0Lm1vZGV9LCAke3RhcmdldC5mb3JtYXR9LCAke3N0cmVhbUxpc3R9KS5gO1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSByZXN1bHQud2FybmluZyA/IGAke25vdGljZX1cXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBub3RpY2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICBjb25zdCBub3RpY2UgPSBgRmFpbGVkIHRvIHdyaXRlIG91dHB1dCBmaWxlOiAke21lc3NhZ2V9YDtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtub3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogbm90aWNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVhZE91dHB1dEZpbGVUYXJnZXQoZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbG9vbU91dHB1dEZpbGVUYXJnZXQgfCBudWxsIHtcbiAgICBjb25zdCByYXdQYXRoID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWZpbGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1maWxlXCJdO1xuICAgIGlmICghcmF3UGF0aD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGF0aDogdGhpcy5yZXNvbHZlT3V0cHV0VmF1bHRQYXRoKGZpbGUsIHJhd1BhdGgpLFxuICAgICAgbW9kZTogdGhpcy5yZWFkT3V0cHV0RmlsZU1vZGUoYmxvY2spLFxuICAgICAgZm9ybWF0OiB0aGlzLnJlYWRPdXRwdXRGaWxlRm9ybWF0KGJsb2NrKSxcbiAgICAgIHN0cmVhbXM6IHRoaXMucmVhZE91dHB1dEZpbGVTdHJlYW1zKGJsb2NrKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZU1vZGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZU1vZGUge1xuICAgIGNvbnN0IGFwcGVuZCA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1hcHBlbmRcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcIm91dHB1dC1hcHBlbmRcIl07XG4gICAgaWYgKGFwcGVuZCAmJiAhW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIl0uaW5jbHVkZXMoYXBwZW5kLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgcmV0dXJuIFwiYXBwZW5kXCI7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IChibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZS1tb2RlXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtZmlsZS1tb2RlXCJdID8/IFwicmVwbGFjZVwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobW9kZSA9PT0gXCJhcHBlbmRcIikge1xuICAgICAgcmV0dXJuIFwiYXBwZW5kXCI7XG4gICAgfVxuICAgIGlmIChtb2RlID09PSBcInJlcGxhY2VcIikge1xuICAgICAgcmV0dXJuIFwicmVwbGFjZVwiO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxvb20tb3V0cHV0LWZpbGUtbW9kZTogJHttb2RlfS4gVXNlIHJlcGxhY2Ugb3IgYXBwZW5kLmApO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0RmlsZUZvcm1hdChibG9jazogbG9vbUNvZGVCbG9jayk6IGxvb21PdXRwdXRGaWxlRm9ybWF0IHtcbiAgICBjb25zdCBmb3JtYXQgPSAoYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWZpbGUtZm9ybWF0XCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtZmlsZS1mb3JtYXRcIl0gPz8gXCJ0ZXh0XCIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChmb3JtYXQgPT09IFwidGV4dFwiIHx8IGZvcm1hdCA9PT0gXCJqc29uXCIpIHtcbiAgICAgIHJldHVybiBmb3JtYXQ7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbG9vbS1vdXRwdXQtZmlsZS1mb3JtYXQ6ICR7Zm9ybWF0fS4gVXNlIHRleHQgb3IganNvbi5gKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZE91dHB1dEZpbGVTdHJlYW1zKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbG9vbU91dHB1dEZpbGVTdHJlYW1bXSB7XG4gICAgY29uc3QgdmFsdWUgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtZmlsZS1zdHJlYW1zXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtZmlsZS1zdHJlYW1zXCJdID8/IFwic3Rkb3V0XCI7XG4gICAgY29uc3QgcGFyc2VkID0gdmFsdWVcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHN0cmVhbSkgPT4gc3RyZWFtLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBleHBhbmRlZCA9IHBhcnNlZC5pbmNsdWRlcyhcImFsbFwiKVxuICAgICAgPyBbXCJtZXRhZGF0YVwiLCBcInN0ZG91dFwiLCBcIndhcm5pbmdcIiwgXCJzdGRlcnJcIl1cbiAgICAgIDogcGFyc2VkO1xuICAgIGNvbnN0IHN0cmVhbXMgPSBleHBhbmRlZC5tYXAoKHN0cmVhbSkgPT4ge1xuICAgICAgaWYgKHN0cmVhbSA9PT0gXCJzdGRvdXRcIiB8fCBzdHJlYW0gPT09IFwic3RkZXJyXCIgfHwgc3RyZWFtID09PSBcIndhcm5pbmdcIiB8fCBzdHJlYW0gPT09IFwibWV0YWRhdGFcIikge1xuICAgICAgICByZXR1cm4gc3RyZWFtO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsb29tLW91dHB1dC1maWxlLXN0cmVhbXMgZW50cnk6ICR7c3RyZWFtfS5gKTtcbiAgICB9KTtcbiAgICByZXR1cm4gc3RyZWFtcy5sZW5ndGggPyBbLi4ubmV3IFNldChzdHJlYW1zKV0gOiBbXCJzdGRvdXRcIl07XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVPdXRwdXRWYXVsdFBhdGgoZmlsZTogVEZpbGUsIHJhd1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHJhd1BhdGgudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCAvXlthLXpBLVpdW2EtekEtWjAtOSsuLV0qOi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwibG9vbS1vdXRwdXQtZmlsZSBtdXN0IGJlIGEgdmF1bHQtcmVsYXRpdmUgcGF0aC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHRyaW1tZWQuc3RhcnRzV2l0aChcIi9cIilcbiAgICAgID8gbm9ybWFsaXplUGF0aCh0cmltbWVkLnNsaWNlKDEpKVxuICAgICAgOiBub3JtYWxpemVQYXRoKGRpcm5hbWUoZmlsZS5wYXRoKSA9PT0gXCIuXCIgPyB0cmltbWVkIDogYCR7ZGlybmFtZShmaWxlLnBhdGgpfS8ke3RyaW1tZWR9YCk7XG4gICAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KFwiL1wiKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGggfHwgcGFydHMuaW5jbHVkZXMoXCIuLlwiKSB8fCBwYXRoLnN0YXJ0c1dpdGgoXCIub2JzaWRpYW4vXCIpIHx8IHBhdGggPT09IFwiLm9ic2lkaWFuXCIgfHwgcGF0aC5zdGFydHNXaXRoKFwiLmdpdC9cIikgfHwgcGF0aCA9PT0gXCIuZ2l0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBsb29tLW91dHB1dC1maWxlIHBhdGg6ICR7cmF3UGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZVZhdWx0UGFyZW50Rm9sZGVyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZvbGRlciA9IGRpcm5hbWUocGF0aCk7XG4gICAgaWYgKCFmb2xkZXIgfHwgZm9sZGVyID09PSBcIi5cIikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgZm9sZGVyLnNwbGl0KFwiL1wiKS5maWx0ZXIoQm9vbGVhbikpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50ID8gYCR7Y3VycmVudH0vJHtwYXJ0fWAgOiBwYXJ0O1xuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoY3VycmVudCkpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIubWtkaXIoY3VycmVudCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJPdXRwdXRGaWxlVGV4dChyZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0sIHRhcmdldDogbG9vbU91dHB1dEZpbGVUYXJnZXQpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNlY3Rpb25zID0gdGFyZ2V0LnN0cmVhbXMuZmxhdE1hcCgoc3RyZWFtKSA9PiB7XG4gICAgICBzd2l0Y2ggKHN0cmVhbSkge1xuICAgICAgICBjYXNlIFwibWV0YWRhdGFcIjpcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgYHJ1bm5lcj0ke3Jlc3VsdC5ydW5uZXJOYW1lfWAsXG4gICAgICAgICAgICBgZXhpdD0ke3Jlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gLFxuICAgICAgICAgICAgYGR1cmF0aW9uPSR7cmVzdWx0LmR1cmF0aW9uTXN9bXNgLFxuICAgICAgICAgICAgYHRpbWVzdGFtcD0ke3Jlc3VsdC5maW5pc2hlZEF0fWAsXG4gICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xuICAgICAgICBjYXNlIFwic3Rkb3V0XCI6XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC5zdGRvdXQgPyBbcmVzdWx0LnN0ZG91dF0gOiBbXTtcbiAgICAgICAgY2FzZSBcIndhcm5pbmdcIjpcbiAgICAgICAgICByZXR1cm4gcmVzdWx0Lndhcm5pbmcgPyBbcmVzdWx0Lndhcm5pbmddIDogW107XG4gICAgICAgIGNhc2UgXCJzdGRlcnJcIjpcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LnN0ZGVyciA/IFtyZXN1bHQuc3RkZXJyXSA6IFtdO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBgJHtzZWN0aW9ucy5qb2luKFwiXFxuXFxuXCIpLnJlcGxhY2UoL1xccyokLywgXCJcIil9XFxuYDtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyT3V0cHV0RmlsZUpzb24oZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0sIHRhcmdldDogbG9vbU91dHB1dEZpbGVUYXJnZXQpOiBzdHJpbmcge1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBub3RlOiBmaWxlLnBhdGgsXG4gICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgIHJ1bm5lcjogcmVzdWx0LnJ1bm5lck5hbWUsXG4gICAgICBleGl0Q29kZTogcmVzdWx0LmV4aXRDb2RlLFxuICAgICAgc3VjY2VzczogcmVzdWx0LnN1Y2Nlc3MsXG4gICAgICBkdXJhdGlvbk1zOiByZXN1bHQuZHVyYXRpb25NcyxcbiAgICAgIHN0YXJ0ZWRBdDogcmVzdWx0LnN0YXJ0ZWRBdCxcbiAgICAgIGZpbmlzaGVkQXQ6IHJlc3VsdC5maW5pc2hlZEF0LFxuICAgICAgc3RyZWFtczoge1xuICAgICAgICAuLi4odGFyZ2V0LnN0cmVhbXMuaW5jbHVkZXMoXCJzdGRvdXRcIikgPyB7IHN0ZG91dDogcmVzdWx0LnN0ZG91dCB9IDoge30pLFxuICAgICAgICAuLi4odGFyZ2V0LnN0cmVhbXMuaW5jbHVkZXMoXCJ3YXJuaW5nXCIpID8geyB3YXJuaW5nOiByZXN1bHQud2FybmluZyA/PyBcIlwiIH0gOiB7fSksXG4gICAgICAgIC4uLih0YXJnZXQuc3RyZWFtcy5pbmNsdWRlcyhcInN0ZGVyclwiKSA/IHsgc3RkZXJyOiByZXN1bHQuc3RkZXJyIH0gOiB7fSksXG4gICAgICB9LFxuICAgIH07XG4gICAgcmV0dXJuIGAke0pTT04uc3RyaW5naWZ5KHBheWxvYWQsIG51bGwsIDIpfVxcbmA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbW92ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlUGF0aDogc3RyaW5nLCBibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCByYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuICAgICAgbGluZXMuc3BsaWNlKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQgLSByYW5nZS5zdGFydCArIDEpO1xuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9ja0lkOiBzdHJpbmcsIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBib2R5ID0gW1xuICAgICAgYHJ1bm5lcj0ke3Jlc3VsdC5ydW5uZXJOYW1lfWAsXG4gICAgICBgZXhpdD0ke3Jlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gLFxuICAgICAgYGR1cmF0aW9uPSR7cmVzdWx0LmR1cmF0aW9uTXN9bXNgLFxuICAgICAgYHRpbWVzdGFtcD0ke3Jlc3VsdC5maW5pc2hlZEF0fWAsXG4gICAgICByZXN1bHQuc3Rkb3V0ID8gYHN0ZG91dDpcXG4ke3Jlc3VsdC5zdGRvdXR9YCA6IFwiXCIsXG4gICAgICByZXN1bHQud2FybmluZyA/IGB3YXJuaW5nOlxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IFwiXCIsXG4gICAgICByZXN1bHQuc3RkZXJyID8gYHN0ZGVycjpcXG4ke3Jlc3VsdC5zdGRlcnJ9YCA6IFwiXCIsXG4gICAgXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICByZXR1cm4gW1xuICAgICAgYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gLFxuICAgICAgXCJgYGB0ZXh0XCIsXG4gICAgICBib2R5LFxuICAgICAgXCJgYGBcIixcbiAgICAgIFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lczogc3RyaW5nW10sIGJsb2NrSWQ6IHN0cmluZyk6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICAgIGNvbnN0IHN0YXJ0TWFya2VyID0gYDwhLS0gbG9vbTpvdXRwdXQ6c3RhcnQgaWQ9JHtibG9ja0lkfSAtLT5gO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGlmIChsaW5lc1tpXS50cmltKCkgIT09IHN0YXJ0TWFya2VyKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgICBpZiAobGluZXNbal0udHJpbSgpID09PSBcIjwhLS0gbG9vbTpvdXRwdXQ6ZW5kIC0tPlwiKSB7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGksIGVuZDogaiB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgc2hvdWxkUmVuZGVyU3RkaW5QYW5lbChibG9jazogbG9vbUNvZGVCbG9jayk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnN0ZGluUGFuZWxzLmhhcyhibG9jay5pZCkgfHwgdGhpcy5oYXNFbmFibGVkU3RkaW5BdHRyaWJ1dGUoYmxvY2spO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNFbmFibGVkU3RkaW5BdHRyaWJ1dGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBib29sZWFuIHtcbiAgICBjb25zdCBpbnB1dCA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLWlucHV0XCJdID8/IGJsb2NrLmF0dHJpYnV0ZXMuaW5wdXQ7XG4gICAgaWYgKGlucHV0ICYmICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhpbnB1dC50cmltKCkudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW5cIl0gIT0gbnVsbCB8fFxuICAgICAgYmxvY2suYXR0cmlidXRlcy5zdGRpbiAhPSBudWxsIHx8XG4gICAgICBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpbi1maWxlXCJdICE9IG51bGwgfHxcbiAgICAgIGJsb2NrLmF0dHJpYnV0ZXNbXCJzdGRpbi1maWxlXCJdICE9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVN0ZGluUGFuZWwoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1zdGRpbi1wYW5lbFwiO1xuXG4gICAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3RkaW4taGVhZGVyXCIgfSk7XG4gICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcInN0ZGluXCIgfSk7XG4gICAgY29uc3QgYWN0aW9ucyA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zdGRpbi1hY3Rpb25zXCIgfSk7XG4gICAgY29uc3QgcnVuQnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiUnVuXCIgfSk7XG4gICAgY29uc3QgY2xlYXJCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDbGVhclwiIH0pO1xuXG4gICAgY29uc3QgdGV4dGFyZWEgPSBwYW5lbC5jcmVhdGVFbChcInRleHRhcmVhXCIsIHsgY2xzOiBcImxvb20tc3RkaW4taW5wdXRcIiB9KTtcbiAgICB0ZXh0YXJlYS5wbGFjZWhvbGRlciA9IHRoaXMuZ2V0U3RkaW5QbGFjZWhvbGRlcihibG9jayk7XG4gICAgdGV4dGFyZWEudmFsdWUgPSB0aGlzLnN0ZGluSW5wdXRzLmdldChibG9jay5pZCkgPz8gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW5cIl0gPz8gYmxvY2suYXR0cmlidXRlcy5zdGRpbiA/PyBcIlwiO1xuICAgIHRleHRhcmVhLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnN0ZGluSW5wdXRzLnNldChibG9jay5pZCwgdGV4dGFyZWEudmFsdWUpO1xuICAgIH0pO1xuICAgIHJ1bkJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLnN0ZGluSW5wdXRzLnNldChibG9jay5pZCwgdGV4dGFyZWEudmFsdWUpO1xuICAgICAgdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCk7XG4gICAgfSk7XG4gICAgY2xlYXJCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGV4dGFyZWEudmFsdWUgPSBcIlwiO1xuICAgICAgdGhpcy5zdGRpbklucHV0cy5zZXQoYmxvY2suaWQsIFwiXCIpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHBhbmVsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTdGRpblBsYWNlaG9sZGVyKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogc3RyaW5nIHtcbiAgICBjb25zdCBzdGRpbkZpbGUgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpbi1maWxlXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJzdGRpbi1maWxlXCJdO1xuICAgIHJldHVybiBzdGRpbkZpbGUgPyBgc3RkaW4gZmlsZTogJHtzdGRpbkZpbGV9YCA6IFwic3RhbmRhcmQgaW5wdXQgZm9yIHRoaXMgYmxvY2tcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUJsb2NrU3RkaW4oZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAodGhpcy5zdGRpbklucHV0cy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICByZXR1cm4gdGhpcy5zdGRpbklucHV0cy5nZXQoYmxvY2suaWQpO1xuICAgIH1cblxuICAgIGNvbnN0IGlubGluZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXMuc3RkaW47XG4gICAgaWYgKGlubGluZSAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gZGVjb2RlRXNjYXBlZEF0dHJpYnV0ZShpbmxpbmUpO1xuICAgIH1cblxuICAgIGNvbnN0IHN0ZGluRmlsZSA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluLWZpbGVcIl0gPz8gYmxvY2suYXR0cmlidXRlc1tcInN0ZGluLWZpbGVcIl07XG4gICAgaWYgKCFzdGRpbkZpbGU/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBzdGRpblBhdGggPSB0aGlzLnJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGUsIHN0ZGluRmlsZSk7XG4gICAgY29uc3QgaW5wdXRGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHN0ZGluUGF0aCk7XG4gICAgaWYgKCEoaW5wdXRGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHN0ZGluIGZpbGUgbm90IGZvdW5kOiAke3N0ZGluUGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoaW5wdXRGaWxlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZWNvZGVFc2NhcGVkQXR0cmlidXRlKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvXFxcXG4vZywgXCJcXG5cIikucmVwbGFjZSgvXFxcXHQvZywgXCJcXHRcIik7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgZmFsbGJhY2s6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+IDBcbiAgICA/IE1hdGguZmxvb3IodmFsdWUpXG4gICAgOiBmYWxsYmFjaztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBmYWxsYmFjazogbnVtYmVyLCBtYXg6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPCAwKSB7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG4gIHJldHVybiBNYXRoLm1pbihNYXRoLmZsb29yKHZhbHVlKSwgbWF4KTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nU2V0dGluZyh2YWx1ZTogdW5rbm93biwgZmFsbGJhY2s6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZSA6IGZhbGxiYWNrO1xufVxuIiwgImltcG9ydCB7IE5vdGljZSwgdHlwZSBBcHAsIHR5cGUgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgb3BlblN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4sIG5vcm1hbGl6ZSBhcyBub3JtYWxpemVGc1BhdGgsIHBvc2l4IGFzIHBvc2l4UGF0aCB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBsb29tQ29udGFpbmVyUnVudGltZSA9IFwiZG9ja2VyXCIgfCBcInBvZG1hblwiIHwgXCJxZW11XCIgfCBcIndzbFwiIHwgXCJjdXN0b21cIjtcblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIGV4dGVuc2lvbj86IHN0cmluZztcbiAgdXNlRGVmYXVsdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBwb3NpdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xuICBzc2hUYXJnZXQ6IHN0cmluZztcbiAgcmVtb3RlV29ya3NwYWNlOiBzdHJpbmc7XG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIHNzaEFyZ3M/OiBzdHJpbmc7XG4gIHN0YXJ0Q29tbWFuZD86IHN0cmluZztcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xuICB0ZWFyZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgbWFuYWdlcj86IGxvb21RZW11TWFuYWdlckNvbmZpZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11TWFuYWdlckNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICBpbWFnZUZvcm1hdD86IHN0cmluZztcbiAgcGlkRmlsZT86IHN0cmluZztcbiAgbG9nRmlsZT86IHN0cmluZztcbiAgcmVhZGluZXNzVGltZW91dE1zPzogbnVtYmVyO1xuICByZWFkaW5lc3NJbnRlcnZhbE1zPzogbnVtYmVyO1xuICBib290RGVsYXlNcz86IG51bWJlcjtcbiAgc2h1dGRvd25Db21tYW5kPzogc3RyaW5nO1xuICBzaHV0ZG93blRpbWVvdXRNcz86IG51bWJlcjtcbiAga2lsbFNpZ25hbD86IE5vZGVKUy5TaWduYWxzO1xuICBwZXJzaXN0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Xc2xDb25maWcge1xuICBpbnRlcmFjdGl2ZT86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyQ29uZmlnIHtcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICB3c2w/OiBsb29tV3NsQ29uZmlnO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gIGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gIGFjdGlvbjogXCJidWlsZFwiIHwgXCJydW5cIiB8IFwidGVhcmRvd25cIjtcbiAgZ3JvdXBOYW1lOiBzdHJpbmc7XG4gIGdyb3VwUGF0aDogc3RyaW5nO1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGJ1aWxkPzogc3RyaW5nO1xuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xuICB0ZWFyZG93bj86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBzdHJpbmc7XG4gIGxhbmd1YWdlQWxpYXM/OiBzdHJpbmc7XG4gIGZpbGVOYW1lPzogc3RyaW5nO1xuICBmaWxlUGF0aD86IHN0cmluZztcbiAgY29tbWFuZD86IHN0cmluZztcbiAgc3RkaW4/OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBjb25maWc6IHtcbiAgICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICAgIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBsb29tQ29udGFpbmVyUnVubmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsdEltYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgKSB7IH1cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihjb250YWluZXJzUGF0aCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgIGVudHJpZXNcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmlzRGlyZWN0b3J5KCkpXG4gICAgICAgIC5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XG4gICAgICAgICAgY29uc3QgaGFzQ29uZmlnID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKSk7XG4gICAgICAgICAgY29uc3QgaGFzRG9ja2VyZmlsZSA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSk7XG4gICAgICAgICAgaWYgKCFoYXNDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJtaXNzaW5nIGNvbmZpZy5qc29uXCIsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBwaWVjZXMgPSBbYHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YF07XG4gICAgICAgICAgICBpZiAoKGNvbmZpZy5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiKSAmJiBoYXNEb2NrZXJmaWxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKFwiRG9ja2VyZmlsZVwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/LnNzaFRhcmdldCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgc3NoOiAke2NvbmZpZy5xZW11LnNzaFRhcmdldH1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/Lm1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYG1hbmFnZXI6ICR7YXdhaXQgdGhpcy5nZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGgsIGNvbmZpZy5xZW11Lm1hbmFnZXIpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHdyYXBwZXI6ICR7Y29uZmlnLmN1c3RvbS5leGVjdXRhYmxlfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcbiAgICAgICAgICAgIHBpZWNlcy5wdXNoKGAke2xhbmd1YWdlQ291bnR9IGxhbmd1YWdlJHtsYW5ndWFnZUNvdW50ID09PSAxID8gXCJcIiA6IFwic1wifWApO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBwaWVjZXMuam9pbihcIiwgXCIpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb25maWdMYW5nID0gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZV0gPz8gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZUFsaWFzXTtcblxuICAgIGxldCBpc0ZhbGxiYWNrID0gZmFsc2U7XG4gICAgbGV0IGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsID0gbnVsbDtcblxuICAgIGlmIChjb25maWdMYW5nKSB7XG4gICAgICBpZiAoY29uZmlnTGFuZy51c2VEZWZhdWx0KSB7XG4gICAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsYW5ndWFnZSA9IGNvbmZpZ0xhbmc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICBpc0ZhbGxiYWNrID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlIHx8ICFsYW5ndWFnZS5jb21tYW5kIHx8ICFsYW5ndWFnZS5leHRlbnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGdyb3VwICR7Z3JvdXBOYW1lfSBoYXMgbm8gY29tbWFuZCBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIGNvbnN0IHRlbXBGaWxlTmFtZSA9IGB0ZW1wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0ke25vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24pfWA7XG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xuICAgICAgbGV0IHJlc3VsdDogbG9vbVJ1blJlc3VsdDtcbiAgICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5PY2lDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGJsb2NrLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCB0ZW1wRmlsZVBhdGgsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Xc2xDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNGYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmYWxsYmFja01zZyA9IGBbTG9vbV0gTGFuZ3VhZ2UgJyR7YmxvY2subGFuZ3VhZ2V9JyB3YXMgbm90IGRlY2xhcmVkIGluIGNvbnRhaW5lciBncm91cC4gUnVubmluZyB1c2luZyBkZWZhdWx0IGNvbW1hbmQ6ICR7bGFuZ3VhZ2UuY29tbWFuZH1gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7cmVzdWx0Lndhcm5pbmd9XFxuJHtmYWxsYmFja01zZ31gIDogZmFsbGJhY2tNc2c7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybSh0ZW1wRmlsZVBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2w6YnVpbGRgLFxuICAgICAgICAgIGBXU0wgJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgICBgV1NMIGVudmlyb25tZW50ICR7Y29uZmlnLmltYWdlIHx8IFwiKGRlZmF1bHQpXCJ9IGRvZXMgbm90IHJlcXVpcmUgYSBidWlsZCBzdGVwLlxcbmAsXG4gICAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PY2lDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpKTtcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXG4gICAgICAgIFwicnVuXCIsXG4gICAgICAgIFwiLS1ybVwiLFxuICAgICAgICAuLi4oY29udGV4dC5zdGRpbiAhPSBudWxsID8gW1wiLWlcIl0gOiBbXSksXG4gICAgICAgIFwiLXZcIixcbiAgICAgICAgYCR7Z3JvdXBQYXRofTovd29ya3NwYWNlYCxcbiAgICAgICAgXCItd1wiLFxuICAgICAgICBcIi93b3Jrc3BhY2VcIixcbiAgICAgICAgaW1hZ2UsXG4gICAgICAgIC4uLmNvbW1hbmQsXG4gICAgICBdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUWVtdShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChxZW11LnN0YXJ0Q29tbWFuZCwgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6c3RhcnRgLCBgUUVNVSAke2dyb3VwTmFtZX0gc3RhcnRgKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZU1hbmFnZWRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6aGVhbHRoYCwgYFFFTVUgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlbW90ZUZpbGUgPSBwb3NpeFBhdGguam9pbihxZW11LnJlbW90ZVdvcmtzcGFjZSwgdGVtcEZpbGVOYW1lKTtcbiAgICAgIGNvbnN0IHJlbW90ZUNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHNoZWxsUXVvdGUocmVtb3RlRmlsZSkpO1xuICAgICAgaWYgKCFyZW1vdGVDb21tYW5kLnRyaW0oKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11YCxcbiAgICAgICAgcnVubmVyTmFtZTogYFFFTVUgJHtncm91cE5hbWV9YCxcbiAgICAgICAgZXhlY3V0YWJsZTogcWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwic3NoXCIsXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICAuLi5zcGxpdENvbW1hbmRMaW5lKHFlbXUuc3NoQXJncyB8fCBcIlwiKSxcbiAgICAgICAgICBxZW11LnNzaFRhcmdldCxcbiAgICAgICAgICBgY2QgJHtzaGVsbFF1b3RlKHFlbXUucmVtb3RlV29ya3NwYWNlKX0gJiYgJHtyZW1vdGVDb21tYW5kfWAsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS50ZWFyZG93bkNvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnRlYXJkb3duYCwgYFFFTVUgJHtncm91cE5hbWV9IHRlYXJkb3duYCk7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIHRlbXBGaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIGNvbmZpZyxcbiAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInJ1blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgIGNvbW1hbmQsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSksXG4gICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICk7XG5cbiAgICBpZiAoY29uZmlnLmN1c3RvbT8udGVhcmRvd24pIHtcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgICBncm91cE5hbWUsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJ0ZWFyZG93blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgICBjb21tYW5kLFxuICAgICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICAgKTtcbiAgICAgIGlmICghdGVhcmRvd24uc3VjY2Vzcykge1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Xc2xDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHdzbEdyb3VwUGF0aCA9IHRoaXMudHJhbnNsYXRlVG9Xc2xQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBpZiAoIWNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXU0wgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc2hlbGxGbGFncyA9IGNvbmZpZy53c2w/LmludGVyYWN0aXZlID8gW1wiLWlcIiwgXCItbFwiLCBcIi1jXCJdIDogW1wiLWxcIiwgXCItY1wiXTtcbiAgICBjb25zdCB3c2xBcmdzID0gW1wiYmFzaFwiLCAuLi5zaGVsbEZsYWdzLCBgY2QgXCIke3dzbEdyb3VwUGF0aC5yZXBsYWNlQWxsKCdcIicsICdcXFxcXCInKX1cIiAmJiAke2NvbW1hbmR9YF07XG4gICAgaWYgKGNvbmZpZy5pbWFnZT8udHJpbSgpKSB7XG4gICAgICB3c2xBcmdzLnVuc2hpZnQoXCItZFwiLCBjb25maWcuaW1hZ2UudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsYCxcbiAgICAgIHJ1bm5lck5hbWU6IGBXU0wgJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IFwid3NsXCIsXG4gICAgICBhcmdzOiB3c2xBcmdzLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdHJhbnNsYXRlVG9Xc2xQYXRoKHdpbmRvd3NQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1hdGNoID0gd2luZG93c1BhdGgubWF0Y2goL14oW0EtWmEtel0pOlxcXFwoLiopLyk7XG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBkcml2ZSA9IG1hdGNoWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCByZXN0ID0gbWF0Y2hbMl0ucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgICByZXR1cm4gYC9tbnQvJHtkcml2ZX0vJHtyZXN0fWA7XG4gICAgfVxuICAgIGlmICh3aW5kb3dzUGF0aC5pbmNsdWRlcyhcIlxcXFxcIikpIHtcbiAgICAgIHJldHVybiB3aW5kb3dzUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICB9XG4gICAgcmV0dXJuIHdpbmRvd3NQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZG9ja2VyZmlsZSA9IGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIik7XG4gICAgaWYgKCFleGlzdHNTeW5jKGRvY2tlcmZpbGUpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwiO1xuICAgIH1cblxuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7dGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpfToke2ltYWdlfWA7XG4gICAgaWYgKHRoaXMuYnVpbHRJbWFnZXMuaGFzKGNhY2hlS2V5KSkge1xuICAgICAgcmV0dXJuIGltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRleHQuc2lnbmFsKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9IGJ1aWxkIGZhaWxlZCBmb3IgJHtncm91cE5hbWV9LmApO1xuICAgIH1cblxuICAgIHRoaXMuYnVpbHRJbWFnZXMuYWRkKGNhY2hlS2V5KTtcbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGlmICghZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICAgIGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgIGBObyBEb2NrZXJmaWxlIGNvbmZpZ3VyZWQuIFVzaW5nIGltYWdlICR7Y29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwifS5cXG5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXCJidWlsZFwiLCBcIi10XCIsIGltYWdlLCBncm91cFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBpZiAoIXFlbXUuYnVpbGRDb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCwgXCJObyBRRU1VIGJ1aWxkIGNvbW1hbmQgY29uZmlndXJlZC5cXG5cIik7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bkNvbW1hbmRMaW5lKHFlbXUuYnVpbGRDb21tYW5kLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRDb25maWcoZ3JvdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGxvb21Db250YWluZXJDb25maWc+IHtcbiAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIik7XG4gICAgbGV0IHJhdzogdW5rbm93bjtcbiAgICB0cnkge1xuICAgICAgcmF3ID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShjb25maWdQYXRoLCBcInV0ZjhcIikpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byByZWFkIGNvbnRhaW5lciBjb25maWcgJHtjb25maWdQYXRofTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSByYXcgYXMge1xuICAgICAgcnVudGltZT86IHVua25vd247XG4gICAgICBleGVjdXRhYmxlPzogdW5rbm93bjtcbiAgICAgIGltYWdlPzogdW5rbm93bjtcbiAgICAgIHdzbD86IHVua25vd247XG4gICAgICBoZWFsdGhDaGVjaz86IHVua25vd247XG4gICAgICBxZW11PzogdW5rbm93bjtcbiAgICAgIGN1c3RvbT86IHVua25vd247XG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xuICAgIH07XG4gICAgY29uc3QgcnVudGltZSA9IHRoaXMucmVhZFJ1bnRpbWUoZGF0YS5ydW50aW1lKTtcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBleGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGltYWdlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBsYW5ndWFnZXMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2xhbmd1YWdlLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YS5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93bjsgdXNlRGVmYXVsdD86IHVua25vd24gfTtcbiAgICAgIGNvbnN0IHVzZURlZmF1bHQgPSBsYW5ndWFnZUNvbmZpZy51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICBpZiAoIXVzZURlZmF1bHQgJiYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBkZWZpbmUgY29tbWFuZCBvciB1c2VEZWZhdWx0LmApO1xuICAgICAgfVxuXG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgOiB1bmRlZmluZWQsXG4gICAgICAgIGV4dGVuc2lvbjogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA6IHVzZURlZmF1bHQgPyB1bmRlZmluZWQgOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgICAgdXNlRGVmYXVsdDogdXNlRGVmYXVsdCB8fCB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBydW50aW1lLFxuICAgICAgZXhlY3V0YWJsZTogdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSA9PT0gXCJzdHJpbmdcIiAmJiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpID8gZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICB3c2w6IHRoaXMucmVhZFdzbENvbmZpZyhkYXRhLndzbCksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGhlYWx0aENoZWNrXCIpLFxuICAgICAgcWVtdTogdGhpcy5yZWFkUWVtdUNvbmZpZyhkYXRhLnFlbXUpLFxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxuICAgICAgbGFuZ3VhZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRSdW50aW1lKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lclJ1bnRpbWUge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gXCJkb2NrZXJcIjtcbiAgICB9XG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIiB8fCB2YWx1ZSA9PT0gXCJ3c2xcIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgY3VzdG9tLCBvciB3c2wuXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkV3NsQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVdzbENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHdzbCBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyB7IGludGVyYWN0aXZlPzogdW5rbm93biB9O1xuICAgIHJldHVybiB7XG4gICAgICBpbnRlcmFjdGl2ZTogZGF0YS5pbnRlcmFjdGl2ZSA9PT0gdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21RZW11Q29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuc3NoVGFyZ2V0ICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnNzaFRhcmdldC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5zc2hUYXJnZXQgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgZGF0YS5yZW1vdGVXb3Jrc3BhY2UgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnJlbW90ZVdvcmtzcGFjZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3NoVGFyZ2V0OiBkYXRhLnNzaFRhcmdldC50cmltKCksXG4gICAgICByZW1vdGVXb3Jrc3BhY2U6IGRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSxcbiAgICAgIHNzaEV4ZWN1dGFibGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3NoRXhlY3V0YWJsZSksXG4gICAgICBzc2hBcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEFyZ3MpLFxuICAgICAgc3RhcnRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnN0YXJ0Q29tbWFuZCksXG4gICAgICBidWlsZENvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGRDb21tYW5kKSxcbiAgICAgIHRlYXJkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93bkNvbW1hbmQpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LmhlYWx0aENoZWNrXCIpLFxuICAgICAgbWFuYWdlcjogdGhpcy5yZWFkUWVtdU1hbmFnZXJDb25maWcoZGF0YS5tYW5hZ2VyKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdU1hbmFnZXJDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdU1hbmFnZXJDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IGRhdGEuZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICBleGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmV4ZWN1dGFibGUpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGltYWdlOiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlKSxcbiAgICAgIGltYWdlRm9ybWF0OiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlRm9ybWF0KSxcbiAgICAgIHBpZEZpbGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEucGlkRmlsZSksXG4gICAgICBsb2dGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmxvZ0ZpbGUpLFxuICAgICAgcmVhZGluZXNzVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc1RpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXNcIiksXG4gICAgICByZWFkaW5lc3NJbnRlcnZhbE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc0ludGVydmFsTXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNc1wiKSxcbiAgICAgIGJvb3REZWxheU1zOiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcihkYXRhLmJvb3REZWxheU1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLmJvb3REZWxheU1zXCIpLFxuICAgICAgc2h1dGRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnNodXRkb3duQ29tbWFuZCksXG4gICAgICBzaHV0ZG93blRpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5zaHV0ZG93blRpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5zaHV0ZG93blRpbWVvdXRNc1wiKSxcbiAgICAgIGtpbGxTaWduYWw6IG9wdGlvbmFsU2lnbmFsKGRhdGEua2lsbFNpZ25hbCwgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5raWxsU2lnbmFsXCIpLFxuICAgICAgcGVyc2lzdDogdHlwZW9mIGRhdGEucGVyc2lzdCA9PT0gXCJib29sZWFuXCIgPyBkYXRhLnBlcnNpc3QgOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEN1c3RvbUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5leGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZXhlY3V0YWJsZTogZGF0YS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBidWlsZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZCksXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBvcHRpb25hbFN0cmluZyhkYXRhLmNvbW1hbmRTdHJ1Y3R1cmUpLFxuICAgICAgdGVhcmRvd246IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd24pLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uaGVhbHRoQ2hlY2tcIiksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEhlYWx0aENoZWNrKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0uY29tbWFuZCBtdXN0IGJlIGEgc3RyaW5nLmApO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgY29tbWFuZDogZGF0YS5jb21tYW5kLnRyaW0oKSxcbiAgICAgIHBvc2l0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEucG9zaXRpdmVSZXNwb25zZSA/PyBkYXRhLnBvc2l0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJwb3NpdGl2ZSByZXNwb25zZVwiXSA/PyBkYXRhLnBvc3NpdGl2ZVJlc3BvbnNlKSxcbiAgICAgIG5lZ2F0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEubmVnYXRpdmVSZXNwb25zZSA/PyBkYXRhLm5lZ2F0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJuZWdhdGl2ZSByZXNwb25zZVwiXSksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZVFlbXVDb25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbVFlbXVDb25maWcge1xuICAgIGlmICghY29uZmlnLnFlbXUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgcnVudGltZSByZXF1aXJlcyBhIHFlbXUgY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucWVtdTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcuY3VzdG9tKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBhIGN1c3RvbSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5jdXN0b207XG4gIH1cblxuICBwcml2YXRlIHJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IHN0cmluZyB7XG4gICAgaWYgKGNvbmZpZy5leGVjdXRhYmxlPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBjb25maWcuZXhlY3V0YWJsZS50cmltKCk7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIiA/IFwicG9kbWFuXCIgOiBcImRvY2tlclwiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5IZWFsdGhDaGVjayhcbiAgICBoZWFsdGhDaGVjazogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFoZWFsdGhDaGVjaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoaGVhbHRoQ2hlY2suY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBjb25zdCBjb21iaW5lZE91dHB1dCA9IGAke3Jlc3VsdC5zdGRvdXR9XFxuJHtyZXN1bHQuc3RkZXJyfWA7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UgJiYgY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSByZXR1cm5lZCBuZWdhdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSAmJiAhY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBkaWQgbm90IHJldHVybiBwb3NpdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT3B0aW9uYWxDb21tYW5kKFxuICAgIGNvbW1hbmQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShjb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Db21tYW5kTGluZShcbiAgICBjb21tYW5kOiBzdHJpbmcsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHBhcnRzID0gc3BsaXRDb21tYW5kTGluZShjb21tYW5kKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGNvbW1hbmQgaXMgZW1wdHkuYCk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHBhcnRzWzBdLFxuICAgICAgYXJnczogcGFydHMuc2xpY2UoMSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBleGlzdGluZ1BpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKGV4aXN0aW5nUGlkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhleGlzdGluZ1BpZCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nUGlkKSB7XG4gICAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtYW5hZ2VyLmV4ZWN1dGFibGUgfHwgXCJxZW11LXN5c3RlbS14ODZfNjRcIjtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGgsIG1hbmFnZXIpO1xuICAgIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gbmVlZHMgcWVtdS5tYW5hZ2VyLmFyZ3Mgb3IgcWVtdS5tYW5hZ2VyLmltYWdlLmApO1xuICAgIH1cblxuICAgIGNvbnN0IGxvZ1BhdGggPSBtYW5hZ2VyLmxvZ0ZpbGUgPyB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5sb2dGaWxlKSA6IG51bGw7XG4gICAgY29uc3QgbG9nRmQgPSBsb2dQYXRoID8gb3BlblN5bmMobG9nUGF0aCwgXCJhXCIpIDogbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICAgIGN3ZDogZ3JvdXBQYXRoLFxuICAgICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiXSxcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsICgpID0+IHVuZGVmaW5lZCk7XG4gICAgICBjaGlsZC51bnJlZigpO1xuXG4gICAgICBpZiAoIWNoaWxkLnBpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IGRpZCBub3QgcmV0dXJuIGEgcHJvY2VzcyBpZC5gKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHBpZFBhdGgsIGAke2NoaWxkLnBpZH1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAobG9nRmQgIT0gbnVsbCkge1xuICAgICAgICBjbG9zZVN5bmMobG9nRmQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShtYW5hZ2VyLmFyZ3MgfHwgXCJcIik7XG4gICAgaWYgKG1hbmFnZXIuaW1hZ2UpIHtcbiAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmltYWdlKTtcbiAgICAgIGFyZ3MucHVzaChcIi1kcml2ZVwiLCBgZmlsZT0ke2ltYWdlUGF0aH0saWY9dmlydGlvLGZvcm1hdD0ke21hbmFnZXIuaW1hZ2VGb3JtYXQgfHwgXCJxY293MlwifWApO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIHFlbXU6IGxvb21RZW11Q29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFxZW11LmhlYWx0aENoZWNrKSB7XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwobWFuYWdlci5ib290RGVsYXlNcyA/PyAwLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVvdXQgPSBNYXRoLm1pbihtYW5hZ2VyLnJlYWRpbmVzc1RpbWVvdXRNcyA/PyA2MF8wMDAsIE1hdGgubWF4KHRpbWVvdXRNcywgMSkpO1xuICAgIGNvbnN0IGludGVydmFsID0gbWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zID8/IDFfMDAwO1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgbGV0IGxhc3RFcnJvciA9IFwiXCI7XG5cbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0KSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3Mgd2FpdCBjYW5jZWxsZWQuYCk7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBNYXRoLm1pbihpbnRlcnZhbCwgdGltZW91dCksIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpyZWFkeWAsIGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3MgY2hlY2tgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoaW50ZXJ2YWwsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSBkaWQgbm90IGJlY29tZSByZWFkeSB3aXRoaW4gJHt0aW1lb3V0fSBtcyR7bGFzdEVycm9yID8gYDogJHtsYXN0RXJyb3J9YCA6IFwiLlwifWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkIHx8IG1hbmFnZXIucGVyc2lzdCAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWFuYWdlci5zaHV0ZG93bkNvbW1hbmQpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKFxuICAgICAgICBtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBNYXRoLm1pbihtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IHRpbWVvdXRNcywgdGltZW91dE1zKSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnNodXRkb3duYCxcbiAgICAgICAgYFFFTVUgJHtncm91cE5hbWV9IHNodXRkb3duYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgbWFuYWdlci5raWxsU2lnbmFsIHx8IFwiU0lHVEVSTVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdG9wcGVkID0gYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCBtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IDEwXzAwMCwgc2lnbmFsKTtcbiAgICBpZiAoIXN0b3BwZWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIFwiU0lHS0lMTFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgMl8wMDAsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm4gXCJzdG9wcGVkXCI7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSA/IGBydW5uaW5nIHBpZCAke3BpZH1gIDogYHN0YWxlIHBpZCAke3BpZH1gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkUGlkRmlsZShwaWRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSAoYXdhaXQgcmVhZEZpbGUocGlkUGF0aCwgXCJ1dGY4XCIpKS50cmltKCk7XG4gICAgICBjb25zdCBwaWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBpZCkgJiYgcGlkID4gMCA/IHBpZCA6IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUHJvY2Vzc1J1bm5pbmcocGlkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICB0cnkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgMCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JQcm9jZXNzRXhpdChwaWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXRNcykge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoMjUwLCBzaWduYWwpO1xuICAgIH1cbiAgICByZXR1cm4gIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b21XcmFwcGVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICByZXF1ZXN0OiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3QsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY3VzdG9tID0gdGhpcy5yZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjdXN0b20uaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbTpoZWFsdGhgLCBgQ3VzdG9tICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIGNvbnN0IHJlcXVlc3RGaWxlTmFtZSA9IGByZXF1ZXN0XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0uanNvbmA7XG4gICAgY29uc3QgcmVxdWVzdFBhdGggPSBqb2luKGdyb3VwUGF0aCwgcmVxdWVzdEZpbGVOYW1lKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RQYXRoLCBgJHtKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKX1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShjdXN0b20uYXJncyB8fCBcIntyZXF1ZXN0fVwiKS5tYXAoKGFyZykgPT5cbiAgICAgICAgYXJnXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgcmVxdWVzdFBhdGgpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXB9XCIsIGdyb3VwTmFtZSlcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cFBhdGh9XCIsIGdyb3VwUGF0aCksXG4gICAgICApO1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOiR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgcnVubmVyTmFtZTogYEN1c3RvbSAke2dyb3VwTmFtZX0gJHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBleGVjdXRhYmxlOiBjdXN0b20uZXhlY3V0YWJsZSxcbiAgICAgICAgYXJncyxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybShyZXF1ZXN0UGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUN1c3RvbVJlcXVlc3QoXG4gICAgYWN0aW9uOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3RbXCJhY3Rpb25cIl0sXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIGV4dHJhOiBQYXJ0aWFsPGxvb21DdXN0b21SdW50aW1lUmVxdWVzdD4gPSB7fSxcbiAgKTogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uLFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgcnVudGltZTogY29uZmlnLnJ1bnRpbWUsXG4gICAgICBpbWFnZTogY29uZmlnLmltYWdlLFxuICAgICAgYnVpbGQ6IGNvbmZpZy5jdXN0b20/LmJ1aWxkLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogY29uZmlnLmN1c3RvbT8uY29tbWFuZFN0cnVjdHVyZSxcbiAgICAgIHRlYXJkb3duOiBjb25maWcuY3VzdG9tPy50ZWFyZG93bixcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIGNvbmZpZzoge1xuICAgICAgICBleGVjdXRhYmxlOiBjb25maWcuZXhlY3V0YWJsZSxcbiAgICAgICAgY3VzdG9tOiBjb25maWcuY3VzdG9tLFxuICAgICAgICBxZW11OiBjb25maWcucWVtdSxcbiAgICAgICAgaGVhbHRoQ2hlY2s6IGNvbmZpZy5oZWFsdGhDaGVjayxcbiAgICAgIH0sXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTeW50aGV0aWNSZXN1bHQocnVubmVySWQ6IHN0cmluZywgcnVubmVyTmFtZTogc3RyaW5nLCBzdGRvdXQ6IHN0cmluZywgc3VjY2VzcyA9IHRydWUpOiBsb29tUnVuUmVzdWx0IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgZmluaXNoZWRBdDogbm93LFxuICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgIGV4aXRDb2RlOiBzdWNjZXNzID8gMCA6IC0xLFxuICAgICAgc3Rkb3V0LFxuICAgICAgc3RkZXJyOiBcIlwiLFxuICAgICAgc3VjY2VzcyxcbiAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q29udGFpbmVyc1BhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAodGhpcy5hcHAudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVOYW1lID0gYmFzZW5hbWUoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIXNhZmVOYW1lIHx8IHNhZmVOYW1lICE9PSBncm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbih0aGlzLmdldENvbnRhaW5lcnNQYXRoKCksIHNhZmVOYW1lKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aDogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChqb2luKGdyb3VwUGF0aCwgZmlsZVBhdGgpKTtcbiAgICBjb25zdCBub3JtYWxpemVkR3JvdXBQYXRoID0gbm9ybWFsaXplRnNQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgcG9zaXhTYWZlUGF0aCA9IHNhZmVQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIGNvbnN0IHBvc2l4R3JvdXBQYXRoID0gbm9ybWFsaXplZEdyb3VwUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBpZiAocG9zaXhTYWZlUGF0aCAhPT0gcG9zaXhHcm91cFBhdGggJiYgIXBvc2l4U2FmZVBhdGguc3RhcnRzV2l0aChgJHtwb3NpeEdyb3VwUGF0aH0vYCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBRRU1VIG1hbmFnZXIgcGF0aCBvdXRzaWRlIGNvbnRhaW5lciBncm91cDogJHtmaWxlUGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHNhZmVQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBsb29tLWNvbnRhaW5lci0ke2dyb3VwTmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy4tXS9nLCBcIi1cIil9YDtcbiAgfVxuXG4gIHB1YmxpYyBnZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ0lkOiBzdHJpbmcsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsIHtcbiAgICBpZiAoIWxhbmdJZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmdJZC50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblxuICAgIC8vIENoZWNrIGN1c3RvbSBsYW5ndWFnZXMgZmlyc3RcbiAgICBjb25zdCBjdXN0b20gPSBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgoYykgPT4ge1xuICAgICAgY29uc3QgbmFtZXMgPSBbYy5uYW1lLCAuLi5jLmFsaWFzZXMuc3BsaXQoXCIsXCIpLm1hcCgocykgPT4gcy50cmltKCkpXS5tYXAoKG4pID0+IG4udG9Mb3dlckNhc2UoKSk7XG4gICAgICByZXR1cm4gbmFtZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKGN1c3RvbSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZDogYCR7Y3VzdG9tLmV4ZWN1dGFibGV9ICR7Y3VzdG9tLmFyZ3N9YC50cmltKCksXG4gICAgICAgIGV4dGVuc2lvbjogY3VzdG9tLmV4dGVuc2lvbiB8fCBcIi50eHRcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU3RhbmRhcmQgYnVpbHQtaW5zXG4gICAgc3dpdGNoIChub3JtYWxpemVkKSB7XG4gICAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICBjYXNlIFwicHlcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgICAgY2FzZSBcImpzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwibm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICBjYXNlIFwidHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwidHMtbm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcInNoZWxsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogXCJzaCB7ZmlsZX1cIixcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNoXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiYmFzaFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNoZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJiYXNoXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zaFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1YnlcIjpcbiAgICAgIGNhc2UgXCJyYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1YnlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJiXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGVybFwiOlxuICAgICAgY2FzZSBcInBsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGVybEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGVybFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsdWFcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImx1YVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubHVhXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGhwXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGhwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJwaHBcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBocFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImdvXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuZ29FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdvXCJ9IHJ1biB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuZ29cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICBjYXNlIFwiaHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJydW5naGNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmhzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIGNhc2UgXCJtbFwiOlxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcImR1bmVcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZHVuZVwifSBleGVjIC0tIG9jYW1sIHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcIm9jYW1sY1wiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxjXCJ9IC1vIC90bXAvbG9vbS1vY2FtbCBcIiQxXCIgJiYgL3RtcC9sb29tLW9jYW1sYCksXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdjY1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLWMgJiYgL3RtcC9sb29tLWNgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIGNhc2UgXCJjKytcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnKytcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jcHAgJiYgL3RtcC9sb29tLWNwcGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuY3BwXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiZWJwZlwiOlxuICAgICAgY2FzZSBcImVicGYtY1wiOlxuICAgICAgY2FzZSBcImJwZlwiOlxuICAgICAgY2FzZSBcImJwZi1jXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpIHx8IFwiY2xhbmdcIn0gLXRhcmdldCBicGYgLU8yIC1nIC1XYWxsIFwiJDFcIiAtYyAtbyAvdG1wL2xvb20tZWJwZi5vICYmIHByaW50ZiAnY29tcGlsZWQgL3RtcC9sb29tLWVicGYub1xcXFxuJ2ApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuYnBmLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJicGZ0cmFjZVwiOlxuICAgICAgY2FzZSBcImJ0XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGBpZiAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtLWhlbHAgMj4mMSB8IGdyZXAgLXEgLS0gJy0tZHJ5LXJ1bic7IHRoZW4gJHtzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYnBmdHJhY2VcIn0gLS1kcnktcnVuIFwiJDFcIjsgZWxzZSAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtZCBcIiQxXCI7IGZpYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5idFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1c3RcIjpcbiAgICAgIGNhc2UgXCJyc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydXN0Y1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLXJ1c3QgJiYgL3RtcC9sb29tLXJ1c3RgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YVwiOiB7XG4gICAgICAgIGNvbnN0IGNvbXBpbGVyID0gc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhY1wiO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgdG1wPS90bXAvbG9vbS1qYXZhLSQkICYmIG1rZGlyIC1wIFwiJHRtcFwiICYmIGNwIFwiJDFcIiBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtjb21waWxlcn0gXCIkdG1wL01haW4uamF2YVwiICYmICR7c2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YVwifSAtY3AgXCIkdG1wXCIgTWFpbmApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuamF2YVwiLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIGNhc2UgXCJsbHZtXCI6XG4gICAgICBjYXNlIFwibGxcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxsaVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsZWFuXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGVhblwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNvcVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiY29xY1wifSAtcSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInNtdGxpYlwiOlxuICAgICAgY2FzZSBcInNtdFwiOlxuICAgICAgY2FzZSBcInNtdC1saWJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInozXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNoIC1sYyAke3F1b3RlQ29tbWFuZEFyZyhjb21tYW5kKX0gc2gge2ZpbGV9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTaWduYWwodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBOb2RlSlMuU2lnbmFscyB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgc2lnbmFsIG5hbWUgbGlrZSBTSUdURVJNLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZHVyYXRpb25NcyA8PSAwIHx8IHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAocnVudGltZSkge1xuICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xuICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgIHJldHVybiBcIlBvZG1hblwiO1xuICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICByZXR1cm4gXCJRRU1VXCI7XG4gICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XG4gICAgY2FzZSBcIndzbFwiOlxuICAgICAgcmV0dXJuIFwiV1NMXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG5cbmZ1bmN0aW9uIHF1b3RlQ29tbWFuZEFyZyh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XG4gIHJ1bm5lcklkOiBzdHJpbmc7XG4gIHJ1bm5lck5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgc3RkaW4/OiBzdHJpbmc7XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlU3BlYyBleHRlbmRzIGxvb21Qcm9jZXNzU3BlYyB7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VIYW5kbGUge1xuICB0ZW1wRGlyOiBzdHJpbmc7XG4gIHRlbXBGaWxlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZU5hbWU6IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tXCIpKTtcbiAgY29uc3QgdGVtcEZpbGUgPSBqb2luKHRlbXBEaXIsIGZpbGVOYW1lKTtcblxuICB0cnkge1xuICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZSwgbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2UpLCBcInV0ZjhcIik7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHsgdGVtcERpciwgdGVtcEZpbGUgfSk7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVFeHRlbnNpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoYHNuaXBwZXQke2ZpbGVFeHRlbnNpb259YCwgc291cmNlLCBjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgY29uc3Qgbm9uRW1wdHlMaW5lcyA9IGxpbmVzLmZpbHRlcigobGluZSkgPT4gbGluZS50cmltKCkubGVuZ3RoID4gMCk7XG4gIGlmICghbm9uRW1wdHlMaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgbGV0IHNoYXJlZEluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKG5vbkVtcHR5TGluZXNbMF0pO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygbm9uRW1wdHlMaW5lcy5zbGljZSgxKSkge1xuICAgIHNoYXJlZEluZGVudCA9IHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgoc2hhcmVkSW5kZW50LCBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKSk7XG4gICAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICAgIHJldHVybiBzb3VyY2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgcmV0dXJuIGxpbmVzXG4gICAgLm1hcCgobGluZSkgPT4gKGxpbmUudHJpbSgpLmxlbmd0aCA9PT0gMCA/IGxpbmUgOiBsaW5lLnN0YXJ0c1dpdGgoc2hhcmVkSW5kZW50KSA/IGxpbmUuc2xpY2Uoc2hhcmVkSW5kZW50Lmxlbmd0aCkgOiBsaW5lKSlcbiAgICAuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGxlZnQubGVuZ3RoICYmIGluZGV4IDwgcmlnaHQubGVuZ3RoICYmIGxlZnRbaW5kZXhdID09PSByaWdodFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG4gIHJldHVybiBsZWZ0LnNsaWNlKDAsIGluZGV4KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blByb2Nlc3Moc3BlYzogbG9vbVByb2Nlc3NTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGxldCBzdGRvdXQgPSBcIlwiO1xuICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVkT3V0ID0gZmFsc2U7XG4gIGxldCBjYW5jZWxsZWQgPSBmYWxzZTtcbiAgbGV0IGNoaWxkOiBSZXR1cm5UeXBlPHR5cGVvZiBzcGF3bj4gfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVvdXRIYW5kbGU6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIGxldCBhYm9ydEhhbmRsZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGQgPSBzcGF3bihzcGVjLmV4ZWN1dGFibGUsIHNwZWMuYXJncywge1xuICAgICAgICBjd2Q6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgc2hlbGw6IGZhbHNlLFxuICAgICAgICBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAuLi5zcGVjLmVudixcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY2hpbGQuc3RkaW4/Lm9uKFwiZXJyb3JcIiwgKGVycm9yOiBOb2RlSlMuRXJybm9FeGNlcHRpb24pID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFwiRVBJUEVcIikge1xuICAgICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKHNwZWMuc3RkaW4gIT0gbnVsbCkge1xuICAgICAgICBjaGlsZC5zdGRpbj8uZW5kKHNwZWMuc3RkaW4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2hpbGQuc3RkaW4/LmRlc3Ryb3koKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgc3RkaW46IHNwZWMuc3RkaW4sXG4gICAgICBlbnY6IGV4cGFuZFRlbXBsYXRlZEVudihzcGVjLmVudiwgdGVtcEZpbGUsIHRlbXBEaXIpLFxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBleHBhbmRUZW1wbGF0ZWRFbnYoZW52OiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCwgdGVtcEZpbGU6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQge1xuICBpZiAoIWVudikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGVudikubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgIGtleSxcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcbiAgICBdKSxcbiAgKTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gc3BsaXRDb21tYW5kTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICBsZXQgcXVvdGU6IFwiJ1wiIHwgXCJcXFwiXCIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGVzY2FwaW5nID0gZmFsc2U7XG5cbiAgZm9yIChjb25zdCBjaGFyIG9mIGlucHV0LnRyaW0oKSkge1xuICAgIGlmIChlc2NhcGluZykge1xuICAgICAgY3VycmVudCArPSBjaGFyO1xuICAgICAgZXNjYXBpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBcIlxcXFxcIikge1xuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKChjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcIlxcXCJcIikgJiYgIXF1b3RlKSB7XG4gICAgICBxdW90ZSA9IGNoYXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGNoYXIpICYmICFxdW90ZSkge1xuICAgICAgaWYgKGN1cnJlbnQpIHtcbiAgICAgICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9IFwiXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjdXJyZW50ICs9IGNoYXI7XG4gIH1cblxuICBpZiAoY3VycmVudCkge1xuICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG4iLCAiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTm90ZUV4ZWN1dGlvbkNvbnRleHQge1xuICBjb250YWluZXJHcm91cD86IHN0cmluZztcbiAgZGlzYWJsZUNvbnRhaW5lcj86IGJvb2xlYW47XG4gIHdvcmtpbmdEaXJlY3Rvcnk/OiBzdHJpbmc7XG4gIHRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFeGVjdXRpb25Db250ZXh0KFxuICBhcHA6IEFwcCxcbiAgZmlsZTogVEZpbGUsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuKTogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IG5vdGUgPSByZWFkTm90ZUV4ZWN1dGlvbkNvbnRleHQoYXBwLCBmaWxlKTtcbiAgY29uc3QgZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkgPSByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZSwgc2V0dGluZ3MpO1xuICBjb25zdCBub3RlV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3Rvcnkobm90ZS53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3QgYmxvY2tXb3JraW5nRGlyZWN0b3J5ID0gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeShibG9jay5leGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnkpO1xuICBjb25zdCBub3RlVGltZW91dCA9IG5vdGUudGltZW91dE1zO1xuICBjb25zdCBibG9ja1RpbWVvdXQgPSBibG9jay5leGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcztcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiByZXNvbHZlQ29udGFpbmVyR3JvdXAoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBibG9ja1dvcmtpbmdEaXJlY3RvcnkgPz8gbm90ZVdvcmtpbmdEaXJlY3RvcnkgPz8gZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zOiBibG9ja1RpbWVvdXQgPz8gbm90ZVRpbWVvdXQgPz8gc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICBzb3VyY2U6IHtcbiAgICAgIGNvbnRhaW5lcjogcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShzZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAsIG5vdGUsIGJsb2NrLmV4ZWN1dGlvbkNvbnRleHQpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8gXCJibG9ja1wiIDogbm90ZVdvcmtpbmdEaXJlY3RvcnkgPyBcIm5vdGVcIiA6IHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpID8gXCJnbG9iYWxcIiA6IFwiZGVmYXVsdFwiLFxuICAgICAgdGltZW91dDogYmxvY2tUaW1lb3V0ID8gXCJibG9ja1wiIDogbm90ZVRpbWVvdXQgPyBcIm5vdGVcIiA6IFwiZ2xvYmFsXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lckdyb3VwKFxuICBnbG9iYWxDb250YWluZXI6IHN0cmluZyxcbiAgbm90ZTogTm90ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGJsb2NrOiBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLFxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAobm90ZS5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vdGUuY29udGFpbmVyR3JvdXAudHJpbSgpO1xuICB9XG4gIHJldHVybiBnbG9iYWxDb250YWluZXIudHJpbSgpIHx8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHRbXCJzb3VyY2VcIl1bXCJjb250YWluZXJcIl0ge1xuICBpZiAoYmxvY2suZGlzYWJsZUNvbnRhaW5lciB8fCBibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIFwiYmxvY2tcIjtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyIHx8IG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcIm5vdGVcIjtcbiAgfVxuICBpZiAoZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSkge1xuICAgIHJldHVybiBcImdsb2JhbFwiO1xuICB9XG4gIHJldHVybiBcIm5vbmVcIjtcbn1cblxuZnVuY3Rpb24gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcDogQXBwLCBmaWxlOiBURmlsZSk6IE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBhcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICBpZiAoIWZyb250bWF0dGVyKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY29udGFpbmVyID0gZnJvbnRtYXR0ZXJbXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGZyb250bWF0dGVyW1wibG9vbS1jd2RcIl0gPz8gZnJvbnRtYXR0ZXJbXCJsb29tLXdvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0ID0gZnJvbnRtYXR0ZXJbXCJsb29tLXRpbWVvdXRcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogdHlwZW9mIGNvbnRhaW5lciA9PT0gXCJzdHJpbmdcIiAmJiAhaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgPyBjb250YWluZXIudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiB0eXBlb2Ygd29ya2luZ0RpcmVjdG9yeSA9PT0gXCJzdHJpbmdcIiA/IHdvcmtpbmdEaXJlY3RvcnkgOiB1bmRlZmluZWQsXG4gICAgdGltZW91dE1zOiB0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dCkgJiYgdGltZW91dCA+IDBcbiAgICAgID8gTWF0aC50cnVuYyh0aW1lb3V0KVxuICAgICAgOiB0eXBlb2YgdGltZW91dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHRpbWVvdXQpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZTogVEZpbGUsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBpZiAoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSk7XG4gIH1cblxuICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAoZmlsZS52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgY29uc3QgZmlsZUZvbGRlciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZURlZmluaXRpb24ge1xuICBpZDogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgYWxpYXNlczogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUxhbmd1YWdlUGFja2FnZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGxhbmd1YWdlczogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdO1xufVxuXG5leHBvcnQgY29uc3QgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVM6IGxvb21MYW5ndWFnZVBhY2thZ2VbXSA9IFtcbiAge1xuICAgIGlkOiBcImludGVycHJldGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSW50ZXJwcmV0ZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJTY3JpcHQgYW5kIFJFUEwtb3JpZW50ZWQgbGFuZ3VhZ2VzIGZvciBvcGVyYXRpb25hbCBub3RlcyBhbmQgcXVpY2sgZXhwZXJpbWVudHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInB5dGhvblwiLCBkaXNwbGF5TmFtZTogXCJQeXRob25cIiwgYWxpYXNlczogW1wicHl0aG9uXCIsIFwicHlcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YXNjcmlwdFwiLCBkaXNwbGF5TmFtZTogXCJKYXZhU2NyaXB0XCIsIGFsaWFzZXM6IFtcImphdmFzY3JpcHRcIiwgXCJqc1wiXSB9LFxuICAgICAgeyBpZDogXCJ0eXBlc2NyaXB0XCIsIGRpc3BsYXlOYW1lOiBcIlR5cGVTY3JpcHRcIiwgYWxpYXNlczogW1widHlwZXNjcmlwdFwiLCBcInRzXCJdIH0sXG4gICAgICB7IGlkOiBcInNoZWxsXCIsIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsIGFsaWFzZXM6IFtcInNoZWxsXCIsIFwic2hcIiwgXCJiYXNoXCIsIFwienNoXCJdIH0sXG4gICAgICB7IGlkOiBcInJ1YnlcIiwgZGlzcGxheU5hbWU6IFwiUnVieVwiLCBhbGlhc2VzOiBbXCJydWJ5XCIsIFwicmJcIl0gfSxcbiAgICAgIHsgaWQ6IFwicGVybFwiLCBkaXNwbGF5TmFtZTogXCJQZXJsXCIsIGFsaWFzZXM6IFtcInBlcmxcIiwgXCJwbFwiXSB9LFxuICAgICAgeyBpZDogXCJsdWFcIiwgZGlzcGxheU5hbWU6IFwiTHVhXCIsIGFsaWFzZXM6IFtcImx1YVwiXSB9LFxuICAgICAgeyBpZDogXCJwaHBcIiwgZGlzcGxheU5hbWU6IFwiUEhQXCIsIGFsaWFzZXM6IFtcInBocFwiXSB9LFxuICAgICAgeyBpZDogXCJnb1wiLCBkaXNwbGF5TmFtZTogXCJHb1wiLCBhbGlhc2VzOiBbXCJnb1wiLCBcImdvbGFuZ1wiXSB9LFxuICAgICAgeyBpZDogXCJoYXNrZWxsXCIsIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIiwgYWxpYXNlczogW1wiaGFza2VsbFwiLCBcImhzXCJdIH0sXG4gICAgICB7IGlkOiBcIm9jYW1sXCIsIGRpc3BsYXlOYW1lOiBcIk9DYW1sXCIsIGFsaWFzZXM6IFtcIm9jYW1sXCIsIFwibWxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibmF0aXZlLWNvbXBpbGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTmF0aXZlIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiTGFuZ3VhZ2VzIGNvbXBpbGVkIGludG8gbmF0aXZlIGJpbmFyaWVzIGJ5IGxvY2FsIHRvb2xjaGFpbnMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImNcIiwgZGlzcGxheU5hbWU6IFwiQ1wiLCBhbGlhc2VzOiBbXCJjXCIsIFwiaFwiXSB9LFxuICAgICAgeyBpZDogXCJjcHBcIiwgZGlzcGxheU5hbWU6IFwiQysrXCIsIGFsaWFzZXM6IFtcImNwcFwiLCBcImN4eFwiLCBcImNjXCIsIFwiYysrXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm1hbmFnZWQtY29tcGlsZWRcIixcbiAgICBkaXNwbGF5TmFtZTogXCJNYW5hZ2VkIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiQ29tcGlsZWQgbGFuZ3VhZ2VzIHdpdGggbWFuYWdlZCBydW50aW1lcyBvciBzdHJ1Y3R1cmVkIGJ1aWxkL3J1biBwaGFzZXMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInJ1c3RcIiwgZGlzcGxheU5hbWU6IFwiUnVzdFwiLCBhbGlhc2VzOiBbXCJydXN0XCIsIFwicnNcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YVwiLCBkaXNwbGF5TmFtZTogXCJKYXZhXCIsIGFsaWFzZXM6IFtcImphdmFcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwicHJvb2ZzXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUHJvb2ZzXCIsXG4gICAgZGVzY3JpcHRpb246IFwiUHJvb2YgYXNzaXN0YW50cyBhbmQgc29sdmVyLW9yaWVudGVkIGxhbmd1YWdlcy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGVhblwiLCBkaXNwbGF5TmFtZTogXCJMZWFuXCIsIGFsaWFzZXM6IFtcImxlYW5cIiwgXCJsZWFuNFwiXSB9LFxuICAgICAgeyBpZDogXCJjb3FcIiwgZGlzcGxheU5hbWU6IFwiQ29xXCIsIGFsaWFzZXM6IFtcImNvcVwiLCBcInZcIl0gfSxcbiAgICAgIHsgaWQ6IFwic210bGliXCIsIGRpc3BsYXlOYW1lOiBcIlNNVC1MSUJcIiwgYWxpYXNlczogW1wic210XCIsIFwic210MlwiLCBcInNtdGxpYlwiLCBcInNtdC1saWJcIiwgXCJ6M1wiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJsbHZtXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTExWTVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkxMVk0gSVIgdG9vbGluZyBmb3IgY29tcGlsZXIgYW5kIFBMIHJlc2VhcmNoIHZhdWx0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGx2bS1pclwiLCBkaXNwbGF5TmFtZTogXCJMTFZNIElSXCIsIGFsaWFzZXM6IFtcImxsdm1cIiwgXCJsbHZtaXJcIiwgXCJsbHZtLWlyXCIsIFwibGxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwiZWJwZlwiLFxuICAgIGRpc3BsYXlOYW1lOiBcImVCUEZcIixcbiAgICBkZXNjcmlwdGlvbjogXCJLZXJuZWwgaW5zdHJ1bWVudGF0aW9uIGxhbmd1YWdlcyBmb3IgQlBGIG9iamVjdCBjb21waWxhdGlvbiwgdmVyaWZpZXIgY2hlY2tzLCBhbmQgYnBmdHJhY2Ugc2NyaXB0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwiZWJwZi1jXCIsIGRpc3BsYXlOYW1lOiBcImVCUEYgQ1wiLCBhbGlhc2VzOiBbXCJlYnBmXCIsIFwiZWJwZi1jXCIsIFwiYnBmLWNcIiwgXCJicGZcIl0gfSxcbiAgICAgIHsgaWQ6IFwiYnBmdHJhY2VcIiwgZGlzcGxheU5hbWU6IFwiYnBmdHJhY2VcIiwgYWxpYXNlczogW1wiYnBmdHJhY2VcIiwgXCJidFwiXSB9LFxuICAgIF0sXG4gIH0sXG5dO1xuXG5leHBvcnQgY29uc3QgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQgPSBcImN1c3RvbVwiO1xuZXhwb3J0IGNvbnN0IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTiA9IDI7XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFsuLi5CVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUy5tYXAoKHBhY2spID0+IHBhY2suaWQpLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRF07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKTogc3RyaW5nW10ge1xuICByZXR1cm4gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMubWFwKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogdm9pZCB7XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmxlbmd0aCkge1xuICAgIHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzID0gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzKSB8fCAhc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzID0gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk7XG4gIH1cbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbikpIHtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gMTtcbiAgfVxuICBpZiAoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA8IDIpIHtcbiAgICBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3MsIFwiZWJwZlwiKTtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gTEFOR1VBR0VfQ09ORklHVVJBVElPTl9WRVJTSU9OO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVuYWJsZUxhbmd1YWdlUGFja2FnZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBwYWNrYWdlSWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBwYWNrID0gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IHBhY2thZ2VJZCk7XG4gIGlmICghcGFjaykge1xuICAgIHJldHVybjtcbiAgfVxuICBhcHBlbmRVbmlxdWUoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIHBhY2suaWQpO1xuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRVbmlxdWUodmFsdWVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIXZhbHVlcy5pbmNsdWRlcyh2YWx1ZSkpIHtcbiAgICB2YWx1ZXMucHVzaCh2YWx1ZSk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uW10ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICBjb25zdCBlbmFibGVkUGFja3MgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzKTtcbiAgY29uc3QgZW5hYmxlZExhbmd1YWdlcyA9IG5ldyBTZXQoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyk7XG5cbiAgcmV0dXJuIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTXG4gICAgLmZpbHRlcigocGFjaykgPT4gZW5hYmxlZFBhY2tzLmhhcyhwYWNrLmlkKSlcbiAgICAuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMpXG4gICAgLmZpbHRlcigobGFuZ3VhZ2UpID0+IGVuYWJsZWRMYW5ndWFnZXMuaGFzKGxhbmd1YWdlLmlkKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VBbGlhc01hcChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUmVjb3JkPHN0cmluZywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZT4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5mbGF0TWFwKChsYW5ndWFnZSkgPT5cbiAgICAgIGxhbmd1YWdlLmFsaWFzZXMubWFwKChhbGlhcykgPT4gW2FsaWFzLnRvTG93ZXJDYXNlKCksIGxhbmd1YWdlLmlkXSBhcyBjb25zdCksXG4gICAgKSxcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQ6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgcmV0dXJuIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5zb21lKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQgPT09IGxhbmd1YWdlSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCk7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHsgYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZCwgZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAgfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IE9VVFBVVF9TVEFSVCA9IC9ePCEtLVxccypsb29tOm91dHB1dDpzdGFydFxccytpZD0oW2EtZjAtOV0rKVxccyotLT4kL2k7XG5jb25zdCBPVVRQVVRfRU5EID0gL148IS0tXFxzKmxvb206b3V0cHV0OmVuZFxccyotLT4kL2k7XG5jb25zdCBGRU5DRV9TVEFSVCA9IC9eKGBgYCt8fn5+KylcXHMqKFteXFxzYF0qKT8oLiopJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZShyYXdMYW5ndWFnZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHJhd0xhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmICghc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGlmIChhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKSkge1xuICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2Ygc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcbiAgICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XG4gICAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBhbGlhc2VzID0gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpO1xuICByZXR1cm4gYWxpYXNlc1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICBpZiAoIXNldHRpbmdzKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgY3VzdG9tQWxpYXNlcyA9IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3MpXG4gICAgPyAoc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4ge1xuICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgcmV0dXJuIFtuYW1lLCAuLi5wYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKV07XG4gICAgfSlcbiAgICA6IFtdO1xuXG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpKSxcbiAgICAuLi5jdXN0b21BbGlhc2VzLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGluZm9BdHRyaWJ1dGVzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IHNvdXJjZVJlZmVyZW5jZSA9IHBhcnNlU291cmNlUmVmZXJlbmNlKGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcGFyc2VFeGVjdXRpb25Db250ZXh0KGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCByZWZlcmVuY2VIYXNoID0gc291cmNlUmVmZXJlbmNlID8gYDoke0pTT04uc3RyaW5naWZ5KHNvdXJjZVJlZmVyZW5jZSl9YCA6IFwiXCI7XG4gICAgY29uc3QgZXhlY3V0aW9uSGFzaCA9IGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoZXhlY3V0aW9uQ29udGV4dCkgPyBgOiR7SlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uQ29udGV4dCl9YCA6IFwiXCI7XG4gICAgY29uc3QgYXR0cmlidXRlSGFzaCA9IE9iamVjdC5rZXlzKGluZm9BdHRyaWJ1dGVzKS5sZW5ndGggPyBgOiR7SlNPTi5zdHJpbmdpZnkoaW5mb0F0dHJpYnV0ZXMpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGAke2NvbnRlbnR9JHtyZWZlcmVuY2VIYXNofSR7ZXhlY3V0aW9uSGFzaH0ke2F0dHJpYnV0ZUhhc2h9YCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgYXR0cmlidXRlczogaW5mb0F0dHJpYnV0ZXMsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBleGVjdXRpb25Db250ZXh0LFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgcGFyc2VFeGVjdXRpb25Db250ZXh0Pik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihjb250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IGNvbnRleHQuZGlzYWJsZUNvbnRhaW5lciB8fCBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnkgfHwgY29udGV4dC50aW1lb3V0TXMpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU291cmNlUmVmZXJlbmNlKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb24gPSBhdHRyc1tcImxvb20tY2FsbFwiXSA/PyBhdHRycy5jYWxsO1xuICBjb25zdCBjYWxsQXJncyA9IGF0dHJzW1wibG9vbS1hcmdzXCJdID8/IGF0dHJzLmFyZ3M7XG4gIGNvbnN0IHByaW50VmFsdWUgPSBhdHRyc1tcImxvb20tcHJpbnRcIl0gPz8gYXR0cnMucHJpbnQ7XG4gIGNvbnN0IGNhbGwgPSBjYWxsRXhwcmVzc2lvbiAhPSBudWxsIHx8IGNhbGxBcmdzICE9IG51bGxcbiAgICA/IHtcbiAgICAgIGV4cHJlc3Npb246IG5vcm1hbGl6ZUJvb2xlYW5BdHRyaWJ1dGUoY2FsbEV4cHJlc3Npb24pID09PSBcInRydWVcIiA/IHVuZGVmaW5lZCA6IGNhbGxFeHByZXNzaW9uLFxuICAgICAgYXJnczogY2FsbEFyZ3MsXG4gICAgICBwcmludDogcHJpbnRWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhwcmludFZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIH1cbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gICAgY2FsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeGVjdXRpb25Db250ZXh0KGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGF0dHJzW1wibG9vbS1jb250YWluZXJcIl0gPz8gYXR0cnMuY29udGFpbmVyO1xuICBjb25zdCB0aW1lb3V0ID0gYXR0cnNbXCJsb29tLXRpbWVvdXRcIl0gPz8gYXR0cnMudGltZW91dDtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGF0dHJzW1wibG9vbS1jd2RcIl0gPz8gYXR0cnMuY3dkID8/IGF0dHJzW1wid29ya2luZy1kaXJlY3RvcnlcIl07XG4gIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KSA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiBjb250YWluZXIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IGNvbnRhaW5lciA/IGlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpIDogdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBvc2l0aXZlSW50ZWdlcih2YWx1ZTogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLnRyaW0oKSwgMTApO1xuICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwYXJzZWQpICYmIHBhcnNlZCA+IDAgPyBwYXJzZWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzRGlzYWJsZWRWYWx1ZSh2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiLCBcIm5vbmVcIiwgXCJuYXRpdmVcIl0uaW5jbHVkZXModmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUluZm9BdHRyaWJ1dGVzKGlucHV0OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcGF0dGVybiA9IC8oW0EtWmEtejAtOV8tXSspXFxzKj1cXHMqKD86XCIoW15cIl0qKVwifCcoW14nXSopJ3woW15cXHNdKykpL2c7XG4gIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgd2hpbGUgKChtYXRjaCA9IHBhdHRlcm4uZXhlYyhpbnB1dCkpICE9IG51bGwpIHtcbiAgICBhdHRyc1ttYXRjaFsxXS50b0xvd2VyQ2FzZSgpXSA9IG1hdGNoWzJdID8/IG1hdGNoWzNdID8/IG1hdGNoWzRdID8/IFwiXCI7XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVSYW5nZSh2YWx1ZTogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdmFsdWUudHJpbSgpLm1hdGNoKC9eTD8oXFxkKykoPzpcXHMqWy06XVxccypMPyhcXGQrKSk/JC9pKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IGVuZCA9IE51bWJlci5wYXJzZUludChtYXRjaFsyXSA/PyBtYXRjaFsxXSwgMTApO1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RhcnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGVuZCkgfHwgc3RhcnQgPD0gMCB8fCBlbmQgPCBzdGFydCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZUNhcGFiaWxpdHkge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIiB8IFwidG9wLWxldmVsXCIgfCBcImdlbmVyaWNcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIgfCBcInJhd1wiIHwgXCJleHRlcm5hbFwiO1xuICBzb3VyY2VQcmV2aWV3OiBib29sZWFuO1xufVxuXG5jb25zdCBCVUlMVF9JTl9DQVBBQklMSVRJRVM6IFJlY29yZDxzdHJpbmcsIGxvb21MYW5ndWFnZUNhcGFiaWxpdHk+ID0ge1xuICBweXRob246IHtcbiAgICBsYW5ndWFnZTogXCJweXRob25cIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImFzdFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcImphdmFzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgdHlwZXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcInR5cGVzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgYzoge1xuICAgIGxhbmd1YWdlOiBcImNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgY3BwOiB7XG4gICAgbGFuZ3VhZ2U6IFwiY3BwXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwibGx2bS1pclwiOiB7XG4gICAgbGFuZ3VhZ2U6IFwibGx2bS1pclwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgaGFza2VsbDoge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIG9jYW1sOiB7XG4gICAgbGFuZ3VhZ2U6IFwib2NhbWxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YToge1xuICAgIGxhbmd1YWdlOiBcImphdmFcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwiZWJwZi1jXCI6IHtcbiAgICBsYW5ndWFnZTogXCJlYnBmLWNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGJwZnRyYWNlOiB7XG4gICAgbGFuZ3VhZ2U6IFwiYnBmdHJhY2VcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImdlbmVyaWNcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJnZW5lcmljXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYW5ndWFnZUNhcGFiaWxpdHkobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGhhc0V4dGVybmFsRXh0cmFjdG9yID0gZmFsc2UpOiBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgaWYgKGhhc0V4dGVybmFsRXh0cmFjdG9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc3ltYm9sRXh0cmFjdGlvbjogXCJleHRlcm5hbFwiLFxuICAgICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZXh0ZXJuYWxcIixcbiAgICAgIGNhbGxIYXJuZXNzOiBcImV4dGVybmFsXCIsXG4gICAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gQlVJTFRfSU5fQ0FQQUJJTElUSUVTW2xhbmd1YWdlXSA/PyB7XG4gICAgbGFuZ3VhZ2UsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRCdWlsdEluTGFuZ3VhZ2VDYXBhYmlsaXRpZXMoKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eVtdIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoQlVJTFRfSU5fQ0FQQUJJTElUSUVTKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBgLiR7bmFtZX1gO1xuICB9XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIEludGVycHJldGVkU3BlYyB7XG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncykgPT4gc3RyaW5nO1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG4gIG1pbmltdW1UaW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmNvbnN0IElOVEVSUFJFVEVEX1NQRUNTOiBJbnRlcnByZXRlZFNwZWNbXSA9IFtcbiAge1xuICAgIGxhbmd1YWdlOiBcInNoZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiU2hlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zaFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicnVieVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnJiXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwZXJsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUGVybFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGxcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImx1YVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkx1YVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBocFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBIUFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImdvXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiR29cIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgIGFyZ3M6IFtcInJ1blwiLCBcIntmaWxlfVwiXSxcbiAgICBlbnY6IHtcbiAgICAgIEdPQ0FDSEU6IFwie3RlbXBEaXJ9L2dvY2FjaGVcIixcbiAgICB9LFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbl07XG5cbmV4cG9ydCBjbGFzcyBJbnRlcnByZXRlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkludGVycHJldGVkXCI7XG4gIGxhbmd1YWdlcyA9IElOVEVSUFJFVEVEX1NQRUNTLm1hcCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSk7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICBpZiAoIXNwZWMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxuICAgICAgYXJnczogc3BlYy5hcmdzID8/IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IHNwZWMuZmlsZUV4dGVuc2lvbixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNwZWMubWluaW11bVRpbWVvdXRNcyA/PyAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIGVudjogc3BlYy5lbnYsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNwZWMobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBJbnRlcnByZXRlZFNwZWMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBJTlRFUlBSRVRFRF9TUEVDUy5maW5kKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlID09PSBsYW5ndWFnZSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBFYnBmQ01vZGUgPSBcImNvbXBpbGVcIiB8IFwibG9hZFwiO1xudHlwZSBCcGZ0cmFjZU1vZGUgPSBcImNoZWNrXCIgfCBcInJ1blwiO1xuXG5leHBvcnQgY2xhc3MgRWJwZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiZWJwZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiZUJQRlwiO1xuICBsYW5ndWFnZXMgPSBbXCJlYnBmLWNcIiwgXCJicGZ0cmFjZVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiZWJwZi1jXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImJwZnRyYWNlXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImVicGYtY1wiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5FYnBmQyhibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiYnBmdHJhY2VcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuQnBmdHJhY2UoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBlQlBGIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5FYnBmQyhibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gcmVhZEVicGZDTW9kZShibG9jayk7XG4gICAgY29uc3QgY2ZsYWdzID0gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLWNmbGFnc1wiLCBcImVicGYtY2ZsYWdzXCIpLmZsYXRNYXAoc3BsaXRDb21tYW5kTGluZSk7XG4gICAgY29uc3QgaW5jbHVkZVBhdGhzID0gW1xuICAgICAgLi4uc3BsaXRDc3Yoc2V0dGluZ3MuZWJwZkluY2x1ZGVQYXRocyksXG4gICAgICAuLi5yZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtaW5jbHVkZXNcIiwgXCJlYnBmLWluY2x1ZGVzXCIpLFxuICAgIF07XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLmJwZi5jXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IG9iamVjdFBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5icGYub1wiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNsYW5nYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJlQlBGIGNsYW5nXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgXCItdGFyZ2V0XCIsXG4gICAgICAgICAgXCJicGZcIixcbiAgICAgICAgICBcIi1PMlwiLFxuICAgICAgICAgIFwiLWdcIixcbiAgICAgICAgICBcIi1XYWxsXCIsXG4gICAgICAgICAgLi4uaW5jbHVkZVBhdGhzLmZsYXRNYXAoKGluY2x1ZGVQYXRoKSA9PiBbXCItSVwiLCBpbmNsdWRlUGF0aF0pLFxuICAgICAgICAgIC4uLmNmbGFncyxcbiAgICAgICAgICBcIi1jXCIsXG4gICAgICAgICAgdGVtcEZpbGUsXG4gICAgICAgICAgXCItb1wiLFxuICAgICAgICAgIG9iamVjdFBhdGgsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgY29tcGlsZVJlc3VsdC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKGNvbXBpbGVSZXN1bHQuc3Rkb3V0LCBcIkNvbXBpbGVcIiwgYGVCUEYgb2JqZWN0IGNvbXBpbGVkIHN1Y2Nlc3NmdWxseTogJHtvYmplY3RQYXRofWApO1xuICAgICAgYXdhaXQgdGhpcy5hcHBlbmRPYmplY3RJbnNwZWN0aW9uKGNvbXBpbGVSZXN1bHQsIG9iamVjdFBhdGgsIGNvbnRleHQsIHNldHRpbmdzKTtcblxuICAgICAgaWYgKG1vZGUgPT09IFwiY29tcGlsZVwiKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5sb2FkRWJwZk9iamVjdChibG9jaywgb2JqZWN0UGF0aCwgY29udGV4dCwgc2V0dGluZ3MsIGNvbXBpbGVSZXN1bHQpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhcHBlbmRPYmplY3RJbnNwZWN0aW9uKHJlc3VsdDogbG9vbVJ1blJlc3VsdCwgb2JqZWN0UGF0aDogc3RyaW5nLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG9iamR1bXAgPSBzZXR0aW5ncy5lYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBpZiAoIW9iamR1bXApIHtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gYXBwZW5kTGluZShyZXN1bHQud2FybmluZywgXCJlQlBGIG9iamVjdCBpbnNwZWN0aW9uIHNraXBwZWQgYmVjYXVzZSBubyBvYmplY3QgaW5zcGVjdG9yIGlzIGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGluc3BlY3QgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvYmpkdW1wYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiZUJQRiBvYmplY3QgaW5zcGVjdGlvblwiLFxuICAgICAgZXhlY3V0YWJsZTogb2JqZHVtcCxcbiAgICAgIGFyZ3M6IFtcIi1oXCIsIG9iamVjdFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoaW5zcGVjdC5zdWNjZXNzKSB7XG4gICAgICByZXN1bHQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihyZXN1bHQuc3Rkb3V0LCBcIk9iamVjdCBzZWN0aW9uc1wiLCBpbnNwZWN0LnN0ZG91dC50cmltKCkgfHwgXCIobm8gc2VjdGlvbnMgcmVwb3J0ZWQpXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQud2FybmluZyA9IGFwcGVuZExpbmUocmVzdWx0Lndhcm5pbmcsIGBlQlBGIG9iamVjdCBpbnNwZWN0aW9uIGZhaWxlZDogJHtpbnNwZWN0LnN0ZGVyciB8fCBpbnNwZWN0LnN0ZG91dCB8fCBgZXhpdCAke2luc3BlY3QuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRFYnBmT2JqZWN0KFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIG9iamVjdFBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICAgIGNvbXBpbGVSZXN1bHQ6IGxvb21SdW5SZXN1bHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmICghc2V0dGluZ3MuZWJwZkFsbG93S2VybmVsTG9hZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImVCUEYga2VybmVsIGxvYWRpbmcgaXMgZGlzYWJsZWQuIEVuYWJsZSBBbGxvdyBlQlBGIGtlcm5lbCBsb2FkIGluIHNldHRpbmdzIGJlZm9yZSB1c2luZyBsb29tLWVicGYtbW9kZT1sb2FkLlwiKSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgcGluUGF0aCA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLXBpblwiLCBcImVicGYtcGluXCIpO1xuICAgIGlmICghcGluUGF0aCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY29tcGlsZVJlc3VsdCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgc3RkZXJyOiBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQuc3RkZXJyLCBcImxvb20tZWJwZi1tb2RlPWxvYWQgcmVxdWlyZXMgbG9vbS1lYnBmLXBpbj0vc3lzL2ZzL2JwZi88cGF0aD4uXCIpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2FkID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdG9vbDpsb2FkYCxcbiAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdG9vbCBlQlBGIGxvYWRcIixcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmVicGZCcGZ0b29sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0b29sXCIsXG4gICAgICBhcmdzOiBbXCItZFwiLCBcInByb2dcIiwgXCJsb2FkYWxsXCIsIG9iamVjdFBhdGgsIHBpblBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBsb2FkLnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRvdXQsIFwiYnBmdG9vbCBzdGRvdXRcIiwgbG9hZC5zdGRvdXQudHJpbSgpKTtcbiAgICBsb2FkLnN0ZGVyciA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwiYnBmdG9vbCBzdGRlcnJcIiwgbG9hZC5zdGRlcnIudHJpbSgpKTtcbiAgICBsb2FkLndhcm5pbmcgPSBhcHBlbmRMaW5lKGNvbXBpbGVSZXN1bHQud2FybmluZywgYGVCUEYgb2JqZWN0IGxvYWQgcmVxdWVzdGVkIHdpdGggcGluIHBhdGggJHtwaW5QYXRofS5gKTtcbiAgICByZXR1cm4gbG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQnBmdHJhY2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2spO1xuICAgIGNvbnN0IGV4dHJhQXJncyA9IHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tYnBmdHJhY2UtYXJnc1wiLCBcImJwZnRyYWNlLWFyZ3NcIikuZmxhdE1hcChzcGxpdENvbW1hbmRMaW5lKTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3MuYnBmdHJhY2VFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIuYnRcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgaWYgKG1vZGUgPT09IFwicnVuXCIpIHtcbiAgICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpicGZ0cmFjZToke21vZGV9YCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcImJwZnRyYWNlXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgICBhcmdzOiBbLi4uZXh0cmFBcmdzLCB0ZW1wRmlsZV0sXG4gICAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdHJhY2U6JHttb2RlfWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdHJhY2UgY2hlY2tcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiLS1kcnktcnVuXCIsIC4uLmV4dHJhQXJncywgdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFyZXN1bHQuc3VjY2VzcyAmJiBpc1Vuc3VwcG9ydGVkQnBmdHJhY2VEcnlSdW4ocmVzdWx0KSkge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmJwZnRyYWNlOiR7bW9kZX06bGVnYWN5LWRlYnVnYCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcImJwZnRyYWNlIGNoZWNrXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgICBhcmdzOiBbXCItZFwiLCAuLi5leHRyYUFyZ3MsIHRlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWFkRWJwZkNNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogRWJwZkNNb2RlIHtcbiAgY29uc3QgdmFsdWUgPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1tb2RlXCIsIFwiZWJwZi1tb2RlXCIpIHx8IFwiY29tcGlsZVwiO1xuICBpZiAodmFsdWUgPT09IFwiY29tcGlsZVwiIHx8IHZhbHVlID09PSBcImxvYWRcIikge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGVCUEYgbW9kZTogJHt2YWx1ZX0uIFVzZSBjb21waWxlIG9yIGxvYWQuYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBCcGZ0cmFjZU1vZGUge1xuICBjb25zdCB2YWx1ZSA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1icGZ0cmFjZS1tb2RlXCIsIFwiYnBmdHJhY2UtbW9kZVwiKSB8fCBcImNoZWNrXCI7XG4gIGlmICh2YWx1ZSA9PT0gXCJjaGVja1wiIHx8IHZhbHVlID09PSBcInJ1blwiKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYnBmdHJhY2UgbW9kZTogJHt2YWx1ZX0uIFVzZSBjaGVjayBvciBydW4uYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHByaW1hcnk6IHN0cmluZywgZmFsbGJhY2s6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBibG9jay5hdHRyaWJ1dGVzW3ByaW1hcnldPy50cmltKCkgfHwgYmxvY2suYXR0cmlidXRlc1tmYWxsYmFja10/LnRyaW0oKSB8fCB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBwcmltYXJ5OiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzcGxpdENzdihyZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBwcmltYXJ5LCBmYWxsYmFjaykgfHwgXCJcIik7XG59XG5cbmZ1bmN0aW9uIHNwbGl0Q3N2KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRMaW5lKGV4aXN0aW5nOiBzdHJpbmcgfCB1bmRlZmluZWQsIGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbZXhpc3RpbmcsIGxpbmVdLmZpbHRlcigocGFydCkgPT4gcGFydD8udHJpbSgpKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRTZWN0aW9uKGV4aXN0aW5nOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIGJvZHk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbnRlbnQgPSBib2R5LnRyaW0oKTtcbiAgaWYgKCFjb250ZW50KSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nO1xuICB9XG4gIHJldHVybiBbZXhpc3RpbmcudHJpbSgpLCBgJHt0aXRsZX06XFxuJHtjb250ZW50fWBdLmZpbHRlcihCb29sZWFuKS5qb2luKFwiXFxuXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBpc1Vuc3VwcG9ydGVkQnBmdHJhY2VEcnlSdW4ocmVzdWx0OiBsb29tUnVuUmVzdWx0KTogYm9vbGVhbiB7XG4gIGNvbnN0IG91dHB1dCA9IGAke3Jlc3VsdC5zdGRlcnJ9XFxuJHtyZXN1bHQuc3Rkb3V0fWAudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIChcbiAgICBvdXRwdXQuaW5jbHVkZXMoXCItLWRyeS1ydW5cIikgJiYgKG91dHB1dC5pbmNsdWRlcyhcInVucmVjb2duaXplZCBvcHRpb25cIikgfHwgb3V0cHV0LmluY2x1ZGVzKFwidW5rbm93biBvcHRpb25cIikgfHwgb3V0cHV0LmluY2x1ZGVzKFwiaW52YWxpZCBvcHRpb25cIikpXG4gICkgfHwgKFxuICAgIG91dHB1dC5pbmNsdWRlcyhcInVzYWdlOlwiKSAmJiAhb3V0cHV0LmluY2x1ZGVzKFwiLS1kcnktcnVuXCIpXG4gICk7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIExsdm1SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImxsdm0taXJcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkxMVk0gSVJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGx2bS1pclwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiICYmIEJvb2xlYW4oc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxsXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXN1bHQudGltZWRPdXQgJiYgIXJlc3VsdC5jYW5jZWxsZWQgJiYgcmVzdWx0LmV4aXRDb2RlICE9IG51bGwgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICBpZiAocmVzdWx0LmV4aXRDb2RlICE9PSAwKSB7XG4gICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgUHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LiBVbmRlciBsbGksIHRoYXQgYmVjb21lcyB0aGUgcHJvY2VzcyBleGl0IHN0YXR1cy5gO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRvdXQgPSByZXN1bHQuZXhpdENvZGUgPT09IDBcbiAgICAgICAgICA/IFwiTExWTSBwcm9ncmFtIGV4aXRlZCB3aXRoIGNvZGUgMC5cIlxuICAgICAgICAgIDogYExMVk0gcHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LlxcblVzZSBzdGRvdXQgaW4gdGhlIElSIGl0c2VsZiBpZiB5b3Ugd2FudCBwcmludGFibGUgcHJvZ3JhbSBvdXRwdXQuYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoTmFtZWRUZW1wU291cmNlRmlsZSwgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE1hbmFnZWRDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibWFuYWdlZC1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTWFuYWdlZCBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJydXN0XCIsIFwiamF2YVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1blJ1c3QoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5KYXZhKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUnVzdChibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLnJzXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSmF2YShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoXCJNYWluLmphdmFcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgaWYgKCFzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6c291cmNlYCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiB0ZW1wRGlyLFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIi1jcFwiLCB0ZW1wRGlyLCBcIk1haW5cIl0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5hdGl2ZUNvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJuYXRpdmUtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5hdGl2ZSBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJjXCIsIFwiY3BwXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNwcFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgOiBzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBmaWxlRXh0ZW5zaW9uID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCIuY1wiIDogXCIuY3BwXCI7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiQyAoR0NDKVwiIDogXCJDKysgKEcrKylcIjtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoZmlsZUV4dGVuc2lvbiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcywgcnVuVGVtcEZpbGVQcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgT2NhbWxSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm9jYW1sXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJPQ2FtbFwiO1xuICBsYW5ndWFnZXMgPSBbXCJvY2FtbFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwib2NhbWxcIiAmJiBCb29sZWFuKHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5vY2FtbE1vZGU7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCk7XG5cbiAgICBpZiAobW9kZSA9PT0gXCJvY2FtbFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChtb2RlID09PSBcImR1bmVcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpkdW5lYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJEdW5lIC8gT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiZXhlY1wiLCBcIi0tXCIsIFwib2NhbWxcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIubWxcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1jb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiLW9cIiwgYmluYXJ5UGF0aCwgdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtcnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFB5dGhvblJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHl0aG9uXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQeXRob25cIjtcbiAgbGFuZ3VhZ2VzID0gW1wicHl0aG9uXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBCb29sZWFuKHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIucHlcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9vZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHJvb2ZcIjtcbiAgZGlzcGxheU5hbWUgPSBcIlByb29mIGNoZWNrZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGVhblwiLCBcImNvcVwiLCBcInNtdGxpYlwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4ocmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06bGVhbmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiTGVhblwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y29xYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJDb3FcIixcbiAgICAgICAgZXhlY3V0YWJsZTogcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLFxuICAgICAgICBhcmdzOiBbXCItcVwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06c210bGliYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJTTVQtTElCIChaMylcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb29mIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBjb25zdCBjb25maWd1cmVkID0gc2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCk7XG4gIGlmIChjb25maWd1cmVkICYmIGNvbmZpZ3VyZWQgIT09IFwiY29xY1wiKSB7XG4gICAgcmV0dXJuIGNvbmZpZ3VyZWQ7XG4gIH1cblxuICBjb25zdCBvcGFtQ29xYyA9IGpvaW4ocHJvY2Vzcy5lbnYuSE9NRSA/PyBcIlwiLCBcIi5vcGFtXCIsIFwiZGVmYXVsdFwiLCBcImJpblwiLCBcImNvcWNcIik7XG4gIHJldHVybiBleGlzdHNTeW5jKG9wYW1Db3FjKSA/IG9wYW1Db3FjIDogY29uZmlndXJlZCB8fCBcImNvcWNcIjtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuaW1wb3J0IHsgYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZCwgaXNMYW5ndWFnZUVuYWJsZWQgfSBmcm9tIFwiLi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBydW5uZXJzOiBsb29tUnVubmVyW10pIHt9XG5cbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLmlzQmxvY2tMYW5ndWFnZUVuYWJsZWQoYmxvY2ssIHNldHRpbmdzKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bm5lcnMuZmluZCgocnVubmVyKSA9PiAoIXJ1bm5lci5sYW5ndWFnZXMubGVuZ3RoIHx8IHJ1bm5lci5sYW5ndWFnZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2UpKSAmJiBydW5uZXIuY2FuUnVuKGJsb2NrLCBzZXR0aW5ncykpID8/IG51bGw7XG4gIH1cblxuICBnZXRTdXBwb3J0ZWRMYW5ndWFnZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xuICB9XG5cbiAgcHJpdmF0ZSBpc0Jsb2NrTGFuZ3VhZ2VFbmFibGVkKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGlzTGFuZ3VhZ2VFbmFibGVkKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5ncykgJiYgc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNvbWUoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpIHx8IGFsaWFzZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2VBbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMsIGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMgfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBsb29tUGx1Z2luU2V0dGluZ3MgPSB7XG4gIGVuYWJsZUxvY2FsRXhlY3V0aW9uOiBmYWxzZSxcbiAgaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzazogZmFsc2UsXG4gIHByZXNlcnZlU291cmNlTW9kZTogdHJ1ZSxcbiAgZGVmYXVsdFRpbWVvdXRNczogODAwMCxcbiAgd29ya2luZ0RpcmVjdG9yeTogXCJcIixcbiAgcHl0aG9uRXhlY3V0YWJsZTogXCJweXRob24zXCIsXG4gIG5vZGVFeGVjdXRhYmxlOiBcIm5vZGVcIixcbiAgdHlwZXNjcmlwdE1vZGU6IFwidHMtbm9kZVwiLFxuICB0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGU6IFwidHMtbm9kZVwiLFxuICBvY2FtbE1vZGU6IFwib2NhbWxcIixcbiAgb2NhbWxFeGVjdXRhYmxlOiBcIm9jYW1sXCIsXG4gIGNFeGVjdXRhYmxlOiBcImdjY1wiLFxuICBjcHBFeGVjdXRhYmxlOiBcImcrK1wiLFxuICBzaGVsbEV4ZWN1dGFibGU6IFwiYmFzaFwiLFxuICBydWJ5RXhlY3V0YWJsZTogXCJydWJ5XCIsXG4gIHBlcmxFeGVjdXRhYmxlOiBcInBlcmxcIixcbiAgbHVhRXhlY3V0YWJsZTogXCJsdWFcIixcbiAgcGhwRXhlY3V0YWJsZTogXCJwaHBcIixcbiAgZ29FeGVjdXRhYmxlOiBcImdvXCIsXG4gIHJ1c3RFeGVjdXRhYmxlOiBcInJ1c3RjXCIsXG4gIGhhc2tlbGxFeGVjdXRhYmxlOiBcInJ1bmdoY1wiLFxuICBqYXZhQ29tcGlsZXJFeGVjdXRhYmxlOiBcIlwiLFxuICBqYXZhRXhlY3V0YWJsZTogXCJqYXZhXCIsXG4gIGxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGU6IFwibGxpXCIsXG4gIGVicGZDbGFuZ0V4ZWN1dGFibGU6IFwiY2xhbmdcIixcbiAgZWJwZkJwZnRvb2xFeGVjdXRhYmxlOiBcImJwZnRvb2xcIixcbiAgZWJwZkxsdm1PYmpkdW1wRXhlY3V0YWJsZTogXCJsbHZtLW9iamR1bXBcIixcbiAgZWJwZkluY2x1ZGVQYXRoczogXCJcIixcbiAgZWJwZkFsbG93S2VybmVsTG9hZDogZmFsc2UsXG4gIGJwZnRyYWNlRXhlY3V0YWJsZTogXCJicGZ0cmFjZVwiLFxuICBsZWFuRXhlY3V0YWJsZTogXCJsZWFuXCIsXG4gIGNvcUV4ZWN1dGFibGU6IFwiY29xY1wiLFxuICBzbXRFeGVjdXRhYmxlOiBcInozXCIsXG4gIHdyaXRlT3V0cHV0VG9Ob3RlOiBmYWxzZSxcbiAgb3V0cHV0VmlzaWJsZUxpbmVzOiAwLFxuICBhdXRvUnVuT25GaWxlT3BlbjogZmFsc2UsXG4gIGV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlOiBcImNvbGxhcHNlZFwiLFxuICBzaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGE6IHRydWUsXG4gIGxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb246IDIsXG4gIGVuYWJsZWRMYW5ndWFnZVBhY2tzOiBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCksXG4gIGVuYWJsZWRMYW5ndWFnZXM6IGdldERlZmF1bHRMYW5ndWFnZUlkcygpLFxuICBjdXN0b21MYW5ndWFnZXM6IFtdLFxuICBwZGZFeHBvcnRNb2RlOiBcImJvdGhcIixcbiAgZGVmYXVsdENvbnRhaW5lckdyb3VwOiBcIlwiLFxufTtcbiIsICJpbXBvcnQgeyBBcHAsIE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcsIG5vcm1hbGl6ZVBhdGggfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIGxvb21QbHVnaW4gZnJvbSBcIi4vbWFpblwiO1xuaW1wb3J0IHsgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMsIENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lELCBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMsIGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMsIGlzTGFuZ3VhZ2VFbmFibGVkLCBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IHsgREVGQVVMVF9TRVRUSU5HUyB9IGZyb20gXCIuL2RlZmF1bHRTZXR0aW5nc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHAsIGxvb21QbHVnaW4pO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibG9vbVwiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiUnVuIHN1cHBvcnRlZCBjb2RlIGZlbmNlcyBkaXJlY3RseSBmcm9tIG5vdGVzIHdoaWxlIHByZXNlcnZpbmcgbmF0aXZlIHN5bnRheCBoaWdobGlnaHRpbmcuXCIgfSk7XG5cbiAgICB0aGlzLnJlbmRlckdlbmVyYWxTZXR0aW5ncyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiR2VuZXJhbCBTZXR0aW5nc1wiLCB0cnVlKSk7XG4gICAgdGhpcy5yZW5kZXJMYW5ndWFnZVBhY2thZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJMYW5ndWFnZSBQYWNrYWdlc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJCdWlsdEluUnVudGltZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkJ1aWx0LWluIFJ1bnRpbWVzXCIpKTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ3VzdG9tIExhbmd1YWdlc1wiKSk7XG4gICAgdm9pZCB0aGlzLnJlbmRlckNvbnRhaW5lckdyb3Vwcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ29udGFpbmVyaXphdGlvbiBHcm91cHNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgdGl0bGU6IHN0cmluZywgb3BlbiA9IGZhbHNlKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uXCIgfSk7XG4gICAgZGV0YWlscy5vcGVuID0gb3BlbjtcbiAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHRpdGxlLCBjbHM6IFwibG9vbS1zZXR0aW5ncy1zdW1tYXJ5XCIgfSk7XG4gICAgcmV0dXJuIGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvbi1ib2R5XCIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckdlbmVyYWxTZXR0aW5ncyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRW5hYmxlIGxvY2FsIGV4ZWN1dGlvblwiKVxuICAgICAgLnNldERlc2MoXCJEaXNhYmxlZCBieSBkZWZhdWx0LiBsb29tIHJ1bnMgY29kZSBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgYW5kIGRvZXMgbm90IHByb3ZpZGUgc2FuZGJveGluZy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdmFsdWU7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgbG9vbSBub3RlcyBpbiBzb3VyY2UgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJQcmVzZXJ2ZSByYXcgZmVuY2VkIGNvZGUgaW4gdGhlIGVkaXRvciBpbnN0ZWFkIG9mIGxldHRpbmcgbGl2ZSBwcmV2aWV3IGNvbGxhcHNlIHJlc2VhcmNoIHNuaXBwZXRzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5kaXNhYmxlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IHRpbWVvdXRcIilcbiAgICAgIC5zZXREZXNjKFwiTWF4aW11bSBleGVjdXRpb24gdGltZSBpbiBtaWxsaXNlY29uZHMgYmVmb3JlIGxvb20gdGVybWluYXRlcyB0aGUgcHJvY2Vzcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiODAwMFwiKS5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zID0gcGFyc2VkO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldvcmtpbmcgZGlyZWN0b3J5XCIpXG4gICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBFbXB0eSB1c2VzIHRoZSBjdXJyZW50IG5vdGUgZm9sZGVyIHdoZW4gcG9zc2libGUsIG90aGVyd2lzZSB0aGUgdmF1bHQgcm9vdC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiVmF1bHQgcm9vdFwiKS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkgPSB2YWx1ZS50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiBcIlwiO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldyaXRlIG91dHB1dCBiYWNrIHRvIG5vdGVcIilcbiAgICAgIC5zZXREZXNjKFwiSW5zZXJ0IG1hbmFnZWQgbG9vbSBvdXRwdXQgc2VjdGlvbnMgYmVuZWF0aCBjb2RlIGJsb2NrcyBpbnN0ZWFkIG9mIGtlZXBpbmcgcmVzdWx0cyBwdXJlbHkgaW4gdGhlIFVJLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJWaXNpYmxlIG91dHB1dCBsaW5lc1wiKVxuICAgICAgLnNldERlc2MoXCJMaW1pdCBlYWNoIHN0ZG91dCwgc3RkZXJyLCBhbmQgd2FybmluZyBwYW5lbCB0byB0aGlzIG1hbnkgdmlzaWJsZSBsaW5lcy4gVXNlIDAgZm9yIHVubGltaXRlZCBvdXRwdXQuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMgPz8gMCkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID0gTWF0aC5taW4ocGFyc2VkLCAyMDAwKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBdXRvLXJ1biBvbiBmaWxlIG9wZW5cIilcbiAgICAgIC5zZXREZXNjKFwiUnVuIGFsbCBzdXBwb3J0ZWQgYmxvY2tzIGluIHRoZSBhY3RpdmUgbm90ZSB3aGVuIGl0IG9wZW5zLiBEaXNhYmxlZCBieSBkZWZhdWx0LlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4gPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFeHRyYWN0ZWQgc291cmNlIHByZXZpZXdcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyBsb29tIHNob3dzIHRoZSBtYXRlcmlhbGl6ZWQgc291cmNlIGZvciBibG9ja3MgdGhhdCB1c2UgbG9vbS1maWxlLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29sbGFwc2VkXCIsIFwiQ29sbGFwc2VkXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImV4cGFuZGVkXCIsIFwiRXhwYW5kZWRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiaGlkZGVuXCIsIFwiSGlkZGVuXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSB8fCBcImNvbGxhcHNlZFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSA9IHZhbHVlIGFzIFwiY29sbGFwc2VkXCIgfCBcImV4cGFuZGVkXCIgfCBcImhpZGRlblwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJTaG93IGNhcGFiaWxpdHkgbWV0YWRhdGFcIilcbiAgICAgIC5zZXREZXNjKFwiU2hvdyBzeW1ib2wsIGRlcGVuZGVuY3ksIGFuZCBoYXJuZXNzIGNhcGFiaWxpdHkgbWV0YWRhdGEgaW4gZXh0cmFjdGVkIHNvdXJjZSBwcmV2aWV3IGhlYWRlcnMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID8/IHRydWUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJQREYgZXhwb3J0IG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHdoYXQgdG8gaW5jbHVkZSB3aGVuIGV4cG9ydGluZyBub3RlcyBjb250YWluaW5nIGxvb20gY29kZSBibG9ja3MgdG8gUERGLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYm90aFwiLCBcIkJvdGggQ29kZSBhbmQgT3V0cHV0XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvZGVcIiwgXCJDb2RlIEJsb2NrIE9ubHlcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib3V0cHV0XCIsIFwiT3V0cHV0IE9ubHlcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgfHwgXCJib3RoXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPSB2YWx1ZSBhcyBcImJvdGhcIiB8IFwiY29kZVwiIHwgXCJvdXRwdXRcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckJ1aWx0SW5SdW50aW1lcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJweXRob25cIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XG4gICAgfVxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImphdmFzY3JpcHRcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTm9kZSBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIEphdmFTY3JpcHQgZXhlY3V0aW9uLlwiLCBcIm5vZGVFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcInR5cGVzY3JpcHRcIikpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlR5cGVTY3JpcHQgcnVubmVyIG1vZGVcIilcbiAgICAgICAgLnNldERlc2MoXCJVc2UgdHMtbm9kZSBvciB0c3ggZm9yIFR5cGVTY3JpcHQgYmxvY2tzLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHMtbm9kZVwiLCBcInRzLW5vZGVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0c3hcIiwgXCJ0c3hcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9IHZhbHVlIGFzIFwidHMtbm9kZVwiIHwgXCJ0c3hcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiVHlwZVNjcmlwdCB0cmFuc3BpbGVyIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHRzLW5vZGUgb3IgdHN4LlwiLCBcInR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJvY2FtbFwiKSkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiT0NhbWwgbW9kZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNob29zZSBiZXR3ZWVuIHRoZSBPQ2FtbCB0b3BsZXZlbCwgb2NhbWxjIGNvbXBpbGF0aW9uLCBvciBkdW5lIGV4ZWMuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbFwiLCBcIm9jYW1sXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxjXCIsIFwib2NhbWxjXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZHVuZVwiLCBcImR1bmVcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlID0gdmFsdWUgYXMgXCJvY2FtbFwiIHwgXCJvY2FtbGNcIiB8IFwiZHVuZVwiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJPQ2FtbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBvY2FtbCwgb2NhbWxjLCBvciBkdW5lIGRlcGVuZGluZyBvbiB0aGUgc2VsZWN0ZWQgbW9kZS5cIiwgXCJvY2FtbEV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNcIl0sIFwiQyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMgYmxvY2tzLlwiLCBcImNFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjcHBcIl0sIFwiQysrIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQysrIGJsb2Nrcy5cIiwgXCJjcHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJzaGVsbFwiXSwgXCJTaGVsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTaGVsbCwgQmFzaCwgYW5kIHNoIGJsb2Nrcy5cIiwgXCJzaGVsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInJ1YnlcIl0sIFwiUnVieSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBSdWJ5IGJsb2Nrcy5cIiwgXCJydWJ5RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicGVybFwiXSwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsdWFcIl0sIFwiTHVhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEx1YSBibG9ja3MuXCIsIFwibHVhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicGhwXCJdLCBcIlBIUCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQSFAgYmxvY2tzLlwiLCBcInBocEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImdvXCJdLCBcIkdvIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEdvIGJsb2Nrcy5cIiwgXCJnb0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInJ1c3RcIl0sIFwiUnVzdCBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIFJ1c3QgYmxvY2tzLlwiLCBcInJ1c3RFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJoYXNrZWxsXCJdLCBcIkhhc2tlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgSGFza2VsbCBibG9ja3MuIERlZmF1bHRzIHRvIHJ1bmdoYy5cIiwgXCJoYXNrZWxsRXhlY3V0YWJsZVwiKTtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJqYXZhXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgY29tcGlsZXJcIiwgXCJPcHRpb25hbCBjb21tYW5kIG9yIHBhdGggZm9yIGphdmFjLiBMZWF2ZSBlbXB0eSB0byB1c2UgSmF2YSBzb3VyY2UtZmlsZSBtb2RlLlwiLCBcImphdmFDb21waWxlckV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBjb21waWxlZCBKYXZhIGJsb2Nrcy5cIiwgXCJqYXZhRXhlY3V0YWJsZVwiKTtcbiAgICB9XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImxsdm0taXJcIl0sIFwiTExWTSBJUiBpbnRlcnByZXRlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBMTFZNIElSIGJsb2NrcyB3aXRoIGxsaS5cIiwgXCJsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlXCIpO1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImVicGYtY1wiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGNsYW5nIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNsYW5nIHdpdGggQlBGIHRhcmdldCBzdXBwb3J0LlwiLCBcImVicGZDbGFuZ0V4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgYnBmdG9vbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBicGZ0b29sIHZlcmlmaWVyIGFuZCBsb2FkIG9wZXJhdGlvbnMuXCIsIFwiZWJwZkJwZnRvb2xFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIG9iamVjdCBpbnNwZWN0b3JcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGxsdm0tb2JqZHVtcC4gTGVhdmUgZW1wdHkgdG8gc2tpcCBvYmplY3Qgc2VjdGlvbiBpbnNwZWN0aW9uLlwiLCBcImVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgaW5jbHVkZSBwYXRoc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBpbmNsdWRlIGRpcmVjdG9yaWVzIHBhc3NlZCB0byBjbGFuZyB3aXRoIC1JLlwiLCBcImVicGZJbmNsdWRlUGF0aHNcIik7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJBbGxvdyBlQlBGIGtlcm5lbCBsb2FkXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVxdWlyZWQgYmVmb3JlIGFueSBibG9jayBjYW4gdXNlIGxvb20tZWJwZi1tb2RlPWxvYWQuIENvbXBpbGUtb25seSBtb2RlIHN0YXlzIGF2YWlsYWJsZSB3aXRob3V0IHRoaXMuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVicGZBbGxvd0tlcm5lbExvYWQpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVicGZBbGxvd0tlcm5lbExvYWQgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImJwZnRyYWNlXCJdLCBcImJwZnRyYWNlIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGJwZnRyYWNlIHNjcmlwdHMuXCIsIFwiYnBmdHJhY2VFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsZWFuXCJdLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNvcVwiXSwgXCJDb3EgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgQ29xIGJsb2NrcyB3aXRoIGNvcWMuXCIsIFwiY29xRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wic210bGliXCJdLCBcIlNNVCBzb2x2ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNNVC1MSUIgYmxvY2tzLiBEZWZhdWx0cyB0byB6My5cIiwgXCJzbXRFeGVjdXRhYmxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRSdW50aW1lVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBsYW5ndWFnZUlkczogc3RyaW5nW10sIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgaWYgKGxhbmd1YWdlSWRzLnNvbWUoKGxhbmd1YWdlSWQpID0+IHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQpKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgbmFtZSwgZGVzY3JpcHRpb24sIGtleSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckxhbmd1YWdlUGFja2FnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG5cbiAgICBmb3IgKGNvbnN0IHBhY2sgb2YgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMpIHtcbiAgICAgIGNvbnN0IHBhY2tFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWxhbmd1YWdlLXBhY2thZ2VcIiB9KTtcbiAgICAgIHBhY2tFbC5vcGVuID0gdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpO1xuICAgICAgcGFja0VsLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHBhY2suZGlzcGxheU5hbWUgfSk7XG4gICAgICBwYWNrRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogcGFjay5kZXNjcmlwdGlvbiwgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhwYWNrRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRW5hYmxlIHBhY2thZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJEaXNhYmxlIHRoaXMgdG8gcmVtb3ZlIHRoZSBwYWNrYWdlIGxhbmd1YWdlcyBmcm9tIHBhcnNpbmcsIGNvbW1hbmQgbWVudXMsIGFuZCBydW5uZXJzIGZvciB0aGlzIHZhdWx0LlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIHBhY2suaWQsIHZhbHVlKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2YgcGFjay5sYW5ndWFnZXMpIHtcbiAgICAgICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkLCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgcGFja2FnZUVuYWJsZWQgPSB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCk7XG4gICAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgICAgIG5ldyBTZXR0aW5nKHBhY2tFbClcbiAgICAgICAgICAuc2V0TmFtZShsYW5ndWFnZS5kaXNwbGF5TmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhgQWxpYXNlczogJHtsYW5ndWFnZS5hbGlhc2VzLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoIXBhY2thZ2VFbmFibGVkKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUocGFja2FnZUVuYWJsZWQgJiYgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMuaW5jbHVkZXMobGFuZ3VhZ2UuaWQpKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkLCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJDdXN0b20gbGFuZ3VhZ2VzXCIpXG4gICAgICAuc2V0RGVzYyhcIkVuYWJsZSB1c2VyLWRlZmluZWQgbGFuZ3VhZ2VzIGZyb20gdGhlIEN1c3RvbSBMYW5ndWFnZXMgc2VjdGlvbi5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcywgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQsIHZhbHVlKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJSZXNldCBsYW5ndWFnZSBwYWNrYWdlc1wiKVxuICAgICAgLnNldERlc2MoXCJSZS1lbmFibGUgZXZlcnkgYnVpbHQtaW4gcGFja2FnZSBhbmQgZXZlcnkgYnVpbHQtaW4gbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiUmVzZXRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzID0gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpO1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzID0gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHNldEVuYWJsZWRWYWx1ZSh2YWx1ZXM6IHN0cmluZ1tdLCBpZDogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgY29uc3QgaW5kZXggPSB2YWx1ZXMuaW5kZXhPZihpZCk7XG4gICAgaWYgKGVuYWJsZWQgJiYgaW5kZXggPCAwKSB7XG4gICAgICB2YWx1ZXMucHVzaChpZCk7XG4gICAgfSBlbHNlIGlmICghZW5hYmxlZCAmJiBpbmRleCA+PSAwKSB7XG4gICAgICB2YWx1ZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtbGlzdFwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGxpc3RFbCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQWRkIGN1c3RvbSBsYW5ndWFnZVwiKVxuICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgbG9jYWwgY29tbWFuZC1iYWNrZWQgbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogXCJjdXN0b20tbGFuZ3VhZ2VcIixcbiAgICAgICAgICAgIGFsaWFzZXM6IFwiXCIsXG4gICAgICAgICAgICBleGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgYXJnczogXCJ7ZmlsZX1cIixcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIudHh0XCIsXG4gICAgICAgICAgICBleHRyYWN0b3JNb2RlOiBcImNvbW1hbmRcIixcbiAgICAgICAgICAgIGV4dHJhY3RvckV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBleHRyYWN0b3JBcmdzOiBcIntyZXF1ZXN0fVwiLFxuICAgICAgICAgICAgdHJhbnNwaWxlRXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIHRyYW5zcGlsZUFyZ3M6IFwie3JlcXVlc3R9XCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgaWYgKCF0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmxlbmd0aCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBjdXN0b20gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZm9yRWFjaCgobGFuZ3VhZ2UsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlXCIgfSk7XG4gICAgICBkZXRhaWxzLm9wZW4gPSB0cnVlO1xuICAgICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBsYW5ndWFnZS5uYW1lIHx8IGBDdXN0b20gbGFuZ3VhZ2UgJHtpbmRleCArIDF9YCB9KTtcbiAgICAgIGNvbnN0IGJvZHkgPSBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1ib2R5XCIgfSk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJOYW1lXCIsIFwiTm9ybWFsaXplZCBsYW5ndWFnZSBpZCB1c2VkIGJ5IGxvb20uXCIsIFwibmFtZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBbGlhc2VzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGZlbmNlIGFsaWFzZXMuXCIsIFwiYWxpYXNlc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeGVjdXRhYmxlXCIsIFwiTG9jYWwgY29tbWFuZCBvciBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGguXCIsIFwiZXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBcmd1bWVudHNcIiwgXCJTcGFjZS1zZXBhcmF0ZWQgYXJndW1lbnRzLiBVc2Uge2ZpbGV9IGZvciB0aGUgdGVtcCBzb3VyY2UgZmlsZS5cIiwgXCJhcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dGVuc2lvblwiLCBcIlRlbXAgc291cmNlIGZpbGUgZXh0ZW5zaW9uLCBmb3IgZXhhbXBsZSAucHkuXCIsIFwiZXh0ZW5zaW9uXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIlBhcnRpYWwgZXh0cmFjdGlvbiBzdHJhdGVneVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgdGhpcyBjdXN0b20gbGFuZ3VhZ2Ugc3VwcG9ydHMgcGFydGlhbCBydW5uYWJsZSBzb3VyY2UuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJjb21tYW5kXCIsIFwiRXh0cmFjdG9yIGNvbW1hbmRcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cmFuc3BpbGUtY1wiLCBcIlRyYW5zcGlsZSB0byBDXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUobGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSA9IHZhbHVlIGFzIFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dHJhY3RvciBleGVjdXRhYmxlXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBmb3IgcGFydGlhbCBzb3VyY2UgZXh0cmFjdGlvbi4gTGVhdmUgZW1wdHkgdG8gdXNlIGdlbmVyaWMgbGluZSBhbmQgc3ltYm9sIGV4dHJhY3Rpb24uXCIsIFwiZXh0cmFjdG9yRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRyYWN0b3IgYXJndW1lbnRzXCIsIFwiQXJndW1lbnRzIGZvciB0aGUgZXh0cmFjdG9yLiBVc2Uge3JlcXVlc3R9LCB7c291cmNlfSwge2hhcm5lc3N9LCB7c3ltYm9sfSwge2xpbmVTdGFydH0sIHtsaW5lRW5kfSwge2RlcHN9LCBhbmQge2xhbmd1YWdlfS5cIiwgXCJleHRyYWN0b3JBcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIlRyYW5zcGlsZSB0byBDIGV4ZWN1dGFibGVcIiwgXCJPcHRpb25hbCBjb21tYW5kIHRoYXQgZW1pdHMgZ2VuZXJhdGVkIEMgYW5kIGEgc3ltYm9sIG1hcCBhcyBKU09OLlwiLCBcInRyYW5zcGlsZUV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiVHJhbnNwaWxlIHRvIEMgYXJndW1lbnRzXCIsIFwiQXJndW1lbnRzIGZvciB0aGUgdHJhbnNwaWxlci4gVXNlIHRoZSBzYW1lIHBsYWNlaG9sZGVycyBhcyBleHRyYWN0b3IgYXJndW1lbnRzLlwiLCBcInRyYW5zcGlsZUFyZ3NcIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiRGVsZXRlIGxhbmd1YWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3ZlIHRoaXMgY3VzdG9tIGxhbmd1YWdlLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJEZWxldGVcIikuc2V0V2FybmluZygpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbmRlckNvbnRhaW5lckdyb3Vwcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5sb29tUGx1Z2luLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkRlZmF1bHQgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlRoZSBjb250YWluZXIgZ3JvdXAgdG8gcnVuIGNvZGUgYmxvY2tzIGluIGJ5IGRlZmF1bHQgaWYgdGhlIG5vdGUgZG9lcyBub3Qgc3BlY2lmeSBvbmUuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJcIiwgXCJOb25lXCIpO1xuICAgICAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oZ3JvdXAubmFtZSwgZ3JvdXAubmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgfHwgXCJcIik7XG4gICAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJBZGQgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cCBjb25maWd1cmF0aW9uIGZvbGRlci5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIG5ldyBDb250YWluZXJHcm91cE5hbWVNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKGdyb3VwTmFtZSkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBjbGVhbk5hbWUgPSBncm91cE5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTlfLV0vZywgXCItXCIpO1xuICAgICAgICAgICAgICBpZiAoIWNsZWFuTmFtZSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIGdyb3VwIG5hbWUuXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIGNvbnN0IGdyb3VwUmVsYXRpdmVQYXRoID0gYCR7cGx1Z2luRGlyfS9jb250YWluZXJzLyR7Y2xlYW5OYW1lfWA7XG4gICAgICAgICAgICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtncm91cFJlbGF0aXZlUGF0aH0vY29uZmlnLmpzb25gO1xuXG4gICAgICAgICAgICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgICAgICAgICAgICBpZiAoYXdhaXQgYWRhcHRlci5leGlzdHMoZ3JvdXBSZWxhdGl2ZVBhdGgpKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBmb2xkZXIgYWxyZWFkeSBleGlzdHMuXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIubWtkaXIoZ3JvdXBSZWxhdGl2ZVBhdGgpO1xuICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0Q29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJ1bnRpbWU6IFwiZG9ja2VyXCIsXG4gICAgICAgICAgICAgICAgaW1hZ2U6IFwidWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIGxhbmd1YWdlczoge1xuICAgICAgICAgICAgICAgICAgcHl0aG9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbW1hbmQ6IFwicHl0aG9uMyB7ZmlsZX1cIixcbiAgICAgICAgICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIEpTT04uc3RyaW5naWZ5KGRlZmF1bHRDb25maWcsIG51bGwsIDIpKTtcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShgQ29udGFpbmVyIGdyb3VwIFwiJHtjbGVhbk5hbWV9XCIgY3JlYXRlZC5gKTtcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWNvbnRhaW5lci1ncm91cC1saXN0XCIgfSk7XG4gICAgICBpZiAoIWdyb3Vwcy5sZW5ndGgpIHtcbiAgICAgICAgbGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgICAgdGV4dDogXCJObyBjb250YWluZXIgZ3JvdXBzIGZvdW5kIGluIC5vYnNpZGlhbi9wbHVnaW5zL2xvb20vY29udGFpbmVycy5cIixcbiAgICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIG5ldyBTZXR0aW5nKGxpc3RFbClcbiAgICAgICAgICAuc2V0TmFtZShncm91cC5uYW1lKVxuICAgICAgICAgIC5zZXREZXNjKGdyb3VwLnN0YXR1cylcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkJ1aWxkIC8gcmVidWlsZFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLmJ1aWxkQ29udGFpbmVyR3JvdXAoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJFZGl0XCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBuZXcgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwodGhpcy5sb29tUGx1Z2luLCBncm91cC5uYW1lLCBwbHVnaW5EaXIsICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBFcnJvciBsb2FkaW5nIGNvbnRhaW5lciBncm91cHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgIGNsczogXCJsb29tLXNldHRpbmdzLWVycm9yXCIsXG4gICAgICAgIGF0dHI6IHsgc3R5bGU6IFwiY29sb3I6IHZhcigtLXRleHQtZXJyb3IpOyBmb250LXdlaWdodDogYm9sZDsgbWFyZ2luOiAxZW0gMDtcIiB9XG4gICAgICB9KTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJsb29tOiBmYWlsZWQgdG8gcmVuZGVyIGNvbnRhaW5lciBncm91cHM6XCIsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFkZFRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tUGx1Z2luU2V0dGluZ3M+KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgbmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IEspOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldIGFzIHN0cmluZykgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21DdXN0b21MYW5ndWFnZT4oXG4gICAgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LFxuICAgIGxhbmd1YWdlOiBsb29tQ3VzdG9tTGFuZ3VhZ2UsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmcsXG4gICAga2V5OiBLLFxuICApOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyhsYW5ndWFnZVtrZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAobGFuZ3VhZ2Vba2V5XSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UoXCJsb29tIGxvY2FsIGV4ZWN1dGlvbiBpcyBkaXNhYmxlZC4gRW5hYmxlIGl0IGluIHNldHRpbmdzIG9yIGNvbmZpcm0gdGhlIGV4ZWN1dGlvbiB3YXJuaW5nIGZpcnN0LlwiKTtcbn1cblxuY2xhc3MgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgbmFtZSA9IFwiXCI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblN1Ym1pdDogKG5hbWU6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiTmV3IENvbnRhaW5lciBHcm91cCBOYW1lXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIkdyb3VwIE5hbWVcIilcbiAgICAgIC5zZXREZXNjKFwiVXNlIGxvd2VyY2FzZSBsZXR0ZXJzLCBudW1iZXJzLCBoeXBoZW5zLCBhbmQgdW5kZXJzY29yZXMuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMub25TdWJtaXQodGhpcy5uYW1lKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuY2xhc3MgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgYWN0aXZlVGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIgPSBcImdlbmVyYWxcIjtcbiAgcHJpdmF0ZSBjb25maWdPYmo6IGFueSA9IHt9O1xuICBwcml2YXRlIHJhd0pzb25UZXh0ID0gXCJcIjtcbiAgcHJpdmF0ZSBkb2NrZXJmaWxlVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgcHJpdmF0ZSB0YWJIZWFkZXJFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHRhYkNvbnRlbnRFbCE6IEhUTUxFbGVtZW50O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblNhdmU6ICgpID0+IHZvaWRcbiAgKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHApO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogYEVkaXQgQ29uZmlnOiAke3RoaXMuZ3JvdXBOYW1lfWAgfSk7XG5cbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmF3Q29uZmlnID0gYXdhaXQgYWRhcHRlci5yZWFkKGNvbmZpZ1BhdGgpO1xuICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHJhd0NvbmZpZyk7XG4gICAgICB0aGlzLnJhd0pzb25UZXh0ID0gcmF3Q29uZmlnO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDb3VsZCBub3QgcmVhZCBjb25maWd1cmF0aW9uIGZpbGUuXCIpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgYWRhcHRlci5leGlzdHMoZG9ja2VyZmlsZVBhdGgpKSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBhd2FpdCBhZGFwdGVyLnJlYWQoZG9ja2VyZmlsZVBhdGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgY29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250YWluZXJcIiB9KTtcblxuICAgIC8vIFJlbmRlciBUYWIgSGVhZGVyXG4gICAgdGhpcy50YWJIZWFkZXJFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItaGVhZGVyXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIENvbnRlbnQgQXJlYVxuICAgIHRoaXMudGFiQ29udGVudEVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250ZW50XCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgQWN0aW9ucyBGb290ZXJcbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcbiAgICBjb25zdCBzYXZlQnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiU2F2ZVwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuICAgIHNhdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZUFuZENsb3NlKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyVGFicygpIHtcbiAgICB0aGlzLnRhYkhlYWRlckVsLmVtcHR5KCk7XG4gICAgY29uc3QgdGFiczogQXJyYXk8eyBpZDogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICAgICAgeyBpZDogXCJnZW5lcmFsXCIsIGxhYmVsOiBcIkdlbmVyYWxcIiB9LFxuICAgICAgeyBpZDogXCJsYW5ndWFnZXNcIiwgbGFiZWw6IFwiTGFuZ3VhZ2VzXCIgfSxcbiAgICAgIHsgaWQ6IFwiZG9ja2VyZmlsZVwiLCBsYWJlbDogXCJEb2NrZXJmaWxlXCIgfSxcbiAgICAgIHsgaWQ6IFwicmF3XCIsIGxhYmVsOiBcIlJhdyBKU09OXCIgfSxcbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCB0YWIgb2YgdGFicykge1xuICAgICAgY29uc3QgYnRuID0gdGhpcy50YWJIZWFkZXJFbC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIHRleHQ6IHRhYi5sYWJlbCxcbiAgICAgICAgY2xzOiBcImxvb20tdGFiLWJ0blwiICsgKHRoaXMuYWN0aXZlVGFiID09PSB0YWIuaWQgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpLFxuICAgICAgfSk7XG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLnN3aXRjaFRhYih0YWIuaWQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3dpdGNoVGFiKHRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiKSB7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc3dpdGNoaW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFjdGl2ZVRhYiA9IHRhYjtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyQWN0aXZlVGFiKCkge1xuICAgIHRoaXMudGFiQ29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImdlbmVyYWxcIikge1xuICAgICAgdGhpcy5yZW5kZXJHZW5lcmFsVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImxhbmd1YWdlc1wiKSB7XG4gICAgICB0aGlzLnJlbmRlckxhbmd1YWdlc1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJkb2NrZXJmaWxlXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyRG9ja2VyZmlsZVRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdGhpcy5yZW5kZXJSYXdUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckdlbmVyYWxUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgLy8gUnVudGltZSBzZWxlY3QgZHJvcGRvd25cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUnVudGltZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgdGhlIGNvbnRhaW5lci9lbnZpcm9ubWVudCBtYW5hZ2VyIHJ1bnRpbWUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImRvY2tlclwiLCBcIkRvY2tlclwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJwb2RtYW5cIiwgXCJQb2RtYW5cIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwid3NsXCIsIFwiV1NMXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInFlbXVcIiwgXCJRRU1VXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImN1c3RvbVwiLCBcIkN1c3RvbVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lIHx8IFwiZG9ja2VyXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgLy8gQ29uZGl0aW9uYWwgaW1hZ2UvZGlzdHJvIG5hbWVcbiAgICBpZiAoXG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIiA/IFwiV1NMIERpc3Ryb1wiIDogXCJCYXNlIEltYWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICAgICAgICAgID8gXCJPcHRpb25hbC4gVGhlIHRhcmdldCBXU0wgZGlzdHJvIG5hbWUgKGxlYXZlIGVtcHR5IGZvciBkZWZhdWx0IGRpc3RybykuXCJcbiAgICAgICAgICAgIDogXCJGYWxsYmFjayBEb2NrZXIvUG9kbWFuIGltYWdlIGlmIG5vIERvY2tlcmZpbGUgaXMgcHJlc2VudC5cIlxuICAgICAgICApXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmltYWdlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5pbWFnZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoud3NsKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLndzbCA9IHt9O1xuICAgICAgfVxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVXNlIEludGVyYWN0aXZlIFNoZWxsXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIGludGVyYWN0aXZlIGxvZ2luIHNoZWxsIGZsYWdzICgtaSAtbCkgdG8gZW5zdXJlIH4vLmJhc2hyYyBpbml0aWFsaXphdGlvbiB3b3JrcyAoZS5nLiwgZm9yIE5WTSkuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA/PyBmYWxzZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA9IHZhbDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBRRU1VIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnFlbXUpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdSA9IHsgc3NoVGFyZ2V0OiBcIlwiLCByZW1vdGVXb3Jrc3BhY2U6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIFRhcmdldFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlNTSCB0YXJnZXQgYWRkcmVzcyAoZS5nLiB1c2VyQGhvc3RuYW1lIG9yIGxvY2FsaG9zdCAtcCAyMjIyKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0ID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiUmVtb3RlIFdvcmtzcGFjZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW90ZSBmb2xkZXIgcGF0aCB0byBjb3B5IGNvZGUgc25pcHBldHMgYW5kIHJ1biBjb21tYW5kcyAoZS5nLiwgL2hvbWUvdXNlci93b3Jrc3BhY2UpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBQYXRoIHRvIFNTSCBjbGllbnQgZXhlY3V0YWJsZSAoZGVmYXVsdHMgdG8gc3NoKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBBZGRpdGlvbmFsIFNTSCBDTEkgZmxhZ3MuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgQ3VzdG9tIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmouY3VzdG9tKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbSA9IHsgZXhlY3V0YWJsZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlBhdGggdG8gY3VzdG9tIHJ1bnRpbWUgd3JhcHBlciBleGVjdXRhYmxlIG9yIHNjcmlwdC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBDb21tYW5kIGFyZ3VtZW50cy4gVXNlIHtyZXF1ZXN0fSBmb3IgSlNPTiBjb25maWcgcGF0aC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyTGFuZ3VhZ2VzVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkNvbmZpZ3VyZWQgTGFuZ3VhZ2VzXCIgfSk7XG5cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcykge1xuICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzID0ge307XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3NMaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZXMtbGlzdFwiIH0pO1xuICAgIGNvbnN0IGxhbmd1YWdlcyA9IE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB7IGNvbW1hbmQ/OiBzdHJpbmc7IGV4dGVuc2lvbj86IHN0cmluZzsgdXNlRGVmYXVsdD86IGJvb2xlYW4gfT4pO1xuXG4gICAgaWYgKGxhbmd1YWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGxhbmdzTGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiTm8gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQgZm9yIHRoaXMgZ3JvdXAuXCIsIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIiB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBbbGFuZ05hbWUsIGxhbmdDb25maWddIG9mIGxhbmd1YWdlcykge1xuICAgICAgICBjb25zdCBjYXJkID0gbGFuZ3NMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtY2FyZFwiIH0pO1xuICAgICAgICBjYXJkLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbGFuZ05hbWUsIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDAuNXJlbTsgZm9udC1zaXplOiAxLjFlbTtcIiB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGlzRGVmYXVsdCA9IChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiVXNlIGRlZmF1bHQgY29uZmlndXJhdGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiSWYgY2hlY2tlZCwgTG9vbSB3aWxsIHJ1biB0aGlzIGxhbmd1YWdlIHVzaW5nIGl0cyBidWlsdC1pbiBjb21tYW5kcy9leHRlbnNpb25zLlwiKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHZhbCkge1xuICAgICAgICAgICAgICAgICAgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmNvbW1hbmQ7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5leHRlbnNpb247XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQ7XG4gICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIjtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiQ29tbWFuZFwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiRXhlY3V0aW9uIGNvbW1hbmQuIFVzZSB7ZmlsZX0gZm9yIHRoZSBjb2RlIHNuaXBwZXQgZmlsZW5hbWUuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkV4dGVuc2lvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiU291cmNlIGZpbGUgZXh0ZW5zaW9uIChlLmcuIC5weSwgLmpzKS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgICAgYnRuXG4gICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIExhbmd1YWdlXCIpXG4gICAgICAgICAgICAgIC5zZXRXYXJuaW5nKClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbbGFuZ05hbWVdO1xuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBMYW5ndWFnZSBTZWN0aW9uXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQWRkIExhbmd1YWdlIE1hcHBpbmdcIiwgYXR0cjogeyBzdHlsZTogXCJtYXJnaW4tdG9wOiAxLjVyZW07XCIgfSB9KTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiTGFuZ3VhZ2UgSURcIilcbiAgICAgIC5zZXREZXNjKFwiZS5nLiBweXRob24sIGphdmFzY3JpcHQsIG5vZGUsIHNoXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMubmV3TGFuZ3VhZ2VOYW1lKS5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSB2YWwudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIisgQWRkXCIpLnNldEN0YSgpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5uZXdMYW5ndWFnZU5hbWUpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJQbGVhc2UgZW50ZXIgYSBsYW5ndWFnZSBuYW1lLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0pIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJMYW5ndWFnZSBhbHJlYWR5IGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdID0ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9IHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IGAuJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX1gLFxuICAgICAgICAgIH07XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICByZW5kZXJEb2NrZXJmaWxlVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcImRvY2tlclwiICYmIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwicG9kbWFuXCIpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBEb2NrZXJmaWxlIGVkaXRpbmcgaXMgb25seSBhdmFpbGFibGUgZm9yIERvY2tlciBhbmQgUG9kbWFuIHJ1bnRpbWVzLiBDdXJyZW50bHkgdXNpbmc6ICR7dGhpcy5jb25maWdPYmoucnVudGltZX1gLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCA9PT0gbnVsbCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBEb2NrZXJmaWxlIGV4aXN0cyBpbiB0aGlzIGNvbnRhaW5lciBncm91cCBkaXJlY3RvcnkuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgYnRuXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZSBEb2NrZXJmaWxlXCIpXG4gICAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IFtcbiAgICAgICAgICAgICAgICBcIkZST00gdWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgICAgXCIjIEluc3RhbGwgcGFja2FnZXNcIixcbiAgICAgICAgICAgICAgICBcIlJVTiBhcHQtZ2V0IHVwZGF0ZSAmJiBhcHQtZ2V0IGluc3RhbGwgLXkgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIHB5dGhvbjMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIG5vZGVqcyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgJiYgcm0gLXJmIC92YXIvbGliL2FwdC9saXN0cy8qXCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEb2NrZXJmaWxlIENvbnRlbnRcIilcbiAgICAgICAgLnNldERlc2MoXCJEZWZpbmUgdGhlIGJ1aWxkIHN0ZXBzIGZvciB5b3VyIGVudmlyb25tZW50IGNvbnRhaW5lci5cIilcbiAgICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmRvY2tlcmZpbGVUZXh0IHx8IFwiXCIpO1xuICAgICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IHZhbDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmF3VGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIHRoaXMucmF3SnNvblRleHQgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkNvbmZpZ3VyYXRpb24gSlNPTlwiKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMucmF3SnNvblRleHQgPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBhc3luYyBzYXZlQW5kQ2xvc2UoKSB7XG4gICAgLy8gSWYgdGhlIGFjdGl2ZSB0YWIgaXMgcmF3IEpTT04sIHBhcnNlIGl0IGZpcnN0IHRvIGVuc3VyZSB3ZSBjYXB0dXJlIGVkaXRzXG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc2F2aW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJhc2ljIFZhbGlkYXRpb25cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnJ1bnRpbWUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJSdW50aW1lIGlzIHJlcXVpcmVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmICghdGhpcy5jb25maWdPYmoucWVtdT8uc3NoVGFyZ2V0IHx8ICF0aGlzLmNvbmZpZ09iai5xZW11Py5yZW1vdGVXb3Jrc3BhY2UpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIFNTSCBUYXJnZXQgYW5kIFJlbW90ZSBXb3Jrc3BhY2UuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiAhdGhpcy5jb25maWdPYmouY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgQ3VzdG9tIEV4ZWN1dGFibGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcblxuICAgIHRyeSB7XG4gICAgICAvLyBTYXZlIGNvbmZpZy5qc29uXG4gICAgICBjb25zdCBjb25maWdTdHIgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIGNvbmZpZ1N0cik7XG5cbiAgICAgIC8vIFNhdmUgRG9ja2VyZmlsZVxuICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIikge1xuICAgICAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCAhPT0gbnVsbCkge1xuICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoZG9ja2VyZmlsZVBhdGgsIHRoaXMuZG9ja2VyZmlsZVRleHQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgY29uZmlndXJhdGlvbnMgc2F2ZWQuXCIpO1xuICAgICAgdGhpcy5vblNhdmUoKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbmV3IE5vdGljZShgU2F2ZSBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuL3V0aWxzL2NvbW1hbmRcIjtcblxuaW50ZXJmYWNlIFNvdXJjZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBTb3VyY2VEZWZpbml0aW9uIGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5hbWVzPzogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQeXRob25BbGlhcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgYXNuYW1lOiBzdHJpbmcgfCBudWxsO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uSW1wb3J0IGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBraW5kOiBcImltcG9ydFwiIHwgXCJmcm9tXCI7XG4gIG1vZHVsZTogc3RyaW5nO1xuICBsZXZlbDogbnVtYmVyO1xuICBuYW1lczogUHl0aG9uQWxpYXNbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbk1vZHVsZUluZm8ge1xuICBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdO1xuICBpbXBvcnRzOiBQeXRob25JbXBvcnRbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvblVzYWdlIHtcbiAgbmFtZXM6IHN0cmluZ1tdO1xuICBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT47XG59XG5cbmludGVyZmFjZSBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZWFkb25seSBpbmNsdWRlZFJhbmdlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGluY2x1ZGVkSW1wb3J0czogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGFsaWFzZXM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBuYW1lc3BhY2VCaW5kaW5nczogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICByZWFkb25seSB2aXNpdGluZ1N5bWJvbHM6IFNldDxzdHJpbmc+O1xuICBuZWVkc05hbWVzcGFjZVJ1bnRpbWU6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0IHtcbiAgcHl0aG9uRXhlY3V0YWJsZT86IHN0cmluZztcbiAgZXh0ZXJuYWxFeHRyYWN0b3I/OiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3I7XG4gIHJlYWRGaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuICByZXNvbHZlUHl0aG9uSW1wb3J0KGZyb21GaWxlUGF0aDogc3RyaW5nLCBtb2R1bGVOYW1lOiBzdHJpbmcsIGxldmVsOiBudW1iZXIpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvciB7XG4gIG1vZGU6IFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiO1xuICBsYW5ndWFnZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICBjb250ZW50Pzogc3RyaW5nO1xuICBzZWxlY3RlZD86IHN0cmluZztcbiAgZGVwZW5kZW5jaWVzPzogc3RyaW5nW107XG4gIGltcG9ydHM/OiBzdHJpbmdbXTtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICBnZW5lcmF0ZWRTb3VyY2U6IHN0cmluZztcbiAgc3ltYm9scz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGhhcm5lc3M/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogXCJjXCIgfCBcImNwcFwiO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb250ZW50OiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdD86IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGlmIChob3N0Py5leHRlcm5hbEV4dHJhY3Rvcj8uZXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICByZXR1cm4gaG9zdC5leHRlcm5hbEV4dHJhY3Rvci5tb2RlID09PSBcInRyYW5zcGlsZS1jXCJcbiAgICAgID8gcmVzb2x2ZVRyYW5zcGlsZVRvQ1JlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKVxuICAgICAgOiByZXNvbHZlRXh0ZXJuYWxSZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcywgaG9zdC5leHRlcm5hbEV4dHJhY3Rvcik7XG4gIH1cblxuICBpZiAobGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgaG9zdCkge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgaGFybmVzcywgaG9zdCk7XG4gIH1cblxuICByZXR1cm4gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuKTogbG9vbVJlc29sdmVkU291cmNlIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kU3ltYm9sUmFuZ2UobGluZXMsIGxhbmd1YWdlLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXMsIGxhbmd1YWdlLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZClcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLWV4dHJhY3QtXCIpKTtcbiAgY29uc3Qgc291cmNlRmlsZSA9IGpvaW4odGVtcERpciwgXCJzb3VyY2UudHh0XCIpO1xuICBjb25zdCBoYXJuZXNzRmlsZSA9IGpvaW4odGVtcERpciwgXCJoYXJuZXNzLnR4dFwiKTtcbiAgY29uc3QgcmVxdWVzdEZpbGUgPSBqb2luKHRlbXBEaXIsIFwicmVxdWVzdC5qc29uXCIpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgIH07XG4gICAgYXdhaXQgd3JpdGVGaWxlKHNvdXJjZUZpbGUsIHNvdXJjZSwgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShoYXJuZXNzRmlsZSwgaGFybmVzcywgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0RmlsZSwgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMiksIFwidXRmOFwiKTtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1bkV4dGVybmFsRXh0cmFjdG9yKGV4dHJhY3Rvciwge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICByZXF1ZXN0RmlsZSxcbiAgICAgIHJlZmVyZW5jZSxcbiAgICB9KTtcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgY29udGVudCA9IHJlc3VsdC5jb250ZW50ID8/IFtcbiAgICAgIC4uLihyZXN1bHQuaW1wb3J0cyA/PyBbXSksXG4gICAgICAuLi4ocmVzdWx0LmRlcGVuZGVuY2llcyA/PyBbXSksXG4gICAgICByZXN1bHQuc2VsZWN0ZWQgPz8gXCJcIixcbiAgICAgIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCIsXG4gICAgXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgaWYgKCFjb250ZW50LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgcmV0dXJuZWQgbm8gY29udGVudC5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBudWxsKSxcbiAgICB9O1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICB0YXJnZXRMYW5ndWFnZTogXCJjXCIsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgZ2VuZXJhdGVkTGFuZ3VhZ2UgPSByZXN1bHQubGFuZ3VhZ2UgPT09IFwiY3BwXCIgPyBcImNwcFwiIDogXCJjXCI7XG4gICAgY29uc3QgbWFwcGVkU3ltYm9sID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyByZXN1bHQuc3ltYm9scz8uW3JlZmVyZW5jZS5zeW1ib2xOYW1lXSA/PyByZWZlcmVuY2Uuc3ltYm9sTmFtZSA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBnZW5lcmF0ZWRSZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UgPSB7XG4gICAgICAuLi5yZWZlcmVuY2UsXG4gICAgICBmaWxlUGF0aDogYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpnZW5lcmF0ZWQuJHtnZW5lcmF0ZWRMYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIn1gLFxuICAgICAgc3ltYm9sTmFtZTogbWFwcGVkU3ltYm9sLFxuICAgIH07XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHJlc3VsdC5nZW5lcmF0ZWRTb3VyY2UsIGdlbmVyYXRlZFJlZmVyZW5jZSwgZ2VuZXJhdGVkTGFuZ3VhZ2UsIHJlc3VsdC5oYXJuZXNzID8/IGhhcm5lc3MpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgYCR7cmVmZXJlbmNlLmZpbGVQYXRofSMke3JlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiZ2VuZXJhdGVkLWNcIn1gLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkV4dGVybmFsRXh0cmFjdG9yKFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcixcbiAgdmFsdWVzOiB7XG4gICAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgICBzb3VyY2VGaWxlOiBzdHJpbmc7XG4gICAgaGFybmVzc0ZpbGU6IHN0cmluZztcbiAgICByZXF1ZXN0RmlsZTogc3RyaW5nO1xuICAgIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZTtcbiAgfSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGFyZ3MgPSBleHRyYWN0b3IuYXJncy5tYXAoKGFyZykgPT4gYXJnXG4gICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgdmFsdWVzLnJlcXVlc3RGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3NvdXJjZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7aGFybmVzc31cIiwgdmFsdWVzLmhhcm5lc3NGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3N5bWJvbH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZVN0YXJ0fVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA9PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZUVuZH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZGVwc31cIiwgdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyA/IFwidHJ1ZVwiIDogXCJmYWxzZVwiKVxuICAgIC5yZXBsYWNlQWxsKFwie2xhbmd1YWdlfVwiLCB2YWx1ZXMubGFuZ3VhZ2UpKTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXh0cmFjdG9yLmV4ZWN1dGFibGUsIGFyZ3MsIHtcbiAgICAgIGN3ZDogZXh0cmFjdG9yLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxuICAgIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgdGltZWQgb3V0IGFmdGVyICR7ZXh0cmFjdG9yLnRpbWVvdXRNc30gbXMuYCkpO1xuICAgIH0sIGV4dHJhY3Rvci50aW1lb3V0TXMpO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlamVjdChlcnJvcik7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXNvbHZlKHN0ZG91dCk7XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcmVxdWVzdEZpbGU6IHZhbHVlcy5yZXF1ZXN0RmlsZSxcbiAgICAgIHNvdXJjZUZpbGU6IHZhbHVlcy5zb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGU6IHZhbHVlcy5oYXJuZXNzRmlsZSxcbiAgICAgIGxhbmd1YWdlOiB2YWx1ZXMubGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogdmFsdWVzLnJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHZhbHVlcy5yZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICB9KSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dDogc3RyaW5nKTogRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdDtcbiAgICBpZiAodHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBwYXJzZWQgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgbXVzdCByZXR1cm4gYSBKU09OIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBpbnZhbGlkIEpTT046ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dDogc3RyaW5nKTogVHJhbnNwaWxlVG9DUmVzdWx0IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG91dHB1dCkgYXMgVHJhbnNwaWxlVG9DUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsIHx8IHR5cGVvZiBwYXJzZWQuZ2VuZXJhdGVkU291cmNlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgbXVzdCByZXR1cm4gZ2VuZXJhdGVkU291cmNlLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5sYW5ndWFnZSAhPSBudWxsICYmIHBhcnNlZC5sYW5ndWFnZSAhPT0gXCJjXCIgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNwcFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBsYW5ndWFnZSBtdXN0IGJlIGMgb3IgY3BwLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5zeW1ib2xzICE9IG51bGwgJiYgKHR5cGVvZiBwYXJzZWQuc3ltYm9scyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBhcnNlZC5zeW1ib2xzKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIHN5bWJvbHMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNwaWxlIHRvIEMgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbywgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBzdGF0ZSA9IGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLmZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZCwgaGFybmVzcywgaG9zdCwgc3RhdGUpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIHNlbGVjdGVkUmFuZ2UpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQeXRob25EZXBlbmRlbmN5U3RhdGUoKTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBpbmNsdWRlZFJhbmdlczogbmV3IFNldCgpLFxuICAgIGluY2x1ZGVkSW1wb3J0czogbmV3IFNldCgpLFxuICAgIGFsaWFzZXM6IG5ldyBTZXQoKSxcbiAgICBuYW1lc3BhY2VCaW5kaW5nczogbmV3IE1hcCgpLFxuICAgIHZpc2l0aW5nU3ltYm9sczogbmV3IFNldCgpLFxuICAgIG5lZWRzTmFtZXNwYWNlUnVudGltZTogZmFsc2UsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsXG4gIHNlbGVjdGVkOiBzdHJpbmcsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgc2VsZWN0ZWRSYW5nZSwgYCR7c2VsZWN0ZWR9XFxuJHtoYXJuZXNzfWAsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gIGNvbnN0IG5hbWVzcGFjZSA9IHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlKTtcbiAgcmV0dXJuIFsuLi5zdGF0ZS5pbmNsdWRlZEltcG9ydHMsIC4uLnBhcnRzLCBuYW1lc3BhY2VdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VlZDogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjb2xsZWN0ZWQgPSBcIlwiO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgY29uc3QgdXNhZ2UgPSBhd2FpdCBpbnNwZWN0UHl0aG9uVXNhZ2UoaGF5c3RhY2ssIGhvc3QpO1xuXG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIG1vZHVsZUluZm8uZGVmaW5pdGlvbnMpIHtcbiAgICAgIGlmIChyYW5nZXNPdmVybGFwKGRlZmluaXRpb24sIHNlbGVjdGVkUmFuZ2UpIHx8ICFweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb24sIHVzYWdlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRleHQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBjb25zdCBuZXN0ZWQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICAgIGhheXN0YWNrICs9IGBcXG4ke3RleHR9XFxuYDtcbiAgICAgICAgaWYgKG5lc3RlZCkge1xuICAgICAgICAgIGhheXN0YWNrICs9IGBcXG4ke25lc3RlZH1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHtuZXN0ZWR9XFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgaW1wb3J0Tm9kZSBvZiBtb2R1bGVJbmZvLmltcG9ydHMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBjb2xsZWN0ZWQgKz0gYCR7dGV4dH1cXG5gO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gY29sbGVjdGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAoaW1wb3J0Tm9kZS5raW5kID09PSBcImZyb21cIikge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uRnJvbUltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUHl0aG9uUGxhaW5JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsb2NhbE1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGltcG9ydE5vZGUubW9kdWxlLCBpbXBvcnROb2RlLmxldmVsKTtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBpZiAoYWxpYXMubmFtZSA9PT0gXCIqXCIpIHtcbiAgICAgIGlmICghbG9jYWxNb2R1bGVQYXRoKSB7XG4gICAgICAgIGlmICh1c2VzVW5rbm93bkltcG9ydGVkTmFtZXModXNhZ2UpICYmIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCBob3N0LnJlYWRGaWxlKGxvY2FsTW9kdWxlUGF0aCk7XG4gICAgICBpZiAoIXNvdXJjZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgICBpZiAoIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgZGVmaW5pdGlvbi5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXhwb3NlZE5hbWUgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBpZiAoIXVzYWdlLm5hbWVzLmluY2x1ZGVzKGV4cG9zZWROYW1lKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VibW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgam9pblB5dGhvbk1vZHVsZShpbXBvcnROb2RlLm1vZHVsZSwgYWxpYXMubmFtZSksIGltcG9ydE5vZGUubGV2ZWwpO1xuICAgIGNvbnN0IGltcG9ydFRhcmdldFBhdGggPSBsb2NhbE1vZHVsZVBhdGggPz8gc3VibW9kdWxlUGF0aDtcbiAgICBpZiAoIWltcG9ydFRhcmdldFBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0ZWQgPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoaW1wb3J0VGFyZ2V0UGF0aCwgYWxpYXMubmFtZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICBhZGRlZCArPSBleHRyYWN0ZWQ7XG4gICAgICBpZiAoYWxpYXMuYXNuYW1lICYmIGFsaWFzLmFzbmFtZSAhPT0gYWxpYXMubmFtZSkge1xuICAgICAgICBhZGRlZCArPSBhZGRQeXRob25BbGlhcyhhbGlhcy5uYW1lLCBhbGlhcy5hc25hbWUsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2R1bGVCaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWU7XG4gICAgY29uc3QgbW9kdWxlQXR0cmlidXRlcyA9IHVzYWdlLmF0dHJpYnV0ZXNbbW9kdWxlQmluZGluZ10gPz8gW107XG4gICAgaWYgKHN1Ym1vZHVsZVBhdGggJiYgbW9kdWxlQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG1vZHVsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKHN1Ym1vZHVsZVBhdGgsIGF0dHJpYnV0ZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhtb2R1bGVCaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBjb25zdCBiaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWUuc3BsaXQoXCIuXCIpWzBdO1xuICAgIGNvbnN0IHVzZWRBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1tiaW5kaW5nXSA/PyBbXTtcbiAgICBjb25zdCBiaW5kaW5nSXNVc2VkID0gdXNhZ2UubmFtZXMuaW5jbHVkZXMoYmluZGluZykgfHwgdXNlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMDtcbiAgICBpZiAoIWJpbmRpbmdJc1VzZWQpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgYWxpYXMubmFtZSwgMCk7XG4gICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiB1c2VkQXR0cmlidXRlcykge1xuICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhiaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc3ltYm9sTmFtZTogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHZpc2l0S2V5ID0gYCR7ZmlsZVBhdGh9IyR7c3ltYm9sTmFtZX1gO1xuICBpZiAoc3RhdGUudmlzaXRpbmdTeW1ib2xzLmhhcyh2aXNpdEtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUoZmlsZVBhdGgpO1xuICBpZiAoIXNvdXJjZSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmFkZCh2aXNpdEtleSk7XG4gIHRyeSB7XG4gICAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGNhbmRpZGF0ZSkgPT4gKGNhbmRpZGF0ZS5uYW1lcyA/PyBbY2FuZGlkYXRlLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gICAgaWYgKCFkZWZpbml0aW9uKSB7XG4gICAgICByZXR1cm4gXCJcIjtcbiAgICB9XG5cbiAgICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pO1xuICAgIGNvbnN0IGRlcGVuZGVuY3lUZXh0ID0gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCB0ZXh0LCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGNvbnN0IGFkZGVkID0gYWRkUHl0aG9uUmFuZ2UobGluZXMsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCBzdGF0ZSwgcGFydHMpO1xuICAgIHJldHVybiBbZGVwZW5kZW5jeVRleHQsIGFkZGVkXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXCIpO1xuICB9IGZpbmFsbHkge1xuICAgIHN0YXRlLnZpc2l0aW5nU3ltYm9scy5kZWxldGUodmlzaXRLZXkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvblJhbmdlKFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7ZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRSYW5nZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZFJhbmdlcy5hZGQoa2V5KTtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgcmFuZ2UpO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRJbXBvcnRzLmhhcyh0ZXh0KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZEltcG9ydHMuYWRkKHRleHQpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uQWxpYXMobmFtZTogc3RyaW5nLCBhc25hbWU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSwgcGFydHM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7YXNuYW1lfT0ke25hbWV9YDtcbiAgaWYgKHN0YXRlLmFsaWFzZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5hbGlhc2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gYCR7YXNuYW1lfSA9ICR7bmFtZX1gO1xuICBwYXJ0cy5wdXNoKHRleHQpO1xuICByZXR1cm4gYCR7dGV4dH1cXG5gO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmc6IHN0cmluZywgYXR0cmlidXRlOiBzdHJpbmcsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiB2b2lkIHtcbiAgc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID0gdHJ1ZTtcbiAgY29uc3QgYXR0cmlidXRlcyA9IHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLmdldChiaW5kaW5nKSA/PyBuZXcgU2V0PHN0cmluZz4oKTtcbiAgYXR0cmlidXRlcy5hZGQoYXR0cmlidXRlKTtcbiAgc3RhdGUubmFtZXNwYWNlQmluZGluZ3Muc2V0KGJpbmRpbmcsIGF0dHJpYnV0ZXMpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQeXRob25OYW1lc3BhY2VCaW5kaW5ncyhzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogc3RyaW5nIHtcbiAgaWYgKCFzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zaXplKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IHN0YXRlLm5lZWRzTmFtZXNwYWNlUnVudGltZSA/IFtcImltcG9ydCB0eXBlcyBhcyBfbG9vbV90eXBlc1wiXSA6IFtdO1xuICBmb3IgKGNvbnN0IFtiaW5kaW5nLCBhdHRyaWJ1dGVzXSBvZiBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncykge1xuICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30gPSBfbG9vbV90eXBlcy5TaW1wbGVOYW1lc3BhY2UoKWApO1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30uJHthdHRyaWJ1dGV9ID0gJHthdHRyaWJ1dGV9YCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbzogUHl0aG9uTW9kdWxlSW5mbywgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZXhhY3QgPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGRlZmluaXRpb24pID0+IChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gIHJldHVybiBleGFjdCA/IHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9IDogbnVsbDtcbn1cblxuZnVuY3Rpb24gcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uLCB1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5zb21lKChuYW1lKSA9PiB1c2FnZS5uYW1lcy5pbmNsdWRlcyhuYW1lKSk7XG59XG5cbmZ1bmN0aW9uIHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIHVzYWdlLm5hbWVzLmxlbmd0aCA+IDA7XG59XG5cbmZ1bmN0aW9uIGpvaW5QeXRob25Nb2R1bGUobW9kdWxlTmFtZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbW9kdWxlTmFtZSA/IGAke21vZHVsZU5hbWV9LiR7bmFtZX1gIDogbmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2U6IHN0cmluZywgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxQeXRob25Nb2R1bGVJbmZvPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uTW9kdWxlSW5mbz4oc291cmNlLCBcIm1vZHVsZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvblVzYWdlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvblVzYWdlPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uVXNhZ2U+KHNvdXJjZSwgXCJ1c2FnZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuUHl0aG9uQXN0PFQ+KHNvdXJjZTogc3RyaW5nLCBtb2RlOiBcIm1vZHVsZVwiIHwgXCJ1c2FnZVwiLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUoaG9zdC5weXRob25FeGVjdXRhYmxlPy50cmltKCkgfHwgXCJweXRob24zXCIpO1xuICBjb25zdCBleGVjdXRhYmxlID0gY29tbWFuZFswXSA/PyBcInB5dGhvbjNcIjtcbiAgY29uc3QgYXJncyA9IFsuLi5jb21tYW5kLnNsaWNlKDEpLCBcIi1jXCIsIFBZVEhPTl9BU1RfSEVMUEVSXTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywgeyBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoKHN0ZGVyciB8fCBzdGRvdXQgfHwgYFB5dGhvbiBBU1QgaGVscGVyIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfS5gKS50cmltKCkpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzb2x2ZShKU09OLnBhcnNlKHN0ZG91dCkgYXMgVCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY2hpbGQuc3RkaW4uZW5kKEpTT04uc3RyaW5naWZ5KHsgbW9kZSwgc291cmNlIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRMaW5lUmFuZ2UobGluZXM6IHN0cmluZ1tdLCByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IE1hdGgubWF4KChyZWZlcmVuY2UubGluZVN0YXJ0ID8/IDEpIC0gMSwgMCk7XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKChyZWZlcmVuY2UubGluZUVuZCA/PyByZWZlcmVuY2UubGluZVN0YXJ0ID8/IGxpbmVzLmxlbmd0aCkgLSAxLCBsaW5lcy5sZW5ndGggLSAxKTtcbiAgaWYgKHN0YXJ0ID4gZW5kIHx8IHN0YXJ0ID49IGxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gZmluZFN5bWJvbFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHN5bWJvbE5hbWU6IHN0cmluZyk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSk7XG4gIGNvbnN0IGV4YWN0ID0gZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgaWYgKGV4YWN0KSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sUGF0dGVybiA9IG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChzeW1ib2xOYW1lKX1cXFxcYmApO1xuICBjb25zdCBsaW5lID0gbGluZXMuZmluZEluZGV4KChjYW5kaWRhdGUpID0+IHN5bWJvbFBhdHRlcm4udGVzdChjYW5kaWRhdGUpKTtcbiAgaWYgKGxpbmUgPCAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIGxpbmVzW2xpbmVdLmluY2x1ZGVzKFwie1wiKSA/IHsgc3RhcnQ6IGxpbmUsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGxpbmUpIH0gOiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsIHNlbGVjdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwcm9sb2d1ZSA9IGNvbGxlY3RQcm9sb2d1ZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2Uuc3RhcnQpO1xuICBjb25zdCBkZWZpbml0aW9ucyA9IGNvbGxlY3REZWZpbml0aW9ucyhsaW5lcywgbGFuZ3VhZ2UpXG4gICAgLmZpbHRlcigoZGVmaW5pdGlvbikgPT4gIXJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkpO1xuICBjb25zdCBzZWxlY3RlZERlZmluaXRpb25zID0gdHJhY2VEZWZpbml0aW9ucyhzZWxlY3RlZCwgZGVmaW5pdGlvbnMsIGxpbmVzKTtcbiAgcmV0dXJuIFsuLi5wcm9sb2d1ZSwgLi4uc2VsZWN0ZWREZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHJlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKSldXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmZ1bmN0aW9uIHRyYWNlRGVmaW5pdGlvbnMoc2VlZDogc3RyaW5nLCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdLCBsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBzZWxlY3RlZDogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGNvbnN0IHNlbGVjdGVkS2V5cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIGRlZmluaXRpb25zKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtkZWZpbml0aW9uLnN0YXJ0fToke2RlZmluaXRpb24uZW5kfToke2RlZmluaXRpb24ubmFtZX1gO1xuICAgICAgaWYgKHNlbGVjdGVkS2V5cy5oYXMoa2V5KSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLnNvbWUoKG5hbWUpID0+IHNvdXJjZVVzZXNOYW1lKGhheXN0YWNrLCBuYW1lKSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzZWxlY3RlZEtleXMuYWRkKGtleSk7XG4gICAgICBzZWxlY3RlZC5wdXNoKGRlZmluaXRpb24pO1xuICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7cmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pfVxcbmA7XG4gICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc2VsZWN0ZWQuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc3RhcnQgLSByaWdodC5zdGFydCk7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQcm9sb2d1ZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBiZWZvcmVMaW5lOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHByb2xvZ3VlOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBtYXggPSBNYXRoLm1heChiZWZvcmVMaW5lLCAwKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1heDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGlzUHJvbG9ndWVMaW5lKGxpbmUsIGxhbmd1YWdlKSkge1xuICAgICAgcHJvbG9ndWUucHVzaChsaW5lKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHByb2xvZ3VlLmxlbmd0aCA/IFtwcm9sb2d1ZS5qb2luKFwiXFxuXCIpXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBpc1Byb2xvZ3VlTGluZShsaW5lOiBzdHJpbmcsIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gL14oZnJvbVxccytcXFMrXFxzK2ltcG9ydFxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIC9eKGltcG9ydFxccyt8ZXhwb3J0XFxzKy4qXFxzK2Zyb21cXHMrfCg/OmNvbnN0fGxldHx2YXIpXFxzK1xcdytcXHMqPVxccypyZXF1aXJlXFxzKlxcKCkvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImNcIjpcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInRhcmdldCBcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwic291cmNlX2ZpbGVuYW1lXCIpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gL14obW9kdWxlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiAvXihvcGVuXFxzK3xpbmNsdWRlXFxzK3wjdXNlXFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiAvXihwYWNrYWdlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3REZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL14oPzpleHBvcnRcXHMrKT8oPzphc3luY1xccyspP2Z1bmN0aW9uXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspP2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspPyg/OmNvbnN0fGxldHx2YXIpXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMqPS8pO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lcywgZmFsc2UpO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCB0cnVlKTtcbiAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RPY2FtbERlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfGFic3RyYWN0fFxccykqXFxzKig/OmNsYXNzfGludGVyZmFjZXxlbnVtfHJlY29yZClcXHMrKFtBLVphLXpfXVxcdyopXFxifF5cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxzeW5jaHJvbml6ZWR8bmF0aXZlfFxccykrW1xcdzw+XFxbXFxdLC4/XStcXHMrKFtBLVphLXpfXVxcdyopXFxzKlxcKFteO10qXFwpXFxzKlxcey8pO1xuICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICByZXR1cm4gY29sbGVjdExsdm1EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgYXNzaWdubWVudCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihbQS1aYS16X11cXHcqKVxccypbOj1dLyk7XG4gICAgaWYgKGFzc2lnbm1lbnQpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBhc3NpZ25tZW50WzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihcXHMqKSg/OmFzeW5jXFxzKyk/KD86ZGVmfGNsYXNzKVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5kZW50ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICAgIGxldCBzdGFydCA9IGluZGV4O1xuICAgIHdoaWxlIChzdGFydCA+IDAgJiYgbGluZXNbc3RhcnQgLSAxXS50cmltKCkuc3RhcnRzV2l0aChcIkBcIikgJiYgZ2V0SW5kZW50KGxpbmVzW3N0YXJ0IC0gMV0pID09PSBpbmRlbnQpIHtcbiAgICAgIHN0YXJ0IC09IDE7XG4gICAgfVxuICAgIGxldCBlbmQgPSBpbmRleDtcbiAgICBmb3IgKGxldCBjdXJzb3IgPSBpbmRleCArIDE7IGN1cnNvciA8IGxpbmVzLmxlbmd0aDsgY3Vyc29yICs9IDEpIHtcbiAgICAgIGlmIChsaW5lc1tjdXJzb3JdLnRyaW0oKSAmJiBnZXRJbmRlbnQobGluZXNbY3Vyc29yXSkgPD0gaW5kZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZW5kID0gY3Vyc29yO1xuICAgIH1cbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWF0Y2hbMl0sIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgaXNDcHA6IGJvb2xlYW4pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGxldCBkZXB0aCA9IDA7XG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGNvbnN0IHRvcExldmVsID0gZGVwdGggPT09IDA7XG5cbiAgICBpZiAodG9wTGV2ZWwgJiYgdHJpbW1lZCkge1xuICAgICAgY29uc3QgbWFjcm8gPSB0cmltbWVkLm1hdGNoKC9eI1xccypkZWZpbmVcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgICBpZiAobWFjcm8pIHtcbiAgICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hY3JvWzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICB9IGVsc2UgaWYgKCF0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpICYmICFpc0NDb21tZW50TGluZSh0cmltbWVkKSkge1xuICAgICAgICBjb25zdCB0eXBlRGVmaW5pdGlvbiA9IG1hdGNoQ1R5cGVEZWZpbml0aW9uKGxpbmVzLCBpbmRleCwgaXNDcHApO1xuICAgICAgICBpZiAodHlwZURlZmluaXRpb24pIHtcbiAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHR5cGVEZWZpbml0aW9uKTtcbiAgICAgICAgICBpbmRleCA9IE1hdGgubWF4KGluZGV4LCB0eXBlRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uRGVmaW5pdGlvbiA9IG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lcywgaW5kZXgpO1xuICAgICAgICAgIGlmIChmdW5jdGlvbkRlZmluaXRpb24pIHtcbiAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZnVuY3Rpb25EZWZpbml0aW9uKTtcbiAgICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIGZ1bmN0aW9uRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBnbG9iYWxEZWZpbml0aW9uID0gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lLCBpbmRleCk7XG4gICAgICAgICAgICBpZiAoZ2xvYmFsRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKGdsb2JhbERlZmluaXRpb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGRlcHRoICs9IGJyYWNlRGVsdGEobGluZSk7XG4gICAgaWYgKGRlcHRoIDwgMCkge1xuICAgICAgZGVwdGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgaGVhZGVyID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyA4KSkuam9pbihcIiBcIik7XG4gIGNvbnN0IGtleXdvcmRQYXR0ZXJuID0gaXNDcHAgPyBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxjbGFzc3xlbnVtfHVuaW9uKVwiIDogXCIoPzp0eXBlZGVmXFxcXHMrKT8oPzpzdHJ1Y3R8ZW51bXx1bmlvbilcIjtcbiAgY29uc3QgbmFtZWQgPSBoZWFkZXIubWF0Y2gobmV3IFJlZ0V4cChgXlxcXFxzKiR7a2V5d29yZFBhdHRlcm59XFxcXHMrKFtBLVphLXpfXVxcXFx3KilcXFxcYmApKTtcbiAgY29uc3QgYW5vbnltb3VzVHlwZWRlZiA9IGhlYWRlci5tYXRjaCgvXlxccyp0eXBlZGVmXFxzKyg/OnN0cnVjdHxlbnVtfHVuaW9uKVxcYltcXHNcXFNdKj9cXH1cXHMqKFtBLVphLXpfXVxcdyopXFxzKjsvKTtcbiAgY29uc3QgbmFtZSA9IG5hbWVkPy5bMV0gPz8gYW5vbnltb3VzVHlwZWRlZj8uWzFdO1xuICBpZiAoIW5hbWUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGVuZCA9IGZpbmRDRGVjbGFyYXRpb25FbmQobGluZXMsIHN0YXJ0KTtcbiAgcmV0dXJuIHsgbmFtZSwgbmFtZXM6IFtuYW1lXSwgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaENGdW5jdGlvbkRlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXJMaW5lcyA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIHN0YXJ0ICsgMTIpKTtcbiAgY29uc3Qgam9pbmVkID0gaGVhZGVyTGluZXMuam9pbihcIiBcIik7XG4gIGNvbnN0IGJyYWNlT2Zmc2V0ID0gaGVhZGVyTGluZXMuZmluZEluZGV4KChsaW5lKSA9PiBsaW5lLmluY2x1ZGVzKFwie1wiKSk7XG4gIGlmIChicmFjZU9mZnNldCA8IDAgfHwgam9pbmVkLmluZGV4T2YoXCI7XCIpID49IDAgJiYgam9pbmVkLmluZGV4T2YoXCI7XCIpIDwgam9pbmVkLmluZGV4T2YoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBtYXRjaGVzID0gWy4uLmpvaW5lZC5tYXRjaEFsbCgvKFtBLVphLXpfXVxcdyooPzo6OltBLVphLXpfXVxcdyopP3xvcGVyYXRvclxccypbXlxccyhdKylcXHMqXFwoW147e31dKlxcKVxccyooPzpjb25zdFxcYltee31dKik/KD86bm9leGNlcHRcXGJbXnt9XSopPyg/Oi0+XFxzKltee31dKyk/XFx7L2cpXTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoZXNbMF0/LlsxXT8ucmVwbGFjZSgvXFxzKy9nLCBcIlwiKTtcbiAgaWYgKCFuYW1lIHx8IGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBicmFjZUxpbmUgPSBzdGFydCArIGJyYWNlT2Zmc2V0O1xuICBjb25zdCBzaG9ydE5hbWUgPSBuYW1lLmluY2x1ZGVzKFwiOjpcIikgPyBuYW1lLnNwbGl0KFwiOjpcIikucG9wKCkgPz8gbmFtZSA6IG5hbWU7XG4gIHJldHVybiB7XG4gICAgbmFtZTogc2hvcnROYW1lLFxuICAgIG5hbWVzOiBbLi4ubmV3IFNldChbc2hvcnROYW1lLCBuYW1lXSldLFxuICAgIHN0YXJ0LFxuICAgIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGJyYWNlTGluZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0dsb2JhbERlZmluaXRpb24obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZC5lbmRzV2l0aChcIjtcIikgfHwgdHJpbW1lZC5pbmNsdWRlcyhcIihcIikgfHwgL14ocmV0dXJufHVzaW5nfG5hbWVzcGFjZXx0ZW1wbGF0ZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHdpdGhvdXRJbml0aWFsaXplciA9IHRyaW1tZWQuc3BsaXQoXCI9XCIpWzBdLnJlcGxhY2UoL1xcW1teXFxdXSpdL2csIFwiXCIpO1xuICBjb25zdCBtYXRjaCA9IHdpdGhvdXRJbml0aWFsaXplci5tYXRjaCgvKFtBLVphLXpfXVxcdyopXFxzKig/OlssO118JCkvZyk/LnBvcCgpPy5tYXRjaCgvKFtBLVphLXpfXVxcdyopLyk7XG4gIGNvbnN0IG5hbWUgPSBtYXRjaD8uWzFdO1xuICBpZiAoIW5hbWUgfHwgL14oY29uc3R8c3RhdGljfGV4dGVybnx2b2xhdGlsZXx1bnNpZ25lZHxzaWduZWR8bG9uZ3xzaG9ydHxpbnR8Y2hhcnxmbG9hdHxkb3VibGV8dm9pZHxhdXRvKSQvLnRlc3QobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3Qgc3ltYm9sID0gbGluZS5tYXRjaCgvXlxccyooPzpkZWZpbmV8ZGVjbGFyZSlcXGIuKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqXFwoLyk7XG4gICAgaWYgKHN5bWJvbCkge1xuICAgICAgY29uc3QgZW5kID0gbGluZS50cmltU3RhcnQoKS5zdGFydHNXaXRoKFwiZGVmaW5lXCIpID8gZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSA6IGluZGV4O1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IHN5bWJvbFsxXSwgbmFtZXM6IFtzeW1ib2xbMV0sIGBAJHtzeW1ib2xbMV19YF0sIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZ2xvYmFsID0gbGluZS5tYXRjaCgvXlxccypAKFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSopXFxzKj0vKTtcbiAgICBpZiAoZ2xvYmFsKSB7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogZ2xvYmFsWzFdLCBuYW1lczogW2dsb2JhbFsxXSwgYEAke2dsb2JhbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihtb2R1bGV8aW1wb3J0KVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQpO1xuICAgIGlmICghbmFtZXMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlbmQgPSBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgbmFtZXNbMF0pO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihvcGVufGluY2x1ZGV8I3VzZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVzID0gZ2V0T2NhbWxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lcywgaW5kZXgsIGlzT2NhbWxUb3BMZXZlbFN0YXJ0KTtcbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbmFtZXNbMF0sIG5hbWVzLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICBpbmRleCA9IGVuZDtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgcGF0dGVybjogUmVnRXhwKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2gocGF0dGVybik7XG4gICAgY29uc3QgbmFtZSA9IG1hdGNoPy5zbGljZSgxKS5maW5kKEJvb2xlYW4pO1xuICAgIGlmICghbmFtZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lLCBzdGFydDogaW5kZXgsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghbGluZXNbc3RhcnRdLmluY2x1ZGVzKFwie1wiKSkge1xuICAgIHJldHVybiBzdGFydDtcbiAgfVxuXG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzYXdCcmFjZSAmJiBkZXB0aCA8PSAwKSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdGFydDtcbn1cblxuZnVuY3Rpb24gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgc2F3QnJhY2UgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZXNbaW5kZXhdKSB7XG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgc2F3QnJhY2UgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICgoIXNhd0JyYWNlIHx8IGRlcHRoIDw9IDApICYmIGxpbmVzW2luZGV4XS5pbmNsdWRlcyhcIjtcIikpIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBicmFjZURlbHRhKGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBkZWx0YSA9IDA7XG4gIGZvciAoY29uc3QgY2hhciBvZiBsaW5lKSB7XG4gICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICBkZWx0YSArPSAxO1xuICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgIGRlbHRhIC09IDE7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWx0YTtcbn1cblxuZnVuY3Rpb24gaXNDQ29tbWVudExpbmUodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvL1wiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvKlwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIqXCIpO1xufVxuXG5mdW5jdGlvbiBpc0NDb250cm9sS2V5d29yZChuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIFtcImlmXCIsIFwiZm9yXCIsIFwid2hpbGVcIiwgXCJzd2l0Y2hcIiwgXCJjYXRjaFwiXS5pbmNsdWRlcyhuYW1lKTtcbn1cblxuZnVuY3Rpb24gZ2V0SGFza2VsbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXHMqOjovKTtcbiAgaWYgKHNpZ25hdHVyZSkge1xuICAgIHJldHVybiBbc2lnbmF0dXJlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9eKFthLXpfXVtcXHcnXSopXFxiLio9Lyk7XG4gIGlmIChiaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtiaW5kaW5nWzFdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVMaWtlID0gdHJpbW1lZC5tYXRjaCgvXig/OmRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzKVxccysoW0EtWl1bXFx3J10qKVxcYi8pO1xuICBpZiAodHlwZUxpa2UpIHtcbiAgICByZXR1cm4gW3R5cGVMaWtlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGluc3RhbmNlID0gdHJpbW1lZC5tYXRjaCgvXmluc3RhbmNlXFxiLio/XFxiKFtBLVpdW1xcdyddKilcXGIvKTtcbiAgcmV0dXJuIGluc3RhbmNlID8gW2luc3RhbmNlWzFdXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxldEJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9ebGV0XFxzKyg/OnJlY1xccyspPyg/OlxcKChbXildKylcXCl8KFthLXpfXVtcXHcnXSopKS8pO1xuICBpZiAobGV0QmluZGluZykge1xuICAgIHJldHVybiBbbGV0QmluZGluZ1sxXSA/PyBsZXRCaW5kaW5nWzJdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXnR5cGVcXHMrKFthLXpfXVtcXHcnXSopLyk7XG4gIGlmICh0eXBlQmluZGluZykge1xuICAgIHJldHVybiBbdHlwZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgbW9kdWxlQmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15tb2R1bGVcXHMrKFtBLVpdW1xcdyddKikvKTtcbiAgaWYgKG1vZHVsZUJpbmRpbmcpIHtcbiAgICByZXR1cm4gW21vZHVsZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBmaW5kTGF5b3V0UmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc1RvcExldmVsU3RhcnQ6IChsaW5lOiBzdHJpbmcpID0+IGJvb2xlYW4pOiBudW1iZXIge1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGxpbmUudHJpbSgpICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc1RvcExldmVsU3RhcnQobGluZS50cmltKCkpKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZW5kID0gaW5kZXg7XG4gIH1cbiAgcmV0dXJuIGVuZDtcbn1cblxuZnVuY3Rpb24gZmluZEhhc2tlbGxSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgbGV0IGFsbG93TWF0Y2hpbmdFcXVhdGlvbiA9IGxpbmVzW3N0YXJ0XS50cmltKCkuc3RhcnRzV2l0aChgJHtuYW1lfSA6OmApO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0ICsgMTsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZCAmJiBnZXRJbmRlbnQobGluZSkgPT09IDAgJiYgaXNIYXNrZWxsVG9wTGV2ZWxTdGFydCh0cmltbWVkKSkge1xuICAgICAgaWYgKGFsbG93TWF0Y2hpbmdFcXVhdGlvbiAmJiB0cmltbWVkLnN0YXJ0c1dpdGgoYCR7bmFtZX0gYCkgJiYgdHJpbW1lZC5pbmNsdWRlcyhcIj1cIikpIHtcbiAgICAgICAgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gZmFsc2U7XG4gICAgICAgIGVuZCA9IGluZGV4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL14obW9kdWxlfGltcG9ydHxkYXRhfG5ld3R5cGV8dHlwZXxjbGFzc3xpbnN0YW5jZSlcXGIvLnRlc3QodHJpbW1lZClcbiAgICB8fCAvXlthLXpfXVtcXHcnXSpcXHMqKD86Ojp8Lio9KS8udGVzdCh0cmltbWVkKTtcbn1cblxuZnVuY3Rpb24gaXNPY2FtbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihvcGVufGluY2x1ZGV8I3VzZXxsZXR8dHlwZXxtb2R1bGUpXFxiLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJSYW5nZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSk6IHN0cmluZyB7XG4gIHJldHVybiBsaW5lcy5zbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kICsgMSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gcmFuZ2VzT3ZlcmxhcChsZWZ0OiBTb3VyY2VSYW5nZSwgcmlnaHQ6IFNvdXJjZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBsZWZ0LnN0YXJ0IDw9IHJpZ2h0LmVuZCAmJiByaWdodC5zdGFydCA8PSBsZWZ0LmVuZDtcbn1cblxuZnVuY3Rpb24gZ2V0SW5kZW50KGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBsaW5lLm1hdGNoKC9eXFxzKi8pPy5bMF0ubGVuZ3RoID8/IDA7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ2V4KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xufVxuXG5mdW5jdGlvbiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbjogU291cmNlRGVmaW5pdGlvbik6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGRlZmluaXRpb24ubmFtZXM/Lmxlbmd0aCA/IGRlZmluaXRpb24ubmFtZXMgOiBbZGVmaW5pdGlvbi5uYW1lXTtcbn1cblxuZnVuY3Rpb24gc291cmNlVXNlc05hbWUoc291cmNlOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAobmFtZS5zdGFydHNXaXRoKFwiQFwiKSkge1xuICAgIHJldHVybiBuZXcgUmVnRXhwKGAke2VzY2FwZVJlZ2V4KG5hbWUpfVxcXFxiYCkudGVzdChzb3VyY2UpO1xuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBcXFxcYiR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSwgcmFuZ2U6IFNvdXJjZVJhbmdlIHwgbnVsbCk6IHN0cmluZyB7XG4gIGlmIChyZWZlcmVuY2Uuc3ltYm9sTmFtZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YDtcbiAgfVxuICBpZiAocmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpMJHtyYW5nZS5zdGFydCArIDF9LUwke3JhbmdlLmVuZCArIDF9YDtcbiAgfVxuICByZXR1cm4gcmVmZXJlbmNlLmZpbGVQYXRoO1xufVxuXG5jb25zdCBQWVRIT05fQVNUX0hFTFBFUiA9IFN0cmluZy5yYXdgXG5pbXBvcnQgYXN0XG5pbXBvcnQganNvblxuaW1wb3J0IHN5c1xuXG5wYXlsb2FkID0ganNvbi5sb2FkcyhzeXMuc3RkaW4ucmVhZCgpKVxuc291cmNlID0gcGF5bG9hZC5nZXQoXCJzb3VyY2VcIiwgXCJcIilcbm1vZGUgPSBwYXlsb2FkLmdldChcIm1vZGVcIiwgXCJtb2R1bGVcIilcblxuZGVmIHJhbmdlX3N0YXJ0KG5vZGUpOlxuICAgIGxpbmVubyA9IGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSlcbiAgICBkZWNvcmF0b3JzID0gZ2V0YXR0cihub2RlLCBcImRlY29yYXRvcl9saXN0XCIsIE5vbmUpIG9yIFtdXG4gICAgaWYgZGVjb3JhdG9yczpcbiAgICAgICAgbGluZW5vID0gbWluKGxpbmVubywgKihnZXRhdHRyKGRlY29yYXRvciwgXCJsaW5lbm9cIiwgbGluZW5vKSBmb3IgZGVjb3JhdG9yIGluIGRlY29yYXRvcnMpKVxuICAgIHJldHVybiBsaW5lbm8gLSAxXG5cbmRlZiByYW5nZV9lbmQobm9kZSk6XG4gICAgcmV0dXJuIGdldGF0dHIobm9kZSwgXCJlbmRfbGluZW5vXCIsIGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSkpIC0gMVxuXG5kZWYgdGFyZ2V0X25hbWVzKHRhcmdldCk6XG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIGFzdC5OYW1lKTpcbiAgICAgICAgcmV0dXJuIFt0YXJnZXQuaWRdXG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIChhc3QuVHVwbGUsIGFzdC5MaXN0KSk6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIGl0ZW0gaW4gdGFyZ2V0LmVsdHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKGl0ZW0pKVxuICAgICAgICByZXR1cm4gbmFtZXNcbiAgICByZXR1cm4gW11cblxuZGVmIGRlZmluaXRpb25fbmFtZXMobm9kZSk6XG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkZ1bmN0aW9uRGVmLCBhc3QuQXN5bmNGdW5jdGlvbkRlZiwgYXN0LkNsYXNzRGVmKSk6XG4gICAgICAgIHJldHVybiBbbm9kZS5uYW1lXVxuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkFzc2lnbik6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIHRhcmdldCBpbiBub2RlLnRhcmdldHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKHRhcmdldCkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgKGFzdC5Bbm5Bc3NpZ24sIGFzdC5BdWdBc3NpZ24pKTpcbiAgICAgICAgcmV0dXJuIHRhcmdldF9uYW1lcyhub2RlLnRhcmdldClcbiAgICByZXR1cm4gW11cblxuZGVmIGluc3BlY3RfbW9kdWxlKHRyZWUpOlxuICAgIGRlZmluaXRpb25zID0gW11cbiAgICBpbXBvcnRzID0gW11cbiAgICBmb3Igbm9kZSBpbiB0cmVlLmJvZHk6XG4gICAgICAgIG5hbWVzID0gZGVmaW5pdGlvbl9uYW1lcyhub2RlKVxuICAgICAgICBpZiBuYW1lczpcbiAgICAgICAgICAgIGRlZmluaXRpb25zLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJuYW1lXCI6IG5hbWVzWzBdLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogbmFtZXMsXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0KTpcbiAgICAgICAgICAgIGltcG9ydHMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcImtpbmRcIjogXCJpbXBvcnRcIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogMCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkltcG9ydEZyb20pOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImZyb21cIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBub2RlLm1vZHVsZSBvciBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogbm9kZS5sZXZlbCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICByZXR1cm4ge1wiZGVmaW5pdGlvbnNcIjogZGVmaW5pdGlvbnMsIFwiaW1wb3J0c1wiOiBpbXBvcnRzfVxuXG5kZWYgYXR0cmlidXRlX2NoYWluKG5vZGUpOlxuICAgIGNoYWluID0gW11cbiAgICBjdXJyZW50ID0gbm9kZVxuICAgIHdoaWxlIGlzaW5zdGFuY2UoY3VycmVudCwgYXN0LkF0dHJpYnV0ZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmF0dHIpXG4gICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnZhbHVlXG4gICAgaWYgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuTmFtZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmlkKVxuICAgICAgICBjaGFpbi5yZXZlcnNlKClcbiAgICAgICAgcmV0dXJuIGNoYWluXG4gICAgcmV0dXJuIFtdXG5cbmNsYXNzIFVzYWdlVmlzaXRvcihhc3QuTm9kZVZpc2l0b3IpOlxuICAgIGRlZiBfX2luaXRfXyhzZWxmKTpcbiAgICAgICAgc2VsZi5uYW1lcyA9IHNldCgpXG4gICAgICAgIHNlbGYuYXR0cmlidXRlcyA9IHt9XG5cbiAgICBkZWYgdmlzaXRfTmFtZShzZWxmLCBub2RlKTpcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLmN0eCwgYXN0LkxvYWQpOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQobm9kZS5pZClcblxuICAgIGRlZiB2aXNpdF9BdHRyaWJ1dGUoc2VsZiwgbm9kZSk6XG4gICAgICAgIGNoYWluID0gYXR0cmlidXRlX2NoYWluKG5vZGUpXG4gICAgICAgIGlmIGxlbihjaGFpbikgPj0gMjpcbiAgICAgICAgICAgIHNlbGYubmFtZXMuYWRkKGNoYWluWzBdKVxuICAgICAgICAgICAgc2VsZi5hdHRyaWJ1dGVzLnNldGRlZmF1bHQoY2hhaW5bMF0sIHNldCgpKS5hZGQoY2hhaW5bMV0pXG4gICAgICAgIHNlbGYuZ2VuZXJpY192aXNpdChub2RlKVxuXG5kZWYgaW5zcGVjdF91c2FnZSh0cmVlKTpcbiAgICB2aXNpdG9yID0gVXNhZ2VWaXNpdG9yKClcbiAgICB2aXNpdG9yLnZpc2l0KHRyZWUpXG4gICAgcmV0dXJuIHtcbiAgICAgICAgXCJuYW1lc1wiOiBzb3J0ZWQodmlzaXRvci5uYW1lcyksXG4gICAgICAgIFwiYXR0cmlidXRlc1wiOiB7a2V5OiBzb3J0ZWQodmFsdWUpIGZvciBrZXksIHZhbHVlIGluIHZpc2l0b3IuYXR0cmlidXRlcy5pdGVtcygpfSxcbiAgICB9XG5cbnRyeTpcbiAgICB0cmVlID0gYXN0LnBhcnNlKHNvdXJjZSlcbmV4Y2VwdCBTeW50YXhFcnJvcjpcbiAgICBwcmludChqc29uLmR1bXBzKHtcImRlZmluaXRpb25zXCI6IFtdLCBcImltcG9ydHNcIjogW119IGlmIG1vZGUgPT0gXCJtb2R1bGVcIiBlbHNlIHtcIm5hbWVzXCI6IFtdLCBcImF0dHJpYnV0ZXNcIjoge319KSlcbiAgICByYWlzZSBTeXN0ZW1FeGl0KDApXG5cbmlmIG1vZGUgPT0gXCJtb2R1bGVcIjpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfbW9kdWxlKHRyZWUpKSlcbmVsc2U6XG4gICAgcHJpbnQoanNvbi5kdW1wcyhpbnNwZWN0X3VzYWdlKHRyZWUpKSlcbmA7XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jazogbG9vbUNvZGVCbG9jayk6IHN0cmluZyB7XG4gIGNvbnN0IGNhbGwgPSBibG9jay5zb3VyY2VSZWZlcmVuY2U/LmNhbGw7XG4gIGlmICghY2FsbCkge1xuICAgIHJldHVybiBibG9jay5jb250ZW50O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGJsb2NrLnNvdXJjZVJlZmVyZW5jZT8uc3ltYm9sTmFtZT8udHJpbSgpO1xuICBjb25zdCBpbnB1dCA9IGJsb2NrLmNvbnRlbnQudHJpbSgpO1xuICBjb25zdCBleHByZXNzaW9uID0gY2FsbC5leHByZXNzaW9uPy50cmltKClcbiAgICA/IHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZShjYWxsLmV4cHJlc3Npb24sIGlucHV0LCBzeW1ib2xOYW1lKVxuICAgIDogcmVuZGVyRGVmYXVsdFNvdXJjZUNhbGwoc3ltYm9sTmFtZSwgY2FsbC5hcmdzLCBpbnB1dCk7XG5cbiAgcmV0dXJuIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MoYmxvY2subGFuZ3VhZ2UsIGV4cHJlc3Npb24sIGNhbGwucHJpbnQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJEZWZhdWx0U291cmNlQ2FsbChzeW1ib2xOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGFyZ3M6IHN0cmluZyB8IHVuZGVmaW5lZCwgaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghc3ltYm9sTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxvb20tY2FsbCBuZWVkcyBsb29tLXN5bWJvbCB3aGVuIG5vIGNhbGwgZXhwcmVzc2lvbiBpcyBwcm92aWRlZC5cIik7XG4gIH1cblxuICBjb25zdCByZW5kZXJlZEFyZ3MgPSByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUoYXJncz8udHJpbSgpIHx8IFwie2lucHV0fVwiLCBpbnB1dCwgc3ltYm9sTmFtZSk7XG4gIHJldHVybiBgJHtzeW1ib2xOYW1lfSgke3JlbmRlcmVkQXJnc30pYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKHRlbXBsYXRlOiBzdHJpbmcsIGlucHV0OiBzdHJpbmcsIHN5bWJvbE5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZVxuICAgIC5yZXBsYWNlQWxsKFwie2lucHV0fVwiLCBpbnB1dClcbiAgICAucmVwbGFjZUFsbChcIntzeW1ib2x9XCIsIHN5bWJvbE5hbWUgPz8gXCJcIik7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nLCBwcmludDogYm9vbGVhbik6IHN0cmluZyB7XG4gIGlmICghcHJpbnQpIHtcbiAgICByZXR1cm4gcmVuZGVyRXhwcmVzc2lvblN0YXRlbWVudChsYW5ndWFnZSwgZXhwcmVzc2lvbik7XG4gIH1cblxuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGBwcmludCgke2V4cHJlc3Npb259KWA7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGBjb25zb2xlLmxvZygke2V4cHJlc3Npb259KTtgO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gYCNpbmNsdWRlIDxzdGRpby5oPlxcbmludCBtYWluKHZvaWQpIHsgcHJpbnRmKFwiJWRcXFxcblwiLCAke2V4cHJlc3Npb259KTsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBgI2luY2x1ZGUgPGlvc3RyZWFtPlxcbmludCBtYWluKCkgeyBzdGQ6OmNvdXQgPDwgKCR7ZXhwcmVzc2lvbn0pIDw8IFwiXFxcXG5cIjsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGBsZXQgKCkgPSBwcmludF9lbmRsaW5lICgke2V4cHJlc3Npb259KWA7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbG9vbS1jYWxsIGNhbm5vdCBnZW5lcmF0ZSBhIHByaW50ZWQgaGFybmVzcyBmb3IgJHtsYW5ndWFnZX0uIFVzZSBsb29tLXByaW50PWZhbHNlIG9yIHdyaXRlIHRoZSBoYXJuZXNzIGluIHRoZSBibG9jayBib2R5LmApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlckV4cHJlc3Npb25TdGF0ZW1lbnQobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBleHByZXNzaW9uO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZXhwcmVzc2lvbi5lbmRzV2l0aChcIjtcIikgPyBleHByZXNzaW9uIDogYCR7ZXhwcmVzc2lvbn07YDtcbiAgfVxufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlSW5wdXQ6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBzdGRpbiBpbnB1dFwiLCBcInRleHQtY3Vyc29yLWlucHV0XCIsIGhhbmRsZXJzLm9uVG9nZ2xlSW5wdXQsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiQ29weSBjb2RlXCIsIFwiY29weVwiLCBoYW5kbGVycy5vbkNvcHksIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUmVtb3ZlIHNuaXBwZXRcIiwgXCJ0cmFzaC0yXCIsIGhhbmRsZXJzLm9uUmVtb3ZlLCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBvdXRwdXRcIiwgXCJwYW5lbC1ib3R0b20tb3BlblwiLCBoYW5kbGVycy5vblRvZ2dsZU91dHB1dCwgZmFsc2UpKTtcblxuICByZXR1cm4gdG9vbGJhcjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnV0dG9uKGxhYmVsOiBzdHJpbmcsIGljb25OYW1lOiBzdHJpbmcsIG9uQ2xpY2s6ICgpID0+IHZvaWQsIHNwaW5uaW5nOiBib29sZWFuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICBjb25zdCBidXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICBidXR0b24uY2xhc3NOYW1lID0gYGxvb20tdG9vbGJhci1idXR0b24ke3NwaW5uaW5nID8gXCIgaXMtcnVubmluZ1wiIDogXCJcIn1gO1xuICBidXR0b24udHlwZSA9IFwiYnV0dG9uXCI7XG4gIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGxhYmVsKTtcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIG9uQ2xpY2soKTtcbiAgfSk7XG4gIHNldEljb24oYnV0dG9uLCBpY29uTmFtZSk7XG4gIHJldHVybiBidXR0b247XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBsb29tT3V0cHV0UGFuZWxPcHRpb25zIHtcbiAgZGVmYXVsdFZpc2libGVMaW5lczogbnVtYmVyO1xufVxuXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICByZXR1cm4gb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpIHx8IG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpID8gXCJ3YXJuaW5nXCIgOiBcInN1Y2Nlc3NcIjtcbiAgfVxuXG4gIHJldHVybiBcImZhaWx1cmVcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgb3B0aW9uczogbG9vbU91dHB1dFBhbmVsT3B0aW9ucyk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtnZXRTdGF0dXNLaW5kKG91dHB1dCl9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn1gO1xuICBwYW5lbC5kYXRhc2V0Lmxvb21CbG9ja0lkID0gb3V0cHV0LmJsb2NrSWQ7XG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQsIG9wdGlvbnMpO1xuICByZXR1cm4gcGFuZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJPdXRwdXRQYW5lbChwYW5lbDogSFRNTEVsZW1lbnQsIG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgb3B0aW9uczogbG9vbU91dHB1dFBhbmVsT3B0aW9ucyk6IHZvaWQge1xuICBjb25zdCBraW5kID0gZ2V0U3RhdHVzS2luZChvdXRwdXQpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XG4gIHBhbmVsLmVtcHR5KCk7XG4gIGNvbnN0IHZpc2libGVMaW5lcyA9IHJlc29sdmVWaXNpYmxlTGluZXMob3V0cHV0LCBvcHRpb25zLmRlZmF1bHRWaXNpYmxlTGluZXMpO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3QgYmFkZ2UgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJhZGdlXCIgfSk7XG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xuXG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xuXG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcblxuICBjb25zdCBib2R5ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJvZHlcIiB9KTtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZG91dFwiLCBvdXRwdXQucmVzdWx0LnN0ZG91dCwgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZywgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3RkZXJyXCIsIG91dHB1dC5yZXN1bHQuc3RkZXJyLCB2aXNpYmxlTGluZXMpO1xuICB9XG4gIGlmIChvdXRwdXQuc291cmNlUHJldmlldz8uY29udGVudC50cmltKCkpIHtcbiAgICBjcmVhdGVTb3VyY2VQcmV2aWV3KGJvZHksIG91dHB1dC5zb3VyY2VQcmV2aWV3KTtcbiAgfVxuICBpZiAoIW91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSAmJiAhb3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY29uc3QgZW1wdHkgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1lbXB0eVwiIH0pO1xuICAgIGVtcHR5LnNldFRleHQoXCJObyBvdXRwdXRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZywgdmlzaWJsZUxpbmVzOiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtXCIgfSk7XG4gIGNvbnN0IGxpbmVDb3VudCA9IGNvdW50TGluZXMoY29udGVudCk7XG4gIHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbS1sYWJlbFwiLCB0ZXh0OiBmb3JtYXRTdHJlYW1MYWJlbChsYWJlbCwgbGluZUNvdW50LCB2aXNpYmxlTGluZXMpIH0pO1xuICBjb25zdCBwcmUgPSBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xuICBpZiAodmlzaWJsZUxpbmVzID4gMCAmJiBsaW5lQ291bnQgPiB2aXNpYmxlTGluZXMpIHtcbiAgICBwcmUuYWRkQ2xhc3MoXCJpcy1zY3JvbGwtbGltaXRlZFwiKTtcbiAgICBwcmUuc3R5bGUuc2V0UHJvcGVydHkoXCItLWxvb20tb3V0cHV0LXZpc2libGUtbGluZXNcIiwgU3RyaW5nKHZpc2libGVMaW5lcykpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZVByZXZpZXcoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgcHJldmlldzogTm9uTnVsbGFibGU8bG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0+KTogdm9pZCB7XG4gIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXIuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXdcIiB9KTtcbiAgZGV0YWlscy5vcGVuID0gcHJldmlldy5leHBhbmRlZDtcbiAgY29uc3Qgc3VtbWFyeSA9IGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXctc3VtbWFyeVwiIH0pO1xuICBzdW1tYXJ5LmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIkV4dHJhY3RlZCBzb3VyY2VcIiB9KTtcbiAgc3VtbWFyeS5jcmVhdGVTcGFuKHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXctbWV0YVwiLCB0ZXh0OiBmb3JtYXRTb3VyY2VQcmV2aWV3TWV0YShwcmV2aWV3KSB9KTtcbiAgZGV0YWlscy5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmUgbG9vbS1zb3VyY2UtcHJldmlldy1wcmVcIiwgdGV4dDogcHJldmlldy5jb250ZW50IH0pO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTb3VyY2VQcmV2aWV3TWV0YShwcmV2aWV3OiBOb25OdWxsYWJsZTxsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXT4pOiBzdHJpbmcge1xuICBjb25zdCBjYXBhYmlsaXR5ID0gcHJldmlldy5jYXBhYmlsaXR5O1xuICBpZiAoIWNhcGFiaWxpdHkgfHwgIXByZXZpZXcuc2hvd0NhcGFiaWxpdHlNZXRhZGF0YSkge1xuICAgIHJldHVybiBgJHtwcmV2aWV3Lmxhbmd1YWdlfSBcdTAwQjcgJHtwcmV2aWV3LmRlc2NyaXB0aW9ufWA7XG4gIH1cbiAgcmV0dXJuIFtcbiAgICBwcmV2aWV3Lmxhbmd1YWdlLFxuICAgIHByZXZpZXcuZGVzY3JpcHRpb24sXG4gICAgYHN5bWJvbHM6JHtjYXBhYmlsaXR5LnN5bWJvbEV4dHJhY3Rpb259YCxcbiAgICBgZGVwczoke2NhcGFiaWxpdHkuZGVwZW5kZW5jeVRyYWNpbmd9YCxcbiAgICBgY2FsbDoke2NhcGFiaWxpdHkuY2FsbEhhcm5lc3N9YCxcbiAgXS5qb2luKFwiIFx1MDBCNyBcIik7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVWaXNpYmxlTGluZXMob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0LCBkZWZhdWx0VmlzaWJsZUxpbmVzOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBvdmVycmlkZSA9IG91dHB1dC5ibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtbGluZXNcIl0gPz8gb3V0cHV0LmJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtbGluZXNcIl07XG4gIGlmIChvdmVycmlkZSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVZpc2libGVMaW5lcyhOdW1iZXIucGFyc2VJbnQob3ZlcnJpZGUudHJpbSgpLCAxMCkpO1xuICB9XG4gIHJldHVybiBub3JtYWxpemVWaXNpYmxlTGluZXMoZGVmYXVsdFZpc2libGVMaW5lcyk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVZpc2libGVMaW5lcyh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuICByZXR1cm4gTWF0aC5taW4oTWF0aC5mbG9vcih2YWx1ZSksIDIwMDApO1xufVxuXG5mdW5jdGlvbiBjb3VudExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBjb250ZW50LnJlcGxhY2UoL1xcbiQvLCBcIlwiKS5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFN0cmVhbUxhYmVsKGxhYmVsOiBzdHJpbmcsIGxpbmVDb3VudDogbnVtYmVyLCB2aXNpYmxlTGluZXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmICh2aXNpYmxlTGluZXMgPiAwICYmIGxpbmVDb3VudCA+IHZpc2libGVMaW5lcykge1xuICAgIHJldHVybiBgJHtsYWJlbH0gXHUwMEI3ICR7bGluZUNvdW50fSBsaW5lcyBcdTAwQjcgc2hvd2luZyAke3Zpc2libGVMaW5lc31gO1xuICB9XG4gIHJldHVybiBsYWJlbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJ1bm5pbmdQYW5lbCgpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLW91dHB1dC1wYW5lbCBpcy1ydW5uaW5nXCI7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBzcGlubmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNwaW5uZXJcIiB9KTtcbiAgc2V0SWNvbihzcGlubmVyLCBcImxvYWRlci1jaXJjbGVcIik7XG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KFwiUnVubmluZ1wiKTtcbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoXCJFeGVjdXRpbmcuLi5cIik7XG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1oaWRkZW5cIiwgXCJ0cnVlXCIpO1xuXG4gIHJldHVybiBwYW5lbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6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S0FBSyxRQUFRLEdBQUc7QUFDckUsV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPLEtBQUssSUFBSSxLQUFLLE1BQU0sS0FBSyxHQUFHLEdBQUc7QUFDeEM7QUFFQSxTQUFTLHVCQUF1QixPQUFnQixVQUEwQjtBQUN4RSxTQUFPLE9BQU8sVUFBVSxXQUFXLFFBQVE7QUFDN0M7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfdmlldyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2NoaWxkX3Byb2Nlc3MiLCAicG9zaXhQYXRoIiwgIm5vcm1hbGl6ZUZzUGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAiYWxpYXNlcyIsICJnZXRMZWFkaW5nV2hpdGVzcGFjZSIsICJwYXJzZVBvc2l0aXZlSW50ZWdlciIsICJpc0Rpc2FibGVkVmFsdWUiLCAibm9ybWFsaXplRXh0ZW5zaW9uIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9mcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAibG9vbVBsdWdpbiIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X29zIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iXQp9Cg==
