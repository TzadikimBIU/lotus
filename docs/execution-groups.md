# Execution Groups

Every block resolves its execution context through the override stack:

```text
global settings -> note frontmatter -> block attributes
```

The context controls:
- **Execution group**
- **Working directory**
- **Timeout**

Global values are defined in the Lotus settings tab. Note-level values are configured via YAML frontmatter:

```yaml
lotus-execution: py-sandbox
lotus-cwd: /tmp/research
lotus-timeout: 15000
```

> [!NOTE]
> `lotus-container` is accepted as a compatibility alias for `lotus-execution`.

Block-level attributes override both note and global values:

````markdown
```python lotus-execution=py-sandbox lotus-cwd=/tmp/research lotus-timeout=15000
print("runs inside py-sandbox with this block context")
```
````

Use `lotus-execution=native`, `lotus-execution=none`, or `lotus-execution=off` to force a block back to native execution, bypassing note-level or global configurations.

### Override Priority

| Layer | Execution group | Working directory | Timeout |
| :--- | :--- | :--- | :--- |
| **Global** | Default execution group | Working directory | Default timeout |
| **Note** | `lotus-execution` | `lotus-cwd` | `lotus-timeout` |
| **Block** | `lotus-execution` | `lotus-cwd` | `lotus-timeout` |

---

## Execution Group Directory

Execution groups reside in the plugin folder:

```text
.obsidian/plugins/lotus/containers/<group-name>/
```

Each group requires a `config.json` file:

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

### Elevation
Execution groups can opt into elevated execution without granting elevated privileges to the host Obsidian process:

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

For Docker and Podman, `"mode": "root"` appends `--user root` to the container run command. For QEMU, WSL, and custom runtimes, you can define an optional command prefix like `"commandPrefix": "sudo -n"` if the target environment should elevate execution. Lotus does not prompt for passwords or store credentials.

---

## Supported Runtimes

Lotus supports the following runtimes under `"runtime"` in `config.json`:

- `"docker"` / `"podman"`: Standard OCI container execution that mounts the group folder and runs your block command. If a `Dockerfile` exists inside the group folder, Lotus builds and uses that image.
- `"wsl"`: Runs commands inside Windows Subsystem for Linux. You can specify a WSL distribution name in the `"image"` field, or omit it to run in your default WSL distro.
- `"ssh"`: Runs commands on a remote SSH target through an SSH session.
- `"qemu"`: Runs commands on a remote VM using SSH, with optional automated QEMU local process management.
- `"custom"`: Delegates container building, running, and teardown to a custom local executable wrapper.
- `"http"`: Posts the resolved snippet to an HTTP endpoint through Obsidian requestUrl and maps the response back into normal Lotus output.

### Persistent Docker and Podman Containers

Docker and Podman groups can keep one container alive and run each block with `docker exec` or `podman exec`. Enable this when a note needs package installs, generated files, daemons, caches, or other process/container state to survive between block runs.

```json
{
  "runtime": "docker",
  "image": "python:3.12-slim",
  "persistent": {
    "enabled": true,
    "name": "lotus-python-lab",
    "keepAliveCommand": "sleep infinity"
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    },
    "shell": {
      "command": "sh {file}",
      "extension": ".sh"
    }
  }
}
```

`persistent: true` is accepted as shorthand for `{ "enabled": true }`. If `name` is omitted, Lotus derives a stable name from the execution group. On the first run Lotus creates and starts the container, then later runs reuse it. Remove it manually with `docker rm -f <name>` or `podman rm -f <name>` when you want a clean environment.

Persistent containers always run snippets in `/workspace`, the mounted execution group directory. Per-block `lotus-cwd` values cannot add new bind mounts to an already-created container, so Lotus warns and keeps exec runs in `/workspace`.

### HTTP Runtime Configuration

HTTP groups send the resolved block source to an endpoint and turn the response into a normal Lotus run result. This is useful for hosted compilers, internal sandboxes, queue based runners, or team services that already expose an API.

```json
{
  "runtime": "http",
  "http": {
    "url": "https://runner.example/run/{languageUri}",
    "method": "POST",
    "headers": {
      "X-Lotus-Language": "{language}"
    },
    "body": {
      "source": "{source}",
      "stdin": "{stdin}",
      "language": "{language}",
      "fileName": "{fileName}",
      "command": "{command}"
    },
    "successStatus": 200,
    "stdoutPath": "stdout",
    "stderrPath": "stderr",
    "exitCodePath": "exitCode",
    "successPath": "success"
  },
  "languages": {
    "python": {
      "extension": ".py"
    }
  }
}
```

