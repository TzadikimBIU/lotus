import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { dirname } from "path";
import { loomContainerRunner } from "./execution/containerRunner";
import { resolveExecutionContext } from "./executionContext";
import { addLlvmDecorations, highlightLlvmElement } from "./llvmHighlight";
import { findBlockAtLine, getSupportedLanguageAliases, parseMarkdownCodeBlocks } from "./parser";
import { getLanguageCapability } from "./languageCapabilities";
import { findEnabledCommandLanguage, normalizeLanguageConfiguration } from "./languagePackages";
import { NodeRunner } from "./runners/node";
import { CustomLanguageRunner } from "./runners/custom";
import { InterpretedRunner } from "./runners/interpreted";
import { EbpfRunner } from "./runners/ebpf";
import { LlvmRunner } from "./runners/llvm";
import { ManagedCompiledRunner } from "./runners/managedCompiled";
import { NativeCompiledRunner } from "./runners/nativeCompiled";
import { OcamlRunner } from "./runners/ocaml";
import { PythonRunner } from "./runners/python";
import { ProofRunner } from "./runners/proof";
import { loomRunnerRegistry } from "./runners/registry";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import { loomSettingTab, showExecutionDisabledNotice } from "./settings";
import { resolveReferencedSource } from "./sourceExtract";
import { buildSourceReferenceHarness } from "./sourceHarness";
import { createCodeBlockToolbar } from "./ui/codeBlockToolbar";
import { createOutputPanel, createRunningPanel } from "./ui/outputPanel";
import { splitCommandLine } from "./utils/command";
import type { loomCodeBlock, loomExternalLanguage, loomExternalLanguagePack, loomPluginSettings, loomResolvedExecutionContext, loomStoredOutput } from "./types";

const loomRefreshEffect = StateEffect.define<void>();
const EXTERNAL_LANGUAGE_PACK_DIR = "language-packs";
type loomOutputFileMode = "replace" | "append";
type loomOutputFileFormat = "text" | "json";
type loomOutputFileStream = "stdout" | "stderr" | "warning" | "metadata";

interface loomOutputFileTarget {
  path: string;
  mode: loomOutputFileMode;
  format: loomOutputFileFormat;
  streams: loomOutputFileStream[];
}

class ExecutionConsentModal extends Modal {
  constructor(
    app: Plugin["app"],
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Enable loom local execution?" });
    contentEl.createEl("p", {
      text: "loom runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process.",
    });

    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });

    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
  }
}

class loomToolbarRenderChild extends MarkdownRenderChild {
  private panelContainer: HTMLDivElement | null = null;
  private unregisterOutputListener: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: loomPlugin,
    private readonly block: loomCodeBlock,
    private readonly codeElement: HTMLElement,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.codeElement.parentElement?.addClass("loom-codeblock-shell");
    this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));

    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("loom-print-hide-code");
    }

    const hostClasses = ["loom-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("loom-print-hide-output");
    }
    this.panelContainer = this.containerEl.createDiv({ cls: hostClasses.join(" ") });

    this.plugin.renderOutputInto(this.block, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block, this.panelContainer);
      }
    });
  }

  onunload(): void {
    this.unregisterOutputListener?.();
  }
}

class loomToolbarWidget extends WidgetType {
  private readonly isRunning: boolean;

  constructor(
    private readonly plugin: loomPlugin,
    private readonly block: loomCodeBlock,
  ) {
    super();
    this.isRunning = plugin.isBlockRunning(block.id);
  }

  eq(other: loomToolbarWidget): boolean {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
  }

  toDOM(): HTMLElement {
    return this.plugin.createToolbarElement(this.block);
  }
}

class loomOutputWidget extends WidgetType {
  constructor(
    private readonly plugin: loomPlugin,
    private readonly block: loomCodeBlock,
  ) {
    super();
  }

  eq(other: loomOutputWidget): boolean {
    return false;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.block, wrapper);
    return wrapper;
  }
}

