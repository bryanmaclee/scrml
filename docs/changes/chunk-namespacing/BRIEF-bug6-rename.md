# BRIEF — chunk-namespacing BUG-6 accessor-rename (execution)

**Dispatched:** S283 (2026-07-23) · **agent:** scrml-js-codegen-engineer · **model:** opus
**Resume branch:** `worktree-agent-a91ad13968b46ab5d` @ `4f816389` (this worktree — RETAINED)
**Arc base:** `e8fdd44c` · **current main:** `f28c35fb` (8 commits ahead, NONE touching BUG-6 files — the PA rebases at land, not you)

---

## 0. WHERE YOU ARE — you are RESUMING, not starting

The chunk-namespacing MECHANISM is COMPLETE and proven on THIS branch (N1 counter-keyed node-ids emission-time; N2/N3/N4 chunk-local scope built; acceptance flips CLOBBERED→isolated under BOTH module formats in real Chromium; D4 artifact-diff gate hardened to 446 files; 673→162 test failures across two migration rounds). Your job is the ONE remaining ruled step: the **BUG-6 accessor-rename**, which is what makes the two pinned tests pass and closes the arc.

**Your authoritative plan is `docs/changes/chunk-namespacing/BUG6-RENAME-SCOPING.md` (in this worktree, `status: current`).** Read it IN FULL first. It is an execution-ready spec: §1 the exact mechanism, §2 the MEASURED size proof, §3 the rename+migration surface, §4 the N3/N4-preservation proof, **§5 the ordered 8-step plan (this is your task list)**, §6 risks. Execute §5 steps 1→8 in order.

## 1. CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (read before any write; re-read before each step)

`PATH-DISCIPLINE INCIDENT COUNT: 0` — keep it 0.

You are working in a RETAINED worktree, NOT a fresh isolation worktree. **`WORKTREE_ROOT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91ad13968b46ab5d`**. Every Read/Write/Edit/Bash targets an ABSOLUTE path under `WORKTREE_ROOT`. NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/<file>` (that is MAIN — a leak). NEVER `cd` into main. Use `git -C "$WORKTREE_ROOT"` for every git op; `bun --cwd "$WORKTREE_ROOT"` for every bun op; worktree-absolute paths for every edit.

**Startup gate (do all, in order; abort + report if any fails):**
1. `cd "$WORKTREE_ROOT" && pwd` → MUST print `.../\.claude/worktrees/agent-a91ad13968b46ab5d`. `git -C "$WORKTREE_ROOT" rev-parse --abbrev-ref HEAD` → MUST be `worktree-agent-a91ad13968b46ab5d`. `git -C "$WORKTREE_ROOT" status --short` → clean.
2. `bun install --cwd "$WORKTREE_ROOT"` (worktrees don't inherit node_modules; the hook fails "cannot find package 'acorn'" otherwise). node_modules is present but re-run to be safe.
3. `bun --cwd "$WORKTREE_ROOT" run pretest` (populates gitignored `samples/compilation-tests/dist/` browser fixtures).
4. Top-level `dist/` is ABSENT in this worktree and the real-Chromium acceptance step needs it: symlink it from main — `ln -s /home/bryan-maclee/scrmlMaster/scrml/dist "$WORKTREE_ROOT/dist"` (ENV-GAP, not a tracked change — do NOT commit the symlink). Verify `dist/scrml-runtime.js` resolves.
5. Use `bun --cwd "$WORKTREE_ROOT" run test` (chains pretest) for suite baselines, NOT bare `bun test`.

Echo `pwd` in your first commit message (`WIP(bug6): start at $(pwd)`). If you ever detect a write landed in main (`git -C /home/bryan-maclee/scrmlMaster/scrml status --short` shows your file), STOP, increment the incident count, reset the leaked file, redo under `WORKTREE_ROOT`, note `PATH-DISCIPLINE INCIDENT` in the commit body.

## 2. MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` (in `WORKTREE_ROOT`) first; follow its Task-Shape Routing to the codegen maps. Map stamp: `commit: e8fdd44c` (content-verified current per S282). **The BUG-6 target files — `codegen/index.ts`, `runtime-template.js`, `emit-client-esm.ts`, `emit-*.ts`, `tests/helpers/chunk-scope.js`, the two BUG-6 tests, `conformance/adapters/impl1-ts.ts` — are UNCHANGED between `e8fdd44c` and current main `f28c35fb`, so the map is current for your surface.** Post-map landings #154 (E-DG-002 attr-interp) and #155 (Stage 3.055 tag-canonicalizer) do NOT touch your surface. Treat map content as a verify-against-source hypothesis if a file moved; report the load-bearing finding.

## 3. THE MECHANISM CLAIMS ARE HYPOTHESES — VERIFY, don't assume

The SCOPING doc's measurements were taken by SIMULATING the rename (stripping core additions), not by running the real rename. Three claims you MUST verify empirically as you build, because the S282 lesson is that a scoped MECHANISM can be subtly wrong even when the SYMPTOM + governing-sentence are right:

