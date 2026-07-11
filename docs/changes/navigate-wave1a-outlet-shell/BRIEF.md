Build **Wave-1a of the scrml Client Router (#27): the `<outlet>` + `<program>`-shell STRUCTURAL foundation.** This is the recognition + emit + diagnostics half. Do NOT build the runtime soft-nav pipeline, navigate() lowering, link-boost, or keep-alive — those are later waves. Work in your isolated worktree, commit incrementally, NEVER touch main.

STEP 0: write your brief verbatim to `docs/changes/navigate-wave1a-outlet-shell/BRIEF.md` in your worktree (archival discipline).

## Design authority (READ FIRST)
- `compiler/SPEC.md` §20.8 (just landed, Nominal) — esp. §20.8.1 (shell + `<outlet>`) and §20.8.6/20.8.7 (normative statements + codes).
- `../scrml-support/docs/deep-dives/navigate-soft-nav-client-router-2026-07-11.md` (the ruled design; Axis-2 = `<program>`-as-shell + one flat `<outlet>`).

## Scope — build ONLY this (Wave-1a)
1. **Recognize `<outlet>`** as a structural element:
   - `compiler/src/block-splitter.js:182` — add `"outlet"` to `COMPOUND_LIFT_EXEMPT_TAGS` (the §4.15 reserved-structural set). Check body-mode detection near `:3263` (`isProgramBody`/`isPageBody`) — `<outlet>` is a void/empty slot (NOT raw-body; it does not go in `STRUCTURAL_RAW_BODY_ELEMENTS`).
   - `compiler/src/attribute-registry.js` — add a `set("outlet", …)` entry (see the `set("page", …)` at `:184-201` for the shape; `<outlet>` takes only `class`/`id`-class generic attrs for now, no feature attrs).
2. **`<program>` as the persistent shell + emit the `<outlet>` swap anchor:** emit the `<outlet>` as a stable DOM region marker (a swap anchor with a known id/data-attr — mirror how each-mounts get anchor markers in the emit-html render path). `<program>` already exists as the app container; the shell semantics (boots once) are runtime (Wave-1b) — for 1a just ensure `<outlet>` emits a clean, addressable region element into the document body. Locate the emit via `compiler/src/codegen/emit-html.ts` + `emit-client.ts`.
3. **Diagnostics (+ §34 catalog rows, land-with-impl per Rule 4):**
   - **E-OUTLET-DUPLICATE** — more than one `<outlet>` in a shell (V1 = one flat outlet).
   - **E-OUTLET-OUTSIDE-SHELL** — `<outlet>` not inside a `<program>` shell.
   - **W-OUTLET-ABSENT-SOFT-NAV-DISABLED** — a multi-page project (`pages/` present) whose shell declares no `<outlet>` (Info; soft-nav will fall back to hard). Only fire this if you can cheaply detect the multi-page + no-outlet condition; if it needs Wave-1b routing context, STUB it (name the code in §34, defer the fire-site to 1b) and say so.
   - Add the §34 rows in `compiler/SPEC.md` §34 catalog.

## Gates (MANDATORY)
- The full existing suite stays green: `bun test compiler/tests/{unit,integration,conformance}` (0 fail). If you touch render/codegen and want to check browser, recompile fixtures FIRST: `bun run compiler/src/cli.js compile samples/compilation-tests/` (stale dist fakes failures — a known trap).
- **Author conformance cases** (`conformance/cases/…`, DATA-not-TS — study a sibling case for the shape): `<outlet>` recognized + emits its region marker · E-OUTLET-DUPLICATE fires on two outlets · E-OUTLET-OUTSIDE-SHELL fires on a top-level/non-shell `<outlet>` · must-NOT-fire negatives (one outlet in a `<program>` = clean). Run `bun conformance/run.ts` and confirm your new cases pass + the oracle count only goes UP.
- R26: compile a tiny real `.scrml` with `<program><nav>…</nav><outlet/></program>` on your post-change build and confirm the emitted HTML has the addressable outlet region.

## Rules
- V5-strict decl forms; `not` (never null/undefined). Match surrounding code style.
- Commit incrementally on your worktree branch (code+test together per logical unit). Do NOT `--no-verify`.
- If a design question arises (e.g., the exact outlet marker shape, or whether `<program>`-shell needs a new attribute), STUB conservatively + SURFACE it in your report — do not guess a language-facing decision.

## Report back (your final message = the return value; make it self-contained)
- Your branch name + the commit SHA(s) landed on it.
- Exactly what you built (files + the diagnostic codes wired) and what you STUBBED/deferred to Wave-1b (esp. W-OUTLET-ABSENT if it needed routing context).
- Test results: unit/integration/conformance pass counts + your new conformance cases + the oracle delta.
- Any design question you hit + how you stubbed it.
- The R26 emitted-HTML snippet showing the `<outlet>` region.
