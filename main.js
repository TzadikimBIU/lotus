"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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
    const { readdir } = await import("fs/promises");
    const entries = await readdir(containersPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => {
      const groupPath = (0, import_path2.join)(containersPath, entry.name);
      const hasConfig = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "config.json"));
      const hasDockerfile = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"));
      return {
        name: entry.name,
        status: hasConfig ? hasDockerfile ? "config + Dockerfile" : "config only" : "missing config.json"
      };
    });
  }
  async run(block, context, settings, groupName) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const language = config.languages[block.language] ?? config.languages[block.languageAlias];
    if (!language) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
      if (!command.length) {
        throw new Error(`Container command for ${block.language} is empty.`);
      }
      return await runProcess({
        runnerId: `container:${groupName}:${block.language}`,
        runnerName: `Container ${groupName}`,
        executable: "docker",
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
    } finally {
      await (0, import_promises2.rm)(tempFilePath, { force: true });
    }
  }
  async buildGroup(groupName, timeoutMs, signal) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
  }
  async resolveImage(groupName, groupPath, config, context, settings) {
    const dockerfile = (0, import_path2.join)(groupPath, "Dockerfile");
    if (!(0, import_fs.existsSync)(dockerfile)) {
      return config.image || "ubuntu:latest";
    }
    const image = this.imageNameForGroup(groupName);
    if (this.builtImages.has(image)) {
      return image;
    }
    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 12e4), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `Docker build failed for ${groupName}.`);
    }
    this.builtImages.add(image);
    return image;
  }
  async buildImage(groupName, groupPath, _config, timeoutMs, signal) {
    const image = this.imageNameForGroup(groupName);
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `Container ${groupName} build`,
      executable: "docker",
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal
    });
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
      if (typeof languageConfig.command !== "string" || !languageConfig.command.trim()) {
        throw new Error(`Container language ${language} must define command.`);
      }
      languages[language] = {
        command: languageConfig.command,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : `.${language}`
      };
    }
    return {
      image: typeof data.image === "string" ? data.image : void 0,
      languages
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
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
};
function normalizeExtension(extension) {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
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
  pdfExportMode: "both"
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
        void this.loomPlugin.enforceSourceModeForActiveView();
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
    const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
    listEl.setText("Scanning container groups...");
    const groups = await this.loomPlugin.getContainerGroupSummaries();
    listEl.empty();
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
      );
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
  }
  eq(other) {
    return other.block.id === this.block.id && other.plugin.isBlockRunning(this.block.id) === this.plugin.isBlockRunning(this.block.id);
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
    const containerGroup = this.containerRunner.getContainerGroupName(file);
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
    const containerGroup = this.containerRunner.getContainerGroupName(file);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIgfSBmcm9tIFwiLi91aS9jb2RlQmxvY2tUb29sYmFyXCI7XG5pbXBvcnQgeyBjcmVhdGVPdXRwdXRQYW5lbCwgY3JlYXRlUnVubmluZ1BhbmVsIH0gZnJvbSBcIi4vdWkvb3V0cHV0UGFuZWxcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIucGx1Z2luLmlzQmxvY2tSdW5uaW5nKHRoaXMuYmxvY2suaWQpID09PSB0aGlzLnBsdWdpbi5pc0Jsb2NrUnVubmluZyh0aGlzLmJsb2NrLmlkKTtcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lclJ1bm5lciA9IG5ldyBsb29tQ29udGFpbmVyUnVubmVyKHRoaXMuYXBwLCB0aGlzLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIik7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcnVubmluZyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0TGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNldDwoKSA9PiB2b2lkPj4oKTtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlZGl0b3JWaWV3cyA9IG5ldyBTZXQ8RWRpdG9yVmlldz4oKTtcbiAgcHJpdmF0ZSBsYXN0TWFya2Rvd25GaWxlUGF0aDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwgPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBDdXJyZW50IENvZGUgQmxvY2tcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiBhc3luYyAoZWRpdG9yLCB2aWV3KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9jayBhdCB0aGUgY3VycmVudCBjdXJzb3IuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tYWxsLWNvZGUtYmxvY2tzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBBbGwgU3VwcG9ydGVkIENvZGUgQmxvY2tzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tY2xlYXItbm90ZS1vdXRwdXRzXCIsXG4gICAgICBuYW1lOiBcImxvb206IENsZWFyIGxvb20gT3V0cHV0cyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbih0aGlzLmNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkpO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS12YWxpZGF0ZS1jb250YWluZXItZ3JvdXBzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFZhbGlkYXRlIENvbnRhaW5lciBHcm91cHNcIixcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMuZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICAgICAgbmV3IE5vdGljZShncm91cHMubGVuZ3RoID8gZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGAke2dyb3VwLm5hbWV9OiAke2dyb3VwLnN0YXR1c31gKS5qb2luKFwiXFxuXCIpIDogXCJObyBsb29tIGNvbnRhaW5lciBncm91cHMgZm91bmQuXCIsIDgwMDApO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItY2hhbmdlXCIsIChfZWRpdG9yLCBjdHgpID0+IHtcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xuICAgICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYoY3R4LmxlYWYpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIHRoaXMucnVubmluZy52YWx1ZXMoKSkge1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLihhd2FpdCB0aGlzLmxvYWREYXRhKCkpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSk7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSB0aGlzLnJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGUpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKGJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlOiBURmlsZSk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICBjb25zdCBmaWxlRm9sZGVyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBleHRlbnNpb246IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJDb25maWcge1xuICBpbWFnZT86IHN0cmluZztcbiAgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkge31cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHJlYWRkaXIgfSA9IGF3YWl0IGltcG9ydChcImZzL3Byb21pc2VzXCIpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIGVudHJpZXNcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XG4gICAgICAgIGNvbnN0IGhhc0NvbmZpZyA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIikpO1xuICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgIHN0YXR1czogaGFzQ29uZmlnID8gKGhhc0RvY2tlcmZpbGUgPyBcImNvbmZpZyArIERvY2tlcmZpbGVcIiA6IFwiY29uZmlnIG9ubHlcIikgOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VdID8/IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VBbGlhc107XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgZ3JvdXAgJHtncm91cE5hbWV9IGhhcyBubyBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICB9XG5cbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IHRlbXBGaWxlTmFtZSA9IGB0ZW1wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0ke25vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24pfWA7XG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSkpO1xuICAgICAgaWYgKCFjb21tYW5kLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfSBpcyBlbXB0eS5gKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgICBydW5uZXJOYW1lOiBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IFwiZG9ja2VyXCIsXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICBcInJ1blwiLFxuICAgICAgICAgIFwiLS1ybVwiLFxuICAgICAgICAgIFwiLXZcIixcbiAgICAgICAgICBgJHtncm91cFBhdGh9Oi93b3Jrc3BhY2VgLFxuICAgICAgICAgIFwiLXdcIixcbiAgICAgICAgICBcIi93b3Jrc3BhY2VcIixcbiAgICAgICAgICBpbWFnZSxcbiAgICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgcmV0dXJuIHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBkb2NrZXJmaWxlID0gam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoZG9ja2VyZmlsZSkpIHtcbiAgICAgIHJldHVybiBjb25maWcuaW1hZ2UgfHwgXCJ1YnVudHU6bGF0ZXN0XCI7XG4gICAgfVxuXG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZSk7XG4gICAgaWYgKHRoaXMuYnVpbHRJbWFnZXMuaGFzKGltYWdlKSkge1xuICAgICAgcmV0dXJuIGltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRleHQuc2lnbmFsKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBEb2NrZXIgYnVpbGQgZmFpbGVkIGZvciAke2dyb3VwTmFtZX0uYCk7XG4gICAgfVxuXG4gICAgdGhpcy5idWlsdEltYWdlcy5hZGQoaW1hZ2UpO1xuICAgIHJldHVybiBpbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRJbWFnZShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBfY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICBleGVjdXRhYmxlOiBcImRvY2tlclwiLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZENvbmZpZyhncm91cFBhdGg6IHN0cmluZyk6IFByb21pc2U8bG9vbUNvbnRhaW5lckNvbmZpZz4ge1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKTtcbiAgICBsZXQgcmF3OiB1bmtub3duO1xuICAgIHRyeSB7XG4gICAgICByYXcgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGNvbmZpZ1BhdGgsIFwidXRmOFwiKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIHJlYWQgY29udGFpbmVyIGNvbmZpZyAke2NvbmZpZ1BhdGh9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IHJhdyBhcyB7IGltYWdlPzogdW5rbm93bjsgbGFuZ3VhZ2VzPzogdW5rbm93biB9O1xuICAgIGlmIChkYXRhLmltYWdlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuaW1hZ2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgaW1hZ2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICghZGF0YS5sYW5ndWFnZXMgfHwgdHlwZW9mIGRhdGEubGFuZ3VhZ2VzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGF0YS5sYW5ndWFnZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGxhbmd1YWdlcyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+ID0ge307XG4gICAgZm9yIChjb25zdCBbbGFuZ3VhZ2UsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhkYXRhLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcbiAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgICAgfVxuICAgICAgY29uc3QgbGFuZ3VhZ2VDb25maWcgPSB2YWx1ZSBhcyB7IGNvbW1hbmQ/OiB1bmtub3duOyBleHRlbnNpb24/OiB1bmtub3duIH07XG4gICAgICBpZiAodHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWxhbmd1YWdlQ29uZmlnLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQuYCk7XG4gICAgICB9XG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICBsYW5ndWFnZXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q29udGFpbmVyc1BhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAodGhpcy5hcHAudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVOYW1lID0gYmFzZW5hbWUoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIXNhZmVOYW1lIHx8IHNhZmVOYW1lICE9PSBncm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbih0aGlzLmdldENvbnRhaW5lcnNQYXRoKCksIHNhZmVOYW1lKSk7XG4gIH1cblxuICBwcml2YXRlIGltYWdlTmFtZUZvckdyb3VwKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYGxvb20tY29udGFpbmVyLSR7Z3JvdXBOYW1lLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTlfLi1dL2csIFwiLVwiKX1gO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0RvY2tlck5vdGljZShtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShtZXNzYWdlLCA4MDAwKTtcbn1cbiIsICJpbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVByb2Nlc3NTcGVjIHtcbiAgcnVubmVySWQ6IHN0cmluZztcbiAgcnVubmVyTmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBzaWduYWw6IEFib3J0U2lnbmFsO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kVGVtcGxhdGVkRW52KGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQsIHRlbXBGaWxlOiBzdHJpbmcsIHRlbXBEaXI6IHN0cmluZyk6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFlbnYpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnYpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBbXG4gICAgICBrZXksXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpIDogdmFsdWUsXG4gICAgXSksXG4gICk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIHNwbGl0Q29tbWFuZExpbmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgbGV0IHF1b3RlOiBcIidcIiB8IFwiXFxcIlwiIHwgbnVsbCA9IG51bGw7XG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3QgY2hhciBvZiBpbnB1dC50cmltKCkpIHtcbiAgICBpZiAoZXNjYXBpbmcpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgICAgIGVzY2FwaW5nID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGVzY2FwaW5nID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgoY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJcXFwiXCIpICYmICFxdW90ZSkge1xuICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IHF1b3RlKSB7XG4gICAgICBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcbiAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQpIHtcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuIiwgImltcG9ydCB7IERlY29yYXRpb24sIHR5cGUgRWRpdG9yVmlldyB9IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgdHlwZSB7IFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIExsdm1Ub2tlbiB7XG4gIGZyb206IG51bWJlcjtcbiAgdG86IG51bWJlcjtcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG59XG5cbmNvbnN0IExMVk1fS0VZV09SRFMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPihbXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29udHJvbFwiLCBbXG4gICAgXCJyZXRcIiwgXCJiclwiLCBcInN3aXRjaFwiLCBcImluZGlyZWN0YnJcIiwgXCJpbnZva2VcIiwgXCJjYWxsYnJcIiwgXCJyZXN1bWVcIiwgXCJ1bnJlYWNoYWJsZVwiLCBcImNsZWFudXByZXRcIiwgXCJjYXRjaHJldFwiLCBcImNhdGNoc3dpdGNoXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWRlY2xhcmF0aW9uXCIsIFtcbiAgICBcImRlZmluZVwiLCBcImRlY2xhcmVcIiwgXCJ0eXBlXCIsIFwiZ2xvYmFsXCIsIFwiY29uc3RhbnRcIiwgXCJhbGlhc1wiLCBcImlmdW5jXCIsIFwiY29tZGF0XCIsIFwiYXR0cmlidXRlc1wiLCBcInNlY3Rpb25cIiwgXCJnY1wiLCBcInByZWZpeFwiLCBcInByb2xvZ3VlXCIsXG4gICAgXCJwZXJzb25hbGl0eVwiLCBcInVzZWxpc3RvcmRlclwiLCBcInVzZWxpc3RvcmRlcl9iYlwiLCBcIm1vZHVsZVwiLCBcImFzbVwiLCBcInNvdXJjZV9maWxlbmFtZVwiLCBcInRhcmdldFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tZW1vcnlcIiwgW1xuICAgIFwiYWxsb2NhXCIsIFwibG9hZFwiLCBcInN0b3JlXCIsIFwiZ2V0ZWxlbWVudHB0clwiLCBcImZlbmNlXCIsIFwiY21weGNoZ1wiLCBcImF0b21pY3Jtd1wiLCBcImV4dHJhY3R2YWx1ZVwiLCBcImluc2VydHZhbHVlXCIsIFwiZXh0cmFjdGVsZW1lbnRcIixcbiAgICBcImluc2VydGVsZW1lbnRcIiwgXCJzaHVmZmxldmVjdG9yXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWFyaXRobWV0aWNcIiwgW1xuICAgIFwiYWRkXCIsIFwic3ViXCIsIFwibXVsXCIsIFwidWRpdlwiLCBcInNkaXZcIiwgXCJ1cmVtXCIsIFwic3JlbVwiLCBcInNobFwiLCBcImxzaHJcIiwgXCJhc2hyXCIsIFwiYW5kXCIsIFwib3JcIiwgXCJ4b3JcIiwgXCJmbmVnXCIsIFwiZmFkZFwiLCBcImZzdWJcIiwgXCJmbXVsXCIsXG4gICAgXCJmZGl2XCIsIFwiZnJlbVwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb21wYXJpc29uXCIsIFtcImljbXBcIiwgXCJmY21wXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jYXN0XCIsIFtcbiAgICBcInRydW5jXCIsIFwiemV4dFwiLCBcInNleHRcIiwgXCJmcHRydW5jXCIsIFwiZnBleHRcIiwgXCJmcHRvdWlcIiwgXCJmcHRvc2lcIiwgXCJ1aXRvZnBcIiwgXCJzaXRvZnBcIiwgXCJwdHJ0b2ludFwiLCBcImludHRvcHRyXCIsIFwiYml0Y2FzdFwiLCBcImFkZHJzcGFjZWNhc3RcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtb3RoZXJcIiwgW1wicGhpXCIsIFwic2VsZWN0XCIsIFwiZnJlZXplXCIsIFwiY2FsbFwiLCBcImxhbmRpbmdwYWRcIiwgXCJjYXRjaHBhZFwiLCBcImNsZWFudXBwYWRcIiwgXCJ2YV9hcmdcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1vZGlmaWVyXCIsIFtcbiAgICBcInByaXZhdGVcIiwgXCJpbnRlcm5hbFwiLCBcImF2YWlsYWJsZV9leHRlcm5hbGx5XCIsIFwibGlua29uY2VcIiwgXCJ3ZWFrXCIsIFwiY29tbW9uXCIsIFwiYXBwZW5kaW5nXCIsIFwiZXh0ZXJuX3dlYWtcIiwgXCJsaW5rb25jZV9vZHJcIiwgXCJ3ZWFrX29kclwiLFxuICAgIFwiZXh0ZXJuYWxcIiwgXCJkZWZhdWx0XCIsIFwiaGlkZGVuXCIsIFwicHJvdGVjdGVkXCIsIFwiZGxsaW1wb3J0XCIsIFwiZGxsZXhwb3J0XCIsIFwiZHNvX2xvY2FsXCIsIFwiZHNvX3ByZWVtcHRhYmxlXCIsIFwiZXh0ZXJuYWxseV9pbml0aWFsaXplZFwiLFxuICAgIFwidGhyZWFkX2xvY2FsXCIsIFwibG9jYWxkeW5hbWljXCIsIFwiaW5pdGlhbGV4ZWNcIiwgXCJsb2NhbGV4ZWNcIiwgXCJ1bm5hbWVkX2FkZHJcIiwgXCJsb2NhbF91bm5hbWVkX2FkZHJcIiwgXCJhdG9taWNcIiwgXCJ1bm9yZGVyZWRcIiwgXCJtb25vdG9uaWNcIixcbiAgICBcImFjcXVpcmVcIiwgXCJyZWxlYXNlXCIsIFwiYWNxX3JlbFwiLCBcInNlcV9jc3RcIiwgXCJzeW5jc2NvcGVcIiwgXCJ2b2xhdGlsZVwiLCBcInNpbmdsZXRocmVhZFwiLCBcImNjY1wiLCBcImZhc3RjY1wiLCBcImNvbGRjY1wiLCBcIndlYmtpdF9qc2NjXCIsXG4gICAgXCJhbnlyZWdjY1wiLCBcInByZXNlcnZlX21vc3RjY1wiLCBcInByZXNlcnZlX2FsbGNjXCIsIFwiY3h4X2Zhc3RfdGxzY2NcIiwgXCJzd2lmdGNjXCIsIFwidGFpbGNjXCIsIFwiY2ZndWFyZF9jaGVja2NjXCIsIFwidGFpbFwiLCBcIm11c3R0YWlsXCIsIFwibm90YWlsXCIsXG4gICAgXCJmYXN0XCIsIFwibm5hblwiLCBcIm5pbmZcIiwgXCJuc3pcIiwgXCJhcmNwXCIsIFwiY29udHJhY3RcIiwgXCJhZm5cIiwgXCJyZWFzc29jXCIsIFwibnV3XCIsIFwibnN3XCIsIFwiZXhhY3RcIiwgXCJpbmJvdW5kc1wiLCBcInRvXCIsIFwieFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tcHJlZGljYXRlXCIsIFtcbiAgICBcImVxXCIsIFwibmVcIiwgXCJ1Z3RcIiwgXCJ1Z2VcIiwgXCJ1bHRcIiwgXCJ1bGVcIiwgXCJzZ3RcIiwgXCJzZ2VcIiwgXCJzbHRcIiwgXCJzbGVcIiwgXCJvZXFcIiwgXCJvZ3RcIiwgXCJvZ2VcIiwgXCJvbHRcIiwgXCJvbGVcIiwgXCJvbmVcIiwgXCJvcmRcIiwgXCJ1ZXFcIiwgXCJ1bmVcIixcbiAgICBcInVub1wiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tYXR0cmlidXRlXCIsIFtcbiAgICBcImFsd2F5c2lubGluZVwiLCBcImFyZ21lbW9ubHlcIiwgXCJidWlsdGluXCIsIFwiYnlyZWZcIiwgXCJieXZhbFwiLCBcImNvbGRcIiwgXCJjb252ZXJnZW50XCIsIFwiZGVyZWZlcmVuY2VhYmxlXCIsIFwiZGVyZWZlcmVuY2VhYmxlX29yX251bGxcIiwgXCJkaXN0aW5jdFwiLFxuICAgIFwiaW1tYXJnXCIsIFwiaW5hbGxvY2FcIiwgXCJpbnJlZ1wiLCBcIm11c3Rwcm9ncmVzc1wiLCBcIm5lc3RcIiwgXCJub2FsaWFzXCIsIFwibm9jYWxsYmFja1wiLCBcIm5vY2FwdHVyZVwiLCBcIm5vZnJlZVwiLCBcIm5vaW5saW5lXCIsIFwibm9ubGF6eWJpbmRcIixcbiAgICBcIm5vbm51bGxcIiwgXCJub3JlY3Vyc2VcIiwgXCJub3JlZHpvbmVcIiwgXCJub3JldHVyblwiLCBcIm5vc3luY1wiLCBcIm5vdW53aW5kXCIsIFwibnVsbF9wb2ludGVyX2lzX3ZhbGlkXCIsIFwib3BhcXVlXCIsIFwib3B0bm9uZVwiLCBcIm9wdHNpemVcIixcbiAgICBcInByZWFsbG9jYXRlZFwiLCBcInJlYWRub25lXCIsIFwicmVhZG9ubHlcIiwgXCJyZXR1cm5lZFwiLCBcInJldHVybnNfdHdpY2VcIiwgXCJzYW5pdGl6ZV9hZGRyZXNzXCIsIFwic2FuaXRpemVfaHdhZGRyZXNzXCIsIFwic2FuaXRpemVfbWVtb3J5XCIsXG4gICAgXCJzYW5pdGl6ZV90aHJlYWRcIiwgXCJzaWduZXh0XCIsIFwic3BlY3VsYXRhYmxlXCIsIFwic3JldFwiLCBcInNzcFwiLCBcInNzcHJlcVwiLCBcInNzcHN0cm9uZ1wiLCBcInN3aWZ0YXN5bmNcIiwgXCJzd2lmdHNlbGZcIiwgXCJzd2lmdGVycm9yXCIsIFwidXd0YWJsZVwiLFxuICAgIFwid2lsbHJldHVyblwiLCBcIndyaXRlb25seVwiLCBcInplcm9leHRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWNvbnN0YW50XCIsIFtcInRydWVcIiwgXCJmYWxzZVwiLCBcIm51bGxcIiwgXCJub25lXCIsIFwidW5kZWZcIiwgXCJwb2lzb25cIiwgXCJ6ZXJvaW5pdGlhbGl6ZXJcIl0pLFxuXSk7XG5cbmNvbnN0IExMVk1fUFJJTUlUSVZFX1RZUEVTID0gbmV3IFNldChbXG4gIFwidm9pZFwiLCBcImxhYmVsXCIsIFwidG9rZW5cIiwgXCJtZXRhZGF0YVwiLCBcIng4Nl9tbXhcIiwgXCJ4ODZfYW14XCIsIFwiaGFsZlwiLCBcImJmbG9hdFwiLCBcImZsb2F0XCIsIFwiZG91YmxlXCIsIFwiZnAxMjhcIiwgXCJ4ODZfZnA4MFwiLCBcInBwY19mcDEyOFwiLCBcInB0clwiLFxuXSk7XG5cbmNvbnN0IFBVTkNUVUFUSU9OX0NMQVNTID0gXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodExsdm1FbGVtZW50KGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCwgc291cmNlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29kZUVsZW1lbnQuZW1wdHkoKTtcbiAgY29kZUVsZW1lbnQuYWRkQ2xhc3MoXCJsb29tLWxsdm0tY29kZVwiKTtcblxuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgbGluZXMuZm9yRWFjaCgobGluZSwgaW5kZXgpID0+IHtcbiAgICBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29kZUVsZW1lbnQsIGxpbmUpO1xuICAgIGlmIChpbmRleCA8IGxpbmVzLmxlbmd0aCAtIDEpIHtcbiAgICAgIGNvZGVFbGVtZW50LmFwcGVuZFRleHQoXCJcXG5cIik7XG4gICAgfVxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExsdm1EZWNvcmF0aW9ucyhcbiAgYnVpbGRlcjogUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+LFxuICB2aWV3OiBFZGl0b3JWaWV3LFxuICBibG9jazogbG9vbUNvZGVCbG9jayxcbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50TGluZUNvdW50ID0gZ2V0Q29udGVudExpbmVDb3VudChibG9jayk7XG4gIGlmICghY29udGVudExpbmVDb3VudCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbnRlbnRMaW5lQ291bnQ7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdID8/IFwiXCI7XG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVMbHZtTGluZShsaW5lKTtcbiAgICBpZiAoIXRva2Vucy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGRvY0xpbmUgPSB2aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDIgKyBpbmRleCk7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICAgIGlmICh0b2tlbi5mcm9tID09PSB0b2tlbi50bykge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi5mcm9tLFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi50byxcbiAgICAgICAgRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IHRva2VuLmNsYXNzTmFtZSB9KSxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsaW5lOiBzdHJpbmcpOiB2b2lkIHtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpKSB7XG4gICAgaWYgKHRva2VuLmZyb20gPiBjdXJzb3IpIHtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yLCB0b2tlbi5mcm9tKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3BhbiA9IGNvbnRhaW5lci5jcmVhdGVTcGFuKHsgY2xzOiB0b2tlbi5jbGFzc05hbWUgfSk7XG4gICAgc3Bhbi5zZXRUZXh0KGxpbmUuc2xpY2UodG9rZW4uZnJvbSwgdG9rZW4udG8pKTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIGlmIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9rZW5pemVMbHZtTGluZShsaW5lOiBzdHJpbmcpOiBMbHZtVG9rZW5bXSB7XG4gIGNvbnN0IHRva2VuczogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGluZGV4ID0gMDtcblxuICBhZGRMYWJlbFRva2VuKGxpbmUsIHRva2Vucyk7XG5cbiAgd2hpbGUgKGluZGV4IDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb25zdCBjdXJyZW50ID0gbGluZVtpbmRleF07XG4gICAgaWYgKGN1cnJlbnQgPT09IFwiO1wiKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogbGluZS5sZW5ndGgsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tY29tbWVudFwiIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY3VycmVudCkpIHtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdHJpbmdUb2tlbiA9IHJlYWRTdHJpbmdUb2tlbihsaW5lLCBpbmRleCk7XG4gICAgaWYgKHN0cmluZ1Rva2VuKSB7XG4gICAgICBpZiAoc3RyaW5nVG9rZW4ucHJlZml4RW5kID4gaW5kZXgpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHN0cmluZ1Rva2VuLnByZWZpeEVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmctcHJlZml4XCIgfSk7XG4gICAgICB9XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IHN0cmluZ1Rva2VuLnZhbHVlU3RhcnQsIHRvOiBzdHJpbmdUb2tlbi52YWx1ZUVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmdcIiB9KTtcbiAgICAgIGluZGV4ID0gc3RyaW5nVG9rZW4udmFsdWVFbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaGVkID1cbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BsbHZtXFwuW0EtWmEteiQuXzAtOV0rL3ksIFwibG9vbS1sbHZtLWludHJpbnNpY1wiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxAXFxkK1xcYi95LCBcImxvb20tbGx2bS1nbG9iYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbG9jYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvIVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8IVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbWV0YWRhdGFcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwkW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKi95LCBcImxvb20tbGx2bS1jb21kYXRcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvI1xcZCtcXGIveSwgXCJsb29tLWxsdm0tYXR0cmlidXRlLWdyb3VwXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcYmFkZHJzcGFjZVxccypcXChcXHMqXFxkK1xccypcXCkveSwgXCJsb29tLWxsdm0tdHlwZVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPzB4WzAtOUEtRmEtZl0rXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCt8XFxkKykoPzpbZUVdWy0rXT9cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT9cXGQrXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXC5cXC5cXC4veSwgXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIiwgdG9rZW5zKTtcblxuICAgIGlmIChtYXRjaGVkKSB7XG4gICAgICBpbmRleCA9IG1hdGNoZWQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB3b3JkID0gcmVhZFdvcmQobGluZSwgaW5kZXgpO1xuICAgIGlmICh3b3JkKSB7XG4gICAgICB0b2tlbnMucHVzaCh7XG4gICAgICAgIGZyb206IGluZGV4LFxuICAgICAgICB0bzogd29yZC5lbmQsXG4gICAgICAgIGNsYXNzTmFtZTogY2xhc3NpZnlXb3JkKHdvcmQudmFsdWUpLFxuICAgICAgfSk7XG4gICAgICBpbmRleCA9IHdvcmQuZW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKFwiKClbXXt9PD4sOj0qXCIuaW5jbHVkZXMoY3VycmVudCkpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBpbmRleCArIDEsIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MgfSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVUb2tlbnModG9rZW5zKTtcbn1cblxuZnVuY3Rpb24gYWRkTGFiZWxUb2tlbihsaW5lOiBzdHJpbmcsIHRva2VuczogTGx2bVRva2VuW10pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxccyopKD86KFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8XFxkKyl8KCVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrKSkoOikvKTtcbiAgaWYgKCFtYXRjaCB8fCBtYXRjaC5pbmRleCA9PSBudWxsKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGFiZWxTdGFydCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgY29uc3QgbGFiZWxUZXh0ID0gbWF0Y2hbMl0gPz8gbWF0Y2hbM107XG4gIGlmICghbGFiZWxUZXh0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tbGFiZWxcIixcbiAgfSk7XG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGggKyAxLFxuICAgIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MsXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjbGFzc2lmeVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKC9eaVxcZCskLy50ZXN0KHdvcmQpIHx8IExMVk1fUFJJTUlUSVZFX1RZUEVTLmhhcyh3b3JkKSkge1xuICAgIHJldHVybiBcImxvb20tbGx2bS10eXBlXCI7XG4gIH1cblxuICByZXR1cm4gTExWTV9LRVlXT1JEUy5nZXQod29yZCkgPz8gXCJsb29tLWxsdm0tcGxhaW5cIjtcbn1cblxuZnVuY3Rpb24gcmVhZFdvcmQobGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyB2YWx1ZTogc3RyaW5nOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gL1tBLVphLXpfXVtBLVphLXowLTlfLi1dKi95O1xuICBtYXRjaC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgcmVzdWx0ID0gbWF0Y2guZXhlYyhsaW5lKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdmFsdWU6IHJlc3VsdFswXSxcbiAgICBlbmQ6IG1hdGNoLmxhc3RJbmRleCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVhZFN0cmluZ1Rva2VuKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgcHJlZml4RW5kOiBudW1iZXI7IHZhbHVlU3RhcnQ6IG51bWJlcjsgdmFsdWVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGxldCBjdXJzb3IgPSBpbmRleDtcbiAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJjXCIgJiYgbGluZVtjdXJzb3IgKyAxXSA9PT0gXCJcXFwiXCIpIHtcbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIGlmIChsaW5lW2N1cnNvcl0gIT09IFwiXFxcIlwiKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB2YWx1ZVN0YXJ0ID0gY3Vyc29yO1xuICBjdXJzb3IgKz0gMTtcbiAgd2hpbGUgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGN1cnNvciArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcIlwiKSB7XG4gICAgICBjdXJzb3IgKz0gMTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJlZml4RW5kOiB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlU3RhcnQsXG4gICAgdmFsdWVFbmQ6IGN1cnNvcixcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hSZWdleFRva2VuKFxuICBsaW5lOiBzdHJpbmcsXG4gIGluZGV4OiBudW1iZXIsXG4gIHJlZ2V4OiBSZWdFeHAsXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxuICB0b2tlbnM6IExsdm1Ub2tlbltdLFxuKTogbnVtYmVyIHwgbnVsbCB7XG4gIHJlZ2V4Lmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMobGluZSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiByZWdleC5sYXN0SW5kZXgsIGNsYXNzTmFtZSB9KTtcbiAgcmV0dXJuIHJlZ2V4Lmxhc3RJbmRleDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVG9rZW5zKHRva2VuczogTGx2bVRva2VuW10pOiBMbHZtVG9rZW5bXSB7XG4gIHRva2Vucy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5mcm9tIC0gcmlnaHQuZnJvbSB8fCBsZWZ0LnRvIC0gcmlnaHQudG8pO1xuICBjb25zdCBub3JtYWxpemVkOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgIGlmICh0b2tlbi50byA8PSBjdXJzb3IpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZyb20gPSBNYXRoLm1heCh0b2tlbi5mcm9tLCBjdXJzb3IpO1xuICAgIG5vcm1hbGl6ZWQucHVzaCh7IC4uLnRva2VuLCBmcm9tIH0pO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG59XG5cbmZ1bmN0aW9uIGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBudW1iZXIge1xuICBpZiAoYmxvY2suZW5kTGluZSA9PT0gYmxvY2suc3RhcnRMaW5lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICBpZiAoYmxvY2suY29udGVudC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gYmxvY2suZW5kTGluZSA+IGJsb2NrLnN0YXJ0TGluZSArIDEgPyAxIDogMDtcbiAgfVxuXG4gIHJldHVybiBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gbWFwV29yZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHdvcmRzOiBzdHJpbmdbXSk6IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHtcbiAgcmV0dXJuIHdvcmRzLm1hcCgod29yZCkgPT4gW3dvcmQsIGNsYXNzTmFtZV0pO1xufVxuIiwgImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG9ydEhhc2goaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShpbnB1dCkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDE2KTtcbn1cbiIsICJpbXBvcnQgeyBzaG9ydEhhc2ggfSBmcm9tIFwiLi91dGlscy9oYXNoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IExBTkdVQUdFX0FMSUFTRVM6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+ID0ge1xuICBweXRob246IFwicHl0aG9uXCIsXG4gIHB5OiBcInB5dGhvblwiLFxuICBqYXZhc2NyaXB0OiBcImphdmFzY3JpcHRcIixcbiAganM6IFwiamF2YXNjcmlwdFwiLFxuICB0eXBlc2NyaXB0OiBcInR5cGVzY3JpcHRcIixcbiAgdHM6IFwidHlwZXNjcmlwdFwiLFxuICBvY2FtbDogXCJvY2FtbFwiLFxuICBtbDogXCJvY2FtbFwiLFxuICBjOiBcImNcIixcbiAgaDogXCJjXCIsXG4gIGNwcDogXCJjcHBcIixcbiAgY3h4OiBcImNwcFwiLFxuICBjYzogXCJjcHBcIixcbiAgXCJjKytcIjogXCJjcHBcIixcbiAgc2hlbGw6IFwic2hlbGxcIixcbiAgc2g6IFwic2hlbGxcIixcbiAgYmFzaDogXCJzaGVsbFwiLFxuICB6c2g6IFwic2hlbGxcIixcbiAgcnVieTogXCJydWJ5XCIsXG4gIHJiOiBcInJ1YnlcIixcbiAgcGVybDogXCJwZXJsXCIsXG4gIHBsOiBcInBlcmxcIixcbiAgbHVhOiBcImx1YVwiLFxuICBwaHA6IFwicGhwXCIsXG4gIGdvOiBcImdvXCIsXG4gIGdvbGFuZzogXCJnb1wiLFxuICBydXN0OiBcInJ1c3RcIixcbiAgcnM6IFwicnVzdFwiLFxuICBoYXNrZWxsOiBcImhhc2tlbGxcIixcbiAgaHM6IFwiaGFza2VsbFwiLFxuICBqYXZhOiBcImphdmFcIixcbiAgbGx2bTogXCJsbHZtLWlyXCIsXG4gIGxsdm1pcjogXCJsbHZtLWlyXCIsXG4gIFwibGx2bS1pclwiOiBcImxsdm0taXJcIixcbiAgbGw6IFwibGx2bS1pclwiLFxuICBsZWFuOiBcImxlYW5cIixcbiAgbGVhbjQ6IFwibGVhblwiLFxuICBjb3E6IFwiY29xXCIsXG4gIHY6IFwiY29xXCIsXG4gIHNtdDogXCJzbXRsaWJcIixcbiAgc210MjogXCJzbXRsaWJcIixcbiAgc210bGliOiBcInNtdGxpYlwiLFxuICBcInNtdC1saWJcIjogXCJzbXRsaWJcIixcbiAgejM6IFwic210bGliXCIsXG59O1xuXG5jb25zdCBPVVRQVVRfU1RBUlQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6c3RhcnRcXHMraWQ9KFthLWYwLTldKylcXHMqLS0+JC9pO1xuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xuY29uc3QgRkVOQ0VfU1RBUlQgPSAvXihgYGArfH5+fispXFxzKihbXlxcc2BdKik/LiokLztcblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlKHJhd0xhbmd1YWdlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSB8IG51bGwge1xuICBjb25zdCBub3JtYWxpemVkID0gcmF3TGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG5cbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XG4gICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYWxpYXNlcyA9IHBhcnNlQWxpYXNMaXN0KGxhbmd1YWdlLmFsaWFzZXMpO1xuICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XG4gICAgICByZXR1cm4gbGFuZ3VhZ2UubmFtZS50cmltKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIExBTkdVQUdFX0FMSUFTRVNbbm9ybWFsaXplZF0gPz8gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyhzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFtcbiAgICAuLi5PYmplY3Qua2V5cyhMQU5HVUFHRV9BTElBU0VTKSxcbiAgICAuLi4oc2V0dGluZ3M/LmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkuZmxhdE1hcCgobGFuZ3VhZ2UpID0+IFtsYW5ndWFnZS5uYW1lLCAuLi5wYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKV0pLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGg6IHN0cmluZywgc291cmNlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvZGVCbG9ja1tdIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgYmxvY2tzOiBsb29tQ29kZUJsb2NrW10gPSBbXTtcbiAgbGV0IG9yZGluYWwgPSAwO1xuICBsZXQgaW5zaWRlTWFuYWdlZE91dHB1dCA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaV07XG5cbiAgICBpZiAoaW5zaWRlTWFuYWdlZE91dHB1dCkge1xuICAgICAgaWYgKE9VVFBVVF9FTkQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgICAgaW5zaWRlTWFuYWdlZE91dHB1dCA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKE9VVFBVVF9TVEFSVC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgaW5zaWRlTWFuYWdlZE91dHB1dCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmZW5jZU1hdGNoID0gbGluZS5tYXRjaChGRU5DRV9TVEFSVCk7XG4gICAgaWYgKCFmZW5jZU1hdGNoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGFydExpbmUgPSBpO1xuICAgIGNvbnN0IGZlbmNlSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSk7XG4gICAgY29uc3QgZmVuY2VUb2tlbiA9IGZlbmNlTWF0Y2hbMV07XG4gICAgY29uc3Qgc291cmNlTGFuZ3VhZ2UgPSAoZmVuY2VNYXRjaFsyXSA/PyBcIlwiKS50cmltKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSBub3JtYWxpemVMYW5ndWFnZShzb3VyY2VMYW5ndWFnZSwgc2V0dGluZ3MpO1xuXG4gICAgbGV0IGVuZExpbmUgPSBpO1xuICAgIGNvbnN0IGNvbnRlbnRMaW5lczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICBjb25zdCBpbm5lckxpbmUgPSBsaW5lc1tqXTtcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSBpbm5lckxpbmUudHJpbSgpO1xuXG4gICAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKGZlbmNlVG9rZW4pICYmIC9eKGBgYCt8fn5+KylcXHMqJC8udGVzdCh0cmltbWVkKSkge1xuICAgICAgICBlbmRMaW5lID0gajtcbiAgICAgICAgaSA9IGo7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb250ZW50TGluZXMucHVzaChzdHJpcEZlbmNlSW5kZW50KGlubmVyTGluZSwgZmVuY2VJbmRlbnQpKTtcbiAgICAgIGVuZExpbmUgPSBqO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIG9yZGluYWwgKz0gMTtcbiAgICBjb25zdCBjb250ZW50ID0gY29udGVudExpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgY29uc3QgY29udGVudEhhc2ggPSBzaG9ydEhhc2goY29udGVudCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQWxpYXNMaXN0KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID09PSBcInRzeFwiID8gXCJUeXBlU2NyaXB0ICh0c3gpXCIgOiBcIlR5cGVTY3JpcHQgKHRzLW5vZGUpXCI7XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke3NldHRpbmdzLnR5cGVzY3JpcHRNb2RlfWAsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnRzXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ3VzdG9tTGFuZ3VhZ2UgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICByZXR1cm4gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gYC4ke25hbWV9YDtcbiAgfVxuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBJbnRlcnByZXRlZFNwZWMge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpID0+IHN0cmluZztcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nW107XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xuICBtaW5pbXVtVGltZW91dE1zPzogbnVtYmVyO1xufVxuXG5jb25zdCBJTlRFUlBSRVRFRF9TUEVDUzogSW50ZXJwcmV0ZWRTcGVjW10gPSBbXG4gIHtcbiAgICBsYW5ndWFnZTogXCJzaGVsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuc2hcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInJ1YnlcIixcbiAgICBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5yYlwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGVybFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBlcmxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBlcmxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBsXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJsdWFcIixcbiAgICBkaXNwbGF5TmFtZTogXCJMdWFcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmx1YUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIubHVhXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwaHBcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQSFBcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBocEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGhwXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJnb1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkdvXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5nb0V4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuZ29cIixcbiAgICBhcmdzOiBbXCJydW5cIiwgXCJ7ZmlsZX1cIl0sXG4gICAgZW52OiB7XG4gICAgICBHT0NBQ0hFOiBcInt0ZW1wRGlyfS9nb2NhY2hlXCIsXG4gICAgfSxcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSGFza2VsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuaHNcIixcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgSW50ZXJwcmV0ZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImludGVycHJldGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJJbnRlcnByZXRlZFwiO1xuICBsYW5ndWFnZXMgPSBJTlRFUlBSRVRFRF9TUEVDUy5tYXAoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UpO1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIHJldHVybiBCb29sZWFuKHNwZWM/LmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgaWYgKCFzcGVjKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9YCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncyA/PyBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBzcGVjLmZpbGVFeHRlbnNpb24sXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzcGVjLm1pbmltdW1UaW1lb3V0TXMgPz8gMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgZW52OiBzcGVjLmVudixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3BlYyhsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IEludGVycHJldGVkU3BlYyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIElOVEVSUFJFVEVEX1NQRUNTLmZpbmQoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UgPT09IGxhbmd1YWdlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBMbHZtUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJsbHZtLWlyXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJMTFZNIElSXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxsdm0taXJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIiAmJiBCb29sZWFuKHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3VsdC50aW1lZE91dCAmJiAhcmVzdWx0LmNhbmNlbGxlZCAmJiByZXN1bHQuZXhpdENvZGUgIT0gbnVsbCAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcbiAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBQcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uIFVuZGVyIGxsaSwgdGhhdCBiZWNvbWVzIHRoZSBwcm9jZXNzIGV4aXQgc3RhdHVzLmA7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxuICAgICAgICAgID8gXCJMTFZNIHByb2dyYW0gZXhpdGVkIHdpdGggY29kZSAwLlwiXG4gICAgICAgICAgOiBgTExWTSBwcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uXFxuVXNlIHN0ZG91dCBpbiB0aGUgSVIgaXRzZWxmIGlmIHlvdSB3YW50IHByaW50YWJsZSBwcm9ncmFtIG91dHB1dC5gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTWFuYWdlZENvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJtYW5hZ2VkLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcInJ1c3RcIiwgXCJqYXZhXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuUnVzdChibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIucnNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkphdmEoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKFwiTWFpbi5qYXZhXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGlmICghc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnNvdXJjZWAsXG4gICAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGVtcERpcixcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCItY3BcIiwgdGVtcERpciwgXCJNYWluXCJdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5hdGl2ZUNvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJuYXRpdmUtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5hdGl2ZSBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJjXCIsIFwiY3BwXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNwcFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgOiBzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBmaWxlRXh0ZW5zaW9uID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCIuY1wiIDogXCIuY3BwXCI7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiQyAoR0NDKVwiIDogXCJDKysgKEcrKylcIjtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoZmlsZUV4dGVuc2lvbiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCBydW5UZW1wRmlsZVByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBPY2FtbFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwib2NhbWxcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XG4gIGxhbmd1YWdlcyA9IFtcIm9jYW1sXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJvY2FtbFwiICYmIEJvb2xlYW4oc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm9jYW1sTW9kZTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIGlmIChtb2RlID09PSBcIm9jYW1sXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAobW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06ZHVuZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiRHVuZSAvIE9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcImV4ZWNcIiwgXCItLVwiLCBcIm9jYW1sXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIubWxcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1jb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiLW9cIiwgYmluYXJ5UGF0aCwgdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1ydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHl0aG9uUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJweXRob25cIjtcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xuICBsYW5ndWFnZXMgPSBbXCJweXRob25cIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIEJvb2xlYW4oc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9vZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHJvb2ZcIjtcbiAgZGlzcGxheU5hbWUgPSBcIlByb29mIGNoZWNrZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGVhblwiLCBcImNvcVwiLCBcInNtdGxpYlwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4ocmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06bGVhbmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiTGVhblwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjb3FgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkNvcVwiLFxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXG4gICAgICAgIGFyZ3M6IFtcIi1xXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnNtdGxpYmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiU01ULUxJQiAoWjMpXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb29mIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBjb25zdCBjb25maWd1cmVkID0gc2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCk7XG4gIGlmIChjb25maWd1cmVkICYmIGNvbmZpZ3VyZWQgIT09IFwiY29xY1wiKSB7XG4gICAgcmV0dXJuIGNvbmZpZ3VyZWQ7XG4gIH1cblxuICBjb25zdCBvcGFtQ29xYyA9IGpvaW4ocHJvY2Vzcy5lbnYuSE9NRSA/PyBcIlwiLCBcIi5vcGFtXCIsIFwiZGVmYXVsdFwiLCBcImJpblwiLCBcImNvcWNcIik7XG4gIHJldHVybiBleGlzdHNTeW5jKG9wYW1Db3FjKSA/IG9wYW1Db3FjIDogY29uZmlndXJlZCB8fCBcImNvcWNcIjtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBydW5uZXJzOiBsb29tUnVubmVyW10pIHt9XG5cbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMucnVubmVycy5maW5kKChydW5uZXIpID0+ICghcnVubmVyLmxhbmd1YWdlcy5sZW5ndGggfHwgcnVubmVyLmxhbmd1YWdlcy5pbmNsdWRlcyhibG9jay5sYW5ndWFnZSkpICYmIHJ1bm5lci5jYW5SdW4oYmxvY2ssIHNldHRpbmdzKSkgPz8gbnVsbDtcbiAgfVxuXG4gIGdldFN1cHBvcnRlZExhbmd1YWdlcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRoaXMucnVubmVycy5mbGF0TWFwKChydW5uZXIpID0+IHJ1bm5lci5sYW5ndWFnZXMpKV07XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcsIG5vcm1hbGl6ZVBhdGggfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIGxvb21QbHVnaW4gZnJvbSBcIi4vbWFpblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBsb29tUGx1Z2luU2V0dGluZ3MgPSB7XG4gIGVuYWJsZUxvY2FsRXhlY3V0aW9uOiBmYWxzZSxcbiAgaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzazogZmFsc2UsXG4gIHByZXNlcnZlU291cmNlTW9kZTogdHJ1ZSxcbiAgZGVmYXVsdFRpbWVvdXRNczogODAwMCxcbiAgd29ya2luZ0RpcmVjdG9yeTogXCJcIixcbiAgcHl0aG9uRXhlY3V0YWJsZTogXCJweXRob24zXCIsXG4gIG5vZGVFeGVjdXRhYmxlOiBcIm5vZGVcIixcbiAgdHlwZXNjcmlwdE1vZGU6IFwidHMtbm9kZVwiLFxuICB0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGU6IFwidHMtbm9kZVwiLFxuICBvY2FtbE1vZGU6IFwib2NhbWxcIixcbiAgb2NhbWxFeGVjdXRhYmxlOiBcIm9jYW1sXCIsXG4gIGNFeGVjdXRhYmxlOiBcImdjY1wiLFxuICBjcHBFeGVjdXRhYmxlOiBcImcrK1wiLFxuICBzaGVsbEV4ZWN1dGFibGU6IFwiYmFzaFwiLFxuICBydWJ5RXhlY3V0YWJsZTogXCJydWJ5XCIsXG4gIHBlcmxFeGVjdXRhYmxlOiBcInBlcmxcIixcbiAgbHVhRXhlY3V0YWJsZTogXCJsdWFcIixcbiAgcGhwRXhlY3V0YWJsZTogXCJwaHBcIixcbiAgZ29FeGVjdXRhYmxlOiBcImdvXCIsXG4gIHJ1c3RFeGVjdXRhYmxlOiBcInJ1c3RjXCIsXG4gIGhhc2tlbGxFeGVjdXRhYmxlOiBcInJ1bmdoY1wiLFxuICBqYXZhQ29tcGlsZXJFeGVjdXRhYmxlOiBcIlwiLFxuICBqYXZhRXhlY3V0YWJsZTogXCJqYXZhXCIsXG4gIGxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGU6IFwibGxpXCIsXG4gIGxlYW5FeGVjdXRhYmxlOiBcImxlYW5cIixcbiAgY29xRXhlY3V0YWJsZTogXCJjb3FjXCIsXG4gIHNtdEV4ZWN1dGFibGU6IFwiejNcIixcbiAgd3JpdGVPdXRwdXRUb05vdGU6IGZhbHNlLFxuICBhdXRvUnVuT25GaWxlT3BlbjogZmFsc2UsXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXG4gIHBkZkV4cG9ydE1vZGU6IFwiYm90aFwiLFxufTtcblxuZXhwb3J0IGNsYXNzIGxvb21TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbikge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwLCBsb29tUGx1Z2luKTtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxvb21cIiB9KTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIlJ1biBzdXBwb3J0ZWQgY29kZSBmZW5jZXMgZGlyZWN0bHkgZnJvbSBub3RlcyB3aGlsZSBwcmVzZXJ2aW5nIG5hdGl2ZSBzeW50YXggaGlnaGxpZ2h0aW5nLlwiIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJHZW5lcmFsU2V0dGluZ3ModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkdlbmVyYWwgU2V0dGluZ3NcIiwgdHJ1ZSkpO1xuICAgIHRoaXMucmVuZGVyQnVpbHRJblJ1bnRpbWVzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJCdWlsdC1pbiBSdW50aW1lc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkN1c3RvbSBMYW5ndWFnZXNcIikpO1xuICAgIHZvaWQgdGhpcy5yZW5kZXJDb250YWluZXJHcm91cHModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkNvbnRhaW5lcml6YXRpb24gR3JvdXBzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU2VjdGlvbihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIHRpdGxlOiBzdHJpbmcsIG9wZW4gPSBmYWxzZSk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvblwiIH0pO1xuICAgIGRldGFpbHMub3BlbiA9IG9wZW47XG4gICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiB0aXRsZSwgY2xzOiBcImxvb20tc2V0dGluZ3Mtc3VtbWFyeVwiIH0pO1xuICAgIHJldHVybiBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb24tYm9keVwiIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJHZW5lcmFsU2V0dGluZ3MoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkVuYWJsZSBsb2NhbCBleGVjdXRpb25cIilcbiAgICAgIC5zZXREZXNjKFwiRGlzYWJsZWQgYnkgZGVmYXVsdC4gbG9vbSBydW5zIGNvZGUgb24geW91ciBsb2NhbCBtYWNoaW5lIGFuZCBkb2VzIG5vdCBwcm92aWRlIHNhbmRib3hpbmcuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHZhbHVlO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIGxvb20gbm90ZXMgaW4gc291cmNlIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiUHJlc2VydmUgcmF3IGZlbmNlZCBjb2RlIGluIHRoZSBlZGl0b3IgaW5zdGVhZCBvZiBsZXR0aW5nIGxpdmUgcHJldmlldyBjb2xsYXBzZSByZXNlYXJjaCBzbmlwcGV0cy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IHRpbWVvdXRcIilcbiAgICAgIC5zZXREZXNjKFwiTWF4aW11bSBleGVjdXRpb24gdGltZSBpbiBtaWxsaXNlY29uZHMgYmVmb3JlIGxvb20gdGVybWluYXRlcyB0aGUgcHJvY2Vzcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiODAwMFwiKS5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zID0gcGFyc2VkO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldvcmtpbmcgZGlyZWN0b3J5XCIpXG4gICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBFbXB0eSB1c2VzIHRoZSBjdXJyZW50IG5vdGUgZm9sZGVyIHdoZW4gcG9zc2libGUsIG90aGVyd2lzZSB0aGUgdmF1bHQgcm9vdC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiVmF1bHQgcm9vdFwiKS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkgPSB2YWx1ZS50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiBcIlwiO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldyaXRlIG91dHB1dCBiYWNrIHRvIG5vdGVcIilcbiAgICAgIC5zZXREZXNjKFwiSW5zZXJ0IG1hbmFnZWQgbG9vbSBvdXRwdXQgc2VjdGlvbnMgYmVuZWF0aCBjb2RlIGJsb2NrcyBpbnN0ZWFkIG9mIGtlZXBpbmcgcmVzdWx0cyBwdXJlbHkgaW4gdGhlIFVJLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBdXRvLXJ1biBvbiBmaWxlIG9wZW5cIilcbiAgICAgIC5zZXREZXNjKFwiUnVuIGFsbCBzdXBwb3J0ZWQgYmxvY2tzIGluIHRoZSBhY3RpdmUgbm90ZSB3aGVuIGl0IG9wZW5zLiBEaXNhYmxlZCBieSBkZWZhdWx0LlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4gPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJQREYgZXhwb3J0IG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHdoYXQgdG8gaW5jbHVkZSB3aGVuIGV4cG9ydGluZyBub3RlcyBjb250YWluaW5nIGxvb20gY29kZSBibG9ja3MgdG8gUERGLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYm90aFwiLCBcIkJvdGggQ29kZSBhbmQgT3V0cHV0XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvZGVcIiwgXCJDb2RlIEJsb2NrIE9ubHlcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib3V0cHV0XCIsIFwiT3V0cHV0IE9ubHlcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgfHwgXCJib3RoXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPSB2YWx1ZSBhcyBcImJvdGhcIiB8IFwiY29kZVwiIHwgXCJvdXRwdXRcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckJ1aWx0SW5SdW50aW1lcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlB5dGhvbiBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIFB5dGhvbi5cIiwgXCJweXRob25FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTm9kZSBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIEphdmFTY3JpcHQgZXhlY3V0aW9uLlwiLCBcIm5vZGVFeGVjdXRhYmxlXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlR5cGVTY3JpcHQgcnVubmVyIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiVXNlIHRzLW5vZGUgb3IgdHN4IGZvciBUeXBlU2NyaXB0IGJsb2Nrcy5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcInRzLW5vZGVcIiwgXCJ0cy1ub2RlXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInRzeFwiLCBcInRzeFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID0gdmFsdWUgYXMgXCJ0cy1ub2RlXCIgfCBcInRzeFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiVHlwZVNjcmlwdCB0cmFuc3BpbGVyIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHRzLW5vZGUgb3IgdHN4LlwiLCBcInR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZVwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJPQ2FtbCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBiZXR3ZWVuIHRoZSBPQ2FtbCB0b3BsZXZlbCwgb2NhbWxjIGNvbXBpbGF0aW9uLCBvciBkdW5lIGV4ZWMuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbFwiLCBcIm9jYW1sXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sY1wiLCBcIm9jYW1sY1wiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkdW5lXCIsIFwiZHVuZVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUgPSB2YWx1ZSBhcyBcIm9jYW1sXCIgfCBcIm9jYW1sY1wiIHwgXCJkdW5lXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJPQ2FtbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBvY2FtbCwgb2NhbWxjLCBvciBkdW5lIGRlcGVuZGluZyBvbiB0aGUgc2VsZWN0ZWQgbW9kZS5cIiwgXCJvY2FtbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQyBibG9ja3MuXCIsIFwiY0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDKysgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDKysgYmxvY2tzLlwiLCBcImNwcEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJTaGVsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTaGVsbCwgQmFzaCwgYW5kIHNoIGJsb2Nrcy5cIiwgXCJzaGVsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdWJ5IGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFJ1YnkgYmxvY2tzLlwiLCBcInJ1YnlFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUGVybCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQZXJsIGJsb2Nrcy5cIiwgXCJwZXJsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkx1YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBMdWEgYmxvY2tzLlwiLCBcImx1YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQSFAgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUEhQIGJsb2Nrcy5cIiwgXCJwaHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiR28gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgR28gYmxvY2tzLlwiLCBcImdvRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlJ1c3QgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBSdXN0IGJsb2Nrcy5cIiwgXCJydXN0RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkhhc2tlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgSGFza2VsbCBibG9ja3MuIERlZmF1bHRzIHRvIHJ1bmdoYy5cIiwgXCJoYXNrZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgY29tcGlsZXJcIiwgXCJPcHRpb25hbCBjb21tYW5kIG9yIHBhdGggZm9yIGphdmFjLiBMZWF2ZSBlbXB0eSB0byB1c2UgSmF2YSBzb3VyY2UtZmlsZSBtb2RlLlwiLCBcImphdmFDb21waWxlckV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgY29tcGlsZWQgSmF2YSBibG9ja3MuXCIsIFwiamF2YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMTFZNIElSIGludGVycHJldGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIExMVk0gSVIgYmxvY2tzIHdpdGggbGxpLlwiLCBcImxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMZWFuIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIExlYW4gYmxvY2tzLlwiLCBcImxlYW5FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQ29xIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIENvcSBibG9ja3Mgd2l0aCBjb3FjLlwiLCBcImNvcUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJTTVQgc29sdmVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTTVQtTElCIGJsb2Nrcy4gRGVmYXVsdHMgdG8gejMuXCIsIFwic210RXhlY3V0YWJsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1saXN0XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QobGlzdEVsKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBZGQgY3VzdG9tIGxhbmd1YWdlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBsb2NhbCBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBcImN1c3RvbS1sYW5ndWFnZVwiLFxuICAgICAgICAgICAgYWxpYXNlczogXCJcIixcbiAgICAgICAgICAgIGV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBhcmdzOiBcIntmaWxlfVwiLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi50eHRcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBpZiAoIXRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIGN1c3RvbSBsYW5ndWFnZXMgY29uZmlndXJlZC5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5mb3JFYWNoKChsYW5ndWFnZSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2VcIiB9KTtcbiAgICAgIGRldGFpbHMub3BlbiA9IHRydWU7XG4gICAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGxhbmd1YWdlLm5hbWUgfHwgYEN1c3RvbSBsYW5ndWFnZSAke2luZGV4ICsgMX1gIH0pO1xuICAgICAgY29uc3QgYm9keSA9IGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWJvZHlcIiB9KTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIk5hbWVcIiwgXCJOb3JtYWxpemVkIGxhbmd1YWdlIGlkIHVzZWQgYnkgbG9vbS5cIiwgXCJuYW1lXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFsaWFzZXNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgZmVuY2UgYWxpYXNlcy5cIiwgXCJhbGlhc2VzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4ZWN1dGFibGVcIiwgXCJMb2NhbCBjb21tYW5kIG9yIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aC5cIiwgXCJleGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFyZ3VtZW50c1wiLCBcIlNwYWNlLXNlcGFyYXRlZCBhcmd1bWVudHMuIFVzZSB7ZmlsZX0gZm9yIHRoZSB0ZW1wIHNvdXJjZSBmaWxlLlwiLCBcImFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0ZW5zaW9uXCIsIFwiVGVtcCBzb3VyY2UgZmlsZSBleHRlbnNpb24sIGZvciBleGFtcGxlIC5weS5cIiwgXCJleHRlbnNpb25cIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiRGVsZXRlIGxhbmd1YWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3ZlIHRoaXMgY3VzdG9tIGxhbmd1YWdlLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJEZWxldGVcIikuc2V0V2FybmluZygpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbmRlckNvbnRhaW5lckdyb3Vwcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jb250YWluZXItZ3JvdXAtbGlzdFwiIH0pO1xuICAgIGxpc3RFbC5zZXRUZXh0KFwiU2Nhbm5pbmcgY29udGFpbmVyIGdyb3Vwcy4uLlwiKTtcblxuICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMubG9vbVBsdWdpbi5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuXG4gICAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgICBsaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBjb250YWluZXIgZ3JvdXBzIGZvdW5kIGluIC5vYnNpZGlhbi9wbHVnaW5zL2xvb20vY29udGFpbmVycy5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGxpc3RFbClcbiAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcbiAgICAgICAgLnNldERlc2MoZ3JvdXAuc3RhdHVzKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uYnVpbGRDb250YWluZXJHcm91cChncm91cC5uYW1lKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFkZFRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tUGx1Z2luU2V0dGluZ3M+KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgbmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IEspOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldIGFzIHN0cmluZykgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21DdXN0b21MYW5ndWFnZT4oXG4gICAgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LFxuICAgIGxhbmd1YWdlOiBsb29tQ3VzdG9tTGFuZ3VhZ2UsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmcsXG4gICAga2V5OiBLLFxuICApOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKGxhbmd1YWdlW2tleV0pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGxhbmd1YWdlW2tleV0gPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShcImxvb20gbG9jYWwgZXhlY3V0aW9uIGlzIGRpc2FibGVkLiBFbmFibGUgaXQgaW4gc2V0dGluZ3Mgb3IgY29uZmlybSB0aGUgZXhlY3V0aW9uIHdhcm5pbmcgZmlyc3QuXCIpO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIkNvcHkgY29kZVwiLCBcImNvcHlcIiwgaGFuZGxlcnMub25Db3B5LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJlbW92ZSBzbmlwcGV0XCIsIFwidHJhc2gtMlwiLCBoYW5kbGVycy5vblJlbW92ZSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XG5cbiAgcmV0dXJuIHRvb2xiYXI7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1dHRvbihsYWJlbDogc3RyaW5nLCBpY29uTmFtZTogc3RyaW5nLCBvbkNsaWNrOiAoKSA9PiB2b2lkLCBzcGlubmluZzogYm9vbGVhbik6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9IGBsb29tLXRvb2xiYXItYnV0dG9uJHtzcGlubmluZyA/IFwiIGlzLXJ1bm5pbmdcIiA6IFwiXCJ9YDtcbiAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XG4gIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBvbkNsaWNrKCk7XG4gIH0pO1xuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xuICByZXR1cm4gYnV0dG9uO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbVN0b3JlZE91dHB1dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICByZXR1cm4gb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpIHx8IG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpID8gXCJ3YXJuaW5nXCIgOiBcInN1Y2Nlc3NcIjtcbiAgfVxuXG4gIHJldHVybiBcImZhaWx1cmVcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtnZXRTdGF0dXNLaW5kKG91dHB1dCl9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn1gO1xuICBwYW5lbC5kYXRhc2V0Lmxvb21CbG9ja0lkID0gb3V0cHV0LmJsb2NrSWQ7XG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQpO1xuICByZXR1cm4gcGFuZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJPdXRwdXRQYW5lbChwYW5lbDogSFRNTEVsZW1lbnQsIG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IHZvaWQge1xuICBjb25zdCBraW5kID0gZ2V0U3RhdHVzS2luZChvdXRwdXQpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XG4gIHBhbmVsLmVtcHR5KCk7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBiYWRnZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYmFkZ2VcIiB9KTtcbiAgc2V0SWNvbihiYWRnZSwga2luZCA9PT0gXCJzdWNjZXNzXCIgPyBcImNoZWNrLWNpcmNsZS0yXCIgOiBraW5kID09PSBcIndhcm5pbmdcIiA/IFwiYWxlcnQtdHJpYW5nbGVcIiA6IFwieC1jaXJjbGVcIik7XG5cbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5ydW5uZXJOYW1lfSBcdTAwQjcgZXhpdCAke291dHB1dC5yZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCk7XG5cbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5kdXJhdGlvbk1zfSBtcyBcdTAwQjcgJHtuZXcgRGF0ZShvdXRwdXQucmVzdWx0LmZpbmlzaGVkQXQpLnRvTG9jYWxlVGltZVN0cmluZygpfWApO1xuXG4gIGNvbnN0IGJvZHkgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYm9keVwiIH0pO1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3Rkb3V0XCIsIG91dHB1dC5yZXN1bHQuc3Rkb3V0KTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVycik7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjb25zdCBlbXB0eSA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWVtcHR5XCIgfSk7XG4gICAgZW1wdHkuc2V0VGV4dChcIk5vIG91dHB1dFwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGFiZWw6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xuICBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW0tbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gIHNlY3Rpb24uY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlXCIsIHRleHQ6IGNvbnRlbnQgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSdW5uaW5nUGFuZWwoKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1vdXRwdXQtcGFuZWwgaXMtcnVubmluZ1wiO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3Qgc3Bpbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zcGlubmVyXCIgfSk7XG4gIHNldEljb24oc3Bpbm5lciwgXCJsb2FkZXItY2lyY2xlXCIpO1xuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChcIlJ1bm5pbmdcIik7XG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICByZXR1cm4gcGFuZWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBUU87QUFDUCxtQkFBNkM7QUFDN0MsSUFBQUMsZUFBMkU7QUFDM0UsSUFBQUMsZUFBd0I7OztBQ1h4QixzQkFBNkM7QUFDN0MsZ0JBQTJCO0FBQzNCLElBQUFDLG1CQUErQztBQUMvQyxJQUFBQyxlQUE2RDs7O0FDSDdELHNCQUF1QztBQUN2QyxnQkFBdUI7QUFDdkIsa0JBQXFCO0FBQ3JCLDJCQUFzQjtBQXdCdEIsZUFBc0Isd0JBQ3BCLFVBQ0EsUUFDQSxVQUNZO0FBQ1osUUFBTSxVQUFVLFVBQU0sNkJBQVEsc0JBQUssa0JBQU8sR0FBRyxPQUFPLENBQUM7QUFDckQsUUFB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UUFBUSxPQUFPLFlBQVksR0FBRztBQUFBLE1BQzlCLFlBQVksT0FBTyxVQUFVO0FBQUEsTUFDN0IsYUFBYSxPQUFPLFVBQVU7QUFBQSxNQUM5QixPQUFPLFNBQVM7QUFBQSxFQUFZLE9BQU8sTUFBTSxLQUFLO0FBQUEsTUFDOUMsT0FBTyxVQUFVO0FBQUEsRUFBYSxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQ2pELE9BQU8sU0FBUztBQUFBLEVBQVksT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUNoRCxFQUNHLE9BQU8sT0FBTyxFQUNkLEtBQUssTUFBTTtBQUVkLFdBQU87QUFBQSxNQUNMLDZCQUE2QixPQUFPO0FBQUEsTUFDcEM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsdUJBQXVCLE9BQWlCLFNBQXdEO0FBQ3RHLFVBQU0sY0FBYyw2QkFBNkIsT0FBTztBQUN4RCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sYUFBYTtBQUNuQztBQUFBLE1BQ0Y7QUFFQSxlQUFTLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUM1QyxZQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSw0QkFBNEI7QUFDbEQsaUJBQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDNUI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfdmlldyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X3BhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
