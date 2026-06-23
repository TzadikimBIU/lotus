import type { TFile } from "obsidian";

export type loomNormalizedLanguage = string;

export interface loomCodeBlock {
  id: string;
  ordinal: number;
  filePath: string;
  language: loomNormalizedLanguage;
  languageAlias: string;
  sourceLanguage: string;
  content: string;
  attributes: Record<string, string>;
  sourceReference?: loomSourceReference;
  executionContext: loomExecutionContextOverride;
  startLine: number;
  endLine: number;
  fenceStart: number;
  fenceEnd: number;
}

export interface loomExecutionContextOverride {
  containerGroup?: string;
  disableContainer?: boolean;
  workingDirectory?: string;
  timeoutMs?: number;
}

export interface loomResolvedExecutionContext {
  containerGroup?: string;
  workingDirectory: string;
  timeoutMs: number;
  source: {
    container: "global" | "note" | "block" | "none";
    workingDirectory: "global" | "note" | "block" | "default";
    timeout: "global" | "note" | "block";
  };
}

export interface loomSourceReference {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  traceDependencies: boolean;
  call?: loomSourceCallHarness;
}

export interface loomSourceCallHarness {
  expression?: string;
  args?: string;
  print: boolean;
}

export interface loomRunContext {
  file: TFile;
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

export interface loomRunResult {
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

export interface loomRunner {
  id: string;
  displayName: string;
  languages: readonly loomNormalizedLanguage[];
  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean;
  run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult>;
}

export interface loomStoredOutput {
  blockId: string;
  block: loomCodeBlock;
  result: loomRunResult;
  sourcePreview?: loomSourcePreview;
  collapsed: boolean;
  visible: boolean;
}

export interface loomSourcePreview {
  description: string;
  language: loomNormalizedLanguage;
  content: string;
  capability?: loomLanguageCapabilitySnapshot;
  expanded: boolean;
  showCapabilityMetadata: boolean;
}

export interface loomLanguageCapabilitySnapshot {
  symbolExtraction: string;
  dependencyTracing: string;
  callHarness: string;
  sourcePreview: boolean;
}

export interface loomPluginSettings {
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
  extractedSourcePreviewMode: "collapsed" | "expanded" | "hidden";
  showLanguageCapabilityMetadata: boolean;
  languageConfigurationVersion: number;
  enabledLanguagePacks: string[];
  enabledLanguages: string[];
  externalLanguagePacks: loomExternalLanguagePack[];
  customLanguages: loomCustomLanguage[];
  pdfExportMode: "both" | "code" | "output";
  defaultContainerGroup: string;
}

export interface loomRunState {
  block: loomCodeBlock;
  startedAt: number;
}

export interface loomCustomLanguage {
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

export interface loomExternalLanguagePack {
  id: string;
  displayName: string;
  description: string;
  languages: loomExternalLanguage[];
}

export interface loomExternalLanguage extends loomCustomLanguage {
  displayName: string;
  description?: string;
}
