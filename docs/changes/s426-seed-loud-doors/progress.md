# S426 — progress log (`s426-seed-loud-doors`)

Base: `origin/main` @ `021323b9`. Branch: `fix/s426-seed-loud-doors`.

## Unit 1 — the requirement enforced at every green-state return

**What the requirement is (restated from the brief, and this is the version the code now
encodes):** no cell may score a state in `GREEN_STATES` while a seed-bridge failure is on the
record, because `generate-baseline.js` strips `detail` from green cells and the failure then
exists nowhere.

### The population, re-counted and re-measured (the brief's table held, with one correction)

Four returns in `runDetectors` yield a green state. Measured pre-fix on `021323b9` and post-fix,
same observations both sides (`scratchpad/probe.mjs` vs the committed `render-detectors.js`):

| return | state pre-fix | state post-fix | guard today |
|---|---|---|---|
| D1 + D7 mount-throw | `needs-server` **(GREEN)** | `compiles-but-throws` | door demotes itself (truer red exists) |
| state resolution | `compiles-but-throws` | `compiles-but-throws` | #1002's guard, now the shared predicate |
| `renders-empty` | `renders-empty` **(GREEN)** | `seed-bridge-failed` | terminal guard |
| `renders-clean` | `renders-clean` **(GREEN)** | `seed-bridge-failed` | terminal guard |

**THREE of the four were fail-open, not one.** The brief marked the last two "unverified —
establish it"; they are reachable with a failed seed, and the repo already contained an
observation that reached one and pinned it GREEN (the S424 block's "a VETO WITHOUT the notice"
case).

### The mechanism, and the one thing the brief did not predict

The failure has **two carriers**, and which one you key on decides whether a guard has a bite:

1. **the NOTICE** — a `[seed-bridge]`-prefixed entry in `consoleErrors`. #1002's carrier.
2. **the FACT** — the seed report's own `errors[]`, and a `set-threw` write.

A guard keyed only on carrier 1 is **dead code at the `renders-empty` / `renders-clean` doors**:
any such notice makes `consoleErrors` non-empty, so the state-resolution block returns before
those doors are reached. Those two doors are reachable **only** through carrier 2 — so the
"plausible argument" the brief distrusted is *true of the notice and false of the requirement*.
`seedBridgeFailed` therefore reads both, and the carve-out survives by construction: `applySeed`
pushes nothing into `errors` for `derived-cell` / `no-such-cell` (the tabled fixture bugs), and
neither can be a `set-threw`.

### Shape of the fix

- `seedBridgeFailed(obs)` — the one named predicate, replacing #1002's inlined condition.
- `noteSeedBridgeFailure(smells, detail, note)` — one writer for the recorded fact
  (`S-SEED-BRIDGE-FAILED` + `detail.seedBridgeFailure`).
- `runDetectors` is now a **wrapper** over the classifier (`classifyObservation`, not exported):
  any green state that survives the classifier is demoted to the new `seed-bridge-failed` state
  when the predicate fires. This is the choke point, and it is what makes the fix class-complete
  over green returns **that do not exist yet** — the failure mode this entry's own history
  punishes (three rounds, three doors, one requirement).
- `seed-bridge-failed` is a new `RENDER_STATES` member: red, so `detail` survives, and it blames
  the HARNESS rather than the compiler (`compiles-but-throws` would claim a throw that did not
  happen; `renders-empty-with-data` is the mis-attribution round 2 of `seedThrewNotice` shipped).
- `GREEN_STATES` **moved to `render-detectors.js` and is now imported** by `generate-baseline.js`
  and `e2e-render-map.test.js`. It was three hand-kept copies; the enforcement has to agree with
  it, so a fourth copy was not acceptable.

### Two existing assertions changed, both deliberately

1. `"question B: a VETO WITHOUT the notice would be FAIL-OPEN — it scores the cell GREEN"`
   pinned `renders-empty` and its own comment called that hazardous. It was the S426 gap reached
   by a third door. Now pins `seed-bridge-failed`.
2. The CONTROL inside `"a seed-bridge failure disqualifies the needs-server GREEN carve-out"`
   overrode `writes` to a landed write but kept `errors: ["[seed-set items] boom"]` from its
   helper — so the "clean" observation still asserted, in its own report, that a write had
   THROWN. `applySeed` cannot emit that pair. `errors: []` added so the control tests what it
   claims; the contradictory shape is pinned separately, where fail-CLOSED is the answer.

### Gate