export default class loomPlugin extends Plugin {
  settings: loomPluginSettings = DEFAULT_SETTINGS;
  readonly registry = new loomRunnerRegistry([
    new PythonRunner(),
    new NodeRunner(),
    new OcamlRunner(),
    new NativeCompiledRunner(),
    new InterpretedRunner(),
    new ManagedCompiledRunner(),
    new EbpfRunner(),
    new LlvmRunner(),
    new ProofRunner(),
    new CustomLanguageRunner(),
  ]);
  // Exposed as public and readonly so the settings panel and modals can access container configurations and default language mapping helpers.
  public readonly containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
  private readonly registeredCodeBlockAliases = new Set<string>();
  private readonly outputs = new Map<string, loomStoredOutput>();
  private readonly stdinInputs = new Map<string, string>();
  private readonly stdinPanels = new Set<string>();
  private readonly running = new Map<string, AbortController>();
  private readonly outputListeners = new Map<string, Set<() => void>>();
  private statusBarItemEl!: HTMLElement;
  private editorViews = new Set<EditorView>();
  private lastMarkdownFilePath: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new loomSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });

    this.addCommand({
      id: "loom-run-current-code-block",
      name: "loom: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }

        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new Notice("No supported loom block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      },
    });

    this.addCommand({
      id: "loom-run-all-code-blocks",
      name: "loom: Run All Supported Code Blocks in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.runAllBlocksInFile(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "loom-clear-note-outputs",
      name: "loom: Clear loom Outputs in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.clearOutputsForFile(file);
        }
        return true;
      },
    });

    this.registerCodeBlockProcessors();

    this.registerEditorExtension(this.createLivePreviewExtension());

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.lastMarkdownFilePath = file?.path ?? this.lastMarkdownFilePath;
        this.refreshAllViews();
        void this.enforceSourceModeForActiveView();
        if (file && this.settings.autoRunOnFileOpen) {
          void this.runAllBlocksInFile(file);
        }
      }),
    );

    this.addCommand({
      id: "loom-validate-container-groups",
      name: "loom: Validate Container Groups",
      callback: async () => {
        const groups = await this.getContainerGroupSummaries();
        new Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8000);
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
        void this.enforceSourceModeForActiveView();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (ctx instanceof MarkdownView) {
          void this.enforceSourceModeForLeaf(ctx.leaf);
        }
      }),
    );
  }

  onunload(): void {
    for (const controller of this.running.values()) {
      controller.abort();
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData()),
    };
    await this.loadExternalLanguagePacks();
    this.normalizeSettings();
  }

  async loadExternalLanguagePacks(showNotice = false): Promise<void> {
    const packDir = normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/loom"}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
    const adapter = this.app.vault.adapter;
    const packs: loomExternalLanguagePack[] = [];
    let failures = 0;

    try {
      if (!(await adapter.exists(packDir))) {
        this.settings.externalLanguagePacks = [];
        if (showNotice) {
          await adapter.mkdir(packDir);
          new Notice(`Created external language pack folder at ${packDir}`);
        }
        return;
      }

      const listed = await adapter.list(packDir);
      const files = listed.files
        .filter((path) => path.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));

      for (const filePath of files) {
        try {
          const parsed = parseExternalLanguagePack(JSON.parse(await adapter.read(filePath)), filePath);
          if (parsed) {
            packs.push(parsed);
          } else {
            failures += 1;
          }
        } catch (error) {
          failures += 1;
          console.warn(`Failed to load loom language pack ${filePath}`, error);
        }
      }
    } catch (error) {
      this.settings.externalLanguagePacks = [];
      console.warn(`Failed to scan loom language packs in ${packDir}`, error);
      if (showNotice) {
        new Notice(`Failed to load external language packs from ${packDir}`);
      }
      return;
    }

    this.settings.externalLanguagePacks = packs;
    if (showNotice) {
      const suffix = failures ? `, ${failures} failed` : "";
      new Notice(`Loaded ${packs.length} external language pack${packs.length === 1 ? "" : "s"}${suffix}`);
    }
  }

  async saveSettings(): Promise<void> {
    this.normalizeSettings();
    const persistedSettings: Partial<loomPluginSettings> = { ...this.settings };
    delete persistedSettings.externalLanguagePacks;
    await this.saveData(persistedSettings);
    this.registerCodeBlockProcessors();
    this.notifyAllOutputsChanged();
    this.refreshAllViews();
  }

  isBlockRunning(blockId: string): boolean {
    return this.running.has(blockId);
  }

  registerOutputListener(blockId: string, listener: () => void): () => void {
    if (!this.outputListeners.has(blockId)) {
      this.outputListeners.set(blockId, new Set());
    }
    this.outputListeners.get(blockId)?.add(listener);
    return () => {
      this.outputListeners.get(blockId)?.delete(listener);
    };
  }

  createToolbarElement(block: loomCodeBlock): HTMLElement {
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runActiveBlockById(block.id),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          new Notice("Code copied");
        } catch {
          new Notice("Clipboard write failed.");
        }
      },
      onRemove: () => void this.removeSnippetById(block.id),
      onToggleInput: () => {
        if (this.stdinPanels.has(block.id)) {
          this.stdinPanels.delete(block.id);
        } else {
          this.stdinPanels.add(block.id);
        }
        this.notifyOutputChanged(block.id);
      },
      onToggleOutput: () => {
        const output = this.outputs.get(block.id);
        if (!output) {
          return;
        }
        output.visible = !output.visible;
        this.notifyOutputChanged(block.id);
      },
    });
  }

  renderOutputInto(block: loomCodeBlock, container: HTMLElement): void {
    container.empty();
    const blockId = block.id;

    if (this.shouldRenderStdinPanel(block)) {
      container.appendChild(this.createStdinPanel(block));
    }

    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }

    if (!output || !output.visible) {
      return;
    }

    container.appendChild(createOutputPanel(output, {
      defaultVisibleLines: this.settings.outputVisibleLines ?? 0,
    }));
  }

  async runActiveBlockById(blockId: string): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block);
  }

  async removeSnippetById(blockId: string): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    this.running.get(blockId)?.abort();
    this.running.delete(blockId);
    this.outputs.delete(blockId);

    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === blockId);
      if (!currentBlock) {
        return content;
      }

      const managedRange = this.findManagedOutputRange(lines, blockId);
      const removalStart = currentBlock.startLine;
      const removalEnd = managedRange ? managedRange.end : currentBlock.endLine;
      lines.splice(removalStart, removalEnd - removalStart + 1);

      while (removalStart < lines.length - 1 && lines[removalStart] === "" && lines[removalStart + 1] === "") {
        lines.splice(removalStart, 1);
      }

      return lines.join("\n");
    });

    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new Notice("loom snippet removed.");
  }

  async runAllBlocksInFile(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });

    if (!supportedBlocks.length) {
      new Notice("No supported loom blocks found in the current note.");
      return;
    }

    for (const block of supportedBlocks) {
      await this.runBlock(file, block);
    }
  }

  async clearOutputsForFile(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    for (const block of blocks) {
      this.outputs.delete(block.id);
      this.notifyOutputChanged(block.id);
      await this.removeManagedOutputBlock(file.path, block.id);
    }
    new Notice("loom outputs cleared.");
  }

  async runBlock(file: TFile, block: loomCodeBlock): Promise<void> {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new Notice("This loom block is already running.");
      return;
    }

    if (!(await this.ensureExecutionEnabled())) {
      showExecutionDisabledNotice();
      return;
    }

    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    const containerGroup = executionContext.containerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }

    const controller = new AbortController();
    const stdin = await this.resolveBlockStdin(file, block);
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal,
      stdin,
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();

    try {
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup
        ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup)
        : await runner!.run(resolvedBlock.block, runContext, this.settings);

      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }

      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}\n${result.warning}` : sourceNotice;
      }
      if (this.hasExplicitExecutionContext(executionContext)) {
        const contextNotice = this.formatExecutionContextNotice(executionContext);
        result.warning = result.warning ? `${contextNotice}\n${result.warning}` : contextNotice;
      }
      await this.writeOutputFileIfRequested(file, block, result);

      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
        collapsed: false,
        visible: true,
      });

      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }

      const runnerName = containerGroup ? `container ${containerGroup}` : runner!.displayName;
      new Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Container ${containerGroup}` : runner?.displayName ?? "Unknown",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          exitCode: -1,
          stdout: "",
          stderr: message,
          success: false,
          timedOut: false,
          cancelled: false,
        },
      });
      new Notice(`loom error: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }

  private async ensureExecutionEnabled(): Promise<boolean> {
    if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      const modal = new ExecutionConsentModal(this.app, async () => {
        this.settings.enableLocalExecution = true;
        this.settings.hasAcknowledgedExecutionRisk = true;
        await this.saveSettings();
        settle(true);
      });

      const originalClose = modal.close.bind(modal);
      modal.close = () => {
        originalClose();
        settle(this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk);
      };
      modal.open();
    });
  }

  private async resolveExecutableBlock(file: TFile, block: loomCodeBlock): Promise<{ block: loomCodeBlock; sourcePreview?: loomStoredOutput["sourcePreview"] }> {
    if (!block.sourceReference) {
      return { block };
    }

    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }

    const harness = buildSourceReferenceHarness(block);
    const externalExtractor = this.getCustomLanguageExtractor(block, file);
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      harness,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor,
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
          return importedFile instanceof TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level),
      },
    );
    const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";

    return {
      block: {
        ...block,
        content: resolved.content,
      },
      sourcePreview: shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true,
      } : undefined,
    };
  }

  private resolveReferencedVaultPath(file: TFile, referencePath: string): string {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return normalizePath(trimmed.slice(1));
    }

    const baseDir = dirname(file.path);
    return normalizePath(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
  }

  private resolvePythonImportVaultPath(fromFilePath: string, moduleName: string, level: number): string | null {
    const modulePath = moduleName
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("/");
    const fromDir = dirname(fromFilePath);
    const baseDirs = level > 0
      ? [this.ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)]
      : [fromDir === "." ? "" : fromDir, ""];

    for (const baseDir of baseDirs) {
      const candidates = this.getPythonImportCandidates(baseDir, modulePath);
      for (const candidate of candidates) {
        const normalized = normalizePath(candidate);
        if (this.app.vault.getAbstractFileByPath(normalized) instanceof TFile) {
          return normalized;
        }
      }
    }

    return null;
  }

  private getPythonImportCandidates(baseDir: string, modulePath: string): string[] {
    const prefix = baseDir ? `${baseDir}/` : "";
    if (!modulePath) {
      return [`${prefix}__init__.py`];
    }
    return [
      `${prefix}${modulePath}.py`,
      `${prefix}${modulePath}/__init__.py`,
    ];
  }

  private ascendVaultPath(path: string, levels: number): string {
    let current = path;
    for (let index = 0; index < levels; index += 1) {
      const next = dirname(current);
      current = next === "." ? "" : next;
    }
    return current;
  }

  async getContainerGroupSummaries(): Promise<Array<{ name: string; status: string }>> {
    return this.containerRunner.getGroupSummaries();
  }

  async buildContainerGroup(name: string): Promise<void> {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 120_000), controller.signal);
    new Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8000);
  }

  registerCodeBlockProcessors(): void {
    for (const alias of getSupportedLanguageAliases(this.settings)) {
      const normalizedAlias = alias.toLowerCase();
      if (this.registeredCodeBlockAliases.has(normalizedAlias)) {
        continue;
      }

      if (/[^a-zA-Z0-9_-]/.test(normalizedAlias)) {
        continue;
      }

      this.registeredCodeBlockAliases.add(normalizedAlias);
      this.registerMarkdownCodeBlockProcessor(normalizedAlias, async (source, el, ctx) => {
        const filePath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
          return;
        }

        const fullText = await this.app.vault.cachedRead(file);
        const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
        const section = (ctx && typeof ctx.getSectionInfo === "function") ? ctx.getSectionInfo(el) : null;
        let block: loomCodeBlock | undefined;
        if (section) {
          const lineStart = section.lineStart;
          block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
        } else {
          block = blocks.find((candidate) => candidate.content === source);
        }
        if (!block) {
          return;
        }

        let pre = el.querySelector("pre") as HTMLElement | null;
        if (!pre) {
          pre = el.createEl("pre");
          pre.addClass(`language-${normalizedAlias}`);
          const code = pre.createEl("code");
          code.addClass(`language-${normalizedAlias}`);
          code.setText(source);
        }

        if (block.language === "llvm-ir") {
          const code = (pre.querySelector("code") as HTMLElement | null) ?? pre;
          highlightLlvmElement(code, source);
        }

        ctx.addChild(new loomToolbarRenderChild(el, this, block, pre));
      });
    }
  }

  private updateStatusBar(): void {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `loom: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "loom: Idle");
  }

  private notifyOutputChanged(blockId: string): void {
    this.outputListeners.get(blockId)?.forEach((listener) => listener());
    this.refreshAllViews();
  }

  private notifyAllOutputsChanged(): void {
    for (const listeners of this.outputListeners.values()) {
      for (const listener of listeners) {
        listener();
      }
    }
  }

  private refreshAllViews(): void {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view as MarkdownView;
      const previewMode = (view as { previewMode?: { rerender?: (force?: boolean) => void } }).previewMode;
      previewMode?.rerender?.(true);
    });

    for (const editorView of this.editorViews) {
      editorView.dispatch({ effects: loomRefreshEffect.of(undefined) });
    }
  }

  private normalizeSettings(): void {
    normalizeLanguageConfiguration(this.settings);
    this.settings.outputVisibleLines = normalizeNonNegativeInteger(this.settings.outputVisibleLines, DEFAULT_SETTINGS.outputVisibleLines, 2000);
    this.settings.defaultTimeoutMs = normalizePositiveInteger(this.settings.defaultTimeoutMs, DEFAULT_SETTINGS.defaultTimeoutMs);
    this.settings.defaultContainerGroup = normalizeStringSetting(this.settings.defaultContainerGroup, DEFAULT_SETTINGS.defaultContainerGroup);
    this.settings.workingDirectory = normalizeStringSetting(this.settings.workingDirectory, DEFAULT_SETTINGS.workingDirectory);
  }

  private getActiveMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ?? null;
  }

  private getCurrentEditorFilePath(): string | null {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }

  async enforceSourceModeForActiveView(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    await this.enforceSourceModeForLeaf(view.leaf);
  }

  async disableSourceModeForActiveView(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    const leaf = view.leaf;
    const viewState = leaf.getViewState();
    const state = { ...(viewState.state ?? {}) } as Record<string, unknown>;
    
    if (state.mode === "source" && state.source === true) {
      state.source = false;
      await leaf.setViewState({
        ...viewState,
        state,
      });
    }
  }

  private async enforceSourceModeForLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (!this.settings.preserveSourceMode) {
      return;
    }

    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) {
      return;
    }

    const source = view.editor?.getValue?.() ?? (await this.app.vault.cachedRead(view.file));
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!blocks.length) {
      return;
    }

    const viewState = leaf.getViewState();
    const state = { ...(viewState.state ?? {}) } as Record<string, unknown>;
    if (state.mode === "source" && state.source === true) {
      return;
    }

    state.mode = "source";
    state.source = true;

    await leaf.setViewState({
      ...viewState,
      state,
    });
  }

  private findActiveBlockById(blockId: string): loomCodeBlock | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      return this.outputs.get(blockId)?.block ?? null;
    }

    const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
    return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
  }

  private createLivePreviewExtension() {
    const plugin = this;

    return ViewPlugin.fromClass(
      class {
        decorations;

        constructor(private readonly view: EditorView) {
          plugin.editorViews.add(view);
          this.decorations = this.buildDecorations();
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(loomRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }

        destroy(): void {
          plugin.editorViews.delete(this.view);
        }

        private buildDecorations() {
          const filePath = plugin.getCurrentEditorFilePath();
          if (!filePath) {
            return Decoration.none;
          }

          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, plugin.settings);
          const builder = new RangeSetBuilder<Decoration>();

          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              Decoration.widget({
                widget: new loomToolbarWidget(plugin, block),
                side: -1,
              }),
            );

            if (plugin.outputs.has(block.id) || plugin.running.has(block.id) || plugin.shouldRenderStdinPanel(block)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                Decoration.widget({
                  widget: new loomOutputWidget(plugin, block),
                  side: 1,
                }),
              );
            }

            if (block.language === "llvm-ir") {
              addLlvmDecorations(builder, this.view, block);
            }
          }

          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations,
      },
    );
  }

  private hasExplicitExecutionContext(context: loomResolvedExecutionContext): boolean {
    return context.source.container !== "none" || context.source.workingDirectory !== "default" || context.source.timeout !== "global";
  }

  private formatExecutionContextNotice(context: loomResolvedExecutionContext): string {
    const pieces = [
      `container=${context.containerGroup ?? "native"} (${context.source.container})`,
      `cwd=${context.workingDirectory} (${context.source.workingDirectory})`,
      `timeout=${context.timeoutMs}ms (${context.source.timeout})`,
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }

  private getCustomLanguageExtractor(block: loomCodeBlock, file: TFile): { mode: "command" | "transpile-c"; language: string; executable: string; args: string[]; workingDirectory: string; timeoutMs: number } | undefined {
    const language = findEnabledCommandLanguage(this.settings, block.language, block.languageAlias);
    if (!language) {
      return undefined;
    }

    const mode = language.extractorMode || "command";
    const executable = mode === "transpile-c" ? language.transpileExecutable?.trim() : language.extractorExecutable?.trim();
    const args = mode === "transpile-c" ? language.transpileArgs || "{request}" : language.extractorArgs || "{request}";
    if (!executable) {
      return undefined;
    }

    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
    };
  }

  private async writeManagedOutputBlock(file: TFile, block: loomCodeBlock, result: loomStoredOutput["result"]): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);

      if (existingRange) {
        lines.splice(existingRange.start, existingRange.end - existingRange.start + 1, ...rendered);
        return lines.join("\n");
      }

      if (!currentBlock) {
        return content;
      }

      lines.splice(currentBlock.endLine + 1, 0, ...rendered);
      return lines.join("\n");
    });
  }

  private async writeOutputFileIfRequested(file: TFile, block: loomCodeBlock, result: loomStoredOutput["result"]): Promise<void> {
    try {
      const target = this.readOutputFileTarget(file, block);
      if (!target) {
        return;
      }

      await this.ensureVaultParentFolder(target.path);
      const rendered = target.format === "json"
        ? this.renderOutputFileJson(file, block, result, target)
        : this.renderOutputFileText(result, target);
      const current = target.mode === "append" && await this.app.vault.adapter.exists(target.path)
        ? await this.app.vault.adapter.read(target.path)
        : "";
      const next = target.mode === "append" && current
        ? `${current.replace(/\s*$/, "\n")}${rendered}`
        : rendered;
      await this.app.vault.adapter.write(target.path, next);

      const streamList = target.streams.join(",");
      const notice = `Wrote output file ${target.path} (${target.mode}, ${target.format}, ${streamList}).`;
      result.warning = result.warning ? `${notice}\n${result.warning}` : notice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = `Failed to write output file: ${message}`;
      result.warning = result.warning ? `${notice}\n${result.warning}` : notice;
    }
  }

  private readOutputFileTarget(file: TFile, block: loomCodeBlock): loomOutputFileTarget | null {
    const rawPath = block.attributes["loom-output-file"] ?? block.attributes["output-file"];
    if (!rawPath?.trim()) {
      return null;
    }

    return {
      path: this.resolveOutputVaultPath(file, rawPath),
      mode: this.readOutputFileMode(block),
      format: this.readOutputFileFormat(block),
      streams: this.readOutputFileStreams(block),
    };
  }

  private readOutputFileMode(block: loomCodeBlock): loomOutputFileMode {
    const append = block.attributes["loom-output-append"] ?? block.attributes["output-append"];
    if (append && !["0", "false", "no", "off"].includes(append.trim().toLowerCase())) {
      return "append";
    }

    const mode = (block.attributes["loom-output-file-mode"] ?? block.attributes["output-file-mode"] ?? "replace").trim().toLowerCase();
    if (mode === "append") {
      return "append";
    }
    if (mode === "replace") {
      return "replace";
    }
    throw new Error(`Unsupported loom-output-file-mode: ${mode}. Use replace or append.`);
  }

  private readOutputFileFormat(block: loomCodeBlock): loomOutputFileFormat {
    const format = (block.attributes["loom-output-file-format"] ?? block.attributes["output-file-format"] ?? "text").trim().toLowerCase();
    if (format === "text" || format === "json") {
      return format;
    }
    throw new Error(`Unsupported loom-output-file-format: ${format}. Use text or json.`);
  }

  private readOutputFileStreams(block: loomCodeBlock): loomOutputFileStream[] {
    const value = block.attributes["loom-output-file-streams"] ?? block.attributes["output-file-streams"] ?? "stdout";
    const parsed = value
      .split(",")
      .map((stream) => stream.trim().toLowerCase())
      .filter(Boolean);
    const expanded = parsed.includes("all")
      ? ["metadata", "stdout", "warning", "stderr"]
      : parsed;
    const streams = expanded.map((stream) => {
      if (stream === "stdout" || stream === "stderr" || stream === "warning" || stream === "metadata") {
        return stream;
      }
      throw new Error(`Unsupported loom-output-file-streams entry: ${stream}.`);
    });
    return streams.length ? [...new Set(streams)] : ["stdout"];
  }

  private resolveOutputVaultPath(file: TFile, rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      throw new Error("loom-output-file must be a vault-relative path.");
    }

    const path = trimmed.startsWith("/")
      ? normalizePath(trimmed.slice(1))
      : normalizePath(dirname(file.path) === "." ? trimmed : `${dirname(file.path)}/${trimmed}`);
    const parts = path.split("/").filter(Boolean);
    if (!parts.length || parts.includes("..") || path.startsWith(".obsidian/") || path === ".obsidian" || path.startsWith(".git/") || path === ".git") {
      throw new Error(`Invalid loom-output-file path: ${rawPath}`);
    }
    return path;
  }

  private async ensureVaultParentFolder(path: string): Promise<void> {
    const folder = dirname(path);
    if (!folder || folder === ".") {
      return;
    }

    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private renderOutputFileText(result: loomStoredOutput["result"], target: loomOutputFileTarget): string {
    const sections = target.streams.flatMap((stream) => {
      switch (stream) {
        case "metadata":
          return [
            `runner=${result.runnerName}`,
            `exit=${result.exitCode ?? "?"}`,
            `duration=${result.durationMs}ms`,
            `timestamp=${result.finishedAt}`,
          ].join("\n");
        case "stdout":
          return result.stdout ? [result.stdout] : [];
        case "warning":
          return result.warning ? [result.warning] : [];
        case "stderr":
          return result.stderr ? [result.stderr] : [];
      }
    });
    return `${sections.join("\n\n").replace(/\s*$/, "")}\n`;
  }

  private renderOutputFileJson(file: TFile, block: loomCodeBlock, result: loomStoredOutput["result"], target: loomOutputFileTarget): string {
    const payload = {
      note: file.path,
      blockId: block.id,
      language: block.language,
      runner: result.runnerName,
      exitCode: result.exitCode,
      success: result.success,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      streams: {
        ...(target.streams.includes("stdout") ? { stdout: result.stdout } : {}),
        ...(target.streams.includes("warning") ? { warning: result.warning ?? "" } : {}),
        ...(target.streams.includes("stderr") ? { stderr: result.stderr } : {}),
      },
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  private async removeManagedOutputBlock(filePath: string, blockId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const range = this.findManagedOutputRange(lines, blockId);
      if (!range) {
        return content;
      }
      lines.splice(range.start, range.end - range.start + 1);
      return lines.join("\n");
    });
  }

  private renderManagedOutputMarkdown(blockId: string, result: loomStoredOutput["result"]): string[] {
    const body = [
      `runner=${result.runnerName}`,
      `exit=${result.exitCode ?? "?"}`,
      `duration=${result.durationMs}ms`,
      `timestamp=${result.finishedAt}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.warning ? `warning:\n${result.warning}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return [
      `<!-- loom:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- loom:output:end -->",
    ];
  }

  private findManagedOutputRange(lines: string[], blockId: string): { start: number; end: number } | null {
    const startMarker = `<!-- loom:output:start id=${blockId} -->`;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== startMarker) {
        continue;
      }

      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "<!-- loom:output:end -->") {
          return { start: i, end: j };
        }
      }
    }
    return null;
  }

  shouldRenderStdinPanel(block: loomCodeBlock): boolean {
    return this.stdinPanels.has(block.id) || this.hasEnabledStdinAttribute(block);
  }

  private hasEnabledStdinAttribute(block: loomCodeBlock): boolean {
    const input = block.attributes["loom-input"] ?? block.attributes.input;
    if (input && !["0", "false", "no", "off"].includes(input.trim().toLowerCase())) {
      return true;
    }
    return block.attributes["loom-stdin"] != null ||
      block.attributes.stdin != null ||
      block.attributes["loom-stdin-file"] != null ||
      block.attributes["stdin-file"] != null;
  }

  private createStdinPanel(block: loomCodeBlock): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "loom-stdin-panel";

    const header = panel.createDiv({ cls: "loom-stdin-header" });
    header.createSpan({ text: "stdin" });
    const actions = header.createDiv({ cls: "loom-stdin-actions" });
    const runButton = actions.createEl("button", { text: "Run" });
    const clearButton = actions.createEl("button", { text: "Clear" });

    const textarea = panel.createEl("textarea", { cls: "loom-stdin-input" });
    textarea.placeholder = this.getStdinPlaceholder(block);
    textarea.value = this.stdinInputs.get(block.id) ?? block.attributes["loom-stdin"] ?? block.attributes.stdin ?? "";
    textarea.addEventListener("input", () => {
      this.stdinInputs.set(block.id, textarea.value);
    });
    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stdinInputs.set(block.id, textarea.value);
      void this.runActiveBlockById(block.id);
    });
    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      textarea.value = "";
      this.stdinInputs.set(block.id, "");
    });

    return panel;
  }

  private getStdinPlaceholder(block: loomCodeBlock): string {
    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    return stdinFile ? `stdin file: ${stdinFile}` : "standard input for this block";
  }

  private async resolveBlockStdin(file: TFile, block: loomCodeBlock): Promise<string | undefined> {
    if (this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id);
    }

    const inline = block.attributes["loom-stdin"] ?? block.attributes.stdin;
    if (inline != null) {
      return decodeEscapedAttribute(inline);
    }

    const stdinFile = block.attributes["loom-stdin-file"] ?? block.attributes["stdin-file"];
    if (!stdinFile?.trim()) {
      return undefined;
    }

    const stdinPath = this.resolveReferencedVaultPath(file, stdinFile);
    const inputFile = this.app.vault.getAbstractFileByPath(stdinPath);
    if (!(inputFile instanceof TFile)) {
      throw new Error(`stdin file not found: ${stdinPath}`);
    }
    return this.app.vault.cachedRead(inputFile);
  }
}

function decodeEscapedAttribute(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function parseExternalLanguagePack(value: unknown, filePath: string): loomExternalLanguagePack | null {
  if (!isRecord(value)) {
    console.warn(`Ignoring loom language pack ${filePath}: manifest must be an object`);
    return null;
  }

  const rawId = readString(value.id);
  const id = normalizeManifestId(rawId);
  if (!id) {
    console.warn(`Ignoring loom language pack ${filePath}: missing package id`);
    return null;
  }
  if (!Array.isArray(value.languages)) {
    console.warn(`Ignoring loom language pack ${filePath}: languages must be an array`);
    return null;
  }

  const languages = value.languages
    .map((language) => parseExternalLanguage(language, filePath))
    .filter((language): language is loomExternalLanguage => Boolean(language));
  if (!languages.length) {
    console.warn(`Ignoring loom language pack ${filePath}: no valid languages`);
    return null;
  }

  return {
    id: `external:${id}`,
    displayName: readString(value.displayName) || rawId,
    description: readString(value.description) || `External language pack from ${filePath}`,
    languages,
  };
}

function parseExternalLanguage(value: unknown, filePath: string): loomExternalLanguage | null {
  if (!isRecord(value)) {
    console.warn(`Ignoring language entry in ${filePath}: entry must be an object`);
    return null;
  }

  const rawName = readString(value.id) || readString(value.name);
  const name = normalizeManifestId(rawName);
  const executable = readString(value.executable);
  if (!name || !executable) {
    console.warn(`Ignoring language entry in ${filePath}: language id/name and executable are required`);
    return null;
  }

  return {
    name,
    displayName: readString(value.displayName) || rawName,
    description: readString(value.description),
    aliases: readAliasList(value.aliases, name).join(", "),
    executable,
    args: readString(value.args) || "{file}",
    extension: normalizeExtension(readString(value.extension), name),
    extractorMode: readString(value.extractorMode) === "transpile-c" ? "transpile-c" : "command",
    extractorExecutable: readString(value.extractorExecutable),
    extractorArgs: readString(value.extractorArgs) || "{request}",
    transpileExecutable: readString(value.transpileExecutable),
    transpileArgs: readString(value.transpileArgs) || "{request}",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readAliasList(value: unknown, name: string): string[] {
  const aliases = Array.isArray(value)
    ? value.flatMap((alias) => readString(alias).split(","))
    : readString(value).split(",");
  return aliases
    .map((alias) => normalizeManifestId(alias))
    .filter((alias, index, list) => Boolean(alias) && alias !== name && list.indexOf(alias) === index);
}

function normalizeManifestId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeExtension(value: string, name: string): string {
  if (!value) {
    return `.${name}`;
  }
  return value.startsWith(".") ? value : `.${value}`;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function normalizeStringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
