# CSS Wave-1 conflict-checker IMPL — progress

Task: turn the §65.11 dry-run prototype into a REAL compile-pipeline pass emitting
`E-STYLE-CONFLICT` (hard) + `W-STYLE-CONFLICT-POSSIBLE` (soft), implementing R1/R2/R3.

## Architecture (settled after AST probes)
- New module `compiler/src/codegen/css-conflict-check.ts` — `checkCssConflicts(fileAST)`.
- Runs POST-CE over `ceResults` (Stage 3.3b in api.js), so `collectCssBlocks` tags
  `_componentScope` reliably (E-COMPONENT-021 fixed by de490c29 → css-scope-01 compiles).
- CSS side = LIVE infra `collectCssBlocks` (program + component-scoped blocks).
- Component blocks are DUPLICATED per instantiation (`.badge` x4) — dedupe by
  `span.file` + `span.start` (stable across instantiations; component blocks carry a
  `<file>#ComponentName` span.file suffix + component-relative line — best-effort loci
  for the 3 trivial component scopes; program-scope spans are real file:line).
- Element sets: program = whole post-CE markup (file's enumerable set, R3);
  component[name] = the donut-bounded subtree of the first `_expandedFrom==name` root
  (stop at nested `_expandedFrom`).
- Selector parser + element-match model ported from `css-conflict-dryrun.ts` (proven).

## Classification (R1/R2/R3 IMPLEMENTED — not just recommended)
- Program scope = SOFT only (escape hatch). Fire soft on a provable LOCAL overlap (R3);
  the 2941 unbounded firehose does NOT fire.
- Component scope = HARD-eligible.
- R1: either side universal `*` / bare-root `html`/`body` → LAYER → no fire.
- R2: class x class (both sides class-bearing, no id) → SOFT (Wave-1); HARD deferred to Wave-2.
- tag x class / tag x tag / id x * genuine overlap in component scope → HARD.
- Conditional (:hover/[attr]/@media/@container) = layer, no fire; same-axis (both same
  state pseudo, provable shared) → E-STYLE-CONFLICT (component, non-R2) / soft (program/R2).
- Functional (:not/:has/:is/:where), sibling (+/~), dynamic (<each>/cond), reactive
  class:NAME=@cond toggle → SOFT (fail-closed). Never hard.
- Flat-declaration `#{}` (style-value) + `<style>` raw bodies → not selector rules → skipped.

## Deliverables (all committed)
- `compiler/src/codegen/css-conflict-check.ts` — the checker (`checkCssConflicts`).
- `compiler/src/api.js` — Stage 3.4 wiring (post-CE, via `collectErrors`).
- `compiler/SPEC.md` — §34 rows (E-STYLE-CONFLICT + W-STYLE-CONFLICT-POSSIBLE, Rule 4);
  §65 banner + §65.2 impl-status note flipped for the Wave-1 checker (rest stays Nominal).
- `compiler/tests/unit/css-conflict-check.test.js` — 16 tests (pass).
- `compiler/tests/conformance/conf-STYLE-CONFLICT.test.js` — 11 tests (pass).

## Post-impl verification
- Dry-run analyzer (unchanged, report-only) over the 83-file corpus: HARD=0,
  WHATIF=20 (13 universal → R1, 7 BEM → R2), firehose=2941 → R3.
- REAL shipping pass over the same 83 files: **HARD = 0** (0 false positives with
  R1+R2), SOFT = 35 across 14 files (down from the 2941 firehose). Each soft is a
  legitimate fail-closed nudge (BEM base+modifier, reactive `class:` toggles,
  unprovable mutually-exclusive state classes) — non-blocking, names both loci.
- CLI compile of machine-002 surfaces the soft as `info [W-STYLE-CONFLICT-POSSIBLE]`
  with real `file:line` (line 91) + both loci, compile exit 0.

## Known limitation (deferred)
- COMPONENT-scope hard/soft diagnostics report a component-RELATIVE line (CE copies
  `#{}` blocks with a `<file>#Component` span). filePath is cleaned to the real file;
  the message is self-locating (names component + selectors + property). Precise
  component-internal line-mapping is a Wave-2 follow-on (0 component hard fires today).

## S239 adversarial FIX ROUND (7 correctness + 2 hot-path)
- F1 parseSelector: preserve whitespace-surrounded `>`/`~`/`+` (state-machine rewrite). Spaced
  `.a > .b` no longer collapses to descendant → kills the false-hard; spaced `~`/`+` keep the
  sibling carve-out.
- F2 element collector: ONE shared comprehensive walker (`walkMarkupElements`) over all
  control-flow container keys + `lift-expr` — a component reached via `<if>`/`<match>` structural
  expansion now gets its donut-bounded element-set (verified `<if>`-nested HARD-fires; was empty).
  UPSTREAM GAP surfaced: a component used ONLY inside `<each>`/`${for}`/iteration is NOT expanded
  by CE into the pre-codegen AST and its scoped `#{}` CSS is NOT emitted at all (verified: no
  `@scope Btn`/`.btn` in output) — a pre-existing CE/emit-each defect, out of the checker's reach.
- F3 parseCompound: `return null` on unknown char (was truthy empty compound) → routes unparseable
  to fail-closed soft (component) / no-fire (program); never a floor `*` nor a truncated broad match.
- F4 R1: XOR — floor-vs-SPECIFIC layers (no fire); floor-vs-floor (`*`×`*`, `body`×`body`) is a
  genuine within-level conflict and fires.
- F5 resilience: per-scope + per-pair try/catch in checkCssConflicts; a skipped scope surfaces a
  fail-closed W- instead of dropping the whole file.
- F6 api.js: E-STYLE-CONFLICT excluded from the validateEmit `hasPriorFatalError` gate (still fatal
  in the final partition, but no longer masks a co-occurring E-CODEGEN-INVALID-LOGIC).
- F7 confirmed: full gate stays 0-fail — no existing fixture hard-fails.
- F8 hot-path: element-set lookups hoisted above the per-property loop (once per pair).
- Bonus: sibling/functional fail-closed soft bounded to subject-plausible overlaps (killed the
  67→6 todomvc firehose the F1 combinator fix exposed).
- Post-fix corpus: 0 HARD, 43 SOFT/15 files (reactive-toggle 11, dynamic 10, R3-local 9,
  same-axis 7, sibling 6). Checker still ~1.5ms on the 381-rule stylesheet.
- New tests: css-conflict-check.test.js 25 (16+9), conf-STYLE-CONFLICT.test.js 15 (11+4).

## Status: COMPLETE (S239 fix round applied)
