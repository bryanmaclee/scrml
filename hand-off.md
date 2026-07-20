# scrml — Session 271 (bryan) — WRAP

**Date:** 2026-07-19. A long adopter-bug + deliberation session: recovered the stranded **S269** continuity, landed **two giti adopter fixes** (GITI-038 #111, GITI-039 #113), and fully **ruled the tenant-scoping-floor** design (Peter's S270 seed → all forks ratified; build teed up as a fresh V1 arc). Concurrent with **S270-peter** (Windows adopter lane, wrapped #112 mid-session; disjoint).

## ⚠️ READ FIRST — state as of close
- **scrml main = `df2ac831`** (#113 GITI-039 on top of #112 [Peter's wrap] + #111 [GITI-038] + #110/#108 [S269]). CI `gate` GREEN at HEAD. Conformance **741/741**. Coherence 0/0 both repos.
- **The mechanical record is honest again.** S269's #108/#110 lands + this session's #111/#113 + the tenant ruling are in `handOffs/delta-log.md` (`[625]`+), `docs/changelog.md` (S271 + S269 blocks), `master-list.md` §0. **Do not re-derive from those — read them.**
- **No open PRs, no open adopter issues** (#27 navigate is the only prior one, bryan's navigate arc, still open). Both giti bugs (038/039) fixed + giti notified; inboxes drained to `read/`.

## 🎬 WHAT LANDED (detail in changelog S271/S269)
1. **S269 RECOVERY** — S269 (bryan) landed #108 (colorless-async Seam-A Phase-1, GITI-037 fixed) + #110 (Phase-2 combinator FORK-1) but died before wrapping (the 3rd unwrapped-death; S266→S268→S269). Record reconstructed this session.
2. **GITI-038 → #111 (`72ba19d6`)** — returned named-fn-expr async closure now TRANSFORMS (`return async function name(){await…}`, outer non-async). bryan ruled transform-not-reject. **The S239 round-1 pass caught a BLOCKING web-app regression a green suite shipped** (the returned fn moved into a new `return-stmt.fnExprNode` invisible to ~10 analysis passes → server/client split silently broke); bryan ruled "complete it" → round-2 made all `return-stmt` consumers descend into `fnExprNode`; round-2 clean w/ a security PASS. Rows 4/5 (arrow/const-bound) deferred → `g-async-closure-body-raw-no-lower`.
3. **GITI-039 → #113 (`df2ac831`)** — literal markup text inside ternary/dynamic-markup was expression-lexed (`a.txt`→`a . txt` silent; punctuation→E-CODEGEN-INVALID-LOGIC). Fixed at the `joinWithNewlines` rejoin (span-adjacency, scoped `angleDepth>0` so pure-expr is byte-identical) + a companion `;`-guard. S239 clean (948-sample byte-identity). Filed `g-collectexpr-keyword-lt-angledepth` (LOW pre-existing).

## ⭐ TENANT-SCOPING FLOOR — DESIGN RULED, BUILD IS THE NEXT ARC
Peter's S270 adopter-driven seed (aM multi-tenant RBAC C1 leak) → a compiler-enforced tenant-scoping floor, the **row-level twin of §14.8.9 `protect=`**. Went through a full DD + an R3 enforcement debate. **bryan RULED every fork** (authority: `scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md`, RULINGS banner; design insight recorded):
- **Q1 GO** · **B** session-derived key `@currentUser.tenantId` (consume-not-derive — the crux; the app pins it via `session.set`, the floor never computes it) · **A3** `tenant_id` column-convention (fail-closed-by-default) · **C** HYBRID — **redaction is the guaranteeing floor**, injection is the optimization + the mandatory mechanism for aggregates-without-discriminator + writes (inject-or-hard-fail `E-TENANT-*`/`E-TENANT-AGG`); `.acrossTenants()` is the sole loud opt-out · **D** clean 4th confidentiality axis (owed note: tenant-filter the §38.13 `watches=` frame per-subscriber).
- **FREEZE:** the **redact floor + hard-fails is V1-minimal** (a 2nd security-feature exception like CSS; reuses the shipped §14.8.9 sink, NO new WHERE-parser); the **inject optimization is v1.next** (needs a WHERE-parser — the `OR`-precedence hazard).
- **NEXT (the fresh V1 arc):** a SPEC amendment first — a tenant-floor Nominal section + the `E-TENANT-*` codes + §14.8.9/§52/§38.13 cross-amendments (the §14.8.9 "designed-before-built" pattern) — then the V1-minimal redact-floor impl. Peter has been notified the ruling landed.

## 🔬 ANOMALIES / WHAT TO WATCH
- **"green ≠ landable" held for the 3rd+ time.** The S239 adversarial pass caught a BLOCKING web-app regression on GITI-038 that a fully-green suite shipped (the `fnExprNode` completeness gap) — the same class as the S265 theme-DOA + S268 dead-page. **The mandatory PA-side S239 pass on every compiler-source land is non-negotiable; run it even on our own dispatches, and probe the BLAST RADIUS, not just the fix.** GITI-038 also confirmed: verify by EXECUTING the emitted bundle, not grepping it.
- **Transient dispatch API errors are real + recoverable.** The GITI-039 fix agent died on `ENOTIMP` before doing any work (worktree auto-cleaned); a fresh re-dispatch succeeded. 1 crash → re-dispatch; ~2 → PA-direct.
- **Config-B post-commit hook + the 2-min tool default.** A foreground `git commit` finalizes (pre-commit passes) but the config-B POST-commit full-suite runs after → a 5-min tool timeout fires DURING it. Always verify git STATE (`git show --stat`), never the exit code. Same for `git rebase` (it re-runs the pre-commit hook on replayed commits → use the server-side `gh api …/update-branch` REST endpoint when a branch is BEHIND, not a local rebase).
- **scrml-support drifts under concurrent Peter.** Every board/doc push this session hit ≥1 non-fast-forward from Peter's machine → `pull --rebase` then push. Routine, but always rebase-before-push on scrml-support.

## 🚦 OPEN THREADS / NEXT — `bun scripts/threads.ts --open`
- **⭐ TENANT-FLOOR BUILD** (the fresh V1 arc above) — SPEC amendment → V1-minimal redact-floor impl. bryan's lane (security/freeze).
- **Freeze campaign** (the standing V1 work): the thread-board's open items (5 §34 forgotten-half reconciliations · E-SQL-004 corpus disposition [RULED opt-B] · ss75 conformance authoring). Read `bun scripts/threads.ts --open`.
- **giti/adopter lane** (Peter's, his machine) — currently empty of open issues.
- **#27** navigate soft-nav (bryan's navigate arc) — still open, untouched this session.
- **Owed (carry):** the **stale-worktree sweep** — 42 worktrees (9 sPA `spa/ssNN` + ~30 prior-session `agent-*`; this session's 2 [ae4f66278ab966a0b #111, ada9ce23cd0fe0295 #113] cleaned at wrap 6b); the #81 ② held axiom (bryan-gated); the S269-era held branches if any.
- **Held branches (do NOT clean):** none new this session; the S268-listed `feat/colorless-async-seam-a`@`211ab331` is SUPERSEDED (Phase-1/2 landed via #108/#110) — retire-eligible.

## 🔀 CONCURRENT S270-peter (Windows adopter lane — LIVE)
Wrapped **#112 (`204b1897`)** mid-session (dogfood + a scrml-version-pin bump + committing his tenant-floor seed; no compiler change). Disjoint from bryan's compiler/deliberation lane by construction. His board `S270-peter.md` reads LIVE (a checkpoint-wrap; session continues per Peter).

## pa.md directives in force
PR-flow (branch→PR→cloud `gate`→merge on explicit authz; only `gate` gates — required-context confirmed = `gate`) · **S239 mandatory adversarial pass on EVERY compiler-source land** (caught a blocking regression AGAIN this session) · **EXECUTE-don't-grep for client-runtime verify** · **security/foundational-axioms build only when bryan rules** (tenant floor = exemplar: seed→DD→debate→ruled) · reproduce-before-dispatch (R26 both directions) · verify git STATE not exit code (post-commit-hook timeout) · scrml-support rebase-before-push under concurrent Peter · orchestrate-don't-grind + default-GO.

## Tags
#session-271 #recovery-of-s269 #GITI-038-returned-closure-transform-LANDED #GITI-039-markup-text-verbatim-LANDED #s239-caught-web-app-regression-again #tenant-floor-RULED-all-forks #tenant-floor-hybrid-redact-floor #tenant-floor-build-is-next-V1-arc #concurrent-s270-peter #conformance-741
