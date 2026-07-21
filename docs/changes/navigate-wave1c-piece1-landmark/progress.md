# navigate-wave1c PR-1 — marker-driven composition + the ONE-LANDMARK invariant

Append-only progress log. Dispatch S276.

---

## 2026-07-20 — startup + baseline

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a320ce9f1464c6c72`
Base: `020485b2` (clean). `bun install` + `bun run pretest` OK.

Maps read: `primary.map.md` -> routing sends outlet/Client-Router work to `domain.map.md`
(+ `structure.map.md` for codegen layout). Load-bearing finding from `domain.map.md`:
`<outlet>` is **NOT a dedicated AST node** — it is plain `kind: "markup"` with `tag: "outlet"`,
rewritten to a container element in `emit-html.ts`. That is why both the landmark decision and the
composition slot decision are *textual/emit-time*, not AST-typed.

### Empirical baseline at `020485b2` (probe: compile + inspect emitted `<body>`)

| case | errors | `<main>` count | marker element |
|---|---|---|---|
| `<program><h1/><outlet/></program>` | none | 0 | `<div data-scrml-outlet tabindex="-1">` |
| `<program><main><outlet/></main></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| `<program><main>x</main><outlet/></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| D2 `<program><nav/><outlet/><page><main/></page></program>` | none | 1 | `<div data-scrml-outlet tabindex="-1">` |
| D3 multi-file shell+outlet, route has own `<main>` | none | route page: 1 `<main>`, **no marker, NO shell chrome** | — |
| D3b multi-file shell+outlet, plain route | none | 0 | **no marker, NO shell chrome** |
| back-compat bare `<main>` shell + route | none | 1 | n/a (composed, chrome + route both present) |

**KEY BASELINE FACT (drives the whole design):** an `<outlet>`-only shell does **NOT compose at all**
today — route pages emit standalone with zero shell chrome. That is the §20.8-vs-§40.8 coherence gap
this PR closes.

**KEY BASELINE FACT 2 (not in the brief; found empirically):** in a **single-file** `<program>` with
`<page>` children, the page bodies emit **INLINE** into the same document, in source position — they
are NOT composed into the outlet. So the D2 shape puts the route's `<main>` and the outlet marker in
ONE document. If the outlet unconditionally became `<main>`, D2 would emit TWO `<main>`s. This makes
ruling case 3 a *single-file* concern too, not only the multi-file composition concern the brief
describes. Handled in `emit-html.ts` (see below), not only in `index.ts`.

### Design derived from the ruling (one landmark; the MARKER decides the slot)

- `emit-html.ts` — `<outlet>` emits `<main data-scrml-outlet tabindex="-1">` **iff the emitted
  document carries no author `<main>` anywhere**; otherwise `<div data-scrml-outlet tabindex="-1">`.
  This one predicate covers ruling case 1 (bare outlet -> `<main>`), case 2 (outlet wrapped in an
  author `<main>` -> `<div>`), and the single-file form of case 3 (`<page>`-scoped `<main>` -> `<div>`).
  The marker + `tabindex` ride the element in BOTH forms — the marker, not the tag, is the slot.
- `index.ts` — multi-file composition: slot = first element carrying the `data-scrml-outlet`
  **attribute name** (proper open-tag/attribute scan, not a `\b` regex), else first bare `<main>`
  (back-compat). Per composed page, if the ROUTE body carries its own `<main>`, the marker slot is
  DEMOTED `<main>` -> `<div>` in that page's composed output (ruling case 3, multi-file form).
- `symbol-table.ts` — `E-OUTLET-AND-MAIN` narrowed to the BARE/SIBLING case only: an author `<main>`
  in shell scope that neither encloses nor is enclosed by the outlet, and is not inside a `<page>`.

---

## 2026-07-20 — landed

All four ruling cases implemented + verified empirically (see the report table). Files:
`compiler/src/codegen/emit-html.ts`, `compiler/src/codegen/index.ts`, `compiler/src/symbol-table.ts`,
`compiler/tests/integration/navigate-wave1c-outlet-composition.test.js` (16 tests),
`compiler/SPEC.md` (NEW §20.8.1.1 + NEW §40.8.2 + §20.8.6 + §20.8.7 + §34), `compiler/SPEC-INDEX.md`.

### R26 empirical

- `examples/23-trucking-dispatch` (25 html) + `docs/website` (98 html), base `020485b2` vs final:
  **`diff -rq` clean — byte-identical, both.** `runtime-template.js` untouched, so no content-hash shift.
- Real-scale `<outlet>` MPA: `docs/website` with its shell `<main>` swapped for `<outlet>` (98 route
  files). AFTER: 98/98 documents have **exactly one `<main>`**, 98/98 carry `[data-scrml-outlet]`,
  98/98 carry shell chrome, slot tag = `main` on all 98. BEFORE (base `020485b2`), same source:
  **0/98 documents had any `<main>`**, 97/98 had **no marker and no shell chrome** — composition
  never ran. That is the coherence gap, measured at corpus scale.

### DEFERRED — an UNRULED shape found adversarially (NOT improvised past)

`<main><outlet/></main>` shell (case 2) composed with a route body that brings its own `<main>`
(case 3) emits **two nested `<main>` elements**:

```
<main><div data-scrml-outlet>  <main class="route">…</main>  </div></main>
```

The ruling states case 3 as "the SLOT emits as a `<div data-scrml-outlet>`". Here the landmark is NOT
the slot — it is the author's `<main>` ANCESTOR of the slot, outside the spliced region — so the
stated remedy does not reach it. Resolving it means picking one of: (a) a new composition-time
diagnostic (the shell alone is legal and the route alone is legal; only the cross-file combination is
bad, which the per-file SYM pass cannot see); (b) demote the ROUTE's `<main>`; (c) demote the SHELL's
wrapping author `<main>` for that composed document. (b) and (c) both rewrite AUTHOR markup, which
§40.8.2 deliberately declines to do for the back-compat bare-`<main>` slot — so this is a genuine
fork, not an obvious extension. **Surfaced, not improvised** (per BRIEF: "STOP and report the fork").

**This is PRE-EXISTING, not a regression.** Base `020485b2` emits two nested `<main>` for the same
source AND additionally loses the outlet marker entirely (the old composition picked the author's
`<main>` as the slot and overwrote the `<div data-scrml-outlet>` with the route body). This PR
strictly improves the shape — the marker now survives — without closing the two-landmark half.

No test asserts the current output here: pinning a known-defective shape as "expected" would turn a
future fix into a red suite.

### Minor, noted

`htmlHasMainElement` (index.ts) scans open tags textually, so a `<main>` inside a `<template>` or an
HTML comment in a route body would also trigger the slot demotion. Conservative direction (the
composed document would then carry no rendered landmark rather than two); not observed in corpus.

## 2026-07-21 — S276 PA-DIRECT FIX ROUND (bryan authorized "go pa-direct")

The dispatched fix round was STOPPED after its first commit (`39deb811`, the test-oracle fix) to
avoid two writers on one branch. That commit is retained — it is correct and was the right first
step. Everything below is PA-authored.

### Context — why a fix round existed
`01aaad71` (PR-1 as built) went through a PA-side adversarial pass: 3 independent lenses + PA
reproduction of every claim before acceptance. Result: 2 BLOCKING regressions vs base `020485b2`
and 5 MED. Notably NOT defects: the attribute tokenizer (attacked hard, held), the test inversion
(done properly), and the deferred-fork report (honest, independently verified pre-existing).

### FIXED (commit `d5320ee3`)
- **BLOCKING-1 — splice had no depth counting.** `indexOf('</'+slotTag+'>')` was valid only while
  the slot was always `<main>` and always empty. This PR made `slotTag` variable and `<outlet>`
  accepts children, so a `<div>` slot holding a `<div>` terminated on the inner close: unbalanced
  document, following siblings reparented out of their container, slot children silently dropped,
  clean compile. NEW `findMatchingCloseIdx()` depth-counts, skips comments + `<script>`/`<style>`
  raw text, and does not open a level for a self-closing same-tag element.
- **BLOCKING-2 — landmark decision was invocation-scoped.** `generateHtml` is RE-ENTERED with
  `arm.body`, so an `<outlet>` in a match/engine arm could not see an author `<main>` wrapping the
  match; it took the `<main>` landmark and the dispatcher injected it inside that `<main>` →
  nested `<main>` on initial paint, in the shape CASE 2 blesses as legal. Now computed once at the
  top-level invocation and shared via CompileContext, with a `fileAST` fallback so the answer stays
  document-scoped regardless of invocation order.
- **MED-2 — open-mains leaked across a shell boundary.** A nested `<program>`'s outlet marked the
  OUTER shell's `<main>` as wrapping, silencing a textbook case-4 shell. The path now resets at a
  `<program>` boundary.

### FIXTURES (commit `b153f8b5`) — the real gap
7 added. **Verified as genuine regression tests:** with the 3 source fixes reverted to `39deb811`
and the fixtures kept, **5 of 7 FAIL**; restored, all pass. The 2 that pass both ways pin behaviour
PR-1 itself changed without claiming (empty `<main></main>` now composes; `<MAIN>` now matches) —
that is their purpose. §7 asserts on the CLIENT CHUNK, because an arm body lowers into
`app.client.js` and an html-only oracle is structurally blind to BLOCKING-2.

### OPEN — NOT fixed, needs a ruling (do not improvise)

**MED-1 — the conditionally-rendered `<main>` fork.** Two shapes, one question:
  (a) a `<main>` living only in a NON-INITIAL match/engine arm;
  (b) `<main if=@cell>`, which the compiler parks in a `<template>`.
In both, the `<main>` is absent on initial paint and present after the condition flips. Current
behaviour treats it as PRESENT and demotes the outlet → ZERO rendered landmarks initially, ONE
after the flip. The alternative (ignore it) → ONE initially, TWO after the flip (invalid HTML).
**Neither satisfies "exactly one" at all times** — the invariant is not achievable for a
conditionally-rendered landmark without a third move. Options: (a) keep the conservative demote and
accept a transient zero-landmark; (b) ignore conditional mains and accept transient invalid HTML;
(c) DIAGNOSE it — extend the case-4 family to a conditional shell `<main>` coexisting with an
`<outlet>`, consistent with case 4's "two candidate landmarks, only the author can resolve it".
PA lean: **(c)**. Left unimplemented pending bryan's ruling; deliberately NOT pinned by a test,
since pinning either current behaviour would turn the eventual fix red.

**MED-3 — component-mounted `<main>` under-fires case 4.** `collectOutlets` (SYM) runs
pre-expansion; `treeHasAuthorMain` (emit) runs post-expansion. The EMIT is correct (it demotes),
only the DIAGNOSTIC is inconsistent: `<Shellmain/>` + `<outlet/>` compiles clean where the literal
`<main>…</main>` + `<outlet/>` fires. Output is valid (one landmark), so this is a diagnostic
consistency gap, not a correctness one. Reconciling the two phases is a larger change than this
round's scope; surfaced rather than half-fixed.

**KNOWN-OPEN (pre-existing, unchanged).** A case-2 shell (`<main><outlet/></main>`) composed with a
route that owns its own `<main>` still yields two nested `<main>`. Independently verified
PRE-EXISTING (base 2, tip 2) and this PR strictly improves it — base additionally DESTROYED the
outlet marker, tip preserves it. Awaits a separate ruling. Not pinned by a test, for the same
reason as MED-1.

### Gates
Pre-commit **21012 pass / 0 fail / 68 skip** (unchanged from `01aaad71`). R26 byte-identity vs base
`020485b2` re-verified after the fixes: `examples/23-trucking-dispatch` (25 docs) and `docs/website`
(98 docs), `diff` exit 0 — with both output trees confirmed non-empty BEFORE trusting the compare
(an earlier R26 run in this session printed a false "no diff" because `wc`/`head` had dropped off
PATH and the comparison ran against missing directories). All four ruling cases re-verified by
compile.
