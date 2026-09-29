# s441-protect-scalar-egress — progress

- start: worktree at base 55ebd22bb (origin/main).
- REPRODUCED by execution (gap-filing reproducer, S9g): seeded row, authenticated
  session + CSRF token, emitted route handler called → `200 "SECRET-HASH-123"`;
  build reported `I-PROTECT-STRIP-001 … strips passwordHash` (false).
- db0b83e69 — fix: `compiler/src/codegen/protect-flow.ts` (provenance flow) wired
  at the `I-PROTECT-STRIP-001` drain in `emit-server.ts`; rewriter infos carry a
  SQL skeleton; tests + 5 corrected conformance expectations + trucking baseline
  + 7 new conformance cases.
- 4c6d333e5 — SPEC §14.8.9 amendment, E-PROTECT-006 §34 row, truthful
  I-PROTECT-STRIP-001 row; SPEC-INDEX regen.
- round 2 — adversarial pass found 4 more shipping shapes (JSON.parse roundtrip,
  `"".concat`, `.replace` embed, `Array.from` mapper) + 5 found while closing
  them (Promise executor, throw/catch, reject/.catch, getter, toJSON). Closed.

## The rule (also in the protect-flow.ts header)

A value whose provenance includes a `protect=` column, and which is NOT still
carried inside a descriptor-bearing row, SHALL NOT reach a compiler-emitted
client-egress sink. The compiler proves this over the EMITTED server module and
rejects the build with `E-PROTECT-006` — never strips at runtime (a stripped
scalar silently changes what the program returns), never passes.

- Provenance propagates through identity-preserving steps: binding, member /
  index / destructuring extraction, object/array literal re-housing, spread,
  container writes (push/set/Object.assign), string concat + templates, `?:`
  `&&` `||` `??`, await, calls to module-defined functions (interprocedural,
  params + returns), array callbacks, join/string transforms/embedding methods,
  serializing/decoding built-ins, getters/toJSON, Promise resolution, throw→catch.
- DERIVED (not rejected, §14.8.9 bound): comparison, arithmetic, predicate
  methods, `.length`, result of passing a SCALAR to a function the module does
  not define (`verifyPassword(pw, u.passwordHash)`).
- `reveal("col")` honoured exactly as at the sink (column-keyed).
- Sinks: every `_scrml_protect_redact(arg)` (server-fn/endpoint response,
  /__serverLoad, /__mountHydrate, broadcast, watches), the §37 SSE frame
  (`for await (const _scrml_val …)` — event/id bypass the redact), and the raw
  serializers (`new Response(body)`, `Response.json(v)`, `.publish`, `.enqueue`,
  `.send`) — enumerated over SERIALIZERS, not just redactor call sites.
- `I-PROTECT-STRIP-001` fires only for a query whose row reached a redact sink
  carrying an unrevealed protected column.
- Unparseable server module → `E-PROTECT-006` (fail closed).

## Disclosed bounds
- Extraction inside code the module does not contain (an import receiving a
  whole row) is assumed descriptor-preserving.
- Flow-insensitive (fails closed on reassignment).
- `arguments[i]`, class instances, `Reflect`/Proxy tricks: not modelled (scrml
  source has no classes; `arguments` is not idiomatic scrml).

## Corpus sweep (2049 files: examples/ samples/ conformance/cases/ docs/readme-snippets/ docs/tutorial-snippets/)
- Newly rejecting pre-existing files: NONE. E-PROTECT-006 fires only on the 5 new
  e006 cases + 3 cases that already failed (E-PROTECT-004/005).
- I-PROTECT-STRIP-001 dropped (correctly — row never reaches egress) on:
  examples/23-trucking-dispatch/app.scrml, pages/auth/login.scrml,
  samples/compilation-tests/protect-001-basic-auth.scrml, samples/login.scrml,
  + the 5 conformance cases whose expectations pinned the false claim.
- trucking-dispatch server output byte-identical before/after; compile time unchanged.
