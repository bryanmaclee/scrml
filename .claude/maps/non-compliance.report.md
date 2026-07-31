# non-compliance.report.md
# project: scrml
# generated: 2026-07-31T03:18:23Z  commit: fe14c9b2
# scan mode: INCREMENTAL_UPDATE (S302 map refresh over `d0763cff` -> `fe14c9b2`, 27 commits, four sessions)

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread. **Every CARRIED finding below was re-executed at
this HEAD this pass — none is copied forward on trust.**

## NEW at this HEAD (S302 pass)

### S302-N1. `hand-off.md:318` instructs a revert against a SHA that is not in this repository
> "Guarded, not fixed: `g-if-mount-inside-dispatched-arm-body` (open, `E-IF-IN-DISPATCHED-ARM`
> guards it; **revert `2fbe6520` whole** when the split lands)."

`git cat-file -t 2fbe6520` → **`fatal: Not a valid object name 2fbe6520`**. It is a pre-squash branch
SHA; the merge landed under a different one. An agent following that instruction gets a hard failure
and no obvious next step.
**Reason:** grep-mismatch — an identifier the doc names that the repository does not contain.
**Suggested disposition:** UPDATE to name the revert by SYMBOL — `refuseConditionalInDispatchedArm`
(`compiler/src/codegen/emit-html.ts:780`) plus its **three** call sites (`:1508` structural, `:1737`
chain, `:2727` markup) — and to name the conformance case that must INVERT rather than be deleted
(`conformance/cases/control-flow/if-in-dispatched-arm-neg/`, whose own `description` already carries
the flip procedure). Mapped in error.map.md's standing catalog-vs-impl facts and domain.map.md §17.1.2.

