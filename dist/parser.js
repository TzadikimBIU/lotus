"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLanguage = normalizeLanguage;
exports.getSupportedLanguageAliases = getSupportedLanguageAliases;
exports.parseMarkdownCodeBlocks = parseMarkdownCodeBlocks;
exports.findBlockAtLine = findBlockAtLine;
const hash_1 = require("./utils/hash");
const LANGUAGE_ALIASES = {
    python: "python",
    py: "python",
    javascript: "javascript",
    js: "javascript",
    typescript: "typescript",
    ts: "typescript",
    ocaml: "ocaml",
    ml: "ocaml",
};
const OUTPUT_START = /^<!--\s*lotus:output:start\s+id=([a-f0-9]+)\s*-->$/i;
const OUTPUT_END = /^<!--\s*lotus:output:end\s*-->$/i;
const FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?.*$/;
function normalizeLanguage(rawLanguage) {
    const normalized = rawLanguage.trim().toLowerCase();
    return LANGUAGE_ALIASES[normalized] ?? null;
}
function getSupportedLanguageAliases() {
    return Object.keys(LANGUAGE_ALIASES);
}
function parseMarkdownCodeBlocks(filePath, source) {
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
        const fenceToken = fenceMatch[1];
        const sourceLanguage = (fenceMatch[2] ?? "").trim();
        const language = normalizeLanguage(sourceLanguage);
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
            contentLines.push(innerLine);
            endLine = j;
        }
        if (!language) {
            continue;
        }
        ordinal += 1;
        const content = contentLines.join("\n");
        const contentHash = (0, hash_1.shortHash)(content);
        const id = (0, hash_1.shortHash)(`${filePath}:${ordinal}:${language}:${contentHash}`);
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
            fenceEnd: 0,
        });
    }
    return blocks;
}
function findBlockAtLine(blocks, line) {
    return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}
