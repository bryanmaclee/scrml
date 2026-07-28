# DISPATCH CONTEXT
You are `scrml-js-codegen-engineer` on a scrml compiler-source fix. Baseline: scrml `main` @ **`89db7981`** (v0.7.1). You work in an `isolation: "worktree"` checkout. Model: opus.

# MAPS — REQUIRED FIRST READ + currency note
Read `.claude/maps/primary.map.md` §"Task-Shape Routing" (compiler-source codegen fix) FIRST, and report the Maps line in your final report ("load-bearing finding: …" or "not load-bearing").

⚠️ **The map is STALE.** It is stamped `c700c435` / 2026-07-27T11:15Z; HEAD is `89db7981`, **12 compiler/src commits ahead**. Treat every map claim as a STARTING HYPOTHESIS and verify against current source with grep/Read. Post-map landings that touch codegen and may have moved your loci:
`#215` Wave-1c cross-chunk soft-nav (chunk loader + runtime-template) · `#214`/`#218`/`#222`/`#226`/`#227` the per-item + nested-`<each>` reconcile family (`emit-each.ts`, `emit-lift.js`, `emit-variant-guard.ts`, `binding-registry.ts`) · `#224` `tabSpan→span` in `api.js` · `#209` `E-SQL-003` in `ast-builder.js` · `#206`/`#208`/`#217` schema/db-migrate. `#236` was a comment-only privacy scrub — no behavior change, but it DID touch comments in `schema-differ.js`, `db-migrate.js`, `emit-server.ts`, `emit-client.ts`, `tenant-egress.ts`, `type-system.ts`; do not read those diffs as logic changes.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
S99 had FOUR path-discipline leaks and S126 had FOUR Edit/Bash-divergence leaks. Hold the line.
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it resolves under ANY other repo (e.g. `scrml-support`) → **STOP and report** (the S90 CWD-routing failure). Save it as `WORKTREE_ROOT`.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git -C "$WORKTREE_ROOT" status --short` MUST be clean.
4. `git -C "$WORKTREE_ROOT" merge main` — your base may be a session-start snapshot; merge current main (expect clean/fast-forward).
5. `cd "$WORKTREE_ROOT" && bun install` — worktrees do NOT inherit `node_modules` (the hook fails "cannot find package 'acorn'" otherwise).
6. `bun run pretest` — populates the gitignored `samples/compilation-tests/dist/` browser fixtures (~130 ECONNREFUSED-shaped failures without it).
7. Your FIRST commit message MUST embed the verbatim `pwd`: `WIP(<task>): start at <pwd>`.

## Path discipline (MANDATORY)
- Apply ALL source edits via Bash (`perl -i -pe` / `python3` / `cat > heredoc`) on WORKTREE-ABSOLUTE paths containing the `.claude/worktrees/agent-<id>/` segment. Do NOT use Edit/Write on source files — they have leaked to MAIN before. Echo the target path before each write; re-verify with `git -C "$WORKTREE_ROOT" diff` after.
- NEVER `cd` into the main repo or outside `WORKTREE_ROOT` for writes/installs/compiles. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths. Reading from main is READ-ONLY and fine.

# COMMIT DISCIPLINE (two-sided)
After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` → `add` → **commit immediately**. Do NOT batch — the branch is your crash-recovery anchor. Keep an append-only `progress.md` (timestamped: what was just done, what's next, blockers). Before reporting DONE, `git -C "$WORKTREE_ROOT" status` MUST be clean. **Never `--no-verify`** — if the pre-commit gate fails, STOP and report; do not bypass and do not override `core.hooksPath`.

# PHASE 3 — R26 EMPIRICAL VERIFICATION (MANDATORY before DONE)
Synthesized-input tests pass while the real path stays broken — that is exactly how these three defects reached an adopter. Before claiming DONE you MUST re-compile a real reproducer on your POST-FIX baseline and confirm the named symptom is gone AND no new symptom appears. **"Tests pass" is NOT the check** — the check is the bug-specific symptom grep/execution named in your task below. **DO NOT mark DONE without R26 passing.**

⚠️ **EXECUTE, don't grep.** All three of these bugs emit text that *looks* right and fails at runtime. Where the task says "execute", load the emitted bundle (happy-dom or `node`) and confirm behaviour — a marker being present in the output has repeatedly been a false green (S265 theme-switch, S268 `((hi))`, S278 U3).

# REPORT (final message, structured)
`WORKTREE_PATH` · `BRANCH` · `FINAL_SHA` · `FILES_TOUCHED` · `REGRESSION-TESTS-ADDED` (file + count) · `R26-RESULT` (the actual compile/execute evidence, not a claim) · `STOPPED?` (if the fix risks regressing an adjacent shape, STOP and report the survey rather than force it) · `MAPS-FEEDBACK`.

---

# LANE 1 — CLIENT-BOOT BLOCKERS (GH #234 + #235, + fold in D-4)

**Both bugs write `compiler/src/codegen/index.ts`. They are ONE dispatch by construction — do not split them, and no sibling dispatch may touch that file while you hold it.**

An adopter (the `dc` port, ~10.2k lines, scrml `0.7.1`) is **hard-blocked**: login is unusable in a browser while every server route is green. Both defects surfaced the first time their bundles were executed in a browser rather than exercised over `curl`.

## BUG A — #234: `<errors of=…/>` call site survives, its runtime chunk is tree-shaken away

**Symptom (adopter-verified, network-captured):**
```
ReferenceError: _scrml_message_for is not defined
    at _scrml_cs_message_for (login.client.js:19:44)
    at HTMLDocument._scrml_boot (login.client.js:266:7)
```
The throw is **inside `_scrml_boot`**, so boot aborts before any event handler binds. Fill the login form, click Sign in → **zero network requests**. Server side is entirely correct via `curl`.

**Net: any page carrying an `<errors of=…/>` cannot bind its event handlers.**

**Minimal repro (adopter-verified, 10 lines):**
```scrml
<page>
  ${
      <signupForm>
          <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
      </>
  }
  <form>
    <input type="email" value="${@signupForm.email}"/>
    <errors of=@signupForm.email/>
  </form>
</page>
```
Compiles: 1 file, 0 errors, 1 warning. Then the call site exists and the definition does not — across BOTH `app.client.js` and the emitted runtime chunk.

**Fix locus (PA-located, verify):** `compiler/src/codegen/index.ts` carries a runtime-symbol keep-list — `"_scrml_message_for"` at ~L495 and a companion arity/shape entry at ~L528. `compiler/src/codegen/runtime-chunks.ts` owns the chunk partitioning (its header documents `_scrml_messages_register_inline` / `_scrml_message_for`). The `<errors>` emitter is `emit-form-for.ts` + the `_scrml_cs_message_for` wrapper emission. The defect is the **keep-list / emitted-call-site disagreement**: something emits the call without marking the chunk live.

**Do NOT fix by always shipping the messages chunk** unless you first establish that demand-marking is infeasible — that trades a correctness bug for a payload regression against the §C10.1 tree-shaking budget, and the gzip budget is already knife-edge (`g-spa-runtime-gzip-budget-knife-edge`, HIGH/open). Prefer: the `<errors>` emitter marks the messages chunk as required.

**R26 (must EXECUTE):** compile the 10-line repro; then load the emitted bundle and confirm `_scrml_boot` completes and an event handler actually binds and fires. Grepping for `function _scrml_message_for` is necessary but NOT sufficient.

## BUG B — #235: child pages inherit the shell's bundle but not its transitive module `<script>` tags

**Symptom (adopter-verified):** every page **except the shell's own route** throws at the top of the bundle IIFE:
```
TypeError: Cannot destructure property 'rolePath' of '_scrml_modules.models/auth.client.js' as it is undefined
    at app.client.js:5:9
```
Client boot is dead app-wide.

**Evidence:**
```
dist/app.html      →  runtime.js · models/auth.client.js · app.client.js            ✅
dist/login.html    →  runtime.js ·                         app.client.js · login.client.js   ❌
dist/patron.html   →  runtime.js ·                         app.client.js · patron.client.js  ❌
```
`dist/models/auth.client.js` is emitted correctly, serves 200, and self-registers into `_scrml_modules` — it is simply **never loaded** on child pages. Adopter-verified workaround: hand-inserting `<script src="models/auth.client.js">` before `app.client.js` fixes it completely (a `dist/` edit, wiped on recompile).

**Fix locus (PA-located, verify):** `computeDependencyClientScripts` is defined at `compiler/src/codegen/index.ts:339` and called at `:2229`. The shell's own route gets the ordering right, so this is an **omission in the child-page emit path**, not a missing feature. Establish why the shell path computes the transitive set and the child path does not.

**Ordering is load-bearing:** the module must be emitted BEFORE the bundle that destructures it. Assert order, not just presence.

## FOLD IN — D-4 / widen `g-crossfile-dep-ref-pages-unstripped` (MED, S265)

Same emitter neighbourhood, same `pages/` coordinate space; it must NOT run as a concurrent dispatch.

Page cross-file imports emit in the **unstripped `pages/` coordinate space**, so `dist/login.server.js` imports `"../models/auth.server.js"` and walks above `dist/`. The existing gap entry is scoped to `computeDependencyClientScripts` (client `<script src>`) and explicitly records *"NOT biting assetManagement (single-segment `pages/`)"* — **the dc page is ALSO single-segment and breaks anyway**, because the failure is on the **server-side ESM import path**. Same root cause, second emitter, biting the case the entry marks safe.

Widen the gap entry (do not file a duplicate) and fix the server-side emitter alongside the client-side one if they share the coordinate computation. If they do not, say so and fix only what is in scope.

## STOP-IF
- The messages-chunk fix cannot be done by demand-marking and would require always-shipping the chunk → STOP, report the payload delta measured against the gzip budget, and let the PA rule.
- The child-page fix requires changing the emitted `<script>` ordering contract for existing adopters → STOP; that is a newly-rejecting/semantics-changed direction and needs a ruling.
