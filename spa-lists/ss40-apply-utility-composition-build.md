# ss40 — `@apply` utility-composition build (bug-1 W2) — SURVEY-FIRST

**Currency:** built S223 (PA) @ HEAD `5fb41cb9` / 2026-06-26. **FIREABLE.** This is **W2** (the build) of the bug-1 `@apply` arc — **W1 (SPEC §26.8, Nominal) landed S223**. Flips the §26.8 Nominal banner.

**Authority (READ FIRST, Rule 4):** SPEC **§26.8** IN FULL (the normative contract — §26.8.1 statements · §26.8.2 v1 scope · §26.8.3 the 3 named codes · §26.8.4 vs-safelist) + SCOPE `docs/changes/bug-1-tailwind-apply-2026-06-26/SCOPE.md` (the located fire-sites + the design rationale). Do NOT re-derive the design — it's ratified; build to it.

**Parallel-safety:** primary surface is `emit-css.ts` (the expansion) + the `#{}`/`<style>` CSS-block PARSER (the directive recognition). ⚠️ **the parse site may live in `ast-builder.js` / `api.js` — `ss39` also touches `ast-builder.js`.** If the survey (item 0) finds the `@apply` recognition lands in `ast-builder.js`, **intersect the file-set against any ss39 landing that touched `ast-builder.js` (S211)** — reconcile by hand, don't blind file-delta. The in-flight ss32/ss33 (emit-client) + ss34 (emit-server) are disjoint from `emit-css.ts`. Run sequentially.

**Fill-note:** the design is DONE (§26.8). The build: recognize `@apply <tokens>;` inside a `#{}`/`<style>` rule body, expand each token's CSS declarations inline into the enclosing rule (reusing the per-utility resolver + the §26.7 var()-composition), wire the 3 `E-APPLY-*` diagnostics into §34, flip the Nominal banner. **KEY de-risk (confirmed in scoping):** per-utility resolution already exists (`getTailwindCSSWithDiagnostic`); composing families (ring/shadow/gradient/transform/filter) compose FOR FREE because their per-utility CSS already embeds the `--tw-*` setters + the `var()` shorthand — inlining concatenates them correctly.

**Shared ingestion:** the `#{}`/`<style>` CSS-block parse → `block.rules` representation · `emit-css.ts:renderCssBlock` (the expansion site) · `tailwind-classes.js:getTailwindCSSWithDiagnostic` (the per-utility resolver, reused) · §34 (the 3 new codes).

**coreFiles:** `compiler/src/codegen/emit-css.ts` (`renderCssBlock`/`generateCss`) · the `#{}` CSS-block parser (LOCATE in survey — likely `compiler/src/api.js` `<style>`→`#{}` preprocess + the `#{}` rule parser, possibly `ast-builder.js`) · `compiler/src/tailwind-classes.js` (`getTailwindCSSWithDiagnostic`) · `compiler/SPEC.md` §26.8 (flip banner) + §34 (3 codes) · `compiler/SPEC-INDEX.md` (§34 row regen if codes shift ranges).

**Brief reminders:** the 3 `E-APPLY-*` codes (`E-APPLY-UNKNOWN-UTILITY`, `E-APPLY-VARIANT-UNSUPPORTED`, `E-APPLY-NON-INLINABLE-UTILITY` — all Error) land in §34 **in the same change** that implements them (Rule 4, §60/§61 precedent) + the §26.8 Nominal banner flips in the same landing. R26 + ADVERSARIAL (S215): construct edge repros — `@apply ring-2 shadow-lg` (composing must compose, not last-write-wins), `@apply bg-[#1da1f2]` (arbitrary), `@apply flexx` (unknown→Error), `@apply hover:bg-blue-500` (variant→Error), a prose/`::before` utility (multi-rule→Error), an `@apply` with NO tokens, multiple `@apply` lines in one rule, `@apply` mixed with hand-written declarations in the same rule. Full `bun run test` (NOT just the pre-commit subset). Diagnostics need a `loc` for the fire site.

