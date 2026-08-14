# gate-each-multiroot-image-debug — progress (append-only)

## 2026-08-14 ~14:30Z — startup + local elimination
- Worktree verified: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a5bcd8b4a8a44feea, branch debug/gate-each-multiroot-image-20260810 cut from origin/main @ 43ff9a3b.
- bun install + bun run pretest done.
- Local probe of the §5 lift-run source: static HTML carries NO .lhdr (only `<span data-scrml-logic="_scrml_logic_1">`); all rendering client-side at eval time; no DOMContentLoaded dependence. `_scrml_lift` falls back to document.body on null target, so a missed querySelector alone cannot give count 0.
- Cloud gate log (run 31806286070, job 94785890233) mined: §1-§4 of the SAME file PASS in cloud (each-path executes fine through the same harness); conformance for-lift runtime tests (each/for-lift-per-item-if-reactive/*, each/multi-root) PASS in cloud. Failure is a clean expect diff (Received: 0) — eval did NOT throw. Windows job (same suite) GREEN.
- Order hypothesis tested: extracted cloud file order from ##[group] markers (1015 files) vs local order via junit reporter (1015 files, same set, VERY different order — readdir/hash order, not sorted). Ran the 719-file cloud prefix in exact cloud order locally: 14554 pass / 0 fail — order alone does NOT reproduce on this machine.
- Locale probes (LANG/LC_ALL=C.UTF-8 and POSIX, TZ=UTC) on the single file: pass. Not locale-env alone.
- Conclusion: divergence requires the actual cloud environment → proceed to CI round 1 with heavy instrumentation.

## Side observation (NOT the CI mechanism — count-only assertions unaffected)
- The Tier-0 lift path emits `document.createTextNode("H${r.label}")` — a LITERAL uninterpolated string (text interp dropped on lift-element children under for-lift). §5 only counts nodes so it passes anyway. Matches the known tracking-lane bug g-emit-lift-markup-text-interp referenced in ci.yml comments. Not in scope here.
