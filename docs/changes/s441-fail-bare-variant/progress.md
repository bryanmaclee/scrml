# progress s441-fail-bare-variant

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2a4cf60776b0f7f7 (base cf62b4154)
- repro (repro/*.scrml, stamped base cf62b4154): bare-canonical 2x E-ERROR-009; qualified-canonical OK;
  bare-error-generic 1x E-ERROR-009; bare-noncanonical-invalid -> only E-CODEGEN-INVALID-LOGIC (the TS check skipped:
  `enum E {}` never registers); examples/09 4x E-ERROR-009. Imported enum resolves; undeclared / struct declared
  types compiled clean with bare fail (vacuous).
- fix: type-system.ts E-ERROR-009 site — resolve bare -> declared type, write enumType onto node, run §19.3.3 checks;
  unresolved declared type + bare -> E-ERROR-009 (import names exempt).
- codegen identity: 09 bare vs qualified — server.js identical, client/html differ ONLY in the path-derived scope hash;
  same-path unit test asserts byte identity.
- corpus before/after (2033 files): only FAIL->OK flips (09, phase1-const-inside-error-arm-017, phase1-let-inside-error-arm-020,
  + the new RT conformance case); zero OK->FAIL.
- conformance: base 1047/1054 + 7 xfail; after 1050/1057 + 7 xfail.
- suite: 32355 pass / 85 skip / 0 fail.
- found (pre-existing, NOT fixed): `!{}` catch-all arm `| err :>` binds `result.data`, not the error variant -> 09's
  `<Failed err>` renders an empty message (identical under qualified spelling). Server-side single-field fail payload
  emits raw `data:` (client emits field-keyed).
