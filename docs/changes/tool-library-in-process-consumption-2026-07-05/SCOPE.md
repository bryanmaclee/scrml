# SCOPE — In-process library consumption for tools (Option A / Finding E)

**Change-id:** `tool-library-in-process-consumption-2026-07-05`
**Status:** SCOPING (S239, 2026-07-05). **Rulings:** Option A (bryan, "A your lean", S239 — Finding E); **D5 = GENERALIZE** (bryan, "generalize now", S239) — the in-process library emit serves ANY server-side/in-process consumer, NOT just `kind="tool"`.
**Sequence:** lands AFTER the A/B plumbing fix (`g-tool-import-drop` + `g-foreign-lang-cli-mode-detect`, being fix-rounded off `79e5a8f7`, landing S239). A/B unblocks foreign-only + pure-fn lib imports (flogence's GREEN case); THIS arc unblocks db-bound (`?{}`) lib imports for in-process consumers. **NB — A/B's per-consumer emit routing (code-review finding #1, being fixed additive) is the substrate this arc rides; it must land correct first.**

## 0. Reframed by D5 (generalize) — the real principle

Not "tool-library imports" — **a library's consumption model is boundary-shaped**. A `?{}` (SQL) lib fn is server-classified (§12); the HTTP-route + null-stub is the emit for crossing the **CLIENT boundary** (a browser can't run SQL, so it fetches). But an **in-process consumer has no client boundary** — a `kind="tool"` OR a server-side module (a `<program>` server fn) that imports the lib should call its db fn **directly, in-process**. The generalized principle: **the library's server/in-process artifact carries the REAL db callable; the null-stub + HTTP route are reserved for the client boundary only.** Both a tool and a server consumer import the real callable — same mechanism, one model. (Finding E's null-stub was in `.server.js` ss1 too — so server consumers are broken the same way tools are; generalizing is the honest fix, not a tool special-case.)

---

## 1. The problem (Finding E — empirically confirmed)

A scrml **library is emitted as an HTTP-fronted mini-backend**. A `?{}` (SQL) library fn is server-classified (§12) → the importable artifact NULL-STUBS it and the real logic becomes an HTTP route. Confirmed (`dblib.scrml`: a `?{}` `countItems` + a pure `scoreOf`):

- `dblib.js` (importable): exports **only** `scoreOf` (real). `countItems` is **absent**.
- `dblib.server.js`: `countItems`'s real logic is an HTTP handler (`_scrml_handler_countItems_1` → `POST /_scrml/__ri_route_countItems_1`); its "module value export" is a **null-stub**: `const rows = null; // client cannot evaluate _scrml_sql (E-CG-006); use a server-side function`.

This is **correct for a browser app** (it calls the lib over HTTP). It is **wrong for a `kind="tool"`** — a tool is an in-process monolith with NO HTTP boundary; it runs the server side directly. So a tool importing a db-bound lib fn gets a null-stub or an unreachable endpoint. **Db-bound shared library code is unavailable to tools.**

flogence's workaround (author splits a pure `fn` out, tool does its own `?{}`) covers compute but: (a) a pure-db-side-effect fn like `ensureFspSchema()` has no compute to split → uncovered (a tool must inline its schema); (b) it imposes a manual refactor tax on the author — against scrml's co-location ethos.

## 2. The reuse — the in-process db lowering ALREADY exists (proven)

A tool's OWN `?{}` already lowers **in-process** (`emit-tool.ts` `generateToolJs`, `boundary:"server"`). Verified — a tool with `db="sqlite:./t.db"` + `?{}` emits and RUNS:
```js
import { SQL } from "bun";
const _scrml_sql = new SQL("sqlite:./t.db");
// ...
const rows = await _scrml_sql.unsafe("select count(*) as c from items");
```
→ `bun tool.js` prints `count=3`, exit 0. No route, no null-stub.

**So the machinery Option A needs is BUILT.** `buildDbHandleHeader` (the Bun.SQL handle) + `emitLogicNode` at the server boundary + runtime-helper inlining + `computeAsyncFnNames` are exactly what a tool-imported db-lib fn needs. Option A = apply this per-fn lowering to a **library file's exported fns** (no `main` harness).

## 3. The target model — a library's emit is CONSUMER-SHAPED

A library file emits differently by who imports it (the A/B landing already routes per-consumer via `isLibraryShapedFile` + the `emitAsLibrary` decision when the build has a `kind="tool"` entry):

| Consumer | `?{}` lib fn emits as | Artifact |
|---|---|---|
| **Browser app** (today) | HTTP route + client null-stub | `.js` (client) + `.server.js` (routes) |
| **Tool / in-process** (Option A) | **real in-process callable** (`export async function f(){ … await _scrml_sql.unsafe(…) … }`, own db handle, `_{}` inline) | `.js` (in-process module — no routes, no null-stubs) |

