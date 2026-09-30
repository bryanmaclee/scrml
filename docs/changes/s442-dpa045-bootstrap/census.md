# dpa-045 call C — the LOOP CENSUS of the bootstrap (`compiler/self-host-v2`)

Base: origin/main 6dccbd6c. Ruling: user-voice-scrml.md S442 "dpa-045 … = all PA recs" (C runs against the
bootstrap). Question per loop: does it INDEPENDENTLY decide where a markup/state body, a logic region or an
interpolation ENDS — and is it a **walker** (steps over whole tokens / whole nested openers, so a delimiter
inside a string, comment, template or nested element cannot move the end) or **flat** (byte-level,
opener-blind: decides on raw characters)?

Scope: every loop in `lex.scrml` / `parse.scrml` that computes an extent. `ast.scrml`, `analyze.scrml`,
`lower.scrml`, `print.scrml`, `core.scrml`, `walk.scrml`, `check.scrml`, `ingest.scrml`, `css*.scrml` compute
no source extents (they consume trees). Token-level loops inside `parse.scrml` (parseList, parseBlock,
parseObject, parseArrayElems, parseVariants, parseTypeFields, parseFn, parseImport, lambdaParams) walk an
ALREADY-BOUNDED token run and never decide a region end — listed once, at the bottom.

## The census

