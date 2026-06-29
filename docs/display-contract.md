# Rich Display Contract

Lotus rich displays are enabled by the `rich-displays` compile feature. Builds that omit that feature must not expose image, plot, or source-visualization UI.

## Display Records

Display outputs are MIME bundles. A record has this shape:

```json
{
  "id": "optional-stable-id",
  "title": "Optional title",
  "role": "visualization",
  "data": {
    "image/svg+xml": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "text/plain": "fallback text"
  },
  "metadata": {
    "width": 900,
    "height": 480,
    "alt": "Accessible description"
  }
}
```

`data` is required. `id`, `title`, `role`, and `metadata` are optional. Supported roles are `result`, `visualization`, `diagnostic`, and `artifact`.

Lotus currently renders these MIME types, in priority order:

```text
image/svg+xml
image/png
image/jpeg
image/gif
text/markdown
text/vnd.graphviz
application/json
text/plain
```

SVG values are raw SVG strings. Raster image values are base64 strings unless they already include a `data:` URL.

## External Process Channel

Every local process receives these environment variables:

```text
LOTUS_DISPLAY_JSONL
LOTUS_ARTIFACT_DIR
```

Append one JSON display record per line to `LOTUS_DISPLAY_JSONL`. Lotus reads the file after the process exits and attaches valid records to the output panel.

`LOTUS_ARTIFACT_DIR` is a temporary directory for files produced during the run. The directory is removed after Lotus has read display records, so durable artifacts should be written to a vault path with `lotus-output-file` instead.

The JSONL file is capped at 10 MiB. Invalid records produce a warning and are not rendered.

## Obsidian JavaScript Helper

`obsidian-js` blocks receive a `display` helper:

```javascript
display.svg(svg, { title: "SVG", alt: "Control-flow graph", width: 900 });
display.graphviz("digraph g { a -> b }", { title: "CFG" });
display.png(base64Png, { title: "PNG" });
display.jpeg(base64Jpeg, { title: "JPEG" });
display.image(base64Image, { mimeType: "image/gif", title: "GIF" });
display.mime({ "application/json": { ok: true } }, { title: "Data" });
```

Graphviz displays use `text/vnd.graphviz`. When Graphviz is configured, Lotus runs `dot -Tsvg` and adds an `image/svg+xml` representation.

## Visualization Attributes

Blocks can request display synthesis from stdout:

```text
lotus-visualize=graphviz
lotus-visualize=svg
```

`graphviz`, `dot`, `gv`, and `cfg` are accepted Graphviz aliases. `svg` and `image/svg+xml` are accepted SVG aliases. `false`, `off`, `none`, and similar values disable synthesis.

## UI Behavior

Image displays render on a white viewport with zoom controls. Zoom preserves the current viewport center. When the image is larger than the viewport, dragging inside the image viewport pans the image. The fullscreen button opens the display in a full-window overlay with the same zoom and drag controls plus a larger zoom range.

## Current Non-Goals

Lotus does not render arbitrary interactive HTML in this contract. Plotly or other interactive plotting libraries should be added later as optional, feature-gated renderers rather than as a baseline display dependency.
