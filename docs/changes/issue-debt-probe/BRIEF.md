# BRIEF — `scripts/issue-debt.ts`: every open adopter issue has a HOME, or it is OWED (S346-bryan dispatch)

DONE-PROBE: test -f scripts/issue-debt.ts && grep -q 'issue-debt' scripts/boot.ts

## Why (pa-base §10 — an obligation and its probe MUST resolve to the same artifact)
Boot step 0.6 runs `gh issue list --repo bryanmaclee/scrml --state open` and the PA STATES the open
issues. That discharges nothing: at S346 three open issues — #519 (a DX bug, 08-12), #509 (offline/PWA
direction, 08-11), #471 (document-workflow direction, 08-08) — had been NAMED in the S343, S344, S345
and S346 boot reports and acted on by nobody: zero comments, no `docs/known-gaps.md` entry, no
`handOffs/dpa-queue.md` item. Adopter BUGS have a lane (Peter); a DIRECTION question has none, so it
was everyone's and therefore no one's. This is the review-floor hole (`scripts/review-debt.ts` — read
its header, it is the model) in a second channel: the probe reads the channel, nothing asserts the
obligation ("each open issue has a home").

## What to build
`scripts/issue-debt.ts` — plain bun-run TS, house style of `scripts/review-debt.ts` / `threads.ts`
(no deps beyond `gh` + fs). For every OPEN issue on `bryanmaclee/scrml` (`gh issue list --state open
--json number,title,createdAt,labels,comments --limit 200`), classify:
- **HOMED-GAP** — `#<n>` appears in `docs/known-gaps.md` (any entry text; do not require a specific field).
- **HOMED-DPA** — `#<n>` appears in `handOffs/dpa-queue.md`.
- **HOMED-BOTH** — both.
- **OWED** — neither. Print number · age in days · title · comment count (0 comments AND >2 days old
  is the loud shape — mark it `⚠️ SILENT`).
Print `issue-debt — N open · H homed · O OWED` as the first line (self-reported totals — pa-base §8
the truncated probe: NEVER `head`-cut the enumeration; if `gh` paginates, page it and print `of M`).
Exit 0 always in default mode (DETECTION, not control — never wire it into CI; §8 cry-wolf).
`--json` → machine-readable `{open, homed:[…], owed:[…]}`. `--check` → exit 1 iff any OWED (for the PA's
own use, not CI). Age uses `createdAt`; pass a `--now=<ISO>` override so tests are deterministic.
A `--repo` override (default `bryanmaclee/scrml`).

## Wire it into boot
`scripts/boot.ts:285-286` delegates the mandatory probes (`review-debt`, `threads`, and the S337
dpa-debt line) — add `runProbe("issue-debt", "Adopter issues (owed a home)", "bun", ["scripts/issue-debt.ts"])`
beside them, same shape; do NOT reimplement the classification inside boot.ts. Update boot.ts's header
comment list of delegated probes.

## Bite proof (mandatory — an unproven gate is a hypothesis, pa-base §8)
A unit test `compiler/tests/unit/issue-debt.test.js` (or under `scripts/` if that is where sibling
script tests live — check `git ls-files | grep -E 'review-debt|threads.*test'` and mirror it) that
feeds the classifier a synthetic issue list + synthetic ledger/queue text and asserts: an issue named
in neither → OWED; named in the ledger only → HOMED-GAP; in the queue only → HOMED-DPA; both → BOTH; a
`#51` must NOT match `#519` (word-boundary the number). Factor the classifier so it is testable without
`gh` (pure function over strings). Then run the real thing and paste its output in the report — at
S346 it should read **0 OWED** (the PA homed all three this session: #519 → gap, #509 → dpa-028, #471 →
dpa-029); if it reads otherwise, that is a finding.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp 4f034e13, 2026-08-11) §"Task-Shape Routing" — the row about
`bun scripts/boot.ts` names the read-set gate + its delegation rule; `build.map.md` for scripts. Report
the load-bearing finding.

## Mechanics (STARTUP VERIFICATION + PATH DISCIPLINE)
isolation: worktree. FIRST `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`;
toplevel equals it; clean tree; else STOP. `bun install`. `git checkout -b feat/issue-debt-probe`.
Edit/Write on WORKTREE-ABSOLUTE paths; never the main checkout; `bun --cwd`, `git -C`. Echo pwd in the
first commit; commit per unit; append-only `docs/changes/issue-debt-probe/progress.md`; NEVER
`--no-verify`; commit timeout ≥ 8 min; push `-u origin feat/issue-debt-probe` early + at end.
OUT OF SCOPE: `docs/known-gaps.md` (PA-owned), the overlay/profile docs in scrml-support (PA does the
contract line at wrap), CI workflows (deliberately NOT wired).
Gates: the unit test green + red-proven; `bun scripts/issue-debt.ts` runs against the live repo; `bun
scripts/boot.ts --no-probes` still runs (no syntax break); contract gate 0 fail.

## Final report (raw data)
FINAL_SHA · branch · files touched · the live probe's first line + the OWED list · where in boot.ts it was
wired · the bite proof output · maps finding.
