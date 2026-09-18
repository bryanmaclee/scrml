# to scrml — an IMPORTED server fn assigned to a reactive cell lands as a Promise

**From:** flogence PA, S39 (2026-09-12, `bryan-XPS-8950`)
**Severity:** HIGH — silent. Compiles clean, serves, renders, no diagnostic anywhere, and the page
shows nothing. Same family as **`g-local-thunk-callsite-not-awaited`** (#851, filed from here at
S37): local async-ness is not propagated to the call site. This is that defect one position over —
across a FILE boundary, into a reactive-cell assignment.

**Impact for us:** it blocks sharing query functions as a library between a CLI tool and a page.
The library is fine from a `kind="tool"` program; it cannot be used from a served `<program>` at all.

## The three-arm repro (all in one file, one click, same query)

```scrml
<program lang="ts" db="../flogence.db">
  ${
    import { listArcs } from '../graph-read.scrml'   // ?{}-using fn in a <db src> library

    <fromImport> = []
    <fromLocal>  = []
    <fromShim>   = []

    function fetchLocal() {
      return ?{`SELECT id, title FROM gnode WHERE kind = 'arc'`}.all()
    }
    function fetchShim() { return listArcs() }        // local frame wrapping the import

    function load() {
      @fromImport = listArcs()   !{ | _ e :> { return } }
      @fromLocal  = fetchLocal() !{ | _ e :> { return } }
      @fromShim   = fetchShim()  !{ | _ e :> { return } }
    }
  }
  <main>
    <button onclick=load()>load</button>
    <p>import: ${@fromImport}</p>
    <p>local:  ${@fromLocal}</p>
    <p>shim:   ${@fromShim}</p>
  </main>
</program>
```

**Observed in the browser:**

| arm | rendered |
|---|---|
| `fromLocal` — query declared in the page | `[object Object]` ×4 — correct |
| `fromImport` — identical query, imported | **`[object Promise]`** |
| `fromShim` — local fn returning the import | **`[object Promise]`** |

The shim arm is the informative one: the local frame IS awaited (arm 2 proves it), and it still hands
the inner cross-file promise straight through. So the await is applied at the call site based on what
the compiler knows locally, and an imported server fn is not recognised as async there.

`@cell.length` consequently reads `undefined`, and `<each in=@cell>` iterates nothing. **No warning,
no error, exit 0** — the page renders its headings and sits inert. There is nothing to notice.

## What it is not

- Not the library being broken. `bun run graph:read --arcs` returns the 4 rows from the same
  function, and importing the emitted `graph-read.js` directly in bun returns them too.
- Not the wire. We drove the generated route by hand (double-submit CSRF: POST once to collect the
  `scrml_csrf` cookie, resend it as cookie + `X-CSRF-Token`) and it returns the correct JSON array.
- Not the cell kind. Identical under `<name server> = []` and `<name> = []`.
- Not the failable form — arm 2 uses the same `!{ | _ e :> {...} }` and works.

## Adjacent, lower severity, same session

The dev server creates **0-byte `flogence.db` files** beside any source declaring
`db="./flogence.db"` from a subdirectory (`src/`, `src/ports/` for us). PA then opens those empty
files and reports `E-PA-004: Table ... was not found in the database` for tables that exist in the
real store, and route handlers return 500 `unable to open database file`. Deleting them fixes both
until the next serve. `<db src>` resolving relative to the SOURCE FILE at compile time but to CWD at
runtime is the underlying split; we could not find a single relative path that satisfies both.

## Our disposition

**Not laundered.** The read library keeps one home for the queries and is used from the CLI, where
it works. The page is left demonstrating the defect rather than routed around it, because the
workaround — inlining every query into the screen — is the exact duplication the library exists to
prevent, and we would rather carry the constraint visibly than bake a second home for the same SQL.

Return leg appreciated. If the fix is far out, a ruling on the intended pattern for a page reading a
shared query module would let us pick an interim deliberately instead of by default.
