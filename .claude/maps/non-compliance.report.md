# non-compliance.report.md
# project: scrml
# generated: 2026-07-09
# scan mode: FULL_COLD_START (maps refresh 66a3afb1 -> fbb4d9fd, 67 commits / 227 files)

## Summary

This pass rewrote all `.claude/maps/*.md` from scratch (the prior maps had grown to
2000-5000+ content lines each via unbounded per-session accretion, in direct violation
of the "current-truth navigation, not archival" scope principle — see "Map-currency
finding" below). The non-compliance scan below targets: (1) re-verification of items
carried from the last INCREMENTAL_UPDATE report (S194, watermark a78272e5), (2) a
name/location/date heuristic sweep for docs in the live tree that predate the current
SPEC.md (mtime 2026-07-08) by >30 days AND describe non-trivial aspirational/planning
content, and (3) spot-checks of the biggest landings this window (§65 CSS, §38.13
realtime, auth/BaaS, editor tooling).

Full read of all ~1184 `*.md` files in the repo was NOT performed (infeasible at this
scope/turnaround); this is a targeted heuristic sweep, not an exhaustive line-by-line
audit. Items below are individually verified; anything outside this sweep should be
treated as unscanned, not implicitly compliant.

Resolved since last scan: 2
Non-compliant (new/carried): 6 doc clusters
Informational — correctly archived, no action: 5 docs
Uncertain (needs human review): 2 doc clusters

## Map-currency finding (this pass's own subject — not a repo doc, but load-bearing)

The pre-refresh `.claude/maps/*.md` had violated their own governing scope principle:
`primary.map.md` had grown to 462 lines with a single `# updated:` header line running
to ~15,000+ words of per-session accretion (S148 through S238, every source-file touch
narrated verbatim); `structure.map.md` was 2475 lines; `error.map.md` 1056; `test.map.md`
708; `domain.map.md` 510 — all far past the 300-content-line ceiling this cartographer's
own spec mandates. This is exactly the "current truth vs. archival" failure mode the
scope principle exists to prevent: a dev agent reading the old primary.map.md header had
to parse thousands of words of historical narration to find the 3-line current watermark.
All maps have been rewritten fresh this pass, trimmed to current-truth content with a
pointer to `docs/changelog.md` for history. **Recommendation: do not let per-session
deltas accrete into map bodies again — an INCREMENTAL_UPDATE should REPLACE the relevant
section, not prepend a new "Key SNNN Source Changes" paragraph onto the old one.**

## Resolved since last scan (S194 report items — verified compliant now)

### docs/articles/components-are-states-devto-2026-04-29.md
Previously flagged: claimed the compiler "generates the optimistic-update path, generates
the rollback" for `authority="server"` — false after the S194 §52.6.2/.3 retraction.
**Status: RESOLVED.** Line 239 now carries an explicit in-place correction ("✅ Corrected
2026-06: ... §52 is a read-authority layer ... the persist write is the developer's `?{}`").

### docs/heads-up/spec-consolidation-2026-05-25.md
Previously flagged (same §52 auto-persist claim, line ~297). **Status: RESOLVED** — the
doc carries an inline `[Currency — superseded 2026-06-14: ...]` annotation correcting the
claim to the read-authority-only model. NOTE: the doc's own frontmatter still reads
`status: in-progress` (line 2) though the currency annotations suggest the tracked
questions have since been ratified elsewhere — see "Uncertain" below.

## Non-compliant docs

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** content-heuristic (self-marked superseded) + date (2026-05-21, 48+ days stale)
**Detail:** Opens with "⚠ SUPERSEDED S117 (2026-05-21). This Phase-0 decomposition's
R1-R5 / 46-78h estimate was itself under-counted..." — the document declares its own
staleness. Carried from the prior FULL_COLD_START scan (948d3f2f), unresolved since.
**Suggested disposition:** deref to scrml-support/archive/.

### compiler/native-parser/M5-ast-bridge-scoping.md, M5-divergence-ledger.md
**Reason:** date (2026-05-21, 48+ days stale) + content-heuristic (describes the
native-parser's THEN-current AST-bridge scoping contract as a load-bearing precondition
for the pipeline-swap)
**Detail:** These describe the native-parser's May-2026 scoping/divergence state. Since
then the native-parser has grown substantially — this window alone added the LSP
semantic-tokens provider (`lsp/handlers.js`) consuming `native-parser/lex()` directly in
production, a use these docs predate entirely. Whether their scoping contract still holds
cannot be confirmed without a dedicated re-derivation pass.
**Suggested disposition:** uncertain — needs human review (re-verify against current
native-parser/ + native-parser-canary/within-node-classifier.ts, or deref to archive if
superseded by a later contract doc).

### compiler/native-parser/M6.6-CONTRACT-DERIVATION.md
**Reason:** date (2026-05-23, 46+ days stale) + content-heuristic ("developer reference for
b.2-b.4 consumer migration off the live engine-statechild-parser.ts")
**Detail:** Describes a migration-in-progress cookbook contract. Carried from the prior
scan as "verify current"; still unverified.
**Suggested disposition:** uncertain — needs human review.

### docs/changes/v0next-inventory/{SCOPE-MAP,SCOPE-SUPPLEMENT,ARTICLE-TRUTHFULNESS-AUDIT}-2026-05-0[5-7].md
**Reason:** location (docs/changes/ dispatch-archive, correctly parked) + date (2026-05-05/07,
64+ days stale) + content-heuristic (v0.next planning inventory, superseded by the now-shipped
v0.3+ / v1.0-Wave-1 surface)
**Detail:** Carried unresolved from the prior scan. These describe a pre-v0.3 scope inventory;
the repo has since shipped v0.3, the §52 authority model, §60/§61 API/endpoint, §64 tool
target, and now §65 CSS — the inventory is many surfaces behind current reality.
**Suggested disposition:** already correctly archived under docs/changes/ (a designated
dispatch-archive location per pa.md convention) — no move needed, but content should not be
treated as a live scope reference by any dev agent.

### docs/audits/{null-audit-compiler-src,undefined-audit-compiler-src}-2026-05-13.md, article-truthfulness-audit-2026-05-21.md, bug-51-class-corpus-coverage-audit-2026-05-28.md, docs/language-inspiration-audit-2026-06-06.md
**Reason:** date (56-84 days stale, all predate the 2026-06-08 cutoff) + name-heuristic
(`-audit-`)
**Detail:** Point-in-time audit snapshots. By nature these are meant to age (an audit
records "as of date X"), but a dev agent grepping docs/audits/ for current null/undefined
hygiene status, or article truthfulness, would get a stale answer without checking the
date itself. Contrast `docs/audits/stdlib-completeness-2026-07-08.md` (dated yesterday
relative to this scan — current, not flagged).
**Suggested disposition:** no forced move (audits/ is a reasonable point-in-time home), but
recommend a one-line "supersedes/superseded-by" pointer chain if a newer audit exists for
the same surface, so a dev agent lands on the current one.

### docs/heads-up/{const-deep-freeze,iteration-design,lifecycle-annotation-extension}-2026-05-25.md
**Reason:** date (44+ days stale) + content-heuristic (open design-question framing)
**Detail:** Not individually content-verified this pass (time-boxed). These are the same
genre as spec-consolidation-2026-05-25.md (which turned out to have an in-place currency
fix) — plausible these also have inline corrections, or plausible they're still open.
**Suggested disposition:** uncertain — needs human review before citing as live design state.

## Informational — correctly archived, verified superseded (no action needed)

These `docs/changes/<change-id>/SPEC-DRAFT.md` / `SPEC-AMENDMENT.md` files matched the
"spec-draft" name-heuristic (filename starts with `SPEC-`) but are legitimately parked in
the designated dispatch-archive location (`docs/changes/`, per the pa.md "archive dispatch
BRIEF.md at dispatch time" convention) and their proposed content is now VERIFIED RATIFIED
into `compiler/SPEC.md` — they are historical proposal records, not live specs, and no dev
agent should read them as authoritative (SPEC.md is):

- docs/changes/css-scrml-native-model-2026-07-07/SPEC-DRAFT.md -> ratified as SPEC.md §65 (verified: §65 present, Wave-1 LANDED banner at SPEC.md:34923).
- docs/changes/realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §38.13 (verified present, channel-watches.ts implements Phase 1+2).
- docs/changes/standalone-tool-target-2026-07-04/SPEC-AMENDMENT.md -> ratified as SPEC.md §64 (verified present, E-TOOL-001..006 firing).
- docs/changes/clean-print-primitive-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §20.7 (verified present at line 14529).
- docs/changes/capability-vocab-v1-2026-06-30/SPEC-DRAFT.md -> ratified as SPEC.md §23.5 (verified present, E-FOREIGN-CAPABILITY-UNKNOWN firing).

## Task-brief discrepancy (not a repo-doc finding — flagging for the record)

The dispatching task brief instructed excluding "the LSP semantic-tokens provider
(lsp/handlers.js), the VS Code TextMate grammar refresh, and the Neovim syntax/scrml.vim
— on held worktree branches, NOT merged to fbb4d9fd." Verified against actual git state:
both `7dfc3df8` (editor-highlighting refresh: Neovim syntax + VS Code grammar) and
`fbb4d9fd` itself (the LSP semantic-tokens commit) ARE on `main` and ARE included in HEAD
`fbb4d9fd` — `fbb4d9fd` IS the semantic-tokens commit, not a commit preceding it. This
mapping run followed "verify against actual source, don't trust this list blindly" per
the task's own instruction and mapped all three surfaces as present (see structure.map.md,
dependencies.map.md). Likely cause: these two commits landed on main in the interval
between the task being drafted and this mapper starting.

## Tags
#non-compliance #project-mapper #cleanup #scrml #css65 #native-parser-stale #audit-currency #map-bloat #spec-draft-archived #s247 #full-cold-start

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
