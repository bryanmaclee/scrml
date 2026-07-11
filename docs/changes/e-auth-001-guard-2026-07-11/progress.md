# progress — E-AUTH-001 guard (SECURITY diagnostic)

Status: COMPLETE (branch only — NOT landed). Full gate green.

## Divergence reproduced (before)
`compiler/SPEC.md` §52.4.6 worked example (a top-level `?{}` INSERT binding a client-local `@editingId`)
compiled to **`E-DG-002`** ("declared but never consumed") + `W-CG-001`, with **ZERO** `E-AUTH-001`
fire-site anywhere in `compiler/src/` (grep clean). The client-controlled value was not even recognized
as consumed by the write.

## Fire-site + condition implemented
- New standalone check `checkClientLocalWriteParams(fileAST, errors, fileSpan)` in
  `compiler/src/type-system.ts` (sibling of the E-AUTH-002/005 authority checks), invoked from `runTS`
  after `annotateNodes`.
- **Condition** (fires E-AUTH-001, Error): a `${@var}` interpolation whose base names a **client-local**
  reactive cell appears in a **persisted-write** `?{}` (leader INSERT / UPDATE / DELETE, or a `WITH` CTE
  carrying one), **AND** the write is NOT inside a server-call boundary.
- **Authority classification** mirrors the §52 state-decl authority flags the E-AUTH-002/005 checks read:
  `isServer` (Tier-2 `<x server>`) OR `serverAuthorityTable` (Tier-1 `<Type authority="server">`
  instance) ⇒ server-authoritative ⇒ EXEMPT. `@currentUser` when the ambient is active (no user
  `<currentUser>` cell shadows it) ⇒ §52.15 server request-identity ⇒ EXEMPT. Undeclared `@name` ⇒
  E-STATE-UNDECLARED's concern, not this rule's.
- **"outside a server function" is load-bearing** (the crux). An in-function `?{}` (or an inline `?{}`
  in an event-handler ATTRIBUTE) is a **CPS-split server-call boundary** (§12.2) — the compiler marshals
  the client-local `@var` to the server as `_scrml_body[...]`, so it is NOT an unmediated leak (locked by
  `compiler/tests/unit/inline-sql-in-branch-cps.test.js` §2/§4, which emit `_scrml_body["draft"]`). The
  genuine leak is a **top-level** `?{}` write in a program-scope `${...}` logic block (the §52.4.6 shape,
  which `W-CG-001` also flags "won't execute"): no boundary marshals its params. The guard therefore
  suppresses firing when the write is nested in a function body (any `function`/`fn` kind) or a markup
  element's `attrs` (event-handler position); markup CHILDREN are NOT suppressed (a top-level `?{}` under
  `<program>`/`<db>` markup children is still the §52.4.6 leak).
- **Direct-reference scope** (matches the E-AUTH-002 sibling, which checks direct `@`-idents in init
  exprs): a value laundered through an intermediate `let x = @cell` before the write is NOT caught (at the
  bound-param site it is no longer a `@`-sigil read). A data-flow taint pass is out of scope. String
  literals inside an interpolation are stripped first (an `@` inside a quoted email is not a reactive read).

