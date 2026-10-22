> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. It is the publishing checklist for the archived drafts beside it. The drafts it lists teach an older scrml dialect. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

# dev.to publication checklist — 2026-05-25 (S130)

**Purpose:** all 12 dev.to articles have been audited (`docs/audits/article-truthfulness-audit-2026-05-21.md`, S115) and the corresponding in-repo `*-devto-*.md` files have been updated with the audit's recommended fixes. The retraction post for "scrml's Living Compiler" is drafted and ready to publish. This checklist is the user-side execution package — one row per platform action; work through top-to-bottom on dev.to.

**Source-of-truth:** the in-repo `docs/articles/*-devto-*.md` files. Copy the body of each file into the dev.to article editor (replace the existing body). Frontmatter (`title:` / `description:` / `tags:` / `published:`) maps to dev.to article-settings; preserve dev.to's own `canonical_url` + `cover_image` if already set.

**S114 ruling applied throughout:** "versioning is a messaging concern; adopters shouldn't get hung up on version semantics." Article status banners use feature-state language ("ships today" / "spec-ratified, not yet implemented" / "in flight") rather than hard `v0.X.Y` numbers. Don't reintroduce hard versions on paste.

---

## STEP 1 — publish the retraction post (NEW dev.to post)

**Action:** create a new dev.to post.

**Source:** `docs/articles/living-compiler-retraction-devto-2026-05-21.md` (~5.7 KB; ~103 lines)

**Title:** `Retraction — scrml's Living Compiler`

**Tags suggested:** `compiler`, `retraction`, `programming`, `webdev`

