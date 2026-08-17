# dpa-030 D2 — FIX ROUND 1 (S349)

Append-only. Base: `45fc29b5` (`dpa030-emit-server-defects`). Branch: `egress-fix-r1`.

---

## [1] Baseline reproduction — BOTH blockers reproduced by execution, not relayed

Harness (scratchpad, not committed): compile with `compiler/bin/scrml.js`, seed a sqlite
`app.db`, seed `globalThis.__scrml_session_store` with an authenticated session, `Bun.serve`
the emitted route, and `fetch` it over real HTTP.

### BLOCKER 1 — cross-function + object spread ships a `protect=` column at HTTP 200

Source (`repro.scrml`): `fetchUser` runs `SELECT * FROM users`, `serveSpread` calls it and
returns `new Response(JSON.stringify({...u}), { status: 200 })`.

Compile on `45fc29b5`: **EXIT 0**, and the compiler printed

> `I-PROTECT-STRIP-001`: the egress floor strips protected column(s) `passwordHash` from the
> client response of `SELECT * FROM users WHERE id = ${id}`

Executed over HTTP:

```
HTTP 200
WIRE {"id":1,"name":"ada","passwordHash":"SECRET-PW-HASH"}
```

Emitted line that leaks (`repro.server.js`):

```js
const _scrml_result = await (async () => {
  let u = await fetchUser(id);
  return new Response(JSON.stringify({...u}), {status: 200});
})();
if (_scrml_result instanceof Response) return _scrml_result;
```

The `{...u}` spread copies the enumerable Symbol descriptor but DROPS the non-enumerable
`toJSON`, which is the only thing that made a raw `JSON.stringify` redact.

### BLOCKER 2 — server-internal `JSON.stringify` silently loses columns (branch-vs-base differential)

Source (`repro-b2.scrml`): one server fn SELECTs the row, `JSON.stringify`s it, and INSERTs the
string into a server-side `audit` table. Same source, two compilers, driven identically:

```
BASE   (protect-egress.ts @ c159f1a2): AUDIT {"id":1,"name":"ada","passwordHash":"SECRET-PW-HASH"}
BRANCH (45fc29b5):                     AUDIT {"id":1,"name":"ada"}          <- silently lost
```

Clean compile both times. The audit snapshot never crosses the wire; the branch redacted it
anyway. Confirmed: this is a NEW regression that `main` does not have.

### Incidental (surfaced, not in scope of the two blockers)

- With `auth="none"` / `auth="optional"` the server-fn prologue takes the baseline-CSRF arm,
  which has **no** `if (_scrml_result instanceof Response) return _scrml_result;` line. A
  hand-built `Response` returned from such a body is `JSON.stringify`d to `{}` and re-emitted
  as a 200 — the same DENY-becomes-SUCCESS shape D2c documents, on a different arm. Recorded
  for PA; not fixed here (it is not one of the two blockers and it is pre-existing at
  `c159f1a2`).
- The ss1 module-value export of an async server fn drops the `await`
  (`export function serveSpread(id) { let u = fetchUser(id); ... }` — `u` is a Promise).
  Pre-existing, unrelated, recorded only.

## [2] Corpus measurement (blast radius for a newly-rejecting raw-egress gate)

`grep -rlE --include='*.scrml' 'new +([A-Za-z_$]+[.[])?"?Response|Response *\. *json'` over the
whole worktree, excluding `node_modules` — **12 hits in 10 files**:

```
samples/gauntlet-r14/react-auth-dashboard.scrml:10        new Response('Unauthorized', {status:401})
samples/gauntlet-r13/react-auth-dashboard.scrml:10        new Response('Unauthorized', {status:401})
docs/website/pages/articles/server-boundary-disappears.scrml:52,56,60,65   (HTML-escaped prose)
conformance/cases/protect/reveal-suppresses-e004/case.scrml:9
conformance/cases/protect/raw-egress-e004/case.scrml:9
compiler/tests/fixtures/semdiff/{opaque-unchanged,flogence-opaque}/{base,head}.scrml:4
```

Intersected with the 75 `.scrml` files that declare `protect=`: **the only intersection is the
two dedicated `conformance/cases/protect/` cases**. `examples/23-trucking-dispatch/pages/**`
contains neither `Response` nor `asIs` (an earlier looser regex mis-matched them; re-grepped,
zero hits). So the measured corpus blast radius of tightening the raw-egress gate is the
conformance pair that exists to exercise it.

