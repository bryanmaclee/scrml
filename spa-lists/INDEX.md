# sPA Lists — Index

**Purpose:** the human-facing map of sPA sub-sessions. Each `ss<N>` is a speciality-clustered
work-list (bugs + features + experiments mixed; clustered by SHARED INGESTION — "what you must know
to scope + brief them," not by work-type). Launch one with **`read spa.md ss<N>`**.

Originally built by the PA's full-project scan (S208, workflow `spa-list-builder` — 137 items →
clusters), consolidated 26→14 broader subsystem lists. **REBUILT S210** over current-open state (this
rebuild): every `spa/ss1-ss14` branch except `ss13` is GONE/merged, so all "landed-on-branch" carried
items were verified INTEGRATED in HEAD and routed to Bucket C; the big S210 landing waves drained most
clusters; the **fattening rule** (same-ingestion only — no cross-ingest to hit a size target) was
applied. The sPA consumes; it does not edit the clustering. Contract: `../../scrml-support/spa-scrml.md`.

**Three buckets by shape:** **A** = sPA execution lists (bounded ingestion, buildable). **B** =
design-track (debates / DDs / from-scratch subsystems / axiom Qs / rulings) → PA/dPA, **not** the sPA.
**C** = closed/non-work (integrated/resolved/already-done/verify-then-close).

> **List files:** each `ss<N>` is `ss<N>-<speciality>.md` (fill-note · shared-ingestion · coreFiles ·
> ordered items with `[status=open]` + footprints + brief-seeds). The PA re-orders / re-scopes /
> refreshes them; the sPA consumes them read-only. Retired specialities keep their files + numbers
> (reserved) — they are MARKED retired below, never deleted.

---

## Bucket A — sPA execution lists (11 surviving + 3 retired)

| ss | speciality | n | core files | shared ingestion (one-liner) | fill-target |
|----|-----------|---|-----------|------------------------------|-------------|
| 3 | codegen-expr-attr | 3 | rewrite.ts · emit-event-wiring.ts · emit-html.ts · expression-parser.ts | bare-compound is-op / is-op-ternary / `@.`-sigil lowering at the codegen-expr stage. | ~55% · at-ceiling |
| 8 | promotion-tailwind | 2 | tailwind-classes.js · collect-class-names.ts · emit-css.ts · commands/promote.js | tailwind utility-class compilation (arbitrary-value remainder) + the promote `--engine` lift. | ~58% · at-ceiling |
| 11 | doc-currency-corpus | 8 | tutorial.md · ARTICLE-TRUTHFULNESS-AUDIT · articles/ · README.md · website/ · examples/ · samples/compilation-tests/ | doc/corpus currency + the canonical-scrml v0.2.0 content rewrite (B1/B2/C1/C2/C3). | ~62% · healthy (fattest exec) |
| 4 | block-splitter-native-parser | 3 | block-splitter.js · component-expander.ts · ast-builder.js · native-parser/lex.js · token.js | parse-front-end: block-match-in-lift context + lexer residuals + ast-builder fn-span. | ~55% · healthy |
| 12 | selfhost-mirror-parity | 5 | self-host/ast.scrml · bs.scrml · ts.scrml · api.js · ast-builder.js · type-system.ts | self-host `.scrml` mirror parity + idiomification + L2/L3 bootstrap. _LOW / mostly post-v1.0._ | ~55% · healthy |
| 1 | server-emit-route-inference | 2 | route-inference.ts · emit-server.ts · codegen/index.ts · api.js | the server-bundle emission / route-inference triangle (route-001 over-fire + const-only no-emit). | ~48% · at-ceiling |
| 7 | meta-reflect-l22 | 2 | meta-checker.ts · rails-dev.scrml · render-harness.js | `reflect()`/`^{}` meta-eval + happy-dom mount (variant-shape + mount-hang). | ~45% · at-ceiling |
| 10 | e2e-render-map-test-hygiene | 1 | e2e-render-map/seed-fixtures.js · render-harness.js · render-detectors.js | render-map harness needs-server classification (verify-close). | ~30% · at-ceiling |
| 5 | channel-codegen | 1 | type-system.ts · emit-server.ts | channel codegen + server-fn typed-object-literal-return (`E-SCOPE-001` over-fire). | ~30% · at-ceiling |
| 2 | engine-codegen-statechild | 1 | emit-engine.ts · symbol-table.ts · type-system.ts | engine codegen + derived-engine autoderive crash. | ~28% · at-ceiling |
| 6 | type-system-lifecycle-refinement | 2 | type-system.ts | §6.8 reset/lifecycle heuristics (Q6-narrow). _Both deferred-confirmed, friction-gated._ | ~25% · at-ceiling |
| ~~9~~ | ~~server-authority-keyword~~ | — | — | **RETIRED this rebuild.** All sPA work integrated S210; survivors (SSE-keyword KEEP near-dup, §20.5 ruling, g-tier1-ssr-prerender) are all design → Bucket B. Number reserved. | — |
| ~~13~~ | ~~phantom-codegen-nominal-stdlib~~ | — | — | **RETIRED this rebuild.** All items are Nominal feature arcs or the stdlib §40.4 ruling → Bucket B. `spa/ss13` branch still LIVE (the stdlib entry-test .skips). Number reserved. | — |
| ~~14~~ | ~~flograph-residuals-orphans~~ | — | — | **RETIRED this rebuild.** All landed except the ast-builder fn-span overshoot (re-clustered into ss4) + the deref/dock-with-support ruling (Bucket B). Number reserved. | — |

