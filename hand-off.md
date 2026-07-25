<!-- ============================================================= -->
<!-- S286 WRAP (bryan/ASUS-Vivobook) — prepended 2026-07-25.        -->
<!-- Peter/AdiPDesk S286 adopter-lane addendum UNCHANGED below.     -->
<!-- (S286 session-number collides: two machines. Disambig by name) -->
<!-- ============================================================= -->

# scrml — Session 286 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-07-25. `/boot` Profile A. `main` at **`1c5c2aee`** (PR #180 chunk-ns landing), CI `gate` GREEN, coherence 0/0. Two big arcs: **(1) the chunk-namespacing BUG-6 rename LANDED** (the boot-gating item), **(2) the RediLedger DB-authoritative security ask → DD → threshold ruled → full scope/phasing ruled → Milestone-1 P0 spike validated.** Mechanical stream in `handOffs/delta-log.md [767]+` (bryan-S286 section). Changelog S286. This carries the irreducible.

## 🔴 THE NEXT PRIORITY — RediLedger DB-authoritative Milestone-1 codegen build

**bryan RULED "add the tier" + the full scope/phasing (all five to PA recs) + "kick off Milestone 1".** The P0 spike is DONE (mechanism empirically validated); the next step is the **codegen build**, NOT started.

**Boot the build from `scrml-support/docs/deep-dives/db-authoritative-security-PHASING-PLAN-2026-07-25.md`** (ruled plan of record) + the DD (`db-authoritative-security-design-2026-07-25.md`, the evidence). The plan's "Milestone 1 — P0 spike RESULT" section carries the findings that shape the codegen.

