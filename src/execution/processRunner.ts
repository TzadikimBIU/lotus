import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import type { lotusRunResult, lotusStdinSession } from "../types";

const FORCE_KILL_GRACE_MS = 1_500;

export interface lotusProcessSpec {
  runnerId: string;
  runnerName: string;
  executable: string;
  args: string[];
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
  stdinPrefix?: string | Buffer;
  stdin?: string;
  stdinSession?: lotusStdinSession;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface lotusTempSourceSpec extends lotusProcessSpec {
  fileExtension: string;
  source: string;
}

export interface lotusTempSourceHandle {
  tempDir: string;
  tempFile: string;
}

export async function withNamedTempSourceFile<T>(
  fileName: string,
  source: string,
  callback: (handle: lotusTempSourceHandle) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "lotus-"));
  const tempFile = join(tempDir, fileName);

  try {
    await writeFile(tempFile, normalizeExecutableSource(source), "utf8");
    return await callback({ tempDir, tempFile });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function withTempSourceFile<T>(
  fileExtension: string,
  source: string,
  callback: (handle: lotusTempSourceHandle) => Promise<T>,
): Promise<T> {
  return withNamedTempSourceFile(`snippet${fileExtension}`, source, callback);
}

function normalizeExecutableSource(source: string): string {
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

  return lines
    .map((line) => (line.trim().length === 0 ? line : line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line))
    .join("\n");
}

function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}

function sharedWhitespacePrefix(left: string, right: string): string {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}

export async function runProcess(spec: lotusProcessSpec): Promise<lotusRunResult> {
  const startedAt = new Date();
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let timedOut = false;
  let cancelled = false;
  let child: ReturnType<typeof spawn> | null = null;
  let childExited = false;
  let timeoutHandle: any = null;
  let killHandle: any = null;
  let abortHandler: (() => void) | null = null;
  let detachStdinSession: (() => void) | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      const terminateChild = (signal: NodeJS.Signals) => {
        if (!child || childExited) {
          return;
        }
        child.kill(signal);
        if (!killHandle) {
          killHandle = setTimeout(() => {
            if (child && !childExited) {
              child.kill("SIGKILL");
            }
          }, FORCE_KILL_GRACE_MS);
        }
      };

      child = spawn(spec.executable, spec.args, {
        cwd: spec.workingDirectory,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...spec.env,
        },
      });
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") {
          reject(error);
        }
      });

      const attachStdinSession = () => {
        if (!spec.stdinSession) {
          return;
        }
        detachStdinSession = spec.stdinSession.attachWriter((chunk) => {
          if (!child?.stdin || child.stdin.destroyed || childExited) {
            return;
          }
          if (chunk == null) {
            child.stdin.end();
            return;
          }
          child.stdin.write(chunk);
        });
      };

      if (spec.stdinPrefix != null && spec.stdin != null) {
        child.stdin?.end(combineStdinPrefix(spec.stdinPrefix, spec.stdin));
      } else if (spec.stdinPrefix != null) {
        child.stdin?.write(spec.stdinPrefix, (error?: Error | null) => {
          if (error) {
            if (!("code" in error) || (error as NodeJS.ErrnoException).code !== "EPIPE") {
              reject(error);
            }
            return;
          }
          if (spec.stdinSession) {
            attachStdinSession();
          } else {
            child?.stdin?.end();
          }
        });
      } else if (spec.stdin != null) {
        child.stdin?.end(spec.stdin);
      } else if (spec.stdinSession) {
        attachStdinSession();
      } else {
        child.stdin?.destroy();
      }

      const abort = () => {
        cancelled = true;
        terminateChild("SIGTERM");
      };
      abortHandler = abort;

      if (spec.signal.aborted) {
        abort();
      } else {
        spec.signal.addEventListener("abort", abort, { once: true });
      }

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateChild("SIGTERM");
      }, spec.timeoutMs);

      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        spec.onStdout?.(text);
      });

      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        spec.onStderr?.(text);
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code, signal) => {
        childExited = true;
        if (killHandle) {
          clearTimeout(killHandle);
          killHandle = null;
        }
        exitCode = code;
        exitSignal = signal;
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
    if (detachStdinSession) {
      detachStdinSession();
      detachStdinSession = undefined;
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (killHandle) {
      clearTimeout(killHandle);
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  if (!stderr.trim()) {
    if (timedOut) {
      stderr = `Process timed out after ${spec.timeoutMs} ms.`;
    } else if (cancelled) {
      stderr = "Process was cancelled.";
    } else if (exitCode == null && exitSignal) {
      stderr = `Process exited after signal ${exitSignal}.`;
    } else if (exitCode == null) {
      stderr = "Process exited without an exit code.";
    }
  }
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
    cancelled,
  };
}

function formatProcessError(error: unknown, executable: string): string {
  if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return `Executable not found: ${executable}`;
  }

  return error instanceof Error ? error.message : String(error);
}

function combineStdinPrefix(prefix: string | Buffer, stdin: string): string | Buffer {
  if (Buffer.isBuffer(prefix)) {
    return Buffer.concat([prefix, Buffer.from(stdin)]);
  }

  return `${prefix}${stdin}`;
}

export async function runTempFileProcess(spec: lotusTempSourceSpec): Promise<lotusRunResult> {
  return withTempSourceFile(spec.fileExtension, spec.source, async ({ tempFile, tempDir }) =>
    runProcess({
      runnerId: spec.runnerId,
      runnerName: spec.runnerName,
      executable: spec.executable,
      args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
      workingDirectory: spec.workingDirectory,
      timeoutMs: spec.timeoutMs,
      signal: spec.signal,
      stdin: spec.stdin,
      stdinSession: spec.stdinSession,
      onStdout: spec.onStdout,
      onStderr: spec.onStderr,
      env: expandTemplatedEnv(spec.env, tempFile, tempDir),
    }),
  );
}

function expandTemplatedEnv(env: NodeJS.ProcessEnv | undefined, tempFile: string, tempDir: string): NodeJS.ProcessEnv | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir) : value,
    ]),
  );
}
