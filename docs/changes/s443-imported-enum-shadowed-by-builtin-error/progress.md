# progress — s443-imported-enum-shadowed-by-builtin-error

- start: brief archived (BRIEF.md).
- reproduced on 6dccbd6cf: all 7 built-in error names + ParseError; bare valid false E-ERROR-009; qualified invalid silently accepted; ParseError rejected (E-ERROR-009 + E-TYPE-080).
- locus hypothesis HELD (type-system.ts imported-types seeder only overrode absent/unknown), and REFINED — three further shadow sites of the same root:
  1. api.js getDepRegistry: dep registry carried seeded built-ins, so a re-export via a file that declares its own types resolved to the BUILT-IN.
  2. type-system.ts resolveTypeExpr: checked BUILTIN_TYPES before the registry, so `e: AuthError` resolved to the built-in even for a LOCAL declaration (match never exhaustiveness-checked).
  3. type-system.ts scope-chain seeding (x2) + emit-reactive-wiring.ts transition-table loop skipped user types by NAME; now by identity.
- fix: identity rule — a registry entry still === BUILTIN_TYPES.get(name) is not a user declaration.
- tests: compiler/tests/unit/imported-enum-builtin-name-s443.test.js (40; 29 fail on base), conformance error/fail-imported-builtin-name-enum-{ok,neg}. The ok case is compile-only: the impl1-ts runtime adapter evaluates a single client.js and cannot load a relative .scrml import's module.
- corpus differential (examples, samples, conformance/cases, stdlib, docs/readme-snippets): 2137 common sources, 0 diagnostic changes, 0 compile-outcome changes; 2 artifact diffs are compiler-root-location import paths (e-import-003/008 host .js), not this change.
- pre-commit blocker: standalone-tool-target Bun.serve test dropped its port line (abandoned-read race), failing deterministically in hook order on base too. Fixed in a separate commit (be02882be).
- landed: b7d184a35. Full gate 0 fail; conformance 1106/1113 (7 known xfail).
