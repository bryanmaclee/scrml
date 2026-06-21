# sPA ss11 — doc-currency-corpus

**Launch:** `read spa.md ss11` · **Branch:** `spa/ss11` · **Worktree:** `../scrml-spa-ss11`

**Fill:** ~62% · `healthy` (the fattest executable Bucket-A list)

## Shared ingestion
Doc/corpus currency + the canonical-scrml rewrite pipeline: tutorial, articles, README/website,
examples corpus, samples curation. Shared loci: `docs/articles/`, `docs/tutorial.md`, `README.md`,
`docs/website/`, `examples/` (+`VERIFIED.md`), `samples/compilation-tests/`, and the audit docs
(`ARTICLE-TRUTHFULNESS-AUDIT`, S186 staleness audit, `SCOPE-MAP`). All items are content-currency
rewrites scopable from the same audit-verdict + canonical-scrml understanding. NOTE several are gated
(C3 on C1; drops need user-auth+dry-run).

**⚠ RULE-1 GATE (pa.md R1 — added S210).** Items **4** (articles triage / truthfulness audit) + **6**
(README/website v0.2.0 ANNOUNCE) are marketing-shaped — **NOT substantive work while v0.2.0 is in
flight**; an sPA SKIPS them unless the user explicitly raises marketing. Item **2** (live dev.to reword)
is user-owned (DRAFT-and-surface for the user to paste — never PA-grind; user owns the live copy). The
**eligible** sPA work here is the currency/codegen/examples/samples set: items **1, 3, 5, 7, 8**. (So
the ~62% fill is the FULL-list estimate; the eligible-now subset is smaller — re-pace accordingly.)

## Core files
`docs/tutorial.md` · `docs/articles/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` · `docs/articles/` · `README.md` · `docs/website/` · `examples/` · `examples/VERIFIED.md` · `samples/compilation-tests/`

## Items (least-ingestion-first)
1. **`g-interp-in-raw-content`** `[status=in-flight S211]` LOW · tier med — `${...}` inside `<pre>`/`<code>` emits LITERALLY with no diagnostic — add `W-INTERP-IN-RAW-CONTENT` info-lint. §4.17 makes `<pre>`/`<code>` raw-content (scrml tokens intentionally NOT recognized) — spec-correct but SILENT: a `${...}`-shaped run ships verbatim, zero warning; author reaching for `<pre>${board}</pre>` gets broken output + no signal. Flux dog-food S193; worked around with `<div class='whitespace-pre'>`. NOTE: this is a CODEGEN lint (emit-html.ts/block-splitter), not pure doc-currency — kept here as the lightest first item; could route to ss-codegen if a brief prefers. status=in-flight S211 (dispatched; `W-INTERP-IN-RAW-CONTENT` not yet in source).
   > **Brief seed:** Add a `W-INTERP-IN-RAW-CONTENT` info-lint when a `${...}`/`<Tag>`-shaped token appears inside a raw-content element body (emit-html.ts/block-splitter) — steer to `<div class='whitespace-pre'>` or explicit escaping. W-/I- partition → `result.warnings` (diagnostic-stream rule).
2. **`g-s52-retraction-live-devto`** `[status=open]` LOW · tier low — live dev.to post still teaches deleted §52 auto-persist/optimistic model (user-owned edit). The 2 derived docs were reworded S210 (landed/integrated); OPEN residual = the LIVE dev.to post is still stale — only the USER can edit it on dev.to. `components-are-states-devto` post.
   > **Brief seed:** User-owned: draft the corrected read-authority-only wording for the live dev.to post and surface it for the user to paste (show_visual_work — user owns live copy).
3. **`bug-19-cite-residual`** `[status=done-verified-in-main]` LOW · tier low — §11-folded-citation residual (verify count; index.html mirrors). 8 sites across 4 articles reworded §11→§52 (landed ss11; R4 flag corrected '5 articles'→4). Residual = regenerate index.html mirrors if not auto-regenerated. `docs/articles/*-devto-*.md`.
   > **Brief seed:** Verify the index.html mirrors regenerated after the §11→§52 reword; if not, regenerate. Cheap currency closer.
4. **`phase-c2-articles-triage`** `[status=open]` MED · tier med — Phase C2 articles triage — apply ACCURATE/NEEDS-EDIT/RETRACT from the 2026-05-05 audit. Apply the audit verdicts; re-verify 'in flight' labels (formFor/schemaFor/tableFor shipped since). `ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` + `docs/articles/`. status=open. NOTE delegate voice-currency reword on OLD published articles (review-gated, voice-preserving); user owns new/flagship voice.
   > **Brief seed:** Apply ACCURATE/NEEDS-EDIT/RETRACT verdicts from `ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md`; re-verify 'in flight' labels against shipped formFor/schemaFor/tableFor. For OLD published articles delegate the voice-prose currency reword (tight, voice-preserving, review-gated).
5. **`phase-c1-tutorial-rewrite`** `[status=done-verified-in-main]` MED · tier med — Phase C1 tutorial rewrite — 26 defects (4 HIGH); verify in-flight remediation landed. Rewrite `docs/tutorial.md` per the S186 staleness audit (26 defects, 4 HIGH: broken 02b `<schema>`, `=>`/`->`/`:>` arrow forms, add `<each>`). A remediation pass was in flight (S187 2-crash recovery) — verify what landed first. status=done-verified-in-main (S187 A1-E21 landed; verify-tutorial.sh 11/11).
   > **Brief seed:** Verify the S187 in-flight tutorial remediation landed (what's done vs owed), then close the remaining 26-defect audit (4 HIGH). Gates Phase C3. Restate prerequisites not conclusions.
6. **`phase-c3-readme-website-announce`** `[status=open]` MED · tier med — Phase C3 README + website v0.2.0 announce (serve site before push). Finalize `README.md` + `docs/website/` for v0.2.0 announce; serve the site in a browser before push (show_visual_work). Announce-gated on the refreshed tutorial (C1). status=open.
   > **Brief seed:** After C1 tutorial lands: finalize README + website for v0.2.0; serve the site in a browser for the user BEFORE push (show-visual-work).
7. **`phase-b1-examples-rewrite`** `[status=in-flight S211]` MED · tier med — Phase B1 examples-corpus rewrite to canonical scrml (decl/arm/null→not). Rewrite the example corpus to canonical scrml (29 top-level + trucking multi-file). `examples/` + `VERIFIED.md`. status=in-flight S211. null→not is ABSOLUTE.
   > **Brief seed:** Rewrite `examples/` (29 top-level + trucking) to canonical scrml: canonical decl form, arm shape, null/undefined→not (ABSOLUTE — `""` stays a defined value). Cross-check against `VERIFIED.md` (user-owned `[x]` flips).
8. **`phase-b2-samples-curate`** `[status=in-flight S211]` MED · tier high — Phase B2 samples/compilation-tests curation (805 .scrml; drops need user-auth + dry-run). Classify `samples/compilation-tests/` (805) into still-compiles/edit/DROP/REWRITE per `SCOPE-MAP §D.2`, then green the curated set. DROPS need explicit user authorization + a dry-run pass listing targets BEFORE any mutation (PA bash cleanup rule). status=in-flight S211.
   > **Brief seed:** Classify `samples/compilation-tests/` (805) per `SCOPE-MAP §D.2` (still-compiles/edit/DROP/REWRITE), green the curated set. DROPS: dry-run a target list FIRST + get explicit user auth before any deletion.

## Progress
`ss11.progress.md`. Land on `spa/ss11`; ping PA inbox when ready. Do not advance main / do not push.
