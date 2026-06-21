# BRIEF — g-interp-in-raw-content (sPA ss11, item 1)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Base SHA:** 0a605d3e · **Land target (sPA-owned):** branch `spa/ss11` via file-delta

## Goal
Add a `W-INTERP-IN-RAW-CONTENT` **info-lint** that fires when a `${...}`- or `<Tag>`-shaped
scrml token appears inside the body of a raw-content element (`<pre>` / `<code>`, SPEC §4.17).
Today the body emits LITERALLY with zero diagnostic — an author reaching for `<pre>${board}</pre>`
ships broken output and gets no signal (Flux dog-food S193; worked around with `<div class='whitespace-pre'>`).
SPEC §4.17 keeping the body raw is CORRECT; the defect is the SILENCE. Steer the author to
`<div class='whitespace-pre'>` or explicit escaping.

## Where
- **Fire site:** `compiler/src/block-splitter.js` ~L3135-3178 — the `RAW_CONTENT_ELEMENTS.has(lowerTagName)`
  branch captures the raw body as a single text run (`source.slice(contentStart, contentEnd)` -> a `text`
  child). That captured `raw` string is what you scan.
- **Lint precedent (model the shape on this):** `compiler/src/lint-w-each-promotable.js` (a standalone
  W-lint module) + `compiler/src/api.js` (how lints reach `result.warnings`). Decide the cleanest home:
  either a new `lint-w-interp-in-raw-content.js` walking the block-split AST for raw-content nodes whose
  text child matches the token shape, OR inline at the capture site. Pick whichever wires most cleanly
  into the existing warning stream - justify in your progress note.

## Detection
Inside a `<pre>`/`<code>` raw body, flag if the captured text contains a token-shaped run:
- `${ ... }` interpolation, OR
- `<` immediately followed by an uppercase letter (`<[A-Z]`) - a component-ref shape, OR
- the scrml block sigils that §4.17 lists as inert there: `?{` `#{` `!{` `^{` `_{`.
Be conservative: a literal `<` followed by lowercase (real HTML the author wants shown) is NOT flagged
unless it's a known scrml sigil. False positives are worse than misses for an info-lint - but `${` is
unambiguous, lead with that.

## Diagnostic-stream partition (MANDATORY - memory feedback_diagnostic_stream_partition)
`W-` / `I-` prefix + `severity: "warning"` (or `"info"`) -> MUST land in `result.warnings`, NOT
`result.errors`. Code = `W-INTERP-IN-RAW-CONTENT`. Message names the element + steers to
`<div class='whitespace-pre'>` / explicit escaping. Info-level (non-fatal; CLI exit stays 0).

## Acceptance (compile-verify, R26)
1. A repro `<pre>${board}</pre>` (and a `<code>${x}</code>` repro) fires exactly one
   `W-INTERP-IN-RAW-CONTENT` in `result.warnings`, exit 0.
2. A clean `<pre>plain text 2 < 3</pre>` (no token shapes) fires NOTHING - no false positive on a bare `<`.
3. `<div class='whitespace-pre'>${board}</div>` (the steer target) is unaffected - interpolation works, no lint.
4. Add a regression test in the existing lint/diagnostic test suite. Use a real source string compiled
   end-to-end (NOT a hand-built AST - memory feedback_r26_empirical_verification: AST-synth tests miss
   block-splitter bugs). Cross-stream assert: check `result.warnings` for the code, not `result.errors`.
5. Full `bun run test` green (block-splitter + codegen are load-bearing).

## SHARED DISCIPLINE BLOCK
See the dispatch prompt for the startup-F4 verify, path-discipline (no main-absolute writes; stat+read-back),
incremental commits, progress.md, no `--no-verify` block.
