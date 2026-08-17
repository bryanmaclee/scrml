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
