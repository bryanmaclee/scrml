# DISPATCH BRIEF — `if=` Phase 2, UNIT 1 (client path only)

**Change-id:** `if-mount-unmount-phase2` · **Unit:** 1 of 2 (client) · **Session:** S301 (bryan · ASUS)
**Agent:** `scrml-js-codegen-engineer` · **Model:** `opus` · **Isolation:** `worktree` (MANDATORY)
**Base:** `origin/main` @ `db159a51`
**Ruling authority:** bryan, S297 — option **(i) finish Phase 2**. Options (ii) *amend SPEC to sanction a
display lowering* and (iii) *lint now, fix later* were both put and both **declined**; (iii) is dropped
outright, not folded in as a phase.

> **UNIT 2 (SSR) IS NOT IN THIS BRIEF AND IS NOT YOURS.** See §7. Do not touch
> `compiler/src/codegen/emit-ssr-render.ts`. If your change appears to require an SSR edit, STOP and
> report — that is a finding, not a task.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its §"Task-Shape Routing" to the maps for this
task shape (codegen). Map stamp: **`d0763cff`** / 2026-07-30.

- **Post-map landings you must factor in:** exactly one code landing since the stamp — **#275
  `11bd0691`** (`synthCellKeys` threaded into function-body emit; touches `emit-functions.ts` +
  `scheduling.ts`). The other two (`3a295dff`, `db159a51`) are docs-only wraps. **None touches the
  `if=` lowering surface**, so the maps are current for your files.
- Treat map content as a **verify-against-source hypothesis**, never as truth.
- **Report the load-bearing finding — including "not load-bearing."** S299 measured this map set at
  **0/4 load-bearing** on its four loci with one row actively wrong. That measurement is live and your
  report feeds it. Say plainly whether any map row helped, and name any row that is wrong.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. **First action:** `pwd`. It MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Confirm `git rev-parse --show-toplevel` equals it, and the tree is clean. **If ANY check fails, do
   NOT proceed — report and exit.**
