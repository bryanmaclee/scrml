# scrml — Session 235 (CLOSE)

**Date:** 2026-07-02 → 07-03. **Profile:** A — FULL (booted `/boot`). A **marathon**: FINISHED the SSR A-terminus (**V1 SSR done**), then drove the **language/compiler split** toward a language-1.0 freeze — discovered the split's load-bearing build was already done, ratified the freeze bar, and launched the conformance-authoring program + the harness-extension arc + the self-host sPA. Mechanical stream → `handOffs/delta-log.md` [276]–[289]. Full narrative → `docs/changelog.md` S235 block.

## 🚀 NEXT-START
Boot Profile A. Board: **HIGH 0 · MED 9 · LOW 12 · Nominal 7**. **The V1 path is now concrete: the conformance-suite must pin every claimed surface before language-1.0 freezes (ratified S235 = high coverage / do-it-right) → the freeze gate is coverage-GROWTH + D1/D2/D4 labeling, NOT feature builds** (SSR was the last feature; the D3 extraction was found already-built).

**FIRST at boot — re-integrate the in-flight sPA landings** (they land on their own `spa/ssN` branches; PA file-deltas at list-completion, S67 + independent `bun conformance/run.ts` green):
- **ss57 (validators §55)** — marked ALL 8 items `[status=landed spa/ss57]` = **list COMPLETE → re-integrate first** (file-delta `conformance/cases/forms/*` + `form-for/*` from `spa/ss57`; run `bun conformance/run.ts`).
- **ss55 (self-host lexer)** — slice-4a landed (`spa/ss55` @ 41aef81d); items 2-5 continuing. Re-integrate at list-completion (self-host-v2/ disjoint). **Item-3 ruling was relayed** (see below).
- **ss56 (engine §51)** + **ss58 (error-model §19)** — progressing (each committing on its branch). Re-integrate at completion.
- Check `handOffs/incoming/` for per-item pings.

**THEN drive the freeze-gate program** (all parallelizable): more conformance sPA lists (Tier-2 tail: `<api>` §60 · @apply/CSS · equality/assignment-expr · meta/lin/`~` · slots · input/while runtime · + the codes-only §34 backlog) · the harness-extension arc P2+ (below) · D1/D2/D4 labeling (below).

## 🚦 STATE @ close
- **git:** scrml **5 commits ahead of origin, UNPUSHED** (0821ba1a planning · cfa5303e Track-C+lists · 33c8a921 bookkeeping · cc8d5d6d virtual-clock landing · + this wrap commit). scrml-support **1 ahead** (f2def07). **PUSH is the wrap's open action** (pre-push runs the full suite ~5min). Coherence otherwise clean (no leaks; the virtual-clock file-delta was disjoint-verified).
- **Board:** HIGH 0 · MED 9 · LOW 12 · Nominal 7. Full suite **26082/0** (at the virtual-clock landing); `bun conformance/run.ts` **72/72** (69 + the 3 new timer cases).
- **In-flight sPAs (user-driven, separate instances):** ss55/56/57/58 running on their `spa/ssN` branches + `../scrml-spa-ssN` worktrees (persistent, OUTSIDE `.claude/worktrees/` — the wrap cleanup does NOT touch them). **Their dist is symlinked** (S209 fix applied to 55/56/57/58).
- **Maps:** OWED refresh — watermark `2fb2bf1f`, behind by the SSR D2/D3 + split-drive + `conformance/` + virtual-clock commits. `project-mapper` deferred at this wrap (session depth; refreshed once already this session). Run incremental at next boot.
- **Owed-minor:** `spa-lists/INDEX.md` entries for ss55-62.

## 🎯 THE DURABLE THREADS OF S235

### 1. SSR A-terminus COMPLETE = V1 SSR done
D1 (server-render, S234) + **D2 DOM-adoption** (`f1694f63` — client adopts the `data-scrml-key` server rows in place, no double-render, interactive; recovered clean from a ConnectionRefused disconnect) + **D3 retire W-AUTH-002** (`fc726212` — `g-tier1-ssr-prerender` RESOLVED). Residual = LOW `g-ssr-render-subset-widen` (unsupported `<each>` shapes fall back). Pushed `2fb2bf1f..1c7526f6`.

