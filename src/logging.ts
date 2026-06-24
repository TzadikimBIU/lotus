import { normalizePath, requestUrl, type App } from "obsidian";
import { spawn, type ChildProcess } from "child_process";
import { dirname } from "path";
import { splitCommandLine } from "./utils/command";
import { sha256Hash } from "./utils/hash";
import type { lotusCodeBlock, lotusPluginSettings, lotusRunResult } from "./types";

export interface lotusLogInput {
  type: string;
  message?: string;
  notePath?: string;
  noteHash?: string;
  block?: lotusCodeBlock;
  target?: lotusLogTarget;
  data?: Record<string, unknown>;
  code?: string;
  stdin?: string;
  stdout?: string;
  stderr?: string;
  warning?: string;
  error?: string;
}

export interface lotusLogTarget {
  runnerId?: string;
  runnerName?: string;
  containerGroup?: string;
  workingDirectory?: string;
  timeoutMs?: number;
  source?: Record<string, unknown>;
}

interface lotusLogEvent {
  version: 1;
  id: string;
  timestamp: string;
  type: string;
  machineHash: string;
  message?: string;
  note?: {
    name?: string;
    nameHash?: string;
    path?: string;
    pathHash?: string;
    contentHash?: string;
  };
  block?: {
    id: string;
    ordinal: number;
    language: string;
    alias: string;
    hash: string;
  };
  target?: lotusLogTarget;
  data?: Record<string, unknown>;
  code?: string;
  stdin?: string;
  stdout?: string;
  stderr?: string;
  warning?: string;
  error?: string;
  truncated?: boolean;
}

export class lotusLogger {
  private processChild: ChildProcess | null = null;
  private processCommand = "";

  constructor(
    private readonly app: App,
    private readonly getSettings: () => lotusPluginSettings,
  ) {}

