# RECORD — this repro is historical, not migrated (S464)

As of the S464 landing of `E-VALUE-FUNCTION-STORED` (SPEC §14.3 / §15.11.5.1 / §59.3 / §34 — no
value holds a function), `repro/object-method-shorthand-emits-invalid-js.scrml` is REFUSED by the
compiler (it stores a function in an object literal; it compiled clean before the check). It is
kept verbatim as the record of what S441 filed; it is NOT migrated (ruling: user-voice-scrml.md
S464 "(a) Migrate the tests" — "the historical docs/changes repros stay as records (marked, not
migrated)").

Measured by compiling (s465-value-fn-land, 2026-10-12).
