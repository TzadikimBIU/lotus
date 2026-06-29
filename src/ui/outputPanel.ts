import { setIcon } from "obsidian";
import type { lotusDisplayOutput, lotusSourcePreviewStage, lotusStoredOutput } from "../types";

interface lotusOutputPanelOptions {
  defaultVisibleLines: number;
}

export interface lotusRunningPanelOptions {
  runnerName?: string;
  stdout?: string;
  stderr?: string;
  inputEnabled?: boolean;
  onSendInput?: (input: string) => void;
  onCloseInput?: () => void;
}

function getStatusKind(output: lotusStoredOutput): "success" | "warning" | "failure" {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }

  return "failure";
}

export function createOutputPanel(output: lotusStoredOutput, options: lotusOutputPanelOptions): HTMLDivElement {
  const panel = activeDocument.createElement("div");
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
  if (output.result.displays?.length) {
    for (const display of output.result.displays) {
      createDisplay(body, display, visibleLines);
    }
  }
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (
    !output.result.stdout.trim()
    && !output.result.warning?.trim()
    && !output.result.stderr.trim()
    && !output.result.displays?.length
    && !output.sourcePreview?.content.trim()
  ) {
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

function createDisplay(container: HTMLElement, display: lotusDisplayOutput, visibleLines: number): void {
  const section = container.createDiv({ cls: "lotus-output-display" });
  const selected = selectDisplayMime(display);
  section.createDiv({
    cls: "lotus-output-stream-label",
    text: formatDisplayLabel(display, selected?.mime),
  });

  if (!selected) {
    section.createEl("pre", {
      cls: "lotus-output-pre",
      text: `Unsupported display data: ${Object.keys(display.data).join(", ") || "(empty)"}`,
    });
    return;
  }

  if (selected.mime.startsWith("image/") && typeof selected.value === "string") {
    createImageDisplay(section, display, selected.mime, selected.value);
    return;
  }

  if (selected.mime === "application/json" || selected.mime.endsWith("+json")) {
    createTextDisplay(section, JSON.stringify(selected.value, null, 2), visibleLines);
    return;
  }

  createTextDisplay(section, typeof selected.value === "string" ? selected.value : JSON.stringify(selected.value, null, 2), visibleLines);
}

function createImageDisplay(container: HTMLElement, display: lotusDisplayOutput, mime: string, value: string): void {
  const metadata = readDisplayMetadata(display, mime);
  const frame = container.createDiv({ cls: "lotus-output-image-frame" });
  const image = readImageDisplay(display, metadata, mime, value);
  const width = readPositiveNumber(metadata.width);
  const height = readPositiveNumber(metadata.height);
  const viewer = createImageViewer(frame, image, {
    width,
    height,
    initialZoom: 1,
    maxZoom: 3,
    fullscreen: false,
    onFullscreen: () => openImageFullscreen(display, image, width, height, viewer.getZoom()),
  });
  viewer.update();
}

interface LotusImageDisplayData {
  src: string;
  alt: string;
  title: string;
}

interface LotusImageViewer {
  getZoom(): number;
  update(): void;
}

interface LotusImageViewerOptions {
  width?: number;
  height?: number;
  initialZoom: number;
  maxZoom: number;
  fullscreen: boolean;
  onFullscreen?: () => void;
}

function readImageDisplay(display: lotusDisplayOutput, metadata: Record<string, unknown>, mime: string, value: string): LotusImageDisplayData {
  return {
    src: imageDataUrl(mime, value),
    alt: readString(metadata.alt) ?? display.title ?? readString(display.data["text/plain"]) ?? "Lotus display output",
    title: display.title?.trim() || "Lotus display",
  };
}

function createImageViewer(container: HTMLElement, image: LotusImageDisplayData, options: LotusImageViewerOptions): LotusImageViewer {
  const frame = container;
  if (options.fullscreen) {
    frame.addClass("is-fullscreen");
  }
  const toolbar = frame.createDiv({ cls: "lotus-output-image-toolbar" });
  const viewport = frame.createDiv({ cls: "lotus-output-image-viewport" });
  const img = viewport.createEl("img", { cls: "lotus-output-image" });
  img.draggable = false;
  img.src = image.src;
  img.alt = image.alt;
  let baseWidth = options.width ?? 900;
  const baseHeight = options.height;
  let zoom = Math.max(0.5, Math.min(options.maxZoom, options.initialZoom));

  const zoomOut = createImageToolbarButton(toolbar, "Zoom out", "zoom-out", () => setZoom(zoom - 0.15));
  const slider = toolbar.createEl("input", {
    cls: "lotus-output-image-zoom-slider",
    attr: {
      type: "range",
      min: "50",
      max: String(Math.round(options.maxZoom * 100)),
      step: "10",
      value: String(Math.round(zoom * 100)),
      "aria-label": "Image zoom",
    },
  });
  const zoomIn = createImageToolbarButton(toolbar, "Zoom in", "zoom-in", () => setZoom(zoom + 0.15));
  const reset = createImageToolbarButton(toolbar, "Reset zoom", "rotate-ccw", () => setZoom(1));
  if (options.onFullscreen) {
    createImageToolbarButton(toolbar, "Open fullscreen", "maximize-2", options.onFullscreen);
  }
  const valueEl = toolbar.createSpan({ cls: "lotus-output-image-zoom-value", text: `${Math.round(zoom * 100)}%` });

  slider.addEventListener("input", () => {
    setZoom(Number.parseInt(slider.value, 10) / 100);
  });

  installImagePan(viewport);

  img.addEventListener("load", () => {
    if (!options.width && img.naturalWidth > 0) {
      baseWidth = Math.max(360, Math.min(img.naturalWidth, baseWidth));
      updateImageZoom();
    }
  });

  zoomOut.disabled = false;
  zoomIn.disabled = false;
  reset.disabled = false;
  updateImageZoom();

  function setZoom(value: number): void {
    const center = readViewportCenter(viewport);
    zoom = Math.max(0.5, Math.min(options.maxZoom, value));
    updateImageZoom(center);
  }

  function updateImageZoom(center = readViewportCenter(viewport)): void {
    const scaledWidth = Math.round(baseWidth * zoom);
    img.style.width = `${scaledWidth}px`;
    img.style.maxWidth = "none";
    if (baseHeight) {
      img.style.height = `${Math.round(baseHeight * zoom)}px`;
    } else {
      img.style.height = "auto";
    }
    const percent = Math.round(zoom * 100);
    slider.value = String(percent);
    valueEl.setText(`${percent}%`);
    requestAnimationFrame(() => restoreViewportCenter(viewport, center));
  }

  return {
    getZoom: () => zoom,
    update: updateImageZoom,
  };
}

function openImageFullscreen(
  display: lotusDisplayOutput,
  image: LotusImageDisplayData,
  width: number | undefined,
  height: number | undefined,
  initialZoom: number,
): void {
  const overlay = activeDocument.createElement("div");
  overlay.className = "lotus-output-image-fullscreen";
  overlay.tabIndex = -1;

  const shell = overlay.createDiv({ cls: "lotus-output-image-fullscreen-shell" });
  const header = shell.createDiv({ cls: "lotus-output-image-fullscreen-header" });
  header.createDiv({ cls: "lotus-output-image-fullscreen-title", text: display.title?.trim() || image.title });
  const close = createImageToolbarButton(header, "Close fullscreen", "x", () => closeFullscreen());
  close.addClass("lotus-output-image-fullscreen-close");

  const frame = shell.createDiv({ cls: "lotus-output-image-frame" });
  createImageViewer(frame, image, {
    width,
    height,
    initialZoom,
    maxZoom: 6,
    fullscreen: true,
  }).update();

  const closeFullscreen = () => {
    overlay.remove();
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeFullscreen();
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFullscreen();
    }
  });

  activeDocument.body.appendChild(overlay);
  overlay.focus();
}

