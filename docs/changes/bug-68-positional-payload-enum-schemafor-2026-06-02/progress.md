# Bug 68 — positional-payload enum variant not materialized → misses E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1

Change-id: bug-68-positional-payload-enum-schemafor-2026-06-02

## 2026-06-02 — startup + diagnosis
- Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-abbda66ee7a9c464f
- S112 merge: fast-forwarded 57edc794 -> 63fcba72 (Bug 63 + Bug 65 in ancestry). bun install + pretest OK.
- Reproduced A/B/C on HEAD 63fcba72: A (positional Ok(int)) exit 0 NO error (BUG); B (named) fires E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1; C (bare) clean. Confirmed.
- ROOT LAYER = enum-parse materialization, NOT schemaFor classify read.
  - type-system.ts parseEnumBody ~line 1373: positional payload field `int` (no colon) hits `if (colonIdx === -1) continue;` → payload Map stays size 0 → enumHasPayloadVariant() false → classifies as bare-enum.
  - codegen-side getAllVariantInfo (emit-client.ts ~line 2363) has the IDENTICAL miss in its raw-fallback path; structured path reads v.payload.keys() which is also empty (downstream of parseEnumBody).
  - Observable corruption beyond schemaFor: A.client.js emits `Ok: function() { return { variant: "Ok", data: {} }; }` — positional payload dropped from the constructor too.
- SPEC normative basis: §34 / §41.15 error definition (SPEC.md L16557) cites `Result:enum = { Ok(int), Err(string) }` (POSITIONAL) as the canonical payload-bearing-enum example for E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1. So positional MUST classify payload-bearing. §18.7 positional-binding resolves index→declaredFields[i]; emit-logic.ts:2602 establishes the `_${i}` synthetic-name convention for positional fields.
- FIX PLAN: parseEnumBody records positional payload fields with synthetic `_${i}` keys (mirrors emit-logic.ts:2602). Same fix in getAllVariantInfo raw-fallback. Shared materialization → schemaFor AND tableFor both close (verify tableFor).

## Next
- Apply fix to parseEnumBody + getAllVariantInfo; verify A/B/C + mixed + tableFor; author unit test; full suite.

## 2026-06-02 — fix landed (commit 4ab5fea9)
- FIX APPLIED:
  - compiler/src/type-system.ts parseEnumBody: positional payload field (no colon) recorded with synthetic key `_${i}` instead of `continue`-skip.
  - compiler/src/codegen/emit-client.ts getAllVariantInfo raw-fallback: same positional handling (structured + raw paths agree).
- ROOT LAYER = enum-parse materialization (NOT schemaFor classify read). classifyFieldForSql / classifyFieldForCell were always correct (they check payload Map size); the payload Map was empty because parseEnumBody dropped positional fields.
- VERIFICATION (compile-level):
  - A (positional Ok(int)) → NOW FIRES E-SCHEMAFOR-VARIANT-PAYLOAD-ENUM-V1, field 'status', enum 'Result' (was exit 0 / no error).
  - B (named Ok(value: int)) → still FIRES (no regression).
  - C (bare {Admin,Editor,Viewer}) → still CLEAN, no over-fire.
  - D (mixed: bare role + positional status) → FIRES on 'status'/'Result'.
  - tableFor T (positional Ok(int)) → FIRES E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1 (sibling closed by SHARED materialization fix; no separate fix needed).
  - Corrected constructor: `Ok: function(_0) { return { variant: "Ok", data: { _0 } }; }` (was broken `data: {}`); node --check VALID JS.
- TEST: compiler/tests/unit/schemafor-positional-payload-enum-bug68.test.js — 8 tests pass.
- SUITE: pre-commit gate (unit+integration+conformance) 15692 pass / 89 skip / 0 fail. Full `bun run test` 22787 pass; the 2 "fails" are the pre-existing browser-todomvc.test.js dist-ordering harness artifact (benchmarks/ — not touched), unrelated.
- DEFERRED: none. tableFor closed in-scope via shared fix. No sample/example newly-errored.
