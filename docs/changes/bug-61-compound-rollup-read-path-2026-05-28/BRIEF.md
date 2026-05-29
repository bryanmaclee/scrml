# DISPATCH BRIEF v2 — Bug 61: `@compound.<synthProp>` rollup read must collapse to the dotted synth-cell key

**Change-id:** `bug-61-compound-rollup-read-path-2026-05-28`
**Severity:** HIGH (silent-wrong; `@form.isValid` → `undefined` → submit button stuck disabled). General — all §55 compounds.
**Dispatched:** S140 (2026-05-29). RE-DISPATCH after a prior agent crashed on API 500 mid-flight + a PA-direct attempt was reverted. **This v2 brief encodes everything learned — read it fully; do NOT re-discover the dead ends below.**
**Agent:** scrml-js-codegen-engineer · isolation: worktree
**Authority:** `docs/known-gaps.md` Bug 61 (PA-verified) · `docs/audits/bug-51-class-corpus-coverage-audit-2026-05-28.md` §3.2. READ-PATH sibling of Bug 58 (RESOLVED `29c33a6c`).

## PRIOR-ATTEMPT REUSE
A crashed agent's branch `worktree-agent-a0744d0c0c75de88b` (commit `5ec3319e`) has a REUSABLE scaffold: `emit-expr.ts` `emitMember` synth-prop branch + a pure-AST-walk `synthDottedKey()` helper (walks `@<compound>[.field].<synthProp>` to the dotted string). That scaffold is CORRECT for building the dotted key. Its only defect is the GUARD (it routes on leaf-NAME alone → over-fires). You may re-author the same scaffold from this brief (it is ~30 lines) — building from current `main` is cleaner than merging the crashed branch.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

1. `pwd`. MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP (S90). Save as `WORKTREE_ROOT`.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **`git -C "$WORKTREE_ROOT" merge --no-edit main`** (S112). After merge, confirm `grep -c 'rewriteExprArrowBody' compiler/src/codegen/emit-lift.js` ≥ 1 AND `grep -c 'case "each-block"' compiler/src/codegen/emit-client.ts` == 1 AND `grep -c '_flatBindKey' compiler/src/codegen/emit-bindings.ts` ≥ 1 (Bugs 57/58/59 markers — you build on top of all three). If any absent, STOP.
4. `git -C "$WORKTREE_ROOT" status --short` clean.
5. `cd "$WORKTREE_ROOT"` ONCE. **NEVER `cd` into the main repo** (path without `.claude/worktrees/agent-`) (S126). Use `--cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"` / worktree-absolute paths.
6. `bun install`. 7. `bun run pretest`.

