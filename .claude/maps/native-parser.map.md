# native-parser.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Purpose

`compiler/native-parser/` is a bottom-up scrml-native JS lexer that will replace Acorn pre-v1.0. It is NOT a port of Acorn, NOT a self-host exercise, and NOT a replacement for `compiler/src/`. Design authority: `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` (D1 charter, D2 composed-engines architecture, D3 type catalog, D4 missing-primitive inventory, D5 JS subset bound, D6 conformance-test plan, D7 milestones).

Acorn is the conformance oracle (Acorn output = expected output for JS subset). Divergences are intentional scrml-extension tokens.

## M1.x Ladder Status (M1 COMPLETE at M1.4 / S103)

| Milestone | Status | Session | Key change |
|-----------|--------|---------|------------|
| M1.1 | COMPLETE | S99 | Skeleton: InCode dispatcher, cursor, span, token catalog, bracket-stack, error-recovery engines |
| M1.2 | COMPLETE | S100 | `<InSingleString>`, `<InDoubleString>`, `<InTemplateBody>` (§51.0.Q.1 NESTED-ENGINE); TemplateInterpStart/End tokens; template-interp frame tracking |
| M1.3 | COMPLETE | S102 | `<InLineComment>` (scans to LineTerminator, emits no token) + `<InBlockComment>` (`/* ... */`, EOF-tolerant, emits no token) |
| M1.4 | COMPLETE | S103 | `<InRegexBody>` (`/pattern/flags`, char-class + escape aware, RegexLit token); DD §D4 P3 `regexAllowedAfter(lastKind)` heuristic at InCode dispatch; all 7 state-children have substantive body dispatchers |
| M1.5 | pending | — | `expr-literals.js` bench-corpus flip to "full" disposition; regex-token normalizer (Acorn `regex` token vs native `RegexLit { pattern, flags }` payload) |
| M2 | pending | — | Expression parser in scrml; ParseContext engine; replaces `scrmlNativeParserStub.parse` in parsers.js |
| M3-M6 | pending | — | Statement parser → full bounded subset → pipeline swap-in → Acorn removal |

## File Catalog

