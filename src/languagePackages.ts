import type { loomCustomLanguage, loomNormalizedLanguage, loomPluginSettings } from "./types";

export interface loomLanguageDefinition {
  id: loomNormalizedLanguage;
  displayName: string;
  aliases: string[];
}

export interface loomLanguagePackage {
  id: string;
  displayName: string;
  description: string;
  languages: loomLanguageDefinition[];
}

export const BUILT_IN_LANGUAGE_PACKAGES: loomLanguagePackage[] = [
  {
    id: "interpreted",
    displayName: "Interpreted",
    description: "Script and REPL-oriented languages for operational notes and quick experiments.",
    languages: [
      { id: "python", displayName: "Python", aliases: ["python", "py"] },
      { id: "javascript", displayName: "JavaScript", aliases: ["javascript", "js"] },
      { id: "typescript", displayName: "TypeScript", aliases: ["typescript", "ts"] },
      { id: "shell", displayName: "Shell", aliases: ["shell", "sh", "bash", "zsh"] },
      { id: "ruby", displayName: "Ruby", aliases: ["ruby", "rb"] },
      { id: "perl", displayName: "Perl", aliases: ["perl", "pl"] },
      { id: "lua", displayName: "Lua", aliases: ["lua"] },
      { id: "php", displayName: "PHP", aliases: ["php"] },
      { id: "go", displayName: "Go", aliases: ["go", "golang"] },
      { id: "haskell", displayName: "Haskell", aliases: ["haskell", "hs"] },
      { id: "ocaml", displayName: "OCaml", aliases: ["ocaml", "ml"] },
    ],
  },
  {
    id: "native-compiled",
    displayName: "Native Compiled",
    description: "Languages compiled into native binaries by local toolchains.",
    languages: [
      { id: "c", displayName: "C", aliases: ["c", "h"] },
      { id: "cpp", displayName: "C++", aliases: ["cpp", "cxx", "cc", "c++"] },
    ],
  },
  {
    id: "managed-compiled",
    displayName: "Managed Compiled",
    description: "Compiled languages with managed runtimes or structured build/run phases.",
    languages: [
      { id: "rust", displayName: "Rust", aliases: ["rust", "rs"] },
      { id: "java", displayName: "Java", aliases: ["java"] },
    ],
  },
  {
    id: "proofs",
    displayName: "Proofs",
    description: "Proof assistants and solver-oriented languages.",
    languages: [
      { id: "lean", displayName: "Lean", aliases: ["lean", "lean4"] },
      { id: "coq", displayName: "Coq", aliases: ["coq", "v"] },
      { id: "smtlib", displayName: "SMT-LIB", aliases: ["smt", "smt2", "smtlib", "smt-lib", "z3"] },
    ],
  },
  {
    id: "llvm",
    displayName: "LLVM",
    description: "LLVM IR tooling for compiler and PL research vaults.",
    languages: [
      { id: "llvm-ir", displayName: "LLVM IR", aliases: ["llvm", "llvmir", "llvm-ir", "ll"] },
    ],
  },
  {
    id: "ebpf",
    displayName: "eBPF",
    description: "Kernel instrumentation languages for BPF object compilation, verifier checks, and bpftrace scripts.",
    languages: [
      { id: "ebpf-c", displayName: "eBPF C", aliases: ["ebpf", "ebpf-c", "bpf-c", "bpf"] },
      { id: "bpftrace", displayName: "bpftrace", aliases: ["bpftrace", "bt"] },
    ],
  },
];

export const CUSTOM_LANGUAGE_PACKAGE_ID = "custom";
export const LANGUAGE_CONFIGURATION_VERSION = 2;

export function getDefaultLanguagePackIds(): string[] {
  return [...BUILT_IN_LANGUAGE_PACKAGES.map((pack) => pack.id), CUSTOM_LANGUAGE_PACKAGE_ID];
}

export function getDefaultLanguageIds(): string[] {
  return BUILT_IN_LANGUAGE_PACKAGES.flatMap((pack) => pack.languages.map((language) => language.id));
}

