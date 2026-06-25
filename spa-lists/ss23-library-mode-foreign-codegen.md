# sPA ss23 — library-mode + foreign-inline codegen seam

**Launch:** `read spa.md ss23` · **Branch:** `spa/ss23` · **Worktree:** `../scrml-spa-ss23`

**Fill:** the "non-`<program>` codegen context" cluster — a library/pure-fn `.scrml` (no `<program>`) can't run `?{}` SQL or `!{}` host-containment, and the `_{}` foreign-inline has a deferred shadowing diagnostic. The gap entries EXPLICITLY name this cluster ("library-mode codegen seam — consider co-scoping"). NEW S221. **flogence is the first consumer** (scrml-authored tooling on the TS bridge today, wants SQL). The W5a/W5b core is the largest single item on the S221 board (~13-24h) — this list is **mostly one big build + 2 riders**.

## Shared ingestion
The **library-mode codegen path** (`--mode library`): how a no-`<program>` file emits exports, where the `.server.js` route-wrapper is suppressed (S145 landed this shaping), and the `<db src>`/`?{}` resolution + `!{}` call-site-handler lowering that currently run **program-mode-only**. **READ FIRST:** the SCOPE doc `docs/changes/library-mode-db-w5ab-2026-06-25/SCOPE.md` (W5a/W5b sub-steps) + the S145 library-mode emission shaping (`--mode library` + §21.5.1 export-modifier parsing). SPEC: §44.7.1 (module-with-db-context, ratified) + §21.5.

## Core files
`compiler/src/route-inference.ts` · `codegen/emit-server.ts` · `db-driver.ts` · `module-resolver.ts` · `api.js` / `codegen/index.ts` (library auto-detect) · the `!{}` call-site-handler lowering pass · the `_{}` foreign-inline emitter

## Items (least-ingestion-first)

1. **`g-safecall-bang-handler-not-lowered-in-library-mode`** (MED) `[status=open]` — `safeCall(...) !{ | ::Thrown(...) :> … }` (§19 host-containment, the public try/catch replacement) lowers in program mode but emits VERBATIM scrml `!{}` under `--mode library` → `E-CODEGEN-INVALID-JS`. PA reverse-R26 CONFIRMED on `df6f747b` (byte 238). **Fix:** wire the `!{}` call-site-handler lowering into the library-mode codegen path (it's program-mode-only). **Smaller** — wire an EXISTING lowering into a second path. Reporter giti (repro `/tmp/giti-triage/repro-26-f3-safecall-library.scrml`).
2. **`g-library-mode-sql-no-db-context`** (MED, the big build) `[status=open]` — a library `.scrml` can't run `?{}` (SQL needs a db-resolution scope; a library has no `<program db>` ancestor). §44.7.1 ratifies the fix (the library declares its OWN `<db src>`). **Built S145:** emission shaping + §21.5.1 modifier parsing. **Remaining = W5a + W5b:** W5a auto-detect-library (classify a no-`<program>`-exports file as library w/o the flag; ~3-6h) + W5b cross-file `?{}`-resolve against the file's own `<db src>` + cross-file db-context travel + narrow `E-SQL-009` to the no-`<db>` case (~10-18h). EXTENDS existing `<program db>` resolution infra — **survey-first** (likely less). Full sub-steps in the SCOPE doc.
3. **`g-foreign-inline-crossing-shadow`** (LOW) `[status=open]` — an inline `_{}` `in:{x}` crossing name that shadows a slice-local `const x` emits `(async (x) => { const x = ... })(...)` → invalid JS caught as a misleading "compiler defect" `E-CODEGEN-INVALID-JS`, but it's AUTHOR error. **Fix:** a pre-emit syntactic scan → clear `W-FOREIGN-CROSSING-SHADOW` / `E-FOREIGN-006`. Independent rider (the `_{}` emitter, not library-mode SQL) — but same "non-program codegen context" understanding.

## Progress
`ss23.progress.md`. Land on `spa/ss23`; ping PA inbox. Do NOT advance main / push. **#2 W5a/W5b is the STOP-if-materially-bigger candidate** — survey first, report the real scope before the full build; W5a alone (auto-detect) may be a clean standalone land. PA re-integrates per-sub-step. flogence reply owed on land (#1 + #2 unblock it).
