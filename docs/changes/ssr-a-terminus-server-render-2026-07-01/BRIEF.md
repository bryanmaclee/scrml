# BRIEF — SSR A-terminus, Dispatch 1: server-side markup renderer (S234, 2026-07-01)

The last V1-REQUIRED feature. Build the **SERVER-SIDE MARKUP RENDERER** — the genuinely-new capability
that renders server-authority rows INTO the first-paint HTML (today per-row render is client-only).
This is **Dispatch 1 of the A-terminus** (SSR dive §4.3 "Dispatch 2..N"). DOM-adoption hydration +
W-AUTH-002 retirement are SUBSEQUENT dispatches — NOT this one.

## READ FIRST (design authority — Rule 4)
- `scrml-support/docs/deep-dives/ssr-prerender-step0-rulings-2026-06-30.md` — **§2.2** (Option A = DOM
  pre-render + client adoption — the A-terminus definition + why B alone ≠ SSR), **§4.2** (auth/protect:
  REUSE the built §14.8.9 floor), **§4.3** (the dispatch decomposition — your scope is the "Dispatch
  2..N" first piece: `emit-html.ts` + `emit-each.ts` server-side render).
- **The B-substrate is LANDED** (commit `e72f058a`, S233): the inline `window.__scrml_ssr_state` seed
  + the conditional fetch + the query/redact sink in `emit-server.ts` (`generateServerJs`, near the
  `/__serverLoad` emission ~2836-2922). Your server-render REUSES that query + §14.8.9 redact sink —
  feed the SAME redacted rows into the markup. Study it first (`git show e72f058a --stat` + the files).
- SPEC **§52.8** (`SPEC.md:30225`): "Server-authoritative variables SHALL be populated on the server
  during SSR and included in the initial HTML … no loading placeholder is shown on first paint." +
  **§14.8.9** (the protect-floor you MUST reuse — `emit-server.ts:2857-2864` redacts by (table,column)).

## SCOPE — Dispatch 1 (server-side markup render ONLY)
- **`emit-html.ts`** (`generateHtml`) + **`emit-each.ts`** (the empty `data-scrml-each-mount`
  placeholder ~347-361): build a server-side markup renderer that runs the per-row render logic AT
  REQUEST TIME and fills the each-mount divs with the (redacted) server-authority rows. The per-row
  render logic currently lives ONLY in the client runtime — you are lifting it to run server-side at
  HTML-composition time.
- **Egress:** feed on the §14.8.9-redacted rows — REUSE the B-substrate's query + `_scrml_protect_tag`
  / `_scrml_protect_redact` sink (`emit-server.ts`, the `/__serverLoad` path). Do NOT invent
  confidentiality; the floor is built + §14.8.9 mandates reuse.
- The server-rendered rows MUST be keyed by the SAME `keyFn` the client's `_scrml_reconcile_list`
  (`runtime-template.js:1541`) uses — emit the key markers the NEXT dispatch's DOM-adoption will match.

## DO NOT (this dispatch)
- Do NOT build the DOM-adoption hydration (`runtime-template.js` `_scrml_reconcile_list`) — NEXT
  dispatch. This dispatch's client still rebuilds the mount (a transient double-render is ACCEPTABLE
  here; the HTML *containing the rows* is the deliverable).
- Do NOT retire/narrow **W-AUTH-002** (`type-system.ts:8322-8343`) — that's the FINAL A-terminus
  dispatch, after DOM-adoption. W-AUTH-002 STAYS firing.
- Do NOT build per-role subtree gating (GITI-027B Option D — deferred; cite, don't build). `<auth
  role>` subtrees ship verbatim (`W-AUTH-CONTENT-NOT-GATED` continues).
- Do NOT add per-user query scope (out of scope — the same unscoped `SELECT *` the client-fetch uses).

## VERIFICATION (R26 — the acceptance test, MANDATORY)
Compile a real app with an `<each>` over a server-authority cell (find one in `examples/` — the
trucking board (`examples/23-trucking-dispatch/`) renders `<each>` over server rows; if none fits,
construct a minimal `<program>` with a Tier-1 server cell + `<each>`). Then: **the composed first-paint
HTML (server-rendered, BEFORE any client JS runs) MUST CONTAIN the rendered rows** in the each-mount
divs (view-source shows the data, NOT an empty `data-scrml-each-mount`). Confirm the rows are
**§14.8.9-REDACTED** (a protected column is absent from the HTML). Add integration tests: server-render
fills the mount · redaction applied · keyFn markers present. Report the before/after first-paint HTML.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save WORKTREE_ROOT. Base may be behind main —
   `git -C "$WORKTREE_ROOT" merge --ff-only main` to pull to e5d6a5ff (S112).
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; clean; `bun install`; `bun run pretest`.
Edits via **Bash** on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NEVER Edit/Write,
NEVER main-rooted paths, NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd`). First commit
message includes verbatim `pwd` (S99).

# MAPS — `.claude/maps/primary.map.md` first (Task-Shape: new feature / compiler-source). ~5 commits
stale — verify vs live source. Report load-bearing or not.

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`). Full `bun run test` GREEN before DONE (new tests +
zero regressions; the ~26k suite may exceed 5min under load but still land, S164 — verify HEAD/tree
post-hoc); never `--no-verify`. Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the R26 result
(first-paint HTML before/after — rows present + redacted) · what's DEFERRED to the DOM-adoption +
W-AUTH-002 dispatches · any new dogfood/compiler findings.
