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
