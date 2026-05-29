# progress — gate-found-invalid-js-fix-wave-2026-05-29

WORKTREE: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-ab2914bfb23c81da7
Base: fe0c8335 (v0.6.9 — gate landed flag-gated, validateEmit default OFF)

## Step 0 — startup + enumerate (2026-05-29)
- Startup verified: worktree CWD ok, base fe0c8335, tree clean, merge up-to-date, bun install + pretest done.
- Read deep-dive RATIFIED banner (A+D, S141) + gate-build progress.md.
- ENUMERATION (node --check is ground truth; gate-on confirms):
  - C10/C11 cluster from gate-build progress.md (~12 trucking-dispatch + seeds.server.js) is GONE at base fe0c8335 — the S140 v0.6.7 fix-wave (Bug 57/58/59/61) + v0.6.8/v0.6.9 closed it. trucking-dispatch (36 files / 64 artifacts) now node --check CLEAN. 22-multifile CLEAN. samples/compilation-tests/dist CLEAN.
  - REMAINING invalid-JS in examples/ (4 single-file, all .client.js):
    1. 05-multi-step-form: `(_scrml_reactive_get("currentStep") == Step::Info)` — variant literal `Step::Info` + `==` left RAW in `class:active=` directive expr. INVALID.
    2. 21-navigation: `(_scrml_reactive_get("currentView") == .Home)` — leading-dot variant `.Home` + `==` left RAW in `class:active=` directive expr. INVALID. SAME ROOT as #1.
    3. 12-snippets-slots: `String(() ?? "")` — empty snippet-slot interpolation lowered to bare arrow `()`. INVALID.
    4. 16-remote-data: `await let _scrml_tilde_7 = _scrml_fetch_...()` — `await let` (tilde-pipeline inside async fn). INVALID.
  - samples/*.scrml spot-check invalid (5): file-manager-r11 `(bytes/1024).toFixed` → paren dropped; login `| AuthError e -> {` match-arm-binding; quiz-app `_scrml_else-if_handlers` hyphen-in-ident; debate-lin-lift-edge-cases + react-dev-lin-lift-edge-cases `const token = if (...)` (lin+lift). These are gauntlet/dev-persona stress samples, NOT in examples/.
- BLAST RADIUS (gate forced default-ON, unit+integration+conformance subset): 37 fails across ~23 distinct test cases spanning auto-await, match-arm-binding, each-block alias, tilde, temporal-rule .test.js emission, self-host modules, lin/lift, lifecycle transition(). MUCH larger than "16 examples." This is the full invalid-JS surface the gate-default-ON exposes.

## ROOT CAUSE 1 (examples #1+#2): class: directive form-3 expr bypasses variant-aware emitter
- emit-bindings.ts:552-571 `class:` form-3 (`expr` kind) lowers via `rewriteReactiveRefs(rawExpr)` (raw-string @-rewrite). That path does NOT lower variant literals (`.Home`, `Type::Variant`) or `==` → `_scrml_structural_eq`. The `if=`/`${}` paths route through parseExprToNode → emitExprField (variant-aware) and emit correctly.
- FIX: parse rawExpr → ExprNode via parseExprToNode; emit via emitExprField (mode client, derivedNames, synthCellKeys); fall back to rewriteReactiveRefs on parse failure.

## ROOT CAUSES FIXED (committed)
1. class: directive form-3 + else-if chain condition cascade (emit-bindings.ts, emit-event-wiring.ts) — variant literal + ==/!= left raw. FIXED via parseExprToNode->emitExprField. Examples 05, 21. Commit e8785c5f + tests f9159bd2.
2. empty ${} interpolation -> String(() ?? "") (emit-lift.js) — skip empty text-node. Example 12. Commit 1ea9682e.
3. await on tilde-init server call -> "await let X" (scheduling.ts) — inject await on initializer. Example 16. Commit f48d885b.
4. multi-field !{} arm binding + multi-arg fail (ast-builder.js, emit-logic.ts) — parser captured only first ident; fail emitted bare comma list. FIXED: parse all idents, field-keyed data object. Cluster: auto-await/!{}/tilde-gap-5/R25-bug-49. Commit e94d3c2a.

## REMAINING BLAST RADIUS (gate-on, to drive to green)
- S26 §51.13 machine .machine.test.js emission (temporal/guard-coverage/payload/wildcard) — emitted test files invalid JS.
- S26 bug A machine guard @reactive rewrite (5) — guard JS invalid.
- each-block "as name" index alias (1).
- match-arm-block named-binding (1).
- Lifecycle transition() + <onTransition> HTML filter (2).
- self-host meta-checker + module-resolver (2).
- DG sweepNodeForAtRefs (1 — confirm if invalid-JS or unrelated).

## SCOPE NOTE (surfaced to PA)
The brief's premise (~16 examples, dominated by C10 trucking-dispatch) was STALE: C10/C11 already fixed at base fe0c8335 (S140 v0.6.7 + v0.6.8/9). examples/ had only 4 invalid artifacts (now all fixed). The REAL gate-default-ON acceptance surface is ~37 unit/integration test fixtures emitting invalid JS across many codegen subsystems — a much larger fix-wave. Driving the FULL suite green with gate-on requires fixing each. Proceeding per Rule 2/3 (fix codegen, not exempt).

## CORRECTION + PROGRESS (clean session resumed)
- The earlier "write:true serverJs markup-leak" finding was a FALSE diagnosis caused by a transient tool-output-confusion window (markup `<...>` content was being mangled in tool output, not actually in serverJs). Clean re-probe: serverJs="" under BOTH write:false/true. WITHDRAWN.
- REAL S26 root cause: emit-event-wiring.ts handler-map VARIABLE NAME built from raw domEvent → non-canonical event attr (`on:click`→`:click`, `else-if`→`-`) emitted invalid JS identifier `const _scrml_:click_handlers`. FIXED via idEvent sanitizer [A-Za-z0-9_$]. Commit 0505bc55. Closed the entire S26 machine-test cluster + S26 bug-A + quiz-app/login samples (~23 tests).
- Gate-on blast radius: 37 → 31 (after 5 fixes) → 8 (after event-wiring fix).

## REMAINING 8 (gate-on)
- !{} inline catch codegen (§19.4.3) + R25-Bug-49 nested !{} (2) — !{} arm emission.
- each-block §4 `as name` index alias (1).
- match-arm-block named-binding Bug 6.5.1 (1).
- <onTransition> structural-element filter / HTML (1).
- Bug 4.5 DG sweepNodeForAtRefs (1 — likely not invalid-JS; confirm).
- self-host meta-checker + module-resolver (2).