## E-DG-002 interaction resolution
Per SPEC §52.4.6 "Expected compiler output" (which shows **only** E-AUTH-001), E-AUTH-001 **REPLACES**
E-DG-002 — the value IS consumed by the write, just illegally. The DG builder previously never credited
`?{}` bound-param reads, so the client-local cell read as "never consumed." Fixed in
`compiler/src/dependency-graph.ts`:
- Top-level / logic-block `?{}` reads credited via a new pass over `collectAllSqlBlocks` keyed through a
  new `sqlAstToNodeId` identity map (mirrors `markupAstToRenderId`; `makeNodeId` embeds a monotonic
  counter and can't be recomputed).
- In-function `?{}` reads credited in `walkBodyForReactiveRefs` (the fn-body walk never visited `sql`
  nodes). This authority-agnostically credits any `@var` in any `?{}` query as a consumer (correct DG
  semantics: a var in a query IS consumed — read or write).
The `auth-001-pos` conformance case locks the REPLACE with `notCodes: ["E-DG-002"]`.

## §34 catalog row
The `E-AUTH-001` §34 row ALREADY EXISTS (`compiler/SPEC.md` line 17871) — no SPEC edit required.

## Adversarial verification matrix (16 scratch cases, all pass)
LEAK → E-AUTH-001 fires:
- top-level INSERT `${@editingId}` (§52.4.6 verbatim); top-level UPDATE; top-level DELETE;
- compound `${@editingId + 1}`; user-shadowed client-local `<currentUser>`; WITH-CTE + DELETE;
- multiple client-local vars in one write (fires per-var).
SAFE → no E-AUTH-001:
- in-function `?{}` (CPS boundary marshals — was the false-positive that broke §2/§4; now correct);
- §52.4.6 remedy (server fn + param `${id}`); Tier-2 `<count server>`; `@currentUser.id` ambient;
- `<currentUser server>` shadow; SELECT read; client-local var in client-only logic (no `?{}`);
- `@` inside a string literal (email); intermediate `let`-alias (documented direct-ref limitation).

## Pre-existing samples/cases that flipped
`compiler/tests/unit/inline-sql-in-branch-cps.test.js` §2 + §4 red-flagged on the FIRST (over-broad)
implementation, which fired E-AUTH-001 in-function. These tests LOCK the CPS-split marshalling contract
(§12.2): a client-local `@draft` in a `?{}` INSERT inside `function add()` (called from `on:click=add()`)
compiles clean because the value is marshalled to the server. This surfaced that "outside a server
function" is load-bearing — the in-function firing was a FALSE POSITIVE, corrected to fire only outside a
server-call boundary. NOT a real leak in the corpus; a scoping correction. No genuine leak-shape sample
was found in the suite.

## Conformance case ids
- `conformance/cases/auth/auth-001-pos` (§52.4.6 leak → E-AUTH-001; notCodes E-DG-002 locks REPLACE).
- `conformance/cases/auth/auth-001-neg` (§52.4.6 remedy: write inside a server fn w/ param → no fire).
- `compiler/tests/conformance/conf-AUTH-001.test.js` (11 tests: 6 LEAK + 5 SAFE, cross-stream helper for
  the E-DG-002 REPLACE assertion since E-DG-002 is a warning-stream code).

## Oracle before → after (§52.4.6 verbatim)
- BEFORE: `E-DG-002` (warning) + `W-CG-001`; NO E-AUTH-001.
- AFTER:  `E-AUTH-001` (error) + `W-CG-001`; E-DG-002 SUPPRESSED (replaced).

## Files touched
- `compiler/src/type-system.ts` — `sqlIsPersistWrite`, `sqlInterpolationSigilReads`,
  `checkClientLocalWriteParams` + the `runTS` wire.
- `compiler/src/dependency-graph.ts` — `sqlQueryInterpolationSigilReads` helper, `sqlAstToNodeId` map,
  top-level + in-function `?{}` reader-credit for E-DG-002.
- `conformance/cases/auth/auth-001-pos/*`, `conformance/cases/auth/auth-001-neg/*`.
- `compiler/tests/conformance/conf-AUTH-001.test.js`.
- `docs/changes/e-auth-001-guard-2026-07-11/BRIEF.md` + `progress.md`.

## Deferred / noted
- Intermediate-`let`-alias launder is NOT caught (direct-ref scope, matches E-AUTH-002). A taint pass
  would close it; out of scope + consistent with the family.
- `REPLACE INTO` (SQLite upsert) is not in the SPEC's INSERT/UPDATE/DELETE enumeration; not fired on
  (SPEC-literal). `INSERT ... ON CONFLICT` / `INSERT OR REPLACE` ARE covered (INSERT leader).
- An inline `?{}` write inside an `<engine>`/`<machine>` arm action (non-function-decl server-call
  position) is not specially guarded; unusual shape, noted for follow-up if it arises.
