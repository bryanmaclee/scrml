# S436 — `<program>` session config resolved BUILD-wide instead of PROGRAM-wide (security)

Append-only. Worktree: `.claude/worktrees/agent-a54164111f2d875ac`, cut from `origin/main` `c46ebbf8`.

## 1. Startup verification — PASS
- `pwd` = `/c/Users/poliv/Documents/GitHub/scrml/.claude/worktrees/agent-a54164111f2d875ac`
- `git rev-parse --show-toplevel` = same
- `git status --porcelain` = clean
- `git merge-base HEAD origin/main` = `c46ebbf884cf00f0aba3ec710d404e5639c7d439` = `origin/main` = `HEAD`
- `bun install` = 218 packages installed in the worktree

## 2. Independent reproduction of the defect (pre-fix, `c46ebbf8`)
Scratch probe, emitted-text measurement, all three diagnostic channels collected.

| compile set | unit | cookie name | `_scrml_session_max_age` |
|---|---|---|---|
| B alone | `sub/zzz` | `__Host-scrml_sid` | 3600 |
| A alone | `aaa` | `scrml_sid` | 604800 |
| A+B (fwd) | `sub/zzz` | **`scrml_sid`** | **604800** |
| A+B (rev) | `sub/zzz` | **`scrml_sid`** | **604800** |

Zero hard errors in every run (only W-PROGRAM-REDUNDANT-LOGIC, W-PROGRAM-SPA-INFERRED,
W-DEPRECATED-SERVER-MODIFIER, I-AUTH-REDIRECT-UNRESOLVED, W-AUTH-LOGIN-MISSING — identical
set in every run, so no diagnostic distinguishes the downgraded build).

Harness sanity: the first run of the probe reported `NO-OUTPUT` because `result.outputs` is
keyed by the SOURCE path, not the emitted `.server.js` path. Caught and corrected BEFORE
quoting any zero.

## 3. Root — HOLDS as stated
- `compiler/src/codegen/index.ts` `_readProgramAttr` iterates the whole `files` array, no
  membership test, stamps one build-wide answer onto every fileAST.
- `compiler/src/codegen/emit-server.ts` consumes it as the last fallback for both attributes.
- Refinement: the `sessionExpiry` chain ALREADY has the per-unit raw read as its middle step
  (`_readRawProgramAttr("sessionExpiry")`), so a sibling program only governs a unit that
  declares nothing — which is exactly B. The security half (`session-secure`) has the same
  three-step shape. One guard at the pre-scan fixes both.

## 4. Membership vs count — count, and why
No reliable unit -> owning-`<program>` relation exists. The compiler says so itself at the
shell-composition post-pass (`codegen/index.ts` ~:2884): entry identity is a BUILD fact per
SPEC §40.8, this site infers it from file CONTENT and takes the first match, `E-PROGRAM-002`
is reserved-not-implemented, and "closing this needs a build-root entry resolver over the
file SET, which is a separate arc". So: COUNT-BASED FAIL-CLOSED, and said so.

## 5. Regression test — BITE PROVEN PRE-FIX
`compiler/tests/conformance/conf-SESSION-PROGRAM-ATTR-SCOPE.test.js`
On pre-fix source: **4 pass / 3 fail**. The 3 failures are the defect (A+B fwd, A+B rev,
alone-vs-beside identity). The 4 passes are the two controls and both #282 single-program
multi-unit cases — i.e. the preserved behaviour is pinned green before the change.

## 6. The fix — applied (commit `4d05142f`)
`compiler/src/codegen/index.ts` — `_readProgramAttr` is gated on
`_multiProgramCompileSet` (`_programDeclFiles.length >= 2`), computed with the SAME
node scan the reader uses so count and read cannot drift. 0 or 1 program-bearing file
→ unchanged; 2+ → `undefined`/`null` stamped, every unit falls to its own declaration
or the language default. `// TODO(bryan-ruling)` left at the suppression site naming
the diagnostic question, nothing more.

`compiler/src/codegen/emit-server.ts` — comment corrections only, no behaviour:
the "strictly ADDITIVE ... reached only where the answer today is 'nothing declared →
default secure'" claim is replaced with the measured truth (the only reachable effect
of the `session-secure` fallback is to weaken a secure default), plus the matching
correction on the `sessionExpiry` chain (its S433 middle step rescues a unit that
declares its OWN attribute and does nothing for a unit that declares neither).

