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

## 2026-07-16 — implementation (3 touchpoints) + semantics decision

Implemented, mirroring the bool-attr path end-to-end:
- `binding-registry.ts` — `isReactiveValueAttr?: boolean` / `valueAttrName?: string` beside the bool fields.
- `emit-html.ts` — THE MISSING FINAL `else` on the `val.kind === "expr"` chain. Emits
  `data-scrml-bind-attr-<name>="<placeholderId>"` + `addLogicBinding({isReactiveValueAttr, valueAttrName,
  expr, condExpr, condExprNode, refs})`.
- `emit-event-wiring.ts` — type fields + emission gate (`if (b.isReactiveValueAttr) return true;`) +
  the `_scrml_effect` consumer, via the same `pushRebindableSel`/`regionEffectLines` contract as bool.

**Catch-all safety (verified at source, not assumed).** The final `else` is unbounded, so I checked what can
reach it: every special attr family is `continue`d BEFORE the val.kind dispatch — `transition:`/`in:`/`out:`
(2227), `skipDeveloperAttrs` (2233), `bind:` (2235), `class:` (2274), `ref` (2303). Only plain HTML attrs
reach the chain. `if`/`show`/`on*`/bool are peeled by the preceding branches. Catch-all is safe.

**SEMANTIC DECISION — absence-driven, NOT truthiness. Justification:**
Chosen lowering: `{ const v = (expr); if (v === null || v === undefined) removeAttribute(name);
else setAttribute(name, String(v)); }`
- `not` → JS `null` → attribute REMOVED. SPEC §42.9 is explicit: "The `not` literal SHALL compile to the
  JavaScript value `null`". Absence ⇒ no attribute.
- `""` → `setAttribute(name, "")` — an EMPTY attribute, NOT removal.
- `0` → `"0"`, `false` → `"false"`, `[]` → `""`. All SET.
**Why not mirror the bool path's truthiness test** (the "obvious" mirror): SPEC §42.1.1 states `""`, `0`,
`false`, `[]`, `{}` are DEFINED values and that migrating them to `not` "SHALL be considered a SEMANTIC
ERROR". A truthiness test would therefore be spec-VIOLATING — it would silently drop `class=""`,
`data-count=(0)`, `data-open=(false)`. Bool and value are different lowerings precisely here: bool toggles
PRESENCE on truthiness; value sets a STRING and is removed only on ABSENCE. The absence test is the SPEC's
own `is not` lowering, `(x === null || x === undefined)` (§42.9), which matches BOTH null and undefined
because foreign code (`^{}`, `?{}` SQL, server fns) may produce either. This is SPEC-exact, not invented.

**KNOWN DIVERGENCE, reported not hidden.** The two OTHER value-attr paths coerce absence into visible text
rather than removing it — `emit-each.ts:1476-1516` does `setAttribute(name, String(expr))` unconditionally
(`not` → the literal string `"null"`), and the attr-template path `emit-bindings.ts:888-916` interpolates
into a template literal (same). So `class=(not)` will REMOVE the attr outside `<each>` but SET
`class="null"` inside one. My path is the SPEC-correct one; the other two are pre-existing defects. Both are
explicitly OUT OF SCOPE per the brief (do NOT touch emit-each.ts). Flagged as follow-up candidates — I did
NOT paper over the inconsistency by copying their wrong behavior.

Self-inflicted bug found+fixed during impl: `data-*/…` inside a `/** */` block comment terminated the
comment early (`*/`), crashing the compiler parse. Reworded.

Repro POST-FIX: class/style/title/data-mode all now emit `data-scrml-bind-attr-*` + a wired
`_scrml_effect`; `class=`+`onclick=` COEXIST on one element; `disabled=` still bool; `class="static"`
unchanged. Generated `_scrml_v` is block-scoped per binding (no collision), region-tracked for teardown.

Next: regression test matrix + full suite + R26 + blast radius.

## 2026-07-16 — BLAST RADIUS: a 4th touchpoint the brief did not list

The brief specified 3 touchpoints. Probing `<match>` arms found a **4th, and it was a real defect in my
own first cut** — caught by the blast-radius pass, not by the tests I had written at that point.

