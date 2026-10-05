/**
 * §23.2.4a — the SEALED evaluation scope of an in-process `_={ … }=` foreign slice.
 *
 * THE RULE (SPEC §23.2.4a, crossing grammar): "The named values are the ONLY things that
 * cross — there is NO free lexical capture (the slice sees only what `in:{}` names)."
 *
 * WHAT USED TO BE EMITTED, AND WHY IT BROKE THE RULE
 * ==================================================
 * The slice was spliced IN PLACE as an async IIFE:
 *
 *     const out = await (async (n) => { return (n * 2); })(n);
 *
 * An arrow function closes over every binding in scope at its position, so the slice could
 * read every enclosing scrml local and every module binding — including compiler-owned ones
 * such as the raw database handle. Executed on c5c95bc64: `_={ _scrml_sql.unsafe("SELECT 1") }=`
 * returned rows, and slices naming an uncrossed local and a module `const` returned their
 * values (g-foreign-iife-captures-module-scope-s454).
 *
 * THE SEAL
 * ========
 * The slice's source text is carried as a STRING and compiled ONCE by the `Function`
 * constructor, whose only lexical scope is the global one:
 *
 *     const out = await _scrml_foreign_seal("app.scrml:6", `async function (n) {
 *     return (n * 2
 *     );
 *     }`)(n);
 *
 * What a sealed slice can name: its parameters (exactly the `in:{}` crossings), host globals
 * (`Bun`, `process`, `fetch`, `Response`, `globalThis`, …), and the module's HOST context —
 * `require`, `__dirname`, `__filename`, which Bun binds per MODULE rather than globally and
 * which are handed in explicitly. What it cannot name: any scrml binding, any compiler-owned
 * binding. It is a seal against the COMPILER's and the PROGRAM's scope, not a sandbox: the
 * slice is author-trusted host code (§23.2.3) and keeps every host capability.
 *
 * WHY A STRING AND NOT REAL CODE
 * ==============================
 * Two alternatives were measured and rejected (docs/changes/s455-foreign-sealed-scope):
 *   - Re-evaluating real code from `Function.prototype.toString()` is UNSOUND under Bun: Bun
 *     re-prints every module it loads (comments dropped; `typeof require` constant-folded into
 *     the function text), so the seal would be built from Bun's transpiled text, not the
 *     author's slice — and constant inlining can move a module value INTO the slice.
 *   - A separate emitted module per slice would be sealed too, but it adds an artifact class
 *     every consumer of the compile output (dist writer, conformance adapters that evaluate a
 *     single bundle, tool runners that write one file) would have to learn.
 *
 * The cost of a string: the artifact's own syntax gate (validate-emit) can no longer see the
 * slice. `checkForeignSliceSyntax` restores that check at the slice, as an AUTHOR error
 * (E-FOREIGN-007) instead of the old post-emit "compiler defect" framing.
 *
 * Compiled once: the helper caches the built function per distinct source text (identical
 * text builds an identical sealed function, so sharing is exact).
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
import * as acorn from "acorn";

/** The runtime helper's name. Must not match `\b_scrml_sql(?:_\d+)?\b` (see sql-tx-guard.ts). */
export const FOREIGN_SEAL_FN = "_scrml_foreign_seal";

/**
 * The runtime helper, inlined on use into every artifact that lowers a foreign slice
 * (server bundle, `kind="tool"` module, library module). A single `function` declaration
 * with no other top-level binding: it hoists, so header or footer placement are both safe.
 *
 * ⛔ Constraints on this text (shared with every server-module helper — sql-tx-guard.ts):
 * no `import`, no top-level `await` (the conformance adapter evaluates a server module with
 * `new Function`); `require` / `__dirname` / `__filename` are read through `typeof` because
 * that evaluation has no module context.
 *
 * ⛔ ASCII ONLY. This is a `String.raw` template, and Bun's transpiler re-prints a non-ASCII
 * character in a raw template as a `\uXXXX` escape — which `String.raw` then keeps as six
 * literal characters (measured: a `§` arrived in the artifact as the text `§`). The
 * section sign is therefore written as the JS escape `§` INSIDE the emitted string
 * literals, where the artifact's own parser turns it back into `§`.
 *
 * ⛔ NO FOREIGN SIGIL. The text never spells the `_` + `=` + `{` opener: emit-library's
 * leaked-foreign-syntax check (`/_=\s*\{/` over the emitted module) and the tests that pin
 * "no raw foreign syntax reaches an artifact" would read the helper as a leak.
 */
