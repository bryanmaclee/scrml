# progress — s461-given-cell-lowering

- 2026-10-09T17:42:41Z WIP(s461-given-cell-lowering): start at /home/user/scrml/.claude/worktrees/agent-a342b0bebb3b69186 (base origin/main 5a895f3)

## Phase 0 — startup (done)
- pwd/toplevel = worktree; remote bryanmaclee/scrml; branch s461-given-cell-lowering from origin/main 5a895f3 (merge-base == origin/main).
- bun install OK; `bun run pretest` OK (samples/compilation-tests/dist populated).

## Rule 4 gate — governing sentences (re-read in compiler/SPEC.md at 5a895f3)
- §42.3.5 worked example (SPEC.md:31426): `${ given @user :> { <p>${@user.name}</p> } } // OK — narrowed to present inside the guard`
- §42.2.3 (SPEC.md:31284): "Multi-narrowing is all-or-nothing. If any listed variable is `not`, the body is skipped entirely. There is no partial execution of the body with a subset of variables present."
- §42.2.3 (SPEC.md:31286): "`given` is the positive counterpart to `x is not`. Inside the body, each named variable is narrowed — the `| not` component is removed from each variable's type. No variable is rebound to a new name; each identifier is narrowed in place."
- §42.5 (SPEC.md:31498-31505): "`given x :> body` → `if (x !== null && x !== undefined) { body }`" · "`given x, y :> body` → `if (x !== null && x !== undefined && y !== null && y !== undefined) { body }`" · "`given x` in a match arm → the arm's generated condition is `x !== null && x !== undefined`".
- §17.6.10 (SPEC.md:16617) — the markup-body limb: "A branch body that is exactly one expression SHALL be equivalent to `{ lift <expression> }`." (a `given` guard lowers to an `if` per §42.5, so its single-markup body is such a branch body.)

## Phase 1 — reproduction (5a895f3, executed)
- repro compiles exit 0; client.js has `if (user !== null && user !== undefined) {` in `_scrml_show_3` AND at top level with an EMPTY body; html has no `<p>`. CONFIRMED.
- AST dump: both `given-guard` nodes carry `variables: ["user"]` — the `@` is stripped at parse (ast-builder.js both given parse sites) and NOTHING records that the head named a cell. The emitter (emit-logic.ts `case "given-guard"`) then interpolates the stripped name.
- Markup body: the guard body parses to `[html-fragment "<p>", logic{@user.name}, html-fragment "< / p >"]` — the exact shape `implied-lift-desugar.ts` converts for an `if-stmt` arm, but that pass only visits `if-stmt` (and pre-filters on `\bif\b`), so the given-guard body reaches emit-logic `case "html-fragment": return ""` = the drop.

## Phase 2 — fix (commit 87d4bcc-amended, see log)
- ROOT 1 (logic + markup head): `ast-builder.js` both `given` parse sites now record `variableIsCell` (parallel to `variables`, which keeps the `@`-stripped names the narrowing consumers key on). `emit-logic.ts` `givenHeadRef` lowers a cell head as the `@name` ident through `emitExpr` (= `emitIdent`: reactive getter / derived getter / server body), so the guard reads the cell through the same accessor as the body; the chunk-scope pass then rewrites it to `_scrml_cs_reactive_get`. Locals stay bare (byte-identical). SERVER boundary deliberately keeps the bare name (see report: making the head visible to E-REACTIVE-003 is a front-end widening).
- ROOT 2 (markup body drop): `implied-lift-desugar.ts` planned only `if-stmt`; `given-guard` added via `isCascadeNode` (planIfCascade already walks `body`). §42.5 lowers `given` to an `if`, so its single-markup body is a §17.6.10 branch body.
- Diagnostic parity (found by probe, base vs head): the lift-expr markup is NOT walked by TS's `lift-expr` arm nor the §42 presence reader (pre-existing hole that the if-arm desugar already lives in). Routing the given body into it made `${@typo}` (E-STATE-UNDECLARED) and an unguarded `${@o.opt.x}` (E-TYPE-046) in a given body newly-ACCEPTED. Fixed by carrying the pre-desugar pieces on the given lift (`_givenBodyPieces`, object wrapper) and judging those in type-system.ts `lift-expr` + presence-narrowing.ts given-guard. 20-probe diagnostics diff base vs head: IDENTICAL.
- Tests: `compiler/tests/unit/given-cell-lowering-s461.test.js` (25), `compiler/tests/browser/browser-given-cell-s461.browser.test.js` (4, EXECUTED in happy-dom with the shipped pruned runtime). Bite: on base 18/29 fail (all 4 browser tests with `ReferenceError: user is not defined`); the 11 that pass on base are the deliberately-unchanged pins.

