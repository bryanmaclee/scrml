# dpa030-defects — progress (append-only)

Three defects that all write `compiler/src/codegen/emit-server.ts`. Bundled because they
COLLIDE on that file, not because they are one concern. Landed as separate logical units.

- **D2** — the live confidentiality leak: `handle()` / server-fn returning
  `new globalThis.Response(JSON.stringify(row))` over a `protect=` table compiles CLEAN.
- **D3** — `request.formData()` emitted unawaited.
- **D4** — no body-size ceiling on any of the three JSON prologues + malformed-JSON
  `SyntaxError` instead of the §61.3 compiler-owned 400 envelope.

---

## 0. Startup

```
WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac0d4d12007dc725e
git rev-parse --show-toplevel == pwd  ✓
git status --short                    clean ✓
base commit                           c159f1a2 (origin/main tip)
bun install                           217 packages ✓
bun run pretest                       13 test samples compiled ✓
```

### Baseline `bun run test` (before any change)

```
 29988 pass
 216 skip
 1 todo
 55 fail
 132788 expect() calls
Ran 30260 tests across 1362 files. [246.77s]
```

The 55 failure NAMES are captured verbatim so the post-change comparison is by NAME, not
by count. They are the known browser-tier baseline (navigate-wave1c cross-chunk, Bug 60
compound render, TodoMVC dist-not-compiled, transition directives, §51.0.S engine runtime,
region-swap reactivity) plus four ~10 s `commands/dev` watcher tests. None are in the
surface any of D2/D3/D4 touches.

---

## 1. D2 — premise verification (BEFORE writing any fix)

Per the standing rule "verify the dispatch premise empirically" — I compiled the shape
before scoping the fix, rather than reasoning from a read of the source.

### The three differential controls

All three are the `conformance/cases/protect/raw-egress-e004/case.scrml` shape with only
the constructor form varied.

| file | egress form | observed diagnostics |
|---|---|---|
| `bare.scrml` | `new Response(JSON.stringify(u))` | `E-SCOPE-001` **+** `E-PROTECT-004` → FAILED |
| `qualified.scrml` | `new globalThis.Response(JSON.stringify(u))` | **neither** → clean |
| `aliased.scrml` | `const R = globalThis.Response` … `new R(...)` | **neither** → clean |

(Each also emits a `E-SCHEMA-001` because the fixture's `<program>` has no `db=`; that is
constant across all three and irrelevant to the differential.)

Command:

```
bun compiler/bin/scrml.js compile <fixture>.scrml -o out-<fixture>
```

### The emitted server proves the leak end to end

`qualified2.scrml` (same, with `db=` added so the compile is fully green):

```
Compiled 1 file in 112ms
```

`qualified2.server.js` lines 203-214:

```js
  const _scrml_body = await _scrml_req.json();                              // <- D4 lives here too
  const id = _scrml_body["id"];
  const _scrml_result = await (async () => {
    let u = _scrml_protect_tag((await _scrml_sql`SELECT * FROM users WHERE id = ${id}`)[0] ?? null, ["passwordHash"]);
    return new globalThis.Response(JSON.stringify(u));                      // <- tag dropped by JSON.stringify
  })();
  if (_scrml_result instanceof Response) return _scrml_result;              // <- fail-OPEN, BEFORE the redact
  const _scrml_resp_body = JSON.stringify(_scrml_protect_redact(_scrml_result) ?? null);
```

All three causes are visible in eleven lines:

1. the row IS correctly protect-tagged (`_scrml_protect_tag(..., ["passwordHash"])`);
2. `JSON.stringify` ignores the Symbol-keyed descriptor, so the protected column is in the
   body verbatim;
3. the `instanceof Response` early return runs BEFORE `_scrml_protect_redact`, so the sink
   never sees it.

`I-PROTECT-STRIP-001` DID fire on this compile — the compiler knew the query was protected
and still shipped it. That is the sharpest statement of the defect: the information was
present and the gate was the wrong instrument.