**Edit via Bash** (`perl`/`python`/heredoc) on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/`; or Edit/Write with a path containing that segment. Echo path before each write; re-verify after.

## CRASH RESILIENCE (a prior agent crashed mid-flight on a server 500)
Commit in this ORDER so a late crash leaves a recoverable, verified fix: (1) collector + interface + threading + guard + conf emit-regression test → COMMIT + run conf test + full pre-commit suite FIRST. (2) THEN the happy-dom test → commit. (3) THEN R26 + final report. Do not leave the fix uncommitted while writing the happy-dom test.

---

## THE BUG (PA-verified, baseline has 57/58/59)

`@form.isValid` (2-seg `@<compound>.<synthProp>`, synthProp ∈ isValid/errors/touched/submitted) emits `_scrml_reactive_get("form").isValid` — member access on the compound VALUE object `{name,email,...}` which has no `isValid` → `undefined`. Must emit `_scrml_reactive_get("form.isValid")` (the dotted synth cell, which IS declared by emit-synth-surface.ts). Net: `disabled=!@form.isValid` → `!undefined` → `true` → submit button stuck disabled. `node --check` clean; silent.

`_scrml_reactive_get(dotted)` is the UNIVERSAL accessor (auto-delegates to derived_get for derived cells; reads state for reactive cells) — correct for ALL synth props. Storage: compound `{isValid,errors,touched}` + per-field `{isValid,errors}` are DERIVED; compound `submitted` + per-field `touched` are REACTIVE.

## THE OVER-FIRE (why the naive guard is WRONG — this is the whole point of v2)

The naive guard `SYNTH_PROPERTY_NAMES.has(leaf) && @-root` OVER-FIRES on a PLAIN cell whose value has a field named like a synth prop. PA-verified: `<config> = { errors: ["x"], submitted: false, isValid: true }` then `@config.errors` → the naive guard emits `_scrml_reactive_get("config.errors")` (a dotted key that is NOT a registered cell → `undefined` at runtime). REGRESSION. `errors`/`submitted` are common plain-field names.

**The guard MUST check that the dotted key is a REGISTERED synth cell — not merely that the leaf name matches.**

## TWO DEAD ENDS — do NOT pursue (PA empirically disproved both)

1. **`getResolvedStateCell` / B3 `_resolvedStateCell` on the root ident — DEAD.** Codegen RE-PARSES attribute/interpolation exprs from raw strings (`emitExprField` takes a raw string), so the codegen-time AST nodes do NOT carry B3's SYM-pass annotations. `getResolvedStateCell(rootIdent)` returns undefined here → any guard keyed on it over-rejects and breaks routing entirely.
2. **`ctx.derivedNames` membership — DEAD (insufficient).** `collectDerivedVarNames` (reactive-deps.ts:254) collects TOP-LEVEL derived cell names only; it does NOT contain dotted synth keys. `derivedNames.has("form.isValid")` is FALSE. (And even if extended, it wouldn't carry the REACTIVE synth keys `submitted`/per-field `touched`.)

## THE FIX (the correct approach — a threaded synth-key set)

**Step 1 — collector.** Add `collectSynthCellKeys(fileAST): Set<string>` (mirror `collectDerivedVarNames` in `compiler/src/codegen/reactive-deps.ts` for the fileAST walk; mirror `emit-synth-surface.ts:emitCompoundSynthSurface` (line 115) for the KEY GENERATION so there is ZERO drift):
- For each COMPOUND-PARENT state-decl (predicate: `node._cellKind === "compound-parent" || Array.isArray(node.children)`) with qualified name `q`: add `q.errors`, `q.isValid`, `q.touched`, `q.submitted`.
- For each FIELD CHILD passing the emit-synth-surface fieldChildren filter (emit-synth-surface.ts:135 — `kind === "state-decl"` AND NOT (`_cellKind==="compound-parent"` || `Array.isArray(children)`) AND NOT `_cellKind==="markup-typed"` AND NOT (`shape==="derived" && isConst===true`)): add `q.<field>.errors`, `q.<field>.isValid`, `q.<field>.touched`.
- Recurse into compound-typed children with `q = q + "." + childName` (nested compounds).
- Keys are PLAIN (un-encoded) — match the within-file synth declares (the `encodeKey` in emit-synth-surface only encodes when a chunk encodingCtx is set; the client.js synth declares + the reads are plain). Verify by grepping an emitted client.js for `_scrml_derived_declare("form.isValid"` (plain).

**Step 2 — context field.** Add `synthCellKeys?: Set<string> | null` to `EmitExprContext` (emit-expr.ts) AND to `EmitLogicOpts` (emit-logic.ts) — wherever `derivedNames` lives as a threaded field.

**Step 3 — populate + thread.** At `compiler/src/codegen/index.ts` (the ~631 + ~703 sites where `derivedNames: collectDerivedVarNames(fileAST)` is set) add `synthCellKeys: collectSynthCellKeys(fileAST)`. Then at EVERY site that propagates `derivedNames` (grep `derivedNames:` across `compiler/src/codegen/` — emit-event-wiring.ts ×3, emit-logic.ts ×several, emit-control-flow.ts, emit-variant-guard.ts, emit-validators.ts), add a sibling `synthCellKeys: <same ctx/opts source>.synthCellKeys`. Mirror derivedNames EXACTLY — same propagation chain.

**Step 4 — guard.** In `emit-expr.ts` `emitMember`, before the standard member emission:
```
if (ctx.mode === "client" && !node.optional && SYNTH_PROPERTY_NAMES.has(node.property as any)) {
  const dotted = synthDottedKey(node);   // pure AST walk (the 5ec3319e scaffold)
  if (dotted !== null && ctx.synthCellKeys?.has(dotted)) {
    return `_scrml_reactive_get(${JSON.stringify(dotted)})`;
  }
}
```
`synthDottedKey` = the pure-AST-walk from `5ec3319e` (no annotations, no getResolvedStateCell). The `ctx.synthCellKeys?.has(dotted)` membership is the precise over-fire guard: registered synth cell → route; plain-cell field (not in set) → fall through to member access.

**Scope discipline:** read-path only. Do NOT touch Bug 58's write-path/`_flatBindKey` or surface emission. Don't reimplement the synth registry. Verify non-regression on (a) per-field 3-seg reads (route), (b) real-field `@form.name` (member access), (c) plain-cell `@config.errors` (member access).

## ACCEPTANCE GATE (commit the conf test in Step 1; happy-dom in Step 2)

1. **Conf emit-regression** (fails-before/passes-after): compile a §55 compound + a plain cell. Assert: `@form.isValid` → `_scrml_reactive_get("form.isValid")`; `@form.submitted` → `_scrml_reactive_get("form.submitted")` (reactive synth — MUST also route via the set); `@form.name.isValid` → `_scrml_reactive_get("form.name.isValid")`; **OVER-FIRE: `@config.errors` (plain `<config>={errors:[]}`) → `_scrml_reactive_get("config").errors` (member, NOT dotted)**; real-field `@form.name` → member access. (The `5ec3319e` conf test `conf-compound-rollup-read-bug-61.test.js` is a starting point — ADD the over-fire + reactive-synth cases.)
2. **happy-dom**: mount a compound form; assert `@form.isValid` reactive (false invalid → true valid) and `disabled=!@form.isValid` ENABLES the submit button when valid. (Strengthen Bug-58's `browser-form-for-validity-bug-58.test.js` documented-but-unasserted disabled-gate to asserted, or a new test.)

## R26 (Phase 3 — mandatory; before DONE)
Re-compile canonical formFor + a hand-authored compound + a plain-cell-with-synth-named-field + any `<formFor`/compound adopter in samples/examples. Confirm: compound + per-field synth reads emit dotted; plain-cell fields emit member access; formFor submit button runtime-enableable; `node --check` all. DO NOT mark DONE without R26 passing.

## COMMIT DISCIPLINE (S83)
First commit msg includes `pwd` verbatim (`WIP(bug-61): start at <pwd>`). Commit per the crash-resilience order above. `git status` clean before DONE. FULL pre-commit suite at each step (the @-read-path + threading touch many sites — watch over-routing regressions). **NEVER `--no-verify`** (env-race → STOP + report). Update `docs/changes/bug-61-compound-rollup-read-path-2026-05-28/progress.md` after each step.

## FINAL REPORT
WORKTREE_PATH · BRANCH · FINAL_SHA · FILES_TOUCHED · merge-main-confirmed (57/58/59 markers) · collector + threading sites · pre-fix-repro · post-fix (compound+per-field+reactive route; over-fire+real-field member) · regression fails-before/passes-after · happy-dom (button enables) · R26 · full-suite counts · maps feedback · deferred items.
