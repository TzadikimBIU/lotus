import { dirname } from "path";
import { normalizePath, type App, type TFile } from "obsidian";
import type { lotusCodeBlock, lotusExecutionContextOverride, lotusPluginSettings, lotusResolvedExecutionContext } from "./types";

interface NoteExecutionContext {
  containerGroup?: string;
  disableContainer?: boolean;
  workingDirectory?: string;
  timeoutMs?: number;
}

export function resolveExecutionContext(
  app: App,
  file: TFile,
  block: lotusCodeBlock,
  settings: lotusPluginSettings,
): lotusResolvedExecutionContext {
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
      timeout: blockTimeout ? "block" : noteTimeout ? "note" : "global",
    },
  };
}

function resolveContainerGroup(
  globalContainer: string,
  note: NoteExecutionContext,
  block: lotusExecutionContextOverride,
): string | undefined {
  if (block.disableContainer) {
    return undefined;
  }
  if (block.containerGroup?.trim()) {
    return block.containerGroup.trim();
  }
  if (note.disableContainer) {
    return undefined;
  }
  if (note.containerGroup?.trim()) {
    return note.containerGroup.trim();
  }
  return globalContainer.trim() || undefined;
}

function resolveContainerSource(
  globalContainer: string,
  note: NoteExecutionContext,
  block: lotusExecutionContextOverride,
): lotusResolvedExecutionContext["source"]["container"] {
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

function readNoteExecutionContext(app: App, file: TFile): NoteExecutionContext {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) {
    return {};
  }

  const container = frontmatter["lotus-execution"] ?? frontmatter["lotus-container"];
  const workingDirectory = frontmatter["lotus-cwd"] ?? frontmatter["lotus-working-directory"];
  const timeout = frontmatter["lotus-timeout"];

  return {
    containerGroup: typeof container === "string" && !isDisabledValue(container) ? container.trim() : undefined,
    disableContainer: typeof container === "string" ? isDisabledValue(container) : undefined,
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : undefined,
    timeoutMs: typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
      ? Math.trunc(timeout)
      : typeof timeout === "string"
        ? parsePositiveInteger(timeout)
        : undefined,
  };
}

function resolveDefaultWorkingDirectory(file: TFile, settings: lotusPluginSettings): string {
  if (settings.workingDirectory.trim()) {
    return normalizePath(settings.workingDirectory.trim());
  }

  const adapterBasePath = (file.vault.adapter as { basePath?: string }).basePath ?? "";
  const fileFolder = dirname(file.path);
  const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
  return resolved || process.cwd();
}

function normalizeWorkingDirectory(value: string | undefined): string | undefined {
  return value?.trim() ? normalizePath(value.trim()) : undefined;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isDisabledValue(value: string): boolean {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
}
