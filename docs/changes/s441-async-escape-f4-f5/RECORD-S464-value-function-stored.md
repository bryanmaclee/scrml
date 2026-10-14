# RECORD — these repros are historical, not migrated (S464)

As of the S464 landing of `E-VALUE-FUNCTION-STORED` (SPEC §14.3 / §15.11.5.1 / §59.3 / §34 — no
value holds a function), every repro in this directory that stores a function in an object or
array literal is REFUSED by the compiler. They are kept verbatim as the record of what S441
measured; they are NOT migrated (ruling: user-voice-scrml.md S464 "(a) Migrate the tests" — "the
historical docs/changes repros stay as records (marked, not migrated)").

Newly refused (compiled clean before the check):

- `review-repro/xf-toplevel-obj/case.scrml`
- `review-repro/tl-obj-method/case.scrml`
- `review-repro/xf-obj-fn/case.scrml`
- `repro/fp1b-member-call.scrml`

Already refused before the check (`E-ASYNC-FN-ESCAPES-AS-VALUE`), now ALSO
`E-VALUE-FUNCTION-STORED`:

- `repro/f4-nested-objfield.scrml`, `repro/blast-toplevel.scrml`,
  `repro/merge-1158-scheduler-shadowed.scrml`, `repro/f4-client-helper-objfield.scrml`,
  `repro/f4-nested-arrayelem.scrml`, `repro/f4-client-helper-arrayelem.scrml`,
  `repro/f4-client-serverfn-arrayelem.scrml`, `repro/f4-client-serverfn-objfield.scrml`

Measured by compiling (s465-value-fn-land, 2026-10-12).
