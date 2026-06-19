# sPA ss11 — doc-currency-corpus

**Launch:** `read spa.md ss11` · **Branch:** `spa/ss11` · **Worktree:** `../scrml-spa-ss11`
**Merged from:** doc-currency-corpus-ouroboros · doc-corpus-content-rewrite-v020

## Shared ingestion
Two doc/corpus surfaces. (a) Derived-doc CURRENCY fixes where corpus trails code (the ouroboros lag):
the §52 read-authority retraction (S194 — auto-persist/optimistic/rollback deleted), the §11-folded
citation drift (§11 → §6.12+§52), the R28-C2 kickstarter recipe residuals. (b) The big v0.2.0
public-facing CONTENT rewrite: `examples/` (29 + trucking), `samples/compilation-tests/` (805 .scrml),
`docs/tutorial.md` (1121L), `docs/articles/` (18 .md), README, website. Threads: canonical-scrml shapes
(§4.18 display-text, §18.2 `:>` arm, §17.7 `<each>`, §6 V5-strict decl, §42 null→not); the SCOPE-MAP
§D.2 keep/rewrite/drop taxonomy; the truthfulness/staleness audits; memory rules
(`doc_cleanup_reorg_not_content_cut`, `show_visual_work`, `self-host-showcases-scrml`, `dry-run-before-drops`).

## Core files
`docs/articles/*-devto-*.md` · `docs/tutorial.md` · `examples/` · `samples/compilation-tests/` · `README.md` · `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md` · `ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md`

## Items (least-ingestion-first)
1. **`bug-19-cite`** `[landed-on-branch b2f4d093]` bug LOW · tier low — §11-folded-citation sweep: dev.to articles cite stale SPEC §11 for `<db>`/protect=/state-authority (folded → §6.12+§52); E-code citations correct. Entry: docs/articles/*-devto-*.md (index.html mirrors regenerate). **Landed:** 8 sites → §52 across 4 articles. **R4 flag:** brief said "5 articles" — genuine count 4; `components-are-states` §11.3/§11.1 are kickstarter-internal, not SPEC §11. See progress.md.
2. **`g-s52-retraction-doc-staleness`** `[landed]` bug LOW · tier low — 2 derived docs taught the deleted §52 auto-persist/optimistic/rollback model after the retraction (SPEC date **2026-06-14**, not "S194"). Reworded to read-authority-only; initial-load/SSR untouched. Entry: components-are-states-devto + spec-consolidation heads-up. **R4-verified vs §52.6.2/§52.6.3.** **LANDED:** (a) heads-up doc — 2 additive supersession notes (record-preserving); (b) components-are-states-devto + its live .scrml website page — value-prop reworked to "plumbing generated, verb yours" + L14 correction banner + audit block (user delegated the reword S208: "don't have time to hand work old articles"). **OPEN (user-owned):** the live dev.to post is still stale — only the user can edit it on dev.to. See progress.md.
3. **`r28-c2`** `[kickstarter-landed; SPEC+corpus→PA]` bug MED · tier low — R28-C2 canon residuals. Entry: docs/articles/llm-kickstarter-v2-2026-05-04.md. **USER RULED (S208): "the space is stale. fix."** → no-space `<db>` canonical. **LANDED:** despaced 13 `< db>`/`< schema>` → `<db>`/`<schema>` in the kickstarter; verified 0 spaced remain + no W-WHITESPACE-001. **ESCALATED to PA (beyond ss11):** SPEC §4/§4.3 amendment (stale space-required text) + corpus-wide despace migration (SPEC=194, examples=27, other-articles=36; planned `scrml-migrate` tooling). `print()` = 0 hits (moot). See progress.md.
4. **`phase-c2-articles-triage`** `[open]` feature n-a · tier med — Phase C2: apply ACCURATE/NEEDS-EDIT/RETRACT from the 2026-05-05 audit; re-verify "in flight" labels (formFor/schemaFor/tableFor shipped since). Entry: ARTICLE-TRUTHFULNESS-AUDIT + docs/articles/.
5. **`phase-c1-tutorial-rewrite`** `[open]` feature n-a · tier med — Phase C1: rewrite tutorial per the S186 staleness audit (26 defects, 4 HIGH: broken 02b `<schema>`, `=>`/`->`→`:>`, add `<each>`). A remediation pass was in flight — verify what landed. Entry: docs/tutorial.md + audit.
6. **`phase-c3-readme-scrml-dev-announce`** `[open]` feature n-a · tier med — Phase C3: finalize README + website for v0.2.0 announce; **serve the site in a browser before push** (memory `show_visual_work`). Announce-gated on the refreshed tutorial. Entry: README.md + docs/website/.
7. **`phase-b1-examples-rewrite`** `[open]` feature n-a · tier med — Phase B1: rewrite the example corpus to canonical scrml (decl/arm/null→not). 29 top-level + trucking multi-file. Entry: examples/ + VERIFIED.md.
8. **`phase-b2-samples-curate`** `[open]` feature n-a · tier high — Phase B2: classify `samples/compilation-tests/` (805) into still-compiles/edit/DROP/REWRITE per SCOPE-MAP §D.2, then green the curated set; **drops need explicit user authorization + dry-run** (memory `dry-run-before-drops`). Entry: samples/ + SCOPE-MAP §D.2.

## Progress
`ss11.progress.md`. Land on `spa/ss11`; ping PA inbox when ready. Do not advance main / do not push.
