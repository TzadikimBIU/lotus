import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  Setting,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  parseYaml,
  type DataAdapter,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import JSZip from "jszip";
import { dirname } from "path";
import { lotusContainerRunner } from "./execution/containerRunner";
import { isCompileContainerGroupAllowed, isCompileFeatureAllowed } from "./buildProfile";
import { resolveExecutionContext as resolveLotusExecutionContext } from "./executionContext";
import { addLlvmDecorations } from "./llvmHighlight";
import { lotusLogger, type lotusLogInput, type lotusLogTarget } from "./logging";
import { findBlockAtLine, normalizeLanguage, parseMarkdownCodeBlocks } from "./parser";
import { getLanguageCapability } from "./languageCapabilities";
import { findEnabledCommandLanguage, normalizeLanguageConfiguration } from "./languagePackages";
import { NodeRunner } from "./runners/node";
import { ObsidianContextRunner } from "./runners/obsidianContext";
import { CustomLanguageRunner } from "./runners/custom";
import { InterpretedRunner } from "./runners/interpreted";
import { EbpfRunner } from "./runners/ebpf";
import { LlvmRunner } from "./runners/llvm";
import { ManagedCompiledRunner } from "./runners/managedCompiled";
import { NativeCompiledRunner } from "./runners/nativeCompiled";
import { OcamlRunner } from "./runners/ocaml";
import { PythonRunner } from "./runners/python";
import { ProofRunner } from "./runners/proof";
import { lotusRunnerRegistry } from "./runners/registry";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import { lotusSettingTab, showExecutionDisabledNotice } from "./settings";
import { resolveReferencedSource } from "./sourceExtract";
import { buildSourceReferenceHarness } from "./sourceHarness";
import { createCodeBlockToolbar } from "./ui/codeBlockToolbar";
import { createOutputPanel, createRunningPanel } from "./ui/outputPanel";
import { splitCommandLine } from "./utils/command";
import { sha256Hash } from "./utils/hash";
import type { lotusCodeBlock, lotusExternalLanguage, lotusExternalLanguagePack, lotusPluginSettings, lotusResolvedExecutionContext, lotusStoredOutput } from "./types";

const lotusRefreshEffect = StateEffect.define<void>();
const EXTERNAL_LANGUAGE_PACK_DIR = "language-packs";
const LANGUAGE_PACK_MANIFEST_NAMES = new Set(["lotus-language-pack.json", "language-pack.json", "manifest.json"]);
const NOTE_HASH_FRONTMATTER_KEY = "lotus-note-hash";
const CODE_BLOCK_HASHES_FRONTMATTER_KEY = "lotus-code-block-hashes";
const LOTUS_HASH_FRONTMATTER_KEYS = new Set([NOTE_HASH_FRONTMATTER_KEY, CODE_BLOCK_HASHES_FRONTMATTER_KEY]);
const REPRODUCIBILITY_FRONTMATTER_KEY = "lotus-reproducibility";
const HASH_POLICY_FRONTMATTER_KEY = "lotus-hash-policy";
const HASH_IGNORE_FRONTMATTER_KEY = "lotus-hash-ignore-frontmatter";
const HASH_IGNORE_BLOCK_ATTRIBUTES_KEY = "lotus-hash-ignore-block-attributes";
const REPRODUCIBILITY_SNAPSHOT_VERSION = 1;
const SUPPORTED_PDF_EXPORT_MODES = new Set<lotusPluginSettings["pdfExportMode"]>(["both", "code", "output"]);
const SUPPORTED_LOGGING_NOTE_PATH_MODES = new Set<lotusPluginSettings["loggingNotePathMode"]>(["plain", "hash", "omit"]);
type lotusOutputFileMode = "replace" | "append";
type lotusOutputFileFormat = "text" | "json";
type lotusOutputFileStream = "stdout" | "stderr" | "warning" | "metadata";
type lotusHashPolicyPreset = "strict" | "runtime-flexible" | "runtime-inputs" | "runtime-inputs-outputs" | "custom";
type lotusReproducibilityStatus = "verified" | "changed" | "missing-snapshot";

interface lotusHashPolicy {
  preset: lotusHashPolicyPreset;
  ignoreFrontmatter: string[];
  ignoreBlockAttributes: string[];
}

interface lotusHashPolicyPresetDefinition {
  id: Exclude<lotusHashPolicyPreset, "custom">;
  label: string;
  description: string;
  ignoreFrontmatter: string[];
  ignoreBlockAttributes: string[];
}

interface lotusCodeBlockHashEntry {
  id: string;
  ordinal: number;
  language: string;
  alias: string;
  hash: string;
  startLine: number;
  endLine: number;
}

interface lotusReproducibilityVerification {
  status: lotusReproducibilityStatus;
  checkedAt: string;
  summary: string;
  issues: string[];
  note: {
    status: "verified" | "changed" | "missing";
    storedHash: string;
    currentHash: string;
  };
  blocks: {
    verified: number;
    total: number;
    issues: string[];
  };
}

interface lotusReproducibilitySnapshot {
  version: number;
  updatedAt: string;
  noteHash: string;
  policy: ReturnType<typeof serializeHashPolicy>;
  blocks: lotusCodeBlockHashEntry[];
  verification?: lotusReproducibilityVerification;
}

interface lotusOutputFileTarget {
  path: string;
  mode: lotusOutputFileMode;
  format: lotusOutputFileFormat;
  streams: lotusOutputFileStream[];
}

interface lotusArchiveEntry {
  path: string;
  data: Uint8Array;
}

const HASH_POLICY_PRESETS: lotusHashPolicyPresetDefinition[] = [
  {
    id: "strict",
    label: "Strict",
    description: "Any note, execution, input, or output metadata change invalidates the snapshot.",
    ignoreFrontmatter: [],
    ignoreBlockAttributes: [],
  },
  {
    id: "runtime-flexible",
    label: "Runtime Flexible",
    description: "Allow execution target, working directory, and timeout changes while locking code and prose.",
    ignoreFrontmatter: ["lotus-execution", "lotus-container", "lotus-cwd", "lotus-working-directory", "lotus-timeout"],
    ignoreBlockAttributes: ["lotus-execution", "execution", "lotus-container", "container", "lotus-cwd", "cwd", "working-directory", "lotus-timeout", "timeout"],
  },
  {
    id: "runtime-inputs",
    label: "Runtime + Inputs",
    description: "Allow runtime fields plus stdin/input wiring changes.",
    ignoreFrontmatter: ["lotus-execution", "lotus-container", "lotus-cwd", "lotus-working-directory", "lotus-timeout"],
    ignoreBlockAttributes: ["lotus-execution", "execution", "lotus-container", "container", "lotus-cwd", "cwd", "working-directory", "lotus-timeout", "timeout", "lotus-stdin", "stdin", "lotus-stdin-file", "stdin-file", "lotus-input", "input"],
  },
  {
    id: "runtime-inputs-outputs",
    label: "Runtime + Inputs + Outputs",
    description: "Allow runtime, stdin/input, and output destination plumbing changes.",
    ignoreFrontmatter: ["lotus-execution", "lotus-container", "lotus-cwd", "lotus-working-directory", "lotus-timeout"],
    ignoreBlockAttributes: ["lotus-execution", "execution", "lotus-container", "container", "lotus-cwd", "cwd", "working-directory", "lotus-timeout", "timeout", "lotus-stdin", "stdin", "lotus-stdin-file", "stdin-file", "lotus-input", "input", "lotus-output-file", "output-file", "lotus-output-file-mode", "output-file-mode", "lotus-output-file-format", "output-file-format", "lotus-output-file-streams", "output-file-streams", "lotus-output-append", "output-append", "lotus-output-lines", "output-lines"],
  },
];

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
    contentEl.createEl("h2", { text: "Enable lotus local execution?" });
    contentEl.createEl("p", {
      text: "lotus runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process.",
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

class ReproducibilityPolicyModal extends Modal {
  private selectedPreset: Exclude<lotusHashPolicyPreset, "custom">;
  private descriptionEl: HTMLElement | null = null;

  constructor(
    app: Plugin["app"],
    currentPolicy: lotusHashPolicy,
    private readonly onChoose: (preset: Exclude<lotusHashPolicyPreset, "custom">) => Promise<void>,
  ) {
    super(app);
    this.selectedPreset = currentPolicy.preset === "custom" ? "runtime-flexible" : currentPolicy.preset;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Lotus Reproducibility Policy" });
    contentEl.createEl("p", {
      text: "Choose what may change without invalidating a saved reproducibility snapshot.",
    });

    this.descriptionEl = contentEl.createEl("p", { cls: "setting-item-description" });

    new Setting(contentEl)
      .setName("Policy preset")
      .setDesc("Strict locks everything. Flexible presets allow selected execution plumbing to vary.")
      .addDropdown((dropdown) => {
        for (const preset of HASH_POLICY_PRESETS) {
          dropdown.addOption(preset.id, preset.label);
        }
        dropdown.setValue(this.selectedPreset);
        dropdown.onChange((value) => {
          this.selectedPreset = value as Exclude<lotusHashPolicyPreset, "custom">;
          this.renderPresetDescription();
        });
      });

    const actions = contentEl.createDiv({ cls: "lotus-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const applyButton = actions.createEl("button", { text: "Apply policy", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    applyButton.addEventListener("click", async () => {
      await this.onChoose(this.selectedPreset);
      this.close();
    });

    this.renderPresetDescription();
  }

  private renderPresetDescription(): void {
    const preset = getHashPolicyPresetDefinition(this.selectedPreset);
    if (this.descriptionEl) {
      this.descriptionEl.setText(preset.description);
    }
  }
}

class lotusToolbarRenderChild extends MarkdownRenderChild {
  private panelContainer: HTMLDivElement | null = null;
  private toolbarElement: HTMLElement | null = null;
  private unregisterOutputListener: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: lotusPlugin,
    private readonly block: lotusCodeBlock,
    private readonly codeElement: HTMLElement,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.codeElement.classList.add("lotus-codeblock-shell");
    this.toolbarElement = this.plugin.createToolbarElement(this.block);
    this.codeElement.appendChild(this.toolbarElement);

    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("lotus-print-hide-code");
    }

    const hostClasses = ["lotus-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("lotus-print-hide-output");
    }
    this.panelContainer = document.createElement("div");
    this.panelContainer.className = hostClasses.join(" ");
    this.codeElement.insertAdjacentElement("afterend", this.panelContainer);

    this.plugin.renderOutputInto(this.block, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block, this.panelContainer);
      }
    });
  }

  onunload(): void {
    this.unregisterOutputListener?.();
    this.panelContainer?.remove();
    this.toolbarElement?.remove();
  }
}

