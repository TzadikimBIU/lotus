import { runTempFileProcess } from "../execution/processRunner";
import { splitCommandLine } from "../utils/command";
import { findEnabledCommandLanguage } from "../languagePackages";
import { resolveHighlightLanguageReference } from "../languageHighlight";
import type { lotusCodeBlock, lotusCustomLanguage, lotusPluginSettings, lotusRunContext, lotusRunResult, lotusRunner } from "../types";

export class CustomLanguageRunner implements lotusRunner {
  id = "custom";
  displayName = "Custom language";
  languages = [] as const;

  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }

  async run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings): Promise<lotusRunResult> {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }

    const mode = language.mode === "transpile" ? "transpile" : "execute";
    const readsGeneratedFile = language.outputMode === "file";
    const result = await runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: mode === "transpile" ? `${language.name} transpiler` : language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension(language.extension, language.name),
      source: block.content,
      readOutputFile: readsGeneratedFile,
      outputExtension: readsGeneratedFile ? normalizeExtension(language.outputExtension, "out") : undefined,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
      stdinSession: context.stdinSession,
      onStdout: context.onStdout,
      onStderr: context.onStderr,
    });
    if (mode === "transpile") {
      const outputLanguage = resolveConfiguredLanguage(language.targetLanguage || language.highlightLanguage, settings);
      result.stdoutRole = "transpiled-source";
      if (outputLanguage) {
        result.stdoutLanguage = outputLanguage;
      }
    }
    return result;
  }

  private getCustomLanguage(block: lotusCodeBlock, settings: lotusPluginSettings): lotusCustomLanguage | undefined {
    return findEnabledCommandLanguage(settings, block.language, block.languageAlias);
  }
}

function resolveConfiguredLanguage(language: string | undefined, settings: lotusPluginSettings): string | undefined {
  return resolveHighlightLanguageReference(settings, language) ?? undefined;
}

function normalizeExtension(extension: string | undefined, name: string): string {
  const trimmed = extension?.trim() ?? "";
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
