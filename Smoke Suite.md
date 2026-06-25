# Smoke Suite

## Inline Python

```python lotus-smoke-name=python-inline lotus-smoke-profiles=minimal lotus-smoke-stdout=42
print(40 + 2)
```

## Shell

```shell lotus-smoke-name=shell-inline lotus-smoke-profiles=minimal,systems lotus-smoke-stdout=lotus-shell
echo lotus-shell
```

## Standard input

```python lotus-smoke-name=stdin-inline lotus-smoke-profiles=minimal lotus-stdin="alpha\nbeta" lotus-smoke-stdout=alpha|beta
import sys

print("|".join(line.strip() for line in sys.stdin))
```

## C

```c lotus-smoke-name=c-native lotus-smoke-profiles=systems lotus-smoke-stdout=21
#include <stdio.h>

int main(void) {
  printf("%d\n", 7 * 3);
  return 0;
}
```

## Python source extraction

```python lotus-smoke-name=python-extract lotus-smoke-profiles=minimal lotus-file="code/python_source.py" lotus-symbol=weighted_root lotus-call=true lotus-smoke-stdout=15.0
25
```

## Working directory override

```python lotus-smoke-name=cwd-override lotus-smoke-profiles=minimal lotus-cwd="fixtures" lotus-smoke-stdout=from-fixture
from pathlib import Path
print(Path("message.txt").read_text().strip())
```

## SMT proof path

```smtlib lotus-smoke-name=smtlib-basic lotus-smoke-profiles=proofs lotus-smoke=skip-missing lotus-smoke-stdout-contains=sat
(set-logic QF_LIA)
(declare-const x Int)
(assert (= x 7))
(check-sat)
```

## eBPF C compile

```ebpf-c lotus-smoke-name=ebpf-compile lotus-smoke-profiles=ebpf lotus-smoke-stdout-contains=xdp lotus-smoke=skip-missing
#define SEC(NAME) __attribute__((section(NAME), used))

typedef unsigned int __u32;

struct xdp_md {
    __u32 data;
    __u32 data_end;
};

SEC("xdp")
int xdp_pass(struct xdp_md *ctx) {
    return 2;
}

char _license[] SEC("license") = "GPL";
```

## bpftrace dry run

```bpftrace lotus-smoke-name=bpftrace-check lotus-smoke-profiles=ebpf lotus-smoke=skip-missing
BEGIN
{
  printf("lotus bpftrace check\n");
  exit();
}
```

## Kernel load guard

```ebpf-c lotus-smoke-name=ebpf-load-guard lotus-smoke-profiles=ebpf lotus-smoke=expect-fail lotus-smoke-stderr-contains="kernel loading is disabled" lotus-ebpf-mode=load lotus-ebpf-pin=/sys/fs/bpf/lotus_xdp
#define SEC(NAME) __attribute__((section(NAME), used))

typedef unsigned int __u32;

struct xdp_md {
    __u32 data;
    __u32 data_end;
};

SEC("xdp")
int xdp_pass(struct xdp_md *ctx) {
    return 2;
}

char _license[] SEC("license") = "GPL";
```
