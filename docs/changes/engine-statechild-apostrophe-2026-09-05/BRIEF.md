Generalize the S196 apostrophe fix to the `<engine>` state-child locus: a plain-markup body inside a state-child is FREE-TEXT, and an apostrophe in prose is display text, not a string delimiter.

change-id: `engine-statechild-apostrophe-2026-09-05`

**Routed by peter (S398) as `g-engine-state-child-apostrophe-breaks-parse` (MED, open). PA-INDEPENDENTLY REPRODUCED AT HEAD** — peter's filing was two-sided on `c91969c7`; this brief re-ran it on `6f8cafe5` and it still reproduces.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

Before anything else; if ANY check fails, STOP and report.

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean.
3. Assert base: `git merge-base HEAD origin/main` == `origin/main`.
4. `bun install` — a fresh worktree does not inherit `node_modules`.
5. `bun run pretest` — run it PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts actually appeared.
6. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(engine-apostrophe): start at <that pwd>`.

Edit via Edit/Write on **worktree-absolute paths only**. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f` / `killall`** — other agents run suites and every checkout shares the command string. Commit after each meaningful unit; append to `docs/changes/engine-statechild-apostrophe-2026-09-05/progress.md`.

## MAPS

`.claude/maps/primary.map.md` first, then `structure.map.md`. Maps stamped `10a4b045`; treat as verify-against-source hypothesis.

## THE DEFECT — PA-reproduced at HEAD, three-way

```scrml
type S:enum = { A, B }
<engine for=S initial=.A>
    <A rule=.B><p>go</p></>
    <B><p>it's ready</p></>
</>
```

| fixture | apostrophes in the `<p>` prose | result at `6f8cafe5` |
|---|---|---|
| odd | 1 (`it's`) | **`E-ENGINE-STATE-CHILD-MISSING`** — names `.B`, which is present in source |
| even | 2 (`it's here, don't leave`) | **compiles clean** ← proves string-lexing |
| control | 0 (`it is ready`) | compiles clean |

**The even-count control is the whole diagnosis:** an even number of apostrophes "closes" the phantom string, so the body scan recovers. The closer-scan is treating `'` as a string-span opener; an unterminated span swallows the `</>` closer and any following state-children, so the last variant reads as missing.

## THE GOVERNING SENTENCE — quoted, because this is a NEWLY-ACCEPTING change

Direction-of-change (base §8): a program that is rejected today will compile after the fix. Newly-accepting is normally a one-way door **and this one is the sanctioned exception — conformance restoration, "toward the contract"** — because normative text already says the form is legal:

- **`SPEC.md:1090`** — *"The state-child bodies of `<engine>` and the arm bodies of `<match>` are **code-default bodies** (§4.18.1) … The `<errors>` override-template body and **any plain-markup element body are free-text bodies**."*
- **§4.18.2** — *"The error does NOT fire in free-text-mode bodies — **a bare run of prose in a `<p>` body is display text, unchanged**."*
- **§4.17 orthogonality note (`SPEC.md:1167`)** — a plain-markup child opened inside a code-default body *"opens a free-text body."*

So a `<p>` inside an engine state-child body is free-text, and apostrophised prose there is display text. **The implementation wrongly rejects it.** Ship it as a bug fix; do NOT treat it as a language widening.

⚑ **SCOPE BOUNDARY, and it is the thing most likely to go wrong.** The state-child body ITSELF is **code-default** (§4.18.1) — a bare run there is CODE and display text needs `"..."`. **This fix must NOT make a bare apostrophised run legal directly in the state-child body**; that would be a real widening with no governing sentence. The fix is about the CLOSER-FINDING SCAN not mistaking `'` inside a NESTED FREE-TEXT body for a string delimiter. Build a negative fixture proving the code-default rule still holds.

## THE PRECEDENT — this is a generalize-per-locus, and the sibling is RESOLVED

`g-match-arm-apostrophe-bs` (RESOLVED S196) is the identical class at the `<match>` locus, fixed at `block-splitter.js` `findStructuralBodyEnd` + `match-statechild-parser.ts` `findArmCloser`/`findNextArmOpener`, under the S109 ruling *"markup-text body is TEXT with no string concept."* **Read that fix first and mirror it** rather than inventing a second approach.

**Locus (PA-located-verify, from peter's filing — I have NOT traced execution into it):** `compiler/src/engine-statechild-parser.ts`, its own closer-scan. The ledger entry notes a phantom-string hazard already acknowledged near `:1398` and `:2155` with an incomplete guard. Locate by SYMBOL. Report if the real deciding site is elsewhere — this is a hypothesis, and a fix at the wrong site here would be correct-at-that-site and incomplete, which passes its own tests.

⚑ **The same generalize-per-locus shape has bitten twice already** (`g-shorthand-interp-engine-element-loci` — the S196 `:`-shorthand fix also needed separate engine-locus wiring). **So enumerate the loci: is `match-statechild-parser` / `engine-statechild-parser` the whole set, or is there a third body-scanner with the same defect?** Count what you are NOT fixing and say so.

## SECOND DEFECT IN THE SAME REPORT — the diagnostic

Peter filed this as two defects and he is right. `E-ENGINE-STATE-CHILD-MISSING` tells the author to *"Add the missing state-child (`<B>...</>`)"* when `<B>` is right there — an **un-followable remedy**, and the true cause (an apostrophe) appears nowhere in the message. It is worse than the `<match>` sibling's `E-CTX-001 "Unclosed <match>"`, which at least points at the right shape. If the parse fix makes the diagnostic unreachable for this input, say so and leave it. If the message can still fire on a genuinely-missing child, it is fine as-is. **Do not widen the diagnostic's fire condition** to chase this.

## VERIFICATION

1. **The three-way table above**, as permanent conformance/unit fixtures: odd → compiles, even → compiles, control → compiles. Plus contractions in real UI copy (`don't` / `we'll` / `can't`).
2. **Two-sided negative:** a bare apostrophised run *directly* in a state-child body (not inside a nested `<p>`) must STILL be a code-default error. The fix must not reach it.
3. **Corpus differential** — `scripts/corpus-emit-differential.ts`, **both sides at the same `--compiler-root`** (different absolute paths false-diff ~1027 of 7427 on a path-derived token, `g-corpus-emit-differential-incomparable-across-checkout-paths`). Report skipped populations.
4. **Full `bun run test`** from the worktree CWD + conformance. Zero newly-failing.
5. **R26 empirical** — recompile real adopter `.scrml` on the post-fix baseline.
6. **Measured migration** — grep the corpus for apostrophised prose inside engine state-child bodies and report the count. Newly-accepting owes the count even when it is zero; assumed-zero is not measured-zero.

⚑ **Do not use `compiler/tests/commands/` green-ness as a signal** — five dev-server tests there expire their `waitFor` budgets in cloud CI while passing locally (`g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`).

## REPORT BACK — under two pages, no narration

1. The deciding site, and whether peter's locus held / was refined / was wrong.
2. The full locus enumeration — every body-scanner with this defect, including any you did NOT fix.
3. The three-way table + the two-sided negative result.
4. The measured migration count.
5. Corpus differential incl. skipped populations; suite / conformance / R26.
6. Final branch + SHA + files touched.
7. Anything contradicting this brief — especially if the code-default boundary turns out to be harder to preserve than stated.

Label claims `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. No `--no-verify`, and never override `core.hooksPath`.
