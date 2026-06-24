import { setIcon } from "obsidian";
import type { lotusStoredOutput } from "../types";

interface lotusOutputPanelOptions {
  defaultVisibleLines: number;
}

function getStatusKind(output: lotusStoredOutput): "success" | "warning" | "failure" {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }

  return "failure";
}

export function createOutputPanel(output: lotusStoredOutput, options: lotusOutputPanelOptions): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = `lotus-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.lotusBlockId = output.blockId;
  renderOutputPanel(panel, output, options);
  return panel;
}

export function renderOutputPanel(panel: HTMLElement, output: lotusStoredOutput, options: lotusOutputPanelOptions): void {
  const kind = getStatusKind(output);
  panel.className = `lotus-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const visibleLines = resolveVisibleLines(output, options.defaultVisibleLines);

  const header = panel.createDiv({ cls: "lotus-output-header" });
  const badge = header.createDiv({ cls: "lotus-output-badge" });
  setIcon(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");

  const title = header.createDiv({ cls: "lotus-output-title" });
  title.setText(`${output.result.runnerName} · exit ${output.result.exitCode ?? "?"}`);

  const meta = header.createDiv({ cls: "lotus-output-meta" });
  meta.setText(`${output.result.durationMs} ms · ${new Date(output.result.finishedAt).toLocaleTimeString()}`);

  const body = panel.createDiv({ cls: "lotus-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout, visibleLines);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning, visibleLines);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr, visibleLines);
  }
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "lotus-output-empty" });
    empty.setText("No output");
  }
}

function createStream(container: HTMLElement, label: string, content: string, visibleLines: number): void {
  const section = container.createDiv({ cls: "lotus-output-stream" });
  const lineCount = countLines(content);
  section.createDiv({ cls: "lotus-output-stream-label", text: formatStreamLabel(label, lineCount, visibleLines) });
  const pre = section.createEl("pre", { cls: "lotus-output-pre", text: content });
  if (visibleLines > 0 && lineCount > visibleLines) {
    pre.addClass("is-scroll-limited");
    pre.style.setProperty("--lotus-output-visible-lines", String(visibleLines));
  }
}

function createSourcePreview(container: HTMLElement, preview: NonNullable<lotusStoredOutput["sourcePreview"]>): void {
  const details = container.createEl("details", { cls: "lotus-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "lotus-source-preview-summary" });
  summary.createSpan({ text: "Extracted source" });
  summary.createSpan({ cls: "lotus-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  details.createEl("pre", { cls: "lotus-output-pre lotus-source-preview-pre", text: preview.content });
}

function formatSourcePreviewMeta(preview: NonNullable<lotusStoredOutput["sourcePreview"]>): string {
  const capability = preview.capability;
  if (!capability || !preview.showCapabilityMetadata) {
    return `${preview.language} · ${preview.description}`;
  }
  return [
    preview.language,
    preview.description,
    `symbols:${capability.symbolExtraction}`,
    `deps:${capability.dependencyTracing}`,
    `call:${capability.callHarness}`,
  ].join(" · ");
}

function resolveVisibleLines(output: lotusStoredOutput, defaultVisibleLines: number): number {
  const override = output.block.attributes["lotus-output-lines"] ?? output.block.attributes["output-lines"];
  if (override != null) {
    return normalizeVisibleLines(Number.parseInt(override.trim(), 10));
  }
  return normalizeVisibleLines(defaultVisibleLines);
}

function normalizeVisibleLines(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), 2000);
}

function countLines(content: string): number {
  return content.replace(/\n$/, "").split("\n").length;
}

function formatStreamLabel(label: string, lineCount: number, visibleLines: number): string {
  if (visibleLines > 0 && lineCount > visibleLines) {
    return `${label} · ${lineCount} lines · showing ${visibleLines}`;
  }
  return label;
}

export function createRunningPanel(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "lotus-output-panel is-running";

  const header = panel.createDiv({ cls: "lotus-output-header" });
  const spinner = header.createDiv({ cls: "lotus-spinner" });
  setIcon(spinner, "loader-circle");
  const title = header.createDiv({ cls: "lotus-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "lotus-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");

  return panel;
}
