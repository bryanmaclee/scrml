# non-compliance.report.md
# project: scrml
# generated: 2026-08-02T18:40:00Z  commit: e80b692e
# scan mode: INCREMENTAL_UPDATE (S313 map refresh over `fe14c9b2` -> `e80b692e`, 67 commits, five sessions)

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread. **Every CARRIED finding below was re-executed at
this HEAD this pass — none is copied forward on trust.**

## NEW at this HEAD (S313 pass)

### S313-N1. `<machine>` was REMOVED; four live docs still teach it as a deprecated-but-working alias
`E-DEPRECATED-001` (Error) fires from `ast-builder.js:16839`; `<machine>` does not compile;
`W-DEPRECATED-001` is a §34 tombstone. Re-grepped at this HEAD:

| doc | sites | what it says that is now false |
|---|---|---|
| `docs/PA-SCRML-PRIMER.md` | 6 (`<machine>`) + 2 (`W-DEPRECATED-001`) | :738 — *"deprecated alias for `<engine>`. Emits `W-DEPRECATED-001`… `W-DEPRECATED-001 → E-DEPRECATED-001` transition **planned for v0.3.0**"*; :1162 table row — *"`<machine>` keyword \| deprecated (W-DEPRECATED-001) \| Hard-removal at v0.3.0"*. Also :731/:749/:1350 describe legacy `<machine>`-form-exclusive surfaces as live. |
| `compiler/PIPELINE.md` | 4 | :712 / :771 describe the `<machine>`-vs-`<engine>` distinction and the "`< machine>` opener (deprecated)" as a live parse path; :1264 lists `<machine>` among current structural blocks. |
| `compiler/SPEC-INDEX.md` (authored half) | 1 (`W-DEPRECATED-001`) | :309 routes *"`<engine>` keyword vs legacy `<machine>` deprecation → §51.0.L + **W-DEPRECATED-001**"*. Its §63 row also still lists `<machine>` §51.3.2 among "the 3 floating forms reclassified unscheduled" — it is now REMOVED, not unscheduled. |
| `docs/external-js.md` | 2 | :70 *"`<machine>` replaces state-machine libraries (XState)"*; :82 *"Auto-property tests emit from `<machine>` declarations (§51.13)"* — both subsystems moved to `<engine>`. |

**Reason:** spec-vs-doc drift, all four predate S307.
**Suggested disposition:** UPDATE. `PA-SCRML-PRIMER.md` is the highest priority — it is the doc a
booting PA reads, and it names a version schedule (`v0.3.0`) that §63.2 now explicitly forbids
("MUST NOT name a removal version at Stage-1"). `SPEC-INDEX.md`'s row is a one-line pointer fix.
**Note the shape:** none of these is under any gate. The generated half of SPEC-INDEX tracked
correctly all window; the authored half rotted. That is an argument for widening the generator.

### S313-N2. `examples/23-trucking-dispatch` — a README count that no source supports, and a
### mechanically-mangled comment
`README.md:34` claims **"`<machine>` × 1 — driver HOS state machine"**. **Zero `.scrml` files in the
repo contain `<machine>`** (only `native-parser/parse-file.scrml`, and that is the internal
`machineDecls` data-structure name in a comment). The actual declaration in
`pages/driver/hos.scrml` is `<engine for=DriverStatus server=@…>`.

Worse, the same file carries a **mechanically-mangled comment** at `:34-35`: *"file with a
`<engine>` block (or `<engine>` deprecated alias)"* — a `machine`→`engine` sed that rewrote both
halves of a contrast, leaving a sentence that says a thing is an alias of itself. Introduced
`35a49052` (2026-06-20), so it predates this window; surfaced only because the `<machine>` sweep
went looking.
**Reason:** grep-mismatch (README) + a botched mechanical rewrite (source comment).
**Suggested disposition:** UPDATE both. One line each. The README is adopter-facing.

