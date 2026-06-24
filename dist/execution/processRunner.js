"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTempSourceFile = withTempSourceFile;
exports.runProcess = runProcess;
exports.runTempFileProcess = runTempFileProcess;
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = require("path");
const child_process_1 = require("child_process");
async function withTempSourceFile(fileExtension, source, callback) {
    const tempDir = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), "lotus-"));
    const tempFile = (0, path_1.join)(tempDir, `snippet${fileExtension}`);
    try {
        await (0, promises_1.writeFile)(tempFile, source, "utf8");
        return await callback({ tempDir, tempFile });
    }
    finally {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    }
}
async function runProcess(spec) {
    const startedAt = new Date();
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
            child = (0, child_process_1.spawn)(spec.executable, spec.args, {
                cwd: spec.workingDirectory,
                shell: false,
                env: {
                    ...process.env,
                    ...spec.env,
                },
            });
            const abort = () => {
                cancelled = true;
                child?.kill("SIGTERM");
            };
            abortHandler = abort;
            if (spec.signal.aborted) {
                abort();
            }
            else {
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
    }
    catch (error) {
        stderr = stderr || (error instanceof Error ? error.message : String(error));
        exitCode = exitCode ?? -1;
    }
    finally {
        if (abortHandler) {
            spec.signal.removeEventListener("abort", abortHandler);
        }
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
    const finishedAt = new Date();
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
        cancelled,
    };
}
async function runTempFileProcess(spec) {
    return withTempSourceFile(spec.fileExtension, spec.source, async ({ tempFile, tempDir }) => runProcess({
        runnerId: spec.runnerId,
        runnerName: spec.runnerName,
        executable: spec.executable,
        args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
        workingDirectory: spec.workingDirectory,
        timeoutMs: spec.timeoutMs,
        signal: spec.signal,
        env: spec.env,
    }));
}
