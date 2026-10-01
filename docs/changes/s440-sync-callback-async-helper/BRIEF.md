change-id: s440-sync-callback-async-helper (SECURITY — impl#1 fixes are allowed for security under the S435 policy)

## STARTUP + PATH DISCIPLINE (incident counter 0)
`pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; clean tree; `git fetch origin && git merge --ff-only origin/main`; assert merge-base == origin/main; `bun install`; `bun run pretest` (plain). Absolute worktree paths; never `cd` into main; Edit/Write only; no `git stash`; no `pkill -f`. First commit archives THIS PROMPT verbatim to `docs/changes/s440-sync-callback-async-helper/BRIEF.md` (`WIP(...): start at $(pwd)`); incremental commits + append-only progress.md; code+tests one commit; Bash timeout 600000 for commits; never `--no-verify`.

## MAPS
`.claude/maps/primary.map.md` first; verify against source; report load-bearing or not.

## THE BUG (PA-reproduced on main)
The fail-closed guards `E-SERVER-FN-IN-SYNC-CALLBACK` / `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` (§13.2, §34 — read both rows IN FULL; the stdlib one records the original accept-every-password bypass `hashes.some(h => verifyPassword(pw, h))`) are bypassed when the server call is wrapped in a function declared INSIDE the enclosing function:
```scrml
<program>
<out> = 0
server function isOk(n) { return n > 100 }
function go() {
  function inner(x) { return isOk(x) }
  const any = [1, 2, 3].some(x => inner(x))
  console.log("expect false", any)
}
<button onclick=go()>go</button>
</program>
```
Emitted client JS: `async function inner(x) { return await _scrml_fetch_isOk_6(x); }` then `const any = [1, 2, 3].some((x) => inner(x));` — a Promise is always truthy, so `.some` is TRUE FOR EVERY INPUT (an accept-all). The reviewer reports the same on the SERVER side (a server function whose nested helper wraps a peer server fn / async stdlib call inside `.some`/`.find`/`.filter`/`.every`/`.sort` callbacks). A helper declared at FILE scope is handled correctly (compare its path). Reproducers from the finder: `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/3e14d469-cec8-4ced-83bb-42a85712efb3/scratchpad/wat/D-collections/bug04-server-nested-helper-some.scrml` and `bug04b-client-nested-helper-some.scrml` (read-only; copy into your worktree).
Loci (PA grep hits, NOT traced — verify): `compiler/src/codegen/scheduling.ts`, `emit-control-flow.ts`, `emit-expr.ts` mention the codes. The file-scope helper case works, so find where the "this callee is async-colored" fact is computed and why a NESTED function declaration is not in that set (likely the async-colored set is built from file-scope functions only).

## THE FIX
Root, not position: any function the compiler emits as `async` (because it transitively awaits) must be treated as async-colored at EVERY call site in a sync callback / nested lambda / param default — nested declarations, arrow-bound helpers (`const inner = (x) => isOk(x)`), helpers passed by reference (`.some(inner)`), and transitive chains (`a` calls `b` calls server fn) — on client AND server. Fail CLOSED with the existing codes (use the peer-server-fn code for a peer server function, the stdlib code for stdlib; the finder notes the client currently reports the stdlib code for a peer server fn at 1:1 — fix the code choice and the span too). A newly-rejecting change: measure the corpus by COMPILING it (examples/ samples/ conformance/ stdlib/ + /home/bryan-maclee/scrmlMaster/flogence/**/*.scrml read-only); report newly-failing files; if any is NOT a genuine instance, STOP and report.

## VERIFY
Red-on-base tests for each shape (client + server): nested fn, nested arrow-bound, by-reference, transitive, inside `.some/.every/.find/.filter/.sort/.map` (note: the client auto-awaits some array callbacks per §13.2 — `.map` may be legitimately handled; only flag positions the compiler CANNOT await — read §13.2). Runtime check: the reproducer must be a compile error, not `true`. Conformance case pinning it (security-tagged if the runner supports tags). `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`; `bun conformance/run.ts`; corpus measure. REPORT: FINAL_SHA, root cause (where the async-colored set is built), shapes covered, corpus result, test counts. Clean tree.
