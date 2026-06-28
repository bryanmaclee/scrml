# ss54 — token-set emit (`--emit-token-set`) — SURVEY-FIRST · flogence-coordinated

> **STATUS: landed-on-branch** `spa/ss54` @ `f30f79da` (sPA ss54, 2026-06-28).
> Survey-first complete; 3 OQs resolved (OQ-1 version=fnv1a content-fingerprint ·
> OQ-2 per-symbol kind=YES, v1 enum = 5 decl kinds + state-cell · **OQ-3 surfaced**:
> §34 has NO programmatic catalog → errorCodes = live source-scan of `compiler/src`).
> Full pre-commit suite GREEN. R26 CLI-verified on `examples/02-counter.scrml`.
> Coordination-back to flogence: drafted in the re-integration message (handOffs/incoming).

**Fill-note:** the scrml-side half of the flogence docs↔code-drift DD (flogence S17, ratified — `handOffs/incoming/read/2026-06-27-2132-flogence-...-token-set-ratified.md`). flogence consumes a compiler-emitted **token-set** as a second flograph currency pass to flag a doc citing a now-dead symbol. **scrml owns ONLY the emit** (a cheap byproduct of what the compiler already computes); the consume/display/tiering lives in flogence. This was the "token-set emit contract scrml owes flogence" item carried in the S228 hand-off — now design-unblocked (flogence ratified the shape + 4 constraints).

**SURVEY-FIRST** (the emit hook + the 2 OQs below need locating/deciding before the build). Single item. NOT adopter-facing (a tooling artifact) — LOW-MED priority, but unblocks the flogence currency pass + the corpus-ouroboros attack.

**Ingestion:** the compiler's already-computed identifier/code/keyword sets + a new CLI emit hook. coreFiles (verify): `symbol-table.ts` (declared identifiers) · the §34 error-code source (codes registry / diagnostics catalog) · the scrml keyword + stdlib-vocab source · the CLI flag + emit hook (`commands/compile.js` / `bin/scrml.js` / `api.js`) · `codegen/index.ts` + chunks-manifest (the `chunks.json` `compiler`/version-field PRECEDENT for the version key — §47.5 / S94 single-source-of-truth).

## The ratified contract (flogence's rough shape — finalize per the OQs)
```
--emit-token-set → token-set.json:
{ "version":    "<identity key — see OQ-1>",
  "symbols":    [ declared identifiers — from the symbol table ],
  "errorCodes": [ §34 / E-* codes ],
  "keywords":   [ scrml keywords + stdlib vocab ] }
```

## The 4 hard constraints (from the DD — most live FLOGENCE-side; the emit must not violate them)
- **(i) INFO, never a gate** (dpa-010 non-promotion). The emit is a navigation artifact, NOT authority. Don't wire it into any pass/fail.
- **(ii) Rides existing dock/flograph — NOT a new identity store** (subtraction-test HARD-NO). The token-set is the supersession ORACLE for compiler-owned identifiers; it must NOT become a second identity system. → the emit is a read-only projection of the symbol table, written nowhere the compiler reads back (anti-ouroboros).
- **(iii) Confidence-tiered** (flogence-side: code-form hits high / bare-prose low). The emit may SUPPORT this by emitting per-symbol kind (OQ-2).
- **(iv) Absence ≠ currency** (flogence-side display). N/A to the emit itself, but don't emit any "this doc is current" signal.

## Open questions — scrml-PA decisions to finalize at survey (leans noted; confirm against current source)
1. **Version / identity key** (so a doc flagged at version N is re-checkable at N+1). The key MUST change when the SYMBOL SET changes — so `package.json` version (the §47.5/S94 `chunks.json` `compiler` field; bumps rarely, too coarse) is the WRONG key. **Lean: a content-hash of the token-set itself** (mirror the §47 FNV-1a content-addressing the chunk-splitter already uses — same machinery), OR the build commit SHA if a session/commit key is preferred. Survey: what does flogence's re-check expect — a monotonic key or a content key? (flogence said "version/identity key … so a doc flagged against version N is re-checkable at N+1" — coordinate the exact semantics.)
2. **Per-symbol `kind`?** Emitting `kind` (function / state-cell / type / enum-variant / server-fn / component / stdlib-export) per symbol SHARPENS flogence's tiering (a doc citing a removed `function` vs a renamed `type` are different signals). The symbol table already carries kind → cheap. **Lean: YES, emit `{name, kind}` per symbol.** Confirm the symbol table exposes a stable kind enum.

## Survey mandate (before build)
- Locate the canonical sources: the finalized symbol table (post-SYM), the §34 code catalog (is there a programmatic list, or is it SPEC-prose only? — if prose-only, the emit needs a codes source), the keyword + stdlib-vocab list.
- Locate the cleanest emit hook (a post-pipeline projection — mirror the `chunks.json` manifest emit; gate behind `--emit-token-set`, dead-code-free in normal builds).
- Decide OQ-1 + OQ-2 (recommend; PARK to PA→flogence coordination if OQ-1's re-check semantics are ambiguous).
- Confirm the emit is a pure read-only projection (constraint ii — anti-ouroboros; written to an artifact the compiler never reads back).

## Test plan
- A compile with `--emit-token-set` produces a well-formed `token-set.json` with all 4 keys populated on a representative `.scrml` (symbols non-empty, errorCodes = the §34 set, keywords = the vocab).
- Without the flag: zero overhead / no artifact (dead-code-free).
- The version key changes when a symbol is added/removed/renamed; stable when source is unchanged (the re-check invariant).
- R26: emit on a real adopter source; eyeball the symbol set matches the declared identifiers.

## Coordination-back to flogence
On land: reply to flogence (`handOffs/` outbox → flogence inbox) with the FINAL contract (the chosen version-key semantics + whether kind is emitted + the artifact path/flag), so flogence wires its consuming currency pass to the real shape.

<!-- @minted: S228 (2026-06-28) — flogence S17 DD ratified the scrml-side token-set emit ask. Survey-first; 2 OQs (version key · per-symbol kind) are scrml-PA finalizations. NOT adopter-facing. Unblocks the flogence docs-drift currency pass + the corpus-ouroboros structural attack. -->
