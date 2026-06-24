import { access, mkdir, readFile as fsReadFile, readdir, writeFile } from "fs/promises";
import { constants } from "fs";
import { delimiter } from "path";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { DEFAULT_SETTINGS } from "../src/defaultSettings";
import { normalizeLanguageConfiguration } from "../src/languagePackages";
import { getLanguageCapability } from "../src/languageCapabilities";
import { parseMarkdownCodeBlocks } from "../src/parser";
import { resolveReferencedSource } from "../src/sourceExtract";
import { buildSourceReferenceHarness } from "../src/sourceHarness";
import { PythonRunner } from "../src/runners/python";
import { NodeRunner } from "../src/runners/node";
import { OcamlRunner } from "../src/runners/ocaml";
import { NativeCompiledRunner } from "../src/runners/nativeCompiled";
import { InterpretedRunner } from "../src/runners/interpreted";
import { ManagedCompiledRunner } from "../src/runners/managedCompiled";
import { EbpfRunner } from "../src/runners/ebpf";
import { LlvmRunner } from "../src/runners/llvm";
import { ProofRunner } from "../src/runners/proof";
import { CustomLanguageRunner } from "../src/runners/custom";
import { lotusRunnerRegistry } from "../src/runners/registry";
import { lotusContainerRunner } from "../src/execution/containerRunner";
import type { lotusCodeBlock, lotusPluginSettings, lotusResolvedExecutionContext, lotusRunResult, lotusSourcePreview } from "../src/types";

type SmokeProfile = "minimal" | "systems" | "proofs" | "ebpf" | "full";

interface SmokeBlockResult {
  profile: SmokeProfile;
  note: string;
  ordinal: number;
  language: string;
  status: "passed" | "failed" | "skipped";
  name: string;
  runnerName?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  warning?: string;
  reason?: string;
  sourcePreview?: string;
}

interface NoteFile {
  path: string;
  absolutePath: string;
  source: string;
  frontmatter: Record<string, string>;
}

const argv = readArgs(process.argv.slice(2));
const vaultDir = resolve(requiredArg(argv, "vault"));
const artifactDir = resolve(requiredArg(argv, "artifacts"));
const profile = readProfile(argv.profile ?? "full");
const requirePdf = argv["require-pdf"] === "true";
const requireAll = argv["require-all"] === "true";
const settings = await loadSettings(vaultDir, profile);
const registry = new lotusRunnerRegistry([
  new PythonRunner(),
  new NodeRunner(),
  new OcamlRunner(),
  new NativeCompiledRunner(),
  new InterpretedRunner(),
  new ManagedCompiledRunner(),
  new EbpfRunner(),
  new LlvmRunner(),
  new ProofRunner(),
  new CustomLanguageRunner(),
]);
const containerRunner = new lotusContainerRunner({
  vault: {
    adapter: {
      basePath: vaultDir,
    },
  },
  metadataCache: {
    getFileCache: () => ({ frontmatter: {} }),
  },
} as never, ".obsidian/plugins/lotus");
const notes = await readNotes(vaultDir);
const results: SmokeBlockResult[] = [];

for (const note of notes) {
  const blocks = parseMarkdownCodeBlocks(note.path, note.source, settings);
  for (const block of blocks.filter((block) => shouldRunForProfile(block, profile))) {
    results.push(await runBlock(note, block));
  }
}

await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, "report.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  profile,
  vault: vaultDir,
  results,
  totals: summarize(results),
}, null, 2), "utf8");
await writeFile(join(artifactDir, "report.md"), renderMarkdownReport(results), "utf8");
const htmlPath = join(artifactDir, "report.html");
await writeFile(htmlPath, renderHtmlReport(results), "utf8");
await renderPdfIfPossible(htmlPath, join(artifactDir, "report.pdf"), requirePdf);

