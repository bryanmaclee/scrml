# progress — #81 writer-ownership Axiom ① (append-only, timestamped)

## 2026-07-18 — startup + premise verify (S268 dispatch)

**Gate.** Worktree `.claude/worktrees/agent-a57cf3b3f99d0ef44`, toplevel == worktree,
branch `worktree-agent-a57cf3b3f99d0ef44`, clean tree, HEAD `510cef8d` (current main).
`bun install` + `bun run pretest` OK.

**Held branch fetched:** `origin/fix/i81-value-attr-emitter` @ `bcf85c29`; merge-base with main
= `caf50487`. Main moved 2 commits touching my target files since the branch base:
- `17fd2beb` (#29-D) — bare `disabled=@var` → reactive bool-attr, +75/- in emit-html.ts. Added the
  explicit "SCOPE (held-#81 boundary)" comment at the bool clause (~2459) — value attrs still fall
  to the missing final `else` (the #81 hole).
- `3b62839a` (CSS Wave-1) — touched emit-html.ts (+35) and component-expander.ts (+71).

**Premise CONFIRMED on `510cef8d`:** the `val.kind === "expr"` dispatch chain (emit-html.ts ~2477)
ends after the `REACTIVE_BOOL_ATTRS.has(name)` branch (~2508-2522) with NO final `else` — the #81
silent-drop hole is present on current main exactly as the DD describes.

**Branch code files (6) reviewed in full:**
- KEEP (sound): binding-registry fields (F5 valueAttrIsFormValue, D2 valueAttrKey), emit-event-wiring
  `emitValueAttrApply` (absence-driven §42.9, F6 thenable, F5 .value property) + engineArm-null gate,
  emit-variant-guard per-arm loop, utils HTML_BOOLEAN_ATTRS, component-expander `_componentPropNames`
  stamp (F7), emit-html helpers valueAttrElementIsLowerable (F8) / isDeclaredPropAttr (F7) + CSS-safe key.
- REPLACE (refusal): emit-html `valueAttrIsLowerable`'s F3 style-conflict clause (`W-CG-VALUE-ATTR-STYLE-CONFLICT`
  warn+drop) → the ① surface-partition writer-conflict ERROR.

## Axiom ① model (ruled by bryan S268; from the R2-fork DD)

Per physical DOM surface, writers partition into composers (RMW a slice) and exclusive wholesale
owners. A wholesale writer + ANY other writer on the same surface → compile ERROR (author picks one
owner). Sole wholesale → emit. Composers alone → fine.

**Value emitter owns STRING surfaces only:** className (`class=(expr)`), style (`style=(expr)`),
`.value` (`value=(expr)` on form controls), generic string attrs (title/id/alt/data-*). On each it is
a WHOLESALE writer.

**Competitors detected per surface (on the same element's attr list):**
- className ← `class:*` (composer), `transition:*`/`in:*`/`out:*` (composer)
- style ← `if`, `show` (composer, `.style.display`), `transition:*`/`in:*`/`out:*` (composer, opacity)
- `.value` ← `bind:value`

**NOT value surfaces (value emitter declines — pre-existing drop kept, out of scope):**
- boolean-attr surfaces (checked/selected/open/…) — D5. Needs the presence-toggle lowering, i.e.
  REACTIVE_BOOL_ATTRS widening = a separate decision (brief forbids widening). NOT a writer conflict.
- F2 unlowerable `@`-in-template-literal — a codegen-capability limit, orthogonal to writer ownership.
  Kept as `W-CG-VALUE-ATTR-UNLOWERABLE` warn+drop.

**New code:** `E-ATTR-WRITER-CONFLICT` (severity error). Family fit: E-ATTR-010..012 are
DOM-attribute-on-one-element conflicts (§5.4/§5.5, codegen locus); E-REACTIVITY-* is the §6.13
reactivity-system/type-system family (wrong locus). Descriptive over numbered per the newer named-code
convention. Names BOTH sites in the message.

## Plan
1. Port the 4 unconflicted branch files wholesale (main == base for them): binding-registry, emit-event-wiring,
   emit-variant-guard, utils.
2. 3-way merge emit-html.ts + component-expander.ts onto current main. Baseline commit (branch behavior).
3. Replace F3 with the ① writer-conflict analysis + E-ATTR-WRITER-CONFLICT. Remove W-CG-VALUE-ATTR-STYLE-CONFLICT.
4. SPEC reconciliation: §5.5.4 out of Planned; §5.5.3 correction; §34 row.
5. Tests: rewrite value-attr-binding-i81.test.js to the ① model; add conformance case; R26 empirical (Acorn module parse).
