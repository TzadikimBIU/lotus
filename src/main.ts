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
import { readFile } from "fs/promises";
import JSZip from "jszip";
import { dirname, isAbsolute, join } from "path";
import { homedir } from "os";
import { lotusContainerRunner } from "./execution/containerRunner";
import { runProcess } from "./execution/processRunner";
import { getCompileMachineHashScopeOverride, isCompileContainerGroupAllowed, isCompileFeatureAllowed, isCompileLoggingForced } from "./buildProfile";
import { resolveExecutionContext as resolveLotusExecutionContext } from "./executionContext";
import { addLlvmDecorations, highlightLlvmElement } from "./llvmHighlight";
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
import { resolveReferencedSource, type lotusExternalSourceExtractor } from "./sourceExtract";
import { runExternalSourcePreprocessorPipeline, type lotusExternalSourcePreprocessor, type lotusPreprocessorPipelineSpec } from "./sourcePreprocess";
import { buildSourceReferenceHarness } from "./sourceHarness";
import { createCodeBlockToolbar } from "./ui/codeBlockToolbar";
import { LOTUS_LOG_VIEW_TYPE, lotusLogView } from "./ui/logView";
import { createOutputPanel, createRunningPanel } from "./ui/outputPanel";
import { createSourceVisualizationDisplay, createStdoutVisualizationDisplay } from "./visualization/codeGraph";
import { createJavaScriptGraphDisplayRenderers } from "./visualization/javascriptGraphs";
import { addSyntaxLanguageClass, highlightCodeElement, normalizeSyntaxLanguage } from "./syntaxHighlight";
import { splitCommandLine } from "./utils/command";
import { sha256Hash } from "./utils/hash";
import { formatTimeoutLabel, formatTimeoutMs } from "./utils/timeout";
import { createOpenSshSignature, createPassphraseSignature, createRsaSignature, readSignatureRecord, verifyOpenSshSignature, verifyPassphraseSignature, verifyRsaSignature, type lotusSignatureRecord } from "./signing";
import { apiBlockFromCodeBlock, apiRunFromStoredOutput, lotusApiServer, readApiLogEvents, type lotusApiBlock, type lotusApiLogEvent, type lotusApiNote, type lotusApiRun, type lotusApiRunner } from "./apiServer";
import type {
  lotusCodeBlock,
  lotusCustomPreprocessor,
  lotusDisplayOutput,
  lotusDisplayRenderer,
  lotusExternalLanguage,
  lotusExternalLanguagePack,
  lotusPluginSettings,
  lotusResolvedExecutionContext,
  lotusStdinSession,
  lotusStoredOutput,
} from "./types";

const lotusRefreshEffect = StateEffect.define<void>();
const EXTERNAL_LANGUAGE_PACK_DIR = "language-packs";
const LANGUAGE_PACK_MANIFEST_NAMES = new Set(["lotus-language-pack.json", "language-pack.json", "manifest.json"]);
const NOTE_HASH_FRONTMATTER_KEY = "lotus-note-hash";
const CODE_BLOCK_HASHES_FRONTMATTER_KEY = "lotus-code-block-hashes";
const SIGNATURE_FRONTMATTER_KEY = "lotus-signature";
const LOTUS_HASH_FRONTMATTER_KEYS = new Set([NOTE_HASH_FRONTMATTER_KEY, CODE_BLOCK_HASHES_FRONTMATTER_KEY, SIGNATURE_FRONTMATTER_KEY]);
const REPRODUCIBILITY_FRONTMATTER_KEY = "lotus-reproducibility";
const HASH_POLICY_FRONTMATTER_KEY = "lotus-hash-policy";
const HASH_IGNORE_FRONTMATTER_KEY = "lotus-hash-ignore-frontmatter";
const HASH_IGNORE_BLOCK_ATTRIBUTES_KEY = "lotus-hash-ignore-block-attributes";
const REPRODUCIBILITY_SNAPSHOT_VERSION = 1;
const SUPPORTED_PDF_EXPORT_MODES = new Set<lotusPluginSettings["pdfExportMode"]>(["both", "code", "output"]);
const SUPPORTED_LOGGING_NOTE_PATH_MODES = new Set<lotusPluginSettings["loggingNotePathMode"]>(["plain", "hash", "omit"]);
const SUPPORTED_LOGGING_MACHINE_HASH_SCOPES = new Set<lotusPluginSettings["loggingMachineHashScope"]>(["install", "vault", "install-vault"]);
type lotusOutputFileMode = "replace" | "append";
type lotusOutputFileFormat = "text" | "json";
type lotusOutputFileStream = "stdout" | "stderr" | "warning" | "metadata" | "displays";
type lotusVisualizationMode = "graphviz" | "svg";
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

interface lotusSignaturePayload {
  version: 1;
  scope: "note";
  noteHash: string;
  policy: ReturnType<typeof serializeHashPolicy>;
  blocks: lotusCodeBlockHashEntry[];
}

interface lotusSignatureMaterial {
  mode: "passphrase" | "rsa" | "ssh";
  passphrase?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
  rememberForSession?: boolean;
}

interface lotusLiveRunState {
  inputSession: lotusLiveStdinSession | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  runnerName: string;
  notePath: string;
  block: lotusCodeBlock;
  target: lotusLogTarget;
}

interface lotusRunBlockOptions {
  intent?: "run" | "transpile";
  visualize?: boolean;
  writePolicy?: string;
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
    contentEl.createEl("h2", { text: "Enable Lotus local execution?" });
    contentEl.createEl("p", {
      text: "Lotus runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process.",
    });

