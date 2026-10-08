# progress — s457-unquoted-values-and-event

Append-only. Times local (2026-10-07/08).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1d9d34bac78c568c`, base `0c1a1b081` = origin/main (#1345 merged).
- bun install + pretest OK (samples/compilation-tests/dist populated). Brief archived as first commit 48ae2d61a.
- Frozen base copy for differentials: `.tmp/base` (git archive HEAD); corpus capture via `scripts/corpus-emit-differential.ts`.

## repro on base (0c1a1b081)
- `onclick=@count = @count + 1` -> `_scrml_cs_reactive_set("count", _scrml_cs_reactive_get("count"))`, exit 0 (the `+ 1` dropped).
- `if=fn(1).ok` -> E-CODEGEN-INVALID-LOGIC (`if ((function(1)))`) — loud, but the condition is lost.
- `title=fmt(1).trim()` -> `title=fmt(1)` wired as a "title" EVENT LISTENER + a stray `trim` attribute, exit 0.
- `onclick=fn(1) .then(g)` -> handler `fn(1)` + stray `then g` attributes, exit 0.
- `onclick=@big = @n > 1` -> handler `big = n`, ` 1>` leaks into the body text, exit 0.
- `title=@msg + "x"` -> `<p title="msg" x>`, exit 0.
- `oninput=f(event.target.value)` / `onclick={ f(event.type) }` / `onclick=${ f(event.type) }` -> all wrapped `function(event) { … event … }`.
- call-ref ARGS are never scope-checked (`onclick=f(nope)` compiles clean) — pre-existing, noted.
- #1345 did NOT rename the handler wrapper parameter (`function(event)` at every site).

## implementation (WIP, uncommitted until the gate is green)
- tokenizer.ts: ONE unquoted-value reader (head -> postfix chain -> continuation/refusal) replacing the
  separate `!`, `(…)`, `[…]`, ident/call/not/assignment/condition-reject branches; #1345's
  readBareValueTail folded in (its postfix predicate kept). New refusal reasons on ATTR_OP_REJECT:
  operator (non-handler), stray (text that cannot begin an attribute), gt (handler expression before
  a spaced `>`). `derived=` (§51.0.J) left exactly as before.
- ast-builder.js: ATTR_OP_REJECT messages per reason/attr class; `;` after a non-handler bare value ->
  E-ATTR-MULTI-STATEMENT (§5.2.4 listed it as not-yet-detected); E-ATTR-UNQUOTED-OPERATOR added to
  SUBPARSE_FORWARDED_CODES (else an <each>/engine/match refusal would silently drop the attribute).
  Arrow-handler prelude `const p = event` -> `const p = _scrml_event` (also for p === "event").
- validators/reserved-prefix.ts: the prelude's INIT exempt (compiler text), binder still checked.
- type-system.ts: E-EVENT-UNBOUND (findUnboundHandlerEventRef + checkHandlerEventBinding); the two
  handler-scope `event` binds removed.
- codegen: wrapper parameter `event` -> `_scrml_event` in emit-event-wiring / emit-variant-guard /
  emit-lift / emit-each (33 lines; dispatcher + worker/message listeners untouched — no user text).
- component-expander.ts: the S440 N4 `event`-prop shadowing removed (a prop `event` is now substituted).
- DECISION (implementation reading, flagged): the non-function `${…}` handler value is included in
  E-EVENT-UNBOUND (same compiler-written listener; §5.2.1 already says the event needs `${(e) => …}`).
- DECISION: an operator after a NON-handler unquoted value is REFUSED (cluster-A widened), not read
  whole (§5.1's three forms); spaced `>` refused only after a handler EXPRESSION (`serve=7878 >` is fine).

## corpus measurement (by compile: scripts/corpus-emit-differential.ts, 2425 sources, base 0c1a1b081 vs head-wip1)
- E-EVENT-UNBOUND: 24 files / 35 sites — samples 6 files / 18 sites + examples/23-trucking-dispatch
  components 2 files / 4 sites (both already fail standalone with E-CODEGEN-INVALID-LOGIC, so the compile
  diff did not show them; found by grep) = 22 adopter-corpus sites (matches the brief's 22) + 18 conformance
  cases (the s441 E-EVENT-CONTROL-AFTER-AWAIT vehicles, all `${ …; event… }` statement lists).
- E-ATTR-UNQUOTED-OPERATOR new in 2 already-failing files: nested-comments.scrml (`class:active=@x == y`
  inside a component body — was silently truncated), multi-stmt-handler-in-each-row-pos (cascade on the
  E-MULTI tail — FIXED: the tail after a handler `;` is no longer re-refused).
- ok->fail: 5 (2 conformance pos cases + 3 samples), all E-EVENT-UNBOUND, all migrated.
- Lift markup: TS never visited lifted handlers -> E-EVENT-UNBOUND added for lift-expr (structured +
  string-fallback `{ … }` value).
- migration: 22 adopter sites -> `${(e) => …}` (brief recipe); 18 conformance cases -> `${(event) => { … }}`
  (keeps each case's body byte-identical; description note appended).

## gates before commit 1
- unit+integration+conformance: 30029 pass / 1 fail (semdiff fixture used Angular `(click)={…}` junk —
  now refused; fixture fixed to `onclick={…}`) -> 0 fail after the fix.
- conformance/run.ts: 1354/1404 pass + 50 xfail (8 new s457 cases pass, 4 with runtime).
- types:check OK; SPEC-INDEX + FACTS regenerated (scripts).
