import { runTempFileProcess } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class NodeRunner implements loomRunner {
  id = "node";
  displayName = "Node.js";
  languages = ["javascript", "typescript"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (block.language === "javascript") {
      return Boolean(settings.nodeExecutable.trim());
    }

    return Boolean(settings.typescriptTranspilerExecutable.trim());
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    if (block.language === "javascript") {
      return runTempFileProcess({
        runnerId: this.id,
        runnerName: this.displayName,
        executable: settings.nodeExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".js",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        stdin: context.stdin,
      });
    }

    const executable = settings.typescriptTranspilerExecutable.trim();
    const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";

    return runTempFileProcess({
      runnerId: `${this.id}:${settings.typescriptMode}`,
      runnerName,
      executable,
      args: ["{file}"],
      fileExtension: ".ts",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
    });
  }
}
