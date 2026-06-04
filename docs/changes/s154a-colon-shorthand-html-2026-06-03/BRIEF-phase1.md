# BRIEF (Phase 1) — S154 (a) codegen IMPLEMENT + TEST + R26

> Archived verbatim per S136. Dispatched S159 to `scrml-js-codegen-engineer`, model opus,
> isolation:worktree, background. agentId a3a192d893c7d34b8. SPEC half landed `1fb9823f`.
> Fresh dispatch carrying the Phase-0 survey (agentId ab11b676, survey @ 932263cb) + 5 PA rulings.

PA RULINGS (greenlight of the Phase-0 survey):
- R1 — Approach (a) AST-synthesis (over emit-side+DG-credit): at ast-builder buildBlock, for a
  non-void (`!getElementShape(tag).isVoid`) non-component (`isComponent!==true`) lowercase HTML
  element whose `shorthandBodyRaw` does NOT reference `@.`, SYNTHESIZE the body child — emit-html
  (iterates children) + DG (recurses children → clears E-DG-002) + TS all handle it unchanged.
- R2 — the synthesized child follows §4.18 CODE-DEFAULT interpretation, NOT free-text bare-body:
  expression `@label` → interpolated logic/bare-expr child (`${@label}`, renders the VALUE, byte-id
  to `<span>${@label}</span>`); `"..."` display-text literal → UNQUOTED text child (renders
  `Static item`, NOT `"Static item"` — code-default strips quotes per §4.18.3; `${...}` inside the
  literal allowed §4.18.4). Mirror the engine/each `:`-shorthand literal-vs-expression distinction.
- R3 — `@.`-body skip: `<li : @.name>` is owned by emit-each (reads shorthandBodyRaw directly);
  do NOT synthesize. A bare `<li : @.name>` OUTSIDE `<each>` must STILL fire E-SYNTAX-064 (S157
  Bug 70) — verify the skip doesn't silently swallow it.
- R4 — void reject (2 sub-cases, one guard): (a) reorder BS void short-circuit (block-splitter.js
  ~2551) so `shorthand && !selfClosing` precedes the VOID_ELEMENTS short-circuit → br/hr/img/input
  uniformly carry closerForm:"shorthand" (SAFE — only changes `<void : expr>`; `<input/>` /
  `<input type=.../>` selfClosing unaffected); (b) ONE type-system-stage guard (~5034) fires
  E-COLON-SHORTHAND-ON-VOID for `getElementShape(tag)?.isVoid === true && closerForm === "shorthand"`.
  Void gets NO synthesis (R1 excludes); the guard is the only handling.
- R5 — scope: lowercase HTML only; PascalCase components + engine/match `:`-shorthand + each per-item
  UNTOUCHED.

Phase 2 tests: non-void renders interpolated body + E-DG-002 GONE + byte-id vs `<span>${@label}</span>`;
`<li : "Static item">` → unquoted display text; void → E-COLON-SHORTHAND-ON-VOID; `<input/>` /
`<input type="text"/>` NO error (BS-reorder regression guard); component untouched; no-regression on
existing engine/each/match `:`-shorthand + the @.-outside-each E-SYNTAX-064 test. Baseline 22856/0
(`bun test compiler/tests/` — the reliable gate; `bun run test` chained flakes 2 timing failures).

Phase 3 R26 (mandatory, S138): (a) interpolated body + node-check + 0 E-DG-002; (b) byte-id;
(c) void fires E-COLON-SHORTHAND-ON-VOID; (d) `<li : @.name>` in `<each>` still renders per-item;
(e) `<li : @.name>` outside each still fires E-SYNTAX-064; (f) component unchanged. DO NOT mark DONE
without R26. PA runs independent dual-R26 at landing.

(Full verbatim dispatch prompt: S159 transcript / Agent call agentId a3a192d893c7d34b8. Standard
isolation:worktree discipline blocks — MAPS / F4 / S112 merge-startup→1fb9823f / S99-S126 Bash-edit /
crash-recovery / commit-discipline.)
