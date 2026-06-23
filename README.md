# loom

Obsidian plugin for executing ordinary fenced Markdown code blocks

The plugin is intended for research and exploratory work whereby proofs/solver queries and similar artefacts should remain readable directly within the document. loom augments existing code blocks with execution controls and renders transient output beneath the block. The source block itself is left unchanged and isn't rewritten into a plugin specific representation


## Model

loom treats a fenced block as an executable unit when the fence info string resolves to a supported language alias. The parser walks the active Markdown buffer and skips managed loom output sections and then normalises the fence language as well as creating a stable block descriptor

Each block receives an ID derived from:

<ul>
  <li>vault relative file path</li>
  <li>supported block ordinal</li>
  <li>normalised language</li>
  <li>source content hash</li>
</ul>

That ID is used for output replacement and toolbar state therefore rerunning a block updates the existing output panel instead of appending another panel

## Supported languages

loom includes built in runners for almost every language. The list is too extensive for me to type out because I'm lazy. Additional local languages can be added from the settings tab under **Custom Languages**. A custom language defines:

<ul>
  <li>name</li>
  <li>comma separated aliases</li>
  <li>executable</li>
  <li>arguments like <code>{file}</code></li>
  <li>source file extension</li>
  <li>optional extractor executable</li>
  <li>optional extractor arguments like <code>{request}</code></li>
</ul>

For example a custom shell alias could use:

```text
name: shellcustom
aliases: shx
executable: /bin/sh
args: {file}
extension: .sh
```

Then a normal fenced block can run as:

````markdown
```shx
echo hello
```
````

Custom languages can also support runnable partial source extraction. Each custom language chooses its own strategy:

<ul>
  <li>extractor command</li>
  <li>transpile to C</li>
</ul>

Use an extractor command when the language has its own parser, compiler API, or LSP. Use transpile to C when the language already lowers to C and can provide a symbol map.

loom writes a JSON request file and passes it to the configured command through the configured arguments. The command should print JSON to stdout.

Request shape:

```json
{
  "language": "toy",
  "filePath": "src/example.toy",
  "symbolName": "main",
  "lineStart": null,
  "lineEnd": null,
  "traceDependencies": true,
  "sourceFile": "/tmp/loom-extract/source.txt",
  "harnessFile": "/tmp/loom-extract/harness.txt"
}
```

Supported argument placeholders:

<ul>
  <li><code>{request}</code></li>
  <li><code>{source}</code> or <code>{file}</code></li>
  <li><code>{harness}</code></li>
  <li><code>{symbol}</code></li>
  <li><code>{lineStart}</code></li>
  <li><code>{lineEnd}</code></li>
  <li><code>{deps}</code></li>
  <li><code>{language}</code></li>
</ul>

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

`language` can be `c` or `cpp`. `symbols` maps source language names to generated C or C++ names. `harness` is optional, but useful when the note harness is written in the source language instead of generated C.

If no extractor is configured for a custom language, loom falls back to generic line extraction and simple symbol slicing.

## Language packages

Languages are grouped into vault level packages. A vault can enable only the packs it needs, then optionally disable individual languages inside those packs. Disabled languages are removed from parsing, toolbar registration, runner lookup, and runtime settings for that vault.

<table>
  <thead>
    <tr>
      <th>Package</th>
      <th>Languages</th>
      <th>Typical vault</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Interpreted</td>
      <td>Python, JavaScript, TypeScript, Shell, Ruby, Perl, Lua, PHP, Go, Haskell, OCaml</td>
      <td>ops notes, scripting, research scratchpads</td>
    </tr>
    <tr>
      <td>Native Compiled</td>
      <td>C, C++</td>
      <td>systems, exploit dev, native debugging</td>
    </tr>
    <tr>
      <td>Managed Compiled</td>
      <td>Rust, Java</td>
      <td>application and service notes</td>
    </tr>
    <tr>
      <td>Proofs</td>
      <td>Lean, Coq, SMT LIB</td>
      <td>formal methods, solver work</td>
    </tr>
    <tr>
      <td>LLVM</td>
      <td>LLVM IR</td>
      <td>compiler and PL research</td>
    </tr>
    <tr>
      <td>eBPF</td>
      <td>eBPF C, bpftrace</td>
      <td>kernel tracing, observability, verifier experiments</td>
    </tr>
    <tr>
      <td>Custom languages</td>
      <td>User defined command backed languages</td>
      <td>toy languages, local DSLs, project specific tools</td>
    </tr>
  </tbody>