### S313-N3. `docs/known-gaps.md` — `g-ci-does-not-run-root-level-test-files` is `status=open` and
### its BODY is false at this HEAD
The entry (`:5375-5382`) states *"Nothing runs the other 13 files sitting at `compiler/tests/`
root"*. **`ci.yml`'s `gate` has run `bun test compiler/tests/*.test.js` since `b7dda491` (S302), and
`pre-commit` runs it too.** The *load-bearing residual is still true*: `ci.yml:130`'s step is named
**"Within-node parser-parity + canary"** while `:131` runs only
`parser-conformance-within-node.test.js` — the canary is in the label and absent from the command.
**Reason:** a gap entry whose stated premise a landing invalidated, left `open` with the old body.
**Suggested disposition:** REWRITE the body down to the surviving residual (the overstating step
LABEL) and re-sev it, or close it and file the label defect fresh. **As written it will send someone
to fix a hole that is already closed** — the exact failure mode `feedback_verify_work_not_done_before_dispatch`
names, encoded in the ledger.

### S313-N4. `g-cloud-maps-ci-red-api-rejection` (MED, open) diagnoses a workflow leg that no
### longer exists
The entry (`:5444-5449`) is a careful diagnosis of Stage 2's `1 turn / ~0.6s / $0 / is_error:true`
signature as a credential/entitlement condition on `ANTHROPIC_API_KEY`. **Stage 2 was DELETED at
`ddbc029c` (#351).** The diagnosis is not disproved — the thing it explains is gone.
**Reason:** a gap made moot by a deletion, not a fix.
**Suggested disposition:** CLOSE as `non-gap` / resolved-by-removal, and **file the successor that
actually matters, which is not a CI failure at all: `.claude/maps/` now has no scheduled refresh of
any kind.** The measured cost of the un-refreshed state is already two windows deep (27 commits, then
67). Whoever closes it should decide whether PA-at-wrap is the accepted steady state or whether a
deterministic (non-AI) map-currency check belongs in Stage 1.

### S313-N5. `scripts/git-hooks/pre-push` — a comment added and superseded inside the same window
The S313 comment block at `:70-79` says the browser NAME-SET check *"runs in CI `tracking` today"*
and that requiring it in the blocking `gate` *"is a deliberate promotion decision and is bryan's to
make — NOT taken unilaterally"*. **Bryan ruled promote in the same window (`df41ea97` Q6 /
`16783d6d`), and `ci.yml`'s `gate` runs it.** The hook's SCOPE is unchanged and still correct; only
the narration is stale.
**Reason:** intra-window supersession, harmless but self-contradicting.
**Suggested disposition:** UPDATE the comment to record the promotion (and that the hook still
deliberately excludes the check, which remains the right call — local environments vary, and it was
a local environment difference that made the first recorded baseline wrong).

### S313-N6. `runtime-template.js:3114` — `_scrml_teardown_region`'s doc-comment claims it tears
### down "timers", and the SCOPING doc's correction of it is itself slightly wrong
The comment says the function tears down *"reactive display effects / subscriptions / **timers**"*.
`docs/changes/route-region-teardown/SCOPING.md` flags this and states flatly **"The timer clause is
FALSE."** **Both are imprecise, in opposite directions.** The truth: an `_outletResident` `<timer>`
— one written LEXICALLY inside the shell's `<outlet>` element — DOES push
`_scrml_timer_stop` into `_scrml_region_cleanups` (`emit-reactive-wiring.ts:1273-1277`) and IS torn
down. What is never torn down is a **route-chunk** timer, because route content lives in a different
file and is therefore never lexically inside an `<outlet>`.
**Reason:** an over-broad comment and an over-broad correction of it.
**Suggested disposition:** fix the comment to say *"…and timers/input-state registered by an
OUTLET-RESIDENT node; a route-chunk timer is NOT registered here"* in the same landing that fixes the
behaviour. **The precision matters to the fix**: it says the mechanism is present and the GRANULARITY
is wrong, which is a different (and much smaller) change than building the association from scratch.
Mapped in domain.map.md and structure.map.md.