### AST ground truth (why a structural check is available)

Dumped the `function-decl` node the E-PROTECT-004 site already holds (`fnNodes`). It is
fully structural — no source-text reconstruction needed:

```json
{ "kind": "let-decl", "name": "u", "sqlNode": {
    "kind": "sql", "query": "SELECT * FROM users WHERE id = ${id}",
    "chainedCalls": [{ "method": "get", "args": "" }] } }
{ "kind": "return-stmt", "exprNode": {
    "kind": "new",
    "callee": { "kind": "member",
                "object": { "kind": "ident", "name": "globalThis" },
                "property": "Response" },
    "args": [ ... ] } }
```

So `?{}` queries, their `.reveal("col")` chain, and the constructor callee are all
first-class nodes. **Rule 7 applies literally: the tree already knows.**

Also confirmed structurally in a second fixture (`shapes.scrml` / `foreign.scrml`):
`const-decl.initExpr` for the alias, `call`+`member{property:"json"}` for
`Response.json(u)`, `typeAnnotation: "asIs"` on the decl, `kind: "foreign"` for `_{}`.

---

## 2. D2a — the E-SCOPE-001 half (allowlist + `globalThis.` resolution)

**Files:** `compiler/src/type-system.ts`,
`compiler/tests/unit/logic-scope-bun-http-globals.test.js` (new),
`compiler/tests/integration/authed-server-fn-response-http.test.js`.

Two changes in one walker, because they are one bug:

1. `Response`, `Request`, `Headers`, `Blob`, `File`, `FormData` added to
   `LOGIC_SCOPE_GLOBAL_ALLOWLIST`.
2. New `checkGlobalThisMemberReads` — a STRUCTURAL walk (invariant 52: descend every
   array/object property, deny-list `span` + `_`-prefixed, identity `seen` set, 512 depth
   cap) that resolves `globalThis.<name>` through the same ladder as the bare form. The
   dotted-string ident spelling (`"globalThis.Response"`, which some upstream paths
   produce) is handled on the bare path. **One ladder, both spellings** — extracted as
   `globalNameResolves` so they cannot drift apart again, which is exactly how the bypass
   opened.

### Direction of change

- **newly-ACCEPTING** for the six names. Governing sentence, SPEC §39.3.2 (`SPEC.md:22628`):
  > "The return type of `handle` is `Response`. Returning a non-`Response` value is a
  > compile error (E-MW-004)."
  and §39.3.5's own worked example (`SPEC.md:22655-22660`):
  > ```scrml
  > ${ function handle(request, resolve) {
  >     if (!isAllowedIP(request)) {
  >         return new Response("Forbidden", { status: 403 })
  >     }
  >     return resolve(request)
  > } }
  > ```
  The language REQUIRED a name the scope check refused. This is toward-the-contract.
- **newly-REJECTING** for `globalThis.<not-a-global>`.

### Measured migration for the newly-rejecting half

```
grep -rl 'globalThis' --include='*.scrml' .   ->  0 files
```

**Zero.** No tracked `*.scrml` mentions `globalThis` at all. That is a statement about
BLAST RADIUS only — per the S346 reverse-ouroboros rule it is NOT evidence that nobody
would write it. The reason to close it is that it is a hole in a resolution check, and it
was load-bearing for a leak.

`window.` / `self.` are deliberately NOT resolved this way, and that is measured, not
assumed:

```
window.location 57 · window.history 2 · window.WebSocket 1 · window.removeEventListener 1
window.dispatchEvent 1 · window.__cmMod 1 · window.addEventListener 1
```

`addEventListener` / `dispatchEvent` / `__cmMod` are not (and should not be) logic-scope
globals, so extending the rule to `window` WOULD be newly-rejecting on real source. It
needs a DOM property model, which is out of scope here. Pinned with a test so a later
"make it symmetric" edit has to argue with an assertion. **OPEN.**

### Bite proof

