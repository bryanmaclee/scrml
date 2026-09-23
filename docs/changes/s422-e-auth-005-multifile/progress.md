# s422-e-auth-005-multifile — progress (append-only)

## 2026-09-18 — startup

- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a805878ba0507a16b`,
  branch `worktree-agent-a805878ba0507a16b`, cut from `origin/main` @ `f95321bf` (verified
  `git log --oneline -1 origin/main` == HEAD).
- `bun install` OK (218 packages). `bun run pretest` OK — artifacts verified present in
  `samples/compilation-tests/dist/` (13 samples), not trusted on exit code alone.

## 2026-09-18 — maps

Read `.claude/maps/primary.map.md` (1452L, watermark `787d4cb4`). Task-Shape Routing scanned;
no row names `E-AUTH-005` / `<var server>` / §52 authority. The load-bearing row is
**"WHAT KIND OF FILE IS THIS?" — FILE-SHAPE / ENTRY-NESS**, which routes to
`compiler/src/library-shape.js` as the SINGLE SOURCE for "does this file declare a top-level
`<program>`?" and warns that four hand copies of that question were deleted into it at
`85ebbb5f` (#859). That directly shaped the fix: the new predicate consults the existing
`findTopLevelProgramNode` (already imported into `type-system.ts`) rather than hand-spelling a
fifth copy. The row's second warning — `buildAST(...).ast.fileShape` is `undefined` BY DESIGN,
stamped only at the Stage 3.004 PRECG seam — is why the fix does NOT read the stamped
`fileShape` field from the type-system stage.

## 2026-09-18 — defect reproduced by execution (premise verified, not relayed)

Probe matrix compiled at `f95321bf`. Each file carries one `<var server>` decl + a markup read.

| probe | file shape | diagnostics at `f95321bf` |
|---|---|---|
| p1 | `<program db="./probe.db">` (single file) | **clean** (`W-PROGRAM-SPA-INFERRED`, `W-SQL-ROW-UNTYPED`) |
| p2 | `<program title="Dashboard">` (no `db=`) | **`E-AUTH-005`** — correct, this is conformance `auth/auth-005-pos` |
| p3 | bare `<page>` + `<notes server> = ?{…}` | **`E-AUTH-005` + `E-SQL-004`** |
| p4 | `<page>` + `<db src="./probe.db">` block | **`E-AUTH-005`** (only error) |
| p5 | bare markup, no `<page>`, no `<program>` | **`E-AUTH-005`** |

So the defect is NOT specific to `<page>` files: **every** file that does not itself carry a
top-level `<program db=>` false-fires, including a page that declares its own `<db src=>`
database (p4) — the corpus-canonical multi-file page shape (`examples/23-trucking-dispatch`
uses exactly `<db src="../../dispatch.db">` inside each page).

Locus hypothesis from the brief HELD: `hasProgramDbAttr` (`compiler/src/type-system.ts:8516`),
sole caller at `:11488`. Confirmed by grep — exactly two occurrences in the file.

Also measured (NOT in scope; surfaced): `<page db="…">` fires
`W-ATTR-001: Attribute 'db=' is not recognized on '<page>'` and has **no compile-time effect**,
while §40.8 and `E-PAGE-INVALID-ATTR` both list `db=` as one of the five legal per-route
`<page>` attributes. The attribute registry and the page-attr validator disagree.

## 2026-09-18 — THE GOVERNING-SENTENCE GATE → **OUTCOME 1** (conformance restoration)

Sections searched: §52.11, §52.4.2, §52.4.4, §40.8, §40.8.1, §40.8.2, §39.12.0, §38 (channel
placement), §4.12.2, §4.15/§20.8.4 (via the §34 `E-PAGE-INVALID-ATTR` row), §58.8/§58.9, §12.
Four sentences that ALREADY EXIST govern this, quoted verbatim:

1. **§40.8 (`SPEC.md:23458-23459`)** —
   > "A scrml **application** SHALL declare its top-level `<program>` element exactly ONCE, in
   > the application's **entry file**. The entry file is the file resolved by the build root
   > (e.g. `app.scrml` in a single-file app, or the source root of the compilation)."
   > "The `<program>` declaration SHALL NOT appear in any non-entry file of the same
   > application."

2. **§58.8 (`SPEC.md:36248`)** —
   > "A `<page>` (§40.8) is **not a separate compilation unit — it shares the application
   > `<program>` scope** — so a per-`<program>` build story does not extend to it."

3. **§39.12.0 (`SPEC.md:23022-23024`)** —
   > "Under v0.3 (one-program-per-application), `<schema>` files and seed files that are NOT
   > routes (i.e. **not the entry file's `<program>` and not a route file's `<page>`**) need
   > somewhere to anchor a `db=` target."
   The db-anchor workaround is scoped to files that are NEITHER the entry `<program>` NOR a
   route file's `<page>` — i.e. SPEC already treats a route file's `<page>` as db-anchored.

4. **§38 (`SPEC.md:21729`)** —
   > "Channel state lives at the file scope established by `<program>` and is **reachable from
   > inside any `<page>` via canonical `@` access**."

Together: §40.8 FORBIDS a `<program>` in a non-entry file, and §58.8 puts that file inside the
application `<program>` scope. A predicate that requires a `<program db=>` in the CURRENT file
is therefore unsatisfiable by any conforming non-entry file — the check refuses exactly the
shape §40.8 mandates. Restoring it is conformance restoration under base §8, not a widening.

Corroborating (non-normative but confirming the intent): §40.8's own worked example shows the
entry file at `<program title="My App" db="./app.db" …>` and then says *"Adjacent route files
(e.g. `pages/customer/loads.scrml`) declare their `<page>` openers without re-declaring
`<program>`"*, with the adjacent-file example carrying no `db=` at all.

## 2026-09-18 — existing attempt on `fix/e-auth-005-multifile-page-server-context`

Fetched; tip `840eb5a1`, 3 commits (`8e53414b` fix, `ddeff2c8` test, `840eb5a1` @generated
regen), NOT an ancestor of `origin/main`. Read in full.

Its fix is `hasServerContext = hasProgramDbAttr(f) || fileHasDbStateContext(f)`, where
`fileHasDbStateContext` (new, in `codegen/collect.ts`) finds a `<db src=>` state block.

**It does not close the reported defect.** It fixes p4 only. The brief's own repro is p3 — a
bare `<page>` with `<notes server> = ?{…}` and no `<db src=>` — and p3 still false-fires under
that patch, as do p5 and every `<page>` file that leans on the entry file's `db=`.

DECISION: **re-implement, salvaging one part.** `fileHasDbStateContext` is sound and correctly
keyed on `collectDbScopes`'s Form-2 shape, so it is carried over verbatim in intent. The
`hasServerContext` disjunction is replaced by a three-valued predicate that also answers the
"file declares no `<program>` at all" case, which is the case the brief reported. Rebasing the
old branch was not worth it: 191 commits of drift for a 2-file patch whose central predicate
is being replaced anyway.

## 2026-09-18 — the fix, and why it is not the one the old branch wrote

The old branch's `hasProgramDbAttr(f) || fileHasDbStateContext(f)` is still file-local.
It accepts a page that declares its OWN `<db src=>` and refuses everything else — so the
brief's own repro (a bare `<page>` leaning on the ENTRY file's `db=`) still fails under it.

**`runTS` already receives the whole file set** (`input.files`) from `api.js:2280`. So the
application-scope fact is computable today with no new plumbing on the CLI/build path.

> ⛔ **CORRECTED 2026-09-19 — this paragraph originally read "from `api.js:2280` and from
> `lsp/handlers.js:363` alike", AND THAT WAS FALSE.** `lsp/handlers.js:335` is
> `const files = [tabResult];` — the single open document, never the workspace. The same false
> claim was written into the source docstring, from which it propagated into a review before
> anyone re-read `handlers.js`. Struck here rather than silently rewritten, for the same reason
> it was corrected-in-place rather than deleted in source: the next reader should see that it
> was checked. Full disclosure in the round below.

Landed as:

- `codegen/collect.ts` — NEW `fileHasDbStateContext` (carried from the old branch, re-documented).
  Keyed on `collectDbScopes`'s Form-2 shape `{kind:"state", stateType:"db"}` so the predicate
  agrees with what codegen EMITS instead of restating it. One deliberate divergence, stated in
  source: this walk also descends `node.body`, making it a SUPERSET, which can only ever suppress
  the diagnostic — the safe direction for a false-positive repair.
  *(Superseded 2026-09-19: the `node.body` descent was DROPPED in the fix round, and the review
  then showed it had been structurally unreachable all along — `body` is `LogicStatement[]` at
  all 13 declaration sites. Two further divergences that this entry did not name — a missing
  `src=` check and no nested-`<program>` fence — were live defects; see the fix round.)*
- `type-system.ts` — `hasProgramDbAttr` RETIRED (it fused two different questions into one
  boolean) and replaced by the node-level `programNodeHasDbAttr` + `fileEstablishesServerContext`
  (Form 1 or Form 2) + `compilationUnitHasServerContext(files)`. Computed ONCE in `runTS`,
  threaded `runTS -> processFile -> annotateNodes`. `processFile`'s parameter is optional and
  falls back to the single-file answer — NOT to `true`, which would silently disable the
  diagnostic for any future caller that forgets the argument.
- "Does this file declare a top-level `<program>`?" reuses `findTopLevelProgramNode`, already
  imported into `type-system.ts`. No fifth hand copy of the entry-ness question (#859 folded four
  into `library-shape.js`). The STAMPED `fileAST.fileShape` is deliberately NOT read — it is
  stamped at the Stage 3.004 PRECG seam, AFTER TS, so reading it here degrades silently.

**A WIDER UNIT, NOT A WEAKER TEST.** An app with no `db=` anywhere still has no server context
and still fires, at every file shape.

## 2026-09-18 — both-direction results

| probe | before | after |
|---|---|---|
| p1 `<program db=>` single file | clean | clean |
| p2 `<program title=>` no db | **E-AUTH-005** | **E-AUTH-005** (unchanged — correct) |
| p3 bare `<page>` compiled ALONE | E-AUTH-005 + E-SQL-004 | **E-AUTH-005 + E-SQL-004** (unchanged — the unit IS the file, and it has no db) |
| p4 `<page>` + `<db src=>` | **E-AUTH-005** | **compiles clean** |
| p5 bare markup, no db | E-AUTH-005 | E-AUTH-005 (unchanged — correct) |
| **two-file app compiled as ONE unit** (`app.scrml` `<program db=>` + `pages/notes.scrml` `<var server>`) | **E-AUTH-005 + E-SQL-004** | **E-SQL-004 only** |

Tests: `compiler/tests/unit/e-auth-005-application-scope.test.js` (7 cases). ADVERSARIALLY
VERIFIED — on the unfixed compiler **3 of 7 FAIL and 4 PASS**; the 4 that pass on both sides are
the regression guards, so the file is not a restatement of the new behaviour.
Conformance: `auth/auth-005-db-context-neg` NEW. Also adversarially verified — **905/906 with 1
FAILED on the unfixed compiler**, 906/906 after.

## 2026-09-18 — R26 empirical + direction classification

`bun scripts/corpus-emit-differential.ts`, base vs head, **1,929 sources / 7,470 artifacts**:

```
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        1 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7470 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  load-context changes      0
  bare server-fn sites      base 146 / head 146 (delta 0)
