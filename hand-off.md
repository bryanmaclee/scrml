# scrml — Session 248 (WRAP — no push; branch-baton to S249)

**Date:** 2026-07-09→11. **Profile:** A (full, `/boot`). The LEADING PA of a concurrent pair (S249 = concurrent, branch-isolated on `s249`). **Enormous session** — booted into the un-wrapped S244→S247 chain, took over S247's footprint, then drove the V1 conformance-freeze frontier hard. **Wrapped no-push per bryan** — 3 commits are LOCAL-only on main; the rest pushed. On this wrap I inbox-signal S249 to merge `s249`→main + take the baton.

## ⚠️ READ FIRST
- **PUSH STATE:** origin/main = `a37f11e0` (oracle 305). Local main = `304b00cc` (oracle 310). **3 unpushed local commits:** `701b7e00` theme-divergences · `e9a9473d` E-AUTH-001 · `304b00cc` #26 P0 auth-bypass. Push is HELD (bryan "no push"). Everything ≤ a37f11e0 is on origin.
- **CONCURRENT S249 (branch-baton):** S249 is LIVE on branch `s249` (worktree `.claude/worktrees/s249`, cut off cfcde3d0), doing REPORT-ONLY verify-harden (engine/reactive/forms/error §19). It is 17 commits ahead on its branch, 3 behind main (my last 3). **On this wrap: signal sent to S249's inbox → S249 UTDs `s249` with main, merges → main, becomes leading, pre-cuts S250.** S249's verify-harden divergences will need bryan fix-vs-amend rulings (like the 6 I fixed).
- **🔴 HIGH open — Finding 1 (JWT auth-bypass, from #26's S239 review):** `scrml:auth` verifyJwt/signJwt/verifyJwtJwks STILL emit UNAWAITED in server fns → same bypass class as #26 (accept-all / `[object Promise]` token). Root cause SEPARATE + PRE-EXISTING: the **block-splitter DROPS jwt.scrml's entire export set** (its multi-line `!{}` failable-handler blocks trip "statement boundary not detected") → the seed never sees isAsync. Main has it too. Needs a block-splitter fix (multi-line `!{}` in jwt.scrml). **File as an issue + fix early** — security.
- **Open issues on origin (Peter/pjoliver11, Windows dogfood):** #26 P0 auth-bypass = FIXED (local `304b00cc`, unpushed). #25 Windows nested-page 404 (`pathFor` `\` vs `/` — clean fix: normalize separators). #27 `navigate()` soft-nav spec-only (§20.1-20.3 vs runtime full-reload — DESIGN call: implement soft-nav+router OR reconcile SPEC).

## ✅ LANDED THIS SESSION (S248) — conformance 236 → 310 (+74 cases)
| Arc | commits | push |
|---|---|---|
| **Editor arc** (S247 inherited): neovim+vscode grammar · LSP semantic-tokens (MED context-leak found+fixed in review) | `7dfc3df8` · `fbb4d9fd` | pushed |
| **URL-`//` compiler fix**: bare URLs in CSS `url()` / markup prose / match+engine arm compile (was E-CTX-003; found via LSP dog-food; SPEC §27-preserving URL-exemption) | `89bc9361` | pushed |
| **Conformance breadth**: realtime §38.13 (+14) · §61 endpoint (+14) · §23.5 **capability BUILT** (V1-floor: was SPEC-only+fail-open; +8) · auth §52/§40.1.1 (+12) · CSS §65 Wave-1 (+14) | `b1b3a7b2·29813aa7·cfcde3d0·467751bb·a37f11e0` | pushed |
| **6 divergences fixed** (impl-vs-SPEC, conformance-surfaced): static-eval §53.4.2 · maps §59.11/§59.7/§59.4 · diag-precision §61.4-arm/§51.0.M-onTimeout | `d19c8a74·115f4e53·205a67b3` | pushed |
| **E-AUTH-001** client-local-leak guard (was SPEC-only) — boundary: top-level `?{}` write leaks, in-fn is safe (CPS marshals) | `e9a9473d` | **LOCAL** |
| **theme §65.9/§65.10 divergences**: misplacement→E-STRUCTURAL-ELEMENT-MISPLACED · name-collision→E-NAME-COLLIDES-RESERVED (wired from 0-fire-site) | `701b7e00` | **LOCAL** |
| **#26 P0 auth-bypass**: auto-await imported async stdlib in server fns + FAIL-CLOSE the sync-callback silent leak (new E-ASYNC-STDLIB-IN-SYNC-CALLBACK) | `304b00cc` | **LOCAL** |

## 📋 NEXT-START / OPEN THREADS
1. **PUSH** the 3 local commits (theme · E-AUTH-001 · #26) once bryan authorizes — or S249 folds them into its merge+push. Coherence target 0/0.
2. **Finding 1 (JWT leak, HIGH)** — file + fix (block-splitter multi-line `!{}` in jwt.scrml). Security.
3. **Issues #25 (Windows pathFor) + #27 (navigate soft-nav design)** — #25 clean, #27 needs a design ruling.
4. **S249's verify-harden divergence backlog** — engine/reactive/forms/error §19 GAPS+DIVERGENCES → bryan fix-vs-amend rulings, then fix (the divergence-batch pattern worked clean).
5. **Residual backlog** (surfaced, non-blocking): regex `string.pattern(/re/)` static-eval (asIs parse gap) · non-reactive local-map enum-key after `m=m.insert()` reassignment · `<onTransition>` markup-locus + onTimeout/onIdle in `<match>` arm · bare non-URL `//` in markup prose fails E-CTX-003 (§27-compliant — a §27 UX Q) · component-body `<theme>`/`<schema>`/`<onTimeout>` general structural-recognition gap · full §4.15 reserved-name list unwired (scoped to §65) · E-SERVER-FN-IN-SYNC-CALLBACK has no §34 row (codegen-internal-code gap).
6. **Harness verbs owed** (conformance runtime coverage): the RATIFIED (b) synthetic server-push `__change`-frame contract-verb (build deferred — unblocks realtime/broadcast/SSE runtime) · endpoint foreign-inbound-request verb + response-envelope axis · per-case `compilerSettings` channel (capability §28 + the #26 runtime bypass-closed case need it).
7. **Capability §23.5 enforcement (§23.5.6)** — deferred per N1 (manifest + sandbox); declaration half is done.

## 🧭 METHODOLOGY / ANOMALIES (the irreducible)
- **STALE-DOC no-op class (banked → memory `feedback_verify_work_not_done_before_dispatch`):** 3 conformance dispatches (ss58/ss62/E-ADAPTER) were NO-OPS — the spa-list `[status=pending]` markers + progress files run STALE; the corpus was already done. **Plan conformance from actual landed cases + `bun conformance/run.ts` + git, NEVER the markers.** The redirected ss62 verify-pass then found 2 real gaps + 4 divergences — verify-HARDEN > assume-unauthored (S249 now runs this model).
- **E-AUTH-001 boundary (load-bearing):** "outside a server fn" = TOP-LEVEL `?{}` write; a client-local `@var` in a `?{}` write INSIDE a fn is SAFE (the §12.2 CPS-split marshals it server-side; locked by inline-sql-in-branch-cps §2/§4). The agent self-caught an over-broad v1.
- **#26 adversarial S239 earned its keep:** the reviewer found 2 residual leaks the fix-agent's self-verification missed (Finding 1 JWT pre-existing; Finding 2 sync-callback silent leak — folded fail-closed). ADVERSARIAL review on security/codegen is mandatory, incl our own.
- **Multi-fix same-file land discipline:** the 6 divergence fixes + E-AUTH-001 all touched type-system.ts/ast-builder.js in DISJOINT regions → landed via `git apply --3way` of the hunks (NOT clobber-file-delta) + combined-gate-verify per land (S226/feedback_file_delta_vs_cherry_pick).
- **CSS-branch maps leak:** a dispatched worktree's `.claude/maps/*` diverged in its diff → file-delta pulled them in; restored to HEAD + committed via explicit pathspec (maps are wrap-owned). Grep-exclude `.claude/maps/` on file-delta.
- **Commit-hook timeouts:** the full-suite pre-commit hook (~210s+ under concurrent load) times out the 300000ms foreground wrapper repeatedly but the commit LANDS (verify `git show --stat` non-empty + HEAD advanced).

## 🚦 STATE @ CLOSE (branch-baton wrap)
- **git:** local main `304b00cc` (oracle **310/310**, full gate **19826/0**); origin/main `a37f11e0`; **3 unpushed** (theme·E-AUTH-001·#26). Working tree: clean except 2 untracked `handOffs/incoming/read/` floStyle msgs (committed in this wrap).
- **S249:** LIVE concurrent on `s249` (17 ahead / 3 behind); **wrap-signal sent** → it merges + takes over. Its verify-harden backlog + divergences carry to it/S250.
- **DEFERRED to S249/S250 (concurrent-wrap — S249 owns main after merge, reconciles these):** worktree cleanup (26 worktrees incl S249's — do NOT blind-sweep; only S248's landed ~15 are cleanable; feedback_pa_bash_cleanup_dry_run) · maps refresh (stale, `04a483d0` watermark) · `state.ts --write/--check` (6d) · board archive of CLOSED S242/S244/S245/S246 · master-list §0 conformance-count + landings currency (OWED) · full changelog dated block (OWED). **DONE this wrap:** hand-off · delta-log [452]-[465] · S249 baton-signal · inbox (2 read/ msgs committed) · board close.
- **delta-log:** S248 stream appended [452]+ (concise); S249 reconciles on merge.

## pa.md directives in force
R1-R5 · S239 adversarial (incl our own; the #26 review found 2 leaks) · S138 R26 · S67 file-delta + `git apply --3way` for shared-file overlap · S147 coherence · S88/S90/S99/S126 path discipline · S136 BRIEF archival · S219 orchestrate + default-GO · concurrent-session branch-baton (leading owns main; concurrent own-branch; wrap→inbox-signal→take over) · commit-to-main after authz (given; "no push" honored) · feedback_verify_work_not_done_before_dispatch (NEW).

## Tags
#session-248 #wrap-no-push #branch-baton-to-s249 #conformance-236-to-310 #capability-built #6-divergences-fixed #e-auth-001 #issue-26-p0-authbypass-fixed #finding-1-jwt-HIGH-open #issues-25-27-open #enormous-session
