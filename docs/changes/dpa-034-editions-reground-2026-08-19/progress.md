# dpa-034 — progress (append-only, timestamped)

## 2026-08-19 — start
- Workspace: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-acc7956b5fe4d36a3`
- Base asserted: `git merge-base HEAD origin/main` == `origin/main` == `3b5eed4465fdc92702098bba0049a1e3dce9f4ce`. Tree clean at start.
- `bun install` OK. BRIEF recovered from `bank/s353-three-rulings` via `git checkout FETCH_HEAD -- docs/changes/dpa-034-editions-reground-2026-08-19/`.
- Maps read: `.claude/maps/primary.map.md` (full, incl. Task-Shape Routing). **Load-bearing finding: NOT load-bearing for this task.** The routing table has no SPEC-prose row; the nearest rows (`non-compliant / stale docs` -> non-compliance.report.md, `a diagnostic code` -> error.map.md) point at instruments this change does not use. The map's live hazards (bun test timeouts, `compileScrml` input-order emission, the §34 census) all bear on compiler-source work; this landing touches zero executable bytes.
- Rule 4 gate: read `compiler/SPEC.md` §62 IN FULL (36110-36313) plus §63 head + §63.3 (36316-36389) via `awk` line-addressed reads before any edit.

## 2026-08-19 — relayed-finding verification (BEFORE writing prose)
- **Finding A (`tripwire already tripped` REFUTED) — BOTH HALVES REPRODUCE.**
  - `E-LANGUAGE-VERSION-TOO-NEW`: **0** fire sites. Repo-wide the string appears in exactly 5 files, all prose: `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, `handOffs/hand-off-237.md`, `handOffs/delta-log.md`, and this BRIEF. Zero hits in any `.ts`/`.js`.
  - `scrml.toml`: appears in executable source in exactly **4** places, and every one is a *filename constant or a comment about it* — `compiler/src/codegen/chunk-namespace.ts:96` `PROJECT_ROOT_MARKERS = ["scrml.toml", ".git"]` (an `existsSync` probe for root anchoring), its two docstring mentions, and one comment at `compiler/src/codegen/index.ts:1303`. **No TOML parser is invoked anywhere** in `compiler/src`, `scripts/`, or `commands/` (`toml.parse|parseTOML|smol-toml|@iarna` -> 0 hits). `[language]` / `languageVersion` -> 0 hits.
  - Corroborating: `ChunksManifest` (`compiler/src/codegen/route-splitter.ts:208`) declares `{ version; compiler; entryPoints }` — **no `language` field**; `grep -n language route-splitter.ts` -> 0 hits. §62.4 is unbuilt too.
- **Finding B (`chunks.json` instrument INERT) — CONCLUSION REPRODUCES; THE RELAY DROPPED A SCOPE QUALIFIER.**
  - As relayed ("`chunks.json` is WRITE-ONLY (0 read sites)"): **REFUTED as stated.** There IS a reader — `compiler/runtime/stdlib/mcp.js:147` (`_readChunksManifest`, defined :199-208, `readFileSync`), plus an `fs.watch` re-read at :155, serving the MCP `get_app_topology` / `list_routes` tools.
  - As the round-2 artifact ACTUALLY writes it (§4: *"`chunks.json` has zero read-sites in `compiler/src/`"*): **CORRECT** — verified, 0 reads under `compiler/src`; the only site is the write at `compiler/src/api.js:3363-3369`.
  - The conclusion the finding supports is unaffected and is arguably stronger: the single reader is a **runtime introspection surface**, not a compile input, so retention still buys served output, never the ability to compile the form.

