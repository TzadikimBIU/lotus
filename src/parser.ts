import { shortHash } from "./utils/hash";
import type { loomCodeBlock, loomNormalizedLanguage, loomPluginSettings, loomSourceReference } from "./types";

const LANGUAGE_ALIASES: Record<string, loomNormalizedLanguage> = {
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
  z3: "smtlib",
};

const OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
const OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
const FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;

export function normalizeLanguage(rawLanguage: string, settings?: loomPluginSettings): loomNormalizedLanguage | null {
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

export function getSupportedLanguageAliases(settings?: loomPluginSettings): string[] {
  return [
    ...Object.keys(LANGUAGE_ALIASES),
    ...(settings?.customLanguages ?? []).flatMap((language) => [language.name, ...parseAliasList(language.aliases)]),
  ].map((alias) => alias.toLowerCase());
}

export function parseMarkdownCodeBlocks(filePath: string, source: string, settings?: loomPluginSettings): loomCodeBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: loomCodeBlock[] = [];
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
    const fenceIndent = getLeadingWhitespace(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const sourceReference = parseSourceReference(fenceMatch[3] ?? "");
    const language = normalizeLanguage(sourceLanguage, settings);

    let endLine = i;
    const contentLines: string[] = [];

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
      fenceEnd: 0,
    });
  }

  return blocks;
}

function parseAliasList(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim().toLowerCase())
    .filter(Boolean);
}

function parseSourceReference(infoTail: string): loomSourceReference | undefined {
  const attrs = parseInfoAttributes(infoTail);
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return undefined;
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
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase()),
  };
}

function parseInfoAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) != null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function parseLineRange(value: string): { start: number; end: number } | null {
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

export function findBlockAtLine(blocks: loomCodeBlock[], line: number): loomCodeBlock | null {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}

function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}

function stripFenceIndent(line: string, fenceIndent: string): string {
  if (!fenceIndent) {
    return line;
  }

  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }

  return line.slice(index);
}
