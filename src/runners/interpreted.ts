import { runTempFileProcess } from "../execution/processRunner";
import type { lotusCodeBlock, lotusNormalizedLanguage, lotusPluginSettings, lotusRunContext, lotusRunResult, lotusRunner } from "../types";

interface InterpretedSpec {
  language: lotusNormalizedLanguage;
  displayName: string;
  executable: (settings: lotusPluginSettings) => string;
  fileExtension: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  minimumTimeoutMs?: number;
}

const INTERPRETED_SPECS: InterpretedSpec[] = [
  {
    language: "shell",
    displayName: "Shell",
    executable: (settings) => settings.shellExecutable,
    fileExtension: ".sh",
  },
  {
    language: "ruby",
    displayName: "Ruby",
    executable: (settings) => settings.rubyExecutable,
    fileExtension: ".rb",
  },
  {
    language: "perl",
    displayName: "Perl",
    executable: (settings) => settings.perlExecutable,
    fileExtension: ".pl",
  },
  {
    language: "lua",
    displayName: "Lua",
    executable: (settings) => settings.luaExecutable,
    fileExtension: ".lua",
  },
  {
    language: "php",
    displayName: "PHP",
    executable: (settings) => settings.phpExecutable,
    fileExtension: ".php",
  },
  {
    language: "go",
    displayName: "Go",
    executable: (settings) => settings.goExecutable,
    fileExtension: ".go",
    args: ["run", "{file}"],
    env: {
      GOCACHE: "{tempDir}/gocache",
    },
    minimumTimeoutMs: 30_000,
  },
  {
    language: "haskell",
    displayName: "Haskell",
    executable: (settings) => settings.haskellExecutable,
    fileExtension: ".hs",
    minimumTimeoutMs: 30_000,
  },
];

export class InterpretedRunner implements lotusRunner {
  id = "interpreted";
  displayName = "Interpreted";
  languages = INTERPRETED_SPECS.map((spec) => spec.language);

  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean {
    const spec = this.getSpec(block.language);
    return Boolean(spec?.executable(settings).trim());
  }

  run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings): Promise<lotusRunResult> {
    const spec = this.getSpec(block.language);
    if (!spec) {
      throw new Error(`Unsupported language: ${block.language}`);
    }

    return runTempFileProcess({
      runnerId: `${this.id}:${block.language}`,
      runnerName: spec.displayName,
      executable: spec.executable(settings).trim(),
      args: spec.args ?? ["{file}"],
      fileExtension: spec.fileExtension,
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, spec.minimumTimeoutMs ?? 0),
      signal: context.signal,
      stdin: context.stdin,
      env: spec.env,
    });
  }

  private getSpec(language: lotusNormalizedLanguage): InterpretedSpec | undefined {
    return INTERPRETED_SPECS.find((spec) => spec.language === language);
  }
}
