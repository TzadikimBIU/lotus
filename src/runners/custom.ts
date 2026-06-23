import { runTempFileProcess } from "../execution/processRunner";
import { splitCommandLine } from "../utils/command";
import { findEnabledCommandLanguage } from "../languagePackages";
import type { loomCodeBlock, loomCustomLanguage, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class CustomLanguageRunner implements loomRunner {
  id = "custom";
  displayName = "Custom language";
  languages = [] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }

  run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
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

  private getCustomLanguage(block: loomCodeBlock, settings: loomPluginSettings): loomCustomLanguage | undefined {
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
