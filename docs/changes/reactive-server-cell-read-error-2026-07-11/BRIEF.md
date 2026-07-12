# RULING A (final) — free client-cell read in a server-escalated fn is a COMPILE ERROR

bryan ruled **A** (B and C were mis-reads; B was seeded by the S249 scope draft's false
claim that the marshal already worked). We do NOT build the marshal and do NOT ship a
warning. Reading a free client cell in a server-escalated fn is a COMPILE ERROR — the value
does not cross the wire (client sends `{}`, server reads `undefined`). Force the author to
pass it explicitly or use §52.

## A — design
Reading a free client cell (raw `@var` OR `const` derived) inside a server-escalated fn is
a compile ERROR — the READ-side sibling of E-RI-002 (server fn *assigns* @reactive).
- Code: fix + broaden E-REACTIVE-003 (SPEC-only / never-fires — a fail-open). Reword from
  "server can't access a client-side construct" to the true reason: a free client-cell read
  in a server-escalated fn resolves to `undefined` — the value is not transported. Broaden
  from derived-only to ANY free client cell (raw `@var` + `const` derived). New subsuming
  code allowed if reuse is awkward — justify.
- Fire in the ANALYSIS phase — route-inference.ts (E-RI-002's read sibling; reasons about
  escalation + `@session` ambient at :459-477). NOT codegen/emit-functions.ts.
- Message: name the cell; state it resolves to `undefined` server-side (not transported);
  give two fixes — (1) pass it as an explicit function argument (`fn(@cell)` + a matching
  param — params ARE marshalled), (2) declare a `<… server>` §52 cell.
- EXCLUDE (no error): declared params, §52 `<… server>` cells, ambient `@session`/`@currentUser`.

## SPEC (surgical — reactive §§ only, NO §20)
Do NOT retire E-REACTIVE-003. Reword §6.6.9 to the accurate reason + two escape hatches;
broaden to raw `@var`. Fix/keep §17 + §34 catalog rows (E-REACTIVE-003 now fires, as error).

## Conformance
- server-fn reads a `const` derived → E-REACTIVE-003 (error).
- server-fn reads a raw `@var` → E-REACTIVE-003.
- NEG: server-fn RECEIVES the value as an explicit param → clean.
- NEG: server-fn reads a §52 `<… server>` cell → clean.
- NEG: server-fn reads `@session` / `@currentUser` → clean.

## R26 empirical (both directions)
1. `saveOrder()` reading `@total` → ERRORS with guidance.
2. Corrected `function saveOrder(total:number){ ?{…${total}…} }` + `<button onclick=saveOrder(@total)>`
   → compiles CLEAN and emitted client `_scrml_body` carries `total` (params ARE marshalled).

## Constraints
SAME branch (after `git reset --hard ebb285f2`), commit incrementally. Files:
route-inference.ts (error), SPEC.md (reactive §§ only), conformance. Do NOT touch (S250
navigate footprint): emit-expr.ts, runtime-template.js, runtime/stdlib/router.js,
emit-channel.ts, emit-server.ts, collect.ts, sql-projection.ts, analyze.ts, SPEC §20.
GATE: full `bun test compiler/tests/{unit,integration,conformance} --bail` green +
`bun conformance/run.ts`. NEVER `--no-verify`. HOLD on branch — do NOT merge to main.