Template values include `{source}`, `{stdin}`, `{language}`, `{languageAlias}`, `{sourceLanguage}`, `{fileName}`, `{extension}`, `{command}`, and `{workingDirectory}`. The `Uri` suffix gives an encoded value for URL paths and query strings. The `Json` suffix gives a JSON encoded string for raw body templates.

If `body` is omitted on POST, PUT, or PATCH, Lotus sends a JSON payload with the source, stdin, language, file name, and command. If response paths are omitted, stdout is the raw response body and success is based on the configured HTTP status.

### Graphviz Displays in Execution Groups

Graphviz display enrichment follows the same resolved execution context as the code block. If a note or block uses an execution group, Lotus runs `text/vnd.graphviz` rendering inside that group instead of requiring Graphviz on the host machine.

Declare a `graphviz` language when the group needs a custom command:

```json
{
  "runtime": "docker",
  "image": "graphviz:latest",
  "languages": {
    "graphviz": {
      "command": "dot -Tsvg {file}",
      "extension": ".dot"
    }
  }
}
```

If the group does not declare `graphviz`, Lotus falls back to `dot -Tsvg {file}`. The container, VM, WSL distro, or SSH target must still provide `dot`.

### Built in godbolt group

Lotus includes a built in `godbolt` execution group. It does not run a local container. Instead, it posts the resolved snippet source to the Compiler Explorer shortener API and returns the generated Godbolt URL. For languages with a known Compiler Explorer default, Lotus includes a compiler pane so opening the link shows compiler output immediately.

````markdown
```cpp lotus-execution=godbolt
int square(int x) {
  return x * x;
}
```
````

Set the compiler id and options on the block when you want to pin a specific compiler instead of using the Lotus default for that language:

````markdown
```cpp lotus-execution=godbolt lotus-godbolt-compiler=g152 lotus-godbolt-options="-O2 -std=c++20"
int square(int x) {
  return x * x;
}
```
````

Lotus resolves the compiler in this order: block attributes, vault Godbolt compiler defaults JSON, Compiler Explorer compiler metadata, then the baked in fallback map. Compiler metadata is fetched once per language and base URL, then cached in memory for the session. The settings tab exposes the default compiler map and default options map as JSON.

Supported Lotus mappings include C/C++, Rust, Go, Java, Python, JavaScript/TypeScript, Ruby, Perl, Lua, Haskell, OCaml, Lean, LLVM IR, assembly, and eBPF C. For another Compiler Explorer language, set `lotus-godbolt-language=<id>`.

Use `lotus-godbolt-compiler=none` for a source only link with no compiler pane.

Use `lotus-godbolt-base-url="https://ce.example.com"` to target a self hosted Compiler Explorer instance. Godbolt shortlinks are public, so do not use this group for private snippets.

### SSH Runtime Configuration
Remote SSH execution is configured with `"runtime": "ssh"` (or `"remote"`). By default, Lotus creates the remote workspace, writes the temp source file, runs the configured command, and removes the remote temp file through one `ssh` session. That avoids repeated password prompts and keeps stdin available for interactive programs.

```json
{
  "runtime": "ssh",
  "ssh": {
    "target": "user@vps.example",
    "workspace": "/tmp/lotus",
    "sshArgs": "-p 2222",
    "sshAuthSock": "/path/to/agent.sock",
    "uploadMode": "inline",
    "cleanupRemoteFile": true,
    "healthCheck": {
      "command": "uname -a",
      "positiveResponse": "Linux"
    }
  },
  "languages": {
    "shell": {
      "useDefault": true
    }
  },
  "outputFilters": {
    "stripAnsi": true,
    "stdoutStart": "LOTUS_OUTPUT_START",
    "stdoutEnd": "LOTUS_OUTPUT_END",
    "stripStderr": ["^Warning: Permanently added .*\\n"]
  }
}
```

Define `sshAuthSock` if the group should use a specific SSH agent socket (e.g., Bitwarden). Lotus does not store keys or prompt for passphrases; it only passes `SSH_AUTH_SOCK` to the `ssh` process. QEMU uses the same remote transport, so QEMU configs can also set `uploadMode`, `scpExecutable`, `scpArgs`, `sshAuthSock`, and `cleanupRemoteFile`.

