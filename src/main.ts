import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { dirname } from "path";
import { loomContainerRunner } from "./execution/containerRunner";
import { addLlvmDecorations, highlightLlvmElement } from "./llvmHighlight";
import { findBlockAtLine, getSupportedLanguageAliases, parseMarkdownCodeBlocks } from "./parser";
import { NodeRunner } from "./runners/node";
import { CustomLanguageRunner } from "./runners/custom";
import { InterpretedRunner } from "./runners/interpreted";
import { LlvmRunner } from "./runners/llvm";
import { ManagedCompiledRunner } from "./runners/managedCompiled";
import { NativeCompiledRunner } from "./runners/nativeCompiled";
import { OcamlRunner } from "./runners/ocaml";
import { PythonRunner } from "./runners/python";
import { ProofRunner } from "./runners/proof";
import { loomRunnerRegistry } from "./runners/registry";
import { DEFAULT_SETTINGS, loomSettingTab, showExecutionDisabledNotice } from "./settings";
import { createCodeBlockToolbar } from "./ui/codeBlockToolbar";
import { createOutputPanel, createRunningPanel } from "./ui/outputPanel";
import type { loomCodeBlock, loomPluginSettings, loomStoredOutput } from "./types";

const loomRefreshEffect = StateEffect.define<void>();

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

    this.plugin.renderOutputInto(this.block.id, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block.id, this.panelContainer);
      }
    });
  }

  onunload(): void {
    this.unregisterOutputListener?.();
  }
}

class loomToolbarWidget extends WidgetType {
  constructor(
    private readonly plugin: loomPlugin,
    private readonly block: loomCodeBlock,
  ) {
    super();
  }

  eq(other: loomToolbarWidget): boolean {
    return other.block.id === this.block.id && other.plugin.isBlockRunning(this.block.id) === this.plugin.isBlockRunning(this.block.id);
  }

  toDOM(): HTMLElement {
    return this.plugin.createToolbarElement(this.block);
  }
}

class loomOutputWidget extends WidgetType {
  constructor(
    private readonly plugin: loomPlugin,
    private readonly blockId: string,
  ) {
    super();
  }

  eq(other: loomOutputWidget): boolean {
    return false;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.blockId, wrapper);
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
    new LlvmRunner(),
    new ProofRunner(),
    new CustomLanguageRunner(),
  ]);
  private readonly containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
  private readonly registeredCodeBlockAliases = new Set<string>();
  private readonly outputs = new Map<string, loomStoredOutput>();
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
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

  renderOutputInto(blockId: string, container: HTMLElement): void {
    container.empty();

    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }

    if (!output || !output.visible) {
      return;
    }

    container.appendChild(createOutputPanel(output));
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
    const containerGroup = this.containerRunner.getContainerGroupName(file);
    const supportedBlocks = containerGroup ? blocks : blocks.filter((block) => this.registry.getRunnerForBlock(block, this.settings));

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

    const workingDirectory = this.resolveWorkingDirectory(file);
    const containerGroup = this.containerRunner.getContainerGroupName(file);
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }

    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory,
      timeoutMs: this.settings.defaultTimeoutMs,
      signal: controller.signal,
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();

    try {
      const result = containerGroup
        ? await this.containerRunner.run(block, runContext, this.settings, containerGroup)
        : await runner!.run(block, runContext, this.settings);

      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }

      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
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

  private resolveWorkingDirectory(file: TFile): string {
    if (this.settings.workingDirectory.trim()) {
      return this.settings.workingDirectory.trim();
    }

    const adapterBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    const fileFolder = dirname(file.path);
    const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
    return resolved || process.cwd();
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

            if (plugin.outputs.has(block.id) || plugin.running.has(block.id)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                Decoration.widget({
                  widget: new loomOutputWidget(plugin, block.id),
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
}
