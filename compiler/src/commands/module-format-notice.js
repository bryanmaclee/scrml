/**
 * module-format-notice.js — operational (CLI) notices for `--module-format`.
 *
 * ESM chunks arc. `--module-format=esm` emits the client runtime + every client
 * chunk as ES modules, and (as of Unit 3) the HTML `<script>` tags carry
 * `type="module"` and the build-path content-hash rewrites the in-chunk import
 * URLs — so a full `--module-format=esm` app now RUNS in a browser. The format
 * is still EXPERIMENTAL and OPT-IN: `classic` remains the default and the sole
 * conformance-tested path, and the committed module-capable browser-test harness
 * (Unit 5) plus the default-flip (Unit 6) are still pending. This notice keeps
 * that state honest rather than letting `--esm` masquerade as the blessed path.
 *
 * This is an OPERATIONAL notice surfaced by the compile/build/dev commands —
 * deliberately NOT a §34 source-diagnostic catalog row (the freeze-gated
 * catalog is for language-level diagnostics, not an internal build-flag state).
 * The command prints these lines to stderr; they never enter the compiler's
 * diagnostic stream or the compile result.
 *
 * Classic (the default) returns an EMPTY array, so the default path prints
 * nothing and stays byte-/output-identical to pre-arc behaviour.
 */

export const W_MODULE_FORMAT_ESM_INCOMPLETE = "W-MODULE-FORMAT-ESM-INCOMPLETE";

/**
 * Build the operational notice lines for a resolved `--module-format`.
 *
 * @param {string} moduleFormat — "classic" (default) or "esm".
 * @param {boolean} embedRuntime — whether `--embed-runtime` is also set.
 * @returns {string[]} lines to print to stderr (empty for classic).
 */
export function moduleFormatNotices(moduleFormat, embedRuntime) {
  if (moduleFormat !== "esm") return [];

  const lines = [
    `${W_MODULE_FORMAT_ESM_INCOMPLETE} (operational warning): --module-format=esm is ` +
      `experimental and opt-in. The emitted app runs in a browser (runtime + chunks are ES ` +
      `modules, the HTML <script> tags are type="module", and build content-hashes the in-chunk ` +
      `import URLs), but --module-format=classic (the default) is the only conformance-tested ` +
      `path and stays the recommended one; the committed module-capable browser-test harness and ` +
      `the default-flip are still pending. Use classic unless you are deliberately exercising esm.`,
  ];

  if (embedRuntime) {
    lines.push(
      `  Note: --module-format=esm has no effect together with --embed-runtime — the embedded ` +
        `runtime stays a classic script. Omit --embed-runtime to get the ES-module runtime shape.`,
    );
  }

  return lines;
}
