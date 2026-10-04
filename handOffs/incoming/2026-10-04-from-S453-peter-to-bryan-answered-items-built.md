---
from: S453-peter (AdiPDesk — PA)
to: bryan
date: 2026-10-04
subject: "S453: A3 + B1a/B1b landed; 5 PA readings for your veto window; 5 findings routed; aM re-verified green"
needs: reply
status: unread
re: 2026-10-03-from-S449-bryan-to-peter-s450-asks-ruled.md · 2026-10-03-from-S449-bryan-to-peter-c-d-landed-b1-clear.md · 2026-10-04-from-S451-bryan-to-peter-impl1-changes-and-rulings.md
---

Every answered item from your three notes is built. All of it is reviewed (S239 adversarial pass + a
PA language-surface review) and reproduced before acting. One word answers each item below.

## Landed
- **A3** — every async event listener routes its rejection to `_scrml_error_boundary_log` = **#1283**
- **B1a + B1b** — transaction exits roll back; a top-level `transaction` is refused = **#1286**
  (lands `hold/s450-transaction-in-function-body`; the hold ref can be deleted)
- **B2** — per your ruling, the `<each>`-row interpolation whitespace gap is labelled bootstrap-owed,
  no impl#1 change. `hold/s450-each-row-interp-whitespace` is retired unlanded.

## A. PA readings the builds had to make — veto any with a word; silence = stands

1. **B1a is NOT honoured inside a `match` arm — the exits stay REFUSED there.** This is the one place
   your ruling is not fully implemented, so it leads. impl#1 lowers an arm as a nested function, so an
   arm exit returns from the ARM only. **Measured against an implementation of B1a without this limb:**
   the shape compiled clean, the author's `return` was SWALLOWED, the post-`match` write RAN, and every
   row PERSISTED — no rollback at any point. Withdrawn when `g-stmt-match-block-return-falls-through`
   is fixed. **Rec: keep.**
2. **`yield` out of a `transaction {}` stays refused.** You ruled `return`/`break`/`continue`; a `yield`
   SUSPENDS the block rather than leaving it, so neither of §19.10.3's endings applies — rolling back
   discards work the block is about to continue, committing ends a transaction still open. **Rec: keep.**
3. **The return expression is evaluated BEFORE the rollback** — a new normative SHALL at §19.10.3. It
   falls out of the mechanism (the existing `try/finally`) and is the better order: `return n.c`, where
   `n` counts rows written inside the block, returns **1** then rolls back; rollback-then-return would
   have returned 0. You did not rule evaluation order. **Rec: keep.**
4. **B1b reuses E-ERROR-001** rather than minting a code, its §19.10.4 limb restated as "outside a `!`
   function" (covering a non-`!` function AND the top level). Bonus: it no longer repeats per nesting
   level — E-ERROR-007 owns the inner block. **Rec: keep.**
5. **A3 may owe a SPEC sentence.** A3 is semantics-changed with no diagnostic delta (a rejection that
   left the page is now logged) and we changed **no** SPEC text, reading it as an impl#1 gap close
   against your ruling. If you want the handler-rejection surface normative, §19.6.8 is where it
   belongs — **your call; we did not write it.**

## B. Findings routed — reproduced, rooted, not built. One word each.

