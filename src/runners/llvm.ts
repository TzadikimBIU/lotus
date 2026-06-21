import { runTempFileProcess } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class LlvmRunner implements loomRunner {
  id = "llvm-ir";
  displayName = "LLVM IR";
  languages = ["llvm-ir"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    const result = await runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 30_000),
      signal: context.signal,
    });

    if (!result.timedOut && !result.cancelled && result.exitCode != null && !result.stderr.trim()) {
      if (result.exitCode !== 0) {
        result.success = true;
        result.warning = `Program returned i32 ${result.exitCode}. Under lli, that becomes the process exit status.`;
      }

      if (!result.stdout.trim()) {
        result.stdout = result.exitCode === 0
          ? "LLVM program exited with code 0."
          : `LLVM program returned i32 ${result.exitCode}.\nUse stdout in the IR itself if you want printable program output.`;
      }
    }

    return result;
  }
}