export const SERVER_FOREIGN_SEAL_HELPER: string = String.raw`
// --- SPEC 23.2.4a foreign-slice seal (compiler-generated) ---
// A foreign-code slice runs SEALED. Its source text is compiled once, by the Function
// constructor, so its only lexical scope is the global one: it sees the names its
// in:{} header crosses (its parameters), host globals (Bun, process, fetch, ...) and
// this module's host context (require, __dirname, __filename) - never a scrml binding
// and never a compiler-owned one.
function _scrml_foreign_seal(site, source) {
  const cache = _scrml_foreign_seal.cache || (_scrml_foreign_seal.cache = new Map());
  let sealed = cache.get(source);
  if (sealed === undefined) {
    const build = new Function("require", "__dirname", "__filename",
      "\"use strict\";\nreturn (" + source + ");\n//# sourceURL=" + site);
    const slice = build(
      typeof require === "function" ? require : undefined,
      typeof __dirname === "string" ? __dirname : undefined,
      typeof __filename === "string" ? __filename : undefined,
    );
    sealed = async (...args) => {
      try {
        return await slice(...args);
      } catch (e) {
        // A name the slice reads that is not crossed is not in scope: say so at the slice.
        if (e instanceof ReferenceError && typeof e.message === "string" && !e.message.includes("§23.2.4a")) {
          e.message += " (raised in the foreign-code slice at " + site + ": only the names in its in:{} header cross into a slice, plus host globals - SPEC §23.2.4a)";
        }
        throw e;
      }
    };
    cache.set(source, sealed);
  }
  return sealed;
}
`;

/**
 * The sealed slice's source text: an `async function` whose parameters are the crossings.
 * A non-arrow function, so `arguments` inside the slice is the crossings (an arrow would
 * read the builder's) and `this` is `undefined` (a strict call with no receiver) — what
 * the old IIFE gave, minus the captured scope.
 *
 * `inner` is already shaped by the caller (single-expression → `return (<expr>\n);`,
 * multi-statement → verbatim). The newlines around it keep a trailing `//` comment in the
 * slice from swallowing the closing brace.
 */
export function foreignSliceSource(crossings: string[], inner: string): string {
  return `async function (${crossings.join(", ")}) {\n${inner}\n}`;
}

/**
 * A JS template literal whose COOKED value is exactly `text` — readable in the artifact
 * (the slice keeps its line breaks) where a JSON string would collapse it onto one line.
 * Escapes `\`, the backtick and `${`; a template literal normalizes CR / CRLF to LF, which
 * can only change a line terminator OUTSIDE a string in the slice (a raw CR inside a JS
 * string literal is already a syntax error), so the compiled code is unchanged.
 */
export function templateLiteralOf(text: string): string {
  return "`" + text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

/** A `sourceURL` / message site label: no line terminators (they would end the pragma). */
export function foreignSiteLabel(loc: string): string {
  const s = (loc || "foreign-slice").replace(/[\r\n\u2028\u2029]/g, " ");
  return s;
}

/**
 * Parse the sealed slice exactly as the runtime helper will build it (a strict function
 * body in a SCRIPT — the `Function` constructor gives no module context). Returns null when
 * it parses, else the parser's message and the 1-based line WITHIN THE SLICE.
 *
 * This reads the slice only to answer "will the helper be able to build it" — the same
 * question the artifact gate asked of the old in-place IIFE. It never type-checks, rewrites
 * or analyses the interior (§23.2.3 opacity).
 */
export function checkForeignSliceSyntax(source: string): { message: string; sliceLine: number | null } | null {
  // Line 1 of `source` (`async function (…) {`) sits on line 2 of the probe text; the
  // slice body's first line on line 3 (same layout the helper builds).
  const probe = `(function (require, __dirname, __filename) {"use strict";\nreturn (${source});\n})`;
  try {
    acorn.parse(probe, { ecmaVersion: "latest", sourceType: "script" });
    return null;
  } catch (e) {
    const err = e as { message?: string; loc?: { line?: number } };
    const raw = String(err.message ?? e).replace(/\s*\(\d+:\d+\)\s*$/, "");
    const line = typeof err.loc?.line === "number" ? err.loc.line - 2 : null;
    return { message: raw, sliceLine: line !== null && line >= 1 ? line : null };
  }
}
