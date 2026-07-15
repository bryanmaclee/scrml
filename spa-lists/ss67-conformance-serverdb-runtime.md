# sPA ss67 — conformance: serverDb data-flow RUNTIME (SQL §8 hydrate round-trip)

**Launch:** `read spa.md ss67` · **Branch:** `spa/ss67` · **Worktree:** `../scrml-spa-ss67`

**Fill:** conformance-authoring cluster (runtime, `serverDb` driver), ~4-6 cases · NEW S252 · thin/at-ceiling

## Shared ingestion
Author RUNTIME conformance cases for the **server-fn → `?{}` SQL → client-hydrate round trip** using the
**`serverDb` driver — which IS built** (`adapters/impl1-ts.ts`: `runServer`, `evalServerModule`,
`installServerDispatchFetch`; wired in `run.ts` 166-174/264-272; 5 cases already green in `protect/`+`ssr/`).
⚠️ **HARD CONSTRAINT — the SQL engine is a STUB:** `makeSqlStub` (impl1-ts.ts ~504-517) regex-extracts
`FROM <table>` and returns a shallow copy of the ENTIRE seeded table — **it does NOT evaluate WHERE,** no
JOIN/aggregate/write-back/transaction/constraint. So every case here MUST **seed the exact rows it expects
and assert only data-FLOW** (rows reach the client + render), NEVER WHERE-filtering / write-back / ordering.
Those are the BLOCKED engine-semantics surface (see residual note) — out of scope for this list. Every
runtime case carries `spec`+`rationale`. **Mirror `protect/strip-client-visible-runtime` +
`ssr/ssr-first-paint-render` + `server-fn/basic-load-hydrate`.** Read the README server-eval section FIRST.

## Core files
`conformance/README.md` (server-eval mode) · `conformance/run.ts` (166-174, 264-272) ·
`conformance/adapters/impl1-ts.ts` (`makeSqlStub` ~504-517 · `evalServerModule` ~528 · `runServer` ~657) ·
`compiler/SPEC.md` §8 (grep `## 8`) · `conformance/cases/{protect,server-fn,ssr}/` (the serverDb templates)

## Items (author each; commit per-case; `serverDb`+`state`/`domAnchored`)
Landed as category **`conformance/cases/server-db/`** (all 4 `[runtime]`, empirically verified via `runServer`).
1. **`sql-select-hydrate-rt`** `[status=landed-on-branch b6e56a08]` — `.all()` → Row[] hydrates @users → `<each>` renders 2 `.row` + `#count`. ✓ (§8.3/§52.1; no WHERE — pure data-flow)
2. **`sql-get-single-row-rt`** `[status=landed-on-branch b6e56a08]` — `.get()` → first row → single-object `state.current` (state-only, mirrors protect; nullable row NOT rendered). ✓
3. **`sql-all-array-shape-rt`** `[status=landed-on-branch b6e56a08]` — `.all()` → length-3 array shape (`#count`=3). ✓
4. **`sql-multi-table-sequence-rt`** `[status=landed-on-branch b6e56a08]` — two server-fns, two DISTINCT seeded tables (users×2, posts×3; no JOIN). ✓
5-6. **[status=skipped — no gap]** protect-on-DB-rows / SSR-of-DB-rows already covered by the 5 existing green `protect/`+`ssr/` cases; no additional gap found. (Explicitly optional per list.)

- **PARK item — `[status=parked → escalated to PA]`** — the **SQL-engine-semantics runtime** sub-surface (WHERE-filter · JOIN/aggregate/ORDER BY · INSERT/UPDATE/DELETE `.run()` + `RETURNING` §8.5.1 · transaction atomicity + ROLLBACK §8.5.3 · §8.7 `SqlError` variants · UNIQUE/FK/CHECK §39.5) — ~6-8 cases, **BLOCKED until a real-DB conformance adapter replaces `makeSqlStub`** (SQLite-backed `_scrml_sql`). A compiler/harness DEV task, NOT conformance authoring. **Ready-to-file known-gaps entry handed to the PA in the re-integration message** (not written to the PA-owned `docs/known-gaps.md` from this branch — the PA files it at re-integration).

## Progress
`ss67.progress.md`. Land on `spa/ss67`; ping the PA inbox when ready. Do not touch main / do not push.

**STATUS: COMPLETE — 4 authorable items landed on `spa/ss67` @ `b6e56a08`. 5-6 skipped (no gap). PARK item escalated. conformance 390/390 (was 386, +4).**

## Wave-2 — tier-1 completion: E-SERVER-FN-IN-SYNC-CALLBACK + the 4 Direction-B runtime cases (S256 audit)
The landed items above are the SQL-hydrate data-flow surface — do NOT touch them. This section adds the
one remaining tier-1 server code + the **4 Direction-B runtime holes** (`DIRECTION-B-runtime.md`) the S256
tier split places in tier-1. The `serverStub`/`serverDb` + `firstPaint` runtime drivers are BUILT (see
`conformance/README.md` server-eval section + the ss67 core-files). Grep the code live for the exact
trigger. Escalate any impl#1-vs-SPEC divergence.

**server code (codes):**
5. **E-SERVER-FN-IN-SYNC-CALLBACK** (codes) `[status=pending]` — a server function called in a sync callback (`codegen/emit-server.ts:1943`). Pos (a server fn invoked from a sync-only callback → E-SERVER-FN-IN-SYNC-CALLBACK) + neg (an async/awaited call site → silent).

**Direction-B runtime holes (RT — the `serverStub`/`serverDb`/`firstPaint` drivers):**
6. **endpoint §61 runtime** (RT) `[status=pending]` — `DIRECTION-B-runtime.md` item 1: a route request→response runtime via `serverStub` (harness stubs the route + response). Assert `state`/`domAnchored` after the request settles. (The §60 `<api>` external-fetch runtime stays BLOCKED — ss63 note; this is the §61 INBOUND endpoint, expressible.)
7. **auth §40 runtime** (RT) `[status=pending]` — `DIRECTION-B-runtime.md` item 2: a login→gated-content / redirect runtime sequence expressible via `input` + `serverStub`. Assert gated content appears only post-login.
8. **print §20.7 runtime** (RT) `[status=pending]` — `DIRECTION-B-runtime.md` item 3: a `stdout` runtime case (the `stdout` expect field is currently unused). Assert the printed output.
9. **channel-watches-feed §38.13 runtime** (RT) `[status=pending]` — `DIRECTION-B-runtime.md` item 4: a `<channel watches=>` server-feed runtime case (the single-client-expressible half). Assert the fed rows reach the client.

**Freeze DECISION (not backlog):** channel §38 multi-client V5-strict cell-sync is harness-limited
(single-client driver cannot express cross-client sync) → **accept codes-only at freeze with an explicit
note** (`DIRECTION-B-runtime.md` "freeze DECISION"). Re-open if the harness gains a multi-client mode. Do
NOT author it; record the accept-with-note in the re-integration ping for the PA.

**Wave-2 DoD:** E-SERVER-FN-IN-SYNC-CALLBACK pinned; the 4 Direction-B runtime cases authored (RT halves,
via the built serverStub/serverDb/firstPaint drivers); the channel multi-client freeze-DECISION recorded
(accept-with-note); run.ts green; divergences ESCALATED.
