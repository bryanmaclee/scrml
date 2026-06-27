# bug-1 `@apply` — utility composition in author CSS: implementation scoping

**Status:** SCOPE (S223, PA) @ HEAD `5fb41cb9` / 2026-06-26. Authority: bug-1 (`docs/known-gaps.md`, MED, the SOLE remaining sub-arc) + user lean S221 (*"I like @apply TBH"*). Gates on the design forks in §4 (user ruling).

## 0. What this is — and the de-risk

bug-1 (Tailwind arbitrary-value classes) has been whittled to ONE remaining sub-arc: the **safelist/@apply mechanism**. Everything else landed S108–S210 (grid/flex/aspect/transition/transforms/ring/gradient/filter/string-shaped/ring-offset; the §26.7 var()-composition foundation). The user picked **@apply** from the 3 parked approaches (safelist-config-knob · @apply · `#{}`-scan-suppression).

**Two of the three approaches are already partly resolved — which sharpens what @apply is FOR:**
- **`#{}`-scan-suppression is ALREADY DONE.** scrml already has a CSS-authoring surface (`#{}` blocks + `<style>` sugar that `api.js` converts to `#{}`), and `findUnrecognizedClasses` (`tailwind-classes.js:3189+`) already recognizes author-defined classes there → a class defined in `#{}`/`<style>` draws **no** `W-TAILWIND-UNRECOGNIZED-CLASS`. **The false-positive problem is already solved.**
- **safelist** solves a DIFFERENT problem (force-GENERATE a utility's CSS even when it's only ever referenced dynamically, e.g. `bg-${color}`) → **out of scope here** (see §6).
- So **@apply's job is the ergonomic**: let an author COMPOSE utilities into a named class in their own CSS (DRY), instead of repeating utility lists in every `class=` or hand-writing raw declarations.

**The de-risk (why this is small, not a new pipeline):**
1. The CSS surface already exists (`#{}`/`<style>` → structured `block.rules` of `{selector, declarations[]}`; rendered by `emit-css.ts:renderCssBlock`).
2. **Per-utility resolution already exists:** `getTailwindCSSWithDiagnostic(cls)` → `{ css, diagnostic }` returns the full CSS rule for ONE utility token (the same machinery `getAllUsedCSS` uses for scanned classes).
3. **Composing-family composition is FREE:** the per-utility CSS for ring/shadow/gradient/transform/filter already embeds the §26.7 `--tw-*` setters + the `var()` shorthand — so `@apply ring-2 shadow-lg` composes correctly just by concatenating the resolved declarations. No special handling.

So `@apply` = **parse a directive inside the existing CSS-block rule body + reuse the existing per-utility resolver + inline the declarations.** Not a new Tailwind pipeline.

## 1. Semantics (worked code — reason about this)

**Input** (`#{}` block + dynamic + static use):
```scrml
#{
  .btn  { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }
  .card { @apply ring-2 shadow-lg; }          /* composing family */
}

<button class="btn">Save</button>
<div class="${active ? 'card' : ''}">…</div>   /* dynamically applied — still works: .card is a real rule */
```

**Emitted CSS** (the `@apply` lines expand; the `.btn`/`.card` selectors stay):
```css
.btn  { padding-left:1rem; padding-right:1rem; padding-top:.5rem; padding-bottom:.5rem;
        border-radius:.375rem; background-color:#3b82f6; color:#fff; }
.card { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width,0px)) var(--tw-ring-color,currentColor);
        --tw-shadow: 0 10px 15px -3px rgb(0 0 0/.1), 0 4px 6px -4px rgb(0 0 0/.1);
        box-shadow: var(--tw-ring-offset-shadow,0 0 #0000), var(--tw-ring-shadow,0 0 #0000), var(--tw-shadow,0 0 #0000); }
```
`.btn`/`.card` are author-defined → no `W-TAILWIND-UNRECOGNIZED-CLASS`; now backed by real composed CSS; the composing family (`.card`) composes ring AND shadow correctly (the §26.7 win, for free).

