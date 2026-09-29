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

## Round 3 (after round-2 review LAND-WITH-NITS, gated on N1)
- e0bfed2dc — N1 (object KEY carries provenance: `{[h]:1}`, `o[h]=v`, `m.set(h,v)`,
  reduce index-by), N2 (lookup keyed by a protected value is protected; `.get(h[i])`),
  predicate-method names trusted only on string-like receivers (user `.digest()`/
  `.test()` on an object fails closed), `getTime` removed from DERIVED, N5
  (`Object.keys(row)` clean; `scrml:data` pick/omit modelled with literal keys;
  `export {x} from` resolved), N6 (all `Bun.*` off the allowlist), debug line has
  `passes=`. Conformance computed-key-e006, reduce-index-by-e006.
- 8142f7c90 — SPEC: arithmetic provenance stated as OPEN (derived in this
  version, `x*1`/`+x` pass), keys-are-data, position-oracle / implicit-flow bound,
  no `Bun.*`, pick/omit + re-exports.
- d12a2c4a7 — merge origin/main f0377fbf5.
- Probes p1-p12: remaining ships are exactly the out-of-scope set — arithmetic
  identity on a protected number (A12 `*1`, A13 unary `+`, A22 `-0`: OPEN,
  pending ruling), implicit branch copy (A16) and position oracles (A9/A18 —
  N4 bound), DB round trip (F5).
- Not fixed (fail closed, reported): X1/X1c re-export-only `c.scrml` emits NO
  `.server.js`, so `import { nm } from "./c.server.js"` dangles; the flow treats it
  as a host import (fails closed — E-PROTECT-006 even for the clean `nm`). That is
  a separate emission gap (re-export-only module not emitted), not a flow bug.
- F17 `Bun.CryptoHasher(...).digest()` now fails closed (N6: no Bun.* derivers).
- Corpus: 2213 files vs origin/main f0377fbf5 — newly failing = only the 10
  intentional `*-e006` cases.
