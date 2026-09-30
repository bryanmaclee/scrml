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

## Round 4 (round-3 re-review DO-NOT-LAND; bryan ruling "ratify with the changes, arithmetic stays protected")
- b36376f3f — F3: protect origin matching case-insensitive per SQLite rules
  (`FROM USERS` emitted no tag at all — also on main). Unresolvable quoted /
  schema-qualified forms degrade to strip-all. Cases select-upper-column-e006,
  from-upper-table-e006, upper-table-row-strip.
- e99676259 — F1: a value selected by a protected key is protected all the way
  down (scalar AND deep) — `L[c].v`, `L[c].test()`, `Object.keys(L[c])`,
  `M.get(c).v`. Cases lookup-field/-method/-keys-e006, map-get-field-e006.
- 2fab69f9d — F2: alias classes (union-find over binding keys). Values carry the
  binding cells they may BE; binding / containing / passing to a parameter unites
  classes; a write INTO an object lands in the whole class; each binding's own
  value stays its own. `_scrml_structural_eq` modelled as derived (its memo
  structures otherwise alias both operands — measured, it made A16 fail).
  Cases alias-write-e006, helper-mutates-param-e006, nested-container-write-e006.
- d65c8ab6c — N3 RULING: arithmetic / bitwise / unary + - ~ / ++ -- / compound
  assignment results are PROTECTED; comparisons, !, typeof stay derived. reveal
  composes: `u.reveal("pin").pin * 3` is clean and ships (runtime case
  reveal-then-arithmetic-clean, @total = 3702). Case arithmetic-e006.
- SPEC §14.8.9 + §34 row reconciled (case-insensitive origin, aliases, keys all
  the way down, arithmetic ruling normative; N4 position-oracle/implicit-flow
  out-of-scope kept).
- Reviewer repros (protect-rr3/c, 110 cases): every leaking case REJECTED;
  negatives (clean, keysrow*, keysstr, omitok, pickok, pickrows, q1, q2, case5,
  case7, f3main, n2c/n2e/n2i/n2j) compile. n2i/n2j are the N4 bound.
- Noted fail-closed FP (LOW, kept): `omit({a: u}, ["b"])` rejected.
- Noted separate codegen bug: `?{…}.get().passwordHash` drops the trailing member
  (returns the row — stripped, safe) (f3main).
- Corpus (2225 files vs origin/main f0377fbf5): newly failing = only the 20
  intentional `*-e006` cases. Arithmetic ruling: 0 non-intentional failures.
- Push of this round was DENIED by the permission classifier; local branch only.

## Round 5 (fresh agent; round-4 review DO-NOT-LAND)
- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab2240605e359d289, base = 049390932 + merge origin/main 6dccbd6cf (10120709a).
- Harness: scratch s443-protect/probe.mjs — compile, seed sqlite (hash
  SECRET-HASH-123, pin 4321), serve the emitted routes with Bun.serve, POST the
  getIt route over real HTTP, print status + body. Before = `git archive` of the
  merged base; after = the worktree.
- ALL FOUR findings + the nit REPRODUCED over HTTP on the merged base
  (F1 `({length:h}).length` 200 "SECRET-HASH-123", `new Array(u.pin).length`
  200 4321; F2 `SELECT id, PASSWORDHASH … return u` 200 {"id":1,"passwordHash":…};
  F3 every expression shape 200 with the value (hex: 5345…); F4 all ten
  element / prototype shapes 200 with the hash; NIT reveal("PIN") E-PROTECT-006).
- Fixes (protect-flow.ts, protect-egress.ts):
  - F1: `Taint.len` — what `.length` reveals; explicit-derived only for a column
    read off a row, template / concat / String() of such, array literals (+ spread
    lengths), `.map` / `.filter` / `.sort`, row arrays. Default = naked (fail closed).
    Identity builtins (`Array`, `Array.from`, `Object.assign` …) reset to default.
  - F2: descriptor records the DECLARED name for an unaliased column; runtime
    `_scrml_protect_fold` in tag / reveal / redact; flow compares folded
    (`rowColFor`, revealed stored folded). pick = fold-match (over-approx), omit =
    exact match only (a case-variant omit key does not remove the runtime key).
  - F3: `lexSqlEntry` (structural lexer: strings skipped, "…" `…` […] unwrapped,
    words folded) over each OPAQUE projection entry; any protected column name, or a
    nested projection `*` (previous token SELECT/DISTINCT/ALL/,/.), → `{all:true}`.
    First cut treated every `*` as projection and stripped trucking-dispatch's
    customer list over `(SELECT COUNT(*) …)` — caught by the trucking baseline test.
  - F4: `writeThrough` — a container write lands in the syntactic root binding AND
    every alias class of the written-into value (`refs`); unmodelled-method results
    carry receiver + argument refs; Object.values/entries/fromEntries/Reflect.get
    carry arg refs; Object.setPrototypeOf unites + writes proto contents;
    Object.create / getPrototypeOf modelled.
  - NIT: reveal names folded (flow, runtime, E-PROTECT-004 revealedColumnsIn).
- 03a05dbc0 — unrelated flake that blocked the commit gate: §64
  standalone-tool-target liveness test re-called `reader.read()` every 200 ms tick
  and lost the port line to the abandoned read (2/3 fails at load ~7). One pending
  read carried across ticks; 4/4 pass.
- ea597b5bc — the fix + tests (unit, integration compiled AND executed) + 4
  conformance cases (select-upper-column-row-strip-runtime,
  expr-column-row-strip-runtime, length-object-e006, element-alias-write-e006).
  Pre-commit gate 32952 pass / 0 fail.
- After (HTTP): every F1-F4 shape rejected (E-PROTECT-006) or stripped
  (row → {"id":1} / {}); self-check set (repeat/padEnd/Array.from/spread/
  a.length=/String(Array)/destructure/helper/Object.create/findLast/entries/
  push-via-find/Object.assign-via-find/omit(["PASSWORDHASH"])/users.PASSWORDHASH)
  all closed; negatives unchanged (h.length 15, [h].length 1, map.length,
  template length, count(*), lower(name), pick/omit, clean find-write).
- OVER-APPROXIMATIONS (fail closed, reported): SQL-derived values
  (`length(passwordHash)`, `passwordHash = ${x} AS ok`) strip the row wholesale;
  any identifier in an expression column that spells a protected column name of
  ANY protected table counts; `.length` of an unmodelled method result
  (`u.passwordHash.trim().length` — was 200 15, now E-PROTECT-006); pick with a
  case-variant key keeps the column; unmodelled-method results alias receiver +
  arguments.
- MIGRATION (2166 files: examples/ samples/ conformance/cases/
  docs/readme-snippets/ stdlib/, one compile per file):
  vs round-4 base: changed = the 3 new intentional conformance cases only
  (+ stdlib async/await deltas that are a harness artifact — both archived
  compilers show them identically, main vs base shows none). vs origin/main: the
  round 1-4 intentional set (I-PROTECT-STRIP-001 1->0 on trucking app/login,
  samples/login, protect-001-basic-auth; the *-e006 cases) + the new cases.
  No real example / sample / snippet / stdlib file gains E-PROTECT-006.
  The first F3 cut DID change one real example (trucking customers.scrml,
  row stripped wholesale over `(SELECT COUNT(*) …)`); fixed before commit.
