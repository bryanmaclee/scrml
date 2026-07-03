# BRIEF — self-host-v2 lexer slice-5a (BareVariant `.foo` token)

sPA ss55 · item 4/5 · dispatched to `scrml-js-codegen-engineer` (self-provisioned from spa/ss55 @ fe53bf78; item 3 skipped/parked).

## Task
Lex the contextual bare-variant `.foo` as ONE `BareVariant(name)` token when the `.` is in VALUE position
(`isIdentStart(peek1)` AND `regexAllowedAfter(lastKind)`), matching impl#1 (`lex-in-code.js:765-789`); else keep
plain `Dot` (member access). Add the TokenKind variant + `SawBareVariant` LexEvent + classify arm + `scanBareVariant`
step; extend `regexAllowedAfter` false-list with BareVariant. F4: construct via typed-return helper `kBareVariant`.

## Result
`self-host-v2-lexer-slice5a.test.js` — 51 tests (40 differential vs impl#1 + structural anchors + out-of-scope
negatives). 272/272 six-file total (221 slices1-4b unchanged + 51). Independently re-verified in spa/ss55. Dogfood: ZERO NEW.

## Judgment calls (surfaced by agent)
- **`@.field`:** impl#2 has no ScrmlAt yet (`@` → Unknown). Set `regexAllowedAfter(Unknown)=false` so `.field` after `@`
  does NOT become a spurious BareVariant (honors the brief). `@.field` now lexes `[Unknown,Dot,Ident]`; full
  `@.field`→one-ScrmlAt impl#1 parity DEFERRED to a future ScrmlAt sigil slice (needs the `@.`-chain handler).
- **`.5` NumberLit + `...` Ellipsis:** out-of-scope token classes impl#2 lacks; asserted as impl#2-internal negatives
  (BareVariant does not over-fire), per the slice-3 out-of-scope precedent — NOT differential-corpus entries.

Dev-agent branch `self-host-v2-slice5a` @ 63210ab7. Full prompt in the S235 sPA transcript.
