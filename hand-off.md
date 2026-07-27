<!-- ============================================================= -->
<!-- S288 WRAP (bryan/ASUS-Vivobook) — prepended 2026-07-27.       -->
<!-- Peter's S289/S288 addenda + prior wraps UNCHANGED below.      -->
<!-- (Session numbers collide across the two machines — disambig    -->
<!--  by NAME, not number: this is S288-bryan.)                     -->
<!-- ============================================================= -->

# scrml — Session 288 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-07-26/27. `/boot` Profile A. `main` at **`c700c435`**, coherence 0/0 both repos, tree
clean, **no open PRs, no open adopter issues**, gate green. Full suite **21408 pass / 0 fail**.
Mechanical stream: `handOffs/delta-log.md [795]-[805]`. Changelog S288. This carries the irreducible.

## 🎯 THE HEADLINE — one adopter's reports drove the whole session; two fixes were compiler-WIDE classes

Five PRs, all RediLedger-originated. Every one reproduced-or-refuted on the current baseline BEFORE
any change (bryan's opening instruction), every claim verified by EXECUTION rather than by reading
emitted text.

| PR | What |
|---|---|
| #191 `103051ad` | `oneOf`/`notIn` → SQL literals; §39.5.8's "verbatim" note WAS the defect |
| #193 `d5bccc0f` | the db-authoritative tier was **non-functional end-to-end** for a `<schema>`-only app |
| #194 `9c4632fa` | the `users`-table docs gap |
| #196 `1a488c46` | `default()` ×2 + `E-SCHEMA-010` + `db-migrate` failing-statement echo |
| #199 `c700c435` | auto-immutable PK + `tenant_id` |

## 🔴 THE NEXT PA'S FIRST MOVE — a HIGH that arrived AFTER the wrap PR merged

**`g-schema-references-dot-form-emits-no-foreign-key` (HIGH, RediLedger S5).** Their turnkey run
landed post-wrap. Two halves:

**The good half — the verification we owed is DONE and PASSES.** `scrml db-migrate` against their
**real 19-table schema** at `c700c435`: `applied 189 statement(s) in 1 transaction`, verified IN the
resulting database — 34 column DEFAULTs with `now()` intact (the #196 fix, confirmed on a real adopter
schema), 27 CHECK constraints, and #199's auto-immutable PK/`tenant_id` working on their tables
(`jobs.id`/`jobs.tenant_id` not UPDATE-grantable to `scrml_app`, `jobs.name` is — their control).
**Slice 3b is DELIVERED**: 11/11 twice on `d5bccc0f`, again on `c700c435`, on the real login-over-HTTP
→ cookie → per-user-read path — the round trip S288 explicitly said it had NOT proven.

**The HIGH — `<schema>` silently emits NO foreign keys.** 34 `references()` declared → **0 rows in
`pg_constraint WHERE contype='f'`**, and an INSERT naming a non-existent parent was ACCEPTED. Compile
clean, apply clean, no diagnostic.

**Root-caused HERE before wrapping, so the next session starts from the mechanism, not the symptom:**
`parseColumns` matches `/references\s+(\w+)\((\w+)\)/i` — the BARE-PAREN form
`references owners(id)`. The DOT-IN-PARENS form `references(owners.id)` does not match →
`col.references` stays null → no `REFERENCES` clause. **SPEC documents BOTH forms.** Verified both
ways in one probe. A composite table-level `unique(a, b)` emits nothing either (same locus —
`parseColumns` only reads `name: type` lines).

**Two decisions ride along and are bryan's, so do not just widen the regex and land it:**
1. Bug fix or SPEC narrowing? A governing sentence exists for BOTH forms, so accepting both is a
   conformance restoration — but narrowing to one canonical form with a deprecation is defensible and
   is the limit-the-primitive direction.
2. **An FK appearing where none existed is NEWLY-REJECTING against live data.** An existing database
   carrying orphan rows will fail the migration on ALTER. That owes a measured migration path and
   probably a diagnostic, not a silent tightening. This is the pa-base §8 one-way-door analysis in the
   *other* direction from the usual.

This is the S288 through-line for the THIRD time — a form that looks right, compiles clean, and
produces nothing. Same shape as the gate mismatch and the incomplete `default()` fix.

## 🧭 THE THREE FINDINGS THAT OUTLAST THE FIXES (reasoning, not state)

1. **A gate mismatch is more dangerous than a missing feature.** §14.8.11 gates on the `<schema>`
   `db-authoritative` marker; §14.8.10's tenant projection gated on the `<db>` registry. Each half
   was internally consistent, so the tier ENGAGED and faithfully pinned `scrml.tenant = NULL`, and
   RLS matched nothing. Nothing errored anywhere. Compounding it, `_scrml_active_tenant` guards its
   resolver call with `typeof _scrml_current_user === "function"` — **a fail-closed guard that
   converted "resolver missing" into "tenant null" with no diagnostic at all.** When two features
   gate on different signals for the same fact, verify the COMPOSITION, not each half.
2. **A fix verified thoroughly inside too small a surface is still incomplete.** #191 shipped with 11
   tests, an adversarial edge-case matrix and both baselines — and missed `default()`, one function
   away, in the identical literal-as-identifier class. The adopter caught it and called it
   correctly: *an incomplete fix.* **Enumerating shapes inside a function is not the same as
   enumerating the functions a class of defect can inhabit.** The S239 blast-radius question names
   this exactly; I asked it of the item list instead of the emitter.
3. **The DDL negative test proves the floor exists; only the request path proves the app is standing
   on it.** The tier's own live-PG tests open a transaction and HAND-EXECUTE `set_config` before
   asserting — a faithful DDL+RLS test that passed the entire time the feature was dead. Tracked as
   `g-dbauth-no-request-path-test`; RediLedger offered their harness, and per the S273 cloud-flake
   lesson it belongs in the live-PG-gated LOCAL tier executing the shipped handler, not driving a socket.

## ⚠️ OWN MISSES (both mine, both recorded rather than smoothed)

- **The FACTS gate caught a stale regen.** I regenerated after a rebase, then edited `db-migrate.js`
  without re-regenerating; cloud `gate` went red on exactly the S284 rule I had quoted earlier the
  same session. Pre-regen before pushing ANY PR touching `compiler/src`.
- **A bare `git commit` in RediLedger's repo** swept three of THEIR pre-staged renames into my
  commit — the shared-index hazard the explicit-pathspec rule exists to prevent. Local-only, pure
  renames, repaired via `reset --soft` + re-commit with `-- <pathspec>`; their index restored
  byte-for-byte. **Always pathspec a sibling-repo commit.**

## 🔵 OPEN FORK INHERITED FROM PETER — needs bryan (a SPEC ruling, not a bug fix)

**`g-match-nofor-block-form-skips-exhaustiveness` (MED)** — routed to this lane by S288-peter while
he fixed the adopter `<match>`/`<when>` bug (#192). A **real SPEC/impl divergence**:

- **SPEC §18.0.1** lists `for=Type` as **REQUIRED** on block-form `<match>`.
- **The impl supports `<match on=@cell>` WITHOUT `for=`**, inferring the type from the cell's declared
  enum — and existing tests RELY on it (`e-dg-002-false-positive-class`,
  `match-on-atdot-in-each-r28-bug-1`). Peter confirmed it load-bearing and correctly did not touch it.
- **The hole:** `validateMatchBlock` reads `matchBlock.forType` verbatim; absent `for=` it is `""`, so
  the variant set is empty and **`E-MATCH-NOT-EXHAUSTIVE` passes silently**. Empirically on
  `235f47c2`: `<match on=@status>` over `Status = {Ok, Err}` with ONLY an `<Ok>` arm and no wildcard
  **compiles with 0 errors** and the `.Err` case renders nothing. The explicit-`for=` form catches it.

**Two coupled decisions, both bryan's:** (1) reconcile per Rule 4 — either SPEC blesses the inference
form (drop "required") or the impl rejects no-`for=`; the current state is neither. (2) if inference
stays legal, resolve the enum from the `on=` cell's declared type in `validateMatchBlock` (codegen
already does this via arm tags; SYM does not) and run the existing check — the adjacent
`subsetCellRegistry`/`cellStructTypes` machinery is already threaded, a cell→enumType map is what's
missing.

**PA read:** same shape as the S288 gate-mismatch lesson above — two layers disagreeing about where a
fact lives, with the failure landing as SILENCE. It is a tier-1 freeze-surface item (a claimed
exhaustiveness guarantee that does not hold on a legal form), so it wants the ruling before the next
conformance pass, not after.

*Also inbound, FYI only:* S289-peter co-located a 1-line SPEC §12.2 Trigger-6 clarification into the
`W-DEAD-FUNCTION` fix (`73e85e64`, PR #200) — prose only, naming first-class value references and
nested-closure uses as non-dead. Flagged because SPEC is this lane.


## 🧷 CONCURRENT / HELD

- **Peter was live ALL session** (S288-peter, S289-peter) — #192/#197/#198/#200/#201. **Four rebases.**
  Every conflict was confined to GENERATED files (`FACTS.md`, gap-counts), resolved by REGENERATING
  rather than hand-merging, with a full gate re-run on each rebased tip (21398→21408, 0 fail) proving
  no write-skew across lanes. **Cadence note for the next PA: with two lanes landing this fast, a
  long-running branch pays a rebase toll per landing — land smaller and sooner.**
- **Retained worktrees (do NOT delete):** `worktree-agent-a2ed001a5de228134` [`feat/wave1c-nav`] —
  Wave-1c, unblocked, unbuilt. Plus the pre-existing `s251` tree (not this session's) and the
  persistent `scrml-spa-ss*` sPA trees.
- **Cleaned this wrap:** `s288-prep2-79cd79ce` (the pre-P2 reproduction worktree; purpose served).

## 📥 INBOX

- **`2026-07-22-2230-from-S282-to-XPS`** — LEFT in `incoming/`. This machine-family's own OUTBOUND to
  the XPS clone; the boot hook flags it every turn but it is not for this machine. Unchanged
  disposition since S284.
- RediLedger ×2 (the S4 session-principal report, the S5 ack) — both drained to `read/`, both replied
  to; the reply is committed AND pushed on their `scrml-rewrite` (`d440deb`).

## ✅ GATE / MAPS

- Full suite **21408 pass / 0 fail**. `gate` green on every merge and at HEAD (`c700c435`). Generated
  docs (`FACTS.md`, `state.ts` §0) `--check` PASS.
- `tracking` fails on 3 known tests every run (serve-tool R26 flake + the two gitignored self-host
  artifacts `bs.js`/`tab.js`) — verified directly on #191 and #193, inferred thereafter. Non-required.
- ⚠️ **MAPS — corrected note, twice.** A `project-mapper` dispatch was fired at wrap. After ~15 min of
  silence I recorded it as "produced no output" and hand-patched `migrations.map.md` myself (it was
  actively WRONG — naming `g-db-migrate-check-constraint-oneof-pattern` as open and "the natural next
  `db-migrate` fix" when this session resolved it). **That call was premature twice over:** the agent
  then wrote `error`/`schema`, and finally COMPLETED at ~23 min with a full pass, overwriting my
  hand-patch with a better rewrite. **The wrap commit message on #202 still says "produced NO output"
  and is wrong; this is the corrected record.** Lesson for the next PA: a `project-mapper` pass on
  this repo runs ~23 minutes — do not call it dead at 15.
- **Map state:** `primary` · `error` · `schema` · `migrations` · `domain` all refreshed and stamped
  `c700c435`. The agent deliberately LEFT `structure`/`dependencies`/`build`/`test`/`config`/`auth`/
  `infra` at their prior honest stamps because it did not re-verify their source — that is correct
  behavior, not an omission. It also flagged **`test.map.md`'s test-file counts as now stale** (a
  future pass should recount) and left `non-compliance.report.md` untouched rather than fabricate a
  sweep it did not run.
- **Not in any map:** the FK HIGH above (`b1856870`) postdates the mapped window — the agent flagged
  this itself. Pick it up in the next incremental pass.

## Tags
#session-288-bryan #rediledger-arc #5-prs #oneof-sql-literals #currentuser-binding #schema-tenant-registry #default-emission #e-schema-010-ruled #auto-immutable-pk-tenant #gate-mismatch-lesson #incomplete-fix-lesson #request-path-test-debt #facts-gate-caught-me #sibling-repo-pathspec-miss #four-rebases-peter-concurrent

---

<!-- ============================================================= -->
<!-- S289 WRAP (Peter/AdiPDesk, adopter lane) — prepended 2026-07-27. -->
<!-- S288 wrap + all prior UNCHANGED below.                          -->
<!-- ============================================================= -->

# scrml — Session 289 (Peter · AdiPDesk) — WRAP — adopter #195 W-DEAD-FUNCTION false-positives fixed

**Date:** 2026-07-27. `/boot` Profile A on AdiPDesk (Peter), full reads. `main` at **`73e85e64`**, coherence 0/0, tree clean, no open PRs (mine). Delta-log `[793]-[794]`. Changelog S289. One adopter bug closed. This carries the irreducible.

## 🎯 THE HEADLINE — adopter #195 closed (PR #200, `73e85e64`); the fix is dead-code-reachability-SCOPED, not a shared-collector change
`W-DEAD-FUNCTION` (§12.2 Trigger 6) false-fired on two live-code classes Peter found in a real-app dead-code sweep: **(1)** a fn called only inside a nested closure body (arrow / `function`-expression — `.sort((a,b)=>cmp(a,b))`); **(2)** a fn passed as a first-class value (`setTimeout(fn)`, `el.onscroll=fn`, `[fn]`, `{h:fn}`, ternary/return). Warning-only (the tree-shaker already retains them) but "delete dead functions" would have removed 5 live fns. Fix = a NEW dead-code-reachability-only set `logicReferencedFnNames` in `route-inference.ts` (harvest call-callee OR bare value-ref, descending closures, non-self) + ONE D4 gate term. SPEC §12.2 Trigger 6 co-located 1-line clarification (no new §34 code). +9 route-inference.test.js.

## 🧭 THE LESSON worth carrying — the SHARED-COLLECTOR scoping catch (re-derive a gap's fix DIRECTION, don't just implement it)
The issue's stated fix — *"the reachability analysis should descend into nested bodies"* — is **right for dead-code but dangerous if applied literally.** The D4 dead-warn walk builds its caller edges from `record.callees` (→`exprNodeCollectCallees`→`forEachCallInExprNode`), which is **SHARED** — it also drives §12.2 **server-placement inference** (Step 5c caller-context propagation) + E-ROUTE-001. Broadening that shared collector to descend into closures would have silently moved server/client placement (spec-implicating, out of scope, real regression). So the fix is a **separate dead-code-only reference set + one gate term; the shared path is UNTOUCHED** (verified by diff + a server-placement regression guard: a `?{}`-helper called only in a client arrow keeps its server route). This is [[feedback-gap-report-fix-direction-can-be-wrong]] again — the reported locus/direction needed re-derivation before implementing.

## 🔬 METHOD (AdiPDesk) — verify-the-CLASS earned its cost, all on committed state
Dispatched `general-purpose` fallback (canonical `scrml-js-codegen-engineer` absent on AdiPDesk) with a self-contained brief carrying the fix + the hard constraint + the bug-class sweep. PA-side S239 pass was an **independent adversarial construct-reproducer set** (not the agent's tests), compiled on the COMMITTED branch: 2-deep nested closures · block-body arrows · value-refs INSIDE closures · array/object/ternary positions all suppressed; controls (truly-dead, self-recursive-only) + the `pay`⊂`payroll` substring case still fire; server-placement no-leak; **W-DEAD blast radius (all 10 W-DEAD-referencing test files) 351/0**; R26 on landed main (only the control `trulyDead` warns). The **local full suite showed 1067 fails — environmental** (fresh worktree with no `bun run pretest` → browser/happy-dom/self-host cascade), NOT the fix: proven by the green blast radius + the fix touching only W-DEAD emission. Cloud `gate` (the authority) GREEN on #200; `tracking`/`ai-review` red = the known non-required flakes; `windows` green.

## 🧷 CONCURRENT / CROSS-MACHINE
- **bryan LIVE all session.** His PR **#196** (schema `default()` balanced-capture + `E-SCHEMA-010` bareword, `1a488c46`) merged mid-session — I cut my branch fresh off it and applied my SPEC.md **§12.2 delta SURGICALLY** (a `git apply` of the agent's own-base hunk, NOT a wholesale checkout) to avoid clobbering his §39 edits (OCC lost-update discipline — SPEC.md is a shared hot doc). His **#199** (auto-immutable PK/tenant, SPEC §14.8.11.2) is OPEN — his lane, disjoint. **Bryan notice sent** → `scrml-support/handOffs/incoming/2026-07-27-0709-from-S289-peter-to-bryan-spec-12.2-trigger6-...md` (FYI, SPEC §12.2 Trigger-6 heads-up).

## 🔴 OPEN / QUEUED for the next Peter-lane boot (NOT started)
- `g-item-derived-local-stale-in-per-item-effect-paths` (MED, S288 natural-next — the for-lift per-item effect wrappers re-resolve only the iterVar, not item-derived locals).
- auto-await expr-positions MED×2 (`g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait`).
- `g-attr-writer-conflict-not-detected-template-value-form` (MED).
- #173 amplification halves.

## ✅ GATE / MAPS
- W-DEAD blast radius **351/0** (route-inference 210 + usage-analyzer/endpoint 73 + const-let-sql/dep-graph/spec-server-deprecate/todomvc-edit/nested-fn-sql-escalation + 2 lsp). Cloud `gate` GREEN on #200. FACTS `--check` PASS (regen rode the PR).
- **Maps unchanged** — internal edit to the existing `route-inference.ts` + a SPEC prose line; no new surface files (S286/S288 internal-edits-no-refresh precedent). Map stamp `f8a138e9`.

## Tags
#session-289-peter #adopter-195-w-dead-function-false-positives #closure-body-and-first-class-value-reachability #shared-collector-scoping-catch #server-placement-no-leak #gap-report-direction-re-derived #general-purpose-fallback-agent #bryan-196-merged-midsession-surgical-spec-apply #adipdesk-full-suite-1067-environmental

---

<!-- ============================================================= -->
<!-- S288 WRAP (Peter/AdiPDesk, adopter lane) — prepended 2026-07-26. -->
<!-- bryan's S287 wrap + all prior UNCHANGED below.                  -->
<!-- (S288 number collides w/ bryan's concurrent s288-tagged chores; -->
<!--  disambiguate by name — this is Peter/AdiPDesk.)                -->
<!-- ============================================================= -->

# scrml — Session 288 (Peter · AdiPDesk) — WRAP — two HIGH adopter bugs landed

**Date:** 2026-07-26. `/boot` Profile A on AdiPDesk (Peter). `main` at **`52585b25`**, scrml coherence 0/0, tree clean, no open PRs (mine). Delta-log `[787]`+. Changelog S288. This carries the irreducible. **Both recommended HIGH adopter bugs FIXED, verified, merged.**

## 🎯 THE HEADLINE — the two queued HIGH gaps are closed, and BOTH gap reports' stated fix directions were WRONG (corrected)
- **`g-match-without-for-plus-when-children` (HIGH) → PR #192 (`235f47c2`), `E-MATCH-INVALID-ARM`.** Ghost `<when is="…">` arms at the block-form `<match>` arm position were silently dropped by the Phase-2 arm tokenizer (`isArmOpener` only accepts `<`+`[A-Z_]`) → zero recognised arms → the match tree-shook to nothing → a DEAD PAGE with 0 errors. **The gap said "reject `<match>` without `for=`" — WRONG:** `<match on=@cell>` without `for=` is a LEGITIMATE inferred-type form (e-dg-002 / match-on-atdot tests rely on it); rejecting it would break valid code. Real fix = arm-validation in `parseMatchArms` (emit one E-MATCH-INVALID-ARM per stray tag, skip the element as a unit). The reviewer's "match-in-a-div emits no codegen" claim was DISPROVEN (that was the same `<when>` bug conflated).
- **`g-nested-for-lift-no-reconcile-on-cell-replace` (HIGH) → PR #197 (`52585b25`).** A nested Tier-0 `for (s of e.states) { lift }` inside an outer reconciled `${for (e of @engines) lift}` rendered STALE inner content on REPLACE of `@engines`: the outer reconcile keys by `id ?? index`, so index-key match → DOM node REUSED → the inner one-shot creation-loop never re-ran (outer `<h3>` updated via its live-keyed effect → stale-but-plausible pane). **The gap's `emit-each.ts:1041` hypothesis was WRONG** — the defect was the Tier-0 for-lift emitter (`emit-lift.js emitForStmtWithContainer`), not the each createElement path. Fix = when an inner for-lift's iterable depends transitively on an enclosing reconciled item, emit its OWN reactive inner reconcile (dynamic `_scrml_effect` re-resolves the live ancestor item(s) by key, replays item-derived local aliases, reconciles). Dependence resolved across the WHOLE ancestor ctx stack + EVERY decl form.

## 🧭 THE LESSON worth carrying (reconfirmed at scale) — adversarial-review-before-land caught 3 real HIGH false-negatives across Gap 2
Gap 2 went dev-agent-dispatch → **TWO adversarial-review rounds**, each of which BROKE the then-current fix on nearby shapes the happy-path tests missed:
- Round-1 review: whole-stack ancestor ref (`for (g){for(r){for(c of g.rows)}}`) + local alias (`let sts=e.states`) both slipped the single-innermost-ctx predicate → still stale.
- Round-2 review: object destructure (`let {states}=e`, idiomatic), array/rest destructure, and expr-form init (`let x=for(…)`) all skipped by the detection scan → still stale.
Each was the EXACT reported bug reached through a different binding form. **This is the [[feedback-verify-the-bug-class-not-just-reported-instance]] discipline earning its cost — a single-shape codegen fix landed on a green happy-path is an incomplete fix (the S285 "needed a 2nd PR" pattern). For a reconciler/codegen fix, sweep the bug CLASS across all binding/nesting forms via an independent break-it reviewer BEFORE landing.** Decl forms are finite {simple, member/method, alias, destructure, rest, expr-form} → the fix converged after round 3; the detection is now decl-form-exhaustive.

## 🔴 OPEN / QUEUED for the next Peter-lane boot (filed this session, NOT started)
- **`g-item-derived-local-stale-in-per-item-effect-paths` (MED, NEW S288)** — the natural next arc. The Gap-2 fix made the inner-list RECONCILE path re-resolve item-derived locals, but the OTHER per-item effect wrappers (`maybeWrapLiftPerItemEffect` for TEXT bindings, + almost-certainly attr/event) re-resolve only the iterVar, not item-derived locals: `let {name}=e; lift <h3>${name}</h3>` stays stale on REPLACE (confirmed executed-DOM for text; attr/event unverified). Fix = thread the same `scanItemDerivedLocals`/`_pullFromText` replay into those per-item effect paths. Idiomatic → worth its own focused arc.
- **`g-match-nofor-block-form-skips-exhaustiveness` (MED, NEW S288 — bryan's tier-1 lane)** — a no-`for=` `<match on=@enumCell>` skips exhaustiveness ENTIRELY (a missing variant + no wildcard compiles clean). Intersects a real SPEC/impl divergence: SPEC §18.0.1 line 1073 lists `for=Type` as REQUIRED, but the impl supports (and tests rely on) `on=@cell` inference. Either SPEC blesses inference (Rule 4 reconcile) or impl rejects no-`for=`; then wire on-cell-type→exhaustiveness in `validateMatchBlock`. Surfaced to bryan.
- **From the S285/S286 Peter queue (still open):** auto-await expr-positions MED×2 (`g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait`) · `g-attr-writer-conflict-not-detected-template-value-form` (MED) · #173 amplification halves.

## 🧷 CONCURRENT / CROSS-MACHINE
- **bryan's DB-authoritative lane was ACTIVE concurrently** — #191 (db-migrate CHECK oneOf/notIn→SQL literals), #193 (@currentUser in RI-route + tenant registry from `<schema>`), #194 (db-auth users-table docs gap) landed on `main` WHILE I worked. My two PRs rebased cleanly over each (disjoint surface: match-parser / for-lift-codegen vs schema/dbauth). No live `S288-bryan` board file seen — bryan tagged #194 "chore(s288)" (session-number collision, 2 machines; disambiguate by name). If bryan is still live, this wrap advances ONLY the Peter lane's durable state; main is PR-serialized regardless.
- **scrml-support boot-merge (uncommitted → committed THIS wrap):** at boot `user-voice-pjoliver11.md` had a local flogence-S35 addition that conflicted with the upstream S286 entry on rebase — I kept BOTH (chronological). Committed this wrap.

## 🖥️ AdiPDesk specifics (carry — this machine)
- **NO local git hooks** (only `.sample`) — cloud `gate` is the sole authority. **canonical `scrml-js-codegen-engineer` NOT installed** — used `general-purpose` fallback with thorough self-contained briefs (worked for the Gap-2 dispatch + 2 fix rounds). Full-suite baseline has ~11 pre-existing lift/each fails + ~8 integration (self-host-smoke ×4 / CSRF ×2 / teardown) — PROVEN pre-existing (verified identical on HEAD); Linux cloud gate is clean on them. Run WITHOUT `--bail`.
- **CI shape (both PRs):** `gate` (required) + `windows` = GREEN; `tracking`/`ai-review` = RED non-required → auto-merge on gate-green. Matched S284-S287.

## ✅ GATE / MAPS
- unit **16895 / 0 fail / 17 skip** · conformance **746/746** · Gap-2 gate `g-nested-for-lift-no-reconcile-on-cell-replace.browser.test.js` **15 executed-DOM cases** (all fail→pass verified) · Gap-1 `g-match-invalid-arm-ghost-pattern.test.js` **10 cases**. lift/each subset: 0 NEW fails (11 pre-existing, verified on HEAD). FACTS `--check` PASS (regenerated in both PRs).
- **Maps: unchanged** — both fixes were internal codegen/parser edits to EXISTING files (`match-statechild-parser.ts`, `emit-lift.js`, `emit-control-flow.ts`, `emit-logic.ts`); no new surface files. (New error code E-MATCH-INVALID-ARM + a couple exported helpers — not structural.) Consistent with the S286-peter internal-edits-no-refresh precedent.

## Tags
#session-288-peter #adopter-match-when-ghost-pattern-E-MATCH-INVALID-ARM #adopter-nested-for-lift-reconcile-on-replace #both-gap-reports-fix-direction-corrected #adversarial-caught-3-HIGH-false-negatives-preland #verify-the-bug-class #2-new-gaps-filed #bryan-dbauth-concurrent-191-193-194 #general-purpose-fallback-agent

---

<!-- ============================================================= -->
<!-- S287 WRAP (bryan/ASUS-Vivobook) — prepended 2026-07-26.        -->
<!-- Prior S286 wrap + Peter addendum UNCHANGED below.             -->
<!-- ============================================================= -->

# scrml — Session 287 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-07-26. `/boot` Profile A. `main` at **`f8a138e9`**, both repos coherence 0/0, tree clean, no open PRs, CI gate green. Mechanical stream: `handOffs/delta-log.md [775]-[786]`. Changelog S287 (three entries). This carries the irreducible.

## 🎯 THE HEADLINE — the DB-authoritative security tier is COMPLETE for reads + writes
From a bare `/boot`, the tier went from **nonexistent → M1 (emit) + M2 (apply) + P2 (write-authority)**, each: **deep-dive → bryan ruling → build → adversarial security review → independent PG16 verify → land via PR**. All three PG16-proven; **RediLedger run-verified invariant #1 in their real app** (Track-R slice 3a). Six PRs merged this session: #182 (board-hygiene), #183 (M1), #184 (M1 bookkeeping), #185 (M2), #186 (M2 bookkeeping), #188 (P2), #189 (P2 bookkeeping). ~~Peter's lane was quiet~~ — solo all session.

| Milestone | PR / SHA | What | Adversarial review |
|---|---|---|---|
| **M1 emit** | #183 | per-table `db-authoritative` → S1 RLS + S6 bounded-role DDL; A1/S2 principal txn wrapper (`set_config(scrml.tenant)`+`SET LOCAL ROLE scrml_app`); `E-DBAUTH-SQLITE` | **HIGH caught+fixed**: `wrapPrincipalTxn` mangled module-level idempotency helpers → ReferenceError. Scope-aware fix. |
| **M2 apply** | #185 | `scrml db-migrate` (privileged out-of-app CLI): reads `<schema>`+actual, diffs, applies under advisory-xact-lock + thin `_scrml_migrations` ledger + no-bare-DROP fence | **HIGH caught+fixed**: unescaped live-DB identifier injection → durable tenant-isolation bypass + RCE. `sql-ident.ts quoteIdent`. |
| **P2 writes** | #188, `1c8aef79` | `immutable` columns (M1 GRANT reshaped) + SECDEF mutation-choke (`fn … security definer` in `<schema>`, hardened, bounded owner role, un-bypassable `public.scrml_has_cap` gate) | **CLEAN** — 6 empirical attacks, could not defeat; proowner=bounded confirmed. 3 LOW folded. |

**DDs (all in `scrml-support/docs/deep-dives/`, frontmatter carries the RULING):** `db-authoritative-security-design-2026-07-25` + `-PHASING-PLAN-` (M1 threshold), `db-authoritative-migration-apply-seam-2026-07-26` (M2, ruled deep-dive-it-first then your-recs), `db-authoritative-p2-writes-authority-2026-07-26` (P2, ruled S4-A + your-recs).

## 🔴 THE NATURAL NEXT ARC (bryan surfaced the options at wrap; his call at next boot)
**My lean: the `db-migrate` CHECK-constraint fix** — `g-db-migrate-check-constraint-oneof-pattern` (MED, adopter-reported by RediLedger, well-bisected to `79cd79ce`). Three sub-bugs in `schema-differ.js`: (1) `oneOf([...])` emits unquoted barewords in the CHECK (`IN (income, expense)` not `IN ('income','expense')`); (2) a `oneOf`/`pattern` column trips the newline diff-parser → false `E-DBAUTH-NO-TENANT-COLUMN`; (3) `pattern(/…{n}…/)` brace fools the marker matcher (touches the brace-matcher P2 rewrote — **REPRODUCE all three on post-P2 `1c8aef79` FIRST**; #3 may have shifted). Non-gating for RediLedger (workaround in place) but blocks turnkey-from-source for real (CHECK-carrying) schemas — the highest-value small fix on the board. Scoped `schema-differ` fix.

**Other queued (bryan's pick):** **P3 integrity** (double-entry balance / DEFERRED-constraint trigger + audit hash-chain — RediLedger's HC-5; needs a DD) · **caps-provenance** (`g-dbauth-p2-caps-provenance` MED — P2's `requires cap` SECDEFs are **fail-closed inert-deny** until a real session caps source is wired; couples to S8 live revocation) · **S9 decimal** money type + wire-codec seam · **M2 fast-follow** (build-`.sql` artifact · `scrml dev` auto-apply · S7-full) · **Wave-1c nav**.

## ⚠️ OPEN for the next PA's judgment
- **`g-dbauth-p2-pk-tenant-not-auto-immutable` (LOW, design call for bryan)** — a db-authoritative table's PK + `tenant_id` are still UPDATE-grantable (fails-safe: cross-tenant blocked by RLS WITH CHECK, but within-tenant PK UPDATE succeeds). Auto-immutable-PK/tenant (safe default) vs author-explicit. Surface to bryan.
- **The tier's threat-model honesty** (now in SPEC §14.8.11.2): the GUC principal (`scrml.tenant` + `scrml.principal.caps`) is **self-settable by a `scrml_app` with an injectable SQL channel** — the cap gate + tenant isolation are enforced against a *non-compromised* app (scrml's parameterized emission is the guard); the HARD authorities surviving app compromise are the immutable REVOKE + SECDEF-only-choke + NOBYPASSRLS. Do NOT let the tier be over-sold. RediLedger was told this explicitly.

## 🧭 ANOMALIES / LESSONS (reasoning, not state)
1. **Adversarial-not-confirmatory earned its cost 3× this session** (M1 idempotency-wrap HIGH, M2 identifier-injection HIGH — both invisible to the happy-path acceptance test + my own read; P2 clean only after the review confirmed it). The independent break-it reviewer is MANDATORY for authorization/security emission; my own read is confirmation-biased.
2. **verify-the-premise-empirically reframed two arcs**: the apply-seam looked like a MED patch but scrml had NO DB-schema-apply path at all (foundational); M2's DD line-numbers had drifted. Compile/grep the actual target before scoping.
3. **R26 through a REAL non-superuser migrator caught a gap in my own P2 brief** (owner-provisioning grants — the SECDEF would otherwise run as the migrator, defeating the bounded owner). Executing the real deploy posture > reading the emit.
4. The `2d0525df` pages-release chore landed on main mid-P2-PR (disjoint) → a server-side `gh api update-branch` (not a local rebase — the earlier apply-seam-era local rebase hung on a per-commit hook).

## 🧷 CONCURRENT / HELD
- **SOLO all session.** No live sibling. Registered S287-bryan on the board (now marked CLOSED).
- **Retained worktrees (do NOT delete):** `worktree-agent-a2ed001a5de228134` [`feat/wave1c-nav`] — Wave-1c nav, unblocked by chunk-ns, unbuilt. Plus a pre-existing `s251` worktree (NOT this session's — left untouched; a stale-cleanup candidate for whoever owns it).

## 📥 INBOX
- **`2026-07-22-2230-from-S282-to-XPS`** — LEFT in `incoming/` (this machine-family's outbound to the XPS clone; the boot hook keeps flagging it until XPS consumes it; not for this machine). All RediLedger inbound drained to `read/` + acked cross-repo (their `scrml-rewrite`).

## ✅ GATE / MAPS
- Full suite: **21351 pass / 0 fail / ~20 skip** (measured on the P2 build; unchanged since — the #189 bookkeeping was docs-only). main is gate-green by every merge's cloud `gate` + pre-commit hook. The wrap-time local re-run neared the 300s timeout (the integration PG tests are slow run all-together) — not a failure. Generated docs (`FACTS.md`, `state.ts` §0) `--check` PASS.
- Maps: refreshed at wrap (`project-mapper` incremental on the db-authoritative subsystem → watermark `f8a138e9`).

## Tags
#session-287-bryan #db-authoritative-COMPLETE-reads+writes #m1-emit #m2-apply-dbmigrate #p2-writes-authority-secdef #3-adversarial-HIGHs-caught #rediledger-run-verified-invariant1 #check-constraint-bug-next #caps-provenance-open #solo

---

<!-- ============================================================= -->
<!-- S286 WRAP (bryan/ASUS-Vivobook) — prepended 2026-07-25.        -->
<!-- Peter/AdiPDesk S286 adopter-lane addendum UNCHANGED below.     -->
<!-- (S286 session-number collides: two machines. Disambig by name) -->
<!-- ============================================================= -->

# scrml — Session 286 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-07-25. `/boot` Profile A. `main` at **`1c5c2aee`** (PR #180 chunk-ns landing), CI `gate` GREEN, coherence 0/0. Two big arcs: **(1) the chunk-namespacing BUG-6 rename LANDED** (the boot-gating item), **(2) the RediLedger DB-authoritative security ask → DD → threshold ruled → full scope/phasing ruled → Milestone-1 P0 spike validated.** Mechanical stream in `handOffs/delta-log.md [767]+` (bryan-S286 section). Changelog S286. This carries the irreducible.

## 🔴 THE NEXT PRIORITY — RediLedger DB-authoritative Milestone-1 codegen build

**bryan RULED "add the tier" + the full scope/phasing (all five to PA recs) + "kick off Milestone 1".** The P0 spike is DONE (mechanism empirically validated); the next step is the **codegen build**, NOT started.

**Boot the build from `scrml-support/docs/deep-dives/db-authoritative-security-PHASING-PLAN-2026-07-25.md`** (ruled plan of record) + the DD (`db-authoritative-security-design-2026-07-25.md`, the evidence). The plan's "Milestone 1 — P0 spike RESULT" section carries the findings that shape the codegen.

**Ruled decisions (do NOT re-litigate — user-voice S286):** phasing = **reads-first** (P0 foundations A1+S2, S7-min fence → P1 reads-authoritative RLS+S6 roles → P2 writes column-GRANT+SECDEF-managed-text → P3 triggers → P4 tail; seam = the §14.8.10 firewall, P1 relocates the invariant/doesn't cross, P2+ crosses) · A1 = **pooled + `SET LOCAL ROLE` + `set_config(...,true)` in a per-request txn** · SQLite = **hard-fail `E-DBAUTH-SQLITE`** · SECDEF/trigger bodies = **managed plpgsql-text** (NOT a mini-compiler) · acceptance unit = decl + DDL + `SET LOCAL` + migration-preservation + **direct-`psql`-denied negative test**.

**P0 spike findings (validated vs real Postgres 16 via Bun.SQL — shape the codegen):** (1) **superuser BYPASSES `FORCE RLS`** → per-request principal MUST be a bounded `NOBYPASSRLS` role → **S6 mandatory in P1** (A1-without-S6 = silent no-op). (2) **`SET LOCAL` can't be parameterized** → emit `set_config('scrml.tenant', $x, true)` + `SET LOCAL ROLE`; confirmed txn-scoped, no pooled bleed. (3) **`USING` doubles as `WITH CHECK` for INSERT** → P1 blocks cross-tenant inserts free. (4) Bun.SQL socket peer-auth = `new SQL({ path: "/var/run/postgresql", database, username })`.

**The build = a real `scrml-js-codegen-engineer` dispatch (higher-risk — A1 reverses the single ambient `new SQL()` handle on the hottest path, `emit-server.ts:4738-4764`):** S7-min fence → S1/S6 emitters → wire the negative test into the harness → land atomically. **Never dispatched — bryan wrapped instead. Teed up.** Spike script: scratchpad `dbauth-spike.ts` (5/5 core). Local Postgres 16 available (socket `/var/run/postgresql`) for the negative-test harness.

## 🎬 WHAT LANDED / DECIDED
- **PR #180 (`1c5c2aee`) — chunk-namespacing BUG-6 rename FINISHED + LANDED.** S283 campaign + S286 finish (agent `0cbfe5be`, 44 commits) reconciled onto Peter's main. **Closes #27**; **unblocks Wave-1c + ESM U4**. gzip holds 16 KB; anti-masking proven (`chunk-ns-intact-bundle-acceptance.test.js`).
- **RediLedger DB-authoritative** — DD + threshold ruled (add-tier) + scope/phasing ruled (5 recs) + phasing plan + M1 P0 spike. **freeze-bar TIMING relaxed** (bryan: the freeze/split rush "jumped the gun"; profile + master-list reconciled this wrap).
- **Replies sent (reply-on-resolve, adopted from flogence §4):** RediLedger ×2, flogence ×1 (Case-2 witness HOLD).

## 🧭 ANOMALIES (recovered — reasoning)
1. **Finish agent ENOTIMP crash + resume** — transient API error mid-Phase-4 after 34 WIP commits (green). SendMessage-resumed (first crash, transient → resumable); completed.
2. **Stale-index bug caught pre-push** — `8b571a07` committed RAW assertions from a stale index (earlier pkill'd commits), yet its gate PASSED because the pre-commit hook tests the WORKING TREE (my correct cs edits), not the committed index. Caught via a compile-probe before push; fixed `f440e721`. **LESSON: `git add` before every commit; gate-green ≠ committed-content-right when index≠worktree.**
3. **Reconcile write-skew caught by the gate** — the rename merged clean over Peter's #175, but the full suite caught #175's tests asserting the pre-rename accessor. Fixed unit (5) + browser (keyed via `chunkCellKey`). The OCC backstop, as doctrine says.
4. **pkill matched my own commit's hook** (`bun test compiler/tests/unit…`) → aborted a commit (exit 144). Don't pkill a test-pattern mid-commit.
5. **Wrap-conflation correction (DURABLE, user-voice S286)** — floated a wrap-pacing decision at 53%, conflating wrap with landing/CI/bookkeeping. Wrap = session-END only; never manufacture a wrap-pacing decision above ~20% remaining.

## 🧷 CONCURRENT / HELD
- **Peter (S285/S286) adopter lane** — landed #171-#179 while I worked (delta `[763]-[766]`); his #175/#174 forced the reconcile. S286 number collides (2 machines; disambig by name).
- **Retained worktree (do NOT delete):** `worktree-agent-a2ed001a5de228134` (Wave-1c — UNBLOCKED by the chunk-ns land, not yet built; the next execution arc after/alongside the RediLedger build) · local `feat/wave1c-nav` · `origin/evidence/u4-premise-falsified`.
- **Cleaned this wrap:** chunk-ns finish/rename/base worktrees (a4e2f7f2, a91ad13, bug6-base — landed via #180) + `finish/chunk-ns-bug6-rename`.

## 📥 INBOX
- **XPS-outbound** — LEFT in `incoming/` (this machine's outbound to XPS; unconsumed; archiving denies XPS's boot from auto-flagging it). bryan didn't rule leave-vs-archive → defaulted LEAVE. The boot hook keeps flagging it until XPS consumes it.
- **RediLedger + flogence** — REPLIED → moved to `read/` this wrap.

## 🗺️ Maps
Refreshed this wrap (`project-mapper` incremental — chunk-ns + #171-#179 surface; stamp → `1c5c2aee`; was `e8fdd44c`).

## Tags
#session-286-bryan #chunk-ns-LANDED-pr180 #adopter-27-closed #rediledger-db-authoritative-ruled #m1-p0-spike-validated #freeze-timing-relaxed #reply-on-resolve #stale-index-caught #wrap-conflation-corrected #peter-concurrent-171-179

---

<!-- ============================================================= -->
<!-- S286 ADDENDUM (Peter/AdiPDesk, adopter lane) — prepended.      -->
<!-- S285 addendum + bryan's S284 chunk-ns wrap UNCHANGED below.    -->
<!-- ============================================================= -->

# scrml — S286 addendum (Peter/AdiPDesk) — adopter form-binding pair closed

**Date:** 2026-07-24. `/boot` Profile A on AdiPDesk (Peter). **SOLO** (S285-peter closed; bryan S284 wrapped). `main` at `2d192b6`, clean, coherence 0/0. **2 PRs merged** (#177 #178). Full detail: `changelog.md` S286 + delta-log `[763]-[766]` + board `../scrml-support/handOffs/active-sessions/S286-peter.md`. This is the irreducible.

## Landed (adopter form-binding lane — the paired reason form input didn't work in `<each>`)
- **#175 closed** (`c8dbd04`, PR #177) — `bind:value` value-side wired inside `<each>` (the S216 "Half-2"). Reuses `emitBindDirectiveBody` (root-agnostic Half-1 lowering) + a reconcile-lifecycle effect wrapper; outer/shared-cell scope; item-field RHS deferred *loudly* via NEW `W-EACH-BIND-ITEM-FIELD-DEFERRED` (§34). Generalizes to checked/selected/group.
- **#174 closed** (`2d192b6`, PR #178) — reactive form-control `value=` writes the `.value` PROPERTY (not setAttribute), both top-level (`emit-bindings.ts`) + each (`emit-each.ts`) paths, caret-safe guard. Axiom① guard: property route only when `value=` is the sole `.value` writer (bind:value present → value= falls back to setAttribute).

## Open for a fresh boot (Peter lane, queued — NOT started)
- **`g-attr-writer-conflict-not-detected-template-value-form`** (MED, NEW this session) — template `value="${}"`+`bind:value` silently defers to bind:value instead of emitting `E-ATTR-WRITER-CONFLICT` (the template-attr path never runs `analyzeWriterConflict`; the paren `value=(expr)` form does). Not runtime-wrong (the #174 guard prevents the double-write); the gap is the MISSING diagnostic. Fix = route the template `value=` path through `analyzeWriterConflict`.
- **From the S285 queue (still open, Peter lane):** `g-match-without-for-plus-when-children-silent-undeclared-dispatch` (HIGH — invented `<when>` children → silent runtime ReferenceError; clean diagnostic fix) · `g-nested-for-lift-no-reconcile-on-cell-replace` (HIGH — stale render on cell replace; reconciler internals; we're warm on this surface) · auto-await expr-positions MED×2 (`g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait`) · the #173 amplification halves.
- **#27** (navigate soft-nav) — still gated on bryan's chunk-namespacing.

## Method / anomalies (recovered) — read before the next dispatch on AdiPDesk
- **Both dispatches used the `general-purpose` fallback agent** — the canonical `scrml-js-codegen-engineer` is NOT installed on AdiPDesk (only `debate-judge` present). The fallback + a thorough self-contained brief (F4 startup + MAPS + empirical Phase-3 + crash-recovery blocks embedded in the prompt, since the archived BRIEF.md is not in the fresh worktree) worked cleanly for both codegen fixes.
- **AdiPDesk has NO local git hooks** (only `.sample`) — no local commit/pre-push gate on this machine; the cloud `gate` is the sole authority. Offered the baseline-hook install; Peter did not take it up this session. [[delta-log 764]]
- **AdiPDesk full-suite baseline = 6 fails** (self-host-smoke ×4 [cross-OS path + missing gitignored dist artifact `tab.js`/`bs.js`] · B5 CSRF middleware guard · 1 unnamed teardown). PROVEN pre-existing on pristine `cd65898` (zero i174/i175 changes). Do NOT re-investigate these each session; the Linux cloud `gate` does not have them. `--bail` is degenerate here (self-host-smoke bails first) — run WITHOUT `--bail` for a real count.
- **verify-committed-state + S239 adversarial paid off on both:** caught the empty `after-count.txt` (agent's full-suite never finished → I ran it independently), the post-review chore-commit that moved the branch tip (re-reviewed the delta), and byte-identity of the untouched paths. #174's agent self-caught a writer-ownership regression its own fix created (the Axiom① guard).

## CI check shape (both PRs — expected going forward)
`gate` (required) + `windows` = GREEN; `ai-review` (no findings — infra-step fail) + `tracking` (self-host + serve-tool R26 known flakes) = RED but NON-required → merge on `gate` green. Matched S284/S285.

## Concurrent / held
- SOLO all session. Held branches (do NOT delete): chunk-ns `worktree-agent-a91ad13968b46ab5d` (bryan's, unlanded) · `origin/evidence/u4-premise-falsified` · `origin/worktree-agent-a2ed001a5de228134` + `feat/wave1c-nav`. `scrml-pinned` worktree is persistent (not a session tree).
- **Inbox:** `2026-07-22-2230-from-S282-to-XPS` — bryan-machine-family's outbound to the XPS clone; NOT for AdiPDesk. Left in place.

## Tags
#session-286 #adopter-174-175-landed #form-binding-in-each-e2e #bindvalue-half2 #value-property-fix #axiom1-guard #general-purpose-fallback-agent #adipdesk-no-local-hooks #adipdesk-6-fail-baseline #new-gap-attr-writer-conflict-template

## Maps
`primary.map.md` unchanged this session — internal codegen edits to existing files (emit-each.ts bind path, emit-bindings.ts value path); no structural/file changes. The pre-existing S284 "refresh OWED" (map behind HEAD) carries forward; a targeted `project-mapper` pass on `emit-each.ts`/`emit-bindings.ts`/`component-expander.ts` remains the alternative when someone takes it.

<!-- ============================================================= -->
<!-- S285 ADDENDUM (Peter/AdiPDesk, adopter lane) — bryan's S284    -->
<!-- chunk-namespacing WRAP is UNCHANGED below (his critical path). -->
<!-- ============================================================= -->

# scrml — S285 addendum (Peter/AdiPDesk) — adopter lane; chunk-ns (bryan, below) untouched

**Date:** 2026-07-24. `/boot` Profile A on **AdiPDesk** (Peter). Solo (bryan wrapped S284). `main` at `b274ed2b`, both repos clean. **4 PRs merged** — full detail in `changelog.md` S285 + delta-log `[S285]` + board `../scrml-support/handOffs/active-sessions/S285-peter.md`. This addendum is the irreducible; the chunk-namespacing critical-path arc (bryan's) is the S284 wrap immediately below, unchanged.

**Landed (adopter/silent-failure lane, all gate-green + regression-tested):**
- **#165 fully closed** — `#167` (initial control-anchors fold) → **`#171`** completed it (the fold was incomplete: filler-distance + `propagate`/`throw`/`match` guards; replaced with a direct `isControlFlowBoundary` scan-break). Server call no longer hoists above a returning guard.
- **`#172`** — a client side-effect between two batched server calls is now a batch boundary (§19.9.9.2 + S3; the client scheduler was inconsistent with the CPS planner).
- **`#173`** — a static-component import no longer emits a dead `_scrml_modules` destructure (HIGH; scrml-site page-kill).

**Open for a fresh boot (Peter lane, queued — NOT started):**
- **auto-await expression positions** (MED×2): `g-reactive-write-member-server-call-no-autoawait` + `g-match-arm-server-call-no-autoawait` — `@cell = serverFn().field` / server-call-in-match-arm emit a bare unawaited Promise → silent `undefined`. The scheduler/auto-await area, freshest context.
- `g-match-without-for-plus-when-children-silent-undeclared-dispatch` (HIGH) — invented `<when>` children silently accepted → runtime ReferenceError; clean diagnostic fix.
- `g-nested-for-lift-no-reconcile-on-cell-replace` (HIGH) — stale render on cell replace; reconciler internals.
- The **amplification halves** of #173 (`g-composition-strip-eats-last-dep-script` · `g-runtime-script-tag-not-depth-prefixed`) — now non-fatal for static components but still real on the composition path.

**Owed to bryan (tier-1, flagged not done):**
- **§13.2.4 spec-coherence** (`#172`) — §13.2.4 ("parallelize independent server calls unless data dependency") reads in tension with §19.9.9.2; impl follows §19.9.9.2. Outbox notice: `incoming/2026-07-24-from-S285-peter-to-bryan-spec-coherence-13.2.4-vs-19.9.9.2.md`. SPEC.md not touched.
- **latent-coupling hardening** (`#173`) — the static-component drop is by a proxy (`exportIsUserComponent`) not ground truth (`declaredBinding`); documented at the fix site + gap, bites only if value-consts ever get client bindings.

---

# scrml — Session 284 (bryan) — WRAP

**Date:** 2026-07-24. `/boot` Profile A on **`bryan-maclee-ASUS-Vivobook`** (successor to S283/S282, same machine). **4 PRs merged** (#163 #164 #166 #168), `main` at `33360949`, coherence 0/0. Mechanical stream in `handOffs/delta-log.md [753]-[762]`; changelog S284. This carries the irreducible.

---

## 🔴 THE ONE THING THAT GATES NEXT SESSION — chunk-namespacing is 90% DONE, not "runs next session"

**S283 already RAN the BUG-6 accessor-rename.** The board logged S283 as a "no-op orient"; git shows ~24 commits on `worktree-agent-a91ad13968b46ab5d @ 307bf9b7` (RETAINED). The S282 hand-off's "runs next session / 137 text-pins" framing is **wrong** — `verify-work-not-done` caught it before I re-dispatched a 90%-complete arc.

**Boot the finish from `docs/changes/chunk-namespacing/FINISH-SCOPE.md`** (landed #168, `status: current`). It is the current-truth kickoff. Summary:
- **DONE + verified:** core strip (`_scrml_cell_scope/_cell_key/_cell_name` out of core), **gzip 16,330 B — holds the 16 KB budget** (PA-re-measured S284; base main still 16,257, 0 drift — the "raise-forced" trigger did NOT fire), Acorn callee-rename pass, `E-CG-018` §34 rows, most test migration.
- **gzip decision RULED (bryan): HOLD 16 KB** via zero-core-residue (already achieved). Caveat: 54 B margin < ~200 B whitespace-noise band — whitespace-normalize + re-measure; the budget test self-guards future core additions.
- **The real residual (NOT mechanical text-pins):** ~19 within-node **PARITY** fails (the rename shifts LIVE emitted accessor names → native-vs-live byte parity over-budget per fixture) + **executed-output correctness** (the campaign has REVERT commits of a "folded prologue self-recurses / mangled executed clientJs" — verify in real Chromium, S265) + a **rebase onto main** (1-file `emit-each.ts` conflict with #161) + the **full verification bar** (both module formats real Chromium · both BUG-6 tests · name-diff clean · artifact-diff · S239).
- **The stale-branch 199-fail count is POLLUTED** (stale base + happy-dom global-state-leak cascade; 12 base browser flakes are expected). Get the clean rename-only count by rebasing onto main + running browser isolated.
- **OPEN RULING for the finish (surface to bryan):** resolve the within-node parity by (a) regenerating parity baselines to post-rename live output [likely], (b) applying the rename to native too, or (c) rename-aware gate. See FINISH-SCOPE §3.
- **Payoff on land:** closes adopter **#27** (navigate soft-nav) + unblocks the held classic Wave-1c loader AND ESM U4.

---

## 🎬 WHAT LANDED (4 PRs)

- **#163** — gaps filed for #161/#162 (both PA-reproduced on f28c35fb first).
- **#164 `374888b6`** — **#162** same-line multi-statement call-drop → CONFORMANT-REJECT (`E-STMT-MISSING-SEMICOLON`, §4 + native parity). GH #162 closed.
- **#166 `c27dca49`** — **#161** component + item-root fn-markup mount in `<each>`. Item-root scope; nested deferred. GH #161 closed.
- **#168 `33360949`** — chunk-ns `FINISH-SCOPE.md` (record correction + finish scope).
- **Filed:** `g-each-nested-markup-interp-stringifies` (MED) — the deferred nested-markup-interp shape. HIGH gaps 17→15, MED +1.

---

## 🧭 METHOD — two disciplines earned their cost this session

1. **The S239 adversarial gate caught a real regression pre-merge (S282 repeating verbatim).** #162's agent self-reported green through 21k tests but silently broke `(x==1) or (y==2)` — word-form booleans after a grouping `)`. My **empirical** adversarial pass (10+ constructed blast-radius shapes covering operator-classes / declaration-heads / chaining / under+over-rejection) found it; routed back; fix-round folded in the same PR. A landing on the green report ships a newly-rejecting break on valid common code. **The empirical construct-reproducers form of the gate is stronger than a generic review for a bounded-blast-radius parser change.**
2. **`verify-work-not-done-before-dispatch` saved a re-dispatch of a 90%-done arc.** The board said "no-op"; git said otherwise. **A board S<N>.md reflects boot-time intent, not what the session did — plan from git + landed artifacts, never the board marker.** (Process fix recorded on the S283 board.)
3. **Executed-DOM (S265) for #161** — the "renders nothing" mode is invisible to codegen inspection; verified by executing the bundle in happy-dom (my own harness, independent of the agent's test), with a base control proving the bug + the harness's discrimination.

---

## ⚠️ ANOMALIES / FRICTION (recovered)

- **FACTS-gate tripped #164 once** — I failed to pre-regen despite the S282 hand-off flagging it. **Pre-regen `bun scripts/facts.ts --write` before pushing ANY PR touching `compiler/src`, tests, or `SPEC.md`.** Applied for #166/#168.
- **GitHub partial outage** (~19:27-19:45Z) blocked #161's PR-create (GraphQL + REST 5xx, GitHub-internal error IDs). Background-retry auto-created the PR on recovery. `windows` failed on the mid-outage run (infra); the fresh run passed — no #161 regression.
- **Concurrent session S285-peter** landed #167 mid-merge → bumped main → #168 rebased + re-gated (strict:true). scrml-support push rejected once (Peter's push) → rebased clean.

---

## 🧷 CONCURRENT / HELD

- **S285-peter LIVE** — his adopter lane (#165/#167). Disjoint from my surfaces; serialized by PR merge-order. Not a blocker.
- **Held branches (do NOT delete):** `worktree-agent-a91ad13968b46ab5d` (chunk-ns rename — the finish resumes from it) · `bug6-base-e8fdd44c` (chunk-ns base) · `worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` (Wave-1c, unblocked when chunk-ns lands) · `origin/evidence/u4-premise-falsified`.
- **Inbox:** the `2026-07-22-2230-from-S282-to-XPS` message is THIS machine's own outbound to the XPS clone — LEFT in place (consuming it here denies XPS ever seeing it). The boot hook will keep flagging it until XPS consumes it. Not for this machine.

## Tags
#session-284 #adopter-161-162-landed #conformant-reject #s239-caught-or-and-regression #executed-dom-verify #s283-ran-the-rename-board-said-no-op #chunk-ns-90pct-done-scoped #gzip-hold-16 #facts-gate-friction #s285-peter-concurrent

## 🗺️ Maps
`primary.map.md` stamped pre-session (was 8 commits behind at boot, now ~15 with #162/#161/#167/#168). **Refresh OWED** — the session added real surface (`ast-builder.js` same-line boundary detector, `emit-each.ts` item-root mount path + each-block CE descent). Deferred with the chunk-ns finish (which adds the bulk of new surface); a targeted `project-mapper` pass on `ast-builder.js`/`emit-each.ts`/`component-expander.ts` is the alternative if the finish slips.