### S302-N2. SPEC §34's `E-IF-IN-DISPATCHED-ARM` row is stale by one call site
The row (`SPEC.md:19265`) ends *"emitted at `compiler/src/codegen/emit-html.ts:refuseConditionalIn
DispatchedArm`, **two call sites**"*. There are **three** at this HEAD — S302 added the structural
one at `:1508` and did not update the row. §17.1.2.2 in the same amendment correctly says the guard
fires "on markup and on all three structural elements alike", so the SPEC contradicts itself by one
number.
**Reason:** spec-vs-impl drift, self-inflicted in the same landing.
**Suggested disposition:** UPDATE the §34 parenthetical to "three call sites". Low severity for a
reader looking for the fire site; load-bearing for whoever plans the revert, because the guard comes
out at three sites or not at all.

### S302-N3. §17.1.2's own reject-list is spec-ahead of enforcement — but DECLARED, so this is a
### tracked gap rather than a non-compliant doc
Recorded here only so a future scan does not re-flag it as drift. §17.1.2 states "Every other
scrml-defined structural element SHALL REJECT `if=`" and then, in an inset block, states exactly
which four do not (`<channel>`/`<errors>` emit only `W-ATTR-001` and ignore it; `<onTimeout>`/
`<onIdle>` ignore it with zero diagnostics), naming
`g-if-reject-unenforced-on-structural-declaration-elements`. **A SHALL that documents its own
enforcement gap is the compliant shape**, not the non-compliant one. Same for the noted `W-ATTR-001`
false-fire on `<auth if=>` (`g-w-attr-001-false-on-auth-if-gate-is-applied`) — a diagnostic that
contradicts the emit it describes, filed rather than hidden.
**Suggested disposition:** none. Do not re-flag.

## Carried from the S299 pass

### N1. `g-maps-error-map-missing-diagnostics-and-emit-client` is marked RESOLVED; **half of it is**
`docs/known-gaps.md:4619` carries `status=resolved` with a S297 closure note. Re-audited at
`d0763cff`:

- **The `emit-client.ts` half (b) IS closed.** Re-verified by grep, not by reading the closure note:
  `detectRuntimeChunks` :273, `POST_EMIT_HELPER_CHUNK_GATES` :2167, `runtime-chunks.ts`
  `CHUNK_DEPENDENCIES` :384, `applyChunkDependencies` :392. Every line number in primary.map.md's row
  still lands on its symbol. No action.
- **The diagnostic-routing half (a) was closed with a CLAIM, not a measurement.** S297 added the two
  family rows the two reporting lanes had needed (`E-PA-*`, `*-TAILWIND-*`) and then generalised:
  error.map.md asserted its family table is *"keyed by PREFIX, so a code this map does not name
  individually is still routed by its family."* **Mechanically re-derived at `d0763cff`: §34 carries
  185 distinct code prefixes; the family table names 67. 118 have no row** — including `W-AUTH-*`,
  `W-CG-*`, `W-IMPORT-*`, `W-STATE-*`, `E-RI-*`, `E-DG-*`, `E-PROTECT-*`, `I-AUTH-*`, `I-MATCH-*`.

**This session was the live proof.** The `W-AUTH-001` -> `W-AUTH-MIDDLEWARE-AUTO-INJECTED` split
required both fire sites (`type-system.ts:10820` and `route-inference.ts:5648`). Neither code nor the
`W-AUTH-*` prefix had any row in error.map.md; both loci were found by grep — **the exact failure the
gap was filed for, recurring after the gap was marked resolved.**

**Reason:** map-vs-reality drift, self-inflicted — a false coverage claim is worse than an absent one
because it stops the reader from running the grep that would work.
**Fixed this pass:** claim withdrawn and replaced with the measured 67/185 figure; a `W-AUTH-*` row
added naming BOTH owners and both files; lookup step 0 now routes to `error.generated.md`; step 1
tells the reader to skip to grep rather than infer from an adjacent family. Residual (118 prefixes
routed only via grep) is now STATED in the map instead of papered over.
**Suggested disposition:** REOPEN the gap entry as `status=narrowed` with the half-closed split
recorded, or file a successor. It is currently `resolved` and it is not.

### N2. Four mechanical map indexes are stale, out-of-repo-generated, and were un-referenced
`.claude/maps/` contains `error.generated.md` (353 E-codes -> `file:line`), `structure.generated.md`
(155 files / 1128 exported symbols), `dependencies.generated.md` (488 local import edges) and
`test.generated.md`. Three problems, all measured:
1. **All four are stamped `2026-06-25 16:27`** — ~5 weeks and ~50 commits stale at this HEAD. Drift
   is demonstrable: `error.generated.md` puts `E-PA-002` at `protect-analyzer.ts:790`; the emit is at
   `:828`. `structure.generated.md` reports 155 `compiler/src` files; there are 188.
2. **`error.generated.md` is E-codes ONLY** — zero `W-*`, zero `I-*`. A warning lookup there returns
   nothing and looks like proof the code does not exist. That is a silent-wrong-answer shape.
3. **No curated map referenced any of them** until this pass — four indexes sitting unused beside the
   prose maps that route around them.
**Reason:** stale generated artifact + a routing omission.
**Fixed this pass (routing only):** primary.map.md and error.map.md now route to them WITH the
staleness and the E-only limitation stated. **Not fixed:** the staleness itself.
**Suggested disposition:** they are `@generated by flogence/scripts/mapgen.ts` — **an out-of-repo
script this project's CI does not run.** Decide one of: (a) wire `mapgen.ts` into `cloud-maps` Stage
1 alongside `state.ts` (deterministic, zero AI cost, and it would keep working while Stage 2 is red);
(b) widen it to emit `W-`/`I-` codes and then wire it; (c) delete all four rather than ship indexes
nobody regenerates. **Option (a)+(b) is the recommendation** — a mechanical code->`file:line` index
is the single highest-value artifact in this whole map set for a grep-first agent, and it is the one
piece that does not need an LLM to produce.

### N3. Two maps now exceed the project-mapper 300-content-line guideline
`domain.map.md` 498 lines, `error.map.md` 453, `primary.map.md` 352, `build.map.md` 307. The mapper
contract says "No map exceeds 300 content lines. Introduce grouping before hitting that limit."
**Reason:** accumulated per-window narrative. The growth is real content, not padding — but the
contract's own remedy (grouping) has not been applied for several windows.
**Suggested disposition:** at the next FULL refresh, split `domain.map.md`'s three security-tier
sections (§14.8.9/.10/.11) into a `security.map.md`, and move error.map.md's per-window "new fire
sites" narrative into `docs/changelog.md` (which is already the authority for it) leaving only the
routing tables. Not done here: an incremental pass should not restructure the map set.

## CARRIED — re-executed at this HEAD, all still true

### C1. `hand-off.md` and `master-list.md` still carry the scrubbed third-party adopter identity
Re-counted at `d0763cff`: **`hand-off.md` 3 sites, `master-list.md` 1 site**, unchanged from the
S297 report. `.claude/maps/` is CLEAN (0 sites) and stayed clean through this pass.
**Reason:** incomplete privacy scrub in the public tree (`89db7981` covered 47 files, not these two).
**Suggested disposition:** unchanged from S297 — neutral codename in `hand-off.md`'s live items; the
`master-list.md` echo is a commit TITLE that git history cannot rewrite on a pushed public branch,
which is an irreducible exposure deserving an explicit operator decision rather than a silent carry.

### C2. `cloud-maps` CI — still red, unchanged, `.github/` untouched this window
No workflow file changed between `115e8b1b` and `d0763cff`, so the 17/17 failure analysis in
build.map.md stands verbatim: an API-level rejection of the first request (1 turn, ~0.6s, $0, zero
permission denials), not a mapper fault. **The cost is now measurable across two windows:** this
refresh, like the last one, was PA-dispatched by hand.
**Suggested disposition:** the one-line diagnostic is still outstanding — flip `show_full_output:
true` (or add `--debug`) and fire one `workflow_dispatch`. Tracked as
`g-cloud-maps-ci-red-api-rejection` (MED, open).

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
Re-grepped: exactly **1 site** in `compiler/SPEC.md`. Since `df6d269c` a top-level `<each>` mounts as
a comment fence; no such `<div>` is emitted. The §52.15.5 BEHAVIOUR is correct — only the noun is
stale. **Newly relevant this window:** §17.1 added a SECOND comment-node shape to that surface
(`<!--scrml-if-row-->`), so a reader reconciling the spec's prose against emitted DOM now has two
mismatches to trip over instead of one.
**Suggested disposition:** one clause — "its each-mount fence is left unfilled". No ruling needed.

### C4. Nine live `W-LINT-*` codes have no §34 row
Re-enumerated at this HEAD by `grep -oE 'code:\s*"W-LINT-[0-9]+"'`: **23 distinct live codes**
(`W-LINT-001..008` + `010..024`) in `compiler/src/lint-ghost-patterns.js`. §34 catalogs 14
(`001..008` + `010..015`). **`W-LINT-016`..`024` — exactly nine — are live-but-uncatalogued**, so the
count of codes the compiler can EMIT exceeds the §34 total (800) by at least nine.
**Standing correction:** `W-LINT-009` is NOT live — the `:868` hit is the comment *"(No separate
entry for W-LINT-009 — W-LINT-004 subsumes it.)"*. Grep on `code:\s*"W-LINT-`, not the bare string.
**Suggested disposition:** catalog the nine or rule them internal-only; either way footnote the §34
total as counting the CATALOG, not the implementation.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
The `@generated` totals block tracked this window correctly (`36,641` -> `36,657`, CI-gated). But
re-checked at this HEAD: `grep -c` for `db-authoritative|SECURITY DEFINER|RLS` across the whole file
still returns **0**, and the top banner still reads **"Last updated: 2026-07-20 (S273)"**, narrating
only the §14.8.10 tenant floor. Six sessions after §14.8.11 landed, a dev agent searching the
navigation index by topic for "RLS", "SECURITY DEFINER" or "db-migrate" finds nothing.
**Reason:** currency gap (omission, not contradiction — the section-14 line range still numerically
covers §14.8.11).
**Suggested disposition:** append Quick-Lookup rows for DB-authoritative / RLS / SECURITY DEFINER /
db-migrate -> §14.8.11, and either refresh the banner or retarget it to single-most-recent-session.
**Note the shape:** the generated half of this file is gated and stayed current; the authored half is
ungated and rotted. That is an argument for widening the generator, not for another manual edit.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
Re-counted: **4 sites**, unchanged. `docs/FACTS.md` derives `compiler version` mechanically under a
CI `--check` gate, so this is a hardcoded figure that already has a generated authority.
**Suggested disposition:** replace with a FACTS.md reference. The tutorial is NOT under the snippet
gate as prose — even the widened `docs/website` corpus gates only that a page COMPILES.