`emit-variant-guard.ts:425-432` (`wireableLogic`) selects arm-context logic bindings for PER-ARM emission
as reactive TEXT, excluding `isConditionalDisplay` / `isVisibilityToggle` / `isMountToggle` /
`isReactiveBoolAttr` — its own comment states the rule: "see `emit-event-wiring.ts` filter for the
SYMMETRIC rule." A value-attr binding has `kind === undefined`, so with no symmetric exclusion it fell
through to the reactive-text branch and emitted
`_root.querySelector('[data-scrml-logic="_scrml_attr_class_1"]')` — a selector that can NEVER match a
`data-scrml-bind-attr-class` placeholder. A DEAD WIRE. Verified empirically by compiling the same shape
with a bool attr: bool emits ONLY the global wire; mine emitted global + a dead arm wire.

FIX: `if (b.isReactiveValueAttr) return false;` at emit-variant-guard.ts:430, restoring symmetry.
VERIFIED: dead-wire count 0, global-wire count 1 — exact parity with bool. Locked by 2 new tests (§i81.6).

Harmless at runtime (the dead querySelector is `if (el)`-guarded) but it was emitted junk and broke a
documented invariant. Reported because it shows the brief's 3-touchpoint decomposition was INCOMPLETE.

**DONE-PROBE IS BROKEN (brief defect, not a test failure).** The brief's probe
`bun test <file> 2>/dev/null | grep -q "0 fail"` can NEVER pass: `bun test` writes its summary to STDERR,
which `2>/dev/null` discards. Proven with a control — the pre-existing, passing
`reactive-bool-attrs.test.js` fails the same probe. Correct probe: `2>&1 | grep -q "0 fail"`, which PASSES
on my file (24 pass / 0 fail) and on the control. The PA must fix the probe or it will read a green file as red.

Next: full-suite baseline attribution (post-fix run shows 1045 fails — must determine pre-existing vs mine).

## 2026-07-16 — BLAST RADIUS: colon-bearing attr names would CRASH the page (my regression)

Probed odd attribute names (`b3-oddnames.scrml`): `<use xlink:href=(@h)/>`, `<svg viewBox=(@vb)>`,
`<div aria-label=(@h)>`. The catch-all interpolates the attr name RAW into BOTH an HTML attribute key and a
CSS attribute selector:

    querySelector('[data-scrml-bind-attr-xlink:href="_scrml_attr_xlink_href_2"]')

An unescaped `:` in a CSS attribute selector is INVALID (colon = pseudo-class). Verified EMPIRICALLY against
happy-dom (the repo's own DOM, node_modules/happy-dom), not asserted from memory:
- unescaped `[data-scrml-bind-attr-xlink:href="p1"]`  -> **THROWS DOMException**
- escaped   `[data-scrml-bind-attr-xlink\:href="p1"]` -> **ALSO THROWS in happy-dom** (its CSS parser has
  no escape support; real browsers accept it) — so escaping is NOT a viable fix here.
- `[data-scrml-bind-attr-viewBox="p2"]` -> MATCHes (CSS attr-name matching is case-insensitive in HTML), so
  the uppercase/SVG case is fine; `setAttribute` still receives the original-case name, which SVG needs.

**Severity: this is a REGRESSION I introduced.** That `querySelector` runs at module-init top level,
UNGUARDED. An uncaught DOMException halts the whole client bundle init — killing EVERY binding on the page,
not just this one. Pre-fix, `xlink:href=(expr)` was silently DROPPED: bad, but inert. Trading a silent drop
for a total-page crash is strictly worse. A catch-all `else` must not assume the attr name is CSS-safe.

FIX: keep the ORIGINAL name for `setAttribute` (SVG/`xlink:` correctness), but derive a CSS-SAFE key for the
placeholder + selector: `name.replace(/[^A-Za-z0-9_-]/g, "_")` -> `data-scrml-bind-attr-xlink_href`.
Carried as a new `valueAttrKey` binding field computed ONCE in emit-html (single source of truth) rather
than recomputing the regex in emit-event-wiring (which would risk the two drifting apart).
Residual (accepted, documented): two DIFFERENT dynamic attrs on ONE element whose names sanitize to the same
key (e.g. `x:y` and `x_y`) would collide on the duplicate HTML attribute key; the HTML parser keeps the
first, so the second silently does not wire — i.e. it degrades to the pre-fix behavior for a pathological
shape, rather than crashing. Not worth more machinery.
