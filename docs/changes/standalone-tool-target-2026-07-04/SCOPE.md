---
change-id: standalone-tool-target-2026-07-04
status: SCOPE — OQ1 lean (ii) bryan-greenlit ("go" S238); OQ3/OQ4 defaulted (E-TOOL mint / hard-error); OQ1+OQ2 → flogence review in-flight (pinged 2026-07-04); build GATED on flogence's emit review
author: scrml PA (S238)
ratified: S237 (bryan verbatim "ratify both kind=\"tool\" and library-with-lang")
consumer: flogence (named first consumer / R26)
grounding: SPEC §40.8 (one-program-per-app) · §43 (nested execution contexts) · §23.2 (`_{}` foreign) · §23.5 (`capabilities=`) · §44.7.1 (module-with-db-context / W5b) · E-FOREIGN-003
---

# Standalone-tool compile target — SCOPE

## 0. Why this exists

flogence is going 100%-scrml (retire its `.ts` harness). Two blockers:
1. **W5b** (library-mode `?{}` emit) — LANDED S237, field-verified.
2. **No standalone-tool target** — scrml can only emit a *web application* (html + client.js + CSRF + server routes) from a top-level `<program>`. flogence's 25 harness files are CLI tools / servers / imported libs — none is a web app. There is no way to emit a plain `bun <file>.js`-runnable module.

Bryan RATIFIED **both** of two complementary surfaces (S237). This SCOPE grounds them against the SPEC, decomposes the build, names the new error codes, and surfaces the design forks that need a ruling before dispatch.

## 1. The ratified design (from flogence's 25-file consumer analysis + bryan's ruling)

flogence's 25 files are **three runtime shapes → two compile surfaces:**

| Shape | Count | Examples | Compile surface |
|---|---|---|---|
| run-and-exit CLI | ~18 | fleet, dispatch, route, tick, bridge, digest, giti-sync | **Surface 1** — `<program kind="tool">` |
| long-running server | 2 | fsp-mcp (MCP stdio), fsp-wire (Bun.serve HTTP/SSE) | **Surface 1** — `<program kind="tool">` (blocking main) |
| imported shared lib | 2–3 | fsp-core (schema+routing), lanes | **Surface 2** — library-with-`lang=` |

**Surface 1 — `<program kind="tool">`** (entry-point tools; the FIRST explicit top-level `kind=`):
- Emit = a **plain runnable module** — NO html, NO client.js bundle, NO CSRF, NO HTTP-web scaffold. Runs as `bun <emitted>.js`.
- **Composes** with existing `<program>` machinery: `lang=` → `_{}` foreign code (§23.2), `db=` → `?{}` (§44 + W5b), `capabilities=` (§23.5, advisory). `kind="tool"` changes ONLY the emit target, not the context resolution.
- **Entry convention:** a top-level `fn main(args: string[]): number`. Lowers to `main(process.argv.slice(2))`; the process exit code is main's return.
- Handles BOTH run-and-exit AND long-running under ONE `kind` (no separate `kind="service"`): the rule is **"main returns → `exit(code)`; main blocks → process stays up."** ← the load-bearing emit subtlety (§4, OQ1).

**Surface 2 — library-with-`lang=`** (imported shared libs; the COMPLEMENT):
- A no-`<program>` pure-fn library (§21.5) that CAN declare `lang=` (and, via W5b, a file-own `<db src>`). No `main`, `export` fns only.
- Closes **E-FOREIGN-003** ("`_{}` block has no `lang=` declaration in any ancestor `<program>`") for library files — currently a library with `_{}` has no `<program>` to hang `lang=` on, so it's un-emittable.
- Direct precedent: **§44.7.1 module-with-db-context** (F-AUTH-002/W5b) already lets a pure-fn file declare its own `<db src>` and resolve `?{}` against it. Surface 2 is the `lang=` sibling of that same pattern.

## 2. SPEC grounding (Rule-4 verified — read in full, S238)