## 2026-08-19 — SPEC edits
- `compiler/SPEC.md` §62.8 rewritten + retitled `62.8 No editions in the 1.0 surface as built`. Amendment banner + Rule-4b `Provenance:` (`ruling:user-voice-scrml.md S353` + three `dd:` pointers) + the BACKWARD half `supersedes:` (RULING.md D1 item 4) + `Direction-of-change: inert`.
- §62.9 cross-refs extended: §41.4 + §21.7 added (the anchors §62.8's reason 1 rests on); prior-art list annotated *surveyed, not endorsed-as-non-edition*; dpa-034 design-provenance block appended.
- §62.6, §63, §63.3 UNTOUCHED (brief boundary). `remove-only-at-a-MAJOR` left explicitly OPEN in §62.8's own prose.
- `compiler/SPEC-INDEX.md` regenerated (`bun scripts/regen-spec-index.ts`) — CI-gated totals 37,152 -> 37,271; the §62 row's UNGATED authored prose hand-updated so it does not rot (the generator only fixes ranges/totals).

## 2026-08-19 — RULING.md amendment
- Amendment banner added after the header block: provenance, supersedes, `inert`, the rule being applied, and a four-row table quoting EVERY struck clause verbatim (record, not laundering).
- Four in-place strikes: D1 item 4 · D1 Fork C · D4 item 3 · §0 rationale source 2. Every ratified CONCLUSION unchanged.
- Both dead replacement premises recorded as do-not-reinstate; both round-2 findings recorded; standing tripwire recorded; `remove-only-at-a-MAJOR` recorded as NOT decided.
- Residual-population-premise sweep: `grep -nEi "two friends|scrml-scale|YAGNI|not worth it here|audience margin|ecosystem"` now hits ONLY the verbatim quotations inside the amendment table.

## 2026-08-19 — §2 same-landing supersession (scrml-support, separate repo, clean on main)
- `d1-no-editions-earned-or-assumed-...` (round 1) -> `status: partially-superseded` + `superseded-by:` + `last-reviewed:` + an in-body banner naming what SURVIVES (all four findings, ratified) vs what is SUPERSEDED (the panel-gap disclaimer; the separate-compilation grounding). Marked in place, not moved, per §2 deref-vs-mark.
- `language-editions-...` (concurrent take) -> `status: partially-superseded` + `superseded-by:` + banner naming the two REFUTED claims (§7.2 "already in the yes column"; §5.3/§7.3's separate-compilation premise) and the survivors.
- `d1-no-editions-round2-panel-gap-closed-...` -> stays `current` (it is the authority); `ruled:` frontmatter + a RULED banner recording exactly which recommendations landed (1,2,3,4,7), which did NOT (5 — §62.6 out of scope), and which was opened rather than decided (6). Also records the ONE correction to its §4: the artifact's own `compiler/src/`-scoped claim is correct; the unqualified relay of it is not.

## 2026-08-19 — INERT PROOF (whole-corpus emit differential, both directions)
Instrument: `bun scripts/corpus-emit-differential.ts` (the standing pre-land gate, #428). BASE captured at `3b5eed44` BEFORE any edit; HEAD captured at the edited tree. Default roots (`examples,samples,conformance,stdlib,benchmarks`), recursive.

```
capture base: enumerated 1906 · attempted 1906 · compiled 1224 · emitted 7383 · checked 4426 · syntax-failing 66
capture head: enumerated 1906 · attempted 1906 · compiled 1224 · emitted 7383 · checked 4426 · syntax-failing 66
VERDICT: NO DIFFERENCES  over 1906 common sources of 1906 base / 1906 head enumerated  and 7383 compared artifacts
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7383 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  load-context changes      0
  bare server-fn sites      base 145 / head 145 (delta 0)
```

Both directions covered by construction: the gate reports newly-failing AND newly-passing, added AND removed artifacts, new AND fixed syntax failures. Structural corroboration: `git diff --stat` touches **zero** executable files — `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, `RULING.md`, `progress.md`, `BRIEF.md`. No compiler source, no conformance case, no stdlib.

Independent verification of one further relayed premise (the S350 population measurement, cited in the amendment as *measured TRUE*): re-run here — `gh issue list --state all` -> `pjoliver11` 34 · `rjantz3` 15 · `bryanmaclee` 9 (owner); `gh issue view 471` -> author `pjoliver11`. **REPRODUCES exactly.**

## 2026-08-19 — one more relayed claim verified before it stayed in normative prose
§62.8's *"RFC 3501 permits the Leadership Council to skip an edition or stabilize an empty one"* was relayed from the round-2 artifact (`rust-edition-expert`), not measured. Checked against the source: RFC 3501 (`rust-lang.github.io/rfcs/3501-edition-2024.html`) states editions are on a three-year cadence and **the Leadership Council decides what to do when an edition lacks sufficient changes — options explicitly including skipping the edition completely, delaying to a subsequent year, or stabilizing the edition without any specific changes.** **CONFIRMED.** Kept as written.

## 2026-08-19 — DEFERRED, and one of them is loud

1. **⚑ `compiler/SPEC.md:36499-36502` (§63.3 item 3) STILL CARRIES THE POPULATION PREMISE, verbatim:**
   *"(PEP-387's "≥2 releases" shrunk to scrml-scale — two friends + a frozen language do not need Python's audience margin)."*
   This is the SPEC twin of the RULING.md D4 item 3 clause struck in this landing. **The brief's hard boundary — "any SPEC section other than §62.8/§62.9" is OUT — forbade touching it**, so it stands. Net effect: the RULING no longer carries the premise and the NORMATIVE text still does, which is the wrong way round. It is a one-clause edit and it needs its own authorization. Note it is a §63 clause, so it is entangled with the separately-opened `remove-only-at-a-MAJOR` question and should probably ride that landing.
2. **Round-2 recommendation #5 NOT landed** — state §62.6 as *forward-gating only* and have it disclaim any promise about surviving a MAJOR's removals, resolving the §62.6-vs-§62.3 contradiction that BOTH late voices independently identified as the genuine tripwire. §62.6 was explicitly OUT of scope. Still owed; cheap; independent of the ruling.
3. **`remove-only-at-a-MAJOR`** — the PA is opening it as its own deliberation. Not decided, not implied. §63.3 untouched, and §62.8 says so in its own prose.
4. **Not touched, by design:** `handOffs/dpa-queue.md` (PA-owned, unmerged change in flight) · `master-list.md:41`, `docs/changelog.md`, `handOffs/delta-log.md`, `handOffs/hand-off-237.md` — all carry "no editions" as a record of the **S234** landing, which is faithful history, and all are PA-owned maintained-tier docs.

## 2026-08-19 — full suite: 2 failures, ENVIRONMENT, root-caused (not a regression)
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance compiler/tests/*.test.js`
-> **28,776 pass · 86 skip · 1 todo · 2 fail** · 128,287 expects · 28,865 tests / 1,245 files. Run twice, same two names both times (`bun run pretest` executed between runs; it changed nothing).

The two:
```
(fail) fs.watch reload (watch: true) > registers watchers when watch:true
(fail) fs.watch reload (watch: true) > reloads engines.json on change event
```
Both in `compiler/tests/unit/mcp-runtime-helpers.test.js`.

**ROOT CAUSE — inotify instance exhaustion, measured:** `/proc/sys/fs/inotify/max_user_instances` = **128**; instances currently held by this user = **122** (`find /proc/*/fd -lname anon_inode:inotify | wc -l`). Five concurrent `bun test` suites (sibling agents) plus several worktrees plus editors. The first test asserts `watcherCount > 0` after `loadSidecars(dir, { watch: true })`; with no instances left, `fs.watch` registers nothing and the second test's 200 ms event never arrives. **Both are `fs.watch` liveness assertions, not assertions about anything this landing touched.**

**Not attributable to this change, three ways:**
1. `git diff origin/main -- compiler/tests/unit/mcp-runtime-helpers.test.js compiler/runtime/stdlib/mcp.js` is **EMPTY** — the test AND its subject are byte-identical to `origin/main`.
2. The test file contains **zero** references to `SPEC`, `FACTS`, or any `.md` — it cannot read a single file this landing modified.
3. The whole landing is `.md`-only; the corpus emit differential over 1,906 sources reports NO DIFFERENCES.

CI corroborates: `gh run list --branch main` is `success` on the CI workflow, and CI's `unit` tier does run this file — it passes on an unloaded runner. **Worth surfacing to the PA:** concurrent agent suites on one box can exhaust `max_user_instances` (128) and turn any `fs.watch` test red for reasons that look like a code regression.