| # | loop (file · fn) | decides the end of | kind | how | verdict |
|---|---|---|---|---|---|
| 1 | lex.scrml · `lexFrom` + `LexStop` (`stopBefore` / `stopAfter`) over `step` | every LOGIC region the parser hands it: `${ … }` interpolation / logic block, `( … )` / `{ … }` / bare attribute values, `#{ … }`, `function` / `type` / `import` items, `:`-shorthand body, code-default body run | **walker** | the one token fold: strings, comments, regex, templates (with `${` nesting via `interpDepths`) are consumed as whole tokens; brackets tracked as a TOKEN stack (`bracketStack`); a stop fires only at token depth 0 | **CANONICAL** — the ruled `findInterpolationCloseOffset` shape (§4.18.1b: brace-TOKEN depth, never raw bytes) |
| 2 | parse.scrml · `parseInterp` | `${ … }` in markup | walker (delegates) | `regionTP(…, LexStop.Balanced)` → #1 | uses the canonical routine |
| 3 | parse.scrml · `parseAttrValue` (paren / braced / bare) | an attribute value | walker (delegates) | #1 with `Balanced` / `BareValue` | uses the canonical routine |
| 4 | parse.scrml · `skipCss` | `#{ … }` | walker (delegates) | #1 `Balanced` | uses the canonical routine |
| 5 | parse.scrml · `parseShorthand` | a `:`-shorthand body (§4.14) | walker (delegates) + one flat post-check | #1 `Shorthand` (depth-0 `>` not followed by `=`); then `comparisonTail` (#12) | extent from the canonical routine |
| 6 | parse.scrml · `parseCodeBody` | a code-default state-child body run (§4.18.1) | walker (delegates) | #1 `CodeBody` (depth-0 tag / `${`) | uses the canonical routine |
| 7 | parse.scrml · `parseMarkupItem` / `logicRegionItem` | a `${…}` item / a braceless `function` / `type` / `import` at program level | walker (delegates) | #1 `Balanced` / `Statement` / `Line` | uses the canonical routine |
| 8 | parse.scrml · `parseKids` | a FREE-TEXT body (plain-markup element children) | **flat — the free-text production itself** | char loop; exits at `</`, `<!--`, `//`, `#{`, `${`, `<`; each nested construct is handed to a walker (#2, #4, `parseMarkupNode`) that returns past its whole extent | the free-text production's own scanner (by the ruling it is decided by bounded lookahead over raw bytes — flat BY DESIGN). **Defect found: `<` + anything opened a tag** (`a < b` → E-PARSE-TAG cascade). FIXED (below). |
| 9 | parse.scrml · `parseDeclBody` | a declaration body (child declarations + state-children) | flat, opener-level | skips trivia, dispatches each `<…>` to `parseDeclChild` (a walker over the nested opener/body); stray text → E-PARSE-DECL-BODY | walks whole openers — **walker at the opener level** |
| 10 | parse.scrml · `parseMarkupItems` | the program / file body (default-logic mode, §40.8) | flat, opener-level | same shape as #9 | walker at the opener level |
| 11 | parse.scrml · `parseOpener` / `scanAttr` | an opener (`<name … >`) | flat, attribute-level | char loop over attribute names; every VALUE is #3 (walker) | a `>` inside a quoted / parenthesized / braced value cannot end the opener — walker for values |
| 12 | parse.scrml · `comparisonTail` (r1 F3) | nothing — detects a `>` comparison after a shorthand's `>` | flat | raw scan to newline / `<` | a diagnostic heuristic, not an extent; never moves an end |
| 13 | parse.scrml · `closerAfterShorthand` (r1 nit) | consumes an adjacent `</>` / `</tag>` | flat | spaces then literal match | diagnostic only |
| 14 | parse.scrml · `parseQuoted` | a `"…"` / `'…'` ATTRIBUTE string | **flat + a CHARACTER escape** | char loop; `\` escapes the next char | ⚑ the one remaining character escape in a region scanner (§5 attribute strings, not the §4.18.3 display-text literal — outside B(3)); agrees with #1's string rule. Recorded, not changed (not ruled). |
| 15 | parse.scrml · `skipMarkupComment` | `<!-- … -->` | flat | `indexOf("-->")` | a comment has no nested structure — correct as flat |
| 16 | parse.scrml · `skipLineComment` / `skipTrivia` | `//` to end of line | flat | char loop | ⚑ see the `//` finding below |
| 17 | parse.scrml · `parseOpenerType` / `typeTextEnd` / `grantWords` | an opener's `:Type[…]` | flat | `indexOf("]")`, char loop to space / `=` / `/` / `>` | types hold no nested brackets or strings — flat is exact here |
| — | parse.scrml token loops (parseList, parseBlock, parseObject, parseArrayElems, parseVariants, parseTypeFields, parseFn, parseImport, lambdaParams, skipParams, skipToLineEnd) | nothing — they consume an already-bounded token run from #1 | walker (token) | — | not extent-deciders |

**Canonical:** #1, `lex.scrml lexFrom` (the token fold + `LexStop`). Every LOGIC-region / interpolation extent
in the bootstrap already goes through it (#2–#7); there is no raw `{`/`}` byte counter anywhere in the
bootstrap. The only flat extent decider is #8 — the free-text production, which the ruling makes a
bounded-lookahead byte production by design; its nested constructs are always handed to walkers.

## ⚑ Findings the census surfaced (not decided here — for the PA / bryan)
- **`//` in a free-text body is a comment in the bootstrap (§27 / §4.7 "universal"),** so `http://x` in a `<p>`
  drops `//x…` to the end of the line, and a `</p>` on that line is suppressed (it moves the body's END). The
  ruled D says free text has "exactly two ways out … and no others" and "the body's end is set by its delimiters
  alone"; §4.7 (older, normative) says `//` suppresses delimiters "at ALL context levels". The two conflict, and
  the §66.19 SPEC programs themselves put `// …` comments inside free-text bodies (`<label>…</label>   // …`).
  NOT changed — needs a ruling (is `//` a comment inside a plain-markup body?).
- **`#{` in a free-text body** is taken as a CSS block (S440 R4: element-level `#{}` is program-global) — also an
  exit outside D's closed set. NOT changed — same ruling question.
- **L13 whitespace normalization** (lower drops whitespace-only text containing a newline) contradicts "whitespace
  kept exactly". NOT changed: it would change the five pre-existing programs' lowered Core (the stop condition),
  and the ruling puts measurement E (the whitespace oracle diff) BEFORE the SPEC text lands.