```
$ bun test compiler/tests/unit/logic-scope-bun-http-globals.test.js     # WITH the fix
 18 pass  0 fail

$ git checkout compiler/src/type-system.ts                             # fix REMOVED
$ bun test compiler/tests/unit/logic-scope-bun-http-globals.test.js
 9 pass  9 fail
   (fail) a TYPO behind `globalThis.` is refused (was: silently accepted)
     expect(received).toBeGreaterThan(expected)   Expected: > 0   Received: 0
   (fail) bare `Response` resolves in logic scope
   ... 7 more

$ <restore>                                                            # fix BACK
 18 pass  0 fail
```

A bug the bite proof caught that review did not: `globalNameResolves` first used
`scopeChain.lookup(name) !== undefined`, but `lookup` returns **`null`** on a miss
(`type-system.ts:3383`). The whole check was inert and the compile still looked clean. An
assertion you cannot make fail is a hypothesis — this one was a hypothesis for ten minutes.

### One pre-existing test intentionally rewritten

`compiler/tests/integration/authed-server-fn-response-http.test.js` carried an S325 test:

```js
test("the shape still build-blocks on E-SCOPE-001 (pins the upstream gate)", () => {
  // If this ever stops firing, the shape becomes adopter-reachable and the
  // passthrough guard below stops being belt-and-braces and becomes load-bearing.
  expect(errors.map((e) => e.code)).toContain("E-SCOPE-001");
});
```

That is a prophecy, and D2a fulfils it. Rewritten to assert the new fact (no E-SCOPE-001
on `Response`) with the reasoning in the block comment. **And the S325 note was already
wrong when it was written:** `new globalThis.Response(...)` was ALWAYS clean, so the
"upstream gate" it leaned on was one keystroke wide the whole time. That is recorded in
the file so the next reader is not reassured by it.

### Regression run after D2a

```
bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance
 22373 pass · 70 skip · 1 todo · 1 fail
```
The single fail is the S325 prophecy test above; after the rewrite that file is
`17 pass 0 fail`.

---

## 3. D2b — the fail-closed gate goes structural (E-PROTECT-004)

**Files:** `compiler/src/codegen/protect-egress.ts`,
`compiler/src/codegen/emit-server.ts`,
`compiler/tests/integration/g-sql-row-protect-leak.test.js`.

`detectProtectedRawEgress` no longer takes the fn's SOURCE SLICE. It takes the
`function-decl` NODE and walks it structurally (invariant 52: every array/object-valued
property descended, deny-list `span` + `_`-prefixed, identity `seen`, 512 depth cap).

What the regex could not see and the tree always could:

| spelling | old regex | new |
|---|---|---|
| `new Response(...)` | fires | fires |
| `new globalThis.Response(...)` | **silent** | fires |
| `const R = globalThis.Response` … `new R(...)` | **silent** | fires |
| `const R = globalThis.Response; const S = R; new S(...)` | **silent** | fires |
| `new window.Response(...)` / `new self.Response(...)` | **silent** | fires |
| `globalThis.Response.json(u)` | fires (by accident — the substring matched) | fires |
| `u.reveal("name")` while `passwordHash` leaks | **suppressed wholesale** | fires |
| `u.reveal(colName)` — dynamic | **suppressed wholesale** | fires (fail-closed) |
| `const Response = makeBox; new Response(u)` (a LOCAL shadow) | fires (**false positive**) | silent |

Declassification is now PER-COLUMN. §14.8.9's own conformance rationale says `reveal`
"stamps **the column's** provenance descriptor as declassified" — the old rule made the
sole declassification primitive double as an unconditional per-body off-switch. An
unresolvable-origin query (`{all:true}`, the CTE/UNION/dynamic strip-all path) can never
be covered by a named reveal, so it always fires at a raw egress.

### Direction of change

**newly-REJECTING** (six new fire shapes) and **newly-ACCEPTING** in exactly one place: a
LOCAL binding that shadows `Response` is no longer mistaken for the global.

