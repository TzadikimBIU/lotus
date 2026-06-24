"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LotusSettingTab = exports.DEFAULT_SETTINGS = void 0;
exports.showExecutionDisabledNotice = showExecutionDisabledNotice;
const obsidian_1 = require("obsidian");
exports.DEFAULT_SETTINGS = {
    enableLocalExecution: false,
    hasAcknowledgedExecutionRisk: false,
    defaultTimeoutMs: 8000,
    workingDirectory: "",
    pythonExecutable: "python3",
    nodeExecutable: "node",
    typescriptMode: "ts-node",
    typescriptTranspilerExecutable: "ts-node",
    ocamlMode: "ocaml",
    ocamlExecutable: "ocaml",
    writeOutputToNote: false,
    autoRunOnFileOpen: false,
};
class LotusSettingTab extends obsidian_1.PluginSettingTab {
    constructor(lotusPlugin) {
        super(lotusPlugin.app, lotusPlugin);
        this.lotusPlugin = lotusPlugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Lotus" });
        containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
        containerEl.createEl("h3", { text: "Execution" });
        new obsidian_1.Setting(containerEl)
            .setName("Enable local execution")
            .setDesc("Disabled by default. Lotus runs code on your local machine and does not provide sandboxing.")
            .addToggle((toggle) => toggle.setValue(this.lotusPlugin.settings.enableLocalExecution).onChange(async (value) => {
            this.lotusPlugin.settings.enableLocalExecution = value;
            if (value) {
                this.lotusPlugin.settings.hasAcknowledgedExecutionRisk = true;
            }
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Default timeout")
            .setDesc("Maximum execution time in milliseconds before Lotus terminates the process.")
            .addText((text) => text.setPlaceholder("8000").setValue(String(this.lotusPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                this.lotusPlugin.settings.defaultTimeoutMs = parsed;
                await this.lotusPlugin.saveSettings();
            }
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Working directory")
            .setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.")
            .addText((text) => text.setPlaceholder("Vault root").setValue(this.lotusPlugin.settings.workingDirectory).onChange(async (value) => {
            this.lotusPlugin.settings.workingDirectory = value.trim() ? (0, obsidian_1.normalizePath)(value.trim()) : "";
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Write output back to note")
            .setDesc("Insert managed Lotus output sections beneath code blocks instead of keeping results purely in the UI.")
            .addToggle((toggle) => toggle.setValue(this.lotusPlugin.settings.writeOutputToNote).onChange(async (value) => {
            this.lotusPlugin.settings.writeOutputToNote = value;
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Auto-run on file open")
            .setDesc("Run all supported blocks in the active note when it opens. Disabled by default.")
            .addToggle((toggle) => toggle.setValue(this.lotusPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
            this.lotusPlugin.settings.autoRunOnFileOpen = value;
            await this.lotusPlugin.saveSettings();
        }));
        containerEl.createEl("h3", { text: "Runtimes" });
        new obsidian_1.Setting(containerEl)
            .setName("Python executable")
            .setDesc("Path or command name for Python.")
            .addText((text) => text.setValue(this.lotusPlugin.settings.pythonExecutable).onChange(async (value) => {
            this.lotusPlugin.settings.pythonExecutable = value.trim();
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Node executable")
            .setDesc("Path or command name for JavaScript execution.")
            .addText((text) => text.setValue(this.lotusPlugin.settings.nodeExecutable).onChange(async (value) => {
            this.lotusPlugin.settings.nodeExecutable = value.trim();
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("TypeScript runner mode")
            .setDesc("Use ts-node or tsx for TypeScript blocks.")
            .addDropdown((dropdown) => dropdown
            .addOption("ts-node", "ts-node")
            .addOption("tsx", "tsx")
            .setValue(this.lotusPlugin.settings.typescriptMode)
            .onChange(async (value) => {
            this.lotusPlugin.settings.typescriptMode = value;
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("TypeScript transpiler executable")
            .setDesc("Command or path for ts-node or tsx.")
            .addText((text) => text.setValue(this.lotusPlugin.settings.typescriptTranspilerExecutable).onChange(async (value) => {
            this.lotusPlugin.settings.typescriptTranspilerExecutable = value.trim();
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("OCaml mode")
            .setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.")
            .addDropdown((dropdown) => dropdown
            .addOption("ocaml", "ocaml")
            .addOption("ocamlc", "ocamlc")
            .addOption("dune", "dune")
            .setValue(this.lotusPlugin.settings.ocamlMode)
            .onChange(async (value) => {
            this.lotusPlugin.settings.ocamlMode = value;
            await this.lotusPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("OCaml executable")
            .setDesc("Command or path for ocaml, ocamlc, or dune depending on the selected mode.")
            .addText((text) => text.setValue(this.lotusPlugin.settings.ocamlExecutable).onChange(async (value) => {
            this.lotusPlugin.settings.ocamlExecutable = value.trim();
            await this.lotusPlugin.saveSettings();
        }));
        containerEl.createEl("p", {
            text: "Missing runtime executables will surface as run errors. Lotus never claims sandboxing and executes code with your configured commands.",
            cls: "setting-item-description",
        });
    }
}
exports.LotusSettingTab = LotusSettingTab;
function showExecutionDisabledNotice() {
    new obsidian_1.Notice("Lotus local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