  async log(input: lotusLogInput): Promise<void> {
    const settings = this.getSettings();
    if (!settings.loggingEnabled) {
      return;
    }

    const event = this.createEvent(input, settings);
    const line = `${this.stringifyEvent(event, settings)}\n`;
    const tasks: Promise<void>[] = [];

    if (settings.loggingGlobalTextEnabled) {
      tasks.push(this.appendVaultText(settings.loggingGlobalTextPath, `${renderTextLogLine(event)}\n`));
    }
    if (settings.loggingGlobalJsonlEnabled) {
      tasks.push(this.appendVaultText(settings.loggingGlobalJsonlPath, line));
    }
    if (input.notePath && settings.loggingPerNoteTextEnabled) {
      tasks.push(this.appendVaultText(this.renderNoteLogPath(settings.loggingPerNoteTextPathPattern, input.notePath), `${renderTextLogLine(event)}\n`));
    }
    if (input.notePath && settings.loggingPerNoteJsonlEnabled) {
      tasks.push(this.appendVaultText(this.renderNoteLogPath(settings.loggingPerNoteJsonlPathPattern, input.notePath), line));
    }
    if (settings.loggingProcessEnabled && settings.loggingProcessCommand.trim()) {
      tasks.push(this.writeProcessSink(settings.loggingProcessCommand, line));
    }
    if (settings.loggingHttpEnabled && settings.loggingHttpEndpoint.trim()) {
      tasks.push(this.writeHttpSink(settings.loggingHttpEndpoint, event, settings.loggingHttpHeaders));
    }

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("lotus logging sink failed", result.reason);
      }
    }
  }

  async logRunFinished(filePath: string, block: lotusCodeBlock, runnerName: string, result: lotusRunResult, data: Record<string, unknown> = {}, target?: lotusLogTarget, noteHash?: string): Promise<void> {
    await this.log({
      type: result.success ? "lotus.run.finished" : "lotus.run.failed",
      message: result.success ? "Code block finished" : "Code block failed",
      notePath: filePath,
      noteHash,
      block,
      target,
      data: {
        ...data,
        runnerId: result.runnerId,
        runnerName,
        success: result.success,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
        warningBytes: result.warning?.length ?? 0,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      warning: result.warning,
    });
  }

  close(): void {
    this.processChild?.stdin?.end();
    this.processChild?.kill();
    this.processChild = null;
    this.processCommand = "";
  }

  private createEvent(input: lotusLogInput, settings: lotusPluginSettings): lotusLogEvent {
    const event: lotusLogEvent = {
      version: 1,
      id: createLogId(),
      timestamp: new Date().toISOString(),
      type: input.type,
      machineHash: sha256Hash(settings.loggingMachineId),
      message: input.message,
      data: input.data,
      error: input.error,
    };

    if (input.notePath) {
      event.note = this.formatNote(input.notePath, settings.loggingNotePathMode, input.noteHash);
    }
    event.target = input.target;
    if (input.block) {
      event.block = {
        id: input.block.id,
        ordinal: input.block.ordinal,
        language: input.block.language,
        alias: input.block.sourceLanguage || input.block.languageAlias,
        hash: sha256Hash(input.block.content),
      };
      if (settings.loggingIncludeCode) {
        event.code = input.code ?? input.block.content;
      }
    } else if (settings.loggingIncludeCode && input.code != null) {
      event.code = input.code;
    }

    if (settings.loggingIncludeInput && input.stdin != null) {
      event.stdin = input.stdin;
    }
    if (settings.loggingIncludeOutput) {
      event.stdout = input.stdout;
      event.stderr = input.stderr;
      event.warning = input.warning;
    }

    return event;
  }

  private stringifyEvent(event: lotusLogEvent, settings: lotusPluginSettings): string {
    let serialized = JSON.stringify(event);
    const maxBytes = normalizeMaxEventBytes(settings.loggingMaxEventBytes);
    if (!maxBytes || encodedLength(serialized) <= maxBytes) {
      return serialized;
    }

    const trimmed: lotusLogEvent = {
      ...event,
      code: undefined,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      warning: undefined,
      truncated: true,
    };
    serialized = JSON.stringify(trimmed);
    if (encodedLength(serialized) <= maxBytes) {
      return serialized;
    }

    return JSON.stringify({
      version: trimmed.version,
      id: trimmed.id,
      timestamp: trimmed.timestamp,
      type: trimmed.type,
      message: trimmed.message,
      machineHash: trimmed.machineHash,
      note: trimmed.note,
      block: trimmed.block,
      target: trimmed.target,
      truncated: true,
    });
  }

  private formatNote(notePath: string, mode: lotusPluginSettings["loggingNotePathMode"], noteHash?: string): lotusLogEvent["note"] {
    const pathHash = sha256Hash(notePath);
    const noteName = notePath.split("/").pop() ?? notePath;
    const nameHash = sha256Hash(noteName);
    if (mode === "omit") {
      return { pathHash, nameHash, contentHash: noteHash };
    }
    if (mode === "plain") {
      return { name: noteName, nameHash, path: notePath, pathHash, contentHash: noteHash };
    }
    return { pathHash, nameHash, contentHash: noteHash };
  }

  private async appendVaultText(rawPath: string, content: string): Promise<void> {
    const path = normalizeVaultLogPath(rawPath);
    if (!path) {
      return;
    }

    await this.ensureVaultParentFolder(path);
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.append(path, content);
    } else {
      await this.app.vault.adapter.write(path, content);
    }
  }

  private async ensureVaultParentFolder(path: string): Promise<void> {
    const folder = dirname(path);
    if (!folder || folder === ".") {
      return;
    }

    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private renderNoteLogPath(pattern: string, notePath: string): string {
    const noteHash = sha256Hash(notePath);
    const noteName = notePath
      .replace(/\.[^/.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "__")
      .replace(/^_+|_+$/g, "")
      .slice(0, 160) || noteHash.slice(0, 16);
    return pattern
      .replaceAll("{note}", noteName)
      .replaceAll("{hash}", noteHash.slice(0, 16));
  }

  private async writeProcessSink(commandLine: string, line: string): Promise<void> {
    const child = this.ensureProcessSink(commandLine);
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      stdin.write(line, (error) => error ? reject(error) : resolve());
    });
  }

  private ensureProcessSink(commandLine: string): ChildProcess | null {
    const command = commandLine.trim();
    if (!command) {
      return null;
    }

    if (this.processChild && this.processCommand === command && !this.processChild.killed) {
      return this.processChild;
    }

    this.close();
    const [executable, ...args] = splitCommandLine(command);
    if (!executable) {
      return null;
    }

    const child = spawn(executable, args, {
      cwd: getVaultBasePath(this.app),
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    });
    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.warn(`lotus logging process stderr: ${message}`);
      }
    });
    child.on("error", (error) => {
      console.warn("lotus logging process failed", error);
    });
    child.on("exit", () => {
      if (this.processChild === child) {
        this.processChild = null;
        this.processCommand = "";
      }
    });

    this.processChild = child;
    this.processCommand = command;
    return child;
  }

  private async writeHttpSink(endpoint: string, event: lotusLogEvent, rawHeaders: string): Promise<void> {
    await requestUrl({
      url: endpoint.trim(),
      method: "POST",
      contentType: "application/json",
      headers: parseHeaderJson(rawHeaders),
      body: JSON.stringify(event),
    });
  }
}

function renderTextLogLine(event: lotusLogEvent): string {
  const note = event.note?.path ? ` note=${event.note.path}` : event.note?.pathHash ? ` noteHash=${event.note.pathHash.slice(0, 16)}` : "";
  const noteContent = event.note?.contentHash ? ` contentHash=${event.note.contentHash.slice(0, 16)}` : "";
  const block = event.block ? ` block=${event.block.ordinal}:${event.block.language}:${event.block.hash.slice(0, 12)}` : "";
  const machine = ` machine=${event.machineHash.slice(0, 16)}`;
  const target = event.target?.containerGroup
    ? ` target=${event.target.containerGroup}`
    : event.target?.runnerName ? ` target=${event.target.runnerName}` : "";
  const message = event.message ? ` ${event.message}` : "";
  const success = typeof event.data?.success === "boolean" ? ` success=${String(event.data.success)}` : "";
  const exit = event.data?.exitCode != null ? ` exit=${String(event.data.exitCode)}` : "";
  const duration = event.data?.durationMs != null ? ` durationMs=${String(event.data.durationMs)}` : "";
  return `${event.timestamp} ${event.type}${machine}${note}${noteContent}${block}${target}${success}${exit}${duration}${message}`;
}

function normalizeVaultLogPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return null;
  }

  const path = normalizePath(trimmed.startsWith("/") ? trimmed.slice(1) : trimmed);
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.includes("..") || path === ".obsidian" || path.startsWith(".obsidian/") || path === ".git" || path.startsWith(".git/")) {
    return null;
  }
  return path;
}

function parseHeaderJson(rawHeaders: string): Record<string, string> {
  const trimmed = rawHeaders.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function normalizeMaxEventBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(1024, Math.floor(value));
}

function encodedLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function createLogId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath;
}