### S313-N7. Map-size budget breach has WIDENED, and this pass widened it
`domain.map.md` is now **772 content lines** against the project-mapper contract's *"No map exceeds
300 content lines."* Also over: `build.map.md` 391, `error.map.md` 388, `dependencies.map.md` 369,
`primary.map.md` ~230, `test.map.md` ~200. The prior report (N3) flagged 498/453/352/307 and
recommended a split; **it was not done, and this pass added ~180 lines to `domain.map.md` alone.**
**Reason:** accumulated real content plus a deliberate decision not to restructure inside an
incremental pass — but "deferred" is now three passes old.
**Suggested disposition:** at the next FULL refresh, split `domain.map.md` into `domain.map.md`
(language primitives + lifecycle + routing) and `security.map.md` (§14.8.9 / §14.8.10 / §14.8.11 —
~150 lines, self-contained, and untouched for three windows so it will not churn). **Recommendation
rather than deferral:** the security tier is the cleanest cut line and the least likely to need
re-editing, so splitting it costs one pass and buys back a third of the file.

## Carried from earlier passes — RE-EXECUTED at this HEAD

### C1. Third-party adopter identity in `hand-off.md` / `master-list.md` — NOT re-derivable from
### this map set, and that is deliberate
The S299/S302 reports recorded 3 sites in `hand-off.md` and 1 in `master-list.md`. **This pass cannot
honestly re-count them: the scrubbed token is deliberately not named anywhere in `.claude/maps/`**
(that is the point of the scrub), and `hand-off.md` grew by 1,078 lines this window. `.claude/maps/`
itself is CLEAN and stayed clean through this pass.
**Suggested disposition:** re-count must be done by someone holding the token. The standing decision
is unchanged: a neutral codename in `hand-off.md`'s live items; the `master-list.md` echo is a commit
TITLE that git history cannot rewrite on a pushed public branch — an irreducible exposure deserving
an explicit operator decision rather than a silent carry.

### C2. **RESOLVED-BY-DELETION** — `cloud-maps` is no longer red, because its AI leg is gone
Superseded by S313-N4 above. The workflow's surviving Stages 1/1b/3 are deterministic and free.
**The finding that replaces it is not a CI failure: there is now NO scheduled map refresh at all.**

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
Re-grepped: exactly **1 site** in `compiler/SPEC.md`. Since `df6d269c` a top-level `<each>` mounts as
a comment fence. The §52.15.5 BEHAVIOUR is correct — only the noun is stale. §17.1 added a SECOND
comment-node shape to that surface (`<!--scrml-if-row-->`), so a reader reconciling spec prose
against emitted DOM has two mismatches to trip over.
**Suggested disposition:** one clause — "its each-mount fence is left unfilled". No ruling needed.

### C4. **CORRECTED — EIGHT live `W-LINT-*` codes have no §34 row, not nine**
Re-enumerated at this HEAD. Live `code:` emit sites in `compiler/src/lint-ghost-patterns.js`:
`W-LINT-001..008` + `010..024` = **23 distinct**. §34 now catalogs `W-LINT-001..015` **plus `018`** =
**16 rows**. Uncatalogued-but-live: **`016`, `017`, `019`, `020`, `021`, `022`, `023`, `024` —
eight.** The prior report's nine is stale because `018` was catalogued in the interim.
**Standing correction retained:** `W-LINT-009` is CATALOGUED and NOT live (the `:868` hit is the
comment *"No separate entry for W-LINT-009 — W-LINT-004 subsumes it"*). Grep `code:\s*"W-LINT-`.
**Suggested disposition:** unchanged — catalog the eight or rule them internal-only; either way
footnote the §34 total as counting the CATALOG, not the implementation. **`bun scripts/s34-census.ts`
now makes this mechanically checkable**, which is the better fix than another hand count.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
Re-checked at this HEAD: the `@generated` totals block tracked correctly all window (CI-gated).
`grep -ci "db-authoritative|SECURITY DEFINER|RLS"` across the whole file still returns **0**, and the
banner still reads **"Last updated: 2026-07-20 (S273)"** — now **eleven sessions** after §14.8.11
landed, and it has since also missed §34.0, §6.7.2.1, §20.8.8, §19.4.4.1 and the `<machine>` removal.
**Reason:** currency gap (omission). **This is the same shape as S313-N1** — the gated half stayed
current, the ungated half rotted.
**Suggested disposition:** append Quick-Lookup rows (DB-authoritative / RLS / SECURITY DEFINER /
db-migrate / route region / §34.0 → their sections), fix the `W-DEPRECATED-001` pointer at :309, and
either refresh the banner or retarget it to single-most-recent-session. **The durable fix is to widen
the generator**, not another manual edit — that is the argument this finding has now made five times.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
Re-counted: **4 sites**, unchanged. `docs/FACTS.md` derives `compiler version` mechanically under a
CI `--check` gate, so this is a hardcoded figure that already has a generated authority.
**Suggested disposition:** replace with a FACTS.md reference. The tutorial's PROSE is not under the
snippet gate — that gate proves only that a page COMPILES.

