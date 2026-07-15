# issue #28 — BS tag-close leading-equals — progress

Append-only log. Branch: fix/issue28-tagclose-leading-equals. Base: 7d5fda26.

## 2026-07-15 — session start
- Entered pre-made worktree, isolation gate verified (pwd/toplevel/branch/HEAD all correct, tree clean).
- `bun install` OK inside worktree.
- Reproduced bug: `<page auth="none"><div><span>= hi</span></div></page>` → E-DG-002 @div + 2× E-CTX-001. Confirmed live @ 7d5fda26.

## Investigation — actual fire sites (empirical, via splitBlocks block-tree dump)
Brief pointed at `peekTopLevelStateDeclSignal` line ~1595. Empirically that line is NOT the fire site for the matrix rows; it returns FALSE for them. The real fires:
- `scanAttributes` line ~1321 (`if (c === ">" && ch(1) === "=") { attrRaw += c; step(); continue; }`) — UNCONDITIONAL `>=` swallow. Fires for `<span>= hi>` / `<div>=...>` / `<td>=...>` when the element is a direct markup child (rows 1b, 3, 4, and the leaf of row 2). Swallows the opener `>` + leading `=` → opener never terminates.
- `classifyOpenerForCompoundScan` (state-decl detection ~line 2015) — a child `<span>= hi>` (opener `>` immediately followed by `=`) is misclassified as a Shape-1 state-decl child, which makes the PARENT (`<div>` / `<tr>`) look like a compound state-decl → the whole subtree is gobbled as a text block and lifted → `@div` reactive var → E-DG-002 + E-CTX cascade. Fires for rows 1, 2.
- `peekTopLevelStateDeclSignal` line ~1595 — over-broad skip; NOT a matrix fire site, but it DOES break the no-space top-level decl form `<count>=0` (skips `>=`, runs to EOF, returns false). That is a pre-existing, separate, out-of-scope issue (matrix row 8 uses the space form `<count> = 0`, which works).

## Baseline matrix (pre-fix)
row1  CTX001=2 ATTROP=0 Compiled=0 first=E-DG-002   (FAIL — classify)
row1b CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row2  CTX001=2 ATTROP=0 Compiled=0 first=E-DG-002   (FAIL — classify)
row3  CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row4  CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row5  CTX001=0 ATTROP=0 Compiled=1 (PASS — parenthesized)
row6  CTX001=0 ATTROP=0 Compiled=1 (PASS — quoted)
row7  CTX001=0 ATTROP=1 Compiled=0 (PASS — reject fires; NO E-CTX-001)
row8  CTX001=0 ATTROP=0 Compiled=1 (PASS — space decl)
row9  CTX001=0 ATTROP=0 Compiled=1 (PASS — paren-tracked >=)

## Fix plan
Discriminator = "is there a pending unquoted attribute value?" i.e. a depth-0 unquoted `=` seen earlier in this opener.
- scanAttributes: swallow `>=`-as-comparison only when `sawUnquotedEq` (prior depth-0 unquoted `=`); else `>` terminates. Strictly narrows (only changes openers where `>=` appears with NO prior `=` — exactly the leading-`=`-after-bare-tag bug). Preserves S188 reject for `if=@n >= 3`.
- classify: an opener whose `>` is IMMEDIATELY followed by `=` (no whitespace, no prior attr `=`) is NOT a state-decl child.
- peek line 1595: DECISION = leave untouched. Empirically it is NOT the fire site for issue #28. For any `<x>=...` (immediate `>=`) shape the S188 skip at 1595 makes the peek run past the leading `=` and return FALSE (a harmless false-negative), so the peek never mis-gobbles leading-`=` markup as a decl; scanAttributes + classify handle those cases. The ONLY input 1595 mis-handles is the no-space top-level decl `<count>=0` (returns markup instead of decl) — a SEPARATE, pre-existing, out-of-scope bug (matrix row 8 uses the space form `<count> = 0`, which works). Narrowing 1595 would require close-tag disambiguation in the peek too and would incidentally repair `<count>=0` — scope creep the brief forbids. Surfaced to PA instead.

## Fixes landed
- Commit 9b86bc4b — scanAttributes: `sawUnquotedEq` gate on the S188 `>=` reject (fixes direct-child leading-`=` rows 1b/3/4 + the `<td>` leaf of row 2).
- (this commit) classify: `openerHasMatchingCloseTag` close-tag discriminator on the state-decl `=` branch (fixes nested-compound rows 1/2; prevents `<div>`/`<tr>` false-compound gobble).

## Full matrix (post scanAttributes + classify) — ALL PASS
row1  CTX001=0 Compiled=1 | row1b CTX001=0 Compiled=1 | row2 CTX001=0 Compiled=1
row3  CTX001=0 Compiled=1 | row4  CTX001=0 Compiled=1 | row5 CTX001=0 Compiled=1
row6  CTX001=0 Compiled=1 | row7  CTX001=0 ATTROP=1 Compiled=0 (reject preserved, NO E-CTX-001)
row8  CTX001=0 Compiled=1 | row9  CTX001=0 Compiled=1
Block-tree text bodies verified: "= hi" / "=" / "=a=b=c" / "=SUM(A1:A9)" preserved.
Full suite green @ scanAttributes: 20198 pass / 0 fail / 20264 tests (157s).

## Broad-suite A/B (adversarial no-regression proof)
Ran `bun test compiler/tests/` (full tree incl browser/self-host/canaries) on BASE
(7d5fda26 block-splitter) vs HEAD (fix): BOTH 27669 pass / 29 fail / 27912 tests.
Fail SETS byte-identical (diff empty) — the 29 are pre-existing baseline (browser
bind:value, dual-pipeline hoist canary, each-ternary, emit-lift, within-node parity
budgets), NONE introduced by the fix. (Note: the earlier 167-fail post-commit count
was an un-populated samples/compilation-tests/dist ENV-GAP; fixed by `bun run pretest`.)

## Discriminator refinement (conformance case caught it)
The first conformance case (with `id="cell"` attributes) FAILED with E-CTX-001: the
`sawUnquotedEq` flag was too coarse — a QUOTED attribute `id="cell"` set it (its `=`
is a depth-0 assignment), so a leading-`=` body after quoted attrs got mis-swallowed.
The matrix rows had NO attributes so this was masked. Fix: renamed to `inUnquotedValue`
— set true at a depth-0 `=`, reset FALSE the moment a delimited value opens (`"`, `'`,
`(`, `{`, `[`, sigil-brace). A quoted/parenthesized/braced value is not a bare unquoted
comparison value. Added 2 unit tests + the conformance case covering the attr-bearing
shape (`<span id="cell">= hi</span>`, `<td class="c">=SUM(A1:A9)</td>`).

## Tests added
- compiler/tests/unit/block-splitter.test.js — describe("issue #28 …"): 9 tests
  (rows 1/1b/2/3/4 positive, 2 attr-bearing, row-7 negative-preserved, paren+quote).
  File: 150 -> 159 pass, 0 fail.
- conformance/cases/block-grammar/block-028-leading-equals-text-pos/ — (b)-runtime case
  (§4.18.1 free-text), domAnchored asserts rendered "= hi" / "=" / "=SUM(A1:A9)";
  notCodes E-CTX-001 + E-DG-002. Passes via the gated corpus bridge.
