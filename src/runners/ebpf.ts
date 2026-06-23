import { join } from "path";
import { runProcess, withTempSourceFile } from "../execution/processRunner";
import { splitCommandLine } from "../utils/command";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

type EbpfCMode = "compile" | "load";
type BpftraceMode = "check" | "run";

export class EbpfRunner implements loomRunner {
  id = "ebpf";
  displayName = "eBPF";
  languages = ["ebpf-c", "bpftrace"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (block.language === "ebpf-c") {
      return Boolean(settings.ebpfClangExecutable.trim());
    }
    if (block.language === "bpftrace") {
      return Boolean(settings.bpftraceExecutable.trim());
    }
    return false;
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    if (block.language === "ebpf-c") {
      return this.runEbpfC(block, context, settings);
    }
    if (block.language === "bpftrace") {
      return this.runBpftrace(block, context, settings);
    }
    throw new Error(`Unsupported eBPF language: ${block.language}`);
  }

  private async runEbpfC(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    const mode = readEbpfCMode(block);
    const cflags = readListAttribute(block, "loom-ebpf-cflags", "ebpf-cflags").flatMap(splitCommandLine);
    const includePaths = [
      ...splitCsv(settings.ebpfIncludePaths),
      ...readListAttribute(block, "loom-ebpf-includes", "ebpf-includes"),
    ];

    return withTempSourceFile(".bpf.c", block.content, async ({ tempDir, tempFile }) => {
      const objectPath = join(tempDir, "snippet.bpf.o");
      const compileResult = await runProcess({
        runnerId: `${this.id}:clang`,
        runnerName: "eBPF clang",
        executable: settings.ebpfClangExecutable.trim(),
        args: [
          "-target",
          "bpf",
          "-O2",
          "-g",
          "-Wall",
          ...includePaths.flatMap((includePath) => ["-I", includePath]),
          ...cflags,
          "-c",
          tempFile,
          "-o",
          objectPath,
        ],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
      });

      if (!compileResult.success) {
        return compileResult;
      }

      compileResult.stdout = appendSection(compileResult.stdout, "Compile", `eBPF object compiled successfully: ${objectPath}`);
      await this.appendObjectInspection(compileResult, objectPath, context, settings);

      if (mode === "compile") {
        return compileResult;
      }

      return this.loadEbpfObject(block, objectPath, context, settings, compileResult);
    });
  }

  private async appendObjectInspection(result: loomRunResult, objectPath: string, context: loomRunContext, settings: loomPluginSettings): Promise<void> {
    const objdump = settings.ebpfLlvmObjdumpExecutable.trim();
    if (!objdump) {
      result.warning = appendLine(result.warning, "eBPF object inspection skipped because no object inspector is configured.");
      return;
    }

    const inspect = await runProcess({
      runnerId: `${this.id}:objdump`,
      runnerName: "eBPF object inspection",
      executable: objdump,
      args: ["-h", objectPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 30_000),
      signal: context.signal,
    });

    if (inspect.success) {
      result.stdout = appendSection(result.stdout, "Object sections", inspect.stdout.trim() || "(no sections reported)");
    } else {
      result.warning = appendLine(result.warning, `eBPF object inspection failed: ${inspect.stderr || inspect.stdout || `exit ${inspect.exitCode}`}`);
    }
  }

  private async loadEbpfObject(
    block: loomCodeBlock,
    objectPath: string,
    context: loomRunContext,
    settings: loomPluginSettings,
    compileResult: loomRunResult,
  ): Promise<loomRunResult> {
    if (!settings.ebpfAllowKernelLoad) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "eBPF kernel loading is disabled. Enable Allow eBPF kernel load in settings before using loom-ebpf-mode=load."),
      };
    }

    const pinPath = readStringAttribute(block, "loom-ebpf-pin", "ebpf-pin");
    if (!pinPath) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "loom-ebpf-mode=load requires loom-ebpf-pin=/sys/fs/bpf/<path>."),
      };
    }

    const load = await runProcess({
      runnerId: `${this.id}:bpftool:load`,
      runnerName: "bpftool eBPF load",
      executable: settings.ebpfBpftoolExecutable.trim() || "bpftool",
      args: ["-d", "prog", "loadall", objectPath, pinPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 30_000),
      signal: context.signal,
    });

    load.stdout = appendSection(compileResult.stdout, "bpftool stdout", load.stdout.trim());
    load.stderr = appendSection(compileResult.stderr, "bpftool stderr", load.stderr.trim());
    load.warning = appendLine(compileResult.warning, `eBPF object load requested with pin path ${pinPath}.`);
    return load;
  }

  private async runBpftrace(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    const mode = readBpftraceMode(block);
    const extraArgs = readListAttribute(block, "loom-bpftrace-args", "bpftrace-args").flatMap(splitCommandLine);
    const executable = settings.bpftraceExecutable.trim();

    return withTempSourceFile(".bt", block.content, async ({ tempFile }) => {
      if (mode === "run") {
        return runProcess({
          runnerId: `${this.id}:bpftrace:${mode}`,
          runnerName: "bpftrace",
          executable,
          args: [...extraArgs, tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 30_000),
          signal: context.signal,
          stdin: context.stdin,
        });
      }

      const result = await runProcess({
        runnerId: `${this.id}:bpftrace:${mode}`,
        runnerName: "bpftrace check",
        executable,
        args: ["--dry-run", ...extraArgs, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 30_000),
        signal: context.signal,
      });

      if (!result.success && isUnsupportedBpftraceDryRun(result)) {
        return runProcess({
          runnerId: `${this.id}:bpftrace:${mode}:legacy-debug`,
          runnerName: "bpftrace check",
          executable,
          args: ["-d", ...extraArgs, tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 30_000),
          signal: context.signal,
        });
      }

      return result;
    });
  }
}

function readEbpfCMode(block: loomCodeBlock): EbpfCMode {
  const value = readStringAttribute(block, "loom-ebpf-mode", "ebpf-mode") || "compile";
  if (value === "compile" || value === "load") {
    return value;
  }
  throw new Error(`Unsupported eBPF mode: ${value}. Use compile or load.`);
}

function readBpftraceMode(block: loomCodeBlock): BpftraceMode {
  const value = readStringAttribute(block, "loom-bpftrace-mode", "bpftrace-mode") || "check";
  if (value === "check" || value === "run") {
    return value;
  }
  throw new Error(`Unsupported bpftrace mode: ${value}. Use check or run.`);
}

function readStringAttribute(block: loomCodeBlock, primary: string, fallback: string): string | undefined {
  return block.attributes[primary]?.trim() || block.attributes[fallback]?.trim() || undefined;
}

function readListAttribute(block: loomCodeBlock, primary: string, fallback: string): string[] {
  return splitCsv(readStringAttribute(block, primary, fallback) || "");
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendLine(existing: string | undefined, line: string): string {
  return [existing, line].filter((part) => part?.trim()).join("\n");
}

function appendSection(existing: string, title: string, body: string): string {
  const content = body.trim();
  if (!content) {
    return existing;
  }
  return [existing.trim(), `${title}:\n${content}`].filter(Boolean).join("\n\n");
}

function isUnsupportedBpftraceDryRun(result: loomRunResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    output.includes("--dry-run") && (output.includes("unrecognized option") || output.includes("unknown option") || output.includes("invalid option"))
  ) || (
    output.includes("usage:") && !output.includes("--dry-run")
  );
}
