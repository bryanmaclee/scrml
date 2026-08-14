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

## Side observation (NOT the CI mechanism — count-only assertions unaffected)
- The Tier-0 lift path emits `document.createTextNode("H${r.label}")` — a LITERAL uninterpolated string (text interp dropped on lift-element children under for-lift). §5 only counts nodes so it passes anyway. Matches the known tracking-lane bug g-emit-lift-markup-text-interp referenced in ci.yml comments. Not in scope here.
