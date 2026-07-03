# self-host-v2 LEXER — slice 1 (Road-B compiler impl#2, S234)

Home: `compiler/self-host-v2/` (fresh dedicated area — NOT native-parser, NOT a port).
Design authority: `scrml-support/docs/deep-dives/compiler-reimagining-lexer-slice-2026-06-26.md`
(Approach B: pure `fn lex(src) -> Token[]` folding `step(st) -> LexState` over `match (mode, event)`).

## Slice-1 scope (built here)
- Shared substrate: TokenKind (payload enum) · QuoteKind/BracketKind · Span/Token/Cursor/Scan structs ·
  makeCursor/peekCode/advance/isEof · char-class fns · regexAllowedAfter.
- Lex-fold skeleton: LexMode + LexEvent enums · LexState struct · classify · step (`match (mode,event)`) ·
  lex driver (`while (!isEof) st = step(st)`).
- CORE-TOKEN scanners: scanIdentOrKeyword · scanNumber · scanOperatorOrPunct (+ munchEq/munchBang/munchLt/munchGt).

## DEFERRED to later slices (routed to a total stub arm; NOT scanned this slice)
- strings (scanString / QuoteKind bodies)         — slice-2
- template-interp nesting (InTemplateBody + `${}`) — slice-2/3
- line + block comments (`//`, `/*`)               — slice-2
- regex bodies (`/.../flags`)                      — slice-3
- BracketStack + ErrorRecovery threading           — later (fields not in slice-1 LexState)
In `step`, every non-`(InCode, Ordinary|SawEof)` event routes to `deferAdvance` (advances 1 char, emits
no token) so the fold stays TOTAL. The slice-1 corpus contains none of these, so the stub never fires.

---

## THE ORACLE (token-diff, loop-until-green)

### Reference = impl#1 lexer (`compiler/native-parser/lex.js`)
`lex(source)` → `Token[]`, each `{ kind:string, text:string, span:{start,end,line,col} }`.
Phase-0 characterization (probed live against native-parser/lex.js):
- Whitespace + newline trivia are SKIPPED (not emitted).
- Keywords are DISTINCT kinds (`const`->`KwConst`, `let`->`KwLet`, ...); operators maximal-munched
  (`===`->StrictEqual, `!==`->StrictNotEqual, `<=`->LessEqual, `++`->Increment, `??`->NullishCoalesce,
  `?.`->OptionalChain); `NumberLit` carries raw text; `EOF` token at end (empty text, span `[len,len]`).

### Candidate = impl#2 (`compiler/self-host-v2/lex.scrml`)
Compiled via the LIVE compiler (`<program>` browser mode → `<base>.client.js`), then the emitted
`_scrml_lex_N(src)` is discovered by regex + called via `new Function(clientText + "return <fn>;")()`.
Only runtime helper referenced by the pure lexer = `_scrml_structural_eq` (from `==`); the oracle
provides a compact deep-equal stub. NO reactive/runtime/DOM deps (pure fold).

### Normalization (both sides -> `{kind, text, start, end}`)
- kind tag: `typeof k === "object" ? k.variant : k` (payload variant -> `{variant,data}`; nullary -> string).
- impl#2 nullary kinds are NAMED to match impl#1 exactly (LParen/Plus/StrictEqual/NumberLit/Ident/...).
- KEYWORD collapse: any impl#1 `Kw*` kind AND impl#2 `Keyword` -> canonical `"KW"`; the `text` field
  (compared too) discriminates the specific keyword. Low-coupling: no mirroring of impl#1's per-keyword
  table (D3: token taxonomy is impl freedom; the wave oracle is allowlisted/normalized).
- `Eof`/`EOF` -> `"EOF"`.
Diff compares the 4-tuple per token. Divergence on the slice-1 subset = RED.

