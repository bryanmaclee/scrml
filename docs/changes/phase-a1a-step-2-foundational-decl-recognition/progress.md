# Progress: phase-a1a-step-2-foundational-decl-recognition

Tier: T2+. Step 2 of 13. Foundational `<NAME>` decl-site recognition.

## Baseline

- Branch: `phase-a1a-step-2-foundational-decl-recognition`
- HEAD on creation: `be964b7`
- run-1: 8730 pass / 43 skip / 2 fail (flake)
- run-2: 8730 pass / 43 skip / 0 fail / 8773 tests — baseline-stable per flake protocol

## Plan

1. Read AST-CONTRACTS-AND-DECOMPOSITION.md (full).
2. Read PARSER-AUDIT-2026-05-05.md §A.2-A.4, §5.3.
3. Read SPEC.md §6.1, §6.2, §6.6.
4. Survey `compiler/src/block-splitter.js`, `compiler/src/body-pre-parser.ts`, `compiler/src/ast-builder.js` lines 3001-3160 + 4735+.
5. Document survey findings & design choices.
6. Decide: implement in one dispatch, or halt-and-surface for 2a/2b/2c sub-decomposition.
7. If go: implement Stage A (block-splitter + body-pre-parser) + Stage B (ast-builder).
8. Add ~12-15 tests to `parse-shapes-v0next.test.js` with anti-html-fragment guards.
9. Validate: `bun run test` 8730+N pass / 0 regressions.

## Survey findings

### Where `<count> = 0` becomes html-fragment today

Tracing `${ <count> = 0 }`:

1. **block-splitter.js** (Stage 2): `${...}` opens a "logic" brace context (line 897-901).
   Inside: `<` is recognized at lines 813-859 (markup-tag-text-tracking branch) — but
   per §4.6 PA-001, `<` in brace-delimited contexts is suppressed; the tag is consumed
   as RAW TEXT, only `tagNesting` is tracked. So `<count> = 0` flows through as raw
   text inside the logic block's children/raw.

2. **tokenizer.ts `tokenizeLogic`** (Stage 3 part 1): processes the raw text. Tokens for
   `< count > = 0`:
   - `<`  → PUNCT `<`     (line 884)
   - `count` → IDENT `count` (line 867)
   - `>` → PUNCT `>`
   - `=` → PUNCT `=`
   - `0` → NUMBER `0`

   No special `<NAME>` token. There IS NO existing `TAG_OPEN` etc. in the LOGIC tokenizer
   — those only exist in `tokenizeAttributes` for tag-attribute scanning.

3. **ast-builder.js `parseOneStatement`** (line 2840): walks tokens; the `<` PUNCT token
   does not match any keyword/AT_IDENT branch. Falls through to the default branch (line
   4011). `collectExpr()` joins tokens to a string `< count > = 0`. `isHtmlFragment(expr)`
   (line 140) returns `true` because expr starts with `<`. → emits
   `kind: "html-fragment", content: "< count > = 0"`.

### Where to intervene — DECISION