### Measured migration

Compiled all **75** tracked `*.scrml` files containing `protect=` (the complete
protect-active corpus: `samples/`, `examples/23-trucking-dispatch/**`, `docs/website/`,
`stdlib/`, `conformance/cases/**`, `compiler/self-host/`) under BOTH detectors, via
`compileScrml`, and compared E-PROTECT-004 hits:

```
BASE (regex)      FILES=75  E-PROTECT-004 HITS=1  CRASHED=0
HEAD (structural) FILES=75  E-PROTECT-004 HITS=1  CRASHED=0
    both: conformance/cases/protect/raw-egress-e004/case.scrml
```

**Delta zero.** No file newly fails, none newly passes. Per the S346 reverse-ouroboros
rule that is BLAST RADIUS, not demand evidence — it says the corpus never exercised any
evasion, not that no adopter would.

Full tiers after D2b: `22386 pass · 0 fail` (unit+integration+conformance).
`bun conformance/run.ts` → `883/883`.

### Bite proof

```
$ bun test compiler/tests/integration/g-sql-row-protect-leak.test.js    # WITH the fix
 50 pass  0 fail

$ git checkout compiler/src/codegen/{protect-egress,emit-server}.ts     # fix REMOVED
$ bun test compiler/tests/integration/g-sql-row-protect-leak.test.js
 43 pass  7 fail
   (fail) THE LEAK: `new globalThis.Response(...)` (the one-keystroke bypass)
   (fail) an ALIASED constructor — `const R = globalThis.Response` … `new R(...)`
   (fail) a TRANSITIVE alias — `const R = globalThis.Response` then `const S = R`
   (fail) `window.Response` / `self.Response` are the same global by another name
   (fail) revealing the WRONG column no longer suppresses the gate
   (fail) a DYNAMIC `reveal(<expr>)` declassifies nothing — fail-closed
   (fail) a LOCAL binding that shadows `Response` is not the raw egress

$ <restore>                                                             # fix BACK
 50 pass  0 fail
```

### End-to-end repro, before and after

```
$ bun compiler/bin/scrml.js compile qualified2.scrml -o out
BEFORE:  Compiled 1 file in 112ms                          <- HTTP 200 ships passwordHash
AFTER:   error [E-PROTECT-004]: server function `getUser` selects a protected
         (`protect=`) column in `SELECT * FROM users WHERE id = ${id}` and reaches
         a manual `Response` / `handle()` body (§40) …
         FAILED — 1 error, 5 warnings
```

### What stays OPEN after D2b

**This gate is WITHIN-FUNCTION.** A row fetched in fn A, returned to fn B, and serialized
into a `Response` there is not caught: neither body co-occurs with the other's half. A
call-graph transitive closure would track NAMES; the leak is a VALUE flow. That case is
closed by D2c instead, at the serializer, where the descriptor actually travels.

---

## 4. D2c — deny-unless-revealed AT THE SERIALIZER

**Files:** `compiler/src/codegen/protect-egress.ts` (`SERVER_PROTECT_HELPER` + module
doc), `compiler/src/codegen/emit-server.ts` (the falsified-premise comment),
`compiler/tests/integration/g-sql-row-protect-leak.test.js`.

### The falsified premise, quoted where it lived

`emit-server.ts` justified putting the `Response` passthrough BEFORE the redact with:

> "Placed BEFORE the redact deliberately: a `Response` is an opaque stream handle, not
> a row set — `_scrml_protect_redact` cannot inspect or strip it, so routing one through
> the redact would buy nothing…"

dpa-029 falsified that by execution. `new globalThis.Response(JSON.stringify(row))` **is a
row set, stringified.** The retraction is now written at the site, so the next reader is
not reassured by it.

### What I did NOT do, and why

