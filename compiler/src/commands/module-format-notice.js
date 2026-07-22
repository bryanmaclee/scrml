/**
 * module-format-notice.js — operational (CLI) notices for `--module-format`.
 *
 * ESM chunks arc, Unit 1 fix-round. `--module-format=esm` emits the client
 * runtime as an ES module, but Unit 1 does NOT yet emit the `<script type=
 * "module">` HTML tag or the chunk-side `import`s (those land in later units).
 * So an esm compile currently produces a runtime a browser CANNOT load as-wired
 * (the classic `<script src>` tag throws on the runtime's `export`). Compiling
 * silently would be a fail-closed-Nominal violation (S231) — a green compile
 * shipping a browser-dead app with zero diagnostics. This surfaces an honest
 * heads-up instead.
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
      `experimental and not yet browser-loadable. The emitted runtime is an ES module, but the ` +
      `HTML still loads it as a classic <script> (the module <script type="module"> tags and ` +
      `chunk-side imports land in a later unit), so the compiled app will NOT run in a browser ` +
      `until then. Use --module-format=classic (the default) for a runnable build.`,
  ];

  if (embedRuntime) {
    lines.push(
      `  Note: --module-format=esm has no effect together with --embed-runtime — the embedded ` +
        `runtime stays a classic script. Omit --embed-runtime to get the ES-module runtime shape.`,
    );
  }

  return lines;
}
