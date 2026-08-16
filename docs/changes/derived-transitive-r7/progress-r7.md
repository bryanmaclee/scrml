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

---

## B-1 — POST-FIX MEASUREMENT (`f7ae4c33`)

```
$ bun .tmp/b1-probe.mjs
string-literal-default       errors=[] serverJs=0 escalated=false clientHasFetchStub=false
template-literal-default     errors=[] serverJs=0 escalated=false clientHasFetchStub=false
object-key-default           errors=[] serverJs=0 escalated=false clientHasFetchStub=false
member-property-default      errors=[] serverJs=0 escalated=false clientHasFetchStub=false
comment-in-default           errors=[E-CODEGEN-INVALID-LOGIC] serverJs=0 escalated=false clientHasFetchStub=false
nested-decl-string-default   errors=[] serverJs=0 escalated=false clientHasFetchStub=false
CONTROL-bare-ref             errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-call                 errors=[] serverJs=1 escalated=true clientHasFetchStub=true
```

6/6 over-fires stop. **Both genuine catches survive.**

The default is preserved in the emitted client:
`function _scrml_greet_3(msg = "please join us") {`

`comment-in-default`'s `E-CODEGEN-INVALID-LOGIC` is **PRE-EXISTING and unrelated** —
measured with NO import at all and with a purely client-safe import
(`.tmp/b1-comment.mjs`):

```
comment-default-NO-import          errors=[E-CODEGEN-INVALID-LOGIC]
comment-default-clientsafe-import  errors=[E-CODEGEN-INVALID-LOGIC]
plain-default-NO-import            errors=[]
```

Round 6's over-fire was MASKING it by relocating the function to the server.
Surfaced as a deferred item; pinned in conf §8b so it cannot be widened quietly.

### Full contract gate, post-fix

```
$ bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance
 22435 pass
 70 skip
 1 todo
 0 fail
 86353 expect() calls
Ran 22506 tests across 1226 files. [354.59s]
[exited with code 0]
```

Matches the reviewer's independently-measured 22,435 / 0 exactly.

---

## THE COVERAGE HALF — assertions added, and their BITE PROOFS

### The unpinned-in-both-directions claim is CONFIRMED

Arc suites measured on the pre-fix tree and the post-fix tree:

```
$ git stash push -- compiler/src/route-inference.ts
$ bun test compiler/tests/unit/route-inference-derived-server-only-reach.test.js \
           compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js
 149 pass / 0 fail        # PRE-fix (over-firing tree)
$ git stash pop
$ bun test <same two files>
 149 pass / 0 fail        # POST-fix
```

**Identical.** Nothing caught the over-fire being introduced and nothing would have
caught it being removed. (The brief's cited `138` does not reproduce at either tree;
the number is 149 on both.)

### Assertions added (all in `compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js`)

- **§8b** — 5 non-reference default shapes + a default-PRESERVED artifact assertion +
  the comment shape. Direction: goes red if the over-fire RETURNS.
- **§8c** — the nested-`function-decl` guard (F1), 2 shapes + a client-safe control.
  Direction: goes red if that genuine catch is LOST.
- **§9** — GAP PIN for the destructured-parameter-default LEAK (measured, pre-existing,
  not fixed here) + its nested twin as the discriminator.
- **§7** — reordered so `assertRefusedOrStubFree` runs FIRST (F2), plus a NEW hop-chain
  assertion the section's own test name had promised for three rounds.

### BITE PROOF 1 — the over-fire returns (§8b must go red)

Mutation: in `scanParamDefaultRaw`, `if (rawMode === "text-scan") { scanRaw(raw); return; }`
placed first — i.e. round 6's behaviour restored.

```
(fail) …§8b… > string-literal: compiles clean and stays CLIENT-side (§12.4 SHALL NOT)
(fail) …§8b… > template-literal: …
(fail) …§8b… > object-property-key: …
(fail) …§8b… > member-property: …
(fail) …§8b… > nested-decl-string-literal: …
(fail) …§8b… > the parameter default is PRESERVED in the emitted client function
(fail) …§8b… > comment-in-default: not escalated …
 35 pass
 7 fail
```

RESTORED →
```
 42 pass
 0 fail
```

### BITE PROOF 2 — the top-level genuine catch is lost (§8 must go red)

Mutation: `const trigger3ScanRoot: unknown[] = [body];` (drop the param defaults).

```
(fail) …§8… > t3-default-call: clean compile, the call is server-hosted, nothing server-only is client-loaded
(fail) …§8… > t3-default-bare-ref: …
 40 pass
 2 fail
```

RESTORED → `42 pass / 0 fail`.

### BITE PROOF 3 — F1: the nested-`function-decl` branch is disabled (§8c must go red)

Mutation: `if (false && kind === "function-decl") {` in `scanForServerOnlyBindingRefs`.

```
(fail) …§8c… > nested-default-call: escalated, and NOTHING server-only reaches the browser
        expect(c.serverJsFiles.length).toBeGreaterThan(0);
        error: expect(received).toBeGreaterThan(expected)
        Expected: > 0
        Received: 0
(fail) …§8c… > nested-default-bare-ref: …
 40 pass
 2 fail
```

And the LEAK the branch prevents, measured under the same mutation
(`.tmp/b1-assert-shapes.mjs`):

```
=== genuine-nested-decl-call ===
  errorCodes=[] serverJs=0
  client has Bun.password=true argon2id=true _scrml_stdlib.auth=true
=== genuine-nested-decl-bare-ref ===
  errorCodes=[] serverJs=0
  client has Bun.password=true argon2id=true _scrml_stdlib.auth=true
```

RESTORED → `42 pass / 0 fail`, and the leak greps go back to `false`.

### BITE PROOF 4 — F2: the reorder makes the helper's body reachable

Mutation: `const scanRoot: unknown[] = [body];` in `computeServerReachingFns`
(drop the hop caller's own defaults).

Under the OLD ordering the first failing line would have been
`expect(c.errorCodes).toContain(CODE)` and the helper would never have executed.
Under the NEW ordering the failure comes from INSIDE the helper — the artifact fact:

```
403 | function assertRefusedOrStubFree(c) {
404 |   if (c.errorCodes.includes(CODE)) return "refused";
405 |   expect(c.clientLoadedText).not.toContain("_scrml_fetch_");
                                       ^
error: expect(received).not.toContain(expected)
Expected to not contain: "_scrml_fetch_"

(fail) …§7… > default-bare-ref: refused with the code, and the chain names the hop
(fail) …§7… > default-callback-ref: …
(fail) …§7… > default-call-review-shape: …
 39 pass
 3 fail
```

(`default-nested-decl` correctly stays green — the nested-decl branch catches it
independently. That is the discrimination the section was missing.)

### BITE PROOF 5 — the NEW hop-chain assertion (F2's "assert the artifact fact")

Mutation: nested-decl branch disabled (`if (false && …)`), §7 `default-nested-decl`:

```
711 |         expect(c.codeMessages).toContain("const <computed> -> wrap -> doHash");
                                     ^
error: expect(received).toContain(expected)
Expected to contain: "const <computed> -> wrap -> doHash"
Received: "… const <computed> -> wrap -> inner -> doHash …"
(fail) …§7… > default-nested-decl: refused with the code, and the chain names the hop
 0 pass / 1 fail
```

This is the reviewer's exact observation reproduced: the shape still refuses, only the
chain string moves, and **the mutated chain reads as an improvement** — which is why a
pin that only watched the code could not tell a broken branch from a working one.

RESTORED → arc suites `162 pass / 0 fail` across both files.
