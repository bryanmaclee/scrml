# S426 — "a seed-bridge failure must be LOUD" enforced at EVERY green-state return

**Change-id:** `s426-seed-loud-doors`
**Dispatched by:** PA (S426-peter) · **base:** `origin/main` @ `021323b9`
**Gap:** `g-d6-seed-gating-has-three-latent-paths-that-produce-a-verdict-from-a-failed-or-unmeasured-seed`
— the **fifth path** (S426 amendment). MED, open.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its §"Task-Shape Routing".
⚑ **The map is STALE (stamp `787d4cb4`) and one cell is WRONG, not stale:** `test.map.md:450` says this
tier's gate is `tracking` (non-blocking). Verified false — `grep -rn e2e-render-map .github/workflows/`
returns nothing and the source-controlled pre-commit globs `compiler/tests/*.test.js`, which does not
descend into the subdirectory. **No gate runs this tier at all.** Do not infer coverage from the map.
Post-map landings in this exact directory: `bb9101ea` (#993), `1f6a8d1a` (#1001), `7ac7cef3` (#1002),
`f8d263de` (#1012 — the consuming-ancestor fix, which reshaped this file substantially).
Report the load-bearing map finding, "not load-bearing" included.

---

## THE REQUIREMENT, AND WHY THIS IS ROUND THREE OF IT

**A seed-bridge failure must be LOUD.** The harness writes seed values into the mounted app; when that
write fails or throws, the cell must NOT score green, because a green cell has its `detail` stripped by
`generate-baseline.js` and the failure then exists nowhere.

**Three rounds have each shut one door and left a sibling open:**
1. **S423** filed the class after the fourth adversarial pass on #993.
2. **#1002 (S424)** made a partial `set-threw` loud via `seedThrewNotice`, then found its own loudness was
   **not terminal** and added `hasSeedBridgeFailure` to the state-resolution `needs-server` return.
3. **S426's floor pass** found the **D1 mount-throw** `needs-server` return has no such guard and returns
   **before D2 ever runs**.

⚑ **So do NOT fix the third door. The convergent fix enforces the requirement at EVERY return that
yields a state in `GREEN_STATES`** — that is the actual invariant, and patching one door at a time is
what this entry's own history punishes.

## THE POPULATION — I COUNTED IT, AND MY OWN GAP NOTE WAS WRONG

`GREEN_STATES` (`e2e-render-map.test.js:80`) = `{ renders-clean, renders-empty, needs-server }`.
`runDetectors` in `compiler/tests/e2e-render-map/render-detectors.js` has **FOUR returns that yield one
of those** (my gap amendment said "two" — it was written before the count, and the entry tells the reader
to re-derive rather than trust it):

| return | state | seed-failure guard today |
|---|---|---|
| `:952` (D1 + D7 mount-throw block) | `needs-server` | **NONE — this is the fifth path** |
| `:1091` (state resolution) | `needs-server` | `hasSeedBridgeFailure` (#1002) |
| `:1126` | `renders-empty` | **unverified — establish it** |
| `:1128` | `renders-clean` | **unverified — establish it** |

⚑ **Verify the last two yourself before deciding they are safe.** The plausible argument is that
`seedThrewNotice` pushes into `consoleErrors`, so any thrown seed reaches D2 and returns
`compiles-but-throws` long before `:1126`/`:1128`. **That argument is exactly the shape that failed
twice already** — #1002's first fix was justified by "a D2 console error reddens the cell", which turned
out to be false for the `needs-server` tier. So: construct an observation that reaches each of those two
returns WITH a failed seed, and report what happens. If they are genuinely unreachable in that state,
say so **and pin it with a test**, because "unreachable" is a claim that rots.

## REPRODUCTION of the fifth path (PA-verified on `021323b9`)

`:952` fires on `obs.serverDependent && isServerAbsenceMessage(msg)` and returns before D2 runs, so no
`consoleErrors` inspection happens at all.

```js
runDetectors({
  compileErrors: [],
  throwMessage: "TypeError: Cannot read properties of null (reading 'rows')",
  consoleErrors: ["[seed-bridge] no _scrml_reactive_set side-channel — seed not applied"],
  document: null,
  seeded: true,
  serverDependent: true,
  seed: { wrote: false, threw: 1, writes: [{ key: "rows", reason: "set-threw" }], gainedContent: null },
})
// → state "needs-server" (GREEN), detail ["throwMessage","needsServer"]
// → the seed failure appears NOWHERE, and generate-baseline.js strips detail from green cells anyway
```

**Two controls that must keep their current behaviour:**
- the same observation **without** the mount throw → `compiles-but-throws` + `S-EMPTY-WITH-DATA`, seed
  failure recorded (this is #1002's door; it must stay shut).
- the same mount throw **without** a seed failure → `needs-server`, correctly green. **The fix must not
  blanket-red the `needs-server` tier**; nine baseline cells live there and all nine are unseeded today.

## SCOPE — what is IN and what is explicitly OUT

**IN:** the harness's OWN seed-failure signal, enforced at every green-state return.

**OUT, and already filed as item 2 of the same entry — do NOT widen into it:** that ANY console error
matching `isServerAbsenceMessage` admits the green carve-out, and that `hasHardSmell` omits D6's
`S-EMPTY-WITH-DATA`. Those are a different question (which *other* signals should disqualify the tier),
and #1002 deliberately scoped them out. If you believe they cannot be separated, say so with the
measurement instead of expanding silently.

**Prefer a shared predicate over a repeated condition.** Three or four copies of
`!hasSeedBridgeFailure` is the same "must stay in step" documentary invariant the #1012 round replaced
with hoisted constants — and this file has already been bitten by a source-text gate that asserted
nothing. One named helper consulted at each green-state return, or a single check at a choke point if one
genuinely exists.

## GATE

1. **Bite by mutation, and name what turns red.** Removing your disqualifier must red a test at EACH
   door you guard. A source-text assertion is NOT a behavioural gate — S424 proved there is no anchor
   that makes one detect behaviour; the real gate there was 13 behavioural tests.
2. **Both controls above pinned.**
3. **`renders-empty` / `renders-clean` dispositions pinned by tests**, whether you guard them or prove
   them unreachable-with-a-failed-seed.
4. `bun test compiler/tests/e2e-render-map/` — the tier is **216 pass / 0 fail** at `021323b9`. Report
   the new numbers.
5. **Report which committed baseline cells move. Expected: NONE** (all nine `needs-server` cells are
   unseeded). If any moves, STOP and report rather than regenerating the baseline.

## PROCESS (binding)

- **F4 startup:** confirm `pwd` is your worktree under `.../scrml/.claude/worktrees/agent-`, git toplevel
  equals it, tree clean. Then `bun install` — ⚑ **it FAILS on this clone** on the puppeteer postinstall
  (cached `chrome` folder present, `chrome.exe` missing); re-run with `PUPPETEER_SKIP_DOWNLOAD=1`. Run
  `pretest` from the worktree CWD, never `bun --cwd <path> run pretest`, which silently no-ops and exits
  0 — check the artifact, not the exit code. Any failure → STOP and report.
- Worktree-absolute paths on every write; never `cd` into the main checkout; `git -C "$WORKTREE_ROOT"`.
- ⚑ **NEVER `git stash`** (`refs/stash` is shared across every worktree) — flips by FILE COPY.
- ⚑ **Never a bare `pkill -f`** on a command string every checkout shares — kill by PID or filter on cwd.
- Commit after each unit; keep `docs/changes/s426-seed-loud-doors/progress.md` appended; clean tree
  before reporting DONE.
- **Step 1, because your worktree is cut from `origin/main` and this brief is not there yet:**
  `git fetch origin brief/s426-seed-loud-doors && git checkout FETCH_HEAD -- docs/changes/s426-seed-loud-doors/`

## ⚑ YOU ARE LICENSED TO OVERTURN ME

The four-return count, the loci, and the "enforce at every green return" framing are **PA-located,
verify-first**. In this session that licence has already paid twice: the brief's stated fix mechanism was
wrong (`parentNode` where an ancestor walk was needed), and the first invariant was wrong rather than
incomplete. **And a caution from the same session, in the other direction:** two review findings against
that work were later REJECTED because they were normatively wrong while behaviourally reproducible — so
if you conclude something here is wrong, say what the CORRECT answer is and how you established it, not
just that the current answer differs.

Report: what held, what was refined, what was wrong.
