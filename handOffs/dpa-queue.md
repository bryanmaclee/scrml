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
| dpa-022 | **COMPLETE (ADVISORY) dPA 2026-08-05 — awaiting PA/bryan ratification.** ⚑ *This row read "BANKED — UNRUN" until S325 corrected it; the DD had run 24h earlier.* 5-pole live poll; all S322 grounding re-verified BY EXECUTION. **The premise never failed to land — it landed in the COMPILER and in name resolution and never propagated to §1.4/L1/PRIMER, so the reframe is a RECONCILIATION (inert, prose-only), NOT an amendment.** Writable markup cell: rejection SURVIVES (4/5 poles: a writable markup cell holds a *rendered instance* with an ownership/disposal boundary, not state). ONE real mechanism gap: the lifecycle read detector is a dot-requiring regex, a no-op on markup 100% of the time. **Do NOT ratify the shared through-line on this DD's evidence** (the mismodelling was in the CANON, not the mechanism). → `scrml-support/docs/deep-dives/markup-as-state-kind-not-value-type-2026-08-05.md` | S322 block · "bank it" → **RATIFIED S352 2026-08-19 (bryan)** — *"Ratify; migrate canon incrementally"*: the reframe is a **RECONCILIATION, not an amendment** (zero code change — the premise landed in the compiler and name resolution and never propagated to §1.4/L1/PRIMER); the **writable-markup-cell rejection SURVIVES** on its own reasoning (a rendered instance with an ownership/disposal boundary is not state); the lifecycle-detector gap is **FILED**. Canon migration binds **NEW-OR-TOUCHED**, not a sweep — `markup-as-value` is a PILLAR and Lock L1 with 37 SPEC mentions + 6 SPEC-INDEX cross-refs; a 37-site rewrite nobody reviews properly is worse than a stale sentence corrected on contact (same binding as Rule 4b / `locus=` / `prov=`). **NOT ratified, per the DD's own instruction: the shared through-line.** ⚑ **PA-VERIFIED LIVE at ratification** (the premise was flagged stale and is not): same lifecycle annotation, `@u.passwordHash` fires `E-TYPE-001` while a bare `@status` read **compiles clean at exit 0** — a pre-transition read silently accepted, and a **Rule 7** instance. See user-voice S352. |
| dpa-023 | **DIRECTION RATIFIED S337 (build deferred, ruled (b)) · ⚑ FIRST WITNESSED CASE FILED S338 (bryan: "i, and file it as dpa-023's first witnessed case").** **The witnessed case:** `function doHash(p){ return hashPassword(p) }` + `const <h> = doHash(@pw)` compiles clean (exit 0, no diagnostic) and emits `_scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(...))` where the fetch is `async` — and the runtime is synchronous BY DESIGN (`_scrml_derived_get`: `_scrml_derived_cache[name] = fn()`, no await, §6.6.4). **A derived cell whose recompute returns a PROMISE**, rendered into the DOM. PA-verified on main at both emit and runtime-path level. §6.6.19 refuses the DIRECT reach and misses it ONE HOP AWAY. **This is the `(not to T)` async-boundary shape with a real adopter-facing symptom** — the by-construction form (a type-state making the async boundary unrepresentable in a synchronous position) versus the retrofit now shipping (position-by-position refusal, which is the S322 under-design signature). The S338 refusal fix is explicitly REVERSIBLE and PROVISIONAL so it does not foreclose this rung. **Prior state:**  ⚑ *This row read "BANKED — UNRUN" until S325 corrected it; the DD had run 24h earlier and its re-ruling request had ALREADY been acted on (option C retired S322).* 5-pole live poll, verified by execution (7 fixtures + 3 emitted programs RUN). **COMPLEMENT, not subsume — the frame is RIGHT and the implementation is missing its middle state.** A `(not to T)` cell has THREE states (`not → pending → T`); the compiler models TWO and the assignment illegally jumps 1→3. Mechanism: `classifyWriteAgainstSpec` is a SOURCE-TEXT comparison that never consults the type, with no third state to return (`type-system.ts:25865`, duplicated `:26799`) — **the whole bug is two lines.** ⚠ Its re-ruling request RETIRED option C (S322). **The `pending` rung is the live open item** (5/5 convergence; conditions: the marker is sugar, drop the "does not color the function" pitch as measured-false, and the rule must be `E-` not `I-`). ⚠ PA-verified FALSE: the DD's §19.6-containment-by-string-rewrite mechanism claim. → `scrml-support/docs/deep-dives/async-boundary-as-state-lifecycle-2026-08-05.md` | S322 block · "bank it" |
| dpa-024 | **COMPLETE (ADVISORY) dPA 2026-08-10 — Q4 ACTED ON, rest awaiting bryan.** ⚑ *Sat BANKED-UNRUN from S331 to S337 because the PA filed its Q4 under "OWED BY BRYAN" — a question only the DD could answer — while bryan waited on the agreed "say when it's ready" signal. No boot probe reads this file; that is the real reason it was invisible.* **Q4's banked premise was FACTUALLY WRONG and the DD caught it:** self-host-v2 is NOT chartered as a parity target — parity framing was DROPPED S222 (`compiler-reimagining-derisk-2026-06-26/RULING.md:11`, PA-verified verbatim), replaced by D3 conformance-as-oracle S230, and firewalled. **Do not change the charter.** **The real risk is one layer down:** `self-host-v2/progress.md` carries **53** `byte-identical`/`impl#1` mentions as success conditions — the sanctioned tier-2 scaffold became the de-facto definition of done, and nothing said when it stops. Activates the day the parser wave opens (lexer 337/337 done; parser NOT started), because impl#1's `FileAST` carries the **127 in-place decoration fields** skeleton-RULING:13 forbids. **RULED + LANDED S337** (bryan: *"go, take the tier-2 retirement rule"*) → `docs/changes/tier-2-scaffold-retirement-2026-08-10/RULING.md`: 3 clauses (scaffold never an exit criterion · AST-parity FORBIDDEN as an oracle from the parser wave · divergence = freedom exercised not debt owed) + **conformance fork 2 RESOLVED** to the mixed-pipeline bootstrap (FORK RULE rows 1-4 unanimous). No code, no charter change, no rework. **Rival hypothesis SURVIVES, restated:** a canonical AST EXISTS (`types/ast.ts`, day one) but is NOT load-bearing — 16 modules shadow it as `Record<string,unknown>`, which is what lets 127 `_`-prefixed decoration fields typecheck; 24% of open gaps but **39-42% of open HIGHs** (~1.7x severity enrichment); passes the detection-window falsifier (spans S297-S331, static + grep-visible). Subsumes the S331 refuted hypothesis's surviving claim. **Q5 null: MET for impl#1** (off the V1 critical path, terminal, ~76% of gaps outside the class → keep patching; no impl#1 re-architecture proposed), **NOT met for impl#2**. **⚑ THE CORRECTIVE, against the intuition that opened the question:** the never-ending bug loop is mostly NOT architectural — conformance pins ~18 of ~60 surfaces, so ~42 are unpinned and each pass finds genuinely NEW defects. **The loop ends when the CONTRACT is complete, not when the architecture changes.** **R3 NOT recommended** (zero rival architectures survived; only one was ever on the table and it is ratified). → `scrml-support/docs/deep-dives/compiler-architecture-for-this-language-dpa-024-2026-08-10.md` | bryan S331 *"bank the deep-dive"* → **S337 FIRED + Q4 RULED**; §§1-3/Q5 advisory, awaiting ratify/reject → **RATIFIED S353-bryan** ("your rec on all three") — §§1-3 + the Q5 split adopted as written; **no R3** (zero rival architectures survived). The corrective is ratified with the finding: the bug loop is mostly NOT architectural — ~18 of ~60 surfaces are conformance-pinned, so the loop ends when the CONTRACT is complete. |
| dpa-025 | **RATIFIED S338 2026-08-11 (bryan: "a, and grep the compiler for source-text regexes") — option (a): ratify the finding, take the no-regret moves now, run the §6.1 blind fuzz BEFORE committing to A1. PA re-measured the headline before surfacing and it REPRODUCES (34 fields / 33 optional / 32 degenerate exact / ~70 sites) — unlike the S337 `127`. bryan added a SECOND instruction that reprioritises the measurement: **census the compiler for source-text regexes** — cheaper than the fuzz and it measures the PROBLEM not the fix. First result: **232 post-AST source-text gates across 49 files** (vs 182 legitimate pre-AST), and **232 is a FLOOR** — the probe keys on identifier names and cannot see `postRe.test(t)`, with 81 opaque-arg sites unclassifiable. Prior state:**  ⚑ **VERDICT: the answer is an OPTIONAL FIELD, not a missing primitive.** `emitExpr` is ALREADY one choke point; `EmitExprContext` = **33 fields / 32 OPTIONAL / 68 construction sites / 32 degenerate `{mode:"client"}` populating zero** — so a feature works only where someone remembered to thread it. That is the mechanism behind the field-list/parallel-walker class S337 hit four times: not an ABSENT capability, an OPTIONAL one. **★★ Live hazard found en route: `emit-logic.ts:1628` DEFAULTS A MISSING SERVER BOUNDARY TO CLIENT EMIT**, warned only under `SCRML_DEBUG` so silent by default — while `PIPELINE.md` 0.5.1 makes "client JS MUST NOT contain server-context constructs" an explicit CG output invariant (`E-CG-006`) and the source ships `SCRML_STRICT_BOUNDARY=1` **off**. Third fail-open-by-default in this area. **★ The ledger cannot measure itself and it corrupted this DD's own numbers** — 50 of 209 heading-extracted "open" rows are marked resolved in the body; 48 `status=open` entries are absent from a heading extraction entirely (the open gap `g-known-gaps-heading-and-marker-status-can-disagree-silently`). Gap counts quoted anywhere are SOFT until that is fixed. **A dPA pole proposed a retroactive §34 emitter gate that §34.0 had ALREADY declined** verbatim — caught as re-litigation. → `scrml-support/docs/deep-dives/population-first-missing-primitive-2026-08-10.md` | bryan S337 fired · **RUN-not-RATIFY, awaiting ratify/reject** |
| dpa-026 | **COMPLETE (ADVISORY) dPA 2026-08-15 — awaiting bryan.** ⚑ **The branch SPEC's "runtime-capture is NOT expressible by either form" is FALSE by execution** — `const c = @x; tare(@x, c)` in a handler = a runtime SNAPSHOT (compiled + RUN), and E-TARE-DEFERRED-POSITION's own message steers users to it. `reset` has ONE job (registries populate only at module-init). Calibration is expressible TODAY twice with zero syntax; the data pattern (`<zero>` cell + derived `net`) is canonical in every paradigm polled; corpus 0 calibration usages. **Panel 4/5 fork 1 · 1/5 fork 2 (`capture` verb) · 5/5 REJECT position-keyed semantics · 5/5 DEFECT: bare `tare` in a markup handler compiles clean in both forms** (one a runtime ReferenceError, one a live wrong-value promotion — the dpa-025 11-name-field-list class). Bridge = a checkable read-set diagnostic (WARN on `tare(@x,@x)`). **Reco: fork 1 patched — correct §6.8.4 BEFORE PR #501 merges.** → `scrml-support/docs/deep-dives/tare-thunk-vs-capture-dpa-026-2026-08-15.md` | **RATIFIED S347 2026-08-16** (bryan: *"your rec"*) — fork 1, `tare` keeps ONE verb; §6.8.4's runtime-capture sentence CORRECTED (false in both clauses, PA-verified by execution) before #501; bare-form defect fixed first. bryan S337 · *"bank c as its own question"* → **RUN 2026-08-15, awaiting ratify/reject** |
| dpa-027 | **COMPLETE (ADVISORY) dPA 2026-08-15 — R1 CONFIRMED, awaiting PA/bryan.** **No ruling behind `.Some/.None` — a REJECT:** drafted 2026-03-27 → **R-18-006 BLOCKING** (undefined magic names; enum collision) → removed → **REINSTATED the next day by the truncation-reconstruction `549e5b3`** from a changelog the re-review had flagged stale → mechanical passes → cited into §53.15 :33812 (S154) → one S19 fixture authored from it has failed E-MATCH-012 in every sweep. `not`/`given` have user voice; 0 compiler paths recognise `.Some`. **3/3 (a) STRIKE**, with corrections: striking leaves TWO vocabularies (`is some` + `given`), not one; the worst dangling citation is **E-MATCH-012's own message (prescribes deprecated `=>`)**. Type reason: `.Some` = constructor elimination over a TAGGED sum vs an idempotent UNTAGGED union — strictly coarser; would be scrml's only undeclarable, unshadowable constructor. → `scrml-support/docs/deep-dives/presence-match-arm-vocabulary-dpa-027-2026-08-15.md` | **RATIFIED S347 2026-08-16** (bryan: *"your rec"*) — STRIKE the §18.8.2 `.Some`/`.None` prose (its own worked example fails to compile, PA-verified), fix §53.15's dangling citation, fix `E-MATCH-012`'s message to `:>`. Archaeology NOT verified and not load-bearing. S346 bank → **RUN 2026-08-15**; PA lean (a) supported |
| dpa-028 | **COMPLETE (ADVISORY) dPA 2026-08-15 — awaiting bryan; return leg = #509 comment.** **The 07-05 skip was CRDT-class SYNC, ruled DEFER "for now"; the cold-boot SW/manifest piece appears NOWHERE in it → NEW question.** **⚑ Fork (a) is NOT AVAILABLE as written — no static/public asset dir** (both servers serve `dist/`; nothing copies user files; no `Service-Worker-Allowed`) → 5/5: the static floor is a PREREQUISITE under every fork. **The DATA half COMPILED GREEN in native scrml first try** and stays userland under every fork (0/4 build-graph owners ship a write-queue; BG Sync Chromium-only). **⚑ Emitter DEFECT:** `flush()` clears `@queue` before its fire-and-forget server calls resolve (dpa-020/023 class). **Panel 4–1**: (c) one-shot `scrml generate pwa` vs (a′) floor + recipe + readable `chunks.json`; ALL: worker CODE adopter-owned, precache DATA from `chunks.json` (already emitted), single-owner artifacts, no per-build rewrite of adopter files, **never an offline route RENDERER**; (b) 0/5 (Flutter + Qwik emitted then WITHDREW). No 6nz pattern. Adopter's ~150 lines NOT a throwaway under any ruling. → `scrml-support/docs/deep-dives/offline-pwa-native-vs-host-boundary-dpa-028-2026-08-15.md` | **RATIFIED S347 2026-08-16** (bryan: *"your rec, facts only on #509"*) — static-asset floor is a PREREQUISITE not a fork (PA-verified: no publicDir/staticDir anywhere, no `Service-Worker-Allowed`); ship (a′) recipe; DEFER the `generate pwa` scaffold with a named re-trigger; #509 return leg posted FACTS-ONLY. S346 bank → **RUN 2026-08-15**; bryan rules; return leg pending |
| dpa-029 | **COMPLETE (ADVISORY) dPA 2026-08-15 — ★★ carries a LIVE LEAK routed as a DEFECT ahead of the rulings; return leg = #471 comment.** `handle()` returning `new globalThis.Response(JSON.stringify(u))` on a `protect=` row **compiles CLEAN and ships `passwordHash` at HTTP 200** (RUN) while the server-fn route redacts: `Response` not allowlisted (**the SPEC's own §40.3.5 example fails E-SCOPE-001**) but `globalThis` is; E-PROTECT-004 is a per-body SOURCE-TEXT regex ("a lint mislabeled as a fail-closed gate"); the redactor passes any `instanceof Response` untouched (fail-OPEN); `.reveal(` is whole-body though field-level was RATIFIED S230 (dpa-017). **7/7 on sequence: DEFECT tickets FIRST** (deny-unless-revealed at the wrapper · `reveal("col")` · allowlist + member-chain walk · regex→lint · E-MW-003/004 unemitted · §40.3.4 vs emit). Direction after: Q1 4–2 typed `Egress<Bytes>` return — **framed as the dpa-002 raw-route REOPEN** (dissent: "no second envelope while the first is provably unsound"); Q3 5/7 `File`/multipart PARAM on the same contract — **the `handle()`+`request.formData()` path the S346 ack pointed to is RUNTIME-BROKEN** (no await inserted); Q4 (a) print the route (not one seam away); Q5 adapter — **§23.4 sidecar is Nominal**, ack's "vendor via .js sidecar" needs correcting. Adopter today (7/7): treat `handle()` as OUTSIDE the envelope. → `scrml-support/docs/deep-dives/document-workflows-egress-envelope-dpa-029-2026-08-15.md` | S346 bank → RUN 2026-08-15 → **Q1 RATIFIED S352 2026-08-19 (bryan)** — *"Fix first, re-surface after"*: rule the SEQUENCING, defer the shape. Land the raw-egress structural fix first (allowlist the Bun HTTP vocabulary so bare `new Response(...)` compiles per §40.3.5 · member-chain walk so `globalThis.Response` is covered · demote the co-occurrence source-text regex), THEN re-surface Q1 as a genuine (a)-vs-(b). The `Egress<Bytes>` mint is **DEFERRED, not rejected**. Ruling artifact: `scrml-support/docs/rulings-pending/dpa-029-Q1-egress-envelope.md` (prepared S349-peter; sat 3 days — the delivery instance S350 named). Q3 was previously withdrawn → dpa-030 (ruled S347). **STILL OWED, not closed by this ruling: the #471 return leg + the routed defects.** |
| dpa-030 | **COMPLETE (ADVISORY) dPA 2026-08-16 — awaiting bryan; return leg = #471 comment.** **Fork (a), narrowed: mint `File` as the 7th builtin primitive** (the S109 `date`/`timestamp` move, same reason), as a **capability HANDLE** (storage unforeclosed), routed through **§12 server fns — NOT by widening `<endpoint accepts=>`, which RE-OPENS §61.3/§61.10 rather than extending it.** **`<upload>` REJECTED 5/5.** **★★ Established fact 4 is FALSE by execution — base64-in-JSON over `<endpoint>` COMPILES AND RUNS (200 + typed decode + compiler-owned 400); the gap is ENCODING/TRANSPORT, not capability.** **★★ 3 of 4 layers already BUILT** (`bind:files` compiles+wires · hand-authored `enctype="multipart/form-data"` emits **with CSRF** · typed transport carries bytes); missing = a type NAME + a server DECODE. **The tell: `FileList` occurs ONCE in the 37k-line SPEC and ZERO times in `compiler/src/`; `emit-form-for.ts:290`'s `file` branch is DEAD CODE.** **★★ 4 DEFECTS ROUTED FIRST: (D1 NEW HIGH) `formFor`'s mandated un-opt-out-able PE fallback posts to a 404** (`/api/…` emitted vs `/_scrml/…` mounted; zero `/api` handling anywhere) · **(D2 known HIGH — MECHANISM LOCATED) the raw-egress gate is a source-text regex bypassed by `globalThis.` — instance #233 of dpa-025's RATIFIED S338 census class, inside that census's stated blind spot** · (D3) `formData()` unawaited, violating §19.9.8's own boundary clause · (D4 NEW) no body-size ceiling on any of 3 JSON prologues = live DoS. **★ Pole 3's falsifier was already met (§38/§37 exist) — re-polled, it did NOT flip: `<channel>` is app-scope broadcast → a privacy bug; PA-verified stronger (`E-CHANNEL-007` forces STATIC `topic=`). Progress → §37 SSE, DEFERRED.** **★ The PA lean's rationale is unavailable — (a) mints a primitive too, a TYPE not an element.** **⚑ OQ-1 BLOCKING + cheap (~20 lines): can Bun stream-count-abort `req.body` without materializing? If NO, the bound is advisory-only and pole 5 switches to (b).** → `scrml-support/docs/deep-dives/file-upload-arrival-shape-dpa-030-2026-08-16.md` | **RATIFIED S347 2026-08-16** (bryan: *"a, land the defects first"*) — fork (a) NARROWED: `File` as the 7th builtin primitive, a capability HANDLE on the existing server-fn contract, NOT by widening `<endpoint accepts=>`; `<upload>` rejected; the four defects land FIRST. S346 bryan — reverse-ouroboros correction; banked S347; **RUN 2026-08-16**; bryan rules; return leg pending; DEFECTS to file |
| ~~dpa-030 (prior row)~~ | *Banked S347 2026-08-16.* ⚑ *Re-banked at S346 in the hand-off, the wrap and user-voice — but never written HERE, so it did not exist to the dPA and `dpa-debt` read `0 UNRUN` correctly. The §10 obligation/probe mismatch again, fourth-plus instance; found at S347 boot when bryan said he was about to fire the dPA.* **Successor to the WITHDRAWN dpa-029 Q3.** Q3 offered "(a) host-escape by design vs (b) native" — but the host-escape it named is RUNTIME-BROKEN, so (a) was never a live option and the fork was invalid as framed. **Whether uploads exist is SETTLED, not a question** (bryan S346: *"We have NO upload path?! Really?!"*). The only open axis is the SHAPE: a `File`/multipart PARAMETER on the server-fn / `<endpoint>` contract adopters already write, vs a dedicated `<upload>` primitive. PA lean = the parameter (LIMIT wins, FORK RULE row 1; dpa-029 panel 5/7), **recorded, not ruled**. | S346 bryan — reverse-ouroboros correction; banked S347; bryan rules; return leg = a comment on #471 |
| dpa-031 | **COMPLETE (ADVISORY) dPA 2026-08-16 — awaiting bryan.** ★★ **The gap was ALREADY FILLED and §51.0.A named the wrong thing as the filler.** scrml HAS a free-shaped, TYPED, FAIL-CLOSED shared store today — top-level cell + cross-file component ambient read, compiled AND executed in a real DOM (8 live `_scrml_effect` subs; a leaf 3 files deep re-renders on every write; missing ambient cell = `E-STATE-UNDECLARED` at COMPILE time). §15.13.4 is written over `@var` GENERICALLY, not over engine cells — so both adjectives in "free-shaped / **untyped** global store" are inaccurate. **Meanwhile the substitute §51.0.A names DOES NOT WORK CROSS-FILE and was never exercised end-to-end: D1** inert unexpanded `<engineVar />`, green compile, 0 diagnostics, renders NOTHING (**PA-CONFIRMED by execution S347** — arm text 0× in the importer, 1× in the definer) · **D2** engine var absent from the module-registry footer · **D3** `initial=.Variant(payload)` drops the payload → `TypeError` surfacing as *nothing happening*. **Three HIGH defects sat under a ratified `final` for ~169 sessions.** The rule that actually binds is unwritten anywhere: **a shared cell must be declared in the ENTRY file** (cells not exportable, §21.2). Prop-drilling friction **MEASURED, not asserted: 4.55× identifier repetition** (91 vs 20) for byte-identical output. **Direction (advisory): do NOT widen, no store primitive** — fix D1/D2/D3, rewrite §51.0.A's justification to the real rule, bank cell-exportability as a MODULE-SYSTEM question. **S316/#388 `export let` rejection UNAFFECTED.** Honest null offered and DECLINED on evidence. | **RATIFIED S347 2026-08-16** (bryan: *"your rec"*) — do NOT widen, no store primitive; file D1/D2/D3; rewrite §51.0.A's justification to the real (unwritten) entry-file rule; leave `final` alone until the defects are fixed. S346 reverse-ouroboros arc → audit node `free-shaped-global-store-not-built`; banked S347; **RUN 2026-08-16**; bryan rules; 7 defects to file (3 HIGH) |
| dpa-017 | **RATIFIED S230 2026-06-28** (user "go with your recos") — HYBRID: **B (origin-keyed structural redaction at the compiler-emitted egress sink) = load-bearing FLOOR** · A (same provenance map, static-prove) = demoted DX LAYER, **DEFERRED** · field-level **`reveal("col")`** = sole declassification · dynamic-SQL strip-all+lint · raw/FFI egress fail-closed. PA-verified the stale-cite flag, then authored **SPEC §14.8.9** (Nominal/spec-ahead) + fixed §14.8.7's stale `E-ROUTE-003` cite + minted **E-PROTECT-004 + I-PROTECT-STRIP-001** (§34, land-with-impl) + landed the insight + SPEC-INDEX regen. **Residual = the FLOOR BUILD** → `docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md` (sPA-slot-able; OQ-1 descriptor-lifetime first). | **RATIFIED** (build pending) |
| dpa-032 | **COMPLETE (ADVISORY) dPA 2026-08-17 — awaiting PA/bryan ratification.** **Recommendation: B — the SUBSTRATE, not a message surface.** ⚑ **The honest null is DEAD, and not on scope:** `<html lang="en"` is hardcoded at `codegen/index.ts:2261` with NO author surface — a French page ships `lang="en"`, so a correct two-language app is impossible at any adopter effort. ⚑ **The by-construction guarantee the bank asked for ALREADY EXISTS:** a missing translation is `E-TYPE-020` TODAY because it IS a match arm (`const <greeting> = match (@locale){…}`), browser-verified reactive. ⚑ **TWO BANK FRAMINGS CORRECTED:** code-default bodies are the *easiest* locus for a message lookup (a bare run is CODE, SPEC:1195), not the hardest; and a general message table is **NOT** an extension of §41.12 (closed 15-variant `ValidationError` key space). ⚑ **Structural result:** `E-STRUCT-FUNCTION-FIELD`'s own prescription (*"model the behavior as data, an enum tag the consumer matches on"*) independently derives ICU MessageFormat — the axiom SELECTS the encoding, it does not obstruct i18n. **4 UNFILED DEFECTS ROUTED** (see §6): (a) annotated struct-literal completeness entirely UNCHECKED — general, browser-verified to blank the UI — suspected highest severity; (b) a reactive read via a plain `function` call emits ZERO effects (green compile, browser-dead) — route-to-PA; (c) `@`-sigil in a backtick template literal → `E-CODEGEN-INVALID-LOGIC`; (d) §20.4's *"compiler SHALL inject `route`"* unimplemented + its diagnostic misdirects to a form §20.4 forbids. **R2-TERMINAL — no R3** (B and C are nested, not orthogonal). ⚑ **PANEL GAP CLOSED:** the forged `i18n-message-catalog-expert` went live LATER IN THE SAME SESSION and was polled **adversarially** (told to attack the two arguments that beat C, and not to manufacture a C case). **It ranked B anyway — 3/3 now** — and supplied the two sharpest LIMITS on B's claims (presence-vs-translatedness; the §5.3 generator's TMS ceiling — fuzzy invalidation needs the previous source string persisted, which a pure derived emit cannot hold). **Split is 2-1 FOR an ambient `@locale`.** Harness note amending dpa-027: neither *next boot only* nor *next roster refresh* is right — the roster refreshed mid-session but not at the next turn boundary. `E-VALIDATOR-INLINE-DYNAMIC` is confirmed an **unpaid cost** and this DD does not discharge it (§7). ⚑ **THE BANK'S PRIOR-ART PREMISE IS REFUTED (§0.6/§8.5, 14 systems surveyed).** **Flutter `gen_l10n` does NOT fail the build on a missing key and does not even warn** — it gap-fills, emitting the template-locale ENGLISH literal into the generated `AppLocalizationsEs` via `logger.printStatus`; Flutter's own hermetic test asserts generation SUCCEEDS with an untranslated key. Paraglide JS does the identical thing → **inherent to codegen, not a Flutter accident.** Of 14 systems, **exactly ONE** has a real missing-translation build gate: **Android lint `MissingTranslation`** (`Severity: Error`, at the DECLARATION site, first-class opt-outs — if you ever ratify a gate, it owes an opt-out in the same diff). **Structural reason: a fallback chain and a build-time exhaustiveness check are MUTUALLY ANNIHILATING** (Lingui `--strict` exits 0 whenever `fallbackLocales` is set). **scrml has no app-content fallback chain — which is exactly why its `E-TYPE-020` route holds a gate the field mostly cannot, and why C built as the bank imagined it would ANNIHILATE that gate.** ⚑ **BUT THE CLAIM IS NARROWER THAN §0.2 FIRST SAID** (domain voice): `E-TYPE-020` proves arm **PRESENCE, not TRANSLATEDNESS** — paste the English into `.Ja` and you get a clean build + an untranslated string. **State it as: missing locale arm = build failure; untranslated arm = undetected.** ⚑ **§7 REVERSED on late prior art:** gettext's manual documents scrml's EXACT constraint for scrml's exact reason (*the `gettext` call must precede argument substitution*), so `E-VALIDATOR-INLINE-DYNAMIC` is **SOUND and only its beneficiary is missing** — the domain voice's third option (**downgrade to a warning now, re-promote in the extractor's landing diff**) is the one to rule on first. Nothing in the prior art is `[EXEC]`; tiers marked per claim. PRIOR BANK (S349 2026-08-17): App-content i18n: native compile-time message surface, or host/runtime boundary by design? Triggered by an unsolicited inbound proposal for a runtime DOM-scanning translation library — **rejected at intake on four grounds (unmediated egress sink · second uncontrolled DOM writer vs writer-ownership Axiom ① · retrofit-not-by-construction · SEO inversion), with an explicit SCOPE LIMIT so it does not decide build-time or authoring-aid proposals.** ⚑ **PA-verified S349 by grep: scrml's ONLY i18n surface is diagnostics/labels** (§41.12 `registerMessages` · §55.10 4-level chain · §41.16 `registerLabels`); 7 `i18n` mentions in 37,152 SPEC lines, every one about validator messages; **ZERO entries in `known-gaps.md`, ZERO here** — genuinely unfiled. ⚑ **The sharpest fact: `E-VALIDATOR-INLINE-DYNAMIC` (SPEC.md:19554) REJECTS a form TODAY to protect "i18n tooling extraction" that does not exist** — a cost already paid for an unbuilt pipeline. Discriminator = the S322 test: a missing locale should be a compile error the way a missing `<match>` arm is (by construction), not a runtime fallback chain (retrofit). Prior art to study: **Flutter `gen_l10n`** (codegen → missing key fails at build), not the JS-framework field alone. apps-test ALREADY YES — do not re-poll. | S349 bryan bank → RUN 2026-08-17 (dPA) → **RATIFIED S352 2026-08-19 (bryan)** — *"Full substrate B"*: the defect half (author-settable `lang`, default `"en"`) **+** the substrate half (declared locale set · `Intl.PluralRules` binding replacing `stdlib/format`'s English `count == 1` · locale as the formatters' default · locale as a route dimension, negotiation as entry redirect only); catalog tooling stays **userland, no language surface**. **A is DEAD** on a PA-verified fact (`<html lang="en">` hardcoded at `codegen/index.ts:2261`, no author surface — a French page ships `lang="en"`); **C is DEFERRED on prior art** (14 systems; only 1 has a real missing-translation build gate; a fallback chain and a build gate are mutually annihilating, so C-as-imagined would annihilate the guarantee `E-TYPE-020` already provides). **Sub-fork routed to the PA and RULED: ambient locale, specifically as an ENGINE-SINGLETON** — mints no new mechanism; S178 already ratified the engine-singleton as scrml's typed global reactive store with compiler-proven ambient `@cell` reads, so limit-over-widen is satisfied and an undeclared `Locale` engine is an error, not a silent default. **Prerequisite, independently owed and NOT i18n scope:** §20.4's server-fn `route` binding — PA-verified as PARTIAL, not absent (`route` IS bound at `type-system.ts:9599`, but a read inside a server fn fires `E-SCOPE-001`, so the second normative SHALL is the missing half). See user-voice S352. |

| dpa-033 | **COMPLETE (ADVISORY) dPA 2026-08-19 — awaiting PA/bryan ratification.** ★★ **THE PA RECOMMENDATION (b) IS REFUTED ON THE FACTS — it does not close the reproduced fail-open.** Three poles independently found it: the repro's query, reveal and raw egress are all in ONE BODY, so restricting *cross-call* declassification never touches the reproduced breach. **The residual defect is name-keyed vs value-keyed, NOT intra- vs inter-procedural** — the approach set was drawn on the wrong axis. ★★ **(a) IS UNSOUND — NEW shape H1d, `[EXEC]`-compiled at `eb170a84`, exit 0 / zero diagnostics:** `JSON.stringify({mine: a.reveal("passwordHash"), other: b})` satisfies (a)'s own admission criterion and still ships `b.passwordHash` — the coverage rule `site.cols.some(c => !revealed.has(c))` is a NAME-keyed set membership. Textbook occlusion (Sabelfeld & Sands). ★★ **THE REFRAME: the runtime ALREADY implements §14.8.9 correctly** — `[EXEC]` on the shipped helpers: value-scoped, per-column, **alias-proof (it gets H1b RIGHT)**, zero static reasoning. These are not problems scrml failed to solve; they are questions the machine answers correctly on every path except the one where nothing calls `_scrml_protect_redact`. **Value-scope needs approximating only on a sink you REFUSE to mediate — and there the only conformant approximation is refusal.** ★★ **SPEC-VS-IMPL: the `.reveal(` suppressor is an IMPL ADDITION, not a spec grant** — `SPEC.md:8522` + the catalog row at `19284` mandate an unconditional **SHALL fail closed**; neither names `reveal` as an admit path on raw egress. So **(c) is the only option owing no conformance argument**, and (c) IS conformant ("sole admit path" is a necessary condition on admission, not a guarantee every route offers one). ★ **FOURTH OPTION (d) — sink-level lowering**, absent from the bank: emit `JSON.stringify(_scrml_protect_redact(x))` at mediatable raw sinks. ⚑ **NOT the deleted `toJSON` hook** — that was VALUE-level and direction-blind ([1545]: *a value cannot know why it is being serialized*); (d) is SINK-level, so both rejection grounds fail against it. *An expert with no knowledge of this arc re-derived the deleted hook independently — corroboration that the mechanism is attractive and that [1545]'s reason is the load-bearing insight.* ★ **RECOMMENDATION: land (c) as the sound floor NOW** (subtractive, net ≈ −80 LOC, ~1-2 d, **zero adopter migration** — `[EXEC]`: `.reveal(` in exactly 2 `.scrml`, both conformance cases), **then (d)** as the ergonomic restoration with (c) remaining the floor. **Do NOT ship (b) as this item's answer.** Type route = correct long-run model but 15-30 d monomorphic / 40-80 d polymorphic vs zero adopters; its own advocate conceded the ROI. ★ **OPERATOR ANSWER: split by MEDIATABILITY** — `reveal` stays a value construct everywhere, stops being a static suppressor anywhere. **5 DEFECTS ROUTED: (D1 NEW)** dynamic `reveal(colName)` falls through to ordinary call emission and **no runtime `reveal` method exists** → `TypeError` at runtime, **exit 0 at compile** · **(D2 main-only)** the suppressor is a LEXEME test — `.reveal(` in a **comment or string literal** disables the gate for the whole function · **(D3 NEW)** `conformance/cases/protect/reveal-suppresses-e004/` asserts `notCodes: [E-PROTECT-004]` — **a green test pinning a leak** · **(D4 NEW)** the emitted handler **double-wraps** an authored `Response` → body degrades to `{}`, **masking** the HTTP-level leak (a masked leak is a latent leak) · **(D5)** `tenant-egress.ts:391` is a **byte-identical twin** of main's regex gate, same hole. ⚑ **UNMODELLED DIMENSION routed to PA:** §14.8.9 has **no constraint on WHO may write a `reveal`** — robust declassification; in a codebase where agents author server fns, a name-keyed check makes an inserted reveal CHEAPER, because it launders every sibling value for free. ⚑ **A dPA self-correction is recorded in the artifact:** an initial probe appeared to show the repro leaked via a `globalThis.Response` detection hole rather than reveal-scope — **true of `main`, ALREADY FIXED on the branch**; the repro ran on the branch, so **the item's premise STANDS**. → `scrml-support/docs/deep-dives/reveal-value-scope-raw-egress-dpa-033-2026-08-19.md` | S350 bryan bank → RUN 2026-08-19 (dPA); 5-pole LIVE poll → **RATIFIED S352 2026-08-19 (bryan)** — (c) as the sound floor NOW, then (d) sink-level lowering as the restored exit; (c) stays the floor for sinks (d) cannot see. Unblocks `egress-tojson-root` Unit 2. See the fenced item + user-voice S352. |
| dpa-034 | **COMPLETE (ADVISORY) dPA 2026-08-19 — awaiting bryan (ONE-WAY door, his ruling). ⚑ PANEL GAP CLOSED 2026-08-19 ROUND 2 — 5/5 poles; READ THE ROUND-2 ARTIFACT BEFORE RULING:** `scrml-support/docs/deep-dives/d1-no-editions-round2-panel-gap-closed-dpa-034-2026-08-19.md`. ★★ **BOTH late voices REFUTE standing recommendation #3** — it says re-earn D1 on *no separate compilation*, and that is the one precondition neither accepts as load-bearing (GHC runs a per-file rule-set boundary inside whole-closure-from-source compilation, no registry, no separate compilation). Corrected load-bearing fact = **no registry / no independently-versioned units** (`SPEC.md:23341`). ★ **TRIPWIRE REFUTED** — §62.6 is a subset/ceiling gate, not a divergent rule-set, *and* it is 100% unbuilt (0 sites for `E-LANGUAGE-VERSION-TOO-NEW`, `scrml.toml` parsed nowhere, no pragma surface). ★ **true-removal 3/3 → 4/4**, zero counterexamples. ★★ **The one-way door is the DELETION POLICY, not the architecture** — a removed form must be RECONSTRUCTED, not retained. ★★ **Rec #6's instrument is inert:** `chunks.json` is WRITE-ONLY (0 read-sites) — retaining a chunk retains compiled JS output, not the ability to compile the form; the GHC `NPlusKPatterns`-shaped per-form expiry-tracked opt-in (= Approach C) is the only proposed instrument that works. ★ **§62.8 contains no "EVER"** — the strike lands on *"not warranted here"*; meanwhile §62.6/§62.9 cite Rust editions + C++ `-std=` as scrml's own prior art. ★ The honest claim is **"available but not worth it"**, not "structurally unavailable". ⚑ **The CONCLUSION survives intact; only the REASON changes — for the second time.** *Round-1 findings below, unchanged:* ★★ **THE PA'S REPLACEMENT PREMISE FAILS: `-std=` / `go 1.x` IS coexistence machinery.** Two poles refuted it on independent evidence. **Go 1.22's loop-var change is gated per-package off the module's `go` line — `cmd/compile` carries BOTH semantics and selects per package, in one build, one binary.** *"A single compiler holding N rule-sets and selecting among them per compilation unit is what 'editions' IS. Go has it, has almost none of it, and doesn't call it that."* **C++ `-std=` likewise IS editions** (one binary, all standards, flag-gated) — *"a labeling move, not a design move"*; and **Go's real mechanism is not `-std=` at all** but the compatibility promise, **a STRONGER discipline than scrml promises, not a cheaper mechanism**. Corroboration: **GODEBUG** (permanent never-removed runtime-behaviour knobs) was built *after* the promise proved insufficient, and **GOEXPERIMENT** staged `loopvar` a full cycle first. **So the recommendation cannot be ratified as written.** ★★ **A NON-POPULATION ARGUMENT DOES EXIST, but earns a SMALLER claim:** (1) **conformance-suite singularity** — the BUILT 69-case pre-commit-gated suite operationally IS the spec, defining conformance as ONE predicate; editions force it parameterized · (2) **the interaction matrix** — N rule-sets = N languages compiler/checker/formatter/LSP carry forever. Both population-independent. (3) legibility is *solved, not eliminated* by crate metadata — carries nothing alone. **But these support *"no editions in the 1.0 surface as built"*, NOT *"EVER"* — the word EVER was never earned by anything except the inadmissible premise.** ★★ **3/3 POLES CONVERGED, FROM THREE UNRELATED DIRECTIONS, ON A DOOR THAT WAS NOT BANKED: the real unexamined claim is `remove-only-at-a-MAJOR`.** Go: *deprecation terminates in permanent deprecated-but-working; there is deliberately no Go 2.0 — "no editions" is cheap for Go BECAUSE Go pairs it with near-total non-removal; keeping true-removal while claiming Go's cover is claiming Go's PR while reserving the power Go renounced.* Simplicity: *a deprecation cycle with true removal **schedules a synchronized cliff** and borrows the word "transition"; it doesn't eliminate coexistence complexity, it RELOCATES it off the compiler's books onto every adopter, uncoordinated and unamortized — simple for the compiler author, not the user.* Unison: *forced deletion imports the NAME-addressed assumption that content-addressing exists to reject; **"no editions" and "true removal at a major" are logically independent claims.*** ★ **ONE-WAY-DOOR CLAIM OVERSTATED:** Rust shipped 1.0 in 2015 and added editions in 2018 — rustc is not a different compiler, it carries a bounded FRONT-END delta never allowed to fork the type/borrow checker or codegen. **True for DEEP changes, not a door at all for shallow ones.** Unison concedes content-addressing gives **ZERO** dividend on grammar (it solves coexisting DEFINITIONS, not RULE-SETS). ★ **RECOMMENDATION: strike "EVER" from §62.8** (→ *"no editions in the 1.0 surface as built"*; nothing built changes) · **strike the population premise from D1 AND D4** · **re-earn D1 on suite-singularity + interaction-matrix, NOT on `-std=`** · record the reopening condition (*is this a front-end-only delta?*) · re-ground the deprecation WINDOW on a non-population signal · **open `remove-only-at-a-MAJOR` as its own question** (no-regret: decouple deprecation from DELETION using chunks.json/§47 — retain the chunk, stop resolving the name; **needs no second grammar, so the one-way door is untouched**). ⚑ **TRIPWIRE, cheap, check before ratifying:** *the moment `[language] version=` is read by the compiler to select between two behaviours for the same syntax — not merely as a manifest field — it HAS become an edition mechanism regardless of its name.* ⚑ **META-FINDING (simplicity-defender, against its own reflex):** *"this is re-earning shopping for a premise… treating 'I found AN argument' as license to re-stamp the original totalizing conclusion is exactly motivated reasoning. The honest procedure is to **downgrade certainty to match what's earned**."* ⚑ **PANEL GAP, DISCLOSED: 3 of 5 poles ran.** `rust-edition-expert` + `haskell-language-pragma-expert` were staged at batch start but did **not** go live this session ("agent type not found", two attempts ~40 min apart) — live at the NEXT dPA boot. **Two questions are UNANSWERED: (i) the crate-boundary interop question — does scrml even HAVE a unit that could carry an edition? If not, editions may be structurally unavailable for reasons unrelated to population, which would BE the missing language-design argument** · (ii) the GHC2021 evidence. **Re-poll both before ratifying** (dpa-019 precedent: a late-live voice was the highest-impact contribution and would have flipped the verdict). → `scrml-support/docs/deep-dives/d1-no-editions-earned-or-assumed-dpa-034-2026-08-19.md` | S350 re-bank (audit R5) → **RUN 2026-08-19 (dPA)**; 3-of-5-pole LIVE poll; advisory, **bryan rules** → **RATIFIED S353-bryan** ("your rec on all three") — conclusion (no Rust-style editions) STANDS; the REASON changes for the third time. Reframe §62.8 to "no editions in the 1.0 surface as built" · strike the population premise from D1 AND D4 · re-ground D1 on suite-singularity + interaction-matrix (NOT `-std=`, NOT "no separate compilation" — both refuted by live poles) · record the reopening condition (*is this a front-end-only delta?*) · **open `remove-only-at-a-MAJOR` as its own question** (the door that was never banked; true-removal 4/4, zero counterexamples). Nothing built changes. |

| dpa-035 | **COMPLETE (ADVISORY) dPA 2026-08-19 — awaiting PA/bryan ratification.** ★★ **THE QUESTION IS ASKED AGAINST THE WRONG LEDGER — the "16 KB budget" is the assembled SPA *RUNTIME* gzip budget** (`g-spa-runtime-gzip-budget-knife-edge`, 16,257/16,384 B, **127 B margin**, open HIGH with a live hold-vs-raise fork, asserted at `v0-3-x-spa-tree-shake-phase-b.test.js:145`) — **NOT an app-payload budget.** Above-the-fold partitions APP markup; the app budget is a separate SOFT `W-CG-CHUNK-LARGE` at 100,000 B sitting at **2.4% utilisation**. Fold-preferencing therefore **cannot relieve the budget that motivated the question**, and the mechanism to realise it is paid for OUT of the constrained ledger. ★★ **The bank's load-bearing claim is CONFIRMED by execution** (a 4-arm `<engine initial=.Idle>` ships all 3 non-initial arm bodies into the initial client chunk) — **but the half the bank did not state is decisive: arms are DEFINED, not MOUNTED** (absent from HTML; no DOM, listeners or subscriptions). ⚑ **I CORRECTED MY OWN CEILING 19x MID-DELIBERATION** — trivial arms gave 37 B gz, heavy dissimilar arms (form/table/error-panel) give **2,659 B raw / 689 B gz = 28.4% of the app chunk but 2.40% of payload**; three poles had already reasoned from 37 B and **all three were re-polled against it and all three moved**. ★★ **THE ARITHMETIC THAT DECIDES IT (source-verified):** there is **no component-tiering machinery to extend** (`reachability-solver.ts:434-454` — component/cell/vendor tier sets are `new Set()`, literally empty; the tier axis carries server-fn ids ONLY, so this builds the FIRST component tier) · deferring arms **inverts a normative SHALL** (worst-case union, *"under-inclusion is the disallowed failure mode"*, `SPEC.md:22980`) → a §40.9 amendment, **120-220h** · and **no executing loader exists** (`_scrml_fetch_chunk` returns chunk TEXT, never evaluates) so one costs **400-900 B gzip of RUNTIME to save 689 B of APP** — *spend the ledger with 127 B of margin to relieve the one that is 97.6% unused.* ★ **§65 critical-CSS claim REFUTED by execution** — `#{}` emits verbatim into one global `@layer global`; a class used **nowhere at all** still ships (no dead-rule elimination, no per-arm partition). ★ **HTML byte pool = ZERO** (heavy vs empty arm HTML both 603 B, no `<template>`) — closes the cost-pole's own named unverified gap, against the proposal. ★ **`--minify` is a shipped CLI flag documented as a NO-OP** (`cli.js:73`) applying to 100% of emitted surface vs the fold's 8.4%. **VERDICT 6 DO-NOT-BUILD / 1 DEFER-WITH-RETRIGGER / 0 BUILD** — the corrected measurement flipped the Qwik pole to BUILD-NARROWED, the source facts **re-flipped it back to DO-NOT-BUILD on its own arithmetic** (*"qwikloader amortizes ~1 KB across hundreds of QRLs; an arm-loader amortizes 400-900 B across ~4 arms — same mechanism, wrong denominator"*). **Reco: sequence (1) land `--minify` for real, (2) runtime tree-shaking (the ledger actually failing), (3) fix `I-SSR-EACH-CLIENT-RENDERED` (the REAL above-the-fold defect — the LCP element painting client-only), (4) dead-rule elimination in `#{}`; revisit the partition only when the runtime fork resolves by RAISING and a loader exists for another reason.** ⚑ **OQ-1 BLOCKING: resolve the 16 KB hold-vs-raise fork — every option is downstream of it.** ★★ **PANEL GAP CLOSED — dPA 2026-08-19 (second boot), addendum §10.** The critical-rendering-path voice (forged in the first drain; `Agent type not found` then, LIVE at this boot — a clean second confirmation of the next-boot rule) was polled and **CONFIRMS: tally now 7 DO-NOT-BUILD / 1 DEFER / 0 BUILD** — on STRONGER grounds than cost. ★ **The sign is wrong, not just the size:** deferral **REGRESSES INP on the state switch**, which in an `<engine>`/`<match>` app IS the primary interaction (good INP → 100-500 ms on mobile) — every other pole argued the prize was too small; this one argues it is NEGATIVE. ★ **Re-denominated in ms the prize vanishes:** never-called arms are pre-parsed only ≈ **0.4-1.3 ms = 2-5% of ONE frame, first visit only, <1% of runtime main-thread cost** — **the panel OVERSTATED the residual by staying in bytes.** ★★ **The reframe:** bryan's statically-known-initial-state idea is worth **~100x more aimed at FIRST PAINT than at chunk size**, and §5's blockers do NOT bind it (no under-inclusion, no loader, no runtime bytes vs the 127 B margin) — **VERIFIED: a `fixed inset-0 z-40` backdrop swallows EVERY CLICK from first paint until hydration** (`app.scrml:2870`, `<overlay> = ""` at `:117`, fold happens only in `app.client.js` — the LAST of 8 parser-blocking scripts). ⚑ **The pole's stated mechanism was REFUTED and the finding ENLARGED:** its "the compiler folds initial hidden state, inconsistently" rests on an **AUTHOR-written** `hidden` (`:2854`; the sibling binding at `:2845` has none) — there is **no folding machinery**, so not an inconsistency but a **missing capability every adopter hits**, silent on failure. **6 defects verified + ROUTED** (4 scrml-compiler/emit, 2 flogence-app), incl. compiler-emitted **`.defer` on a `createElement` script = a no-op** (chunk may execute BEFORE the runtime — a race, not a smell) and **2 serialized RTTs** before the chunk is even requested. ⚑ **THE SOLE UNTAKEN MEASUREMENT THAT WOULD INVERT EVERY ARITHMETIC HERE: can a non-initial arm SOLELY root a VENDOR UNIT?** (prize would be **40-150 KB gz, not 689 B**; `prefetchTier1.vendorUnitNames` already exists as an empty set). One fixture settles it. ⚑ **Ledger note for OQ-1:** §1 budgets the runtime at 16,257 B while §2.2 ships **26,258 B gz** and the flogence cockpit ships that plus 7 more scripts — **rule OQ-1 on the SHIPPED number, not the budgeted one.** Every repo claim the pole made was independently re-verified by the dPA before recording; two needed correction. ADVISORY — nothing ratified. → `scrml-support/docs/deep-dives/above-the-fold-preferencing-dpa-035-2026-08-19.md` | S352 bryan bank → RUN 2026-08-19 → **RATIFIED S352 2026-08-19 (bryan)** — *"Ratify as advised"*: **DO-NOT-BUILD** the fold partition (6/1/0), take the replacement sequence — (1) land `--minify` for real (a shipped CLI flag documented as a no-op; 100% of emitted surface vs the fold's 8.4%) · (2) runtime tree-shaking (the ledger actually failing) · (3) fix `I-SSR-EACH-CLIENT-RENDERED` (the REAL above-the-fold defect — the LCP element painting client-only) · (4) dead-rule elimination in `#{}`. **Decisive fact PA-verified:** `_scrml_fetch_chunk` returns `r.text()` and never evaluates — no executing loader, so the scheme costs 400-900 B of RUNTIME to save 689 B of APP, which loses on its own arithmetic and would now break the S352 ratchet. **TWO CORRECTIONS against the DD, recorded so the cost is not mis-cited:** the §40.9 amendment leg (120-220h) applies ONLY to runtime-driven engines — for a compile-time-known `initial=` the SPEC already says a `<match>` MAY be classified IN or OUT, so no amendment; and the "127 B margin" framing was the stale S282 figure. Neither rescues the proposal. **Its OQ-1 (the 16 KB hold-vs-raise fork) was dissolved earlier the same session.** ⚑ Panel gap carried forward: the critical-rendering-path voice could not be polled (`Agent type not found`) — live next dPA boot. See user-voice S352. |
| dpa-036 | **COMPLETE (ADVISORY) dPA 2026-08-22 — awaiting PA/bryan ratification.** ★★ **VERDICT — THE ITEM'S TWO RANKINGS ARE INVERTED, by its OWN cited authority.** `[1678]` ratifies a surface/internals split: *"'one chance to get it right' binds the AUTHORING SURFACE — NOT the compiler internals."* An inference algorithm is internals → **(a)→(b) is REVERSIBLE, not one-way.** What IS one-way is what `asIs` MEANS at an annotated position. **So the "sub-question inside (b)" IS the fork, and the a/b choice is subordinate scheduling.** ★★ **THE `asIs` ANSWER — 5 of 5 poles, independently, from opposed priors:** `asIs` means *the developer signed for it*; it must NEVER mean *the compiler did not look*. **Inference failure must be structurally incapable of producing `asIs`** — it yields a loud, countable `unknown^gap(k)`. Not fail-closed; **fail-LOUD** (fail-closed IS refusal-based → bills the adopter → `[1678]` rules it out, so the PA's (c) exclusion is CORRECTLY grounded). Notable: the **simplicity pole's yield condition is verbatim the type-systems pole's structural fix** — the two expected to disagree agree on mechanism and differ only on sequencing. ★★ **[EXEC] NEW, NOT IN THE BANK — the decay is not a risk, it is the CURRENT STATE:** `fieldTypeAssignable:850-862` returns true if **EITHER** side is `asIs`/`unknown` → `any`-shaped, not `unknown`-shaped; (b) built on it would **BEGIN** at (a). ⚑ **WORSE:** `fieldTypeEquals:869-877` ends `return true` for predicated/map/state/etc → reuse fails open across **~10 of 18 kinds**, not just the top. ★ **BUT THE FIX IS CHEAPER THAN THE BANK ASSUMED:** `AsIsType:340` + `UnknownType:364` are **ALREADY distinct union members** (`:489-490`) — the relation discards the distinction in TWO LINES; and `AsIsType.constraint` is an **escape-hatch-on-the-escape-hatch** (§14.10 R28-8 recovers the type the resolver just discarded) = the codebase ALREADY felt this and patched around it locally. `ResolvedType` is **NOT** SQL-shaped (18-member general lattice; SQL rides on name STRINGS `:743`/`:754`; `fnSignatures:8330-8479` already stores params+returns as `ResolvedType`) → **reuse the MODEL, replace the RELATION** (~150-250 LOC, **ONE** call site, provably preserves §14.8.8, 20-35h). ★ **PRECEDENT: scrml ALREADY RAN THIS REPAIR ONCE** — `E-TYPE-UNKNOWN-NAME`/`checkUnknownTypeNames` (`type-system.ts:5151+`, S176) converted a silent `asIs` fall-through into a position-aware hard error at the SAME seam. ★ **SCOPE IS SMALLER THAN FEARED:** the argument-position silence is **literally one line** (`:15063` `if (paramType.kind !== "enum" && paramType.kind !== "union") continue;`); cell 1-2h; return 3-5h; staged warn→error is **~0-4h** (`TSError:708-718` already takes `severity`). ★ **[EXEC] §7.5 IS NOT A FOUR-POSITION RULE — E-TYPE-031 backs NINE normative SHALL sites** (`:6132 :6149 :9600 :9721 :10071 :10254 :10258 :11679 :11697`), and **§34's registry (`:19235`) books it as PROP-only (§15.3/§15.10)** — the code's own registry contradicts its primary clause. → the SPEC has a defect here **regardless of which algorithm ships**. ★ **COSTS:** (a) ~52-110h · **(b) 205-390h** · (c) = (b) **+10-20h — a default FLIP, not a build**. Corpus repair **40-90h is IDENTICAL under all three** (60-75% of first-wave breaks are inference incompleteness, per TS/Sorbet/mypy rollouts) → (a)'s real saving is compiler time only. ⚑ **DOMINANT RISK: the builtin-method return-type catalog** (+40-80h, no scaffolding, implicated by the measured `n.toUpperCase()` repro) — out-of-scope means member-call→top, i.e. the exact absorption this DD exists to prevent. ⚑ **WORST CORNER: (b) with the relation EXTENDED — (b)'s cost, (a)'s outcome.** ★ **FREE OPTION (take it):** build the un-inferable default as a **single switch** — ~0h designed in, expensive retrofitted; keeps (c) available without adopting it. ★ **THE DUMB-TYPE-SYSTEM ATTRIBUTION IS MOOT:** the panel endorses a **4-element lattice** (`never <: {number,string,boolean,nominal} <: unknown`) — a *dumb* system is compatible with everything recommended; an **ABSENT** one wearing its clothes is not. ★ **5 CALLS FOR BRYAN (§7 of the artifact), ranked:** (1) ⚑ the ONE-WAY one — adopt the authored/gave-up `asIs` split? [panel 5/5 yes]; (2) sequencing widened-(a) vs straight-(b) [genuinely open; narrows sharply once (1) lands]; (3) builtin-method catalog in scope? [±40-80h; do not let it default]; (4) amend §7.5 to its provable domain? [independent of the fork]; (5) warn→error default-on at v1? ★ **METHOD GAP, DISCLOSED:** the gradual-typing `any`-poison voice was MISSING from the roster; `gradual-typing-boundary-expert` was **forged this session → live NEXT boot** (harness constraint re-confirmed empirically: a fresh agent is not dispatchable in the session that authored it). Its substance was carried as [EXEC] facts + the type-systems pole's Siek&Taha consistency-vs-subtyping diagnosis; **the migration-LADDER half (Sorbet sigils / `noImplicitAny` staircase) went unargued** — if call (2) or (5) is live at ruling time, re-boot + poll it (one question, not a re-run). **Artifact:** `scrml-support/docs/deep-dives/type-system-assignability-dpa-036-2026-08-22.md` (642 lines, pushed `0ed03b7`). **Insight CANDIDATE staged, NOT landed.** ⟨ORIGINAL BANK FRAMING FOLLOWS⟩ Banked S354-bryan 2026-08-22. **THE §7.5 ASSIGNABILITY QUESTION: scrml has type ANNOTATIONS but no type SYSTEM for expressions.** ★★ **[EXEC] THE FINDING, PA-compiled at HEAD — §7.5 (`SPEC.md:6149`) says *"the compiler SHALL emit E-TYPE-031 if a non-assignable type is assigned"*, and THREE OF FOUR POSITIONS ARE SILENT:** `let x: number = "hello"` → **fires** · `<n>: number = "hello"` → **compiles clean** · `double("str")` where `a: number` → **compiles clean** · `-> number { return "not a number" }` → **compiles clean**. Only the cell hole is filed (`g-no-reactive-cell-assignment-type-check`, HIGH). **The argument and return holes have NO gap entry and NO §34 error code** — they were unknown until this census. ★★ **AND OPERAND TYPING DOES NOT EXIST AT ALL:** `let s: string = "x"; return s * 2` → clean · `return "x" * 2` (a string LITERAL times a number) → clean · `let n: number = 5; return n.toUpperCase()` → clean. `type-system.ts` has no binary-operand check; its only arithmetic-aware code is a heuristic that DETECTS arithmetic to classify an expression and never validates operands. ⚑ **THE OPERATOR HIT THIS INDEPENDENTLY WHILE WRITING REAL SCRML, within the hour of the census probe finding it** — `fn do_thing(a: number, b: string) { return a * b }` + `do_thing(2,3)`: compiles green, no LSP diagnostic (the LSP surfaces compiler diagnostics and the compiler produced none), and the emitted output ERASES the annotations entirely (`do_thing_1(a, b)`). `fn` is correct spelling (§33/§48 canonical pure form) — this is not an authoring error. ★ **THE SUBSTRATE, so scope is not guessed:** the ONE working position is ~20 lines at `type-system.ts:10098-10118`, handles exactly three annotations (`number`/`string`/`boolean`), only when the initialiser is a LITERAL, and infers via JS `typeof` on the literal's value. **Its own comment says *"More elaborate type inference can come later."*** A `ResolvedType` model (~25 kinds) AND an assignability relation (`fieldTypeAssignable`, `type-system.ts:850`) both EXIST — but scoped to **SQL/struct FIELD types** (§14.8 generated table types). **The type REPRESENTATION exists; expression INFERENCE does not.** Nothing can answer *what is the type of `a * b`*, *of `do_thing(2,3)`*, or *of this identifier here*. ★ **[EXEC] BLAST RADIUS, of 2,014 corpus `.scrml`:** typed parameters **240** · return annotations **103** · typed cells **211**. ~A quarter of the repo's own corpus enters a check it has never been subject to. Adopter code is unmeasured and, per the operator's React framing, growing daily. ★★ **THE FORK — not *whether* (the operator has ruled cost-in-development acceptable) but WHAT GETS BUILT, and it is one-way because it defines what a scrml type MEANS:** **(a) literal-and-annotation propagation** — extend the existing shape, check the four positions, stay silent where uncertain. Cheap, fail-open by construction, catches the operator's repro. ⚑ **But it is the same RETROFIT shape that produced this** — a checker that gives up quietly has a meaningless zero-bug-family, which the retrofit census PROVED with §32 `~` (zero gaps, fail-closed SHALL, **rule does not fire**: `return step2(~)` uninitialised compiles clean and emits `null /* ~ orphaned */`). **(b) a real expression type-inference pass** — bidirectional checking over the AST, proper lattice, `asIs` as honest top. Answers all four positions PLUS operands, and the LSP gets real types for the first time. Large; will surface holes everywhere it touches, which is the point. **(c) (b) + fail-closed on un-inferable** — maximum soundness, maximum ADOPTER cost, and therefore the wrong side of the S354 cost boundary ([1678]). **PA RECOMMENDATION: (b).** ⚑ **THE QUESTION THE DD MUST SETTLE INSIDE (b), because it decides whether (b) decays into (a):** *what does `asIs` mean at a parameter boundary?* It is the honest escape today — but if it silently absorbs every un-inferable expression, (b) degrades to (a) over time and **nobody notices, because the bug family stays empty.** ★ **DO NOT RE-DERIVE:** the four positions and the operand holes are `[EXEC]`-measured above; the substrate inventory is read, not assumed; blast radius is counted. ⚑ **ATTRIBUTION CHECKED, NOT ACCEPTED — the operator suggested *"I insisted on a dumb type system"* is the cause. The record does not support it as a ruling:** zero user-voice hits for a dumb/simple-type-system ruling, zero design-insights; and the SPEC's surfacing stances point the OTHER way — §18704 makes attribute type checking *"always strict regardless"* because *"wrong attribute types produce incorrect generated code"*, and two design-insights treat the type system as load-bearing (*"must be encoded at the declaration site … as a type-system-visible distinction"*). **A grep miss is not proof it was never said.** But the sharper point: **a DUMB type system and an ABSENT one are different.** Dumb-but-honest = *"I check literals against primitive annotations; everything else is `asIs`"* — roughly what the code comment claims. What §7.5 has is annotations **parsed, stored, and never consulted**, while the SPEC promises all four positions. **That is a contract-vs-implementation gap, not a design-ambition error** — choosing simplicity is legitimate; §7.5 promising completeness is not a consequence of it. §18704's own rationale (*wrong types produce incorrect generated code*) is precisely the argument for checking parameters: `a * b` on a string produces incorrect generated code. ★ **RANKED #1 by the S354 retrofit census** on *(bug density × surface-change-required)*: no syntax change, but **the cost grows with every line of scrml written before it is switched on** — every program relying on an unchecked argument breaks the day it starts working. This is the purest instance of the operator's one-chance constraint. | **RATIFIED S365 2026-08-23 (bryan)** — *"ratify 1, take 3 and 4, hold 5"*. **Call 1 (the `asIs` split) RATIFIED, one-way, authoring surface** — `asIs` means the developer signed for it, never *the compiler did not look*; inference failure is structurally incapable of producing it and yields a counted, loud gap that still PASSES. Mechanism ratified with it: `Result<ResolvedType, InferenceGap>` where constructing a gap REQUIRES naming the AST node kind, plus an exhaustive switch with a `never` fallthrough. **Call 3 (builtin-method catalog) TAKEN — stays IN scope.** **Call 4 (amend §7.5 to its provable domain) TAKEN.** **Call 5 (warning->error default-on at v1) HELD — not decided.** Established as a CONFORMANCE defect against S174 (`SPEC.md:19236` already said *"a deliberate, named untyped escape hatch"*), not a new one-way door. Build: rung 0 on `feat/s365-asis-split-rung0`, DO-NOT-LAND on SPEC text only, fix round dispatched. Full ruling: `user-voice-scrml.md` S365; delta-log [1692]-[1693], [1702]. |

**⚠ DRAIN-PATH RULE (S319).** The dPA drains **THIS file**. A deliberation banked anywhere else does not exist to it. Witnessed S316→S319: seven conclusions were rung-assigned into `scrml-support/docs/deep-dives/S316-DELIBERATION-QUEUE.md` and the hand-off recorded *"the dPA is RUNNING on Q1/Q2/Q3"* — it was not and never had been; the dPA drained the dpa-018 Pole-D conditional (which IS in this file) instead, and the three deliberations sat unrun across two sessions while every build that depended on them stayed held. **Same shape as the review-floor and `gh issue list` misses: an obligation named in one place, a probe reading another.** Bank deliberations HERE; a separate rung-assignment doc is a companion, never the carrier.

**Genuinely-open (PA action needed) — CORRECTED S325.** **dpa-022 · dpa-023 — DRAINED 2026-08-05, ADVISORY, awaiting ratify/reject/re-frame.** dpa-023's live item is **the `pending` rung**; dpa-022's is the **inert prose-only reconciliation** (independently shippable) plus a routed HIGH compiler defect now filed as [[g-unknown-type-atom-capitalization-proxy]]. *(dpa-019/020/021 were RATIFIED S319 — "ratify all three" — and this paragraph still listed them as awaiting ratification; two staleness layers in the one file the drain-path rule calls authoritative.)* **Three PA follow-ups the S319 drain generated, none of them the deliberations themselves, all still open:** (1) **RETRACT the false "no `srcmap-provenance.ts`" premise from the RATIFIED brief** `docs/changes/ask7-style-provenance-spec/BRIEF.md:61-76` — it is normative guidance built on a non-recursive grep; (2) **REVISE `docs/changes/markup-autoawait-all-emitters/BRIEF.md` BEFORE dispatch** — as written it cannot fix the server-fn case; (3) **BANK + severity-call the routed `@session`-unlowered defect** (client-supplied body field read as identity, in a green conformance case). · dpa-010 · dpa-011 (advisory, meta/flogence-domain — ratify-or-defer). **dpa-017 RATIFIED S230** (HYBRID B-floor; SPEC §14.8.9 + codes + insight landed) → residual is the **FLOOR BUILD** (slot to an sPA). **Everything else is ratified / routed / deferred → the residual is BUILDS, not gates.** Highest-leverage residual builds = **the protect-leak floor** (`docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md`) + **`g-tier1-ssr-prerender`** (its SSR boundary MUST apply the same §14.8.9 egress filter — they compose; survey-scoped S229, ruling-gated; the §52 write-back was RETRACTED S194, NOT the residual).

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

`status: complete` · **COMPLETE dPA 2026-08-05 (ADVISORY)** → DD written, staged insight CANDIDATE, **NOT ratified**. **5-pole LIVE poll** (elm · solid-signals · xstate · type-systems-refinement · simplicity-defender) fired directly from a flogence-rooted orchestrator — no synthesis degradation, the dpa-017 caveat did not recur. All S322 grounding re-verified BY EXECUTION (14 fixtures); one claim REFUTED. [was: banked S322-bryan (2026-08-05)]

### Verdict (dPA, 2026-08-05 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/markup-as-state-kind-not-value-type-2026-08-05.md`

**One-liner:** The premise never failed to land — it landed in the COMPILER and in NAME RESOLUTION (SPEC's own **"state-as-primary unification"**, Phase P1 2026-04-30; `type-system.ts:1035` `tState`: *"HTML elements are pre-defined state types"*) and never propagated to §1.4/L1/PRIMER, so the reframe is a **RECONCILIATION (inert, prose-only), not an amendment** — with exactly ONE real mechanism gap: the lifecycle read detector is a **dot-requiring regex** (`:24635`/`:25808`) with no whole-cell read production, and since markup's only read idiom is `${@badge}`, the tracker is a no-op on markup **100% of the time**. The whole of Fork 3 is gated on that one regex.

**Forks:** (1) **writable markup cell — REJECTION SURVIVES, with a stronger rationale than S279 gave it**: 4/5 poles independently converged that a writable markup cell holds a *rendered instance* (a live side-effect with an ownership/disposal boundary), not state; the state model correctly refuses it. Store the **producer/discriminant**, never the instance — Solid's `<Dynamic component=>` proves sufficiency; storing JSX in a signal leaks orphaned computations (no owner on the stack in an event handler). (2) **five doors ARE state entry points** — the Elm pole mapped 4/5 onto TEA constructs unprompted, and `E-CELL-RENDER-SPEC-NOT-BINDABLE`'s *"the cell holds the element's VALUE"* is an **admission** (Elm writes the same thing as `draft : String`), not doctrine; §1.4's transport framing is the value-reading artifact. They are exhaustive over markup ENTRY, **not** over markup absence. (3) **lifecycle/reset/default** — `reset()` is **restore, not transition** (XState line), so it is a uniform cell op and a provable no-op on pure-projection markup — not a gap; `(A to B)` on markup is incoherent as an *independent* transition (markup is a projection, not an actor — giving it engine machinery invites the **shadow-state-fork**); the ONE real hole is **markup absence at the snippet-prop door** (`snippet?` = steady-state optionality, which is stateless — "and back" is exactly what optionality cannot express).

**Grounding re-verification:** claims 1–3 CONFIRMED (`E-CELL-RENDER-SPEC-NOT-BINDABLE` fires verbatim; markup gets START-only; `reset()` compiles on any derived cell). **Claim 4 REFUTED — there is NO wrong-cell reset bug**: `_scrml_reset(_scrml_cs_key(n)…)` is the generic runtime **helper definition** emitted into every file; the call sites are correct and cell-specific (`_scrml_cs_reset("badge")` vs `_scrml_cs_reset("dbl")`). **Close it.** **Claim 5 — the `(not to markup)` "reach" is NOT reach**: `markup` is absent from `BUILTIN_TYPES`; the annotation compiles only because `isUnrecognizedTypeNameAtom:5195` gates on a **capitalization proxy** — `(not to zzyzx)` compiles identically and both print `(not to asIs)`, while `(not to Markup)`/`(not to Zzyzx)` correctly fire `E-TYPE-UNKNOWN-NAME`. A typo-class hole that **manufactures phantom language features** — it manufactured this item's own Fork-3 premise.

**⚠ Stale citation, do not propagate:** `tState`'s comment cites **§35.1** for the premise, but **§35 is now `lin`**. The claim is corroborated independently (§4.3/§15.15.6 registry, `isHtml`/`rendersToDom`) but §35.1 is NOT its home. Finding a real home is part of the reconciliation (OQ-1).

**Ship (inert, prose-only — every pole incl. the conservative counterweight endorses):** re-word §1.4 + the five-door table as **state entry points**, teach markup-as-state-kind first in PRIMER §2/§4, replace the S279 "redundant sixth door" rationale and the `E-CELL-RENDER-SPEC-NOT-BINDABLE` message with the ownership/disposal argument, fix the stale `tState` citation. **DO NOT SHIP (one-way door):** the writable markup cell. **File as compiler defect (HIGH, independent of this ruling):** replace the `:5195` capitalization proxy with the enumerated set, THEN reserve `markup` in `BUILTIN_TYPES` (order is load-bearing) — diagnostics-only, zero codegen delta, blast radius measurable and unmeasured (§8: assumed-zero ≠ measured-zero). **ROUTED BACK AS A GENUINE FORK (deliberately not decided):** the whole-cell read-set extension — sound and moves the analysis fail-open → fail-closed, but newly-rejecting and needs 3 carve-outs (alias PROPAGATES not fires · discrimination positions exempt · write/transition spans excluded, precedent `:24808`).

**Through-line (shared with dpa-023): NOT supported by the markup half.** The five doors are not plumbing around a mismodelled value — the mismodelling was **in the canon, not the mechanism**. That is a documentation-divergence story with a materially cheaper fix. `simplicity-defender`'s promotion test (falsifiable "plumbing" definition · a PROSPECTIVE application · a counter-example category) is recorded and not met. **Do not ratify the through-line on this DD's evidence.** The async half may carry it on its own mechanism — that is dpa-023's to determine.

**Dissent recorded:** `simplicity-defender` — *"symmetry argument… the seductive-and-unreliable shape"* (C++ `operator<<`, SQL NULL three-valued logic, Scala `AnyVal`/`AnyRef`), and the procedural objection that persistent non-adoption is equally consistent with implementers correctly rejecting the CONCLUSION while the vocabulary passed unremarked. **Partly defeated by the headline finding** (the vocabulary did not pass unremarked — it landed under a named unification phase), and notably this DD's Fork-1 conclusion **agrees** with its bottom line.

**OQs:** normative home for the premise sentence · tag-indexing for a spellable `markup` · whether the snippet-prop presence gap is worth closing · measured blast radius of the `:5195` fix · whether the read-set extension changes dpa-023's answers. **Routes to scrml PA. RUN-not-RATIFY honored.**
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

`status: complete` · **COMPLETE dPA 2026-08-05 (ADVISORY)** → DD written, staged insight CANDIDATE, **NOT ratified**. **5-pole LIVE poll** (elm · xstate · react-trpc · type-systems-refinement · simplicity-defender), no synthesis degradation. Verified BY EXECUTION (7 fixtures compiled + 3 emitted-shape programs RUN). **⚠ RE-RULING REQUESTED on the LIVE S322 option-C ruling — see below.** [was: banked S322-bryan (2026-08-05)]

### Verdict (dPA, 2026-08-05 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/async-boundary-as-state-lifecycle-2026-08-05.md`

**One-liner:** **COMPLEMENT, not subsume — the frame is RIGHT and the implementation is missing its middle state.** A `(not to T)` cell has THREE states (`not → pending → T`) and the compiler models TWO; the assignment illegally jumps 1→3. Add the rung and the annotation becomes the sound developer-visible CONTRACT, with auto-await demoted to its mere LOWERING. bryan's instinct that discrimination is the load-bearing half is **vindicated by the fix**: discrimination is also where the `await` belongs, because observing presence is only sound if you waited.

**The mechanism (verified in source, and worse than a type mismatch):** `type-system.ts:25865` `classifyWriteAgainstSpec(initText: string, spec)` → `const t = initText.trim(); if (spec.kind === "presence") return t === "not" ? "pre" : "post"`. **It is a SOURCE-TEXT comparison — the classifier never consults the type at all**, and its return type `"pre"|"post"|null` has no third state to return. Any RHS whose text isn't literally `not` → `post`. Duplicated at `:26799`. **The whole bug is two lines.**

**Measured — the queue item's central claim is FALSE:** the stale-read is NOT "caught by machinery that shipped at S130." B3 (**the queue's own canonical form**, `<rows>: (not to number[]) = loadUsers()` + `@rows.length`, no `given`) **compiles CLEAN** — the annotation is vacuous and the `given` in the example guards nothing. B2/B6 likewise. Control B5 (`= not` initializer) fires E-TYPE-001, so the machinery is live. **Proven by EXECUTION it is not a stale read but a hard `TypeError`** (cell inits to `null`); the `.catch(_scrml_error_boundary_log)` is on the IIFE while the throw is in the HOST, so **§19.6 containment does not cover the failure the pattern creates**; and the sync onclick host (`function(event){ _scrml_f_5(); }`) doesn't await, so the rejection is UNHANDLED.

**⚠ SECOND HEADLINE — scrml did NOT eliminate function coloring; it RELOCATED it to the emitter.** `emit-library-shared.ts:196-200` `computeAsyncFnNames` is a transitive closure — *"Fixpoint — a fn that STRUCTURALLY calls any async fn becomes async"* — and the file header names it *"the shared **async-coloring** machinery"* (`:4`, `:22` "colorless-async", `:42` "async-colored"). **scrml has virality WITHOUT the error**: it computes the color, pays for it (incl. the `map`/`mapAsync` tax in `async-combinators.ts`), then tells neither the checker nor the developer. **This amends the S322 diagnosis** — scrml discards only the VISIBLE half. **Zig prior-art warning:** same architecture (backend-inferred colorlessness), broke on indirect calls/frame-size, needed `@asyncCall`, **pulled from the language in 0.11**. scrml's same blind spot is `indirect-callee-resolver.ts`.

**Sub-qs:** (1) **covers ONE of six injector positions**, and fails twice independently — Failure A the assignment collapses the transition (position-INdependent, so it doesn't even cover the binding position the item conceded); Failure B the read-detectors are dot-requiring regexes (`:24635`/`:25808`), blind to whole-cell reads (carried from dpa-022). Analysis fails OPEN throughout. (2) **the marker is SUGAR** over the checked rule (`wait f()` ≡ a `given` with no body) and worth keeping — it makes the time-shape visible (13,504 IIFEs emitted, **ZERO** in 1,878 sources) — but **two conditions are load-bearing:** drop the "does not color the function" pitch (**false** — computeAsyncFnNames colors it today; say "you never WRITE the color, and the error lands at the discharge site not on N callers"), and **the rule must be `E-`, NOT `I-`** — the `I-MATCH-PROMOTABLE` precedent licenses the SHAPE but not the SEVERITY (those promote correct-but-unidiomatic code; a missing `wait` reads `null` and throws, so an `I-` would encode today's silent leak as deliberate policy = strictly worse than the accident). (3) **§13.2 SURVIVES as the contract and is currently VIOLATED** — mandate 1 (await at every call site) is violated at the statement position (the await lives inside a fire-and-forget IIFE), mandate 3 (flat sync-looking code) is violated (it crashes), **no `Promise.all` is emitted anywhere**. Per pa-base §8 the fix is **toward-the-contract conformance restoration — quote the sentence and ship**, NOT a widening.

**⚠ RE-RULING REQUESTED — LIVE S322 option C (await the IIFE + keep its `.catch`), NOT YET BUILT. Two counts, both MEASURED:** (1) **naive C breaks §13.2 mandate 4** — independent calls emit as separate fire-and-forget IIFEs that today run CONCURRENTLY only because nothing is awaited; awaiting each in place SERIALIZES them: measured **today ~100ms concurrent · naive C 202ms SERIALIZED · join-C 101ms parallel-preserved**. C should be ruled *"await the dependency-aware JOIN of the independent group"*, not "await the IIFE." (2) **the sub-question bryan did NOT rule is answered by execution** — keeping the `.catch` WITHOUT suppressing the continuation leaves the **identical `TypeError` on the error path** (`[boundary] contained rows: network down` → `THREW: TypeError`), i.e. the bug moves from "always" to "whenever the network fails," which is strictly harder to find; suppressing exits cleanly. **Recommended form: await the dependency-aware join · keep the `.catch` · suppress the dependent continuation.** Routed back explicitly, NOT silently reinterpreted.

**Ship FIRST (the subtraction, simplicity-defender + verified):** collapse the three disagreeing async predicates + the regex-over-emitted-text `.catch` decision (GITI-001 absorb = `clientCode.replace(combinedRegex,…)` in `post-server-fn-iife-wrap`, `emit-client.ts:2969` — **§19.6 containment IS decided by a string rewrite over the compiler's own output, confirmed**) into ONE ground truth. **Happy convergence: that ground truth already exists as `computeAsyncFnNames` — hoist it from codegen into the checker and add one consumer. The subtraction and the three-state fix are the SAME move.** Plus two rules that make the existing inference sound: **fail-CLOSED at call-graph blind spots** + **check the sync boundary** (precedent: `c5e0948 fix(leasing): blind-call fail-close`).

**Panel: 5/5 CONVERGENT on the missing rung**, in five vocabularies (elm `Loading`/4-state RemoteData · xstate ≥3 states + 2 temporally-disjoint events · react-trpc `T|undefined` on the wrapper · type-pole `pending` · simplicity-defender "extend the existing phase discrimination"). **The only genuine split is OQ-2: engine surface vs lifecycle surface** for the third state — xstate argues engine (and names the gap: an invoked-async-actor primitive, `invoke` + `onDone`/`onError`), type-pole argues lifecycle (needs no new surface). **PA's call.** **All five also amend the S322 diagnosis on the disease:** elm — *"the keyword was never the disease, inline-result-binding was"*; react-trpc — *"there's no third option that keeps both 'no visible await' and 'no invisible staleness'"*. scrml removed the ALARM and kept the HAZARD.

**OQ-1 ANSWERED — virality is NOT essential.** It decomposes into three independent encoding choices; the decisive one nobody names is **escapes-vs-must-discharge-locally**. Async/await's real sin is that *"forgot to await" is a well-typed program* because `Promise<T>` is first-class. Make the in-flight value NON-ESCAPING and soundness + locality come from one mechanism: **a value that cannot appear in a signature cannot color one.** Honest residual: ~142 sites (already silently broken) become visible compile errors — the existing backlog surfacing, not new breakage.

**Through-line: 1-for-2, do NOT ratify as a general diagnostic.** SUPPORTED here (an async result IS a state with a lifecycle; the injector IS plumbing for an incomplete state model) but NOT on the markup half (dpa-022: the mismodelling was in the CANON, not the mechanism). A claim holding on one of the two cases that generated it is the N=1 it was accused of being.

**⚠ Correction discipline:** this artifact's FIRST CUT reached the OPPOSITE verdict ("orthogonal — neither subsume nor complement") and was revised when the 5th pole returned with disconfirming source. The revision is recorded IN-LINE, not silently overwritten. **PA: read the revision note before the verdict.** **Routes to scrml PA. RUN-not-RATIFY honored.**

---

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

---



## dpa-028 — Offline / PWA: does scrml grow a NATIVE offline story (SW + Cache-API shell + manifest + write-queue/replay), or is that the host-JS boundary by design? (adopter #509)

```
id:        dpa-028
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-15 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified.
rung:      R2 (a direction ruling — bryan rules; adopter-driven, the exact class the S322 freeze-pause exists for)
requested: adopter issue #509 (2026-08-11, 0 comments for 4 days across three boots) — banked S346-bryan; factual ack posted on the issue S346
routes-to: scrml PA → the RETURN LEG is a comment on #509 (S310 return-leg rule)
```

### Verdict (dPA, 2026-08-15 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/offline-pwa-native-vs-host-boundary-dpa-028-2026-08-15.md`

**One-liner:** **The 2026-07-05 "clear skip" was about CRDT-class SYNC and was DEFER-for-now, not permanent** — row 13 verbatim: *"Hand-roll local cache + mutation queue + conflict resolution … VERY HIGH (CRDT/conflict resolution) … QUESTIONABLE for server-rendered whole-stack … DEFER"*; bullet: *"deliberate non-goal **for now**, not an oversight"*; the words service worker / PWA / manifest / Cache API / cold boot appear **NOWHERE** in that DD → the adopter's cold-boot question is NEW, correctly R2. **⚑ Fork (a) "host boundary by design" is NOT AVAILABLE as written**: no static/public asset dir; `scrml dev` and `_server.js` both serve `dist/`; nothing copies user files in; no `Service-Worker-Allowed`; `/sw.js` must be hand-dropped after every build — **5/5 voices: a static-asset floor is scrml's job and a PREREQUISITE under every fork.** **The DATA half is expressible in native scrml TODAY**: an adopter-shaped queue/replay program (`when @queue changes { localStorage… }`, `when @online changes { flush() }`, `on mount { navigator.onLine … }`, server fn with `INSERT … ON CONFLICT(client_id) DO NOTHING`) **COMPILED GREEN first try**, no foreign code — and stays USERLAND under every fork (0 of 4 build-graph owners ship a write-queue; Angular closed it "not planned"; Background Sync is Chromium-only). **⚑ Separable emitter DEFECT** found by compiling it: `flush()` clears `@queue` synchronously while each server call is a fire-and-forget IIFE → a failed replay silently drops the row (the dpa-020/dpa-023 async class; htmx: *"the client becomes authoritative over 'sent' … a bug to fix (await before dequeue), not evidence the model is wrong"*). **Panel 4–1**: (c) a `scrml generate pwa` scaffold (pwa-architecture · qwik [a flip vote against its compiler-owns-it default] · nextjs [after the floor] · htmx [with condition]) vs (a′) floor + doc recipe + readable `chunks.json` (simplicity, adversarial); **ALL agree**: worker CODE adopter-owned, precache DATA content-hashed from the build graph (`chunks.json` already IS the list — *"scrml is already standing where Qwik retreated TO"*), single-owner artifacts (the pwa voice's regenerate-inside-`sw.js` = *"Hickey's braid"* → rejected; a scaffold must be one-shot like `generate auth`, ZERO per-build participation, *"if that discipline can't hold, it's (b)"*), and **never an offline route RENDERER** (only the shell + last-known server-rendered snapshots may be precached). **(b) 0/5** — Flutter web EMITTED the SW then WITHDREW (*"sends the message that it is necessary or recommended … not the case"*), Qwik City retreated to `modulepreload` (a SW *"cannot be un-shipped in one release"*); Angular/Blazor still emit; SvelteKit exposes data only. **Q3: no 6nz pattern** (README:419 = planned state; gap filed S346). Adopter's ~150 lines are NOT a throwaway under any ruling (~40 absorbed under (c); ~110 stay theirs).

**Bycatch:** `_scrml_effect` runs `when @online changes` once eagerly at registration (`flush()` at boot — spec-intent to confirm) · PRIMER has 0 `when @` / 0 `localStorage` entries · a `_{ navigator.onLine }` block in a client fn escalates the fn to the server where `navigator.onLine` is `undefined` and the client continuation reads an unbound local (documented §23.2.4, footgun-shaped) · SPEC §40.3.4 says `handle()` applies to statically-served assets; the emit reaches it only on matched routes. Anti-goals honored: primitive not designed; NOT ratified; Q1/Q2 not answered on the issue.


### The question (the adopter's, verbatim-shaped)
Field crews in mountain dead-zones must capture time/hours/miles + maintenance logs OFFLINE and sync on
signal. Their design is deliberately thin: append-only per person (no CRDT), a `client_id` UUID +
UNIQUE column for idempotent replay through existing server-fns, `localStorage` persistence via
`when @var changes` (native today), and the §20.8 persistent shell to precache. **The one piece with
no native story is the COLD OFFLINE BOOT: service-worker + Cache-API shell + manifest so the app loads
with zero network.** They ask: (1) is native offline something scrml could/should grow, or is
SW/manifest/static-asset serving the intended host-JS boundary an app owns? (2) was the 2026-07-05
BaaS-parity "clear skip" of offline-sync a permanent design call or a deprioritisation? (3) is there a
6nz pattern to copy? They will bridge with ~150 lines of quarantined host-JS if needed and rip it out
when a native story lands — so the ruling decides whether they build a throwaway.

### Facts established S346 (do NOT re-derive)
- **Compiler surface: NONE.** `grep -rl 'serviceWorker|manifest.json|caches.open' compiler/src` → 0;
  SPEC has no offline/PWA/service-worker section (SPEC-INDEX grep → 0). §20.8's persistent shell is the
  nearest primitive and it is a NAV shell, not a cache shell.
- **6nz: no pattern to point at.** `../6nz` holds 11 playground `.scrml` files; its `master-list.md`
  lists "Performance + PWA architecture spec — authored before scaffolding" UNCHECKED; grep for
  SW/manifest → nothing. README.md:419's "written entirely in scrml … offline-first PWA" describes
  PLANNED state — filed `g-readme-6nz-claim-describes-planned-state-as-built` (LOW).
- **The 2026-07-05 BaaS-parity "clear skip"** (`baas-parity-worth-it-2026-07-05.md`) — the DD must
  quote its stated REASON for skipping offline-sync (was it "not our layer" or "not now"?); the answer
  to the adopter's Q2 is that sentence, and it decides the rung.
- **What IS native today and relevant:** `when @var changes` + `localStorage` (their persistence half);
  server-fn idempotency via their UNIQUE-column design; §20.8 shell composition (#124/#215).

### The fork (surface LIMIT first — FORK RULE row 1)
(a) **Host-boundary by design** — SW/manifest/Cache-API are platform primitives an app declares as
static assets; scrml owns the DATA half (write-queue semantics could ride existing state primitives)
and stays out of the shell-cache half. Cheapest, no new surface; the adopter's ~150 lines are the
intended answer, and the doc says so.
(b) **Native offline as a `<program>` mode / attribute** (e.g. an `offline=` declaration that emits SW +
manifest + a precache list from the §20.8 shell + a replay queue over server-fns) — a widening;
possibly the "best expression of the intent" for a whole-stack compiler ("scrml IS the backend" — an
app that cannot boot without the backend is a gap in that claim). Cost: a real arc.
(c) A middle: emit the SW/manifest SCAFFOLD (`scrml generate pwa`, §"scrml generate" catalog exists) as
adopter-owned files, keep the semantics host-JS. Tooling, not language.

### Evidence the DD owes
The 2026-07-05 skip's stated reason, verbatim · what Qwik/Next/SvelteKit/Astro ship for PWA (adapter
vs core) · whether the write-queue/replay half is expressible in scrml state primitives TODAY (a
worked adopter-shaped example) · the cold-boot half's minimal emitted surface if (b)/(c).

### Anti-goals
Do NOT design the primitive; do NOT ratify. Do NOT answer Q1/Q2 on the issue — bryan does.

### Report-back
§3 — one-liner + artifact path + `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`.
Routes to scrml PA, whose return leg is a comment on #509.


## dpa-029 — Enterprise document workflows (PDF / print / email / file-upload): which of the four host-escapes become NATIVE, and does document egress come inside the protect/tenant envelope? (adopter #471)

```
id:        dpa-029
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-15 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified.
rung:      R2 (direction + a SECURITY-envelope question; bryan rules; adopter-driven)
requested: adopter issue #471 (2026-08-08, 0 comments for 7 days across three+ boots) — banked S346-bryan; factual ack posted on the issue S346
routes-to: scrml PA → return leg = a comment on #471
```

### Verdict (dPA, 2026-08-15 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/document-workflows-egress-envelope-dpa-029-2026-08-15.md`

**One-liner:** **★★ LIVE LEAK, runtime-proven, against the RATIFIED dpa-017 floor** — a `handle()` body that SELECTs a `protect="passwordHash"` row and returns `new globalThis.Response(JSON.stringify(u))` **compiles CLEAN** (3 infos, NO E-PROTECT-004) and ships **`200 {"id":1,"name":"alice","passwordHash":"SECRET-HASH-XYZ"}`** while the normal server-fn route returns `{"id":1,"name":"alice"}`. Three defects compose: `Response`/`Request`/`Headers`/`Blob`/`File`/`FormData` are NOT on `LOGIC_SCOPE_GLOBAL_ALLOWLIST` (**the SPEC's OWN §40.3.5 `handle()` example fails E-SCOPE-001**) but `globalThis` IS and the walker checks only the leftmost base; the "fail-closed" E-PROTECT-004 gate as BUILT is a per-function-body SOURCE-TEXT co-occurrence regex over four spellings (`protect-egress.ts:274-303`) — silent on `globalThis.Response`, on helper indirection (measured), on string/CSV bodies, and suppressed wholesale by any `.reveal(` (*"a lint mislabeled as a fail-closed gate, and the mislabelling is the worse defect"* — IFC); the runtime redactor BEGINS `if (value instanceof Response) return value;` (*"Not a missing sink — a fail-OPEN default at an existing one"* — reference-monitor). **dpa-017 (RATIFIED S230) rules "raw/FFI egress fail-closed" and "field-level `reveal("col")` = sole declassification" — the build honours neither** (`.reveal(` is whole-body, all columns). **→ 7/7 on SEQUENCE: DEFECT tickets FIRST, no ruling needed** — deny-unless-revealed at the emitted wrapper (request-scoped taint bit; blast radius on legitimate `handle()` bodies UNMEASURED — say so), `reveal("col")`, allowlist the Bun HTTP vocabulary WITH member-chain walking (closes the bypass), regex → lint or transitive-closure scope, emit or strike E-MW-003/004, reconcile §40.3.4 with the emit. **Direction after:** **Q1** 4–2 for a typed compiler-serialized `Egress<Bytes>` return ("same sink, second ENCODING"; `Bytes` uninhabitable from `Row<P≠{}>` without `.reveal()`; Hono's `c.body()`) vs (a) document `handle()` — **framed honestly as the dpa-002 (S216) raw-route REOPEN**, and its confidentiality story must sit at the document builder's INPUT (a PDF cannot be redacted at the bytes); simplicity's dissent stands as a sequencing claim: *"the ruling must not add a second egress envelope while the first one is provably unsound."* **Q3** 5/7 for a `File`/multipart PARAMETER on the SAME server-fn/`<endpoint>` contract (a coeffect: endorse size/mime, never declassify), not an `<upload>` element — and **the `handle()` + `request.formData()` path the S346 ack pointed the adopter to is RUNTIME-BROKEN** (compiles clean, no await inserted for the host promise → `TypeError`; *"a boundary you cannot cross because the door was never built is a bug"*; *"green-compile-then-crash on the sanctioned path is the failure mode that costs trust"*). **Q4** (a) 4/7 — NOT one seam away (the §52.8 renderer is a compile-time per-`<each>` emitter over a conservative subset; a whole-markup `render()` is a NEW sink + a declassification of §12.5.3): *"a route already IS a server-rendered document — print it"*. **Q5** (adopter's 5th, omitted from the bank) adapter via `scrml:http`/`_{}` — 7/7 — and **the §23.4 `use foreign:` sidecar is Nominal (E-FOREIGN-SIDECAR-NOMINAL)**, so the ack's "vendor via the .js sidecar" needs correcting (vendoring today = inline `_{}` / `vendor:`; PDF-lib vendor fixture not compiled — flagged).

**Adopter today (7/7):** treat `handle()` as OUTSIDE the protect/tenant envelope; never issue a protected-column query in `handle()` or its callees; project in a dedicated server fn; do NOT rely on E-PROTECT-004 (it did not fire on a live leak); do NOT use `handle()`+`request.formData()`; uploads via `_{}` + `Bun.write`; print an authenticated route for PDF. **Second runtime defect (q2h):** a `handle()`→server-fn call is emitted bare → `ReferenceError` (cf. closed #1 for fn→fn). Anti-goals honored: nothing built; §61's thin-envelope ruling extended-or-not, not re-opened; NOT ratified.


### The four questions (the adopter surveyed the source first — their reading, with S346 verification)
1. **Response envelope is JSON-locked.** A server fn / `<endpoint>` returns JSON only; `return new
   Response(...)` in a server fn is `E-SCOPE-001`; `<endpoint>` forces `application/json` (§61.5). The
   only binary/`Content-Disposition` path is `handle()` returning a raw Bun `Response`.
   **VERIFIED S346 by execution:** `function pdf(id) { … return new Response("%PDF-1.4", {headers:{…}}) }`
   → `E-SCOPE-001: Undeclared identifier Response`. → *Is a non-JSON / chosen-Content-Type response
   path from a server fn or `<endpoint>` on the roadmap, or is `handle()` the long-term answer?*
2. **`handle()` is OUTSIDE the tenant/`protect=` egress guarantees** (`E-PROTECT-004` /
   `E-TENANT-RAW-EGRESS` — SPEC §14.8.9/§14.8.10 fail-closed gates name `handle()` as the
   compiler-unanalyzable egress). Every document/email path must ride `handle()`, so the delivery
   layer cannot inherit scrml's data-protection invariants — a real concern for multi-tenant
   customer-facing docs. → *Native, or enforce redaction ourselves?*
3. **No inbound multipart / file-upload parser.** `<endpoint accepts=:enum>` decodes JSON only; uploads
   need `handle()` + `request.formData()` (host Bun). Also blocks a native attachment-storage story.
   → *Native inbound-upload primitive planned, or host-escape by design?*
4. **Document generation (HTML→PDF) + templating.** No `renderToString`; `format` is data-only; they'd
   vendor a PDF lib via the `.js` sidecar. → *Fine as a vendored lib, or is server HTML render coming?*
   (Note: §52.15 SSR prerender EXISTS server-side — the DD checks whether a server-side render-to-string
   of a markup value is already reachable or one seam away.)

### What is already established — do NOT re-derive
- §61 `<endpoint>` is deliberately THIN (LIMIT-PRIMITIVES, §61.5 envelope; JSON-RPC-not-baked-in).
- §60/§61 both say client-codegen SKIP for foreign wires; `handle()` (§40) is the sanctioned raw escape.
- The auth-scoped confidentiality architecture (S256 ratified): THREE colocated mechanisms + ONE
  compile-time `EgressSink × ConfidentialityAxis` coverage TYPE — **complete mediation without a
  god-object.** Question 2 is exactly "is `handle()`-with-a-binary-body a fourth EgressSink the type
  should cover?" — the ratified architecture has a place for it; the DD should say whether it fits.
- §23 `_{}` foreign code + the `.js` sidecar (§23.4) exist for vendoring.

### The forks (each: LIMIT vs WIDEN, surfaced first)
Q1: (a) `handle()` is the answer, document it · (b) a typed binary/`Content-Type` return form for
server fns / `<endpoint>` (a `Response`-shaped return type the compiler can still route through the
egress redactor). Q2: (a) adopters redact themselves in `handle()` · (b) `handle()` becomes a
covered EgressSink for the protect/tenant floors (structural-redaction of any row-shaped value that
reaches it; binary bodies pass). Q3: (a) host-escape by design · (b) `<endpoint accepts=… body=multipart>`
or a `<upload>` primitive. Q4: (a) vendored lib · (b) expose the SSR renderer as a server-side
`render(markup) -> string`.

### Evidence the DD owes
Per question: the governing sentence (or "searched §X, §Y — none"); the smallest change that answers
it; whether it widens; what the adopter loses if the answer is (a). Q2 gets the security lens: name
what a `handle()`-body leak looks like today (worked example) and whether the coverage TYPE can express
the new sink without a god-object.

### Anti-goals
Do NOT build; do NOT ratify; do NOT re-open §61's thin-envelope ruling as if unruled — extend it or not.

### Report-back
§3 — one-liner + artifact path + `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`.
Routes to scrml PA, whose return leg is a comment on #471.


## dpa-027 — Presence-match arm vocabulary: §18.8.2 says `.Some(v)`/`.None`, the compiler implements `not :>`/`given x :>` — which is canonical? (NARROW; R1→R2)

```
id:        dpa-027
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-15 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified.
rung:      R1 (PA lean recorded) — R2 if the DD finds the .Some/.None text has a ruling behind it
requested: bryan, S345 (owed filing (d), banked S346 after the PA split it — the other half is a BUG, `g-lifecycle-return-match-fires-e-type-024`)
routes-to: scrml PA
```

### Verdict (dPA, 2026-08-15 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/presence-match-arm-vocabulary-dpa-027-2026-08-15.md`

**One-liner:** **R1 HOLDS — there is no ruling behind `.Some/.None`; there is a REJECT.** Provenance (git -S across scrml + the frozen scrml8 archive): drafted 2026-03-27 in the §18 rewrite as `::Some/::None` → the same day's language-design review flagged it **R-18-006 BLOCKING** (*"undefined constructs … not defined in §14.3, §14.4, or any other section … a developer could legitimately declare `type Option:enum = { Some(value:T) None }`"*) → the repair REMOVED it (re-review: *"the `::Some` / `::None` removal is complete. No magic names are introduced"*, and warned the `spec-updates-§18` changelog still carried it) → **`549e5b3` 2026-03-28 "Reconstruct SPEC.md from update docs after truncation" replayed that changelog and REINSTATED the rejected draft** → mechanical passes (`::`→`.` s38, `null`→`not` s62, `=>`→`:>` S148) → the S154 enum-subset DD took it at face value and cited it into **§53.15 :33812** → an S19 fixture (`phase2-match-optional-039.scrml`, expected clean) was authored from it and **has failed E-MATCH-012 in every sweep since**. `not` (S38, *"instead of nothing i like not"*) + `given` (2026-04-07 full replacement) landed in §42 with user voice; **0** compiler code paths recognise `.Some`/`.None`; 0 user statements on Some/None/Option anywhere. **3/3 LIVE voices (type-systems · elm · simplicity-adversarial) → (a) STRIKE**, with two corrections to the PA's lean: (i) striking leaves **TWO** vocabularies (predicate `is some`/`is not` + arm `given`/`not`) — "the minimum defensible move, not full consolidation"; (ii) the worst dangling citation is **E-MATCH-012's own message** (`type-system.ts:17253`), which prescribes the DEPRECATED `not => …` — "a compiler error teaching rejected syntax is the worst dangling citation of the three" (PRIMER:616 same). Type-theoretic reason (sharper than the archaeology): `T | not` is an idempotent UNTAGGED union (`T | not | not = T | not`); `.Some/.None` is constructor elimination over a TAGGED sum — they agree at one nesting level only, `.Some(value)` is strictly COARSER over `A | B | not`, and `.Some` would be scrml's only undeclarable, unshadowable constructor (name-resolution hazard when `T` is a user enum with a `Some` member — R-18-006 restated as soundness). Option (b) aliases: 3/3 reject ("a false Maybe-shaped API surface … worse than no sugar at all"). Honest adopter cost of (a): non-parallel arms / no visible unwrap → answer with a worked example, not a second grammar.

**Follow-ups (a) requires:** strike §18.8.2 :13007-13037 + cross-ref §42.2.3/§14.12.6.1 (record the reason as "REJECTED 2026-03-27, reinstated by reconstruction", not "limit wins") · retarget §53.15 :33812 · fix E-MATCH-012 message `=>`→`:>` (+ PRIMER:616-620) · rewrite/retire the failing fixture · add the three-ways worked example. **Method note:** reconstruction is a laundering vector (draft → changelog → reconstruction → citation → fixture) — diff a reconstructed section against its last review verdict. Anti-goal honored: `E-TYPE-024` lifecycle-return defect untouched; NOT ratified.


### The question

Two normative sections give two different arm vocabularies for discriminating a `T | not` value in a
`match`, and the compiler implements exactly one of them:

- **§18.8.2** ("Match over Union Types (`A | B | not`)"), verbatim: *"Optional match: For a value of
  type `T | not`: `.Some(value)` matches the present case and binds the unwrapped value as `value` with
  type `T`. `.None` matches the `not` case."* — with a worked example `match val { .Some(s) :> … .None :> … }`.
- **§14.12.6.1** (form 3) + **§42.2.3**: `match u { not :> handleAbsence()  given u :> { … u.name … } }`.

**Executed S346 at `f6883b26`** (reproducers in the S346 scratchpad `dpa027/`; shapes below are enough
to re-derive): over a PLAIN union `let u: User | not` (and `fn -> User | not`):
- `not :>` / `given u :>` arms → **compiles clean**.
- `.Some(v)` / `.None` arms → **`E-MATCH-012`** ("lacks a `not` arm") **+ `E-TYPE-006`** ("missing
  members: struct") — the `.Some`/`.None` spelling is not recognised at all.
So the §18.8.2 optional-match prose describes a form the compiler has never accepted; the live form is
§42's `not`/`given`.

### What is already established — do NOT re-derive
- `not` is scrml's SOLE absence value (S89 ruling, §42.1); `null`/`undefined` do not exist; there are
  no generics (`Option<T>` is not a scrml type). `Some`/`None` are not declared anywhere as scrml enum
  variants — `.Some(value)` is an Option-type idiom borrowed from elsewhere.
- `given x :>` is the ratified narrow-to-present form (§42.2.3, S135 cluster N).
- The compiler's `E-MATCH-012` message itself prescribes the `not => …` arm — the implementation and its
  own diagnostic agree on the `not`/`given` vocabulary.

### PA lean (FORK RULE row 1, LIMIT wins — recorded, not ruled)
(a) **Strike the `.Some(value)`/`.None` prose + example from §18.8.2 and cross-reference §42.2.3 /
§14.12.6.1 form 3 as THE optional-match form.** One vocabulary, the native one; nothing an adopter can
write today stops working (the struck form never compiled — measured); the compiler already agrees.
Rule 4b: the provenance of the §18.8.2 sentence being changed is UNKNOWN to the PA — the DD's first job
is `git log -S '.Some(value)' -- compiler/SPEC.md` + a user-voice sweep for `Some`/`None`/`Option`;
if a ruling put it there, this becomes R2 and bryan rules.
(b) implement `.Some/.None` as aliases — a WIDENING that adds a second spelling of the same
discrimination and a foreign idiom; disfavoured under limit-primitives-not-godify.
(c) something else.

### Anti-goals
Do NOT touch the lifecycle-return `E-TYPE-024` defect here (it is a bug with its own gap entry).
Do NOT ratify — RUN-not-RATIFY.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`.
Routes to scrml PA.


## dpa-026 — Is `tare` one keyword doing two jobs? (thunk vs capture, by position)

```
id:        dpa-026
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-15 (ADVISORY) → DD written, staged insight CANDIDATE, NOT ratified.
rung:      R2 minimum
requested: bryan, S337 (2026-08-10) — "a, and bank c as its own question"
routes-to: scrml PA
```

### Verdict (dPA, 2026-08-15 — ADVISORY, NOT ratified)
**Artifact:** `scrml-support/docs/deep-dives/tare-thunk-vs-capture-dpa-026-2026-08-15.md`

**One-liner:** **The SPEC's own "not expressible" sentence is FALSE by execution** — `const c = @x; tare(@x, c)` in a handler compiles clean on the branch and is a runtime SNAPSHOT (reset → the captured value, stable across later writes), and E-TARE-DEFERRED-POSITION's own message steers users to exactly that shape. **`reset` has ONE job** (both thunk registries populate only at module-init — verified in emitter + runtime + a compiled main fixture). **The calibration case is expressible TODAY, twice, with zero new syntax**, and the data pattern (`<zero>` cell + derived `net`; the tare button is `@zero = @raw`; `reset(@zero)` = factory) is the canonical answer in every paradigm polled (xstate: *"not a workaround, the canonical one"*; elm: *"D is the canonical answer, not a fallback"*). Corpus: 0 calibration-shaped usages; all 43 `reset(` are form/counter clears. **Panel: 4/5 fork 1 (nothing new), 1/5 fork 2 (a `capture(@x)` verb — solid-signals: the hidden `_scrml_default_fns` slot is "a hidden, writable, unobservable second reactive axis per cell"), 5/5 REJECT fork 3 (position-keyed semantics — "makes hoisting unsafe"; E-TARE-BEFORE-DECL is "scar tissue from this exact mistake once already"), 5/5 call the markup-handler hole a DEFECT** (bare `tare(@x)` in `onclick=` COMPILES CLEAN in both forms — call-ref → runtime `ReferenceError: tare is not defined`, expression → a live wrong-value promotion; the checks walk an 11-name field list = the dpa-025 class). The panel's one live split — bless Fixture A as closure semantics (xstate, type-systems) vs refuse it as an accident (elm, simplicity) — is BRIDGED by a CHECKABLE property, not a doc: the DG already knows every expression's cell-read-set → state `cellReads(e)=∅ ⟹ snapshot / ≠∅ ⟹ live` at each `tare` site and WARN on `tare(@x, @x)` (a no-op baseline). Prior art (web): every design that FUSED restore + re-baseline by argument presence (RHF, Formik, vee-validate) grew confusion issues; Angular kept `defaultValue` read-only + explicit `overwriteDefaultValue` after adopters asked for `setCurrentValuesAsDefault()` (the tare button); nobody keys on source position. **Reco: fork 1 patched — correct §6.8.4 BEFORE PR #501 merges; fix the diagnostic to point at D; ship the read-set diagnostic; close the markup hole as a defect; hold fork 2 in reserve; fork 4 (assignable slot) only if the baseline ever needs to be READ.**

**Bycatch:** the §34 E-TARE-BEFORE-DECL row on the branch still says a tare in a function body "is legal wherever written" (stale vs §6.8.4); the literal S337 quote "tare stores a thunk, keep the family coherent. go build it." has no standalone `>` user-voice block (only PA-attributed in BRIEF/SPEC/PR body). **Anti-goals honored:** the config-case thunk ruling not re-litigated (the prior art now supports it independently); `tare` not proposed for removal; NOT ratified.


### The question

`tare(@cell)` stores a THUNK evaluated at reset time (S337 ruling — coherent with `default=`, §6.8.1).
At module-init that is right. **In a deferred position it cannot express the motivating case at all.**

### What is already established — do NOT re-derive

- **Mechanism, PA-verified.** `_emitInitThunkSidecar` returns `null` inside function bodies
  **deliberately** (*"reassignments must not overwrite the declaration-site init-thunk"*), so a write in
  a function body / event handler registers NO init thunk. `_scrml_tare` promotes
  `_scrml_init_fns[name]` — still module-init's. Result: silent wrong baseline, or a permanent no-op if
  the cell is only ever written deferred.
- **Ruled S337 (a):** the bare form is RESTRICTED to module-init position; §6.8.4 corrected to stop
  blessing function bodies. So the language is honest today — the calibration case is simply
  inexpressible, not silently wrong.
- **The two-arg form does NOT rescue it.** `tare(@reading, @reading)` stores a thunk that re-reads at
  reset time → the current value, not the calibrated one. Making it work requires duplicating the
  calibration expression, which is the redundancy the primitive existed to remove.

### The question proper

**Is the runtime-capture case a real adopter need, and if so what serves it?**
1. **Nothing** — the honest null. `default=`/`tare` are declaration-time baselines by design; runtime
   re-baselining is a different concern the language should not grow a primitive for. Name the evidence
   under which this is right.
2. **A second form** — e.g. a capture verb distinct from `tare`, snapshot semantics, explicitly NOT in
   the `default=` family. Two keywords, two honest jobs. ⚠ Weigh against the near-synonym objection the
   language has used to reject additions before.
3. **`tare` widens by position** — thunk at module-init, capture when deferred. One keyword, two
   semantics keyed by where it appears. ⚠ Position-dependent semantics is the shape §6.8.4's own
   `E-TARE-BEFORE-DECL` exists because of; weigh carefully.
4. Something else.

### Evidence the DD owes
- **Is the calibration/re-baseline shape real in the corpus or the adopter clones?** Grep for the
  pattern (a cell written in a handler that a later `reset()` is expected to return to). If the count is
  zero, option 1 gets much stronger. ⚠ Remember the corpus-is-artifact kernel: zero occurrences may mean
  the form was never expressible, which is exactly the case here — so weigh adopter INTENT, not just counts.
- **What do sibling languages do** for runtime re-baselining of a resettable value?
- **Does `reset` have the same two-jobs problem?** It resolves default-then-init; ask whether the
  deferred-write case is coherent for it either.

### Anti-goals
Do NOT re-litigate the S337 thunk ruling on the config case — it was correct for what was known and is
still correct there. Do NOT propose removing `tare`. **Do NOT ratify** — RUN-not-RATIFY.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`.
Routes to scrml PA.


## dpa-025 — Are we missing a PRIMITIVE whose absence generates these bugs? (population-first)

```
id:        dpa-025
status:    ratified   # S338 (bryan: "a, and grep the compiler for source-text regexes"); reconciled S346 — table is the authority
rung:      R2 minimum; escalate to R3 if two or more candidate primitives survive and compete
requested: bryan, S337 (2026-08-10) — "add that to dpa-025 so i can run it"
routes-to: scrml PA
```

### The question, in bryan's framing

> *"if all the DDs we do basically say 'stay the course', then perhaps we need to look at the language
> and all of its bugs as a whole and ask. Are we missing a/some primitives or stdlib tools or whatever
> that would kill large swaths of these bugs?"*

Operationalized: **treat the open-gap ledger as the evidence base. For each cluster, ask what would have
had to EXIST for these not to be defects at all.** Not "where is the bug" — "what absence made the bug
expressible."

### Why now, and why it is not a repeat

Every DD so far has returned stay-the-course, and each was scoped so it *had* to: **dpa-024** was
compiler ARCHITECTURE with language design explicitly OUT of scope; **dpa-022/023** are single-axiom
questions. None asks the population-level LANGUAGE question. dpa-024's own corrective sharpens it —
*the bug loop is mostly NOT architectural; conformance pins ~18 of ~60 surfaces* — which says the loop is
about **contract completeness**, and leaves open whether parts of the contract are missing a primitive.

### ⚑ METHOD CONSTRAINT — population-FIRST, and this is load-bearing

The S331 hypothesis started from a suspected MECHANISM (raw-text seams) and went looking for supporting
defects. It was **refuted**: seam density ANTI-correlates with defect density; 139 of 195 open markers
were neither limb; and the instruments were 5 days old and could only see emitted text. dpa-024's rival
hypothesis started from the POPULATION and survived the same falsifier. **Start from the ledger. Do not
start from a favourite mechanism.** Every candidate must survive an explicit refutation attempt.

### TWO CANDIDATES ALREADY VALIDATED THIS SESSION (evidence, not speculation)

**1. `tare` — CONFIRMED, built, landed S337 (#501).** The `reset()`-on-a-multi-write-implicit-cell bug
resisted TWO structural fixes because two structurally identical programs want opposite answers — the
discriminator was INTENT, not form. The missing thing was **a surface, and the runtime slot already
existed** (`_scrml_default_fns`, resolved before init, never clobbered by writes); implicit cells simply
had no way to reach it. **This is the shape the DD is hunting: a bug that is unfixable structurally
because a primitive is missing, and trivial once it exists.** Worth mining for what made it findable.

**2. Semicolons / ASI — UNRUN, and the evidence is already collected.** SPEC §34 defines
`E-STMT-MISSING-SEMICOLON` as *"Expected `;` **or a newline** to end the statement"* — scrml is ASI-shaped.
PA-measured against the parser-conformance corpus:
- **`E-STMT-MISSING-SEMICOLON`: 3,103 occurrences** — the 2nd-largest diagnostic family (behind
  `E-EXPR-UNEXPECTED` 3,459). 531 files clean / 481 with errors.
- Fired from **both** `native-parser/parse-stmt.js` **and** `src/ast-builder.js` — not a native-only artifact.
- **17 corpus files** hit *"statement boundary not detected — trailing content would be silently dropped."*
- ⚠ **That drop is a bare `console.warn` at `expression-parser.ts:3007` — NOT a diagnostic.** It never
  enters `result.errors`/`result.warnings`, so no gate, no test and no CI check can see it. **Code is
  silently discarded and the only trace is stdout noise.** Same shape as the emission gate: the check
  exists and does not bite.
The question is NOT "would semicolons help lexing" — it is **what is newline-as-terminator costing**, and
that is now measured rather than speculative. Note the answer may be a RULE change, not a primitive; the
DD should say which, and cost the migration (2,300+ files, newly-rejecting).

### What counts as an answer

Per candidate: the gap CLUSTER it would kill (with counts from `docs/known-gaps.md`), what has to exist,
whether it is a PRIMITIVE / a stdlib tool / a RULE, the direction-of-change, and a MEASURED migration.
Plus an explicit refutation attempt per candidate — *why might this cluster not be caused by that
absence?* A candidate that cannot be argued against has not been tested.

**Anti-goals:** do NOT re-derive the S331 refuted hypothesis. Do NOT propose a rewrite. Do NOT re-open
dpa-022/023 (live axioms) or dpa-024's charter (ruled S337). **Do NOT ratify** — RUN-not-RATIFY.

### The honest null

Under what evidence is "no primitive is missing; the ledger is ordinary implementation debt plus
incomplete conformance coverage" the correct answer? **Name it in advance** so the DD can return it.
dpa-024's ~18-of-60-surfaces finding is the strongest prior FOR that null — weigh it explicitly.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`.
Routes to scrml PA. **RUN-not-RATIFY.**


## dpa-024 — How would the perfect compiler for THIS language be built? (compiler architecture; charter-with-a-clock)

```
id:        dpa-024
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-10 (ADVISORY). Q4 ACTED ON + conformance fork 2 RESOLVED → docs/changes/tier-2-scaffold-retirement-2026-08-10/RULING.md (bryan: "go, take the tier-2 retirement rule"). Q4's banked premise was WRONG (parity framing dropped S222) — recorded, not re-derived. §§1-3 + Q5 remain ADVISORY, awaiting bryan.
rung:      R2 minimum; escalate to R3 if two or more architectures survive investigation
requested: bryan, S331 (2026-08-09) — "bank the deep-dive, classify the gap ledger"
routes-to: scrml PA
```

### The question, in bryan's framing

> *"I am beginning to believe that we are (and have been for some time) experiencing the limits of early decisions, of architecture originally built for a smaller scope … we are in a (seemingly) never ending loop of bug find, bug fix, bug find … it's worth pausing and thinking about our druthers. How would the perfect compiler for THIS LANGUAGE be built?"*

Operationalized: **given the language as it now stands, and given an executable 876-case conformance contract, what architecture would a compiler for it be built on — and what does impl#1's divergence from that actually cost?**

### Why this is answerable NOW and was not before

1. **The language is far more settled than the compiler.** V1 is scrml-LANGUAGE 1.0; compilers are implementations.
2. **The conformance suite IS the contract** (§62.2) — 876 executable cases. A re-architecture that must satisfy 876 cases is a refactor with a fixed oracle, not a rewrite. Every previous flirtation with "rewrite" renegotiated the language and the compiler at once; that objection has expired and nobody has noticed.
3. **The freeze campaign is PAUSED** precisely because a conformance instrument cannot answer a design question (S322). This is the design question that pause was for.

### The five sub-questions

1. **Grounding.** What are impl#1's load-bearing architectural decisions? For each: deliberate or accreted · documented anywhere or not · prototype-inherent or permanent.
2. **Counterfactual.** For *this* language specifically — whole-stack single file, INFERRED server/client split (§12), a reactive dependency graph, `?{}`, `<channel>`, the §65 CSS model, the Tier 0/1/2 ladder, markup-as-value — what would a from-scratch architecture choose? Not "an ideal compiler" in the abstract.
3. **Delta + cost.** Where do (1) and (2) diverge, and what has each divergence *measurably* cost — in filed gaps, in deferred features, in recurring bug families? The grounding below is the starting evidence, not the conclusion.
4. **⏰ THE DECISION WITH A CLOCK — Road-B's charter.** `compiler/self-host-v2` is a LIVE second implementation currently chartered as a **parity target** (impl#2 reproducing impl#1). The conformance suite means impl#2 owes only the *observable contract*, not impl#1's internals. **If the better architecture is knowable, parity reproduces the debt deliberately.** This gets more expensive every session Road-B advances. **Answer this even if the DD answers nothing else.**
5. **The honest null.** Under what evidence is the correct answer "impl#1's architecture is fine, keep patching"? Name the condition in ADVANCE so the DD can actually return it. A DD that cannot return "no change" is a rubber stamp.

### ⚑ SCOPE — what is NOT in this DD

**The language design itself is OUT.** This is about the compiler that implements it. dpa-022 (markup as a state kind) and dpa-023 (the async boundary as a `(not to T)` lifecycle) hold the live language-axiom questions and both await ratification — do not reopen them here.

**Not a rewrite plan.** The deliverable is a CHARACTERIZATION plus the Q4 charter answer. bryan rules; the DD does not.

### GROUNDING — measured this session, with the overclaim already stripped

⚠ **A PA hypothesis was tested and REFUTED here. It is recorded so the DD does not re-derive it.**

**The refuted version** (PA, S331, from six defects in one session): *"the compiler's recurring defect generator is that it discards structured information and reconstructs it from raw text; the seam is `bodyRaw`/`rulesRaw`/`armsRaw`/`derivedExprText`/`component-def.raw`."*

**Why it failed — three independent falsifiers, all PA-verified:**
- **Seam density anti-correlates with defect density.** `engine-statechild-parser.ts` is the most raw-text-dense module in the repo (its whole job is re-scanning `rulesRaw`, ~95 seam ops/KLOC) and carries **2** ledger mentions. `emit-each.ts` is seam-LIGHT and carries **63**; `emit-logic.ts` **61**. The defect-dense files are seam-light.
- **Population classification, all 195 open markers read individually:** strict raw-text **22 (11%)** · post-hoc re-derivation **8** · duplicate-derivation **26** · **neither limb 139 (71%)**.
- **The detection confound is real and FIVE DAYS OLD.** `docs/pr-reviews.md` landed **2026-08-04**; `scripts/corpus-emit-differential.ts` **2026-08-05** (PA-verified by `git log --diff-filter=A`). The differential's entire observable is emitted TEXT — it structurally cannot find a defect that does not manifest in emitted text. Class-A gaps are 2.7× over-represented inside that 5-day window. **Six defects found by brand-new text-differential instruments is not evidence of an architectural property.**

**What SURVIVES, narrowed — bank this, not the above:**
> Post-emit **whole-buffer text passes** are a real, severity-enriched family — two named passes, not the `*Raw` AST seams: the server-fn body re-indenter (`emit-server.ts:122-207`, 9 call sites) and the client fn-name mangler (`emit-client.ts:2956`). Both re-derive from emitted JS what their emitters already held. **Both are documented IN-SOURCE as stopgaps with a prescribed structural exit.** 11% of open gaps but **6 of 20 open compiler HIGHs**.

**Sharper than "prototype debt" — the seam is STILL BEING MINTED.** PA-verified by `git log -S`: `rulesRaw` 2026-04-10 (first commit) but `ifExprRaw` **2026-05-09**, `inlineMatchBody` **2026-05-11**, `derivedExprText` **2026-06-13** — two months in, after SPEC, conformance and adopters existed. Not merely inherited; it remains the path of least resistance. **That is the more actionable claim.**

**The better-fitting rival hypothesis, measured (NOT yet adversarially tested — the DD should test it):**
> The codebase has **no single canonical representation of a program**, and every subsystem invents its own. Measured in `compiler/src`: **409** `walk*`/`visit*`/`traverse*` definitions across 15+ subsystems each independently traversing one FileAST · **two live front ends** (`buildAST` vs `nativeParseFile`) that disagree on `<each>` and are routed between by a pre-check on raw text · **29 module-level mutable slots + 26 exported cross-module state mutators** in codegen, with `_currentUserAmbientActive` existing TWICE with two setters. Raw-text seams are one symptom of five.

**Corroboration from an independent session** (weakens novelty, strengthens the finding): `handOffs/hand-off-s332.md:21`, a different machine — *"a hand-rolled walker that must mirror another component's full traversal — or re-lex already-emitted output — is drift-prone; successive adversarial rounds keep finding the same class. Converge on the shared substrate."*

**The ledger already names other recurring generators the DD must weigh against the above:** corpus blindness (*"the S301 pattern, 5th instance"*, 5 counted) · the oracle-inherits-the-implementation's-assumption shape (2) · `g-split-key-pair-class` (a key assembled at the write site and re-assembled at the read site, 4 instances, *"not yet swept"*) · `g-each-element-child-decided-by-four-disagreeing-predicates`. **The last two are the general "discards information it already had" shape with ZERO raw text involved** — evidence the general claim is right and the specific locus was wrong.

### ⚑ A SEVERE CAVEAT ON ANY CONVERGENCE PROPOSAL — protect this

`native-walker/engine-statechild-walker.ts` already replaces the `rulesRaw` text re-scanner with a structured walk — and it is **STALLED AT b.2 with BOTH implementations live**, the legacy one surviving *"as a fallback"*, the new one required to mirror the old one's exact quirks (`null`-vs-empty-string, leading-dot stripping, `rawOffset` semantics). **A half-finished seam convergence converts one copy into two — strictly worse than never starting.** Any convergence this DD proposes must be **funded through deletion**, with the deletion in the same arc, or it must not be proposed.

### What-counts-as-an-answer

A direct answer to **Q4** (Road-B's charter) with its cost stated both ways — change it now vs let it ride. Plus, for Q1–Q3, an enumeration of impl#1's load-bearing decisions with each marked deliberate/accreted and documented/undocumented, and a counterfactual architecture argued from **scrml's actual demands**, not from general compiler taste. Q5's null condition must be stated explicitly whether or not it is met.

**Anti-goals, stated so the DD can be judged against them:** do NOT open a general `*Raw` convergence program — the data does not support it. Do NOT propose a rewrite. Do NOT re-derive the refuted hypothesis above. Do NOT ratify.

**Three items already actionable WITHOUT this DD** (named loci, each with an in-source prescribed exit) — the DD should say whether they are the right first moves, not re-discover them: (1) emit-time tagging of template-raw vs layout per `emit-server.ts:114-120`, which closes 2 open HIGHs plus the 3 siblings filed S331; (2) the mangler-retirement arc scoped at `emit-client.ts:3038`; (3) drive `engine-statechild-walker` b.3→b.6 **to deletion**.

### Report-back
§3 — one-liner + artifact path + a `(dpa:)` breadcrumb. Artifact → `scrml-support/docs/deep-dives/`. Routes to scrml PA. **RUN-not-RATIFY.**

---

## dpa-030 — File upload: where does a file ARRIVE? A `File`/multipart PARAMETER on the contract adopters already write, or a dedicated `<upload>` primitive? (SHAPE only — the capability is settled)

```
id:        dpa-030
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-16 (ADVISORY) → DD written, 2 insight CANDIDATES staged, 4 defects routed, NOT ratified. Verdict at the item tail.
rung:      R2 (structural design fork on a primitive surface; bryan rules; adopter-driven)
requested: bryan S346 2026-08-16 (the reverse-ouroboros correction) — successor to the WITHDRAWN dpa-029 Q3
banked:    S347 2026-08-16
routes-to: scrml PA → return leg = a comment on adopter issue #471
```

### ⚑ SCOPE-LOCK — read this before anything else

**Whether scrml gets a working upload path is NOT the question. It is settled.** bryan, S346 verbatim:
*"The question should be, is it done in apps? can scrml do it? We have NO upload path?! Really?! because
no one has ever bult an app that requred upload."* For a compiler whose thesis is *"scrml IS the
backend"*, having no upload path is the thesis failing on a routine app.

**The ONE axis this DD decides: where does a file ARRIVE?**
- **(a) a `File` / multipart PARAMETER** on the server-fn / `<endpoint>` contract adopters already write.
- **(b) a dedicated `<upload>` primitive** (a structural element with its own surface).

**PA lean: (a).** LIMIT wins (FORK RULE row 1 — it rides an existing contract instead of minting a new
primitive); dpa-029's panel was 5/7 for it, framed as a **coeffect** — the parameter endorses size/mime,
it never declassifies. **Recorded as a lean, NOT ruled.** If the DD finds (b) is right, say so; a
widening can be the correct answer (S322 — the freeze motivation is paused, quality is the only axis).

### Why dpa-029 Q3 was WITHDRAWN and this replaces it

Q3 was framed *"(a) host-escape by design · (b) `<endpoint accepts=… body=multipart>` or an `<upload>`
primitive."* **Option (a) named a path that does not work**, so the fork was invalid as framed. A fork
whose cheap pole is a broken path will always resolve to the cheap pole for the wrong reason.

### Established facts — do NOT re-derive, all PA-verified by execution

1. **`<endpoint accepts=:enum>` decodes JSON only** (§61.3 request-decode via `parseVariant`; §61.5
   envelope). There is no multipart limb.
2. **`handle()` + `request.formData()` compiles CLEAN and then throws at runtime.** The emitter writes
   `const fd = request.formData();` with no `await`, so `.get()` runs on a Promise → `TypeError`. Filed
   HIGH: `g-handle-request-formdata-emitted-unawaited`. PA-reproduced by emission.
3. **`await` is refused by design, language-wide** (§19.9.8; the no-async/await standing rule; CPS/
   body-split is the sanctioned async surface). So (2) is not a missing keyword the adopter can supply —
   only the compiler can insert the boundary. **The host-escape is structurally unavailable, not merely
   undocumented.**
4. ⚑ **CORRECTED S347 — this fact was WRONG as I first wrote it.** I banked *"there is NO working upload
   path at all today, native or escaped."* **PA-falsified by execution:** base64-in-JSON over `<endpoint>`
   **compiles, runs, returns 200 with a typed decode, and round-trips bytes identically** (400 + a
   compiler-owned envelope on a missing payload field and on an unknown variant). The dPA caught this
   first; I then reproduced it. **The true statement:** a CAPABILITY path exists; a PRODUCTION-VIABLE one
   does not — 4/3 size inflation, `await req.json()` materializes the whole body, no streaming, no size
   ceiling, and no multipart. **The gap is ENCODING/TRANSPORT, not capability**, and any pole reasoning
   from "scrml cannot receive a file" is reasoning from a false premise I introduced.
   Found en route: a malformed body throws an uncaught `SyntaxError` instead of §61.3's compiler-owned
   400 → `g-endpoint-malformed-json-body-throws-instead-of-400` (HIGH).
5. **`handle()` is OUTSIDE the protect/tenant envelope AND currently leaks.** `handle()` +
   `new globalThis.Response(JSON.stringify(row))` over a `protect=` table ships the protected column at
   HTTP 200 (`g-handle-globalthis-response-ships-protected-columns`, HIGH, PA-reproduced; violates
   dpa-017 RATIFIED S230). The dpa-029 sequencing dissent applies here verbatim: *"the ruling must not
   add a second egress envelope while the first one is provably unsound."* **An upload answer routed
   through `handle()` inherits an envelope known to be broken — weigh that as a fact, not a hypothetical.**
6. The auth-scoped confidentiality architecture (RATIFIED S256) is `EgressSink × ConfidentialityAxis` —
   complete mediation without a god-object. **An upload is INGRESS, not egress.** Whether that coverage
   TYPE has an ingress twin, or whether endorsement is a genuinely new axis, is an open question this DD
   should NAME (it need not settle it).

### ⚑ FACT 7 — the SPEC ALREADY ANTICIPATED THIS CASE AND PARKED IT BEHIND A WITNESS THAT HAS ARRIVED

Found S347 by the sliding-doors audit (durable-tier slice), not by memory. **§61.10 records two
corpus-zero deferrals, and one of them is this exact question:**

> *"**The `raw` path-bound raw-wire escape** — DEFERRED, gated on a **witnessed untypeable inbound
> case** (§61.8); `handle()` (§40) is the interim raw escape."*

and, in the same list:

> *"**Non-`:enum` request shapes** — `accepts=` is `:enum`-only … A non-variant inbound shape is not
> expressible as an `accepts=` enum and is `E-ENDPOINT-ACCEPTS-NOT-ENUM`; **such a contract is the
> deferred `raw` escape's territory** (or `handle()` today)."*

**A multipart upload IS a non-`:enum` inbound shape.** So the SPEC already classified this case, already
routed it to a deferred primitive, and already named `handle()` as the interim. Three consequences the
DD must take as given:

1. **The witness has arrived** — adopter #471. The deferral condition was *"a witnessed untypeable
   inbound case"*; that is no longer hypothetical, which means the deferral has EXPIRED on its own
   stated terms. This is the audit's `already-biting` class.
2. **The named interim does not work.** §61.10 points at `handle()`; facts 2 and 5 above show `handle()`
   is runtime-broken for `formData()` and ships `protect=` columns. **The SPEC's own fallback is
   unsound**, so "wait for the witness, use `handle()` meanwhile" was never a working posture.
3. **The fork therefore has a THIRD pole the bank did not name** — reviving the deferred `raw`
   path-bound escape, rather than (a) a parameter or (b) an `<upload>` element. The DD SHALL evaluate it
   as a first-class option and say why it wins or loses. ⚠ Note it interacts with dpa-002 (which KILLED
   `raw` and kept `handle()`) — so reviving it is a REOPEN of a ratified decision, and must be argued as
   one, not smuggled.

**Do not read this as the PA pre-deciding.** It is evidence the bank was missing, and it cuts against the
PA's own recorded lean as much as for it.

### ⚑ METHOD CONSTRAINT — Rule 6 binds this DD, and it is the load-bearing instruction

**Do not accept the parameter framing just because it is the PA's lean and the cheaper pole.** Rule 6
(state-primacy at intake) says an ask arrives already framed, and *that framing is a design decision
nobody deliberated*. "A file is a parameter" is exactly such a framing.

So: **run Pillar 5b's ratified operational test on the upload itself** — does it have named conditions
and a transition contract, and does *"what condition is this in?"* read sensibly? An upload plausibly
does (`idle → receiving → stored | rejected`), which is the shape scrml claims as its bet. **Reuse 5b's
existing test; do NOT invent a second classifier.** The guardrail in the other direction is 5b's own
escape clause: a conversion to state must win on a NAMED axis (ergonomics / spec-clarity / runtime-cost),
never on preference — converting a genuine calculation into a state shape to satisfy a bias makes the
language worse.

### ⚑ FORBIDDEN REASONING — the S346 ruling binds this DD

**"The corpus shows zero uploads" is NOT admissible** as evidence about whether or how to build this.
Corpus-zero is a **BLAST-RADIUS instrument only** ("how many existing files break if I change this").
The corpus was written by us to demonstrate a language growing from nothing; it is evidence about its
authors, not about adopters. **The only two admissible questions: is it done in apps? can scrml express
it?** — the second answered by COMPILING, not by reading. Any pole that reaches for corpus-zero as a
reason to prefer the smaller surface should be caught and named as re-litigation.

### Evidence the DD owes

- **Per fork: the governing sentence, quoted** from `compiler/SPEC.md` with its §ref — or the explicit
  *"searched §X, §Y, §Z — no governing sentence found."* Outcome 2 is a FINDING: it means this is a
  RULING, not a fix.
- **What an adopter WRITES today under each fork** — real worked scrml, COMPILED, not sketched. Include
  the failure mode each fork produces when the file is absent, oversized, or the wrong mime.
- **Direction-of-change** for each fork (inert / newly-rejecting / newly-accepting / semantics-changed)
  and whether it widens the surface.
- **Prior art, on the specific axis** — in frameworks that OWN the backend (Rails/ActiveStorage,
  Django, Phoenix `Plug.Upload`, Laravel, ASP.NET), is the file a PARAMETER of the handler or a distinct
  primitive, and does the framework own STORAGE? Then the same question for the route-handler crowd
  (Remix/Next route handlers, SvelteKit form actions). The interesting cell is where a framework that
  owns the backend chose a primitive anyway, and why.
- **Endorsement**: where do size/mime/count limits live in each fork, and is that a coeffect on the
  parameter, an attribute on the primitive, or a refinement type (§53)? scrml already has a predicate
  vocabulary — say whether it reaches.
- **The storage question, NAMED not decided**: does scrml own where the bytes land (a blob table / an
  `<storage>` surface) or is that adopter territory? **State whether the shape choice FORECLOSES either
  answer** — that is the part that matters now.
- **`<form enctype="multipart/form-data">` interaction**: §41.14 `formFor` emits forms and §41.14.3 has
  a progressive-enhancement `<form action=>` default. Does either fork compose with that, or contradict it?

### Anti-goals

- Do **NOT** re-litigate whether uploads should exist. Settled.
- Do **NOT** invoke corpus-zero as evidence about the capability (see FORBIDDEN REASONING).
- Do **NOT** build; do **NOT** ratify (RUN-not-RATIFY).
- Do **NOT** design the storage layer — name it and its foreclosure risk, then stop.
- Do **NOT** treat `handle()` as a sound envelope; fact 5 is a defect, not a baseline.
- Do **NOT** re-open §61's thin-envelope ruling as if unruled — extend it or do not.

### Report-back

§3 — one-liner + artifact path + a `(dpa: …)` breadcrumb in `delta-log.md`. Artifact →
`scrml-support/docs/deep-dives/`. Routes to the scrml PA, whose return leg is a comment on #471.

### Verdict (dPA, 2026-08-16 — ADVISORY, NOT ratified)

**Artifact:** `scrml-support/docs/deep-dives/file-upload-arrival-shape-dpa-030-2026-08-16.md`

**One-line:** **Fork (a) — but the fork was drawn one layer too high and the ruling is narrower than either pole:** mint **`File` as the 7th builtin primitive** (the S109 `date`/`timestamp` move, for the S109 reason), specify it as a **capability HANDLE** so storage stays unforeclosed, route it through **§12 server fns — NOT by widening `<endpoint accepts=>`, which would RE-OPEN §61.3/§61.10 rather than extend it** — and hold the ruling behind 4 defect fixes. **`<upload>` as a structural element REJECTED 5/5.**

**★★ ESTABLISHED FACT 4 IS FALSE.** *"There is NO working upload path at all today"* — **verified false by execution**: base64-in-JSON over the existing `<endpoint>` **compiles AND RUNS** (200 + typed decode + compiler-owned 400). **The gap is ENCODING/TRANSPORT (multipart), not capability.**

**★★ THREE OF FOUR LAYERS ARE ALREADY BUILT.** `<input type="file" bind:files=@x>` compiles + wires (§5.4, P8) · a hand-authored `<form enctype="multipart/form-data">` compiles + emits **with CSRF auto-injected** (P6) · the typed transport carries bytes today (P5). **Missing: a type NAME and a server DECODE.** The tell — §5.4 says the bound cell "is typed `FileList`", and **`FileList` occurs EXACTLY ONCE in the 37k-line SPEC and ZERO times in `compiler/src/`**; `emit-form-for.ts:290`'s `file` branch is **DEAD CODE** because `inputShapeForFieldType` has no case that returns it. (Same shape: SPEC:8195 maps `BLOB → bytes`; `bytes` was never minted either.)

**★★ 4 DEFECTS ROUTED AHEAD OF THE RULING** (dpa-029 7/7 precedent, concurred 3/5 explicitly): **(D1, NEW HIGH)** `formFor`'s **mandated, un-opt-out-able** PE fallback posts to a **404** — emits `action="/api/…"`, route inference mounts `/_scrml/…`, **zero `/api` handling exists anywhere**; verified by execution → `g-formfor-pe-action-prefix-mismatch-404`. **(D2, known HIGH — MECHANISM LOCATED)** the raw-egress gate is a **source-text regex** (`protect-egress.ts:296`); executed: `new Response(…)` fires, **`new globalThis.Response(…)` does NOT**, nor does an aliased `const R = globalThis.Response`. **This is instance #233 of the class dpa-025's RATIFIED S338 census targets, and it sat in that census's stated blind spot.** Fix must be structural, not a harder regex. **(D3)** `request.formData()` emitted unawaited — reproduced at emit **and** runtime; **violates §19.9.8's own JS-host boundary clause**, and the adopter structurally cannot fix it (`E-AWAIT-NOT-IN-SCRML`). **(D4, NEW)** **no request-body size ceiling on any of the 3 JSON prologues** — a live DoS predating uploads.

**★ Two panel premises corrected by PA verification.** (i) Pole 3 (Phoenix) conditioned its verdict on "a persistent-connection primitive" — **scrml HAS one** (§38 `<channel>`, §37 SSE). Re-polled, it did **not** simply flip: `<channel>` is **app-scope broadcast** and would be a **privacy bug** (every visitor's filename broadcast to every visitor) — **PA-verified stronger than it knew**: §38 mandates `name=`/`topic=` be **static** (`E-CHANNEL-007`), the WS URL is compile-time and shared, and the SPEC's own pattern is broadcast-then-filter-client-side. **Progress belongs on §37 SSE (1:1 by construction), and is DEFERRED out of this ruling.** (ii) The PA lean's rationale ("LIMIT wins — rides an existing contract without minting a primitive") is **unavailable**: fork (a) mints a primitive too, a *type* rather than an *element*.

**★ The strongest challenge, stated at full force in the artifact:** a blind 8-framework prior-art survey found arrival-layer primitives are minted for **exactly one** reason — *the transport stopped being an HTTP form post* (LiveView/Livewire/Blazor, 3 independent mints in 12 months) — and **scrml's JSON-only server-fn stub puts it in that class**. It does not carry because **every such primitive REQUIRES JS**, which **contradicts §41.14.3's mandated PE default**. Those frameworks had ONE transport that couldn't carry bytes; **scrml has TWO, and the mandated PE form post is already multipart-native and already emits correctly.** The precedent scrml's PE rule selects is **Livewire's** (change the transport, keep the parameter SHAPE), not LiveView's. **5/5 backend-owning frameworks did add a dedicated surface — but at DIFFERENT LAYERS, and Rails/Django's are at PERSISTENCE, driven by service portability, not by arrival.**

**Endorsement:** count = expressible today (array cardinality). Size = **surface reaches, checking does not** — `length(<=N)` already means byte-count on blobs (§39.5.8), but a refinement evaluates on a value that exists, and holding a 4 GB part IS the loss ⇒ **a resource coeffect, not a refinement**; keep the declaration site, change the **LOWERING** to a streaming 413 abort (precedented: `req` already lowers differently for `text`/`blob`). Mime = **do NOT ship as a refinement** — it ranges over an adversary-controlled header; *"a mime check after buffering is theater."* **LiveView is the only surveyed framework enforcing size per-chunk at the file's own declaration site — the property to match. Rails' `has_one_attached` (zero enforceable constraints, core validator PR closed unmerged) is the anti-pattern.**

**⚑ OQ-1 IS BLOCKING AND CHEAP (~20 lines):** can a Bun handler read `req.body` as a `ReadableStream`, count bytes, and abort at N **without materializing**? **If NO, the declared bound is advisory-only and pole 5 switches to (b)** — a primitive can own its reader; a parameter inherits the pipeline. This is the one experiment that could still flip the verdict, and it was scoped but **not run**.

**Staged insight CANDIDATES (2, in-artifact, NOT landed):** *"A missing capability is often a missing NAME, not a missing mechanism — and the walkers will tell you which"* (a dead walker branch + a type named only in prose = a naming bug wearing a feature request's clothes; ADDING an element vs ACTIVATING machinery already paid for are opposite fixes) · *"A primitive's layer is chosen by the TRANSPORT, not by the domain"* (⇒ **§41.14.3's PE default does real design work far outside forms — it is the constraint that selects parameter over primitive, and weakening PE silently re-opens every such choice**).

**RUN-not-RATIFY honored** — no SPEC edit, no insight landed, no compiler source touched, item NOT flipped to `ratified`.

---

## dpa-031 — Ad-hoc shared reactive state: is the engine-singleton actually a complete substitute for a free-shaped store, or did "zero corpus demand" close a real gap?

```
id:        dpa-031
status:    complete   # banked → running → complete → ratified(by PA) · COMPLETE dPA 2026-08-16 (ADVISORY) → DD written, 3 insight CANDIDATES staged, 7 defects routed (3 HIGH), NOT ratified. Verdict at the item tail.
rung:      R2 (axiom-adjacent: what scrml's shared-state model IS; bryan rules)
requested: the S346 sliding-doors arc — audit node `free-shaped-global-store-not-built`
banked:    S347 2026-08-16
routes-to: scrml PA
```

### ⚑ SCOPE-LOCK — what is and is not being asked

**NOT asked: "is the engine-singleton good?"** It is good, it is ratified, and it is not on trial.
**NOT asked: "should scrml ship a Redux/Zustand clone?"** Almost certainly no.

**Asked: can scrml express ad-hoc shared reactive state that is NOT a state machine — and if the answer
is awkward, was that awkwardness ever actually weighed?** Because on the record it was not: the option
was closed on *"zero corpus demand"*, and the corpus was ours.

### The chain — established, do NOT re-derive

1. `hand-off-183.md:21` (S178, DD1 Fork 2): *"do NOT build 2C (free store — **zero corpus demand**)."*
2. Hardened into normative **SPEC §51.0.A** (`SPEC.md:27603`): *"scrml ships NO free-shaped / untyped
   global store … Genuinely-shared reactive state **SHALL** be modeled as an engine … This
   explicit-data-flow + typed-engine-singleton model is scrml's **final** shared-state design."*
3. Mirrored into **`PRIMER:683`** — a MANDATORY boot read, so every PA re-reads it as settled.
4. Re-cited at **S316 / #388** to reject `export let`. A decision is already built on it.

**⚑ The DD answered the apps-test in its own body, AGAINST its own recommendation** — the sharpest fact
here, and the reason this is banked rather than closed. Its own text records that 2C *"matches the
unanimous framework field"*, that 2A leaves *"scrml on the minority side of the entire framework field"*,
and that prop-drilling is *"a known friction."* **Corpus-zero beat unanimous prior art, and the omission
was then positively ratified as FINAL.** Do not re-derive these; they are quoted from the artifact.

### The two tests

- **`apps-test` — ALREADY ANSWERED, YES.** Svelte stores · Riverpod · Zustand · Pinia · Redux · MobX ·
  Jotai · Recoil. Do not spend a poll re-establishing this.
- **`scrml-test` — THE JOB. Answer it by COMPILING, not by reading the SPEC.** Author the shapes those
  libraries are actually reached for and compile each one:
  theme / locale preference · auth session + current user · a toast/notification queue · a shopping cart ·
  websocket connection status · a feature-flag bag · an "unsaved changes" dirty-tracker.
  For each: **what does an adopter write today**, does it compile, and what does it cost? Report the
  emitted shape, not an impression.

### ⚑ METHOD CONSTRAINT — Pillar 5b's escape clause is load-bearing HERE, in the reverse direction

scrml's bet is state-primacy (Rule 6), and that bias is exactly what makes this question hard to see from
inside. **5b's own escape clause is the guardrail: a conversion to state must be defensible on a NAMED
axis (ergonomics / spec-clarity / runtime-cost), never a preference.** A theme string and a toast queue
have no meaningful variant set; forcing a variant enum onto them to satisfy the bias is precisely the
failure 5b warns about — *"converting a genuine calculation into a state shape to satisfy a bias makes
the language worse."* Run 5b's ratified two-table test on each shape above and report which side it lands
on. **Do not invent a second classifier.**

### ⚑ FORBIDDEN REASONING (S346, standing)

**"The corpus shows zero free-store usage" is INADMISSIBLE here** — it is the exact reasoning under
audit, and it is circular twice over (the corpus cannot contain a construct the language refuses).
Corpus-zero is a BLAST-RADIUS instrument only. Any pole reaching for it should be named as re-litigation.

### Evidence the DD owes

- The **governing sentence** for each fork, quoted with its §ref — or the explicit *"searched §X, §Y, §Z
  — none found."* Note §51.0.A's SHALL already exists, so a widening must argue **supersession**, not
  silence.
- **Compiled** adopter code for each shape above, both the engine-singleton route and whatever the
  awkward-but-legal alternative is today.
- Whether the recorded *"known friction"* of prop-drilling is real at scale — measure it on a shape with
  3+ levels of nesting, do not assert it.
- **Direction-of-change** if the answer is to widen, and what `final` in §51.0.A costs to amend
  (`supersedes:` per Rule 4b).
- The honest null is a first-class outcome: **"the engine-singleton covers all seven shapes, `final`
  stands, and the justification should simply be rewritten to the real reason"** would be a complete and
  valuable answer.

### Anti-goals

Do NOT build. Do NOT ratify (RUN-not-RATIFY). Do NOT propose a store library. Do NOT re-open whether the
engine-singleton is a good primitive. Do NOT reason from corpus counts.

### Report-back

§3 — one-liner + artifact path + a `(dpa: …)` breadcrumb in `delta-log.md`. Artifact →
`scrml-support/docs/deep-dives/`. Routes to the scrml PA.

---

### ✅ COMPLETE — dPA 2026-08-16 (ADVISORY, NOT ratified)

**Artifact:** `scrml-support/docs/deep-dives/ad-hoc-shared-reactive-state-2026-08-16.md`

**One-line verdict:** *"Zero corpus demand" closed a gap that was already filled — and named the wrong
thing as the filler: **scrml HAS a free-shaped, typed, fail-closed shared reactive store today** (top-level
cell + cross-file ambient read — compiled, executed, works), while **the engine-singleton §51.0.A names as
its substitute does not work across files in v0.7.1** (emits an inert `<engineVar />`, green compile, 0
diagnostics, renders nothing).

**★ The sharpest fact.** The substitute has never been exercised end-to-end. A cross-file engine singleton
carrying a payload — the exact shape §51.0.A prescribes for shared app state — cannot render today: the
cross-file mount emits an unexpanded tag (D1), the engine var is missing from the module registry so the
importer's destructure binds `undefined` (D2), and `initial=.Variant(payload)` drops its payload → a
`TypeError` at boot and on every write, thrown inside handlers so it surfaces as *nothing happening* (D3).
Three HIGH defects sat under a ratified `final` for ~169 sessions. A same-file control renders correctly,
isolating the fault to the cross-file mount, not to engines.

**★ Both adjectives in "free-shaped / untyped global store" are inaccurate** about what scrml lacks. Cells
are typed (`<session>: Session`, `<cart>: CartLine[]` — idiomatic per `examples/25-triage-board.scrml:48`),
ambient-read at any depth across files with live subscriptions (§15.13.4 is written over `@var` generically,
NOT over engine cells), and **fail-closed** — a missing ambient cell is `E-STATE-UNDECLARED` at compile time,
not a runtime undefined. What scrml actually lacks is a store *library*, and the rule that genuinely binds is
unwritten anywhere in SPEC: **a shared cell must be declared in the ENTRY file** (cells are not exportable,
§21.2 — `E-IMPORT-004` on a `store.scrml`).

**★ Pillar 5b's two-table test, run per shape (no second classifier): 3 STATE · 1 borderline · 4 DATA.**
For half the canonical shapes the engine is the wrong reach. **The feature-flag bag inverts
`examples/29-engine-vs-flags.scrml`'s own lesson** — example 29's "three booleans → reach for an engine"
holds because 5 of 8 combinations are nonsense; a flag bag has **all** 2^N combinations real, which is
exactly when the boolean bag is right and the engine is wrong. That premise is never stated in the example.

**★ Prop-drilling friction MEASURED, not asserted** (3 levels, 8 shapes): **4.55× identifier repetition**
(91 vs 20 mentions) for byte-identical output — and worse than that, **the reactive form the SPEC documents
does not compile**: §15.13.3 teaches `bind:name=@name` for live props; the compiler answers `E-ATTR-011`
(only `bind:value/checked/selected/group/this` exist). The non-bind form stays live only because CE
inlines it back to the ambient read — which itself contradicts §15.13.3's "evaluated once".

**Direction (advisory):** do NOT widen, no store primitive. (1) Fix D1/D2/D3 — until D1 lands §51.0.A rests
on an unimplemented mechanism. (2) Rewrite §51.0.A's justification to the real rule (the item's nominated
honest outcome, corrected on facts) — defensible on ergonomics + spec-clarity, both NAMED 5b axes.
(3) The genuine residual is **cell exportability (§21.2), a module-system question, not a shared-state one**
→ recommend banking as OQ-1. Amendment cost is small: 8 `§51.0.A` citations + 3 phrasings; **the S316/#388
`export let` rejection is UNAFFECTED** (still rejected under §21.2), so it needs no re-litigation.
Supersession argued on new evidence, not silence.

**Honest null offered and DECLINED on evidence** — the engine-singleton does not cover all seven shapes.

**7 defects routed** (3 HIGH: D1 cross-file mount inert · D2 engine var unregistered · D3 payload dropped at
`initial=`; 2 MED: D4 `bind:` prop rejected vs §15.13.3 · D5 cross-file component cannot reference its own
file's sibling, `known-gaps` records this class fixed at S166 `9d12d980` — reproduces; 2 LOW: D6 §21.2-vs-§21.8
SPEC self-contradiction on engine exportability · D7 `Theme` is a reserved identifier, so the most canonical
global-store shape cannot use its own name). None appear as filed `known-gaps` entries.

**3 insight CANDIDATES staged (in-artifact, NOT landed):** *"A prohibition the compiler does not enforce is a
description that has drifted, not a rule"* (converges with dpa-030's candidate from the opposite side —
recorded, not claimed as novel) · *"A design principle carries its premise with it — and inverts when the
premise flips"* · *"Verify the substitute, not just the thing being removed."*

**Method:** every claim compiled on v0.7.1 and, where behaviour was at issue, **executed in a real DOM**
(happy-dom, chunks run in document order) — 10 probes, incl. a same-file control isolating D1 and a direct
reproduction of D3's two throws. **RUN-not-RATIFY honored** — no SPEC edit, no insight landed, no compiler
source touched, item NOT flipped to `ratified`.

---

## dpa-032 — App-content i18n: does scrml grow a NATIVE compile-time message surface, or is translation a host/runtime boundary by design?

```
id:        dpa-032
status:    complete # banked → running → complete → ratified(by PA)
artifact:  scrml-support/docs/deep-dives/app-content-i18n-dpa-032-2026-08-17.md
fixtures:  scrml-support/docs/deep-dives/dpa-032-i18n-fixtures/ (f1-f10; f5/f6/f7 RUN in chromium)
verdict:   B — the SUBSTRATE, not the surface. The null is dead on `<html lang="en"`
           (hardcoded, no author surface); the by-construction guarantee already
           exists as E-TYPE-020 over a locale enum. 4 unfiled defects routed.
rung:      R2 minimum (language-surface: a new primitive or an extension of §41.12; USER rules)
           → escalate to R3 if ≥2 approaches survive on DIFFERENT axes
           ⇒ RESOLVED R2-TERMINAL (dPA 2026-08-17): two approaches survive (B, and C as a
             deferred successor) but they are NESTED, not orthogonal — C is B plus a catalog,
             and no voice argued C-without-B. The live disagreement is B's SIZE, which is a
             ruling, not a debate. NOTE the framing premise "an extension of §41.12" is
             MEASURED FALSE (closed 15-variant key space) — see the artifact §0.4.
requested: S349 — an unsolicited inbound integration proposal for a runtime DOM-scanning i18n
           library surfaced that scrml has NO app-content i18n story at all. The proposal is
           REJECTED (see "Recorded rejection" below); the GAP it exposed is real and unfiled.
banked:    S349 2026-08-17
routes-to: scrml PA
```

### ⚑ SCOPE-LOCK — what is and is not being asked

**NOT asked: "should scrml integrate a third-party runtime translation library?"** No — ruled at intake,
reasoning recorded below precisely so it does not leak into adjacent questions.
**NOT asked: "should scrml re-implement ICU MessageFormat?"** Almost certainly no.
**NOT asked: "is `scrml:format`'s Intl surface good?"** It is fine and is not on trial.

**Asked: can an adopter ship a scrml app in two languages today — and if the answer is awkward or
impossible, what is the scrml-SHAPED surface?** Specifically: does it EXTEND the §41.12
`registerMessages` mechanism that already exists, or does it need its own primitive, or is app-content
translation correctly outside the compiler's remit?

### Established S349 by PA grep — do NOT re-derive

1. **scrml's ONLY i18n surface is diagnostics and labels.** §41.12 `scrml:data registerMessages`
   (project-level error-message registration), the §55.10 four-level message-resolution chain, and
   §41.16 `registerLabels` for `tableFor`. **Seven** occurrences of `i18n`/`internationali*` in the
   37,152-line SPEC — every one of them about validator messages.
2. **App-content i18n does not exist.** Zero entries in `docs/known-gaps.md`; zero in this file before
   this item. Genuinely unfiled, not deferred.
3. **⚑ THE SPEC HAS ALREADY PAID A COST FOR AN i18n PIPELINE THAT WAS NEVER BUILT.** `§55.10` /
   `E-VALIDATOR-INLINE-DYNAMIC` REJECTS a form — a dynamic inline validator message — with this
   normative justification, quoted verbatim from `SPEC.md:19554`:

   > *"Per L12 Edge F, dynamic expressions / interpolations defeat i18n tooling extraction (messages
   > must be statically discoverable)."*

   A live rejection, enforced today, whose stated purpose is to protect **extraction tooling that does
   not exist**. That is the governing sentence this DD must reckon with: either the answer justifies
   that cost, or the cost is unpaid and the rejection is owed a re-examination of its own.

### The two tests (S346, standing)

- **`apps-test` — ALREADY ANSWERED, YES. Do not spend a poll re-establishing it.** Multi-language
  shipping is universal in the application field: Rails i18n, Django, next-intl, vue-i18n,
  svelte-i18n, Flutter `intl`/`gen_l10n`, Angular i18n, ICU MessageFormat, Project Fluent, gettext.
- **`scrml-test` — THE JOB. Answer it by COMPILING, not by reading the SPEC.**

### The shapes to author and COMPILE (report the emitted shape, not an impression)

For each: what does an adopter write **today**, does it compile, and what does it cost?

- a static UI string in plain markup, and the same string inside a `<match>` arm and an `<engine>`
  state-child body (those are §4.18 **code-default** bodies where display text is a `"..."` literal —
  does a message key even fit there, or does the body mode fight it?)
- an interpolated message with a value, and with TWO values in a different order per language (the
  argument-reordering case is why MessageFormat exists)
- **pluralization** (0 / 1 / N, and the languages with more than two plural forms) — the hard case
- locale as **reactive state**: switching language without a reload, and what that does to the
  reactive graph
- **SSR**: which locale does the server render, how does it learn it, and how does that compose with
  §52.15.5's auth-scoped prerender omission
- **routing**: `/en/...` vs `/fr/...` vs a cookie/header — this reaches §12 route inference
- date / number / currency: how much is ALREADY covered by `scrml:format`'s Intl surface (measure it;
  the overlap may be larger than assumed)
- a message catalog as a **file** — where does it live, what parses it, and is it typed

### ⚑ THE DISCRIMINATOR — by construction, or by retrofit (S322)

The re-examination test applies directly and is the sharpest question here:

**A missing translation should be a COMPILE ERROR the way a missing `<match>` arm is.** Exhaustiveness
over a locale set is the same shape as exhaustiveness over a variant set, and `<match>` holds because
the arm set is checked **at the declaration** — by construction, and it has generated no bug family. A
runtime fallback chain that silently serves the base language when a key is missing is the **retrofit**
shape, and it is the shape that produces one gap per position.

Weigh every candidate on that axis first. **Flutter's `gen_l10n` is the closest prior art to study** —
it codegens a typed accessor from message files, so a missing key fails at build. Poll it properly
rather than treating the JS-framework field as the whole prior art.

### Recorded rejection — the runtime DOM-scanning class, and its SCOPE LIMIT

The proposal that triggered this item is the **runtime DOM-scanning** approach: a script that scans the
rendered DOM, extracts text nodes, sends them to a translation endpoint, and rewrites the DOM in place,
with a MutationObserver to catch dynamic updates. Public prior art in this class:
[`translate.js`](https://github.com/xnx3/translate) (MIT). **Rejected at intake, on four grounds:**

1. **It is an unmediated egress sink.** Rendered page text — which can carry `protect=`-tagged columns
   (§14.8.9) and tenant-scoped rows (§14.8.10) — is POSTed off-origin by default. The compile-time
   `EgressSink × ConfidentialityAxis` coverage type exists so that every compiler-emitted client-egress
   sink is mediated; this one is invisible to it by construction.
2. **It puts a second uncontrolled writer on DOM surfaces the reactive runtime owns.**
   `E-ATTR-WRITER-CONFLICT` (writer-ownership Axiom ①, live at `compiler/src/codegen/emit-html.ts`)
   makes contended wholesale ownership of a DOM surface a compile error. ⚠ **PA INFERENCE from the emit
   architecture, NOT measured** — that an external MutationObserver would in fact be clobbered by
   `_scrml_effect` re-renders and race `_scrml_reconcile_list` is untested. Cheap to settle; settle it
   if the DD leans on it.
3. **It is retrofit, not by construction** — a post-hoc pass over emitted output, changing what it
   means, with no access to the tree that produced it. The §13.2 auto-await shape exactly.
4. **The SEO claim is inverted.** "Crawlers see unmodified source" means the translated pages are not
   indexable; one language gets indexed.

**⚑ SCOPE LIMIT — the whole reason this is recorded rather than merely decided.** These four are about a
**runtime DOM-REWRITING mechanism**. They do **NOT** decide:
- whether a **build-time** translation step is acceptable (it faces none of the four);
- whether **machine translation as an AUTHORING AID** — filling a catalog a human then reviews — is
  acceptable (it faces none of the four);
- whether an **adopter** may use such a library in their own app. That is their call; scrml has no
  business forbidding it, and nothing here should become a compiler-enforced refusal.

Anyone citing this rejection against a build-time or authoring-aid proposal is citing it out of scope.

### ⚑ FORBIDDEN REASONING (S346, standing)

**"The corpus shows zero i18n usage" is INADMISSIBLE.** The corpus is what we wrote to demonstrate a
language growing from nothing; it is evidence about the authors, not about adopters, and it cannot
contain a construct the language does not offer. Corpus-zero is a **BLAST-RADIUS instrument only**. Any
pole reaching for it should be named as re-litigation of a ruled question.

### Evidence the DD owes

- The **governing sentence** for each fork, quoted with its §ref — or the explicit *"searched §X, §Y,
  §Z — none found."* Note §41.12 + §55.10 already exist and already reach for i18n; a new primitive must
  argue why it is not an extension of them.
- **Compiled** adopter code for every shape above — today's awkward-but-legal route AND the proposal.
- Whether the `E-VALIDATOR-INLINE-DYNAMIC` cost (item 3 above) is justified by the answer, or becomes an
  unpaid cost owed a separate re-examination.
- **Direction-of-change** classification; any NEW normative section owes a `prov=` field (Rule 4b).
- Where the locale-set exhaustiveness check would live, and whether it can hold **at the declaration**.
- **The honest null is a first-class outcome**: *"app-content i18n is correctly a userland concern;
  §41.12 covers exactly what the compiler owns, and the surface should simply say so"* would be a
  complete and valuable answer — but it must then explain the §55.10 rejection.

### Anti-goals

Do NOT build. Do NOT ratify (RUN-not-RATIFY). Do NOT evaluate the specific inbound library beyond the
recorded rejection above — it is prior art, not a candidate. Do NOT reason from corpus counts. Do NOT
re-open `scrml:format`.

---

## dpa-033 — `reveal` is spec'd VALUE-scoped; the static raw-egress gate cannot compute value-scope. What is the conformant approximation?

```
id:        dpa-033
status:    ratified  # banked -> running -> complete -> ratified · RATIFIED BY bryan S352 2026-08-19.
ruling:    **(c) as the sound floor NOW, then (d) sink-level lowering as the restored exit.** bryan,
           S352, selecting the surfaced fork: *"Floor now, exit restored after"* — which per the
           S276/S130 durable adopts the FULL surfaced text. Concretely: (1) delete the `reveal`
           suppressor from the raw-egress gate (subtractive ~-80 LOC, 1-2 d, zero adopter migration,
           removes a mechanism the SPEC never granted); (2) THEN build (d) sink-level lowering
           (~3-6 d) — where `JSON.stringify(x)` sits syntactically inside `new Response(...)`, emit
           `JSON.stringify(_scrml_protect_redact(x))`, a location-level decision about a SINK with
           the descriptor answering the value question at runtime per §14.8.9; (3) (c) REMAINS the
           floor for sinks (d) cannot see. The sequence never passes through a state where the exit
           is a fail-open. NOT taken: the type/provenance route (15-30 d mono / 40-80 d poly) — the
           correct long-run model, but not against zero adopter usage with the leak live on main.
           Composes with the S347 D1 ruling (*a mandate an adopter cannot opt out of is itself the
           defect*): under (a)/(b) the adopter's opt-out IS `reveal("col")` and it is unreliable —
           *"a trap dressed as an escape hatch"* — so (c)+(d) RESTORES a reliable exit rather than
           removing one. Full record: `../scrml-support/user-voice-scrml.md` S352.
unblocks:  `egress-tojson-root` Unit 2 (the interprocedural E-PROTECT-004), HELD on this item.
           ⚑ The stack has a SECOND blocker still open — **M4**, the `globalThis.` allowlist
           (`type-system.ts:7415`): it is newly-rejecting and leaves `TextEncoder`/`TextDecoder`/
           `ReadableStream`/`AbortController`/`Uint8Array`/`structuredClone`/`Bun` with no legal
           spelling. That is its own operator call — see delta-log [1560].
artifact:  scrml-support/docs/deep-dives/reveal-value-scope-raw-egress-dpa-033-2026-08-19.md
verdict:   PA rec (b) REFUTED ON THE FACTS — it does not close the reproduced fail-open (the repro is
           single-body; (b) narrows cross-call). (a) is UNSOUND — new shape H1d, [EXEC]-compiled exit 0,
           satisfies (a)'s own admission criterion and still leaks. The runtime ALREADY implements
           §14.8.9 correctly (value-scoped, alias-proof); the gap exists only where nothing calls
           _scrml_protect_redact. The `.reveal(` suppressor is an IMPL ADDITION over a spec that mandates
           an unconditional SHALL-fail-closed. RECOMMENDATION: land (c) as the sound floor now
           (subtractive, ~1-2 d, zero adopter migration), then NEW option (d) sink-level lowering as the
           ergonomic restoration. 5 defects routed (3 NEW). WHO-dimension of declassification unmodelled.
rung:      R1-or-R2 — see THE REFRAME. Banked R2 (language-surface) and then DOWNGRADED by
           the Rule 4 governing-sentence gate: most of it is a BUG, not a ruling. What
           remains for the operator is one bounded question, stated at the end.
requested: S350-bryan — the S239 re-review of `egress-tojson-root` found a FAIL-OPEN in
           E-PROTECT-004's declassification handling; three fix rounds proved it unfixable
           by location-keyed analysis.
banked:    S350 2026-08-18
routes-to: scrml PA
```

### ⚑ THE REFRAME — read this before anything else. This was banked as a semantic NARROWING of a ratified primitive. It is not.

The PA and the dispatched agent both framed this as *"narrowing `reveal` is a semantic change to a ratified primitive, hence an operator ruling."* **Both were wrong, and the Rule 4 governing-sentence gate is what caught it.** Neither had read §14.8.9's declassification paragraph; the PA had quoted only the `E-PROTECT-004` catalog row at `SPEC.md:19284`.

`SPEC.md:8506-8513`, verbatim:

> **Declassification — `reveal` (the sole admit path).** A protected-origin column reaches the client **iff** it is explicitly declassified via the field-level `reveal` construct **at the value**:
> ```scrml
> return u.reveal("passwordHash")   // admits the passwordHash column past the egress sink — here only
> ```
> `reveal("col")` stamps the named column's provenance descriptor as **declassified-at-this-value**; the serializer admits a protected-origin column **only** when its descriptor bears a `reveal` stamp **at the sink**.

Four independent phrases — *at the value* · *here only* · *declassified-at-this-value* · *at the sink* — all specifying **value-scoped** declassification. **The implementation's body-scoped (and, on the branch, closure-scoped) `revealed` union is the NON-CONFORMANT state.** Tightening it is **conformance restoration toward an already-normative sentence**, which base §8 classifies as a BUG FIX, not a widening and not an amendment.

**Migration is measured, not assumed: `.reveal(` occurs in exactly TWO `.scrml` files corpus-wide** — `conformance/cases/protect/reveal-suppresses-e004/case.scrml` and `.../reveal-client-visible-runtime/case.scrml`. Both are dedicated cases for this exact mechanism. **Zero adopter, sample, or example usage.**

### Established by execution S350 — do NOT re-derive

The fail-open, PA-reproduced at branch `eb170a84` (exit 0, zero diagnostics, `passwordHash` at HTTP 200):

```scrml
export server function leak(id) {
  let a = ?{`SELECT * FROM users WHERE id = ${id}`}.get()
  let b = ?{`SELECT * FROM users WHERE id = 2`}.get()
  let x = a.reveal("passwordHash")
  return new globalThis.Response(JSON.stringify(b), { status: 200 })
}
```

**Three shapes, three mechanisms — binding identity does not rescue it:**

| | shape | binding identity |
|---|---|---|
| H1 | two sites, two bindings | would fix |
| **H1b** | `let b = a`; reveal `a`, egress `b` | **fixes it BACKWARDS** |
| H1c | one site in a callee, two runtime values | **no location to key on, ever** |

**H1b is decisive and it is a SEMANTIC fact, PA-verified against the shipped helper:** `_scrml_protect_reveal` does `const next = { ...value }` and returns `next`, leaving the receiver tagged. So `a.reveal("pw")` does **not** declassify `a` — keying declassification on the receiver binding would mark `a` and every alias declassified, which is the opposite of the primitive's meaning.

**General statement:** `reveal` is a VALUE-level operation; every fact a codegen pass can compute is LOCATION-level.

### Why this is NOT simply "go implement the spec"

§14.8.9's declassification model is **runtime**: the descriptor rides the value, and the serializer checks the stamp *at the sink*. On the **compiler-owned** egress path that already works and is already value-scoped — `_scrml_protect_redact` reads `d.revealed` off the value itself.

**The gap is only on RAW egress**, where by definition there is no compiler-owned sink to check the descriptor at. There the compiler must decide **statically**, and §14.8.9 says only *"declassify explicitly with `reveal` or project the column out"* — it does **not** specify how a static check should approximate value-scope.

So the real question is narrow:

> **Given §14.8.9 mandates value-scoped declassification, and the static raw-egress gate provably cannot compute value-scope, what static approximation is conformant?**

### The approaches

**(a) Honour `reveal` only where it is syntactically part of the egressed expression.** `return new Response(JSON.stringify(u.reveal("pw")))` admits; a reveal anywhere else does not. Closes H1/H1b/H1c. **Cost, measured by the agent:** breaks two documented spellings — the cross-call helper-reveals-and-returns factoring, and the `?{}.reveal("col")` chain this file already supports. Rescuing those needs a per-function "returns only declassified values" summary — **new interprocedural analysis, not built.**

**(b) Detection cross-call ON, declassification cross-call OFF.** The agent's proposal. Rests on the asymmetry that is the sharpest thing in this item: cross-call **detection** over-approximates SAFELY (a false pairing costs a false positive — that is finding M3); cross-call **declassification** over-approximates into a **FAIL-OPEN**. Reveal is then honoured only in the egress-holder body.

**(c) Fail closed with no static reveal path on raw egress at all.** Raw egress + protected column = always `E-PROTECT-004`; the only remedies are "project the column out" or "return it through the compiler-emitted response". Maximally simple and maximally conformant to the fail-closed policy — and it makes `reveal` purely a runtime/compiler-sink construct, which is what §14.8.9's own mechanism describes.

**PA recommendation: (b), with (c) as the honest fallback if (b)'s bound cannot be stated crisply.** (b) preserves both documented factorings the corpus cases pin while closing every reproduced fail-open. (a) is strictly worse than (b) — same closure, more breakage.

### ⚑ The ONE thing that is genuinely the operator's

Every option above **removes a currently-working spelling** on the raw-egress path. That is `newly-rejecting` — reversible, migration measured at the two conformance cases — so it does not need a ratification under base §8. **But it changes what an adopter can write**, and the operator has ruled twice this month that a mandate an adopter cannot opt out of is itself the defect (S347 D1 `formFor`). The question:

> **Is `reveal`-on-raw-egress a spelling scrml keeps at all, or does raw egress simply become a place where protected columns cannot go?**

Everything else here is a bug fix the PA can dispatch on its own authority.

### Blocked work

`egress-tojson-root` Unit 2 (the interprocedural `E-PROTECT-004`) is HELD on this item. Unit 1 (delete the `toJSON` hook) is clean, verified, and independent — see delta-log [1555] for why the stack still cannot land (the cluster-level `globalThis`-allowlist break, M4).

---

## dpa-034 — `d1-no-editions`: was "no editions, EVER" EARNED, or only assumed from a corpus that could not have shown otherwise?

```
id:        dpa-034
status:    complete   # banked -> running -> complete -> ratified(by PA) · COMPLETE dPA 2026-08-19 (ADVISORY) → DD written, insight CANDIDATE staged, NOT ratified. ⚑ PANEL GAP **CLOSED** 2026-08-19 (round 2) — 5 of 5 poles; the two late voices went live at the next boot exactly as predicted and BOTH refute standing recommendation #3. STILL ADVISORY, still bryan's ruling.
artifact:  scrml-support/docs/deep-dives/d1-no-editions-earned-or-assumed-dpa-034-2026-08-19.md
verdict:   The PA's replacement premise FAILS — `-std=` / `go 1.x` IS coexistence machinery (Go 1.22's
           loop-var change is gated per-package off the module's `go` line; cmd/compile carries both
           semantics), so it is not a "genuine middle". A non-population argument DOES exist
           (conformance-suite singularity + interaction matrix) but earns only "no editions in the 1.0
           surface as built" — the word EVER was never earned. 3/3 poles converged, from unrelated
           directions, that the real unexamined door is TRUE REMOVAL AT A MAJOR, which is logically
           independent of editions. One-way-door claim overstated (Rust: 1.0 in 2015, editions in 2018).
           ⚑ RE-POLL DONE 2026-08-19 (round 2) — gap CLOSED, and it MATTERED (3rd consecutive
           outcome-changing late voice after dpa-019, dpa-035). ★★ BOTH late voices independently
           REFUTE standing recommendation #3: it says re-earn D1 on the "no separate compilation"
           argument, and that is the ONE precondition neither accepts as load-bearing — GHC runs a
           per-file rule-set boundary inside whole-closure-from-source compilation with no registry
           and no separate compilation, so condition 1 explains why per-file flags are CHEAP TO
           BUILD, never why editions are UNNECESSARY. Corrected load-bearing fact = **no registry /
           no independently-versioned, already-committed units** (SPEC.md:23341). ★ TRIPWIRE
           REFUTED — §62.6 is a subset/ceiling gate (its own worked example is an additive MINOR),
           not a divergent rule-set; PLUS it is 100% UNBUILT (E-LANGUAGE-VERSION-TOO-NEW = 0 sites,
           scrml.toml parsed nowhere, no pragma surface at all). Real tripwire = the unresolved
           §62.6-vs-§62.3 MAJOR contradiction, reached independently by 2 disciplines. ★ TRUE-REMOVAL
           3/3 → **4/4**, zero counterexamples (Go · C++ · Haskell all pair no-editions with
           near-permanent per-form availability). ★★ The one-way door is NOT architectural — it is
           the DELETION POLICY (a removed form must be RECONSTRUCTED, not retained; rustc kept 2018
           open because edition-sensitivity is fully absorbed by AST→HIR lowering). ★★ Rec #6's
           instrument is WRONG: chunks.json is WRITE-ONLY (0 read-sites, api.js:3363) — "retain the
           chunk" retains compiled JS OUTPUT, not the ability to compile the old FORM; the
           GHC-precedented per-form expiry-tracked opt-in (NPlusKPatterns shape = Approach C) is the
           only proposed instrument that actually works. ★ §62.8 verbatim contains NO "EVER" — the
           strike lands on "not warranted here"; and §62.6/§62.9 cite Rust editions + C++ -std= as
           scrml's OWN prior art while §62.8 refuses them. ★ vendor: is BUILT + UNVERSIONED
           (module-resolver.js:787) — ruled NOT a counterexample by both voices (source, re-parsed
           fresh each compile; nothing frozen to guarantee interop with), but the adopter-owns-the-
           migration cost is real and should stay in the record. ★ Q2 RESOLVED: GHC2021 needs ZERO
           coexistence machinery — evidence for a cheap named-baseline governance mechanism, NOT for
           rule-set coexistence. ★ The honest claim is "available but not worth it", NOT
           "structurally unavailable" — falsifiable, with a new tracked falsifier.
           → ROUND-2 ARTIFACT: scrml-support/docs/deep-dives/d1-no-editions-round2-panel-gap-closed-dpa-034-2026-08-19.md
           ⚑ The CONCLUSION (no Rust-style A3-guaranteed editions) SURVIVES both late voices intact
           and is better grounded. Only the REASON changes — for the second time.
rung:      R2 minimum — language-architecture, ONE-WAY door. USER rules.
artifact:  scrml-support/docs/audits/sliding-doors-corpus-zero-2026-08-16/rulings-pending/R5-d1-no-editions.md
source:    the sliding-doors audit's OWN #1 recommendation (GRAPH.md "Next": *"Bring bryan R5 —
           one decision, in depth, S346 cadence"*). Written up S348-peter into the audit tree.
banked:    S350 2026-08-19 — into THIS file, the only one the dPA drains
routes-to: bryan (one-way language-architecture door — his ruling, not the PA's)
```

### ⚑ WHY THIS IS BEING RE-BANKED — it is the reason it matters

**Decided worth-asking three days ago and never delivered.** The audit ranked it **the single decision
to bring bryan first among the not-yet-biting**, wrote it up in full, and filed it under
`audits/.../rulings-pending/`. It occurs **ZERO times in this file** — the only artifact the dPA drains
— so it was never going to run and never reached bryan. Fourth instance of that shape found at S350
(delta-log [1562]). **The analysis may already be done: READ THE ARTIFACT before re-deriving anything.**

### The question

**NOT on trial:** the language/compiler semver axis-separation (§62.1-62.4). Load-bearing, stays.

**On trial:** was **"no editions, ever"** (§62.8) earned by a *language-design* argument, or only by the
**"two friends" population premise** — drawn from a corpus that by construction could not have shown
multi-author demand?

### Why it ranks where it does

- **ONE-WAY.** Permitting editions later is an accepting change; refusing now is not cheaply reversible
  once the deprecation machine, the `scrml.toml [language]` pin, and the 1.0-freeze/multi-impl story
  are all built on a single rule-set.
- **Highest-degree not-yet-biting node** in the graph, in a **cycle** with `241 deprecation-window-one-minor`.
- **It calcifies with every deprecation that lands** under the single-rule-set assumption — waiting has
  a running cost.
- **Guard-4 circularity, the sharp part:** D1 and D4 **both terminate at "two friends"** — one premise
  holding up two doors, and the S346 reverse-ouroboros ruling made that premise **inadmissible** for
  whether a capability should exist.

⚑ **CORRECTION — the audit's headline argument is MEASURABLY FALSE, and the PA propagated it into this
entry before checking.** The audit (and this entry's first draft) claimed **adopter #471 FALSIFIES** the
two-friends premise. **PA-verified by execution S350:** `gh issue list --state all` returns **three
authors all time — `pjoliver11` (34), `rjantz3` (15), `bryanmaclee` (9, the owner)** — and **#471 was
authored by `pjoliver11`. "#471" and "Peter" are the SAME PERSON.** Two non-owner authors. **The
population IS two friends; the premise is CONFIRMED, not falsified.**

**This does NOT save the premise — it changes why it must be struck.** Strike it for being **the WRONG
KIND of reason** (S346 reverse-ouroboros: a user count measures the project's REACH, never whether a
capability is RIGHT), **not** for being out of date. Ruling on "the premise is stale" would be ruling on
a false fact. **Four artifacts propagated the falsification claim and one command refuted it** — the §1
laundering trace, and the PA was the fourth hop.

### PA recommendation — WITHDRAWN IN PART (S350, by the dpa-034 deep-dive)

The S348 rec was *"keep no-editions, but RE-EARN it on the Go / C++ `-std=` argument."* **The second
half is self-undermining and is withdrawn: Go's per-module semantics and C++'s `-std=` ARE coexistence
mechanisms** — they pay exactly the price §62.8 attributes to Rust and refuses. They argue the OPPOSITE
case. The conclusion may still survive; that route to it does not.

**Two further findings that reshape the ruling — see the artifact:**
- **The axis in this entry is not the one the SPEC leaves open.** The rulable question is narrower and
  concrete: ***does `[language] version = "1.0"` mean anything when the compiler is 2.0?*** §62.6 says
  *"compile under the pinned rules"* and never mentions a MAJOR; §62.3's anchor table says a removal
  makes the adopter program **"breaks."** Both normative, neither cross-referenced.
- **The strike has almost no target.** §62.8 was already laundered of the premise at authoring time
  (*"not warranted here"*). Of 14 occurrences **exactly ONE is normative — `SPEC.md:36381`, §63.3
  rule 3** — which is **D4's door, not D1's.** The circularity is real but ASYMMETRIC.

### ⚑ Read before ruling: §62 IS 100% UNBUILT, and the no-editions lifecycle ALREADY RAN AND WORKED

**PA-relayed from the deep-dive, which verified both by execution:** `scrml.toml` is never parsed (it is
only a project-root marker), the manifest emitter has no `language` field, and both reserved version-gate
codes are absent — **this entire mechanism is spec-ahead.** And separately: `<machine>` removal already
exercised the no-editions lifecycle **end to end** — it hard-errors `E-DEPRECATED-001`, `scrml migrate`
repairs it in one pass, and the migrated file compiles. Nobody in the founding dossier had run it.

**A third approach exists that is nowhere in the record:** a **bounded, expiring window** (the Dart
shape) — the only middle that covers A's one verified weakness (there is no codemod story for a
*semantic redefinition*, which §62.3 puts in the MAJOR row) without B's permanent cost.

**Artifact:** `scrml-support/docs/deep-dives/language-editions-dpa-034-2026-08-19.md` (942 lines).

### Do NOT re-derive

The compile-probe already measured the door's width: D1.5's pin and D4's machine both assume no
coexistence. **Only the ruling remains.**