> **AA singleton (deferred to PA, no ss-number minted):** 6nz AA (bare tail `match` in a plain function
> silently dropped) is the ONLY still-open S210-intake sPA bug, but has NO same-ingestion Bucket-A
> cluster (typer/codegen match-value-discard; doesn't fit ss3 expr/attr nor ss6 lifecycle). NOT forced
> into a list to hit a size target (fattening hard-constraint). PA decides: mint `ss15-match-value-discard`
> if more match-value items accrue, OR attach to ss3 only if the value-discard IIFE locus overlaps the
> codegen-expr understanding. Decide lint (W-/I- partition) vs hard error; `Y` already fires loud
> `E-MATCH-ARM-SEPARATOR` (same family). Repro in the 6nz inbox.

## Bucket B — PA / dPA design track (NOT sPA — routed to PA/dPA)

| cluster | why not sPA (ruling / DD / debate / from-scratch subsystem) |
|---------|-------------------------------------------------------------|
| input-state-markup-reactivity (6nz AF) — §36 codegen RULING | input-state markup reads emit render-ONCE (non-reactive); fork (a) codegen-gap wrap in `_scrml_effect` vs (b) by-design rAF→@cell idiom. Design-track until ruled; sibling of AC (read PATH fixed S210). |
| flogence raw HTTP route primitive — DD-shaped capability | author-declared raw route (POST/SSE JSON-RPC); ~80% exists, missing 20% (route PATH, multi-method, raw envelope, bearer auth); 5 OQs incl. primitive SHAPE. Likely deep-dive then build (emit-server.ts). |
| external-backend (frontend-only) — DD DONE, verdict = run a DEBATE | DD status:current; verdict = @debate-curator framing B vs C vs A (judge may land D). SSR-of-external-data GAPPED. Surface verdict FIRST (no batch-ratify); consider forging openapi-codegen-expert. |
| stdlib Phase 3 canonical-form + §40.4 ruling (ESCALATE) | migrate 11 stdlib `.scrml` off throw/try/bun-import; 3a changes fn contracts (every caller failable); 3c needs §40.4 amendment OR vendoring. `spa/ss13` branch still live. PA/dPA scope before dispatch. |
| g-tier1-ssr-prerender — server-authoritative SSR architecture/DD | 3 inventory entries merge; substantial new subsystem (server-render markup + flash-free hydration); §52.8 names both tiers. Architecture/design pass first. Intersects external-backend SSR gap. |
| g-component-body-markup-parser-absent → unblocks b17 cases 1-3 + each-inline-component | component-def body stored as raw:string, never re-parsed; from-scratch component-body markup parser is the precondition (DESIGN-TRACK; native-parser MK-layer charter). |
| native-parser front-end M2-M6 default-flip — STANDING USER DECISION (~v0.8) | parser BUILT; Phase-A default-flip is a standing user decision — surface, do NOT auto-build. Phase-0 SURVEY-STOP first; per-milestone dispatches, not a bulk run. |
| §54 Phase 4h transition return-type narrowing — BLOCKED on §54.6 NC-3 SPEC gap | one-line SPEC amendment (assign NC-3 code) unblocks the narrowing build + 2 conformance tests; +30 s33/s48/s51/s54 skips need unimplemented machine audit/replay harness. Design-gated. |
| meta-l22 design forks — compiler.* / variantNames / serialize / serializability | 4 ss7 escalations: read-only `compiler.*` API; `variantNames`+reflective metadata; serialize (§57 likely JSON.stringify synonym, needs DD); server-generator yield serializability. All live design decisions. |
| channel design-open — cross-file v0.3 A8 + Enhanced-A auto-migrate (reverses S189) | P3.A cross-file `<channel>` blocked on unimplemented v0.3 A8 + PURE-CHANNEL-FILE dispensation; Enhanced-A auto-strip REVERSES S189 (Minimal-A chosen), zero corpus demand. |
| e2e-render-map oracle strategy — L1 gap-ingestion + L2/L3 fork | step-5 baseline-cells→@gap DEFERRED at L1; L2 (snapshot/VERIFIED.md provenance) + L3 (legacy-vs-native differential) = oracle fork debate. Surface to user. |
| selfhost-mirror-parity — full self-host port arc (post-v1.0) | 6 ss12 OPEN items framed as the bulk arc; PA sequences post-v1.0. (The 5 same-ingestion items ARE the Bucket-A ss12 list; this is the bulk-sequencing note.) |
| phantom-codegen Nominal feature arcs (§23 sidecar/WASM, §29 vanilla-interop, §58 build-story) | §23 phantom-codegen (article amendment vetoed); §29 friction-gated (Bug 10 trigger unmet); §58 M6-gated ~90-200h; + nominal-2/3/8/9 (native-parser-gated / partly-landed S148 verify). Feature-track. |
| a5 const-deep-freeze + form-for smart-input — adoption/design-gated type-system | `object(frozen(deep))` deferred with adoption-watch (≥2 reports, none filed); form-for refinement→input mapping needs a ratified predicate→input-type mapping + FieldInfo plumbing. Gated on signal/ratification. |
| selfhost feature arcs — emit-sql-ref / leading-: tokenizer / bunsql-pg-mysql / P4-batcher / sql-row-protect-leak | cross-subsystem PARKED→PA: emitSqlRef prereq unbuilt; leading-`:` START-class broad blast; PG/MySQL async-PA migration; P4 post-v1; sql-row-protect-leak net-new §14.8 analysis. Prereq/design-blocked. |
| §20.5 SPEC examples migrate-vs-carve-out + despace residual — RULING | turns on whether session-access is a §12.2 escalation trigger; read §12.2+§20.5 in full; coordinates with §4 despace residual (194 SPEC openers owed). SPEC-amendment-track. |
| flograph deref ruling — FULLY-superseded-only §2.1 clause | 1-line §2.1 clause 'deref applies to FULLY-superseded only'; MARK-only; + dock --with-support remainder + docs/graph/* tracking-policy call. Doc-governance ruling. |
| flux-mmorpg dogfood — project / Bucket-B (engines-everywhere flagship) | shared server-authoritative MMORPG dogfood; '§52 server-sync blocker' framing STALE (auto-persist retracted S194); real gate partly on g-tier1-ssr-prerender. Project-scale — surface for prioritization. |
| INDEX carried Bucket-B design clusters | flogence build (n=12) · each-inline-component (n=4, folds into component-body-parser) · vpa-dpa-deputy-process (n=5) · markup-lease-design-debate D-vs-G (n=2) · ts-migration + codegen-IR refactor (n=2) · maps-vs-flogence retire-question (n=1) · deputy-context-economics-measure (n=1). |

## Bucket C — closed / non-work (integrated / resolved / already-done / verify-close)

| cluster / item | disposition |
|----------------|-------------|
| g-engine-name-attr-swallows-var-duplicate (both entries) | **RESOLVED S210** — option (b) landed (agents a1ad1907+faa213c5); name= RATIFIED-CANONICAL §51 P1/DD1; reject-direction DISCARDED as a P1 reversal. Full suite 24659/0; Board HIGH-1 CLOSED. |
| 6nz AD — attr-interp fn-rename | **RESOLVED S210** (agent ad6ae550) — code-segments.ts now descends into `${...}` interp; general fix (also corrects not/is-lowering inside `${...}`). |
| flogence regex/string literal-arg miscompile | **RESOLVED S210** (agent 2f94b140) — TWO roots (regex-literal branch + braced-body re-quote); R26 + value-asserting regression tests. |
| spec-59-currency-flip-nominal-to-implemented | **ALREADY CURRENCY-CORRECTED S210** — SPEC-INDEX row 105 IMPLEMENTED; known-gaps S171 says BUILT S169. No flip work remains. |
| ss1 server-emit landed items | **INTEGRATED** — spa/ss1 GONE; g-route-mis-inference RESOLVED S209; A4 stale-row closed. PA currency-edits §0.1 row A4. |
| ss2 engine-codegen-statechild landed items | **INTEGRATED** — spa/ss2 GONE; W-ENGINE-SERVER-DEFERRED in HEAD; payloadBindings residuals LOW; b17 cases 1-3 → Bucket B. |
| ss3 codegen-expr-attr landed items | **INTEGRATED** — spa/ss3 GONE; fingerprints verified in HEAD; g-component-001 NOT-REPRODUCED; @. expr-parser root re-clustered into live ss3. |
| ss4 block-splitter landed items | **INTEGRATED** — spa/ss4 GONE; lexer 5/8 flipped (3 residuals → live ss4); A2 stale-row PA currency-edit queued; derived-value-compound-mutate (a)+(b) landed. |
| ss5 channel-codegen landed items | **INTEGRATED** — spa/ss5 GONE; cross-file P3.A + Enhanced-A → Bucket B. |
| ss9 server-authority-keyword landed item | **INTEGRATED** — spa/ss9 GONE; emit-logic.ts:1699/1805 present; §20.5 escalation flag + SSE-keyword KEEP → Bucket B. |
| ss10 e2e-render-map landed items | **INTEGRATED** — spa/ss10 GONE; needs-server + server-classification harness landed; L1 gap-ingestion + L2/L3 oracle fork → Bucket B. |
| ss11 doc-currency landed items | **INTEGRATED** — spa/ss11 GONE; §11→§52 sweep + §52-retraction reword + kickstarter despace landed; residual doc-currency re-clustered into live ss11. |
| ss14 flograph-residuals landed items | **INTEGRATED** — spa/ss14 GONE; D6 fixed; SEPARATE ast-builder fn-span overshoot → live ss4; deref/dock-with-support → Bucket B; bug-18 → ss3. |
| value-native-maps-impl (ss13 item5) | **ALREADY BUILT S169** — 202/202 suites; doc-reconcile folded into spec-59-currency (already corrected). No build. |
| INDEX carried Bucket-C (n=16) | **CLOSED** — stale-status-reconciles (status=resolved) · async-loading-design-resolved S197 (A+D DON'T-BUILD) · parking-lots / research-records / shipped-design records. No scoped change. |
| bug-54 tableFor :let slot body | **VERIFY-CURRENCY-THEN-LIKELY-CLOSED** — r28-2 row says Bug 54 un-deferred + CLOSED S143 for :let arrow. Cross-check S143 closure before any dispatch; if a residual remains it belongs in ss4 (block-splitter parse layer). Do NOT dispatch without the currency check. |

## Status legend (per item, in each list file)

`status=open` · `in-flight` (dispatched) · `landed-on-branch` (on `spa/ssN`, awaiting PA
re-integration) · `integrated` (merged to main by the PA) · `parked` (escalated to PA / blocked) ·
`dropped`.

<!-- @source: workflow spa-list-builder wf_4c184883-41e (S208, 2026-06-19); consolidated 26→14 Bucket-A. -->
<!-- @rebuild: S210 (2026-06-20) over current-open state @ HEAD 135c8a78 — branches ss1-ss14 (except ss13) GONE/merged → landed items routed to Bucket C; fattening rule applied (same-ingestion only); ss9/ss13/ss14 RETIRED (numbers reserved); AA singleton deferred to PA. -->
