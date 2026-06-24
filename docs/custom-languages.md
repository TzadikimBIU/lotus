# Custom Languages

Lotus includes built-in runners for common interpreted, compiled, systems, and proof-oriented languages. Additional local languages can be added from the settings tab under **Custom Languages**.

A custom language configuration defines:
- **Name**
- **Aliases** (comma-separated)
- **Executable**
- **Arguments** (e.g., `{file}`)
- **Source file extension**
- **Optional extractor executable**
- **Optional extractor arguments** (e.g., `{request}`)

### Example Configuration

```text
name: shellcustom
aliases: shx
executable: /bin/sh
args: {file}
extension: .sh
```

With this configured, a normal fenced block can run using that alias:

````markdown
```shx
echo hello
```
````

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

### Transpile to C Strategy

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
