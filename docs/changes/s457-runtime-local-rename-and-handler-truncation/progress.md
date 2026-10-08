# progress — s457-runtime-local-rename-and-handler-truncation

Append-only. Times are local (2026-10-07).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa75c1cfe28dfa585`, base `b6a6b64f0` = origin/main.
- bun install + pretest OK; brief committed as the first WIP commit.

## item 1 — user `function id` kills click dispatch
- REPRODUCED on b6a6b64f0: `if (id && _scrml_click[_scrml_id_3])`, exit 0.
- Root: `emit-client.ts` `post-fn-name-mangle` — a scope-blind regex over the whole client buffer.
- Corpus sweep (2392 sources / 1538 client outputs): the regex could hit well over 100 distinct
  compiler-emitted local names (`el` 601 files, `event` 500, `root` 547, `id` 120, `t`, `i`, `item`,
  `key`, `d`, `e`, `value`, `body`, `path`, `match`, ...), plus host globals (`document`, `String`,
  `fetch`, `setTimeout`, ...). Renaming the locals one by one would be unfinishable and would leave
  the user's own locals/params exposed (the same class as g-lambda-param-renamed-to-fetch-stub and
  g-mangler-scope-blind-shorthand-key-rename).
- Fix (structural): NEW `codegen/fn-name-rename.ts` — Acorn parse + scope analysis; rename ONLY a
  reference no enclosing scope binds, in the SAME syntactic positions the regex used. Regex kept
  only for a segment that does not parse (42 of the corpus's client outputs, all already-invalid JS).
- Corpus differential (2445 sources, client+server+html+diagnostic codes): exactly ONE output
  changed — `conformance/cases/error/handler-failable-reference-exempt-neg` — where an
  `<each as risky>` row binding shadows `function risky`; the old output renamed the row PARAMETER
  (leaving `risky?.id` dangling) — the new output is the lexically-correct one.
- mangler-region-fencing §2d/§2e/§2f pinned the old pass's KNOWN-BROKEN residuals; all now correct
  (executed) — tests updated to assert the correct answers.

## item 1b — capture (the reverse direction), found while verifying
- A compiler binding that ENCLOSES user text captures a same-named user function (e.g. user
  `function el` used in a display: `_scrml_render_value(el, el(...))`). Pre-existing (the regex
  output was broken there too, differently). Static enumeration over the corpus found the
  enclosing compiler bindings: `el`, `root`, `_items`, `_mount`, `_itemFrag`, `_eb_result`,
  `_eb_render_*`, `_root`, `_disposers`, `_update_chain_*`, `_next`, `_stateData`, `_msgData`,
  `fromVariant`, `toVariant` — and `event` (the handler wrapper parameter; see NOTES — SPEC question).

## item 1 landed — adf8d5464 (scope-aware rename + tests)
- note: the new happy-dom test must unregister in afterAll (happy-dom replaces Request/Response/
  fetch; s454-handled-sql-expression-positions' server routes 403'd in the same process otherwise).

## item 1b — capture hygiene (partial, measured)
- Emitted enclosing bindings renamed into the reserved namespace: `el`->`_scrml_el`,
  `root`->`_scrml_root` (display/rewire/bind-rewire), each `_items/_mount/_itemFrag`->
  `_scrml_items/_scrml_mount/_scrml_item_frag`, nested each fn `_root`->`_scrml_each_root`,
  error boundary `_eb_result/_eb_render_*`->`_scrml_eb_*`, if-chain `_next/_update_chain_*`->
  `_scrml_next/_scrml_update_chain_*`, engine `_stateData/_msgData/fromVariant/toVariant`->
  `_scrml_state_data/_scrml_msg_data/_scrml_from/_scrml_to`; variant-guard arm/dispatcher
  internals now ALWAYS `_scrml_arm`-prefixed (was: only on an arm-param collision).
- Corpus differential vs the item-1 snapshot: 7764 changed artifacts, ALL identical after mapping
  the renames back; diagnostics identical (INDEX.tsv byte-equal).
- Widened capture oracle (cell-read markers) shows the RESIDUAL: ~30 more enclosing compiler
  bindings (`_fire`, `_eager`, `value`, `errors`, `src`, `parts`, `_branch`, `error`, `_d`, `_args`,
  `_seq`, `_res`, `_v`, `_hv`, `_rt`, `__v`, `__prev`, `__next`, `__scrml_engine_from`,
  `__scrml_derived_v`, `messageForFn_*`, `renderOne_*`, `render_*`, `_emptyFrag`, `evt`, ...) across
  many emitters. NOT closed here — filed as a residual gap (see final report).
- `event` (handler wrapper param) deliberately NOT renamed: SPEC question (see report).

## item 1b landed — 0c84f5038

## item 2 — unquoted handler call chain
- REPRODUCED: `onclick=Promise.resolve(5).then(function (v) { @msg = "x" })` -> handler
  `Promise.resolve(5);`, `then function v @msg="x"` leaked onto the <button>, exit 0.
- Governing-sentence gate (SPEC §5.2.3): table row "Bare single-expression ... One expression —
  calls, assignments, compound updates, method invocations"; "A BARE (unbraced) event-handler value
  SHALL contain exactly one scrml expression"; "its extent is found by scanning forward, and an
  attribute boundary is whitespace at depth 0". => LEGAL; must compile whole.
- Fix: tokenizer.ts — after an unquoted handler value's identifier or call, an immediately-adjacent
  postfix continuation (`.name`, `?.`, `[`, `(`) extends the value to the §5.2.3 boundary as ONE
  ATTR_EXPR; a trailing bare assignment continues through the existing reader (`@list[0] = 5`).
- Corpus differential: ZERO changed artifacts (no corpus source uses the shape).
- The same truncation class OUTSIDE handlers is NOT changed here (SPEC does not state it): see the
  report — `title=fmt(1).trim()`, `if=fn().ok` (drops the condition!), `onclick=fn() .then(g)`.

## item 2 landed — f47219d32
- Full gate at f47219d32 (pre-commit hook): 32097 tests / 1480 files, 0 fail. `bun conformance/run.ts`:
  1342 pass + 50 xfail of 1392.
- Verified closed on their OWN repros: g-lambda-param-renamed-to-fetch-stub (pre-fix emitter renames
  the param; post-fix `(total) => total * 2`), g-mangler-scope-blind-shorthand-key-rename residuals
  (nested / spread / mixed / ternary-alternate / interpolation-leading / `?? {get, post}` /
  shadowing destructure — all correct).
- Verified STILL OPEN (pre-existing, filed in the report): a user function named after a host
  global the emitted code uses (`document`, `fetch`, `String`, `setTimeout`, ...) — e.g. a user
  `function fetch` hijacks `_scrml_fetch_with_csrf_retry`'s `fetch(path, …)` → every server call.
