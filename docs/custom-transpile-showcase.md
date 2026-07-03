# Lotus Custom Transpile Showcase

This note shows the custom-language settings needed for highlighting inheritance and transpile-only output. It does not install anything into Lotus settings.

## Configuration

Add these custom languages intentionally from Lotus settings, or put the same fields in a language-pack manifest.

```json
[
  {
    "name": "checked-c",
    "aliases": "ccheck",
    "mode": "execute",
    "highlightLanguage": "c",
    "targetLanguage": "",
    "executable": "node",
    "args": "-e 'const fs=require(\"fs\"); const s=fs.readFileSync(process.argv[1], \"utf8\"); console.log(\"custom C-like source accepted, bytes=\" + s.length);' {file}",
    "extension": ".c",
    "outputMode": "streams",
    "outputExtension": ".out"
  },
  {
    "name": "c-to-llvm-ir",
    "aliases": "c2llvm",
    "mode": "transpile",
    "highlightLanguage": "c",
    "targetLanguage": "llvm-ir",
    "executable": "node",
    "args": "-e 'const fs=require(\"fs\"); const s=fs.readFileSync(process.argv[1], \"utf8\"); console.log(\"; C-like input lowered to LLVM IR, bytes=\" + s.length); console.log(`source_filename = \"lotus.c\"`); console.log(\"define i32 @main() {\"); console.log(\"entry:\"); console.log(\"  ret i32 42\"); console.log(\"}\");' {file}",
    "extension": ".c",
    "outputMode": "streams",
    "outputExtension": ".ll"
  }
]
```

## Highlight Inheritance

This fence is a custom language, but Lotus applies `highlightLanguage: c` to the rendered source. Running it executes the configured command.

```checked-c
#include <stdio.h>

int main(void) {
  printf("hello from a custom C-like fence\n");
  return 0;
}
```

## Transpile Mode

This fence is also highlighted as C, but running it does not execute the generated LLVM IR. Lotus labels stdout as `Transpiled source · llvm-ir` and applies LLVM IR highlighting to the output pane.

After `c-to-llvm-ir` is configured, this block shows the curved-arrow transpile button in the toolbar.

```c-to-llvm-ir
int main(void) {
  return 42;
}
```

Expected transpiled stdout shape:

```llvm-ir
; C-like input lowered to LLVM IR, bytes=<n>
source_filename = "lotus.c"
define i32 @main() {
entry:
  ret i32 42
}
```
