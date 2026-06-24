"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const state_1 = require("@codemirror/state");
const view_1 = require("@codemirror/view");
const path_1 = require("path");
const parser_1 = require("./parser");
const node_1 = require("./runners/node");
const ocaml_1 = require("./runners/ocaml");
const python_1 = require("./runners/python");
const registry_1 = require("./runners/registry");
const settings_1 = require("./settings");
const codeBlockToolbar_1 = require("./ui/codeBlockToolbar");
const outputPanel_1 = require("./ui/outputPanel");
const lotusRefreshEffect = state_1.StateEffect.define();
class ExecutionConsentModal extends obsidian_1.Modal {
    constructor(app, onConfirm) {
        super(app);
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Enable Lotus local execution?" });
        contentEl.createEl("p", {
            text: "Lotus runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process.",
        });
        const actions = contentEl.createDiv({ cls: "lotus-modal-actions" });
        const cancelButton = actions.createEl("button", { text: "Cancel" });
        const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });
        cancelButton.addEventListener("click", () => this.close());
        enableButton.addEventListener("click", async () => {
            await this.onConfirm();
            this.close();
        });
    }
}
class LotusToolbarRenderChild extends obsidian_1.MarkdownRenderChild {
    constructor(containerEl, plugin, block, codeElement) {
        super(containerEl);
        this.plugin = plugin;
        this.block = block;
        this.codeElement = codeElement;
        this.panelContainer = null;
        this.unregisterOutputListener = null;
    }
    onload() {
        this.codeElement.parentElement?.addClass("lotus-codeblock-shell");
        this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));
        this.panelContainer = this.containerEl.createDiv({ cls: "lotus-inline-output-host" });
        this.plugin.renderOutputInto(this.block.id, this.panelContainer);
        this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
            if (this.panelContainer) {
                this.plugin.renderOutputInto(this.block.id, this.panelContainer);
            }
        });
    }
    onunload() {
        this.unregisterOutputListener?.();
    }
}
class LotusToolbarWidget extends view_1.WidgetType {
    constructor(plugin, block) {
        super();
        this.plugin = plugin;
        this.block = block;
    }
    eq(other) {
        return other.block.id === this.block.id && other.plugin.isBlockRunning(this.block.id) === this.plugin.isBlockRunning(this.block.id);
    }
    toDOM() {
        return this.plugin.createToolbarElement(this.block);
    }
}
class LotusOutputWidget extends view_1.WidgetType {
    constructor(plugin, blockId) {
        super();
        this.plugin = plugin;
        this.blockId = blockId;
    }
    eq(other) {
        return other.blockId === this.blockId;
    }
    toDOM() {
        const wrapper = document.createElement("div");
        wrapper.className = "lotus-inline-output-host";
        this.plugin.renderOutputInto(this.blockId, wrapper);
        return wrapper;
    }
}
class LotusPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = settings_1.DEFAULT_SETTINGS;
        this.registry = new registry_1.LotusRunnerRegistry([new python_1.PythonRunner(), new node_1.NodeRunner(), new ocaml_1.OcamlRunner()]);
        this.outputs = new Map();
        this.running = new Map();
        this.outputListeners = new Map();
        this.editorViews = new Set();
    }
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new settings_1.LotusSettingTab(this));
        this.statusBarItemEl = this.addStatusBarItem();
        this.updateStatusBar();
        this.addCommand({
            id: "lotus-run-current-code-block",
            name: "lotus: run current code block",
            editorCallback: async (editor, view) => {
                const file = view.file;
                if (!file) {
                    return;
                }
                const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, editor.getValue());
                const block = (0, parser_1.findBlockAtLine)(blocks, editor.getCursor().line);
                if (!block) {
                    new obsidian_1.Notice("No supported Lotus block at the current cursor.");
                    return;
                }
                await this.runBlock(file, block);
            },
        });
        this.addCommand({
            id: "lotus-run-all-code-blocks",
            name: "lotus: run all supported code blocks in current note",
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
            id: "lotus-clear-note-outputs",
            name: "lotus: clear Lotus outputs in current note",
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
        for (const alias of (0, parser_1.getSupportedLanguageAliases)()) {
            this.registerMarkdownCodeBlockProcessor(alias, async (source, el, ctx) => {
                const filePath = ctx.sourcePath;
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (!(file instanceof obsidian_1.TFile)) {
                    return;
                }
                const fullText = await this.app.vault.cachedRead(file);
                const blocks = (0, parser_1.parseMarkdownCodeBlocks)(filePath, fullText);
                const section = ctx.getSectionInfo(el);
                const lineStart = section?.lineStart ?? -1;
                const block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
                if (!block) {
                    return;
                }
                const pre = el.querySelector("pre") ?? el;
                ctx.addChild(new LotusToolbarRenderChild(el, this, block, pre));
            });
        }
        this.registerEditorExtension(this.createLivePreviewExtension());
        this.registerEvent(this.app.workspace.on("file-open", (file) => {
            this.refreshAllViews();
            if (file && this.settings.autoRunOnFileOpen) {
                void this.runAllBlocksInFile(file);
            }
        }));
    }
    onunload() {
        for (const controller of this.running.values()) {
            controller.abort();
        }
    }
    async loadSettings() {
        this.settings = {
            ...settings_1.DEFAULT_SETTINGS,
            ...(await this.loadData()),
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
        this.refreshAllViews();
    }
    isBlockRunning(blockId) {
        return this.running.has(blockId);
    }
    registerOutputListener(blockId, listener) {
        if (!this.outputListeners.has(blockId)) {
            this.outputListeners.set(blockId, new Set());
        }
        this.outputListeners.get(blockId)?.add(listener);
        return () => {
            this.outputListeners.get(blockId)?.delete(listener);
        };
    }
    createToolbarElement(block) {
        return (0, codeBlockToolbar_1.createCodeBlockToolbar)(block.id, this.isBlockRunning(block.id), {
            onRun: () => void this.runActiveBlockById(block.id),
            onCopy: async () => {
                try {
                    await navigator.clipboard.writeText(block.content);
                    new obsidian_1.Notice("Code copied");
                }
                catch {
                    new obsidian_1.Notice("Clipboard write failed.");
                }
            },
            onClear: () => {
                this.outputs.delete(block.id);
                void this.removeManagedOutputBlock(block.filePath, block.id);
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
    renderOutputInto(blockId, container) {
        container.empty();
        const output = this.outputs.get(blockId);
        if (this.running.has(blockId)) {
            const block = output?.block ?? this.findActiveBlockById(blockId);
            const runner = block ? this.registry.getRunnerForBlock(block, this.settings) : null;
            container.appendChild((0, outputPanel_1.createRunningPanel)(runner?.displayName ?? "configured runner"));
            return;
        }
        if (!output || !output.visible) {
            return;
        }
        container.appendChild((0, outputPanel_1.createOutputPanel)(output));
    }
    async runActiveBlockById(blockId) {
        const block = this.findActiveBlockById(blockId);
        const file = this.getActiveMarkdownFile();
        if (!block || !file) {
            return;
        }
        await this.runBlock(file, block);
    }
    async runAllBlocksInFile(file) {
        const source = await this.app.vault.cachedRead(file);
        const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, source);
        const supportedBlocks = blocks.filter((block) => this.registry.getRunnerForBlock(block, this.settings));
        if (!supportedBlocks.length) {
            new obsidian_1.Notice("No supported Lotus blocks found in the current note.");
            return;
        }
        for (const block of supportedBlocks) {
            await this.runBlock(file, block);
        }
    }
    async clearOutputsForFile(file) {
        const source = await this.app.vault.cachedRead(file);
        const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, source);
        for (const block of blocks) {
            this.outputs.delete(block.id);
            this.notifyOutputChanged(block.id);
            await this.removeManagedOutputBlock(file.path, block.id);
        }
        new obsidian_1.Notice("Lotus outputs cleared.");
    }
    async runBlock(file, block) {
        if (this.running.has(block.id)) {
            new obsidian_1.Notice("This Lotus block is already running.");
            return;
        }
        if (!(await this.ensureExecutionEnabled())) {
            (0, settings_1.showExecutionDisabledNotice)();
            return;
        }
        const runner = this.registry.getRunnerForBlock(block, this.settings);
        if (!runner) {
            new obsidian_1.Notice(`No configured runner for ${block.language}.`);
            return;
        }
        const controller = new AbortController();
        this.running.set(block.id, controller);
        this.notifyOutputChanged(block.id);
        this.updateStatusBar();
        try {
            const workingDirectory = this.resolveWorkingDirectory(file);
            const result = await runner.run(block, {
                file,
                workingDirectory,
                timeoutMs: this.settings.defaultTimeoutMs,
                signal: controller.signal,
            }, this.settings);
            if (result.timedOut) {
                result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
            }
            else if (result.cancelled) {
                result.stderr = result.stderr || "Execution cancelled.";
            }
            else if (!result.success && !result.stderr.trim()) {
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
            new obsidian_1.Notice(result.success ? `Lotus ran ${runner.displayName} block.` : `Lotus run failed for ${runner.displayName}.`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputs.set(block.id, {
                blockId: block.id,
                block,
                collapsed: false,
                visible: true,
                result: {
                    runnerId: runner.id,
                    runnerName: runner.displayName,
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
            new obsidian_1.Notice(`Lotus error: ${message}`);
        }
        finally {
            this.running.delete(block.id);
            this.notifyOutputChanged(block.id);
            this.updateStatusBar();
        }
    }
    async ensureExecutionEnabled() {
        if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
            return true;
        }
        return await new Promise((resolve) => {
            let settled = false;
            const settle = (value) => {
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
    resolveWorkingDirectory(file) {
        if (this.settings.workingDirectory.trim()) {
            return this.settings.workingDirectory.trim();
        }
        const adapterBasePath = this.app.vault.adapter.basePath ?? "";
        const fileFolder = (0, path_1.dirname)(file.path);
        const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
        return resolved || process.cwd();
    }
    updateStatusBar() {
        const activeRuns = this.running.size;
        this.statusBarItemEl.setText(activeRuns ? `Lotus: ${activeRuns} active run${activeRuns === 1 ? "" : "s"}` : "Lotus: idle");
    }
    notifyOutputChanged(blockId) {
        this.outputListeners.get(blockId)?.forEach((listener) => listener());
        this.refreshAllViews();
    }
    refreshAllViews() {
        this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
            const view = leaf.view;
            const previewMode = view.previewMode;
            previewMode?.rerender?.(true);
        });
        for (const editorView of this.editorViews) {
            editorView.dispatch({ effects: lotusRefreshEffect.of(undefined) });
        }
    }
    getActiveMarkdownFile() {
        const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        return view?.file ?? null;
    }
    findActiveBlockById(blockId) {
        const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
        const file = view?.file;
        const editor = view?.editor;
        if (!file || !editor) {
            return this.outputs.get(blockId)?.block ?? null;
        }
        const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, editor.getValue());
        return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
    }
    createLivePreviewExtension() {
        const plugin = this;
        return view_1.ViewPlugin.fromClass(class {
            constructor(view) {
                this.view = view;
                plugin.editorViews.add(view);
                this.decorations = this.buildDecorations();
            }
            update(update) {
                if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(lotusRefreshEffect)))) {
                    this.decorations = this.buildDecorations();
                }
            }
            destroy() {
                plugin.editorViews.delete(this.view);
            }
            buildDecorations() {
                const markdownView = plugin.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
                const file = markdownView?.file;
                if (!file) {
                    return view_1.Decoration.none;
                }
                const mode = markdownView.getMode?.();
                if (mode === "source") {
                    return view_1.Decoration.none;
                }
                const source = this.view.state.doc.toString();
                const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, source);
                const builder = new state_1.RangeSetBuilder();
                for (const block of blocks) {
                    const startLine = this.view.state.doc.line(block.startLine + 1);
                    builder.add(startLine.from, startLine.from, view_1.Decoration.widget({
                        widget: new LotusToolbarWidget(plugin, block),
                        side: -1,
                    }));
                    if (plugin.outputs.has(block.id) || plugin.running.has(block.id)) {
                        const endLine = this.view.state.doc.line(block.endLine + 1);
                        builder.add(endLine.to, endLine.to, view_1.Decoration.widget({
                            widget: new LotusOutputWidget(plugin, block.id),
                            side: 1,
                            block: true,
                        }));
                    }
                }
                return builder.finish();
            }
        }, {
            decorations: (value) => value.decorations,
        });
    }
    async writeManagedOutputBlock(file, block, result) {
        await this.app.vault.process(file, (content) => {
            const lines = content.split(/\r?\n/);
            const blocks = (0, parser_1.parseMarkdownCodeBlocks)(file.path, content);
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
    async removeManagedOutputBlock(filePath, blockId) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof obsidian_1.TFile)) {
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
    renderManagedOutputMarkdown(blockId, result) {
        const body = [
            `runner=${result.runnerName}`,
            `exit=${result.exitCode ?? "?"}`,
            `duration=${result.durationMs}ms`,
            `timestamp=${result.finishedAt}`,
            result.stdout ? `stdout:\n${result.stdout}` : "",
            result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
            .filter(Boolean)
            .join("\n\n");
        return [
            `<!-- lotus:output:start id=${blockId} -->`,
            "```text",
            body,
            "```",
            "<!-- lotus:output:end -->",
        ];
    }
    findManagedOutputRange(lines, blockId) {
        const startMarker = `<!-- lotus:output:start id=${blockId} -->`;
        for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].trim() !== startMarker) {
                continue;
            }
            for (let j = i + 1; j < lines.length; j += 1) {
                if (lines[j].trim() === "<!-- lotus:output:end -->") {
                    return { start: i, end: j };
                }
            }
        }
        return null;
    }
}
exports.default = LotusPlugin;