**The payoff:** the lib author writes ONE `?{}` fn. It becomes an HTTP route for app consumers AND an in-process callable for tool consumers — **no author split, no refactor tax** (this is the whole point of the A-over-B ruling). `ensureFspSchema()` works (it's just a `?{}` fn run in-process).

## 4. Design decisions + open questions

- **D1 — emit path.** New `generateToolLibraryJs` in `emit-tool.ts` (owns the in-process discipline; reuses `buildDbHandleHeader` / server-boundary `emitLogicNode` / helper-inlining), emitting a library file's `export`ed fns with NO `main` harness + NO routes. The A2 `emitAsLibrary` decision (codegen/index.ts) dispatches a tool-dep to `generateToolLibraryJs` instead of the web-app `generateLibraryJs`. *(PA-resolvable; lean stated.)*
- **D2 — db handle.** Each imported lib module gets its OWN `_scrml_sql` handle from its OWN `<db src>` (matches server emit; simplest). **OQ:** if a tool + N libs point at the SAME db file → N separate connections (SQLite tolerates it; a shared handle is cleaner but more machinery). *Lean: per-module handles v1; note the same-file case.*
- **D3 — async-coloring.** ALREADY covered by the A/B Flag-C fix: `bodyHasForeignOrSql` (which the async-name scan uses) includes `kind==="sql"` → a `?{}` lib fn is detected async → the tool caller awaits it. **Verify** it fires for a db lib fn (not just foreign) in W3. *(Likely free.)*
- **D4 — null-stub bypass.** The E-CG-006 null-stub path (emit-library / emit-server) must be BYPASSED for the tool-dep in-process emit — the fn's real logic replaces the stub.
- **D5 — RESOLVED: GENERALIZE.** The in-process consumer is a `kind="tool"` OR a server-side module (a `<program>` server fn) importing the lib. One mechanism, one model (§0). So the trigger isn't "the build has a tool entry" — it's "an in-process/server consumer imports this lib." (This also means the fix isn't gated on the A2 tool-entry flag; it's the server/in-process library artifact carrying real callables.)
- **D8 (NEW — the load-bearing artifact question).** WHICH artifact carries the real in-process db callable? Today: `.js` (client) omits the db fn; `.server.js` ss1 null-stubs it. Options: **(i)** the server/in-process artifact (`.server.js` OR a dedicated `<base>.js` for in-process consumers) carries the REAL db callable (in-process lowering), and the in-process consumer imports THAT; **(ii)** a distinct in-process artifact. Must not regress the browser path (client `.js` keeps pure-only; the HTTP routes stay for the client). **Empirical check for W1:** confirm what a normal web-app server fn importing a db lib fn resolves to today (expected: the `.server.js` null-stub — i.e. server consumers are broken the same way tools are). This picks the artifact.
- **D6 — capabilities/security (§23.5, Nominal).** A tool now runs the lib's SQL in-process → the lib's db access is in the tool's process/capability scope. **OQ:** does the tool declare/inherit the lib's `db` capability? *Lean: defer — §23.5 is Nominal/spec-ahead; note the coupling.*
- **D7 — SPEC home (Rule 4, spec-before-impl).** A new **§64.x "Tool library imports — in-process consumption"** subsection + a **§21 note** that a library's consumption model is consumer-shaped (HTTP-fronted for browser apps; in-process for tools). PA-authored.

## 5. Decomposition

- **W1** — SPEC: §64.x in-process-library-consumption + §21 consumer-shaped-library note (+ any §34 code if a new diagnostic is needed — e.g. a lib shape a tool can't consume in-process). PA-direct.
- **W2** — emit: `generateToolLibraryJs` (D1) + the A2 dispatch (codegen/index.ts) routing a tool-dep to it; `?{}` in-process lowering + own db handle (D2) + `_{}` inline + null-stub bypass (D4) + no routes/harness.
- **W3** — async-coloring verify (D3) + tests + R26 against flogence's real fsp-core shape (a tool imports a `?{}` lib fn, runs it in-process, hits the db; + `ensureFspSchema` schema-setup).
- **W4** — conformance case + adversarial (S215).

## 6. Verification target (R26)
flogence's real `fsp-core.scrml` (`<db src>` + `?{}` + `<foreign lang>` + `_{}`) imported by a `kind="tool"` (fleet): the tool imports `routeSemantic` / `ensureFspSchema` / a pure fn, runs them in-process, the SQL executes against the db, no HTTP, no null-stub. That is the DONE bar — flogence's pure/db-split workaround becomes unnecessary.

## 7. Open questions to surface (user)
Most of D1–D7 are PA-resolvable. The genuine forks worth a ruling: **D5** (scope to tools-only v1 vs generalize to server-side in-process consumers) and a light confirm on **D2** (per-module db handles). D6 (capabilities) is a defer-note. Everything else is implementation the arc resolves.
