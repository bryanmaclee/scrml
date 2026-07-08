# BRIEF — Apply SPEC §65 (scrml-native CSS model) to compiler/SPEC.md

**Dispatched:** S246, 2026-07-07. **Agent:** general-purpose, iso:worktree. **Type:** SPEC-doc apply (Nominal, spec-ahead).

## Task
Apply the **reviewed, apply-ready** §65 draft to `compiler/SPEC.md`: append the new §65 section, apply the 5 cross-amendments, regen `SPEC-INDEX.md`. This is a NORMATIVE spec landing of a bryan-ratified design — faithful transcription, not re-design. Nothing else.

## SOURCE OF TRUTH — read the FOLDED draft at this ABSOLUTE path
`/home/bryan-maclee/scrmlMaster/scrml/docs/changes/css-scrml-native-model-2026-07-07/SPEC-DRAFT.md`

⚠️ **Read it at that absolute path (the main checkout).** It carries uncommitted fold-pass edits that are NOT in your worktree's copy — the copy under your own worktree is STALE (pre-fold). Use the absolute-path version only.

The draft is self-contained: its **"Apply instructions"** (near the top) + the **"CROSS-AMENDMENTS" §A–§D** sections + the **"Frontmatter recap + returned-to-PA checklist"** (bottom) tell you exactly what to do. Follow them literally.

## Steps
1. **Append §65** — the entire **"THE NEW SECTION"** block (`## 65. The scrml-native CSS Model …` through §65.16 Cross-references) at **EOF of SPEC.md**, after the last top-level section §64 (§64.8 ends the file ~line 34877). NOTE: Appendices A–E sit *earlier* in the file (~line 14122) — a pre-existing ordering quirk; §65 still goes at EOF after §64. The number **65** is correct (§64 is the last section).
2. **§A → §9.1** — insert the Nominal forward-reference paragraph (draft §A) **after the §9.1 DQ-7 normative block** (SPEC.md ~line 6545, the "CSS variable bridge" bullet), **before `### 9.2`** (line 6547).
3. **§B → §25** — add **§25.7** (draft §B) after §25.6 (SPEC.md ~line 16706–16752), before `## 26` (line 16753).
4. **§C → §26** — add **§26.9** (draft §C) after §26.8 `@apply` (SPEC.md line 17087), before the next section.
5. **§D → §4.15 + §24.4** — add the `<theme>` and `<defaults>` rows to BOTH registry tables (§4.15 table ends with the `<onchange>` row at SPEC.md line 1070; §24.4 at line 16613). ALSO apply §D's normative additions: add `theme`/`defaults` to the §4.15 reserved-name list (the `E-NAME-COLLIDES-RESERVED` statement, ~line 1078) + the block-splitter classification statement (~line 1074) + the cross-references; and the §24.4 rows. Use the exact §D text.
6. **Regen** `SPEC-INDEX.md`: `bun run scripts/regen-spec-index.ts`. Confirm §65 topic rows appear; add the §65 Quick-Lookup rows if the script doesn't auto-populate them.
7. **§34 rows: NONE** at this landing (Nominal — the `E-STYLE-*`/`W-STYLE-*`/`E-THEME-*`/`E-DEFAULTS-*` codes are NAMED in §65.10 but their §34 catalog rows land WITH the impl wave, per Rule 4).

## MUST-CLEAN — strip/reword this meta-scaffolding (do NOT paste into SPEC.md)
The draft carries applying-editor scaffolding that is NOT normative spec text:
- **DROP the two blockquotes titled "Reconciliation note (for the applying editor)"** (in §65.1 and §65.2.1). They instruct you; they honor the DD-vs-rulings reconciliation already baked into the surrounding text. Do not paste them.
- **REWORD the §65.6 blockquote "Variant-type declaration — PINNED (bryan, 2026-07-07)"** into plain normative prose: state the rule (the bound cell is declared bare `<mode> = .Light`; its variant type is inferred from the `<theme for=@mode>` binding — the engine `for=` pattern, §14.10 bare-variant inference; `<theme>` is the single owner of the variant set; a bare `.Light` with no in-scope `<theme for=>` binding is `E-VARIANT-AMBIGUOUS`). Drop the "PINNED (bryan…)" decision-record framing.
- **SOFTEN the "bryan-elevated 2026-07-07" attributions** in §65.14 and §65.15 to normative scope prose (e.g. "V1.0 scope: Wave 1 gates the 1.0 language freeze; Waves 2–3 + Full are v1.next."). Keep the wave structure; drop the session-attribution (that lives in the changelog/user-voice, not the spec).
- **STRIP the `[[limit-primitives-not-godify]]` wiki-links** (in §65.0 and §65.4.3) — keep the surrounding prose, remove the `[[ ]]` brackets (SPEC.md doesn't use memory-links).
- **KEEP** the `> **Nominal (spec-ahead-of-implementation).**` banner (§65 head) — it is a legitimate spec status banner.
- **DO NOT paste** the draft's own frontmatter, "Apply instructions", "THE NEW SECTION" header line, "CROSS-AMENDMENTS" header, or "Frontmatter recap + returned-to-PA checklist" — those are the draft's scaffolding. §A–§D content goes to its TARGET sections (steps 2–5), not into §65.

## Constraints
- Touch ONLY `compiler/SPEC.md` and `compiler/SPEC-INDEX.md`. Do NOT touch any other file (a concurrent session is live on the shared repo — stay in your worktree, disjoint footprint).
- Faithful transcription. If the draft is genuinely ambiguous on a normative point, STOP and report (Phase-0) rather than inventing — do not re-design a ratified surface.
- Commit in your worktree (per-step commits fine). Report: the §65 line range in SPEC.md, the 5 amendment line ranges, the SPEC-INDEX regen result, and any Phase-0 stop.

## Verify before reporting done
- `grep -n "^## 65\." compiler/SPEC.md` → §65 present at EOF.
- `grep -n "theme\|defaults" compiler/SPEC.md` around §4.15/§24.4 → both rows present.
- `bun run scripts/regen-spec-index.ts` ran clean; `grep -n "65" compiler/SPEC-INDEX.md` → §65 rows present.
- No stray "applying editor" / "PINNED (bryan" / "[[" / "bryan-elevated" strings landed in SPEC.md: `grep -nE "applying editor|PINNED \(bryan|\[\[|bryan-elevated" compiler/SPEC.md` → 0 hits.
