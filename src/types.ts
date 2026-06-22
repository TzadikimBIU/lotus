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
  sourceReference?: loomSourceReference;
  startLine: number;
  endLine: number;
  fenceStart: number;
  fenceEnd: number;
}

export interface loomSourceReference {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  traceDependencies: boolean;
}

export interface loomRunContext {
  file: TFile;
  workingDirectory: string;
  timeoutMs: number;
  signal: AbortSignal;
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
  collapsed: boolean;
  visible: boolean;
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
  leanExecutable: string;
  coqExecutable: string;
  smtExecutable: string;
  writeOutputToNote: boolean;
  autoRunOnFileOpen: boolean;
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
}
