# progress — outlet-collector-total-walk

## 2026-07-21 — start
Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aafd9eb16fa948949
Base: 5823b495. `bun install` OK. `bun run pretest` OK (13 samples compiled).
Maps read: `primary.map.md` -> routed to `domain.map.md` (four-case table + the three-stage
ownership split at line 51-53) + `error.map.md`. Load-bearing fact confirmed from the map:
`<outlet>` and `<main>` are NOT dedicated AST nodes — plain `kind:"markup"` with `tag:"outlet"`.
Next: read `collectOutlets` (symbol-table.ts) + `treeHasAuthorMain` (emit-html.ts) and reproduce
the four probe shapes empirically before editing.

## 2026-07-21 — BASELINE PROBE (pre-fix, unmodified source)
Compiled 7 probes through `compileScrml`; `mains` = rendered `<main>` count with
`<template>`/`<script>`/`<style>`/comments stripped (the S276-corrected oracle).

| probe | codes | rendered mains |
|---|---|---|
| 01 control: sibling `<main>` + outlet | `E-OUTLET-AND-MAIN` | 1 |
| 02 `<main>` in match block-form arm + outlet | **[] SILENT** | **0** |
| 03 `<main>` in engine state-child + outlet | **[] SILENT** | 1 (state A only) |
| 04 2nd `<outlet>` in match arm | **[] SILENT** | 1 |
| 05 2nd `<outlet>` in engine state-child | **[] SILENT** | **2** |
| 06 2nd `<outlet>` in `<each>` body | **[] SILENT** | 1 |
| 07 control: 2 sibling outlets | `E-OUTLET-DUPLICATE` | 2 |

BRIEF premise CONFIRMED, and two findings BEYOND it:
- probe 06 — `<each>` bodies are ALSO missed. The each-block AST node carries its walkable
  mirror on `bodyChildren`/`templateChildren` (ast-builder.js:15911), a third edge name the
  allow-list never listed. Reinforces the brief's "don't just append two edge names".
- probe 05 — emits **TWO** rendered `<main data-scrml-outlet>` landmarks in one document
  (both outlets take the landmark; neither sees the other). Invalid HTML directly, not just
  on transition; worse than the brief's "silent" characterisation.
- probe 03 renders 1 landmark in initial state `.A` and 0 after any transition to `.B` —
  the zero-landmark class is state-dependent for engines, unconditional for match (probe 02).

## 2026-07-21 — FIX LANDED (9b45c2e2)
`collectOutlets` is now a total walk over every object-valued property (`span` excluded),
mirroring `treeHasAuthorMain`. Cycle guard moved ABOVE the array branch (a total walk reaches
backrefs, so arrays need the guard objects have). Scope bookkeeping untouched.
Post-fix probes: all 6 previously-silent shapes fire; both controls unchanged.
Full pre-commit gate: **21021 pass / 0 fail / 68 skip** across 1135 files — zero regressions.

## 2026-07-21 — BLAST RADIUS (pre-fix vs post-fix, same probes)
`slot=` is the tell for what EMIT's `treeHasAuthorMain` already believed: a `<div>` slot means
emit had ALREADY seen that `<main>` and demoted the landmark.

| shape | pre-fix | post-fix | slot | rendered mains |
|---|---|---|---|---|
| control: sibling `<main>` | `E-OUTLET-AND-MAIN` | unchanged | div | 1 |
| `renders <main>` on enum variant (SPEC 19.2) | [] | **[] unchanged** | main | 1 |
| `fallback={<main/>}` on `<errorBoundary>` (19.6) | [] | **[] unchanged** | main | 1 |
| markup-typed derived cell (6.6.17), unrendered | [] | **`E-OUTLET-AND-MAIN` NEW** | div | **0** |
| markup-typed derived cell, rendered | [] | **`E-OUTLET-AND-MAIN` NEW** | div | **0** |
| `<main slot="body">` snippet call site (16.6) | `E-OUTLET-AND-MAIN` | unchanged | div | 2 |
| lambda-valued attr, no `<main>` | [] | [] | main | 1 |
| negative control, no `<main>` | [] | [] | main | 1 |

