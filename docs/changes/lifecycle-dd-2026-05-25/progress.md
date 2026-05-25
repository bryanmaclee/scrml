# Lifecycle Annotation Extension + Flagship Scope Deep-Dive — Progress

## 2026-05-25 T0 — Scope lock + reading authority anchors

Started Phase 1. Read SPEC.md §14.3 / parent DDs / HU-2 F-024 / user-voice S129.

## 2026-05-25 T1 — Phase 1 complete

- SPEC §14.3 line 7106 normatively defines `(A -> B)` lifecycle annotation; "compiler tracks this transition; accessing before transition is E-TYPE-001"
- HU-2 F-024 ratified the `to` contextual keyword: `(A to B)` is the post-amendment canonical form
- HU-2 F-023 ratified PRIMER + kickstarter FLAGSHIP treatment
- Confirmed via grep: PRIMER + kickstarter v2 carry ZERO `(A -> B)` mentions
- User-voice S129: "foundational, not peripheral... my first real novel idea for scrmls type system"
- Parent DD state-dynamics-design-2026-04-08 status: active for ~7 weeks
- Sibling debate-state-dynamics resolved transitions question (hybrid A+C); does NOT resolve lifecycle extension scope

## 2026-05-25 T2 — Critical compiler finding

type-system.ts:1444 resolves `(A -> B)` to type B (post-transition type) — but does NOT track the transition state per access. The E-TYPE-001 fire promise in SPEC §14.3 line 7106 (access-before-transition tracking) is NOT implemented. Tests at type-system.test.js:399/1243 use post-S89 OBSOLETE syntax `(null -> string)` and assert only that resolution returns `string`. The article publish-twin (mutability-contracts-devto-2026-04-29) carries an explicit "lifecycle/typestate layer is SPEC-ratified but not yet implemented" status banner.

## 2026-05-25 T3 — Phase 2 prior art complete

- Strom/Yemini 1986 NIL — original typestate, IBM Watson Lab; uninitialized→initialized; Hermes generalization
- Plaid (CMU, Aldrich/Sunshine) — first-class state change, methods/fields change with state, permission-based
- Rust typestate — phantom types + ownership-consume; `Connection<Disconnected>` pattern; no transitions block
- Granule — graded modal types; resource tracking; file-handle close-exactly-once
- Pony — six reference capabilities (iso/ref/val/box/trn/tag); permissions not lifecycle but related
- Sage (Flanagan UCSC) — hybrid typing, refinement types + dynamic checks; foundational paper POPL 2006
- Idris/Idris2 — dependent types + quantitative types (multiplicity 1); Session types EDSL; STM resource-dep
- Liquid Haskell — refinement predicates, Z3 SMT; not typestate-shaped
- Fugue/Plural (Bierhoff/Aldrich CMU) — modular typestate verification + fractional permissions for Java

## 2026-05-25 T4 — Phase 3 expert synthesis complete

Read agent-store files for: scrml-typed-change, scrml-state-types, rust-result-statemachine, rust-exhaustive-enums, haskell-adts, ocaml-polymorphic-variants. Synthesizing positions on lifecycle-extension-to-enum-state-cells question.

## 2026-05-25 T5 — Writing final report

Drafting deep-dive output at scrml-support/docs/deep-dives/lifecycle-annotation-extension-and-flagship-scope-2026-05-25.md
