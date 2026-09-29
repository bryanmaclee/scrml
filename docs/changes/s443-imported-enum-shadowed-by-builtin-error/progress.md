# progress — s443-imported-enum-shadowed-by-builtin-error

- start: brief archived (BRIEF.md).
- reproduced on 6dccbd6cf: all 7 built-in error names + ParseError; bare valid false E-ERROR-009; qualified invalid silently accepted; ParseError rejected (E-ERROR-009 + E-TYPE-080).
- locus hypothesis HELD (type-system.ts imported-types seeder only overrode absent/unknown), and REFINED — three further shadow sites of the same root:
  1. api.js getDepRegistry: dep registry carried seeded built-ins, so a re-export via a file that declares its own types resolved to the BUILT-IN.
  2. type-system.ts resolveTypeExpr: checked BUILTIN_TYPES before the registry, so `e: AuthError` resolved to the built-in even for a LOCAL declaration (match never exhaustiveness-checked).
  3. type-system.ts scope-chain seeding (x2) + emit-reactive-wiring.ts transition-table loop skipped user types by NAME; now by identity.
- fix: identity rule — a registry entry still === BUILTIN_TYPES.get(name) is not a user declaration.
- tests: compiler/tests/unit/imported-enum-builtin-name-s443.test.js (40; 29 fail on base), conformance error/fail-imported-builtin-name-enum-{ok,neg}.
- next: corpus differential, full suite, conformance runner.
