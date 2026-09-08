# progress.md — free-move-engine-statechild-string-branches-2026-09-07

Append-only. Timestamps UTC.

## 2026-09-07 — startup
- WORKTREE_ROOT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aeabb6d81daa74a3e
- `git rev-parse --show-toplevel` matches. `git status` clean.
- base assertion: HEAD == origin/main == merge-base == `8f1cea3123d682f7e0032467a0fcff66703cafbf`. Base is EXACTLY origin/main.
- `bun install` OK (218 packages).
- BRIEF fetched from `origin/free-move/s405-engine-statechild-strings` via `git checkout FETCH_HEAD -- docs/changes/...`.
- `.claude/maps/primary.map.md` read (Task-Shape Routing row 2 / closer-scan row) — LOAD-BEARING, see report.
- NEXT: read `skipCommentOrString`, diff vs `skipMatchComment`, enumerate call sites by execution.

## 2026-09-07 — loci verified + BEFORE baseline captured
### Locus verification — PA hypothesis HELD EXACTLY
- `grep -n 'function skipCommentOrString'` -> **1363**. Claimed 1363. HELD.
- string/backtick branches -> **1418-1452**. Claimed 1418-1452. HELD (byte-exact).
- `grep -n 'function skipMatchComment' match-statechild-parser.ts` -> **115**. Claimed 115. HELD.
- call sites: brief said "~10"; actual is **12**, matching primary.map.md's enumeration exactly:
  683, 692 (scanForNestedEngineEntries) · 895, 904 (scanForOnTransitionEntries) · 1048
  (findOnTransitionCloser) · 1178 (findEngineCloser) · 1473 (computeCommentRegions) · 1693
  (findStateChildCloser) · 1912 (skipTrivia, inner fn of parseMessageArms) · 2145, 2160, 2170
  (parseEngineStateChildren). 12 sites, 8 enclosing functions.
- `findOpenerEnd` is NOT a caller — confirmed, and it has its OWN `inQuote` tracker (:1496).

### `skipCommentOrString` vs `skipMatchComment` diff — claim MOSTLY holds, 2 extra deltas
The string branches ARE the whole functional difference for THIS change, but the two functions are
NOT otherwise identical:
  1. engine has `if (i >= s.length) return i;` guard; match does not (relies on undefined).
  2. **`//` line comment: engine CONSUMES the terminating newline (`if (j < s.length) j++;`);
     match returns the index OF the newline.** A real semantic difference in a RETAINED branch,
     documented in both docstrings as an intentional caller-contract difference. Not touched here.

### BEFORE baseline (build at 8f1cea31 + this worktree, empirical compile)
| case | exit | note |
|---|---|---|
| probe-odd (`it's ready`) | **1** | `E-ENGINE-STATE-CHILD-MISSING .B` — DONE-PROBE REPRODUCES exactly as briefed |
| probe-even (`it's ready, don't wait`) | 0 | the odd/even tell CONFIRMED |
| adv1 display-text `"Ready to fetch."` | 0 | must stay 0 |
| adv2 colon-shorthand `<Idle : "Waiting...">` | 0 | must stay 0 |
| adv3 `</>` inside a string | **1** | **ALREADY BROKEN ON MAIN** — 5 errors incl E-CTX-001. See finding. |
| adv4 attr `title="a > b and it's fine"` | 0 | must stay 0 |
| adv5 backtick `${ \`count is ${@n}\` }` | 0 | must stay 0 |
| adv6 nested engine, apostrophes in both bodies | **1** | **ALREADY BROKEN** — same bug, nested path |
| ctrl3 (adv3 minus the `</>`) | 0 | isolates adv3's cause to the `</>`, not the quotes |
| ctrl6 (adv6 minus the apostrophes) | 0 | isolates adv6's cause to the apostrophes |

