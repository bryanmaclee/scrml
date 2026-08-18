# FIX ROUND 1 — comment-token-faithfulness (S349)

Append-only. Newest entry at the bottom. Branch `comment-token-fix-r1`, base `215984b9`.

---

## [1] setup + blocker reproduced by execution

- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a871a887670e118c7`,
  `git checkout -B comment-token-fix-r1 FETCH_HEAD` → `215984b9` confirmed.
- `bun install` OK (217 packages). `bun run pretest` OK (13 samples).

### §A blocker — REPRODUCED, both files

| file | base `c159f1a2` (sources reverted in-place) | head `215984b9` |
|---|---|---|
| synthetic reproducer `x1.scrml` | exit 0, 3 artifacts | exit 1, 0 artifacts, `E-CODEGEN-INVALID-LOGIC` |
| `samples/compilation-tests/gauntlet-r10-svelte-dashboard.scrml` | (PA-reported exit 0) | exit 1, 0 artifacts, same code |

Head's error text: ``Unexpected character '@' ...'t access DOM nodes. let _ = @count; }); })();``
— the comment body reached the emitted JS verbatim, and the apostrophe in `Can't`
opened an unterminated string span so `@count` was left un-rewritten.

Base verified by `git checkout c159f1a2 -- compiler/src/{tokenizer.ts,ast-builder.js}`,
compile, then `git checkout HEAD -- ...` to restore. Tree clean afterwards.

Locus confirmed by reading: `ast-builder.js` `when-effect` body collector (~:13739) and
the byte-identical `when-message` / `when-worker` collector (~:13667) both do
`bodyParts.push(lastTok.text)` with no COMMENT guard.

### §C premise — PARTIALLY FALSIFIED (see entry [5]); investigation started

`function f(h = \`a ${hashPassword} b\`) { return h }` at TOP LEVEL truncates to
``h = `a ` `` with the body dropped, exit 0 — CONFIRMED.
But the same shape INSIDE an explicit `${ ... }` logic block round-trips CORRECTLY.
So the truncation is NOT the token-lexeme defect; it is the block-splitter's
top-level `${` scanner, whose backtick tracking is gated on `frame.type === "meta"`.
Also: the "positive control" `h = hashPassword` (no template) does NOT emit a
`.server.js` either — both leak `hashPassword` into the client, so the
control-vs-test escalation difference the review reported does not reproduce.

NEXT: apply the §A guards, then run the full 13-site sweep, then the template
faithfulness work with measurements.
