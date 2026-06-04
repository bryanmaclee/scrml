# S154 ruling (a) — CODEGEN half — progress

change-id: s154a-colon-shorthand-html-2026-06-03
worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a3a192d893c7d34b8

## 2026-06-03
- Startup verification DONE: pwd=worktree-abs OK; merge main -> HEAD=1fb9823f (landed §4.14/§34 SPEC); bun install OK; pretest OK.
- Baseline: 22856 pass / 220 skip / 1 todo / 0 fail (clean re-run; first run had 2 known timing flakes).
- Read SPEC §4.14 (969-1037) + §4.18 loci + §34 E-COLON-SHORTHAND-ON-VOID in full.
- Maps consulted: primary.map.md (parser/grammar + codegen task-shape routing).
- NEXT: locate impl sites in ast-builder.js (buildBlock), block-splitter.js (VOID reorder ~2551), type-system.ts (markup visit ~5034), html-elements.js (getElementShape).

## 2026-06-03 (impl)
- R1/R2 (ast-builder.js): body-child synthesis via re-parse of `<tag>BODY</tag>` — committed 7c2f7ff6.
  - Expression body -> ${expr} interpolated; "..." literal -> unquoted display text (interior ${} preserved).
  - Skips components + void + @. bodies. Clears E-DG-002 false-fire. Byte-identical to explicit bare-body.
- R4a (block-splitter.js): `shorthand && !selfClosing` branch precedes void short-circuit.
  - CRITICAL: brief said `shorthand && !selfClosing`; initial `if (shorthand)` broke `<column :let={...}/>`
    (self-closing directive opener tripped shorthand scanner). Fixed to gate on !selfClosing per brief.
- R4b (type-system.ts): E-COLON-SHORTHAND-ON-VOID guard + R3 @.-shorthand-body outside-each E-SYNTAX-064.
- R3 finding: at HEAD `<li : @.name>` outside each silently swallowed; added shorthand-body fire site per R3.
- p3-follow isComponent budget 25->27 (intra-stage read of BS write-side stamp + comment).
- TESTS: compiler/tests/unit/html-colon-shorthand-content-model-s159.test.js — 18 tests, all pass (997a4117).
- Full suite: 22856 pass / 220 skip / 1 todo / 0 fail (baseline match).
- NEXT: Phase 3 R26 empirical (a-f).

## 2026-06-03 (Phase 3 R26 — all PASS)
- (a) <span : @label> emits interpolated body (_scrml_reactive_get) + node --check OK + 0 E-DG-002. PASS
- (b) byte-identical to <span>${@label}</span> (html/client/runtime, modulo gensym). PASS
- (c) <input : @val> fires E-COLON-SHORTHAND-ON-VOID; CLI compile exit 1. PASS (svg <circle> too)
- (d) <li : @.name> inside <each> renders per-item (item.name + createElement("li"), node-check OK). PASS
- (e) <li : @.name> outside <each> fires E-SYNTAX-064 (not silently dropped). PASS
- (f) component <Card : @label> — no E-COLON (E-IMPORT/E-COMPONENT from undefined Card, unrelated). PASS
- Final full suite: 22874 pass / 220 skip / 1 todo / 0 fail (baseline 22856 + 18 new). Tree clean.
- DONE.