**Exactly ONE shape newly fires: the markup-typed derived cell.** It is NOT a false positive —
pre-fix that shape emitted `slot=<div>` with **ZERO** rendered landmarks, i.e. emit had already
demoted the slot on account of the cell's `<main>`. It is the same silent zero-landmark class
this dispatch exists to close, reached by a different edge.

`renders` and `fallback=` do NOT newly fire, and the reason is structural, not luck. AST probe
(`buildAST` at SYM time) shows both are stored as RAW STRINGS, never parsed markup nodes:
- `renders` clause -> `nodes[0].body[0].raw`
- `fallback={...}` -> `nodes[1].children[3].attrs[0].value.raw` (+ `.exprNode.raw`)
No object-property walk — mine OR `treeHasAuthorMain`'s — can reach a string. Both walkers agree,
so there is no divergence to fix. Same structural class as the component-expansion case.

DEFERRED (pre-existing, NOT caused by this change, both walkers blind — surfaced not fixed):
those two `<main>`s DO reach the client chunk (`app.client.js` carries both `err-renders` and
`err-fallback`), so at error-render time a fallback `<main>` can mount alongside a
`<main data-scrml-outlet>` slot => two landmarks. Out of scope here; needs a ruling on whether
raw-text markup positions should be parsed for landmark purposes at all.

## 2026-07-21 — TESTS (8f21df7f)
`compiler/tests/integration/navigate-wave1c-outlet-composition.test.js` 25 -> 39 tests.
NEW §10 (6 tests: the 5 firing shapes + the component regression guard) and
NEW §11 (8 rows: the invariant asserted on emitted HTML for every legal shape).
Oracle re-verified before reuse — `mainCount` already strips template/script/style/comments.
ADVERSARIAL CHECK: reverted `symbol-table.ts` to base and re-ran — exactly the 5 firing tests
FAIL pre-fix, pass post-fix; the guard + invariant rows hold both ways (correct for guards).

## 2026-07-21 — SPEC (275c26db)
SPEC 20.8.1.1 +1 normative bullet: a component-expanded `<main>` is content-owned (case-3
family), no diagnostic; SYM blindness recorded as BY DESIGN. Verified the mechanism rather than
asserting it — `buildAST` stores a component definition body as a RAW STRING at
`nodes[0].children[0].body[0].raw`, so no walk can reach it; and the shape empirically emits a
`<div>` slot with exactly one rendered `<main class="cmp">`. No §34 row, no new code.

## 2026-07-21 — EMPIRICAL VERIFICATION
1. FULL SUITE (`bun run test`, incl. browser + native-parser): **28519 pass / 36 fail /
   214 skip / 1 todo** across 1242 files. The 36 failures are **PRE-EXISTING**: captured the
   sorted failure list at base AND at HEAD and diffed — **IDENTICAL SETS, zero delta**. They sit
   in native-parser within-node parity budgets (M6.5.b.0), the dual-pipeline canary, `migrate
   --fix` composition and 3 browser tests — none outlet/landmark related. primary.map.md already
   flags native-parser parity as UNCONFIRMED for this window.
   Pre-commit gate (unit+integration+conformance, browser excluded): **21035 pass / 0 fail /
   68 skip**, up from 21021 at base (+14 new tests), zero regressions.
2. CORPUS RECOMPILE — `docs/website` (**98** .scrml, non-empty ASSERTED, 121 diagnostics) and
   `examples/23-trucking-dispatch` (**36** .scrml, non-empty ASSERTED). `wc`/`find` confirmed on
   PATH before trusting anything. Compiled at base and at HEAD, diagnostics sorted + tallied:
   **DIFF: NONE** (179 identical lines each side, `diff` exit 0).
3. SYMPTOM CHECK — **no new `E-OUTLET-*` on either corpus**. The only outlet-family diagnostic
   present is the pre-existing info-lint `W-OUTLET-ABSENT-SOFT-NAV-DISABLED` (×1 per corpus),
   byte-identical pre and post.

DONE-PROBE: target test file 39/39 pass; `<main>` in a match arm AND in an engine state-child
both fire `E-OUTLET-AND-MAIN`. SATISFIED.

# ===========================================================================
# FIX ROUND (S239 adversarial pass — 4 defects, all PA-reproduced)
# ===========================================================================