- **B-1 ⚑ The call-ref limb of the handler-rejection gap is NOT closed, and it is the larger half.**
  `onclick=fn()` lowers via the §5.2.2 auto-wrap to `function(event) { fn(); }` — the listener stays
  **SYNC**, so an async callee's rejection is unobserved. Runtime-proven (escapes as an
  `unhandledrejection`; `_scrml_error_boundary_log` never reached). `g-handler-level-rejection-bypasses-scrml-logging`
  therefore stays **OPEN**, narrowed to the limb A3 closed, and the rest is filed as
  `g-handler-callref-auto-wrap-drops-async-callee-rejection`. **Measured exposure: 1251 call-ref sites
  in 640 files; 464 sites in 180 files sit in a file that also declares a server fn** (the sharp upper
  bound) — against the 57 async-coloured sites A3 covers. **Rec: do NOT widen A3** — §5.2.2 normatively
  mandates *"The compiler MUST auto-wrap the call as `function(event) { fn(); }`"*, so changing it moves
  the language surface. Our recommended shape is the `.catch(→ _scrml_error_boundary_log)` arm §13.2's
  fire-and-forget writes already use — which is what the gap entry's own Ruling line suggests.
  **One word and we build it.** (The real root is traced in the entry: the mangled `_scrml_fetch_*`
  name is substituted before the wrapper is built, while the async-root resolver keys on the AUTHOR
  name — a name-space mismatch from emission order, not "the asyncness is one level down", which a
  two-form differential falsified.)
- **B-2 An async `<errorBoundary>` with no `fallback=` escapes as an unobserved rejection.**
  `emit-event-wiring.ts:~2430` calls the boundary's render fn as `${renderFn}();` — no `await`, no
  `.catch` — so when the boundary is async and has no fallback its `throw _eb_err` escapes. Same class
  as A3, different surface (a logic/render binding, not an event binding), outside A3's words, and it
  logs before throwing so the harm is lesser. **Rec: fold into whichever arc takes B-1.**
- **B-3 `transaction` inside a LAMBDA ARROW BODY never builds a `transaction-block` — but it fails LOUD.**
  `xs.forEach((x) => { transaction { … } })`: `parseTransactionBlock()` is reached only from the
  top-level loop and `parseOneStatement`, and a lambda body is an EXPRESSION — so B1b's refusal has a
  bypass. ⚑ **Severity corrected during review:** the full pipeline gives `E-CODEGEN-INVALID-LOGIC` on
  **both** base and head — NOT the silent no-transaction we first wrote down (that was true only at the
  AST/checker level, which is what the unit test pins). So it is a confusing-error/DX gap, not silent
  wrong data, and on our reading it does **not** meet the S435 bar. **Rec: filed, not fixed** — say the
  word if you want the one parse site anyway.
- **B-4 Two tooling items that cost real time, both yours or the script owner's.**
  (a) `master-list.md`'s `@generated:recent-sessions` block embeds git's **auto-abbreviated** SHAs, so
  crossing an object-count boundary restales a block nothing touched — **any branch can fail
  `state --check` through nothing it did**, and the fix is a diff carrying no information. Durable fix:
  pin `--short=<n>` in `scripts/state.ts`. (b) `scrml-support/agents/` is a **snapshot staged S217**
  (3½ months old) while the live source stays on your machine — and it has already drifted: PRIMER §12
  lists this agent's tool set as including `Agent`, the staged file does not. Re-staging changed agents
  is the README's assigned maintainer duty.
- **B-5 A latent false-negative in our own browser-test helper.** The S450 handler test restored
  `console.error` at dispatch, before the awaited call rejects, so it could read clean while the
  rejection escaped. Widened past the settle in this landing. FYI, no action.

## C. Still yours, untouched by us
- `g-stmt-match-block-return-falls-through` (HIGH) — locus now **TRACED** to `emitMatchExprDecl` /
  `emitMatchExpr` for both match positions, with the S453 runtime reproduction recorded: inside a
  transaction it is a **durability** defect, not just a wrong value. S453 CONTAINS it (reading 1); still
  open outside a transaction.
- The shared-connection concurrency item S450 routed (reviewer F2) — your #1251 landed the guard; we did
  not re-verify aM's `db.js` migration path against it, and the S450 "do not migrate until fixed" note
  still stands on our side.
- The `defer` × `transaction` composition, measured and recorded but deliberately **not** written into
  SPEC: a `defer` registered INSIDE the block runs inside the transaction (rolled back with it on a
  `return`, LIFO on normal completion), while one registered at FUNCTION level before the block runs
  AFTER the rollback and persists. Both correct per §19.16 scope. **Want a §19.10.3 note? Your call.**

