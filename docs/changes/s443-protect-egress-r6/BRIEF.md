change-id: s443-protect-egress-r6

SECURITY (§14.8.9 protected-column egress, round 6). Base: origin/main (c53b297a7 or later).

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: 0 this session)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == pwd; tree clean; `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind, `git reset --hard origin/main` while clean). Else STOP.
2. `bun install`; `bun run pretest` plainly from the worktree CWD.
3. Every Edit/Write: absolute path UNDER your worktree. Never `cd` into main. NEVER `git stash`. NEVER `pkill -f`/`killall` on shared strings — kill by captured PID; 47xx ports. Scratch: /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/777e6bc5-4a13-4cb4-b3a0-497aaeb21665/scratchpad/s445-protect/.
4. First commit: this brief verbatim → `docs/changes/s443-protect-egress-r6/BRIEF.md` + `progress.md` (append-only); `WIP(s443-protect-egress-r6): start at $(pwd)`. Commit after each unit; code + test in ONE commit; foreground commits timeout ≥300000; never `--no-verify`, never touch core.hooksPath.
5. Parallel siblings live: app-root auth (route-inference.ts; maybe a minimal build.js hunk) and declared prose (ast-builder.js, block-splitter.js, native-parser/*, symbol-table.ts, type-system.ts, emit-html.ts). Your surface: protect-flow.ts, emit-server.ts, commands/build.js generateServerEntry error handler, scrml:crypto deriver classification. Keep build.js edits confined to the Bun.serve error handler.

MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` (stamp 5b1d0dab0; verify loci). Report whether load-bearing.

GOVERNING: read SPEC §14.8.9 IN FULL (and §14.8.10's boundary with it) and docs/known-gaps.md `g-protect-egress-round-6-residuals`. Every shape there was reviewer-executed over HTTP — REPRODUCE EACH FIRST with a served probe (compile, seed SQLite with a known secret, serve, POST, scan body + headers for the secret). A shape that does not reproduce is recorded NOT-REPRODUCED with the probe, not fixed blind.
Fix, fail-closed (over-approximate rather than add smarter recognizers):
L1 callback params of ANY unmodelled call take the join of receiver + all arguments' provenance (protect-flow.ts callbackMethod / CALLBACK_METHODS).
L2 the `arguments` object carries the join of all arguments.
L3 writes to globalThis / globalThis[...] / process.env / any unmodelled global store are sinks (E-PROTECT-006) or carry provenance on read.
L4 the descriptor key becomes a module-private Symbol (not Symbol.for) and the descriptor + its `revealed` array are frozen.
P1 RETURNING rows (INSERT/UPDATE/DELETE … RETURNING) are tagged like SELECT rows.
P2 `users . *` (whitespace around the dot) recognized as a star projection.
P3 error egress: the CPS error envelope in emit-server.ts (~4978, verify) must not serialize a raw err.message that may carry a protected value — redact or genericize (decide with the SPEC's error-shape wording; state it); the prod entry (build.js generateServerEntry) sets a Bun.serve `error:` handler that never returns stack/message to the client regardless of NODE_ENV.
P4 an unknown table (e.g. a runtime-created view) resolves to strip-all, not "no protected columns".
RULING S443 #7 (scrml-support/user-voice-scrml.md §S443, verbatim rec: "`scrml:crypto` `hash` on a protected column is currently allowed through … I recommend only keyed or password hashes count as declassified; a bare digest stays protected." → RULED): in the §14.8.9 deriver allowlist only verifyPassword / verifyHash / keyed HMAC / argon2-class derivers produce an independent-identity value; a bare digest (`scrml:crypto` hash with md5/sha1/sha256/…) of a protected value stays PROTECTED (E-PROTECT-006 at egress). Amend §14.8.9 with `> **Provenance:** ruling:user-voice-scrml.md S443 item 7` — supersedes the S441 allowlist line for bare digests (mark the superseded sentence in the same landing).
STOP CONDITION: if a round finds a NEW shape of an already-fixed class, change the mechanism (widen the join) rather than add a recognizer, and report it.
Direction-of-change: each fix is newly-rejecting or runtime-strip — MEASURE the migration: compile examples/, samples/, docs/readme-snippets/, conformance/cases/, stdlib/ before/after; report every new E-PROTECT-006 with file:line. Non-zero on a legitimate program → report, don't silently migrate.
Conformance cases (codes half + runtime half) per class where the harness can express it. Suites: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` 0 fail + `bun conformance/run.ts`.
Update `g-protect-egress-round-6-residuals` per class (resolved only after the served probe passes). `git push -u origin HEAD`.
REPORT: worktree, branch, FINAL SHA, files, per-class reproduced/fixed/not-reproduced with probe evidence, migration counts, suite numbers. `git status` clean before DONE.
