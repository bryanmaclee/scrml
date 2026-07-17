# BRIEF — issue #81: dynamic VALUE attributes silently dropped outside `<each>`

**Dispatched:** 2026-07-16, S262 (Peter). **Agent:** `scrml-js-codegen-engineer` (model: opus).
**Worktree:** `C:/Users/poliv/Documents/GitHub/scrml-i81-attrs` (PRE-MADE — auto-`isolation:"worktree"`
has been broken since S258; do NOT rely on it).
**Branch:** `fix/i81-value-attr-emitter` (base `origin/main` = `caf50487`).
**Issue:** https://github.com/bryanmaclee/scrml/issues/81 — filed by the adopter app
`pjoliver11/assetManagement`. **PA-REPRODUCED on `caf50487`** (not taken on trust).

**DONE-PROBE:** `bun test compiler/tests/unit/value-attr-binding-i81.test.js 2>/dev/null | grep -q "0 fail"`

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its §"Task-Shape Routing" for this task shape
(codegen / attribute emission). Map stamp: **`f079d0a9`** · 2026-07-14.

**Currency (PA-checked at dispatch):** HEAD is `caf50487`, **41 commits ahead of the map stamp** — BUT
`git log f079d0a9..caf50487 -- emit-html.ts emit-event-wiring.ts binding-registry.ts` is **EMPTY**: none of
your three target files moved since the stamp. The map is CURRENT for this task shape. Treat map content as
a verify-against-source hypothesis anyway. Report the load-bearing finding — including "not load-bearing."

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. **FIRST ACTION — gate.** `pwd` MUST be under `C:/Users/poliv/Documents/GitHub/scrml-i81-attrs`.
   `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal that path. Tree MUST be clean.
   **If ANY check fails: STOP, report, exit. Do not proceed.**
2. `bun install` in the worktree (worktrees do NOT inherit `node_modules` — the hook fails
   "cannot find package 'acorn'" otherwise).
3. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` browser fixtures; ~130
   ECONNREFUSED-shaped fails without it). Use `bun run test` (chains pretest), NOT bare `bun test`, for
   baselines.
4. **NEVER `cd` into the main checkout** (`C:/Users/poliv/Documents/GitHub/scrml`). Use
   `git -C "$WORKTREE_ROOT"`, `bun --cwd="$WORKTREE_ROOT"`, and worktree-ABSOLUTE paths for every
   Read/Write/Edit. A relative path resolves against the MAIN checkout and leaks.