## Phase 2b — conformance cases
- `conformance/cases/condition/given-cell-guard-worked-example-present-pos` (§42.3.5 worked example, present after click)
- `conformance/cases/condition/given-cell-guard-worked-example-absent-pos` (`not` half: renders nothing, handler body skipped)
- `conformance/cases/condition/given-cell-guard-multi-all-or-nothing-pos` (§42.2.3 multi all-or-nothing over two cells)

## Phase 3 — empirical verification
- R26 grep (repro `a.scrml` recompiled on head): `grep -c 'user !== null' a.client.js` = 0. Both guards read `if (_scrml_cs_reactive_get("user") !== null && _scrml_cs_reactive_get("user") !== undefined)` — the same accessor every other read of `@user` uses. The markup `<p>` body is present (`createElement("p")` inside a reactive `_scrml_effect` lift group).
- EXECUTED: `compiler/tests/browser/browser-given-cell-s461.browser.test.js` (happy-dom + the shipped pruned runtime): loads with no ReferenceError; `not` → guard renders nothing / handler body skipped; set present → renders "a", handler writes; change → re-renders "b" (one node); back to `not` → cleared; multi all-or-nothing. On base all 4 throw `ReferenceError: user is not defined`.
- Conformance: 3 new cases PASS on head; on base all 3 FAIL (runtime half — `--xfail-signature` produced a runtime failure sig for each).
- CORPUS DIFFERENTIAL (`scripts/corpus-emit-differential.ts`, roots examples,samples,conformance,stdlib,benchmarks; base = detached worktree `.claude/worktrees/s461-given-base` @ 5a895f3, head = f4639ff):
  - enumeration 2594 base / 2597 head (+3 = the new conformance cases, nothing else).
  - compile-failure SET identical (0 newly failing, 0 newly passing); diagnostic-CODE changes 0; diagnostic-TEXT changes 0.
  - 7640 artifacts compared: 7477 byte-identical, 163 differing — ALL 163 are `*.server.js` differing ONLY in `const _scrml_project_root = "<worktree path>"` (verified by normalising both worktree roots: 163/163 identical after normalisation, 0 real content changes).
  - So: 0 changed artifacts beyond the build-path artifact. Expected: no corpus source outside the 3 new cases contains `given @` (`grep -rlE 'given\s+@'` over the five roots = 0 files).

## Gates
- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (full, no --bail — --bail stops at the first env-only failure on BOTH sides):
  - BEFORE (base 5a895f3): 31441 pass / 11 fail / 132 skip / 12 todo (31596 tests). Fails = 10 environment-only (dev-server spawn timeouts ×5, tenant EXECUTED ×3, read-only-file crash recovery, SCRML_HOST bind) + 1 timing flake (S27 §51.11 chained temporal audit).
  - AFTER (head): 31469 pass / 11 fail — the same 10 environment-only + `defer-binder-completeness` (the new `given-guard.variableIsCell` field needed a classification; added to EXCLUDED as a boolean flag, commit 5e72c7f; file re-run 3/3 pass). Net: +28 passes (25 unit + 3 conformance-bridge cases), 0 new failures.
- `bun conformance/run.ts`: 1484/1549 pass, 65 xfail, exit 0 (0 FAIL).
- `bun run types:check`: OK, 184 diagnostics unchanged.
- browser tier: base 1429 pass / 50 fail, head 1433 pass / 50 fail; the 50 failure NAMES are identical (diffed). `scripts/browser-baseline.ts --check` refuses on a pre-existing parser/harness count disagreement (48 vs 47), unrelated.
- `bun scripts/facts.ts --check` was STALE (counts) → `--write` (commit fa60be3). `bun scripts/bootstrap-conformance.ts --check` STALE (3 new cases) → `--write` (f4639ff). `regen-spec-index.ts --check` OK (no SPEC edit).
