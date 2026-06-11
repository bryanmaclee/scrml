# Progress — g-display-text-overquote (S181)

Change-id: g-display-text-overquote-2026-06-11
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-ab53c40c43da0f800
Base: main @ 339f37c2 (merged)

## Goal
Build `W-DISPLAY-TEXT-OVERQUOTE` (Info) — fires when a `"..."` string literal is the SOLE
content of a plain-markup element (`<p>`/HTML element, NOT a component, NOT a structural element)
that is nested inside a code-default-body context (engine state-child body / match-arm body /
`:`-shorthand body per §4.18 / §4.15). The quotes render literally there (free-text body) — the
adopter's code-default `"..."` habit produces literal quote marks with no diagnostic.

## Log
- [step 0] Startup verify clean; merged main 339f37c2; bun install; pretest OK.
- [step 0] Read primary.map.md in full. Task-shape = diagnostic-authoring (S173/S174 lint pattern).
- [step 0] AST-probe of the engine reproducer: engine-decl.bodyChildren[] = state-child markup
  nodes (isComponent:true); state-child.children[] = nested `<p>` markup (isComponent:false,
  getElementShape!=null) whose sole `text` child value = "\"loading...\"" (LITERAL quotes).
  Control `<p>ready now</p>` text value = "ready now" (no quotes) — correctly distinct.
- [step 0] Match: `match-block` holds arms in `armsRaw` (raw text), inline `match-arm-inline` holds
  raw `result` string. `:`-shorthand: ast-builder STRIPS the quotes when the body IS a literal,
  so the footgun in a `:`-shorthand body needs a NESTED plain-markup element (raw `shorthandBodyRaw`).
- [step 0] LOCUS DECISION: type-system.ts (has full fileAST.nodes + wired W-/I- diagnostic stream
  + getElementShape already imported). lint-ghost-patterns.js rejected (raw-regex pre-pass, no
  body-mode context — would false-fire on plain markup outside any code-default body).
- [step 0] Baseline emit captured (literal quotes present): repro.html sha 975d9331..., repro.client.js
  sha 60770d41... — the byte-identity reference for the lint-only no-codegen-change proof.

## Next
- Implement checkDisplayTextOverquote in type-system.ts; wire at the type pass.
- SPEC §34 row + §4.18.7 inverse-footgun note.
- Tests: engine/match/colon reproducers fire; negative controls silent; byte-identity emit proof.

## Log (cont.)
- [impl] checkDisplayTextOverquote added to type-system.ts (after checkLogShadowing).
  Walks: engine bodyChildren (structural) + match armBodyChildren (structural) +
  match armsRaw / match-arm-inline result / :-shorthand shorthandBodyRaw (raw-text
  scan via scanRawArmText). Plain-markup gate = getElementShape(tag)!==null (drops
  isComponent CODE read → P3-FOLLOW guard green at 1 occurrence). Wired at type pass
  (:17002) next to checkAnyTypeForbidden.
- [verify] Engine reproducer: 1 fire on <p>"loading..."</p>; control <p>ready now</p>
  silent; emit BYTE-IDENTICAL to pre-fix baseline (repro.html sha 975d9331,
  repro.client.js sha 60770d41 — unchanged). Match-block (armsRaw) + match-stmt
  (result) fire. 5 negative controls silent (direct literal / bare text / outside
  code-default / "a" and "b" non-sole / :-shorthand stripped literal).
- [test] compiler/tests/unit/display-text-overquote.test.js — 11 tests (cross-stream
  collector), all green. Committed fbb68df3 (full pre-commit gate passed).
- [spec] §34 +1 row (W-DISPLAY-TEXT-OVERQUOTE, Info) after E-UNQUOTED-DISPLAY-TEXT;
  §4.18.7 +inverse-footgun note (worked example + 3 normative statements + does-NOT-fire
  list); §4.18.9 cross-ref. SPEC-INDEX regenerated + footer re-synced 31,521→32,214
  (drift across S162-S180). Net +19L SPEC.md.

## Finding (surfaced, not blocking)
- The `:`-shorthand body is NOT a realistic over-quote locus: a `:`-shorthand body
  that IS a "..." literal gets quote-STRIPPED by ast-builder (§4.18.3, correct — no
  footgun); a `:`-shorthand body containing nested plain markup does not parse cleanly
  (the body is a single-expression slot). The lint covers shorthandBodyRaw defensively
  but the actionable footgun loci are engine state-children + match arms. The brief
  lists `:`-shorthand as a code-default CONTEXT a plain-markup element can nest inside;
  in practice that nesting only occurs via engine/match bodies (covered).
- The match reproducers exhibit ORTHOGONAL pre-existing issues (match-stmt →
  E-CODEGEN-INVALID-JS; a bare-body <p>"..."</p> arm can trip the match arm-closer
  detection). The lint fires correctly regardless via the raw-text scan; tests assert
  the WARNING appears without requiring a zero-error full compile.
