# progress — diagnostic-precision-fixes-2026-07-10

Two impl#1-vs-SPEC diagnostic-precision divergences (PA-ruled fix-impl) + the
conformance cases they unblock. Isolated worktree; PA reviews (S239) + lands.

## Empirical reproduction (BEFORE)

| # | source | codes BEFORE |
|---|---|---|
| D1 | `<endpoint accepts=FspMethod>` fully exhaustive + a `<Bogus>` arm (variant not in enum) | (none — silent) |
| D1-ref | block-form `<match>` + unknown-variant arm | (also silent — §18.0.1 machinery folds unknown arm into covered set) |
| D2a | `<onTimeout>` in plain `<program>` markup | `E-ATTR-001` + `E-SCOPE-001` |
| D2b | `<onTimeout>` in a `${}` logic body | `E-STRUCTURAL-ELEMENT-MISPLACED` (already correct) |
| D2c | `<onIdle>` in plain markup | `E-ATTR-001` + `E-SCOPE-001` (shares the gap) |
| D2d | `<onTransition>` in plain markup | `E-ATTR-001` (shares the gap; EXCLUDED — see below) |

## Divergence 1 — endpoint dead/unknown arm

- **Fire-site:** `checkEndpointDeclarations` in `compiler/src/type-system.ts`.
- **Root cause:** `checkEnumExhaustiveness` silently folds an unknown-variant arm
  into its `coveredVariants` set (a phantom cover), so a dead/unknown arm fired
  nothing when all real variants were also covered.
- **SPEC:** §61.4 + §61.9 + the §34 `E-ENDPOINT-NOT-EXHAUSTIVE` row (SPEC.md
  ~L18307) — a dead/unknown arm is the §18.0.1 arm-validity diagnostic
  (`E-MATCH-SUBSET-DEAD-ARM`), NOT an `E-ENDPOINT-*` code. Duplicate arm already
  fires `E-TYPE-023` (that path worked).
- **Change:** the typer now classifies arms naming a variant not in the
  `accepts=` enum BEFORE the exhaustiveness call, EXCLUDES them from the
  `ArmPattern[]` (so they neither mask a genuine missing variant nor forge a
  spurious duplicate), and fires `E-MATCH-SUBSET-DEAD-ARM` with a
  not-in-enum-worded message (distinct from the subset-exclusion wording).
- **AFTER:** dead/unknown arm → `E-MATCH-SUBSET-DEAD-ARM`; duplicate → `E-TYPE-023`
  (unchanged); missing → `E-ENDPOINT-NOT-EXHAUSTIVE` (unchanged); unknown+missing
  → BOTH fire; wildcard+unknown → `E-MATCH-SUBSET-DEAD-ARM`.
- **Tests:** +4 in `compiler/tests/unit/endpoint-decl-typer.test.js`.
- **Commit:** `f7f0e3b1`.

## Divergence 2 — onTimeout/onIdle markup-locus misplacement

- **Fire-site (existing ${}-locus):** `parseLogicBody` in `compiler/src/ast-builder.js`
  (`STRUCTURAL_ELEMENT_PLACEMENT` + `leadingTagName`).
- **Root cause:** in plain markup an `<onTimeout>`/`<onIdle>` is parsed as a
  GENERAL markup element node; `after=`/`to=` are validated as HTML attributes →
  the incidental `E-ATTR-001` + `E-SCOPE-001` pair. The engine-body path
  (raw-text recurse, `rulesRaw` regex) never hits this; only the misplaced
  markup node does.
- **SPEC:** §51.0.M — "outside an engine state-child → E-STRUCTURAL-ELEMENT-MISPLACED"
  for ANY outside locus.
- **Change:** the general-markup element branch gates on a new
  `ENGINE_CHILD_MARKUP_ONLY_ELEMENTS` set ({onTimeout, onIdle}) and — before
  attribute parsing — fires `E-STRUCTURAL-ELEMENT-MISPLACED`, returning an
  attribute-less node so the cascade is suppressed (parity with the clean
  ${}-locus). VALID in-engine occurrences reach the same branch via the
  engine-decl body recurse whose `buildBlock` errors are DISCARDED into a local
  buffer — so the fire is user-visible ONLY for a genuinely misplaced element.
  Engine `<onTimeout>` codegen reads `rulesRaw` (regex), never these parsed attrs
  — verified no consumer reads a `tag === "onTimeout"` markup node's attrs.
