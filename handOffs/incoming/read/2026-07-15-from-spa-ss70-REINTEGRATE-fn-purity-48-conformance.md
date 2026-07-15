# RE-INTEGRATE — sPA ss70 · fn-purity §48/§33 conformance (WAVE A soundness)

**From:** sPA ss70 · **To:** PA · **Date:** 2026-07-15
**List:** `spa-lists/ss70-conformance-fn-purity-48.md`
**Branch:** `spa/ss70` · **branch tip:** `ea10c078` · **conformance-data commit:** `25078a26`
**Base:** `origin/main @ 85efaf77`

## TL;DR
The `fn` pure-contract (§48) moves from **ZERO conformance coverage** to **conformance-COMPLETE on the authorable diagnostic edge**: 7 of the 8 listed `E-FN-*` codes pinned (reject-path pos + clean neg per code), 14 new cases under a new `conformance/cases/fn/` category. Full suite GREEN: **`bun conformance/run.ts` 445 → 459** (all 14 fn cases PASS, 0 fail). **1 code PARKED** (E-FN-007 — source-unreachable parser gap; ready-to-file known-gaps entry below). **No impl#1-vs-SPEC §48 divergence** found for the 7 authorable codes.

## Landed (all @ `25078a26`, category `conformance/cases/fn/`, all `[runtime]`-free codes-half)

| Item | Code | SPEC | pos case | neg case |
|------|------|------|----------|----------|
| 1 | E-FN-001 | §48.3.1 | `sql-access-reject` (`?{}` in fn) | `sql-access-in-function-clean` (`?{}` in a `function` → silent) |
| 2 | E-FN-002 | §48.3.2 | `dom-mutation-reject` (`document.createElement`) | `dom-mutation-pure-value-clean` |
| 3 | E-FN-003 | §48.3.3 | `reactive-write-reject` (`@cell = a`) | `reactive-read-clean` (read-only `@cell`) |
| 4 | E-FN-004 | §48.3.4 | `nondeterministic-call-reject` (`Date.now()`) | `deterministic-call-clean` |
| 5 | E-FN-005 | §48.3.5 | `async-decl-reject` (`async fn`) | `sync-decl-clean` |
| 7 | E-FN-008 | §48.5.2 | `lift-outer-accumulator-reject` | `lift-local-accumulator-clean` (`return ~`) |
| 8 | E-FN-ARROW-BODY | §48.2.1 | `arrow-body-reject` (`fn(n) => …`) | `plain-arrow-clean` (`n => …`) |

- One commit (per-code SHAs not split — pure-additive DATA, all verified together in one suite run; file-delta re-integrates the whole `conformance/cases/fn/` dir).
- **§ correction:** the list cited E-FN-001 as §48.3.3; SPEC §34 catalog (SPEC.md:18034) says **§48.3.1** — cases use the catalog value.
- **Method:** every reject/clean source EMPIRICALLY probed via `compileScrml` before authoring (no case built on a guessed trigger); sources lifted from pre-reviewed source-tests (gauntlet-s19/s20 fn-prohibitions + fn-purity-reactive, fn-constraints, g-fn-shortform-arrow-reject) and checked against the live §48 walker + SPEC.

## Two corrections vs the list (FYI, no action needed)
1. **E-FN-008 neg (item 7):** the list's suggested neg — "lift in a `function`, §48 shorthand exempt → silent" — is **WRONG**. `lift` in a bare `function` fires **E-SYNTAX-002** (confirmed empirically + SPEC.md:6712: "E-SYNTAX-002 therefore fires on a bare `function` body, not on a `fn` body"). Used the SPEC-canonical valid form instead: a `fn`-local `~` closed with `return ~` (§48.5.1) — which IS silent.
2. **E-FN-005 pos** additionally fires `E-ASYNC-NOT-IN-SCRML` (the language-wide §19.9.8 gate). Asserted `codes: ["E-FN-005"]` (superset match — incidental sibling not asserted). Not a divergence; expected.

## PARKED → PA decision: E-FN-007 (§48.4.1)
**Item 6 — divergent-branch `<state>` return without explicit union return type.** NOT authored.

**Why:** the diagnostic exists in the walker (`type-system.ts:23983`) but is **UNREACHABLE from scrml source**. Empirically:
- `fn buildEntity(kind) { if … { let a = <Admin> … return a } else { let u = <User> … return u } }` → **E-FN-007 does NOT fire** (`ERR: (none)`).
- A `match`-arm variant → parser emits "statement boundary not detected" + `E-TYPE-025`; state-literal-in-fn doesn't parse.
- Root: `collectStateInstances`/`collectReturnTypes` need `state-instantiation`/`state-init` nodes (or a `let-decl` with recognized `stateType`). Source-level `let x = <State>` inside a `fn` body does **not** produce them — **E-STATE-COMPLETE is source-unreachable for the same reason** (probed: a `<User>` with an unassigned required field fires nothing from source).
- This matches the **already-`.skip`ped** `compiler/tests/conformance/s32-fn-state-machine/s48-fn.test.js` state-literal tests (CONF-S32-005/006a/006b/007), whose skip note says: *"inline state-literal field-assignment syntax currently parses `name = n` as a logic-level assignment, not as a state field initializer."*
- The E-FN-007 unit test (`fn-constraints.test.js §10`) passes only because it builds **synthetic AST** directly.

**Disposition:** a **parser-reachability gap**, not a conformance-authoring task. E-FN-007 (and E-STATE-COMPLETE) become conformance-authorable once the inline state-literal parser lands (the same Phase-3+ work the skipped tests are gated on). Not an impl-vs-SPEC contradiction — the SPEC rule is sound and the walker is correct; the source→AST path just doesn't reach it yet.

### Ready-to-file `docs/known-gaps.md` entry (PA to file at re-integration — NOT written from this branch)
> **`g-fn-state-diagnostics-source-unreachable`** — E-FN-007 (§48.4.1, divergent-branch `<state>` return) and E-STATE-COMPLETE (§54.6.1) fire only on synthetic AST; no scrml **source** produces the `state-instantiation`/`state-init` nodes their walkers require, because inline state-literal field-assignment (`let p = <T> f = v </>`) parses as logic-level assignment, not a state field initializer. Gated on the Phase-3+ inline-state-literal parser (same gate as the `.skip`ped `s48-fn.test.js` CONF-S32-005/006/007). Until then E-FN-007 / E-STATE-COMPLETE have no conformance-corpus coverage. (Surfaced by sPA ss70, 2026-07-15.)

## Re-integration steps for the PA
1. File-delta `conformance/cases/fn/**` from `25078a26` onto main (pure-additive, 14 dirs / 28 files).
2. Confirm `bun conformance/run.ts` independently GREEN (expect 459/459, +14 vs 445 baseline).
3. File the `g-fn-state-diagnostics-source-unreachable` known-gaps entry above.
4. Retire `spa/ss70` (numbers reserved). List/progress bookkeeping is on the branch @ `ea10c078` (docs-only commit).

*E-FN-006 RETIRED (S32) — correctly not authored.*
