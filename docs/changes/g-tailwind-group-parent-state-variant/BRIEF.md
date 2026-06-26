# BRIEF — ss29 item 3: g-tailwind-group-parent-state-variant

**Dispatched by sPA ss29 · branch `spa/ss29` (item 1 landed `00fd6e40`) · S221 (flogence S14).** Agent: `scrml-js-codegen-engineer`, `isolation: worktree`, `model: opus`. **Heaviest item — a NEW variant KIND.**

## Goal
`group` + `group-hover:X` are unsupported: both fire `W-TAILWIND-UNRECOGNIZED-CLASS`, `group-hover:` also fires `W-TAILWIND-001` (ghost), and NO CSS is generated. Unlike a single-element `hover:X` (a `:pseudo` SUFFIX on the element), `group-hover:X` is a **PARENT-STATE** variant needing a **descendant-combinator** selector. Add a new variant KIND.

## The required emission (Tailwind v3 semantics)
- `group-hover:p-4` → `.group:hover .group-hover\:p-4 { padding: 1rem }` — the base utility's declarations, wrapped in a **descendant combinator** under `.group:hover`. (Distinct from the pseudo path `.hover\:p-4:hover{}` and the media path.)
- `group` itself → a **marker class**: RECOGNIZED (so it does NOT ghost-lint) but emits **no CSS rule** (Tailwind emits nothing for `.group`; it's only a hook). Register it as recognized-with-empty-output (or add to the recognized-set the lint consults) — confirm it draws neither `W-TAILWIND-UNRECOGNIZED-CLASS` nor `W-TAILWIND-001`.
- **Scope: `group-{state}` for the full `STATE_PSEUDO_CLASSES` set** (`group-hover`, `group-focus`, `group-active`, `group-disabled`, …) via the SAME parent-state mechanism — the uniform fix, not just `group-hover`. (`peer-*` sibling-state is OUT of scope — leave it deferred; only `group-*` here.) Compose with responsive/theme variants where the existing variant stacking allows (`md:group-hover:X` if the stack supports it — mirror how pseudo variants stack; if non-trivial, scope to bare `group-{state}:X` and note the stacking limit).

## Locus + mechanism (compiler/src/tailwind-classes.js)
- `parseClassName(className)` (the variant parser, ~`:2535`) currently returns `hasUnrecognizedPrefix=true` for `group-hover:` → the resolver returns `{ css: null }` (no rule) and `findUnsupportedTailwindShapes` fires `W-TAILWIND-001`. You must teach the parser to recognize a `group-{state}` prefix as a NEW variant kind (e.g. `kind: "parent-state"` alongside the existing pseudo/media kinds — grep how `STATE_PSEUDO_CLASSES` (`:1544`) variants are parsed + lowered).
- Add the descendant-combinator emission: when a class has a `parent-state` variant, wrap the resolved base rule's declarations in `.group:<pseudo> .<escaped-full-class> { … }` (NOT a pseudo-suffix on the class). Reuse `escapeCssClass` for the `\:` escaping of the full token (e.g. `group-hover\:p-4`).
- `group` marker: add to the recognized set so neither lint fires; no CSS body.
- `W-TAILWIND-001` detector (`findUnsupportedTailwindShapes`) + `W-TAILWIND-UNRECOGNIZED-CLASS` (`findUnrecognizedClasses`): both must STOP firing on `group`/`group-{state}:X` now that they resolve. Both go through `getTailwindCSS()`, so a resolving class auto-clears — but VERIFY (the gap notes `group-hover` is explicitly cited as a W-TAILWIND-001 example at the `:3060` doc-comment region; confirm no hardcoded group exclusion at `:2537`/`:3060` suppresses the new path — if a literal `group` exclusion exists, remove it).

## SPEC §26 amendment (Rule 4 currency — MINIMAL; FLAG for PA ratification)
§26.5 "Open Items" (`compiler/SPEC.md` ~L16262) currently DEFERS this and normatively MANDATES the warning:
- `"- group-* and peer-* parent/sibling-state variants — TBD (SPEC-ISSUE-012)."` → amend to: `peer-*` stays TBD; `group-*` is now SUPPORTED (cross-ref §26.3).
- The normative line `"the compiler SHALL emit W-TAILWIND-001 ... (e.g. group-hover:p-4 ...)"` → update the example so it no longer cites the now-supported `group-hover:p-4` (use a still-deferred example like `peer-hover:p-4` or a custom-theme prefix).
- §26.3 "Variant Prefixes" (~L16180) → add a minimal normative entry for the `group-{state}` parent-state variant + its descendant-combinator semantic (`.group:state .group-state\:util {}`).
**Keep the SPEC change MINIMAL + surgical.** This un-defers part of an open SPEC-ISSUE-012 — **FLAG it explicitly in your DONE report** so the sPA escalates the normative-text wording to the PA for ratification (the sPA does not author SPEC normative text for a new variant kind unilaterally — the ss18 §61.5 model).

## Test (lands with this item)
Mirror the existing tailwind generated-CSS tests. Assert: `group-hover:p-4` emits `.group:hover .group-hover\:p-4 { padding: … }` (descendant combinator, not pseudo-suffix); `group` is recognized (no lint) + emits no rule; `group-focus:`/`group-active:` work; NO `W-TAILWIND-001` / `W-TAILWIND-UNRECOGNIZED-CLASS` on `group`/`group-hover:X`; a still-deferred variant (`peer-hover:` or a custom prefix) STILL fires W-TAILWIND-001 (regression guard — you only un-deferred group).

## Verify before DONE
1. `cd <repo-root> && bun test compiler/tests/unit/<your new test>` — green (run from REPO ROOT — some doc-marker tests ENOENT from `compiler/`; that's a known CWD artifact, not a failure).
2. From repo root: `bun run test` — FULL suite. Compare your fail-set to the BASE: the ~23 CWD-artifact doc-marker fails are PRE-EXISTING (they pass from root); confirm you add ZERO new fails. Never `--no-verify`.
3. R26: compile a `group`/`group-hover:` repro, grep the generated CSS for `.group:hover .group-hover\:` , confirm the descendant rule + no ghost-lint. Paste evidence.

## F4 startup + path discipline
- FIRST: `pwd && git rev-parse --abbrev-ref HEAD && git status` — confirm your OWN `.claude/worktrees/agent-*` worktree (NOT a main checkout). Write ONLY inside it.
- **PULL IN item 1:** `git merge spa/ss29 --no-edit` (fast — pre-merge-commit). Confirm `grep -c 'registerTransition' compiler/src/tailwind-classes.js` > 0 (if 0, merge failed — STOP).
- Commit INCREMENTALLY (variant-kind parse+emit → group marker → lint clears → SPEC §26 → test); coupled code+test = one commit; clean `git status` before DONE.
- Report (final message = return value): branch · final SHA · item commit SHAs AFTER any merge commit (I cherry-pick those) · files changed · full-suite fail-set-vs-base · R26 evidence (descendant-combinator CSS + no ghost-lint) · **the §26.5/§26.3 SPEC amendment flagged for PA ratification**.