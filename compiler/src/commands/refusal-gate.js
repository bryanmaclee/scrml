/**
 * No artifact from a compile that reports an error — the command-side half.
 *
 * SPEC §2.2.1 (S451 5(b); impl#1 exception granted S457 "1a"): "A compile that
 * reports one or more diagnostics of Error severity (§34) SHALL NOT produce a
 * runnable artifact. After such a compile, either no output file of that compile
 * exists, or the compile wrote no file — an output directory left by an earlier
 * compile is left exactly as it was, neither overwritten in part nor deleted."
 *
 * The rule is enforced in ONE place, `compileScrml` (api.js): every fatal
 * diagnostic is known, and every pre-write check (the emitted-JS parse gate,
 * the dist-path collision check) has run, before the first byte reaches the
 * output directory; any Error refuses the whole write. `result.artifactsWritten`
 * reports which way it went. Every entry point inherits it — `scrml compile`,
 * `scrml build`, `scrml dev` / `--watch` recompiles, `scrml serve`.
 *
 * History. Before S457 only an allow-list of "application-scope" codes refused
 * the write (`APPLICATION_SCOPE_REFUSALS`: E-MW-007 / E-MW-008, E-PROGRAM-002,
 * E-PROGRAM-NESTED-AUTH / -SESSION / -ATTR, E-PROGRAM-CONFIG-UNREAD,
 * E-AUTH-ATTR-INVALID, E-SESSION-AMBIENT-SERVER, E-INTERNAL-SESSION-AMBIENT-SERVER
 * — g-session-config-refusal-still-writes-dist, S438/S445/S449); every other hard
 * error exited 1 AND wrote a complete-looking dist. Those codes are Errors, so the
 * general rule covers them and the list is retired. The one refusal a command
 * still decides itself is `scrml build`'s E-MW-007 over the post-write unit set
 * (two request onions, one of them possibly a STALE unit already in dist) — it is
 * a server-entry fact `compileScrml` does not see, raised through the
 * `beforeWrite` callback (commands/build.js).
 *
 * Why the output directory is left as it was rather than cleared (§2.2.1 says
 * "neither overwritten in part nor deleted"): `scrml dev` keeps serving while a
 * recompile fails — it answers every request with the compile error (#517/#518)
 * and resumes on the next green pass, so an untouched last-good dist is never
 * served as current; and an adopter's build directory is never deleted by a
 * typo. The commands say so on stderr (`noFilesWrittenLine`).
 */

/** The line `compile` / `build` print when a failed compile wrote nothing. */
export function noFilesWrittenLine(outputDir) {
  return `No files were written to ${outputDir}/ (a compile that reports an error leaves it as it was).`;
}