</table>

By default every built in package is enabled to preserve the old behavior. Use **Language Packages** in settings to make a vault specific profile, such as a server management vault with only Shell, Python, JavaScript, HTTP style custom tools, and no LLVM/proof clutter.

External language packs can live in the plugin directory under:

```text
.obsidian/plugins/loom/language-packs/*.json
```

Each JSON file describes one optional package. Reload external packs from **Language Packages**, then enable the package and any languages you want for the vault.

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

External languages use the same command contract as custom languages. They can also define `extractorMode`, `extractorExecutable`, `extractorArgs`, `transpileExecutable`, and `transpileArgs` when they need partial source extraction. The manifest is treated as registry data rather than copied into plugin settings, while the vault's enabled package and language choices are persisted normally.

## Runner contract

Runners implement this interface:

```ts
interface loomRunner {
  id: string;
  displayName: string;
  languages: readonly loomNormalizedLanguage[];
  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean;
  run(
    block: loomCodeBlock,
    context: loomRunContext,
    settings: loomPluginSettings
  ): Promise<loomRunResult>;
}
```

 A runner decides whether it can handle a block from the language and settings and then returns a `loomRunResult`


## Managed output

By default loom doesn't write output into the note. If `Write output back to note` is enabled then loom writes managed regions under blocks:

````markdown
<!-- loom:output:start id=<stable-block-id> -->
```text
runner=Python
exit=0
duration=8ms
timestamp=2026-06-20T00:00:00.000Z

stdout:
hello
```
<!-- loom:output:end -->
````

The parser skips these regions and generated output blocks are never executed

Output panels can also be capped to a visible line window while keeping the full stdout, stderr, and warning text scrollable in the panel. Set **Visible output lines** in settings for a vault wide default, or use `loom-output-lines=20` on a specific block. Use `0` to keep output unlimited

Blocks can materialise output into vault files with `loom-output-file="path/to/file.txt"`. Relative paths resolve from the note folder, leading slash paths resolve from the vault root, and Loom creates missing parent folders. By default the file receives stdout and is replaced on each run. Use `loom-output-file-mode=append`, `loom-output-file-streams=metadata,stdout,stderr,warning`, or `loom-output-file-format=json` when a block needs a different artifact shape

Blocks can receive standard input through the toolbar input control or through attributes. Click the stdin toolbar button to open a per block input buffer and run the block with that buffer. For reproducible notes use `loom-stdin="line one\nline two"` or `loom-stdin-file="inputs/payload.txt"`. `loom-input=true` keeps the input field visible whenever the note renders

## Partial source extraction

loom can run part of another file while keeping the call site in your note. Add source attributes to the fence info string:

````markdown
```python loom-file="lib/calculus.py" loom-symbol=derivative
print(derivative(lambda x: x * x, 3))
```
````

Paths that start with `/` are read from the vault root. Other paths are read relative to the note.

Use `loom-lines=L10-L30` for a line range, or `loom-symbol=name` for a function, class, or similar definition. Add `loom-deps=false` when you only want the selected slice.

By default, loom also pulls in imports, includes, and referenced definitions that it can identify. The code in the note is appended after the extracted source, so it can call the function or run a small harness.

Python uses the standard library AST parser for symbol ranges, import analysis, alias handling, local module resolution, and recursive dependency tracing. C and C++ trace top level includes, macros, functions, types, and globals. LLVM IR traces `@symbol` definitions and declarations. Haskell and OCaml trace top level imports and bindings. Other languages use the generic extractor unless a custom extractor command is configured.

### Function call harnesses

If the block is documenting a function, the block body can be treated as input instead of raw harness code. Add `loom-call=true` and loom generates the call around the selected symbol:

````markdown
```python loom-file="lib/calculus.py" loom-symbol=weighted_root loom-call=true
25
```
````

That runs as if the harness were:

```python
print(weighted_root(25))
```

Use `loom-args` when the function needs more than the raw block input:

````markdown
```python loom-file="lib/calculus.py" loom-symbol=clamp loom-call=true loom-args="{input}, 0, 20"
25
```
````

Use `loom-call` as an expression template when the call shape needs to be custom:

````markdown
```python loom-file="lib/calculus.py" loom-symbol=weighted_root loom-call="round({symbol}({input}), 2)"
25
```
````