The brief's direction was "make the wrapper deny-unless-revealed". Blanket-denying every
`Response` return in a protect-active app would refuse **SPEC §39.3.5's own worked
example** (`return new Response("Forbidden", { status: 403 })`) — a body with no row in it
at all. That is a false positive rate of ~100% on legitimate `handle()` bodies, and the
`Response` carries no descriptor by then so the wrapper cannot tell the two apart.

**The boundary is the SERIALIZER, not the `Response`.** So a tagged row now carries a
non-enumerable `toJSON` returning the REDACTED projection: `JSON.stringify(row)` inside a
hand-built `Response` strips at the exact point of the leak. Same policy the brief asked
for — deny unless revealed — applied one layer down, where it is precise:

- zero false positives (a 403 with no row is untouched);
- no allow-list of egress shapes to keep current;
- it covers the CROSS-FUNCTION case the compile gate documents as out of reach, because
  the descriptor travels with the VALUE and a call-graph closure only tracks NAMES.

The `instanceof Response` guard STAYS. It is right about the 403: enveloping a `Response`
would `JSON.stringify` it to `"{}"` and turn a DENY into a 200 SUCCESS. It is just no
longer the last line of defence.

### Executed, not grepped

The SHIPPED `SERVER_PROTECT_HELPER` string, eval'd:

```
1. author JSON.stringify(row)          = {"id":1,"name":"ada"}          <- THE FIX
2. Object.keys(row)                    = ["id","name","passwordHash"]   <- surface unchanged
3. direct read row.passwordHash        = SECRET                         <- server-side use OK
4. compiler sink redact-then-stringify = {"id":1,"name":"ada"}          <- unchanged
5. after reveal, JSON.stringify        = {"id":1,"name":"ada","passwordHash":"SECRET"}
6. descriptor survives spread          = true                           <- prior invariant held
7. array of rows                       = [{"id":1},{"id":2}]
8. nested in a wrapper object          = {"user":{"id":1,"name":"ada"},"ok":true}
9. strip-all sentinel                  = {}
```

Line 3 is the design point: the floor is about EGRESS. `Bun.password.verify(pw,
row.passwordHash)` — the reason you SELECT a protected column server-side — is a member
read and is unaffected. Only whole-row serialization redacts.

### End-to-end: the cross-function shape the compile gate cannot see

`crossfn.scrml` — `fetchUser` runs the query, `serveUser` builds the `Response`:

```
$ bun compiler/bin/scrml.js compile crossfn.scrml -o out
Compiled 1 file in 107.7ms          <- NO E-PROTECT-004; the gate is within-function
```

emitted `crossfn.server.js`:

```js
async function fetchUser(id) {
  return _scrml_protect_tag((await _scrml_sql`SELECT * FROM users WHERE id = ${id}`)[0] ?? null, ["passwordHash"]);
}
...
    let u = await fetchUser(id);
    return new Response(JSON.stringify(u), { status: 200 });   // <- toJSON redacts HERE
```

### A PRE-EXISTING TEST WAS PINNING THE LEAK

`g-sql-row-protect-leak.test.js` — the file whose own header says *"never ships the
protected column"* — carried:

```js
test("descriptor is JSON-invisible (never serialized as data)", () => {
  const row = _scrml_protect_tag({ id: 1, passwordHash: "x" }, ["passwordHash"]);
  expect(JSON.parse(JSON.stringify(row))).toEqual({ id: 1, passwordHash: "x" });
});
```

Its INTENT (the Symbol descriptor must never appear as a data key) is real and is kept.
The assertion it wrote asserted that an author's own `JSON.stringify(taggedRow)` emits the
protected column verbatim — the D2 defect, green in the suite. Rewritten to check the
intent (no key contains `scrml.protect`, no key is `toJSON`, on BOTH the direct and the
redact paths) plus the corrected outcome.

### Direction of change

**semantics-changed**, server-side only, fail-CLOSED: `JSON.stringify` of a
protect-TAGGED row now yields the redacted projection. Untagged objects are byte-identical
(pinned by a negative-control test), so a non-protect app is unaffected — the helper is
only injected when `_scrml_protect_tag` / `_redact` / `_reveal` is referenced at all.

