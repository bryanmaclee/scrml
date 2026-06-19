# sPA Lists — Index

**Purpose:** the human-facing map of sPA sub-sessions. Each `ss<N>` is a speciality-clustered
work-list (bugs + features + experiments mixed; clustered by SHARED INGESTION — "what you must know
to scope + brief them," not by work-type). Launch one with **`read spa.md ss<N>`**.

Built by the PA's full-project scan (S208, workflow `spa-list-builder` — 137 items → clusters), then
**consolidated** (S208): the scan's 26 fine-grained Bucket-A clusters were merged into **14 broader
subsystem lists** (tiny 1-2-item clusters folded into the nearest subsystem; substantial clusters
kept). The sPA consumes; it does not edit the clustering. Contract: `../../scrml-support/spa-scrml.md`.

**Three buckets by shape:** **A** = sPA execution lists (bounded ingestion, buildable). **B** =
design-track (debates / DDs / from-scratch subsystems / axiom Qs) → PA/dPA, **not** the sPA. **C** =
closed/non-work.

> **List files:** each `ss<N>` expands to `ss<N>-<speciality>.md` (shared-ingestion · coreFiles ·
> ordered items with footprints + brief-seeds, pulled from the scan). Expanded on demand at launch
> (the scan output `wf_4c184883-41e` is the source); `ss1` is written as the worked example.

---

## Bucket A — sPA execution lists (14, consolidated)

| ss | speciality | merged from | n | core files | shared ingestion (one-liner) |
|----|-----------|-------------|---|-----------|------------------------------|
| 1 | server-emit-route-inference | pure-module-arc · type-system-route-server · sql-batching | 6 | emit-server.ts · api.js · route-inference.ts · type-system.ts(E-ROUTE-003) · db-driver.ts | the server-bundle emission / route-inference / wire-serializability triangle. **g-pure-module HIGH + Fix B DONE S208**; residual = the route-mis-inference fix + SQL-row-protect-leak + Postgres/MySQL drivers. |
| 2 | engine-codegen-statechild | (kept) | 5 | symbol-table.ts · emit-engine.ts · engine-graph.ts | engine-decl parse + emit-engine codegen + §51.0 semantics; opener-effects raw-text, server-flag swallow, :-shorthand interp drop. |
| 3 | codegen-expr-attr | emit-expr-residuals · is-op-bare-literal · render-expr-asis | 8 | emit-expr.ts · codegen/rewrite.ts · tokenizer.ts · type-system.ts(visitAttr) · component-expander.ts | the emit-expr accessor + attribute-value + is-op-rewrite + render-expr-fence codegen/diagnostic surface. |
| 4 | block-splitter-native-parser | block-splitter-scanners · native-parser-conformance | 6 | block-splitter.js · match/engine-statechild-parser.ts · native-parser/* · dual-pipeline-canary.js | the structural front-end: BS scanners + statechild parsers + Charter-B native parser + conformance. |
| 5 | channel-codegen | (kept) | 4 | emit-channel.ts · ast-builder.js · route-inference.ts · migrate.js | channel pipeline (emit-channel reparse + export-channel raw-text body + classification + migrate); v0.3 placement reversal. |
| 6 | type-system-lifecycle-refinement | q6-reset · refinement-freeze-formfor · engine-substate-conformance | 7 | type-system.ts · block-splitter.js · symbol-table.ts · derived-mutation-ops.ts | type-system.ts §6.8 lifecycle/reset + §53 refinement + §54 substate conformance skips. |
| 7 | meta-reflect-l22 | (kept) | 5 | meta-checker.ts · type-system.ts · meta-eval.ts | meta-checker reflect()/L22 family + §53.14.4 synonym-gate. _2 bugs sPA; the OQ + L22-tail + serialize ESCALATE (design)._ |
| 8 | promotion-tailwind | (kept) | 3 | tailwind-classes.js · commands/promote.js | the narrow utility-codegen engines: tailwind class engine (§26 var() model) + promote --engine (§56). |
| 9 | server-authority-keyword | server-authority-tier-ssr · server-keyword-deprecation | 5 | route-splitter.ts · type-system.ts(W-AUTH-002) · route-inference.ts | §52 server authority/SSR-prerender + the deprecated `server` keyword elimination residuals. |
| 10 | e2e-render-map-test-hygiene | e2e-render-map-harness · test-hygiene-verified-bit | 8 | e2e-render-map/* · examples/test-examples.js · todomvc.spec.ts · VERIFIED.md | the e2e render-map harness (L1/L2/L3 oracle) + the legacy smoke-test / verification-ledger anti-patterns. |
| 11 | doc-currency-corpus | doc-currency-ouroboros · doc-corpus-content-rewrite-v020 | 8 | docs/articles/* · docs/tutorial.md · examples/ · samples/ · README.md · SCOPE-MAP | derived-doc currency (corpus trails code) + the big v0.2.0 public content rewrite (B1/B2/C1/C2/C3). |
| 12 | selfhost-mirror-parity | (kept) | 6 | self-host/ast.scrml · self-host/api.js · ast-builder.js | self-host .scrml mirrors + bootstrap parity. _Mostly post-v1.0 deferred / experiments — low priority._ |
| 13 | phantom-codegen-nominal-stdlib | phantom-codegen-nominal-flips · stdlib-canonical-form | 5 | SPEC.md(Nominal) · api.js · compute-program-config.ts · module-resolver.js · stdlib/* | green-field Nominal-flip impls (§23 / §29 / §58 / §59) + the stdlib canonical-form (throw/try/bun-import) migration. |
| 14 | flograph-residuals-orphans | maps-flograph-provenance · misc-actionable-orphans | 6 | scripts/flograph.ts · scripts/dock.ts · block-analysis.ts | flograph provenance-sweep + doc-deref residuals + the actionable singletons (phantom-block D6 · MCP-V0.D · GITI-015 · each-body-sigil test-classifier). |

## Bucket B — PA / dPA design track (NOT sPA — routed to PA/dPA)

| cluster | n | why not sPA |
|---------|---|-------------|
| flogence-block-lease-dock | 12 | the flogence build — design-open + greenfield-in-scrml; PA/flogence-PA owns it. |
| each-inline-component-instance | 4 | Approach A = from-scratch component-instance subsystem, design-open (2 blockers unmeasured). |
| vpa-dpa-deputy-process | 5 | PA-continuity meta-process (Function-4 adopt, dPA stand-up); PA-direct + dPA. |
| markup-lease-design-debate | 2 | a debate (D-vs-G) + a genuinely-open region-boundary rule; needs /forge + /debate. |
| ts-migration + codegen-IR refactor | 2 | codegen-IR is design-open (no DD); ast-builder TS-migration is a large lockstep arc. |
| maps-vs-flogence retire-question | 1 | carried design conversation (S207 user Q). |
| deputy-context-economics-measure | 1 | a measurement experiment on the deputy boot-size. |

## Bucket C — closed / non-work (dropped from registry)

| cluster / item | n | disposition |
|----------------|---|-------------|
| stale-status-reconciles | 9 | ALL already `status=resolved` in known-gaps; PA verifies §0 counts reflect them — not sPA work. |
| async-loading-design-resolved | 2 | RATIFIED design-resolved S197 (A+D / DON'T-BUILD) — records, not build items. |
| singletons: p6-research / misc-low-board-residuals / cross-function-body-split / full-body-split / event-payload-transition-primitive | 5 | parking-lots + deferred-research records + a shipped-design record; no scoped change. |

## Status legend (per item, in each list file)

`open` · `in-flight` (dispatched) · `landed-on-branch` (on `spa/ssN`, awaiting PA re-integration) ·
`integrated` (merged to main by the PA) · `parked` (escalated to PA / blocked) · `dropped`.

<!-- @source: workflow spa-list-builder wf_4c184883-41e (S208, 2026-06-19); consolidated 26→14 Bucket-A. -->
