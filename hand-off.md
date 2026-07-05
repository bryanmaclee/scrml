# scrml — Session 239 (CLOSE)

**Date:** 2026-07-05. **Profile:** A — FULL (booted `/boot`). A long single-arc session: **built the entire flogence 100%-scrml road** (W5a auto-detect + tool library imports + E-TOOL-006 LANDED; W5b in-process db library BUILT but HELD on the 3rd /code-review cycle), recovered an 11-hour dead agent to a clean landing, and **hardened the PA contract** (adversarial /code-review mandatory on our own codegen dispatches). Mechanical stream → `handOffs/delta-log.md` [372]–[38x].

## ⚠️⚠️ CROSS-MACHINE — READ FIRST (user is switching machines)
On the OTHER machine, before anything: `git -C <scrml> fetch origin && git -C <scrml> pull --rebase origin main`.
- **main** is at the S239 wrap commit (A/B + E-TOOL-006 + all bookkeeping) — pushed.
- **`origin/w5b-wip` @ `95fc65ff`** is the HELD W2/W5b work (the in-process db library — BUILT, full-suite-green, but 14 adversarial-review findings across 3 cycles; NOT landed). It is a real branch on origin — `git fetch` brings it. To continue: base a fresh agent worktree on `origin/w5b-wip` and dispatch the CONSOLIDATION fix round (below). Do NOT re-do the build — it's 90% there; it needs the detection-walker consolidation.
- **scrml-support** main is at `374ec92` (the pa-contract S239 addendum) — pushed. `git -C ../scrml-support pull --rebase` too.

## 🚦 STATE @ S239 close
- **git:** scrml HEAD = the S239 wrap commit, origin PUSHED (coherence 0/0 at wrap). scrml-support `374ec92` pushed. **origin/w5b-wip `95fc65ff`** pushed (the held W2).
- **Board:** HIGH 0 · MED (regen'd — see §0) · tests 26665/0/212 (on the w5b-wip branch; main is 26640-class + A/B's tests). Version 0.7.1.
- **Worktrees:** the agent worktree cleaned at wrap; the branch survives on origin/w5b-wip.
- **⚠️ MAPS:** watermark 66a3afb1 — now ~15+ commits stale (A/B + all S239). Bounded refresh owed (full-set overflows).

