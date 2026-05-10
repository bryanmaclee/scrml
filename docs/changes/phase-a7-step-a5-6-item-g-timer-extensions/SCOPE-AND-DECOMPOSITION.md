# Phase A7 Step A5-6 — Item G B-shakeable Timer Extensions

**Authored:** S77 — 2026-05-10
**Authorization:** S77 user direction "keep going A5-6" + syntax ratification 2026-05-10
**Roadmap reference:** IMPLEMENTATION-ROADMAP.md §2.5 A5-6 (~5-10h optional follow-on)
**Status:** **RATIFIED 2026-05-10** — proceeding with impl

**Ratification record (S77, 2026-05-10):**
- Feature 1 syntax: **Option A** (`name=` attr on `<onTimeout>` + `cancelTimer(name)` builtin)
- Feature 2 placement: **Option A** (engine-root `<onIdle>` only, rule=-honoring sub-A1)
- Q3 sub-option: **A1 (rule=-honoring)** — watchdog target subject to current state's rule= validation per §51.0.F
- Q4 module-init semantics: **PA default ratified** — module-init counts as first event; timer arms with full N ms remaining
- Q5 dispatch bundling: **bundled** — Features 1 + 2 ship together
- Q6: **NOT vetoed** — proceeding now (in S77)
- Dispatch shape: **PA-direct**, Feature 1 first then Feature 2

---

## §1 What this dispatch ships

Two **NEW** B-shakeable timer surfaces for engines, classified per master-PA capability-gap audit (Item G in `2026-05-07-1327-master-to-scrmlTS-hierarchy-likely-locked-tree-shake-reclassification.md`):

1. **Named timer addressing** — `<onTimeout>` gains an optional `name=` attribute for addressable cancellation from elsewhere in the state-child body (gen_statem `cancel_timer(Name)` parity).
2. **Event-timeout watchdog** — a NEW element fires when N ms pass with no transitions on this engine (gen_statem state-timeout / activity watchdog parity).

Both are **B-shakeable**: per master-PA cost-lens, the runtime cost only ships when an engine declares the feature. Tree-shake invariant preserved.

**WHY GREENFIELD:** Neither feature has prior SPEC text or syntax proposal. The roadmap line item is one paragraph. This SCOPE doc proposes the syntax and surfaces it for user ratification.

---

## §2 Why this needs ratification before impl

Per pa.md Rule 3 + Rule 4: "right answer beats easy answer 99.999% of the time" + "spec is normative; derived planning docs are NOT". A5-6 is greenfield SPEC design, not an implementation gap. PA must NOT silently pick syntax for new spec surfaces. The proposal below is PA's best-guess shape grounded in existing `<onTimeout>` (§51.0.M) + gen_statem precedent. **User picks one option per feature OR vetoes the whole dispatch.**

Estimated effort once syntax is set: **5-10h** (matches roadmap). Adds:

- ~80-150 LOC SPEC text (§51.0.M extension + new §51.0.M.2 subsection)
- ~+50 LOC engine-statechild-parser.ts (parse `name=` attr + new element scanner)
- ~+30 LOC symbol-table.ts (entry + walker validation)
- ~+80 LOC emit-engine.ts (named-timer-key extension + event-timeout codegen path)
- ~+60 LOC runtime-template.js (new helpers `_scrml_engine_arm_event_timeout` / `_scrml_engine_clear_named_timer`)
- ~+20-40 unit tests + ~+5-10 integration tests

---

## §3 Feature 1 — Named timer addressing

### §3.1 Motivation

Multiple `<onTimeout>` per state-child are already legal (§51.0.M; A5-4 codegen ships independent timers per anonymous index). Missing surface: **addressable cancellation from elsewhere in the state-child body**. Use cases:

- "Auto-dismiss banner after 30s, OR cancel auto-dismiss when user clicks dismiss" — current workaround is to transition out + back in (clears all timers + re-arms — wrong semantics).
- "Cancel one timer based on data-driven condition without affecting others."

### §3.2 Syntax options

**Option A — `name=` attribute on `<onTimeout>` + builtin `cancelTimer(name)` call:**

```scrml
<engine for=Banner>
  <Visible rule=.Hidden>
    <onTimeout name="autoDismiss" after=30s to=.Hidden/>
    <button onclick=cancelTimer("autoDismiss")>Keep visible</button>
  </>
  <Hidden></>
</>
```

- Single attribute addition; minimal grammar surface.
- `cancelTimer(name)` is a new builtin; needs §6.7 catalog entry.
- Names are scope-local to the state-child (no cross-state cancellation; preserves per-state-timer semantics).
- Clear-on-exit still applies (named timers cleared on transition like anonymous).

**Option B — `<onTimeout>` is unchanged; introduce `<timer/>` element parallel to `<onTimeout>`:**

```scrml
<engine for=Banner>
  <Visible rule=.Hidden>
    <timer name="autoDismiss" after=30s onfire=${@banner = .Hidden}/>
    <button onclick=cancelTimer("autoDismiss")>Keep visible</button>
  </>
  <Hidden></>
</>
```

