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

## 2026-07-16 — colon-crash FIXED + full-suite ATTRIBUTION (pre vs post baseline)

**Colon crash fixed.** New `valueAttrKey` binding field: `name.replace(/[^A-Za-z0-9_-]/g, "_")`, computed
ONCE at the emit-html registration site (so emit-html and emit-event-wiring cannot drift). The placeholder
+ selector use the SAFE KEY; `setAttribute` keeps the ORIGINAL name. Verified:
  <use xlink:href=(@h)/>  -> placeholder data-scrml-bind-attr-xlink_href
                          -> querySelector('[data-scrml-bind-attr-xlink_href="..."]')   (CSS-valid)
                          -> setAttribute("xlink:href", String(v))                       (DOM-correct)
  <svg viewBox=(@vb)>     -> setAttribute("viewBox", ...) — SVG case preserved.
Proven under happy-dom + GlobalRegistrator (the repo's own bootstrap):
  [data-scrml-bind-attr-xlink:href="p"] -> THROWS   (the pre-fix crash shape)
  [data-scrml-bind-attr-xlink_href="p"] -> valid
  [data-scrml-bind-attr-viewBox="p"]    -> valid + MATCHes
Encoded as a STATIC assertion (emitted keys match /^[A-Za-z0-9_-]+$/) rather than a live querySelector:
GlobalRegistrator mutates globalThis and this repo confines that to compiler/tests/browser/; a CI-gate unit
test must not install DOM globals for every other file in the process. Honest limitation: the unit test
guards the emitted SHAPE, and the runtime-throw behaviour was verified by hand (above), not in CI.
NOTE: `new Window()` (without GlobalRegistrator) is UNUSABLE under `bun test` here — happy-dom's
querySelector throws for EVERY selector, even `div`. My first cut of this test used it and produced a
false failure. Anyone adding DOM assertions to a unit test will hit this.

**FULL-SUITE ATTRIBUTION — the brief's "0 failures is the contract" is NOT achievable.**
Ran the FULL suite on BOTH baselines (revert 4 codegen files to caf50487, run, restore — tree verified
clean after):
  pre-fix  (caf50487): 26961 pass / 1061 fail / 213 skip   (28236 tests, 1213 files)
  post-fix (this work): 26979 pass / 1043 fail / 213 skip
  set-diff NEW failures introduced: **0**
  set-diff failures resolved: 18 — ALL of them my own i81 tests (the other 10 are controls that pass on
  both baselines).
So the 1043 remaining are 100% PRE-EXISTING at the stated base commit. Dominant class: 1012x
"M7.3.b.N — within-node parity per-fixture gate" (native-parser parity), plus self-host (needs a locally
built dist — primary.map.md flags exactly this), LSP, browser. The contract that IS met: **0 regressions**.

**CI GATE (the actual merge-blocker per .github/workflows/ci.yml: `bun test compiler/tests/unit
compiler/tests/conformance`)**, also baselined both ways:
  pre-fix  gate: 17425 pass / 1 fail / 47 skip
  post-fix gate: 17449 pass / 1 fail / 47 skip   (+24 = my tests; +4 more since, now 28)
  The 1 fail is `E-TYPE-ANY-FORBIDDEN — positive > struct field ': any' fires` — IDENTICAL on the pre-fix
  baseline with my code fully absent => PRE-EXISTING, not mine. It also PASSES in the full suite and passes
  6/6 in isolation (twice); it fails only in the unit+conformance subset at ~8s. Set-dependent, likely a
  timeout under that composition. Reported, not fixed (out of scope).

## 2026-07-16 — R26 EMPIRICAL: three MORE regressions the green suite missed

R26 (recompile 363 REAL .scrml: 4 gauntlet-r25 dev-* + 32 examples + 30 samples + 297
compilation-tests, PRE-fix vs POST-fix, diff emitted output) earned its keep. At the point I had a
100%-green suite + clean self-review, R26 found THREE real regressions:

1. **snippet-002-parametric.scrml: clean compile -> E-CODEGEN-INVALID-LOGIC.**
   `<List items=@items row={ (item) => <span>${item.id}</span> }/>` — `row=` is a §14.9
   parametric-snippet prop whose value is a lambda returning MARKUP. The catch-all lowered it to
   `const _scrml_v = ((item) => <span>...` — markup spliced into JS. Component expansion runs BEFORE
   codegen and merges call-site props onto the component ROOT, so emit-html sees `tag=div`, not `List`:
   **the tag is useless as a discriminator** (my first guard, `/^[A-Z]/.test(tag)`, did nothing).
2. **dev-1-react/2-elixir/3-svelte: bogus `pick` DOM binding.** `<tableFor pick=[...]>` /
   `<formFor pick=[...]>` are scrml DIRECTIVE elements (§4.13); their attrs are compiler constructs.
3. **27-type-derived-table.scrml: `<input checked=(@a && @b)>` -> `setAttribute("checked","false")`.**
   A boolean attr carries meaning by PRESENCE — that renders PERMANENTLY CHECKED. Strictly worse than
   the pre-i81 drop.

**The brief's core premise is empirically FALSE** and I proved it three ways: "Safe as a catch-all ...
only plain HTML attributes reach here" is wrong. The markup attribute namespace is shared by (a) real
HTML attrs, (b) scrml directive attrs, (c) component call-site props — all reaching the same emitter.

**Final guard (positive / fail-CLOSED):** lower only when
  (resolvedKind === "html-builtin" || resolvedKind == null)
  && _expandedFrom == null && !isUserComponentMarkup(node) && !HTML_BOOLEAN_ATTRS.has(name)

Measured, never assumed: `<button class=(..)>` = "html-builtin"; `<tableFor>`/`<formFor>`/`<use>` =
"unknown"; a `<match>` ARM body = null (so null MUST be admitted — dynamic `class=` in an arm is
idiomatic); an EXPANDED component root is ALSO null and is separable from an arm body ONLY by the
expander's `_expandedFrom` stamp. Fails closed: anything NR did not positively resolve keeps the
pre-i81 drop.

**The CI gate caught an architectural violation of mine.** My first working guard used
`node.isComponent === true` — `p3-follow-no-isComponent-routing.test.js` failed it: `isComponent` is a
DEPRECATED derived backcompat field; NR (Stage 3.05) stamps `resolvedKind`/`resolvedCategory` and
downstream stages must READ those. Reworked onto `resolvedKind` + the sanctioned
`isUserComponentMarkup()` helper. This ALSO deleted a ~50-line hand-rolled `HTML_ELEMENTS` allowlist I
had invented — the NR signal subsumes it. Then the test flagged emit-html.ts again because it greps
TEXT and my COMMENTS said "isComponent" 3x; reworded the prose rather than add the file to the ALLOWED
list with a budget, which would have masked a future REAL routing read in that file.

### R26 RESULT — PASS
  compile parity : 314 ok / 49 failed, failure set IDENTICAL to the pre-fix baseline (0 new)
  output parity  : 313 of 314 emitted outputs BYTE-IDENTICAL
  the 1 delta    : samples/rust-dev-debate-dashboard.scrml — a REAL adopter file where
                   `value=${@newOrderItem}` was SILENTLY DROPPED pre-fix and now binds:
    PRE : <input type="text" placeholder="Item name" data-scrml-bind-oninput="_scrml_attr_oninput_7"
                 data-scrml-bind-bool-disabled="_scrml_attr_disabled_8" />        <-- value= GONE
    POST: <input type="text" placeholder="Item name" data-scrml-bind-oninput="_scrml_attr_oninput_7"
                 data-scrml-bind-attr-value="_scrml_attr_value_8"
                 data-scrml-bind-bool-disabled="_scrml_attr_disabled_9" />        <-- value= BINDS
  static attrs   : byte-identical (type=, placeholder=, class= counts all unchanged)
  removed        : 0 pre-existing bindings lost (bool-disabled 6 pre / 6 post; oninput/onclick/if/show
                   all unchanged). The only other diff is placeholder RENUMBERING
                   (`_scrml_attr_disabled_8` -> `_9`) because new value bindings consume genVar ids —
                   internal ids, matched between HTML and JS, consistently renumbered.

### FINAL NUMBERS (all baselined BOTH ways: revert 4 codegen files to caf50487, run, restore)
  CI GATE (the real merge-blocker, `bun test compiler/tests/unit compiler/tests/conformance`):
    pre-fix : 17425 pass / 1 fail / 47 skip
    post-fix: 17454 pass / 1 fail / 47 skip     => +29 pass (my tests), 0 new failures
    The 1 fail is `E-TYPE-ANY-FORBIDDEN — struct field ': any' fires`, IDENTICAL on the pre-fix
    baseline with my code absent => PRE-EXISTING. Passes in the full suite and 6/6 in isolation
    (twice); fails only in the unit+conformance subset at ~8s. Set-dependent, likely a timeout.
    Reported, not fixed (out of scope).
  FULL SUITE (`bun run test`):
    pre-fix : 26961 pass / 1061 fail / 213 skip   (28236 tests)
    post-fix: 26984 pass / 1043 fail / 213 skip   (28241 tests)
    set-diff: **0 NEW failures**, 18 resolved — ALL 18 are my own i81 tests; 0 non-i81.
    The brief's "0 failures is the contract" is NOT achievable: caf50487 already fails 1061. Dominant
    class 1012x "M7.3.b.N within-node parity per-fixture gate" (native-parser), plus self-host (needs
    a locally built dist — primary.map.md flags exactly this), LSP, browser. Contract MET: 0 regressions.

### Deferred / NOT fixed (all pre-existing drops — none are regressions; none silently widened)
  - `title=@label` / `data-mode=@mode` BARE-@ref form (`val.kind === "variable-ref"`) emits the LITERAL
    identifier text (`title="label"`), non-reactive — emit-html.ts:2381-2386 "General attribute"
    fallback. A DIFFERENT path from the `expr` chain, out of scope per the brief. Arguably worse than a
    drop (looks plausible in the HTML). Strongest follow-up candidate.
  - SVG children (`<use xlink:href=(@h)/>`, resolvedKind "unknown") stay dropped.
  - Value attrs on component call sites (`<Card class=(@x)/>`) stay dropped.
  - Boolean attrs beyond disabled/readonly/required (checked/selected/open/...) stay dropped; they want
    the BOOL path, and widening REACTIVE_BOOL_ATTRS is explicitly forbidden by the brief.
  - `value=(expr)` lowers via setAttribute, which sets the DEFAULT value: after a user types, the DOM
    property diverges and further updates won't show. `bind:value` is the canonical two-way path. Still
    strictly better than the pre-fix drop, and consistent with emit-each's setAttribute behavior.
  - emit-each.ts / attr-template coerce absence into visible text (`not` -> "null"), diverging from my
    SPEC-correct removal. Out of scope (brief forbids touching emit-each).
