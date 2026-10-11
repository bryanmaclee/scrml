You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. This covers two `scrml fix` follow-ups, now unblocked by landed work.

FIRST:
1. Run `git fetch origin && git merge origin/main`. Main must include #1392 (in-place given deprecation), #1395 (match-leave, bare leave arms) and #1397 (markup if-arm re-render, 6e58dd9eb).
2. Archive this prompt verbatim to docs/changes/s462-fix-rule-followups/BRIEF.md and commit it with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its test go in one commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15. Use timeout 300000 and run the commit in the foreground.

ITEM A: lift the given-presence fix rule's markup refusal.
- compiler/src/commands/fix-given-presence.js (~:54, ~:451) refuses to rewrite a markup `given` guard over a cell. The stated reason is the stale-render gap g-impl1-markup-if-branch-memo-stale-render-s462, which #1397 has now resolved.
- Remove that refusal and rewrite those sites. Each rewritten site must still pass the rule's per-site verify, which checks that the diagnostic codes are unchanged.
- Prove the rewrite renders correctly: execute before and after in happy-dom, the way compiler/tests/browser does, including a read that changes while the guard stays true.
- Update conformance/cases/condition/given-presence-deprecated-markup. Its description says the canonical form "keeps the stale 'ada'"; that is now false. Give it a runtime half that asserts the fresh value.
- Measure how many corpus sites become fixable.

ITEM B (F8): `scrml fix` should emit a bare `:> return` arm.
- Find the fix rule(s) that emit a braced leave arm (`:> { return }` / `:> { return x }`, `fail`, `break`, `continue`) where §18.2, as amended by #1395 (S462 dpa-068 W1), now allows the bare form `:> return x`.
- Make them emit the bare form. Grep compiler/src/commands for arm emission.
- Keep the per-site verify green and add tests.
- If no rule emits leave arms, report that with evidence instead.

Read the governing SPEC sections in full before changing anything: §42.2.3 for given and §18.2 for match arms. Find them through SPEC-INDEX.md, and quote them in your commits.

GATES, all of them:
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check. Its "PARSER DISAGREES" refusal is a known flake; re-run it.
- `s34-census --check-new`
- host-global-scan --check
- facts / spec-index / bootstrap-conformance / severity --check
- snippet-gate and corpus-compile-floor

Resolve generated-doc merge conflicts by hunk, then regenerate. Restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, per-item results with the newly fixable corpus count, and the gates table. Do NOT push.