```

The ONE diagnostic change is the conformance fixture added by this arc
(`auth-005-db-context-neg`: `E-AUTH-005` dropped). **Nothing else in the corpus changed at all.**

Named-app R26 (`before` vs `after` diagnostic census, `diff` = EMPTY):

| app | before | after |
|---|---|---|
| `examples/22-multifile` | 4 W-TAILWIND-UNRECOGNIZED-CLASS, 1 W-TYPE-031-UNPROVEN, 1 W-PROGRAM-SPA-INFERRED, 1 I-FN-PROMOTABLE — compiled 3 files | identical |
| `examples/23-trucking-dispatch` | 321 W-TYPE-031-UNPROVEN, 37 W-IF-IN-EACH, 20 W-ATTR-001, 17 W-TAILWIND, 11 I-FN-PROMOTABLE, 6 W-SQL-ROW-UNTYPED, 3 W-INTERP-IN-RAW-CONTENT, 2 I-PROTECT-STRIP-001, +5 singletons — compiled 36 files | identical |
| `benchmarks/fullstack-scrml` | 3 W-DEAD-FUNCTION, 1 W-PROGRAM-SPA-INFERRED — compiled 1 file | identical |
| `benchmarks/per-route-roles` | 8 W-AUTH-CONTENT-NOT-GATED, 5 W-PROGRAM-SPA-INFERRED, 4 I-AUTH-REDIRECT-UNRESOLVED, 1 W-AUTH-LOGIN-MISSING — compiled 5 files | identical |

None of the four uses `<var server>` in a non-entry file — they could not, it was refused — so
zero delta is the expected and correct result, and it is a BLAST-RADIUS measurement, not demand
evidence (reverse-ouroboros rule).

**DIRECTION (base §8), stated on both axes:**
- against EXISTING SOURCE: **inert** — artifacts identical, no diagnostic delta, measured.
- against the CONTRACT: **newly-accepting, TOWARD the contract (conformance restoration)**. The
  governing sentences pre-date the change and are quoted above; per base §8 that is the
  "quote the sentence and ship it" branch, not the deliberation ladder.

No SPEC edit is required: neither §34's `E-AUTH-005` row (`SPEC.md:20065`) nor §52.11's
(`SPEC.md:33111`) says the unit is the file. The implementation was narrower than the text.

## 2026-09-18 — what newly compiles BEYOND the reported shape (reported, not absorbed)

1. A `<var server>` in a single file with a `<db src=>` but NO `<program db=>` (the p4 /
   trucking-dispatch shape). Correct — codegen connects a real database — but broader than the
   brief's "multi-file page" framing, so it is named.
2. A `<var server>` in a genuinely client-only COMPONENT file of an app that HAS a db. §52.11's
   own trigger is "a component with no server context", and such an app HAS one — but this is a
   real narrowing of the diagnostic's reach and should be seen rather than discovered later.
   `W-AUTH-001` ("no detected initial load") still fires on these cells.
3. Nothing else: measured at 0 of 1,929 corpus sources.

## 2026-09-18 — OUT OF SCOPE, SAME DEFECT CLASS (not fixed; surfaced)

- **`E-SQL-004` has the identical file-local defect at CG.** `collectDbScopes`
  (`emit-server.ts:745`) resolves `db=` from the CURRENT file only, so a page that leans purely
  on the entry file's `db=` with a bare inline `?{}` still fails. **Consequence: the brief's
  motivating claim is only PARTLY restored** — a multi-file page that carries its own `<db src=>`
  now compiles end-to-end, but a page with no db anchor at all still does not. Closing it needs
  cross-file db resolution at CG, which is a separate arc.
- **`<page db="…">` is inert and contradicts its own SPEC.** It fires
  `W-ATTR-001: Attribute 'db=' is not recognized on '<page>'` and has no compile-time effect,
  while §40.8 and the `E-PAGE-INVALID-ATTR` row both list `db=` as one of the five legal
  per-route `<page>` attributes. Measured, not inferred. The attribute registry and the
  page-attr validator disagree.
- **`E-PROGRAM-002` is still reserved-not-implemented**, so §40.8's "SHALL NOT appear in any
  non-entry file" is unenforced. That does not affect this fix (which does not depend on
  uniqueness) but it is the reason the entry file cannot be identified structurally.

## 2026-09-18 — verification

- New unit file: 7/7 pass (3 fail on base — adversarially verified).
- Conformance: **906/906 CASES** — command `bun conformance/run.ts` (was 905/905 + my new case;
  905/906 with 1 FAILED on base). ⚑ **NOT the same unit as the 907 a reviewer measured** — see
  the reconciliation in the disclosure round below. Both figures are correct.
- **`bun test compiler/tests/{unit,integration,conformance}`** — the PRE-COMMIT SUBSET, 1,323
  files. ⚑ **NOT the whole `compiler/tests/` tree (1,475 files); it excludes the browser, lsp,
  commands and self-host tiers.** Naming the command is the point — see the disclosure round.
  **BEFORE (pristine `f95321bf`, my test files moved aside): 23,996 pass / 0 fail / 70 skip.**
  **AFTER: 24,005 pass / 0 fail / 70 skip.** Both measured, not assumed.
- `bun scripts/types-gate.ts --check`: reports `15 NEW` — **PRE-EXISTING**, confirmed by running
  the identical command on pristine source (identical 15). My change contributes none; every
  entry is message-text ordering noise (union member order / `...29 more...` field order).
- Browser tier `bun test compiler/tests/browser/`: **773 pass / 48 fail on BOTH sides**, after
  re-running `bun run pretest` on each side first (the fixtures go stale). Byte-identical
  failure set — entirely pre-existing at `f95321bf`, not a regression from this arc.
- No `--no-verify`, no `core.hooksPath` override. Every base-vs-build flip was done by FILE COPY;
  `git stash` was never used.

## 2026-09-19 — S239 ADVERSARIAL REVIEW: LAND-WITH-FINDINGS, fix round

Three of the findings were this change's OWN doing, not pre-existing. Every one was
re-reproduced here before being touched — and re-run on `f95321bf` to confirm it was a
regression rather than a pre-existing condition. Harness:
`/tmp/.../scratchpad/repro-findings.mjs` (drives `compileScrml` and `analyzeText` directly).

| finding | on `f95321bf` | on `fc27fbe8` (first cut) | after `f027c71e` |
|---|---|---|---|
| 1 — LSP vs CLI on the flagship shape | agree (both fire) | **DIVERGENT** (CLI green, LSP red) | divergent, now DOCUMENTED |
| 2 — `<db src=>` only inside a nested `<program>` | fires (correct) | **does not fire** | **fires** |
| 3 — `<db>` with no `src=` | fires (correct) | **does not fire** | **fires** |
| 4 — two independent apps, one invocation | fires (correct) | **does not fire** | does not fire — SEPARATE ARC |

### FINDING 2 — FIXED. Form 1 and Form 2 disagreed about nesting; Form 1 was right.

`fileEstablishesServerContext`'s Form-1 half is top-level-only and the docstring justified
that on §4.12.1 (a nested `<program>` is a SEPARATE compilation unit). `fileHasDbStateContext`
had no such fence. So ONE docstring described a rule only HALF the predicate obeyed — the worst
kind of comment, because it reads as covering both. Now fenced with an `insideProgram` flag:
descend the file's own top-level `<program>`; skip any `<program>` below one whole.

### FINDING 3 — FIXED IN THE PREDICATE, not in the claim.

`collectDbScopes` requires `typeof srcVal === "string" && srcVal.length > 0`; the predicate
never read `src` at all. A bare `<db tables="…">` suppressed `E-AUTH-005` while codegen
connected nothing. The reviewer's framing is the important part and is recorded in-source: it
was not exploitable, because that shape independently raises `E-PA-006` — but **the predicate's
soundness rested on an unrelated diagnostic and nothing said so.** The `src=` extraction is now
a line-for-line mirror of `emit-server.ts:769-775`.

**The "one deliberate divergence" sentence is now TRUE rather than repaired by hand-waving.**
The `node.body` descent it named has been DROPPED (matching `collectDbScopes`' children-only
walk), leaving exactly one divergence — the §4.12.1 nested-program fence — stated with its
reason AND its direction: it makes the predicate NARROWER, i.e. erring toward FIRING, which is
the conservative side for a check whose job is to refuse a context that is not there. Measured:
dropping `body` changed nothing on the corpus.

Six new PREDICATE-LEVEL tests (`fileHasDbStateContext — direct`) exist specifically because of
this finding: they prove the predicate is sound ON ITS OWN rather than leaning on whichever
other code rejects the same shape.

### FINDING 1 — DOCSTRING CORRECTED; WIRING DELIBERATELY NOT DONE, AND THE REASON IS NOT SCOPE.

The claim "`runTS` already receives the whole file set … from `api.js` and from
`lsp/handlers.js` alike" was FALSE. `lsp/handlers.js:335` is `const files = [tabResult];` — the
single open document. Verified by reading; the divergence verified by execution (the page this
arc's flagship test asserts compiles green is red-squiggled in the editor). **It propagated
into a review before anyone re-read `handlers.js`**, which is the whole argument for correcting
it in place rather than deleting it.

I did NOT wire the LSP, and this is a judgement, not a scope dodge: `analyzeText`'s `workspace`
cache (`lsp/workspace.js` `fileASTMap`) holds every `.scrml` under the workspace ROOT. In any
repo with more than one application — this one has hundreds — handing `runTS` that set lets app
A's `db=` suppress `E-AUTH-005` across app B. **That trades a false RED for a false GREEN, the
strictly worse direction.** The import graph is no help either: a page does not import its
entry — that is the defect itself. Current state fails SAFE (over-fires; a false red, never a
missed one).

### FINDING 4 — ASSESSED, NOT DECIDED UNILATERALLY: **SEPARATE ARC**, and it is the SAME arc as finding 1.

Partitioning the unit by top-level `<program>` is **not cheap here**, and the reason is
structural rather than effort:

- §40.8 defines the entry as *"the file resolved by the build root"* — a **BUILD** fact. The
  nav-map states the same rule from the code side and explicitly forbids substituting
  `getFileShape(f) === "program"` for it.
- `E-PROGRAM-002` (one-`<program>` uniqueness) is **reserved-not-implemented**, so a second
  top-level `<program>` in a unit is silently ignored today. The compiler cannot currently
  detect that it is holding two applications.
- There is no edge from a page file to its entry. Not the import graph (a page does not import
  its entry), and directory containment is not normative — using it would be inventing
  semantics, which is the failure mode this arc is supposed to be fixing.

So a correct partition needs a build-root entry resolver over the file SET. **Finding 1 needs
the same object** — that is why they are one arc, not two. Recommend filing them together.

Bounded harm, measured: a leaked `<var server> = ?{…}` still fails `E-SQL-004`, so only a
LITERAL-RHS server cell silently loses its diagnostic, and `W-AUTH-001` still fires on it.

### FINDING 5 — E-SQL-004, sharpened as asked (NOT fixed).

The earlier entry said the shared-scope page still fails `E-SQL-004`. The sharpening changes how
the arc reads and is worth stating plainly: **the remaining advice is impossible to follow.**
`E-SQL-004`'s message is *"Add a `db=` attribute to the enclosing `<program>` element"* — in a
file where §40.8 forbids a `<program>` from existing at all. So a multi-file page that relies on
the shared application scope goes from two errors to **one impossible-to-action error**. It is
not "one error closer"; it is an error whose own remedy the layout prohibits. The honest summary
of this arc's reach: the page shape that works end-to-end is the one carrying its own
`<db src=>`; the shape that leans purely on the entry's `db=` is still blocked, now by a
diagnostic that misdirects.

### Re-verification after the fix round

- Unit file: **15/15** (was 7). **5 of the added cases FAIL against the first cut (`fc27fbe8`)** —
  adversarially verified, so they are load-bearing rather than restatements.
- Conformance **906/906 cases** (`bun conformance/run.ts`). **`bun test
  compiler/tests/{unit,integration,conformance}` — the PRE-COMMIT SUBSET, NOT the whole tree —
  24,013 pass / 0 fail / 70 skip** (baseline 23,996/0). Whole-tree figures in the disclosure
  round below; the "0 fail" above is true of the subset only and must not be read as a
  full-gate claim.
- `types-gate --check`: 15 NEW — unchanged, pre-existing, confirmed identical on pristine source.
- **Corpus differential RE-CAPTURED ON BOTH SIDES.** The first base manifest predated an edit to
  this arc's own fixture, so base-vs-head compared two different SOURCES and reported spurious
  artifact/syntax deltas — a wrong-referent comparison, caught and redone rather than reported.
  Clean run over **1,929 sources / 7,471 artifacts**: 0 artifact-content diffs, 0 newly failing,
  0 syntax deltas, 0 load-context changes. Every remaining delta is this arc's own fixture
  (`E-AUTH-005` dropped; base exit 1 -> head exit 0; +4 bare server-fn sites, which is just the
  fixture entering the cleanly-compiling population).
- R26 four named apps: **IDENTICAL on both sides.**

⚑ **AN R26 MEASUREMENT TRAP, RECORDED BECAUSE IT NEARLY BECAME A FALSE REGRESSION REPORT.**
`examples/23-trucking-dispatch` ships a tracked `dispatch.db` and **compiling it MUTATES that
db**, so `W-TYPE-031-UNPROVEN` / `W-IF-IN-EACH` counts shift between consecutive runs
independently of any compiler change. One census read `321 -> 244` and looked exactly like a
regression. Three repeat runs returned 321 every time, and base-vs-fix against a settled db were
byte-identical. **Compare both compilers against the SAME db state, or the probe measures the
database rather than the change.**

## 2026-09-19 — S239 DISCLOSURE ROUND (no logic changed)

Re-review cleared the fix round and asked for two disclosures plus one doc-accuracy correction.
Both items re-derived here BY EXECUTION at the tip before being written down.

### ITEM 1 — the nested-`<program>` over-fire the fence introduced. DISCLOSED.

```scrml
<program title="Outer3">
<h1>Outer</h1>
<program name="worker">
  <db src="./worker.db" tables="jobs"></db>
  <count server> = 0          <!-- E-AUTH-005 fires. It should not. -->
  <p>${@count}</p>
