import { join } from "path";
import { runProcess, withTempSourceFile } from "../execution/processRunner";
import { withMinimumTimeout } from "../utils/timeout";
import type { lotusCodeBlock, lotusNormalizedLanguage, lotusPluginSettings, lotusRunContext, lotusRunResult, lotusRunner } from "../types";

interface NativeCompilerRunnerSpec {
  language: lotusNormalizedLanguage;
  displayName: string;
  fileExtension: string;
  executable: (settings: lotusPluginSettings) => string;
}

export abstract class NativeCompilerRunner implements lotusRunner {
  readonly id: string;
  readonly displayName: string;
  readonly languages: readonly lotusNormalizedLanguage[];

  protected constructor(private readonly spec: NativeCompilerRunnerSpec) {
    this.id = "native-compiled";
    this.displayName = "Native compiler";
    this.languages = [spec.language];
  }

  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean {
    return block.language === this.spec.language && Boolean(this.spec.executable(settings).trim());
  }

  run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings): Promise<lotusRunResult> {
    const compileTimeoutMs = withMinimumTimeout(context.timeoutMs, process.platform === "win32" ? 60_000 : 30_000);
    const runTimeoutMs = withMinimumTimeout(context.timeoutMs, 30_000);

    return withTempSourceFile(this.spec.fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = join(tempDir, process.platform === "win32" ? "snippet.exe" : "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${this.spec.language}:compile`,
        runnerName: this.spec.displayName,
        executable: this.spec.executable(settings).trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: compileTimeoutMs,
        signal: context.signal,
      });
      if (!compileResult.success) return compileResult;

      return runProcess({
        runnerId: `${this.id}:${this.spec.language}:run`,
        runnerName: this.spec.displayName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: runTimeoutMs,
        signal: context.signal,
        stdin: context.stdin,
        stdinSession: context.stdinSession,
        onStdout: context.onStdout,
        onStderr: context.onStderr,
      });
    });
  }
}