- Distinguishes "transition-firing timer" (`<onTimeout>`) from "side-effect timer" (`<timer>`).
- Conflict: `<timer>` is already a top-level state-type (§6.7.5). Reusing the name in engine context risks confusion.
- Larger surface; rejected as redundant with Option A.

**Recommendation (PA): Option A.** Smallest grammar change, follows the existing `<onTimeout>` precedent, gen_statem parity.

### §3.3 SPEC §34 catalog additions (Option A)

- `E-TIMER-NAME-DUPLICATE` — two `<onTimeout name="X">` with the same name in the same state-child body. Error.
- `E-TIMER-NAME-INVALID` — `name=` value is not a valid identifier (PascalCase or camelCase, no spaces/punct). Error.
- (No new error for `cancelTimer("missing-name")` — runtime no-op; matches `clearTimeout(undefined)` browser semantics.)

---

## §4 Feature 2 — Event-timeout watchdog (no-events-for-N-ms)

### §4.1 Motivation

Use cases:

- **Idle detection.** "If no engine transition has occurred in 5 minutes, transition to `.Idle`."
- **Stale-data watchdog.** "If no `.Refresh` event in 2 minutes, transition to `.Stale`."
- **Heartbeat liveness.** "If no `.Heartbeat` in 30s, transition to `.Disconnected`."

§51.12 / §51.0.M `<onTimeout>` doesn't cover this — those reset on state-child entry, not on every transition. Event-timeout is a **machine-wide** watchdog with **transition-resets-the-timer** semantics.

### §4.2 Syntax options

**Option A — Machine-wide `<onIdle>` element at engine root (sibling of state-children):**

```scrml
<engine for=Session>
  <Active rule=.Idle></>
  <Idle></>
  <onIdle after=5m to=.Idle/>
</>
```

- One element at engine root; arms when engine module-init completes; resets on EVERY transition (any rule= write); fires after the silence threshold.
- Tree-shake: only emit machine-wide watchdog runtime when at least one engine declares `<onIdle>`.
- `to=` strict-by-default: target SHALL be a variant in the engine's enum (no per-state rule= constraint since the watchdog is engine-wide).

**Option B — Per-state-child `<onIdle>` (different shape than Option A):**

```scrml
<engine for=Session>
  <Active rule=.Idle>
    <onIdle after=30s to=.Idle/>
  </>
  <Idle></>
</>
```

- Equivalent to existing `<onTimeout>` semantics (reset-on-reentry), just renamed. **Redundant with §51.0.M.** Reject.

**Option C — Both — engine-wide `<onIdle>` AND state-local `<onIdle>` distinguished by placement:**

- Engine-root → machine-wide watchdog (Option A semantics).
- State-child child → equivalent to `<onTimeout>` (Option B redundancy).
- Adds confusion without value. Reject.

**Recommendation (PA): Option A** (machine-wide, engine-root placement only).

### §4.3 SPEC §34 catalog additions (Option A)

- `E-IDLE-DUPLICATE` — multiple `<onIdle>` at engine root. Error (one per engine).
- `E-IDLE-INVALID-VARIANT` — `to=` references a variant not in the engine's enum. Error.
- `E-IDLE-MISPLACED` — `<onIdle>` inside a state-child body (Option B redundancy rejected). Error pointing to use `<onTimeout>` instead.

### §4.4 Semantics