2. `bun install` (worktrees do NOT inherit `node_modules`; the pre-commit hook fails with "cannot find
   package 'acorn'" otherwise).
3. `bun run pretest` (populates the gitignored `samples/compilation-tests/dist/` fixtures; ~130
   ECONNREFUSED-shaped failures without it). Use `bun run test` for baselines, never bare `bun test`.
4. Every Write/Edit uses an **absolute path under the worktree root**. A relative path resolves against
   the shared checkout. **Never `cd` into the main checkout** — use `bun --cwd "$WORKTREE_ROOT"`,
   `git -C "$WORKTREE_ROOT"`.
5. First commit message: `WIP(if-phase2-unit1): start at $(pwd)` — the PA verifies the prefix on landing.
6. **Commit after every meaningful edit** (WIP commits expected) and keep an append-only
   `progress.md` (timestamped: what was just done / what's next / blockers). The branch + progress.md
   are the crash-recovery anchor.

---

## 1. The defect, and the governing sentences

`if=` compiles to **two different lowerings with different DOM semantics**, chosen silently at compile
time. One is conformant; the other is not.

**Rule-4 gate — outcome (1), sentences FOUND (quoted):**

- **§17.1** (`SPEC.md:10908`) — *"The `if=` attribute is a structural boolean conditional."*
- **§17.1** (`:10914`) — *"When `expr` evaluates to false, the element is NOT rendered. **It does not
  exist in the DOM.**"*
- **§17.2** (`:11195`) — *"`show=` is distinct from `if=`: **`show=` hides, `if=` removes**."*

Reverse direction searched (§17.1, §17.1.1, §17.2, §17.4, §17.4a, §17.4b, §17.6, §17.7, §10):
**no sentence anywhere sanctions a display lowering for `if=`.** The only `display:none` sanction in
SPEC is §17.2's, explicitly scoped to `show=`.

**Direction-of-change (pa-base §8): `semantics-changed`, TOWARD the contract** — a conformance
restoration, not a widening. You are making the compiler do what §17.1 already says. This is the
category that gates are weakest against (no diagnostic moves; only an artifact diff reveals it), which
is why §6's R26 artifact diff is not optional.

## 2. The discriminator — and how narrow "clean" really is

`isCleanIfNode()` marks a subtree clean only if, recursively: every node is `markup`/`text`/`comment`
(any `logic`/`expr`/`state`/`if-chain`/`meta` child makes it **dirty**); no tag starts with a capital
(components are dirty); every attribute passes `attrIsWiringFree`.

**A single `${…}` interpolation flips `if=` from *removes* to *hides*.**

| shape | lowering | conformant |
|---|---|---|
| `<div if=@v>plain static text</div>` | `<template>` + `<!--scrml-if-marker-->` | ✅ |
| `<div if=@v><span>still static</span></div>` | `<template>` + marker | ✅ |
| `<div if=@v>${@label}</div>` | `data-scrml-bind-if` → `style.display` | ❌ |

## 3. Loci — **PA-located, VERIFY** (pa-base v2.7)

I re-derived every line number on `db159a51` (the SCOPING doc's were from `115e8b1b`); they are
unchanged. **But I traced the clean/dirty DECISION only — by compiling and matching emitted output
back to `isCleanIfNode`. I have NOT traced the rebind path end-to-end at runtime.** Report whether
each hypothesis **held, was refined, or was wrong**.

| what | where (verified on `db159a51`) |
|---|---|
| `isCleanIfSubtree()` — standalone `if=` entry | `compiler/src/codegen/emit-html.ts:643` |
| `attrIsWiringFree()` | `emit-html.ts:660` |
| `isCleanIfNode()` — **the discriminator** | `emit-html.ts:678` |
| `isCleanChainBranch()` — chain branches | `emit-html.ts:735` |
| the Phase-2 TODO comment | `emit-html.ts:2930` |
| **the Phase-1 fork both flags collapse into** | `emit-event-wiring.ts:1568-1570` |
| `_scrml_find_if_marker(mid, (root \|\| document))` | `emit-event-wiring.ts:1453` |
| clean controller's mount/unmount | `emit-event-wiring.ts:1459-1460` |
| chain-branch marker resolution | `emit-event-wiring.ts:1934` |

## 4. Why this is smaller than "rewrite the `if=` codegen"

**The machinery the dirty path needs already exists and the clean path's own controller already uses
it** — verified present on `db159a51`:

| need | mechanism | where |
|---|---|---|
| mount a subtree from a template | `_scrml_mount_template` | `emit-event-wiring.ts:1460` |
| scoped teardown | `_scrml_create_scope` / `_scrml_unmount_scope` | `:1459`, `:112` |
| locate the insertion point | `_scrml_find_if_marker` | `:1453` |
| **re-run wiring against a swapped root** | `pushRebindableSel(sel, body)` → emits into `reactiveRewire`, wrapped `(root \|\| document).querySelector(...)` | `:987` |
| **track effects for teardown** | `regionEffectLines()` → `_scrml_effect` + `_scrml_region_track(el, …)` | `:1005-1007` |

The last two are what make this tractable: soft-nav already needed *"re-bind this wiring against a
region that got swapped in, and tear it down on the way out"* — exactly what a dirty `if=`
mount/unmount needs. Both halves live in the same emitted function and are **already parameterized on
`root`**.

**Hypothesis to confirm or refute:** route dirty branches through the same `<template>` + marker
emission as clean ones, and on mount invoke the subtree's existing rebindable wiring with `root` =
the mounted node; on unmount, `_scrml_unmount_scope`.

## 5. Baseline — measured on `db159a51`, with the command pinned

`examples/23-trucking-dispatch` (36 files):

```sh
bun compiler/bin/scrml.js compile examples/23-trucking-dispatch/ -o "$OUT"
grep -ro "data-scrml-bind-if" --include="*.html" "$OUT" | wc -l   # 101  (dirty)
grep -ro "scrml-if-marker"    --include="*.html" "$OUT" | wc -l   #  48  (clean)
```

**`--include="*.html"` is load-bearing.** The attribute name also appears in `.client.js`, so an
unscoped `grep -r` over the dist reads **202** and looks like a regression. The SCOPING doc's
acceptance gate did not state the scope; this is the pinned form. **101 + 48 = 149**, which is the
post-fix clean-marker target.

## 6. Acceptance gate — all six

1. Every shape in §2's table emits `<template>` + marker; **zero** `data-scrml-bind-if` in the corpus.
2. Re-run §5 with the pinned commands: `data-scrml-bind-if` → **0**; `scrml-if-marker` → **149**.
3. §4-of-SCOPING reproducer: predicate false → gated content **absent** from the initial HTML
   (`grep -c 'display:none'` is not the check — absence is).
4. **A conformance case pinning the ABSENCE half.** `conformance/cases/reactive/toggle-show/` is
   misnamed (it pins `if=` mount, cites §17.1) and asserts only `count: 1` after false→true. §17.1's
   *"does not exist in the DOM"* has **no assertion anywhere** — that hole is precisely why three
   divergent lowerings coexisted green. New cases must assert `count: 0` when false, at **standalone
   `if=`**, **chain-branch**, and **Tier-1 `<each>` per-row**. Both halves (codes + runtime).
5. Full local subset green: `bun test compiler/tests/{unit,integration,conformance}` — **21597 pass /
   0 fail** is the current baseline; do not regress it. (The PA runs the S239 adversarial pass
   separately — you cannot invoke it in-agent. Expect a fix round.)
6. **R26 empirical:** recompile real sources on the post-fix baseline and **diff artifacts**, confirming
   no unintended `semantics-changed` beyond the intended one. `grep`-clean is NOT the check; a
   green suite is NOT the check.

## 7. Out of scope — do not touch

- **SSR (`emit-ssr-render.ts`) — unit 2, and its scope is under a ruling.** I verified on `db159a51`
  that SSR **throws `SsrUnsupported` on `if=`/`show=`/`else`/`else-if`** (`:213-221`) and the caller
  **returns `null`** (`:370-373`), i.e. a block carrying `if=` is *excluded from prerender per-block*
  and the rest proceeds. So SSR does not render gated content today and there is **no client/SSR
  divergence for this change to create** — which falsifies OQ-1's stated premise. Held for bryan.
- **Tier-1 `<each>` per-row `if=` reactivity** — same ruling, different arc; **Peter's lane**.
- **Tier-0 `${for…lift}` per-row `if=`** — separately non-conformant (`emit-lift.js:395/1114/1380`
  emit `style.display`); its own gap, sequence after this arc.
- **`show=`** — conformant. Untouched. If your change alters a `show=` lowering, that is a regression.

## 8. Migration risk — measured, and its limit stated

101 sites change *lowering*, but absent-vs-hidden is only *observable* in three places and our corpus
barely uses them: structural pseudo-classes (`:nth-child`/`:first-child`/…) **0 hits**; CSS sibling
combinators **1**; form control inside an `if=` subtree **1** (same-line heuristic, so treat as a
floor). **Two honest limits: this is OUR corpus only — adopter code is unmeasured — and the
form-control check is a heuristic.** Re-run against adopter sources before landing (PA does this).

## 9. Prerequisite — CLOSED

The blocker was a **component-expansion node-id collision** (two list components sharing one `<each>`
id → renderer map second-write-wins → one panel renders the other's data, one empty, green compile).
Closed by **#273 `d0763cff`** (`expandComponentNode` clones `def.nodes` per expansion with the
file-level counter). Gap `g-each-anchor-lookup-first-match-document-wide` is **resolved**. Verified by
the PA at S301 — do not re-litigate, but if you observe a shared-id symptom, STOP and report.
