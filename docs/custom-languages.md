# Custom Languages

Lotus includes built-in runners for common interpreted, compiled, systems, and proof-oriented languages. Additional local languages can be added from the settings tab under **Custom Languages**.

A custom language configuration defines:
- **Name**
- **Aliases** (comma-separated)
- **Run mode** (`execute` or `transpile`)
- **Highlight as** (optional source highlighting language)
- **Target language** (used to label and highlight transpiled output)
- **Executable**
- **Arguments** (e.g., `{file}`)
- **Source file extension**
- **Display output** (optional rich-display wrapping for stdout or generated file output)
- **Optional preprocessor stages**
- **Optional extractor executable**
- **Optional extractor arguments** (e.g., `{request}`)

### Example Configuration

```text
name: shellcustom
aliases: shx
executable: /bin/sh
args: {file}
extension: .sh
mode: execute
highlightLanguage: shell
```

With this configured, a normal fenced block can run using that alias:

````markdown
```shx
echo hello
```
````

Argument templates include `{file}`, `{tempDir}`, and `{output}` for all custom languages. External language-pack manifests also get `{packDir}`/`{packageDir}`/`{languagePackDir}`, which expand to the manifest directory so pack-local helper scripts can be referenced without hard-coded vault paths.

Processes also receive `LOTUS_DISPLAY_JSONL` and `LOTUS_ARTIFACT_DIR`. Write display JSONL records to the first path when a runner needs multiple MIME bundles or custom metadata. Write files to the artifact directory when a run should expose durable downloads such as `preview.html`, `document.tex`, `plot.json`, or `output.pdf`.

---

## Highlight Inheritance

Use `highlightLanguage` when a custom fence is syntactically close to a language Obsidian already highlights. Lotus keeps the custom language id for execution, but rendered source blocks and output previews receive the configured language class.

`highlightLanguage` can point at a built-in language, an external language-pack language, or another custom language. If that target language has its own `highlightLanguage`, Lotus follows the chain until it reaches the concrete highlighter. If the target has its own highlighter registered under its language id, leave its `highlightLanguage` empty and point other languages at that id.

```text
name: checked-c
aliases: cc-checked
mode: execute
highlightLanguage: c
executable: /usr/bin/clang
args: {file} -o {tempDir}/a.out
extension: .c
```

With that configuration, a `cc-checked` block still runs through the custom command while its source is highlighted as C.

For a language-pack language with its own highlighter, a related language can inherit from it:

```json
[
  {
    "id": "toy",
    "displayName": "Toy",
    "aliases": ["toy"],
    "executable": "toy-run",
    "args": "{file}",
    "extension": ".toy"
  },
  {
    "id": "toy-macro",
    "displayName": "Toy Macro",
    "aliases": ["toym"],
    "highlightLanguage": "toy",
    "executable": "toy-macro-run",
    "args": "{file}",
    "extension": ".toym"
  }
]
```

---

## Transpile Mode

Use `mode: transpile` when the command should generate source text but Lotus should not execute that generated source. The generated source is read from stdout by default. If `outputMode` is `file`, the command should write to `{output}` and Lotus reads that file after the process exits.

`targetLanguage` tells Lotus how to label and highlight the generated stdout pane.

Blocks whose custom language is configured with `mode: transpile` show a curved-arrow transpile button in the code block toolbar. The normal run button still works; the transpile button is an explicit affordance for generated-source workflows.

```text
name: c-to-llvm-ir
aliases: c2llvm
mode: transpile
highlightLanguage: c
targetLanguage: llvm-ir
executable: /usr/bin/clang
args: -S -emit-llvm {file} -o {output}
extension: .c
outputMode: file
outputExtension: .ll
```

For imported language-pack manifests the same fields are available:

```json
{
  "id": "c-to-llvm-ir",
  "displayName": "C to LLVM IR",
  "aliases": ["c2llvm"],
  "mode": "transpile",
  "highlightLanguage": "c",
  "targetLanguage": "llvm-ir",
  "executable": "/usr/bin/clang",
  "args": "-S -emit-llvm {file} -o {output}",
  "extension": ".c",
  "outputMode": "file",
  "outputExtension": ".ll"
}
```

---

## Display Output Mode

Custom languages can turn stdout, or the generated file content from `outputMode: file`, into a Lotus rich display. Use this for wrapper languages whose command naturally produces an SVG, raster image, Graphviz DOT, JSON graph payload, or another MIME bundle value.

`displayOutput` accepts:
- `none`: leave stdout as normal stream output.
- `copy-stdout`: keep stdout and also add a display record.
- `replace-stdout`: move stdout into a display record so raw image data is not shown as text.

`displayMimeType` selects the display MIME type, such as `text/html`, `image/svg+xml`, `image/png`, `text/vnd.graphviz`, `application/vnd.lotus.plotly+json`, or `application/json`.

`displayHeight` is optional metadata for display renderers. For `text/html`, Lotus uses it as the iframe height in pixels.

Example:

```json
{
  "name": "lilac-html",
  "aliases": "lilac",
  "mode": "execute",
  "highlightLanguage": "markdown",
  "executable": "node",
  "args": "{packDir}/scripts/lilac-lotus.mjs --format html {file}",
  "extension": ".md",
  "outputMode": "streams",
  "displayOutput": "replace-stdout",
  "displayMimeType": "text/html",
  "displayTitle": "Lilac HTML preview",
  "displayRole": "artifact",
  "displayHeight": 720
}
```

