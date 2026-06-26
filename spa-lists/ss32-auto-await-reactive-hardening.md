# ss32 — auto-await reactive-server hardening

**Fill-note:** two flogence-surfaced gaps in the per-statement auto-await IIFE (the S221 ss22 mechanism that replaced whole-body CPS deferral). Both touch the same `emit-client.ts` auto-await region → **SEQUENTIAL within-list.** Item 2 is **survey-first** (needs a witnessed repro; may close NOT-REPRODUCED per S138 reverse).

**Shared ingestion:** the per-statement auto-await IIFE emission in `emit-client.ts` (~the `:2044` catch-less IIFE that wraps a reactive-server assignment). The symptom class is "a failed/racing reactive-server assignment produces a browser-level error, not a scrml error."

**coreFiles:** `compiler/src/codegen/emit-client.ts` (auto-await IIFE) · the CPS/`!{}` error-arm routing it should reuse · `compiler/tests/`.

**Brief reminders:** R26 empirical on real flogence-shaped source (S138, both directions). flogence reply owed when item 1 lands. Full `bun run test` before DONE.

## Items

1. **g-auto-await-reactive-server-no-error-arm** (MED) `[status=open]`
   - Symptom: the per-statement auto-await IIFE is **catch-less** → a failed reactive-server assignment silently drops (browser `unhandledrejection`, no scrml error surface). flogence S15 residual.
   - Footprint: give the IIFE an error arm — route the rejection through the statement's `!{}` handler if present, else a scrml-level default error (NOT a silent drop). Mirror the §5.2.2 / CPS error-routing the rest of the pipeline uses.

2. **g-auto-await-read-before-resolve-race** (LOW, **survey-first**) `[status=open]`
   - Symptom: a data-DEPENDENT statement after a reactive-server assignment reads the cell synchronously BEFORE the await resolves (flogence-triage tangential, flag-only — no witnessed repro yet).
   - **STOP-first:** reproduce on real source before building (S138 reverse). If it doesn't reproduce → file NOT-REPRODUCED + close, don't dispatch a fix. If it does → the per-stmt auto-await ordering needs a data-dependency barrier (the ss22 mechanism already isolates data-independent stmts; this is the dependent-read corner).
