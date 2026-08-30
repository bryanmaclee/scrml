# S385 channel-mount guard — round 7 progress (append-only)

## 2026-08-30 — startup

- Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a955c01a06b620256`
- `git rev-parse --show-toplevel` matches; tree clean at dispatch.
- `git fetch origin fix/s385-channel-mount-guard` + `git reset --hard FETCH_HEAD` → HEAD `35654c48`
  ("Merge remote-tracking branch 'origin/main' into worktree-agent-a8702b6fc289f0891"), round 6's tip. Verified.
- `bun install` → 218 packages.
- `bun run pretest` (plain, from worktree CWD) → "Compiled 13 test samples -> samples/compilation-tests/dist/";
  34 entries present in `samples/compilation-tests/dist/` (artifacts verified, not just exit 0).
- BRIEF.md written verbatim.

Task: hole 4 — `<each>`/`<match>` as a DIRECT entry of `engine-decl.bodyChildren`. The relayed fix
hypothesis (recursing into non-`markup`-kind direct bodyChildren entries is unambiguous) is to be
treated as unverified and re-derived from source.

## 2026-08-30 — hole 4 traced, closed, and gated

### The relayed hypothesis HELD, and it is safe by construction rather than by measurement

Re-derived from source, not accepted as relayed. The reviewer's line numbers were
correct: `component-expander.ts:5019` is the `if (kind === "engine-decl" &&
Array.isArray(rec.bodyChildren))` loop and `:5045` is the
`if (kind === "engine-decl" && key === "bodyChildren") continue;` in the generic
key loop below it.

Traced on the BUILT AST (`splitBlocks` -> `buildAST`), not inferred from reading:

```
children[3] kind=engine-decl keys=[...,bodyChildren,...]
  bodyChildren[1] kind=each-block keys=[...,bodyChildren,templateChildren,...]   <- NO `children`
    bodyChildren[1] kind=markup tag=probeChan
```

and for the `<match>` spelling, `bodyChildren[1] kind=match-block
keys=[...,bodyChildren,armBodyChildren,...]` — again no `children`. Round 6 did
`seen.add(wr); walk(wr.children ?? null, ...)` for EVERY direct entry, so the
walk got `undefined` and the `seen.add` then made the subtree permanently
unreachable.

The fix is one qualifier. The state-child ambiguity that (rightly) stopped round 6
classifying direct entries is markup-SPECIFIC: a state-child is BY DEFINITION a
direct `bodyChildren` entry of `kind: "markup"`. A direct entry of any other kind
cannot be one, so it carries no variant-name-oracle problem and is walked as an
ordinary node.

**By construction, not by corpus:** `fire()` has exactly ONE call site, gated
`kind === "markup" && aliases.has(rec.tag) && container`. The only firings the
widening can newly enable are on markup nested INSIDE a non-markup direct entry —
author markup, which cannot be a state-child, because state-children are direct
entries. Round 3's false-accusation class is therefore not reopened at any level.

Nearest-container attribution also survives: re-entering `walk` on the block hits
the container branch, which rebinds `here`, so the message names `<each>` /
`<match>` rather than the engine.

### Gate 4 — the gate bites in BOTH directions (measured, not asserted)

Same fixture, three compilers, by FILE COPY (never `git stash`):

| compiler | guard | `_scrml_ws` | `createElement("probeChan")` | verdict |
|---|---|---|---|---|
| `origin/main` `d02adb68` | 0 | 0 | present | exit 0, silent dead channel |
| round 6 `35654c48` | 0 | 0 | present | exit 0, silent dead channel |
| this fix | **1** | — | — | **fails closed** |

And against round 6's own expander, the two new tests FAIL and nothing else does:

```
(fail) ... inside an `<each>` that is a DIRECT entry of an `<engine>` body (hole 4)
(fail) ... inside a `<match>` that is a DIRECT entry of an `<engine>` body (hole 4)
 19 pass  2 fail