`{input}` expands to the trimmed block body and `{symbol}` expands to the selected symbol. By default loom wraps the expression in the language's print/output harness. Set `loom-print=false` when the expression is already a complete statement or harness.

### Extracted source preview

Runs that use `loom-file` include a collapsed **Extracted source** preview in the output panel. It shows the exact source handed to the runner: imports, dependencies, selected symbol, and generated harness.

The preview header also shows the capability path for that language.

Preview settings live under **General Settings**:

<table>
  <thead>
    <tr>
      <th>Setting</th>
      <th>Options</th>
      <th>Effect</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Extracted source preview</td>
      <td>Collapsed / Expanded / Hidden</td>
      <td>Controls whether materialized source previews are hidden, shown closed, or opened by default.</td>
    </tr>
    <tr>
      <td>Show capability metadata</td>
      <td>On / Off</td>
      <td>Controls the `symbols`, `deps`, and `call` metadata in preview headers.</td>
    </tr>
  </tbody>
</table>

<table>
  <thead>
    <tr>
      <th>Path</th>
      <th>Symbols</th>
      <th>Deps</th>
      <th>Harness</th>
      <th>Preview</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Python</td>
      <td>AST</td>
      <td>AST</td>
      <td>Built in</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>JavaScript / TypeScript</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Built in</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>C / C++</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Built in</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>LLVM IR</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>Haskell</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>OCaml</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Built in</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>Java</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>eBPF C</td>
      <td>Top level</td>
      <td>Top level</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>bpftrace</td>
      <td>Generic</td>
      <td>Generic</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>Custom extractor</td>
      <td>External</td>
      <td>External</td>
      <td>External</td>
      <td>Yes</td>
    </tr>
    <tr>
      <td>Fallback</td>
      <td>Generic</td>
      <td>Generic</td>
      <td>Raw</td>
      <td>Yes</td>
    </tr>
  </tbody>
</table>

## eBPF execution

eBPF support follows the normal BPF workflow: compile first, inspect the object, then load only when you mean it. Loom writes the snippet to a temp file, runs the right frontend, and surfaces compiler output plus object metadata in the note. Kernel load is a separate opt in path because attaching probes or pinning programs should never happen just because a note rendered.

<table>
  <thead>
    <tr>
      <th>Language</th>
      <th>What Loom does</th>
      <th>Toolchain</th>
      <th>Block controls</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>ebpf-c</code></td>
      <td>Compiles the snippet into a BPF object and can dump the ELF sections so section names, license blocks, and target issues are visible in the note.</td>
      <td><code>clang -target bpf</code>, optional <code>llvm-objdump</code></td>
      <td><code>loom-ebpf-mode</code>, <code>loom-ebpf-includes</code>, <code>loom-ebpf-cflags</code>, <code>loom-ebpf-pin</code></td>
    </tr>
    <tr>
      <td><code>bpftrace</code></td>
      <td>Checks scripts with bpftrace parse/debug mode by default, then only attaches to live probes when the block asks for run mode</td>
      <td><code>bpftrace --dry-run</code>, falling back to legacy <code>bpftrace -d</code></td>
      <td><code>loom-bpftrace-mode</code>, <code>loom-bpftrace-args</code></td>
    </tr>
  </tbody>
</table>

`ebpf-c` defaults to `loom-ebpf-mode=compile`. That path only emits an object file and runs object inspection. `loom-ebpf-mode=load` is deliberately more explicit: the global **Allow eBPF kernel load** setting must be enabled, and the block must provide a bpffs pin path:

````markdown
```ebpf-c loom-ebpf-mode=load loom-ebpf-pin=/sys/fs/bpf/loom_xdp
...
```
````

`bpftrace` defaults to `loom-bpftrace-mode=check`. Use `loom-bpftrace-mode=run` when a note is meant to attach to live probes instead of just validating parser and probe syntax.

## Container execution

Every block resolves its execution context through the same override stack:

```text
global settings to note frontmatter to block attributes
```

The context controls:

<ul>
  <li>container group</li>
  <li>working directory</li>
  <li>timeout</li>
</ul>

Global values come from the Loom settings tab. Note values come from frontmatter:

```yaml
loom-container: py-sandbox
loom-cwd: /tmp/research
loom-timeout: 15000
```

Block attributes override both note and global values:

````markdown
```python loom-container=py-sandbox loom-cwd=/tmp/research loom-timeout=15000
print("runs inside py-sandbox with this block context")
```
````