**Body:** paste-replace from the source file. NOTE: the "Banner for the original post" section at the bottom (lines 92-102) is META-content — extract that for STEP 2 below, do NOT publish it as part of the retraction post itself (or do publish it, your call — it's clean either way).

**Pre-publish:** ratify the retraction text (it's labelled "honestly machine-drafted and human-approved: Claude wrote it, Bryan read it and signed off." That stamp claim presumes your prior review.)

**Post-publish:** copy the dev.to URL of the new retraction post. STEP 2 needs it.

**Status:** [ ] published

---

## STEP 2 — banner on the original "scrml's Living Compiler" post

**Action:** edit the existing dev.to post at https://dev.to/bryan_maclee/scrmls-living-compiler-23f9 . PREPEND the banner text to the body (above the existing article content; do NOT delete the original body).

**Banner text** (from `docs/articles/living-compiler-retraction-devto-2026-05-21.md` lines 93-102, with `(#)` replaced by the new retraction-post URL from STEP 1):

```markdown
> **Retraction (May 2026).** scrml is no longer pursuing the living-compiler /
> transformation-registry model this article describes. Codegen that graduates by
> population adoption metrics is incompatible with deterministic, reproducible builds and
> is a supply-chain poisoning surface — and it contradicts scrml's decision to be a
> sealed, bounded language. The article is left up, unedited, with this notice. Full
> reasoning: **[Retraction — scrml's Living Compiler](<RETRACTION-URL>)**. — *written by Claude,
> rubber-stamped by Bryan Maclee.*
```

Replace `<RETRACTION-URL>` with the URL from STEP 1.

**Status:** [ ] banner prepended

---

## STEP 3 — update the 12 dev.to articles (paste-replace body)

Order doesn't matter; all 12 are independent. Mark each as you go. The 2 articles marked **ACCURATE** (no body changes) are listed for completeness — only update if you want the optional related-link cleanup applied.

| # | Title | In-repo source | Audit class | Change summary | Status |
|---|---|---|---|---|---|
| 1 | Why programming for the browser needs a different kind of language | `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` | FIX-WITH-ANNOTATION | Footnotes/annotations softening `lin` claims (spec-ratified not impl) + WASM/sidecar nested-program target claims (Worker ships; WASM/sidecar in roadmap) | [ ] |
| 2 | Components are states | `components-are-states-devto-2026-04-29.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed; version-currency messaging redesign; §11 citations updated to §6.12 / §52 (folded section) | [ ] |
| 3 | Server boundary disappears | `server-boundary-disappears-devto-2026-04-28.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed; version-currency redesigned; §11 citations updated | [ ] |
| 4 | npm myth | `npm-myth-devto-2026-04-28.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed; §11 citation updated. (1 residual `v0.2.4` in an HTML comment — verification-cite, not user-visible; OK to leave.) | [ ] |
| 5 | ORM trap | `orm-trap-devto-2026-04-29.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed; §11 citation updated | [ ] |
| 6 | CSS without build step | `css-without-build-step-devto-2026-04-29.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed | [ ] |
| 7 | LSP + giti advantages | `lsp-and-giti-advantages-devto-2026-04-28.md` | ACCURATE (with optional link scrub) | Body content unchanged; Living Compiler link already scrubbed in-repo. Optional update only if you want the in-repo state mirrored to dev.to. | [ ] |
| 8 | Mutability contracts | `mutability-contracts-devto-2026-04-29.md` | FIX-WITH-ANNOTATION (NOT rewrite) | Audit item 2 user-disposition: kept full article with prominent Status banner explaining value-predicate layer ships today; lifecycle / lin layers are SPEC-ratified but not yet implemented. S89 update note added (`(null -> T)` → `(not -> T)`). | [ ] |
| 9 | Realtime and workers as syntax | `realtime-and-workers-as-syntax-devto-2026-04-29.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed; version-currency redesigned; nested-program target claims softened (Worker ships; WASM/sidecar in roadmap) | [ ] |
| 10 | Tier ladder promotion | `tier-ladder-promotion-devto-2026-05-04.md` | FIX-WITH-ANNOTATION | Status banner uses feature-state language (no hard `v0.2.4`); promotion CLI status note added re: `--match` shipped vs `--engine` deferred | [ ] |
| 11 | Why scrml has to deprecate function + component overloading | `why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md` | ACCURATE | No body changes needed. Historical `v0.2.0` references are correct as-written (the deprecation DID land in the v0.2.0 cycle). | [ ] |
| 12 | scrml-debate amends Zod claim | `scrml-debate-amends-zod-claim-devto-2026-05-06.md` | FIX-WITH-ANNOTATION | Living Compiler link scrubbed | [ ] |

---

## Reference — what was NOT updated (and why)

Per the audit, three nominal-vs-actual conflations were classified as defer-able rather than annotate-now:

- **§3.3 quoted-text model forward-drift** (3 articles: `tier-ladder-promotion`, `components-are-states`, `scrml-debate-amends-zod-claim`) — SPEC §4.18 landed (S111) but the compiler fire is spec-ahead-of-implementation. The affected examples are NOT wrong against today's compiler. Audit's own framing was "defensible to defer until the §4.18 fire ships." Disposition applied: defer; re-examine when quoted-text fire lands.

- **§3.4 folded `§11` citations** (5 articles) — §11 is folded (content distributed to §6.12 + §52). Articles cited `§11` for `<db>` / `protect=` / state-authority content. The E-codes cited are correct; only the bare section number is stale. Applied as lowest-priority cleanup in the in-repo state; safe to leave on dev.to if the cited E-codes still match.

If you want the §3.3 quoted-text forward-drift annotations or the §3.4 §11 citation updates ALSO applied to dev.to, those are minor follow-on edits — the article bodies above already carry the load-bearing fixes.

---

## After completion

When all 14 actions above are done:

1. Drop a one-line note in `scrml-support/user-voice-scrmlTS.md` (or this checklist's status section) confirming the dev.to platform actions are complete. PA picks that signal up at the next session.
2. Master-list `§0.6` and `docs/changelog.md` get a "S130 dev.to publication" entry at the next wrap.

The article-truthfulness audit (`docs/audits/article-truthfulness-audit-2026-05-21.md`) and the retraction draft (`docs/articles/living-compiler-retraction-devto-2026-05-21.md`) become historical-record once the platform actions land; they stay in-repo as the audit-trail.

---

## Tags

#dev-to-publication #s130 #article-currency-refresh #living-compiler-retraction