    const actions = contentEl.createDiv({ cls: "lotus-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });

    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", () => {
      void this.onConfirm().then(() => {
        this.close();
      });
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
    contentEl.createEl("h2", { text: "Lotus reproducibility policy" });
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
    applyButton.addEventListener("click", () => {
      void this.onChoose(this.selectedPreset).then(() => {
        this.close();
      });
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

class SignatureMaterialModal extends Modal {
  private settled = false;

  constructor(
    app: Plugin["app"],
    private readonly options: {
      title: string;
      mode: "passphrase" | "rsa";
      action: "sign" | "verify";
      hasPrivateKeyPath: boolean;
      cachedPassphrase?: string;
      onSubmit: (material: lotusSignatureMaterial) => void;
      onCancel: () => void;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.options.title });

    if (this.options.mode === "passphrase") {
      this.renderPassphraseForm(contentEl);
    } else {
      this.renderRsaForm(contentEl);
    }
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.options.onCancel();
    }
  }

  private renderPassphraseForm(contentEl: HTMLElement): void {
    contentEl.createEl("p", {
      text: this.options.action === "sign"
        ? "Enter a passphrase. The passphrase is not stored; Lotus stores only the salt, KDF parameters, payload hash, and HMAC."
        : "Enter the passphrase used to sign this note.",
    });
    const passphrase = createPasswordInput(contentEl, "Passphrase");
    if (this.options.cachedPassphrase) {
      passphrase.value = this.options.cachedPassphrase;
    }
    const confirm = this.options.action === "sign" ? createPasswordInput(contentEl, "Confirm passphrase") : null;
    const remember = contentEl.createEl("label", { cls: "lotus-signing-session-cache" });
    const rememberInput = remember.createEl("input", { attr: { type: "checkbox" } });
    remember.createSpan({ text: "Keep in memory until Obsidian reloads" });
    const error = contentEl.createDiv({ cls: "setting-item-description" });
    this.renderActions(contentEl, () => {
      if (!passphrase.value) {
        error.setText("Passphrase is required.");
        return;
      }
      if (confirm && passphrase.value !== confirm.value) {
        error.setText("Passphrases do not match.");
        return;
      }
      this.submit({ mode: "passphrase", passphrase: passphrase.value, rememberForSession: rememberInput.checked });
    });
  }

  private renderRsaForm(contentEl: HTMLElement): void {
    contentEl.createEl("p", {
      text: this.options.hasPrivateKeyPath
        ? "Lotus will read the configured private key file for signing. Enter a key passphrase only if the key is encrypted."
        : "Paste an RSA private key PEM. The private key is used for this signing operation and is not stored.",
    });
    const privateKey = this.options.hasPrivateKeyPath
      ? null
      : contentEl.createEl("textarea", {
        cls: "lotus-signing-key-input",
        attr: {
          rows: "8",
          placeholder: "-----begin private key-----",
        },
      });
    const keyPassphrase = createPasswordInput(contentEl, "Private key passphrase, if encrypted");
    const error = contentEl.createDiv({ cls: "setting-item-description" });
    this.renderActions(contentEl, () => {
      if (privateKey && !privateKey.value.trim()) {
        error.setText("Private key pem is required unless a private key file is configured.");
        return;
      }
      this.submit({
        mode: "rsa",
        privateKeyPem: privateKey?.value,
        privateKeyPassphrase: keyPassphrase.value,
      });
    });
  }

  private renderActions(contentEl: HTMLElement, submit: () => void): void {
    const actions = contentEl.createDiv({ cls: "lotus-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const submitButton = actions.createEl("button", { text: this.options.action === "sign" ? "Sign" : "Verify", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    submitButton.addEventListener("click", submit);
  }

  private submit(material: lotusSignatureMaterial): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.options.onSubmit(material);
    this.close();
  }
}

class lotusLiveStdinSession implements lotusStdinSession {
  private readonly writers = new Set<(chunk: string | null) => void>();
  private closed = false;

  attachWriter(writer: (chunk: string | null) => void): () => void {
    if (this.closed) {
      writer(null);
      return () => undefined;
    }
    this.writers.add(writer);
    return () => {
      this.writers.delete(writer);
    };
  }

  send(input: string): boolean {
    if (this.closed) {
      return false;
    }
    for (const writer of this.writers) {
      writer(input);
    }
    return this.writers.size > 0;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const writer of this.writers) {
      writer(null);
    }
    this.writers.clear();
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
    this.panelContainer = activeDocument.createElement("div");
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
  private readonly showTranspile: boolean;
  private readonly showVisualize: boolean;

  constructor(
    private readonly plugin: lotusPlugin,
    private readonly block: lotusCodeBlock,
  ) {
    super();
    this.isRunning = plugin.isBlockRunning(block.id);
    this.showTranspile = plugin.shouldShowTranspileButton(block);
    this.showVisualize = plugin.shouldShowCodeVisualizationButton();
  }

  eq(other: lotusToolbarWidget): boolean {
    return other.block.id === this.block.id
      && other.isRunning === this.isRunning
      && other.showTranspile === this.showTranspile
      && other.showVisualize === this.showVisualize;
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
    const wrapper = activeDocument.createElement("div");
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
  public readonly containerRunner = new lotusContainerRunner(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/lotus`);
  private hasRegisteredMarkdownDecorator = false;
  private readonly displayRenderers = new Set<lotusDisplayRenderer>();
  private readonly outputs = new Map<string, lotusStoredOutput>();
  private readonly liveRuns = new Map<string, lotusLiveRunState>();
  private cachedSigningPassphrase: string | null = null;
  private readonly stdinInputs = new Map<string, string>();
  private readonly stdinPanels = new Set<string>();
  private readonly running = new Map<string, AbortController>();
  private readonly outputListeners = new Map<string, Set<() => void>>();
  private readonly apiServer = new lotusApiServer(this);
  private statusBarItemEl!: HTMLElement;
  private editorViews = new Set<EditorView>();
  private lastMarkdownFilePath: string | null = null;
  private readonly logger = new lotusLogger(this.app, () => this.settings);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new lotusSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.registerBuiltInDisplayRenderers();
    this.registerView(LOTUS_LOG_VIEW_TYPE, (leaf) => new lotusLogView(leaf, this));
    this.addRibbonIcon("list-filter", "Open Lotus logs", () => {
      void this.openLogView();
    });
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });

    this.addCommand({
      id: "run-current-code-block",
      name: "Run current code block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }

        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new Notice("No supported Lotus block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      },
    });

    if (isCompileFeatureAllowed("rich-displays")) {
      this.addCommand({
        id: "visualize-current-code-block",
        name: "Visualize current code block",
        editorCallback: async (editor, view) => {
          const file = view.file;
          if (!file) {
            return;
          }

          const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
          const block = findBlockAtLine(blocks, editor.getCursor().line);
          if (!block) {
            new Notice("No supported Lotus block at the current cursor.");
            return;
          }
          await this.visualizeBlock(file, block);
        },
      });
    }

    this.addCommand({
      id: "run-all-code-blocks",
      name: "Run all supported code blocks in current note",
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
      id: "cancel-current-code-block",
      name: "Cancel current code block run",
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
      id: "cancel-all-code-blocks",
      name: "Cancel all running code blocks",
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
      id: "open-log-viewer",
      name: "Open log viewer",
      callback: () => {
        void this.openLogView();
      },
    });

    this.addCommand({
      id: "clear-note-outputs",
      name: "Clear outputs in current note",
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
      id: "save-reproducibility-snapshot",
      name: "Save reproducibility snapshot",
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
      id: "verify-reproducibility-snapshot",
      name: "Verify reproducibility snapshot",
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
      id: "set-reproducibility-policy",
      name: "Set reproducibility policy",
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
      id: "copy-reproducibility-snapshot",
      name: "Copy reproducibility snapshot",
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

    if (isCompileFeatureAllowed("signing")) {
      this.addCommand({
        id: "sign-current-note",
        name: "Sign current note",
        checkCallback: (checking) => {
          const file = this.getActiveMarkdownFile();
          if (!file) {
            return false;
          }
          if (!checking) {
            void this.signCurrentNote(file);
          }
          return true;
        },
      });

      this.addCommand({
        id: "verify-current-note-signature",
        name: "Verify current note signature",
        checkCallback: (checking) => {
          const file = this.getActiveMarkdownFile();
          if (!file) {
            return false;
          }
          if (!checking) {
            void this.verifyCurrentNoteSignature(file);
          }
          return true;
        },
      });

      this.addCommand({
        id: "copy-current-note-signature",
        name: "Copy current note signature",
        checkCallback: (checking) => {
          const file = this.getActiveMarkdownFile();
          if (!file) {
            return false;
          }
          if (!checking) {
            void this.copyCurrentNoteSignature(file);
          }
          return true;
        },
      });

      this.addCommand({
        id: "sign-all-notes",
        name: "Sign all notes",
        callback: () => {
          void this.signAllNotes();
        },
      });

      this.addCommand({
        id: "verify-all-note-signatures",
        name: "Verify all note signatures",
        callback: () => {
          void this.verifyAllNoteSignatures();
        },
      });

    }

    this.addCommand({
      id: "copy-note-hash",
      name: "Copy note hash",
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
      id: "copy-verification-report",
      name: "Copy reproducibility verification report",
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
      id: "hash-current-note",
      name: "Hash current note",
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
      id: "verify-current-note-hash",
      name: "Verify current note hash",
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
      id: "hash-current-code-block",
      name: "Hash current code block",
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
      id: "verify-code-block-hashes",
      name: "Verify code block hashes in current note",
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
        id: "validate-container-groups",
        name: "Validate container groups",
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
    void this.apiServer.configure();
  }

  onunload(): void {
    for (const controller of this.running.values()) {
      controller.abort();
    }
    void this.apiServer.stop();
    this.logger.close();
  }

  async loadSettings(): Promise<void> {
    const loadedData = readStoredSettings(await this.loadData());
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
    const packDir = normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/lotus`}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
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
    const packDir = normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/lotus`}/${EXTERNAL_LANGUAGE_PACK_DIR}`);
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
    await this.apiServer.configure();
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

  registerDisplayRenderer(renderer: lotusDisplayRenderer): () => void {
    if (!isCompileFeatureAllowed("rich-displays")) {
      return () => undefined;
    }
    this.validateDisplayRenderer(renderer);
    this.displayRenderers.add(renderer);
    this.notifyAllOutputsChanged();
    return () => {
      this.displayRenderers.delete(renderer);
      this.notifyAllOutputsChanged();
    };
  }

  private registerBuiltInDisplayRenderers(): void {
    if (!isCompileFeatureAllowed("rich-displays")) {
      return;
    }
    for (const renderer of createJavaScriptGraphDisplayRenderers()) {
      this.validateDisplayRenderer(renderer);
      this.displayRenderers.add(renderer);
    }
  }

  async openLogView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LOTUS_LOG_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Unable to open Lotus log viewer.");
      return;
    }

    await leaf.setViewState({ type: LOTUS_LOG_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof lotusLogView) {
      await view.refresh();
    }
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
      onTranspile: () => void this.runOrCancelBlockById(block.id, { intent: "transpile" }),
      onVisualize: () => void this.visualizeActiveBlockById(block.id),
      onEdit: () => void this.editBlock(block),
      onCopy: () => {
        void navigator.clipboard.writeText(block.content).then(() => {
          new Notice("Code copied");
        }).catch(() => {
          new Notice("Clipboard write failed.");
        });
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
      showTranspile: this.shouldShowTranspileButton(block),
      showVisualize: this.shouldShowCodeVisualizationButton(),
    });
  }

  shouldShowTranspileButton(block: lotusCodeBlock): boolean {
    return findEnabledCommandLanguage(this.settings, block.language, block.languageAlias)?.mode === "transpile";
  }

  shouldShowCodeVisualizationButton(): boolean {
    return isCompileFeatureAllowed("rich-displays") && (this.settings.showCodeVisualizationButton ?? true);
  }

  async editBlockById(blockId: string): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      new Notice("Could not find this Lotus block.");
      return;
    }

    await this.editBlock(block);
  }