| File pair (.scrml / .js) | Role | Shape | Status |
|--------------------------|------|-------|--------|
| span | `{start, end, line, col}` struct | calculation (pure data) | COMPLETE |
| token | TokenKind nested-by-category enum (D3); QuoteKind; JS_KEYWORDS table; makeToken/makeIdentOrKeyword/makeEof; M1.2 +TemplateInterpStart/End | calculation | COMPLETE |
| cursor | V5-strict character cursor; peek*/advance/snapshot/restore; peek returns `not` at EOF | state (advance/restore) | COMPLETE |
| lex-mode | `<engine for=LexMode initial=.InCode>` — 7 state-children + full rule= contract; InTemplateBody is COMPOSITE (nested `<engine for=LexMode var=innerLexMode initial=.InCode>` per §51.0.Q.1) | state (engine) | COMPLETE |
| bracket-stack | `<engine>` + LIVE frame stack mirror; `.OpenAt(depth, opener, span)` variant; push/pop/isEmpty helpers | state (engine) | COMPLETE |
| error-recovery | `<engine for=ErrorRecovery initial=.ParsingNormally>` + 3 state-children (.AccumulatingSkipped, .ReSynchronized) + full rule= matrix | state (engine) | COMPLETE |
| lex-in-code | InCode-state dispatcher; whitespace, idents, keywords, numerics, all punctuation, multi-char operators, scrml extensions, brackets; M1.2 delegates `'`/`"`/`` ` `` to string/template dispatchers; M1.3 delegates `//`/`/*` to comment dispatchers; M1.4 delegates regex-permissive `/` via `regexAllowedAfter` to regex dispatcher; intercepts `}` as TemplateInterpEnd when in template-interp frame at matching bracket depth | calculation | M1.4 SUBSTANTIVE |
| lex-in-single-string | Escape-aware single-quoted string scanner per JS spec §12.8.4; `\n \r \t \b \f \v \0 \\ \' \" \` \/` + `\xHH` + `\uHHHH` + `\u{...}` + IdentityEscape + LineContinuation; exports `scanStringEscape` reused by double-string + template | calculation | M1.2 SUBSTANTIVE |
| lex-in-double-string | Mirror of single-quoted scanner; shares `scanStringEscape` | calculation | M1.2 SUBSTANTIVE |
| lex-in-template | §51.0.Q.1 NESTED-ENGINE pattern; emits TemplateChunk + [TemplateInterpStart, …inner-tokens, TemplateInterpEnd, TemplateChunk]* per ECMA-262 §12.8.6; per-call `ctx.templateStack` tracks per-template frames; `${` pushes (recording bracket-stack depth), matching `}` pops; nested templates supported | state + calculation | M1.2 SUBSTANTIVE |
| lex-in-line-comment | Scans `//` body to LineTerminator (not inclusive) or EOF per ECMA-262 §11.3; emits NO token (Acorn parity) | calculation | M1.3 SUBSTANTIVE |
| lex-in-block-comment | Scans `/* ... */` per ECMA-262 §12.4; consumes both delimiters on close; EOF-tolerant (defers diagnostic); emits NO token (Acorn parity) | calculation | M1.3 SUBSTANTIVE |
| lex-in-regex | Scans `/pattern/flags` per ECMA-262 §12.8.5 + §22.2.1.10; char-class aware (`[...]`); escape-aware (`\` consumes next char); flag run is IdentifierPart-shaped (flag validation deferred to regex engine); EOF/LineTerminator tolerated (defers diagnostic); emits single `RegexLit` token carrying `{pattern, flags, raw, span}` | calculation | M1.4 SUBSTANTIVE |
| lex | Top-level `lex(source: string): Token[]`; loop dispatches by LexMode via 7 active dispatchers + defensive safety-net; cursor-progress sentinel prevents infinite loops | orchestration | M1.4 COMPLETE |

## Token Catalog (D3 — key TokenKind variants)

All TokenKind variants are nested by category in token.js. Selected variants:

| Category | Variants |
|----------|---------|
| Literals | NumLit, StringLit, TemplateChunk, RegexLit (M1.4) |
| Template interp | TemplateInterpStart, TemplateInterpEnd (M1.2) |
| Identifiers | Ident, Keyword |
| Punctuation | Dot, Comma, Semi, Colon, Question, Bang, Tilde, At, Hash |
| Brackets | LParen, RParen, LBrace, RBrace, LBracket, RBracket |
| Multi-char ops | Arrow (=>), SpreadRest (...), Inc (++), Dec (--), OptChain (?.) |
| Comparison | Eq (==), Ne (!=), Lt, Gt, Le, Ge |
| Assignment | Assign, PlusAssign, MinusAssign, MulAssign, DivAssign, etc. |
| scrml ext | StateDecl (<IDENT>), AtSignIdent (@ident) |
| Meta | Eof, Invalid |

JS_KEYWORDS table maps identifier text to the `Keyword` variant (no separate per-keyword variant — one `Keyword` variant for all JS keywords).

## Architecture: Pillar 5b Discipline

Per PRIMER §2 Pillar 5b ("Reach for state primitives first; reach for `fn` only when the problem is calculation"):
- Every STATE-SHAPE construct has an `<engine>`: LexMode (7 variants), BracketStack, ErrorRecovery
- Every `fn` body justifies its calculation classification at the file header
- `.scrml` files carry CANONICAL scrml-source SHAPE; `.js` files carry LIVE executable SURFACE (M4+ swap-in retires the shadow)

## §51.0.Q.1 NESTED-ENGINE Pattern (M1.2 exemplar)

`<InTemplateBody>` is a COMPOSITE state-child: it declares an inner `<engine for=LexMode var=innerLexMode initial=.InCode>`. The `var=innerLexMode` is SPEC-CANONICAL disambiguation per §51.0.C (not a workaround). Full LexMode state-child enumeration inside the nested engine is SPEC-CANONICAL per §51.0.B exhaustiveness.

## DD §D4 P3 Regex-vs-Division Heuristic

`regexAllowedAfter(lastKind): bool` — heuristic in lex-in-code.js deciding whether `/` is a regex-start or division operator. Returns true after: Ident/Keyword/NumLit/RParen/RBracket (prior operand → division). Returns false after: most operators, LBrace, LParen, Semi, beginning-of-input (regex allowed). Unchanged across M1.1-M1.4 (structural extraction at M1.4 only).

## Conformance Test

`compiler/tests/parser-conformance-lexer.test.js` — imports `lex.js` and `TokenKind` from the `.js` shadow files. Runs bench corpus from `compiler/tests/parser-conformance/bench/` through both Acorn and native lex; normalizes outputs via tier-diff.js; asserts kind+text+span match per token. As of M1.4: **97 pass / 0 skip / 0 fail**. `expr-literals.js` retains a `"M1.2-string-template-regex"` SKIP pending M1.5 regex-token normalizer extension.

## Documented Anomalies

1. scrml line-comments inside `<engine>` state-child bodies containing `${...}` literal text — NOT stripped before bracket-matching; workaround: keep state-child bodies bare
2. Compiler v0.3 strips function bodies from `export function` in `${...}` JS-escape blocks in SPA-shape .scrml files — workaround: ship .js shadow file alongside each .scrml; tests import .js
3. Payload-bearing engine variants (`.OpenAt(depth, opener, span)`) — payload deferred until M1.x dispatch that carries payload through spec-mirror layer
4. §51.0.Q.1 nested engines + `var=` disambiguation — NOT compiler gaps; both are SPEC-CANONICAL (S101 verdict)
5. Pre-existing .scrml compile failure on `undefined` (E-SYNTAX-042) — removed in M1.2; runtime NOT affected because .js shadows are what tests import

## Swap-in Roadmap

M1.5 (pending) → M2 expression parser → M3 statement parser → M4 bounded subset + .scrml imports → M5 scrmlTS pipeline swap-in → M6 Acorn removal

## Tags
#scrmlts #map #native-parser #lexer #m1-4 #m1-ladder-complete #pillar-5b #composed-engines #dd-d2 #dd-d3 #dd-d4-p3 #spec-51-0-q-1 #nested-engine #template-literal #regex-vs-division #s101

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [test.map.md](./test.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