## Items

0. **SURVEY (report before building)** `[status=open]` **SURVEY-FIRST**
   - (a) **Current `@apply` disposition:** does `@apply px-4 …` currently pass through `renderCssBlock` as an `atRule` verbatim (emitting invalid CSS), get rejected, or get swallowed? (SCOPE §2 hypothesis: at-rule passthrough.)
   - (b) **Parse site:** where is the `#{}`/`<style>` block parsed into `block.rules` (`{selector, declarations[]}` / `{atRule}`)? That's where `@apply <tokens>;` must be recognized as a tagged declaration node (e.g. `{apply:[...], loc}`) instead of an at-rule passthrough.
   - (c) **Declaration extraction:** `getTailwindCSSWithDiagnostic(token)` returns a full `.<sel> { <decls> }` rule — confirm the clean way to extract just `<decls>` to inline (and that multi-rule output is detectable for the F4 `E-APPLY-NON-INLINABLE-UTILITY` reject).
   - (d) **Arbitrary-value free-ness (F2):** confirm `getTailwindCSSWithDiagnostic("bg-[#1da1f2]")` resolves so `@apply bg-[#1da1f2]` is free.
   - (e) **Variant detection (F1):** how to detect a variant-prefixed token (`hover:`, `md:`, `group-hover:` — §26.3) to fire `E-APPLY-VARIANT-UNSUPPORTED`.
   - Report the parse-site + the expansion shape + any surprise BEFORE building.

1. **Recognize the `@apply` directive in the `#{}`/`<style>` rule parser** `[status=open]`
   - At the parse site (item 0b): a `@apply <whitespace-separated tokens>;` declaration inside a rule body → a tagged declaration node carrying the token list + `loc`. No expansion here (keep the registry dependency in codegen).

2. **Expand `@apply` in `emit-css.ts:renderCssBlock`** `[status=open]`
   - For an apply-node declaration: resolve each token via `getTailwindCSSWithDiagnostic`, extract its declarations (item 0c), inline them into the enclosing rule in source order. Composing families compose by concatenation (the §26.7 setters + shorthand are in the per-utility CSS). Mixed with hand-written decls in the same rule = both emit.

3. **Wire the 3 `E-APPLY-*` diagnostics + §34 + flip the §26.8 banner** `[status=open]`
   - `E-APPLY-UNKNOWN-UTILITY` (token doesn't resolve) · `E-APPLY-VARIANT-UNSUPPORTED` (variant-prefixed token, v1) · `E-APPLY-NON-INLINABLE-UTILITY` (registry output is >1 flat rule). All Error, with `loc`. Add the 3 rows to §34 (regen SPEC-INDEX if ranges shift). Flip the §26.8 Nominal banner → implemented. Update the bug-1 known-gaps entry → RESOLVED (or note W2 landed) + §0 count regen (`bun scripts/state.ts --write`) if the gap flips.

4. **Tests + dogfood** `[status=open]`
   - Unit: per-token expansion · composing-family `@apply ring-2 shadow-lg` (assert the var() shorthand + both setters present) · arbitrary `@apply bg-[#1da1f2]` · unknown→Error · variant→Error · multi-rule→Error · empty-`@apply` · multiple `@apply` in one rule · `@apply` + hand-written decls. A dogfood `.scrml` (a `.btn`/`.card` example, compiled, CSS inspected) + the §26.8 sample. R26 + full `bun run test`.

## Acceptance
`@apply px-4 py-2 rounded-md bg-blue-500 text-white` in a `#{}` rule emits the inlined declarations (no verbatim `@apply` in output); `@apply ring-2 shadow-lg` composes (one `box-shadow: var(),var(),var()` + both setters); the 3 `E-APPLY-*` codes fire on their repros with a `loc`; the §26.8 Nominal banner is flipped; full suite green; bug-1 flips (W2 = the last @apply remainder).
