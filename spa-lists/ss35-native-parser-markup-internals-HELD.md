# ss35 — native-parser + markup/parser internals — ⛔ HELD

**⛔ HOLD pending the #1 parser-fork ruling (compiler re-imagining de-risk).** Every item touches native-parser / ast-builder / markup-parser internals that the Road A (finish JS native parser) / narrow-Road-B (re-imagine in scrml) / shelve ruling will RESHAPE. Investing in these internals now risks being wasted if Road B (or shelve→Acorn-stays) wins. **Do NOT fire this list until the user rules the parser fork.** The S222 lexer-slice deep-dive (`scrml-support/docs/deep-dives/compiler-reimagining-lexer-slice-2026-06-26.md`) is the decision input.

**EXCEPTION the user may override:** `g-mount-hang-rails-dev` is an ACTIVE 100%-CPU compile hang (adopter-blocking) — a fire-anyway candidate even under the hold, if the rails-dev app needs to compile before the fork is ruled. Surface to the user.

**Shared ingestion:** `compiler/native-parser/*` + `compiler/src/ast-builder.js` + the markup/comment parse path. Held as one lane because the fork ruling is the gate, not because they share a file.

## Items (HELD)

1. **g-mount-hang-rails-dev** (MED) `[status=open]` — `compile` infinite-loops at 100% CPU inside `nativeParseFile` (NOT a happy-dom hang). **Fire-anyway candidate** (active hang). Locus: native-parser loop/termination.
2. **g-native-inline-struct-return-twin** (MED) `[status=open]` — the NATIVE parser has the same inline-struct-return misparse the legacy parser fixed S221 (returnTypeAnnotation=undefined + body→bare-exprs). ss25 #2 native twin (→ was ss28).
3. **g-markup-comment-angle-bracket-parsed-as-tag** (MED) `[status=open]` — a literal `<tag>` inside a `//` MARKUP-section comment is parsed as real markup (corrupts a downstream `<match>`). flogence #2.
4. **g-component-body-markup-parser-absent** (MED, design-track) `[status=open]` — a component body is stored as `raw: string`, never re-parsed into walkable AST → structural constructs inside a component body are unreachable. Bucket-B / design-track.
5. **g-arrow-expr-body-sql-parser-truncate** (MED) `[status=open]` — an expression-body arrow `(x) => ?{…}` truncates the `?{}` at the PARSER (destroyed pre-codegen). Gates a fuller fix.
6. **g-named-machine-arrow-no-statedecl-silent-empty** (MED) `[status=open]` — the §51.3.2 named-machine form with a whole-body arrow + NO separate state-decl silently renders empty. 6nz B2 adversarial residual. (Parser + codegen.)
7. **g-nested-template-raw-mangle-ast-builder** (MED) `[status=open]` — a nested template `${\`inner ${pb()}\`}` arrives at codegen pre-mangled by the ast-builder.
8. **g-selfhost-class-collector-each-match-no-walk** (LOW, B4-deferred) `[status=open]` — the SELF-HOST class collector never AST-walks each/match bodies (flogence #3 "squashed bubbles" root; the TS collector is fine). Self-host / B4-deferred.
