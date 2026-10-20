# s469-boot-strings-1 — progress (crash-recovery note)

Branch `s469-boot-strings-1` (cut from origin/main 1c9cc4a6e). Bootstrap strings + tape methods slice.

## Scope / status
- A int→string: NOT implemented (PA mid-task directive: bryan reconsidering conversions as a whole).
  string + int refusal unchanged. SPEC conversion-like forms listed in the handback.
- B string methods: DONE — analyze.scrml `resolveMethod` (binder: receiver type decides; ONE table
  `methodSig` / `methodResult`), typer `methodType` / `methodArgCheck`; Core PrimOp Str*; print +
  runtime helpers `strSlice` / `strCharAt` / `strSplit` (code points).
- C tapes: DONE — sort() (SortNum/SortStr), sort(cmp) (SeqFn.SortBy, comparator body must be a number),
  reverse(), join(sep) (string tapes only); E-TAPE-JS-METHOD for push/unshift/splice/toSorted/toReversed/with
  and a discarded sort/reverse/fill/copyWithin; allowlist renamed push→append, unshift→prepend (tests migrated);
  `@x = @x.sort()` / `.reverse()` classified as a position write (shape 4).
- D lint: DONE — parse.scrml `interpLiteralLint` (raw token text; escaped `\${` and `${"${"}` silent;
  code-default display literals take it back in displayNodes). W-STRING-INTERP-LITERAL PROVISIONAL:
  scripts/gen-bootstrap-severity.ts PROVISIONAL table -> Warning.
- Acceptance: acceptance/{strings,tapes,interp}; slice-m4/strings-s469.test.js; acceptance.test.js STATUS.

## Remaining at last update
- DONE (resumed after power loss): conformance `--write` (205 PASS / 81 FAIL, unchanged), 5 known-gaps entries +
  `bun scripts/state.ts --write`, branch renamed to s469-boot-strings-1. Final gate on the docs commit.