</program>
</program>
```

**Cause is the UNIT, not the fence.** `compilationUnitHasServerContext` yields ONE boolean per
compilation and the fire site applies it to EVERY `<var server>` regardless of which `<program>`
scope the cell is in — so fencing the worker's database OUT also strips server context FROM the
cells inside that worker. **It contradicts this arc's own opening invariant**: codegen really
does connect `./worker.db` for that file while the predicate reports client-only.

Direction: **over-fire (fail-safe)**. **Blast radius: ZERO** corpus sources. **Real fix:
per-`<program>`-scope resolution**, which is the same build-root-entry-resolver arc as findings
1 and 4 — all three want one object, and that is the argument for filing them together.

Now written next to the fence in `codegen/collect.ts`, with a worked example, and pinned by
`DISCLOSED OVER-FIRE:` in the unit file — a deliberate **tripwire**: it asserts a KNOWN-WRONG
verdict so that landing scope resolution FAILS the test and tells the author to delete it,
rather than the behaviour changing silently.

**THE CALL, RECORDED — because it was a decision, not a discovery.** MEASURED across three
revisions, both spellings of the same shape:

| shape | `f95321bf` (main) | `fc27fbe8` (first cut) | `bf8d7a17` (tip) |
|---|---|---|---|
| nested `<program>` + `<db src=>` | **FIRES** | silent | **FIRES** |
| nested `<program db="…">` | **FIRES** | **FIRES** | **FIRES** |

So Form-1/Form-2 consistency was reached by **EXTENDING a known defect to the second spelling
rather than narrowing it out of either.** Defensible — two spellings of one shape disagreeing is
worse than both being wrong the same way, and over-fire fails safe — but the alternative (fix
both now) was DEFERRED, not overlooked.

⚑ **One correction to the review's framing, and it cuts in my favour so it is stated carefully:
relative to `main` the fence introduces NO new over-fire — `f95321bf` fires on this shape too.**
It is new only relative to `fc27fbe8`, which silenced it. The disclosure obligation is unchanged
either way, because the docstring named none of this.

### ITEM 2 — the test figure. RECONCILED BY EXECUTION; it was a SCOPE difference, as suspected.

Both figures are correct; they are different commands over different populations.

| command | files | result |
|---|---|---|
| `bun test compiler/tests/{unit,integration,conformance}` (what I ran — the pre-commit subset) | 1,323 | **24,013 pass / 0 fail / 70 skip** over 24,093 |
| `bun test compiler/tests/` (what the reviewer ran — whole tree) | 1,475 | **31,820 pass / 56-57 fail / 249 skip** over 32,137 |

I reproduced the reviewer's figure exactly (31,820 / 249 / 32,137). The extra 152 files are the
**browser, lsp, commands and self-host tiers**, which the pre-commit hook does not run.

**The 56 whole-tree failures are pre-existing — verified by me, not taken on trust.** Normalized
failing-test-name sets at `f95321bf` vs tip: **TIP-ONLY = EMPTY**. Base-only = exactly 2, and
both are THIS ARC'S OWN new tests (they fail at base because the fix is not there). Base 58 /
tip 56, and that difference of 2 is precisely those tests.

⚑ **MY FIRST ATTEMPT AT THAT COMPARISON WAS BROKEN AND I ALMOST REPORTED IT.** I stripped test
names with `sed 's/.*> //'` but left the `[40.31ms]` timing suffix on, which VARIES per run — so
`comm` reported all 56 as "tip-only" and it looked like a catastrophic regression. The fix is
`sed -E 's/ \[[0-9.]+m?s\]$//'` first. **A set-difference over strings carrying a timestamp
compares the clock, not the thing.** Same wrong-referent class as the `dispatch.db` trap above.

**Conformance 906 vs 907 — also a UNIT difference, not a discrepancy. RESOLVED EXACTLY:**
- **906 = CASES.** `bun conformance/run.ts` -> `906/906 cases`; and
  `find conformance/cases -name case.scrml | wc -l` -> `906`. Two independent counts agree.
- **907 = TESTS.** `compiler/tests/conformance/corpus-bridge.test.js` emits one `test()` per case
  (`:46`) **plus one suite-level population guard** — `"corpus is non-empty (cases discovered
  under conformance/cases/)"` (`:35`), an invariant-59-style check that the gate is measuring a
  non-empty population at all. 906 + 1 = 907.

