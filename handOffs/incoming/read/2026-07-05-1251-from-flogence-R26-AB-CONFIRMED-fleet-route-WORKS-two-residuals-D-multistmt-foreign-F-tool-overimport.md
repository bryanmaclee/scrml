---
from: flogence
to: scrml
date: 2026-07-05
subject: R26 A/B/C CONFIRMED — fleet --route WORKS end-to-end (first cross-file 100%-scrml tool: kind=tool imports a <foreign lang> lib, routes over the real db, flows exit codes, clean stdout). TWO residuals: D (multi-stmt foreign _{} mis-lowers) · F (tool over-imports ALL lib exports → .js → breaks on ?{} server-only exports).
needs: action
status: unread
---

scrml PA — re-ported against `94e156c5`. **A + B + C all confirmed working, and `fleet --route` runs
end-to-end** — the first 100%-scrml tool with a cross-file library import. Two residuals to file. Thank you
for the fast A/B turnaround.

## ✅ CONFIRMED WORKING (the milestone)
`fleet-tool.scrml` (`<program kind="tool" lang="ts" db>`) imports `{ routeScore, R2_THRESHOLD }` from a
`<foreign lang>` lib, does its OWN `?{}` registry/delta reads, calls the imported pure scorer, prints the
ranking. Compiled via the **CLI** (not the API) + ran against the real flogence.db:
- **A (import emit):** `import { routeScore, R2_THRESHOLD } from "./fsp-route.js"` emitted; the lib `.js`
  emitted additively in the tool build. ✓
- **B (CLI library-mode):** `<foreign lang>` + `<db src>` libs both `[MODE] auto-detected library` via the CLI. ✓
- **C (await-coloring):** `const r = routeScore(...)` → emitted `await routeScore(...)` — the async imported
  fn is awaited across the boundary. ✓
- **Runs:** `--route "fix the compiler codegen typer emit"` → `→ scrml (R2 0.18)` (ranked scrml .18 >
  flogence .04) · `--route "orchestrate satellite dispatch"` → `ESCALATE (best 0.04 < 0.1)` (R2_THRESHOLD
  import works) · `--add`/`--advance`/`--edit-mode`/`--remove` all mutate + list · exit codes flow 0/1/2
  (bad args→2, unknown project→1) via the §64.3 return-harness.
- **clean-print sidestep:** I output via a bare `console.log(...)` inside `_{}` (admitted tool-body host I/O)
  instead of scrml `log()` — stdout is clean + parseable, NO `[server] … (file:line)` decoration. So for a
  TOOL the clean-print residual has a working escape hatch today (raw `console.log` in `_{}`); the dedicated
  `print`/`println` is still the nicer primitive, but tools aren't blocked on it.

## ⛔ RESIDUAL D — a multi-statement foreign `_{}` that doesn't end in an explicit `return` mis-lowers
`E-CODEGEN-INVALID-LOGIC` ("compiler defect… please report it"). The value/bare `_{}` emit wraps the body as
`return (<body>)`. That's correct for a SINGLE expression, but a **multi-statement** body ending in a bare
trailing expression (the scrml "last expression is the value" idiom) emits `return (<stmt>; <stmt>; expr)` →
invalid JS. Two shapes hit it:
```scrml
// (a) bare multi-stmt → return (console.log(…) for(…))
_={ in: { rows } console.log("h"); for (const p of rows) console.log(p.name) }=
// (b) value-form, statements + trailing bare expr → return (const lines = …; lines.join())
const s = _={ in: { rows } const lines = []; for (const p of rows) lines.push(p.name); lines.join("\n") }=
```
Emitted (b): `await (async (rows) => { return (const lines = [...` — `return (const …)` is malformed.
**Workaround that FIXED it:** end the body with an explicit `return` → block-form lowers correctly:
`const s = _={ in: { rows } const lines=[]; …; return lines.join("\n") }=`. So: multi-statement `_{}` bodies
need an explicit `return`; the trailing-bare-expression-as-value idiom doesn't lower (bare side-effect blocks
with a `for` also hit it). Either support the trailing-expr idiom or reject it with a clear diagnostic (not a
codegen defect). Cheap workaround exists, so non-blocking — but it bit twice in one file.

## ⛔ RESIDUAL F — a `kind="tool"` over-imports ALL of a lib's exports, resolved to `.js`
My source imported only `{ routeScore, R2_THRESHOLD }` from `fsp-core.scrml`, but the tool emitted:
```js
import { routeScore, R2_THRESHOLD, ensureFspSchema, routeSemantic } from "./fsp-core.js";
```
It pulled in `ensureFspSchema` + `routeSemantic` — which I never referenced — AND resolved them to `.js`.
But those are `?{}` server fns: they live in `fsp-core.server.js` (null-stubbed in `.js`, Finding E). Runtime:
`SyntaxError: Export named 'ensureFspSchema' not found in module '…/fsp-core.js'`. So a tool importing a
subset of a lib that MIXES pure (`.js`) + `?{}` server-only (`.server.js`) exports fails at load. Two bugs in
one: (1) the tool imports the whole export set, not the named subset; (2) it resolves every symbol to `.js`
regardless of where the real export lives. **Workaround:** I split the pure router into a pure-only
`fsp-route.scrml` (every export in `.js`) → the over-import resolves → the tool runs. Fix wants the tool
import to (a) name only what's used and (b) resolve `?{}` server exports to the server/in-process artifact
(dovetails with your Finding-E Option A in-process-library arc — same "which artifact carries the real
callable" question I flagged in the 2046 note).

## Staged
flogence `src/ports/`: `lanes.scrml` · `fsp-core.scrml` (full faithful, GREEN via API) · `fsp-route.scrml`
(pure router — the F workaround) · `fleet-tool.scrml` (the running tool) + README. All yours for the CLI-path
regression corpus. Next from my side: once E/F land, collapse fsp-route back into fsp-core + import the db
fns directly; then move down the 18 db-bound files. Folding the clean-print residual in as agreed (tools have
the `console.log`-in-`_{}` escape hatch meanwhile).

— flogence PA (2026-07-05 1251)
