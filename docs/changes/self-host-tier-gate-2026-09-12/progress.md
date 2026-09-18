# self-host tier coverage disposition — S409 ruling

Append-only. Worktree: `.claude/worktrees/agent-ae5faac4652cc61da`, cut from `origin/main` @ `fd69d1fc`.

## The disposition (ruled, not re-litigated)

`compiler/tests/self-host/` (4 files) is run by neither CI job and by no hook. The S409 #924
regression — a mangled character-class regex in `compiler/self-host/tab.scrml` that made
`isAttrIdentPart` return false for every character and turned a tokenizer loop into an unbounded
allocator (an 82 GB host lockup) — reached no gate because nothing runs that directory.

Ruled: **gate the tier on a failure NAME SET**, mirroring the proven `scripts/browser-baseline.ts`.
Not "gate it green" (3 real failures), not "quarantine" (the quarantine premise is false).

## Startup verification (all green)

- `pwd` == `git rev-parse --show-toplevel` == the worktree root.
- `git merge-base HEAD origin/main` == `origin/main` == `fd69d1fc`.
- `bun install` — 218 packages.
- `bun run pretest` run plainly from the worktree CWD; `samples/compilation-tests/dist/` artifacts
  verified present by `ls`, not by trusting the exit code.

## Baseline measurements (before any edit)

### self-host tier — PA's numbers REPRODUCE EXACTLY

```
139 pass . 122 skip . 3 fail . 696 expect() calls . Ran 264 tests across 4 files. [574.00ms]
```

Matches PA's `139 / 122 / 3 . 264 tests . 569ms` on every figure.

NOTE. This worktree had NO `compiler/self-host/dist/` at the moment of the FIRST run — the directory
did not exist (`dist/` is ignored at `.gitignore:2`, so a fresh worktree checkout never materialises
it). So that reading is the clean-checkout, no-dist condition, which independently corroborates PA's
move-the-dist-out experiment from the other direction: the tier is **dist-independent**.

⛑ **CORRECTED (fix round) — "has NO dist AT ALL" WAS TRUE OF RUN 1 ONLY, AND I STATED IT AS A
STANDING PROPERTY.** The run CREATES the directory (see Blocker 2 below): `bs.test.js` writes
`bs.css` + `bs.js` even though its compile FAILS. So "measured two ways" is weaker than I framed it —
way (b) is a **single first-run observation**, not a durable state, and it stops being reproducible
the moment you have run the tier once. The dist-independence CONCLUSION still holds (way (a) is PA's
dist-moved-out run, and the failure name set is identical across all of them), but the framing
over-claimed. Same over-claim shape this whole session is auditing, committed by me while auditing
it.

The 3 failures (token-count parity, `assertSameTokens` at `tab.test.js:74`):
- `tokenizeLogic parity > tilde`
- `tokenizeLogic parity > punct chars`
- `tokenizeCSS parity > pseudo selector`

Zero `ReferenceError` in the run — the `g-selfhost-tokenizelogic-tdz-pos-before-initialization`
symptom does not reproduce at `fd69d1fc`, as PA reported.

### browser tier — before-state, for the byte-identical-behaviour check

`bun scripts/browser-baseline.ts --check` -> **exit 0**:

```
  PASS — browser failure name set matches the baseline (48 asserted, 2 of 2 env-excluded observed).
```

## PA-located loci — verification status

- `.github/workflows/ci.yml:149` + `:233` — the ONLY two `browser-baseline.ts` INVOCATIONS. HELD.
- `core.hooksPath` unset; hooks live in `.git/hooks`; **no hook mentions `browser-baseline`**. HELD.
- Two further references found that PA did not name, both PROSE not invocation:
  `bunfig.toml:16` (a comment naming the script path) and `hand-off.md:447`.
