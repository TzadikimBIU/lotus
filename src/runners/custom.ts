import { runTempFileProcess } from "../execution/processRunner";
import { splitCommandLine } from "../utils/command";
import { findEnabledCommandLanguage } from "../languagePackages";
import type { lotusCodeBlock, lotusCustomLanguage, lotusPluginSettings, lotusRunContext, lotusRunResult, lotusRunner } from "../types";

export class CustomLanguageRunner implements lotusRunner {
  id = "custom";
  displayName = "Custom language";
  languages = [] as const;

  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }

  run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings): Promise<lotusRunResult> {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }

    return runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension(language.extension, language.name),
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      stdin: context.stdin,
    });
  }

  private getCustomLanguage(block: lotusCodeBlock, settings: lotusPluginSettings): lotusCustomLanguage | undefined {
    return findEnabledCommandLanguage(settings, block.language, block.languageAlias);
  }
}

function normalizeExtension(extension: string, name: string): string {
  const trimmed = extension.trim();
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
