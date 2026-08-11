<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S339: prior wrap  -->
<!-- handOffs/hand-off-s337-bryan.md (S337). Older: hand-off-s336.md, -->
<!-- hand-off-s335.md. Mechanical stream: handOffs/delta-log.md.     -->
<!-- ============================================================= -->

# scrml — Session 339 (Peter · Windows) — WRAP

**Date:** 2026-08-11. `/boot` Profile A. **4 arcs on `wrap/s339-peter`** (SSR fallback lint · #282
ledger hygiene · each-body fail-closed · tool import tree-shake). Consolidated from 3 feature
branches; corpus gate **884/0**. SOLO. Nothing merged to main yet — the branch is pushed and awaits
the cloud gate + merge.

## ⏭ NEXT-SESSION PICKUP (read this FIRST — the left-off handshake)

**S339-peter's four arcs are on branch `wrap/s339-peter` (pushed, NOT yet on main) — awaiting the
cloud gate + merge.** Local main is at `23ea2e5c` (= `1ad65742` + #503). Your first move: check whether
`wrap/s339-peter` merged; if merged, `git checkout main && git pull --rebase`; if not, it is still the
tip of your work. The four arcs (all gated locally):
1. `bd213002` — `I-SSR-EACH-CLIENT-RENDERED` (SSR each-fallback info-lint) + #282 ledger hygiene.
2. `ed505702` — `E-EACH-BODY-DECL-UNSUPPORTED` (each-body decl fail-closed).
3. `750e5fc2` — tool import tree-shake (`emit-tool.ts`).
   (Session-store ledger hygiene rides `9dedc807`.)

**DO NOT re-open the four routed rulings — they are bryan's, not yours** (see HELD/ROUTED). Do not
"action" them as compute.

**For fresh in-lane work: resume the verified MED-sweep.** It works — one pass (3 satellites over 6
candidates) found **2 real in-lane bugs** (both fixed this session) and correctly filtered 4 non-lane
(schema grammar-rulings, on-mount = bryan, sql-error = unbuilt feature). ~115 open MEDs remain; the
discipline that pays is **repro-on-HEAD + SPEC-check BEFORE picking** ([[scrml-med-shortlist-gaps-stale-verify-first]]).
Three picks this session were misclassified in the ledger/attribution and caught only by verifying —
so never dispatch a fix off the gap prose alone.

**bryan's chain liveness — RE-CHECK before touching any shared surface.** At S339 boot his S337→S338
three-arc chain (g-263 → converge `walkValidateResetTargets` → tare #501) was IN FLIGHT; tare `#501`
and dpa-026 `#503` were open (#503 has since merged as `23ea2e5c`). Cross-check the delta-log tail +
`gh pr list` before working any repo-wide surface ([[review-floor-is-shared-surface-collides-with-live-bryan]]).

## 🎯 WHAT LANDED (S339-peter) — 4 arcs, 2 real bug fixes + 1 lint + corrected ledger

- **SSR each-fallback lint** (`bd213002`) — `I-SSR-EACH-CLIENT-RENDERED` (Info) makes the previously
  SILENT SSR client-only fallback loud (both the subset-`SsrUnsupported` and multi-root sites), naming
  the reason. Surfacing, not widening. Pin `conformance/cases/ssr/i-ssr-each-client-rendered-subset-pos`.
- **each-body decl fail-closed** (`ed505702`) — `E-EACH-BODY-DECL-UNSUPPORTED` (Error) turns the silent
  dangling-ref miscompile (`${ let nm = @.name }` → empty list, exit-0) into a loud compile failure.
  Pin `conformance/cases/each/each-body-decl-unsupported-pos`. Resolves `g-each-body-let-alias-silently-dropped`.
- **tool import tree-shake** (`750e5fc2`) — `emit-tool.ts buildImportHeader` tree-shakes a `kind="tool"`'s
  local `.scrml` imports to body-referenced names. Resolves `g-tool-over-imports-all-lib-exports`.
  Pin `compiler/tests/integration/g-tool-over-imports-all-lib-exports.test.js`.
- **#282 ledger hygiene** (`9dedc807`) — store-split half marked resolved (fixed at #294, verified +
  pinned); the sessionExpiry twin re-filed correctly (was mis-marked "resolved by (1)").

Two new §34 rows (both census-PASS). Gaps: 3 resolved, 3 new open.

## ⛔ HELD / ROUTED — bryan's rulings, do NOT take as compute

1. **SSR-each WIDENING** (`g-ssr-each-row-template-subset-blocks-all-prerender` items 1–2 +
   `g-ssr-each-multi-root-client-only-fallback`) — `newly-accepting` (SSR would evaluate author
   expressions server-side; hydration-mismatch surface). Accept/decline is bryan's. My lint is the
   in-lane interim.
2. **`g-program-sessionexpiry-inert-on-separate-login-unit`** (MED, from #282-B) — LIVE + reproduced,
   but **§20.5 line 15580 SANCTIONS** the login-unit 1h default. Disposition fork (i) rule that program
   `sessionExpiry` governs the login cookie [behaviour change] · (ii) info-lint the inertness · (iii)
   WAI-close. bryan's call.
3. **`g-value-const-misclassified-as-user-component`** (MED) — the REAL root under the tool over-import:
   an uppercase value-const (`R2_THRESHOLD`) is classified `category:"user-component"`. Wide blast
   (component inlining · client-binding elision · within-node parity gate); borders language-surface.
   Cross-ref [[g-static-component-import-dead-destructure]]'s latent-coupling note. Needs a scoped,
   parity-safe ruling.
4. **each-body alias SUPPORT half** — supporting author locals in an `<each>` body (replay the binding
   into the per-item factory, like the for-lift path) is a §17.7.3 language-surface ruling. My fix
   rejects loudly until then; it does not forbid the feature.

## 🔑 METHOD NOTES THAT OUTLAST (S339)

- **Verify-the-class + source-is-normative caught THREE misclassifications this session** before they
  became wrong fixes: the SSR gap's "counts±" prose (widening was newly-accepting, not the inert-widen
  the shortlist implied); #282's false "resolved by (1)" (the twin threads a different path + is
  §20.5-sanctioned); the tool-import attribution (satellite AND gap both blamed the wrong layer — real
  root was a classifier false-positive). The pattern: **never dispatch off gap prose or a satellite's
  attribution — reproduce + read the normative SPEC/gate first.**
- **The in-lane vs bryan-lane tell held all session:** an adopter-facing SILENT-WRONG behaviour where
  the SPEC does NOT sanction the current output → in-lane fix (fail-closed error or surfacing lint). A
  behaviour the SPEC sanctions, or a `newly-accepting` grammar/acceptance change → bryan's ruling. Two
  fixes + one lint were in-lane; four rulings routed.
- **Multi-arc branch mechanics:** kept the delta-log OFF feature branches to avoid the sequence-ID
  collision, wrote it once on the continuity/SSR branch, consolidated at wrap. FACTS/gap-count merge
  conflicts are `@generated` — resolve by regen, never hand-pick.

## 🧷 STATE / DEFERRED

- **Push:** `wrap/s339-peter` pushed to origin (step 7). PR/merge is cloud-gate-serialized. If you want
  the 4 arcs as SEPARATE PRs instead of one wrap PR, the feature branches (`feat/ssr-each-client-rendered-lint`,
  `fix/each-body-decl-fail-closed`, `fix/tool-import-treeshake`) still exist locally with the individual
  commits.
- **Worktrees (6b):** left intact — `onmount-c` (bryan's live arc), two `agent-*` worktrees, and
  `scrml-pinned` are NOT this session's work; none removed.
- **Windows-local baseline:** the W5b tool runtime subtests (`tool-library-in-process-db-w5b.test.js`)
  flake nondeterministically (sqlite-I/O + async timing; different subtest each run, sometimes 0 fail) —
  proven neutral to the tool tree-shake (its tool uses all 4 imports → all kept). Cloud gate is authority.
  Also standing: `spec-index --check` reds locally (pre-existing, CRLF/totals; the gated section-total is
  unaffected by row-adds) ([[scrml-regen-scripts-crlf-broken-on-windows]]).
- **Mechanical state** (board counts · maps watermark · CI) — see the digest / `handOffs/delta-log.md`
  [1343]–[1349]. No deputy ran this session.