- **§40.8** — one-program-per-application. The top-level `<program>` is the app root; app-wide attrs (title, cors, log, db, …) live on it. TODAY that top-level program emits a web app (html + client + server routes; SPA if no `<page>` children). `kind="tool"` re-targets that top-level emit. This is the FIRST explicit top-level `kind=` — §40.8's `<program>` had no `kind=` attribute before.
- **§43** — nested `<program>` execution contexts are **inferred** from attribute combos (Web Worker / Foreign Sidecar / WASM / Server Endpoint; §43.2). `kind=` does NOT reclassify these — it is a **top-level output-shape selector**, orthogonal to §43's nested-context inference. (Also distinct from the §47.1.2 name-encoding "kind markers" `s`/`e`/`p`/… — unrelated concept, same word.)
- **§23.2 / E-FOREIGN-003** — `_{}` foreign code resolves `lang=` from the closest ancestor `<program>` (E-FOREIGN-003 if none). Inline value-returning `_{}` is ts/js-only (E-FOREIGN-005). Surface 2 gives a library file a `lang=`-bearing context so its `_{}` resolves.
- **§23.5** — `capabilities=` (Nominal / advisory in v1). `<program kind="tool" capabilities=[…]>` composes for free; no new work, no gate.
- **§44.7.1** — module-with-db-context: a pure-fn file MAY declare one top-level `<db src>`; its `?{}` resolve against that; an importing `<program db>` does NOT override it (the module owns its connection). This is the structural template Surface 2 mirrors for `lang=`.

## 3. Build decomposition

### Surface 1 — `<program kind="tool">` (the primary, larger build)