**FINDING (case 3): the branches do NOT protect the case they exist to protect.** adv3 fails on
UNMODIFIED main, and it fails at a stage UPSTREAM of the engine parser (E-CTX-001 "'</p>' tries to
close '<A>'" comes from the context checker over BS output). `block-splitter.js:findStructuralBodyEnd`
already had its string branches removed at S196, so BS already reads that `</>` as structural. Case 3
therefore CANNOT regress — it is already red. This materially strengthens the free-move case.

**FINDING (adv6): the even-count mask is per-SCAN-WINDOW, not per-file.** adv6 has an EVEN global
apostrophe count (2) and still fails, because the phantom string opened at `outer's` closes at
`inner's` and swallows the nested `<engine for=Inner ...>` opener in between.

- NEXT: delete lines 1418-1452, re-run the matrix, then the full suite + R26.

## 2026-09-07 — SPEC read: the brief's governing sentence is REFINED (and strengthened)

`SPEC.md:1090` in FULL is one sentence whose FIRST half says the opposite of the fragment the brief
quoted:

> (S111 — quoted-text model.) The state-child bodies of `<engine>` and the arm bodies of `<match>`
> are **code-default bodies** (§4.18.1) … The `<errors>` override-template body and any plain-markup
> element body are free-text bodies.

So an engine state-child body is itself CODE-DEFAULT, not free-text. The brief's free-text argument
survives only via the nested-`<p>` sub-body (which the brief did anticipate) — it does NOT cover a
`"…"` at state-child top level. **Surfaced as a material elision, not a blocker**, because §4.18.3
supplies a stronger and narrower licence that applies in BOTH body modes:

- `SPEC.md:1219` — *"A display-text literal is delimited by the double-quote character `"` on both
  ends. The double-quote is the **only** display-text-literal delimiter."*
- `SPEC.md:1220` — *"The apostrophe `'` is an **ordinary interior character** … it carries no
  delimiter role and requires no escape … The backtick is likewise an ordinary interior character and
  is NOT a display-text delimiter."*
- `SPEC.md:1362` (§5.1) — *"scrml uses one string delimiter, `"`, language-wide."*

⇒ `'` and backtick are not delimiters ANYWHERE in scrml. Those two branches were unconditionally
wrong at all 12 call sites. The `"` branch needed the separate empirical argument below.

## 2026-09-07 — the `"` branch: measured, not argued

Seven probes compiled on the BASE build (`dq-before`). Every shape where the `"` branch could
possibly matter is ALREADY RED upstream, at block-splitter / context-checker, before the engine
scanner runs:

| probe | BEFORE | AFTER |
|---|---|---|
| `"go </> now"` at state-child top level | E-CTX-001 + 3 more | E-CTX-001 + 2 (one FEWER) |
| `"a < b"` | E-CTX-003 ×4 | identical |
| `"rate 50 // 100"` | E-CTX-001 ×2 | identical |
| `"write <!-- here"` | E-CTX-003 ×3 | identical |
| `"a 6\" pipe"` (no structural token) | exit 0 | exit 0 |
| `<p>a 6" pipe</p>` odd `"` in free text | **E-ENGINE-STATE-CHILD-MISSING** | **exit 0 — FIXED** |
| ``<p>press the ` key</p>`` odd backtick | **E-ENGINE-STATE-CHILD-MISSING** | **exit 0 — FIXED** |

So the `"` branch bought ZERO reachable protection and cost the same phantom-string defect. That is
why deleting all three is right, and it is a STRONGER result than the brief argued.

## 2026-09-07 — EDIT APPLIED (`720b81bd`)

Deleted `engine-statechild-parser.ts:1418-1452` (the `"`/`'` branch + the backtick branch). Kept `//`,
`/* */`, `<!-- -->` and the `urlSlashesAt` URL carve-out. Repaired the 11 comments the deletion
invalidated (helper docstring, `computeCommentRegions` docstring, 9 call-site comments still reading
"comment / string skip").

Post-edit `skipCommentOrString` is now `skipMatchComment` PLUS exactly the two pre-existing
differences noted above (the length guard; `//` newline consumption).

## 2026-09-07 — VERIFICATION

- **Pre-commit gate** (`unit + integration + conformance + top-level`): **29763 pass / 84 skip /
  10 todo / 0 fail**, 1315 files.
- **Emission non-regression:** every previously-passing probe emits **BYTE-IDENTICAL** output
  (adv1, adv2, adv4, adv5, probe-even, d4). adv3's stderr is byte-identical too.
- **R26 empirical** (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`, 4 files, ~122 KB,
  **14 `<engine>` blocks, 220 `'`, 806 `"`, 1688 backticks** — referent verified, the files DO
  exercise the changed path): full stderr **byte-identical** and emitted artifact trees
  **byte-identical** on all four.
- **Engine-corpus sweep:** all **158** tracked `.scrml` containing an `<engine>` recompiled on both
  builds; per-file diagnostic censuses **byte-identical**. (Read as BLAST-RADIUS evidence only — a
  green corpus is by construction free of the shapes that trigger this bug, so corpus-zero here is
  NOT demand evidence.)
- **Base-vs-build flip done by FILE COPY** (`parser.BASE.ts` / `parser.FIXED.ts` in scratchpad).
  **No `git stash` was used at any point.** Restore verified byte-identical each time.
- **Regression tests:** `compiler/tests/integration/engine-statechild-prose-punctuation.test.js`,
  25 cases. On the BASE parser: **15 pass / 10 fail**. After: **25 pass / 0 fail**.

## 2026-09-07 — the wide `bun run test` is NOT 0-fail, and it is NOT mine

`bun run test` = `bun test compiler/tests/` (wider than the pre-commit gate — adds browser/, lsp/,
commands/, self-host/). It reports **53 failures**. Measured on BOTH builds and diffed:

- AFTER: 53 failures. BEFORE (base parser, same worktree): 63 failures.
- `comm -13 before after` → **EMPTY. Zero new failures.**
- The 10-failure delta is exactly my own new test file failing on the base parser.

Characterisation (offered so the PA does not have to re-derive it):
- **48 are in `compiler/tests/browser/`** and are a genuine PRE-EXISTING red on `origin/main`, not a
  worktree env gap: `samples/compilation-tests/dist/transition-001-basic.{html,client.js}` in this
  worktree are **byte-identical to the main checkout's**, and the HTML contains **zero
  `data-scrml-bind-if` attributes**, which is why `getIfElements()` returns 0. The emitted attribute
  shape moved at some point and these browser tests were not updated.
- **5 are order-dependent flakes in `compiler/tests/commands/`** — that suite is **256 pass / 0 fail
  in isolation** and only fails inside the whole-suite run (the known happy-dom / shared-port
  cross-file global-state leak).

The brief's "0 failures is the contract" is unsatisfiable in this worktree at the UNMODIFIED base, so
the honest contract I can meet is zero-delta, which is met exactly.

## 2026-09-07 — base note

`origin/main` advanced during the dispatch (`8f1cea31` → `8fa6854d`, one commit: `brief(free-move) +
bank(dpa-045 round 2)` #883). My merge-base is still `8f1cea31`. `git diff origin/main..HEAD` therefore
shows spurious DELETIONS of `handOffs/delta-log.md` / `handOffs/dpa-queue.md` — main's newer content my
branch predates, to be filtered at landing. My BRIEF.md copy is byte-identical to the one main landed.
**True delta = 4 files** (parser, test, BRIEF, progress).

## 2026-09-07 — DEFERRED (surfaced, deliberately NOT done here)

1. `docs/known-gaps.md` still carries `g-engine-state-child-apostrophe-breaks-parse` as **MED/open**,
   and `.claude/maps/{primary,structure,error,non-compliance}` still record the engine-vs-match
   asymmetry as an OPEN defect. All are now stale. **Left to the PA on purpose** — those are
   PA-owned shared session docs and an agent overwrite has clobbered PA work here before.
2. `origin/fix/s402-engine-apostrophe2` (`46bb46c9`) — the five-round STOPPED-BY-RULE scan-tweak
   attempt — is now superseded and should be closed/deleted rather than merged.
3. `block-splitter.js:skipDollarBrace` (`:320`) is quote-aware and STILL NOT EXPORTED on main
   (re-verified at my base). Unrelated to this delta; the one-word export still sits unlanded.
4. `skipCommentOrString` is now a misnomer (it skips no strings). Rename to `skipEngineComment` for
   sibling parity with `skipMatchComment`? NOT done — 12 call sites plus 5 doc/test references, and a
   rename would enlarge a diff the PA has to adversarially review. PA's call.
5. Pre-existing, orthogonal, found while probing: markup inside an `<onTransition>` body
   (`<onTransition to=.On><p>x</p></>`) reaches codegen and dies at `E-CODEGEN-INVALID-LOGIC`. Not
   filed anywhere I could find.
6. Confirms dpa-045 Call 1 by observation: a block-form state-child display-text literal emits WITH
   visible quote marks (`<div …>"Ready to fetch."</div>`) while the `:`-shorthand emits stripped
   (`Waiting...`). Byte-identical before/after, so untouched by this delta — but the polarity
   inversion is real and reproducible.

# ═══ S405 FIX ROUND (post-adversarial-review) ═══

## 2026-09-07 — both findings reproduced at my tip BEFORE touching anything

| case | S405 BASE | my tip `0420ddab` | verdict |
|---|---|---|---|
| HIGH `title="glob /*.ts"` + live `<onIdle>` | exit 0, idle wiring PRESENT | exit 0, idle wiring **0** | **my regression, SILENT** |
| MED `"a /* b"` display-text literal | 0 errors | **2** false E-ENGINE-STATE-CHILD-MISSING | **my regression** |

Both confirmed by execution, not accepted on relay.

## 2026-09-07 — the population, derived instead of recalled

The review's methodological note is the important part, so I did it properly.
**The population is not a list of tokens I thought of — it is derived from the file:**
- (a) region-openers the helper still recognizes = its own `if (c === …)` branch list
  → **`//`, `/*`, `<!--`** (THREE). `/*` is the one round 1 missed, and it is the ONLY one
  that does not already fail upstream.
- (b) byte sequences the CALLERS test for = every `startsWith("…")` in the file + the bare
  `<`+letter opener check → **`</`, `</>`, `${`, `<engine`, `<onTransition`, `</onTransition`, `<tag`**.
- Crossed with the **two reachable LOCATIONS**: inside a display-text literal (walkers +
  `computeCommentRegions`), and inside an ATTRIBUTE VALUE (`computeCommentRegions` ONLY, because
  walkers jump openers via `findOpenerEnd`).

Round 1 covered 4 of 9 tokens in 1 of 2 locations. Generated and ran all 20 cells, before and after.

**THE GRID FOUND A THIRD REGRESSION THE REVIEW DID NOT NAME:**
`<!--` in an attribute value masks the timers identically to `/*` — same silent-loss class,
same severity. `//` is NOT affected: bounded by the newline, it cannot reach a later line.
**Only the EOF-consuming openers hurt**, which is the generalisation both limbs are aimed at.

**AND A FOURTH, WHICH DECIDED THE FIX SHAPE:** a `/*` in an attribute value PAIRED with a
genuine later `*/` (`/* a real trailing comment */`). The `/*` IS terminated, so limb 2 never
fires. base idle=2/tmo=3 → tip 0/0. **This is the cell that proves limb 2 alone is insufficient
and limb 1 is necessary, not optional.**

## 2026-09-07 — the limb-2 desync check (the thing I was most worried about)

BS's `skipBlockComment` / `skipHtmlComment` DO `return len` on unterminated input, so limb 2
looked on paper like it would create a **new BS-vs-engine desync — the exact Class D failure this
whole arc is about.** Probed instead of argued:

`<A rule=.B><p>glob /*.ts here</p></>` — **fails IDENTICALLY on base and on my tip**, and the only
diagnostics are `E-ENGINE-STATE-CHILD-MISSING` with **NO `E-CTX-*`**. That proves BS ACCEPTED those
bytes and this flat helper alone rejected them. **Limb 2 therefore CONVERGES with BS, not away from
it** — and that case was a PRE-EXISTING bug (red on base), now closed as a bonus.

## 2026-09-07 — FIX APPLIED (`56616705`), both limbs

- **Limb 1** — `computeCommentRegions` jumps whole tag-shaped openers via `findOpenerEnd`.
  Guard is `<` + letter or `/` (same as the walkers), so `a < b`, `<3`, `<-` stay prose; `<!--`
  is still caught by the comment branch first because `<!` is not tag-shaped; `findOpenerEnd`
  returning -1 falls back to `i++` rather than consuming to EOF.
- **Limb 2** — unterminated `/*` and `<!--` return `i` (prose) instead of `s.length`.
  `//` deliberately unchanged: end-of-input IS end-of-line per SPEC §27.1, and it cannot mask.
  Diagnostic deliberately NOT built (dpa-044 Call 1 is a separate arc, as briefed).

**Result across all 20 population cells: the ONLY remaining difference vs base is
`L1-generic-closer` 4 → 3 errors — strictly FEWER.** All four regression cells closed, and every
closed cell's emitted artifacts are **BYTE-IDENTICAL to base**.

## 2026-09-07 — findings 3, 4, 5 and a new PIN

- **3** — docstring's "all four" over-claim replaced with the derived population above, plus a
  warning that adding a branch or a `startsWith` widens it and the grid must be re-derived.
- **4** — the two surviving stale comments repaired (`~:2213` still claimed a `<X` inside a
  `"string"` is not an opener — it now IS; `~:2226` still narrated the phantom-string machinery as
  live) and the dangling reflow fragment removed.
  `engine-statechild-comment-opacity.test.js` keeps its historical past tense but gains an S405
  CURRENCY NOTE so it cannot be read as the current contract.
- **5** — PINNED, and it is a real behaviour change. Measured on the S405 base: a `"…"` render body
  beneath `|` message arms was **SILENTLY DISCARDED** (absent from the bundle, exit 0, no
  diagnostics). It now renders. A fix for silent content loss that changes output for programs that
  already compiled clean.
- **NEW PIN** — any paired `/* … */` in an engine state-child body fires an upstream
  `E-SYNTAX-050` ("Bare '/' is no longer a valid closer", from the `/` of the closing `*/`).
  NOT about the comment's contents — a plain content-free block comment does it. Identical on the
  S405 base, so pre-existing and orthogonal; I could not find it filed anywhere. This is why the
  paired-comment guard is asserted at the HELPER level (`parseEngineStateChildren`) rather than
  through a compile.

## 2026-09-07 — FIX-ROUND VERIFICATION

- **Tests:** integration file 25 → **36 cases**. **7 of the new ones fail on the pre-fix-round tip
  (`0420ddab`) and pass after**; the rest are guards, green both ways by design.
  ⚠ **Every new fix-round test asserts on EMITTED OUTPUT, not exit code** — the HIGH compiled at
  exit 0 while deleting the timer, so an exit-code assertion would have passed against the broken
  build. That is precisely how round 1's PIN suite missed it.
- **Pre-commit gate:** **29778 pass / 84 skip / 10 todo / 0 fail**, 1315 files.
- **158-file engine sweep, RE-RUN:** diagnostic censuses **byte-identical to base**.
- **R26 adopter recompile, RE-RUN:** full stderr **and** emitted artifact trees **byte-identical to
  base** on all four files.
- **Wide `bun test compiler/tests/`:** 53 failures. `comm -13` vs the pre-fix-round tip → **EMPTY**;
  vs the S405 base → **EMPTY**. Same 48 browser + 5 order-dependent `commands` pre-existing set
  characterised earlier.
- All flips by FILE COPY (`parser.BASE.ts` / `parser.FIXED.ts` / `parser.FIXROUND.ts`).
  **No `git stash` at any point.**

## 2026-09-07 — DEFERRED, updated

Carried forward from round 1: items 1-6 unchanged (known-gaps + maps still stale — PA-owned;
`origin/fix/s402-engine-apostrophe2` superseded; `skipDollarBrace` still unexported; the
`skipCommentOrString` rename; markup-in-`<onTransition>` → `E-CODEGEN-INVALID-LOGIC`; the
dpa-045 Call 1 display-text quote-polarity inversion).

NEW from this round:
7. **`/* … */` block comments do not work in an engine state-child body AT ALL** — upstream
   `E-SYNTAX-050` on the closing `*/`. Pre-existing, unfiled, root is upstream of this file.
8. **The dpa-044 Call 1 diagnostic for unterminated delimiters is now owed here.** This round
   stopped the silent EOF consumption but deliberately did not add the diagnostic. An unterminated
   `/*` in an engine body is currently silently treated as prose — better than silently eating the
   file, but still silent.
9. **`computeCommentRegions` was the only caller lacking opener awareness — worth auditing whether
   any OTHER flat scan in this file or its siblings has the same gap.** I did not widen scope to
   check `match-statechild-parser.ts` for an equivalent.

# ═══ S405 FIX ROUND 2 ═══

## The reframe, accepted and confirmed

`skipCommentOrString`'s string branches were doing **DOUBLE DUTY** — wrongly lexing strings in prose
(the bug S405 deleted, correctly) AND accidentally **shielding every flat scan from reading an
opener's ATTRIBUTE INTERIOR**, because attribute values are quoted. Deleting them did not create the
opener-blindness; it **UNMASKED a pre-existing architectural gap**. Closed at each scan, not by
restoring the shield.

## POPULATION OVER SCAN SITES — the dimension round 1 held fixed

Round 1 derived tokens × locations and ran all 20 cells. Rigorous, and **the wrong axis**: it held
the SCAN SITE constant. Re-derived mechanically (scripted brace-matching over every loop containing a
comment-skip call — `scratchpad/loopsites.py`), because a function-level analysis reports three of
these SAFE: they sit in the same functions as an already-safe walker loop. **The unit is the LOOP.**

> A loop is IN CLASS iff it (a) calls the comment skip, (b) **TRAVERSES** across body text toward a
> structural target elsewhere — so it can walk into an opener — and (c) has no opener jump.

**ELEVEN loops call the skip. FOUR were in class:**
| # | loop | status |
|---|---|---|
| 1 | `computeCommentRegions` | closed in fix round 1 |
| 2 | `scanForOnTransitionEntries` inner re-scan | closed this round |
| 3 | `scanForNestedEngineEntries` inner re-scan | closed this round |
| 4 | `parseEngineStateChildren` inner re-scan | closed this round (LIVE symbol-table path) |

The six WALKER loops are safe — they jump whole openers via `findOpenerEnd`.

⚑ **A FIFTH LOOP HAS NO OPENER JUMP AND IS STILL SAFE — I CHECKED RATHER THAN COUNTED.**
`parseMessageArms`' `skipTrivia` fails criterion (b): it **HALTS at the first non-trivia byte**, so it
can never be positioned inside an opener. Verified EMPIRICALLY — identical `arms` and
`renderBodyStart` against its own control for `//`, `/*` and `<!--` in an attribute — not asserted
from the shape of the code. **Given the stated stopping rule I treated this as a possible fifth site
and stopped to test it before doing anything else.** It is not one. It now has a test pinning that
boundary, so if it ever becomes a traversing scan, that shows up as a failure rather than a silent gap.

**So: 4 in class, 1 done previously, 3 done here. No fifth site. The stopping rule is not triggered.**

## SITE 4 NEEDED A DIFFERENT LOCUS — patching the re-scan alone left it broken

Sites 2/3 were fixed by making the inner re-scan opener-aware. Site 4 was NOT: its outer loop does
`i = lt + 1` for any non-uppercase `<`, which **steps the scan position INSIDE the opener**, so the
jump never fires — the scan starts past the `<`. Caught because the probe still failed after the
first patch. Fixed by advancing past the whole opener at all three `i = lt + 1` sites. Same fix
shape, right place; not a new site.

`parseEngineStateChildren`, base → round-1 tip → now:
| body | base | round 1 | now |
|---|---|---|---|
| `<a href="//cdn.x">` same line as the child | `[A,B]` | `[B]` | `[A,B]` |
| `<a title="glob /*.ts">` + a later `*/` | `[A,B]` | `[]` | `[A,B]` |
| `<a title="a <!-- b">` + a later `-->` | **`[]`** | `[]` | **`[A,B]`** |

The third row was **RED ON BASE** — pre-existing — and is closed by the same change.

## FINDING 2 — `<!--` half REVERTED, `/*` half retained. My error, owned.

I justified extending limb 2 with *"same reasoning as the `/*` branch above"*. **The reasoning does
not transfer.** Verified at source myself:
- BS's `/*` path **HAS a containment pre-scan** (`block-splitter.js:2581-2596` — *"is there a `*/`
  before this brace context's closing `}` (or EOF)? … if (!commentContained) … Not a real comment …
  Emit the `/` as ordinary text"*). BS also declines an unterminated `/*`. **`/*` genuinely CONVERGES**
  — my round-1 proof for `/*` stands.
- BS's `skipHtmlComment` (`:358-368`) **unconditionally `return len`**, and `findStructuralBodyEnd`
  calls it that way (`:793`). **No containment pre-scan for `<!--`.**

So round 1 **created** the desync it had correctly avoided on `/*`. Confirmed independently at unit
level: `<A/>` + unterminated `<!--` + `<B/>` parsed as `["A","B"]` — the commented-out state-child
**wired up anyway**. Now `["A"]`.

**This is reasoning-by-analogy without checking the analogy holds — the same error I caught in the
original brief's half-quoted SPEC sentence, made in the opposite direction.** Both the branch and the
docstring now record why the two differ and say NOT to unify them for tidiness.

## FINDING 3 — docstring replaced with a per-branch table

*"Unterminated regions consume to EOF … for unclosed `//` / `<!-- -->`"* → a table pinning EACH branch
to what BS does with the same bytes (`//` EOF; `<!--` EOF matching `skipHtmlComment`; `/*` NOT,
matching the containment pre-scan), plus a do-not-unify warning.

## Refactor

The opener jump is now ONE helper (`skipTagShapedOpener` / `skipOpenerAware`) used by all four sites
instead of inline logic duplicated per site — fix shape stated once, reasoning in one place.

## FIX-ROUND-2 VERIFICATION

- **Tests:** 36 → **43 cases**, a regression test PER SITE, e2e ones asserting on **EMITTED OUTPUT**.
  **6 fail on the pre-round-2 tip and pass after.**
  One round-1 test **DELETED** (it encoded the reverted `<!--` behaviour) and replaced by its inverse,
  with a comment left at the deletion point — a deleted test is invisible, and the next person to
  notice the `/*` vs `<!--` asymmetry should learn it is deliberate rather than "tidy" it back.
- **Pre-commit gate:** **29785 pass / 84 skip / 10 todo / 0 fail**, 1315 files.
- **158-file engine sweep, RE-RUN:** byte-identical to base.
- **R26 adopter recompile, RE-RUN:** full stderr AND emitted artifact trees **byte-identical** on all
  four files.
- **20-cell token×location grid, RE-RUN:** only difference vs base is `L1-generic-closer` 4 → 3
  errors — strictly FEWER.
- **Coordinator's e2e reproducer:** `fire_hooks` present, emitted output **byte-identical to base**.
- **Wide `bun test compiler/tests/`:** 53 failures; `comm -13` vs pre-round-2 tip **EMPTY**, vs S405
  base **EMPTY**.
- All flips by FILE COPY. **No `git stash` at any point.**

## DEFERRED — updated

Round-1 items 1-6 and round-2 items 7-9 all still stand, with 9 now partly answered: the audit of
OTHER flat scans was done for THIS file (11 loops, mechanically). **`match-statechild-parser.ts` was
NOT audited for an equivalent** — it is the sibling that took the same S196 deletion, so it plausibly
has the same unmasked gap. Out of scope this round; flagged as the highest-value next check.

NEW:
10. **The `skipTrivia` boundary is load-bearing and now only guarded by a test.** If `parseMessageArms`
    ever gains a traversing scan, it joins the class. The criterion is written into the
    `skipOpenerAware` docstring so the next author has the rule, not just the example.

# ═══ S405 FIX ROUND 3 (final) ═══

## FINDING 1 — reproduced, fixed, and the BRIEF'S SEVERITY WAS TOO LOW

`computeCommentRegions` gained the opener JUMP in round 1. **Jumping and RECORDING are different
jobs and round 1 only did one of them.** The jump stops a comment opener inside an attribute from
starting a region; it does nothing about the two REGEX-based scanners
(`scanForOnTimeoutEntries` / `scanForOnIdleEntries`), which filter their matches ONLY against that
array. On `main` the deleted `"` branch recorded the attribute text as a string region and masked it
by accident.

```
scanForOnTimeoutEntries('<p title="use <onTimeout after=1s to=.A/> here">x</p>')
  base / round 3 -> []          round 2 -> [{after:"1s", to:"A"}]
```

Asymmetric with the rest of the arc: `scanForOnTransitionEntries` /
`scanForNestedEngineEntries` get it structurally via `skipOpenerAware` and were already right.

⚑ **CORRECTION TO THE BRIEF — IT IS NOT UNIT-LEVEL ONLY.** The brief records no user-visible effect
through `compileScrml`. There is one, and it is a false HARD ERROR on valid source. A phantom
`<onIdle>` scanned out of an attribute is attributed to the STATE-CHILD BODY, which is not a legal
`<onIdle>` locus (§51.0.R — engine root only):

| build | `<Awake rule=.Sleeping><p title="use <onIdle after=9m to=.Awake/> here">go</p></>` |
|---|---|
| S405 base | exit 0, no diagnostics |
| round 2 (my tip) | **exit 1, `E-IDLE-MISPLACED`** — valid source rejected |
| round 3 | exit 0, no diagnostics |

Reproduced end-to-end on all three builds. Pinned by an engine-level test on top of the
scanner-level ones.

## ⛔ THE SPAN IS THE OPENER'S INTERIOR, AND THAT IS THE WHOLE FIX

A real top-level `<onTimeout after=1s to=.A/>` **IS itself a tag-shaped opener.** Recording its own
span as masked would mask its own regex match — which is anchored AT the `<`, i.e. at `i` — and
**SILENTLY DELETE EVERY REAL TIMER.** That would have been far worse than the phantom being fixed,
and it is the obvious way to write this fix. The region is `[i + 1, openerEnd)`: a match anchored at
`i` stays visible, everything nested inside is masked. Two guard tests cover both over-reach
directions (must not start at `i`; must end at the opener's `>` and not run into the body).

## RENAME

`computeCommentRegions` -> `computeMaskedRegions` (+ `commentRegions`/`inCommentRegion` ->
`maskedRegions`/`inMaskedRegion`). The array now carries opener interiors as well as comments, so the
old name actively lied about its contents — and on this surface the comments are load-bearing.
Mechanical, compiler-checked, zero behaviour change.

## FINDING 2 (LOW) — docstring corrected to what the code does

`skipTagShapedOpener` claimed ordinary prose is untouched. True for `a < b`, `<3`, `<-`; **FALSE for
`<` immediately followed by a LETTER**, which IS treated as an opener even in prose, after which
`findOpenerEnd` runs to the next unbalanced top-level `>` — arbitrarily far, able to swallow a real
state-child. Docstring now states that, records it as the single cause of every fuzz-corpus
regression against the helper, records WHY it is tolerable (such source already fails upstream
identically on both trees — BS reads the same `<b` as a tag), and warns against weakening the
upstream check on the strength of the comment.

## FINDING 3 (LOW) — recorded, NOT fixed, as directed

The deletion's safety argument leans on *"opener-internal quotes are consumed by `findOpenerEnd`'s
own `inQuote` tracker"*. **That tracker still treats `'` as an opening delimiter** — so the exact
defect S405 deleted survives one layer down, at the very site the safety argument names. Per §4.18.3
(`SPEC.md:1219-1220`) `'` carries no delimiter role **language-wide**, so the tracker is itself out of
conformance; `"` is legitimate there (attribute values ARE `"`-delimited, §5.1) but `'` is not.
Pre-existing (`main` identical) → outside the strict diff, filed separately.

⚑ The docstring also records that **this work WIDENED its reach**: `findOpenerEnd` is now reached
from five additional scan paths covering every lowercase opener and closer in every scanned body,
where before only PascalCase / `<engine>` / `<onTransition>` openers reached it. **Fixing it is a
larger blast radius after this change than before it, not a smaller one** — that should inform how
the separate dispatch is scoped.

## NOT TOUCHED, per instruction

- `match-statechild-parser.ts` — separate dispatch. (Reviewer probed it and could not reproduce the
  loss; `findArmCloser`'s inner `q`-loop covers opener interiors.)
- The three unterminated-region policies stay deliberately non-uniform; the do-not-unify comment stays.

## ROUND-3 VERIFICATION

- **Tests:** 43 → **47**. 2 fail on the pre-round-3 tip and pass after; 2 are over-reach guards,
  green both ways by design. The scanner-level tests state IN THE TEST why they are scanner-level.
- **Pre-commit gate:** **29789 pass / 84 skip / 10 todo / 0 fail**, 1315 files.
- **158-file engine sweep, RE-RUN:** byte-identical to base.
- **R26 adopter recompile, RE-RUN:** full stderr AND emitted artifact trees byte-identical, all four.
- **20-cell token×location grid, RE-RUN:** only difference vs base remains `L1-generic-closer`
  4 → 3 errors (strictly fewer).
- **All earlier probes re-run** (three sites, site-4 variants, `<!--` revert, `skipTrivia`): unchanged.
- **Wide `bun test compiler/tests/`:** 53 failures; `comm -13` vs pre-round-3 tip **EMPTY**, vs S405
  base **EMPTY**.
- All flips by FILE COPY. **No `git stash` at any point across all four rounds.**

## FINAL DEFERRED LIST (for the landing PA)

1. `docs/known-gaps.md` — `g-engine-state-child-apostrophe-breaks-parse` still MED/**open**; four maps
   still record the engine-vs-match asymmetry as open. Stale. **PA-owned; deliberately not touched.**
2. `origin/fix/s402-engine-apostrophe2` (`46bb46c9`) superseded — close, do not merge.
3. `block-splitter.js:skipDollarBrace` (`:320`) quote-aware and still NOT exported on main.
4. `skipCommentOrString` is still a mild misnomer (skips no strings). Rename deferred — 12+ refs.
5. Markup inside an `<onTransition>` body → `E-CODEGEN-INVALID-LOGIC`. Pre-existing, unfiled.
6. dpa-045 Call 1 confirmed by observation: block-form display-text literal emits WITH visible
   quotes; `:`-shorthand emits stripped. Untouched here.
7. Any paired `/* … */` in an engine state-child body → upstream `E-SYNTAX-050` (from the `/` of the
   closing `*/`). Pre-existing, unfiled, root upstream of this file.
8. The dpa-044 Call 1 diagnostic for unterminated delimiters is now OWED — this arc stopped the
   silent EOF consumption for `/*` but deliberately did not add the diagnostic.
9. **`match-statechild-parser.ts` sibling audit** — separate dispatch, per instruction.
10. The `skipTrivia` class boundary is guarded only by a test; the criterion is written into the
    `skipOpenerAware` docstring so the next author gets the RULE, not the example.
11. **NEW — `findOpenerEnd`'s `inQuote` tracker treats `'` as a delimiter** (finding 3). Out of
    §4.18.3 conformance; pre-existing; reach WIDENED by this work. Filed separately by the PA.