class lotusToolbarWidget extends WidgetType {
  private readonly isRunning: boolean;

  constructor(
    private readonly plugin: lotusPlugin,
    private readonly block: lotusCodeBlock,
  ) {
    super();
    this.isRunning = plugin.isBlockRunning(block.id);
  }

  eq(other: lotusToolbarWidget): boolean {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
  }

  toDOM(): HTMLElement {
    return this.plugin.createToolbarElement(this.block);
  }
}

class lotusOutputWidget extends WidgetType {
  constructor(
    private readonly plugin: lotusPlugin,
    private readonly block: lotusCodeBlock,
  ) {
    super();
  }

  eq(other: lotusOutputWidget): boolean {
    return false;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "lotus-inline-output-host";
    this.plugin.renderOutputInto(this.block, wrapper);
    return wrapper;
  }
}

export default class lotusPlugin extends Plugin {
  settings: lotusPluginSettings = DEFAULT_SETTINGS;
  readonly registry = new lotusRunnerRegistry([
    new PythonRunner(),
    new NodeRunner(),
    new ObsidianContextRunner({ app: this.app, plugin: this }),
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
  public readonly containerRunner = new lotusContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/lotus");
  private hasRegisteredMarkdownDecorator = false;
  private readonly outputs = new Map<string, lotusStoredOutput>();
  private readonly stdinInputs = new Map<string, string>();
  private readonly stdinPanels = new Set<string>();
  private readonly running = new Map<string, AbortController>();
  private readonly outputListeners = new Map<string, Set<() => void>>();
  private statusBarItemEl!: HTMLElement;
  private editorViews = new Set<EditorView>();
  private lastMarkdownFilePath: string | null = null;
  private readonly logger = new lotusLogger(this.app, () => this.settings);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new lotusSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });

    this.addCommand({
      id: "lotus-run-current-code-block",
      name: "lotus: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }

        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new Notice("No supported lotus block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      },
    });

    this.addCommand({
      id: "lotus-run-all-code-blocks",
      name: "lotus: Run All Supported Code Blocks in Current Note",
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
      id: "lotus-cancel-current-code-block",
      name: "lotus: Cancel Current Code Block Run",
      editorCheckCallback: (checking, editor, view) => {
        const file = view.file;
        if (!file) {
          return false;
        }
        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block || !this.running.has(block.id)) {
          return false;
        }
        if (!checking) {
          void this.cancelBlockRun(block.id, "current block", block, file.path);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-cancel-all-code-blocks",
      name: "lotus: Cancel All Running Code Blocks",
      checkCallback: (checking) => {
        if (!this.running.size) {
          return false;
        }
        if (!checking) {
          void this.cancelAllRuns();
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-clear-note-outputs",
      name: "lotus: Clear lotus Outputs in Current Note",
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

    this.addCommand({
      id: "lotus-save-reproducibility-snapshot",
      name: "lotus: Save Reproducibility Snapshot",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.saveReproducibilitySnapshot(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-verify-reproducibility-snapshot",
      name: "lotus: Verify Reproducibility Snapshot",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.verifyReproducibilitySnapshot(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-set-reproducibility-policy",
      name: "lotus: Set Reproducibility Policy",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.openReproducibilityPolicyModal(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-copy-reproducibility-snapshot",
      name: "lotus: Copy Reproducibility Snapshot",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.copyReproducibilitySnapshot(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-copy-note-hash",
      name: "lotus: Copy Note Hash",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.copyNoteHash(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-copy-verification-report",
      name: "lotus: Copy Reproducibility Verification Report",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.copyReproducibilityVerificationReport(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-hash-current-note",
      name: "lotus: Hash Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.hashCurrentNote(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-verify-current-note-hash",
      name: "lotus: Verify Current Note Hash",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.verifyCurrentNoteHash(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-hash-current-code-block",
      name: "lotus: Hash Current Code Block",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
          return false;
        }
        if (!checking) {
          void this.hashCurrentCodeBlock();
        }
        return true;
      },
    });

    this.addCommand({
      id: "lotus-verify-code-block-hashes",
      name: "lotus: Verify Code Block Hashes in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.verifyCodeBlockHashes(file);
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

    if (isCompileFeatureAllowed("container-groups")) {
      this.addCommand({
        id: "lotus-validate-container-groups",
        name: "lotus: Validate Container Groups",
        callback: async () => {
          const groups = await this.getContainerGroupSummaries();
          new Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No lotus container groups found.", 8000);
        },
      });
    }

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
    this.logger.close();
  }

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData();
    const hadMachineId = typeof loadedData?.loggingMachineId === "string" && loadedData.loggingMachineId.trim().length > 0;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
    };
    await this.loadExternalLanguagePacks();
    this.normalizeSettings();
    if (!hadMachineId) {
      const persistedSettings: Partial<lotusPluginSettings> = { ...this.settings };
      delete persistedSettings.externalLanguagePacks;
      await this.saveData(persistedSettings);
    }
  }

  async loadExternalLanguagePacks(showNotice = false): Promise<void> {
    const packDir = normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/lotus"}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
    const adapter = this.app.vault.adapter;
    const packs: lotusExternalLanguagePack[] = [];
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

      const files = (await listLanguagePackManifestPaths(adapter, packDir))
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
          console.warn(`Failed to load lotus language pack ${filePath}`, error);
        }
      }
    } catch (error) {
      this.settings.externalLanguagePacks = [];
      console.warn(`Failed to scan lotus language packs in ${packDir}`, error);
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

  async importExternalLanguageBundle(file: File): Promise<{ packId: string; fileCount: number }> {
    const entries = normalizeBundleEntries(await readLanguageBundleArchive(file), file.name);
    if (!entries.length) {
      throw new Error("Language bundle archive did not contain any importable files.");
    }

    const manifestEntry = findBundleManifest(entries);
    if (!manifestEntry) {
      throw new Error("Language bundle archive must include lotus-language-pack.json, language-pack.json, manifest.json, or a valid root JSON pack manifest.");
    }

    const manifest = readBundleManifest(manifestEntry);
    if (!manifest || !Array.isArray(manifest.languages)) {
      throw new Error("Language bundle manifest must be valid JSON with a languages array.");
    }

    const packId = normalizeManifestId(readString(manifest.id)) || normalizeManifestId(file.name.replace(/\.(tar\.gz|tgz|zip|tar)$/i, ""));
    if (!packId) {
      throw new Error("Language bundle manifest is missing a package id.");
    }

    const adapter = this.app.vault.adapter;
    const packDir = normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/lotus"}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
    const bundleDir = normalizePath(`${packDir}/${packId}`);
    await this.ensureVaultFolder(bundleDir);

    for (const entry of entries) {
      const targetPath = normalizePath(`${bundleDir}/${entry.path}`);
      if (!isPathWithin(targetPath, bundleDir)) {
        throw new Error(`Invalid bundle path: ${entry.path}`);
      }
      await this.ensureVaultParentFolder(targetPath);
      await adapter.writeBinary(targetPath, toArrayBuffer(entry.data));
    }

    await this.loadExternalLanguagePacks();
    return { packId, fileCount: entries.length };
  }

  async saveSettings(): Promise<void> {
    this.normalizeSettings();
    const persistedSettings: Partial<lotusPluginSettings> = { ...this.settings };
    delete persistedSettings.externalLanguagePacks;
    await this.saveData(persistedSettings);
    await this.logEvent({
      type: "lotus.settings.changed",
      message: "Lotus settings saved",
      data: {
        loggingEnabled: this.settings.loggingEnabled,
        enableLocalExecution: this.settings.enableLocalExecution,
      },
    });
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

  private async logEvent(input: lotusLogInput): Promise<void> {
    await this.logger.log(await this.enrichLogEvent(input));
  }

  private async enrichLogEvent(input: lotusLogInput): Promise<lotusLogInput> {
    if (!input.notePath || input.noteHash) {
      return input;
    }

    const noteHash = await this.readCurrentNoteHash(input.notePath);
    return noteHash ? { ...input, noteHash } : input;
  }

  private async readCurrentNoteHash(notePath: string): Promise<string | undefined> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return undefined;
    }

    try {
      return sha256Hash(canonicalizeNoteForHash(await this.app.vault.cachedRead(file)));
    } catch (error) {
      console.warn("lotus: failed to compute note hash for log event", error);
      return undefined;
    }
  }

  createToolbarElement(block: lotusCodeBlock): HTMLElement {
    const isFunctionInput = this.isFunctionInputBlock(block);
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runOrCancelBlockById(block.id),
      onEdit: () => void this.editBlockById(block.id),
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
    }, {
      inputButtonLabel: isFunctionInput ? "Toggle function input" : "Toggle stdin input",
    });
  }

  async editBlockById(blockId: string): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      new Notice("Could not find this lotus block.");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof TFile)) {
      new Notice("Could not open the note for this lotus block.");
      return;
    }

    let leaf = this.app.workspace.getLeavesOfType("markdown")
      .find((candidate) => {
        const view = candidate.view;
        return view instanceof MarkdownView && view.file?.path === file.path;
      }) ?? this.app.workspace.getLeaf(false);

    await leaf.openFile(file);
    await this.enforceSourceModeForLeaf(leaf);
    leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? leaf;

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.editor) {
      new Notice("Open the note in editing mode to edit this lotus block.");
      return;
    }

    view.editor.focus();
    view.editor.setCursor({ line: block.startLine, ch: 0 });
    view.editor.scrollIntoView({
      from: { line: block.startLine, ch: 0 },
      to: { line: block.endLine, ch: 0 },
    }, true);
  }

  renderOutputInto(block: lotusCodeBlock, container: HTMLElement): void {
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

  async runOrCancelBlockById(blockId: string): Promise<void> {
    if (this.running.has(blockId)) {
      const block = this.findActiveBlockById(blockId);
      await this.cancelBlockRun(blockId, "toolbar", block ?? undefined, block?.filePath);
      return;
    }
    await this.runActiveBlockById(blockId);
  }

  async cancelBlockRun(blockId: string, source: string, block?: lotusCodeBlock, filePath?: string): Promise<void> {
    const controller = this.running.get(blockId);
    if (!controller) {
      return;
    }

    controller.abort();
    const output = this.outputs.get(blockId);
    await this.logEvent({
      type: "lotus.run.cancel.requested",
      message: "Cancellation requested",
      notePath: filePath ?? block?.filePath ?? output?.block.filePath ?? this.getCurrentEditorFilePath() ?? undefined,
      block: block ?? output?.block,
      data: {
        source,
        blockId,
      },
    });
    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new Notice("lotus cancellation requested.");
  }

  async cancelAllRuns(): Promise<void> {
    const blockIds = [...this.running.keys()];
    for (const blockId of blockIds) {
      this.running.get(blockId)?.abort();
      this.notifyOutputChanged(blockId);
    }
    await this.logEvent({
      type: "lotus.run.cancel.requested",
      message: "Cancellation requested for all running blocks",
      notePath: this.getCurrentEditorFilePath() ?? undefined,
      data: {
        source: "all",
        count: blockIds.length,
      },
    });
    this.updateStatusBar();
    new Notice(`lotus cancellation requested for ${blockIds.length} run${blockIds.length === 1 ? "" : "s"}.`);
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
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Removed Lotus snippet",
      notePath: file.path,
      block,
      data: {
        action: "snippet.removed",
      },
    });

    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new Notice("lotus snippet removed.");
  }

  async runAllBlocksInFile(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = this.resolveExecutionContext(file, block);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });

