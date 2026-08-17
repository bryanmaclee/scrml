# dpa-030 defects — the four that land BEFORE the File primitive (BRIEF, archived at dispatch)

Authority: bryan S347 — *"a, land the defects first"*. Full brief text passed verbatim in the dispatch prompts.

## Partition — by WRITE SURFACE, not by concern (ingestion-disjoint gate, pa-base §7)

D2, D3 and D4 ALL write `compiler/src/codegen/emit-server.ts`. They are NOT disjoint and are
therefore ONE dispatch, committed as separate logical units. D1 is disjoint.

- **Agent 1 — the `emit-server.ts` cluster:** D2 (raw-egress gate is a source-text regex bypassed by
  `globalThis.`; + `LOGIC_SCOPE_GLOBAL_ALLOWLIST` in `type-system.ts`; + the `instanceof Response`
  fail-open passthrough) · D3 (`request.formData()` emitted unawaited) · D4 (no body-size ceiling on
  any of the three JSON prologues).
- **Agent 2 — D1:** `formFor`'s mandated PE fallback posts to a 404 (`emit-form-for.ts`).

## Known-good inputs
- OQ-1 ANSWERED S347: Bun stream-count-aborts `req.body` without materializing (10 MiB offered / 1 MiB
  ceiling → 413, peak buffered one 64 KiB chunk over, 20 of 160 chunks pulled). The D4 ceiling is
  IMPLEMENTABLE; probe at `scratchpad/oq1/probe.ts`.
- PA-reproduced S347: a malformed JSON body throws an uncaught `SyntaxError` from an unguarded
  `await _scrml_req.json()` instead of §61.3's compiler-owned 400 →
  `g-endpoint-malformed-json-body-throws-instead-of-400` (HIGH). Fold into D3/D4.
