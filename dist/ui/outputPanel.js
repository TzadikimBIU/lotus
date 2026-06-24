"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOutputPanel = createOutputPanel;
exports.renderOutputPanel = renderOutputPanel;
exports.createRunningPanel = createRunningPanel;
const obsidian_1 = require("obsidian");
function getStatusKind(output) {
    if (output.result.success) {
        return output.result.stderr.trim() ? "warning" : "success";
    }
    return "failure";
}
function createOutputPanel(output) {
    const panel = document.createElement("div");
    panel.className = `lotus-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
    panel.dataset.lotusBlockId = output.blockId;
    renderOutputPanel(panel, output);
    return panel;
}
function renderOutputPanel(panel, output) {
    const kind = getStatusKind(output);
    panel.className = `lotus-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
    panel.empty();
    const header = panel.createDiv({ cls: "lotus-output-header" });
    const badge = header.createDiv({ cls: "lotus-output-badge" });
    (0, obsidian_1.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
    const title = header.createDiv({ cls: "lotus-output-title" });
    title.setText(`${output.result.runnerName} · exit ${output.result.exitCode ?? "?"}`);
    const meta = header.createDiv({ cls: "lotus-output-meta" });
    meta.setText(`${output.result.durationMs} ms · ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
    const body = panel.createDiv({ cls: "lotus-output-body" });
    if (output.result.stdout.trim()) {
        createStream(body, "stdout", output.result.stdout);
    }
    if (output.result.stderr.trim()) {
        createStream(body, "stderr", output.result.stderr);
    }
    if (!output.result.stdout.trim() && !output.result.stderr.trim()) {
        const empty = body.createDiv({ cls: "lotus-output-empty" });
        empty.setText("No output");
    }
}
function createStream(container, label, content) {
    const section = container.createDiv({ cls: "lotus-output-stream" });
    section.createDiv({ cls: "lotus-output-stream-label", text: label });
    section.createEl("pre", { cls: "lotus-output-pre", text: content });
}
function createRunningPanel(runnerName) {
    const panel = document.createElement("div");
    panel.className = "lotus-output-panel is-running";
    const header = panel.createDiv({ cls: "lotus-output-header" });
    const spinner = header.createDiv({ cls: "lotus-spinner" });
    (0, obsidian_1.setIcon)(spinner, "loader-circle");
    const title = header.createDiv({ cls: "lotus-output-title" });
    title.setText(`Running with ${runnerName}`);
    const meta = header.createDiv({ cls: "lotus-output-meta" });
    meta.setText("Executing...");
    spinner.setAttribute("aria-hidden", "true");
    return panel;
}
