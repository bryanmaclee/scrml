You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. Priority HIGH: a silent miscompile.

FIRST:
1. `git fetch origin && git merge origin/main`.
2. Archive this prompt verbatim to docs/changes/s462-braceless-if-else-dropped/BRIEF.md, then commit it with a progress.md.
3. Commit rules:
   - Commit incrementally; code and its test go in one commit.
   - Never use --no-verify and never disable hooks.
   - Gate each commit on free memory above 6GB and load average below 15.
   - Commit in the foreground with timeout 600000.

BUG (reported by the md phase-1 dev): a brace-less `if (c) a.push(x) else a.push(y)` silently drops the `else` branch from the emitted JS. Reproduce it first, in client code, server code and library mode. Also try:
- a brace-less if with a brace-less else on separate lines;
- else-if chains without braces;
- a brace-less if inside a loop;
- a brace-less if inside a match arm;
- `if (c) return x else return y`;
- `if (c) @x = 1 else @x = 2`;
- a nested brace-less if/else (the dangling-else rule).

TASK:
- Read the SPEC on if/else statement grammar (find it via SPEC-INDEX; quote the governing sentence). Find out whether brace-less bodies are legal scrml at all.
- If they are LEGAL, fix the parser/emitter so the else branch is kept and the dangling else binds to the nearest if. Test the emitted JS by executing it.
- If they are NOT legal per SPEC, the bug is that they compile silently. Make them a clear compile error with the right code, and do NOT silently accept. Measure the corpus for how many sites become refused, and report that number before choosing this path if it is nonzero.
- Either way, a silent drop must become impossible: no input shape should parse an else and then discard it.
- Check the bootstrap for the same shape and record a gap if it differs.

TESTS: execute both branches for each shape. Add unit and conformance cases.

CORPUS: run an emit differential (samples, examples, stdlib, conformance, gauntlet-r25, ../giti, ../flogence read-only). Find every existing site of this shape and whether its behaviour changes. A site that changes behaviour was previously miscompiled, so list each one.

GATES (all):
- pre-commit
- tracking tiers (after pretest)
- browser-baseline --check (re-run on PARSER DISAGREES)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate
- corpus-compile-floor

Resolve generated-doc conflicts by hunk, regenerate them, and restore master-list.md from origin/main. Write only inside your worktree. Use a unique scratch subdir, never the shared scratchpad root or `scratchpad/base`.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the SPEC sentence, the fix, the corpus sites, and the gates table. Do NOT push.
