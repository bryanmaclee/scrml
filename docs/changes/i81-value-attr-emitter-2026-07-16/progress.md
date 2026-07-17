# progress — i81 value-attr emitter (append-only, timestamped)

## 2026-07-16 — startup gate + repro

**Gate (F4).** Worktree toplevel / branch `fix/i81-value-attr-emitter` / base `caf50487` / clean tree:
ALL PASS. **`pwd` check does NOT pass**: the harness sets agent cwd to the MAIN checkout
(`/c/Users/poliv/Documents/GitHub/scrml`) and resets it between bash calls; the agent cannot change its
session cwd. Since the brief itself states auto-`isolation:"worktree"` has been broken since S258 (and
pre-made this worktree for that reason), the literal `pwd` gate is unsatisfiable in this harness. Intent of
the gate (am I editing the wrong tree?) is covered by the toplevel/branch/SHA/clean checks. Proceeding under
the brief's mandated compensating discipline: worktree-ABSOLUTE paths, `git -C`, `bun --cwd=`, never `cd`
into the main checkout. FLAGGED in the report rather than silently swallowed.

**MAPS first-read.** `.claude/maps/primary.map.md` read in full. **`§"Task-Shape Routing"` DOES NOT EXIST** —
`grep -rn "Task-Shape Routing" .claude/maps/` returns nothing across the whole maps dir. The brief's required
routing step is unfollowable as written. Fell back to the map's `## File Routing` table (the closest real
section). Map currency claim CONFIRMED independently: none of the 3 target files moved since stamp
`f079d0a9`. **Map verdict for this task: NOT load-bearing.** It is a project-level index (fingerprint, entry
points, CI model); it carries nothing about attribute emission or the emit-html dispatch chain. The
diagnosis came from source, not the map.

**Diagnosis CONFIRMED at source**, not taken on trust. `emit-html.ts` `val.kind === "expr"` chain:
if/show (2388) → `on*` (2404) → `REACTIVE_BOOL_ATTRS` (2418) → **`}` at 2440 with NO final `else`.**
`REACTIVE_BOOL_ATTRS` (emit-html.ts:50) = `{disabled, readonly, required}`.

**Repro on `caf50487` (clean compile, 0 errors, 2 unrelated warnings):**
- `class=(@mode == "a" ? "tab on" : "tab")` + `onclick=pick()` → `<button data-scrml-bind-onclick="...">` — class GONE
- `style=("color: " + @label)` → `<div>` — GONE
- `title=(@label)` → `<span>` — GONE
- `data-mode=(@mode)` → `<div>` — GONE
- `disabled=(@mode == "a")` → `data-scrml-bind-bool-disabled` — wired (control)
- `class="static"` → unchanged (control)

**DIVERGENCE FROM BRIEF (found in repro, report it).** The brief says `title=`/`data-mode=` are "likewise"
dropped. That is true ONLY for the paren/`${}` (`val.kind === "expr"`) shape. The BARE `@ref` shape
(`title=@label`, `data-mode=@mode`) is `val.kind === "variable-ref"` and hits the "General attribute"
fallback at emit-html.ts:2381-2386, which emits the LITERAL IDENTIFIER TEXT: `title="label"`, not the value
"hi", and non-reactive. So that shape is NOT dropped — it is silently WRONG (arguably worse: it looks
plausible in the HTML). Separate code path, separate defect. **OUT OF SCOPE per the brief** (which scopes me
to the `expr` chain's missing final `else`). Recorded for the PA as a candidate follow-up issue; NOT fixed
here.

Next: implement the value-attr emitter across the 3 touchpoints, mirroring the bool path.
