# BRIEF — inline `?{}` SQL inside a conditional branch isn't CPS-split

> Archived per pa.md S136. Dispatched S152 2026-06-01 as `isolation:worktree` + `run_in_background` to `scrml-js-codegen-engineer` (opus). Agent ID `a8ceba2fdd08a56b4`. Surfaced via the Teej `req.scrml` comparison + user dogfooding (inline SQL in match arms). PA scope probes P1/P2/P3 established it's a tractable boundary-recognition extension, not the deferred A9 Ext-3 rework. Verbatim `prompt:` below.

---

# TASK: inline `?{}` SQL inside a conditional branch isn't CPS-split (change-id: `inline-sql-in-branch-cps-2026-06-01`)

Surfaced S152 (user dogfooding — writing inline SQL in `match` arms instead of named functions). Confirmed by PA probes. **Compiler-source codegen/body-split fix.**

## THE BUG (PA-confirmed empirically)
Inline `?{}` SQL inside a JS-style **`match`-arm body** OR an **`if` branch** inside a CLIENT handler is NOT recognized as a server-call boundary by the body-split / CPS planner. Result:
- In a `match` arm → the `?{...}` is emitted RAW (the literal scrml token) into the JS → `E-CODEGEN-INVALID-JS` (e.g. `(_scrml_match_10 === "add") { ?{ insert into todos ... }`).
- In an `if` branch → the whole function gets server-escalated → a following `@cell = ...` write trips `E-RI-002`.

**PA scope probes (HEAD `5082ff3c`) — this is the load-bearing evidence:**
- **P1 (works):** `?{}` at the TOP LEVEL of a client `function` → compiles + lowers fine. So `?{}` IS recognized as a server boundary at top-level.
- **P3 (works):** a server-FUNCTION call (`save()` where `save` contains `?{}`) inside a `match` arm → compiles + CPS-splits fine, and a following `@cell = ...` stays client-side. **So the conditional-tier CPS machinery EXISTS and works for function-call boundaries inside branches.**
- **P2 / match-arm (broken):** inline `?{}` (not wrapped in a fn) inside an `if` branch → `E-RI-002`; inside a `match` arm → `E-CODEGEN-INVALID-JS`.

**Conclusion:** the gap is that an **inline `?{}` SQL node inside a conditional branch isn't fed into the same server-call-boundary / CPS-split path** that (a) top-level `?{}` and (b) server-function-calls-in-branches already use. The fix EXTENDS boundary-recognition; it is NOT the deferred A9 Ext-3 conditional-tier rework (that machinery is present — P3 proves it).

## PHASE 0 — SCOPE CONFIRMATION (MANDATORY; report before building if it balloons)
Before implementing, confirm the hypothesis by locating where the body-split / CPS planner decides "this statement/expr is a server-call boundary" (likely `cps-batch-planner.ts` + the body-DG construction + the server-escalation/boundary detection; grep for how `?{}` / sql nodes are classified at top-level vs how server-function-call nodes are classified inside branches). Reproduce P1/P2/P3 in your worktree.
- **If** the gap is genuinely "inline `?{}` in a branch isn't classified as a server boundary the way top-level `?{}` and branch server-fn-calls are" → it's a tractable boundary-recognition extension; proceed.
- **If** it turns out recognizing inline `?{}` in branches actually requires the DEFERRED conditional-tier / multi-batch CPS rework (i.e. P3's machinery does NOT generalize to `?{}` without substantial new planning) → **STOP and report your findings** (do not build the big arc). Per pa.md "don't pre-classify a fix as surgical" — confirm the scope is what the probes suggest before committing.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` in full; §"Task-Shape Routing" for codegen / body-split. Maps reflect `09f74bee`; verify against HEAD `5082ff3c`.

## CRITICAL — STARTUP + PATH DISCIPLINE (S99/S126)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`; else STOP (S90). Save WORKTREE_ROOT. 2. `git rev-parse --show-toplevel`==WORKTREE_ROOT. 3. `git status --short` clean. 4. `git merge main` if base stale. 5. `bun install`. 6. `bun run pretest`.
- ALL edits via Bash (perl/python/heredoc) on WORKTREE_ROOT-absolute paths incl. the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write tools (they leak to MAIN). Echo path before each write; `git diff` after. NEVER `cd` into main; use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`.
- First commit msg includes verbatim `pwd`: `WIP(sql-in-branch): start at <pwd>`. Commit per-step; `git status` clean before DONE; write `docs/changes/inline-sql-in-branch-cps-2026-06-01/progress.md` per step.

## THE FIX (after Phase 0 confirms)
Make an inline `?{}` SQL node inside a conditional branch (JS-style `match` arm body + `if`/`else` branch; ideally also loop bodies if it falls out for free) be treated as a server-call boundary by the body-split/CPS planner — routed through the SAME CPS-split that a server-function call in that position already gets (P3). The surrounding client statements (`@cell = ...` reactive writes, `@output = ...`) must stay client-side as the continuation (NOT escalate the whole fn → no spurious `E-RI-002`). Mirror the top-level `?{}` lowering (P1) + the in-branch server-fn-call CPS (P3). Do not regress: top-level `?{}` (P1), server-fn-call-in-arm (P3), the named-function form (the current working idiom — `function f(){ ?{} }` called from an arm), single-`?{}` functions, the block-form `<match for=Type>` paths.

## PHASE 3 — EMPIRICAL R26 (MANDATORY — pa.md S138)
Compile these on your post-fix baseline + assert no `E-CODEGEN-INVALID-JS` / no spurious `E-RI-002`, and the `?{}` actually CPS-splits (a server round-trip emitted; `@`-writes client-side):
1. **The user's inline repro** — `/tmp/req-clean.scrml` shape (recreate it; it's a todo with `?{}` insert/update/delete inline in `match` arms of a client `run()` handler — list/add/done/delete). Was `E-CODEGEN-INVALID-JS`; must compile + the client.js parse as a classic script (`node -e 'new (require("vm").Script)(fs.readFileSync(F))'`).
2. **P2** — `?{}` in an `if` branch + a following `@cell` write → no `E-RI-002`; CPS-split.
3. **Regression** — P1 (top-level `?{}`), P3 (server-fn-call-in-arm), and `examples/22-multifile` + a named-function todo all still compile clean.
Show the emitted JS proving the `?{}` lowered to a server call (e.g. a `_scrml_fetch`/`__ri_route`/SQL-stub) inside the arm continuation, NOT raw `?{...}`.

## TESTS
- Add codegen unit tests: inline `?{}` in a `match` arm + in an `if` branch lower to a server-call boundary (assert the emitted shape + `vm.Script` parse); a following `@cell` write stays client-side (no RI-002). Regression-guard the named-function form + top-level `?{}` + server-fn-in-arm.
- Full pre-commit subset — 0 regressions. If you touch the body-DG / batch planner, run the broader suite (the CPS/batch tests + within-node parity are sensitive).

## REPORT
- WORKTREE_PATH + BRANCH + FINAL_SHA. FILES_TOUCHED.
- **Phase 0 finding** (scope confirmed tractable, or ballooned → stopped).
- R26 results (the 3 checks + emitted-JS snippet showing the `?{}`→server-call lowering in the arm).
- Test counts before/after + new tests. Maps feedback.
- Confirm no regression on P1/P3/named-fn/block-`<match>`.
- Any path-discipline incident (self-report).