## 2026-07-21 — all four reproduced FIRST, before any edit
FIX 1 and FIX 2 reproduced exactly as briefed. Two refinements the brief did not have:
- FIX 2 is NOT uniform across the new edges. The ENGINE state-child case already reported
  correctly (L7:C12); only match arms and `<each>` bodies collapsed to L1:C1.
- FIX 2 is NOT an outlet-pass defect at all. Sub-parsed subtrees carry spans measured from the
  sub-parse origin, never rebased to file coordinates. Proven with an UNRELATED pre-existing
  diagnostic: `E-STATE-UNDECLARED` reports L1:C6 inside a match arm and inside an `<each>` body
  but L3:C6 at top level. My change newly EXPOSES a general ast-builder gap; it did not cause it.

## 2026-07-21 — FIX 1: the brief's literal instruction would have REGRESSED the compiler
Investigated before implementing. `ast-builder` classifies component-vs-element by
CAPITALIZATION ALONE, so `<MAIN>` (uppercase HTML) and a user's `<Main/>` (a real component)
leave the parser flagged identically. A bare `toLowerCase() === "main"`, which is what the brief
specified, therefore swallows a legal working program:

    const Main = <div class="cmp">c</>   <outlet/>   <Main/>

EMPIRICALLY CONFIRMED, not argued: I installed the naive predicate temporarily and both new
component-guard tests went RED — it fires `E-OUTLET-AND-MAIN` on that program and, emit-side,
demotes the slot so the document renders ZERO landmarks.

Correct discriminator is NAME RESOLUTION, not spelling: `isUserComponentMarkup` reads NR's
`resolvedKind`, is cross-file aware, and NR runs at api.js:1585 — BEFORE SYM at :1626. Landed as
NEW `compiler/src/landmark-tag.ts`, imported by BOTH walkers, so the predicate exists once.
Results: `<MAIN>` fires; `<Main/>` stays silent with one landmark; `<Main>` containing a `<main>`
demotes the slot per SPEC 20.8.1.1 case 3. `<Widget/>` still fires E-COMPONENT-035, unchanged.

Also caught by a real architectural guard: `p3-follow-no-isComponent-routing` rejected the new
file for the literal token in a PROSE comment. Reworded the comment rather than adding the file
to the allowlist — the file does no routing read, so an allowlist entry would have been a false
concession.

## 2026-07-21 — FIX 2 implementation
Threaded a span anchor through the collector; detection is STRUCTURAL (a span starting before its
own ancestor cannot be a real file position for a descendant), not a pattern-match on L1:C1.
  match arm  L1:C1 -> L7 (the `<match>` opener; the `<main>` is at L12 — best available)
  each body  L1:C1 -> L4 (exact)
  engine state-child L7:C12 and bare sibling L3 — already correct, unchanged.
A FALLBACK WAS REQUIRED: the node's own span is present but sub-parse-relative, so it is
unusable; the durable fix is span rebasing in ast-builder, which is out of scope here.

## 2026-07-21 — FIX 3 + FIX 4
FIX 3: replaced the false claims with a SCOPE OF THE GUARANTEE block naming both real limits —
`<each>`-in-match-arm (absent from the AST; both walkers agree on a wrong answer) and raw-string
positions. FIX 4: `diagsOf()` helper; every new diagnostic test pins COUNT and LINE.
Out-of-scope gaps recorded as `test.skip` with rationale, never as green assertions.

## 2026-07-21 — FIX-ROUND VERIFICATION
1. Pre-commit gate: **21038 pass / 0 fail / 70 skip** (was 21035/0/68).
2. Full suite: **28522 pass / 36 fail / 216 skip / 1 todo**. Failure SET diffed against the
   base-commit set captured last round: **IDENTICAL, zero delta** — all 36 pre-existing.
3. **R26 RE-RUN** (not reused — FIX 1 touches the emit predicate). Emitted-ARTIFACT sha256
   manifest, base `5823b495` vs tip: `docs/website` 98 sources -> **295** emitted files,
   trucking 36 -> **115**; 410 hashes each side; both source trees AND both output trees
   asserted non-empty before comparing. **DIFF: NONE** (`diff` exit 0).
4. Revert-check: with the source reverted, exactly the 6 new diagnostic tests go RED.
5. Naive-predicate check: with the brief's literal FIX 1, the 2 component-guard tests go RED.
