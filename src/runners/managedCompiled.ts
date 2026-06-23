import { join } from "path";
import { runProcess, withNamedTempSourceFile, withTempSourceFile } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class ManagedCompiledRunner implements loomRunner {
  id = "managed-compiled";
  displayName = "Managed compiler";
  languages = ["rust", "java"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (block.language === "rust") {
      return Boolean(settings.rustExecutable.trim());
    }

    if (block.language === "java") {
      return Boolean(settings.javaExecutable.trim());
    }

    return false;
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    if (block.language === "rust") {
      return this.runRust(block, context, settings);
    }

    if (block.language === "java") {
      return this.runJava(block, context, settings);
    }

    throw new Error(`Unsupported language: ${block.language}`);
  }

  private async runRust(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    return withTempSourceFile(".rs", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = join(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:rust:compile`,
        runnerName: "Rust",
        executable: settings.rustExecutable.trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
        stdin: context.stdin,
      });

      if (!compileResult.success) {
        return compileResult;
      }

      return runProcess({
        runnerId: `${this.id}:rust:run`,
        runnerName: "Rust",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
      });
    });
  }

  private async runJava(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    return withNamedTempSourceFile("Main.java", block.content, async ({ tempDir, tempFile }) => {
      if (!settings.javaCompilerExecutable.trim()) {
        return runProcess({
          runnerId: `${this.id}:java:source`,
          runnerName: "Java",
          executable: settings.javaExecutable.trim(),
          args: [tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 30_000),
          signal: context.signal,
          stdin: context.stdin,
        });
      }

      const compileResult = await runProcess({
        runnerId: `${this.id}:java:compile`,
        runnerName: "Java",
        executable: settings.javaCompilerExecutable.trim(),
        args: [tempFile],
        workingDirectory: tempDir,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
      });

      if (!compileResult.success) {
        return compileResult;
      }

      return runProcess({
        runnerId: `${this.id}:java:run`,
        runnerName: "Java",
        executable: settings.javaExecutable.trim(),
        args: ["-cp", tempDir, "Main"],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
        stdin: context.stdin,
      });
    });
  }
}
