ROUND 7 of the S385 channel-mount guard. You are continuing another agent's branch, not starting fresh.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: run `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report — do not write anything.
2. Confirm `git rev-parse --show-toplevel` equals that same worktree root, and the tree is clean.
3. **Your worktree was cut from `origin/main`, NOT from the branch you must continue.** Step one of real work:
   ```
   git fetch origin fix/s385-channel-mount-guard
   git reset --hard FETCH_HEAD          # = 35654c48, round 6's tip
   ```
   Verify `git log --oneline -1` shows the round-6 merge commit before proceeding.
4. `bun install` (worktrees do not inherit `node_modules` — the hook fails "cannot find package 'acorn'" otherwise).
5. Run `pretest` from the worktree CWD **plainly** — `bun run pretest`. Do NOT write `bun --cwd <path> run pretest`: bun silently treats that as a bare `bun run`, prints the script list and **exits 0** while building nothing. Verify it produced `samples/compilation-tests/dist/` artifacts; exit code is not evidence here.
6. Every Read/Write/Edit uses an ABSOLUTE path under your worktree root. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` and worktree-absolute paths.
7. **NEVER use `git stash`.** `refs/stash` lives in the shared common `.git` dir, so your stash and the PA's land on the SAME stack and whoever pops next takes the top entry regardless of which tree made it. We lost work to exactly this at S385. Do base-vs-build flips by FILE COPY.
8. **Never `pkill -f` / `killall` on a command string.** Every checkout shares it, so you would silently kill a suite or a commit hook running in the main checkout, leaving no trace on your side. Kill by PID captured at launch, or filter on cwd.
9. First commit message: `WIP(r7): start at $(pwd)` — the PA verifies the prefix on landing.

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing to the codegen/expander maps. **Currency, measured:** the maps are stamped at commit `0dd659a1`; `origin/main` is `d02adb68`, 35 commits ahead. I checked: **ZERO of those 35 commits touch `compiler/src/component-expander.ts`**, so the map is current for your surface. Treat map content as a verify-against-source hypothesis anyway. Report whether the maps were load-bearing — "not load-bearing" is a valid and useful answer.

# CONTEXT — what rounds 1-6 did, so you do not re-derive it

The arc closes a silent dead-channel class: a `<channel>` mount (`<probeChan/>`) placed somewhere the channel-expander never reaches compiles at exit 0, ships the raw tag into the client bundle, and emits ZERO `_scrml_ws` wiring. The channel never connects and nothing says so. An adopter (handle: flogence) shipped **two dead channels in production** this way.

bryan ruled the direction at S385: **REJECT** — fail closed with a clear diagnostic naming the mount and the one-line fix. Round 6 landed `E-CHANNEL-MOUNT-IN-CONDITIONAL` in `compiler/src/component-expander.ts` covering three containers (match arm, engine state-child body, and a third added in round 6).

Three prior rounds were each blocked by the SAME class: *the check looked at the wrong thing* (top-level-children-only → synthetic wrappers → raw source text). Round 6 deliberately does NOT classify direct `bodyChildren` entries of `kind: "markup"`, because a state-child is author-written markup whose tag IS a variant name and no field distinguishes it from a mount — classifying there would false-accuse an alias that collides with a variant name. **That decision is correct. Do not reverse it.**

# THE TASK — hole 4, which I CONFIRMED BY EXECUTION MYSELF

An `<each>` or `<match>` sitting as a DIRECT entry of `engine-decl.bodyChildren` holds its body in `bodyChildren` / `armBodyChildren`, not in `.children`. The walker `seen.add(wr)`s it and then walks only `.children`, so the whole subtree becomes permanently unreachable.

Fixture I wrote and compiled against round 6's own compiler:

```
<program>
    ${
        import { "probe" as probeChan } from './chan.scrml'
        type LoadPhase:enum = { Idle, Done }
        <rows> = [1, 2]
    }
    <engine for=LoadPhase initial=.Idle>
        <each in=@rows as r>
            <probeChan/>
        </each>
        <Idle rule=.Done></>
        <Done rule=.Idle></>
    </>
