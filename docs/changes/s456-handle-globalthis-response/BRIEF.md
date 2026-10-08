start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0c15d91cd5ebebce

start at your worktree (cut from origin/main; expected base 2dd6d35d9 or later).

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ 2dd6d35d9.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write outside it; never `cd` into the main checkout (/home/bryan-maclee/scrmlMaster/scrml).
3. NEVER `git stash`; NEVER `pkill -f` / `killall`; never `git -c core.hooksPath=…`.
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete at end). TMPDIR, if set → ~/.cache/scrml-agent-tmp/s456-protect (never inside a repo).
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s456-handle-globalthis-response/BRIEF.md (first line `start at $(pwd)`); progress.md append-only, commit after each unit. Code + tests in ONE commit. Never --no-verify. Foreground commit timeout 300000. Types gate BLOCKING (`bun run types:check`); also `bun scripts/s34-census.ts --check-new`, `bun scripts/regen-spec-index.ts --check`, `bun scripts/facts.ts --check` before pushing. Never put a status-bearing command behind a pipe.
6. Push as `fix/s456-handle-globalthis-response` (normal push). Do NOT open or merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp 9c556dc74, current for source). Follow its routing for §14.8.9 protect egress (protect-egress.ts, emit-server.ts, the E-PROTECT-* checks). Report whether the maps were load-bearing.

TASK — HIGH security gap `g-handle-globalthis-response-ships-protected-columns` (docs/known-gaps.md ~line 12646 — read the entry IN FULL; its locus field is from S346 and the code has been rewritten since: treat every named locus as PA-located-verify).
PA-REPRODUCED BY EMISSION at 2dd6d35d9 (S456): with `<program db="sqlite:app.db"><db src="app.db" protect="passwordHash" tables="users">` and
```
${
    function handle(request, resolve) {
        const u = ?{`select id, name, passwordHash from users where id = 1`}.get() !{ _ :> not }
        return new globalThis.Response(JSON.stringify(u))
    }
}
```
→ compiles rc=0 (only W-AUTH-MIDDLEWARE-AUTO-INJECTED); the identical file with `new Response(...)` → E-PROTECT-006 ("the protected column `passwordHash` leaves the server outside its row — `JSON.stringify(…)` of a pro…"). Emitted: `u` is `_scrml_protect_tag`-ged, then `return new globalThis.Response(JSON.stringify(u));` — stringified raw. An independent S456 auditor RAN the emitted helpers and got `{"passwordHash":"SECRET"}` (relayed; re-run it yourself). So: the E-PROTECT-006 sink check recognizes `Response` only by bare name.
GOVERNING: re-read SPEC §14.8.9 IN FULL and quote the fail-closed sentence(s) for a protected column reaching a raw egress, and the dpa-017 (S230) raw-egress fail-closed ruling the gap cites; quote them in progress.md. Direction: newly-rejecting (the leaking program must stop compiling) toward an existing SHALL — conformance restoration.
FIX THE ROOT, not the spelling: the check must recognize the Response constructor STRUCTURALLY however it is reached — `globalThis.Response`, `self.Response`, `globalThis["Response"]`, an alias (`const R = globalThis.Response; new R(...)`), a destructure (`const { Response: R } = globalThis`), and `Response.json(u)` / `new Response(...)` via any of those — and fail CLOSED on any constructor/call it cannot resolve that receives a protect-tagged value as a body (Rule 7: decide from the AST, no source-text regex in a post-AST stage). Also check the runtime half: does an un-mediated `Response` built by author code bypass `_scrml_protect_redact` at the handle()/route exit? If the static check is the only guard, say so; if the runtime passthrough can be closed without refusing compiler-built Responses (the `_SCRML_MEDIATED` provenance check exists), close it too and show it.
BEFORE NARROWING/WIDENING: count the corpus (write:true compile of samples/ examples/ stdlib/ conformance/) for `globalThis.Response` / `Response.json` / aliased Response uses; any file newly rejected → list it (a non-zero count goes back to the PA, do not migrate unilaterally).
EVIDENCE: repro table base/head for every spelling above (compile result + run the emitted server and show the response body); corpus differential; conformance cases pinning the leak shapes as E-PROTECT-* and a negative control (an un-protected value in `new globalThis.Response` still compiles); full `bun run test`. Update the gap entry (status, locus=, prov=).
FINAL REPORT (<400 words): FINAL_SHA; repro table; traced root; fix; runtime half; corpus hits; tests; maps load-bearing?; `git status` clean.
