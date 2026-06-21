# DROP-DRYRUN — phase-b2-samples-curate

Change-id: `phase-b2-samples-curate` (sPA ss11 item 8).

**DRY-RUN ONLY. NOTHING IS DELETED IN THIS DISPATCH.** Per §D.2, drops require explicit user
authorization. This file lists DROP candidates with full paths + a one-line reason. The sPA
escalates this list to the user; the actual `rm` happens ONLY after the user authorizes, in a
separate dispatch.

A DROP candidate is a positive-framed sample that tests an OBSOLETE / REMOVED / SPEC-FORBIDDEN
shape with no current analog, OR a dead gauntlet friction artifact testing nothing currently
meaningful. (Negative tests that correctly fail are NOT drop candidates — they are doing their
job and are kept. Samples that are correct-per-SPEC but fail on a compiler bug are NOT drop
candidates either — they are kept and surfaced as BLOCKED-ON-COMPILER; see CLASSIFICATION.md.)

## DROP candidates (9)

| # | Full path | Reason |
|---|-----------|--------|
| 1 | `samples/compilation-tests/gauntlet-s20-meta/meta-bun-eval-001.scrml` | Tests user-facing `bun.eval()` inside `^{}` — RETIRED S130 Approach C (F-003); `bun.eval()` is compiler-internal only (§30.1 note). Canonical replacement is the closed `^{}` primitive set (`reflect`/`emit`/`emit.raw`). No current analog for the user-facing surface this file tests. |
| 2 | `samples/compilation-tests/meta-004-clean-config.scrml` | Uses `bun.eval()` inside `^{}` to build a config object referenced in markup — RETIRED user-facing surface (S130 F-003). The `E-SCOPE-001` is now-correct behavior (the binding `bun.eval` produced no longer exists). |
| 3 | `samples/compilation-tests/meta-005-nested-meta.scrml` | Uses `bun.eval()` inside `^{}` (RETIRED, S130 F-003) AND nests `^{}` inside `^{}` (forbidden, §22.11 E-META-009). Two removed/forbidden shapes; no current analog. |
| 4 | `samples/compilation-tests/meta-010-reflect-with-config.scrml` | Uses `bun.eval()` inside `^{}` to set `APP_CONFIG` (RETIRED user-facing surface, S130 F-003). |
| 5 | `samples/compilation-tests/gauntlet-r10-zig-buildconfig.scrml` | Emits `bun.eval(` into CLIENT JS → `E-CG-006` server-only-pattern security gate. Depends on the retired user-facing `bun.eval()` surface (S130 F-003). Large gauntlet port built around the removed primitive. |
| 6 | `samples/compilation-tests/gauntlet-r10-solid-spreadsheet.scrml` | Calls raw JS `eval(resolved)` at runtime for formula evaluation. JS-host `eval` is not a scrml surface (§22.12 Approach C closes JS-host eval). The file's own comment notes "scrml has no compile-time safe eval." No clean migration without authoring a safe expression parser; gauntlet friction artifact. |
| 7 | `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-optchain-method-call-039.scrml` | The subject (`?.()` optional-chain method call) is built on `type Handler:struct = { onFire: () => void }` — a struct with a function-typed field, which is REJECTED at declaration (S174 ruling; `E-STRUCT-FUNCTION-FIELD`, §14.3/§34). The entire test setup hinges on the now-forbidden shape. (NOTE: the bare `?.()` optional-chain-method intent could be re-tested with a non-function-field subject in a fresh fixture — surfaced for the author.) |
| 8 | `samples/compilation-tests/gauntlet-s20-meta/meta-nested-deep-001.scrml` | Tests nested `^{}` inside a compile-time `^{}` and claims "Should compile clean" — but SPEC §22.11 normatively makes this `E-META-009` (Error; "not supported in this revision"). Tests a SPEC-forbidden shape it expected to pass; no current analog (flattening into one block destroys the "deeply nested" subject). |
| 9 | `samples/compilation-tests/gauntlet-r10-bun-admin.scrml` | `E-RI-002` — a server-escalated function assigns to a `@` reactive cell (server cannot mutate client state). A gauntlet friction artifact documenting a real architectural constraint (its own FRICTION NOTE headers describe the dev hitting it); it tests no passing feature. Restructuring to satisfy the constraint would rewrite the file's premise. |

## Borderline — NOT dropped, flagged for author judgment

- `samples/compilation-tests/gauntlet-s20-channels/channel-shared-state-001.scrml` (E-CHANNEL-SHARED-MODIFIER) — comment EXPLICITLY says the retired `@shared total = 0` line is "a deliberate v0.2 shape preserved for documentation." It correctly fails (the modifier is retired). This is effectively a documentary/negative test; KEPT. If the author wants it gone, it is a clean drop, but its preserved-for-documentation intent argues KEEP.

## Companion docs

- `CLASSIFICATION.md` — full pass/fail counts + the 177 FAIL list + Phase-2 disposition summary (EDIT/REWRITE applied, BLOCKED-ON-COMPILER table).
- `progress.md` — append-only working log.