Use `loom-container=native`, `loom-container=none`, or `loom-container=off` to force a block back to native execution even when the note or global settings choose a container.

<table>
  <thead>
    <tr>
      <th>Layer</th>
      <th>Container</th>
      <th>Working directory</th>
      <th>Timeout</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Global</td>
      <td>Default containerization group</td>
      <td>Working directory</td>
      <td>Default timeout</td>
    </tr>
    <tr>
      <td>Note</td>
      <td><code>loom-container</code></td>
      <td><code>loom-cwd</code></td>
      <td><code>loom-timeout</code></td>
    </tr>
    <tr>
      <td>Block</td>
      <td><code>loom-container</code></td>
      <td><code>loom-cwd</code></td>
      <td><code>loom-timeout</code></td>
    </tr>
  </tbody>
</table>

### Container Group Directory
Container groups live inside the plugin folder:

```text
.obsidian/plugins/loom/containers/<group-name>/
```

Each group needs a `config.json`:

```json
{
  "runtime": "docker",
  "image": "python:3.12-slim",
  "elevation": {
    "mode": "default"
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

Container groups can opt into elevated execution without giving the host Obsidian process elevated privileges:

```json
{
  "runtime": "docker",
  "image": "alpine:latest",
  "elevation": {
    "mode": "root"
  },
  "languages": {
    "shell": {
      "useDefault": true
    }
  }
}
```

For Docker and Podman, `"mode": "root"` adds `--user root` to the container run. For QEMU, WSL, and custom runtimes, add an optional command prefix such as `"commandPrefix": "sudo -n"` if the target environment should elevate the command. Loom does not prompt for passwords or store credentials.

### Supported Runtimes

Loom supports the following runtimes under `"runtime"` in `config.json`:

<ul>
  <li><code>"docker"</code> / <code>"podman"</code>: Standard OCI container execution that mounts the group folder and runs your block command. If a <code>Dockerfile</code> exists inside the group folder, Loom builds and uses that image.</li>
  <li><code>"wsl"</code>: Runs commands inside Windows Subsystem for Linux (WSL). You can specify a WSL distribution name in the <code>"image"</code> field (for example <code>"Ubuntu"</code> or <code>"Debian"</code>), or omit it to run in your default WSL distro.</li>
  <li><code>"qemu"</code>: Runs commands on a remote VM using SSH, with optional automated QEMU local process management.</li>
  <li><code>"custom"</code>: Delegates container building, running, and teardown to a custom local executable wrapper.</li>
</ul>

### Visual Settings & Environment Manager
Loom provides a visual, tabbed dashboard directly within the plugin's settings tab for managing container environments. Click **Edit** next to any group to access:

<ul>
  <li><strong>General</strong>: Configure the runtime type, fallback image or WSL distro name, QEMU SSH settings, or Custom script configurations.</li>
  <li><strong>Languages</strong>: Visually add, remove, and update execution commands and source file extensions for individual languages.</li>
  <li><strong>Dockerfile</strong>: Create and edit a <code>Dockerfile</code> for Docker/Podman environments directly inside Obsidian.</li>
  <li><strong>Raw JSON</strong>: View and edit the group's raw <code>config.json</code> configuration file, with automatic syntax validation.</li>
</ul>

Optional health checks can be added at the group level or under `qemu` / `custom`:

```json
{
  "healthCheck": {
    "command": "docker info",
    "positiveResponse": "Server Version",
    "negativeResponse": "Cannot connect"
  }
}
```

QEMU ex:

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "loom-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes",
    "startCommand": "./start-vm.sh",
    "buildCommand": "./build-image.sh",
    "teardownCommand": "./stop-vm.sh",
    "healthCheck": {
      "command": "ssh loom-vm true"
    }
  },
  "languages": {
    "c": {
      "command": "gcc {file} -o /tmp/loom-c && /tmp/loom-c",
      "extension": ".c"
    }
  }
}
```

Managed QEMU:

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "loom-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes -p 2222",
    "manager": {
      "enabled": true,
      "executable": "qemu-system-x86_64",
      "args": "-m 2048 -smp 2 -nographic -netdev user,id=net0,hostfwd=tcp::2222-:22 -device virtio-net-pci,netdev=net0",
      "image": "vm.qcow2",
      "imageFormat": "qcow2",
      "pidFile": ".loom-qemu.pid",
      "logFile": "qemu.log",
      "readinessTimeoutMs": 60000,
      "shutdownCommand": "ssh -p 2222 loom-vm sudo poweroff",
      "persist": true
    },
    "healthCheck": {
      "command": "ssh -p 2222 loom-vm true"
    }
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

