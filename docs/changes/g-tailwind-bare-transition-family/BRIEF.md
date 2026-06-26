# BRIEF — ss29 item 1: g-tailwind-bare-transition-family

**Dispatched by sPA ss29 · branch `spa/ss29` · S221 (flogence S14).** Agent: `scrml-js-codegen-engineer`, `isolation: worktree`, `model: opus`.

## Goal
Bare/named-scale `transition` / `duration-{N}` / `ease-{named}` / `delay-{N}` Tailwind utilities currently produce **NO CSS** (only the arbitrary-bracket forms `transition-[…]`/`duration-[200ms]` resolve, via `ARBITRARY_PROP_MAP` at `compiler/src/tailwind-classes.js:1686-1689`). Same failure mode as bug-1: the class compiles, ghost-lints `W-TAILWIND-UNRECOGNIZED-CLASS` + `W-TAILWIND-001`, renders nothing. **Fix = pure static-registry extension** (no new variant machinery).

## The pattern to mirror
`compiler/src/tailwind-classes.js` populates a static `registry` (a `Map`) via `register*()` functions — `registerSpacing()`, `registerTransform()` (L825), etc. — each: `registry.set(className, \`.${escapeCssClass(className)} { <decls> }\`)`. Add a **`registerTransition()`** in the same style and call it where the other `register*()` are invoked (grep the init site that calls `registerTransform()`).

## Entries to add (Tailwind v3 values — verify against SPEC §26, the Tailwind subset; Rule 4)
- **`transition`** → `transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;`
- **`transition-all`** → `transition-property: all;` + the same default timing + duration
- **`transition-colors`** → `transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;` + default timing + duration
- **`transition-opacity`** → `transition-property: opacity;` + default timing + duration
- **`transition-shadow`** → `transition-property: box-shadow;` + default timing + duration
- **`transition-transform`** → `transition-property: transform;` + default timing + duration
- **`transition-none`** → `transition-property: none;` (no timing/duration)
- **`duration-{75,100,150,200,300,500,700,1000}`** → `transition-duration: {N}ms;`
- **`ease-linear`** → `transition-timing-function: linear;` · **`ease-in`** → `cubic-bezier(0.4, 0, 1, 1)` · **`ease-out`** → `cubic-bezier(0, 0, 0.2, 1)` · **`ease-in-out`** → `cubic-bezier(0.4, 0, 0.2, 1)`
- **`delay-{75,100,150,200,300,500,700,1000}`** → `transition-delay: {N}ms;`

Keep the arbitrary-bracket forms (`ARBITRARY_PROP_MAP`) intact — they coexist (bracket form wins for `transition-[…]`; bare `transition` is now a registry hit). Confirm no collision: `transition`/`duration`/`ease`/`delay` as bare/scale keys are NOT already in `registry` (the gap proves they aren't).

## Exclusion-list check
The gap notes `group`/`group-hover` are explicitly excluded at `:2537`/`:3060`. Confirm `transition`/`duration`/`ease`/`delay` are NOT on any exclusion/skip list that would suppress the new registry hits (grep those line regions). If they are, remove them from the exclusion so the new entries surface.

## Test (lands with this item)
Add a focused test (mirror the existing tailwind generated-CSS fixtures — grep for a `*tailwind*.test.js` / generated-CSS test): assert each new class emits its CSS rule (`transition`, `transition-all`, `transition-colors`, `duration-200`, `ease-in-out`, `delay-150`) and fires NO `W-TAILWIND-UNRECOGNIZED-CLASS` / `W-TAILWIND-001`.

## Verify before DONE
1. `cd compiler && bun test <your new test>` — green.
2. `cd compiler && bun run test` — FULL suite, ZERO regressions (pre-commit hook; never `--no-verify`; may be slow under cross-session load — that's env, not failure).
3. R26: compile a repro using each new utility, grep the generated CSS for the rule, confirm no ghost-lint. Paste evidence.

## F4 startup + path discipline
- FIRST: `pwd && git rev-parse --abbrev-ref HEAD && git status` — confirm your OWN `.claude/worktrees/agent-*` worktree (NOT a main checkout). Write ONLY inside it.
- `git merge spa/ss29 --no-edit` at startup (no-op/FF if spa/ss29==main; brings any prior ss29 item). Fast — pre-merge-commit.
- Commit INCREMENTALLY; coupled code+test = one commit; clean `git status` before DONE.
- Report (final message = return value): branch · final SHA · the item commit SHAs AFTER any merge commit (I cherry-pick those) · files changed · full-suite result · R26 evidence (generated-CSS grep per class).