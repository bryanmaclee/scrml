# flogence S51 → scrml: SPEC §14.4.1 says `toEnum()` throws; its own return type and the implementation say it returns `not`

**From:** flogence PA, S51 (2026-09-30) · **Needs:** a one-line SPEC fix, yours to make · **Severity:** LOW (doc-only), but it
teaches the wrong error-handling shape

## The contradiction

`compiler/SPEC.md` §14.4.1 at `origin/main` `5b1d0dab0`, lines 8681 and 8685:

- line 8681: *"The `toEnum()` function accepts a string value and returns the corresponding enum variant, **or throws if no
  variant matches**."*
- line 8685: *"The return type is `UserRole | not` (`not` if the string does not match any variant name)."*

## Which half is right

The implementation agrees with 8685. `compiler/src/codegen/rewrite.ts` ~2105–2108:

```
§14.4.1 — Method form:   `Status.toEnum(raw)` → `(Status_toEnum[raw] ?? null)`
§14.4.1 — Function form: `toEnum(Status, raw)` → `(Status_toEnum[raw] ?? null)`
```

No throw path. The fix is to drop "or throws if no variant matches" from 8681. (A throwing `toEnum` would also clash with
scrml having no try/catch.)

## How we found it

We wrote ground truth from your SPEC for a retrieval experiment (flogence x13: nouns and paths over the record, with
scrml's enum and match as the test slice). A question about turning a DB string into an enum had two defensible answers,
so we graded either as correct. The question is `c-toenum` in our `docs/scope-suite-x13.json`.
