change-id: s444-async-escape-wording

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit. Call it WORKTREE_ROOT.
2. Toplevel == WORKTREE_ROOT; clean; `git fetch origin`; assert merge-base HEAD origin/main == origin/main.
3. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT).
4. ABSOLUTE paths under WORKTREE_ROOT only. Never `cd` into /home/bryan/scrmlMaster/scrml. Never `git stash`. Never `pkill -f` on shared strings.
5. First commit: this prompt verbatim → `docs/changes/s444-async-escape-wording/BRIEF.md` + `progress.md`, message `WIP(s444-async-escape-wording): start at <pwd>`. Commit incrementally. Branch: `fix/s444-async-escape-wording`.

## MAPS
Stale (cf62b415) — verify against source.

## Task — diagnostic MESSAGE wording only (the code, severity, fire conditions and spans do NOT change)
An adopter (flogence) reports E-ASYNC-FN-ESCAPES-AS-VALUE states a certainty the rule does not have. The message says: "Whoever calls it through that value gets an unawaited Promise, which is always truthy: a check written against it passes for every input." Under the ruled fail-closed rule (S440 F4 / §13.2), the compiler does NOT know the receiver fails to await — at their site the receiver DID await it (inside a `_={}` block). They lost 20 minutes hunting a compiler bug. Their suggested direction: "…scrml cannot prove the receiver awaits it (…), so the value is refused. Pass data instead, or call it directly and hand back a result."

Builder (PA-located, verify): `compiler/src/codegen/emit-library-shared.ts` `asyncFnEscapesAsValueError` (~line 570-595) and its doc comment. Check for any OTHER site that builds this message text (grep the code string and the "unawaited Promise" phrase across compiler/src, SPEC.md §34 row for E-ASYNC-FN-ESCAPES-AS-VALUE and wherever the rule is specified — grep SPEC.md).

Rewrite so it:
- states the fact honestly: it is async; scrml inserts `await` only at call sites it can see (§13.2); it cannot prove whoever receives this value awaits it, so the value is refused (fail-closed);
- keeps the concrete hazard as a conditional ("if the receiver does not await it, it gets a Promise, which is always truthy…"), not an assertion;
- keeps the existing remedies (call it directly; awaited collection methods list) and adds the "pass data instead / call it directly and hand back a result" inversion as a named migration;
- stays one message, no new code.
Update the doc comment, the SPEC §34 row / §13.x prose ONLY if they quote the old sentence verbatim (keep SPEC normative meaning identical). Update every test / conformance expected.json that asserts on the old message TEXT (grep the tests and conformance/cases for "unawaited Promise"); do NOT change any expected code lists. Direction-of-change: INERT for accept/reject (same code, same sites) — prove it: run the full conformance suite + `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` and state no diagnostic code set changed.

Push `git push -u origin fix/s444-async-escape-wording`. No PR, no merge.

## Report (terse)
WORKTREE_ROOT, SHA, old vs new message verbatim, every file touched and why, test results.
