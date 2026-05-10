# Phase A7 Step A5-4 + A5-5 — `<onTimeout>` Codegen + Computed-Delay Relaxation

**Authored:** S77 — 2026-05-10
**Authorization:** S77 user verbatim 2026-05-10: "A5-4 + A5-5 bundled" (chosen over legacy-only or hold).
**Roadmap reference:** `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` §2.5 Phase A5 (S67 ratified engine + temporal extensions).
**Estimated effort:** ~12-17h (A5-4 ~10-15h + A5-5 ~1.5-2.5h).
**Dispatch shape:** single bundled dispatch — A5-5 work piggybacks naturally on the A5-4 codegen surfaces (both consume the same `OnTimeoutEntry` shape and emit into the same timer-arming machinery).

---

## §1 What ships

### A5-4 — `<onTimeout>` codegen (engine surface)

End-to-end emission for the `<onTimeout after=DURATION to=.Variant/>` element on engine state-children. SPEC §51.0.M (S67 amendment, 2026-05-07).

**Surface in:** `compiler/src/symbol-table.ts`'s `OnTimeoutEntry` (`{after: string, to: string, rawOffset: number}`), aggregated as `engineMeta.stateChildren[i].onTimeoutElements: OnTimeoutEntry[]` and as a file-scope flat list `engineMeta.onTimeoutElements: Array<{stateChildTag, entry}>`. Populated by A5-2 (parser) + A5-3 (typer walker).

**Surface out:** runtime calls to `_scrml_machine_arm_timer(name, ms, target, meta)` and `_scrml_machine_clear_timer(name)` (already exist in `compiler/src/runtime-template.js:133-160`; the runtime backbone is reused per SPEC §51.0.M cross-ref).

**Behavioral contract (per SPEC §51.0.M Semantics):**

1. Timer is **armed on entry** to a state-child whose body contains `<onTimeout>` element(s).
2. Timer is **cleared on exit** (whether via `rule=` transition, `<onTimeout>` fire, or external write).
3. **Re-entry** (entering the same state-child while a timer is armed) clears + re-arms — fresh timer per entry. Per SPEC §51.12.4.
4. **Multiple `<onTimeout>` per state-child** legal — each arms an independent timer keyed uniquely.
5. **Timer fire** sets the engine variable to `to=.Variant` via the same write-path as a direct write — the `to=` legality check is enforced by the engine's transition table at write time (compile-time fired by A5-3 already; runtime is defensive).

### A5-5 — Computed-delay relaxation (both surfaces)

Lift the literal-only constraint on duration values per SPEC §51.12.3.1 (S67 amendment).

**Two surfaces:**

1. **Legacy `<machine>` form:** `.From after ${expr}<unit> => .To` (parsed in `type-system.ts:parseMachineRules`).
2. **New `<engine>` `<onTimeout>` form:** `<onTimeout after=${expr}<unit> to=.Variant/>` (parsed in `engine-statechild-parser.ts:scanForOnTimeoutEntries`).

**Per spec:**
- Static literal cases (e.g., `after 30s`) **retain the existing constant-folded path** (`Math.round(n * multiplier)` at compile time).
- Computed cases emit **per-arm runtime computation** feeding the same `_scrml_machine_arm_timer(name, ms, ...)` call. The runtime function ALREADY accepts `ms` as a runtime argument — no runtime change needed.
- Type discipline: SHALL produce non-negative number. Static check when statically known (literal-arithmetic constant-fold); runtime values that are negative or NaN are clamped at zero by `Math.max(0, value)|0` semantics. Dev-mode warning for negative-runtime is **deferred to A1c codegen** per SPEC §51.12.3.1 (not in this dispatch).

**Unit handling:** `${expr}<unit>` syntax — the unit suffix (`ms`/`s`/`m`/`h`) follows the `${...}` block. Multiplier (1/1000/60000/3600000) baked into emitted JS as `(expr) * <multiplier>` then clamped + rounded.

---

## §2 Decomposition (within the dispatch)

### Phase 0 — Survey + audit (~30-60 min)

**Tasks:**

