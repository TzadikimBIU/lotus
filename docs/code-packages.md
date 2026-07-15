# Note-scoped code packages

`lotus-code-package` lets a C or C++ example span several fenced blocks in one note. Every block with the same package name is written into one temporary directory, then the package's translation units are compiled and linked together.

````markdown
```h lotus-code-package=answer lotus-code-file=answer.h
#ifndef ANSWER_H
#define ANSWER_H
int answer(void);
#endif
```

```c lotus-code-package=answer lotus-code-file=answer.c
#include "answer.h"

int answer(void) {
  return 42;
}
```

```c lotus-code-package=answer lotus-code-file=main.c
#include <stdio.h>
#include "answer.h"

int main(void) {
  printf("%d\n", answer());
  return 0;
}
```
````

run any member and lotus builds the whole `answer` package. package membership is note-scoped, so another note can reuse the same name without sharing files.

## filenames

`lotus-code-file` is optional. lotus infers `block-N.c`, `block-N.h`, or `block-N.cpp` from the block ordinal and fence language when it is omitted. give a file an explicit name when another file includes it, or when a directory layout matters:

````markdown
```h lotus-code-package=answer lotus-code-file=include/answer.h
int answer(void);
```
````

filenames must be safe relative paths. absolute paths, `.` or `..` segments, empty segments, backslashes, and case-insensitive duplicates are rejected. the package root is added to the compiler's include path. headers and other files are materialized but only native source extensions are passed to the compiler.

## current limits

- packages support C and C++ and can't mix the two within one package
- packages use native execution; add `lotus-execution=native` when a note or vault defaults to an execution group
- `lotus-file` source extraction can't be combined with `lotus-code-package`
- running **Run all supported code blocks** builds the package once for each member, bc each fence is still independently runnable

the temporary package directory is removed after the run. the compiled program still uses the block's normal resolved working directory and stdin settings.