  private async editBlock(block: lotusCodeBlock): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof TFile)) {
      new Notice("Could not open the note for this Lotus block.");
      return;
    }

    let leaf = this.app.workspace.getLeavesOfType("markdown")
      .find((candidate) => {
        const view = candidate.view;
        return view instanceof MarkdownView && view.file?.path === file.path;
      }) ?? this.app.workspace.getLeaf(false);

    await leaf.openFile(file);
    await this.setSourceModeForLeaf(leaf, true);
    leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? leaf;

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.editor) {
      new Notice("Open the note in editing mode to edit this Lotus block.");
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
      const liveRun = this.liveRuns.get(blockId);
      container.appendChild(createRunningPanel({
        runnerName: liveRun?.runnerName,
        stdout: liveRun?.stdout,
        stderr: liveRun?.stderr,
        inputEnabled: Boolean(liveRun?.inputSession),
        onSendInput: (input) => void this.sendLiveInput(blockId, input),
        onCloseInput: () => void this.closeLiveInput(blockId),
      }));
      return;
    }

    if (!output || !output.visible) {
      return;
    }

    container.appendChild(createOutputPanel(output, {
      defaultVisibleLines: this.settings.outputVisibleLines ?? 0,
      displayRenderers: [...this.displayRenderers],
    }));
  }

  private async sendLiveInput(blockId: string, input: string): Promise<void> {
    const liveRun = this.liveRuns.get(blockId);
    if (!liveRun?.inputSession) {
      new Notice("This running block is not accepting live input.");
      return;
    }

    const sent = liveRun.inputSession.send(input);
    if (!sent) {
      new Notice("The process stdin is not ready.");
      return;
    }

    await this.logEvent({
      type: "lotus.run.input",
      message: "Input sent to running block",
      notePath: liveRun.notePath,
      block: liveRun.block,
      target: liveRun.target,
      stdin: input,
      data: {
        bytes: input.length,
      },
    });
  }

  private async closeLiveInput(blockId: string): Promise<void> {
    const liveRun = this.liveRuns.get(blockId);
    if (!liveRun?.inputSession) {
      return;
    }

    liveRun.inputSession.close();
    liveRun.inputSession = null;
    this.notifyOutputChanged(blockId);
    await this.logEvent({
      type: "lotus.run.input.closed",
      message: "Closed running block input",
      notePath: liveRun.notePath,
      block: liveRun.block,
      target: liveRun.target,
    });
  }

  async runActiveBlockById(blockId: string, options: lotusRunBlockOptions = {}): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block, options);
  }

  async runOrCancelBlockById(blockId: string, options: lotusRunBlockOptions = {}): Promise<void> {
    if (this.running.has(blockId)) {
      const block = this.findActiveBlockById(blockId);
      await this.cancelBlockRun(blockId, "toolbar", block ?? undefined, block?.filePath);
      return;
    }
    await this.runActiveBlockById(blockId, options);
  }

  async visualizeActiveBlockById(blockId: string): Promise<void> {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.visualizeBlock(file, block);
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
    new Notice("Lotus cancellation requested.");
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
    new Notice("Lotus snippet removed.");
  }

  async runAllBlocksInFile(file: TFile): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = this.resolveExecutionContext(file, block);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });

    if (!supportedBlocks.length) {
      new Notice("No supported Lotus blocks found in the current note.");
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
    new Notice("Lotus outputs cleared.");
  }

  async listApiNotes(query?: string): Promise<lotusApiNote[]> {
    const normalizedQuery = query?.trim().toLowerCase() ?? "";
    const notes: lotusApiNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (normalizedQuery && !file.path.toLowerCase().includes(normalizedQuery) && !file.basename.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      const source = await this.app.vault.cachedRead(file);
      const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings)
        .filter((block) => this.isApiRunnableBlock(file, block));
      if (!blocks.length) {
        continue;
      }
      notes.push({
        path: file.path,
        title: file.basename,
        block_count: blocks.length,
        updated_at: new Date(file.stat.mtime).toISOString(),
      });
    }
    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async listApiBlocks(notePath: string): Promise<lotusApiBlock[]> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Note not found: ${notePath}`);
    }
    const source = await this.app.vault.cachedRead(file);
    return parseMarkdownCodeBlocks(file.path, source, this.settings)
      .filter((block) => this.isApiRunnableBlock(file, block))
      .map((block) => apiBlockFromCodeBlock(block, this.getApiBlockStatus(block.id)));
  }

  async getApiBlock(blockId: string): Promise<lotusApiBlock | null> {
    const target = await this.findApiBlockById(blockId);
    if (!target) {
      return null;
    }
    return apiBlockFromCodeBlock(target.block, this.getApiBlockStatus(target.block.id), { includeContent: true });
  }

  async updateApiBlockContent(blockId: string, content: string): Promise<lotusApiBlock | null> {
    const target = await this.findApiBlockById(blockId);
    if (!target) {
      return null;
    }

    const source = await this.app.vault.cachedRead(target.file);
    const lines = source.split(/\r?\n/);
    const replacement = content.split(/\r?\n/);
    lines.splice(
      target.block.startLine + 1,
      Math.max(0, target.block.endLine - target.block.startLine - 1),
      ...replacement,
    );
    const nextSource = lines.join("\n");
    await this.app.vault.modify(target.file, nextSource);
    this.outputs.delete(target.block.id);
    this.notifyOutputChanged(target.block.id);
    await this.writeCodeBlockHashesIfEnabled(target.file);

    const updatedSource = await this.app.vault.cachedRead(target.file);
    const updatedBlock = parseMarkdownCodeBlocks(target.file.path, updatedSource, this.settings)
      .filter((block) => this.isApiRunnableBlock(target.file, block))
      .find((block) => block.ordinal === target.block.ordinal);
    return updatedBlock
      ? apiBlockFromCodeBlock(updatedBlock, this.getApiBlockStatus(updatedBlock.id), { includeContent: true })
      : null;
  }

  async listApiRunners(): Promise<lotusApiRunner[]> {
    const builtIn = this.registry.getSupportedLanguages()
      .sort((a, b) => a.localeCompare(b))
      .map((language) => ({
        id: `obsidian:${language}`,
        name: `Lotus Obsidian ${language}`,
        language,
        source: "obsidian-plugin",
        command: null,
        executable: null,
        available: true,
        message: "Available through the Obsidian plugin",
      }));
    const custom = this.settings.customLanguages
      .map((language) => ({
        id: `obsidian:custom:${language.name}`,
        name: language.name,
        language: language.name,
        source: "obsidian-custom-language",
        command: [language.executable, language.args].filter(Boolean).join(" ") || null,
        executable: language.executable || null,
        available: true,
        message: "Configured custom Lotus language",
      }));
    return [...builtIn, ...custom];
  }

  async runApiBlock(blockId: string, options: lotusRunBlockOptions = {}): Promise<lotusApiRun> {
    const target = await this.findApiBlockById(blockId);
    if (!target) {
      throw new Error(`Block not found: ${blockId}`);
    }
    const output = await this.runBlock(target.file, target.block, options);
    if (output) {
      return apiRunFromStoredOutput(output);
    }
    const run = await this.getApiRun(blockId);
    if (!run) {
      throw new Error(`Run did not produce output: ${blockId}`);
    }
    return run;
  }

  async cancelApiRun(runId: string): Promise<lotusApiRun | null> {
    const block = await this.findApiBlockById(runId);
    if (this.running.has(runId)) {
      await this.cancelBlockRun(runId, "api", block?.block, block?.file.path);
    }
    return this.getApiRun(runId);
  }

  async listApiRuns(): Promise<lotusApiRun[]> {
    const liveRuns = [...this.liveRuns.entries()].map(([blockId, run]) => ({
      id: blockId,
      block_id: blockId,
      note_path: run.notePath,
      status: "running" as const,
      runner_id: run.target.runnerId ?? "pending",
      runner_name: run.runnerName,
      started_at: run.startedAt,
      finished_at: null,
      exit_code: null,
      duration_ms: null,
      stdout: run.stdout,
      stderr: run.stderr,
      warning: null,
    }));
    const storedRuns = [...this.outputs.values()].map(apiRunFromStoredOutput);
    const seen = new Set(liveRuns.map((run) => run.id));
    return [
      ...liveRuns,
      ...storedRuns.filter((run) => !seen.has(run.id)),
    ];
  }

  async getApiRun(runId: string): Promise<lotusApiRun | null> {
    const liveRun = this.liveRuns.get(runId);
    if (liveRun) {
      return {
        id: runId,
        block_id: runId,
        note_path: liveRun.notePath,
        status: "running",
        runner_id: liveRun.target.runnerId ?? "pending",
        runner_name: liveRun.runnerName,
        started_at: liveRun.startedAt,
        finished_at: null,
        exit_code: null,
        duration_ms: null,
        stdout: liveRun.stdout,
        stderr: liveRun.stderr,
        warning: null,
      };
    }
    const output = this.outputs.get(runId);
    return output ? apiRunFromStoredOutput(output) : null;
  }

  async listApiLogs(limit: number): Promise<lotusApiLogEvent[]> {
    return readApiLogEvents(this, limit);
  }

  private isApiRunnableBlock(file: TFile, block: lotusCodeBlock): boolean {
    const executionContext = this.resolveExecutionContext(file, block);
    return Boolean(executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings));
  }

  private getApiBlockStatus(blockId: string): lotusApiBlock["status"] {
    if (this.running.has(blockId)) {
      return "running";
    }
    const output = this.outputs.get(blockId);
    if (!output) {
      return "idle";
    }
    if (output.result.cancelled) {
      return "cancelled";
    }
    return output.result.success ? "succeeded" : "failed";
  }

  private async findApiBlockById(blockId: string): Promise<{ file: TFile; block: lotusCodeBlock } | null> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.cachedRead(file);
      const block = parseMarkdownCodeBlocks(file.path, source, this.settings)
        .find((candidate) => candidate.id === blockId);
      if (block) {
        return { file, block };
      }
    }
    return null;
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

  async signCurrentNote(file: TFile): Promise<void> {
    const material = await this.requestSignatureMaterial("Sign Current Note", this.settings.signingMode || "passphrase", "sign");
    if (!material) {
      return;
    }

    try {
      const signature = await this.signNote(file, material);
      new Notice(`lotus note signed with ${formatSignatureScheme(signature.scheme)} (${signature.keyId}).`);
    } catch (error) {
      new Notice(`lotus signing failed: ${formatErrorMessage(error)}`, 12000);
    }
  }

  async verifyCurrentNoteSignature(file: TFile): Promise<void> {
    try {
      const source = await this.app.vault.cachedRead(file);
      const signature = readStoredSignature(source);
      if (!signature) {
        new Notice("No Lotus-signature found. Run Lotus: Sign current note first.");
        return;
      }

      const material = signature.scheme === "passphrase-hmac-sha256"
        ? await this.requestSignatureMaterial("Verify Current Note Signature", "passphrase", "verify")
        : null;
      if (signature.scheme === "passphrase-hmac-sha256" && !material) {
        return;
      }

      const result = await this.verifyNoteSignature(file, source, signature, material ?? undefined);
      new Notice(result.summary, result.verified ? 6000 : 12000);
    } catch (error) {
      new Notice(`lotus signature verification failed: ${formatErrorMessage(error)}`, 12000);
    }
  }

  async copyCurrentNoteSignature(file: TFile): Promise<void> {
    const signature = readStoredSignature(await this.app.vault.cachedRead(file));
    if (!signature) {
      new Notice("No valid Lotus-signature found. Run Lotus: Sign current note first.");
      return;
    }
    await this.copyTextToClipboard(JSON.stringify(signature, null, 2), "Note signature copied.");
  }

  async signAllNotes(): Promise<void> {
    const material = await this.requestSignatureMaterial("Sign All Notes", this.settings.signingMode || "passphrase", "sign");
    if (!material) {
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    let signed = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        await this.signNote(file, material);
        signed += 1;
      } catch (error) {
        failures.push(`${file.path}: ${formatErrorMessage(error)}`);
      }
    }

    const summary = failures.length
      ? `lotus signed ${signed}/${files.length} notes; ${failures.length} failed.`
      : `lotus signed ${signed} note${signed === 1 ? "" : "s"}.`;
    await this.logEvent({
      type: "lotus.signature.all.created",
      message: summary,
      data: {
        signed,
        total: files.length,
        failures: failures.length,
      },
    });
    new Notice(summary, failures.length ? 12000 : 6000);
  }

  async verifyAllNoteSignatures(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const signatures = new Map<TFile, lotusSignatureRecord>();
    let needsPassphrase = false;
    for (const file of files) {
      const signature = readStoredSignature(await this.app.vault.cachedRead(file));
      if (signature) {
        signatures.set(file, signature);
        needsPassphrase = needsPassphrase || signature.scheme === "passphrase-hmac-sha256";
      }
    }

    const material = needsPassphrase
      ? await this.requestSignatureMaterial("Verify All Note Signatures", "passphrase", "verify")
      : undefined;
    if (needsPassphrase && !material) {
      return;
    }

    let verified = 0;
    const failures: string[] = [];
    for (const file of files) {
      const signature = signatures.get(file);
      if (!signature) {
        failures.push(`${file.path}: missing signature`);
        continue;
      }
      const source = await this.app.vault.cachedRead(file);
      const result = await this.verifyNoteSignature(file, source, signature, material ?? undefined);
      if (result.verified) {
        verified += 1;
      } else {
        failures.push(`${file.path}: ${result.summary}`);
      }
    }

    const summary = failures.length
      ? `lotus verified ${verified}/${files.length} note signatures; ${failures.length} failed.`
      : `lotus verified ${verified} note signature${verified === 1 ? "" : "s"}.`;
    await this.logEvent({
      type: "lotus.signature.all.verify.finished",
      message: summary,
      data: {
        verified,
        total: files.length,
        failures: failures.length,
      },
    });
    new Notice(summary, failures.length ? 12000 : 6000);
  }

  private async signNote(file: TFile, material: lotusSignatureMaterial): Promise<lotusSignatureRecord> {
    const source = await this.app.vault.cachedRead(file);
    const snapshot = this.createReproducibilitySnapshot(file.path, source);
    const payload = this.createSignaturePayload(snapshot);
    const payloadText = stableStringify(payload);
    const signature = material.mode === "passphrase"
      ? createPassphraseSignature(payloadText, material.passphrase ?? "", this.settings.signingSignerId)
      : material.mode === "ssh"
        ? await createOpenSshSignature(
          payloadText,
          await this.resolveSshSigningKeyPath(),
          this.settings.signingSshNamespace,
          this.readSshSignerIdentity(),
          await this.createSshKeyId(),
          this.createSigningSshEnv(),
        )
        : createRsaSignature(payloadText, await this.resolvePrivateKeyPem(material), material.privateKeyPassphrase, this.settings.signingSignerId);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const target = frontmatter as Record<string, unknown>;
      target[REPRODUCIBILITY_FRONTMATTER_KEY] = snapshot;
      target[NOTE_HASH_FRONTMATTER_KEY] = snapshot.noteHash;
      target[CODE_BLOCK_HASHES_FRONTMATTER_KEY] = snapshot.blocks;
      target[SIGNATURE_FRONTMATTER_KEY] = signature;
    });
    await this.logEvent({
      type: "lotus.signature.created",
      message: "Note signature written",
      notePath: file.path,
      data: {
        scheme: signature.scheme,
        keyId: signature.keyId,
        payloadHash: signature.payloadHash,
        blocks: snapshot.blocks.length,
      },
    });
    await this.logEvent({
      type: "lotus.note.modified",
      message: "Wrote note signature frontmatter",
      notePath: file.path,
      data: {
        action: "signature.created",
        scheme: signature.scheme,
      },
    });
    return signature;
  }

  private createSignaturePayload(snapshot: lotusReproducibilitySnapshot): lotusSignaturePayload {
    return {
      version: 1,
      scope: "note",
      noteHash: snapshot.noteHash,
      policy: snapshot.policy,
      blocks: snapshot.blocks,
    };
  }

  private async verifyNoteSignature(file: TFile, source: string, signature: lotusSignatureRecord, material?: lotusSignatureMaterial): Promise<{ verified: boolean; summary: string }> {
    const snapshot = this.createReproducibilitySnapshot(file.path, source);
    const payloadText = stableStringify(this.createSignaturePayload(snapshot));
    const payloadHash = sha256Hash(payloadText);
    let verified = false;

    if (signature.payloadHash !== payloadHash) {
      verified = false;
    } else if (signature.scheme === "passphrase-hmac-sha256") {
      verified = typeof material?.passphrase === "string" && material.passphrase.length > 0
        ? verifyPassphraseSignature(signature, payloadText, material.passphrase)
        : false;
    } else if (signature.scheme === "openssh-sshsig") {
      verified = signature.ssh?.namespace === this.settings.signingSshNamespace
        && await verifyOpenSshSignature(signature, payloadText, await this.resolveSshAllowedSigners(signature));
    } else {
      verified = verifyRsaSignature(signature, payloadText, await this.resolvePublicKeyPem());
    }

    const summary = verified
      ? `lotus signature verified (${formatSignatureScheme(signature.scheme)}, ${signature.keyId}).`
      : signature.payloadHash !== payloadHash
        ? `lotus signature payload changed. stored=${signature.payloadHash.slice(0, 12)} current=${payloadHash.slice(0, 12)}`
        : signature.scheme === "openssh-sshsig" && signature.ssh?.namespace !== this.settings.signingSshNamespace
          ? `lotus signature namespace mismatch. stored=${signature.ssh?.namespace ?? "(missing)"} expected=${this.settings.signingSshNamespace}`
        : `lotus signature cryptographic check failed (${formatSignatureScheme(signature.scheme)}, ${signature.keyId}).`;
    await this.logEvent({
      type: "lotus.signature.verify.finished",
      message: summary,
      notePath: file.path,
      data: {
        status: verified ? "verified" : "changed",
        scheme: signature.scheme,
        keyId: signature.keyId,
        payloadHash,
      },
    });
    return { verified, summary };
  }

  private async requestSignatureMaterial(title: string, mode: "passphrase" | "rsa" | "ssh", action: "sign" | "verify"): Promise<lotusSignatureMaterial | null> {
    if (mode === "ssh" || (mode === "rsa" && action === "verify")) {
      return { mode };
    }

    return await new Promise<lotusSignatureMaterial | null>((resolve) => {
      new SignatureMaterialModal(this.app, {
        title,
        mode,
        action,
        hasPrivateKeyPath: false,
        cachedPassphrase: mode === "passphrase" ? this.cachedSigningPassphrase ?? undefined : undefined,
        onSubmit: (material) => {
          if (material.mode === "passphrase" && material.rememberForSession && material.passphrase) {
            this.cachedSigningPassphrase = material.passphrase;
          }
          resolve(material);
        },
        onCancel: () => resolve(null),
      }).open();
    });
  }

  private async resolvePrivateKeyPem(material: lotusSignatureMaterial): Promise<string> {
    const pasted = material.privateKeyPem?.trim();
    if (pasted) {
      return pasted;
    }
    throw new Error("No RSA private key was provided.");
  }

  private async resolvePublicKeyPem(): Promise<string> {
    const path = this.settings.signingPublicKeyPath.trim();
    if (path) {
      return await this.readConfiguredTextPath(path);
    }
    const pasted = this.settings.signingPublicKey.trim();
    if (pasted) {
      return pasted;
    }
    throw new Error("No RSA public key is configured.");
  }

  private async resolveSshSigningKeyPath(): Promise<string> {
    const path = this.settings.signingSshKeyPath.trim();
    if (!path) {
      throw new Error("No OpenSSH signing key file is configured.");
    }
    const resolved = this.resolveConfiguredFsPath(path);
    if (isAbsolute(resolved)) {
      return resolved;
    }
    return this.resolveVaultRelativeFsPath(resolved);
  }

  private async createSshKeyId(): Promise<string> {
    const configuredPath = this.settings.signingSshKeyPath.trim();
    if (!configuredPath) {
      return `ssh:${sha256Hash(this.readSshSignerIdentity()).slice(0, 32)}`;
    }
    const publicKey = await this.readOpenSshPublicKeyForPath(configuredPath);
    return `ssh:${sha256Hash(publicKey ?? configuredPath).slice(0, 32)}`;
  }

  private async resolveSshAllowedSigners(signature: lotusSignatureRecord): Promise<string> {
    const path = this.settings.signingSshAllowedSignersPath.trim();
    if (path) {
      return await this.readConfiguredTextPath(path);
    }
    const pasted = this.settings.signingSshAllowedSigners.trim();
    if (pasted) {
      return pasted.endsWith("\n") ? pasted : `${pasted}\n`;
    }

    const publicKey = await this.resolveOpenSshPublicKey();
    const signer = signature.ssh?.signerIdentity || this.readSshSignerIdentity();
    const namespace = signature.ssh?.namespace || this.settings.signingSshNamespace;
    return `${signer} namespaces="${namespace}" ${publicKey.trim()}\n`;
  }

  private async resolveOpenSshPublicKey(): Promise<string> {
    const path = this.settings.signingPublicKeyPath.trim();
    if (path) {
      return await this.readConfiguredTextPath(path);
    }
    const pasted = this.settings.signingPublicKey.trim();
    if (pasted) {
      return pasted;
    }
    const keyPath = this.settings.signingSshKeyPath.trim();
    const adjacentPublicKey = keyPath ? await this.readOpenSshPublicKeyForPath(keyPath) : null;
    if (adjacentPublicKey) {
      return adjacentPublicKey;
    }
    throw new Error("No OpenSSH allowed signers or public key is configured.");
  }

  private async readOpenSshPublicKeyForPath(rawPath: string): Promise<string | null> {
    const resolved = this.resolveConfiguredFsPath(rawPath);
    const candidates = resolved.endsWith(".pub") ? [resolved] : [`${resolved}.pub`, resolved];
    for (const candidate of candidates) {
      try {
        const text = isAbsolute(candidate)
          ? await readFile(candidate, "utf8")
          : await this.app.vault.adapter.read(candidate);
        if (/^(ssh|ecdsa)-[A-Za-z0-9@.-]+\s+[A-Za-z0-9+/=]+/.test(text.trim())) {
          return text.trim();
        }
      } catch {
        // Try the next public key candidate.
      }
    }
    return null;
  }

  private readSshSignerIdentity(): string {
    const signer = this.settings.signingSignerId.trim();
    return signer || "lotus-signer";
  }

  private createSigningSshEnv(): NodeJS.ProcessEnv | undefined {
    const authSock = this.settings.signingSshAuthSock.trim();
    return authSock ? { ...process.env, SSH_AUTH_SOCK: authSock } : undefined;
  }

  private async readConfiguredTextPath(rawPath: string): Promise<string> {
    const expanded = this.resolveConfiguredFsPath(rawPath);
    if (isAbsolute(expanded)) {
      return await readFile(expanded, "utf8");
    }
    return await this.app.vault.adapter.read(normalizePath(expanded));
  }

  private resolveConfiguredFsPath(rawPath: string): string {
    return rawPath.startsWith("~/") ? join(homedir(), rawPath.slice(2)) : normalizePath(rawPath);
  }

  private resolveVaultRelativeFsPath(vaultPath: string): string {
    const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
    return basePath ? join(basePath, vaultPath) : vaultPath;
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
      new Notice("No Lotus-note-hash found. Run Lotus: Hash current note first.");
      return;
    }

    const currentHash = sha256Hash(canonicalizeNoteForHash(source));
    if (storedHash === currentHash) {
      new Notice("Lotus note hash verified.");
      return;
    }

    new Notice(`lotus note hash mismatch. stored=${storedHash.slice(0, 12)} current=${currentHash.slice(0, 12)}`, 10000);
  }

  async hashCurrentCodeBlock(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      new Notice("Open a markdown note in editing mode to hash the current code block.");
      return;
    }

    const source = editor.getValue();
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const block = findBlockAtLine(blocks, editor.getCursor().line);
    if (!block) {
      new Notice("No supported Lotus block at the current cursor.");
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
      new Notice("No Lotus-code-block-hashes found. Run Lotus: Hash current code block first.");
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

  async runBlock(file: TFile, block: lotusCodeBlock, options: lotusRunBlockOptions = {}): Promise<lotusStoredOutput | null> {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new Notice("This Lotus block is already running.");
      return this.outputs.get(block.id) ?? null;
    }

    if (!(await this.ensureExecutionEnabled())) {
      showExecutionDisabledNotice();
      return null;
    }
    if (options.intent === "transpile" && !this.shouldShowTranspileButton(block)) {
      new Notice("This block is not configured for transpile mode.");
      return null;
    }

    const executionContext = this.resolveExecutionContext(file, block);
    const containerGroup = executionContext.containerGroup;
    const controller = new AbortController();
    const stdin = await this.resolveBlockStdin(file, block);
    let runnerName = containerGroup ? `execution group ${containerGroup}` : "preparing";
    let runnerId = containerGroup ? `container:${containerGroup}` : "pending";
    const noteHash = await this.readCurrentNoteHash(file.path);
    let logTarget: lotusLogTarget = {
      runnerId,
      runnerName,
      containerGroup,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      source: executionContext.source,
    };
    const inputSession = stdin == null ? new lotusLiveStdinSession() : null;
    const liveRun: lotusLiveRunState = {
      inputSession,
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString(),
      runnerName,
      notePath: file.path,
      block,
      target: logTarget,
    };
    const appendLiveOutput = (stream: "stdout" | "stderr", chunk: string) => {
      liveRun[stream] = trimLiveOutput(liveRun[stream] + chunk);
      this.notifyOutputChanged(block.id);
    };
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal,
      stdin,
      stdinSession: inputSession ?? undefined,
      onStdout: (chunk: string) => appendLiveOutput("stdout", chunk),
      onStderr: (chunk: string) => appendLiveOutput("stderr", chunk),
    };
    this.running.set(block.id, controller);
    this.liveRuns.set(block.id, liveRun);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();

    let storedOutput: lotusStoredOutput | null = null;
    try {
      const resolvedBlock = await this.resolveExecutableBlock(file, block, controller.signal);
      const runner = containerGroup ? null : this.registry.getRunnerForBlock(resolvedBlock.block, this.settings);
      if (!containerGroup && !runner) {
        throw new Error(`No configured runner for ${resolvedBlock.block.language}.`);
      }

      runnerName = containerGroup ? `execution group ${containerGroup}` : runner!.displayName;
      runnerId = containerGroup ? `container:${containerGroup}` : runner!.id;
      logTarget = {
        ...logTarget,
        runnerId,
        runnerName,
      };
      liveRun.runnerName = runnerName;
      liveRun.target = logTarget;
      this.notifyOutputChanged(block.id);
      await this.logEvent({
        type: "lotus.run.started",
        message: "Code block started",
        notePath: file.path,
        noteHash,
        block: resolvedBlock.block,
        target: logTarget,
        stdin,
        data: {
          runnerName,
          containerGroup,
          workingDirectory: executionContext.workingDirectory,
          timeoutMs: executionContext.timeoutMs,
          stdinBytes: stdin?.length ?? 0,
          intent: options.intent ?? "run",
          noteHash,
          sourceLanguage: block.language,
          executionLanguage: resolvedBlock.block.language,
        },
      });
      const result = containerGroup
        ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup)
        : await runner!.run(resolvedBlock.block, runContext, this.settings);

      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${formatTimeoutMs(executionContext.timeoutMs)}.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }

      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}\n${result.warning}` : sourceNotice;
      }
      if (resolvedBlock.preprocessDescription) {
        const preprocessorNotice = `Ran preprocessed source with ${resolvedBlock.preprocessDescription}.`;
        result.warning = result.warning ? `${preprocessorNotice}\n${result.warning}` : preprocessorNotice;
      }
      if (this.hasExplicitExecutionContext(executionContext)) {
        const contextNotice = this.formatExecutionContextNotice(executionContext);
        result.warning = result.warning ? `${contextNotice}\n${result.warning}` : contextNotice;
      }
      await this.prepareDisplayOutputs(file, block, result, executionContext, controller.signal, options);
      await this.writeOutputFileIfRequested(file, block, result);

      storedOutput = {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
        collapsed: false,
        visible: true,
      };
      this.outputs.set(block.id, storedOutput);

      const requestedWrite = options.writePolicy === "write-replace" || options.writePolicy === "write-append";
      if (this.settings.writeOutputToNote || requestedWrite) {
        await this.writeManagedOutputBlock(file, block, result, options.writePolicy === "write-append" ? "append" : "replace");
      }

      await this.logger.logRunFinished(file.path, block, runnerName, result, {
        containerGroup,
        workingDirectory: executionContext.workingDirectory,
        timeoutMs: executionContext.timeoutMs,
        sourceReference: Boolean(block.sourceReference),
        executionLanguage: resolvedBlock.block.language,
        intent: options.intent ?? "run",
        noteHash,
      }, logTarget, await this.readCurrentNoteHash(file.path));
      const transpiled = options.intent === "transpile" || result.stdoutRole === "transpiled-source";
      new Notice(result.success
        ? transpiled ? `lotus transpiled ${block.language} block.` : `lotus ran ${runnerName} block.`
        : transpiled ? `lotus transpile failed for ${block.language}.` : `lotus run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      storedOutput = {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId,
          runnerName,
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
      };
      this.outputs.set(block.id, storedOutput);
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
      inputSession?.close();
      this.liveRuns.delete(block.id);
      await this.writeCodeBlockHashesIfEnabled(file);
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
    return storedOutput;
  }

  async visualizeBlock(file: TFile, block: lotusCodeBlock): Promise<void> {
    if (!isCompileFeatureAllowed("rich-displays")) {
      new Notice("Lotus rich displays are not included in this build.");
      return;
    }

    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new Notice("This Lotus block is already running.");
      return;
    }

    const executionContext = this.resolveExecutionContext(file, block);
    if ((executionContext.containerGroup || this.settings.graphvizExecutable.trim()) && !(await this.ensureExecutionEnabled())) {
      showExecutionDisabledNotice();
      return;
    }

    const controller = new AbortController();
    const started = Date.now();
    const startedAt = new Date().toISOString();
    const result: lotusStoredOutput["result"] = {
      runnerId: "visualization:source",
      runnerName: "Code visualization",
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      exitCode: 0,
      stdout: "",
      stderr: "",
      success: true,
      timedOut: false,
      cancelled: false,
      displays: [createSourceVisualizationDisplay(block)],
    };

    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();

    try {
      result.displays = await Promise.all(
        (result.displays ?? []).map((display) => this.enrichGraphvizDisplay(display, file, block, executionContext, controller.signal, result)),
      );
      result.finishedAt = new Date().toISOString();
      result.durationMs = Date.now() - started;
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        collapsed: false,
        visible: true,
      });
      await this.logger.logRunFinished(file.path, block, result.runnerName, result, {
        visualization: "source",
        language: block.language,
      }, {
          runnerId: result.runnerId,
          runnerName: result.runnerName,
          containerGroup: executionContext.containerGroup,
          workingDirectory: executionContext.workingDirectory,
          timeoutMs: executionContext.timeoutMs,
          source: executionContext.source,
      }, await this.readCurrentNoteHash(file.path));
      new Notice(`lotus visualized ${block.language} block.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.success = false;
      result.exitCode = -1;
      result.stderr = message;
      result.finishedAt = new Date().toISOString();
      result.durationMs = Date.now() - started;
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        collapsed: false,
        visible: true,
      });
      new Notice(`lotus visualization failed: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }

  private async prepareDisplayOutputs(
    file: TFile,
    block: lotusCodeBlock,
    result: lotusStoredOutput["result"],
    executionContext: lotusResolvedExecutionContext,
    signal: AbortSignal,
    options: lotusRunBlockOptions,
  ): Promise<void> {
    if (!isCompileFeatureAllowed("rich-displays")) {
      delete result.displays;
      return;
    }

    const displays = [...(result.displays ?? [])];
    const requestedMode = this.readVisualizationMode(block, options.visualize);

    if (requestedMode && !displays.length) {
      const synthesized = this.createDisplayFromStdout(result.stdout, requestedMode)
        ?? (requestedMode === "graphviz" ? createSourceVisualizationDisplay(block) : null);
      if (synthesized) {
        displays.push(synthesized);
      }
    }

    const enriched: lotusDisplayOutput[] = [];
    for (const display of displays) {
      enriched.push(await this.enrichGraphvizDisplay(display, file, block, executionContext, signal, result));
    }

    if (enriched.length) {
      result.displays = enriched;
    } else {
      delete result.displays;
    }
  }

  private readVisualizationMode(block: lotusCodeBlock, explicitVisualize: boolean | undefined): lotusVisualizationMode | null {
    const raw = block.attributes["lotus-visualize"]
      ?? block.attributes.visualize
      ?? block.attributes["lotus-display"]
      ?? block.attributes.display
      ?? block.attributes["lotus-visualizer"]
      ?? block.attributes.visualizer;
    const normalized = raw?.trim().toLowerCase();

    if (normalized) {
      if (["graphviz", "dot", "gv", "cfg"].includes(normalized)) {
        return "graphviz";
      }
      if (normalized === "svg" || normalized === "image/svg+xml") {
        return "svg";
      }
      if (["0", "false", "no", "off", "none"].includes(normalized)) {
        return null;
      }
    }

    return explicitVisualize ? "graphviz" : null;
  }

  private createDisplayFromStdout(stdout: string, mode: lotusVisualizationMode): lotusDisplayOutput | null {
    return createStdoutVisualizationDisplay(stdout, mode);
  }

  private async enrichGraphvizDisplay(
    display: lotusDisplayOutput,
    file: TFile,
    block: lotusCodeBlock,
    executionContext: lotusResolvedExecutionContext,
    signal: AbortSignal,
    result: lotusStoredOutput["result"],
  ): Promise<lotusDisplayOutput> {
    if (display.data["image/svg+xml"] != null) {
      return display;
    }

    const dot = typeof display.data["text/vnd.graphviz"] === "string" ? display.data["text/vnd.graphviz"] : "";
    const executable = this.settings.graphvizExecutable?.trim();
    if (!dot.trim() || (!executionContext.containerGroup && !executable)) {
      return display;
    }

    try {
      const svg = await this.renderGraphvizSvg(dot, executable || "dot", file, block, executionContext, signal);
      return {
        ...display,
        data: {
          ...display.data,
          "image/svg+xml": svg,
        },
      };
    } catch (error) {
      result.warning = appendWarning(result.warning, `Graphviz display render failed: ${formatErrorMessage(error)}`);
      return display;
    }
  }

  private async renderGraphvizSvg(
    dot: string,
    executable: string,
    file: TFile,
    block: lotusCodeBlock,
    executionContext: lotusResolvedExecutionContext,
    signal: AbortSignal,
  ): Promise<string> {
    const containerGroup = executionContext.containerGroup;
    if (containerGroup) {
      const containerResult = await this.containerRunner.run(this.createGraphvizBlock(block, dot), {
        file,
        workingDirectory: executionContext.workingDirectory,
        timeoutMs: executionContext.timeoutMs,
        signal,
      }, this.settings, containerGroup);
      if (!containerResult.success) {
        throw new Error(containerResult.stderr || containerResult.stdout || `Graphviz exited with ${containerResult.exitCode ?? "unknown status"}`);
      }
      const containerSvg = containerResult.stdout.trim();
      if (!containerSvg) {
        throw new Error("Graphviz produced no SVG output.");
      }
      return containerSvg;
    }

    const result = await runProcess({
      runnerId: "display:graphviz",
      runnerName: "Graphviz",
      executable,
      args: ["-Tsvg"],
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal,
      stdin: dot,
    });

    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `Graphviz exited with ${result.exitCode ?? "unknown status"}`);
    }

    const svg = result.stdout.trim();
    if (!svg) {
      throw new Error("Graphviz produced no SVG output.");
    }
    return svg;
  }

  private createGraphvizBlock(block: lotusCodeBlock, dot: string): lotusCodeBlock {
    return {
      ...block,
      id: `${block.id}:graphviz`,
      language: "graphviz",
      languageAlias: "graphviz",
      sourceLanguage: "graphviz",
      content: dot,
      attributes: {},
      executionContext: {},
    };
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

  private async resolveExecutableBlock(file: TFile, block: lotusCodeBlock, signal?: AbortSignal): Promise<{ block: lotusCodeBlock; sourcePreview?: lotusStoredOutput["sourcePreview"]; preprocessDescription?: string }> {
    let executableBlock = block;
    let sourcePreview: lotusStoredOutput["sourcePreview"] | undefined;
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";

    if (block.sourceReference) {
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
      executableBlock = {
        ...block,
        content: resolved.content,
      };
      const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
      sourcePreview = shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true,
      } : undefined;
    }

    const preprocessorPipeline = this.getCustomLanguagePreprocessorPipeline(block, file, signal);
    if (!preprocessorPipeline) {
      return { block: executableBlock, sourcePreview };
    }

    const preprocessed = await runExternalSourcePreprocessorPipeline(executableBlock.content, executableBlock, preprocessorPipeline);
    const preprocessDescription = `${preprocessed.description || preprocessorPipeline.languageName} (artifacts: ${preprocessed.artifactDirectory})`;
    const capability = getLanguageCapability(preprocessed.block.language);
    return {
      block: preprocessed.block,
      sourcePreview: shouldShowPreview
        ? {
          description: sourcePreview
            ? `${sourcePreview.description}; preprocessed by ${preprocessed.description || preprocessorPipeline.languageName}`
            : `preprocessed by ${preprocessed.description || preprocessorPipeline.languageName}`,
          language: preprocessed.block.language,
          content: preprocessed.block.content,
          capability,
          stages: preprocessed.stages,
          expanded: this.settings.extractedSourcePreviewMode === "expanded",
          showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true,
        }
        : undefined,
      preprocessDescription,
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
      new Notice("Lotus container groups are not included in this build.");
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
      const inheritedHighlightLanguage = this.getCustomHighlightLanguage(block);
      if (inheritedHighlightLanguage) {
        this.applyRenderedCodeHighlightInheritance(code, block.content, inheritedHighlightLanguage);
      } else if (block.language === "llvm-ir") {
        highlightLlvmElement(code, block.content);
      }
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

  private getCustomHighlightLanguage(block: lotusCodeBlock): string | null {
    const language = findEnabledCommandLanguage(this.settings, block.language, block.languageAlias);
    const configured = language?.highlightLanguage?.trim();
    if (!configured) {
      return null;
    }
    return normalizeLanguage(configured, this.settings) ?? normalizeSyntaxLanguage(configured);
  }

  private applyRenderedCodeHighlightInheritance(code: HTMLElement, source: string, language: string): void {
    const normalized = normalizeSyntaxLanguage(language);
    if (!normalized) {
      return;
    }
    addSyntaxLanguageClass(code, normalized);
    if (code.parentElement instanceof HTMLElement) {
      addSyntaxLanguageClass(code.parentElement, normalized);
    }
    highlightCodeElement(code, source, normalized);
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
    this.refreshAllViews();
  }

  private validateDisplayRenderer(renderer: lotusDisplayRenderer): void {
    if (!renderer || typeof renderer.render !== "function") {
      throw new Error("Lotus display renderer must provide a render function.");
    }
    if (
      !Array.isArray(renderer.mimeTypes)
      || !renderer.mimeTypes.some((mime) => typeof mime === "string" && mime.trim())
    ) {
      throw new Error("Lotus display renderer must provide at least one MIME type.");
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
    if (this.settings.signingMode !== "passphrase" && this.settings.signingMode !== "rsa" && this.settings.signingMode !== "ssh") {
      this.settings.signingMode = DEFAULT_SETTINGS.signingMode;
    }
    this.settings.signingSignerId = normalizeStringSetting(this.settings.signingSignerId, DEFAULT_SETTINGS.signingSignerId);
    this.settings.signingPublicKey = typeof this.settings.signingPublicKey === "string"
      ? this.settings.signingPublicKey
      : DEFAULT_SETTINGS.signingPublicKey;
    this.settings.signingPublicKeyPath = normalizeStringSetting(this.settings.signingPublicKeyPath, DEFAULT_SETTINGS.signingPublicKeyPath);
    this.settings.signingSshKeyPath = normalizeStringSetting(this.settings.signingSshKeyPath, DEFAULT_SETTINGS.signingSshKeyPath);
    this.settings.signingSshAuthSock = normalizeStringSetting(this.settings.signingSshAuthSock, DEFAULT_SETTINGS.signingSshAuthSock);
    this.settings.signingSshAllowedSigners = typeof this.settings.signingSshAllowedSigners === "string"
      ? this.settings.signingSshAllowedSigners
      : DEFAULT_SETTINGS.signingSshAllowedSigners;
    this.settings.signingSshAllowedSignersPath = normalizeStringSetting(this.settings.signingSshAllowedSignersPath, DEFAULT_SETTINGS.signingSshAllowedSignersPath);
    this.settings.signingSshNamespace = normalizeStringSetting(this.settings.signingSshNamespace, DEFAULT_SETTINGS.signingSshNamespace);
    this.settings.showObsidianContextWarning = this.settings.showObsidianContextWarning ?? DEFAULT_SETTINGS.showObsidianContextWarning;
    if (!SUPPORTED_PDF_EXPORT_MODES.has(this.settings.pdfExportMode)) {
      this.settings.pdfExportMode = DEFAULT_SETTINGS.pdfExportMode;
    }
    this.settings.loggingEnabled = isCompileLoggingForced() || Boolean(this.settings.loggingEnabled);
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
    this.settings.loggingViewerJsonlPath = normalizeStringSetting(this.settings.loggingViewerJsonlPath, this.settings.loggingGlobalJsonlPath || DEFAULT_SETTINGS.loggingViewerJsonlPath);
    this.settings.loggingRedactionRules = typeof this.settings.loggingRedactionRules === "string"
      ? this.settings.loggingRedactionRules
      : DEFAULT_SETTINGS.loggingRedactionRules;
    if (!SUPPORTED_LOGGING_NOTE_PATH_MODES.has(this.settings.loggingNotePathMode)) {
      this.settings.loggingNotePathMode = DEFAULT_SETTINGS.loggingNotePathMode;
    }
    const compileMachineHashScope = getCompileMachineHashScopeOverride();
    if (compileMachineHashScope) {
      this.settings.loggingMachineHashScope = compileMachineHashScope;
    } else if (!SUPPORTED_LOGGING_MACHINE_HASH_SCOPES.has(this.settings.loggingMachineHashScope)) {
      this.settings.loggingMachineHashScope = DEFAULT_SETTINGS.loggingMachineHashScope;
    }
    this.settings.loggingMaxEventBytes = normalizePositiveInteger(this.settings.loggingMaxEventBytes, DEFAULT_SETTINGS.loggingMaxEventBytes);
    this.settings.apiEnabled = Boolean(this.settings.apiEnabled);
    this.settings.apiHost = normalizeApiHost(this.settings.apiHost, DEFAULT_SETTINGS.apiHost);
    this.settings.apiPort = normalizePort(this.settings.apiPort, DEFAULT_SETTINGS.apiPort);
    this.settings.apiKeys = typeof this.settings.apiKeys === "string" ? this.settings.apiKeys : DEFAULT_SETTINGS.apiKeys;
    this.settings.defaultContainerGroup = isCompileFeatureAllowed("container-groups")
      ? normalizeStringSetting(this.settings.defaultContainerGroup, DEFAULT_SETTINGS.defaultContainerGroup)
      : "";
    if (this.settings.defaultContainerGroup && !isCompileContainerGroupAllowed(this.settings.defaultContainerGroup)) {
      this.settings.defaultContainerGroup = "";
    }
    this.settings.workingDirectory = normalizeStringSetting(this.settings.workingDirectory, DEFAULT_SETTINGS.workingDirectory);
    this.settings.graphvizExecutable = isCompileFeatureAllowed("rich-displays")
      ? normalizeStringSetting(this.settings.graphvizExecutable, DEFAULT_SETTINGS.graphvizExecutable)
      : "";
    this.settings.showCodeVisualizationButton = isCompileFeatureAllowed("rich-displays")
      ? normalizeBooleanSetting(this.settings.showCodeVisualizationButton, DEFAULT_SETTINGS.showCodeVisualizationButton)
      : false;
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

    await this.setSourceModeForLeaf(leaf, false);
  }

  private async setSourceModeForLeaf(leaf: WorkspaceLeaf, force: boolean): Promise<void> {
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) {
      return;
    }

    const source = view.editor?.getValue?.() ?? (await this.app.vault.cachedRead(view.file));
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!force && !blocks.length) {
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
    const addEditorView = (view: EditorView) => this.editorViews.add(view);
    const deleteEditorView = (view: EditorView) => this.editorViews.delete(view);
    const getCurrentEditorFilePath = () => this.getCurrentEditorFilePath();
    const getSettings = () => this.settings;
    const hasOutput = (blockId: string) => this.outputs.has(blockId);
    const isRunning = (blockId: string) => this.running.has(blockId);
    const shouldRenderStdinPanel = (block: lotusCodeBlock) => this.shouldRenderStdinPanel(block);
    const createToolbarWidget = (block: lotusCodeBlock) => new lotusToolbarWidget(this, block);
    const createOutputWidget = (block: lotusCodeBlock) => new lotusOutputWidget(this, block);

    return ViewPlugin.fromClass(
      class {
        decorations;

        constructor(private readonly view: EditorView) {
          addEditorView(view);
          this.decorations = this.buildDecorations();
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(lotusRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }

        destroy(): void {
          deleteEditorView(this.view);
        }

        private buildDecorations() {
          const filePath = getCurrentEditorFilePath();
          if (!filePath) {
            return Decoration.none;
          }

          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, getSettings());
          const builder = new RangeSetBuilder<Decoration>();

          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              Decoration.widget({
                widget: createToolbarWidget(block),
                side: -1,
              }),
            );

            if (hasOutput(block.id) || isRunning(block.id) || shouldRenderStdinPanel(block)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                Decoration.widget({
                  widget: createOutputWidget(block),
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
      `timeout=${formatTimeoutLabel(context.timeoutMs)} (${context.source.timeout})`,
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }

  private getCustomLanguageExtractor(block: lotusCodeBlock, file: TFile): lotusExternalSourceExtractor | undefined {
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

  private getCustomLanguagePreprocessorPipeline(block: lotusCodeBlock, file: TFile, signal?: AbortSignal): lotusPreprocessorPipelineSpec | undefined {
    const language = findEnabledCommandLanguage(this.settings, block.language, block.languageAlias);
    if (!language) {
      return undefined;
    }

    const stages = this.getCustomLanguagePreprocessorStages(language);
    if (!stages.length) {
      return undefined;
    }
    const executionContext = this.resolveExecutionContext(file, block);
    return {
      languageName: language.name,
      initialExtension: language.extension || language.name,
      stages,
      artifactDirectory: this.getPreprocessorArtifactDirectory(file, block, executionContext),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal,
    };
  }

  private getCustomLanguagePreprocessorStages(language: NonNullable<ReturnType<typeof findEnabledCommandLanguage>>): lotusExternalSourcePreprocessor[] {
    const stages = (language.preprocessors ?? [])
      .filter((stage) => stage.executable.trim())
      .map((stage, index) => ({
        name: stage.name.trim() || `stage-${index + 1}`,
        executable: stage.executable.trim(),
        args: stage.args || "{request}",
        language: stage.language?.trim(),
        extension: stage.extension?.trim(),
      }));
    if (stages.length) {
      return stages;
    }

    const executable = language.preprocessorExecutable?.trim();
    if (!executable) {
      return [];
    }
    return [{
      name: "preprocess",
      executable,
      args: language.preprocessorArgs || "{request}",
      language: language.preprocessorLanguage?.trim(),
      extension: language.preprocessorExtension?.trim(),
    }];
  }

  private getPreprocessorArtifactDirectory(file: TFile, block: lotusCodeBlock, executionContext: lotusResolvedExecutionContext): string {
    const vaultBasePath = (file.vault.adapter as { basePath?: string }).basePath;
    const root = vaultBasePath || executionContext.workingDirectory || process.cwd();
    return join(root, ".lotus", "preprocess", sanitizeArtifactSegment(file.path), `block-${block.ordinal}-${sanitizeArtifactSegment(block.sourceLanguage || block.language)}`);
  }

  private async writeManagedOutputBlock(file: TFile, block: lotusCodeBlock, result: lotusStoredOutput["result"], mode: "replace" | "append" = "replace"): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);

      if (existingRange && mode === "replace") {
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
      ? ["metadata", "stdout", "warning", "stderr", ...(isCompileFeatureAllowed("rich-displays") ? ["displays"] : [])]
      : parsed;
    const streams = expanded.map((stream) => {
      if (stream === "displays" && !isCompileFeatureAllowed("rich-displays")) {
        throw new Error("lotus-output-file-streams=displays requires a build with the rich-displays feature.");
      }
      if (stream === "stdout" || stream === "stderr" || stream === "warning" || stream === "metadata" || stream === "displays") {
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
    const configDir = this.app.vault.configDir;
    if (!parts.length || parts.includes("..") || path.startsWith(`${configDir}/`) || path === configDir || path.startsWith(".git/") || path === ".git") {
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
        case "displays":
          return result.displays?.length ? [JSON.stringify(result.displays, null, 2)] : [];
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
        ...(target.streams.includes("stdout") ? {
          stdout: result.stdout,
          stdoutLanguage: result.stdoutLanguage ?? null,
          stdoutRole: result.stdoutRole ?? null,
        } : {}),
        ...(target.streams.includes("warning") ? { warning: result.warning ?? "" } : {}),
        ...(target.streams.includes("stderr") ? { stderr: result.stderr } : {}),
        ...(target.streams.includes("displays") ? { displays: result.displays ?? [] } : {}),
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
      result.displays?.length ? `displays:\n${JSON.stringify(result.displays, null, 2)}` : "",
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
    const panel = activeDocument.createElement("div");
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

function trimLiveOutput(value: string): string {
  const maxLength = 120_000;
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(value.length - maxLength);
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
  const Decompression = typeof DecompressionStream === "undefined" ? undefined : DecompressionStream;
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
    const parsed: unknown = JSON.parse(new TextDecoder().decode(entry.data));
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
    mode: readString(value.mode) === "transpile" ? "transpile" : "execute",
    highlightLanguage: normalizeManifestLanguageReference(
      readString(value.highlightLanguage)
      || readString(value.highlight)
      || readString(value.highlighting),
    ),
    targetLanguage: normalizeManifestLanguageReference(
      readString(value.targetLanguage)
      || readString(value.target),
    ),
    executable,
    args: readString(value.args) || "{file}",
    extension: normalizeExtension(readString(value.extension), name),
    outputMode: readString(value.outputMode) === "file" ? "file" : "streams",
    outputExtension: normalizeExtension(readString(value.outputExtension), "out"),
    preprocessors: readPreprocessorList(value.preprocessors, filePath),
    preprocessorExecutable: readString(value.preprocessorExecutable),
    preprocessorArgs: readString(value.preprocessorArgs) || "{request}",
    preprocessorLanguage: normalizeManifestId(readString(value.preprocessorLanguage)),
    preprocessorExtension: readString(value.preprocessorExtension),
    extractorMode: readString(value.extractorMode) === "transpile-c" ? "transpile-c" : "command",
    extractorExecutable: readString(value.extractorExecutable),
    extractorArgs: readString(value.extractorArgs) || "{request}",
    transpileExecutable: readString(value.transpileExecutable),
    transpileArgs: readString(value.transpileArgs) || "{request}",
  };
}

function readPreprocessorList(value: unknown, filePath: string): lotusCustomPreprocessor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((stage, index) => readPreprocessorStage(stage, index, filePath))
    .filter((stage): stage is lotusCustomPreprocessor => Boolean(stage));
}

function readPreprocessorStage(value: unknown, index: number, filePath: string): lotusCustomPreprocessor | null {
  if (!isRecord(value)) {
    console.warn(`Ignoring preprocessor stage ${index + 1} in ${filePath}: stage must be an object`);
    return null;
  }

  const executable = readString(value.executable);
  if (!executable) {
    console.warn(`Ignoring preprocessor stage ${index + 1} in ${filePath}: executable is required`);
    return null;
  }

  const rawName = readString(value.id) || readString(value.name) || `stage-${index + 1}`;
  return {
    name: normalizeManifestId(rawName) || `stage-${index + 1}`,
    executable,
    args: readString(value.args) || "{request}",
    language: normalizeManifestId(readString(value.language)),
    extension: readString(value.extension),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredSettings(value: unknown): Partial<lotusPluginSettings> {
  return isRecord(value) ? value : {};
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

function normalizeManifestLanguageReference(value: string): string {
  return normalizeSyntaxLanguage(value) ?? "";
}

function normalizeExtension(value: string, name: string): string {
  if (!value) {
    return `.${name}`;
  }
  return value.startsWith(".") ? value : `.${value}`;
}

function sanitizeArtifactSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "") || "note";
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

function normalizePort(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.floor(parsed) : fallback;
}

function normalizeApiHost(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return /^(127\.0\.0\.1|localhost|::1)$/.test(trimmed) ? trimmed : fallback;
}

function normalizeStringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBooleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
  const cryptoApi = typeof crypto === "undefined" ? undefined : crypto as { randomUUID?: () => string };
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

function readStoredSignature(source: string): lotusSignatureRecord | null {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return null;
  }
  return readSignatureRecord(parseFrontmatterRecord(frontmatter.yaml)[SIGNATURE_FRONTMATTER_KEY]);
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
    const parsed: unknown = parseYaml(yaml);
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

  elements.push(...Array.from(root.querySelectorAll<HTMLElement>("pre > code")));
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

function createPasswordInput(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = container.createEl("input", {
    attr: {
      type: "password",
      placeholder,
    },
  });
  input.addClass("lotus-signing-password-input");
  return input;
}

function formatSignatureScheme(scheme: string): string {
  if (scheme === "rsa-pss-sha256") {
    return "RSA-PSS/SHA-256";
  }
  if (scheme === "openssh-sshsig") {
    return "OpenSSH SSHSIG";
  }
  return "passphrase HMAC/SHA-256";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendWarning(existing: string | undefined, line: string): string {
  return existing ? `${existing}\n${line}` : line;
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
