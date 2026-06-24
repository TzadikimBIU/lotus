# Partial Source Extraction

Lotus can run parts of another file while keeping the call site in your note. Add source attributes to the fence info string.

````markdown
```python lotus-file="lib/calculus.py" lotus-symbol=derivative
print(derivative(lambda x: x * x, 3))
```
````

Paths starting with `/` are read from the vault root. Other paths are read relative to the note.

Use `lotus-lines=L10-L30` for a line range, or `lotus-symbol=name` for a function, class, or similar definition. Add `lotus-deps=false` when you only want the selected slice.

By default, lotus also pulls in imports, includes, and referenced definitions that it can identify. The code in the note is appended after the extracted source, so it can call the function or run a small harness.

Python uses the standard library AST parser for symbol ranges, import analysis, alias handling, local module resolution, and recursive dependency tracing. C and C++ trace top-level includes, macros, functions, types, and globals. LLVM IR traces `@symbol` definitions and declarations. Haskell and OCaml trace top-level imports and bindings. Other languages use the generic extractor unless a custom extractor command is configured.

---

## Function Call Harnesses

If the block is documenting a function, the block body can be treated as input instead of raw harness code. Add `lotus-call=true` and lotus generates the call around the selected symbol:

````markdown
```python lotus-file="lib/calculus.py" lotus-symbol=weighted_root lotus-call=true
25
```
````

That runs as if the harness were:

```python
print(weighted_root(25))
```

Use `lotus-args` when the function needs more than the raw block input:

````markdown
```python lotus-file="lib/calculus.py" lotus-symbol=clamp lotus-call=true lotus-args="{input}, 0, 20"
25
```
````

Use `lotus-call` as an expression template when the call shape needs to be custom:

````markdown
```python lotus-file="lib/calculus.py" lotus-symbol=weighted_root lotus-call="round({symbol}({input}), 2)"
25
```
````

`{input}` expands to the trimmed block body and `{symbol}` expands to the selected symbol. By default lotus wraps the expression in the language's print/output harness. Set `lotus-print=false` when the expression is already a complete statement or harness.

---

## Extracted Source Preview

Runs that use `lotus-file` include a collapsed **Extracted source** preview in the output panel. It shows the exact source handed to the runner, including imports, dependencies, selected symbol, and generated harness.

The preview header also shows the capability path for that language.

Preview settings live under **General Settings**.

| Setting | Options | Effect |
| :--- | :--- | :--- |
| Extracted source preview | Collapsed / Expanded / Hidden | Controls whether materialized source previews are hidden, shown closed, or opened by default. |
| Show capability metadata | On / Off | Controls the `symbols`, `deps`, and `call` metadata in preview headers. |

### Capability Matrix

| Path | Symbols | Deps | Harness | Preview |
| :--- | :--- | :--- | :--- | :--- |
| Python | AST | AST | Built in | Yes |
| JavaScript / TypeScript | Top level | Top level | Built in | Yes |
| C / C++ | Top level | Top level | Built in | Yes |
| LLVM IR | Top level | Top level | Raw | Yes |
| Haskell | Top level | Top level | Raw | Yes |
| OCaml | Top level | Top level | Built in | Yes |
| Java | Top level | Top level | Raw | Yes |
| eBPF C | Top level | Top level | Raw | Yes |
| bpftrace | Generic | Generic | Raw | Yes |
| Custom extractor | External | External | External | Yes |
| Fallback | Generic | Generic | Raw | Yes |
