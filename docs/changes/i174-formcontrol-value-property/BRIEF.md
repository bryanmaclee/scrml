# BRIEF — #174: reactive form-control `value=` must set the `.value` PROPERTY, not `setAttribute`

**Change-id:** `i174-formcontrol-value-property`
**Sequencing:** fires AFTER #175 (`i175-bindvalue-each-value-side`) merges to main. Branch off the
POST-#175 HEAD (fresh base). Fallback agent `general-purpose` (canonical `scrml-js-codegen-engineer`
absent on this machine), `isolation: "worktree"`, model opus.
**Adopter issue:** GH #174 (`pjoliver11`). Confirmed + root-caused PA-side on HEAD `cd65898`.

## The bug (confirmed)
A reactive `value="${@cell}"` (or `value=(expr)`) on a form control lowers to
`setAttribute("value", …)` inside a `_scrml_effect`:
```js
// template-attr value="${@name}"
_scrml_effect(() => { _scrml_tpl_elem_input_3.setAttribute("value", `${_scrml_reactive_get("name")}`); });
```
`setAttribute("value", …)` sets the HTML *attribute* (the control's default value), NOT the DOM
`.value` *property*. Once the user types, the property diverges; a programmatic `@name = ""` re-runs
`setAttribute` but the visible field never clears/updates. Silent (clean compile). Locus: the reactive
template-attr emission path in `compiler/src/codegen/emit-html.ts` (the `// template-attr value=…`
emitter — grep the comment string).

## Governing sentence (SPEC §5.5.4, Rule-4 gate PASSED — quote in commit)
> §5.5.4 (normative): "…each the exclusive owner of its physical DOM surface: `style=(expression)` …,
> **`value=(expression)` on a form control (the `.value` property**; conflicts with `bind:value`)…"

Reinforced by the boolean-attr precedent (§5, lines 1521-1522, normative):
> "…the compiler SHALL emit a property assignment (`element.disabled = submitting`) rather than a
> `setAttribute` call. Emitting `setAttribute(…)` for a boolean attribute SHALL be a compiler defect."

There is NO ambiguity: a reactive `value=` on a form control targets the `.value` PROPERTY. The
current `setAttribute` emission is an implementation defect (the boolean-attr rule, one family over).
Class: **semantics-changed toward the contract** (conformance restoration, a bug fix — recoverable;
nobody depends on an un-clearable field).

## Scope
- **Fix:** for the form-control reactive value family — `value` on `<input>`/`<textarea>`/`<select>`,
  and `checked`/`selected` where property-backed — emit a **property assignment**
  (`el.value = …` / `el.checked = …` / `el.selected = …`) inside the reactive effect, NOT
  `setAttribute`. Cover BOTH syntactic forms the SPEC's semantic surface subsumes: the template-string
  form `value="${@cell}"` (what the adopter hit) AND the parens form `value=(expr)`.
- **Non-form-control / generic attrs** (`title=`, `id=`, `alt=`, `data-*`, `class=`, `style=`) — UNCHANGED
  (`setAttribute`/`className`/`style` as today). This is form-control value-family ONLY.
- **Writer-ownership:** the property-assignment fix MUST still register as a wholesale writer in
  `analyzeWriterConflict` — a `value=(expr)` + `bind:value` on the same element MUST still fire
  `E-ATTR-WRITER-CONFLICT` (§5.5.4 Axiom ①). Verify the fix does not bypass that arbitration.
- Determine whether the `<each>`/loop-context value= path (emit-each.ts) has the same setAttribute bug;
  if so, note it — but the PRIMARY locus is the top-level/static-HTML emit-html.ts path (the repro is
  outside `<each>`). If the loop path needs the same fix, do it OR defer-and-name in a gap, not silent.

## Empirical verification — Phase 3 (DO NOT mark DONE without this)
1. Recompile the repro on your post-fix baseline; grep the emitted client.js: the effect MUST now emit
   `<elem>.value = …` (property), and MUST NOT emit `setAttribute("value", …)` for the form control.
   Repro:
   ```scrml
   <program>
     <name> = "alice"
     <div>
       <input type="text" value="${@name}"/>
       <button onclick=${@name = ""}>Clear</button>
     </div>
   </program>
   ```
2. **Executed-DOM:** in happy-dom, mount, simulate a user type into the input (set `.value` + dispatch
   input), THEN run the clear handler (`@name = ""`) and assert the input's `.value` is now `""`
   (the exact adopter symptom: clear works after user input).
3. Confirm `value=(expr)` + `bind:value` on one element still fires E-ATTR-WRITER-CONFLICT (no regression).

## Tests to add
- Unit (emit-shape): form-control `value="${@c}"` → `.value =` property assignment (not setAttribute);
  generic attr (`title="${@c}"`) → unchanged setAttribute; checked/selected property forms.
- Browser/happy-dom: type-then-clear canary (the adopter symptom); E-ATTR-WRITER-CONFLICT unaffected.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (worktree isolation)
1. FIRST: `pwd` MUST start with `C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-`. If
   not, STOP. `git rev-parse --show-toplevel` == worktree root; clean tree.
2. `bun install` + `bun run pretest`. Worktree-absolute paths for every write; never `cd` into main;
   `--cwd "$WORKTREE_ROOT"` for bun, worktree-absolute for git.
3. Baseline `bun test compiler/tests/{unit,integration,conformance} --bail` before AND after; record counts.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first; follow Task-Shape Routing for codegen/emit-html work. Stamped
a few commits behind HEAD — verify map claims against source; report load-bearing (incl. "not").

## Crash-recovery
Commit after each meaningful unit (WIP fine). Append-only
`docs/changes/i174-formcontrol-value-property/progress.md` (timestamped). Clean `git status` before DONE.
Report: worktree path · final SHA · files-touched · before/after test counts · the property-assignment
grep + executed-DOM clear-after-input result · E-ATTR-WRITER-CONFLICT still-fires check · map
load-bearing? · deferred items.