## ✅ LANDED + PUSHED this session
- **A/B + E-TOOL-006 (`94e156c5`)** — the flogence CLI-toolchain unblock. `g-tool-import-drop` + `g-foreign-lang-cli-mode-detect` RESOLVED. Emit ES imports from a tool (A1) + additive `<base>.js` for a tool-dep lib (A2) + `<foreign lang>` CLI library-mode (B, shared `library-shape.js`) + Flag-C await-coloring. **E-TOOL-006** minted+ratified (fail-closed on a tool importing a non-importable `.scrml`). **Adversarial /code-review caught 4 real regressions** in the first cut → fix round → clean. Full suite 26652/0.
- **pa-contract S239 addendum (`374ec92`, scrml-support)** — PA-side adversarial `/code-review` is MANDATORY on our OWN codegen dispatches (corrects the S215 false carve-out — the codegen agent can't run /code-review in-agent). Empirical: 4 (A/B) + 6 (W2) real bugs caught on our own dispatches. Memory `feedback_adversarial_verify_not_confirmatory` + MEMORY.md updated.

## 🔴 HELD — W2/W5b (in-process db library) — the main NEXT-START
**Option A / Finding E — RULED + generalize (bryan S239).** Implements **W5b** (the long-staged §44.7.1 cross-file-`?{}`-resolve — flogence's original 100%-scrml blocker). A `?{}` db library fn emits as a plain in-process server binding (own `<db src>` handle + `await _scrml_sql.unsafe`) instead of the null-stub → a tool (and any server consumer) imports+runs it in-process. **BUILT + full-suite-green (26665/0)** — the DONE bar passed (`bun dist/tool.js` → `count=2`; fleet-tool routes over the real db). SCOPE + design: `docs/changes/tool-library-in-process-consumption-2026-07-05/SCOPE.md` (read §0/§3/§8 + D8). Branch: **origin/w5b-wip @95fc65ff**.

**WHY HELD:** 3 /code-review cycles (6 → fixed → 8 more). The 8 re-review findings incl. **web-app regressions** the fix round introduced by sharing the async-coloring machinery. **ROOT (the review named it): "four SQL/foreign detection walkers + two export-const regexes are hand-copied and already inconsistent."** Each patch round re-diverges. **The fix is CONSOLIDATION, not more patches.**

**NEXT-SESSION dispatch = the W5b CONSOLIDATION fix round** (base a worktree on origin/w5b-wip):
1. **ONE shared sql/foreign/transaction detection predicate** used by the routing gate (index.ts) + the async seed (`bodyHasForeignOrSql`) + the per-fn skip — they currently DISAGREE (e.g. routing accepts `sql-ref` but the async seed omits it → [3] sql-ref fns emit sync/null). Include ALL node kinds (`sql`/`sql-ref`/`sqlNode`/`foreign`/`foreignNode`/`transaction-block` as appropriate per caller).
2. **Structural async, not text-regex.** `computeAsyncFnNames` colors via a `\bNAME\(` source-text regex → over-matches comments/strings ([6] web-app regression: `loadRows(` in a comment mis-colors a sync export async). Use `fnNode.isAsync` + the structural call-graph, not text.
3. **Narrow the reroute gate** ([2] web-app REGRESSION — the meaty one): `buildHasToolEntry && isLibraryShapedFile` fires for EVERY library-shaped file, so a browser-consumed `?{}` lib gets rerouted to `generateToolLibraryJs` (whose E-CG-006 push FAILS THE BUILD) merely because a tool exists somewhere in the build. Gate on files a TOOL ACTUALLY IMPORTS (a tool-dep), not all library-shaped files.
4. **Server-path parity** — emit-server's ss1 value-export path needs the same cross-import async seed ([1]) + must drain the foreign-crossing error sink ([7]) (both present on the tool path, missing on the server path).
5. **Export-shape completeness** — `generateToolLibraryJs`'s regex-driven export emission drops destructured/no-init export consts ([4]) + silently skips a transaction-only fn in a mixed lib ([5]); `generateLibraryJs` (the old path) raw-sliced them. Either handle the shapes or fail-closed (never silent-drop).
6. Full findings verbatim: `handOffs/delta-log.md` [38x] + the /code-review outputs (both runs) in `tasks/`. Re-run /code-review (S239 MANDATE) after the consolidation; land + wrap only when clean.

**On landing W5b next session:** flip `g-tool-import-db-fn-null-stub` → resolved; the flogence F residual's crash-half is fixed by it.

## 🧵 flogence — MILESTONE + owed
- **`fleet --route` RUNS END-TO-END** (their 1251 msg, confirmed on A/B `94e156c5`) — the FIRST cross-file 100%-scrml tool: a `kind="tool"` imports a `<foreign lang>` lib, routes over the real db, flows exit codes, clean stdout (via `console.log` in `_{}`). The road is essentially open on the foreign-only + pure path.
- **Owed:** ping flogence when W5b lands (they collapse fsp-route back into fsp-core + import `?{}` db fns directly). Their staged ports (`src/ports/`) are offered for our CLI regression corpus.
- **2 new flogence residuals filed** (their 1251): **D** `g-foreign-multistmt-value-block-mislowers` (multi-stmt `_{}` ending in bare expr → invalid JS; workaround = explicit `return`); **F** `g-tool-over-imports-all-lib-exports` (tool over-imports the whole export set + resolves all to `.js`; crash-half fixed by W5b, over-import remains).

## 📋 Queue (next session, after W5b consolidation)
- W5b consolidation fix round (above) → land → ping flogence.
- **clean-print** (#1, ruled (a)) — needs a design pass (print/println semantics · value-render · tool/server/everywhere · stderr) BEFORE SPEC+impl. flogence has a `console.log`-in-`_{}` escape hatch, so tools aren't blocked.
- flogence residuals D + F (filed).
- `g-e-sql-009-no-db-src-not-fired` (the typer-gate for no-`<db src>` `?{}` — corpus-breakage risk, own scoping).
- Deprioritized: fail-variant-arity E-TYPE mint (#3) + hostmethod-poison (#4) — type-system.ts, serialized.
- Bounded maps refresh (stale ~15+ commits).

## pa.md directives in force
R1–R5 · Profile A · **S239 addendum — PA-side /code-review MANDATORY on our own codegen dispatches** (new this session) · commit PATHSPEC form · background-commit/-push to dodge Config-B gate timeout (foreground push needs timeout ≥300000; the 2min default kills it) · S236 verify-non-empty · S226 landing-concurrency · S219 orchestrate+default-GO · S215 adversarial · S138 R26 · S147 coherence · S88/S99/S126 path-discipline · S237 SendMessage-resume (used 2× this session to recover the 11h-dead agent).

## Tags
#session-239 #close #flogence-road-built #w5b-held-for-consolidation #e-tool-006 #pa-contract-hardened-adversarial #cross-machine-w5b-wip
