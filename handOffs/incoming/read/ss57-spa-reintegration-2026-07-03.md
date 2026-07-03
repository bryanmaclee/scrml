# ss57 sPA re-integration → PA

**List:** `spa-lists/ss57-conformance-validators-55.md` (8 items — validity surface §55 + formFor §41.14 runtime half)
**Branch:** `spa/ss57` · **tip:** `c7a78cbb` · **base:** `origin/main` @ `1c7526f6` (3 commits ahead, 0 behind)
**Date:** 2026-07-03 · **Built:** sPA-DIRECT in worktree `../scrml-spa-ss57` (disjoint additive `conformance/cases/` data — no dispatch)

## Landed (8/8 — list COMPLETE)
| item | surface | cases | status | SHA |
|---|---|---|---|---|
| 1 | universal-core vocab breadth §55.1 | forms/vocab-{string,numeric,equality,set}-{invalid,valid} (8) | **landed** | `8584b64b` |
| 2 | touched / submitted §55.7 | forms/{touched-submitted-initial,touched-on-input,touched-on-check,submitted-on-submit} (4) | **landed** | `8584b64b` |
| 3 | `<errors of=>` §55.8 | forms/{errors-first-all-rollup,errors-empty-no-dom} (2) | **landed** | `8584b64b` |
| 4 | cross-field §55.11 | forms/crossfield-{mismatch,match,source-revalidates} (3) | **landed** | `ea587b6a` |
| 5 | message chain §55.10 (CODES; RT→E3) | forms/msgchain-{colon-reject,dynamic-reject,inline-static-accepted} (3) | **landed** | `ea587b6a` |
| 6 | multi-error / short-circuit §55.12 | forms/{multierror-compose-order,shortcircuit-req-empty} (2) | **landed** | `ea587b6a` |
| 7 | validators-on-derived reject §55.14 | forms/{derived-validators-reject,derived-refinement-type-accepted} (2) | **landed** | `ea587b6a` |
| 8 | formFor §41.14 runtime half (FLAGSHIP) | form-for/{formfor-validity-bug58-clean[CLOSED],formfor-typing-errors,formfor-valid-enables-submit,formfor-submit-collects-values} (4) | **landed** | `c7a78cbb` |

**Parked:** none. **Dropped:** none. **Net: +27 conformance cases (69→96), all green.**

## What landed
The §55 auto-synthesized validity surface moves SHALLOW→conformance-COMPLETE, and the
§41.14 `<formFor>` flagship gains its (b) runtime half (the marquee demo had no runtime
assertions). All pure-additive `conformance/cases/` data except item-8's ONE edit to
`form-for/formfor-validity-bug58-clean/expected.json` (removed `runtime-half-pending`,
added the initial-render (b) half). Every case captured from impl#1 via probe then
SPEC-sanity-checked against the §55.x subsection read in full.

Coverage now pinned: the 12 universal-core predicates × valid+invalid tags · isValid
rollup · touched/submitted timing+orthogonality · `<errors of=>` first/all/compound-rollup
counts + empty→no-DOM · cross-field reactive source-revalidation · multi-error
declaration-order + req short-circuit · derived-validator reject + refinement-type
alternative · formFor initial/typing/valid-enable(Bug-61)/submit-collects-values.

## Verification
- `bun conformance/run.ts` = **96/96 green** on impl#1 (independently re-runnable).
- Each of the 3 commits passed the **full pre-commit hook** (green landings; hooks gate on pass).
- Branch coherence at each landing: `git rev-list --left-right origin/main...HEAD` = `0 N`
  (HEAD = origin/main + N; 0 behind).
- Adversarial: every runtime case's expected.json was probe-captured from impl#1 (not guessed),
  then cross-checked against the SPEC text — capture-surprises were escalated, not enshrined (E1-E3).

## Escalations (impl#1-vs-SPEC divergences — PA/user ruling, NOT decided by sPA)
- **E1 — min/max NaN on string fields.** On a `type=text` field, `min(n)`/`max(n)` ALWAYS fire
  (NaN comparison) regardless of value, while `gt/lt/gte/lte` coerce correctly. Item-1 sidesteps
  via `type=number` (where min/max work); the string-field inconsistency is flagged. → bug, or
  should min/max on a string cell be a compile-time type error (E-TYPE-031 family)?
- **E2 — LengthFailed payload shape.** §55.9 declares `LengthFailed(predicate: string)`; impl#1
  snapshots `predicate:{op,value}`. Standing payload-encoding divergence, asserted-as-impl#1
  (parallel to the §19.9.1 wire precedent the README cites). `PatternMismatch.re` snapshots `{}`
  (regex has no JSON form — serialization artifact). → amend §55.9, or impl bug?
- **E3 — §55.10 message-resolution chain RT largely UNIMPLEMENTED.** Level-1 inline overrides and
  Level-2 `registerMessages` are accepted syntactically but IGNORED at render (`messageFor` always
  returns the Level-3 default); the Level-4 `<match on=@field.errors[0]>` escape hatch CRASHES at
  runtime. Only Level 3 renders. The "inline > registered > default" precedence cannot be
  conformance-pinned today — item 5 shipped the CODES half; RT half is impl-gated. Secondary:
  `E-VALIDATOR-INLINE-DYNAMIC` fires for a cell/identifier message arg but NOT a template-`${}`
  message, contra §55.10 Edge F. → is the message chain (L1/2/4) unshipped (freeze-bar gap) or bugs?
  **This is the biggest finding — a CLAIMED §55.10 pillar with essentially no runtime.**

## Notes for the PA (re-integration)
- Re-integrate via S67 file-delta: items 1-7 are pure-additive `conformance/cases/forms/*`
  (clean); item 8 adds 3 dirs under `conformance/cases/form-for/` + edits ONE existing
  `expected.json` (formfor-validity-bug58-clean) — the edit removes `runtime-half-pending` and
  adds the (b) half; take it wholesale.
- Worktree `../scrml-spa-ss57` left in place; `node_modules` are SYMLINKS into main (root +
  compiler) — do NOT copy them into a delta. Scratch `_probe.ts` + `_scratch/` are untracked and
  were never committed (verified via explicit-pathspec staging).
- `spa-lists/ss57-conformance-validators-55.md` item statuses + `spa-lists/ss57.progress.md`
  written in MAIN's working tree (uncommitted, matching the ss55.progress.md pattern) for you to fold in.
- Confirm `bun conformance/run.ts` = 96/96 independently before folding.