- **Armed at module-init** alongside the variant cell. Initial transition (module-init `_scrml_reactive_set` of the engine variable) resets the timer? Or does module-init count as the "first event"? **PA proposed default: module-init counts as the first event; timer arms with full N ms remaining.**
- **Reset on every transition** — any successful `_scrml_engine_direct_set` or `_scrml_engine_advance` call resets the watchdog.
- **Fires the transition** to `to=.Variant` via the same write path as direct-write (subject to the destination variant's `rule=` validation if such transition is from the current variant).
- **What if the watchdog fire targets a variant the current state-child doesn't allow?** Per §51.0.F the write fires E-ENGINE-INVALID-TRANSITION at runtime. **Question for ratification:** should `<onIdle>` be exempt from rule= validation (machine-wide override) or honor it (consistent semantics)?
  - **Sub-option A1:** rule=-honoring (consistent; user has to ensure every state's rule= permits the watchdog target). Default per spec coherence.
  - **Sub-option A2:** rule=-exempt (machine-wide override; the watchdog ALWAYS lands). Simpler for users but breaks rule= invariants.
- **Recommended sub-option:** A1 (rule=-honoring). Per §51.0.F semantics; user explicitly constructs reachable transitions.

---

## §5 Implementation outline (assumes Options A + A ratified)

### Phase 0 — Verify A5-4 codegen extension points (~30min)
- Read `emit-engine.ts:emitEngineTimersTable` + `_scrml_engine_arm_state_timers` runtime helper. Confirm name-keyed extension is feasible (composite key already includes `index`; replacing index with `name` for named timers is small).
- Read engine-decl SYM walker (PASS 11) to know where new field validation hooks land.

### Phase 1 — Named timer addressing (~2-3h)
- Parser: extend `scanForOnTimeoutEntries` to capture `name=` attr; `OnTimeoutEntry.name?: string` field added.
- Typer: PASS 11 validates duplicate names + identifier shape; fires E-TIMER-NAME-DUPLICATE / E-TIMER-NAME-INVALID.
- Codegen: timer-config table keyed by `name` (when present) instead of index; `cancelTimer(name)` builtin lowers to `_scrml_engine_clear_named_timer(varName, name)`.
- Runtime: new `_scrml_engine_clear_named_timer` helper.
- §6.7 catalog: `cancelTimer` builtin spec entry.

### Phase 2 — Event-timeout watchdog (~3-5h)
- Parser: NEW `scanForOnIdleEntries` similar shape to `scanForOnTimeoutEntries`, but at engine-root scope (not state-child).
- Typer: PASS 11 validates `<onIdle>` placement + duplicate + variant; fires E-IDLE-DUPLICATE / E-IDLE-INVALID-VARIANT / E-IDLE-MISPLACED.
- Codegen: new per-engine `__scrml_engine_<varName>_idle_watchdog` arm helper; threaded into `_scrml_engine_direct_set` + `_scrml_engine_advance` to reset on every commit.
- Runtime: new `_scrml_engine_arm_idle_watchdog(varName, ms, target, table)` + reset on transition.
- Tree-shake: emit watchdog plumbing only when engine has `<onIdle>` (sibling pattern to A5-4 timer-config table).

### Phase 3 — Tests (~1-2h)
- ~10 unit tests for named timer (parser + typer + codegen).
- ~10 unit tests for `<onIdle>` (parser + typer + codegen).
- ~3-5 integration tests (compile + spawn emitted JS under fake timers).

### Phase 4 — Docs (~30min)
- SPEC §51.0.M extension for `name=` attr + new §51.0.M.2 subsection for `<onIdle>`.
- §6.7 catalog entry for `cancelTimer` builtin.
- §34 catalog rows for E-TIMER-NAME-* + E-IDLE-*.
- PA-SCRML-PRIMER §7.1 updates.
- IMPLEMENTATION-ROADMAP §2.5 — mark A5-6 SHIPPED.

---

## §6 Out-of-scope

- **Cross-state-child timer cancellation by name.** Names are scope-local to the state-child. Cancelling a timer from a different state would require global naming + bookkeeping; reject as scope creep.
- **Timer pause/resume.** Out of gen_statem parity scope; not requested.
- **`<onIdle>` per-state-child variant** (Option B above) — rejected as redundant with `<onTimeout>`.
- **Event filtering** (e.g., "reset only on transitions to specific variants"). Out of scope; user can build with multiple `<onIdle>` and explicit transitions.

---

## §7 Open questions for user ratification

**Q1:** Feature 1 syntax — Option A (`name=` on `<onTimeout>`) or Option B (separate `<timer>` element)?

**Q2:** Feature 2 placement — Option A (engine-root only) or Option C (both engine-root + state-child)?

**Q3:** Feature 2 rule= validation — sub-option A1 (rule=-honoring) or A2 (rule=-exempt)?

**Q4:** Module-init reset semantics — does module-init count as the "first event" (timer arms with full N ms) or trigger an immediate fire-check? **PA-proposed default:** count as first event.

**Q5:** Should A5-6 ship as one bundled dispatch (Features 1 + 2 together, ~5-10h) or two separate dispatches (Feature 1 first ~2-3h, Feature 2 later ~3-5h)?

**Q6:** Veto option — is A5-6 actually wanted now, or should it defer to v0.3.0+? Per S67 master-PA inbox: "Could ride alongside C as a follow-on, **or skip**."

---

## §8 Files expected to change (assumes Options A + A ratified)

- `compiler/SPEC.md` (~+80-150 LOC across §51.0.M + new §51.0.M.2 + §34 + §6.7)
- `compiler/src/engine-statechild-parser.ts` (~+50 LOC)
- `compiler/src/symbol-table.ts` (~+40 LOC validation)
- `compiler/src/codegen/emit-engine.ts` (~+80 LOC)
- `compiler/src/runtime-template.js` (~+60 LOC)
- 2-3 NEW test files
- `docs/PA-SCRML-PRIMER.md` (~+10 LOC)
- `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` (~+1 LOC SHIPPED marker)

---

## §9 Dispatch shape

Once syntax is ratified: PA-direct OR small `scrml-dev-pipeline` agent dispatch (~5-10h is at the boundary). Given A5-4 patterns are still hot in PA context, **PA-direct is recommended for Phase 1 (named timer); agent dispatch for Phase 2 (event-timeout watchdog) since that's the larger novel surface.**
