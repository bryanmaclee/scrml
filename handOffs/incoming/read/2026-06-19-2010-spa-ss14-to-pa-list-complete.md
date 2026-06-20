---
needs: action
from: sPA ss14 (flograph-residuals-orphans)
to: PA
date: 2026-06-19 (S209)
---

# sPA ss14 — list COMPLETE (all 6 dispositioned), ready for re-integration

## ACTION: re-integrate `spa/ss14` → main

- **Branch:** `spa/ss14` · **tip SHA:** `02fa09db` · **6 commits ahead** of `origin/main`.
- **Base:** `c734ec35`. `origin/main` advanced to `256c81b6` (+3: SPEC despace Part B + 2 deputy ticks)
  during the run — **NO file overlap** with my changes (they touch SPEC.md / deputy-state / a progress doc;
  I touch block-analysis / 2 tests / flograph / spa-lists). Clean merge expected; S147 coherence-gated.
- Every code commit passed the pre-commit full suite. Full per-item detail: `spa-lists/ss14.progress.md` (on branch).

## Landed on branch (3 — code)

| item | SHA | what |
|------|-----|------|
| 2 `g-each-body-sigil-invariant-classifier` | `34ca4f9a` | `expr-node-corpus-invariant.test.js`: `@.` (§17.7.3) body exprs false-counted as `parse-error` escape hatches (acorn @-plugin only consumes `@`+ident-start). Added `each-sigil` category, EXCLUDED from the >50% gate, kept visible. parse-error 2→0, each-sigil=2, 69 pass. |
| 3 `dock-malformed-sweep-residual` (dock side) | `21235f06` | Marked the `flograph.ts:391` import-guard self-cite `#dock[ … · verified ]` after confirming the DD (`agentic-code-provenance-dock`, status:current). `dock --check` → PASS, 0 unverified. |
| 4 `g-block-analysis-phantom-block` (D6) | `b040281f` | `block-analysis.ts`: channel-import inlines the channel's fns into the page AST (carrying the channel's `span.file`); `collectFunctionDecls` counted them as page blocks → phantom + block-lease two-holders. Now skips function-decls whose `span.file` ≠ ownerFile. messages.scrml 12→11 blocks; `dock --units` phantom gone; +real-pipeline regression test. |

## Parked (3 — all surfaced + continued; none halted the run)

| item | SHA | reason |
|------|-----|--------|
| 1 `flogence-superseded-doc-deref-residual` | `a778bdba` | Evidence ⇒ **MARK-not-move** (already satisfied): the 4 partially-superseded docs are referenced by 9/5/5/1 live docs (20 sites), archive is opt-in, currency-sweep=0, and `partially-superseded` is a deliberately distinct status from the 48 fully-`superseded` archived docs. NEEDS a 1-line §2.1 PA ruling. |
| 5 `bug-14` (MCP V0.D) | `b48b8a7b` | Gate VERIFIED real (R4): §58 Build Story is SPEC'd but NOT implemented (0 impl symbols in `compiler/src`; item 3 hard-gated). Items 1+2 are runtime/dev-server codegen builds beyond ss14 bounds. Deferred feature arc; workaround documented. |
| 6 `bug-18` (GITI-015) | `02fa09db` | De-stubbed: repro located in the giti inbox; R26 REPRODUCED on HEAD (`arr[i+1] is some ? a : b` ternary+computed-LHS not lowered — now caught loud by `E-CODEGEN-INVALID-JS`, was silent at `cbfefef`). Fix = is-op ternary lowering = **ss3 codegen-expr-attr** surface, out of ss14 bounds. |

## New residuals to file (PA-owned)

1. **§2.1 deref policy** (item 1): add "deref-to-archive applies to FULLY `superseded` only; `partially-superseded` stays live."
2. **flograph provenance hygiene** (item 3, parked): 40 unverified `decided-by`/`cites` edges live ONLY in the opt-in `--with-support` design corpus (default-corpus sweep already 0) — curator/PA verification, not mechanical. Stale UNTRACKED `docs/graph/graph.json`+`.mmd` (2 `--check` ERROR, not gated anywhere) = TRACK-and-drift-gate vs gitignore tracking-policy call.
3. **NEW ast-builder bug** (item 4, separate from D6): every LOCAL function block's byte `end`/`endLine` OVERSHOOTS into the next function (e.g. getCurrentUser `}` at line 38 but end=line 40, inside `function fetchMessages`); all 11 adjacent pairs share a boundary line. The hand-off-212 "other 11 blocks correct" claim is WRONG. Root is function-decl span computation in the parser/ast-builder (upstream of block-analysis) — a second, smaller two-holders source currently masked by `.find`-returns-first in dock.
4. **bug-14** (item 5): revisit at §58 implementation land; consider re-bucketing to a design/feature track.
5. **GITI-015** (item 6): route the fix to ss3; update the bug-18 stub currency (silent→`E-CODEGEN-INVALID-JS`; repro at `handOffs/incoming/read/2026-05-23-0703-giti-015-is-some-ternary-with-computed-lhs.scrml`). The giti inbox message is still `needs:action`/`unread`; giti's S10-slice-9 drops the author workaround "once GITI-015 ships."

## Notes
- Worktree `../scrml-spa-ss14` left in place (sibling, outside `.claude/worktrees/`) for PA re-integration.
- No main HEAD advance, no push (per the sPA contract). PA owns merge + known-gaps reconciliation + wrap.
