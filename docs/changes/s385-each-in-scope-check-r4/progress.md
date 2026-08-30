# S385 round 4 — `<each>` opener scope check: the scoped excision + an adversarial shape set

Continues `fix/s385-each-in-scope-check` from round 3's tip `33076d91`.
Round 3's progress log is at `docs/changes/s385-each-in-scope-check/progress.md`
and is not repeated here. The brief this round worked from is archived verbatim
at `docs/changes/s385-each-in-scope-check-r4/BRIEF.md`.

---

## What round 4 changed, in one paragraph

Round 3's scope check over the `<each>` opener is CORRECT in design and stays:
the shared `parseExprToNode` + `checkLogicExprIdents` walker, the `in=`/`of=`
before-push vs `key=` after-push ordering split, and the `iterShape` gate. Round
4 deletes exactly one thing — the raw-text `${…}` `readSites` scan and the
`targets = readSites.length > 0 ? readSites : [trimmed]` selection it fed — and
checks the trimmed opener value WHOLE, as one parsed expression. That closes a
HIGH false positive and a MEDIUM false negative together, and costs no coverage.

---

## Phase 0 — startup verification

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a20cef6d06476d216`,
  `git rev-parse --show-toplevel` agrees, tree clean.
- Worktree was cut from `origin/main` (`d02adb68`), NOT from the branch to
  continue. `git fetch origin fix/s385-each-in-scope-check` →
  `FETCH_HEAD = 33076d91`, `git reset --hard FETCH_HEAD` → HEAD is round 3's tip.
- `bun install` — 218 packages (worktrees do not inherit `node_modules`).
- `bun run pretest` run PLAINLY from the worktree CWD (never `bun --cwd`, which
  silently exits 0 having built nothing). ARTIFACTS VERIFIED, not the exit code:
  `samples/compilation-tests/dist/` holds 32 files + 2 dirs, timestamps current.
- No `git stash` at any point. Every base-vs-build flip in this round was done by
  FILE COPY through `scratchpad/tsver/{main,r3,r4}.ts`.

## Phase 1 — maps

`.claude/maps/primary.map.md` read (717 lines, stamped `0dd659a1`; `origin/main`
is `d02adb68`, 35 commits ahead — treated as hypothesis, not fact).

**Load-bearing: NO.** Nearest rows are invariant 70 (`<each>` has two parse
origins, and only the structural one produces an `each-block`) and the
`E-STATE-UNDECLARED`-inside-`<each>`-inside-`<match>` routing row. Both are true
and both are about a DIFFERENT surface than this arc: invariant 70 is about
codegen-side walkers that switch on node kind, and this check runs in the
type-system's `annotateNodes` walk over `each-block` nodes, which is the origin
invariant 70 says DOES get promoted. The map set carries no row for
`type-system.ts`'s opener handling at all. Read, verified against source, not
relied on.

## Phase 2 — reproduce all three findings independently

Every claim in the brief was re-derived by execution before any edit.

**The PA-located line HELD, verbatim.** `type-system.ts:12806` at round 3's tip:

```
const targets = readSites.length > 0 ? readSites : [trimmed];
```

with `readSites` declared at `:12793` and pushed at `:12803`.

**F1 — HIGH false positive. REPRODUCED.**
`<each in=@rows.map(r => \`id-${r}\`) as x>`
- `origin/main` (type-system.ts swapped in by file copy): `Compiled 1 file`, exit 0.
- round 3 tip: `error [E-SCOPE-001]: Undeclared identifier \`r\`` → `FAILED — 1 error`.

**F2 — MEDIUM false negative. REPRODUCED.**
`<each in=@undeclaredHidden.map(x => \`${1}\`) as r>`
- round 3 tip: `Compiled 1 file`, **0** occurrences of `E-STATE-UNDECLARED`.

**F3 — the reviewer was wrong; round 3 was right. RE-VERIFIED, and it turned out
to have a second half the brief did not have.** Three interpolated opener
spellings, compiled through the CLI on `origin/main`:

| source | verdict |
| --- | --- |
| `<each in=${@rows} as r>` | `E-CODEGEN-INVALID-LOGIC` — FAILED, 1 error |
| `<each in=@rows as r key=${r}>` | `E-CODEGEN-INVALID-LOGIC` — FAILED, 1 error |
| `<each in=@rows as r key=${@a}-${r}>` | `E-CODEGEN-INVALID-LOGIC` — FAILED, 1 error |

So `${…}` is not a working opener form in ANY slot or spelling, and the
`readSites` block bought no coverage. That is the load-bearing half, confirmed.

## Phase 3 — the excision

`compiler/src/type-system.ts` — the `${…}` depth scan, the `readSites` array and
the `targets` ternary are gone. `checkEachOpenerExpr` now does what its own
docstring always claimed: parse the trimmed value ONCE via `parseExprToNode` and
hand the node to `checkLogicExprIdents`. Net `-86/+?` inside the function; every
other line of round 3's diff is untouched.

The replaced comment block records WHY, at length and with the measurements,
because the next person to look at this will have the same instinct round 3 had
(the `<match on=>` precedent unwraps `${…}`, so `<each>` should too) and needs
the counter-evidence in front of them.

**Both fixtures flip, verified by execution:**

| fixture | `origin/main` | round 3 | round 4 |
| --- | --- | --- | --- |
| F1 `in=@rows.map(r => \`id-${r}\`)` | clean | `E-SCOPE-001` on `r` | **clean** |
| F2 `in=@undeclaredHidden.map(x => \`${1}\`)` | clean | clean | **`E-STATE-UNDECLARED`** |
| BITE `in=@undeclaredName` | clean | `E-STATE-UNDECLARED` | **`E-STATE-UNDECLARED`** |

The BITE row is the point of the arc and it still fires.

## Phase 4 — the tests

### §9 re-worked

It pinned "a multi-interpolation opener checks every `${…}`" — a property
describing a construct that cannot compile either way. It now pins the property
that matters: an interpolated opener is REJECTED, not silently accepted, over
four spellings, CODE-AGNOSTICALLY (asserting the code would make this file a
tripwire on an unrelated arc). Plus a positive control proving the distinction
that makes the excision safe: a real backtick template in `key=` STILL names an
undeclared read inside it — only the unquoted `${…}`, which is not a JS
expression under any spelling, degrades.

### §10 NEW — the adversarial shape set

30 opener shapes, each a fixture, each asserted to compile with ZERO `E-`
diagnostics:

- lambda expression body · block body · multi-statement block body
- **a template literal nested inside a lambda** (F1) and a dotted variant
- a template literal at the top of a lambda reading a real cell
- destructured lambda params: array · object · renamed object · rest · two-param `reduce`
- a lambda param SHADOWING a declared cell name
- the `as`-alias in `key=`: bare · inside a backtick template · through a call chain
- `@.` bare in `key=`, `@.field` in a nested `in=`
- long method chains, with and without a template-literal limb
- three nested-`<each>` shapes whose inner opener reads the OUTER alias (`in=`,
  `key=`, and inside a lambda)
- four `of=` count forms: plain cell · arithmetic · `.length` · `.filter(…).length`
- ternary · array-literal · a global in a chain · optional-chain iterable
- the §59.8 two-name destructure opener

### The bite proof, in both directions

A gate that has never failed is indistinguishable from one that cannot fail.
Round 3's `type-system.ts` was re-installed BY FILE COPY and the suite re-run:

```
(fail) §9  > `keyMulti` — an interpolated opener fails the compile
(fail) §10 > `template-literal-inside-lambda`
(fail) §10 > `template-literal-inside-lambda-dotted`
(fail) §10 > `template-literal-top-level-reading-a-cell`
(fail) §10 > `long-method-chain-with-a-template-literal-limb`
 55 pass · 5 fail
```

Against round 4's code: **61 pass · 3 todo · 0 fail.**

## Phase 5 — an unplanned finding that changes how the F3 evidence reads

Chasing why §9's `keyMulti` case went RED against round 3 (it should have been
clean there) surfaced a harness divergence that is worth more than the case that
exposed it.

