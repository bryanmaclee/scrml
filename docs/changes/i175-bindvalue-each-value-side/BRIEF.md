# BRIEF — #175: complete `bind:value` value-side inside `<each>` (Half-2, shared-cell scope)

**Change-id:** `i175-bindvalue-each-value-side`
**Dispatched:** S286 (Peter/AdiPDesk), fallback agent `general-purpose` (canonical `scrml-js-codegen-engineer` absent on this machine), `isolation: "worktree"`, model opus.
**Adopter issue:** GH #175 (`pjoliver11`). Confirmed on HEAD `cd65898` (reverse verify-before-claim done PA-side).

## The bug (confirmed)
`bind:value=@cell` on an `<input>` inside `<each>` emits ONLY the `oninput` write-back handler; the
reactive **value side** (DOM reflects `@cell`) is dropped with a silent JS comment. Two-way → one-way
inside a list. Locus: `compiler/src/codegen/emit-each.ts:1530-1535` — the block that no-ops every
`bind:`/`ref`/`transition:`/`in:`/`out:` per-item directive as "Landing 2 scope".

## Governing sentence (SPEC §5.4, Rule-4 gate PASSED — quote it in your commit)
> "A `bind:` prefix on an attribute creates a two-way binding… The compiler SHALL generate both (a)
> the value/checked attribute wired to the reactive variable and (b) the corresponding
> `oninput`/`onchange` handler… `bind:value=@var` SHALL be valid on `<input>`, `<textarea>`, and
> `<select>` elements."

There is **NO `<each>`/list carve-out** in §5.4. The current drop is an **implementation defect**;
this is **conformance restoration** (a bug fix), NOT a language change. Class: semantics-changed
toward the contract.

## Scope — READ CAREFULLY (this is scoped, not the whole surface)
**IN scope — wire the value side for OUTER/shared reactive-cell targets** (`bind:value=@msg`,
`bind:checked=@flag`, `bind:selected`, `bind:group` — whatever `emitBindDirectiveBody` already
handles), where the bind RHS root is a **top-level reactive cell** (NOT the iteration item).

**OUT of scope — DEFER LOUDLY:** when the bind RHS is **rooted in the iteration item**
(`bind:value=@.field`, or `bind:value=@<iterVar>.field` where the root is the `<each>` iter var), do
NOT wire it — but replace the current SILENT JS comment with a **Warning-level compiler diagnostic**:
new code **`W-EACH-BIND-ITEM-FIELD-DEFERRED`** (add its §34 catalog row alongside the impl per
named-codes-land-with-impl; message: per-item-field two-way binding inside `<each>` is not yet wired
— recommend an `oninput` handler that deep-sets the item, or bind to an outer cell). Item-field
write-back needs live-keyed deep-set-into-reconciled-item and is a separate landing. Silent is the
sin; make it loud.

**Leave `ref=`/`transition:`/`in:`/`out:` deferred exactly as they are today** (their silent comment
is fine — only `bind:` is being carved out of the deferral block this landing).

## Fix shape — REUSE the Half-1 plumbing (do NOT re-derive)
S216 (`f4bef40f`) extracted a **root-agnostic** `emitBindDirectiveBody(bAttr, mkNode, opts)` in
`compiler/src/codegen/emit-bindings.ts:501`. Its element-acquisition (`opts.acquire`) and
effect-disposal (`opts.wrapEffect`) are parameterized precisely so a new caller reuses ALL the
bind:value special cases (enum-`<select>` coercion, numeric coercion, §53.7 predicated write-gating,
etc.) for free.

**Pattern-to-mirror:** `compiler/src/codegen/emit-variant-guard.ts:700-740` — the match-arm/engine
Half-1 caller. It dynamic-imports `emitBindDirectiveBody` and passes a `_root`-rooted `acquire` +
per-render `bindIdOverride`. Study it, then write the `<each>` analog:
- **`acquire`**: the each per-item path already holds a DIRECT element local (`elVar`, e.g.
  `_scrml_el_2`) — so `acquire` can return `elVar` directly (no `querySelector` / no `data-scrml-bind-*`
  round-trip needed; simpler than the match-arm path). Confirm this against the actual per-item attr
  emitter (the function containing emit-each.ts:1530).
