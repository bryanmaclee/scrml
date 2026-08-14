# progress — gate-boot-listener-fix (S345-bryan dispatch)

Append-only. Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7342948407d7b84d
Branch: fix/gate-boot-listener (off origin/main).

## 2026-08-14 — startup + fix 1 (emitter `{ once: true }`)

- Startup verification passed: pwd == toplevel == worktree root, tree clean, `bun install`
  (217 pkgs), `bun run pretest` exit 0.
- Read FINDINGS.md from `debug/gate-each-multiroot-image-20260810` — diagnosis taken as
  given (TEST-HARNESS defect: stale cross-file DOMContentLoaded listeners on the shared
  happy-dom document, re-fired by each-multi-root's own dispatch).
- Loci verification: grepped ALL of `compiler/src/` for actual
  `addEventListener("DOMContentLoaded"` emissions — exactly the three asserted sites
  exist, at the EXACT asserted line numbers (no drift, no fourth site):
  - `compiler/src/codegen/emit-event-wiring.ts:2262` (`_scrml_boot`)
  - `compiler/src/codegen/emit-variant-guard.ts:1341` (`_fire` engine/match init-fire)
  - `compiler/src/codegen/emit-client.ts:2706` (link-boost `_scrml_link_ensure_click`)
- Applied `{ once: true }` at all three, each with a short rationale comment
  (production-identical: DOMContentLoaded fires once per real document; `once`
  auto-removes so a stale boot can never re-fire against a longer-lived document).
- Coupled test update (same commit per S113 one-logical-unit rule):
  `compiler/tests/unit/engine-body-render.test.js:679` asserted the OLD registration
  regex `/document\.addEventListener\("DOMContentLoaded", _fire\)/` — updated to expect
  `, { once: true })`. Swept tests + conformance for other text assertions on the three
  registration shapes: none (only prose comments).
- `bun test compiler/tests/unit/engine-body-render.test.js` → 31 pass / 0 fail.
- Commit e375c7c5 (fix 1). Pre-commit full-suite hook ran green (~10 min — the
  600s Bash cap killed the shell AFTER the commit finalized; verified via git log +
  clean tree). Regenerated docs/FACTS.md for the pre-push generated-doc gate
  (facts-table 1-line delta) — committed separately; branch pushed.

## 2026-08-14 — fix 2 (harness hermeticity) + census-driven drop-ins

- Census (grep `dispatchEvent(new Event("DOMContentLoaded"` over compiler/tests/):
  103 files dispatch; ALL 103 also eval compiled bundles. Partition by
  happy-dom registration pattern:
  - 81 already fresh-window (GlobalRegistrator.unregister+register per case/file) — immune;
  - 20 shared-guarded (`if (!globalThis.document) register()`) — the vulnerable class;
  - 2 caller-owned/flag-guarded (e2e-render-map/render-harness.js — caller owns
    registration; browser-reactive-arrays.test.js — skip-flag + shared guard).
- Fixed as mechanical drop-ins (the fix-2 recipe: fresh window per compileAndLoad,
  async + await at call sites; or per-file via async beforeAll):
  - compiler/tests/unit/each-multi-root.test.js — per-compileAndLoad; 15 call sites,
    15 tests → async. 20 pass / 0 fail (main's count; FINDINGS' "21" included the
    debug branch's instrumentation test).
  - compiler/tests/unit/engine-body-render.test.js — per-compileAndLoad (§13);
    3 call sites → async. THE proven writer. 31 pass / 0 fail.
  - compiler/tests/unit/gauntlet-s22/derived-machines.test.js — single inline
    test; fresh window at test start. 21 pass / 0 fail.
  - compiler/tests/integration/chunk-ns-intact-bundle-acceptance.test.js —
    per-file via async beforeAll. 2 pass / 0 fail.
- Listed, NOT fixed (browser lane, not the cloud-gate population; the emitter
  `{once:true}` already protects the class; wholesale harness migration is
  explicitly out of this dispatch): 18 shared-guarded browser files —
  browser-bind-value, browser-class-binding, browser-component-css-var,
  browser-components, browser-conditionals, browser-forms,
  browser-i81-component-root-crash, browser-match-block, browser-navigate-soft-nav,
  browser-theme-switch, browser-todomvc, browser-todo, browser-transitions,
  errors-element-messages-chunk-gh234.browser, gh237-onmount-server-fn-await.browser,
  g-tablefor-column-slot-literal-interp.browser, runtime-behavior,
  tablefor-perrow-onchange-evt-bug-59; plus browser-reactive-arrays and
  e2e-render-map/render-harness.js (caller-owned registration).