`E-CODEGEN-INVALID-LOGIC` on these shapes is produced by the emitted-JS parse
gate in `api.js`, and that gate sits inside `if (write && outputDir)`.
`validateEmit` itself defaults to `true` (`api.js:871`) — the gate is not
flag-off, it is UNREACHABLE when `write` is false. This test file's
`compileSource` passes `write: false`.

Measured on `origin/main`, the same four sources, two harnesses:

| source | CLI (writes) | `compileScrml({write:false})` |
| --- | --- | --- |
| `in=${@rows}` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `key=${r}` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `key=${@a}-${r}` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `key=${@a}-${@typo}` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |

Three consequences:

1. **The S385 reviewer and the PA were both right, about different harnesses.**
   That is the wrong-referent class, and this gap is a standing generator of it.
2. **The unit tier is structurally blind to `E-CODEGEN-INVALID-LOGIC`**, so a
   codegen regression emitting unparseable JS passes it silently.
3. **The accept/reject direction of this arc is strictly correct.** Rejecting at
   the TYPE-SYSTEM stage closes a silent-accept in every `write:false` consumer —
   the LSP among them — that the CLI caught one stage later. The r4 message for
   an interpolated opener (`E-SCOPE-001` naming `$`) is still wrong, and is filed;
   the direction is not.

Filed in `GAP-DRAFTS.md` as `GAP-S385-VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE`
(MEDIUM) and `GAP-S385-EACH-OPENER-INTERPOLATION` (LOW), each with a `test.todo`
anchor in §9.

## Phase 6 — gates

See the report. Headline: a clean corpus differential is NECESSARY AND NOT
SUFFICIENT, and this round is the proof — round 3's differential was clean, at
0 newly-failing of 1005, positive-controlled, and it still shipped a HIGH false
positive, because no corpus file happens to put a template literal inside an
`<each in=>` lambda. The safety claim for a rejecting change is two-part:
differential clean AND an enumerated adversarial shape set.
