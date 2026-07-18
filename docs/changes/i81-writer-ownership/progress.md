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

## 2026-07-18 — BUILT + VERIFIED (S268 dispatch complete)

**Commits (on worktree branch):**
- `cadd7ff2` docs — brief archive + progress anchor.
- `930ed961` port — branch bcf85c29 sound fixes 3-way-merged onto main 510cef8d (baseline).
- `2cc77445` feat — Axiom ① analyzeWriterConflict + E-ATTR-WRITER-CONFLICT (replaces F3 refusal).
- `363754a0` spec — §5.5.4 out of Planned; §5.5.3 correction; §34 row.
- `6652b00a` test — conformance case (codes + runtime halves).

**Surface-partition impl (emit-html.ts `analyzeWriterConflict`):** the value emitter owns
STRING surfaces (className via `class=(expr)`, style via `style=(expr)`, `.value` via
`value=(expr)` on a form control, and generic string attrs). For a wholesale value attr about
to emit, it classifies the surface and scans the element's sibling `attrs` for competing
writers — `class:*`/transitions on className, `if=`/`show=`/transitions on style, `bind:value`
on `.value`. Generic attrs (title/id/alt/data-*) have no composer form → always sole. Sole →
EMIT (the #81 fix); wholesale + any other writer → E-ATTR-WRITER-CONFLICT (severity error)
naming both sites + pick-one remedy, and emit NOTHING (byte-identical to pre-#81, so an ignored
error degrades to the old behavior). Wired into the value-attr `else if`/`else` branch.

**Guard mapping (the DD/brief lumped F3+D5+F2 as "refusal guards"; the correct model distinguishes):**
- **F3 (style clobber)** → PROMOTED to the ① writer conflict (E-ATTR-WRITER-CONFLICT). This is a
  genuine same-surface writer conflict. W-CG-VALUE-ATTR-STYLE-CONFLICT retired.
- **D5 (HTML_BOOLEAN_ATTRS drop)** → KEPT as a SURFACE-DECLINE, not a conflict. The value emitter
  does not own boolean-attr surfaces (presence, not string); `checked=(expr)` needs the bool
  presence-toggle lowering, which is out of scope (REACTIVE_BOOL_ATTRS widening = separate arc,
  brief-forbidden). Reframing it as a writer conflict would be wrong modeling — it is a
  lowering-capability gap, and promoting it to a hard error would REGRESS build success on real
  corpus (27-type-derived-table.scrml `<input checked=(@a && @b)>`).
- **F2 (W-CG-VALUE-ATTR-UNLOWERABLE)** → KEPT as an orthogonal codegen-capability gate (can the
  `@`-in-template-literal expression be lowered at all), independent of writer ownership.
  [Both surfaced in the report for PA/bryan ratification.]

**Error code chosen: `E-ATTR-WRITER-CONFLICT`.** Family fit — E-ATTR-010..012 are DOM-attribute
conflicts on one element (§5.4/§5.5, codegen locus); E-REACTIVITY-* is the §6.13
reactivity-system/type-system family (wrong locus). Descriptive over numbered (matches the newer
named-code convention E-REACTIVITY-ATTR-CONFLICT). "WRITER" names the axiom's core noun.

**Template-literal owner (§5.5.3) — SCOPED OUT of enforcement, surfaced.** ① says a reactive
template-literal `class` is a wholesale writer that conflicts with `class:`. But the corpus fixture
`phase4-dynamic-class-template-076.scrml` (titled "template-literal attr + class: combined") is a
DELIBERATE golden referenced by `e2e-render-map-baseline.json` + `parser-conformance-within-node-allowlist.json`,
demonstrating the legacy §5.5.3 coexistence. The DD (S265) did not account for this. Enforcing the
template-lit-owner conflict now would break deliberate baselines. Decision: correct the §5.5.3 TEXT
(remove the false "SHALL NOT treat as a conflict"; state the ① direction) + mark template-lit-owner
ENFORCEMENT as a tracked follow-up requiring baseline migration. The `class=(expr)`/`style=(expr)`/
`value=(expr)` wholesale-owner enforcement (the R26 gate) is complete.

**Tests:** value-attr-binding-i81.test.js 51 pass (§i81.12 ① matrix added; F3 test rewritten to the
error; expectParses → Acorn sourceType:module). conf-ATTR-WRITER-CONFLICT.test.js 5 pass.
Pre-commit gate (unit+integration+conformance --bail): 20812 pass / 0 fail (baseline was 20800; +12
new). 0 regressions.

**R26 empirical (876 files, examples + samples/compilation-tests; pre-#81 510cef8d vs post-① HEAD;
Acorn sourceType:module):**
- NEW fatal: 0 · NEW module-parse-fail: 0 · LOST value-attr emits: 0 (141 fatal / 35 parse-fail are
  IDENTICAL pre-existing on both baselines).
- NEW value-attr emits (#81 wins): 2 — phase4-attr-braces-ghost-020.scrml, phase4-className-ghost-040.scrml.
- Corpus writer-conflicts: 0 (the ① error fires on no real corpus file — a compile-time safety net
  for a shape adopters don't currently write; matches the branch's "0 diagnostics" finding).
- PROBE 1 (Peter's portal shape — 7 sole-writer class=/style=/title= bindings): compiles clean, 7
  bindings emitted, client bundle Acorn sourceType:module parse OK. UNBLOCKS #81.
- PROBE 2 (ambiguous class=(expr) + class:active= mix): E-ATTR-WRITER-CONFLICT fires (severity
  error), names both sites, class= binding NOT emitted.

DONE.
