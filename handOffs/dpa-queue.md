# dPA queue — banked deliberation requests

**The dPA drains this on a batch run** (`read dpa.md and boot`, rooted in `flogence/`). The PA writes
items here while warm; the dPA reads them, runs each, flips `status: banked → complete` with the
artifact path + a one-line conclusion, and drops a `(dpa: …)` breadcrumb in `delta-log.md`. The dPA
**NEVER** flips an item to `ratified` — that is the PA's act (RUN-not-RATIFY, `dpa-scrml.md` §3).

Item format + drain protocol: `scrml-support/dpa-scrml.md` + the design DD
`scrml-support/docs/deep-dives/dpa-deliberation-satellite-2026-06-18.md` (§6 worked example).

---

## ⚠ CURRENT STATUS (authoritative — PA-maintained; SUPERSEDES the per-item `status:` lines)

**Why this exists (S228 currency-pass).** The per-item `status:` lines are dPA-owned and stop at `complete` — the dPA NEVER flips to `ratified` (RUN-not-RATIFY, above). PA ratification lives in the S215/S225 ratification BLOCKS below, NOT in the per-item lines → a `status: complete` line READS AS "open" long after the PA ratified. **Trust this table over any per-item `status:` line.** (A live instance of the doc-staleness the tier2-render / token-set work targets — this table should eventually PROJECT from the ratification record, not be hand-kept.)

| item | TRUE status | authority |
|---|---|---|
| dpa-001 | **RATIFIED** S210 — A2-thin external-API direction; BUILD downstream | block · "ratify ship A2" |
| dpa-002 | **RATIFIED-direction** S215 — ship B (SSE recipe over `handle()`+`route=`; csrf dropped); small dev item | S215 block |
| dpa-003 | **RATIFIED** S215-dir + REFINEMENT S216 — Approach B logic-ctx `_{}`, inline-all-the-way; BUILD gated §23.2.4 + dpa-007 | S215/S216 |
| dpa-004 | **RATIFIED** S215 — SCOPED-RETIRE the S199 boundary (C1–C4) | "Ok, lets go" |
| dpa-005 | **RATIFIED-direction** S215 — adopt B `<engine server=@source>` + A as no-`rule=` view. §52 read/LOAD **BUILT** (Tier-1 S196 · Tier-2 Pattern-C S216); the flux WRITE-BACK half was **RETRACTED S194** (`fdcd7fcc`, Q2=WF — closed `g-server-sync-codegen-noop`, NOT a build). E-RI-002 diagnostic = **✅ DONE S228** (`d22578c7` — the steering body was already-landed S199 `5e3a1dbf`; this dispatch named the offending cell `@phase`; fire-site is route-inference.ts:3881 not :3534). flux G1's real residual = `g-tier1-ssr-prerender` (SSR, separate). **dpa-005 fully discharged except that SSR item.** | S215 + S194 + INDEX-L137 |
| dpa-006 | **RATIFIED** S225 — foreign toolchain → §58 Merkle closure + dpa-008 capability vocab; BUILD = §58 amendment, post-`_{}` | S225 drain |
| dpa-007 | **ROUTED-TO-DEV** S225 — pure-dev library-mode `?{}` codegen; not a debate | S225 drain |
| dpa-008 | **RATIFIED** S225 — typed capability vocab; collapses into dpa-006 + dpa-003; enforcement gated Pole-D | S225 |
| dpa-009 | **RATIFIED-direction** S225 — INLINE = ts/js + C-ABI; SIDECAR = runtime-bearing; design-record | S225 drain |
| dpa-010 | **ADVISORY — NOT formally ratified** (reason-VCS vs executable-contracts); navigation-not-gate is DE-FACTO in force (dock) | verdict only |
| dpa-011 | **ADVISORY — NOT ratified** (PA test-rig / flogence-domain) | verdict only |
| dpa-012 | **RATIFIED** S225 — COLLAPSE: keep `handle()`, KILL `raw`, no named pipelines [deferred-retriggerable]; BUILD = 2 lints + §40 phase-spec | "keep handle()" |
| dpa-013 | **BUILD-candidate** — direction-ratified S220 (configurable discriminator); flogence transport build, not a DD | line ref below |
| dpa-014 | **RATIFIED** S223 — W4 chunk model = ship B-conditional | "ratify W4" |
| dpa-015 | **RATIFIED** S227 — markup-lease Q2-collapse; CONDITIONAL on 2 §40.9 facts (PA-to-verify); BUILD = `conflictsWith` query | "1, ratify it" |
| dpa-016 | **DEFERRED** S225 — maps-vs-flogence; gate not met | S225 drain |
| dpa-018 | **RATIFIED + LANDED S313** — soft-nav `<outlet>` swap is a **route REGION, not a scope**, keyed by `(route, params)`. §6.7.2's false *"or navigation"* STRUCK · NEW §6.7.2.1 (third lifecycle owner + closure clause) · §20.8.1 exclusion clause · NEW §20.8.8 edge contract · `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` as a v1 obligation. **ROUND 2 (2026-08-04) tested Pole D (`<app>` wrapper) and REJECTED it on mechanism** (weighted C 8.78 / D 1.73; four verified normative collisions) — **C stands UNMODIFIED, nothing to un-land.** Survives of D: the NAME only (a "shell region" defined term, recommended, prose-only). Round-2 artifact: `scrml-support/docs/debates/soft-nav-outlet-lifecycle-pole-d-round2-2026-08-04.md`. **Residual = the route-region IMPL + CN-1..CN-10** (`docs/changes/route-region-teardown/`), and a SEPARABLE spec-hygiene ticket the round-2 dPA surfaced (§20.8.8/§6.7.2 pin a TOTAL order where only ~2 of ~15 orderable pairs have a stated correctness reason — over-specification, not a Pole-D question). | **RATIFIED** S313 (build pending) |
| dpa-019 | **COMPLETE (ADVISORY) dPA 2026-08-04** — 6-voice live poll + judge. **D 40.5 · C 40.0 · B 34.0 · A 31.0 — the origin ruling's Pole A finished LAST.** Reco = **two-mechanism split by LAYER**: D (per-compile, ≈1 module) for apply-back; C (opt-in anchor, ≈1.25–1.5) only if the Fork-2 primitive is built; **A NOT recommended**; B in reserve. **★ Resolved by FALSIFYING the premise: the value-only apply-back DOES NOT EXIST** (floStyle "apply" is a CSSOM patch; the only real source rewriter, flogence `groundedit.ts`, is STRUCTURAL). **★ 2 "PA-VERIFIED" grounding facts are WRONG — `srcmap-provenance.ts` EXISTS (186 LOC); `BaseNode.id` is minted mid-pipeline across 2 files.** **★ Fork 2 resolves to C, not A.** → `scrml-support/docs/debates/ask7-sid-identity-A-vs-B-vs-C-vs-D-2026-08-04.md` | **RATIFIED S319** (bryan: *"ratify all three"*) — **two-mechanism split by LAYER adopted; Pole A REJECTED; sidecar is PER-COMPILE.** Insight landed `[S319/dpa-019]`. **Consequence: the staged `ask7-style-provenance-spec` brief was written on Pole A and MUST be re-authored before dispatch.** |
| dpa-020 | **COMPLETE (ADVISORY) dPA 2026-08-04** — emit sites READ + probes COMPILED. **(c) PARTIAL, but the partition is 2 not 7 and the unit is the CALLEE CLASS, not the position.** Heterogeneity hypothesis **EMPIRICALLY FALSIFIED** (5 of 7 hosts are already `async`). Root cause = **one missing `mode==="client" && serverFnNames` branch in `emitCall`**, because a post-emit regex rename hides the callee → **five post-hoc injectors**. **#391 and #394 did the SAME repair twice.** **Register carries 10 opens, not 7; 4 loci corrected.** **★ DO NOT DISPATCH the `markup-autoawait-all-emitters` brief as written — it targets Group B only and its mandated pattern will NOT fix the server-fn case.** BUILD in 3 units (U1 ~2-3d closes 5/7). → `scrml-support/docs/deep-dives/autoawait-choke-point-vs-heterogeneous-2026-08-04.md`. **⚑ S320-peter: RUN INDEPENDENTLY A SECOND TIME** (per-clone trap — this artifact was uncommitted at S320 boot; my re-run = `…/auto-await-choke-point-dpa-020-2026-08-04.md`, verdict converges: BUILD/partition/AST-based/same gaps, diverges on locus). **S320 also BUILT a CORE (PR #405, post-hoc unified injector) — verified + gate-GREEN but HELD** for bryan's emitCall-root-fix-vs-post-hoc architecture call (his lane). | **RATIFIED S319** (bryan: *"ratify all three"*) — **(c) PARTIAL adopted; unit = CALLEE CLASS; no irreducible heterogeneity.** Insight landed `[S319/dpa-020]`. **Consequence 1: the staged `markup-autoawait-all-emitters` brief SHALL NOT be dispatched as written** (banner applied). **Consequence 2 — OPEN FORK FOR BRYAN: PR #405 is dpa-020's U3 (merge the injectors, AST-based) — NOT U1 (the missing `emitCall` branch). Ratifying the verdict SHARPENS that call, it does not settle it.** |
| dpa-021 | **COMPLETE (ADVISORY) dPA 2026-08-04** — verified **BY EXECUTION**. **B survives: direction intact, stated form does not.** One *raw* binding CANNOT serve both forms; one *Proxy* can; **B needs FOUR parts, not one.** **★ The hazard is a CONFIDENTIALITY BREAK, not merely `semantics-changed`** — proven: a request-controlled key yields the live session id and the full record incl. `csrfToken`, at HTTP 200, no diagnostic. **★ BLOCKER absent from the brief: detection never fires for the interpolation-only case → the fix would emit NOTHING and #357 would stay open.** **★ KEEP the AST lowering — 3 security gates match its literal string.** **⚠ Routed separately: `@session` is unlowered → a client-supplied body field read as identity, in a GREEN conformance case.** → `scrml-support/docs/deep-dives/gh357-session-binding-accessor-shape-2026-08-04.md` | **RATIFIED S319** (bryan: *"ratify all three"*) — **B survives, four parts not one; Proxy binding; KEEP the AST lowering.** Insight landed `[S319/dpa-021]`. **Consequence: the staged `gh357-session-sql-interpolation` brief is missing the detection blocker and MUST be revised** (banner applied). Routed HIGH filed: `g-session-ambient-unlowered-trust-boundary-inversion` (PA-verified by emission). |
| dpa-022 | **BANKED S322 — UNRUN.** markup is a STATE KIND that renders, not a VALUE TYPE state can hold. bryan's framing is the PREMISE (stated-intent-beats-corpus), not one of two options; L1/§1.4/PRIMER are the artifacts to reconcile. Axiom-level, R2 min. | S322 block · "bank it" |
| dpa-023 | **BANKED S322 — UNRUN.** the async boundary as a `(not to T)` lifecycle + discrimination-as-transition — subsume or complement the auto-await machinery, and where a non-coloring suspension marker fits. Axiom-level, R2 min. ⚠ interacts with the LIVE unbuilt option-C absorb ruling. | S322 block · "bank it" |
| dpa-017 | **RATIFIED S230 2026-06-28** (user "go with your recos") — HYBRID: **B (origin-keyed structural redaction at the compiler-emitted egress sink) = load-bearing FLOOR** · A (same provenance map, static-prove) = demoted DX LAYER, **DEFERRED** · field-level **`reveal("col")`** = sole declassification · dynamic-SQL strip-all+lint · raw/FFI egress fail-closed. PA-verified the stale-cite flag, then authored **SPEC §14.8.9** (Nominal/spec-ahead) + fixed §14.8.7's stale `E-ROUTE-003` cite + minted **E-PROTECT-004 + I-PROTECT-STRIP-001** (§34, land-with-impl) + landed the insight + SPEC-INDEX regen. **Residual = the FLOOR BUILD** → `docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md` (sPA-slot-able; OQ-1 descriptor-lifetime first). | **RATIFIED** (build pending) |

**⚠ DRAIN-PATH RULE (S319).** The dPA drains **THIS file**. A deliberation banked anywhere else does not exist to it. Witnessed S316→S319: seven conclusions were rung-assigned into `scrml-support/docs/deep-dives/S316-DELIBERATION-QUEUE.md` and the hand-off recorded *"the dPA is RUNNING on Q1/Q2/Q3"* — it was not and never had been; the dPA drained the dpa-018 Pole-D conditional (which IS in this file) instead, and the three deliberations sat unrun across two sessions while every build that depended on them stayed held. **Same shape as the review-floor and `gh issue list` misses: an obligation named in one place, a probe reading another.** Bank deliberations HERE; a separate rung-assignment doc is a companion, never the carrier.

**Genuinely-open (PA action needed):** **dpa-019 · dpa-020 · dpa-021 — DRAINED 2026-08-04, now ADVISORY awaiting ratify/reject/re-frame** (the dPA never flips to `ratified`). **Three PA follow-ups the drain generated, none of them the deliberations themselves:** (1) **RETRACT the false "no `srcmap-provenance.ts`" premise from the RATIFIED brief** `docs/changes/ask7-style-provenance-spec/BRIEF.md:61-76` — it is normative guidance built on a non-recursive grep; (2) **REVISE `docs/changes/markup-autoawait-all-emitters/BRIEF.md` BEFORE dispatch** — as written it cannot fix the server-fn case; (3) **BANK + severity-call the routed `@session`-unlowered defect** (client-supplied body field read as identity, in a green conformance case). · dpa-010 · dpa-011 (advisory, meta/flogence-domain — ratify-or-defer). **dpa-017 RATIFIED S230** (HYBRID B-floor; SPEC §14.8.9 + codes + insight landed) → residual is the **FLOOR BUILD** (slot to an sPA). **Everything else is ratified / routed / deferred → the residual is BUILDS, not gates.** Highest-leverage residual builds = **the protect-leak floor** (`docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md`) + **`g-tier1-ssr-prerender`** (its SSR boundary MUST apply the same §14.8.9 egress filter — they compose; survey-scoped S229, ruling-gated; the §52 write-back was RETRACTED S194, NOT the residual).

---

## [dpa-001] debate — External-backend boundary: typed-external-API primitive (A) vs docs-only (B) vs stay-full-stack (C)
status: ratified     # banked → running → complete → ratified(by PA)  ·  RATIFIED S210 2026-06-20 (user "ratify ship A2") → insight landed in ~/.claude/design-insights.md; A2-thin direction committed (BUILD is a downstream arc); serve-side raw-route + SSR-gap carried open
banked: S210 2026-06-20
output-path: scrml-support/docs/debates/external-backend-A-vs-B-vs-C-2026-06-20.md
source-DD: scrml-support/docs/deep-dives/external-backend-frontend-only-2026-06-20.md (§Recommendation-for-Debate)

### Scope-lock (COMPLETE framing — lifted from the source DD §Recommendation-for-Debate)
Question: Should scrml ship a **first-class typed external-API primitive** to court the bring-your-own-backend
  (BYOB) segment (A), **document the already-working client-only path and nothing more** (B), or **refuse the
  segment** to keep the disappearing-boundary identity laser-sharp (C) — and where does the on-ramp-vs-dilution
  axis land? (BYOB = a scrml frontend over an existing external Rust/Go/etc. backend.)
In scope: the A-vs-B-vs-C fork + the philosophy axis (does a typed external boundary contradict scrml's
  "no API layer to drift out of sync" identity?).
Out of scope: **D (hybrid — docs now, primitive gated on signal) is the likely SYNTHESIS, NOT a starting pole**
  — let the judge land there; do not seed it. **A1 (OpenAPI ingest) is eliminated as the FIRST move** — heaviest
  surface; OQ-4 says the response-typing half is already covered → if A ever ships, A2 (declared-shape,
  contract-in-source) is the co-location-honest start. **C-as-"refuse-to-document" is dominated** (the mode
  exists regardless; no synthesized persona favored it) — debate C as the deliberate-identity-focus stance, not
  as document-refusal.
Already-known (the converged core, PA-verified S209 — do NOT re-litigate): client-only-over-an-external-backend
  WORKS today (raw `fetch()` is NOT a §12.2 server-trigger → pure client SPA; `<request>`/`<poll>` + `parseVariant`
  §41.13 are the primitives). The gap: no first-class `<api>` primitive typing an external HTTP endpoint the way
  `<db>` types SQL; the flagship disappearing-server-boundary is given up in this mode. **SSR-of-external-data is
  structurally GAPPED** (no scrml server to prerender on; getting it back = a scrml BFF/proxy tier, which
  re-introduces a server and contradicts the BYOB premise — A/B/D all inherit this).

### Load-bearing scrml CONSTRAINTS (verbatim — prevents scope_blindness)
- IDENTITY (README L5, verbatim): scrml's pitch is **"no API layer to drift out of sync"** — an `<api>` primitive
  RE-INTRODUCES exactly the API layer the identity disowns. This is the philosophy axis the debate turns on.
- CO-LOCATION axiom (user-voice S206, verbatim): "if a thing does a thing, I want to look at the thing and know
  what it does" — A2 (contract-in-source) satisfies this; A1 (external snapshot schema) is weaker.
- OQ-4 (the response-typing question): `parseVariant` (§41.13) + §53 refinement types may ALREADY cover the
  response-typing need, leaving only **request/endpoint** typing as the genuine gap — so a primitive's net-new
  surface may be just the typed-callable/endpoint half, not "a whole `<db>` analog."
- LIMIT-PRIMITIVES (S174, verbatim): "limit primitives, don't god-ify them" — weigh whether a new `<api>` surface
  is a sharper primitive or a god-object beside `<db>`/`?{}`.
- POINTER: the full converged core + the prior-art table (TanStack / Orval / openapi-ts / tRPC [same-language-only]
  / Relay+GraphQL / HTMX / Elm-ports / SvelteKit-load / Phoenix-LiveView) is in the source DD §Context + §Prior-Art.
- CAVEAT (carry into the debate framing): the source DD's dev-agent signal was **SYNTHESIZED, not polled**
  (dispatch was denied in that env) — OQ-2 (segment size: "the BYOB segment is the majority of realistic adopters")
  is **un-quantified**. The case for *gating* A (vs shipping it) rests on a number nobody has measured. RUN A REAL
  DEV-AGENT POLL alongside the debate (the 8 personas in the source DD §Dev-Agent-Signal) to close OQ-2.

### Approaches
- **A** — first-class typed external-API primitive (the `<api>` direction; A2 declared-shape preferred over A1 OpenAPI-ingest).
- **B** — docs-only (document the client-only `<request>`/`parseVariant` path + a recipe; ship nothing new).
- **C** — stay-full-stack / deliberate-identity-focus (the LiveView bet; forgo the BYOB cohort to keep the boundary sharp).
- (Judge may synthesize **D** — docs now, primitive gated on a measured BYOB signal.)

### Expert / forge list
- **Pro-A:** `react-trpc-subscriptions-expert` (in store → stage) — "everything crossing a boundary must be typed."
  **FORGE `openapi-codegen-expert`** (Orval / openapi-typescript / @hey-api — the literal A1/A2 prior art; the PA
  pre-forged this at bank-time S210 → `flogence/.claude/agents/openapi-codegen-expert.md`). `fsharp-type-providers-expert`
  (in store → stage) for the "compiler as read-only observer" discipline.
- **Pro-B / backend-agnostic on-ramp:** `htmx-hypermedia-expert` (in store → stage; backend-agnosticism as strength,
  low-ceremony) + `elm-architecture-expert` (EXISTS; typed boundary via explicit decode — scrml already has `parseVariant`).
- **Pro-C / disappearing-boundary purist:** `elm-architecture-expert` or a full-stack-purist voice + the Phoenix-LiveView
  stance; `simplicity-defender` (in store → stage) for the "are we sure we want a second data story?" check.
- **Real dev-agent poll** of the 8 BYOB personas (source DD §Dev-Agent-Signal) to close OQ-2 — run alongside.

### Report-back
one-line verdict + scorecard path → flip this item to `status: complete` + append the verdict here + a staged
design-insight CANDIDATE (`authority: dPA-produced, awaiting PA+user ratification`) + a `(dpa: complete → <path> ·
verdict: <one-line>)` breadcrumb in `scrml/handOffs/delta-log.md`. Do NOT ratify.

