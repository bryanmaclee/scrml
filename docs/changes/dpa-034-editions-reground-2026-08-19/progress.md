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