export function normalizeLanguageConfiguration(settings: loomPluginSettings): void {
  if (!Array.isArray(settings.externalLanguagePacks)) {
    settings.externalLanguagePacks = [];
  }
  if (!Array.isArray(settings.enabledLanguagePacks) || !settings.enabledLanguagePacks.length) {
    settings.enabledLanguagePacks = getDefaultLanguagePackIds();
  }
  if (!Array.isArray(settings.enabledLanguages) || !settings.enabledLanguages.length) {
    settings.enabledLanguages = getDefaultLanguageIds();
  }
  if (!Number.isFinite(settings.languageConfigurationVersion)) {
    settings.languageConfigurationVersion = 1;
  }
  if (settings.languageConfigurationVersion < 2) {
    enableLanguagePackage(settings, "ebpf");
    settings.languageConfigurationVersion = LANGUAGE_CONFIGURATION_VERSION;
  }
}

function enableLanguagePackage(settings: loomPluginSettings, packageId: string): void {
  const pack = BUILT_IN_LANGUAGE_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pack) {
    return;
  }
  appendUnique(settings.enabledLanguagePacks, pack.id);
  for (const language of pack.languages) {
    appendUnique(settings.enabledLanguages, language.id);
  }
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

export function getEnabledLanguageDefinitions(settings: loomPluginSettings): loomLanguageDefinition[] {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);

  return getAvailableLanguagePackages(settings)
    .filter((pack) => enabledPacks.has(pack.id))
    .flatMap((pack) => pack.languages)
    .filter((language) => enabledLanguages.has(language.id));
}

export function getAvailableLanguagePackages(settings: loomPluginSettings): loomLanguagePackage[] {
  normalizeLanguageConfiguration(settings);
  return [
    ...BUILT_IN_LANGUAGE_PACKAGES,
    ...(settings.externalLanguagePacks ?? []).map((pack) => ({
      id: pack.id,
      displayName: pack.displayName,
      description: pack.description,
      languages: pack.languages.map((language) => ({
        id: language.name,
        displayName: language.displayName || language.name,
        aliases: parseAliasList(language.aliases),
      })),
    })),
  ];
}

export function getEnabledLanguageAliasMap(settings: loomPluginSettings): Record<string, loomNormalizedLanguage> {
  return Object.fromEntries(
    getEnabledLanguageDefinitions(settings).flatMap((language) =>
      language.aliases.map((alias) => [alias.toLowerCase(), language.id] as const),
    ),
  );
}

export function isLanguageEnabled(languageId: loomNormalizedLanguage, settings: loomPluginSettings): boolean {
  normalizeLanguageConfiguration(settings);
  return getEnabledLanguageDefinitions(settings).some((language) => language.id === languageId);
}

export function areCustomLanguagesEnabled(settings: loomPluginSettings): boolean {
  normalizeLanguageConfiguration(settings);
  return settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID);
}

export function getEnabledCommandLanguages(settings: loomPluginSettings): loomCustomLanguage[] {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);
  const customLanguages = areCustomLanguagesEnabled(settings) ? settings.customLanguages ?? [] : [];
  const externalLanguages = (settings.externalLanguagePacks ?? [])
    .filter((pack) => enabledPacks.has(pack.id))
    .flatMap((pack) => pack.languages)
    .filter((language) => enabledLanguages.has(language.name));

  return [...customLanguages, ...externalLanguages];
}

export function findEnabledCommandLanguage(settings: loomPluginSettings, normalizedLanguage: string, sourceAlias?: string): loomCustomLanguage | undefined {
  const normalized = normalizedLanguage.trim().toLowerCase();
  const alias = sourceAlias?.trim().toLowerCase();
  return getEnabledCommandLanguages(settings).find((language) => {
    const name = language.name.trim().toLowerCase();
    const aliases = parseAliasList(language.aliases);
    return name === normalized || aliases.includes(normalized) || Boolean(alias && (name === alias || aliases.includes(alias)));
  });
}

function parseAliasList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((alias) => alias.trim().toLowerCase())
    .filter(Boolean);
}
