import { setIcon } from "obsidian";
import type { loomStoredOutput } from "../types";

function getStatusKind(output: loomStoredOutput): "success" | "warning" | "failure" {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }

  return "failure";
}

export function createOutputPanel(output: loomStoredOutput): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output);
  return panel;
}

export function renderOutputPanel(panel: HTMLElement, output: loomStoredOutput): void {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();

  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  setIcon(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");

  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} · exit ${output.result.exitCode ?? "?"}`);

  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms · ${new Date(output.result.finishedAt).toLocaleTimeString()}`);

  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}

function createStream(container: HTMLElement, label: string, content: string): void {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}

export function createRunningPanel(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";

  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  setIcon(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");

  return panel;
}
