You are a dispatched dev agent on the scrml repo. PA session S462. Target: the bootstrap (impl#2, compiler/self-host-v2/*.scrml). Gap: g-bootstrap-admits-script-style-elements-s462 (HIGH) in docs/known-gaps.md. Read that entry in full first.

FIRST:
1. Run `git fetch origin && git merge origin/main`. Main is at or after 6e58dd9eb.
2. Archive this prompt verbatim to docs/changes/s462-bootstrap-script-style-refusal/BRIEF.md, then commit it together with a progress.md.

Commit rules:
- Commit incrementally; the branch and progress.md are your crash anchor.
- Code and its tests go in ONE commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. The pre-commit hook runs the full suite: use timeout 300000 and run it in the foreground.

TASK: the bootstrap admits `<script>` / `<style>` elements, or whatever exact shapes the gap entry names, that impl#1 refuses.
- Find impl#1's refusal and the SPEC sentence that governs it. Use SPEC-INDEX.md to find the section, read it in full, and quote the governing sentence in your commit.
- Make the bootstrap refuse the same shapes with the same diagnostic code. The behaviour must match impl#1 exactly, including what stays legal (for example, any sanctioned style/script forms).
- Add bootstrap tests, plus conformance twins if the case directory supports bootstrap twinning (see how other twins under conformance/cases are marked).
- Regenerate docs/bootstrap-conformance.md and severity.scrml if your change affects them.
- Mark the gap resolved with a resolution note.

RULES:
- scrml is not JS. Follow the existing idiom in analyze.scrml / the relevant slice.
- Overlay Rule 7: no text scanners or regex over source in post-AST stages; decide from parsed nodes.
- Resolve generated-doc merge conflicts by hunk, then regenerate. Never take one side's whole known-gaps.md. Restore master-list.md from origin/main.
- Write only inside your worktree.

GATES, all of them, including the CI-only ones:
- pre-commit
- bootstrap slices: `bun test ./compiler/self-host-v2/`, plus the CI bootstrap steps in .github/workflows/ci.yml
- bootstrap-conformance --check
- gen-bootstrap-severity --check
- tracking tiers: `bun test compiler/tests/integration compiler/tests/lsp compiler/tests/commands`, after `bun run pretest`
- `bun scripts/s34-census.ts --check-new --base <merge-base>`
- host-global-scan --check
- facts and spec-index --check

Also run the corpus through the bootstrap where tooling exists, to measure any newly-refused sites.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the SPEC sentence quoted, the impl#1 locus mirrored, the newly-refused corpus count, and the gates table. Do NOT push.
