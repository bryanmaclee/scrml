# scrml — Session 239 (IN PROGRESS)

**Date:** 2026-07-04. **Profile:** A — FULL (booted `/boot`). Booted clean off the S238 close (`handOffs/hand-off-240.md`). This stub accrues S239 state; the wrap rewrites it fully.

## 🚦 STATE @ S239 boot
- **git:** HEAD `6f8adc5c`, **origin 0/1 — 1 unpushed** (the S238 WRAP-addendum commit `6f8adc5c`: delta-log [371] + the 2 flogence Surface-2 CLI-toolchain blockers filed). Working tree clean (pre-rotation). Commit gate Config B.
- **Board (S238 close):** HIGH **0** · MED **13** · LOW **14** · Nominal **7**. Tests **26640/0/211**. Version 0.7.1.
- **⚠️ MAPS:** watermark `66a3afb1` — ~12 commits stale (S238 CSRF/typer/tool-impls NOT in maps). Full-set project-mapper OVERFLOWS; use BOUNDED per-map refresh. Candidate arc: slim primary.map (201KB/462L → ~100L thin-index).
- **Worktrees:** CLEAN (main only). No deputy (retired S219).
- **Inbox:** empty (all flogence msgs → read/).
- **Digest:** `handOffs/digest.md` is STALE (S218-era, head=9713d703) — DISTRUSTED per freshness guard; the S238 hand-off is current-truth.

## 🚀 NEXT-START (carry-forward from S238 — the flogence 100%-scrml unblock arc)
All of 0a/0b/1/2 gate the SAME road (flogence re-ports fsp-core/lanes/fleet--route once they land):
0a. **⛔ `g-tool-import-drop`** (MED) — `<program kind="tool">` emits the imported symbol but NO ES `import` → ReferenceError. Fix: emit real `import { X } from "./lib.js"` in the tool-emit path (emit-tool.ts / api.js tool-write). Blocks `fleet --route` + multi-file tools. Couples with 0b (lib must emit runnable `.js`).
0b. **⛔ `g-foreign-lang-cli-mode-detect`** (MED) — CLI has no `--mode library`; the W5a auto-detect predicate (`api.js:1214` `nodes.every(n=>n.kind!=="markup")`) disqualifies a top-level `<foreign lang>` markup node → lib falls to BROWSER mode → export null-stubbed. Fix (small/local): teach the predicate (+ `isPureModuleFile` in ast-builder.js) to treat `<foreign lang>` like `<db src>`. **Flag C (post-A+B):** cross-import async await-coloring doesn't propagate. **LESSON:** §23.6/§64 tests drove the `compileScrml` API not the CLI → API-green/CLI-broken; R26 must exercise the CLI (flogence's real path).
1. **CLEAN-PRINT primitive — RULED (a) by bryan:** a NEW `print`/`println` clean-stdout primitive (undecorated → stdout). `log()` (§20.6) stays the decorated dev-logger everywhere. Small SPEC §-addition (ground §20.6 log vs new print) + impl (emit-tool.ts inlines `_scrml_print` = clean `console.log`/`process.stdout.write`) + tests. flogence re-ports fleet + confirms after it lands.
2. **`E-ROUTE-001-on-tool` false-positive** (minor non-blocking) — route/protect analysis runs on a `kind="tool"` with no routes. Fix: skip route/protect analysis for `kind="tool"`. Rides the clean-print arc. FILE a gap.

## 🧵 Also queued (type-system.ts — serialized behind the tool arc)
3. **fail-variant-arity E-TYPE mint** (RATIFIED S238) — general enum-variant-construction arity → new `E-TYPE-0xx` (next free after 081, NOT E-ERROR-010). Unchecked on ALL paths (fail+return+let; nullary + over-supply). `g-fail-variant-payload-arity`.
4. **hostmethod-poison** (`g-typer-hostmethod-return-asis-and-anon-struct-poison`, MED, held S238) — F8 cross-fn soundness poison (full-file only). Serializes with #3.

## Owed / cross-repo
- **flogence:** owed a ping when clean-print lands → they re-port fleet + move the 18 db-bound files. Surface-2 helper-coverage tail (map/set §59, `!{}`/`fail` helpers, wire/protect NOT inlined → E-TOOL-005 fail-closed) gated on their porting.
- **`<foreign>` element registration** (Surface-2 deferred) — register in attribute-registry.js + §24.4 (defense-in-depth parity w/ `<db>`; empirically no leak).
- **emit-library type-strip** (`g-library-mode-no-typed-payload-match`, Road-B) — still open; separate from Surface 2.

## 🔭 Strategic frame (from master-list §0 + user-voice S235)
V1 = **scrml-LANGUAGE 1.0** (language split from compiler; conformance suite; compilers-as-implementations). Freeze bar RATIFIED = **high coverage first ("do it right")** — conformance pins EVERY claimed surface (~200-270 cases; at ~220). Remaining V1 = conformance coverage-GROWTH + D1/D2/D4 labeling, NOT big feature builds. The standalone-tool + flogence-unblock arc is the current adopter-driven thread within that.

## pa.md directives in force
R1–R5 · Profile A · commit PATHSPEC form (`git commit -F <msg> -- <paths>`) · background-commit to dodge Config-B post-commit-hook timeout · S236 verify-non-empty · S226 landing-concurrency · S227 dock · S219 orchestrate + default-GO · S215 adversarial · S138 R26 · S147 coherence · S88/S99/S126 path-discipline.

## Tags
#session-239 #boot #flogence-unblock-arc #clean-print-ruled-a #v1-conformance-coverage
