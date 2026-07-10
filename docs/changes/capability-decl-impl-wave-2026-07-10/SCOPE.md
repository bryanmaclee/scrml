# SCOPE — §23.5 capability-declaration impl wave (V1-floor build)

**Status:** scoped, not yet built (bryan "scope the build"). **Change-id:** `capability-decl-impl-wave-2026-07-10`.
**Why:** N1 capability-vocab is V1-REQUIRED but is SPEC-TEXT-ONLY (S232 `e321da1e` was spec-only; the impl
wave never landed). Worse, its Nominal state fails-OPEN — `capabilities=[network("api.example.com")]` (SPEC
§23.5.2 advisory example) HARD-FAILS with a misleading fatal `E-SCOPE-001` (bracket misparsed as an
expression → tokens resolve as undefined scope refs), violating the fail-closed-Nominal invariant (§4 crit-3).
Because §23.5.1 makes the declaration ADVISORY/non-blocking, the correct v1.0 behavior is
recognize+validate+advisory-lint — NOT a fail-closed stub. Full escalation +
empirical behavior table: `docs/changes/conformance-capability-2026-07-09/progress.md` (branch `ce3b84d7`).

## Normative source (Rule 4 — read in full before building)
SPEC §23.5.1–§23.5.7 (SPEC.md ~L16402-16535) + the `capabilities=` row in the §4.12.2 attr table (L732).

## Build items (v1.0 = DECLARATION half only; enforcement §23.5.6 stays DEFERRED)
1. **Register `capabilities=` as a `<program>` attribute** — add to `compiler/src/attribute-registry.js`
   `<program>` `allowedAttrs` (~L82-162). Suppresses the incidental `W-ATTR-001`. Allowed at top-level too
   (per the §4.12.2 row: "YES (and top-level)").
2. **Parse the value as a capability-token LIST, not a general expression** (the core fix). Per §23.5.2 EBNF:
   `[' capability-token (',' capability-token)* ']' | '[' ']'`; `capability-token ::= arg-cap '(' string-lit
   (',' string-lit)* ')' | arg-cap | 'db'`; `arg-cap ::= network|fs-read|fs-write|spawn|env`. NOTE `fs-read`/
   `fs-write` are hyphenated → not JS identifiers → must be recognized as capability keywords, not exprs.
   Special-parse this attribute so `network`/`db`/etc. are tokens, never scope refs → no `E-SCOPE-001`.
3. **Validate tokens against the CLOSED v1 vocab** `{network, fs-read, fs-write, spawn, env, db}` (§23.5.3);
   fire **`E-FOREIGN-CAPABILITY-UNKNOWN`** (ERROR, §23.5.7) on an unrecognized token (e.g. `teleport`).
   Arg-caps with no parens = empty allow-list (valid); args union across repeats (§23.5.2).
4. **`W-FOREIGN-UNDECLARED-CAPABILITY`** (INFO lint, §23.5.5) when a foreign construct (`_{}` §23.2 / WASM
   sigil §23.3 / `use foreign:` §23.4) is governed by an EMPTY capability set. Suppressible via
   `lint.foreign-undeclared-capability = off` (§28). Presence-only, NOT accuracy (opacity bound §23.2.3).
5. **Inheritance (§23.5.4)** — closest-ancestor-`<program>`-with-`capabilities=` WINS, NO union (mirrors the
   §23.2.1 `lang=` determination walk — REUSE that resolver, don't reinvent). Empty set if none.
6. **Add the 2 §34 catalog rows** — `E-FOREIGN-CAPABILITY-UNKNOWN` (error) + `W-FOREIGN-UNDECLARED-CAPABILITY`
   (info). Rule 4 named-codes-land-with-impl.

## Acceptance / DoD (the fail-closed-Nominal invariant, now satisfied)
- `capabilities=[network("api.example.com")]` + `[fs-read("/etc/x"), spawn, db]` + `[]` → COMPILE CLEAN (no
  `E-SCOPE-001`, no `W-ATTR-001`).
- `capabilities=[teleport]` → `E-FOREIGN-CAPABILITY-UNKNOWN` (not `E-SCOPE-001`).
- A foreign construct under an empty set → `W-FOREIGN-UNDECLARED-CAPABILITY` (info); suppressible.
- Closest-ancestor-wins inheritance verified; full gate green.
- **THEN** author the §23.5 conformance batch — case shapes + expected-values are ready in the branch
  `ce3b84d7` progress.md (valid-clean · explicit-`[]` · per-token-valid · multi-token · unknown-token ·
  closest-ancestor-wins · undeclared-with-foreign · suppression-off).

## Out of scope (DEFERRED per §23.5.6 — NOT v1.0)
The manifest aggregate (`scrml.toml [capabilities]`) + enforcement (Pole-D kernel sandbox). Not built, not
required by v1.0.

## Also owed
Correct the stale master-list §0 "V1-security floor BUILT — capability-vocab §23.5" claim → "SPEC-only;
impl wave scoped `capability-decl-impl-wave-2026-07-10`."

## Effort
Small-to-medium: attr-registration + special-parse + vocab-validate + inheritance-reuse + 1 lint + 2 codes +
tests. Dispatch: scrml-js-codegen-engineer iso:worktree; S239 review pre-land.
