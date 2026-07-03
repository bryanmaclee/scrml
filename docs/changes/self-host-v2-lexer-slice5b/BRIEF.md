# BRIEF — self-host-v2 lexer slice-5b (value-keyword-then-regex)

sPA ss55 · item 5/5 (FINAL) · dispatched to `scrml-js-codegen-engineer` (self-provisioned from spa/ss55 @ e700b0d1).

## Task
Make impl#2's `/`-vs-division disambiguation match impl#1 for keyword-preceded `/`: `return /re/` + `typeof /re/`
(+ impl#1's other operator-keywords) → regex; value-keywords (this/super/true/false/null/undefined) + operands → division.

## Approach (Option A — full parity, per Rule 2 no-ship-smaller-surface)
Extended `isKeyword` from the 17-word subset to impl#1's EXACT `JS_KEYWORDS` (34 words added: class/extends/new/as/
default/async/await/yield/try/catch/finally/throw/typeof/instanceof/in/of/void/delete/is/not/lift/fail/render/given/
some/lin/server/pure/this/super/true/false/null/undefined). EXCLUDED `type` (impl#1 contextual → Ident+ctxKw) and
case/switch (impl#1 does NOT reserve → Ident). Rationale: the oracle collapses Kw*/Keyword→"KW"+text, so impl#2's
keyword set must EQUAL impl#1's — a superset flips Ident→KW (diverges on `case /re/`), a subset diverges on missing
words (`typeof /re/`). `regexAllowedAfter` made text-aware: `if (last is .Keyword) { if isValueKeyword(keywordName(last))
return false; return true }` — 6 value-keywords → division, all others → regex (matches impl#1's keyword false-cases).

## Result
`self-host-v2-lexer-slice5b.test.js` — 65 differential + structural tests vs impl#1. **337/337 seven-file total**
(272 slices1-5a unchanged + 65). Independently re-verified in spa/ss55.

## NEW dogfood — F10
`if (last is .Keyword(kw)) { …kw… }` payload-binding in an `if`/boolean CONDITION does NOT compile
(`E-SCOPE-001 Undeclared identifier kw` + `E-VARIANT-AMBIGUOUS`). The payload binder works as a `match`-ARM pattern but
is silently dropped in an `if`-condition. Workaround: single-arm `match` extraction helper `keywordName(k)` + bare
`is .Keyword` tag test. Cleanly workaroundable; worth a typer/parser follow-up so flow-narrowing `is` tests bind payloads inline.

Dev-agent branch `self-host-v2-slice5b` @ 26d2e2fa. FINAL lexer slice — impl#2 lexer token-class + refinement COMPLETE
(items 1,2,4,5; item 3 ErrorRecovery parked pending PA ruling). Full prompt in the S235 sPA transcript.
