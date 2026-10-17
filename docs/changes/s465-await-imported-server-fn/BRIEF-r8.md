Round 8 on the await P0: two roots, both pre-existing on main. I re-ran both reproducers myself and both accept a wrong password.

Your round 7 plus the main merge (f84da20a3) is now PR #1424 with auto-merge on. It lands as is, because it is strictly safer than main on every probe. Round 8 is a follow-up on top of it.

**Setup**
- Cut a NEW local branch `s466-await-r8` from origin/s465-await-r5 (f84da20a3). After #1424 merges, rebase or merge onto main.
- Write this message verbatim to `docs/changes/s465-await-imported-server-fn/BRIEF-r8.md` as the first commit.
- Same worktree discipline and safety rules as before.
- Reviewer probes are READ-ONLY under `/home/bryan-maclee/.cache/scrml-review-await-r7/` (`probes3/m1–m4`, `harness.mjs`, `client/c*`). Copy what you need.

**HIGH-1. A fn-valued binding calling another fn-valued binding is not awaited on the server.**
- Shape: `const w = (a, b) => check(a, b)` with `const v = (p, h) => !w(p, h)` emits `const v = async (p, h) => !w(p, h)`, with no await on `w`. The lib twin `const a2 = (p, h) => !a1(p, h)` has the same bug.
- Repros: `probes3/m3.mjs` bindNotBinding, libBindChainNot; `probes3/m2.mjs` topBindingAwaitedInBinding.
- Root (reviewer-located; verify it): the D-5 binding emit in `emit-server.ts` (~:1715) passes `declaredNames: new Set(byName.keys())`, so every module binding reads as a shadowing local. This is the same bug you fixed on the CLIENT in round 7; the server copy survived.
- Fix by root: module bindings are not locals. The classifier consults the per-file async set before the shadow test, and client and server use ONE rule. Find any other emitter that builds `declaredNames` the same way.

**HIGH-2. A type-annotated `export const` function value is never coloured async (Rule 7).**
- Shape: `export const inner: (p: string, h: string) => boolean = (p, h) => verifyPassword(p, h)` ships sync, and `if (!inner(p, h))` is not awaited, in both the route and the ss1 copy. Unannotated, and annotated non-export, both work.
- Repros: `probes3/m4.mjs` appExportConstAnn, libExportConstAnnInner.
- Root: `fn-valued-bindings.ts:82` reads the init with a regex over `s.raw`; the ss1 emitter reads the structured `valueInit` for the same export.
- Fix: read the parsed init node, with no regex over raw text. Grep `fn-valued-bindings.ts` and `file-async-fns.ts` for any other raw-text read and remove it the same way.

**LOW (fix if small, otherwise file)**
- `asyncFnNamesOfFile`'s fallback, when no set was stashed, computes without the stdlib registry. Make it fail closed: throw an internal error or treat all names as async. It is never reached today.
- Channel server fn calling an imported async helper (`ch1/`): it is refused, but with the generic E-CODEGEN-INVALID-LOGIC. Name the cause if cheap.

**Acceptance**
- All 392 probe shapes (331 old + 61 `probes3`): 0 wrong passwords.
- Corpus differential vs main: 0 newly failing.
- Full gates.
- Push `s466-await-r8` (no PR).
- Report: final SHA, the root confirmed per HIGH, the probe table, gate lines.
