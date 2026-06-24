# lotus

Obsidian plugin for executing ordinary fenced Markdown code blocks.

lotus is intended for research and exploratory notes where code, proofs, solver queries, and runtime output should stay readable in the document. It adds execution controls to normal fenced code blocks and renders transient output beneath the block. The source block is not rewritten into a plugin-specific format.

## Model

lotus treats a fenced block as executable when the fence info string resolves to a supported language alias. The parser walks the active Markdown buffer, skips managed lotus output sections, normalises the fence language, and creates a stable block descriptor.

Each block receives an ID derived from these values:
- Vault-relative file path
- Supported block ordinal
- Normalised language
- Source content hash

That ID is used for output replacement and toolbar state. Rerunning a block updates the existing output panel instead of appending another panel.

## Installation

### Via Community Plugins
lotus isn't in the plugin repository by design. It is intended for users that plan to run code in their vaults, therefore we expect them to at least be able to install it manually.

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `lotus` under your vault's plugin directory: `<vault>/.obsidian/plugins/lotus/`.
3. Copy the downloaded files into that directory.
4. Reload Obsidian and enable **lotus** in the Community Plugins list.

## Security

Lotus executes code blocks locally on your machine without sandboxing or isolation by default.

> [!CAUTION]
> Running code blocks in untrusted notes can execute malicious commands on your host machine. Lotus displays a consent modal before allowing local execution. For security isolation, consider setting up [Execution Groups](docs/execution-groups.md) to run code inside Docker/Podman containers or remote SSH/QEMU environments.

## Quick Start

1. Enable the plugin.
2. In any Markdown file, create a standard fenced code block:
   ````markdown
   ```python
   print("Hello from lotus!")
   ```
   ````
3. Hover over the block and click the **Run** button on the floating toolbar to execute the block and view the output.

## Supported Languages

Languages are grouped into vault-level packages. You can enable only the packs you need, and optionally disable individual languages inside them.

| Package | Languages | Typical Vault |
| :--- | :--- | :--- |
| **Interpreted** | Python, JavaScript, TypeScript, Shell, Ruby, Perl, Lua, PHP, Go, Haskell, OCaml | ops notes, scripting, research scratchpads |
| **Obsidian Context** | Obsidian JavaScript | vault and plugin integration snippets |
| **Native Compiled** | C, C++ | systems, exploit dev, native debugging |
| **Managed Compiled** | Rust, Java | application and service notes |
| **Proofs** | Lean, Coq, SMT LIB | formal methods, solver work |
| **LLVM** | LLVM IR | compiler and PL research |
| **eBPF** | eBPF C, bpftrace | kernel tracing, observability, verifier experiments |
| **Custom languages** | User-defined command-backed languages | toy languages, local DSLs, project-specific tools |

By default, every built-in package is enabled. Use **Language Packages** in settings to customize your active languages.

## Managed Output

By default, lotus does not write output into the note. If `Write output back to note` is enabled, lotus writes managed regions under blocks:

````markdown
<!-- lotus:output:start id=<stable-block-id> -->
```text
runner=Python
exit=0
duration=8ms
timestamp=2026-06-20T00:00:00.000Z

stdout:
hello
```
<!-- lotus:output:end -->
````

The parser skips these regions and generated output blocks are never executed.

### Output Window Limits
Output panels can be capped to a visible line window while keeping the full output scrollable. Set **Visible output lines** in settings for a vault-wide default, or use the `lotus-output-lines=20` attribute on a specific block. Use `0` to keep output unlimited.

### Redirection to Files
Blocks can materialise output into vault files with `lotus-output-file="path/to/file.txt"`. Relative paths resolve from the note folder, leading slash paths resolve from the vault root, and lotus creates missing parent folders. By default, the file receives stdout and is overwritten on each run.

Use `lotus-output-file-mode=append`, `lotus-output-file-streams=metadata,stdout,stderr,warning`, or `lotus-output-file-format=json` when a block needs a different artifact shape.

### Standard Input (Stdin)
Blocks can receive standard input through the toolbar input control or through attributes. Click the stdin toolbar button to open a per-block input buffer. For reproducible notes, use `lotus-stdin="line one\nline two"` or `lotus-stdin-file="inputs/payload.txt"`. The attribute `lotus-input=true` keeps the input field visible whenever the note renders.

## Advanced Topics

For more specialized setups, refer to the guides in the [docs/](docs/) directory:

- [Custom Languages](docs/custom-languages.md): Configure local interpreters, JSON request/response schema extractors, and C transpilation strategies.
- [Execution Groups](docs/execution-groups.md): Run code blocks inside Docker/Podman containers, WSL distros, remote SSH nodes, or local QEMU virtual machines.
- [Partial Source Extraction](docs/source-extraction.md): Run a specific symbol or line range from an external file, and generate function call harnesses.
- [eBPF Execution](docs/ebpf.md): Compile BPF programs, inspect ELF objects, and load probes safely.
- [Hashing & Reproducibility](docs/reproducibility.md): Verify notes and code blocks against snapshots to guarantee document reproducibility.
- [Developer Guide](docs/development.md): Runner API contracts, Obsidian context (`obsidian-js`) integrations, and the smoke testing suite.

## Commands Reference

Lotus registers several commands in the Obsidian command palette (`Ctrl/Cmd + P`):

- **`lotus: Run Current Code Block`**: Executes the block under the cursor.
- **`lotus: Run All Supported Code Blocks in Current Note`**: Executes all runnable blocks in the active file.
- **`lotus: Clear lotus Outputs in Current Note`**: Removes all rendered output panels and written output blocks in the active file.
- **`lotus: Save Reproducibility Snapshot`**: Saves the current block and note hashes to the note's frontmatter.
- **`lotus: Verify Reproducibility Snapshot`**: Compares the current note against the saved snapshot.

*See [docs/reproducibility.md](docs/reproducibility.md) for the complete list of hashing and verification commands.*



## Development

### Native Toolchains
To run languages natively on your host machine, their compilers or interpreters must be installed and available in Obsidian's PATH. See [docs/development.md](docs/development.md) for details on toolchain configurations.

### Build from Source
To build the plugin locally:

```bash
npm install --legacy-peer-deps
npm run build
```