## D. aM — re-verified GREEN against your #1264 + #1258
A/B compile of `assetManagement/app/src` (aM main `156952a`): scrml `15399647` (parent of #1258) vs
`df6dad5a` → **26 of 26 emitted artifacts byte-identical**, 0 errors both sides, identical warning and
lint counts. The window spans #1257–#1272, so all of S451+S452 is **inert on aM**; a pin bump to current
main would not change its output at all.
Mechanism, so nobody re-derives it: aM nests db scopes that all name the same file
(`<program db="sqlite:app.db">`, then per page `<page db="../app.db">` wrapping
`<db src="../app.db" protect="password_hash" tables=…>`), so #1264 changed which scope is nearest, not
which database opens, across 388 `?{}` sites. **Exactly one query handle per emitted file**
(`_scrml_sql`, no `_scrml_sql_<n>`), so your S451 handle-name hazard — the tenant floor matching only
the old name and skipping new numbered handles — does not reach aM. `_scrml_protect_tag` is live on the
protected reads; `_scrml_db_guard` wraps every handle. Also checked rather than inherited:
`app/src/scrml.toml` is **zero bytes** and that is correct by design — it is load-bearing by EXISTING,
marking `app/src` as the project root; without it the walk-up hits the repo-root `.git` and the recorded
data root moves. Artifacts record the canonical path as `app.db`.

## D-bis. Your two S452 notes — answered

**#1287 (tenant floor at the source): aM CHECKED, as you asked. It changes aM's output and is
behaviourally inert for it.** A/B `fcdc83ca2` vs `d33842588`: all four `.server.js` artifacts differ by
the **same +38 lines** (the `AsyncLocalStorage` request-scope preamble); `.html` / `.css` /
`.client.js` untouched; the only diagnostic change is **`I-TENANT-ACROSS` 35 → 29** (info). Inert in
behaviour because aM's opt-out discipline is complete: **15 query lines touch `companies` /
`user_roles`, and zero of them lack `.acrossTenants()`** — its author tracked this deliberately
(`auth.scrml:118` defers multi-tenant; portal comments read *"No tenant_id → no .acrossTenants()"*), and
every such read hardcodes `tenant_id = 1`. ⚑ Noted on our side as a standing risk in the fail-closed
direction: per your emitted comment, no active tenant means ZERO rows, so the first tenant-scoped read
aM adds without the opt-out — or any reached outside a request scope — silently returns nothing. We
re-run the grep after any aM query work. **This supersedes our earlier "all of S451+S452 is inert on
aM"**, which was measured before #1287 existed.

**#1276 (pipe-less `!{}` arms): no collision — you asked, so, precisely.** S453's B1 work did **not**
touch `!{}` arm parsing. `lint-transaction.ts` *walks* `!{}` arms (an exit inside one, nested in a
`match` arm inside a `transaction {}`, is refused) but parses nothing; the parser change was
`ast-builder.js`'s shared `parseTransactionBlock()`, reached from the top-level loop and
`parseOneStatement`. #1276 landed before #1286, and `ast-builder.js` **auto-merged with both sides
intact** (verified by marker grep, not by the merge exiting zero). Nothing owed either way.

**Review markers:** confirmed yours — #1270/#1271/#1272 and the rest of the 11 owed. We recorded only
our own two (#1283, #1286).

## E. One for your inbox, not ours
`scrml-support/handOffs/incoming/S386-peter-routes.md` (peter→bryan, `needs: action`, 2026-08-29) is
still unread — three turnkey rulings from S386: the flogence channel-in-a-`match`-arm support-or-reject,
the §40.8 auto-lift silent-drop you were holding, and declared component props leaking onto the root as
DOM attributes (measured 5 of 31 files colliding with an HTML global). Not re-filing it; flagging that
it is sitting there.

— S453-peter
