import type { TFile } from "obsidian";

export type lotusNormalizedLanguage = string;

export interface lotusCodeBlock {
  id: string;
  ordinal: number;
  filePath: string;
  language: lotusNormalizedLanguage;
  languageAlias: string;
  sourceLanguage: string;
  content: string;
  attributes: Record<string, string>;
  sourceReference?: lotusSourceReference;
  executionContext: lotusExecutionContextOverride;
  startLine: number;
  endLine: number;
  fenceStart: number;
  fenceEnd: number;
}

export interface lotusExecutionContextOverride {
  containerGroup?: string;
  disableContainer?: boolean;
  workingDirectory?: string;
  timeoutMs?: number;
}

export interface lotusResolvedExecutionContext {
  containerGroup?: string;
  workingDirectory: string;
  timeoutMs: number;
  source: {
    container: "global" | "note" | "block" | "none";
    workingDirectory: "global" | "note" | "block" | "default";
    timeout: "global" | "note" | "block";
  };
}

export interface lotusSourceReference {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  traceDependencies: boolean;
  call?: lotusSourceCallHarness;
}

export interface lotusSourceCallHarness {
  expression?: string;
  args?: string;
  print: boolean;
}

export interface lotusRunContext {
  file: TFile;
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

export interface lotusRunResult {
  runnerId: string;
  runnerName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
  timedOut: boolean;
  cancelled: boolean;
  warning?: string;
}

export interface lotusRunner {
  id: string;
  displayName: string;
  languages: readonly lotusNormalizedLanguage[];
  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean;
  run(block: lotusCodeBlock, context: lotusRunContext, settings: lotusPluginSettings): Promise<lotusRunResult>;
}

export interface lotusStoredOutput {
  blockId: string;
  block: lotusCodeBlock;
  result: lotusRunResult;
  sourcePreview?: lotusSourcePreview;
  collapsed: boolean;
  visible: boolean;
}

export interface lotusSourcePreview {
  description: string;
  language: lotusNormalizedLanguage;
  content: string;
  capability?: lotusLanguageCapabilitySnapshot;
  expanded: boolean;
  showCapabilityMetadata: boolean;
}

export interface lotusLanguageCapabilitySnapshot {
  symbolExtraction: string;
  dependencyTracing: string;
  callHarness: string;
  sourcePreview: boolean;
}

export interface lotusPluginSettings {
  enableLocalExecution: boolean;
  hasAcknowledgedExecutionRisk: boolean;
  preserveSourceMode: boolean;
  defaultTimeoutMs: number;
  workingDirectory: string;
  pythonExecutable: string;
  nodeExecutable: string;
  typescriptMode: "ts-node" | "tsx";
  typescriptTranspilerExecutable: string;
  ocamlMode: "ocaml" | "ocamlc" | "dune";
  ocamlExecutable: string;
  cExecutable: string;
  cppExecutable: string;
  shellExecutable: string;
  rubyExecutable: string;
  perlExecutable: string;
  luaExecutable: string;
  phpExecutable: string;
  goExecutable: string;
  rustExecutable: string;
  haskellExecutable: string;
  javaCompilerExecutable: string;
  javaExecutable: string;
  llvmInterpreterExecutable: string;
  ebpfClangExecutable: string;
  ebpfBpftoolExecutable: string;
  ebpfLlvmObjdumpExecutable: string;
  ebpfIncludePaths: string;
  ebpfAllowKernelLoad: boolean;
  bpftraceExecutable: string;
  leanExecutable: string;
  coqExecutable: string;
  smtExecutable: string;
  writeOutputToNote: boolean;
  outputVisibleLines: number;
  autoRunOnFileOpen: boolean;
  hashCodeBlocks: boolean;
  showObsidianContextWarning: boolean;
  extractedSourcePreviewMode: "collapsed" | "expanded" | "hidden";
  showLanguageCapabilityMetadata: boolean;
  languageConfigurationVersion: number;
  enabledLanguagePacks: string[];
  enabledLanguages: string[];
  externalLanguagePacks: lotusExternalLanguagePack[];
  customLanguages: lotusCustomLanguage[];
  pdfExportMode: "both" | "code" | "output";
  loggingEnabled: boolean;
  loggingGlobalTextEnabled: boolean;
  loggingGlobalTextPath: string;
  loggingGlobalJsonlEnabled: boolean;
  loggingGlobalJsonlPath: string;
  loggingPerNoteTextEnabled: boolean;
  loggingPerNoteTextPathPattern: string;
  loggingPerNoteJsonlEnabled: boolean;
  loggingPerNoteJsonlPathPattern: string;
  loggingProcessEnabled: boolean;
  loggingProcessCommand: string;
  loggingHttpEnabled: boolean;
  loggingHttpEndpoint: string;
  loggingHttpHeaders: string;
  loggingNotePathMode: "plain" | "hash" | "omit";
  loggingIncludeCode: boolean;
  loggingIncludeOutput: boolean;
  loggingIncludeInput: boolean;
  loggingMaxEventBytes: number;
  loggingMachineId: string;
  defaultContainerGroup: string;
}

export interface lotusRunState {
  block: lotusCodeBlock;
  startedAt: number;
}

export interface lotusCustomLanguage {
  name: string;
  aliases: string;
  executable: string;
  args: string;
  extension: string;
  extractorMode?: "command" | "transpile-c";
  extractorExecutable?: string;
  extractorArgs?: string;
  transpileExecutable?: string;
  transpileArgs?: string;
}

export interface lotusExternalLanguagePack {
  id: string;
  displayName: string;
  description: string;
  languages: lotusExternalLanguage[];
}

export interface lotusExternalLanguage extends lotusCustomLanguage {
  displayName: string;
  description?: string;
}