- `bun test compiler/tests/e2e-render-map/` — **236 pass / 0 fail** (216/0 at `021323b9`; +20).
- Mutation bite and baseline-movement check: unit 2 below.

## Unit 2 — the bite, the baseline, the map

### Mutation bite, one mutant per guard (⚑ gate item 1: a source-text assertion is not a gate)

`bun test compiler/tests/e2e-render-map/detector-validation.test.js` — 221 pass / 0 fail clean.

| mutant | reds | which tests |
|---|---|---|
| drop `!seedBridgeFailed(obs)` at the **D1 door** | **2** | `DOOR 1 — … (notice carrier)`, `DOOR 1 — … ONLY in the report` |
| drop it at the **state-resolution door** | **2** | `DOOR 2 — #1002's door …`, and #1002's own `a seed-bridge failure disqualifies the needs-server GREEN carve-out` |
| disable the **terminal guard** in `runDetectors` | **5** | `DOOR 3`, `DOOR 4`, both `INVARIANT — renders-empty/renders-clean` sweeps, and the re-pinned `question B` case |
| predicate **notice-only** (drop the FACT carrier) | **8** | `DOOR 1 (report only)`, `DOOR 3`, `DOOR 4`, all three `INVARIANT` sweeps, `question B`, the FACT unit case |
| predicate **fact-only** (drop the NOTICE carrier) | **2** | `DOOR 1 — a notice with NO report at all`, the NOTICE unit case |

Two readings worth keeping:

- The D1 and state-resolution mutants red only their DOOR-level tests, not the `INVARIANT`
  sweep — because the terminal guard catches what the door let through and the cell still lands
  non-green. That is the defence-in-depth working, and it is why the door tests assert the
  precise state rather than only "not green".
- The **fact-only** mutant reds just two cases, so for every report the harness actually
  BUILDS the fact carrier subsumes the notice (all three failure sites in `observeCompiled`
  record an error in the report as well as pushing). The notice earns its keep on an
  observation whose report never reaches the detector — which is the S426 brief's own
  reproduction verbatim, since it passed the report under `seed` and `runDetectors` reads
  `seedReport`. Pinned as `DOOR 1 — a notice with NO report at all`.

### Baseline movement: NONE, measured two ways

1. **A/B of the slice delta.** With `compiler/tests/e2e-render-map/` checked out at `021323b9`
   the suite reports the SAME 1 orphan, 3 new cells and 2 green->red warnings
   (`benchmarks/todomvc/app.scrml#empty`, `examples/09-error-handling.scrml#empty`) as it does
   with the fix. Both are `#empty`, unseeded, `D1-MOUNT-THROW` / `D0-COMPILE-ERROR` — pre-existing
   at the base commit and untouched by this change.
2. **The four seeded cells re-observed cell by cell** (`observe-one.js … populated`), because a
   red->red move would be INVISIBLE in a green->red delta list. All four match the committed
   baseline exactly, and all four report `errors: []` with no `set-threw`:
   `03-contact-book renders-clean` · `06-kanban-board renders-clean` (`derived-cell`) ·
   `16-remote-data renders-clean` (`no-such-cell`) · `25-triage-board renders-empty-with-data`.
   The two tabled fixture bugs are therefore carved out on the REAL corpus, not only in
   constructed observations. The nine `needs-server` cells are all `seeded=false` — no seed
   report at all, so the predicate cannot fire on them.

### Tier numbers

`bun test compiler/tests/e2e-render-map/` — **237 pass / 0 fail** (216 / 0 at `021323b9`; +21:
20 new S426 cases plus the notice-carrier pin). `pretest` was not run: nothing in this tier reads
`samples/compilation-tests/dist` — the harness compiles each cell itself — and the tier is green
without it.

### Nav-map finding (load-bearing, and it is the one the brief flagged)

`test.map.md:450` says this tier's gate is `tracking` only (non-blocking). **Independently
verified FALSE, and the truth is worse than stale:** `grep -rn e2e-render-map .github/workflows/`
returns nothing, and `ci.yml`'s jobs name `compiler/tests/unit`, `compiler/tests/conformance`,
`compiler/tests/*.test.js` (a non-recursive glob), `integration`, `lsp`, `commands`, `browser`,
`parser-conformance-within-node.test.js` — none of which descends into this subdirectory. **No
job runs this tier at all**, so a green->red regression here blocks nothing. The tier's own
header (`e2e-render-map.test.js:18`) has recorded this correctly since S419; the map contradicts
a source comment that is right, which is the worst of the two directions. Load-bearing for
anyone deciding how protected this fix is: it is protected only by a human running the tier.
