change-id: s444-dpa045-spec-followups

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit. Call that path WORKTREE_ROOT.
2. Toplevel == WORKTREE_ROOT; tree clean; `git fetch origin`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT).
4. ABSOLUTE paths under WORKTREE_ROOT for every Read/Edit/Write. Never `cd` into /home/bryan/scrmlMaster/scrml. Never `git stash`. Never `pkill -f` on a shared command string.
5. First commit: this prompt verbatim → `docs/changes/s444-dpa045-spec-followups/BRIEF.md` + `progress.md`; message `WIP(s444-dpa045-spec-followups): start at <pwd>`. Commit incrementally. Branch: `docs/s444-dpa045-followups`.

## MAPS
`.claude/maps/` stamped cf62b415 — stale. Verify against source.

## Task — docs/SPEC text + gap filings only (NO compiler source changes)
Context: dpa-045 (plain-markup text; AXIOM-LEVEL) was RULED by bryan at S442 and landed as SPEC §4.18 (#1170). Read `/home/bryan/scrmlMaster/scrml-support/user-voice-scrml.md` the two S442 entries headed "RULED — dpa-045 (plain-markup text…)" and "RULED — dpa-045 follow-ups…" (grep for them) — those are the authority. Read compiler/SPEC.md §4.18 in full (grep -n '4\.18'), §3.1, §4.7, §23.2 (incl. §23.2.4), §39 body grammar.

### Part 1 — four SPEC clarifications (PA readings, recorded for bryan's veto)
For each: quote the governing sentence(s) you rely on in progress.md, make the minimal edit, and add inline `> **Provenance:** rationale:<one line> (PA reading S444, bryan veto window)` under the amended text.
(a) §4.18.1b says `_{` in markup "stays an error, as today". The "as today" is FALSE for impl#1 (the TS compiler renders `_{…}` in a markup body as text). §23.2.4 makes E-FOREIGN-004 the correct behaviour. Verify impl#1's actual behaviour by EXECUTION (`bun compiler/bin/scrml.js compile <tmpfile> --output-dir <tmp>`), then fix the wording to state the rule without the false "as today", and file the impl#1 gap (Part 2).
(b) A `\"` inside a code-default display-text literal: SPEC is silent now that the escape catalog is deleted. The PA reading is: it stays an error (E-PARSE-001, fail-closed). Check what the bootstrap (compiler/self-host-v2/parse.scrml on main) and impl#1 do by execution; add the sentence to §4.18.3.
(c) The `my_{` identifier guard: `_{` immediately after an identifier character is content, not a foreign-code opener. Say it in §23.2 (verify current impl behaviour first).
(d) `<schema>` bodies are not free text — §39 governs them. Say it in §4.18.1.
If ANY of these contradicts a SPEC sentence you find, STOP that item and report it (do not paper over a conflict).
After editing SPEC.md, run `bun run scripts/regen-spec-index.ts` and `bun scripts/facts.ts --write` if they exist/apply (check `--check` modes pass).

### Part 2 — gap filings in docs/known-gaps.md
Entry form: `<!-- @gap id=g-<kebab> sev=HIGH|MED|LOW status=open locus=<path[:line]> or locus=searched:<a,b,c> prov=<kind>:<pointer> -->` + `### G-<ID-UPPER> — <symptom>` heading + a body with a version-stamped reproducer (compile command + compiler SHA + expected vs actual). Match existing entries' layout; read several first. Only FOUR severities exist (HIGH/MED/LOW/NOMINAL). Reproduce EACH by execution on current main before filing; if one does not reproduce, do not file it — report NOT-REPRODUCED.
1. impl#1: `lift` / markup-as-value segments trim text AND delete the spaces next to `${…}` — e.g. `   lifted   ${it}   li` renders as `liftedali` (content loss). sev per your measured judgement (content loss → likely HIGH or MED; justify).
2. impl#1: component bodies collapse whitespace (contradicts §4.18.5 "kept exactly").
3. impl#1: `_{` in a markup body rendered as text instead of E-FOREIGN-004.
4. Bootstrap (D1 review LOW): a compound-parent cell named `svg`/`math` pushes a non-DOM tag on the ancestor stack.
5. Bootstrap (D1 review LOW): HTML breakout tags inside foreign content keep `/>`.
For 4-5, locate in compiler/self-host-v2 (html.scrml / lower.scrml likely — verify); if you can't reproduce, file with locus=searched and say so.
Then run `bun scripts/state.ts --write` and `bun scripts/state.ts --check` (regenerates the §0 counts). Resolve by regeneration, never by hand.

### Close
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` green (the hook). Push `git push -u origin docs/s444-dpa045-followups`. No PR, no merge.

## Report (terse)
WORKTREE_ROOT, SHA, each SPEC edit (quoted governing sentence + the new text), each gap (id, sev, locus, reproduced yes/no), anything stopped and why.