**3.1 Attribute recognition + validation** (parser / program-shape checks)
- Recognize `kind=` on the top-level `<program>`. v1 closed vocabulary: `kind="tool"` is the ONLY legal value (mirror §23.5.3's closed-vocab discipline) → unknown value = new error (OQ3).
- `kind=` is **top-level-only** — a nested `<program kind=>` is an error (§43 nested infers) (OQ3).
- A `kind="tool"` program with **no `<page>` children, no markup body, no client-reactive UI** — the tool body is logic + `fn`/`function` decls + `_{}` + `?{}` + the `main`. Markup/`<page>`/client-state inside a `kind="tool"` → error (OQ4).

**3.2 `main` entry convention** (typer / program-shape)
- Recognize a top-level `fn main(args: string[]): number` in a `kind="tool"` program. Validate the signature (arg is `string[]`, return per OQ1).
- `kind="tool"` with NO `main` → error (a tool with no entry can't run) (OQ3).

**3.3 The NEW emit target — plain module + main harness** (codegen; THE big piece)
- A new emit path (mode in `codegen/index.ts`, sibling to the web-app orchestration) that **bypasses** `emit-html` / `emit-client` / CSRF / server-route emission and produces a plain ES module:
  - the file's logic (fn/const/type decls), the `_{}` foreign blocks (via existing `lang=` resolution), the `?{}` db calls (via W5b / `emit-library` type-strip once landed),
  - the **main harness**: `main(process.argv.slice(2))` + the exit discipline per OQ1.
- Reuse, do NOT reinvent: the CLI commands (`compiler/src/commands/*.js`) already do `process.argv.slice(2)` + `process.exit(code)` — that's the harness pattern to mirror.

**3.4 db / lang / capabilities composition** — verify `<program kind="tool" db="…" lang="…" capabilities=[…]>` resolves `?{}` / `_{}` / capability-set exactly as a normal `<program>` does. This should be free (kind only changes emit), but it's the R26 surface flogence will field-test (fleet = db-only; dispatch = db + `_{}`).

### Surface 2 — library-with-`lang=` (the smaller build)

**3.5 Library `lang=` declaration** — give a no-`<program>` pure-fn library a way to declare `lang=` for its `_{}` blocks, structurally mirroring §44.7.1's `<db src>` module-context. **Exact syntax is OQ2.** Closes E-FOREIGN-003 for library files.

**3.6 Library emit** — the library already emits via `emit-library.ts` (W5b). Surface 2 ensures the declared `lang=` context flows to the library's `_{}` emission. Couples with the **emit-library type-strip** (`g-library-mode-no-typed-payload-match`) already queued as the next Road-B domino — same file, likely same arc.

## 4. OPEN QUESTIONS (need a ruling before build dispatch)

### OQ1 — the blocking-main harness (THE load-bearing emit fork; flogence owns the review)

"main returns → exit(code); main blocks → stays up." The emit must implement this. The naive `process.exit(await main(argv))` **breaks the Bun.serve case**: `Bun.serve()` returns a `Server` immediately, so `await main()` resolves → `process.exit(0)` → **the server is killed**. Two resolutions:

- **(i) Uniform await-harness + author-parks convention.** Harness is always `const code = await main(process.argv.slice(2)); process.exit(code)`. A long-running server main must NOT fall off the end after `Bun.serve` — it parks (`await new Promise<never>(() => {})`), so the await never resolves and the process stays up. Simple, one harness; burden on the author to park.
- **(ii) Return-type discriminates the harness (PA lean).** If `main` declares `: number` → exit-harness (`await` + `process.exit(code)`) — the CONTRACT is "I exit with this code." If `main` declares **no return** (`: never` / void) → invoke-only harness (`main(process.argv.slice(2))`, no exit) — the event loop keeps the process alive (Bun.serve, stdio loop). The SIGNATURE tells you the process model — co-located, falls-under-fingers (S206 co-location-of-behaviour axiom). fsp-mcp (exits 0 on stdin EOF) = `: number`; fsp-wire (parks on serve) = no-return. No "park forever" boilerplate.

**PA lean = (ii)** — static, co-located, no boilerplate; the return type *is* the "returns vs blocks" signal the design names. **Owed to flogence** for the emit review they explicitly offered ("MCP-stdio-blocking-main emit review") before the build.

### OQ2 — Surface-2 `lang=` declaration syntax

How does a no-`<program>` library declare `lang=`? Options: a top-level `<lang>`-style context block paralleling §44.7.1's `<db src>`; extend the existing library-header surface; or a file-level directive. PA lean: mirror the module-with-db-context structural shape (a top-level lang-context block), so a library declares `<db src>` + a lang-context the same way. Needs bryan's call on the exact token/shape (this is a new authoring surface, not just an emit change).

### OQ3 — validation error codes (likely a small mint)

- `kind="tool"` with an unknown `kind=` value / nested `<program kind=>` / no `main`. Do these fold into existing `E-PROG-001/002` (§43.7 — ambiguous/missing-attr) or want a dedicated `E-TOOL-00x` family? PA lean: a small dedicated family (`E-TOOL-001` no-main, `E-TOOL-002` unknown-kind / nested-kind) for adopter-facing clarity, mirroring the de-JS'd-error precedent (S237 — adopter-facing codes name the actual thing).

### OQ4 — tool-body constraints

A `kind="tool"` program forbids `<page>` / markup body / client-reactive UI (no html/client emit to hang them on). Confirm this is an error (not silently-dropped) and whether it reuses an existing code or wants one.

## 5. Build phasing (post-ruling)

1. **Surface 1 first** (the 18+2 tools — the bulk of flogence's harness + the higher-value target). Phases: 3.1 recognition → 3.2 main → 3.3 emit (the harness per OQ1) → 3.4 composition R26 (flogence field-tests fleet then dispatch).
2. **Surface 2** — couple with the queued emit-library type-strip (`g-library-mode-no-typed-payload-match`, same `emit-library.ts` region).
3. Dispatch via `scrml-js-codegen-engineer`, `isolation:worktree`, R26 Phase-3 (flogence's real harness files as the reproducers) + adversarial gate (S215 — external-consumer-facing).

## 6. flogence owed

- **Before build:** ping flogence with OQ1 (the harness fork + PA lean (ii)) for their emit review — they offered it and own the MCP-stdio-blocking-main shape.
- **At R26:** point the landed Surface-1 emit at `fleet.ts` (db-only, cleanest first R26) → `dispatch.ts` (db + `_{}`, full-stack) → the 18 db-bound files as the corpus. flogence ports a first tool and reports residuals before claim-close.
