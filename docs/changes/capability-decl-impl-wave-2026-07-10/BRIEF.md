# BRIEF — §23.5 capability-DECLARATION impl wave (V1-floor security-vocab build)

Build the §23.5 capability-DECLARATION impl wave (a V1-floor security-vocab build) + author its
conformance cases. Isolated worktree — do NOT land to main; commit on your branch; the PA reviews
(S239) + lands. This is a compiler BUILD (recognize+validate+advisory-lint), NOT conformance-only.

## Why (the current state — reproduce it FIRST)
N1 capability-vocab is V1-REQUIRED but is SPEC-TEXT-ONLY (S232 landed the SPEC, never the impl).
Empirically today, `<program capabilities=[network("api.example.com")]>` (SPEC §23.5.2's own advisory
example) HARD-FAILS with a misleading fatal `E-SCOPE-001` + `W-ATTR-001` — the bracket is parsed as a
general expression so `network` resolves as an undefined scope ref. This VIOLATES the fail-closed-Nominal
invariant (a SPEC-valid advisory declaration must not hard-fail). Reproduce this first so you have the
failing baseline. The full empirical behavior table + the ready conformance-case shapes are in the
escalation notes: `git show ce3b84d7:docs/changes/conformance-capability-2026-07-09/progress.md`.

## Rule 4 — read SPEC §23.5 IN FULL
`compiler/SPEC.md` §23.5.1–§23.5.7 (~L16402-16535) + the `capabilities=` row in the §4.12.2 attr table
(~L732). Author to the SPEC.

## Build items (v1.0 = DECLARATION half; enforcement §23.5.6 stays DEFERRED)
1. Register `capabilities=` as a `<program>` attribute in `compiler/src/attribute-registry.js`.
2. Special-parse the value as a capability-token LIST, not a general expression (the CORE fix).
3. Validate tokens against the CLOSED v1 vocab `{network, fs-read, fs-write, spawn, env, db}` (§23.5.3);
   fire `E-FOREIGN-CAPABILITY-UNKNOWN` (ERROR, §23.5.7) on an unrecognized token.
4. `W-FOREIGN-UNDECLARED-CAPABILITY` (INFO lint, §23.5.5) when a foreign construct (`_{}` §23.2 / WASM
   sigil §23.3 / `use foreign:` §23.4) is governed by an EMPTY capability set. Suppressible via
   `lint.foreign-undeclared-capability = off` (§28). Presence-only (opacity bound §23.2.3).
5. Inheritance (§23.5.4) — closest-ancestor-`<program>`-with-`capabilities=` WINS, NO union.
6. Add the 2 §34 catalog rows — `E-FOREIGN-CAPABILITY-UNKNOWN` (error) + `W-FOREIGN-UNDECLARED-CAPABILITY`
   (info).

## DoD (the fail-closed-Nominal invariant, now satisfied)
- `capabilities=[network("api.example.com")]` + `[fs-read("/etc/x"), spawn, db]` + `[]` → COMPILE CLEAN.
- `capabilities=[teleport]` → `E-FOREIGN-CAPABILITY-UNKNOWN` (not `E-SCOPE-001`).
- A foreign construct under an empty set → `W-FOREIGN-UNDECLARED-CAPABILITY` (info); suppressible per §28.
- Closest-ancestor-wins inheritance verified.
- THEN author the §23.5 conformance batch in `conformance/cases/capability/`.

See progress.md for the implementation record.
