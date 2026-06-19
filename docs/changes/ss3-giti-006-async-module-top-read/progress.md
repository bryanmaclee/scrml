# progress — ss3 item7 `giti-006-async-reactive-module-top-read`

- 2026-06-19 — F4 verified; created isolated worktree
  `.claude/worktrees/agent-ss3-item7` on fresh branch `ss3-item7-asyncread-fresh`
  at `spa/ss3` tip (631ea548, carries item2/item3/item4). node_modules symlinked.
- 2026-06-19 — R26-reproduced the bug on real source: sync reproducer emitted
  spurious module-top `_scrml_reactive_get("data").name;` bare statement.
- 2026-06-19 — Root cause: the S107/S144 pure-read-orphan suppression regex in
  `emit-reactive-wiring.ts` matched the bare-cell read `_scrml_reactive_get("data")`
  (`${@data}`) but NOT the dotted-path read `_scrml_reactive_get("data").name`
  (`${@data.name}`) — the `_scrml_(reactive|derived)_get` alternative lacked the
  trailing member-access/index chain that the input-state alternative already had.
- 2026-06-19 — Fix: extended the reactive/derived alternative with a member
  (`.path`) + index (`[k]`) trailing chain. Deliberately NO call alternative —
  a trailing method call (`.map(...)`) is a side effect and MUST keep emitting.
  Gating unchanged: pid (markup interpolation) + !groupTildeCtx + bare-expr.
  A genuine top-level `${ fn() }` (no pid) is never suppressed.
- 2026-06-19 — Verified empirically (R26):
  - sync reproducer: spurious file-scope statement GONE; render-effect remains;
    node --check clean.
  - async server-fn reproducer: no module-top `_scrml_reactive_get("data").name;`;
    async fetch + reactive_set preserved; node --check clean.
  - negative: top-level `${ sideEffect() }` STILL emits `_scrml_sideEffect_N();`.
  - guard: method-call `${@items.join(",")}` NOT suppressed.
- 2026-06-19 — Added regression §12 to bug-5-const-interpolation.test.js
  (6 tests). Full file 32/32 pass.
