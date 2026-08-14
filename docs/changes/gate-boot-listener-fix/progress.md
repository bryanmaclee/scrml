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
