# A+ verdict #1+#2 — Survey Note

**Authority:** S64 debate-04 verdict A+ (3-of-3 unanimous, judge-ratified). Three execution improvements; #3 (doc-only) landed in S65 commit `814983d`. This dispatch ships #1 + #2.

## Finding 1: E-SWITCH-FORBIDDEN does not exist today

Searched `compiler/src/`, SPEC.md, and changelog. Findings:

- `compiler/src/ast-builder.js` parses `switch` silently — line 4379 (and duplicate at 6753) accepts the `switch` keyword identically to `match`/`try`, attaches a `switch-stmt` node with no error.
- `compiler/src/expression-parser.ts:2064` lists `switch` as a reserved STOP keyword (so it's not emitted as an identifier), but no diagnostic fires.
- `compiler/SPEC.md` E-ERROR-006 / E-ERROR-007 are documented for **other** purposes (renders-clause undefined ref; nested transactions). The ast-builder reuses these codes for `throw`/`try` rejection — that's a pre-existing minor inconsistency, but **not** ours to fix.
- Gauntlet sample `phase2-switch-statement-071.expected.json` expects `expectedCodes: ["UNKNOWN"]`, confirming no specific code was wired.
- `throw` and `try` get hard-error treatment at the same two ast-builder.js parse-sites with informative messages. **Pattern to mirror.**

**Implementation:** Add hard-error emission at both parse-sites (4379, 6753) gated on `keyword === "switch"`, using new code `E-SWITCH-FORBIDDEN`. Enriched message text per debate-04 verdict ("Did you mean: `<match for=Type>` … or `match expr {}` …").

## Finding 2: W-LIFECYCLE-CANDIDATE lint is not implemented today

Searched the entire codebase. The lint is **documented** (PA-PRIMER §1, kickstarter v1/v2, changelog, SPEC §28 lint-suppression config slot) but **no compiler code emits it**. The S64 hand-off explicitly lists it as a v0.next-pending item.

**Implementation:** Add as a new pattern in `lint-ghost-patterns.js`. The lint-ghost-patterns.js infrastructure is the right home — it's regex-based, runs as a pre-pass, emits warnings (not fatal), and is already integrated via `compileScrml()` lintDiagnostics field. This dispatch implements the **tightened** form per the verdict (string-discriminator-trap detection).

## Finding 3: Quickfix infrastructure

There is **no LSP/code-action quickfix infrastructure** in the compiler today. Diagnostics are plain text messages. The verdict's "did-you-mean: match quickfix" therefore reduces to **enriched-message-text** for v0.next. Acceptable per the dispatch brief.

## Tightening predicate (chosen)

A state cell `<NAME>[: Type] = "VALUE"` triggers W-LIFECYCLE-CANDIDATE when:

- RHS is a string literal (single- or double-quoted)
- VALUE matches `/^[A-Z][A-Za-z0-9]*$/` — single-word, initial-uppercase, alphanumeric only

This catches `"Loading"`, `"Idle"`, `"Error"`, `"Success"`, `"Pending"`, `"InProgress"`. It does NOT fire on:

- `"loading"` (lowercase — looks like a status-string, but not enum-tag-shaped)
- `"alice"` (proper noun string but lowercase initial)
- `"hello world"` (multi-word with space)
- `0`, `false`, `null` (non-string)
- `"some-id-42"` (kebab/contains hyphens)

**Edge-case decision:** lowercase initial does NOT fire even though `<status> = "loading"` is also a candidate. Rationale: false-positive cost is high (any lowercase word string would trip it: `"red"`, `"left"`, `"normal"`). The initial-uppercase predicate is the lexical tell that the developer is *thinking in tags* — exactly the string-discriminator trap from debate-04.

**Documented rule for users:** "Initial-uppercase string literal RHS on a state cell signals enum-tag intent — promote to a real enum."

## False-positive risks

- A cell holding a literal proper noun: `<currentUser> = "Alice"`. Single-word + initial-cap. Predicate would fire. Mitigation: lint is a **warning**, message references the lifecycle/promotion concept; the developer can ignore. Future: a `lint.lifecycle-candidate = "off" | "warn" | "error"` SPEC §28 setting (already documented).
- Country/code constants: `<region> = "USA"`. Same risk, same mitigation.

This is acceptable. The lint is a nudge, not a blocker. No code change blocks compilation.

## Implementation plan

1. Add E-SWITCH-FORBIDDEN at both ast-builder.js parse-sites — small surgical edit.
2. Add W-LINT-016 (W-LIFECYCLE-CANDIDATE) as new entry in lint-ghost-patterns.js PATTERNS table. Custom predicate (not pure regex — needs paired decl-site + use-site detection, OR decl-site alone with the lexical tag-shape predicate; choosing decl-site-alone for simplicity + because the lexical signal is sufficient per the predicate above).
3. Tests in `compiler/tests/unit/a-plus-verdict.test.js`.
4. Progress + commits.