    if (!supportedBlocks.length) {
      new Notice("No supported lotus blocks found in the current note.");
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
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Cleared Lotus outputs",
      notePath: file.path,
      data: {
        action: "outputs.cleared",
        blocks: blocks.length,
      },
    });
    new Notice("lotus outputs cleared.");
  }

  async saveReproducibilitySnapshot(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const snapshot = this.createReproducibilitySnapshot(file.path, source);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      target[REPRODUCIBILITY_FRONTMATTER_KEY] = snapshot;
      target[NOTE_HASH_FRONTMATTER_KEY] = snapshot.noteHash;
      target[CODE_BLOCK_HASHES_FRONTMATTER_KEY] = snapshot.blocks;
    });
    await this.logEvent({
      type: "lotus.repro.snapshot.saved",
      message: "Reproducibility snapshot saved",
      notePath: file.path,
      data: {
        noteHash: snapshot.noteHash,
        blocks: snapshot.blocks.length,
        policy: snapshot.policy.preset,
      },
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Wrote reproducibility snapshot frontmatter",
      notePath: file.path,
      data: {
        action: "reproducibility.snapshot.saved",
      },
    });

    new Notice(`lotus reproducibility snapshot saved (${snapshot.blocks.length} block${snapshot.blocks.length === 1 ? "" : "s"}).`);
  }

  async verifyReproducibilitySnapshot(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const verification = this.createReproducibilityVerification(file.path, source);
    await this.writeReproducibilityVerification(file, verification);
    await this.logEvent({
      type: "lotus.repro.verify.finished",
      message: verification.summary,
      notePath: file.path,
      data: {
        status: verification.status,
        issues: verification.issues.length,
        verifiedBlocks: verification.blocks.verified,
        totalBlocks: verification.blocks.total,
      },
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Wrote reproducibility verification frontmatter",
      notePath: file.path,
      data: {
        action: "reproducibility.verify.finished",
        status: verification.status,
      },
    });
    new Notice(verification.summary, verification.status === "verified" ? 6000 : 12000);
  }

  async openReproducibilityPolicyModal(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    new ReproducibilityPolicyModal(this.app, readHashPolicy(source), async (preset) => {
      await this.applyReproducibilityPolicyPreset(file, preset);
    }).open();
  }

  async applyReproducibilityPolicyPreset(file: TFile, presetId: Exclude<lotusHashPolicyPreset, "custom">): Promise<void> {
    const policy = hashPolicyFromPreset(presetId);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      target[HASH_POLICY_FRONTMATTER_KEY] = serializeHashPolicy(policy);
      const existing = isRecord(target[REPRODUCIBILITY_FRONTMATTER_KEY])
        ? { ...target[REPRODUCIBILITY_FRONTMATTER_KEY] }
        : {};
      target[REPRODUCIBILITY_FRONTMATTER_KEY] = {
        ...existing,
        version: REPRODUCIBILITY_SNAPSHOT_VERSION,
        policy: serializeHashPolicy(policy),
      };
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Updated reproducibility policy",
      notePath: file.path,
      data: {
        action: "reproducibility.policy.changed",
        policy: presetId,
      },
    });
    new Notice(`lotus reproducibility policy set to ${getHashPolicyPresetDefinition(presetId).label}.`);
  }

  async copyReproducibilitySnapshot(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const existing = readReproducibilityFrontmatter(source);
    const snapshot = existing ?? this.createReproducibilitySnapshot(file.path, source);
    await this.copyTextToClipboard(JSON.stringify(snapshot, null, 2), "Reproducibility snapshot copied.");
  }

  async copyNoteHash(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const hash = readStoredNoteHash(source) ?? sha256Hash(canonicalizeNoteForHash(source));
    await this.copyTextToClipboard(hash, "Note hash copied.");
  }

  async copyReproducibilityVerificationReport(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const existing = readReproducibilityFrontmatter(source);
    const report = isRecord(existing?.verification)
      ? existing.verification
      : this.createReproducibilityVerification(file.path, source);
    await this.copyTextToClipboard(JSON.stringify(report, null, 2), "Reproducibility verification report copied.");
  }

  private async copyTextToClipboard(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(successMessage);
    } catch {
      new Notice("Clipboard write failed.");
    }
  }

  async hashCurrentNote(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const noteHash = sha256Hash(canonicalizeNoteForHash(source));

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      target[NOTE_HASH_FRONTMATTER_KEY] = noteHash;
      if (isRecord(target[REPRODUCIBILITY_FRONTMATTER_KEY])) {
        target[REPRODUCIBILITY_FRONTMATTER_KEY] = {
          ...target[REPRODUCIBILITY_FRONTMATTER_KEY],
          version: REPRODUCIBILITY_SNAPSHOT_VERSION,
          updatedAt: new Date().toISOString(),
          noteHash,
          policy: serializeHashPolicy(readHashPolicy(source)),
        };
      }
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Wrote note hash",
      notePath: file.path,
      data: {
        action: "hash.note",
        noteHash,
      },
    });

    if (this.settings.hashCodeBlocks) {
      await this.writeCodeBlockHashesToFrontmatter(file);
    }

    new Notice(`lotus note hash written: ${noteHash}`);
  }

  async verifyCurrentNoteHash(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const storedHash = readStoredNoteHash(source);
    if (!storedHash) {
      new Notice("No lotus-note-hash found. Run lotus: Hash Current Note first.");
      return;
    }

    const currentHash = sha256Hash(canonicalizeNoteForHash(source));
    if (storedHash === currentHash) {
      new Notice("lotus note hash verified.");
      return;
    }

    new Notice(`lotus note hash mismatch. stored=${storedHash.slice(0, 12)} current=${currentHash.slice(0, 12)}`, 10000);
  }

  async hashCurrentCodeBlock(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      new Notice("Open a Markdown note in editing mode to hash the current code block.");
      return;
    }

    const source = editor.getValue();
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const block = findBlockAtLine(blocks, editor.getCursor().line);
    if (!block) {
      new Notice("No supported lotus block at the current cursor.");
      return;
    }

    const entries = await this.writeCodeBlockHashesToFrontmatter(file, source);
    const currentEntry = entries.find((entry) => entry.ordinal === block.ordinal);
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Wrote code block hashes",
      notePath: file.path,
      block,
      data: {
        action: "hash.code-blocks",
        blocks: entries.length,
        currentHash: currentEntry?.hash ?? this.createCodeBlockHashEntry(block, readHashPolicy(source)).hash,
      },
    });
    new Notice(`lotus block hash: ${currentEntry?.hash ?? this.createCodeBlockHashEntry(block, readHashPolicy(source)).hash}`);
  }

  async verifyCodeBlockHashes(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const storedEntries = readStoredCodeBlockHashEntries(source);
    if (!storedEntries.length) {
      new Notice("No lotus-code-block-hashes found. Run lotus: Hash Current Code Block first.");
      return;
    }

    const policy = readHashPolicy(source);
    const currentEntries = parseMarkdownCodeBlocks(file.path, source, this.settings)
      .map((block) => this.createCodeBlockHashEntry(block, policy));
    const storedByOrdinal = new Map(storedEntries.map((entry) => [entry.ordinal, entry]));
    const currentByOrdinal = new Map(currentEntries.map((entry) => [entry.ordinal, entry]));
    let verified = 0;
    const issues: string[] = [];

    for (const current of currentEntries) {
      const stored = storedByOrdinal.get(current.ordinal);
      if (!stored) {
        issues.push(`#${current.ordinal} missing stored hash`);
        continue;
      }
      if (stored.hash !== current.hash || stored.language !== current.language) {
        issues.push(`#${current.ordinal} changed`);
        continue;
      }
      verified += 1;
    }

    for (const stored of storedEntries) {
      if (!currentByOrdinal.has(stored.ordinal)) {
        issues.push(`#${stored.ordinal} stored hash has no current block`);
      }
    }

    if (!issues.length) {
      new Notice(`lotus verified ${verified} code block hash${verified === 1 ? "" : "es"}.`);
      return;
    }

    new Notice(`lotus block hash verification failed: ${issues.slice(0, 4).join("; ")}${issues.length > 4 ? `; +${issues.length - 4} more` : ""}`, 12000);
  }

  private createReproducibilitySnapshot(filePath: string, source: string): lotusReproducibilitySnapshot {
    const policy = readHashPolicy(source);
    const blocks = parseMarkdownCodeBlocks(filePath, source, this.settings)
      .map((block) => this.createCodeBlockHashEntry(block, policy));
    return {
      version: REPRODUCIBILITY_SNAPSHOT_VERSION,
      updatedAt: new Date().toISOString(),
      noteHash: sha256Hash(canonicalizeNoteForHash(source)),
      policy: serializeHashPolicy(policy),
      blocks,
    };
  }

  private createReproducibilityVerification(filePath: string, source: string): lotusReproducibilityVerification {
    const storedHash = readStoredNoteHash(source) ?? "";
    const currentHash = sha256Hash(canonicalizeNoteForHash(source));
    const storedEntries = readStoredCodeBlockHashEntries(source);
    const policy = readHashPolicy(source);
    const currentEntries = parseMarkdownCodeBlocks(filePath, source, this.settings)
      .map((block) => this.createCodeBlockHashEntry(block, policy));
    const blockComparison = compareCodeBlockHashEntries(storedEntries, currentEntries);
    const issues: string[] = [];

    const noteStatus = storedHash
      ? storedHash === currentHash ? "verified" : "changed"
      : "missing";
    if (noteStatus === "missing") {
      issues.push("note snapshot is missing");
    } else if (noteStatus === "changed") {
      issues.push("note content changed");
    }
    issues.push(...blockComparison.issues);

    const status: lotusReproducibilityStatus = !storedHash && !storedEntries.length
      ? "missing-snapshot"
      : issues.length ? "changed" : "verified";
    const summary = status === "verified"
      ? `lotus reproducibility verified (${blockComparison.verified} block${blockComparison.verified === 1 ? "" : "s"}).`
      : status === "missing-snapshot"
        ? "No lotus reproducibility snapshot found. Save a snapshot first."
        : `lotus reproducibility changed: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? `; +${issues.length - 3} more` : ""}`;

    return {
      status,
      checkedAt: new Date().toISOString(),
      summary,
      issues,
      note: {
        status: noteStatus,
        storedHash,
        currentHash,
      },
      blocks: {
        verified: blockComparison.verified,
        total: currentEntries.length,
        issues: blockComparison.issues,
      },
    };
  }

  private async writeReproducibilityVerification(file: TFile, verification: lotusReproducibilityVerification): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      const existing = isRecord(target[REPRODUCIBILITY_FRONTMATTER_KEY])
        ? { ...target[REPRODUCIBILITY_FRONTMATTER_KEY] }
        : { version: REPRODUCIBILITY_SNAPSHOT_VERSION };
      target[REPRODUCIBILITY_FRONTMATTER_KEY] = {
        ...existing,
        version: REPRODUCIBILITY_SNAPSHOT_VERSION,
        verification,
      };
    });
  }

  async runBlock(file: TFile, block: lotusCodeBlock): Promise<void> {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new Notice("This lotus block is already running.");
      return;
    }

    if (!(await this.ensureExecutionEnabled())) {
      showExecutionDisabledNotice();
      return;
    }

    const executionContext = this.resolveExecutionContext(file, block);
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
    const runnerName = containerGroup ? `execution group ${containerGroup}` : runner!.displayName;
    const runnerId = containerGroup ? `container:${containerGroup}` : runner!.id;
    const noteHash = await this.readCurrentNoteHash(file.path);
    const logTarget: lotusLogTarget = {
      runnerId,
      runnerName,
      containerGroup,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      source: executionContext.source,
    };
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
    await this.logEvent({
      type: "lotus.run.started",
      message: "Code block started",
      notePath: file.path,
      noteHash,
      block,
      target: logTarget,
      stdin,
      data: {
        runnerName,
        containerGroup,
        workingDirectory: executionContext.workingDirectory,
        timeoutMs: executionContext.timeoutMs,
        stdinBytes: stdin?.length ?? 0,
        noteHash,
      },
    });

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

      await this.logger.logRunFinished(file.path, block, runnerName, result, {
        containerGroup,
        workingDirectory: executionContext.workingDirectory,
        timeoutMs: executionContext.timeoutMs,
        sourceReference: Boolean(block.sourceReference),
        noteHash,
      }, logTarget, await this.readCurrentNoteHash(file.path));
      new Notice(result.success ? `lotus ran ${runnerName} block.` : `lotus run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Execution group ${containerGroup}` : runner?.displayName ?? "Unknown",
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
      await this.logEvent({
        type: "lotus.run.failed",
        message: "Code block failed before result",
        notePath: file.path,
        noteHash,
        block,
        target: logTarget,
        stdin,
        error: message,
        data: {
          runnerName,
          containerGroup,
          workingDirectory: executionContext.workingDirectory,
          timeoutMs: executionContext.timeoutMs,
        },
      });
      new Notice(`lotus error: ${message}`);
    } finally {
      await this.writeCodeBlockHashesIfEnabled(file);
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }

  private async writeCodeBlockHashesIfEnabled(file: TFile): Promise<void> {
    if (!this.settings.hashCodeBlocks) {
      return;
    }

    try {
      const entries = await this.writeCodeBlockHashesToFrontmatter(file);
      await this.logEvent({
        type: "lotus.note.modified",
        message: "Auto-wrote code block hashes",
        notePath: file.path,
        data: {
          action: "hash.code-blocks.auto",
          blocks: entries.length,
        },
      });
    } catch (error) {
      console.warn("lotus: failed to write code block hashes", error);
    }
  }

  private async writeCodeBlockHashesToFrontmatter(file: TFile, source?: string): Promise<lotusCodeBlockHashEntry[]> {
    const text = source ?? await this.app.vault.cachedRead(file);
    const policy = readHashPolicy(text);
    const entries = parseMarkdownCodeBlocks(file.path, text, this.settings)
      .map((block) => this.createCodeBlockHashEntry(block, policy));

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      target[CODE_BLOCK_HASHES_FRONTMATTER_KEY] = entries;
      if (isRecord(target[REPRODUCIBILITY_FRONTMATTER_KEY])) {
        target[REPRODUCIBILITY_FRONTMATTER_KEY] = {
          ...target[REPRODUCIBILITY_FRONTMATTER_KEY],
          version: REPRODUCIBILITY_SNAPSHOT_VERSION,
          updatedAt: new Date().toISOString(),
          policy: serializeHashPolicy(policy),
          blocks: entries,
        };
      }
    });

    return entries;
  }

  private createCodeBlockHashEntry(block: lotusCodeBlock, policy: lotusHashPolicy): lotusCodeBlockHashEntry {
    return {
      id: block.id,
      ordinal: block.ordinal,
      language: block.language,
      alias: block.sourceLanguage || block.languageAlias,
      hash: sha256Hash(stableStringify({
        language: block.language,
        sourceLanguage: block.sourceLanguage,
        attributes: filterHashPolicyAttributes(block.attributes, policy),
        content: block.content,
      })),
      startLine: block.startLine + 1,
      endLine: block.endLine + 1,
    };
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

  private async resolveExecutableBlock(file: TFile, block: lotusCodeBlock): Promise<{ block: lotusCodeBlock; sourcePreview?: lotusStoredOutput["sourcePreview"] }> {
    if (!block.sourceReference) {
      return { block };
    }

    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }

    const harness = buildSourceReferenceHarness(block, this.resolveBlockFunctionInput(block));
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
    if (!isCompileFeatureAllowed("container-groups")) {
      return [];
    }
    return (await this.containerRunner.getGroupSummaries())
      .filter((group) => isCompileContainerGroupAllowed(group.name));
  }

  async buildContainerGroup(name: string): Promise<void> {
    if (!isCompileFeatureAllowed("container-groups")) {
      new Notice("lotus container groups are not included in this build.");
      return;
    }
    if (!isCompileContainerGroupAllowed(name)) {
      new Notice(`lotus container group ${name} is not included in this build.`);
      return;
    }
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 120_000), controller.signal);
    new Notice(result.success ? `lotus built container group ${name}.` : `lotus container build failed for ${name}.`, 8000);
  }

  registerCodeBlockProcessors(): void {
    if (this.hasRegisteredMarkdownDecorator) {
      return;
    }

    this.hasRegisteredMarkdownDecorator = true;
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      await this.decorateRenderedCodeBlocks(el, ctx);
    });
  }

  private async decorateRenderedCodeBlocks(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const filePath = ctx.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const codeElements = getRenderedCodeElements(el);
    if (!codeElements.length) {
      return;
    }

    const fullText = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
    if (!blocks.length) {
      return;
    }

    const usedBlockIds = new Set<string>();
    for (const code of codeElements) {
      const pre = code.parentElement;
      if (!(pre instanceof HTMLElement) || pre.dataset.lotusDecorated === "true") {
        continue;
      }

      const block = this.findRenderedCodeBlock(blocks, code, pre, ctx, usedBlockIds);
      if (!block) {
        continue;
      }

      usedBlockIds.add(block.id);
      pre.dataset.lotusDecorated = "true";
      ctx.addChild(new lotusToolbarRenderChild(pre, this, block, pre));
    }
  }

  private findRenderedCodeBlock(
    blocks: lotusCodeBlock[],
    code: HTMLElement,
    pre: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    usedBlockIds: Set<string>,
  ): lotusCodeBlock | null {
    const renderedLanguage = this.getRenderedCodeLanguage(code, pre);
    const renderedSource = code.textContent ?? "";
    const candidates = blocks.filter((block) =>
      !usedBlockIds.has(block.id) &&
      this.renderedLanguageMatchesBlock(renderedLanguage, block) &&
      renderedCodeMatchesBlock(renderedSource, block.content),
    );
    if (!candidates.length) {
      return null;
    }

    const section = ctx.getSectionInfo(pre) ?? ctx.getSectionInfo(code);
    if (section) {
      return candidates.find((block) => block.startLine === section.lineStart)
        ?? candidates.find((block) => block.startLine >= section.lineStart && block.endLine <= section.lineEnd)
        ?? candidates[0];
    }

    return candidates[0];
  }

  private getRenderedCodeLanguage(code: HTMLElement, pre: HTMLElement): string | null {
    for (const element of [code, pre]) {
      for (const className of Array.from(element.classList)) {
        const match = className.match(/^language-(.+)$/i);
        if (match) {
          return match[1].trim().toLowerCase();
        }
      }
    }

    return null;
  }

  private renderedLanguageMatchesBlock(renderedLanguage: string | null, block: lotusCodeBlock): boolean {
    if (!renderedLanguage) {
      return true;
    }

    const normalizedRenderedLanguage = normalizeLanguage(renderedLanguage, this.settings);
    return renderedLanguage === block.sourceLanguage.toLowerCase()
      || renderedLanguage === block.languageAlias
      || renderedLanguage === block.language
      || normalizedRenderedLanguage === block.language;
  }

  private updateStatusBar(): void {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `lotus: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "lotus: Idle");
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
      editorView.dispatch({ effects: lotusRefreshEffect.of(undefined) });
    }
  }

  private normalizeSettings(): void {
    normalizeLanguageConfiguration(this.settings);
    this.settings.outputVisibleLines = normalizeNonNegativeInteger(this.settings.outputVisibleLines, DEFAULT_SETTINGS.outputVisibleLines, 2000);
    this.settings.defaultTimeoutMs = normalizePositiveInteger(this.settings.defaultTimeoutMs, DEFAULT_SETTINGS.defaultTimeoutMs);
    this.settings.hashCodeBlocks = this.settings.hashCodeBlocks ?? DEFAULT_SETTINGS.hashCodeBlocks;
    this.settings.showObsidianContextWarning = this.settings.showObsidianContextWarning ?? DEFAULT_SETTINGS.showObsidianContextWarning;
    if (!SUPPORTED_PDF_EXPORT_MODES.has(this.settings.pdfExportMode)) {
      this.settings.pdfExportMode = DEFAULT_SETTINGS.pdfExportMode;
    }
    this.settings.loggingEnabled = Boolean(this.settings.loggingEnabled);
    this.settings.loggingGlobalTextEnabled = this.settings.loggingGlobalTextEnabled == null
      ? DEFAULT_SETTINGS.loggingGlobalTextEnabled
      : Boolean(this.settings.loggingGlobalTextEnabled);
    this.settings.loggingGlobalJsonlEnabled = this.settings.loggingGlobalJsonlEnabled == null
      ? DEFAULT_SETTINGS.loggingGlobalJsonlEnabled
      : Boolean(this.settings.loggingGlobalJsonlEnabled);
    this.settings.loggingPerNoteTextEnabled = Boolean(this.settings.loggingPerNoteTextEnabled);
    this.settings.loggingPerNoteJsonlEnabled = Boolean(this.settings.loggingPerNoteJsonlEnabled);
    this.settings.loggingProcessEnabled = Boolean(this.settings.loggingProcessEnabled);
    this.settings.loggingHttpEnabled = Boolean(this.settings.loggingHttpEnabled);
    this.settings.loggingIncludeCode = Boolean(this.settings.loggingIncludeCode);
    this.settings.loggingIncludeOutput = Boolean(this.settings.loggingIncludeOutput);
    this.settings.loggingIncludeInput = Boolean(this.settings.loggingIncludeInput);
    this.settings.loggingMachineId = normalizeMachineId(this.settings.loggingMachineId);
    this.settings.loggingGlobalTextPath = normalizeStringSetting(this.settings.loggingGlobalTextPath, DEFAULT_SETTINGS.loggingGlobalTextPath);
    this.settings.loggingGlobalJsonlPath = normalizeStringSetting(this.settings.loggingGlobalJsonlPath, DEFAULT_SETTINGS.loggingGlobalJsonlPath);
    this.settings.loggingPerNoteTextPathPattern = normalizeStringSetting(this.settings.loggingPerNoteTextPathPattern, DEFAULT_SETTINGS.loggingPerNoteTextPathPattern);
    this.settings.loggingPerNoteJsonlPathPattern = normalizeStringSetting(this.settings.loggingPerNoteJsonlPathPattern, DEFAULT_SETTINGS.loggingPerNoteJsonlPathPattern);
    this.settings.loggingProcessCommand = normalizeStringSetting(this.settings.loggingProcessCommand, DEFAULT_SETTINGS.loggingProcessCommand);
    this.settings.loggingHttpEndpoint = normalizeStringSetting(this.settings.loggingHttpEndpoint, DEFAULT_SETTINGS.loggingHttpEndpoint);
    this.settings.loggingHttpHeaders = normalizeStringSetting(this.settings.loggingHttpHeaders, DEFAULT_SETTINGS.loggingHttpHeaders);
    if (!SUPPORTED_LOGGING_NOTE_PATH_MODES.has(this.settings.loggingNotePathMode)) {
      this.settings.loggingNotePathMode = DEFAULT_SETTINGS.loggingNotePathMode;
    }
    this.settings.loggingMaxEventBytes = normalizePositiveInteger(this.settings.loggingMaxEventBytes, DEFAULT_SETTINGS.loggingMaxEventBytes);
    this.settings.defaultContainerGroup = isCompileFeatureAllowed("container-groups")
      ? normalizeStringSetting(this.settings.defaultContainerGroup, DEFAULT_SETTINGS.defaultContainerGroup)
      : "";
    if (this.settings.defaultContainerGroup && !isCompileContainerGroupAllowed(this.settings.defaultContainerGroup)) {
      this.settings.defaultContainerGroup = "";
    }
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

  private findActiveBlockById(blockId: string): lotusCodeBlock | null {
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
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(lotusRefreshEffect)))) {
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
                widget: new lotusToolbarWidget(plugin, block),
                side: -1,
              }),
            );

            if (plugin.outputs.has(block.id) || plugin.running.has(block.id) || plugin.shouldRenderStdinPanel(block)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                Decoration.widget({
                  widget: new lotusOutputWidget(plugin, block),
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

  private resolveExecutionContext(file: TFile, block: lotusCodeBlock): lotusResolvedExecutionContext {
    const context = resolveLotusExecutionContext(this.app, file, block, this.settings);
    if (isCompileFeatureAllowed("container-groups") && (!context.containerGroup || isCompileContainerGroupAllowed(context.containerGroup))) {
      return context;
    }

    return {
      ...context,
      containerGroup: undefined,
      source: {
        ...context.source,
        container: "none",
      },
    };
  }

  private hasExplicitExecutionContext(context: lotusResolvedExecutionContext): boolean {
    return context.source.container !== "none" || context.source.workingDirectory !== "default" || context.source.timeout !== "global";
  }

  private formatExecutionContextNotice(context: lotusResolvedExecutionContext): string {
    const pieces = [
      `execution=${context.containerGroup ?? "native"} (${context.source.container})`,
      `cwd=${context.workingDirectory} (${context.source.workingDirectory})`,
      `timeout=${context.timeoutMs}ms (${context.source.timeout})`,
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }

  private getCustomLanguageExtractor(block: lotusCodeBlock, file: TFile): { mode: "command" | "transpile-c"; language: string; executable: string; args: string[]; workingDirectory: string; timeoutMs: number } | undefined {
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

    const executionContext = this.resolveExecutionContext(file, block);
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
    };
  }

  private async writeManagedOutputBlock(file: TFile, block: lotusCodeBlock, result: lotusStoredOutput["result"]): Promise<void> {
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
    await this.logEvent({
      type: "lotus.output.written",
      message: "Wrote managed output to note",
      notePath: file.path,
      block,
      stdout: result.stdout,
      stderr: result.stderr,
      warning: result.warning,
      data: {
        destination: "note",
        success: result.success,
        exitCode: result.exitCode,
      },
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Inserted managed output section",
      notePath: file.path,
      block,
      data: {
        action: "output.written",
      },
    });
  }

  private async writeOutputFileIfRequested(file: TFile, block: lotusCodeBlock, result: lotusStoredOutput["result"]): Promise<void> {
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
      await this.logEvent({
        type: "lotus.output.file.written",
        message: "Wrote Lotus output file",
        notePath: file.path,
        block,
        stdout: result.stdout,
        stderr: result.stderr,
        warning: result.warning,
        data: {
          path: target.path,
          mode: target.mode,
          format: target.format,
          streams: target.streams,
          success: result.success,
          exitCode: result.exitCode,
        },
      });

      const streamList = target.streams.join(",");
      const notice = `Wrote output file ${target.path} (${target.mode}, ${target.format}, ${streamList}).`;
      result.warning = result.warning ? `${notice}\n${result.warning}` : notice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = `Failed to write output file: ${message}`;
      result.warning = result.warning ? `${notice}\n${result.warning}` : notice;
    }
  }

  private readOutputFileTarget(file: TFile, block: lotusCodeBlock): lotusOutputFileTarget | null {
    const rawPath = block.attributes["lotus-output-file"] ?? block.attributes["output-file"];
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

  private readOutputFileMode(block: lotusCodeBlock): lotusOutputFileMode {
    const append = block.attributes["lotus-output-append"] ?? block.attributes["output-append"];
    if (append && !["0", "false", "no", "off"].includes(append.trim().toLowerCase())) {
      return "append";
    }

    const mode = (block.attributes["lotus-output-file-mode"] ?? block.attributes["output-file-mode"] ?? "replace").trim().toLowerCase();
    if (mode === "append") {
      return "append";
    }
    if (mode === "replace") {
      return "replace";
    }
    throw new Error(`Unsupported lotus-output-file-mode: ${mode}. Use replace or append.`);
  }

  private readOutputFileFormat(block: lotusCodeBlock): lotusOutputFileFormat {
    const format = (block.attributes["lotus-output-file-format"] ?? block.attributes["output-file-format"] ?? "text").trim().toLowerCase();
    if (format === "text" || format === "json") {
      return format;
    }
    throw new Error(`Unsupported lotus-output-file-format: ${format}. Use text or json.`);
  }

  private readOutputFileStreams(block: lotusCodeBlock): lotusOutputFileStream[] {
    const value = block.attributes["lotus-output-file-streams"] ?? block.attributes["output-file-streams"] ?? "stdout";
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
      throw new Error(`Unsupported lotus-output-file-streams entry: ${stream}.`);
    });
    return streams.length ? [...new Set(streams)] : ["stdout"];
  }

  private resolveOutputVaultPath(file: TFile, rawPath: string): string {
    const trimmed = rawPath.trim();
    if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      throw new Error("lotus-output-file must be a vault-relative path.");
    }

    const path = trimmed.startsWith("/")
      ? normalizePath(trimmed.slice(1))
      : normalizePath(dirname(file.path) === "." ? trimmed : `${dirname(file.path)}/${trimmed}`);
    const parts = path.split("/").filter(Boolean);
    if (!parts.length || parts.includes("..") || path.startsWith(".obsidian/") || path === ".obsidian" || path.startsWith(".git/") || path === ".git") {
      throw new Error(`Invalid lotus-output-file path: ${rawPath}`);
    }
    return path;
  }

  private async ensureVaultParentFolder(path: string): Promise<void> {
    const folder = dirname(path);
    if (!folder || folder === ".") {
      return;
    }

    await this.ensureVaultFolder(folder);
  }

  private async ensureVaultFolder(folder: string): Promise<void> {
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private renderOutputFileText(result: lotusStoredOutput["result"], target: lotusOutputFileTarget): string {
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

  private renderOutputFileJson(file: TFile, block: lotusCodeBlock, result: lotusStoredOutput["result"], target: lotusOutputFileTarget): string {
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

  private renderManagedOutputMarkdown(blockId: string, result: lotusStoredOutput["result"]): string[] {
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
      `<!-- lotus:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- lotus:output:end -->",
    ];
  }

  private findManagedOutputRange(lines: string[], blockId: string): { start: number; end: number } | null {
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

  shouldRenderStdinPanel(block: lotusCodeBlock): boolean {
    return this.stdinPanels.has(block.id) || this.hasEnabledStdinAttribute(block);
  }

  private hasEnabledStdinAttribute(block: lotusCodeBlock): boolean {
    const input = block.attributes["lotus-input"] ?? block.attributes.input;
    if (this.isFunctionInputBlock(block) && input && !["0", "false", "no", "off"].includes(input.trim().toLowerCase())) {
      return true;
    }
    return block.attributes["lotus-stdin"] != null ||
      block.attributes.stdin != null ||
      block.attributes["lotus-stdin-file"] != null ||
      block.attributes["stdin-file"] != null;
  }

  private isFunctionInputBlock(block: lotusCodeBlock): boolean {
    return Boolean(block.sourceReference?.call);
  }

  private createStdinPanel(block: lotusCodeBlock): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "lotus-stdin-panel";
    const isFunctionInput = this.isFunctionInputBlock(block);

    const header = panel.createDiv({ cls: "lotus-stdin-header" });
    header.createSpan({ text: isFunctionInput ? "function input" : "stdin" });
    const actions = header.createDiv({ cls: "lotus-stdin-actions" });
    const runButton = actions.createEl("button", { text: isFunctionInput ? "Run function" : "Run" });
    const clearButton = actions.createEl("button", { text: "Clear" });

    const textarea = panel.createEl("textarea", { cls: "lotus-stdin-input" });
    textarea.placeholder = this.getStdinPlaceholder(block);
    textarea.value = this.getInputPanelValue(block);
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

  private getStdinPlaceholder(block: lotusCodeBlock): string {
    if (this.isFunctionInputBlock(block)) {
      return "input passed to {input} in lotus-call";
    }
    const stdinFile = block.attributes["lotus-stdin-file"] ?? block.attributes["stdin-file"];
    return stdinFile ? `stdin file: ${stdinFile}` : "standard input for this block";
  }

  private getInputPanelValue(block: lotusCodeBlock): string {
    if (this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id) ?? "";
    }
    if (this.isFunctionInputBlock(block)) {
      return this.resolveBlockFunctionInput(block) ?? "";
    }
    return block.attributes["lotus-stdin"] ?? block.attributes.stdin ?? "";
  }

  private resolveBlockFunctionInput(block: lotusCodeBlock): string | undefined {
    if (!this.isFunctionInputBlock(block)) {
      return undefined;
    }
    if (this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id);
    }

    const inline = block.attributes["lotus-input"] ?? block.attributes.input;
    return inline != null ? decodeEscapedAttribute(inline) : block.content.trim();
  }

  private async resolveBlockStdin(file: TFile, block: lotusCodeBlock): Promise<string | undefined> {
    if (!this.isFunctionInputBlock(block) && this.stdinInputs.has(block.id)) {
      return this.stdinInputs.get(block.id);
    }

    const inline = block.attributes["lotus-stdin"] ?? block.attributes.stdin;
    if (inline != null) {
      return decodeEscapedAttribute(inline);
    }

    const stdinFile = block.attributes["lotus-stdin-file"] ?? block.attributes["stdin-file"];
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

async function listLanguagePackManifestPaths(adapter: DataAdapter, root: string): Promise<string[]> {
  const manifests: string[] = [];

  async function walk(folder: string, depth: number): Promise<void> {
    const listed = await adapter.list(folder);
    for (const file of listed.files) {
      const lower = file.toLowerCase();
      if (!lower.endsWith(".json")) {
        continue;
      }

      const relative = normalizePath(file.slice(root.length + 1));
      const nested = relative.includes("/");
      const fileName = relative.split("/").pop()?.toLowerCase() ?? "";
      if (!nested || LANGUAGE_PACK_MANIFEST_NAMES.has(fileName)) {
        manifests.push(file);
      }
    }

    for (const child of listed.folders) {
      if (depth < 4) {
        await walk(child, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return manifests;
}

async function readLanguageBundleArchive(file: File): Promise<lotusArchiveEntry[]> {
  const lowerName = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (lowerName.endsWith(".zip")) {
    return readZipBundle(bytes);
  }
  if (lowerName.endsWith(".tar")) {
    return readTarBundle(bytes);
  }
  if (lowerName.endsWith(".tgz") || lowerName.endsWith(".tar.gz")) {
    return readTarBundle(new Uint8Array(await gunzipBytes(bytes)));
  }

  throw new Error("Language bundle must be a .zip, .tar, .tgz, or .tar.gz archive.");
}

async function readZipBundle(bytes: Uint8Array): Promise<lotusArchiveEntry[]> {
  const zip = await JSZip.loadAsync(bytes);
  const entries: lotusArchiveEntry[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }
    entries.push({
      path: entry.name,
      data: await entry.async("uint8array"),
    });
  }

  return entries;
}

function readTarBundle(bytes: Uint8Array): lotusArchiveEntry[] {
  const entries: lotusArchiveEntry[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!Number.isFinite(size) || size < 0 || dataEnd > bytes.length) {
      throw new Error("Invalid tar archive entry size.");
    }

    if (type === "0" || type === "\0") {
      entries.push({ path, data: bytes.slice(dataStart, dataEnd) });
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

async function gunzipBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  const Decompression = globalThis.DecompressionStream;
  if (!Decompression) {
    throw new Error("This Obsidian runtime cannot decompress tar.gz bundles. Use .zip or .tar instead.");
  }

  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new Decompression("gzip"));
  return new Response(stream).arrayBuffer();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readTarString(bytes: Uint8Array, offset: number, length: number): string {
  const end = bytes.indexOf(0, offset);
  const sliceEnd = end >= offset && end < offset + length ? end : offset + length;
  return new TextDecoder().decode(bytes.slice(offset, sliceEnd)).trim();
}

function normalizeBundleEntries(entries: lotusArchiveEntry[], fileName: string): lotusArchiveEntry[] {
  const cleaned = entries
    .map((entry) => ({
      path: normalizeArchivePath(entry.path),
      data: entry.data,
    }))
    .filter((entry): entry is lotusArchiveEntry => Boolean(entry.path));

  const stripped = stripCommonArchiveRoot(cleaned);
  if (!stripped.length) {
    throw new Error(`Language bundle ${fileName} did not contain any usable files.`);
  }
  return stripped;
}

function normalizeArchivePath(path: string): string {
  const normalized = normalizePath(path.replace(/\\/g, "/")).replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts[0] === "__MACOSX" || parts[parts.length - 1] === ".DS_Store") {
    return "";
  }
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0") || /^[a-zA-Z]:$/.test(part))) {
    throw new Error(`Invalid bundle path: ${path}`);
  }
  return parts.join("/");
}

function stripCommonArchiveRoot(entries: lotusArchiveEntry[]): lotusArchiveEntry[] {
  const roots = entries.map((entry) => entry.path.split("/"));
  if (!roots.length || roots.some((parts) => parts.length < 2)) {
    return entries;
  }

  const root = roots[0][0];
  if (!roots.every((parts) => parts[0] === root)) {
    return entries;
  }

  return entries.map((entry) => ({
    path: entry.path.split("/").slice(1).join("/"),
    data: entry.data,
  }));
}

function findBundleManifest(entries: lotusArchiveEntry[]): lotusArchiveEntry | null {
  const named = entries.find((entry) => isBundleManifestCandidate(entry) && readBundleManifest(entry));
  if (named) {
    return named;
  }

  return entries.find((entry) => {
    if (entry.path.includes("/") || !isBundleManifestCandidate(entry)) {
      return false;
    }
    return Boolean(readBundleManifest(entry));
  }) ?? null;
}

function isBundleManifestCandidate(entry: lotusArchiveEntry): boolean {
  const fileName = entry.path.split("/").pop()?.toLowerCase() ?? "";
  return LANGUAGE_PACK_MANIFEST_NAMES.has(fileName) || !entry.path.includes("/") && fileName.endsWith(".json");
}

function readBundleManifest(entry: lotusArchiveEntry): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(entry.data));
    return isRecord(parsed) && typeof parsed.id === "string" && Array.isArray(parsed.languages) ? parsed : null;
  } catch {
    return null;
  }
}

function isPathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function parseExternalLanguagePack(value: unknown, filePath: string): lotusExternalLanguagePack | null {
  if (!isRecord(value)) {
    console.warn(`Ignoring lotus language pack ${filePath}: manifest must be an object`);
    return null;
  }

  const rawId = readString(value.id);
  const id = normalizeManifestId(rawId);
  if (!id) {
    console.warn(`Ignoring lotus language pack ${filePath}: missing package id`);
    return null;
  }
  if (!Array.isArray(value.languages)) {
    console.warn(`Ignoring lotus language pack ${filePath}: languages must be an array`);
    return null;
  }

  const languages = value.languages
    .map((language) => parseExternalLanguage(language, filePath))
    .filter((language): language is lotusExternalLanguage => Boolean(language));
  if (!languages.length) {
    console.warn(`Ignoring lotus language pack ${filePath}: no valid languages`);
    return null;
  }

  return {
    id: `external:${id}`,
    displayName: readString(value.displayName) || rawId,
    description: readString(value.description) || `External language pack from ${filePath}`,
    languages,
  };
}

function parseExternalLanguage(value: unknown, filePath: string): lotusExternalLanguage | null {
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

function normalizeMachineId(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[A-Za-z0-9._:-]{16,160}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return createMachineId();
}

function createMachineId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoApi?.randomUUID?.() ?? `lotus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function canonicalizeNoteForHash(source: string): string {
  const policy = readHashPolicy(source);
  const frontmatter = splitFrontmatter(source);
  const canonicalBody = canonicalizeFenceInfoForHash(frontmatter?.body ?? source, policy);
  if (!frontmatter) {
    return canonicalBody;
  }

  const parsed = parseFrontmatterRecord(frontmatter.yaml);
  const canonicalFrontmatter = Object.fromEntries(
    Object.keys(parsed)
      .sort()
      .filter((key) => !shouldIgnoreFrontmatterKey(key, policy))
      .map((key) => [key, parsed[key]]),
  );

  return stableStringify({
    frontmatter: canonicalFrontmatter,
    body: canonicalBody,
  });
}

function readHashPolicy(source: string): lotusHashPolicy {
  const frontmatter = splitFrontmatter(source);
  const parsed = frontmatter ? parseFrontmatterRecord(frontmatter.yaml) : {};
  const rawPolicy = parsed[HASH_POLICY_FRONTMATTER_KEY];
  const nestedPolicy = isRecord(rawPolicy) ? rawPolicy : {};
  const presetId = readHashPolicyPreset(typeof rawPolicy === "string" ? rawPolicy : readString(nestedPolicy.preset));
  const basePolicy = hashPolicyFromPreset(presetId ?? "strict");
  const policy = {
    preset: presetId ?? basePolicy.preset,
    ignoreFrontmatter: normalizePolicyList([
      ...basePolicy.ignoreFrontmatter,
      ...readStringList(parsed[HASH_IGNORE_FRONTMATTER_KEY]),
      ...readStringList(nestedPolicy["ignore-frontmatter"] ?? nestedPolicy.ignoreFrontmatter ?? nestedPolicy.frontmatter),
    ]),
    ignoreBlockAttributes: normalizePolicyList([
      ...basePolicy.ignoreBlockAttributes,
      ...readStringList(parsed[HASH_IGNORE_BLOCK_ATTRIBUTES_KEY]),
      ...readStringList(nestedPolicy["ignore-block-attributes"] ?? nestedPolicy.ignoreBlockAttributes ?? nestedPolicy.blockAttributes),
    ]),
  };
  const matchedPreset = matchHashPolicyPreset(policy);

  return {
    ...policy,
    preset: matchedPreset ?? "custom",
  };
}

function readStoredNoteHash(source: string): string | null {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return null;
  }
  const parsed = parseFrontmatterRecord(frontmatter.yaml);
  const snapshot = isRecord(parsed[REPRODUCIBILITY_FRONTMATTER_KEY]) ? parsed[REPRODUCIBILITY_FRONTMATTER_KEY] : null;
  const value = snapshot?.noteHash ?? parsed[NOTE_HASH_FRONTMATTER_KEY];
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function readReproducibilityFrontmatter(source: string): Record<string, unknown> | null {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return null;
  }
  const value = parseFrontmatterRecord(frontmatter.yaml)[REPRODUCIBILITY_FRONTMATTER_KEY];
  return isRecord(value) ? value : null;
}

function readStoredCodeBlockHashEntries(source: string): lotusCodeBlockHashEntry[] {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return [];
  }
  const parsed = parseFrontmatterRecord(frontmatter.yaml);
  const snapshot = isRecord(parsed[REPRODUCIBILITY_FRONTMATTER_KEY]) ? parsed[REPRODUCIBILITY_FRONTMATTER_KEY] : null;
  const value = snapshot?.blocks ?? parsed[CODE_BLOCK_HASHES_FRONTMATTER_KEY];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStoredCodeBlockHashEntry)
    .filter((entry): entry is lotusCodeBlockHashEntry => Boolean(entry));
}

function readStoredCodeBlockHashEntry(value: unknown): lotusCodeBlockHashEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const ordinal = readPositiveNumber(value.ordinal);
  const startLine = readPositiveNumber(value.startLine);
  const endLine = readPositiveNumber(value.endLine);
  const hash = typeof value.hash === "string" ? value.hash.trim().toLowerCase() : "";
  const language = typeof value.language === "string" ? value.language.trim() : "";
  if (!ordinal || !startLine || !endLine || !/^[a-f0-9]{64}$/i.test(hash) || !language) {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id.trim() : "",
    ordinal,
    language,
    alias: typeof value.alias === "string" ? value.alias.trim() : language,
    hash,
    startLine,
    endLine,
  };
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function splitFrontmatter(source: string): { yaml: string; body: string } | null {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }
  if (frontmatterEnd < 0) {
    return null;
  }

  return {
    yaml: lines.slice(1, frontmatterEnd).join("\n"),
    body: lines.slice(frontmatterEnd + 1).join("\n"),
  };
}

function parseFrontmatterRecord(yaml: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(yaml);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function shouldIgnoreFrontmatterKey(key: string, policy: lotusHashPolicy): boolean {
  const normalized = normalizeHashPolicyToken(key);
  if (LOTUS_HASH_FRONTMATTER_KEYS.has(normalized) || normalized === REPRODUCIBILITY_FRONTMATTER_KEY) {
    return true;
  }
  if (normalized === HASH_POLICY_FRONTMATTER_KEY || normalized === HASH_IGNORE_FRONTMATTER_KEY || normalized === HASH_IGNORE_BLOCK_ATTRIBUTES_KEY) {
    return false;
  }
  return policy.ignoreFrontmatter.includes(normalized);
}

function hashPolicyFromPreset(presetId: Exclude<lotusHashPolicyPreset, "custom">): lotusHashPolicy {
  const preset = getHashPolicyPresetDefinition(presetId);
  return {
    preset: preset.id,
    ignoreFrontmatter: normalizePolicyList(preset.ignoreFrontmatter),
    ignoreBlockAttributes: normalizePolicyList(preset.ignoreBlockAttributes),
  };
}

function getHashPolicyPresetDefinition(presetId: Exclude<lotusHashPolicyPreset, "custom">): lotusHashPolicyPresetDefinition {
  return HASH_POLICY_PRESETS.find((preset) => preset.id === presetId) ?? HASH_POLICY_PRESETS[0];
}

function readHashPolicyPreset(value: string): Exclude<lotusHashPolicyPreset, "custom"> | null {
  const normalized = normalizeHashPolicyToken(value);
  return HASH_POLICY_PRESETS.some((preset) => preset.id === normalized)
    ? normalized as Exclude<lotusHashPolicyPreset, "custom">
    : null;
}

function matchHashPolicyPreset(policy: Pick<lotusHashPolicy, "ignoreFrontmatter" | "ignoreBlockAttributes">): lotusHashPolicyPreset | null {
  const frontmatter = normalizePolicyList(policy.ignoreFrontmatter);
  const blockAttributes = normalizePolicyList(policy.ignoreBlockAttributes);
  for (const preset of HASH_POLICY_PRESETS) {
    if (sameStringSet(frontmatter, normalizePolicyList(preset.ignoreFrontmatter)) && sameStringSet(blockAttributes, normalizePolicyList(preset.ignoreBlockAttributes))) {
      return preset.id;
    }
  }
  return frontmatter.length || blockAttributes.length ? "custom" : "strict";
}

function serializeHashPolicy(policy: lotusHashPolicy): { preset: lotusHashPolicyPreset; "ignore-frontmatter": string[]; "ignore-block-attributes": string[] } {
  return {
    preset: policy.preset,
    "ignore-frontmatter": [...policy.ignoreFrontmatter],
    "ignore-block-attributes": [...policy.ignoreBlockAttributes],
  };
}

function compareCodeBlockHashEntries(storedEntries: lotusCodeBlockHashEntry[], currentEntries: lotusCodeBlockHashEntry[]): { verified: number; issues: string[] } {
  const storedByOrdinal = new Map(storedEntries.map((entry) => [entry.ordinal, entry]));
  const currentByOrdinal = new Map(currentEntries.map((entry) => [entry.ordinal, entry]));
  let verified = 0;
  const issues: string[] = [];

  for (const current of currentEntries) {
    const stored = storedByOrdinal.get(current.ordinal);
    if (!stored) {
      issues.push(`block #${current.ordinal} missing stored hash`);
      continue;
    }
    if (stored.hash !== current.hash || stored.language !== current.language) {
      issues.push(`block #${current.ordinal} changed`);
      continue;
    }
    verified += 1;
  }

  for (const stored of storedEntries) {
    if (!currentByOrdinal.has(stored.ordinal)) {
      issues.push(`block #${stored.ordinal} stored hash has no current block`);
    }
  }

  return { verified, issues };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function getRenderedCodeElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (root.matches("pre > code")) {
    elements.push(root);
  } else if (root.matches("pre")) {
    const code = root.querySelector(":scope > code");
    if (code instanceof HTMLElement) {
      elements.push(code);
    }
  }

  elements.push(...Array.from(root.querySelectorAll("pre > code")) as HTMLElement[]);
  return [...new Set(elements)];
}

