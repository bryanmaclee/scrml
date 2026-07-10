# BRIEF — refinement static-eval (§53.4.2 rule 2) — 2026-07-10 (S136)

Archived verbatim per the S133 DD Rec #14 / S135 operationalization (archive the
dispatch prompt at dispatch time).

---

Fix one refinement-type divergence (impl#1-vs-SPEC §53.4.2, PA-ruled fix-impl → STATIC EVAL) + author the conformance case it unblocks. Isolated worktree — do NOT land to main; commit on your branch; PA reviews (S239) + lands. Reproduce empirically first; Rule 4 (read SPEC §53 in full; author to the SPEC).

## The divergence (§53.4.2 static provability)
SPEC §53.4.2 (rule 2) + §53.11 say a string **literal** that violates a named-shape predicate is STATICALLY PROVABLE → fire `E-CONTRACT-001` at COMPILE time (the SPEC cites `let e: string(email) = "user@example.com"` as "proven"). Empirically, impl#1 does NOT statically evaluate a named-shape OR regex against a string literal — both `string(email) = "not-an-email"` and `string.pattern(/^[^@]+@[^@]+$/) = "not-an-email"` compile clean, deferring to the runtime boundary check (`E-CONTRACT-001-RT`, which DOES fire). By contrast impl#1 DOES static-eval NUMERIC literals (`-50` fails `number(>0)` at compile). So the impl is INCONSISTENT: numeric literals are statically checked, string named-shapes/regex are not.

**bryan ruled: STATIC EVAL** — extend the compile-time static evaluation to string literals against named-shapes (`email`, etc.) and regex `pattern(/re/)`, firing `E-CONTRACT-001` at compile time (consistent with the numeric path). The runtime boundary check stays as the backstop for non-literal values.

## Scope + caution
- Read SPEC §53.2.1 (the EBNF — `pattern(...)` is dot-chained `string.pattern(/re/)`, §53.6.1; the named-shape form is `string(email)`), §53.4.2, §53.6.1, §53.11 in full. Author to these.
- The named-shapes (`email`, etc.) are decidable predicates; a regex against a string LITERAL is decidable (run the regex on the literal at compile). Find where impl#1 statically evaluates the NUMERIC refinement (`E-CONTRACT-001` compile-time fire site) and extend the same static-eval path to the string named-shape + regex cases.
- If a named-shape's predicate is NOT statically decidable (e.g. references external/runtime state), it correctly stays deferred to the runtime boundary — do NOT force static-eval there. Only literal-vs-decidable-predicate is static.
- If the fix turns out to require broad refactoring of the predicate-eval engine, STOP and report the scope rather than over-building.

## Author the unblocked conformance case (conformance/cases/refinement/)
The ss62 verify-pass flagged GAP-2: the string-shape refinement boundary is untested (existing cases only use numeric). Author: a string named-shape refinement where a VIOLATING literal fires `E-CONTRACT-001` at compile (the newly-static case) + a conforming literal compiles clean + inhabits. Use canonical syntax `string(email)` / `string.pattern(/re/)` (NOT `string(pattern(/…/))` which is invalid §53 syntax). Follow the existing refinement/ case shape.

## Verify
Reproduce first (scratchpad). `bun conformance/run.ts` all green + full pre-commit gate — 0 fail (typer change = wide blast radius; a new compile-time error could red pre-existing samples/cases that relied on the deferred behavior — check + reconcile or report). Commit per-item on your branch; do NOT push/advance main.

## Deliverables
- S136: `docs/changes/refinement-static-eval-2026-07-10/BRIEF.md` + progress.md.
- Return: the static-eval fire-site + how you extended it; whether any pre-existing case/sample flipped red (and how reconciled); the conformance case-id(s) authored; oracle before→after; full-gate result; branch tip SHA. Do NOT claim done without the gate + oracle output. Do NOT land.
