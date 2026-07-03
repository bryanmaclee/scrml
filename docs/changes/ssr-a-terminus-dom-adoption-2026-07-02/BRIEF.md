# BRIEF — SSR A-terminus Dispatch 2 — DOM-adoption hydration (S235, 2026-07-02)

change-id: `ssr-a-terminus-dom-adoption-2026-07-02`. Base: main HEAD `2fb2bf1f` (D1 server-side markup render landed at its parent `d05cf40c`).

## MISSION
D1 (server-side markup render) landed: the first-paint HTML now contains the server-authority `<each>` rows, each keyed with a `data-scrml-key` attribute on the row's root element, inside the `<div data-scrml-each-mount="each_N">` slot. **But the client still WIPES that server DOM and rebuilds from scratch on its first reconcile — the client-rebuild double-render.** Your job: teach the client runtime to ADOPT the server-rendered rows (match by `data-scrml-key`) and upgrade them IN PLACE, so the server rows are never emptied out — killing the double-render while keeping the rows fully interactive.

This is Dispatch 2 of the multi-dispatch A-terminus arc. Design authority: `../scrml-support/docs/deep-dives/ssr-prerender-step0-rulings-2026-06-30.md` §4.3 (Dispatch 2..N: "teach `_scrml_reconcile_list` DOM-ADOPTION — adopt the server-rendered rows keyed by the same keyFn instead of rebuilding into an empty mount"). B-substrate (S233 `e72f058a`) already seeds `window.__scrml_ssr_state` before mount, so the client cell holds the same rows — a freshly-built client row is visually identical to the server row.

## THE TWO FACTS THAT DEFINE THE SEAM (verify against live source before coding)
1. **Server rows carry the key as an HTML ATTRIBUTE, not a JS property.** `emit-ssr-render.ts` (`nodeToParts`, isRoot branch) emits ` data-scrml-key="<esc(String(keyExpr))>"` on each row's ROOT element. The key is STRINGIFIED (`_scrml_esc_attr(String(...))`). The mirror of the client keyFn (`resolveKeyReadExpr`): explicit `key=__index__`→index · `key=expr`→field-read · `of=`→index · default `in=`→`item.id ?? index`.
2. **The client keys by a JS PROPERTY + wires behavior in `createFn`.** `runtime-template.js` `_scrml_reconcile_list` (~L1541) builds its `oldNodes` map from `child._scrml_key` (a JS property set ONLY by createFn-created nodes, L1637/1698). Per-item EVENT LISTENERS (`elVar.addEventListener`, emit-each.ts ~L1299) and per-item REACTIVE EFFECTS (`_scrml_effect`/`_scrml_effect_static` via `_scrml_resolve_item`, emit-each.ts ~L1696) are attached INSIDE createFn. So server rows have the CONTENT but NO `_scrml_key` property, NO event listeners, NO reactive effects. On the first reconcile today: `oldNodes.size === 0` → the "bulk create from empty" fast-path calls `container.replaceChildren()` (WIPES the server DOM) then createFn+append (the visible double-render).

## THE MECHANISM — adopt-in-place-upgrade (a `runtime-template.js`-ONLY change; createFn UNCHANGED)
Do NOT rewrite the emit-each per-item factory. Keep createFn as-is; change only `_scrml_reconcile_list`. Four precise pieces:

1. **Adoption pass (top of `_scrml_reconcile_list`, first reconcile only).** Before the `oldNodes` build, scan `container` element children: for any child that has NO `_scrml_key` property AND HAS a `data-scrml-key` attribute (`child.nodeType === 1 && child._scrml_key === undefined && child.getAttribute?.("data-scrml-key") != null`), set `child._scrml_key = child.getAttribute("data-scrml-key")` and flag `child._scrml_ssr_adopt = true`. Now these server nodes enter `oldNodes` on this pass.

2. **Key-type normalization (CORRECTNESS-CRITICAL).** The server attribute key is a STRING (`"42"`); the client `keyFn` may return a NUMBER (`42`) or other type. A raw `oldNodes.get(newKeys[i])` would MISS (`42 !== "42"`). Resolve this cleanly — the simplest sound approach: when matching NEW items against ADOPTED server nodes, compare via `String(key)`. Pick ONE coherent scheme (e.g. adopted nodes are keyed by the string form and new-item lookups against adopted nodes coerce with `String(...)`; OR coerce both sides to string for the first hydrating pass only). Whatever you choose, it must NOT change the key semantics for the steady-state (non-hydration) reconcile path — post-hydration passes use client `_scrml_key` values unchanged. Document the scheme in a comment.

