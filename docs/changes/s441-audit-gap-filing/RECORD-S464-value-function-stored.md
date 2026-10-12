# RECORD — these repros are historical, not migrated (S464)

As of the S464 landing of `E-VALUE-FUNCTION-STORED` (SPEC §14.3 / §15.11.5.1 / §59.3 / §34 — no
value holds a function), the repros below are REFUSED by the compiler. They are kept verbatim as
the record of what S441 filed; they are NOT migrated (ruling: user-voice-scrml.md S464 "(a) Migrate
the tests" — "the historical docs/changes repros stay as records (marked, not migrated)").

- `repro/object-method-shorthand-emits-invalid-js.scrml` — stores a function in an object literal
  (method shorthand); compiled clean before the check. Whether the S440 named rejection for method
  shorthand exists is filed as `g-object-method-shorthand-named-rejection-unchecked-s465`.
- `repro/site-e-route-003-misses-inferred-function-return.scrml` — `@n = getFn()` where `getFn`
  returns an arrow: the state cell stores a function (fix round 1, S465: a call of a file function
  that may return a function counts as one). Compiled clean before the check.

Measured by compiling (s465-value-fn-land, 2026-10-12; fix round 1 the same day).
