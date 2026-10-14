# BRIEF — s466-enum-infer-parseerror (verbatim dispatch prompt)

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean; after `git fetch origin`, `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never a main-checkout path; never `cd` into main.
3. NEVER `git stash`, NEVER `pkill -f`/`killall` by command string, NEVER `--no-verify` / hooksPath changes.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists).
5. TMPDIR never inside a repo: `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-enum-infer-parseerror` per command if needed.
6. `git checkout -b s466-enum-infer-parseerror`. FIRST commit: this prompt verbatim → `docs/changes/s466-enum-infer-parseerror/BRIEF.md` + `progress.md`, message `WIP(s466-enum-infer-parseerror): start at $(pwd)`. Commit after each step; code+tests are one commit unit. Two items below — land each as its own commit series.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`; main has since landed #1414–#1421). Follow Task-Shape Routing for type-system work; report whether load-bearing.

## Item 1 — enum-cell type inferred from a qualified-variant initializer (NEWLY-ACCEPTING, ruled)
Ruling (bryan S464, user-voice-scrml.md, "(a) Infer from initializer"): "the §66.3 rule 5 reading (`E.V` is a literal of `E`) is ratified for `<x> = …` cells too — an unannotated cell initialised with a qualified unit variant has that enum type, so a bare variant write resolves in function bodies and handlers alike. Newly-accepting (E-VARIANT-AMBIGUOUS → compiles); one §14.10 sentence. Consistent with dpa-065 'infer within a file'." Rejected: (b) annotate.
PA repro on main `f28b58a31`:
```scrml
${
  type Col:enum = { Red, Blue }
}
<col> = Col.Red
<button onclick={ @col = .Blue }>b</button>
${ function flip() { @col = .Red } }
```
→ `E-VARIANT-AMBIGUOUS` on the bare `.Red`/`.Blue` writes. Expected: compiles; `@col` has type `Col`.
Scope carefully: the initializer must be a QUALIFIED variant of a known enum (`Col.Red`, `Col::Red` if that spelling exists) — unit variants per the ruling; decide payload variants (`Shape.Line(3)`) by the same §66.3 rule 5 sentence: quote it and follow it; if it doesn't say, infer for unit variants only and report the payload question. Do NOT infer from a bare `.Red` initializer (no type context — stays an error). Do NOT infer from arbitrary expressions. Infer within a file only (dpa-065). The inferred type must flow wherever an annotated `<col>: Col = .Red` would: handlers, function bodies, match exhaustiveness, `is` tests, server/client.
SPEC: add the one §14.10 sentence with `> **Provenance:** ruling:user-voice-scrml.md S464 "(a) Infer from initializer"`; regen SPEC-INDEX.
Tests: the repro compiles AND runs (emitted client JS sets the variant); annotated form unchanged; bare-initializer still E-VARIANT-AMBIGUOUS; a write of a variant NOT in `Col` is a type error, not silently accepted; match over `@col` checks exhaustiveness against `Col`.

## Item 2 — `ParseError` is import-only (NEWLY-REJECTING, ruled)
Ruling (bryan S464, "(a) Import-only"): "`ParseError` is NOT ambient; it is imported like every stdlib export (bare-variant handling in `!{}` needs no name). One SPEC sentence in §41.13 / §53.14.6 making the import-only rule explicit."
PA repro on main: this compiles with NO import of ParseError:
```scrml
${
  type Shape:enum = { Dot, Line(n: int) }
  import { parseVariant } from 'scrml:data'
  function p(j) {
    const s = parseVariant(j, Shape) !{
      ParseError.Malformed(r) :> { return 0 }
      _ :> { return 1 }
    }
    return 2
  }
}
<p>x</p>
```
Expected after the change: naming `ParseError` without `import { ParseError } from 'scrml:data'` is an error (use the existing unknown-name/type code if one fits — quote §34; only mint a code if none fits, and then report the name as provisional for the owner). Bare-variant arms (`.Malformed(r) :>`) inside the `!{}` of a `parseVariant` call need NO import and must keep working. Find where `ParseError` is made ambient (PA hypothesis, unverified: a hard-coded registration in `type-system.ts` or the stdlib type preload — trace it and report).
MEASURED MIGRATION (mandatory, base §8): compile the whole corpus — `examples/`, `samples/`, `conformance/cases/`, `stdlib/`, `compiler/tests` fixtures that are .scrml, and read-only `/home/bryan-maclee/scrmlMaster/giti` + `/home/bryan-maclee/scrmlMaster/flogence` .scrml sources (write outputs under your TMPDIR) — base vs branch; list every newly-refused file. Test fixtures / conformance cases: migrate them (add the import). Any newly-refused REAL program (examples/, stdlib/, giti, flogence) → do NOT migrate it; STOP item 2 before landing it and report the list (the PA takes it back to bryan).
SPEC: §41.13 / §53.14.6 sentence + `> **Provenance:** ruling:user-voice-scrml.md S464 "(a) Import-only"`; regen SPEC-INDEX.

## Gates (all must pass)
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`; `bun test compiler/tests/lsp compiler/tests/commands`; `bun scripts/types-gate.ts --check`; bootstrap slice (`bun scripts/lint-no-default-arm.js && bun test ./compiler/self-host-v2/slice-m1/ ./compiler/self-host-v2/slice-m2/ ./compiler/self-host-v2/slice-m3/ ./compiler/self-host-v2/slice-m4/ ./compiler/self-host-v2/slice-codec/`); `bun scripts/facts.ts --check`; `bun scripts/state.ts --check`; `bun run scripts/regen-spec-index.ts --check`; `bun scripts/bootstrap-conformance.ts --check` (regen with --write if you touched conformance/cases); `bun scripts/corpus-compile-floor.ts --check`.
R26: recompile `examples/` + `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` base vs branch; report artifact diff count (item 1 should be inert on code that compiled before).
Push `git push -u origin s466-enum-infer-parseerror`. Do NOT open a PR.

## Report (short)
Worktree; final SHA; governing sentences quoted; where ParseError was ambient; corpus migration table (file → newly refused → migrated/held); gate result lines; open questions.