### C7. `compiler/native-parser/` parity — zero diff, none owed, one CONFIRMED standing gap
`git diff --name-only 115e8b1b..d0763cff -- compiler/native-parser/` returns **0 files**, and no
parity was owed: this window's landings are placement inference (`route-inference.ts`), component
expansion, emit-time (`emit-each`/`emit-lift`), runtime (`runtime-template.js`) and a build script.
None touches the parsing/AST-shape layer.
- **Confirmed standing gap:** `E-SCRIPT-001` has **0 occurrences** in `parse-markup.js`, which
  carries an explicit `<style>` -> `E-STYLE-001` mirror and no `<script>` counterpart.
- Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
  grounds that nothing changed.

## OPEN — code defects filed at this HEAD

`docs/known-gaps.md` is the authority. Cited for map-set completeness only.

**Filed BY this session's own work, and both are the honest kind (a fix that names its own residual):**
- `g-fn-params-typed-string-actually-objects` — `FunctionDeclNode.params` is typed `string[]` but the
  ast-builder produces `[{name}]` objects, so `new Set(fnNode.params).has(name)` silently returns
  false forever. Fixed in `collectServerOnlyBindingModules`; **the identical latent bug remains in
  `buildClosureCapturesForFunction`**, which feeds capture-taint — a different blast radius, filed
  rather than folded in.