- **The 16 KB gzip margin is a KNIFE-EDGE (§2.2, §6 HIGH).** Zero-residue measured at 16,255 B (129 under 16384) — but that margin is SMALLER than the ~200 B gzip whitespace-noise band. After step 4 (strip core), **whitespace-normalize the removal and re-measure the REAL emitted SPA runtime** exactly as `v0-3-x-spa-tree-shake-phase-b.test.js:137` does (compile `SPA_COUNTER`, gzip `scrml-runtime.*.js`, assert `< 16384`). Report the actual byte count. **IF it lands OVER 16384 despite genuine zero-core-residue → STOP and report — do NOT hack bytes, do NOT `--no-verify`, do NOT trim real code to squeeze under.** The PA/bryan decide a budget raise; that is a ruling, not your call. (The ruled fix is zero-residue regardless; the budget is a separate policy question the PA holds.)
- **The ESM crux (§1.3).** Verify against the REAL `emit-client-esm.ts:359-362` import-set computation that the renamed local `_scrml_cs_reactive_get` is a chunk-own-decl (not imported) while the real `_scrml_reactive_get` inside the wrapper IS imported read-only — by compiling the `engine`/`wide` fixtures in `moduleFormat:"esm"` and reading the emitted `.client.js`. No shadow, no TDZ, no IIFE for the accessor mechanism.
- **The post-hoc callee-rename pass MUST be Acorn-based** (§6 MED), renaming the `CallExpression.callee` Identifier (not the key arg), run on the assembled body BEFORE the prologue is prepended (§1.2 ordering), so the prologue's own real-accessor references are never renamed. Regex is unsafe (author strings/comments). The pass's accessor set MUST equal the prologue's `CELL_SCOPE_ACCESSORS` or you get ReferenceErrors (wrapper called, never defined) or dead wrappers.

## 4. CRASH RECOVERY (mandatory) + the WIP-commit gate rule

Commit after EACH of the 8 steps (WIP commits are expected and fine — the branch is your checkpoint). Keep `docs/changes/chunk-namespacing/progress-bug6.md` — append-only timestamped lines: what step just finished, what's next, blockers, the gzip byte count at each measurement. Commit via `git -C "$WORKTREE_ROOT" commit -- <explicit pathspec>`. Do NOT batch.

**WIP-commit gate:** this branch is RED-BY-DESIGN mid-migration (162 known failures; the pre-commit subset bails). **bryan AUTHORIZED `--no-verify` for your WIP checkpoints on THIS branch (`worktree-agent-a91ad13968b46ab5d`) — S283.** So your intermediate WIP commits use `git -C "$WORKTREE_ROOT" commit --no-verify -- <pathspec>`. This authz is SCOPED to WIP checkpoints on this branch ONLY — it is NOT permission to bypass any gate anywhere else, and NOT permission to leave the branch red. **The branch MUST be GREEN by the end:** before you report DONE, run the full pre-commit subset (`bun --cwd "$WORKTREE_ROOT" test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`) and confirm **0 failures** — a non-green final state is a FAIL of this dispatch, not a deferred item. Report the final pass count.

## 5. VERIFICATION BAR (§5 step 8 — all on the FINAL tree, commit-labelled)

1. Acceptance CLOBBERED→isolated, BOTH module formats, real Chromium (`accept.sh` + the 3 fixtures `wide`/`types`/`engine` via `collision-exec.mjs`).
2. BOTH BUG-6 tests green: `c10-error-message-resolution.test.js` (§C10.1 tree-shake) AND `v0-3-x-spa-tree-shake-phase-b.test.js` (the gzip budget) — report the gzip byte count.
3. Full-suite name-diff vs `e8fdd44c`: the authoritative pre-existing base set is **31 unique names** (34 lines / 3 dups — use 31), `base-only-now-passing` must stay **0**. Report new-vs-base.
4. Artifact-diff gate PASS (wrapper + token folds already in `artifact-diff.mjs`) — report the compared file count (must be the hardened 446, not a hollow subset).
5. `E-CG-018` §34 catalog row added WITH the impl (step 7) — mirror `E-CG-015`/`E-CG-016` prose.

**R26 empirical (in addition to the suite):** after the fix, recompile a real adopter `.scrml` in `moduleFormat:"esm"` AND classic and confirm no accessor ReferenceError at load and cells resolve (the mechanism's whole point). Report the command + result.

## 6. WHAT NOT TO DO

- Do NOT run `/code-review` (you can't in-agent; the PA runs the S239 adversarial pass on your diff before landing).
- Do NOT rebase onto main or touch main — the PA hand-does the land + rebase (`e8fdd44c`→`f28c35fb`).
- Do NOT bypass the pre-commit gate (`--no-verify`) — if it blocks on a real regression, fix the regression; if on a pre-existing flake, report it, don't bypass.
- Do NOT migrate a test file by weakening its assertion to pass — the migration makes assertions rename-AWARE (helpers first, §3.3), it does not delete coverage. The `unclassified` bucket produced all 6 bugs so far — treat each as a suspected 7th.

## 7. REPORT BACK

Final branch SHA · files-touched (full list) · the gzip byte count (whitespace-normalized) · both-BUG-6-tests pass/fail · name-diff new-vs-31-base + base-masked count · artifact-diff file count · R26 result · any deferred item · any place the SCOPING mechanism was WRONG and what you did instead.