- **`wrapEffect`**: the value side must be a REACTIVE effect (so a programmatic write to `@cell`
  reflects to the DOM per §5.4's last normative bullet), living + disposing with the item across
  reconcile. Use the each per-item effect/dispose machinery — see `maybeWrapEachPerItemEffect`
  (emit-each.ts:1919) and the `_disposers`/reconcile lifecycle. For an OUTER cell the effect subscribes
  to that cell (not iter-var-keyed); ensure it is torn down when the item unmounts (no effect leak on
  list shrink).
- **write-back handler**: the `oninput`/`onchange` side — reuse what `emitBindDirectiveBody` emits;
  for an outer-cell target it does NOT read the iter var, so no live-keying prelude is needed. (If the
  helper's handler path needs the same `elVar`-direct acquire, thread it through `acquire`.)

## Reconcile-lifecycle correctness (the reason each was deferred — get this right)
`_scrml_reconcile_list` REUSES DOM nodes on same-key reconcile. The value-side effect + write-back must
survive node reuse and be disposed on node removal. Verify: (1) no duplicate effect/listener on
re-render; (2) no effect leak when the list shrinks; (3) the input reflects a programmatic `@cell`
write; (4) top-level / match-arm / engine bind:value paths stay BYTE-IDENTICAL (you added a caller,
you did not change the shared helper's default-opts output).

## Empirical verification — Phase 3 (DO NOT mark DONE without this)
1. Recompile the adopter repro on your post-fix baseline:
   `bun compiler/bin/scrml.js compile <repro> --output-dir <tmp>` where `<repro>` is:
   ```scrml
   <program>
     <msg> = ""
     <items> = [{ id: 1 }, { id: 2 }]
     function setMsg(e) { @msg = e.target.value }
     <div>
       <each in=@items as it key=it.id>
         <input type="text" bind:value=@msg oninput=setMsg(event)/>
       </each>
     </div>
   </program>
   ```
   **Symptom-gone grep (NOT "tests pass"):** the emitted `reproB.client.js` per-item factory MUST now
   contain a reactive value-side wiring for the input (an effect that reads `_scrml_reactive_get("msg")`
   and sets the element's `.value`), and MUST NOT contain the
   `bind:value" deferred (Landing 2 scope` comment for this input.
2. **Executed-DOM (two-way):** in happy-dom (or node), execute the bundle and assert BOTH directions —
   a programmatic `@msg` write updates the input `.value`, AND an input event updates `@msg`.
3. Add a per-item-field repro (`bind:value=@.someField`) and assert it now emits the NEW
   `W-EACH-BIND-ITEM-FIELD-DEFERRED` Warning (loud), not the silent comment.

## Tests to add
- Unit (emit-shape): each-block bind:value outer-cell → value-side wiring present; item-field →
  W-EACH-BIND-ITEM-FIELD-DEFERRED. Top-level/match-arm byte-identical guard.
- Browser/happy-dom: two-way canary inside `<each>` (programmatic write ↔ input event), + disposal on
  list-shrink (no leak).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (worktree isolation)
1. FIRST action: `pwd` — it MUST start with
   `C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-` (or the OS-native form). If it does
   NOT, STOP and report — do not write anything.
2. `git rev-parse --show-toplevel` MUST equal your worktree root. Confirm a clean tree.
3. `bun install` (worktrees do NOT inherit `node_modules`) then `bun run pretest` (populates gitignored
   browser-test fixtures). Use `bun run test` (chains pretest) for baselines, not bare `bun test`.
4. Every Read/Write/Edit uses a worktree-ABSOLUTE path. NEVER `cd` into the main checkout; use
   `--cwd "$WORKTREE_ROOT"` for bun and worktree-absolute paths for git. Prefer editing via Bash on
   absolute paths (echo before, `git diff` after).
5. Baseline the pre-commit subset (`bun test compiler/tests/{unit,integration,conformance} --bail`)
   BEFORE and AFTER your change; record both counts.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first; follow its Task-Shape Routing for codegen/emit work. It is
stamped a few commits behind HEAD — treat map content as a verify-against-source hypothesis; report
whether it was load-bearing (including "not load-bearing").

## Crash-recovery
Commit after EACH meaningful unit (WIP commits expected). Maintain an append-only
`docs/changes/i175-bindvalue-each-value-side/progress.md` (timestamped: done / next / blockers). A clean
`git status` before reporting DONE is mandatory — "work in the worktree, no commits" is not an
acceptable terminal report. Report: worktree path, final SHA, files-touched, before/after test counts,
the two empirical greps, deferred items.
