# scrml — Session 237 (OPEN)

**Date:** 2026-07-04. **Profile:** A — FULL (booted `/boot`). Session in progress — this hand-off fills as work lands; it becomes the S237 CLOSE at wrap. Prior close: `handOffs/hand-off-238.md` (S236). Mechanical stream → `handOffs/delta-log.md` [324→]. Narrative → `docs/changelog.md`.

## 🚀 NEXT-START — the path to V1 (carried from S236 freeze-readiness)
The flagship pillars are DONE (conformance 72→220, 25 categories). V1-freeze is within reach — a handful of focused arcs, NOT open-ended. Map: `scrml-support/docs/deep-dives/v1-freeze-readiness-2026-07-03.md`. Priority path:
1. **Fix the ~8 freeze-BLOCKER correctness bugs** (covered-but-broken surfaces). Lead with **`g-not-cell-render-null-throw`** (MED, FOUNDATIONAL — `${@cell.field}` on a `not` cell THROWS; V5-strict violation, the sharpest). Then `g-is-literal-rhs-if-condition-drop` · `g-enum-toenum-not-lowered-server-side` (r28-c2) · the CSRF/auth pair (`g-auth-csrf-token-never-surfaced` + `g-csrf-retry-helper-def-gated`) · the typer soundness pair (`g-typer-bare-variant-non-return-ambiguous`, `g-typer-hostmethod-return-asis-and-anon-struct-poison`) · `g-fail-variant-payload-arity` (needs the **E-ERROR-010 mint** — probe fail-only-vs-general first). ← highest-value; dispatch-able in a wave like S236's Bucket-1+2.
2. **Author the sPA-able coverage TAIL:** api §60 · @apply/CSS §26 · meta `^{}` §22 · **SQL §8 / schema §39 RUNTIME (unblocked by the ratified `serverDb`)**. Mechanical, sPA-able.
3. **Track-B phases 5/6/8** (SSE/nav/WS drivers) → then channels §38 / SSE §37 / nav §20 coverage. Each = driver build + a per-phase contract ratification (advance-time/serverDb pattern).
4. **D1/D2/D4 LABELING** — VERIFY state: chunks.json `language` field wired? spec partition done? deprecation conformance cases (zero built). Gates the freeze independent of coverage.
5. **The freeze decision.**

**Also queued/owed:** flogence **S217 lift-driver joint DD** in flight (delta [681] — flogence drives currency-passed modules → candidate `pa-base.md` §-additions for bryan to ratify; see `flogence/docs/deep-dives/s217-lift-driver-2026-07-03.md` + inbox reads) · **reset-reserved impl fix** (ruled ENFORCE, needs a dispatch — `g-reset-reserved-identifier-unenforced`) · **maps refresh** (watermark 8+ commits behind — run `project-mapper` incremental; deferred S235/S236) · **MEMORY.md over-limit trim** (25.9KB / 24.4KB).

## 🚦 STATE @ S237 boot
- **git:** scrml HEAD `57de558a` (S236 WRAP), **origin SYNCED 0/0**, working tree CLEAN. Commit gate installed (Config B — `.git/hooks/` pre-commit+post-commit+pre-push). conformance **220/220**.
- **Board (from S236 close + freeze-readiness):** HIGH **0** · MED **14** · LOW **13** open · Nominal set. Named blockers = the ~8 freeze-blocker set above (all MED).
- **Worktrees:** CLEAN (only main checkout, per S236 close). No deputy (retired S219).
- **Inbox:** `handOffs/incoming/` empty at boot (only `dist/` + `read/`). flogence exchange from S236 archived to `read/`; the S217 lift-driver joint DD is the live cross-PA thread.
- **Boot:** Profile A full reads done (pa-scrml.md IN FULL · PRIMER pending on-demand · SPEC-INDEX section-table on-demand · master-list §0 · user-voice tail S230-236 · flogence programmatic digest). Old `handOffs/digest.md` is STALE (S218) — superseded by the flogence digest per S219.

