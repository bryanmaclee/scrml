# SPEC amendment DRAFT — Standalone-tool target (§64) + Library foreign-language declaration (§23.6)

> **Status:** PA-authored draft, S238. Encodes the S237-ratified two-surface design + the S238-locked OQs
> (OQ1=(ii) return-type harness, flogence-endorsed; OQ2=`<foreign lang="ts" />`, bryan-ratified;
> OQ3=`E-TOOL-*` mint; OQ4=hard-error tool body). To be reviewed → landed into `compiler/SPEC.md` →
> then the impl dispatch implements against it (named-codes-land-with-impl: the `E-TOOL-*` §34 catalog
> rows land WITH the impl). Grounding: §40.8 (one-program-per-app) · §43 (nested execution contexts) ·
> §23.2/E-FOREIGN-003 · §23.5 · §44.7.1 · §39.2.x.

---

## § 23.2.4 AMENDMENT — admit the `kind="tool"` program body as a bare-`_{}` context (S238)

§23.2.4 ("Valid Contexts") + `E-FOREIGN-004` currently admit a bare non-value-returning `_{}` block
ONLY as a §23.4 `use foreign:` sidecar; the sole inline form is the §23.2.4a value-returning
`const x = _={ … }=` in a server `function` body. A `kind="tool"` program (§64) does its host I/O —
`console.log`, `Bun.stdin.stream()`, `Bun.serve`, `process.exit` — via bare non-value `_{}`. So §23.2.4
is AMENDED to add a THIRD admitted bare-`_{}` locus:

- **The body of a `function` declared at the top level of a `kind="tool"` program (§64), including
  `main`.** A bare non-value-returning `_{}` there is valid (it is the tool's host-I/O boundary), and
  the inline value-returning form (§23.2.4a) is likewise valid there. `E-FOREIGN-004` no longer fires on
  a bare `_{}` in that locus. The `_{}`'s `lang=` still resolves per §23.2.1 (the `<program lang=>` on
  the `kind="tool"` program). This admission is SCOPED to `kind="tool"` programs — a bare `_{}` in a
  normal web-app `<program>` body / client context stays `E-FOREIGN-004` (unchanged).

---

## § 23.6 Library Foreign-Language Declaration — `<foreign lang="…">`  (NEW)

**Added S238.** A pure-fn library file (§21.5 — a file with `export` functions and NO top-level
`<program>`) MAY declare the foreign-code language for its `_{}` blocks (§23.2) via a top-level,
self-closing **`<foreign lang="…">`** block. This is the `lang=` sibling of the §44.7.1
module-with-db-context (`<db src="…">`): just as a library declares its own db-context to resolve
`?{}` without a `<program db>`, it declares its own foreign-language context to resolve `_{}` without a
`<program lang>`.

**Motivation.** Before this, a library `_{}` block had no ancestor `<program>` to carry `lang=`, so it
was **E-FOREIGN-003** ("`_{}` block has no `lang=` declaration in any ancestor `<program>`") and the
library was un-emittable. `<foreign lang>` closes E-FOREIGN-003 for the library shape.

### 23.6.1 Syntax + placement
- A top-level self-closing block: `<foreign lang="ts" />` (or `"js"` — the §23.2.4a inline
  value-returning languages; other `lang=` values follow §23.2.1 sidecar rules).
- At most ONE `<foreign lang>` per file. A second is `E-FOREIGN-LANG-DUPLICATE`.
- It STANDS ALONE and is ORTHOGONAL to `<db src>`: a library may declare `<foreign lang>` alone, `<db
  src>` alone, both (side by side), or neither. (Ratified from the flogence consumer shapes: `fsp-core`
  needs both; `lanes` needs only `<foreign lang>` — no db — so the lang declaration cannot be an
  attribute on `<db src>`.)
- It is a **library-file** surface. A file that ALSO declares a top-level `<program>` uses the
  `<program lang=>` attribute (§23.2.1) — `<foreign lang>` in a file with a `<program>` is
  `E-FOREIGN-LANG-IN-PROGRAM` (use the `<program lang=>` attribute; the two do not stack).

