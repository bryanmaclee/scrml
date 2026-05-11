# Hardcoded Thresholds Sweep — 2026-05-10 (S78)

**Status:** read-only audit
**Scope:** compiler/src/ hardcoded numeric thresholds that gate user-visible behavior
**Authored by:** general-purpose agent dispatched S78
**HEAD at audit:** 8f49e5c7152ff3f6fa3ddbeba5a134d9f34ab94a

## §0 Headline

12 distinct hardcoded thresholds inspected in `compiler/src/`. Bucket assignment:

- **Bucket A (E-IMPORT-007 shape — refactor priority):** 2
- **Bucket B (test-blocker only):** 1
- **Bucket C (adopter-relevant, already testable):** 3
- **Bucket D (genuine constants, document only):** 6

The two Bucket A candidates are `MAX_RUNS = 100` in the meta-effect infinite-loop guard (runtime-template.js, fires a `console.error` diagnostic) and the `seq > 1331` overflow ceiling in type-encoding.ts (fires `E-CG-014`). Both gate user-visible diagnostics and would benefit from injection-via-options for unit testing.

## §1 Method

Grep patterns used:
1. `(LIMIT|MAX_|MAX[A-Z]+|MIN_|THRESHOLD|TIMEOUT|MS\b|DEPTH|RETR(Y|IES))` over `compiler/src/`
2. `(const|let)\s+[A-Z_]+\s*=\s*[0-9]` for SCREAMING_CASE constants
3. `if\s*\(.*(>=|<=|>|<)\s*[0-9]{2,}` for inline magic-number comparisons
4. `AbortSignal\.timeout|setTimeout\(.*,\s*[0-9]+\)` for explicit timeout calls
5. Targeted reads of every named hit's firing-site context.

Filter rules applied (per dispatch brief):
- **Kept:** thresholds that gate user-visible behavior (errors, warnings, diagnostic emissions, fatal compile-stop).
- **Dropped:** char-code ranges (65/90/97/122 ASCII A-Z a-z classification), FNV hash constants (algorithm internals), parser lookahead bounds bound to `node.size + N` (proportional to input — not a separate dial), tailwind scale loops (`i <= 12`), debounce / shutdown-delay setTimeout values (internal), unit-conversion constants (1000 ms / sec; 60000 ms / min), generated runtime config values that ALREADY pass through user-supplied middleware config (rate-limiter window/limit, fly.toml `interval=10000`/`timeout=2000`, CORS Max-Age 86400).
- **Dropped (already injectable):** `GATHER_LIMIT` (api.js:467) — fixed at `8f49e5c`, the canonical example that triggered this sweep.

Files audited:
- All `.js` / `.ts` in `compiler/src/` and its `codegen/`, `commands/`, `validators/`, `types/` subtrees.
- `runtime-template.js` only for constants whose violation produces a user-visible diagnostic (`console.error`).

## §2 Bucket A — same shape as E-IMPORT-007 (refactor priority)

### A.1 `MAX_RUNS = 100` (meta-effect infinite-loop guard)

| Field | Value |
| --- | --- |
| Location | `compiler/src/runtime-template.js:1104` |
| Current value | `const MAX_RUNS = 100; // infinite loop guard` |
| What it gates | Inside `_scrml_meta_effect(scopeId, fn, …)`. When the same meta-effect re-runs more than `MAX_RUNS` times in a single reactive cycle, runtime emits `console.error("[scrml] meta effect <id> exceeded 100 re-runs — possible infinite loop")` and bails the effect run (`runtime-template.js:1118-1122`). |
| User-visible? | YES — emits a `console.error` diagnostic that an adopter sees in DevTools. The same "100 re-runs" string appears in two doc-comments (lines 77, 1089) advertising the cap. |
| Why adopter-relevant | (a) A test author cannot trigger the diagnostic without writing a 101-cycle reactive loop fixture (slow + brittle). (b) An adopter shipping a complex derived-graph might want a higher cap (e.g. 1000) without forking the runtime. |
| Recommended option | This constant lives in the RUNTIME (emitted into every compiled `.client.js`), not the compiler itself. The injection point is in compiled output — the simplest fix is a global `window.__scrml_max_meta_runs ?? 100` lookup, OR an `options.maxMetaRuns` plumbed through `compileScrml()` that substitutes the literal at codegen time. |
| Effort | Small (~30 min). Replace the literal with a substitution pattern in `runtime-template.js`, plumb option through `api.js`. |

