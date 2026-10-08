# progress — s457-host-global-alias

Append-only. Times local (2026-10-07/08).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ade1ea0d759a13c9d`, base `0c1a1b081` = origin/main (includes #1345).
- bun install + pretest OK; brief committed as first WIP commit (dd3113008).

## reproduction (base 0c1a1b081)
- client: user `function fetch` + any server fn -> `_scrml_fetch_with_csrf_retry` calls `_scrml_fetch_6(path, {...})`
  (the user's function); user `function document` -> click dispatcher `while (t && t !== _scrml_document_7)`,
  `_scrml_nav_rewire(_scrml_document_7)`, `(_scrml_root || _scrml_document_7).querySelector`.
- client, second path (not via the rename): a user top-level `const location = "here"` is emitted as
  `const location = "here";` in the chunk IIFE, so EVERY compiler reference to `location` in that chunk
  (member positions included) reads the user's value.
- server: a server function called by another server function gets an in-process peer callable
  `async function <name>` at MODULE scope -> `server function Response` shadows `Response` for the whole
  bundle (`new Response(...)` on every route). `server function globalThis` is accepted today.

## design
- ONE alias: `const _scrml_g = globalThis;` — compiler references are spelled `_scrml_g.<name>`
  (late-bound property read on the captured global object, so a later polyfill / instrumentation /
  test mock of e.g. `fetch` is still seen exactly as a bare reference sees it; per-name capture at
  load would silently bypass them — semantics change). `_scrml_g` is in the reserved `_scrml_`
  namespace (§47.1.1), so no user binding can declare or reference it.
- Defined: client — top of the runtime core chunk (always included; the runtime is its own classic
  script / ESM module / embedded outside the chunk IIFE, so no user binding reaches it);
  server / library / tool / worker artifacts — a prologue line in each module that uses it.
- The runtime's own text is NOT rewritten: it is outside every scope a user binding is emitted into
  (separate script; embedded runtime sits outside the chunk IIFE; the rename pass fences it).
- Base corpus capture: .tmp/cap-base (2425 sources, 7084 artifacts, 0 syntax-failing).
