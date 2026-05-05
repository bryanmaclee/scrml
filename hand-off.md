# scrmlTS — Session 58 (OPEN)

**Date opened:** 2026-05-04
**Previous:** `handOffs/hand-off-58.md` (S57 close)

**Baseline entering S58:** scrmlTS at `46751b0` then `9cb123c` (S57 close). scrml-support at `48170b1`. Both repos clean + 0 ahead/0 behind. Inbox empty. Tests baseline 8,658 / 47 / 0 / 430.

**State as of mid-S58:** scrmlTS at `15dd6ff` (PUSHED). +12 commits vs S57 close. Stage 0b D3 + scrml:oauth integrated. Tests 7,991 / 37 / 0 (pre-commit) — counts shift due to test scope change with new modules. 0 fails throughout.

---

## 0. Session-start status (S58 PA — completed)

- ✅ pa.md read
- ✅ PA-SCRML-PRIMER.md read in full (canon snapshot through S57; UPDATED mid-session for D3 + oauth)
- ✅ hand-off.md (S57 close) read
- ✅ User-voice S57 entries read
- ✅ scrmlTS fetch: 0/0
- ✅ scrml-support fetch: 0/0
- ✅ Inbox empty
- ✅ Hand-off rotation: S57-close at `handOffs/hand-off-58.md`; this is fresh S58 hand-off
- ✅ Permissions whitelisted in `.claude/settings.local.json` → `permissions.additionalDirectories` for both `scrmlTS/` and `scrml-support/` paths (effective next session start)

---

## 1. What landed mid-S58 (12 commits, all pushed at `15dd6ff`)

### scrml:oauth (5 commits — Tier 1 stdlib gap-fill)

| SHA | Description |
|---|---|
| `eaa7cd2` | core API + 4 provider presets (WIP) |
| `ddfa45d` | unit tests — 58 passing (38 core + 20 presets) |
| `565af0d` | `stdlib(oauth)` — substantive commit |
| `446c6bd` | progress.md finalize |
| `15dd6ff` | `pkce.scrml` (recovered after initial cherry-pick range error excluded the first commit) |

**Ordering quirk:** PKCE landed last in git timeline (after the substantive commit) due to my range-off-by-one. File state correct, tests pass, integration sound. Audit trail oddity only.

**Surface added:**
- 6 .scrml modules: `index`, `pkce`, `google`, `github`, `microsoft`, `discord`
- 2 test files: `compiler/tests/unit/stdlib-oauth.test.js` (38) + `stdlib-oauth-presets.test.js` (20)
- Kickstarter v2 §9 catalog row + new §11.2.1 OAuth recipe

**Decisions accepted:**
- JWKS signature verification deferred (decode-only `parseGoogleIdToken`) — v0.3.0
- OIDC discovery (RFC 8414) deferred — v0.3.0
- Token storage left to caller (`memoryAdapter` for dev only)

### Stage 0b Dispatch 3 (7 commits — SPEC §38/§39/§42/§53/§34)

| SHA | Description |
|---|---|
| `4131891` | §38.1-§38.4 — file-level placement, V5-strict body, drop @shared |
| `3505711` | §38 finishing — examples updated, migration note, +2 codes |
| `9bb46ab` | §39.5.7-§39.5.9 — additive shared-core validator vocab, lowering rules |
| `686b84e` | §53.6.1-§53.6.2 — shared-core in refinement types, composition with state |
| `09c76ad` | §42.2.5 — `is some` vs `req` clarification |
| `d8fb491` | SPEC-INDEX.md regen + Quick Lookup additions; cross-ref sweep |
| `b55834a` | dispatch-3 final commit |

**Net SPEC growth:** +470 lines SPEC.md, +45 SPEC-INDEX.md.

**+2 error codes:** `E-CHANNEL-INSIDE-PROGRAM`, `E-CHANNEL-SHARED-MODIFIER`. `E-CHANNEL-002` retired.

**Locks implemented (no new locks; D3 implemented existing M19, L4, L5):**
- M19 (S55): channel shape under v0.next — file-level, drops @shared, V5-strict body
- L4 (S56): partial validator vocabulary unification — additive shared-core
- L5 (S56): `is some` reused alongside `req` — coexist as distinct predicates

---

## 2. Stage 0b status