- `scripts/browser-baseline.ts:38` SCOPE comment ("lsp / commands / self-host carry their own
  baselines") — FALSE as PA said: `compiler/tests/browser/FAILURE-BASELINE.json` is the only
  baseline file in the repo and there is no other baseline script.

## Log

- [x] Startup verification + baseline measurements. — `846c2f24`
- [x] `git mv scripts/browser-baseline.ts scripts/tier-baseline.ts`, parameterised by `--tier=` over a
      registry; self-host baseline recorded; browser baseline `_comment` pointer corrected. — `9c76175f`
- [x] `ci.yml` blocking `gate` step + both existing invocations re-pointed + the false KEY FINDING
      block corrected + the THREE-jobs header corrected; `bunfig.toml` pointer. — `245a6290`
- [x] Bite proof, both directions, both tiers (below).
- [x] Full verification sweep (below).

## BITE PROOF — both directions, both tiers

pa-base §8: a gate that has never failed is indistinguishable from one that cannot fail. Every probe
was restored by FILE COPY (never `git stash` — `refs/stash` is shared across worktrees) and the
restore was confirmed by an EMPTY `git status --short`, i.e. byte-identical, not merely "looks right".

### self-host — NEW-FAILURE direction

Unmodified tree: `--tier=self-host --check` -> **exit 0**, `PASS ... (3 asserted, 0 of 0 env-excluded observed)`.

Synthetic 4th failure injected by editing ONE assertion in `tab.test.js:221`
(`assertSameTokens(js, sh, ...)` -> `assertSameTokens(js, [], ...)`):

```
  NEW FAILURE(S) — 1 test(s) fail that the baseline does not list:

    + tokenizeLogic BLOCK_REF parity > non-brace child types are ignored
        | took 0.07ms
        | error: expect(received).toBe(expected)
        | Expected: 3
        | Received: 0
        | at assertSameTokens (.../compiler/tests/self-host/tab.test.js:72:20)
        | at <anonymous> (.../compiler/tests/self-host/tab.test.js:221:5)

  This is a REGRESSION. The self-host tier's count alone would not have shown it.
=== EXIT=1 ===
```

Restored by file copy -> `git status --short` EMPTY -> re-run **exit 0**.

### self-host — STALE-BASELINE direction

Phantom entry appended to the baseline:

```
  STALE BASELINE — 1 baseline entr(y/ies) now PASS:

    - SYNTHETIC BITE PROBE > a name that does not fail

  Prune them: `bun scripts/tier-baseline.ts --tier=self-host --write`.
=== EXIT=1 ===
```

Restored by file copy -> EMPTY status -> re-run **exit 0**.

### browser — NEW-FAILURE direction

Proven TWICE, from both sides of the comparison, because the filter is applied to both:

1. Broke a real passing assertion (`esm-chunk-module-linkage.browser.test.js:75`) ->
   `NEW FAILURE(S) — 1 ... + esm chunk graph links + executes as real modules > runtime +
   cross-chunk + entry chunk all link; reactivity roundtrips; lift-target routed` — **exit 1**.
2. Pruned one entry from the browser baseline -> the same name reported as NEW — **exit 1**.

### browser — STALE-BASELINE direction

Phantom entry appended -> `STALE BASELINE — 1 baseline entr(y/ies) now PASS: - SYNTHETIC BITE PROBE >
a browser name that does not fail` — **exit 1**. Restored -> **exit 0**.

### browser — BEHAVIOUR IDENTITY vs the pre-rename script

`--tier=browser --check` was compared against the ORIGINAL `browser-baseline.ts`, restored by file
copy as a throwaway probe (`scripts/_probe-orig-baseline.ts`, deleted immediately after) and run in
the SAME environment. Output **BYTE-IDENTICAL**, both exit 0, both `48 asserted`.

NOTE — ONE FIGURE DRIFTED BETWEEN MY FIRST AND SECOND BROWSER RUNS AND IT IS NOT THIS CHANGE. The
first capture read `2 of 2 env-excluded observed`; every later one reads `0 of 2`. Cause: the browser
tier MATERIALISES `benchmarks/todomvc/dist/` as a side effect of its own run (confirmed by mtime:
directory created 09:07, files written 09:12, both during browser runs). So the first run in a fresh
checkout observes both env-excluded tests failing and every subsequent run observes neither. PROVEN
not to be my change by running the ORIGINAL script afterwards and getting `0 of 2` from it too.
Consequence worth recording: that printed skip-rate is run-ORDER dependent, while the ASSERTED set
(48) is not — which is exactly what filtering both sides of the comparison buys.

## VERIFICATION SWEEP

| check | result |
|---|---|
| `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` | **exit 0** — 23745 pass / 70 skip / 10 todo / **0 fail**, 124148 expect() calls, 23825 tests across 1313 files, 164.17s |
| pre-commit hook (same subset + the root `*.test.js` glob), run at BOTH commits | **0 fail**, 30223 tests across 1327 files, 188.63s |
| `bun scripts/conflict-marker-gate.ts` | **exit 0** — 8186 tracked files scanned, 0 markers |
| `bun run scripts/regen-spec-index.ts --check` | **exit 0** — 37,947 lines, 65 sections + appendices, 71 of 71 scanned, 0 stale, 0 missing |
| `bun scripts/tier-baseline.ts --tier=browser --check` | **exit 0**, 48 asserted |
| `bun scripts/tier-baseline.ts --tier=self-host --check` | **exit 0**, 3 asserted |
| `bun scripts/tier-baseline.ts --tier=lsp --check` (unknown tier) | **exit 1** — `UNKNOWN TIER`, prints the registry, refuses to fall back |
| `.github/workflows/ci.yml` parses as YAML | yes — `gate` 15 -> **16** steps (13 -> 14 named, 2 `uses:` unchanged) |
| `bunfig.toml` parses as TOML | yes — `{'test': {'root': 'compiler/tests/'}}`, byte-identical to before (comment-only edit) |

**TESTS_BEFORE for the subset was not independently re-run, and here is why that is sound rather than
lazy:** `git diff --name-status --no-renames origin/main..HEAD` returns 7 paths, and NONE is under
`compiler/src/`, `stdlib/`, or `compiler/tests/{unit,integration,conformance}/`. Grep-verified that no
test imports `tier-baseline.ts` and no test reads either `FAILURE-BASELINE.json` — the single hit in
the subset (`unit/transition-css-soft-nav-reachable.test.js:20`) is a prose comment. The only touched
file `bun test` reads at all is `bunfig.toml`, whose PARSED value is unchanged. Additionally the
pre-commit hook ran the same subset green at commit `9c76175f`, i.e. with `ci.yml` and `bunfig.toml`
still at their `origin/main` bytes.

## FINDINGS BEYOND THE BRIEF (surfaced, not acted on)

1. **`bun test compiler/tests/` IS run by the `post-commit` hook, which does include
   `compiler/tests/self-host`.** This refines — it does not contradict — the brief's "run by no hook":
   `post-commit` runs AFTER the commit is made and cannot block anything, so it is not a gated path.
   But it is worse than merely non-blocking: the hook greps `\d+ fail` and prints
   `⚠ TEST REGRESSION DETECTED` whenever that is non-zero, and the browser tier alone contributes 48
   baselined failures on every tree. So the warning fires on EVERY compiler-touching commit — the
   permanent-red cry-wolf shape this whole name-set mechanism exists to replace. Deferred: pointing
   `post-commit` at `tier-baseline.ts --check` for both tiers would make it carry information.

2. **`lsp` and `commands` still have no baseline and are still asserted by nothing.** They run only in
   `tracking`, which is `continue-on-error: true`. Adding either is now a registry entry plus a
   `--write`. Explicitly NOT done here, and the script header says so in place of the old sentence
   that implied it was already done.

3. **`.claude/maps/primary.map.md` invariant 8 and the `gate` step count are stale at its `e74f5423`
   stamp.** The map states `gate` is "14 total steps (12 `- name:` + 2 `- uses:`)"; measured at
   `origin/main` (`fd69d1fc`) it was already **15 (13 + 2)** before I touched it, and is **16 (14 + 2)**
   after. Invariant 8's "`browser-baseline.ts` stays in `gate`" needs re-spelling to
   `tier-baseline.ts --tier=browser`. Map maintenance is the PA's, not mine.

4. **`hand-off.md:447` still names `scripts/browser-baseline.ts`.** Left alone deliberately — it is a
   PA-owned session document.

⛑ **FIX ROUND — FINDING 1 ABOVE WAS NOT NEW, AND I PRESENTED IT AS IF IT WERE.** The post-commit
cry-wolf has been filed since S326 as `g-post-commit-hook-is-permanently-red-and-cries-wolf-in-three-ways`.
What it GAINS from this arc is the fact that makes it expensive — that hook was the ONLY thing running
`compiler/tests/self-host`, i.e. the directory #924's 82 GB lockup lived in, and it reported that
directory under a permanently-red warning. Recorded on the existing entry, not re-filed.

---

# FIX ROUND — S239 adversarial pass, 8 findings

PA reproduced the load-bearing ones before sending. I reproduced each myself before acting; the
RELAYED ones are marked with what I found.

## BLOCKER 1 — the gate answered a question nobody asked, in the affirmative

**REPRODUCED VERBATIM** on the committed tree at `4334bd57`:

```
$ bun scripts/tier-baseline.ts --tier self-host --check
  PASS — browser failure name set matches the baseline (48 asserted, 0 of 2 env-excluded observed).
EXIT=0
```

`resolveTier` matched only `a.startsWith("--tier=")`, so the space form fell through to
`DEFAULT_TIER`. Exit 0, asserting nothing about self-host, reporting success — and contradicting the
function's own doc comment claiming it "FAILS LOUD ... rather than falling back to the default".

Fixed on BOTH sides: the space form RESOLVES, and a `--tier` with no value (last token, or followed
by a flag) is a HARD ERROR. The second half matters independently — `--tier --check` would otherwise
swallow `--check` as a tier name, which ALSO silently downgrades CHECK to PRINT. One typo, two
hollow-gate modes.

### Bite proof — seven probes, all executed

| probe | result |
|---|---|
| `--tier self-host --check` | **exit 0** — `PASS — self-host ... (3 asserted, 0 of 0 env-excluded observed)` |
| `--tier browser --check` | **exit 0** — `PASS — browser ... (48 asserted, 0 of 2 env-excluded observed)` |
| `--tier=browser --check` (the CI spelling) | **exit 0**, identical to the above |
| `--tier` (last token) | **exit 1** — `MISSING TIER NAME — \`--tier\` was given with no value.` |
| `--tier --check` | **exit 1** — same, and `--check` is NOT swallowed |
| `--tier lsp --check` | **exit 1** — `UNKNOWN TIER — \`lsp\` is not in the registry.` |
| `--tier=lsp --check` | **exit 1** — unchanged |

## BLOCKER 2 — the tier is not side-effect-free, and my comment said it was

**REPRODUCED.** `rm -rf compiler/self-host/dist` → `bun test compiler/tests/self-host/bs.test.js`:

```
[bs.test.js] self-host parity SKIPPED — bs.scrml compile failed: (see file header ...)
 0 pass · 52 skip · 0 fail
=== dist after ===
-rw-rw-r-- ... 331 bs.css
-rw-rw-r-- ... 35925 bs.js
```

It reports compile-failed, skips all 52, **and still writes the artifact.**
`compileScrml({write:true})` emits even when the compile reports errors. My registry comment said
*"Nothing here reads environment state, so there is nothing to exempt"* — **reading was the half I
checked; writing is the half that bites.**

Cross-tier hazard confirmed at the named line: `self-host-smoke.test.js:655` builds
`bsDistPath` and gates on bare `existsSync` at `:665` `:669` `:673` `:679` `:699` `:711`. Those guards
mean "skip when absent". Running this tier first satisfies them → those tests flip from SKIP to
running against a failed-compile artifact, silently. Safe in CI **today only because `gate` and
`tracking` are different jobs.**

⚑ **AND MY FIRST PROBE OF IT LIED, WHICH IS THE PART WORTH KEEPING.** I measured "no delta" by
deleting the dist in THIS WORKTREE and re-running the smoke test: 25 pass / 54 expect() calls both
ways. Wrong-referent. `self-host-smoke.test.js:34` resolves its dist path via `findMainProjectRoot()`,
which parses `git worktree list` and takes the **MAIN** working tree — so a worktree-local delete
changes nothing it reads. Verified: main's `compiler/self-host/dist/` holds 14 files. The hazard is
real in a single-checkout layout (i.e. CI); my probe answered a different question. That trap is now
written into the registry comment for the next person.

Not fixing `bs.test.js`'s emit-on-failure — separate arc, out of scope, stated as such.

## FINDING 3 — the gate could not report the class it was just hardened against

**CONFIRMED by reading:** zero `timeout-minutes` anywhere in `ci.yml` → every job inherited GitHub's
**360-minute** default. #924 is a SYNCHRONOUS non-advancing loop: bun's per-test timeout cannot
preempt it, `!ranOk` needs bun to EXIT, and the OOM route needs the loop to ALLOCATE. A non-allocating
spin trips none of them, so a recurrence **hangs the blocking gate for six hours instead of reddening
it** — failing the standard `tier-baseline.ts` itself states.

Added `timeout-minutes: 20` on the `gate` job and `timeout-minutes: 3` on the new step. **Both numbers
measured, not guessed** — I timed the whole gate sequence locally:

```
unit+conformance 85.86s · root glob 11.26s · gauntlet 0.38s · browser name-set 23.99s
self-host name-set 0.72s · snippet-gate 32.02s · compile-floor 4.95s · facts 0.16s
conflict-marker 0.06s · SPEC-INDEX 0.02s · delta-lint 0.03s        TOTAL 160 s
```

20 is ~1.5-2x headroom over a pessimistic 10-13 min CI run and ~7x the measured core; 3 is ~250x the
step's measured 0.72s.

## RELAYED ITEMS — each verified before acting

| item | verdict |
|---|---|
| `ci.yml` + `tier-baseline.ts` "run by NO hook" is false | **HELD.** `.git/hooks/post-commit` runs `bun test compiler/tests/`. Shipped text now says NOTHING IN ANY GATED PATH EXECUTED IT, with the reason the hook does not count. |
| `known-gaps.md:3056` gap untouched, locus dangling | **HELD.** Narrowed to lsp/commands, locus re-pointed at the TIERS registry, **not closed**. ID deliberately unchanged — a stable id is what makes the history findable. |
| `pre-push:72-79` + six "mirrors X exactly" pointers | **HELD, all seven, each verified at its named line.** Swept. `pre-push` also carried a SECOND now-false claim ("lsp / commands / self-host still have no name-set assertion") — corrected. |
| `_comment`s + hints say `--write` with no `--stamp`; `writeBaseline` defaults `""` | **HELD.** Fixed at the DEFAULT (today's date) rather than by editing four instruction strings. Probe: `--write` with no stamp now yields `recordedAt: "2026-09-12"` and a **byte-identical file** — proving the stamp is right AND the asserted content idempotent. Also corrected the header's unqualified "Idempotent." claim. |
| `ci.yml:210` name-set-only, 122/264 skipped | **HELD.** Recorded at the call site AND on `g-no-baseline-asserts-that-tests-actually-asserted`. **No count floor built** — that gap names three baselines a floor must span. |

⚑ **HOW I MISSED THE SEVEN POINTERS IN ROUND 1.** My sweep was `grep ... | head -30`, and `scripts/`
sorts after `docs/`. Every one of the seven fell past the cut, and I reported "the only invocations
are the two in ci.yml" with confidence. **A truncated probe reads exactly like a clean one.**

## RE-VERIFICATION AT THE FIX-ROUND TIP

| check | result |
|---|---|
| self-host tier raw counts | **139 pass / 122 skip / 3 fail**, 696 expect() calls, 264 tests across 4 files, 574ms — unchanged |
| self-host `--check`, unmodified | **exit 0**, 3 asserted |
| self-host NEW bite → restore | **exit 1** naming `tokenizeLogic BLOCK_REF parity > non-brace child types are ignored` → restore byte-identical → **exit 0** |
| self-host STALE bite → restore | **exit 1** `STALE BASELINE` → restore → **exit 0** |
| browser NEW bite → restore | **exit 1** naming `esm chunk graph links + executes as real modules > ...` → restore → **exit 0** |
| browser STALE bite → restore | **exit 1** `STALE BASELINE` → restore → **exit 0** |
| browser `--check`, restored tree | **exit 0**, 48 asserted |
| `bun test unit integration conformance` | **exit 0** — 23745 pass / 70 skip / 10 todo / **0 fail**, 23825 tests / 1313 files, 178.15s |
| pre-commit hook (subset + root glob), all three code commits | **0 fail**, 30223 tests / 1327 files |
| `conflict-marker-gate.ts` | **exit 0** — 8186 files, 0 markers |
| `regen-spec-index.ts --check` | **exit 0** — 71 of 71 sections, 0 stale, 0 missing |
| `ci.yml` YAML parse | `gate` 16 steps, job `timeout-minutes: 20`, self-host step `timeout-minutes: 3` |

Every probe restored by FILE COPY; `git status --short` EMPTY after each.

## DEFERRED (surfaced, not fixed)

- `bs.test.js` emits on a FAILED compile. Separate arc, explicitly out of scope.
- `tracking` and `windows` still have no `timeout-minutes`. Continue-on-error, so a hang blocks no
  merge — but it holds the run.
- `lsp` / `commands` still unasserted. Now a registry entry + `--write` + a step.
- Pointing `post-commit` at `tier-baseline.ts --check` for both tiers.