- Read SPEC §51.0.M in full (lines 20848-20957).
- Read SPEC §51.12 + §51.12.3.1 in full (lines 22517-22625).
- Read existing `_scrml_machine_arm_timer` + `_scrml_machine_clear_timer` runtime (`compiler/src/runtime-template.js:120-160` and surrounding).
- Read existing legacy-machine afterMs codegen call sites (`compiler/src/codegen/emit-machines.ts:491,711` + the surrounding writeguard).
- Read `engine-statechild-parser.ts:scanForOnTimeoutEntries` (lines 254-299) to confirm `OnTimeoutEntry.after` raw-text shape.
- Read `symbol-table.ts:OnTimeoutEntry` (line 348) + the typer's existing E-ENGINE-INVALID-TRANSITION fire-site for to= (line ~5985).
- Confirm: are there ANY existing tests that exercise `<onTimeout>` from compileScrml end-to-end? (Probably no — A5-4 is the first dispatch to wire it.)

**STOP gate:** if Phase 0 surfaces any precondition not yet met (e.g., parser doesn't preserve the `${...}` shape into `OnTimeoutEntry.after`, or the typer aggregation is broken), HALT and report. PA decides whether to widen scope or back out.

### Phase 1 — A5-4 implementation: `<onTimeout>` codegen (~6-9h)

**1a. Duration parser (SHARED helper — used by both A5-4 and A5-5)**

Add `parseAfterDuration(raw: string): {kind: "literal", ms: number} | {kind: "computed", exprText: string, unitMultiplier: number} | {kind: "invalid", reason: string}` to a new module `compiler/src/codegen/parse-after-duration.ts` (or extend an existing helper file). The helper accepts:
- Literal: `\d+(\.\d+)?(ms|s|m|h)` → `{kind: "literal", ms: Math.round(n * multiplier)}`.
- Computed: `\$\{(.+?)\}(ms|s|m|h)` (single-level brace match) → `{kind: "computed", exprText: <inner>, unitMultiplier: <number>}`.
- Invalid: anything else → `{kind: "invalid", reason}`.

Spec example `${Math.min(1000 * 2 ** @attempt, 30000)}ms` works because `${...}` in the source has no NESTED `{...}` — JS expressions inside use parens. If a future use case needs nested braces, helper can be upgraded to depth-tracking parsing; for now, single-level brace match covers the spec examples.

**1b. Engine-side per-state timer-config table**

Per engine, build a per-state-tag JS object literal:
```js
const __scrml_engine_<varName>_timers = Object.freeze({
  "Loading": [
    { ms: 30000, target: "TimedOut" },
    // OR for computed:
    { msExpr: "() => Math.max(0, (Math.min(1000 * 2 ** _scrml_reactive_get('attempt'), 30000)) * 1)|0", target: "Retry" },
  ],
  "Idle": [],
  // ...
});
```
- Sibling to `__scrml_engine_<varName>_transitions` (already emitted by C12 in `emit-engine.ts`).
- For literal entries: `ms` is a literal number.
- For computed entries: `msExpr` is a JS arrow-fn that returns the runtime ms value. Reactive cell reads inside the expression go through `_scrml_reactive_get(<encodedName>)` so dependency tracking works at the call site (the runtime function evaluates `msExpr()` at arm time).
- Tree-shake invariant: emit the table ONLY for engines whose `engineMeta.onTimeoutElements` (the file-scope aggregate) is non-empty. Engines with zero `<onTimeout>` elements emit no timer table (zero cost).

**1c. Engine timer-arm/clear runtime helper**

Add to `compiler/src/runtime-template.js`:
```js
function _scrml_engine_arm_state_timers(varName, stateName, timersTable) {
  const list = timersTable[stateName];
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const ent = list[i];
    let ms;
    if (typeof ent.ms === "number") {
      ms = ent.ms;
    } else if (typeof ent.msExpr === "function") {
      const v = ent.msExpr();
      ms = (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0;
    } else {
      continue;
    }
    const timerKey = varName + "::" + stateName + "::" + i;
    _scrml_machine_arm_timer(timerKey, ms, ent.target, { fromVariant: stateName });
  }
}
function _scrml_engine_clear_state_timers(varName, stateName, timersTable) {
  const list = timersTable[stateName];
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const timerKey = varName + "::" + stateName + "::" + i;
    _scrml_machine_clear_timer(timerKey);
  }
}
```
- The composite timer key (`varName::stateName::i`) keeps the existing `_scrml_machine_timers` map flat + per-engine isolated.
- The fire callback (currently in `_scrml_machine_arm_timer`) sets the variable via `_scrml_reactive_set` — for engines, that needs to flow through the engine's write-guard (`_scrml_engine_direct_set` so the transition-table check fires). Two options: (A) extend `_scrml_machine_arm_timer` to accept an optional `setterFn` parameter; (B) wrap target writes in a callback. Implementor choice — Phase 0 survey decides; the spec is silent.

**1d. Wire arm-on-entry + clear-on-exit at every engine commit-path site**

Sites that commit a new variant value to an engine variable:
1. `_scrml_engine_direct_set` (runtime — `runtime-template.js:2173`) — direct write `@var = .X`.
2. `_scrml_engine_advance` (runtime — `runtime-template.js:2161`) — `.advance(.X)`.
3. The C13 hook-firing post-commit code in `emit-engine.ts` (around line 545, the `emitEngineWriteGuard` shape) — already runs after the cell write.

Cleanest pattern: extend `_scrml_engine_direct_set` and `_scrml_engine_advance` to ALSO take a timers table (analogous to how they take a transitions table) and call `_scrml_engine_clear_state_timers(varName, prev, timersTable)` + `_scrml_engine_arm_state_timers(varName, target, timersTable)` post-commit, internally. Codegen call sites pass the timers table identifier alongside the transitions table:
```js
_scrml_engine_direct_set("loadPhase", target, __scrml_engine_loadPhase_transitions, __scrml_engine_loadPhase_timers);
```
- Tree-shake: when no timers table exists for the engine (no `<onTimeout>` in any state-child), pass `null` or omit; runtime defaults the parameter and skips the timer calls.

**1e. Initial-arm at engine module-init**

When the engine variant cell is initialized (`emitEngineVariantCellInit` in `emit-engine.ts:412`), if the initial state has `<onTimeout>` entries, arm them at module-init time. Add one line to the cell-init emission:
```js
_scrml_engine_arm_state_timers("loadPhase", "Idle", __scrml_engine_loadPhase_timers);
```
Conditional on the timers table existing for this engine.

### Phase 2 — A5-5 implementation: computed-delay (~1.5-2.5h)

**2a. Use `parseAfterDuration` from Phase 1a** for both legacy machine + onTimeout duration parsing.

**2b. Legacy `<machine>` typer extension**

In `parseMachineRules` (`type-system.ts` ~line 2596-2617), replace the literal-only regex with a call to `parseAfterDuration`. Update `TransitionRule` shape:
```ts
interface TransitionRule {
  // ... existing fields ...
  afterMs: number | null;       // populated for literal duration cases
  afterExpr: string | null;     // populated for computed duration cases
                                 // (a JS arrow-fn body returning ms)
}
```
Both cases mutually exclusive — when `afterMs !== null`, `afterExpr === null` and vice versa. `null/null` means no `after` clause.

**2c. Legacy `<machine>` codegen extension**

In `emit-machines.ts:491,711`, replace `${r.afterMs}` with a helper:
```ts
function emitDurationLiteral(rule: TransitionRule): string {
  if (rule.afterMs !== null) return String(rule.afterMs);
  if (rule.afterExpr !== null) {
    return `(function(){ const v = ${rule.afterExpr}; return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0; })()`;
  }
  return "0"; // defensive — non-temporal rules are filtered earlier
}
```
The `(function(){...})()` IIFE wraps the runtime computation + clamp; emitted inline at the `_scrml_machine_arm_timer` call site.

**2d. Engine onTimeout codegen extension (rides Phase 1b)**

The per-state timer-config table emission already supports the `{kind: "computed"}` branch — see Phase 1b's `msExpr` shape. A5-5's contribution to Phase 1b is the `{kind: "computed"}` branch — Phase 1b already accounted for it.

### Phase 3 — Tests (~3-5h)

**Test files to create:**

1. `compiler/tests/unit/engine-ontimeout-codegen.test.js` — A5-4 unit tests:
   - Per-state timer table emission (literal + computed forms; multiple per state; tree-shake when zero).
   - Module-init arm for initial state with `<onTimeout>`.
   - Arm-on-entry + clear-on-exit wiring through `_scrml_engine_direct_set` + `_scrml_engine_advance`.
   - Independent timer keys for multiple `<onTimeout>` per state-child.
2. `compiler/tests/unit/computed-delay.test.js` — A5-5 unit tests:
   - Legacy `<machine>` `.From after ${expr}s => .To` parses + emits computed form.
   - `<onTimeout after=${expr}ms to=.X/>` parses + emits computed form.
   - Static literal path retained (negative test: literal cases should NOT route through the computed IIFE).
   - Unit multiplier correctness across `ms`/`s`/`m`/`h`.
   - Negative/NaN runtime clamping.
3. `compiler/tests/integration/engine-ontimeout-end-to-end.test.js` — A5-4 + A5-5 integration:
   - Compile a small fixture using `<onTimeout>` with literal + computed durations; spawn the emitted JS in a controlled environment (using fake-timers or a real setTimeout); verify timer fires after the expected ms.
   - Cross-state transition: arming + clearing across multiple state-child entries.

**Test invariant target:** all new tests pass; full suite delta is 0 fail beyond the 6 known-environmental fails on this machine (3 self-host artifacts not built; 3 test-bind A6-5 integration tests with `/home/bryan-maclee/` cwd).

### Phase 4 — Documentation + SHIP (~1h)

1. Update `docs/PA-SCRML-PRIMER.md` §7.1 — add a one-line note that A5-4 + A5-5 are SHIPPED (currently the section says implementation is pending).
2. Update `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` §2.5 — mark A5-4 + A5-5 as SHIPPED.
3. Final regression sweep (`bun run test`); record delta in `progress.md`.
4. SHIP commit: `feat(a5-4-5): SHIP — <onTimeout> codegen + computed-delay relaxation across both temporal surfaces`.

---

## §3 Authorized Decisions (no Phase-0 STOP needed)

1. **Helper module placement: `compiler/src/codegen/parse-after-duration.ts`** (new). Sibling to other codegen helpers. Both legacy-machine codegen and engine-onTimeout codegen import from it. Keeps the shared duration-parsing logic in one place.

2. **Computed-form regex permits single-level `${...}`** — `\$\{[^}]*\}<unit>`. Spec examples `${@backoffDelay}ms` and `${Math.min(1000 * 2 ** @attempt, 30000)}ms` work because they use parens (not nested braces) inside the expression. If future code needs nested braces, the helper can be upgraded to depth-tracking parsing; not in this dispatch's scope.

3. **Runtime clamp on negative/NaN: `Math.max(0, v)` then `Math.round(v)`** (or equivalent `(v >= 0 ? Math.round(v) : 0)`). Per SPEC §51.12.3.1 "Runtime values that are negative or NaN are clamped at zero — equivalent to firing on the next tick per `setTimeout` semantics."

4. **Dev-mode warning for negative-runtime is OUT OF SCOPE.** Per SPEC §51.12.3.1: "deferred to A1c codegen; not part of A5-1." A1c is the codegen wave; this dispatch is part of A1c but the dev-mode warning specifically requires the dev-mode infrastructure already in place for `_scrml_dev_warn` calls. If that infrastructure isn't reusable as-is, defer to a separate dispatch.

5. **Timer-key encoding: `varName + "::" + stateName + "::" + index`.** The `_scrml_machine_timers` map is keyed flat across all timers (machine + engine combined); composite keys avoid collision when an app has both legacy `<machine>` rules and engine `<onTimeout>` elements on overlapping state names.

6. **Initial-arm at module-init.** When the engine cell initializes to a state with `<onTimeout>` entries, those timers arm immediately. Per SPEC §51.0.M Semantics line 20901: "armed on entry to the state-child". Module-init is the first entry.

7. **`to=` legality runtime defensive only.** A5-3 typer fires E-ENGINE-INVALID-TRANSITION compile-time when `to=` is not in the surrounding state-child's `rule=` set. Runtime defensive: the existing `_scrml_engine_check_transition` call inside `_scrml_engine_direct_set` will catch any timer-fire that violates the table (impossible if compile-time check is correct, but defense in depth).

8. **No new §34 catalog rows.** All diagnostics reuse existing codes (`E-ENGINE-INVALID-TRANSITION`, `E-ENGINE-RULE-INVALID-VARIANT`, `E-ENGINE-021` for invalid duration). A5-1 already added the necessary catalog rows.

---

## §4 Files expected to change

- `compiler/src/codegen/parse-after-duration.ts` (NEW, ~80 LOC)
- `compiler/src/codegen/emit-engine.ts` (~+200 LOC — timer table emission, arm/clear wiring, initial-arm)
- `compiler/src/codegen/emit-machines.ts` (~+30 LOC — afterMs/afterExpr branching at the 2 fire-sites)
- `compiler/src/runtime-template.js` (~+30 LOC — engine arm/clear helpers)
- `compiler/src/type-system.ts` (~+15 LOC — TransitionRule shape extension + parseMachineRules call to parseAfterDuration)
- `compiler/SPEC.md` (no changes — A5-1 already landed the spec text)
- `docs/PA-SCRML-PRIMER.md` (~+2 LOC — mark A5-4 + A5-5 as shipped)
- `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` (~+2 LOC — mark shipped)
- `docs/changes/phase-a7-step-a5-4-5-ontimeout-codegen-and-computed-delay/progress.md` (NEW, dispatch's running log)

**NEW test files:**
- `compiler/tests/unit/engine-ontimeout-codegen.test.js` (NEW, ~30-40 tests)
- `compiler/tests/unit/computed-delay.test.js` (NEW, ~15-20 tests)
- `compiler/tests/integration/engine-ontimeout-end-to-end.test.js` (NEW, ~5-8 tests)

---

## §5 Out-of-scope (DEFERRED)

- **Dev-mode warning for negative-runtime delay** (per spec, deferred from A5-1 explicitly).
- **`<onTimeout>` inside `<match>` block-form arms** firing E-STRUCTURAL-ELEMENT-MISPLACED — A5-3 deferred this on markup-walker precondition; not blocked by codegen.
- **History-aware timer state** — when `history` attribute (§51.0.N) restores an inner state, the timer should re-arm. Out of A5-4 scope; depends on history attribute lowering (separate Wave-4 step).
- **Cumulative timer model** — explicitly rejected by SPEC §51.12.4 ("a cumulative model … is not supported"). No code needed; just don't emit cumulative behavior.

---

## §6 Risks + mitigations

1. **Risk:** the `_scrml_machine_arm_timer` runtime fire-callback path may not flow through engine write-guards (it currently does `_scrml_reactive_set` directly, which bypasses `_scrml_engine_direct_set`'s transition-table check). **Mitigation:** Phase 1c provides a `setterFn` parameter to thread the engine-aware setter through. Phase-0 survey verifies the current call-site shape.

2. **Risk:** computed-delay regex `\$\{[^}]*\}<unit>` matches the FIRST `}` even when the expression contains a string literal with `}` in it. **Mitigation:** spec examples don't trigger this; if future use-case demands, helper upgrades to depth-tracking. Document this limitation in the helper's JSDoc.

3. **Risk:** test fixture for end-to-end integration (Phase 3) may be flaky if it uses real `setTimeout` timing (system load can delay). **Mitigation:** use Bun's `setSystemTime` / mocked timers OR use a generous timing tolerance (e.g., assert timer fires within 100-500ms after expected ms).

4. **Risk:** the file-delta landing protocol (S67 worktree-as-scratch) may reveal main moved while the dispatch ran — primer §13.7 / shared-table conflicts known friction. **Mitigation:** PA dispatches solo (no parallel sibling work touching the same files); landing reviews diff before checkout.

---

## §7 Dispatch shape

**Single agent, scrml-dev-pipeline, worktree-isolated.** The brief explicitly references this SCOPE doc + the relevant spec sections + the existing files-to-extend list. Agent runs Phase 0 + Phases 1-4 in one continuous arc with progress.md updates after each Phase. Final output: SHIP-ready file delta on the agent's worktree branch.

**Worktree-as-scratch landing (S67 protocol):** PA reviews `git diff main..<agent-branch> -- <FILES_TOUCHED>`, filters agent-side-stale-views, then `git checkout <agent-branch> -- <files>` from main, single PA-authored SHIP commit.