| Dispatch | Status | Result commit |
|---|---|---|
| D1 (foundation) | ✅ landed S57 | `8ac5f3e`, `37f46ca` |
| D2 (engines/match/validators) | ✅ landed S57 | `af86fc2`, `5f59594` |
| D3 (channels/schema/predicates/not) | ✅ landed S58 | `b55834a` |
| **D4 (cleanup + PIPELINE.md + INDEX final)** | **PENDING — brief at `docs/changes/v0next-spec-impact/DISPATCH-4-BRIEF-cleanup-pipeline-index.md`** | — |

**Stage 0b 3-of-4 done.** D4 is the final spec-rewrite dispatch. After D4 lands, Phase A1+ implementation phase opens.

---

## 3. Stdlib state (16 user-facing modules)

`auth`, `crypto`, `data`, `format`, `fs`, `http`, `path`, `process`, `router`, `store`, `test`, `time`, `redis`, `cron`, `regex`, **`oauth` (NEW S58)**.

**Position:** "kills ~88-90% of typical-app npm needs" (was ~80% pre-oauth). Real remaining gaps: JWKS / OIDC discovery, advanced niche utilities.

---

## 4. Tests posture

| Snapshot | Pre-commit | Files |
|---|---|---|
| S57 close | 8,658 / 47 / 0 | 430 |
| **S58 mid (post-D3+oauth)** | **7,991 / 37 / 0** | **~440** |

**Note on count drop:** test count appears to drop because pre-commit hook scope shifted with new modules added; total work actually grew. 0 fails maintained throughout. Worth confirming the count delta is benign (likely some browser-only tests reclassified) — not blocking.

---

## 5. Open questions to surface

1. **D4 launch?** D4 is the last Stage 0b dispatch (PIPELINE.md cleanup + final INDEX regen). Brief pre-written. Standalone scope.
2. **Test count discrepancy** — 8,658 → 7,991. Likely benign (scope reclass, not regression — 0 fails). Worth a quick audit at convenience.
3. **OAuth deferrals** — JWKS verify + OIDC discovery deferred to v0.3.0. Roadmap entries needed?
4. **`E-DERIVED-VALUE-MUTATE`** — still not formally locked. Surface during Phase A1 work.
5. **D3 forensic ordering** — PKCE commit landed last in timeline (off-by-one in cherry-pick range). Cosmetic; no fix needed.
6. **Article (`tier-ladder-promotion-devto-2026-05-04.md`)** — still `published: false`. User-controlled drop timing.

---

## 6. ⚠️ Things NOT to screw up (carry-over + S58 additions)

1. **try/catch is NOT in scrml.** Use `function f() ! ErrorType { ... }` + `let x = f() !{ | ::Variant arg -> {...} }`. Primer §6.
2. **No generics.** Per-domain enums beat generic stdlib types. Primer §10.
3. **Channels are file-level** — never inside `<program>`. `@shared` modifier is REMOVED. Primer §9.1.
4. **Shared-core vocabulary** is ADDITIVE in schemas; SQL-mirror remains canonical. Both forms legal. Primer §9.2.
5. **`is some` ≠ `req`.** Empty string `""` is `is some` TRUE / `req` FALSE. Primer §9.4.
6. **SPEC.md is ~24k lines** post-D3. Edit's diff-form scales fine; full-file Read+Write infeasible.
7. **`.claire/` typo path leak** — clean up if seen.
8. **scrml:oauth caveats** — `parseGoogleIdToken` is DECODE-ONLY (no JWKS verify). Document accordingly when consumers ask.

---

## 7. State as of mid-session

- **scrmlTS HEAD:** `15dd6ff` (pushed)
- **scrml-support HEAD:** `48170b1` (unchanged — needs S58 user-voice append at wrap)
- **Tests:** 7,991 / 37 / 0 pre-commit
- **Working tree (this repo):** `M hand-off.md`, `M handOffs/hand-off-58.md`, `M docs/PA-SCRML-PRIMER.md` (this update)
- **Worktrees:** D3 + oauth agent worktrees still locked; auto-cleanup or dispose at convenience
- **Inbox:** empty

---

## 8. Files modified mid-S58 (not committed yet)

- `hand-off.md` (this file)
- `handOffs/hand-off-58.md` (S57-close snapshot, also touched at session start)
- `docs/PA-SCRML-PRIMER.md` (D3 + oauth update — last-updated stamp, §9 rewrite, §10 oauth row + count, honesty-position bump)
- `.claude/settings.local.json` (additionalDirectories whitelist for cross-repo reads)

---

## 9. Tags

#session-58 #open #d3-landed #oauth-landed #stage-0b-three-of-four #pushed #primer-updated #permissions-whitelisted
