# scrml — Session 278 (bryan) — WRAP

**Date:** 2026-07-21/22. An **ESM-chunks arc** session — U1→U3 landed (esm now runs in a browser, behind the default-classic flag), plus the thread-board false-OPEN guard and a deterministic fix for a commit-blocking flake. Solo.

## ⚠️ READ FIRST — state as of close
- **scrml main = `5385091e`** (#135, U3). Coherence **0/0**. Gate GREEN at HEAD.
- Mechanical state (counts / deltas / the per-unit S239+R26 detail) lives in `handOffs/delta-log.md` **[704]-[714]** and the flogence digest — not duplicated here.
- **The adopter/default (classic) path is byte-identical throughout U1-U3** — proven exhaustively (2048-file samples corpus + all examples + website + multifile + embed). esm is opt-in, off the V1 critical path, and nothing ships to adopters until the U6 default-flip.

## 🎬 WHAT LANDED (7 PRs)
| PR | SHA | what |
|---|---|---|
| **#130** | `f2a82299` | thread-board false-OPEN guard — a malformed `DONE-PROBE` (prose, not a command) now ERRORs loud, not OPEN |
| **#132** | `970d3e1f` | **ESM U1** — `--module-format=classic\|esm` flag + ES-module runtime (`runtime-esm.ts`, R1 meta-block bridge) |
| **#133** | `62f2cf4f` | **ESM U2** — client chunks as ES modules (namespace import, R2 `_scrml_lift_target` bridge, collision dissolved) |
| **#134** | `a22da9d6` | `serve-r26` flake fixed deterministically (`Server.fetch`, no socket — your S273 ruling) |
| **#135** | `5385091e` | **ESM U3** — `type="module"` tags + build-hash import rewrite; **a full `--esm` app RUNS in a browser** |

## 🧭 THE ESM ARC — where it stands
**bryan RULED ESM chunks (S278)**, superseding the S276 IIFE-wrap ruling. The S277 premise for that supersession — *"the emitted chunk system uses shared top-level lexical scope AS its cross-chunk linkage mechanism"* — was **empirically FALSE** (disproved 3 ways: the compiler forbids a page referencing a shell decl; a composed MPA has zero cross-chunk linkage; 97 real website pages show 0 bare refs / 0 registry use). Actual linkage = the `_scrml_modules` registry + load order. ESM stands on **platform-alignment merit** (a hand-rolled module system → the platform's), and it is **compiler-spec not language-spec** (D3 governing sentence: emitted-JS shape is implementation freedom) → reversible, adopter-source-neutral, off the V1 critical path. The survey firmed the estimate at ~3 sessions.

**Units complete:** U1 (flag + module runtime) · U2 (chunks as modules) · U3 (module script tags — esm RUNS).

**Remaining:**
- **U4 — `import()` nav-time chunk loader.** Replaces the classic `createElement("script")` injection; **also unblocks Wave-1c pieces 2+3 → adopter issue #27** (the held worktree `8fd5fd07`). `import()`'s per-call promise natively retires `g-nav-chunk-loading-flag-race`.
- **U5 — committed module-capable browser harness.** The existing browser tests use `eval`/`new Function`, neither of which runs ES modules; U3's full-app-runs proof was PA-side playwright R26. U5 formalizes that into the suite.
- **U6 — the default-flip** (classic → esm as default). The `semantics-changed` moment; discrete + reversible; where the deferred immutable-cache-cascade (below) gets revisited.

**Two shared-mutable-global bridges** established (imports are read-only, so a chunk that WRITES a runtime global needs a globalThis bridge): R1 `_scrml_reactive_get` (U1, meta-block tracking) + R2 `_scrml_lift_target` (U2). A **fail-loud guard** rejects any unbridged third; U2's fix-round completed its write-form coverage (destructure/for-of). Each unit tended to surface a new one — watch for R3 in U4+.

## 🧪 THE SESSION'S METHOD-LESSONS (recorded for the next PA)
- **The "emitted ≠ runs" trap recurred (S265/S268/U3).** Every time, a grep-the-marker test passed while execution failed. U3's per-route DOA (a HIGH) was caught ONLY by executing the emitted chunk in a real browser — the S239 finder's Chromium run + my grep of the chunk body. The unit test asserted the `type=module` marker was *present*, never ran the chunk. **The mandatory adversarial gate executes real output in a real browser precisely for this; it keeps catching real DOA past green suites.**
- **Verify the premise empirically before a codegen dispatch.** The whole ESM-vs-IIFE decision hinged on a premise (S277's "shared lexical scope") that was false; a 3-way empirical check (compiler-forbids + composed-MPA + 97-page corpus) caught it before scoping the wrong arc. Extends the S275 lesson.
- **A commit-blocking flake gets FIXED, not bypassed (bryan, option 2).** The `serve-r26` flake (a real-HTTP round-trip racing under load — the S273 class) blocked U3's commit. Rather than `--no-verify`, the deterministic fix (`Server.fetch`, no socket) unblocks every commit and is the durable move.
- **The cloud gate catches what a fast local machine misses.** U3's local pre-commit passed; the cloud gate failed on 2 composed-MPA tests that compile the 98-file website in-process (~13s) inside a 5s timeout — the slower runner tripped it. Raised the timeout (follow-up: small fixture).

## 🔴 OPEN — needs bryan (carried, not new this session)
1. **The Shape-1 markup question** (S277) — should a plain reactive cell hold a markup value? SPEC amendment, ladder R2. Deliberately NOT bundled into a bug fix.
2. **§34 `E-STYLE-001` row defect** (S277) — the row describes a `#{}` CSS syntax error; the code rejects the `<style>` element. Needs a ruling.

## 📌 gaps + follow-ups filed this session
- `g-esm-build-content-hash-import-urls` — **RESOLVED U3** (the build-hash rewrite now covers in-chunk import URLs).
- Deferred (revisit near U6): the **immutable-cache-cascade** under esm content-hashing — a chunk's own hash is computed pre-import-rewrite, so a redeploy where only a DEP's hash changes rewrites an importer's specifier without changing the importer's URL. **Fresh build is self-consistent** (verified by a finder); only bites redeploy-with-caching, and esm is opt-in. In `docs/known-gaps.md` NOTE on the resolved entry.
- **U3 test follow-ups:** swap the §2 composed-MPA 98-file inline compile for a small shell+nested-page fixture (sub-second); make the §1/§2 assertions Windows-path-agnostic (the non-required `windows` check reds on `\` vs `/` — Peter's canary lane).

## 🧷 Held / retained
- **`worktree-agent-a2ed001a5de228134` @ `8fd5fd07` — RETAINED, do NOT delete.** Still the ONLY copy of Wave-1c pieces 2+3 (unblocked by U4).
- The 3 esm-unit worktrees (U1/U2/U3 agents) — cleaned at wrap step 6b (their work is landed).

## Tags
#session-278 #esm-chunks-arc #u1-u2-u3-landed #esm-now-runs #thread-board-guard #serve-r26-flake-fixed #s273-server-fetch #emitted-not-runs-s265-recurs #premise-verified-empirically #u4-next-unblocks-27