## 2. The problem with the current behavior (verify in W2 survey)
`@apply px-4 …` begins with `@` → the CSS-block parser most likely buckets it as an **`atRule` passthrough** (`renderCssBlock` line 87: `if (rule.atRule) ruleParts.push(rule.atRule)`), emitting `@apply px-4 py-2;` **verbatim** into the stylesheet — invalid CSS (browsers don't implement `@apply`; it was a Tailwind v2 *build-time* directive). So the v1 fix also closes a latent emit-garbage path. (Confirm the exact current disposition first — atRule passthrough vs rejected vs swallowed.)

## 3. Implementation footprint
- **Parse site** — wherever `#{}`/`<style>` is parsed into `block.rules` (NOT `emit-css.ts`, which only renders; find the css-block parser — likely `api.js` `<style>`→`#{}` pre-process + the `#{}` rule parser). Recognize `@apply <token-list>;` inside a rule body → emit a tagged declaration node `{ apply: ["px-4","py-2",…], loc }` instead of an at-rule passthrough.
- **Resolver + expand** — `emit-css.ts:renderCssBlock`: when a declaration is an `apply` node, for each token call `getTailwindCSSWithDiagnostic(token)`, **extract the declaration body** from the returned `.<sel> { <decls> }` rule, inline the decls into the current rule (concatenation composes the §26.7 families for free). Keep the registry dependency in codegen (where `getAllUsedCSS` already lives).
- **Diagnostic** — an unknown token in `@apply` produces NO declarations → a silently-broken class → should be a HARD error (see fork F3). Use the `diagnostic` already returned by `getTailwindCSSWithDiagnostic`.
- **SPEC** — new **§26.8 "`@apply` — utility composition in author CSS"** (Nominal-spec-ahead W1; impl flips the banner). No §34 code lands until impl (Rule 4, like §60/§61).
- **Lint** — the `@apply`'d class name is already author-defined/recognized (no change needed); only the per-token validity is new.

## 4. Design forks — NEED A RULING (the buildable decisions)

- **F1 — Variants in `@apply` (v1 scope).** `@apply hover:bg-blue-500` needs a NESTED selector (`.btn:hover { … }` or `.btn { &:hover { … } }`), not flat inlining. **Recommend: v1 = BARE utilities only** (covers the DRY-composition 80%; limit-primitives); variants = a bounded follow-on. Fire `E-APPLY-VARIANT-UNSUPPORTED` (or W-) on a variant token in v1.
- **F2 — Arbitrary values in `@apply`.** `@apply bg-[#1da1f2]` — `getTailwindCSSWithDiagnostic` already resolves arbitrary values, so this is likely **free**. **Recommend: allow** (confirm in W2 survey; no extra work expected).
- **F3 — Diagnostic severity for an unknown utility in `@apply`.** A typo'd token (`@apply flexx`) yields a broken class. **Recommend: a dedicated `E-APPLY-UNKNOWN-UTILITY` (Error)** — harder than the info-level `W-TAILWIND-UNRECOGNIZED-CLASS` used for `class=` scanning, because in `@apply` an unresolved token silently drops declarations (a composition the author explicitly asked for). Surfacing the axis: `class=` unrecognized = info (might be a custom class); `@apply` unrecognized = error (must be a real utility).
- **F4 — Multi-rule / pseudo-element utilities.** A utility whose CSS is more than one flat rule (e.g. a `::before`-bearing or prose utility) can't be flat-inlined. **Recommend: v1 rejects** (`E-APPLY-NON-INLINABLE-UTILITY`) — bare single-rule utilities only; bank the rest.

## 5. Recommended decomposition
- **W1 — SPEC §26.8 (Nominal).** PA-author or 1 dispatch: placement (inside `#{}`/`<style>` rule bodies), semantics (expand → inline declarations; §26.7 families compose), the v1 scope per F1–F4, the planned `E-APPLY-*` codes (named, land with impl). Small (~60-100 SPEC lines).
- **W2 — build (1 sPA dispatch, SURVEY-FIRST).** Survey: (a) current `@apply` disposition (§2); (b) where `block.rules` is parsed (the parse site); (c) F2 arbitrary-value free-ness; (d) the declaration-extraction shape from `getTailwindCSSWithDiagnostic`. Then: parser tag + `renderCssBlock` expansion + the `E-APPLY-*` diagnostics. R26 + adversarial (S215).
- **W3 — tests + dogfood.** Unit (per-token expansion · composing-family `ring+shadow` · unknown-token error · variant/multi-rule rejection) + a dogfood `.scrml` + the §26.8 sample. Full `bun test`.

## 6. Out of scope (route separately)
- **safelist** (force-generate a utility referenced only dynamically, `bg-${color}`) — a DIFFERENT problem (generation, not composition); the §26.5.1 dynamic-fragment LINT side is already handled. Bank as its own item if adopter friction surfaces (the config-knob shape: `scrml.toml [tailwind] safelist=[…]`).
- **Variants / multi-rule utilities in `@apply`** — v1-deferred per F1/F4; bounded follow-ons.

## Links
- Gap: `docs/known-gaps.md` bug-1 (`@gap id=bug-1 sev=MED`)
- SPEC: §26.5 Open Items (the deferral) · §26.7 composing var() model (reused for free) · §26.1/§26.2 "only what's used" minimalism axiom
- Code: `compiler/src/tailwind-classes.js` (`getTailwindCSSWithDiagnostic` per-utility resolver · `findUnrecognizedClasses` author-defined-class recognition) · `compiler/src/codegen/emit-css.ts` (`renderCssBlock`/`generateCss`) · `compiler/src/api.js` (`<style>`→`#{}` pre-process)
- User lean: user-voice S221 ("I like @apply TBH")
