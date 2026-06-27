# BRIEF — ss33: runtime-minimality + test-stability cleanup (3 LOW items, SEQUENTIAL)

**Dispatched by:** sPA ss33 · **Land branch:** `spa/ss33` · **Agent:** scrml-js-codegen-engineer, `isolation:"worktree"`, model opus.

You are in your OWN `isolation:worktree` (off `origin/main`). **PATH DISCIPLINE:** edit only via paths relative to YOUR worktree root; verify `git rev-parse --show-toplevel` before writes. NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/...` (main checkout — a live PA session). Do NOT touch `main`, do NOT push, do NOT `--no-verify`.

Three LOW-risk, **disjoint-loci**, small cleanup items. Do them **SEQUENTIALLY**, **commit incrementally (ONE commit per item)** — your branch + per-item commits are your crash-recovery anchor. If one item snags, PARK it (report why) and CONTINUE to the next. Run the FULL `bun run test` once at the end (and R26 for item 2). Pre-existing stdlib "statement boundary not detected" warnings are KNOWN NOISE — ignore.

---

## Item 1 — `g-trucking-smoke-chunks-flake` (LOW, test-harness only)
**File:** `compiler/tests/integration/trucking-dispatch-smoke-integration.test.js`
**Symptom:** the `chunks.json manifest` assertion flakes under FULL-SUITE concurrency (passes isolated + in the gate). **ss27 root-cause: NOT a code race — compile-starvation under ~15GB resource-pressure** (many test files compiling concurrently starve this one's compile). Already uses mkdtemp.
**Fix:** add a **compile-concurrency guard / serial-lane** so this test's compile doesn't race the rest of the suite. Bun's `bun:test` has NO native `test.serial` (files run concurrently) — so DON'T rely on a `.serial` marker. Options to evaluate + pick the cleanest:
- a module-level shared async mutex/semaphore around the compile step (so the heavy compile serializes against other guard-holders), or
- raise this test's robustness to starvation (e.g. await-with-retry on the compile, or a generous per-test timeout), or
- a `describe`-level serialization primitive if the harness already has one (grep the test dir for an existing concurrency helper first).
Pick the lowest-touch mechanism that makes the assertion deterministic under full-suite load. Test-harness only — no source/codegen change.

## Item 2 — `g-client-read-prune-chunk-dependent` (LOW, codegen — R26 applies)
**File:** `compiler/src/codegen/emit-client.ts`
**Symptom:** ss19 #5's **stdlib read-LINE strip** (the GITI-003 prune that deletes the lowered `const { … } = _scrml_stdlib.NAME;` read line from client.js) is **latently ineffective when the chunk is PRESENT** — because it scans the **runtime-spliced** body. After the runtime splice (`lines[runtimeInsertIndex] = runtimeSource` at **line ~1934**), the scanned body contains the spliced-in runtime chunk text, so a name that's "used" only inside the runtime reads as used → the read line is NOT stripped.
**Reference for the correct pattern (already does it right):** the **ss27-4 `prune-server-only-stdlib-chunks`** stage at **lines 1851-1928** builds its scan `body` from the emitted `lines` BEFORE the splice and EXCLUDING the read-decl lines (`body = strLines.filter((_, i) => !readLineIdx.has(i))`, line 1909). It runs pre-splice (line 1909 vs splice at 1934).
**Fix:** locate the ss19 #5 read-LINE strip (grep `ss19`, `GITI-003`, `stdlibRe`, the read-line deletion — comments reference it at lines ~416/~1566/~1856; it likely runs AFTER 1934). Make it operate on the **pre-splice** body (and/or be chunk-aware the same way the ss27-4 stage is), so the spliced runtime never masks the used/unused decision. Keep the `!testMode` gating semantics consistent (in testMode BOTH chunk + read line are kept). Do NOT over-strip — preserve the conservative guards (a local name present in the real client body keeps the line). **R26: recompile a real example whose stdlib import is server-only (and one whose import is client-used) and confirm the read line is stripped in the former, kept in the latter — verify against the actual emitted client.js, not synthesized AST.**

## Item 3 — `g-dev-server-idletimeout-not-configurable` (LOW, config threading)
**Files:** `compiler/src/commands/dev.js` (the dev serve config — `idleTimeout: 120` at **line ~455**) · `compiler/src/commands/build.js` (the EMITTED prod-server config — `idleTimeout: 120,` pushed as a string at **line ~346**).
**Symptom:** the 120s `idleTimeout` (S221 flogence fix — default 10s truncates legitimate >10s data-layer routes) is a hard constant, not overridable.
**Fix:** thread an `idleTimeout` option (DEFAULT 120, unchanged behavior when unset) through:
- `dev.js` `buildServeConfig` (grep it — the serve-config builder) — accept an `idleTimeout` from the relevant settings/option source and use it instead of the literal 120.
- `build.js` — emit the configured value into the prod-server config string instead of the hardcoded `120`.
Source the override from wherever the codebase already carries build/dev knobs (`compilerSettings` / a CLI flag — grep for how other dev/build options are threaded, e.g. an existing option on the command, and MIRROR that mechanism — do NOT invent a new config channel). Keep default 120 so nothing changes for callers who don't set it.

---

## VERIFICATION (end of run)
- FULL `bun run test` green (~17.6k tests, ~100s). Item-1's fix must make the trucking-smoke assertion deterministic — run the full suite at least twice to confirm the flake is gone.
- Item 2: R26 recompile-and-inspect (above).
- Item 3: confirm default-120 behavior is byte-unchanged when no override is set; confirm the override flows when set.

## RETURN (your final message = structured data for the sPA)
Per item: (a) status (done / parked + why); (b) files changed (worktree-relative paths) + the commit SHA for that item; (c) the mechanism you chose (esp. item 1's concurrency primitive + item 3's option channel); (d) full-suite result (pass/fail counts, + the 2× flake re-run for item 1); (e) item-2 R26 evidence. Then: your branch name + final tip SHA.
