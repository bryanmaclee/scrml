# BRIEF — CSS Wave-1 finish: the emission half (§65) — theme + reset + :where()-flat

**Change-id:** `css-wave1-emission-2026-07-16` · **Dispatched:** S259 (bryan) · **Model:** opus
**Branch (pre-made manual worktree):** `feat/css-wave1-emission` @ base `origin/main` `9c27ce9a`
**Worktree:** `/home/bryan-maclee/scrmlMaster/scrml-css-wave1` (ALREADY CREATED — do NOT create your own)

## MAPS — REQUIRED FIRST READ
Read `/home/bryan-maclee/scrmlMaster/scrml-css-wave1/.claude/maps/primary.map.md` first (stamp `f079d0a9`). Codegen/CSS routing. Anchors verified against `9c27ce9a` directly. Report the load-bearing finding.

## F4 — STARTUP + PATH DISCIPLINE (incident-count: 0) — MANUAL worktree (auto-isolation broken S258)
1. `cd /home/bryan-maclee/scrmlMaster/scrml-css-wave1 && pwd` — confirm EXACTLY that path.
2. `git -C /home/bryan-maclee/scrmlMaster/scrml-css-wave1 branch --show-current` = `feat/css-wave1-emission`; status clean. Else STOP.
3. `bun install` + `bun run pretest` in the worktree. Baselines via `bun --cwd <worktree> run test`.
4. ALL writes to absolute paths UNDER the worktree. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C`/`bun --cwd`.
5. **A PARALLEL dispatch (Phase-1 colorless-async) is editing `compiler/src/codegen/{emit-library-shared,scheduling,emit-functions,index,collect}.ts` + `module-resolver.js`.** To avoid a landing collision: keep your changes in **`emit-css.ts` + a new theme/reset emitter module**; **AVOID `codegen/index.ts` if at all possible** (Phase 1 edits its async-seed region ~L494). If you MUST touch index.ts, touch only the CSS-assembly region + report it loudly so the PA 3-way-merges at land.
6. Commit incrementally + append-only `progress.md`.

## THE TASK — finish CSS Wave-1 EMISSION (§65). The CHECKER IS DONE — do NOT rebuild it.

**Authority:** SPEC §65 (`compiler/SPEC.md` L35200-35618) + DD `../scrml-support/docs/deep-dives/css-scrml-fication-2026-07-07.md`. Wave-1 scope = §65.15.

**ALREADY BUILT (verify-only, do NOT touch the checker logic):** `css-conflict-check.ts` (837L, the shipping §65.2.4 flat-specificity conflict-checker with R1-R3 carve-outs) is wired in `api.js` + conformance-tested (`conformance/cases/style/*`, `conf-STYLE-CONFLICT.test.js`). `E-STYLE-CONFLICT` / `W-STYLE-CONFLICT-POSSIBLE` / `E-THEME-TOKEN-UNKNOWN` fire. `<theme>`/`<defaults>` are RECOGNIZED (block-splitter.js ~155/244, attribute-registry.js ~492/500).

**THE CONFIRMED GAPS (empirically probed on `9c27ce9a` — a themed app compiles but emits BROKEN CSS):**
Probe: a `<program>` with `<theme for=@mode> ink = #0f172a; bg = #ffffff; .Dark { ink = #f8fafc; bg = #0f172a } </theme>` + `<mode> = .Light` + a component `#{ .card { color: ink; background: bg; } }` currently emits:
```
@scope ([data-scrml="Card"]) to ([data-scrml]) { .card { padding: 16px; color: ink; background: bg; } }
```
— `color: ink` is LITERAL INVALID CSS (tokens never lowered), NO `:root`, NO reset, NO `:where()`. Close these:

1. **`<theme>` token emission (§65.3.2 + §65.6) — the biggest gap.**
   - Lower theme tokens `name = value` → a `:root { --name: value }` block.
   - A token reference inside a `#{}`/style (`color: ink`) → `color: var(--ink)` (mirrors the §25 CSS-variable lowering already in `emit-css.ts` — `value = var(--${exprPropName})` at ~L83/149/248; extend it to theme tokens). An unresolved token → `E-THEME-TOKEN-UNKNOWN` (already wired — verify it fires).
   - **Reactive theming §65.6:** `<theme for=@mode>` variant blocks (`.Dark { ink = ... }`) → a named-variant reactive selector that re-points the `:root` tokens on `@mode` change with ONE `:root` write, zero re-render (per §65.6 — read §65.6 L35422-35457 for the exact selector shape; the variant set is OWNED by `<theme>`, the `@mode` cell's variant type flows from `for=@mode` per §14.10, like an engine `for=`).
2. **Built-in reset layer (§65.3.4):** emit the fixed modern reset in a bottom `@layer reset` — `box-sizing:border-box` on `*,::before,::after`; margin-0 on the flow set (body, headings, p, lists, figure, blockquote, hr, fieldset); `img,picture,video,canvas,svg { display:block; max-width:100% }`; form controls inherit font; sane body (line-height, min-height:100vh). **Opt-out: `<program reset="none">`** drops the whole layer. It's the ONE sanctioned universal global block. Read §65.3.4 (L35337) for the exact frozen list.
3. **`:where()`-flat emission (§65.2.5):** wrap component-scope selector rules so their specificity is 0 (the flat-specificity guarantee the checker ASSUMES holds at runtime). Reuse the §26.6 `prose` `:where()` mechanism. Read §65.2.5 (L35285). (The current `@scope (...)` donut bounds MATCHING but not specificity — §65.2.5 is what makes co-location resolution sound at runtime.)
4. **`--explain-style` DX (§65.2.6):** OPTIONAL — only if trivial; it's a CLI DX complement ("not a code"), NOT freeze-blocking. Defer if non-trivial.

**§34 codes:** any code you newly fire lands its §34 catalog row WITH the impl (Rule 4). The three Wave-1 codes are already wired; if theme/reset emission newly fires one, ensure the §34 row exists.

## VERIFICATION — do NOT mark DONE without ALL
1. **R26 empirical:** re-compile the themed-app probe (`bun --cwd <worktree> compiler/bin/scrml.js compile <probe> --output-dir <tmp>`). PASS = emitted CSS shows (a) `:root { --ink: #0f172a; --bg: #ffffff }` + a `.Dark`-variant reactive selector, (b) `color: var(--ink)` NOT `color: ink`, (c) an `@layer reset` block with box-sizing, (d) `:where()`-wrapped scope rules. Put the probe under `<worktree>/docs/changes/css-wave1-emission-2026-07-16/repros/`.
2. **Full suite green:** `bun --cwd <worktree> run test` — 0 failures. CSS emission is broad-surface — watch for existing `#{}`/`@scope` sample regressions (byte-diff the emitted CSS of a NON-theme component — it should be unchanged except the `:where()` wrap + reset layer).
3. **Conformance green + EXTEND:** `bun --cwd <worktree> conformance/run.ts` — 642 baseline. ADD conformance cases for the new emission (theme token→:root lowering, reset layer present/opt-out, `:where()`-flat) under `conformance/cases/style/` or `conformance/cases/theme/` (pos + neg per new behavior).

## OUT OF SCOPE (Waves 2-3, v1.next — do NOT build)
style-as-value (`const x = #{}`, `style=<value>`, `style=[a,b]`, `style:name=`), the `<defaults>` body/emission, Tailwind `@layer` integration (§65.8), the `!important` interop escape (§65.7), `@keyframes` namespacing (§65.12 OQ-5). And the conflict-checker itself (done).

## CRASH-RECOVERY
Commit per gap closed; update progress.md. Report: final SHA, files-touched (FLAG any index.ts touch), before/after emitted CSS for the probe, §34 codes added, full-suite + conformance deltas. Do NOT open a PR/merge — PA lands via file-delta + review.

<!-- thread-board: run `bun scripts/threads.ts` — DONE-PROBE asserts this arc's completion against landed artifacts -->
DONE-PROBE: git grep -q 'emitThemeSwitchReflection' -- compiler/src/codegen/emit-client.ts
