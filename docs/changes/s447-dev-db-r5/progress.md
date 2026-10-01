# s447-dev-db-r5 — progress (append-only)

## 2026-10-01 10:05 — startup
- WT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae3007278485636a2, clean, bun install + pretest OK.
- Leaked scrml-dev children observed (NOT started by me, NOT killed): PIDs 443349, 892523 (worktree agent-a92d7cfc42e15dd09),
  4119655 (scratchpad rev-approot). Reported to PA.
- Merged worktree-agent-a357de622e258554c (a1123e931) → 2797f0f02. Conflicts: SPEC-INDEX.md + FACTS.md generated counts
  only → took ours + regen (regen-spec-index, facts --write). state.ts --write touched master-list.md (PA-owned
  recent-sessions block) — reverted, not part of this change. Pre-commit full suite passed on the merge commit.
- Merged origin/main (bca39b61a, s445 wrap) clean → fbe0fb85f.

## Governing sentences (verbatim, scrml-support/user-voice-scrml.md §S445)
- Item 6 "db= resolution + creation": *"A `db=` path resolves against the directory of the `.scrml` file that
  declares it, and I'd add that sentence to SPEC. A program that declares its own schema (its own `CREATE TABLE`s or
  a `<schema>`) owns the database, so the runtime may create the file. A program that only references a database
  never creates it and fails loudly if the file is missing."*
- "a built server's data root; ownership is per declaring file", A: *"At build time, record each database path
  relative to the project root. At runtime, resolve those paths against a single data root. That root is the
  `SCRML_DATA_DIR` environment variable if set, otherwise the project root. The Docker/Fly adapters set
  `SCRML_DATA_DIR` to their volume."*
- same, B: *"keep your literal ruling, so only a file that declares the schema may create the database. Other modules
  then open it once it exists, rather than at load time. That way the answer doesn't depend on which files are in the
  build."*
- Direction of change (R4-1): NEWLY-REJECTING at runtime. An owning handle whose recorded path is absolute and lies
  outside SCRML_DATA_DIR, with SCRML_DATA_DIR set and the file missing, now REFUSES to create (previously created at
  the build machine's absolute path). Reading: the ruling says the deploy adapters point SCRML_DATA_DIR at the volume
  so databases live there; creating one outside it in a deployed server contradicts the ruling's intent, and the
  data root "does not move" an absolute path (§47.14), so the only fail-closed option is refusal.

## 2026-10-01 10:18 — R4-1 reproduced on the merged, unfixed branch (fbe0fb85f)
Project: scratchpad/r41/proj (scrml.toml at proj/), src/app.scrml = examples/09 with
`<program db="../../shared/app.db">` (owning: CREATE TABLE IF NOT EXISTS contact_messages).
```
$ cd r41/proj && bun <wt>/compiler/bin/scrml.js build src --target docker -o r41/proj/dist
  -> no warning about the outside-root db
$ grep _scrml_sqlite_owned dist/app.server.js
const _scrml_sql = new SQL(_scrml_sqlite_owned("/tmp/.../r41/shared/app.db", "../../shared/app.db", "app.scrml"));
$ cd dist && SCRML_DATA_DIR=r41/data PORT=38471 bun _server.js
scrml: created new database /tmp/.../r41/shared/app.db (declared as "../../shared/app.db" in app.scrml)
scrml server listening on http://localhost:38471
$ ls r41/shared  -> app.db (4096 bytes)       $ ls r41/data -> (empty)
```
Confirmed: SCRML_DATA_DIR is ignored and the owning handle creates at the build machine's absolute path.
