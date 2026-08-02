# progress — route-region teardown (`g-route-timer-poll-not-stopped-on-soft-nav`)

Append-only. Crash-recovery anchor for the S314 build dispatch.

---

## 2026-08-02 — startup

- WORKTREE_ROOT `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a5461872fd68eaac3`
  (verbatim startup `pwd`).
- `git merge main` → already up to date; base `de2f2b24`. Tree clean. `bun install` + `bun run pretest` OK.
- Read: `primary.map.md`, `domain.map.md` §"third lifecycle owner", `structure.map.md`
  §"EMITTED-BUNDLE EXECUTION BOUNDARY", `dependencies.map.md` §"Module-init vs the soft-nav
  rehydrator". SPEC §6.7.1a, §6.7.2, §6.7.2.1, §20.8.1, §20.8.2, §20.8.5–§20.8.8 in full.

## 2026-08-02 — FIRST TASK (the gate): module-init → `_scrml_region_cleanups` IS drained on the swap

**Result: PASSES. The approach is not invalidated. Proceed.**

Two independent confirmations:

1. **Emitted position.** Compiled case C (`<timer>` lexically inside `<outlet>`); the emitted
   `_scrml_region_cleanups.push(() => _scrml_timer_stop(...))` sits at **module-init** — before any
   `function _scrml_boot` (in this fixture the shell chunk emits no boot fn at all; in general
   `emitReactiveWiring`'s lines are pushed by `emit-client.ts` at `:2355`, ahead of
   `emitEventWiring` at `:2475`).
2. **Execution.** `compiler/tests/browser/browser-navigate-soft-nav.test.js -t "outlet-resident"`
   is GREEN at HEAD: 2 live timers at boot → 1 after the nav. The drained timer is the module-init
   one. `_scrml_teardown_region` is a plain drain of a global array; it does not care when the
   push happened.

## 2026-08-02 — A/B/C differential re-confirmed at `de2f2b24` (emit side)

| # | shape | emitted branch | position |
|---|---|---|---|
| A | `<timer>` at shell top level | `_scrml_register_cleanup` | module-init |
| B | `<timer>` in `pages/reports.scrml` | `_scrml_register_cleanup` | module-init — **the defect** |
| C | `<timer>` lexically inside `<outlet>` | `_scrml_region_cleanups` | module-init |

## 2026-08-02 — R26 empirical BASELINE (executed bundle, happy-dom, real MPA)

shell(`<timer>`) + `pages/reports.scrml`(`<timer>`) + `pages/about.scrml`. Boot shell, nav
→/reports (chunk injected + executed), →/about, →/reports.

```
BOOT       shellTick=4   registry={scope_3:[timer_2:LIVE]}
AT/reports rtick=5  shellTick=9  registry={scope_3:LIVE, scope_6:LIVE} regionCleanups=1
AT/about   rtick 7 -> 13  (DELTA 6)   <-- THE LEAK, reproduced by execution
RE-ENTER   rtick 15 -> 20 (DELTA 5)   chunk NOT re-injected (module-init does not re-run)
```

The route timer keeps ticking against a detached region. Shell timer also ticks (correct).

## 2026-08-02 — Edge 1 BUILT, MEASURED, REVERTED. ⛔ STOP-IF-BIGGER fired.

**Predicate implemented:** `classifyMarkupNodes`'s `insideOutlet || tag === "outlet"` →
`insideRegion || tag === "outlet" || tag === "page"`, flag renamed `_outletResident` →
`_regionResident`. `<page>` is `kind:"markup" tag:"page"` in BOTH forms (multi-file route root and
single-file `<program>` child), so one ancestry test covers both.

**Corroboration found while doing it:** `collectShellCellNames` in the SAME file already uses
`<outlet>` OR `<page>` for cells. The two walks had silently diverged; the cell walk is right.

**Emit result — exactly the required differential:** A held (`_scrml_register_cleanup`), B FLIPPED
(`_scrml_region_cleanups`), C held.

**Then it was executed, and it fails three ways:**

| | HEAD | with the flip |
|---|---|---|
| AT/reports (arrival) | `scope_6` LIVE, ticking | **`scope_6` GONE — dead on arrival** |
| AT/about (leave) | `rtick` DELTA 6 — the leak | `rtick` DELTA 0 |
| RE-ENTER | `rtick` DELTA 5 | `rtick` DELTA 0 — **still dead** |
| shell timer throughout | DELTA 6 / 7 | DELTA 6 / 7 — **case A held** |

1. **Dead on arrival.** `_scrml_nav_load_chunks` executes the INCOMING chunk before
   `onDone → runSwap → swap → _scrml_teardown_region`, so the outgoing region's drain kills the
   incoming route's just-started timer.
2. **No re-entry.** `_scrml_nav_missing_chunks` keys `have` off the live document's `script[src]`, so
   an already-loaded chunk is never re-injected; `_scrml_rehydrators` holds only `_scrml_nav_rewire`.
3. **Single-file form.** Both `<page>` children emit at ONE module-init in ONE chunk (compiled and
   read), so the first nav drains every page including the one being entered.

**Decision.** (1) is bounded (stage pushes while `_scrml_chunk_loading > 0`). (2) is not: it turns the
leak into STALENESS — the failure mode §20.8.8's own rationale says Pole C was chosen to avoid — on
every revisit, silently. Landing the leave edge alone is a regression, not a partial fix. Reverted the
predicate; kept the comment corrections.

**Edge 2 is the STOP-IF-BIGGER shape**, on two independent grounds: §20.8.8 step 3's *declaration
order across the whole region body set* forces one ordered registry that `emit-reactive-wiring.ts` +
`emit-client.ts` + `emit-logic.ts:3654` (`cleanup-registration`) all funnel through; and route
identity `(route, params)` has no runtime representation at all in the single-file form.

## 2026-08-02 — LANDED

- `compiler/src/runtime-template.js` — `_scrml_teardown_region` doc-comment scoped (S313-N6).
  Kept backtick-free; re-verified by parsing `SCRML_RUNTIME`.
- `compiler/src/codegen/emit-reactive-wiring.ts` — three comments scoped: `emitLifecycleNode`
  ("the leak is closed" → branch scope + enter gap), `emitInputStateNode`, and a new SCOPE note on
  `classifyMarkupNodes`'s `insideOutlet` recording all three measured traces.
- `SCOPING.md` — new "⛔ MEASURED S314-BUILD" section; leave-edge sizing bullet superseded; header
  banner.
- `CONFORMANCE-CN1-CN10.md` — CN-1..CN-9 still unauthorable; false-status claims 1+2 CORRECTED.

**NOT landed (deliberate):** the predicate flip; the `_scrml_chunk_loading` staging fix; CN-1..CN-9.
