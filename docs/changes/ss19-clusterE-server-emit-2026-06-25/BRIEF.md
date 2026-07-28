# Dispatch BRIEF — ss19 CLUSTER-E: server-emit cluster (#8 + #9 + #12)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **opus** · **change-id:** ss19-clusterE-server-emit-2026-06-25 · land-on `spa/ss19` (via sPA cherry-pick).
**BASE: origin/main `26ffea4e`** (standard main worktree). Your base does NOT include the already-landed ss19 fixes (#5/#6b/A1). That's fine — these three findings are ORTHOGONAL to A1 (auth-precedence). In particular #8 edits a DIFFERENT region of `route-inference.ts` than A1's Step-8b auth-middleware change; do NOT try to incorporate A1's work. **The sPA cherry-picks your per-item commits onto `spa/ss19`, 3-way-merging #8's route-inference change with A1's (non-overlapping → auto-merge).** This is why you MUST commit each finding SEPARATELY.

THREE findings that share `emit-server.ts` (must be serial in one agent). Do them IN ORDER, **one commit each** (incremental — crash-recovery + clean cherry-pick). #8 FIRST (most delicate). Reproduce RED first, fix to green, each.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree is the `isolation: "worktree"` path under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.

## Startup verification (BEFORE any other tool call)
1. `pwd`. MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If under any other repo (`scrml-support/...`, `scrml-spa-ss19/...`) STOP and report — CWD-routing failure. Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT. `git remote -v` shows scrml.git (NOT scrml-support).
3. `git status --short` clean.
4. `bun install` (worktrees don't inherit node_modules).
5. `bun run pretest` (gitignored `samples/compilation-tests/dist/`). Use `bun run test` for baselines.
If ANY check fails: STOP, report, exit.

## Path discipline
- S126: edits via Bash (perl/python3/heredoc) on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NOT Edit/Write. Echo path before; `git diff` after.
- NEVER `cd` outside WORKTREE_ROOT; use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`.
- Read only under WORKTREE_ROOT.

## Commit discipline
- ONE commit per finding (3 expected). Coupled code+test = one commit (S113). `git status` clean before DONE. NEVER `--no-verify`.

---

## ITEM #8 — g-pure-fn-rpc-async-unawaited (HIGH) — DO FIRST, S215 GATE

**Repro:** `/tmp/ryan-verify/04-pure-fn-async-unawaited.scrml` — a pure `fn tag(s)->string` is peer-called by server fn `check()`; `check` does `if (row.label != tag(name))`. The compiler RPC-routes `tag` + emits it `async`, and the in-process caller compares the UNAWAITED Promise (`_scrml_structural_eq(row.label, tag(name))` — no `await`) → always unequal → silent-wrong (auth hash never matches → login always fails with a correct password). PA-CONFIRMED on 26ffea4e.

**⚠ CROSS-CHECK FIRST (do NOT re-fix blindly):** the server-fn→server-fn peer-call lowering was recently reworked — **commit `b2bf9959` (S217, the adopter PR#1)**. The S215 F1/F3 defects (landed-green-then-reverted) were in THIS EXACT area. Before changing anything: `git show b2bf9959 --stat` + read the peer-call lowering it landed. Determine empirically whether `check()`'s in-process call to `tag(name)` is currently awaited or not (compile the repro, inspect `04-...server.js` — is there an `await` on the `tag(name)` call site inside `check`, or only on the RPC-stub path?). The repro shows an `await (async () => {...})` wrapper EXISTS somewhere — confirm whether it covers the in-process peer call or only the outer handler.

**Fix (pick per what the cross-check shows):** the issue allows EITHER (a) a pure fn used purely in-process stays sync/inlined (no RPC, no async) OR (b) the caller's peer-call site gets `await` threaded in. Choose the one consistent with the b2bf9959 lowering (don't fight it). A silent unawaited-Promise comparison must never remain.

**S215 ADVERSARIAL GATE (mandatory for #8):** beyond the happy-path repro, construct adversarial fixtures: pure fn returning a value compared with `==`/`!=`/`is`; pure fn whose result is used in an `if`, a return, a string-interp; pure fn called BOTH in-process AND via a real client RPC (must stay correct on both paths); chained peer calls (fn calls fn). Random-sample QA. Land only if all hold.

**Verify:** repro `check()` now compares the resolved value (awaited or sync), not a Promise; full `bun run test` GREEN 0-regress (the route-inference / emit-server / channel suites are high-signal); R26.

## ITEM #9 — g-db-src-compile-vs-runtime-path (MED)

**Repro:** `/tmp/ryan-verify/proj-auth/` — `app.scrml` (root) uses `src="./m.db"`, `pages/login.scrml` (subdir) uses `src="../m.db"`; both resolve to the same file at compile (file-relative) but the literal is emitted verbatim into `new SQL("sqlite:<src>")` and opened cwd-relative at runtime → run from root, login opens `../m.db` (parent, fresh empty DB) → "no such table". RYAN-ISSUES #05.

**Fix:** resolve `<db src>` CONSISTENTLY across compile-time (protect-analyzer / pre-analysis) and runtime (the emitted `sqlite:` literal) — project-root-relative (or bundle-location-relative), so a multi-dir project's pages and entry open the SAME file at runtime. Loci: the db-resolver + `emit-server.ts` SQL-literal emission. Don't break single-dir projects (the common case) or the E-PA-002 file-existence check.

**Verify:** both `app.scrml` and `pages/login.scrml` emit a `sqlite:` literal that resolves to the SAME db at runtime from the project root; existing single-dir db tests unaffected; full suite green; R26.

## ITEM #12 — g-sql-in-arrow-body-invalid-js (MED)

**Repro:** `/tmp/ryan-verify/08-arrow-sql.scrml` — a `?{}` SQL block inside an arrow-function body (`const ins = (x) => { ?{...}.run() }`) → **E-CODEGEN-INVALID-JS** (CONFIRMED, sPA R26). The emitted server fragment mangles the arrow body around the `?{}` lowering.

**Fix:** lower `?{}` correctly inside an arrow-function body (emit-server / the `?{}` SQL-lowering path), OR — if correct lowering is out of reach — reject the shape with a precise actionable diagnostic (NOT "please report a compiler bug"). Prefer correct lowering. Note: arrow bodies may need the same async/await handling regular fn bodies get for `?{}`.

**Verify:** `08-arrow-sql.scrml` compiles clean (no E-CODEGEN-INVALID-JS) and the emitted server JS parses (`node --check` / `new Function`); the `?{}`-in-regular-fn path still works; full suite green; R26.

---

## Cross-cutting
- 0 regressions vs your startup baseline on `bun run test` (report baseline + after each item).
- **FLAG any shared corpus/snapshot/integration baseline you shift** (e.g. trucking-dispatch-smoke — A1 already touched its W-AUTH-001 baseline; if your changes shift it further, call it out so the sPA reconciles).
- A pre-existing flake exists: `trucking-dispatch-smoke chunks.json manifest` under full-suite concurrency — if you see it, re-run in isolation to confirm it's the flake, not your change.

## Scope boundaries
- ONLY #8, #9, #12. Do NOT touch the auth-precedence (A1, landed), render-codegen (Group B), or the generate-redirect (#14, separate dispatch).
- If any item's blast radius exceeds its locus, or #8's b2bf9959 cross-check shows it's already correct (NOT-REPRODUCED), STOP that item, report, continue the others.

## Report back
Per item: commit SHA · red→green · emitted-JS before/after · #8: the b2bf9959 cross-check finding + which fix path (a vs b) + S215 adversarial results · baseline/after test counts · `git status` clean + agent branch + tip SHA.
