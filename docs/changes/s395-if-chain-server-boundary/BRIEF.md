# BRIEF — s395-if-chain-server-boundary

Close `g-collect-functions-branch-decl-vs-server-boundary-routing` (HIGH, **SECURITY-GATED**).

⛑ **READ THE SEQUENCING RULE BEFORE ANYTHING ELSE. The obvious fix is the wrong one and it
LEAKS SERVER CODE TO THE BROWSER.** A previous dispatch walked into this, ran a control that
confirmed it had introduced the leak, reverted, and filed — that judgment was correct and is
why this brief exists. Do not repeat the mistake it avoided.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST; follow its Task-Shape Routing.
⛑ **THE MAPS ARE STALE.** Stamp `2ec2ce3a`; your base `origin/main` is `ad7b65dc`. Nav-map
regeneration was REMOVED from the scheduled CI job at S310 (a ruled cost decision — see
`.github/workflows/cloud-maps.yml:58`), so map refresh happens only at a PA wrap, and the last
one was skipped. **Treat every map claim as a hypothesis to verify against source.** A PA map
refresh is running CONCURRENTLY with you on `.claude/maps/` — do NOT write to that directory;
it is not your surface. Report whether the maps were load-bearing, "not load-bearing" included.

## STARTUP — CRITICAL (F4)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   `git rev-parse --show-toplevel` MUST equal it. Tree clean. Any failure: STOP, report, exit.
2. Assert your base: `git merge-base HEAD origin/main` MUST equal `origin/main`.
3. `bun install` (worktrees do NOT inherit `node_modules`).
4. Run `bun run pretest` PLAINLY from the worktree CWD. ⛑ `bun --cwd <path> run pretest`
   silently no-ops and **exits 0** — verify the artifact exists, never trust the exit code.
5. First commit: `WIP(if-chain-server-boundary): start at $(pwd)`.
6. This brief is on branch `fix/s395-if-chain-server-boundary`, NOT on `origin/main`. Step one:
   `git fetch origin fix/s395-if-chain-server-boundary && git checkout FETCH_HEAD -- docs/changes/s395-if-chain-server-boundary/`

## PATH DISCIPLINE
Edit via Edit/Write on **worktree-absolute paths only**. NEVER `cd` into the main checkout;
use `git -C "$WORKTREE_ROOT"` and worktree-absolute paths.
⛑ **NEVER `git stash`** — `refs/stash` is SHARED across every worktree, and a PA map refresh is
live right now. Do base-vs-build flips by **FILE COPY** only.
⛑ **NEVER a bare `pkill -f` / `killall`** on a command string every checkout shares — it matches
suites in OTHER checkouts and leaves no trace on your side.
Commit after EVERY meaningful edit; keep an append-only `progress.md` **inside
`docs/changes/s395-if-chain-server-boundary/`**, NOT at the repo root (a root `progress.md` is an
untracked stray on main and will be excluded at landing).
**NEVER `--no-verify`.** Not pre-commit, not pre-push. Do not touch `core.hooksPath`.

## THE SYMPTOM — PA-REPRODUCED ON MERGED MAIN `ad7b65dc`

```scrml
<flag> = true

<div if=@flag>
    ${
        function helper() { return 1 }
    }
    <p>a ${helper()}</p>
    <p>b ${helper()}</p>
</div>
<div else>
    <p>nope</p>
</div>
```

Compiles **exit 0, zero diagnostics**. Emitted client JS carries **0 definitions of `helper`**
and **2 bare `helper()` call sites** → `ReferenceError` at runtime. (Filed measurements, from the
original dispatch: a LONE `if=` gives 1 definition + 4 MANGLED calls; `if=`/`else` gives 0
definitions + 4 BARE calls.) `collect.ts`'s `collectFunctions` is blind to the collapsed
if-chain shape, exactly as the sibling walks closed by #811 were.

## ⛑ THE TRAP — AND THE MANDATORY ORDER

Closing `collectFunctions` **ALONE** emits a `server fn` BODY into `client.js` with **no
`server.js` produced at all**. Measured control from the original dispatch: body-in-client **1**
with the naive hunk, **0** without it, **0** on base. The reason: that walk feeds the CLIENT
function emitter, while the **server-boundary ROUTING walk is blind to the if-chain shape in its
own separate way**. Closing the client-side collector without the routing walk hands the client
emitter a function the router never claimed.