## ✅ DONE this session — freeze-blocker 1/8
- **`g-not-cell-render-null-throw` RESOLVED.** User ruled **Option A + spec `?.` properly**. SPEC amendment `097b5452` (§42.3.5 E-TYPE-046 rule + §42.3.6 `?.` normative spec + cross-refs) · impl `49f0898e` (typer checkOptionalMemberAccess pass + §34 row + `?.` result-typing + 3 conformance cases 220→223 + 25 tests; agent addb6488118bf8610) · user-voice → scrml-support `10ea101`. Corpus migration ZERO. PA-independent R26 4/4 + adversarial (one `@`-sigil over-fire caught+fixed). Residuals filed: `g-etype046-map-bracket-read-narrow` (MED, §59.6 tension) · `g-etype046-write-lhs-and-fn-param` (LOW).

## 🧵 In-flight / next — 3 AGENTS RUNNING
- **Push state:** E-TYPE-046 arc PUSHED (`13e47bef`, origin 0/0). E-EQ-005 SPEC `d98fc988` UNPUSHED (push with the E-EQ-005 impl landing). scrml-support `10ea101` pushed.
- **AGENT 1 — E-EQ-005 (freeze-blocker 2/8 `g-is-literal-rhs-if-condition-drop`).** RULED "reject `is <literal>`. fix" + SPEC §45.5 landed `d98fc988`. Impl agent `a43387a3de13be837` (iso:worktree, S112-merge d98fc988): parser/typer reject value-RHS-on-`is` → E-EQ-005 (mirror of E-EQ-002) + §34 row + corpus scan + conformance + tests. On landing: file-delta → main, non-empty verify, R26, close gap, push.
- **AGENT 2 — Peter #18 (Windows import specifiers).** agent `a117c9c3b5eb98fdc`. api.js posix-normalize specifiers; OS-independent test. Closes GitHub #18.
- **AGENT 3 — Peter #19 (SPA lift_target tree-shake).** agent `a318c5691c5fc3bce`. Move `_scrml_lift_target` into lift chunk. Closes GitHub #19.
- **QUEUED — Peter codegen wave (#20/#21/#22/#23)** — ALL LIVE (triaged delta [332], root causes confirmed in emitted JS). Fire after the 3 running agents land. **Partition (loci scoped):** #22 `<errorBoundary>` empty fallback → `emit-error-boundary.ts` (DEDICATED file, cleanly disjoint — parallel-safe) · #21 match-over-failable `::Ok(v)` bare-return + unbound `v` → `emit-control-flow.ts:2367` (the `cannot positionally bind` emit) · #23 for-of-over-reactive-in-plain-fn → list-render → `emit-logic.ts`/`emit-each.ts` classifier · #20 `<request>` §6.7.7 state-machine unwired → SPREAD (emit-control-flow/functions/client — murkiest, agent must scope; risk of emit-control-flow overlap with #21 → hold #20 or serialize vs #21). Plan: fire #21+#22+#23 parallel (disjoint loci), #20 solo/after. Intersect file-sets at dispatch + reconcile conformance baselines by hand (S211/S226).
- **QUEUED — JS→LOGIC rename** → `E-CODEGEN-INVALID-LOGIC` (user-ratified "the longer error code"). ONE code (`E-CODEGEN-INVALID-JS`, ~219 refs across SPEC §34/api.js/validate-emit/tests/conformance/docs) + drop "JavaScript" from the message. Serialize after #18 (shares api.js) + the E-EQ-005 conformance landing.
- **QUEUED — freeze-blockers 3-8:** enum-toEnum (`g-enum-toenum-not-lowered-server-side`) · CSRF/auth pair · typer-soundness pair · `g-fail-variant-payload-arity` (needs E-ERROR-010 mint — probe fail-only-vs-general first).

## 🧾 Owed at wrap
- Maps refresh (project-mapper incremental — watermark behind by the S235+S236 landing set).
- MEMORY.md trim (over the 24.4KB limit).
- reset-reserved impl fix (ENFORCE) · E-ERROR-010 mint (fail-variant-arity).

## pa.md directives in force
R1–R5 · Profile A · commit `timeout:600000` · **S236: `git show --stat` verify non-empty after file-delta commits + stage+commit in ONE bash** · S226 landing-concurrency (disjoint-verify / 3-way-merge-shared) · S219 PRIMARY-GOAL/orchestrate + memory-gated-commit · S215 adversarial-verify + 10× sample · S138 R26 (both directions) · S147 coherence · S88/S90/S99/S126 path-discipline · S227 dock-as-navigation.

## Tags
#session-237 #open #boot-profile-a #path-to-v1 #freeze-blocker-wave-queued #flogence-lift-driver-dd-live
