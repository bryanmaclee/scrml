# BRIEF — the three fn-name-mangler defects (fix, do NOT retire the pass)

change-id: `mangler-three-defects` · dispatched S325-bryan 2026-08-06 · base main (see dispatch)
agent: `scrml-js-codegen-engineer` · `isolation: "worktree"` · opus
DONE-PROBE: bun test compiler/tests/unit/mangler-region-fencing.test.js >/dev/null 2>&1

Gaps: `g-embed-runtime-ships-mangled-runtime-identifiers` (HIGH) ·
`g-mangler-empty-name-whole-buffer-insertion` (MED) ·
`g-mangler-scope-blind-shorthand-key-rename` (MED)

## ⚑ SCOPE FENCE — read this first

**You are NOT retiring the `post-fn-name-mangle` pass.** That was measured at S325 and is
ordering-blocked: 871 live call sites, 0 repaired by any other pass, 145 measured load-time
ReferenceErrors on deletion, and ~47 sites where the encoded name does not exist yet when the site is
emitted. Full record: `docs/changes/limb2-mangler-retirement/SCOPING.md` — **read it before you touch
this pass**, it will save you from re-deriving the constraints.

**The pass stays. You are fixing three defects IN it.**

## ⚑ THE DIRECTION, and why it is not "patch the regex again"

This pass already carries FIVE accumulated patches (Bug D, Bug I, Bug Z, g-spread, PGO P3.A), each a
lookaround tweak on a text heuristic. Two of them were measured to defend EMPTY populations. **A sixth
lookaround is the wrong shape.**

Prefer **REGION EXCLUSION through the machinery that already exists** — `rewriteCodeSegments`
(`code-segments.ts`) is already the string/regex/comment-aware region fence this pass runs through.
Defects 1 and 3 are both "this REGION should not be rewritten" problems, not "this PATTERN should not
match" problems. Defect 2 is a data-validity guard at map construction.

**This is a direction, not an order.** If the code disagrees on contact — say so and propose what it
actually wants. Do not build around a direction you have measured to be wrong.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; toplevel
   matches; tree clean. **Any failure → STOP and report.**
2. `bun install`; `bun run pretest`. Use `bun run test` for full runs.
3. Absolute worktree paths for every Read/Write/Edit. **NEVER `cd` into the main checkout** — use
   `--cwd "$WORKTREE_ROOT"`, `git -C "$WORKTREE_ROOT"`.
4. First commit `WIP(mangler-three-defects): start at $(pwd)`. Commit per defect; keep `progress.md`
   current. **Never `--no-verify`; never touch `core.hooksPath`.**
5. ⚠ A SIBLING AGENT may be editing `compiler/src/codegen/emit-server.ts`. **Do not touch that file.**

## MAPS
`.claude/maps/primary.map.md` then `dependencies.map.md`. Report the load-bearing finding, "not
load-bearing" included. ⚑ **`bun scripts/corpus-emit-differential.ts` is the standing hand-run pre-land
gate for any `compiler/src/codegen/` change.** `diff` exit 2 = INVALID COMPARISON, not "no differences".

## DEFECT 1 — HIGH, live, EXECUTED: `--embed-runtime` ships a corrupted runtime

138 rewrites (99 sources) land inside the assembled runtime text spliced at `runtimeInsertIndex`.
Colliding user fn names measured: `log` ×74 · `fn` ×33 · `label` ×19 · `tick` ×8 · `handle` ×2 ·
`computed` ×2. Inert in the DEFAULT mode — `codegen/index.ts:2128` slices the runtime off the front and
emits it separately. Under `--embed-runtime` (`commands/compile.js:172`) the corruption SHIPS:

```js
function _scrml_replay(name, _scrml_log_1, endIdx) {   // parameter renamed
  const n = (endIdx != null) ? endIdx : log.length;    // body NOT renamed
```

Reproduce: `bun compiler/src/cli.js compile samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-do-while-064.scrml -o <out> --embed-runtime`

The runtime slot is compiler-owned text that user fn names must never reach. Fence it.
**Verify BOTH modes:** default-mode output must stay byte-identical (it already works), and
`--embed-runtime` must ship an uncorrupted runtime.

## DEFECT 2 — MED: an empty `fnNameMap` key makes the alternation a whole-buffer inserter

`stdlib/cron/index.scrml` puts `"" → _scrml_v_1` in the map. `\b(…|)\b` then matches ZERO-WIDTH at
every word boundary satisfying the lookahead — **781 injections into one file** (the single largest
rewrite bucket in the corpus). Currently masked: that source already fails `E-CODEGEN-INVALID-LOGIC`
upstream, and the error text is itself the symptom. **Any nameless fn reaching `fnNameMap` re-arms it.**

Guard at map construction (`emit-functions.ts:604`), not in the regex. Decide and STATE whether an
empty key is (a) always a bug upstream that deserves a loud internal assertion, or (b) a legitimate
shape to skip silently — and say which you chose and why.

## DEFECT 3 — MED: scope-blind rewrite renames object-shorthand KEYS → silent `undefined`

No scope awareness: parameter declarations that shadow a top-level fn get renamed, and only those
references whose next char is in the partial lookahead set follow. The written-artifact half is the
dangerous one (measured in `stdlib/http/index.scrml`):

```
base:    const inner = wrapped || {_scrml_get_2, _scrml_post_3, _scrml_put_4, _scrml_del_5, _scrml_patch_6}
deleted: const inner = wrapped || {get, post, put, del, patch}
```

Shorthand **KEY** names change → `inner.get(...)` is `undefined`. No syntax error, no diagnostic.
Both known sources fail compile upstream today, so **construct your own reproducer** on a
cleanly-compiling source — do not conclude "not reproducible" from the two masked ones.

⚑ **Object-shorthand is a REGION, and there is a live negative dependency you must not break:**
`emit-client.ts:127-137` and `:2519-2520` reason that the module-registry footer is safe precisely
BECAUSE property keys are followed by `:` and sit outside the lookahead. Any change here must keep the
footer correct. **The full-scope-analysis version of this fix is OUT OF SCOPE** — if the shorthand-key
region fence does not cover the shadowed-parameter half, fence what you can, MEASURE and REPORT the
residual, and file the remainder. A partial fix that names its residual is fine; one that implies full
coverage is not (pa-base §8, no silent caps).

## VERIFICATION
- `bun run test` green.
- **`bun scripts/corpus-emit-differential.ts` base-vs-head.** Expect a NON-zero, EXPLAINED delta
  (defects 1 and 3 change emitted output by design). Enumerate every differing artifact and say why it
  differs. An unexplained diff is a finding, not noise.
- **Per-defect bite proof:** revert each fix, confirm its test goes RED, restore, confirm GREEN.
- R26 recompile of `examples/` + `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`.
- **Re-run the S325 population count** if the probe branch is reachable
  (`worktree-agent-a991f86dc83d4aebf`, env-gated) and report whether the 1413/871 figures moved. If it
  is not reachable, say so — do not fabricate a comparison.

## REPORT
Worktree · final SHA · files touched · per defect: what you changed, the bite proof, and whether the
direction (region fencing) HELD / was REFINED / was WRONG · the corpus-differential enumeration · any
residual you fenced rather than fixed. **If a defect turns out not to reproduce, say so loudly** — a
NOT-REPRODUCED is as valuable as a fix.
