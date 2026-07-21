# scrml — Session 274 (bryan) — WRAP

**Date:** 2026-07-20. A freeze-campaign **drain** session: landed the stranded SSR tier-1 leak, reconciled 5 forgotten-half freeze-spec threads, migrated the E-SQL-004 corpus samples, and confirmed ss75 done. **The freeze *spec* campaign is complete.** Solo (no live sibling; concurrent sPA/peter activity on ss75 reconciled).

## ⚠️ READ FIRST — state as of close
- **scrml main = `58c8161d`** (#122 esql4 on #121 freeze-spec on #120 SSR-leak). CI `gate` **GREEN** at HEAD. Conformance **745/745**. Coherence 0/0 both repos.
- **Thread-board: 16/17 done, 1 open** (`bun scripts/threads.ts --open`). The one open — `e-markup-002-native-emit` — is a **parked native-parity deferral, NOT active work**: its SPEC half landed (#121, §4.4.1 claim corrected); its native-code migration (`native-parser/tag-frame.js` E-MARKUP-002→E-CTX-001) waits until impl#2/native goes on-gate. Do not re-investigate as "forgotten."
- **🔴 HAZARD — stale land branch:** `origin/land/ss75-conformance-data` (`e0d8435c`) is branched from a **pre-S274 base** — it diffs as 396 files / 26696 deletions vs main and **would revert #120/#121/#122 + delete processed inbox files if merged**. Its ss75 cases already reached main via other paths (superseded). **DELETE IT** (`git push origin --delete land/ss75-conformance-data`) — left for bryan's explicit go (didn't push-delete an origin branch on ambiguous authz). The `spa/ss75` branch (`423b2c44`, the list-close docs) is on current base + harmless.

## 🎬 WHAT LANDED (3 PRs)
1. **⭐ #120 (`f2332c09`) — SSR auth-scoped prerender-leak CLOSED** (tier-1 cross-user data leak, stranded 17 sessions). Re-implemented the S256 held fix on current main (faithful byte-for-byte source port, re-anchored where the tenant floor had drifted emit-server.ts 929L). SPEC §52.15.5 auto-make-safe: auth-scoped non-row-scoped server cells (Tier-1 SELECT * · unscoped Pattern-C · gated callable) **auto-omitted from the anon SSR seed**, hydrate client-side behind their per-cell gated `/__serverLoad` (401 anon); public/row-scoped siblings not over-omitted; per-cell `/__mountHydrate` gate. NEW `sql-lex.ts` (shared LIVE-vs-INERT `${}` classifier — collect.ts + rewrite.ts can't diverge). Retired `W-SSR-PRERENDER-UNSCOPED` → Info `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED`. Composes with §14.8.9 protect + §14.8.10 tenant at the same sink. **PA-verified independently**: R26 anon-compose (Alice/Bob + `accounts` key ABSENT, PublicWidget served), commit-gate 20996/0, S239 adversarial (3 non-blocking findings — see below).
2. **#121 (`4fb83531`) — freeze-spec reconcile, 5 forgotten-half threads** (all SPEC-text, dispatched to a general-purpose iso:worktree agent, PA-reviewed): E-ATTR-012 retired (S249-drop) · E-ERROR-010 catalogued + §19.5.3/.4 repointed (S249) · E-FN-009 marked Nominal-deferred (S31-retained, impl defers) · §4.4.1 native-parity claim corrected (Fork-A ruled) · E-MW-002/005/006 §34 cites corrected to a drift-proof `ast-builder.js §40-block` anchor (**Fork-B — my "wire" lean was WRONG: verify-before-dispatch showed the checks are already wired+live at ast-builder.js:18190/18231; the S263 "zero fire sites" was a stale-cite mis-diagnosis** → cite-fix not codegen).
3. **#122 (`58c8161d`) — esql4 corpus samples migrated** (ruled S264 opt-B / **S274 opt-a**). The 4 clean-before samples wrapped in `<program db=>` + `<schema>` (compile clean, E-SQL-004 gone). **Native-parity tradeoff bryan ruled (a):** the `<program>` wrapper hits a pre-existing native divergence (proven wrapper-not-schema), so 4 `parser-conformance-within-node-allowlist.json` entries grew — a known native gap newly-exercised, not a fresh regression; grows against the shrink-only default by explicit ruling. Non-required baseline (already 17-fail). 5 already-erroring samples stay tracked.

## ✅ ss75 — CONFIRMED done (concurrent sPA/peter work, reconciled)
Conformance 745/745; `E-LIN-001/002/003/006` present in `conformance/cases/linear`; control-flow 27 + linear 13 dirs. `E-TILDE-001/002` legitimately **parked** (emit descriptors exist type-system.ts:17448/17459 but fire-wiring scoped-separately per S261 → unreachable via conformance). 12/14 landed, 2 parked. **The `ss75-conformance-linear-35` BRIEF DONE-PROBE was updated** to drop the parked E-TILDE codes (was keeping the thread false-open).

## 🔬 The 3 S239 findings on #120 (non-blocking; TRACKED hardening follow-ups)
1. **[altitude]** type-system.ts callable-cell I-SSR lint recomputes "is gated" (`_callableGated`) by hand instead of reusing emit-server's `serverLoadGateMode` — the classifier-split the shared sql-lex was built to kill, left un-shared for the auth axis. No live divergence (omission always keys off serverLoadGateMode); re-opens the drift class for a future serverLoadGateMode change. Fix ≈ 2 lines.
2. **[correctness/low]** `sql-lex.ts` E'/e' escape-string branch assumes Postgres; default db is SQLite (no E'…' syntax) — adversarial `code=E'${@x}'` could mis-classify a live interp.
3. **[correctness/low]** emit-sync anon hydrates a gated cell to `undefined` (scrml absence is `not`/null).
→ File these as known-gaps or a hardening sliver when the SSR area is next touched.

## 🚦 OPEN / NEXT (all need bryan's steer — nothing active/unblocked in-scope)
- **`e-markup-002-native-emit`** — parked native-parity deferral (above).
- **Owed known-gap NOT yet filed:** the tenant-floor **§38.13.9 channel/SSE per-subscriber tenant filter residual** (carry from S273 #118). Filed this session → `docs/known-gaps.md`.
- **Adopter #27** — navigate() soft-nav (bryan's lane), untouched.
- The 3 SSR hardening findings (above).
- **Delete the stale land branch** (hazard, above).
- **6c maps — PARTIAL refresh** (rode this wrap): project-mapper refreshed `error.map.md` (+ the SSR retired/new codes + `sql-lex.ts`) and `dependencies.map.md`, then **API-stalled** before `domain.map.md` (§14.8.10/§52.15.5 additions) + the `primary.map.md` stamp bump. Maps are WARN-only/not-gated; next session: re-run `project-mapper` (cheap — error/deps already current) to finish `domain.map.md` + bump the stamp `df2ac831`→`58c8161d`.

## pa.md directives in force / lessons this session
PR-flow (branch→PR→cloud `gate`→merge on authz) · **verify-before-dispatch flips leans** (Fork-B: a "wire the dead check" lean was wrong — the check was already live; grep-fire-sites-before-claiming, execute-don't-grep) · **STOP-if-bigger + surface** (esql4: a "4-file corpus edit" revealed a native-parity-allowlist entanglement → surfaced the tradeoff, bryan ruled) · S239 adversarial + independent R26 mandatory on every codegen land (incl. our own dispatches) · file-delta base-drift discrimination (the ss75 land branch is the textbook clobber-hazard) · runtime conformance stays deterministic (no session-auth full-bundle HTTP — cloud-flaky).

## Tags
#session-274 #freeze-spec-campaign-COMPLETE #ssr-auth-leak-CLOSED-120 #freeze-spec-reconcile-5-threads-121 #esql4-samples-migrated-122 #ss75-confirmed-done #fork-b-verify-flipped-wire-to-citefix #esql4-native-parity-tradeoff-ruled-a #conformance-745 #stale-land-branch-hazard #e-markup-native-parity-parked