</program>
```

(`chan.scrml` is at `docs/changes/s385-channel-cell-match-arm-scope/repro/chan.scrml` on the branch.)

Result: **exit 0, zero `E-CHANNEL-MOUNT-IN-CONDITIONAL`**, and the emitted client JS contains `document.createElement("probeChan")` with **`_scrml_ws` count = 0**. The silent dead channel, in a shape the guard does not reach.

**This is PRE-EXISTING, not a round-6 regression.** I compiled the identical fixture on `origin/main`: guard 0, ws 0. So round 6 is a strict improvement and this is a scope decision, not a blocker. I am asking for it because the fix looks cheap and because the docstring at `component-expander.ts:4841` currently claims its hole enumeration is exhaustive while it is not — and it explicitly invites a fourth to be added.

# THE FIX DIRECTION IS RELAYED AND UNVERIFIED — treat it as a hypothesis

A reviewer argued: the variant-name-oracle ambiguity that (rightly) stopped round 6 classifying direct `bodyChildren` entries applies ONLY to entries of `kind: "markup"`, so recursing into entries whose kind is `each-block` / `match-block` is unambiguous and carries no false-accusation risk. **I did not verify that.** The locus line numbers a reviewer cited (`:5019`, `:5045`) are likewise located-not-traced — re-derive them.

If the hypothesis holds, take it. **If recursing there reopens the round-3 false-accusation class, STOP and report** — I would rather ship hole 4 documented than trade one silent-wrong for another. Report explicitly whether the hypothesis held, was refined, or was wrong.

Whichever way it goes, **the docstring's enumeration must end up TRUE**: either the hole is closed, or it is listed as hole 4 with its own `test.todo`. Do not leave an "exhaustive" claim standing over a set you know is incomplete — over-claiming in a comment or a catalog row is a defect class this project has been bitten by twice.

# OUT OF SCOPE — do not touch

- `compiler/SPEC.md` / `compiler/PIPELINE.md`. The §34 catalog row for `E-CHANNEL-MOUNT-IN-CONDITIONAL` is owed and is PA-owned. Not yours.
- Hole 1 (the originally-filed `repro/a.scrml` shape still yielding a misleading `E-STATE-UNDECLARED`). Documented with a rationale I accept; I carry it in the landing note.
- `build.js` / `dev.js` diagnostic-location reconciliation — explicitly declared out of scope by the branch's own docstring.

# GATES — re-run all of these; a fix round invalidates the review that produced it

1. Pre-commit suite (`unit` + `integration` + `conformance`). Round 6 was **29368 pass / 0 fail**. Never `--no-verify`.
2. The 1005-file corpus differential, `origin/main` vs your tip — round 6 was **byte-empty**. A NON-empty differential is a finding to report, not to explain away.
3. `browser-baseline --check` — round 6 PASS, 48 asserted.
4. The new hole-4 fixture must fire `E-CHANNEL-MOUNT-IN-CONDITIONAL` after your change and must NOT fire before it (prove the gate bites in both directions — a gate that has never failed is indistinguishable from one that cannot).
5. The round-6 false-positive regression guards must stay green: an alias colliding with an enum variant mounted at `<program>` level; an alias colliding with an ENGINE state-child variant; an alias merely NAMED in arm prose. These are the round-3 blocker's guards.
6. Note: `compiler/tests/commands/auth-protected-document-served.test.js` fails identically on `origin/main` — pre-existing, not yours.

# PROCESS

- Commit after each meaningful unit; WIP commits expected. Append to `docs/changes/s385-channel-mount-guard-r7/progress.md` (timestamped, append-only) — the branch plus that file are your crash anchor.
- Write this brief VERBATIM to `docs/changes/s385-channel-mount-guard-r7/BRIEF.md` as an early step and commit it, so the landing carries its own instruction record.
- Report at the end: `WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, files touched, every gate result with real numbers, whether the relayed hypothesis held, and anything you deferred.
- If you conclude the fix is not safely reachable, say so plainly and land the honest docstring instead. **That is an acceptable outcome and I will take it.**