When this language is enabled from an external language pack, a normal fence renders as an HTML display:

````markdown
```lilac-html
# Research note

Worked on **symbolic computation**.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$
```
````

Lotus also still supports the lower-level external process channel from the rich display contract. Use `LOTUS_DISPLAY_JSONL` when a tool needs to emit multiple displays or custom metadata.

---

## Preprocessor Stages

Custom languages can define one or more named preprocessor stages. Lotus runs these stages before selecting the final runner. Each stage receives a stable input file and planned output file under:

```text
.lotus/preprocess/<note-path>/block-<ordinal>-<source-language>/
```

The path is stable for the note, block ordinal, and source fence language, so external tools can inspect or reuse intermediate files while a block is edited.

Each stage can return transformed source and optionally change the language and file extension for the next stage or final runner. This lets a source fence such as `toy` preprocess into `c`, `python`, or another custom language with its own execution command.

### Stage Configuration

```text
name: lower-to-c
executable: toy-lower
args: {request}
language: c
extension: .c
```

`language` and `extension` are defaults for the stage output. The stage command can override them in its JSON response.

Supported argument placeholders:

- `{request}`: JSON request file.
- `{input}`, `{source}`, or `{file}`: Current stage input file.
- `{output}`: Planned output file for this stage.
- `{artifactDir}`: Stable directory containing all stage files.
- `{language}` / `{extension}`: Current input language and extension.
- `{outputLanguage}` / `{outputExtension}`: Configured output language and extension.
- `{sourceLanguage}` / `{alias}`: Original fence language and alias.
- `{note}` / `{blockId}`: Note path and Lotus block id.
- `{stage}` / `{stageName}`: 1-based stage number and stage name.

### Request JSON Shape

```json
{
  "language": "toy",
  "outputLanguage": "c",
  "extension": ".toy",
  "outputExtension": ".c",
  "sourceLanguage": "toy",
  "languageAlias": "toy",
  "notePath": "notes/demo.md",
  "blockId": "abc123",
  "ordinal": 1,
  "stage": 1,
  "stageName": "lower-to-c",
  "inputFile": ".lotus/preprocess/notes-demo.md/block-1-toy/stage-00-input.toy",
  "outputFile": ".lotus/preprocess/notes-demo.md/block-1-toy/stage-01-lower-to-c.c",
  "artifactDirectory": ".lotus/preprocess/notes-demo.md/block-1-toy"
}
```

### Stage Output

A preprocessor can write source to `stdout` as plain text. It can also print JSON:

```json
{
  "description": "toy lowered to c",
  "language": "c",
  "extension": ".c",
  "content": "int main(void) { return 0; }"
}
```

Alternatively, it can write the output file path from the request and print no `stdout`, or return:

```json
{
  "outputFile": ".lotus/preprocess/notes-demo.md/block-1-toy/stage-01-lower-to-c.c",
  "language": "c",
  "extension": ".c"
}
```

Returned `outputFile` paths must stay inside `artifactDirectory`.

Lotus records each stage in the run output so the intermediate source and file path can be inspected.

---

## Runnable Partial Source Extraction

Custom languages can support runnable partial source extraction. Each custom language choose one of the following strategies:
1. **Extractor Command**: Use when the language has its own parser, compiler API, or LSP.
2. **Transpile to C**: Use when the language lowers to C and can provide a symbol map.

### Extractor Command Contract

Lotus writes a JSON request file and passes its path to the configured command. The command must print JSON to `stdout`.

#### Request JSON Shape

```json
{
  "language": "toy",
  "filePath": "src/example.toy",
  "symbolName": "main",
  "lineStart": null,
  "lineEnd": null,
  "traceDependencies": true,
  "sourceFile": "/tmp/lotus-extract/source.txt",
  "harnessFile": "/tmp/lotus-extract/harness.txt"
}
```

#### Supported Argument Placeholders

- `{request}`
- `{source}` or `{file}`
- `{harness}`
- `{symbol}`
- `{lineStart}`
- `{lineEnd}`
- `{deps}`
- `{language}`

#### Response JSON Shape

The extractor can return a complete runnable source:

```json
{
  "description": "src/example.toy#main",
  "content": "..."
}
```

Or it can return structured parts:

```json
{
  "imports": ["..."],
  "dependencies": ["..."],
  "selected": "..."
}
```

### Partial-Extraction Transpile to C Strategy

This strategy is separate from custom-language `mode: transpile`. It is only used when Lotus needs runnable partial source from a custom language.

The transpile to C strategy returns generated C or C++ and a symbol map:

```json
{
  "language": "c",
  "generatedSource": "int toy_score_impl(int x) { return x + 1; }",
  "symbols": {
    "score": "toy_score_impl"
  },
  "harness": "int main(void) { return toy_score_impl(1); }"
}
```

- `language`: Must be `c` or `cpp`.
- `symbols`: Maps source language names to generated C/C++ names.
- `harness`: (Optional) Useful when the note harness is written in the source language instead of generated C.

---

## Fallback Behavior

If no extractor is configured for a custom language, lotus falls back to generic line extraction and simple symbol slicing.
