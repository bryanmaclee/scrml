---
from: S453-peter (AdiPDesk — PA)
to: bryan
date: 2026-10-04
subject: "Follow-up: 2 SPEC sentences a dev agent would act on are false since #1279/#1273 — plus the maps non-compliance list"
needs: action
status: unread
re: 2026-10-04-from-S453-peter-to-bryan-answered-items-built.md
---

Short follow-up — the S453 maps refresh landed after my main note and found two SPEC sentences in YOUR
window that a dispatched agent would read and act on wrongly. Both are one-line prose fixes in your lane;
we touched no flagged doc. Full list: `.claude/maps/non-compliance.report.md` (stamp `fd2f757d0`).

## 1. ⚑ `W-ARM-PIPE-LEGACY` — SPEC says neither implementation emits it. Both statements are false since #1279.
- `SPEC.md:18134` — *"not yet emitted by impl#1 (frozen) **or the bootstrap**"*
- the §34 row at `:19386` — ends *"never emitted under either name"*

**It IS emitted by the bootstrap**: `compiler/self-host-v2/parse.scrml:524`, Info severity per
`severity.scrml:101`, and `scripts/bootstrap-conformance.ts:649` now **depends** on it. The impl#1 half is
still true. **Why it matters more than ordinary staleness:** a dev agent briefed off either line writes a
test asserting the code never fires, and that test passes for the wrong reason.

## 2. §35087 says `scrml fix` deletes the leading `|` — in the present tense, and no such rule exists
`fix-s66.js` has **zero** pipe rules (its sets are pre-migrate / program-wrap / program-move /
unwrap-logic and rhs-decl / const-cell / engine-simple). §63.7 itself says the code is gate-blocked until
that rule lands, so the SPEC contradicts itself — and `:18132` tells readers the **186 `|`-led arms across
70 files** migrate by that non-existent rule. Either the rule is owed or those two sentences are.

## 3. Smaller, same report
- **`docs/bootstrap-conformance.md` is stale for the THIRD consecutive window** (committed 1301/511/622 vs
  live 1310/513/629). The S451 "add it to the checklist" fix did not take. The mapper's recommendation,
  which we think is right: make its `--check` **blocking** on PRs touching `conformance/cases/**` or
  `self-host-v2/**`. We left it stale rather than regenerate a doc outside the maps.
- `README.md` / `NERDME.md` / PRIMER + the two `docs/readme-snippets/*.scrml` were migrated off the
  paren-free binder in this window but **kept the `|` lead** the same window soft-deprecated.
- Two E-SQL-004 messages (`emit-server.ts:7096`, `emit-tool.ts:794`) still carry the §8.1.1-superseded
  "no `db=` in any ancestor `<program>`" wording; `db-authoritative.ts:105` + `tenant-egress.ts:556` still
  narrate the retired `_scrml_tenant_tag`.
- **`scrml-support/agents/` is an S217 snapshot** (added `fd62911` 2026-06-23, last touched `4dc0eb7`
  2026-07-28) while the live source is on your machine, and it has drifted: PRIMER §12 lists `Agent` in
  `scrml-js-codegen-engineer`'s tool set, the staged file does not. **Rec: mark that README
  `SNAPSHOT (S217) — NOT AUTHORITATIVE`** — the tool-set question cannot be resolved until it is clear
  which copy governs. (We installed the staged agent on AdiPDesk this session; it registered immediately.)

## 4. One thing the refresh said about our own maps, which you may find useful
The two S453 reviewers independently measured **zero** Task-Shape Routing coverage for the surface they
worked, and zero hits for every symbol our dispatch briefs named — while the one map line that WAS
load-bearing was a plain file-**inventory** row listing two exports side by side. That row is what revealed
there are two handler-colouring entry points and stopped a fix that would have left 14 listener sites
unlogged. It was even stale on its own line count and still worked. Recorded as a structural signal
(C-S453-A), with the conclusion: **when a pass can write only one, write the inventory row.**

— S453-peter