function installImagePan(viewport: HTMLElement): void {
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null = null;

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !canPanViewport(viewport)) {
      return;
    }
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.addClass("is-panning");
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
    event.preventDefault();
    event.stopPropagation();
  });

  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    drag = null;
    viewport.removeClass("is-panning");
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have already released capture.
    }
  };

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("lostpointercapture", () => {
    drag = null;
    viewport.removeClass("is-panning");
  });
}

function canPanViewport(viewport: HTMLElement): boolean {
  return viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight;
}

function readViewportCenter(viewport: HTMLElement): { x: number; y: number } {
  const width = Math.max(1, viewport.scrollWidth);
  const height = Math.max(1, viewport.scrollHeight);
  return {
    x: (viewport.scrollLeft + viewport.clientWidth / 2) / width,
    y: (viewport.scrollTop + viewport.clientHeight / 2) / height,
  };
}

function restoreViewportCenter(viewport: HTMLElement, center: { x: number; y: number }): void {
  viewport.scrollLeft = Math.max(0, center.x * viewport.scrollWidth - viewport.clientWidth / 2);
  viewport.scrollTop = Math.max(0, center.y * viewport.scrollHeight - viewport.clientHeight / 2);
}

function createImageToolbarButton(container: HTMLElement, label: string, iconName: string, onClick: () => void): HTMLButtonElement {
  const button = container.createEl("button", { cls: "lotus-output-image-zoom-button" });
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  setIcon(button, iconName);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createTextDisplay(container: HTMLElement, content: string, visibleLines: number): void {
  const lineCount = countLines(content);
  const pre = container.createEl("pre", { cls: "lotus-output-pre", text: content });
  if (visibleLines > 0 && lineCount > visibleLines) {
    pre.addClass("is-scroll-limited");
    pre.style.setProperty("--lotus-output-visible-lines", String(visibleLines));
  }
}

function selectDisplayMime(display: lotusDisplayOutput): { mime: string; value: unknown } | null {
  for (const mime of [
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "text/markdown",
    "text/vnd.graphviz",
    "application/json",
    "text/plain",
  ]) {
    if (display.data[mime] != null) {
      return { mime, value: display.data[mime] };
    }
  }

  const firstMime = Object.keys(display.data)[0];
  return firstMime ? { mime: firstMime, value: display.data[firstMime] } : null;
}

function formatDisplayLabel(display: lotusDisplayOutput, mime: string | undefined): string {
  const title = display.title?.trim() || display.role || "Display";
  return mime ? `${title} · ${mime}` : title;
}

function imageDataUrl(mime: string, value: string): string {
  if (value.startsWith("data:")) {
    return value;
  }
  if (mime === "image/svg+xml") {
    return `data:${mime};charset=utf-8,${encodeURIComponent(value)}`;
  }
  return `data:${mime};base64,${value.replace(/\s/g, "")}`;
}

function readDisplayMetadata(display: lotusDisplayOutput, mime: string): Record<string, unknown> {
  const globalMetadata = isRecord(display.metadata) ? display.metadata : {};
  const mimeMetadata = isRecord(globalMetadata[mime]) ? globalMetadata[mime] : {};
  return { ...globalMetadata, ...mimeMetadata };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSourcePreview(container: HTMLElement, preview: NonNullable<lotusStoredOutput["sourcePreview"]>): void {
  const details = container.createEl("details", { cls: "lotus-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "lotus-source-preview-summary" });
  summary.createSpan({ text: preview.stages?.length ? "Source stages" : "Extracted source" });
  summary.createSpan({ cls: "lotus-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  if (preview.stages?.length) {
    for (const stage of preview.stages) {
      const stageDetails = details.createEl("details", { cls: "lotus-source-preview-stage" });
      stageDetails.open = preview.expanded;
      const stageSummary = stageDetails.createEl("summary", { cls: "lotus-source-preview-summary" });
      stageSummary.createSpan({ text: stage.label });
      stageSummary.createSpan({ cls: "lotus-source-preview-meta", text: formatSourceStageMeta(stage) });
      stageDetails.createEl("pre", { cls: "lotus-output-pre lotus-source-preview-pre", text: stage.content });
    }
    return;
  }
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

function formatSourceStageMeta(stage: lotusSourcePreviewStage): string {
  return [
    stage.language,
    stage.extension,
    stage.description,
    stage.path,
  ].filter(Boolean).join(" · ");
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

export function createRunningPanel(options: lotusRunningPanelOptions = {}): HTMLDivElement {
  const panel = activeDocument.createElement("div");
  panel.className = "lotus-output-panel is-running";

  const header = panel.createDiv({ cls: "lotus-output-header" });
  const spinner = header.createDiv({ cls: "lotus-spinner" });
  setIcon(spinner, "loader-circle");
  const title = header.createDiv({ cls: "lotus-output-title" });
  title.setText(options.runnerName ? `Running ${options.runnerName}` : "Running");
  const meta = header.createDiv({ cls: "lotus-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");

  const body = panel.createDiv({ cls: "lotus-output-body" });
  if (options.stdout?.length) {
    createStream(body, "Stdout", options.stdout, 200);
  }
  if (options.stderr?.length) {
    createStream(body, "Stderr", options.stderr, 200);
  }
  if (options.inputEnabled && options.onSendInput) {
    createLiveInput(body, options);
  }

  return panel;
}

function createLiveInput(container: HTMLElement, options: lotusRunningPanelOptions): void {
  const form = container.createDiv({ cls: "lotus-live-input" });
  const textarea = form.createEl("textarea", {
    cls: "lotus-live-input-field",
    attr: {
      rows: "2",
      placeholder: "Stdin for the running process",
    },
  });
  const actions = form.createDiv({ cls: "lotus-live-input-actions" });
  const sendButton = actions.createEl("button", { text: "Send" });
  const eofButton = actions.createEl("button", { text: "EOF" });

  const send = () => {
    const value = textarea.value;
    if (!value.length) {
      return;
    }
    options.onSendInput?.(value.endsWith("\n") ? value : `${value}\n`);
    textarea.value = "";
    textarea.focus();
  };

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      send();
    }
  });
  sendButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    send();
  });
  eofButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onCloseInput?.();
  });
}