## 7. Bite proof (run BOTH ways; source flipped by FILE COPY, never `git stash`)
First round, 7 emit-inspection tests:
- pre-fix source (the `origin/main` file copied into the worktree): **4 pass / 3 fail**
- post-fix: **7 pass / 0 fail**
Final, with the runtime case added (8 tests):
- pre-fix: **4 pass / 4 fail** — A+B fwd, A+B rev, alone-vs-beside emitted-line
  identity, and the runtime real-`Set-Cookie` case
- post-fix: **8 pass / 0 fail**
The 4 pre-fix passes (both controls + both #282 single-program multi-unit cases) stay
green on both sides, so the preserved behaviour was pinned before and after.

## 8. Corpus A/B — 0 of 1137
Population: **all 2,640 tracked `.scrml` files, grouped into 1,137 compile sets by
containing directory** (the natural `compileScrml` unit). Manifest per set = sha256 of
every emitted `html`/`css`/`clientJs`/`serverJs`, plus the in-the-clear cookie names /
`_scrml_session_max_age` values, plus per-code diagnostic counts across all THREE
channels (`errors` + `warnings` + `lintDiagnostics`).
- **identical: 1137. DELTAS: 0.** Zero classified as findings; there are none.
- determinism control: a second pre-fix run is byte-identical to the first.
- ONE set threw both sides identically (`samples/gauntlet-s19-phase4`, "Maximum call
  stack size exceeded") — pre-existing, unrelated, unchanged by the fix.

**POSITIVE CONTROL — the 0 is not blind.** A synthetic canary set run through the SAME
manifest code, pre-fix vs post-fix:
- `canary/two-programs` → `sub/zzz` serverJs hash `fd80370f…` → `f533f058…`,
  session `{scrml_sid, 604800}` → `{__Host-scrml_sid, 3600}`  ← the harness SEES it
- `canary/one-program-two-units` → both units byte-identical hashes across the fix
  (`b7c73cb9…`, `c74e5ce9…`)  ← #282 preserved, at the hash level

**Why the corpus zero is structural, measured not assumed:**
- 76 of 1137 sets hold 2+ top-level `<program>` files.
- 12 of those 76 sets (47 emitted units) also emit session cookie config — this is the
  GUARD-LIVE population, where the new guard actually fires. It fired on all 47 and
  changed nothing.
- 0 tracked `.scrml` declares `session-secure` anywhere in the repo.
- 2 declare `sessionExpiry` (`compiler/self-host/ast.scrml`, `…/ri.scrml`); that set
  emits 0 session-config units, so there was nothing to bleed.
- Every one of the 106 session-emitting corpus units, in every set, emits
  `__Host-scrml_sid` at `3600` both before and after.

## 9. Direction of change
**semantics-changed**, confined to one shape, in the hardening direction. NOT
newly-rejecting: no diagnostic is added, removed, or re-conditioned (diagnostic counts
identical across all 1137 sets; identical diagnostic set in the canary both sides).
Not newly-accepting: no program that was rejected now compiles.
**Measured migration count: 0 of 1137 compile sets / 0 of 106 session-emitting units /
0 of 47 guard-live units.**

## 10. Gates
- `bun run test` (full suite, `pretest` chained), FAILURE NAME SET compared, not counts.
  THREE runs:
    1. post-fix (7-test version)          — 98 `(fail)` lines
    2. pre-fix baseline (new test moved aside so the baseline is clean) — 98 lines,
       `diff` against run 1 **empty**
    3. post-fix final (runtime case added) — 97 lines
  Run 3 vs the pre-fix baseline: **zero new failures**; one baseline failure passes,
  `"dev watcher snapshot identity — a timestamp-restoring in-place write cannot hide
  > an in-place same-length write with mtime restored still moves ctime…"`. It FAILED
  in both runs 1 and 2 and PASSED in run 3, i.e. it flaps between two identical
  post-fix runs — a filesystem ctime-timing test, unrelated to session config and not
  reachable from this change. FLAKY, not fixed by me and not broken by me.
- `tsc` with the types-gate's exact argv over its exact roots: 248 diagnostics pre-fix,
  248 post-fix, position-independent sets **identical** (0 new, 0 fixed). The gate
  script itself is not runnable on this box (Unix-path `.bin/tsc` hardcode).
- `bun scripts/facts.ts --check` went STALE on my change (+79 `compiler/src` lines,
  +1 test file) → `--write` → PASS.

## 11. NOT closed by this pass
`g-session-store-namespace-not-discriminated-per-program` — two programs in one dist
sharing one `.scrml-sessions.db` AND one `"session"` namespace, so A's login resolves
in B. Different mechanism, already filed, disclosed in SPEC §20.5, deliberately
untouched. This fix must not be read as closing it.

## 12. RUNTIME EXECUTION — and the defect is WORSE than "the `__Host-` prefix is lost"
Compiled with `write: true`, `chdir` into the dist, `import` the emitted
`sub/zzz.server.js`, CSRF'd `Request`, `route.handler(req)`, real `Set-Cookie` header
read off the `Response` (no happy-dom). Both sides, same script:

PRE-FIX
  B alone  -> `__Host-scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`
  A + B    -> `scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
POST-FIX
  B alone  -> `__Host-scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`
  A + B    -> `__Host-scrml_sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`

⚑ The pre-fix downgraded header has **no `Secure` attribute at all** — not merely the
missing `__Host-` prefix. The bled `session-secure="false"` drops `Secure` from the
emitted `Set-Cookie`, so program B's session cookie was transmissible over plain HTTP.
That is a bigger downgrade than the brief stated, and it is confirmed by execution,
not by reading emitted text.

## 13. Unmeasured
- No adopter-clone measurement: `../assetManagement` is not reachable from this
  worktree, so the real-app migration count is UNMEASURED (corpus-only).
- No real browser was driven; `__Host-` enforcement is a browser behaviour and was not
  observed in a browser. The server-side header is confirmed by execution.
- The count heuristic's behaviour on a genuine multi-unit program that shares a compile
  set with a second `<program>` is DESIGNED (inheritance suppressed → hardened default)
  but has no corpus instance, so it is asserted by construction and by the conformance
  test, not observed in the wild.
  > ⚑ **WRONG, corrected in round 2 (F1).** It is not a hardened default, it is a
  > functional regression: the unit gets a hardened cookie its own program cannot read.
  > Measured in R2.1 below. The claim above is left in place, struck, rather than
  > quietly edited — it is the thing the S239 pass caught.

---

# ROUND 2 — S239 fix-round (#1080 HELD)

## R2.1 Independent reproduction BEFORE touching anything
All three review findings reproduced on my own HEAD `0dc3bca3`, both input orders, zero hard
errors, and each run against `origin/main` too, so introduced-vs-pre-existing is measured rather
than assumed:

| finding | on `origin/main c46ebbf8` | on round-1 `0dc3bca3` | verdict |
|---|---|---|---|
| **F1** 3-unit set: A + A's own member + unrelated B | all three `scrml_sid`/604800 (A internally consistent; B leaked) | `index` `scrml_sid`/604800, **`pages/minter` `__Host-`/3600**, `zzz` `__Host-`/3600 | **INTRODUCED by round 1** — reviewer correct |
| **F2** two top-level `<program>` in ONE file + minting page | `other` gets `scrml_sid`/604800 | `other` gets `scrml_sid`/604800 (**guard never fired**) | **PRE-EXISTING**, survived the guard |
| **F3** `<program>` nested in a `<div>` + member page | `nest` `scrml_sid`, `minter` `__Host-` | identical | **PRE-EXISTING**, and NOT merely a comment defect |

F3 is upgraded from the LOW it was filed as. A top-level-only scan did not just describe the reader
wrongly — it missed a nested `<program>` entirely, so a SINGLE-program compile set was already
splitting its own cookie name on `origin/main`. That is the #282 writer/reader split, pre-existing.

## R2.2 F2 + F3 fixed (commit `e4747602`)
One recursive `<program>`-NODE collection, shared by the count and the read.

- **F2** — count NODES, not program-bearing FILES. `other` is now `__Host-`/3600, matching the
  compiled-alone control.
- **F3** — recurse, because `_readRawProgramAttr` recurses. `nest` and `minter` now AGREE
  (`scrml_sid`/604800); the pre-existing single-program split is closed.
- **The "cannot drift" claim** is rewritten, not asserted away. Count and read now share one node
  list, so those two cannot disagree. The two remaining differences from `_readRawProgramAttr` are
  stated in the code rather than papered over: (1) `<page>` is deliberately NOT counted — every
  composed app has many `<page>` units, so counting them would fire the 2+ branch almost everywhere
  and suppress the very inheritance #282 needs, and a `<page>` attribute is per-page by
  construction; (2) first-match vs last-match is UNREACHABLE, because the read is gated on there
  being at most ONE `<program>` node in the whole compile set.

## R2.3 Bite matrix — `conf-SESSION-PROGRAM-ATTR-SCOPE.test.js`, now 13 tests
| source | result |
|---|---|
| `origin/main c46ebbf8` | **4 pass / 9 fail** |
| round 1 `0dc3bca3` (file-counting) | **9 pass / 4 fail** (the 4 = F2 x2, F3 x2) |
| round 2 (this branch) | **13 pass / 0 fail** |

F1's cost is pinned by a test that asserts the split and is LABELLED a cost awaiting ruling, so on
the day it is ruled the assertion that must change is impossible to miss.

## R2.4 Corpus A/B re-run after F2/F3 — still 0 of 1137
Same 1,137 directory compile sets over all 2,640 tracked `.scrml`: **identical 1137, DELTAS 0**
against the `origin/main` baseline.

The canary was EXTENDED to cover the new code path, so the zero is controlled for round 2 and not
only for round 1 (serverJs hashes, origin/main then round 2):

- `two-programs` `sub/zzz`: `fd80370f` then `f533f058` (the original fix)
- `one-program-two-units`: `b7c73cb9`, `c74e5ce9` then UNCHANGED (#282 preserved)
- `f2-two-programs-one-file` `other`: `4199ccdc` then `6c496ce3` (**F2 path visible**)
- `f3-nested-program` `minter`: `2f10189f` then `c74e5ce9` (**F3 path visible**)
- `f1-multiunit-beside-2nd`: `zzz` fixed AND `minter` `4199ccdc` then `6c496ce3` (the F1 cost, visible)

## R2.5 F1 fork evidence — `docs/changes/s436-program-session-config-scope/fork-f1.md`
Not decided, not landed. Key measurements:

- **Reachable through the ordinary path.** Real `scrml build` on the F1 fixture exits **0**,
  "Compiled 3 file(s)", "3 server route(s) wired", no diagnostic. Positive control: the same two
  programs each declaring `log=` fail the build with `E-MW-007`, so the probe can see a refusal.
- **Option A (refuse): 0 of 1137 corpus sets, 0 of 15 adopter compile sets.**
- **Option B (warn): 0 of 1137, 0 of 15** — measured from the two manifests (no unit's answer
  changed anywhere), which is the 0-delta corpus A/B read from the other side.
- **Option C (revert): rejected** — restores a hole that, executed, strips `Secure` entirely.
- Precedent found: `compiler/SPEC.md:23763` already makes "two applications in one compiled server"
  an `Error` via `E-MW-007`, remedy *"build one application per output directory"*, and frames it as
  the emitted-server consequence of the reserved `E-PROGRAM-002` shape. Option A is the second
  member of that family, not a new position.
- Implementing `E-PROGRAM-002` itself instead would reject **75 of 1137** corpus sets — a different
  and much larger arc; both options are scoped to sets where session config is actually contested.
- Both proposed codes verified FREE: `E-MW-007` is the current highest `E-MW-0NN`, and no
  `W-SESSION-*` code exists.
- **Recommendation: A.**

### A measurement I got wrong and corrected before quoting it
My first pass at the Option-A population used a source-TEXT regex and reported **1 of 1137**
(`compiler/self-host`, "declared by `ast.scrml`"). That was a **FALSE POSITIVE**: `ast.scrml`'s
`sessionExpiry` is a local variable inside self-hosted compiler logic, not a `<program>` attribute,
and the same regex inflated the 2+-program set count to 90 by matching `<program` in prose and in
self-hosted source strings. Re-measured from the PARSED AST via a temporary probe inside the guard
itself (added, run, removed, never committed): **75** sets have 2+ `<program>` nodes and **0** have
a declaring one. The AST numbers are the ones quoted; the text numbers are withdrawn.

## R2.6 Gates, round 2
- **Full suite** `bun run test`: 98 `(fail)` lines; `diff` against the `origin/main` baseline is
  **empty** — byte-identical failure NAME SET, zero new failures. (The flaky dev-watcher ctime test
  failed on this run, matching the baseline.)
- **tsc**, types-gate argv over its exact roots: 248 diagnostics, position-independent set
  **identical** to the baseline (0 new, 0 fixed).
- **facts**: STALE -> `--write` -> PASS (`compiler/src` 264,636 -> 264,698 lines).

## R2.7 Still unmeasured after round 2
- No browser. `__Host-` enforcement is browser behaviour; the server-side header is confirmed by
  execution, the browser's treatment of it is not.
- Options A and B are **NOT BUILT**. The code shapes in the fork doc are reasoned and reviewed by
  eye only — never compiled, never run, never type-checked. Their POPULATIONS are measured; their
  implementations are not.
- Whether `compiler/self-host` is ever compiled as one directory set by a real build path is not
  established (`scripts/rebuild-bs-dist.ts` compiles `bs.scrml` alone); it is a set in MY corpus
  grouping. Moot for the fork populations, which are 0 either way.

---

# ROUND 3 — BUILD OPTION A (`E-MW-008`)

Operator ruling: option A of `docs/changes/s436-program-session-config-scope/fork-f1.md`.

## R3.0 Rebase
Rebased onto current `origin/main` `37b7a12a` (base was `c46ebbf8`, seven commits replayed, no
conflicts). `git merge-base HEAD origin/main` == `origin/main`. Conformance re-run green
immediately after the rebase, before any round-3 edit.

## R3.1 `E-MW-008` — and the condition I first shipped was WRONG
The condition proposed in the fork doc was "2+ `<program>` declarations AND at least one declares
session config". I built that, and the **full suite caught it**: two pre-existing S433 tests in
`integration/session-program-scope-multi-unit.test.js` went red —
*"a unit's OWN sessionExpiry outranks a SIBLING program's (F1-1)"*, both input orders.

That test compiles `aaa.scrml` (`30m`/`false`) beside `zzz.scrml` (`7d`/`true`), where **every**
`<program>` declares **both** attributes. There is no unattributable unit, nothing is guessed and
nothing bleeds — and S433 deliberately RULED that shape valid. Refusing it would have been a
second regression shipped to fix the first.

Worse: `E-MW-008`'s own message advertises *"declare session-secure=/sessionExpiry= explicitly on
every `<program>` in this build"* as its second remedy. Under the first condition, **following that
advice did not clear the error** — the diagnostic promised an escape the code did not honour.

**The shipped condition**, evaluated PER ATTRIBUTE because the two are independent:
> 2+ `<program>` declarations AND, for `sessionExpiry` or for `session-secure`, some `<program>`
> declares it AND **some compilation unit cannot resolve it for itself**.

i.e. fire exactly when the compiler would otherwise have to GUESS a unit's owner.

**One deliberate over-approximation, recorded not hidden:** a unit counts as "would have to
inherit" whether or not it would actually EMIT session infrastructure. Testing that would mean
mirroring emit-server's `_needsSessionInfra && _webAppShape` predicate in the driver, and mirrored
predicates drift. Cost: over-rejecting a set whose second program never touches sessions; measured
population of that over-rejection is 0. Any divergence between the driver's
`_unitResolvesForItself` and emit-server's `_readRawProgramAttr` fails CLOSED.

## R3.2 Bite matrix — `conf-SESSION-PROGRAM-ATTR-SCOPE.test.js`, now 17 tests
| source | result |
|---|---|
| `origin/main` (unfixed) | **7 pass / 8 fail** |
| round 1 (file-counting guard) | **7 pass / 8 fail** |
| round 2 (recursive node count, no `E-MW-008`) | **9 pass / 6 fail** |
| round 3 (`E-MW-008`) | **17 pass / 0 fail** |

The previous `"KNOWN COST (F1, awaiting ruling)"` test is INVERTED: it asserted the split and the
disjoint reader regexes; that configuration no longer compiles, so it now asserts the refusal and
its comment records why it changed and where the old expectations went.

## R3.3 Newly-rejected population — measured from the IMPLEMENTED condition
Not the fork doc's hypothesis, and not a source-text regex (see round 2's withdrawn measurement).
Compiled, and the diagnostic counted:

| population | newly rejected |
|---|---|
| corpus: 1,137 directory compile sets over all 2,640 tracked `.scrml` | **0 of 1137** |
| adopter clone: 15 per-directory sets **+ the whole `app/src` tree as one set** | **0 of 16** |

Positive control — same harness, synthetic canary: `two-programs`,
`f2-two-programs-one-file` and `f1-multiunit-beside-2nd` each report `{"E-MW-008":1}`;
`one-program-two-units` and `f3-nested-program` report none. The zeroes are not blind.

Nothing was written to the adopter clone (`write: false` throughout).

## R3.4 Scoping, through the real CLI
| fixture | result |
|---|---|
| two programs, `log=` on both, no session config | `E-MW-007`, NOT `E-MW-008` — sibling not masked |
| two programs, `session-secure` on one, no pipeline attrs | `E-MW-008` |
| two programs, neither pipeline nor session config | **exit 0** — this is NOT `E-PROGRAM-002` |
| one program + a member page | **exit 0** — #282 preserved |
| the F1 fixture | now `[CG] …/index.scrml:1:1 E-MW-008`, exit 1 (was exit 0, silent split) |

`E-MW-008` is emitted in `codegen/index.ts`, so it is carried by the `compileScrml` library API as
well as by `scrml build` / `scrml dev` — the library path is how the corpus harness reaches it, and
it was the path by which the original leak was reachable.

## R3.5 SPEC rows — landed, with one deviation from the instruction
Both rows landed: the §34 catalog form beside `E-MW-007` (`:20801`) and the §40-local mirror
(`:23828`). Exactly 2 lines added to `compiler/SPEC.md`.

**Deviation, flagged rather than silently resolved:** the instruction asked for the rows *"with
`prov=`"*. `prov=` occurs **0 times in `compiler/SPEC.md`** — it is the `@gap` marker vocabulary in
`docs/known-gaps.md` (`prov=review:` / `spec:` / `ruling:` / `empirical:`, 643 uses repo-wide, "as
of S313"). Inventing a new attribute syntax inside SPEC.md would widen a published surface on a
misreading, so both rows carry the provenance in SPEC.md's own in-row prose form — the same form
`E-MW-007` uses — ending *"Provenance: S436 review of the §20.5.1 program-scope fix; precedent
`E-MW-007` at §40 (line ~23763)."* If a `prov=` marker is wanted it belongs on a `known-gaps.md`
entry; say the word and I will add one.

## R3.6 Gates, round 3
- **Corpus A/B**: 1137 sets, identical 1137, **DELTAS 0** vs the `origin/main` baseline.
- **Full suite**: 98 `(fail)` lines, `diff` against the baseline **empty** — zero new failures.
  (The intermediate wrong condition produced 100; that is how it was caught.)
- **tsc**, types-gate argv/roots: 248, position-independent set **identical** to baseline — and
  unchanged across the rebase too.
- **facts**: regenerated twice (`compiler/src` 264,698 -> 264,759 lines; `SPEC.md` 38,511 -> 38,513).

## R3.7 Still unmeasured
- **Bryan's language-surface review is outstanding** — `E-MW-008` mints a diagnostic. Per S313 that
  is a review of the built thing, not a pre-approval gate, but it has NOT happened.
- No browser: `__Host-` enforcement is browser behaviour; the server-side header is confirmed by
  execution only.
- `scrml dev`'s surfacing of `E-MW-008` is asserted from the shared compile-failure channel
  `E-MW-007` documents, **not** executed — I ran `scrml build`, not `scrml dev`.
- The over-approximation in R3.1 (not requiring that the unit would actually emit session infra) is
  measured at population 0, but it is an over-approximation by construction, not a proven-tight
  condition.