5. First commit message: `WIP(i81): start at $(pwd)` — the PA verifies the prefix on landing.
6. Commit after EVERY meaningful change (WIP commits expected — the branch IS the crash checkpoint).
   Append to `docs/changes/i81-value-attr-emitter-2026-07-16/progress.md` (append-only, timestamped:
   what was just done / what's next / blockers).

---

## The defect (PA-diagnosed — verify, don't assume)

In `compiler/src/codegen/emit-html.ts`, the `val.kind === "expr"` attribute dispatch chain is:

```
    if (name === "if" || name === "show")   { ... }   // ~2371  directive emitter
    else if (name.startsWith("on"))         { ... }   // ~2404  event emitter
    else if (REACTIVE_BOOL_ATTRS.has(name)) { ... }   // ~2418  bool-attr emitter
    }                                                 // ~2440  ← chain ENDS. NO final else.
```

`REACTIVE_BOOL_ATTRS` (`emit-html.ts:50`) = `{"disabled","readonly","required"}` — a 3-element allowlist.

**A dynamic VALUE attribute (`class=`/`style=`/`title=`/`data-*`/`id=`/`alt=`/…) matches NO branch.**
Nothing is pushed to `parts`; the attribute vanishes from the emitted HTML. **Silently** — clean compile,
0 diagnostics, and the CSS written against those classes becomes dead code that reviews as correct.

**PA-reproduced on `caf50487`** — `<button class=(@mode == "a" ? "tab on" : "tab") onclick=pick()>` emits
`<button data-scrml-bind-onclick="_scrml_attr_onclick_1">`: `class` GONE, `onclick` wired. `style=`,
`title=`, `data-mode=` likewise. Static `class="x"` survives; bool `disabled=(expr)` wires.
**Inside `<each>` every one of them wires** — `emit-each.ts` (~1342-1476) builds elements imperatively and
calls `setAttribute` directly, so it has a real value-attr path. The non-`<each>` path emits static HTML
with `data-scrml-bind-*` placeholders + a wiring pass, and that pass has no value-attr case.

## The fix — MIRROR the bool-attr path (existing infra; do NOT invent a mechanism)

The bool path is the working template end-to-end. Extend it, three touchpoints:

1. **`emit-html.ts`** (~2440) — add the FINAL `else` to the chain: emit
   `data-scrml-bind-attr-<name>="<placeholderId>"` and `registry.addLogicBinding({...})` with a new
   discriminant (e.g. `isReactiveValueAttr: true, valueAttrName: name`), mirroring the
   `isReactiveBoolAttr` block immediately above (`placeholderId` via `genVar(\`attr_${name}\`)`, carry
   `expr`/`condExpr`/`condExprNode`/`refs` the same way).
2. **`binding-registry.ts`** — add the new optional fields to the LogicBinding type alongside
   `isReactiveBoolAttr` / `boolAttrName`.
3. **`emit-event-wiring.ts`** (~1389, where `data-scrml-bind-bool-${attrName}` is consumed) — add the
   value-attr consumer: an `_scrml_effect` that does `el.setAttribute(name, String(value))`.
   **Semantics to decide + JUSTIFY in progress.md:** what does a falsy/`not` value do? The bool path
   removes the attribute on falsy. For a VALUE attr, `not`/`undefined` should almost certainly
   `removeAttribute` while `""` SHOULD set an empty attribute (`""` is a DEFINED value in scrml, NOT
   absence — SPEC §42.1.1 / PRIMER §9.4; do not conflate). Follow the SPEC, and say what you chose.

**Scope discipline:** this is the NON-`<each>` value-attribute emitter ONLY. Do NOT touch `emit-each.ts`
(it already works), the async classifier, `#{}`/`@scope` CSS emission (§65 — a HELD sibling arc,
`feat/css-wave1-emission`, NOT yours), `ast-builder.js`, `type-system.ts`, or `SPEC.md`.
**Do NOT widen `REACTIVE_BOOL_ATTRS`** — bool and value are different lowerings; a bool attr toggles
presence, a value attr sets a string.

**Interaction to get right:** an element can carry BOTH a value attr and an event/directive attr
(`<button class=(...) onclick=pick()>` — the issue's own first case). Multiple placeholders on one element
must coexist. Also `if=`/`show=` + `class=(...)` on the same element (the `<template>`/marker path).

## Verification — ALL REQUIRED

- **Repro (the exact issue-#81 program)** — the full reproducer is in the issue body
  (https://github.com/bryanmaclee/scrml/issues/81), including the `<each>` × attribute-kind table.
  Compile it; assert `class`/`style`/`title`/`data-mode` now emit a binding outside `<each>` AND still
  wire inside; `disabled=` still bool-wires; static `class="x"` unchanged.
- **NEW regression test** — `compiler/tests/unit/value-attr-binding-i81.test.js` (the DONE-PROBE above
  greps it). Cover: ternary · string-concat · `style=` · `title=` · `data-*` · both-attrs-on-one-element
  (`class=` + `onclick=`) · `if=` + `class=` on one element · static-unchanged · bool-still-bool ·
  inside-`<each>`-unchanged · falsy/`not` semantics · `""` sets empty (NOT removed).
- **Full suite** — `bun run test` in the worktree. 0 failures is the contract. Report the count.
- **R26 EMPIRICAL (mandatory, HIGH codegen — NOT "tests pass")** — recompile REAL adopter sources on the
  POST-FIX baseline: `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` over
  `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` + `examples/` + `samples/compilation-tests/`.
  **Symptom-specific check, not a green suite:** grep the emitted HTML/JS for the attribute shapes —
  confirm previously-dropped dynamic value attrs now appear as bindings, and confirm **0 regressions**
  (nothing that emitted correctly before changed shape; static attrs byte-identical).
  **DO NOT mark DONE without empirical R26 passing.**
- **Blast radius — enumerate it.** This lowering injects a new placeholder + a new `_scrml_effect` per
  dynamic value attr. Where ELSE can that land? Consider: `<each>` interaction, `if=`/`show=` templates,
  components, SSR/prerender output, the `bind:value` path, chunk/role splitting, `data-scrml-*` reserved
  namespace collisions. Construct reproducers for the adjacent shapes and report what you probed.

## Report back

Worktree path · final SHA · files-touched · conformance + full-suite counts · R26 result (with the actual
symptom-grep output) · blast-radius findings · the falsy/`""` semantic you chose and why · anything deferred.

**A PA-side `/code-review high` adversarial pass runs on your diff BEFORE landing (S239 — mandatory; you
cannot run it in-agent). A confirmed finding routes back to you as a fix round.** Green + clean self-review
is NOT landable on its own — S239 has caught real defects on 4+ green dispatches.
