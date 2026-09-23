# BRIEF — s427-seed-fixtures: make the three wrong POPULATED seeds real

change-id: `s427-seed-fixtures` · dispatched S427 (peter / P-Tech1, Windows) · base: `origin/main` (includes #1018 + #1019)
Gap: `g-e2e-render-map-seed-fixtures-are-wrong-in-three-of-four-entries` (MED) in `docs/known-gaps.md` — read it in full first.

## 0. Startup (mandatory, in order)
1. `pwd` MUST be your worktree (`.../scrml/.claude/worktrees/agent-...`); `git merge-base HEAD origin/main` == `git rev-parse origin/main`; clean tree. Else STOP and report.
2. `PUPPETEER_SKIP_DOWNLOAD=1 bun install` (plain install fails on this clone's broken puppeteer cache).
3. `git fetch origin brief/s427-seed-fixtures && git checkout origin/brief/s427-seed-fixtures -- docs/changes/s427-seed-fixtures/` then commit `WIP(s427-seed-fixtures): start at <pwd>`.
4. Baseline: `bun test compiler/tests/e2e-render-map/` → expect 259 pass / 0 fail. Record it.
5. NEVER `git stash`; NEVER `pkill -f` a shared string; Edit/Write on worktree-absolute paths only; commit after each meaningful change; append timestamped lines to `docs/changes/s427-seed-fixtures/progress.md`.

## 1. The situation (PA-measured at 48dd05c3; verify, don't trust)
`compiler/tests/e2e-render-map/seed-fixtures.js` `POPULATED_SEEDS` has four entries. Committed baseline `#populated` cells today:
- `03-contact-book` — `renders-clean`, genuinely seeded (the only live one).
- `06-kanban-board` — `renders-clean`, but the seed names `todo`, a DERIVED cell (`const <todo> = @cards.filter(...)`); the write is discarded (`derived-cell`, quiet by carve-out) so the cell observes the UNSEEDED render. Also the rows use `column:` where the struct field is `status: Status` (an enum).
- `16-remote-data` — `renders-clean`, but the seed names `contacts`, which does not exist (`no-such-cell`); the app's only cell is `<phase>: ContactsPhase = .Idle` and the list renders from the `.Loaded(rows)` payload.
- `25-triage-board` — `renders-empty-with-data` (`S-EMPTY-WITH-DATA`), because the fixture's `column: "todo"`/`"doing"` never equals the app's `["Inbox","Doing","Done"]` under strict equality — a FIXTURE defect producing a red, not a compiler defect.
The gap entry's advice to keep 25 wrong as a live D6 subject is OBSOLETE: D6 region scoping landed (S423 / #1012) and is pinned by synthetic tests in `detector-validation.test.js`. Verify that a synthetic pin for the "rows emitted, lists empty" shape exists before you correct 25; if none does, add one FIRST so the shape stays pinned after the corpus subject disappears.

## 2. Goal
Every POPULATED seed actually drives its app, so the with-data half of the tier reaches 4 apps instead of 1. For each fixture:
- **06-kanban:** seed the SOURCE cell `cards` with rows matching the struct exactly (every field the app reads, per the SEED-SHAPE INVARIANT in the file header), including `status` as the app's `Status` enum. You must determine how an enum variant is represented at RUNTIME in emitted code (read the emitted client JS for this app — compile it with `bun compiler/bin/scrml.js compile examples/06-kanban-board.scrml --output-dir <tmp>`) and write that representation — do not guess.
- **16-remote-data:** determine whether the seed bridge can set `phase` to the runtime representation of `.Loaded(rows)` (a payload-carrying enum variant) such that the `<each in=rows>` arm renders. If it can, do it, with rows matching the row struct. If it genuinely cannot (explain the mechanism by execution), do NOT leave a fixture that silently does nothing: remove the entry and record why in the file with the measured reason, and say so in your report.
- **25-triage:** use the app's real column values (`"Inbox"`/`"Doing"`/`"Done"`) and every field the app reads.

## 3. What each cell must then score — and ask whether that is CORRECT
After the fixes, observe each `#populated` cell (the harness is `observeApp` / `observeCellSubprocess`; see `generate-baseline.js`). For each: state, smells, `detail.seed` (every write `written`?), and whether the rendered DOM actually shows the seeded rows. **A populated cell that turns RED is a potential real compiler bug** — do not "fix" it by weakening the fixture. Reproduce it standalone, check SPEC for the governing sentence if behaviour is in question, and REPORT it (file:line of the emitted defect if you can locate it). Only a fixture defect gets fixed in the fixture.

## 4. Baseline + pins
- The committed baseline `e2e-render-map-baseline.json` must reflect the new `#populated` cell states. ⚠ **Do NOT regenerate the whole baseline on this Windows clone** — a full regen here is known to import Windows-local differences (a POSIX regen is an owed, separate item). Update ONLY the four `#populated` cells, using the same record shape `generate-baseline.js` writes, and PROVE every other cell is byte-identical to origin/main's file (a JSON diff restricted to non-`#populated` keys must be empty).
- `e2e-render-map.test.js` carries a pinned per-app table (around the `"examples/03-contact-book.scrml": {` block) of expected seed reason codes / states. Update it to the new truth; it must red in both directions.
- Update `seed-fixtures.js`'s header/comments to match (no stale claims).

## 5. Gate — DO NOT report DONE without these
- `bun test compiler/tests/e2e-render-map/` all pass, 0 fail (report count vs 259). This tier is now a BLOCKING CI gate.
- Mutation bite: revert each fixture fix in turn → the pinned table reds; restore → green. Report numbers.
- Show, for each populated cell, evidence the seeded rows are in the DOM (a count of rendered row elements or their text) — "state is renders-clean" alone is not evidence the seed landed.

## 6. Report
Worktree path · final SHA · files touched · per app: how the seed is now expressed, the runtime enum/variant representation you found and how you found it, cell state + smells + seed reasons + DOM evidence, and whether any red is a suspected compiler bug (with repro) · 16-remote-data outcome · baseline diff proof · test count · mutation numbers · anything deferred.

## MAPS
`.claude/maps/` is stale; treat as hypotheses. Source is the authority.
