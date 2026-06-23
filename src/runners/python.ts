import { runTempFileProcess } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class PythonRunner implements loomRunner {
  id = "python";
  displayName = "Python";
  languages = ["python"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    return block.language === "python" && Boolean(settings.pythonExecutable.trim());
  }

  run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.pythonExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".py",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
    });
  }
}