### A.2 `seq > 1331` (type-encoding disambiguator overflow)

| Field | Value |
| --- | --- |
| Location | `compiler/src/codegen/type-encoding.ts:443` |
| Current value | `if (seq > 1331) throw new CGError("E-CG-014", …)` |
| What it gates | Inside `EncodingContext.register()`. After 1,332 same-type bindings in a single scope share a `_<kind><hash>` prefix, throws `E-CG-014: Disambiguator overflow`. The 1331 bound corresponds to base36 3-char ceiling (`"zzz" = 35*36²+35*36+35 = 46655`, but in practice the comment says "1,332 same-type bindings"). |
| User-visible? | YES — fatal compile error with code `E-CG-014` in the user's terminal. |
| Why adopter-relevant | (a) A unit test wanting to verify `E-CG-014` triggers cleanly cannot do so today without synthesizing 1,332 same-type bindings in a fixture (impractical). (b) The cap reflects an internal encoding format choice (single base36 char seq); allowing test-injection of a smaller value (e.g. 3) lets the conformance suite cover the E-CG-014 path with a 4-binding fixture. |
| Recommended option | `options.__testOnly_typeEncodingSeqCap ?? 1331` plumbed through `EncodingContext` constructor. Adopter-facing option not needed (the cap is algorithmic); test-only injection sufficient. Arguably this is Bucket B (test-blocker only), but elevating to A because the diagnostic IS user-visible and conformance gating it matters. |
| Effort | Small-medium (~45 min). Add constructor option to `EncodingContext`, plumb from `codegen/index.ts`, surface in `api.js` compile options. |

## §3 Bucket B — test-blocker only

### B.1 Server-client AbortSignal timeouts

| Field | Value |
| --- | --- |
| Location | `compiler/src/serve-client.js:35` (`500`), `:55` (`1000`), `:112` (`30000`), `:173` (`2000`) |
| Current value | `AbortSignal.timeout(500)` health-check; `AbortSignal.timeout(1000)` health-info; `AbortSignal.timeout(30000)` compile RPC; `AbortSignal.timeout(2000)` shutdown |
| What it gates | When the compiler-server process is unreachable / slow, falls back to direct compilation. No user-visible diagnostic until fallback path runs (then logs in verbose mode). |
| User-visible? | INDIRECTLY — slow CI on cold-start may hit the 500ms health-check ceiling and silently fall back to direct compile (loses the persistent-server win). |
| Why test-blocker | Unit tests cannot exercise the timeout-fallback path without an actual hung server. |
| Recommended option | `__testOnly_serverTimeouts: { health: 500, info: 1000, compile: 30000, shutdown: 2000 }`. Could also expose as adopter `SCRML_SERVER_TIMEOUT_*` env vars, but that's lower priority — the persistent-server pattern is internal compiler infra, not authoring surface. |
| Effort | Small (~20 min). One file, four `??` replacements. |

## §4 Bucket C — adopter-relevant, already testable

### C.1 `_SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000` (24h TTL)

| Field | Value |
| --- | --- |
| Location | `compiler/src/codegen/emit-server.ts:1057` |
| Current value | `const _SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;` (emitted into compiled server output) |
| What it gates | Idempotency-key row expiry in the `_scrml_idempotency_keys` shadow table. Used by `_scrml_idempotency_lookup` / `_scrml_idempotency_store` helpers (SPEC §19.9.6). |
| User-visible? | YES — adopter-supplied idempotency keys silently expire after 24h. Comment cites "Stripe convention". |
| Why adopter-relevant | An adopter with a different replay-window policy (e.g. 7 days for batch operations, 1h for high-volume) might want to override. Pillar-5 honest precedent: S72 surfaced idempotency-store backend choice via scrmlconfig — this is the same shape. |
| Recommended option | scrmlconfig `idempotencyTTL` (duration string or millis). Already testable because the emit string is observable in test assertions. |
| Effort | Medium (~1h). Adds scrmlconfig schema entry + plumbs through to emit-server.ts; SPEC §19.9.6 already documents the helper, so amendment is light. |

