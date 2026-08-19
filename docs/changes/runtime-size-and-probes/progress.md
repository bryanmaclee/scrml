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

## 2026-08-19 — UNIT 2: two boot probes + bite proofs

`scripts/inbox-stranded.ts` and `scripts/ruling-debt.ts`, both registered in
`scripts/boot.ts` between `issue-debt` and `issues`. Detection only, exit 0
always, never CI-gating.

### Probe A — `inbox-stranded`

Predicate: delivered iff `main`'s **history** ever added a file with that
**basename** under `handOffs/incoming/`. Basename because archiving moves
`incoming/X.md` -> `incoming/read/X.md`; history because a delivered-then-
deleted message was still seen. Both choices exist to avoid going red over the
correct backlog (the §8 cry-wolf shape).

Steady state on `origin/main`: **3 stranded of 339**, all real:

| message | on |
|---|---|
| `2026-07-12-spa-ss66-reintegration.md` | `spa/ss66` |
| `2026-07-16-from-spa-ss56-REINTEGRATE-engine-wave2-51.md` | `spa/ss56` |
| `2026-08-18-0720-scrml-site-to-scrml-soft-nav-drops-page-stylesheet.md` | `inbox/scrml-site-soft-nav-stylesheet` + `continuity/s350` |

The brief said the soft-nav message was "also delivered to a PA branch, so
account for that." **It was delivered to a branch and the branch never landed.**
`origin/continuity/s350` carries it already moved to `read/` — so it looks
handled from the branch that handled it, and `origin/main` has it in neither
`incoming/` nor `incoming/read/`. It is still undelivered. The probe reports it,
correctly.

**Bite proof.**
1. Committed `handOffs/incoming/9999-01-01-BITE-PROOF-synthetic-stranded-message.md`
   on a throwaway branch `bite-proof-inbox`, then checked out
   `runtime-size-and-probes` so the file was NOT in the working tree.
2. Confirmed both existing checks are blind: `ls handOffs/incoming/` shows only
   `read` + the S349 memo; `git status --porcelain handOffs/incoming` is empty.
3. Probe: **3 -> 4 STRANDED**, naming `on: bite-proof-inbox`. RED.
4. `git branch -D bite-proof-inbox`; probe back to **3**. GREEN-restored.

**False-positive control, from real data rather than construction:**
`2026-08-12-S341-peter-to-S341-bryan-import-meta-const-init-mangling.md` is
*also* committed on a non-main inbox branch
(`origin/inbox/s341-peter-import-meta-mangling`) — but main archived it to
`read/`, and the probe does NOT report it. The `read/`-strip is load-bearing and
verified.

### Probe B — `ruling-debt`

Complement to the existing `dpa` probe: that one asks "is everything IN the
queue disposed?", this asks "is everything that needs disposing in the QUEUE?"
Detects two ways — **positional** (`*.md` under any `rulings-pending/` dir, any
depth) and **structural** (`authority-needed:` in YAML front matter).

**The brief's scope was one directory short.** It named
`scrml-support/docs/audits/**/rulings-pending/*.md`. The structural detector
found a second location the brief did not know about:
`scrml-support/docs/rulings-pending/dpa-029-Q1-egress-envelope.md` — prepared
S349-peter, dated 2026-08-17, **not referenced in `dpa-queue.md` in either
`origin/main` or main's working tree.** A second live instance of the same
failure. (Reporting only — the egress surface itself is out of scope here.)

Hardcoding the audits path would have missed it. That is why the probe does not.

**The dpa-034 verification the brief asked for, by execution:**

| queue read | findings |
|---|---|
| `origin/main`'s `handOffs/dpa-queue.md` (pre-delivery) | **3** — incl. `R5-d1-no-editions.md` |
| main's **working-tree** queue (carries `dpa-034`) | **1** — only `dpa-029-Q1` |

So: it *would* have reported R5 before the hand-delivery, and it reports zero
from the audits directory after. Both halves confirmed against real states, not
constructed ones.

⚠ Also worth noting: `dpa-034` is **uncommitted in main's working tree**. By the
same per-clone logic Probe A encodes, it is not delivered yet.

**Bite proof** (fixture tree via the `SCRML_SUPPORT` / `SCRML_DPA_QUEUE`
overrides, which exist so the bite can be proven without mutating real
artifacts):

- fixture: `R9-positional-only.md` (in `rulings-pending/`, **no front matter**),
  `Z1-structural-only.md` (front matter, **not** in `rulings-pending/`),
  `Z2-ordinary.md` (neither).
- queue referencing nothing -> **2 findings**, one from each detector
  independently; `Z2` correctly NOT reported. RED.
- queue referencing both -> **0 findings**. GREEN.
- queue referencing only `Z1` -> **1 finding** (`R9`). RED again, per-item.

### Standing caveat on both probes

Both are red today over a genuine pre-existing backlog (3 and 1-3
respectively). §8's warning applies: a probe permanently red gets ignored and
then deleted. These are small, drainable counts — deliver the three stranded
messages and queue `dpa-029-Q1` and both go green. If that does not happen the
probes will decay into wallpaper regardless of being correct.
