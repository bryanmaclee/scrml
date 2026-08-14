# gate-each-multiroot-image-debug — progress (append-only)

## 2026-08-14 ~14:30Z — startup + local elimination
- Worktree verified: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a5bcd8b4a8a44feea, branch debug/gate-each-multiroot-image-20260810 cut from origin/main @ 43ff9a3b.
- bun install + bun run pretest done.
- Local probe of the §5 lift-run source: static HTML carries NO .lhdr (only `<span data-scrml-logic="_scrml_logic_1">`); all rendering client-side at eval time; no DOMContentLoaded dependence. `_scrml_lift` falls back to document.body on null target, so a missed querySelector alone cannot give count 0.
- Cloud gate log (run 31806286070, job 94785890233) mined: §1-§4 of the SAME file PASS in cloud (each-path executes fine through the same harness); conformance for-lift runtime tests (each/for-lift-per-item-if-reactive/*, each/multi-root) PASS in cloud. Failure is a clean expect diff (Received: 0) — eval did NOT throw. Windows job (same suite) GREEN.
- Order hypothesis tested: extracted cloud file order from ##[group] markers (1015 files) vs local order via junit reporter (1015 files, same set, VERY different order — readdir/hash order, not sorted). Ran the 719-file cloud prefix in exact cloud order locally: 14554 pass / 0 fail — order alone does NOT reproduce on this machine.
- Locale probes (LANG/LC_ALL=C.UTF-8 and POSIX, TZ=UTC) on the single file: pass. Not locale-env alone.
- Conclusion: divergence requires the actual cloud environment → proceed to CI round 1 with heavy instrumentation.

## 2026-08-14 ~14:35Z — ROUND 1 results (run 31809637050, gate job 94796906567, RED image 20260810.271.1 confirmed)
- ZZDEBUG env: kernel 6.17.0-1022-azure, glibc 2.39, LANG=C.UTF-8, bun 1.3.14, happy-dom 20.8.9 (lockfile-pinned confirmed in cloud).
- SINGLE-FILE run of each-multi-root.test.js on the RED image: ALL 21 PASS. The failure is SUITE-CONTEXT-DEPENDENT even in cloud.
- Gate-suite ZZDEBUG dump (poisoned context): compile errors [], clientJs 2533 bytes (== local), contains lhdr; body before eval correct; EVAL ERROR NONE; rows reactive read-back correct. BUT body after eval+dispatch = `<div class="wrap"><span data-scrml-logic="_scrml_logic_1">99</span></div>` — the logic span contains the literal TEXT "99", zero .lhdr/.lrow.
- Mechanism hypothesis: `data-scrml-logic="_scrml_logic_1"` is a GENERIC id every compiled chunk uses. emit-event-wiring.ts:2262 registers `document.addEventListener("DOMContentLoaded", _scrml_boot)` per evaled chunk, never removed. The harness re-dispatches DOMContentLoaded per compileAndLoad → ALL stale boots re-fire → a prior chunk's re-run display effect writes ITS value ("99") into the FIRST matching `[data-scrml-logic="_scrml_logic_1"]` — §5's span — wiping the lifted content.
- Cloud skip count == local skip count (50) — no env-gated test-set difference. Exact-cloud-order local replay (719 files) green — so the state divergence is env-dependent WITHIN some prior test's execution (readdir-order inside corpus-scanning tests / timing values), not the test-file order alone.

## 2026-08-14 ~14:50Z — ROUND 2 dispatched
- Replaced the round-1 dump with span/wrap/body instance-level mutation spies (stack capture on appendChild/insertBefore/textContent/innerHTML etc.), a PHASE-A probe dispatch (no eval of our chunk — any write proves a stale listener), and PHASE-B pre-vs-post-dispatch counts.

## 2026-08-14 ~15:20Z — ROUND 2 results (run 31810901785) — MECHANISM PROVEN + CULPRIT NAMED
- Gate context, PHASE A (probe dispatch, NO eval of our chunk): span becomes "99". PHASE B: our eval renders CORRECTLY (lhdr 4 / lrow 4 PRE-dispatch) — the EMITTED BUNDLE IS CORRECT IN CLOUD — then the harness's DOMContentLoaded dispatch re-fires a STALE listener that wipes the span to "99" (POST-dispatch lhdr 0).
- SPY stack names the writer: `_scrml_render_value` ← `_scrml_nav_rewire` ← `_scrml_boot` — closures created by evals of compiler/tests/unit/engine-body-render.test.js (§13 happy-dom harness; its tests set count=7 then count=99 — the "7" and "99" writes both appeared, last-write-wins "99"). The rewire re-queries the GENERIC selector `[data-scrml-logic="_scrml_logic_1"]` (emit-event-wiring.ts ~:2262 boot registration, never removed; rewire display effect writes textContent).
- Single-file cloud run passes because no engine file precedes. In the failing cloud suite engine-body-render (##group pos 660) precedes each-multi-root (719); in real local runs each-multi-root (76) precedes engine-body-render (383) — the listener never exists when §5 runs locally.
- My earlier "cloud-order replay green" results are VOID: bun test does NOT honor CLI argument order for execution (verified 3 ways: both arg orders + mtime bumps → same execution order) — the replays never actually ran engine before each-multi-root. Execution order in directory-scan mode = filesystem readdir order (cloud groups unsorted ≠ local junit order, same 1015-file set) → per-filesystem-instance (image-build) deterministic order → the 20260810.271.1 image rollout flipped it fleet-wide, matching the S338 "flake"→deterministic timeline.
- happy-dom listener lifecycle probed standalone: DOMContentLoaded listeners are NOT auto-cleared by dispatch/innerHTML/time — accumulation is real (engine §13 evals: counts 2→3→5 measured locally).

## 2026-08-14 ~15:40Z — ROUND 3 dispatched
- Added zzListenerCount() logging per compileAndLoad (pre-eval/post-eval/post-dispatch) + listener ENUMERATION with source hints (engine tokens/cs keys/selectors) at ZZDEBUG test start; instrumented engine-body-render §13 harness with post-eval listener counts. Expect cloud: counts > 0 at each-multi-root with engine-token hints.

## 2026-08-14 ~16:20Z — ROUND 3 results (run 31812533811) — CHAIN CLOSED, DIAGNOSIS COMPLETE
- Cloud gate suite: engine §13 evals accumulate listeners 2→3→5 (IDENTICAL to local — registration is env-independent; only file order differs). each-multi-root §5: `listeners pre-eval 5/0` — five stale engine listeners live at dispatch. Enumeration: 3x engine `_fire` (`__scrml_engine_phase_dispatch(...)`) + 2x `_scrml_boot` containing `querySelector('[data-scrml-logic="_scrml_logic_1"]')`.
- Same-run single-file step: 0/0 everywhere (engine runs after each-multi-root there).
- FINDINGS.md finalized at docs/changes/gate-each-multiroot-image-debug/FINDINGS.md (committed on the debug branch). 3 CI rounds used of 6.

## Side observation (NOT the CI mechanism — count-only assertions unaffected)
- The Tier-0 lift path emits `document.createTextNode("H${r.label}")` — a LITERAL uninterpolated string (text interp dropped on lift-element children under for-lift). §5 only counts nodes so it passes anyway. Matches the known tracking-lane bug g-emit-lift-markup-text-interp referenced in ci.yml comments. Not in scope here.
