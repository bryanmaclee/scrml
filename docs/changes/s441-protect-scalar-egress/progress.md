# s441-protect-scalar-egress — progress

- start: worktree at base 55ebd22bb (origin/main).
- REPRODUCED by execution (gap-filing reproducer, S9g): seeded row, authenticated
  session + CSRF token, emitted route handler called → `200 "SECRET-HASH-123"`;
  build reported `I-PROTECT-STRIP-001 … strips passwordHash` (false).
- db0b83e69 — fix: `compiler/src/codegen/protect-flow.ts` (provenance flow);
  tests + 5 corrected conformance expectations + trucking baseline + 7 cases.
- 4c6d333e5 — SPEC §14.8.9 amendment, E-PROTECT-006 §34 row, truthful
  I-PROTECT-STRIP-001 row.
- ca5588aad — adversarial round 2 (9 more shapes).
- bd1ac2342 — pushed; security review → LAND-WITH-NITS conditional on F1/F2.
- FIX ROUND (8b74c93a3 + merges 11bcd5f68 / 031f6d5b8 of origin/main):
  - F1 HIGH cross-file helper: the flow now runs ONCE per compile in api.js over
    every emitted server module, `./X.server.js` imports resolved to the emitting
    module; emit-server only registers per-file strip records + span lookup.
    Unresolved (host / stdlib / npm) imports are opaque host functions.
  - F2 HIGH inverted default: any callee the compile does not contain, given a
    protected scalar OR row, returns protected — only the explicit deriver
    allowlist is exempt. charCodeAt/codePointAt removed from DERIVED_METHODS.
  - F3 MED: every argument of `new Response(body, init)` (headers) +
    `Response.redirect` / `Response.json` are sinks.
  - F4 LOW: covered by the inverted default + `Object.defineProperty` modelling.
  - F6 LOW: call-site sensitive — each distinct PROTECTED argument signature of a
    helper is its own instance (closures carry their environment). First cut
    keyed on callbacks too → 4016 instances / 245 closures / 3 s on one module
    (timed out CONF-SESSION-8B); keying on the protected signature only → 40
    instances / ~20 ms. Budget exhaustion fails closed (E-PROTECT-006).
  - SPEC §14.8.9 S441 amendment rewritten with the bounds NORMATIVE; §34 row updated.
  - 3 new conformance cases: scalar-helper-cross-file-e006 (multi-file),
    response-header-e006, scalar-encoding-e006.

## The rule (also in the protect-flow.ts header)

A value whose provenance includes a `protect=` column, and which is NOT still
carried inside a descriptor-bearing row, SHALL NOT reach a client-egress sink.
The compiler proves this over ALL emitted server modules of the compile and
rejects the build with `E-PROTECT-006` — never strips at runtime, never passes.

- Provenance is PRESERVED BY DEFAULT through every step, including any call into
  code the compile does not contain (fail closed).
- DERIVER ALLOWLIST (the only exemptions): comparison/arithmetic operators, `!`,
  `typeof`, `.length`, predicate/position methods (not charCodeAt/codePointAt),
  `scrml:auth` verifyPassword/hashPassword/verifyTotp, `scrml:crypto`
  hash/hmac/verifyHash, `Bun.password.*`, `Bun.hash`, `crypto.subtle.digest`,
  `.digest()`, `Boolean`, `isNaN`, `Array.isArray`, `console.*`. NOT `Number`.
- Module-defined functions: interprocedural, call-site sensitive.
- `reveal("col")` honoured exactly as at the sink.
- Sinks: `_scrml_protect_redact(arg)`, the §37 SSE frame, every argument of
  `new Response`, `Response.redirect`, `Response.json`, `.publish`, `.enqueue`, `.send`.
- `I-PROTECT-STRIP-001` only for a query whose row reached a redact sink (no fallback).
- Unparseable module / exhausted budget → `E-PROTECT-006` (fail closed).

## Disclosed bounds
- DB round trip (write into a non-protected column, read back) — OUT of scope (F5).
- Flow-insensitive within a function (reassignment to clean still protected — fails closed).
- `Number(x)` deliberately NOT allowlisted (identity on a numeric protected column);
  the reviewer's list included it.

## Corpus sweep (fix round): 2204 files = examples/ samples/ conformance/cases/
docs/readme-snippets/ docs/tutorial-snippets/ + 135 read-only scrml-site + flogence copies,
base = origin/main 650c47c29 vs tip
- Newly failing: ONLY the 8 intentional `*-e006` conformance cases. No example,
  sample, snippet, site or flogence file newly fails.
- I-PROTECT-STRIP-001 dropped (truthfully) on trucking app.scrml + login.scrml,
  protect-001-basic-auth.scrml, samples/login.scrml and 4 conformance cases.