### Corpus subset (slice-1 only: idents / keywords / numbers / operators / punctuation)
A curated in-test array of slice-1-only snippets (NO strings/comments/regex/templates, since deferred).
Rationale: real corpus `case.scrml` sources almost all contain deferred token classes; a curated subset
is the defensible slice-1 diff surface (the brief's "SMALL corpus subset restricted to slice-1 tokens").

---

## DOGFOOD FINDINGS (live compiler bugs / gaps surfaced building slice 1)

**F1 (PRIMARY) — library mode cannot lower the flagship idiom.**
A bare `${...}` exports-only module compiles in library mode (SPEC §21.5), but the library emitter
(`compiler/src/codegen/emit-library.ts`) is a SHALLOW REGEX-TRANSFORM over raw source text: it strips
`type` decls + rewrites `fn`->`function` + `not`/`is`, but does NOT (a) strip type annotations on
params/returns/locals [`fn f(n: int) -> int` leaks `: int`/`-> int` verbatim -> E-CODEGEN-INVALID-JS],
(b) lower `match`, (c) lower payload-variant construction. So idiomatic scrml (typed payloads + match-fold)
does NOT compile as an importable library module. Only the `<program>` (browser) path routes through the
real AST emitter (emit-logic/emit-expr) that lowers these. => slice-1 WORKAROUND: wrap the lexer in
`<program>` and consume the emitted client.js. Repro: `${ export fn dbl(n: int) -> int { return n*2 } }`
(no `<program>`) -> E-CODEGEN-INVALID-JS; same body inside `<program>` -> clean.
IMPLICATION FOR ROAD-B: the reimagined compiler must emit library modules through the real emitter, or
a scrml-native library (the compiler's own modules!) can't use typed payloads + match. This is the single
biggest structural blocker for "the compiler is written in idiomatic scrml as importable modules."

**F2 — int-literal `match` arms break the parser + emit invalid JS.**
`match n { 61 :> "eq"  40 :> "lp"  _ :> "other" }` -> `[scrml] warning: statement boundary not detected`
+ E-CODEGEN-INVALID-JS (`const _scrml_match = n; else return "other";` — the int-literal arms are DROPPED,
leaving a bare `else`). STRING-literal match arms (`match s { "if" :> 1 ... }`) compile clean.
=> The DD's Approach-B `scanOperatorOrPunct` design (`match peekCode(cur,0){ 61 :> munchEq(...) ... }`)
does NOT compile. slice-1 dispatches operators on the 1-CHAR STRING instead
(`const ch: string = ...; match ch { "=" :> ... }`) — cleaner/more-readable anyway.

**F3 — product-match drops an arm carrying a literal (int) pattern in a tuple slot.**
`match (a, b) { (.LParen, 0) :> "lp0"  (.Num(v,r), _) :> "num"  (_,_) :> "other" }` -> the `(.LParen, 0)`
arm is SILENTLY DROPPED from the lowered JS (only the variant arms emit). enum×enum product-match lowers
correctly. slice-1 `match (mode, event)` is enum×enum (sidesteps F3), but flag it.

**F4 — bare variant resolves ONLY in fn-return position or when qualified.**
`return .Num(v,r)` (fn return type = the enum) RESOLVES. As a fn ARG (`mkTok(.LParen, ...)`), a struct-field
value (`{ kind: .Plus, ... }`), or an array element (`[.LParen]`) it fires E-VARIANT-AMBIGUOUS EVEN with the
target type annotated (the JS lowers correctly to the string tag, but the TYPER rejects it). => slice-1 uses
qualified `TokenKind.X` and typed-return helper fns exclusively.

**F5 — `match` subject must be typed; a `.substring`-derived local is `asIs`.**
`const ch = c.source.substring(...); match ch {...}` -> E-TYPE-025 (asIs subject). Annotate
`const ch: string = ...`. (Host-method return types are `asIs`; annotate to feed the typer.)

**F6 — `match` arms with `|` ALTERNATION drop silently (string + payload variants).**
An alternation arm fails to lower when the alternatives are STRING literals (`"const" | "let" :> true`) OR
when any alternative is a PAYLOAD pattern (`.Ident(_) | .Num(_) :> false`): the arm is dropped, leaving a
bare `else` -> parse desync / E-CODEGEN-INVALID-JS. NULLARY-enum-variant alternation (`.A | .B :> x`) works
(both newline- and comma-separated). => `isKeyword` uses single-literal arms (a lookup table);
`regexAllowedAfter` uses an `is .Variant` chain instead of the DD's payload-wildcard alternation.

**F7 (benign) — W-DEAD-FUNCTION false-positives on `match`-arm-only callees; they are NOT tree-shaken.**
Reachability does not trace calls from inside `match` arm bodies (`"=" :> munchEq(cur)`; `(.InCode,
.Ordinary) :> emitOneToken(st)`), so munch* / emitOneToken / kUnknown warn as "no callers." Codegen KEEPS
them (verified: every fn survives in the emitted client.js), so output is correct — the warning is noise,
not a shake. Still a real RI call-graph gap (match-arm edges) worth closing.

**F8 — whole-file host-method return-type poisoning: `<string>.charCodeAt()` types as `string`.**
`advance` originally reassigned a `let cc` to an anonymous struct literal `{ source: cc.source, ... }`; in
the FULL file (but NOT an isolated repro) the typer then inferred `cc.source.charCodeAt()` — and even
`peekCode(cc,0)` (a `-> int` fn) — as `string`, firing E-EQ-001 on `ch == 10`. Fix: factor a per-char
`advance1(c: Cursor) -> Cursor` with a clean typed param + `isLineFeed(code: int)` helper, so the reassigned
cursor stays `Cursor`-typed via the return annotation. Root cause = reassign-to-anonymous-struct poisons a
string field's host-method return type across functions. Localized; worth a typer follow-up.

Findings F2/F4/F5/F6 are ergonomic-but-workaroundable; F1 is the structural one; F3/F8 are latent
correctness/soundness bugs (silent arm-drop / cross-fn type poisoning) worth their own follow-ups; F7 is
benign noise. All confirmed against the live compiler at this worktree's base SHA (495a041b).

## STATUS — slice 1 COMPLETE (GREEN)
- [x] Phase 0 — oracle characterized + capability-probed (F1-F8 captured).
- [x] substrate + skeleton + scanners (lex.scrml) — compiles clean via the live compiler.
- [x] oracle test (self-host-v2-lexer-slice1.test.js) — 34/34 GREEN, token-parity vs impl#1 on the slice-1 corpus.

Slice-1 corpus GREEN classes: identifiers, keywords (JS_KEYWORDS minus contextual `type`), numbers
(int/decimal/hex/exponent), operators (`= == === =>  ! != !==  < <=  > >=  + ++  - --  ? ?? ?.  && || & |
* / %`), punctuation/brackets, trivia-skipping. Deferred (routed to `deferAdvance`, not scanned): strings,
template-interp, line/block comments, regex bodies + BracketStack/ErrorRecovery threading.

CONSUMED-BY-ORACLE runtime helper: `_scrml_structural_eq` only (deep-equal stub in the test).
Dogfood verdict: the flagship type+match-fold idiom LOWERS CORRECTLY through the real emitter (clean enum
objects + match IIFEs + threaded structs); it does NOT reach the importable library path (F1) — the single
structural blocker for "the compiler as idiomatic-scrml importable modules."

---

# self-host-v2 LEXER — slice 2 (strings + comments, S234)

Continues slice-1 (LANDED a8df839a). Same substrate/fold/oracle; adds the string
+ comment token classes.

## Slice-2 scope (built here)
- STRINGS — `scanString(cur, q)`: single- + double-quoted. A backslash escapes
  the NEXT code point (so an escaped quote never terminates the string — the only
  escape behavior that affects WHERE the string ends). Emits one
  `StringLit(cooked, raw, quote)` per string; token `text` = the RAW lexeme
  (quotes included), matching impl#1. `decodeSingleEscape` is the §12.8.4
  single-char escape table; `quoteCode` maps QuoteKind → closing-quote code.
- COMMENTS — `skipLineComment` (`//` → line-terminator/EOF) + `skipBlockComment`
  (`/*` → `*/`/EOF). impl#1 SKIPS comments as trivia; slice-2 matches — NO token
  emitted, only the cursor advances (line/col tracked by `advance`).
- Fold wiring — dispatch gains `(.InCode, .SawQuote(q)) :> scanStringStep(st, q)`,
  `(.InCode, .SawLineComment)` / `(.InCode, .SawBlockComment)` arms. `regexAllowedAfter`
  gains a `StringLit` case (a string cannot be followed by a regex).

## DEFERRED to slice-3 (still routed to `deferAdvance`; NOT scanned)
- template-interp nesting (InTemplateBody + `${…}`)  — SawBacktick event
- regex bodies (`/…/flags`)                          — SawRegexSlash event
- BracketStack + ErrorRecovery threading             — LexState fields not present yet
- **cooked-decode of hex/unicode/line-continuation escapes** (`\xHH`, `\uHHHH`,
  `\u{…}`, `\<newline>`): slice-2 decodes them via the single-char identity path,
  so `cooked` is approximate for those inputs — but `raw`/span are ALREADY correct
  (a backslash always escapes exactly the next code point, and hex/unicode escape
  bodies never contain a bare closing quote), so the token-diff (kind/text/span)
  is GREEN for them. Precise cooked-decode needs `parseInt` / `String.fromCodePoint`
  host support (unverified in scrml) — a slice-3 fidelity item, not a boundary bug.
The slice-2 corpus contains none of the still-deferred classes; the stub never fires.

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice2.test.js` — same
compile→discover→eval→token-diff harness as slice-1, over a curated string/comment
corpus (single/double strings, escapes, hex/unicode raw-parity, empty, unterminated,
line/block comments, comments+strings MIXED with slice-1 tokens) PLUS a slice-1
no-regression guard subset. Regex/template inputs stay OUT (deferred). 31/31 GREEN;
slice-1's 34/34 unchanged (no regression) — 65/65 across the two files.

## DOGFOOD FINDINGS — slice 2: ZERO NEW.
Every slice-2 shape the DD prescribes compiled + lowered correctly on the live
compiler (probed before editing lex.scrml):
- **multi-field payload-variant** construction — `.StringLit(cooked, raw, quote)`
  lowers to `{variant:"StringLit", data:{cooked, raw, quote}}` (slice-1 used only
  single-field payload variants; multi-field works).
- **product-match arm binding a payload variant in a tuple slot** —
  `(.InCode, .SawQuote(q)) :> …` lowers + binds `q` correctly (F3 was a LITERAL-
  in-tuple-slot drop; a payload-variant-with-binding is unaffected).
- **`match` arms whose patterns are escape-bearing string literals** —
  `"\\" :> "\\"`, `"\"" :> "\""`, `"\n" ` etc. lower + decode correctly.
No workarounds beyond the slice-1 set (F1 `<program>` wrapper, F2 string-dispatch,
F4 qualified `TokenKind.X` / typed-return helpers) were needed.

## STATUS — slice 2 COMPLETE (GREEN)
- [x] string scanners (single/double + escape boundary handling) — token-diff GREEN.
- [x] comment scanners (line/block, trivia-skipped) — token-diff GREEN.
- [x] oracle sibling test — 31/31 GREEN; slice-1 34/34 unchanged.
- Deferred to slice-3: template-interp, regex bodies, BracketStack/ErrorRecovery,
  precise hex/unicode/line-continuation cooked-decode.

---

# self-host-v2 LEXER — slice 3 (regex + template-interp, S234)

Continues slices 1-2 (LANDED). Same substrate/fold/oracle; adds the LAST two
token classes: REGEX bodies + TEMPLATE-INTERPOLATION nesting (the §51.0.Q.1
composite). Replaces the slice-2 `deferAdvance` stubs for the `SawRegexSlash`
and `SawBacktick` events.

## Slice-3 scope (built here)
- REGEX — `scanRegex(cur)`: `/pattern/flags` scanned when `regexAllowedAfter(last)`
  is true (slice-1's `/`-vs-division predicate). Char-classes (`[...]` — a `/`
  inside `[]` does NOT close the regex), escapes (`\/`), the IdentifierPart flag
  run, and unterminated bodies (stop AT a line terminator / at EOF). Emits ONE
  `RegexLit(pattern, flags)` token; token `text` = the RAW lexeme (both slashes +
  flags), matching impl#1. `regexAllowedAfter` gained `.RegexLit` + `.RBrace`
  false-cases (parity with impl#1's false-list; impl#1's value-keyword cases —
  this/true/false/null/undefined — do NOT apply here: this lexer's keyword set
  excludes them, so they lex as `Ident`, already in the false-list).
- TEMPLATE-INTERP — the composite. `scanTemplateChunk(cur)` scans a free-text run
  to the next backtick / `${` / EOF (a backslash escapes the next code point, so
  `` \` `` / `\${` never terminate). Emits `TemplateChunk(cooked, raw)` per run
  (the opening backtick is ABSORBED — the first chunk starts after it; the CLOSING
  backtick IS included in the final chunk's raw/span — an impl#1 asymmetry matched
  exactly), `TemplateInterpStart` (`${`) + `TemplateInterpEnd` (`}`) around each
  interp, and the interp body lexes as EXPRESSIONS (InCode) one level deep.
- Fold wiring — `dispatch` gains `(.InCode, .SawRegexSlash) :> scanRegexStep`,
  `(.InCode, .SawBacktick) :> enterTemplateStep`, `(.InCode, .SawInterpClose) :>
  closeInterpStep`. `step` now branches on `st.mode` FIRST (`.InTemplateBody :>
  templateBodyStep` — free-text, no trivia skip; else `codeStep` — trivia +
  classify + dispatch). `LexState` gains `bracketDepth: int` (a MINIMAL running
  open-bracket counter — NOT the full typed BracketStack, which is slice-4) +
  `interpDepths: int[]` (the interp frame stack). A single `mkState()` constructor
  centralises the field list.
- Interp-close disambiguation (§51.0.Q.1): `${` pushes the current `bracketDepth`
  onto `interpDepths`; a `}` is the interp-closer (SawInterpClose -> emit
  TemplateInterpEnd, pop the frame, resume InTemplateBody) ONLY when
  `bracketDepth == top(interpDepths)` — otherwise it is a plain RBrace (object
  literal inside the interp). `enterTemplateStep` DRIVES the first chunk
  synchronously (matches impl#1's backtick handler — guarantees the empty leading
  chunk even for a lone trailing backtick, which the `while (!isEof)` driver would
  otherwise skip at EOF); `closeInterpStep` does NOT (so a trailing `}` at EOF
  emits no extra chunk — also matching impl#1).

## DEFERRED to slice-4 (still routed / left approximate)
- Full typed `BracketStack` (opener kinds + spans) + `ErrorRecovery` LexState
  threading — slice 3 threads only the minimal `bracketDepth: int` needed for
  interp-close disambiguation.
- Precise cooked-decode of hex/unicode/line-continuation escapes — `TemplateChunk`
  `cooked` is set ~= `raw` (approximate); NOT compared by the oracle (kind/text/
  span only). raw/span are already correct (a backslash always escapes exactly the
  next code point, and escape bodies never contain a bare backtick / `${`).
- OUT OF SCOPE token classes surfaced by adversarial probing (excluded from the
  corpus, NOT regressions): the `.foo` BareVariant production (impl#1 lexes
  `` ``.length `` 's `.length` after a value as `BareVariant`; impl#2 emits
  `Dot`+`Ident`) and value-keyword-then-regex where impl#1's larger keyword table
  diverges (`typeof /re/` — impl#2 lexes `typeof` as `Ident` -> division).

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice3.test.js` — same
compile->discover->eval->token-diff harness, over REGEX_CORPUS (15: leading /
after-`=` / after-`return` / in-`(`/`[` / in-interp positions; char-classes;
escaped `/` and `]`; flags; unterminated at EOF and at a newline), DIVISION_CORPUS
(4: `/` after Ident / NumberLit / `)` / `}`), TEMPLATE_CORPUS (20: plain, empty,
single/multi/adjacent interps, interp-at-start, empty interp, object-literal +
expr + string + regex + arrow interp bodies, ONE/TWO-level nested templates,
escaped backtick, literal newline), MIXED_CORPUS (2), and a SLICE12_GUARD (9)
no-regression subset. 54/54 GREEN. Slices 1+2 unchanged (34/34 + 31/31) —
119/119 across the three files.

## DOGFOOD FINDINGS — slice 3

**F9 (NEW) — a literal `${` inside a scrml STRING literal is lexed as
interpolation, and an unbalanced `${` fails with E-CTX-003 "Unclosed 'logic'".**
`"${"` (or `'${'`, or any string with an OPEN `${` and no matching `}`) in an
expression-position string literal breaks lexing:
`<program>${ export fn g() -> string { return "${" } }</program>` ->
`E-CTX-003: Unclosed 'logic'` + `E-CTX-003: Unclosed 'program'`. A BALANCED
`"a${x}b"` compiles (scrml interpolates `${...}` inside string literals, BOTH
quote styles — `'lit${'` fails identically). This is likely INTENDED (scrml string
interpolation is a real feature; cf. §4.18.4 display-text `${...}` interpolation),
but it means a scrml-authored lexer/compiler cannot write a literal `${`/`}`
token-text as a plain string literal. WORKAROUND used: DERIVE the interp token
text from the source via `sliceText(cur, to)` (`${` = a 2-char slice, `}` = a
1-char slice) — no `"${"`/`"}"` string literal needed anywhere. Classification for
PA: language-feature interaction (ergonomic gotcha), cleanly workaroundable; flag
in case expression-position (non-display-text) string interpolation is NOT the
intended §4.18.4 scope.

**F7 confirmed at scale (benign, NOT new).** The slice-1 match-arm-reachability
gap now fires 21 `W-DEAD-FUNCTION` warnings (every match-arm-only callee:
`scanRegex`, `templateBodyStep`, `closeInterpStep`, `emitInterpStart`,
`scanTemplateChunk`, `bracketDelta`, `popDepth`, `mkState`, `codeStep`, etc.).
Codegen KEEPS them all (verified: `_scrml_lex_N` + every helper survives in the
emitted client.js; the oracle drives GREEN), so output is correct — the warnings
are noise. Reinforces F7's "match-arm call edges are not traced by reachability."

No NEW workarounds beyond the slice-1/2 set (F1 `<program>` wrapper, F2
string-dispatch, F4 qualified `TokenKind.X` / typed-return helpers) were needed.
Confirmed shapes that lower + execute correctly (probed before editing): nullary-
enum `match st.mode { .InTemplateBody :> … _ :> … }`; a new nullary event variant
(`.SawInterpClose`) added to the product match; `int[].slice(0, n)`; the `TmplScan`
struct carrying a `Cursor` + an enum field; the enter-drives-synchronously fold
shape.

## STATUS — slice 3 COMPLETE (GREEN)
- [x] regex scanner (char-classes + escapes + flags + unterminated) — token-diff GREEN.
- [x] template-interp composite (chunks + interp triad + nesting) — token-diff GREEN.
- [x] oracle sibling test — 54/54 GREEN; slices 1+2 unchanged (65/65) — 119/119 total.
- Deferred to slice-4: full typed BracketStack + ErrorRecovery threading; precise
  hex/unicode/line-continuation cooked-decode. Out-of-scope token classes noted
  above (BareVariant `.foo`; value-keyword-then-regex under a subset keyword table).

---

# self-host-v2 LEXER — slice 4a (precise cooked-decode, S235)

Continues slices 1-3 (LANDED). Same substrate/fold/oracle. Closes the slice-2/3
`cooked` fidelity item: the decoded value of a `StringLit` / `TemplateChunk` now
PRECISELY matches impl#1's `scanStringEscape` on the hex / unicode / brace /
line-continuation escape forms (previously decoded via the single-char identity
path — `raw`/span were already correct, only the uncompared `cooked` was approx).

## Slice-4a scope (built here)
- NEW escape machinery mirroring impl#1 (`native-parser/lex-in-single-string.js`):
  - `scanHexEscape(cur, digitCount)` — read exactly N hex digits → codepoint via
    `parseInt(hex, 16)` + `String.fromCodePoint(cp)`; `Number.isNaN(cp)` → "".
  - `scanBraceUnicodeEscape(cur)` — the `\u{…}` form; read hex to `}` → codepoint.
  - `scanEscape(cur)` — positioned AT the backslash; dispatches `\<LF>`/`\<CR>`/
    `\<CR><LF>` line-continuation (→ "" in cooked), `\xHH`, `\uHHHH`, `\u{…}`, and
    the single-char fallback (`decodeSingleEscape`). Returns an `EscapeScan
    {text, cur}` (decoded text + cursor advanced past the whole escape).
- `scanString` + `scanTemplateChunk` now BOTH call `scanEscape` on a backslash
  (impl#1 reuses the same `scanStringEscape` for template chunks — see
  `lex-in-template.js` L76). `TmplScan` gains a `cooked` field; `templateBodyStep`
  emits `kTemplateChunk(scan.cooked, scan.raw)` (was `(scan.raw, scan.raw)`).
- `raw`/span UNCHANGED: a backslash still escapes exactly the next code point, so
  the string/template END position is identical to slice-2/3 (the hex digits that
  were previously consumed as literals are now consumed by the escape — same end,
  since hex digits are never a bare quote/backtick). Verified by the oracle: the
  {kind, text, start, end} tuple stays byte-identical to impl#1.

## HOST-SUPPORT PROBE (done BEFORE editing lex.scrml — the slice-2/3 open question)
Slices 2/3 flagged precise decode as needing `parseInt` / `String.fromCodePoint`
"host support (unverified in scrml)." PROBED via a live-compiled `<program>`
(`const cp: int = parseInt(hex, 16)` annotated per F5), evaled through the same
discover-and-call harness. VERDICT — all THREE supported + correctly lowered, ZERO
workaround needed:
- `parseInt(hex, 16)` → clean `int`; `parseInt("41",16)==65`, `parseInt("1F600",16)==128512`.
- `String.fromCodePoint(cp)` → clean `string`; BMP AND astral (`128512` → 😀,
  a 2-code-unit result — JS handles it, and impl#2 reads only ASCII hex from source
  so the surrogate pair never touches `charAt`/`charCodeAt`).
- `Number.isNaN(cp)` → clean `boolean`; `parseInt("",16)` / `parseInt("zz",16)`
  both hit the NaN → "" branch.
Emitted JS is clean + readable (`const cp = parseInt(hex, 16); ...`). This RESOLVES
the slice-2/3 "unverified" flag — precise decode is a clean-compile, not a filed gap.

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice4a.test.js` — SAME
compile→discover→eval→token-diff harness, but the per-token tuple ALSO carries
`cooked` on `StringLit` / `TemplateChunk` (impl#1 `token.cooked`, spread top-level
by `makeToken`; impl#2 `token.kind.data.cooked`, the payload variant). Corpus:
STRING (14: `\xHH`, adjacent `\xHH`, `\uHHHH`, `\u{…}` BMP + astral, single-char
mix, unknown-escape identity, empty, woven-with-text), LINE_CONTINUATION (5: `\<LF>`
/ `\<CR><LF>` / `\<CR>` / multiple / leading), TEMPLATE (11: chunk hex/brace/astral/
single-char, escaped backtick, escapes flanking an interp, line-continuation chunk),
MIXED (3), a GUARD (10: slice-1/2/3 shapes incl. plain strings/regex/template — a
true no-regression check since non-escape tokens compare the same 4-tuple), plus 5
exact-value anchors (guarding against a silent impl#1+impl#2 co-drift). 49/49 GREEN;
slices 1-3 unchanged (34/34 + 31/31 + 54/54 = 119/119) — 168/168 across four files.

## DOGFOOD FINDINGS — slice 4a: ZERO NEW.
Every shape this slice needs compiled + lowered correctly on the live compiler
(probed before editing lex.scrml). No new Fn id assigned. Confirmed-clean shapes:
- **host globals `parseInt` / `String.fromCodePoint` / `Number.isNaN`** — usable
  WITHOUT import/allowlist declaration; annotate the result `: int` per F5 to feed
  the typer (host-global return types are `asIs`, same as host-method returns).
- **a struct-returning escape helper** — `-> EscapeScan { text, cur }` returned
  from an if-chain (no `match`, sidestepping F2/F6) resolves + threads cleanly;
  reused from two different scanner bodies (string + template chunk).
- **`let c2 = advance(...)` then `c2 = advance(c2, 1)`** — a reassigned Cursor local
  stays `Cursor`-typed via advance's return annotation (no F8 poisoning — the
  reassignment target is a typed-return call, never an anonymous struct literal).
Re-used workarounds (NOT new): F1 `<program>` wrapper; F5 `: int` on parseInt/
peekCode-derived locals. F7 (match-arm-reachability `W-DEAD-FUNCTION` noise) still
benign — the new helpers are reached only transitively from match-arm-only step
fns, but codegen KEEPS them all (oracle GREEN proves `lex()` + every helper survive
in the emitted client.js).

## STATUS — slice 4a COMPLETE (GREEN)
- [x] Phase 0 — host-support probe (parseInt/fromCodePoint/isNaN) — all clean, no workaround.
- [x] precise escape machinery (scanEscape/scanHexEscape/scanBraceUnicodeEscape) — compiles clean.
- [x] scanString + scanTemplateChunk carry true `cooked` — token+cooked-diff GREEN.
- [x] oracle sibling test — 49/49 GREEN; slices 1-3 unchanged (119/119) — 168/168 total.
- Deferred to slice-4: full typed BracketStack + ErrorRecovery threading (unchanged
  from slice-3's deferral). Out-of-scope token classes as noted in slice-3.

---

# self-host-v2 LEXER — slice 4b (typed BracketStack threading, S235)

Continues slices 1-4a (LANDED). Same substrate/fold/oracle. Closes the slice-3
deferral of the typed bracket stack: `LexState.bracketDepth: int` (a minimal
open-bracket COUNTER) is replaced by a typed `bracketStack: BracketKind[]` that
records the KIND of every open bracket. This is a PURE INTERNAL-STATE upgrade —
token output stays byte-identical to impl#1; the structural bracket knowledge is
what feeds the parser wave + slice-4's matched-closer ErrorRecovery.

## Slice-4b scope (built here)
- `LexState.bracketDepth: int` → `bracketStack: BracketKind[]` (reusing the
  slice-1 `type BracketKind:enum = { Paren, Brace, Bracket }`, declared-but-unused
  until now). `mkState` threads the new field; the initial state is an empty stack.
- `bracketDelta(c0) -> int` (the ±1/0 counter delta) is REPLACED by:
  - `pushBracket(stack, c0) -> BracketKind[]` — an opener `(`/`{`/`[` PUSHes its
    `BracketKind` (`stack.concat([BracketKind.Paren])` etc.); a closer `)`/`}`/`]`
    POPs the top; anything else returns the stack unchanged.
  - `popBracket(stack) -> BracketKind[]` — a bare `.slice(0, n-1)` pop mirroring
    `popDepth`'s shape (no mismatch/error handling — matched-closer recovery is
    slice-4's ErrorRecovery; a bare pop is all slice-4b needs — it preserves the
    old counter's depth = length).
- DEPTH is now `bracketStack.length`. The two counter reads move to length:
  - `isInterpCloseHere`: `st.bracketDepth == top` → `st.bracketStack.length == top`.
  - `emitInterpStart`: the `${`-open snapshot pushed onto `interpDepths` is now
    `stack.length` (was `st.bracketDepth`) — identical value. `interpDepths: int[]`
    stays as depth-snapshots (the length at which each `${` opened).
- Every step/dispatch/codeStep/template site that threaded `st.bracketDepth` now
  threads `st.bracketStack` (codeStep, emitOneToken, scanString/comment/regex steps,
  enterTemplateStep, templateBodyStep, closeInterpStep, deferAdvance, the `lex`
  driver). `popDepth` is UNCHANGED — still used for `interpDepths` in closeInterpStep.
- WHY the value is identical: `bracketStack.length` moves +1 on an opener and -1 on
  a closer at exactly the same code points the old counter did (openers/closers are
  always single-char tokens whose first char IS the bracket; the interp-closing `}`
  goes through closeInterpStep, never emitOneToken/pushBracket — so it never touches
  the stack, same as it never adjusted the old counter). So `isInterpCloseHere` and
  the interp-frame snapshots produce the same disambiguation RESULT — only the
  mechanism (length-of-stack vs int counter) changed.

## F4 PROBE — qualified `BracketKind.X` as a `.concat` array element
Probed a tiny live-compiled `<program>` BEFORE editing lex.scrml (the task's F4
probe): does a variant resolve as an array element inside `.concat([...])`?
- **Qualified `BracketKind.Paren`**: RESOLVED — compiles clean AND lowers correctly
  (`stack.concat([BracketKind.Paren])` → `stack.concat(["Paren"])`); runtime depth
  correct. This is the form used in lex.scrml (matches the file's `TokenKind.X`
  style + is the F4-safe choice).
- **Bare `.Paren`** (same position, `-> BracketKind[]` return + `BracketKind[]`
  receiver): ALSO RESOLVED — compiled clean and lowered to `["Paren"]`. This is a
  POSITIVE REFINEMENT of F4, NOT a new bug: F4 documents bare-variant-as-array-
  element as firing E-VARIANT-AMBIGUOUS "EVEN with the target type annotated," but
  empirically the bare form RESOLVES when the array literal flows into a `.concat`
  on a receiver whose element type is fixed (expected-type propagation through the
  concat receiver + the fn's declared `BracketKind[]` return). F4's failing cases
  were a fn-ARG (`mkTok(.LParen, …)`) / struct-field / standalone `[.X]` without a
  typed element-flow. Verdict recorded as **F4-refinement (positive)**; slice-4b
  keeps qualified anyway for clarity + guaranteed resolution.

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice4b.test.js` — SAME
compile→discover→eval→token-diff harness (cooked-carrying tuple, as slice-4a), over
bracket/interp-heavy corpora: BRACKET (10: `[({})]` mixes, nested calls/arrays/
objects, deep same-kind nesting, index-holding-call), INTERP (15: object-`}`-vs-
interp-`}` disambiguation, nested objects/arrays inside interps, nested templates
one+two levels deep, `a${ `b${ {k:1} }c` }d` deep nesting, adjacent interps,
paren-wrapped objects, triple-nested objects), AFTER_BRACE (6: regex-vs-division
after `}`/`]`/`)` — a `}` sets regexAllowedAfter=false, incl. division INSIDE an
interp after an object-`}`), MIXED (3: brackets+interps woven with slice-1..4a
tokens), a GUARD (12: slice-1..4a shapes incl. escapes/regex/template cooked), plus
6 exact STRUCTURAL ANCHORS (RBrace-vs-TemplateInterpEnd counts on the disambiguation
cases — guarding against a silent impl#1+impl#2 co-drift the differential can't see).
53/53 GREEN; slices 1-4a unchanged (34/34 + 31/31 + 54/54 + 49/49 = 168/168) —
221/221 across five files.
- Out-of-scope (excluded, NOT regressions): the slice-3 `BareVariant` divergence —
  impl#1 lexes `.length` AFTER a template value as one `BareVariant`, impl#2 emits
  `Dot`+`Ident`. A first-draft AFTER_BRACE entry (`` `${ {a:1} }`.length ``)
  tripped it; swapped for an on-topic division-inside-interp case. This is the
  documented slice-3 taxonomy difference, orthogonal to the bracket stack.

## DOGFOOD FINDINGS — slice 4b: ZERO NEW BUGS (one F4-refinement, positive).
No new live-compiler bug/gap surfaced — no new Fn id assigned. The one signal is
the **F4-refinement** above (bare variant DOES resolve as a `.concat` array element
when the element type is fixed by the typed receiver + declared return — narrower
failure than F4's blanket claim; a "this works" clarification, not a bug). Confirmed
shapes that lowered + executed correctly (probed before + validated by the oracle):
- **typed `BracketKind[]` struct field** threaded through the whole fold — pushes/
  pops via `.concat` / `.slice` lower cleanly (same array shape slices 1-3 used for
  `Token[]` / `int[]`).
- **empty array literal `[]` unifying to `BracketKind[]`** at the `mkState` call
  site (the `lex` driver's initial state) — infers cleanly against the typed param.
- **`.length` on a `BracketKind[]`** as an `int` in a comparison + as an
  `int[].concat` element (`ids.concat([stack.length])`) — clean.
Re-used workarounds (NOT new): F1 `<program>` wrapper; F4 qualified `BracketKind.X`
array elements. F7 (match-arm-reachability `W-DEAD-FUNCTION` noise) still benign —
`pushBracket`/`popBracket` are reached only transitively from match-arm-only step
fns, so they warn as dead, but codegen KEEPS them (oracle GREEN proves `lex()` +
every helper survive in the emitted client.js).

## STATUS — slice 4b COMPLETE (GREEN)
- [x] Phase 0 — F4 probe (qualified + bare `BracketKind.X` as `.concat` element) — both resolve; qualified chosen.
- [x] typed `bracketStack: BracketKind[]` (push/pop kinds) threaded through the whole fold — compiles clean.
- [x] interp-close disambiguation reads `bracketStack.length` (identical value) — token output byte-identical.
- [x] oracle sibling test — 53/53 GREEN; slices 1-4a unchanged (168/168) — 221/221 total.
- Deferred to slice-4 (item 3): ErrorRecovery (mismatch/unbalanced detection) +
  per-frame SPANS on the stack (slice-4b stores only the opener KIND — a bare pop
  preserves depth). Out-of-scope token classes as noted in slice-3 (`BareVariant`).

---

# self-host-v2 LEXER — slice 5a (BareVariant `.foo`, S235)

Continues slices 1-4b (LANDED). Same substrate/fold/oracle. Closes the slice-3
out-of-scope note: the contextual `.foo` BareVariant token. Previously impl#2
lexed `.foo` as two tokens (`Dot` + `Ident`); impl#1 lexes it as ONE `BareVariant`
token WHEN the `.` is in VALUE position (not member access). This slice matches
impl#1 on exactly that disambiguation.

## Slice-5a scope (built here)
- `TokenKind` gains `BareVariant(name: string)` (normalizes to impl#1's
  `"BareVariant"` kind — impl#1 emits the string kind + `{ name }` payload; impl#2
  emits `{variant:"BareVariant", data:{name}}`; the oracle's `normKind` collapses
  both, and `text` = `".name"` matches on both sides). Built by a typed-return
  helper `kBareVariant(name) -> TokenKind { return .BareVariant(name) }` (F4).
- `scanBareVariant(cur) -> Scan` — consumes the leading `.` + the identifier
  (mirrors `scanIdentOrKeyword`'s shape); `text = ".name"`, payload `name` = the
  identifier WITHOUT the dot (impl#1 parity: `"." + text` / `{ name: text }`).
- Fold wiring — a new nullary `SawBareVariant` LexEvent; a `classify` arm
  `if (c0 == 46 && isIdentStart(c1) && regexAllowedAfter(last)) return .SawBareVariant`
  (positioned with the sibling `SawRegexSlash` value-position check — same
  `regexAllowedAfter(last)` predicate impl#1's `.` handler reuses); a
  `(.InCode, .SawBareVariant) :> scanBareVariantStep(st)` dispatch arm; and
  `scanBareVariantStep` (emits one BareVariant, threads `bracketStack` unchanged —
  a `.` is not a bracket). The other `.` cases (member Dot, `.`+digit, `...`) are
  UNCHANGED — they fall through to `Ordinary` → `scanOperatorOrPunct`.
- `regexAllowedAfter` false-list gains TWO cases:
  - `BareVariant` — a bare variant is a VALUE, so a following `/` is division and a
    following `.foo` is member access (parity with impl#1; validated by the oracle's
    `.Foo.bar` → BareVariant + Dot + Ident and `x = .A / 2` → Slash cases).
  - `Unknown` — see the `@.field` note below.

## F4 handling for BareVariant construction (the brief's probe)
The variant is built via the typed-return helper `kBareVariant(name) -> TokenKind`
(the same F4-safe pattern as `kNumber`/`kUnknown`/`kString`/`kTemplateChunk`): a
BARE `.BareVariant(name)` in fn-RETURN position resolves; a bare variant as a
fn-ARG / struct-field / array-element does NOT (F4). No new probe was needed — the
typed-return-helper form is the established slice-1..4a idiom, and it compiled +
lowered clean (`kBareVariant(name)` → `{variant:"BareVariant", data:{name}}`), oracle
GREEN. No `TokenKind.BareVariant(...)`-as-arg form was attempted (F4 says it fails).

## The `@.field` disambiguation (brief requirement)
impl#1 lexes `@.field` as ONE `ScrmlAt("@.field")` token (a dedicated `@.` sigil
handler consumes the whole `.`-chain, so `.field` never reaches the BareVariant
production). impl#2 has NO `@`/ScrmlAt token class yet — `@` lexes as `Unknown`.
Left as-was, `regexAllowedAfter(Unknown)` returned true, so `.field` after `@` would
spuriously become a BareVariant. The brief requires "after `@`, `.field` must NOT be
a BareVariant," so `regexAllowedAfter` now treats `Unknown` as VALUE-ENDING
(returns false) — conservative and consistent with impl#1's `ScrmlAt → false` (the
scrml sigils `@`/`~`/`#` are value-producing, so a following `.`/`/` is
member/division, not a variant/regex). Result: impl#2 lexes `@.field` as
`Unknown` + `Dot` + `Ident` (verified — `.field` is a plain Dot, no BareVariant).
FULL `@.field` → one-ScrmlAt impl#1 parity is DEFERRED to the ScrmlAt sigil slice
(it needs the `@.`-chain handler, not just ScrmlAt in the false-list).

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice5a.test.js` — SAME
compile→discover→eval→token-diff harness (cooked-carrying tuple, as slice-4b). DIFFERENTIAL
corpus (every entry byte-identical to impl#1): VALUE_VARIANT (14: after `=`/`(`/`[`/`,`/
`return`/statement-start/`${}`-interp, annotated decl, member-then-variant-arg, variant
middle-arg, variant-then-call, `.A == .B`, variant after `{` in a match), MEMBER_DOT
(5: `obj.foo`, `a().b`, `x[0].y`, chained + deep member), VARIANT_THEN_MEMBER (3:
`.Foo.bar`, `x = .A / 2` division, `.State.Cape` — validates
regexAllowedAfter(BareVariant)=false), ADJACENT (3: `[.A, .B]`, `[.A, .B, .C]`,
newline-separated), MIXED (3: match with member+variants, struct with variant fields,
variants across call/array/interp), a GUARD (14: slice-1..4b shapes incl. member chains,
escapes cooked, regex, template, brackets, interp) — all GREEN. Plus impl#2-INTERNAL
structural anchors (guard against a silent impl#1+impl#2 co-drift the differential can't
see): `.Foo` → exactly one BareVariant text `.Foo` span [0,4]; `obj.foo` → zero BareVariant;
`[.A, .B]` → exactly two; `.Foo.bar` → one BareVariant + one member Dot; `x = .A / 2` → one
BareVariant + a Slash + zero RegexLit. Plus 3 OUT-OF-SCOPE negatives (divergent token classes,
NOT differential — `.5`/`...`/`@.field` each yield ZERO BareVariant; `@.field` = exactly
`[Unknown, Dot, Ident, EOF]`). 51/51 GREEN; slices 1-4b unchanged (34/34 + 31/31 + 54/54 +
49/49 + 53/53 = 221/221) — 272/272 across six files.

## DOGFOOD FINDINGS — slice 5a: ZERO NEW.
Every shape this slice needs compiled + lowered correctly on the live compiler (probed
before + validated by the oracle). No new Fn id assigned. Confirmed-clean shapes (all
already in the slice-1..4b idiom set):
- **new nullary `LexEvent` variant** (`SawBareVariant`) added to the product `match
  (st.mode, ev)` — same as slice-3's `SawInterpClose`; lowers + dispatches cleanly.
- **new single-field payload `TokenKind` variant** (`BareVariant(name)`) built by a
  typed-return helper (F4) — same shape as `Ident`/`Unknown`.
- **`is .BareVariant` / `is .Unknown` arms** extending the `regexAllowedAfter` chain —
  the F6-safe single-variant `is` chain (no `|` alternation), lowers cleanly.
- **compound-boolean `classify` arm** (`c0 == 46 && isIdentStart(c1) &&
  regexAllowedAfter(last)`) — standard.
Re-used workarounds (NOT new): F1 `<program>` wrapper; F4 typed-return kind helpers.
F7 (match-arm-reachability `W-DEAD-FUNCTION` noise) still benign — `scanBareVariant` /
`scanBareVariantStep` are reached only transitively from match-arm-only step fns, so
they warn as dead, but codegen KEEPS them (the oracle's BareVariant tokens prove
`scanBareVariant` runs in the emitted client.js).
NON-BUG deferral surfaced: the `@`/ScrmlAt token class (see the `@.field` note) — a
future slice, orthogonal to BareVariant. Also still deferred: leading-dot `NumberLit`
(`.5`) + `Ellipsis` (`...`) — separate token classes, not BareVariant scope.

## STATUS — slice 5a COMPLETE (GREEN)
- [x] `BareVariant(name)` TokenKind + `kBareVariant` helper (F4) + `scanBareVariant` — compiles clean.
- [x] `SawBareVariant` event + `classify` value-position arm + dispatch arm + `scanBareVariantStep` — token-diff GREEN.
- [x] `regexAllowedAfter` false-list gains `BareVariant` + `Unknown` (validated by `.Foo.bar` / `x = .A / 2` / `@.field`).
- [x] oracle sibling test — 51/51 GREEN; slices 1-4b unchanged (221/221) — 272/272 total.
- Deferred (separate token classes, NOT BareVariant scope): leading-dot `NumberLit`
  (`.5`), `Ellipsis` (`...`), the `@`/ScrmlAt sigil (full `@.field` → one ScrmlAt).
  Deferred to slice-4 (item 3, PARKED): ErrorRecovery + per-frame spans.

---

# self-host-v2 LEXER — slice 5b (value-keyword-then-regex, S235)

Continues slices 1-5a (LANDED). Same substrate/fold/oracle. Closes the slice-3
out-of-scope note "value-keyword-then-regex where impl#1's larger keyword table
diverges (`typeof /re/`)". The regex-vs-division disambiguation for a `/` that
FOLLOWS a keyword now matches impl#1 exactly:
- after a VALUE-KEYWORD (this/super/true/false/null/undefined) a `/` is DIVISION
  and a `.foo` is MEMBER access (a value-keyword produces a value);
- after any OTHER reserved word (return/typeof/in/instanceof/new/delete/void/
  throw/of/await/yield/do/…) a `/` OPENS A REGEX (the keyword expects a value next);
- after an OPERAND (Ident/NumberLit/`)`/`]`/`}`) a `/` stays DIVISION (unchanged).
Pre-5b, impl#2 reserved a 17-word subset, so `return /re/` regex-opened but
`typeof /re/` lexed `typeof` as Ident → regexAllowedAfter(Ident)=false → division —
DIVERGING from impl#1's `KwTypeof` → regex.

## Slice-5b scope (built here)
- `isKeyword` EXTENDED from 17 words to impl#1's FULL keyword table
  (`native-parser/token.js` `JS_KEYWORDS`, cross-checked verbatim). Added 34 words:
  `class extends new as default async await yield try catch finally throw
   typeof instanceof in of void delete is not lift fail render given some
   lin server pure this super true false null undefined`.
  DELIBERATELY EXCLUDED: `type` (impl#1 `CONTEXTUAL_KEYWORDS` — a type-decl lead
  only at statement position; an ordinary identifier everywhere else, so impl#1
  lexes it as `Ident` + a `ctxKw` marker the oracle ignores). Also NOT added:
  `case` / `switch` — impl#1 does NOT reserve them (they lex as `Ident`). WHY the
  exact impl#1 set: the oracle collapses impl#1's per-word `Kw*` AND impl#2's single
  `Keyword` to one canonical "KW" + compares `text`, so a word made a keyword on ONE
  side MUST be a keyword on the OTHER — a superset (adding case/switch/type) would
  flip an Ident→KW and DIVERGE; a subset (the pre-5b 17) diverges on the missing
  words (`typeof /re/`). Empirically probed impl#1 on each class before locking
  (case/switch/type→Ident; the 34 added→Kw*).
- `regexAllowedAfter` made TEXT-AWARE for keywords (the "text-table" approach, NOT
  "leave value-keywords as Ident"). New false-list case: `if (last is .Keyword) {
  if (isValueKeyword(keywordName(last))) return false; return true }`. So EVERY
  reserved word now routes through the `.Keyword` arm, split by the payload word:
  the six VALUE-KEYWORDS → false (division/member), all others → true (regex may open).
- Two helper fns (both F6-safe, mirroring `isKeyword`'s single-literal-arm shape):
  - `isValueKeyword(name) -> boolean` — a single-literal lookup table (this/super/
    true/false/null/undefined → true), = impl#1's regexAllowedAfter keyword
    false-cases (Kw{This,Super,True,False,Null,Undefined}).
  - `keywordName(k) -> string` — a single-ARM `match k { .Keyword(name) :> name
    _ :> "" }` pulling the reserved word out of the payload (see F10 below — an
    `is .Keyword(kw)` binding in an `if` CONDITION does not compile, so the payload
    is extracted via a match helper instead).
- WHY the text-table (not leave-as-Ident): Rule-2 full-fidelity. Leaving the six
  value-keywords as Ident would be division-correct but would lex `true`/`false`/
  `this`/etc. as Ident vs impl#1's `Kw*` — a REAL whole-stream taxonomy divergence
  on some of the most common barewords in any source, not just "not asserted." The
  text-table makes impl#2 == impl#1 on the FULL keyword class.

## PHASE-0 PROBES (done BEFORE editing lex.scrml)
1. `is .Keyword(kw)` payload-binding in an `if` CONDITION — FAILS (E-SCOPE-001
   `kw` undeclared + E-VARIANT-AMBIGUOUS). The brief's suggested form does not
   compile → filed as F10 (below). Fallback: a single-arm `match` helper
   (`keywordName`) binds the payload — PROBED CLEAN and correct at runtime.
2. Narrowing `TokenKind | not` → `TokenKind` after `if (last is not) return true`,
   then passing `last` to `keywordName(k: TokenKind)` — RESOLVES + lowers cleanly.
3. impl#1 keyword taxonomy — probed `lex1()` on each candidate word: the 34 added
   → `Kw*`; case/switch/type → `Ident`; all six value-keywords → division after,
   all operator keywords → regex after (locks the corpus).

## THE ORACLE (extended)
New sibling `compiler/tests/integration/self-host-v2-lexer-slice5b.test.js` — SAME
compile→discover→eval→token-diff harness (cooked-carrying tuple, as slice-5a). All
entries differential vs impl#1 (empirically probed before locking): REGEX_AFTER_
KEYWORD (12: return/typeof/in/instanceof/new/delete/void/throw/of/await/yield/do →
one RegexLit), DIVISION_AFTER_VALUE_KEYWORD (6: this/super/true/false/null/undefined
→ Slash), DIVISION_AFTER_OPERAND (5: after Ident/NumberLit/`)`/`]`/`}`), KEYWORD_
SANITY (11: `typeof x`, member access after value-keywords `this.foo`/`super.x`/
`true.toString`, `const t = null`, `a in b`, `x instanceof y`, `delete a.b`),
NON_KEYWORD (4: case/switch/type → Ident, so `case /re/` is division), MIXED (4),
a GUARD (15: slice-1..5a shapes incl. escapes/regex/template/brackets/BareVariant),
plus 8 structural anchors (`typeof /re/`→1 RegexLit/0 Slash + first tok KW "typeof";
`this / 2`→0 RegexLit/Slash/first KW "this"; `this.foo`→KW+1 Dot/0 BareVariant;
`typeof` alone→1 KW; `case`/`type`→Ident; `case /re/`→0 RegexLit/2 Slash — guarding
against a silent impl#1+impl#2 co-drift the differential can't see). 65/65 GREEN;
slices 1-5a unchanged (34+31+54+49+53+51 = 272/272) — 337/337 across seven files.

## DOGFOOD FINDINGS — slice 5b

**F10 (NEW) — a payload-binding `is .Variant(binding)` in an `if`/boolean
CONDITION does not compile; the binding never enters scope.**
`if (last is .Keyword(kw)) { … kw … }` → `E-SCOPE-001: Undeclared identifier
`kw`` (twice) + `E-VARIANT-AMBIGUOUS`. The `is`-with-payload form binds fine as a
`match` ARM pattern (`.SawQuote(q) :> …` — slices 2/3, and `keywordName`'s
`.Keyword(name) :> name` here), but as an `if`-condition `is` test the payload
binding is NOT introduced into the then-branch scope (the condition reads as a
bare tag test, and the `(kw)` sub-pattern's binder is dropped). WORKAROUND used: a
single-arm `match` extraction helper `keywordName(k) -> string` that binds the
payload in an arm and returns it (then `if (last is .Keyword) { … keywordName(last)
… }` — a bare tag test + a separate extraction). Classification for PA: an
ergonomic gap in `is`-pattern binding parity between `match`-arm position (works)
and `if`-condition position (silently drops the binder → E-SCOPE-001), cleanly
workaroundable via a match helper. Worth closing so flow-narrowing `is` tests can
bind payloads inline (a common shape when a union has one payload-carrying variant).

**F7 confirmed (benign, NOT new).** `isValueKeyword` / `keywordName` are reached
only transitively from `regexAllowedAfter` (itself called from `classify`, a
match-arm-only path), so they may warn `W-DEAD-FUNCTION`; codegen KEEPS them
(the oracle's `typeof /re/`→regex and `this / 2`→division prove both run in the
emitted client.js). Reinforces F7's "match-arm call edges untraced by reachability."

No NEW workarounds beyond the established set were needed for the keyword-table
extension itself (the 51-arm `isKeyword` is the same single-literal-lookup shape as
the 17-arm original — F6-safe; big-match compiles + lowers clean). F10 is the one
new finding. Re-used: F1 `<program>` wrapper; F6 single-literal `match` arms.

## STATUS — slice 5b COMPLETE (GREEN) — LEXER TOKEN-CLASS + REFINEMENT DONE
- [x] Phase 0 — probed `is .Keyword(kw)` if-binding (fails → F10) + the match-helper
  fallback + impl#1 keyword taxonomy (case/switch/type→Ident; 34 added→Kw*).
- [x] `isKeyword` extended to impl#1's full `JS_KEYWORDS` (minus contextual `type`) — compiles clean.
- [x] `isValueKeyword` + `keywordName` helpers (F6-safe) + text-aware `regexAllowedAfter` `.Keyword` case.
- [x] oracle sibling test — 65/65 GREEN; slices 1-5a unchanged (272/272) — 337/337 total.
- **The impl#2 lexer is now TOKEN-CLASS + REFINEMENT COMPLETE: items 1 (slice-4a
  precise cooked-decode), 2 (slice-4b typed BracketStack), 4 (slice-5a BareVariant),
  and 5 (slice-5b value-keyword-then-regex) are LANDED. Item 3 — ErrorRecovery
  (bracket-mismatch/unbalanced detection + per-frame spans) — remains PARKED pending
  a PA ruling; it is the sole remaining lexer work.**
- Still deferred (separate token classes, orthogonal to this slice, unchanged from
  5a): leading-dot `NumberLit` (`.5`), `Ellipsis` (`...`), the `@`/ScrmlAt sigil
  (full `@.field` → one ScrmlAt).
