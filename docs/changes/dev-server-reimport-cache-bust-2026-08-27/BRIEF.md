# BRIEF — `scrml dev`'s server re-import cache-bust is a no-op on Bun (adopter #724)

**Dispatched:** S379-bryan, 2026-08-27. **Base:** `origin/main` @ `48f0aaf8`.
**change-id:** `dev-server-reimport-cache-bust-2026-08-27`
**Gap:** `g-dev-server-reimport-cache-bust-is-a-no-op-on-bun` (HIGH) — filed on PR #725.
**Adopter issue:** #724 (`pjoliver11`/assetManagement). Hit twice in production dog-fooding.

This is a **build**, not an open question. The root cause and the fix mechanism were both isolated
BY EXECUTION by the PA today on `48f0aaf8` + Bun 1.3.14 — every measurement below is reproduced,
not relayed. What is open is the implementation.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — hard gate)

Worktree root: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/` = `WORKTREE_ROOT`.
⚑ The repo is **`scrml`** (renamed S200). Any older brief you may pattern-match saying `scrmlTS` is stale.

## Startup — BEFORE any other tool call
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo, **STOP and report** (S90 CWD-routing). Save `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **Assert your base**: `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
   ⚑ **S346: a worktree is cut from `origin/main`, NOT from the dispatching checkout's HEAD.**
4. **Fetch this brief into your tree** — it is on a branch, not yet on `main`:
   ```
   git fetch origin brief/s379-dev-reimport
   git checkout FETCH_HEAD -- docs/changes/dev-server-reimport-cache-bust-2026-08-27/
   ```
5. `git status --short` clean. 6. `bun install`.
7. `bun run pretest` — **run it plainly, from the worktree CWD.**
   ⚑ **S376: `bun --cwd <path> run <script>` SILENTLY NO-OPS and exits 0.** It prints the script
   list and does nothing, so the browser fixtures never build and the pass is fake. Verdict by exit
   code is no defence here — **check the artifact exists**. Use `--cwd=<path>` (with the `=`) or
   plain CWD.
8. Use `bun run test` (chains pretest) for full-suite baselines, never bare `bun test`.

If ANY step fails: **STOP and report.** Do not proceed on a half-verified workspace.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths**.
  ⚑ **S314: the old "Bash-only edits" rule is RETIRED and is now actively wrong** — the isolation
  guard refuses Bash heredocs/redirects as "too complex to verify", and the `path-discipline.sh`
  PreToolUse hook guards *Edit/Write* specifically. Bash-based writes are the one surface the hook
  cannot see.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **NEVER a bare `pkill -f "bun ..."` / `killall`.** This arc starts and stops dev servers, so
  this rule is LIVE for you, not boilerplate. Every checkout shares the command string, so
  `pkill -f "scrml.js dev"` matches a dev server another checkout is running just as well as yours,
  and killing it leaves **no trace on your side**. **Capture the PID at launch and kill by PID.**
  Same footing as "never `cd` into main."
- First commit message includes your verbatim `pwd`: `WIP(dev-reimport): start at <pwd>`.

# COMMIT DISCIPLINE
Commit **after each phase** — do not batch. Your branch + `progress.md` are the only crash-recovery
anchor. Coupled code+test lands **together** (no transiently-red window). `git status` clean before
DONE. Update `$WORKTREE_ROOT/docs/changes/dev-server-reimport-cache-bust-2026-08-27/progress.md`
per phase. **NEVER `--no-verify`** — and never work around it by overriding `core.hooksPath` (S283).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; for this shape also
read `.claude/maps/infra.map.md` and `.claude/maps/structure.map.md`.
Map stamp `fc6df72e`; base `48f0aaf8`. **PA currency check performed:** `git diff --name-only
fc6df72e..48f0aaf8 -- compiler/src` is **EMPTY** — zero compiler source moved since the map was
written, so it is current for this arc. The only post-map landings anywhere are `scripts/ctx.ts`
(#708) and `scripts/review-debt.ts` (#721), neither on this surface.
⚑ **One map row is about a DIFFERENT bug and will mislead you if you skim it.**
`primary.map.md` line ~467 routes *"`scrml dev` serving a stale/partial bundle"* and says **FIXED**.
That row is about the **compile-FAILURE** path (#517/#518/#539 — serve the real compile error
instead of last-good output while the build is red). It is correct and it is not this bug. **This
bug is on the compile-SUCCESS path**: the compile succeeds, the disk is correct, and the reload is
a no-op. Do not read that row as "already fixed."
Treat map content as a **verify-against-source hypothesis** and report whether it was load-bearing
(including "not load-bearing" — that is a real answer).

---

# THE DEFECT — root cause, isolated by execution

## Locus
`compiler/src/commands/dev.js`, function **`loadServerRoutes`**. (Symbol, deliberately not a line —
a line number in a brief rots against the very change it describes.)

It re-imports each emitted `*.server.js` as:

```js
const cacheBuster = Date.now();
const fileUrl = `file://${absPath}?t=${cacheBuster}`;
mod = await import(fileUrl);
```

on the strength of the comment directly above it:

> *"Bun caches ES module imports by specifier. To force a reload after recompilation we append a
> `?t=<timestamp>` cache-buster to the import URL."*

## ⚑ That premise is FALSE on Bun. PA-measured, Bun 1.3.14.

Bun **discards the query string** on a `file://` specifier, so the re-import returns the **cached**
module. The idiom is correct on Node — which is where it comes from — and that is exactly why it
survived review: it is a well-known pattern that reads as obviously right.

