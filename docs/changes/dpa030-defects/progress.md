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
