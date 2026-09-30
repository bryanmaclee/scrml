# progress — s444-dpa045-spec-followups

- Start: worktree /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a83bd822e24680973, base 108ca89be (== origin/main). pretest green.
- All executions below: impl#1 = `bun compiler/bin/scrml.js compile <f> --output-dir <d>` at `108ca89be`; bootstrap =
  main's `compiler/self-host-v2` front end via `slice-m2/harness.js loadM2()` + `slice-m2/lowered.js frontEnd()`.

## Part 1 — SPEC clarifications

### (a) §4.18.1b `_{` — "as today" struck — DONE
Governing: §23.2.4 — *"A `_{}` block in any OTHER context — … or a markup element body — SHALL be a compile error
(E-FOREIGN-004 …)"*.
Execution: `<p>before _{ console.log(1) } after</p>` / `<div>x _={ let y = 1 }= z</div>` → exit 0, no diagnostic,
HTML `<p>before _{ console.log(1) } after</p>` (the slice is page text). Same inside a `<program lang="ts">`.
Main's bootstrap: `<p>before _={ const q = 1 }= after</p>` → zero diagnostics too (the dpa-045 bootstrap branch
898f5cd06 adds E-FOREIGN-004 there). Edit: rule restated without "as today"; the S442 provenance kept with an S444
note that its premise was false; S444 provenance line added.

### (b) `\"` in a display-text literal — DROPPED (conflict; PA confirmed)
Conflicting sentence, §4.18.3 (Amendment S442): *"A `\` inside a display-text literal is an ordinary content
character; there is no malformed-escape error (`E-PARSE-001` no longer fires on `\x` here). Consequently `\"` is a
`\` followed by the closing `"`"*. The brief's "stays an error (E-PARSE-001)" reading contradicts it → STOPPED; PA
correction received: drop it. No SPEC edit.
Execution record (for the bootstrap fix owner):
- impl#1, block-form `<Idle>"say \"hi\" now"</>` → exit 0, no diagnostic; ships `say \"hi\" now"` as content.
- main's bootstrap, `:`-shorthand and block-form `"say \"hi\" now"` → zero diags; the Core literal is
  `say "hi" now` (decoded as an escape). `"back\slash"` → `backslash` (the `\` is DROPPED). Both diverge from
  §4.18.3 (`\` is content).
- PA note: the dpa-045 bootstrap branch (feat/s442-dpa045-bootstrap @1fe0b22a) fires E-PARSE-001 on `\"`
  (review-reproduced) and so must conform to §4.18.3. That is a bootstrap fix, not a SPEC edit, and not this change.
- Unterminated display-text literal (§4.18.3 / §4.18.7: `E-CTX-001`): impl#1 block-form `<Idle>"never closed</>`
  → exit 0, no diagnostic, renders `"never closed`; main's bootstrap → E-UNQUOTED-DISPLAY-TEXT + E-PARSE-UNCLOSED
  (block-form), E-PARSE-TRAILING / E-PARSE-SHORTHAND / E-PARSE-UNCLOSED (shorthand). Filed LOW (Part 2 #6).

### (c) §23.2 identifier guard — DONE
Governing: §23.2 — *"The block splitter SHALL recognize `_` followed by zero or more `=` followed by `{` as a foreign
code block opener."* The guard narrows this SHALL; not a contradiction — without it `my_={ a: 1 }` (a valid
assignment) would open a foreign block. impl#1 has always applied it (`matchForeignOpener`, block-splitter.js:2366-2389:
`_` after `[A-Za-z0-9_$]` returns -1).
Execution: logic-context `my_={ a: 1 }` → emits `my_ = {a: 1}`, exit 0. Markup `my_{ stuff }`, `a$_{b}`, `9_{c}` →
content (impl#1 recognizes no `_{` in markup at all, so the guard is only observable in logic contexts there).
Main's bootstrap has no foreign-code support (grep: zero hits in self-host-v2/*.scrml).
Edit: new normative bullet in §23.2 after the opener SHALL.

### (d) §4.18.1 `<schema>` not free text — DONE
Governing: §4.18.1 free-text row — *"plain-markup element bodies (HTML elements …), component bodies, the `<errors>`
override template"* (no `<schema>`); §39.2 — *"schema-block ::= '<schema>' table-declaration* closer"*; §39.1 —
*"a `<schema>` state block"*. Tension checked: §4.18.1's *"The default body mode is free-text mode"* — resolved by the
same precedent as the `<program>`/`<page>` `default-logic` note (a body another section owns; §4.18 does not
classify it). Edit: an S444 note after that `default-logic` note. Deliberately does NOT say which scanner exits
apply inside `<schema>` (§39.2 relies on scrml `//` comment stripping there).

- Regenerated: `bun run scripts/regen-spec-index.ts` (OK), `bun scripts/facts.ts --write` (`--check` PASS).

## Part 2 — gaps filed (docs/known-gaps.md §S444; all reproduced on 108ca89be)
1. g-lift-segment-trim-deletes-interp-adjacent-spaces — HIGH — reproduced (lift: `createTextNode("lifted")`, interp,
   `createTextNode("li")`; markup-as-value: `"value"`, interp, `"end"`). Same class as the existing
   g-ast-markup-text-interp-adjacent-space-dropped (MED; its bryan fork is now RULED by S442) — PA may merge/raise.
2. g-component-body-whitespace-collapsed — LOW — reproduced (`comp body <span…> tail`, indentation stripped).
3. g-foreign-block-in-markup-body-rendered-as-text — MED — reproduced (slice shipped as page text, exit 0).
4. g-svg-or-math-compound-cell-pushes-foreign-tag-on-ancestor-stack — LOW — reproduced with a one-variable control
   (`svg` → `<div />`, `box` → `<div></div>`). NOT bootstrap: the D1 code is impl#1 emit-html.ts / utils.ts.
5. g-html-breakout-tag-in-foreign-content-keeps-self-close — LOW — reproduced (`<svg><div/>` → `<div />`). impl#1.
6. g-unterminated-display-text-literal-not-e-ctx-001 — LOW — reproduced (impl#1 silent; bootstrap other codes). PA-directed.
- `bun scripts/state.ts --write` + `--check` PASS. The master-list recent-sessions regen is SHA-abbreviation-length
  only (7 → 9 chars in this clone); committed because `--check` fails without it.
