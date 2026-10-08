# BRIEF — s452-impl1-msg-arms (archived verbatim)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2aa63c96bb28d7ad

---

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ 892d68735 (#1273).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. Never write under /home/bryan-maclee/scrmlMaster/scrml/ outside your worktree; never `cd` into the main checkout.
3. NEVER `git stash`; NEVER `pkill -f`/`killall` (kill by captured PID).
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete before final report). TMPDIR if set → ~/.cache/scrml-agent-tmp/s452-impl1-msg-arms.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-impl1-msg-arms/BRIEF.md (body `start at $(pwd)`); progress.md append-only. Code + its tests in ONE commit. Never --no-verify; never touch hooks. Pre-commit timeout 300000. Run git commands singly.
6. Push as `fix/s452-impl1-msg-arms` (normal push). Do NOT open/merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp d3e660a08). Post-map: #1269–#1273 (SPEC/bootstrap/docs; #1273 = §19.4.5 one pattern-arm grammar + §51.0.S.2.3). Treat loci as hypotheses; report whether load-bearing.

CONCURRENCY: Peter's S453 session is live in impl#1 (js-async-analysis.ts / listener emit, transaction emit in emit-server.ts). A sibling dispatch `fix/s452-impl1-pipeless-arms` changes `compiler/src/ast-builder.js` `parseErrorTokens` (the `!{}` handler arms) — do NOT touch that function. If you need either footprint, STOP and report.

TASK — impl#1 freeze EXCEPTION granted by bryan (user-voice-scrml.md §S452 "yes on the exception", /home/bryan-maclee/scrmlMaster/scrml-support/, read-only): make impl#1 parse engine `(state × message)` message arms WITHOUT a leading `|`. Read compiler/SPEC.md §51.0.S (esp. §51.0.S.2.3 as amended by #1273) and §19.4.5 IN FULL first; quote the governing sentences in progress.md.

Defect (measured by the SPEC agent on main): deleting the five `|`s from examples/25-triage-board.scrml compiles at exit 0 with NO diagnostic — message arms render as literal text, the `msg_arms` dispatch table is dropped, `.advance(.Drop(col))` degrades to a plain state advance. Locus (agent-traced, verify): `compiler/src/engine-statechild-parser.ts` ~:2102 `parseMessageArms` — recognizes arms only in a leading run of `|`-led lines; the native walker calls the same function (`engine-statechild-walker.ts` ~:544).

LESSON FROM THE SIBLING `!{}` FIX (its first version shipped a silent mis-split HIGH — avoid it by construction): a pipe-less arm head is EXACTLY `.V` | `::V` | `T.V` | `T::V`, optionally `( … )`, then IMMEDIATELY an arm arrow (`:>`, or deprecated `=>`/`->`); or `_` / `else` immediately followed by the arrow. NO paren-free binder after a pipe-less head (§19.4.5: the paren-free binder is `!{}`-only and only after `|`; message arms never had it). A `.`/`::` glued to the preceding token is member access, never a head. An arm BODY ending in `S.Empty` / `E::X` / `obj.f` must never be split into a fake next arm.
Position (§51.0.S.2.3 as amended): message arms are the LEADING items of the state-child body. Recognize the leading run of arm heads (piped, pipe-less, or mixed); the first non-arm item ends the run. Do NOT add the E-ENGINE-MSG-ARM-POSITION diagnostic (Nominal, out of scope) and add no other diagnostic. The `|` form must behave exactly as today.

Tests: for examples/25 and several minimal `accepts=` engines — pipe-less ≡ piped, BYTE-IDENTICAL emitted JS (client + server) and identical diagnostics; arm bodies ending in qualified variants followed by `_ :>` / `.V :>` (the mis-split class); single-expression and block bodies; a payload state-child (`<Dragging(id)>`) with message arms using both state and message bindings; mixed piped/pipe-less; render content after the arms stays render content. Runtime: drive `.advance(.Drop(col))` (or the example's message send) in happy-dom and show the arm fires and the transition happens.
Verification (DO NOT report done without it): (a) the pipe-less examples/25 compiles and behaves identically to the piped one (artifact diff empty); (b) full-corpus differential (examples/, samples/compilation-tests/, conformance/cases/, stdlib/) base vs branch — expected zero delta except any new case you add; report counts; (c) full gate green. If `docs/known-gaps.md` on main has `g-impl1-engine-message-arm-pipeless-as-text-s452`, mark it resolved with your SHA (marker `status=resolved` + a one-line resolution note).
FINAL REPORT (<500 words): worktree, FINAL_SHA (== pushed tip), locus + trace, files, tests, differential counts, `git status` clean.
