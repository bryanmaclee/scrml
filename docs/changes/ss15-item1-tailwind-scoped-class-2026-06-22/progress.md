# ss15 item-1 — g-tailwind-lint-false-fires-on-scoped-class

## 2026-06-22
- F4 startup OK: worktree = .claude/worktrees/agent-a5714abcea473b258; bun install + pretest done.
- Phase 0: confirmed findUnrecognizedClasses is a text pre-pass (api.js:925, no AST). Reproduced spurious `card`/`card-title` lints on /tmp/css-dogfood.scrml; @scope CSS emits correctly.
- FIX: added `collectAuthorDefinedClasses(source)` text-scan helper (brace-balanced `#{ … }` + literal `<style>…</style>`; extracts `.ident` class selectors, digit-after-dot excluded so `.5rem` is not a selector). Wired exclusion `if (authorDefinedClasses.has(cls)) continue;` after the getTailwindCSS skip in findUnrecognizedClasses. Updated JSDoc. findUnsupportedTailwindShapes NOT touched (author CSS class names aren't Tailwind-shaped).
- TESTS: appended §11 (8 tests) to bug-1-tailwind-unrecognized-class.test.js: #{}-defined excluded, <style>-defined excluded, Tailwind still resolves, typo still fires, comma/compound/descendant/child/pseudo selectors, numeric-fraction not confused, externally-styled-no-block still fires, component-scope #{}. 48/48 pass.
- R26: zero W-TAILWIND-UNRECOGNIZED-CLASS on card/card-title; @scope CSS byte-identical; neg-control `crad` typo still fires.
- NEXT: full suite + commit.

## 2026-06-22 (verification complete)
- Committed code+test+progress as ONE logical unit (S113): 71d06359.
- Pre-commit gate (unit+integration+conformance): 17582 pass / 0 fail / 68 skip / 1 todo.
- Full `bun run test` (incl. browser): 24883 pass / 1 fail / 211 skip / 1 todo.
  - The 1 fail = `mpa-shell-clean-urls §3 Sub 3 — /reference resolves` — a 5000ms TIMEOUT (30020ms wall) under full-suite resource contention. PASSES in isolation (17/0 @ 301ms). PRE-EXISTING browser-test flake, NOT caused by this change (lint touches only the diagnostics array — no async/IO/CSS/dist/routing effect).
  - `e2e-render-map` NEW-cell note on examples/32-external-api.scrml#empty is informational baseline-drift, not a counted failure, unrelated to tailwind-lint.
- NO within-node CSS re-baseline needed: change is lint-only (read-only helper + diagnostic gate); CSS/HTML/dist emission untouched. R26 confirmed @scope CSS byte-identical before/after.
- DONE.