### C7. `compiler/native-parser/` — zero diff, none owed, one CONFIRMED standing gap
`git diff --name-only fe14c9b2..HEAD -- compiler/native-parser/` returns **0 files**, and **no parity
was owed**: every landing this window is emit-time (codegen), runtime, diagnostic-message, spec, CLI
or CI. None touches the parsing/AST-shape layer. `compiler/src/types/` likewise has zero diff, which
is why `schema.map.md` was not re-walked.
- **Confirmed standing gap:** `E-SCRIPT-001` has **0 occurrences** in `parse-markup.js`, which
  carries an explicit `<style>` → `E-STYLE-001` mirror and no `<script>` counterpart.
- Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
  grounds that nothing changed.

### C8 (was N2). The four `*.generated.md` indexes are now **unmaintainable, not merely stale**
`error.generated.md` (353 E-codes → `file:line`), `structure.generated.md` (155 files / 1128 symbols
— `compiler/src` actually has 189), `dependencies.generated.md` (488 import edges) and
`test.generated.md` (1042 `.test.js` — actually 1304). **All four stamped `2026-06-25 16:27` — ~5.5
weeks and ~144 commits stale.** `error.generated.md` is **E-codes ONLY**, so a `W-`/`I-` lookup
returns nothing and looks like proof the code does not exist.
**ESCALATED this window:** they are `@generated by flogence/scripts/mapgen.ts`, an out-of-repo script
this project's CI does not run — **and the only CI leg that ever refreshed anything under
`.claude/maps/` was deleted at #351.** There is now no path by which these files can become current.
**Suggested disposition (recommendation, not a menu):** **wire `mapgen.ts` into `cloud-maps` Stage 1
alongside `state.ts`, and widen it to emit `W-`/`I-` codes.** It is deterministic and zero-cost, it
would keep working with the AI stage gone, and a mechanical code→`file:line` index is the single
highest-value artifact in this set for a grep-first agent. If that is not going to happen, **delete
all four** — an index nobody regenerates is a silent-wrong-answer surface, and the routing notes now
attached to them are a mitigation, not a fix.

### C9. `g-maps-error-map-missing-diagnostics-and-emit-client` is now correctly `status=narrowed`
The S302 report asked for this; the ledger reflects it. Re-derived at this HEAD: §34 carries **187**
distinct code prefixes and `error.map.md`'s family table names ~**70**, so ~117 route only via grep —
which the map now STATES rather than papering over. No further action; do not re-flag.

## OPEN — code defects filed at this HEAD

`docs/known-gaps.md` is the authority. Cited for map-set completeness only.

- **`g-route-timer-poll-not-stopped-on-soft-nav`** (HIGH, open, `locus=compiler/src/runtime-template.js:3026`,
  `prov=dd:soft-nav-outlet-lifecycle-model-2026-08-02`) — the arc this map refresh was commissioned
  for. Scoped in `docs/changes/route-region-teardown/SCOPING.md`; SPEC side ratified (§6.7.2.1 /
  §20.8.8); codegen side unbuilt. See domain.map.md for what the implementation actually does today.
- `g-gate-tier-unit-test-red-local-green-cloud` (HIGH, open) — a unit test inside the BLOCKING gate's
  own scope fails locally while cloud `gate` is green on the same content.
