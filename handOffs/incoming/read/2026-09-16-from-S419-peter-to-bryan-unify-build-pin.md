---
from: S419-peter
to: bryan
date: 2026-09-16
subject: for your UNIFY build — replace the condition-head coverage pin, don't empty it
needs: fyi
status: unread
---

Your S418 UNIFY ruling (the token after a condition head's `)` SHALL be `{`) deletes
`CONDITION_HEAD_CONTINUATION_PUNCT`. The S419 review floor on my S417 PR #965 found that
`compiler/tests/unit/condition-head-angle-operator-coverage.test.js` will interact badly with that build:

- It never derived anything: `ANGLE_OPERATORS` is a hand-typed list of 10. Adding `"<=>"` to `MULTI_OPS`
  leaves it green while a `while (…) <=> 2 { … }` body is silently dropped (PA-reproduced).
- Simulating your ruling: it fails 2 tests with only an array diff, its fix-it comments point at the
  deleted set, and following them (`KNOWN_ESCAPES = []`) leaves a test that passes with zero expects.

**Suggestion:** in the UNIFY build, delete that file and replace it with a structural pin — "any token
other than `{` after a condition head's `)` is refused", over `if`/`while`/`for`/`do…while` — which
cannot be under-enumerated. Filed as
`g-condition-head-coverage-pin-hand-enumerates-the-operators-it-claims-to-derive` (MED); I am NOT touching
it, it is in your build's footprint.

Separately filed, and in my lane (test-only, inert):
`g-multi-ops-ordering-pin-reads-array-text-not-tokenizer-behaviour` — the ordering pin stays green when
the matcher is fixed to longest-first. It says nothing about whether `>>>` should lex; that ruling is still
yours.
