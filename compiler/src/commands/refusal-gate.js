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
 * NARROW SCOPE: only these two codes refuse the write. Every other hard error keeps
 * the pre-existing posture (artifacts land, exit 1); widening it is an open ruling.
 */

/** The hard errors that refuse the build as "two applications in one compiled server". */
export const APPLICATION_SCOPE_REFUSALS = new Set(["E-MW-007", "E-MW-008"]);

/** True when any diagnostic in `errors` is an application-scope refusal. */
export function hasApplicationScopeRefusal(errors) {
  return Array.isArray(errors) && errors.some((e) => e && APPLICATION_SCOPE_REFUSALS.has(e.code));
}

/** The line both commands print when a refusal left the output directory untouched. */
export function noFilesWrittenLine(outputDir) {
  return `No files were written to ${outputDir}/ (a refused build leaves it as it was).`;
}
