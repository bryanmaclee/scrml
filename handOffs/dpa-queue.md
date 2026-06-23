# dPA queue — banked deliberation requests

**The dPA drains this on a batch run** (`read dpa.md and boot`, rooted in `flogence/`). The PA writes
items here while warm; the dPA reads them, runs each, flips `status: banked → complete` with the
artifact path + a one-line conclusion, and drops a `(dpa: …)` breadcrumb in `delta-log.md`. The dPA
**NEVER** flips an item to `ratified` — that is the PA's act (RUN-not-RATIFY, `dpa-scrml.md` §3).

Item format + drain protocol: `scrml-support/dpa-scrml.md` + the design DD
`scrml-support/docs/deep-dives/dpa-deliberation-satellite-2026-06-18.md` (§6 worked example).

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
- **Library-mode codegen seam** — flogence (B) library-mode `?{}` db-injection (§44.7.1 W5a/W5b — confirm status) + giti F3 (`g-safecall-bang-handler-not-lowered-in-library-mode`). These are a DEV work-item (a codegen gap to fix + a status read), not a design deliberation. If the §44.7.1 status read surfaces a design fork, fold it into dpa-003. Otherwise → PA/dev pipeline.

---

## PA ratification + in-Q candidates (S215, user "Ok, lets go. tread softly, DD anything even at all in Q")

**dpa-004 → RATIFIED** (above — SCOPED-RETIRE C1–C4, insight landed). **dpa-002 / dpa-003 / dpa-005 → DIRECTION-RATIFIED** (dPA verdicts accepted as direction; BUILDS downstream — tread-softly, fire as ready):
- **dpa-002** → ship **B** (recipe over `handle()` §39.3 + SSE author-path; net-new = wire `route=` author-path for `server function*` in app mode; drop the csrf strawman). Small dev item.
- **dpa-003** → **Approach B** (logic-ctx `_{}` + ts/js value-flow mirroring `?{}` + explicit named-pass capture). GATED on: §23.2.4 amendment (C2) + library-db (dpa-007) for the STANDALONE form (the in-app form needs only the amendment + codegen).
- **dpa-005** → adopt **B** `<engine server=@source>` + A as its no-`rule=` view. ⭐ sole blocker = **§52 server-cell codegen = flux G1** (one fix unblocks giti F1 + flux). Targeted E-RI-002 diagnostic ships WITH/AFTER the §52 fix. High-value dev convergence, NOT a DD.

### In-Q DD candidates (banked, NOT fired — user fires as needed)

## [dpa-006] CANDIDATE — Build-story × `_{}` foreign-code interaction
status: candidate     # banked S215; user fires as needed
why-in-Q: a `_{}` foreign slice + its `lang=` toolchain (§23.5) is a NEW input to `compile(source, buildStory)` (§58) — the content-addressed Merkle closure (§58.3/§58.5) must capture the foreign toolchain (bundler version) or the artifact is not reproducible from `build-story.lock` (the §58.12 determinism gap). Likely = §58.10 dialect-islands (per-program codegen customization via `lang=`) + the `<program story=>` attribute. BOTH §58 (Nominal) + `_{}` codegen are unbuilt → design them together BEFORE either ships. **YES — this touches the `<program story=>` thread.**
scope-when-fired: does a `_{}`/`lang=` slice enter the closure as a §58.5 node kind? · `lang=` × `story=` × dialect-islands §58.10 · toolchain pinning for determinism (§58.12).

## [dpa-007] CANDIDATE — Library-mode `?{}` db-injection design (§44.7.1 W5a/W5b)
status: candidate     # banked S215
why-in-Q: gates flogence (B) + the standalone `dispatch.scrml`. dpa-003 VERIFIED §44.7.1 NOT landed (`generateLibraryJs` E-CG-006 rejects server-only nodes; standalone `--mode library` `?{}` → E-CODEGEN-INVALID-JS). Half-staged; the flogence msg flags a fork (emit targets `Bun.SQL`, not the harness's `bun:sqlite`). Clusters with giti F3 (`g-safecall-bang-handler-not-lowered-in-library-mode`) on the library-mode codegen seam.
scope-when-fired: `Bun.SQL` vs `bun:sqlite` injection · connection-injection contract for a standalone compiled program · may resolve to pure-dev once scoped (not necessarily a DD).

## [dpa-008] CANDIDATE — `_{}` capability-gating (untrusted / multi-tenant)
status: candidate     # banked S215
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
status: candidate     # banked S215 (user design-conv)
why-in-Q: "Inline all the way" makes language support HARDER than the sidecar form (sidecar = uniform `build=`+IPC, language-agnostic). The inline value-flow needs the foreign value to cross into scrml's **Bun/JS runtime** — a per-language MARSHALING bridge, NOT just "run the compiler." **ts/js is FREE** (same runtime — the `_{}` slice IS JS spliced into the emit, value crosses natively → why it's dpa-003's first cut). Every NON-JS language needs its own bridge, and the bridge (not the compile) is the cost. Honest ranking for INLINE-over-Bun: **ts/js (native) ≫ clean-C-ABI langs (Odin/Zig/Rust via `bun:ffi` dlopen — typed signature IS the contract) > Go (native but runtime+GC; `-buildmode=c-shared`/cgo awkward — far better for the SIDECAR-service shape) ≫ Python (interpreted; CPython C-API or subprocess; heavy boundary).** User's instinct (Go>Python) correct; refinement: **Odin likely beats Go for INLINE** (no runtime, clean C-ABI), Go wins for sidecar — they serve different shapes.
scope-when-fired: which non-JS langs get inline support + the per-language marshaling architecture (`bun:ffi` for C-ABI langs? subprocess+serialize for others?) · whether sidecar (§23 today) is the language-agnostic answer for non-C-ABI langs (Go service) and inline is reserved for ts/js + C-ABI-FFI langs · the `lang=` toolchain resolution §23.5.