- `g-onmount-multistatement-bypasses-statement-codegen` — §6.7.1a's sugar-equivalence SHALL is not met
  by impl #1 (`lift`, markup-as-expression, `?{}` and `!{}` each fail `E-CODEGEN-INVALID-LOGIC`).
  **The SPEC states this in place rather than asserting the SHALL — that is the compliant shape.**
- `g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion` (LOW, `locus=scripts/browser-baseline.ts`)
  — the browser tier is now name-set-assertable; the other three baselined tiers are not.
- `g-fn-params-typed-string-actually-objects` — fixed in `collectServerOnlyBindingModules`; the
  identical latent bug remains in `buildClosureCapturesForFunction`. Filed, not folded.
- The `buildImportedServerFnNames` aliasing blind spot — keys on `names` not `specifiers[].local`, so
  every `import { x as y }` is missed. Separate blast radius, deliberately not folded in.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

Under `docs/changes/**`, the per-dispatch archive, excluded from content-mapping by scope. Listed
only because they describe work that does NOT exist at this HEAD:
- **`docs/changes/route-region-teardown/SCOPING.md`** — NEW, and it is the exemplary shape: it opens
  with a `⛔ TRACED S313 — the design below was a HYPOTHESIS and it is WRONG` banner over its own
  superseded section, retains the superseded design for provenance with a DO-NOT-BUILD-FROM-THIS
  label, and voids its own sizing. **Two caveats for a reader:** its "the region↔scope association
  must be established at EMIT time" premise reads as if from scratch, and that machinery already
  exists (`_outletResident`) — see S313-N6; and its "MAPS — REQUIRED FIRST READ" block names
  watermark `fe14c9b2` as STALE, which **this pass supersedes** (the maps are now at `e80b692e`).
- `docs/changes/route-region-teardown/CONFORMANCE-CN1-CN10.md` — NEW. Conformance for a contract
  whose emitter is unbuilt; lands with the impl. Correctly labelled.
- `docs/changes/s34-catalog-truthfulness/SCOPING.md` — NEW. The build arc for the 62 BUILD-ARC
  FALSE-CLAIM rows; the arc is open by construction.
- `docs/changes/machine-keyword-retirement/SCOPE.md` — NEW, and **the work it scopes IS landed**;
  read it as an archived dispatch record, not as pending work.
- `docs/changes/esm-chunks/U4-BRIEF.md` + `progress.md` — U4/U5/U6 not built; `classic` is still the
  default and the only conformance-tested format.
- `docs/changes/chunk-namespacing/{BRIEF,SCOPING}.md` · `docs/changes/marketing-claim-gate/SCOPING.md`
  · `docs/changes/navigate-wave1c-piece1-landmark/` · `docs/changes/if-mount-unmount-phase2/SCOPING.md`
  — scoping for unbuilt or premise-changed work; all carried unchanged.

## Compliant — new docs this window, checked

- `compiler/SPEC.md` **§34.0**, **§6.7.2.1**, **§20.8.8**, **§19.4.4.1**, the **§6.7.1a** amendment —
  all five carry explicit direction-of-change statements, and three carry an explicit implementation-
  status or `Nominal / spec-ahead` banner instead of asserting a SHALL the impl does not keep. §19.4.4.1
  additionally carries the first `provenance:` block (pa-base v2.10 Rule 4b) and uses it to SUPERSEDE
  a PA-authored rule that had none. **This is the shape every future amendment should copy.**
- `scripts/browser-baseline.ts` and `scripts/s34-census.ts` — both open with a WHY-THIS-EXISTS block,
  both enumerate the probe traps they defeat *by construction with the scar attached*, and both state
  their own scope limits (browser-tier only; "a FALSE-CLAIM verdict is a HYPOTHESIS, not a verdict").
  `s34-census.ts` explicitly refuses hardcoded line numbers and says why.
- `examples/29-engine-vs-flags.scrml` — migrated to a real error enum and rewritten to TEACH why the
  enum is load-bearing. It previously taught the rejected form in a comment.
- `docs/changes/machine-keyword-retirement/SCOPE.md` — correctly located, and the scoped work landed.

