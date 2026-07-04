# DISPATCH — E-TYPE-046: member-access-through-possibly-`not` typer check + `?.` spec-conformance
change-id: `e-type-046-optional-member-access-2026-07-04`
Agent: addb6488118bf8610 · dispatched S237 · isolation:worktree · base 097b5452 · scrml-js-codegen-engineer

Implements the ratified S237 SPEC amendment (landed 097b5452). Typer E-TYPE-046 check + `?.` result-typing + §34 catalog row + corpus migration + conformance case + tests.

## The rule (SPEC §42.3.5 / §42.3.6)
Member access `recv.field`/`recv[key]`/`recv.method(...)` through a PLAIN-OPTIONAL (`T | not`/`T?`, `not` inhabits the type, no lifecycle) receiver = E-TYPE-046, UNLESS optional-chained (`recv?.field`) or narrowed (`if=`/`show=`/`given`/`is not`/`match`).
BOUNDARY: lifecycle receivers (bare-`T` Shape-4 cell / `(not to T)` return) fire E-TYPE-001 (pre-transition), NOT E-TYPE-046 — a receiver fires exactly one.
Per-hop: `?.` guards only its immediate receiver (`@user?.address?.city`, not `@user?.address.city`).

## Tasks
1. Typer check in type-system.ts (reuse the E-TYPE-001 narrowing machinery; fire on plain-optional member-access; suppress on `?.`/`if=`/`given`/`is not`/`match`/non-optional/lifecycle). VERIFY `if=`/`show=` narrowing is respected (may need adding).
2. §34 main-catalog E-TYPE-046 row (after E-TYPE-044) + `recv?.field` result-typing = `F | not`. Confirm `?.` already lowers to JS `?.`.
3. Corpus migration (examples/samples/conformance/stdlib/benchmarks) SAME LANDING; STOP if >~25 files (over-fire signal).
4. Conformance case pinning both halves (codes: E-TYPE-046 fires; runtime: `?.` renders nothing on absence + `if=` guard path).
5. Unit/integration tests (every fire + suppress case).

## Verify
Full `bun run test` (0 regressions) · within-node allowlist re-baseline if fixtures touched (S198) · R26 empirical (E-TYPE-046 fires on bare plain-optional; `?.`/`if=` pass; bare-`T` still E-TYPE-001) · adversarial edge matrix (S215).

## Full brief
The complete dispatch brief (with the F4 startup-verification + path-discipline block, the MAPS block, the exact §34 row text, and the fire/suppress case lists) was the Agent `prompt:` for agent addb6488118bf8610, S237. This BRIEF.md is the archived record (S136); the operative copy is the transcript.