- The `buildImportedServerFnNames` aliasing blind spot — it keys on `names` (the IMPORTED name) not
  `specifiers[].local`, so every `import { x as y }` is missed. On the Trigger-3 path that would be a
  client leak; on ITS path (async classification) it is a missing `await`. Separate fix, separate
  blast radius, deliberately not folded in.

**Gate-integrity items, unchanged and still open:**
- `g-gate-tier-unit-test-red-local-green-cloud` (HIGH) — a unit test inside the BLOCKING gate's own
  scope fails locally while cloud `gate` is green on the same content.
- `g-ci-does-not-run-root-level-test-files` (MED) — 13 of 14 root-level `compiler/tests/` files are
  executed by no workflow, and `ci.yml:82`'s step NAME claims canary coverage its `:83` command does
  not provide.
- `g-cloud-maps-ci-red-api-rejection` (MED) — see C2.

## RESOLVED since the prior report

- **The §34 catalog advanced 799 -> 800**, `comm` set-diff verified, +1/-0:
  `W-AUTH-MIDDLEWARE-AUTO-INJECTED`. It is a SPLIT, not new behaviour — the fire already existed
  under `W-AUTH-001`.
- **`g-gap-counts-silently-drops-unrecognised-status`** (`docs/known-gaps.md:4621`) — closed, and
  closed the right way: the gate was PROVEN to bite before landing (`status=totally-made-up` injected
  into a real marker, `state.ts` threw and named the id, restored, confirmed green). That satisfies
  `pa-base` §8's unproven-gate rule. Verified independently this pass: all 488 live `@gap` markers
  use vocabulary the three status sets name, so the ledger is currently consistent with the parser.
- **`g-trigger-3-server-only-import-does-not-escalate`** — closed by the S299 landing. Note for
  anyone reading older docs: Trigger 3 was **RULED at S280 and BUILT at S299**; any doc dated between
  those two that describes it as live behaviour was wrong at the time it was written.
- **The `<each>` node-id collision** — closed for the `each-block` kind. The residual duplicate-id
  families (defChildren-CSS, slot-fill, channel-inline, for/match) are REDUCED (28 files -> 16), not
  eliminated, and the surviving kinds are `text`/`li`/`p`/`logic` only. Read the closure that way.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

Under `docs/changes/**`, the per-dispatch archive, excluded from content-mapping by scope. Listed
only because they describe work that does NOT exist at this HEAD:
- `docs/changes/esm-chunks/U4-BRIEF.md` + `progress.md` — U4/U5/U6 not built; `classic` is still the
  default and the only conformance-tested format. Cross-chunk navigation IS built for CLASSIC.
- `docs/changes/chunk-namespacing/{BRIEF,SCOPING}.md` — scoping for unbuilt work.
- `docs/changes/navigate-wave1c-piece1-landmark/` — still unverified (carried from S297 N5).
- `docs/changes/marketing-claim-gate/SCOPING.md` — U3+ not built; `scripts/claim-gate.js` exists but
  is deliberately NOT CI-wired.
- **NEW this window, and correctly labelled:** `docs/changes/if-mount-unmount-phase2/SCOPING.md`
  describes Phase-2 work that is **not built** — Phase 2's prerequisite was re-diagnosed twice in one
  session (`c1a9fde7` then `6271e693`) and root-caused to the CE node-id collision, which is now
  fixed, so this doc's PREMISE has changed under it. Scoping-doc, correctly located, but read the two
  commits before treating any of its scoping as current.
