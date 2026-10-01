# progress — s446-spec-dpa063-termination

Worktree: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a5679023ec80f2155
Branch: worktree-agent-a5679023ec80f2155 · base origin/main 310eee4c4

## Status
- [x] startup verification (pwd, toplevel, clean, contains origin/main, bun install)
- [x] commit 1 WIP start; commit 2 BRIEF.md
- [x] R1-R3 reproduced (see below)
- [ ] SPEC: new §7.2.2 statement termination
- [ ] SPEC: E-STMT-NO-EFFECT language-wide (§40.8 + §34)
- [ ] SPEC: stale sites (§7.2, §5.2.3, §17.6.1, §34 E-INTERNAL-BODY-TOP-DROPPED "`;` is source formatting")
- [ ] SPEC: §6.7.4 re-trigger + W-LIFECYCLE-006
- [ ] §34 rows
- [ ] known-gaps §S446
- [ ] regen SPEC-INDEX / state / facts

## R1-R3 reproduction (on 310eee4c4)
- R1 REPRODUCED: `--parser=scrml-native`, `onclick={ console.log("m")⏎ @n = @n + 1 }` and `onclick={ console.log("k"); @n = @n + 2 }`
  → emitted `function(event) { console.log("m"); }` / `function(event) { console.log("k"); }`, exit 0. Default parser emits both statements.
- R2 REPRODUCED: native, `const a = @r ?⏎ "x" :⏎ "y"` in a function body → E-STMT-MISSING-SEMICOLON + E-EXPR-UNEXPECTED + E-STMT-UNEXPECTED-TOKEN, exit 1. Default compiles.
- R3 REPRODUCED: bootstrap `mods.parse.parseFile`, `${ function f() { let x = 1 let y = 2 } }` → 2 Locals, 0 diagnostics.
Probes: session scratchpad `d063/` (r1.scrml, r2.scrml, r3.js, run.sh) — not committed.
