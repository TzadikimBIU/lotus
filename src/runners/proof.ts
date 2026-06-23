import { existsSync } from "fs";
import { join } from "path";
import { runTempFileProcess } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class ProofRunner implements loomRunner {
  id = "proof";
  displayName = "Proof checker";
  languages = ["lean", "coq", "smtlib"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (block.language === "lean") {
      return Boolean(settings.leanExecutable.trim());
    }

    if (block.language === "coq") {
      return Boolean(resolveCoqExecutable(settings).trim());
    }

    if (block.language === "smtlib") {
      return Boolean(settings.smtExecutable.trim());
    }

    return false;
  }

  run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    if (block.language === "lean") {
      return runTempFileProcess({
        runnerId: `${this.id}:lean`,
        runnerName: "Lean",
        executable: settings.leanExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".lean",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
        stdin: context.stdin,
      });
    }

    if (block.language === "coq") {
      return runTempFileProcess({
        runnerId: `${this.id}:coq`,
        runnerName: "Coq",
        executable: resolveCoqExecutable(settings),
        args: ["-q", "{file}"],
        fileExtension: ".v",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
        stdin: context.stdin,
      });
    }

    if (block.language === "smtlib") {
      return runTempFileProcess({
        runnerId: `${this.id}:smtlib`,
        runnerName: "SMT-LIB (Z3)",
        executable: settings.smtExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".smt2",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
        stdin: context.stdin,
      });
    }

    throw new Error(`Unsupported proof language: ${block.language}`);
  }
}

function resolveCoqExecutable(settings: loomPluginSettings): string {
  const configured = settings.coqExecutable.trim();
  if (configured && configured !== "coqc") {
    return configured;
  }

  const opamCoqc = join(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return existsSync(opamCoqc) ? opamCoqc : configured || "coqc";
}
