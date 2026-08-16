# dtr-r7 — progress (append-only)

Startup pwd: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7593f7fd5a570a19`
Base: `git merge-base HEAD origin/dtr-r6` == `ff0cbdd81150a4c3726e5c266708b65e593892c9` == `origin/dtr-r6`. ASSERTED.

---

## B-1 — BASELINE REPRODUCTION (pre-fix, at `ff0cbdd8`)

Probe: `.tmp/b1-probe.mjs` (compiles each shape to disk, reports whether a `.server.js`
was emitted for the function under test — i.e. whether §12.2 Trigger 3 escalated it).

```
$ bun .tmp/b1-probe.mjs
string-literal-default       errors=[] serverJs=1 escalated=true clientHasFetchStub=true
template-literal-default     errors=[] serverJs=1 escalated=true clientHasFetchStub=true
object-key-default           errors=[] serverJs=1 escalated=true clientHasFetchStub=true
member-property-default      errors=[] serverJs=1 escalated=true clientHasFetchStub=true
comment-in-default           errors=[] serverJs=1 escalated=true clientHasFetchStub=true
nested-decl-string-default   errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-bare-ref             errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-call                 errors=[] serverJs=1 escalated=true clientHasFetchStub=true
```

**All SIX over-fire shapes fire.** PA's diagnosis HELD, and is REFINED in one place:
the nested-`function-decl` shape (`nested-decl-string-default`) fires through a
SECOND site — the walk's own `function-decl` branch at `route-inference.ts:3735-3741`,
which also text-scans. The PA's two-call fix touches only the TOP-LEVEL roots in
`collectServerOnlyBindingModules` and would have left the nested shape over-firing.

### The consequence, measured on the artifact (not inferred)

`.tmp/b1-artifact.mjs` on `function greet(msg = "please join us")` beside
`import { join } from 'scrml:path'`, at exit 0 with ZERO diagnostics, emits
`case.server.js` containing:

```js
  const _scrml_result = await (async () => {
    const _scrml_body = await _scrml_req.json();
    const msg = _scrml_body["msg"];
    return msg;
  })();
  return new Response(JSON.stringify(_scrml_result ?? null), { ... });
```

The parameter default `"please join us"` is **DROPPED**. `greet()` with no argument
now returns `null` over the wire instead of the string. Exit 0, no diagnostic.

### The normative text it violates

`compiler/SPEC.md` §12.4 (`:7463-7470`), unamended:

> Route inference SHALL be per-function. … it SHALL NOT classify a function based on
> the names of identifiers that appear inside string-literal contents of its body …
> matching a server-fn name as a token inside a string literal is NOT a reference and
> SHALL NOT propagate taint.
