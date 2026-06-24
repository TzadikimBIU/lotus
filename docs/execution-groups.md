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
- `"ssh"`: Runs commands on a remote SSH target after uploading the temporary source file with SCP.
- `"qemu"`: Runs commands on a remote VM using SSH, with optional automated QEMU local process management.
- `"custom"`: Delegates container building, running, and teardown to a custom local executable wrapper.

### SSH Runtime Configuration
Remote SSH execution is configured with `"runtime": "ssh"` (or `"remote"`). Lotus writes the snippet locally, creates the remote workspace, uploads the temp source file via `scp`, runs the configured command over `ssh`, and removes the remote temp file afterward (unless cleanup is disabled).

```json
{
  "runtime": "ssh",
  "ssh": {
    "target": "user@vps.example",
    "workspace": "/tmp/lotus",
    "sshArgs": "-p 2222",
    "sshAuthSock": "/path/to/agent.sock",
    "scpArgs": "-P 2222",
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

Define `sshAuthSock` if the group should use a specific SSH agent socket (e.g., Bitwarden). Lotus does not store keys or prompt for passphrases; it only passes `SSH_AUTH_SOCK` to the `ssh` and `scp` processes. QEMU uses the same upload/run/cleanup transport, so QEMU configs can also set `scpExecutable`, `scpArgs`, `sshAuthSock`, and `cleanupRemoteFile`.

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