```

### Gate 5 — the round-6 false-positive guards

All three round-3-class guards stay clean (guard=0, hardErrs=0, `_scrml_ws`=4,
i.e. still FULLY wired, not merely un-accused):

- alias colliding with an enum variant, mounted at `<program>` level;
- alias colliding with an ENGINE state-child variant;
- alias merely NAMED in arm prose (pinned by the existing suite).

Plus a NEW guard written for this widening's own blast radius: an alias named
`Done` beside a `<Done rule=...>` state-child in an engine **that also holds a
direct `<each>`** — the exact pairing the widening could plausibly break. Clean.

### Gate 1 — pre-commit suite

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance compiler/tests/*.test.js`
(the hook's exact tier set):

**29371 pass / 0 fail / 86 skip / 4 todo**, 131837 expect() calls, 1291 files.

Round 6 was 29368 pass. The delta is exactly +3 = the three tests added here.

### Gate 2 — corpus differential, `origin/main` vs this tip

1005 files (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` + `examples/**`
+ `samples/**` + `stdlib/**`), recording verdict + sorted diagnostic code set per
file. Base flip done by FILE COPY of all three source files that differ from
`origin/main` (`component-expander.ts`, `commands/compile.js`,
`commands/diagnostic-format.js`) — no `git stash` at any point.

```
$ diff sw-PRE.txt sw-POST.txt
$ echo $?
0
```

**Byte-empty.** 781 OK / 224 not-OK on BOTH sides. Zero newly-rejecting files.

### Gate 3 — browser baseline

`bun scripts/browser-baseline.ts --check` →
**PASS — browser failure name set matches the baseline (48 asserted, 0 of 2
env-excluded observed).** Identical to round 6.

### Docstring honesty

Hole 3's heading now reads "a DIRECT `kind: "markup"` child" — the qualifier was
the bug. Hole 4 is recorded in a new CLOSED section rather than deleted, and the
"THREE places" preamble now says the count is three because one of four is fixed,
not because four were never found.

### ⚑ OUT-OF-SCOPE FINDING, reproduced on `origin/main` — not mine to fix

A `<match>` nested inside an `<engine>` body has its ARM variant names
misdiagnosed as ENGINE state-child tags. No channel involved:

```
<engine for=LoadPhase initial=.Idle>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><p>ready</p></>
    </>
    <Idle rule=.Done></>
    <Done rule=.Idle></>
</>
```

emits, on `origin/main` `d02adb68` and unchanged by this fix:

```
[E-ENGINE-STATE-CHILD-INVALID-VARIANT] state-child tag `<Loading>` in
`<engine for=LoadPhase>` does not match any variant of `LoadPhase`.
Valid variants are: .Idle, .Done. Either rename the tag to a valid variant or
add `Loading` to `LoadPhase`.
```

This is the round-3 false-accusation class in a DIFFERENT diagnostic: a valid
file is refused, and the prescribed fix is unfollowable — `Loading` is a variant
of `Phase`, which is exactly where it belongs. Both diagnostics also carry the
`<match>` opener's line, not the arm's. Some validator is reading a nested
match-block's `armBodyChildren` wrappers as engine state-children — the same
wrapper-is-indistinguishable-from-author-markup shape that blocked round 3 here.
Filed for the PA; NOT touched.

### Extra gate — types-gate (not brief-mandated; run adversarially)

`bun scripts/types-gate.ts`, round-6 expander vs this fix, both:

```
types-gate: 230 TypeScript diagnostics (144 distinct) across roots [...]
```

Identical count, exit 0. **Zero new TypeScript diagnostics.** (The 230 are a
large pre-existing population; the gate is advisory. Checked because the change
compares `unknown` against a string literal and I wanted that measured rather
than assumed.)

### Working-tree hygiene

Every base-vs-build flip in this round was done by FILE COPY (`git show <ref>:<path>`
into the scratchpad, `cp` in, `git checkout HEAD -- <path>` out). **`git stash` was
never invoked**, and `git status` was re-verified clean after each restore. No
`pkill -f` / `killall` was used at any point.
