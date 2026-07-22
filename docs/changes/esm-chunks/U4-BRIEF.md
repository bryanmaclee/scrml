# U4 — `import()` nav-time chunk loader (ESM-chunks arc)

**Dispatched:** S280 (2026-07-22) · base `8ade2355` · agent `general-purpose`, opus, `isolation: worktree`, background
**Why general-purpose and not `scrml-js-codegen-engineer`:** the canonical dev-agent is NOT installed on this machine (bryan-XPS-8950); it exists only on the ASUS clone and arrives with the pending `claude-workflow` union merge. S279 took the same documented fallback for #131.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

Your FIRST action, before reading or writing anything:

1. `pwd` — it MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report; do not proceed.
2. `git -C "$PWD" rev-parse --show-toplevel` MUST equal that same worktree path.
3. `git status --short` MUST be clean.
4. `bun install` — a fresh worktree does NOT inherit `node_modules`; the pre-commit hook fails with "cannot find package 'acorn'" otherwise.
5. `bun run pretest` — populates the gitignored `samples/compilation-tests/dist/` browser-test fixtures. Without it you get ~130 ECONNREFUSED-shaped failures. Use `bun run test` (chains pretest), NOT bare `bun test`, for any baseline.

**Per-edit path discipline.** Every write uses an ABSOLUTE path under your worktree root. NEVER `cd` into `/home/bryan/scrmlMaster/scrml` (the integration checkout). Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`. Prefer editing via Bash on worktree-absolute paths (echo the path before, `git diff` after). A relative path resolves against the integration checkout and leaks.

**Crash recovery.** Commit after EVERY meaningful change (WIP commits expected). Maintain `docs/changes/esm-chunks/progress-u4.md` as an append-only timestamped log: what you just did, what is next, blockers. The branch + progress log are the only recovery anchors.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing.

⚠️ **THE MAP IS STALE — treat its content as a verify-against-source hypothesis, not truth.**
Map stamp: `9481bc69` (2026-07-21). Base for this dispatch: `8ade2355`. **The entire ESM arc landed AFTER the map stamp** and is invisible to it. Factor in explicitly:

| landing | what it added |
|---|---|
| #132 `970d3e1f` | ESM **U1** — `--module-format=classic\|esm` flag, `compiler/src/codegen/runtime-esm.ts`, R1 `_scrml_reactive_get` globalThis bridge |
| #133 `62f2cf4f` | ESM **U2** — client chunks as ES modules, `compiler/src/codegen/emit-client-esm.ts`, namespace import, R2 `_scrml_lift_target` bridge |
| #135 `5385091e` | ESM **U3** — `type="module"` script tags + build-hash import rewrite; a full `--esm` app RUNS in a browser |
| #137 `df6d269c` | `<each>` mount is now a comment FENCE, not a `<div>` (foster-safe) — relevant if you touch each-mount code |

Report the map's load-bearing finding back, including "not load-bearing" if that is the honest answer.

---

## Anti-pattern briefing — READ BOTH BEFORE ANY CODE

- `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
- `docs/articles/llm-kickstarter-v2-2026-05-04.md`

Re-read before each sub-piece. These counter the React/Vue/JSX reflex.

---

## The task

Build **U4 of the ESM-chunks arc: the `import()` nav-time chunk loader.**

### Context you need

`scrml` compiles a multi-page app into per-route client chunks. Navigating between routes currently triggers a **full document reload** — that is open adopter issue **#27**. Wave-1c built a soft-nav loader on the CLASSIC (`createElement("script")`) path; it is **HELD and will not land** because bryan RULED it unsound (S279, Option B):

> each-ids, cell-names and fn-names are assigned PER FILE (every route chunk restarts at `each_1`), but `_scrml_each_renderers` and the cell store are SHARED classic globals. Two routes that both contain an `<each>` emit the same `scrml-each:N` and register `_scrml_each_renderers["each_N"]` at module top level. Under cross-chunk soft-nav the chunks COEXIST, so route B's load clobbers route A's registry and nav-back renders B's rows into A's fence. Guaranteed, session-durable.

