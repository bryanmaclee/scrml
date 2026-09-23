# S425 — the outlet-absent diagnostic must name the discard

Append-only timestamped log. Branch + this file are the only crash-recovery anchor.

## 2026-09-21 — startup

- WORKTREE_ROOT: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a70a3264ea8fd5149`
- `git rev-parse --show-toplevel` == WORKTREE_ROOT: OK
- `git status --short` clean: OK
- `git merge-base HEAD origin/main` == `git rev-parse origin/main` == `0b050fb4b6e6d912f29feb3b7df3299bbd56436e`: OK
  (brief cites a PA measurement on `428e390d`; my base is `0b050fb4` — noted, not a blocker)
- `bun install`: 218 packages
- `bun run pretest` run plainly from worktree CWD: produced `samples/compilation-tests/dist/` (34 files)
- Branch: `worktree-agent-a70a3264ea8fd5149`

Ruling being implemented: option (c) — keep the behaviour, fix the diagnostic.
direction-of-change: **INERT**. No predicate, fire condition, or severity may move.

## 2026-09-21 — loci verified, reproducer confirmed, ONE premise refined

### Loci (brief's were PA-located-verify; all three HELD)

| brief locus | found at | verdict |
|---|---|---|
| `compiler/src/ast-builder.js` (grep the code string) | emit site `ast-builder.js` ~20135-20155, inside the `filePathIsRealFile && pagesDirPresent` block | **HELD** |
| `compiler/SPEC.md` §34 catalog row | SPEC line 19975, under `### 34.0 Row well-formedness` | **HELD** |
| `compiler/SPEC.md` §20.8.1 | SPEC line 16394, under `#### 20.8.1 The persistent shell and <outlet>` | **HELD** |

Two mentions the brief did NOT name (SURFACED, not edited — brief scoped "exactly three edits"):
- SPEC `:16521` — §20.8.7 one-line code summary. Does NOT repeat the false claim; says only
  "soft-nav / link-boost fall back to hard. Info." Silent on the discard.
- SPEC `:23577` — **§40.8.2**, where the fallback's own normative SHALL lives: *"When the shell
  declares NO marked slot, the compiler SHALL fall back to the FIRST `<main>` element as the slot …
  `W-OUTLET-ABSENT-SOFT-NAV-DISABLED` already surfaces the missing outlet."* This is the sentence
  that normatively BLESSES the tag-keyed fallback that §20.8.1.1's marker-never-tag SHALL forbids.
  It is silent on the discard too.

### A/B reproducer — CONFIRMED on base `0b050fb4`, plus a THIRD variant the brief did not measure

Command (per variant):
`bun compiler/bin/scrml.js build <proj> --target static --output <out>`

| variant | shell `<main>` | `shell-authored-child` in composed `about.html` | `site header` |
|---|---|---|---|
| A | holds authored `<div>` **and** `<outlet/>` | **1** — survives | 1 |
| B | holds authored `<div>`, `<outlet/>` REMOVED | **0** — silently discarded | 1 |
| C | **no `<main>` at all** (authored `<div>` is a direct shell child) | **0** | **0** |

Variant A/B reproduce the brief exactly. `app.html` (the shell's own page) keeps its children in
BOTH A and B — the loss is confined to COMPOSED route pages.

⚑ **VARIANT C REFINES THE BRIEF'S PREMISE.** The brief scopes the loss to "the authored children of
whichever element the fallback finder picks". True only when a `<main>` EXISTS. With no `<main>`,
`shellAvailable` is false, composition no-ops, and each route page emits **standalone with NONE of
the shell's chrome** — no `<header>`, no `<footer>`, not even the shell's `app.client.js`. Measured
body of variant C's `about.html`:

```
<body>
  <h2>route-content-marker</h2>
<script src="scrml-runtime.01983fqx.js"></script>
<script src="about.client.004gxkik.js"></script>
</body>
```

A message that says ONLY "your first `<main>`'s children are replaced" is therefore FALSE for the
shape where the loss is TOTAL. The new text covers both. Still INERT — text only.

### ⚑ THE LOAD-BEARING CONSTRAINT THE BRIEF DID NOT KNOW: a 120-CHAR SLICE

`compiler/src/commands/build.js:920` and `compiler/src/commands/dev.js:604` both print
`stripRedundantCode(w.code, w.message)?.slice(0, 120)`. **The two surfaces an adopter actually
watches truncate the message at 120 characters.** The base message's surviving window was:

    this multi-page project (a `pages/` directory exists at the project root) declares a `<program>` shell with no `<outlet>

— i.e. on a real `scrml build`, the adopter never reached "informational only", and would never have
reached a discard warning appended at the END either. **Appending the discard would have produced a
fix that is invisible on the build surface.** The new message therefore FRONT-LOADS the discard into
the first sentence, measured at **112 chars — 8 chars of headroom** under the slice.

The self-prefix (`W-…-DISABLED: `) is KEPT: `stripRedundantCode` runs BEFORE the slice, so it costs
zero budget, and de-self-prefixing is a separate open gap
(`g-tab-error-messages-self-prefix-code`, S347-peter) covering 86 literals — out of scope here.

## 2026-09-21 — edit 1 landed (`8b9db39c`), SPEC edits 2+3 written

Edit 1 (`ast-builder.js` message + 6 test pins) committed as ONE unit — coupled code+test, so
splitting would open a transiently-red window. Full pre-commit suite passed (hook exit 0).

Adversarial check, NOT confirmatory: mutated the source by file copy (never `git stash` — shared
ref) to demote the discard clause to the message TAIL. The §5 slice pin turned RED with exactly the
right reason — `Received: "This multi-page project (a `pages/` directory exists at the project
root) declares a `<program>` shell with no `<outlet>"`. Restored from the saved copy; 15/15 green.

