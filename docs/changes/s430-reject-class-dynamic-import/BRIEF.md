# BRIEF — s430-reject-class-dynamic-import (rulings P1 + P4.2)
Read `docs/changes/s430-common/F4.md` FIRST and obey it. ⚑ This dispatch is cut AFTER `s430-p2-export-swallow` landed, so
the export-declaration diagnostic swallow is closed — your new codes must fire inside exported declarations too.

## Rulings (bryan S430, verbatim in scrml-support/user-voice-scrml.md S430)
- P1: *"I really want to reject class. I do not care for OOP and "class" is canonical OOP. but the word is not at fault."*
  → a parse-layer rejection `E-CLASS-NOT-IN-SCRML`, mirroring `E-THROW-NOT-IN-SCRML` / `E-TRY-NOT-IN-SCRML` /
  `E-ASYNC-NOT-IN-SCRML`. "The word is not at fault": the HTML `class=` attribute, `class` as an object key / struct field
  / member name (`x.class`), and anything inside `_{}` foreign code MUST stay legal. Fire ONLY on a class DECLARATION or
  class EXPRESSION in scrml logic.
- P4.2: reject dynamic `import(...)` in scrml source → `E-DYNAMIC-IMPORT-NOT-IN-SCRML`. Measured S430: a bare
  `import("./x.js")` emits an un-awaited Promise with no diagnostic. The replacement is `import:host` (§21.3.1, being built
  in a sibling dispatch). Must NOT fire inside `_{}`. Report what happens inside `^{}` meta bodies (§21.3.1 says the
  `^{ await import(...) }` path is closed) — fire there too if §21.3.1/§22 already forbid it; quote the sentence.

## Do
1. SPEC: add both rows to §34 (with `provenance: ruling:user-voice-S430-P1` / `-P4`), amend the S117-open-decision notes
   on `E-STMT-CLASS-NAME` (§34.1) to say the decision is CLOSED (mirror how `E-TRY-NOT-IN-SCRML` superseded
   `E-STMT-TRY-NO-HANDLER`), and add a short normative sentence in the right section (§19 / §21 — your call, justify it).
2. Implement in BOTH front-ends: the default pipeline (`compiler/src/ast-builder.js`, where `E-THROW-NOT-IN-SCRML` fires ~:9297
   and ~:13881 — PA-LOCATED-VERIFY) and the native parser (`compiler/native-parser/parse-stmt.js`, where the E-STMT-CLASS-*
   codes live) + its `.scrml` mirror if one exists for that code path.
3. **Measure the corpus by COMPILING** every tracked `.scrml` on base vs build. Expected hits: `compiler/self-host/*.scrml`
   (14 classes, 17 dynamic imports). Report the full newly-failing set. **Do NOT migrate the self-host tree** — the class→struct
   rewrite (P1b: free fns, state by returning a new value) and import→`import:host` conversion are the bootstrap track's first
   units. If any GATED test or CI job compiles the self-host tree, report it and STOP before landing so the PA can decide.
   Any OTHER newly-failing file (stdlib, examples, samples) → report, don't migrate.
4. Tests: fires on `class X {}`, `export class X {}`, `const C = class {}`, `import("x")`, `const m = import(p)`; does NOT fire
   on `<div class="a">`, `{ class: 1 }`, `o.class`, `_{ class X {} }`.
