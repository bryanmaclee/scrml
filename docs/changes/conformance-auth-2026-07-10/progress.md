# Progress — Conformance coverage for scrml auth (E-AUTH family)

Change-id: `conformance-auth-2026-07-10`. Isolated worktree; branch-only (PA reviews + lands).

## VERIFY-FIRST ground truth (measured, not from docs)

- **Existing auth coverage:** `conformance/cases/auth/` held ONLY `auth-003-pos` / `auth-003-neg`
  (E-AUTH-003 — server-authority type without `table=`). The rest of the E-AUTH family was
  uncovered.
- **Code surface** (`grep -oE 'E-AUTH-[A-Z0-9-]+' compiler/SPEC.md`): E-AUTH-001..005 +
  E-AUTH-GRAPH-001..004.
- **Provenance twins found:** `compiler/tests/conformance/conf-AUTH-004.test.js`,
  `conf-AUTH-005.test.js` (Option-D lift sources); `state-authority-codegen.test.js` (E-AUTH-002);
  `auth-graph-{classifier,role-enum-resolution}.test.ts` (E-AUTH-GRAPH classifier/resolver).
- **Oracle baseline:** `bun conformance/run.ts` → 279/279.

## Cases authored (12 = 6 pos + 6 neg)

| case-id | code | shape (canonical) |
|---|---|---|
| `auth-002-pos` | E-AUTH-002 | `<doubleCount server> = @localCount * 2` (verbatim SPEC §52.4.7) |
| `auth-002-neg` | E-AUTH-002 absent | `<doubleCount server> = 0` (literal init, no local deriv) |
| `auth-004-pos` | E-AUTH-004 | same type name, `authority="server"` then `authority="local"` (§52.3.4) |
| `auth-004-neg` | E-AUTH-004 absent | same type twice with MATCHING authority |
| `auth-005-pos` | E-AUTH-005 | `<count server>` in a `<program>` with NO `db=` (§52.11) |
| `auth-005-neg` | E-AUTH-005 absent | same decl in `<program db="postgres">` (server context present) |
| `auth-graph-002-pos` | E-AUTH-GRAPH-002 | `<auth role="Admin">` with NO app-scope role enum (§40.1.1) |
| `auth-graph-002-neg` | family absent | role gate WITH `type UserRole:enum` declared |
| `auth-graph-003-pos` | E-AUTH-GRAPH-003 | `<auth role="Ghost">` — variant not in the resolved enum |
| `auth-graph-003-neg` | family absent | `<auth role="Admin">` — variant IN the enum |
| `auth-graph-004-pos` | E-AUTH-GRAPH-004 | bare `<auth>` (no `role=`, no `check=`) |
| `auth-graph-004-neg` | family absent | `<auth check="checkAdmin">` (well-formed runtime-fallback gate) |

Type-authority negatives (002/004/005) assert `notCodes: [<the code>]` (mirror the conf-AUTH twins).
The E-AUTH-GRAPH negatives assert `notCodePrefixes: ["E-AUTH-GRAPH-"]` — the whole family stays
silent (stronger; the incidental `W-AUTH-*` content/login/runtime-fallback lints are out of scope).
Positive cases assert `codes: [<the code>]` + a `severity` cross-stream partition assertion (all
error-severity). Each is a codes / compile-shape (a)-half case — no `spec`/`rationale`-mandated
(b) runtime half (matches the auth-003 precedent).

## Oracle after

`bun conformance/run.ts` → **291/291** (was 279; +12). All 12 new auth cases PASS.
`bun test compiler/tests/conformance/corpus-bridge.test.js` → 292 pass / 0 fail (gated bridge).
Full pre-commit gate on each commit → 19793 pass / 0 fail / 0 new failures.

## Runtime half — FLAGGED harness-gated (not authored)

The auth RUNTIME (real login / session cookie mint+verify / JWKS RS256 verification / magic-link /
email-verify / password-reset flows) is server-side and NOT soundly drivable by the current
adapter. The `runServer`/`evalServerModule` seam evaluates the emitted server bundle with a
`_scrml_sql` table stub + duck-typed request + cookie jar (it drives protect-redaction + SSR
first-paint), but it has NO driver for: an auth session store, a real cookie-session round-trip
across a login handler, or RS256/JWKS key verification. Authoring a runtime auth case would require
stubbing those, which would fake-test the very thing under assertion. FLAGGED as track-B
harness-gated; NOT authored (per brief: do NOT fake-test with a stub).

## ESCALATIONS — impl-vs-SPEC divergence (surfaced, not decided)

1. **E-AUTH-001 is SPEC-normative but UNIMPLEMENTED in impl#1.** SPEC §52.4.4 + §52.3.4 +
   §52.11 say the compiler SHALL emit E-AUTH-001 when a client-local `@var` is used as a bound
   parameter in a `?{}` INSERT/UPDATE/DELETE outside a server function; §52.4.6 gives a worked
   example. Empirically: ZERO fire-site in `compiler/src/` (grep clean); the §52.4.6 example
   compiles to `E-DG-002` (`@editingId` "declared but never consumed"), NOT E-AUTH-001. This is a
   real impl-vs-SPEC divergence — impl#1 has not implemented the E-AUTH-001 local-leak guard.
   No case authored (a positive would fail the all-green gate; a negative-only would BLESS the
   impl's silence, which README OQ4 forbids). **Escalated for PA/compiler triage.**

2. **E-AUTH-GRAPH-001 is Reserved — SPEC and impl AGREE it does not fire directly** (NOT a
   divergence). §34 catalog + §40.1.1: the A-3.2 role-enum resolver degrades to
   `isImplicitAnonymous` and surfaces malformed-enum structure via the standard type-decl
   diagnostic surface "rather than firing this code directly." Preserved for forensic
   search-hit stability / future use. No case authored (consistent with SPEC intent — nothing to
   assert fires).

## Discipline
Per-sub-feature commits (E-AUTH-002 · 004 · 005 · GRAPH-family); full pre-commit gate green on each;
no `--no-verify`; branch-only (no push / no main advance).
