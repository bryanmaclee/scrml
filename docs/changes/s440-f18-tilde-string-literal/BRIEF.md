change-id: s440-f18-tilde-string-literal

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENT counter this session: 0)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; `git status --short` clean. Else STOP.
2. `git fetch origin && git merge --ff-only origin/main`; assert merge-base == origin/main. Report base SHA.
3. `bun install`, then `bun run pretest` plainly from the worktree CWD.
4. Absolute worktree paths for every Read/Edit/Write; never a main-checkout path; never `cd` into main; Edit/Write, not Bash heredocs.
5. NEVER `git stash`; NEVER `pkill -f`/`killall` on a command string.
6. First commit archives THIS PROMPT verbatim to `docs/changes/s440-f18-tilde-string-literal/BRIEF.md` (`WIP(s440-f18-tilde-string-literal): start at $(pwd)`).
7. Incremental commits + append-only timestamped `docs/changes/s440-f18-tilde-string-literal/progress.md`; code+tests in one commit; never `--no-verify`/hooksPath; commit Bash timeout 600000.

## MAPS
`.claude/maps/primary.map.md` (stamp fb21983a) first; verify against source; report load-bearing or not.

## THE BUG (PA-reproduced on main d244a6f3b)
A one-character string literal `"~"` inside logic is silently compiled to `"__scrml_tilde__"`:
```scrml
<program>
<s> = "a"
${ function f() { return "~" } }
<button onclick=${@s = f()}>x</button>
<p>${@s}</p>
</program>
```
`bun compiler/bin/scrml.js compile f18.scrml --output-dir <tmp>` → client.js contains `return "__scrml_tilde__";`. Expected `return "~";`. Silent wrong output. Found by the bootstrap CSS dispatch (it needed a charCodeAt workaround in `compiler/self-host-v2/` — under the S435 policy impl#1 fixes are allowed when they serve the bootstrap; this one does).

Locus hypothesis (PA-located-verify — grep hit only, NOT traced): `compiler/src/expression-parser.ts` is the only file in compiler/src mentioning `__scrml_tilde__`. The `~` keyword (SPEC §32) is presumably pre-rewritten to a placeholder identifier before parsing, and the rewrite does not skip string literals. Report where the rewrite actually happens and whether this held. Read SPEC §32 (`grep -n '## 32' compiler/SPEC.md`) before changing behaviour.

## THE FIX
Make the `~` rewrite (and its reverse mapping) skip string/template/regex literal contents and comments — structurally if the stage already has tokens (Rule 7: don't ask the text what the tree already knows); if the rewrite genuinely runs pre-tokenization, use the existing lexer's literal-skipping rather than a new regex. Also check the REVERSE direction: can a user string literally containing `__scrml_tilde__` be turned into `~`? (it must not). Probe `'~'`, `` `~` ``, `` `a${x}~` ``, `"a~b"`, `/~/`, a `~` in a `//` comment, and the real `~` keyword uses (§32 pipeline accumulator; `return ~`; `lift` loops) — the keyword must still work.

Also check the other placeholder rewrites in the same pre-pass (if any exist, e.g. for `@`, `not`, `is`, `:>`) for the same string-literal bug — report each; fix any that are the same one-line class in the same function, file the rest as gaps (docs/known-gaps.md entry with `locus=`), do not widen the task beyond that.

## VERIFICATION
- New unit tests for every probe above (red on base, green after).
- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`; `bun conformance/run.ts` counts.
- Corpus: compile `examples/ samples/ conformance/ stdlib/` on base and fix; report every file whose emitted JS changed and classify each (expected: only files with `~` inside a literal).
- If the fix lets you remove the charCodeAt workaround in the bootstrap CSS work: that code is NOT on main yet (it's on an unlanded branch) — do not touch it; just report.

## REPORT
WORKTREE_PATH · base · FINAL_SHA · files · locus held/wrong · sibling rewrites checked · corpus diff classification · test counts. Clean tree before reporting.