## Uncertain — needs human review

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** all unmodified since 2026-06-22 or earlier while SPEC.md has gained §14.8.11, §23.2.4a,
§38.6.2, §39.5.5, §20.8.2, §17.1, and now §34.0 / §6.7.2.1 / §20.8.8 / §19.4.4.1. **`docs/external-js.md`
is no longer uncertain — it is confirmed stale (S313-N1) and moves out of this bucket.** The rest were
not content-verified this pass.
**This has now been deferred FIVE passes running** (S290, S292, S297, S299, S302). **Recommendation,
not a sixth deferral: rule them OUT OF SCOPE explicitly** — none is under any gate, none is
adopter-facing on scrml.dev, and the one that turned out to matter (`external-js.md`) surfaced through
a targeted keyword sweep rather than a general audit. A general audit of this set has been proposed
five times and executed zero times; that is the honest evidence about its priority.
**What to check if scheduled anyway:** grep each for backticked identifiers against `compiler/src/`;
specifically anything describing `<machine>`, a security/auth/DB model predating §14.8.9-§14.8.11, or
a path/coordinate model predating the §47.9.5 dist-space clarification.

### `docs/website/`
**Reason:** carried unchanged — retained as a compile fixture (`g-docs-website-retained-as-test-fixture`)
while ALSO being under the snippet gate (98 `.scrml` files). A compile-gated directory reads as
endorsed content, and compiling proves nothing about prose.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · structure · domain · dependencies · error · test · build · config · infra | `e80b692e` | re-walked this pass against source |
| non-compliance | `e80b692e` | this file — every carried finding re-executed, not copied |
| schema | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff this window; no new FileAST node kind. The one new shape (`IndirectResolution.dispatchCalledTargets`) is codegen-internal and is mapped in dependencies.map.md |
| migrations | `115e8b1b` | **deliberately older.** No DB/migration surface in three windows |
| auth | `df2ac831` | **deliberately older.** Correct at its stamp; auth-adjacent facts from later windows are mapped in error/dependencies on purpose |
| `*.generated.md` × 4 | `2026-06-25` | **stale AND now unmaintainable** — see C8 |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## What changed about how these maps work, this pass

- **Map currency is now fully manual.** `cloud-maps` Stage 2 was deleted, so nothing regenerates
  `.claude/maps/` on a schedule. That fact is recorded at the TOP of `primary.map.md`, in
  `infra.map.md`, `config.map.md` and `build.map.md`, because a reader who assumes a nightly refresh
  will trust a stale stamp — and the last two windows drifted 27 then 67 commits.
- **The highest-value correction this pass is a ROUTING one, not a content one.** The prior generation
  routed "cross-chunk soft navigation" to `runtime-template.js` + `emit-event-wiring.ts` and said
  nothing about module-init at all, so the question "where is per-chunk module-init emitted?" had no
  answer and `codegen/index.ts` looked like the place. It is not. The producers are `emit-client.ts`,
  `emit-reactive-wiring.ts` and `emit-event-wiring.ts`, and the boundary is emission ORDER.
- **One prior map row was actively WRONG, not merely incomplete:** `structure.map.md`'s
  `codegen/scheduling.ts` entry listed eight GH #237 helpers as the landing surface; six of them were
  deleted at #323/#326 and replaced by an acorn AST pass. Corrected in place with the correction
  labelled, not silently overwritten.

## Tags
#non-compliance #project-mapper #cleanup #scrml #machine-retired #e-deprecated-001 #w-deprecated-001-retired #pa-scrml-primer-stale #pipeline-md-stale #spec-index-currency #external-js-stale #trucking-example-stale #mangled-sed-rewrite #gap-entry-body-false #resolved-by-deletion #no-scheduled-map-refresh #cloud-maps-stage2-deleted #generated-indexes #mapgen-unmaintainable #map-size-budget #domain-split-recommended #w-lint-uncatalogued-eight #s34-census #§34.0 #teardown-region-comment #outlet-resident #route-region #native-parser-parity #e-script-001 #privacy-scrub #adopter-identity #each-mount-noun #tutorial-version-hardcode #prose-gate-gap #pre-push-comment-stale

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [test.map.md](./test.map.md)
- [build.map.md](./build.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
