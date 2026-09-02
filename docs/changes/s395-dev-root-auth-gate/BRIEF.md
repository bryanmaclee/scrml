# BRIEF — s395-dev-root-auth-gate  (rulings 2b + 2c step 1) — **SECURITY**

Close `g-dev-root-path-fallback-serves-a-protected-document-unauthenticated` (HIGH, security) **via
limb (b)**, and fold in the §52.13 case-variant divergence. **ONE arc: same file, same class.**

## THE RULING (bryan, user-voice S395, "your recs")
**Limb (b): delete the ungated root branch and let `/` go through the gated loop — which dev ALREADY
DOES.** Grounds ratified with it: FORK RULE **row 4** (root-vs-position) — (b) removes a second code
path, (a) would teach the same rule twice; **row 2** — the extra branch is **fail-OPEN by
construction**, it serves whatever HTML it finds; and **prod already does (b)**, so this closes a
dev/prod divergence rather than shipping a second implementation of the gate.

**Ruling 2c, step 1, in this same arc:** fix the §52.13 case-variant divergence — a case-variant path
`/SECURE.html` returns **404** where the gated lowercase `/secure.html` returns **302**. Same file,
same class (dev-mode auth-gating parity).

## THE DEFECT — PA-VERIFIED BY SOURCE READ ON CURRENT MAIN
`scrml dev` serves an `auth="required"` document's rendered content to an unauthenticated `GET /`
whenever the protected document is not named `index.html`.

- `registeredProtectedDocs` is read at **exactly** `:1046` / `:1048`, inside the gated candidate loop.
  (Whole-file read sites: `:215` decl, `:325` reset, `:379` set, `:1046`, `:1048`. Nothing else.)
- `dev.js:1027` ALREADY folds `/` → `/index.html` into that loop's candidate list — which is why an
  `index.scrml` entry correctly 302s. **The fold is NOT missing.**
- The `pathname === "/"` branch at **`:1091-1122`** sits AFTER the loop and returns HTML from TWO
  paths — `resolveRootEntryCandidate`, and a sorted-`readdirSync` first-`.html` fallback — and
  **neither references the gate.**

So the defect is an **ADDITIONAL ungated root-only branch**, not a missing fold, and (b) is
"delete the extra branch", NOT "teach dev to route `/`".

## ⚑ THE ONE MEASUREMENT THE RULING EXPLICITLY OWES — DO THIS BEFORE CHANGING BEHAVIOUR
The gap entry warns that (b) *"changes which file dev serves at `/` in multi-input mode"*. The ruling
re-derives that on the corrected basis: since `:1027` already folds, **the only open question is what
`/` does when there is no `index.html`.** MEASURE it — what does dev serve at `/` today in
multi-input mode, and what would it serve after the branch is deleted? **Report both before you
finalise.** *"Dev 404s at `/` instead of guessing"* may well be the correct answer — but it is a
behaviour change that must be stated, not discovered later. If the measurement says deleting the
branch breaks a legitimate multi-input workflow, **STOP and report** rather than inventing a third
path.

## STARTUP (F4)
1. `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; VCS toplevel equals it; clean tree. Else STOP.
2. `git merge-base HEAD origin/main` == `origin/main`. 3. `bun install`.
4. `bun run pretest` PLAINLY from the worktree CWD (`bun --cwd <p> run pretest` silently no-ops and exits 0).
5. First commit `WIP(dev-root-gate): start at $(pwd)`.
6. Brief is on branch `fix/s395-dev-root-auth-gate`: `git fetch origin fix/s395-dev-root-auth-gate && git checkout FETCH_HEAD -- docs/changes/s395-dev-root-auth-gate/`

## PATH DISCIPLINE
Worktree-absolute paths only; never `cd` into main. **NEVER `git stash`** — `refs/stash` is SHARED
and other agents are live (4 pre-existing entries). File copies only. **NEVER a bare `pkill -f`.**
**NEVER `--no-verify`**; don't touch `core.hooksPath`. `progress.md` in the change dir, not the root.

## VERIFICATION — this is a SECURITY fix; the control is the deliverable
**Phase 1 — the two-sided leak control, mirroring how the entry was filed.** Same fixture
(`<program auth="required"><page><h1>SECRET DASHBOARD</h1></page></program>`), two entry filenames,
driving `devDispatch` exactly as the existing §52.13 test does (`loadServerRoutes(out)` then an
unauthenticated `Request`):
- entry `secure.scrml`: base `GET /` → **200 with `SECRET DASHBOARD` in the body** (the leak);
  fixed → **302** to loginRedirect. `GET /secure.html` → 302 on both.
- entry `index.scrml` (the CONTROL): **302 on both**, before and after.
Report the actual status codes and whether the body contained the secret. **A fix that 302s `/` but
that you cannot show leaking at base has not been proven to bite.**

**Phase 2 — the §52.13 case variant.** `/SECURE.html` must reach gating parity with `/secure.html`.
Report the before/after status for both, and confirm no content escapes in either.

**Phase 3 — regression coverage.** The existing §52.13 test probes `/secure.html` and a case variant
but **never probes `/`** — which is exactly why a genuinely-fixed gate stayed open on the path an
adopter actually visits. Add `/` to the probed set, for BOTH entry-name shapes.

**Phase 4 — the multi-input measurement above, reported explicitly.**

**Phase 5** — `bun run test` green; name any failure-set delta vs base. Note `compiler/tests/commands/`
runs in NO blocking job on any platform, so run it deliberately rather than trusting CI.

⚑ **Prod is structurally safe and MUST STAY THAT WAY** — the generated production entry normalizes
`/` into the gated loop. If your change touches shared code rather than dev-only code, prove prod is
unchanged by inspecting the generated artifact.

## PROVENANCE (Rule 4b)
`prov=ruling:user-voice-scrml.md S395 — "your recs" adopting limb (b) + folding §52.13 into one arc`

## REPORT BACK
worktree path · final SHA · files touched · Phase-1 two-sided control with real status codes ·
Phase-2 case-variant parity · Phase-3 new coverage · Phase-4 multi-input behaviour before/after ·
Phase-5 suite delta · prod-unchanged evidence · anything deferred.
