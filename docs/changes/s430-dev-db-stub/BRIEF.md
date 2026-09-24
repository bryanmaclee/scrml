# BRIEF — s430-dev-db-stub (adopter-reported, P7 criterion 2: fix in TS)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Report (flogence PA, S49, 2026-09-23 — reproduction supplied, not yet reproduced by the scrml PA)
A program declaring `db="./flogence.db"` whose real store is at the REPO ROOT: `bun run compile` → exit 0. Then
`scrml dev` (wait for "Serving … at http://localhost:3000") creates ZERO-BYTE `src/flogence.db` and
`src/ports/flogence.db` beside each compiled source. Every later `compile` then resolves `./flogence.db` against the
SOURCE dir, opens the empty stub, and fails `E-PA-004: Table \`delta_log\` was not found in the database`. `compile`
alone never creates the stubs; only `dev` does. It also breaks `dev`'s own watch-rebuild (serves the compile-error page).
Removing the stubs restores green.

## Do
1. **Reproduce first** on a minimal fixture you build (a `<program db="./x.db">` with a `?{}` against a table that exists
   only in a db one directory up / at the project root). If it does NOT reproduce, STOP and report NOT-REPRODUCED with the
   exact commands and outputs.
2. Root cause: which code path in `dev` (`compiler/src/commands/dev.js`, PA-LOCATED-VERIFY) creates a database file, and
   against what base directory it resolves `db=` relative paths vs `compile`. Governing sentence: find the SPEC section
   that says what a relative `db=` path resolves against (§44 / §4.12 / §40 — search; quote it, or record
   "searched X,Y,Z — no governing sentence found", which makes the resolution rule a ruling and you STOP at diagnosis).
   `dev` and `compile` MUST resolve identically, and NOTHING in the compiler should ever create an empty database file
   as a side effect of opening one for schema reading (open read-only / check existence).
3. **Diagnostic fix (independent of 2):** `E-PA-004` must name the RESOLVED ABSOLUTE PATH of the database it opened, and
   when the file is zero bytes say so explicitly.
4. Tests: dev-then-compile does not break; E-PA-004 text carries the path; an absent db file is not created.
