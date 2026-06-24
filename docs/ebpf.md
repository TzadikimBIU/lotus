# eBPF Execution

eBPF support follows the standard BPF workflow: compile first, inspect the object, and then load only when intended. Lotus writes the snippet to a temporary file, runs the appropriate frontend, and surfaces both compiler output and object metadata in the note.

Kernel loading is a separate opt-in path; attaching probes or pinning programs will never occur automatically when a note renders.

| Language | What Lotus does | Toolchain | Block controls |
| :--- | :--- | :--- | :--- |
| `ebpf-c` | Compiles the snippet into a BPF object and can dump the ELF sections so section names, license blocks, and target issues are visible in the note. | `clang -target bpf`, optional `llvm-objdump` | `lotus-ebpf-mode`, `lotus-ebpf-includes`, `lotus-ebpf-cflags`, `lotus-ebpf-pin` |
| `bpftrace` | Checks scripts with bpftrace parse/debug mode by default, then only attaches to live probes when the block asks for run mode. | `bpftrace --dry-run`, falling back to legacy `bpftrace -d` | `lotus-bpftrace-mode`, `lotus-bpftrace-args` |

---

## ebpf-c Modes

`ebpf-c` defaults to `lotus-ebpf-mode=compile`. This path only emits an object file and runs object inspection.

To load into the kernel, you must explicitly configure `lotus-ebpf-mode=load`. The global **Allow eBPF kernel load** setting must be enabled, and the block must provide a bpffs pin path:

````markdown
```ebpf-c lotus-ebpf-mode=load lotus-ebpf-pin=/sys/fs/bpf/lotus_xdp
// BPF code
```
````

---

## bpftrace Modes

`bpftrace` defaults to `lotus-bpftrace-mode=check`. Use `lotus-bpftrace-mode=run` when a note is meant to attach to live probes instead of just validating parser and probe syntax.