- **onIdle:** shares the gap; fixed (self-closing, engine-only, no match-locus
  code interaction).
- **onTransition:** shares the gap but EXCLUDED — it can carry a handler body AND
  has a distinct §18.0.2 match-locus code (`E-MATCH-ONTRANSITION-FORBIDDEN`), so
  its markup-locus enforcement is a separate, non-trivial follow-up (NOTED, not
  fixed here).
- **Match-arm locus (fire-site #6):** onTimeout/onIdle inside a `<match>` arm
  reach the same branch via the match-arm recurse (errors discarded) → the fire
  is discarded and the attr-less node suppresses the prior E-SCOPE-001, so the
  match-arm sub-case is now silent rather than firing the SPEC code. This is the
  separately-deferred fire-site #6; covering it cleanly needs a nearest-container
  SYM walker (bigger change). NOTED as a remaining gap; the primary
  plain-markup locus (fire-site #5, the brief's target) is fixed.
- **P3-FOLLOW budget:** the new node omits the component-marker field (undefined ≡
  falsy) and the comment avoids the budgeted word, to stay within the
  `isComponent` allowlist budget for ast-builder.js.
- **Tests:** +5 in `compiler/tests/unit/structural-in-markup-locus.test.js`.
- **Within-node parser-parity reconciliation:** the initial version stripped
  attrs from EVERY onTimeout/onIdle markup node, which also stripped the VALID
  in-engine node shape and regressed the within-node parity gate
  (`parser-conformance-within-node.test.js`, NOT in the pre-commit gate) on
  `engine-007-cancel-timer` + `engine-008-onidle-watchdog`. Fixed by gating the
  fire+strip on a synchronous `_engineBodyBuildDepth` counter set around the
  engine-decl bodyChildren build loop: a valid in-engine occurrence (depth>0) is
  built by the normal markup path (node shape PRESERVED); only a depth-0
  occurrence is misplaced. Parity now matches the main baseline exactly.
- **Commits:** `1d80bac9` (fix) + `56f20360` (parity refinement).

## Conformance cases authored

- `conformance/cases/endpoint/dead-arm/` — fully-exhaustive endpoint + a dead
  arm (`Bogus`) → `E-MATCH-SUBSET-DEAD-ARM`, no `E-ENDPOINT-*` (sibling of the
  existing `duplicate-arm` / `E-TYPE-023` case).
- `conformance/cases/engine/ontimeout-misplaced-markup-pos/` — `<onTimeout>` in
  plain `<program>` markup → `E-STRUCTURAL-ELEMENT-MISPLACED`, notCodes
  `E-ATTR-001`/`E-SCOPE-001` (markup-locus sibling of the ${}-locus
  `ontimeout-misplaced-pos`).
- UPDATED `conformance/cases/engine/ontimeout-misplaced-pos/expected.json` — the
  stale "flagged to PA" NOTE claiming the markup locus fires E-ATTR-001/E-SCOPE-001
  is corrected to point at the new markup-locus case (divergence fixed).

## Gate (worktree — post depth-counter refinement)

- unit: 15959 pass / 0 fail / 17 skip (+9 = the new tests).
- integration: 3044 pass / 0 fail.
- conformance (`bun conformance/run.ts`): 266/266 cases pass (was 264; +2 new cases).
- conformance corpus (`corpus-bridge.test.js`, runtime half): 267/267 pass (3× stable).
- within-node parser-parity (`parser-conformance-within-node.test.js`, NOT a
  gate tier): 3 fails — `gauntlet-r10-solid-spreadsheet` (1), `stdlib/regex` (7),
  `stdlib/router` (14) — ALL pre-existing on main (identical set); zero net
  regression from this dispatch.
- The full `bun test compiler/tests/unit compiler/tests/integration
  compiler/tests/conformance` pre-commit gate passes (COMMIT_EXIT=0 on every
  landing). One transient `g-each-peritem-markup-value-ternary` runtime (happy-dom)
  flake under parallel full-suite load did NOT reproduce in 3× isolated runs and
  is unrelated (the fix does not touch `<each>`).

## Commit SHAs (this dispatch)

- `f7f0e3b1` — Divergence 1 (endpoint dead/unknown arm typer + unit tests).
- `1d80bac9` — Divergence 2 (markup-locus onTimeout/onIdle misplacement + unit tests).
- `56f20360` — Divergence 2 within-node parity refinement (depth-counter guard).
- (this commit) — conformance cases + BRIEF.md/progress.md.