**THE STANDING LESSON, since this arc has now been bitten by the class four times** (stale
`fileShape` line numbers, the fixture-source-mismatch differential, the `dispatch.db` mutation,
and this): **a count is not a fact until its COMMAND and its UNIT are written next to it.** The
two figures above were never in conflict; one said "cases", the other said "tests", and neither
said which. Every figure in this log now carries its command.

### DOC-ACCURACY NIT — accepted and corrected.

The fence claimed to be "THE SAME §4.12.1 RULE FORM 1 ALREADY OBEYS". It is not the same TEST:
Form 1 (`findTopLevelProgramNode`) scans the LITERAL ROOT ARRAY, while the fence propagates an
`insideProgram` flag through arbitrary intervening elements, and §4.12 defines nesting as a
DIRECT child. They rest on the same §4.12.1 GROUND and agree on every exhibited shape, but they
are not one predicate. Reworded to say exactly that, with a note that unifying them is part of
the scope-resolution arc. (Not a regression — identical at `fc27fbe8` — and the propagation
matches `collectDbScopes`' own descent, which is why the direction agrees.)

Also folded in from the review, because it strengthens a claim I had only measured: dropping the
`node.body` descent lost nothing **structurally**, not merely empirically — `body` is
`LogicStatement[]` at all 13 declaration sites, so a db state node was never reachable through a
`body` edge at all.