### ⚑ ONE BRIEF INSTRUCTION WAS MECHANICALLY IMPOSSIBLE AS LITERALLY WRITTEN

The brief asked for a `> **Provenance:** …` line on the §34 row. §34's catalog is a MARKDOWN TABLE;
a blockquote cannot live inside a table row — it would break the table. The SPEC's own convention
for this is INLINE, bolded, in the Trigger cell: measured 5 precedents
(`grep -n "^|.*Provenance" compiler/SPEC.md` → E-TYPE-031, W-TYPE-031-UNPROVEN,
E-CHANNEL-MOUNT-IN-CONDITIONAL, E-STATE-BLOCK-STATEMENT-FORM, E-DERIVED-SERVER-ONLY-REACH).
Written inline in that form. Intent honoured, mechanism corrected.

`bun scripts/s34-census.ts --check-new` →
`§34.0 gate: 1 new/changed §34 row(s), all well-formed (provenance resolves) — PASS`
Row cell integrity re-checked: 5 pipes = 4 cells, unchanged.

### §20.8.1 recorded DESCRIPTIVELY, no new SHALL

Audited every `SHALL` on the edited line. Three occurrences, none new-normative: two are the
PRE-EXISTING E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / lint sentences (untouched), and the third
is a QUOTE of §20.8.1.1's marker-never-tag SHALL followed by the explicit clause "and deliberately
**not** as a `SHALL`". The discard is recorded as measured current behaviour, cross-referenced to
the open gap by id, with the contradiction named.

## 2026-09-22 — resumed after an API 529 at verification step 1; verification 1-3 COMPLETE

Died mid-run on the HEAD test suite, not on a work failure. Startup gate re-run: worktree path and
VCS toplevel match, tree clean, three commits intact (`f14405aa` / `8b9db39c` / `59244043`),
`node_modules` (212 entries, acorn present) and `samples/compilation-tests/dist/` (34 files) both
survived re-provisioning — no reinstall needed.

### Method note: base-vs-head by FILE COPY, never `git stash`

`refs/stash` is shared across every worktree. Flipped the three changed files
(`compiler/SPEC.md`, `compiler/src/ast-builder.js`,
`compiler/tests/integration/navigate-w-outlet-absent.test.js`) out of `git show 0b050fb4:<path>`
into the tree, measured, then restored saved head copies. **`git status` came back CLEAN after the
restore**, which is the proof the restore was byte-identical — not an assumption.
Flip take-up was verified positively, not assumed: with base in place, `grep -c "no action
required" compiler/src/ast-builder.js` → 2 and the struck §34 parenthetical → 1.

### VERIFICATION 1 — `bun test compiler/tests/integration compiler/tests/unit`

|  | pass | fail | skip | todo | expect() | files |
|---|---|---|---|---|---|---|
| BASE `0b050fb4` | 22432 | **0** | 40 | 10 | 117601 | 1192 |
| HEAD `59244043` | 22438 | **0** | 40 | 10 | 117624 | 1192 |

**Failure NAME-SET is EMPTY on BOTH sides** — `grep -c "(fail)"` returns 0 on each captured run, so
there is no name-set to compare and the recorded `comm`-over-timing-suffix trap cannot apply here
(nothing to `comm`). Reported as counts AND as the empty name-set, per the standing rule that a
count delta is not a regression claim.

