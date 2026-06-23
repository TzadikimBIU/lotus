import type { loomCodeBlock, loomPluginSettings, loomRunner } from "../types";
import { findEnabledCommandLanguage, isLanguageEnabled } from "../languagePackages";

export class loomRunnerRegistry {
  constructor(private readonly runners: loomRunner[]) {}

  getRunnerForBlock(block: loomCodeBlock, settings: loomPluginSettings): loomRunner | null {
    if (!this.isBlockLanguageEnabled(block, settings)) {
      return null;
    }
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }

  getSupportedLanguages(): string[] {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }

  private isBlockLanguageEnabled(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    if (isLanguageEnabled(block.language, settings)) {
      return true;
    }
    return Boolean(findEnabledCommandLanguage(settings, block.language, block.languageAlias));
  }
}
