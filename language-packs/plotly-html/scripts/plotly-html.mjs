#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: plotly-html.mjs <spec.json>");
}

const spec = readSpec(readFileSync(file, "utf8"));
const html = renderHtml(spec);
writeArtifacts(spec, html);
process.stdout.write(html);

function readSpec(source) {
  const trimmed = source.trim();
  if (!trimmed) {
    return defaultSpec();
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Plotly HTML source must be a JSON object.");
  }
  const title = readString(parsed.title) || "Lotus interactive graph";
  const x = readArray(parsed.x) ?? [1, 2, 3, 4, 5, 6];
  const y = readArray(parsed.y) ?? [3, 5, 4, 8, 6, 9];
  const type = readString(parsed.type) || "scatter";
  const mode = readString(parsed.mode) || (type === "scatter" ? "lines+markers" : undefined);
  return { title, x, y, type, mode };
}

function defaultSpec() {
  return {
    title: "Lotus interactive graph",
    x: [1, 2, 3, 4, 5, 6],
    y: [3, 5, 4, 8, 6, 9],
    type: "scatter",
    mode: "lines+markers",
  };
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readArray(value) {
  return Array.isArray(value) ? value : undefined;
}

function renderHtml(spec) {
  const payload = JSON.stringify(spec).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(spec.title)}</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    html,body{margin:0;width:100%;height:100%;background:#fff;color:#111;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{box-sizing:border-box;min-height:100vh;padding:20px;background:#fff}
    #chart{width:100%;height:500px}
    .fallback{display:none;margin:0;padding:12px;border:1px solid #d8dde5;border-radius:8px;background:#f8fafc;color:#334155;font-size:14px}
  </style>
</head>
<body>
  <main>
    <div id="chart" role="img" aria-label="${escapeHtml(spec.title)}"></div>
    <p id="fallback" class="fallback">Plotly did not load. The JSON artifact contains the graph data.</p>
  </main>
  <script>
    const spec = ${payload};
    const trace = { x: spec.x, y: spec.y, type: spec.type, mode: spec.mode, line: { color: "#2563eb", width: 3 }, marker: { color: "#0f766e", size: 8 } };
    const layout = { title: { text: spec.title }, margin: { l: 48, r: 24, t: 56, b: 42 }, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", hovermode: "closest" };
    const config = { responsive: true, displaylogo: false };
    if (window.Plotly) {
      window.Plotly.newPlot("chart", [trace], layout, config);
    } else {
      document.getElementById("chart").style.display = "none";
      document.getElementById("fallback").style.display = "block";
    }
  </script>
</body>
</html>`;
}

function writeArtifacts(spec, html) {
  const artifactDir = process.env.LOTUS_ARTIFACT_DIR;
  if (!artifactDir) {
    return;
  }
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "plotly-preview.html"), html, "utf8");
  writeFileSync(join(artifactDir, "plotly-spec.json"), `${JSON.stringify(spec, null, 2)}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}