Set `"uploadMode": "scp"` only when the remote shell cannot handle inline uploads. In that compatibility mode, Lotus falls back to separate `ssh`, `scp`, `ssh`, and cleanup processes, so password authentication may prompt more than once unless your SSH agent or connection config handles it.

### Jump Hosts and SSH Config

Lotus does not implement its own SSH transport. It delegates to your installed `ssh` client, and to `scp` only in SCP compatibility mode. Jump hosts, bastions, hardware tokens, agent forwarding, host key policy, and corporate SSH configuration should live in `~/.ssh/config` or in the group's SSH arguments.

The most maintainable setup is an SSH host alias:

```sshconfig
Host prod-runner
  HostName runner.internal
  User lotus
  ProxyJump bastion.example.com
  IdentityAgent ~/.1password/agent.sock
  StrictHostKeyChecking yes
```

Then the Lotus group can reference the alias directly:

```json
{
  "runtime": "ssh",
  "ssh": {
    "target": "prod-runner",
    "workspace": "/tmp/lotus",
    "sshArgs": "-o BatchMode=yes",
    "cleanupRemoteFile": true
  },
  "languages": {
    "python": {
      "useDefault": true
    }
  }
}
```

If you do not want to use an SSH config alias, put the jump options in `sshArgs`:

```json
{
  "runtime": "ssh",
  "ssh": {
    "target": "lotus@runner.internal",
    "workspace": "/tmp/lotus",
    "sshArgs": "-J bastion.example.com -o BatchMode=yes",
    "cleanupRemoteFile": true
  },
  "languages": {
    "shell": {
      "useDefault": true
    }
  }
}
```

### QEMU Runtime Configurations

#### Standard QEMU SSH Target

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "lotus-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes",
    "startCommand": "./start-vm.sh",
    "buildCommand": "./build-image.sh",
    "teardownCommand": "./stop-vm.sh",
    "healthCheck": {
      "command": "ssh lotus-vm true"
    }
  },
  "languages": {
    "c": {
      "command": "gcc {file} -o /tmp/lotus-c && /tmp/lotus-c",
      "extension": ".c"
    }
  }
}
```

#### Managed QEMU

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "lotus-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes -p 2222",
    "manager": {
      "enabled": true,
      "executable": "qemu-system-x86_64",
      "args": "-m 2048 -smp 2 -nographic -netdev user,id=net0,hostfwd=tcp::2222-:22 -device virtio-net-pci,netdev=net0",
      "image": "vm.qcow2",
      "imageFormat": "qcow2",
      "pidFile": ".lotus-qemu.pid",
      "logFile": "qemu.log",
      "readinessTimeoutMs": 60000,
      "shutdownCommand": "ssh -p 2222 lotus-vm sudo poweroff",
      "persist": true
    },
    "healthCheck": {
      "command": "ssh -p 2222 lotus-vm true"
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

When `qemu.manager.enabled` is `true`, lotus starts QEMU as a detached local process, writes a PID file, polls the QEMU health check until the guest is ready, executes through SSH, and optionally shuts down the VM when `"persist": false`.

### Custom Runtimes

```json
{
  "runtime": "custom",
  "custom": {
    "executable": "./lotus-runtime.sh",
    "args": "{request}",
    "build": "./build.sh",
    "commandStructure": "{command}",
    "teardown": "./teardown.sh",
    "healthCheck": {
      "command": "./lotus-runtime.sh --health",
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

For custom runtimes, Lotus writes a JSON request file and passes its path through `{request}`. The variables `{group}` and `{groupPath}` are also available in wrapper arguments.

---

## Health Checks

Optional health checks can be added at the group level or under `ssh`, `qemu`, and `custom`:

```json
{
  "healthCheck": {
    "command": "docker info",
    "positiveResponse": "Server Version",
    "negativeResponse": "Cannot connect"
  }
}
```

---

## Settings Dashboard

Lotus provides a tabbed dashboard in the plugin settings for managing execution environments. Click **Edit** next to any group to access:

- **General**: Configures runtime type, fallback image or WSL distro name, SSH settings, elevation, and output filters.
- **Languages**: Defines execution commands and source file extensions for individual languages.
- **Dockerfile**: Edits the Dockerfile for Docker and Podman environments.
- **Raw JSON**: Directly edits the group's `config.json` with syntax validation.
