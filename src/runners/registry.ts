import type { loomCodeBlock, loomPluginSettings, loomRunner } from "../types";
import { areCustomLanguagesEnabled, isLanguageEnabled } from "../languagePackages";

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
    return areCustomLanguagesEnabled(settings) && settings.customLanguages.some((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases
        .split(",")
        .map((alias) => alias.trim().toLowerCase())
        .filter(Boolean);
      return name === block.language.trim().toLowerCase() || aliases.includes(block.languageAlias.trim().toLowerCase());
    });
  }
}
