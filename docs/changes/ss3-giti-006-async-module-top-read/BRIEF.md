# BRIEF — ss3 item7 `giti-006-async-reactive-module-top-read`

**Dispatched by:** sPA ss3 · **Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Land target:** agent commits on its own worktree branch; sPA file-deltas onto `spa/ss3`.
**Base:** branched off `spa/ss3` (carries ss3 item2's ordered-map codegen change in emit-expr.ts/emit-logic.ts/reactive-deps.ts — leave those intact; this fix is in a DIFFERENT region).

## The bug (R26-reproduced on real source)

A markup `${@var.path}` interpolation emits a **spurious module-top bare statement read** of the path,
IN ADDITION to the correct render-effect wiring. The module-top statement is dead code (its value is
unused) but it EXECUTES the path access at module-init time. For an async-initialized reactive
(`<data> = serverFn()`, whose cell holds the `null` placeholder until the fetch resolves) the module-top
`null.path` **THROWS at init, before the fetch resolves** — crashing the page. Documented workaround:
`@data default`.

### Reproduction (sync — isolates the spurious statement)
```
${ <data>: { name: string, role: string } = { name: "Ada", role: "eng" } }
<div><p>${@data.name}</p></div>
```
Emitted `*.client.js` (the bug is line 3 below — a module-top bare statement, redundant with the
DOMContentLoaded render-effect):
```
_scrml_reactive_set("data", _scrml_deep_reactive({name:"Ada",role:"eng"}));
_scrml_init_set("data", () => ({name:"Ada",role:"eng"}));
_scrml_reactive_get("data").name;          // <-- SPURIOUS module-top bare statement (dead; throws on async-null)
...
document.addEventListener('DOMContentLoaded', function() {
  ... _scrml_render_value(el, _scrml_reactive_get("data").name);
      _scrml_effect(function(){ _scrml_render_value(el, _scrml_reactive_get("data").name); });
});
```
The render-effect (inside DOMContentLoaded) is the CORRECT rendering. The top-level bare statement is
redundant and harmful.

## Root hypothesis + fix

A markup-CHILD interpolation bare-expr (`<p>${@data.name}</p>`) is being **double-emitted**: once as a
module-top logic STATEMENT (the spurious line) AND once as render wiring (correct). The fix: SUPPRESS the
module-top statement emission for a bare-expr that is a render-consumed markup interpolation — the render
wiring (emit-html / emit-bindings) is the sole correct consumer.

**Pinpoint the emission site** (the codegen-internals work): find where the module-top bare statement for
a markup-nested interpolation is emitted (start in `emit-logic.ts` — the module-top bare-expr / logic
statement emission; cross-check `emit-html.ts` / `emit-bindings.ts` for the render path; `emit-expr.ts`
:449-ish only builds the read string `_scrml_reactive_get("data").name`, it is not the statement emitter).
Determine WHY the markup interpolation reaches the module-top statement path and gate it off.

**CRITICAL guard (do NOT over-suppress):** a GENUINE top-level logic bare-expr with side effects
(`${ doSomething() }` at file root, NOT inside markup) MUST still emit its module-top statement. Only a
bare-expr that is a markup-interpolation child consumed by render wiring should be suppressed. The
distinguisher is the bare-expr's structural role (markup-interpolation child vs top-level/logic-block
statement), not the expression shape. If you cannot cleanly distinguish them, STOP and report — do not
guess (silently dropping a real logic statement is worse than the bug).

## Verify (R26 — empirical)
- The sync reproducer: the module-top bare statement `_scrml_reactive_get("data").name;` is GONE; the
  render-effect remains; `node --check` clean; the `<p>` still renders the value.
- Async reproducer (a server-fn-initialized reactive read via `${@data.path}` in markup): no module-top
  throw — confirm no top-level `_scrml_reactive_get("data").<path>;` bare statement is emitted.
- Negative (must STAY): a genuine top-level `${ sideEffectFn() }` (NOT in markup) still emits its
  module-top call statement; reactivity of the markup interpolation still works (edit a cell → re-render).
- Full `bun run test` (incl. browser) GREEN. Report before/after counts; explain any changed test outcome
  before declaring done.

## Mandatory dispatch blocks

**F4 startup-verification (FIRST):** `pwd` + `git rev-parse --abbrev-ref HEAD` — confirm YOUR isolated
worktree, NOT main, NOT `../scrml-spa-ss3`. If `node_modules` absent:
`ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` +
`ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`.

**Path discipline (S88/S99/S126):** worktree-absolute paths only; NEVER a main path; NEVER `cd` into
main. `git status` after each step. You are based off `spa/ss3` — leave item2's ordered-map changes intact.

**Commit discipline (S83/S113/S164):** fix + test = ONE commit. WIP commits expected. `git status` clean
before DONE. NEVER `--no-verify`. Append timestamped lines to
`docs/changes/ss3-giti-006-async-module-top-read/progress.md`. Report branch + final SHA + changed files.

**Scope guard:** codegen subsystem only (emit-logic / emit-html / emit-bindings, possibly emit-expr).
Do NOT touch the runtime or parser. If the fix wants to spill outside codegen, STOP and report.