### 2. The language/compiler split — reframed + launched
- **THE FINDING (verify-before-claim WIN):** the D3 conformance-suite extraction — the S230-DD's "load-bearing build remaining" — was ALREADY BUILT S231-232. `conformance/` = 69 cases, data-not-TS, codes+runtime halves, gated, 69/69 impl#1-green (PA-ran it). The **S230 DD marked partially-superseded**; the within-node "proto cross-impl oracle" claim REPUDIATED (AST is impl-freedom; `conformance/` IS the oracle). **The split is ~85-90% built.**
- **V1-FREEZE BAR RATIFIED** (user "do it right, high coverage first"): language-1.0 freezes only when the conformance suite pins EVERY claimed surface (both halves, pillars to their edges; Nominal → v1.next). Coverage-gap map: distance ≈ **30-34 surfaces + the codes-only §34 backlog → 69 → ~200-270 cases**, three tracks: (A) sPA-able authoring [the bulk] · (B) harness-extension-first [~8 surfaces] · (C) rulings.
- **Conformance-authoring program LAUNCHED** — 7 sPA lists ss56-62 (engine/validators/error-model/reactivity/SSR+protect/L22/maps+refinement), each with the method (author-from-impl#1 → sanity-check-vs-SPEC → ESCALATE divergences) + honest harness-gate flags. Full coverage map + the Tier-2 tail + the depth standard: delta-log [282] + the survey (transcript).
- **Self-host → a self-host sPA** (ss55, Road-B impl#2 lexer completion = the pre-mitosis vehicle; full compiler-PA daughter waits on the artifact split landing per the §7 guardrail). **Parser wave = ss56+ NEEDS a PA decomposition pass + the F1/emit-library unblock** (the parser's first cross-module import; `g-library-mode-no-typed-payload-match`). Not yet decomposed.

### 3. The two gates (Track C + B)
- **Track C — §19.9.1 server-`!`-error wire = NO divergence** (the S232 currency fix already reconciled §19.9.1 to impl#1's `{__scrml_error,...}`; impl#1 conformant; the stale `conformance/README.md` flag corrected). No ruling.
- **Track B — harness-extension arc SCOPED + P1 built.** 8 driver/adapter extensions phased (delta-log [286]): **P1 virtual clock DONE** (`cc8d5d6d` — `conformance/fake-clock.ts` + the `{advance-time:ms}` verb; 72/72; unblocks the ss56/ss59 timer items + §51.12). **`{advance-time}` RATIFIED as a normative language-1.0 contract verb** (impl#2 must honor). **P2+ remaining, ordered:** 2. multi-file [adapter-only] · 3. serverJs-eval [contract; `serverJs` is ALREADY in `result.outputs`, cast away at impl1-ts.ts:302] · 4. real-DB [`new SQL(":memory:")`] · 5. SSE [`sseFrames` directive ∥ `__serverError`] · 6. nav [`navigate` verb] · 7. worker [adapter-only] · 8. WebSocket [`wsBroadcast`, heaviest]. Each contract-side piece ratifies per-phase (no batch).

## 🐛 New finding (filed)
**MED `g-debounce-throttle-trailing-no-commit`** — `<x debounced/throttled=Nms>` §6.13 TRAILING fire silently never commits (the `_scrml_reactivity_bypass` re-route in the expiry closure re-arms indefinitely). Confirmed with REAL timers (not a virtual-clock artifact); surfaced by the P1 build; uncaught (no test exercised trailing-commit). A fix-dispatch candidate; a conformance trailing-fire case follows the fix (the `advance-time` verb now enables it).

## 🎗️ Item-3 ruling (RELAYED to ss55 — record)
impl#1's lexer is LENIENT by design (emits NO error tokens — verified). ss55 slice-4c "ErrorRecovery" was PA over-spec → re-scope to MATCH impl#1's lenient recovery (skip-continue, like the slice-1 `deferAdvance` stub; confirm-and-close, not a build). Lexer-stage error DIAGNOSTICS are out-of-layer (fire at parser/typer). NOT an impl#1 bug.

## 🧾 Owed at wrap
- **PUSH** scrml (5 commits) + scrml-support (1) — the open wrap action.
- **Maps refresh** (project-mapper — deferred; watermark 2fb2bf1f).
- **spa-lists/INDEX.md** ss55-62 entries.
- Re-integrate the sPA landings (ss57 complete; 55/56/58 in-flight).
- The debounce/throttle-trailing fix (MED) — dispatch candidate.
- Deploy-finding: `isolation:worktree` intermittently not provisioning (ss55 dev-agent landed main-on-main + self-rescued; main verified clean; the sPA hardened items 2-5). Watch.

## pa.md directives in force
R1–R5 · Profile A · commit `timeout:600000` · S226 landing-concurrency (disjoint-verify before file-delta) · S219 PRIMARY-GOAL/orchestrate · S215 adversarial-verify · S138 R26 · S147 coherence · S209 sPA-worktree dist-symlink (now in spa-scrml.md) · S136 BRIEF archival · S88/S90/S99/S126 path-discipline.

## Tags
#session-235 #close #v1-ssr-done #ssr-a-terminus-complete #language-compiler-split #d3-extraction-already-built #v1-freeze-bar-ratified #conformance-program-launched #self-host-spa #harness-extension-arc #virtual-clock #advance-time-contract-verb #4-spas-in-flight #push-pending