Isolated probe (write `m.js` = `v1`, import, overwrite to `v2`, re-import):

| strategy | result |
|---|---|
| `file://<abs>?t=<now>` — **what dev.js does today** | **`v1` — FAILS** |
| distinct FILENAME | `v2` — busts |
| `data:` URL | `v2` — busts, but **disqualified**: it breaks the module's relative imports |

## The two adopter-visible manifestations, one root

**(1) Stale values.** Edit a server-fn body → the new bundle is on disk within ~1 s → the running
server serves the old handler forever. PA-reproduced end-to-end: route returned `{"version":"v1"}`
while `dist/*.server.js` on disk read `version: "v2"`.

**(2) ⚑ Silent wrong ROUTING — strictly worse, and the half that cost the adopter an hour twice.**
`__ri_route_<name>_<N>` is numbered by declaration order, so ADDING or REMOVING a server fn
renumbers every route after it. The client bundle is re-served with the NEW numbers; the cached
server module keeps the OLD ones. PA-measured — after inserting one `function alpha()` above
`ver()`:

| | |
|---|---|
| client bundle calls | `__ri_route_alpha_1`, `__ri_route_ver_2` |
| server bundle **on disk** has | `__ri_route_alpha_1`, `__ri_route_ver_2` |
| **running server serves** | **only `__ri_route_ver_1`** |
| `POST __ri_route_ver_2` | **404 "Not found"** |
| `POST __ri_route_alpha_1` | **404 "Not found"** |
| `POST __ri_route_ver_1` | 200 — a live **zombie** route the client no longer calls |

No error, no 500, no console line. A whole feature vanishes. The adopter lost an admin tile set to
this and read it as an auth bug.

## ⚑ The dev log carries the evidence of its own failure and never raises it
It prints `[dev] Change detected — recompiling...` and then
`[dev] Registered 1 HTTP route(s): POST /_scrml/__ri_route_ver_1` — naming the STALE route, and
counting 1, while the disk holds TWO routes under different names. A green report over a no-op
reload: the `pa-base` §8 hollow-gate shape. **Both numbers are already in hand at that moment**,
which is what makes Phase 2 below cheap.

## Scope — read this before you widen anything
**`scrml dev` ONLY.** `scrml build` compiles once and the built server imports each module once, so
production output is unaffected. **The emitted artifacts are correct at every step** — this is not a
codegen bug and nothing under `compiler/src/codegen/` should change. Route NUMBERING is also not in
scope: renumbering on declaration-order change is by design; the bug is that the server keeps the
old numbers, not that the numbers move.

---

# THE FIX — mechanism verified, and the obvious version of it DOES NOT WORK

⚑ **Read this table before designing.** 120 of 324 emitted `*.server.js` in this repo carry
RELATIVE imports, and many are sibling `*.server.js` modules
(`../../components/load-card.server.js`, `./password.server.js`) plus `_scrml/*.js` runtime shims.
So the entry module is the root of a GRAPH, not a leaf — and busting the root does not bust the
graph. PA-measured with a two-module fixture (`app.server.js` → `./components/leaf.server.js`,
mutating only the LEAF):

| candidate | result | verdict |
|---|---|---|
| **A** — rename/copy only the ENTRY module | **`L1`** | **FAILS.** The sibling is still served from cache. This is the intuitive fix and it is wrong. |
| **B** — copy the WHOLE output tree to a per-generation dir, import from there | `L2` | Works. Cost is O(dist size) on **every** edit. |
| **C** — create a per-generation **SYMLINK** to the output dir at the same parent, import through it | `L3` | **Works, and is O(1).** Bun does NOT canonicalise the symlink away, so the symlinked prefix is a distinct specifier and every relative import inside resolves fresh through it. |

**Take C.** B is the fallback if C fails a check you find.

## What C has to get right — these are requirements, not suggestions
1. **Per-generation, monotonic.** A new symlink name per successful recompile (a counter is enough;
   do NOT use a timestamp that can collide within a millisecond).
2. **Clean up the previous generation's symlink** after the new one is loaded. Unlink only the
   SYMLINK — never the real output tree. A module already imported stays live in memory, so
   unlinking after import is safe.
3. **⚑ Windows.** `fs.symlinkSync` for a DIRECTORY needs elevation or developer mode on Windows and
   will throw `EPERM` otherwise. Pass `'junction'` as the type for directories — junctions need no
   elevation. This repo has a live Windows lane and a `windows` CI check; a fix that throws on
   Windows is not a fix. If junction also proves unavailable, fall back to B for that platform and
   SAY SO in `progress.md`.
