# BRIEF — ss40: `@apply` utility-composition build (bug-1 W2)

**Dispatched by:** sPA ss40 · **Land branch:** `spa/ss40` · **Agent:** scrml-js-codegen-engineer, `isolation:"worktree"`, model opus.

You are in your OWN `isolation:worktree` (off `origin/main` @ `7d8b527a`). **PATH DISCIPLINE:** edit only via paths relative to YOUR worktree root; verify `git rev-parse --show-toplevel` before writes. NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/...` (main — a live PA session). Do NOT touch `main`, do NOT push, do NOT `--no-verify`. **Commit INCREMENTALLY** (one commit per item where sensible — survey-doc, parser, expansion, diagnostics+banner, tests) — your branch + commits are your crash-recovery anchor.

## What this is
**W2 (the build)** of the bug-1 `@apply` arc. **W1 (SPEC §26.8) already landed S223** — the design is RATIFIED, do NOT re-derive it. Build to the spec. The feature: recognize `@apply <tokens>;` inside a `#{}`/`<style>` CSS rule body and expand each token's CSS declarations inline into the enclosing rule.

## AUTHORITY — READ FIRST IN FULL (Rule 4)
- **`compiler/SPEC.md` §26.8** IN FULL — the normative contract: §26.8.1 statements · §26.8.2 v1 scope · §26.8.3 the 3 named codes · §26.8.4 vs-safelist. (Use SPEC-INDEX.md to find the line range; read the WHOLE section, don't skim.)
- **`docs/changes/bug-1-tailwind-apply-2026-06-26/SCOPE.md`** — the located fire-sites + design rationale.
Do NOT decide design questions — they're ratified. If you hit something §26.8 genuinely doesn't cover, STOP and report it as a park (don't invent).

## KEY de-risk (confirmed in scoping — build on it)
Per-utility resolution ALREADY exists: `tailwind-classes.js:2656` `getTailwindCSSWithDiagnostic(className)` → `{ css, diagnostic }` where `css` is a full `.<sel> { <decls> }` rule. **Composing families (ring/shadow/gradient/transform/filter) compose FOR FREE** because each per-utility CSS already embeds the `--tw-*` setters + the `var()` shorthand — inlining concatenates them correctly. You are NOT writing a Tailwind resolver; you are recognizing the directive + extracting & inlining decls + wiring 3 diagnostics.

## Located loci (confirm in the survey, then build)
- **Expansion site:** `compiler/src/codegen/emit-css.ts:82` `renderCssBlock(block)` iterates `block.rules`; at **line ~87-88** a `rule.atRule` is pushed VERBATIM → today `@apply px-4;` emits as an invalid at-rule (the SCOPE §2 passthrough hypothesis). This is where expansion happens.
- **Parse site (LOCATE in item 0):** `compiler/native-parser/parse-css-body.js` (PRIMARY candidate — the `#{}`/`<style>` CSS-body parser) and/or `compiler/src/ast-builder.js` (secondary). Find where `block.rules` entries (incl. the `{atRule}` node) are produced for the LIVE compile path. ⚠ native-parser `.js`/`.scrml` mirrors can be feature-stale — confirm which path the real compile uses (compile a fixture, trace which producer runs).
- **Resolver:** `compiler/src/tailwind-classes.js:2656` `getTailwindCSSWithDiagnostic`.
- **Diagnostics catalog:** `compiler/SPEC.md` §34 (add 3 rows) + `compiler/SPEC-INDEX.md` (regen the §34 row if code ranges shift).

---

## Item 0 — SURVEY (report findings; build only after, no STOP unless a genuine surprise)
The design is ratified, so survey informs HOW not WHETHER — survey then build in the same run. Report:
- (a) **Current `@apply` disposition** — confirm it passes through `renderCssBlock` as an `atRule` verbatim (vs rejected/swallowed).
- (b) **Parse site** — exactly where `#{}`/`<style>` → `block.rules` (`{selector,declarations[]}` / `{atRule}`). That's where `@apply <tokens>;` must become a tagged declaration node (e.g. `{apply:[...tokens], loc}`) instead of an at-rule. Confirm the LIVE path (legacy vs native).
- (c) **Declaration extraction** — confirm the clean way to extract just `<decls>` from the `getTailwindCSSWithDiagnostic` `.<sel> { <decls> }` output, AND that multi-rule output is detectable (for the F4 reject).
- (d) **Arbitrary-value free-ness** — confirm `getTailwindCSSWithDiagnostic("bg-[#1da1f2]")` resolves (so `@apply bg-[#1da1f2]` is free).
- (e) **Variant detection** — how to detect a variant-prefixed token (`hover:`/`md:`/`group-hover:`, §26.3) to fire `E-APPLY-VARIANT-UNSUPPORTED`.
**STOP + park ONLY** if a de-risk fails (e.g. composing doesn't compose, or the parse site is radically different from both candidates) — otherwise proceed.

## Item 1 — Recognize `@apply` in the CSS-block parser
At the parse site (0b): `@apply <whitespace-separated tokens>;` inside a rule body → a tagged declaration node carrying the token list + `loc`. NO expansion here (keep the registry dependency in codegen). `loc` is REQUIRED (diagnostics need a fire-site location).

## Item 2 — Expand `@apply` in `emit-css.ts:renderCssBlock`
For an apply-node declaration: resolve each token via `getTailwindCSSWithDiagnostic`, extract its declarations (0c), inline them into the enclosing rule **in source order**. Composing families compose by concatenation (the §26.7 `var()` setters + shorthand are already in the per-utility CSS). `@apply` mixed with hand-written declarations in the same rule → BOTH emit. Multiple `@apply` lines in one rule → all expand in order. No verbatim `@apply` survives in output.

## Item 3 — 3 `E-APPLY-*` diagnostics + §34 + flip §26.8 banner (ALL IN THIS CHANGE)
- `E-APPLY-UNKNOWN-UTILITY` (token doesn't resolve) · `E-APPLY-VARIANT-UNSUPPORTED` (variant-prefixed token, v1 scope) · `E-APPLY-NON-INLINABLE-UTILITY` (registry output is >1 flat rule, e.g. a prose/`::before` utility). All **Error**, each with `loc`.
- Add the 3 rows to **SPEC §34** in the SAME change that implements them (Rule 4, §60/§61 precedent). Regen **SPEC-INDEX.md** if ranges shift.
- **Flip the §26.8 Nominal banner → implemented.**
- Update the **bug-1 known-gaps entry** → RESOLVED (or "W2 landed"), and regen the §0 count (`bun scripts/state.ts --write`) if the gap flips.

## Item 4 — Tests + dogfood (R26 + ADVERSARIAL, S215)
Construct edge repros — do NOT just happy-path:
- per-token expansion (`@apply px-4 py-2 rounded-md bg-blue-500 text-white` → inlined decls, no verbatim `@apply`)
- **composing** `@apply ring-2 shadow-lg` → assert ONE `box-shadow: var(),var(),var()` (or the §26.7 shorthand) + BOTH setters present (NOT last-write-wins)
- arbitrary `@apply bg-[#1da1f2]` (free)
- unknown `@apply flexx` → `E-APPLY-UNKNOWN-UTILITY`
- variant `@apply hover:bg-blue-500` → `E-APPLY-VARIANT-UNSUPPORTED`
- a prose/`::before` multi-rule utility → `E-APPLY-NON-INLINABLE-UTILITY`
- `@apply` with NO tokens
- multiple `@apply` lines in one rule
- `@apply` mixed with hand-written decls in the same rule
- a **dogfood `.scrml`** (a `.btn`/`.card` example): compile, inspect emitted CSS; plus the §26.8 spec sample.
- **R26:** verify against the REAL emitted CSS (recompile), not synthesized AST. **FULL `bun run test`** (NOT just the pre-commit subset), green.

## RETURN (final message = structured data for the sPA)
(a) Survey findings (0a-0e, esp. the confirmed parse site + live path); (b) per-item status (done/parked + why); (c) files changed (worktree-relative) + per-item commit SHAs; (d) full-suite result (pass/fail counts); (e) the adversarial-edge results (each E-APPLY-* repro + the composing assertion); (f) confirmation the §26.8 banner + §34 + known-gaps/§0-count all flipped; (g) your branch name + final tip SHA.