- `docs/changes/maps-refresh-s297-2026-07-28/BRIEF.md` — NEW, the archived dispatch prompt for the
  PREVIOUS map refresh. Historical by construction; do not read it as a spec for this one.

## Compliant — new docs this window, checked

- `docs/audits/s34-meaning-axis-2026-07-28.md` — frontmatter `status: current`, `last-reviewed`
  present, `baseline: main@ed2515e7` named, and it OPENS by correcting three of its own dispatch
  brief's structural claims against the file. Correctly located, current, exemplary shape.
- `handOffs/incoming/read/2026-07-29-flogence-to-scrml-*.md` — inbound correspondence in the
  `handOffs/` tree, which is excluded from content-mapping by scope.

## Uncertain — needs human review

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** all unmodified since 2026-06-22 or earlier while SPEC.md has gained §14.8.11, §23.2.4a,
§38.6.2, §39.5.5, §20.8.2 and now §17.1. Not content-verified this pass.
**This has now been deferred FOUR passes running** (S290, S292, S297, S299). At four, "deferred" is
no longer an honest label — it is either scheduled or it is out of scope. Recommend ruling it out of
scope explicitly rather than carrying it a fifth time.
**What to check if scheduled:** grep each for backticked identifiers against `compiler/src/`;
specifically whether any describes a security/auth/DB model predating §14.8.9-§14.8.11, or a
path/coordinate model predating the §47.9.5 dist-space clarification.

### `docs/website/`
**Reason:** carried from S297 and unchanged — retained as a compile fixture
(`g-docs-website-retained-as-test-fixture`) while ALSO being under the snippet gate (98 `.scrml`
files). A compile-gated directory reads as endorsed content, and compiling proves nothing about
prose.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture.

## Map currency notes added this pass

- **The per-window landing narratives were DELETED from `primary.map.md`, `error.map.md` and
  `test.map.md`.** S299 measured ~40% of map content as duplicating `docs/changelog.md`. primary lost
  ~154 of 352 lines (44%), error lost ~143 of 453 (32%), test lost ~80. What replaced them:
  primary's **INVARIANTS AND PROHIBITIONS** table (18 rows), domain's §17.1.2 section (5
  prohibitions), build's "Gate topology — the two failure modes", and three new coverage-shape rules
  in test. **This is a deliberate change of what these maps are FOR** — history is
  `docs/changelog.md` + `handOffs/delta-log.md`; the maps carry rules a grep cannot find.
- **`structure.map.md` is being converted off `+N`-line diff-stat framing.** A row that says "+314
  this window" dates within one session and `git diff --stat` answers it better. Conversion is
  partial: rows this window touched were rewritten, rows it did not still carry the old framing.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · error · structure · test · domain · dependencies · build | `d0763cff` | re-walked this pass against source |
| non-compliance | `d0763cff` | this file — every carried finding re-executed, not copied |
| schema · migrations · config · infra | `115e8b1b` | **deliberately older.** No `ast.ts` / DB / env-var / workflow surface changed this window |
| auth | `df2ac831` | **deliberately older.** The two auth-adjacent facts this window (the `W-AUTH-001` split; `scrml:auth`/`scrml:oauth` in the escalation set) are catalog and placement facts respectively, mapped in error/dependencies — see primary.map.md's Map Index row for the reasoning |
| `*.generated.md` × 4 | `2026-06-25` | **stale, out-of-repo-generated, now at least ROUTED.** See N2 |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## Tags
#non-compliance #project-mapper #revert-sha-not-in-history #spec-call-site-drift #structural-if #§17.1.2 #declared-enforcement-gap #changelog-dereferenced #cleanup #scrml #maps-routing-gap #prefix-coverage-audit #generated-indexes #mapgen-stale #privacy-scrub #adopter-identity #cloud-maps-failing #ci-red #spec-index-currency #each-fence #if-row-comment #native-parser-parity #w-lint-uncatalogued #catalog-count-audit #w-auth-001-split #trigger-3 #node-id-freshness #gap-status-parser #proven-gate #map-size-budget

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [test.map.md](./test.map.md)
- [build.map.md](./build.map.md)
- [migrations.map.md](./migrations.map.md)
- [infra.map.md](./infra.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
