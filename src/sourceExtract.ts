import type { loomNormalizedLanguage, loomSourceReference } from "./types";

interface SourceRange {
  start: number;
  end: number;
}

interface SourceDefinition extends SourceRange {
  name: string;
}

export interface loomResolvedSource {
  content: string;
  description: string;
}

export function resolveReferencedSource(
  source: string,
  reference: loomSourceReference,
  language: loomNormalizedLanguage,
  harness: string,
): loomResolvedSource {
  const lines = source.split(/\r?\n/);
  const selectedRange = reference.symbolName
    ? findSymbolRange(lines, language, reference.symbolName)
    : findLineRange(lines, reference);

  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }

  const selected = renderRange(lines, selectedRange);
  const dependencies = reference.traceDependencies
    ? collectDependencySource(lines, language, selectedRange, selected)
    : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""]
    .filter((part) => part.trim())
    .join("\n\n");

  return {
    content,
    description: reference.symbolName
      ? `${reference.filePath}#${reference.symbolName}`
      : `${reference.filePath}:L${selectedRange.start + 1}-L${selectedRange.end + 1}`,
  };
}

function findLineRange(lines: string[], reference: loomSourceReference): SourceRange | null {
  const start = Math.max((reference.lineStart ?? 1) - 1, 0);
  const end = Math.min((reference.lineEnd ?? reference.lineStart ?? lines.length) - 1, lines.length - 1);
  if (start > end || start >= lines.length) {
    return null;
  }
  return { start, end };
}

function findSymbolRange(lines: string[], language: loomNormalizedLanguage, symbolName: string): SourceRange | null {
  const definitions = collectDefinitions(lines, language);
  const exact = definitions.find((definition) => definition.name === symbolName);
  if (exact) {
    return { start: exact.start, end: exact.end };
  }

  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  return line >= 0 ? { start: line, end: line } : null;
}

function collectDependencySource(lines: string[], language: loomNormalizedLanguage, selectedRange: SourceRange, selected: string): string {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language)
    .filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))]
    .filter((part) => part.trim())
    .join("\n\n");
}

function traceDefinitions(seed: string, definitions: SourceDefinition[], lines: string[]): SourceDefinition[] {
  const selected: SourceDefinition[] = [];
  const selectedNames = new Set<string>();
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
      haystack += `\n${renderRange(lines, definition)}\n`;
      changed = true;
    }
  }

  return selected.sort((left, right) => left.start - right.start);
}

function collectPrologue(lines: string[], language: loomNormalizedLanguage, beforeLine: number): string[] {
  const prologue: string[] = [];
  const max = Math.max(beforeLine, 0);
  for (let index = 0; index < max; index += 1) {
    const line = lines[index];
    if (isPrologueLine(line, language)) {
      prologue.push(line);
    }
  }
  return prologue.length ? [prologue.join("\n")] : [];
}

function isPrologueLine(line: string, language: loomNormalizedLanguage): boolean {
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

function collectDefinitions(lines: string[], language: loomNormalizedLanguage): SourceDefinition[] {
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

function collectPythonDefinitions(lines: string[]): SourceDefinition[] {
  const definitions: SourceDefinition[] = [];
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

function collectBraceDefinitions(lines: string[], pattern: RegExp): SourceDefinition[] {
  const definitions: SourceDefinition[] = [];
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

function findBraceRangeEnd(lines: string[], start: number): number {
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

function renderRange(lines: string[], range: SourceRange): string {
  return lines.slice(range.start, range.end + 1).join("\n");
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