### C.2 `keysVar.length > 32766` (SQLITE_MAX_VARIABLE_NUMBER)

| Field | Value |
| --- | --- |
| Location | `compiler/src/codegen/emit-control-flow.ts:373` |
| Current value | `if (keysVar.length > 32766) throw E-BATCH-002` (emitted into compiled output) |
| What it gates | Tier-2 batched IN-list size for hoisted loops (SPEC §8.10.6). Matches bun:sqlite default `SQLITE_MAX_VARIABLE_NUMBER`. |
| User-visible? | YES — fatal runtime error `E-BATCH-002` if the loop iterates over more than 32,766 rows. |
| Why adopter-relevant | (a) Postgres has a higher limit (~65,535). (b) SQLite older builds default to 999. The hardcoded 32,766 is a SQLite-3.32+ assumption; an adopter targeting different SQL backends would benefit from configurability. |
| Recommended option | scrmlconfig `batchInListCap` (default 32766 = SQLite 3.32 default). Could also infer from db-driver (see `compiler/src/codegen/db-driver.ts`) — adopter override OR derived per-backend. |
| Effort | Medium (~1h). Plumb through `emit-control-flow.ts`; SPEC §8.10.6 comment already notes "Users can `.nobatch()` the site to opt out". |

### C.3 `DEFAULT_PORT = 3100` / `port = 3000` (compiler-server and dev-server defaults)

| Field | Value |
| --- | --- |
| Location | `compiler/src/serve-client.js:15` (`3100`), `commands/dev.js:63` (`3000`), `commands/serve.js:58` (`3100`), `commands/build.js:410,415` (`3000` in fly.toml) |
| Current value | Persistent compiler server: `3100` (env `SCRML_PORT` overrides). Dev-server: `3000` (CLI `--port` overrides). |
| What it gates | TCP port binding for the dev / serve subcommands. |
| User-visible? | YES — already user-configurable via env / CLI flags. **NOT a refactor target.** Listed only for completeness; both are exposed via documented flags. |
| Effort | None. Already done. |

## §5 Bucket D — genuine constants (document only)

### D.1 `MAX_ITERATIONS = graph.size + 2` (module-resolver re-export fixed-point)

`compiler/src/module-resolver.js:432` — bound to input size, not a user-tunable dial. Convergence is depth-of-chain iterations. **Why constant:** fixed-point algorithm correctness; lowering breaks convergence, raising achieves nothing.

### D.2 `MAX_CAPTURE_TAINT_ITER = analysisMap.size + 1` (route-inference Step 5b)

`compiler/src/route-inference.ts:1765`. Same shape as D.1. Bound to lattice height × input size. **Why constant:** monotone lattice fixed-point — additional iterations are no-ops.

### D.3 `MAX_CALLER_CTX_ITER = analysisMap.size + 1` (route-inference Step 5c)

`compiler/src/route-inference.ts:1867`. Same shape as D.1/D.2. **Why constant:** same argument.

### D.4 Parser lookahead bounds (`while (i < 20)`, `while (arrowIdx < 40)`)

`compiler/src/ast-builder.js:1920` (`< 20`), `:4851` (`< 40`). Bounded lookahead for arm-pattern / enum-payload binding detection. **Why constant:** the grammar guarantees these constructs are short; bound is purely defensive (paranoia ceiling for malformed input). User-visible? No — exceeding the bound just abandons the syntactic-form detection and falls through to other dispatches (parse continues).

