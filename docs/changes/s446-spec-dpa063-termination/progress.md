# progress — s446-spec-dpa063-termination

Worktree: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a5679023ec80f2155
Branch: worktree-agent-a5679023ec80f2155 · base origin/main 310eee4c4

## Status
- [x] startup verification (pwd, toplevel, clean, contains origin/main, bun install)
- [x] commit 1 WIP start; commit 2 BRIEF.md
- [x] R1-R3 reproduced (see below)
- [x] SPEC: new §7.2.2 statement termination (placed after §7.2.1 — it qualifies §7.2's "all JavaScript is valid" claim exactly as §7.2.1 does; that sentence is where ASI used to be inherited from)
- [x] SPEC: E-STMT-NO-EFFECT language-wide (§40.8 new sub-bullet + §34.1 row widened; §7.2.2 rule 9 points there)
- [x] SPEC: stale sites — §7.2 JS-inheritance sentence; §5.2.3 separator sentence; §17.6.1 "§3 ASI rules"; §34 E-INTERNAL-BODY-TOP-DROPPED "A `;` is source formatting"
- [x] SPEC: §6.7.4 re-trigger subsection + normative bullet; W-LIFECYCLE-006 condition 2 + §6.7.10 row + §34 row + Example 6
- [x] §34 rows: E-STMT-LEADING-OPERATOR (new), E-STMT-MISSING-SEMICOLON, E-STMT-NO-EFFECT, E-INTERNAL-BODY-TOP-DROPPED, W-LIFECYCLE-006 (touched)
- [x] known-gaps §S446 (9 entries: 3 HIGH, 6 MED) + cross-note on g-body-top-next-line-continuation-runtime-crash
- [x] regen SPEC-INDEX / state / facts + 3 Quick Lookup lines; all three --check PASS
- [x] conformance scan: 5 cases carry leading-operator lines (3 r4 pins flip; s437-handler-shape-ternary-continuation-lines + s437-handler-shape-member-continuation-line must be rewritten) — recorded in §7.2.2 + §34 row

## R1-R3 reproduction (on 310eee4c4)
- R1 REPRODUCED: `--parser=scrml-native`, `onclick={ console.log("m")⏎ @n = @n + 1 }` and `onclick={ console.log("k"); @n = @n + 2 }`
  → emitted `function(event) { console.log("m"); }` / `function(event) { console.log("k"); }`, exit 0. Default parser emits both statements.
- R2 REPRODUCED: native, `const a = @r ?⏎ "x" :⏎ "y"` in a function body → E-STMT-MISSING-SEMICOLON + E-EXPR-UNEXPECTED + E-STMT-UNEXPECTED-TOKEN, exit 1. Default compiles.
- R3 REPRODUCED: bootstrap `mods.parse.parseFile`, `${ function f() { let x = 1 let y = 2 } }` → 2 Locals, 0 diagnostics.
Probes: session scratchpad `d063/` (r1.scrml, r2.scrml, r3.js, run.sh) — not committed.

## Normative sentence → ruling line
- §7.2.2 rules 1, 2, 4, 5 (newline ends; END-token continuation; brackets; expression starts never join) → S446 Call 1 "b, your rec" (the PA's Call 1 text, quoted in the ruling entry).
- §7.2.2 rule 3 (leading-operator error, `.`/`?.` included) → S446 Call 1 + Call 4a (i); leading `+`/`-` → Call 5 "yes on +/-".
- §7.2.2 rule 6 (`;` separator, line-final legal) → Call 4b (i).
- §7.2.2 rule 7 (two statements one line → E-STMT-MISSING-SEMICOLON) → Call 1 + S284 conformant-reject (brief item 1).
- §7.2.2 rule 8 (`return` ends at newline; S440 #6 subsumed) → Call 7 confirm.
- §7.2.2 rule 9 + §40.8 language-wide bullet (incl. `~` exemption) → Call 5 (i) + PA refinement ruled with it.
- §7.2.2 Migration → Call 6 (i).
- §7.2.2 locus table → dd cross-cutting table, pole-B column.
- §7.2.2 "Arm heads" → Call 4a (i) "no `.Variant`-arm vs chain lookahead" + §18.2 arms newline-separated.
- §6.7.4 re-trigger → S446 "b on retrigger".
- §6.7.4 W-LIFECYCLE-006 exclusion → S446 PA note recorded with the same ruling line.

## PA reading — for veto → ALL TEN ACCEPTED S447

> RULED: user-voice-scrml.md S447 "your recs on all of them" item 1. Landed S447 (branch `spec/s447-dpa063-termination`): each reading now carries a `> **Provenance:** ruling:user-voice-scrml.md S447 "your recs on all of them" item 1` line in SPEC §7.2.2 / §40.8 / §6.7.4; reading 9 stays OPEN by ruling; reading 10's transport question settled as "reads may abort, writes never".

1. **END-token closed list** (§7.2.2 rule 2): binary ops incl. `in`/`instanceof`/`is`; `=` + compound assignments; `.` `?.`; `?` `:`; `,`; `=>` `:>` (+ deprecated arm aliases); prefix `!` `typeof` `new`. The ruling names the classes; the exact membership is mine.
2. **Propagation `?` vs conditional `?` at line end**: a `?` glued to its operand (`load(id)?`) is §19.5 propagation and ENDS the statement; a `?` with whitespace before it continues (conditional). Adjacency decides, by analogy to the §4.14 `:`-shorthand whitespace rule. Without this, the ruled END-list `?` breaks every line-final `f()?` (19 corpus lines incl. §19.5's own example). Alternative for veto: conditional `?` never ends a line (multi-line ternary only inside `( )`).
3. **Leading `/` and `<` are expression starts** (regex / markup), not leading operators (rule 3a).
4. **`}⏎else` stays legal** (rule 3b) — `else` continues a statement, not an expression (20 corpus lines start with `else`).
5. **`}` of a block-bodied statement ends it**: `if (c) { a() } b()` is two statements, no `;` needed (rule 7).
6. **Arm heads decided by position** (arm level directly in a `match`/`!{}` body vs statement level), never by `:>` lookahead; a non-arm `.x` line at arm level is a parse error that SHOULD carry the rule-3 suggestion.
7. **Value positions are not expression statements** for E-STMT-NO-EFFECT: render `${expr}`, §18.5 arm result expression (S446 tail-value principle noted, NOT ruled into §18.5), value-form arms, `:`-shorthand, bare handler value.
8. **Outside the body top**, a literal-only statement and an untargeted label are E-STMT-NO-EFFECT (at the body top they stay E-UNQUOTED-DISPLAY-TEXT); E-TILDE-002 suppressed when E-STMT-NO-EFFECT fires on the same statement.
9. **`return⏎f()` (effectful orphan)** — left OPEN (unreachable statement, no code); S440 #6 would have caught it. dd: 0 real sites.
10. **`when` re-trigger**: "not a rollback", "writes before the suspension point stand", and the transport abort-vs-discard question OPEN (implementation SHALL at minimum discard, SHALL NOT abort a WRITE-classified call).