const failed = results.filter((result) => result.status === "failed");
const skipped = results.filter((result) => result.status === "skipped");
console.log(`Smoke profile ${profile}: ${results.length} blocks, passed: ${results.length - failed.length - skipped.length}, skipped: ${skipped.length}, failed: ${failed.length}`);

if (failed.length) {
  for (const failure of failed) {
    console.error(`${failure.note}#${failure.ordinal} ${failure.language}: ${failure.reason ?? "failed"}`);
  }
  process.exitCode = 1;
}
if (requireAll && skipped.length) {
  for (const skip of skipped) {
    console.error(`${skip.note}#${skip.ordinal} ${skip.language}: skipped under --require-all (${skip.reason ?? "skipped"})`);
  }
  process.exitCode = 1;
}

async function runBlock(note: NoteFile, block: lotusCodeBlock): Promise<SmokeBlockResult> {
  const directives = readSmokeDirectives(block);
  const name = block.attributes["lotus-smoke-name"] || `${note.path}#${block.ordinal}`;
  if (directives.has("skip")) {
    return { profile, note: note.path, ordinal: block.ordinal, language: block.language, status: "skipped", name, reason: "marked skip" };
  }

  const context = resolveCliExecutionContext(note, block, settings);
  const controller = new AbortController();
  let sourcePreview: lotusSourcePreview | undefined;
  let executableBlock = block;
  try {
    const resolved = await resolveExecutableBlock(note, block);
    executableBlock = resolved.block;
    sourcePreview = resolved.sourcePreview;
  } catch (error) {
    return {
      profile,
      note: note.path,
      ordinal: block.ordinal,
      language: block.language,
      status: "failed",
      name,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const runContext = {
    file: { path: note.path } as never,
    workingDirectory: context.workingDirectory,
    timeoutMs: context.timeoutMs,
    signal: controller.signal,
    stdin: await resolveBlockStdin(note, block),
  };

  if (context.containerGroup) {
    const result = await containerRunner.run(executableBlock, runContext, settings, context.containerGroup);
    if (sourcePreview) {
      const sourceNotice = `Ran extracted source from ${sourcePreview.description}.`;
      result.warning = result.warning ? `${sourceNotice}\n${result.warning}` : sourceNotice;
    }
    return classifyResult(note, executableBlock, name, directives, `Execution group ${context.containerGroup}`, result, sourcePreview);
  }

  const runner = registry.getRunnerForBlock(executableBlock, settings);
  if (!runner) {
    return {
      profile,
      note: note.path,
      ordinal: block.ordinal,
      language: block.language,
      status: directives.has("skip-missing") ? "skipped" : "failed",
      name,
      reason: "no configured runner",
    };
  }

  const result = await runner.run(executableBlock, runContext, settings);

  if (sourcePreview) {
    const sourceNotice = `Ran extracted source from ${sourcePreview.description}.`;
    result.warning = result.warning ? `${sourceNotice}\n${result.warning}` : sourceNotice;
  }

  return classifyResult(note, executableBlock, name, directives, runner.displayName, result, sourcePreview);
}

function classifyResult(
  note: NoteFile,
  block: lotusCodeBlock,
  name: string,
  directives: Set<string>,
  runnerName: string,
  result: lotusRunResult,
  sourcePreview: lotusSourcePreview | undefined,
): SmokeBlockResult {
  const base = {
    profile,
    note: note.path,
    ordinal: block.ordinal,
    language: block.language,
    name,
    runnerName,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    warning: result.warning,
    sourcePreview: sourcePreview?.content,
  };

  if (directives.has("skip-missing") && isMissingExecutable(result)) {
    return { ...base, status: "skipped", reason: result.stderr.trim() };
  }

  if (directives.has("expect-fail")) {
    return result.success
      ? { ...base, status: "failed", reason: "expected failure but block succeeded" }
      : { ...base, status: "passed" };
  }

  if (!result.success) {
    return { ...base, status: "failed", reason: result.stderr || result.stdout || `exit ${result.exitCode}` };
  }

  const assertionFailure = checkAssertions(block, result);
  if (assertionFailure) {
    return { ...base, status: "failed", reason: assertionFailure };
  }

  return { ...base, status: "passed" };
}

function checkAssertions(block: lotusCodeBlock, result: lotusRunResult): string | null {
  const exactStdout = block.attributes["lotus-smoke-stdout"];
  if (exactStdout != null && result.stdout.trim() !== exactStdout) {
    return `stdout mismatch: expected ${JSON.stringify(exactStdout)}, got ${JSON.stringify(result.stdout.trim())}`;
  }
  const stdoutContains = block.attributes["lotus-smoke-stdout-contains"];
  if (stdoutContains != null && !result.stdout.includes(stdoutContains)) {
    return `stdout did not contain ${JSON.stringify(stdoutContains)}`;
  }
  const stderrContains = block.attributes["lotus-smoke-stderr-contains"];
  if (stderrContains != null && !result.stderr.includes(stderrContains)) {
    return `stderr did not contain ${JSON.stringify(stderrContains)}`;
  }
  return null;
}

async function resolveExecutableBlock(note: NoteFile, block: lotusCodeBlock): Promise<{ block: lotusCodeBlock; sourcePreview?: lotusSourcePreview }> {
  if (!block.sourceReference) {
    return { block };
  }

  const referencePath = resolveReferencedVaultPath(note.path, block.sourceReference.filePath);
  const source = await readVaultText(referencePath);
  if (source == null) {
    throw new Error(`Referenced source file not found: ${referencePath}`);
  }

  const resolved = await resolveReferencedSource(
    source,
    { ...block.sourceReference, filePath: referencePath },
    block.language,
    buildSourceReferenceHarness(block),
    {
      pythonExecutable: settings.pythonExecutable.trim() || "python3",
      readFile: readVaultHostFile,
      resolvePythonImport,
    },
  );

  const capability = getLanguageCapability(block.language);
  return {
    block: { ...block, content: resolved.content },
    sourcePreview: {
      description: resolved.description,
      language: block.language,
      content: resolved.content,
      capability,
      expanded: true,
      showCapabilityMetadata: true,
    },
  };
}

async function loadSettings(vaultPath: string): Promise<lotusPluginSettings> {
  const dataPath = join(vaultPath, ".obsidian", "plugins", "lotus", "data.json");
  let saved = {};
  try {
    saved = JSON.parse(await fsReadFile(dataPath, "utf8"));
  } catch {
    saved = {};
  }
  const merged = {
    ...DEFAULT_SETTINGS,
    ...saved,
    enableLocalExecution: true,
    hasAcknowledgedExecutionRisk: true,
    writeOutputToNote: false,
  };
  applySmokeProfile(merged, profile);
  normalizeLanguageConfiguration(merged);
  return merged;
}

function applySmokeProfile(settings: lotusPluginSettings, selectedProfile: SmokeProfile): void {
  const config = smokeProfileConfig(selectedProfile);
  if (!config) {
    return;
  }
  settings.enabledLanguagePacks = config.enabledLanguagePacks;
  settings.enabledLanguages = config.enabledLanguages;
}

function smokeProfileConfig(selectedProfile: SmokeProfile): Pick<lotusPluginSettings, "enabledLanguagePacks" | "enabledLanguages"> | null {
  switch (selectedProfile) {
    case "minimal":
      return {
        enabledLanguagePacks: ["interpreted"],
        enabledLanguages: ["python", "shell"],
      };
    case "systems":
      return {
        enabledLanguagePacks: ["interpreted", "native-compiled"],
        enabledLanguages: ["shell", "c", "cpp"],
      };
    case "proofs":
      return {
        enabledLanguagePacks: ["proofs"],
        enabledLanguages: ["lean", "coq", "smtlib"],
      };
    case "ebpf":
      return {
        enabledLanguagePacks: ["ebpf"],
        enabledLanguages: ["ebpf-c", "bpftrace"],
      };
    case "full":
      return null;
  }
}

function resolveCliExecutionContext(note: NoteFile, block: lotusCodeBlock, pluginSettings: lotusPluginSettings): lotusResolvedExecutionContext {
  const noteContainer = note.frontmatter["lotus-execution"] ?? note.frontmatter["lotus-container"];
  const noteCwd = note.frontmatter["lotus-cwd"] ?? note.frontmatter["lotus-working-directory"];
  const noteTimeout = parsePositiveInteger(note.frontmatter["lotus-timeout"]);
  const blockCwd = block.executionContext.workingDirectory;
  const blockTimeout = block.executionContext.timeoutMs;
  const blockContainer = block.executionContext.disableContainer ? undefined : block.executionContext.containerGroup;
  const globalContainer = pluginSettings.defaultContainerGroup.trim() || undefined;
  const containerGroup = block.executionContext.disableContainer
    ? undefined
    : blockContainer ?? (isDisabledValue(noteContainer) ? undefined : noteContainer) ?? globalContainer;

  const rawWorkingDirectory = blockCwd ?? noteCwd ?? pluginSettings.workingDirectory;
  const workingDirectory = rawWorkingDirectory?.trim()
    ? resolveVaultLocalPath(rawWorkingDirectory.trim(), dirname(note.path))
    : dirname(join(vaultDir, note.path));

  return {
    containerGroup,
    workingDirectory,
    timeoutMs: blockTimeout ?? noteTimeout ?? pluginSettings.defaultTimeoutMs,
    source: {
      container: block.executionContext.disableContainer || blockContainer ? "block" : noteContainer ? "note" : pluginSettings.defaultContainerGroup.trim() ? "global" : "none",
      workingDirectory: blockCwd ? "block" : noteCwd ? "note" : pluginSettings.workingDirectory.trim() ? "global" : "default",
      timeout: blockTimeout ? "block" : noteTimeout ? "note" : "global",
    },
  };
}

async function readNotes(baseDir: string): Promise<NoteFile[]> {
  const files = await listMarkdownFiles(baseDir);
  return Promise.all(files.map(async (absolutePath) => {
    const source = await fsReadFile(absolutePath, "utf8");
    return {
      absolutePath,
      path: toVaultPath(absolutePath),
      source,
      frontmatter: parseFrontmatter(source),
    };
  }));
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".obsidian" || entry.name === ".lotus") {
      continue;
    }
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(absolutePath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function parseFrontmatter(source: string): Record<string, string> {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const data: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      break;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      data[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return data;
}

async function readVaultText(vaultPath: string): Promise<string | null> {
  try {
    return await fsReadFile(join(vaultDir, vaultPath), "utf8");
  } catch {
    return null;
  }
}

async function readVaultHostFile(filePath: string): Promise<string | null> {
  return readVaultText(filePath);
}

async function resolvePythonImport(fromFilePath: string, moduleName: string, level: number): Promise<string | null> {
  const modulePath = moduleName.split(".").map((part) => part.trim()).filter(Boolean).join("/");
  const fromDir = dirname(fromFilePath);
  const baseDirs = level > 0
    ? [ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)]
    : [fromDir === "." ? "" : fromDir, ""];

  for (const baseDir of baseDirs) {
    const prefix = baseDir ? `${baseDir}/` : "";
    const candidates = modulePath
      ? [`${prefix}${modulePath}.py`, `${prefix}${modulePath}/__init__.py`]
      : [`${prefix}__init__.py`];
    for (const candidate of candidates) {
      if (await vaultFileExists(candidate)) {
        return normalizeVaultPath(candidate);
      }
    }
  }
  return null;
}

async function vaultFileExists(vaultPath: string): Promise<boolean> {
  try {
    await access(join(vaultDir, normalizeVaultPath(vaultPath)), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveReferencedVaultPath(notePath: string, referencePath: string): string {
  const trimmed = referencePath.trim();
  if (trimmed.startsWith("/")) {
    return normalizeVaultPath(trimmed.slice(1));
  }
  const baseDir = dirname(notePath);
  return normalizeVaultPath(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
}

async function resolveBlockStdin(note: NoteFile, block: lotusCodeBlock): Promise<string | undefined> {
  const inline = block.attributes["lotus-stdin"] ?? block.attributes.stdin;
  if (inline != null) {
    return decodeEscapedAttribute(inline);
  }

  const stdinFile = block.attributes["lotus-stdin-file"] ?? block.attributes["stdin-file"];
  if (!stdinFile?.trim()) {
    return undefined;
  }

  const stdinPath = resolveReferencedVaultPath(note.path, stdinFile);
  return fsReadFile(join(vaultDir, stdinPath), "utf8");
}

function decodeEscapedAttribute(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function resolveVaultLocalPath(value: string, noteDir: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  return join(vaultDir, normalizeVaultPath(noteDir === "." ? value : `${noteDir}/${value}`));
}

function toVaultPath(absolutePath: string): string {
  return normalizeVaultPath(relative(vaultDir, absolutePath));
}

function normalizeVaultPath(value: string): string {
  return value.split(sep).join("/");
}

function ascendVaultPath(pathValue: string, levels: number): string {
  let current = pathValue;
  for (let index = 0; index < levels; index += 1) {
    const next = dirname(current);
    current = next === "." ? "" : next;
  }
  return current;
}

function readSmokeDirectives(block: lotusCodeBlock): Set<string> {
  return new Set((block.attributes["lotus-smoke"] || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function shouldRunForProfile(block: lotusCodeBlock, selectedProfile: SmokeProfile): boolean {
  if (selectedProfile === "full") {
    return true;
  }
  const profiles = splitAttributeList(block.attributes["lotus-smoke-profiles"]);
  return profiles.includes(selectedProfile);
}

function splitAttributeList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMissingExecutable(result: lotusRunResult): boolean {
  return /Executable not found:/i.test(result.stderr);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isDisabledValue(value: string | undefined): boolean {
  return Boolean(value && ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase()));
}

function summarize(blocks: SmokeBlockResult[]): Record<string, number> {
  return {
    total: blocks.length,
    passed: blocks.filter((block) => block.status === "passed").length,
    failed: blocks.filter((block) => block.status === "failed").length,
    skipped: blocks.filter((block) => block.status === "skipped").length,
  };
}

function renderMarkdownReport(blocks: SmokeBlockResult[]): string {
  const lines = ["# Lotus Smoke Report", "", `Profile: ${profile}`, `Generated: ${new Date().toISOString()}`, "", "| Status | Note | Lang | Name |", "| --- | --- | --- | --- |"];
  for (const block of blocks) {
    lines.push(`| ${block.status} | ${block.note}#${block.ordinal} | ${block.language} | ${block.name} |`);
    if (block.reason) {
      lines.push("", `Reason: ${block.reason}`, "");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderHtmlReport(blocks: SmokeBlockResult[]): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lotus Smoke Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #1f2937; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { border-bottom: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    .passed { color: #166534; }
    .failed { color: #991b1b; }
    .skipped { color: #92400e; }
    pre { background: #f3f4f6; padding: 12px; white-space: pre-wrap; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Lotus Smoke Report</h1>
  <p>Profile: ${escapeHtml(profile)}</p>
  <p>${escapeHtml(new Date().toISOString())}</p>
  <table>
    <thead><tr><th>Status</th><th>Note</th><th>Language</th><th>Name</th><th>Runner</th><th>Duration</th></tr></thead>
    <tbody>
      ${blocks.map((block) => `<tr>
        <td class="${block.status}">${block.status}</td>
        <td>${escapeHtml(block.note)}#${block.ordinal}</td>
        <td>${escapeHtml(block.language)}</td>
        <td>${escapeHtml(block.name)}</td>
        <td>${escapeHtml(block.runnerName ?? "")}</td>
        <td>${block.durationMs ?? ""} ms</td>
      </tr>`).join("\n")}
    </tbody>
  </table>
  ${blocks.map(renderHtmlBlock).join("\n")}
</body>
</html>`;
}

function renderHtmlBlock(block: SmokeBlockResult): string {
  return `<section>
    <h2 class="${block.status}">${escapeHtml(block.status)} ${escapeHtml(block.name)}</h2>
    ${block.reason ? `<p>${escapeHtml(block.reason)}</p>` : ""}
    ${block.warning ? `<h3>Warning</h3><pre>${escapeHtml(block.warning)}</pre>` : ""}
    ${block.stdout ? `<h3>stdout</h3><pre>${escapeHtml(block.stdout)}</pre>` : ""}
    ${block.stderr ? `<h3>stderr</h3><pre>${escapeHtml(block.stderr)}</pre>` : ""}
    ${block.sourcePreview ? `<h3>extracted source</h3><pre>${escapeHtml(block.sourcePreview)}</pre>` : ""}
  </section>`;
}

async function renderPdfIfPossible(htmlPath: string, pdfPath: string, mustRender: boolean): Promise<void> {
  const configuredChrome = process.env.LOTUS_CHROME_PATH?.trim();
  if (configuredChrome) {
    if (await renderPdfWithCommand(configuredChrome, ["--headless", "--disable-gpu", "--no-sandbox", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], pdfPath, mustRender)) {
      return;
    }
    return;
  }

  const chromium = await findExecutable(["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]);
  if (chromium) {
    if (await renderPdfWithCommand(chromium, ["--headless", "--disable-gpu", "--no-sandbox", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], pdfPath, mustRender)) {
      return;
    }
  }

  const wkhtmltopdf = await findExecutable(["wkhtmltopdf"]);
  if (wkhtmltopdf) {
    if (await renderPdfWithCommand(wkhtmltopdf, [htmlPath, pdfPath], pdfPath, mustRender)) {
      return;
    }
  }

  const message = "No PDF renderer found. Install chromium, google chrome, or wkhtmltopdf to emit report.pdf.";
  await writeFile(join(dirname(pdfPath), "pdf-skipped.txt"), message, "utf8");
  if (mustRender) {
    throw new Error(message);
  }
}

async function renderPdfWithCommand(command: string, commandArgs: string[], pdfPath: string, mustRender: boolean): Promise<boolean> {
  const exitCode = await runCommand(command, commandArgs);
  if (exitCode === 0) {
    return true;
  }

  const message = `PDF export failed with ${command}`;
  if (mustRender) {
    throw new Error(message);
  }
  await writeFile(join(dirname(pdfPath), "pdf-skipped.txt"), message, "utf8");
  return false;
}

async function findExecutable(names: string[]): Promise<string | null> {
  for (const name of names) {
    for (const searchPath of (process.env.PATH ?? "").split(delimiter)) {
      const candidate = join(searchPath, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function runCommand(command: string, commandArgs: string[]): Promise<number> {
  const child = spawn(command, commandArgs, { stdio: "ignore", shell: command === "command" });
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
}

function readArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = value.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? (values[index + 1]?.startsWith("--") ? "true" : values[++index] ?? "true");
  }
  return parsed;
}

function readProfile(value: string): SmokeProfile {
  if (value === "minimal" || value === "systems" || value === "proofs" || value === "ebpf" || value === "full") {
    return value;
  }
  throw new Error(`Unknown smoke profile ${value}. Use minimal, systems, proofs, ebpf, or full.`);
}

function requiredArg(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
