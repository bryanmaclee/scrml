# compiler/native-parser/

Bottom-up scrml-native JS lexer (and eventually parser); replaces Acorn pre-v1.0; lives in the scrmlTS compiler pipeline.

NOT a port. NOT self-host. NOT a Mn-replacement of `compiler/src/`. Acorn is the conformance ORACLE — never the design template.

Design authority: [`scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md`](../../../scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md) (D1 charter, D2 composed-engines architecture, D3 type catalog, D4 missing-primitive inventory, D5 JS subset bound, D6 conformance-test plan, D7 milestones).

## Pillar 5b conformance note

Per PRIMER §2 Pillar 5b ("Reach for state primitives first; reach for `fn` only when the problem is calculation"), this directory's discipline is:

- Every STATE-SHAPE construct points to an `<engine>` (LexMode, BracketStack, ErrorRecovery — see `lex-mode.scrml`, `bracket-stack.scrml`, `error-recovery.scrml`).
- Every `fn` body justifies its calculation classification at the file header (per the D1 two-table operational test).
- The .scrml files carry the CANONICAL scrml-source SHAPE; the .js files carry the executable LIVE SURFACE today (the .scrml<->.js shadow is an M4+ swap-in concession documented in each file's header — see `span.js` for the rationale).

A reader who points to any state-shape construct must be able to find its `<engine>` declaration; any `fn` body the reader points to must justify the calculation classification per the D1 charter. If a `fn` body cannot be justified, it surfaces as tension for re-litigation (per the dispatch rule "shoot straight; document tension; don't paper over").

## M1.2 status (2026-05-17, S100)

| Surface | Status |
|---|---|
| Token catalog (D3) | substantive — all TokenKind variants for JS subset + scrml extensions; M1.2 added `TemplateInterpStart` / `TemplateInterpEnd` for template-literal interp tokens |
| LexMode engine (D2) | M1.2: `<InTemplateBody>` is now a COMPOSITE state-child per §51.0.Q.1 — body contains a nested `<engine for=LexMode var=innerLexMode initial=.InCode>`. State-children `.InSingleString` / `.InDoubleString` activated. Remaining bare bodies (`.InLineComment` / `.InBlockComment` / `.InRegexBody`) are M1.3 / M1.4 targets. |
| BracketStack engine (D2) | declared; live frame stack in the JS-host shadow |
| ErrorRecovery engine (D2) | declared with all 3 state-children + full rule= matrix |
| Cursor (D4 P5) | V5-strict-shaped; peek/advance/snapshot/restore |
| InCode-state body | M1.1 substantive — delegates `'` / `"` / `` ` `` to the M1.2 dispatchers; intercepts `}` as `TemplateInterpEnd` when in a template-interp frame at matching bracket depth |
| Single-quoted string body | M1.2 SUBSTANTIVE — escape-aware scanner (JS spec §12.8.4) — `\n` `\r` `\t` `\b` `\f` `\v` `\0` `\\` `\'` `\"` `` \` `` `\/`, `\xHH`, `\uHHHH`, `\u{...}` brace form, IdentityEscape passthrough, LineContinuation. File: `lex-in-single-string.scrml` / `.js` |
| Double-quoted string body | M1.2 SUBSTANTIVE — mirror of single-quoted; shares `scanStringEscape` primitive. File: `lex-in-double-string.scrml` / `.js` |
| Template-literal body | M1.2 SUBSTANTIVE — §51.0.Q.1 NESTED-ENGINE pattern. Emits sequence of `TemplateChunk` + `[TemplateInterpStart, ...inner-tokens, TemplateInterpEnd, TemplateChunk]*` per ECMA-262 §12.8.6. Per-call `ctx.templateStack` tracks per-template frames; `${` pushes (recording bracket-stack depth), matching `}` pops. Nested templates supported. File: `lex-in-template.scrml` / `.js` |
| Comment / regex bodies | STUB (paired-delimiter scan + LexMode round-trip; inline-handled in InCode dispatch); M1.3 / M1.4 dispatches turn each on |
| `lex(source): Token[]` entry point | functional end-to-end; loop dispatches by LexMode via the 4 active dispatchers + safety-net for M1.3+ modes |
| Conformance test | `compiler/tests/parser-conformance-lexer.test.js` runs bench corpus + inline micro-corpus. M1.2 result: **87 pass / 3 skip / 0 fail** (up from M1.1's 57/12/0). Remaining 3 skips are 'smoke' disposition bench files reserved for the M1.3+ byte-identical Acorn-token-shape normalizer. |

## File listing

| File | One-liner |
|---|---|
| `span.scrml` / `.js` | `{start, end, line, col}` struct; pure-data; calculation classification (D4 P6) |
| `token.scrml` / `.js` | TokenKind nested-by-category enum (D3); QuoteKind; JS_KEYWORDS table; makeToken/makeIdentOrKeyword/makeEof. M1.2: + TemplateInterpStart/End variants |
| `cursor.scrml` / `.js` | V5-strict-shaped character cursor (D4 P5); peek* calculations; advance + snapshot/restore as state-writes |
| `lex-mode.scrml` / `.js` | `<engine for=LexMode initial=.InCode>` with all 7 state-children + rule= contract; M1.2 InTemplateBody is a COMPOSITE state-child with nested `<engine for=LexMode var=innerLexMode initial=.InCode>` per §51.0.Q.1; LIVE setMode/getMode helpers |
| `bracket-stack.scrml` / `.js` | `<engine>` + LIVE frame stack mirror of canonical .OpenAt(depth, opener, span) variant |
| `error-recovery.scrml` / `.js` | `<engine for=ErrorRecovery initial=.ParsingNormally>` — DD §D4 P4 canonical positive state example |
| `lex-in-code.scrml` / `.js` | SUBSTANTIVE — InCode-state dispatcher; emits tokens for whitespace, idents, keywords, numerics, all punctuation, multi-char operators, scrml extensions, brackets, regex (M1.4-aware stub). M1.2: delegates `'` / `"` / `` ` `` to per-mode dispatchers; intercepts `}` as TemplateInterpEnd when in a template-interp frame |
| `lex-in-single-string.scrml` / `.js` | M1.2 SUBSTANTIVE — escape-aware single-quoted string scanner per JS spec §12.8.4. Exports `scanStringEscape` reused by lex-in-double-string + lex-in-template |
| `lex-in-double-string.scrml` / `.js` | M1.2 SUBSTANTIVE — mirror of single-quoted scanner |
| `lex-in-template.scrml` / `.js` | M1.2 SUBSTANTIVE — §51.0.Q.1 NESTED-ENGINE pattern for template literals. Walks chunks, opens template-interp frame on `${`, recognizes matching `}` via bracket-stack-depth tracking |
| `lex.scrml` / `.js` | Top-level `lex(source: string): Token[]`; loop dispatches by LexMode via 4 active dispatchers (InCode / InSingleString / InDoubleString / InTemplateBody); safety bound + cursor-progress sentinel |
| `README.md` | this file |

## Swap-in roadmap

| Mn | What changes | Status |
|---|---|---|
| M1.2 | Activates `<InTemplateBody>` (incl. `${...}` nested-engine per §51.0.Q.1) + `<InSingleString>` + `<InDoubleString>` state-child bodies; replaces M1.1 stub scanners | ✅ landed at S100 |
| M1.3 | Activates `<InLineComment>` + `<InBlockComment>` state-child bodies | pending |
| M1.4 | Activates `<InRegexBody>` state-child body; refines DD §D4 P3 prev-token heuristic | pending |
| M2 | Expression parser implemented in scrml; ParseContext engine; replaces `scrmlNativeParserStub.parse` body in `compiler/tests/parser-conformance/parsers.js` | pending |
| M3-M6 | Per DD §D7 milestones — full statement parser, full bounded subset, scrmlTS pipeline swap-in, Acorn removal | pending |

## Anomalies surfaced during M1.1 + M1.2

1. **scrml line-comments inside `<engine>` state-child bodies that contain `${...}` literal text** are NOT stripped before bracket-matching; the inner `${` opens a logic context that derails state-child closure detection. Workaround applied: keep state-child bodies bare; long-form commentary lives at file-top. M1.2 also confirmed: string literals containing `"${"` inside `${...}` blocks trip the same BS-layer issue (string-literal contents are not skipped during bracket matching). Workaround: build such strings via concat (`"$" + "{"`). Filed for follow-up review.
2. **Compiler v0.3 strips function bodies** from `export function` declarations inside `${...}` JS-escape blocks in SPA-shape .scrml files. Workaround applied: ship 1:1 .js shadow files alongside each .scrml; tests import the .js, the .scrml retains the canonical Pillar 5b SHAPE. The M4+ swap-in retires the shadow.
3. **Payload-bearing engine variants** (`.OpenAt(depth: int, opener: BracketKind, span: Span)`, `.AccumulatingSkipped(tokens: Token[])`, `.ReSynchronized(at: SyncToken)`) — the M1.1 spec subset declares bare variant tags; the payload-carrying form is deferred until the M1.x dispatch that carries payload through to the spec-mirror layer.
4. **§51.0.Q.1 nested engines sharing the outer's enum type** (M1.2-surfaced) — **NOT a compiler gap; both items are SPEC-CANONICAL patterns** per S101 cross-check against SPEC §51.0.C + §51.0.Q.1 + §51.0.B (Rule 4 — SPEC is normative). Original framing here as "compiler gaps" was misclassification.
   - **`var=innerLexMode` is the spec-canonical disambiguation**, not a workaround. SPEC §51.0.C lines 21870-21872 verbatim: *"Override via `var=` attribute when the auto-derived name collides with another identifier in scope."* SPEC §51.0.Q.1 line 22782-22783 verbatim: *"Use the `var=` attribute on the inner engine if the auto-derived name collides with a file-scope identifier (§51.0.C disambiguation)."* The scope-gating rule articulated in §51.0.Q.1 governs WHERE the inner variable is reachable (only while outer is in the composite state-child), not how its NAME is resolved against same-scope collisions — `var=` is the documented resolution.
   - **Full state-child enumeration is spec-canonical** per §51.0.B exhaustiveness. The example architecturally allows any of the 7 LexMode variants inside an interp body (the M1.2 README author's own annotation: *"Architecturally OK because a template-interp body can in principle contain any lexer mode"*). There's no spec-blessed "narrower-domain partial enumeration" shape; full enumeration IS the right shape.

   Verdict S101: not blocking M1.2; not a v0.4 critical-path item; not filing for compiler change. The `lex-mode.scrml` comment block at lines 46-67 still refers to these as "workarounds" — that wording will be updated alongside this README at the same time.
5. **Pre-existing .scrml compile failure post-M1.1** — `lex-in-code.scrml` fails `bun scrml compile` against current main due to `E-SYNTAX-042` on a `lastKind == undefined` line (pre-existing carry-over from M1.1; surfaced post-spec-evolution after `undefined`-keyword strictening landed). Removed in M1.2's pass. Runtime tests are NOT affected because the .js shadows are what the test infrastructure imports (ANOMALY-2 explanation).

## Tags

#scrmlts #m1-1 #m1-2 #native-parser #lexer #pillar-5b #composed-engines #dd-d2 #dd-d3 #spec-51-0-q-1 #nested-engine #template-literal

## Links

- [scrml-native-parser-design-2026-05-17.md](../../../scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md)
- [PA-SCRML-PRIMER §2 Pillar 5b](../../docs/PA-SCRML-PRIMER.md)
- [compiler/tests/parser-conformance-lexer.test.js](../tests/parser-conformance-lexer.test.js)
- [compiler/tests/parser-conformance/parsers.js](../tests/parser-conformance/parsers.js)
- [docs/changes/m1-1-native-lexer-skeleton/progress.md](../../docs/changes/m1-1-native-lexer-skeleton/progress.md)