3. **Upgrade adopted nodes in place (NO empty-wipe).** When the keyed diff finds `oldNodes.get(key)` returns a node with `_scrml_ssr_adopt === true`: build a fresh interactive node via `createFn(newItems[i], i)`, set its `_scrml_key`, `container.replaceChild(fresh, serverNode)` (1:1, in place — the mount is NEVER emptied), clear the adopt flag, and treat `fresh` as the node for the rest of the placement logic. A new item with NO matching server node → createFn + insert (normal). A server node whose key is gone → remove (normal). The `oldNodes.size === 0` bulk-from-empty fast-path must NOT fire when server nodes were adopted (they're in oldNodes now).

4. **Skip the B2 same-order no-op bail when any adopted node is present on this pass.** The B2 fast-path (L1649, "same keys same order → return") would leave the dead un-upgraded server nodes in place. Guard it: if this pass adopted any server node, do NOT take the B2 bail (fall through to the diff so every adopted node gets its in-place upgrade). Post-hydration passes hit B2 normally.

**Net effect:** server rows stay visible (never emptied), each is upgraded in place to a fully-interactive client node (identical content, so no visible flash), and every subsequent reconcile is the normal client path.

**Depth-of-survey authorization (pa.md):** the above is the intended mechanism + the exact fire-sites, but SURVEY the live `_scrml_reconcile_list` + `_scrml_resolve_item` + the emit-each createFn first — if the survey reveals a cleaner faithful path (a hook that already exists, a different marker, a simpler place to adopt), take it and say so in your report. Correct the mechanism to what the code actually needs; don't force a wrong-shape fix.

## R26 ACCEPTANCE (MANDATORY — happy-dom client hydration, not just emit-string)
Reuse the D1 fixture in `compiler/tests/integration/ssr-a-terminus.test.js` (the `< Account authority="server" table="users">` Tier-1 type + `<ul><each in=@accounts key=@.id><li : @.name></each></ul>` app — extend it with a `<li onclick=...>`-style interactive row for the behavior assertion). Compile it to BOTH server JS + client JS. In a happy-dom DOM:
1. Run the server compose handler → get the first-paint HTML. Assert (D1, should already pass) the `data-scrml-each-mount` div CONTAINS `<li data-scrml-key="...">` rows.
2. Inject that HTML into the DOM. Seed `window.__scrml_ssr_state` (as B-substrate does). Capture the server row nodes' object identities / a marker.
3. Run the client module-init (the emitted client.js) in that DOM. **Assert the adoption:** the mount is NEVER emptied (the server rows are upgraded in place, NOT wiped-then-rebuilt) — e.g. assert no transient empty mount, and that row count stays == N throughout. Assert the rows are now INTERACTIVE (an event handler fires; a per-item reactive update reflects). Assert `data-scrml-key` still present + correct.
4. Redaction intact: a protected column is still ABSENT from the rows (D1's §14.8.9 floor — no regression).
Report the before/after: server first-paint HTML + the post-hydration DOM state + the interactivity proof.

## ADVERSARIAL GATE (S215 — this is a runtime change with real blast radius; MANDATORY before DONE)
Construct + verify these edge shapes (not just the happy path), and run `/code-review` (high) on your diff OR a finder pass:
- **Non-SSR each (the common case) is byte-behavior-IDENTICAL.** A normal client-only `<each>` (no server nodes → `oldNodes.size === 0` on first render) MUST render exactly as before. This is the #1 regression risk — prove it.
- **Post-hydration reconciles work:** add a row, remove a row, reorder rows, in-place field mutation (the B2 path) all work AFTER the initial adoption.
- **Key-type mismatch:** numeric `key=@.id` (server `"42"` vs client `42`) matches correctly — no orphaned server node, no duplicate.
- **Partial / fallback each:** an each that D1 could NOT server-render (fell back to empty mount) → no `data-scrml-key` nodes → adoption pass finds nothing → normal client render (no crash).
- **Nested each / `<empty>` fallback / zero-rows** unaffected.
Run the FULL `bun run test` (NOT just the pre-commit subset — the browser tier + happy-dom reconcile tests live only in the full suite).

## DO NOT (subsequent A-terminus dispatches — leave these alone)
- **NO retiring/narrowing W-AUTH-002** (`type-system.ts:~8354-8367`) — that is the FINAL A-terminus dispatch (D3), only after adoption is proven end-to-end.
- **NO zero-recreation "pure" hydration** (reuse the server DOM node WITHOUT calling createFn, attaching listeners/effects onto the existing element). That is a PERF follow-on; adopt-in-place (createFn + replaceChild) is this dispatch. Do not thread a hydrate-mode through emit-each's factory.
- **NO per-role subtree gating** (GITI-027B Option D). **NO widening the SSR render subset** (emit-ssr-render.ts stays as-is). **NO per-user query scope.**

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Your worktree is under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` via Bash — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90 wrong-repo routing). Save as WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT. `git -C "$WORKTREE_ROOT" merge --ff-only main` to base on `2fb2bf1f` (S112 — your worktree may be stale). `git -C "$WORKTREE_ROOT" status --short` clean.
3. `bun install` (worktrees don't inherit node_modules — hook fails with "cannot find package 'acorn'" otherwise). `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests; gitignored, empty in fresh worktrees).
Apply ALL edits via **Bash** (`perl`/`python3`/heredoc) on worktree-absolute paths that INCLUDE the `.claude/worktrees/agent-<id>/` segment — NEVER the Edit/Write tools, NEVER main-rooted paths, NEVER `cd` into main (use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`). Echo the target path before each write; re-verify with `git -C "$WORKTREE_ROOT" diff`/grep after. Your FIRST commit message includes the verbatim `pwd` output (S99). If ANY startup check fails, STOP and report.

# MAPS — read `.claude/maps/primary.map.md` first (this is a compiler-source runtime change). Watermark `commit: 04e7a1bb` (2026-06-30) — ~behind current HEAD; treat map content as a STARTING HYPOTHESIS, verify vs live `runtime-template.js` / `emit-each.ts` / `emit-ssr-render.ts`. In your report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted, not load-bearing."

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT" commit`, `timeout: 600000` on the foreground commit — the ~26k-suite hook exceeds 5min under load, S164/S214). Full `bun run test` GREEN before DONE (no `--no-verify`). Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the adoption mechanism as built (+ any survey-driven deviation from this brief) · the R26 result (server HTML before + post-hydration DOM after + interactivity proof + redaction intact) · the adversarial-gate results (non-SSR byte-identical proof + edge shapes) · what's DEFERRED to the W-AUTH-002 (D3) + zero-recreation-hydration dispatches · any new dogfood findings.
