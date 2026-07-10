# lotus godbolt showcase

this note shows the built in `godbolt` execution group. running these blocks sends the snippet to compiler explorer and returns a public shortlink.

## compiler output link

this is the default path. lotus opens compiler explorer with a compiler pane already configured, so the link shows compiler output when it loads.

```cpp lotus-execution=godbolt lotus-timeout=20000 lotus-smoke-name=godboltCompilerOutput lotus-smoke-profiles=full lotus-smoke-stdout-contains="godbolt.org/z/"
#include <array>

constexpr int sum(std::array<int, 4> values) {
  int total = 0;
  for (int value : values) {
    total += value;
  }
  return total;
}

static_assert(sum({1, 2, 3, 4}) == 10);
```

expected stdout shape:

```text
https://godbolt.org/z/<id>
```

## pinned compiler link

use `lotus-godbolt-compiler` and `lotus-godbolt-options` when you want to pin a specific compiler or options instead of using the Lotus default for the language.

```cpp lotus-execution=godbolt lotus-godbolt-compiler=g152 lotus-godbolt-options="-O2 -std=c++20" lotus-smoke=skip
int square(int x) {
  return x * x;
}
```

## other compiler explorer languages

lotus maps common lotus ids to compiler explorer ids automatically. for anything else, set `lotus-godbolt-language`.

```rust lotus-execution=godbolt lotus-godbolt-language=rust lotus-smoke=skip
pub fn mix(x: u32) -> u32 {
    x.rotate_left(7) ^ 0x9e37_79b9
}
```

## source only link

set `lotus-godbolt-compiler=none` when you want a source only compiler explorer link.

```cpp lotus-execution=godbolt lotus-godbolt-compiler=none lotus-smoke=skip
int main() {
  return 0;
}
```

## self hosted compiler explorer

point `lotus-godbolt-base-url` at a self hosted compiler explorer instance if the snippet should not leave your own infra.

````markdown
```cpp lotus-execution=godbolt lotus-godbolt-base-url="https://ce.example.com"
int main() { return 0; }
```
````
