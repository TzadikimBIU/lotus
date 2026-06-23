import { App, Modal, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type loomPlugin from "./main";
import { CUSTOM_LANGUAGE_PACKAGE_ID, getAvailableLanguagePackages, getDefaultLanguageIds, getDefaultLanguagePackIds, isLanguageEnabled, normalizeLanguageConfiguration } from "./languagePackages";
import type { loomCustomLanguage, loomPluginSettings } from "./types";

export { DEFAULT_SETTINGS } from "./defaultSettings";

export class loomSettingTab extends PluginSettingTab {
  constructor(private readonly loomPlugin: loomPlugin) {
    super(loomPlugin.app, loomPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });

    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderLanguagePackages(this.createSection(containerEl, "Language Packages"));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }

  private createSection(containerEl: HTMLElement, title: string, open = false): HTMLElement {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Enable local execution")
      .setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
          this.loomPlugin.settings.enableLocalExecution = value;
          if (value) {
            this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
          }
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Keep loom notes in source mode")
      .setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
          this.loomPlugin.settings.preserveSourceMode = value;
          await this.loomPlugin.saveSettings();
          if (value) {
            void this.loomPlugin.enforceSourceModeForActiveView();
          } else {
            void this.loomPlugin.disableSourceModeForActiveView();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Default timeout")
      .setDesc("Maximum execution time in milliseconds before loom terminates the process.")
      .addText((text) =>
        text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.loomPlugin.settings.defaultTimeoutMs = parsed;
            await this.loomPlugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.")
      .addText((text) =>
        text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
          this.loomPlugin.settings.workingDirectory = value.trim() ? normalizePath(value.trim()) : "";
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Write output back to note")
      .setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
          this.loomPlugin.settings.writeOutputToNote = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Visible output lines")
      .setDesc("Limit each stdout, stderr, and warning panel to this many visible lines. Use 0 for unlimited output.")
      .addText((text) =>
        text.setPlaceholder("0").setValue(String(this.loomPlugin.settings.outputVisibleLines ?? 0)).onChange(async (value) => {
          const parsed = Number.parseInt(value.trim(), 10);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            this.loomPlugin.settings.outputVisibleLines = Math.min(parsed, 2000);
            await this.loomPlugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Auto-run on file open")
      .setDesc("Run all supported blocks in the active note when it opens. Disabled by default.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
          this.loomPlugin.settings.autoRunOnFileOpen = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Extracted source preview")
      .setDesc("Choose how loom shows the materialized source for blocks that use loom-file.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("collapsed", "Collapsed")
          .addOption("expanded", "Expanded")
          .addOption("hidden", "Hidden")
          .setValue(this.loomPlugin.settings.extractedSourcePreviewMode || "collapsed")
          .onChange(async (value) => {
            this.loomPlugin.settings.extractedSourcePreviewMode = value as "collapsed" | "expanded" | "hidden";
            await this.loomPlugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show capability metadata")
      .setDesc("Show symbol, dependency, and harness capability metadata in extracted source preview headers.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.showLanguageCapabilityMetadata ?? true).onChange(async (value) => {
          this.loomPlugin.settings.showLanguageCapabilityMetadata = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("PDF export mode")
      .setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("both", "Both Code and Output")
          .addOption("code", "Code Block Only")
          .addOption("output", "Output Only")
          .setValue(this.loomPlugin.settings.pdfExportMode || "both")
          .onChange(async (value) => {
            this.loomPlugin.settings.pdfExportMode = value as "both" | "code" | "output";
            await this.loomPlugin.saveSettings();
          }),
      );
  }

  private renderBuiltInRuntimes(containerEl: HTMLElement): void {
    if (this.isRuntimeLanguageEnabled("python")) {
      this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    }
    if (this.isRuntimeLanguageEnabled("javascript")) {
      this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    }

    if (this.isRuntimeLanguageEnabled("typescript")) {
      new Setting(containerEl)
        .setName("TypeScript runner mode")
        .setDesc("Use ts-node or tsx for TypeScript blocks.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("ts-node", "ts-node")
            .addOption("tsx", "tsx")
            .setValue(this.loomPlugin.settings.typescriptMode)
            .onChange(async (value) => {
              this.loomPlugin.settings.typescriptMode = value as "ts-node" | "tsx";
              await this.loomPlugin.saveSettings();
            }),
        );

      this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    }

    if (this.isRuntimeLanguageEnabled("ocaml")) {
      new Setting(containerEl)
        .setName("OCaml mode")
        .setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("ocaml", "ocaml")
            .addOption("ocamlc", "ocamlc")
            .addOption("dune", "dune")
            .setValue(this.loomPlugin.settings.ocamlMode)
            .onChange(async (value) => {
              this.loomPlugin.settings.ocamlMode = value as "ocaml" | "ocamlc" | "dune";
              await this.loomPlugin.saveSettings();
            }),
        );

      this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    }

    this.addRuntimeTextSetting(containerEl, ["c"], "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addRuntimeTextSetting(containerEl, ["cpp"], "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addRuntimeTextSetting(containerEl, ["shell"], "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addRuntimeTextSetting(containerEl, ["ruby"], "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addRuntimeTextSetting(containerEl, ["perl"], "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addRuntimeTextSetting(containerEl, ["lua"], "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addRuntimeTextSetting(containerEl, ["php"], "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addRuntimeTextSetting(containerEl, ["go"], "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addRuntimeTextSetting(containerEl, ["rust"], "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addRuntimeTextSetting(containerEl, ["haskell"], "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    if (this.isRuntimeLanguageEnabled("java")) {
      this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
      this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["llvm-ir"], "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    if (this.isRuntimeLanguageEnabled("ebpf-c")) {
      this.addTextSetting(containerEl, "eBPF clang executable", "Command or path for clang with BPF target support.", "ebpfClangExecutable");
      this.addTextSetting(containerEl, "eBPF bpftool executable", "Command or path for bpftool verifier and load operations.", "ebpfBpftoolExecutable");
      this.addTextSetting(containerEl, "eBPF object inspector", "Command or path for llvm-objdump. Leave empty to skip object section inspection.", "ebpfLlvmObjdumpExecutable");
      this.addTextSetting(containerEl, "eBPF include paths", "Comma-separated include directories passed to clang with -I.", "ebpfIncludePaths");
      new Setting(containerEl)
        .setName("Allow eBPF kernel load")
        .setDesc("Required before any block can use loom-ebpf-mode=load. Compile-only mode stays available without this.")
        .addToggle((toggle) =>
          toggle.setValue(this.loomPlugin.settings.ebpfAllowKernelLoad).onChange(async (value) => {
            this.loomPlugin.settings.ebpfAllowKernelLoad = value;
            await this.loomPlugin.saveSettings();
          }),
        );
    }
    this.addRuntimeTextSetting(containerEl, ["bpftrace"], "bpftrace executable", "Command or path for bpftrace scripts.", "bpftraceExecutable");
    this.addRuntimeTextSetting(containerEl, ["lean"], "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addRuntimeTextSetting(containerEl, ["coq"], "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addRuntimeTextSetting(containerEl, ["smtlib"], "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }

  private addRuntimeTextSetting<K extends keyof loomPluginSettings>(containerEl: HTMLElement, languageIds: string[], name: string, description: string, key: K): void {
    if (languageIds.some((languageId) => this.isRuntimeLanguageEnabled(languageId))) {
      this.addTextSetting(containerEl, name, description, key);
    }
  }

  private isRuntimeLanguageEnabled(languageId: string): boolean {
    return isLanguageEnabled(languageId, this.loomPlugin.settings);
  }

  private renderLanguagePackages(containerEl: HTMLElement): void {
    normalizeLanguageConfiguration(this.loomPlugin.settings);

    for (const pack of getAvailableLanguagePackages(this.loomPlugin.settings)) {
      const packEl = containerEl.createEl("details", { cls: "loom-language-package" });
      packEl.open = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      packEl.createEl("summary", { text: pack.displayName });
      packEl.createEl("p", { text: pack.description, cls: "setting-item-description" });

      new Setting(packEl)
        .setName("Enable package")
        .setDesc("Disable this to remove the package languages from parsing, command menus, and runners for this vault.")
        .addToggle((toggle) =>
          toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id)).onChange(async (value) => {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, pack.id, value);
            for (const language of pack.languages) {
              this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
            }
            await this.loomPlugin.saveSettings();
            this.display();
          }),
        );

      const packageEnabled = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      for (const language of pack.languages) {
        new Setting(packEl)
          .setName(language.displayName)
          .setDesc(`Aliases: ${language.aliases.join(", ")}`)
          .addToggle((toggle) =>
            toggle
              .setDisabled(!packageEnabled)
              .setValue(packageEnabled && this.loomPlugin.settings.enabledLanguages.includes(language.id))
              .onChange(async (value) => {
                this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
                await this.loomPlugin.saveSettings();
              }),
          );
      }
    }

    new Setting(containerEl)
      .setName("Reload external language packs")
      .setDesc("Load JSON language pack manifests from the plugin language-packs folder.")
      .addButton((button) =>
        button.setButtonText("Reload").onClick(async () => {
          await this.loomPlugin.loadExternalLanguagePacks(true);
          await this.loomPlugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Custom languages")
      .setDesc("Enable user-defined languages from the Custom Languages section.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID)).onChange(async (value) => {
          this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, CUSTOM_LANGUAGE_PACKAGE_ID, value);
          await this.loomPlugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Reset language packages")
      .setDesc("Re-enable every built-in package and every built-in language.")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.loomPlugin.settings.enabledLanguagePacks = getDefaultLanguagePackIds();
          this.loomPlugin.settings.enabledLanguages = getDefaultLanguageIds();
          await this.loomPlugin.saveSettings();
          this.display();
        }),
      );
  }

  private setEnabledValue(values: string[], id: string, enabled: boolean): void {
    const index = values.indexOf(id);
    if (enabled && index < 0) {
      values.push(id);
    } else if (!enabled && index >= 0) {
      values.splice(index, 1);
    }
  }

  private renderCustomLanguages(containerEl: HTMLElement): void {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);

    new Setting(containerEl)
      .setName("Add custom language")
      .setDesc("Create a new local command-backed language.")
      .addButton((button) =>
        button.setButtonText("+").onClick(async () => {
          this.loomPlugin.settings.customLanguages.push({
            name: "custom-language",
            aliases: "",
            executable: "",
            args: "{file}",
            extension: ".txt",
            extractorMode: "command",
            extractorExecutable: "",
            extractorArgs: "{request}",
            transpileExecutable: "",
            transpileArgs: "{request}",
          });
          await this.loomPlugin.saveSettings();
          this.display();
        }),
      );
  }

  private renderCustomLanguageList(containerEl: HTMLElement): void {
    containerEl.empty();

    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description",
      });
      return;
    }

    this.loomPlugin.settings.customLanguages.forEach((language, index) => {
      const details = containerEl.createEl("details", { cls: "loom-custom-language" });
      details.open = true;
      details.createEl("summary", { text: language.name || `Custom language ${index + 1}` });
      const body = details.createDiv({ cls: "loom-custom-language-body" });

      this.addCustomLanguageTextSetting(body, language, "Name", "Normalized language id used by loom.", "name");
      this.addCustomLanguageTextSetting(body, language, "Aliases", "Comma-separated fence aliases.", "aliases");
      this.addCustomLanguageTextSetting(body, language, "Executable", "Local command or absolute executable path.", "executable");
      this.addCustomLanguageTextSetting(body, language, "Arguments", "Space-separated arguments. Use {file} for the temp source file.", "args");
      this.addCustomLanguageTextSetting(body, language, "Extension", "Temp source file extension, for example .py.", "extension");

      new Setting(body)
        .setName("Partial extraction strategy")
        .setDesc("Choose how this custom language supports partial runnable source.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("command", "Extractor command")
            .addOption("transpile-c", "Transpile to C")
            .setValue(language.extractorMode || "command")
            .onChange(async (value) => {
              language.extractorMode = value as "command" | "transpile-c";
              await this.loomPlugin.saveSettings();
            }),
        );

      this.addCustomLanguageTextSetting(body, language, "Extractor executable", "Optional command for partial source extraction. Leave empty to use generic line and symbol extraction.", "extractorExecutable");
      this.addCustomLanguageTextSetting(body, language, "Extractor arguments", "Arguments for the extractor. Use {request}, {source}, {harness}, {symbol}, {lineStart}, {lineEnd}, {deps}, and {language}.", "extractorArgs");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C executable", "Optional command that emits generated C and a symbol map as JSON.", "transpileExecutable");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C arguments", "Arguments for the transpiler. Use the same placeholders as extractor arguments.", "transpileArgs");

      new Setting(body)
        .setName("Delete language")
        .setDesc("Remove this custom language.")
        .addButton((button) =>
          button.setButtonText("Delete").setWarning().onClick(async () => {
            this.loomPlugin.settings.customLanguages.splice(index, 1);
            await this.loomPlugin.saveSettings();
            this.display();
          }),
        );
    });
  }

  private async renderContainerGroups(containerEl: HTMLElement): Promise<void> {
    try {
      const groups = await this.loomPlugin.getContainerGroupSummaries();

      new Setting(containerEl)
        .setName("Default containerization group")
        .setDesc("The container group to run code blocks in by default if the note does not specify one.")
        .addDropdown((dropdown) => {
          dropdown.addOption("", "None");
          for (const group of groups) {
            dropdown.addOption(group.name, group.name);
          }
          dropdown.setValue(this.loomPlugin.settings.defaultContainerGroup || "");
          dropdown.onChange(async (value) => {
            this.loomPlugin.settings.defaultContainerGroup = value;
            await this.loomPlugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Add new containerization group")
        .setDesc("Create a new containerization group configuration folder.")
        .addButton((button) =>
          button.setButtonText("+").onClick(() => {
            new ContainerGroupNameModal(this.app, async (groupName) => {
              const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
              if (!cleanName) {
                new Notice("Invalid group name.");
                return;
              }

              const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
              const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
              const configPath = `${groupRelativePath}/config.json`;

              const adapter = this.app.vault.adapter;
              if (await adapter.exists(groupRelativePath)) {
                new Notice("Container group folder already exists.");
                return;
              }

              await adapter.mkdir(groupRelativePath);
              const defaultConfig = {
                runtime: "docker",
                image: "ubuntu:latest",
                languages: {
                  python: {
                    command: "python3 {file}",
                    extension: ".py"
                  }
                }
              };
              await adapter.write(configPath, JSON.stringify(defaultConfig, null, 2));
              new Notice(`Container group "${cleanName}" created.`);
              this.display();
            }).open();
          }),
        );

      const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
      if (!groups.length) {
        listEl.createEl("p", {
          text: "No container groups found in .obsidian/plugins/loom/containers.",
          cls: "setting-item-description",
        });
        return;
      }

      for (const group of groups) {
        new Setting(listEl)
          .setName(group.name)
          .setDesc(group.status)
          .addButton((button) =>
            button.setButtonText("Build / rebuild").onClick(async () => {
              await this.loomPlugin.buildContainerGroup(group.name);
            }),
          )
          .addButton((button) =>
            button.setButtonText("Edit").onClick(() => {
              const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
              new EditContainerGroupModal(this.loomPlugin, group.name, pluginDir, () => {
                this.display();
              }).open();
            }),
          );
      }
    } catch (error) {
      containerEl.empty();
      containerEl.createEl("p", {
        text: `Error loading container groups: ${error instanceof Error ? error.message : String(error)}`,
        cls: "loom-settings-error",
        attr: { style: "color: var(--text-error); font-weight: bold; margin: 1em 0;" }
      });
      console.error("loom: failed to render container groups:", error);
    }
  }

  private addTextSetting<K extends keyof loomPluginSettings>(containerEl: HTMLElement, name: string, description: string, key: K): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
          (this.loomPlugin.settings[key] as string) = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );
  }

  private addCustomLanguageTextSetting<K extends keyof loomCustomLanguage>(
    containerEl: HTMLElement,
    language: loomCustomLanguage,
    name: string,
    description: string,
    key: K,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(String(language[key] ?? "")).onChange(async (value) => {
          (language[key] as string | undefined) = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );
  }
}

export function showExecutionDisabledNotice(): void {
  new Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}

class ContainerGroupNameModal extends Modal {
  private name = "";

  constructor(
    app: App,
    private readonly onSubmit: (name: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });

    new Setting(contentEl)
      .setName("Group Name")
      .setDesc("Use lowercase letters, numbers, hyphens, and underscores.")
      .addText((text) =>
        text.onChange((value) => {
          this.name = value;
        }),
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Create")
          .setCta()
          .onClick(async () => {
            await this.onSubmit(this.name);
            this.close();
          }),
      );
  }
}

class EditContainerGroupModal extends Modal {
  private activeTab: "general" | "languages" | "dockerfile" | "raw" = "general";
  private configObj: any = {};
  private rawJsonText = "";
  private dockerfileText: string | null = null;
  private newLanguageName = "";
  private tabHeaderEl!: HTMLElement;
  private tabContentEl!: HTMLElement;

  constructor(
    private readonly loomPlugin: loomPlugin,
    private readonly groupName: string,
    private readonly pluginDir: string,
    private readonly onSave: () => void
  ) {
    super(loomPlugin.app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Edit Config: ${this.groupName}` });

    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    const adapter = this.app.vault.adapter;

    try {
      const rawConfig = await adapter.read(configPath);
      this.configObj = JSON.parse(rawConfig);
      this.rawJsonText = rawConfig;
    } catch (e) {
      new Notice("Could not read configuration file.");
      this.close();
      return;
    }

    try {
      if (await adapter.exists(dockerfilePath)) {
        this.dockerfileText = await adapter.read(dockerfilePath);
      } else {
        this.dockerfileText = null;
      }
    } catch (e) {
      this.dockerfileText = null;
    }

    const container = contentEl.createDiv({ cls: "loom-tab-container" });

    // Render Tab Header
    this.tabHeaderEl = container.createDiv({ cls: "loom-tab-header" });
    this.renderTabs();

    // Render Tab Content Area
    this.tabContentEl = container.createDiv({ cls: "loom-tab-content" });

    // Render Actions Footer
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.saveAndClose();
    });

    this.renderActiveTab();
  }

  renderTabs() {
    this.tabHeaderEl.empty();
    const tabs: Array<{ id: "general" | "languages" | "dockerfile" | "raw"; label: string }> = [
      { id: "general", label: "General" },
      { id: "languages", label: "Languages" },
      { id: "dockerfile", label: "Dockerfile" },
      { id: "raw", label: "Raw JSON" },
    ];

    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        text: tab.label,
        cls: "loom-tab-btn" + (this.activeTab === tab.id ? " is-active" : ""),
      });
      btn.addEventListener("click", () => {
        void this.switchTab(tab.id);
      });
    }
  }

  async switchTab(tab: "general" | "languages" | "dockerfile" | "raw") {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
        return;
      }
    }
    this.activeTab = tab;
    this.renderTabs();
    this.renderActiveTab();
  }

  renderActiveTab() {
    this.tabContentEl.empty();
    if (this.activeTab === "general") {
      this.renderGeneralTab(this.tabContentEl);
    } else if (this.activeTab === "languages") {
      this.renderLanguagesTab(this.tabContentEl);
    } else if (this.activeTab === "dockerfile") {
      this.renderDockerfileTab(this.tabContentEl);
    } else if (this.activeTab === "raw") {
      this.renderRawTab(this.tabContentEl);
    }
  }

  renderGeneralTab(containerEl: HTMLElement) {
    // Runtime select dropdown
    new Setting(containerEl)
      .setName("Runtime")
      .setDesc("Choose the container/environment manager runtime.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("docker", "Docker")
          .addOption("podman", "Podman")
          .addOption("wsl", "WSL")
          .addOption("qemu", "QEMU")
          .addOption("custom", "Custom")
          .setValue(this.configObj.runtime || "docker")
          .onChange((value) => {
            this.configObj.runtime = value;
            this.renderActiveTab();
          });
      });

    // Conditional image/distro name
    if (
      this.configObj.runtime === "docker" ||
      this.configObj.runtime === "podman" ||
      this.configObj.runtime === "wsl"
    ) {
      new Setting(containerEl)
        .setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image")
        .setDesc(
          this.configObj.runtime === "wsl"
            ? "Optional. The target WSL distro name (leave empty for default distro)."
            : "Fallback Docker/Podman image if no Dockerfile is present."
        )
        .addText((text) => {
          text
            .setValue(this.configObj.image || "")
            .onChange((val) => {
              this.configObj.image = val.trim();
            });
        });
    }

    if (!this.configObj.elevation || typeof this.configObj.elevation !== "object") {
      this.configObj.elevation = { mode: "default" };
    }

    new Setting(containerEl)
      .setName("Elevation")
      .setDesc(
        this.configObj.runtime === "docker" || this.configObj.runtime === "podman"
          ? "Run snippets with the image default user, or force root with --user root."
          : "Keep default privileges, or mark this group as elevated and optionally prefix commands."
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("default", "Default")
          .addOption("root", "Root")
          .setValue(this.configObj.elevation.mode || "default")
          .onChange((value) => {
            this.configObj.elevation.mode = value;
            this.renderActiveTab();
          });
      });

    if (
      this.configObj.elevation.mode === "root" &&
      (this.configObj.runtime === "qemu" || this.configObj.runtime === "wsl" || this.configObj.runtime === "custom")
    ) {
      new Setting(containerEl)
        .setName("Elevation command prefix")
        .setDesc("Optional prefix for remote or wrapper commands, for example sudo -n. Loom does not prompt for passwords.")
        .addText((text) => {
          text
            .setPlaceholder("sudo -n")
            .setValue(this.configObj.elevation.commandPrefix || "")
            .onChange((val) => {
              this.configObj.elevation.commandPrefix = val.trim() || undefined;
            });
        });
    }

    if (this.configObj.runtime === "wsl") {
      if (!this.configObj.wsl) {
        this.configObj.wsl = {};
      }
      new Setting(containerEl)
        .setName("Use Interactive Shell")
        .setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).")
        .addToggle((toggle) => {
          toggle
            .setValue(this.configObj.wsl.interactive ?? false)
            .onChange((val) => {
              this.configObj.wsl.interactive = val;
            });
        });
    }

    // Conditional QEMU Settings
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }

      new Setting(containerEl)
        .setName("SSH Target")
        .setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).")
        .addText((text) => {
          text
            .setValue(this.configObj.qemu.sshTarget || "")
            .onChange((val) => {
              this.configObj.qemu.sshTarget = val.trim();
            });
        });

      new Setting(containerEl)
        .setName("Remote Workspace")
        .setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).")
        .addText((text) => {
          text
            .setValue(this.configObj.qemu.remoteWorkspace || "")
            .onChange((val) => {
              this.configObj.qemu.remoteWorkspace = val.trim();
            });
        });

      new Setting(containerEl)
        .setName("SSH Executable")
        .setDesc("Optional. Path to SSH client executable (defaults to ssh).")
        .addText((text) => {
          text
            .setValue(this.configObj.qemu.sshExecutable || "")
            .onChange((val) => {
              this.configObj.qemu.sshExecutable = val.trim() || undefined;
            });
        });

      new Setting(containerEl)
        .setName("SSH Arguments")
        .setDesc("Optional. Additional SSH CLI flags.")
        .addText((text) => {
          text
            .setValue(this.configObj.qemu.sshArgs || "")
            .onChange((val) => {
              this.configObj.qemu.sshArgs = val.trim() || undefined;
            });
        });
    }

    // Conditional Custom Settings
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }

      new Setting(containerEl)
        .setName("Custom Executable")
        .setDesc("Path to custom runtime wrapper executable or script.")
        .addText((text) => {
          text
            .setValue(this.configObj.custom.executable || "")
            .onChange((val) => {
              this.configObj.custom.executable = val.trim();
            });
        });

      new Setting(containerEl)
        .setName("Custom Arguments")
        .setDesc("Optional. Command arguments. Use {request} for JSON config path.")
        .addText((text) => {
          text
            .setValue(this.configObj.custom.args || "")
            .onChange((val) => {
              this.configObj.custom.args = val.trim() || undefined;
            });
        });
    }
  }

  renderLanguagesTab(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Configured Languages" });

    if (!this.configObj.languages) {
      this.configObj.languages = {};
    }

    const langsListEl = containerEl.createDiv({ cls: "loom-languages-list" });
    const languages = Object.entries(this.configObj.languages as Record<string, { command?: string; extension?: string; useDefault?: boolean }>);

    if (languages.length === 0) {
      langsListEl.createEl("p", { text: "No languages configured for this group.", cls: "setting-item-description" });
    } else {
      for (const [langName, langConfig] of languages) {
        const card = langsListEl.createDiv({ cls: "loom-language-card" });
        card.createEl("strong", { text: langName, attr: { style: "display: block; margin-bottom: 0.5rem; font-size: 1.1em;" } });

        const isDefault = (langConfig as any).useDefault === true;

        new Setting(card)
          .setName("Use default configuration")
          .setDesc("If checked, Loom will run this language using its built-in commands/extensions.")
          .addToggle((toggle) => {
            toggle
              .setValue(isDefault)
              .onChange((val) => {
                if (val) {
                  (langConfig as any).useDefault = true;
                  delete langConfig.command;
                  delete langConfig.extension;
                } else {
                  delete (langConfig as any).useDefault;
                  const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
                  langConfig.command = defaults?.command || "";
                  langConfig.extension = defaults?.extension || "";
                }
                this.renderActiveTab();
              });
          });

        new Setting(card)
          .setName("Command")
          .setDesc("Execution command. Use {file} for the code snippet filename.")
          .addText((text) => {
            const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
            text
              .setPlaceholder(defaults?.command || "")
              .setValue(langConfig.command || "")
              .setDisabled(isDefault)
              .onChange((val) => {
                langConfig.command = val.trim();
              });
          });

        new Setting(card)
          .setName("Extension")
          .setDesc("Source file extension (e.g. .py, .js).")
          .addText((text) => {
            const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
            text
              .setPlaceholder(defaults?.extension || "")
              .setValue(langConfig.extension || "")
              .setDisabled(isDefault)
              .onChange((val) => {
                langConfig.extension = val.trim();
              });
          });

        new Setting(card)
          .addButton((btn) => {
            btn
              .setButtonText("Remove Language")
              .setWarning()
              .onClick(() => {
                delete this.configObj.languages[langName];
                this.renderActiveTab();
              });
          });
      }
    }

    // Add Language Section
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new Setting(containerEl)
      .setName("Language ID")
      .setDesc("e.g. python, javascript, node, sh")
      .addText((text) => {
        text.setValue(this.newLanguageName).onChange((val) => {
          this.newLanguageName = val.trim().toLowerCase();
        });
      })
      .addButton((btn) => {
        btn.setButtonText("+ Add").setCta().onClick(() => {
          if (!this.newLanguageName) {
            new Notice("Please enter a language name.");
            return;
          }
          if (this.configObj.languages[this.newLanguageName]) {
            new Notice("Language already configured.");
            return;
          }
          this.configObj.languages[this.newLanguageName] = {
            command: `${this.newLanguageName} {file}`,
            extension: `.${this.newLanguageName}`,
          };
          this.newLanguageName = "";
          this.renderActiveTab();
        });
      });
  }

  renderDockerfileTab(containerEl: HTMLElement) {
    if (this.configObj.runtime !== "docker" && this.configObj.runtime !== "podman") {
      containerEl.createEl("p", {
        text: `Dockerfile editing is only available for Docker and Podman runtimes. Currently using: ${this.configObj.runtime}`,
        cls: "setting-item-description",
      });
      return;
    }

    if (this.dockerfileText === null) {
      containerEl.createEl("p", {
        text: "No Dockerfile exists in this container group directory.",
        cls: "setting-item-description",
      });

      new Setting(containerEl)
        .addButton((btn) => {
          btn
            .setButtonText("Create Dockerfile")
            .setCta()
            .onClick(() => {
              this.dockerfileText = [
                "FROM ubuntu:latest",
                "",
                "# Install packages",
                "RUN apt-get update && apt-get install -y \\",
                "    python3 \\",
                "    nodejs \\",
                "    && rm -rf /var/lib/apt/lists/*",
                "",
              ].join("\n");
              this.renderActiveTab();
            });
        });
    } else {
      new Setting(containerEl)
        .setName("Dockerfile Content")
        .setDesc("Define the build steps for your environment container.")
        .addTextArea((text) => {
          text.inputEl.rows = 15;
          text.inputEl.style.fontFamily = "monospace";
          text.inputEl.style.width = "100%";
          text.setValue(this.dockerfileText || "");
          text.onChange((val) => {
            this.dockerfileText = val;
          });
        });
    }
  }

  renderRawTab(containerEl: HTMLElement) {
    this.rawJsonText = JSON.stringify(this.configObj, null, 2);
    new Setting(containerEl)
      .setName("Configuration JSON")
      .addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.width = "100%";
        text.setValue(this.rawJsonText);
        text.onChange((val) => {
          this.rawJsonText = val;
        });
      });
  }

  async saveAndClose() {
    // If the active tab is raw JSON, parse it first to ensure we capture edits
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }

    // Basic Validation
    if (!this.configObj.runtime) {
      new Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new Notice("Custom runtime requires Custom Executable.");
      return;
    }

    const adapter = this.app.vault.adapter;
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;

    try {
      // Save config.json
      const configStr = JSON.stringify(this.configObj, null, 2);
      await adapter.write(configPath, configStr);

      // Save Dockerfile
      if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman") {
        if (this.dockerfileText !== null) {
          await adapter.write(dockerfilePath, this.dockerfileText);
        }
      }

      new Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
