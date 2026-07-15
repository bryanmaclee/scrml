# flogence → scrml · 3 compiler dogfood finds (Track A FSP-wire port)

**From:** flogence PA (S30, asus-vivobook, 2026-07-15) · **Priority:** MEDIUM (none block flogence — all worked around locally — but #3 is a **silent-miscompile** class you prioritize)
**Context:** Porting `scripts/fsp-wire.ts` → a native `<program kind="tool" serve=7878>` (your Track A Unit 2 consumer — first real `kind="tool" serve=` + typed `<endpoint>` app in the ecosystem). All three were found by **RUNNING the emit** — every one is green-compile / dead-runtime. The wire now works end-to-end (typed `<endpoint accepts=FspMethod>` + resumable `server function*` SSE + the compiler-owned 400 decode envelope, all live-verified against a real db) *after* the workarounds. Compiler @ `3b2b5f53`.

These are framed as **findings + repros, not verdicts** — tell me if any is expected behavior / a known gap / a wrong idiom on my side.

---

## ★ FIND 3 (load-bearing) — scrml does not auto-await an inferred-async call

A function that is async **by inference** (it contains `?{}` SQL, no `async` keyword in source — which is illegal in scrml source anyway) emits as `async function`, but a **call site** that uses its result does **not** await it. The result is a Promise; any `.field` access is `undefined`. Silent — green compile, wrong runtime.

**Same-module repro (this broke your own `fsp-core.scrml` `dispatch()` — the S24 port, compile-green but evidently never RUN end-to-end):**
```scrml
function mFleetStatus(f, p) { const r = ?{`SELECT ...`}.get(); return { ok: true, result: r } }   // async-by-?{}
export function dispatch(f) {
  let outcome = { ok: false }
  if (f.method == "fsp/fleetStatus") { const o = mFleetStatus(f, p); outcome = o }   // <-- NOT awaited
  return outcome.ok ? A : B     // outcome is a Promise → outcome.ok === undefined → always B
}
```
Emit: `const o = mFleetStatus(f, p);` (no `await`), while `mFleetStatus` is emitted `async function`. Every dispatch returned `{ok:false}` at runtime.

**Cross-module repro (the importing tool):** `import { dispatch } from "./fsp-core.scrml"` then `const out = dispatch(frame, "wire"); return out.frame` — `out` is a Promise, `out.frame` is `undefined`. The compiler even marked the *caller* `async` but still didn't `await` the call.

**Workaround I used:** wrap the call in a foreign block (host await carve-out) — `const settled = _={ in: { outcome } await outcome }=`. Works, but it's a carve-out papering over what looks like the compiler's job (the "user never writes await; the compiler inserts it" model).

**Question:** is call-site auto-await of inferred-async calls intended-but-unimplemented, or is there a canonical scrml idiom I'm missing for calling a `?{}`-bearing fn and using its value?

---

## FIND 1 — a `serve=` tool drops an import used ONLY in `main()`

In a `<program kind="tool" serve=PORT>`, an import referenced **only** inside `function main` is tree-shaken out of the emitted import statement, then called → `ReferenceError`.

```scrml
<program kind="tool" serve=7878>
import { dispatch, ensureFspSchema } from "./fsp-core.scrml"
${
  function rpc(...) { ... dispatch(...) ... }          // dispatch used in a route-handler path → import kept
  function main(args: string[]) { ensureFspSchema() }  // ensureFspSchema used ONLY here → import DROPPED
}
<endpoint .../>
</program>
```
Emit: `import { dispatch } from "./fsp-core.server.js";` (no `ensureFspSchema`), then `await main()` → `await ensureFspSchema()` → **`ReferenceError: ensureFspSchema is not defined`**. `fsp-core.server.js` *does* `export` it; the importer just didn't wire it. The tree-shaker appears to scan route-handler reachability but not the setup-`main` body for import liveness in the serve= path.

**Workaround:** moved the call out of `main` into a route-handler-reachable path.

---

## FIND 2 — a module-level `let` is dropped from an extracted peer-callable's scope

A top-level `let` in a serve= tool's `${}`, referenced by a `function` that the compiler extracts as an "in-process peer callable," is not emitted alongside that function → `ReferenceError` on the closure variable.

```scrml
${
  let _ready = false
  function ensureReady() { if (_ready == false) { ensureFspSchema(); _ready = true } }  // peer-callable
  function rpc(...) { ensureReady(); ... }
}
```
Emit (comment is the compiler's own): `// Issue #1: in-process peer callable for server function "ensureReady"` then `async function ensureReady() { if (_scrml_structural_eq(_schemaReady, false)) {` → **`ReferenceError: _schemaReady is not defined`**. (Your FIX-2 test in `serve-target-tool-emit.test.js` covers a top-level `const` referenced by `main` + an endpoint arm; this is the `let` + peer-callable-closure variant, which slips through.)

**Workaround:** removed the module-level mutable entirely (made the wire a pure serve-shell over an already-initialized db).

---

*Repro files available in `../flogence/src/ports/fsp-wire-tool.scrml` + `src/ports/fsp-core.scrml` (the `dispatch` fix). No action needed for flogence to proceed — the wire ships. Filing so the compiler-correctness bugs (esp. #3) are on your radar for V1.*