### Verdict (dPA, S210 2026-06-20 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/debates/external-backend-A-vs-B-vs-C-2026-06-20.md`
**One-line:** Ship **A2** (a thin, declared-shape `<api>` typing the request/endpoint half) on top of **B's documentation
philosophy** — **A1** (OpenAPI ingest) gated to first-party + CI-enforced contracts; **D's "gate on signal" condition
COLLAPSED** because the REAL 8-persona poll MEASURED the signal (BYOB ≈ 75% of realistic adopters — unanimous it's the
majority cohort; fork 7/8 toward a typed form); **C dominated** to a single surviving discipline constraint (the primitive
must NOT lie about what it verifies — encode the owned-vs-unowned-boundary epistemic difference at the declaration site).
**Scorecard:** B 45.5 / A 43 / C 40 (B narrow on points; synthesis + measured adoption risk break the tie toward A2-thin).
**Pipeline:** 6 experts live-dispatched (3 poles) + REAL 8-persona dev-poll (closes OQ-2) + neutral debate-judge.
**Staged design-insight CANDIDATE** (in the artifact §Design Insight): encode owned (`<db>`) vs unowned (`<api>`) boundary
typing as a type-system-visible distinction so the compiler never lies about what it guarantees. NOT landed in
`design-insights.md` (PA's act). **Poll fidelity caveat:** prompt surfaced the "drift" tension → fork-vote may skew to A
(size number ~75% is the solid takeaway); a debiased re-poll is the one follow-up that would harden "ship now". **PA action
requested** (4 items) in the artifact footer. RUN-not-RATIFY: the dPA did NOT ratify, edit SPEC, or land the insight.

---

## [dpa-002] DD/debate — flogence raw-route: serve-side typed HTTP boundary (FSP)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-23 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified.
banked: S215 2026-06-23
source: `scrml/handOffs/incoming/read/2026-06-20-from-flogence-fsp-raw-route-requirements.md` (READ — carries the full ask)
output-path: scrml-support/docs/deep-dives/serve-side-raw-route-2026-06-23.md

### Scope-lock
Question: Should scrml ship a first-class way to SERVE a raw/typed HTTP wire to FOREIGN clients — the serve-side mirror of dpa-001's consume-side `<api>`? (dpa-001 = scrml CONSUMING a foreign backend; this = scrml SERVING a raw wire to non-scrml consumers.)
Already-known: route inference (§12) auto-generates endpoints for scrml's OWN RI client; the gap is a DECLARED raw route a foreign client calls (the `handle()` escape hatch §40 serves raw today — the ask is an explicit/typed primitive). Same philosophy axis as dpa-001.

### Load-bearing constraints (verbatim)
- IDENTITY (README L5): "no API layer to drift out of sync" — same axis as dpa-001.
- CO-LOCATION (S206): "if a thing does a thing, look at the thing and know what it does." LIMIT-PRIMITIVES (S174): sharper primitive, not a god-object.
- The dpa-001 verdict (encode owned-vs-unowned boundary epistemics at the declaration site) likely TRANSFERS.

### Approaches
- A — declared raw-route primitive (serve-side `<api>`-analog / `raw=`/`serves=` route attr). B — docs-only (§12 + `handle()` already serve raw; ship a recipe). C — stay-implicit (foreign-client serving is outside scrml's identity).

### Expert / forge list
- Reuse dpa-001's roster (`htmx-hypermedia-expert`, `elm-architecture-expert`, `react-trpc-subscriptions-expert`) — same axis. Read the requirements doc for the FSP-specific shape.

### Report-back: §3 — one-liner + artifact path + staged insight CANDIDATE + `(dpa:)` delta-log breadcrumb. Do NOT ratify.

### Verdict (dPA, 2026-06-23 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/serve-side-raw-route-2026-06-23.md`
**One-line:** Ship **B** (a documented RECIPE over the ALREADY-SHIPPED `handle()` raw escape hatch §39.3 + the SSE author-path) — NOT a new `raw`-route primitive yet. The only genuine net-new is **OQ-1: wire the already-plumbed `route=` author-path for `server function*` in application mode** (the one minimal add BOTH A and B need). **Drop the `csrf="token"` strawman** — prior art + 7/8 synthesized devs say JSON+bearer is CSRF-exempt by construction, not by a new keyword. Approach **A** (first-class raw-route primitive) becomes right only at a future MULTI-endpoint scale the FSP wire does not present.
**Debate recommended? NO** — 3 live experts (react-trpc / elm / htmx) converged on B; 7-framework prior art + dev signal align; A-favoring facts are conditional. (Roster/framing recorded in-artifact if the PA contests B-now.)
**Key verified facts:** codegen ALREADY plumbs `explicitRoute`/`explicitMethod` (parser→RI→emit-server L1099/L1205); `handle()` already gives raw `Request`→`Response` with early-return short-circuit; NO `raw` flag exists today; single-URL JSON-RPC-by-body dispatch has NO prior-art primitive in any of 7 frameworks (so it's author-body-handled, not a language primitive). **C eliminated** — `<channel>` §38 already serves foreign WS clients in flogence prod, so "scrml refuses foreign serving" is already false.
**Open questions:** 5 (OQ-1 SSE author-path app-mode wiring [load-bearing/shared, the real gap] · OQ-2 collision-detection scope · OQ-3 exhaustive method dispatch · OQ-4 batch JSON-RPC · OQ-5 SSR-of-external-data carried). Staged insight CANDIDATE (serve-side owned-vs-unowned: "type the NEAR edge"; silent-to-loud as the primitive-justification test) in artifact; 6-item PA-action block at the artifact tail. RUN-not-RATIFY honored.

---

## [dpa-003] DD — `_{}` foreign-code codegen in a LOGIC context (flogence A)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-23 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified.
banked: S215 2026-06-23
source: `scrml/handOffs/incoming/2026-06-23-from-flogence-FOREIGN-CODE-dispatch-loop-requirements.md`
output-path: scrml-support/docs/deep-dives/foreign-code-logic-context-codegen-2026-06-23.md

### Scope-lock
Question: How should `_{}` foreign-code (SPEC §23) be LOWERED TO CODEGEN, recognized in a LOGIC context (server-fn / default-logic body), with its value flowing back to scrml? Today §23 is spec + markup-PARSE only — NO codegen consumer; `_={…}=` in logic is mis-tokenized as a JS assignment → E-CODEGEN-INVALID-JS.
In scope — the 4 flogence OQs: (1) LOCUS — valid in logic context or markup-only? (dispatcher needs it in a server-fn body). (2) VALUE-FLOW — does `const x = _{…}=` return the block's value to the enclosing scrml expr (JS-host boundary, await/absence per §42.9)? (3) CAPTURE — lexical capture of enclosing scrml locals into the foreign slice, or explicit pass? (4) SCOPE — full `lang=` toolchain (§23.5) or a first cut targeting `lang="ts"`/`"js"` (bundler-handled) — enough to unblock the dispatcher?
Already-known: §23 ForeignBlock AST node exists (TAB, ~SPEC L15576), NO codegen consumer. `_{}` is SLIVER-EMPTY (PRIMER §13.5 — 0 source uses) → greenfield.

### Load-bearing constraints (pointers — dPA pulls the NAMED sections)
- SPEC §23 (Foreign Code Contexts, lines 15461-15903) — level-marked braces §23.2, lang= §23.5, opaque passthrough. §13180 JS-host boundary; §42.9 absence-at-boundary. LIMIT-PRIMITIVES (S174): a ts/js first cut may be the sharper start.
- DEPENDS ON dpa-004 (boundary-retirement) — if scrml SHOULD drive processes/agents, `_{}`-spawns-subprocess is in scope; else it narrows. **Run dpa-004 framing FIRST.**
- Block-splitter Stage-1: extend `_`+level-mark+`{` opener recognition to Logic-parent context (S108 gate admits markup-only; Q-BUG4-OPEN-1 deferred).

### Approaches
- A — full logic-context codegen (recognize in logic + value-flow + lexical capture + full lang=). B — minimal first-cut (logic recognition + value-flow for ts/js only, explicit-pass capture, defer arbitrary lang=). C — markup-only (reject logic `_{}`; provide a different "call foreign from a server fn" mechanism).

### Expert / forge list
- **STAGED `foreign-function-interface-expert`** (`flogence/.claude/agents/` — LIVE at boot; EM_JS/cgo/Zig/Rust-extern/Lua-C-API/Bun-FFI prior art; argues explicit-marshal + narrow-capture boundary). Reuse `openapi-codegen-expert` / `fsharp-type-providers-expert` (already staged) if a typed-boundary contrast helps.

### Report-back: §3. Do NOT ratify.

### Verdict (dPA, 2026-06-23 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/foreign-code-logic-context-codegen-2026-06-23.md`
**One-line:** Ship **Approach B** (logic-context recognition + value-flow for `lang="ts"`/`"js"` only, MIRRORING the proven `?{}` lowering + EXPLICIT/named-pass capture, defer arbitrary `lang=`) — satisfies all 4 dpa-004 conditions, matches FFI prior-art consensus 5-to-1 toward explicit boundary-crossing (EM_JS/EM_ASM_INT/cgo/Rust `asm!` all explicit; Nim `{.emit.}` implicit-capture was walked back), and exactly fits the dispatcher's ts-only need with no overshoot.
**OQ answers:** OQ1 LOCUS = yes-in-logic, server-fn-colored (settled by dpa-004 C2). OQ2 VALUE-FLOW = yes, mirror `?{}` (§13180 JS-host boundary, await/absence §42.9). OQ3 CAPTURE = EXPLICIT named-pass, NOT free lexical capture (FFI discipline + dpa-004 C3/C4). OQ4 lang= = ts/js first cut (the requirements doc's "§23.5" doesn't exist — lang= is §23.2.1 — which SHRINKS OQ4: arbitrary-lang inline value-flow has no defined runtime model in §23).
**Two flags for the PA (NOT in original framing — surfaced by the DD):**
  (1) **SPEC contradiction:** §23.2.4 currently FORBIDS all logic-context `_{}` while §13180 already names `_{}` as a value-flow boundary source — the amendment must reconcile these.
  (2) **Library-mode §44.7.1 (B co-requisite) is NOT landed** — VERIFIED by compiling: `generateLibraryJs` rejects server-only nodes (E-CG-006); standalone `--mode library` with top-level `?{}` emits raw SQL → E-CODEGEN-INVALID-JS. W5a/W5b are unbuilt-territory comments only. **Consequence:** (A) `_{}` codegen ALONE unblocks the **in-app** dispatcher (a `_{}` server fn in `app.scrml`, which already has `<program db>`); the user's PREFERRED **standalone** `dispatch.scrml` is additionally gated on the separate (B) library-mode-db DEV work-item. This is the live fork (OQ-F1). E-CODEGEN-INVALID-JS mis-tokenization reproduced exactly.
**Open questions:** 5 (OQ-F1 in-app-vs-standalone the live one + OQ2/3/4 residuals + §23.2.4 reconciliation). Staged insight CANDIDATE in artifact. RUN-not-RATIFY honored.

---

## [dpa-004] debate — Retire the "scrml models intent; the harness drives instances" boundary (FOUNDATIONAL)
status: ratified     # RATIFIED S215 2026-06-23 (user "Ok, lets go") → SCOPED-RETIRE under C1–C4; insight LANDED in ~/.claude/design-insights.md [S215/dpa-004]. COMMITTED downstream (tread-softly, builds-pending): §23.2.4 amendment (C2 — PA-verified §23.2.4 forbids logic-ctx `_{}` today → E-FOREIGN-004) · dpa-003 codegen · capability-gating (C4)→dpa-008 · build-story interaction→dpa-006.
banked: S215 2026-06-23
source: source msg §"The boundary — INTENTIONALLY RETIRED"
output-path: scrml-support/docs/debates/s199-boundary-retirement-2026-06-23.md

### Scope-lock
Question: Should scrml BLESS retiring the S199 boundary — "scrml models + emits intent; the harness drives instances; scrml cannot launch/prompt a Claude instance"? With `_{}`, scrml ITSELF can drive instances (spawn agents/processes). flogence is retiring it on its side; does scrml's identity accommodate "scrml drives agents," or is the boundary load-bearing?
**FOUNDATIONAL self-conception shift** — per `feedback_no_batch_ratify_foundational_axioms`, deliberate-and-ALONE, sequence FIRST (gates dpa-003's scope). NOT a compiler question — a LANGUAGE-IDENTITY/scope question.
Already-known: flogence's claim — the boundary was always a CONSERVATISM, not a scrml limit (cf. scrml-server-envelope finding; FSP T3 reframe). `_{}` is the dissolving mechanism.

### Load-bearing constraints (verbatim)
- S199 boundary text (verbatim, source msg §boundary): "scrml models + emits intent; the harness drives instances; scrml cannot launch/prompt a Claude instance."
- Connects to the flux/flogence dogfood arc (scrml authoring its own harness) + memory `project_flogence_vpa_workflow`. Disappearing-server-boundary identity (README) — does "scrml drives agents" sprawl scope or extend it?

### Approaches
- KEEP — boundary is load-bearing identity (scrml models; humans/harness drive). RETIRE — `_{}` makes scrml a systems language that drives agents; bless it (flogence's position). SCOPED-RETIRE — retire for the `_{}` foreign-code escape hatch (the explicit "drop to systems" door) but keep the default-surface framing.

### Expert / forge list
- **STAGED**: `simplicity-defender` (KEEP / scope-discipline pole) + `glue-orchestration-language-expert` (RETIRE pole — Lua/Nix/Tcl/shell/Bazel glue tradition; the Nix "pure AND drives builds" precedent). Both LIVE at boot. A positioning debate, not codegen.

### Report-back: §3 — **ADVISORY**; user+PA ratify this axiom (RUN-not-RATIFY doubly load-bearing for a foundational shift).

### Verdict (dPA, 2026-06-23 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/debates/s199-boundary-retirement-2026-06-23.md`
**One-line:** **SCOPED-RETIRE** — retire the S199 prohibition for the explicit `_{}` door (first-party use), keep the reactive default-surface pure; the boundary predates `_{}` and is now a doc inconsistency, while the external `.ts` harness it forces IS the co-location drift scrml's identity disowns. The `?{}` SQL door (E-SQL-004) is the local precedent → `_{}` is a *consistency extension, not a new capability category*.
**Scorecard (identity rubric):** KEEP 44.5 / SCOPED-RETIRE 44.0 / RETIRE 35.5 — KEEP edges on points but leads *by refusing the live requirement*; decision recommendation is SCOPED-RETIRE. All 3 poles converged on "`_{}` is already the door."
**4 ratification conditions (C1–C4):** C1 `_{}` is the ONLY process-spawn path (SPEC commitment; native primitives lower THROUGH it, never around). C2 server-`function`-body placement only (extend E-SQL-004 color rule; compiler-enforced). C3 framed as "foreign-code land, not a blessed pattern" (KEEP's convergence condition). C4 first-party ONLY today; multi-tenant gated on a not-yet-existing capability-gating mechanism.
**Gates dpa-003:** SCOPED-RETIRE ⇒ `_{}`-spawns-subprocess IS in scope (first-party); C2 = hard codegen placement constraint; value-flow/capture honor C3/C4 (typed return, declared-at-call-site capture).
**Staged design-insight CANDIDATE** in the artifact (`authority: dPA-produced, awaiting PA+user ratification`) — NOT landed in `design-insights.md` (PA's act). **PA action requested** (4 items) in the artifact footer. RUN-not-RATIFY: the dPA did NOT ratify, edit SPEC, or land the insight.

---

## [dpa-005] DD — Server-authoritative state / server-drivable engine (giti F1 + flux G1)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-23 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified.
banked: S215 2026-06-23
source: giti F1 (`handOffs/incoming/2026-06-22-1443-giti-to-scrml-three-codegen-findings.md` repro-24) + flux MMORPG (memory `project_flux_game_dogfood` G1)
output-path: scrml-support/docs/deep-dives/server-authoritative-engine-2026-06-23.md

### Scope-lock
Question: How does a SERVER drive a client-side `<engine>` (or server-authoritative reactive state)? giti F1: a `server function` writing an `<engine>` cell fires E-RI-002 (CORRECT per §12.2 — server fns can't mutate client reactive state). The capability giti wants (a server refresh driving a channel-synced engine) doesn't exist; giti fell back to `<match for=Phase on=@cell.state>` over a typed channel cell.
In scope: (1) canonical pattern for server-authoritative state machines (channel-cell + derived-engine/`<match>`? a server-drivable engine?); (2) should E-RI-002's diagnostic STEER to that pattern (targeted message) vs the blunt current text; (3) the §52 server-sync codegen flux's MMORPG (G1) is blocked on — SAME axis (one shared server-authoritative world). One deliberation covers giti + flux.
Already-known: §38.4 channel-cell writes ARE client-side syncs (allowed); engine cells aren't channel-backed → server write = RI violation (correct). PRIMER §51.0.A: the engine-singleton IS scrml's typed global reactive store.

### Load-bearing constraints (pointers)
- §12.2 RI (the rule F1 hits — CORRECT); §38.4 (channel-cell-write = client sync); §52 (state authority / server @var / read-authority + reactive-wiring); PRIMER §51.0.A (engine = typed global store).
- A small fix likely FALLS OUT: a targeted E-RI-002 message steering to the channel-synced-engine pattern (the giti msg suggested this).

### Approaches
- A — canonical pattern = channel-cell + derived-engine/`<match>` (today's answer); ship a targeted diagnostic + recipe, no new primitive. B — a server-drivable engine (engine cell backed by a channel/§52 authority the server writes, synced to clients). C — a §52 server-sync codegen primitive (the flux G1 need) consumed by both giti + flux.

### Expert / forge list
- `elm-architecture-expert` (global) + `xstate-expert` (global) + **STAGED `server-authoritative-state-sync-expert`** (`flogence/.claude/agents/` — LIVE at boot; Convex / Phoenix-LiveView / Colyseus / Replicache / CRDT prior art; argues server-owns-truth, engine-as-view).

### Report-back: §3. Do NOT ratify.

### Verdict (dPA, 2026-06-23 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/server-authoritative-engine-2026-06-23.md`
**One-line:** Adopt **B** (`<engine server=@source>`) as the canonical server-authoritative engine form, with **A** (synced-cell + `<match>`) as its no-`rule=` VIEW variant — they are the SAME server-owns-truth / client-derives model at two grains. All 3 experts converge (server-auth-sync: "the Convex analogy is exact"; elm: "exactly consistent"; xstate: "this IS the restore-not-transition split = `createActor({snapshot})`"). **Eliminate C-as-new-primitive** — its write-back half is build-existing-spec, its auto-fan-out half is the already-rejected S174 Q3 P2.
**KEY FINDING:** B is the **S199 E-leg** — `<engine server=@source>` is already SPEC'd + parsed + type-checked; it fails ONLY at codegen, on the §52 server-cell LOAD (`<var server> = ?{}.get()` leaks a raw `?{}` placeholder: `reactive_set("driver", await (?{ /* sql */ }.get()))`), NOT on the engine wiring. So the engine-hydration half is BUILT; the sole blocker is the **§52 server-cell codegen** — which is the SAME axis as flux's G1. One codegen fix unblocks giti AND flux.
**Targeted E-RI-002 diagnostic = YES, ship-now, independent of A/B/C** — a one-site change at `route-inference.ts:3534-3542`; steers to both blessed recipes (`server=@source` + channel+`<match>`). **CAVEAT:** ship it WITH-or-AFTER the §52 codegen fix, else it steers devs to a form that currently fails codegen.
**Verification (live 2026-06-23):** E-RI-002 fires on giti repro-24; Approach A compiles clean; Approach B fails only at the §52 cell-load codegen. **Open questions:** 4 (§52 read-load vs engine-subscription as a 2nd gap; giti-read-load vs flux-write-back = one codegen task or two; flux MMORPG-scale delta-encoding; whether the deferred name↔variant bridge ships with the fix). Staged insight CANDIDATE in artifact. RUN-not-RATIFY honored.

---

## NOT a dPA item (dev-scoping, not deliberation)
- **Library-mode codegen seam** — flogence (B) library-mode `?{}` db-injection (§44.7.1 W5a/W5b — confirm status) + giti F3 (`g-safecall-bang-handler-not-lowered-in-library-mode`). These are a DEV work-item (a codegen gap to fix + a status read), not a design deliberation. If the §44.7.1 status read surfaces a design fork, fold it into dpa-003. Otherwise → PA/dev pipeline. (Tracked as dpa-007 CANDIDATE below + the MED gap `g-library-mode-sql-no-db-context`.)
- **dpa-013 — flogence transport JSON-RPC `method`-string ⇄ `<endpoint>` `accepts= by=` mapping** — DIRECTION-RATIFIED S220 (option A, a configurable discriminator field); reframed DD-candidate → **BUILD-candidate** for the flogence transport cutover off TS `fsp-wire.ts` (ss18/ss24). NOT a deliberation — a build. (Captured S225 so it isn't a forgotten thread.)
- **§52 server-cell WRITE-BACK (flux G1 write)** — a codegen BUILD, carried in dpa-005's open-questions ("giti-read-load vs flux-write-back = one codegen task or two"); read-path landed S216. NOT a fresh DD → PA/dev pipeline (the bigger flux-write arc).
- **ss42 item-4 — the unbound-named-machine lint** — a PA/user RULING (should an unbound named-machine reference lint?), not a deliberation. → PA surfaces to user.

---

## PA ratification + in-Q candidates (S215, user "Ok, lets go. tread softly, DD anything even at all in Q")

**dpa-004 → RATIFIED** (above — SCOPED-RETIRE C1–C4, insight landed). **dpa-002 / dpa-003 / dpa-005 → DIRECTION-RATIFIED** (dPA verdicts accepted as direction; BUILDS downstream — tread-softly, fire as ready):
- **dpa-002** → ship **B** (recipe over `handle()` §39.3 + SSE author-path; net-new = wire `route=` author-path for `server function*` in app mode; drop the csrf strawman). Small dev item.
- **dpa-003** → **Approach B** (logic-ctx `_{}` + ts/js value-flow mirroring `?{}` + explicit named-pass capture). GATED on: §23.2.4 amendment (C2) + library-db (dpa-007) for the STANDALONE form (the in-app form needs only the amendment + codegen).
- **dpa-005** → adopt **B** `<engine server=@source>` + A as its no-`rule=` view. ⭐ sole blocker = **§52 server-cell codegen = flux G1** (one fix unblocks giti F1 + flux). Targeted E-RI-002 diagnostic ships WITH/AFTER the §52 fix. High-value dev convergence, NOT a DD.

### In-Q DD candidates (banked, NOT fired — user fires as needed)

> **DRAINABLE THIS dPA SESSION (S225 roster):** `dpa-006` (build-story × `_{}`) · `dpa-007` (library-mode `?{}` — may collapse to pure-dev once scoped) · `dpa-008` (`_{}` capability-gating — fire when multi-tenant is live) · `dpa-009` (foreign-lang inline marshaling) · `dpa-012` (re-examine `handle()`) · **`dpa-015` (markup-lease D-vs-G + block-lease subsumption — the consolidated "fully subsuming block-lease" thread; FORGE `stm-concurrency-expert`)** · `dpa-016` (maps-vs-flogence — GATED on flogence maturity, likely defer). All carry `why-in-Q` + `scope-when-fired`; the dPA scope-locks each on pickup. flogence-scoped artifacts (dpa-015) → `flogence/docs/debates/`; scrml-language artifacts → `scrml-support/docs/`.

> ✅ **PA-RATIFIED S225 — the whole dPA drain (user "the rest of the dpa drain looks good to me. keep handle()").** All 7 dispositioned:
> - **dpa-012 (`handle()`)** → **RATIFIED COLLAPSE-with-phase-clarification**: KEEP `handle()` (name unchanged — OQ-2 = keep), **KILL `raw` PERMANENTLY**, NO named pipelines (deferred **RETRIGGERABLE**, OQ-1: revisit on ≥2 documented non-auth route-group needs §40 AuthGraph can't express). **BUILD:** 2 lints (shadow-path + feature-creep) + one-`handle()`-block constraint + the §40 phase-ordering spec (`handle()` global-pre-routing → route inference → `<endpoint>` typed-post-routing) — PA authors §40, lints = sPA lane.
> - **dpa-015 (block-lease)** → **RATIFIED the Q2-collapsed direction** (flogence consumes a compiler-emitted `conflictsWith(A,B)` query; the D/G agent-side inference dropped). ⚠️ **CONDITIONAL — 2 §40.9 SPEC facts gate it:** does the §40.9 fixpoint output carry R/W edge-kind? does §31 DG resolve `@obj.field` to field grain? → **PA-to-verify before the W3.5 build is scoped** (cheap query-modifier vs §40.9 redesign). Build split: `conflictsWith`/`--emit-region-touch-map` = scrml compiler (W3.5); lease-coord + WARN→GATE = flogence. flogence-scoped artifact.
> - **dpa-006 (build-story × `_{}`)** → **RATIFIED**: foreign toolchain MUST enter the §58 Merkle closure (else false attestation); per-island sub-derivation; tiered by trust-root; the `build-time-exec` field **carries dpa-008's typed capability vocabulary** `{network/fs-read/fs-write/spawn/env/db}`. BUILD = §58 SPEC-amendment (PA), downstream of `_{}` codegen.
> - **dpa-009 (foreign-lang marshaling)** → **RATIFIED direction**: INLINE = ts/js + no-runtime C-ABI (Zig/Odin/Rust-cdylib via bun:ffi); SIDECAR = runtime-bearing (Go/Python/JVM). Design-record for the `_{}`/§23 build.
> - **dpa-007 (library-mode `?{}`)** → **ACCEPTED routing → PA/dev** (pure-dev codegen gap; sliver = Bun.SQL-vs-bun:sqlite injection contract). Not a debate.
> - **dpa-016 (maps-vs-flogence)** → **ACCEPTED deferral** (gate not met; dock ~0/628 — revisit when flograph/dock coverage is judgeable).
>
> **Net-new builds queued:** dpa-012 lints + §40 phase-spec · **dpa-015 §40.9 fact-check (PA, gating)** · dpa-006 §58-amendment (post-`_{}`) · dpa-008 vocabulary rides dpa-006. Design-insights landed (dpa-008/012/015). The remaining artifact `status:` frontmatter flips (advisory→ratified) are a wrap-time cleanup; THIS block is the authoritative ratification record.

## [dpa-006] CANDIDATE — Build-story × `_{}` foreign-code interaction
status: complete     # COMPLETE dPA 2026-06-27 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified. [was: candidate, banked S215]
### Verdict (dPA, 2026-06-27 — ADVISORY): **`scrml-support/docs/deep-dives/build-story-foreign-toolchain-closure-2026-06-27.md`** · **YES — the foreign toolchain is a build INPUT and must enter the §58 Merkle closure with the same force as source** (else §58.12 determinism is a FALSE ATTESTATION — a reproducibility AND supply-chain hole, SolarWinds/SLSA-class). **Per-island sub-derivation** (flakes input-graph → correct early-cutoff; maps to §58.10 dialect-islands + `<program story=>` recording island output hashes = a §58.5 node kind). **TIERED by trust-root:** Tier-1 ts/js-as-Bun-native = pin-by-REFERENCE to the scrml/Bun version already in the closure (~free) · Tier-2 external bundler binary = its own node · Tier-3 non-native `lang=` = mandatory content-addressed toolchain sub-derivation (real friction, load-bearing). Record a **`build-time-exec {sandboxed,network,capabilities}`** audit fact NOW (the substrate dpa-008 consumes). 2 experts (nix · security) converged. Routes to scrml PA: author the §58 wording. RUN-not-RATIFY honored.
why-in-Q: a `_{}` foreign slice + its `lang=` toolchain (§23.5) is a NEW input to `compile(source, buildStory)` (§58) — the content-addressed Merkle closure (§58.3/§58.5) must capture the foreign toolchain (bundler version) or the artifact is not reproducible from `build-story.lock` (the §58.12 determinism gap). Likely = §58.10 dialect-islands (per-program codegen customization via `lang=`) + the `<program story=>` attribute. BOTH §58 (Nominal) + `_{}` codegen are unbuilt → design them together BEFORE either ships. **YES — this touches the `<program story=>` thread.**
scope-when-fired: does a `_{}`/`lang=` slice enter the closure as a §58.5 node kind? · `lang=` × `story=` × dialect-islands §58.10 · toolchain pinning for determinism (§58.12).

## [dpa-007] CANDIDATE — Library-mode `?{}` db-injection design (§44.7.1 W5a/W5b)
status: routed-to-PA/dev     # dPA 2026-06-27 — SCOPED + DECLINE-AND-ROUTE: this is PRIMARILY pure-dev, NOT a design deliberation. [was: candidate, banked S215]
### dPA disposition (2026-06-27 — no debate artifact; decline-and-route per dpa-scrml §3): SCOPED on pickup → this is a **codegen GAP to fix, not a design fork.** dpa-003 already VERIFIED the substance (`generateLibraryJs` E-CG-006 rejects server-only nodes; standalone `--mode library` top-level `?{}` → E-CODEGEN-INVALID-JS; W5a/W5b are unbuilt comments). The only genuine design sliver is the **connection-injection contract** (emit targets `Bun.SQL` vs the harness's `bun:sqlite`) — and that is a narrow DEV ruling (which driver the compiled library targets / how the connection is injected into a standalone program), not a ≥2-credible-pole deliberation that earns the deliberation machinery. **ROUTE → PA/dev pipeline** (clusters with giti F3 `g-safecall-bang-handler-not-lowered-in-library-mode` on the library-mode codegen seam; gates flogence-(B) + the standalone `dispatch.scrml` per dpa-003). **If the dev work surfaces a real fork** (e.g. a multi-driver abstraction decision), re-bank it as a fresh dPA item with the fork framed. RUN-not-RATIFY: the dPA declined to manufacture a debate where the honest answer is "build it."
why-in-Q: gates flogence (B) + the standalone `dispatch.scrml`. dpa-003 VERIFIED §44.7.1 NOT landed (`generateLibraryJs` E-CG-006 rejects server-only nodes; standalone `--mode library` `?{}` → E-CODEGEN-INVALID-JS). Half-staged; the flogence msg flags a fork (emit targets `Bun.SQL`, not the harness's `bun:sqlite`). Clusters with giti F3 (`g-safecall-bang-handler-not-lowered-in-library-mode`) on the library-mode codegen seam.
scope-when-fired: `Bun.SQL` vs `bun:sqlite` injection · connection-injection contract for a standalone compiled program · may resolve to pure-dev once scoped (not necessarily a DD).

## [dpa-008] CANDIDATE — `_{}` capability-gating (untrusted / multi-tenant)
status: ratified-direction + gated     # dPA 2026-06-27 scoped-gated-hold → **PA-RATIFIED S225 (user "ratify")**. The no-regret DIRECTION adopted: move 1 (typed capability VOCABULARY `{network/fs-read/fs-write/spawn/env/db}` into dpa-006's `build-time-exec` field, NOT `sandboxed:bool`) RATIFIED — rides dpa-006 (the genuinely time-sensitive one). Moves 2+3 (`W-FOREIGN-UNDECLARED-CAPABILITY` advisory lint + `[capabilities:[]]` default) FOLDED into the dpa-003 `_{}`-codegen spec as a DECLARATION-FIRST requirement (there is no `_{}` to lint yet → sequenced with that build, not standalone-now). The GATING/enforcement decision HELD gated at **Pole-D (hybrid manifest-declared + kernel-enforced, Nix fixed-output model)** until multi-tenant `_{}` is a live requirement. **dpa-008 has NO standalone build now — it collapses into constraints on dpa-006 (the vocabulary field) + dpa-003 (declaration-first `_{}`).** C1 single-spawn-door = a security asset, guard it. [was: candidate, banked S215]
### Verdict (dPA, 2026-06-27 — ADVISORY-PREMATURE, gate NOT met): **`scrml-support/docs/deep-dives/foreign-code-capability-gating-design-space-2026-06-27.md`** · Drained as a **forward-scoping design-space MAP** (not a now-decision — C4 = first-party-only is still in force). 4 poles mapped: (A) manifest `[capabilities]` (Deno-style) · (B) per-call object-capability (theoretical ideal, hard to seal in a JS/Bun host) · (C) OS/runtime sandbox (mechanism not policy; Nix existence proof) · (D) **HYBRID manifest-declared + kernel-enforced** = the recommended TARGET (only model with a production proof — Nix fixed-output derivations — covering BOTH audit + mechanism). **Load-bearing finding = a CLOSING WINDOW + 3 no-regret moves to decide NOW (before `_{}` codegen ships + an ecosystem accretes on ambient authority — the npm-`postinstall`/Cargo-`build.rs` trap):** (1) set the typed capability VOCABULARY in dpa-006's `build-time-exec` format (`network/fs-read/fs-write/spawn/env/db`, not `sandboxed:bool`) · (2) an advisory `W-FOREIGN-UNDECLARED-CAPABILITY` lint (advisory first-party → ERROR at the C4 flip = a lint-level change, not a redesign) · (3) `[capabilities: []]` default. C1 (one spawn door) = a security asset (single choke point); guard it. 1 expert (security). **PA action = decide only the no-regret moves (couple to dpa-006); HOLD the gating decision until multi-tenant is live.** RUN-not-RATIFY honored.
why-in-Q: dpa-004 C4 ratified `_{}`-spawn for FIRST-PARTY only; untrusted `_{}` (library authors / user-uploaded modules) = arbitrary-code-exec, gated on a capability-gating mechanism that does not exist. Required before `_{}`-spawn is safe in a multi-tenant / third-party context. Fire when multi-tenant `_{}` is a live requirement.
scope-when-fired: the gating model (manifest §22.13 `[capabilities]`? per-module grant?) · composition with C1 (only-door) + C2 (server-fn placement).

## [dpa-003 REFINEMENT] (user, S215 design-conv) — "Inline all the way."
status: RATIFIED     # banked S215 → dPA 2026-06-23 ADVISORY → RATIFIED S216 (user "ratify both"): eliminate A3 · <api>-hybrid for (a) · coexist-by-process-lifetime for (b). Insight LANDED design-insights [S216/dpa-003]. BUILD downstream of §23.2.4 amendment + dpa-004.
output-path: scrml-support/docs/deep-dives/foreign-code-inline-typed-boundary-2026-06-23.md
The dpa-003 build is the INLINE value-returning form (`const out = _={ … }=`), NOT the current §23 sidecar-artifact form (the `<program lang=go build=… port=…>` whole-service shape). **Type interop = a TYPED BOUNDARY CONTRACT, not unified type systems:** scrml types the value crossing OUT (annotation, or `asIs` §14 for "a foreign value") + the explicit-named values crossing IN (the capture); the foreign internals stay opaque (dpa-004 C3 — "guarantees end at the brace"). Exactly the `?{}` model (typed result, opaque body). **IN-Q sub-points:** (a) how the return type is declared (annotation vs `asIs` vs inferred-from-TS); (b) does the §23 sidecar form COEXIST or get dropped now that inline is canonical.

### Verdict (dPA, 2026-06-23 — RATIFIED S216, user "ratify both")
**Artifact:** `scrml-support/docs/deep-dives/foreign-code-inline-typed-boundary-2026-06-23.md`
**(a) OUT-typing:** **ELIMINATE A3** (infer-from-TS) — it reverses the §23.2.3 opacity contract the whole `_{}` design rests on, and across 11 surveyed FFI systems NO ONE infers an inline block's return from its body (the inference lineages Zig `@cImport` / F# type providers BOTH require a pre-existing EXTERNAL artifact an inline slice is not; the `?{}`-infers precedent is disqualified — `?{}` infers from the OWNED `<db>` schema, dpa-001 owned-vs-unowned). The live decision A1 (annotation) vs A2 (`asIs`+narrow) is a **GENUINE NEAR-CALL**; dPA reads the **`<api>`-proven HYBRID** (OUT defaults to `asIs` §14.7 honesty / narrow-forced by E-TYPE-030; a call-site annotation states intent; `parseVariant` §41.13 discharges it — exactly the annotate-AND-decode §60.2/§60.5 already ships for the `<api>` unowned boundary).
**(b) sidecar:** **COEXIST** (not a near-call) — inline `_{}` and the §23 sidecar (`use foreign:` §23.4) are not rivals; the sidecar's typed compiler-generated client + managed lifetime is NOT subsumed by inline value-flow (which runs to a value and the process is gone). **Discriminator = process LIFETIME, not language:** in-process value-flow → inline; long-lived out-of-process service → sidecar. Honors dpa-004 C1 (`use foreign:` is a typed service-IMPORT, not a second host-driving door).
**Debate?** **YES but SCOPED + CONDITIONAL** — only for (a)'s A1-vs-A2-vs-hybrid, and only IF the PA+user don't accept the hybrid as the obvious read (FFI declared-signature tradition vs honesty/`unknown`-narrow doctrine pull opposite ways). Framing + participants staged in-artifact (`foreign-function-interface-expert` vs `typescript-discriminated-unions-expert`, `openapi-codegen-expert` on the hybrid, `fsharp-type-providers-expert` to confirm A3's elimination). (b) needs NO debate; A3's elimination + (b)-coexist are decision-ready.
**Open questions:** 6 (OQ-a1 the A1/A2/hybrid near-call · OQ-a2 non-tagged `asIs` narrow ergonomics · OQ-a3 §42.9 absence in the annotation [`T?`/nudge] · OQ-b1 division-rule spec wording · OQ-b2 dpa-009 interaction · + the inherited §23.2.4-vs-§13180 reconciliation carried from parent dpa-003). Staged insight CANDIDATE in artifact (owned→INFER / unowned→DECLARE-and-DECODE, never infer from the foreign side); design-insights.md NOT touched. **PA action requested** (5 items) in the artifact footer. **NOT a formal queue id** — a banked design-conv refinement of the ratified dpa-003; the PA ratifies/routes (RUN-not-RATIFY).

## [dpa-009] CANDIDATE — Foreign-language inline support model (per-toolchain marshaling bridge)
status: complete     # COMPLETE dPA 2026-06-27 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified. [was: candidate, banked S215]
### Verdict (dPA, 2026-06-27 — ADVISORY): **`scrml-support/docs/deep-dives/foreign-lang-inline-marshaling-2026-06-27.md`** · **Confirm the ranking + the division; the discriminator is "does the foreign lang bring a RUNTIME that fights Bun's?"** INLINE value-flow = **ts/js (native, free) + no-runtime clean-C-ABI langs (Zig/Odin/Rust-`cdylib`) via `bun:ffi`** (the typed C signature IS the marshaling contract). SIDECAR (`use foreign:` IPC) = every runtime-bearing lang (**Go**, Python, JVM). User's instinct (Go>Python inline) directionally right; sharper: a no-runtime C-ABI lang BEATS Go for inline — **Go → SIDECAR (its idiom: stdlib net/http, goroutines, static binary)**, with a documented inline escape only for a single pure coarse-compute fn. **Marshaling discipline:** only C-layout scalar trees cross inline; REFUSE GC heap objects / closures / non-`repr(C)` unions / callbacks-into-scrml (force serialize-or-sidecar). **Real friction = Rust-rich-types (`Result`/enums), NOT Go** → an `asIs`/annotation that ENFORCES the C-ABI constraint, not a new tier. 2 experts (FFI · go) converged. ⇄ dpa-006: every non-ts/js inline lang inherits Tier-3 toolchain-in-closure. Routes to scrml PA: author the §23 marshaling spec. RUN-not-RATIFY honored.
why-in-Q: "Inline all the way" makes language support HARDER than the sidecar form (sidecar = uniform `build=`+IPC, language-agnostic). The inline value-flow needs the foreign value to cross into scrml's **Bun/JS runtime** — a per-language MARSHALING bridge, NOT just "run the compiler." **ts/js is FREE** (same runtime — the `_{}` slice IS JS spliced into the emit, value crosses natively → why it's dpa-003's first cut). Every NON-JS language needs its own bridge, and the bridge (not the compile) is the cost. Honest ranking for INLINE-over-Bun: **ts/js (native) ≫ clean-C-ABI langs (Odin/Zig/Rust via `bun:ffi` dlopen — typed signature IS the contract) > Go (native but runtime+GC; `-buildmode=c-shared`/cgo awkward — far better for the SIDECAR-service shape) ≫ Python (interpreted; CPython C-API or subprocess; heavy boundary).** User's instinct (Go>Python) correct; refinement: **Odin likely beats Go for INLINE** (no runtime, clean C-ABI), Go wins for sidecar — they serve different shapes.
scope-when-fired: which non-JS langs get inline support + the per-language marshaling architecture (`bun:ffi` for C-ABI langs? subprocess+serialize for others?) · whether sidecar (§23 today) is the language-agnostic answer for non-C-ABI langs (Go service) and inline is reserved for ts/js + C-ABI-FFI langs · the `lang=` toolchain resolution §23.5.

---

## [dpa-010] debate — Source of truth for an exploratory agentic app: reasoning-store (reason-VCS) vs executable-contracts (+ the landing-gate fork)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-24 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified. INVOCATION CAVEAT RESOLVED: live expert dispatch WORKED (real 4-pole poll, not synthesis).
banked: S12 2026-06-24 (flogence PA)
scope: **FLOGENCE / PA-process deliberation — NOT a scrml-language question. Pull NO SPEC sections; there is no scrml-SPEC fact at stake.**
source-DD: `flogence/docs/deep-dives/source-of-truth-agentic-builds-2026-06-24.md` (§Recommendation-for-Debate)
output-path: **`flogence/docs/debates/source-of-truth-reason-vcs-vs-contracts-2026-06-24.md`** (flogence-scoped artifact, NOT scrml-support — these are flogence's own deliberations)

### Scope-lock (COMPLETE framing — lifted from the source DD §Recommendation-for-Debate)
Question: For an exploratory agentic app with **NO upfront spec** (e.g. flogence-the-app), should the durable source of truth be (⑤) a dock-served **REASONING store** the agent navigates-then-verifies, or (②) a generated **EXECUTABLE CONTRACT** (VibeContract mold — an unfakeable gate that cannot capture free "why") — AND is the landing gate **runtime-only (④)** or **tests-as-gate (②)**?
In scope: the ⑤-vs-② FORM fork + the runtime-vs-tests GATE fork, for the `exploratory-no-spec` project type ONLY.
Out of scope: the `stable-with-spec` type (scrml-the-language — SETTLED in the source DD: spec + conformance-tests, do not re-open). The reason-VCS-as-dock-query CONDITIONAL-GO is already accepted as direction; this debate STRESS-TESTS it against the executable-contracts pole before committing build — the judge may land that they are COMPLEMENTARY (reason-VCS = the cross-session FORM; an executable gate = the LANDING), not rivals.
Already-known (source-DD-verified S12 — do NOT re-litigate): the load-bearing element is ALWAYS an EXECUTABLE GATE, never prose-spec-first; **nobody serves reasoning deterministically** (the truth-ceiling is the open gap the field left); reason-VCS pays ONLY on the re-grounding line (a ~$0 deterministic query crushes the documented 7442× re-synthesis cost — the flogence product thesis) and ONLY if the keep-it-true cost is bounded by the dock's edge→live-node supersession; a trusted FREE-PROSE store re-imports ADR-rot → an authoritative-looking LIE (strictly worse than none).

### Load-bearing CONSTRAINTS (verbatim — prevents scope-blindness)
- THE TRUTH-CEILING (dock DDs, verbatim): a provenance record can be well-formed + `verified` + STILL WRONG about *why*. This is reason-VCS's central risk; the ⑤ pole must own it, not wish it away.
- "green compile ≠ works — RUN it" (the standing flogence lesson): runtime behavior is a real, already-relied-on truth-form (pole ④).
- reason-VCS = a deterministic QUERY elevation of the EXISTING `dock`, **gated on dock coverage rising from today's 0/628** — NOT a new authored prose store. (NO-GO as a free-prose store.)
- The re-grounding-cost gap (deterministic query ≪ re-synthesis) IS the flogence monetization premise — weigh accordingly.

### Approaches
- **⑤** reason-VCS-as-dock-query (navigate-then-verify; the operator's candidate; provenance/reasoning attached + served deterministically).
- **②** executable-contracts (VibeContract; spec/contract as the unfakeable source-of-truth gate).
- GATE fork: **④** runtime-only vs **②** tests-as-gate.
- (Judge may synthesize: reason-VCS as the cross-session FORM + an executable gate as the LANDING — complementary.)

### Expert / forge list
- **STAGED, live at boot** (`flogence/.claude/agents/`): `simplicity-defender` (does reason-VCS earn its apparatus / can the answer be lighter), `fsharp-type-providers-expert` (the gate / compiler-as-read-only-observer / anti-confabulation).
- **PA pre-forged at bank-time** (`flogence/.claude/agents/`, live at the dPA's fresh boot): `spec-driven-development-expert` (the ② executable-contracts/spec pole — Spec-Kit/Kiro/VibeContract/design-by-contract), `code-provenance-traceability-expert` (the ⑤ provenance/reasoning-attached pole, WITH the truth-ceiling caveat — ADR/DO-178C-traceability/literate-programming/dock).

### Report-back: §3 — one-liner + scorecard path + staged design-insight CANDIDATE (`authority: dPA-produced, awaiting PA+user ratification`) + a `(dpa:)` breadcrumb. Do NOT ratify. Artifact → `flogence/docs/debates/`.
### ⚠ INVOCATION CAVEAT (load-bearing): the source-of-truth DD's expert-consult was SYNTHESIZED, not polled — sub-agent expert invocation returned "agent type not found". This batch is run from a FRESH dPA boot (full roster live at process start) — but if invoking the staged experts STILL fails (nested curator→expert), FLAG it and degrade to synthesis HONESTLY; never fake a poll. Quick-verify invocation before the real run.

### Verdict (dPA, 2026-06-24 — ADVISORY, NOT ratified)
**Artifact:** `flogence/docs/debates/source-of-truth-reason-vcs-vs-contracts-2026-06-24.md`
**Invocation caveat RESOLVED:** a quick-verify probe + all 4 poles LIVE-DISPATCHED from a fresh boot (experts invoked directly from the orchestrator, NOT nested through curator) + neutral debate-judge. First source-of-truth deliberation in the lineage run on a REAL poll, not synthesis.
**One-line:** Adopt the **SYNTHESIS** (judge 48.5 / ④ runtime 43.5 / ② contracts 37.5 / ⑤-as-gate 30) — "source of truth" is **two orthogonal axes**: a GATE (must-pass, executable, unfakeable) and a NAVIGATION form (serves "why" at ~$0 vs the 7442× re-synthesis). The answer is a **non-promotion composition**: ④ runtime primary for the in-flux UI + ② tests-as-gate for the stable infra scripts + ③ types as the always-on shape-gate + ⑤ reason-VCS ONLY as a coverage-gated dock-query *navigation* form, never the gate. **②/⑤ are NOT rivals** (all 4 poles + judge reject the rivalry framing — gate vs form).
**Load-bearing rule:** the **non-promotion invariant** (honesty contract) — "a `verified` reasoning record is navigable, NOT authoritative; landing on served reasoning without passing the executable gate IS drift." Plus `simplicity-defender`'s sequencing: **build the unverified-reasoning sweep before the serve-reasoning layer.** reason-VCS CONDITIONAL-GO survives the stress test, in exactly the bounded dock-query shape (gated on coverage rising from 0/628).
**Staged design-insight CANDIDATE** in artifact (the two-axis split + non-promotion invariant + asymmetric gate-by-component-stability); `design-insights.md` NOT written (judge confirmed). **PA action requested** (4 items) in the artifact footer. RUN-not-RATIFY honored.

---

## [dpa-011] DD — Designing a valid PA test rig (FLOGENCE / PA-process)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-24 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified. INVOCATION CAVEAT RESOLVED: live expert dispatch WORKED (real 4-expert poll).
banked: S12 2026-06-24 (flogence PA)
scope: **FLOGENCE / PA-process deliberation — NOT scrml-language. Pull NO SPEC sections.**
source: PA-authored scope-lock S12 (user-approved 2026-06-24)
output-path: **`flogence/docs/deep-dives/pa-test-rig-design-2026-06-24.md`**

### Scope-lock (COMPLETE framing)
ANCHOR: this rig IS the executable gate for the PA system itself — the source-of-truth DD's own conclusion (you can't harden by prose; you need an unfakeable gate) turned recursively on the PA hardened-by-accretion. The DD DESIGNS the gate; it does NOT run it.
Question: How to design a rig that yields a CLEAN VERDICT — does `pa-base` actually work, and is it drifting — by running it on a real, bounded (~5–10 session) NEUTRAL project, without the three failure modes: (a) measuring the wrong thing, (b) no valid control, (c) ballooning into a measurement cathedral?
The design FORKS to resolve (the work):
- **F1 Measurement:** hypothesis + metric set — *behavioral* (drift incidents · re-synthesis cost · friction · recovery · deliberation triggers · which Rules fired) + *outcome* (completed? passed its executable gate?). NOT a Q&A judge.
- **F2 Control:** isolate "the PA moved the needle" from "the model is just good": (A) two comparable projects PA-vs-plain-Claude · (B) one richly-instrumented PA run vs documented baselines · (C) parallel independent slices. None clean — pick + mitigate.
- **F3 Works-vs-drift:** the rig tests works-NOW; detecting DRIFT needs the {og·base·spawn} lineage baseline. How they fuse into one verdict.
- **F4 Project profile + shortlist:** real · complex-enough-to-drift · bounded (~5–10 sessions) · VERIFIABLE executable done-gate · NEUTRAL (not scrml/flogence). 2–3 candidates.
- **F5 Which-PA + readiness:** `pa-base` (clean/productizable) vs og-PA (entangled) vs flogence-spawn — and CONFIRM pa-base is in a testable state (precondition; a moving target invalidates the rig).
- **F6 Rig weight:** pure-reuse of the PA's own emissions (delta-log / friction / wrap cost) vs light-additional instrumentation. Stay LIGHTWEIGHT — the cardinal constraint.
In scope: the rig DESIGN only + a go/no-go on the 5–10 session run + the first session's concrete plan.
Out of scope: actually RUNNING the rig; new measurement infrastructure beyond what the PA already emits; the model-split/dictionary; flogence features.
Already-known (don't re-litigate): measure behavior+outcome not Q&A (S12 comparison-instrument lesson); the done-condition must be an executable gate per project type (S12 source-of-truth DD); the lineage frame is where control + drift-baseline live; the S12 probe's lane realities (open lane fails on OOD, ~50% serial reliability, the gate holds, true-parallel needs git-worktrees) — though pa-base work is the heavy-reasoning lane, not the open lane; the 5–10 session cost is accepted; lightweight is mandatory.
Needs-discovery: the control-method pick + its validity threats; the project shortlist; pa-base's actual testable state; the minimal-yet-meaningful metric set from existing emissions; how works+drift fuse; prior art on honestly evaluating agentic-dev systems.

### Approaches: the F2 control-method fork (A two-projects · B single-instrumented-vs-baseline · C parallel-slices) is the load-bearing one; plus F5 which-PA. The answer is likely a composition.

### Expert / forge list
- **STAGED, live at boot:** `simplicity-defender` (is the rig worth its cost / can it be lighter), `fsharp-type-providers-expert` (the done-gate as read-only observer).
- **PA pre-forged at bank-time** (`flogence/.claude/agents/`, live at fresh boot): `experiment-design-causal-inference-expert` (F2 — the control/validity problem IS causal inference), `dev-tool-evaluation-expert` (F1 — measurement + anti-gaming: SWE-bench critiques / DORA / SPACE / Goodhart).

### Research (5 sources): project data (the comparison-instrument doc · source-of-truth DD · dpa-deliberation DD · lineage memory · flogence's existing delta-log/friction/wrap instrumentation · the S12 probe) · prior art w/ URLs (SWE-bench + critiques · RCT/causal-inference · DORA/SPACE dev-productivity-measurement · benchmark-gaming) · expert consult (above) · pa-base readiness check · synthesis = the runnable rig-design spec + validity-threats ledger + go/no-go.

### What-counts-as-an-answer: a concrete RUNNABLE rig design — chosen control method, metric set (mapped to existing emissions), a 2–3 project shortlist (each w/ a verifiable done-gate + why-it-tests-the-PA), which-PA + pa-base-readiness verdict, the lightweight reused instrumentation, an honest validity-threats+mitigations ledger, and a go/no-go on the run with the first session's plan. NOT "build a project."

### Report-back: §3 — one-liner + artifact path + staged insight CANDIDATE + `(dpa:)` breadcrumb. Do NOT ratify. Artifact → `flogence/docs/deep-dives/`. Feeds a debate (the F2 control-method fork) only if ≥2 methods survive.
### ⚠ Same INVOCATION CAVEAT as dpa-010 — verify the dPA can invoke its rooted experts; degrade to synthesis HONESTLY if not.

### Verdict (dPA, 2026-06-24 — ADVISORY, NOT ratified)
**Artifact:** `flogence/docs/deep-dives/pa-test-rig-design-2026-06-24.md`
**Invocation caveat RESOLVED:** all 4 experts live-dispatched + prior-art researched & adversarially verified (SWE-bench-Verified retirement CONFIRMED; "59%" narrowed to 59.4% of AUDITED failures; 10.6% leakage CONFIRMED).
**One-line:** **GO on Phase 1 (the premise test), runnable today; NO-GO on a direct "pa-base works" verdict until the extraction build lands.** The load-bearing F5 fact: **pa-base is NOT runnable (v1 design-ratified S181 but BUILD-QUEUED)** — so the rig runs **spawn-PA as the pa-base proxy (explicitly labeled)** in a **two-phase design**: Phase 1 tests the PREMISE (does ANY PA discipline beat bare-claude) now; Phase 2 (pa-base v1 arm vs the identical frozen control) is gated on extraction, does NOT block Phase 1.
**The rig (composition):** F2 control = **parallel independent slices, alternating, simultaneous bare-claude control arm, binary executable gate** (eliminates the judge); licenses only a **premise-scoped, threat-conditioned** claim (operator-spillover at n=1 is the unfixable threat — named/bounded). F1 metrics = behavioral counts (delta-log) + the binary done-gate (the only anti-gameable anchor) + cost-ratio; **NO composite score** (Goodhart/SWE-bench/DORA); PA never sees a running score. Done-gate = an **externally-authored, pre-committed, hash-locked executable oracle** (parser-conformance / differential-test reference) — the `compare.ts` 1-5 judge is the inversion to avoid. F6 = **reuse `compare.ts`/`lanes.ts`/`delta-log`; only net-new = a `--lane` flag + an aggregation query + the oracle exit-code wiring**; smell to watch = "the rig has its own backlog."
**Inherits dpa-010:** the rig's binary done-gate IS dpa-010's "executable read-only unfakeable gate"; the delta-log behavioral signals are the NAVIGATION layer, explicitly NOT promoted to the verdict — the two DDs fuse on the non-promotion invariant.
**Debate?** NO — F2 converged on C+spawn-proxy (the other control methods were eliminated, not left standing). **Staged design-insight CANDIDATE** in artifact; `design-insights.md` NOT touched. **PA action requested** (6 items, incl. the OQ-2 narrowing: the rig is a REAL but NARROW gate, not a general proof). RUN-not-RATIFY honored.

---

## [dpa-012] re-examine `handle()` in general (the global-middleware raw escape) — fit with the new inbound surfaces
status: complete     # COMPLETE dPA 2026-06-27 (ADVISORY) → debate artifact written, staged insight CANDIDATE, NOT ratified. [was: candidate, banked S219]
### Verdict (dPA, 2026-06-27 — ADVISORY): **`scrml-support/docs/debates/handle-reexamination-collapse-vs-reshape-2026-06-27.md`** · **COLLAPSE-WITH-PHASE-CLARIFICATION** (debate-judge **COLLAPSE 43 / RESHAPE 34.5**). **KEEP `handle()`** (the right low-ceremony global pre-routing infra primitive — CORS/log/redirect/opaque-auth have no body schema scrml can own). **KILL `raw`** (or make the deferral permanent — a path-bound raw handler is just `handle()` + a path filter; the raw-escape surface must be ONE thing). **Do NOT build named pipelines** — Phoenix needs them because **Phoenix has no AuthGraph; scrml's §40 AuthGraph (BUILT) already covers route-group-scoped auth**, deflating the named-pipeline gap to thin scoped-NON-auth residual that doesn't earn a DSL under LIMIT-PRIMITIVES (S174 breaks the tie toward discipline). **Ship now (both poles agree):** (1) shadow-path lint (warn if `handle()` path-checks a declared `<endpoint>` — the drift scrml disowns) · (2) feature-creep lint (warn if `handle()` returns a non-redirect/non-static `Response`) · (3) one `handle()` per program · (4) **spec the 2-phase ordering explicitly** (`handle()` global→route inference→`<endpoint>` typed — the one RESHAPE insight that survives). 2 experts (phoenix-plug · htmx) + judge. OQs: AuthGraph non-auth coverage (decides permanence) · `handle()` rename · multi-file composition. Routes to scrml PA. RUN-not-RATIFY honored.
banked: S219 2026-06-25
scope: **DESIGN re-examination — surfaced by the `<endpoint>`/`raw` ratification.** With the typed-inbound surface re-sorting (`<endpoint>` = typed inbound · `server function* route=` = SSE leg [landed] · `raw` = path-bound raw escape [DEFERRED] · §60 `<api>` = typed outbound), `handle()` (§40 — the GLOBAL middleware raw escape) is the one inbound surface NOT re-examined. Questions: is `handle()`'s shape right (global interceptor + `return not` fall-through)? Does it OVERLAP the deferred `raw` path-handler (global-middleware vs path-bound — Express `app.use` vs `app.post('/x')`)? With `<endpoint>` owning typed inbound, is `handle()` still the right home for the remaining raw/middleware cases (auth, logging, rewriting, path-bound-raw), or does it want a cleaner split? Does it compose cleanly with `<endpoint>` (ordering: does `handle()` see an `<endpoint>` request first)? Is its honesty story coherent (no typed guarantee — same footgun class the `<endpoint>` lint addresses)?
why-in-Q: the `<endpoint>`/`raw` pair is being built typed-first; `handle()` is the existing raw escape that pair leans on (it covers the interim raw case). Re-examining it ensures the whole inbound-surface family (`<endpoint>` / `raw` / `handle()` / `<api>` / SSE / channels) is coherent rather than accreted. NOT blocking the `<endpoint>` build — bank + fire when the build settles or the user wants the family rationalized.

---

## [dpa-014] debate — W4 chunk model: chunk-as-BUNDLE (A) vs chunk-as-LOAD-PLAN (B) vs HYBRID (C)
status: ratified     # banked → running → complete → ratified(by PA)  ·  RATIFIED S223 2026-06-26 (user "ratify W4"): ship B-conditional · MODEL-now/ACTIVATION-gated-on-Component-3 · OQ-2 deferred to Component-3/flux · C recorded (measured-regression-keyed) · OQ-1 modulepreload mandate = W4 wave spec · insight LANDED ~/.claude/design-insights.md [S223/dpa-014].
banked: S222 2026-06-26
voices: code-splitting-bundler-expert · in-browser-compilation-expert · threejs-webgl-integration-expert
source: handOffs/incoming/2026-06-26-from-spa-ss30-w3w4-fork-FOR-PA-RULING.md (sPA-developed fork) + the feel-of-performance arc SCOPE (docs/changes/feel-of-performance-approach-a-impl-2026-06-26/SCOPE.md)
output-path: scrml-support/docs/debates/w4-chunk-model-bundle-vs-loadplan-2026-06-26.md (dPA writes)

### Scope-lock (COMPLETE framing — do NOT re-derive)
Question: The feel-of-performance splitter (Approach A) already COMPUTES the per-route/per-role/interaction-tiered
  reachable set and EMITS it as a descriptor — but **nothing loads that descriptor** (the `_scrml_chunk_mount`
  markers are 100% inert / adopter-debug only; the page still ships its full monolithic `<script src>` fragment
  list, all eager). **W4 is the wave that makes the browser ACT on the split. What IS the chunk when the runtime
  acts on it?**
  - **A — inline BUNDLE:** the initial chunk becomes a self-contained compiled bundle (page-shell + N=0 factories +
    reactive inits inlined); HTML loads only `<script src=initial-chunk>` + runtime. Best cold first-paint, no
    registry waterfall. BUT fights scrml's existing registry (shared components duplicated per-bundle unless a
    shared-chunk dedup layer is added — re-inventing `_scrml_modules`); high codegen lift.
  - **B — LOAD-PLAN (sPA-recommended):** chunk stays a manifest/descriptor; components stay the separate
    self-registering `_scrml_modules` files they already are; the W4 runtime reads the manifest, eager-loads the
    N=0 fragments, defers tier1/tier2 to idle/hover. Cohesive with what scrml already IS, no duplication tax,
    limit-primitives-correct (chunk stays a sharp descriptor), wins on navigation; lowest codegen lift (a clean
    standalone W4 wave). Cost: more requests (HTTP/2 multiplex + per-file caching mitigate).
  - **C — HYBRID:** inline N=0 for first-paint + fragment-load the tiers. Best raw critical-path TTI, no dup on the
    cold tail; BUT two delivery mechanisms + N=0 inline still dups shared components across routes.
In scope: the A/B/C chunk-model fork + the cold-first-paint-vs-warm-navigation access-pattern axis that decides it.
Out of scope: building W4; role projection + Component-3 (upstream RS, separate); the chunk-graph optimizer impl detail.

### Grounding facts (empirically verified on trucking, post-W2 — do NOT re-litigate)
- scrml is ALREADY a content-addressed self-registering module registry (`_scrml_modules["components/x.client.js"]`).
- The page already loads only its route's import-graph fragments, not the whole app.
- The splitter computes a set FINER than the static import graph (N=0 reactive-reachability, role-keyed).
- **Sequencing caveat (load-bearing):** TODAY `serverFnNodeIds=0` + tiers empty + `_anonymous`-only role → the N=0
  set ≈ the whole route, so the split buys LITTLE until Component-3 (N≥1 interaction projection) + role projection
  land. W4's payoff is gated on Component-3 REGARDLESS of chunk model. The debate decides the model; the wave timing
  is gated separately.

### Why a debate (not a quick ruling)
Foundational / axiom-level (limit-primitives + co-location + no-batch-ratify-foundational-axioms). The bundler voice
argues "delivery is a graph-optimization problem the toolchain should own (shared-chunk extraction dissolves the
duplication objection; critical-path waterfall is the lever B can't pull)"; the in-browser-compilation + threejs
voices test it from the live-loop / playground-funnel / render-loop angles. The judge lands the access-pattern-decides
synthesis. PA brings the verdict to the user as a RULING (RUN-not-RATIFY).

### Verdict (dPA, 2026-06-26 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/debates/w4-chunk-model-bundle-vs-loadplan-2026-06-26.md`
**One-line:** Ship **B** (load-plan over the existing `_scrml_modules` registry) as the W4 chunk model — **CONDITIONAL on two mitigations all 3 experts independently demanded:** (1) the compiler emits `<link rel="modulepreload">` / 103-Early-Hints for the splitter's already-computed N=0 set (collapses B's discovery waterfall to a single HTTP/2-multiplexed fan-out AND warms the fragment cache before any JS executes); (2) tier deferral is **PROACTIVE prefetch** (hover for navigation; an imperative state-driven HOOK for render-loop environments), never idle/on-demand-at-click. With the modulepreload mandate, **A/B/C converge on the N=0 cold-paint axis** (preload erases the only waterfall; A's residual byte-compression edge is blunted by scrml's registry keys acting as a tree-shaking wall). **Pure A is DOMINATED for scrml** — re-partitioning the registry spends the content-addressed file-key contract (the language's sharpest primitive) to buy a cross-module-DCE win the contract won't grant (conceded by the A-pole advocate himself).
**Scorecard (neutral debate-judge):** **B 50 / C 36.5 / A 33.** Notable spreads: Idiomaticity B9/A4.5 (A's tree-shaking win is structurally blocked by the same registry it must honor) · Paradigm-fit B9/A4 (limit-primitives names A's bundler-backend god-move; B's manifest formalizes an already-computed artifact).
**C = HELD refinement** (post-Component-3, gated on a MEASURED cold-paint regression): scoped to first-paint-SLO surfaces (landing/playground) + the flux MMORPG's N=0 game-engine, and only in its `{route-unique→inline, shared→preload-fragment}` partition form so it keeps B's cross-route caching. NB scrml compile-owns-HTML → C's strongest form inlines N=0 into the HTML body (zero extra hop), not a separate bundle file.
**NEW design gap (none of A/B/C closes it):** **prefetch-trigger PROGRAMMABILITY** — a tiered loader that hard-wires its trigger to DOM events (hover→tier1, idle→tier2) silently fails environments with no DOM event model; the MMORPG needs `prefetchTier(id)` callable from the game loop on spatial proximity (a tier2 fetch mid-render-loop = 3 dropped frames; a proactive prefetch is not a frame event).
**Sequencing (fact #4):** the split is INERT until Component-3 (N=0 ≈ whole route today) → B is the only model whose LIFT matches a pre-Component-3 payoff (runtime plumbing over the existing registry; A would build a bundler backend to win only a compression delta on a closure the registry already serves). **Land the B MODEL now; gate W4 ACTIVATION on Component-3.**
**Pipeline:** 3 experts LIVE-dispatched (direct from the dPA orchestrator, not nested — invocation worked from a fresh boot) + neutral debate-judge. **Staged design-insight CANDIDATE** in the artifact (registry-key-IS-the-chunk-boundary · manifest = the min-new-primitive tiered-loading model · prefetch-trigger-programmability · the modulepreload-dissolving-move corollary) — NOT landed in `~/.claude/design-insights.md` (PA's act). **PA action requested (5)** in the artifact footer. RUN-not-RATIFY: the dPA did NOT ratify, edit SPEC, or land the insight.

---

## [dpa-015] debate — Markup-region leasing model (D state-footprint vs G containment-hybrid) + the block-lease compiler-subsumption — CONSOLIDATES 3 banked threads
status: ratified     # RATIFIED S227 2026-06-27 (user "1, ratify it") → Q2-collapsed ARCHITECTURE adopted as direction; cost-framing CORRECTED by the OQ-1/OQ-2 fact-checks (see PA-resolution below). [was: COMPLETE dPA 2026-06-27 ADVISORY; S225-consolidated from the S206 markup-lease DD + S221 W3.5 coupling]
banked: S206 2026-06-18 (markup-lease DD) · S221 (block-lease W3.5 coupling) · consolidated S225 2026-06-27
scope: **FLOGENCE / parallel-dispatch deliberation — NOT a scrml-language question** (block-lease is a flogence mechanism; the compiler EMITS facts flogence consumes). Destined-for: flogence. Artifact → `flogence/docs/debates/`.
source-DDs: `scrml-support/docs/deep-dives/markup-lease-anchor-2026-06-18.md` (the D-vs-G debate; frontmatter `feeds-into: debate`) · `block-lease-parallelism-2026-06-18.md` (the §7.1 markup-anchor gap + the leasing scheme) · `docs/changes/feel-of-performance-approach-a-impl-2026-06-26/SCOPE.md` §3 (the W3.5 `conflictsWith` coupling)

### Scope-lock (the consolidation — three converging questions)
Block-lease = flogence's block-grain parallel-dispatch lease (lease a block-ID → no one else edits that block; the dock block-ID IS the lease token). It leases CODE DEFS cleanly but render-MARKUP has no named def → not leasable (block-lease §7.1 gap). S206: user REJECTED componentize-to-lease (b2-ii) on the **co-location-of-behaviour axiom + no-refactor-tax**; asked for a co-location-native answer. The requested DD (`markup-lease-anchor`) landed **STATE-KEYED lease** (lease a markup region by the reactive STATE it touches, not its structure) and left TWO approaches surviving every stress test:
- **Q1 (the DEBATE) — the leasing MODEL:** **D (state-footprint)** — pure reactive-touch-set lease, RW-lock adjudicated; simpler, with a known soundness hole on transitive writes (a handler writing shared state through a called fn). vs **G (containment-hybrid)** — containment "WHERE" (reorder-robust extent) + state-footprint "WHETHER" (markup-write-set by default + a declared-handler-footprint **ESCALATION** that surfaces the transitive-write hazard as a warning, not a silent merge). G = sound-enough via escalation at higher build cost; D = simpler with the hole. **BREAK-1 prereq:** compound `@form`→cell-grain needs dotted-path footprints.
- **Q2 (the SUBSUMPTION — the "fully subsuming block-lease" thread) — WHERE the conflict-query lives:** feel-of-performance's §40.9 reachability solver (W3, **BUILT S91**) computes EXACTLY the per-region reactive touch-set Q1's lease needs. The S221 coupling: expose a near-free **`conflictsWith(regionA,regionB)` / `--emit-region-touch-map` query (W3.5)** over the closure the compiler already computes → block-lease shrinks from "an agent-layer inference engine re-deriving the dep graph badly" to "an orchestrator consuming a compiler-emitted fact" (the S214 deterministic-layer split: program-inference → compiler-native; process-coordination → flogence). **The W3.5 retrigger ("revisit at W3") is NOW MET (W3 built S91) but UNACTIONED.**
- **Q3 (the CONVERGENCE — PA synthesis, never formally captured):** Q1's state-footprint lease-key IS Q2's §40.9 touch-set → the compiler's reachability query is plausibly the **co-location-native answer the S206 DD was hunting** ("the compiler fully subsumes block-lease's inference"). Does the D/G verdict change if the conflict-query is compiler-EMITTED (W3.5, sound) rather than agent-INFERRED? (Likely YES — a sound compiler touch-set may make D's soundness hole moot, collapsing D→a thin consumer of the compiler fact.)

### Already-known (don't re-litigate)
- componentize-to-lease (b2-ii) is REJECTED (co-location axiom + no-refactor-tax, user S206). Block-ID extraction via the compiler's real parser/AST (NOT a 2nd regex parser — drift→wrong-block-lease = the "two-holders" failure) is RULED + BUILT (block-analysis-emit D1+D2, S206 `696a53d0`/`91e4fc38`). The compiler ALREADY emits block-analysis (def-list + true-extents + per-block RW-footprint + markup-tree); flogence consumes it.

### Approaches: D (state-footprint) vs G (containment-hybrid) — RE-FRAMED by Q2's W3.5 subsumption (the compiler-emits-the-touch-set option may dominate or collapse the fork).
### Expert / forge list: **FORGE `stm-concurrency-expert`** (the markup-lease DD's named forge ask — STM / serializable-snapshot-isolation; the write-skew / read-after-write-hazard framing IS G's escalation case) + a reachability/dataflow voice for Q2 (compiler-emits-the-conflict-query).
### Report-back: §3 — one-liner + artifact path + staged insight CANDIDATE + `(dpa:)` breadcrumb. Do NOT ratify. PA brings the verdict as a ruling (RUN-not-RATIFY).

### Verdict (dPA, 2026-06-27 — ADVISORY, NOT ratified)
**Artifact:** `flogence/docs/debates/markup-lease-D-vs-G-block-lease-subsumption-2026-06-27.md`
**One-line:** **Q2 COLLAPSES the D-vs-G fork.** Both D (state-footprint) and G (containment-hybrid) are agent-side re-derivations of a fact the scrml compiler ALREADY computes — the §40.9 reachability solver (BUILT S91). Adopt the **Q2-collapsed model**: flogence consumes a compiler-emitted `conflictsWith(A,B)` query (W3.5) as a thin coordination fact (the S214 deterministic-layer split); G's hand-built escalation is redundant and should not be built; D is the acceptable interim coordinator. Gate-vs-warn resolves to **STAGED-WARN→GATE** (warn now with conflict-id logging, flip to gate when the fact's precision is empirically validated — a named/bounded/terminated rollout, never indefinite).
**Scorecard (neutral debate-judge):** **Q2-collapsed 50.5 / G 30.5 / D 26.** Sharpest spreads: Idiomaticity G3/Q2-9.5 (G *inverts* the S214 split) · Soundness D3/Q2-8.5 (D's write-skew hole is the NORMAL reactive case, not an edge) · Reorder D3/Q2-8.5.
**THE COLLAPSE IS CONDITIONAL** on §40.9 exposing three things — **(1) R/W partition** (shared reads safe; §40.9.3 already names edge kinds → likely a query-modifier, not a redesign — VERIFY), **(2) dotted-path grain** (`@quoteForm.originCity`≠`.weightLbs`; a §31 DG constraint — if it coarsens to `@obj`, GATE is likely unusable), **(3) read-after-write directionality.** Without R/W-partition the raw closure intersection is sound-but-imprecise → F-collapse (every handler reaches `refresh()` → conflictsWith→true for all → serial).
**Pipeline:** 4 experts LIVE-dispatched directly from the dPA orchestrator (stm-concurrency · salsa-incremental-compilation · elm-architecture[warn] · xstate[gate]) + neutral debate-judge. Invocation worked from a fresh boot.
**Two scrml-SPEC facts the dPA must NOT derive → route to scrml PA (OQ-1/OQ-2):** does the §40.9 fixpoint OUTPUT distinguish R vs W edges (query-modifier vs redesign)? does the §31 DG resolve `@obj.field` to field grain? These gate the whole cost estimate + the GATE's viability. **Build split:** `conflictsWith`/`--emit-region-touch-map` = scrml COMPILER work-item (W3.5); the lease-coordinator + WARN→GATE policy = FLOGENCE work-item. **Staged design-insight CANDIDATE** in artifact (compiler-already-computes-the-lease-key + precision-before-enforcement); `design-insights.md` NOT touched. **PA action requested (5)** in the artifact footer. RUN-not-RATIFY honored.

### PA-resolution (S227 2026-06-27 — RATIFIED option 1; OQ-1/OQ-2 fact-checked against current source, both spot-verified)
**OQ-1 (R/W partition in the §40.9 output): NO.** The DG *does* carry R/W edge-kinds (`reads`/`writes`/`validator-reads`/`engine-derived-reads`/`derivations`) — the S226 "DG carries R/W edge-kinds" claim holds AT THE DG LEVEL. But the §40.9 reachability **solver's OUTPUT** (`ChunkContents.reactiveCellNodeIds`, `compiler/src/types/reachability.ts:145`) is a bare **reads-only** `Set<NodeId>` — `component-2.ts:147` walks `{reads,validator-reads,engine-derived-reads}` and **explicitly excludes `writes`** ("handled by Component 3 — writer-side admission via interaction graph"). So there is NO per-region R/W touch-map in the §40.9 output; `conflictsWith` is a **real BUILD** over the existing edge-kind substrate (walk reads+writes per region, partition), **NOT the "near-free query-modifier"** the verdict assumed. Modest (rides existing data), but a build.
**OQ-2 (field grain): NO — OBJECT/compound grain.** `expression-parser.ts:630` adds the base `varName` and skips property-access positions; `emit-bindings.ts:348` subscribes on `rootKey` (base before the dot); compound members fold to the parent (§6.3.5, `dependency-graph.ts:2286`). `@quoteForm.originCity` and `.weightLbs` BOTH → the single `@quoteForm` node. A GATE on this **over-serializes disjoint-field access on the same compound** — field grain requires a **DG redesign to dotted-path node-keying = the BREAK-1 prereq**.
**RULING (option 1 — architecture ratified, cost corrected, staged):**
- ✅ **Q2-collapsed ARCHITECTURE adopted as direction** — the compiler owns the conflict-fact (S214 deterministic-layer split); flogence consumes a compiler-emitted `conflictsWith(A,B)`; the D/G agent-side inference is dropped; G's hand-built escalation is NOT built.
- ❌ **"near-free" framing struck.** dpa-015 = TWO real pieces: **(a)** a `conflictsWith`/`--emit-region-touch-map` query that walks reads+writes per region [modest, rides existing DG edge-kinds] + **(b)** a **DG field-grain redesign** for compound forms [the real cost = BREAK-1].
- **STAGED:** **WARN-now is buildable today at object grain** (sound, over-conservative — falsely serializes disjoint-field-same-compound, never unsafe) → the interim coordinator. **The GATE flip is gated on (b) the field-grain DG redesign + (a) the R/W-partition query**, NOT merely "validate precision empirically."
- **Sequencing:** not adopter-facing → priority BEHIND the HIGH bug + the board; build when concurrency pain is real. Design-insight (compiler-already-computes-the-lease-key + precision-before-enforcement) → land in `design-insights.md` at wrap. delta-log [176] (fact-check) + [177] (ratification).

## [dpa-016] CANDIDATE (gated) — do the `.claude/maps` survive flogence's compiler-emit + flograph?
status: deferred-gate-not-met     # dPA 2026-06-27 — reviewed in the drain-all batch; GATE explicitly NOT met → DEFER (no artifact; would be evidence-free). [was: candidate, banked S207]
### dPA disposition (2026-06-27 — no artifact; honest defer per R3/R5): The gate is "fire when flograph/dock coverage is high enough to judge whether the hand-maintained `.claude/maps/` are SUBSUMED by compiler-emit + flograph current-truth projection." **That gate is NOT met:** dock coverage is ~0/628 (per dpa-010's verified finding — reason-VCS CONDITIONAL-GO is itself gated on coverage rising from 0/628), and flograph projection isn't yet a drift-free current-truth source. A subsumption verdict now would be **evidence-free speculation** — the dPA RUNS-and-PRODUCES but will not manufacture a disposition the evidence can't support (R3 right-answer-beats-easy · R5 shoot-straight). **PA read (S207) stands: structural maps likely become obsolete once flograph is mature, but DON'T retire until proven.** **HOLD gated; the genuine fire-signal is a metric — dock/flograph coverage crossing a "high enough to judge" threshold.** Captured here so it stays drainable + doesn't rot as an invisible open-Q.
banked: S207 → captured S225 2026-06-27
scope: a disposition question — once flogence's flograph + compiler-emitted block-analysis are mature, do the hand-maintained `.claude/maps/` (project-mapper output) still earn their keep, or are they SUBSUMED (compiler-emit + flograph project current-truth drift-free)? PA read (S207): structural maps become obsolete; **DON'T retire until proven.** **GATED — fire when flograph/dock coverage is high enough to judge.** Captured here so it's drainable + doesn't rot as an invisible open-Q; NOT fire-now (the evidence isn't there yet).

---

## [dpa-017] debate — protected-column return-boundary contract: static-prove-and-error (A) vs structural-redaction-floor (B)
status: complete     # banked → running → complete → ratified(by PA)  ·  COMPLETE dPA 2026-06-28 (ADVISORY) → artifact written, staged insight CANDIDATE, NOT ratified. Verdict below.
banked: S229 2026-06-28
output-path: scrml-support/docs/debates/sql-row-protect-leak-contract-2026-06-28.md
gap: g-sql-row-protect-leak (LOW; NEW S175; deferred T1/T2/T3; design-track — "deliberate the contract shape before any implementation dispatch")

### Scope-lock (COMPLETE framing)

**Question:** What contract statically/structurally GUARANTEES a `protect=`-marked DB column never crosses the server→client return boundary — **(A)** static-prove-and-error (provenance/effect-typed `<sql-row>`; a server-fn return carrying a protected-bearing row to a client sink is a type/route error; the dev projects it out explicitly), or **(B)** structural redaction at the serialization boundary (the compiler-emitted response serializer strips `protectedFields` from every row by construction, regardless of source, paired with a static INFO-lint)? Where does the synthesis land (likely a hybrid — B-floor + A-as-DX-layer, OR A-load-bearing + B-backstop)?

**The leak (verbatim constraint):** `protect="passwordHash"` is meant to make a column server-only. The `protect-analyzer` (Stage 4) computes per-table `fullSchema` / `clientSchema` (protected excluded) / `protectedFields`. BUT: (1) read-site `?{}` rows are typed from the **full** schema (protected INCLUDED); (2) `E-PROTECT-001` is effectively MOOT — SPEC §14.8.7 concedes every `?{}` fn auto-escalates to server (§12.2 Trigger 1) so a "client-boundary `?{}`" does not exist; (3) `E-PROTECT-003` catches ONLY a batch-plan `rowCacheColumns` overlap; (4) the GENERAL server-fn RETURN boundary is **unguarded** — `server fn loadUser() { return ?{SELECT * FROM users}.get() }` ships `passwordHash` over the wire. SPEC §14.8.7 (verbatim) DEFERS this: *"The protected-column-projection leak (does a server-fn RETURN a row carrying a protected column to the client?) is a data-flow / server-fn-return concern for a follow-on (return-boundary / `E-ROUTE-003`), not a read-site projection check."*

**Load-bearing scrml CONSTRAINTS (verbatim — do NOT re-derive):**
- **Soundness is non-negotiable** — a SECURITY/confidentiality property; a false-negative IS a leak. The gap rules out the naive answer: *"A name-only check would be UNSOUND (an `AS`-aliased protected column = false-negative on a SECURITY check)."*
- **The `server` keyword is deprecated** (`g-server-keyword-drift`) — the contract MUST NOT key on a per-function `server` keyword; it is data-flow / boundary-shaped.
- **Value-flow is currently INCOMPLETE:** `inferReturnTypeFromBody` covers only object-literal returns, NOT bare `return u`, spreads, or returns through helpers. Any static-prove approach must confront this (fail-closed where it can't prove).
- **The 4 technical requirements the gap names** (static path): (1) a provenance channel on `<sql-row>` (source `(table,column)`); (2) body-return value-flow beyond object-literals; (3) a body-aware route gate; (4) new `E-ROUTE-*`/`E-PROTECT-*` + SPEC §14.8.7 ratification of the static-projection contract.
- **scrml pillars:** "the compiler owns the wiring" + "bullet-proof apps; provability falls out of the natural shape, not separate ceremony." `protect=` ALREADY strips protected fields from the client SCHEMA view (same `protectedFields` set) — extending that strip to the wire boundary is in-character.
- **Composes with the SSR arc:** `g-tier1-ssr-prerender` / `/__serverLoad` runs `SELECT *` with NO redaction today — the same boundary-redaction (if B) would cover SSR pre-render + the per-role gating arc. The chosen contract MUST NOT conflict with that arc.

**In scope:** the A-vs-B contract shape; the soundness floor (which mechanism has zero false-negatives on the adversarial set); the new error/lint codes + the SPEC §14.8.7 amendment direction; the declassification escape (how an app legitimately gets a protected field to the client, if ever).

**Out of scope:** the per-role content-gating runtime (GITI-027B Option-D — its own arc); SSR implementation (g-tier1-ssr-prerender — separate); the `protect=` schema/PRAGMA-layer enforcement (already works). **Do NOT seed the hybrid as a starting pole — let the judge land it.**

**Approaches (poles):**
- **A — static-prove-and-error** — provenance/effect-typed `<sql-row>`; a "client-safe row" return judgment; fail-closed where value-flow can't prove; new `E-ROUTE-*`/`E-PROTECT-*`; dev projects explicitly. → `type-systems-refinement-expert`.
- **B — structural-redaction-floor** — serializer strips `protectedFields` by construction at the wire; sound-by-construction (no value-flow reasoning); paired static INFO-lint. → `secure-boundary-redaction-expert`.
- **Soundness adjudication across both** — the security floor must have zero false-negatives. → `information-flow-security-expert`.

**Experts / forge list (PRE-STAGED in `flogence/.claude/agents/`, S229 — live at dPA boot):**
- `information-flow-security-expert` — the soundness authority (noninterference, sound-vs-complete, explicit-vs-implicit flows, reference-monitor, declassification).
- `type-systems-refinement-expert` — pole A (refinement/effect/provenance types, fail-closed static-prove).
- `secure-boundary-redaction-expert` — pole B (complete mediation, fail-safe defaults, boundary redaction).
- Pipeline: `debate-curator` + `debate-judge` (existing global).

**Deliverable:** scorecard + a design-insight CANDIDATE (authority: dPA-produced, awaiting PA+user ratification) → `output-path`. Feeds a SPEC §14.8.7 amendment the PA ratifies + a build decomposition.

### Verdict (dPA, 2026-06-28 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/debates/sql-row-protect-leak-contract-2026-06-28.md`
**One-line:** Ship a **HYBRID with floor/layer fixed by SOUNDNESS, not preference**: **B (structural strip-by-COLUMN-ORIGIN at the single compiler-emitted egress sink) is the load-bearing FLOOR** — sound by construction, alias-safe, propagates a query-lowering provenance descriptor through every compiler-emitted construction step (so NO value-flow-completeness obligation), and covers the SSR `/__serverLoad` boundary with the same filter. **A (provenance-typed return error) is the demoted DX LAYER** reading the **SAME** column-origin map (early teaching/minimal-wire, NOT trusted for the guarantee; A is UNSOUND-as-implemented — `inferReturnTypeFromBody` is object-literal-only → bare `return u`/spreads/helpers leak unless A flips to fail-closed reject). **`reveal` = the sole sink-checked declassification.** **Scope the claim honestly:** explicit-column flows of statically-resolvable SQL only — derived/implicit flows (`{ hasPw: row.passwordHash != "" }`) + covert channels are OUT (A4 defeats BOTH poles) and MUST be written into §14.8.7 so the prose doesn't over-claim.
**Scorecard (neutral debate-judge):** **B 50.0 / A 35.5.** Decided on Soundness (B9/A5, ±4.0) + Idiomaticity/co-location (B9/A6, ±3.0) — both flag the SAME direction.
**Pipeline:** 3 experts (2 poles + the `information-flow-security-expert` soundness adjudicator) + neutral debate-judge. ⚠ INVOCATION: fired `/dpa 017` from a **scrml-rooted** session, so the flogence-staged expert types were absent from the live roster — ran a **REAL poll via injected verbatim personas** into `general-purpose` agents (NOT degraded to synthesis); flagged in-artifact. (To get the true typed poll on a re-run: boot the dPA rooted in flogence, or copy the 3 experts to `~/.claude/agents/`.)
**KEY VERIFIED FACT (load-bearing, PA must act):** `E-ROUTE-003`/`E-ROUTE-004` are **ALREADY TAKEN + ENFORCED (S179)** — the wire-**serializability** gate (`type-system.ts:3791`), NOT a protect-column gate. So **§14.8.7's own cite "return-boundary / E-ROUTE-003 follow-on" (`SPEC.md:8030`) is a STALE MIS-REFERENCE** — the confidentiality gate needs a NEW code (`E-PROTECT-004` + floor lint `I-PROTECT-STRIP-001` proposed). Upside: the gate is the confidentiality SIBLING of that existing boundary gate → the A-layer rides existing infra (lower build cost).
**Open questions:** 5 (OQ-1 descriptor lifetime through codegen + raw-egress `_{}`/`asIs`/`handle()` gating · OQ-2 `reveal` surface/grain · OQ-3 dynamic-SQL fail-closed policy + `W-SQL-ROW-UNTYPED` interaction · OQ-4 is the A-layer worth building now · OQ-5 code naming + §14.8.7 wording). Staged design-insight CANDIDATE in artifact. **PA action requested (5)** in the artifact footer. RUN-not-RATIFY honored.

---

## [dpa-018] deep-dive — soft-nav and the lifecycle model: does an `<outlet>` swap mount/destroy anything?

`status: complete` · banked S313-bryan (2026-08-02) · **bryan RULED "DD it"** (verbatim, S313) after Peter routed the adopter finding. · **COMPLETE dPA 2026-08-02 (ADVISORY)** → artifact written, staged insight CANDIDATE, NOT ratified. 3-pole LIVE poll (real, no synthesis degradation) fired from a flogence-rooted boot — typed roster live, no persona injection needed (the dpa-017 caveat did NOT recur).
gaps: `g-onmount-request-no-refire-on-soft-nav` (MED; adopter aM S67 witness) · sibling `g-static-markup-no-hydrate-in-if-conditional-spa-drillin` (MED; verify-on-latest first, NOT part of this DD)

### Scope-lock (COMPLETE framing)

**Question:** When an SPA soft navigation (§20.8) swaps route content into the `<outlet>`, **what — if anything — mounts and destroys?** Concretely: do `on mount` bodies, bare expressions, `<request>`, `<timer>`/`<poll>` and `cleanup()` in the *incoming* route fire, and do the *outgoing* route's tear down? Where does the answer land — **(A)** the swap IS a scope transition, **(B)** the swap is NOT a lifecycle event, or **(C)** navigation is a THIRD, separately-named lifecycle distinct from mount/destroy?

**This is not an ambiguity in one rule — it is a HOLE in the model, and the two governing sentences CONTRADICT each other.** Verbatim, both normative, both current:

- **§6.7.2** (Scope as Lifecycle Boundary): *"The `<program>` root element ... is a permanent scope. It mounts once (on page load) and destroys once (on page unload **or navigation**)."*
- **§20.8.1** (The persistent shell and `<outlet>`): *"A `<program>` is the **persistent application shell** ... It **boots once and stays live across soft navigations**. Splitting an app into `pages/` SHALL NOT drop the shell."*

§6.7.2 says navigation destroys the program scope; §20.8.1 says it survives. §6.7.2 predates soft-nav, where there is no unload at all. **And its scope TAXONOMY has exactly two kinds** — the `<program>` root, and elements conditionally rendered via `if=` (*"Every element in the scrml program tree that is conditionally rendered (via `if=`) creates a lifecycle scope"*). **An `<outlet>` swap is neither.** So the model does not currently describe the thing the router does.

**Load-bearing scrml CONSTRAINTS (verbatim — do NOT re-derive):**
- **§6.7.2 defines what a remount MEANS, but anchors it to `if=`:** *"A scope that remounts (i.e., `if=` transitions false → true a second time) SHALL re-run all bare expressions and re-start all `<timer>` and `<poll>` instances declared in that [scope]."* If (A) wins, this sentence generalises; if (B) wins, it must be explicitly fenced to `if=`.
- **§6.7.2 teardown is a 4-step ordered contract** (`when` effects unregistered → `<timer>`/`<poll>` stopped → `cleanup()` LIFO → pending `animationFrame()` cancelled), **depth-first, children before parents.** Any (A)-shaped answer inherits this whole contract for route scopes.
- **§6.7.1a + §17.3:** `on mount { body }` is *"explicit syntactic sugar for the bare-expression-at-mount pattern documented in §17.3"*, and a bare expression *"executes at initial render"*. **S313 amended §6.7.1a** to make "bare expression" the §7.3 LIFECYCLE category, not an arity limit — so whatever this DD rules about mount timing binds `on mount`, bare `${}` expressions, and `<request>` **identically**. They are one mechanism.
- **§20.8 is PARTIALLY IMPLEMENTED, not Nominal** — the runtime soft-nav engine, `<outlet>` recognition, the one-landmark invariant, `<a>`-boost, View Transitions and cross-chunk loading have all LANDED and are verified by execution. `keep-alive` (§20.8.4) is still Nominal: *"the attribute is recognized and validated, but there is NO runtime cache and no §52/§38 invalidation wiring"*. **A `keep-alive` cache and a remount rule interact** — an answer must not foreclose §20.8.4.
- **V1 is ONE FLAT OUTLET** (*"Nested layouts (multiple / nested outlets, Remix-style) are v1.next"*). Do not design for nested outlets, but do not pick an answer that makes them impossible.
- **The adopter witness (aM S67 deploy, real):** a mount `<request>` driving `paintTabs()` silently no-op'd on soft-nav into the view; compile clean, no diagnostic. Worked around app-side with a reactive class binding. **Today's behaviour is (B) by accident, not by ruling** — nothing in the implementation was decided; it is what fell out.
- **scrml pillars that bear directly:** "the compiler owns the wiring" and "every reachable state has UI, every transition is intentional, every effect runs at the right moment" (§1/§2 pillar 6). A lifecycle that fires on `if=` but silently not on navigation is exactly the "effect does not run at the right moment" shape — **but** re-firing every mount effect on every nav is the double-fetch footgun the React ecosystem is known for. Both poles have a pillar behind them.

**In scope:** the lifecycle contract for an outlet swap; whether route content is a first-class SCOPE KIND; how `cleanup()` / `<timer>` / `<poll>` / `<request>` behave across a swap; the §6.7.2-vs-§20.8.1 contradiction (which sentence is amended, and how); whether a named navigation hook is needed and what it is called; the interaction with `keep-alive` (§20.8.4).

**Out of scope:** the `keep-alive` cache implementation + §52/§38 invalidation (its own arc); nested/multiple outlets (v1.next); the sibling hydration gap `g-static-markup-no-hydrate-in-if-conditional-spa-drillin` (needs a verify-on-latest against the S289 `if=` Phase-2 DOM-removal change BEFORE it is even confirmed live). **Do NOT seed (C) as the compromise landing** — let the judge decide whether a third lifecycle kind is warranted or is just the fork wearing a hat.

**Approaches (poles):**
- **A — the swap IS a scope transition.** Route content is a lifecycle scope; the outgoing route destroys (full §6.7.2 4-step teardown), the incoming mounts (bare expressions re-run, `<request>` restarts). Amend §20.8.1's "stays live" to scope it to the SHELL, not the route. Cost: a scope identity for route content; the double-fetch footgun; `keep-alive` becomes "suppress the destroy". → `nextjs-rsc-app-router-expert` (route-segment lifecycle + layout persistence is the direct real-world analogue).
- **B — the swap is NOT a lifecycle event.** The shell is permanent and route content is re-rendered markup; mount effects fire once per document load. Amend §6.7.2 to strike "or navigation" and fence remount to `if=`. Consequence: the adopter's finding is working-as-intended and adopters need an explicit navigation hook — which must then be specified, or the gap simply moves. → `qwik-resumability-expert` (what legitimately survives vs re-executes; resumability is the strongest statement of "do not re-run what you do not have to").
- **C — navigation is a THIRD lifecycle, separately named.** Neither mount nor destroy; a distinct route-enter/route-leave contract, so §6.7.2 and §20.8 both stay true without bending. Cost: a third concept in a language whose pillar is *fewer* primitives (limit-primitives-not-godify). → `solid-js-signals-expert` (ownership/disposal — who owns an effect and when is it disposed is exactly the question underneath all three poles).

**⚑ LATE ADDITION (bryan, S313, after the run started — may have missed this dPA pass; if so it is a
second round, and it is worth one) — POLE D: an `<app>` wrapper.**

> *"would an `<app></app>` wrapper solve anything? either as an outer shell or a distiction"*

**The structural case, and it is stronger than the other three:** the contradiction exists because
`<program>` is carrying at least five jobs at once — persistent application shell (§20.8.1),
compilation/execution unit, routing root (§40.8), nestable shared-nothing execution boundary (§4.12.1
-§4.12.8), and lifecycle scope root (§6.7.2). Jobs 1 and 5 are the two in direct conflict: one says
"stays live across soft navigations", the other says "destroys on navigation". **`<app>` splits them:**
`<app>` = the persistent shell (job 1), `<program>` = the route-scoped unit that mounts and destroys
(job 5). Both existing normative sentences then become TRUE AS WRITTEN — no amendment needed to either.

**And it dissolves the taxonomy hole rather than patching it.** Poles A/B/C all have to invent or deny
a lifecycle event for the `<outlet>` swap, because §6.7.2's taxonomy has only two scope kinds
(`<program>` root · `if=`-conditional) and the swap is neither. Under D the swap simply **mounts a
`<program>`** — a scope kind that already exists — so §6.7.2's existing remount sentence (*"A scope that
remounts SHALL re-run all bare expressions and re-start all `<timer>` and `<poll>` instances"*) ANSWERS
the adopter's question by inheritance instead of by new rule. That is the scrml-shaped resolution:
*provability falls out of the language's natural shape, not separate ceremony* (§2 pillar 6).

**It is a SPLIT, not a new god-primitive** — the limit-primitives-not-godify axiom argues FOR it, not
against: `<program>` is the overloaded primitive and sharpening it is the move the axiom prescribes.

**Costs / open questions the DD must weigh, honestly:**
- **Migration.** Every existing app uses `<program>` as the shell. MITIGATABLE to zero: a top-level
  `<program>` with `<page>` children or a `pages/` dir already IS the app shell, so the compiler can
  SYNTHESIZE the `<app>` wrapper and make it opt-in for explicitness. The DD should test that claim, not
  assume it.
- **A third nesting level.** §4.12.7 already bounds `<program>` nesting depth; `<app>` sits above it.
  Verify no collision with §4.12.1 shared-nothing or §43 nested-execution semantics.
- **Engine singletons (§51.0.A).** If a route `<program>` now destroys, engines declared inside one are
  destroyed with it — probably correct and desirable, and `<app>` finally gives app-lifetime engines a
  principled home. But it IS a semantics change for any engine currently declared at what is today the
  shell, and that must be measured, not asserted.
- **Naming.** `<app>` vs reusing `<program>` at the outer level with a distinguishing attribute. The
  keyword-collision principle (§65.9) applies; `<app>` is currently UNUSED — 0 corpus occurrences, not an
  HTML element (verified S313).

→ Assign to whichever expert best argues structural decomposition; `solid-js-signals-expert` (ownership
and disposal — who owns an effect, when is it disposed) is the natural fit, and `nextjs-rsc-app-router-expert`
holds the direct real-world analogue in the layout-vs-page split, which is exactly this shape shipped.

**Experts (ALL THREE ALREADY EXIST in the roster — no forge needed):** `nextjs-rsc-app-router-expert` · `qwik-resumability-expert` · `solid-js-signals-expert`. Pipeline: `debate-curator` + `debate-judge` (global).
⚠ **Boot rooted in `flogence/`** so the typed roster is live — dpa-017 was fired from a scrml-rooted session and had to inject verbatim personas into `general-purpose` agents instead.

**Deliverable:** a scorecard + a design-insight CANDIDATE (advisory, awaiting PA+user ratification) → `scrml-support/docs/debates/`. Feeds a §6.7.2 **and** §20.8.1 amendment the PA ratifies (both sentences move — one of them is currently false), plus the disposition of `g-onmount-request-no-refire-on-soft-nav`. **Freeze-relevant:** this is a lifecycle CONTRACT going into language-1.0, and §62.2 makes the conformance corpus the contract — whatever is ruled owes conformance cases pinning it in both halves.

### Verdict (dPA, 2026-08-02 — ADVISORY, NOT ratified)

**`scrml-support/docs/debates/soft-nav-outlet-lifecycle-model-2026-08-02.md`** · **POLE C wins** (weighted 77.75/95 · A 62.75 · B 51.75). The `<outlet>` swap boundary is a **route region — NOT a scope**: a lifecycle owner identified by the committed **`(route, params)`** pair, with edges **route-leave** / **route-enter**. Route-content `on mount` / bare `${}` / `<request>` fire on **every route-enter incl. the first**; route-content `<timer>`/`<poll>` stop and `cleanup()` runs LIFO on route-leave. **B loses on behavior entirely; A loses on taxonomy** (§6.7.2's memoryless-remount SHALL binds *scopes only* — which is what lets `keep-alive` exist without carving an exception). **Named composition, not a split:** behavior = C(=A) · taxonomy = C · **grafted from A** = step-2b in-flight `<request>` abort during leave + enter-fires-after-SSR-re-seed-and-`each`-re-materialisation (C had both right but underspecified) · **grafted from B** = the closure clause *"lifecycle edges SHALL be produced by exactly three events and no others"* (the best single sentence any pole wrote) + the diagnostic obligation **with polarity inverted** → `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` as a **v1 obligation, not nice-to-have** (the ruling knowingly ships a footgun and owes the diagnostic). **REJECTED:** the "A's behavior + B's `on navigate`" compromise — under the ruling route-content `on mount` already means "on arrival", so `on navigate` is a second spelling bought for no witness (the S174 LIMIT-PRIMITIVES failure).

**§20.8.1 needs NO replacement** — verified literally true under the ruling; it needs an *addition* only (an author reading "persistent application shell" cannot otherwise learn route content is excluded). **§6.7.2's "or navigation" is struck** — all three poles agreed it is false.

**★ NEW GAP surfaced by the dPA's own source-read, live at HEAD, independent of this ruling — `g-route-timer-poll-not-stopped-on-soft-nav` (HIGH, PA to file):** `_scrml_teardown_region` drains ONLY `_scrml_region_cleanups` (display-effect disposers); `_scrml_destroy_scope` (§6.7.2 steps 2–4) is reachable ONLY via `_scrml_unmount_scope` (the `if=` path) and `_scrml_nav_apply_html` never calls it — so a route-content `<timer>`/`<poll>` starts at chunk module-init and **fires against detached DOM for the rest of the session**; author `cleanup()` in route content never fires. **Fix splits: (i) stop timers/polls + abort in-flight region `<request>`s + cancel `animationFrame` = SHIP NOW, all three poles prescribe it, ZERO ratification dependency; (ii) fire author `cleanup()` LIFO at that moment = couple to the ruling.**

`g-onmount-request-no-refire-on-soft-nav` → **SPEC** (the spec contradicted *itself*; the adopter did nothing wrong). Bump MED→HIGH once §20.8.3 is ratified.

**10 conformance cases** (CN-1..CN-9 blocking · **CN-10 Nominal must be authored NOW** — deferring it is the mechanism by which this ruling silently becomes Pole A). Artifact §8.1 lists which pole-proposed cases become *wrong* under the ruling. **OQ-3 is the only open question that can invert the ruling, and the error is ASYMMETRIC:** ruling C then cutting `keep-alive` leaves a harmless extra noun; ruling A then shipping `keep-alive` requires breaking a normative SHALL you just wrote. 3 experts live-polled + judge. Routes to scrml PA. RUN-not-RATIFY honored.

### ROUND 2 (dPA, 2026-08-04 — ADVISORY, NOT ratified) — Pole D (`<app>` wrapper)

`status: complete` (round 2) · **trigger: bryan's own conditional bank** — *"may have missed this dPA pass; if so it is a second round, and it is worth one."* **Condition VERIFIED, not assumed:** the round-1 artifact contains **0 occurrences** of "Pole D" or `<app>` (artifact written 08:58; the late addition appended to this queue at 09:59). Fired from a flogence-rooted boot; typed roster live, no persona injection.

**`scrml-support/docs/debates/soft-nav-outlet-lifecycle-pole-d-round2-2026-08-04.md`** · **POLE D REJECTED on mechanism** (weighted **C 8.78 / D 1.73**). Landed Pole C stands **unmodified**. D's headline claim — *"a split, not a new primitive; both sentences true with NO amendment, by inheritance"* — is **false on four verified normative collisions**: (1) ★ **§51.0.D** engine-singleton identity (*"the SAME singleton across all use-sites in all importing files"*) becomes false by construction when route content is a `<program>` — **and this holds even with a completely empty shell**, which is exactly what the corpus has; (2) **§40.8 cardinality-1** (*"exactly ONCE, in the entry file"*) is **repealed**, not generalized; (3) **`E-PROG-003`** makes parent-scope reads a hard **Error**, so D's cell-ownership story is not merely unwritten but *actively contradicted*; (4) ★ **§40.8 `<channel>` app-scope** — channels are *"app-scope shared-state vehicles, not per-route declarations"*, so a per-route `<program>` makes every channel per-route. **Collisions (1) and (4) were found by the dPA's own source-read, not by any expert — including the decisive one.**

**Structural finding:** **§43.2 enumerates exactly FOUR** nested-`<program>` shapes (Web Worker · Foreign Sidecar · WASM Module · Server Endpoint) — **all cross-execution-context boundaries, none a same-tree UI region.** So there is no existing kind to inherit from at all; every behavior D needs must be authored from scratch under an old keyword. The **inheritance audit** independently found **4 of 5 §20.8.8 clauses are NOT free under D**. `<app>` ruled **"mostly costume"**: `<program>` sheds job 1 and only job 1.

**Both stated flip-conditions CLOSED by dPA verification:** no permeable nesting mode exists or is planned (§43.3 is flatly shared-nothing; **zero** hits for any isolation variant) · the corpus question resolves against D for a *subtle* reason — **both multi-file apps declare ZERO shell cells** (0% exercised), which naively *meets* the condition, but the real collision is §51.0.D (corpus-independent) and §20.8.8 clause 5 has already committed the spec to the pattern.

**WHAT SURVIVES OF D = the NAME only** (not the mechanism): (a) **recommended** — a defined term ("shell region") naming the shell side of `<program>` in §6.7.2.1; prose only, **zero migration cost**; (b) **optional** — `<app>` as a **validated non-scope-forming marker** (forms no scope, no isolation boundary, explicitly not a `<program>`, not subject to §43). Keyword verified free: **0 corpus occurrences**, not an HTML element.

**★ SEPARABLE finding, independent of D — §20.8.8/§6.7.2 pin a TOTAL order** (no "MAY reorder" language) when only ~2 of ~15 orderable pairs have a stated correctness reason. Over-specification taxing every implementer + 1–2 conformance cases. **Not a Pole-D question — file as its own spec-hygiene ticket** (OQ-3).

**⚠ TWO FRAMING FLAGS FOR THE PA:** (i) **the CURRENT STATUS table above never lists dpa-018 and reads as if C were still advisory — it is RATIFIED AND LANDED** (§20.8.8 *"NEW S313 — ratified Pole C"* · §20.8.1 amended · §6.7.2's "or navigation" struck · §6.7.2.1 added · §20.8.7 already carries an S314 correction). Round 2 was therefore framed as *"does D justify UN-LANDING ratified spec?"*, with sunk cost explicitly disallowed as an argument for C. (ii) **bryan both ratified C and proposed D in the same session (S313) and the ordering is not recoverable** — if D came after the ratification it may have been a v1.next thought rather than a challenge. The dPA ran it either way (pre-authorized), but that call is the user's.

**6 OQs** — **OQ-1 and OQ-2 can narrowly invert.** OQ-1: the corpus is **too young** to test the ambient-read collision, and **the dPA flags its own panel's 3–0 unanimity as insufficient adversarial pressure** — a stronger pro-D case would have argued *deferral*, not defeat. OQ-2: the **strongest form of D was never argued** (`<app>` as the literal subject of §20.8.8's ownership clause with zero `<program>` nesting) — cheap to check; the dPA declines to guess project design. Staged insight CANDIDATE in artifact §10 (*"auditing a split-don't-amend claim requires walking EVERY already-enforced invariant on the reused keyword"*); `design-insights.md` NOT touched. 3 experts live-polled + judge. Routes to scrml PA. **RUN-not-RATIFY honored — NOT flipped to ratified.**

---

## [dpa-019] debate — Ask #7 `get_style_provenance`: what IDENTITY survives a value-only source rewrite AND round-trips across compiles?

`status: complete` · **COMPLETE dPA 2026-08-04 (ADVISORY)** → debate artifact written, staged insight CANDIDATEs, **NOT ratified**. **6-voice LIVE poll** (4 advocacy poles + cost-realism + premise-adjudicator) + judge; no synthesis degradation.
**output-path:** `scrml-support/docs/debates/ask7-sid-identity-A-vs-B-vs-C-vs-D-2026-08-04.md`
**Scores:** **D 40.5 · C 40.0 · B 34.0 · A 31.0** — **the origin ruling's invented Pole A finished LAST.**
**Verdict:** the debate resolved by **falsifying the premise all four poles were ranking mechanisms against**, not as a pole contest. Recommendation = a **two-mechanism split owned at two LAYERS**: **D** (per-compile re-resolve via the landed `E-STYLE-CONFLICT` totality guarantee) for the apply-back path, **≈1 module**; **C** (opt-in author anchor) **only if** the Fork-2 shared primitive is actually built, **≈1.25–1.5 modules**. **A explicitly NOT recommended. B held in reserve** (at element granularity B *is* A plus a hash, ≈3.5–4.5; at block granularity ≈0 — already shipped as `scrml semdiff`). Sidecar = **per-compile**; facets = **TWO, layer-owned not primitive-shared**.
**★ THE PREMISE IS UNVERIFIABLE, NOT MERELY UNVERIFIED — and the nearest real code contradicts it.** The value-only apply-back **DOES NOT EXIST**: floStyle's "apply" is a runtime **CSSOM patch** (`floStyle-proto.html:546/550`) that never opens a file, its `PROV` map is **hardcoded** (`:481`), and the tab labelled `source patch · Ask #7` returns a **display string** (`:704`) — a mock diff. `derive-provenance.mjs` is read-only regex over **compiled CSS**, zero spans. **The ONLY real source rewriter is flogence `scripts/groundedit.ts`, and it is STRUCTURAL** (`move into`/`move before|after`/`remove`, `:32-36`) — **which no path address survives** (move/remove renumber siblings). flogence's own `groundedit.ts:14-16` already says oracle #7 is *"FILED, NOT DELIVERED"*; `hand-off.md:105` lists it under *"Awaiting scrml (no clock)."*
**★ THE LAUNDERING TRACE (the methodological finding):** DD writes *"a pure `source.slice(valueSpan)`-replace"* as an **INTENTION** under a `NO build here` header → a PA memory records it **IN THE PAST TENSE as MECHANISM** → the S316 ruling consumes it as **A FACT ABOUT AN IMPLEMENTATION** and picks a pole on it. **Three hops, no hop read code.** (The flogence memory in that chain was corrected by the dPA this run.) Also: **"value-only" is a v1 SCOPING DECISION WITH A SCHEDULED EXPIRY** — DD Fork 3 already plans per-instance override = a structural edit.
**★ TWO "PA-VERIFIED" GROUNDING FACTS ARE WRONG — RETRACT:** (i) **fact #4 is FALSE** — `compiler/src/codegen/srcmap-provenance.ts` **EXISTS (186 LOC)**, imported at `build-source-map.ts:43`, and the byte→line/col bridge exists as a tested `LineIndex` (`codegen/source-map.ts:101-128`); full Source Map v3 emit is built (391+246+186 LOC). **The S316 BRIEF's contrary claim rests on a non-recursive grep and currently sits in a RATIFIED BRIEF as normative guidance.** (ii) **fact #1 is understated in the risky direction** — `counter.next` appears **210× across TWO files** (`ast-builder.js:206` **+ `component-expander.ts:4`**); ids are minted **mid-pipeline** during component expansion and codegen synthesizes fresh nodes at emit → **`BaseNode.id` is not even a pure document-order counter.** (`data-scrml-sid` = **0 occurrences** — that one confirmed.)
**★ TWO FINDINGS THAT REFRAME:** (i) **scrml ALREADY ships cross-compile correlation** — `semdiff.ts:387 matchEntities` is fingerprint-first (B) + name-fallback (C); but `fingerprintEntity:355` puts **values INSIDE the hash**, so on this consumer's exact edit Pass A fails **by construction** and only the NAME fallback rescues it — **elements have no names → Pole B at element granularity has NO fallback**, and semdiff's fingerprint **cannot be reused** (opposite soundness polarity, its §0(2)). (ii) **Fork 1 / Fork 2 are in TENSION and Fork 2 resolves to C, not A** — the attested second consumer already has its anchor and **it is a NAME, not a path**: `block-analysis.ts:24` `"id": "<relpath>::<name>"`, consumed live by `semdiff.ts:79`. **Also: two of the three existing element stamps are ALREADY Pole C** (`data-scrml="<ComponentName>"` · `data-scrml-key=`); the one that isn't is the emission-order counter Fork 1 rejected.
**★ THE DISQUALIFIER (why A loses before cost is considered) — FAILURE SHAPE:** A fails **OPEN** — a byte offset is *always* dereferenceable, so after an unrelated upstream edit `src.slice(…)` returns *a string*, plausibly another value in the same block. **It cannot fail-fast; you write a color into a padding.** B fails as ambiguity, C as disclosed absence, D cannot fail by construction. **A is the only pole that can hand back a confidently wrong byte range — and it is the pole the origin ruling selected, on a premise about code that does not exist.**
**Spec-vs-impl gaps flagged (pole-independent):** `Span.line`/`col` are **declared non-optional** (`types/ast.ts:28-31`) but `srcmap-provenance.ts:39-42` documents many spans leave them at **0** — Ask #7's headline is *"what source line declared it"*, so a sidecar reading `span.line` emits `0` for an unknown fraction, **silently**; mitigation is one line but **must be normative** · **two element-open emitters** (`emit-html.ts:2882`, `emit-ssr-render.ts:279`) — stamp one and SSR `<each>` rows are **silently unstamped**.
**5 OQs the panel could NOT settle** — `<each>`-instance ambiguity (uncosted by every voice) · **whether the cross-compile audit-trail requirement is REAL** (no voice produced evidence any consumer needs it; it is the sole condition under which B is justified) · **⚠ whether C is viable at Ask #7's ACTUAL granularity** (every in-repo C precedent is element/component/block; the ask targets individual CSS declarations, where per-declaration anchors would be near-zero coverage — **the judge flags this as its own inference, untested by any voice; sharpest un-tested risk in the recommendation**) · whether D's free key survives the two-emitter split · whether Fork 2's "one shared primitive" framing should be retired outright.
**Panel-composition caveat (disclosed):** the forge-list's requested source-map/codemod voice was **not in the live roster at dispatch**; it went live mid-session, **was then dispatched, and produced the single highest-impact contribution** (Verdict-Shifting 10.0). **Had the batch run without it, this deliberation would have ranked four mechanisms against a false premise and very likely CONFIRMED Pole A.** Two further staged voices (`unison-expert`, `babel-plugin-architecture-expert`) were **not** polled. · banked **S319-bryan (2026-08-04)** · **origin: the S316 deliberation queue Q1** (`scrml-support/docs/deep-dives/S316-DELIBERATION-QUEUE.md`), banked here because the S316 queue is **NOT in the dPA's drain path** — it sat unrun while the dPA drained the dpa-018 Pole-D conditional instead. **Rung: R3 (debate).** The S316 PA rung-assigned this itself as *"the weakest thing I did this session."*

### Why this is R3 and not a ruling

The S316 PA ruled the relayed fork's **three options all wrong** and substituted a fourth of its own design. The **destructive half is measurement and stands** (see Grounding). The **constructive half — "a structural path address, with the byte span as payload" — is a phrase written once, never designed, never costed, never checked against a second consumer.** It is being sent to debate, not to build.

### Scope-lock (COMPLETE framing)

**Question:** For an adopter tool that reads a scrml compile artifact, rewrites source VALUES, and re-compiles — **what node identity is stable enough to survive its own apply-back AND to be correlated across two separate compiles, at an emit cost worth paying?**

**Grounding facts — PA-VERIFIED at S319, do NOT re-derive:**
- ~~`BaseNode.id` is `++counter.next` (`compiler/src/ast-builder.js`, ~40 sites)~~ **CORRECTED S319 (dPA-caught, PA-re-verified):** `counter.next` occurs **210× across TWO files** — `ast-builder.js` (206) **+ `component-expander.ts` (4)** — so ids are minted **mid-pipeline during component expansion**, and codegen synthesizes fresh nodes at emit. **`BaseNode.id` is not even a pure document-order counter.** `compiler/src/types/ast.ts:205-206` still documents it verbatim as *"Unique numeric ID **within the compilation unit**"* — compile-local by construction, which is the half that stands and the half the destructive ruling rested on.
- `Span.start` is a byte offset into the source. A value-only rewrite that changes a literal's LENGTH shifts every subsequent span. Compile-local under the consumer's own workload.
- **A structural-address abstraction DOES NOT EXIST in `compiler/src` today.** S319 ran the search the S316 queue admits it never ran (`structural.?path|nodePath|pathTo|addressOf|stableId|nodeAddress|treePath` across `compiler/src`): the only hits are `emit-ssr-render.ts:127 pathToRead` (a state-cell read-path string), `route-inference.ts filePathToUrlPattern` (filesystem→URL), and one comment. **Nothing addresses an AST node.** So EVERY pole here is net-new machinery, and the DD must cost it as such.
- ~~**`compiler/src/srcmap-provenance.ts` DOES NOT EXIST**~~ — **★ RETRACTED S319. THE FILE EXISTS.** `compiler/src/codegen/srcmap-provenance.ts`, **186 LOC**, imported at `codegen/build-source-map.ts:43` and `codegen/emit-expr.ts:47`; full Source Map v3 emit is built alongside it, and the byte→line/col bridge exists as a tested `LineIndex` (`codegen/source-map.ts:101-128`). **PA-re-verified at S319 by `find`, after the dPA caught it.**
  **How it got in here, because the mechanism matters more than the fact:** the claim originated in the S316 deliberation queue, I carried it into this bank, and I stamped it **"PA-VERIFIED at S319"** — it was not. My probe searched `compiler/src` for an *address-abstraction* vocabulary and never searched for the filename itself; the S316 claim named a path one directory up from the real file. **This is the exact miss S316 recorded about itself one session earlier** (*"Repeated an inherited false claim… Verify-before-claim applies to a predecessor's state claims too"*), and the "PA-VERIFIED" stamp made an inherited assertion look independently checked. **The adopter's "not a new pass" estimate is therefore NOT optimistic on this axis — the seam they named is real.**

**Poles:**
- **A — structural path address** (the S316 PA's invented option; span as payload). Must answer: what IS the path? Document-order indices break under sibling insertion; a named-anchor scheme needs names that do not exist in the grammar.
- **B — content hash of the subtree.** Stable under position change, unstable under the very value edits the consumer performs. Does hashing a *shape-only* projection (values elided) recover it?
- **C — a stable author-assigned anchor.** Explicit, cheap to resolve, but adds author-visible surface for a tooling concern — weigh against limit-primitives.
- **D — ★ NO stable identity is possible, and the consumer's loop must re-resolve each compile.** **The S316 PA never seriously considered this and flagged it as possibly correct.** It makes the sidecar a per-compile artifact the consumer re-reads — cheaper than every other pole, and it matches how `token-set.json` already behaves. **Do NOT let the panel treat D as the null option; it is a real pole with a shipped in-repo precedent.**

**In scope:** the identity question; the emit cost of each pole; whether the sidecar is per-compile or cross-compile; the second-consumer question folded in from S316 Q4 (one shared address primitive vs two facets — the limit-primitives axiom cuts BOTH ways and the S316 ruling picked one direction on a two-consumer count taken from the adopter's own note).

**Out of scope:** the `get_style_provenance` surface syntax; the dev-only gate (S316 Fork 3 — settled by the verified `<program mcp>` precedent); non-promotion (S316 Fork 4 — already answered by dpa-010's *"dock is NAVIGATION, never the GATE"*).

**⚠ A PREMISE THE DD MUST CHECK, NOT INHERIT:** the S316 ruling asserts a structural path survives the consumer's apply-back *because apply-back is value-only* — **and states plainly that it never read their apply-back implementation.** That is a premise about someone else's code held on their description of it. Verify it or mark the whole pole conditional.

### Expert / forge list
A language-server / incremental-compilation voice (stable node identity across edits is the LSP's core problem — document versions + position mapping) · a source-map / codemod voice (jscodeshift / Babel: what survives a print-parse round-trip) · a content-addressing voice (reuse the §47 / §58 Merkle framing already in-repo).

### What-counts-as-an-answer
A recommended pole with its **emit cost stated in modules-to-build** (given that nothing exists today), an explicit verdict on whether the sidecar is per-compile or cross-compile, and a stated answer on the one-vs-two-facet question. NOT a spec draft.

### Report-back
§3 — one-liner + artifact path + staged insight CANDIDATE + a `(dpa:)` breadcrumb. Do NOT ratify. Artifact → `scrml-support/docs/debates/`. Routes to scrml PA.

---

## [dpa-020] deep-dive — is position-invariant auto-await implementable at ONE choke point, or is the position set irreducibly heterogeneous?

`status: complete` · **COMPLETE dPA 2026-08-04 (ADVISORY)** → DD written, staged insight CANDIDATEs, **NOT ratified**. **Method note honored — emit sites READ + probe fixtures COMPILED**, emitted JS quoted.
**output-path:** `scrml-support/docs/deep-dives/autoawait-choke-point-vs-heterogeneous-2026-08-04.md`
**Verdict: (c) PARTIAL — but the partition is 2, not 7, and the split is NOT "positions."** The *"one bug fixed one position at a time"* diagnosis is **substantially TRUE**; the origin PA named the wrong **UNIT**. The unit is **which CALLEE CLASS the shared expression emitter has an `await` branch for** — there are exactly two, and the second has **zero** branches. **6 of 7 share one decision point; 1 of 7 (really 4 sites in 3 files) needs that branch PLUS an async host whose shape #391 already proved. There is NO irreducible heterogeneity.**
**★ THE COMPETING EXPLANATION IS EMPIRICALLY FALSIFIED.** Compiled probes show that for **5 of 7** the enclosing function is **ALREADY emitted `async`** — `await` is already legal at those emit sites today; **nothing is missing but the `await`.**
**★ ROOT CAUSE (one sentence):** `emit-expr.ts` `emitCall` has **four sibling auto-await branches** (`:3037-3071` · `:3073-3089` · `:3092-3113` · `:3155-3180`) and **NO `mode === "client" && ctx.serverFnNames` branch** — the field exists (`:460`) and is threaded by callers but **no consumer reads it in client mode**. Why: the client's server-fn call is renamed to `_scrml_fetch_X_N` by a **whole-buffer regex post-pass** (`emit-client.ts:2922-2969`) **AFTER every emitter has run**, so at emit time the compiler cannot see it is emitting a server call. The `await` is therefore retrofitted by **FIVE independent post-hoc injectors** (`scheduling.ts:377,510,613` · `emit-client.ts:3076-3149` · `emit-event-wiring.ts:380`) — **none of them the emitter that produced the call. That is the machine that manufactures one gap per position.**
**★ ARCHAEOLOGY — #391 and #394 did the SAME repair TWICE**, on two orthogonal axes. The ONLY difference is the root cause: #391's callee lived in `clientAsyncFnNames` so **threading sufficed**; #394's callee was a client-mode server fn so there was **nothing to thread into** and it **built a FOURTH string injector**. **Axis B (host coloring) is ALREADY a single position-invariant choke point** (`emit-library-shared.ts:100-118,147+`) — #394 extended its coverage, did not add a mechanism. **Only axis A is scattered.**
**★ POPULATION CORRECTION — the register carries 10 open `*-await*` gaps, not 7.** Omitted: `g-inferred-async-call-value-position-no-autoawait` (**HIGH**) · `g-server-fn-argument-position-not-awaited-and-statement-dropped` (**HIGH**) · `g-module-scope-server-call-no-autoawait` (MED, ruling-gated). **Any scoping must include them.**
**★ LOCUS CORRECTIONS:** #2 recorded locus **stale by ~540 lines** (real bail `emit-client.ts:3145`) · #6 **mis-attributed** — it is `emit-logic.ts:4245-4280 emitIfExprDecl`, NOT `emitIfValueExpr` (same R26-class error #394 corrected for the match arm) · #1 is **THREE files / FOUR sites**, not one locus · #3 has **TWO seams**. **#5's "PA to re-confirm valid `given` syntax" precondition is DISCHARGED** — valid, compiles clean, reproduced.
**★ FOUR MARKUP FINDINGS THE BRIEF DOES NOT HAVE:** (i) the `<each>` body is **CONFIRMED BARE**, not "unresolved" — the brief's re-probe missed the mount by reading an outer cell. (ii) **the `<each>` emission is SPACED** (`fetchStatus ( … )`) → **any text/regex injector MISSES it** (the S310 spaced-escape-hatch lesson recurring) → **the choke point MUST be AST-based.** (iii) **a FOURTH bare site the register does not know about** — the `<match>` arm interpolation is emitted **twice**, the second as an unconditional module-init statement that **fires a real server fetch at boot for an arm that may never be selected, and discards it** (an over-fire defect, distinct from the await gap — **worth its own filing**). (iv) `emitValueAttrApply` already has a runtime thenable rescue (`:373-378`) that **does not help** because `.status` is read off the Promise before the test → **the whole-value form is SAFE; only the member-tail form is broken** (narrows the real blast radius).
**★ RECOMMENDATION — BUILD in 3 sequenced units, and DO NOT DISPATCH THE STAGED BRIEF AS WRITTEN.** `docs/changes/markup-autoawait-all-emitters/BRIEF.md` targets **Group B only** and mandates the #391 threading pattern — **threading `clientAsyncFnNames` will NOT fix the server-fn case at all**, because the branch it feeds does not exist for client server fns. As written it buys the 4 markup sites for *cross-module async imports* and **leaves every server-fn shape bare in the same four emitters. REVISE BEFORE DISPATCH** — this is precisely what dpa-020 was banked to gate. **U1** = add the missing `emitCall` branch + thread `serverFnNames` into the ~25 client ctx literals lacking it + retire/guard the 5 injectors → closes **5 of 7**, ~2-3 focused days. **U2** = uniform #391 IIFE at the 4 markup sites + flip `emit-control-flow.ts:2227` to the server form already on that line → closes **2 of 7**, ~1-2 days. **U3** (optional, ~2h) = make `awaitNestedPromises` the default; route `given-guard` + the structured match arm through `emitLogicBody`; delete the **now-false** comment at `emit-control-flow.ts:378-379`.
**★ DOMINANT RISK — a stranded `await` is a WHOLE-BUNDLE SyntaxError.** `peerAwaitable` **defaults to awaitable** and is set only by `emitLambda` (`:3441-3442`) → **every sync host must set `peerAwaitable: false` BEFORE U1 lands**, or the failure is catastrophic and global. **Gate: `node --check` on every emitted bundle, per position.** **Do NOT build a sixth string injector** — and `injectServerCallAwaitsViaAst` (`:510`) is a **strictly-worse duplicate** of `parenthesizeAwaitServerCallsInExpr` (`:613`); merge them.
**⚠ OVER-FIRE INTERACTION (flagged, per scope-lock):** **do NOT touch `combinatorIsAsyncName` (`emit-expr.ts:1622-1628`) in U1** — it is the shared predicate feeding both the async-combinator lowering and the fail-closed drain, so widening it is a **§8 newly-rejecting change under freeze**; file it separately behind the S279 Case-2 R2 question. Also: **`peerAwaitable === false` becomes load-bearing at far more sites and the client path has NO `syncCallSink` — decide that BEFORE the branch lands, not after.**
**Cost of NOT building:** the generator stays intact — 10 open members, **~3 added per PR**, every one **silent** (exit 0, no diagnostic, `.field` off a Promise reads `undefined`). **One is already a live downstream failure: flogence GH #228, root-caused S297.** · banked **S319-bryan (2026-08-04)** · **origin: the S316 deliberation queue Q2**, same non-drain reason as dpa-019. **Rung: R2 (DD).** **This gates whether the staged `markup-autoawait-all-emitters` brief is framed correctly — do not fire that brief before this lands.**

### Scope-lock (COMPLETE framing)

**Question:** The auto-await gap family reads as *"one bug being fixed one position at a time."* **Is that diagnosis true?** Can a single decision point decide await-insertion for every position, or do the positions each require a structurally different async context, making the one-at-a-time drain correct-but-unfinished?

**The governing sentence — PA-VERIFIED verbatim at S319, SPEC §13.2 Normative statements:**
> *"The compiler SHALL insert `await` at **every call site** where a server-generated fetch call is made."*
> *"The compiler SHALL wrap **any function containing at least one server call** in an `async` function in generated code."*

Both are position-INVARIANT on their face. Every open entry below is an instance of the compiler not meeting them at some specific position.

**The population — ⚠ THIS LIST IS SHORT BY THREE; the dPA's correction below is authoritative.** It reads **10** open `*-await*` gaps, not 7 — omitted here were `g-inferred-async-call-value-position-no-autoawait` (**HIGH**), `g-server-fn-argument-position-not-awaited-and-statement-dropped` (**HIGH**), and `g-module-scope-server-call-no-autoawait` (MED). **Cause, verified S319: my enumeration was truncated by a `head -20` that long prose lines consumed** — both HIGHs predate this bank on `main` (`663f31b8` and `54ce3c4f`), so this is a probe defect, not a concurrency artifact. **A truncated enumeration reads identically to a complete one** — the same shape as a hollow gate, and the reason the ledger's own overlay warns to *match on the heading, not on marker adjacency*. Original (incomplete) list retained below for the audit trail:
- `g-markup-autoawait-misses-attr-and-each-body` — **HIGH**, open (`locus=compiler/src/codegen/emit-event-wiring.ts`)
- `g-reactive-write-member-server-call-no-autoawait` — MED, open
- `g-match-value-position-server-call-no-autoawait` — MED, open
- `g-match-block-arm-server-call-no-autoawait` — MED, open
- `g-given-block-server-call-no-autoawait` — MED, open
- `g-if-value-cascade-server-call-no-autoawait` — MED, open
- `g-ternary-init-server-call-await-misbind` — LOW, open
- adjacent, in-progress, DIFFERENT direction (over-fire not under-fire): `g-async-stdlib-in-sync-callback-over-fires` — HIGH
- **recently RESOLVED, and the most informative evidence in the set:** `g-match-arm-server-call-no-autoawait` (#394) · `g-crossmodule-async-in-markup` (#391) · `g-onmount-direct-reactive-server-write-unawaited-on-escape-hatch-string-path`

**The load-bearing signal, and why it is not just a backlog:** #391 fixed one position and its review pass found TWO more; #394 fixed one and filed FIVE more. **Six new positions from two PRs.** Discovery rate is not slowing.

**The competing explanation the DD MUST test (the S316 PA never did):** the positions may be genuinely heterogeneous — a markup attribute setter, a sync effect callback, a statement tilde-temp and a match arm may each need a *different* async context by construction. **If so there is no choke point to build**, the drain is correct, and the only defect is the framing.

**In scope:** read the actual emit sites for the enumerated positions; determine what async context each needs; determine whether #391 and #394 had to do structurally DIFFERENT things or the same thing twice; a build/don't-build recommendation with cost.

**Out of scope:** building anything. The over-fire sibling (`g-async-stdlib-in-sync-callback-over-fires`) has its own S279 ruling and is a separate direction.

**⚑ Method note:** this is the shape where an architectural diagnosis was inferred from a **gap-list shape** rather than from source. The DD's first move is to READ THE EMIT SITES. A verdict reached without doing that is worth nothing here.

### PA execution seed (S320-peter, 2026-08-04 — VERIFY, do not trust)
Two emit sites captured by compilation on main `206359fe` (repro: one `<page>` with `server function getFlag() -> {ok:bool}`, a plain client fn and a `given`-body client fn each `const _ = getFlag().ok`, live via `onclick=`; the DD should re-run/extend, not lean on this). **These are the choke-point's two failure MODES side by side, which is why they belong in this DD and not in a point-fix:**
- **Plain fn body** (`_scrml_plain_N`): emits `const p = await _scrml_fetch_getFlag().ok;` — await IS injected but **mis-parenthesized** (`await (f().ok)` reads `.ok` off the pending Promise → `undefined`). This is `g-hash87-member-read-await-misparen`, and it is on the *"working"* baseline. → the injector RUNS here but with the wrong paren shape for member-read receivers.
- **`given`-body fn** (`_scrml_check_N`): emits `const r = _scrml_fetch_getFlag().ok;` — **no await at all**. The enclosing fn IS `async`; the statement scheduler fences at `given-guard` via `isControlFlowBoundary` (`scheduling.ts:974`) → the injector never reaches the body. This is `g-given-block`.
- **Seam observation for the DD to test (not a conclusion):** `injectServerCallAwaitsViaAst` (`scheduling.ts:510`) already walks the full emitted-JS AST and descends generically into `if`/block bodies, models JS scopes exactly, and is position-invariant — but it (a) BARE-prefixes `await ` (so it would reproduce the misparen for `.member` receivers, cf. `parenthesizeAwaitServerCallsInExpr` at :613 which wraps correctly) and (b) is currently wired only to `on mount` escape-hatch bodies via `liftEmittedStatementAwaits`. Whether unifying on ONE parser-modelled injector (descend + paren-correct + run over all client fn bodies) IS the choke point, and what it costs / breaks (dense S138/S139/S212 batching + GH #264 rounds), is precisely the build/don't-build question — the DD must decide it, with a corpus sweep.

### What-counts-as-an-answer
Either (a) *"yes, one choke point — here is the decision point, here is what it costs, here is which of the 7 open entries it closes,"* or (b) *"no, irreducibly heterogeneous — here are the N distinct async contexts and why,"* in which case the `markup-autoawait-all-emitters` brief keeps its enumerate-the-class scope but LOSES its shared-fix framing. A partial answer ("k of 7 share a choke point") is a legitimate and likely outcome — say so with the partition.

### Report-back
§3 — one-liner + artifact path + staged insight CANDIDATE + a `(dpa:)` breadcrumb. Do NOT ratify. Artifact → `scrml-support/docs/deep-dives/`. Routes to scrml PA.

---

## [dpa-021] deep-dive (NARROW) — GH #357 direction B: can ONE `session` binding serve both the member and the index form?

`status: complete` · **COMPLETE dPA 2026-08-04 (ADVISORY)** → DD written, staged insight CANDIDATEs, **NOT ratified**. Verified BY EXECUTION, not `node --check`.
**output-path:** `scrml-support/docs/deep-dives/gh357-session-binding-accessor-shape-2026-08-04.md`
**Verdict:** **B survives — direction intact, stated form does not.** One *raw* prologue binding CANNOT serve both forms; one *Proxy* binding can; and **B needs FOUR parts, not one.**
**★ The hazard is worse than `semantics-changed` — it is a CONFIDENTIALITY BREAK.** Proven by execution: with a request-controlled index key, a naive binding returns `k=sid` → the live session id and `k=_rec` → the full record **including `csrfToken`**, at HTTP 200, no throw, no diagnostic — a session-id + CSRF-token disclosure primitive defeating the §40.2 defense the compiler owns. Root cause `emit-server.ts:2449` — `get(key){return this._rec[key] ?? null}` reads an **inner** object, so `.get(k)` and raw `sess[k]` read different levels. The canonical three (`userId`/`role`/`isAuth`) DO agree — **which is exactly why a naive bind looks correct on a demo fixture.**
**★ BLOCKER absent from the brief (Part 1):** `_anySessionBuiltin` (`emit-server.ts:2003`→`:492`) matches only AST `member`/`index` nodes, but a `?{}` carries its query as a **string** → an interpolation-only `session` use is structurally invisible. Proven: such a fixture compiles **0 errors**, emits **ZERO** session infra, leaves the handler unwrapped. **A prologue binding gated on today's detection would never be emitted and #357 would remain OPEN.** Fix precedent in the same file: `astSqlQueryUsesCurrentUser` (`:469-490`).
**★ Part 4 — KEEP the AST lowering.** Three gates match the literal string `_scrml_req._scrml_sess.` (E-SESSION-CONTEXT scan `:5649-5673` · cookie-wrap decision `:3974-3975` · `serve=tool` guard `emit-tool.ts:491`). Retiring it for a bare binding **silently blinds all three — a security regression.** The two mechanisms provably agree on **12 of 15** keys; residual = non-call refs to `.get`/`.set`/`.destroy`.
**Brief corrections:** the hazard is **BOTH** forms (`session.<customKey>` breaks identically, `emit-expr.ts:2280`), not just `session[expr]` · corpus re-measured **7 files / 2 real uses**, not "exactly ONE" (ZERO inside a `?{}` — that part holds) · **queue path correction: `compiler/src/codegen/rewrite.ts`, not `compiler/src/rewrite.ts`** (line numbers land exactly).
**⚠ ROUTED TO PA — adjacent live defect, OUT OF SCOPE, needs its own ruling + severity call:** **`@session` is unlowered.** `rewriteServerAtRef` (`rewrite.ts:2833`) special-cases only `currentUser`, so `@session.userId` emits `_scrml_body["session"].userId` — **a client-supplied request-body field read as identity and written to the `sid` column** (trust-boundary inversion) — in a **GREEN conformance case** (`server-fn-ambient-identity-clean`), green only because it asserts `E-REACTIVE-003` absence and never checks the artifact. Corroborates scrml commit `0fecca8e`. **Direction B does NOT fix this.** · banked **S319-bryan (2026-08-04)** · **origin: the S316 deliberation queue Q3**, same non-drain reason. **Rung: R2 narrow.** **Gates the staged `gh357-session-sql-interpolation` brief.**

### Scope-lock (COMPLETE framing)

**Question:** bryan RULED **direction B** at S316 — bind `session` in the server handler prologue the way `route` already is. The reasoning holds and the ruling is not being reopened. **The open question is whether B is implementable without a silent regression**, and it was pushed into the dispatch brief as *"the agent's problem." That is the decision, not a detail.**

**The hazard, stated by the S316 PA in its own words:** `session[expr]` currently lowers to `_scrml_sess.get(expr)`. A naive prologue binding flattens that to a raw property read — **a `semantics-changed` silent regression** (pa-base §8's most dangerous class: same source, different behavior, no diagnostic delta).

**Grounding — PA-VERIFIED at S316, carried forward:**
- GH #357 was **re-reproduced BY EXECUTION** on `09d17541`: `ReferenceError: session is not defined` from the real emitted handler.
- **The recorded locus was WRONG** — the gap said `rewriteSqlRefs` *"walks expression nodes but not the interpolation children"*; there are **no expression children at that layer.** Real path: `rewrite.ts:387` captures `?{}` interpolations as raw TEXT; the server rewrite is `rewriteServerAtRef` (`:2831`), a regex over **`@name` only**; `session` is **sigil-less** and structurally invisible to it.
- **Blast radius measured: `session` is the SOLE affected ambient.** `route` is also sigil-less but is genuinely BOUND in the prologue — which is precisely why B is the shape being copied.
- ⚠️ **`node --check` PASSES on the broken artifact** (a free variable is legal JS). Any verification of this fix that stops at a static check is worthless — it must EXECUTE.

**In scope:** whether one prologue binding can serve `session.member` AND `session[expr]` without changing what the index form means; if not, what the minimal shape is that preserves both (a bound object with a `get`-equivalent? a two-form lowering?); and whether B survives if it cannot.

**Out of scope:** re-litigating A-vs-B (ruled). The broader ambient-binding question for other sigil-less names (there are none affected — measured).

### What-counts-as-an-answer
A yes/no on the one-binding question with the lowering sketched, OR a named alternative shape that keeps B's direction. Must state how the answer will be VERIFIED BY EXECUTION, not by `node --check`. Small — this is a narrow DD, not a debate.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Do NOT ratify. Artifact → `scrml-support/docs/deep-dives/`. Routes to scrml PA.

---

## [dpa-022] deep-dive — markup is a STATE KIND that renders, not a VALUE TYPE that state can hold. What follows?

`status: banked` · **BANKED S322-bryan (2026-08-05)**
**Rung:** R2 minimum — axiom-level (it changes what markup fundamentally IS). One at a time; the FLOOR forbids resolving this inside a batch.
**Provenance:** `ruling:user-voice-scrml.md S322` — bryan, verbatim:

> *"markup in scrml, is just a pre-defined subset of 'state' that happens to have 'display' properties. But the point of the state system is to manage state start to finish and back."*

He adds that he has tried to land this **since the scrml8 era** (before this session count began) and that it has never landed on agents.

### ⚑ READ THIS BEFORE FRAMING THE QUESTION

**This is NOT "which of two readings is right."** Per the standing rule (`[[feedback_stated_intent_vs_corpus_migration]]`), user-voice normative intent verbatim beats the corpus, and a corpus contradiction is a **migration backlog, not an open question**. bryan's framing is the PREMISE. The open question is **what follows from it** and **what in the current design has to change.**

**Why it never landed is structural, not a comprehension failure.** The written canon teaches the opposite on page one: Pillar 1 / lock **L1** say *"markup is a first-class **VALUE** type — markup elements may sit anywhere expressions sit"*; SPEC **§1.4**'s five declarative doors (Component · bindable cell · derived cell · enum `renders` · iteration) are five answers to a **plumbing** question — *how does markup get somewhere it can be rendered.* Any agent reading the PRIMER absorbs markup-as-value before it reads anything else. **The DD should treat L1/§1.4/PRIMER §2 as the artifacts to be reconciled, not as authority.**

You MAY conclude that parts of the current design survive for reasons the value-framing obscured — that is a real finding, not a failure. What you may NOT do is re-open whether markup is state.

### PA-VERIFIED grounding (S322 — by execution; do not re-derive, DO re-verify before building on any of it)

**1. The compiler states the value-framing in its own diagnostic.** `<thing> = <span>hi</>` is REJECTED:

> `E-CELL-RENDER-SPEC-NOT-BINDABLE`: *"Shape 2 requires bindable markup (input, textarea, select), **because the cell holds the element's VALUE**."*

The model is *"a markup cell is a cell bound to some element's value."* It asks what value a `<span>` holds, finds none, refuses. Under the state reading the question is malformed — the cell's state IS the span; there is no element whose value is held.

**2. Measured against "start to finish and back":**

| | markup today | probe |
|---|---|---|
| start | YES — `const <badge> = <span/>` | compiles |
| **finish** | **NO — markup state cannot be written** | `<thing> = <span>hi</>` → `E-CELL-RENDER-SPEC-NOT-BINDABLE` |
| and back | `reset()` compiles on a markup cell — **but it also compiles on ANY derived cell**, so it is unvalidated and proves nothing markup-specific | `reset(@dbl)` on a plain derived cell also compiles |

Markup gets a START and nothing else. It is plumbed, not managed.

**3. Unverified anomaly, flagged not claimed:** `reset(@badge)` on a markup cell emitted `_scrml_reset(_scrml_cs_key(n)…` — possibly resetting the WRONG cell. Not chased. Probe before relying on any reset behaviour.

### The three concrete forks

1. **The writable-markup-cell rejection.** S279 ruled a writable markup cell "a redundant sixth door." Redundant *as a door* is coherent if markup is a routed value. Is it coherent if markup is state? If markup is state, a writable markup cell is not a door at all — it is just a cell, and rejecting it rejects the ability to manage markup state to *finish*.
2. **The five declarative doors (§1.4).** Are these five *state entry points* (in which case the framing is fine and only the words are wrong), or five *plumbing routes* that exist because markup was modelled as a value needing transport? Answer with the mechanism, not the prose.
3. **Lifecycle and `reset()` on markup.** If markup is state, what does `(A to B)` mean for it, what does `reset()` mean, what is `default=`? §14.12 already permits a lifecycle annotation on a markup-typed position (`<badge>: (not to markup) = not` compiles) — but nothing appears to *use* it. Is that reach real or accidental?

### The through-line (why this is banked beside dpa-023)

Two axes independently got value-shaped treatment when both are state-shaped: an **async result** is `(not to T)` — state with a lifecycle — and we built ~9,276 injected awaits across ~13,500 synthetic hosts to route it; **markup** is state with display properties, and we built five doors to route it. **One habit, twice.** The DD should say whether that reading holds, because if it does it upgrades Pillar 5b from a heuristic to a **diagnostic**: *when you are building plumbing — injectors, doors, per-position special cases — you are probably plumbing a value that should have been state.*

### What-counts-as-an-answer

A statement of what markup-as-state **entails**, with worked adopter code, on each of the three forks — plus an explicit list of which current normative artifacts (L1 · §1.4 · §6.2 Shapes 1-3 · `E-CELL-RENDER-SPEC-NOT-BINDABLE` · PRIMER §2/§4) are re-wordings and which are **behaviour changes**. Behaviour changes must be classified per `pa-base` §8 (inert / newly-rejecting / newly-accepting / semantics-changed) and any newly-accepting one flagged as a one-way door. Do NOT ratify.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`. Routes to scrml PA.

---

## [dpa-023] deep-dive — the async boundary as a STATE lifecycle: does `(not to T)` + discrimination-as-transition subsume the auto-await machinery, and where does a suspension MARKER fit?

`status: banked` · **BANKED S322-bryan (2026-08-05)**
**Rung:** R2 minimum — axiom-level (it changes what a scrml function IS). Sibling of dpa-022; run SEPARATELY, not batched.
**Provenance:** `ruling:user-voice-scrml.md S322` — bryan endorsed the read (*"you nailed it"*), and named the load-bearing half as the **discrimination-as-transition** reading, not the keyword.

### Scope-lock

bryan's diagnosis of `async`/`await`, verbatim and precise — three distinct complaints:

> *"async/await breaks your code retroactively, so it not only comes with the mental overhead of async coding, it also forces you to fix backword, plus you are permanently forced to explicitely color down that whole logical branch."*

**The PA's framing, which he endorsed:** `async`/`await` fuses two unrelated facts — **"time passes here"** (statement-level, local) and **"this function is async"** (signature-level contract every caller must satisfy). **All the virality and all the retroactive breakage come from the second.** scrml's current answer discards BOTH, which does not remove the leak — it makes it silent:

```scrml
function refresh() {
    @rows  = loadUsers()      // suspension happens here — INVISIBLE
    @count = @rows.length     // reads the OLD @rows. compiles clean. no diagnostic.
}
```

**The half bryan is actually pointing at** is that an in-flight value is already expressible in scrml's own vocabulary — `(not to T)` (§14.12), where **discrimination IS the transition** (§14.12.6 presence-progression: `given`, `if (x is not)`, `match` all auto-mark), and `E-TYPE-001` already fires on a pre-transition read. That is *exactly* the stale-read bug, caught by machinery that shipped at S130.

```scrml
<rows>: (not to User[]) = loadUsers()
given @rows :> { @count = @rows.length }    // discrimination IS the transition
```

### The question

**Does the §14.12 lifecycle + discrimination model subsume the auto-await machinery** — or is it a complement, and if so what is the seam? Sub-questions:

1. Does it cover the positions the injectors cover (statement, receiver-tail, argument, `given`/`match` bodies, markup interpolation), or does it only cover the *binding* position?
2. Is a **suspension marker** (`wait`-shaped: marks "time passes here", does NOT color the function, never breaks a caller) still wanted on top — and is it a *surface* over the lifecycle or an independent mechanism? Note the language already has a ladder idiom for compiler-suggested sharper forms (`I-MATCH-PROMOTABLE`, `W-EACH-PROMOTABLE`), so a diagnostic that *suggests* the marker is precedented.
3. What happens to the §13.2 position-invariance mandate under this reading — does it survive, narrow, or get replaced?

### PA-VERIFIED grounding (S322 — measured, do not re-derive)

- **13,504 IIFEs** in the emitted corpus (4,129 of 4,339 bundles). **ZERO in 1,878 `.scrml` sources.** Purely a lowering artifact, from 12 codegen emitters.
- **96% of them are SYNC** (13,006 sync vs 496 async), while the compiler must inject **9,276 `await`s** — each legal only inside an async host.
- **1,350 event-handler hosts, ALL sync** (`function(event)`, zero async). A server fn called from `onclick=` lands there; the current gate provably cannot fire in any of them.
- **142 bare client server-fn call sites** persist in cleanly-compiling sources after the U1 landing (delta 0). The harness now emits this number, so any future change has a before/after.
- **The structural root (dpa-020, carried):** three disagreeing "is this name async in client mode?" predicates. F2 fixed two; the drain stays blind.
- **The seam that is currently arbitrated by a string matcher:** `emit-client.ts`'s GITI-001 absorb decides whether `.catch(_scrml_error_boundary_log)` is attached — i.e. **§19.6 error containment is enforced by a regex over emitted text.**

### ⚑ Interaction with a LIVE ruling — do not contradict it silently

bryan RULED **option C** at S322 for the absorb sequencing fork: *await the IIFE **and** keep its `.catch`* (§13.2 vs §19.6). **NOT YET BUILT.** If this DD concludes the lifecycle model changes what C should be, say so explicitly and route it back as a re-ruling — do not quietly reinterpret it. Open sub-question bryan did NOT rule: whether the boundary swallowing the error should also suppress the continuation, or let the handler proceed on a stale cell.

### What-counts-as-an-answer

A verdict on subsume-vs-complement with worked adopter code for **each** of the positions in (1), plus a direct answer on the marker in (2) including what its diagnostic would say and when it fires. Must state how any proposal avoids re-introducing (a) retroactive breakage and (b) branch coloring — those are the two properties the whole design exists to avoid. Do NOT ratify.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`. Routes to scrml PA.
