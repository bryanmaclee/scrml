# Dispatch BRIEF — ss22 item 4: g-peer-call-in-raw-template-unawaited (MED)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus · **change-id:** ss22-peer-template-emit-2026-06-25
**Land target (sPA-side):** `spa/ss22`. **Stated base:** origin/main `cf9f1109` (contains ss19 peer-await `538df06d`).

ONE gap: an inline `${peer()}` in a template literal / a `?{…${peer()}…}` SQL param / a `${@cell}` inside a server-fn template BYPASSES the #8 statement-level structured emit → unawaited peer call / unrewritten cell → invalid JS. Locus `compiler/src/codegen/emit-server.ts` (the peer-await structural pass — ss19 Group A `538df06d` is the prior art).

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP. Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **BASE-CURRENCY (S112):** `git -C "$WORKTREE_ROOT" fetch origin --quiet && git -C "$WORKTREE_ROOT" merge origin/main` (FF). Then `git -C "$WORKTREE_ROOT" merge-base --is-ancestor 538df06d HEAD` MUST succeed (ss19 peer-await prior art present). Non-clean FF → STOP.
4. `git status --short` clean. 5. `bun install`. 6. `bun run pretest`. Baseline = `bun run test`.
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **S126:** Bash edits on worktree-absolute paths; NOT Edit/Write. Echo path; re-verify. **NEVER `cd` into main.** **Commit-message file:** UNIQUE (`msg-<agentid>-peer.txt`).

## Commit discipline
- ONE commit (fix + coupled test). Clean tree. NEVER `--no-verify` (hook ~108–180s; allow 300s).

---

## Read FIRST — ss19 Group A peer-await prior art
`emit-server.ts` peer-await threading landed in ss19 (`538df06d`; `(private — scrml-support/handOffs/adopter-confidential/)`). It applies a "#8" STATEMENT-LEVEL structured emit that awaits peer calls + rewrites `@cell` reads correctly. The gap: this pass fires on statement positions but NOT on TEMPLATE-INTERPOLATION positions.

## The gap (reproduce RED first — 3 shapes)
Inside a `server function`:
- (a) a template literal `` `…${peer()}…` `` — `peer()` is async; emitted UN-awaited → a Promise stringifies into the template (invalid/wrong).
- (b) a SQL `?{… ${peer()} …}` param interpolation — same unawaited-peer.
- (c) `${@cell}` inside a server-fn template — the cell read is not rewritten the way the #8 statement path rewrites it.
All bypass the #8 structured emit because interpolation positions aren't routed through it. Construct RED repros for each; confirm the emitted JS is invalid / unawaited (node --check or a Promise-in-output signature).

## Fix direction
Apply the SAME pass-#8 structural emission (await peer calls + structured cell rewrite) to TEMPLATE-INTERPOLATION positions in server-fn bodies — template literals, SQL `?{}` param interps, and `${...}` in server templates. Reuse the existing #8 machinery (do NOT fork a parallel lowering); route interpolation sub-expressions through it. A peer call in an interp position must become an awaited value bound before the template, then referenced (or an inline `await` if the template is in an async position) — match how #8 already hoists/awaits at statement level. Keep non-peer, non-cell interps unchanged.

## Test (RED first, node --check + value)
- (a) template `${peer()}`, (b) SQL `?{${peer()}}`, (c) `${@cell}` in a server template → each emits VALID awaited JS (node --check) and the awaited value (not a Promise) lands in the output. Adversarial (S215): multiple peers in one template; a peer + a plain expr mixed; nested templates. Regression: existing #8 statement-level peer-await tests stay green; client-side templates unchanged.
- Paste RED (unawaited/invalid) + GREEN per shape.

## Verification
- `bun run test` GREEN, 0 regressions vs baseline (report counts; the pre-existing within-node `[over-budget] login.scrml residual 7` + bug-51-flaky-timeout are KNOWN — confirm vs base).
- R26: recompile repros; valid awaited JS.

## Scope boundaries
- ONLY routing template-interpolation positions through the existing #8 server-emit pass. Do NOT redesign #8, the client path, or non-template peer handling.
- If interpolation-position await needs a structural change beyond #8 reuse (e.g. the template is in a non-async context that can't await), STOP + report.

## Report back
FINAL MESSAGE = structured return: commit SHA, RED→GREEN per shape, emit-server.ts diff, node --check proofs, clean-tree confirmation, agent branch + tip SHA, base SHA.
