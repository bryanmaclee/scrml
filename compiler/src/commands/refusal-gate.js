/**
 * The application-scope refusal, decided BEFORE ANY WRITE
 * (g-session-config-refusal-still-writes-dist).
 *
 * E-MW-008 (§20.5.1, two applications contest one session cookie) and E-MW-007
 * (§40.3.4, two request onions) refuse a build as "two applications in one
 * compiled server". Until this gate both exited 1 but still wrote a complete dist/
 * holding the refused units — and a refused REBUILD overwrote the units in place
 * beside the previous build's `_server.js`, which then booted and served 200 on
 * the split (measured S438).
 *
 * The commands pass `compileScrml` a `beforeWrite` callback (api.js). It sees the
 * full diagnostic list and the PLANNED `.server.js` units before the first byte is
 * written, and returning `false` skips every write, so `outputDir` is left exactly
 * as it was — absent on a first build, byte-identical to the last good build on a
 * rebuild. No staging directory is involved, so no extra filesystem permission is
 * needed and nothing can be left behind by an interrupted build.
 *
 * E-PROGRAM-002 (§40.8, two top-level `<program>`s in one file) and
 * E-PROGRAM-NESTED-AUTH (§4.12.2, `auth=` on a nested `<program>`) refuse the write
 * for the same reason (S445, s445-program-role-by-ancestor): both are raised
 * exactly where the compiler cannot honour a declared `auth=` / session / middleware
 * setting, so the units it would write are the FAIL-OPEN ones — measured before
 * S445: `compile` / `build` exited 1 on either code yet wrote a `.server.js` whose
 * server functions answered anonymous callers, runnable by any `_server.js` left
 * from a previous build.
 *
 * E-PROGRAM-NESTED-ATTR (§4.12.2, S445 item 5 — any other application-level attribute
 * on a nested `<program>`, e.g. a route file's `ratelimit=` / `headers=`) and
 * E-PROGRAM-NESTED-SESSION (§4.12.2, S445 item 3 — a session attribute on a nested
 * `<program>`) and E-PROGRAM-CONFIG-UNREAD (§4.12 — a top-level `<program>` that only
 * exists after component expansion, whose config was never read) refuse it for the same
 * reason: the units that would be written are the ones whose declared settings the
 * compiler could not honour.
 *
 * E-AUTH-ATTR-INVALID (§52.13.2, S449 ruling item 4 — an `auth=` on a `<program>` /
 * `<page>` that is not one of the three literals) and E-SESSION-AMBIENT-SERVER /
 * E-INTERNAL-SESSION-AMBIENT-SERVER (§6.6.9 / §20.5, S449 ruling item 1 — a server
 * `@session` read) refuse it for the same reason: before S449 both shapes compiled
 * to fail-open units (a PUBLIC server for `auth="Required"`; a server that took the
 * caller's identity from the request body for `@session.userId`), so the units that
 * would be written are exactly the ones whose declared auth the compiler cannot honour.
 *
 * NARROW SCOPE: only these codes refuse the write. Every other hard error keeps
 * the pre-existing posture (artifacts land, exit 1); widening it is an open ruling.
 */

/**
 * The hard errors that refuse the build before any write: "two applications in one
 * compiled server" (E-MW-007 / E-MW-008) and an application / auth scope the
 * compiler cannot honour (E-PROGRAM-002 / E-PROGRAM-NESTED-AUTH).
 */
export const APPLICATION_SCOPE_REFUSALS = new Set([
  "E-MW-007",
  "E-MW-008",
  "E-PROGRAM-002",
  "E-PROGRAM-NESTED-AUTH",
  "E-PROGRAM-NESTED-SESSION",
  "E-PROGRAM-NESTED-ATTR",
  "E-PROGRAM-CONFIG-UNREAD",
  "E-AUTH-ATTR-INVALID",
  "E-SESSION-AMBIENT-SERVER",
  "E-INTERNAL-SESSION-AMBIENT-SERVER",
]);

/** True when any diagnostic in `errors` is an application-scope refusal. */
export function hasApplicationScopeRefusal(errors) {
  return Array.isArray(errors) && errors.some((e) => e && APPLICATION_SCOPE_REFUSALS.has(e.code));
}

/** The line both commands print when a refusal left the output directory untouched. */
export function noFilesWrittenLine(outputDir) {
  return `No files were written to ${outputDir}/ (a refused build leaves it as it was).`;
}
