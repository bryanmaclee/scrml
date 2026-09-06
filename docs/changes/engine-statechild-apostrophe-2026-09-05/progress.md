# progress — engine-statechild-apostrophe-2026-09-05

## Startup verification (verified by execution)
- pwd = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4652f4f211575b20
- git rev-parse --show-toplevel == pwd; git status clean
- merge-base HEAD origin/main == origin/main == 603d14299a7c50904dea97949521831f49205305
- bun install: 218 packages
- bun run pretest (plain, from worktree CWD): 13 samples compiled, samples/compilation-tests/dist/ has 34 artifacts

## Reproduction at base 603d1429 (verified by execution)

Three-way table via `scrml compile`:

| fixture | result at base |
|---|---|
| odd (1 apostrophe, `<p>it's ready</p>`)  | `E-ENGINE-STATE-CHILD-MISSING` naming `.B` |
| even (2 apostrophes)                     | compiles clean |
| control (0 apostrophes)                  | compiles clean |

Direct probe on `parseEngineStateChildren` (below the pipeline): odd yields
ONE entry (`[A]`), even/control yield TWO (`[A, B]`). The state-child is
DROPPED at parse, not rejected at SYM — SYM is only reporting what the parser
handed it.

## Deciding site — peter's locus HELD, and the blast radius is wider than filed

`compiler/src/engine-statechild-parser.ts`, at symbol `skipCommentOrString`
(the shared comment/string skip helper), reached from `findStateChildCloser`.
Peter's filing pointed at "its own closer-scan"; that is correct, but the
helper is shared by 12 call sites across SIX scanners, so the same phantom
string derailed all of them, not just the state-child closer-finder.

## Locus enumeration (verified by reading)

| locus | scanner | status |
|---|---|---|
| BS raw-body capture | `block-splitter.js` `findStructuralBodyEnd` | FIXED S196 — verified by reading the `g-match-arm-apostrophe-bs` comment at the `'`/`"` branch |
| `<match>` arms | `match-statechild-parser.ts` `findArmCloser` / `findNextArmOpener` | FIXED S196 |
| `<endpoint>` arms (§61) | reuses `parseMatchArms` | inherits the S196 fix — no separate scanner |
| `<onchange>` arms (§38.13) | reuses `parseMatchArms` | inherits the S196 fix — no separate scanner |
| `<engine>` state-children | `engine-statechild-parser.ts` | **BROKEN — fixed here** |
| native parser | `compiler/native-parser/` | NOT affected — its two `inSingle` sites are OPENER/attribute scans, and it has a real body-mode machine (`body-mode.js`, `lex-in-*.js`) |
| `<theme>` (§65) | `parseThemeBody` | different grammar (CSS token bindings), not a markup-prose body |

NOT FIXED, surfaced deliberately: `compiler/src/multi-statement-scan.ts`
`scanForTopLevelSemicolon` also treats `'` as a string delimiter. It is the
same root class but a different failure mode — it only finds `;`, so a phantom
string SUPPRESSES a hit (a false negative for `E-MULTI-STATEMENT-HANDLER`),
never swallows a closer. Out of the brief's closer-scan scope; changing it
risks NEW false positives on legacy JS-shaped attribute values.

## The fix

`skipCommentOrString` and `computeCommentRegions` take a REQUIRED `ScanLocus`
(`"markup-body" | "logic-body"`). 11 sites are `"markup-body"`; the single
`"logic-body"` site is `findOnTransitionCloser`, whose `<onTransition>` body is
effect STATEMENTS (§51.0.H) where `"..."` genuinely is a string literal.
Required-not-defaulted so a future call site must classify rather than inherit.

## Contradiction with the brief — the code-default boundary (verified by execution)

The brief asks for a two-sided negative: a bare apostrophised run directly in a
state-child body "must STILL be a code-default error". It is not one at HEAD,
and it was not one before this fix either:

    <B>it is ready</>     -> compiles CLEAN at base (measured)
    <B>it's ready</>      -> E-ENGINE-STATE-CHILD-MISSING at base (the bug)

