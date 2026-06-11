# Progress — engine effect= diagnostics (S182)

Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aef0cd6564cf8443c
Base HEAD at start: 0a11f908

## Phase-0 survey (Fix 2)
- Discriminator: engine-decl node carries `legacyMachineKeyword` (ast-builder.js:13307, set from `block.name === "machine"`). E-ENGINE-003 loop in type-system.ts (buildMachineRegistry, :4978) has `decl.legacyMachineKeyword` available.
- CRITICAL FINDING: `E-ENGINE-VAR-DUPLICATE` (symbol-table.ts registerEngineDecl :5369/:5376) fires for BOTH `<engine>` AND legacy `<machine>` decls (no keyword discrimination). Confirmed empirically: a legacy `<machine>` duplicate fires BOTH E-ENGINE-VAR-DUPLICATE + E-ENGINE-003 today.
- Gate plan (symmetric, exactly-one-code per form):
  - type-system.ts E-ENGINE-003: fire ONLY when legacyMachineKeyword === true (legacy <machine>).
  - symbol-table.ts E-ENGINE-VAR-DUPLICATE: skip when legacyMachineKeyword === true.
  - Result: <engine> dup -> E-ENGINE-VAR-DUPLICATE only; legacy <machine> dup -> E-ENGINE-003 only.

## Steps
- [x] S1 parser opener flag (ast-builder.js: openerEffectMalformed/openerEffectBadSlice) + within-node STRIP_KEYS allowlist
- [x] S2 parser state-child flag (engine-statechild-parser.ts: effectMalformed) + interface (symbol-table.ts)
- [x] S3 SYM fire E-ENGINE-EFFECT-NOT-INTERPOLATED (symbol-table.ts: opener PASS 10.A registerEngineDecl / state-child PASS 17 validateEngineB17Diagnostics Fire-site #6)
- [x] S4 SPEC §34 (both tables 16895 + 31122) + §51.0.B attr-note (24609) + §51.0.H Form 1 + Form 3 normative clauses
- [x] S5 Fix 2 gate (symmetric): type-system.ts E-ENGINE-003 gates on legacyMachineKeyword===true; symbol-table.ts skips E-ENGINE-VAR-DUPLICATE when legacyMachineKeyword===true
- [x] S6 tests (engine-effect-not-interpolated.test.js, 7 tests) + test-anchor reconcile (native walker effectMalformed parity + makeMachineDecl legacyMachineKeyword x2)
- [x] S7 empirical recompile — all three scenarios verified against compiler/bin/scrml.js

## S7 empirical results (before -> after)
- S7.1 bare opener effect=load(): BEFORE silent clean compile (boot effect tree-shaken) -> AFTER FAILED with E-ENGINE-EFFECT-NOT-INTERPOLATED naming `load()` + ${} fix.
- S7.2 canonical effect=${load()}: AFTER compiles clean; client.js retains the "§51.0.H Form 3 opener effect= (boot-only init effect)" IIFE calling _scrml_load_2() (canonical path UNREGRESSED).
- S7.3 two <engine for=T> auto-declaring 't': BEFORE both E-ENGINE-VAR-DUPLICATE + E-ENGINE-003 -> AFTER exactly ONE (E-ENGINE-VAR-DUPLICATE). Legacy <machine> dup -> exactly ONE (E-ENGINE-003).

## Test baseline
- BEFORE: 16599 pass / 0 fail (unit+integration+conformance) ; native-canary suite 23830 pass / 0 fail.
- AFTER: 16606 pass / 0 fail (+7 new) ; native-canary suite 23837 pass / 0 fail.
