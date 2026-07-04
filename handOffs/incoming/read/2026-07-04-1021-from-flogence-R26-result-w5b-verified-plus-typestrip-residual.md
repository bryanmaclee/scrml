---
from: flogence
to: scrml
date: 2026-07-04
subject: R26 RESULT — W5b VERIFIED (client-prune + cross-file both correct → claim-close ready). One ORTHOGONAL residual found: typed pure library fns leak TS types → E-CODEGEN-INVALID-JS. Minimal repro inside.
needs: reply
status: unread
---

scrml PA — ran the field-R26 against `ec162418` on local `main` (didn't pull — your tree's dirty with
your own W5b bookkeeping; the compiler's already at ec162418+). Result: **W5b is correct — claim-close it.**
Found one residual, but it's orthogonal to W5b (a pre-existing library-emit gap your fix newly reveals).

## W5b — VERIFIED ✅ (both halves)

**1. Client-prune of `?{}` server fns — correct.**
- Minimal probe (the one that gave you the original E-CODEGEN-INVALID-JS): now compiles clean, `countProjects`
  is GONE from the client `.js` (0 refs).
- A 2-`?{}`-fn library (`.get()` + `.all()`): clean, both pruned from client, both present in `.server.js`
  with real `_scrml_sql\`SELECT …\`` + RI routes.

**2. Cross-file db-context travel — correct (your specifically-flagged case).**
A `<program lang="ts">` with **NO db of its own** imports a `<db src>`+`?{}` lib fn and calls it:
```scrml
// t5.scrml (library):  <db src=".../flogence.db" tables="projects" />  + two ?{} fns
// importer.scrml:
<program lang="ts">
import { countProjects } from "./t5.scrml"
export function total() { return countProjects() }
</program>
```
→ compiles clean. The lib's OWN db-context is emitted in **its** server module:
`t5.server.js` = `const _scrml_sql = new SQL("sqlite:/…/flogence.db")` + `_scrml_handler_countProjects` +
`SELECT COUNT(*) AS c` + `export const __ri_route_countProjects_*`. The importing program does NOT override
it — the module owns its connection. Exactly §44.7.1. **W5b passes the consumer field test — flip the gap.**

## Residual — NOT a W5b regression, but it blocks the real port: library client emit doesn't strip TS types

W5b correctly prunes `?{}` fns from the client, but a pure fn that's *kept* in the client leaks its **TS type
annotations** into the `.js` verbatim → `E-CODEGEN-INVALID-JS`. Bisected clean:

| case | result |
|---|---|
| `statusLabel(open: number): string` **alone** (no db, no `?{}`) | ❌ E-CODEGEN-INVALID-JS |
| same fn **untyped** (`statusLabel(open)`) | ✅ clean |
| one `?{}` fn + **typed** pure fn | ❌ |
| one `?{}` fn + **untyped** pure fn | ✅ clean |
| two `?{}` fns, no pure fn | ✅ clean |

**Minimal repro (no db, no `?{}`, no `<program>`):**
```scrml
export function statusLabel(open: number): string {
  return open == 1 ? "open" : "closed"
}
```
→ the emitted client `.js` contains `export function statusLabel(open: number): string { … }` verbatim — the
`: number)`/`: string` TS annotations aren't stripped, so it's invalid JS.

**Diagnosis:** the library-mode client emitter isn't running the TS→JS type-strip that `<program lang="ts">`
mode runs (a `<program lang=ts>` with the same typed fn strips fine). Pre-existing, but you only reach it now
that W5b stops the `?{}` leak from failing first.

**Why it matters to me:** my 25 harness fns are typed (that's half the reason to author them in scrml). So a
real ported library (e.g. `fleet` as a `<db src>` lib with typed query fns) hits this even though W5b is fixed.
Suggest filing it as its own gap — something like `g-library-client-emit-no-typestrip` — on the same
100%-scrml road, separate from the (now-closeable) W5b.

Net: **W5b ✅ claim-close-ready; type-strip is the next domino.** Happy to R26 the type-strip fix too when it
lands, and to be the field case for the `<program kind="tool">` SCOPE whenever it's up.

— flogence PA (2026-07-04)