**Trading a loud `ReferenceError` for a silent server-code-in-client-bundle leak is strictly
worse.** Fail-loud beats fail-silent (base FORK RULE row 2, and the axis that decided the #811
landing order).

**THE ORDER IS NOT NEGOTIABLE:**
1. **Close the server-boundary ROUTING walk FIRST.** Find it, trace it, close its if-chain
   blindness, and prove by execution that a branch-declared `server fn` routes to `server.js`.
2. **THEN close `collectFunctions`.**
3. Both land in the **SAME arc**. If step 1 turns out not to be closable in this arc, **STOP and
   report — do not land step 2 alone.** That is the whole point of this brief.

## THE LEAK GUARD — it must stay green, AND it needs hardening

`compiler/tests/unit/g-if-chain-branch-cell-never-wired.test.js`, test
`"LEAK GUARD: a server fn in a branch never ships its body to the client"` (~`:124`).
It was proven to RED against the naive fix. It must be GREEN when you finish.

⛑ **Two defects in the guard itself, both to fix as part of this arc:**
- `expect(r.clientJs).not.toContain("server fn")` is **VACUOUS** — the emitted JS would never
  contain the scrml source token `server fn` regardless. Replace it with something that bites.
- `expect(r.clientJs).not.toContain("41 + 1")` is the ONLY biting assertion and it is
  **WHITESPACE-SENSITIVE**: an emitter that produced `41+1` would pass it while leaking. Make the
  body check whitespace-insensitive (normalize before asserting) or assert on a structural marker.

A guard that cannot fail is indistinguishable from a guard that never fails. **Prove the hardened
guard still REDs against the naive client-only fix** (apply it in a scratch copy, confirm red,
restore) — that bite proof is a deliverable, not an optional extra.

## LOCUS — PA-located, VERIFY don't trust
`compiler/src/codegen/collect.ts` (`collectFunctions`) is the CLIENT-side half and is
well-established. **The server-boundary ROUTING walk is NOT located** — the gap entry says only
that it "is blind in its own separate way." Finding and tracing it is the first real task.
Route-inference (`compiler/src/route-inference.ts`) and the server emitter are starting points,
not answers. `#811` extracted `ast-if-chain.js` as the shared descent helper for exactly this
class — prefer reusing it over a fourth hand-rolled walk (root, not position).
Report whether each locus HELD, was REFINED, or was WRONG.

## VERIFICATION — all mandatory

**Phase 1 — the security control, three-way, by FILE COPY.** Reproduce the original measurement
on YOUR fix: body-in-client must be **0** with your complete fix, **1** with a client-only hunk
(prove you can still produce the leak — that is the positive control), **0** on base. And a
branch-declared `server fn` must actually appear in `server.js`.

**Phase 2 — the symptom.** The reproducer above emits a real definition and mangled call sites;
`ReferenceError` gone. Parity against the lone-`if=` oracle, as #811 did.

**Phase 3 — measured differential.** This changes PLACEMENT: programs may gain or lose a
`server.js`. Direction is `semantics-changed` AND potentially newly-emitting. Recompile the real
corpus and report the **count of files whose emitted output changes, and NAME them**, plus any
file that gains or loses a server bundle. **Assumed-zero is not measured-zero.** Any change you
cannot explain from the fix is blast radius — STOP and report.

**Phase 4 — R26 empirical + a SECURITY sweep.** Recompile real adopter `.scrml`
(`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`; note r26 does not exist — r27/r28 are
the newest, use them too) on the post-fix baseline. Then sweep EVERY emitted client bundle for
server-only material. **DO NOT mark DONE without an empirical pass.**

Plus `bun run test` green, and conformance cases pinning both halves — the branch-declared plain
`function` (defined + called correctly) and the branch-declared `server fn` (routed to server,
body absent from client).

## PROVENANCE (Rule 4b)
Determine the governing sentence before you land: §12 owns server/client placement inference.
Quote it, or record `searched §X, §Y, §Z — no governing sentence found` (that outcome is a
FINDING and makes this a ruling rather than a fix — report it, do not decide it).

## REPORT BACK
worktree path · final SHA · files touched · locus verdicts · Phase-1 three-way security control ·
Phase-2 oracle parity · Phase-3 changed-file COUNT + NAMES + server-bundle deltas · Phase-4
empirical + security sweep · hardened-guard bite proof · governing sentence or the recorded search ·
maps load-bearing? · anything deferred.