4. **Symlink lands outside the served tree, or is excluded from static serving.** The dev server
   serves `dist/` statically; do not create a path that makes the whole output tree fetchable twice
   or that the file-watcher then treats as a source change (a watcher/recompile loop is the failure
   to look for). Put it in a sibling temp location or a dot-prefixed name that the watcher ignores —
   **and prove the watcher ignores it**, do not assume.
5. **Never leave the process without routes.** If the re-import throws, keep the previously
   registered routes and report loudly; a failed reload must not silently empty `registeredRoutes`.
6. **`scrml build` must be untouched.** No per-generation artifact may appear in a production build.

## Phase 2 — the loud interim guard, and it is REQUIRED, not optional
Independently of C, **close the silent half**: after loading, compare the route set just registered
against the route set present in the `*.server.js` files on disk. On disagreement, print a loud,
unmissable line naming the difference and telling the adopter to restart. Both numbers are already
in hand at that point (the log already prints one of them).

This exists because it fails LOUD where the bug fails SILENT, and because if C ever regresses on a
platform or a Bun version, this line is what turns a vanished feature back into a visible error.
The adopter asked for exactly this in #724: *"even just a 'server bundle changed — restart to
apply' line in the dev log would remove the whole class."*

---

# TESTS — and the bar is that they FAIL without your fix

⚑ **The pin must exercise the REAL path.** A test that reimplements the cache-bust logic inside the
test file and asserts on its own reimplementation is worse than no test — it reads as coverage and
passes with the fix reverted. S378 lost five review rounds to exactly that and had to revert the
work. **MUTATION-PROVE your pins**: revert your `dev.js` change, confirm the new tests go RED,
restore, confirm GREEN. Record both observations verbatim in `progress.md`. A pin that stays green
with the fix reverted gets deleted, not explained.

Required coverage:
1. **The graph case, which is the one that matters** — an entry `*.server.js` importing a sibling
   `*.server.js`; mutate ONLY the sibling; assert the reload serves the new value. Candidate A
   passes a single-module test and fails this one; that is why this case is mandatory.
2. **The renumber-desync case** — register a route set, add a server fn so numbering shifts, assert
   the running server serves the NEW route names and **no zombie** old route answers 200.
3. **The Phase-2 guard** — assert the loud line fires on a deliberately induced disagreement, and
   does NOT fire in steady state (a guard that always fires is the cry-wolf shape and gets ignored).
4. `loadServerRoutes` is already exported for unit tests — prefer driving it directly over standing
   up a full server where you can.

# PHASE 3 — EMPIRICAL VERIFICATION (do not mark DONE without it)
The unit tests are not the acceptance gate. **Reproduce the adopter's own scenario end-to-end**, on
your post-fix build, with a real `scrml dev` process:

1. Build the two-fixture repro from the tables above (a `<db>` + a server fn returning `"v1"`).
2. `scrml dev` it on a port **you pick and record**; capture the PID at launch.
3. Call the route (it is CSRF-guarded — send a `scrml_csrf=<T>` **cookie** AND a matching
   `X-CSRF-Token: <T>` header; any value works, they just have to match). Expect `v1`.
4. Edit `"v1"` → `"v2"`, wait for the recompile to land on disk, call again. **Expect `v2`.**
5. Insert a `function alpha()` ABOVE `ver()`, wait for recompile, and assert the running server
   answers the NEW route names and 404s nothing the client calls.
6. Kill by the captured PID.

**Symptom-gone check is the RESPONSE BODY and the ROUTE TABLE — not "tests pass."**

# BASELINE — set-comparison, never a remembered number
⚑ Do NOT trust any pre-existing failure count you are told, including one in a hand-off. S378
relayed "6 pre-existing integration flakies" when the true figure was **53-55**, and it moved by 2
between two runs of the same unmodified tree. **Capture your own baseline on your base commit
before you change anything, and compare SETS (0 new / 0 fixed), not counts.**

# WHAT TO REPORT
`WORKTREE_PATH`, `FINAL_SHA`, files-touched, the A/B/C decision you landed and why, the
mutation-proof observations, the Phase-3 transcript, the baseline set-diff, and anything you found
that this brief got wrong. ⚑ **The brief being wrong is an expected outcome, not a failure** — the
last four dispatches on this project each out-measured the PA on at least one premise. If a premise
here does not hold, say so plainly and act on what you measured, not on what this document claims.

# MUST NOT TOUCH
- `docs/known-gaps.md` — PA-owned this session and being edited concurrently. The PA flips the gap
  status at landing. Record your status claim in `progress.md` instead.
- `compiler/src/codegen/**` — the emitted artifacts are correct; this is not a codegen bug.
- `hand-off.md`, `master-list.md`, `handOffs/delta-log.md`, `docs/changelog.md` — PA-owned.