**Ruled decisions (do NOT re-litigate — user-voice S286):** phasing = **reads-first** (P0 foundations A1+S2, S7-min fence → P1 reads-authoritative RLS+S6 roles → P2 writes column-GRANT+SECDEF-managed-text → P3 triggers → P4 tail; seam = the §14.8.10 firewall, P1 relocates the invariant/doesn't cross, P2+ crosses) · A1 = **pooled + `SET LOCAL ROLE` + `set_config(...,true)` in a per-request txn** · SQLite = **hard-fail `E-DBAUTH-SQLITE`** · SECDEF/trigger bodies = **managed plpgsql-text** (NOT a mini-compiler) · acceptance unit = decl + DDL + `SET LOCAL` + migration-preservation + **direct-`psql`-denied negative test**.

**P0 spike findings (validated vs real Postgres 16 via Bun.SQL — shape the codegen):** (1) **superuser BYPASSES `FORCE RLS`** → per-request principal MUST be a bounded `NOBYPASSRLS` role → **S6 mandatory in P1** (A1-without-S6 = silent no-op). (2) **`SET LOCAL` can't be parameterized** → emit `set_config('scrml.tenant', $x, true)` + `SET LOCAL ROLE`; confirmed txn-scoped, no pooled bleed. (3) **`USING` doubles as `WITH CHECK` for INSERT** → P1 blocks cross-tenant inserts free. (4) Bun.SQL socket peer-auth = `new SQL({ path: "/var/run/postgresql", database, username })`.

**The build = a real `scrml-js-codegen-engineer` dispatch (higher-risk — A1 reverses the single ambient `new SQL()` handle on the hottest path, `emit-server.ts:4738-4764`):** S7-min fence → S1/S6 emitters → wire the negative test into the harness → land atomically. **Never dispatched — bryan wrapped instead. Teed up.** Spike script: scratchpad `dbauth-spike.ts` (5/5 core). Local Postgres 16 available (socket `/var/run/postgresql`) for the negative-test harness.

## 🎬 WHAT LANDED / DECIDED
- **PR #180 (`1c5c2aee`) — chunk-namespacing BUG-6 rename FINISHED + LANDED.** S283 campaign + S286 finish (agent `0cbfe5be`, 44 commits) reconciled onto Peter's main. **Closes #27**; **unblocks Wave-1c + ESM U4**. gzip holds 16 KB; anti-masking proven (`chunk-ns-intact-bundle-acceptance.test.js`).
- **RediLedger DB-authoritative** — DD + threshold ruled (add-tier) + scope/phasing ruled (5 recs) + phasing plan + M1 P0 spike. **freeze-bar TIMING relaxed** (bryan: the freeze/split rush "jumped the gun"; profile + master-list reconciled this wrap).
- **Replies sent (reply-on-resolve, adopted from flogence §4):** RediLedger ×2, flogence ×1 (Case-2 witness HOLD).

## 🧭 ANOMALIES (recovered — reasoning)
1. **Finish agent ENOTIMP crash + resume** — transient API error mid-Phase-4 after 34 WIP commits (green). SendMessage-resumed (first crash, transient → resumable); completed.
2. **Stale-index bug caught pre-push** — `8b571a07` committed RAW assertions from a stale index (earlier pkill'd commits), yet its gate PASSED because the pre-commit hook tests the WORKING TREE (my correct cs edits), not the committed index. Caught via a compile-probe before push; fixed `f440e721`. **LESSON: `git add` before every commit; gate-green ≠ committed-content-right when index≠worktree.**
3. **Reconcile write-skew caught by the gate** — the rename merged clean over Peter's #175, but the full suite caught #175's tests asserting the pre-rename accessor. Fixed unit (5) + browser (keyed via `chunkCellKey`). The OCC backstop, as doctrine says.
4. **pkill matched my own commit's hook** (`bun test compiler/tests/unit…`) → aborted a commit (exit 144). Don't pkill a test-pattern mid-commit.
5. **Wrap-conflation correction (DURABLE, user-voice S286)** — floated a wrap-pacing decision at 53%, conflating wrap with landing/CI/bookkeeping. Wrap = session-END only; never manufacture a wrap-pacing decision above ~20% remaining.

## 🧷 CONCURRENT / HELD
- **Peter (S285/S286) adopter lane** — landed #171-#179 while I worked (delta `[763]-[766]`); his #175/#174 forced the reconcile. S286 number collides (2 machines; disambig by name).
- **Retained worktree (do NOT delete):** `worktree-agent-a2ed001a5de228134` (Wave-1c — UNBLOCKED by the chunk-ns land, not yet built; the next execution arc after/alongside the RediLedger build) · local `feat/wave1c-nav` · `origin/evidence/u4-premise-falsified`.
- **Cleaned this wrap:** chunk-ns finish/rename/base worktrees (a4e2f7f2, a91ad13, bug6-base — landed via #180) + `finish/chunk-ns-bug6-rename`.

## 📥 INBOX
- **XPS-outbound** — LEFT in `incoming/` (this machine's outbound to XPS; unconsumed; archiving denies XPS's boot from auto-flagging it). bryan didn't rule leave-vs-archive → defaulted LEAVE. The boot hook keeps flagging it until XPS consumes it.
- **RediLedger + flogence** — REPLIED → moved to `read/` this wrap.

## 🗺️ Maps
Refreshed this wrap (`project-mapper` incremental — chunk-ns + #171-#179 surface; stamp → `1c5c2aee`; was `e8fdd44c`).

## Tags
#session-286-bryan #chunk-ns-LANDED-pr180 #adopter-27-closed #rediledger-db-authoritative-ruled #m1-p0-spike-validated #freeze-timing-relaxed #reply-on-resolve #stale-index-caught #wrap-conflation-corrected #peter-concurrent-171-179

---

<!-- ============================================================= -->
<!-- S286 ADDENDUM (Peter/AdiPDesk, adopter lane) — prepended.      -->
<!-- S285 addendum + bryan's S284 chunk-ns wrap UNCHANGED below.    -->
<!-- ============================================================= -->

# scrml — S286 addendum (Peter/AdiPDesk) — adopter form-binding pair closed

**Date:** 2026-07-24. `/boot` Profile A on AdiPDesk (Peter). **SOLO** (S285-peter closed; bryan S284 wrapped). `main` at `2d192b6`, clean, coherence 0/0. **2 PRs merged** (#177 #178). Full detail: `changelog.md` S286 + delta-log `[763]-[766]` + board `../scrml-support/handOffs/active-sessions/S286-peter.md`. This is the irreducible.

## Landed (adopter form-binding lane — the paired reason form input didn't work in `<each>`)
- **#175 closed** (`c8dbd04`, PR #177) — `bind:value` value-side wired inside `<each>` (the S216 "Half-2"). Reuses `emitBindDirectiveBody` (root-agnostic Half-1 lowering) + a reconcile-lifecycle effect wrapper; outer/shared-cell scope; item-field RHS deferred *loudly* via NEW `W-EACH-BIND-ITEM-FIELD-DEFERRED` (§34). Generalizes to checked/selected/group.
- **#174 closed** (`2d192b6`, PR #178) — reactive form-control `value=` writes the `.value` PROPERTY (not setAttribute), both top-level (`emit-bindings.ts`) + each (`emit-each.ts`) paths, caret-safe guard. Axiom① guard: property route only when `value=` is the sole `.value` writer (bind:value present → value= falls back to setAttribute).

## Open for a fresh boot (Peter lane, queued — NOT started)
- **`g-attr-writer-conflict-not-detected-template-value-form`** (MED, NEW this session) — template `value="${}"`+`bind:value` silently defers to bind:value instead of emitting `E-ATTR-WRITER-CONFLICT` (the template-attr path never runs `analyzeWriterConflict`; the paren `value=(expr)` form does). Not runtime-wrong (the #174 guard prevents the double-write); the gap is the MISSING diagnostic. Fix = route the template `value=` path through `analyzeWriterConflict`.
- **From the S285 queue (still open, Peter lane):** `g-match-without-for-plus-when-children-silent-undeclared-dispatch` (HIGH — invented `<when>` children → silent runtime ReferenceError; clean diagnostic fix) · `g-nested-for-lift-no-reconcile-on-cell-replace` (HIGH — stale render on cell replace; reconciler internals; we're warm on this surface) · auto-await expr-positions MED×2 (`g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait`) · the #173 amplification halves.
- **#27** (navigate soft-nav) — still gated on bryan's chunk-namespacing.

## Method / anomalies (recovered) — read before the next dispatch on AdiPDesk
- **Both dispatches used the `general-purpose` fallback agent** — the canonical `scrml-js-codegen-engineer` is NOT installed on AdiPDesk (only `debate-judge` present). The fallback + a thorough self-contained brief (F4 startup + MAPS + empirical Phase-3 + crash-recovery blocks embedded in the prompt, since the archived BRIEF.md is not in the fresh worktree) worked cleanly for both codegen fixes.
- **AdiPDesk has NO local git hooks** (only `.sample`) — no local commit/pre-push gate on this machine; the cloud `gate` is the sole authority. Offered the baseline-hook install; Peter did not take it up this session. [[delta-log 764]]
- **AdiPDesk full-suite baseline = 6 fails** (self-host-smoke ×4 [cross-OS path + missing gitignored dist artifact `tab.js`/`bs.js`] · B5 CSRF middleware guard · 1 unnamed teardown). PROVEN pre-existing on pristine `cd65898` (zero i174/i175 changes). Do NOT re-investigate these each session; the Linux cloud `gate` does not have them. `--bail` is degenerate here (self-host-smoke bails first) — run WITHOUT `--bail` for a real count.
- **verify-committed-state + S239 adversarial paid off on both:** caught the empty `after-count.txt` (agent's full-suite never finished → I ran it independently), the post-review chore-commit that moved the branch tip (re-reviewed the delta), and byte-identity of the untouched paths. #174's agent self-caught a writer-ownership regression its own fix created (the Axiom① guard).

## CI check shape (both PRs — expected going forward)
`gate` (required) + `windows` = GREEN; `ai-review` (no findings — infra-step fail) + `tracking` (self-host + serve-tool R26 known flakes) = RED but NON-required → merge on `gate` green. Matched S284/S285.

## Concurrent / held
- SOLO all session. Held branches (do NOT delete): chunk-ns `worktree-agent-a91ad13968b46ab5d` (bryan's, unlanded) · `origin/evidence/u4-premise-falsified` · `origin/worktree-agent-a2ed001a5de228134` + `feat/wave1c-nav`. `scrml-pinned` worktree is persistent (not a session tree).
- **Inbox:** `2026-07-22-2230-from-S282-to-XPS` — bryan-machine-family's outbound to the XPS clone; NOT for AdiPDesk. Left in place.

## Tags
#session-286 #adopter-174-175-landed #form-binding-in-each-e2e #bindvalue-half2 #value-property-fix #axiom1-guard #general-purpose-fallback-agent #adipdesk-no-local-hooks #adipdesk-6-fail-baseline #new-gap-attr-writer-conflict-template

## Maps
`primary.map.md` unchanged this session — internal codegen edits to existing files (emit-each.ts bind path, emit-bindings.ts value path); no structural/file changes. The pre-existing S284 "refresh OWED" (map behind HEAD) carries forward; a targeted `project-mapper` pass on `emit-each.ts`/`emit-bindings.ts`/`component-expander.ts` remains the alternative when someone takes it.

<!-- ============================================================= -->
<!-- S285 ADDENDUM (Peter/AdiPDesk, adopter lane) — bryan's S284    -->
<!-- chunk-namespacing WRAP is UNCHANGED below (his critical path). -->
<!-- ============================================================= -->

# scrml — S285 addendum (Peter/AdiPDesk) — adopter lane; chunk-ns (bryan, below) untouched

**Date:** 2026-07-24. `/boot` Profile A on **AdiPDesk** (Peter). Solo (bryan wrapped S284). `main` at `b274ed2b`, both repos clean. **4 PRs merged** — full detail in `changelog.md` S285 + delta-log `[S285]` + board `../scrml-support/handOffs/active-sessions/S285-peter.md`. This addendum is the irreducible; the chunk-namespacing critical-path arc (bryan's) is the S284 wrap immediately below, unchanged.

**Landed (adopter/silent-failure lane, all gate-green + regression-tested):**
- **#165 fully closed** — `#167` (initial control-anchors fold) → **`#171`** completed it (the fold was incomplete: filler-distance + `propagate`/`throw`/`match` guards; replaced with a direct `isControlFlowBoundary` scan-break). Server call no longer hoists above a returning guard.
- **`#172`** — a client side-effect between two batched server calls is now a batch boundary (§19.9.9.2 + S3; the client scheduler was inconsistent with the CPS planner).
- **`#173`** — a static-component import no longer emits a dead `_scrml_modules` destructure (HIGH; scrml-site page-kill).

**Open for a fresh boot (Peter lane, queued — NOT started):**
- **auto-await expression positions** (MED×2): `g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait` — `@cell = serverFn().field` / server-call-in-match-arm emit a bare unawaited Promise → silent `undefined`. The scheduler/auto-await area, freshest context.
- `g-match-without-for-plus-when-children-silent-undeclared-dispatch` (HIGH) — invented `<when>` children silently accepted → runtime ReferenceError; clean diagnostic fix.
- `g-nested-for-lift-no-reconcile-on-cell-replace` (HIGH) — stale render on cell replace; reconciler internals.
- The **amplification halves** of #173 (`g-composition-strip-eats-last-dep-script` · `g-runtime-script-tag-not-depth-prefixed`) — now non-fatal for static components but still real on the composition path.

**Owed to bryan (tier-1, flagged not done):**
- **§13.2.4 spec-coherence** (`#172`) — §13.2.4 ("parallelize independent server calls unless data dependency") reads in tension with §19.9.9.2; impl follows §19.9.9.2. Outbox notice: `incoming/2026-07-24-from-S285-peter-to-bryan-spec-coherence-13.2.4-vs-19.9.9.2.md`. SPEC.md not touched.
- **latent-coupling hardening** (`#173`) — the static-component drop is by a proxy (`exportIsUserComponent`) not ground truth (`declaredBinding`); documented at the fix site + gap, bites only if value-consts ever get client bindings.

---

# scrml — Session 284 (bryan) — WRAP

**Date:** 2026-07-24. `/boot` Profile A on **`bryan-maclee-ASUS-Vivobook`** (successor to S283/S282, same machine). **4 PRs merged** (#163 #164 #166 #168), `main` at `33360949`, coherence 0/0. Mechanical stream in `handOffs/delta-log.md [753]-[762]`; changelog S284. This carries the irreducible.

---

## 🔴 THE ONE THING THAT GATES NEXT SESSION — chunk-namespacing is 90% DONE, not "runs next session"

**S283 already RAN the BUG-6 accessor-rename.** The board logged S283 as a "no-op orient"; git shows ~24 commits on `worktree-agent-a91ad13968b46ab5d @ 307bf9b7` (RETAINED). The S282 hand-off's "runs next session / 137 text-pins" framing is **wrong** — `verify-work-not-done` caught it before I re-dispatched a 90%-complete arc.

**Boot the finish from `docs/changes/chunk-namespacing/FINISH-SCOPE.md`** (landed #168, `status: current`). It is the current-truth kickoff. Summary:
- **DONE + verified:** core strip (`_scrml_cell_scope/_cell_key/_cell_name` out of core), **gzip 16,330 B — holds the 16 KB budget** (PA-re-measured S284; base main still 16,257, 0 drift — the "raise-forced" trigger did NOT fire), Acorn callee-rename pass, `E-CG-018` §34 rows, most test migration.
- **gzip decision RULED (bryan): HOLD 16 KB** via zero-core-residue (already achieved). Caveat: 54 B margin < ~200 B whitespace-noise band — whitespace-normalize + re-measure; the budget test self-guards future core additions.
- **The real residual (NOT mechanical text-pins):** ~19 within-node **PARITY** fails (the rename shifts LIVE emitted accessor names → native-vs-live byte parity over-budget per fixture) + **executed-output correctness** (the campaign has REVERT commits of a "folded prologue self-recurses / mangled executed clientJs" — verify in real Chromium, S265) + a **rebase onto main** (1-file `emit-each.ts` conflict with #161) + the **full verification bar** (both module formats real Chromium · both BUG-6 tests · name-diff clean · artifact-diff · S239).
- **The stale-branch 199-fail count is POLLUTED** (stale base + happy-dom global-state-leak cascade; 12 base browser flakes are expected). Get the clean rename-only count by rebasing onto main + running browser isolated.
- **OPEN RULING for the finish (surface to bryan):** resolve the within-node parity by (a) regenerating parity baselines to post-rename live output [likely], (b) applying the rename to native too, or (c) rename-aware gate. See FINISH-SCOPE §3.
- **Payoff on land:** closes adopter **#27** (navigate soft-nav) + unblocks the held classic Wave-1c loader AND ESM U4.

---

## 🎬 WHAT LANDED (4 PRs)

- **#163** — gaps filed for #161/#162 (both PA-reproduced on f28c35fb first).
- **#164 `374888b6`** — **#162** same-line multi-statement call-drop → CONFORMANT-REJECT (`E-STMT-MISSING-SEMICOLON`, §4 + native parity). GH #162 closed.
- **#166 `c27dca49`** — **#161** component + item-root fn-markup mount in `<each>`. Item-root scope; nested deferred. GH #161 closed.
- **#168 `33360949`** — chunk-ns `FINISH-SCOPE.md` (record correction + finish scope).
- **Filed:** `g-each-nested-markup-interp-stringifies` (MED) — the deferred nested-markup-interp shape. HIGH gaps 17→15, MED +1.

---

## 🧭 METHOD — two disciplines earned their cost this session

1. **The S239 adversarial gate caught a real regression pre-merge (S282 repeating verbatim).** #162's agent self-reported green through 21k tests but silently broke `(x==1) or (y==2)` — word-form booleans after a grouping `)`. My **empirical** adversarial pass (10+ constructed blast-radius shapes covering operator-classes / declaration-heads / chaining / under+over-rejection) found it; routed back; fix-round folded in the same PR. A landing on the green report ships a newly-rejecting break on valid common code. **The empirical construct-reproducers form of the gate is stronger than a generic review for a bounded-blast-radius parser change.**
2. **`verify-work-not-done-before-dispatch` saved a re-dispatch of a 90%-done arc.** The board said "no-op"; git said otherwise. **A board S<N>.md reflects boot-time intent, not what the session did — plan from git + landed artifacts, never the board marker.** (Process fix recorded on the S283 board.)
3. **Executed-DOM (S265) for #161** — the "renders nothing" mode is invisible to codegen inspection; verified by executing the bundle in happy-dom (my own harness, independent of the agent's test), with a base control proving the bug + the harness's discrimination.

---

## ⚠️ ANOMALIES / FRICTION (recovered)

- **FACTS-gate tripped #164 once** — I failed to pre-regen despite the S282 hand-off flagging it. **Pre-regen `bun scripts/facts.ts --write` before pushing ANY PR touching `compiler/src`, tests, or `SPEC.md`.** Applied for #166/#168.
- **GitHub partial outage** (~19:27-19:45Z) blocked #161's PR-create (GraphQL + REST 5xx, GitHub-internal error IDs). Background-retry auto-created the PR on recovery. `windows` failed on the mid-outage run (infra); the fresh run passed — no #161 regression.
- **Concurrent session S285-peter** landed #167 mid-merge → bumped main → #168 rebased + re-gated (strict:true). scrml-support push rejected once (Peter's push) → rebased clean.

---

## 🧷 CONCURRENT / HELD

- **S285-peter LIVE** — his adopter lane (#165/#167). Disjoint from my surfaces; serialized by PR merge-order. Not a blocker.
- **Held branches (do NOT delete):** `worktree-agent-a91ad13968b46ab5d` (chunk-ns rename — the finish resumes from it) · `bug6-base-e8fdd44c` (chunk-ns base) · `worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` (Wave-1c, unblocked when chunk-ns lands) · `origin/evidence/u4-premise-falsified`.
- **Inbox:** the `2026-07-22-2230-from-S282-to-XPS` message is THIS machine's own outbound to the XPS clone — LEFT in place (consuming it here denies XPS ever seeing it). The boot hook will keep flagging it until XPS consumes it. Not for this machine.

## Tags
#session-284 #adopter-161-162-landed #conformant-reject #s239-caught-or-and-regression #executed-dom-verify #s283-ran-the-rename-board-said-no-op #chunk-ns-90pct-done-scoped #gzip-hold-16 #facts-gate-friction #s285-peter-concurrent

## 🗺️ Maps
`primary.map.md` stamped pre-session (was 8 commits behind at boot, now ~15 with #162/#161/#167/#168). **Refresh OWED** — the session added real surface (`ast-builder.js` same-line boundary detector, `emit-each.ts` item-root mount path + each-block CE descent). Deferred with the chunk-ns finish (which adds the bulk of new surface); a targeted `project-mapper` pass on `ast-builder.js`/`emit-each.ts`/`component-expander.ts` is the alternative if the finish slips.
