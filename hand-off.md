# scrml — Session 268 (bryan, RECOVERY) — WRAP

**Date:** 2026-07-18. A recovery session (`/boot recover last session`): **S266 had landed #99/#103/#104 but died before wrapping**, stranding all continuity at S265. S268 reconstructed that record, then built + landed the #81 writer-ownership axiom bryan ruled at S265. Concurrent: **S267-peter** (Windows, adopter lane) — disjoint.

---

## 🔀 S270-peter FOLD (2026-07-19, AdiPDesk desktop) — concurrent adopter lane, NO scrml-main code change (full detail: board `S270-peter.md`, delta-log `[625]`–`[631]`)
> Bryan has since landed **#108/#110/#111** (colorless-async Seam-A/Phase-2 + GITI-038) → **main = `72ba19d6`**, gate GREEN. S269/S271-bryan continuity (those changelog/delta-log blocks) is bryan's to record — this fold covers only the peter lane.
- **Dogfood `assetManagement` = CLEAN R26** vs compiler `9c950dfe` — no regression from #87/#81/#108/#110. One LOW `W-DEAD-FUNCTION` false-positive folded into [[g-ri-dead-function-match-arm-edges]] (RI also misses lambda-callback + bare-ref-as-arg edges; non-breaking).
- **`scrml-pinned` BUMPED `7f75b559`→`9c950dfe`** (the compiler aM runs on) — the old pin predated #87 so 4 nested server calls shipped unawaited (`saveAssetRows` guard bypassed · `resetPassword` false-"Saved" · `saveReading`/`saveQueueItems`). Bump verified: #26 P0 preserved, 4 bugs fixed, no regression. Rollback tag `pin-7f75b559-pre-s270-bump`. Local pin only (unpushed) — **laptop `scrml-pinned` (if any) still needs the same bump.**
- **(B) TENANT-FLOOR capability SEED → routed to bryan** (`../scrml-support/docs/deep-dives/scrml-tenant-floor-capability-seed-2026-07-19.md` + inbox notice, **needs: reply**). Compiler-enforced tenant-scoping = row-level §14.8.9 `protect=` twin; own the invariant not the roles policy. Forcing case = aM S34 dPA C1 leak. **NOT a decision — bryan rules.** OPEN: bryan's ruling on the 6 Qs in §5 of the seed.
- **aM PA notified** — `assetManagement/docs/INBOX-from-scrml-pa-2026-07-19.md` (UNCOMMITTED; aM 3-behind two-machine). Owed on aM side: local dev-DB migration (portal E-PA-004; prod already migrated S36), re-verify on the bumped pin, #87 workarounds now removable.
- **Held (retire-eligible, surfaced not cleaned):** `scrml-i81-attrs` worktree + `fix/i81-value-attr-emitter`@`bcf85c29` (S268 marked retire-eligible — #81 ① landed via #105, `bcf85c29` superseded-by-reimplementation, not an ancestor). Squash-merged local branches (`wrap/s267-peter`#109 · `fix/i87-nested-server-autoawait`#106 · `feat/i29e-session-establishment`#99) are landed-but-show-unmerged (squash). Peter's live Windows branches (`fix/windows-*`, `chore/windows-test-portability`, `fix/scrml-path-*`, `fix/self-host-*`) — KEEP.

## ⚠️ READ FIRST — state as of close
- **scrml main = `8931fd59`** (#105 = #81 ① on top of S266's #104 `510cef8d`; this wrap PR merges on top), gate GREEN, conformance **740/740**, coherence 0/0. scrml-support 0/0.
- **The mechanical record is honest again.** S266's 3 lands + the #81 arc are now in `handOffs/delta-log.md` `[607]`–`[617]`, `docs/changelog.md` (S268 + S266 blocks), `master-list.md` §0, `docs/known-gaps.md` §S268. The S266 board is closed (wrapped-by-recovery).
- **#81 is CLOSED** (Axiom ① landed). **② is HELD (bryan)** — do NOT build it unprompted.

## 🔀 CONCURRENT S267-peter (adopter lane — full detail on the board `S267-peter.md`, delta-log [618]-[624])
- **#87 nested server-call auto-await → merge-ready PR #106** (`fix/i87-nested-server-autoawait`) — `gate`+`windows` GREEN, 11/11 #87 tests. §13.2 conformance fix (auto-await descends into nested control-flow statement bodies). **HELD for Peter's merge word.** 3 pre-existing auto-await known-gaps filed (§S267).
- **⚠️ FOR BRYAN — a HIGH finding in YOUR lane:** a **pre-existing client-side auth-bypass** (reproduces on main) — a CLIENT fn calling a server fn inside a client `.some()`/`.map()`/lambda compiles CLEAN → accept-all (`@ok=@hashes.some(fn(h)=>verifyPw(@pw,h))` → every input passes). The fail-closed `E-*-SYNC-CALLBACK` guards cover SERVER-side emission ONLY; the client side is unguarded. Peter did NOT file it publicly (unpatched auth-bypass = your disclosure/fix call). Repro + notes on `S267-peter.md`.

## 🎬 WHAT LANDED / WAS RECOVERED
### This session (S268)
1. **#81 writer-ownership Axiom ①** (`8931fd59`, PR #105) — exclusive wholesale-owner per DOM surface + `E-ATTR-WRITER-CONFLICT`. A **sole** reactive value attr (`class=/style=/value=(expr)`, `title=`/`data-*`) dropped outside `<each>` now emits (**fixes #81**; `g-value-attr-dropped-outside-each` RESOLVED); a wholesale-vs-other contention errors instead of silently clobbering. §5.5.3/§5.5.4/§34 reconciled with **honest enforcement-scope Notes** (template-lit + loop-context enforcement disclosed as follow-ups, not unenforced SHALLs).
2. **The PA S239 gate caught a HIGH regression a green 20812-suite shipped** — a component-root value-attr referencing a string-literal prop (`<Badge label="hi"/>`) lowered to `((hi))`, a free identifier → ReferenceError at load → **dead page** (worse than the pre-#81 silent drop). **Parse-gate + R26 were BLIND; only EXECUTION caught it.** Fixed fail-closed (`loweredExprHasFreeIdentifier`); execution + mutation-verified; PA independently re-verified pre-land.
### Recovered (S266 — landed, never recorded until now)
- **#99** §20.5 `session.set` primitive + PA security pass B1/B2/B3 (`1e63bbb1`) · **#103** maps §65/§25 refresh (`19f41a3d`) · **#104** session pass-2 B4/B5 (`510cef8d`). **Session-security arc COMPLETE.** (Detail: changelog S266 block.)

## 🔬 ANOMALIES / WHAT TO WATCH
- **"Emitted ≠ runs" struck AGAIN.** The #81 HIGH regression (dead page) passed a green 20812-suite AND a parse-only R26 — caught only by executing the bundle in happy-dom. For ANY client-runtime surface the S239 verify MUST execute; the load-bearing assertion is *downstream wiring survives*, not `threw` (happy-dom swallows listener throws). [[feedback_execute_dont_grep_runtime_verify]].
- **Lost to S266's crash (re-runnable):** the `i81-axiom2-scope.md` ② scope + the **docs-mechanism V1-confidence audit** ledger (headline survived: F-AUTH-001 19 witnesses · ad-hoc errors 29 files · null-in-comments 20). Scratchpads don't survive a dead session — durable artifacts must land to a repo, not scratchpad.
- **50+ stale worktrees + old sPA worktrees** (s251, ss56/59/60/61/66/69/71/72/74, dozens of agent-*). Sweep owed (dry-run first — [[feedback_pa_bash_cleanup_dry_run]]).
- **CI:** `tracking` + `ai-review` RED on every PR = known non-issues (flaky-R26/self-host/migrate + infra-fail). Only `gate` + `windows` gate the merge.

## 🚦 OPEN THREADS / NEXT — `bun scripts/threads.ts --open`
- **#81 ② — HELD (bryan).** The decomposed-surface merge (a runtime accumulator for `className`/`style` only — the scalar surfaces `.value`/bool-attrs still need ①). A witnessed-need MINOR built on ①. The 6 §S268 known-gaps are the ②-adjacent completeness (loop-context enforcement · bool-attr warn+drop · template-lit owner · duplicate-wholesale · component-root class/style · browser-global over-refusal). Build only when bryan unholds.
- **bryan's big next arc:** `feat/colorless-async-seam-a` @ `211ab331` (GITI-037 Phase-1, held/green; combinator-transform + coverage remain).
- **Peter-lane (his machine):** **#87** nested server-call auto-await — Peter pushed `fix/i87-nested-server-autoawait` (his S267 work; the `<program>`-structure gap was unresolved at his wrap — see `S267-peter.md`). #27 residual (Wave-1c cross-route + keep-alive) = bryan's navigate arc. Check `gh issue list --repo bryanmaclee/scrml --state open` at boot.
- **Owed (carry):** stale-worktree sweep · maps refresh for the #81 `emit-html.ts`/§5.5 surface · docs-mechanism V1-confidence audit (re-run if still wanted) · the S265-carried maps §65/§25 items (landed via #103, verify) · #6b/#7 oracle-ledger fold (long carry).
- **Held branches (do NOT clean):** `feat/colorless-async-seam-a`@`211ab331` · `fix/i81-value-attr-emitter`@`bcf85c29` (①-source checkpoint — superseded by #105, **retire-eligible** but harmless).

## pa.md directives in force
PR-flow (branch→PR→cloud `gate`→merge on explicit authz; only `gate`+`windows` gate) · **S239 mandatory adversarial pass on EVERY compiler-source land** — it caught a dead-page regression this session · **EXECUTE-don't-grep for client-runtime verify** · **security/auth → bryan, never merge on green alone** · **② and other foundational axioms build only when bryan rules** · premise-verify FIX dispatches · R26 empirical · file-delta re-checks origin/main under concurrent PA activity · orchestrate-don't-grind + default-GO.

## Tags
#session-268 #recovery-of-s266 #81-axiom1-writer-ownership-LANDED #E-ATTR-WRITER-CONFLICT #s239-caught-dead-page-regression #execute-dont-grep-again #81-axiom2-HELD #session-security-arc-complete #conformance-740
