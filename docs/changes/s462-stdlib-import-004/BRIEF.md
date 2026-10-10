# BRIEF — s462-stdlib-import-004

Change-id: `s462-stdlib-import-004`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree.

## The defect (RELAYED from a sibling agent — REPRODUCE FIRST)
`import { required } from 'scrml:data'` (a name the stdlib module does not export) compiles clean and fails in the browser (`required is not a function`). SPEC §21 / §34 E-IMPORT-004 ("Imported name not found in target file's exports" — grep `E-IMPORT-004` in compiler/SPEC.md and QUOTE the governing sentence(s), incl. the §21.2/§21.4 text) is enforced for `.scrml` file imports but reportedly NOT for `scrml:` stdlib imports. Several S462 stdlib API changes (http/auth/store/oauth factories → structs; scrml:data builders removed) make this bite: every removed name compiles clean and fails at runtime. A rough probe found `samples/.../protect-001-basic-auth.scrml` importing `verifyHash` from `scrml:auth` (it may live in `scrml:crypto`). Step 1: reproduce on origin/main with a nonexistent name and with that sample; if it does not reproduce, STOP and report.

## Scope
- Enforce E-IMPORT-004 for `scrml:NAME` (and `scrml:NAME/sub`) imports against the module's export table — the SAME table the compiler already uses for stdlib (the `.scrml` export list / stdlib registry — find it; one reader, do not invent a second list; the JS shims must agree with it, and a test should assert every `.scrml` export exists in its shim and vice versa if no such test exists).
- Type-only exports (enum/struct types like `Rule`, `KvStore`, `OAuthStore`, `KvError`) count as exports.
- Message: name the module, the missing name, and (if cheap) the closest existing export ("did you mean …").
- `scrml:compiler*` deferred family (W-STDLIB-COMPILER-DEFERRED) and W-STDLIB-SHIM-MISSING: keep their behaviour; don't double-report.
- Direction: NEWLY-REJECTING. MEASURE by compiling the full corpus (samples/ examples/ stdlib/ conformance/ docs snippets + gauntlet-r25 + adopter repos flogence/giti/6nz READ-ONLY): list every newly-refused site. These sites are BUGS today (they fail at runtime) — report them with the fix each needs, but DO NOT migrate adopter repos; fix in-repo samples/examples only if the fix is unambiguous (e.g. the correct module for verifyHash), and list each.
- Conformance case: a missing stdlib name refused; a valid one accepted.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-stdlib-import-004): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-stdlib-import-004/` · gates incl. CI-only: pre-commit, conformance, browser tier as ci.yml, types:check, tracking tiers (integration + lsp + commands) as ci.yml, `bun scripts/s34-census.ts --check-new --base <origin/main SHA>` · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · reproduction · governing sentence quoted · export-table source used · measured newly-refused sites (each with its fix) · gates.
