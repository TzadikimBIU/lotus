import { Notice, type App, type TFile } from "obsidian";
import type { lotusCodeBlock, lotusPluginSettings, lotusRunContext, lotusRunResult, lotusRunner } from "../types";

const OBSIDIAN_CONTEXT_WARNING = "No but seriously, you are risking your life";

type AsyncUserFunction = (...args: unknown[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...args: string[]) => AsyncUserFunction;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;

interface ObsidianContextRunnerHost {
  app: App;
  plugin: unknown;
}

interface ObsidianContextNoteHelper {
  read(): Promise<string>;
  replace(transform: (text: string) => string): Promise<string>;
  replaceBetween(startMarker: string, endMarker: string, replacement: string | ((current: string) => string)): Promise<string>;
  updateJsonBetween(startMarker: string, endMarker: string, updater: (value: unknown) => unknown): Promise<unknown>;
  updateFrontmatter(updater: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  setFrontmatter(key: string, value: unknown): Promise<void>;
}

export class ObsidianContextRunner implements lotusRunner {
  id = "obsidian-js";
  displayName = "Obsidian JavaScript";
  languages = ["obsidian-js"] as const;

  constructor(private readonly host: ObsidianContextRunnerHost) {}

  canRun(block: lotusCodeBlock, _settings: lotusPluginSettings): boolean {
    return block.language === "obsidian-js";
  }

  async run(block: lotusCodeBlock, context: lotusRunContext, _settings: lotusPluginSettings): Promise<lotusRunResult> {
    const startedAt = new Date();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | null = 0;
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let abortHandler: (() => void) | null = null;

    try {
      const userFunction = new AsyncFunction(
        "app",
        "plugin",
        "file",
        "block",
        "Notice",
        "console",
        "note",
        "input",
        `"use strict";\n${block.content}`,
      );
      const capturedConsole = createCapturedConsole(stdout, stderr);
      const note = createNoteHelper(this.host.app, context.file);
      const execution = Promise.resolve(userFunction.call(
        this.host.plugin,
        this.host.app,
        this.host.plugin,
        context.file,
        block,
        Notice,
        capturedConsole,
        note,
        context.stdin ?? "",
      ));

      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Execution timed out after ${context.timeoutMs} ms. Obsidian-context JavaScript cannot be force-killed once started.`));
        }, context.timeoutMs);
      });

      const abort = new Promise<never>((_resolve, reject) => {
        abortHandler = () => {
          cancelled = true;
          reject(new Error("Execution cancelled."));
        };
        if (context.signal.aborted) {
          abortHandler();
        } else {
          context.signal.addEventListener("abort", abortHandler, { once: true });
        }
      });

      const result = await Promise.race([execution, timeout, abort]);
      if (result !== undefined) {
        stdout.push(formatValue(result));
      }
    } catch (error) {
      exitCode = -1;
      stderr.push(formatError(error));
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (abortHandler) {
        context.signal.removeEventListener("abort", abortHandler);
      }
    }

    const finishedAt = new Date();
    const success = !timedOut && !cancelled && exitCode === 0;

    return {
      runnerId: this.id,
      runnerName: this.displayName,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode,
      stdout: joinStream(stdout),
      stderr: joinStream(stderr),
      success,
      timedOut,
      cancelled,
      warning: _settings.showObsidianContextWarning ? OBSIDIAN_CONTEXT_WARNING : undefined,
    };
  }
}

function createNoteHelper(app: App, file: TFile): ObsidianContextNoteHelper {
  return {
    read: () => app.vault.cachedRead(file),
    replace: (transform) => app.vault.process(file, transform),
    replaceBetween: (startMarker, endMarker, replacement) =>
      app.vault.process(file, (text) => replaceMarkedContent(text, startMarker, endMarker, replacement)),
    updateJsonBetween: async (startMarker, endMarker, updater) => {
      let updatedValue: unknown;
      await app.vault.process(file, (text) =>
        replaceMarkedContent(text, startMarker, endMarker, (current) => {
          const parsed = current.trim() ? JSON.parse(current) : {};
          const next = updater(parsed);
          updatedValue = next === undefined ? parsed : next;
          return JSON.stringify(updatedValue, null, 2);
        }),
      );
      return updatedValue;
    },
    updateFrontmatter: (updater) =>
      app.fileManager.processFrontMatter(file, (frontmatter) => {
        updater(frontmatter as Record<string, unknown>);
      }),
    setFrontmatter: (key, value) =>
      app.fileManager.processFrontMatter(file, (frontmatter) => {
        (frontmatter as Record<string, unknown>)[key] = value;
      }),
  };
}

function replaceMarkedContent(
  text: string,
  startMarker: string,
  endMarker: string,
  replacement: string | ((current: string) => string),
): string {
  const startIndex = text.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error(`Start marker not found: ${startMarker}`);
  }
  const startLineEnd = text.indexOf("\n", startIndex);
  const contentStart = startLineEnd < 0 ? startIndex + startMarker.length : startLineEnd + 1;
  const endIndex = text.indexOf(endMarker, contentStart);
  if (endIndex < 0) {
    throw new Error(`End marker not found: ${endMarker}`);
  }

  const currentRaw = text.slice(contentStart, endIndex);
  const keepTrailingNewline = currentRaw.endsWith("\n");
  const current = keepTrailingNewline ? currentRaw.slice(0, -1) : currentRaw;
  const next = typeof replacement === "function" ? replacement(current) : replacement;
  const nextRaw = keepTrailingNewline ? `${next.replace(/\n$/, "")}\n` : next;
  return `${text.slice(0, contentStart)}${nextRaw}${text.slice(endIndex)}`;
}

function createCapturedConsole(stdout: string[], stderr: string[]): Pick<Console, "debug" | "error" | "info" | "log" | "warn"> {
  return {
    debug: (...values: unknown[]) => stdout.push(formatConsoleLine(values)),
    error: (...values: unknown[]) => stderr.push(formatConsoleLine(values)),
    info: (...values: unknown[]) => stdout.push(formatConsoleLine(values)),
    log: (...values: unknown[]) => stdout.push(formatConsoleLine(values)),
    warn: (...values: unknown[]) => stderr.push(formatConsoleLine(values)),
  };
}

function formatConsoleLine(values: unknown[]): string {
  return values.map(formatValue).join(" ");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : formatValue(error);
}

function joinStream(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}
