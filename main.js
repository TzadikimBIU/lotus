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
  if (!Array.isArray(settings.externalLanguagePacks)) {
    settings.externalLanguagePacks = [];
  }
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
  return getAvailableLanguagePackages(settings).filter((pack) => enabledPacks.has(pack.id)).flatMap((pack) => pack.languages).filter((language) => enabledLanguages.has(language.id));
}
function getAvailableLanguagePackages(settings) {
  normalizeLanguageConfiguration(settings);
  return [
    ...BUILT_IN_LANGUAGE_PACKAGES,
    ...(settings.externalLanguagePacks ?? []).map((pack) => ({
      id: pack.id,
      displayName: pack.displayName,
      description: pack.description,
      languages: pack.languages.map((language) => ({
        id: language.name,
        displayName: language.displayName || language.name,
        aliases: parseAliasList(language.aliases)
      }))
    }))
  ];
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
function getEnabledCommandLanguages(settings) {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);
  const customLanguages = areCustomLanguagesEnabled(settings) ? settings.customLanguages ?? [] : [];
  const externalLanguages = (settings.externalLanguagePacks ?? []).filter((pack) => enabledPacks.has(pack.id)).flatMap((pack) => pack.languages).filter((language) => enabledLanguages.has(language.name));
  return [...customLanguages, ...externalLanguages];
}
function findEnabledCommandLanguage(settings, normalizedLanguage, sourceAlias) {
  const normalized = normalizedLanguage.trim().toLowerCase();
  const alias = sourceAlias?.trim().toLowerCase();
  return getEnabledCommandLanguages(settings).find((language) => {
    const name = language.name.trim().toLowerCase();
    const aliases = parseAliasList(language.aliases);
    return name === normalized || aliases.includes(normalized) || Boolean(alias && (name === alias || aliases.includes(alias)));
  });
}
function parseAliasList(value) {
  return (value ?? "").split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
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
          if (config.elevation.mode === "root") {
            pieces.push(config.elevation.commandPrefix ? `elevation: root via ${config.elevation.commandPrefix}` : "elevation: root");
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
      if (config.elevation.mode === "root") {
        const elevationMsg = `[Loom] Container elevation: root${config.elevation.commandPrefix ? ` via ${config.elevation.commandPrefix}` : ""}.`;
        result.warning = result.warning ? `${result.warning}
${elevationMsg}` : elevationMsg;
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
        ...this.ociElevationArgs(config),
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
      const remoteCommand = this.applyCommandPrefix(config, language.command.replaceAll("{file}", shellQuote(remoteFile)));
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
    const command = this.applyCommandPrefix(config, language.command.replaceAll("{file}", tempFileName));
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
    const command = this.applyCommandPrefix(config, language.command.replaceAll("{file}", tempFileName));
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
      elevation: this.readElevationConfig(data.elevation),
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
  readElevationConfig(value) {
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
    const data = value;
    const mode = data.mode == null ? "default" : data.mode;
    if (mode !== "default" && mode !== "root") {
      throw new Error("Container config elevation.mode must be default or root.");
    }
    return {
      mode,
      commandPrefix: optionalString(data.commandPrefix)
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
  ociElevationArgs(config) {
    return config.elevation.mode === "root" ? ["--user", "root"] : [];
  }
  applyCommandPrefix(config, command) {
    const prefix = config.elevation.mode === "root" ? config.elevation.commandPrefix?.trim() : "";
    return prefix ? `${prefix} ${command}` : command;
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
        healthCheck: config.healthCheck,
        elevation: config.elevation
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
    const custom = findEnabledCommandLanguage(settings, normalized);
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

// src/parser.ts
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  if (!settings) {
    return null;
  }
  const commandLanguage = findEnabledCommandLanguage(settings, normalized);
  if (commandLanguage) {
    return commandLanguage.name.trim();
  }
  const aliases = getEnabledLanguageAliasMap(settings);
  return aliases[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  if (!settings) {
    return [];
  }
  const customAliases = getEnabledCommandLanguages(settings).flatMap((language) => {
    const name = language.name.trim().toLowerCase();
    return [name, ...parseAliasList2(language.aliases)];
  });
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
function parseAliasList2(value) {
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
    return findEnabledCommandLanguage(settings, block.language, block.languageAlias);
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
    return Boolean(findEnabledCommandLanguage(settings, block.language, block.languageAlias));
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
  externalLanguagePacks: [],
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
    for (const pack of getAvailableLanguagePackages(this.loomPlugin.settings)) {
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
    new import_obsidian3.Setting(containerEl).setName("Reload external language packs").setDesc("Load JSON language pack manifests from the plugin language-packs folder.").addButton(
      (button) => button.setButtonText("Reload").onClick(async () => {
        await this.loomPlugin.loadExternalLanguagePacks(true);
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
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
    if (!this.configObj.elevation || typeof this.configObj.elevation !== "object") {
      this.configObj.elevation = { mode: "default" };
    }
    new import_obsidian3.Setting(containerEl).setName("Elevation").setDesc(
      this.configObj.runtime === "docker" || this.configObj.runtime === "podman" ? "Run snippets with the image default user, or force root with --user root." : "Keep default privileges, or mark this group as elevated and optionally prefix commands."
    ).addDropdown((dropdown) => {
      dropdown.addOption("default", "Default").addOption("root", "Root").setValue(this.configObj.elevation.mode || "default").onChange((value) => {
        this.configObj.elevation.mode = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.elevation.mode === "root" && (this.configObj.runtime === "qemu" || this.configObj.runtime === "wsl" || this.configObj.runtime === "custom")) {
      new import_obsidian3.Setting(containerEl).setName("Elevation command prefix").setDesc("Optional prefix for remote or wrapper commands, for example sudo -n. Loom does not prompt for passwords.").addText((text) => {
        text.setPlaceholder("sudo -n").setValue(this.configObj.elevation.commandPrefix || "").onChange((val) => {
          this.configObj.elevation.commandPrefix = val.trim() || void 0;
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
var EXTERNAL_LANGUAGE_PACK_DIR = "language-packs";
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
    await this.loadExternalLanguagePacks();
    this.normalizeSettings();
  }
  async loadExternalLanguagePacks(showNotice = false) {
    const packDir = (0, import_obsidian6.normalizePath)(`${this.manifest.dir ?? ".obsidian/plugins/loom"}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
    const adapter = this.app.vault.adapter;
    const packs = [];
    let failures = 0;
    try {
      if (!await adapter.exists(packDir)) {
        this.settings.externalLanguagePacks = [];
        if (showNotice) {
          await adapter.mkdir(packDir);
          new import_obsidian6.Notice(`Created external language pack folder at ${packDir}`);
        }
        return;
      }
      const listed = await adapter.list(packDir);
      const files = listed.files.filter((path) => path.toLowerCase().endsWith(".json")).sort((a, b) => a.localeCompare(b));
      for (const filePath of files) {
        try {
          const parsed = parseExternalLanguagePack(JSON.parse(await adapter.read(filePath)), filePath);
          if (parsed) {
            packs.push(parsed);
          } else {
            failures += 1;
          }
        } catch (error) {
          failures += 1;
          console.warn(`Failed to load loom language pack ${filePath}`, error);
        }
      }
    } catch (error) {
      this.settings.externalLanguagePacks = [];
      console.warn(`Failed to scan loom language packs in ${packDir}`, error);
      if (showNotice) {
        new import_obsidian6.Notice(`Failed to load external language packs from ${packDir}`);
      }
      return;
    }
    this.settings.externalLanguagePacks = packs;
    if (showNotice) {
      const suffix = failures ? `, ${failures} failed` : "";
      new import_obsidian6.Notice(`Loaded ${packs.length} external language pack${packs.length === 1 ? "" : "s"}${suffix}`);
    }
  }
  async saveSettings() {
    this.normalizeSettings();
    const persistedSettings = { ...this.settings };
    delete persistedSettings.externalLanguagePacks;
    await this.saveData(persistedSettings);
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
    const language = findEnabledCommandLanguage(this.settings, block.language, block.languageAlias);
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
function parseExternalLanguagePack(value, filePath) {
  if (!isRecord(value)) {
    console.warn(`Ignoring loom language pack ${filePath}: manifest must be an object`);
    return null;
  }
  const rawId = readString(value.id);
  const id = normalizeManifestId(rawId);
  if (!id) {
    console.warn(`Ignoring loom language pack ${filePath}: missing package id`);
    return null;
  }
  if (!Array.isArray(value.languages)) {
    console.warn(`Ignoring loom language pack ${filePath}: languages must be an array`);
    return null;
  }
  const languages = value.languages.map((language) => parseExternalLanguage(language, filePath)).filter((language) => Boolean(language));
  if (!languages.length) {
    console.warn(`Ignoring loom language pack ${filePath}: no valid languages`);
    return null;
  }
  return {
    id: `external:${id}`,
    displayName: readString(value.displayName) || rawId,
    description: readString(value.description) || `External language pack from ${filePath}`,
    languages
  };
}
function parseExternalLanguage(value, filePath) {
  if (!isRecord(value)) {
    console.warn(`Ignoring language entry in ${filePath}: entry must be an object`);
    return null;
  }
  const rawName = readString(value.id) || readString(value.name);
  const name = normalizeManifestId(rawName);
  const executable = readString(value.executable);
  if (!name || !executable) {
    console.warn(`Ignoring language entry in ${filePath}: language id/name and executable are required`);
    return null;
  }
  return {
    name,
    displayName: readString(value.displayName) || rawName,
    description: readString(value.description),
    aliases: readAliasList(value.aliases, name).join(", "),
    executable,
    args: readString(value.args) || "{file}",
    extension: normalizeExtension3(readString(value.extension), name),
    extractorMode: readString(value.extractorMode) === "transpile-c" ? "transpile-c" : "command",
    extractorExecutable: readString(value.extractorExecutable),
    extractorArgs: readString(value.extractorArgs) || "{request}",
    transpileExecutable: readString(value.transpileExecutable),
    transpileArgs: readString(value.transpileArgs) || "{request}"
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function readAliasList(value, name) {
  const aliases = Array.isArray(value) ? value.flatMap((alias) => readString(alias).split(",")) : readString(value).split(",");
  return aliases.map((alias) => normalizeManifestId(alias)).filter((alias, index, list) => Boolean(alias) && alias !== name && list.indexOf(alias) === index);
}
function normalizeManifestId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/^-+|-+$/g, "");
}
function normalizeExtension3(value, name) {
  if (!value) {
    return `.${name}`;
  }
  return value.startsWith(".") ? value : `.${value}`;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgZmluZEVuYWJsZWRDb21tYW5kTGFuZ3VhZ2UsIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbiB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgRWJwZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvZWJwZlwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTIH0gZnJvbSBcIi4vZGVmYXVsdFNldHRpbmdzXCI7XG5pbXBvcnQgeyBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IHJlc29sdmVSZWZlcmVuY2VkU291cmNlIH0gZnJvbSBcIi4vc291cmNlRXh0cmFjdFwiO1xuaW1wb3J0IHsgYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzIH0gZnJvbSBcIi4vc291cmNlSGFybmVzc1wiO1xuaW1wb3J0IHsgY3JlYXRlQ29kZUJsb2NrVG9vbGJhciB9IGZyb20gXCIuL3VpL2NvZGVCbG9ja1Rvb2xiYXJcIjtcbmltcG9ydCB7IGNyZWF0ZU91dHB1dFBhbmVsLCBjcmVhdGVSdW5uaW5nUGFuZWwgfSBmcm9tIFwiLi91aS9vdXRwdXRQYW5lbFwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUV4dGVybmFsTGFuZ3VhZ2UsIGxvb21FeHRlcm5hbExhbmd1YWdlUGFjaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0LCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcbmNvbnN0IEVYVEVSTkFMX0xBTkdVQUdFX1BBQ0tfRElSID0gXCJsYW5ndWFnZS1wYWNrc1wiO1xudHlwZSBsb29tT3V0cHV0RmlsZU1vZGUgPSBcInJlcGxhY2VcIiB8IFwiYXBwZW5kXCI7XG50eXBlIGxvb21PdXRwdXRGaWxlRm9ybWF0ID0gXCJ0ZXh0XCIgfCBcImpzb25cIjtcbnR5cGUgbG9vbU91dHB1dEZpbGVTdHJlYW0gPSBcInN0ZG91dFwiIHwgXCJzdGRlcnJcIiB8IFwid2FybmluZ1wiIHwgXCJtZXRhZGF0YVwiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dEZpbGVUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG1vZGU6IGxvb21PdXRwdXRGaWxlTW9kZTtcbiAgZm9ybWF0OiBsb29tT3V0cHV0RmlsZUZvcm1hdDtcbiAgc3RyZWFtczogbG9vbU91dHB1dEZpbGVTdHJlYW1bXTtcbn1cblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2ssIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jaywgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgRWJwZlJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGRpbklucHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RkaW5QYW5lbHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLmxvYWRFeHRlcm5hbExhbmd1YWdlUGFja3MoKTtcbiAgICB0aGlzLm5vcm1hbGl6ZVNldHRpbmdzKCk7XG4gIH1cblxuICBhc3luYyBsb2FkRXh0ZXJuYWxMYW5ndWFnZVBhY2tzKHNob3dOb3RpY2UgPSBmYWxzZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBhY2tEaXIgPSBub3JtYWxpemVQYXRoKGAke3RoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwifS8ke0VYVEVSTkFMX0xBTkdVQUdFX1BBQ0tfRElSfWApO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IHBhY2tzOiBsb29tRXh0ZXJuYWxMYW5ndWFnZVBhY2tbXSA9IFtdO1xuICAgIGxldCBmYWlsdXJlcyA9IDA7XG5cbiAgICB0cnkge1xuICAgICAgaWYgKCEoYXdhaXQgYWRhcHRlci5leGlzdHMocGFja0RpcikpKSB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZXh0ZXJuYWxMYW5ndWFnZVBhY2tzID0gW107XG4gICAgICAgIGlmIChzaG93Tm90aWNlKSB7XG4gICAgICAgICAgYXdhaXQgYWRhcHRlci5ta2RpcihwYWNrRGlyKTtcbiAgICAgICAgICBuZXcgTm90aWNlKGBDcmVhdGVkIGV4dGVybmFsIGxhbmd1YWdlIHBhY2sgZm9sZGVyIGF0ICR7cGFja0Rpcn1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxpc3RlZCA9IGF3YWl0IGFkYXB0ZXIubGlzdChwYWNrRGlyKTtcbiAgICAgIGNvbnN0IGZpbGVzID0gbGlzdGVkLmZpbGVzXG4gICAgICAgIC5maWx0ZXIoKHBhdGgpID0+IHBhdGgudG9Mb3dlckNhc2UoKS5lbmRzV2l0aChcIi5qc29uXCIpKVxuICAgICAgICAuc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKTtcblxuICAgICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBmaWxlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRXh0ZXJuYWxMYW5ndWFnZVBhY2soSlNPTi5wYXJzZShhd2FpdCBhZGFwdGVyLnJlYWQoZmlsZVBhdGgpKSwgZmlsZVBhdGgpO1xuICAgICAgICAgIGlmIChwYXJzZWQpIHtcbiAgICAgICAgICAgIHBhY2tzLnB1c2gocGFyc2VkKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZmFpbHVyZXMgKz0gMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgZmFpbHVyZXMgKz0gMTtcbiAgICAgICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBsb2FkIGxvb20gbGFuZ3VhZ2UgcGFjayAke2ZpbGVQYXRofWAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnNldHRpbmdzLmV4dGVybmFsTGFuZ3VhZ2VQYWNrcyA9IFtdO1xuICAgICAgY29uc29sZS53YXJuKGBGYWlsZWQgdG8gc2NhbiBsb29tIGxhbmd1YWdlIHBhY2tzIGluICR7cGFja0Rpcn1gLCBlcnJvcik7XG4gICAgICBpZiAoc2hvd05vdGljZSkge1xuICAgICAgICBuZXcgTm90aWNlKGBGYWlsZWQgdG8gbG9hZCBleHRlcm5hbCBsYW5ndWFnZSBwYWNrcyBmcm9tICR7cGFja0Rpcn1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnNldHRpbmdzLmV4dGVybmFsTGFuZ3VhZ2VQYWNrcyA9IHBhY2tzO1xuICAgIGlmIChzaG93Tm90aWNlKSB7XG4gICAgICBjb25zdCBzdWZmaXggPSBmYWlsdXJlcyA/IGAsICR7ZmFpbHVyZXN9IGZhaWxlZGAgOiBcIlwiO1xuICAgICAgbmV3IE5vdGljZShgTG9hZGVkICR7cGFja3MubGVuZ3RofSBleHRlcm5hbCBsYW5ndWFnZSBwYWNrJHtwYWNrcy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9JHtzdWZmaXh9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubm9ybWFsaXplU2V0dGluZ3MoKTtcbiAgICBjb25zdCBwZXJzaXN0ZWRTZXR0aW5nczogUGFydGlhbDxsb29tUGx1Z2luU2V0dGluZ3M+ID0geyAuLi50aGlzLnNldHRpbmdzIH07XG4gICAgZGVsZXRlIHBlcnNpc3RlZFNldHRpbmdzLmV4dGVybmFsTGFuZ3VhZ2VQYWNrcztcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHBlcnNpc3RlZFNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMubm90aWZ5QWxsT3V0cHV0c0NoYW5nZWQoKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgaXNCbG9ja1J1bm5pbmcoYmxvY2tJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMucnVubmluZy5oYXMoYmxvY2tJZCk7XG4gIH1cblxuICByZWdpc3Rlck91dHB1dExpc3RlbmVyKGJsb2NrSWQ6IHN0cmluZywgbGlzdGVuZXI6ICgpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICBpZiAoIXRoaXMub3V0cHV0TGlzdGVuZXJzLmhhcyhibG9ja0lkKSkge1xuICAgICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuc2V0KGJsb2NrSWQsIG5ldyBTZXQoKSk7XG4gICAgfVxuICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uYWRkKGxpc3RlbmVyKTtcbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5kZWxldGUobGlzdGVuZXIpO1xuICAgIH07XG4gIH1cblxuICBjcmVhdGVUb29sYmFyRWxlbWVudChibG9jazogbG9vbUNvZGVCbG9jayk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihibG9jay5pZCwgdGhpcy5pc0Jsb2NrUnVubmluZyhibG9jay5pZCksIHtcbiAgICAgIG9uUnVuOiAoKSA9PiB2b2lkIHRoaXMucnVuQWN0aXZlQmxvY2tCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uQ29weTogYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KGJsb2NrLmNvbnRlbnQpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb2RlIGNvcGllZFwiKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNsaXBib2FyZCB3cml0ZSBmYWlsZWQuXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb25SZW1vdmU6ICgpID0+IHZvaWQgdGhpcy5yZW1vdmVTbmlwcGV0QnlJZChibG9jay5pZCksXG4gICAgICBvblRvZ2dsZUlucHV0OiAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnN0ZGluUGFuZWxzLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICB0aGlzLnN0ZGluUGFuZWxzLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5zdGRpblBhbmVscy5hZGQoYmxvY2suaWQpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB9LFxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9jay5pZCk7XG4gICAgICAgIGlmICghb3V0cHV0KSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG91dHB1dC52aXNpYmxlID0gIW91dHB1dC52aXNpYmxlO1xuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlck91dHB1dEludG8oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICBjb25zdCBibG9ja0lkID0gYmxvY2suaWQ7XG5cbiAgICBpZiAodGhpcy5zaG91bGRSZW5kZXJTdGRpblBhbmVsKGJsb2NrKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHRoaXMuY3JlYXRlU3RkaW5QYW5lbChibG9jaykpO1xuICAgIH1cblxuICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk7XG4gICAgaWYgKHRoaXMucnVubmluZy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVSdW5uaW5nUGFuZWwoKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFvdXRwdXQgfHwgIW91dHB1dC52aXNpYmxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dCwge1xuICAgICAgZGVmYXVsdFZpc2libGVMaW5lczogdGhpcy5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMgPz8gMCxcbiAgICB9KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gYmxvY2tzLmZpbHRlcigoYmxvY2spID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgcmV0dXJuIGV4ZWN1dGlvbkNvbnRleHQuY29udGFpbmVyR3JvdXAgfHwgdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgfSk7XG5cbiAgICBpZiAoIXN1cHBvcnRlZEJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9ja3MgZm91bmQgaW4gdGhlIGN1cnJlbnQgbm90ZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBibG9jayBvZiBzdXBwb3J0ZWRCbG9ja3MpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNsZWFyT3V0cHV0c0ZvckZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZS5wYXRoLCBibG9jay5pZCk7XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXCJsb29tIG91dHB1dHMgY2xlYXJlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5CbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gZmlsZS5wYXRoO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgbmV3IE5vdGljZShcIlRoaXMgbG9vbSBibG9jayBpcyBhbHJlYWR5IHJ1bm5pbmcuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghKGF3YWl0IHRoaXMuZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpKSkge1xuICAgICAgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSBleGVjdXRpb25Db250ZXh0LmNvbnRhaW5lckdyb3VwO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3Qgc3RkaW4gPSBhd2FpdCB0aGlzLnJlc29sdmVCbG9ja1N0ZGluKGZpbGUsIGJsb2NrKTtcbiAgICBjb25zdCBydW5Db250ZXh0ID0ge1xuICAgICAgZmlsZSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGV4ZWN1dGlvbkNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogZXhlY3V0aW9uQ29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgc3RkaW4sXG4gICAgfTtcbiAgICB0aGlzLnJ1bm5pbmcuc2V0KGJsb2NrLmlkLCBjb250cm9sbGVyKTtcbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzb2x2ZWRCbG9jayA9IGF3YWl0IHRoaXMucmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlLCBibG9jayk7XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250YWluZXJHcm91cFxuICAgICAgICA/IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzKTtcblxuICAgICAgaWYgKHJlc3VsdC50aW1lZE91dCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBgRXhlY3V0aW9uIHRpbWVkIG91dCBhZnRlciAke3RoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNc30gbXMuYDtcbiAgICAgIH0gZWxzZSBpZiAocmVzdWx0LmNhbmNlbGxlZCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQuXCI7XG4gICAgICB9IGVsc2UgaWYgKCFyZXN1bHQuc3VjY2VzcyAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IFwiUHJvY2VzcyBleGl0ZWQgdW5zdWNjZXNzZnVsbHkuXCI7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcpIHtcbiAgICAgICAgY29uc3Qgc291cmNlTm90aWNlID0gYFJhbiBleHRyYWN0ZWQgc291cmNlIGZyb20gJHtyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcuZGVzY3JpcHRpb259LmA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtzb3VyY2VOb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogc291cmNlTm90aWNlO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuaGFzRXhwbGljaXRFeGVjdXRpb25Db250ZXh0KGV4ZWN1dGlvbkNvbnRleHQpKSB7XG4gICAgICAgIGNvbnN0IGNvbnRleHROb3RpY2UgPSB0aGlzLmZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtjb250ZXh0Tm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IGNvbnRleHROb3RpY2U7XG4gICAgICB9XG4gICAgICBhd2FpdCB0aGlzLndyaXRlT3V0cHV0RmlsZUlmUmVxdWVzdGVkKGZpbGUsIGJsb2NrLCByZXN1bHQpO1xuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBzb3VyY2VQcmV2aWV3OiByZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcsXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLCBibG9jaywgcmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcnVubmVyTmFtZSA9IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXIhLmRpc3BsYXlOYW1lO1xuICAgICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIHJhbiAke3J1bm5lck5hbWV9IGJsb2NrLmAgOiBgbG9vbSBydW4gZmFpbGVkIGZvciAke3J1bm5lck5hbWV9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xuICAgICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgICAgYmxvY2ssXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHJ1bm5lcklkOiBjb250YWluZXJHcm91cCA/IGBjb250YWluZXI6JHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5pZCA/PyBcInVua25vd25cIixcbiAgICAgICAgICBydW5uZXJOYW1lOiBjb250YWluZXJHcm91cCA/IGBDb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5kaXNwbGF5TmFtZSA/PyBcIlVua25vd25cIixcbiAgICAgICAgICBzdGFydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBmaW5pc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgICAgc3Rkb3V0OiBcIlwiLFxuICAgICAgICAgIHN0ZGVycjogbWVzc2FnZSxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgbmV3IE5vdGljZShgbG9vbSBlcnJvcjogJHttZXNzYWdlfWApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZTxib29sZWFuPigocmVzb2x2ZSkgPT4ge1xuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IHNldHRsZSA9ICh2YWx1ZTogYm9vbGVhbikgPT4ge1xuICAgICAgICBpZiAoIXNldHRsZWQpIHtcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcbiAgICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbW9kYWwgPSBuZXcgRXhlY3V0aW9uQ29uc2VudE1vZGFsKHRoaXMuYXBwLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB0cnVlO1xuICAgICAgICB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBzZXR0bGUodHJ1ZSk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxDbG9zZSA9IG1vZGFsLmNsb3NlLmJpbmQobW9kYWwpO1xuICAgICAgbW9kYWwuY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIG9yaWdpbmFsQ2xvc2UoKTtcbiAgICAgICAgc2V0dGxlKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKTtcbiAgICAgIH07XG4gICAgICBtb2RhbC5vcGVuKCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx7IGJsb2NrOiBsb29tQ29kZUJsb2NrOyBzb3VyY2VQcmV2aWV3PzogbG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0gfT4ge1xuICAgIGlmICghYmxvY2suc291cmNlUmVmZXJlbmNlKSB7XG4gICAgICByZXR1cm4geyBibG9jayB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlZmVyZW5jZVBhdGggPSB0aGlzLnJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGUsIGJsb2NrLnNvdXJjZVJlZmVyZW5jZS5maWxlUGF0aCk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZWZlcmVuY2VQYXRoKTtcbiAgICBpZiAoIShzb3VyY2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlZmVyZW5jZWQgc291cmNlIGZpbGUgbm90IGZvdW5kOiAke3JlZmVyZW5jZVBhdGh9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgaGFybmVzcyA9IGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jayk7XG4gICAgY29uc3QgZXh0ZXJuYWxFeHRyYWN0b3IgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlRXh0cmFjdG9yKGJsb2NrLCBmaWxlKTtcbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChzb3VyY2VGaWxlKSxcbiAgICAgIHsgLi4uYmxvY2suc291cmNlUmVmZXJlbmNlLCBmaWxlUGF0aDogcmVmZXJlbmNlUGF0aCB9LFxuICAgICAgYmxvY2subGFuZ3VhZ2UsXG4gICAgICBoYXJuZXNzLFxuICAgICAge1xuICAgICAgICBweXRob25FeGVjdXRhYmxlOiB0aGlzLnNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwicHl0aG9uM1wiLFxuICAgICAgICBleHRlcm5hbEV4dHJhY3RvcixcbiAgICAgICAgcmVhZEZpbGU6IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGltcG9ydGVkRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVQYXRoKGZpbGVQYXRoKSk7XG4gICAgICAgICAgcmV0dXJuIGltcG9ydGVkRmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChpbXBvcnRlZEZpbGUpIDogbnVsbDtcbiAgICAgICAgfSxcbiAgICAgICAgcmVzb2x2ZVB5dGhvbkltcG9ydDogYXN5bmMgKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpID0+IHRoaXMucmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGgsIG1vZHVsZU5hbWUsIGxldmVsKSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gZ2V0TGFuZ3VhZ2VDYXBhYmlsaXR5KGJsb2NrLmxhbmd1YWdlLCBCb29sZWFuKGV4dGVybmFsRXh0cmFjdG9yKSk7XG4gICAgY29uc3Qgc2hvdWxkU2hvd1ByZXZpZXcgPSAodGhpcy5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSB8fCBcImNvbGxhcHNlZFwiKSAhPT0gXCJoaWRkZW5cIjtcblxuICAgIHJldHVybiB7XG4gICAgICBibG9jazoge1xuICAgICAgICAuLi5ibG9jayxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIH0sXG4gICAgICBzb3VyY2VQcmV2aWV3OiBzaG91bGRTaG93UHJldmlldyA/IHtcbiAgICAgICAgZGVzY3JpcHRpb246IHJlc29sdmVkLmRlc2NyaXB0aW9uLFxuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICAgIGNhcGFiaWxpdHksXG4gICAgICAgIGV4cGFuZGVkOiB0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID09PSBcImV4cGFuZGVkXCIsXG4gICAgICAgIHNob3dDYXBhYmlsaXR5TWV0YWRhdGE6IHRoaXMuc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID8/IHRydWUsXG4gICAgICB9IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGU6IFRGaWxlLCByZWZlcmVuY2VQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRyaW1tZWQgPSByZWZlcmVuY2VQYXRoLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgodHJpbW1lZC5zbGljZSgxKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYmFzZURpciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChiYXNlRGlyID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtiYXNlRGlyfS8ke3RyaW1tZWR9YCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVQeXRob25JbXBvcnRWYXVsdFBhdGgoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IG1vZHVsZVBhdGggPSBtb2R1bGVOYW1lXG4gICAgICAuc3BsaXQoXCIuXCIpXG4gICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiL1wiKTtcbiAgICBjb25zdCBmcm9tRGlyID0gZGlybmFtZShmcm9tRmlsZVBhdGgpO1xuICAgIGNvbnN0IGJhc2VEaXJzID0gbGV2ZWwgPiAwXG4gICAgICA/IFt0aGlzLmFzY2VuZFZhdWx0UGF0aChmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBsZXZlbCAtIDEpXVxuICAgICAgOiBbZnJvbURpciA9PT0gXCIuXCIgPyBcIlwiIDogZnJvbURpciwgXCJcIl07XG5cbiAgICBmb3IgKGNvbnN0IGJhc2VEaXIgb2YgYmFzZURpcnMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLmdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpciwgbW9kdWxlUGF0aCk7XG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmICh0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobm9ybWFsaXplZCkgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICAgIHJldHVybiBub3JtYWxpemVkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpcjogc3RyaW5nLCBtb2R1bGVQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcHJlZml4ID0gYmFzZURpciA/IGAke2Jhc2VEaXJ9L2AgOiBcIlwiO1xuICAgIGlmICghbW9kdWxlUGF0aCkge1xuICAgICAgcmV0dXJuIFtgJHtwcmVmaXh9X19pbml0X18ucHlgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9LnB5YCxcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9L19faW5pdF9fLnB5YCxcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBhc2NlbmRWYXVsdFBhdGgocGF0aDogc3RyaW5nLCBsZXZlbHM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgbGV0IGN1cnJlbnQgPSBwYXRoO1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsZXZlbHM7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9IG5leHQgPT09IFwiLlwiID8gXCJcIiA6IG5leHQ7XG4gICAgfVxuICAgIHJldHVybiBjdXJyZW50O1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RpZnlBbGxPdXRwdXRzQ2hhbmdlZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVycyBvZiB0aGlzLm91dHB1dExpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiBsaXN0ZW5lcnMpIHtcbiAgICAgICAgbGlzdGVuZXIoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hBbGxWaWV3cygpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBNYXJrZG93blZpZXc7XG4gICAgICBjb25zdCBwcmV2aWV3TW9kZSA9ICh2aWV3IGFzIHsgcHJldmlld01vZGU/OiB7IHJlcmVuZGVyPzogKGZvcmNlPzogYm9vbGVhbikgPT4gdm9pZCB9IH0pLnByZXZpZXdNb2RlO1xuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xuICAgICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7IGVmZmVjdHM6IGxvb21SZWZyZXNoRWZmZWN0Lm9mKHVuZGVmaW5lZCkgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBub3JtYWxpemVTZXR0aW5ncygpOiB2b2lkIHtcbiAgICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24odGhpcy5zZXR0aW5ncyk7XG4gICAgdGhpcy5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMgPSBub3JtYWxpemVOb25OZWdhdGl2ZUludGVnZXIodGhpcy5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMsIERFRkFVTFRfU0VUVElOR1Mub3V0cHV0VmlzaWJsZUxpbmVzLCAyMDAwKTtcbiAgICB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBub3JtYWxpemVQb3NpdGl2ZUludGVnZXIodGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCBERUZBVUxUX1NFVFRJTkdTLmRlZmF1bHRUaW1lb3V0TXMpO1xuICAgIHRoaXMuc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwID0gbm9ybWFsaXplU3RyaW5nU2V0dGluZyh0aGlzLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCwgREVGQVVMVF9TRVRUSU5HUy5kZWZhdWx0Q29udGFpbmVyR3JvdXApO1xuICAgIHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVN0cmluZ1NldHRpbmcodGhpcy5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LCBERUZBVUxUX1NFVFRJTkdTLndvcmtpbmdEaXJlY3RvcnkpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRBY3RpdmVNYXJrZG93bkZpbGUoKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICByZXR1cm4gdmlldz8uZmlsZSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgfVxuXG4gIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZih2aWV3LmxlYWYpO1xuICB9XG5cbiAgYXN5bmMgZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB2aWV3LmxlYWY7XG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHN0YXRlLnNvdXJjZSA9IGZhbHNlO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAuLi52aWV3U3RhdGUsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGVhZi5pc0RlZmVycmVkKSB7XG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBpZiAoISh2aWV3IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB8fCAhdmlldy5maWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlID0gdmlldy5lZGl0b3I/LmdldFZhbHVlPy4oKSA/PyAoYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh2aWV3LmZpbGUpKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN0YXRlLm1vZGUgPSBcInNvdXJjZVwiO1xuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XG5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAuLi52aWV3U3RhdGUsXG4gICAgICBzdGF0ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGU7XG4gICAgY29uc3QgZWRpdG9yID0gdmlldz8uZWRpdG9yO1xuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBibG9jay5pZCA9PT0gYmxvY2tJZCkgPz8gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSB7XG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcblxuICAgIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICAgIGNsYXNzIHtcbiAgICAgICAgZGVjb3JhdGlvbnM7XG5cbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmFkZCh2aWV3KTtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xuICAgICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGx1Z2luLmdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpO1xuICAgICAgICAgIGlmICghZmlsZVBhdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBzb3VyY2UsIHBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4oKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMSk7XG4gICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbVRvb2xiYXJXaWRnZXQocGx1Z2luLCBibG9jayksXG4gICAgICAgICAgICAgICAgc2lkZTogLTEsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSB8fCBwbHVnaW4uc2hvdWxkUmVuZGVyU3RkaW5QYW5lbChibG9jaykpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNFeHBsaWNpdEV4ZWN1dGlvbkNvbnRleHQoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBjb250ZXh0LnNvdXJjZS5jb250YWluZXIgIT09IFwibm9uZVwiIHx8IGNvbnRleHQuc291cmNlLndvcmtpbmdEaXJlY3RvcnkgIT09IFwiZGVmYXVsdFwiIHx8IGNvbnRleHQuc291cmNlLnRpbWVvdXQgIT09IFwiZ2xvYmFsXCI7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoY29udGV4dDogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGllY2VzID0gW1xuICAgICAgYGNvbnRhaW5lcj0ke2NvbnRleHQuY29udGFpbmVyR3JvdXAgPz8gXCJuYXRpdmVcIn0gKCR7Y29udGV4dC5zb3VyY2UuY29udGFpbmVyfSlgLFxuICAgICAgYGN3ZD0ke2NvbnRleHQud29ya2luZ0RpcmVjdG9yeX0gKCR7Y29udGV4dC5zb3VyY2Uud29ya2luZ0RpcmVjdG9yeX0pYCxcbiAgICAgIGB0aW1lb3V0PSR7Y29udGV4dC50aW1lb3V0TXN9bXMgKCR7Y29udGV4dC5zb3VyY2UudGltZW91dH0pYCxcbiAgICBdO1xuICAgIHJldHVybiBgRXhlY3V0aW9uIGNvbnRleHQ6ICR7cGllY2VzLmpvaW4oXCIsIFwiKX0uYDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGZpbGU6IFRGaWxlKTogeyBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjsgbGFuZ3VhZ2U6IHN0cmluZzsgZXhlY3V0YWJsZTogc3RyaW5nOyBhcmdzOiBzdHJpbmdbXTsgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nOyB0aW1lb3V0TXM6IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsYW5ndWFnZSA9IGZpbmRFbmFibGVkQ29tbWFuZExhbmd1YWdlKHRoaXMuc2V0dGluZ3MsIGJsb2NrLmxhbmd1YWdlLCBibG9jay5sYW5ndWFnZUFsaWFzKTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVFeGVjdXRhYmxlPy50cmltKCkgOiBsYW5ndWFnZS5leHRyYWN0b3JFeGVjdXRhYmxlPy50cmltKCk7XG4gICAgY29uc3QgYXJncyA9IG1vZGUgPT09IFwidHJhbnNwaWxlLWNcIiA/IGxhbmd1YWdlLnRyYW5zcGlsZUFyZ3MgfHwgXCJ7cmVxdWVzdH1cIiA6IGxhbmd1YWdlLmV4dHJhY3RvckFyZ3MgfHwgXCJ7cmVxdWVzdH1cIjtcbiAgICBpZiAoIWV4ZWN1dGFibGUpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1vZGUsXG4gICAgICBsYW5ndWFnZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGFyZ3MpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBleGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVPdXRwdXRGaWxlSWZSZXF1ZXN0ZWQoZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gdGhpcy5yZWFkT3V0cHV0RmlsZVRhcmdldChmaWxlLCBibG9jayk7XG4gICAgICBpZiAoIXRhcmdldCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlVmF1bHRQYXJlbnRGb2xkZXIodGFyZ2V0LnBhdGgpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0YXJnZXQuZm9ybWF0ID09PSBcImpzb25cIlxuICAgICAgICA/IHRoaXMucmVuZGVyT3V0cHV0RmlsZUpzb24oZmlsZSwgYmxvY2ssIHJlc3VsdCwgdGFyZ2V0KVxuICAgICAgICA6IHRoaXMucmVuZGVyT3V0cHV0RmlsZVRleHQocmVzdWx0LCB0YXJnZXQpO1xuICAgICAgY29uc3QgY3VycmVudCA9IHRhcmdldC5tb2RlID09PSBcImFwcGVuZFwiICYmIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKHRhcmdldC5wYXRoKVxuICAgICAgICA/IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZCh0YXJnZXQucGF0aClcbiAgICAgICAgOiBcIlwiO1xuICAgICAgY29uc3QgbmV4dCA9IHRhcmdldC5tb2RlID09PSBcImFwcGVuZFwiICYmIGN1cnJlbnRcbiAgICAgICAgPyBgJHtjdXJyZW50LnJlcGxhY2UoL1xccyokLywgXCJcXG5cIil9JHtyZW5kZXJlZH1gXG4gICAgICAgIDogcmVuZGVyZWQ7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKHRhcmdldC5wYXRoLCBuZXh0KTtcblxuICAgICAgY29uc3Qgc3RyZWFtTGlzdCA9IHRhcmdldC5zdHJlYW1zLmpvaW4oXCIsXCIpO1xuICAgICAgY29uc3Qgbm90aWNlID0gYFdyb3RlIG91dHB1dCBmaWxlICR7dGFyZ2V0LnBhdGh9ICgke3RhcmdldC5tb2RlfSwgJHt0YXJnZXQuZm9ybWF0fSwgJHtzdHJlYW1MaXN0fSkuYDtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtub3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogbm90aWNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgY29uc3Qgbm90aWNlID0gYEZhaWxlZCB0byB3cml0ZSBvdXRwdXQgZmlsZTogJHttZXNzYWdlfWA7XG4gICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7bm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IG5vdGljZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlVGFyZ2V0KGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IGxvb21PdXRwdXRGaWxlVGFyZ2V0IHwgbnVsbCB7XG4gICAgY29uc3QgcmF3UGF0aCA9IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtZmlsZVwiXTtcbiAgICBpZiAoIXJhd1BhdGg/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdGg6IHRoaXMucmVzb2x2ZU91dHB1dFZhdWx0UGF0aChmaWxlLCByYXdQYXRoKSxcbiAgICAgIG1vZGU6IHRoaXMucmVhZE91dHB1dEZpbGVNb2RlKGJsb2NrKSxcbiAgICAgIGZvcm1hdDogdGhpcy5yZWFkT3V0cHV0RmlsZUZvcm1hdChibG9jayksXG4gICAgICBzdHJlYW1zOiB0aGlzLnJlYWRPdXRwdXRGaWxlU3RyZWFtcyhibG9jayksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZE91dHB1dEZpbGVNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbG9vbU91dHB1dEZpbGVNb2RlIHtcbiAgICBjb25zdCBhcHBlbmQgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtYXBwZW5kXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtYXBwZW5kXCJdO1xuICAgIGlmIChhcHBlbmQgJiYgIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKGFwcGVuZC50cmltKCkudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgIHJldHVybiBcImFwcGVuZFwiO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSAoYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWZpbGUtbW9kZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWZpbGUtbW9kZVwiXSA/PyBcInJlcGxhY2VcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKG1vZGUgPT09IFwiYXBwZW5kXCIpIHtcbiAgICAgIHJldHVybiBcImFwcGVuZFwiO1xuICAgIH1cbiAgICBpZiAobW9kZSA9PT0gXCJyZXBsYWNlXCIpIHtcbiAgICAgIHJldHVybiBcInJlcGxhY2VcIjtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsb29tLW91dHB1dC1maWxlLW1vZGU6ICR7bW9kZX0uIFVzZSByZXBsYWNlIG9yIGFwcGVuZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZE91dHB1dEZpbGVGb3JtYXQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBsb29tT3V0cHV0RmlsZUZvcm1hdCB7XG4gICAgY29uc3QgZm9ybWF0ID0gKGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLW91dHB1dC1maWxlLWZvcm1hdFwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWZpbGUtZm9ybWF0XCJdID8/IFwidGV4dFwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoZm9ybWF0ID09PSBcInRleHRcIiB8fCBmb3JtYXQgPT09IFwianNvblwiKSB7XG4gICAgICByZXR1cm4gZm9ybWF0O1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxvb20tb3V0cHV0LWZpbGUtZm9ybWF0OiAke2Zvcm1hdH0uIFVzZSB0ZXh0IG9yIGpzb24uYCk7XG4gIH1cblxuICBwcml2YXRlIHJlYWRPdXRwdXRGaWxlU3RyZWFtcyhibG9jazogbG9vbUNvZGVCbG9jayk6IGxvb21PdXRwdXRGaWxlU3RyZWFtW10ge1xuICAgIGNvbnN0IHZhbHVlID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWZpbGUtc3RyZWFtc1wiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWZpbGUtc3RyZWFtc1wiXSA/PyBcInN0ZG91dFwiO1xuICAgIGNvbnN0IHBhcnNlZCA9IHZhbHVlXG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKChzdHJlYW0pID0+IHN0cmVhbS50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgZXhwYW5kZWQgPSBwYXJzZWQuaW5jbHVkZXMoXCJhbGxcIilcbiAgICAgID8gW1wibWV0YWRhdGFcIiwgXCJzdGRvdXRcIiwgXCJ3YXJuaW5nXCIsIFwic3RkZXJyXCJdXG4gICAgICA6IHBhcnNlZDtcbiAgICBjb25zdCBzdHJlYW1zID0gZXhwYW5kZWQubWFwKChzdHJlYW0pID0+IHtcbiAgICAgIGlmIChzdHJlYW0gPT09IFwic3Rkb3V0XCIgfHwgc3RyZWFtID09PSBcInN0ZGVyclwiIHx8IHN0cmVhbSA9PT0gXCJ3YXJuaW5nXCIgfHwgc3RyZWFtID09PSBcIm1ldGFkYXRhXCIpIHtcbiAgICAgICAgcmV0dXJuIHN0cmVhbTtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbG9vbS1vdXRwdXQtZmlsZS1zdHJlYW1zIGVudHJ5OiAke3N0cmVhbX0uYCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHN0cmVhbXMubGVuZ3RoID8gWy4uLm5ldyBTZXQoc3RyZWFtcyldIDogW1wic3Rkb3V0XCJdO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlT3V0cHV0VmF1bHRQYXRoKGZpbGU6IFRGaWxlLCByYXdQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRyaW1tZWQgPSByYXdQYXRoLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgL15bYS16QS1aXVthLXpBLVowLTkrLi1dKjovLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImxvb20tb3V0cHV0LWZpbGUgbXVzdCBiZSBhIHZhdWx0LXJlbGF0aXZlIHBhdGguXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvXCIpXG4gICAgICA/IG5vcm1hbGl6ZVBhdGgodHJpbW1lZC5zbGljZSgxKSlcbiAgICAgIDogbm9ybWFsaXplUGF0aChkaXJuYW1lKGZpbGUucGF0aCkgPT09IFwiLlwiID8gdHJpbW1lZCA6IGAke2Rpcm5hbWUoZmlsZS5wYXRoKX0vJHt0cmltbWVkfWApO1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdChcIi9cIikuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmICghcGFydHMubGVuZ3RoIHx8IHBhcnRzLmluY2x1ZGVzKFwiLi5cIikgfHwgcGF0aC5zdGFydHNXaXRoKFwiLm9ic2lkaWFuL1wiKSB8fCBwYXRoID09PSBcIi5vYnNpZGlhblwiIHx8IHBhdGguc3RhcnRzV2l0aChcIi5naXQvXCIpIHx8IHBhdGggPT09IFwiLmdpdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbG9vbS1vdXRwdXQtZmlsZSBwYXRoOiAke3Jhd1BhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBwYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVWYXVsdFBhcmVudEZvbGRlcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBkaXJuYW1lKHBhdGgpO1xuICAgIGlmICghZm9sZGVyIHx8IGZvbGRlciA9PT0gXCIuXCIpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgY3VycmVudCA9IFwiXCI7XG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIGZvbGRlci5zcGxpdChcIi9cIikuZmlsdGVyKEJvb2xlYW4pKSB7XG4gICAgICBjdXJyZW50ID0gY3VycmVudCA/IGAke2N1cnJlbnR9LyR7cGFydH1gIDogcGFydDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKGN1cnJlbnQpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLm1rZGlyKGN1cnJlbnQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyT3V0cHV0RmlsZVRleHQocmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdLCB0YXJnZXQ6IGxvb21PdXRwdXRGaWxlVGFyZ2V0KTogc3RyaW5nIHtcbiAgICBjb25zdCBzZWN0aW9ucyA9IHRhcmdldC5zdHJlYW1zLmZsYXRNYXAoKHN0cmVhbSkgPT4ge1xuICAgICAgc3dpdGNoIChzdHJlYW0pIHtcbiAgICAgICAgY2FzZSBcIm1ldGFkYXRhXCI6XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIGBydW5uZXI9JHtyZXN1bHQucnVubmVyTmFtZX1gLFxuICAgICAgICAgICAgYGV4aXQ9JHtyZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCxcbiAgICAgICAgICAgIGBkdXJhdGlvbj0ke3Jlc3VsdC5kdXJhdGlvbk1zfW1zYCxcbiAgICAgICAgICAgIGB0aW1lc3RhbXA9JHtyZXN1bHQuZmluaXNoZWRBdH1gLFxuICAgICAgICAgIF0uam9pbihcIlxcblwiKTtcbiAgICAgICAgY2FzZSBcInN0ZG91dFwiOlxuICAgICAgICAgIHJldHVybiByZXN1bHQuc3Rkb3V0ID8gW3Jlc3VsdC5zdGRvdXRdIDogW107XG4gICAgICAgIGNhc2UgXCJ3YXJuaW5nXCI6XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC53YXJuaW5nID8gW3Jlc3VsdC53YXJuaW5nXSA6IFtdO1xuICAgICAgICBjYXNlIFwic3RkZXJyXCI6XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC5zdGRlcnIgPyBbcmVzdWx0LnN0ZGVycl0gOiBbXTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYCR7c2VjdGlvbnMuam9pbihcIlxcblxcblwiKS5yZXBsYWNlKC9cXHMqJC8sIFwiXCIpfVxcbmA7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck91dHB1dEZpbGVKc29uKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdLCB0YXJnZXQ6IGxvb21PdXRwdXRGaWxlVGFyZ2V0KTogc3RyaW5nIHtcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgbm90ZTogZmlsZS5wYXRoLFxuICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICBydW5uZXI6IHJlc3VsdC5ydW5uZXJOYW1lLFxuICAgICAgZXhpdENvZGU6IHJlc3VsdC5leGl0Q29kZSxcbiAgICAgIHN1Y2Nlc3M6IHJlc3VsdC5zdWNjZXNzLFxuICAgICAgZHVyYXRpb25NczogcmVzdWx0LmR1cmF0aW9uTXMsXG4gICAgICBzdGFydGVkQXQ6IHJlc3VsdC5zdGFydGVkQXQsXG4gICAgICBmaW5pc2hlZEF0OiByZXN1bHQuZmluaXNoZWRBdCxcbiAgICAgIHN0cmVhbXM6IHtcbiAgICAgICAgLi4uKHRhcmdldC5zdHJlYW1zLmluY2x1ZGVzKFwic3Rkb3V0XCIpID8geyBzdGRvdXQ6IHJlc3VsdC5zdGRvdXQgfSA6IHt9KSxcbiAgICAgICAgLi4uKHRhcmdldC5zdHJlYW1zLmluY2x1ZGVzKFwid2FybmluZ1wiKSA/IHsgd2FybmluZzogcmVzdWx0Lndhcm5pbmcgPz8gXCJcIiB9IDoge30pLFxuICAgICAgICAuLi4odGFyZ2V0LnN0cmVhbXMuaW5jbHVkZXMoXCJzdGRlcnJcIikgPyB7IHN0ZGVycjogcmVzdWx0LnN0ZGVyciB9IDoge30pLFxuICAgICAgfSxcbiAgICB9O1xuICAgIHJldHVybiBgJHtKU09OLnN0cmluZ2lmeShwYXlsb2FkLCBudWxsLCAyKX1cXG5gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZVBhdGg6IHN0cmluZywgYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgcmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrSWQpO1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cbiAgICAgIGxpbmVzLnNwbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kIC0gcmFuZ2Uuc3RhcnQgKyAxKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2tJZDogc3RyaW5nLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYm9keSA9IFtcbiAgICAgIGBydW5uZXI9JHtyZXN1bHQucnVubmVyTmFtZX1gLFxuICAgICAgYGV4aXQ9JHtyZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCxcbiAgICAgIGBkdXJhdGlvbj0ke3Jlc3VsdC5kdXJhdGlvbk1zfW1zYCxcbiAgICAgIGB0aW1lc3RhbXA9JHtyZXN1bHQuZmluaXNoZWRBdH1gLFxuICAgICAgcmVzdWx0LnN0ZG91dCA/IGBzdGRvdXQ6XFxuJHtyZXN1bHQuc3Rkb3V0fWAgOiBcIlwiLFxuICAgICAgcmVzdWx0Lndhcm5pbmcgPyBgd2FybmluZzpcXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBcIlwiLFxuICAgICAgcmVzdWx0LnN0ZGVyciA/IGBzdGRlcnI6XFxuJHtyZXN1bHQuc3RkZXJyfWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgcmV0dXJuIFtcbiAgICAgIGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YCxcbiAgICAgIFwiYGBgdGV4dFwiLFxuICAgICAgYm9keSxcbiAgICAgIFwiYGBgXCIsXG4gICAgICBcIjwhLS0gbG9vbTpvdXRwdXQ6ZW5kIC0tPlwiLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXM6IHN0cmluZ1tdLCBibG9ja0lkOiBzdHJpbmcpOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBjb25zdCBzdGFydE1hcmtlciA9IGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpICE9PSBzdGFydE1hcmtlcikge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgICAgaWYgKGxpbmVzW2pdLnRyaW0oKSA9PT0gXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIikge1xuICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiBpLCBlbmQ6IGogfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHNob3VsZFJlbmRlclN0ZGluUGFuZWwoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zdGRpblBhbmVscy5oYXMoYmxvY2suaWQpIHx8IHRoaXMuaGFzRW5hYmxlZFN0ZGluQXR0cmlidXRlKGJsb2NrKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFzRW5hYmxlZFN0ZGluQXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogYm9vbGVhbiB7XG4gICAgY29uc3QgaW5wdXQgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1pbnB1dFwiXSA/PyBibG9jay5hdHRyaWJ1dGVzLmlucHV0O1xuICAgIGlmIChpbnB1dCAmJiAhW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIl0uaW5jbHVkZXMoaW5wdXQudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluXCJdICE9IG51bGwgfHxcbiAgICAgIGJsb2NrLmF0dHJpYnV0ZXMuc3RkaW4gIT0gbnVsbCB8fFxuICAgICAgYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW4tZmlsZVwiXSAhPSBudWxsIHx8XG4gICAgICBibG9jay5hdHRyaWJ1dGVzW1wic3RkaW4tZmlsZVwiXSAhPSBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTdGRpblBhbmVsKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwYW5lbC5jbGFzc05hbWUgPSBcImxvb20tc3RkaW4tcGFuZWxcIjtcblxuICAgIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXN0ZGluLWhlYWRlclwiIH0pO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgdGV4dDogXCJzdGRpblwiIH0pO1xuICAgIGNvbnN0IGFjdGlvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3RkaW4tYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IHJ1bkJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlJ1blwiIH0pO1xuICAgIGNvbnN0IGNsZWFyQnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2xlYXJcIiB9KTtcblxuICAgIGNvbnN0IHRleHRhcmVhID0gcGFuZWwuY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7IGNsczogXCJsb29tLXN0ZGluLWlucHV0XCIgfSk7XG4gICAgdGV4dGFyZWEucGxhY2Vob2xkZXIgPSB0aGlzLmdldFN0ZGluUGxhY2Vob2xkZXIoYmxvY2spO1xuICAgIHRleHRhcmVhLnZhbHVlID0gdGhpcy5zdGRpbklucHV0cy5nZXQoYmxvY2suaWQpID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJsb29tLXN0ZGluXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXMuc3RkaW4gPz8gXCJcIjtcbiAgICB0ZXh0YXJlYS5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5zdGRpbklucHV0cy5zZXQoYmxvY2suaWQsIHRleHRhcmVhLnZhbHVlKTtcbiAgICB9KTtcbiAgICBydW5CdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5zdGRpbklucHV0cy5zZXQoYmxvY2suaWQsIHRleHRhcmVhLnZhbHVlKTtcbiAgICAgIHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpO1xuICAgIH0pO1xuICAgIGNsZWFyQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRleHRhcmVhLnZhbHVlID0gXCJcIjtcbiAgICAgIHRoaXMuc3RkaW5JbnB1dHMuc2V0KGJsb2NrLmlkLCBcIlwiKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBwYW5lbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3RkaW5QbGFjZWhvbGRlcihibG9jazogbG9vbUNvZGVCbG9jayk6IHN0cmluZyB7XG4gICAgY29uc3Qgc3RkaW5GaWxlID0gYmxvY2suYXR0cmlidXRlc1tcImxvb20tc3RkaW4tZmlsZVwiXSA/PyBibG9jay5hdHRyaWJ1dGVzW1wic3RkaW4tZmlsZVwiXTtcbiAgICByZXR1cm4gc3RkaW5GaWxlID8gYHN0ZGluIGZpbGU6ICR7c3RkaW5GaWxlfWAgOiBcInN0YW5kYXJkIGlucHV0IGZvciB0aGlzIGJsb2NrXCI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVCbG9ja1N0ZGluKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKHRoaXMuc3RkaW5JbnB1dHMuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgcmV0dXJuIHRoaXMuc3RkaW5JbnB1dHMuZ2V0KGJsb2NrLmlkKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbmxpbmUgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpblwiXSA/PyBibG9jay5hdHRyaWJ1dGVzLnN0ZGluO1xuICAgIGlmIChpbmxpbmUgIT0gbnVsbCkge1xuICAgICAgcmV0dXJuIGRlY29kZUVzY2FwZWRBdHRyaWJ1dGUoaW5saW5lKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGRpbkZpbGUgPSBibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1zdGRpbi1maWxlXCJdID8/IGJsb2NrLmF0dHJpYnV0ZXNbXCJzdGRpbi1maWxlXCJdO1xuICAgIGlmICghc3RkaW5GaWxlPy50cmltKCkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RkaW5QYXRoID0gdGhpcy5yZXNvbHZlUmVmZXJlbmNlZFZhdWx0UGF0aChmaWxlLCBzdGRpbkZpbGUpO1xuICAgIGNvbnN0IGlucHV0RmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChzdGRpblBhdGgpO1xuICAgIGlmICghKGlucHV0RmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBzdGRpbiBmaWxlIG5vdCBmb3VuZDogJHtzdGRpblBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGlucHV0RmlsZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGVjb2RlRXNjYXBlZEF0dHJpYnV0ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1xcXFxuL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xcXFx0L2csIFwiXFx0XCIpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dGVybmFsTGFuZ3VhZ2VQYWNrKHZhbHVlOiB1bmtub3duLCBmaWxlUGF0aDogc3RyaW5nKTogbG9vbUV4dGVybmFsTGFuZ3VhZ2VQYWNrIHwgbnVsbCB7XG4gIGlmICghaXNSZWNvcmQodmFsdWUpKSB7XG4gICAgY29uc29sZS53YXJuKGBJZ25vcmluZyBsb29tIGxhbmd1YWdlIHBhY2sgJHtmaWxlUGF0aH06IG1hbmlmZXN0IG11c3QgYmUgYW4gb2JqZWN0YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCByYXdJZCA9IHJlYWRTdHJpbmcodmFsdWUuaWQpO1xuICBjb25zdCBpZCA9IG5vcm1hbGl6ZU1hbmlmZXN0SWQocmF3SWQpO1xuICBpZiAoIWlkKSB7XG4gICAgY29uc29sZS53YXJuKGBJZ25vcmluZyBsb29tIGxhbmd1YWdlIHBhY2sgJHtmaWxlUGF0aH06IG1pc3NpbmcgcGFja2FnZSBpZGApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZS5sYW5ndWFnZXMpKSB7XG4gICAgY29uc29sZS53YXJuKGBJZ25vcmluZyBsb29tIGxhbmd1YWdlIHBhY2sgJHtmaWxlUGF0aH06IGxhbmd1YWdlcyBtdXN0IGJlIGFuIGFycmF5YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBsYW5ndWFnZXMgPSB2YWx1ZS5sYW5ndWFnZXNcbiAgICAubWFwKChsYW5ndWFnZSkgPT4gcGFyc2VFeHRlcm5hbExhbmd1YWdlKGxhbmd1YWdlLCBmaWxlUGF0aCkpXG4gICAgLmZpbHRlcigobGFuZ3VhZ2UpOiBsYW5ndWFnZSBpcyBsb29tRXh0ZXJuYWxMYW5ndWFnZSA9PiBCb29sZWFuKGxhbmd1YWdlKSk7XG4gIGlmICghbGFuZ3VhZ2VzLmxlbmd0aCkge1xuICAgIGNvbnNvbGUud2FybihgSWdub3JpbmcgbG9vbSBsYW5ndWFnZSBwYWNrICR7ZmlsZVBhdGh9OiBubyB2YWxpZCBsYW5ndWFnZXNgKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgaWQ6IGBleHRlcm5hbDoke2lkfWAsXG4gICAgZGlzcGxheU5hbWU6IHJlYWRTdHJpbmcodmFsdWUuZGlzcGxheU5hbWUpIHx8IHJhd0lkLFxuICAgIGRlc2NyaXB0aW9uOiByZWFkU3RyaW5nKHZhbHVlLmRlc2NyaXB0aW9uKSB8fCBgRXh0ZXJuYWwgbGFuZ3VhZ2UgcGFjayBmcm9tICR7ZmlsZVBhdGh9YCxcbiAgICBsYW5ndWFnZXMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0ZXJuYWxMYW5ndWFnZSh2YWx1ZTogdW5rbm93biwgZmlsZVBhdGg6IHN0cmluZyk6IGxvb21FeHRlcm5hbExhbmd1YWdlIHwgbnVsbCB7XG4gIGlmICghaXNSZWNvcmQodmFsdWUpKSB7XG4gICAgY29uc29sZS53YXJuKGBJZ25vcmluZyBsYW5ndWFnZSBlbnRyeSBpbiAke2ZpbGVQYXRofTogZW50cnkgbXVzdCBiZSBhbiBvYmplY3RgKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHJhd05hbWUgPSByZWFkU3RyaW5nKHZhbHVlLmlkKSB8fCByZWFkU3RyaW5nKHZhbHVlLm5hbWUpO1xuICBjb25zdCBuYW1lID0gbm9ybWFsaXplTWFuaWZlc3RJZChyYXdOYW1lKTtcbiAgY29uc3QgZXhlY3V0YWJsZSA9IHJlYWRTdHJpbmcodmFsdWUuZXhlY3V0YWJsZSk7XG4gIGlmICghbmFtZSB8fCAhZXhlY3V0YWJsZSkge1xuICAgIGNvbnNvbGUud2FybihgSWdub3JpbmcgbGFuZ3VhZ2UgZW50cnkgaW4gJHtmaWxlUGF0aH06IGxhbmd1YWdlIGlkL25hbWUgYW5kIGV4ZWN1dGFibGUgYXJlIHJlcXVpcmVkYCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5hbWUsXG4gICAgZGlzcGxheU5hbWU6IHJlYWRTdHJpbmcodmFsdWUuZGlzcGxheU5hbWUpIHx8IHJhd05hbWUsXG4gICAgZGVzY3JpcHRpb246IHJlYWRTdHJpbmcodmFsdWUuZGVzY3JpcHRpb24pLFxuICAgIGFsaWFzZXM6IHJlYWRBbGlhc0xpc3QodmFsdWUuYWxpYXNlcywgbmFtZSkuam9pbihcIiwgXCIpLFxuICAgIGV4ZWN1dGFibGUsXG4gICAgYXJnczogcmVhZFN0cmluZyh2YWx1ZS5hcmdzKSB8fCBcIntmaWxlfVwiLFxuICAgIGV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKHJlYWRTdHJpbmcodmFsdWUuZXh0ZW5zaW9uKSwgbmFtZSksXG4gICAgZXh0cmFjdG9yTW9kZTogcmVhZFN0cmluZyh2YWx1ZS5leHRyYWN0b3JNb2RlKSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gXCJ0cmFuc3BpbGUtY1wiIDogXCJjb21tYW5kXCIsXG4gICAgZXh0cmFjdG9yRXhlY3V0YWJsZTogcmVhZFN0cmluZyh2YWx1ZS5leHRyYWN0b3JFeGVjdXRhYmxlKSxcbiAgICBleHRyYWN0b3JBcmdzOiByZWFkU3RyaW5nKHZhbHVlLmV4dHJhY3RvckFyZ3MpIHx8IFwie3JlcXVlc3R9XCIsXG4gICAgdHJhbnNwaWxlRXhlY3V0YWJsZTogcmVhZFN0cmluZyh2YWx1ZS50cmFuc3BpbGVFeGVjdXRhYmxlKSxcbiAgICB0cmFuc3BpbGVBcmdzOiByZWFkU3RyaW5nKHZhbHVlLnRyYW5zcGlsZUFyZ3MpIHx8IFwie3JlcXVlc3R9XCIsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzUmVjb3JkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gcmVhZFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS50cmltKCkgOiBcIlwiO1xufVxuXG5mdW5jdGlvbiByZWFkQWxpYXNMaXN0KHZhbHVlOiB1bmtub3duLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGFsaWFzZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gdmFsdWUuZmxhdE1hcCgoYWxpYXMpID0+IHJlYWRTdHJpbmcoYWxpYXMpLnNwbGl0KFwiLFwiKSlcbiAgICA6IHJlYWRTdHJpbmcodmFsdWUpLnNwbGl0KFwiLFwiKTtcbiAgcmV0dXJuIGFsaWFzZXNcbiAgICAubWFwKChhbGlhcykgPT4gbm9ybWFsaXplTWFuaWZlc3RJZChhbGlhcykpXG4gICAgLmZpbHRlcigoYWxpYXMsIGluZGV4LCBsaXN0KSA9PiBCb29sZWFuKGFsaWFzKSAmJiBhbGlhcyAhPT0gbmFtZSAmJiBsaXN0LmluZGV4T2YoYWxpYXMpID09PSBpbmRleCk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU1hbmlmZXN0SWQodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC50cmltKClcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpXG4gICAgLnJlcGxhY2UoL14tK3wtKyQvZywgXCJcIik7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbih2YWx1ZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXZhbHVlKSB7XG4gICAgcmV0dXJuIGAuJHtuYW1lfWA7XG4gIH1cbiAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoXCIuXCIpID8gdmFsdWUgOiBgLiR7dmFsdWV9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBmYWxsYmFjazogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID4gMFxuICAgID8gTWF0aC5mbG9vcih2YWx1ZSlcbiAgICA6IGZhbGxiYWNrO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVOb25OZWdhdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGZhbGxiYWNrOiBudW1iZXIsIG1heDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcbiAgICByZXR1cm4gZmFsbGJhY2s7XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluKE1hdGguZmxvb3IodmFsdWUpLCBtYXgpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVTdHJpbmdTZXR0aW5nKHZhbHVlOiB1bmtub3duLCBmYWxsYmFjazogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogZmFsbGJhY2s7XG59XG4iLCAiaW1wb3J0IHsgTm90aWNlLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBvcGVuU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCByZWFkZGlyLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiwgbm9ybWFsaXplIGFzIG5vcm1hbGl6ZUZzUGF0aCwgcG9zaXggYXMgcG9zaXhQYXRoIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB7IGZpbmRFbmFibGVkQ29tbWFuZExhbmd1YWdlIH0gZnJvbSBcIi4uL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG50eXBlIGxvb21Db250YWluZXJSdW50aW1lID0gXCJkb2NrZXJcIiB8IFwicG9kbWFuXCIgfCBcInFlbXVcIiB8IFwid3NsXCIgfCBcImN1c3RvbVwiO1xudHlwZSBsb29tQ29udGFpbmVyRWxldmF0aW9uTW9kZSA9IFwiZGVmYXVsdFwiIHwgXCJyb290XCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckVsZXZhdGlvbkNvbmZpZyB7XG4gIG1vZGU6IGxvb21Db250YWluZXJFbGV2YXRpb25Nb2RlO1xuICBjb21tYW5kUHJlZml4Pzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgZWxldmF0aW9uOiBsb29tQ29udGFpbmVyRWxldmF0aW9uQ29uZmlnO1xuICB3c2w/OiBsb29tV3NsQ29uZmlnO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gIGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gIGFjdGlvbjogXCJidWlsZFwiIHwgXCJydW5cIiB8IFwidGVhcmRvd25cIjtcbiAgZ3JvdXBOYW1lOiBzdHJpbmc7XG4gIGdyb3VwUGF0aDogc3RyaW5nO1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGJ1aWxkPzogc3RyaW5nO1xuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xuICB0ZWFyZG93bj86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBzdHJpbmc7XG4gIGxhbmd1YWdlQWxpYXM/OiBzdHJpbmc7XG4gIGZpbGVOYW1lPzogc3RyaW5nO1xuICBmaWxlUGF0aD86IHN0cmluZztcbiAgY29tbWFuZD86IHN0cmluZztcbiAgc3RkaW4/OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBjb25maWc6IHtcbiAgICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICAgIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gICAgZWxldmF0aW9uPzogbG9vbUNvbnRhaW5lckVsZXZhdGlvbkNvbmZpZztcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIGxvb21Db250YWluZXJSdW5uZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1aWx0SW1hZ2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICApIHsgfVxuXG4gIGdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlOiBURmlsZSk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHZhbHVlID0gZnJvbnRtYXR0ZXI/LltcImxvb20tY29udGFpbmVyXCJdO1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGdldEdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XG4gICAgY29uc3QgY29udGFpbmVyc1BhdGggPSB0aGlzLmdldENvbnRhaW5lcnNQYXRoKCk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGNvbnRhaW5lcnNQYXRoKSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgICAgICBjb25zdCBncm91cFBhdGggPSBqb2luKGNvbnRhaW5lcnNQYXRoLCBlbnRyeS5uYW1lKTtcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcbiAgICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgICBpZiAoIWhhc0NvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IHBpZWNlcyA9IFtgcnVudGltZTogJHtjb25maWcucnVudGltZX1gXTtcbiAgICAgICAgICAgIGlmICgoY29uZmlnLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpICYmIGhhc0RvY2tlcmZpbGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8uc3NoVGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8ubWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgbWFuYWdlcjogJHthd2FpdCB0aGlzLmdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aCwgY29uZmlnLnFlbXUubWFuYWdlcil9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgY29uZmlnLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgd3JhcHBlcjogJHtjb25maWcuY3VzdG9tLmV4ZWN1dGFibGV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLmVsZXZhdGlvbi5tb2RlID09PSBcInJvb3RcIikge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChjb25maWcuZWxldmF0aW9uLmNvbW1hbmRQcmVmaXggPyBgZWxldmF0aW9uOiByb290IHZpYSAke2NvbmZpZy5lbGV2YXRpb24uY29tbWFuZFByZWZpeH1gIDogXCJlbGV2YXRpb246IHJvb3RcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBsYW5ndWFnZUNvdW50ID0gT2JqZWN0LmtleXMoY29uZmlnLmxhbmd1YWdlcykubGVuZ3RoO1xuICAgICAgICAgICAgcGllY2VzLnB1c2goYCR7bGFuZ3VhZ2VDb3VudH0gbGFuZ3VhZ2Uke2xhbmd1YWdlQ291bnQgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IHBpZWNlcy5qb2luKFwiLCBcIiksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IGBpbnZhbGlkIGNvbmZpZy5qc29uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBncm91cE5hbWU6IHN0cmluZyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbmZpZ0xhbmcgPSBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlXSA/PyBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlQWxpYXNdO1xuXG4gICAgbGV0IGlzRmFsbGJhY2sgPSBmYWxzZTtcbiAgICBsZXQgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB8IG51bGwgPSBudWxsO1xuXG4gICAgaWYgKGNvbmZpZ0xhbmcpIHtcbiAgICAgIGlmIChjb25maWdMYW5nLnVzZURlZmF1bHQpIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxhbmd1YWdlID0gY29uZmlnTGFuZztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIGlzRmFsbGJhY2sgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UgfHwgIWxhbmd1YWdlLmNvbW1hbmQgfHwgIWxhbmd1YWdlLmV4dGVuc2lvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgZ3JvdXAgJHtncm91cE5hbWV9IGhhcyBubyBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICB9XG5cbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgY29uc3QgdGVtcEZpbGVOYW1lID0gYHRlbXBfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfSR7bm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbil9YDtcbiAgICBjb25zdCB0ZW1wRmlsZVBhdGggPSBqb2luKGdyb3VwUGF0aCwgdGVtcEZpbGVOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGVQYXRoLCBibG9jay5jb250ZW50LCBcInV0ZjhcIik7XG4gICAgICBsZXQgcmVzdWx0OiBsb29tUnVuUmVzdWx0O1xuICAgICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bk9jaUNvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5RZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b20oZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgYmxvY2ssIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIHRlbXBGaWxlUGF0aCwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bldzbENvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc0ZhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrTXNnID0gYFtMb29tXSBMYW5ndWFnZSAnJHtibG9jay5sYW5ndWFnZX0nIHdhcyBub3QgZGVjbGFyZWQgaW4gY29udGFpbmVyIGdyb3VwLiBSdW5uaW5nIHVzaW5nIGRlZmF1bHQgY29tbWFuZDogJHtsYW5ndWFnZS5jb21tYW5kfWA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtyZXN1bHQud2FybmluZ31cXG4ke2ZhbGxiYWNrTXNnfWAgOiBmYWxsYmFja01zZztcbiAgICAgIH1cbiAgICAgIGlmIChjb25maWcuZWxldmF0aW9uLm1vZGUgPT09IFwicm9vdFwiKSB7XG4gICAgICAgIGNvbnN0IGVsZXZhdGlvbk1zZyA9IGBbTG9vbV0gQ29udGFpbmVyIGVsZXZhdGlvbjogcm9vdCR7Y29uZmlnLmVsZXZhdGlvbi5jb21tYW5kUHJlZml4ID8gYCB2aWEgJHtjb25maWcuZWxldmF0aW9uLmNvbW1hbmRQcmVmaXh9YCA6IFwiXCJ9LmA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtyZXN1bHQud2FybmluZ31cXG4ke2VsZXZhdGlvbk1zZ31gIDogZWxldmF0aW9uTXNnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwiYnVpbGRcIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zKSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcIndzbFwiOlxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsOmJ1aWxkYCxcbiAgICAgICAgICBgV1NMICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgICAgYFdTTCBlbnZpcm9ubWVudCAke2NvbmZpZy5pbWFnZSB8fCBcIihkZWZhdWx0KVwifSBkb2VzIG5vdCByZXF1aXJlIGEgYnVpbGQgc3RlcC5cXG5gLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT2NpQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XG4gICAgaWYgKCFjb21tYW5kLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1xuICAgICAgICBcInJ1blwiLFxuICAgICAgICBcIi0tcm1cIixcbiAgICAgICAgLi4uKGNvbnRleHQuc3RkaW4gIT0gbnVsbCA/IFtcIi1pXCJdIDogW10pLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIC4uLnRoaXMub2NpRWxldmF0aW9uQXJncyhjb25maWcpLFxuICAgICAgICBpbWFnZSxcbiAgICAgICAgLi4uY29tbWFuZCxcbiAgICAgIF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpoZWFsdGhgLCBgUUVNVSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtb3RlRmlsZSA9IHBvc2l4UGF0aC5qb2luKHFlbXUucmVtb3RlV29ya3NwYWNlLCB0ZW1wRmlsZU5hbWUpO1xuICAgICAgY29uc3QgcmVtb3RlQ29tbWFuZCA9IHRoaXMuYXBwbHlDb21tYW5kUHJlZml4KGNvbmZpZywgbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCBzaGVsbFF1b3RlKHJlbW90ZUZpbGUpKSk7XG4gICAgICBpZiAoIXJlbW90ZUNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxuICAgICAgICBydW5uZXJOYW1lOiBgUUVNVSAke2dyb3VwTmFtZX1gLFxuICAgICAgICBleGVjdXRhYmxlOiBxZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJzc2hcIixcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIC4uLnNwbGl0Q29tbWFuZExpbmUocWVtdS5zc2hBcmdzIHx8IFwiXCIpLFxuICAgICAgICAgIHFlbXUuc3NoVGFyZ2V0LFxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChxZW11LnRlYXJkb3duQ29tbWFuZCwgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6dGVhcmRvd25gLCBgUUVNVSAke2dyb3VwTmFtZX0gdGVhcmRvd25gKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b20oXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgdGVtcEZpbGVQYXRoOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGNvbW1hbmQgPSB0aGlzLmFwcGx5Q29tbWFuZFByZWZpeChjb25maWcsIGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgY29uZmlnLFxuICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwicnVuXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgY29tbWFuZCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KSxcbiAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgKTtcblxuICAgIGlmIChjb25maWcuY3VzdG9tPy50ZWFyZG93bikge1xuICAgICAgY29uc3QgdGVhcmRvd24gPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICAgIGdyb3VwTmFtZSxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBjb25maWcsXG4gICAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInRlYXJkb3duXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICAgIGNvbW1hbmQsXG4gICAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICAgIH0pLFxuICAgICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgICApO1xuICAgICAgaWYgKCF0ZWFyZG93bi5zdWNjZXNzKSB7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYEN1c3RvbSBydW50aW1lIHRlYXJkb3duIGZhaWxlZDogJHt0ZWFyZG93bi5zdGRlcnIgfHwgdGVhcmRvd24uc3Rkb3V0IHx8IGBleGl0ICR7dGVhcmRvd24uZXhpdENvZGV9YH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bldzbENvbnRhaW5lcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgd3NsR3JvdXBQYXRoID0gdGhpcy50cmFuc2xhdGVUb1dzbFBhdGgoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb21tYW5kID0gdGhpcy5hcHBseUNvbW1hbmRQcmVmaXgoY29uZmlnLCBsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSkpO1xuICAgIGlmICghY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIldTTCBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzaGVsbEZsYWdzID0gY29uZmlnLndzbD8uaW50ZXJhY3RpdmUgPyBbXCItaVwiLCBcIi1sXCIsIFwiLWNcIl0gOiBbXCItbFwiLCBcIi1jXCJdO1xuICAgIGNvbnN0IHdzbEFyZ3MgPSBbXCJiYXNoXCIsIC4uLnNoZWxsRmxhZ3MsIGBjZCBcIiR7d3NsR3JvdXBQYXRoLnJlcGxhY2VBbGwoJ1wiJywgJ1xcXFxcIicpfVwiICYmICR7Y29tbWFuZH1gXTtcbiAgICBpZiAoY29uZmlnLmltYWdlPy50cmltKCkpIHtcbiAgICAgIHdzbEFyZ3MudW5zaGlmdChcIi1kXCIsIGNvbmZpZy5pbWFnZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2xgLFxuICAgICAgcnVubmVyTmFtZTogYFdTTCAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogXCJ3c2xcIixcbiAgICAgIGFyZ3M6IHdzbEFyZ3MsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB0cmFuc2xhdGVUb1dzbFBhdGgod2luZG93c1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbWF0Y2ggPSB3aW5kb3dzUGF0aC5tYXRjaCgvXihbQS1aYS16XSk6XFxcXCguKikvKTtcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGNvbnN0IGRyaXZlID0gbWF0Y2hbMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IHJlc3QgPSBtYXRjaFsyXS5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICAgIHJldHVybiBgL21udC8ke2RyaXZlfS8ke3Jlc3R9YDtcbiAgICB9XG4gICAgaWYgKHdpbmRvd3NQYXRoLmluY2x1ZGVzKFwiXFxcXFwiKSkge1xuICAgICAgcmV0dXJuIHdpbmRvd3NQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIH1cbiAgICByZXR1cm4gd2luZG93c1BhdGg7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBkb2NrZXJmaWxlID0gam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoZG9ja2VyZmlsZSkpIHtcbiAgICAgIHJldHVybiBjb25maWcuaW1hZ2UgfHwgXCJ1YnVudHU6bGF0ZXN0XCI7XG4gICAgfVxuXG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY2FjaGVLZXkgPSBgJHt0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyl9OiR7aW1hZ2V9YDtcbiAgICBpZiAodGhpcy5idWlsdEltYWdlcy5oYXMoY2FjaGVLZXkpKSB7XG4gICAgICByZXR1cm4gaW1hZ2U7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udGV4dC5zaWduYWwpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gYnVpbGQgZmFpbGVkIGZvciAke2dyb3VwTmFtZX0uYCk7XG4gICAgfVxuXG4gICAgdGhpcy5idWlsdEltYWdlcy5hZGQoY2FjaGVLZXkpO1xuICAgIHJldHVybiBpbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIikpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoXG4gICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgICAgYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgYE5vIERvY2tlcmZpbGUgY29uZmlndXJlZC4gVXNpbmcgaW1hZ2UgJHtjb25maWcuaW1hZ2UgfHwgXCJ1YnVudHU6bGF0ZXN0XCJ9LlxcbmAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcbiAgICAgIGFyZ3M6IFtcImJ1aWxkXCIsIFwiLXRcIiwgaW1hZ2UsIGdyb3VwUGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBzaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGlmICghcWVtdS5idWlsZENvbW1hbmQ/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6YnVpbGRgLCBgUUVNVSAke2dyb3VwTmFtZX0gYnVpbGRgLCBcIk5vIFFFTVUgYnVpbGQgY29tbWFuZCBjb25maWd1cmVkLlxcblwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucnVuQ29tbWFuZExpbmUocWVtdS5idWlsZENvbW1hbmQsIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6YnVpbGRgLCBgUUVNVSAke2dyb3VwTmFtZX0gYnVpbGRgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZENvbmZpZyhncm91cFBhdGg6IHN0cmluZyk6IFByb21pc2U8bG9vbUNvbnRhaW5lckNvbmZpZz4ge1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKTtcbiAgICBsZXQgcmF3OiB1bmtub3duO1xuICAgIHRyeSB7XG4gICAgICByYXcgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGNvbmZpZ1BhdGgsIFwidXRmOFwiKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIHJlYWQgY29udGFpbmVyIGNvbmZpZyAke2NvbmZpZ1BhdGh9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IHJhdyBhcyB7XG4gICAgICBydW50aW1lPzogdW5rbm93bjtcbiAgICAgIGV4ZWN1dGFibGU/OiB1bmtub3duO1xuICAgICAgaW1hZ2U/OiB1bmtub3duO1xuICAgICAgd3NsPzogdW5rbm93bjtcbiAgICAgIGhlYWx0aENoZWNrPzogdW5rbm93bjtcbiAgICAgIHFlbXU/OiB1bmtub3duO1xuICAgICAgY3VzdG9tPzogdW5rbm93bjtcbiAgICAgIGVsZXZhdGlvbj86IHVua25vd247XG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xuICAgIH07XG4gICAgY29uc3QgcnVudGltZSA9IHRoaXMucmVhZFJ1bnRpbWUoZGF0YS5ydW50aW1lKTtcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBleGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGltYWdlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBsYW5ndWFnZXMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2xhbmd1YWdlLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YS5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93bjsgdXNlRGVmYXVsdD86IHVua25vd24gfTtcbiAgICAgIGNvbnN0IHVzZURlZmF1bHQgPSBsYW5ndWFnZUNvbmZpZy51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICBpZiAoIXVzZURlZmF1bHQgJiYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBkZWZpbmUgY29tbWFuZCBvciB1c2VEZWZhdWx0LmApO1xuICAgICAgfVxuXG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgOiB1bmRlZmluZWQsXG4gICAgICAgIGV4dGVuc2lvbjogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA6IHVzZURlZmF1bHQgPyB1bmRlZmluZWQgOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgICAgdXNlRGVmYXVsdDogdXNlRGVmYXVsdCB8fCB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBydW50aW1lLFxuICAgICAgZXhlY3V0YWJsZTogdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSA9PT0gXCJzdHJpbmdcIiAmJiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpID8gZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICBlbGV2YXRpb246IHRoaXMucmVhZEVsZXZhdGlvbkNvbmZpZyhkYXRhLmVsZXZhdGlvbiksXG4gICAgICB3c2w6IHRoaXMucmVhZFdzbENvbmZpZyhkYXRhLndzbCksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGhlYWx0aENoZWNrXCIpLFxuICAgICAgcWVtdTogdGhpcy5yZWFkUWVtdUNvbmZpZyhkYXRhLnFlbXUpLFxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxuICAgICAgbGFuZ3VhZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRSdW50aW1lKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lclJ1bnRpbWUge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gXCJkb2NrZXJcIjtcbiAgICB9XG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIiB8fCB2YWx1ZSA9PT0gXCJ3c2xcIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgY3VzdG9tLCBvciB3c2wuXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkV3NsQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVdzbENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHdzbCBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyB7IGludGVyYWN0aXZlPzogdW5rbm93biB9O1xuICAgIHJldHVybiB7XG4gICAgICBpbnRlcmFjdGl2ZTogZGF0YS5pbnRlcmFjdGl2ZSA9PT0gdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkRWxldmF0aW9uQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lckVsZXZhdGlvbkNvbmZpZyB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB7IG1vZGU6IFwiZGVmYXVsdFwiIH07XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGlmICh2YWx1ZSA9PT0gXCJkZWZhdWx0XCIgfHwgdmFsdWUgPT09IFwicm9vdFwiKSB7XG4gICAgICAgIHJldHVybiB7IG1vZGU6IHZhbHVlIH07XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGVsZXZhdGlvbiBtdXN0IGJlIGRlZmF1bHQsIHJvb3QsIG9yIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGVsZXZhdGlvbiBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBtb2RlID0gZGF0YS5tb2RlID09IG51bGwgPyBcImRlZmF1bHRcIiA6IGRhdGEubW9kZTtcbiAgICBpZiAobW9kZSAhPT0gXCJkZWZhdWx0XCIgJiYgbW9kZSAhPT0gXCJyb290XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZWxldmF0aW9uLm1vZGUgbXVzdCBiZSBkZWZhdWx0IG9yIHJvb3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgbW9kZSxcbiAgICAgIGNvbW1hbmRQcmVmaXg6IG9wdGlvbmFsU3RyaW5nKGRhdGEuY29tbWFuZFByZWZpeCksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgb2NpRWxldmF0aW9uQXJncyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGNvbmZpZy5lbGV2YXRpb24ubW9kZSA9PT0gXCJyb290XCIgPyBbXCItLXVzZXJcIiwgXCJyb290XCJdIDogW107XG4gIH1cblxuICBwcml2YXRlIGFwcGx5Q29tbWFuZFByZWZpeChjb25maWc6IGxvb21Db250YWluZXJDb25maWcsIGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgcHJlZml4ID0gY29uZmlnLmVsZXZhdGlvbi5tb2RlID09PSBcInJvb3RcIiA/IGNvbmZpZy5lbGV2YXRpb24uY29tbWFuZFByZWZpeD8udHJpbSgpIDogXCJcIjtcbiAgICByZXR1cm4gcHJlZml4ID8gYCR7cHJlZml4fSAke2NvbW1hbmR9YCA6IGNvbW1hbmQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkhlYWx0aENoZWNrKFxuICAgIGhlYWx0aENoZWNrOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWhlYWx0aENoZWNrKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShoZWFsdGhDaGVjay5jb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGNvbnN0IGNvbWJpbmVkT3V0cHV0ID0gYCR7cmVzdWx0LnN0ZG91dH1cXG4ke3Jlc3VsdC5zdGRlcnJ9YDtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSAmJiBjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IHJldHVybmVkIG5lZ2F0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlICYmICFjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGRpZCBub3QgcmV0dXJuIHBvc2l0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PcHRpb25hbENvbW1hbmQoXG4gICAgY29tbWFuZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbW1hbmQ/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkNvbW1hbmRMaW5lKFxuICAgIGNvbW1hbmQ6IHN0cmluZyxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcGFydHMgPSBzcGxpdENvbW1hbmRMaW5lKGNvbW1hbmQpO1xuICAgIGlmICghcGFydHMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gY29tbWFuZCBpcyBlbXB0eS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogcGFydHNbMF0sXG4gICAgICBhcmdzOiBwYXJ0cy5zbGljZSgxKSxcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBzaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZU1hbmFnZWRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgcWVtdTogbG9vbVFlbXVDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IGV4aXN0aW5nUGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoZXhpc3RpbmdQaWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKGV4aXN0aW5nUGlkKSkge1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdQaWQpIHtcbiAgICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IG1hbmFnZXIuZXhlY3V0YWJsZSB8fCBcInFlbXUtc3lzdGVtLXg4Nl82NFwiO1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aCwgbWFuYWdlcik7XG4gICAgaWYgKCFhcmdzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBuZWVkcyBxZW11Lm1hbmFnZXIuYXJncyBvciBxZW11Lm1hbmFnZXIuaW1hZ2UuYCk7XG4gICAgfVxuXG4gICAgY29uc3QgbG9nUGF0aCA9IG1hbmFnZXIubG9nRmlsZSA/IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmxvZ0ZpbGUpIDogbnVsbDtcbiAgICBjb25zdCBsb2dGZCA9IGxvZ1BhdGggPyBvcGVuU3luYyhsb2dQYXRoLCBcImFcIikgOiBudWxsO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4ZWN1dGFibGUsIGFyZ3MsIHtcbiAgICAgICAgY3dkOiBncm91cFBhdGgsXG4gICAgICAgIGRldGFjaGVkOiB0cnVlLFxuICAgICAgICBzdGRpbzogW1wiaWdub3JlXCIsIGxvZ0ZkID8/IFwiaWdub3JlXCIsIGxvZ0ZkID8/IFwiaWdub3JlXCJdLFxuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKCkgPT4gdW5kZWZpbmVkKTtcbiAgICAgIGNoaWxkLnVucmVmKCk7XG5cbiAgICAgIGlmICghY2hpbGQucGlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gZGlkIG5vdCByZXR1cm4gYSBwcm9jZXNzIGlkLmApO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB3cml0ZUZpbGUocGlkUGF0aCwgYCR7Y2hpbGQucGlkfVxcbmAsIFwidXRmOFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChsb2dGZCAhPSBudWxsKSB7XG4gICAgICAgIGNsb3NlU3luYyhsb2dGZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBidWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGg6IHN0cmluZywgbWFuYWdlcjogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKG1hbmFnZXIuYXJncyB8fCBcIlwiKTtcbiAgICBpZiAobWFuYWdlci5pbWFnZSkge1xuICAgICAgY29uc3QgaW1hZ2VQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIuaW1hZ2UpO1xuICAgICAgYXJncy5wdXNoKFwiLWRyaXZlXCIsIGBmaWxlPSR7aW1hZ2VQYXRofSxpZj12aXJ0aW8sZm9ybWF0PSR7bWFuYWdlci5pbWFnZUZvcm1hdCB8fCBcInFjb3cyXCJ9YCk7XG4gICAgfVxuICAgIHJldHVybiBhcmdzO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgcWVtdTogbG9vbVFlbXVDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXFlbXUuaGVhbHRoQ2hlY2spIHtcbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChtYW5hZ2VyLmJvb3REZWxheU1zID8/IDAsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZW91dCA9IE1hdGgubWluKG1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zID8/IDYwXzAwMCwgTWF0aC5tYXgodGltZW91dE1zLCAxKSk7XG4gICAgY29uc3QgaW50ZXJ2YWwgPSBtYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXMgPz8gMV8wMDA7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICBsZXQgbGFzdEVycm9yID0gXCJcIjtcblxuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXQpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgJHtncm91cE5hbWV9IHJlYWRpbmVzcyB3YWl0IGNhbmNlbGxlZC5gKTtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIE1hdGgubWluKGludGVydmFsLCB0aW1lb3V0KSwgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnJlYWR5YCwgYFFFTVUgJHtncm91cE5hbWV9IHJlYWRpbmVzcyBjaGVja2ApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbChpbnRlcnZhbCwgc2lnbmFsKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgJHtncm91cE5hbWV9IGRpZCBub3QgYmVjb21lIHJlYWR5IHdpdGhpbiAke3RpbWVvdXR9IG1zJHtsYXN0RXJyb3IgPyBgOiAke2xhc3RFcnJvcn1gIDogXCIuXCJ9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgcWVtdTogbG9vbVFlbXVDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWFuYWdlciA9IHFlbXUubWFuYWdlcjtcbiAgICBpZiAoIW1hbmFnZXI/LmVuYWJsZWQgfHwgbWFuYWdlci5wZXJzaXN0ICE9PSBmYWxzZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQoXG4gICAgICAgIG1hbmFnZXIuc2h1dGRvd25Db21tYW5kLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIE1hdGgubWluKG1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXMgPz8gdGltZW91dE1zLCB0aW1lb3V0TXMpLFxuICAgICAgICBzaWduYWwsXG4gICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6c2h1dGRvd25gLFxuICAgICAgICBgUUVNVSAke2dyb3VwTmFtZX0gc2h1dGRvd25gLFxuICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBtYW5hZ2VyLmtpbGxTaWduYWwgfHwgXCJTSUdURVJNXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHN0b3BwZWQgPSBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIG1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXMgPz8gMTBfMDAwLCBzaWduYWwpO1xuICAgIGlmICghc3RvcHBlZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgXCJTSUdLSUxMXCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCAyXzAwMCwgc2lnbmFsKTtcbiAgICB9XG5cbiAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGg6IHN0cmluZywgbWFuYWdlcjogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybiBcInN0b3BwZWRcIjtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpID8gYHJ1bm5pbmcgcGlkICR7cGlkfWAgOiBgc3RhbGUgcGlkICR7cGlkfWA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRQaWRGaWxlKHBpZFBhdGg6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IChhd2FpdCByZWFkRmlsZShwaWRQYXRoLCBcInV0ZjhcIikpLnRyaW0oKTtcbiAgICAgIGNvbnN0IHBpZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGlkKSAmJiBwaWQgPiAwID8gcGlkIDogbnVsbDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNQcm9jZXNzUnVubmluZyhwaWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHRyeSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCAwKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvclByb2Nlc3NFeGl0KHBpZDogbnVtYmVyLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dE1zKSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKCF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHNsZWVwV2l0aFNpZ25hbCgyNTAsIHNpZ25hbCk7XG4gICAgfVxuICAgIHJldHVybiAhdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHJlcXVlc3Q6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjdXN0b20gPSB0aGlzLnJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGN1c3RvbS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOmhlYWx0aGAsIGBDdXN0b20gJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgY29uc3QgcmVxdWVzdEZpbGVOYW1lID0gYHJlcXVlc3RfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfS5qc29uYDtcbiAgICBjb25zdCByZXF1ZXN0UGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCByZXF1ZXN0RmlsZU5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdFBhdGgsIGAke0pTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpfVxcbmAsIFwidXRmOFwiKTtcbiAgICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKGN1c3RvbS5hcmdzIHx8IFwie3JlcXVlc3R9XCIpLm1hcCgoYXJnKSA9PlxuICAgICAgICBhcmdcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCByZXF1ZXN0UGF0aClcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cH1cIiwgZ3JvdXBOYW1lKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwUGF0aH1cIiwgZ3JvdXBQYXRoKSxcbiAgICAgICk7XG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206JHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBydW5uZXJOYW1lOiBgQ3VzdG9tICR7Z3JvdXBOYW1lfSAke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IGN1c3RvbS5leGVjdXRhYmxlLFxuICAgICAgICBhcmdzLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHJtKHJlcXVlc3RQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQ3VzdG9tUmVxdWVzdChcbiAgICBhY3Rpb246IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdFtcImFjdGlvblwiXSxcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgZXh0cmE6IFBhcnRpYWw8bG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0PiA9IHt9LFxuICApOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb24sXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBydW50aW1lOiBjb25maWcucnVudGltZSxcbiAgICAgIGltYWdlOiBjb25maWcuaW1hZ2UsXG4gICAgICBidWlsZDogY29uZmlnLmN1c3RvbT8uYnVpbGQsXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBjb25maWcuY3VzdG9tPy5jb21tYW5kU3RydWN0dXJlLFxuICAgICAgdGVhcmRvd246IGNvbmZpZy5jdXN0b20/LnRlYXJkb3duLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgY29uZmlnOiB7XG4gICAgICAgIGV4ZWN1dGFibGU6IGNvbmZpZy5leGVjdXRhYmxlLFxuICAgICAgICBjdXN0b206IGNvbmZpZy5jdXN0b20sXG4gICAgICAgIHFlbXU6IGNvbmZpZy5xZW11LFxuICAgICAgICBoZWFsdGhDaGVjazogY29uZmlnLmhlYWx0aENoZWNrLFxuICAgICAgICBlbGV2YXRpb246IGNvbmZpZy5lbGV2YXRpb24sXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZXMgZmlyc3QsIGluY2x1ZGluZyBleHRlcm5hbCBsYW5ndWFnZSBwYWNrcy5cbiAgICBjb25zdCBjdXN0b20gPSBmaW5kRW5hYmxlZENvbW1hbmRMYW5ndWFnZShzZXR0aW5ncywgbm9ybWFsaXplZCk7XG4gICAgaWYgKGN1c3RvbSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZDogYCR7Y3VzdG9tLmV4ZWN1dGFibGV9ICR7Y3VzdG9tLmFyZ3N9YC50cmltKCksXG4gICAgICAgIGV4dGVuc2lvbjogY3VzdG9tLmV4dGVuc2lvbiB8fCBcIi50eHRcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU3RhbmRhcmQgYnVpbHQtaW5zXG4gICAgc3dpdGNoIChub3JtYWxpemVkKSB7XG4gICAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICBjYXNlIFwicHlcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgICAgY2FzZSBcImpzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwibm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICBjYXNlIFwidHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwidHMtbm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcInNoZWxsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogXCJzaCB7ZmlsZX1cIixcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNoXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiYmFzaFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNoZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJiYXNoXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zaFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1YnlcIjpcbiAgICAgIGNhc2UgXCJyYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1YnlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJiXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGVybFwiOlxuICAgICAgY2FzZSBcInBsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGVybEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGVybFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsdWFcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImx1YVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubHVhXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGhwXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGhwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJwaHBcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBocFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImdvXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuZ29FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdvXCJ9IHJ1biB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuZ29cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICBjYXNlIFwiaHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJydW5naGNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmhzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIGNhc2UgXCJtbFwiOlxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcImR1bmVcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZHVuZVwifSBleGVjIC0tIG9jYW1sIHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcIm9jYW1sY1wiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxjXCJ9IC1vIC90bXAvbG9vbS1vY2FtbCBcIiQxXCIgJiYgL3RtcC9sb29tLW9jYW1sYCksXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdjY1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLWMgJiYgL3RtcC9sb29tLWNgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIGNhc2UgXCJjKytcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnKytcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jcHAgJiYgL3RtcC9sb29tLWNwcGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuY3BwXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiZWJwZlwiOlxuICAgICAgY2FzZSBcImVicGYtY1wiOlxuICAgICAgY2FzZSBcImJwZlwiOlxuICAgICAgY2FzZSBcImJwZi1jXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmVicGZDbGFuZ0V4ZWN1dGFibGUudHJpbSgpIHx8IFwiY2xhbmdcIn0gLXRhcmdldCBicGYgLU8yIC1nIC1XYWxsIFwiJDFcIiAtYyAtbyAvdG1wL2xvb20tZWJwZi5vICYmIHByaW50ZiAnY29tcGlsZWQgL3RtcC9sb29tLWVicGYub1xcXFxuJ2ApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuYnBmLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJicGZ0cmFjZVwiOlxuICAgICAgY2FzZSBcImJ0XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGBpZiAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtLWhlbHAgMj4mMSB8IGdyZXAgLXEgLS0gJy0tZHJ5LXJ1bic7IHRoZW4gJHtzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYnBmdHJhY2VcIn0gLS1kcnktcnVuIFwiJDFcIjsgZWxzZSAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtZCBcIiQxXCI7IGZpYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5idFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1c3RcIjpcbiAgICAgIGNhc2UgXCJyc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydXN0Y1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLXJ1c3QgJiYgL3RtcC9sb29tLXJ1c3RgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YVwiOiB7XG4gICAgICAgIGNvbnN0IGNvbXBpbGVyID0gc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhY1wiO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgdG1wPS90bXAvbG9vbS1qYXZhLSQkICYmIG1rZGlyIC1wIFwiJHRtcFwiICYmIGNwIFwiJDFcIiBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtjb21waWxlcn0gXCIkdG1wL01haW4uamF2YVwiICYmICR7c2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YVwifSAtY3AgXCIkdG1wXCIgTWFpbmApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuamF2YVwiLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIGNhc2UgXCJsbHZtXCI6XG4gICAgICBjYXNlIFwibGxcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxsaVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsZWFuXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGVhblwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNvcVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiY29xY1wifSAtcSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInNtdGxpYlwiOlxuICAgICAgY2FzZSBcInNtdFwiOlxuICAgICAgY2FzZSBcInNtdC1saWJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInozXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNoIC1sYyAke3F1b3RlQ29tbWFuZEFyZyhjb21tYW5kKX0gc2gge2ZpbGV9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTaWduYWwodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBOb2RlSlMuU2lnbmFscyB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgc2lnbmFsIG5hbWUgbGlrZSBTSUdURVJNLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZHVyYXRpb25NcyA8PSAwIHx8IHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAocnVudGltZSkge1xuICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xuICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgIHJldHVybiBcIlBvZG1hblwiO1xuICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICByZXR1cm4gXCJRRU1VXCI7XG4gICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XG4gICAgY2FzZSBcIndzbFwiOlxuICAgICAgcmV0dXJuIFwiV1NMXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG5cbmZ1bmN0aW9uIHF1b3RlQ29tbWFuZEFyZyh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XG4gIHJ1bm5lcklkOiBzdHJpbmc7XG4gIHJ1bm5lck5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgc3RkaW4/OiBzdHJpbmc7XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlU3BlYyBleHRlbmRzIGxvb21Qcm9jZXNzU3BlYyB7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VIYW5kbGUge1xuICB0ZW1wRGlyOiBzdHJpbmc7XG4gIHRlbXBGaWxlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZU5hbWU6IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tXCIpKTtcbiAgY29uc3QgdGVtcEZpbGUgPSBqb2luKHRlbXBEaXIsIGZpbGVOYW1lKTtcblxuICB0cnkge1xuICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZSwgbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2UpLCBcInV0ZjhcIik7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHsgdGVtcERpciwgdGVtcEZpbGUgfSk7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVFeHRlbnNpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoYHNuaXBwZXQke2ZpbGVFeHRlbnNpb259YCwgc291cmNlLCBjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgY29uc3Qgbm9uRW1wdHlMaW5lcyA9IGxpbmVzLmZpbHRlcigobGluZSkgPT4gbGluZS50cmltKCkubGVuZ3RoID4gMCk7XG4gIGlmICghbm9uRW1wdHlMaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgbGV0IHNoYXJlZEluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKG5vbkVtcHR5TGluZXNbMF0pO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygbm9uRW1wdHlMaW5lcy5zbGljZSgxKSkge1xuICAgIHNoYXJlZEluZGVudCA9IHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgoc2hhcmVkSW5kZW50LCBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKSk7XG4gICAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICAgIHJldHVybiBzb3VyY2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgcmV0dXJuIGxpbmVzXG4gICAgLm1hcCgobGluZSkgPT4gKGxpbmUudHJpbSgpLmxlbmd0aCA9PT0gMCA/IGxpbmUgOiBsaW5lLnN0YXJ0c1dpdGgoc2hhcmVkSW5kZW50KSA/IGxpbmUuc2xpY2Uoc2hhcmVkSW5kZW50Lmxlbmd0aCkgOiBsaW5lKSlcbiAgICAuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGxlZnQubGVuZ3RoICYmIGluZGV4IDwgcmlnaHQubGVuZ3RoICYmIGxlZnRbaW5kZXhdID09PSByaWdodFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG4gIHJldHVybiBsZWZ0LnNsaWNlKDAsIGluZGV4KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blByb2Nlc3Moc3BlYzogbG9vbVByb2Nlc3NTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGxldCBzdGRvdXQgPSBcIlwiO1xuICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVkT3V0ID0gZmFsc2U7XG4gIGxldCBjYW5jZWxsZWQgPSBmYWxzZTtcbiAgbGV0IGNoaWxkOiBSZXR1cm5UeXBlPHR5cGVvZiBzcGF3bj4gfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVvdXRIYW5kbGU6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIGxldCBhYm9ydEhhbmRsZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGQgPSBzcGF3bihzcGVjLmV4ZWN1dGFibGUsIHNwZWMuYXJncywge1xuICAgICAgICBjd2Q6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgc2hlbGw6IGZhbHNlLFxuICAgICAgICBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAuLi5zcGVjLmVudixcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY2hpbGQuc3RkaW4/Lm9uKFwiZXJyb3JcIiwgKGVycm9yOiBOb2RlSlMuRXJybm9FeGNlcHRpb24pID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFwiRVBJUEVcIikge1xuICAgICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKHNwZWMuc3RkaW4gIT0gbnVsbCkge1xuICAgICAgICBjaGlsZC5zdGRpbj8uZW5kKHNwZWMuc3RkaW4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2hpbGQuc3RkaW4/LmRlc3Ryb3koKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgc3RkaW46IHNwZWMuc3RkaW4sXG4gICAgICBlbnY6IGV4cGFuZFRlbXBsYXRlZEVudihzcGVjLmVudiwgdGVtcEZpbGUsIHRlbXBEaXIpLFxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBleHBhbmRUZW1wbGF0ZWRFbnYoZW52OiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCwgdGVtcEZpbGU6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQge1xuICBpZiAoIWVudikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGVudikubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgIGtleSxcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcbiAgICBdKSxcbiAgKTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gc3BsaXRDb21tYW5kTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICBsZXQgcXVvdGU6IFwiJ1wiIHwgXCJcXFwiXCIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGVzY2FwaW5nID0gZmFsc2U7XG5cbiAgZm9yIChjb25zdCBjaGFyIG9mIGlucHV0LnRyaW0oKSkge1xuICAgIGlmIChlc2NhcGluZykge1xuICAgICAgY3VycmVudCArPSBjaGFyO1xuICAgICAgZXNjYXBpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBcIlxcXFxcIikge1xuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKChjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcIlxcXCJcIikgJiYgIXF1b3RlKSB7XG4gICAgICBxdW90ZSA9IGNoYXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGNoYXIpICYmICFxdW90ZSkge1xuICAgICAgaWYgKGN1cnJlbnQpIHtcbiAgICAgICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9IFwiXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjdXJyZW50ICs9IGNoYXI7XG4gIH1cblxuICBpZiAoY3VycmVudCkge1xuICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUxhbmd1YWdlRGVmaW5pdGlvbiB7XG4gIGlkOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBhbGlhc2VzOiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VQYWNrYWdlIHtcbiAgaWQ6IHN0cmluZztcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgbGFuZ3VhZ2VzOiBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uW107XG59XG5cbmV4cG9ydCBjb25zdCBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUzogbG9vbUxhbmd1YWdlUGFja2FnZVtdID0gW1xuICB7XG4gICAgaWQ6IFwiaW50ZXJwcmV0ZWRcIixcbiAgICBkaXNwbGF5TmFtZTogXCJJbnRlcnByZXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlNjcmlwdCBhbmQgUkVQTC1vcmllbnRlZCBsYW5ndWFnZXMgZm9yIG9wZXJhdGlvbmFsIG5vdGVzIGFuZCBxdWljayBleHBlcmltZW50cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwicHl0aG9uXCIsIGRpc3BsYXlOYW1lOiBcIlB5dGhvblwiLCBhbGlhc2VzOiBbXCJweXRob25cIiwgXCJweVwiXSB9LFxuICAgICAgeyBpZDogXCJqYXZhc2NyaXB0XCIsIGRpc3BsYXlOYW1lOiBcIkphdmFTY3JpcHRcIiwgYWxpYXNlczogW1wiamF2YXNjcmlwdFwiLCBcImpzXCJdIH0sXG4gICAgICB7IGlkOiBcInR5cGVzY3JpcHRcIiwgZGlzcGxheU5hbWU6IFwiVHlwZVNjcmlwdFwiLCBhbGlhc2VzOiBbXCJ0eXBlc2NyaXB0XCIsIFwidHNcIl0gfSxcbiAgICAgIHsgaWQ6IFwic2hlbGxcIiwgZGlzcGxheU5hbWU6IFwiU2hlbGxcIiwgYWxpYXNlczogW1wic2hlbGxcIiwgXCJzaFwiLCBcImJhc2hcIiwgXCJ6c2hcIl0gfSxcbiAgICAgIHsgaWQ6IFwicnVieVwiLCBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsIGFsaWFzZXM6IFtcInJ1YnlcIiwgXCJyYlwiXSB9LFxuICAgICAgeyBpZDogXCJwZXJsXCIsIGRpc3BsYXlOYW1lOiBcIlBlcmxcIiwgYWxpYXNlczogW1wicGVybFwiLCBcInBsXCJdIH0sXG4gICAgICB7IGlkOiBcImx1YVwiLCBkaXNwbGF5TmFtZTogXCJMdWFcIiwgYWxpYXNlczogW1wibHVhXCJdIH0sXG4gICAgICB7IGlkOiBcInBocFwiLCBkaXNwbGF5TmFtZTogXCJQSFBcIiwgYWxpYXNlczogW1wicGhwXCJdIH0sXG4gICAgICB7IGlkOiBcImdvXCIsIGRpc3BsYXlOYW1lOiBcIkdvXCIsIGFsaWFzZXM6IFtcImdvXCIsIFwiZ29sYW5nXCJdIH0sXG4gICAgICB7IGlkOiBcImhhc2tlbGxcIiwgZGlzcGxheU5hbWU6IFwiSGFza2VsbFwiLCBhbGlhc2VzOiBbXCJoYXNrZWxsXCIsIFwiaHNcIl0gfSxcbiAgICAgIHsgaWQ6IFwib2NhbWxcIiwgZGlzcGxheU5hbWU6IFwiT0NhbWxcIiwgYWxpYXNlczogW1wib2NhbWxcIiwgXCJtbFwiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJuYXRpdmUtY29tcGlsZWRcIixcbiAgICBkaXNwbGF5TmFtZTogXCJOYXRpdmUgQ29tcGlsZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJMYW5ndWFnZXMgY29tcGlsZWQgaW50byBuYXRpdmUgYmluYXJpZXMgYnkgbG9jYWwgdG9vbGNoYWlucy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwiY1wiLCBkaXNwbGF5TmFtZTogXCJDXCIsIGFsaWFzZXM6IFtcImNcIiwgXCJoXCJdIH0sXG4gICAgICB7IGlkOiBcImNwcFwiLCBkaXNwbGF5TmFtZTogXCJDKytcIiwgYWxpYXNlczogW1wiY3BwXCIsIFwiY3h4XCIsIFwiY2NcIiwgXCJjKytcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibWFuYWdlZC1jb21waWxlZFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIk1hbmFnZWQgQ29tcGlsZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJDb21waWxlZCBsYW5ndWFnZXMgd2l0aCBtYW5hZ2VkIHJ1bnRpbWVzIG9yIHN0cnVjdHVyZWQgYnVpbGQvcnVuIHBoYXNlcy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwicnVzdFwiLCBkaXNwbGF5TmFtZTogXCJSdXN0XCIsIGFsaWFzZXM6IFtcInJ1c3RcIiwgXCJyc1wiXSB9LFxuICAgICAgeyBpZDogXCJqYXZhXCIsIGRpc3BsYXlOYW1lOiBcIkphdmFcIiwgYWxpYXNlczogW1wiamF2YVwiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJwcm9vZnNcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQcm9vZnNcIixcbiAgICBkZXNjcmlwdGlvbjogXCJQcm9vZiBhc3Npc3RhbnRzIGFuZCBzb2x2ZXItb3JpZW50ZWQgbGFuZ3VhZ2VzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJsZWFuXCIsIGRpc3BsYXlOYW1lOiBcIkxlYW5cIiwgYWxpYXNlczogW1wibGVhblwiLCBcImxlYW40XCJdIH0sXG4gICAgICB7IGlkOiBcImNvcVwiLCBkaXNwbGF5TmFtZTogXCJDb3FcIiwgYWxpYXNlczogW1wiY29xXCIsIFwidlwiXSB9LFxuICAgICAgeyBpZDogXCJzbXRsaWJcIiwgZGlzcGxheU5hbWU6IFwiU01ULUxJQlwiLCBhbGlhc2VzOiBbXCJzbXRcIiwgXCJzbXQyXCIsIFwic210bGliXCIsIFwic210LWxpYlwiLCBcInozXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcImxsdm1cIixcbiAgICBkaXNwbGF5TmFtZTogXCJMTFZNXCIsXG4gICAgZGVzY3JpcHRpb246IFwiTExWTSBJUiB0b29saW5nIGZvciBjb21waWxlciBhbmQgUEwgcmVzZWFyY2ggdmF1bHRzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJsbHZtLWlyXCIsIGRpc3BsYXlOYW1lOiBcIkxMVk0gSVJcIiwgYWxpYXNlczogW1wibGx2bVwiLCBcImxsdm1pclwiLCBcImxsdm0taXJcIiwgXCJsbFwiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJlYnBmXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiZUJQRlwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIktlcm5lbCBpbnN0cnVtZW50YXRpb24gbGFuZ3VhZ2VzIGZvciBCUEYgb2JqZWN0IGNvbXBpbGF0aW9uLCB2ZXJpZmllciBjaGVja3MsIGFuZCBicGZ0cmFjZSBzY3JpcHRzLlwiLFxuICAgIGxhbmd1YWdlczogW1xuICAgICAgeyBpZDogXCJlYnBmLWNcIiwgZGlzcGxheU5hbWU6IFwiZUJQRiBDXCIsIGFsaWFzZXM6IFtcImVicGZcIiwgXCJlYnBmLWNcIiwgXCJicGYtY1wiLCBcImJwZlwiXSB9LFxuICAgICAgeyBpZDogXCJicGZ0cmFjZVwiLCBkaXNwbGF5TmFtZTogXCJicGZ0cmFjZVwiLCBhbGlhc2VzOiBbXCJicGZ0cmFjZVwiLCBcImJ0XCJdIH0sXG4gICAgXSxcbiAgfSxcbl07XG5cbmV4cG9ydCBjb25zdCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCA9IFwiY3VzdG9tXCI7XG5leHBvcnQgY29uc3QgTEFOR1VBR0VfQ09ORklHVVJBVElPTl9WRVJTSU9OID0gMjtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTogc3RyaW5nW10ge1xuICByZXR1cm4gWy4uLkJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLm1hcCgocGFjaykgPT4gcGFjay5pZCksIENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lEXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldERlZmF1bHRMYW5ndWFnZUlkcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBCVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUy5mbGF0TWFwKChwYWNrKSA9PiBwYWNrLmxhbmd1YWdlcy5tYXAoKGxhbmd1YWdlKSA9PiBsYW5ndWFnZS5pZCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiB2b2lkIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHNldHRpbmdzLmV4dGVybmFsTGFuZ3VhZ2VQYWNrcykpIHtcbiAgICBzZXR0aW5ncy5leHRlcm5hbExhbmd1YWdlUGFja3MgPSBbXTtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MpIHx8ICFzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyA9IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTtcbiAgfVxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyA9IGdldERlZmF1bHRMYW5ndWFnZUlkcygpO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24pKSB7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IDE7XG4gIH1cbiAgaWYgKHNldHRpbmdzLmxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb24gPCAyKSB7XG4gICAgZW5hYmxlTGFuZ3VhZ2VQYWNrYWdlKHNldHRpbmdzLCBcImVicGZcIik7XG4gICAgc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA9IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTjtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgcGFja2FnZUlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcGFjayA9IEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBwYWNrYWdlSWQpO1xuICBpZiAoIXBhY2spIHtcbiAgICByZXR1cm47XG4gIH1cbiAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLCBwYWNrLmlkKTtcbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgIGFwcGVuZFVuaXF1ZShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzLCBsYW5ndWFnZS5pZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kVW5pcXVlKHZhbHVlczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKCF2YWx1ZXMuaW5jbHVkZXModmFsdWUpKSB7XG4gICAgdmFsdWVzLnB1c2godmFsdWUpO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgY29uc3QgZW5hYmxlZFBhY2tzID0gbmV3IFNldChzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyk7XG4gIGNvbnN0IGVuYWJsZWRMYW5ndWFnZXMgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMpO1xuXG4gIHJldHVybiBnZXRBdmFpbGFibGVMYW5ndWFnZVBhY2thZ2VzKHNldHRpbmdzKVxuICAgIC5maWx0ZXIoKHBhY2spID0+IGVuYWJsZWRQYWNrcy5oYXMocGFjay5pZCkpXG4gICAgLmZsYXRNYXAoKHBhY2spID0+IHBhY2subGFuZ3VhZ2VzKVxuICAgIC5maWx0ZXIoKGxhbmd1YWdlKSA9PiBlbmFibGVkTGFuZ3VhZ2VzLmhhcyhsYW5ndWFnZS5pZCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QXZhaWxhYmxlTGFuZ3VhZ2VQYWNrYWdlcyhzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUxhbmd1YWdlUGFja2FnZVtdIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgcmV0dXJuIFtcbiAgICAuLi5CVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUyxcbiAgICAuLi4oc2V0dGluZ3MuZXh0ZXJuYWxMYW5ndWFnZVBhY2tzID8/IFtdKS5tYXAoKHBhY2spID0+ICh7XG4gICAgICBpZDogcGFjay5pZCxcbiAgICAgIGRpc3BsYXlOYW1lOiBwYWNrLmRpc3BsYXlOYW1lLFxuICAgICAgZGVzY3JpcHRpb246IHBhY2suZGVzY3JpcHRpb24sXG4gICAgICBsYW5ndWFnZXM6IHBhY2subGFuZ3VhZ2VzLm1hcCgobGFuZ3VhZ2UpID0+ICh7XG4gICAgICAgIGlkOiBsYW5ndWFnZS5uYW1lLFxuICAgICAgICBkaXNwbGF5TmFtZTogbGFuZ3VhZ2UuZGlzcGxheU5hbWUgfHwgbGFuZ3VhZ2UubmFtZSxcbiAgICAgICAgYWxpYXNlczogcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyksXG4gICAgICB9KSksXG4gICAgfSkpLFxuICBdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuZmxhdE1hcCgobGFuZ3VhZ2UpID0+XG4gICAgICBsYW5ndWFnZS5hbGlhc2VzLm1hcCgoYWxpYXMpID0+IFthbGlhcy50b0xvd2VyQ2FzZSgpLCBsYW5ndWFnZS5pZF0gYXMgY29uc3QpLFxuICAgICksXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0xhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBnZXRFbmFibGVkTGFuZ3VhZ2VEZWZpbml0aW9ucyhzZXR0aW5ncykuc29tZSgobGFuZ3VhZ2UpID0+IGxhbmd1YWdlLmlkID09PSBsYW5ndWFnZUlkKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICByZXR1cm4gc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMoQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5hYmxlZENvbW1hbmRMYW5ndWFnZXMoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZVtdIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgY29uc3QgZW5hYmxlZFBhY2tzID0gbmV3IFNldChzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyk7XG4gIGNvbnN0IGVuYWJsZWRMYW5ndWFnZXMgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMpO1xuICBjb25zdCBjdXN0b21MYW5ndWFnZXMgPSBhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKSA/IHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcyA/PyBbXSA6IFtdO1xuICBjb25zdCBleHRlcm5hbExhbmd1YWdlcyA9IChzZXR0aW5ncy5leHRlcm5hbExhbmd1YWdlUGFja3MgPz8gW10pXG4gICAgLmZpbHRlcigocGFjaykgPT4gZW5hYmxlZFBhY2tzLmhhcyhwYWNrLmlkKSlcbiAgICAuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMpXG4gICAgLmZpbHRlcigobGFuZ3VhZ2UpID0+IGVuYWJsZWRMYW5ndWFnZXMuaGFzKGxhbmd1YWdlLm5hbWUpKTtcblxuICByZXR1cm4gWy4uLmN1c3RvbUxhbmd1YWdlcywgLi4uZXh0ZXJuYWxMYW5ndWFnZXNdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZmluZEVuYWJsZWRDb21tYW5kTGFuZ3VhZ2Uoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgbm9ybWFsaXplZExhbmd1YWdlOiBzdHJpbmcsIHNvdXJjZUFsaWFzPzogc3RyaW5nKTogbG9vbUN1c3RvbUxhbmd1YWdlIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZWRMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgYWxpYXMgPSBzb3VyY2VBbGlhcz8udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBnZXRFbmFibGVkQ29tbWFuZExhbmd1YWdlcyhzZXR0aW5ncykuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKSB8fCBCb29sZWFuKGFsaWFzICYmIChuYW1lID09PSBhbGlhcyB8fCBhbGlhc2VzLmluY2x1ZGVzKGFsaWFzKSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU/OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiAodmFsdWUgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG4iLCAiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTm90ZUV4ZWN1dGlvbkNvbnRleHQge1xuICBjb250YWluZXJHcm91cD86IHN0cmluZztcbiAgZGlzYWJsZUNvbnRhaW5lcj86IGJvb2xlYW47XG4gIHdvcmtpbmdEaXJlY3Rvcnk/OiBzdHJpbmc7XG4gIHRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFeGVjdXRpb25Db250ZXh0KFxuICBhcHA6IEFwcCxcbiAgZmlsZTogVEZpbGUsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuKTogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IG5vdGUgPSByZWFkTm90ZUV4ZWN1dGlvbkNvbnRleHQoYXBwLCBmaWxlKTtcbiAgY29uc3QgZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkgPSByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZSwgc2V0dGluZ3MpO1xuICBjb25zdCBub3RlV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3Rvcnkobm90ZS53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3QgYmxvY2tXb3JraW5nRGlyZWN0b3J5ID0gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeShibG9jay5leGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnkpO1xuICBjb25zdCBub3RlVGltZW91dCA9IG5vdGUudGltZW91dE1zO1xuICBjb25zdCBibG9ja1RpbWVvdXQgPSBibG9jay5leGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcztcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiByZXNvbHZlQ29udGFpbmVyR3JvdXAoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBibG9ja1dvcmtpbmdEaXJlY3RvcnkgPz8gbm90ZVdvcmtpbmdEaXJlY3RvcnkgPz8gZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zOiBibG9ja1RpbWVvdXQgPz8gbm90ZVRpbWVvdXQgPz8gc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICBzb3VyY2U6IHtcbiAgICAgIGNvbnRhaW5lcjogcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShzZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAsIG5vdGUsIGJsb2NrLmV4ZWN1dGlvbkNvbnRleHQpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8gXCJibG9ja1wiIDogbm90ZVdvcmtpbmdEaXJlY3RvcnkgPyBcIm5vdGVcIiA6IHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpID8gXCJnbG9iYWxcIiA6IFwiZGVmYXVsdFwiLFxuICAgICAgdGltZW91dDogYmxvY2tUaW1lb3V0ID8gXCJibG9ja1wiIDogbm90ZVRpbWVvdXQgPyBcIm5vdGVcIiA6IFwiZ2xvYmFsXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lckdyb3VwKFxuICBnbG9iYWxDb250YWluZXI6IHN0cmluZyxcbiAgbm90ZTogTm90ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGJsb2NrOiBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLFxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAobm90ZS5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vdGUuY29udGFpbmVyR3JvdXAudHJpbSgpO1xuICB9XG4gIHJldHVybiBnbG9iYWxDb250YWluZXIudHJpbSgpIHx8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHRbXCJzb3VyY2VcIl1bXCJjb250YWluZXJcIl0ge1xuICBpZiAoYmxvY2suZGlzYWJsZUNvbnRhaW5lciB8fCBibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIFwiYmxvY2tcIjtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyIHx8IG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcIm5vdGVcIjtcbiAgfVxuICBpZiAoZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSkge1xuICAgIHJldHVybiBcImdsb2JhbFwiO1xuICB9XG4gIHJldHVybiBcIm5vbmVcIjtcbn1cblxuZnVuY3Rpb24gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcDogQXBwLCBmaWxlOiBURmlsZSk6IE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBhcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICBpZiAoIWZyb250bWF0dGVyKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY29udGFpbmVyID0gZnJvbnRtYXR0ZXJbXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGZyb250bWF0dGVyW1wibG9vbS1jd2RcIl0gPz8gZnJvbnRtYXR0ZXJbXCJsb29tLXdvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0ID0gZnJvbnRtYXR0ZXJbXCJsb29tLXRpbWVvdXRcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogdHlwZW9mIGNvbnRhaW5lciA9PT0gXCJzdHJpbmdcIiAmJiAhaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgPyBjb250YWluZXIudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiB0eXBlb2Ygd29ya2luZ0RpcmVjdG9yeSA9PT0gXCJzdHJpbmdcIiA/IHdvcmtpbmdEaXJlY3RvcnkgOiB1bmRlZmluZWQsXG4gICAgdGltZW91dE1zOiB0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dCkgJiYgdGltZW91dCA+IDBcbiAgICAgID8gTWF0aC50cnVuYyh0aW1lb3V0KVxuICAgICAgOiB0eXBlb2YgdGltZW91dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHRpbWVvdXQpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZTogVEZpbGUsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBpZiAoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSk7XG4gIH1cblxuICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAoZmlsZS52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgY29uc3QgZmlsZUZvbGRlciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHsgZmluZEVuYWJsZWRDb21tYW5kTGFuZ3VhZ2UsIGdldEVuYWJsZWRDb21tYW5kTGFuZ3VhZ2VzLCBnZXRFbmFibGVkTGFuZ3VhZ2VBbGlhc01hcCB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU291cmNlUmVmZXJlbmNlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgT1VUUFVUX1NUQVJUID0gL148IS0tXFxzKmxvb206b3V0cHV0OnN0YXJ0XFxzK2lkPShbYS1mMC05XSspXFxzKi0tPiQvaTtcbmNvbnN0IE9VVFBVVF9FTkQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6ZW5kXFxzKi0tPiQvaTtcbmNvbnN0IEZFTkNFX1NUQVJUID0gL14oYGBgK3x+fn4rKVxccyooW15cXHNgXSopPyguKikkLztcblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlKHJhd0xhbmd1YWdlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSB8IG51bGwge1xuICBjb25zdCBub3JtYWxpemVkID0gcmF3TGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG5cbiAgaWYgKCFzZXR0aW5ncykge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgY29tbWFuZExhbmd1YWdlID0gZmluZEVuYWJsZWRDb21tYW5kTGFuZ3VhZ2Uoc2V0dGluZ3MsIG5vcm1hbGl6ZWQpO1xuICBpZiAoY29tbWFuZExhbmd1YWdlKSB7XG4gICAgcmV0dXJuIGNvbW1hbmRMYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgfVxuXG4gIGNvbnN0IGFsaWFzZXMgPSBnZXRFbmFibGVkTGFuZ3VhZ2VBbGlhc01hcChzZXR0aW5ncyk7XG4gIHJldHVybiBhbGlhc2VzW25vcm1hbGl6ZWRdID8/IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMoc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmdbXSB7XG4gIGlmICghc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCBjdXN0b21BbGlhc2VzID0gZ2V0RW5hYmxlZENvbW1hbmRMYW5ndWFnZXMoc2V0dGluZ3MpXG4gICAgLmZsYXRNYXAoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIHJldHVybiBbbmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldO1xuICAgIH0pO1xuXG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpKSxcbiAgICAuLi5jdXN0b21BbGlhc2VzLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGluZm9BdHRyaWJ1dGVzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IHNvdXJjZVJlZmVyZW5jZSA9IHBhcnNlU291cmNlUmVmZXJlbmNlKGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcGFyc2VFeGVjdXRpb25Db250ZXh0KGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCByZWZlcmVuY2VIYXNoID0gc291cmNlUmVmZXJlbmNlID8gYDoke0pTT04uc3RyaW5naWZ5KHNvdXJjZVJlZmVyZW5jZSl9YCA6IFwiXCI7XG4gICAgY29uc3QgZXhlY3V0aW9uSGFzaCA9IGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoZXhlY3V0aW9uQ29udGV4dCkgPyBgOiR7SlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uQ29udGV4dCl9YCA6IFwiXCI7XG4gICAgY29uc3QgYXR0cmlidXRlSGFzaCA9IE9iamVjdC5rZXlzKGluZm9BdHRyaWJ1dGVzKS5sZW5ndGggPyBgOiR7SlNPTi5zdHJpbmdpZnkoaW5mb0F0dHJpYnV0ZXMpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGAke2NvbnRlbnR9JHtyZWZlcmVuY2VIYXNofSR7ZXhlY3V0aW9uSGFzaH0ke2F0dHJpYnV0ZUhhc2h9YCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgYXR0cmlidXRlczogaW5mb0F0dHJpYnV0ZXMsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBleGVjdXRpb25Db250ZXh0LFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgcGFyc2VFeGVjdXRpb25Db250ZXh0Pik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihjb250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IGNvbnRleHQuZGlzYWJsZUNvbnRhaW5lciB8fCBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnkgfHwgY29udGV4dC50aW1lb3V0TXMpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU291cmNlUmVmZXJlbmNlKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb24gPSBhdHRyc1tcImxvb20tY2FsbFwiXSA/PyBhdHRycy5jYWxsO1xuICBjb25zdCBjYWxsQXJncyA9IGF0dHJzW1wibG9vbS1hcmdzXCJdID8/IGF0dHJzLmFyZ3M7XG4gIGNvbnN0IHByaW50VmFsdWUgPSBhdHRyc1tcImxvb20tcHJpbnRcIl0gPz8gYXR0cnMucHJpbnQ7XG4gIGNvbnN0IGNhbGwgPSBjYWxsRXhwcmVzc2lvbiAhPSBudWxsIHx8IGNhbGxBcmdzICE9IG51bGxcbiAgICA/IHtcbiAgICAgIGV4cHJlc3Npb246IG5vcm1hbGl6ZUJvb2xlYW5BdHRyaWJ1dGUoY2FsbEV4cHJlc3Npb24pID09PSBcInRydWVcIiA/IHVuZGVmaW5lZCA6IGNhbGxFeHByZXNzaW9uLFxuICAgICAgYXJnczogY2FsbEFyZ3MsXG4gICAgICBwcmludDogcHJpbnRWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhwcmludFZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIH1cbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gICAgY2FsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeGVjdXRpb25Db250ZXh0KGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGF0dHJzW1wibG9vbS1jb250YWluZXJcIl0gPz8gYXR0cnMuY29udGFpbmVyO1xuICBjb25zdCB0aW1lb3V0ID0gYXR0cnNbXCJsb29tLXRpbWVvdXRcIl0gPz8gYXR0cnMudGltZW91dDtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGF0dHJzW1wibG9vbS1jd2RcIl0gPz8gYXR0cnMuY3dkID8/IGF0dHJzW1wid29ya2luZy1kaXJlY3RvcnlcIl07XG4gIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KSA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiBjb250YWluZXIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IGNvbnRhaW5lciA/IGlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpIDogdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBvc2l0aXZlSW50ZWdlcih2YWx1ZTogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLnRyaW0oKSwgMTApO1xuICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwYXJzZWQpICYmIHBhcnNlZCA+IDAgPyBwYXJzZWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzRGlzYWJsZWRWYWx1ZSh2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiLCBcIm5vbmVcIiwgXCJuYXRpdmVcIl0uaW5jbHVkZXModmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUluZm9BdHRyaWJ1dGVzKGlucHV0OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcGF0dGVybiA9IC8oW0EtWmEtejAtOV8tXSspXFxzKj1cXHMqKD86XCIoW15cIl0qKVwifCcoW14nXSopJ3woW15cXHNdKykpL2c7XG4gIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgd2hpbGUgKChtYXRjaCA9IHBhdHRlcm4uZXhlYyhpbnB1dCkpICE9IG51bGwpIHtcbiAgICBhdHRyc1ttYXRjaFsxXS50b0xvd2VyQ2FzZSgpXSA9IG1hdGNoWzJdID8/IG1hdGNoWzNdID8/IG1hdGNoWzRdID8/IFwiXCI7XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVSYW5nZSh2YWx1ZTogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdmFsdWUudHJpbSgpLm1hdGNoKC9eTD8oXFxkKykoPzpcXHMqWy06XVxccypMPyhcXGQrKSk/JC9pKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IGVuZCA9IE51bWJlci5wYXJzZUludChtYXRjaFsyXSA/PyBtYXRjaFsxXSwgMTApO1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RhcnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGVuZCkgfHwgc3RhcnQgPD0gMCB8fCBlbmQgPCBzdGFydCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZUNhcGFiaWxpdHkge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIiB8IFwidG9wLWxldmVsXCIgfCBcImdlbmVyaWNcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIgfCBcInJhd1wiIHwgXCJleHRlcm5hbFwiO1xuICBzb3VyY2VQcmV2aWV3OiBib29sZWFuO1xufVxuXG5jb25zdCBCVUlMVF9JTl9DQVBBQklMSVRJRVM6IFJlY29yZDxzdHJpbmcsIGxvb21MYW5ndWFnZUNhcGFiaWxpdHk+ID0ge1xuICBweXRob246IHtcbiAgICBsYW5ndWFnZTogXCJweXRob25cIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImFzdFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcImphdmFzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgdHlwZXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcInR5cGVzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgYzoge1xuICAgIGxhbmd1YWdlOiBcImNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgY3BwOiB7XG4gICAgbGFuZ3VhZ2U6IFwiY3BwXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwibGx2bS1pclwiOiB7XG4gICAgbGFuZ3VhZ2U6IFwibGx2bS1pclwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgaGFza2VsbDoge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIG9jYW1sOiB7XG4gICAgbGFuZ3VhZ2U6IFwib2NhbWxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YToge1xuICAgIGxhbmd1YWdlOiBcImphdmFcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwiZWJwZi1jXCI6IHtcbiAgICBsYW5ndWFnZTogXCJlYnBmLWNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGJwZnRyYWNlOiB7XG4gICAgbGFuZ3VhZ2U6IFwiYnBmdHJhY2VcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImdlbmVyaWNcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJnZW5lcmljXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYW5ndWFnZUNhcGFiaWxpdHkobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGhhc0V4dGVybmFsRXh0cmFjdG9yID0gZmFsc2UpOiBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgaWYgKGhhc0V4dGVybmFsRXh0cmFjdG9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc3ltYm9sRXh0cmFjdGlvbjogXCJleHRlcm5hbFwiLFxuICAgICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZXh0ZXJuYWxcIixcbiAgICAgIGNhbGxIYXJuZXNzOiBcImV4dGVybmFsXCIsXG4gICAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gQlVJTFRfSU5fQ0FQQUJJTElUSUVTW2xhbmd1YWdlXSA/PyB7XG4gICAgbGFuZ3VhZ2UsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRCdWlsdEluTGFuZ3VhZ2VDYXBhYmlsaXRpZXMoKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eVtdIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoQlVJTFRfSU5fQ0FQQUJJTElUSUVTKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgeyBmaW5kRW5hYmxlZENvbW1hbmRMYW5ndWFnZSB9IGZyb20gXCIuLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIGZpbmRFbmFibGVkQ29tbWFuZExhbmd1YWdlKHNldHRpbmdzLCBibG9jay5sYW5ndWFnZSwgYmxvY2subGFuZ3VhZ2VBbGlhcyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGAuJHtuYW1lfWA7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgSW50ZXJwcmV0ZWRTcGVjIHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKSA9PiBzdHJpbmc7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgYXJncz86IHN0cmluZ1tdO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0VudjtcbiAgbWluaW11bVRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuY29uc3QgSU5URVJQUkVURURfU1BFQ1M6IEludGVycHJldGVkU3BlY1tdID0gW1xuICB7XG4gICAgbGFuZ3VhZ2U6IFwic2hlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3Muc2hlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnNoXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJydWJ5XCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUnVieVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucnVieUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucmJcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBlcmxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQZXJsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5wZXJsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5wbFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwibHVhXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTHVhXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmx1YVwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGhwXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUEhQXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5waHBFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBocFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiZ29cIixcbiAgICBkaXNwbGF5TmFtZTogXCJHb1wiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuZ29FeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmdvXCIsXG4gICAgYXJnczogW1wicnVuXCIsIFwie2ZpbGV9XCJdLFxuICAgIGVudjoge1xuICAgICAgR09DQUNIRTogXCJ7dGVtcERpcn0vZ29jYWNoZVwiLFxuICAgIH0sXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiaGFza2VsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmhhc2tlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmhzXCIsXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuXTtcblxuZXhwb3J0IGNsYXNzIEludGVycHJldGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJpbnRlcnByZXRlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiSW50ZXJwcmV0ZWRcIjtcbiAgbGFuZ3VhZ2VzID0gSU5URVJQUkVURURfU1BFQ1MubWFwKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlKTtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICByZXR1cm4gQm9vbGVhbihzcGVjPy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIGlmICghc3BlYykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfWAsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCksXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MgPz8gW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogc3BlYy5maWxlRXh0ZW5zaW9uLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc3BlYy5taW5pbXVtVGltZW91dE1zID8/IDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgZW52OiBzcGVjLmVudixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3BlYyhsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IEludGVycHJldGVkU3BlYyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIElOVEVSUFJFVEVEX1NQRUNTLmZpbmQoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UgPT09IGxhbmd1YWdlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG50eXBlIEVicGZDTW9kZSA9IFwiY29tcGlsZVwiIHwgXCJsb2FkXCI7XG50eXBlIEJwZnRyYWNlTW9kZSA9IFwiY2hlY2tcIiB8IFwicnVuXCI7XG5cbmV4cG9ydCBjbGFzcyBFYnBmUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJlYnBmXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJlQlBGXCI7XG4gIGxhbmd1YWdlcyA9IFtcImVicGYtY1wiLCBcImJwZnRyYWNlXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJlYnBmLWNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuZWJwZkNsYW5nRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiYnBmdHJhY2VcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuYnBmdHJhY2VFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiZWJwZi1jXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkVicGZDKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJicGZ0cmFjZVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5CcGZ0cmFjZShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGVCUEYgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkVicGZDKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSByZWFkRWJwZkNNb2RlKGJsb2NrKTtcbiAgICBjb25zdCBjZmxhZ3MgPSByZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtY2ZsYWdzXCIsIFwiZWJwZi1jZmxhZ3NcIikuZmxhdE1hcChzcGxpdENvbW1hbmRMaW5lKTtcbiAgICBjb25zdCBpbmNsdWRlUGF0aHMgPSBbXG4gICAgICAuLi5zcGxpdENzdihzZXR0aW5ncy5lYnBmSW5jbHVkZVBhdGhzKSxcbiAgICAgIC4uLnJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1pbmNsdWRlc1wiLCBcImVicGYtaW5jbHVkZXNcIiksXG4gICAgXTtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIuYnBmLmNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3Qgb2JqZWN0UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0LmJwZi5vXCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y2xhbmdgLFxuICAgICAgICBydW5uZXJOYW1lOiBcImVCUEYgY2xhbmdcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuZWJwZkNsYW5nRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICBcIi10YXJnZXRcIixcbiAgICAgICAgICBcImJwZlwiLFxuICAgICAgICAgIFwiLU8yXCIsXG4gICAgICAgICAgXCItZ1wiLFxuICAgICAgICAgIFwiLVdhbGxcIixcbiAgICAgICAgICAuLi5pbmNsdWRlUGF0aHMuZmxhdE1hcCgoaW5jbHVkZVBhdGgpID0+IFtcIi1JXCIsIGluY2x1ZGVQYXRoXSksXG4gICAgICAgICAgLi4uY2ZsYWdzLFxuICAgICAgICAgIFwiLWNcIixcbiAgICAgICAgICB0ZW1wRmlsZSxcbiAgICAgICAgICBcIi1vXCIsXG4gICAgICAgICAgb2JqZWN0UGF0aCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICBjb21waWxlUmVzdWx0LnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRvdXQsIFwiQ29tcGlsZVwiLCBgZUJQRiBvYmplY3QgY29tcGlsZWQgc3VjY2Vzc2Z1bGx5OiAke29iamVjdFBhdGh9YCk7XG4gICAgICBhd2FpdCB0aGlzLmFwcGVuZE9iamVjdEluc3BlY3Rpb24oY29tcGlsZVJlc3VsdCwgb2JqZWN0UGF0aCwgY29udGV4dCwgc2V0dGluZ3MpO1xuXG4gICAgICBpZiAobW9kZSA9PT0gXCJjb21waWxlXCIpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLmxvYWRFYnBmT2JqZWN0KGJsb2NrLCBvYmplY3RQYXRoLCBjb250ZXh0LCBzZXR0aW5ncywgY29tcGlsZVJlc3VsdCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGVuZE9iamVjdEluc3BlY3Rpb24ocmVzdWx0OiBsb29tUnVuUmVzdWx0LCBvYmplY3RQYXRoOiBzdHJpbmcsIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgb2JqZHVtcCA9IHNldHRpbmdzLmVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGlmICghb2JqZHVtcCkge1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSBhcHBlbmRMaW5lKHJlc3VsdC53YXJuaW5nLCBcImVCUEYgb2JqZWN0IGluc3BlY3Rpb24gc2tpcHBlZCBiZWNhdXNlIG5vIG9iamVjdCBpbnNwZWN0b3IgaXMgY29uZmlndXJlZC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgaW5zcGVjdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9iamR1bXBgLFxuICAgICAgcnVubmVyTmFtZTogXCJlQlBGIG9iamVjdCBpbnNwZWN0aW9uXCIsXG4gICAgICBleGVjdXRhYmxlOiBvYmpkdW1wLFxuICAgICAgYXJnczogW1wiLWhcIiwgb2JqZWN0UGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmIChpbnNwZWN0LnN1Y2Nlc3MpIHtcbiAgICAgIHJlc3VsdC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKHJlc3VsdC5zdGRvdXQsIFwiT2JqZWN0IHNlY3Rpb25zXCIsIGluc3BlY3Quc3Rkb3V0LnRyaW0oKSB8fCBcIihubyBzZWN0aW9ucyByZXBvcnRlZClcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gYXBwZW5kTGluZShyZXN1bHQud2FybmluZywgYGVCUEYgb2JqZWN0IGluc3BlY3Rpb24gZmFpbGVkOiAke2luc3BlY3Quc3RkZXJyIHx8IGluc3BlY3Quc3Rkb3V0IHx8IGBleGl0ICR7aW5zcGVjdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZEVicGZPYmplY3QoXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgb2JqZWN0UGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICAgY29tcGlsZVJlc3VsdDogbG9vbVJ1blJlc3VsdCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKCFzZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jb21waWxlUmVzdWx0LFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICBzdGRlcnI6IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwiZUJQRiBrZXJuZWwgbG9hZGluZyBpcyBkaXNhYmxlZC4gRW5hYmxlIEFsbG93IGVCUEYga2VybmVsIGxvYWQgaW4gc2V0dGluZ3MgYmVmb3JlIHVzaW5nIGxvb20tZWJwZi1tb2RlPWxvYWQuXCIpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBwaW5QYXRoID0gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtcGluXCIsIFwiZWJwZi1waW5cIik7XG4gICAgaWYgKCFwaW5QYXRoKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jb21waWxlUmVzdWx0LFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICBzdGRlcnI6IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwibG9vbS1lYnBmLW1vZGU9bG9hZCByZXF1aXJlcyBsb29tLWVicGYtcGluPS9zeXMvZnMvYnBmLzxwYXRoPi5cIiksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGxvYWQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpicGZ0b29sOmxvYWRgLFxuICAgICAgcnVubmVyTmFtZTogXCJicGZ0b29sIGVCUEYgbG9hZFwiLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuZWJwZkJwZnRvb2xFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImJwZnRvb2xcIixcbiAgICAgIGFyZ3M6IFtcIi1kXCIsIFwicHJvZ1wiLCBcImxvYWRhbGxcIiwgb2JqZWN0UGF0aCwgcGluUGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGxvYWQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihjb21waWxlUmVzdWx0LnN0ZG91dCwgXCJicGZ0b29sIHN0ZG91dFwiLCBsb2FkLnN0ZG91dC50cmltKCkpO1xuICAgIGxvYWQuc3RkZXJyID0gYXBwZW5kU2VjdGlvbihjb21waWxlUmVzdWx0LnN0ZGVyciwgXCJicGZ0b29sIHN0ZGVyclwiLCBsb2FkLnN0ZGVyci50cmltKCkpO1xuICAgIGxvYWQud2FybmluZyA9IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC53YXJuaW5nLCBgZUJQRiBvYmplY3QgbG9hZCByZXF1ZXN0ZWQgd2l0aCBwaW4gcGF0aCAke3BpblBhdGh9LmApO1xuICAgIHJldHVybiBsb2FkO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5CcGZ0cmFjZShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gcmVhZEJwZnRyYWNlTW9kZShibG9jayk7XG4gICAgY29uc3QgZXh0cmFBcmdzID0gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1icGZ0cmFjZS1hcmdzXCIsIFwiYnBmdHJhY2UtYXJnc1wiKS5mbGF0TWFwKHNwbGl0Q29tbWFuZExpbmUpO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy5icGZ0cmFjZUV4ZWN1dGFibGUudHJpbSgpO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5idFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAobW9kZSA9PT0gXCJydW5cIikge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmJwZnRyYWNlOiR7bW9kZX1gLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdHJhY2VcIixcbiAgICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICAgIGFyZ3M6IFsuLi5leHRyYUFyZ3MsIHRlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpicGZ0cmFjZToke21vZGV9YCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJicGZ0cmFjZSBjaGVja1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItLWRyeS1ydW5cIiwgLi4uZXh0cmFBcmdzLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzICYmIGlzVW5zdXBwb3J0ZWRCcGZ0cmFjZURyeVJ1bihyZXN1bHQpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdHJhY2U6JHttb2RlfTpsZWdhY3ktZGVidWdgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiYnBmdHJhY2UgY2hlY2tcIixcbiAgICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICAgIGFyZ3M6IFtcIi1kXCIsIC4uLmV4dHJhQXJncywgdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlYWRFYnBmQ01vZGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBFYnBmQ01vZGUge1xuICBjb25zdCB2YWx1ZSA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1lYnBmLW1vZGVcIiwgXCJlYnBmLW1vZGVcIikgfHwgXCJjb21waWxlXCI7XG4gIGlmICh2YWx1ZSA9PT0gXCJjb21waWxlXCIgfHwgdmFsdWUgPT09IFwibG9hZFwiKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgZUJQRiBtb2RlOiAke3ZhbHVlfS4gVXNlIGNvbXBpbGUgb3IgbG9hZC5gKTtcbn1cblxuZnVuY3Rpb24gcmVhZEJwZnRyYWNlTW9kZShibG9jazogbG9vbUNvZGVCbG9jayk6IEJwZnRyYWNlTW9kZSB7XG4gIGNvbnN0IHZhbHVlID0gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgXCJsb29tLWJwZnRyYWNlLW1vZGVcIiwgXCJicGZ0cmFjZS1tb2RlXCIpIHx8IFwiY2hlY2tcIjtcbiAgaWYgKHZhbHVlID09PSBcImNoZWNrXCIgfHwgdmFsdWUgPT09IFwicnVuXCIpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBicGZ0cmFjZSBtb2RlOiAke3ZhbHVlfS4gVXNlIGNoZWNrIG9yIHJ1bi5gKTtcbn1cblxuZnVuY3Rpb24gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jazogbG9vbUNvZGVCbG9jaywgcHJpbWFyeTogc3RyaW5nLCBmYWxsYmFjazogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGJsb2NrLmF0dHJpYnV0ZXNbcHJpbWFyeV0/LnRyaW0oKSB8fCBibG9jay5hdHRyaWJ1dGVzW2ZhbGxiYWNrXT8udHJpbSgpIHx8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHByaW1hcnk6IHN0cmluZywgZmFsbGJhY2s6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNwbGl0Q3N2KHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIHByaW1hcnksIGZhbGxiYWNrKSB8fCBcIlwiKTtcbn1cblxuZnVuY3Rpb24gc3BsaXRDc3YodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIGFwcGVuZExpbmUoZXhpc3Rpbmc6IHN0cmluZyB8IHVuZGVmaW5lZCwgbGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtleGlzdGluZywgbGluZV0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0Py50cmltKCkpLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGFwcGVuZFNlY3Rpb24oZXhpc3Rpbmc6IHN0cmluZywgdGl0bGU6IHN0cmluZywgYm9keTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgY29udGVudCA9IGJvZHkudHJpbSgpO1xuICBpZiAoIWNvbnRlbnQpIHtcbiAgICByZXR1cm4gZXhpc3Rpbmc7XG4gIH1cbiAgcmV0dXJuIFtleGlzdGluZy50cmltKCksIGAke3RpdGxlfTpcXG4ke2NvbnRlbnR9YF0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmZ1bmN0aW9uIGlzVW5zdXBwb3J0ZWRCcGZ0cmFjZURyeVJ1bihyZXN1bHQ6IGxvb21SdW5SZXN1bHQpOiBib29sZWFuIHtcbiAgY29uc3Qgb3V0cHV0ID0gYCR7cmVzdWx0LnN0ZGVycn1cXG4ke3Jlc3VsdC5zdGRvdXR9YC50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gKFxuICAgIG91dHB1dC5pbmNsdWRlcyhcIi0tZHJ5LXJ1blwiKSAmJiAob3V0cHV0LmluY2x1ZGVzKFwidW5yZWNvZ25pemVkIG9wdGlvblwiKSB8fCBvdXRwdXQuaW5jbHVkZXMoXCJ1bmtub3duIG9wdGlvblwiKSB8fCBvdXRwdXQuaW5jbHVkZXMoXCJpbnZhbGlkIG9wdGlvblwiKSlcbiAgKSB8fCAoXG4gICAgb3V0cHV0LmluY2x1ZGVzKFwidXNhZ2U6XCIpICYmICFvdXRwdXQuaW5jbHVkZXMoXCItLWRyeS1ydW5cIilcbiAgKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTGx2bVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibGx2bS1pclwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTExWTSBJUlwiO1xuICBsYW5ndWFnZXMgPSBbXCJsbHZtLWlyXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3VsdC50aW1lZE91dCAmJiAhcmVzdWx0LmNhbmNlbGxlZCAmJiByZXN1bHQuZXhpdENvZGUgIT0gbnVsbCAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcbiAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBQcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uIFVuZGVyIGxsaSwgdGhhdCBiZWNvbWVzIHRoZSBwcm9jZXNzIGV4aXQgc3RhdHVzLmA7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxuICAgICAgICAgID8gXCJMTFZNIHByb2dyYW0gZXhpdGVkIHdpdGggY29kZSAwLlwiXG4gICAgICAgICAgOiBgTExWTSBwcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uXFxuVXNlIHN0ZG91dCBpbiB0aGUgSVIgaXRzZWxmIGlmIHlvdSB3YW50IHByaW50YWJsZSBwcm9ncmFtIG91dHB1dC5gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTWFuYWdlZENvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJtYW5hZ2VkLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcInJ1c3RcIiwgXCJqYXZhXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuUnVzdChibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIucnNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShcIk1haW4uamF2YVwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAoIXNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpzb3VyY2VgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRlbXBEaXIsXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wiLWNwXCIsIHRlbXBEaXIsIFwiTWFpblwiXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5hdGl2ZS1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTmF0aXZlIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY3BwXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IGZpbGVFeHRlbnNpb24gPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIi5jXCIgOiBcIi5jcHBcIjtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCJDIChHQ0MpXCIgOiBcIkMrKyAoRysrKVwiO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShmaWxlRXh0ZW5zaW9uLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCBydW5UZW1wRmlsZVByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBPY2FtbFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwib2NhbWxcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XG4gIGxhbmd1YWdlcyA9IFtcIm9jYW1sXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJvY2FtbFwiICYmIEJvb2xlYW4oc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm9jYW1sTW9kZTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIGlmIChtb2RlID09PSBcIm9jYW1sXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmR1bmVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkR1bmUgLyBPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJleGVjXCIsIFwiLS1cIiwgXCJvY2FtbFwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIHN0ZGluOiBjb250ZXh0LnN0ZGluLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5tbFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLWNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItb1wiLCBiaW5hcnlQYXRoLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgc3RkaW46IGNvbnRleHQuc3RkaW4sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1ydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHl0aG9uUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJweXRob25cIjtcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xuICBsYW5ndWFnZXMgPSBbXCJweXRob25cIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIEJvb2xlYW4oc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFByb29mUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJwcm9vZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJsZWFuXCIsIFwiY29xXCIsIFwic210bGliXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpsZWFuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJMZWFuXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjb3FgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkNvcVwiLFxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXG4gICAgICAgIGFyZ3M6IFtcIi1xXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpzbXRsaWJgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlNNVC1MSUIgKFozKVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICBzdGRpbjogY29udGV4dC5zdGRpbixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvb2YgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQgJiYgY29uZmlndXJlZCAhPT0gXCJjb3FjXCIpIHtcbiAgICByZXR1cm4gY29uZmlndXJlZDtcbiAgfVxuXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3BhbUNvcWMpID8gb3BhbUNvcWMgOiBjb25maWd1cmVkIHx8IFwiY29xY1wiO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgeyBmaW5kRW5hYmxlZENvbW1hbmRMYW5ndWFnZSwgaXNMYW5ndWFnZUVuYWJsZWQgfSBmcm9tIFwiLi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBydW5uZXJzOiBsb29tUnVubmVyW10pIHt9XG5cbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLmlzQmxvY2tMYW5ndWFnZUVuYWJsZWQoYmxvY2ssIHNldHRpbmdzKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bm5lcnMuZmluZCgocnVubmVyKSA9PiAoIXJ1bm5lci5sYW5ndWFnZXMubGVuZ3RoIHx8IHJ1bm5lci5sYW5ndWFnZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2UpKSAmJiBydW5uZXIuY2FuUnVuKGJsb2NrLCBzZXR0aW5ncykpID8/IG51bGw7XG4gIH1cblxuICBnZXRTdXBwb3J0ZWRMYW5ndWFnZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xuICB9XG5cbiAgcHJpdmF0ZSBpc0Jsb2NrTGFuZ3VhZ2VFbmFibGVkKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGlzTGFuZ3VhZ2VFbmFibGVkKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gQm9vbGVhbihmaW5kRW5hYmxlZENvbW1hbmRMYW5ndWFnZShzZXR0aW5ncywgYmxvY2subGFuZ3VhZ2UsIGJsb2NrLmxhbmd1YWdlQWxpYXMpKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGdldERlZmF1bHRMYW5ndWFnZUlkcywgZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcyB9IGZyb20gXCIuL2xhbmd1YWdlUGFja2FnZXNcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IHtcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxuICBoYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrOiBmYWxzZSxcbiAgcHJlc2VydmVTb3VyY2VNb2RlOiB0cnVlLFxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxuICB3b3JraW5nRGlyZWN0b3J5OiBcIlwiLFxuICBweXRob25FeGVjdXRhYmxlOiBcInB5dGhvbjNcIixcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxuICB0eXBlc2NyaXB0TW9kZTogXCJ0cy1ub2RlXCIsXG4gIHR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZTogXCJ0cy1ub2RlXCIsXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxuICBvY2FtbEV4ZWN1dGFibGU6IFwib2NhbWxcIixcbiAgY0V4ZWN1dGFibGU6IFwiZ2NjXCIsXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXG4gIHNoZWxsRXhlY3V0YWJsZTogXCJiYXNoXCIsXG4gIHJ1YnlFeGVjdXRhYmxlOiBcInJ1YnlcIixcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxuICBsdWFFeGVjdXRhYmxlOiBcImx1YVwiLFxuICBwaHBFeGVjdXRhYmxlOiBcInBocFwiLFxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcbiAgcnVzdEV4ZWN1dGFibGU6IFwicnVzdGNcIixcbiAgaGFza2VsbEV4ZWN1dGFibGU6IFwicnVuZ2hjXCIsXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXG4gIGphdmFFeGVjdXRhYmxlOiBcImphdmFcIixcbiAgbGx2bUludGVycHJldGVyRXhlY3V0YWJsZTogXCJsbGlcIixcbiAgZWJwZkNsYW5nRXhlY3V0YWJsZTogXCJjbGFuZ1wiLFxuICBlYnBmQnBmdG9vbEV4ZWN1dGFibGU6IFwiYnBmdG9vbFwiLFxuICBlYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlOiBcImxsdm0tb2JqZHVtcFwiLFxuICBlYnBmSW5jbHVkZVBhdGhzOiBcIlwiLFxuICBlYnBmQWxsb3dLZXJuZWxMb2FkOiBmYWxzZSxcbiAgYnBmdHJhY2VFeGVjdXRhYmxlOiBcImJwZnRyYWNlXCIsXG4gIGxlYW5FeGVjdXRhYmxlOiBcImxlYW5cIixcbiAgY29xRXhlY3V0YWJsZTogXCJjb3FjXCIsXG4gIHNtdEV4ZWN1dGFibGU6IFwiejNcIixcbiAgd3JpdGVPdXRwdXRUb05vdGU6IGZhbHNlLFxuICBvdXRwdXRWaXNpYmxlTGluZXM6IDAsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgZXh0cmFjdGVkU291cmNlUHJldmlld01vZGU6IFwiY29sbGFwc2VkXCIsXG4gIHNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YTogdHJ1ZSxcbiAgbGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbjogMixcbiAgZW5hYmxlZExhbmd1YWdlUGFja3M6IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKSxcbiAgZW5hYmxlZExhbmd1YWdlczogZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCksXG4gIGV4dGVybmFsTGFuZ3VhZ2VQYWNrczogW10sXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXG4gIHBkZkV4cG9ydE1vZGU6IFwiYm90aFwiLFxuICBkZWZhdWx0Q29udGFpbmVyR3JvdXA6IFwiXCIsXG59O1xuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgeyBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCwgZ2V0QXZhaWxhYmxlTGFuZ3VhZ2VQYWNrYWdlcywgZ2V0RGVmYXVsdExhbmd1YWdlSWRzLCBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzLCBpc0xhbmd1YWdlRW5hYmxlZCwgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbikge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwLCBsb29tUGx1Z2luKTtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxvb21cIiB9KTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIlJ1biBzdXBwb3J0ZWQgY29kZSBmZW5jZXMgZGlyZWN0bHkgZnJvbSBub3RlcyB3aGlsZSBwcmVzZXJ2aW5nIG5hdGl2ZSBzeW50YXggaGlnaGxpZ2h0aW5nLlwiIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJHZW5lcmFsU2V0dGluZ3ModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkdlbmVyYWwgU2V0dGluZ3NcIiwgdHJ1ZSkpO1xuICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VQYWNrYWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiTGFuZ3VhZ2UgUGFja2FnZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQnVpbHRJblJ1bnRpbWVzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJCdWlsdC1pbiBSdW50aW1lc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkN1c3RvbSBMYW5ndWFnZXNcIikpO1xuICAgIHZvaWQgdGhpcy5yZW5kZXJDb250YWluZXJHcm91cHModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkNvbnRhaW5lcml6YXRpb24gR3JvdXBzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU2VjdGlvbihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIHRpdGxlOiBzdHJpbmcsIG9wZW4gPSBmYWxzZSk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvblwiIH0pO1xuICAgIGRldGFpbHMub3BlbiA9IG9wZW47XG4gICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiB0aXRsZSwgY2xzOiBcImxvb20tc2V0dGluZ3Mtc3VtbWFyeVwiIH0pO1xuICAgIHJldHVybiBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb24tYm9keVwiIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJHZW5lcmFsU2V0dGluZ3MoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkVuYWJsZSBsb2NhbCBleGVjdXRpb25cIilcbiAgICAgIC5zZXREZXNjKFwiRGlzYWJsZWQgYnkgZGVmYXVsdC4gbG9vbSBydW5zIGNvZGUgb24geW91ciBsb2NhbCBtYWNoaW5lIGFuZCBkb2VzIG5vdCBwcm92aWRlIHNhbmRib3hpbmcuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHZhbHVlO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIGxvb20gbm90ZXMgaW4gc291cmNlIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiUHJlc2VydmUgcmF3IGZlbmNlZCBjb2RlIGluIHRoZSBlZGl0b3IgaW5zdGVhZCBvZiBsZXR0aW5nIGxpdmUgcHJldmlldyBjb2xsYXBzZSByZXNlYXJjaCBzbmlwcGV0cy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCB0aW1lb3V0XCIpXG4gICAgICAuc2V0RGVzYyhcIk1heGltdW0gZXhlY3V0aW9uIHRpbWUgaW4gbWlsbGlzZWNvbmRzIGJlZm9yZSBsb29tIHRlcm1pbmF0ZXMgdGhlIHByb2Nlc3MuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjgwMDBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyA9IHBhcnNlZDtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXb3JraW5nIGRpcmVjdG9yeVwiKVxuICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gRW1wdHkgdXNlcyB0aGUgY3VycmVudCBub3RlIGZvbGRlciB3aGVuIHBvc3NpYmxlLCBvdGhlcndpc2UgdGhlIHZhdWx0IHJvb3QuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIlZhdWx0IHJvb3RcIikuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5ID0gdmFsdWUudHJpbSgpID8gbm9ybWFsaXplUGF0aCh2YWx1ZS50cmltKCkpIDogXCJcIjtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXcml0ZSBvdXRwdXQgYmFjayB0byBub3RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkluc2VydCBtYW5hZ2VkIGxvb20gb3V0cHV0IHNlY3Rpb25zIGJlbmVhdGggY29kZSBibG9ja3MgaW5zdGVhZCBvZiBrZWVwaW5nIHJlc3VsdHMgcHVyZWx5IGluIHRoZSBVSS5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVmlzaWJsZSBvdXRwdXQgbGluZXNcIilcbiAgICAgIC5zZXREZXNjKFwiTGltaXQgZWFjaCBzdGRvdXQsIHN0ZGVyciwgYW5kIHdhcm5pbmcgcGFuZWwgdG8gdGhpcyBtYW55IHZpc2libGUgbGluZXMuIFVzZSAwIGZvciB1bmxpbWl0ZWQgb3V0cHV0LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCIwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID8/IDApKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUudHJpbSgpLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPj0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm91dHB1dFZpc2libGVMaW5lcyA9IE1hdGgubWluKHBhcnNlZCwgMjAwMCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1ydW4gb24gZmlsZSBvcGVuXCIpXG4gICAgICAuc2V0RGVzYyhcIlJ1biBhbGwgc3VwcG9ydGVkIGJsb2NrcyBpbiB0aGUgYWN0aXZlIG5vdGUgd2hlbiBpdCBvcGVucy4gRGlzYWJsZWQgYnkgZGVmYXVsdC5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRXh0cmFjdGVkIHNvdXJjZSBwcmV2aWV3XCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgbG9vbSBzaG93cyB0aGUgbWF0ZXJpYWxpemVkIHNvdXJjZSBmb3IgYmxvY2tzIHRoYXQgdXNlIGxvb20tZmlsZS5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvbGxhcHNlZFwiLCBcIkNvbGxhcHNlZFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJleHBhbmRlZFwiLCBcIkV4cGFuZGVkXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImhpZGRlblwiLCBcIkhpZGRlblwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgfHwgXCJjb2xsYXBzZWRcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgPSB2YWx1ZSBhcyBcImNvbGxhcHNlZFwiIHwgXCJleHBhbmRlZFwiIHwgXCJoaWRkZW5cIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiU2hvdyBjYXBhYmlsaXR5IG1ldGFkYXRhXCIpXG4gICAgICAuc2V0RGVzYyhcIlNob3cgc3ltYm9sLCBkZXBlbmRlbmN5LCBhbmQgaGFybmVzcyBjYXBhYmlsaXR5IG1ldGFkYXRhIGluIGV4dHJhY3RlZCBzb3VyY2UgcHJldmlldyBoZWFkZXJzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA/PyB0cnVlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUERGIGV4cG9ydCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB3aGF0IHRvIGluY2x1ZGUgd2hlbiBleHBvcnRpbmcgbm90ZXMgY29udGFpbmluZyBsb29tIGNvZGUgYmxvY2tzIHRvIFBERi5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImJvdGhcIiwgXCJCb3RoIENvZGUgYW5kIE91dHB1dFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2RlXCIsIFwiQ29kZSBCbG9jayBPbmx5XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm91dHB1dFwiLCBcIk91dHB1dCBPbmx5XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlIHx8IFwiYm90aFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID0gdmFsdWUgYXMgXCJib3RoXCIgfCBcImNvZGVcIiB8IFwib3V0cHV0XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJCdWlsdEluUnVudGltZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwicHl0aG9uXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlB5dGhvbiBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIFB5dGhvbi5cIiwgXCJweXRob25FeGVjdXRhYmxlXCIpO1xuICAgIH1cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJqYXZhc2NyaXB0XCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk5vZGUgZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBKYXZhU2NyaXB0IGV4ZWN1dGlvbi5cIiwgXCJub2RlRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJ0eXBlc2NyaXB0XCIpKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJUeXBlU2NyaXB0IHJ1bm5lciBtb2RlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIHRzLW5vZGUgb3IgdHN4IGZvciBUeXBlU2NyaXB0IGJsb2Nrcy5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRzLW5vZGVcIiwgXCJ0cy1ub2RlXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlR5cGVTY3JpcHQgdHJhbnNwaWxlciBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciB0cy1ub2RlIG9yIHRzeC5cIiwgXCJ0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwib2NhbWxcIikpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIk9DYW1sIG1vZGVcIilcbiAgICAgICAgLnNldERlc2MoXCJDaG9vc2UgYmV0d2VlbiB0aGUgT0NhbWwgdG9wbGV2ZWwsIG9jYW1sYyBjb21waWxhdGlvbiwgb3IgZHVuZSBleGVjLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxcIiwgXCJvY2FtbFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sY1wiLCBcIm9jYW1sY1wiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImR1bmVcIiwgXCJkdW5lXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSA9IHZhbHVlIGFzIFwib2NhbWxcIiB8IFwib2NhbWxjXCIgfCBcImR1bmVcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiT0NhbWwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3Igb2NhbWwsIG9jYW1sYywgb3IgZHVuZSBkZXBlbmRpbmcgb24gdGhlIHNlbGVjdGVkIG1vZGUuXCIsIFwib2NhbWxFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjXCJdLCBcIkMgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDIGJsb2Nrcy5cIiwgXCJjRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiY3BwXCJdLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wic2hlbGxcIl0sIFwiU2hlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU2hlbGwsIEJhc2gsIGFuZCBzaCBibG9ja3MuXCIsIFwic2hlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJydWJ5XCJdLCBcIlJ1YnkgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUnVieSBibG9ja3MuXCIsIFwicnVieUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInBlcmxcIl0sIFwiUGVybCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQZXJsIGJsb2Nrcy5cIiwgXCJwZXJsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibHVhXCJdLCBcIkx1YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBMdWEgYmxvY2tzLlwiLCBcImx1YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInBocFwiXSwgXCJQSFAgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUEhQIGJsb2Nrcy5cIiwgXCJwaHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJnb1wiXSwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJydXN0XCJdLCBcIlJ1c3QgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBSdXN0IGJsb2Nrcy5cIiwgXCJydXN0RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wiaGFza2VsbFwiXSwgXCJIYXNrZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEhhc2tlbGwgYmxvY2tzLiBEZWZhdWx0cyB0byBydW5naGMuXCIsIFwiaGFza2VsbEV4ZWN1dGFibGVcIik7XG4gICAgaWYgKHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKFwiamF2YVwiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGNvbXBpbGVyXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBvciBwYXRoIGZvciBqYXZhYy4gTGVhdmUgZW1wdHkgdG8gdXNlIEphdmEgc291cmNlLWZpbGUgbW9kZS5cIiwgXCJqYXZhQ29tcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgY29tcGlsZWQgSmF2YSBibG9ja3MuXCIsIFwiamF2YUV4ZWN1dGFibGVcIik7XG4gICAgfVxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsbHZtLWlyXCJdLCBcIkxMVk0gSVIgaW50ZXJwcmV0ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgTExWTSBJUiBibG9ja3Mgd2l0aCBsbGkuXCIsIFwibGx2bUludGVycHJldGVyRXhlY3V0YWJsZVwiKTtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJlYnBmLWNcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBjbGFuZyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjbGFuZyB3aXRoIEJQRiB0YXJnZXQgc3VwcG9ydC5cIiwgXCJlYnBmQ2xhbmdFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGJwZnRvb2wgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgYnBmdG9vbCB2ZXJpZmllciBhbmQgbG9hZCBvcGVyYXRpb25zLlwiLCBcImVicGZCcGZ0b29sRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiZUJQRiBvYmplY3QgaW5zcGVjdG9yXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBsbHZtLW9iamR1bXAuIExlYXZlIGVtcHR5IHRvIHNraXAgb2JqZWN0IHNlY3Rpb24gaW5zcGVjdGlvbi5cIiwgXCJlYnBmTGx2bU9iamR1bXBFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGluY2x1ZGUgcGF0aHNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgaW5jbHVkZSBkaXJlY3RvcmllcyBwYXNzZWQgdG8gY2xhbmcgd2l0aCAtSS5cIiwgXCJlYnBmSW5jbHVkZVBhdGhzXCIpO1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWxsb3cgZUJQRiBrZXJuZWwgbG9hZFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlcXVpcmVkIGJlZm9yZSBhbnkgYmxvY2sgY2FuIHVzZSBsb29tLWVicGYtbW9kZT1sb2FkLiBDb21waWxlLW9ubHkgbW9kZSBzdGF5cyBhdmFpbGFibGUgd2l0aG91dCB0aGlzLlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJicGZ0cmFjZVwiXSwgXCJicGZ0cmFjZSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBicGZ0cmFjZSBzY3JpcHRzLlwiLCBcImJwZnRyYWNlRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wibGVhblwiXSwgXCJMZWFuIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIExlYW4gYmxvY2tzLlwiLCBcImxlYW5FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjb3FcIl0sIFwiQ29xIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIENvcSBibG9ja3Mgd2l0aCBjb3FjLlwiLCBcImNvcUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInNtdGxpYlwiXSwgXCJTTVQgc29sdmVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTTVQtTElCIGJsb2Nrcy4gRGVmYXVsdHMgdG8gejMuXCIsIFwic210RXhlY3V0YWJsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkUnVudGltZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tUGx1Z2luU2V0dGluZ3M+KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgbGFuZ3VhZ2VJZHM6IHN0cmluZ1tdLCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIGlmIChsYW5ndWFnZUlkcy5zb21lKChsYW5ndWFnZUlkKSA9PiB0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkKSkpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIG5hbWUsIGRlc2NyaXB0aW9uLCBrZXkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpc0xhbmd1YWdlRW5hYmxlZChsYW5ndWFnZUlkLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMYW5ndWFnZVBhY2thZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbih0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuXG4gICAgZm9yIChjb25zdCBwYWNrIG9mIGdldEF2YWlsYWJsZUxhbmd1YWdlUGFja2FnZXModGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKSkge1xuICAgICAgY29uc3QgcGFja0VsID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtcGFja2FnZVwiIH0pO1xuICAgICAgcGFja0VsLm9wZW4gPSB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCk7XG4gICAgICBwYWNrRWwuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogcGFjay5kaXNwbGF5TmFtZSB9KTtcbiAgICAgIHBhY2tFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBwYWNrLmRlc2NyaXB0aW9uLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKHBhY2tFbClcbiAgICAgICAgLnNldE5hbWUoXCJFbmFibGUgcGFja2FnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRpc2FibGUgdGhpcyB0byByZW1vdmUgdGhlIHBhY2thZ2UgbGFuZ3VhZ2VzIGZyb20gcGFyc2luZywgY29tbWFuZCBtZW51cywgYW5kIHJ1bm5lcnMgZm9yIHRoaXMgdmF1bHQuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcywgcGFjay5pZCwgdmFsdWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBwYWNrLmxhbmd1YWdlcykge1xuICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBwYWNrYWdlRW5hYmxlZCA9IHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKTtcbiAgICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2YgcGFjay5sYW5ndWFnZXMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcocGFja0VsKVxuICAgICAgICAgIC5zZXROYW1lKGxhbmd1YWdlLmRpc3BsYXlOYW1lKVxuICAgICAgICAgIC5zZXREZXNjKGBBbGlhc2VzOiAke2xhbmd1YWdlLmFsaWFzZXMuam9pbihcIiwgXCIpfWApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZCghcGFja2FnZUVuYWJsZWQpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShwYWNrYWdlRW5hYmxlZCAmJiB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5pbmNsdWRlcyhsYW5ndWFnZS5pZCkpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcywgbGFuZ3VhZ2UuaWQsIHZhbHVlKTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJlbG9hZCBleHRlcm5hbCBsYW5ndWFnZSBwYWNrc1wiKVxuICAgICAgLnNldERlc2MoXCJMb2FkIEpTT04gbGFuZ3VhZ2UgcGFjayBtYW5pZmVzdHMgZnJvbSB0aGUgcGx1Z2luIGxhbmd1YWdlLXBhY2tzIGZvbGRlci5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJSZWxvYWRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLmxvYWRFeHRlcm5hbExhbmd1YWdlUGFja3ModHJ1ZSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIGxhbmd1YWdlc1wiKVxuICAgICAgLnNldERlc2MoXCJFbmFibGUgdXNlci1kZWZpbmVkIGxhbmd1YWdlcyBmcm9tIHRoZSBDdXN0b20gTGFuZ3VhZ2VzIHNlY3Rpb24uXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMoQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lELCB2YWx1ZSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUmVzZXQgbGFuZ3VhZ2UgcGFja2FnZXNcIilcbiAgICAgIC5zZXREZXNjKFwiUmUtZW5hYmxlIGV2ZXJ5IGJ1aWx0LWluIHBhY2thZ2UgYW5kIGV2ZXJ5IGJ1aWx0LWluIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIlJlc2V0XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcyA9IGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMoKTtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyA9IGdldERlZmF1bHRMYW5ndWFnZUlkcygpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRFbmFibGVkVmFsdWUodmFsdWVzOiBzdHJpbmdbXSwgaWQ6IHN0cmluZywgZW5hYmxlZDogYm9vbGVhbik6IHZvaWQge1xuICAgIGNvbnN0IGluZGV4ID0gdmFsdWVzLmluZGV4T2YoaWQpO1xuICAgIGlmIChlbmFibGVkICYmIGluZGV4IDwgMCkge1xuICAgICAgdmFsdWVzLnB1c2goaWQpO1xuICAgIH0gZWxzZSBpZiAoIWVuYWJsZWQgJiYgaW5kZXggPj0gMCkge1xuICAgICAgdmFsdWVzLnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChsaXN0RWwpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFkZCBjdXN0b20gbGFuZ3VhZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGxvY2FsIGNvbW1hbmQtYmFja2VkIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXG4gICAgICAgICAgICBhbGlhc2VzOiBcIlwiLFxuICAgICAgICAgICAgZXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLnR4dFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yTW9kZTogXCJjb21tYW5kXCIsXG4gICAgICAgICAgICBleHRyYWN0b3JFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICAgIHRyYW5zcGlsZUV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVBcmdzOiBcIntyZXF1ZXN0fVwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY3VzdG9tIGxhbmd1YWdlcyBjb25maWd1cmVkLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xuICAgICAgZGV0YWlscy5vcGVuID0gdHJ1ZTtcbiAgICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogbGFuZ3VhZ2UubmFtZSB8fCBgQ3VzdG9tIGxhbmd1YWdlICR7aW5kZXggKyAxfWAgfSk7XG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiTmFtZVwiLCBcIk5vcm1hbGl6ZWQgbGFuZ3VhZ2UgaWQgdXNlZCBieSBsb29tLlwiLCBcIm5hbWVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXhlY3V0YWJsZVwiLCBcIkxvY2FsIGNvbW1hbmQgb3IgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRoLlwiLCBcImV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQXJndW1lbnRzXCIsIFwiU3BhY2Utc2VwYXJhdGVkIGFyZ3VtZW50cy4gVXNlIHtmaWxlfSBmb3IgdGhlIHRlbXAgc291cmNlIGZpbGUuXCIsIFwiYXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJQYXJ0aWFsIGV4dHJhY3Rpb24gc3RyYXRlZ3lcIilcbiAgICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IHRoaXMgY3VzdG9tIGxhbmd1YWdlIHN1cHBvcnRzIHBhcnRpYWwgcnVubmFibGUgc291cmNlLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiY29tbWFuZFwiLCBcIkV4dHJhY3RvciBjb21tYW5kXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHJhbnNwaWxlLWNcIiwgXCJUcmFuc3BpbGUgdG8gQ1wiKVxuICAgICAgICAgICAgLnNldFZhbHVlKGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgfHwgXCJjb21tYW5kXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgPSB2YWx1ZSBhcyBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRyYWN0b3IgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgZm9yIHBhcnRpYWwgc291cmNlIGV4dHJhY3Rpb24uIExlYXZlIGVtcHR5IHRvIHVzZSBnZW5lcmljIGxpbmUgYW5kIHN5bWJvbCBleHRyYWN0aW9uLlwiLCBcImV4dHJhY3RvckV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIGV4dHJhY3Rvci4gVXNlIHtyZXF1ZXN0fSwge3NvdXJjZX0sIHtoYXJuZXNzfSwge3N5bWJvbH0sIHtsaW5lU3RhcnR9LCB7bGluZUVuZH0sIHtkZXBzfSwgYW5kIHtsYW5ndWFnZX0uXCIsIFwiZXh0cmFjdG9yQXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBleGVjdXRhYmxlXCIsIFwiT3B0aW9uYWwgY29tbWFuZCB0aGF0IGVtaXRzIGdlbmVyYXRlZCBDIGFuZCBhIHN5bWJvbCBtYXAgYXMgSlNPTi5cIiwgXCJ0cmFuc3BpbGVFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIlRyYW5zcGlsZSB0byBDIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIHRyYW5zcGlsZXIuIFVzZSB0aGUgc2FtZSBwbGFjZWhvbGRlcnMgYXMgZXh0cmFjdG9yIGFyZ3VtZW50cy5cIiwgXCJ0cmFuc3BpbGVBcmdzXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIkRlbGV0ZSBsYW5ndWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRGVsZXRlXCIpLnNldFdhcm5pbmcoKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJDb250YWluZXJHcm91cHMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMubG9vbVBsdWdpbi5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJUaGUgY29udGFpbmVyIGdyb3VwIHRvIHJ1biBjb2RlIGJsb2NrcyBpbiBieSBkZWZhdWx0IGlmIHRoZSBub3RlIGRvZXMgbm90IHNwZWNpZnkgb25lLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiXCIsIFwiTm9uZVwiKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGdyb3VwLm5hbWUsIGdyb3VwLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwIHx8IFwiXCIpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWRkIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXAgY29uZmlndXJhdGlvbiBmb2xkZXIuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICBuZXcgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwodGhpcy5hcHAsIGFzeW5jIChncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5OYW1lID0gZ3JvdXBOYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dL2csIFwiLVwiKTtcbiAgICAgICAgICAgICAgaWYgKCFjbGVhbk5hbWUpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBncm91cCBuYW1lLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBjb25zdCBncm91cFJlbGF0aXZlUGF0aCA9IGAke3BsdWdpbkRpcn0vY29udGFpbmVycy8ke2NsZWFuTmFtZX1gO1xuICAgICAgICAgICAgICBjb25zdCBjb25maWdQYXRoID0gYCR7Z3JvdXBSZWxhdGl2ZVBhdGh9L2NvbmZpZy5qc29uYDtcblxuICAgICAgICAgICAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICAgICAgICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGdyb3VwUmVsYXRpdmVQYXRoKSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgZm9sZGVyIGFscmVhZHkgZXhpc3RzLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLm1rZGlyKGdyb3VwUmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBydW50aW1lOiBcImRvY2tlclwiLFxuICAgICAgICAgICAgICAgIGltYWdlOiBcInVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBsYW5ndWFnZXM6IHtcbiAgICAgICAgICAgICAgICAgIHB5dGhvbjoge1xuICAgICAgICAgICAgICAgICAgICBjb21tYW5kOiBcInB5dGhvbjMge2ZpbGV9XCIsXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2lvbjogXCIucHlcIlxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShkZWZhdWx0Q29uZmlnLCBudWxsLCAyKSk7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoYENvbnRhaW5lciBncm91cCBcIiR7Y2xlYW5OYW1lfVwiIGNyZWF0ZWQuYCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jb250YWluZXItZ3JvdXAtbGlzdFwiIH0pO1xuICAgICAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICAgIHRleHQ6IFwiTm8gY29udGFpbmVyIGdyb3VwcyBmb3VuZCBpbiAub2JzaWRpYW4vcGx1Z2lucy9sb29tL2NvbnRhaW5lcnMuXCIsXG4gICAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBuZXcgU2V0dGluZyhsaXN0RWwpXG4gICAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhncm91cC5zdGF0dXMpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5idWlsZENvbnRhaW5lckdyb3VwKGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRWRpdFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgbmV3IEVkaXRDb250YWluZXJHcm91cE1vZGFsKHRoaXMubG9vbVBsdWdpbiwgZ3JvdXAubmFtZSwgcGx1Z2luRGlyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRXJyb3IgbG9hZGluZyBjb250YWluZXIgZ3JvdXBzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICBjbHM6IFwibG9vbS1zZXR0aW5ncy1lcnJvclwiLFxuICAgICAgICBhdHRyOiB7IHN0eWxlOiBcImNvbG9yOiB2YXIoLS10ZXh0LWVycm9yKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IG1hcmdpbjogMWVtIDA7XCIgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmVycm9yKFwibG9vbTogZmFpbGVkIHRvIHJlbmRlciBjb250YWluZXIgZ3JvdXBzOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBsYW5ndWFnZTogbG9vbUN1c3RvbUxhbmd1YWdlLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nLFxuICAgIGtleTogSyxcbiAgKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcobGFuZ3VhZ2Vba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKGxhbmd1YWdlW2tleV0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk6IHZvaWQge1xuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XG59XG5cbmNsYXNzIENvbnRhaW5lckdyb3VwTmFtZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIG5hbWUgPSBcIlwiO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TdWJtaXQ6IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk5ldyBDb250YWluZXIgR3JvdXAgTmFtZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJHcm91cCBOYW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSBsb3dlcmNhc2UgbGV0dGVycywgbnVtYmVycywgaHlwaGVucywgYW5kIHVuZGVyc2NvcmVzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5uYW1lID0gdmFsdWU7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU3VibWl0KHRoaXMubmFtZSk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIEVkaXRDb250YWluZXJHcm91cE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGFjdGl2ZVRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiID0gXCJnZW5lcmFsXCI7XG4gIHByaXZhdGUgY29uZmlnT2JqOiBhbnkgPSB7fTtcbiAgcHJpdmF0ZSByYXdKc29uVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgZG9ja2VyZmlsZVRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gIHByaXZhdGUgdGFiSGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSB0YWJDb250ZW50RWwhOiBIVE1MRWxlbWVudDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cE5hbWU6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TYXZlOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IGBFZGl0IENvbmZpZzogJHt0aGlzLmdyb3VwTmFtZX1gIH0pO1xuXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd0NvbmZpZyA9IGF3YWl0IGFkYXB0ZXIucmVhZChjb25maWdQYXRoKTtcbiAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZShyYXdDb25maWcpO1xuICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHJhd0NvbmZpZztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ291bGQgbm90IHJlYWQgY29uZmlndXJhdGlvbiBmaWxlLlwiKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGRvY2tlcmZpbGVQYXRoKSkge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gYXdhaXQgYWRhcHRlci5yZWFkKGRvY2tlcmZpbGVQYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGFpbmVyXCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIEhlYWRlclxuICAgIHRoaXMudGFiSGVhZGVyRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWhlYWRlclwiIH0pO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBDb250ZW50IEFyZWFcbiAgICB0aGlzLnRhYkNvbnRlbnRFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGVudFwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIEFjdGlvbnMgRm9vdGVyXG4gICAgY29uc3QgYWN0aW9ucyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1tb2RhbC1hY3Rpb25zXCIgfSk7XG4gICAgYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3Qgc2F2ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlNhdmVcIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcbiAgICBzYXZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVBbmRDbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlclRhYnMoKSB7XG4gICAgdGhpcy50YWJIZWFkZXJFbC5lbXB0eSgpO1xuICAgIGNvbnN0IHRhYnM6IEFycmF5PHsgaWQ6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgICAgIHsgaWQ6IFwiZ2VuZXJhbFwiLCBsYWJlbDogXCJHZW5lcmFsXCIgfSxcbiAgICAgIHsgaWQ6IFwibGFuZ3VhZ2VzXCIsIGxhYmVsOiBcIkxhbmd1YWdlc1wiIH0sXG4gICAgICB7IGlkOiBcImRvY2tlcmZpbGVcIiwgbGFiZWw6IFwiRG9ja2VyZmlsZVwiIH0sXG4gICAgICB7IGlkOiBcInJhd1wiLCBsYWJlbDogXCJSYXcgSlNPTlwiIH0sXG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgdGFiIG9mIHRhYnMpIHtcbiAgICAgIGNvbnN0IGJ0biA9IHRoaXMudGFiSGVhZGVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiB0YWIubGFiZWwsXG4gICAgICAgIGNsczogXCJsb29tLXRhYi1idG5cIiArICh0aGlzLmFjdGl2ZVRhYiA9PT0gdGFiLmlkID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKSxcbiAgICAgIH0pO1xuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5zd2l0Y2hUYWIodGFiLmlkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN3aXRjaFRhYih0YWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIikge1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHN3aXRjaGluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hY3RpdmVUYWIgPSB0YWI7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlckFjdGl2ZVRhYigpIHtcbiAgICB0aGlzLnRhYkNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJnZW5lcmFsXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyR2VuZXJhbFRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJsYW5ndWFnZXNcIikge1xuICAgICAgdGhpcy5yZW5kZXJMYW5ndWFnZXNUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZG9ja2VyZmlsZVwiKSB7XG4gICAgICB0aGlzLnJlbmRlckRvY2tlcmZpbGVUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRoaXMucmVuZGVyUmF3VGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJHZW5lcmFsVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIC8vIFJ1bnRpbWUgc2VsZWN0IGRyb3Bkb3duXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJ1bnRpbWVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHRoZSBjb250YWluZXIvZW52aXJvbm1lbnQgbWFuYWdlciBydW50aW1lLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkb2NrZXJcIiwgXCJEb2NrZXJcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicG9kbWFuXCIsIFwiUG9kbWFuXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIndzbFwiLCBcIldTTFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJxZW11XCIsIFwiUUVNVVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjdXN0b21cIiwgXCJDdXN0b21cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucnVudGltZSB8fCBcImRvY2tlclwiKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIC8vIENvbmRpdGlvbmFsIGltYWdlL2Rpc3RybyBuYW1lXG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIgPyBcIldTTCBEaXN0cm9cIiA6IFwiQmFzZSBJbWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgICAgICAgICA/IFwiT3B0aW9uYWwuIFRoZSB0YXJnZXQgV1NMIGRpc3RybyBuYW1lIChsZWF2ZSBlbXB0eSBmb3IgZGVmYXVsdCBkaXN0cm8pLlwiXG4gICAgICAgICAgICA6IFwiRmFsbGJhY2sgRG9ja2VyL1BvZG1hbiBpbWFnZSBpZiBubyBEb2NrZXJmaWxlIGlzIHByZXNlbnQuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5pbWFnZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouaW1hZ2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5jb25maWdPYmouZWxldmF0aW9uIHx8IHR5cGVvZiB0aGlzLmNvbmZpZ09iai5lbGV2YXRpb24gIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRoaXMuY29uZmlnT2JqLmVsZXZhdGlvbiA9IHsgbW9kZTogXCJkZWZhdWx0XCIgfTtcbiAgICB9XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRWxldmF0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiXG4gICAgICAgICAgPyBcIlJ1biBzbmlwcGV0cyB3aXRoIHRoZSBpbWFnZSBkZWZhdWx0IHVzZXIsIG9yIGZvcmNlIHJvb3Qgd2l0aCAtLXVzZXIgcm9vdC5cIlxuICAgICAgICAgIDogXCJLZWVwIGRlZmF1bHQgcHJpdmlsZWdlcywgb3IgbWFyayB0aGlzIGdyb3VwIGFzIGVsZXZhdGVkIGFuZCBvcHRpb25hbGx5IHByZWZpeCBjb21tYW5kcy5cIlxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkZWZhdWx0XCIsIFwiRGVmYXVsdFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJyb290XCIsIFwiUm9vdFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5lbGV2YXRpb24ubW9kZSB8fCBcImRlZmF1bHRcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5lbGV2YXRpb24ubW9kZSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWdPYmouZWxldmF0aW9uLm1vZGUgPT09IFwicm9vdFwiICYmXG4gICAgICAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIgfHwgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiKVxuICAgICkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRWxldmF0aW9uIGNvbW1hbmQgcHJlZml4XCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwgcHJlZml4IGZvciByZW1vdGUgb3Igd3JhcHBlciBjb21tYW5kcywgZm9yIGV4YW1wbGUgc3VkbyAtbi4gTG9vbSBkb2VzIG5vdCBwcm9tcHQgZm9yIHBhc3N3b3Jkcy5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJzdWRvIC1uXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouZWxldmF0aW9uLmNvbW1hbmRQcmVmaXggfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmVsZXZhdGlvbi5jb21tYW5kUHJlZml4ID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoud3NsKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLndzbCA9IHt9O1xuICAgICAgfVxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVXNlIEludGVyYWN0aXZlIFNoZWxsXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIGludGVyYWN0aXZlIGxvZ2luIHNoZWxsIGZsYWdzICgtaSAtbCkgdG8gZW5zdXJlIH4vLmJhc2hyYyBpbml0aWFsaXphdGlvbiB3b3JrcyAoZS5nLiwgZm9yIE5WTSkuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA/PyBmYWxzZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA9IHZhbDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBRRU1VIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnFlbXUpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdSA9IHsgc3NoVGFyZ2V0OiBcIlwiLCByZW1vdGVXb3Jrc3BhY2U6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIFRhcmdldFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlNTSCB0YXJnZXQgYWRkcmVzcyAoZS5nLiB1c2VyQGhvc3RuYW1lIG9yIGxvY2FsaG9zdCAtcCAyMjIyKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0ID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiUmVtb3RlIFdvcmtzcGFjZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW90ZSBmb2xkZXIgcGF0aCB0byBjb3B5IGNvZGUgc25pcHBldHMgYW5kIHJ1biBjb21tYW5kcyAoZS5nLiwgL2hvbWUvdXNlci93b3Jrc3BhY2UpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBQYXRoIHRvIFNTSCBjbGllbnQgZXhlY3V0YWJsZSAoZGVmYXVsdHMgdG8gc3NoKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBBZGRpdGlvbmFsIFNTSCBDTEkgZmxhZ3MuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgQ3VzdG9tIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmouY3VzdG9tKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbSA9IHsgZXhlY3V0YWJsZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlBhdGggdG8gY3VzdG9tIHJ1bnRpbWUgd3JhcHBlciBleGVjdXRhYmxlIG9yIHNjcmlwdC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBDb21tYW5kIGFyZ3VtZW50cy4gVXNlIHtyZXF1ZXN0fSBmb3IgSlNPTiBjb25maWcgcGF0aC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyTGFuZ3VhZ2VzVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkNvbmZpZ3VyZWQgTGFuZ3VhZ2VzXCIgfSk7XG5cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcykge1xuICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzID0ge307XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3NMaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZXMtbGlzdFwiIH0pO1xuICAgIGNvbnN0IGxhbmd1YWdlcyA9IE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB7IGNvbW1hbmQ/OiBzdHJpbmc7IGV4dGVuc2lvbj86IHN0cmluZzsgdXNlRGVmYXVsdD86IGJvb2xlYW4gfT4pO1xuXG4gICAgaWYgKGxhbmd1YWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGxhbmdzTGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiTm8gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQgZm9yIHRoaXMgZ3JvdXAuXCIsIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIiB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBbbGFuZ05hbWUsIGxhbmdDb25maWddIG9mIGxhbmd1YWdlcykge1xuICAgICAgICBjb25zdCBjYXJkID0gbGFuZ3NMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtY2FyZFwiIH0pO1xuICAgICAgICBjYXJkLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbGFuZ05hbWUsIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDAuNXJlbTsgZm9udC1zaXplOiAxLjFlbTtcIiB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGlzRGVmYXVsdCA9IChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiVXNlIGRlZmF1bHQgY29uZmlndXJhdGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiSWYgY2hlY2tlZCwgTG9vbSB3aWxsIHJ1biB0aGlzIGxhbmd1YWdlIHVzaW5nIGl0cyBidWlsdC1pbiBjb21tYW5kcy9leHRlbnNpb25zLlwiKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHZhbCkge1xuICAgICAgICAgICAgICAgICAgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmNvbW1hbmQ7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5leHRlbnNpb247XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQ7XG4gICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIjtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiQ29tbWFuZFwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiRXhlY3V0aW9uIGNvbW1hbmQuIFVzZSB7ZmlsZX0gZm9yIHRoZSBjb2RlIHNuaXBwZXQgZmlsZW5hbWUuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkV4dGVuc2lvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiU291cmNlIGZpbGUgZXh0ZW5zaW9uIChlLmcuIC5weSwgLmpzKS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgICAgYnRuXG4gICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIExhbmd1YWdlXCIpXG4gICAgICAgICAgICAgIC5zZXRXYXJuaW5nKClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbbGFuZ05hbWVdO1xuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBMYW5ndWFnZSBTZWN0aW9uXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQWRkIExhbmd1YWdlIE1hcHBpbmdcIiwgYXR0cjogeyBzdHlsZTogXCJtYXJnaW4tdG9wOiAxLjVyZW07XCIgfSB9KTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiTGFuZ3VhZ2UgSURcIilcbiAgICAgIC5zZXREZXNjKFwiZS5nLiBweXRob24sIGphdmFzY3JpcHQsIG5vZGUsIHNoXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMubmV3TGFuZ3VhZ2VOYW1lKS5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSB2YWwudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIisgQWRkXCIpLnNldEN0YSgpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5uZXdMYW5ndWFnZU5hbWUpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJQbGVhc2UgZW50ZXIgYSBsYW5ndWFnZSBuYW1lLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0pIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJMYW5ndWFnZSBhbHJlYWR5IGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdID0ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9IHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IGAuJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX1gLFxuICAgICAgICAgIH07XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICByZW5kZXJEb2NrZXJmaWxlVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcImRvY2tlclwiICYmIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwicG9kbWFuXCIpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBEb2NrZXJmaWxlIGVkaXRpbmcgaXMgb25seSBhdmFpbGFibGUgZm9yIERvY2tlciBhbmQgUG9kbWFuIHJ1bnRpbWVzLiBDdXJyZW50bHkgdXNpbmc6ICR7dGhpcy5jb25maWdPYmoucnVudGltZX1gLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCA9PT0gbnVsbCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBEb2NrZXJmaWxlIGV4aXN0cyBpbiB0aGlzIGNvbnRhaW5lciBncm91cCBkaXJlY3RvcnkuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgYnRuXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZSBEb2NrZXJmaWxlXCIpXG4gICAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IFtcbiAgICAgICAgICAgICAgICBcIkZST00gdWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgICAgXCIjIEluc3RhbGwgcGFja2FnZXNcIixcbiAgICAgICAgICAgICAgICBcIlJVTiBhcHQtZ2V0IHVwZGF0ZSAmJiBhcHQtZ2V0IGluc3RhbGwgLXkgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIHB5dGhvbjMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIG5vZGVqcyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgJiYgcm0gLXJmIC92YXIvbGliL2FwdC9saXN0cy8qXCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEb2NrZXJmaWxlIENvbnRlbnRcIilcbiAgICAgICAgLnNldERlc2MoXCJEZWZpbmUgdGhlIGJ1aWxkIHN0ZXBzIGZvciB5b3VyIGVudmlyb25tZW50IGNvbnRhaW5lci5cIilcbiAgICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmRvY2tlcmZpbGVUZXh0IHx8IFwiXCIpO1xuICAgICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IHZhbDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmF3VGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIHRoaXMucmF3SnNvblRleHQgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkNvbmZpZ3VyYXRpb24gSlNPTlwiKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMucmF3SnNvblRleHQgPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBhc3luYyBzYXZlQW5kQ2xvc2UoKSB7XG4gICAgLy8gSWYgdGhlIGFjdGl2ZSB0YWIgaXMgcmF3IEpTT04sIHBhcnNlIGl0IGZpcnN0IHRvIGVuc3VyZSB3ZSBjYXB0dXJlIGVkaXRzXG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc2F2aW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJhc2ljIFZhbGlkYXRpb25cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnJ1bnRpbWUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJSdW50aW1lIGlzIHJlcXVpcmVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmICghdGhpcy5jb25maWdPYmoucWVtdT8uc3NoVGFyZ2V0IHx8ICF0aGlzLmNvbmZpZ09iai5xZW11Py5yZW1vdGVXb3Jrc3BhY2UpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIFNTSCBUYXJnZXQgYW5kIFJlbW90ZSBXb3Jrc3BhY2UuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiAhdGhpcy5jb25maWdPYmouY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgQ3VzdG9tIEV4ZWN1dGFibGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcblxuICAgIHRyeSB7XG4gICAgICAvLyBTYXZlIGNvbmZpZy5qc29uXG4gICAgICBjb25zdCBjb25maWdTdHIgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIGNvbmZpZ1N0cik7XG5cbiAgICAgIC8vIFNhdmUgRG9ja2VyZmlsZVxuICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIikge1xuICAgICAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCAhPT0gbnVsbCkge1xuICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoZG9ja2VyZmlsZVBhdGgsIHRoaXMuZG9ja2VyZmlsZVRleHQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgY29uZmlndXJhdGlvbnMgc2F2ZWQuXCIpO1xuICAgICAgdGhpcy5vblNhdmUoKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbmV3IE5vdGljZShgU2F2ZSBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuL3V0aWxzL2NvbW1hbmRcIjtcblxuaW50ZXJmYWNlIFNvdXJjZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBTb3VyY2VEZWZpbml0aW9uIGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5hbWVzPzogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQeXRob25BbGlhcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgYXNuYW1lOiBzdHJpbmcgfCBudWxsO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uSW1wb3J0IGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBraW5kOiBcImltcG9ydFwiIHwgXCJmcm9tXCI7XG4gIG1vZHVsZTogc3RyaW5nO1xuICBsZXZlbDogbnVtYmVyO1xuICBuYW1lczogUHl0aG9uQWxpYXNbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbk1vZHVsZUluZm8ge1xuICBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdO1xuICBpbXBvcnRzOiBQeXRob25JbXBvcnRbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvblVzYWdlIHtcbiAgbmFtZXM6IHN0cmluZ1tdO1xuICBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT47XG59XG5cbmludGVyZmFjZSBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZWFkb25seSBpbmNsdWRlZFJhbmdlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGluY2x1ZGVkSW1wb3J0czogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGFsaWFzZXM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBuYW1lc3BhY2VCaW5kaW5nczogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICByZWFkb25seSB2aXNpdGluZ1N5bWJvbHM6IFNldDxzdHJpbmc+O1xuICBuZWVkc05hbWVzcGFjZVJ1bnRpbWU6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0IHtcbiAgcHl0aG9uRXhlY3V0YWJsZT86IHN0cmluZztcbiAgZXh0ZXJuYWxFeHRyYWN0b3I/OiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3I7XG4gIHJlYWRGaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuICByZXNvbHZlUHl0aG9uSW1wb3J0KGZyb21GaWxlUGF0aDogc3RyaW5nLCBtb2R1bGVOYW1lOiBzdHJpbmcsIGxldmVsOiBudW1iZXIpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvciB7XG4gIG1vZGU6IFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiO1xuICBsYW5ndWFnZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICBjb250ZW50Pzogc3RyaW5nO1xuICBzZWxlY3RlZD86IHN0cmluZztcbiAgZGVwZW5kZW5jaWVzPzogc3RyaW5nW107XG4gIGltcG9ydHM/OiBzdHJpbmdbXTtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICBnZW5lcmF0ZWRTb3VyY2U6IHN0cmluZztcbiAgc3ltYm9scz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGhhcm5lc3M/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogXCJjXCIgfCBcImNwcFwiO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb250ZW50OiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdD86IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGlmIChob3N0Py5leHRlcm5hbEV4dHJhY3Rvcj8uZXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICByZXR1cm4gaG9zdC5leHRlcm5hbEV4dHJhY3Rvci5tb2RlID09PSBcInRyYW5zcGlsZS1jXCJcbiAgICAgID8gcmVzb2x2ZVRyYW5zcGlsZVRvQ1JlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKVxuICAgICAgOiByZXNvbHZlRXh0ZXJuYWxSZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcywgaG9zdC5leHRlcm5hbEV4dHJhY3Rvcik7XG4gIH1cblxuICBpZiAobGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgaG9zdCkge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgaGFybmVzcywgaG9zdCk7XG4gIH1cblxuICByZXR1cm4gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuKTogbG9vbVJlc29sdmVkU291cmNlIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kU3ltYm9sUmFuZ2UobGluZXMsIGxhbmd1YWdlLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXMsIGxhbmd1YWdlLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZClcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLWV4dHJhY3QtXCIpKTtcbiAgY29uc3Qgc291cmNlRmlsZSA9IGpvaW4odGVtcERpciwgXCJzb3VyY2UudHh0XCIpO1xuICBjb25zdCBoYXJuZXNzRmlsZSA9IGpvaW4odGVtcERpciwgXCJoYXJuZXNzLnR4dFwiKTtcbiAgY29uc3QgcmVxdWVzdEZpbGUgPSBqb2luKHRlbXBEaXIsIFwicmVxdWVzdC5qc29uXCIpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgIH07XG4gICAgYXdhaXQgd3JpdGVGaWxlKHNvdXJjZUZpbGUsIHNvdXJjZSwgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShoYXJuZXNzRmlsZSwgaGFybmVzcywgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0RmlsZSwgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMiksIFwidXRmOFwiKTtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1bkV4dGVybmFsRXh0cmFjdG9yKGV4dHJhY3Rvciwge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICByZXF1ZXN0RmlsZSxcbiAgICAgIHJlZmVyZW5jZSxcbiAgICB9KTtcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgY29udGVudCA9IHJlc3VsdC5jb250ZW50ID8/IFtcbiAgICAgIC4uLihyZXN1bHQuaW1wb3J0cyA/PyBbXSksXG4gICAgICAuLi4ocmVzdWx0LmRlcGVuZGVuY2llcyA/PyBbXSksXG4gICAgICByZXN1bHQuc2VsZWN0ZWQgPz8gXCJcIixcbiAgICAgIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCIsXG4gICAgXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgaWYgKCFjb250ZW50LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgcmV0dXJuZWQgbm8gY29udGVudC5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBudWxsKSxcbiAgICB9O1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICB0YXJnZXRMYW5ndWFnZTogXCJjXCIsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgZ2VuZXJhdGVkTGFuZ3VhZ2UgPSByZXN1bHQubGFuZ3VhZ2UgPT09IFwiY3BwXCIgPyBcImNwcFwiIDogXCJjXCI7XG4gICAgY29uc3QgbWFwcGVkU3ltYm9sID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyByZXN1bHQuc3ltYm9scz8uW3JlZmVyZW5jZS5zeW1ib2xOYW1lXSA/PyByZWZlcmVuY2Uuc3ltYm9sTmFtZSA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBnZW5lcmF0ZWRSZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UgPSB7XG4gICAgICAuLi5yZWZlcmVuY2UsXG4gICAgICBmaWxlUGF0aDogYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpnZW5lcmF0ZWQuJHtnZW5lcmF0ZWRMYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIn1gLFxuICAgICAgc3ltYm9sTmFtZTogbWFwcGVkU3ltYm9sLFxuICAgIH07XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHJlc3VsdC5nZW5lcmF0ZWRTb3VyY2UsIGdlbmVyYXRlZFJlZmVyZW5jZSwgZ2VuZXJhdGVkTGFuZ3VhZ2UsIHJlc3VsdC5oYXJuZXNzID8/IGhhcm5lc3MpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgYCR7cmVmZXJlbmNlLmZpbGVQYXRofSMke3JlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiZ2VuZXJhdGVkLWNcIn1gLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkV4dGVybmFsRXh0cmFjdG9yKFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcixcbiAgdmFsdWVzOiB7XG4gICAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgICBzb3VyY2VGaWxlOiBzdHJpbmc7XG4gICAgaGFybmVzc0ZpbGU6IHN0cmluZztcbiAgICByZXF1ZXN0RmlsZTogc3RyaW5nO1xuICAgIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZTtcbiAgfSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGFyZ3MgPSBleHRyYWN0b3IuYXJncy5tYXAoKGFyZykgPT4gYXJnXG4gICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgdmFsdWVzLnJlcXVlc3RGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3NvdXJjZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7aGFybmVzc31cIiwgdmFsdWVzLmhhcm5lc3NGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3N5bWJvbH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZVN0YXJ0fVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA9PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZUVuZH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZGVwc31cIiwgdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyA/IFwidHJ1ZVwiIDogXCJmYWxzZVwiKVxuICAgIC5yZXBsYWNlQWxsKFwie2xhbmd1YWdlfVwiLCB2YWx1ZXMubGFuZ3VhZ2UpKTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXh0cmFjdG9yLmV4ZWN1dGFibGUsIGFyZ3MsIHtcbiAgICAgIGN3ZDogZXh0cmFjdG9yLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxuICAgIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgdGltZWQgb3V0IGFmdGVyICR7ZXh0cmFjdG9yLnRpbWVvdXRNc30gbXMuYCkpO1xuICAgIH0sIGV4dHJhY3Rvci50aW1lb3V0TXMpO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlamVjdChlcnJvcik7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXNvbHZlKHN0ZG91dCk7XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcmVxdWVzdEZpbGU6IHZhbHVlcy5yZXF1ZXN0RmlsZSxcbiAgICAgIHNvdXJjZUZpbGU6IHZhbHVlcy5zb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGU6IHZhbHVlcy5oYXJuZXNzRmlsZSxcbiAgICAgIGxhbmd1YWdlOiB2YWx1ZXMubGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogdmFsdWVzLnJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHZhbHVlcy5yZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICB9KSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dDogc3RyaW5nKTogRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdDtcbiAgICBpZiAodHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBwYXJzZWQgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgbXVzdCByZXR1cm4gYSBKU09OIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBpbnZhbGlkIEpTT046ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dDogc3RyaW5nKTogVHJhbnNwaWxlVG9DUmVzdWx0IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG91dHB1dCkgYXMgVHJhbnNwaWxlVG9DUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsIHx8IHR5cGVvZiBwYXJzZWQuZ2VuZXJhdGVkU291cmNlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgbXVzdCByZXR1cm4gZ2VuZXJhdGVkU291cmNlLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5sYW5ndWFnZSAhPSBudWxsICYmIHBhcnNlZC5sYW5ndWFnZSAhPT0gXCJjXCIgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNwcFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBsYW5ndWFnZSBtdXN0IGJlIGMgb3IgY3BwLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5zeW1ib2xzICE9IG51bGwgJiYgKHR5cGVvZiBwYXJzZWQuc3ltYm9scyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBhcnNlZC5zeW1ib2xzKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIHN5bWJvbHMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNwaWxlIHRvIEMgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbywgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBzdGF0ZSA9IGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLmZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZCwgaGFybmVzcywgaG9zdCwgc3RhdGUpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIHNlbGVjdGVkUmFuZ2UpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQeXRob25EZXBlbmRlbmN5U3RhdGUoKTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBpbmNsdWRlZFJhbmdlczogbmV3IFNldCgpLFxuICAgIGluY2x1ZGVkSW1wb3J0czogbmV3IFNldCgpLFxuICAgIGFsaWFzZXM6IG5ldyBTZXQoKSxcbiAgICBuYW1lc3BhY2VCaW5kaW5nczogbmV3IE1hcCgpLFxuICAgIHZpc2l0aW5nU3ltYm9sczogbmV3IFNldCgpLFxuICAgIG5lZWRzTmFtZXNwYWNlUnVudGltZTogZmFsc2UsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsXG4gIHNlbGVjdGVkOiBzdHJpbmcsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgc2VsZWN0ZWRSYW5nZSwgYCR7c2VsZWN0ZWR9XFxuJHtoYXJuZXNzfWAsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gIGNvbnN0IG5hbWVzcGFjZSA9IHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlKTtcbiAgcmV0dXJuIFsuLi5zdGF0ZS5pbmNsdWRlZEltcG9ydHMsIC4uLnBhcnRzLCBuYW1lc3BhY2VdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VlZDogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjb2xsZWN0ZWQgPSBcIlwiO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgY29uc3QgdXNhZ2UgPSBhd2FpdCBpbnNwZWN0UHl0aG9uVXNhZ2UoaGF5c3RhY2ssIGhvc3QpO1xuXG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIG1vZHVsZUluZm8uZGVmaW5pdGlvbnMpIHtcbiAgICAgIGlmIChyYW5nZXNPdmVybGFwKGRlZmluaXRpb24sIHNlbGVjdGVkUmFuZ2UpIHx8ICFweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb24sIHVzYWdlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRleHQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBjb25zdCBuZXN0ZWQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICAgIGhheXN0YWNrICs9IGBcXG4ke3RleHR9XFxuYDtcbiAgICAgICAgaWYgKG5lc3RlZCkge1xuICAgICAgICAgIGhheXN0YWNrICs9IGBcXG4ke25lc3RlZH1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHtuZXN0ZWR9XFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgaW1wb3J0Tm9kZSBvZiBtb2R1bGVJbmZvLmltcG9ydHMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBjb2xsZWN0ZWQgKz0gYCR7dGV4dH1cXG5gO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gY29sbGVjdGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAoaW1wb3J0Tm9kZS5raW5kID09PSBcImZyb21cIikge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uRnJvbUltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUHl0aG9uUGxhaW5JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsb2NhbE1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGltcG9ydE5vZGUubW9kdWxlLCBpbXBvcnROb2RlLmxldmVsKTtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBpZiAoYWxpYXMubmFtZSA9PT0gXCIqXCIpIHtcbiAgICAgIGlmICghbG9jYWxNb2R1bGVQYXRoKSB7XG4gICAgICAgIGlmICh1c2VzVW5rbm93bkltcG9ydGVkTmFtZXModXNhZ2UpICYmIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCBob3N0LnJlYWRGaWxlKGxvY2FsTW9kdWxlUGF0aCk7XG4gICAgICBpZiAoIXNvdXJjZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgICBpZiAoIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgZGVmaW5pdGlvbi5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXhwb3NlZE5hbWUgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBpZiAoIXVzYWdlLm5hbWVzLmluY2x1ZGVzKGV4cG9zZWROYW1lKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VibW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgam9pblB5dGhvbk1vZHVsZShpbXBvcnROb2RlLm1vZHVsZSwgYWxpYXMubmFtZSksIGltcG9ydE5vZGUubGV2ZWwpO1xuICAgIGNvbnN0IGltcG9ydFRhcmdldFBhdGggPSBsb2NhbE1vZHVsZVBhdGggPz8gc3VibW9kdWxlUGF0aDtcbiAgICBpZiAoIWltcG9ydFRhcmdldFBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0ZWQgPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoaW1wb3J0VGFyZ2V0UGF0aCwgYWxpYXMubmFtZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICBhZGRlZCArPSBleHRyYWN0ZWQ7XG4gICAgICBpZiAoYWxpYXMuYXNuYW1lICYmIGFsaWFzLmFzbmFtZSAhPT0gYWxpYXMubmFtZSkge1xuICAgICAgICBhZGRlZCArPSBhZGRQeXRob25BbGlhcyhhbGlhcy5uYW1lLCBhbGlhcy5hc25hbWUsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2R1bGVCaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWU7XG4gICAgY29uc3QgbW9kdWxlQXR0cmlidXRlcyA9IHVzYWdlLmF0dHJpYnV0ZXNbbW9kdWxlQmluZGluZ10gPz8gW107XG4gICAgaWYgKHN1Ym1vZHVsZVBhdGggJiYgbW9kdWxlQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG1vZHVsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKHN1Ym1vZHVsZVBhdGgsIGF0dHJpYnV0ZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhtb2R1bGVCaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBjb25zdCBiaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWUuc3BsaXQoXCIuXCIpWzBdO1xuICAgIGNvbnN0IHVzZWRBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1tiaW5kaW5nXSA/PyBbXTtcbiAgICBjb25zdCBiaW5kaW5nSXNVc2VkID0gdXNhZ2UubmFtZXMuaW5jbHVkZXMoYmluZGluZykgfHwgdXNlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMDtcbiAgICBpZiAoIWJpbmRpbmdJc1VzZWQpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgYWxpYXMubmFtZSwgMCk7XG4gICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiB1c2VkQXR0cmlidXRlcykge1xuICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhiaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc3ltYm9sTmFtZTogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHZpc2l0S2V5ID0gYCR7ZmlsZVBhdGh9IyR7c3ltYm9sTmFtZX1gO1xuICBpZiAoc3RhdGUudmlzaXRpbmdTeW1ib2xzLmhhcyh2aXNpdEtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUoZmlsZVBhdGgpO1xuICBpZiAoIXNvdXJjZSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmFkZCh2aXNpdEtleSk7XG4gIHRyeSB7XG4gICAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGNhbmRpZGF0ZSkgPT4gKGNhbmRpZGF0ZS5uYW1lcyA/PyBbY2FuZGlkYXRlLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gICAgaWYgKCFkZWZpbml0aW9uKSB7XG4gICAgICByZXR1cm4gXCJcIjtcbiAgICB9XG5cbiAgICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pO1xuICAgIGNvbnN0IGRlcGVuZGVuY3lUZXh0ID0gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCB0ZXh0LCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGNvbnN0IGFkZGVkID0gYWRkUHl0aG9uUmFuZ2UobGluZXMsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCBzdGF0ZSwgcGFydHMpO1xuICAgIHJldHVybiBbZGVwZW5kZW5jeVRleHQsIGFkZGVkXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXCIpO1xuICB9IGZpbmFsbHkge1xuICAgIHN0YXRlLnZpc2l0aW5nU3ltYm9scy5kZWxldGUodmlzaXRLZXkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvblJhbmdlKFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7ZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRSYW5nZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZFJhbmdlcy5hZGQoa2V5KTtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgcmFuZ2UpO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRJbXBvcnRzLmhhcyh0ZXh0KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZEltcG9ydHMuYWRkKHRleHQpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uQWxpYXMobmFtZTogc3RyaW5nLCBhc25hbWU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSwgcGFydHM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7YXNuYW1lfT0ke25hbWV9YDtcbiAgaWYgKHN0YXRlLmFsaWFzZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5hbGlhc2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gYCR7YXNuYW1lfSA9ICR7bmFtZX1gO1xuICBwYXJ0cy5wdXNoKHRleHQpO1xuICByZXR1cm4gYCR7dGV4dH1cXG5gO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmc6IHN0cmluZywgYXR0cmlidXRlOiBzdHJpbmcsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiB2b2lkIHtcbiAgc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID0gdHJ1ZTtcbiAgY29uc3QgYXR0cmlidXRlcyA9IHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLmdldChiaW5kaW5nKSA/PyBuZXcgU2V0PHN0cmluZz4oKTtcbiAgYXR0cmlidXRlcy5hZGQoYXR0cmlidXRlKTtcbiAgc3RhdGUubmFtZXNwYWNlQmluZGluZ3Muc2V0KGJpbmRpbmcsIGF0dHJpYnV0ZXMpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQeXRob25OYW1lc3BhY2VCaW5kaW5ncyhzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogc3RyaW5nIHtcbiAgaWYgKCFzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zaXplKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IHN0YXRlLm5lZWRzTmFtZXNwYWNlUnVudGltZSA/IFtcImltcG9ydCB0eXBlcyBhcyBfbG9vbV90eXBlc1wiXSA6IFtdO1xuICBmb3IgKGNvbnN0IFtiaW5kaW5nLCBhdHRyaWJ1dGVzXSBvZiBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncykge1xuICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30gPSBfbG9vbV90eXBlcy5TaW1wbGVOYW1lc3BhY2UoKWApO1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30uJHthdHRyaWJ1dGV9ID0gJHthdHRyaWJ1dGV9YCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbzogUHl0aG9uTW9kdWxlSW5mbywgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZXhhY3QgPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGRlZmluaXRpb24pID0+IChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gIHJldHVybiBleGFjdCA/IHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9IDogbnVsbDtcbn1cblxuZnVuY3Rpb24gcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uLCB1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5zb21lKChuYW1lKSA9PiB1c2FnZS5uYW1lcy5pbmNsdWRlcyhuYW1lKSk7XG59XG5cbmZ1bmN0aW9uIHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIHVzYWdlLm5hbWVzLmxlbmd0aCA+IDA7XG59XG5cbmZ1bmN0aW9uIGpvaW5QeXRob25Nb2R1bGUobW9kdWxlTmFtZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbW9kdWxlTmFtZSA/IGAke21vZHVsZU5hbWV9LiR7bmFtZX1gIDogbmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2U6IHN0cmluZywgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxQeXRob25Nb2R1bGVJbmZvPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uTW9kdWxlSW5mbz4oc291cmNlLCBcIm1vZHVsZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvblVzYWdlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvblVzYWdlPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uVXNhZ2U+KHNvdXJjZSwgXCJ1c2FnZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuUHl0aG9uQXN0PFQ+KHNvdXJjZTogc3RyaW5nLCBtb2RlOiBcIm1vZHVsZVwiIHwgXCJ1c2FnZVwiLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUoaG9zdC5weXRob25FeGVjdXRhYmxlPy50cmltKCkgfHwgXCJweXRob24zXCIpO1xuICBjb25zdCBleGVjdXRhYmxlID0gY29tbWFuZFswXSA/PyBcInB5dGhvbjNcIjtcbiAgY29uc3QgYXJncyA9IFsuLi5jb21tYW5kLnNsaWNlKDEpLCBcIi1jXCIsIFBZVEhPTl9BU1RfSEVMUEVSXTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywgeyBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoKHN0ZGVyciB8fCBzdGRvdXQgfHwgYFB5dGhvbiBBU1QgaGVscGVyIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfS5gKS50cmltKCkpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzb2x2ZShKU09OLnBhcnNlKHN0ZG91dCkgYXMgVCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY2hpbGQuc3RkaW4uZW5kKEpTT04uc3RyaW5naWZ5KHsgbW9kZSwgc291cmNlIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRMaW5lUmFuZ2UobGluZXM6IHN0cmluZ1tdLCByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IE1hdGgubWF4KChyZWZlcmVuY2UubGluZVN0YXJ0ID8/IDEpIC0gMSwgMCk7XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKChyZWZlcmVuY2UubGluZUVuZCA/PyByZWZlcmVuY2UubGluZVN0YXJ0ID8/IGxpbmVzLmxlbmd0aCkgLSAxLCBsaW5lcy5sZW5ndGggLSAxKTtcbiAgaWYgKHN0YXJ0ID4gZW5kIHx8IHN0YXJ0ID49IGxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gZmluZFN5bWJvbFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHN5bWJvbE5hbWU6IHN0cmluZyk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSk7XG4gIGNvbnN0IGV4YWN0ID0gZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgaWYgKGV4YWN0KSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sUGF0dGVybiA9IG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChzeW1ib2xOYW1lKX1cXFxcYmApO1xuICBjb25zdCBsaW5lID0gbGluZXMuZmluZEluZGV4KChjYW5kaWRhdGUpID0+IHN5bWJvbFBhdHRlcm4udGVzdChjYW5kaWRhdGUpKTtcbiAgaWYgKGxpbmUgPCAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIGxpbmVzW2xpbmVdLmluY2x1ZGVzKFwie1wiKSA/IHsgc3RhcnQ6IGxpbmUsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGxpbmUpIH0gOiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsIHNlbGVjdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwcm9sb2d1ZSA9IGNvbGxlY3RQcm9sb2d1ZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2Uuc3RhcnQpO1xuICBjb25zdCBkZWZpbml0aW9ucyA9IGNvbGxlY3REZWZpbml0aW9ucyhsaW5lcywgbGFuZ3VhZ2UpXG4gICAgLmZpbHRlcigoZGVmaW5pdGlvbikgPT4gIXJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkpO1xuICBjb25zdCBzZWxlY3RlZERlZmluaXRpb25zID0gdHJhY2VEZWZpbml0aW9ucyhzZWxlY3RlZCwgZGVmaW5pdGlvbnMsIGxpbmVzKTtcbiAgcmV0dXJuIFsuLi5wcm9sb2d1ZSwgLi4uc2VsZWN0ZWREZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHJlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKSldXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmZ1bmN0aW9uIHRyYWNlRGVmaW5pdGlvbnMoc2VlZDogc3RyaW5nLCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdLCBsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBzZWxlY3RlZDogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGNvbnN0IHNlbGVjdGVkS2V5cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIGRlZmluaXRpb25zKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtkZWZpbml0aW9uLnN0YXJ0fToke2RlZmluaXRpb24uZW5kfToke2RlZmluaXRpb24ubmFtZX1gO1xuICAgICAgaWYgKHNlbGVjdGVkS2V5cy5oYXMoa2V5KSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLnNvbWUoKG5hbWUpID0+IHNvdXJjZVVzZXNOYW1lKGhheXN0YWNrLCBuYW1lKSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzZWxlY3RlZEtleXMuYWRkKGtleSk7XG4gICAgICBzZWxlY3RlZC5wdXNoKGRlZmluaXRpb24pO1xuICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7cmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pfVxcbmA7XG4gICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc2VsZWN0ZWQuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc3RhcnQgLSByaWdodC5zdGFydCk7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQcm9sb2d1ZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBiZWZvcmVMaW5lOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHByb2xvZ3VlOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBtYXggPSBNYXRoLm1heChiZWZvcmVMaW5lLCAwKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1heDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGlzUHJvbG9ndWVMaW5lKGxpbmUsIGxhbmd1YWdlKSkge1xuICAgICAgcHJvbG9ndWUucHVzaChsaW5lKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHByb2xvZ3VlLmxlbmd0aCA/IFtwcm9sb2d1ZS5qb2luKFwiXFxuXCIpXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBpc1Byb2xvZ3VlTGluZShsaW5lOiBzdHJpbmcsIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gL14oZnJvbVxccytcXFMrXFxzK2ltcG9ydFxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIC9eKGltcG9ydFxccyt8ZXhwb3J0XFxzKy4qXFxzK2Zyb21cXHMrfCg/OmNvbnN0fGxldHx2YXIpXFxzK1xcdytcXHMqPVxccypyZXF1aXJlXFxzKlxcKCkvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImNcIjpcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInRhcmdldCBcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwic291cmNlX2ZpbGVuYW1lXCIpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gL14obW9kdWxlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiAvXihvcGVuXFxzK3xpbmNsdWRlXFxzK3wjdXNlXFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiAvXihwYWNrYWdlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3REZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL14oPzpleHBvcnRcXHMrKT8oPzphc3luY1xccyspP2Z1bmN0aW9uXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspP2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspPyg/OmNvbnN0fGxldHx2YXIpXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMqPS8pO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lcywgZmFsc2UpO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCB0cnVlKTtcbiAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RPY2FtbERlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfGFic3RyYWN0fFxccykqXFxzKig/OmNsYXNzfGludGVyZmFjZXxlbnVtfHJlY29yZClcXHMrKFtBLVphLXpfXVxcdyopXFxifF5cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxzeW5jaHJvbml6ZWR8bmF0aXZlfFxccykrW1xcdzw+XFxbXFxdLC4/XStcXHMrKFtBLVphLXpfXVxcdyopXFxzKlxcKFteO10qXFwpXFxzKlxcey8pO1xuICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICByZXR1cm4gY29sbGVjdExsdm1EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgYXNzaWdubWVudCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihbQS1aYS16X11cXHcqKVxccypbOj1dLyk7XG4gICAgaWYgKGFzc2lnbm1lbnQpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBhc3NpZ25tZW50WzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihcXHMqKSg/OmFzeW5jXFxzKyk/KD86ZGVmfGNsYXNzKVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5kZW50ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICAgIGxldCBzdGFydCA9IGluZGV4O1xuICAgIHdoaWxlIChzdGFydCA+IDAgJiYgbGluZXNbc3RhcnQgLSAxXS50cmltKCkuc3RhcnRzV2l0aChcIkBcIikgJiYgZ2V0SW5kZW50KGxpbmVzW3N0YXJ0IC0gMV0pID09PSBpbmRlbnQpIHtcbiAgICAgIHN0YXJ0IC09IDE7XG4gICAgfVxuICAgIGxldCBlbmQgPSBpbmRleDtcbiAgICBmb3IgKGxldCBjdXJzb3IgPSBpbmRleCArIDE7IGN1cnNvciA8IGxpbmVzLmxlbmd0aDsgY3Vyc29yICs9IDEpIHtcbiAgICAgIGlmIChsaW5lc1tjdXJzb3JdLnRyaW0oKSAmJiBnZXRJbmRlbnQobGluZXNbY3Vyc29yXSkgPD0gaW5kZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZW5kID0gY3Vyc29yO1xuICAgIH1cbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWF0Y2hbMl0sIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgaXNDcHA6IGJvb2xlYW4pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGxldCBkZXB0aCA9IDA7XG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGNvbnN0IHRvcExldmVsID0gZGVwdGggPT09IDA7XG5cbiAgICBpZiAodG9wTGV2ZWwgJiYgdHJpbW1lZCkge1xuICAgICAgY29uc3QgbWFjcm8gPSB0cmltbWVkLm1hdGNoKC9eI1xccypkZWZpbmVcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgICBpZiAobWFjcm8pIHtcbiAgICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hY3JvWzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICB9IGVsc2UgaWYgKCF0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpICYmICFpc0NDb21tZW50TGluZSh0cmltbWVkKSkge1xuICAgICAgICBjb25zdCB0eXBlRGVmaW5pdGlvbiA9IG1hdGNoQ1R5cGVEZWZpbml0aW9uKGxpbmVzLCBpbmRleCwgaXNDcHApO1xuICAgICAgICBpZiAodHlwZURlZmluaXRpb24pIHtcbiAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHR5cGVEZWZpbml0aW9uKTtcbiAgICAgICAgICBpbmRleCA9IE1hdGgubWF4KGluZGV4LCB0eXBlRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uRGVmaW5pdGlvbiA9IG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lcywgaW5kZXgpO1xuICAgICAgICAgIGlmIChmdW5jdGlvbkRlZmluaXRpb24pIHtcbiAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZnVuY3Rpb25EZWZpbml0aW9uKTtcbiAgICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIGZ1bmN0aW9uRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBnbG9iYWxEZWZpbml0aW9uID0gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lLCBpbmRleCk7XG4gICAgICAgICAgICBpZiAoZ2xvYmFsRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKGdsb2JhbERlZmluaXRpb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGRlcHRoICs9IGJyYWNlRGVsdGEobGluZSk7XG4gICAgaWYgKGRlcHRoIDwgMCkge1xuICAgICAgZGVwdGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgaGVhZGVyID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyA4KSkuam9pbihcIiBcIik7XG4gIGNvbnN0IGtleXdvcmRQYXR0ZXJuID0gaXNDcHAgPyBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxjbGFzc3xlbnVtfHVuaW9uKVwiIDogXCIoPzp0eXBlZGVmXFxcXHMrKT8oPzpzdHJ1Y3R8ZW51bXx1bmlvbilcIjtcbiAgY29uc3QgbmFtZWQgPSBoZWFkZXIubWF0Y2gobmV3IFJlZ0V4cChgXlxcXFxzKiR7a2V5d29yZFBhdHRlcm59XFxcXHMrKFtBLVphLXpfXVxcXFx3KilcXFxcYmApKTtcbiAgY29uc3QgYW5vbnltb3VzVHlwZWRlZiA9IGhlYWRlci5tYXRjaCgvXlxccyp0eXBlZGVmXFxzKyg/OnN0cnVjdHxlbnVtfHVuaW9uKVxcYltcXHNcXFNdKj9cXH1cXHMqKFtBLVphLXpfXVxcdyopXFxzKjsvKTtcbiAgY29uc3QgbmFtZSA9IG5hbWVkPy5bMV0gPz8gYW5vbnltb3VzVHlwZWRlZj8uWzFdO1xuICBpZiAoIW5hbWUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGVuZCA9IGZpbmRDRGVjbGFyYXRpb25FbmQobGluZXMsIHN0YXJ0KTtcbiAgcmV0dXJuIHsgbmFtZSwgbmFtZXM6IFtuYW1lXSwgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaENGdW5jdGlvbkRlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXJMaW5lcyA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIHN0YXJ0ICsgMTIpKTtcbiAgY29uc3Qgam9pbmVkID0gaGVhZGVyTGluZXMuam9pbihcIiBcIik7XG4gIGNvbnN0IGJyYWNlT2Zmc2V0ID0gaGVhZGVyTGluZXMuZmluZEluZGV4KChsaW5lKSA9PiBsaW5lLmluY2x1ZGVzKFwie1wiKSk7XG4gIGlmIChicmFjZU9mZnNldCA8IDAgfHwgam9pbmVkLmluZGV4T2YoXCI7XCIpID49IDAgJiYgam9pbmVkLmluZGV4T2YoXCI7XCIpIDwgam9pbmVkLmluZGV4T2YoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBtYXRjaGVzID0gWy4uLmpvaW5lZC5tYXRjaEFsbCgvKFtBLVphLXpfXVxcdyooPzo6OltBLVphLXpfXVxcdyopP3xvcGVyYXRvclxccypbXlxccyhdKylcXHMqXFwoW147e31dKlxcKVxccyooPzpjb25zdFxcYltee31dKik/KD86bm9leGNlcHRcXGJbXnt9XSopPyg/Oi0+XFxzKltee31dKyk/XFx7L2cpXTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoZXNbMF0/LlsxXT8ucmVwbGFjZSgvXFxzKy9nLCBcIlwiKTtcbiAgaWYgKCFuYW1lIHx8IGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBicmFjZUxpbmUgPSBzdGFydCArIGJyYWNlT2Zmc2V0O1xuICBjb25zdCBzaG9ydE5hbWUgPSBuYW1lLmluY2x1ZGVzKFwiOjpcIikgPyBuYW1lLnNwbGl0KFwiOjpcIikucG9wKCkgPz8gbmFtZSA6IG5hbWU7XG4gIHJldHVybiB7XG4gICAgbmFtZTogc2hvcnROYW1lLFxuICAgIG5hbWVzOiBbLi4ubmV3IFNldChbc2hvcnROYW1lLCBuYW1lXSldLFxuICAgIHN0YXJ0LFxuICAgIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGJyYWNlTGluZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0dsb2JhbERlZmluaXRpb24obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZC5lbmRzV2l0aChcIjtcIikgfHwgdHJpbW1lZC5pbmNsdWRlcyhcIihcIikgfHwgL14ocmV0dXJufHVzaW5nfG5hbWVzcGFjZXx0ZW1wbGF0ZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHdpdGhvdXRJbml0aWFsaXplciA9IHRyaW1tZWQuc3BsaXQoXCI9XCIpWzBdLnJlcGxhY2UoL1xcW1teXFxdXSpdL2csIFwiXCIpO1xuICBjb25zdCBtYXRjaCA9IHdpdGhvdXRJbml0aWFsaXplci5tYXRjaCgvKFtBLVphLXpfXVxcdyopXFxzKig/OlssO118JCkvZyk/LnBvcCgpPy5tYXRjaCgvKFtBLVphLXpfXVxcdyopLyk7XG4gIGNvbnN0IG5hbWUgPSBtYXRjaD8uWzFdO1xuICBpZiAoIW5hbWUgfHwgL14oY29uc3R8c3RhdGljfGV4dGVybnx2b2xhdGlsZXx1bnNpZ25lZHxzaWduZWR8bG9uZ3xzaG9ydHxpbnR8Y2hhcnxmbG9hdHxkb3VibGV8dm9pZHxhdXRvKSQvLnRlc3QobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3Qgc3ltYm9sID0gbGluZS5tYXRjaCgvXlxccyooPzpkZWZpbmV8ZGVjbGFyZSlcXGIuKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqXFwoLyk7XG4gICAgaWYgKHN5bWJvbCkge1xuICAgICAgY29uc3QgZW5kID0gbGluZS50cmltU3RhcnQoKS5zdGFydHNXaXRoKFwiZGVmaW5lXCIpID8gZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSA6IGluZGV4O1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IHN5bWJvbFsxXSwgbmFtZXM6IFtzeW1ib2xbMV0sIGBAJHtzeW1ib2xbMV19YF0sIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZ2xvYmFsID0gbGluZS5tYXRjaCgvXlxccypAKFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSopXFxzKj0vKTtcbiAgICBpZiAoZ2xvYmFsKSB7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogZ2xvYmFsWzFdLCBuYW1lczogW2dsb2JhbFsxXSwgYEAke2dsb2JhbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihtb2R1bGV8aW1wb3J0KVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQpO1xuICAgIGlmICghbmFtZXMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlbmQgPSBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgbmFtZXNbMF0pO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihvcGVufGluY2x1ZGV8I3VzZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVzID0gZ2V0T2NhbWxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lcywgaW5kZXgsIGlzT2NhbWxUb3BMZXZlbFN0YXJ0KTtcbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbmFtZXNbMF0sIG5hbWVzLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICBpbmRleCA9IGVuZDtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgcGF0dGVybjogUmVnRXhwKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2gocGF0dGVybik7XG4gICAgY29uc3QgbmFtZSA9IG1hdGNoPy5zbGljZSgxKS5maW5kKEJvb2xlYW4pO1xuICAgIGlmICghbmFtZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lLCBzdGFydDogaW5kZXgsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghbGluZXNbc3RhcnRdLmluY2x1ZGVzKFwie1wiKSkge1xuICAgIHJldHVybiBzdGFydDtcbiAgfVxuXG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzYXdCcmFjZSAmJiBkZXB0aCA8PSAwKSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdGFydDtcbn1cblxuZnVuY3Rpb24gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgc2F3QnJhY2UgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZXNbaW5kZXhdKSB7XG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgc2F3QnJhY2UgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICgoIXNhd0JyYWNlIHx8IGRlcHRoIDw9IDApICYmIGxpbmVzW2luZGV4XS5pbmNsdWRlcyhcIjtcIikpIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBicmFjZURlbHRhKGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBkZWx0YSA9IDA7XG4gIGZvciAoY29uc3QgY2hhciBvZiBsaW5lKSB7XG4gICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICBkZWx0YSArPSAxO1xuICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgIGRlbHRhIC09IDE7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWx0YTtcbn1cblxuZnVuY3Rpb24gaXNDQ29tbWVudExpbmUodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvL1wiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvKlwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIqXCIpO1xufVxuXG5mdW5jdGlvbiBpc0NDb250cm9sS2V5d29yZChuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIFtcImlmXCIsIFwiZm9yXCIsIFwid2hpbGVcIiwgXCJzd2l0Y2hcIiwgXCJjYXRjaFwiXS5pbmNsdWRlcyhuYW1lKTtcbn1cblxuZnVuY3Rpb24gZ2V0SGFza2VsbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXHMqOjovKTtcbiAgaWYgKHNpZ25hdHVyZSkge1xuICAgIHJldHVybiBbc2lnbmF0dXJlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9eKFthLXpfXVtcXHcnXSopXFxiLio9Lyk7XG4gIGlmIChiaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtiaW5kaW5nWzFdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVMaWtlID0gdHJpbW1lZC5tYXRjaCgvXig/OmRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzKVxccysoW0EtWl1bXFx3J10qKVxcYi8pO1xuICBpZiAodHlwZUxpa2UpIHtcbiAgICByZXR1cm4gW3R5cGVMaWtlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGluc3RhbmNlID0gdHJpbW1lZC5tYXRjaCgvXmluc3RhbmNlXFxiLio/XFxiKFtBLVpdW1xcdyddKilcXGIvKTtcbiAgcmV0dXJuIGluc3RhbmNlID8gW2luc3RhbmNlWzFdXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxldEJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9ebGV0XFxzKyg/OnJlY1xccyspPyg/OlxcKChbXildKylcXCl8KFthLXpfXVtcXHcnXSopKS8pO1xuICBpZiAobGV0QmluZGluZykge1xuICAgIHJldHVybiBbbGV0QmluZGluZ1sxXSA/PyBsZXRCaW5kaW5nWzJdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXnR5cGVcXHMrKFthLXpfXVtcXHcnXSopLyk7XG4gIGlmICh0eXBlQmluZGluZykge1xuICAgIHJldHVybiBbdHlwZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgbW9kdWxlQmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15tb2R1bGVcXHMrKFtBLVpdW1xcdyddKikvKTtcbiAgaWYgKG1vZHVsZUJpbmRpbmcpIHtcbiAgICByZXR1cm4gW21vZHVsZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBmaW5kTGF5b3V0UmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc1RvcExldmVsU3RhcnQ6IChsaW5lOiBzdHJpbmcpID0+IGJvb2xlYW4pOiBudW1iZXIge1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGxpbmUudHJpbSgpICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc1RvcExldmVsU3RhcnQobGluZS50cmltKCkpKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZW5kID0gaW5kZXg7XG4gIH1cbiAgcmV0dXJuIGVuZDtcbn1cblxuZnVuY3Rpb24gZmluZEhhc2tlbGxSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgbGV0IGFsbG93TWF0Y2hpbmdFcXVhdGlvbiA9IGxpbmVzW3N0YXJ0XS50cmltKCkuc3RhcnRzV2l0aChgJHtuYW1lfSA6OmApO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0ICsgMTsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZCAmJiBnZXRJbmRlbnQobGluZSkgPT09IDAgJiYgaXNIYXNrZWxsVG9wTGV2ZWxTdGFydCh0cmltbWVkKSkge1xuICAgICAgaWYgKGFsbG93TWF0Y2hpbmdFcXVhdGlvbiAmJiB0cmltbWVkLnN0YXJ0c1dpdGgoYCR7bmFtZX0gYCkgJiYgdHJpbW1lZC5pbmNsdWRlcyhcIj1cIikpIHtcbiAgICAgICAgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gZmFsc2U7XG4gICAgICAgIGVuZCA9IGluZGV4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL14obW9kdWxlfGltcG9ydHxkYXRhfG5ld3R5cGV8dHlwZXxjbGFzc3xpbnN0YW5jZSlcXGIvLnRlc3QodHJpbW1lZClcbiAgICB8fCAvXlthLXpfXVtcXHcnXSpcXHMqKD86Ojp8Lio9KS8udGVzdCh0cmltbWVkKTtcbn1cblxuZnVuY3Rpb24gaXNPY2FtbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihvcGVufGluY2x1ZGV8I3VzZXxsZXR8dHlwZXxtb2R1bGUpXFxiLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJSYW5nZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSk6IHN0cmluZyB7XG4gIHJldHVybiBsaW5lcy5zbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kICsgMSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gcmFuZ2VzT3ZlcmxhcChsZWZ0OiBTb3VyY2VSYW5nZSwgcmlnaHQ6IFNvdXJjZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBsZWZ0LnN0YXJ0IDw9IHJpZ2h0LmVuZCAmJiByaWdodC5zdGFydCA8PSBsZWZ0LmVuZDtcbn1cblxuZnVuY3Rpb24gZ2V0SW5kZW50KGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBsaW5lLm1hdGNoKC9eXFxzKi8pPy5bMF0ubGVuZ3RoID8/IDA7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ2V4KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xufVxuXG5mdW5jdGlvbiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbjogU291cmNlRGVmaW5pdGlvbik6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGRlZmluaXRpb24ubmFtZXM/Lmxlbmd0aCA/IGRlZmluaXRpb24ubmFtZXMgOiBbZGVmaW5pdGlvbi5uYW1lXTtcbn1cblxuZnVuY3Rpb24gc291cmNlVXNlc05hbWUoc291cmNlOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAobmFtZS5zdGFydHNXaXRoKFwiQFwiKSkge1xuICAgIHJldHVybiBuZXcgUmVnRXhwKGAke2VzY2FwZVJlZ2V4KG5hbWUpfVxcXFxiYCkudGVzdChzb3VyY2UpO1xuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBcXFxcYiR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSwgcmFuZ2U6IFNvdXJjZVJhbmdlIHwgbnVsbCk6IHN0cmluZyB7XG4gIGlmIChyZWZlcmVuY2Uuc3ltYm9sTmFtZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YDtcbiAgfVxuICBpZiAocmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpMJHtyYW5nZS5zdGFydCArIDF9LUwke3JhbmdlLmVuZCArIDF9YDtcbiAgfVxuICByZXR1cm4gcmVmZXJlbmNlLmZpbGVQYXRoO1xufVxuXG5jb25zdCBQWVRIT05fQVNUX0hFTFBFUiA9IFN0cmluZy5yYXdgXG5pbXBvcnQgYXN0XG5pbXBvcnQganNvblxuaW1wb3J0IHN5c1xuXG5wYXlsb2FkID0ganNvbi5sb2FkcyhzeXMuc3RkaW4ucmVhZCgpKVxuc291cmNlID0gcGF5bG9hZC5nZXQoXCJzb3VyY2VcIiwgXCJcIilcbm1vZGUgPSBwYXlsb2FkLmdldChcIm1vZGVcIiwgXCJtb2R1bGVcIilcblxuZGVmIHJhbmdlX3N0YXJ0KG5vZGUpOlxuICAgIGxpbmVubyA9IGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSlcbiAgICBkZWNvcmF0b3JzID0gZ2V0YXR0cihub2RlLCBcImRlY29yYXRvcl9saXN0XCIsIE5vbmUpIG9yIFtdXG4gICAgaWYgZGVjb3JhdG9yczpcbiAgICAgICAgbGluZW5vID0gbWluKGxpbmVubywgKihnZXRhdHRyKGRlY29yYXRvciwgXCJsaW5lbm9cIiwgbGluZW5vKSBmb3IgZGVjb3JhdG9yIGluIGRlY29yYXRvcnMpKVxuICAgIHJldHVybiBsaW5lbm8gLSAxXG5cbmRlZiByYW5nZV9lbmQobm9kZSk6XG4gICAgcmV0dXJuIGdldGF0dHIobm9kZSwgXCJlbmRfbGluZW5vXCIsIGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSkpIC0gMVxuXG5kZWYgdGFyZ2V0X25hbWVzKHRhcmdldCk6XG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIGFzdC5OYW1lKTpcbiAgICAgICAgcmV0dXJuIFt0YXJnZXQuaWRdXG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIChhc3QuVHVwbGUsIGFzdC5MaXN0KSk6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIGl0ZW0gaW4gdGFyZ2V0LmVsdHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKGl0ZW0pKVxuICAgICAgICByZXR1cm4gbmFtZXNcbiAgICByZXR1cm4gW11cblxuZGVmIGRlZmluaXRpb25fbmFtZXMobm9kZSk6XG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkZ1bmN0aW9uRGVmLCBhc3QuQXN5bmNGdW5jdGlvbkRlZiwgYXN0LkNsYXNzRGVmKSk6XG4gICAgICAgIHJldHVybiBbbm9kZS5uYW1lXVxuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkFzc2lnbik6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIHRhcmdldCBpbiBub2RlLnRhcmdldHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKHRhcmdldCkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgKGFzdC5Bbm5Bc3NpZ24sIGFzdC5BdWdBc3NpZ24pKTpcbiAgICAgICAgcmV0dXJuIHRhcmdldF9uYW1lcyhub2RlLnRhcmdldClcbiAgICByZXR1cm4gW11cblxuZGVmIGluc3BlY3RfbW9kdWxlKHRyZWUpOlxuICAgIGRlZmluaXRpb25zID0gW11cbiAgICBpbXBvcnRzID0gW11cbiAgICBmb3Igbm9kZSBpbiB0cmVlLmJvZHk6XG4gICAgICAgIG5hbWVzID0gZGVmaW5pdGlvbl9uYW1lcyhub2RlKVxuICAgICAgICBpZiBuYW1lczpcbiAgICAgICAgICAgIGRlZmluaXRpb25zLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJuYW1lXCI6IG5hbWVzWzBdLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogbmFtZXMsXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0KTpcbiAgICAgICAgICAgIGltcG9ydHMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcImtpbmRcIjogXCJpbXBvcnRcIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogMCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkltcG9ydEZyb20pOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImZyb21cIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBub2RlLm1vZHVsZSBvciBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogbm9kZS5sZXZlbCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICByZXR1cm4ge1wiZGVmaW5pdGlvbnNcIjogZGVmaW5pdGlvbnMsIFwiaW1wb3J0c1wiOiBpbXBvcnRzfVxuXG5kZWYgYXR0cmlidXRlX2NoYWluKG5vZGUpOlxuICAgIGNoYWluID0gW11cbiAgICBjdXJyZW50ID0gbm9kZVxuICAgIHdoaWxlIGlzaW5zdGFuY2UoY3VycmVudCwgYXN0LkF0dHJpYnV0ZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmF0dHIpXG4gICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnZhbHVlXG4gICAgaWYgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuTmFtZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmlkKVxuICAgICAgICBjaGFpbi5yZXZlcnNlKClcbiAgICAgICAgcmV0dXJuIGNoYWluXG4gICAgcmV0dXJuIFtdXG5cbmNsYXNzIFVzYWdlVmlzaXRvcihhc3QuTm9kZVZpc2l0b3IpOlxuICAgIGRlZiBfX2luaXRfXyhzZWxmKTpcbiAgICAgICAgc2VsZi5uYW1lcyA9IHNldCgpXG4gICAgICAgIHNlbGYuYXR0cmlidXRlcyA9IHt9XG5cbiAgICBkZWYgdmlzaXRfTmFtZShzZWxmLCBub2RlKTpcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLmN0eCwgYXN0LkxvYWQpOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQobm9kZS5pZClcblxuICAgIGRlZiB2aXNpdF9BdHRyaWJ1dGUoc2VsZiwgbm9kZSk6XG4gICAgICAgIGNoYWluID0gYXR0cmlidXRlX2NoYWluKG5vZGUpXG4gICAgICAgIGlmIGxlbihjaGFpbikgPj0gMjpcbiAgICAgICAgICAgIHNlbGYubmFtZXMuYWRkKGNoYWluWzBdKVxuICAgICAgICAgICAgc2VsZi5hdHRyaWJ1dGVzLnNldGRlZmF1bHQoY2hhaW5bMF0sIHNldCgpKS5hZGQoY2hhaW5bMV0pXG4gICAgICAgIHNlbGYuZ2VuZXJpY192aXNpdChub2RlKVxuXG5kZWYgaW5zcGVjdF91c2FnZSh0cmVlKTpcbiAgICB2aXNpdG9yID0gVXNhZ2VWaXNpdG9yKClcbiAgICB2aXNpdG9yLnZpc2l0KHRyZWUpXG4gICAgcmV0dXJuIHtcbiAgICAgICAgXCJuYW1lc1wiOiBzb3J0ZWQodmlzaXRvci5uYW1lcyksXG4gICAgICAgIFwiYXR0cmlidXRlc1wiOiB7a2V5OiBzb3J0ZWQodmFsdWUpIGZvciBrZXksIHZhbHVlIGluIHZpc2l0b3IuYXR0cmlidXRlcy5pdGVtcygpfSxcbiAgICB9XG5cbnRyeTpcbiAgICB0cmVlID0gYXN0LnBhcnNlKHNvdXJjZSlcbmV4Y2VwdCBTeW50YXhFcnJvcjpcbiAgICBwcmludChqc29uLmR1bXBzKHtcImRlZmluaXRpb25zXCI6IFtdLCBcImltcG9ydHNcIjogW119IGlmIG1vZGUgPT0gXCJtb2R1bGVcIiBlbHNlIHtcIm5hbWVzXCI6IFtdLCBcImF0dHJpYnV0ZXNcIjoge319KSlcbiAgICByYWlzZSBTeXN0ZW1FeGl0KDApXG5cbmlmIG1vZGUgPT0gXCJtb2R1bGVcIjpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfbW9kdWxlKHRyZWUpKSlcbmVsc2U6XG4gICAgcHJpbnQoanNvbi5kdW1wcyhpbnNwZWN0X3VzYWdlKHRyZWUpKSlcbmA7XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jazogbG9vbUNvZGVCbG9jayk6IHN0cmluZyB7XG4gIGNvbnN0IGNhbGwgPSBibG9jay5zb3VyY2VSZWZlcmVuY2U/LmNhbGw7XG4gIGlmICghY2FsbCkge1xuICAgIHJldHVybiBibG9jay5jb250ZW50O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGJsb2NrLnNvdXJjZVJlZmVyZW5jZT8uc3ltYm9sTmFtZT8udHJpbSgpO1xuICBjb25zdCBpbnB1dCA9IGJsb2NrLmNvbnRlbnQudHJpbSgpO1xuICBjb25zdCBleHByZXNzaW9uID0gY2FsbC5leHByZXNzaW9uPy50cmltKClcbiAgICA/IHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZShjYWxsLmV4cHJlc3Npb24sIGlucHV0LCBzeW1ib2xOYW1lKVxuICAgIDogcmVuZGVyRGVmYXVsdFNvdXJjZUNhbGwoc3ltYm9sTmFtZSwgY2FsbC5hcmdzLCBpbnB1dCk7XG5cbiAgcmV0dXJuIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MoYmxvY2subGFuZ3VhZ2UsIGV4cHJlc3Npb24sIGNhbGwucHJpbnQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJEZWZhdWx0U291cmNlQ2FsbChzeW1ib2xOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGFyZ3M6IHN0cmluZyB8IHVuZGVmaW5lZCwgaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghc3ltYm9sTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxvb20tY2FsbCBuZWVkcyBsb29tLXN5bWJvbCB3aGVuIG5vIGNhbGwgZXhwcmVzc2lvbiBpcyBwcm92aWRlZC5cIik7XG4gIH1cblxuICBjb25zdCByZW5kZXJlZEFyZ3MgPSByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUoYXJncz8udHJpbSgpIHx8IFwie2lucHV0fVwiLCBpbnB1dCwgc3ltYm9sTmFtZSk7XG4gIHJldHVybiBgJHtzeW1ib2xOYW1lfSgke3JlbmRlcmVkQXJnc30pYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKHRlbXBsYXRlOiBzdHJpbmcsIGlucHV0OiBzdHJpbmcsIHN5bWJvbE5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZVxuICAgIC5yZXBsYWNlQWxsKFwie2lucHV0fVwiLCBpbnB1dClcbiAgICAucmVwbGFjZUFsbChcIntzeW1ib2x9XCIsIHN5bWJvbE5hbWUgPz8gXCJcIik7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nLCBwcmludDogYm9vbGVhbik6IHN0cmluZyB7XG4gIGlmICghcHJpbnQpIHtcbiAgICByZXR1cm4gcmVuZGVyRXhwcmVzc2lvblN0YXRlbWVudChsYW5ndWFnZSwgZXhwcmVzc2lvbik7XG4gIH1cblxuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGBwcmludCgke2V4cHJlc3Npb259KWA7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGBjb25zb2xlLmxvZygke2V4cHJlc3Npb259KTtgO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gYCNpbmNsdWRlIDxzdGRpby5oPlxcbmludCBtYWluKHZvaWQpIHsgcHJpbnRmKFwiJWRcXFxcblwiLCAke2V4cHJlc3Npb259KTsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBgI2luY2x1ZGUgPGlvc3RyZWFtPlxcbmludCBtYWluKCkgeyBzdGQ6OmNvdXQgPDwgKCR7ZXhwcmVzc2lvbn0pIDw8IFwiXFxcXG5cIjsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGBsZXQgKCkgPSBwcmludF9lbmRsaW5lICgke2V4cHJlc3Npb259KWA7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbG9vbS1jYWxsIGNhbm5vdCBnZW5lcmF0ZSBhIHByaW50ZWQgaGFybmVzcyBmb3IgJHtsYW5ndWFnZX0uIFVzZSBsb29tLXByaW50PWZhbHNlIG9yIHdyaXRlIHRoZSBoYXJuZXNzIGluIHRoZSBibG9jayBib2R5LmApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlckV4cHJlc3Npb25TdGF0ZW1lbnQobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBleHByZXNzaW9uO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZXhwcmVzc2lvbi5lbmRzV2l0aChcIjtcIikgPyBleHByZXNzaW9uIDogYCR7ZXhwcmVzc2lvbn07YDtcbiAgfVxufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlSW5wdXQ6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBzdGRpbiBpbnB1dFwiLCBcInRleHQtY3Vyc29yLWlucHV0XCIsIGhhbmRsZXJzLm9uVG9nZ2xlSW5wdXQsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiQ29weSBjb2RlXCIsIFwiY29weVwiLCBoYW5kbGVycy5vbkNvcHksIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUmVtb3ZlIHNuaXBwZXRcIiwgXCJ0cmFzaC0yXCIsIGhhbmRsZXJzLm9uUmVtb3ZlLCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBvdXRwdXRcIiwgXCJwYW5lbC1ib3R0b20tb3BlblwiLCBoYW5kbGVycy5vblRvZ2dsZU91dHB1dCwgZmFsc2UpKTtcblxuICByZXR1cm4gdG9vbGJhcjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnV0dG9uKGxhYmVsOiBzdHJpbmcsIGljb25OYW1lOiBzdHJpbmcsIG9uQ2xpY2s6ICgpID0+IHZvaWQsIHNwaW5uaW5nOiBib29sZWFuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICBjb25zdCBidXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICBidXR0b24uY2xhc3NOYW1lID0gYGxvb20tdG9vbGJhci1idXR0b24ke3NwaW5uaW5nID8gXCIgaXMtcnVubmluZ1wiIDogXCJcIn1gO1xuICBidXR0b24udHlwZSA9IFwiYnV0dG9uXCI7XG4gIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGxhYmVsKTtcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIG9uQ2xpY2soKTtcbiAgfSk7XG4gIHNldEljb24oYnV0dG9uLCBpY29uTmFtZSk7XG4gIHJldHVybiBidXR0b247XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBsb29tT3V0cHV0UGFuZWxPcHRpb25zIHtcbiAgZGVmYXVsdFZpc2libGVMaW5lczogbnVtYmVyO1xufVxuXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICByZXR1cm4gb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpIHx8IG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpID8gXCJ3YXJuaW5nXCIgOiBcInN1Y2Nlc3NcIjtcbiAgfVxuXG4gIHJldHVybiBcImZhaWx1cmVcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgb3B0aW9uczogbG9vbU91dHB1dFBhbmVsT3B0aW9ucyk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtnZXRTdGF0dXNLaW5kKG91dHB1dCl9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn1gO1xuICBwYW5lbC5kYXRhc2V0Lmxvb21CbG9ja0lkID0gb3V0cHV0LmJsb2NrSWQ7XG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQsIG9wdGlvbnMpO1xuICByZXR1cm4gcGFuZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJPdXRwdXRQYW5lbChwYW5lbDogSFRNTEVsZW1lbnQsIG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgb3B0aW9uczogbG9vbU91dHB1dFBhbmVsT3B0aW9ucyk6IHZvaWQge1xuICBjb25zdCBraW5kID0gZ2V0U3RhdHVzS2luZChvdXRwdXQpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XG4gIHBhbmVsLmVtcHR5KCk7XG4gIGNvbnN0IHZpc2libGVMaW5lcyA9IHJlc29sdmVWaXNpYmxlTGluZXMob3V0cHV0LCBvcHRpb25zLmRlZmF1bHRWaXNpYmxlTGluZXMpO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3QgYmFkZ2UgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJhZGdlXCIgfSk7XG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xuXG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xuXG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcblxuICBjb25zdCBib2R5ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJvZHlcIiB9KTtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZG91dFwiLCBvdXRwdXQucmVzdWx0LnN0ZG91dCwgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZywgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3RkZXJyXCIsIG91dHB1dC5yZXN1bHQuc3RkZXJyLCB2aXNpYmxlTGluZXMpO1xuICB9XG4gIGlmIChvdXRwdXQuc291cmNlUHJldmlldz8uY29udGVudC50cmltKCkpIHtcbiAgICBjcmVhdGVTb3VyY2VQcmV2aWV3KGJvZHksIG91dHB1dC5zb3VyY2VQcmV2aWV3KTtcbiAgfVxuICBpZiAoIW91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSAmJiAhb3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY29uc3QgZW1wdHkgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1lbXB0eVwiIH0pO1xuICAgIGVtcHR5LnNldFRleHQoXCJObyBvdXRwdXRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZywgdmlzaWJsZUxpbmVzOiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtXCIgfSk7XG4gIGNvbnN0IGxpbmVDb3VudCA9IGNvdW50TGluZXMoY29udGVudCk7XG4gIHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbS1sYWJlbFwiLCB0ZXh0OiBmb3JtYXRTdHJlYW1MYWJlbChsYWJlbCwgbGluZUNvdW50LCB2aXNpYmxlTGluZXMpIH0pO1xuICBjb25zdCBwcmUgPSBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xuICBpZiAodmlzaWJsZUxpbmVzID4gMCAmJiBsaW5lQ291bnQgPiB2aXNpYmxlTGluZXMpIHtcbiAgICBwcmUuYWRkQ2xhc3MoXCJpcy1zY3JvbGwtbGltaXRlZFwiKTtcbiAgICBwcmUuc3R5bGUuc2V0UHJvcGVydHkoXCItLWxvb20tb3V0cHV0LXZpc2libGUtbGluZXNcIiwgU3RyaW5nKHZpc2libGVMaW5lcykpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVNvdXJjZVByZXZpZXcoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgcHJldmlldzogTm9uTnVsbGFibGU8bG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0+KTogdm9pZCB7XG4gIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXIuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXdcIiB9KTtcbiAgZGV0YWlscy5vcGVuID0gcHJldmlldy5leHBhbmRlZDtcbiAgY29uc3Qgc3VtbWFyeSA9IGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXctc3VtbWFyeVwiIH0pO1xuICBzdW1tYXJ5LmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIkV4dHJhY3RlZCBzb3VyY2VcIiB9KTtcbiAgc3VtbWFyeS5jcmVhdGVTcGFuKHsgY2xzOiBcImxvb20tc291cmNlLXByZXZpZXctbWV0YVwiLCB0ZXh0OiBmb3JtYXRTb3VyY2VQcmV2aWV3TWV0YShwcmV2aWV3KSB9KTtcbiAgZGV0YWlscy5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmUgbG9vbS1zb3VyY2UtcHJldmlldy1wcmVcIiwgdGV4dDogcHJldmlldy5jb250ZW50IH0pO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTb3VyY2VQcmV2aWV3TWV0YShwcmV2aWV3OiBOb25OdWxsYWJsZTxsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXT4pOiBzdHJpbmcge1xuICBjb25zdCBjYXBhYmlsaXR5ID0gcHJldmlldy5jYXBhYmlsaXR5O1xuICBpZiAoIWNhcGFiaWxpdHkgfHwgIXByZXZpZXcuc2hvd0NhcGFiaWxpdHlNZXRhZGF0YSkge1xuICAgIHJldHVybiBgJHtwcmV2aWV3Lmxhbmd1YWdlfSBcdTAwQjcgJHtwcmV2aWV3LmRlc2NyaXB0aW9ufWA7XG4gIH1cbiAgcmV0dXJuIFtcbiAgICBwcmV2aWV3Lmxhbmd1YWdlLFxuICAgIHByZXZpZXcuZGVzY3JpcHRpb24sXG4gICAgYHN5bWJvbHM6JHtjYXBhYmlsaXR5LnN5bWJvbEV4dHJhY3Rpb259YCxcbiAgICBgZGVwczoke2NhcGFiaWxpdHkuZGVwZW5kZW5jeVRyYWNpbmd9YCxcbiAgICBgY2FsbDoke2NhcGFiaWxpdHkuY2FsbEhhcm5lc3N9YCxcbiAgXS5qb2luKFwiIFx1MDBCNyBcIik7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVWaXNpYmxlTGluZXMob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0LCBkZWZhdWx0VmlzaWJsZUxpbmVzOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBvdmVycmlkZSA9IG91dHB1dC5ibG9jay5hdHRyaWJ1dGVzW1wibG9vbS1vdXRwdXQtbGluZXNcIl0gPz8gb3V0cHV0LmJsb2NrLmF0dHJpYnV0ZXNbXCJvdXRwdXQtbGluZXNcIl07XG4gIGlmIChvdmVycmlkZSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVZpc2libGVMaW5lcyhOdW1iZXIucGFyc2VJbnQob3ZlcnJpZGUudHJpbSgpLCAxMCkpO1xuICB9XG4gIHJldHVybiBub3JtYWxpemVWaXNpYmxlTGluZXMoZGVmYXVsdFZpc2libGVMaW5lcyk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVZpc2libGVMaW5lcyh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuICByZXR1cm4gTWF0aC5taW4oTWF0aC5mbG9vcih2YWx1ZSksIDIwMDApO1xufVxuXG5mdW5jdGlvbiBjb3VudExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBjb250ZW50LnJlcGxhY2UoL1xcbiQvLCBcIlwiKS5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFN0cmVhbUxhYmVsKGxhYmVsOiBzdHJpbmcsIGxpbmVDb3VudDogbnVtYmVyLCB2aXNpYmxlTGluZXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmICh2aXNpYmxlTGluZXMgPiAwICYmIGxpbmVDb3VudCA+IHZpc2libGVMaW5lcykge1xuICAgIHJldHVybiBgJHtsYWJlbH0gXHUwMEI3ICR7bGluZUNvdW50fSBsaW5lcyBcdTAwQjcgc2hvd2luZyAke3Zpc2libGVMaW5lc31gO1xuICB9XG4gIHJldHVybiBsYWJlbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJ1bm5pbmdQYW5lbCgpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLW91dHB1dC1wYW5lbCBpcy1ydW5uaW5nXCI7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBzcGlubmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNwaW5uZXJcIiB9KTtcbiAgc2V0SWNvbihzcGlubmVyLCBcImxvYWRlci1jaXJjbGVcIik7XG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KFwiUnVubmluZ1wiKTtcbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoXCJFeGVjdXRpbmcuLi5cIik7XG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1oaWRkZW5cIiwgXCJ0cnVlXCIpO1xuXG4gIHJldHVybiBwYW5lbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQVNPO0FBQ1AsbUJBQTZDO0FBQzdDLElBQUFDLGVBQTJFO0FBQzNFLElBQUFDLGdCQUF3Qjs7O0FDWnhCLHNCQUE2QztBQUM3QyxnQkFBZ0Q7QUFDaEQsSUFBQUMsbUJBQXdEO0FBQ3hELElBQUFDLGVBQWlGO0FBQ2pGLElBQUFDLHdCQUFzQjs7O0FDSnRCLHNCQUF1QztBQUN2QyxnQkFBdUI7QUFDdkIsa0JBQXFCO0FBQ3JCLDJCQUFzQjtBQXlCdEIsZUFBc0Isd0JBQ3BCLFVBQ0EsUUFDQSxVQUNZO0FBQ1osUUFBTSxVQUFVLFVBQU0sNkJBQVEsc0JBQUssa0JBQU8sR0FBRyxPQUFPLENBQUM7QUFDckQsUUFBTSxlQUFXLGtCQUFLLFNBQVMsUUFBUTtBQUV2QyxNQUFJO0FBQ0YsY0FBTSwyQkFBVSxVQUFVLDBCQUEwQixNQUFNLEdBQUcsTUFBTTtBQUNuRSxXQUFPLE1BQU0sU0FBUyxFQUFFLFNBQVMsU0FBUyxDQUFDO0FBQUEsRUFDN0MsVUFBRTtBQUNBLGNBQU0sb0JBQUcsU0FBUyxFQUFFLFdBQVcsTUFBTSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3BEO0FBQ0Y7QUFFQSxlQUFzQixtQkFDcEIsZUFDQSxRQUNBLFVBQ1k7QUFDWixTQUFPLHdCQUF3QixVQUFVLGFBQWEsSUFBSSxRQUFRLFFBQVE7QUFDNUU7QUFFQSxTQUFTLDBCQUEwQixRQUF3QjtBQUN6RCxRQUFNLFFBQVEsT0FBTyxNQUFNLElBQUk7QUFDL0IsUUFBTSxnQkFBZ0IsTUFBTSxPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssRUFBRSxTQUFTLENBQUM7QUFDbkUsTUFBSSxDQUFDLGNBQWMsUUFBUTtBQUN6QixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksZUFBZSxxQkFBcUIsY0FBYyxDQUFDLENBQUM7QUFDeEQsYUFBVyxRQUFRLGNBQWMsTUFBTSxDQUFDLEdBQUc7QUFDekMsbUJBQWUsdUJBQXVCLGNBQWMscUJBQXFCLElBQUksQ0FBQztBQUM5RSxRQUFJLENBQUMsY0FBYztBQUNqQixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFFQSxNQUFJLENBQUMsY0FBYztBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sTUFDSixJQUFJLENBQUMsU0FBVSxLQUFLLEtBQUssRUFBRSxXQUFXLElBQUksT0FBTyxLQUFLLFdBQVcsWUFBWSxJQUFJLEtBQUssTUFBTSxhQUFhLE1BQU0sSUFBSSxJQUFLLEVBQ3hILEtBQUssSUFBSTtBQUNkO0FBRUEsU0FBUyxxQkFBcUIsTUFBc0I7QUFDbEQsUUFBTSxRQUFRLEtBQUssTUFBTSxTQUFTO0FBQ2xDLFNBQU8sUUFBUSxDQUFDLEtBQUs7QUFDdkI7QUFFQSxTQUFTLHVCQUF1QixNQUFjLE9BQXVCO0FBQ25FLE1BQUksUUFBUTtBQUNaLFNBQU8sUUFBUSxLQUFLLFVBQVUsUUFBUSxNQUFNLFVBQVUsS0FBSyxLQUFLLE1BQU0sTUFBTSxLQUFLLEdBQUc7QUFDbEYsYUFBUztBQUFBLEVBQ1g7QUFDQSxTQUFPLEtBQUssTUFBTSxHQUFHLEtBQUs7QUFDNUI7QUFFQSxlQUFzQixXQUFXLE1BQStDO0FBQzlFLFFBQU0sWUFBWSxvQkFBSSxLQUFLO0FBQzNCLE1BQUksU0FBUztBQUNiLE1BQUksU0FBUztBQUNiLE1BQUksV0FBMEI7QUFDOUIsTUFBSSxXQUFXO0FBQ2YsTUFBSSxZQUFZO0FBQ2hCLE1BQUksUUFBeUM7QUFDN0MsTUFBSSxnQkFBdUM7QUFDM0MsTUFBSSxlQUFvQztBQUV4QyxNQUFJO0FBQ0YsVUFBTSxJQUFJLFFBQWMsQ0FBQyxTQUFTLFdBQVc7QUFDM0Msa0JBQVEsNEJBQU0sS0FBSyxZQUFZLEtBQUssTUFBTTtBQUFBLFFBQ3hDLEtBQUssS0FBSztBQUFBLFFBQ1YsT0FBTztBQUFBLFFBQ1AsT0FBTyxDQUFDLFFBQVEsUUFBUSxNQUFNO0FBQUEsUUFDOUIsS0FBSztBQUFBLFVBQ0gsR0FBRyxRQUFRO0FBQUEsVUFDWCxHQUFHLEtBQUs7QUFBQSxRQUNWO0FBQUEsTUFDRixDQUFDO0FBQ0QsWUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLFVBQWlDO0FBQ3pELFlBQUksTUFBTSxTQUFTLFNBQVM7QUFDMUIsaUJBQU8sS0FBSztBQUFBLFFBQ2Q7QUFBQSxNQUNGLENBQUM7QUFDRCxVQUFJLEtBQUssU0FBUyxNQUFNO0FBQ3RCLGNBQU0sT0FBTyxJQUFJLEtBQUssS0FBSztBQUFBLE1BQzdCLE9BQU87QUFDTCxjQUFNLE9BQU8sUUFBUTtBQUFBLE1BQ3ZCO0FBRUEsWUFBTSxRQUFRLE1BQU07QUFDbEIsb0JBQVk7QUFDWixlQUFPLEtBQUssU0FBUztBQUFBLE1BQ3ZCO0FBQ0EscUJBQWU7QUFFZixVQUFJLEtBQUssT0FBTyxTQUFTO0FBQ3ZCLGNBQU07QUFBQSxNQUNSLE9BQU87QUFDTCxhQUFLLE9BQU8saUJBQWlCLFNBQVMsT0FBTyxFQUFFLE1BQU0sS0FBSyxDQUFDO0FBQUEsTUFDN0Q7QUFFQSxzQkFBZ0IsV0FBVyxNQUFNO0FBQy9CLG1CQUFXO0FBQ1gsZUFBTyxLQUFLLFNBQVM7QUFBQSxNQUN2QixHQUFHLEtBQUssU0FBUztBQUVqQixZQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsVUFBVTtBQUNsQyxrQkFBVSxNQUFNLFNBQVM7QUFBQSxNQUMzQixDQUFDO0FBRUQsWUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFVBQVU7QUFDbEMsa0JBQVUsTUFBTSxTQUFTO0FBQUEsTUFDM0IsQ0FBQztBQUVELFlBQU0sR0FBRyxTQUFTLENBQUMsVUFBVTtBQUMzQixlQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFFRCxZQUFNLEdBQUcsU0FBUyxDQUFDLFNBQVM7QUFDMUIsbUJBQVc7QUFDWCxnQkFBUTtBQUFBLE1BQ1YsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0gsU0FBUyxPQUFPO0FBQ2QsYUFBUyxVQUFVLG1CQUFtQixPQUFPLEtBQUssVUFBVTtBQUM1RCxlQUFXLFlBQVk7QUFBQSxFQUN6QixVQUFFO0FBQ0EsUUFBSSxjQUFjO0FBQ2hCLFdBQUssT0FBTyxvQkFBb0IsU0FBUyxZQUFZO0FBQUEsSUFDdkQ7QUFDQSxRQUFJLGVBQWU7QUFDakIsbUJBQWEsYUFBYTtBQUFBLElBQzVCO0FBQUEsRUFDRjtBQUVBLFFBQU0sYUFBYSxvQkFBSSxLQUFLO0FBQzVCLFFBQU0sYUFBYSxXQUFXLFFBQVEsSUFBSSxVQUFVLFFBQVE7QUFDNUQsUUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLGFBQWEsYUFBYTtBQUV4RCxTQUFPO0FBQUEsSUFDTCxVQUFVLEtBQUs7QUFBQSxJQUNmLFlBQVksS0FBSztBQUFBLElBQ2pCLFdBQVcsVUFBVSxZQUFZO0FBQUEsSUFDakMsWUFBWSxXQUFXLFlBQVk7QUFBQSxJQUNuQztBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsbUJBQW1CLE9BQWdCLFlBQTRCO0FBQ3RFLE1BQUksaUJBQWlCLFNBQVMsVUFBVSxTQUFVLE1BQWdDLFNBQVMsVUFBVTtBQUNuRyxXQUFPLHlCQUF5QixVQUFVO0FBQUEsRUFDNUM7QUFFQSxTQUFPLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDOUQ7QUFFQSxlQUFzQixtQkFBbUIsTUFBa0Q7QUFDekYsU0FBTztBQUFBLElBQW1CLEtBQUs7QUFBQSxJQUFlLEtBQUs7QUFBQSxJQUFRLE9BQU8sRUFBRSxVQUFVLFFBQVEsTUFDcEYsV0FBVztBQUFBLE1BQ1QsVUFBVSxLQUFLO0FBQUEsTUFDZixZQUFZLEtBQUs7QUFBQSxNQUNqQixZQUFZLEtBQUs7QUFBQSxNQUNqQixNQUFNLEtBQUssS0FBSyxJQUFJLENBQUMsVUFBVSxNQUFNLFdBQVcsVUFBVSxRQUFRLEVBQUUsV0FBVyxhQUFhLE9BQU8sQ0FBQztBQUFBLE1BQ3BHLGtCQUFrQixLQUFLO0FBQUEsTUFDdkIsV0FBVyxLQUFLO0FBQUEsTUFDaEIsUUFBUSxLQUFLO0FBQUEsTUFDYixPQUFPLEtBQUs7QUFBQSxNQUNaLEtBQUssbUJBQW1CLEtBQUssS0FBSyxVQUFVLE9BQU87QUFBQSxJQUNyRCxDQUFDO0FBQUEsRUFDSDtBQUNGO0FBRUEsU0FBUyxtQkFBbUIsS0FBb0MsVUFBa0IsU0FBZ0Q7QUFDaEksTUFBSSxDQUFDLEtBQUs7QUFDUixXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sT0FBTztBQUFBLElBQ1osT0FBTyxRQUFRLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssTUFBTTtBQUFBLE1BQ3hDO0FBQUEsTUFDQSxPQUFPLFVBQVUsV0FBVyxNQUFNLFdBQVcsVUFBVSxRQUFRLEVBQUUsV0FBVyxhQUFhLE9BQU8sSUFBSTtBQUFBLElBQ3RHLENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQzlOTyxTQUFTLGlCQUFpQixPQUF5QjtBQUN4RCxRQUFNLFFBQWtCLENBQUM7QUFDekIsTUFBSSxVQUFVO0FBQ2QsTUFBSSxRQUEyQjtBQUMvQixNQUFJLFdBQVc7QUFFZixhQUFXLFFBQVEsTUFBTSxLQUFLLEdBQUc7QUFDL0IsUUFBSSxVQUFVO0FBQ1osaUJBQVc7QUFDWCxpQkFBVztBQUNYO0FBQUEsSUFDRjtBQUVBLFFBQUksU0FBUyxNQUFNO0FBQ2pCLGlCQUFXO0FBQ1g7QUFBQSxJQUNGO0FBRUEsU0FBSyxTQUFTLE9BQU8sU0FBUyxRQUFTLENBQUMsT0FBTztBQUM3QyxjQUFRO0FBQ1I7QUFBQSxJQUNGO0FBRUEsUUFBSSxTQUFTLE9BQU87QUFDbEIsY0FBUTtBQUNSO0FBQUEsSUFDRjtBQUVBLFFBQUksS0FBSyxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU87QUFDN0IsVUFBSSxTQUFTO0FBQ1gsY0FBTSxLQUFLLE9BQU87QUFDbEIsa0JBQVU7QUFBQSxNQUNaO0FBQ0E7QUFBQSxJQUNGO0FBRUEsZUFBVztBQUFBLEVBQ2I7QUFFQSxNQUFJLFNBQVM7QUFDWCxVQUFNLEtBQUssT0FBTztBQUFBLEVBQ3BCO0FBRUEsU0FBTztBQUNUOzs7QUM3Qk8sSUFBTSw2QkFBb0Q7QUFBQSxFQUMvRDtBQUFBLElBQ0UsSUFBSTtBQUFBLElBQ0osYUFBYTtBQUFBLElBQ2IsYUFBYTtBQUFBLElBQ2IsV0FBVztBQUFBLE1BQ1QsRUFBRSxJQUFJLFVBQVUsYUFBYSxVQUFVLFNBQVMsQ0FBQyxVQUFVLElBQUksRUFBRTtBQUFBLE1BQ2pFLEVBQUUsSUFBSSxjQUFjLGFBQWEsY0FBYyxTQUFTLENBQUMsY0FBYyxJQUFJLEVBQUU7QUFBQSxNQUM3RSxFQUFFLElBQUksY0FBYyxhQUFhLGNBQWMsU0FBUyxDQUFDLGNBQWMsSUFBSSxFQUFFO0FBQUEsTUFDN0UsRUFBRSxJQUFJLFNBQVMsYUFBYSxTQUFTLFNBQVMsQ0FBQyxTQUFTLE1BQU0sUUFBUSxLQUFLLEVBQUU7QUFBQSxNQUM3RSxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsSUFBSSxFQUFFO0FBQUEsTUFDM0QsRUFBRSxJQUFJLFFBQVEsYUFBYSxRQUFRLFNBQVMsQ0FBQyxRQUFRLElBQUksRUFBRTtBQUFBLE1BQzNELEVBQUUsSUFBSSxPQUFPLGFBQWEsT0FBTyxTQUFTLENBQUMsS0FBSyxFQUFFO0FBQUEsTUFDbEQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxLQUFLLEVBQUU7QUFBQSxNQUNsRCxFQUFFLElBQUksTUFBTSxhQUFhLE1BQU0sU0FBUyxDQUFDLE1BQU0sUUFBUSxFQUFFO0FBQUEsTUFDekQsRUFBRSxJQUFJLFdBQVcsYUFBYSxXQUFXLFNBQVMsQ0FBQyxXQUFXLElBQUksRUFBRTtBQUFBLE1BQ3BFLEVBQUUsSUFBSSxTQUFTLGFBQWEsU0FBUyxTQUFTLENBQUMsU0FBUyxJQUFJLEVBQUU7QUFBQSxJQUNoRTtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksS0FBSyxhQUFhLEtBQUssU0FBUyxDQUFDLEtBQUssR0FBRyxFQUFFO0FBQUEsTUFDakQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxPQUFPLE9BQU8sTUFBTSxLQUFLLEVBQUU7QUFBQSxJQUN4RTtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsSUFBSSxFQUFFO0FBQUEsTUFDM0QsRUFBRSxJQUFJLFFBQVEsYUFBYSxRQUFRLFNBQVMsQ0FBQyxNQUFNLEVBQUU7QUFBQSxJQUN2RDtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksUUFBUSxhQUFhLFFBQVEsU0FBUyxDQUFDLFFBQVEsT0FBTyxFQUFFO0FBQUEsTUFDOUQsRUFBRSxJQUFJLE9BQU8sYUFBYSxPQUFPLFNBQVMsQ0FBQyxPQUFPLEdBQUcsRUFBRTtBQUFBLE1BQ3ZELEVBQUUsSUFBSSxVQUFVLGFBQWEsV0FBVyxTQUFTLENBQUMsT0FBTyxRQUFRLFVBQVUsV0FBVyxJQUFJLEVBQUU7QUFBQSxJQUM5RjtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxJQUFJO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsTUFDVCxFQUFFLElBQUksV0FBVyxhQUFhLFdBQVcsU0FBUyxDQUFDLFFBQVEsVUFBVSxXQUFXLElBQUksRUFBRTtBQUFBLElBQ3hGO0FBQUEsRUFDRjtBQUFBLEVBQ0E7QUFBQSxJQUNFLElBQUk7QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLGFBQWE7QUFBQSxJQUNiLFdBQVc7QUFBQSxNQUNULEVBQUUsSUFBSSxVQUFVLGFBQWEsVUFBVSxTQUFTLENBQUMsUUFBUSxVQUFVLFNBQVMsS0FBSyxFQUFFO0FBQUEsTUFDbkYsRUFBRSxJQUFJLFlBQVksYUFBYSxZQUFZLFNBQVMsQ0FBQyxZQUFZLElBQUksRUFBRTtBQUFBLElBQ3pFO0FBQUEsRUFDRjtBQUNGO0FBRU8sSUFBTSw2QkFBNkI7QUFDbkMsSUFBTSxpQ0FBaUM7QUFFdkMsU0FBUyw0QkFBc0M7QUFDcEQsU0FBTyxDQUFDLEdBQUcsMkJBQTJCLElBQUksQ0FBQyxTQUFTLEtBQUssRUFBRSxHQUFHLDBCQUEwQjtBQUMxRjtBQUVPLFNBQVMsd0JBQWtDO0FBQ2hELFNBQU8sMkJBQTJCLFFBQVEsQ0FBQyxTQUFTLEtBQUssVUFBVSxJQUFJLENBQUMsYUFBYSxTQUFTLEVBQUUsQ0FBQztBQUNuRztBQUVPLFNBQVMsK0JBQStCLFVBQW9DO0FBQ2pGLE1BQUksQ0FBQyxNQUFNLFFBQVEsU0FBUyxxQkFBcUIsR0FBRztBQUNsRCxhQUFTLHdCQUF3QixDQUFDO0FBQUEsRUFDcEM7QUFDQSxNQUFJLENBQUMsTUFBTSxRQUFRLFNBQVMsb0JBQW9CLEtBQUssQ0FBQyxTQUFTLHFCQUFxQixRQUFRO0FBQzFGLGFBQVMsdUJBQXVCLDBCQUEwQjtBQUFBLEVBQzVEO0FBQ0EsTUFBSSxDQUFDLE1BQU0sUUFBUSxTQUFTLGdCQUFnQixLQUFLLENBQUMsU0FBUyxpQkFBaUIsUUFBUTtBQUNsRixhQUFTLG1CQUFtQixzQkFBc0I7QUFBQSxFQUNwRDtBQUNBLE1BQUksQ0FBQyxPQUFPLFNBQVMsU0FBUyw0QkFBNEIsR0FBRztBQUMzRCxhQUFTLCtCQUErQjtBQUFBLEVBQzFDO0FBQ0EsTUFBSSxTQUFTLCtCQUErQixHQUFHO0FBQzdDLDBCQUFzQixVQUFVLE1BQU07QUFDdEMsYUFBUywrQkFBK0I7QUFBQSxFQUMxQztBQUNGO0FBRUEsU0FBUyxzQkFBc0IsVUFBOEIsV0FBeUI7QUFDcEYsUUFBTSxPQUFPLDJCQUEyQixLQUFLLENBQUMsY0FBYyxVQUFVLE9BQU8sU0FBUztBQUN0RixNQUFJLENBQUMsTUFBTTtBQUNUO0FBQUEsRUFDRjtBQUNBLGVBQWEsU0FBUyxzQkFBc0IsS0FBSyxFQUFFO0FBQ25ELGFBQVcsWUFBWSxLQUFLLFdBQVc7QUFDckMsaUJBQWEsU0FBUyxrQkFBa0IsU0FBUyxFQUFFO0FBQUEsRUFDckQ7QUFDRjtBQUVBLFNBQVMsYUFBYSxRQUFrQixPQUFxQjtBQUMzRCxNQUFJLENBQUMsT0FBTyxTQUFTLEtBQUssR0FBRztBQUMzQixXQUFPLEtBQUssS0FBSztBQUFBLEVBQ25CO0FBQ0Y7QUFFTyxTQUFTLDhCQUE4QixVQUF3RDtBQUNwRyxpQ0FBK0IsUUFBUTtBQUN2QyxRQUFNLGVBQWUsSUFBSSxJQUFJLFNBQVMsb0JBQW9CO0FBQzFELFFBQU0sbUJBQW1CLElBQUksSUFBSSxTQUFTLGdCQUFnQjtBQUUxRCxTQUFPLDZCQUE2QixRQUFRLEVBQ3pDLE9BQU8sQ0FBQyxTQUFTLGFBQWEsSUFBSSxLQUFLLEVBQUUsQ0FBQyxFQUMxQyxRQUFRLENBQUMsU0FBUyxLQUFLLFNBQVMsRUFDaEMsT0FBTyxDQUFDLGFBQWEsaUJBQWlCLElBQUksU0FBUyxFQUFFLENBQUM7QUFDM0Q7QUFFTyxTQUFTLDZCQUE2QixVQUFxRDtBQUNoRyxpQ0FBK0IsUUFBUTtBQUN2QyxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxJQUFJLFNBQVMseUJBQXlCLENBQUMsR0FBRyxJQUFJLENBQUMsVUFBVTtBQUFBLE1BQ3ZELElBQUksS0FBSztBQUFBLE1BQ1QsYUFBYSxLQUFLO0FBQUEsTUFDbEIsYUFBYSxLQUFLO0FBQUEsTUFDbEIsV0FBVyxLQUFLLFVBQVUsSUFBSSxDQUFDLGNBQWM7QUFBQSxRQUMzQyxJQUFJLFNBQVM7QUFBQSxRQUNiLGFBQWEsU0FBUyxlQUFlLFNBQVM7QUFBQSxRQUM5QyxTQUFTLGVBQWUsU0FBUyxPQUFPO0FBQUEsTUFDMUMsRUFBRTtBQUFBLElBQ0osRUFBRTtBQUFBLEVBQ0o7QUFDRjtBQUVPLFNBQVMsMkJBQTJCLFVBQXNFO0FBQy9HLFNBQU8sT0FBTztBQUFBLElBQ1osOEJBQThCLFFBQVEsRUFBRTtBQUFBLE1BQVEsQ0FBQyxhQUMvQyxTQUFTLFFBQVEsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLFlBQVksR0FBRyxTQUFTLEVBQUUsQ0FBVTtBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUNGO0FBRU8sU0FBUyxrQkFBa0IsWUFBb0MsVUFBdUM7QUFDM0csaUNBQStCLFFBQVE7QUFDdkMsU0FBTyw4QkFBOEIsUUFBUSxFQUFFLEtBQUssQ0FBQyxhQUFhLFNBQVMsT0FBTyxVQUFVO0FBQzlGO0FBRU8sU0FBUywwQkFBMEIsVUFBdUM7QUFDL0UsaUNBQStCLFFBQVE7QUFDdkMsU0FBTyxTQUFTLHFCQUFxQixTQUFTLDBCQUEwQjtBQUMxRTtBQUVPLFNBQVMsMkJBQTJCLFVBQW9EO0FBQzdGLGlDQUErQixRQUFRO0FBQ3ZDLFFBQU0sZUFBZSxJQUFJLElBQUksU0FBUyxvQkFBb0I7QUFDMUQsUUFBTSxtQkFBbUIsSUFBSSxJQUFJLFNBQVMsZ0JBQWdCO0FBQzFELFFBQU0sa0JBQWtCLDBCQUEwQixRQUFRLElBQUksU0FBUyxtQkFBbUIsQ0FBQyxJQUFJLENBQUM7QUFDaEcsUUFBTSxxQkFBcUIsU0FBUyx5QkFBeUIsQ0FBQyxHQUMzRCxPQUFPLENBQUMsU0FBUyxhQUFhLElBQUksS0FBSyxFQUFFLENBQUMsRUFDMUMsUUFBUSxDQUFDLFNBQVMsS0FBSyxTQUFTLEVBQ2hDLE9BQU8sQ0FBQyxhQUFhLGlCQUFpQixJQUFJLFNBQVMsSUFBSSxDQUFDO0FBRTNELFNBQU8sQ0FBQyxHQUFHLGlCQUFpQixHQUFHLGlCQUFpQjtBQUNsRDtBQUVPLFNBQVMsMkJBQTJCLFVBQThCLG9CQUE0QixhQUFzRDtBQUN6SixRQUFNLGFBQWEsbUJBQW1CLEtBQUssRUFBRSxZQUFZO0FBQ3pELFFBQU0sUUFBUSxhQUFhLEtBQUssRUFBRSxZQUFZO0FBQzlDLFNBQU8sMkJBQTJCLFFBQVEsRUFBRSxLQUFLLENBQUMsYUFBYTtBQUM3RCxVQUFNLE9BQU8sU0FBUyxLQUFLLEtBQUssRUFBRSxZQUFZO0FBQzlDLFVBQU0sVUFBVSxlQUFlLFNBQVMsT0FBTztBQUMvQyxXQUFPLFNBQVMsY0FBYyxRQUFRLFNBQVMsVUFBVSxLQUFLLFFBQVEsVUFBVSxTQUFTLFNBQVMsUUFBUSxTQUFTLEtBQUssRUFBRTtBQUFBLEVBQzVILENBQUM7QUFDSDtBQUVBLFNBQVMsZUFBZSxPQUEwQjtBQUNoRCxVQUFRLFNBQVMsSUFDZCxNQUFNLEdBQUcsRUFDVCxJQUFJLENBQUMsVUFBVSxNQUFNLEtBQUssRUFBRSxZQUFZLENBQUMsRUFDekMsT0FBTyxPQUFPO0FBQ25COzs7QUg3Rk8sSUFBTSxzQkFBTixNQUEwQjtBQUFBLEVBRy9CLFlBQ21CLEtBQ0EsV0FDakI7QUFGaUI7QUFDQTtBQUpuQixTQUFpQixjQUFjLG9CQUFJLElBQVk7QUFBQSxFQUszQztBQUFBLEVBRUosc0JBQXNCLE1BQTRCO0FBQ2hELFVBQU0sY0FBYyxLQUFLLElBQUksY0FBYyxhQUFhLElBQUksR0FBRztBQUMvRCxVQUFNLFFBQVEsY0FBYyxnQkFBZ0I7QUFDNUMsV0FBTyxPQUFPLFVBQVUsWUFBWSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUFBLEVBQ3BFO0FBQUEsRUFFQSxNQUFNLG9CQUFzRTtBQUMxRSxVQUFNLGlCQUFpQixLQUFLLGtCQUFrQjtBQUM5QyxRQUFJLEtBQUMsc0JBQVcsY0FBYyxHQUFHO0FBQy9CLGFBQU8sQ0FBQztBQUFBLElBQ1Y7QUFFQSxVQUFNLFVBQVUsVUFBTSwwQkFBUSxnQkFBZ0IsRUFBRSxlQUFlLEtBQUssQ0FBQztBQUNyRSxXQUFPLFFBQVE7QUFBQSxNQUNiLFFBQ0csT0FBTyxDQUFDLFVBQVUsTUFBTSxZQUFZLENBQUMsRUFDckMsSUFBSSxPQUFPLFVBQVU7QUFDcEIsY0FBTSxnQkFBWSxtQkFBSyxnQkFBZ0IsTUFBTSxJQUFJO0FBQ2pELGNBQU0sZ0JBQVksMEJBQVcsbUJBQUssV0FBVyxhQUFhLENBQUM7QUFDM0QsY0FBTSxvQkFBZ0IsMEJBQVcsbUJBQUssV0FBVyxZQUFZLENBQUM7QUFDOUQsWUFBSSxDQUFDLFdBQVc7QUFDZCxpQkFBTztBQUFBLFlBQ0wsTUFBTSxNQUFNO0FBQUEsWUFDWixRQUFRO0FBQUEsVUFDVjtBQUFBLFFBQ0Y7QUFDQSxZQUFJO0FBQ0YsZ0JBQU0sU0FBUyxNQUFNLEtBQUssV0FBVyxTQUFTO0FBQzlDLGdCQUFNLFNBQVMsQ0FBQyxZQUFZLE9BQU8sT0FBTyxFQUFFO0FBQzVDLGVBQUssT0FBTyxZQUFZLFlBQVksT0FBTyxZQUFZLGFBQWEsZUFBZTtBQUNqRixtQkFBTyxLQUFLLFlBQVk7QUFBQSxVQUMxQjtBQUNBLGNBQUksT0FBTyxZQUFZLFVBQVUsT0FBTyxNQUFNLFdBQVc7QUFDdkQsbUJBQU8sS0FBSyxRQUFRLE9BQU8sS0FBSyxTQUFTLEVBQUU7QUFBQSxVQUM3QztBQUNBLGNBQUksT0FBTyxZQUFZLFVBQVUsT0FBTyxNQUFNLFNBQVMsU0FBUztBQUM5RCxtQkFBTyxLQUFLLFlBQVksTUFBTSxLQUFLLHFCQUFxQixXQUFXLE9BQU8sS0FBSyxPQUFPLENBQUMsRUFBRTtBQUFBLFVBQzNGO0FBQ0EsY0FBSSxPQUFPLFlBQVksWUFBWSxPQUFPLFFBQVEsWUFBWTtBQUM1RCxtQkFBTyxLQUFLLFlBQVksT0FBTyxPQUFPLFVBQVUsRUFBRTtBQUFBLFVBQ3BEO0FBQ0EsY0FBSSxPQUFPLFVBQVUsU0FBUyxRQUFRO0FBQ3BDLG1CQUFPLEtBQUssT0FBTyxVQUFVLGdCQUFnQix1QkFBdUIsT0FBTyxVQUFVLGFBQWEsS0FBSyxpQkFBaUI7QUFBQSxVQUMxSDtBQUNBLGdCQUFNLGdCQUFnQixPQUFPLEtBQUssT0FBTyxTQUFTLEVBQUU7QUFDcEQsaUJBQU8sS0FBSyxHQUFHLGFBQWEsWUFBWSxrQkFBa0IsSUFBSSxLQUFLLEdBQUcsRUFBRTtBQUN4RSxpQkFBTztBQUFBLFlBQ0wsTUFBTSxNQUFNO0FBQUEsWUFDWixRQUFRLE9BQU8sS0FBSyxJQUFJO0FBQUEsVUFDMUI7QUFBQSxRQUNGLFNBQVMsT0FBTztBQUNkLGlCQUFPO0FBQUEsWUFDTCxNQUFNLE1BQU07QUFBQSxZQUNaLFFBQVEsd0JBQXdCLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQztBQUFBLFVBQ3hGO0FBQUEsUUFDRjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLElBQUksT0FBc0IsU0FBeUIsVUFBOEIsV0FBMkM7QUFDaEksVUFBTSxZQUFZLEtBQUssaUJBQWlCLFNBQVM7QUFDakQsVUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXLFNBQVM7QUFDOUMsVUFBTSxhQUFhLE9BQU8sVUFBVSxNQUFNLFFBQVEsS0FBSyxPQUFPLFVBQVUsTUFBTSxhQUFhO0FBRTNGLFFBQUksYUFBYTtBQUNqQixRQUFJLFdBQStDO0FBRW5ELFFBQUksWUFBWTtBQUNkLFVBQUksV0FBVyxZQUFZO0FBQ3pCLG1CQUFXLEtBQUsseUJBQXlCLE1BQU0sVUFBVSxRQUFRLEtBQUssS0FBSyx5QkFBeUIsTUFBTSxlQUFlLFFBQVE7QUFBQSxNQUNuSSxPQUFPO0FBQ0wsbUJBQVc7QUFBQSxNQUNiO0FBQUEsSUFDRixPQUFPO0FBQ0wsaUJBQVcsS0FBSyx5QkFBeUIsTUFBTSxVQUFVLFFBQVEsS0FBSyxLQUFLLHlCQUF5QixNQUFNLGVBQWUsUUFBUTtBQUNqSSxtQkFBYTtBQUFBLElBQ2Y7QUFFQSxRQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsV0FBVyxDQUFDLFNBQVMsV0FBVztBQUN6RCxZQUFNLElBQUksTUFBTSxtQkFBbUIsU0FBUyx1QkFBdUIsTUFBTSxRQUFRLEdBQUc7QUFBQSxJQUN0RjtBQUVBLGNBQU0sd0JBQU0sV0FBVyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQzFDLFVBQU0sS0FBSyxlQUFlLE9BQU8sYUFBYSxXQUFXLFFBQVEsV0FBVyxRQUFRLFFBQVEsYUFBYSxTQUFTLFdBQVcsYUFBYSxTQUFTLGVBQWU7QUFDbEssVUFBTSxlQUFlLFFBQVEsS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxHQUFHLG1CQUFtQixTQUFTLFNBQVMsQ0FBQztBQUN2SCxVQUFNLG1CQUFlLG1CQUFLLFdBQVcsWUFBWTtBQUVqRCxRQUFJO0FBQ0YsZ0JBQU0sNEJBQVUsY0FBYyxNQUFNLFNBQVMsTUFBTTtBQUNuRCxVQUFJO0FBQ0osY0FBUSxPQUFPLFNBQVM7QUFBQSxRQUN0QixLQUFLO0FBQUEsUUFDTCxLQUFLO0FBQ0gsbUJBQVMsTUFBTSxLQUFLLGdCQUFnQixXQUFXLFdBQVcsUUFBUSxVQUFVLGNBQWMsU0FBUyxRQUFRO0FBQzNHO0FBQUEsUUFDRixLQUFLO0FBQ0gsbUJBQVMsTUFBTSxLQUFLLFFBQVEsV0FBVyxXQUFXLFFBQVEsVUFBVSxjQUFjLE9BQU87QUFDekY7QUFBQSxRQUNGLEtBQUs7QUFDSCxtQkFBUyxNQUFNLEtBQUssVUFBVSxXQUFXLFdBQVcsUUFBUSxPQUFPLFVBQVUsY0FBYyxjQUFjLE9BQU87QUFDaEg7QUFBQSxRQUNGLEtBQUs7QUFDSCxtQkFBUyxNQUFNLEtBQUssZ0JBQWdCLFdBQVcsV0FBVyxRQUFRLFVBQVUsY0FBYyxPQUFPO0FBQ2pHO0FBQUEsUUFDRjtBQUNFLGdCQUFNLElBQUksTUFBTSx3QkFBd0IsT0FBTyxPQUFPLEVBQUU7QUFBQSxNQUM1RDtBQUVBLFVBQUksWUFBWTtBQUNkLGNBQU0sY0FBYyxvQkFBb0IsTUFBTSxRQUFRLHlFQUF5RSxTQUFTLE9BQU87QUFDL0ksZUFBTyxVQUFVLE9BQU8sVUFBVSxHQUFHLE9BQU8sT0FBTztBQUFBLEVBQUssV0FBVyxLQUFLO0FBQUEsTUFDMUU7QUFDQSxVQUFJLE9BQU8sVUFBVSxTQUFTLFFBQVE7QUFDcEMsY0FBTSxlQUFlLG1DQUFtQyxPQUFPLFVBQVUsZ0JBQWdCLFFBQVEsT0FBTyxVQUFVLGFBQWEsS0FBSyxFQUFFO0FBQ3RJLGVBQU8sVUFBVSxPQUFPLFVBQVUsR0FBRyxPQUFPLE9BQU87QUFBQSxFQUFLLFlBQVksS0FBSztBQUFBLE1BQzNFO0FBQ0EsYUFBTztBQUFBLElBQ1QsVUFBRTtBQUNBLGdCQUFNLHFCQUFHLGNBQWMsRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQ3hDO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxXQUFXLFdBQW1CLFdBQW1CLFFBQTZDO0FBQ2xHLFVBQU0sWUFBWSxLQUFLLGlCQUFpQixTQUFTO0FBQ2pELFVBQU0sU0FBUyxNQUFNLEtBQUssV0FBVyxTQUFTO0FBQzlDLGNBQU0sd0JBQU0sV0FBVyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQzFDLFVBQU0sS0FBSyxlQUFlLE9BQU8sYUFBYSxXQUFXLFdBQVcsUUFBUSxhQUFhLFNBQVMsV0FBVyxhQUFhLFNBQVMsZUFBZTtBQUNsSixZQUFRLE9BQU8sU0FBUztBQUFBLE1BQ3RCLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPLEtBQUssV0FBVyxXQUFXLFdBQVcsUUFBUSxXQUFXLE1BQU07QUFBQSxNQUN4RSxLQUFLO0FBQ0gsZUFBTyxLQUFLLFVBQVUsV0FBVyxXQUFXLFFBQVEsV0FBVyxNQUFNO0FBQUEsTUFDdkUsS0FBSztBQUNILGVBQU8sS0FBSyxpQkFBaUIsV0FBVyxXQUFXLFFBQVEsS0FBSyxvQkFBb0IsU0FBUyxXQUFXLFdBQVcsUUFBUSxTQUFTLEdBQUcsV0FBVyxNQUFNO0FBQUEsTUFDMUosS0FBSztBQUNILGVBQU8sS0FBSztBQUFBLFVBQ1YsYUFBYSxTQUFTO0FBQUEsVUFDdEIsT0FBTyxTQUFTO0FBQUEsVUFDaEIsbUJBQW1CLE9BQU8sU0FBUyxXQUFXO0FBQUE7QUFBQSxRQUNoRDtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGdCQUNaLFdBQ0EsV0FDQSxRQUNBLFVBQ0EsY0FDQSxTQUNBLFVBQ3dCO0FBQ3hCLFVBQU0sUUFBUSxNQUFNLEtBQUssYUFBYSxXQUFXLFdBQVcsUUFBUSxTQUFTLFFBQVE7QUFDckYsVUFBTSxVQUFVLGlCQUFpQixTQUFTLFFBQVMsV0FBVyxVQUFVLFlBQVksQ0FBQztBQUNyRixRQUFJLENBQUMsUUFBUSxRQUFRO0FBQ25CLFlBQU0sSUFBSSxNQUFNLDZCQUE2QjtBQUFBLElBQy9DO0FBRUEsV0FBTyxNQUFNLFdBQVc7QUFBQSxNQUN0QixVQUFVLGFBQWEsU0FBUztBQUFBLE1BQ2hDLFlBQVksR0FBRyxhQUFhLE9BQU8sT0FBTyxDQUFDLElBQUksU0FBUztBQUFBLE1BQ3hELFlBQVksS0FBSyxrQkFBa0IsTUFBTTtBQUFBLE1BQ3pDLE1BQU07QUFBQSxRQUNKO0FBQUEsUUFDQTtBQUFBLFFBQ0EsR0FBSSxRQUFRLFNBQVMsT0FBTyxDQUFDLElBQUksSUFBSSxDQUFDO0FBQUEsUUFDdEM7QUFBQSxRQUNBLEdBQUcsU0FBUztBQUFBLFFBQ1o7QUFBQSxRQUNBO0FBQUEsUUFDQSxHQUFHLEtBQUssaUJBQWlCLE1BQU07QUFBQSxRQUMvQjtBQUFBLFFBQ0EsR0FBRztBQUFBLE1BQ0w7QUFBQSxNQUNBLGtCQUFrQjtBQUFBLE1BQ2xCLFdBQVcsUUFBUTtBQUFBLE1BQ25CLFFBQVEsUUFBUTtBQUFBLE1BQ2hCLE9BQU8sUUFBUTtBQUFBLElBQ2pCLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLFFBQ1osV0FDQSxXQUNBLFFBQ0EsVUFDQSxjQUNBLFNBQ3dCO0FBQ3hCLFVBQU0sT0FBTyxLQUFLLGtCQUFrQixNQUFNO0FBQzFDLFVBQU0sS0FBSyxtQkFBbUIsS0FBSyxjQUFjLFdBQVcsUUFBUSxXQUFXLFFBQVEsUUFBUSxhQUFhLFNBQVMsZUFBZSxRQUFRLFNBQVMsUUFBUTtBQUM3SixVQUFNLEtBQUssa0JBQWtCLFdBQVcsV0FBVyxNQUFNLFFBQVEsV0FBVyxRQUFRLE1BQU07QUFDMUYsVUFBTSxLQUFLLGVBQWUsS0FBSyxhQUFhLFdBQVcsUUFBUSxXQUFXLFFBQVEsUUFBUSxhQUFhLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUyxlQUFlO0FBRWhLLFFBQUk7QUFDRixZQUFNLGFBQWEsYUFBQUMsTUFBVSxLQUFLLEtBQUssaUJBQWlCLFlBQVk7QUFDcEUsWUFBTSxnQkFBZ0IsS0FBSyxtQkFBbUIsUUFBUSxTQUFTLFFBQVMsV0FBVyxVQUFVLFdBQVcsVUFBVSxDQUFDLENBQUM7QUFDcEgsVUFBSSxDQUFDLGNBQWMsS0FBSyxHQUFHO0FBQ3pCLGNBQU0sSUFBSSxNQUFNLHdCQUF3QjtBQUFBLE1BQzFDO0FBRUEsYUFBTyxNQUFNLFdBQVc7QUFBQSxRQUN0QixVQUFVLGFBQWEsU0FBUztBQUFBLFFBQ2hDLFlBQVksUUFBUSxTQUFTO0FBQUEsUUFDN0IsWUFBWSxLQUFLLGlCQUFpQjtBQUFBLFFBQ2xDLE1BQU07QUFBQSxVQUNKLEdBQUcsaUJBQWlCLEtBQUssV0FBVyxFQUFFO0FBQUEsVUFDdEMsS0FBSztBQUFBLFVBQ0wsTUFBTSxXQUFXLEtBQUssZUFBZSxDQUFDLE9BQU8sYUFBYTtBQUFBLFFBQzVEO0FBQUEsUUFDQSxrQkFBa0I7QUFBQSxRQUNsQixXQUFXLFFBQVE7QUFBQSxRQUNuQixRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsSUFDSCxVQUFFO0FBQ0EsWUFBTSxLQUFLLG1CQUFtQixLQUFLLGlCQUFpQixXQUFXLFFBQVEsV0FBVyxRQUFRLFFBQVEsYUFBYSxTQUFTLGtCQUFrQixRQUFRLFNBQVMsV0FBVztBQUN0SyxZQUFNLEtBQUssd0JBQXdCLFdBQVcsV0FBVyxNQUFNLFFBQVEsV0FBVyxRQUFRLE1BQU07QUFBQSxJQUNsRztBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsVUFDWixXQUNBLFdBQ0EsUUFDQSxPQUNBLFVBQ0EsY0FDQSxjQUNBLFNBQ3dCO0FBQ3hCLFVBQU0sVUFBVSxLQUFLLG1CQUFtQixRQUFRLFNBQVMsUUFBUyxXQUFXLFVBQVUsWUFBWSxDQUFDO0FBQ3BHLFVBQU0sU0FBUyxNQUFNLEtBQUs7QUFBQSxNQUN4QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxLQUFLLG9CQUFvQixPQUFPLFdBQVcsV0FBVyxRQUFRLFFBQVEsV0FBVztBQUFBLFFBQy9FLFVBQVUsTUFBTTtBQUFBLFFBQ2hCLGVBQWUsTUFBTTtBQUFBLFFBQ3JCLFVBQVU7QUFBQSxRQUNWLFVBQVU7QUFBQSxRQUNWO0FBQUEsUUFDQSxPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsTUFDRCxRQUFRO0FBQUEsTUFDUixRQUFRO0FBQUEsSUFDVjtBQUVBLFFBQUksT0FBTyxRQUFRLFVBQVU7QUFDM0IsWUFBTSxXQUFXLE1BQU0sS0FBSztBQUFBLFFBQzFCO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLEtBQUssb0JBQW9CLFlBQVksV0FBVyxXQUFXLFFBQVEsUUFBUSxXQUFXO0FBQUEsVUFDcEYsVUFBVSxNQUFNO0FBQUEsVUFDaEIsZUFBZSxNQUFNO0FBQUEsVUFDckIsVUFBVTtBQUFBLFVBQ1YsVUFBVTtBQUFBLFVBQ1Y7QUFBQSxVQUNBLE9BQU8sUUFBUTtBQUFBLFFBQ2pCLENBQUM7QUFBQSxRQUNELFFBQVE7QUFBQSxRQUNSLFFBQVE7QUFBQSxNQUNWO0FBQ0EsVUFBSSxDQUFDLFNBQVMsU0FBUztBQUNyQixlQUFPLFVBQVUsbUNBQW1DLFNBQVMsVUFBVSxTQUFTLFVBQVUsUUFBUSxTQUFTLFFBQVEsRUFBRTtBQUFBLE1BQ3ZIO0FBQUEsSUFDRjtBQUVBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLGdCQUNaLFdBQ0EsV0FDQSxRQUNBLFVBQ0EsY0FDQSxTQUN3QjtBQUN4QixVQUFNLGVBQWUsS0FBSyxtQkFBbUIsU0FBUztBQUN0RCxVQUFNLFVBQVUsS0FBSyxtQkFBbUIsUUFBUSxTQUFTLFFBQVMsV0FBVyxVQUFVLFlBQVksQ0FBQztBQUNwRyxRQUFJLENBQUMsUUFBUSxLQUFLLEdBQUc7QUFDbkIsWUFBTSxJQUFJLE1BQU0sdUJBQXVCO0FBQUEsSUFDekM7QUFFQSxVQUFNLGFBQWEsT0FBTyxLQUFLLGNBQWMsQ0FBQyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxJQUFJO0FBQzdFLFVBQU0sVUFBVSxDQUFDLFFBQVEsR0FBRyxZQUFZLE9BQU8sYUFBYSxXQUFXLEtBQUssS0FBSyxDQUFDLFFBQVEsT0FBTyxFQUFFO0FBQ25HLFFBQUksT0FBTyxPQUFPLEtBQUssR0FBRztBQUN4QixjQUFRLFFBQVEsTUFBTSxPQUFPLE1BQU0sS0FBSyxDQUFDO0FBQUEsSUFDM0M7QUFFQSxXQUFPLE1BQU0sV0FBVztBQUFBLE1BQ3RCLFVBQVUsYUFBYSxTQUFTO0FBQUEsTUFDaEMsWUFBWSxPQUFPLFNBQVM7QUFBQSxNQUM1QixZQUFZO0FBQUEsTUFDWixNQUFNO0FBQUEsTUFDTixrQkFBa0I7QUFBQSxNQUNsQixXQUFXLFFBQVE7QUFBQSxNQUNuQixRQUFRLFFBQVE7QUFBQSxNQUNoQixPQUFPLFFBQVE7QUFBQSxJQUNqQixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsbUJBQW1CLGFBQTZCO0FBQ3RELFVBQU0sUUFBUSxZQUFZLE1BQU0sb0JBQW9CO0FBQ3BELFFBQUksT0FBTztBQUNULFlBQU0sUUFBUSxNQUFNLENBQUMsRUFBRSxZQUFZO0FBQ25DLFlBQU0sT0FBTyxNQUFNLENBQUMsRUFBRSxRQUFRLE9BQU8sR0FBRztBQUN4QyxhQUFPLFFBQVEsS0FBSyxJQUFJLElBQUk7QUFBQSxJQUM5QjtBQUNBLFFBQUksWUFBWSxTQUFTLElBQUksR0FBRztBQUM5QixhQUFPLFlBQVksUUFBUSxPQUFPLEdBQUc7QUFBQSxJQUN2QztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLGFBQ1osV0FDQSxXQUNBLFFBQ0EsU0FDQSxVQUNpQjtBQUNqQixVQUFNLGlCQUFhLG1CQUFLLFdBQVcsWUFBWTtBQUMvQyxRQUFJLEtBQUMsc0JBQVcsVUFBVSxHQUFHO0FBQzNCLGFBQU8sT0FBTyxTQUFTO0FBQUEsSUFDekI7QUFFQSxVQUFNLFFBQVEsS0FBSyxrQkFBa0IsU0FBUztBQUM5QyxVQUFNLFdBQVcsR0FBRyxLQUFLLGtCQUFrQixNQUFNLENBQUMsSUFBSSxLQUFLO0FBQzNELFFBQUksS0FBSyxZQUFZLElBQUksUUFBUSxHQUFHO0FBQ2xDLGFBQU87QUFBQSxJQUNUO0FBRUEsVUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXLFdBQVcsV0FBVyxRQUFRLEtBQUssSUFBSSxRQUFRLFdBQVcsU0FBUyxrQkFBa0IsSUFBTyxHQUFHLFFBQVEsTUFBTTtBQUNsSixRQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLFlBQU0sSUFBSSxNQUFNLE9BQU8sVUFBVSxPQUFPLFVBQVUsR0FBRyxhQUFhLE9BQU8sT0FBTyxDQUFDLHFCQUFxQixTQUFTLEdBQUc7QUFBQSxJQUNwSDtBQUVBLFNBQUssWUFBWSxJQUFJLFFBQVE7QUFDN0IsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsV0FDWixXQUNBLFdBQ0EsUUFDQSxXQUNBLFFBQ3dCO0FBQ3hCLFVBQU0sUUFBUSxLQUFLLGtCQUFrQixTQUFTO0FBQzlDLFFBQUksS0FBQywwQkFBVyxtQkFBSyxXQUFXLFlBQVksQ0FBQyxHQUFHO0FBQzlDLGFBQU8sS0FBSztBQUFBLFFBQ1YsYUFBYSxTQUFTO0FBQUEsUUFDdEIsR0FBRyxhQUFhLE9BQU8sT0FBTyxDQUFDLElBQUksU0FBUztBQUFBLFFBQzVDLHlDQUF5QyxPQUFPLFNBQVMsZUFBZTtBQUFBO0FBQUEsTUFDMUU7QUFBQSxJQUNGO0FBQ0EsV0FBTyxXQUFXO0FBQUEsTUFDaEIsVUFBVSxhQUFhLFNBQVM7QUFBQSxNQUNoQyxZQUFZLEdBQUcsYUFBYSxPQUFPLE9BQU8sQ0FBQyxJQUFJLFNBQVM7QUFBQSxNQUN4RCxZQUFZLEtBQUssa0JBQWtCLE1BQU07QUFBQSxNQUN6QyxNQUFNLENBQUMsU0FBUyxNQUFNLE9BQU8sU0FBUztBQUFBLE1BQ3RDLGtCQUFrQjtBQUFBLE1BQ2xCO0FBQUEsTUFDQTtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsVUFBVSxXQUFtQixXQUFtQixRQUE2QixXQUFtQixRQUE2QztBQUN6SixVQUFNLE9BQU8sS0FBSyxrQkFBa0IsTUFBTTtBQUMxQyxRQUFJLENBQUMsS0FBSyxjQUFjLEtBQUssR0FBRztBQUM5QixhQUFPLEtBQUssc0JBQXNCLGFBQWEsU0FBUyxlQUFlLFFBQVEsU0FBUyxVQUFVLHFDQUFxQztBQUFBLElBQ3pJO0FBQ0EsV0FBTyxLQUFLLGVBQWUsS0FBSyxjQUFjLFdBQVcsV0FBVyxRQUFRLGFBQWEsU0FBUyxlQUFlLFFBQVEsU0FBUyxRQUFRO0FBQUEsRUFDNUk7QUFBQSxFQUVBLE1BQWMsV0FBVyxXQUFpRDtBQUN4RSxVQUFNLGlCQUFhLG1CQUFLLFdBQVcsYUFBYTtBQUNoRCxRQUFJO0FBQ0osUUFBSTtBQUNGLFlBQU0sS0FBSyxNQUFNLFVBQU0sMkJBQVMsWUFBWSxNQUFNLENBQUM7QUFBQSxJQUNyRCxTQUFTLE9BQU87QUFDZCxZQUFNLElBQUksTUFBTSxtQ0FBbUMsVUFBVSxLQUFLLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQyxFQUFFO0FBQUEsSUFDNUg7QUFFQSxRQUFJLENBQUMsT0FBTyxPQUFPLFFBQVEsWUFBWSxNQUFNLFFBQVEsR0FBRyxHQUFHO0FBQ3pELFlBQU0sSUFBSSxNQUFNLHFDQUFxQztBQUFBLElBQ3ZEO0FBRUEsVUFBTSxPQUFPO0FBV2IsVUFBTSxVQUFVLEtBQUssWUFBWSxLQUFLLE9BQU87QUFDN0MsUUFBSSxLQUFLLGNBQWMsUUFBUSxPQUFPLEtBQUssZUFBZSxVQUFVO0FBQ2xFLFlBQU0sSUFBSSxNQUFNLCtDQUErQztBQUFBLElBQ2pFO0FBQ0EsUUFBSSxLQUFLLFNBQVMsUUFBUSxPQUFPLEtBQUssVUFBVSxVQUFVO0FBQ3hELFlBQU0sSUFBSSxNQUFNLDBDQUEwQztBQUFBLElBQzVEO0FBQ0EsUUFBSSxDQUFDLEtBQUssYUFBYSxPQUFPLEtBQUssY0FBYyxZQUFZLE1BQU0sUUFBUSxLQUFLLFNBQVMsR0FBRztBQUMxRixZQUFNLElBQUksTUFBTSwrQ0FBK0M7QUFBQSxJQUNqRTtBQUVBLFVBQU0sWUFBeUQsQ0FBQztBQUNoRSxlQUFXLENBQUMsVUFBVSxLQUFLLEtBQUssT0FBTyxRQUFRLEtBQUssU0FBb0MsR0FBRztBQUN6RixVQUFJLENBQUMsU0FBUyxPQUFPLFVBQVUsWUFBWSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQy9ELGNBQU0sSUFBSSxNQUFNLHNCQUFzQixRQUFRLHFCQUFxQjtBQUFBLE1BQ3JFO0FBQ0EsWUFBTSxpQkFBaUI7QUFDdkIsWUFBTSxhQUFhLGVBQWUsZUFBZTtBQUVqRCxVQUFJLENBQUMsZUFBZSxPQUFPLGVBQWUsWUFBWSxZQUFZLENBQUMsZUFBZSxRQUFRLEtBQUssSUFBSTtBQUNqRyxjQUFNLElBQUksTUFBTSxzQkFBc0IsUUFBUSxxQ0FBcUM7QUFBQSxNQUNyRjtBQUVBLGdCQUFVLFFBQVEsSUFBSTtBQUFBLFFBQ3BCLFNBQVMsT0FBTyxlQUFlLFlBQVksV0FBVyxlQUFlLFVBQVU7QUFBQSxRQUMvRSxXQUFXLE9BQU8sZUFBZSxjQUFjLFdBQVcsZUFBZSxZQUFZLGFBQWEsU0FBWSxJQUFJLFFBQVE7QUFBQSxRQUMxSCxZQUFZLGNBQWM7QUFBQSxNQUM1QjtBQUFBLElBQ0Y7QUFFQSxXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0EsWUFBWSxPQUFPLEtBQUssZUFBZSxZQUFZLEtBQUssV0FBVyxLQUFLLElBQUksS0FBSyxXQUFXLEtBQUssSUFBSTtBQUFBLE1BQ3JHLE9BQU8sT0FBTyxLQUFLLFVBQVUsV0FBVyxLQUFLLFFBQVE7QUFBQSxNQUNyRCxXQUFXLEtBQUssb0JBQW9CLEtBQUssU0FBUztBQUFBLE1BQ2xELEtBQUssS0FBSyxjQUFjLEtBQUssR0FBRztBQUFBLE1BQ2hDLGFBQWEsS0FBSyxnQkFBZ0IsS0FBSyxhQUFhLDhCQUE4QjtBQUFBLE1BQ2xGLE1BQU0sS0FBSyxlQUFlLEtBQUssSUFBSTtBQUFBLE1BQ25DLFFBQVEsS0FBSyxpQkFBaUIsS0FBSyxNQUFNO0FBQUEsTUFDekM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsWUFBWSxPQUFzQztBQUN4RCxRQUFJLFNBQVMsTUFBTTtBQUNqQixhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUksVUFBVSxZQUFZLFVBQVUsWUFBWSxVQUFVLFVBQVUsVUFBVSxZQUFZLFVBQVUsT0FBTztBQUN6RyxhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sSUFBSSxNQUFNLHdFQUF3RTtBQUFBLEVBQzFGO0FBQUEsRUFFUSxjQUFjLE9BQTJDO0FBQy9ELFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSx5Q0FBeUM7QUFBQSxJQUMzRDtBQUNBLFVBQU0sT0FBTztBQUNiLFdBQU87QUFBQSxNQUNMLGFBQWEsS0FBSyxnQkFBZ0I7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFBQSxFQUVRLG9CQUFvQixPQUE4QztBQUN4RSxRQUFJLFNBQVMsTUFBTTtBQUNqQixhQUFPLEVBQUUsTUFBTSxVQUFVO0FBQUEsSUFDM0I7QUFDQSxRQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQUksVUFBVSxhQUFhLFVBQVUsUUFBUTtBQUMzQyxlQUFPLEVBQUUsTUFBTSxNQUFNO0FBQUEsTUFDdkI7QUFDQSxZQUFNLElBQUksTUFBTSxpRUFBaUU7QUFBQSxJQUNuRjtBQUNBLFFBQUksQ0FBQyxTQUFTLE9BQU8sVUFBVSxZQUFZLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDL0QsWUFBTSxJQUFJLE1BQU0sK0NBQStDO0FBQUEsSUFDakU7QUFDQSxVQUFNLE9BQU87QUFDYixVQUFNLE9BQU8sS0FBSyxRQUFRLE9BQU8sWUFBWSxLQUFLO0FBQ2xELFFBQUksU0FBUyxhQUFhLFNBQVMsUUFBUTtBQUN6QyxZQUFNLElBQUksTUFBTSwwREFBMEQ7QUFBQSxJQUM1RTtBQUNBLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxlQUFlLGVBQWUsS0FBSyxhQUFhO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBQUEsRUFFUSxlQUFlLE9BQTRDO0FBQ2pFLFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSwwQ0FBMEM7QUFBQSxJQUM1RDtBQUNBLFVBQU0sT0FBTztBQUNiLFFBQUksT0FBTyxLQUFLLGNBQWMsWUFBWSxDQUFDLEtBQUssVUFBVSxLQUFLLEdBQUc7QUFDaEUsWUFBTSxJQUFJLE1BQU0sbURBQW1EO0FBQUEsSUFDckU7QUFDQSxRQUFJLE9BQU8sS0FBSyxvQkFBb0IsWUFBWSxDQUFDLEtBQUssZ0JBQWdCLEtBQUssR0FBRztBQUM1RSxZQUFNLElBQUksTUFBTSx5REFBeUQ7QUFBQSxJQUMzRTtBQUVBLFdBQU87QUFBQSxNQUNMLFdBQVcsS0FBSyxVQUFVLEtBQUs7QUFBQSxNQUMvQixpQkFBaUIsS0FBSyxnQkFBZ0IsS0FBSztBQUFBLE1BQzNDLGVBQWUsZUFBZSxLQUFLLGFBQWE7QUFBQSxNQUNoRCxTQUFTLGVBQWUsS0FBSyxPQUFPO0FBQUEsTUFDcEMsY0FBYyxlQUFlLEtBQUssWUFBWTtBQUFBLE1BQzlDLGNBQWMsZUFBZSxLQUFLLFlBQVk7QUFBQSxNQUM5QyxpQkFBaUIsZUFBZSxLQUFLLGVBQWU7QUFBQSxNQUNwRCxhQUFhLEtBQUssZ0JBQWdCLEtBQUssYUFBYSxtQ0FBbUM7QUFBQSxNQUN2RixTQUFTLEtBQUssc0JBQXNCLEtBQUssT0FBTztBQUFBLElBQ2xEO0FBQUEsRUFDRjtBQUFBLEVBRVEsc0JBQXNCLE9BQW1EO0FBQy9FLFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSxrREFBa0Q7QUFBQSxJQUNwRTtBQUNBLFVBQU0sT0FBTztBQUNiLFdBQU87QUFBQSxNQUNMLFNBQVMsS0FBSyxZQUFZO0FBQUEsTUFDMUIsWUFBWSxlQUFlLEtBQUssVUFBVTtBQUFBLE1BQzFDLE1BQU0sZUFBZSxLQUFLLElBQUk7QUFBQSxNQUM5QixPQUFPLGVBQWUsS0FBSyxLQUFLO0FBQUEsTUFDaEMsYUFBYSxlQUFlLEtBQUssV0FBVztBQUFBLE1BQzVDLFNBQVMsZUFBZSxLQUFLLE9BQU87QUFBQSxNQUNwQyxTQUFTLGVBQWUsS0FBSyxPQUFPO0FBQUEsTUFDcEMsb0JBQW9CLHdCQUF3QixLQUFLLG9CQUFvQixrREFBa0Q7QUFBQSxNQUN2SCxxQkFBcUIsd0JBQXdCLEtBQUsscUJBQXFCLG1EQUFtRDtBQUFBLE1BQzFILGFBQWEsMkJBQTJCLEtBQUssYUFBYSwyQ0FBMkM7QUFBQSxNQUNyRyxpQkFBaUIsZUFBZSxLQUFLLGVBQWU7QUFBQSxNQUNwRCxtQkFBbUIsd0JBQXdCLEtBQUssbUJBQW1CLGlEQUFpRDtBQUFBLE1BQ3BILFlBQVksZUFBZSxLQUFLLFlBQVksMENBQTBDO0FBQUEsTUFDdEYsU0FBUyxPQUFPLEtBQUssWUFBWSxZQUFZLEtBQUssVUFBVTtBQUFBLElBQzlEO0FBQUEsRUFDRjtBQUFBLEVBRVEsaUJBQWlCLE9BQXFEO0FBQzVFLFFBQUksU0FBUyxNQUFNO0FBQ2pCLGFBQU87QUFBQSxJQUNUO0FBQ0EsUUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLFlBQVksTUFBTSxRQUFRLEtBQUssR0FBRztBQUMvRCxZQUFNLElBQUksTUFBTSw0Q0FBNEM7QUFBQSxJQUM5RDtBQUNBLFVBQU0sT0FBTztBQUNiLFFBQUksT0FBTyxLQUFLLGVBQWUsWUFBWSxDQUFDLEtBQUssV0FBVyxLQUFLLEdBQUc7QUFDbEUsWUFBTSxJQUFJLE1BQU0sc0RBQXNEO0FBQUEsSUFDeEU7QUFDQSxXQUFPO0FBQUEsTUFDTCxZQUFZLEtBQUssV0FBVyxLQUFLO0FBQUEsTUFDakMsTUFBTSxlQUFlLEtBQUssSUFBSTtBQUFBLE1BQzlCLE9BQU8sZUFBZSxLQUFLLEtBQUs7QUFBQSxNQUNoQyxrQkFBa0IsZUFBZSxLQUFLLGdCQUFnQjtBQUFBLE1BQ3RELFVBQVUsZUFBZSxLQUFLLFFBQVE7QUFBQSxNQUN0QyxhQUFhLEtBQUssZ0JBQWdCLEtBQUssYUFBYSxxQ0FBcUM7QUFBQSxJQUMzRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGdCQUFnQixPQUFnQixPQUFtRDtBQUN6RixRQUFJLFNBQVMsTUFBTTtBQUNqQixhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUksQ0FBQyxTQUFTLE9BQU8sVUFBVSxZQUFZLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDL0QsWUFBTSxJQUFJLE1BQU0sR0FBRyxLQUFLLHFCQUFxQjtBQUFBLElBQy9DO0FBQ0EsVUFBTSxPQUFPO0FBQ2IsUUFBSSxPQUFPLEtBQUssWUFBWSxZQUFZLENBQUMsS0FBSyxRQUFRLEtBQUssR0FBRztBQUM1RCxZQUFNLElBQUksTUFBTSxHQUFHLEtBQUssNEJBQTRCO0FBQUEsSUFDdEQ7QUFDQSxXQUFPO0FBQUEsTUFDTCxTQUFTLEtBQUssUUFBUSxLQUFLO0FBQUEsTUFDM0Isa0JBQWtCLGVBQWUsS0FBSyxvQkFBb0IsS0FBSyxxQkFBcUIsS0FBSyxtQkFBbUIsS0FBSyxLQUFLLGlCQUFpQjtBQUFBLE1BQ3ZJLGtCQUFrQixlQUFlLEtBQUssb0JBQW9CLEtBQUsscUJBQXFCLEtBQUssbUJBQW1CLENBQUM7QUFBQSxJQUMvRztBQUFBLEVBQ0Y7QUFBQSxFQUVRLGtCQUFrQixRQUE2QztBQUNyRSxRQUFJLENBQUMsT0FBTyxNQUFNO0FBQ2hCLFlBQU0sSUFBSSxNQUFNLDZDQUE2QztBQUFBLElBQy9EO0FBQ0EsV0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFBQSxFQUVRLG9CQUFvQixRQUFzRDtBQUNoRixRQUFJLENBQUMsT0FBTyxRQUFRO0FBQ2xCLFlBQU0sSUFBSSxNQUFNLGlEQUFpRDtBQUFBLElBQ25FO0FBQ0EsV0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFBQSxFQUVRLGtCQUFrQixRQUFxQztBQUM3RCxRQUFJLE9BQU8sWUFBWSxLQUFLLEdBQUc7QUFDN0IsYUFBTyxPQUFPLFdBQVcsS0FBSztBQUFBLElBQ2hDO0FBQ0EsV0FBTyxPQUFPLFlBQVksV0FBVyxXQUFXO0FBQUEsRUFDbEQ7QUFBQSxFQUVRLGlCQUFpQixRQUF1QztBQUM5RCxXQUFPLE9BQU8sVUFBVSxTQUFTLFNBQVMsQ0FBQyxVQUFVLE1BQU0sSUFBSSxDQUFDO0FBQUEsRUFDbEU7QUFBQSxFQUVRLG1CQUFtQixRQUE2QixTQUF5QjtBQUMvRSxVQUFNLFNBQVMsT0FBTyxVQUFVLFNBQVMsU0FBUyxPQUFPLFVBQVUsZUFBZSxLQUFLLElBQUk7QUFDM0YsV0FBTyxTQUFTLEdBQUcsTUFBTSxJQUFJLE9BQU8sS0FBSztBQUFBLEVBQzNDO0FBQUEsRUFFQSxNQUFjLGVBQ1osYUFDQSxrQkFDQSxXQUNBLFFBQ0EsVUFDQSxZQUNlO0FBQ2YsUUFBSSxDQUFDLGFBQWE7QUFDaEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLE1BQU0sS0FBSyxlQUFlLFlBQVksU0FBUyxrQkFBa0IsV0FBVyxRQUFRLFVBQVUsVUFBVTtBQUN2SCxVQUFNLGlCQUFpQixHQUFHLE9BQU8sTUFBTTtBQUFBLEVBQUssT0FBTyxNQUFNO0FBQ3pELFFBQUksQ0FBQyxPQUFPLFNBQVM7QUFDbkIsWUFBTSxJQUFJLE1BQU0sR0FBRyxVQUFVLFlBQVksT0FBTyxVQUFVLE9BQU8sVUFBVSxRQUFRLE9BQU8sUUFBUSxFQUFFLEVBQUU7QUFBQSxJQUN4RztBQUNBLFFBQUksWUFBWSxvQkFBb0IsZUFBZSxTQUFTLFlBQVksZ0JBQWdCLEdBQUc7QUFDekYsWUFBTSxJQUFJLE1BQU0sR0FBRyxVQUFVLGdDQUFnQyxZQUFZLGdCQUFnQixFQUFFO0FBQUEsSUFDN0Y7QUFDQSxRQUFJLFlBQVksb0JBQW9CLENBQUMsZUFBZSxTQUFTLFlBQVksZ0JBQWdCLEdBQUc7QUFDMUYsWUFBTSxJQUFJLE1BQU0sR0FBRyxVQUFVLHNDQUFzQyxZQUFZLGdCQUFnQixFQUFFO0FBQUEsSUFDbkc7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLG1CQUNaLFNBQ0Esa0JBQ0EsV0FDQSxRQUNBLFVBQ0EsWUFDZTtBQUNmLFFBQUksQ0FBQyxTQUFTLEtBQUssR0FBRztBQUNwQjtBQUFBLElBQ0Y7QUFDQSxVQUFNLFNBQVMsTUFBTSxLQUFLLGVBQWUsU0FBUyxrQkFBa0IsV0FBVyxRQUFRLFVBQVUsVUFBVTtBQUMzRyxRQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLFlBQU0sSUFBSSxNQUFNLEdBQUcsVUFBVSxZQUFZLE9BQU8sVUFBVSxPQUFPLFVBQVUsUUFBUSxPQUFPLFFBQVEsRUFBRSxFQUFFO0FBQUEsSUFDeEc7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQ1osU0FDQSxrQkFDQSxXQUNBLFFBQ0EsVUFDQSxZQUN3QjtBQUN4QixVQUFNLFFBQVEsaUJBQWlCLE9BQU87QUFDdEMsUUFBSSxDQUFDLE1BQU0sUUFBUTtBQUNqQixZQUFNLElBQUksTUFBTSxHQUFHLFVBQVUsb0JBQW9CO0FBQUEsSUFDbkQ7QUFDQSxXQUFPLFdBQVc7QUFBQSxNQUNoQjtBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVksTUFBTSxDQUFDO0FBQUEsTUFDbkIsTUFBTSxNQUFNLE1BQU0sQ0FBQztBQUFBLE1BQ25CO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLGtCQUFrQixXQUFtQixXQUFtQixNQUFzQixXQUFtQixRQUFvQztBQUNqSixVQUFNLFVBQVUsS0FBSztBQUNyQixRQUFJLENBQUMsU0FBUyxTQUFTO0FBQ3JCO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxLQUFLLHFCQUFxQixXQUFXLFFBQVEsV0FBVyxnQkFBZ0I7QUFDeEYsVUFBTSxjQUFjLE1BQU0sS0FBSyxZQUFZLE9BQU87QUFDbEQsUUFBSSxlQUFlLEtBQUssaUJBQWlCLFdBQVcsR0FBRztBQUNyRCxZQUFNLEtBQUssNEJBQTRCLFdBQVcsV0FBVyxNQUFNLFdBQVcsTUFBTTtBQUNwRjtBQUFBLElBQ0Y7QUFFQSxRQUFJLGFBQWE7QUFDZixnQkFBTSxxQkFBRyxTQUFTLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUNuQztBQUVBLFVBQU0sYUFBYSxRQUFRLGNBQWM7QUFDekMsVUFBTSxPQUFPLEtBQUsscUJBQXFCLFdBQVcsT0FBTztBQUN6RCxRQUFJLENBQUMsS0FBSyxRQUFRO0FBQ2hCLFlBQU0sSUFBSSxNQUFNLG9CQUFvQixTQUFTLGlEQUFpRDtBQUFBLElBQ2hHO0FBRUEsVUFBTSxVQUFVLFFBQVEsVUFBVSxLQUFLLHFCQUFxQixXQUFXLFFBQVEsT0FBTyxJQUFJO0FBQzFGLFVBQU0sUUFBUSxjQUFVLG9CQUFTLFNBQVMsR0FBRyxJQUFJO0FBQ2pELFFBQUk7QUFDRixZQUFNLFlBQVEsNkJBQU0sWUFBWSxNQUFNO0FBQUEsUUFDcEMsS0FBSztBQUFBLFFBQ0wsVUFBVTtBQUFBLFFBQ1YsT0FBTyxDQUFDLFVBQVUsU0FBUyxVQUFVLFNBQVMsUUFBUTtBQUFBLE1BQ3hELENBQUM7QUFFRCxZQUFNLEdBQUcsU0FBUyxNQUFNLE1BQVM7QUFDakMsWUFBTSxNQUFNO0FBRVosVUFBSSxDQUFDLE1BQU0sS0FBSztBQUNkLGNBQU0sSUFBSSxNQUFNLG9CQUFvQixTQUFTLCtCQUErQjtBQUFBLE1BQzlFO0FBRUEsZ0JBQU0sNEJBQVUsU0FBUyxHQUFHLE1BQU0sR0FBRztBQUFBLEdBQU0sTUFBTTtBQUNqRCxZQUFNLEtBQUssNEJBQTRCLFdBQVcsV0FBVyxNQUFNLFdBQVcsTUFBTTtBQUFBLElBQ3RGLFVBQUU7QUFDQSxVQUFJLFNBQVMsTUFBTTtBQUNqQixpQ0FBVSxLQUFLO0FBQUEsTUFDakI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEscUJBQXFCLFdBQW1CLFNBQTBDO0FBQ3hGLFVBQU0sT0FBTyxpQkFBaUIsUUFBUSxRQUFRLEVBQUU7QUFDaEQsUUFBSSxRQUFRLE9BQU87QUFDakIsWUFBTSxZQUFZLEtBQUsscUJBQXFCLFdBQVcsUUFBUSxLQUFLO0FBQ3BFLFdBQUssS0FBSyxVQUFVLFFBQVEsU0FBUyxxQkFBcUIsUUFBUSxlQUFlLE9BQU8sRUFBRTtBQUFBLElBQzVGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsNEJBQ1osV0FDQSxXQUNBLE1BQ0EsV0FDQSxRQUNlO0FBQ2YsVUFBTSxVQUFVLEtBQUs7QUFDckIsUUFBSSxDQUFDLFNBQVMsU0FBUztBQUNyQjtBQUFBLElBQ0Y7QUFFQSxRQUFJLENBQUMsS0FBSyxhQUFhO0FBQ3JCLFlBQU0sZ0JBQWdCLFFBQVEsZUFBZSxHQUFHLE1BQU07QUFDdEQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUFVLEtBQUssSUFBSSxRQUFRLHNCQUFzQixLQUFRLEtBQUssSUFBSSxXQUFXLENBQUMsQ0FBQztBQUNyRixVQUFNLFdBQVcsUUFBUSx1QkFBdUI7QUFDaEQsVUFBTSxZQUFZLEtBQUssSUFBSTtBQUMzQixRQUFJLFlBQVk7QUFFaEIsV0FBTyxLQUFLLElBQUksSUFBSSxhQUFhLFNBQVM7QUFDeEMsVUFBSSxPQUFPLFNBQVM7QUFDbEIsY0FBTSxJQUFJLE1BQU0sUUFBUSxTQUFTLDRCQUE0QjtBQUFBLE1BQy9EO0FBRUEsVUFBSTtBQUNGLGNBQU0sS0FBSyxlQUFlLEtBQUssYUFBYSxXQUFXLEtBQUssSUFBSSxVQUFVLE9BQU8sR0FBRyxRQUFRLGFBQWEsU0FBUyxlQUFlLFFBQVEsU0FBUyxrQkFBa0I7QUFDcEs7QUFBQSxNQUNGLFNBQVMsT0FBTztBQUNkLG9CQUFZLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFBQSxNQUNuRTtBQUVBLFlBQU0sZ0JBQWdCLFVBQVUsTUFBTTtBQUFBLElBQ3hDO0FBRUEsVUFBTSxJQUFJLE1BQU0sUUFBUSxTQUFTLGdDQUFnQyxPQUFPLE1BQU0sWUFBWSxLQUFLLFNBQVMsS0FBSyxHQUFHLEVBQUU7QUFBQSxFQUNwSDtBQUFBLEVBRUEsTUFBYyx3QkFBd0IsV0FBbUIsV0FBbUIsTUFBc0IsV0FBbUIsUUFBb0M7QUFDdkosVUFBTSxVQUFVLEtBQUs7QUFDckIsUUFBSSxDQUFDLFNBQVMsV0FBVyxRQUFRLFlBQVksT0FBTztBQUNsRDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsS0FBSyxxQkFBcUIsV0FBVyxRQUFRLFdBQVcsZ0JBQWdCO0FBQ3hGLFVBQU0sTUFBTSxNQUFNLEtBQUssWUFBWSxPQUFPO0FBQzFDLFFBQUksQ0FBQyxLQUFLO0FBQ1I7QUFBQSxJQUNGO0FBRUEsUUFBSSxRQUFRLGlCQUFpQjtBQUMzQixZQUFNLEtBQUs7QUFBQSxRQUNULFFBQVE7QUFBQSxRQUNSO0FBQUEsUUFDQSxLQUFLLElBQUksUUFBUSxxQkFBcUIsV0FBVyxTQUFTO0FBQUEsUUFDMUQ7QUFBQSxRQUNBLGFBQWEsU0FBUztBQUFBLFFBQ3RCLFFBQVEsU0FBUztBQUFBLE1BQ25CO0FBQUEsSUFDRixXQUFXLEtBQUssaUJBQWlCLEdBQUcsR0FBRztBQUNyQyxjQUFRLEtBQUssS0FBSyxRQUFRLGNBQWMsU0FBUztBQUFBLElBQ25EO0FBRUEsVUFBTSxVQUFVLE1BQU0sS0FBSyxtQkFBbUIsS0FBSyxRQUFRLHFCQUFxQixLQUFRLE1BQU07QUFDOUYsUUFBSSxDQUFDLFdBQVcsS0FBSyxpQkFBaUIsR0FBRyxHQUFHO0FBQzFDLGNBQVEsS0FBSyxLQUFLLFNBQVM7QUFDM0IsWUFBTSxLQUFLLG1CQUFtQixLQUFLLEtBQU8sTUFBTTtBQUFBLElBQ2xEO0FBRUEsY0FBTSxxQkFBRyxTQUFTLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxFQUNuQztBQUFBLEVBRUEsTUFBYyxxQkFBcUIsV0FBbUIsU0FBaUQ7QUFDckcsVUFBTSxVQUFVLEtBQUsscUJBQXFCLFdBQVcsUUFBUSxXQUFXLGdCQUFnQjtBQUN4RixVQUFNLE1BQU0sTUFBTSxLQUFLLFlBQVksT0FBTztBQUMxQyxRQUFJLENBQUMsS0FBSztBQUNSLGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTyxLQUFLLGlCQUFpQixHQUFHLElBQUksZUFBZSxHQUFHLEtBQUssYUFBYSxHQUFHO0FBQUEsRUFDN0U7QUFBQSxFQUVBLE1BQWMsWUFBWSxTQUF5QztBQUNqRSxRQUFJO0FBQ0YsWUFBTSxTQUFTLFVBQU0sMkJBQVMsU0FBUyxNQUFNLEdBQUcsS0FBSztBQUNyRCxZQUFNLE1BQU0sT0FBTyxTQUFTLE9BQU8sRUFBRTtBQUNyQyxhQUFPLE9BQU8sVUFBVSxHQUFHLEtBQUssTUFBTSxJQUFJLE1BQU07QUFBQSxJQUNsRCxRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUEsRUFFUSxpQkFBaUIsS0FBc0I7QUFDN0MsUUFBSTtBQUNGLGNBQVEsS0FBSyxLQUFLLENBQUM7QUFDbkIsYUFBTztBQUFBLElBQ1QsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxtQkFBbUIsS0FBYSxXQUFtQixRQUF1QztBQUN0RyxVQUFNLFlBQVksS0FBSyxJQUFJO0FBQzNCLFdBQU8sS0FBSyxJQUFJLElBQUksYUFBYSxXQUFXO0FBQzFDLFVBQUksT0FBTyxTQUFTO0FBQ2xCLGVBQU87QUFBQSxNQUNUO0FBQ0EsVUFBSSxDQUFDLEtBQUssaUJBQWlCLEdBQUcsR0FBRztBQUMvQixlQUFPO0FBQUEsTUFDVDtBQUNBLFlBQU0sZ0JBQWdCLEtBQUssTUFBTTtBQUFBLElBQ25DO0FBQ0EsV0FBTyxDQUFDLEtBQUssaUJBQWlCLEdBQUc7QUFBQSxFQUNuQztBQUFBLEVBRUEsTUFBYyxpQkFDWixXQUNBLFdBQ0EsUUFDQSxTQUNBLFdBQ0EsUUFDd0I7QUFDeEIsVUFBTSxTQUFTLEtBQUssb0JBQW9CLE1BQU07QUFDOUMsVUFBTSxLQUFLLGVBQWUsT0FBTyxhQUFhLFdBQVcsV0FBVyxRQUFRLGFBQWEsU0FBUyxrQkFBa0IsVUFBVSxTQUFTLGVBQWU7QUFFdEosVUFBTSxrQkFBa0IsV0FBVyxLQUFLLElBQUksQ0FBQyxJQUFJLEtBQUssT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQ3BGLFVBQU0sa0JBQWMsbUJBQUssV0FBVyxlQUFlO0FBQ25ELFFBQUk7QUFDRixnQkFBTSw0QkFBVSxhQUFhLEdBQUcsS0FBSyxVQUFVLFNBQVMsTUFBTSxDQUFDLENBQUM7QUFBQSxHQUFNLE1BQU07QUFDNUUsWUFBTSxPQUFPLGlCQUFpQixPQUFPLFFBQVEsV0FBVyxFQUFFO0FBQUEsUUFBSSxDQUFDLFFBQzdELElBQ0csV0FBVyxhQUFhLFdBQVcsRUFDbkMsV0FBVyxXQUFXLFNBQVMsRUFDL0IsV0FBVyxlQUFlLFNBQVM7QUFBQSxNQUN4QztBQUNBLGFBQU8sTUFBTSxXQUFXO0FBQUEsUUFDdEIsVUFBVSxhQUFhLFNBQVMsV0FBVyxRQUFRLE1BQU07QUFBQSxRQUN6RCxZQUFZLFVBQVUsU0FBUyxJQUFJLFFBQVEsTUFBTTtBQUFBLFFBQ2pELFlBQVksT0FBTztBQUFBLFFBQ25CO0FBQUEsUUFDQSxrQkFBa0I7QUFBQSxRQUNsQjtBQUFBLFFBQ0E7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNILFVBQUU7QUFDQSxnQkFBTSxxQkFBRyxhQUFhLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUN2QztBQUFBLEVBQ0Y7QUFBQSxFQUVRLG9CQUNOLFFBQ0EsV0FDQSxXQUNBLFFBQ0EsV0FDQSxRQUEyQyxDQUFDLEdBQ2xCO0FBQzFCLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBLFNBQVMsT0FBTztBQUFBLE1BQ2hCLE9BQU8sT0FBTztBQUFBLE1BQ2QsT0FBTyxPQUFPLFFBQVE7QUFBQSxNQUN0QixrQkFBa0IsT0FBTyxRQUFRO0FBQUEsTUFDakMsVUFBVSxPQUFPLFFBQVE7QUFBQSxNQUN6QjtBQUFBLE1BQ0EsUUFBUTtBQUFBLFFBQ04sWUFBWSxPQUFPO0FBQUEsUUFDbkIsUUFBUSxPQUFPO0FBQUEsUUFDZixNQUFNLE9BQU87QUFBQSxRQUNiLGFBQWEsT0FBTztBQUFBLFFBQ3BCLFdBQVcsT0FBTztBQUFBLE1BQ3BCO0FBQUEsTUFDQSxHQUFHO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLHNCQUFzQixVQUFrQixZQUFvQixRQUFnQixVQUFVLE1BQXFCO0FBQ2pILFVBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUNuQyxXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFdBQVc7QUFBQSxNQUNYLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxNQUNaLFVBQVUsVUFBVSxJQUFJO0FBQUEsTUFDeEI7QUFBQSxNQUNBLFFBQVE7QUFBQSxNQUNSO0FBQUEsTUFDQSxVQUFVO0FBQUEsTUFDVixXQUFXO0FBQUEsSUFDYjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLG9CQUE0QjtBQUNsQyxVQUFNLGtCQUFtQixLQUFLLElBQUksTUFBTSxRQUFrQyxZQUFZO0FBQ3RGLGVBQU8sYUFBQUMsZUFBZ0IsbUJBQUssaUJBQWlCLEtBQUssV0FBVyxZQUFZLENBQUM7QUFBQSxFQUM1RTtBQUFBLEVBRVEsaUJBQWlCLFdBQTJCO0FBQ2xELFVBQU0sZUFBVyx1QkFBUyxTQUFTO0FBQ25DLFFBQUksQ0FBQyxZQUFZLGFBQWEsV0FBVztBQUN2QyxZQUFNLElBQUksTUFBTSxpQ0FBaUMsU0FBUyxFQUFFO0FBQUEsSUFDOUQ7QUFDQSxlQUFPLGFBQUFBLGVBQWdCLG1CQUFLLEtBQUssa0JBQWtCLEdBQUcsUUFBUSxDQUFDO0FBQUEsRUFDakU7QUFBQSxFQUVRLHFCQUFxQixXQUFtQixVQUEwQjtBQUN4RSxVQUFNLGVBQVcsYUFBQUEsZUFBZ0IsbUJBQUssV0FBVyxRQUFRLENBQUM7QUFDMUQsVUFBTSwwQkFBc0IsYUFBQUEsV0FBZ0IsU0FBUztBQUNyRCxVQUFNLGdCQUFnQixTQUFTLFFBQVEsT0FBTyxHQUFHO0FBQ2pELFVBQU0saUJBQWlCLG9CQUFvQixRQUFRLE9BQU8sR0FBRztBQUM3RCxRQUFJLGtCQUFrQixrQkFBa0IsQ0FBQyxjQUFjLFdBQVcsR0FBRyxjQUFjLEdBQUcsR0FBRztBQUN2RixZQUFNLElBQUksTUFBTSxzREFBc0QsUUFBUSxFQUFFO0FBQUEsSUFDbEY7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRVEsa0JBQWtCLFdBQTJCO0FBQ25ELFdBQU8sa0JBQWtCLFVBQVUsWUFBWSxFQUFFLFFBQVEsaUJBQWlCLEdBQUcsQ0FBQztBQUFBLEVBQ2hGO0FBQUEsRUFFTyx5QkFBeUIsUUFBZ0IsVUFBa0U7QUFDaEgsUUFBSSxDQUFDLE9BQVEsUUFBTztBQUNwQixVQUFNLGFBQWEsT0FBTyxZQUFZLEVBQUUsS0FBSztBQUc3QyxVQUFNLFNBQVMsMkJBQTJCLFVBQVUsVUFBVTtBQUM5RCxRQUFJLFFBQVE7QUFDVixhQUFPO0FBQUEsUUFDTCxTQUFTLEdBQUcsT0FBTyxVQUFVLElBQUksT0FBTyxJQUFJLEdBQUcsS0FBSztBQUFBLFFBQ3BELFdBQVcsT0FBTyxhQUFhO0FBQUEsTUFDakM7QUFBQSxJQUNGO0FBR0EsWUFBUSxZQUFZO0FBQUEsTUFDbEIsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGlCQUFpQixLQUFLLEtBQUssU0FBUztBQUFBLFVBQ3pELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZUFBZSxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3BELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsK0JBQStCLEtBQUssS0FBSyxTQUFTO0FBQUEsVUFDdkUsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTO0FBQUEsVUFDVCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsR0FBRyxTQUFTLGdCQUFnQixLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3JELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZUFBZSxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3BELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsZUFBZSxLQUFLLEtBQUssTUFBTTtBQUFBLFVBQ3BELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsY0FBYyxLQUFLLEtBQUssS0FBSztBQUFBLFVBQ2xELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsY0FBYyxLQUFLLEtBQUssS0FBSztBQUFBLFVBQ2xELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsYUFBYSxLQUFLLEtBQUssSUFBSTtBQUFBLFVBQ2hELFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsa0JBQWtCLEtBQUssS0FBSyxRQUFRO0FBQUEsVUFDekQsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxZQUFJLFNBQVMsY0FBYyxRQUFRO0FBQ2pDLGlCQUFPO0FBQUEsWUFDTCxTQUFTLEdBQUcsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLE1BQU07QUFBQSxZQUNyRCxXQUFXO0FBQUEsVUFDYjtBQUFBLFFBQ0Y7QUFDQSxZQUFJLFNBQVMsY0FBYyxVQUFVO0FBQ25DLGlCQUFPO0FBQUEsWUFDTCxTQUFTLGFBQWEsR0FBRyxTQUFTLGdCQUFnQixLQUFLLEtBQUssUUFBUSw2Q0FBNkM7QUFBQSxZQUNqSCxXQUFXO0FBQUEsVUFDYjtBQUFBLFFBQ0Y7QUFDQSxlQUFPO0FBQUEsVUFDTCxTQUFTLEdBQUcsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLE9BQU87QUFBQSxVQUN0RCxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsYUFBYSxHQUFHLFNBQVMsWUFBWSxLQUFLLEtBQUssS0FBSyxxQ0FBcUM7QUFBQSxVQUNsRyxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsYUFBYSxHQUFHLFNBQVMsY0FBYyxLQUFLLEtBQUssS0FBSyx5Q0FBeUM7QUFBQSxVQUN4RyxXQUFXO0FBQUEsUUFDYjtBQUFBLE1BQ0YsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU87QUFBQSxVQUNMLFNBQVMsYUFBYSxHQUFHLFNBQVMsb0JBQW9CLEtBQUssS0FBSyxPQUFPLGdHQUFnRztBQUFBLFVBQ3ZLLFdBQVc7QUFBQSxRQUNiO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxhQUFhLE1BQU0sU0FBUyxtQkFBbUIsS0FBSyxLQUFLLFVBQVUsK0NBQStDLFNBQVMsbUJBQW1CLEtBQUssS0FBSyxVQUFVLHlCQUF5QixTQUFTLG1CQUFtQixLQUFLLEtBQUssVUFBVSxjQUFjO0FBQUEsVUFDbFEsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLGFBQWEsR0FBRyxTQUFTLGVBQWUsS0FBSyxLQUFLLE9BQU8sMkNBQTJDO0FBQUEsVUFDN0csV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUssUUFBUTtBQUNYLGNBQU0sV0FBVyxTQUFTLHVCQUF1QixLQUFLLEtBQUs7QUFDM0QsZUFBTztBQUFBLFVBQ0wsU0FBUyxhQUFhLDJFQUEyRSxRQUFRLHdCQUF3QixTQUFTLGVBQWUsS0FBSyxLQUFLLE1BQU0sa0JBQWtCO0FBQUEsVUFDM0wsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGO0FBQUEsTUFDQSxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLFVBQ0wsU0FBUyxHQUFHLFNBQVMsMEJBQTBCLEtBQUssS0FBSyxLQUFLO0FBQUEsVUFDOUQsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLEdBQUcsU0FBUyxlQUFlLEtBQUssS0FBSyxNQUFNO0FBQUEsVUFDcEQsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLEdBQUcsU0FBUyxjQUFjLEtBQUssS0FBSyxNQUFNO0FBQUEsVUFDbkQsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDSCxlQUFPO0FBQUEsVUFDTCxTQUFTLEdBQUcsU0FBUyxjQUFjLEtBQUssS0FBSyxJQUFJO0FBQUEsVUFDakQsV0FBVztBQUFBLFFBQ2I7QUFBQSxJQUNKO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVBLFNBQVMsYUFBYSxTQUF5QjtBQUM3QyxTQUFPLFVBQVUsZ0JBQWdCLE9BQU8sQ0FBQztBQUMzQztBQUVBLFNBQVMsbUJBQW1CLFdBQTJCO0FBQ3JELFFBQU0sVUFBVSxVQUFVLEtBQUs7QUFDL0IsU0FBTyxRQUFRLFdBQVcsR0FBRyxJQUFJLFVBQVUsSUFBSSxPQUFPO0FBQ3hEO0FBTUEsU0FBUyxlQUFlLE9BQW9DO0FBQzFELFNBQU8sT0FBTyxVQUFVLFlBQVksTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUk7QUFDcEU7QUFFQSxTQUFTLHdCQUF3QixPQUFnQixPQUFtQztBQUNsRixNQUFJLFNBQVMsTUFBTTtBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksT0FBTyxVQUFVLFlBQVksQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUFLLFNBQVMsR0FBRztBQUN2RSxVQUFNLElBQUksTUFBTSxHQUFHLEtBQUssOEJBQThCO0FBQUEsRUFDeEQ7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLDJCQUEyQixPQUFnQixPQUFtQztBQUNyRixNQUFJLFNBQVMsTUFBTTtBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksT0FBTyxVQUFVLFlBQVksQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUFLLFFBQVEsR0FBRztBQUN0RSxVQUFNLElBQUksTUFBTSxHQUFHLEtBQUssa0NBQWtDO0FBQUEsRUFDNUQ7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGVBQWUsT0FBZ0IsT0FBMkM7QUFDakYsTUFBSSxTQUFTLE1BQU07QUFDakIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLE9BQU8sVUFBVSxZQUFZLENBQUMsaUJBQWlCLEtBQUssS0FBSyxHQUFHO0FBQzlELFVBQU0sSUFBSSxNQUFNLEdBQUcsS0FBSyxzQ0FBc0M7QUFBQSxFQUNoRTtBQUNBLFNBQU87QUFDVDtBQUVBLGVBQWUsZ0JBQWdCLFlBQW9CLFFBQW9DO0FBQ3JGLE1BQUksY0FBYyxLQUFLLE9BQU8sU0FBUztBQUNyQztBQUFBLEVBQ0Y7QUFFQSxRQUFNLElBQUksUUFBYyxDQUFDLFlBQVk7QUFDbkMsVUFBTSxVQUFVLFdBQVcsU0FBUyxVQUFVO0FBQzlDLFVBQU0sUUFBUSxNQUFNO0FBQ2xCLG1CQUFhLE9BQU87QUFDcEIsY0FBUTtBQUFBLElBQ1Y7QUFDQSxXQUFPLGlCQUFpQixTQUFTLE9BQU8sRUFBRSxNQUFNLEtBQUssQ0FBQztBQUFBLEVBQ3hELENBQUM7QUFDSDtBQUVBLFNBQVMsYUFBYSxTQUF1QztBQUMzRCxVQUFRLFNBQVM7QUFBQSxJQUNmLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQUVBLFNBQVMsV0FBVyxPQUF1QjtBQUN6QyxTQUFPLElBQUksTUFBTSxXQUFXLEtBQUssT0FBTyxDQUFDO0FBQzNDO0FBRUEsU0FBUyxnQkFBZ0IsT0FBdUI7QUFDOUMsU0FBTyxJQUFJLE1BQU0sV0FBVyxLQUFLLE9BQU8sQ0FBQztBQUMzQzs7O0FJOXlDQSxJQUFBQyxlQUF3QjtBQUN4QixJQUFBQyxtQkFBb0Q7QUFVN0MsU0FBUyx3QkFDZCxLQUNBLE1BQ0EsT0FDQSxVQUM4QjtBQUM5QixRQUFNLE9BQU8seUJBQXlCLEtBQUssSUFBSTtBQUMvQyxRQUFNLDBCQUEwQiwrQkFBK0IsTUFBTSxRQUFRO0FBQzdFLFFBQU0sdUJBQXVCLDBCQUEwQixLQUFLLGdCQUFnQjtBQUM1RSxRQUFNLHdCQUF3QiwwQkFBMEIsTUFBTSxpQkFBaUIsZ0JBQWdCO0FBQy9GLFFBQU0sY0FBYyxLQUFLO0FBQ3pCLFFBQU0sZUFBZSxNQUFNLGlCQUFpQjtBQUU1QyxTQUFPO0FBQUEsSUFDTCxnQkFBZ0Isc0JBQXNCLFNBQVMsdUJBQXVCLE1BQU0sTUFBTSxnQkFBZ0I7QUFBQSxJQUNsRyxrQkFBa0IseUJBQXlCLHdCQUF3QjtBQUFBLElBQ25FLFdBQVcsZ0JBQWdCLGVBQWUsU0FBUztBQUFBLElBQ25ELFFBQVE7QUFBQSxNQUNOLFdBQVcsdUJBQXVCLFNBQVMsdUJBQXVCLE1BQU0sTUFBTSxnQkFBZ0I7QUFBQSxNQUM5RixrQkFBa0Isd0JBQXdCLFVBQVUsdUJBQXVCLFNBQVMsU0FBUyxpQkFBaUIsS0FBSyxJQUFJLFdBQVc7QUFBQSxNQUNsSSxTQUFTLGVBQWUsVUFBVSxjQUFjLFNBQVM7QUFBQSxJQUMzRDtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsc0JBQ1AsaUJBQ0EsTUFDQSxPQUNvQjtBQUNwQixNQUFJLE1BQU0sa0JBQWtCO0FBQzFCLFdBQU87QUFBQSxFQUNUO0FBQ0EsTUFBSSxNQUFNLGdCQUFnQixLQUFLLEdBQUc7QUFDaEMsV0FBTyxNQUFNLGVBQWUsS0FBSztBQUFBLEVBQ25DO0FBQ0EsTUFBSSxLQUFLLGtCQUFrQjtBQUN6QixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksS0FBSyxnQkFBZ0IsS0FBSyxHQUFHO0FBQy9CLFdBQU8sS0FBSyxlQUFlLEtBQUs7QUFBQSxFQUNsQztBQUNBLFNBQU8sZ0JBQWdCLEtBQUssS0FBSztBQUNuQztBQUVBLFNBQVMsdUJBQ1AsaUJBQ0EsTUFDQSxPQUNxRDtBQUNyRCxNQUFJLE1BQU0sb0JBQW9CLE1BQU0sZ0JBQWdCLEtBQUssR0FBRztBQUMxRCxXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksS0FBSyxvQkFBb0IsS0FBSyxnQkFBZ0IsS0FBSyxHQUFHO0FBQ3hELFdBQU87QUFBQSxFQUNUO0FBQ0EsTUFBSSxnQkFBZ0IsS0FBSyxHQUFHO0FBQzFCLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyx5QkFBeUIsS0FBVSxNQUFtQztBQUM3RSxRQUFNLGNBQWMsSUFBSSxjQUFjLGFBQWEsSUFBSSxHQUFHO0FBQzFELE1BQUksQ0FBQyxhQUFhO0FBQ2hCLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFFQSxRQUFNLFlBQVksWUFBWSxnQkFBZ0I7QUFDOUMsUUFBTSxtQkFBbUIsWUFBWSxVQUFVLEtBQUssWUFBWSx3QkFBd0I7QUFDeEYsUUFBTSxVQUFVLFlBQVksY0FBYztBQUUxQyxTQUFPO0FBQUEsSUFDTCxnQkFBZ0IsT0FBTyxjQUFjLFlBQVksQ0FBQyxnQkFBZ0IsU0FBUyxJQUFJLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDbEcsa0JBQWtCLE9BQU8sY0FBYyxXQUFXLGdCQUFnQixTQUFTLElBQUk7QUFBQSxJQUMvRSxrQkFBa0IsT0FBTyxxQkFBcUIsV0FBVyxtQkFBbUI7QUFBQSxJQUM1RSxXQUFXLE9BQU8sWUFBWSxZQUFZLE9BQU8sU0FBUyxPQUFPLEtBQUssVUFBVSxJQUM1RSxLQUFLLE1BQU0sT0FBTyxJQUNsQixPQUFPLFlBQVksV0FDakIscUJBQXFCLE9BQU8sSUFDNUI7QUFBQSxFQUNSO0FBQ0Y7QUFFQSxTQUFTLCtCQUErQixNQUFhLFVBQXNDO0FBQ3pGLE1BQUksU0FBUyxpQkFBaUIsS0FBSyxHQUFHO0FBQ3BDLGVBQU8sZ0NBQWMsU0FBUyxpQkFBaUIsS0FBSyxDQUFDO0FBQUEsRUFDdkQ7QUFFQSxRQUFNLGtCQUFtQixLQUFLLE1BQU0sUUFBa0MsWUFBWTtBQUNsRixRQUFNLGlCQUFhLHNCQUFRLEtBQUssSUFBSTtBQUNwQyxRQUFNLFdBQVcsZUFBZSxNQUFNLGtCQUFrQixHQUFHLGVBQWUsSUFBSSxVQUFVO0FBQ3hGLFNBQU8sWUFBWSxRQUFRLElBQUk7QUFDakM7QUFFQSxTQUFTLDBCQUEwQixPQUErQztBQUNoRixTQUFPLE9BQU8sS0FBSyxRQUFJLGdDQUFjLE1BQU0sS0FBSyxDQUFDLElBQUk7QUFDdkQ7QUFFQSxTQUFTLHFCQUFxQixPQUFtQztBQUMvRCxRQUFNLFNBQVMsT0FBTyxTQUFTLE1BQU0sS0FBSyxHQUFHLEVBQUU7QUFDL0MsU0FBTyxPQUFPLFVBQVUsTUFBTSxLQUFLLFNBQVMsSUFBSSxTQUFTO0FBQzNEO0FBRUEsU0FBUyxnQkFBZ0IsT0FBd0I7QUFDL0MsU0FBTyxDQUFDLEtBQUssU0FBUyxNQUFNLE9BQU8sUUFBUSxRQUFRLEVBQUUsU0FBUyxNQUFNLEtBQUssRUFBRSxZQUFZLENBQUM7QUFDMUY7OztBQ3JIQSxrQkFBNEM7QUFVNUMsSUFBTSxnQkFBZ0IsSUFBSSxJQUFvQjtBQUFBLEVBQzVDLEdBQUcsU0FBUyw2QkFBNkI7QUFBQSxJQUN2QztBQUFBLElBQU87QUFBQSxJQUFNO0FBQUEsSUFBVTtBQUFBLElBQWM7QUFBQSxJQUFVO0FBQUEsSUFBVTtBQUFBLElBQVU7QUFBQSxJQUFlO0FBQUEsSUFBYztBQUFBLElBQVk7QUFBQSxFQUM5RyxDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsaUNBQWlDO0FBQUEsSUFDM0M7QUFBQSxJQUFVO0FBQUEsSUFBVztBQUFBLElBQVE7QUFBQSxJQUFVO0FBQUEsSUFBWTtBQUFBLElBQVM7QUFBQSxJQUFTO0FBQUEsSUFBVTtBQUFBLElBQWM7QUFBQSxJQUFXO0FBQUEsSUFBTTtBQUFBLElBQVU7QUFBQSxJQUN4SDtBQUFBLElBQWU7QUFBQSxJQUFnQjtBQUFBLElBQW1CO0FBQUEsSUFBVTtBQUFBLElBQU87QUFBQSxJQUFtQjtBQUFBLEVBQ3hGLENBQUM7QUFBQSxFQUNELEdBQUcsU0FBUyw0QkFBNEI7QUFBQSxJQUN0QztBQUFBLElBQVU7QUFBQSxJQUFRO0FBQUEsSUFBUztBQUFBLElBQWlCO0FBQUEsSUFBUztBQUFBLElBQVc7QUFBQSxJQUFhO0FBQUEsSUFBZ0I7QUFBQSxJQUFlO0FBQUEsSUFDNUc7QUFBQSxJQUFpQjtBQUFBLEVBQ25CLENBQUM7QUFBQSxFQUNELEdBQUcsU0FBUyxnQ0FBZ0M7QUFBQSxJQUMxQztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQVE7QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFPO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUFPO0FBQUEsSUFBTTtBQUFBLElBQU87QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQVE7QUFBQSxJQUN4SDtBQUFBLElBQVE7QUFBQSxFQUNWLENBQUM7QUFBQSxFQUNELEdBQUcsU0FBUyxnQ0FBZ0MsQ0FBQyxRQUFRLE1BQU0sQ0FBQztBQUFBLEVBQzVELEdBQUcsU0FBUywwQkFBMEI7QUFBQSxJQUNwQztBQUFBLElBQVM7QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQVc7QUFBQSxJQUFTO0FBQUEsSUFBVTtBQUFBLElBQVU7QUFBQSxJQUFVO0FBQUEsSUFBVTtBQUFBLElBQVk7QUFBQSxJQUFZO0FBQUEsSUFBVztBQUFBLEVBQzFILENBQUM7QUFBQSxFQUNELEdBQUcsU0FBUywyQkFBMkIsQ0FBQyxPQUFPLFVBQVUsVUFBVSxRQUFRLGNBQWMsWUFBWSxjQUFjLFFBQVEsQ0FBQztBQUFBLEVBQzVILEdBQUcsU0FBUyw4QkFBOEI7QUFBQSxJQUN4QztBQUFBLElBQVc7QUFBQSxJQUFZO0FBQUEsSUFBd0I7QUFBQSxJQUFZO0FBQUEsSUFBUTtBQUFBLElBQVU7QUFBQSxJQUFhO0FBQUEsSUFBZTtBQUFBLElBQWdCO0FBQUEsSUFDekg7QUFBQSxJQUFZO0FBQUEsSUFBVztBQUFBLElBQVU7QUFBQSxJQUFhO0FBQUEsSUFBYTtBQUFBLElBQWE7QUFBQSxJQUFhO0FBQUEsSUFBbUI7QUFBQSxJQUN4RztBQUFBLElBQWdCO0FBQUEsSUFBZ0I7QUFBQSxJQUFlO0FBQUEsSUFBYTtBQUFBLElBQWdCO0FBQUEsSUFBc0I7QUFBQSxJQUFVO0FBQUEsSUFBYTtBQUFBLElBQ3pIO0FBQUEsSUFBVztBQUFBLElBQVc7QUFBQSxJQUFXO0FBQUEsSUFBVztBQUFBLElBQWE7QUFBQSxJQUFZO0FBQUEsSUFBZ0I7QUFBQSxJQUFPO0FBQUEsSUFBVTtBQUFBLElBQVU7QUFBQSxJQUNoSDtBQUFBLElBQVk7QUFBQSxJQUFtQjtBQUFBLElBQWtCO0FBQUEsSUFBa0I7QUFBQSxJQUFXO0FBQUEsSUFBVTtBQUFBLElBQW1CO0FBQUEsSUFBUTtBQUFBLElBQVk7QUFBQSxJQUMvSDtBQUFBLElBQVE7QUFBQSxJQUFRO0FBQUEsSUFBUTtBQUFBLElBQU87QUFBQSxJQUFRO0FBQUEsSUFBWTtBQUFBLElBQU87QUFBQSxJQUFXO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFTO0FBQUEsSUFBWTtBQUFBLElBQU07QUFBQSxFQUNoSCxDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsdUJBQXVCO0FBQUEsSUFDakM7QUFBQSxJQUFNO0FBQUEsSUFBTTtBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUFPO0FBQUEsSUFBTztBQUFBLElBQU87QUFBQSxJQUM1SDtBQUFBLEVBQ0YsQ0FBQztBQUFBLEVBQ0QsR0FBRyxTQUFTLHVCQUF1QjtBQUFBLElBQ2pDO0FBQUEsSUFBZ0I7QUFBQSxJQUFjO0FBQUEsSUFBVztBQUFBLElBQVM7QUFBQSxJQUFTO0FBQUEsSUFBUTtBQUFBLElBQWM7QUFBQSxJQUFtQjtBQUFBLElBQTJCO0FBQUEsSUFDL0g7QUFBQSxJQUFVO0FBQUEsSUFBWTtBQUFBLElBQVM7QUFBQSxJQUFnQjtBQUFBLElBQVE7QUFBQSxJQUFXO0FBQUEsSUFBYztBQUFBLElBQWE7QUFBQSxJQUFVO0FBQUEsSUFBWTtBQUFBLElBQ25IO0FBQUEsSUFBVztBQUFBLElBQWE7QUFBQSxJQUFhO0FBQUEsSUFBWTtBQUFBLElBQVU7QUFBQSxJQUFZO0FBQUEsSUFBeUI7QUFBQSxJQUFVO0FBQUEsSUFBVztBQUFBLElBQ3JIO0FBQUEsSUFBZ0I7QUFBQSxJQUFZO0FBQUEsSUFBWTtBQUFBLElBQVk7QUFBQSxJQUFpQjtBQUFBLElBQW9CO0FBQUEsSUFBc0I7QUFBQSxJQUMvRztBQUFBLElBQW1CO0FBQUEsSUFBVztBQUFBLElBQWdCO0FBQUEsSUFBUTtBQUFBLElBQU87QUFBQSxJQUFVO0FBQUEsSUFBYTtBQUFBLElBQWM7QUFBQSxJQUFhO0FBQUEsSUFBYztBQUFBLElBQzdIO0FBQUEsSUFBYztBQUFBLElBQWE7QUFBQSxFQUM3QixDQUFDO0FBQUEsRUFDRCxHQUFHLFNBQVMsc0JBQXNCLENBQUMsUUFBUSxTQUFTLFFBQVEsUUFBUSxTQUFTLFVBQVUsaUJBQWlCLENBQUM7QUFDM0csQ0FBQztBQUVELElBQU0sdUJBQXVCLG9CQUFJLElBQUk7QUFBQSxFQUNuQztBQUFBLEVBQVE7QUFBQSxFQUFTO0FBQUEsRUFBUztBQUFBLEVBQVk7QUFBQSxFQUFXO0FBQUEsRUFBVztBQUFBLEVBQVE7QUFBQSxFQUFVO0FBQUEsRUFBUztBQUFBLEVBQVU7QUFBQSxFQUFTO0FBQUEsRUFBWTtBQUFBLEVBQWE7QUFDckksQ0FBQztBQUVELElBQU0sb0JBQW9CO0FBRW5CLFNBQVMscUJBQXFCLGFBQTBCLFFBQXNCO0FBQ25GLGNBQVksTUFBTTtBQUNsQixjQUFZLFNBQVMsZ0JBQWdCO0FBRXJDLFFBQU0sUUFBUSxPQUFPLE1BQU0sSUFBSTtBQUMvQixRQUFNLFFBQVEsQ0FBQyxNQUFNLFVBQVU7QUFDN0IsMEJBQXNCLGFBQWEsSUFBSTtBQUN2QyxRQUFJLFFBQVEsTUFBTSxTQUFTLEdBQUc7QUFDNUIsa0JBQVksV0FBVyxJQUFJO0FBQUEsSUFDN0I7QUFBQSxFQUNGLENBQUM7QUFDSDtBQUVPLFNBQVMsbUJBQ2QsU0FDQSxNQUNBLE9BQ007QUFDTixRQUFNLG1CQUFtQixvQkFBb0IsS0FBSztBQUNsRCxNQUFJLENBQUMsa0JBQWtCO0FBQ3JCO0FBQUEsRUFDRjtBQUVBLFFBQU0sUUFBUSxNQUFNLFFBQVEsTUFBTSxJQUFJO0FBQ3RDLFdBQVMsUUFBUSxHQUFHLFFBQVEsa0JBQWtCLFNBQVMsR0FBRztBQUN4RCxVQUFNLE9BQU8sTUFBTSxLQUFLLEtBQUs7QUFDN0IsVUFBTSxTQUFTLGlCQUFpQixJQUFJO0FBQ3BDLFFBQUksQ0FBQyxPQUFPLFFBQVE7QUFDbEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxVQUFVLEtBQUssTUFBTSxJQUFJLEtBQUssTUFBTSxZQUFZLElBQUksS0FBSztBQUMvRCxlQUFXLFNBQVMsUUFBUTtBQUMxQixVQUFJLE1BQU0sU0FBUyxNQUFNLElBQUk7QUFDM0I7QUFBQSxNQUNGO0FBQ0EsY0FBUTtBQUFBLFFBQ04sUUFBUSxPQUFPLE1BQU07QUFBQSxRQUNyQixRQUFRLE9BQU8sTUFBTTtBQUFBLFFBQ3JCLHVCQUFXLEtBQUssRUFBRSxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQUEsTUFDNUM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxzQkFBc0IsV0FBd0IsTUFBb0I7QUFDekUsTUFBSSxTQUFTO0FBRWIsYUFBVyxTQUFTLGlCQUFpQixJQUFJLEdBQUc7QUFDMUMsUUFBSSxNQUFNLE9BQU8sUUFBUTtBQUN2QixnQkFBVSxXQUFXLEtBQUssTUFBTSxRQUFRLE1BQU0sSUFBSSxDQUFDO0FBQUEsSUFDckQ7QUFFQSxVQUFNLE9BQU8sVUFBVSxXQUFXLEVBQUUsS0FBSyxNQUFNLFVBQVUsQ0FBQztBQUMxRCxTQUFLLFFBQVEsS0FBSyxNQUFNLE1BQU0sTUFBTSxNQUFNLEVBQUUsQ0FBQztBQUM3QyxhQUFTLE1BQU07QUFBQSxFQUNqQjtBQUVBLE1BQUksU0FBUyxLQUFLLFFBQVE7QUFDeEIsY0FBVSxXQUFXLEtBQUssTUFBTSxNQUFNLENBQUM7QUFBQSxFQUN6QztBQUNGO0FBRUEsU0FBUyxpQkFBaUIsTUFBMkI7QUFDbkQsUUFBTSxTQUFzQixDQUFDO0FBQzdCLE1BQUksUUFBUTtBQUVaLGdCQUFjLE1BQU0sTUFBTTtBQUUxQixTQUFPLFFBQVEsS0FBSyxRQUFRO0FBQzFCLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxZQUFZLEtBQUs7QUFDbkIsYUFBTyxLQUFLLEVBQUUsTUFBTSxPQUFPLElBQUksS0FBSyxRQUFRLFdBQVcsb0JBQW9CLENBQUM7QUFDNUU7QUFBQSxJQUNGO0FBRUEsUUFBSSxLQUFLLEtBQUssT0FBTyxHQUFHO0FBQ3RCLGVBQVM7QUFDVDtBQUFBLElBQ0Y7QUFFQSxVQUFNLGNBQWMsZ0JBQWdCLE1BQU0sS0FBSztBQUMvQyxRQUFJLGFBQWE7QUFDZixVQUFJLFlBQVksWUFBWSxPQUFPO0FBQ2pDLGVBQU8sS0FBSyxFQUFFLE1BQU0sT0FBTyxJQUFJLFlBQVksV0FBVyxXQUFXLDBCQUEwQixDQUFDO0FBQUEsTUFDOUY7QUFDQSxhQUFPLEtBQUssRUFBRSxNQUFNLFlBQVksWUFBWSxJQUFJLFlBQVksVUFBVSxXQUFXLG1CQUFtQixDQUFDO0FBQ3JHLGNBQVEsWUFBWTtBQUNwQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQ0osZ0JBQWdCLE1BQU0sT0FBTywyQkFBMkIsdUJBQXVCLE1BQU0sS0FDckYsZ0JBQWdCLE1BQU0sT0FBTyx5Q0FBeUMsb0JBQW9CLE1BQU0sS0FDaEcsZ0JBQWdCLE1BQU0sT0FBTyx5Q0FBeUMsbUJBQW1CLE1BQU0sS0FDL0YsZ0JBQWdCLE1BQU0sT0FBTyx5Q0FBeUMsc0JBQXNCLE1BQU0sS0FDbEcsZ0JBQWdCLE1BQU0sT0FBTyxtQ0FBbUMsb0JBQW9CLE1BQU0sS0FDMUYsZ0JBQWdCLE1BQU0sT0FBTyxXQUFXLDZCQUE2QixNQUFNLEtBQzNFLGdCQUFnQixNQUFNLE9BQU8sZ0NBQWdDLGtCQUFrQixNQUFNLEtBQ3JGLGdCQUFnQixNQUFNLE9BQU8sMEJBQTBCLG9CQUFvQixNQUFNLEtBQ2pGLGdCQUFnQixNQUFNLE9BQU8sa0RBQWtELG9CQUFvQixNQUFNLEtBQ3pHLGdCQUFnQixNQUFNLE9BQU8sOEJBQThCLG9CQUFvQixNQUFNLEtBQ3JGLGdCQUFnQixNQUFNLE9BQU8sZUFBZSxvQkFBb0IsTUFBTSxLQUN0RSxnQkFBZ0IsTUFBTSxPQUFPLFdBQVcseUJBQXlCLE1BQU07QUFFekUsUUFBSSxTQUFTO0FBQ1gsY0FBUTtBQUNSO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxTQUFTLE1BQU0sS0FBSztBQUNqQyxRQUFJLE1BQU07QUFDUixhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLElBQUksS0FBSztBQUFBLFFBQ1QsV0FBVyxhQUFhLEtBQUssS0FBSztBQUFBLE1BQ3BDLENBQUM7QUFDRCxjQUFRLEtBQUs7QUFDYjtBQUFBLElBQ0Y7QUFFQSxRQUFJLGVBQWUsU0FBUyxPQUFPLEdBQUc7QUFDcEMsYUFBTyxLQUFLLEVBQUUsTUFBTSxPQUFPLElBQUksUUFBUSxHQUFHLFdBQVcsa0JBQWtCLENBQUM7QUFDeEUsZUFBUztBQUNUO0FBQUEsSUFDRjtBQUVBLGFBQVM7QUFBQSxFQUNYO0FBRUEsU0FBTyxnQkFBZ0IsTUFBTTtBQUMvQjtBQUVBLFNBQVMsY0FBYyxNQUFjLFFBQTJCO0FBQzlELFFBQU0sUUFBUSxLQUFLLE1BQU0sc0ZBQXNGO0FBQy9HLE1BQUksQ0FBQyxTQUFTLE1BQU0sU0FBUyxNQUFNO0FBQ2pDO0FBQUEsRUFDRjtBQUVBLFFBQU0sYUFBYSxNQUFNLENBQUMsRUFBRTtBQUM1QixRQUFNLFlBQVksTUFBTSxDQUFDLEtBQUssTUFBTSxDQUFDO0FBQ3JDLE1BQUksQ0FBQyxXQUFXO0FBQ2Q7QUFBQSxFQUNGO0FBRUEsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTixJQUFJLGFBQWEsVUFBVTtBQUFBLElBQzNCLFdBQVc7QUFBQSxFQUNiLENBQUM7QUFDRCxTQUFPLEtBQUs7QUFBQSxJQUNWLE1BQU0sYUFBYSxVQUFVO0FBQUEsSUFDN0IsSUFBSSxhQUFhLFVBQVUsU0FBUztBQUFBLElBQ3BDLFdBQVc7QUFBQSxFQUNiLENBQUM7QUFDSDtBQUVBLFNBQVMsYUFBYSxNQUFzQjtBQUMxQyxNQUFJLFNBQVMsS0FBSyxJQUFJLEtBQUsscUJBQXFCLElBQUksSUFBSSxHQUFHO0FBQ3pELFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTyxjQUFjLElBQUksSUFBSSxLQUFLO0FBQ3BDO0FBRUEsU0FBUyxTQUFTLE1BQWMsT0FBc0Q7QUFDcEYsUUFBTSxRQUFRO0FBQ2QsUUFBTSxZQUFZO0FBQ2xCLFFBQU0sU0FBUyxNQUFNLEtBQUssSUFBSTtBQUM5QixNQUFJLENBQUMsUUFBUTtBQUNYLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTztBQUFBLElBQ0wsT0FBTyxPQUFPLENBQUM7QUFBQSxJQUNmLEtBQUssTUFBTTtBQUFBLEVBQ2I7QUFDRjtBQUVBLFNBQVMsZ0JBQWdCLE1BQWMsT0FBbUY7QUFDeEgsTUFBSSxTQUFTO0FBQ2IsTUFBSSxLQUFLLE1BQU0sTUFBTSxPQUFPLEtBQUssU0FBUyxDQUFDLE1BQU0sS0FBTTtBQUNyRCxjQUFVO0FBQUEsRUFDWjtBQUVBLE1BQUksS0FBSyxNQUFNLE1BQU0sS0FBTTtBQUN6QixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sYUFBYTtBQUNuQixZQUFVO0FBQ1YsU0FBTyxTQUFTLEtBQUssUUFBUTtBQUMzQixRQUFJLEtBQUssTUFBTSxNQUFNLE1BQU07QUFDekIsZ0JBQVU7QUFDVjtBQUFBLElBQ0Y7QUFDQSxRQUFJLEtBQUssTUFBTSxNQUFNLEtBQU07QUFDekIsZ0JBQVU7QUFDVjtBQUFBLElBQ0Y7QUFDQSxjQUFVO0FBQUEsRUFDWjtBQUVBLFNBQU87QUFBQSxJQUNMLFdBQVc7QUFBQSxJQUNYO0FBQUEsSUFDQSxVQUFVO0FBQUEsRUFDWjtBQUNGO0FBRUEsU0FBUyxnQkFDUCxNQUNBLE9BQ0EsT0FDQSxXQUNBLFFBQ2U7QUFDZixRQUFNLFlBQVk7QUFDbEIsUUFBTSxRQUFRLE1BQU0sS0FBSyxJQUFJO0FBQzdCLE1BQUksQ0FBQyxPQUFPO0FBQ1YsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLEtBQUssRUFBRSxNQUFNLE9BQU8sSUFBSSxNQUFNLFdBQVcsVUFBVSxDQUFDO0FBQzNELFNBQU8sTUFBTTtBQUNmO0FBRUEsU0FBUyxnQkFBZ0IsUUFBa0M7QUFDekQsU0FBTyxLQUFLLENBQUMsTUFBTSxVQUFVLEtBQUssT0FBTyxNQUFNLFFBQVEsS0FBSyxLQUFLLE1BQU0sRUFBRTtBQUN6RSxRQUFNLGFBQTBCLENBQUM7QUFDakMsTUFBSSxTQUFTO0FBRWIsYUFBVyxTQUFTLFFBQVE7QUFDMUIsUUFBSSxNQUFNLE1BQU0sUUFBUTtBQUN0QjtBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxNQUFNO0FBQ3hDLGVBQVcsS0FBSyxFQUFFLEdBQUcsT0FBTyxLQUFLLENBQUM7QUFDbEMsYUFBUyxNQUFNO0FBQUEsRUFDakI7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLG9CQUFvQixPQUE4QjtBQUN6RCxNQUFJLE1BQU0sWUFBWSxNQUFNLFdBQVc7QUFDckMsV0FBTztBQUFBLEVBQ1Q7QUFFQSxNQUFJLE1BQU0sUUFBUSxXQUFXLEdBQUc7QUFDOUIsV0FBTyxNQUFNLFVBQVUsTUFBTSxZQUFZLElBQUksSUFBSTtBQUFBLEVBQ25EO0FBRUEsU0FBTyxNQUFNLFFBQVEsTUFBTSxJQUFJLEVBQUU7QUFDbkM7QUFFQSxTQUFTLFNBQVMsV0FBbUIsT0FBMEM7QUFDN0UsU0FBTyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxTQUFTLENBQUM7QUFDOUM7OztBQy9UQSxvQkFBMkI7QUFFcEIsU0FBUyxVQUFVLE9BQXVCO0FBQy9DLGFBQU8sMEJBQVcsUUFBUSxFQUFFLE9BQU8sS0FBSyxFQUFFLE9BQU8sS0FBSyxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQ3JFOzs7QUNBQSxJQUFNLGVBQWU7QUFDckIsSUFBTSxhQUFhO0FBQ25CLElBQU0sY0FBYztBQUViLFNBQVMsa0JBQWtCLGFBQXFCLFVBQThEO0FBQ25ILFFBQU0sYUFBYSxZQUFZLEtBQUssRUFBRSxZQUFZO0FBRWxELE1BQUksQ0FBQyxVQUFVO0FBQ2IsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLGtCQUFrQiwyQkFBMkIsVUFBVSxVQUFVO0FBQ3ZFLE1BQUksaUJBQWlCO0FBQ25CLFdBQU8sZ0JBQWdCLEtBQUssS0FBSztBQUFBLEVBQ25DO0FBRUEsUUFBTSxVQUFVLDJCQUEyQixRQUFRO0FBQ25ELFNBQU8sUUFBUSxVQUFVLEtBQUs7QUFDaEM7QUFFTyxTQUFTLDRCQUE0QixVQUF5QztBQUNuRixNQUFJLENBQUMsVUFBVTtBQUNiLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFFQSxRQUFNLGdCQUFnQiwyQkFBMkIsUUFBUSxFQUN0RCxRQUFRLENBQUMsYUFBYTtBQUNyQixVQUFNLE9BQU8sU0FBUyxLQUFLLEtBQUssRUFBRSxZQUFZO0FBQzlDLFdBQU8sQ0FBQyxNQUFNLEdBQUdDLGdCQUFlLFNBQVMsT0FBTyxDQUFDO0FBQUEsRUFDbkQsQ0FBQztBQUVILFNBQU87QUFBQSxJQUNMLEdBQUcsT0FBTyxLQUFLLDJCQUEyQixRQUFRLENBQUM7QUFBQSxJQUNuRCxHQUFHO0FBQUEsRUFDTCxFQUFFLElBQUksQ0FBQyxVQUFVLE1BQU0sWUFBWSxDQUFDLEVBQUUsT0FBTyxPQUFPO0FBQ3REO0FBRU8sU0FBUyx3QkFBd0IsVUFBa0IsUUFBZ0IsVUFBZ0Q7QUFDeEgsUUFBTSxRQUFRLE9BQU8sTUFBTSxPQUFPO0FBQ2xDLFFBQU0sU0FBMEIsQ0FBQztBQUNqQyxNQUFJLFVBQVU7QUFDZCxNQUFJLHNCQUFzQjtBQUUxQixXQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBTSxPQUFPLE1BQU0sQ0FBQztBQUVwQixRQUFJLHFCQUFxQjtBQUN2QixVQUFJLFdBQVcsS0FBSyxLQUFLLEtBQUssQ0FBQyxHQUFHO0FBQ2hDLDhCQUFzQjtBQUFBLE1BQ3hCO0FBQ0E7QUFBQSxJQUNGO0FBRUEsUUFBSSxhQUFhLEtBQUssS0FBSyxLQUFLLENBQUMsR0FBRztBQUNsQyw0QkFBc0I7QUFDdEI7QUFBQSxJQUNGO0FBRUEsVUFBTSxhQUFhLEtBQUssTUFBTSxXQUFXO0FBQ3pDLFFBQUksQ0FBQyxZQUFZO0FBQ2Y7QUFBQSxJQUNGO0FBRUEsVUFBTSxZQUFZO0FBQ2xCLFVBQU0sY0FBY0Msc0JBQXFCLElBQUk7QUFDN0MsVUFBTSxhQUFhLFdBQVcsQ0FBQztBQUMvQixVQUFNLGtCQUFrQixXQUFXLENBQUMsS0FBSyxJQUFJLEtBQUs7QUFDbEQsVUFBTSxpQkFBaUIsb0JBQW9CLFdBQVcsQ0FBQyxLQUFLLEVBQUU7QUFDOUQsVUFBTSxrQkFBa0IscUJBQXFCLGNBQWM7QUFDM0QsVUFBTSxtQkFBbUIsc0JBQXNCLGNBQWM7QUFDN0QsVUFBTSxXQUFXLGtCQUFrQixnQkFBZ0IsUUFBUTtBQUUzRCxRQUFJLFVBQVU7QUFDZCxVQUFNLGVBQXlCLENBQUM7QUFFaEMsYUFBUyxJQUFJLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDNUMsWUFBTSxZQUFZLE1BQU0sQ0FBQztBQUN6QixZQUFNLFVBQVUsVUFBVSxLQUFLO0FBRS9CLFVBQUksUUFBUSxXQUFXLFVBQVUsS0FBSyxtQkFBbUIsS0FBSyxPQUFPLEdBQUc7QUFDdEUsa0JBQVU7QUFDVixZQUFJO0FBQ0o7QUFBQSxNQUNGO0FBRUEsbUJBQWEsS0FBSyxpQkFBaUIsV0FBVyxXQUFXLENBQUM7QUFDMUQsZ0JBQVU7QUFBQSxJQUNaO0FBRUEsUUFBSSxDQUFDLFVBQVU7QUFDYjtBQUFBLElBQ0Y7QUFFQSxlQUFXO0FBQ1gsVUFBTSxVQUFVLGFBQWEsS0FBSyxJQUFJO0FBQ3RDLFVBQU0sZ0JBQWdCLGtCQUFrQixJQUFJLEtBQUssVUFBVSxlQUFlLENBQUMsS0FBSztBQUNoRixVQUFNLGdCQUFnQiwwQkFBMEIsZ0JBQWdCLElBQUksSUFBSSxLQUFLLFVBQVUsZ0JBQWdCLENBQUMsS0FBSztBQUM3RyxVQUFNLGdCQUFnQixPQUFPLEtBQUssY0FBYyxFQUFFLFNBQVMsSUFBSSxLQUFLLFVBQVUsY0FBYyxDQUFDLEtBQUs7QUFDbEcsVUFBTSxjQUFjLFVBQVUsR0FBRyxPQUFPLEdBQUcsYUFBYSxHQUFHLGFBQWEsR0FBRyxhQUFhLEVBQUU7QUFDMUYsVUFBTSxLQUFLLFVBQVUsR0FBRyxRQUFRLElBQUksT0FBTyxJQUFJLFFBQVEsSUFBSSxXQUFXLEVBQUU7QUFFeEUsV0FBTyxLQUFLO0FBQUEsTUFDVjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsZUFBZSxlQUFlLFlBQVk7QUFBQSxNQUMxQztBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVk7QUFBQSxNQUNaO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFZO0FBQUEsTUFDWixVQUFVO0FBQUEsSUFDWixDQUFDO0FBQUEsRUFDSDtBQUVBLFNBQU87QUFDVDtBQUVBLFNBQVMsMEJBQTBCLFNBQTREO0FBQzdGLFNBQU8sUUFBUSxRQUFRLGtCQUFrQixRQUFRLG9CQUFvQixRQUFRLG9CQUFvQixRQUFRLFNBQVM7QUFDcEg7QUFFQSxTQUFTRCxnQkFBZSxPQUF5QjtBQUMvQyxTQUFPLE1BQ0osTUFBTSxHQUFHLEVBQ1QsSUFBSSxDQUFDLFVBQVUsTUFBTSxLQUFLLEVBQUUsWUFBWSxDQUFDLEVBQ3pDLE9BQU8sT0FBTztBQUNuQjtBQUVBLFNBQVMscUJBQXFCLE9BQWdFO0FBQzVGLFFBQU0sV0FBVyxNQUFNLFdBQVcsS0FBSyxNQUFNLFFBQVEsTUFBTSxPQUFPLE1BQU07QUFDeEUsTUFBSSxDQUFDLFVBQVU7QUFDYixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sUUFBUSxNQUFNLFlBQVksS0FBSyxNQUFNLFNBQVMsTUFBTTtBQUMxRCxRQUFNLFlBQVksUUFBUSxlQUFlLEtBQUssSUFBSTtBQUNsRCxRQUFNLGFBQWEsTUFBTSxhQUFhLEtBQUssTUFBTSxVQUFVLE1BQU0sTUFBTSxNQUFNO0FBQzdFLFFBQU0sYUFBYSxNQUFNLFdBQVcsS0FBSyxNQUFNLFFBQVEsTUFBTTtBQUM3RCxRQUFNLGlCQUFpQixNQUFNLFdBQVcsS0FBSyxNQUFNO0FBQ25ELFFBQU0sV0FBVyxNQUFNLFdBQVcsS0FBSyxNQUFNO0FBQzdDLFFBQU0sYUFBYSxNQUFNLFlBQVksS0FBSyxNQUFNO0FBQ2hELFFBQU0sT0FBTyxrQkFBa0IsUUFBUSxZQUFZLE9BQy9DO0FBQUEsSUFDQSxZQUFZLDBCQUEwQixjQUFjLE1BQU0sU0FBUyxTQUFZO0FBQUEsSUFDL0UsTUFBTTtBQUFBLElBQ04sT0FBTyxjQUFjLE9BQU8sT0FBTyxDQUFDLENBQUMsS0FBSyxTQUFTLE1BQU0sS0FBSyxFQUFFLFNBQVMsV0FBVyxZQUFZLENBQUM7QUFBQSxFQUNuRyxJQUNFO0FBRUosU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLFdBQVcsV0FBVztBQUFBLElBQ3RCLFNBQVMsV0FBVztBQUFBLElBQ3BCO0FBQUEsSUFDQSxtQkFBbUIsY0FBYyxPQUFPLE9BQU8sQ0FBQyxDQUFDLEtBQUssU0FBUyxNQUFNLEtBQUssRUFBRSxTQUFTLFdBQVcsWUFBWSxDQUFDO0FBQUEsSUFDN0c7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLHNCQUFzQixPQUErQjtBQUM1RCxRQUFNLFlBQVksTUFBTSxnQkFBZ0IsS0FBSyxNQUFNO0FBQ25ELFFBQU0sVUFBVSxNQUFNLGNBQWMsS0FBSyxNQUFNO0FBQy9DLFFBQU0sbUJBQW1CLE1BQU0sVUFBVSxLQUFLLE1BQU0sT0FBTyxNQUFNLG1CQUFtQjtBQUNwRixRQUFNLFlBQVksVUFBVUUsc0JBQXFCLE9BQU8sSUFBSTtBQUU1RCxTQUFPO0FBQUEsSUFDTCxnQkFBZ0IsYUFBYSxDQUFDQyxpQkFBZ0IsU0FBUyxJQUFJLFlBQVk7QUFBQSxJQUN2RSxrQkFBa0IsWUFBWUEsaUJBQWdCLFNBQVMsSUFBSTtBQUFBLElBQzNEO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVNELHNCQUFxQixPQUFtQztBQUMvRCxRQUFNLFNBQVMsT0FBTyxTQUFTLE1BQU0sS0FBSyxHQUFHLEVBQUU7QUFDL0MsU0FBTyxPQUFPLFVBQVUsTUFBTSxLQUFLLFNBQVMsSUFBSSxTQUFTO0FBQzNEO0FBRUEsU0FBU0MsaUJBQWdCLE9BQXdCO0FBQy9DLFNBQU8sQ0FBQyxLQUFLLFNBQVMsTUFBTSxPQUFPLFFBQVEsUUFBUSxFQUFFLFNBQVMsTUFBTSxLQUFLLEVBQUUsWUFBWSxDQUFDO0FBQzFGO0FBRUEsU0FBUywwQkFBMEIsT0FBK0M7QUFDaEYsU0FBTyxTQUFTLE9BQU8sU0FBWSxNQUFNLEtBQUssRUFBRSxZQUFZO0FBQzlEO0FBRUEsU0FBUyxvQkFBb0IsT0FBdUM7QUFDbEUsUUFBTSxRQUFnQyxDQUFDO0FBQ3ZDLFFBQU0sVUFBVTtBQUNoQixNQUFJO0FBQ0osVUFBUSxRQUFRLFFBQVEsS0FBSyxLQUFLLE1BQU0sTUFBTTtBQUM1QyxVQUFNLE1BQU0sQ0FBQyxFQUFFLFlBQVksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLE1BQU0sQ0FBQyxLQUFLLE1BQU0sQ0FBQyxLQUFLO0FBQUEsRUFDdEU7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGVBQWUsT0FBc0Q7QUFDNUUsUUFBTSxRQUFRLE1BQU0sS0FBSyxFQUFFLE1BQU0sa0NBQWtDO0FBQ25FLE1BQUksQ0FBQyxPQUFPO0FBQ1YsV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLFFBQVEsT0FBTyxTQUFTLE1BQU0sQ0FBQyxHQUFHLEVBQUU7QUFDMUMsUUFBTSxNQUFNLE9BQU8sU0FBUyxNQUFNLENBQUMsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQ3BELE1BQUksQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUFLLENBQUMsT0FBTyxVQUFVLEdBQUcsS0FBSyxTQUFTLEtBQUssTUFBTSxPQUFPO0FBQ25GLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTyxFQUFFLE9BQU8sSUFBSTtBQUN0QjtBQUVPLFNBQVMsZ0JBQWdCLFFBQXlCLE1BQW9DO0FBQzNGLFNBQU8sT0FBTyxLQUFLLENBQUMsVUFBVSxRQUFRLE1BQU0sYUFBYSxRQUFRLE1BQU0sT0FBTyxLQUFLO0FBQ3JGO0FBRUEsU0FBU0Ysc0JBQXFCLE1BQXNCO0FBQ2xELFFBQU0sUUFBUSxLQUFLLE1BQU0sU0FBUztBQUNsQyxTQUFPLFFBQVEsQ0FBQyxLQUFLO0FBQ3ZCO0FBRUEsU0FBUyxpQkFBaUIsTUFBYyxhQUE2QjtBQUNuRSxNQUFJLENBQUMsYUFBYTtBQUNoQixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksUUFBUTtBQUNaLFNBQU8sUUFBUSxZQUFZLFVBQVUsUUFBUSxLQUFLLFVBQVUsS0FBSyxLQUFLLE1BQU0sWUFBWSxLQUFLLEdBQUc7QUFDOUYsYUFBUztBQUFBLEVBQ1g7QUFFQSxTQUFPLEtBQUssTUFBTSxLQUFLO0FBQ3pCOzs7QUNwT0EsSUFBTSx3QkFBZ0U7QUFBQSxFQUNwRSxRQUFRO0FBQUEsSUFDTixVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLFlBQVk7QUFBQSxJQUNWLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsWUFBWTtBQUFBLElBQ1YsVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxHQUFHO0FBQUEsSUFDRCxVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLEtBQUs7QUFBQSxJQUNILFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsV0FBVztBQUFBLElBQ1QsVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsTUFBTTtBQUFBLElBQ0osVUFBVTtBQUFBLElBQ1Ysa0JBQWtCO0FBQUEsSUFDbEIsbUJBQW1CO0FBQUEsSUFDbkIsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxVQUFVO0FBQUEsSUFDUixVQUFVO0FBQUEsSUFDVixrQkFBa0I7QUFBQSxJQUNsQixtQkFBbUI7QUFBQSxJQUNuQixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBLFVBQVU7QUFBQSxJQUNSLFVBQVU7QUFBQSxJQUNWLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUNGO0FBRU8sU0FBUyxzQkFBc0IsVUFBa0MsdUJBQXVCLE9BQStCO0FBQzVILE1BQUksc0JBQXNCO0FBQ3hCLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxrQkFBa0I7QUFBQSxNQUNsQixtQkFBbUI7QUFBQSxNQUNuQixhQUFhO0FBQUEsTUFDYixlQUFlO0FBQUEsSUFDakI7QUFBQSxFQUNGO0FBRUEsU0FBTyxzQkFBc0IsUUFBUSxLQUFLO0FBQUEsSUFDeEM7QUFBQSxJQUNBLGtCQUFrQjtBQUFBLElBQ2xCLG1CQUFtQjtBQUFBLElBQ25CLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxFQUNqQjtBQUNGOzs7QUN6R08sSUFBTSxhQUFOLE1BQXVDO0FBQUEsRUFBdkM7QUFDTCxjQUFLO0FBQ0wsdUJBQWM7QUFDZCxxQkFBWSxDQUFDLGNBQWMsWUFBWTtBQUFBO0FBQUEsRUFFdkMsT0FBTyxPQUFzQixVQUF1QztBQUNsRSxRQUFJLE1BQU0sYUFBYSxjQUFjO0FBQ25DLGFBQU8sUUFBUSxTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQUEsSUFDL0M7QUFFQSxXQUFPLFFBQVEsU0FBUywrQkFBK0IsS0FBSyxDQUFDO0FBQUEsRUFDL0Q7QUFBQSxFQUVBLE1BQU0sSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUM3RyxRQUFJLE1BQU0sYUFBYSxjQUFjO0FBQ25DLGFBQU8sbUJBQW1CO0FBQUEsUUFDeEIsVUFBVSxLQUFLO0FBQUEsUUFDZixZQUFZLEtBQUs7QUFBQSxRQUNqQixZQUFZLFNBQVMsZUFBZSxLQUFLO0FBQUEsUUFDekMsTUFBTSxDQUFDLFFBQVE7QUFBQSxRQUNmLGVBQWU7QUFBQSxRQUNmLFFBQVEsTUFBTTtBQUFBLFFBQ2Qsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLFFBQVE7QUFBQSxRQUNuQixRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sYUFBYSxTQUFTLCtCQUErQixLQUFLO0FBQ2hFLFVBQU0sYUFBYSxTQUFTLG1CQUFtQixRQUFRLHFCQUFxQjtBQUU1RSxXQUFPLG1CQUFtQjtBQUFBLE1BQ3hCLFVBQVUsR0FBRyxLQUFLLEVBQUUsSUFBSSxTQUFTLGNBQWM7QUFBQSxNQUMvQztBQUFBLE1BQ0E7QUFBQSxNQUNBLE1BQU0sQ0FBQyxRQUFRO0FBQUEsTUFDZixlQUFlO0FBQUEsTUFDZixRQUFRLE1BQU07QUFBQSxNQUNkLGtCQUFrQixRQUFRO0FBQUEsTUFDMUIsV0FBVyxRQUFRO0FBQUEsTUFDbkIsUUFBUSxRQUFRO0FBQUEsTUFDaEIsT0FBTyxRQUFRO0FBQUEsSUFDakIsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDM0NPLElBQU0sdUJBQU4sTUFBaUQ7QUFBQSxFQUFqRDtBQUNMLGNBQUs7QUFDTCx1QkFBYztBQUNkLHFCQUFZLENBQUM7QUFBQTtBQUFBLEVBRWIsT0FBTyxPQUFzQixVQUF1QztBQUNsRSxXQUFPLFFBQVEsS0FBSyxrQkFBa0IsT0FBTyxRQUFRLEdBQUcsV0FBVyxLQUFLLENBQUM7QUFBQSxFQUMzRTtBQUFBLEVBRUEsSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUN2RyxVQUFNLFdBQVcsS0FBSyxrQkFBa0IsT0FBTyxRQUFRO0FBQ3ZELFFBQUksQ0FBQyxVQUFVO0FBQ2IsWUFBTSxJQUFJLE1BQU0sZ0NBQWdDLE1BQU0sUUFBUSxFQUFFO0FBQUEsSUFDbEU7QUFFQSxXQUFPLG1CQUFtQjtBQUFBLE1BQ3hCLFVBQVUsR0FBRyxLQUFLLEVBQUUsSUFBSSxTQUFTLElBQUk7QUFBQSxNQUNyQyxZQUFZLFNBQVM7QUFBQSxNQUNyQixZQUFZLFNBQVMsV0FBVyxLQUFLO0FBQUEsTUFDckMsTUFBTSxpQkFBaUIsU0FBUyxRQUFRLFFBQVE7QUFBQSxNQUNoRCxlQUFlRyxvQkFBbUIsU0FBUyxXQUFXLFNBQVMsSUFBSTtBQUFBLE1BQ25FLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLFFBQVE7QUFBQSxNQUNuQixRQUFRLFFBQVE7QUFBQSxNQUNoQixPQUFPLFFBQVE7QUFBQSxJQUNqQixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsa0JBQWtCLE9BQXNCLFVBQThEO0FBQzVHLFdBQU8sMkJBQTJCLFVBQVUsTUFBTSxVQUFVLE1BQU0sYUFBYTtBQUFBLEVBQ2pGO0FBQ0Y7QUFFQSxTQUFTQSxvQkFBbUIsV0FBbUIsTUFBc0I7QUFDbkUsUUFBTSxVQUFVLFVBQVUsS0FBSztBQUMvQixNQUFJLENBQUMsU0FBUztBQUNaLFdBQU8sSUFBSSxJQUFJO0FBQUEsRUFDakI7QUFDQSxTQUFPLFFBQVEsV0FBVyxHQUFHLElBQUksVUFBVSxJQUFJLE9BQU87QUFDeEQ7OztBQ2hDQSxJQUFNLG9CQUF1QztBQUFBLEVBQzNDO0FBQUEsSUFDRSxVQUFVO0FBQUEsSUFDVixhQUFhO0FBQUEsSUFDYixZQUFZLENBQUMsYUFBYSxTQUFTO0FBQUEsSUFDbkMsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQTtBQUFBLElBQ0UsVUFBVTtBQUFBLElBQ1YsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGFBQWEsU0FBUztBQUFBLElBQ25DLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0E7QUFBQSxJQUNFLFVBQVU7QUFBQSxJQUNWLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxhQUFhLFNBQVM7QUFBQSxJQUNuQyxlQUFlO0FBQUEsRUFDakI7QUFBQSxFQUNBO0FBQUEsSUFDRSxVQUFVO0FBQUEsSUFDVixhQUFhO0FBQUEsSUFDYixZQUFZLENBQUMsYUFBYSxTQUFTO0FBQUEsSUFDbkMsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQTtBQUFBLElBQ0UsVUFBVTtBQUFBLElBQ1YsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGFBQWEsU0FBUztBQUFBLElBQ25DLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0E7QUFBQSxJQUNFLFVBQVU7QUFBQSxJQUNWLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxhQUFhLFNBQVM7QUFBQSxJQUNuQyxlQUFlO0FBQUEsSUFDZixNQUFNLENBQUMsT0FBTyxRQUFRO0FBQUEsSUFDdEIsS0FBSztBQUFBLE1BQ0gsU0FBUztBQUFBLElBQ1g7QUFBQSxJQUNBLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQUEsRUFDQTtBQUFBLElBQ0UsVUFBVTtBQUFBLElBQ1YsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGFBQWEsU0FBUztBQUFBLElBQ25DLGVBQWU7QUFBQSxJQUNmLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQ0Y7QUFFTyxJQUFNLG9CQUFOLE1BQThDO0FBQUEsRUFBOUM7QUFDTCxjQUFLO0FBQ0wsdUJBQWM7QUFDZCxxQkFBWSxrQkFBa0IsSUFBSSxDQUFDLFNBQVMsS0FBSyxRQUFRO0FBQUE7QUFBQSxFQUV6RCxPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFVBQU0sT0FBTyxLQUFLLFFBQVEsTUFBTSxRQUFRO0FBQ3hDLFdBQU8sUUFBUSxNQUFNLFdBQVcsUUFBUSxFQUFFLEtBQUssQ0FBQztBQUFBLEVBQ2xEO0FBQUEsRUFFQSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQ3ZHLFVBQU0sT0FBTyxLQUFLLFFBQVEsTUFBTSxRQUFRO0FBQ3hDLFFBQUksQ0FBQyxNQUFNO0FBQ1QsWUFBTSxJQUFJLE1BQU0seUJBQXlCLE1BQU0sUUFBUSxFQUFFO0FBQUEsSUFDM0Q7QUFFQSxXQUFPLG1CQUFtQjtBQUFBLE1BQ3hCLFVBQVUsR0FBRyxLQUFLLEVBQUUsSUFBSSxNQUFNLFFBQVE7QUFBQSxNQUN0QyxZQUFZLEtBQUs7QUFBQSxNQUNqQixZQUFZLEtBQUssV0FBVyxRQUFRLEVBQUUsS0FBSztBQUFBLE1BQzNDLE1BQU0sS0FBSyxRQUFRLENBQUMsUUFBUTtBQUFBLE1BQzVCLGVBQWUsS0FBSztBQUFBLE1BQ3BCLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsS0FBSyxvQkFBb0IsQ0FBQztBQUFBLE1BQ2pFLFFBQVEsUUFBUTtBQUFBLE1BQ2hCLE9BQU8sUUFBUTtBQUFBLE1BQ2YsS0FBSyxLQUFLO0FBQUEsSUFDWixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsUUFBUSxVQUErRDtBQUM3RSxXQUFPLGtCQUFrQixLQUFLLENBQUMsU0FBUyxLQUFLLGFBQWEsUUFBUTtBQUFBLEVBQ3BFO0FBQ0Y7OztBQ2xHQSxJQUFBQyxlQUFxQjtBQVFkLElBQU0sYUFBTixNQUF1QztBQUFBLEVBQXZDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxVQUFVLFVBQVU7QUFBQTtBQUFBLEVBRWpDLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsVUFBVTtBQUMvQixhQUFPLFFBQVEsU0FBUyxvQkFBb0IsS0FBSyxDQUFDO0FBQUEsSUFDcEQ7QUFDQSxRQUFJLE1BQU0sYUFBYSxZQUFZO0FBQ2pDLGFBQU8sUUFBUSxTQUFTLG1CQUFtQixLQUFLLENBQUM7QUFBQSxJQUNuRDtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLElBQUksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDN0csUUFBSSxNQUFNLGFBQWEsVUFBVTtBQUMvQixhQUFPLEtBQUssU0FBUyxPQUFPLFNBQVMsUUFBUTtBQUFBLElBQy9DO0FBQ0EsUUFBSSxNQUFNLGFBQWEsWUFBWTtBQUNqQyxhQUFPLEtBQUssWUFBWSxPQUFPLFNBQVMsUUFBUTtBQUFBLElBQ2xEO0FBQ0EsVUFBTSxJQUFJLE1BQU0sOEJBQThCLE1BQU0sUUFBUSxFQUFFO0FBQUEsRUFDaEU7QUFBQSxFQUVBLE1BQWMsU0FBUyxPQUFzQixTQUF5QixVQUFzRDtBQUMxSCxVQUFNLE9BQU8sY0FBYyxLQUFLO0FBQ2hDLFVBQU0sU0FBUyxrQkFBa0IsT0FBTyxvQkFBb0IsYUFBYSxFQUFFLFFBQVEsZ0JBQWdCO0FBQ25HLFVBQU0sZUFBZTtBQUFBLE1BQ25CLEdBQUcsU0FBUyxTQUFTLGdCQUFnQjtBQUFBLE1BQ3JDLEdBQUcsa0JBQWtCLE9BQU8sc0JBQXNCLGVBQWU7QUFBQSxJQUNuRTtBQUVBLFdBQU8sbUJBQW1CLFVBQVUsTUFBTSxTQUFTLE9BQU8sRUFBRSxTQUFTLFNBQVMsTUFBTTtBQUNsRixZQUFNLGlCQUFhLG1CQUFLLFNBQVMsZUFBZTtBQUNoRCxZQUFNLGdCQUFnQixNQUFNLFdBQVc7QUFBQSxRQUNyQyxVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLG9CQUFvQixLQUFLO0FBQUEsUUFDOUMsTUFBTTtBQUFBLFVBQ0o7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxHQUFHLGFBQWEsUUFBUSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sV0FBVyxDQUFDO0FBQUEsVUFDNUQsR0FBRztBQUFBLFVBQ0g7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUEsUUFDQSxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUVELFVBQUksQ0FBQyxjQUFjLFNBQVM7QUFDMUIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxvQkFBYyxTQUFTLGNBQWMsY0FBYyxRQUFRLFdBQVcsc0NBQXNDLFVBQVUsRUFBRTtBQUN4SCxZQUFNLEtBQUssdUJBQXVCLGVBQWUsWUFBWSxTQUFTLFFBQVE7QUFFOUUsVUFBSSxTQUFTLFdBQVc7QUFDdEIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxhQUFPLEtBQUssZUFBZSxPQUFPLFlBQVksU0FBUyxVQUFVLGFBQWE7QUFBQSxJQUNoRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsUUFBdUIsWUFBb0IsU0FBeUIsVUFBNkM7QUFDcEosVUFBTSxVQUFVLFNBQVMsMEJBQTBCLEtBQUs7QUFDeEQsUUFBSSxDQUFDLFNBQVM7QUFDWixhQUFPLFVBQVUsV0FBVyxPQUFPLFNBQVMsMkVBQTJFO0FBQ3ZIO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxNQUFNLFdBQVc7QUFBQSxNQUMvQixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsTUFDcEIsWUFBWTtBQUFBLE1BQ1osWUFBWTtBQUFBLE1BQ1osTUFBTSxDQUFDLE1BQU0sVUFBVTtBQUFBLE1BQ3ZCLGtCQUFrQixRQUFRO0FBQUEsTUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxNQUM3QyxRQUFRLFFBQVE7QUFBQSxJQUNsQixDQUFDO0FBRUQsUUFBSSxRQUFRLFNBQVM7QUFDbkIsYUFBTyxTQUFTLGNBQWMsT0FBTyxRQUFRLG1CQUFtQixRQUFRLE9BQU8sS0FBSyxLQUFLLHdCQUF3QjtBQUFBLElBQ25ILE9BQU87QUFDTCxhQUFPLFVBQVUsV0FBVyxPQUFPLFNBQVMsa0NBQWtDLFFBQVEsVUFBVSxRQUFRLFVBQVUsUUFBUSxRQUFRLFFBQVEsRUFBRSxFQUFFO0FBQUEsSUFDaEo7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQ1osT0FDQSxZQUNBLFNBQ0EsVUFDQSxlQUN3QjtBQUN4QixRQUFJLENBQUMsU0FBUyxxQkFBcUI7QUFDakMsYUFBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsU0FBUztBQUFBLFFBQ1QsVUFBVTtBQUFBLFFBQ1YsUUFBUSxXQUFXLGNBQWMsUUFBUSw4R0FBOEc7QUFBQSxNQUN6SjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsb0JBQW9CLE9BQU8saUJBQWlCLFVBQVU7QUFDdEUsUUFBSSxDQUFDLFNBQVM7QUFDWixhQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxTQUFTO0FBQUEsUUFDVCxVQUFVO0FBQUEsUUFDVixRQUFRLFdBQVcsY0FBYyxRQUFRLGdFQUFnRTtBQUFBLE1BQzNHO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxNQUFNLFdBQVc7QUFBQSxNQUM1QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsTUFDcEIsWUFBWTtBQUFBLE1BQ1osWUFBWSxTQUFTLHNCQUFzQixLQUFLLEtBQUs7QUFBQSxNQUNyRCxNQUFNLENBQUMsTUFBTSxRQUFRLFdBQVcsWUFBWSxPQUFPO0FBQUEsTUFDbkQsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLE1BQzdDLFFBQVEsUUFBUTtBQUFBLElBQ2xCLENBQUM7QUFFRCxTQUFLLFNBQVMsY0FBYyxjQUFjLFFBQVEsa0JBQWtCLEtBQUssT0FBTyxLQUFLLENBQUM7QUFDdEYsU0FBSyxTQUFTLGNBQWMsY0FBYyxRQUFRLGtCQUFrQixLQUFLLE9BQU8sS0FBSyxDQUFDO0FBQ3RGLFNBQUssVUFBVSxXQUFXLGNBQWMsU0FBUyw0Q0FBNEMsT0FBTyxHQUFHO0FBQ3ZHLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLFlBQVksT0FBc0IsU0FBeUIsVUFBc0Q7QUFDN0gsVUFBTSxPQUFPLGlCQUFpQixLQUFLO0FBQ25DLFVBQU0sWUFBWSxrQkFBa0IsT0FBTyxzQkFBc0IsZUFBZSxFQUFFLFFBQVEsZ0JBQWdCO0FBQzFHLFVBQU0sYUFBYSxTQUFTLG1CQUFtQixLQUFLO0FBRXBELFdBQU8sbUJBQW1CLE9BQU8sTUFBTSxTQUFTLE9BQU8sRUFBRSxTQUFTLE1BQU07QUFDdEUsVUFBSSxTQUFTLE9BQU87QUFDbEIsZUFBTyxXQUFXO0FBQUEsVUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRSxhQUFhLElBQUk7QUFBQSxVQUNyQyxZQUFZO0FBQUEsVUFDWjtBQUFBLFVBQ0EsTUFBTSxDQUFDLEdBQUcsV0FBVyxRQUFRO0FBQUEsVUFDN0Isa0JBQWtCLFFBQVE7QUFBQSxVQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFVBQzdDLFFBQVEsUUFBUTtBQUFBLFVBQ2hCLE9BQU8sUUFBUTtBQUFBLFFBQ2pCLENBQUM7QUFBQSxNQUNIO0FBRUEsWUFBTSxTQUFTLE1BQU0sV0FBVztBQUFBLFFBQzlCLFVBQVUsR0FBRyxLQUFLLEVBQUUsYUFBYSxJQUFJO0FBQUEsUUFDckMsWUFBWTtBQUFBLFFBQ1o7QUFBQSxRQUNBLE1BQU0sQ0FBQyxhQUFhLEdBQUcsV0FBVyxRQUFRO0FBQUEsUUFDMUMsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFFRCxVQUFJLENBQUMsT0FBTyxXQUFXLDRCQUE0QixNQUFNLEdBQUc7QUFDMUQsZUFBTyxXQUFXO0FBQUEsVUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRSxhQUFhLElBQUk7QUFBQSxVQUNyQyxZQUFZO0FBQUEsVUFDWjtBQUFBLFVBQ0EsTUFBTSxDQUFDLE1BQU0sR0FBRyxXQUFXLFFBQVE7QUFBQSxVQUNuQyxrQkFBa0IsUUFBUTtBQUFBLFVBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsVUFDN0MsUUFBUSxRQUFRO0FBQUEsUUFDbEIsQ0FBQztBQUFBLE1BQ0g7QUFFQSxhQUFPO0FBQUEsSUFDVCxDQUFDO0FBQUEsRUFDSDtBQUNGO0FBRUEsU0FBUyxjQUFjLE9BQWlDO0FBQ3RELFFBQU0sUUFBUSxvQkFBb0IsT0FBTyxrQkFBa0IsV0FBVyxLQUFLO0FBQzNFLE1BQUksVUFBVSxhQUFhLFVBQVUsUUFBUTtBQUMzQyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sSUFBSSxNQUFNLDBCQUEwQixLQUFLLHdCQUF3QjtBQUN6RTtBQUVBLFNBQVMsaUJBQWlCLE9BQW9DO0FBQzVELFFBQU0sUUFBUSxvQkFBb0IsT0FBTyxzQkFBc0IsZUFBZSxLQUFLO0FBQ25GLE1BQUksVUFBVSxXQUFXLFVBQVUsT0FBTztBQUN4QyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sSUFBSSxNQUFNLDhCQUE4QixLQUFLLHFCQUFxQjtBQUMxRTtBQUVBLFNBQVMsb0JBQW9CLE9BQXNCLFNBQWlCLFVBQXNDO0FBQ3hHLFNBQU8sTUFBTSxXQUFXLE9BQU8sR0FBRyxLQUFLLEtBQUssTUFBTSxXQUFXLFFBQVEsR0FBRyxLQUFLLEtBQUs7QUFDcEY7QUFFQSxTQUFTLGtCQUFrQixPQUFzQixTQUFpQixVQUE0QjtBQUM1RixTQUFPLFNBQVMsb0JBQW9CLE9BQU8sU0FBUyxRQUFRLEtBQUssRUFBRTtBQUNyRTtBQUVBLFNBQVMsU0FBUyxPQUF5QjtBQUN6QyxTQUFPLE1BQ0osTUFBTSxHQUFHLEVBQ1QsSUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDekIsT0FBTyxPQUFPO0FBQ25CO0FBRUEsU0FBUyxXQUFXLFVBQThCLE1BQXNCO0FBQ3RFLFNBQU8sQ0FBQyxVQUFVLElBQUksRUFBRSxPQUFPLENBQUMsU0FBUyxNQUFNLEtBQUssQ0FBQyxFQUFFLEtBQUssSUFBSTtBQUNsRTtBQUVBLFNBQVMsY0FBYyxVQUFrQixPQUFlLE1BQXNCO0FBQzVFLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFNBQVM7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sQ0FBQyxTQUFTLEtBQUssR0FBRyxHQUFHLEtBQUs7QUFBQSxFQUFNLE9BQU8sRUFBRSxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssTUFBTTtBQUMvRTtBQUVBLFNBQVMsNEJBQTRCLFFBQWdDO0FBQ25FLFFBQU0sU0FBUyxHQUFHLE9BQU8sTUFBTTtBQUFBLEVBQUssT0FBTyxNQUFNLEdBQUcsWUFBWTtBQUNoRSxTQUNFLE9BQU8sU0FBUyxXQUFXLE1BQU0sT0FBTyxTQUFTLHFCQUFxQixLQUFLLE9BQU8sU0FBUyxnQkFBZ0IsS0FBSyxPQUFPLFNBQVMsZ0JBQWdCLE1BRWhKLE9BQU8sU0FBUyxRQUFRLEtBQUssQ0FBQyxPQUFPLFNBQVMsV0FBVztBQUU3RDs7O0FDL09PLElBQU0sYUFBTixNQUF1QztBQUFBLEVBQXZDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxTQUFTO0FBQUE7QUFBQSxFQUV0QixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLGFBQWEsUUFBUSxTQUFTLDBCQUEwQixLQUFLLENBQUM7QUFBQSxFQUMxRjtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFVBQU0sU0FBUyxNQUFNLG1CQUFtQjtBQUFBLE1BQ3RDLFVBQVUsS0FBSztBQUFBLE1BQ2YsWUFBWSxLQUFLO0FBQUEsTUFDakIsWUFBWSxTQUFTLDBCQUEwQixLQUFLO0FBQUEsTUFDcEQsTUFBTSxDQUFDLFFBQVE7QUFBQSxNQUNmLGVBQWU7QUFBQSxNQUNmLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLE1BQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2hCLE9BQU8sUUFBUTtBQUFBLElBQ2pCLENBQUM7QUFFRCxRQUFJLENBQUMsT0FBTyxZQUFZLENBQUMsT0FBTyxhQUFhLE9BQU8sWUFBWSxRQUFRLENBQUMsT0FBTyxPQUFPLEtBQUssR0FBRztBQUM3RixVQUFJLE9BQU8sYUFBYSxHQUFHO0FBQ3pCLGVBQU8sVUFBVTtBQUNqQixlQUFPLFVBQVUsd0JBQXdCLE9BQU8sUUFBUTtBQUFBLE1BQzFEO0FBRUEsVUFBSSxDQUFDLE9BQU8sT0FBTyxLQUFLLEdBQUc7QUFDekIsZUFBTyxTQUFTLE9BQU8sYUFBYSxJQUNoQyxxQ0FDQSw2QkFBNkIsT0FBTyxRQUFRO0FBQUE7QUFBQSxNQUNsRDtBQUFBLElBQ0Y7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUNGOzs7QUN6Q0EsSUFBQUMsZUFBcUI7QUFJZCxJQUFNLHdCQUFOLE1BQWtEO0FBQUEsRUFBbEQ7QUFDTCxjQUFLO0FBQ0wsdUJBQWM7QUFDZCxxQkFBWSxDQUFDLFFBQVEsTUFBTTtBQUFBO0FBQUEsRUFFM0IsT0FBTyxPQUFzQixVQUF1QztBQUNsRSxRQUFJLE1BQU0sYUFBYSxRQUFRO0FBQzdCLGFBQU8sUUFBUSxTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQUEsSUFDL0M7QUFFQSxRQUFJLE1BQU0sYUFBYSxRQUFRO0FBQzdCLGFBQU8sUUFBUSxTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQUEsSUFDL0M7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxLQUFLLFFBQVEsT0FBTyxTQUFTLFFBQVE7QUFBQSxJQUM5QztBQUVBLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxLQUFLLFFBQVEsT0FBTyxTQUFTLFFBQVE7QUFBQSxJQUM5QztBQUVBLFVBQU0sSUFBSSxNQUFNLHlCQUF5QixNQUFNLFFBQVEsRUFBRTtBQUFBLEVBQzNEO0FBQUEsRUFFQSxNQUFjLFFBQVEsT0FBc0IsU0FBeUIsVUFBc0Q7QUFDekgsV0FBTyxtQkFBbUIsT0FBTyxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQy9FLFlBQU0saUJBQWEsbUJBQUssU0FBUyxhQUFhO0FBQzlDLFlBQU0sZ0JBQWdCLE1BQU0sV0FBVztBQUFBLFFBQ3JDLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWixZQUFZLFNBQVMsZUFBZSxLQUFLO0FBQUEsUUFDekMsTUFBTSxDQUFDLFVBQVUsTUFBTSxVQUFVO0FBQUEsUUFDakMsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLFFBQ2hCLE9BQU8sUUFBUTtBQUFBLE1BQ2pCLENBQUM7QUFFRCxVQUFJLENBQUMsY0FBYyxTQUFTO0FBQzFCLGVBQU87QUFBQSxNQUNUO0FBRUEsYUFBTyxXQUFXO0FBQUEsUUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxRQUNaLE1BQU0sQ0FBQztBQUFBLFFBQ1Asa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLFFBQVEsT0FBc0IsU0FBeUIsVUFBc0Q7QUFDekgsV0FBTyx3QkFBd0IsYUFBYSxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQzFGLFVBQUksQ0FBQyxTQUFTLHVCQUF1QixLQUFLLEdBQUc7QUFDM0MsZUFBTyxXQUFXO0FBQUEsVUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFVBQ3BCLFlBQVk7QUFBQSxVQUNaLFlBQVksU0FBUyxlQUFlLEtBQUs7QUFBQSxVQUN6QyxNQUFNLENBQUMsUUFBUTtBQUFBLFVBQ2Ysa0JBQWtCLFFBQVE7QUFBQSxVQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFVBQzdDLFFBQVEsUUFBUTtBQUFBLFVBQ2hCLE9BQU8sUUFBUTtBQUFBLFFBQ2pCLENBQUM7QUFBQSxNQUNIO0FBRUEsWUFBTSxnQkFBZ0IsTUFBTSxXQUFXO0FBQUEsUUFDckMsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVksU0FBUyx1QkFBdUIsS0FBSztBQUFBLFFBQ2pELE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixrQkFBa0I7QUFBQSxRQUNsQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFFRCxVQUFJLENBQUMsY0FBYyxTQUFTO0FBQzFCLGVBQU87QUFBQSxNQUNUO0FBRUEsYUFBTyxXQUFXO0FBQUEsUUFDaEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaLFlBQVksU0FBUyxlQUFlLEtBQUs7QUFBQSxRQUN6QyxNQUFNLENBQUMsT0FBTyxTQUFTLE1BQU07QUFBQSxRQUM3QixrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsUUFDaEIsT0FBTyxRQUFRO0FBQUEsTUFDakIsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDeEdBLElBQUFDLGVBQXFCO0FBSWQsSUFBTSx1QkFBTixNQUFpRDtBQUFBLEVBQWpEO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxLQUFLLEtBQUs7QUFBQTtBQUFBLEVBRXZCLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsS0FBSztBQUMxQixhQUFPLFFBQVEsU0FBUyxZQUFZLEtBQUssQ0FBQztBQUFBLElBQzVDO0FBRUEsUUFBSSxNQUFNLGFBQWEsT0FBTztBQUM1QixhQUFPLFFBQVEsU0FBUyxjQUFjLEtBQUssQ0FBQztBQUFBLElBQzlDO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUM3RyxVQUFNLGFBQWEsTUFBTSxhQUFhLE1BQU0sU0FBUyxZQUFZLEtBQUssSUFBSSxTQUFTLGNBQWMsS0FBSztBQUN0RyxVQUFNLGdCQUFnQixNQUFNLGFBQWEsTUFBTSxPQUFPO0FBQ3RELFVBQU0sYUFBYSxNQUFNLGFBQWEsTUFBTSxZQUFZO0FBRXhELFdBQU8sbUJBQW1CLGVBQWUsTUFBTSxTQUFTLE9BQU8sRUFBRSxTQUFTLFNBQVMsTUFBTTtBQUN2RixZQUFNLGlCQUFhLG1CQUFLLFNBQVMsYUFBYTtBQUM5QyxZQUFNLGdCQUFnQixNQUFNLFdBQVc7QUFBQSxRQUNyQyxVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRO0FBQUEsUUFDdEM7QUFBQSxRQUNBO0FBQUEsUUFDQSxNQUFNLENBQUMsVUFBVSxNQUFNLFVBQVU7QUFBQSxRQUNqQyxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsS0FBSyxJQUFJLFFBQVEsV0FBVyxHQUFNO0FBQUEsUUFDN0MsUUFBUSxRQUFRO0FBQUEsUUFDaEIsT0FBTyxRQUFRO0FBQUEsTUFDakIsQ0FBQztBQUVELFVBQUksQ0FBQyxjQUFjLFNBQVM7QUFDMUIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxhQUFPLFdBQVc7QUFBQSxRQUNoQixVQUFVLEdBQUcsS0FBSyxFQUFFLElBQUksTUFBTSxRQUFRO0FBQUEsUUFDdEM7QUFBQSxRQUNBLFlBQVk7QUFBQSxRQUNaLE1BQU0sQ0FBQztBQUFBLFFBQ1Asa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLEtBQUssSUFBSSxRQUFRLFdBQVcsR0FBTTtBQUFBLFFBQzdDLFFBQVEsUUFBUTtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQ3REQSxJQUFBQyxlQUFxQjtBQUlkLElBQU0sY0FBTixNQUF3QztBQUFBLEVBQXhDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxPQUFPO0FBQUE7QUFBQSxFQUVwQixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLFdBQVcsUUFBUSxTQUFTLGdCQUFnQixLQUFLLENBQUM7QUFBQSxFQUM5RTtBQUFBLEVBRUEsTUFBTSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQzdHLFVBQU0sT0FBTyxTQUFTO0FBQ3RCLFVBQU0sYUFBYSxTQUFTLGdCQUFnQixLQUFLO0FBRWpELFFBQUksU0FBUyxTQUFTO0FBQ3BCLGFBQU8sbUJBQW1CO0FBQUEsUUFDeEIsVUFBVSxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQ3BCLFlBQVk7QUFBQSxRQUNaO0FBQUEsUUFDQSxNQUFNLENBQUMsUUFBUTtBQUFBLFFBQ2YsZUFBZTtBQUFBLFFBQ2YsUUFBUSxNQUFNO0FBQUEsUUFDZCxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsUUFBUTtBQUFBLFFBQ25CLFFBQVEsUUFBUTtBQUFBLFFBQ2hCLE9BQU8sUUFBUTtBQUFBLE1BQ2pCLENBQUM7QUFBQSxJQUNIO0FBRUEsUUFBSSxTQUFTLFFBQVE7QUFDbkIsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1o7QUFBQSxRQUNBLE1BQU0sQ0FBQyxRQUFRLE1BQU0sU0FBUyxRQUFRO0FBQUEsUUFDdEMsZUFBZTtBQUFBLFFBQ2YsUUFBUSxNQUFNO0FBQUEsUUFDZCxrQkFBa0IsUUFBUTtBQUFBLFFBQzFCLFdBQVcsUUFBUTtBQUFBLFFBQ25CLFFBQVEsUUFBUTtBQUFBLFFBQ2hCLE9BQU8sUUFBUTtBQUFBLE1BQ2pCLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTyxtQkFBbUIsT0FBTyxNQUFNLFNBQVMsT0FBTyxFQUFFLFNBQVMsU0FBUyxNQUFNO0FBQy9FLFlBQU0saUJBQWEsbUJBQUssU0FBUyxhQUFhO0FBQzlDLFlBQU0sZ0JBQWdCLE1BQU0sV0FBVztBQUFBLFFBQ3JDLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWjtBQUFBLFFBQ0EsTUFBTSxDQUFDLE1BQU0sWUFBWSxRQUFRO0FBQUEsUUFDakMsa0JBQWtCLFFBQVE7QUFBQSxRQUMxQixXQUFXLFFBQVE7QUFBQSxRQUNuQixRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBRUQsVUFBSSxDQUFDLGNBQWMsU0FBUztBQUMxQixlQUFPO0FBQUEsTUFDVDtBQUVBLGFBQU8sV0FBVztBQUFBLFFBQ2hCLFVBQVUsR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUNwQixZQUFZO0FBQUEsUUFDWixZQUFZO0FBQUEsUUFDWixNQUFNLENBQUM7QUFBQSxRQUNQLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxRQUFRO0FBQUEsUUFDbkIsUUFBUSxRQUFRO0FBQUEsTUFDbEIsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFDRjs7O0FDeEVPLElBQU0sZUFBTixNQUF5QztBQUFBLEVBQXpDO0FBQ0wsY0FBSztBQUNMLHVCQUFjO0FBQ2QscUJBQVksQ0FBQyxRQUFRO0FBQUE7QUFBQSxFQUVyQixPQUFPLE9BQXNCLFVBQXVDO0FBQ2xFLFdBQU8sTUFBTSxhQUFhLFlBQVksUUFBUSxTQUFTLGlCQUFpQixLQUFLLENBQUM7QUFBQSxFQUNoRjtBQUFBLEVBRUEsSUFBSSxPQUFzQixTQUF5QixVQUFzRDtBQUN2RyxXQUFPLG1CQUFtQjtBQUFBLE1BQ3hCLFVBQVUsS0FBSztBQUFBLE1BQ2YsWUFBWSxLQUFLO0FBQUEsTUFDakIsWUFBWSxTQUFTLGlCQUFpQixLQUFLO0FBQUEsTUFDM0MsTUFBTSxDQUFDLFFBQVE7QUFBQSxNQUNmLGVBQWU7QUFBQSxNQUNmLFFBQVEsTUFBTTtBQUFBLE1BQ2Qsa0JBQWtCLFFBQVE7QUFBQSxNQUMxQixXQUFXLFFBQVE7QUFBQSxNQUNuQixRQUFRLFFBQVE7QUFBQSxNQUNoQixPQUFPLFFBQVE7QUFBQSxJQUNqQixDQUFDO0FBQUEsRUFDSDtBQUNGOzs7QUMxQkEsSUFBQUMsYUFBMkI7QUFDM0IsSUFBQUMsZUFBcUI7QUFJZCxJQUFNLGNBQU4sTUFBd0M7QUFBQSxFQUF4QztBQUNMLGNBQUs7QUFDTCx1QkFBYztBQUNkLHFCQUFZLENBQUMsUUFBUSxPQUFPLFFBQVE7QUFBQTtBQUFBLEVBRXBDLE9BQU8sT0FBc0IsVUFBdUM7QUFDbEUsUUFBSSxNQUFNLGFBQWEsUUFBUTtBQUM3QixhQUFPLFFBQVEsU0FBUyxlQUFlLEtBQUssQ0FBQztBQUFBLElBQy9DO0FBRUEsUUFBSSxNQUFNLGFBQWEsT0FBTztBQUM1QixhQUFPLFFBQVEscUJBQXFCLFFBQVEsRUFBRSxLQUFLLENBQUM7QUFBQSxJQUN0RDtBQUVBLFFBQUksTUFBTSxhQUFhLFVBQVU7QUFDL0IsYUFBTyxRQUFRLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFBQSxJQUM5QztBQUVBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxJQUFJLE9BQXNCLFNBQXlCLFVBQXNEO0FBQ3ZHLFFBQUksTUFBTSxhQUFhLFFBQVE7QUFDN0IsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLGVBQWUsS0FBSztBQUFBLFFBQ3pDLE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUksTUFBTSxhQUFhLE9BQU87QUFDNUIsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxxQkFBcUIsUUFBUTtBQUFBLFFBQ3pDLE1BQU0sQ0FBQyxNQUFNLFFBQVE7QUFBQSxRQUNyQixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUksTUFBTSxhQUFhLFVBQVU7QUFDL0IsYUFBTyxtQkFBbUI7QUFBQSxRQUN4QixVQUFVLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDcEIsWUFBWTtBQUFBLFFBQ1osWUFBWSxTQUFTLGNBQWMsS0FBSztBQUFBLFFBQ3hDLE1BQU0sQ0FBQyxRQUFRO0FBQUEsUUFDZixlQUFlO0FBQUEsUUFDZixRQUFRLE1BQU07QUFBQSxRQUNkLGtCQUFrQixRQUFRO0FBQUEsUUFDMUIsV0FBVyxLQUFLLElBQUksUUFBUSxXQUFXLEdBQU07QUFBQSxRQUM3QyxRQUFRLFFBQVE7QUFBQSxRQUNoQixPQUFPLFFBQVE7QUFBQSxNQUNqQixDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sSUFBSSxNQUFNLCtCQUErQixNQUFNLFFBQVEsRUFBRTtBQUFBLEVBQ2pFO0FBQ0Y7QUFFQSxTQUFTLHFCQUFxQixVQUFzQztBQUNsRSxRQUFNLGFBQWEsU0FBUyxjQUFjLEtBQUs7QUFDL0MsTUFBSSxjQUFjLGVBQWUsUUFBUTtBQUN2QyxXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sZUFBVyxtQkFBSyxRQUFRLElBQUksUUFBUSxJQUFJLFNBQVMsV0FBVyxPQUFPLE1BQU07QUFDL0UsYUFBTyx1QkFBVyxRQUFRLElBQUksV0FBVyxjQUFjO0FBQ3pEOzs7QUNqRk8sSUFBTSxxQkFBTixNQUF5QjtBQUFBLEVBQzlCLFlBQTZCLFNBQXVCO0FBQXZCO0FBQUEsRUFBd0I7QUFBQSxFQUVyRCxrQkFBa0IsT0FBc0IsVUFBaUQ7QUFDdkYsUUFBSSxDQUFDLEtBQUssdUJBQXVCLE9BQU8sUUFBUSxHQUFHO0FBQ2pELGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTyxLQUFLLFFBQVEsS0FBSyxDQUFDLFlBQVksQ0FBQyxPQUFPLFVBQVUsVUFBVSxPQUFPLFVBQVUsU0FBUyxNQUFNLFFBQVEsTUFBTSxPQUFPLE9BQU8sT0FBTyxRQUFRLENBQUMsS0FBSztBQUFBLEVBQ3JKO0FBQUEsRUFFQSx3QkFBa0M7QUFDaEMsV0FBTyxDQUFDLEdBQUcsSUFBSSxJQUFJLEtBQUssUUFBUSxRQUFRLENBQUMsV0FBVyxPQUFPLFNBQVMsQ0FBQyxDQUFDO0FBQUEsRUFDeEU7QUFBQSxFQUVRLHVCQUF1QixPQUFzQixVQUF1QztBQUMxRixRQUFJLGtCQUFrQixNQUFNLFVBQVUsUUFBUSxHQUFHO0FBQy9DLGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTyxRQUFRLDJCQUEyQixVQUFVLE1BQU0sVUFBVSxNQUFNLGFBQWEsQ0FBQztBQUFBLEVBQzFGO0FBQ0Y7OztBQ3BCTyxJQUFNLG1CQUF1QztBQUFBLEVBQ2xELHNCQUFzQjtBQUFBLEVBQ3RCLDhCQUE4QjtBQUFBLEVBQzlCLG9CQUFvQjtBQUFBLEVBQ3BCLGtCQUFrQjtBQUFBLEVBQ2xCLGtCQUFrQjtBQUFBLEVBQ2xCLGtCQUFrQjtBQUFBLEVBQ2xCLGdCQUFnQjtBQUFBLEVBQ2hCLGdCQUFnQjtBQUFBLEVBQ2hCLGdDQUFnQztBQUFBLEVBQ2hDLFdBQVc7QUFBQSxFQUNYLGlCQUFpQjtBQUFBLEVBQ2pCLGFBQWE7QUFBQSxFQUNiLGVBQWU7QUFBQSxFQUNmLGlCQUFpQjtBQUFBLEVBQ2pCLGdCQUFnQjtBQUFBLEVBQ2hCLGdCQUFnQjtBQUFBLEVBQ2hCLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGNBQWM7QUFBQSxFQUNkLGdCQUFnQjtBQUFBLEVBQ2hCLG1CQUFtQjtBQUFBLEVBQ25CLHdCQUF3QjtBQUFBLEVBQ3hCLGdCQUFnQjtBQUFBLEVBQ2hCLDJCQUEyQjtBQUFBLEVBQzNCLHFCQUFxQjtBQUFBLEVBQ3JCLHVCQUF1QjtBQUFBLEVBQ3ZCLDJCQUEyQjtBQUFBLEVBQzNCLGtCQUFrQjtBQUFBLEVBQ2xCLHFCQUFxQjtBQUFBLEVBQ3JCLG9CQUFvQjtBQUFBLEVBQ3BCLGdCQUFnQjtBQUFBLEVBQ2hCLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLG1CQUFtQjtBQUFBLEVBQ25CLG9CQUFvQjtBQUFBLEVBQ3BCLG1CQUFtQjtBQUFBLEVBQ25CLDRCQUE0QjtBQUFBLEVBQzVCLGdDQUFnQztBQUFBLEVBQ2hDLDhCQUE4QjtBQUFBLEVBQzlCLHNCQUFzQiwwQkFBMEI7QUFBQSxFQUNoRCxrQkFBa0Isc0JBQXNCO0FBQUEsRUFDeEMsdUJBQXVCLENBQUM7QUFBQSxFQUN4QixpQkFBaUIsQ0FBQztBQUFBLEVBQ2xCLGVBQWU7QUFBQSxFQUNmLHVCQUF1QjtBQUN6Qjs7O0FDakRBLElBQUFDLG1CQUE2RTtBQU90RSxJQUFNLGlCQUFOLGNBQTZCLGtDQUFpQjtBQUFBLEVBQ25ELFlBQTZCQyxhQUF3QjtBQUNuRCxVQUFNQSxZQUFXLEtBQUtBLFdBQVU7QUFETCxzQkFBQUE7QUFBQSxFQUU3QjtBQUFBLEVBRUEsVUFBZ0I7QUFDZCxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLGdCQUFZLE1BQU07QUFDbEIsZ0JBQVksU0FBUyxNQUFNLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFDM0MsZ0JBQVksU0FBUyxLQUFLLEVBQUUsTUFBTSw2RkFBNkYsQ0FBQztBQUVoSSxTQUFLLHNCQUFzQixLQUFLLGNBQWMsYUFBYSxvQkFBb0IsSUFBSSxDQUFDO0FBQ3BGLFNBQUssdUJBQXVCLEtBQUssY0FBYyxhQUFhLG1CQUFtQixDQUFDO0FBQ2hGLFNBQUssc0JBQXNCLEtBQUssY0FBYyxhQUFhLG1CQUFtQixDQUFDO0FBQy9FLFNBQUssc0JBQXNCLEtBQUssY0FBYyxhQUFhLGtCQUFrQixDQUFDO0FBQzlFLFNBQUssS0FBSyxzQkFBc0IsS0FBSyxjQUFjLGFBQWEseUJBQXlCLENBQUM7QUFBQSxFQUM1RjtBQUFBLEVBRVEsY0FBYyxhQUEwQixPQUFlLE9BQU8sT0FBb0I7QUFDeEYsVUFBTSxVQUFVLFlBQVksU0FBUyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsQ0FBQztBQUNoRixZQUFRLE9BQU87QUFDZixZQUFRLFNBQVMsV0FBVyxFQUFFLE1BQU0sT0FBTyxLQUFLLHdCQUF3QixDQUFDO0FBQ3pFLFdBQU8sUUFBUSxVQUFVLEVBQUUsS0FBSyw2QkFBNkIsQ0FBQztBQUFBLEVBQ2hFO0FBQUEsRUFFUSxzQkFBc0IsYUFBZ0M7QUFDNUQsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsd0JBQXdCLEVBQ2hDLFFBQVEsNEZBQTRGLEVBQ3BHO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLG9CQUFvQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3ZGLGFBQUssV0FBVyxTQUFTLHVCQUF1QjtBQUNoRCxZQUFJLE9BQU87QUFDVCxlQUFLLFdBQVcsU0FBUywrQkFBK0I7QUFBQSxRQUMxRDtBQUNBLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGdDQUFnQyxFQUN4QyxRQUFRLG9HQUFvRyxFQUM1RztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxrQkFBa0IsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNyRixhQUFLLFdBQVcsU0FBUyxxQkFBcUI7QUFDOUMsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxZQUFJLE9BQU87QUFDVCxlQUFLLEtBQUssV0FBVywrQkFBK0I7QUFBQSxRQUN0RCxPQUFPO0FBQ0wsZUFBSyxLQUFLLFdBQVcsK0JBQStCO0FBQUEsUUFDdEQ7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsaUJBQWlCLEVBQ3pCLFFBQVEsNEVBQTRFLEVBQ3BGO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxlQUFlLE1BQU0sRUFBRSxTQUFTLE9BQU8sS0FBSyxXQUFXLFNBQVMsZ0JBQWdCLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNoSCxjQUFNLFNBQVMsT0FBTyxTQUFTLE9BQU8sRUFBRTtBQUN4QyxZQUFJLENBQUMsT0FBTyxNQUFNLE1BQU0sS0FBSyxTQUFTLEdBQUc7QUFDdkMsZUFBSyxXQUFXLFNBQVMsbUJBQW1CO0FBQzVDLGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsbUJBQW1CLEVBQzNCLFFBQVEsdUZBQXVGLEVBQy9GO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxlQUFlLFlBQVksRUFBRSxTQUFTLEtBQUssV0FBVyxTQUFTLGdCQUFnQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQzlHLGFBQUssV0FBVyxTQUFTLG1CQUFtQixNQUFNLEtBQUssUUFBSSxnQ0FBYyxNQUFNLEtBQUssQ0FBQyxJQUFJO0FBQ3pGLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLDJCQUEyQixFQUNuQyxRQUFRLHNHQUFzRyxFQUM5RztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFdBQVcsU0FBUyxpQkFBaUIsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNwRixhQUFLLFdBQVcsU0FBUyxvQkFBb0I7QUFDN0MsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLE1BQ3JDLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsc0JBQXNCLEVBQzlCLFFBQVEsc0dBQXNHLEVBQzlHO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FBSyxlQUFlLEdBQUcsRUFBRSxTQUFTLE9BQU8sS0FBSyxXQUFXLFNBQVMsc0JBQXNCLENBQUMsQ0FBQyxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3BILGNBQU0sU0FBUyxPQUFPLFNBQVMsTUFBTSxLQUFLLEdBQUcsRUFBRTtBQUMvQyxZQUFJLENBQUMsT0FBTyxNQUFNLE1BQU0sS0FBSyxVQUFVLEdBQUc7QUFDeEMsZUFBSyxXQUFXLFNBQVMscUJBQXFCLEtBQUssSUFBSSxRQUFRLEdBQUk7QUFDbkUsZ0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxRQUNyQztBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSx1QkFBdUIsRUFDL0IsUUFBUSxpRkFBaUYsRUFDekY7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxXQUFXLFNBQVMsaUJBQWlCLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDcEYsYUFBSyxXQUFXLFNBQVMsb0JBQW9CO0FBQzdDLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLDBCQUEwQixFQUNsQyxRQUFRLDhFQUE4RSxFQUN0RjtBQUFBLE1BQVksQ0FBQyxhQUNaLFNBQ0csVUFBVSxhQUFhLFdBQVcsRUFDbEMsVUFBVSxZQUFZLFVBQVUsRUFDaEMsVUFBVSxVQUFVLFFBQVEsRUFDNUIsU0FBUyxLQUFLLFdBQVcsU0FBUyw4QkFBOEIsV0FBVyxFQUMzRSxTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLFdBQVcsU0FBUyw2QkFBNkI7QUFDdEQsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLE1BQ3JDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsMEJBQTBCLEVBQ2xDLFFBQVEsK0ZBQStGLEVBQ3ZHO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLGtDQUFrQyxJQUFJLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDekcsYUFBSyxXQUFXLFNBQVMsaUNBQWlDO0FBQzFELGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGlCQUFpQixFQUN6QixRQUFRLGlGQUFpRixFQUN6RjtBQUFBLE1BQVksQ0FBQyxhQUNaLFNBQ0csVUFBVSxRQUFRLHNCQUFzQixFQUN4QyxVQUFVLFFBQVEsaUJBQWlCLEVBQ25DLFVBQVUsVUFBVSxhQUFhLEVBQ2pDLFNBQVMsS0FBSyxXQUFXLFNBQVMsaUJBQWlCLE1BQU0sRUFDekQsU0FBUyxPQUFPLFVBQVU7QUFDekIsYUFBSyxXQUFXLFNBQVMsZ0JBQWdCO0FBQ3pDLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0o7QUFBQSxFQUVRLHNCQUFzQixhQUFnQztBQUM1RCxRQUFJLEtBQUsseUJBQXlCLFFBQVEsR0FBRztBQUMzQyxXQUFLLGVBQWUsYUFBYSxxQkFBcUIsb0NBQW9DLGtCQUFrQjtBQUFBLElBQzlHO0FBQ0EsUUFBSSxLQUFLLHlCQUF5QixZQUFZLEdBQUc7QUFDL0MsV0FBSyxlQUFlLGFBQWEsbUJBQW1CLGtEQUFrRCxnQkFBZ0I7QUFBQSxJQUN4SDtBQUVBLFFBQUksS0FBSyx5QkFBeUIsWUFBWSxHQUFHO0FBQy9DLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHdCQUF3QixFQUNoQyxRQUFRLDJDQUEyQyxFQUNuRDtBQUFBLFFBQVksQ0FBQyxhQUNaLFNBQ0csVUFBVSxXQUFXLFNBQVMsRUFDOUIsVUFBVSxPQUFPLEtBQUssRUFDdEIsU0FBUyxLQUFLLFdBQVcsU0FBUyxjQUFjLEVBQ2hELFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGVBQUssV0FBVyxTQUFTLGlCQUFpQjtBQUMxQyxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLFFBQ3JDLENBQUM7QUFBQSxNQUNMO0FBRUYsV0FBSyxlQUFlLGFBQWEsb0NBQW9DLHVDQUF1QyxnQ0FBZ0M7QUFBQSxJQUM5STtBQUVBLFFBQUksS0FBSyx5QkFBeUIsT0FBTyxHQUFHO0FBQzFDLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLFlBQVksRUFDcEIsUUFBUSxzRUFBc0UsRUFDOUU7QUFBQSxRQUFZLENBQUMsYUFDWixTQUNHLFVBQVUsU0FBUyxPQUFPLEVBQzFCLFVBQVUsVUFBVSxRQUFRLEVBQzVCLFVBQVUsUUFBUSxNQUFNLEVBQ3hCLFNBQVMsS0FBSyxXQUFXLFNBQVMsU0FBUyxFQUMzQyxTQUFTLE9BQU8sVUFBVTtBQUN6QixlQUFLLFdBQVcsU0FBUyxZQUFZO0FBQ3JDLGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckMsQ0FBQztBQUFBLE1BQ0w7QUFFRixXQUFLLGVBQWUsYUFBYSxvQkFBb0IsOEVBQThFLGlCQUFpQjtBQUFBLElBQ3RKO0FBRUEsU0FBSyxzQkFBc0IsYUFBYSxDQUFDLEdBQUcsR0FBRyxjQUFjLDJDQUEyQyxhQUFhO0FBQ3JILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxLQUFLLEdBQUcsZ0JBQWdCLDZDQUE2QyxlQUFlO0FBQzdILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxPQUFPLEdBQUcsb0JBQW9CLG1EQUFtRCxpQkFBaUI7QUFDM0ksU0FBSyxzQkFBc0IsYUFBYSxDQUFDLE1BQU0sR0FBRyxtQkFBbUIsb0NBQW9DLGdCQUFnQjtBQUN6SCxTQUFLLHNCQUFzQixhQUFhLENBQUMsTUFBTSxHQUFHLG1CQUFtQixvQ0FBb0MsZ0JBQWdCO0FBQ3pILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxLQUFLLEdBQUcsa0JBQWtCLG1DQUFtQyxlQUFlO0FBQ3JILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxLQUFLLEdBQUcsa0JBQWtCLG1DQUFtQyxlQUFlO0FBQ3JILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxJQUFJLEdBQUcsaUJBQWlCLGtDQUFrQyxjQUFjO0FBQ2pILFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxNQUFNLEdBQUcsaUJBQWlCLDhDQUE4QyxnQkFBZ0I7QUFDakksU0FBSyxzQkFBc0IsYUFBYSxDQUFDLFNBQVMsR0FBRyxzQkFBc0IsMkRBQTJELG1CQUFtQjtBQUN6SixRQUFJLEtBQUsseUJBQXlCLE1BQU0sR0FBRztBQUN6QyxXQUFLLGVBQWUsYUFBYSxpQkFBaUIsaUZBQWlGLHdCQUF3QjtBQUMzSixXQUFLLGVBQWUsYUFBYSxtQkFBbUIscURBQXFELGdCQUFnQjtBQUFBLElBQzNIO0FBQ0EsU0FBSyxzQkFBc0IsYUFBYSxDQUFDLFNBQVMsR0FBRyx1QkFBdUIsd0RBQXdELDJCQUEyQjtBQUMvSixRQUFJLEtBQUsseUJBQXlCLFFBQVEsR0FBRztBQUMzQyxXQUFLLGVBQWUsYUFBYSx5QkFBeUIsc0RBQXNELHFCQUFxQjtBQUNySSxXQUFLLGVBQWUsYUFBYSwyQkFBMkIsNkRBQTZELHVCQUF1QjtBQUNoSixXQUFLLGVBQWUsYUFBYSx5QkFBeUIsb0ZBQW9GLDJCQUEyQjtBQUN6SyxXQUFLLGVBQWUsYUFBYSxzQkFBc0IsZ0VBQWdFLGtCQUFrQjtBQUN6SSxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSx3QkFBd0IsRUFDaEMsUUFBUSx3R0FBd0csRUFDaEg7QUFBQSxRQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxXQUFXLFNBQVMsbUJBQW1CLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDdEYsZUFBSyxXQUFXLFNBQVMsc0JBQXNCO0FBQy9DLGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckMsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNKO0FBQ0EsU0FBSyxzQkFBc0IsYUFBYSxDQUFDLFVBQVUsR0FBRyx1QkFBdUIseUNBQXlDLG9CQUFvQjtBQUMxSSxTQUFLLHNCQUFzQixhQUFhLENBQUMsTUFBTSxHQUFHLG1CQUFtQiw2Q0FBNkMsZ0JBQWdCO0FBQ2xJLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxLQUFLLEdBQUcsa0JBQWtCLHNEQUFzRCxlQUFlO0FBQ3hJLFNBQUssc0JBQXNCLGFBQWEsQ0FBQyxRQUFRLEdBQUcsY0FBYyx1REFBdUQsZUFBZTtBQUFBLEVBQzFJO0FBQUEsRUFFUSxzQkFBMEQsYUFBMEIsYUFBdUIsTUFBYyxhQUFxQixLQUFjO0FBQ2xLLFFBQUksWUFBWSxLQUFLLENBQUMsZUFBZSxLQUFLLHlCQUF5QixVQUFVLENBQUMsR0FBRztBQUMvRSxXQUFLLGVBQWUsYUFBYSxNQUFNLGFBQWEsR0FBRztBQUFBLElBQ3pEO0FBQUEsRUFDRjtBQUFBLEVBRVEseUJBQXlCLFlBQTZCO0FBQzVELFdBQU8sa0JBQWtCLFlBQVksS0FBSyxXQUFXLFFBQVE7QUFBQSxFQUMvRDtBQUFBLEVBRVEsdUJBQXVCLGFBQWdDO0FBQzdELG1DQUErQixLQUFLLFdBQVcsUUFBUTtBQUV2RCxlQUFXLFFBQVEsNkJBQTZCLEtBQUssV0FBVyxRQUFRLEdBQUc7QUFDekUsWUFBTSxTQUFTLFlBQVksU0FBUyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsQ0FBQztBQUMvRSxhQUFPLE9BQU8sS0FBSyxXQUFXLFNBQVMscUJBQXFCLFNBQVMsS0FBSyxFQUFFO0FBQzVFLGFBQU8sU0FBUyxXQUFXLEVBQUUsTUFBTSxLQUFLLFlBQVksQ0FBQztBQUNyRCxhQUFPLFNBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxhQUFhLEtBQUssMkJBQTJCLENBQUM7QUFFaEYsVUFBSSx5QkFBUSxNQUFNLEVBQ2YsUUFBUSxnQkFBZ0IsRUFDeEIsUUFBUSx1R0FBdUcsRUFDL0c7QUFBQSxRQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxXQUFXLFNBQVMscUJBQXFCLFNBQVMsS0FBSyxFQUFFLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUN6RyxlQUFLLGdCQUFnQixLQUFLLFdBQVcsU0FBUyxzQkFBc0IsS0FBSyxJQUFJLEtBQUs7QUFDbEYscUJBQVcsWUFBWSxLQUFLLFdBQVc7QUFDckMsaUJBQUssZ0JBQWdCLEtBQUssV0FBVyxTQUFTLGtCQUFrQixTQUFTLElBQUksS0FBSztBQUFBLFVBQ3BGO0FBQ0EsZ0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFDbkMsZUFBSyxRQUFRO0FBQUEsUUFDZixDQUFDO0FBQUEsTUFDSDtBQUVGLFlBQU0saUJBQWlCLEtBQUssV0FBVyxTQUFTLHFCQUFxQixTQUFTLEtBQUssRUFBRTtBQUNyRixpQkFBVyxZQUFZLEtBQUssV0FBVztBQUNyQyxZQUFJLHlCQUFRLE1BQU0sRUFDZixRQUFRLFNBQVMsV0FBVyxFQUM1QixRQUFRLFlBQVksU0FBUyxRQUFRLEtBQUssSUFBSSxDQUFDLEVBQUUsRUFDakQ7QUFBQSxVQUFVLENBQUMsV0FDVixPQUNHLFlBQVksQ0FBQyxjQUFjLEVBQzNCLFNBQVMsa0JBQWtCLEtBQUssV0FBVyxTQUFTLGlCQUFpQixTQUFTLFNBQVMsRUFBRSxDQUFDLEVBQzFGLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGlCQUFLLGdCQUFnQixLQUFLLFdBQVcsU0FBUyxrQkFBa0IsU0FBUyxJQUFJLEtBQUs7QUFDbEYsa0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxVQUNyQyxDQUFDO0FBQUEsUUFDTDtBQUFBLE1BQ0o7QUFBQSxJQUNGO0FBRUEsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsZ0NBQWdDLEVBQ3hDLFFBQVEsMEVBQTBFLEVBQ2xGO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxjQUFjLFFBQVEsRUFBRSxRQUFRLFlBQVk7QUFDakQsY0FBTSxLQUFLLFdBQVcsMEJBQTBCLElBQUk7QUFDcEQsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxhQUFLLFFBQVE7QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsa0JBQWtCLEVBQzFCLFFBQVEsa0VBQWtFLEVBQzFFO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssV0FBVyxTQUFTLHFCQUFxQixTQUFTLDBCQUEwQixDQUFDLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDNUgsYUFBSyxnQkFBZ0IsS0FBSyxXQUFXLFNBQVMsc0JBQXNCLDRCQUE0QixLQUFLO0FBQ3JHLGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFDbkMsYUFBSyxRQUFRO0FBQUEsTUFDZixDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHlCQUF5QixFQUNqQyxRQUFRLCtEQUErRCxFQUN2RTtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxPQUFPLEVBQUUsUUFBUSxZQUFZO0FBQ2hELGFBQUssV0FBVyxTQUFTLHVCQUF1QiwwQkFBMEI7QUFDMUUsYUFBSyxXQUFXLFNBQVMsbUJBQW1CLHNCQUFzQjtBQUNsRSxjQUFNLEtBQUssV0FBVyxhQUFhO0FBQ25DLGFBQUssUUFBUTtBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQUEsRUFFUSxnQkFBZ0IsUUFBa0IsSUFBWSxTQUF3QjtBQUM1RSxVQUFNLFFBQVEsT0FBTyxRQUFRLEVBQUU7QUFDL0IsUUFBSSxXQUFXLFFBQVEsR0FBRztBQUN4QixhQUFPLEtBQUssRUFBRTtBQUFBLElBQ2hCLFdBQVcsQ0FBQyxXQUFXLFNBQVMsR0FBRztBQUNqQyxhQUFPLE9BQU8sT0FBTyxDQUFDO0FBQUEsSUFDeEI7QUFBQSxFQUNGO0FBQUEsRUFFUSxzQkFBc0IsYUFBZ0M7QUFDNUQsVUFBTSxTQUFTLFlBQVksVUFBVSxFQUFFLEtBQUssNEJBQTRCLENBQUM7QUFDekUsU0FBSyx5QkFBeUIsTUFBTTtBQUVwQyxRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxxQkFBcUIsRUFDN0IsUUFBUSw2Q0FBNkMsRUFDckQ7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsR0FBRyxFQUFFLFFBQVEsWUFBWTtBQUM1QyxhQUFLLFdBQVcsU0FBUyxnQkFBZ0IsS0FBSztBQUFBLFVBQzVDLE1BQU07QUFBQSxVQUNOLFNBQVM7QUFBQSxVQUNULFlBQVk7QUFBQSxVQUNaLE1BQU07QUFBQSxVQUNOLFdBQVc7QUFBQSxVQUNYLGVBQWU7QUFBQSxVQUNmLHFCQUFxQjtBQUFBLFVBQ3JCLGVBQWU7QUFBQSxVQUNmLHFCQUFxQjtBQUFBLFVBQ3JCLGVBQWU7QUFBQSxRQUNqQixDQUFDO0FBQ0QsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUNuQyxhQUFLLFFBQVE7QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDSjtBQUFBLEVBRVEseUJBQXlCLGFBQWdDO0FBQy9ELGdCQUFZLE1BQU07QUFFbEIsUUFBSSxDQUFDLEtBQUssV0FBVyxTQUFTLGdCQUFnQixRQUFRO0FBQ3BELGtCQUFZLFNBQVMsS0FBSztBQUFBLFFBQ3hCLE1BQU07QUFBQSxRQUNOLEtBQUs7QUFBQSxNQUNQLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFFQSxTQUFLLFdBQVcsU0FBUyxnQkFBZ0IsUUFBUSxDQUFDLFVBQVUsVUFBVTtBQUNwRSxZQUFNLFVBQVUsWUFBWSxTQUFTLFdBQVcsRUFBRSxLQUFLLHVCQUF1QixDQUFDO0FBQy9FLGNBQVEsT0FBTztBQUNmLGNBQVEsU0FBUyxXQUFXLEVBQUUsTUFBTSxTQUFTLFFBQVEsbUJBQW1CLFFBQVEsQ0FBQyxHQUFHLENBQUM7QUFDckYsWUFBTSxPQUFPLFFBQVEsVUFBVSxFQUFFLEtBQUssNEJBQTRCLENBQUM7QUFFbkUsV0FBSyw2QkFBNkIsTUFBTSxVQUFVLFFBQVEsd0NBQXdDLE1BQU07QUFDeEcsV0FBSyw2QkFBNkIsTUFBTSxVQUFVLFdBQVcsa0NBQWtDLFNBQVM7QUFDeEcsV0FBSyw2QkFBNkIsTUFBTSxVQUFVLGNBQWMsOENBQThDLFlBQVk7QUFDMUgsV0FBSyw2QkFBNkIsTUFBTSxVQUFVLGFBQWEsbUVBQW1FLE1BQU07QUFDeEksV0FBSyw2QkFBNkIsTUFBTSxVQUFVLGFBQWEsZ0RBQWdELFdBQVc7QUFFMUgsVUFBSSx5QkFBUSxJQUFJLEVBQ2IsUUFBUSw2QkFBNkIsRUFDckMsUUFBUSxtRUFBbUUsRUFDM0U7QUFBQSxRQUFZLENBQUMsYUFDWixTQUNHLFVBQVUsV0FBVyxtQkFBbUIsRUFDeEMsVUFBVSxlQUFlLGdCQUFnQixFQUN6QyxTQUFTLFNBQVMsaUJBQWlCLFNBQVMsRUFDNUMsU0FBUyxPQUFPLFVBQVU7QUFDekIsbUJBQVMsZ0JBQWdCO0FBQ3pCLGdCQUFNLEtBQUssV0FBVyxhQUFhO0FBQUEsUUFDckMsQ0FBQztBQUFBLE1BQ0w7QUFFRixXQUFLLDZCQUE2QixNQUFNLFVBQVUsd0JBQXdCLDBHQUEwRyxxQkFBcUI7QUFDek0sV0FBSyw2QkFBNkIsTUFBTSxVQUFVLHVCQUF1Qiw4SEFBOEgsZUFBZTtBQUN0TixXQUFLLDZCQUE2QixNQUFNLFVBQVUsNkJBQTZCLHFFQUFxRSxxQkFBcUI7QUFDekssV0FBSyw2QkFBNkIsTUFBTSxVQUFVLDRCQUE0QixtRkFBbUYsZUFBZTtBQUVoTCxVQUFJLHlCQUFRLElBQUksRUFDYixRQUFRLGlCQUFpQixFQUN6QixRQUFRLDhCQUE4QixFQUN0QztBQUFBLFFBQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxRQUFRLEVBQUUsV0FBVyxFQUFFLFFBQVEsWUFBWTtBQUM5RCxlQUFLLFdBQVcsU0FBUyxnQkFBZ0IsT0FBTyxPQUFPLENBQUM7QUFDeEQsZ0JBQU0sS0FBSyxXQUFXLGFBQWE7QUFDbkMsZUFBSyxRQUFRO0FBQUEsUUFDZixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0osQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsc0JBQXNCLGFBQXlDO0FBQzNFLFFBQUk7QUFDRixZQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVcsMkJBQTJCO0FBRWhFLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGdDQUFnQyxFQUN4QyxRQUFRLHdGQUF3RixFQUNoRyxZQUFZLENBQUMsYUFBYTtBQUN6QixpQkFBUyxVQUFVLElBQUksTUFBTTtBQUM3QixtQkFBVyxTQUFTLFFBQVE7QUFDMUIsbUJBQVMsVUFBVSxNQUFNLE1BQU0sTUFBTSxJQUFJO0FBQUEsUUFDM0M7QUFDQSxpQkFBUyxTQUFTLEtBQUssV0FBVyxTQUFTLHlCQUF5QixFQUFFO0FBQ3RFLGlCQUFTLFNBQVMsT0FBTyxVQUFVO0FBQ2pDLGVBQUssV0FBVyxTQUFTLHdCQUF3QjtBQUNqRCxnQkFBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLFFBQ3JDLENBQUM7QUFBQSxNQUNILENBQUM7QUFFSCxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxnQ0FBZ0MsRUFDeEMsUUFBUSwyREFBMkQsRUFDbkU7QUFBQSxRQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsR0FBRyxFQUFFLFFBQVEsTUFBTTtBQUN0QyxjQUFJLHdCQUF3QixLQUFLLEtBQUssT0FBTyxjQUFjO0FBQ3pELGtCQUFNLFlBQVksVUFBVSxLQUFLLEVBQUUsWUFBWSxFQUFFLFFBQVEsZ0JBQWdCLEdBQUc7QUFDNUUsZ0JBQUksQ0FBQyxXQUFXO0FBQ2Qsa0JBQUksd0JBQU8scUJBQXFCO0FBQ2hDO0FBQUEsWUFDRjtBQUVBLGtCQUFNLFlBQVksS0FBSyxXQUFXLFNBQVMsT0FBTztBQUNsRCxrQkFBTSxvQkFBb0IsR0FBRyxTQUFTLGVBQWUsU0FBUztBQUM5RCxrQkFBTSxhQUFhLEdBQUcsaUJBQWlCO0FBRXZDLGtCQUFNLFVBQVUsS0FBSyxJQUFJLE1BQU07QUFDL0IsZ0JBQUksTUFBTSxRQUFRLE9BQU8saUJBQWlCLEdBQUc7QUFDM0Msa0JBQUksd0JBQU8sd0NBQXdDO0FBQ25EO0FBQUEsWUFDRjtBQUVBLGtCQUFNLFFBQVEsTUFBTSxpQkFBaUI7QUFDckMsa0JBQU0sZ0JBQWdCO0FBQUEsY0FDcEIsU0FBUztBQUFBLGNBQ1QsT0FBTztBQUFBLGNBQ1AsV0FBVztBQUFBLGdCQUNULFFBQVE7QUFBQSxrQkFDTixTQUFTO0FBQUEsa0JBQ1QsV0FBVztBQUFBLGdCQUNiO0FBQUEsY0FDRjtBQUFBLFlBQ0Y7QUFDQSxrQkFBTSxRQUFRLE1BQU0sWUFBWSxLQUFLLFVBQVUsZUFBZSxNQUFNLENBQUMsQ0FBQztBQUN0RSxnQkFBSSx3QkFBTyxvQkFBb0IsU0FBUyxZQUFZO0FBQ3BELGlCQUFLLFFBQVE7QUFBQSxVQUNmLENBQUMsRUFBRSxLQUFLO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDSDtBQUVGLFlBQU0sU0FBUyxZQUFZLFVBQVUsRUFBRSxLQUFLLDRCQUE0QixDQUFDO0FBQ3pFLFVBQUksQ0FBQyxPQUFPLFFBQVE7QUFDbEIsZUFBTyxTQUFTLEtBQUs7QUFBQSxVQUNuQixNQUFNO0FBQUEsVUFDTixLQUFLO0FBQUEsUUFDUCxDQUFDO0FBQ0Q7QUFBQSxNQUNGO0FBRUEsaUJBQVcsU0FBUyxRQUFRO0FBQzFCLFlBQUkseUJBQVEsTUFBTSxFQUNmLFFBQVEsTUFBTSxJQUFJLEVBQ2xCLFFBQVEsTUFBTSxNQUFNLEVBQ3BCO0FBQUEsVUFBVSxDQUFDLFdBQ1YsT0FBTyxjQUFjLGlCQUFpQixFQUFFLFFBQVEsWUFBWTtBQUMxRCxrQkFBTSxLQUFLLFdBQVcsb0JBQW9CLE1BQU0sSUFBSTtBQUFBLFVBQ3RELENBQUM7QUFBQSxRQUNILEVBQ0M7QUFBQSxVQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsTUFBTSxFQUFFLFFBQVEsTUFBTTtBQUN6QyxrQkFBTSxZQUFZLEtBQUssV0FBVyxTQUFTLE9BQU87QUFDbEQsZ0JBQUksd0JBQXdCLEtBQUssWUFBWSxNQUFNLE1BQU0sV0FBVyxNQUFNO0FBQ3hFLG1CQUFLLFFBQVE7QUFBQSxZQUNmLENBQUMsRUFBRSxLQUFLO0FBQUEsVUFDVixDQUFDO0FBQUEsUUFDSDtBQUFBLE1BQ0o7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLGtCQUFZLE1BQU07QUFDbEIsa0JBQVksU0FBUyxLQUFLO0FBQUEsUUFDeEIsTUFBTSxtQ0FBbUMsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDO0FBQUEsUUFDL0YsS0FBSztBQUFBLFFBQ0wsTUFBTSxFQUFFLE9BQU8sOERBQThEO0FBQUEsTUFDL0UsQ0FBQztBQUNELGNBQVEsTUFBTSw0Q0FBNEMsS0FBSztBQUFBLElBQ2pFO0FBQUEsRUFDRjtBQUFBLEVBRVEsZUFBbUQsYUFBMEIsTUFBYyxhQUFxQixLQUFjO0FBQ3BJLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLElBQUksRUFDWixRQUFRLFdBQVcsRUFDbkI7QUFBQSxNQUFRLENBQUMsU0FDUixLQUFLLFNBQVMsT0FBTyxLQUFLLFdBQVcsU0FBUyxHQUFHLEtBQUssRUFBRSxDQUFDLEVBQUUsU0FBUyxPQUFPLFVBQVU7QUFDbkYsUUFBQyxLQUFLLFdBQVcsU0FBUyxHQUFHLElBQWUsTUFBTSxLQUFLO0FBQ3ZELGNBQU0sS0FBSyxXQUFXLGFBQWE7QUFBQSxNQUNyQyxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0o7QUFBQSxFQUVRLDZCQUNOLGFBQ0EsVUFDQSxNQUNBLGFBQ0EsS0FDTTtBQUNOLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLElBQUksRUFDWixRQUFRLFdBQVcsRUFDbkI7QUFBQSxNQUFRLENBQUMsU0FDUixLQUFLLFNBQVMsT0FBTyxTQUFTLEdBQUcsS0FBSyxFQUFFLENBQUMsRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNuRSxRQUFDLFNBQVMsR0FBRyxJQUEyQixNQUFNLEtBQUs7QUFDbkQsY0FBTSxLQUFLLFdBQVcsYUFBYTtBQUFBLE1BQ3JDLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDSjtBQUNGO0FBRU8sU0FBUyw4QkFBb0M7QUFDbEQsTUFBSSx3QkFBTyxpR0FBaUc7QUFDOUc7QUFFQSxJQUFNLDBCQUFOLGNBQXNDLHVCQUFNO0FBQUEsRUFHMUMsWUFDRSxLQUNpQixVQUNqQjtBQUNBLFVBQU0sR0FBRztBQUZRO0FBSm5CLFNBQVEsT0FBTztBQUFBLEVBT2Y7QUFBQSxFQUVBLFNBQVM7QUFDUCxVQUFNLEVBQUUsVUFBVSxJQUFJO0FBQ3RCLGNBQVUsTUFBTTtBQUNoQixjQUFVLFNBQVMsTUFBTSxFQUFFLE1BQU0sMkJBQTJCLENBQUM7QUFFN0QsUUFBSSx5QkFBUSxTQUFTLEVBQ2xCLFFBQVEsWUFBWSxFQUNwQixRQUFRLDJEQUEyRCxFQUNuRTtBQUFBLE1BQVEsQ0FBQyxTQUNSLEtBQUssU0FBUyxDQUFDLFVBQVU7QUFDdkIsYUFBSyxPQUFPO0FBQUEsTUFDZCxDQUFDO0FBQUEsSUFDSDtBQUVGLFFBQUkseUJBQVEsU0FBUyxFQUNsQjtBQUFBLE1BQVUsQ0FBQyxRQUNWLElBQ0csY0FBYyxRQUFRLEVBQ3RCLE9BQU8sRUFDUCxRQUFRLFlBQVk7QUFDbkIsY0FBTSxLQUFLLFNBQVMsS0FBSyxJQUFJO0FBQzdCLGFBQUssTUFBTTtBQUFBLE1BQ2IsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKO0FBQ0Y7QUFFQSxJQUFNLDBCQUFOLGNBQXNDLHVCQUFNO0FBQUEsRUFTMUMsWUFDbUJBLGFBQ0EsV0FDQSxXQUNBLFFBQ2pCO0FBQ0EsVUFBTUEsWUFBVyxHQUFHO0FBTEgsc0JBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBWm5CLFNBQVEsWUFBNEQ7QUFDcEUsU0FBUSxZQUFpQixDQUFDO0FBQzFCLFNBQVEsY0FBYztBQUN0QixTQUFRLGlCQUFnQztBQUN4QyxTQUFRLGtCQUFrQjtBQUFBLEVBVzFCO0FBQUEsRUFFQSxNQUFNLFNBQVM7QUFDYixVQUFNLEVBQUUsVUFBVSxJQUFJO0FBQ3RCLGNBQVUsTUFBTTtBQUNoQixjQUFVLFNBQVMsTUFBTSxFQUFFLE1BQU0sZ0JBQWdCLEtBQUssU0FBUyxHQUFHLENBQUM7QUFFbkUsVUFBTSxhQUFhLEdBQUcsS0FBSyxTQUFTLGVBQWUsS0FBSyxTQUFTO0FBQ2pFLFVBQU0saUJBQWlCLEdBQUcsS0FBSyxTQUFTLGVBQWUsS0FBSyxTQUFTO0FBQ3JFLFVBQU0sVUFBVSxLQUFLLElBQUksTUFBTTtBQUUvQixRQUFJO0FBQ0YsWUFBTSxZQUFZLE1BQU0sUUFBUSxLQUFLLFVBQVU7QUFDL0MsV0FBSyxZQUFZLEtBQUssTUFBTSxTQUFTO0FBQ3JDLFdBQUssY0FBYztBQUFBLElBQ3JCLFNBQVMsR0FBRztBQUNWLFVBQUksd0JBQU8sb0NBQW9DO0FBQy9DLFdBQUssTUFBTTtBQUNYO0FBQUEsSUFDRjtBQUVBLFFBQUk7QUFDRixVQUFJLE1BQU0sUUFBUSxPQUFPLGNBQWMsR0FBRztBQUN4QyxhQUFLLGlCQUFpQixNQUFNLFFBQVEsS0FBSyxjQUFjO0FBQUEsTUFDekQsT0FBTztBQUNMLGFBQUssaUJBQWlCO0FBQUEsTUFDeEI7QUFBQSxJQUNGLFNBQVMsR0FBRztBQUNWLFdBQUssaUJBQWlCO0FBQUEsSUFDeEI7QUFFQSxVQUFNLFlBQVksVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUduRSxTQUFLLGNBQWMsVUFBVSxVQUFVLEVBQUUsS0FBSyxrQkFBa0IsQ0FBQztBQUNqRSxTQUFLLFdBQVc7QUFHaEIsU0FBSyxlQUFlLFVBQVUsVUFBVSxFQUFFLEtBQUssbUJBQW1CLENBQUM7QUFHbkUsVUFBTSxVQUFVLFVBQVUsVUFBVSxFQUFFLEtBQUsscUJBQXFCLENBQUM7QUFDakUsWUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLFNBQVMsQ0FBQyxFQUFFLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDM0YsVUFBTSxVQUFVLFFBQVEsU0FBUyxVQUFVLEVBQUUsTUFBTSxRQUFRLEtBQUssVUFBVSxDQUFDO0FBQzNFLFlBQVEsaUJBQWlCLFNBQVMsWUFBWTtBQUM1QyxZQUFNLEtBQUssYUFBYTtBQUFBLElBQzFCLENBQUM7QUFFRCxTQUFLLGdCQUFnQjtBQUFBLEVBQ3ZCO0FBQUEsRUFFQSxhQUFhO0FBQ1gsU0FBSyxZQUFZLE1BQU07QUFDdkIsVUFBTSxPQUFxRjtBQUFBLE1BQ3pGLEVBQUUsSUFBSSxXQUFXLE9BQU8sVUFBVTtBQUFBLE1BQ2xDLEVBQUUsSUFBSSxhQUFhLE9BQU8sWUFBWTtBQUFBLE1BQ3RDLEVBQUUsSUFBSSxjQUFjLE9BQU8sYUFBYTtBQUFBLE1BQ3hDLEVBQUUsSUFBSSxPQUFPLE9BQU8sV0FBVztBQUFBLElBQ2pDO0FBRUEsZUFBVyxPQUFPLE1BQU07QUFDdEIsWUFBTSxNQUFNLEtBQUssWUFBWSxTQUFTLFVBQVU7QUFBQSxRQUM5QyxNQUFNLElBQUk7QUFBQSxRQUNWLEtBQUssa0JBQWtCLEtBQUssY0FBYyxJQUFJLEtBQUssZUFBZTtBQUFBLE1BQ3BFLENBQUM7QUFDRCxVQUFJLGlCQUFpQixTQUFTLE1BQU07QUFDbEMsYUFBSyxLQUFLLFVBQVUsSUFBSSxFQUFFO0FBQUEsTUFDNUIsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFVBQVUsS0FBcUQ7QUFDbkUsUUFBSSxLQUFLLGNBQWMsT0FBTztBQUM1QixVQUFJO0FBQ0YsYUFBSyxZQUFZLEtBQUssTUFBTSxLQUFLLFdBQVc7QUFBQSxNQUM5QyxTQUFTLEdBQUc7QUFDVixZQUFJLHdCQUFPLHNFQUFzRTtBQUNqRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsU0FBSyxZQUFZO0FBQ2pCLFNBQUssV0FBVztBQUNoQixTQUFLLGdCQUFnQjtBQUFBLEVBQ3ZCO0FBQUEsRUFFQSxrQkFBa0I7QUFDaEIsU0FBSyxhQUFhLE1BQU07QUFDeEIsUUFBSSxLQUFLLGNBQWMsV0FBVztBQUNoQyxXQUFLLGlCQUFpQixLQUFLLFlBQVk7QUFBQSxJQUN6QyxXQUFXLEtBQUssY0FBYyxhQUFhO0FBQ3pDLFdBQUssbUJBQW1CLEtBQUssWUFBWTtBQUFBLElBQzNDLFdBQVcsS0FBSyxjQUFjLGNBQWM7QUFDMUMsV0FBSyxvQkFBb0IsS0FBSyxZQUFZO0FBQUEsSUFDNUMsV0FBVyxLQUFLLGNBQWMsT0FBTztBQUNuQyxXQUFLLGFBQWEsS0FBSyxZQUFZO0FBQUEsSUFDckM7QUFBQSxFQUNGO0FBQUEsRUFFQSxpQkFBaUIsYUFBMEI7QUFFekMsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsU0FBUyxFQUNqQixRQUFRLG1EQUFtRCxFQUMzRCxZQUFZLENBQUMsYUFBYTtBQUN6QixlQUNHLFVBQVUsVUFBVSxRQUFRLEVBQzVCLFVBQVUsVUFBVSxRQUFRLEVBQzVCLFVBQVUsT0FBTyxLQUFLLEVBQ3RCLFVBQVUsUUFBUSxNQUFNLEVBQ3hCLFVBQVUsVUFBVSxRQUFRLEVBQzVCLFNBQVMsS0FBSyxVQUFVLFdBQVcsUUFBUSxFQUMzQyxTQUFTLENBQUMsVUFBVTtBQUNuQixhQUFLLFVBQVUsVUFBVTtBQUN6QixhQUFLLGdCQUFnQjtBQUFBLE1BQ3ZCLENBQUM7QUFBQSxJQUNMLENBQUM7QUFHSCxRQUNFLEtBQUssVUFBVSxZQUFZLFlBQzNCLEtBQUssVUFBVSxZQUFZLFlBQzNCLEtBQUssVUFBVSxZQUFZLE9BQzNCO0FBQ0EsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsS0FBSyxVQUFVLFlBQVksUUFBUSxlQUFlLFlBQVksRUFDdEU7QUFBQSxRQUNDLEtBQUssVUFBVSxZQUFZLFFBQ3ZCLDJFQUNBO0FBQUEsTUFDTixFQUNDLFFBQVEsQ0FBQyxTQUFTO0FBQ2pCLGFBQ0csU0FBUyxLQUFLLFVBQVUsU0FBUyxFQUFFLEVBQ25DLFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxRQUFRLElBQUksS0FBSztBQUFBLFFBQ2xDLENBQUM7QUFBQSxNQUNMLENBQUM7QUFBQSxJQUNMO0FBRUEsUUFBSSxDQUFDLEtBQUssVUFBVSxhQUFhLE9BQU8sS0FBSyxVQUFVLGNBQWMsVUFBVTtBQUM3RSxXQUFLLFVBQVUsWUFBWSxFQUFFLE1BQU0sVUFBVTtBQUFBLElBQy9DO0FBRUEsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsV0FBVyxFQUNuQjtBQUFBLE1BQ0MsS0FBSyxVQUFVLFlBQVksWUFBWSxLQUFLLFVBQVUsWUFBWSxXQUM5RCw4RUFDQTtBQUFBLElBQ04sRUFDQyxZQUFZLENBQUMsYUFBYTtBQUN6QixlQUNHLFVBQVUsV0FBVyxTQUFTLEVBQzlCLFVBQVUsUUFBUSxNQUFNLEVBQ3hCLFNBQVMsS0FBSyxVQUFVLFVBQVUsUUFBUSxTQUFTLEVBQ25ELFNBQVMsQ0FBQyxVQUFVO0FBQ25CLGFBQUssVUFBVSxVQUFVLE9BQU87QUFDaEMsYUFBSyxnQkFBZ0I7QUFBQSxNQUN2QixDQUFDO0FBQUEsSUFDTCxDQUFDO0FBRUgsUUFDRSxLQUFLLFVBQVUsVUFBVSxTQUFTLFdBQ2pDLEtBQUssVUFBVSxZQUFZLFVBQVUsS0FBSyxVQUFVLFlBQVksU0FBUyxLQUFLLFVBQVUsWUFBWSxXQUNyRztBQUNBLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLDBCQUEwQixFQUNsQyxRQUFRLDBHQUEwRyxFQUNsSCxRQUFRLENBQUMsU0FBUztBQUNqQixhQUNHLGVBQWUsU0FBUyxFQUN4QixTQUFTLEtBQUssVUFBVSxVQUFVLGlCQUFpQixFQUFFLEVBQ3JELFNBQVMsQ0FBQyxRQUFRO0FBQ2pCLGVBQUssVUFBVSxVQUFVLGdCQUFnQixJQUFJLEtBQUssS0FBSztBQUFBLFFBQ3pELENBQUM7QUFBQSxNQUNMLENBQUM7QUFBQSxJQUNMO0FBRUEsUUFBSSxLQUFLLFVBQVUsWUFBWSxPQUFPO0FBQ3BDLFVBQUksQ0FBQyxLQUFLLFVBQVUsS0FBSztBQUN2QixhQUFLLFVBQVUsTUFBTSxDQUFDO0FBQUEsTUFDeEI7QUFDQSxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSx1QkFBdUIsRUFDL0IsUUFBUSxxR0FBcUcsRUFDN0csVUFBVSxDQUFDLFdBQVc7QUFDckIsZUFDRyxTQUFTLEtBQUssVUFBVSxJQUFJLGVBQWUsS0FBSyxFQUNoRCxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsSUFBSSxjQUFjO0FBQUEsUUFDbkMsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUFBLElBQ0w7QUFHQSxRQUFJLEtBQUssVUFBVSxZQUFZLFFBQVE7QUFDckMsVUFBSSxDQUFDLEtBQUssVUFBVSxNQUFNO0FBQ3hCLGFBQUssVUFBVSxPQUFPLEVBQUUsV0FBVyxJQUFJLGlCQUFpQixHQUFHO0FBQUEsTUFDN0Q7QUFFQSxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxZQUFZLEVBQ3BCLFFBQVEsK0RBQStELEVBQ3ZFLFFBQVEsQ0FBQyxTQUFTO0FBQ2pCLGFBQ0csU0FBUyxLQUFLLFVBQVUsS0FBSyxhQUFhLEVBQUUsRUFDNUMsU0FBUyxDQUFDLFFBQVE7QUFDakIsZUFBSyxVQUFVLEtBQUssWUFBWSxJQUFJLEtBQUs7QUFBQSxRQUMzQyxDQUFDO0FBQUEsTUFDTCxDQUFDO0FBRUgsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsa0JBQWtCLEVBQzFCLFFBQVEseUZBQXlGLEVBQ2pHLFFBQVEsQ0FBQyxTQUFTO0FBQ2pCLGFBQ0csU0FBUyxLQUFLLFVBQVUsS0FBSyxtQkFBbUIsRUFBRSxFQUNsRCxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsS0FBSyxrQkFBa0IsSUFBSSxLQUFLO0FBQUEsUUFDakQsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUVILFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGdCQUFnQixFQUN4QixRQUFRLDREQUE0RCxFQUNwRSxRQUFRLENBQUMsU0FBUztBQUNqQixhQUNHLFNBQVMsS0FBSyxVQUFVLEtBQUssaUJBQWlCLEVBQUUsRUFDaEQsU0FBUyxDQUFDLFFBQVE7QUFDakIsZUFBSyxVQUFVLEtBQUssZ0JBQWdCLElBQUksS0FBSyxLQUFLO0FBQUEsUUFDcEQsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUVILFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGVBQWUsRUFDdkIsUUFBUSxxQ0FBcUMsRUFDN0MsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxLQUFLLFdBQVcsRUFBRSxFQUMxQyxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsS0FBSyxVQUFVLElBQUksS0FBSyxLQUFLO0FBQUEsUUFDOUMsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUFBLElBQ0w7QUFHQSxRQUFJLEtBQUssVUFBVSxZQUFZLFVBQVU7QUFDdkMsVUFBSSxDQUFDLEtBQUssVUFBVSxRQUFRO0FBQzFCLGFBQUssVUFBVSxTQUFTLEVBQUUsWUFBWSxHQUFHO0FBQUEsTUFDM0M7QUFFQSxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxtQkFBbUIsRUFDM0IsUUFBUSxzREFBc0QsRUFDOUQsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxPQUFPLGNBQWMsRUFBRSxFQUMvQyxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsT0FBTyxhQUFhLElBQUksS0FBSztBQUFBLFFBQzlDLENBQUM7QUFBQSxNQUNMLENBQUM7QUFFSCxVQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxrQkFBa0IsRUFDMUIsUUFBUSxrRUFBa0UsRUFDMUUsUUFBUSxDQUFDLFNBQVM7QUFDakIsYUFDRyxTQUFTLEtBQUssVUFBVSxPQUFPLFFBQVEsRUFBRSxFQUN6QyxTQUFTLENBQUMsUUFBUTtBQUNqQixlQUFLLFVBQVUsT0FBTyxPQUFPLElBQUksS0FBSyxLQUFLO0FBQUEsUUFDN0MsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNGO0FBQUEsRUFFQSxtQkFBbUIsYUFBMEI7QUFDM0MsZ0JBQVksU0FBUyxNQUFNLEVBQUUsTUFBTSx1QkFBdUIsQ0FBQztBQUUzRCxRQUFJLENBQUMsS0FBSyxVQUFVLFdBQVc7QUFDN0IsV0FBSyxVQUFVLFlBQVksQ0FBQztBQUFBLElBQzlCO0FBRUEsVUFBTSxjQUFjLFlBQVksVUFBVSxFQUFFLEtBQUssc0JBQXNCLENBQUM7QUFDeEUsVUFBTSxZQUFZLE9BQU8sUUFBUSxLQUFLLFVBQVUsU0FBMkY7QUFFM0ksUUFBSSxVQUFVLFdBQVcsR0FBRztBQUMxQixrQkFBWSxTQUFTLEtBQUssRUFBRSxNQUFNLDJDQUEyQyxLQUFLLDJCQUEyQixDQUFDO0FBQUEsSUFDaEgsT0FBTztBQUNMLGlCQUFXLENBQUMsVUFBVSxVQUFVLEtBQUssV0FBVztBQUM5QyxjQUFNLE9BQU8sWUFBWSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNoRSxhQUFLLFNBQVMsVUFBVSxFQUFFLE1BQU0sVUFBVSxNQUFNLEVBQUUsT0FBTywyREFBMkQsRUFBRSxDQUFDO0FBRXZILGNBQU0sWUFBYSxXQUFtQixlQUFlO0FBRXJELFlBQUkseUJBQVEsSUFBSSxFQUNiLFFBQVEsMkJBQTJCLEVBQ25DLFFBQVEsaUZBQWlGLEVBQ3pGLFVBQVUsQ0FBQyxXQUFXO0FBQ3JCLGlCQUNHLFNBQVMsU0FBUyxFQUNsQixTQUFTLENBQUMsUUFBUTtBQUNqQixnQkFBSSxLQUFLO0FBQ1AsY0FBQyxXQUFtQixhQUFhO0FBQ2pDLHFCQUFPLFdBQVc7QUFDbEIscUJBQU8sV0FBVztBQUFBLFlBQ3BCLE9BQU87QUFDTCxxQkFBUSxXQUFtQjtBQUMzQixvQkFBTSxXQUFXLEtBQUssV0FBVyxnQkFBZ0IseUJBQXlCLFVBQVUsS0FBSyxXQUFXLFFBQVE7QUFDNUcseUJBQVcsVUFBVSxVQUFVLFdBQVc7QUFDMUMseUJBQVcsWUFBWSxVQUFVLGFBQWE7QUFBQSxZQUNoRDtBQUNBLGlCQUFLLGdCQUFnQjtBQUFBLFVBQ3ZCLENBQUM7QUFBQSxRQUNMLENBQUM7QUFFSCxZQUFJLHlCQUFRLElBQUksRUFDYixRQUFRLFNBQVMsRUFDakIsUUFBUSw4REFBOEQsRUFDdEUsUUFBUSxDQUFDLFNBQVM7QUFDakIsZ0JBQU0sV0FBVyxLQUFLLFdBQVcsZ0JBQWdCLHlCQUF5QixVQUFVLEtBQUssV0FBVyxRQUFRO0FBQzVHLGVBQ0csZUFBZSxVQUFVLFdBQVcsRUFBRSxFQUN0QyxTQUFTLFdBQVcsV0FBVyxFQUFFLEVBQ2pDLFlBQVksU0FBUyxFQUNyQixTQUFTLENBQUMsUUFBUTtBQUNqQix1QkFBVyxVQUFVLElBQUksS0FBSztBQUFBLFVBQ2hDLENBQUM7QUFBQSxRQUNMLENBQUM7QUFFSCxZQUFJLHlCQUFRLElBQUksRUFDYixRQUFRLFdBQVcsRUFDbkIsUUFBUSx3Q0FBd0MsRUFDaEQsUUFBUSxDQUFDLFNBQVM7QUFDakIsZ0JBQU0sV0FBVyxLQUFLLFdBQVcsZ0JBQWdCLHlCQUF5QixVQUFVLEtBQUssV0FBVyxRQUFRO0FBQzVHLGVBQ0csZUFBZSxVQUFVLGFBQWEsRUFBRSxFQUN4QyxTQUFTLFdBQVcsYUFBYSxFQUFFLEVBQ25DLFlBQVksU0FBUyxFQUNyQixTQUFTLENBQUMsUUFBUTtBQUNqQix1QkFBVyxZQUFZLElBQUksS0FBSztBQUFBLFVBQ2xDLENBQUM7QUFBQSxRQUNMLENBQUM7QUFFSCxZQUFJLHlCQUFRLElBQUksRUFDYixVQUFVLENBQUMsUUFBUTtBQUNsQixjQUNHLGNBQWMsaUJBQWlCLEVBQy9CLFdBQVcsRUFDWCxRQUFRLE1BQU07QUFDYixtQkFBTyxLQUFLLFVBQVUsVUFBVSxRQUFRO0FBQ3hDLGlCQUFLLGdCQUFnQjtBQUFBLFVBQ3ZCLENBQUM7QUFBQSxRQUNMLENBQUM7QUFBQSxNQUNMO0FBQUEsSUFDRjtBQUdBLGdCQUFZLFNBQVMsTUFBTSxFQUFFLE1BQU0sd0JBQXdCLE1BQU0sRUFBRSxPQUFPLHNCQUFzQixFQUFFLENBQUM7QUFDbkcsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsYUFBYSxFQUNyQixRQUFRLG1DQUFtQyxFQUMzQyxRQUFRLENBQUMsU0FBUztBQUNqQixXQUFLLFNBQVMsS0FBSyxlQUFlLEVBQUUsU0FBUyxDQUFDLFFBQVE7QUFDcEQsYUFBSyxrQkFBa0IsSUFBSSxLQUFLLEVBQUUsWUFBWTtBQUFBLE1BQ2hELENBQUM7QUFBQSxJQUNILENBQUMsRUFDQSxVQUFVLENBQUMsUUFBUTtBQUNsQixVQUFJLGNBQWMsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLE1BQU07QUFDaEQsWUFBSSxDQUFDLEtBQUssaUJBQWlCO0FBQ3pCLGNBQUksd0JBQU8sK0JBQStCO0FBQzFDO0FBQUEsUUFDRjtBQUNBLFlBQUksS0FBSyxVQUFVLFVBQVUsS0FBSyxlQUFlLEdBQUc7QUFDbEQsY0FBSSx3QkFBTyw4QkFBOEI7QUFDekM7QUFBQSxRQUNGO0FBQ0EsYUFBSyxVQUFVLFVBQVUsS0FBSyxlQUFlLElBQUk7QUFBQSxVQUMvQyxTQUFTLEdBQUcsS0FBSyxlQUFlO0FBQUEsVUFDaEMsV0FBVyxJQUFJLEtBQUssZUFBZTtBQUFBLFFBQ3JDO0FBQ0EsYUFBSyxrQkFBa0I7QUFDdkIsYUFBSyxnQkFBZ0I7QUFBQSxNQUN2QixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDTDtBQUFBLEVBRUEsb0JBQW9CLGFBQTBCO0FBQzVDLFFBQUksS0FBSyxVQUFVLFlBQVksWUFBWSxLQUFLLFVBQVUsWUFBWSxVQUFVO0FBQzlFLGtCQUFZLFNBQVMsS0FBSztBQUFBLFFBQ3hCLE1BQU0seUZBQXlGLEtBQUssVUFBVSxPQUFPO0FBQUEsUUFDckgsS0FBSztBQUFBLE1BQ1AsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUVBLFFBQUksS0FBSyxtQkFBbUIsTUFBTTtBQUNoQyxrQkFBWSxTQUFTLEtBQUs7QUFBQSxRQUN4QixNQUFNO0FBQUEsUUFDTixLQUFLO0FBQUEsTUFDUCxDQUFDO0FBRUQsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFVBQVUsQ0FBQyxRQUFRO0FBQ2xCLFlBQ0csY0FBYyxtQkFBbUIsRUFDakMsT0FBTyxFQUNQLFFBQVEsTUFBTTtBQUNiLGVBQUssaUJBQWlCO0FBQUEsWUFDcEI7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRixFQUFFLEtBQUssSUFBSTtBQUNYLGVBQUssZ0JBQWdCO0FBQUEsUUFDdkIsQ0FBQztBQUFBLE1BQ0wsQ0FBQztBQUFBLElBQ0wsT0FBTztBQUNMLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLG9CQUFvQixFQUM1QixRQUFRLHdEQUF3RCxFQUNoRSxZQUFZLENBQUMsU0FBUztBQUNyQixhQUFLLFFBQVEsT0FBTztBQUNwQixhQUFLLFFBQVEsTUFBTSxhQUFhO0FBQ2hDLGFBQUssUUFBUSxNQUFNLFFBQVE7QUFDM0IsYUFBSyxTQUFTLEtBQUssa0JBQWtCLEVBQUU7QUFDdkMsYUFBSyxTQUFTLENBQUMsUUFBUTtBQUNyQixlQUFLLGlCQUFpQjtBQUFBLFFBQ3hCLENBQUM7QUFBQSxNQUNILENBQUM7QUFBQSxJQUNMO0FBQUEsRUFDRjtBQUFBLEVBRUEsYUFBYSxhQUEwQjtBQUNyQyxTQUFLLGNBQWMsS0FBSyxVQUFVLEtBQUssV0FBVyxNQUFNLENBQUM7QUFDekQsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsb0JBQW9CLEVBQzVCLFlBQVksQ0FBQyxTQUFTO0FBQ3JCLFdBQUssUUFBUSxPQUFPO0FBQ3BCLFdBQUssUUFBUSxNQUFNLGFBQWE7QUFDaEMsV0FBSyxRQUFRLE1BQU0sUUFBUTtBQUMzQixXQUFLLFNBQVMsS0FBSyxXQUFXO0FBQzlCLFdBQUssU0FBUyxDQUFDLFFBQVE7QUFDckIsYUFBSyxjQUFjO0FBQUEsTUFDckIsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0w7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUVuQixRQUFJLEtBQUssY0FBYyxPQUFPO0FBQzVCLFVBQUk7QUFDRixhQUFLLFlBQVksS0FBSyxNQUFNLEtBQUssV0FBVztBQUFBLE1BQzlDLFNBQVMsR0FBRztBQUNWLFlBQUksd0JBQU8sbUVBQW1FO0FBQzlFO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFHQSxRQUFJLENBQUMsS0FBSyxVQUFVLFNBQVM7QUFDM0IsVUFBSSx3QkFBTyxzQkFBc0I7QUFDakM7QUFBQSxJQUNGO0FBQ0EsUUFBSSxLQUFLLFVBQVUsWUFBWSxXQUFXLENBQUMsS0FBSyxVQUFVLE1BQU0sYUFBYSxDQUFDLEtBQUssVUFBVSxNQUFNLGtCQUFrQjtBQUNuSCxVQUFJLHdCQUFPLHdEQUF3RDtBQUNuRTtBQUFBLElBQ0Y7QUFDQSxRQUFJLEtBQUssVUFBVSxZQUFZLFlBQVksQ0FBQyxLQUFLLFVBQVUsUUFBUSxZQUFZO0FBQzdFLFVBQUksd0JBQU8sNENBQTRDO0FBQ3ZEO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxLQUFLLElBQUksTUFBTTtBQUMvQixVQUFNLGFBQWEsR0FBRyxLQUFLLFNBQVMsZUFBZSxLQUFLLFNBQVM7QUFDakUsVUFBTSxpQkFBaUIsR0FBRyxLQUFLLFNBQVMsZUFBZSxLQUFLLFNBQVM7QUFFckUsUUFBSTtBQUVGLFlBQU0sWUFBWSxLQUFLLFVBQVUsS0FBSyxXQUFXLE1BQU0sQ0FBQztBQUN4RCxZQUFNLFFBQVEsTUFBTSxZQUFZLFNBQVM7QUFHekMsVUFBSSxLQUFLLFVBQVUsWUFBWSxZQUFZLEtBQUssVUFBVSxZQUFZLFVBQVU7QUFDOUUsWUFBSSxLQUFLLG1CQUFtQixNQUFNO0FBQ2hDLGdCQUFNLFFBQVEsTUFBTSxnQkFBZ0IsS0FBSyxjQUFjO0FBQUEsUUFDekQ7QUFBQSxNQUNGO0FBRUEsVUFBSSx3QkFBTyx1Q0FBdUM7QUFDbEQsV0FBSyxPQUFPO0FBQ1osV0FBSyxNQUFNO0FBQUEsSUFDYixTQUFTLE9BQU87QUFDZCxVQUFJLHdCQUFPLGdCQUFnQixpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQUMsRUFBRTtBQUFBLElBQ3JGO0FBQUEsRUFDRjtBQUNGOzs7QUMza0NBLElBQUFDLHdCQUFzQjtBQUN0QixJQUFBQyxtQkFBdUM7QUFDdkMsSUFBQUMsYUFBdUI7QUFDdkIsSUFBQUMsZUFBcUI7QUFrRnJCLGVBQXNCLHdCQUNwQixRQUNBLFdBQ0EsVUFDQSxTQUNBLE1BQzZCO0FBQzdCLE1BQUksTUFBTSxtQkFBbUIsV0FBVyxLQUFLLEdBQUc7QUFDOUMsV0FBTyxLQUFLLGtCQUFrQixTQUFTLGdCQUNuQyxvQ0FBb0MsUUFBUSxXQUFXLFVBQVUsU0FBUyxLQUFLLGlCQUFpQixJQUNoRyxnQ0FBZ0MsUUFBUSxXQUFXLFVBQVUsU0FBUyxLQUFLLGlCQUFpQjtBQUFBLEVBQ2xHO0FBRUEsTUFBSSxhQUFhLFlBQVksTUFBTTtBQUNqQyxXQUFPLDhCQUE4QixRQUFRLFdBQVcsU0FBUyxJQUFJO0FBQUEsRUFDdkU7QUFFQSxTQUFPLGdDQUFnQyxRQUFRLFdBQVcsVUFBVSxPQUFPO0FBQzdFO0FBRUEsU0FBUyxnQ0FDUCxRQUNBLFdBQ0EsVUFDQSxTQUNvQjtBQUNwQixRQUFNLFFBQVEsT0FBTyxNQUFNLE9BQU87QUFDbEMsUUFBTSxnQkFBZ0IsVUFBVSxhQUM1QixnQkFBZ0IsT0FBTyxVQUFVLFVBQVUsVUFBVSxJQUNyRCxjQUFjLE9BQU8sU0FBUztBQUVsQyxNQUFJLENBQUMsZUFBZTtBQUNsQixVQUFNLFNBQVMsVUFBVSxhQUFhLFVBQVUsVUFBVSxVQUFVLEtBQUs7QUFDekUsVUFBTSxJQUFJLE1BQU0scUJBQXFCLE1BQU0sU0FBUyxVQUFVLFFBQVEsR0FBRztBQUFBLEVBQzNFO0FBRUEsUUFBTSxXQUFXLFlBQVksT0FBTyxhQUFhO0FBQ2pELFFBQU0sZUFBZSxVQUFVLG9CQUMzQix3QkFBd0IsT0FBTyxVQUFVLGVBQWUsUUFBUSxJQUNoRTtBQUNKLFFBQU0sVUFBVSxDQUFDLGNBQWMsVUFBVSxRQUFRLEtBQUssSUFBSSxVQUFVLEVBQUUsRUFDbkUsT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDNUIsS0FBSyxNQUFNO0FBRWQsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLGFBQWEsd0JBQXdCLFdBQVcsYUFBYTtBQUFBLEVBQy9EO0FBQ0Y7QUFFQSxlQUFlLGdDQUNiLFFBQ0EsV0FDQSxVQUNBLFNBQ0EsV0FDNkI7QUFDN0IsUUFBTSxVQUFVLFVBQU0sOEJBQVEsdUJBQUssbUJBQU8sR0FBRyxlQUFlLENBQUM7QUFDN0QsUUFBTSxpQkFBYSxtQkFBSyxTQUFTLFlBQVk7QUFDN0MsUUFBTSxrQkFBYyxtQkFBSyxTQUFTLGFBQWE7QUFDL0MsUUFBTSxrQkFBYyxtQkFBSyxTQUFTLGNBQWM7QUFFaEQsTUFBSTtBQUNGLFVBQU0sVUFBVTtBQUFBLE1BQ2Q7QUFBQSxNQUNBLFVBQVUsVUFBVTtBQUFBLE1BQ3BCLFlBQVksVUFBVSxjQUFjO0FBQUEsTUFDcEMsV0FBVyxVQUFVLGFBQWE7QUFBQSxNQUNsQyxTQUFTLFVBQVUsV0FBVztBQUFBLE1BQzlCLG1CQUFtQixVQUFVO0FBQUEsTUFDN0I7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUNBLGNBQU0sNEJBQVUsWUFBWSxRQUFRLE1BQU07QUFDMUMsY0FBTSw0QkFBVSxhQUFhLFNBQVMsTUFBTTtBQUM1QyxjQUFNLDRCQUFVLGFBQWEsS0FBSyxVQUFVLFNBQVMsTUFBTSxDQUFDLEdBQUcsTUFBTTtBQUVyRSxVQUFNLFNBQVMsTUFBTSxxQkFBcUIsV0FBVztBQUFBLE1BQ25EO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0YsQ0FBQztBQUNELFVBQU0sU0FBUyw2QkFBNkIsTUFBTTtBQUNsRCxVQUFNLFVBQVUsT0FBTyxXQUFXO0FBQUEsTUFDaEMsR0FBSSxPQUFPLFdBQVcsQ0FBQztBQUFBLE1BQ3ZCLEdBQUksT0FBTyxnQkFBZ0IsQ0FBQztBQUFBLE1BQzVCLE9BQU8sWUFBWTtBQUFBLE1BQ25CLFFBQVEsS0FBSyxJQUFJLFVBQVU7QUFBQSxJQUM3QixFQUFFLE9BQU8sQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBRTNDLFFBQUksQ0FBQyxRQUFRLEtBQUssR0FBRztBQUNuQixZQUFNLElBQUksTUFBTSw4Q0FBOEM7QUFBQSxJQUNoRTtBQUVBLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxhQUFhLE9BQU8sYUFBYSxLQUFLLEtBQUssd0JBQXdCLFdBQVcsSUFBSTtBQUFBLElBQ3BGO0FBQUEsRUFDRixVQUFFO0FBQ0EsY0FBTSxxQkFBRyxTQUFTLEVBQUUsV0FBVyxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBQUEsRUFDcEQ7QUFDRjtBQUVBLGVBQWUsb0NBQ2IsUUFDQSxXQUNBLFVBQ0EsU0FDQSxXQUM2QjtBQUM3QixRQUFNLFVBQVUsVUFBTSw4QkFBUSx1QkFBSyxtQkFBTyxHQUFHLGVBQWUsQ0FBQztBQUM3RCxRQUFNLGlCQUFhLG1CQUFLLFNBQVMsWUFBWTtBQUM3QyxRQUFNLGtCQUFjLG1CQUFLLFNBQVMsYUFBYTtBQUMvQyxRQUFNLGtCQUFjLG1CQUFLLFNBQVMsY0FBYztBQUVoRCxNQUFJO0FBQ0YsVUFBTSxVQUFVO0FBQUEsTUFDZDtBQUFBLE1BQ0EsVUFBVSxVQUFVO0FBQUEsTUFDcEIsWUFBWSxVQUFVLGNBQWM7QUFBQSxNQUNwQyxXQUFXLFVBQVUsYUFBYTtBQUFBLE1BQ2xDLFNBQVMsVUFBVSxXQUFXO0FBQUEsTUFDOUIsbUJBQW1CLFVBQVU7QUFBQSxNQUM3QjtBQUFBLE1BQ0E7QUFBQSxNQUNBLGdCQUFnQjtBQUFBLElBQ2xCO0FBQ0EsY0FBTSw0QkFBVSxZQUFZLFFBQVEsTUFBTTtBQUMxQyxjQUFNLDRCQUFVLGFBQWEsU0FBUyxNQUFNO0FBQzVDLGNBQU0sNEJBQVUsYUFBYSxLQUFLLFVBQVUsU0FBUyxNQUFNLENBQUMsR0FBRyxNQUFNO0FBRXJFLFVBQU0sU0FBUyxNQUFNLHFCQUFxQixXQUFXO0FBQUEsTUFDbkQ7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDO0FBQ0QsVUFBTSxTQUFTLHdCQUF3QixNQUFNO0FBQzdDLFVBQU0sb0JBQW9CLE9BQU8sYUFBYSxRQUFRLFFBQVE7QUFDOUQsVUFBTSxlQUFlLFVBQVUsYUFBYSxPQUFPLFVBQVUsVUFBVSxVQUFVLEtBQUssVUFBVSxhQUFhO0FBQzdHLFVBQU0scUJBQTBDO0FBQUEsTUFDOUMsR0FBRztBQUFBLE1BQ0gsVUFBVSxHQUFHLFVBQVUsUUFBUSxjQUFjLHNCQUFzQixRQUFRLFFBQVEsR0FBRztBQUFBLE1BQ3RGLFlBQVk7QUFBQSxJQUNkO0FBQ0EsVUFBTSxXQUFXLGdDQUFnQyxPQUFPLGlCQUFpQixvQkFBb0IsbUJBQW1CLE9BQU8sV0FBVyxPQUFPO0FBRXpJLFdBQU87QUFBQSxNQUNMLFNBQVMsU0FBUztBQUFBLE1BQ2xCLGFBQWEsT0FBTyxhQUFhLEtBQUssS0FBSyxHQUFHLFVBQVUsUUFBUSxJQUFJLFVBQVUsY0FBYyxhQUFhO0FBQUEsSUFDM0c7QUFBQSxFQUNGLFVBQUU7QUFDQSxjQUFNLHFCQUFHLFNBQVMsRUFBRSxXQUFXLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxFQUNwRDtBQUNGO0FBRUEsZUFBZSxxQkFDYixXQUNBLFFBT2lCO0FBQ2pCLFFBQU0sT0FBTyxVQUFVLEtBQUssSUFBSSxDQUFDLFFBQVEsSUFDdEMsV0FBVyxhQUFhLE9BQU8sV0FBVyxFQUMxQyxXQUFXLFlBQVksT0FBTyxVQUFVLEVBQ3hDLFdBQVcsVUFBVSxPQUFPLFVBQVUsRUFDdEMsV0FBVyxhQUFhLE9BQU8sV0FBVyxFQUMxQyxXQUFXLFlBQVksT0FBTyxVQUFVLGNBQWMsRUFBRSxFQUN4RCxXQUFXLGVBQWUsT0FBTyxVQUFVLGFBQWEsT0FBTyxLQUFLLE9BQU8sT0FBTyxVQUFVLFNBQVMsQ0FBQyxFQUN0RyxXQUFXLGFBQWEsT0FBTyxVQUFVLFdBQVcsT0FBTyxLQUFLLE9BQU8sT0FBTyxVQUFVLE9BQU8sQ0FBQyxFQUNoRyxXQUFXLFVBQVUsT0FBTyxVQUFVLG9CQUFvQixTQUFTLE9BQU8sRUFDMUUsV0FBVyxjQUFjLE9BQU8sUUFBUSxDQUFDO0FBRTVDLFNBQU8sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3RDLFVBQU0sWUFBUSw2QkFBTSxVQUFVLFlBQVksTUFBTTtBQUFBLE1BQzlDLEtBQUssVUFBVTtBQUFBLE1BQ2YsT0FBTyxDQUFDLFFBQVEsUUFBUSxNQUFNO0FBQUEsSUFDaEMsQ0FBQztBQUNELFFBQUksU0FBUztBQUNiLFFBQUksU0FBUztBQUNiLFVBQU0sVUFBVSxXQUFXLE1BQU07QUFDL0IsWUFBTSxLQUFLLFNBQVM7QUFDcEIsYUFBTyxJQUFJLE1BQU0sMkNBQTJDLFVBQVUsU0FBUyxNQUFNLENBQUM7QUFBQSxJQUN4RixHQUFHLFVBQVUsU0FBUztBQUV0QixVQUFNLE9BQU8sWUFBWSxNQUFNO0FBQy9CLFVBQU0sT0FBTyxZQUFZLE1BQU07QUFDL0IsVUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLFVBQWtCO0FBQ3pDLGdCQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsVUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLFVBQWtCO0FBQ3pDLGdCQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsVUFBTSxHQUFHLFNBQVMsQ0FBQyxVQUFVO0FBQzNCLG1CQUFhLE9BQU87QUFDcEIsYUFBTyxLQUFLO0FBQUEsSUFDZCxDQUFDO0FBQ0QsVUFBTSxHQUFHLFNBQVMsQ0FBQyxTQUFTO0FBQzFCLG1CQUFhLE9BQU87QUFDcEIsVUFBSSxTQUFTLEdBQUc7QUFDZCxlQUFPLElBQUksT0FBTyxVQUFVLFVBQVUsNENBQTRDLElBQUksS0FBSyxLQUFLLENBQUMsQ0FBQztBQUNsRztBQUFBLE1BQ0Y7QUFDQSxjQUFRLE1BQU07QUFBQSxJQUNoQixDQUFDO0FBRUQsVUFBTSxNQUFNLElBQUksS0FBSyxVQUFVO0FBQUEsTUFDN0IsYUFBYSxPQUFPO0FBQUEsTUFDcEIsWUFBWSxPQUFPO0FBQUEsTUFDbkIsYUFBYSxPQUFPO0FBQUEsTUFDcEIsVUFBVSxPQUFPO0FBQUEsTUFDakIsVUFBVSxPQUFPLFVBQVU7QUFBQSxNQUMzQixZQUFZLE9BQU8sVUFBVSxjQUFjO0FBQUEsTUFDM0MsV0FBVyxPQUFPLFVBQVUsYUFBYTtBQUFBLE1BQ3pDLFNBQVMsT0FBTyxVQUFVLFdBQVc7QUFBQSxNQUNyQyxtQkFBbUIsT0FBTyxVQUFVO0FBQUEsSUFDdEMsQ0FBQyxDQUFDO0FBQUEsRUFDSixDQUFDO0FBQ0g7QUFFQSxTQUFTLDZCQUE2QixRQUF5QztBQUM3RSxNQUFJO0FBQ0YsVUFBTSxTQUFTLEtBQUssTUFBTSxNQUFNO0FBQ2hDLFFBQUksT0FBTyxXQUFXLFlBQVksVUFBVSxNQUFNO0FBQ2hELFlBQU0sSUFBSSxNQUFNLG9EQUFvRDtBQUFBLElBQ3RFO0FBQ0EsV0FBTztBQUFBLEVBQ1QsU0FBUyxPQUFPO0FBQ2QsVUFBTSxJQUFJLE1BQU0sa0RBQWtELGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDNUg7QUFDRjtBQUVBLFNBQVMsd0JBQXdCLFFBQW9DO0FBQ25FLE1BQUk7QUFDRixVQUFNLFNBQVMsS0FBSyxNQUFNLE1BQU07QUFDaEMsUUFBSSxPQUFPLFdBQVcsWUFBWSxVQUFVLFFBQVEsT0FBTyxPQUFPLG9CQUFvQixVQUFVO0FBQzlGLFlBQU0sSUFBSSxNQUFNLHVEQUF1RDtBQUFBLElBQ3pFO0FBQ0EsUUFBSSxPQUFPLFlBQVksUUFBUSxPQUFPLGFBQWEsT0FBTyxPQUFPLGFBQWEsT0FBTztBQUNuRixZQUFNLElBQUksTUFBTSwyQ0FBMkM7QUFBQSxJQUM3RDtBQUNBLFFBQUksT0FBTyxXQUFXLFNBQVMsT0FBTyxPQUFPLFlBQVksWUFBWSxNQUFNLFFBQVEsT0FBTyxPQUFPLElBQUk7QUFDbkcsWUFBTSxJQUFJLE1BQU0sMkNBQTJDO0FBQUEsSUFDN0Q7QUFDQSxXQUFPO0FBQUEsRUFDVCxTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksTUFBTSxtREFBbUQsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxFQUM3SDtBQUNGO0FBRUEsZUFBZSw4QkFDYixRQUNBLFdBQ0EsU0FDQSxNQUM2QjtBQUM3QixRQUFNLFFBQVEsT0FBTyxNQUFNLE9BQU87QUFDbEMsUUFBTSxhQUFhLE1BQU0sb0JBQW9CLFFBQVEsSUFBSTtBQUN6RCxRQUFNLGdCQUFnQixVQUFVLGFBQzVCLHNCQUFzQixZQUFZLFVBQVUsVUFBVSxJQUN0RCxjQUFjLE9BQU8sU0FBUztBQUVsQyxNQUFJLENBQUMsZUFBZTtBQUNsQixVQUFNLFNBQVMsVUFBVSxhQUFhLFVBQVUsVUFBVSxVQUFVLEtBQUs7QUFDekUsVUFBTSxJQUFJLE1BQU0scUJBQXFCLE1BQU0sU0FBUyxVQUFVLFFBQVEsR0FBRztBQUFBLEVBQzNFO0FBRUEsUUFBTSxXQUFXLFlBQVksT0FBTyxhQUFhO0FBQ2pELFFBQU0sUUFBUSw0QkFBNEI7QUFDMUMsUUFBTSxlQUFlLFVBQVUsb0JBQzNCLE1BQU0sOEJBQThCLFFBQVEsVUFBVSxVQUFVLGVBQWUsVUFBVSxTQUFTLE1BQU0sS0FBSyxJQUM3RztBQUNKLFFBQU0sVUFBVSxDQUFDLGNBQWMsVUFBVSxRQUFRLEtBQUssSUFBSSxVQUFVLEVBQUUsRUFDbkUsT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDNUIsS0FBSyxNQUFNO0FBRWQsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLGFBQWEsd0JBQXdCLFdBQVcsYUFBYTtBQUFBLEVBQy9EO0FBQ0Y7QUFFQSxTQUFTLDhCQUFxRDtBQUM1RCxTQUFPO0FBQUEsSUFDTCxnQkFBZ0Isb0JBQUksSUFBSTtBQUFBLElBQ3hCLGlCQUFpQixvQkFBSSxJQUFJO0FBQUEsSUFDekIsU0FBUyxvQkFBSSxJQUFJO0FBQUEsSUFDakIsbUJBQW1CLG9CQUFJLElBQUk7QUFBQSxJQUMzQixpQkFBaUIsb0JBQUksSUFBSTtBQUFBLElBQ3pCLHVCQUF1QjtBQUFBLEVBQ3pCO0FBQ0Y7QUFFQSxlQUFlLDhCQUNiLFFBQ0EsVUFDQSxlQUNBLFVBQ0EsU0FDQSxNQUNBLE9BQ2lCO0FBQ2pCLFFBQU0sUUFBa0IsQ0FBQztBQUN6QixRQUFNLDBCQUEwQixRQUFRLFVBQVUsZUFBZSxHQUFHLFFBQVE7QUFBQSxFQUFLLE9BQU8sSUFBSSxNQUFNLE9BQU8sS0FBSztBQUM5RyxRQUFNLFlBQVksOEJBQThCLEtBQUs7QUFDckQsU0FBTyxDQUFDLEdBQUcsTUFBTSxpQkFBaUIsR0FBRyxPQUFPLFNBQVMsRUFDbEQsT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDNUIsS0FBSyxNQUFNO0FBQ2hCO0FBRUEsZUFBZSwwQkFDYixRQUNBLFVBQ0EsZUFDQSxNQUNBLE1BQ0EsT0FDQSxPQUNpQjtBQUNqQixRQUFNLFFBQVEsT0FBTyxNQUFNLE9BQU87QUFDbEMsUUFBTSxhQUFhLE1BQU0sb0JBQW9CLFFBQVEsSUFBSTtBQUN6RCxNQUFJLFdBQVc7QUFDZixNQUFJLFlBQVk7QUFDaEIsTUFBSSxVQUFVO0FBRWQsU0FBTyxTQUFTO0FBQ2QsY0FBVTtBQUNWLFVBQU0sUUFBUSxNQUFNLG1CQUFtQixVQUFVLElBQUk7QUFFckQsZUFBVyxjQUFjLFdBQVcsYUFBYTtBQUMvQyxVQUFJLGNBQWMsWUFBWSxhQUFhLEtBQUssQ0FBQyx1QkFBdUIsWUFBWSxLQUFLLEdBQUc7QUFDMUY7QUFBQSxNQUNGO0FBQ0EsWUFBTSxPQUFPLGVBQWUsT0FBTyxVQUFVLFlBQVksT0FBTyxLQUFLO0FBQ3JFLFVBQUksTUFBTTtBQUNSLGNBQU0sU0FBUyxNQUFNLDBCQUEwQixRQUFRLFVBQVUsWUFBWSxNQUFNLE1BQU0sT0FBTyxLQUFLO0FBQ3JHLG9CQUFZO0FBQUEsRUFBSyxJQUFJO0FBQUE7QUFDckIsWUFBSSxRQUFRO0FBQ1Ysc0JBQVk7QUFBQSxFQUFLLE1BQU07QUFBQTtBQUFBLFFBQ3pCO0FBQ0EscUJBQWEsR0FBRyxNQUFNO0FBQUEsRUFBSyxJQUFJO0FBQUE7QUFDL0Isa0JBQVU7QUFBQSxNQUNaO0FBQUEsSUFDRjtBQUVBLGVBQVcsY0FBYyxXQUFXLFNBQVM7QUFDM0MsWUFBTSxPQUFPLE1BQU0sOEJBQThCLFlBQVksT0FBTyxVQUFVLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFDdkcsVUFBSSxNQUFNO0FBQ1Isb0JBQVk7QUFBQSxFQUFLLElBQUk7QUFBQTtBQUNyQixxQkFBYSxHQUFHLElBQUk7QUFBQTtBQUNwQixrQkFBVTtBQUFBLE1BQ1o7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDtBQUVBLGVBQWUsOEJBQ2IsWUFDQSxPQUNBLFVBQ0EsT0FDQSxNQUNBLE9BQ0EsT0FDaUI7QUFDakIsTUFBSSxXQUFXLFNBQVMsUUFBUTtBQUM5QixXQUFPLGtDQUFrQyxZQUFZLE9BQU8sVUFBVSxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQUEsRUFDakc7QUFFQSxTQUFPLG1DQUFtQyxZQUFZLE9BQU8sVUFBVSxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQ2xHO0FBRUEsZUFBZSxrQ0FDYixZQUNBLE9BQ0EsVUFDQSxPQUNBLE1BQ0EsT0FDQSxPQUNpQjtBQUNqQixRQUFNLGtCQUFrQixNQUFNLEtBQUssb0JBQW9CLFVBQVUsV0FBVyxRQUFRLFdBQVcsS0FBSztBQUNwRyxNQUFJLFFBQVE7QUFFWixhQUFXLFNBQVMsV0FBVyxPQUFPO0FBQ3BDLFFBQUksTUFBTSxTQUFTLEtBQUs7QUFDdEIsVUFBSSxDQUFDLGlCQUFpQjtBQUNwQixZQUFJLHlCQUF5QixLQUFLLEtBQUssb0JBQW9CLE9BQU8sWUFBWSxLQUFLLEdBQUc7QUFDcEYsbUJBQVMsR0FBRyxZQUFZLE9BQU8sVUFBVSxDQUFDO0FBQUE7QUFBQSxRQUM1QztBQUNBO0FBQUEsTUFDRjtBQUVBLFlBQU0sU0FBUyxNQUFNLEtBQUssU0FBUyxlQUFlO0FBQ2xELFVBQUksQ0FBQyxRQUFRO0FBQ1g7QUFBQSxNQUNGO0FBQ0EsWUFBTSxhQUFhLE1BQU0sb0JBQW9CLFFBQVEsSUFBSTtBQUN6RCxpQkFBVyxjQUFjLFdBQVcsYUFBYTtBQUMvQyxZQUFJLENBQUMsdUJBQXVCLFlBQVksS0FBSyxHQUFHO0FBQzlDO0FBQUEsUUFDRjtBQUNBLGlCQUFTLE1BQU0sNEJBQTRCLGlCQUFpQixXQUFXLE1BQU0sTUFBTSxPQUFPLEtBQUs7QUFBQSxNQUNqRztBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sY0FBYyxNQUFNLFVBQVUsTUFBTTtBQUMxQyxRQUFJLENBQUMsTUFBTSxNQUFNLFNBQVMsV0FBVyxHQUFHO0FBQ3RDO0FBQUEsSUFDRjtBQUVBLFVBQU0sZ0JBQWdCLE1BQU0sS0FBSyxvQkFBb0IsVUFBVSxpQkFBaUIsV0FBVyxRQUFRLE1BQU0sSUFBSSxHQUFHLFdBQVcsS0FBSztBQUNoSSxVQUFNLG1CQUFtQixtQkFBbUI7QUFDNUMsUUFBSSxDQUFDLGtCQUFrQjtBQUNyQixVQUFJLG9CQUFvQixPQUFPLFlBQVksS0FBSyxHQUFHO0FBQ2pELGlCQUFTLEdBQUcsWUFBWSxPQUFPLFVBQVUsQ0FBQztBQUFBO0FBQUEsTUFDNUM7QUFDQTtBQUFBLElBQ0Y7QUFFQSxVQUFNLFlBQVksTUFBTSw0QkFBNEIsa0JBQWtCLE1BQU0sTUFBTSxNQUFNLE9BQU8sS0FBSztBQUNwRyxRQUFJLFdBQVc7QUFDYixlQUFTO0FBQ1QsVUFBSSxNQUFNLFVBQVUsTUFBTSxXQUFXLE1BQU0sTUFBTTtBQUMvQyxpQkFBUyxlQUFlLE1BQU0sTUFBTSxNQUFNLFFBQVEsT0FBTyxLQUFLO0FBQUEsTUFDaEU7QUFDQTtBQUFBLElBQ0Y7QUFFQSxVQUFNLGdCQUFnQixNQUFNLFVBQVUsTUFBTTtBQUM1QyxVQUFNLG1CQUFtQixNQUFNLFdBQVcsYUFBYSxLQUFLLENBQUM7QUFDN0QsUUFBSSxpQkFBaUIsaUJBQWlCLFFBQVE7QUFDNUMsaUJBQVcsYUFBYSxrQkFBa0I7QUFDeEMsaUJBQVMsTUFBTSw0QkFBNEIsZUFBZSxXQUFXLE1BQU0sT0FBTyxLQUFLO0FBQ3ZGLGtDQUEwQixlQUFlLFdBQVcsS0FBSztBQUFBLE1BQzNEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLG1DQUNiLFlBQ0EsT0FDQSxVQUNBLE9BQ0EsTUFDQSxPQUNBLE9BQ2lCO0FBQ2pCLE1BQUksUUFBUTtBQUVaLGFBQVcsU0FBUyxXQUFXLE9BQU87QUFDcEMsVUFBTSxVQUFVLE1BQU0sVUFBVSxNQUFNLEtBQUssTUFBTSxHQUFHLEVBQUUsQ0FBQztBQUN2RCxVQUFNLGlCQUFpQixNQUFNLFdBQVcsT0FBTyxLQUFLLENBQUM7QUFDckQsVUFBTSxnQkFBZ0IsTUFBTSxNQUFNLFNBQVMsT0FBTyxLQUFLLGVBQWUsU0FBUztBQUMvRSxRQUFJLENBQUMsZUFBZTtBQUNsQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLGtCQUFrQixNQUFNLEtBQUssb0JBQW9CLFVBQVUsTUFBTSxNQUFNLENBQUM7QUFDOUUsUUFBSSxDQUFDLGlCQUFpQjtBQUNwQixVQUFJLG9CQUFvQixPQUFPLFlBQVksS0FBSyxHQUFHO0FBQ2pELGlCQUFTLEdBQUcsWUFBWSxPQUFPLFVBQVUsQ0FBQztBQUFBO0FBQUEsTUFDNUM7QUFDQTtBQUFBLElBQ0Y7QUFFQSxlQUFXLGFBQWEsZ0JBQWdCO0FBQ3RDLGVBQVMsTUFBTSw0QkFBNEIsaUJBQWlCLFdBQVcsTUFBTSxPQUFPLEtBQUs7QUFDekYsZ0NBQTBCLFNBQVMsV0FBVyxLQUFLO0FBQUEsSUFDckQ7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUNUO0FBRUEsZUFBZSw0QkFDYixVQUNBLFlBQ0EsTUFDQSxPQUNBLE9BQ2lCO0FBQ2pCLFFBQU0sV0FBVyxHQUFHLFFBQVEsSUFBSSxVQUFVO0FBQzFDLE1BQUksTUFBTSxnQkFBZ0IsSUFBSSxRQUFRLEdBQUc7QUFDdkMsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFNBQVMsTUFBTSxLQUFLLFNBQVMsUUFBUTtBQUMzQyxNQUFJLENBQUMsUUFBUTtBQUNYLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxnQkFBZ0IsSUFBSSxRQUFRO0FBQ2xDLE1BQUk7QUFDRixVQUFNLFFBQVEsT0FBTyxNQUFNLE9BQU87QUFDbEMsVUFBTSxhQUFhLE1BQU0sb0JBQW9CLFFBQVEsSUFBSTtBQUN6RCxVQUFNLGFBQWEsV0FBVyxZQUFZLEtBQUssQ0FBQyxlQUFlLFVBQVUsU0FBUyxDQUFDLFVBQVUsSUFBSSxHQUFHLFNBQVMsVUFBVSxDQUFDO0FBQ3hILFFBQUksQ0FBQyxZQUFZO0FBQ2YsYUFBTztBQUFBLElBQ1Q7QUFFQSxVQUFNLE9BQU8sWUFBWSxPQUFPLFVBQVU7QUFDMUMsVUFBTSxpQkFBaUIsTUFBTSwwQkFBMEIsUUFBUSxVQUFVLFlBQVksTUFBTSxNQUFNLE9BQU8sS0FBSztBQUM3RyxVQUFNLFFBQVEsZUFBZSxPQUFPLFVBQVUsWUFBWSxPQUFPLEtBQUs7QUFDdEUsV0FBTyxDQUFDLGdCQUFnQixLQUFLLEVBQUUsT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFBRSxLQUFLLElBQUk7QUFBQSxFQUN4RSxVQUFFO0FBQ0EsVUFBTSxnQkFBZ0IsT0FBTyxRQUFRO0FBQUEsRUFDdkM7QUFDRjtBQUVBLFNBQVMsZUFDUCxPQUNBLFVBQ0EsT0FDQSxPQUNBLE9BQ1E7QUFDUixRQUFNLE1BQU0sR0FBRyxRQUFRLEtBQUssTUFBTSxRQUFRLENBQUMsS0FBSyxNQUFNLE1BQU0sQ0FBQztBQUM3RCxNQUFJLE1BQU0sZUFBZSxJQUFJLEdBQUcsR0FBRztBQUNqQyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sZUFBZSxJQUFJLEdBQUc7QUFDNUIsUUFBTSxPQUFPLFlBQVksT0FBTyxLQUFLO0FBQ3JDLFFBQU0sS0FBSyxJQUFJO0FBQ2YsU0FBTztBQUNUO0FBRUEsU0FBUyxvQkFBb0IsT0FBaUIsT0FBb0IsT0FBdUM7QUFDdkcsUUFBTSxPQUFPLFlBQVksT0FBTyxLQUFLO0FBQ3JDLE1BQUksTUFBTSxnQkFBZ0IsSUFBSSxJQUFJLEdBQUc7QUFDbkMsV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLGdCQUFnQixJQUFJLElBQUk7QUFDOUIsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLE1BQWMsUUFBZ0IsT0FBOEIsT0FBeUI7QUFDM0csUUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLElBQUk7QUFDN0IsTUFBSSxNQUFNLFFBQVEsSUFBSSxHQUFHLEdBQUc7QUFDMUIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLFFBQVEsSUFBSSxHQUFHO0FBQ3JCLFFBQU0sT0FBTyxHQUFHLE1BQU0sTUFBTSxJQUFJO0FBQ2hDLFFBQU0sS0FBSyxJQUFJO0FBQ2YsU0FBTyxHQUFHLElBQUk7QUFBQTtBQUNoQjtBQUVBLFNBQVMsMEJBQTBCLFNBQWlCLFdBQW1CLE9BQW9DO0FBQ3pHLFFBQU0sd0JBQXdCO0FBQzlCLFFBQU0sYUFBYSxNQUFNLGtCQUFrQixJQUFJLE9BQU8sS0FBSyxvQkFBSSxJQUFZO0FBQzNFLGFBQVcsSUFBSSxTQUFTO0FBQ3hCLFFBQU0sa0JBQWtCLElBQUksU0FBUyxVQUFVO0FBQ2pEO0FBRUEsU0FBUyw4QkFBOEIsT0FBc0M7QUFDM0UsTUFBSSxDQUFDLE1BQU0sa0JBQWtCLE1BQU07QUFDakMsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQVEsTUFBTSx3QkFBd0IsQ0FBQyw2QkFBNkIsSUFBSSxDQUFDO0FBQy9FLGFBQVcsQ0FBQyxTQUFTLFVBQVUsS0FBSyxNQUFNLG1CQUFtQjtBQUMzRCxVQUFNLEtBQUssR0FBRyxPQUFPLGtDQUFrQztBQUN2RCxlQUFXLGFBQWEsWUFBWTtBQUNsQyxZQUFNLEtBQUssR0FBRyxPQUFPLElBQUksU0FBUyxNQUFNLFNBQVMsRUFBRTtBQUFBLElBQ3JEO0FBQUEsRUFDRjtBQUNBLFNBQU8sTUFBTSxLQUFLLElBQUk7QUFDeEI7QUFFQSxTQUFTLHNCQUFzQixZQUE4QixZQUF3QztBQUNuRyxRQUFNLFFBQVEsV0FBVyxZQUFZLEtBQUssQ0FBQyxnQkFBZ0IsV0FBVyxTQUFTLENBQUMsV0FBVyxJQUFJLEdBQUcsU0FBUyxVQUFVLENBQUM7QUFDdEgsU0FBTyxRQUFRLEVBQUUsT0FBTyxNQUFNLE9BQU8sS0FBSyxNQUFNLElBQUksSUFBSTtBQUMxRDtBQUVBLFNBQVMsdUJBQXVCLFlBQThCLE9BQTZCO0FBQ3pGLFVBQVEsV0FBVyxTQUFTLENBQUMsV0FBVyxJQUFJLEdBQUcsS0FBSyxDQUFDLFNBQVMsTUFBTSxNQUFNLFNBQVMsSUFBSSxDQUFDO0FBQzFGO0FBRUEsU0FBUyx5QkFBeUIsT0FBNkI7QUFDN0QsU0FBTyxNQUFNLE1BQU0sU0FBUztBQUM5QjtBQUVBLFNBQVMsaUJBQWlCLFlBQW9CLE1BQXNCO0FBQ2xFLFNBQU8sYUFBYSxHQUFHLFVBQVUsSUFBSSxJQUFJLEtBQUs7QUFDaEQ7QUFFQSxlQUFlLG9CQUFvQixRQUFnQixNQUEyRDtBQUM1RyxTQUFPLGFBQStCLFFBQVEsVUFBVSxJQUFJO0FBQzlEO0FBRUEsZUFBZSxtQkFBbUIsUUFBZ0IsTUFBc0Q7QUFDdEcsU0FBTyxhQUEwQixRQUFRLFNBQVMsSUFBSTtBQUN4RDtBQUVBLGVBQWUsYUFBZ0IsUUFBZ0IsTUFBMEIsTUFBNEM7QUFDbkgsUUFBTSxVQUFVLGlCQUFpQixLQUFLLGtCQUFrQixLQUFLLEtBQUssU0FBUztBQUMzRSxRQUFNLGFBQWEsUUFBUSxDQUFDLEtBQUs7QUFDakMsUUFBTSxPQUFPLENBQUMsR0FBRyxRQUFRLE1BQU0sQ0FBQyxHQUFHLE1BQU0saUJBQWlCO0FBRTFELFNBQU8sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3RDLFVBQU0sWUFBUSw2QkFBTSxZQUFZLE1BQU0sRUFBRSxPQUFPLENBQUMsUUFBUSxRQUFRLE1BQU0sRUFBRSxDQUFDO0FBQ3pFLFFBQUksU0FBUztBQUNiLFFBQUksU0FBUztBQUViLFVBQU0sT0FBTyxZQUFZLE1BQU07QUFDL0IsVUFBTSxPQUFPLFlBQVksTUFBTTtBQUMvQixVQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsVUFBa0I7QUFDekMsZ0JBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsVUFBa0I7QUFDekMsZ0JBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLEdBQUcsU0FBUyxNQUFNO0FBQ3hCLFVBQU0sR0FBRyxTQUFTLENBQUMsU0FBUztBQUMxQixVQUFJLFNBQVMsR0FBRztBQUNkLGVBQU8sSUFBSSxPQUFPLFVBQVUsVUFBVSxzQ0FBc0MsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO0FBQzVGO0FBQUEsTUFDRjtBQUNBLFVBQUk7QUFDRixnQkFBUSxLQUFLLE1BQU0sTUFBTSxDQUFNO0FBQUEsTUFDakMsU0FBUyxPQUFPO0FBQ2QsZUFBTyxLQUFLO0FBQUEsTUFDZDtBQUFBLElBQ0YsQ0FBQztBQUVELFVBQU0sTUFBTSxJQUFJLEtBQUssVUFBVSxFQUFFLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFBQSxFQUNsRCxDQUFDO0FBQ0g7QUFFQSxTQUFTLGNBQWMsT0FBaUIsV0FBb0Q7QUFDMUYsUUFBTSxRQUFRLEtBQUssS0FBSyxVQUFVLGFBQWEsS0FBSyxHQUFHLENBQUM7QUFDeEQsUUFBTSxNQUFNLEtBQUssS0FBSyxVQUFVLFdBQVcsVUFBVSxhQUFhLE1BQU0sVUFBVSxHQUFHLE1BQU0sU0FBUyxDQUFDO0FBQ3JHLE1BQUksUUFBUSxPQUFPLFNBQVMsTUFBTSxRQUFRO0FBQ3hDLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTyxFQUFFLE9BQU8sSUFBSTtBQUN0QjtBQUVBLFNBQVMsZ0JBQWdCLE9BQWlCLFVBQWtDLFlBQXdDO0FBQ2xILFFBQU0sY0FBYyxtQkFBbUIsT0FBTyxRQUFRO0FBQ3RELFFBQU0sUUFBUSxZQUFZLEtBQUssQ0FBQyxlQUFlLGdCQUFnQixVQUFVLEVBQUUsU0FBUyxVQUFVLENBQUM7QUFDL0YsTUFBSSxPQUFPO0FBQ1QsV0FBTyxFQUFFLE9BQU8sTUFBTSxPQUFPLEtBQUssTUFBTSxJQUFJO0FBQUEsRUFDOUM7QUFFQSxRQUFNLGdCQUFnQixJQUFJLE9BQU8sTUFBTSxZQUFZLFVBQVUsQ0FBQyxLQUFLO0FBQ25FLFFBQU0sT0FBTyxNQUFNLFVBQVUsQ0FBQyxjQUFjLGNBQWMsS0FBSyxTQUFTLENBQUM7QUFDekUsTUFBSSxPQUFPLEdBQUc7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sTUFBTSxJQUFJLEVBQUUsU0FBUyxHQUFHLElBQUksRUFBRSxPQUFPLE1BQU0sS0FBSyxrQkFBa0IsT0FBTyxJQUFJLEVBQUUsSUFBSSxFQUFFLE9BQU8sTUFBTSxLQUFLLEtBQUs7QUFDckg7QUFFQSxTQUFTLHdCQUF3QixPQUFpQixVQUFrQyxlQUE0QixVQUEwQjtBQUN4SSxRQUFNLFdBQVcsZ0JBQWdCLE9BQU8sVUFBVSxjQUFjLEtBQUs7QUFDckUsUUFBTSxjQUFjLG1CQUFtQixPQUFPLFFBQVEsRUFDbkQsT0FBTyxDQUFDLGVBQWUsQ0FBQyxjQUFjLFlBQVksYUFBYSxDQUFDO0FBQ25FLFFBQU0sc0JBQXNCLGlCQUFpQixVQUFVLGFBQWEsS0FBSztBQUN6RSxTQUFPLENBQUMsR0FBRyxVQUFVLEdBQUcsb0JBQW9CLElBQUksQ0FBQyxlQUFlLFlBQVksT0FBTyxVQUFVLENBQUMsQ0FBQyxFQUM1RixPQUFPLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUM1QixLQUFLLE1BQU07QUFDaEI7QUFFQSxTQUFTLGlCQUFpQixNQUFjLGFBQWlDLE9BQXFDO0FBQzVHLFFBQU0sV0FBK0IsQ0FBQztBQUN0QyxRQUFNLGVBQWUsb0JBQUksSUFBWTtBQUNyQyxNQUFJLFdBQVc7QUFDZixNQUFJLFVBQVU7QUFFZCxTQUFPLFNBQVM7QUFDZCxjQUFVO0FBQ1YsZUFBVyxjQUFjLGFBQWE7QUFDcEMsWUFBTSxNQUFNLEdBQUcsV0FBVyxLQUFLLElBQUksV0FBVyxHQUFHLElBQUksV0FBVyxJQUFJO0FBQ3BFLFVBQUksYUFBYSxJQUFJLEdBQUcsR0FBRztBQUN6QjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLENBQUMsZ0JBQWdCLFVBQVUsRUFBRSxLQUFLLENBQUMsU0FBUyxlQUFlLFVBQVUsSUFBSSxDQUFDLEdBQUc7QUFDL0U7QUFBQSxNQUNGO0FBQ0EsbUJBQWEsSUFBSSxHQUFHO0FBQ3BCLGVBQVMsS0FBSyxVQUFVO0FBQ3hCLGtCQUFZO0FBQUEsRUFBSyxZQUFZLE9BQU8sVUFBVSxDQUFDO0FBQUE7QUFDL0MsZ0JBQVU7QUFBQSxJQUNaO0FBQUEsRUFDRjtBQUVBLFNBQU8sU0FBUyxLQUFLLENBQUMsTUFBTSxVQUFVLEtBQUssUUFBUSxNQUFNLEtBQUs7QUFDaEU7QUFFQSxTQUFTLGdCQUFnQixPQUFpQixVQUFrQyxZQUE4QjtBQUN4RyxRQUFNLFdBQXFCLENBQUM7QUFDNUIsUUFBTSxNQUFNLEtBQUssSUFBSSxZQUFZLENBQUM7QUFDbEMsV0FBUyxRQUFRLEdBQUcsUUFBUSxLQUFLLFNBQVMsR0FBRztBQUMzQyxVQUFNLE9BQU8sTUFBTSxLQUFLO0FBQ3hCLFFBQUksZUFBZSxNQUFNLFFBQVEsR0FBRztBQUNsQyxlQUFTLEtBQUssSUFBSTtBQUFBLElBQ3BCO0FBQUEsRUFDRjtBQUNBLFNBQU8sU0FBUyxTQUFTLENBQUMsU0FBUyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUM7QUFDcEQ7QUFFQSxTQUFTLGVBQWUsTUFBYyxVQUEyQztBQUMvRSxRQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLE1BQUksQ0FBQyxTQUFTO0FBQ1osV0FBTztBQUFBLEVBQ1Q7QUFDQSxVQUFRLFVBQVU7QUFBQSxJQUNoQixLQUFLO0FBQ0gsYUFBTyxzQ0FBc0MsS0FBSyxPQUFPO0FBQUEsSUFDM0QsS0FBSztBQUFBLElBQ0wsS0FBSztBQUNILGFBQU8sZ0ZBQWdGLEtBQUssT0FBTztBQUFBLElBQ3JHLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPLFFBQVEsV0FBVyxHQUFHLEtBQUssUUFBUSxXQUFXLFNBQVMsS0FBSyxRQUFRLFdBQVcsaUJBQWlCO0FBQUEsSUFDekcsS0FBSztBQUNILGFBQU8seUJBQXlCLEtBQUssT0FBTztBQUFBLElBQzlDLEtBQUs7QUFDSCxhQUFPLGdDQUFnQyxLQUFLLE9BQU87QUFBQSxJQUNyRCxLQUFLO0FBQ0gsYUFBTywwQkFBMEIsS0FBSyxPQUFPO0FBQUEsSUFDL0M7QUFDRSxhQUFPO0FBQUEsRUFDWDtBQUNGO0FBRUEsU0FBUyxtQkFBbUIsT0FBaUIsVUFBc0Q7QUFDakcsVUFBUSxVQUFVO0FBQUEsSUFDaEIsS0FBSztBQUNILGFBQU8seUJBQXlCLEtBQUs7QUFBQSxJQUN2QyxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTyx3QkFBd0IsT0FBTyxtS0FBbUs7QUFBQSxJQUMzTSxLQUFLO0FBQ0gsYUFBTyxvQkFBb0IsT0FBTyxLQUFLO0FBQUEsSUFDekMsS0FBSztBQUNILGFBQU8sb0JBQW9CLE9BQU8sSUFBSTtBQUFBLElBQ3hDLEtBQUs7QUFDSCxhQUFPLDBCQUEwQixLQUFLO0FBQUEsSUFDeEMsS0FBSztBQUNILGFBQU8sd0JBQXdCLEtBQUs7QUFBQSxJQUN0QyxLQUFLO0FBQ0gsYUFBTyx3QkFBd0IsT0FBTyx1T0FBdU87QUFBQSxJQUMvUSxLQUFLO0FBQ0gsYUFBTyx1QkFBdUIsS0FBSztBQUFBLElBQ3JDO0FBQ0UsYUFBTyxDQUFDO0FBQUEsRUFDWjtBQUNGO0FBRUEsU0FBUyx5QkFBeUIsT0FBcUM7QUFDckUsUUFBTSxjQUFrQyxDQUFDO0FBQ3pDLFdBQVMsUUFBUSxHQUFHLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUNwRCxVQUFNLGFBQWEsTUFBTSxLQUFLLEVBQUUsTUFBTSx3QkFBd0I7QUFDOUQsUUFBSSxZQUFZO0FBQ2Qsa0JBQVksS0FBSyxFQUFFLE1BQU0sV0FBVyxDQUFDLEdBQUcsT0FBTyxPQUFPLEtBQUssTUFBTSxDQUFDO0FBQ2xFO0FBQUEsSUFDRjtBQUVBLFVBQU0sUUFBUSxNQUFNLEtBQUssRUFBRSxNQUFNLHFEQUFxRDtBQUN0RixRQUFJLENBQUMsT0FBTztBQUNWO0FBQUEsSUFDRjtBQUNBLFVBQU0sU0FBUyxNQUFNLENBQUMsRUFBRTtBQUN4QixRQUFJLFFBQVE7QUFDWixXQUFPLFFBQVEsS0FBSyxNQUFNLFFBQVEsQ0FBQyxFQUFFLEtBQUssRUFBRSxXQUFXLEdBQUcsS0FBSyxVQUFVLE1BQU0sUUFBUSxDQUFDLENBQUMsTUFBTSxRQUFRO0FBQ3JHLGVBQVM7QUFBQSxJQUNYO0FBQ0EsUUFBSSxNQUFNO0FBQ1YsYUFBUyxTQUFTLFFBQVEsR0FBRyxTQUFTLE1BQU0sUUFBUSxVQUFVLEdBQUc7QUFDL0QsVUFBSSxNQUFNLE1BQU0sRUFBRSxLQUFLLEtBQUssVUFBVSxNQUFNLE1BQU0sQ0FBQyxLQUFLLFFBQVE7QUFDOUQ7QUFBQSxNQUNGO0FBQ0EsWUFBTTtBQUFBLElBQ1I7QUFDQSxnQkFBWSxLQUFLLEVBQUUsTUFBTSxNQUFNLENBQUMsR0FBRyxPQUFPLElBQUksQ0FBQztBQUFBLEVBQ2pEO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxvQkFBb0IsT0FBaUIsT0FBb0M7QUFDaEYsUUFBTSxjQUFrQyxDQUFDO0FBQ3pDLE1BQUksUUFBUTtBQUVaLFdBQVMsUUFBUSxHQUFHLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUNwRCxVQUFNLE9BQU8sTUFBTSxLQUFLO0FBQ3hCLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsVUFBTSxXQUFXLFVBQVU7QUFFM0IsUUFBSSxZQUFZLFNBQVM7QUFDdkIsWUFBTSxRQUFRLFFBQVEsTUFBTSxnQ0FBZ0M7QUFDNUQsVUFBSSxPQUFPO0FBQ1Qsb0JBQVksS0FBSyxFQUFFLE1BQU0sTUFBTSxDQUFDLEdBQUcsT0FBTyxPQUFPLEtBQUssTUFBTSxDQUFDO0FBQUEsTUFDL0QsV0FBVyxDQUFDLFFBQVEsV0FBVyxHQUFHLEtBQUssQ0FBQyxlQUFlLE9BQU8sR0FBRztBQUMvRCxjQUFNLGlCQUFpQixxQkFBcUIsT0FBTyxPQUFPLEtBQUs7QUFDL0QsWUFBSSxnQkFBZ0I7QUFDbEIsc0JBQVksS0FBSyxjQUFjO0FBQy9CLGtCQUFRLEtBQUssSUFBSSxPQUFPLGVBQWUsR0FBRztBQUFBLFFBQzVDLE9BQU87QUFDTCxnQkFBTSxxQkFBcUIseUJBQXlCLE9BQU8sS0FBSztBQUNoRSxjQUFJLG9CQUFvQjtBQUN0Qix3QkFBWSxLQUFLLGtCQUFrQjtBQUNuQyxvQkFBUSxLQUFLLElBQUksT0FBTyxtQkFBbUIsR0FBRztBQUFBLFVBQ2hELE9BQU87QUFDTCxrQkFBTSxtQkFBbUIsdUJBQXVCLE1BQU0sS0FBSztBQUMzRCxnQkFBSSxrQkFBa0I7QUFDcEIsMEJBQVksS0FBSyxnQkFBZ0I7QUFBQSxZQUNuQztBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxhQUFTLFdBQVcsSUFBSTtBQUN4QixRQUFJLFFBQVEsR0FBRztBQUNiLGNBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDtBQUVBLFNBQVMscUJBQXFCLE9BQWlCLE9BQWUsT0FBeUM7QUFDckcsUUFBTSxTQUFTLE1BQU0sTUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLFFBQVEsUUFBUSxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFDN0UsUUFBTSxpQkFBaUIsUUFBUSxnREFBZ0Q7QUFDL0UsUUFBTSxRQUFRLE9BQU8sTUFBTSxJQUFJLE9BQU8sUUFBUSxjQUFjLHdCQUF3QixDQUFDO0FBQ3JGLFFBQU0sbUJBQW1CLE9BQU8sTUFBTSxzRUFBc0U7QUFDNUcsUUFBTSxPQUFPLFFBQVEsQ0FBQyxLQUFLLG1CQUFtQixDQUFDO0FBQy9DLE1BQUksQ0FBQyxNQUFNO0FBQ1QsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLE1BQU0sb0JBQW9CLE9BQU8sS0FBSztBQUM1QyxTQUFPLEVBQUUsTUFBTSxPQUFPLENBQUMsSUFBSSxHQUFHLE9BQU8sSUFBSTtBQUMzQztBQUVBLFNBQVMseUJBQXlCLE9BQWlCLE9BQXdDO0FBQ3pGLFFBQU0sY0FBYyxNQUFNLE1BQU0sT0FBTyxLQUFLLElBQUksTUFBTSxRQUFRLFFBQVEsRUFBRSxDQUFDO0FBQ3pFLFFBQU0sU0FBUyxZQUFZLEtBQUssR0FBRztBQUNuQyxRQUFNLGNBQWMsWUFBWSxVQUFVLENBQUMsU0FBUyxLQUFLLFNBQVMsR0FBRyxDQUFDO0FBQ3RFLE1BQUksY0FBYyxLQUFLLE9BQU8sUUFBUSxHQUFHLEtBQUssS0FBSyxPQUFPLFFBQVEsR0FBRyxJQUFJLE9BQU8sUUFBUSxHQUFHLEdBQUc7QUFDNUYsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFVBQVUsQ0FBQyxHQUFHLE9BQU8sU0FBUyxpSUFBaUksQ0FBQztBQUN0SyxRQUFNLE9BQU8sUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLFFBQVEsUUFBUSxFQUFFO0FBQ2hELE1BQUksQ0FBQyxRQUFRLGtCQUFrQixJQUFJLEdBQUc7QUFDcEMsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFlBQVksUUFBUTtBQUMxQixRQUFNLFlBQVksS0FBSyxTQUFTLElBQUksSUFBSSxLQUFLLE1BQU0sSUFBSSxFQUFFLElBQUksS0FBSyxPQUFPO0FBQ3pFLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU8sQ0FBQyxHQUFHLG9CQUFJLElBQUksQ0FBQyxXQUFXLElBQUksQ0FBQyxDQUFDO0FBQUEsSUFDckM7QUFBQSxJQUNBLEtBQUssa0JBQWtCLE9BQU8sU0FBUztBQUFBLEVBQ3pDO0FBQ0Y7QUFFQSxTQUFTLHVCQUF1QixNQUFjLE9BQXdDO0FBQ3BGLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFFBQVEsU0FBUyxHQUFHLEtBQUssUUFBUSxTQUFTLEdBQUcsS0FBSyx1Q0FBdUMsS0FBSyxPQUFPLEdBQUc7QUFDM0csV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLHFCQUFxQixRQUFRLE1BQU0sR0FBRyxFQUFFLENBQUMsRUFBRSxRQUFRLGNBQWMsRUFBRTtBQUN6RSxRQUFNLFFBQVEsbUJBQW1CLE1BQU0sOEJBQThCLEdBQUcsSUFBSSxHQUFHLE1BQU0sZ0JBQWdCO0FBQ3JHLFFBQU0sT0FBTyxRQUFRLENBQUM7QUFDdEIsTUFBSSxDQUFDLFFBQVEsOEZBQThGLEtBQUssSUFBSSxHQUFHO0FBQ3JILFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTyxFQUFFLE1BQU0sT0FBTyxPQUFPLEtBQUssTUFBTTtBQUMxQztBQUVBLFNBQVMsdUJBQXVCLE9BQXFDO0FBQ25FLFFBQU0sY0FBa0MsQ0FBQztBQUN6QyxXQUFTLFFBQVEsR0FBRyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDcEQsVUFBTSxPQUFPLE1BQU0sS0FBSztBQUN4QixVQUFNLFNBQVMsS0FBSyxNQUFNLGdFQUFnRTtBQUMxRixRQUFJLFFBQVE7QUFDVixZQUFNLE1BQU0sS0FBSyxVQUFVLEVBQUUsV0FBVyxRQUFRLElBQUksa0JBQWtCLE9BQU8sS0FBSyxJQUFJO0FBQ3RGLGtCQUFZLEtBQUssRUFBRSxNQUFNLE9BQU8sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEVBQUUsR0FBRyxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQzVGO0FBQUEsSUFDRjtBQUVBLFVBQU0sU0FBUyxLQUFLLE1BQU0seUNBQXlDO0FBQ25FLFFBQUksUUFBUTtBQUNWLGtCQUFZLEtBQUssRUFBRSxNQUFNLE9BQU8sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEVBQUUsR0FBRyxPQUFPLE9BQU8sS0FBSyxNQUFNLENBQUM7QUFBQSxJQUNyRztBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLDBCQUEwQixPQUFxQztBQUN0RSxRQUFNLGNBQWtDLENBQUM7QUFDekMsV0FBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3BELFVBQU0sVUFBVSxNQUFNLEtBQUssRUFBRSxLQUFLO0FBQ2xDLFFBQUksQ0FBQyxXQUFXLFVBQVUsTUFBTSxLQUFLLENBQUMsSUFBSSxLQUFLLHFCQUFxQixLQUFLLE9BQU8sR0FBRztBQUNqRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFFBQVEsMEJBQTBCLE9BQU87QUFDL0MsUUFBSSxDQUFDLE1BQU0sUUFBUTtBQUNqQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLE1BQU0sb0JBQW9CLE9BQU8sT0FBTyxNQUFNLENBQUMsQ0FBQztBQUN0RCxnQkFBWSxLQUFLLEVBQUUsTUFBTSxNQUFNLENBQUMsR0FBRyxPQUFPLE9BQU8sT0FBTyxJQUFJLENBQUM7QUFDN0QsWUFBUTtBQUFBLEVBQ1Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLHdCQUF3QixPQUFxQztBQUNwRSxRQUFNLGNBQWtDLENBQUM7QUFDekMsV0FBUyxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQ3BELFVBQU0sVUFBVSxNQUFNLEtBQUssRUFBRSxLQUFLO0FBQ2xDLFFBQUksQ0FBQyxXQUFXLFVBQVUsTUFBTSxLQUFLLENBQUMsSUFBSSxLQUFLLHlCQUF5QixLQUFLLE9BQU8sR0FBRztBQUNyRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFFBQVEsd0JBQXdCLE9BQU87QUFDN0MsUUFBSSxDQUFDLE1BQU0sUUFBUTtBQUNqQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLE1BQU0sbUJBQW1CLE9BQU8sT0FBTyxvQkFBb0I7QUFDakUsZ0JBQVksS0FBSyxFQUFFLE1BQU0sTUFBTSxDQUFDLEdBQUcsT0FBTyxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQzdELFlBQVE7QUFBQSxFQUNWO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyx3QkFBd0IsT0FBaUIsU0FBcUM7QUFDckYsUUFBTSxjQUFrQyxDQUFDO0FBQ3pDLFdBQVMsUUFBUSxHQUFHLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUNwRCxVQUFNLFFBQVEsTUFBTSxLQUFLLEVBQUUsTUFBTSxPQUFPO0FBQ3hDLFVBQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQyxFQUFFLEtBQUssT0FBTztBQUN6QyxRQUFJLENBQUMsTUFBTTtBQUNUO0FBQUEsSUFDRjtBQUNBLGdCQUFZLEtBQUssRUFBRSxNQUFNLE9BQU8sT0FBTyxLQUFLLGtCQUFrQixPQUFPLEtBQUssRUFBRSxDQUFDO0FBQUEsRUFDL0U7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGtCQUFrQixPQUFpQixPQUF1QjtBQUNqRSxNQUFJLENBQUMsTUFBTSxLQUFLLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDL0IsV0FBTztBQUFBLEVBQ1Q7QUFFQSxNQUFJLFFBQVE7QUFDWixNQUFJLFdBQVc7QUFDZixXQUFTLFFBQVEsT0FBTyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDeEQsZUFBVyxRQUFRLE1BQU0sS0FBSyxHQUFHO0FBQy9CLFVBQUksU0FBUyxLQUFLO0FBQ2hCLGlCQUFTO0FBQ1QsbUJBQVc7QUFBQSxNQUNiLFdBQVcsU0FBUyxLQUFLO0FBQ3ZCLGlCQUFTO0FBQUEsTUFDWDtBQUFBLElBQ0Y7QUFDQSxRQUFJLFlBQVksU0FBUyxHQUFHO0FBQzFCLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsb0JBQW9CLE9BQWlCLE9BQXVCO0FBQ25FLE1BQUksV0FBVztBQUNmLE1BQUksUUFBUTtBQUNaLFdBQVMsUUFBUSxPQUFPLFFBQVEsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUN4RCxlQUFXLFFBQVEsTUFBTSxLQUFLLEdBQUc7QUFDL0IsVUFBSSxTQUFTLEtBQUs7QUFDaEIsaUJBQVM7QUFDVCxtQkFBVztBQUFBLE1BQ2IsV0FBVyxTQUFTLEtBQUs7QUFDdkIsaUJBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRjtBQUVBLFNBQUssQ0FBQyxZQUFZLFNBQVMsTUFBTSxNQUFNLEtBQUssRUFBRSxTQUFTLEdBQUcsR0FBRztBQUMzRCxhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFdBQVcsTUFBc0I7QUFDeEMsTUFBSSxRQUFRO0FBQ1osYUFBVyxRQUFRLE1BQU07QUFDdkIsUUFBSSxTQUFTLEtBQUs7QUFDaEIsZUFBUztBQUFBLElBQ1gsV0FBVyxTQUFTLEtBQUs7QUFDdkIsZUFBUztBQUFBLElBQ1g7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLFNBQTBCO0FBQ2hELFNBQU8sUUFBUSxXQUFXLElBQUksS0FBSyxRQUFRLFdBQVcsSUFBSSxLQUFLLFFBQVEsV0FBVyxHQUFHO0FBQ3ZGO0FBRUEsU0FBUyxrQkFBa0IsTUFBdUI7QUFDaEQsU0FBTyxDQUFDLE1BQU0sT0FBTyxTQUFTLFVBQVUsT0FBTyxFQUFFLFNBQVMsSUFBSTtBQUNoRTtBQUVBLFNBQVMsMEJBQTBCLFNBQTJCO0FBQzVELFFBQU0sWUFBWSxRQUFRLE1BQU0sc0JBQXNCO0FBQ3RELE1BQUksV0FBVztBQUNiLFdBQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUFBLEVBQ3RCO0FBRUEsUUFBTSxVQUFVLFFBQVEsTUFBTSxzQkFBc0I7QUFDcEQsTUFBSSxTQUFTO0FBQ1gsV0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQUEsRUFDcEI7QUFFQSxRQUFNLFdBQVcsUUFBUSxNQUFNLGdEQUFnRDtBQUMvRSxNQUFJLFVBQVU7QUFDWixXQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFBQSxFQUNyQjtBQUVBLFFBQU0sV0FBVyxRQUFRLE1BQU0saUNBQWlDO0FBQ2hFLFNBQU8sV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUNyQztBQUVBLFNBQVMsd0JBQXdCLFNBQTJCO0FBQzFELFFBQU0sYUFBYSxRQUFRLE1BQU0sa0RBQWtEO0FBQ25GLE1BQUksWUFBWTtBQUNkLFdBQU8sQ0FBQyxXQUFXLENBQUMsS0FBSyxXQUFXLENBQUMsQ0FBQztBQUFBLEVBQ3hDO0FBRUEsUUFBTSxjQUFjLFFBQVEsTUFBTSx3QkFBd0I7QUFDMUQsTUFBSSxhQUFhO0FBQ2YsV0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQUEsRUFDeEI7QUFFQSxRQUFNLGdCQUFnQixRQUFRLE1BQU0seUJBQXlCO0FBQzdELE1BQUksZUFBZTtBQUNqQixXQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFBQSxFQUMxQjtBQUVBLFNBQU8sQ0FBQztBQUNWO0FBRUEsU0FBUyxtQkFBbUIsT0FBaUIsT0FBZSxpQkFBb0Q7QUFDOUcsTUFBSSxNQUFNO0FBQ1YsV0FBUyxRQUFRLFFBQVEsR0FBRyxRQUFRLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDNUQsVUFBTSxPQUFPLE1BQU0sS0FBSztBQUN4QixRQUFJLEtBQUssS0FBSyxLQUFLLFVBQVUsSUFBSSxNQUFNLEtBQUssZ0JBQWdCLEtBQUssS0FBSyxDQUFDLEdBQUc7QUFDeEU7QUFBQSxJQUNGO0FBQ0EsVUFBTTtBQUFBLEVBQ1I7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLG9CQUFvQixPQUFpQixPQUFlLE1BQXNCO0FBQ2pGLE1BQUksTUFBTTtBQUNWLE1BQUksd0JBQXdCLE1BQU0sS0FBSyxFQUFFLEtBQUssRUFBRSxXQUFXLEdBQUcsSUFBSSxLQUFLO0FBQ3ZFLFdBQVMsUUFBUSxRQUFRLEdBQUcsUUFBUSxNQUFNLFFBQVEsU0FBUyxHQUFHO0FBQzVELFVBQU0sT0FBTyxNQUFNLEtBQUs7QUFDeEIsVUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixRQUFJLFdBQVcsVUFBVSxJQUFJLE1BQU0sS0FBSyx1QkFBdUIsT0FBTyxHQUFHO0FBQ3ZFLFVBQUkseUJBQXlCLFFBQVEsV0FBVyxHQUFHLElBQUksR0FBRyxLQUFLLFFBQVEsU0FBUyxHQUFHLEdBQUc7QUFDcEYsZ0NBQXdCO0FBQ3hCLGNBQU07QUFDTjtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxVQUFNO0FBQUEsRUFDUjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsdUJBQXVCLFNBQTBCO0FBQ3hELFNBQU8sc0RBQXNELEtBQUssT0FBTyxLQUNwRSw2QkFBNkIsS0FBSyxPQUFPO0FBQ2hEO0FBRUEsU0FBUyxxQkFBcUIsU0FBMEI7QUFDdEQsU0FBTyx5Q0FBeUMsS0FBSyxPQUFPO0FBQzlEO0FBRUEsU0FBUyxZQUFZLE9BQWlCLE9BQTRCO0FBQ2hFLFNBQU8sTUFBTSxNQUFNLE1BQU0sT0FBTyxNQUFNLE1BQU0sQ0FBQyxFQUFFLEtBQUssSUFBSTtBQUMxRDtBQUVBLFNBQVMsY0FBYyxNQUFtQixPQUE2QjtBQUNyRSxTQUFPLEtBQUssU0FBUyxNQUFNLE9BQU8sTUFBTSxTQUFTLEtBQUs7QUFDeEQ7QUFFQSxTQUFTLFVBQVUsTUFBc0I7QUFDdkMsU0FBTyxLQUFLLE1BQU0sTUFBTSxJQUFJLENBQUMsRUFBRSxVQUFVO0FBQzNDO0FBRUEsU0FBUyxZQUFZLE9BQXVCO0FBQzFDLFNBQU8sTUFBTSxRQUFRLHVCQUF1QixNQUFNO0FBQ3BEO0FBRUEsU0FBUyxnQkFBZ0IsWUFBd0M7QUFDL0QsU0FBTyxXQUFXLE9BQU8sU0FBUyxXQUFXLFFBQVEsQ0FBQyxXQUFXLElBQUk7QUFDdkU7QUFFQSxTQUFTLGVBQWUsUUFBZ0IsTUFBdUI7QUFDN0QsTUFBSSxLQUFLLFdBQVcsR0FBRyxHQUFHO0FBQ3hCLFdBQU8sSUFBSSxPQUFPLEdBQUcsWUFBWSxJQUFJLENBQUMsS0FBSyxFQUFFLEtBQUssTUFBTTtBQUFBLEVBQzFEO0FBQ0EsU0FBTyxJQUFJLE9BQU8sTUFBTSxZQUFZLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxNQUFNO0FBQzdEO0FBRUEsU0FBUyx3QkFBd0IsV0FBZ0MsT0FBbUM7QUFDbEcsTUFBSSxVQUFVLFlBQVk7QUFDeEIsV0FBTyxHQUFHLFVBQVUsUUFBUSxJQUFJLFVBQVUsVUFBVTtBQUFBLEVBQ3REO0FBQ0EsTUFBSSxPQUFPO0FBQ1QsV0FBTyxHQUFHLFVBQVUsUUFBUSxLQUFLLE1BQU0sUUFBUSxDQUFDLEtBQUssTUFBTSxNQUFNLENBQUM7QUFBQSxFQUNwRTtBQUNBLFNBQU8sVUFBVTtBQUNuQjtBQUVBLElBQU0sb0JBQW9CLE9BQU87QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDeHNDMUIsU0FBUyw0QkFBNEIsT0FBOEI7QUFDeEUsUUFBTSxPQUFPLE1BQU0saUJBQWlCO0FBQ3BDLE1BQUksQ0FBQyxNQUFNO0FBQ1QsV0FBTyxNQUFNO0FBQUEsRUFDZjtBQUVBLFFBQU0sYUFBYSxNQUFNLGlCQUFpQixZQUFZLEtBQUs7QUFDM0QsUUFBTSxRQUFRLE1BQU0sUUFBUSxLQUFLO0FBQ2pDLFFBQU0sYUFBYSxLQUFLLFlBQVksS0FBSyxJQUNyQyx5QkFBeUIsS0FBSyxZQUFZLE9BQU8sVUFBVSxJQUMzRCx3QkFBd0IsWUFBWSxLQUFLLE1BQU0sS0FBSztBQUV4RCxTQUFPLDBCQUEwQixNQUFNLFVBQVUsWUFBWSxLQUFLLEtBQUs7QUFDekU7QUFFQSxTQUFTLHdCQUF3QixZQUFnQyxNQUEwQixPQUF1QjtBQUNoSCxNQUFJLENBQUMsWUFBWTtBQUNmLFVBQU0sSUFBSSxNQUFNLGtFQUFrRTtBQUFBLEVBQ3BGO0FBRUEsUUFBTSxlQUFlLHlCQUF5QixNQUFNLEtBQUssS0FBSyxXQUFXLE9BQU8sVUFBVTtBQUMxRixTQUFPLEdBQUcsVUFBVSxJQUFJLFlBQVk7QUFDdEM7QUFFQSxTQUFTLHlCQUF5QixVQUFrQixPQUFlLFlBQXdDO0FBQ3pHLFNBQU8sU0FDSixXQUFXLFdBQVcsS0FBSyxFQUMzQixXQUFXLFlBQVksY0FBYyxFQUFFO0FBQzVDO0FBRUEsU0FBUywwQkFBMEIsVUFBa0IsWUFBb0IsT0FBd0I7QUFDL0YsTUFBSSxDQUFDLE9BQU87QUFDVixXQUFPLDBCQUEwQixVQUFVLFVBQVU7QUFBQSxFQUN2RDtBQUVBLFVBQVEsVUFBVTtBQUFBLElBQ2hCLEtBQUs7QUFDSCxhQUFPLFNBQVMsVUFBVTtBQUFBLElBQzVCLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPLGVBQWUsVUFBVTtBQUFBLElBQ2xDLEtBQUs7QUFDSCxhQUFPO0FBQUEsbUNBQXdELFVBQVU7QUFBQSxJQUMzRSxLQUFLO0FBQ0gsYUFBTztBQUFBLDZCQUFtRCxVQUFVO0FBQUEsSUFDdEUsS0FBSztBQUNILGFBQU8sMkJBQTJCLFVBQVU7QUFBQSxJQUM5QztBQUNFLFlBQU0sSUFBSSxNQUFNLG1EQUFtRCxRQUFRLGdFQUFnRTtBQUFBLEVBQy9JO0FBQ0Y7QUFFQSxTQUFTLDBCQUEwQixVQUFrQixZQUE0QjtBQUMvRSxVQUFRLFVBQVU7QUFBQSxJQUNoQixLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1Q7QUFDRSxhQUFPLFdBQVcsU0FBUyxHQUFHLElBQUksYUFBYSxHQUFHLFVBQVU7QUFBQSxFQUNoRTtBQUNGOzs7QUM5REEsSUFBQUMsbUJBQXdCO0FBVWpCLFNBQVMsdUJBQ2QsU0FDQSxXQUNBLFVBQ2dCO0FBQ2hCLFFBQU0sVUFBVSxTQUFTLGNBQWMsS0FBSztBQUM1QyxVQUFRLFlBQVk7QUFDcEIsVUFBUSxRQUFRLGNBQWM7QUFFOUIsVUFBUSxZQUFZLGFBQWEsYUFBYSxZQUFZLGtCQUFrQixRQUFRLFNBQVMsT0FBTyxTQUFTLENBQUM7QUFDOUcsVUFBUSxZQUFZLGFBQWEsc0JBQXNCLHFCQUFxQixTQUFTLGVBQWUsS0FBSyxDQUFDO0FBQzFHLFVBQVEsWUFBWSxhQUFhLGFBQWEsUUFBUSxTQUFTLFFBQVEsS0FBSyxDQUFDO0FBQzdFLFVBQVEsWUFBWSxhQUFhLGtCQUFrQixXQUFXLFNBQVMsVUFBVSxLQUFLLENBQUM7QUFDdkYsVUFBUSxZQUFZLGFBQWEsaUJBQWlCLHFCQUFxQixTQUFTLGdCQUFnQixLQUFLLENBQUM7QUFFdEcsU0FBTztBQUNUO0FBRUEsU0FBUyxhQUFhLE9BQWUsVUFBa0IsU0FBcUIsVUFBc0M7QUFDaEgsUUFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLFNBQU8sWUFBWSxzQkFBc0IsV0FBVyxnQkFBZ0IsRUFBRTtBQUN0RSxTQUFPLE9BQU87QUFDZCxTQUFPLGFBQWEsY0FBYyxLQUFLO0FBQ3ZDLFNBQU8saUJBQWlCLFNBQVMsQ0FBQyxVQUFVO0FBQzFDLFVBQU0sZUFBZTtBQUNyQixVQUFNLGdCQUFnQjtBQUN0QixZQUFRO0FBQUEsRUFDVixDQUFDO0FBQ0QsZ0NBQVEsUUFBUSxRQUFRO0FBQ3hCLFNBQU87QUFDVDs7O0FDeENBLElBQUFDLG1CQUF3QjtBQU94QixTQUFTLGNBQWMsUUFBNkQ7QUFDbEYsTUFBSSxPQUFPLE9BQU8sU0FBUztBQUN6QixXQUFPLE9BQU8sT0FBTyxPQUFPLEtBQUssS0FBSyxPQUFPLE9BQU8sU0FBUyxLQUFLLElBQUksWUFBWTtBQUFBLEVBQ3BGO0FBRUEsU0FBTztBQUNUO0FBRU8sU0FBUyxrQkFBa0IsUUFBMEIsU0FBaUQ7QUFDM0csUUFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFFBQU0sWUFBWSx3QkFBd0IsY0FBYyxNQUFNLENBQUMsR0FBRyxPQUFPLFVBQVUsS0FBSyxZQUFZO0FBQ3BHLFFBQU0sUUFBUSxjQUFjLE9BQU87QUFDbkMsb0JBQWtCLE9BQU8sUUFBUSxPQUFPO0FBQ3hDLFNBQU87QUFDVDtBQUVPLFNBQVMsa0JBQWtCLE9BQW9CLFFBQTBCLFNBQXVDO0FBQ3JILFFBQU0sT0FBTyxjQUFjLE1BQU07QUFDakMsUUFBTSxZQUFZLHdCQUF3QixJQUFJLEdBQUcsT0FBTyxVQUFVLEtBQUssWUFBWSxHQUFHLE9BQU8sWUFBWSxrQkFBa0IsRUFBRTtBQUM3SCxRQUFNLE1BQU07QUFDWixRQUFNLGVBQWUsb0JBQW9CLFFBQVEsUUFBUSxtQkFBbUI7QUFFNUUsUUFBTSxTQUFTLE1BQU0sVUFBVSxFQUFFLEtBQUsscUJBQXFCLENBQUM7QUFDNUQsUUFBTSxRQUFRLE9BQU8sVUFBVSxFQUFFLEtBQUssb0JBQW9CLENBQUM7QUFDM0QsZ0NBQVEsT0FBTyxTQUFTLFlBQVksbUJBQW1CLFNBQVMsWUFBWSxtQkFBbUIsVUFBVTtBQUV6RyxRQUFNLFFBQVEsT0FBTyxVQUFVLEVBQUUsS0FBSyxvQkFBb0IsQ0FBQztBQUMzRCxRQUFNLFFBQVEsR0FBRyxPQUFPLE9BQU8sVUFBVSxjQUFXLE9BQU8sT0FBTyxZQUFZLEdBQUcsRUFBRTtBQUVuRixRQUFNLE9BQU8sT0FBTyxVQUFVLEVBQUUsS0FBSyxtQkFBbUIsQ0FBQztBQUN6RCxPQUFLLFFBQVEsR0FBRyxPQUFPLE9BQU8sVUFBVSxZQUFTLElBQUksS0FBSyxPQUFPLE9BQU8sVUFBVSxFQUFFLG1CQUFtQixDQUFDLEVBQUU7QUFFMUcsUUFBTSxPQUFPLE1BQU0sVUFBVSxFQUFFLEtBQUssbUJBQW1CLENBQUM7QUFDeEQsTUFBSSxPQUFPLE9BQU8sT0FBTyxLQUFLLEdBQUc7QUFDL0IsaUJBQWEsTUFBTSxVQUFVLE9BQU8sT0FBTyxRQUFRLFlBQVk7QUFBQSxFQUNqRTtBQUNBLE1BQUksT0FBTyxPQUFPLFNBQVMsS0FBSyxHQUFHO0FBQ2pDLGlCQUFhLE1BQU0sV0FBVyxPQUFPLE9BQU8sU0FBUyxZQUFZO0FBQUEsRUFDbkU7QUFDQSxNQUFJLE9BQU8sT0FBTyxPQUFPLEtBQUssR0FBRztBQUMvQixpQkFBYSxNQUFNLFVBQVUsT0FBTyxPQUFPLFFBQVEsWUFBWTtBQUFBLEVBQ2pFO0FBQ0EsTUFBSSxPQUFPLGVBQWUsUUFBUSxLQUFLLEdBQUc7QUFDeEMsd0JBQW9CLE1BQU0sT0FBTyxhQUFhO0FBQUEsRUFDaEQ7QUFDQSxNQUFJLENBQUMsT0FBTyxPQUFPLE9BQU8sS0FBSyxLQUFLLENBQUMsT0FBTyxPQUFPLFNBQVMsS0FBSyxLQUFLLENBQUMsT0FBTyxPQUFPLE9BQU8sS0FBSyxLQUFLLENBQUMsT0FBTyxlQUFlLFFBQVEsS0FBSyxHQUFHO0FBQzNJLFVBQU0sUUFBUSxLQUFLLFVBQVUsRUFBRSxLQUFLLG9CQUFvQixDQUFDO0FBQ3pELFVBQU0sUUFBUSxXQUFXO0FBQUEsRUFDM0I7QUFDRjtBQUVBLFNBQVMsYUFBYSxXQUF3QixPQUFlLFNBQWlCLGNBQTRCO0FBQ3hHLFFBQU0sVUFBVSxVQUFVLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBQ2pFLFFBQU0sWUFBWSxXQUFXLE9BQU87QUFDcEMsVUFBUSxVQUFVLEVBQUUsS0FBSyw0QkFBNEIsTUFBTSxrQkFBa0IsT0FBTyxXQUFXLFlBQVksRUFBRSxDQUFDO0FBQzlHLFFBQU0sTUFBTSxRQUFRLFNBQVMsT0FBTyxFQUFFLEtBQUssbUJBQW1CLE1BQU0sUUFBUSxDQUFDO0FBQzdFLE1BQUksZUFBZSxLQUFLLFlBQVksY0FBYztBQUNoRCxRQUFJLFNBQVMsbUJBQW1CO0FBQ2hDLFFBQUksTUFBTSxZQUFZLCtCQUErQixPQUFPLFlBQVksQ0FBQztBQUFBLEVBQzNFO0FBQ0Y7QUFFQSxTQUFTLG9CQUFvQixXQUF3QixTQUErRDtBQUNsSCxRQUFNLFVBQVUsVUFBVSxTQUFTLFdBQVcsRUFBRSxLQUFLLHNCQUFzQixDQUFDO0FBQzVFLFVBQVEsT0FBTyxRQUFRO0FBQ3ZCLFFBQU0sVUFBVSxRQUFRLFNBQVMsV0FBVyxFQUFFLEtBQUssOEJBQThCLENBQUM7QUFDbEYsVUFBUSxXQUFXLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUMvQyxVQUFRLFdBQVcsRUFBRSxLQUFLLDRCQUE0QixNQUFNLHdCQUF3QixPQUFPLEVBQUUsQ0FBQztBQUM5RixVQUFRLFNBQVMsT0FBTyxFQUFFLEtBQUssMkNBQTJDLE1BQU0sUUFBUSxRQUFRLENBQUM7QUFDbkc7QUFFQSxTQUFTLHdCQUF3QixTQUFpRTtBQUNoRyxRQUFNLGFBQWEsUUFBUTtBQUMzQixNQUFJLENBQUMsY0FBYyxDQUFDLFFBQVEsd0JBQXdCO0FBQ2xELFdBQU8sR0FBRyxRQUFRLFFBQVEsU0FBTSxRQUFRLFdBQVc7QUFBQSxFQUNyRDtBQUNBLFNBQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLFdBQVcsV0FBVyxnQkFBZ0I7QUFBQSxJQUN0QyxRQUFRLFdBQVcsaUJBQWlCO0FBQUEsSUFDcEMsUUFBUSxXQUFXLFdBQVc7QUFBQSxFQUNoQyxFQUFFLEtBQUssUUFBSztBQUNkO0FBRUEsU0FBUyxvQkFBb0IsUUFBMEIscUJBQXFDO0FBQzFGLFFBQU0sV0FBVyxPQUFPLE1BQU0sV0FBVyxtQkFBbUIsS0FBSyxPQUFPLE1BQU0sV0FBVyxjQUFjO0FBQ3ZHLE1BQUksWUFBWSxNQUFNO0FBQ3BCLFdBQU8sc0JBQXNCLE9BQU8sU0FBUyxTQUFTLEtBQUssR0FBRyxFQUFFLENBQUM7QUFBQSxFQUNuRTtBQUNBLFNBQU8sc0JBQXNCLG1CQUFtQjtBQUNsRDtBQUVBLFNBQVMsc0JBQXNCLE9BQXVCO0FBQ3BELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxLQUFLLFNBQVMsR0FBRztBQUN6QyxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sS0FBSyxJQUFJLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBSTtBQUN6QztBQUVBLFNBQVMsV0FBVyxTQUF5QjtBQUMzQyxTQUFPLFFBQVEsUUFBUSxPQUFPLEVBQUUsRUFBRSxNQUFNLElBQUksRUFBRTtBQUNoRDtBQUVBLFNBQVMsa0JBQWtCLE9BQWUsV0FBbUIsY0FBOEI7QUFDekYsTUFBSSxlQUFlLEtBQUssWUFBWSxjQUFjO0FBQ2hELFdBQU8sR0FBRyxLQUFLLFNBQU0sU0FBUyx1QkFBb0IsWUFBWTtBQUFBLEVBQ2hFO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxxQkFBcUM7QUFDbkQsUUFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFFBQU0sWUFBWTtBQUVsQixRQUFNLFNBQVMsTUFBTSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUM1RCxRQUFNLFVBQVUsT0FBTyxVQUFVLEVBQUUsS0FBSyxlQUFlLENBQUM7QUFDeEQsZ0NBQVEsU0FBUyxlQUFlO0FBQ2hDLFFBQU0sUUFBUSxPQUFPLFVBQVUsRUFBRSxLQUFLLG9CQUFvQixDQUFDO0FBQzNELFFBQU0sUUFBUSxTQUFTO0FBQ3ZCLFFBQU0sT0FBTyxPQUFPLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixDQUFDO0FBQ3pELE9BQUssUUFBUSxjQUFjO0FBQzNCLFVBQVEsYUFBYSxlQUFlLE1BQU07QUFFMUMsU0FBTztBQUNUOzs7QTFCN0ZBLElBQU0sb0JBQW9CLHlCQUFZLE9BQWE7QUFDbkQsSUFBTSw2QkFBNkI7QUFZbkMsSUFBTSx3QkFBTixjQUFvQyx1QkFBTTtBQUFBLEVBQ3hDLFlBQ0UsS0FDaUIsV0FDakI7QUFDQSxVQUFNLEdBQUc7QUFGUTtBQUFBLEVBR25CO0FBQUEsRUFFQSxTQUFlO0FBQ2IsVUFBTSxFQUFFLFVBQVUsSUFBSTtBQUN0QixjQUFVLE1BQU07QUFDaEIsY0FBVSxTQUFTLE1BQU0sRUFBRSxNQUFNLCtCQUErQixDQUFDO0FBQ2pFLGNBQVUsU0FBUyxLQUFLO0FBQUEsTUFDdEIsTUFBTTtBQUFBLElBQ1IsQ0FBQztBQUVELFVBQU0sVUFBVSxVQUFVLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBQ2pFLFVBQU0sZUFBZSxRQUFRLFNBQVMsVUFBVSxFQUFFLE1BQU0sU0FBUyxDQUFDO0FBQ2xFLFVBQU0sZUFBZSxRQUFRLFNBQVMsVUFBVSxFQUFFLE1BQU0sa0JBQWtCLEtBQUssVUFBVSxDQUFDO0FBRTFGLGlCQUFhLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDekQsaUJBQWEsaUJBQWlCLFNBQVMsWUFBWTtBQUNqRCxZQUFNLEtBQUssVUFBVTtBQUNyQixXQUFLLE1BQU07QUFBQSxJQUNiLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFQSxJQUFNLHlCQUFOLGNBQXFDLHFDQUFvQjtBQUFBLEVBSXZELFlBQ0UsYUFDaUIsUUFDQSxPQUNBLGFBQ2pCO0FBQ0EsVUFBTSxXQUFXO0FBSkE7QUFDQTtBQUNBO0FBUG5CLFNBQVEsaUJBQXdDO0FBQ2hELFNBQVEsMkJBQWdEO0FBQUEsRUFTeEQ7QUFBQSxFQUVBLFNBQWU7QUFDYixTQUFLLFlBQVksZUFBZSxTQUFTLHNCQUFzQjtBQUMvRCxTQUFLLFlBQVksZUFBZSxZQUFZLEtBQUssT0FBTyxxQkFBcUIsS0FBSyxLQUFLLENBQUM7QUFFeEYsUUFBSSxLQUFLLE9BQU8sU0FBUyxrQkFBa0IsVUFBVTtBQUNuRCxXQUFLLFlBQVksVUFBVSxJQUFJLHNCQUFzQjtBQUFBLElBQ3ZEO0FBRUEsVUFBTSxjQUFjLENBQUMseUJBQXlCO0FBQzlDLFFBQUksS0FBSyxPQUFPLFNBQVMsa0JBQWtCLFFBQVE7QUFDakQsa0JBQVksS0FBSyx3QkFBd0I7QUFBQSxJQUMzQztBQUNBLFNBQUssaUJBQWlCLEtBQUssWUFBWSxVQUFVLEVBQUUsS0FBSyxZQUFZLEtBQUssR0FBRyxFQUFFLENBQUM7QUFFL0UsU0FBSyxPQUFPLGlCQUFpQixLQUFLLE9BQU8sS0FBSyxjQUFjO0FBQzVELFNBQUssMkJBQTJCLEtBQUssT0FBTyx1QkFBdUIsS0FBSyxNQUFNLElBQUksTUFBTTtBQUN0RixVQUFJLEtBQUssZ0JBQWdCO0FBQ3ZCLGFBQUssT0FBTyxpQkFBaUIsS0FBSyxPQUFPLEtBQUssY0FBYztBQUFBLE1BQzlEO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsV0FBaUI7QUFDZixTQUFLLDJCQUEyQjtBQUFBLEVBQ2xDO0FBQ0Y7QUFFQSxJQUFNLG9CQUFOLGNBQWdDLHdCQUFXO0FBQUEsRUFHekMsWUFDbUIsUUFDQSxPQUNqQjtBQUNBLFVBQU07QUFIVztBQUNBO0FBR2pCLFNBQUssWUFBWSxPQUFPLGVBQWUsTUFBTSxFQUFFO0FBQUEsRUFDakQ7QUFBQSxFQUVBLEdBQUcsT0FBbUM7QUFDcEMsV0FBTyxNQUFNLE1BQU0sT0FBTyxLQUFLLE1BQU0sTUFBTSxNQUFNLGNBQWMsS0FBSztBQUFBLEVBQ3RFO0FBQUEsRUFFQSxRQUFxQjtBQUNuQixXQUFPLEtBQUssT0FBTyxxQkFBcUIsS0FBSyxLQUFLO0FBQUEsRUFDcEQ7QUFDRjtBQUVBLElBQU0sbUJBQU4sY0FBK0Isd0JBQVc7QUFBQSxFQUN4QyxZQUNtQixRQUNBLE9BQ2pCO0FBQ0EsVUFBTTtBQUhXO0FBQ0E7QUFBQSxFQUduQjtBQUFBLEVBRUEsR0FBRyxPQUFrQztBQUNuQyxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsUUFBcUI7QUFDbkIsVUFBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLFlBQVEsWUFBWTtBQUNwQixTQUFLLE9BQU8saUJBQWlCLEtBQUssT0FBTyxPQUFPO0FBQ2hELFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFFQSxJQUFxQixhQUFyQixjQUF3Qyx3QkFBTztBQUFBLEVBQS9DO0FBQUE7QUFDRSxvQkFBK0I7QUFDL0IsU0FBUyxXQUFXLElBQUksbUJBQW1CO0FBQUEsTUFDekMsSUFBSSxhQUFhO0FBQUEsTUFDakIsSUFBSSxXQUFXO0FBQUEsTUFDZixJQUFJLFlBQVk7QUFBQSxNQUNoQixJQUFJLHFCQUFxQjtBQUFBLE1BQ3pCLElBQUksa0JBQWtCO0FBQUEsTUFDdEIsSUFBSSxzQkFBc0I7QUFBQSxNQUMxQixJQUFJLFdBQVc7QUFBQSxNQUNmLElBQUksV0FBVztBQUFBLE1BQ2YsSUFBSSxZQUFZO0FBQUEsTUFDaEIsSUFBSSxxQkFBcUI7QUFBQSxJQUMzQixDQUFDO0FBRUQ7QUFBQSxTQUFnQixrQkFBa0IsSUFBSSxvQkFBb0IsS0FBSyxLQUFLLEtBQUssU0FBUyxPQUFPLHdCQUF3QjtBQUNqSCxTQUFpQiw2QkFBNkIsb0JBQUksSUFBWTtBQUM5RCxTQUFpQixVQUFVLG9CQUFJLElBQThCO0FBQzdELFNBQWlCLGNBQWMsb0JBQUksSUFBb0I7QUFDdkQsU0FBaUIsY0FBYyxvQkFBSSxJQUFZO0FBQy9DLFNBQWlCLFVBQVUsb0JBQUksSUFBNkI7QUFDNUQsU0FBaUIsa0JBQWtCLG9CQUFJLElBQTZCO0FBRXBFLFNBQVEsY0FBYyxvQkFBSSxJQUFnQjtBQUMxQyxTQUFRLHVCQUFzQztBQUFBO0FBQUEsRUFFOUMsTUFBTSxTQUF3QjtBQUM1QixVQUFNLEtBQUssYUFBYTtBQUN4QixTQUFLLGNBQWMsSUFBSSxlQUFlLElBQUksQ0FBQztBQUMzQyxTQUFLLGtCQUFrQixLQUFLLGlCQUFpQjtBQUM3QyxTQUFLLGdCQUFnQjtBQUNyQixTQUFLLElBQUksVUFBVSxjQUFjLE1BQU07QUFDckMsV0FBSyx1QkFBdUIsS0FBSyxzQkFBc0IsR0FBRyxRQUFRLEtBQUs7QUFDdkUsV0FBSyxLQUFLLCtCQUErQjtBQUFBLElBQzNDLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLGdCQUFnQixPQUFPLFFBQVEsU0FBUztBQUN0QyxjQUFNLE9BQU8sS0FBSztBQUNsQixZQUFJLENBQUMsTUFBTTtBQUNUO0FBQUEsUUFDRjtBQUVBLGNBQU0sU0FBUyx3QkFBd0IsS0FBSyxNQUFNLE9BQU8sU0FBUyxHQUFHLEtBQUssUUFBUTtBQUNsRixjQUFNLFFBQVEsZ0JBQWdCLFFBQVEsT0FBTyxVQUFVLEVBQUUsSUFBSTtBQUM3RCxZQUFJLENBQUMsT0FBTztBQUNWLGNBQUksd0JBQU8sZ0RBQWdEO0FBQzNEO0FBQUEsUUFDRjtBQUNBLGNBQU0sS0FBSyxTQUFTLE1BQU0sS0FBSztBQUFBLE1BQ2pDO0FBQUEsSUFDRixDQUFDO0FBRUQsU0FBSyxXQUFXO0FBQUEsTUFDZCxJQUFJO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixlQUFlLENBQUMsYUFBYTtBQUMzQixjQUFNLE9BQU8sS0FBSyxzQkFBc0I7QUFDeEMsWUFBSSxDQUFDLE1BQU07QUFDVCxpQkFBTztBQUFBLFFBQ1Q7QUFDQSxZQUFJLENBQUMsVUFBVTtBQUNiLGVBQUssS0FBSyxtQkFBbUIsSUFBSTtBQUFBLFFBQ25DO0FBQ0EsZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLGVBQWUsQ0FBQyxhQUFhO0FBQzNCLGNBQU0sT0FBTyxLQUFLLHNCQUFzQjtBQUN4QyxZQUFJLENBQUMsTUFBTTtBQUNULGlCQUFPO0FBQUEsUUFDVDtBQUNBLFlBQUksQ0FBQyxVQUFVO0FBQ2IsZUFBSyxLQUFLLG9CQUFvQixJQUFJO0FBQUEsUUFDcEM7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUVELFNBQUssNEJBQTRCO0FBRWpDLFNBQUssd0JBQXdCLEtBQUssMkJBQTJCLENBQUM7QUFFOUQsU0FBSztBQUFBLE1BQ0gsS0FBSyxJQUFJLFVBQVUsR0FBRyxhQUFhLENBQUMsU0FBUztBQUMzQyxhQUFLLHVCQUF1QixNQUFNLFFBQVEsS0FBSztBQUMvQyxhQUFLLGdCQUFnQjtBQUNyQixhQUFLLEtBQUssK0JBQStCO0FBQ3pDLFlBQUksUUFBUSxLQUFLLFNBQVMsbUJBQW1CO0FBQzNDLGVBQUssS0FBSyxtQkFBbUIsSUFBSTtBQUFBLFFBQ25DO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sVUFBVSxZQUFZO0FBQ3BCLGNBQU0sU0FBUyxNQUFNLEtBQUssMkJBQTJCO0FBQ3JELFlBQUksd0JBQU8sT0FBTyxTQUFTLE9BQU8sSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLElBQUksS0FBSyxNQUFNLE1BQU0sRUFBRSxFQUFFLEtBQUssSUFBSSxJQUFJLG1DQUFtQyxHQUFJO0FBQUEsTUFDekk7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLO0FBQUEsTUFDSCxLQUFLLElBQUksVUFBVSxHQUFHLHNCQUFzQixNQUFNO0FBQ2hELGFBQUssdUJBQXVCLEtBQUssc0JBQXNCLEdBQUcsUUFBUSxLQUFLO0FBQ3ZFLGFBQUssS0FBSywrQkFBK0I7QUFBQSxNQUMzQyxDQUFDO0FBQUEsSUFDSDtBQUVBLFNBQUs7QUFBQSxNQUNILEtBQUssSUFBSSxVQUFVLEdBQUcsaUJBQWlCLENBQUMsU0FBUyxRQUFRO0FBQ3ZELFlBQUksZUFBZSwrQkFBYztBQUMvQixlQUFLLEtBQUsseUJBQXlCLElBQUksSUFBSTtBQUFBLFFBQzdDO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLFdBQWlCO0FBQ2YsZUFBVyxjQUFjLEtBQUssUUFBUSxPQUFPLEdBQUc7QUFDOUMsaUJBQVcsTUFBTTtBQUFBLElBQ25CO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxlQUE4QjtBQUNsQyxTQUFLLFdBQVc7QUFBQSxNQUNkLEdBQUc7QUFBQSxNQUNILEdBQUksTUFBTSxLQUFLLFNBQVM7QUFBQSxJQUMxQjtBQUNBLFVBQU0sS0FBSywwQkFBMEI7QUFDckMsU0FBSyxrQkFBa0I7QUFBQSxFQUN6QjtBQUFBLEVBRUEsTUFBTSwwQkFBMEIsYUFBYSxPQUFzQjtBQUNqRSxVQUFNLGNBQVUsZ0NBQWMsR0FBRyxLQUFLLFNBQVMsT0FBTyx3QkFBd0IsSUFBSSwwQkFBMEIsRUFBRTtBQUM5RyxVQUFNLFVBQVUsS0FBSyxJQUFJLE1BQU07QUFDL0IsVUFBTSxRQUFvQyxDQUFDO0FBQzNDLFFBQUksV0FBVztBQUVmLFFBQUk7QUFDRixVQUFJLENBQUUsTUFBTSxRQUFRLE9BQU8sT0FBTyxHQUFJO0FBQ3BDLGFBQUssU0FBUyx3QkFBd0IsQ0FBQztBQUN2QyxZQUFJLFlBQVk7QUFDZCxnQkFBTSxRQUFRLE1BQU0sT0FBTztBQUMzQixjQUFJLHdCQUFPLDRDQUE0QyxPQUFPLEVBQUU7QUFBQSxRQUNsRTtBQUNBO0FBQUEsTUFDRjtBQUVBLFlBQU0sU0FBUyxNQUFNLFFBQVEsS0FBSyxPQUFPO0FBQ3pDLFlBQU0sUUFBUSxPQUFPLE1BQ2xCLE9BQU8sQ0FBQyxTQUFTLEtBQUssWUFBWSxFQUFFLFNBQVMsT0FBTyxDQUFDLEVBQ3JELEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxjQUFjLENBQUMsQ0FBQztBQUVwQyxpQkFBVyxZQUFZLE9BQU87QUFDNUIsWUFBSTtBQUNGLGdCQUFNLFNBQVMsMEJBQTBCLEtBQUssTUFBTSxNQUFNLFFBQVEsS0FBSyxRQUFRLENBQUMsR0FBRyxRQUFRO0FBQzNGLGNBQUksUUFBUTtBQUNWLGtCQUFNLEtBQUssTUFBTTtBQUFBLFVBQ25CLE9BQU87QUFDTCx3QkFBWTtBQUFBLFVBQ2Q7QUFBQSxRQUNGLFNBQVMsT0FBTztBQUNkLHNCQUFZO0FBQ1osa0JBQVEsS0FBSyxxQ0FBcUMsUUFBUSxJQUFJLEtBQUs7QUFBQSxRQUNyRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLFdBQUssU0FBUyx3QkFBd0IsQ0FBQztBQUN2QyxjQUFRLEtBQUsseUNBQXlDLE9BQU8sSUFBSSxLQUFLO0FBQ3RFLFVBQUksWUFBWTtBQUNkLFlBQUksd0JBQU8sK0NBQStDLE9BQU8sRUFBRTtBQUFBLE1BQ3JFO0FBQ0E7QUFBQSxJQUNGO0FBRUEsU0FBSyxTQUFTLHdCQUF3QjtBQUN0QyxRQUFJLFlBQVk7QUFDZCxZQUFNLFNBQVMsV0FBVyxLQUFLLFFBQVEsWUFBWTtBQUNuRCxVQUFJLHdCQUFPLFVBQVUsTUFBTSxNQUFNLDBCQUEwQixNQUFNLFdBQVcsSUFBSSxLQUFLLEdBQUcsR0FBRyxNQUFNLEVBQUU7QUFBQSxJQUNyRztBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sZUFBOEI7QUFDbEMsU0FBSyxrQkFBa0I7QUFDdkIsVUFBTSxvQkFBaUQsRUFBRSxHQUFHLEtBQUssU0FBUztBQUMxRSxXQUFPLGtCQUFrQjtBQUN6QixVQUFNLEtBQUssU0FBUyxpQkFBaUI7QUFDckMsU0FBSyw0QkFBNEI7QUFDakMsU0FBSyx3QkFBd0I7QUFDN0IsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRUEsZUFBZSxTQUEwQjtBQUN2QyxXQUFPLEtBQUssUUFBUSxJQUFJLE9BQU87QUFBQSxFQUNqQztBQUFBLEVBRUEsdUJBQXVCLFNBQWlCLFVBQWtDO0FBQ3hFLFFBQUksQ0FBQyxLQUFLLGdCQUFnQixJQUFJLE9BQU8sR0FBRztBQUN0QyxXQUFLLGdCQUFnQixJQUFJLFNBQVMsb0JBQUksSUFBSSxDQUFDO0FBQUEsSUFDN0M7QUFDQSxTQUFLLGdCQUFnQixJQUFJLE9BQU8sR0FBRyxJQUFJLFFBQVE7QUFDL0MsV0FBTyxNQUFNO0FBQ1gsV0FBSyxnQkFBZ0IsSUFBSSxPQUFPLEdBQUcsT0FBTyxRQUFRO0FBQUEsSUFDcEQ7QUFBQSxFQUNGO0FBQUEsRUFFQSxxQkFBcUIsT0FBbUM7QUFDdEQsV0FBTyx1QkFBdUIsTUFBTSxJQUFJLEtBQUssZUFBZSxNQUFNLEVBQUUsR0FBRztBQUFBLE1BQ3JFLE9BQU8sTUFBTSxLQUFLLEtBQUssbUJBQW1CLE1BQU0sRUFBRTtBQUFBLE1BQ2xELFFBQVEsWUFBWTtBQUNsQixZQUFJO0FBQ0YsZ0JBQU0sVUFBVSxVQUFVLFVBQVUsTUFBTSxPQUFPO0FBQ2pELGNBQUksd0JBQU8sYUFBYTtBQUFBLFFBQzFCLFFBQVE7QUFDTixjQUFJLHdCQUFPLHlCQUF5QjtBQUFBLFFBQ3RDO0FBQUEsTUFDRjtBQUFBLE1BQ0EsVUFBVSxNQUFNLEtBQUssS0FBSyxrQkFBa0IsTUFBTSxFQUFFO0FBQUEsTUFDcEQsZUFBZSxNQUFNO0FBQ25CLFlBQUksS0FBSyxZQUFZLElBQUksTUFBTSxFQUFFLEdBQUc7QUFDbEMsZUFBSyxZQUFZLE9BQU8sTUFBTSxFQUFFO0FBQUEsUUFDbEMsT0FBTztBQUNMLGVBQUssWUFBWSxJQUFJLE1BQU0sRUFBRTtBQUFBLFFBQy9CO0FBQ0EsYUFBSyxvQkFBb0IsTUFBTSxFQUFFO0FBQUEsTUFDbkM7QUFBQSxNQUNBLGdCQUFnQixNQUFNO0FBQ3BCLGNBQU0sU0FBUyxLQUFLLFFBQVEsSUFBSSxNQUFNLEVBQUU7QUFDeEMsWUFBSSxDQUFDLFFBQVE7QUFDWDtBQUFBLFFBQ0Y7QUFDQSxlQUFPLFVBQVUsQ0FBQyxPQUFPO0FBQ3pCLGFBQUssb0JBQW9CLE1BQU0sRUFBRTtBQUFBLE1BQ25DO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsaUJBQWlCLE9BQXNCLFdBQThCO0FBQ25FLGNBQVUsTUFBTTtBQUNoQixVQUFNLFVBQVUsTUFBTTtBQUV0QixRQUFJLEtBQUssdUJBQXVCLEtBQUssR0FBRztBQUN0QyxnQkFBVSxZQUFZLEtBQUssaUJBQWlCLEtBQUssQ0FBQztBQUFBLElBQ3BEO0FBRUEsVUFBTSxTQUFTLEtBQUssUUFBUSxJQUFJLE9BQU87QUFDdkMsUUFBSSxLQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUc7QUFDN0IsZ0JBQVUsWUFBWSxtQkFBbUIsQ0FBQztBQUMxQztBQUFBLElBQ0Y7QUFFQSxRQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sU0FBUztBQUM5QjtBQUFBLElBQ0Y7QUFFQSxjQUFVLFlBQVksa0JBQWtCLFFBQVE7QUFBQSxNQUM5QyxxQkFBcUIsS0FBSyxTQUFTLHNCQUFzQjtBQUFBLElBQzNELENBQUMsQ0FBQztBQUFBLEVBQ0o7QUFBQSxFQUVBLE1BQU0sbUJBQW1CLFNBQWdDO0FBQ3ZELFVBQU0sUUFBUSxLQUFLLG9CQUFvQixPQUFPO0FBQzlDLFVBQU0sT0FBTyxLQUFLLHNCQUFzQjtBQUN4QyxRQUFJLENBQUMsU0FBUyxDQUFDLE1BQU07QUFDbkI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLLFNBQVMsTUFBTSxLQUFLO0FBQUEsRUFDakM7QUFBQSxFQUVBLE1BQU0sa0JBQWtCLFNBQWdDO0FBQ3RELFVBQU0sUUFBUSxLQUFLLG9CQUFvQixPQUFPO0FBQzlDLFFBQUksQ0FBQyxPQUFPO0FBQ1Y7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLHNCQUFzQixNQUFNLFFBQVE7QUFDaEUsUUFBSSxFQUFFLGdCQUFnQix5QkFBUTtBQUM1QjtBQUFBLElBQ0Y7QUFFQSxTQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUcsTUFBTTtBQUNqQyxTQUFLLFFBQVEsT0FBTyxPQUFPO0FBQzNCLFNBQUssUUFBUSxPQUFPLE9BQU87QUFFM0IsVUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sQ0FBQyxZQUFZO0FBQzlDLFlBQU0sUUFBUSxRQUFRLE1BQU0sT0FBTztBQUNuQyxZQUFNLFNBQVMsd0JBQXdCLEtBQUssTUFBTSxTQUFTLEtBQUssUUFBUTtBQUN4RSxZQUFNLGVBQWUsT0FBTyxLQUFLLENBQUMsY0FBYyxVQUFVLE9BQU8sT0FBTztBQUN4RSxVQUFJLENBQUMsY0FBYztBQUNqQixlQUFPO0FBQUEsTUFDVDtBQUVBLFlBQU0sZUFBZSxLQUFLLHVCQUF1QixPQUFPLE9BQU87QUFDL0QsWUFBTSxlQUFlLGFBQWE7QUFDbEMsWUFBTSxhQUFhLGVBQWUsYUFBYSxNQUFNLGFBQWE7QUFDbEUsWUFBTSxPQUFPLGNBQWMsYUFBYSxlQUFlLENBQUM7QUFFeEQsYUFBTyxlQUFlLE1BQU0sU0FBUyxLQUFLLE1BQU0sWUFBWSxNQUFNLE1BQU0sTUFBTSxlQUFlLENBQUMsTUFBTSxJQUFJO0FBQ3RHLGNBQU0sT0FBTyxjQUFjLENBQUM7QUFBQSxNQUM5QjtBQUVBLGFBQU8sTUFBTSxLQUFLLElBQUk7QUFBQSxJQUN4QixDQUFDO0FBRUQsU0FBSyxvQkFBb0IsT0FBTztBQUNoQyxTQUFLLGdCQUFnQjtBQUNyQixRQUFJLHdCQUFPLHVCQUF1QjtBQUFBLEVBQ3BDO0FBQUEsRUFFQSxNQUFNLG1CQUFtQixNQUE0QjtBQUNuRCxVQUFNLFNBQVMsTUFBTSxLQUFLLElBQUksTUFBTSxXQUFXLElBQUk7QUFDbkQsVUFBTSxTQUFTLHdCQUF3QixLQUFLLE1BQU0sUUFBUSxLQUFLLFFBQVE7QUFDdkUsVUFBTSxrQkFBa0IsT0FBTyxPQUFPLENBQUMsVUFBVTtBQUMvQyxZQUFNLG1CQUFtQix3QkFBd0IsS0FBSyxLQUFLLE1BQU0sT0FBTyxLQUFLLFFBQVE7QUFDckYsYUFBTyxpQkFBaUIsa0JBQWtCLEtBQUssU0FBUyxrQkFBa0IsT0FBTyxLQUFLLFFBQVE7QUFBQSxJQUNoRyxDQUFDO0FBRUQsUUFBSSxDQUFDLGdCQUFnQixRQUFRO0FBQzNCLFVBQUksd0JBQU8scURBQXFEO0FBQ2hFO0FBQUEsSUFDRjtBQUVBLGVBQVcsU0FBUyxpQkFBaUI7QUFDbkMsWUFBTSxLQUFLLFNBQVMsTUFBTSxLQUFLO0FBQUEsSUFDakM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLG9CQUFvQixNQUE0QjtBQUNwRCxVQUFNLFNBQVMsTUFBTSxLQUFLLElBQUksTUFBTSxXQUFXLElBQUk7QUFDbkQsVUFBTSxTQUFTLHdCQUF3QixLQUFLLE1BQU0sUUFBUSxLQUFLLFFBQVE7QUFDdkUsZUFBVyxTQUFTLFFBQVE7QUFDMUIsV0FBSyxRQUFRLE9BQU8sTUFBTSxFQUFFO0FBQzVCLFdBQUssb0JBQW9CLE1BQU0sRUFBRTtBQUNqQyxZQUFNLEtBQUsseUJBQXlCLEtBQUssTUFBTSxNQUFNLEVBQUU7QUFBQSxJQUN6RDtBQUNBLFFBQUksd0JBQU8sdUJBQXVCO0FBQUEsRUFDcEM7QUFBQSxFQUVBLE1BQU0sU0FBUyxNQUFhLE9BQXFDO0FBQy9ELFNBQUssdUJBQXVCLEtBQUs7QUFDakMsUUFBSSxLQUFLLFFBQVEsSUFBSSxNQUFNLEVBQUUsR0FBRztBQUM5QixVQUFJLHdCQUFPLHFDQUFxQztBQUNoRDtBQUFBLElBQ0Y7QUFFQSxRQUFJLENBQUUsTUFBTSxLQUFLLHVCQUF1QixHQUFJO0FBQzFDLGtDQUE0QjtBQUM1QjtBQUFBLElBQ0Y7QUFFQSxVQUFNLG1CQUFtQix3QkFBd0IsS0FBSyxLQUFLLE1BQU0sT0FBTyxLQUFLLFFBQVE7QUFDckYsVUFBTSxpQkFBaUIsaUJBQWlCO0FBQ3hDLFVBQU0sU0FBUyxpQkFBaUIsT0FBTyxLQUFLLFNBQVMsa0JBQWtCLE9BQU8sS0FBSyxRQUFRO0FBQzNGLFFBQUksQ0FBQyxRQUFRO0FBQ1gsVUFBSSxDQUFDLGdCQUFnQjtBQUNuQixZQUFJLHdCQUFPLDRCQUE0QixNQUFNLFFBQVEsR0FBRztBQUN4RDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsVUFBTSxhQUFhLElBQUksZ0JBQWdCO0FBQ3ZDLFVBQU0sUUFBUSxNQUFNLEtBQUssa0JBQWtCLE1BQU0sS0FBSztBQUN0RCxVQUFNLGFBQWE7QUFBQSxNQUNqQjtBQUFBLE1BQ0Esa0JBQWtCLGlCQUFpQjtBQUFBLE1BQ25DLFdBQVcsaUJBQWlCO0FBQUEsTUFDNUIsUUFBUSxXQUFXO0FBQUEsTUFDbkI7QUFBQSxJQUNGO0FBQ0EsU0FBSyxRQUFRLElBQUksTUFBTSxJQUFJLFVBQVU7QUFDckMsU0FBSyxvQkFBb0IsTUFBTSxFQUFFO0FBQ2pDLFNBQUssZ0JBQWdCO0FBRXJCLFFBQUk7QUFDRixZQUFNLGdCQUFnQixNQUFNLEtBQUssdUJBQXVCLE1BQU0sS0FBSztBQUNuRSxZQUFNLFNBQVMsaUJBQ1gsTUFBTSxLQUFLLGdCQUFnQixJQUFJLGNBQWMsT0FBTyxZQUFZLEtBQUssVUFBVSxjQUFjLElBQzdGLE1BQU0sT0FBUSxJQUFJLGNBQWMsT0FBTyxZQUFZLEtBQUssUUFBUTtBQUVwRSxVQUFJLE9BQU8sVUFBVTtBQUNuQixlQUFPLFNBQVMsT0FBTyxVQUFVLDZCQUE2QixLQUFLLFNBQVMsZ0JBQWdCO0FBQUEsTUFDOUYsV0FBVyxPQUFPLFdBQVc7QUFDM0IsZUFBTyxTQUFTLE9BQU8sVUFBVTtBQUFBLE1BQ25DLFdBQVcsQ0FBQyxPQUFPLFdBQVcsQ0FBQyxPQUFPLE9BQU8sS0FBSyxHQUFHO0FBQ25ELGVBQU8sU0FBUztBQUFBLE1BQ2xCO0FBRUEsVUFBSSxjQUFjLGVBQWU7QUFDL0IsY0FBTSxlQUFlLDZCQUE2QixjQUFjLGNBQWMsV0FBVztBQUN6RixlQUFPLFVBQVUsT0FBTyxVQUFVLEdBQUcsWUFBWTtBQUFBLEVBQUssT0FBTyxPQUFPLEtBQUs7QUFBQSxNQUMzRTtBQUNBLFVBQUksS0FBSyw0QkFBNEIsZ0JBQWdCLEdBQUc7QUFDdEQsY0FBTSxnQkFBZ0IsS0FBSyw2QkFBNkIsZ0JBQWdCO0FBQ3hFLGVBQU8sVUFBVSxPQUFPLFVBQVUsR0FBRyxhQUFhO0FBQUEsRUFBSyxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQzVFO0FBQ0EsWUFBTSxLQUFLLDJCQUEyQixNQUFNLE9BQU8sTUFBTTtBQUV6RCxXQUFLLFFBQVEsSUFBSSxNQUFNLElBQUk7QUFBQSxRQUN6QixTQUFTLE1BQU07QUFBQSxRQUNmO0FBQUEsUUFDQTtBQUFBLFFBQ0EsZUFBZSxjQUFjO0FBQUEsUUFDN0IsV0FBVztBQUFBLFFBQ1gsU0FBUztBQUFBLE1BQ1gsQ0FBQztBQUVELFVBQUksS0FBSyxTQUFTLG1CQUFtQjtBQUNuQyxjQUFNLEtBQUssd0JBQXdCLE1BQU0sT0FBTyxNQUFNO0FBQUEsTUFDeEQ7QUFFQSxZQUFNLGFBQWEsaUJBQWlCLGFBQWEsY0FBYyxLQUFLLE9BQVE7QUFDNUUsVUFBSSx3QkFBTyxPQUFPLFVBQVUsWUFBWSxVQUFVLFlBQVksdUJBQXVCLFVBQVUsR0FBRztBQUFBLElBQ3BHLFNBQVMsT0FBTztBQUNkLFlBQU0sVUFBVSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQ3JFLFdBQUssUUFBUSxJQUFJLE1BQU0sSUFBSTtBQUFBLFFBQ3pCLFNBQVMsTUFBTTtBQUFBLFFBQ2Y7QUFBQSxRQUNBLFdBQVc7QUFBQSxRQUNYLFNBQVM7QUFBQSxRQUNULFFBQVE7QUFBQSxVQUNOLFVBQVUsaUJBQWlCLGFBQWEsY0FBYyxLQUFLLFFBQVEsTUFBTTtBQUFBLFVBQ3pFLFlBQVksaUJBQWlCLGFBQWEsY0FBYyxLQUFLLFFBQVEsZUFBZTtBQUFBLFVBQ3BGLFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxVQUNsQyxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsVUFDbkMsWUFBWTtBQUFBLFVBQ1osVUFBVTtBQUFBLFVBQ1YsUUFBUTtBQUFBLFVBQ1IsUUFBUTtBQUFBLFVBQ1IsU0FBUztBQUFBLFVBQ1QsVUFBVTtBQUFBLFVBQ1YsV0FBVztBQUFBLFFBQ2I7QUFBQSxNQUNGLENBQUM7QUFDRCxVQUFJLHdCQUFPLGVBQWUsT0FBTyxFQUFFO0FBQUEsSUFDckMsVUFBRTtBQUNBLFdBQUssUUFBUSxPQUFPLE1BQU0sRUFBRTtBQUM1QixXQUFLLG9CQUFvQixNQUFNLEVBQUU7QUFDakMsV0FBSyxnQkFBZ0I7QUFBQSxJQUN2QjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMseUJBQTJDO0FBQ3ZELFFBQUksS0FBSyxTQUFTLHdCQUF3QixLQUFLLFNBQVMsOEJBQThCO0FBQ3BGLGFBQU87QUFBQSxJQUNUO0FBRUEsV0FBTyxNQUFNLElBQUksUUFBaUIsQ0FBQyxZQUFZO0FBQzdDLFVBQUksVUFBVTtBQUNkLFlBQU0sU0FBUyxDQUFDLFVBQW1CO0FBQ2pDLFlBQUksQ0FBQyxTQUFTO0FBQ1osb0JBQVU7QUFDVixrQkFBUSxLQUFLO0FBQUEsUUFDZjtBQUFBLE1BQ0Y7QUFFQSxZQUFNLFFBQVEsSUFBSSxzQkFBc0IsS0FBSyxLQUFLLFlBQVk7QUFDNUQsYUFBSyxTQUFTLHVCQUF1QjtBQUNyQyxhQUFLLFNBQVMsK0JBQStCO0FBQzdDLGNBQU0sS0FBSyxhQUFhO0FBQ3hCLGVBQU8sSUFBSTtBQUFBLE1BQ2IsQ0FBQztBQUVELFlBQU0sZ0JBQWdCLE1BQU0sTUFBTSxLQUFLLEtBQUs7QUFDNUMsWUFBTSxRQUFRLE1BQU07QUFDbEIsc0JBQWM7QUFDZCxlQUFPLEtBQUssU0FBUyx3QkFBd0IsS0FBSyxTQUFTLDRCQUE0QjtBQUFBLE1BQ3pGO0FBQ0EsWUFBTSxLQUFLO0FBQUEsSUFDYixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsTUFBYSxPQUE0RztBQUM1SixRQUFJLENBQUMsTUFBTSxpQkFBaUI7QUFDMUIsYUFBTyxFQUFFLE1BQU07QUFBQSxJQUNqQjtBQUVBLFVBQU0sZ0JBQWdCLEtBQUssMkJBQTJCLE1BQU0sTUFBTSxnQkFBZ0IsUUFBUTtBQUMxRixVQUFNLGFBQWEsS0FBSyxJQUFJLE1BQU0sc0JBQXNCLGFBQWE7QUFDckUsUUFBSSxFQUFFLHNCQUFzQix5QkFBUTtBQUNsQyxZQUFNLElBQUksTUFBTSxxQ0FBcUMsYUFBYSxFQUFFO0FBQUEsSUFDdEU7QUFFQSxVQUFNLFVBQVUsNEJBQTRCLEtBQUs7QUFDakQsVUFBTSxvQkFBb0IsS0FBSywyQkFBMkIsT0FBTyxJQUFJO0FBQ3JFLFVBQU0sV0FBVyxNQUFNO0FBQUEsTUFDckIsTUFBTSxLQUFLLElBQUksTUFBTSxXQUFXLFVBQVU7QUFBQSxNQUMxQyxFQUFFLEdBQUcsTUFBTSxpQkFBaUIsVUFBVSxjQUFjO0FBQUEsTUFDcEQsTUFBTTtBQUFBLE1BQ047QUFBQSxNQUNBO0FBQUEsUUFDRSxrQkFBa0IsS0FBSyxTQUFTLGlCQUFpQixLQUFLLEtBQUs7QUFBQSxRQUMzRDtBQUFBLFFBQ0EsVUFBVSxPQUFPLGFBQWE7QUFDNUIsZ0JBQU0sZUFBZSxLQUFLLElBQUksTUFBTSwwQkFBc0IsZ0NBQWMsUUFBUSxDQUFDO0FBQ2pGLGlCQUFPLHdCQUF3Qix5QkFBUSxLQUFLLElBQUksTUFBTSxXQUFXLFlBQVksSUFBSTtBQUFBLFFBQ25GO0FBQUEsUUFDQSxxQkFBcUIsT0FBTyxjQUFjLFlBQVksVUFBVSxLQUFLLDZCQUE2QixjQUFjLFlBQVksS0FBSztBQUFBLE1BQ25JO0FBQUEsSUFDRjtBQUNBLFVBQU0sYUFBYSxzQkFBc0IsTUFBTSxVQUFVLFFBQVEsaUJBQWlCLENBQUM7QUFDbkYsVUFBTSxxQkFBcUIsS0FBSyxTQUFTLDhCQUE4QixpQkFBaUI7QUFFeEYsV0FBTztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsU0FBUyxTQUFTO0FBQUEsTUFDcEI7QUFBQSxNQUNBLGVBQWUsb0JBQW9CO0FBQUEsUUFDakMsYUFBYSxTQUFTO0FBQUEsUUFDdEIsVUFBVSxNQUFNO0FBQUEsUUFDaEIsU0FBUyxTQUFTO0FBQUEsUUFDbEI7QUFBQSxRQUNBLFVBQVUsS0FBSyxTQUFTLCtCQUErQjtBQUFBLFFBQ3ZELHdCQUF3QixLQUFLLFNBQVMsa0NBQWtDO0FBQUEsTUFDMUUsSUFBSTtBQUFBLElBQ047QUFBQSxFQUNGO0FBQUEsRUFFUSwyQkFBMkIsTUFBYSxlQUErQjtBQUM3RSxVQUFNLFVBQVUsY0FBYyxLQUFLO0FBQ25DLFFBQUksQ0FBQyxTQUFTO0FBQ1osYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLFFBQVEsV0FBVyxHQUFHLEdBQUc7QUFDM0IsaUJBQU8sZ0NBQWMsUUFBUSxNQUFNLENBQUMsQ0FBQztBQUFBLElBQ3ZDO0FBRUEsVUFBTSxjQUFVLHVCQUFRLEtBQUssSUFBSTtBQUNqQyxlQUFPLGdDQUFjLFlBQVksTUFBTSxVQUFVLEdBQUcsT0FBTyxJQUFJLE9BQU8sRUFBRTtBQUFBLEVBQzFFO0FBQUEsRUFFUSw2QkFBNkIsY0FBc0IsWUFBb0IsT0FBOEI7QUFDM0csVUFBTSxhQUFhLFdBQ2hCLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQ3pCLE9BQU8sT0FBTyxFQUNkLEtBQUssR0FBRztBQUNYLFVBQU0sY0FBVSx1QkFBUSxZQUFZO0FBQ3BDLFVBQU0sV0FBVyxRQUFRLElBQ3JCLENBQUMsS0FBSyxnQkFBZ0IsWUFBWSxNQUFNLEtBQUssU0FBUyxRQUFRLENBQUMsQ0FBQyxJQUNoRSxDQUFDLFlBQVksTUFBTSxLQUFLLFNBQVMsRUFBRTtBQUV2QyxlQUFXLFdBQVcsVUFBVTtBQUM5QixZQUFNLGFBQWEsS0FBSywwQkFBMEIsU0FBUyxVQUFVO0FBQ3JFLGlCQUFXLGFBQWEsWUFBWTtBQUNsQyxjQUFNLGlCQUFhLGdDQUFjLFNBQVM7QUFDMUMsWUFBSSxLQUFLLElBQUksTUFBTSxzQkFBc0IsVUFBVSxhQUFhLHdCQUFPO0FBQ3JFLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLDBCQUEwQixTQUFpQixZQUE4QjtBQUMvRSxVQUFNLFNBQVMsVUFBVSxHQUFHLE9BQU8sTUFBTTtBQUN6QyxRQUFJLENBQUMsWUFBWTtBQUNmLGFBQU8sQ0FBQyxHQUFHLE1BQU0sYUFBYTtBQUFBLElBQ2hDO0FBQ0EsV0FBTztBQUFBLE1BQ0wsR0FBRyxNQUFNLEdBQUcsVUFBVTtBQUFBLE1BQ3RCLEdBQUcsTUFBTSxHQUFHLFVBQVU7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGdCQUFnQixNQUFjLFFBQXdCO0FBQzVELFFBQUksVUFBVTtBQUNkLGFBQVMsUUFBUSxHQUFHLFFBQVEsUUFBUSxTQUFTLEdBQUc7QUFDOUMsWUFBTSxXQUFPLHVCQUFRLE9BQU87QUFDNUIsZ0JBQVUsU0FBUyxNQUFNLEtBQUs7QUFBQSxJQUNoQztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLDZCQUErRTtBQUNuRixXQUFPLEtBQUssZ0JBQWdCLGtCQUFrQjtBQUFBLEVBQ2hEO0FBQUEsRUFFQSxNQUFNLG9CQUFvQixNQUE2QjtBQUNyRCxVQUFNLGFBQWEsSUFBSSxnQkFBZ0I7QUFDdkMsVUFBTSxTQUFTLE1BQU0sS0FBSyxnQkFBZ0IsV0FBVyxNQUFNLEtBQUssSUFBSSxLQUFLLFNBQVMsa0JBQWtCLElBQU8sR0FBRyxXQUFXLE1BQU07QUFDL0gsUUFBSSx3QkFBTyxPQUFPLFVBQVUsOEJBQThCLElBQUksTUFBTSxtQ0FBbUMsSUFBSSxLQUFLLEdBQUk7QUFBQSxFQUN0SDtBQUFBLEVBRUEsOEJBQW9DO0FBQ2xDLGVBQVcsU0FBUyw0QkFBNEIsS0FBSyxRQUFRLEdBQUc7QUFDOUQsWUFBTSxrQkFBa0IsTUFBTSxZQUFZO0FBQzFDLFVBQUksS0FBSywyQkFBMkIsSUFBSSxlQUFlLEdBQUc7QUFDeEQ7QUFBQSxNQUNGO0FBRUEsVUFBSSxpQkFBaUIsS0FBSyxlQUFlLEdBQUc7QUFDMUM7QUFBQSxNQUNGO0FBRUEsV0FBSywyQkFBMkIsSUFBSSxlQUFlO0FBQ25ELFdBQUssbUNBQW1DLGlCQUFpQixPQUFPLFFBQVEsSUFBSSxRQUFRO0FBQ2xGLGNBQU0sV0FBVyxJQUFJO0FBQ3JCLGNBQU0sT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsUUFBUTtBQUMxRCxZQUFJLEVBQUUsZ0JBQWdCLHlCQUFRO0FBQzVCO0FBQUEsUUFDRjtBQUVBLGNBQU0sV0FBVyxNQUFNLEtBQUssSUFBSSxNQUFNLFdBQVcsSUFBSTtBQUNyRCxjQUFNLFNBQVMsd0JBQXdCLFVBQVUsVUFBVSxLQUFLLFFBQVE7QUFDeEUsY0FBTSxVQUFXLE9BQU8sT0FBTyxJQUFJLG1CQUFtQixhQUFjLElBQUksZUFBZSxFQUFFLElBQUk7QUFDN0YsWUFBSTtBQUNKLFlBQUksU0FBUztBQUNYLGdCQUFNLFlBQVksUUFBUTtBQUMxQixrQkFBUSxPQUFPLEtBQUssQ0FBQyxjQUFjLFVBQVUsY0FBYyxhQUFhLFVBQVUsWUFBWSxNQUFNO0FBQUEsUUFDdEcsT0FBTztBQUNMLGtCQUFRLE9BQU8sS0FBSyxDQUFDLGNBQWMsVUFBVSxZQUFZLE1BQU07QUFBQSxRQUNqRTtBQUNBLFlBQUksQ0FBQyxPQUFPO0FBQ1Y7QUFBQSxRQUNGO0FBRUEsWUFBSSxNQUFNLEdBQUcsY0FBYyxLQUFLO0FBQ2hDLFlBQUksQ0FBQyxLQUFLO0FBQ1IsZ0JBQU0sR0FBRyxTQUFTLEtBQUs7QUFDdkIsY0FBSSxTQUFTLFlBQVksZUFBZSxFQUFFO0FBQzFDLGdCQUFNLE9BQU8sSUFBSSxTQUFTLE1BQU07QUFDaEMsZUFBSyxTQUFTLFlBQVksZUFBZSxFQUFFO0FBQzNDLGVBQUssUUFBUSxNQUFNO0FBQUEsUUFDckI7QUFFQSxZQUFJLE1BQU0sYUFBYSxXQUFXO0FBQ2hDLGdCQUFNLE9BQVEsSUFBSSxjQUFjLE1BQU0sS0FBNEI7QUFDbEUsK0JBQXFCLE1BQU0sTUFBTTtBQUFBLFFBQ25DO0FBRUEsWUFBSSxTQUFTLElBQUksdUJBQXVCLElBQUksTUFBTSxPQUFPLEdBQUcsQ0FBQztBQUFBLE1BQy9ELENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUFBLEVBRVEsa0JBQXdCO0FBQzlCLFVBQU0sYUFBYSxLQUFLLFFBQVE7QUFDaEMsU0FBSyxnQkFBZ0IsUUFBUSxhQUFhLFNBQVMsVUFBVSxjQUFjLGVBQWUsSUFBSSxLQUFLLEdBQUcsS0FBSyxZQUFZO0FBQUEsRUFDekg7QUFBQSxFQUVRLG9CQUFvQixTQUF1QjtBQUNqRCxTQUFLLGdCQUFnQixJQUFJLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxTQUFTLENBQUM7QUFDbkUsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRVEsMEJBQWdDO0FBQ3RDLGVBQVcsYUFBYSxLQUFLLGdCQUFnQixPQUFPLEdBQUc7QUFDckQsaUJBQVcsWUFBWSxXQUFXO0FBQ2hDLGlCQUFTO0FBQUEsTUFDWDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSxrQkFBd0I7QUFDOUIsU0FBSyxJQUFJLFVBQVUsZ0JBQWdCLFVBQVUsRUFBRSxRQUFRLENBQUMsU0FBUztBQUMvRCxZQUFNLE9BQU8sS0FBSztBQUNsQixZQUFNLGNBQWUsS0FBb0U7QUFDekYsbUJBQWEsV0FBVyxJQUFJO0FBQUEsSUFDOUIsQ0FBQztBQUVELGVBQVcsY0FBYyxLQUFLLGFBQWE7QUFDekMsaUJBQVcsU0FBUyxFQUFFLFNBQVMsa0JBQWtCLEdBQUcsTUFBUyxFQUFFLENBQUM7QUFBQSxJQUNsRTtBQUFBLEVBQ0Y7QUFBQSxFQUVRLG9CQUEwQjtBQUNoQyxtQ0FBK0IsS0FBSyxRQUFRO0FBQzVDLFNBQUssU0FBUyxxQkFBcUIsNEJBQTRCLEtBQUssU0FBUyxvQkFBb0IsaUJBQWlCLG9CQUFvQixHQUFJO0FBQzFJLFNBQUssU0FBUyxtQkFBbUIseUJBQXlCLEtBQUssU0FBUyxrQkFBa0IsaUJBQWlCLGdCQUFnQjtBQUMzSCxTQUFLLFNBQVMsd0JBQXdCLHVCQUF1QixLQUFLLFNBQVMsdUJBQXVCLGlCQUFpQixxQkFBcUI7QUFDeEksU0FBSyxTQUFTLG1CQUFtQix1QkFBdUIsS0FBSyxTQUFTLGtCQUFrQixpQkFBaUIsZ0JBQWdCO0FBQUEsRUFDM0g7QUFBQSxFQUVRLHdCQUFzQztBQUM1QyxVQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsb0JBQW9CLDZCQUFZO0FBQ2hFLFdBQU8sTUFBTSxRQUFRO0FBQUEsRUFDdkI7QUFBQSxFQUVRLDJCQUEwQztBQUNoRCxXQUFPLEtBQUssc0JBQXNCLEdBQUcsUUFBUSxLQUFLO0FBQUEsRUFDcEQ7QUFBQSxFQUVBLE1BQU0saUNBQWdEO0FBQ3BELFVBQU0sT0FBTyxLQUFLLElBQUksVUFBVSxvQkFBb0IsNkJBQVk7QUFDaEUsUUFBSSxDQUFDLE1BQU07QUFDVDtBQUFBLElBQ0Y7QUFFQSxVQUFNLEtBQUsseUJBQXlCLEtBQUssSUFBSTtBQUFBLEVBQy9DO0FBQUEsRUFFQSxNQUFNLGlDQUFnRDtBQUNwRCxVQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsb0JBQW9CLDZCQUFZO0FBQ2hFLFFBQUksQ0FBQyxNQUFNO0FBQ1Q7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLEtBQUs7QUFDbEIsVUFBTSxZQUFZLEtBQUssYUFBYTtBQUNwQyxVQUFNLFFBQVEsRUFBRSxHQUFJLFVBQVUsU0FBUyxDQUFDLEVBQUc7QUFFM0MsUUFBSSxNQUFNLFNBQVMsWUFBWSxNQUFNLFdBQVcsTUFBTTtBQUNwRCxZQUFNLFNBQVM7QUFDZixZQUFNLEtBQUssYUFBYTtBQUFBLFFBQ3RCLEdBQUc7QUFBQSxRQUNIO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMseUJBQXlCLE1BQW9DO0FBQ3pFLFFBQUksQ0FBQyxLQUFLLFNBQVMsb0JBQW9CO0FBQ3JDO0FBQUEsSUFDRjtBQUVBLFFBQUksS0FBSyxZQUFZO0FBQ25CLFlBQU0sS0FBSyxlQUFlO0FBQUEsSUFDNUI7QUFFQSxVQUFNLE9BQU8sS0FBSztBQUNsQixRQUFJLEVBQUUsZ0JBQWdCLGtDQUFpQixDQUFDLEtBQUssTUFBTTtBQUNqRDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFNBQVMsS0FBSyxRQUFRLFdBQVcsS0FBTSxNQUFNLEtBQUssSUFBSSxNQUFNLFdBQVcsS0FBSyxJQUFJO0FBQ3RGLFVBQU0sU0FBUyx3QkFBd0IsS0FBSyxLQUFLLE1BQU0sUUFBUSxLQUFLLFFBQVE7QUFDNUUsUUFBSSxDQUFDLE9BQU8sUUFBUTtBQUNsQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFlBQVksS0FBSyxhQUFhO0FBQ3BDLFVBQU0sUUFBUSxFQUFFLEdBQUksVUFBVSxTQUFTLENBQUMsRUFBRztBQUMzQyxRQUFJLE1BQU0sU0FBUyxZQUFZLE1BQU0sV0FBVyxNQUFNO0FBQ3BEO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTztBQUNiLFVBQU0sU0FBUztBQUVmLFVBQU0sS0FBSyxhQUFhO0FBQUEsTUFDdEIsR0FBRztBQUFBLE1BQ0g7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFUSxvQkFBb0IsU0FBdUM7QUFDakUsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLG9CQUFvQiw2QkFBWTtBQUNoRSxVQUFNLE9BQU8sTUFBTTtBQUNuQixVQUFNLFNBQVMsTUFBTTtBQUNyQixRQUFJLENBQUMsUUFBUSxDQUFDLFFBQVE7QUFDcEIsYUFBTyxLQUFLLFFBQVEsSUFBSSxPQUFPLEdBQUcsU0FBUztBQUFBLElBQzdDO0FBRUEsVUFBTSxTQUFTLHdCQUF3QixLQUFLLE1BQU0sT0FBTyxTQUFTLEdBQUcsS0FBSyxRQUFRO0FBQ2xGLFdBQU8sT0FBTyxLQUFLLENBQUMsVUFBVSxNQUFNLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sR0FBRyxTQUFTO0FBQUEsRUFDN0Y7QUFBQSxFQUVRLDZCQUE2QjtBQUNuQyxVQUFNLFNBQVM7QUFFZixXQUFPLHdCQUFXO0FBQUEsTUFDaEIsTUFBTTtBQUFBLFFBR0osWUFBNkIsTUFBa0I7QUFBbEI7QUFDM0IsaUJBQU8sWUFBWSxJQUFJLElBQUk7QUFDM0IsZUFBSyxjQUFjLEtBQUssaUJBQWlCO0FBQUEsUUFDM0M7QUFBQSxRQUVBLE9BQU8sUUFBMEI7QUFDL0IsY0FBSSxPQUFPLGNBQWMsT0FBTyxtQkFBbUIsT0FBTyxhQUFhLEtBQUssQ0FBQyxPQUFPLEdBQUcsUUFBUSxLQUFLLENBQUMsV0FBVyxPQUFPLEdBQUcsaUJBQWlCLENBQUMsQ0FBQyxHQUFHO0FBQzlJLGlCQUFLLGNBQWMsS0FBSyxpQkFBaUI7QUFBQSxVQUMzQztBQUFBLFFBQ0Y7QUFBQSxRQUVBLFVBQWdCO0FBQ2QsaUJBQU8sWUFBWSxPQUFPLEtBQUssSUFBSTtBQUFBLFFBQ3JDO0FBQUEsUUFFUSxtQkFBbUI7QUFDekIsZ0JBQU0sV0FBVyxPQUFPLHlCQUF5QjtBQUNqRCxjQUFJLENBQUMsVUFBVTtBQUNiLG1CQUFPLHdCQUFXO0FBQUEsVUFDcEI7QUFFQSxnQkFBTSxTQUFTLEtBQUssS0FBSyxNQUFNLElBQUksU0FBUztBQUM1QyxnQkFBTSxTQUFTLHdCQUF3QixVQUFVLFFBQVEsT0FBTyxRQUFRO0FBQ3hFLGdCQUFNLFVBQVUsSUFBSSw2QkFBNEI7QUFFaEQscUJBQVcsU0FBUyxRQUFRO0FBQzFCLGtCQUFNLFlBQVksS0FBSyxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sWUFBWSxDQUFDO0FBQzlELG9CQUFRO0FBQUEsY0FDTixVQUFVO0FBQUEsY0FDVixVQUFVO0FBQUEsY0FDVix3QkFBVyxPQUFPO0FBQUEsZ0JBQ2hCLFFBQVEsSUFBSSxrQkFBa0IsUUFBUSxLQUFLO0FBQUEsZ0JBQzNDLE1BQU07QUFBQSxjQUNSLENBQUM7QUFBQSxZQUNIO0FBRUEsZ0JBQUksT0FBTyxRQUFRLElBQUksTUFBTSxFQUFFLEtBQUssT0FBTyxRQUFRLElBQUksTUFBTSxFQUFFLEtBQUssT0FBTyx1QkFBdUIsS0FBSyxHQUFHO0FBQ3hHLG9CQUFNLFVBQVUsS0FBSyxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sVUFBVSxDQUFDO0FBQzFELHNCQUFRO0FBQUEsZ0JBQ04sUUFBUTtBQUFBLGdCQUNSLFFBQVE7QUFBQSxnQkFDUix3QkFBVyxPQUFPO0FBQUEsa0JBQ2hCLFFBQVEsSUFBSSxpQkFBaUIsUUFBUSxLQUFLO0FBQUEsa0JBQzFDLE1BQU07QUFBQSxnQkFDUixDQUFDO0FBQUEsY0FDSDtBQUFBLFlBQ0Y7QUFFQSxnQkFBSSxNQUFNLGFBQWEsV0FBVztBQUNoQyxpQ0FBbUIsU0FBUyxLQUFLLE1BQU0sS0FBSztBQUFBLFlBQzlDO0FBQUEsVUFDRjtBQUVBLGlCQUFPLFFBQVEsT0FBTztBQUFBLFFBQ3hCO0FBQUEsTUFDRjtBQUFBLE1BQ0E7QUFBQSxRQUNFLGFBQWEsQ0FBQyxVQUFVLE1BQU07QUFBQSxNQUNoQztBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSw0QkFBNEIsU0FBZ0Q7QUFDbEYsV0FBTyxRQUFRLE9BQU8sY0FBYyxVQUFVLFFBQVEsT0FBTyxxQkFBcUIsYUFBYSxRQUFRLE9BQU8sWUFBWTtBQUFBLEVBQzVIO0FBQUEsRUFFUSw2QkFBNkIsU0FBK0M7QUFDbEYsVUFBTSxTQUFTO0FBQUEsTUFDYixhQUFhLFFBQVEsa0JBQWtCLFFBQVEsS0FBSyxRQUFRLE9BQU8sU0FBUztBQUFBLE1BQzVFLE9BQU8sUUFBUSxnQkFBZ0IsS0FBSyxRQUFRLE9BQU8sZ0JBQWdCO0FBQUEsTUFDbkUsV0FBVyxRQUFRLFNBQVMsT0FBTyxRQUFRLE9BQU8sT0FBTztBQUFBLElBQzNEO0FBQ0EsV0FBTyxzQkFBc0IsT0FBTyxLQUFLLElBQUksQ0FBQztBQUFBLEVBQ2hEO0FBQUEsRUFFUSwyQkFBMkIsT0FBc0IsTUFBaUs7QUFDeE4sVUFBTSxXQUFXLDJCQUEyQixLQUFLLFVBQVUsTUFBTSxVQUFVLE1BQU0sYUFBYTtBQUM5RixRQUFJLENBQUMsVUFBVTtBQUNiLGFBQU87QUFBQSxJQUNUO0FBRUEsVUFBTSxPQUFPLFNBQVMsaUJBQWlCO0FBQ3ZDLFVBQU0sYUFBYSxTQUFTLGdCQUFnQixTQUFTLHFCQUFxQixLQUFLLElBQUksU0FBUyxxQkFBcUIsS0FBSztBQUN0SCxVQUFNLE9BQU8sU0FBUyxnQkFBZ0IsU0FBUyxpQkFBaUIsY0FBYyxTQUFTLGlCQUFpQjtBQUN4RyxRQUFJLENBQUMsWUFBWTtBQUNmLGFBQU87QUFBQSxJQUNUO0FBRUEsVUFBTSxtQkFBbUIsd0JBQXdCLEtBQUssS0FBSyxNQUFNLE9BQU8sS0FBSyxRQUFRO0FBQ3JGLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxVQUFVLFNBQVM7QUFBQSxNQUNuQjtBQUFBLE1BQ0EsTUFBTSxpQkFBaUIsSUFBSTtBQUFBLE1BQzNCLGtCQUFrQixpQkFBaUI7QUFBQSxNQUNuQyxXQUFXLGlCQUFpQjtBQUFBLElBQzlCO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyx3QkFBd0IsTUFBYSxPQUFzQixRQUFtRDtBQUMxSCxVQUFNLEtBQUssSUFBSSxNQUFNLFFBQVEsTUFBTSxDQUFDLFlBQVk7QUFDOUMsWUFBTSxRQUFRLFFBQVEsTUFBTSxPQUFPO0FBQ25DLFlBQU0sU0FBUyx3QkFBd0IsS0FBSyxNQUFNLFNBQVMsS0FBSyxRQUFRO0FBQ3hFLFlBQU0sZUFBZSxPQUFPLEtBQUssQ0FBQyxjQUFjLFVBQVUsT0FBTyxNQUFNLEVBQUU7QUFDekUsWUFBTSxXQUFXLEtBQUssNEJBQTRCLE1BQU0sSUFBSSxNQUFNO0FBQ2xFLFlBQU0sZ0JBQWdCLEtBQUssdUJBQXVCLE9BQU8sTUFBTSxFQUFFO0FBRWpFLFVBQUksZUFBZTtBQUNqQixjQUFNLE9BQU8sY0FBYyxPQUFPLGNBQWMsTUFBTSxjQUFjLFFBQVEsR0FBRyxHQUFHLFFBQVE7QUFDMUYsZUFBTyxNQUFNLEtBQUssSUFBSTtBQUFBLE1BQ3hCO0FBRUEsVUFBSSxDQUFDLGNBQWM7QUFDakIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxZQUFNLE9BQU8sYUFBYSxVQUFVLEdBQUcsR0FBRyxHQUFHLFFBQVE7QUFDckQsYUFBTyxNQUFNLEtBQUssSUFBSTtBQUFBLElBQ3hCLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLDJCQUEyQixNQUFhLE9BQXNCLFFBQW1EO0FBQzdILFFBQUk7QUFDRixZQUFNLFNBQVMsS0FBSyxxQkFBcUIsTUFBTSxLQUFLO0FBQ3BELFVBQUksQ0FBQyxRQUFRO0FBQ1g7QUFBQSxNQUNGO0FBRUEsWUFBTSxLQUFLLHdCQUF3QixPQUFPLElBQUk7QUFDOUMsWUFBTSxXQUFXLE9BQU8sV0FBVyxTQUMvQixLQUFLLHFCQUFxQixNQUFNLE9BQU8sUUFBUSxNQUFNLElBQ3JELEtBQUsscUJBQXFCLFFBQVEsTUFBTTtBQUM1QyxZQUFNLFVBQVUsT0FBTyxTQUFTLFlBQVksTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE9BQU8sT0FBTyxJQUFJLElBQ3ZGLE1BQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLE9BQU8sSUFBSSxJQUM3QztBQUNKLFlBQU0sT0FBTyxPQUFPLFNBQVMsWUFBWSxVQUNyQyxHQUFHLFFBQVEsUUFBUSxRQUFRLElBQUksQ0FBQyxHQUFHLFFBQVEsS0FDM0M7QUFDSixZQUFNLEtBQUssSUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFPLE1BQU0sSUFBSTtBQUVwRCxZQUFNLGFBQWEsT0FBTyxRQUFRLEtBQUssR0FBRztBQUMxQyxZQUFNLFNBQVMscUJBQXFCLE9BQU8sSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLE9BQU8sTUFBTSxLQUFLLFVBQVU7QUFDaEcsYUFBTyxVQUFVLE9BQU8sVUFBVSxHQUFHLE1BQU07QUFBQSxFQUFLLE9BQU8sT0FBTyxLQUFLO0FBQUEsSUFDckUsU0FBUyxPQUFPO0FBQ2QsWUFBTSxVQUFVLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDckUsWUFBTSxTQUFTLGdDQUFnQyxPQUFPO0FBQ3RELGFBQU8sVUFBVSxPQUFPLFVBQVUsR0FBRyxNQUFNO0FBQUEsRUFBSyxPQUFPLE9BQU8sS0FBSztBQUFBLElBQ3JFO0FBQUEsRUFDRjtBQUFBLEVBRVEscUJBQXFCLE1BQWEsT0FBbUQ7QUFDM0YsVUFBTSxVQUFVLE1BQU0sV0FBVyxrQkFBa0IsS0FBSyxNQUFNLFdBQVcsYUFBYTtBQUN0RixRQUFJLENBQUMsU0FBUyxLQUFLLEdBQUc7QUFDcEIsYUFBTztBQUFBLElBQ1Q7QUFFQSxXQUFPO0FBQUEsTUFDTCxNQUFNLEtBQUssdUJBQXVCLE1BQU0sT0FBTztBQUFBLE1BQy9DLE1BQU0sS0FBSyxtQkFBbUIsS0FBSztBQUFBLE1BQ25DLFFBQVEsS0FBSyxxQkFBcUIsS0FBSztBQUFBLE1BQ3ZDLFNBQVMsS0FBSyxzQkFBc0IsS0FBSztBQUFBLElBQzNDO0FBQUEsRUFDRjtBQUFBLEVBRVEsbUJBQW1CLE9BQTBDO0FBQ25FLFVBQU0sU0FBUyxNQUFNLFdBQVcsb0JBQW9CLEtBQUssTUFBTSxXQUFXLGVBQWU7QUFDekYsUUFBSSxVQUFVLENBQUMsQ0FBQyxLQUFLLFNBQVMsTUFBTSxLQUFLLEVBQUUsU0FBUyxPQUFPLEtBQUssRUFBRSxZQUFZLENBQUMsR0FBRztBQUNoRixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sUUFBUSxNQUFNLFdBQVcsdUJBQXVCLEtBQUssTUFBTSxXQUFXLGtCQUFrQixLQUFLLFdBQVcsS0FBSyxFQUFFLFlBQVk7QUFDakksUUFBSSxTQUFTLFVBQVU7QUFDckIsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLFNBQVMsV0FBVztBQUN0QixhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sSUFBSSxNQUFNLHNDQUFzQyxJQUFJLDBCQUEwQjtBQUFBLEVBQ3RGO0FBQUEsRUFFUSxxQkFBcUIsT0FBNEM7QUFDdkUsVUFBTSxVQUFVLE1BQU0sV0FBVyx5QkFBeUIsS0FBSyxNQUFNLFdBQVcsb0JBQW9CLEtBQUssUUFBUSxLQUFLLEVBQUUsWUFBWTtBQUNwSSxRQUFJLFdBQVcsVUFBVSxXQUFXLFFBQVE7QUFDMUMsYUFBTztBQUFBLElBQ1Q7QUFDQSxVQUFNLElBQUksTUFBTSx3Q0FBd0MsTUFBTSxxQkFBcUI7QUFBQSxFQUNyRjtBQUFBLEVBRVEsc0JBQXNCLE9BQThDO0FBQzFFLFVBQU0sUUFBUSxNQUFNLFdBQVcsMEJBQTBCLEtBQUssTUFBTSxXQUFXLHFCQUFxQixLQUFLO0FBQ3pHLFVBQU0sU0FBUyxNQUNaLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxXQUFXLE9BQU8sS0FBSyxFQUFFLFlBQVksQ0FBQyxFQUMzQyxPQUFPLE9BQU87QUFDakIsVUFBTSxXQUFXLE9BQU8sU0FBUyxLQUFLLElBQ2xDLENBQUMsWUFBWSxVQUFVLFdBQVcsUUFBUSxJQUMxQztBQUNKLFVBQU0sVUFBVSxTQUFTLElBQUksQ0FBQyxXQUFXO0FBQ3ZDLFVBQUksV0FBVyxZQUFZLFdBQVcsWUFBWSxXQUFXLGFBQWEsV0FBVyxZQUFZO0FBQy9GLGVBQU87QUFBQSxNQUNUO0FBQ0EsWUFBTSxJQUFJLE1BQU0sK0NBQStDLE1BQU0sR0FBRztBQUFBLElBQzFFLENBQUM7QUFDRCxXQUFPLFFBQVEsU0FBUyxDQUFDLEdBQUcsSUFBSSxJQUFJLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUTtBQUFBLEVBQzNEO0FBQUEsRUFFUSx1QkFBdUIsTUFBYSxTQUF5QjtBQUNuRSxVQUFNLFVBQVUsUUFBUSxLQUFLO0FBQzdCLFFBQUksQ0FBQyxXQUFXLDRCQUE0QixLQUFLLE9BQU8sR0FBRztBQUN6RCxZQUFNLElBQUksTUFBTSxpREFBaUQ7QUFBQSxJQUNuRTtBQUVBLFVBQU0sT0FBTyxRQUFRLFdBQVcsR0FBRyxRQUMvQixnQ0FBYyxRQUFRLE1BQU0sQ0FBQyxDQUFDLFFBQzlCLG9DQUFjLHVCQUFRLEtBQUssSUFBSSxNQUFNLE1BQU0sVUFBVSxPQUFHLHVCQUFRLEtBQUssSUFBSSxDQUFDLElBQUksT0FBTyxFQUFFO0FBQzNGLFVBQU0sUUFBUSxLQUFLLE1BQU0sR0FBRyxFQUFFLE9BQU8sT0FBTztBQUM1QyxRQUFJLENBQUMsTUFBTSxVQUFVLE1BQU0sU0FBUyxJQUFJLEtBQUssS0FBSyxXQUFXLFlBQVksS0FBSyxTQUFTLGVBQWUsS0FBSyxXQUFXLE9BQU8sS0FBSyxTQUFTLFFBQVE7QUFDakosWUFBTSxJQUFJLE1BQU0sa0NBQWtDLE9BQU8sRUFBRTtBQUFBLElBQzdEO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsd0JBQXdCLE1BQTZCO0FBQ2pFLFVBQU0sYUFBUyx1QkFBUSxJQUFJO0FBQzNCLFFBQUksQ0FBQyxVQUFVLFdBQVcsS0FBSztBQUM3QjtBQUFBLElBQ0Y7QUFFQSxRQUFJLFVBQVU7QUFDZCxlQUFXLFFBQVEsT0FBTyxNQUFNLEdBQUcsRUFBRSxPQUFPLE9BQU8sR0FBRztBQUNwRCxnQkFBVSxVQUFVLEdBQUcsT0FBTyxJQUFJLElBQUksS0FBSztBQUMzQyxVQUFJLENBQUUsTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE9BQU8sT0FBTyxHQUFJO0FBQ25ELGNBQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxNQUFNLE9BQU87QUFBQSxNQUM1QztBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSxxQkFBcUIsUUFBb0MsUUFBc0M7QUFDckcsVUFBTSxXQUFXLE9BQU8sUUFBUSxRQUFRLENBQUMsV0FBVztBQUNsRCxjQUFRLFFBQVE7QUFBQSxRQUNkLEtBQUs7QUFDSCxpQkFBTztBQUFBLFlBQ0wsVUFBVSxPQUFPLFVBQVU7QUFBQSxZQUMzQixRQUFRLE9BQU8sWUFBWSxHQUFHO0FBQUEsWUFDOUIsWUFBWSxPQUFPLFVBQVU7QUFBQSxZQUM3QixhQUFhLE9BQU8sVUFBVTtBQUFBLFVBQ2hDLEVBQUUsS0FBSyxJQUFJO0FBQUEsUUFDYixLQUFLO0FBQ0gsaUJBQU8sT0FBTyxTQUFTLENBQUMsT0FBTyxNQUFNLElBQUksQ0FBQztBQUFBLFFBQzVDLEtBQUs7QUFDSCxpQkFBTyxPQUFPLFVBQVUsQ0FBQyxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQUEsUUFDOUMsS0FBSztBQUNILGlCQUFPLE9BQU8sU0FBUyxDQUFDLE9BQU8sTUFBTSxJQUFJLENBQUM7QUFBQSxNQUM5QztBQUFBLElBQ0YsQ0FBQztBQUNELFdBQU8sR0FBRyxTQUFTLEtBQUssTUFBTSxFQUFFLFFBQVEsUUFBUSxFQUFFLENBQUM7QUFBQTtBQUFBLEVBQ3JEO0FBQUEsRUFFUSxxQkFBcUIsTUFBYSxPQUFzQixRQUFvQyxRQUFzQztBQUN4SSxVQUFNLFVBQVU7QUFBQSxNQUNkLE1BQU0sS0FBSztBQUFBLE1BQ1gsU0FBUyxNQUFNO0FBQUEsTUFDZixVQUFVLE1BQU07QUFBQSxNQUNoQixRQUFRLE9BQU87QUFBQSxNQUNmLFVBQVUsT0FBTztBQUFBLE1BQ2pCLFNBQVMsT0FBTztBQUFBLE1BQ2hCLFlBQVksT0FBTztBQUFBLE1BQ25CLFdBQVcsT0FBTztBQUFBLE1BQ2xCLFlBQVksT0FBTztBQUFBLE1BQ25CLFNBQVM7QUFBQSxRQUNQLEdBQUksT0FBTyxRQUFRLFNBQVMsUUFBUSxJQUFJLEVBQUUsUUFBUSxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQUEsUUFDckUsR0FBSSxPQUFPLFFBQVEsU0FBUyxTQUFTLElBQUksRUFBRSxTQUFTLE9BQU8sV0FBVyxHQUFHLElBQUksQ0FBQztBQUFBLFFBQzlFLEdBQUksT0FBTyxRQUFRLFNBQVMsUUFBUSxJQUFJLEVBQUUsUUFBUSxPQUFPLE9BQU8sSUFBSSxDQUFDO0FBQUEsTUFDdkU7QUFBQSxJQUNGO0FBQ0EsV0FBTyxHQUFHLEtBQUssVUFBVSxTQUFTLE1BQU0sQ0FBQyxDQUFDO0FBQUE7QUFBQSxFQUM1QztBQUFBLEVBRUEsTUFBYyx5QkFBeUIsVUFBa0IsU0FBZ0M7QUFDdkYsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLHNCQUFzQixRQUFRO0FBQzFELFFBQUksRUFBRSxnQkFBZ0IseUJBQVE7QUFDNUI7QUFBQSxJQUNGO0FBRUEsVUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLE1BQU0sQ0FBQyxZQUFZO0FBQzlDLFlBQU0sUUFBUSxRQUFRLE1BQU0sT0FBTztBQUNuQyxZQUFNLFFBQVEsS0FBSyx1QkFBdUIsT0FBTyxPQUFPO0FBQ3hELFVBQUksQ0FBQyxPQUFPO0FBQ1YsZUFBTztBQUFBLE1BQ1Q7QUFDQSxZQUFNLE9BQU8sTUFBTSxPQUFPLE1BQU0sTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUNyRCxhQUFPLE1BQU0sS0FBSyxJQUFJO0FBQUEsSUFDeEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVRLDRCQUE0QixTQUFpQixRQUE4QztBQUNqRyxVQUFNLE9BQU87QUFBQSxNQUNYLFVBQVUsT0FBTyxVQUFVO0FBQUEsTUFDM0IsUUFBUSxPQUFPLFlBQVksR0FBRztBQUFBLE1BQzlCLFlBQVksT0FBTyxVQUFVO0FBQUEsTUFDN0IsYUFBYSxPQUFPLFVBQVU7QUFBQSxNQUM5QixPQUFPLFNBQVM7QUFBQSxFQUFZLE9BQU8sTUFBTSxLQUFLO0FBQUEsTUFDOUMsT0FBTyxVQUFVO0FBQUEsRUFBYSxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQ2pELE9BQU8sU0FBUztBQUFBLEVBQVksT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUNoRCxFQUNHLE9BQU8sT0FBTyxFQUNkLEtBQUssTUFBTTtBQUVkLFdBQU87QUFBQSxNQUNMLDZCQUE2QixPQUFPO0FBQUEsTUFDcEM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsdUJBQXVCLE9BQWlCLFNBQXdEO0FBQ3RHLFVBQU0sY0FBYyw2QkFBNkIsT0FBTztBQUN4RCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sYUFBYTtBQUNuQztBQUFBLE1BQ0Y7QUFFQSxlQUFTLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUM1QyxZQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSw0QkFBNEI7QUFDbEQsaUJBQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDNUI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSx1QkFBdUIsT0FBK0I7QUFDcEQsV0FBTyxLQUFLLFlBQVksSUFBSSxNQUFNLEVBQUUsS0FBSyxLQUFLLHlCQUF5QixLQUFLO0FBQUEsRUFDOUU7QUFBQSxFQUVRLHlCQUF5QixPQUErQjtBQUM5RCxVQUFNLFFBQVEsTUFBTSxXQUFXLFlBQVksS0FBSyxNQUFNLFdBQVc7QUFDakUsUUFBSSxTQUFTLENBQUMsQ0FBQyxLQUFLLFNBQVMsTUFBTSxLQUFLLEVBQUUsU0FBUyxNQUFNLEtBQUssRUFBRSxZQUFZLENBQUMsR0FBRztBQUM5RSxhQUFPO0FBQUEsSUFDVDtBQUNBLFdBQU8sTUFBTSxXQUFXLFlBQVksS0FBSyxRQUN2QyxNQUFNLFdBQVcsU0FBUyxRQUMxQixNQUFNLFdBQVcsaUJBQWlCLEtBQUssUUFDdkMsTUFBTSxXQUFXLFlBQVksS0FBSztBQUFBLEVBQ3RDO0FBQUEsRUFFUSxpQkFBaUIsT0FBbUM7QUFDMUQsVUFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFVBQU0sWUFBWTtBQUVsQixVQUFNLFNBQVMsTUFBTSxVQUFVLEVBQUUsS0FBSyxvQkFBb0IsQ0FBQztBQUMzRCxXQUFPLFdBQVcsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUNuQyxVQUFNLFVBQVUsT0FBTyxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUM5RCxVQUFNLFlBQVksUUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLE1BQU0sQ0FBQztBQUM1RCxVQUFNLGNBQWMsUUFBUSxTQUFTLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUVoRSxVQUFNLFdBQVcsTUFBTSxTQUFTLFlBQVksRUFBRSxLQUFLLG1CQUFtQixDQUFDO0FBQ3ZFLGFBQVMsY0FBYyxLQUFLLG9CQUFvQixLQUFLO0FBQ3JELGFBQVMsUUFBUSxLQUFLLFlBQVksSUFBSSxNQUFNLEVBQUUsS0FBSyxNQUFNLFdBQVcsWUFBWSxLQUFLLE1BQU0sV0FBVyxTQUFTO0FBQy9HLGFBQVMsaUJBQWlCLFNBQVMsTUFBTTtBQUN2QyxXQUFLLFlBQVksSUFBSSxNQUFNLElBQUksU0FBUyxLQUFLO0FBQUEsSUFDL0MsQ0FBQztBQUNELGNBQVUsaUJBQWlCLFNBQVMsQ0FBQyxVQUFVO0FBQzdDLFlBQU0sZUFBZTtBQUNyQixZQUFNLGdCQUFnQjtBQUN0QixXQUFLLFlBQVksSUFBSSxNQUFNLElBQUksU0FBUyxLQUFLO0FBQzdDLFdBQUssS0FBSyxtQkFBbUIsTUFBTSxFQUFFO0FBQUEsSUFDdkMsQ0FBQztBQUNELGdCQUFZLGlCQUFpQixTQUFTLENBQUMsVUFBVTtBQUMvQyxZQUFNLGVBQWU7QUFDckIsWUFBTSxnQkFBZ0I7QUFDdEIsZUFBUyxRQUFRO0FBQ2pCLFdBQUssWUFBWSxJQUFJLE1BQU0sSUFBSSxFQUFFO0FBQUEsSUFDbkMsQ0FBQztBQUVELFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFUSxvQkFBb0IsT0FBOEI7QUFDeEQsVUFBTSxZQUFZLE1BQU0sV0FBVyxpQkFBaUIsS0FBSyxNQUFNLFdBQVcsWUFBWTtBQUN0RixXQUFPLFlBQVksZUFBZSxTQUFTLEtBQUs7QUFBQSxFQUNsRDtBQUFBLEVBRUEsTUFBYyxrQkFBa0IsTUFBYSxPQUFtRDtBQUM5RixRQUFJLEtBQUssWUFBWSxJQUFJLE1BQU0sRUFBRSxHQUFHO0FBQ2xDLGFBQU8sS0FBSyxZQUFZLElBQUksTUFBTSxFQUFFO0FBQUEsSUFDdEM7QUFFQSxVQUFNLFNBQVMsTUFBTSxXQUFXLFlBQVksS0FBSyxNQUFNLFdBQVc7QUFDbEUsUUFBSSxVQUFVLE1BQU07QUFDbEIsYUFBTyx1QkFBdUIsTUFBTTtBQUFBLElBQ3RDO0FBRUEsVUFBTSxZQUFZLE1BQU0sV0FBVyxpQkFBaUIsS0FBSyxNQUFNLFdBQVcsWUFBWTtBQUN0RixRQUFJLENBQUMsV0FBVyxLQUFLLEdBQUc7QUFDdEIsYUFBTztBQUFBLElBQ1Q7QUFFQSxVQUFNLFlBQVksS0FBSywyQkFBMkIsTUFBTSxTQUFTO0FBQ2pFLFVBQU0sWUFBWSxLQUFLLElBQUksTUFBTSxzQkFBc0IsU0FBUztBQUNoRSxRQUFJLEVBQUUscUJBQXFCLHlCQUFRO0FBQ2pDLFlBQU0sSUFBSSxNQUFNLHlCQUF5QixTQUFTLEVBQUU7QUFBQSxJQUN0RDtBQUNBLFdBQU8sS0FBSyxJQUFJLE1BQU0sV0FBVyxTQUFTO0FBQUEsRUFDNUM7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELFNBQU8sTUFBTSxRQUFRLFFBQVEsSUFBSSxFQUFFLFFBQVEsUUFBUSxHQUFJO0FBQ3pEO0FBRUEsU0FBUywwQkFBMEIsT0FBZ0IsVUFBbUQ7QUFDcEcsTUFBSSxDQUFDLFNBQVMsS0FBSyxHQUFHO0FBQ3BCLFlBQVEsS0FBSywrQkFBK0IsUUFBUSw4QkFBOEI7QUFDbEYsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQVEsV0FBVyxNQUFNLEVBQUU7QUFDakMsUUFBTSxLQUFLLG9CQUFvQixLQUFLO0FBQ3BDLE1BQUksQ0FBQyxJQUFJO0FBQ1AsWUFBUSxLQUFLLCtCQUErQixRQUFRLHNCQUFzQjtBQUMxRSxXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksQ0FBQyxNQUFNLFFBQVEsTUFBTSxTQUFTLEdBQUc7QUFDbkMsWUFBUSxLQUFLLCtCQUErQixRQUFRLDhCQUE4QjtBQUNsRixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sWUFBWSxNQUFNLFVBQ3JCLElBQUksQ0FBQyxhQUFhLHNCQUFzQixVQUFVLFFBQVEsQ0FBQyxFQUMzRCxPQUFPLENBQUMsYUFBK0MsUUFBUSxRQUFRLENBQUM7QUFDM0UsTUFBSSxDQUFDLFVBQVUsUUFBUTtBQUNyQixZQUFRLEtBQUssK0JBQStCLFFBQVEsc0JBQXNCO0FBQzFFLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTztBQUFBLElBQ0wsSUFBSSxZQUFZLEVBQUU7QUFBQSxJQUNsQixhQUFhLFdBQVcsTUFBTSxXQUFXLEtBQUs7QUFBQSxJQUM5QyxhQUFhLFdBQVcsTUFBTSxXQUFXLEtBQUssK0JBQStCLFFBQVE7QUFBQSxJQUNyRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsc0JBQXNCLE9BQWdCLFVBQStDO0FBQzVGLE1BQUksQ0FBQyxTQUFTLEtBQUssR0FBRztBQUNwQixZQUFRLEtBQUssOEJBQThCLFFBQVEsMkJBQTJCO0FBQzlFLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxVQUFVLFdBQVcsTUFBTSxFQUFFLEtBQUssV0FBVyxNQUFNLElBQUk7QUFDN0QsUUFBTSxPQUFPLG9CQUFvQixPQUFPO0FBQ3hDLFFBQU0sYUFBYSxXQUFXLE1BQU0sVUFBVTtBQUM5QyxNQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7QUFDeEIsWUFBUSxLQUFLLDhCQUE4QixRQUFRLGdEQUFnRDtBQUNuRyxXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxhQUFhLFdBQVcsTUFBTSxXQUFXLEtBQUs7QUFBQSxJQUM5QyxhQUFhLFdBQVcsTUFBTSxXQUFXO0FBQUEsSUFDekMsU0FBUyxjQUFjLE1BQU0sU0FBUyxJQUFJLEVBQUUsS0FBSyxJQUFJO0FBQUEsSUFDckQ7QUFBQSxJQUNBLE1BQU0sV0FBVyxNQUFNLElBQUksS0FBSztBQUFBLElBQ2hDLFdBQVdDLG9CQUFtQixXQUFXLE1BQU0sU0FBUyxHQUFHLElBQUk7QUFBQSxJQUMvRCxlQUFlLFdBQVcsTUFBTSxhQUFhLE1BQU0sZ0JBQWdCLGdCQUFnQjtBQUFBLElBQ25GLHFCQUFxQixXQUFXLE1BQU0sbUJBQW1CO0FBQUEsSUFDekQsZUFBZSxXQUFXLE1BQU0sYUFBYSxLQUFLO0FBQUEsSUFDbEQscUJBQXFCLFdBQVcsTUFBTSxtQkFBbUI7QUFBQSxJQUN6RCxlQUFlLFdBQVcsTUFBTSxhQUFhLEtBQUs7QUFBQSxFQUNwRDtBQUNGO0FBRUEsU0FBUyxTQUFTLE9BQWtEO0FBQ2xFLFNBQU8sT0FBTyxVQUFVLFlBQVksVUFBVSxRQUFRLENBQUMsTUFBTSxRQUFRLEtBQUs7QUFDNUU7QUFFQSxTQUFTLFdBQVcsT0FBd0I7QUFDMUMsU0FBTyxPQUFPLFVBQVUsV0FBVyxNQUFNLEtBQUssSUFBSTtBQUNwRDtBQUVBLFNBQVMsY0FBYyxPQUFnQixNQUF3QjtBQUM3RCxRQUFNLFVBQVUsTUFBTSxRQUFRLEtBQUssSUFDL0IsTUFBTSxRQUFRLENBQUMsVUFBVSxXQUFXLEtBQUssRUFBRSxNQUFNLEdBQUcsQ0FBQyxJQUNyRCxXQUFXLEtBQUssRUFBRSxNQUFNLEdBQUc7QUFDL0IsU0FBTyxRQUNKLElBQUksQ0FBQyxVQUFVLG9CQUFvQixLQUFLLENBQUMsRUFDekMsT0FBTyxDQUFDLE9BQU8sT0FBTyxTQUFTLFFBQVEsS0FBSyxLQUFLLFVBQVUsUUFBUSxLQUFLLFFBQVEsS0FBSyxNQUFNLEtBQUs7QUFDckc7QUFFQSxTQUFTLG9CQUFvQixPQUF1QjtBQUNsRCxTQUFPLE1BQ0osS0FBSyxFQUNMLFlBQVksRUFDWixRQUFRLGlCQUFpQixHQUFHLEVBQzVCLFFBQVEsWUFBWSxFQUFFO0FBQzNCO0FBRUEsU0FBU0Esb0JBQW1CLE9BQWUsTUFBc0I7QUFDL0QsTUFBSSxDQUFDLE9BQU87QUFDVixXQUFPLElBQUksSUFBSTtBQUFBLEVBQ2pCO0FBQ0EsU0FBTyxNQUFNLFdBQVcsR0FBRyxJQUFJLFFBQVEsSUFBSSxLQUFLO0FBQ2xEO0FBRUEsU0FBUyx5QkFBeUIsT0FBZ0IsVUFBMEI7QUFDMUUsU0FBTyxPQUFPLFVBQVUsWUFBWSxPQUFPLFNBQVMsS0FBSyxLQUFLLFFBQVEsSUFDbEUsS0FBSyxNQUFNLEtBQUssSUFDaEI7QUFDTjtBQUVBLFNBQVMsNEJBQTRCLE9BQWdCLFVBQWtCLEtBQXFCO0FBQzFGLE1BQUksT0FBTyxVQUFVLFlBQVksQ0FBQyxPQUFPLFNBQVMsS0FBSyxLQUFLLFFBQVEsR0FBRztBQUNyRSxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sS0FBSyxJQUFJLEtBQUssTUFBTSxLQUFLLEdBQUcsR0FBRztBQUN4QztBQUVBLFNBQVMsdUJBQXVCLE9BQWdCLFVBQTBCO0FBQ3hFLFNBQU8sT0FBTyxVQUFVLFdBQVcsUUFBUTtBQUM3QzsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJwYXJzZUFsaWFzTGlzdCIsICJnZXRMZWFkaW5nV2hpdGVzcGFjZSIsICJwYXJzZVBvc2l0aXZlSW50ZWdlciIsICJpc0Rpc2FibGVkVmFsdWUiLCAibm9ybWFsaXplRXh0ZW5zaW9uIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9mcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAibG9vbVBsdWdpbiIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X29zIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAibm9ybWFsaXplRXh0ZW5zaW9uIl0KfQo=
