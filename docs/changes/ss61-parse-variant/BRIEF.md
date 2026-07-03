# BRIEF — ss61 item 1: parseVariant §41.13 conformance cases

sPA ss61 · item 1/3 · dispatched to `scrml-js-codegen-engineer` (self-provisioned worktree) · base `cfba6295`.

## Task
Author impl-agnostic conformance cases under `conformance/cases/parse-variant/` for the L22 `parseVariant(json, EnumType)`
primitive, covering BOTH normative halves of §41.13:
- **(b) runtime happy-path:** valid JSON → correct tagged variant, asserted via `state` (`{variant, data}` snapshot).
- **(b) runtime failures:** the 4 `ParseError` modes (MissingDiscriminator / UnknownVariant / InvalidPayload / Malformed)
  routed through `!{}` → error variant in state.
- **(a) compile-time codes:** each `E-PARSEVARIANT-*` misuse code (exact names read from §41.13), asserted via `expect.codes`.

## Method (load-bearing)
author-from-impl#1-OBSERVED-behavior → cross-check normative §41.13/§53.14 → **ESCALATE divergences** (park + report, never
invent a passing case on a wrong oracle). Mirror `conformance/cases/form-for/` + `conformance/cases/forms/validator-invalid/`.
Every (b) case carries MANDATORY `spec: "§41.13"` + `rationale`. Verify `bun conformance/run.ts` (72 baseline + new, all green).

## Constraints
- Touch ONLY `conformance/cases/parse-variant/**`. Path discipline: worktree-relative writes only; no main-absolute leakage.
- Commit incrementally on `ss61-parse-variant`; no `--no-verify`; never push/advance/merge main.

Full dispatched prompt is the Agent() call in the sPA session transcript (S235, ss61 parallel to ss55).