### 23.6.2 Resolution
`_{}` blocks in the library resolve their `lang=` against the file's `<foreign lang>` exactly as §23.2.1
resolves against the closest ancestor `<program lang>`. Capability determination (§23.5.4) and the
inline value-returning ts/js rule (§23.2.4a, E-FOREIGN-005) apply unchanged.

### 23.6.3 Worked examples
```scrml
// fsp-core.scrml — imported shared lib; needs BOTH a db-context and a foreign-lang-context
<foreign lang="ts" />
<db src="./flogence.db" tables="fsp_task, delta_log, projects" />
export fn dispatch(db, frame, transport) {
    ... ?{ SELECT ... FROM fsp_task WHERE ... }.all() ...
    ... _={ /* ts */ }= ...
}
```
```scrml
// lanes.scrml — imported shared lib; foreign-lang ONLY (no db)
<foreign lang="ts" />
export fn runOpen(model, prompt) { ... _={ /* ts: OpenRouter completion + spawn */ }= ... }
```

### 23.6.4 Error codes (§34 rows land with impl)
| Code | Trigger | Severity |
|---|---|---|
| `E-FOREIGN-LANG-DUPLICATE` | more than one top-level `<foreign lang>` in a file | Error |
| `E-FOREIGN-LANG-IN-PROGRAM` | `<foreign lang>` in a file that also declares a top-level `<program>` (use `<program lang=>`) | Error |

---

## § 64 Standalone Tool Target — `<program kind="tool">`  (NEW)

**Added S238.** The FIRST explicit top-level `kind=` on `<program>`. It re-targets the top-level
program's EMIT from a web application (html + client.js + CSRF + server routes; §40.8) to a **plain
runnable module** — a CLI tool or long-running server runnable as `bun <emitted>.js`. It composes with
the existing `<program>` machinery (`lang=`→`_{}`, `db=`→`?{}` via §44/W5b, `capabilities=`→§23.5); it
changes only the emit shape, not context resolution.

`kind=` is a **top-level output-shape selector**, orthogonal to §43's nested-execution-context
inference (worker/sidecar/wasm/server-endpoint stay inferred from attribute combinations) and unrelated
to the §47.1.2 name-encoding "kind markers." `kind="tool"` is the ONLY value in v1 (closed vocabulary,
mirroring §23.5.3); other values → `E-TOOL-002`. `kind=` on a NESTED `<program>` → `E-TOOL-002` (§43
infers nested kinds).

### 64.1 Emit shape
A `kind="tool"` top-level program emits a plain ES module: NO html, NO client.js bundle, NO CSRF
scaffold, NO HTTP-web server-route emission. The module contains the file's logic (fn/const/type
declarations), its `_{}` foreign blocks (via `lang=`), its `?{}` db calls (via `db=` + §44), and the
`main()` invocation harness (§64.3). It is runnable directly (`bun <emitted>.js <args…>`).

### 64.2 Entry convention — `function main(args: string[]): number`
A `kind="tool"` program SHALL declare exactly one top-level entry `function main`. Its parameter is the
argv slice (`string[]`); its return type governs the process lifecycle (§64.3). A `kind="tool"` program
with NO `main` → `E-TOOL-001`.

**`function`, not `fn` (impure entry, ratified S238).** `main` is declared with `function`, NOT `fn`.
`fn` is the canonical PURE form (§48.11) and cannot hold the side effects `main` exists to perform —
reading argv, calling `process.exit`, and doing `_{}` I/O (stdin/stdout/`Bun.serve`). `main` is the
program's impure entry point; `function main` is the honest form. A `fn main` in a `kind="tool"`
program is `E-TOOL-004` (steer to `function main`).

**The tool body is an admitted bare-`_{}` context (§23.2.4, amended S238).** A CLI/server does its
host I/O (`console.log`, `Bun.stdin.stream()`, `Bun.serve`) via bare non-value `_{}` blocks. §23.2.4 is
amended (below) to admit the `kind="tool"` program body — specifically its `function` bodies incl.
`main` — as a valid bare-`_{}` locus, alongside the existing `use foreign:` sidecar and the §23.2.4a
inline value-returning server-function form.

### 64.3 The `main()` harness — the return-type discriminator (OQ1, ratified (ii))
The emitted harness invokes `main(process.argv.slice(2))`. The RETURN-TYPE of `main` selects the harness
arm — the signature IS the "returns-vs-blocks" process-model signal (co-located; §S206):

