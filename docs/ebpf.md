# eBPF Execution

eBPF support follows the standard BPF workflow: compile first, inspect the object, and then load only when intended. Loom writes the snippet to a temporary file, runs the appropriate frontend, and surfaces both compiler output and object metadata in the note. 

Kernel loading is a separate opt-in path; attaching probes or pinning programs will never occur automatically when a note renders.

| Language | What Loom does | Toolchain | Block controls |
| :--- | :--- | :--- | :--- |
| `ebpf-c` | Compiles the snippet into a BPF object and can dump the ELF sections so section names, license blocks, and target issues are visible in the note. | `clang -target bpf`, optional `llvm-objdump` | `loom-ebpf-mode`, `loom-ebpf-includes`, `loom-ebpf-cflags`, `loom-ebpf-pin` |
| `bpftrace` | Checks scripts with bpftrace parse/debug mode by default, then only attaches to live probes when the block asks for run mode. | `bpftrace --dry-run`, falling back to legacy `bpftrace -d` | `loom-bpftrace-mode`, `loom-bpftrace-args` |

---

## ebpf-c Modes

`ebpf-c` defaults to `loom-ebpf-mode=compile`. This path only emits an object file and runs object inspection. 

To load into the kernel, you must explicitly configure `loom-ebpf-mode=load`. The global **Allow eBPF kernel load** setting must be enabled, and the block must provide a bpffs pin path:

````markdown
```ebpf-c loom-ebpf-mode=load loom-ebpf-pin=/sys/fs/bpf/loom_xdp
// BPF code
```
````

---

## bpftrace Modes

`bpftrace` defaults to `loom-bpftrace-mode=check`. Use `loom-bpftrace-mode=run` when a note is meant to attach to live probes instead of just validating parser and probe syntax.