`E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) is NOT wired into the live pipeline — grep
finds it only in comments in `type-system.ts` and in the opt-in native parser
(`compiler/native-parser/parse-markup.js`). So the pre-fix rejection of the
apostrophised bare run was an ARTIFACT of the phantom-string bug, not
code-default enforcement. There is no code-default error at this locus to
preserve.

The test therefore pins EQUIVALENCE instead of rejection: the apostrophised
bare run and its apostrophe-free twin must be accepted or rejected
IDENTICALLY. That holds today (both clean) and will still hold if §4.18.7 is
later wired into the live path (both error). What it forbids is the two halves
DIVERGING — which is the only thing a closer-scan fix could have smuggled in.

## Corpus differential (verified by execution)

Method: file-copy flip of `engine-statechild-parser.ts` within ONE checkout, so
both sides share the same `--compiler-root` (avoids the path-derived-token
false-diff). `--allow-same-revision` used as documented.

- Default roots (examples, samples, conformance, stdlib, benchmarks): 1920
  sources / 7427 artifacts -> **VERDICT: NO DIFFERENCES**. 0 artifact content
  diffs, 0 diagnostic changes, 0 compile-failure delta, 0 syntax delta.
- Skipped-population sweep (docs, compiler/native-parser, compiler/self-host-v2,
  compiler/tests/fixtures): 372 sources / 1531 artifacts. 0 artifact content
  diffs; 8 diagnostic "differences" reported. **Those 8 are harness
  nondeterminism, not the fix** — a head-vs-head SELF-diff of the same manifest
  population reproduces the same class (1 code + 4 text-only) on the same
  `compiler/native-parser/*.scrml` files. A direct single-file probe compiling
  `parse-expr.scrml` / `body-mode.scrml` four times each is stable
  (`E-EQ-005,W-TYPE-031-UNPROVEN` every run), so the churn lives in the
  concurrent multi-file capture path, not in per-file compilation.

## Measured migration count (verified by execution)

Repo-wide scan of 2421 `.scrml` files; 164 contain an `<engine>`.
Files with an apostrophe in engine-body prose: **11**. Unpaired `"`: 5.
Backtick: 32. Every one of them compiled identically on both sides of the
differential — i.e. measured blast radius of the newly-accepting change is
**ZERO changed artifacts across 2292 compiled sources**. Not assumed-zero.

## Verification results (all verified by execution)

### Post-fix fixture matrix
Every case in both probe matrices flipped to OK except `S1-eng-dtl-literal-tag`
(`<B>"a literal <tag> and an & ampersand"</>` — the SPEC §4.18.6 worked
example), which fails `E-CTX-003` at BASE as well. It is an UPSTREAM
block-splitter failure (`findStructuralBodyEnd` consumed the literal's `<tag>`
into its tag-stack), unchanged by this fix, and its `<match>` twin fails the
same way. Reported, not fixed — out of scope, and it is a pre-existing
consequence of the S196 ruling at the BS locus.

### Test suites
- New file `compiler/tests/unit/engine-statechild-apostrophe.test.js`: 29 pass.
  Base-flip proof: 21 of the 29 FAIL against the base parser (file-copy flip in
  the same checkout), so the tests genuinely pin the fix.
- Unit tier alone: 18216 pass / 0 fail.
- Conformance + integration: 5062 pass / 0 fail.
- Full `bun run test`, failure SET compared (not counts):
    base 75 failing, head 54 failing.
    NEW in head: **0** (`comm -13` on sorted failure names — empty).
    FIXED in head: exactly the 21 new tests.
  The 54 common failures are all pre-existing whole-suite-interaction cases:
  49 in `compiler/tests/browser/` (documented happy-dom global-state leak — they
  pass per-file), 8 in `compiler/tests/commands/` (the documented dev-server
  wait-budget class the brief said not to read as signal), 1 in
  `compiler/tests/unit/esm-script-tag-module-format.test.js` (whole-suite only).

### types:check
`bun run types:check` output is BYTE-IDENTICAL base vs head (`diff` exit 0):
exit 1 with 12 NEW / 0 GROWN, all the known `ast-if-chain.js` /
`schema-differ.js` / `markup-return-scan.js` TS7016 debt plus two TS7006 and one
TS2352. None name `engine-statechild-parser.ts`. Bar met: the NEW set is
unchanged. `--write` NOT run.

### FACTS currency
`bun scripts/facts.ts --check` was STALE after the fix; `--write` produced a
2-line delta that is exactly this change (249,650 -> 249,743 source lines;
1,435 -> 1,436 test files). Committed.

### R26 empirical
Part 1 — recompile real adopter sources as-is, both sides:
  6nz (external adopter)          11 sources, 9 clean, 22 artifacts, 0 syntax fail
  examples/23-trucking-dispatch   36 sources, 28 clean, 58 artifacts, 0 syntax fail
  examples (in-repo corpus)       71 sources, 61 clean, 140 artifacts, 0 syntax fail
`E-ENGINE-STATE-CHILD-MISSING` occurrences: 0 on BOTH sides. The residual
errors (`E-CODEGEN-INVALID-LOGIC` on component files compiled standalone,
`E-ENGINE-RULE-LEGACY-SYNTAX` in two 6nz playgrounds, `E-ERROR-009`) are
identical base vs head.

Part 2 — the decisive one. Inject `<p>Don't stop</p>` (EXACTLY ONE apostrophe)
into the first state-child body of four real adopter files and recompile:
  BASE: all four fire 3-4x `E-ENGINE-STATE-CHILD-MISSING`; the prose is NOT
        emitted.
  HEAD: all four compile CLEAN, 0 syntax failures, prose emitted verbatim.
⚑ A first pass used `Don't worry — it's fine` (TWO apostrophes) and compiled
clean on BOTH sides — the even-count case. Any future probe of this defect must
use an ODD count or it measures nothing.

## Maps

`.claude/maps/primary.map.md` + `structure.map.md`: **NOT load-bearing** for
this task. Neither file mentions `engine-statechild-parser.ts` or
`match-statechild-parser.ts` at all, and Task-Shape Routing has no row for
markup-body closer scanning, prose-punctuation-as-syntax, or
`E-ENGINE-STATE-CHILD-MISSING`. The one apostrophe hit
(`primary.map.md:674`) is about `E-STATE-BLOCK-STATEMENT-FORM`'s comment
machine and states the correct principle for a DIFFERENT surface — "a tracker
over prose would open a 'string' at every apostrophe and never close it" — i.e.
the map already carries the reasoning that would have diagnosed this bug,
attached to the wrong locus.

Candidate routing row (offered, not written — map edits are out of scope):
"an `<engine>` state-child the compiler reports MISSING when it is plainly
present in source, or any edit to a markup-body closer scan" ->
`engine-statechild-parser.ts` `skipCommentOrString` + its `ScanLocus`; sibling
loci `block-splitter.js` `findStructuralBodyEnd` and
`match-statechild-parser.ts` `findArmCloser`; the invariant is "a markup/state
BODY has no string concept — check the apostrophe COUNT before believing a
repro, because an even count masks the defect."

---

# S402 ADVERSARIAL REVIEW ADJUDICATION — all three findings reproduce, all three fixed

Method for every number here: **file-copy swap of `engine-statechild-parser.ts`
inside ONE checkout**, so exactly one file differs and no path-derived token can
false-diff. Three parser variants are compared:

- **base** = `603d1429` (pre-fix)
- **cut-1** = `d82eb2c2` (my first fix — dropped `'`, `"` and backtick together)
- **ship** = the landed fix (drops `'` and backtick only, plus `skipOpaqueSpan`)

## First: the coordinator's "blind probe" claim does NOT reproduce

The coordinator reported that calling `parseEngineStateChildren` directly gave
`["A","B"]` on BOTH base and head for the apostrophe input, concluded the method
was blind, and told me to discount all unit numbers. Re-run on their exact
string (`<A rule=.B><p>go</p></>\n<B><p>it's ready</p></>`, no indent, no leading
newline), same swap method:

    base   ["A"]
    cut-1  ["A","B"]
    ship   ["A","B"]

It differs. The method is sound; that particular execution of it was not — most
likely the swap did not take on one of the two runs. **This matters beyond
bookkeeping: the coordinator's end-to-end numbers were then trusted over the
unit numbers, and it is the END-TO-END fixture that was measuring the wrong
thing** (see finding 1). Verified by execution, three variants, one checkout.

## FINDING 3 (filed LOW — it is a real parser regression) — `"` MUST KEEP ITS SPAN

The reviewer is right and my first cut was wrong on the governing text. SPEC
§4.18.3 is CHARACTER-specific, not body-specific:

> "The double-quote is the **only** display-text-literal delimiter … The
> apostrophe `'` is an **ordinary interior character** … The backtick is
> likewise an ordinary interior character and is NOT a display-text delimiter."

And §4.18.1 makes a state-child body **code-default**, so `"…"` there IS a
delimited display-text literal. I had generalized the `<match>` sibling's
wording ("a markup-text body is TEXT with no string concept"), which drops `'`
and `"` together — that formulation does not transfer to this locus.

Measured (`parseEngineStateChildren`):

| input | base | cut-1 | ship |
|---|---|---|---|
| `<A rule=.B>"Wrap it in a <p> tag"</>` | `["A"]` | **`[]`** — state-child LOST | `["A"]` |
| same + a following `<B>` sibling | `["A","B"]` | **`["B"]`** — `<A>` LOST | `["A","B"]` |
| `"Just prose"` control | `["A","B"]` | `["A","B"]` | `["A","B"]` |

The reviewer's note that it is masked end-to-end by an upstream `E-CTX-003` is
CONFIRMED (both base and cut-1 report `E-CTX-003` for the full-compile form) —
but the parser-level divergence was real and rested on a misread, so it is
closed rather than deferred.

## FINDINGS 1 + 2 are ONE bug — an ACCIDENTAL shield, removed without notice

Finding 2 is the mechanism; finding 1 is the observable consequence. The
walker scanners (`findStateChildCloser`, `findEngineCloser`) never step INTO an
opener — they hand it to `findOpenerEnd` and resume past its `>`, and they skip
`${…}` explicitly. **Two scanner families here have neither protection** and
walk byte-by-byte: `computeCommentRegions` (the mask behind the `<onTimeout>` /
`<onIdle>` regex scans) and the `while (scanned < lt)` re-scan loops. The only
thing keeping THOSE out of an attribute value was the string-span skip.

Measured end-to-end through `compileScrml`, marker = the emitted timer/handler.
**Every cut-1 loss is silent: exit 0, zero diagnostics.**

| fixture (element follows the token) | base | cut-1 | ship |
|---|---|---|---|
| `<a href="//cdn.example.com/x">` + `<onTimeout>`, SAME line | T5000 | **LOST** | T5000 |
| `<a href="//cdn…">` + `<onTimeout>`, NEXT line | T5000 | T5000 | T5000 |
| `<a title="a /* b">` + `<onTimeout>` | T5000 | **LOST** | T5000 |
| `<a title="a <!-- b">` + `<onTimeout>` | T5000 | **LOST** | T5000 |
| `<a title="a // b">` + `<onTimeout>` | T5000 | T5000 | T5000 |
| `${ ["/* x"].join("") }` + `<onTimeout>` | T5000 | **LOST** | T5000 |
| `<a title="a /* b">` + engine-root `<onIdle>` | I9000 | **LOST** | I9000 |
| `<a title="a /* b">` + `<onTransition>` | TRANS | **LOST** | TRANS |

⚑ **Why the coordinator's end-to-end probe missed it.** They injected into
`engine-005-ontimeout-basic.scrml` and counted `_timers=24` across the whole
file; a same-line-vs-next-line split was the only variable they moved. The
line-sensitivity they DID observe is real and is the tell: `//` consumes to
end-of-line (so a next-line element survives) while `/*` and `<!--` consume to
EOF (so line position is irrelevant). Their `/*` and `<!--` fixtures should have
dropped and did not — the injection did not land inside the same state-child
body as the token. A minimal isolating fixture reproduces every row above.

## The residual, measured rather than assumed

Restoring the `"` span alone closes all eight rows — but by luck, not structure:
every one of those fixtures happens to use a `"`-delimited attribute. Measured
on a `"`-restored build, one quote-character down, the SAME class survives:

| fixture | base | `"`-restored only | ship (with `skipOpaqueSpan`) |
|---|---|---|---|
| `<a title='a /* b'>` (single-quoted attr) | T5000 | **LOST** | T5000 |
| `<a title='a <!-- b'>` | T5000 | **LOST** | T5000 |
| `${ ['/* x'].join("") }` | T5000 | **LOST** | T5000 |
| `${ ['<!-- x'].join("") }` | T5000 | **LOST** | T5000 |
| `` ${ [`/* x`].join("") } `` | T5000 | **LOST** | T5000 |
| backtick in prose (sibling fix) | fail | T5000 | T5000 |
| **apostrophe in prose (THE FILED DEFECT)** | **fail** | T5000 | T5000 |

So the fix is two parts, and both are load-bearing:

1. **`"` keeps its span at every locus** (§4.18.3 + §5.1). `'` and backtick lose
   theirs at markup-body loci. That is the entire net change from base.
2. **`skipOpaqueSpan`** — a `${…}` block and an element opener's attribute
   region are opaque *because of what they are*, not because of which quote
   delimits them. Wired into `computeCommentRegions` and both `bodyRaw` re-scan
   loops. The opener mask starts one past the TAG NAME, never at the `<`,
   because the `<onTimeout>` / `<onIdle>` regexes anchor `m.index` there — a
   test pins that a genuine opener still fires while a mention inside another
   element's attribute value still does not.

## Reconciling the brief, my first report, and the review

Three claims that all looked mutually exclusive are in fact on three
independent axes, and each is true:

- **The brief:** a state-child body is code-default. TRUE — SPEC §4.18.1.
- **My first report:** nothing enforces it. TRUE — `E-UNQUOTED-DISPLAY-TEXT`
  (§4.18.7) is absent from the live pipeline; a bare prose run compiles clean.
- **The review:** `"` still has a delimiter role there. TRUE — §4.18.3, and it
  is the PARSER's span handling, not the diagnostic.

My error was collapsing axis 2 into axis 3: measuring that the code-default
*rule* is unenforced, and concluding the body could be scanned as free text.
The equivalence pin from the first cut stands unchanged and is still the right
shape for axis 2.

## NOT FIXED — filed as its own gap, with the measurement

An unpaired `"` in **nested free-text prose** — `<p>The 6" pipe</p>` or
`<p>She said "hi</p>` inside a state-child body — still fails
`E-ENGINE-STATE-CHILD-MISSING`, **identically to base** (verified by execution
on both variants). §4.18.1/§4.18.2 say that nested `<p>` body is free-text, so
the inch mark IS display text and it SHOULD compile. Closing it needs body-mode
NESTING state that `computeCommentRegions` and the re-scan loops do not carry —
and approximating it by deleting the delimiter is exactly what produced findings
1 and 3. A test pins the current boundary with the reasoning attached rather
than silently leaving it unmarked.

Second gap, also pre-existing and unrelated to this change: an **unterminated**
display-text literal in a state-child body (`<B>"Don't panic</>`) surfaces
`E-ENGINE-STATE-CHILD-MISSING` where §4.18.3 says it should be `E-CTX-001`
against the opening `"`. Base and ship behave identically.

## Re-verification after the revision (all verified by execution)

- **Three-way table** — odd / even / control all compile; prose emitted verbatim.
- **Equivalence pin** — bare apostrophised run and its apostrophe-free twin have
  identical acceptance.
- **True negative** — `E-ENGINE-STATE-CHILD-MISSING` still fires on a genuinely
  absent `<B>`, both with and without apostrophised prose in the siblings.
- **Artifact inertness** — corpus differential base vs ship, same
  `--compiler-root`, 1920 sources / 7427 artifacts: **NO DIFFERENCES** (0
  content diffs, 0 diagnostic changes, 0 compile-failure delta, 0 syntax delta).
- **Full `bun run test`** — 54 failing, and the failure SET is byte-identical to
  the pre-existing baseline: 0 NEW, 0 GONE (`comm` both directions empty).
- **Unit tier** 18260 pass / 0 fail. **Conformance + integration** 5062 / 0.
- **`types:check`** — output **byte-identical to base** (`diff` exit 0); exit 1
  with the same 12 NEW pre-existing diagnostics, none naming this file.
- **R26 part 1** — 118 real adopter sources, 220 artifacts, 0 syntax failures, 0
  occurrences of the symptom; identical to base.
- **R26 part 2** — single-apostrophe injection into four real adopter files:
  base fires 3-4x `E-ENGINE-STATE-CHILD-MISSING` and drops the prose; ship
  compiles clean and emits it.
- **FACTS** — `bun scripts/facts.ts --check` refreshed and committed.

Test file: **44 tests** (was 29), covering the three-way table, real UI
contractions, the backtick sibling, per-scanner coverage, the code-default
equivalence pin, the `"`-span scope fence (finding 3), and the
attribute/logic-interior opacity cases (findings 1+2).