- **`function main(args: string[]): number`** (declares a numeric return) → **exit-harness**:
  `const code = await main(process.argv.slice(2)); process.exit(code);`. The return value is the process
  exit code. For run-and-exit CLIs (and a blocking loop that returns a code on drain, e.g. a stdin
  read-loop returning 0 on EOF).
- **`function main(args: string[])`** (NO declared return) → **invoke-only harness**:
  `await main(process.argv.slice(2));` — and then NOTHING. The harness does NOT call `process.exit`.

**Both arms `await main(...)`** — so an async no-return main's setup completes before the harness falls
through.

**Normative liveness semantic (put verbatim so it is not mis-modelled):** a no-return `main` does NOT
force the process to stay up — it **declines to force it down**. Natural Bun/Node event-loop liveness
then decides: the process stays alive while there is an active handle (a `Bun.serve` server, a
`Bun.stdin.stream()` reader) and exits 0 when the loop drains. A no-return main that holds no active
handle after its setup exits 0 (nothing to do = done). This makes ONE `kind="tool"` cover both
run-and-exit and long-running with no separate `kind="service"` and no park-boilerplate: a long-running
server's `Bun.serve` handle keeps the process alive on its own.

The only theoretical mis-fire is a tool that starts a server AND declares `: number` and returns a code
(the exit-harness would kill the live server). This is not guarded in v1: "you returned → you meant to
exit" is the predictable rule, and no realistic tool both serves and returns an exit code.

### 64.4 Tool-body constraints (OQ4, hard-error)
A `kind="tool"` program has no html/client to host UI. `<page>` children, markup body content, or
client-reactive UI state inside a `kind="tool"` program → `E-TOOL-003` (a hard error, never silently
dropped). The tool body is logic + `fn`/`function`/`type` declarations + `_{}` + `?{}` + `main`.

### 64.5 Composition
`<program kind="tool" lang="ts" db="…" capabilities=[…]>` resolves `_{}` / `?{}` / the capability set
exactly as a normal `<program>` (§23.2.1 / §44.2 / §23.5.4). `kind="tool"` + `db=` + W5b lowers `?{}`
identically to a `<program db>` web app; only the emit shape differs.

### 64.6 Error codes (§34 rows land with impl — OQ3)
| Code | Trigger | Severity |
|---|---|---|
| `E-TOOL-001` | `<program kind="tool">` with no top-level `function main` entry | Error |
| `E-TOOL-002` | `kind=` value other than `"tool"` (closed vocab v1), OR `kind=` on a nested `<program>` (top-level only; §43 infers nested) | Error |
| `E-TOOL-003` | `<page>` / markup body / client-reactive UI inside a `kind="tool"` program (no html/client emit) | Error |
| `E-TOOL-004` | `fn main` in a `kind="tool"` program — `main` is impure; use `function main` (§64.2) | Error |

### 64.7 Worked examples
```scrml
// fleet.ts → fleet.scrml — run-and-exit CLI, db-bound
<program kind="tool" lang="ts" db="./flogence.db">
    function main(args: string[]): number {
        given args.length == 0 { ... _={ console.error("usage: fleet <cmd>") }= ; return 2 }
        ... ?{ SELECT ... }.all() ...
        return 0
    }
</program>
```
```scrml
// fsp-wire.ts → fsp-wire.scrml — long-running server; main does NOT return
<program kind="tool" lang="ts">
    function main(args: string[]) {
        _={ Bun.serve({ port: 8787, fetch(req) { ... } }) }=
        // no return → invoke-only harness → Bun.serve's handle keeps the process alive
    }
</program>
```

### 64.8 Cross-refs
§40.8 (the web-app top-level program this re-targets) · §43 (nested execution contexts — orthogonal) ·
§23.6 (`<foreign lang>` — the COMPLEMENT surface for imported libs; a tool is an entry point, a library
is imported) · §23.5 (`capabilities=`) · §44 / W5b (`?{}` under `db=`) · §23.2 (`_{}` under `lang=`).
Consumer/R26: flogence (fleet.ts db-only cleanest first; dispatch.ts db+`_{}`; the 18 db-bound files).