The natural single intervention point is **`parseOneStatement` in ast-builder.js**, right
before the default branch. Add a NEW recognizer that fires when `peek().text === "<"` AND
the lookahead matches `<IDENT> [attrs] > = / : / {` (decl pattern) AND a value-producing
token does NOT precede the `<` (so we don't false-positive on `if (a < b)`, etc.).

This avoids touching block-splitter (which already preserves the raw text fine) AND
body-pre-parser (which only handles function-body deferred expansion, not statement-level
decl recognition). Both are correct as-is for this work; the gap is purely in the
ast-builder statement dispatcher.

A separate, smaller recognizer hook is needed in the **`const`** branch (line 2930) for
Shape 3: `const <doubled> = expr`. After consuming `const`, if the next token is `<` (vs
the existing `AT_IDENT` derived path or IDENT name path), recognize the structural derived
form.

### Disambiguation lookahead window

For `<` at statement-start position to be a state-decl marker:
1. Previous (last-non-comment) token: must NOT be value-producing (IDENT, AT_IDENT,
   NUMBER, STRING, REGEX, `)`, `]`, value-keywords). `parseOneStatement` is called at
   statement boundaries, so `peek()` is always the first token of a fresh statement —
   in practice this means we don't even need to look back, since we're at statement start.
   But for safety and to allow `<count> = 0` mid-block (after `;` etc.), we'll just
   trust the parseOneStatement-is-statement-start invariant.
2. After `<`: optional whitespace, then IDENT (the cell name).
3. After IDENT: a sequence consumable as bareword attrs (zero or more idents/calls), then
   `>`.
4. After `>`: `=`, `:`, or `{`. **Step 2 scope: only `=`** (Shape 1 + Shape 3 plain init).
   The `:` (typed) and `{` (compound block) forms are deferred to later steps.
5. NEGATIVE: `<span>hello</span>` after `lift` keyword is markup, not decl. Distinguished
   because `<span>` is followed by `>` then non-`=` text content. The lookahead window
   for the decl form requires `>` IMMEDIATELY (after optional whitespace) followed by
   `=`. If the token AFTER `>` is anything else (text, IDENT not followed by `=`, etc.),
   it's not a decl.
6. NEGATIVE: bare `<` JS comparisons like `if (a < b)` — at statement start, `<` followed
   by IDENT followed by `>` followed by `=` is unambiguous: JS has no construct of that
   shape (`if`, `while`, `for`, etc. all use `(` before the comparison).

### Compound block `<form> { ... }` (Variant C) — DEFERRED to Step 11

PA leans defer; Step 2 scope tight. Step 2 only handles `<NAME> = expr` and
`const <NAME> = expr`. Variant C's `<form> { <name> = "" ... }` is recognized by the
recognizer because token-after-`>` is `{` (which we do NOT match in Step 2 — that's a
later step).

### Shape 3 `const <NAME>` vs plain JS `const x` — DECISION

The existing const branch (line 2930-2974) handles:
- `const @derivedName = expr` → `kind: "reactive-derived-decl"`
- `const name = expr` → `kind: "const-decl"`

For Shape 3 `const <derived> = expr`:
- After `const`, peek `<`. Trigger the same lookahead as for Shape 1.
- If positive: produce `kind: "reactive-decl"` with `name`, `init`, `initExpr`,
  `structuralForm: true`, `isConst: true`. Note: this is DIFFERENT from
  `reactive-derived-decl` (the @-form). Per AST-CONTRACTS §1.1, `kind: "reactive-decl"`
  is the renamed-target — Step 3 will rename to `state-decl` and unify all forms; for
  Step 2 we use the same kind as plain Shape 1 with the discriminating fields.

  Open question: should we use `reactive-derived-decl` for the const <NAME> form too,
  or use `reactive-decl` with `isConst: true`? Per AST-CONTRACTS §1.1 (the contract this
  step honors), the answer is `reactive-decl` with `isConst: true` — because Step 3
  will rename `reactive-decl` → `state-decl`, and `state-decl.isConst === true` is the
  v0.next-derived-cell shape. `reactive-derived-decl` will eventually be folded too,
  but that's not Step 2's job.

  **Choice:** `kind: "reactive-decl", isConst: true, structuralForm: true`. This honors
  the AST contract spec verbatim.

### Body-pre-parser interaction

BPP receives BareExpr-wrapped function bodies and parses them via `parseLogicBody`. So
once we add the `<NAME>` recognition INSIDE `parseLogicBody` (in `parseOneStatement`),
BPP automatically inherits it for nested function bodies (the audit's F1c/etc. cases
inside ${} all flow through `parseLogicBody`). No BPP changes needed for Step 2.

### Existing test risk — which tests assert html-fragment for `<X> = 0` patterns?

Need to grep for any test assertions of `kind: "html-fragment"` with content matching
`< NAME > = ...`. Will identify in implementation phase before changing behavior.

### Decision: implement in one dispatch (not 2a/2b/2c)

The intervention is well-localized:
- ~50 LOC in ast-builder.js (one new recognizer in parseOneStatement plus a hook in the
  const branch)
- ~12-15 tests added to parse-shapes-v0next.test.js
- 0 changes to block-splitter (already preserves raw text)
- 0 changes to body-pre-parser (already inherits via parseLogicBody)
- 0 changes to tokenizer (existing PUNCT/IDENT tokens are sufficient)

Estimate: ~3-5h for implementation + tests + regression-debug. Well within single-dispatch
capacity. Proceeding.

### Token-sequence detail

The recognizer must handle TWO token shapes:

1. **Whitespace-separated:** `< count > = 0` → tokens `PUNCT(<)`, `IDENT(count)`, `PUNCT(>)`,
   `PUNCT(=)`, `NUMBER(0)`. Five tokens. Easy.

2. **No-whitespace:** `<count>=0` → tokens `PUNCT(<)`, `IDENT(count)`, `OPERATOR(>=)`,
   `NUMBER(0)`. Four tokens, because tokenizer's MULTI_OPS list (line 782) eagerly grabs
   `>=` as a single OPERATOR token. The recognizer must split this OPERATOR(`>=`) into
   logical `>` + `=` when matching the decl pattern. Approach: when the post-IDENT token
   is `OPERATOR(>=)`, treat as if the sequence were `>` `=`.

Per audit, `${ <count> = 0 }` (the central case) is the whitespace form — both forms
should produce the same AST node.

### Two patch sites in ast-builder.js

There are TWO statement parsers to extend, in parallel:

1. **`parseLogicBody` top-level loop** (starts ~line 4387): handles statements directly
   inside `${...}` logic blocks. The legacy `@NAME = init` path is here at line 4915-4944.
   Key existing branches: `const` (line 5074-...), `AT_IDENT` (line 4803-...).

2. **`parseOneStatement` function** (line 2840-...): handles statements inside nested
   bodies (function bodies, if-bodies, while-bodies, etc.). Mirror branches: `const`
   (line 2930-...), `AT_IDENT` (line 3052-...).

Both must get:
- A NEW pre-default branch recognizing `<IDENT> [bareword-attrs?] > = expr` → state-decl.
- A NEW hook in the existing `const` branch recognizing `const <IDENT> > = expr` → derived state-decl.

### AST shape — exact fields produced

Following AST-CONTRACTS-AND-DECOMPOSITION §1.1:

For Shape 1 plain `<count> = 0`:
```
{
  id, kind: "reactive-decl",
  name: "count",
  init: "0",
  initExpr: { Literal: 0, ... },
  structuralForm: true,
  span,
}
```

For Shape 3 derived `const <doubled> = @count * 2`:
```
{
  id, kind: "reactive-decl",
  name: "doubled",
  init: "@count * 2",
  initExpr: { ... },
  structuralForm: true,
  isConst: true,
  span,
}
```

The legacy `@count = 0` path stays unchanged (does NOT set `structuralForm`). Per AST
contract, A1b/A1c distinguish via `structuralForm: true` vs absent/false.

### Existing test risk audit

`grep -rn 'kind.*"html-fragment"' compiler/tests/` finds two files: `substate-match-e2e.test.js`
(usage in comments only) and `dg-runtime-meta-html-fragment.test.js`. Inspection shows
the latter tests meta-block (`^{...}`) html-fragment behavior, NOT `${...}` decl-form.
**Should not regress.** The fix only changes behavior of `<NAME>=expr` at logic-block
statement-start position — meta blocks have a different parser path.

Will run full test suite after implementation to confirm 0 regressions.

### Compound block `<form> { ... }` — DEFERRED to Step 11

Recognizer matches `>` followed by `=` ONLY in Step 2. The `>` followed by `{` (compound
block) and `>` followed by `:` (typed) cases do NOT match the recognizer; they fall
through to the existing default html-fragment path. This is acceptable for Step 2 — those
forms are deferred to later steps per the AST-CONTRACTS decomposition.

## Implementation summary

### Files changed

- `compiler/src/ast-builder.js` — +155 LOC. One new helper function
  (`tryParseStructuralDecl`) + 4 call sites (Shape 1 + Shape 3 in both
  `parseOneStatement` and the top-level `parseLogicBody` loop).
- `compiler/tests/integration/parse-shapes-v0next.test.js` — +259 LOC. 15 new test
  cases covering Shapes 1+3 + 4 negative-guard cases + legacy baseline.

### Path discipline incident

Initial Edit calls used the main-repo path `/home/bryan-maclee/scrmlMaster/scrmlTS/...`
instead of the worktree path
`/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-af050f5215bc1340a/...`.
Caught when `git status` showed clean working tree despite making edits. Fix: reverted
main repo via `git -C /home/bryan-maclee/scrmlMaster/scrmlTS checkout HEAD -- compiler/src/ast-builder.js`,
then re-applied all 5 Edits to the correct worktree path. Lesson logged. PRE-BRIEF
compliance restored.

### Final test counts

- Baseline (before Step 2): 8,730 pass / 43 skip / 0 fail / 8,773 tests
- After implementation, BEFORE adding Step 2 tests: 8,730 pass / 43 skip / 0 fail / 8,773 tests
  (zero regressions — recognizer well-isolated)
- After adding Step 2 tests: 8,745 pass / 43 skip / 0 fail / 8,788 tests
  (= 8,730 + 15 new, all pass)

### Existing-test deltas

**0 rewrites / 0 drops.** The recognizer ONLY fires when `<` appears at statement-start
position followed by IDENT followed by `>` followed by `=`. No existing scrml input in
the test corpus has this exact shape — those that did were already producing
html-fragment (deceptive-success), and aren't asserted as positive tests. The audit's
F1c case (`${ <count> = 0 }`) was a one-off probe, not a baked test.

### Commits on branch

- `96e1590` — WIP(a1a-step-2): survey + design notes
- `d152d53` — WIP(a1a-step-2): tryParseStructuralDecl + recognizer hooks
- `5291ed8` — test(a1a-step-2): 15 cases for <NAME>=expr + const <NAME>=expr

### Step 2 DoD checklist

- [x] block-splitter.js — UNCHANGED (raw text already preserved correctly)
- [x] body-pre-parser.ts — UNCHANGED (inherits via parseLogicBody)
- [x] ast-builder.js — `tryParseStructuralDecl` helper + 4 call sites
- [x] parse-shapes-v0next.test.js — 15 new tests with anti-html-fragment guards
- [x] Pre-commit hook green
- [x] Full bun run test green: 8,745 pass / 43 skip / 0 fail
- [x] 0 regressions on existing 8,730 tests
- [x] Existing-test deltas: 0 rewrites / 0 drops
- [x] No --no-verify
- [x] progress.md complete with timestamps, survey, design choices, commits
- [x] Branch clean

### Notes for downstream Steps

**For Step 3 (rename `reactive-decl` → `state-decl`):** The new `structuralForm: true`
and `isConst: true` fields ride alongside existing `reactive-decl` fields. After rename,
both legacy (`@count = 0` → `state-decl, structuralForm: false`) and structural
(`<count> = 0` → `state-decl, structuralForm: true`) produce the same kind. Step 3
mechanics: replace `kind: "reactive-decl"` with `kind: "state-decl"` at all ~11
construction sites. ~100+ consumer-site updates expected (resolver, typer, codegen).

**For Step 4 (shape discriminant):** The `tryParseStructuralDecl` helper currently sets
only `structuralForm` and `isConst`. Step 4 should add the `shape` discriminant inline:
- `shape: "plain"` when `isConst === false`, `renderSpec === null` — the default
- `shape: "derived"` when `isConst === true`
The helper is the natural single point of insertion. `renderSpec` field is added in
Step 5 (Shape 2 markup RHS).

**For Step 5 (Shape 2 with bareword validators):** The recognizer's `peek(2)` check
will need to allow IDENT or KEYWORD tokens between `<NAME>` and `>` as bareword attrs
(e.g., `<userName req length(>=2)>`). This is a substantial extension; the helper's
single-point-of-update design supports it cleanly.

### Disambiguation lookahead window — DOCUMENTED

The Step 2 recognizer accepts EXACTLY this token shape at expression-statement-start:
```
PUNCT(<) IDENT PUNCT(>) PUNCT(=) [expr...]
```
or (no-whitespace, fused >=):
```
PUNCT(<) IDENT OPERATOR(>=) [expr...]
```

It rejects:
- Tokens between IDENT and `>` (e.g., bareword attrs like `req`) — Step 5
- `:` after `>` (typed annotation) — Step 5/6
- `{` after `>` (compound block) — Step 11
- IDENT not preceded by `<` (e.g., `count = 0` — that's tilde-decl)
- `<` not followed by IDENT (e.g., `<` followed by space then IDENT — markup-style state opener)
- `<` followed by IDENT followed by anything other than `>` or `>=`