The +6/+23 delta is accounted for EXACTLY, not inferred:
- +6 tests = the 6 new §5 pins. Declared-test count in the touched file: base **9** → head **15**.
- +23 `expect()` calls = 5+3+3+4+3+5 across those 6 tests (each calls the shared `fireLint()`
  helper, which carries one `expect`). Exact match, so nothing else in 1192 files moved.

### VERIFICATION 2 — INERTNESS differential: FOUR diffs, ALL ZERO

Instrument adapted from the proven `docs/changes/s385-each-in-scope-check/sweep.sh`, with one
deliberate addition — that script `rm -rf`'d each output dir and so could only see CODES; mine also
`sha256sum`s **every emitted artifact's CONTENTS** (contents, not names: emitted filenames already
carry content hashes, which would hide a tie). Diagnostic TEXT is deliberately NOT captured — the
reword moves text on purpose; a CODE or an artifact byte moving is the finding.

Exact commands:

```
# per-file corpus sweep, run once per side (1001 files: examples/ + samples/ + stdlib/)
bash <scratch>/sweep-inert.sh BASE     # -> BASE.codes.tsv, BASE.artifacts.tsv
bash <scratch>/sweep-inert.sh HEAD     # -> HEAD.codes.tsv, HEAD.artifacts.tsv
#   inner call, per file:
#   bun compiler/bin/scrml.js compile "$f" --output-dir "$od"

# multi-page BUILD, run once per side (the `compile` sweep cannot reach §40.8.2 composition)
bash <scratch>/build-diff.sh BASE
bash <scratch>/build-diff.sh HEAD
#   inner call:
#   bun compiler/bin/scrml.js build examples/23-trucking-dispatch --target static --output <dest>

diff BASE.codes.tsv            HEAD.codes.tsv
diff BASE.artifacts.tsv        HEAD.artifacts.tsv
diff BASE.build-artifacts.tsv  HEAD.build-artifacts.tsv
diff BASE.build-codes.tsv      HEAD.build-codes.tsv
```

| differential | scope | result |
|---|---|---|
| 1 — corpus diagnostic CODE sets | 1001 files, 753 PASS / 248 FAIL both sides | **0 diff lines** |
| 2 — corpus artifact content hashes | 3845 artifact rows both sides | **0 diff lines** |
| 3 — trucking-dispatch build artifacts | 115 artifact rows / 107 output files both sides | **0 diff lines** |
| 4 — trucking-dispatch build CODE census | 12 distinct codes both sides, `W-OUTLET-ABSENT…` = 1 | **0 diff lines** |

**POSITIVE CONTROL — the probe is not merely blind.** `diff` of the two trucking-dispatch build
LOGS exits 1 with 16 lines, and the only substantive line among them is the
`W-OUTLET-ABSENT-SOFT-NAV-DISABLED` warning text; the remainder is the build's own elapsed-ms line
and the output PATH, which differs by construction because the path carries the label. So the
instrument DID see the change it was supposed to see, and saw nothing else. Zero above is a
measurement, not an absence of measurement.

Reproducer-level inertness too — A/B/C re-run on HEAD gives byte-identical verdicts to BASE:
A `shell-authored-child=1`, B `=0`, C `=0` with `site header=0`.

### VERIFICATION 3 — the two CLI surfaces, measured

⚑ **The coordinator's challenge to my own commit-subject premise was RIGHT to raise and the premise
holds, but it needed stating more carefully than the subject line did.** `compile.js` does NOT
slice — `scrml compile` prints the full message plus the `-->` coordinate. Only `build.js:920` and
`dev.js:604` slice, at 120 chars. Both verified by execution on this tree.

**Nothing was cut to fit 120.** Measured off the literal on each ref:

| | full msg (raw) | after `stripRedundantCode` | discard named within the 120-char slice? |
|---|---|---|---|
| BASE | 676 | 641 | **NO** — window ended "...shell with no `<outlet>" |
| HEAD | 1559 | **1524** | **YES** |

The text got **2.4x LONGER**, not shorter. The 120-char budget governed ORDERING only: the discard
clause LEADS (112 chars, 8 of headroom) so the truncating surfaces carry it too, and the full
reasoning still lands unabridged on `scrml compile`. That is the deliberate shape.

### Test-pin shape (coordinator's second point) — already satisfied by construction

Audited: **zero** whole-string message assertions in the file (`grep -c "message).toBe("` → 0). All
13 message assertions are distinctive-substring regexes (`/first `<main>`/`, `/REPLACED/`,
`/informational only IF/`, …), so a future wording pass can reword freely and only fails if it drops
a NAMED FACT. That is the intended failure mode: it never forces a choice between breaking a test
and dropping the discard warning.