function renderedCodeMatchesBlock(renderedSource: string, blockSource: string): boolean {
  const renderedVariants = codeTextVariants(renderedSource);
  const blockVariants = codeTextVariants(blockSource);
  return renderedVariants.some((rendered) => blockVariants.includes(rendered));
}

function codeTextVariants(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const withoutSingleTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return normalized === withoutSingleTrailingNewline
    ? [normalized]
    : [normalized, withoutSingleTrailingNewline];
}

function canonicalizeFenceInfoForHash(source: string, policy: lotusHashPolicy): string {
  if (!policy.ignoreBlockAttributes.length) {
    return source;
  }

  const ignored = new Set(policy.ignoreBlockAttributes);
  const lines = source.split(/\r?\n/);
  let fenceToken: string | null = null;

  return lines.map((line) => {
    const trimmed = line.trim();
    if (fenceToken) {
      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        fenceToken = null;
      }
      return line;
    }

    const match = line.match(/^(\s*)(```+|~~~+)(\s*)([^\s`]*)?(.*)$/);
    if (!match) {
      return line;
    }

    fenceToken = match[2];
    const language = match[4] ?? "";
    const attributes = removeIgnoredInfoAttributes(match[5] ?? "", ignored);
    const languagePart = language ? `${match[3]}${language}` : match[3];
    return `${match[1]}${match[2]}${languagePart}${attributes ? ` ${attributes}` : ""}`;
  }).join("\n");
}

function removeIgnoredInfoAttributes(input: string, ignored: Set<string>): string {
  return input
    .replace(/([A-Za-z0-9_-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/g, (full, key: string) =>
      ignored.has(normalizeHashPolicyToken(key)) ? "" : full,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function filterHashPolicyAttributes(attributes: Record<string, string>, policy: lotusHashPolicy): Record<string, string> {
  const ignored = new Set(policy.ignoreBlockAttributes);
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !ignored.has(normalizeHashPolicyToken(key))),
  );
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => readStringList(entry));
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return [];
}

function normalizePolicyList(values: string[]): string[] {
  return [...new Set(values.map(normalizeHashPolicyToken).filter(Boolean))];
}

function normalizeHashPolicyToken(value: string): string {
  return value.trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
