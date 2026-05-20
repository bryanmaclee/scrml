# Wave 1 — Quoted-Text Model SPEC Amendment — Progress

Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-aa172d688868eb153
Scope: SPEC.md + SPEC-INDEX.md only. v0.4. Locked design (S111). No compiler source.

Decisions confirmed from required reading:
- New §4 subsection number: §4.18 (next free after §4.17).
- Primary new error code: E-UNQUOTED-DISPLAY-TEXT.
- Scoping notes to add: E-SYNTAX-050 (bare-/), E-CTX-003 (:-shorthand shape-confusion).

## Timeline

- 2026-05-20 12:12 — Startup verification passed (pwd under agent- worktree, toplevel match, clean, bun install OK). Required reading complete (DD-1/2/3, SPIKE, ROADMAP). SPEC sections located: §3 @226, §4.14 @943, §4.15 @986, §4.17 @1031, §5 @1079, §18.0 @9605, §34 @14647, §51.0.B @22159, §51.0.I @22778. Progress file created.
- 2026-05-20 12:25 — §4.18 NEW canonical subsection added (code-default body mode + display-text literal, 9 sub-subsections §4.18.1-.9) + §4.17 orthogonality note. Committed cbd5740.
- 2026-05-20 12:35 — §3.4 (code-default loci note + cross-ref), §4.14 (`:`-shorthand body grammar explicit per SPIKE §7 + canonical-literal-form + 2nd worked example), §4.15 (body-form notes for `<engine>`/`<match>` + normative statement). Committed d91cefb.
- 2026-05-20 12:42 — §5.1 (one cross-ref line — `"`-only precedent), §18.0 (S111 amendment note), §18.0.1 (body-forms bullet code-default + new worked example with `"..."` arm bodies). Committed 6629651.
- 2026-05-20 12:55 — §51.0.A (S111 amendment note), §51.0.B (state-child body bullet code-default), §51.0.B.1 (3 worked examples migrated to quoted form), §51.0.I (body-forms table + code-default note). §51 worked examples scanned + 5 sites migrated to quoted form (§51.0.B.1 OpenAt ×2, LoadPhase block, §51.0.N Title/Paused, §51.0.Q.1 Title/Paused). Committed 8164642.
- 2026-05-20 13:05 — §34 amended: NEW E-UNQUOTED-DISPLAY-TEXT row (inserted after E-SYNTAX-050); scoping notes added to E-SYNTAX-050 (bare-/ free-text-only) and E-CTX-003 (`:`-shorthand shape-confusion). Committed af5046b. All 9 SPEC.md sections done. SPEC.md grew +252 lines (28,234 → 28,486).
- 2026-05-20 13:15 — SPEC-INDEX regenerated via `bun run scripts/regen-spec-index.ts` (Sections table ranges refreshed). Manual SPEC-INDEX updates: §3/§4/§18/§34/§51 row summaries; §4 row range fixed manually (regen skips `~`-prefixed sizes — 286-1085→289-1266/978); "Substantive content landings" S111 entry added; "Total lines" header → 28,486; Quick-Lookup +5 anchors (§4.18 code-default mode, display-text literal, `:`-shorthand body grammar, `text`/`TextNode` survives, E-UNQUOTED-DISPLAY-TEXT + scoping notes). SPEC.md↔SPEC-INDEX consistency verified (all 57 section + 5 appendix ranges contiguous; all §4.18.x cross-refs resolve). Wave 1 COMPLETE.
