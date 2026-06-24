# Developer Guide

This document covers developer-facing integrations, the runner API contract, and the smoke testing suite.

---

## Runner Contract

Runners implement this interface:

```ts
interface lotusRunner {
  id: string;
  displayName: string;
  languages: readonly lotusNormalizedLanguage[];
  canRun(block: lotusCodeBlock, settings: lotusPluginSettings): boolean;
  run(
    block: lotusCodeBlock,
    context: lotusRunContext,
    settings: lotusPluginSettings
  ): Promise<lotusRunResult>;
}
```

A runner determines whether it can handle a block based on its language and settings, then returns a `Promise<lotusRunResult>`.

---

## Obsidian Context JavaScript

Normal `javascript` and `js` blocks run through Node.js or the selected execution group. Use `obsidian-js` only when the snippet needs to execute inside Obsidian's renderer process.

````markdown
```obsidian-js
console.log(app.workspace.getActiveFile()?.path ?? "no active file");
console.log(file.path);
new Notice("Ran inside Obsidian");
```
````

Obsidian context blocks receive the following global variables: `app`, `plugin`, `file`, `block`, `Notice`, `console`, `note`, and `input`. 

> [!WARNING]
> These run directly in the Obsidian renderer process, have access to vault and workspace APIs, and are **not sandboxed**. 

By default, every run emits this warning in the output panel:
```text
No but seriously, you are risking your life
```
You can disable this under **Show Obsidian context warning** in settings.

### The `note` Helper
The `note` helper wraps common current-note mutations:

```javascript
await note.setFrontmatter("last-run", new Date().toISOString());
await note.updateJsonBetween("<!-- state:start -->", "<!-- state:end -->", (state) => ({
  ...state,
  runs: Number(state.runs ?? 0) + 1
}));
```

> [!IMPORTANT]
> While timeouts can stop lotus from waiting for asynchronous work, they cannot safely interrupt a synchronous infinite loop once it has started running inside the Obsidian renderer.

---

## Language Packs

External language packs reside under the plugin directory:

```text
.obsidian/plugins/lotus/language-packs/*.json
```

Each JSON file describes one optional package. You can import a `.zip`, `.tar`, `.tgz`, or `.tar.gz` bundle from **Language Packages** in the settings. Lotus unpacks these under `language-packs` and scans them.

### Manifest Example (`lotus-language-pack.json`)

```json
{
  "id": "esolangs",
  "displayName": "Esolangs",
  "description": "Optional language support kept outside the core runner surface.",
  "languages": [
    {
      "id": "julia",
      "displayName": "Julia",
      "aliases": ["jl"],
      "executable": "julia",
      "args": "{file}",
      "extension": ".jl"
    }
  ]
}
```

Keep the manifest at the archive root. If the archive has a single top-level folder, Lotus strips it during import.

```text
lotus-language-pack-julia/
  lotus-language-pack.json
  highlighting/
    julia.tmLanguage.json
  examples/
    basics.md
```

External languages use the same execution contract as custom languages. They can also define `extractorMode`, `extractorExecutable`, `extractorArgs`, `transpileExecutable`, and `transpileArgs` if they need partial source extraction. The manifest acts as registry data (not copied to plugin settings), and the vault's enabled choices are persisted normally.

---

## Smoke Test Matrix

The smoke runner materializes a fixture vault from the `vault` branch, builds Lotus, installs the compiled plugin artifacts into a temporary copy of that vault, runs tagged code blocks, and writes reports under `.lotus/artifacts/smoke/<profile>`.

```bash
npm run smoke
npm run smoke:matrix
```

### Profiles

| Profile | Command | Focus |
| :--- | :--- | :--- |
| **minimal** | `npm run smoke -- --profile minimal` | Python, Shell, source extraction, cwd overrides |
| **systems** | `npm run smoke -- --profile systems` | Shell plus native compiled C and C++ lanes |
| **proofs** | `npm run smoke -- --profile proofs` | Proof and solver package gating |
| **ebpf** | `npm run smoke -- --profile ebpf` | eBPF C object compilation and bpftrace availability checks |
| **full** | `npm run smoke -- --profile full` | Every smoke block in the fixture vault |

GitHub Actions runs these profiles on push and pull requests. CI installs headless Chrome and the smoke toolchains, renders `report.html`, prints it to `report.pdf`, requires all selected blocks to run without skips, and uploads the artifact bundle.

The temporary test vault loads `main.js` via a small Obsidian shim and verifies the compiled files.

### Artifacts

| Artifact | Purpose |
| :--- | :--- |
| `compiled-plugin.json` | Hash manifest for files installed into the temporary vault plugin directory |
| `compiled-plugin-load.json` | Compiled `main.js` load check with the Obsidian shim and registered language list |
| `report.json` | Machine-readable block results, stdout, stderr, warnings, and extracted source |
| `report.md` | Small text summary for quick review |
| `report.html` | Rendered report used as the PDF source |
| `report.pdf` | Headless browser print output from the HTML report |
| `smoke-runner.mjs` | Bundled runner used for that profile |

### PDF Generation

Local PDF export uses the same path if Chrome, Chromium, Google Chrome, or `wkhtmltopdf` is installed. The path can also be provided explicitly:

```bash
LOTUS_CHROME_PATH=/path/to/chrome npm run smoke -- --profile minimal --require-pdf
```

Without a browser, local smoke writes `pdf-skipped.txt` unless `--require-pdf` is specified.

---

## Compilation Profiles

Lotus can be built with different compiler profiles via `esbuild.config.mjs`:

- **`strict` (Default)**: All languages, runtimes, and features are fully compiled and bundled.
- **`light`**: Strips out languages, packs, runtimes, or features at compile-time to produce a stripped-down, lighter plugin bundle.

### Build Commands

```bash
# Build with default strict profile
npm run build

# Build with explicit profiles
npm run build:strict
npm run build:light
```

### Light Build Configuration Options

When building the `light` profile, configuration options can be passed via command line flags or environment variables:

| Parameter | CLI Flag | Environment Variable | Purpose |
| :--- | :--- | :--- | :--- |
| **Mode** | `--compile-mode=light` | `LOTUS_COMPILE_MODE=light` | Set compile profile (`strict` or `light`). |
| **Languages** | `--languages=python,shell` | `LOTUS_LIGHT_LANGUAGES` | Comma-separated list of allowed languages. |
| **Language Packs** | `--language-packs=interpreted` | `LOTUS_LIGHT_LANGUAGE_PACKS` | Comma-separated list of allowed language packs. |
| **Features** | `--features=container-groups` | `LOTUS_LIGHT_FEATURES` | Allowed features: `custom-languages`, `external-language-packs`, `container-groups`, `output-filters`. |
| **Container Groups**| `--container-groups=py-sandbox` | `LOTUS_LIGHT_CONTAINER_GROUPS` | Specific permitted container groups. |
| **Runtimes** | `--container-runtimes=docker,wsl` | `LOTUS_LIGHT_CONTAINER_RUNTIMES` | Permitted container runtimes (`docker`, `podman`, `qemu`, `wsl`, `ssh`, `custom`). |
