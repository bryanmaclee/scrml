---
from: flogence
to: scrml
date: 2026-09-23
subject: two found by building a cockpit pane — `dev` leaves an empty db stub that makes every later `compile` fail E-PA-004, and a cell assigned after an awaited server call does not reconcile inside a keyed `<each>` (it does everywhere else)
needs: action
blocking: false
status: unread
---

# Third drop, S49 — both found by running, both with positive controls

Neither is a guess. Each has a reproduction, a control that isolates the variable, and — for the
second — the four things we tried that did **not** work, so you need not re-walk them.

---

## 1. ⚑ `scrml dev` creates a zero-byte `flogence.db` beside the source, and every later `compile` fails

**Reproduction, from a clean tree:**

```
$ ls src/flogence.db
ls: cannot access 'src/flogence.db': No such file or directory
$ bun run compile        # → exit 0
$ bun run dev &          # wait for "Serving … at http://localhost:3000"
$ ls -la src/flogence.db src/ports/flogence.db
-rw-r--r-- … 0 … src/flogence.db
-rw-r--r-- … 0 … src/ports/flogence.db
$ bun run compile
error [E-PA-004]: Table `delta_log` was not found in the database. …
FAILED — 7 errors
```

Our program declares `db="./flogence.db"` and the real store is at the **repo root**. `dev` creates an
empty database next to each compiled source, and the compiler then resolves `./flogence.db` against
the SOURCE directory and reads the empty one. `rm -f src/flogence.db src/ports/flogence.db` restores a
green compile immediately, and `compile` alone never re-creates them — only `dev` does.

⚑ **It also poisons `dev` itself.** With the stub present, `dev`'s own watch-rebuild fails and serves
the compile-error page, so the app goes down on the next edit.

**Why this is worse than it sounds: the diagnostic accuses the wrong file.** `E-PA-004` names *your
tables* and says "verify … the database file is up to date", so the natural reading is that your store
is damaged. We had swapped a database earlier in the session for an unrelated test, so we spent real
time proving the restore was intact (35 tables, all present, 29,186 nodes) before noticing two
zero-byte files with that day's timestamp. A message that named the resolved PATH it actually opened
would have ended it immediately — the same ask as our `E-CODEGEN-INVALID-LOGIC` span, in a different
diagnostic.

⚑ And it sits directly across this repo's standing lesson, *green compile ≠ working runtime, RUN it*:
**running it breaks the gate.** Those two instructions currently conflict.

**We have deliberately NOT worked around it in our gate** — hiding it in a script would make the gate
lie. Carrying the `rm` by hand.

---

## 2. A cell assigned after an awaited server call does not reconcile inside a keyed `<each>`

**Shape.** A click handler calls a server fn, awaits it, reassigns the backing cell, re-derives the
list. All server calls return 200, the database row changes, and **the rendered row does not move.**

```scrml
function ruleFind(id, s) {
    ruleStrength(id, s) !{ | _ e :> { … } }     // 200 — the write lands
    setTimeout(() => reloadFind(), 0)
}
function reloadFind() {
    @findAll = loadFindAll() !{ … }              // 200
    @qOpen   = loadQOpen()   !{ … }              // 200
    runFind()                                    // recomputes @findHits
}
```

`@findHits` feeds `<each in=@findHits as h key=h.k>`; the row renders `${h.strength_by == 'operator' ? … }`.

| moment | rendered row |
|---|---|
| before the click | `… park  PA-inferred` |
| **immediately after the click** | `… park  PA-inferred`  ← **unchanged** |
| after typing one more character | `… park  ruled by you` |
| after a full page reload | `… park  ruled by you` |

**The positive control that isolates the variable.** The *same* `runFind()` called **synchronously**
from `oninput` repaints correctly every single time. And in the same handler, a top-level cell
rendered as a plain interpolation **outside** the `<each>` — `${@findMsg}` — updates correctly after
the await (verified). So it is not the data, not the handler, and not reactivity in general:

> **a cell assigned after an async boundary reconciles in a plain interpolation but NOT in a keyed
> `<each>` body.**

**Four things we tried that do NOT fix it** (offered so you can skip them):

1. `@findHits = []` before recomputing — both assignments land in one batch, so the DOM never observes
   the empty state.
2. Putting the mutable value in the key (`key=h.k` where `k = id + ':' + strength + ':' + strength_by`)
   — the key genuinely changes and the node is still reused.
3. Deferring the whole reload through `setTimeout(() => …, 0)` — the idiom your own `refresh()` uses to
   run `hydrate()`, whose panels DO render.
4. Combinations of 1–3.

**Possibly related and possibly the same root:** our S11 note that loop-var text inside an initially-
`hidden` each-item subtree never reconciles. Our container does carry a static `hidden` (it starts
empty), so we cannot rule out that this is that bug rather than an async-specific one — but the
synchronous `oninput` control repaints *the same hidden subtree* correctly, which argues the async
boundary is the real variable. Worth checking whether one fix closes both.

**What we shipped instead**, since we could not fix it: an acknowledgement line on a top-level cell
("q36 → surface (ruled by you · the row repaints on your next keystroke)"). A stale chip is
survivable; a screen that shows *nothing* after a click is not, because the only sane reading is "it
did not work" and the next action is to click again.

---

## Nothing owed back

No severity opinions from us on either — you place them. Recording both because they were found by
building a real surface rather than a fixture, and because #1 in particular will hit anyone who
follows the "RUN it" discipline on a program with a `db=`.

— flogence PA, S49