### D.5 Diagnostic-message preview truncations (`slice(0, 60)`, `slice(0, 80)`, `slice(0, 120)`)

`compiler/src/expression-parser.ts:1450` (60), `compiler/src/route-inference.ts:658` (80), `compiler/src/protect-analyzer.ts:357` (120), `compiler/src/symbol-table.ts:5751` (80), `compiler/src/index.js:86` / `commands/build.js:539,546` / `commands/dev.js:269,276` (all 120). **Why constant:** cosmetic preview length in human-readable error strings. Configurability would only serve someone trying to read full messages — they should look at the source file instead.

### D.6 `FNV_OFFSET = 2166136261`, `FNV_PRIME = 16777619`

`compiler/src/codegen/type-encoding.ts:278-279`. Standard FNV-1a 32-bit constants. **Why constant:** changing them produces non-FNV output and breaks cross-build determinism.

## §6 Recommended actions (prioritized)

1. ✅ **A.1 — `MAX_RUNS` injection** SHIPPED S79 2026-05-10. Replaced literal with `globalThis.__scrml_max_meta_runs ?? 100` lookup at the top of `_scrml_meta_effect`. Tests can `globalThis.__scrml_max_meta_runs = 5` to exercise bail path with a 6-cycle fixture; adopters can set higher (e.g. 1000) before scrml runtime loads. Fallback default unchanged (100).
2. ✅ **A.2 — `seq` cap test-injection** SHIPPED S79 2026-05-10. Added `seqCap` field on `EncodingContext` + constructor opt `__testOnly_typeEncodingSeqCap` (default 1331). Plumbed through codegen/index.ts via the existing `encoding` option object. Test fixture exercises E-CG-014 with `seqCap: 2` + 4 same-type bindings instead of synthesizing 1,332.
3. **C.1 — Idempotency TTL via scrmlconfig** (~1h). Highest adopter-value Bucket C. Pillar-5 honest pattern matches the S72 idempotency-store precedent — adopters who use idempotency at all will want to tune TTL.
4. **B.1 — serve-client timeout injection** (~20 min). Cheap; unblocks slow-CI scenarios + persistent-server unit tests.
5. **C.2 — Batch IN-list cap via scrmlconfig** (~1h). Lower priority because `.nobatch()` opt-out exists, but adopter-relevant for non-SQLite backends.

Estimated total effort for items 1-5: ~4 hours.

## §7 Caveats

- **Grep patterns miss multi-token thresholds.** `const X = 5 * 1000` would not show in pass 2 (no SCREAMING_CASE with single literal) and may not appear in pass 3 if the comparison uses an arithmetic expression on the RHS (`if (x > 5 * 1000)`). The `_SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000` (C.1) is the prime example — caught via the `TTL_MS` name regex, not the value pattern.
- **Per-file deep-read would surface more.** This audit grep-prioritized + spot-checked context; a structured file-by-file analysis (especially of `codegen/` emit-* files that emit thresholds INTO generated code) could find additional candidates. Estimate: 2-4 more Bucket C items lurking in `emit-server.ts` / `emit-reactive-wiring.ts` related to rate-limit / CSRF / CORS Max-Age (currently dropped because they pass through middleware config, but the *defaults* embedded in those generators when the user does not specify a value may themselves merit configurability).
- **Runtime-template.js partial coverage.** Only audited for user-visible diagnostics; the file contains ~40 other named numeric constants for timer registries, scope tracking, etc. None were flagged because they don't gate user-visible behavior, but the boundary is fuzzy — e.g. `_scrml_timer_start`'s `intervalMs > 0` check (line 646 doc-comment) fires a defensive bail without a diagnostic; if SPEC adds an E-TIMER-* code in future it would re-enter scope.
- **CLI defaults (Bucket C.3) already user-configurable.** Listed for completeness; not a refactor target. Future audits should pre-filter on "already has flag/env override" to keep noise down.
- **`MAX_RETRIES = 3` reference at ast-builder.js:1992 is in a COMMENT** (illustrating an export-let parsing edge case), not a real constant. Filtered out.