When `qemu.manager.enabled` is true loom starts QEMU as a detached local process, writes a PID file, polls the QEMU health check until the guest is ready, executes through SSH, and optionally shuts the VM down when `"persist": false`.

Custom wrapper:

```json
{
  "runtime": "custom",
  "custom": {
    "executable": "./loom-runtime.sh",
    "args": "{request}",
    "build": "./build.sh",
    "commandStructure": "{command}",
    "teardown": "./teardown.sh",
    "healthCheck": {
      "command": "./loom-runtime.sh --health",
      "positiveResponse": "ok"
    }
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

For custom runtimes loom writes a request JSON file and passes its path through `{request}` and the relevant runtime config.

`{group}` and `{groupPath}` are also available in wrapper args


## Toolchain(s)

Some languages are only usable when their toolchain is installed/visible to Obsidian

## Build

```bash
npm install --legacy-peer-deps
```

```bash
npm run build
```

## Smoke matrix

The smoke runner materializes the fixture vault from the `vault` branch, builds Loom from the current branch, installs only the compiled plugin artifacts into a temporary copy of that vault, runs tagged code blocks, and writes reports under `.loom/artifacts/smoke/<profile>`

```bash
npm run smoke
```

```bash
npm run smoke:matrix
```

<table>
  <thead>
    <tr>
      <th>Profile</th>
      <th>Command</th>
      <th>Focus</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>minimal</td>
      <td><code>npm run smoke -- --profile minimal</code></td>
      <td>Python, Shell, source extraction, cwd overrides</td>
    </tr>
    <tr>
      <td>systems</td>
      <td><code>npm run smoke -- --profile systems</code></td>
      <td>Shell plus native compiled C and C++ lanes</td>
    </tr>
    <tr>
      <td>proofs</td>
      <td><code>npm run smoke -- --profile proofs</code></td>
      <td>Proof and solver package gating</td>
    </tr>
    <tr>
      <td>ebpf</td>
      <td><code>npm run smoke -- --profile ebpf</code></td>
      <td>eBPF C object compilation and bpftrace availability checks</td>
    </tr>
    <tr>
      <td>full</td>
      <td><code>npm run smoke -- --profile full</code></td>
      <td>Every smoke block in the fixture vault</td>
    </tr>
  </tbody>
</table>

GitHub Actions runs the same profiles on push and pull request, CI installs headless Chrome plus the smoke toolchains, renders `report.html`, prints it to `report.pdf`, requires every selected block to run without skips, and uploads one artifact bundle per profile

The temporary test vault gets the compiled plugin world, not the TypeScript source tree, and the smoke command hashes the installed files and also loads `main.js` with a small Obsidian shim so CI proves the branch produced a usable compiled plugin artifact

<table>
  <thead>
    <tr>
      <th>Artifact</th>
      <th>Purpose</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>compiled-plugin.json</code></td>
      <td>Hash manifest for files installed into the temporary vault plugin directory</td>
    </tr>
    <tr>
      <td><code>compiled-plugin-load.json</code></td>
      <td>Compiled <code>main.js</code> load check with the Obsidian shim and registered language list</td>
    </tr>
    <tr>
      <td><code>report.json</code></td>
      <td>Machine readable block results, stdout, stderr, warnings, and extracted source</td>
    </tr>
    <tr>
      <td><code>report.md</code></td>
      <td>Small text summary for quick review</td>
    </tr>
    <tr>
      <td><code>report.html</code></td>
      <td>Rendered report used as the PDF source</td>
    </tr>
    <tr>
      <td><code>report.pdf</code></td>
      <td>Headless browser print output from the HTML report</td>
    </tr>
    <tr>
      <td><code>smoke-runner.mjs</code></td>
      <td>Bundled runner used for that profile</td>
    </tr>
  </tbody>
</table>

Local PDF export uses the same path when Chrome, Chromium, Google Chrome, or `wkhtmltopdf` is installed, or you can provide a browser explicitly:

```bash
LOOM_CHROME_PATH=/path/to/chrome npm run smoke -- --profile minimal --require-pdf
```

Without a browser, local smoke writes `pdf-skipped.txt` unless `--require-pdf` is set