### Bite proof

```
$ bun test compiler/tests/integration/g-sql-row-protect-leak.test.js   # WITH the fix
 61 pass  0 fail

$ git checkout compiler/src/codegen/protect-egress.ts                  # fix REMOVED
 54 pass  7 fail
   (fail) THE LEAK, closed: an author's own JSON.stringify(row) drops the column
   (fail) an ARRAY of tagged rows redacts every row
   (fail) a tagged row NESTED in a plain wrapper still redacts
   (fail) the `*` strip-all sentinel serializes to `{}`, not the row
   (fail) reveal ROUND-TRIPS: a declassified column ships through the author's stringify
   (fail) CROSS-FUNCTION: the tag travels with the VALUE, so the serializer still strips
   (fail) descriptor is JSON-invisible (never serialized as a data key)

$ <restore>                                                            # fix BACK
 61 pass  0 fail
```

### What stays OPEN after D2c

`{...row}` spread drops the non-enumerable `toJSON` (it keeps the enumerable Symbol
descriptor, so the compiler sink still redacts it — only an AUTHOR's own
`JSON.stringify({...row})` in a hand-built `Response` would leak). Making `toJSON`
enumerable would close it but would put `"toJSON"` into `Object.keys(row)` — an observable
surface change with unmeasured blast radius. Within a single function that shape is
build-blocked by D2b; across functions it is the residual. **Surfaced, not closed.**

Full tiers after D2c: `22397 pass · 0 fail`. `bun conformance/run.ts` → `883/883`.

---

## 5. D3 — the JS-host async boundary in `handle()`

**Files:** `compiler/src/codegen/emit-expr.ts`, `compiler/src/codegen/emit-server.ts`,
`compiler/tests/integration/handle-host-async-boundary.test.js` (new).

### Premise verification — and the brief UNDERSTATED this one

The brief scoped D3 to `request.formData()`. Compiling first (rather than reading the
source) surfaced a second, more central instance of the same defect: **SPEC §39.3.1's
PRIMARY `handle()` worked example is dead on arrival.**

```scrml
${ function handle(request, resolve) {
    const start = Date.now()
    const response = resolve(request)                 // <- resolve is emitted `async`
    response.headers.set("X-Response-Time", `${Date.now() - start}ms`)
    return response
} }
```

Both proven by EXECUTING the emitted `_scrml_mw_wrap` verbatim out of the artifact:

```
$ bun exec.ts out3931/spec3931.server.js
      const response = resolve(request);
      response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
--- executing ---
THREW: TypeError: undefined is not an object (evaluating 'response.headers.set')

$ bun exec.ts out/upload.server.js
        const fd = request.formData();
        const name = fd.get("name");
--- executing ---
THREW: TypeError: fd.get is not a function. (In 'fd.get("name")', 'fd.get' is undefined)
```

### The fix

A FILE-SCOPED host-async binding map (`setHostAsyncBindings`), set + restored by
emit-server around the `handle()` body emission only:

```
resolve -> {}                              (empty set == the binding IS an async callable)
request -> HOST_BODY_CONSUMING_METHODS     (json text formData arrayBuffer blob bytes)
```

**File-scoped, not ctx-threaded, and that choice is load-bearing.** The Issue #26
classifier ten lines above states the argument and it applies verbatim: control-flow
emitters (`if`/`while`/`for`/`match`), the SQL interpolation path and nested lambdas all
reconstruct a FRESH `EmitExprContext` and drop threaded fields — there are 29 threading
sites for the sibling `serverFnPeerDispatchObjs` option. The `request.formData()` shape in
the brief is nested inside an `if`, i.e. exactly one of those reconstructing boundaries. A
threaded fix would have looked right and silently missed it. The nesting is preserved in
the test on purpose.

