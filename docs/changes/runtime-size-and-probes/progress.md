# progress — runtime-size-and-probes

Append-only. Timestamped.

## 2026-08-19 — start

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac34b2f1d40747c65`
- Branch: `runtime-size-and-probes`
- Base: `origin/main` @ `70eef677` — the brief named `e305216d`; main had already moved past it.
  Recording the discrepancy rather than pinning to the stale SHA, since the brief's own
  command was `git checkout -B ... origin/main`.
- `bun install` clean (217 packages).
- Scope: `scripts/` only. Unit 1 is measurement (no build). Unit 2 adds two boot probes.

## 2026-08-19 — UNIT 1 measurement landed (`scripts/runtime-size-levers.ts`)

### The brief's premise #1 was wrong: an enforcing gate DOES exist

`compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145`

```js
expect(gzip.length).toBeLessThan(16 * 1024);
```

It runs in the integration suite, which the pre-commit hook runs. The 16 KB
budget is **enforced**, not prose-only. `docs/known-gaps.md:1390` names that
exact file:line; the grep that found nothing presumably looked for `16384` or
a `budget`-shaped identifier rather than `16 * 1024`.

### The recorded margin is stale

known-gaps records **16,257 B / 127 B margin** at base `e8fdd44c`.
Re-measured at `origin/main` 70eef677 on the test's own `SPA_COUNTER` fixture:

**15,600 B gzip — 784 B margin.** The knife-edge is 6x less sharp than filed.

### The levers (all isolation-checked; see below)

Core runtime, SPA_COUNTER, gzip at the level the gate uses (zlib default):

| lever | gzip | saves | margin after |
|---|---|---|---|
| baseline | 15,600 | — | 784 |
| N  `_scrml_*` shortened | 15,355 | 245 B (1.6%) | 1,029 |
| C  comments stripped | 5,757 | **9,843 B (63.1%)** | 10,627 |
| W  C + formatting collapsed | 5,084 | 10,516 B (67.4%) | 11,300 |
| WN both | 4,775 | 10,825 B (69.4%) | 11,609 |

**Name shortening is the wrong lever by 40x.** The finding is that
**49.1% of the shipped core runtime's raw bytes are comments** — 26,877 B
across 318 comments, which alone gzip to 10,030 B. They are
compiler-maintainer notes (`S103 Phase 3 select-row chip-away (Candidate A)`,
`SCOPING §2.2`, TDZ rationale) shipping over the wire to end users.

TodoMVC's runtime is worse: 55.0% comments, and it is **44,557 B gzip — 28 KB
OVER the 16 KB budget already**. The gate only ever measures the minimal SPA
shape, so the ceiling has never applied to what a real app ships.

### Isolation is proven, not asserted

Every lever's output is re-parsed and compared to the baseline on: AST node
count, function count, class count, top-level statement count, string-literal
multiset (incl. template cooked values), numeric-literal multiset, and
non-computed property-key multiset. All five levers report clean.

Contrast, run under the same checker (`--with-bun-minify`):
`bun build --minify` reports a 94.9% "saving" **while dropping 70 functions to
6 and 9 classes to 0.** The prior fictitious ~95% figure is reproduced and
explained, by execution rather than by relay.

### Two real hazards the checker caught while being built

1. A naive `src.replace(/_scrml_\w+/g, ...)` rewrites the token inside a
   **string literal** — on this runtime it corrupts the diagnostic
   `"scrml runtime: _scrml_reactive_derived is retired (§6.6)"`.
2. It also rewrites **property keys** — breaking `globalThis._scrml_perf_dump`
   / `_scrml_perf_reset` / `_scrml_perf_snapshot`, the devtools hook surface.

The shipped lever N is AST-driven and skips both.

### Comment removal is provably inert on this artifact

Zero `sourceMappingURL` / `sourceURL` / `@license` / `/*!` / `@preserve` /
`#__PURE__` pragmas in the emitted runtime (grep count 0). Nothing in the
comment stream carries meaning to a tool.
