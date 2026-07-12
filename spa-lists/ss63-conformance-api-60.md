# sPA ss63 — conformance: api §60 (typed external HTTP `<api>`)

**Launch:** `read spa.md ss63` · **Branch:** `spa/ss63` · **Worktree:** `../scrml-spa-ss63`

**Fill:** conformance-authoring cluster (compile-time), ~9-10 cases · NEW S252 · at-ceiling-ish (runtime half BLOCKED, see note)

## Shared ingestion
Author conformance cases pinning **§60 `<api>`** (typed outbound HTTP / BYOB) — IMPLEMENTED S210-S213,
R26-verified, currently **0 conformance cases**. §60 is **client-only** (§60.6, no server-placement) so
`serverStub` does NOT apply; its runtime half (emitted `fetch(base+path)` → `parseVariant` decode →
`<request>.data`) needs a NEW external-URL fetch mock the adapter LACKS → **runtime cases are BLOCKED**
(park; file the adapter gap). **The whole adopter-visible contract that's buildable now = the 7 `E-API-*`
+ 2 `W-API-*` codes = COMPILE-TIME.** Contract-asserted = diagnostic CODES only (message/emitted-JS =
impl-freedom per README). **Mirror `conformance/cases/endpoint/` verbatim** — the §61 inbound sibling; its
`accepts-missing`-style code-neg cases are the exact pattern. Read the README case-format section FIRST.

## Core files
`conformance/README.md` (case format) · `conformance/run.ts` · `conformance/adapters/impl1-ts.ts` ·
`compiler/SPEC.md` §60 (**locate by heading — grep `## 60`; ~34271-34389, SPEC-INDEX stale ~90L**) ·
`conformance/cases/endpoint/` (the pattern-to-mirror) · worked source `examples/32-external-api.scrml`

## Items (author each case; codes-only assertions) — ALL LANDED spa/ss63 @ `68035d6f`
> **sPA note (ss63):** landed as ONE batch commit `68035d6f` (not per-case): the pre-commit hook runs the FULL ~2min suite regardless of file count, so 10 per-case commits = ~20min of suites + concurrent-agent OOM risk; the 10 cases are one additive logical unit, already verified green together, with no crash-recovery window left. `/spa` lifecycle says "single sPA-authored commit." Flagging the per-case→batch deviation for the PA.
1. **`api-base-missing-neg`** `[status=landed 68035d6f]` — `<api>` with no `base=` → **E-API-BASE-MISSING** (parse).
   > Brief seed: minimal `<api>` missing `base=`; `codes:["E-API-BASE-MISSING"]`. Copy an `endpoint/*-neg` case shape.
2. **`api-method-invalid-neg`** `[status=landed 68035d6f]` — endpoint verb ∉ GET/POST/PUT/PATCH/DELETE → **E-API-METHOD-INVALID**.
3. **`api-response-type-undeclared-neg`** `[status=landed 68035d6f]` — endpoint omits `: ResponseT` → **E-API-RESPONSE-TYPE-UNDECLARED**.
4. **`api-endpoint-malformed-neg`** `[status=landed 68035d6f]` — a body line matching no §60.2 grammar → **E-API-ENDPOINT-MALFORMED**.
5. **`api-endpoint-unknown-neg`** `[status=landed 68035d6f]` — `<request api="X">` names an undeclared endpoint → **E-API-ENDPOINT-UNKNOWN** (typer).
6. **`api-req-shape-mismatch-neg`** `[status=landed 68035d6f]` — `args` fails the request-shape width check → **E-API-REQ-SHAPE-MISMATCH**.
7. **`api-path-param-unbound-neg`** `[status=landed 68035d6f]` — a `${…}` path-template param with no request-shape field → **E-API-PATH-PARAM-UNBOUND**.
8. **`api-response-not-variant-info`** `[status=landed 68035d6f]` — non-variant `ResponseT` raw-passes → **W-API-RESPONSE-NOT-VARIANT** (`severity:"info"`).
9. **`api-clean-pos`** `[status=landed 68035d6f]` — well-formed `<api>`+`<request api=>` fires nothing → `notCodePrefixes:["E-API-"]` (mirror `style/clean-single-rule`).
10. **`api-unknown-type-ref-neg`** `[status=landed 68035d6f, optional]` — undeclared type in reqShape/responseType reuses **E-TYPE-UNKNOWN-NAME** (§14.1.2); asserts no new machinery. (Authored — the optional case landed too.)
- **PARK — FILED (escalated to PA):** `api-fetch-decode-roundtrip` (runtime) — needs a NEW external-URL fetch mock in `conformance/adapters/impl1-ts.ts` (base+path keyed; `installServerDispatchFetch` only routes `/_scrml/*`). NOT built (blocked). Residual adapter gap surfaced in the ss63 re-integration ping for the PA. Do NOT build in this list.

## Progress
`ss63.progress.md`. Land on `spa/ss63`; ping the PA inbox (`handOffs/incoming/`) when the batch is ready with per-case SHAs + branch tip. Do not touch main / do not push.
