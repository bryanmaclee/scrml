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
