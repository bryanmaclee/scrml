ID = s451-ri-string-literal · BRANCH = fix/s451-ri-string-literal

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-leak incidents on record >0)
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- . Else STOP. Call it WORKTREE_ROOT. Verify `git -C "$WORKTREE_ROOT" merge-base HEAD origin/main` == `git -C "$WORKTREE_ROOT" rev-parse origin/main`. Tree clean.
2. `git -C "$WORKTREE_ROOT" checkout -b fix/s451-ri-string-literal`. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT). TMPDIR per command = ~/.cache/scrml-agent-tmp/s451-ri-string-literal/.
3. Edit/Write only absolute paths under WORKTREE_ROOT. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml. Never `git stash`. Never bare `pkill -f`. Git commands as separate plain commands. First commit `WIP(s451-ri-string-literal): start at <pwd>`.
4. Commit after each change; docs/changes/s451-ri-string-literal/progress.md; archive this prompt verbatim as BRIEF.md there in the first commit. Never --no-verify. When done: rebase onto a fresh origin/main, push `git push -u origin fix/s451-ri-string-literal`. No PR.

MAPS: .claude/maps/primary.map.md — read, report load-bearing or not.

POLICY CONTEXT: impl#1 (compiler/src) is frozen for language semantics except security and bootstrap-serving fixes (S435/S447). This one is bootstrap-serving: it crashed the bootstrap build (the bootstrap is scrml compiled by impl#1).

BUG (PA-reproduced on main b490f3b75): impl#1 route inference places a pure client function on the SERVER because a STRING LITERAL in its body contains the word "session":
```
<program>
<msg> = ""
${
  function label(x) { return "your session ended: " + x }
  function go() { @msg = label("now") }
}
<button onclick=go()>go</button>
<p>${@msg}</p>
</program>
```
`bun compiler/bin/scrml.js compile a.scrml --output-dir out` → a.client.js has `_scrml_fetch_label_4` POSTing to `/_scrml/__ri_route_label_1`; `label` is emitted in a.server.js. Expected: `label` stays client-side, no route.
GOVERNING (SPEC §12.4, quote it in progress.md): "Route inference SHALL be per-function … SHALL NOT classify a function based on … string-literal contents". Direction: semantics-changed (toward the contract) — conformance restoration.
LOCUS (PA-located-verify, not traced): compiler/src/route-inference.ts `SERVER_ONLY_PATTERNS` (~:473) — a raw-source regex table; a `/\bsession\b/`-shaped entry reportedly matches inside string literals. Note the file comment near ~:528 that some signals already moved OFF the raw-source table onto a structural check — that is the pattern to mirror (project Rule 7: post-AST stages must not ask the TEXT what the TREE knows).
REQUIRED SHAPE: fix the CLASS, not the word — every SERVER_ONLY_PATTERNS entry must not fire on string-literal / template-literal-text / comment content. Prefer moving the decision onto the AST (the identifier/member reference the pattern means, e.g. a real `session.x` / `@session` reference); if a pattern must stay textual, strip string/template/comment content via the existing tokenizer first — and count the corpus delta. Read §12.2/§12.4 IN FULL first: be careful NOT to stop recognising a REAL session/SQL/fs use (that would be newly fail-OPEN — a server-only resource placed on the client). Measure both directions: compile examples/, samples/ (samples/compilation-tests via the existing harness), and the adopter gauntlet sources (/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml) before and after; report every function whose placement changes and classify each (string-literal false positive fixed = good; real server use lost = HIGH, stop and report).
Tests: unit tests for each pattern family with the token inside a string, a template literal, a comment (must NOT escalate) and as real code (MUST escalate). Pre-commit subset must pass.
Report (<40 lines): branch + SHA pushed, files, the placement-change table, tests, governing sentence, whether the locus held.