`HOST_BODY_CONSUMING_METHODS` is the WHATWG `Body` mixin, listed rather than inferred, so
the lowering never awaits a SYNC method — `request.clone()` stays bare (negative control).

### After

```
      const response = await resolve(request);            -> 200, X-Response-Time set
        const fd = await request.formData();              -> 200, body "ada"
        new Response((await request.formData()).get("name"))   <- receiver parens
```

### Direction of change

**semantics-changed** (a Promise is now resolved where it previously leaked), inside
`handle()` bodies only. It cannot be newly-rejecting (no new diagnostic) and it cannot be
newly-accepting (no new source shape admitted).

### Measured migration

7 tracked `*.scrml` declare `function handle(request, resolve)`:

```
samples/gauntlet-r14/go-api-service.scrml       samples/gauntlet-r13/go-api-service.scrml
samples/gauntlet-r14/react-auth-dashboard.scrml samples/gauntlet-r13/react-auth-dashboard.scrml
conformance/cases/middleware/duplicate-handle-pos/case.scrml
conformance/cases/middleware/duplicate-handle-neg/case.scrml
examples/20-middleware.scrml
```

`examples/20-middleware.scrml` — the SHIPPED middleware example — carries the §39.3.1
shape and was broken. Base vs head on the same file:

```
BASE: 52:      const response = resolve(request);
HEAD: 52:      const response = await resolve(request);
```

So the migration is not "zero corpus files affected" — it is "the flagship example was
DOA and is now correct". Nothing needs an author edit; the change is entirely in emission.

### Bite proof

```
$ bun test compiler/tests/integration/handle-host-async-boundary.test.js  # WITH the fix
 11 pass  0 fail

$ git checkout compiler/src/codegen/{emit-expr,emit-server}.ts            # fix REMOVED
 4 pass  7 fail
   (fail) EXECUTED: it returns 200 (before: TypeError on response.headers.set)
   (fail) the emitted dispatch is awaited
   (fail) EXECUTED: request.formData() (before: TypeError: fd.get is not a function)
   (fail) EXECUTED: request.text()
   (fail) EXECUTED: request.json()
   (fail) RECEIVER POSITION: `request.formData().get(k)` gets the precedence parens
   (fail) the binding map is scoped to the handle() body — a SIBLING fn is unaffected

$ <restore>                                                               # fix BACK
 11 pass  0 fail
```

### WHERE I WAS WRONG — recorded because the test caught it, not review

I assumed §39.3.2 left the parameter SPELLINGS free and wrote a test for
`function handle(req, next)`. **It does not.** §12.2 Trigger 8 pins recognition to *"the
reserved name `handle` joined with the §39.3.2 signature shape (exactly two parameters
named `request` and `resolve`; not a generator)"* — `isHandleEscapeHatch`,
`ast-builder.js:12673`. `handle(req, next)` is not the escape hatch at all: it is a dead
ordinary function, `W-DEAD-FUNCTION`, and NO `.server.js` is emitted. The comment I had
written claiming otherwise is removed and the fact is pinned by a test.

Related, pre-existing, NOT changed: `requestParamName` reads
`typeof handleParams[0] === 'string' ? handleParams[0] : 'request'`, but params are
`{name}` OBJECTS — so that ternary always takes the default. It is harmless (Trigger 8
pins the name to `request` anyway) but it is a dead branch. Surfaced, not touched.

### What stays OPEN after D3

- **The boundary is `handle()`-scoped.** An `<endpoint>` arm or a server fn that receives
  a `Request` by another route does not get this lowering, because nothing types those
  parameters as `Request`. Closing it generally needs the type system to carry host types
  to codegen, not a wider name list.
- **A non-awaitable position emits BARE with no diagnostic.** The peer-call path records
  such sites and raises `E-SERVER-FN-IN-SYNC-CALLBACK`; the host boundary has no
  fail-closed sink of its own. `request.json()` inside a sync `.map` callback still leaks
  a Promise, silently. Surfaced, deliberately not widened in this round.
