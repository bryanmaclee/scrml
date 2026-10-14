You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. Priority HIGH: display text is executed as code.

FIRST:
1. `git fetch origin && git merge origin/main`.
2. Archive this prompt verbatim to docs/changes/s462-given-body-text-as-code/BRIEF.md and commit it together with a progress.md.

Commit rules:
- Commit incrementally; code and its test go in one commit.
- Never use --no-verify and never disable hooks.
- Gate each commit on free memory above 6GB and load average below 15, and commit in the foreground with timeout 600000.
- Use your own scratch subdir, never the shared scratchpad root or scratchpad/base.

BUG (reported by the scrml-fix follow-ups dev, NOT yet reproduced by the PA, so reproduce it first): in a markup `given` guard body (in-place `given @u :> { … }` in markup, soft-deprecated via §63 but still legal), literal TEXT between interpolations is compiled as CODE:
- `${@u.name} - ${@n}` emits `-;` into the JS;
- plain text `track(@n)` written in the body is actually EXECUTED.
If confirmed, author display text runs as JavaScript. It is author-static, but it violates the text/logic boundary and can corrupt output.

TASK:
- Reproduce in happy-dom and Chromium. Find the root cause in how the given-guard body is split or emitted; most likely it rejoins tokens or treats bare-expr nodes as statements.
- Read the SPEC on markup text vs logic (§4, §42.2.3 given guards) and quote the governing sentence.
- Fix it so text in a guard body is text: rendered literally, never evaluated.
- Check the sibling shapes for the same defect:
  - `if (…) { lift … }` markup bodies;
  - `<match>` arms;
  - engine state children;
  - each bodies;
  - component bodies.
  Text between interpolations must be text everywhere.
- Measure the corpus for sites whose output changes, list them, and execute each one before and after.

TESTS: executed DOM tests, including `${@a} - ${@b}`, `track(@n)` as plain text, `a + b`, text containing `;`, `(`, `)` and keywords, and sibling positions.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (re-run on PARSER DISAGREES)
- `s34-census --check-new`
- host-global-scan --check
- facts / spec-index / bootstrap-conformance / severity --check
- snippet-gate and corpus-compile-floor
- an emit differential

Resolve generated-doc conflicts by hunk and regenerate; restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, repro confirmation (or refutation, with evidence), root cause, fix, sibling positions, corpus sites, and the gates table. Do NOT push.
