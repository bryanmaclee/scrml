# ss15 item-1 — `g-tailwind-lint-false-fires-on-scoped-class` (sPA ss15 dispatch brief)

> Archived per pa.md S136. change-id: `ss15-item1-tailwind-scoped-class-2026-06-22`. Agent: `scrml-js-codegen-engineer`, `isolation:"worktree"`, `model:opus`. Branch landed by sPA on `spa/ss15`. Base: `origin/main` 1ce8de34.

## The bug (LOW, R26-CONFIRMED on HEAD by the sPA)
`findUnrecognizedClasses(source)` in `compiler/src/tailwind-classes.js` (fired from `compiler/src/api.js:925`, info-level `W-TAILWIND-UNRECOGNIZED-CLASS`) is a **text pre-pass** over raw source: for every whitespace token inside a `class="..."` attribute it calls `getTailwindCSS(token)`; any token that fails to resolve as a Tailwind utility draws the lint. It has **no knowledge of class selectors the author defines in their own in-scope `#{}` / `<style>` CSS blocks**. So a scoped-CSS component that defines `.card` / `.card-title` in a `#{}` block and uses `class="card"` draws a spurious lint on every author-defined class.

sPA R26 repro (`/tmp/css-dogfood.scrml`): the CSS emits correctly — `dist/*.css` has `@scope ([data-scrml="Card"]) to ([data-scrml]) { .card {…} .card-title {…} }` — yet `card` and `card-title` EACH draw `W-TAILWIND-UNRECOGNIZED-CLASS`. The author defined the rules; the lint should be silent on them.

```scrml
<program>
const Card = <div props={ label: string }>
    #{
        .card { padding: 16px; border: 1px solid #e5e7eb; color: navy; }
        .card-title { font-weight: 600; }
    }
    <div class="card"><span class="card-title">${label}</span></div>
</div>
<title> = "Bryan"
<page><Card label=@title/></page>
</program>
```

## THE FIX
`findUnrecognizedClasses(source)` already receives the full source text and MUST stay a text pre-pass (it runs in the api.js lint loop BEFORE Block-Splitter/parse — there is NO AST available; do NOT introduce an AST/parse dependency).

Build an **author-defined-class exclusion set** by text-scanning the SAME `source` for class selectors defined in the author's CSS blocks, and skip any `class="..."` token that is in that set:
1. Locate every inline `#{ … }` CSS block AND every `<style> … </style>` block in `source`.
2. Within those block bodies, extract every CSS **class selector** token — i.e. every `.identifier` occurrence (the ident after a `.`). Cover: comma-grouped selectors (`.a, .b {}`), compound/descendant selectors (`.card .title`, `.card.active`, `.card > .row`), and pseudo-suffixed (`.card:hover`, `.card::before`). Extract the bare class name(s) only (strip the leading `.`, stop at the next non-`[A-Za-z0-9_-]`).
3. Both **program-scope** and **component-scope** `#{}`/`<style>` blocks count (a `#{}` inside a `const X = <div>…` component AND a top-level one) — this mirrors the set the `@scope` emitter resolves (`collect.ts:collectCssBlocks` + `emit-css.ts:generateCss`), but you derive it by text-scan, not from the AST.
4. In the token loop, after the existing `getTailwindCSS(cls) !== null` skip, ADD: `if (authorDefinedClasses.has(cls)) continue;`.

Apply the SAME exclusion to `findUnsupportedTailwindShapes` ONLY IF an author-defined class can be Tailwind-shaped (contains `:`/`[`) — normally author CSS class names are not, so default scope is `findUnrecognizedClasses`. If you touch both, say so.

Keep all existing fire behavior: typos (`flexx`), unsupported arbitrary values (`grid-cols-[auto_1fr_auto]`), and genuinely-unknown classes MUST still fire. Only author-DEFINED selectors are excluded.

## R26 EMPIRICAL VERIFICATION (before DONE)
Recompile `/tmp/css-dogfood.scrml`: ZERO `W-TAILWIND-UNRECOGNIZED-CLASS` on `card`/`card-title`; the `@scope` CSS still emits unchanged. Add a negative-control: a typo class (`class="crad"`) in the same file MUST still fire. Paste the before/after diagnostic lines.

## TESTS
Add a focused test next to the existing tailwind-lint tests (grep `findUnrecognizedClasses` / `W-TAILWIND-UNRECOGNIZED-CLASS` under `compiler/tests/`): a `#{}`-defined class used in `class="..."` does NOT fire; a Tailwind utility still resolves; a typo still fires; a `<style>`-defined class is excluded too. Coupled code+test = ONE commit (S113).

## MANDATORY (F4 / S99-S126 / S83 / S198)
- **F4 startup:** `pwd` MUST contain `.claude/worktrees/agent-` (you are in your OWN isolated worktree, a child of the `scrml-spa-ss15` sibling worktree on branch `spa/ss15`); run `bun install --cwd "$WORKTREE_ROOT"` then `bun run --cwd "$WORKTREE_ROOT" pretest` before work. If your base is stale vs `spa/ss15`, `git merge spa/ss15` first.
- **Path discipline:** ALL edits via Bash (`perl`/`python3`/heredoc) on WORKTREE-ABSOLUTE paths (the `.claude/worktrees/agent-<id>/` segment); NEVER `cd` into a main checkout; do NOT use the Edit/Write tools (they have leaked into main 15+ times). First commit message includes verbatim `pwd`.
- **Tests:** run the FULL `bun run --cwd "$WORKTREE_ROOT" test` (incl. browser) before DONE — `tailwind-classes.js` feeds CSS emission, so re-baseline any shifted within-node fixture IN THE SAME LANDING.
- Commit incrementally; `git status` clean before DONE; NEVER `--no-verify`. Write progress to `$WORKTREE_ROOT/docs/changes/ss15-item1-tailwind-scoped-class-2026-06-22/progress.md`.

## REPORT BACK
WORKTREE_PATH · FINAL_SHA · AGENT_BRANCH · FILES_TOUCHED (worktree-absolute) · R26 before/after diagnostic evidence · full-suite pass/skip/fail · any within-node re-baseline. The sPA lands via S67 file-delta onto `spa/ss15`.
