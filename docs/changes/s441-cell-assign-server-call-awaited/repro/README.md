# s441 reproducers — `@cell = serverFn()` fired detached

Base compiler: `cf62b4154` (origin/main at dispatch). Fix: this branch.

Compile any of these with

    bun run compiler/src/cli.js compile docs/changes/s441-cell-assign-server-call-awaited/repro/<file>.scrml -o <scratch>

and read `<file>.client.js`. Execution proof is in the conformance cases
`conformance/cases/server-fn/cell-assign-*` (run `bun conformance/run.ts`) and in
`compiler/tests/integration/cell-assign-server-call-awaited.test.js`; both drive the
emitted client in happy-dom with a stubbed server route.

| file | shape | base (cf62b4154) | fixed |
|---|---|---|---|
| `read-after-write.scrml` `go()` | `@out = double(21); @seen = @out` | emits `(async () => _scrml_cs_reactive_set("out", await …))().catch(…)`; `@seen` = **0** | `_scrml_cs_reactive_set("out", await …)`; `@seen` = 42 |
| `read-after-write.scrml` `seq()` | `@out = double(1); @out = double(2); @out = @out + 100` | stub 7: `@final` = **100**, `@out` ends **7** (a detached write resolved last) | `@final` = `@out` = 107 |
| `write-forms.scrml` | `@x.f = s()`, `@x += s()`, `[...@l, s()]`, `s().v` | already awaited in place on base (U1) | unchanged |
| `write-forms.scrml` `inIf` / `inLoop` / `whole` | whole-result write in `if` / `for` / straight line | detached IIFE | awaited in place |
| `other-contexts.scrml` `failable()` | `@out = risky(2) !{ \| .Boom(m) :> { …; return } }` then `@seen = …` | handler inside a detached IIFE: the arm's `return` leaves only the IIFE, the next statement reads the stale cell | awaited in place; `return` leaves `failable` |
| `other-contexts.scrml` top-level `@top = double(50)`, `<init> = double(3)` | module-init | IIFE | IIFE (no async host in a classic script — the case the IIFE exists for) |
| `other-contexts.scrml` `onclick=${@out = double(8)}` | inline handler | IIFE in a sync `function(event)` | unchanged — handler lowering is the sibling dispatch's locus |
| `request-reassign.scrml` | `<request>` body cell reassigned in `refresh()` | the §6.7.7 settle machine (`var` decls, a nested fetch fn, a cleanup registration) spliced INTO `refresh`; the real mount fetch left as a plain IIFE | `refresh` awaits in place; one settle machine, at module scope |
| `docs/readme-snippets/tasks-app.scrml` | engine `effect=` `@tasks = loadTasks(@userId) !{…}` then `@phase = @tasks.length == 0 ? .Empty : .Editing` | rows exist -> phase **Empty**; Network error -> `TypeError: Attempted to assign to readonly property` (arm assigns the `const` result) | rows -> **Editing**; none -> Empty; Network -> ErrorState, `@tasks` untouched |

Value-recovery arm on a server-escalated failable (`conformance/cases/server-fn/cell-assign-failable-recovery-value`):
base leaves `@result` = `"init"` and logs `[scrml errorBoundary result] … TypeError: Attempted to assign to readonly property`;
fixed: `@result` = `"recovered: neg"`.
