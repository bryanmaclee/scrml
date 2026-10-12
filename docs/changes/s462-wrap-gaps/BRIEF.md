You are a dispatched docs agent on the scrml repo. PA session S462 is wrapping. Your job: file the PA's collected S462 findings into docs/known-gaps.md, without duplicating entries that dev agents already filed this session.

FIRST:
1. `git fetch origin && git merge origin/main`.
2. Archive this prompt verbatim to docs/changes/s462-wrap-gaps/BRIEF.md.

Rules for commits:
- Commit incrementally.
- Never use --no-verify.
- Docs-only commits skip the suite in the hook. That is fine.

INPUT: /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/ded336eb-40b5-403c-94d8-1f930fdf45e5/scratchpad/wrap/gaps-to-file.md (read only).

Also file these HIGH entries, which aren't in that file:
- g-unquoted-href-cell-ref-renders-cell-name-s456. RAISE it to HIGH and widen it: on main, `attr=@cell` written unquoted emits the LITERAL cell name ("x"), with 0 reactive reads and no diagnostic. This applies to every attribute measured: href, src, title, class, id, data-*, and input value. `href="${@x}"` and `bind:value=@x` work. This violates §5.1, "`attr=name` SHALL resolve name … at runtime".

TASK, for each item:
1. Search docs/known-gaps.md for an existing entry: grep for key terms and for "s462". Many items were already filed by dev agents in their own PRs. Some items say "may be fixed"; check the code or the gap file before filing.
2. If an entry exists, skip it. You may update it with new facts from the list.
3. Otherwise, add an entry in the file's existing format: an `@gap` marker with id, severity, status=open and `prov=review:s462-…` (match neighbouring S462 entries), a precise repro, and a locus where known.
4. Severity: use the list's own label if it has one, else MED for wrong behaviour that fails loudly, HIGH for silent wrong behaviour, LOW for nits.
5. Items marked "Q for bryan" or "queued": do NOT file them as gaps. Collect them into a short section at the end of your report instead.
6. "Test flake" items: file each as a LOW gap under the test-infra convention the file already uses.

Then:
- run `bun scripts/state.ts --write` (gap counts);
- run `bun scripts/state.ts --check`, plus facts and spec-index --check if touched;
- restore master-list.md from origin/main if state.ts changed it unexpectedly;
- commit.

REPORT: the FINAL_SHA; a table of filed / skipped-as-dup (with the existing id) / updated; the count delta; and the list of non-gap items (questions and queued). Do NOT push.

Write only inside your worktree. Use your own scratch subdir if you need one.