**Module scope is what dissolves that.** Hence: the soft-nav loader is built on the **esm path only**.

### Scope

1. **Port the loader logic** from the held branch `feat/wave1c-nav` (local; also `origin/worktree-agent-a2ed001a5de228134` pre-rebase). Its `compiler/src/runtime-template.js` delta (+162 lines) is the reference:
   - `_scrml_nav_missing_chunks(doc, path)` — diffs already-loaded chunk basenames against those the target route needs. Port largely as-is.
   - `_scrml_nav_load_chunks(urls, token, onDone, path)` — **rewrite on `import()`**.
   - `_scrml_nav_chunk_failed(path, token, url, reason)` — hard-nav fallback. Keep.
   - `_scrml_nav_token` staleness guard. Keep.
2. **`import(url)` replaces the injection machinery.** The promise supersedes `s.onload` / `s.onerror` / the manual `setTimeout` timeout. Per-call promise state supersedes the module-level `_scrml_chunk_loading` boolean — that retires gap `g-nav-chunk-loading-flag-race`, and also the flagged MEDIUM that a lost-race nav still runs its chunk's module-init and pollutes globals. Nav-scope the loading state to the token.
3. **Gate on module format.** Under `--module-format=classic` (still the DEFAULT), soft-nav does NOT engage — classic keeps today's hard-nav. Do not attempt cross-chunk soft-nav on the classic path; it is the unsound model above.
4. **Port the tests** the held branch carries: `compiler/tests/browser/browser-navigate-cross-chunk.test.js`, `compiler/tests/conformance/conf-NAV-CROSS-CHUNK.test.js`, and the `browser-navigate-soft-nav.test.js` delta. Adapt to the esm path.
5. **Do NOT** touch the `<outlet>`/landmark composition (landed #124/#126) or the each-fence model (#137).

### Design constraints (non-negotiable)

- The adopter/default (`classic`) path must remain **byte-identical**. Prove it: compile a real multi-page app before and after, diff the emitted artifacts.
- No new shared-mutable `globalThis` bridge without the fail-loud guard the arc established (U1 R1 / U2 R2 are the only two sanctioned ones; a third needs to be surfaced, not invented).
- `import()` specifiers must survive the U3 build-hash rewrite (content-addressed chunk URLs).

---

## Phase 3 — EMPIRICAL VERIFICATION (R26). DO NOT mark DONE without this passing.

1. Recompile REAL sources on your post-change baseline, as directories:
   - `bun compiler/bin/scrml.js compile examples/23-trucking-dispatch --output-dir <tmp>`
   - `bun compiler/bin/scrml.js compile docs/website --output-dir <tmp>`
   Both must compile clean under BOTH `--module-format=classic` and `--module-format=esm`.
2. **The symptom-check is EXECUTION IN A REAL BROWSER, not a grep and not "tests pass."** This arc has hit the "emitted ≠ runs" trap three times (S265, S268, U3) — every time a marker-grep passed while the bundle was dead on arrival. Load a composed multi-page `--esm` build in a real browser, navigate between two routes that BOTH contain an `<each>`, then navigate BACK, and confirm route A still renders A's rows.
3. If you cannot run a real browser, say so plainly and report exactly what you did run. **Do not claim a browser pass you did not execute** — a prior agent on this repo claimed a Chromium run whose harness did not exist, and it was caught.

---

## Refusal is welcome

**If any premise in this brief is wrong, STOP and report — do not build past it.** Dev agents corrected the PA four times at S277 and that was the session's most valuable output. Specifically challenge me if: the held-branch logic does not port the way I have described, `import()` cannot be gated cleanly on module format, the classic path cannot be kept byte-identical, or the each-id collision turns out NOT to be dissolved by module scope.

## Report back

Worktree path · final branch SHA · files touched · what the map was worth · R26 results (with exactly what was executed) · anything you refused to build and why · deferred items.
