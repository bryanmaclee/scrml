# progress — s454-types-gate-blocking (append-only)

- base 48cf11046 == origin/main; bun install + pretest OK.
- `--check` on base: exit 1; 30 NEW + 1 GROWN, 9 GONE (most GONE are re-keys of the same diagnostic — the key embeds tsc's truncated type shape, so widening an opts type re-keys every diagnostic that prints it).
