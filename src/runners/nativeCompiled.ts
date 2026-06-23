import { join } from "path";
import { runProcess, withTempSourceFile } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class NativeCompiledRunner implements loomRunner {
  id = "native-compiled";
  displayName = "Native compiler";
  languages = ["c", "cpp"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (block.language === "c") {
      return Boolean(settings.cExecutable.trim());
    }

    if (block.language === "cpp") {
      return Boolean(settings.cppExecutable.trim());
    }

    return false;
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    const executable = block.language === "c" ? settings.cExecutable.trim() : settings.cppExecutable.trim();
    const fileExtension = block.language === "c" ? ".c" : ".cpp";
    const runnerName = block.language === "c" ? "C (GCC)" : "C++ (G++)";

    return withTempSourceFile(fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = join(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${block.language}:compile`,
        runnerName,
        executable,
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
        runnerId: `${this.id}:${block.language}:run`,
        runnerName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
      });
    });
  }
}
