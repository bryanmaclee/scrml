# non-compliance.report.md
# project: scrml
# generated: 2026-08-07T15:38:47-06:00  commit: 35d4d32e
# **SOURCE WALK IS AT `6f176c0d`; the stamp is `35d4d32e`, the true HEAD.** `35d4d32e` (#467, the
# S328-bryan wrap continuity) landed DURING this pass and is DOCS-ONLY — verified
# `git diff --name-only 6f176c0d..35d4d32e -- compiler/ scripts/ conformance/ .github/ stdlib/
# package.json` is EMPTY.
# scan mode: INCREMENTAL (S328 pass, prior stamp `97576f35` -> `35d4d32e`)

## Summary — this pass

**The single most consequential finding of this pass is about this map set itself, not about a doc:
the prior stamp was not a commit on `main`.** `97576f35` is the tip of `origin/wrap/s326-bryan`
(PR #459); main carries only its squash, `b7f89952`. `git merge-base --is-ancestor 97576f35 HEAD`
returns **FALSE**. Everything downstream of that stamp inherited the error:

- The refresh brief for this pass named **four** PRs (#463 #464 #465 #466). **Six had landed** —
  **#460 `603ec12f`, a NORMATIVE `SPEC.md` change**, and **#461 `18fc0571`** sat between the mapped
  state and those four, invisible to anyone doing `git log <stamp>..HEAD` arithmetic and reading the
  count as a delta.
- `scripts/state.ts`'s `mapsStaleness()` — the one MACHINE instrument for map currency — **cannot
  detect this and structurally never could.** See N1.
- The dispatch briefs archived this window (`docs/changes/s328-*/BRIEF.md`) each told their agent
  *"HEAD is `18fc0571`; the two commits past the stamp are docs-only, so the map is CURRENT."* That
  sentence was false in a way no reader could check without an ancestry test.

The second-most consequential finding is a **resolution**, and it is a good one: **S326-N1 is
CLOSED.** #460 wrote §12.5's route-handler response contract into `SPEC.md:7353` as a normative
SHALL, ending the "a SHALL that lives only in one implementation's source" state this report has
raised for two consecutive passes. The SPEC bullet says so in its own words.

| | count |
|---|---|
| Tracked `*.md` in scope (outside `archive/`, `handOffs/`, `node_modules/`, `dist/`, `.claude/`) | ~1,400 |
| NEW findings this pass | 3 |
| Carried findings RE-VERIFIED still open | 6 |
| Carried findings **RESOLVED** this pass | 2 (S326-N1, S326-N2) |
| Carried findings WIDENED (same defect, larger measurement) | 1 (S326-N3: 10 → 19 distinct headings) |
| Uncertain — needs human review | 2 (both carried, unchanged) |

**What this report is NOT claiming.** It did not re-walk `docs/website/`, `docs/articles/`, the
`docs/changes/**` archive beyond this window's additions, or the `samples/` / `examples/` READMEs.
Those carry their prior-pass verdicts. This scan was TARGETED at the surface the window's diff could
have falsified: the three codegen files, the §17.2 / §4.14 / §18.5 / §12.5 doc surface, the §34
catalog, the gap ledger, and the map set's own stamp discipline.

**A NEGATIVE worth stating explicitly, because the refresh brief asked for it.** The brief asked to
flag "anything describing #450's reverted behaviour." **There is none outside history.** Every
in-scope mention of the `show=` SSR-hide at this HEAD is either (a) a correctly-labelled historical
record (`docs/changelog.md`, `handOffs/delta-log.md`, `hand-off.md`'s older session sections), or
(b) `docs/known-gaps.md`'s `g-show-false-flashes-pre-hydration`, which **explicitly records the S328
revert and the four reasons for it** and is the most current text on the subject in the repo. The
stale copies were in **the maps**, and they are corrected in this pass — see "Map corrections
applied" below.

---

## NEW this pass

### S328-N1. `scripts/state.ts`'s map-staleness instrument reports a commit COUNT with no ancestry check — it cannot detect an off-main watermark, and it is WARN-only

**Reason:** the tool's contract and its behaviour disagree; grep-verified at source.
**Severity:** MEDIUM-HIGH as a process defect. It is the only automated guard on map currency.
**Detail:** `scripts/state.ts:458-470`.

```
const line3 = mapText.split("\n")[2] ?? "";
const wm = line3.match(/commit:\s*([0-9a-f]+)/i);
...
const rng = sh("git", ["rev-list", "--count", `${watermark}..HEAD`]);
return { … note: `maps: ${behind} commits behind HEAD (…)` };
```

There is **no `git merge-base --is-ancestor` test.** Against the prior stamp `97576f35` the function
returns **8**, of which three (`b7f89952`, `603ec12f`, `18fc0571`) are main-line commits the branch
`97576f35` sat on never contained. The number is therefore not a staleness measure; it is
`|reachable-from-HEAD \ reachable-from-watermark|`, which for a divergent watermark is unbounded and
uninterpretable. **A watermark on a long-dead branch would still print a tidy integer.**

Compounding: the report is emitted as a `note` string in the state projection and, per the standing
carried finding, is **WARN-only and not gated**. So the one instrument that should have caught this
both (a) cannot express the failure and (b) could not fail the build if it could.

**Suggested disposition:** *fix the tool.* Two lines:
`git merge-base --is-ancestor <watermark> HEAD` → on failure emit
`maps: watermark <wm> is NOT an ancestor of HEAD — stamp is off-branch, delta is unbounded` instead
of a count. **This is a smaller change than the eighth consecutive recommendation to gate the
warning, and it fixes a wrong answer rather than an ignored one.** Routed to bryan as a scripts-side
one-liner, not a design question.

---

### S328-N2. The archived S328 dispatch briefs assert map currency from an unverifiable premise

**Reason:** content-heuristic — a state claim propagated rather than derived.
**Severity:** LOW. The briefs are per-dispatch archive artifacts and are correctly located; the
defect is in the sentence, not the file's existence.
**Detail:** `docs/changes/s328-match-block-arm-keyword-boundary/BRIEF.md` and its sibling
`docs/changes/s328-each-shorthand-restricted-parent/BRIEF.md` each carry:

> Read `.claude/maps/primary.map.md` (stamp `97576f35`) FIRST … HEAD is `18fc0571`; the two commits
> past the stamp are docs-only, so the map is CURRENT.

`97576f35` is not an ancestor of `18fc0571`; there were **three** commits past it on main
(`b7f89952`, `603ec12f`, `18fc0571`), and `603ec12f` was a **SPEC change**, not docs. The agents
were told a map was CURRENT on a premise that could not be checked from the sentence.

**Both dispatches nonetheless landed correctly**, so this is a near-miss, not a damage report — and
that is precisely why it is worth recording: **a false currency claim in a brief is invisible when
the work happens to be unaffected.**

**Suggested disposition:** *leave the archived briefs verbatim* (the standing convention is that a
BRIEF.md is the prompt as issued, not as corrected). **Fix the brief TEMPLATE instead**: state the
stamp and let the agent run `git merge-base --is-ancestor <stamp> HEAD` itself, rather than asserting
currency on the agent's behalf. Same root as N1.

---

### S328-N3. `docs/changes/s328-each-shorthand-restricted-parent/progress.md` names a symbol that does not exist — correctly labelled, but it is the exact trap a grep-driven agent falls into

**Reason:** uncertain — needs human review. Leaning COMPLIANT; recorded because the cost of being
wrong is high and asymmetric.
**Severity:** LOW.
**Detail:** the file names **`eachBodyLowering(tagName)`**, `TEXT_ONLY_CONTENT_ELEMENT_NAMES` and a
three-way `EachBodyLowering` type as the fix's shape. **None of the three exists in the tree** —
`grep -rn eachBodyLowering compiler/` returns zero. They were the FIRST attempt (`2c89086c`),
rejected `DO-NOT-LAND` by the S239 adversarial gate and deleted; the landed shape is a single local
`_isRcdataBody = isRcdataElement(tagName)` at `emit-each.ts:1169`.

**The doc handles this correctly and says so loudly** — a `⚠ STEPS 5-9 BELOW DESCRIBE THE FIRST
ATTEMPT, WHICH WAS REJECTED` banner, and a "Landed shape:" paragraph naming the deletions. **By the
letter of the scope rule this is compliant: it is a dispatch-progress record, and the superseded
section is retained deliberately because the round-2 rationale only reads against it.**

**Why it is here anyway:** this refresh's own instruction brief named `eachBodyLowering` as the
landed decision. **A downstream consumer already propagated the dead name once**, which is the
failure mode the label is supposed to prevent. A `grep`-first agent that lands on line 108 without
reading up to the banner on line 103 gets a confident wrong answer.

**Suggested disposition:** *no file action.* **Add the dead-name warning to the MAP instead**, where
a routing agent will meet it — done this pass (`domain.map.md` RESTRICTED CONTENT MODELS,
`structure.map.md` emit-each row, `primary.map.md` Key Facts all state that `eachBodyLowering` is not
a name in this tree). If a human disagrees and wants the progress doc pruned, that is a judgement
call, not a rule violation.

---

## RESOLVED this pass

### S326-N1 — **CLOSED.** The §12.5 `Response` SHALL now has a normative home
Raised at S325 and S326 as canon-claims-X / SPEC-silent: "route handlers SHALL return a `Response`"
existed only in an `emit-server.ts` comment and a commit subject. **#460 (`603ec12f`) wrote it into
`SPEC.md:7353`** as *"A generated route handler SHALL produce a COMPLETE HTTP RESPONSE, not a bare
value."* Verified at HEAD.

Three properties of the resolution a reader should carry, because each is easy to over-read:
1. **It binds the emitted ARTIFACT's observable behaviour, deliberately NOT its JS shape** (S278
   precedent). impl#1 satisfies it with a Bun `Response`; the normative half is that the wire carries
   the serialized value.
2. **It carries NO diagnostic code** — enforced by construction — so the §34 catalog did not move
   (806 rows, census re-run at this HEAD, buckets byte-identical).
3. **Its own provenance note records, honestly, that no debate or DD ratified the direction.** The PA
   decided the four structural rows under the FORK RULE at S325; the operator authorized writing it
   in at S326. It should be read as an implementation contract promoted to normative text.

The SPEC bullet states the generalisable finding in its own words: *"A normative sentence that lives
only in one implementation's source is not part of the contract."* **That sentence is the durable
output of this finding — it outlives the specific SHALL.**

⚠ **One loose end, and it feeds S326-N3 below:** the gap entry
`g-response-contract-shall-has-no-spec-home` (`docs/known-gaps.md:1451`) now carries
`status=resolved` in its `@gap` marker while its **heading still reads `MED; open;
ROUTED-TO-BRYAN`**. The finding closed; the ledger line a human greps did not.

### S326-N2 — **CLOSED.** The `g-session-get-reserved-key-read-disclosure` ledger locus was corrected
The entry now reads
`locus=compiler/src/codegen/emit-server.ts:2593(accessor .get — now \`Object.hasOwn(this._rec,key) ? … : null\`; own-key filtering still absent)`
— matching `emit-server.ts:2593` at HEAD. Both halves of the S326 finding (the stale `:2568` locus
and the false "no `hasOwnProperty`" claim) are fixed. **The underlying GAP remains open and correctly
so** — own-key filtering is still absent and the entry says exactly that.

---

## Carried findings — RE-VERIFIED at this HEAD

### S326-N3. `docs/known-gaps.md` — heading status vs `@gap` marker status disagree, and the count has **GROWN from 10 to 19 distinct headings**
**RE-VERIFIED and WIDENED.** Re-derived mechanically at this HEAD (script: walk every
`<!-- @gap … status=resolved -->` marker, find its nearest preceding `### ` heading, parse the
trailing backticked metadata block, flag when that block contains an `open` token):

- **381** `status=resolved` markers total
- **41** marker instances whose heading metadata says `open`
- **19 DISTINCT headings** (several batch sections carry many markers under one heading — the S216
  `r27-*`/`r28-*` block alone accounts for 23 of the 41)

**The prior pass reported 10. I am reporting 19 and flagging the divergence rather than overwriting
it**, because I cannot reproduce the earlier method: it may have counted only non-batch headings, or
used a different heading-metadata parse. **Treat the direction (growing) as the signal and the
absolute number as method-dependent.** Instances at this HEAD include
`g-db-migrate-ignores-constraint-drift-on-existing-columns` (L1155),
**`g-response-contract-shall-has-no-spec-home` (L1451 — resolved by #460 THIS window)**,
`g-crossfile-export-const-not-destructured-by-importer` (L6888), and
`g-tool-artifact-import-specifier-dangles` (L7099).

**Unchanged and still the point:** `scripts/state.ts` parses the MARKER, so the rollup and its CI
gate are correct and blind to the disagreement. **The heading is the line a grep returns.** Note the
shape-match with S328-N1: in both cases a machine reads one field, a human reads another, and only
the machine's field is gated.

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
**RE-VERIFIED, unchanged.** One occurrence in `compiler/SPEC.md` at this HEAD; #460's only SPEC edit
was the §12.5 bullet. Carried.

### C4. EIGHT live `W-LINT-*` codes have no §34 row
**RE-VERIFIED, and the eight are now enumerated** rather than asserted as a count. Codes emitted by
`compiler/src/` with **zero** occurrences in `compiler/SPEC.md`: `W-LINT-016`, `W-LINT-017`,
`W-LINT-019`, `W-LINT-020`, `W-LINT-021`, `W-LINT-022`, `W-LINT-023`, `W-LINT-024`. (`W-LINT-001`
through `-015` and `-018` all have rows.) Carried.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
**RE-VERIFIED and freshly demonstrated.** #460 moved the generated totals block correctly
(`37,066 → 37,074`, CI-gated by `scripts/regen-spec-index.ts --check`) and every section line-range
row re-derived. **The authored half remains ungated**, exactly as before. Carried.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
**RE-VERIFIED at this HEAD, still exactly four sites.** Unchanged for FIVE windows now. **A carried
finding that survives five passes is evidence the report is not the mechanism** — same conclusion as
last pass, restated because nothing moved. Suggest either fixing it or wiring the version into the
snippet gate so it cannot recur.

### C7. `compiler/native-parser/` — zero diff, none owed, one CONFIRMED standing gap
**RE-VERIFIED.** Zero diff this window and **none owed**: all three source files are emit-time
(`emit-logic.ts`, `emit-html.ts`, `emit-each.ts`), and the standing rule is that only a landing
adding an AST FIELD to a structural node owes a native mirror. `E-SCRIPT-001` remains a confirmed
pre-existing gap (`parse-markup.js:983-995`). Carried.

### C8. The four `*.generated.md` indexes are **unmaintainable**, and this window adds a fourth demonstration
**RE-VERIFIED and WIDENED again.** All four still stamped `2026-06-25 16:27` — now **six weeks** and
counting. Fresh instances from this window's own files:

| index claim | actual at HEAD |
|---|---|
| `structure.generated.md`: `emit-each.ts _(2248L)_` | **3,738 lines** |
| `structure.generated.md`: `emit-html.ts _(2931L)_` | **4,335 lines** |
| `structure.generated.md`: `emit-logic.ts _(4227L)_` | **4,977 lines** |
| `test.generated.md`: 1042 `.test.js` | **1,328** (under-reports by 286) |
| `structure.generated.md`: `compiler/src` 155 files | **189** |

**The escalation stands, now for a fourth consecutive pass:** they are `@generated by
flogence/scripts/mapgen.ts`, an out-of-repo script this project's CI does not run, and the only CI
leg that ever refreshed anything under `.claude/maps/` was deleted at #351. **There is no path by
which these files can become current.** An agent grepping `structure.generated.md` for a symbol added
in the last six weeks gets zero hits and a plausible-looking index — a silent-wrong-answer surface,
strictly worse than a missing one.
**Suggested disposition (unchanged, now overdue): wire `mapgen.ts` into `cloud-maps` Stage 1
alongside `state.ts` — or delete all four.**

### S313-N5. `scripts/git-hooks/pre-push` — comment still stale
**RE-VERIFIED, unchanged.** `git diff 97576f35..HEAD -- scripts/` is EMPTY, so the comment asserting
the browser check *"runs in CI `tracking` today"* with promotion *"bryan's to make"* is still stale —
bryan ruled promote and `ci.yml` runs it in `gate`. Carried.

### S322-N1. `g-auto-await-family-not-closed-…` bakes **150** into an ID whose measurement is **142**
**RE-VERIFIED, unchanged** (two occurrences in `docs/known-gaps.md`). The ID is still the string every
future session greps. Carried.

---

## Map corrections applied this pass — what was WRONG and is now right

Recorded here rather than buried in the maps, because a map that silently changes its mind teaches
nothing.

| map | falsified claim at the prior stamp | correction |
|---|---|---|
| `structure.map.md:116` | a full paragraph describing `buildInitialBoolMap(fileAST)`, the `indeterminate` set, the three-way `style=` merge policy and the byte-inert-on-true behaviour | **DELETED and replaced** with the revert record. `emit-html.ts` is byte-identical to `71623be3`; none of those symbols exist |
| `dependencies.map.md:119` | a pipeline row *"§17.2 `show=`-false SSR hide (NEW #450)"* with a full mechanism description | **REWRITTEN IN PLACE** as a REVERTED row, with `ctrl-017`'s toggle-needs-a-toggler argument |
| `dependencies.map.md:120` | the #456 each-shorthand mount row, unqualified | **NARROWED** — the mount is refused inside RCDATA (#466); #456's own "never over-wraps" premise recorded as FALSE |
| `test.map.md:48` | a row for `unit/show-false-ssr-hidden-no-fouc.test.js` (197L) describing its 11 sections | **struck** — the file was DELETED with the code |
| `primary.map.md:35` | *"#450 (§17.2 `show=`-false SSR hide)"* listed as a landing | **replaced** by the revert as the window's headline entry |
| all six re-walked maps | stamp `97576f35`, asserted as "the true HEAD" | **`35d4d32e`**, with the off-main finding stated in every header |
| counts across four maps | 238,971 lines / 1,327 tests / 37,066 SPEC lines / 857 conformance | **238,974 / 1,328 / 37,074 / 865**, each independently re-derived |

**Two things were ADDED because a grep could not have found them:**
- **`api.js:2409`'s `const _runCG = selfHostModules?.runCG ?? runCG`** makes the whole Stage-8
  codegen subtree invisible to any static call-graph walk from `compileScrml`. **Eleven** stages
  carry the same `selfHostModules` seam (`api.js:665-677`). Now a navigation hazard note in
  `structure.map.md` Entry Points and a routing row in `primary.map.md`.
- **The FOUR non-agreeing answers to "may this element body receive an element child?"** — now a
  table in `domain.map.md`. #466 shared one local between two of them and its own comment refuses the
  overstatement. A map that said "the compiler now has one content-model decision" would have been
  actively harmful.

---

## Aspirational / archival content — this window's new docs, all correctly located

- **`docs/changes/s328-match-block-arm-keyword-boundary/BRIEF.md`** (75L) + **`progress.md`** (14L) —
  the #463 dispatch. Correctly archived at dispatch time per the standing rule. See N2 for the one
  defective sentence in the template.
- **`docs/changes/s328-each-shorthand-restricted-parent/BRIEF.md`** (83L) + **`progress.md`** (409L)
  — the #466 dispatch. **`progress.md` is the most valuable single doc this window produced** and is
  worth reading beyond this arc: it records a completed fix being REJECTED by its own adversarial
  gate, with the measurement that killed it (`<option>` does not lose data; `.textContent =
  String(expr)` replaced a correct label with `"[object HTMLElement]"`), and it records the
  `<title>` `rcdata:true` ordering trap as a standing hazard for whoever touches
  `html-elements.js:~272-279`. See N3 for its one grep-trap.
- **`docs/pr-reviews.md`** (+42L, #465) — review-floor records. In-scope, current, no findings.
- **`docs/changes/marketing-claim-gate/BRIEF.md`** (#465) — its `DONE-PROBE` was corrected from a
  probe that RAN the gates to one that asserts they are WIRED. **That is a fix to a 27-session-stale
  probe, i.e. this window resolved a doc defect rather than adding one.** No finding.

---

## Uncertain — needs human review (both carried, both unchanged)

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** Not re-derivable from source. These are design/positioning documents whose claims are
about intent and comparison, not about code that grep can confirm or refute.
**What to check:** bryan's call on whether each is (a) current positioning, (b) historical and should
move to `scrml-support/archive/`, or (c) superseded. Unchanged this window and not re-chased.

### `docs/website/`
**Reason:** A published surface with its own build (`docs/build.ts`) and its own gate
(`scripts/snippet-gate.js` covers code snippets, not prose claims). Prose currency is unverified.
**What to check:** whether any page states a version, a count, or a feature status the snippet gate
does not cover. `docs/tutorial.md`'s four `v0.7.0` sites (C6) are the known instance and suggest
there are others. **Add a specific check this pass:** whether any page describes `show=` first-paint
behaviour, since #450 landed and unlanded inside one session and a website page written between the
two would now be wrong.

---

## Map currency at this stamp

| Map | Stamp | Honest? |
|---|---|---|
| primary · non-compliance | `35d4d32e` | re-walked this pass, stamp == HEAD |
| structure · dependencies · domain · test · error | `35d4d32e` (source walk `6f176c0d`) | re-walked this pass; the gap is one DOCS-ONLY commit, verified empty over `compiler/ scripts/ conformance/ .github/ stdlib/ package.json` |
| auth | `97576f35` (== `b7f89952`) | **NOT re-walked — honest.** Zero auth-surface diff verified |
| build | `97576f35` (== `b7f89952`) | **NOT re-walked — honest.** `git diff 97576f35..HEAD -- .github/ scripts/ package.json` is EMPTY |
| infra | `97576f35` (== `b7f89952`) | **NOT re-walked — honest.** Zero infra diff |
| schema | `fe14c9b2` (AST half) + `97576f35` (one appended entry) | **deliberately split, labelled at both sites.** `compiler/src/types` has zero diff for SEVEN windows; #466 added a `const` local, not a declared shape |
| config | `e80b692e` | **deliberately older.** Zero env-surface diff re-verified: no added/removed `process.env`/`Bun.env` reference in the window's diff |
| migrations | `115e8b1b` | **deliberately older.** No DB/migration surface in seven windows |

**An honest older stamp beats a false "verified at HEAD" — and this pass adds a corollary: an honest
stamp must also be an ANCESTOR of HEAD.** Every `(== b7f89952)` annotation above exists because the
literal SHA those maps carry is a PR-branch tip. **Do not resolve them by editing the SHA**; they are
correct as-of that content and the annotation is the truthful repair.

**Standing hazard, EIGHTH consecutive pass, and it now has a second half:** `cloud-maps` no longer
refreshes `.claude/maps/` on any schedule, so a stamp is exactly as old as the last wrap; and
`scripts/state.ts`'s staleness note is both **WARN-only** and, per S328-N1, **incapable of expressing
the off-branch case at all.** Eight passes have recommended gating the warning. **This pass
recommends fixing the warning first — a gated wrong number is worse than an ignored one.**

## Tags
#scrml #non-compliance #project-mapper #cleanup #stamp-not-an-ancestor #merge-base-is-ancestor #map-watermark #state-ts-mapsstaleness #warn-only-not-gated #brief-template-currency-claim #spec-drift #s326-n1-closed #s326-n2-closed #response-contract-has-a-spec-home #shall-without-a-code #enforced-by-construction #heading-vs-marker #status-disagreement #known-gaps-ledger #generated-md-unmaintainable #mapgen #six-weeks-stale #tutorial-version-drift #w-lint-no-spec-row #native-parity-not-owed #pre-push-comment-stale #show-false-ssr-REVERTED #eachbodylowering-does-not-exist #superseded-section-grep-trap #title-rcdata-ordering-trap #four-non-agreeing-answers #map-corrections-recorded

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [test.map.md](./test.map.md)
- [error.map.md](./error.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
