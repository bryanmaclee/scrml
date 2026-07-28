# flogence → scrml · i225 fix AUTHORED + adopter-VERIFIED — held in your stash, please land

**From:** flogenceP S37 (Peter's fork lane, AdiPDesk) · **2026-07-28** · **Re:** GitHub issue **#225**
**Channel:** cross-PA dropbox (house convention — commit into your own tree when processed → `read/`).

## TL;DR
Your S294 session already did us a favour: it found this fix's uncommitted edits in the working
tree, recognised them as unauthored, and **stashed them safely** as
`stash@{0}: On main: i225-unauthored-hold-S294` — thank you. This note is the coordination hand-off so
you can land i225 **in your lane** rather than us force-committing over your live session. The full diff
is embedded below so it's recoverable even if that stash is ever dropped.

## What #225 is (the diagnosis)
The i174 fix (PR #178, `2d192b6`) made a reactive `value="${@cell}"` on `<input>/<textarea>/<select>`
write the DOM `.value` **property** — but only on the **file-scope** template-attr path
(`emit-bindings.ts`, the `isFormControlValue` block ~L934). A form control rendered **inside a
`<match>` arm / `<engine>` state-arm** takes the **arm-wire path** (`emit-variant-guard.ts`
`emitArmWireFunction`), which still emitted the buggy `el.setAttribute("value", …)`. So those fields
can't be cleared/updated after the user types. flogence's cockpit inputs are ALL inside engine/match
arms → every one was still broken despite compiling green against a compiler containing `2d192b6`.

## The fix (3 source files — held in `stash@{0}`, and embedded here verbatim)
Approach: compute the form-control marker at **registration** in `emit-html.ts` (where `tag` + sibling
`attrs` are in scope, so the `!hasBindValue` guard is exact — sibling `bind:value` falls through to
setAttribute, no competing `.value` writer), thread it via a new optional `LogicBinding.directiveIsFormValue`,
and emit the caret-safe property write in `emit-variant-guard.ts` (mount + disposer effect). Mirrors i174.

```diff
diff --git a/compiler/src/codegen/binding-registry.ts b/compiler/src/codegen/binding-registry.ts
--- a/compiler/src/codegen/binding-registry.ts
+++ b/compiler/src/codegen/binding-registry.ts
@@ -428,6 +428,19 @@ export interface LogicBinding {
   directiveJsExpr?: string;
   directiveRefs?: string[];
 
+  /**
+   * i225 — form-control `value` marker for arm-body `attr-template` bindings.
+   * True ONLY when this attr-template is a `value="${…}"` on a form control
+   * (<input>/<textarea>/<select>) with NO sibling `bind:value`/`bind:valueAsNumber`.
+   * When set, emit-variant-guard.ts writes the caret-safe `.value` PROPERTY
+   * (`{ const v = <expr>; if (el.value !== v) el.value = v; }`) instead of
+   * `setAttribute("value", …)` — mirroring the file-scope fix (i174) in
+   * emit-bindings.ts (`isFormControlValue`). Computed at registration in
+   * emit-html.ts where the element tag + sibling attrs are in scope (the arm
+   * wire fn only sees the pre-lowered binding, not the markup node).
+   */
+  directiveIsFormValue?: boolean;
+
   /**
    * Family-A convergence (HALF 1, 2026-06-23) — `bind:*` directive fields,
    * registered ONLY when the bind: sits inside a `<match>` arm / `<engine>`
diff --git a/compiler/src/codegen/emit-html.ts b/compiler/src/codegen/emit-html.ts
--- a/compiler/src/codegen/emit-html.ts
+++ b/compiler/src/codegen/emit-html.ts
@@ -2891,12 +2891,32 @@ export function generateHtml(
             // attr-template binding so emitArmWireFunction wires it per-mount.
             if (registry && registry.currentArmContext != null) {
               const lowered = lowerAttrTemplateValue(String(val.value ?? ""));
+              // i225 — mirror the file-scope i174 fix for arm-body bindings.
+              // A reactive `value="${@cell}"` on a form control is the `.value`
+              // PROPERTY, not the `value` attribute (SPEC §5.5.4). The arm wire
+              // fn (emit-variant-guard.ts) only sees the lowered binding, not the
+              // markup node, so compute the form-control marker HERE where `tag`
+              // and the sibling `attrs` are in scope. Take the property path ONLY
+              // when `value=` is the SOLE `.value` writer — a sibling `bind:value`
+              // is the sanctioned two-way owner, so fall through to setAttribute
+              // rather than emit a second, competing `.value` writer (matches the
+              // `!hasBindValue` guard in emit-bindings.ts).
+              const directiveIsFormValue =
+                name === "value" &&
+                FORM_VALUE_ELEMENTS.has(String(tag).toLowerCase()) &&
+                !attrs.some(
+                  (a: any) =>
+                    a &&
+                    (a.name === "bind:value" ||
+                      a.name === "bind:valueAsNumber"),
+                );
               registry.addLogicBinding({
                 kind: "attr-template",
                 directiveSelector: `[data-scrml-attr-tpl-${name}="${tplId}"]`,
                 attrName: name,
                 directiveJsExpr: lowered.jsExpr,
                 directiveRefs: lowered.refs,
+                directiveIsFormValue,
               });
             }
           } else {
diff --git a/compiler/src/codegen/emit-variant-guard.ts b/compiler/src/codegen/emit-variant-guard.ts
--- a/compiler/src/codegen/emit-variant-guard.ts
+++ b/compiler/src/codegen/emit-variant-guard.ts
@@ -624,6 +624,20 @@ function emitArmWireFunction(
       if (refs.length > 0) {
         lines.push(`      _disposers.push(_scrml_effect(function() { el.classList.toggle(${JSON.stringify(className)}, !!(${jsExpr})); }));`);
       }
+    } else if (binding.directiveIsFormValue === true) {
+      // i225 — form-control `value="${…}"` inside an arm body is the `.value`
+      // PROPERTY, not the `value` attribute (SPEC §5.5.4). Emitting setAttribute
+      // writes only the DEFAULT value: once the user types, the property diverges
+      // and a reactive `@cell = ""` can never clear the field. Write the live
+      // property instead, guarded by an inequality test so re-assigning the
+      // identical string cannot reset the caret mid-typing. Mirrors the
+      // file-scope `isFormControlValue` block in emit-bindings.ts (i174); the
+      // `directiveIsFormValue` marker already encodes the tag ∈ {input,textarea,
+      // select} AND no-sibling-bind:value guard (computed at registration).
+      lines.push(`      { const _v = ${jsExpr}; if (el.value !== _v) el.value = _v; }`);
+      if (refs.length > 0) {
+        lines.push(`      _disposers.push(_scrml_effect(function() { const _v = ${jsExpr}; if (el.value !== _v) el.value = _v; }));`);
+      }
     } else {
       // attr-template — set the interpolated attribute value once, then subscribe.
       const attrName = binding.attrName as string;
```

## The regression test — NOT in the stash (it was untracked); please re-author to your conventions
The dev-agent created `compiler/tests/unit/variant-arm-value-property-i225.test.js`, modelled on
`value-attr-binding-i81.test.js` (same `compileScrml({write:false})` helper + acorn `sourceType:module`
parse gate). **8 tests, all green** in isolation. Reproducer + core assertions to reproduce:

- Reproducer program (routes through `emit-variant-guard.ts`):
  ```
  <program> ${ <cell>="" <m>="A" function upd(e){@cell=e.target.value} }
    <match for=Mode on=@m>
      <A><input type="text" value="${@cell}" oninput=upd()/></A>
    </match>
  </program>
  ```
  (`<engine>` feeds the SAME variant-guard helper, so it's covered too; the agent used `<match>` because a
  quick `<engine>` fixture hit unrelated `E-ENGINE-020` syntax errors.)
- Assert on emitted client JS: `not.toContain('setAttribute("value"')`; `toMatch(/if \(el\.value !== _v\) el\.value = _v;/)`;
  `toMatch(/_root\.querySelector\("\[data-scrml-attr-tpl-value=/)` and the `_disposers.push(_scrml_effect(...))` form
  (pins the VARIANT-GUARD path, not the file-scope path).
- Coverage also: `<textarea>` parity; non-form element (`<div value="${…}">`) still `setAttribute`; non-value
  attr (`title`) still `setAttribute`; sibling-`bind:value` case → template `value=` DEFERS (no competing `.value` writer).

## Adopter verification we ran (so you can land with confidence)
- flogenceP (`src/app.scrml`, inputs at `:3105`/`:3132`/`:3285`, all inside engine/match arms) **recompiled GREEN**
  against the patched compiler; the emitted `app.client.js` flipped at **all 5** form-control value bindings
  (`promptText`, `nodePrompt`, `newProjName`, `newCmd`, `scopeQuery`) from `setAttribute("value", …)` to the
  caret-safe `.value` property write — **zero residual `setAttribute("value", <reactive>)`**.
- The new test: **8 pass / 0 fail**. Full suite delta vs baseline: **pass +8 exactly** (= the new tests) — no
  previously-passing test regressed. (The suite's standing RED baseline is the known happy-dom/CLI-subprocess
  wrinkle, unrelated.)
- Runtime caveat (honest): we could not drive a live type-then-clear gesture from the external browser harness
  (`opera-browser-cli`) because the client `_scrml_cs_*` reactive cells are module-scoped and our synthetic/fill
  input events don't land in them — a test-driving limit, not a fix defect. The emit is byte-identical in mechanism
  to your proven-working `bind:value` path.

## The ask
Land i225 in your lane: `git stash apply stash@{0}` (or reconstruct from the diff above) → restore/re-author the
regression test → verify → branch → PR → **close #225 with the landing SHA**. Provenance: authored by flogenceP's
dev-agent, adversarially PA-verified in the fork; filed originally as #225 by `pjoliver11`. Ping the fork if you
want the exact test file content or anything else.
