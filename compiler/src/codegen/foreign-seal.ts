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
 * that evaluation has no module context. No literal `undefined` either: the server-output
 * lint W-CG-UNDEFINED-INTERPOLATION flags it (scrml absence is `null`, §42) — so a host name
 * the module lacks is left UNBOUND in the slice rather than bound to an absent value.
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
  if (!sealed) {
    // The module's host context, bound only where the host provides it (a module
    // evaluated without one leaves the name unbound, exactly as host code sees it).
    const hostNames = [];
    const hostValues = [];
    if (typeof require === "function") { hostNames.push("require"); hostValues.push(require); }
    if (typeof __dirname === "string") { hostNames.push("__dirname"); hostValues.push(__dirname); }
    if (typeof __filename === "string") { hostNames.push("__filename"); hostValues.push(__filename); }
    const build = new Function(...hostNames,
      "\"use strict\";\nreturn (" + source + ");\n//# sourceURL=" + site);
    const slice = build(...hostValues);
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

// ---------------------------------------------------------------------------
// The two pre-emit SYNTACTIC scans of a slice (§23.2.4a): its SHAPE (single expression vs
// statement body) and its TOP-LEVEL bindings (the E-FOREIGN-006 crossing-shadow check).
//
// Both read the slice as the TOKEN STREAM the PARSER produces when it parses the slice in the
// context it is actually built in — the body of a strict async function inside the probe
// `checkForeignSliceSyntax` uses — never as characters and never from a standalone lexer.
//   - A hand character scanner did not know regex literals: the `'` in `/['x]/g` opened a
//     "string" that hid the slice's top-level `return` (s456, adopter flogence).
//   - A standalone lexer is not enough either (s456 review F1): whether `/` starts a regex or
//     divides depends on the grammar, and outside an async function `await` is an identifier, so
//     `await /'/.exec(s)` lexed `/` as division and the `'` as an unterminated string — and the
//     slice was taken as a statement body with no `return`, settling silently to `not`.
// The parser decides regex vs division in the slice's real context (acorn re-reads a `/` at an
// expression start as a regex), and `onToken` hands back the tokens it settled on.
//
// The token parse uses the wrapper WITHOUT the crossings as parameters. Parameters never change
// how the body tokenizes, and leaving them out keeps a crossing-shadowing slice (`in:{ a }` +
// `const a`) parseable here — the redeclaration is what E-FOREIGN-006 must NAME, so it must not
// make the token stream disappear (review F2). The build check (`checkForeignSliceSyntax`, with
// the parameters) still decides buildability.
//
// A slice that parses in NEITHER shape has no token stream. It cannot be built in either shape,
// so the caller's build check refuses it as E-FOREIGN-007 — the scans never guess a shape for
// text the parser rejected.
//
// Opacity (§23.2.3) is unchanged: the scans read only nesting depth, `;`, the `return` keyword
// and the binding keywords at depth 0. They never type-check, analyse or rewrite the interior.
// ---------------------------------------------------------------------------

interface SliceToken {
  type: { label: string; keyword?: string };
  value?: unknown;
  start: number;
  end: number;
}

/**
 * Parse `body` as the sealed function body the helper builds (minus the parameters, see above)
 * and return the tokens that fall inside the slice, or null when it does not parse. `body`
 * contains the slice verbatim at `sliceOffsetInBody`.
 */
function tokensInWrapper(body: string, sliceLength: number, sliceOffsetInBody: number): SliceToken[] | null {
  const head = `(function (require, __dirname, __filename) {"use strict";\nreturn (`;
  const fnHead = "async function () {\n";
  const probe = `${head}${fnHead}${body}\n});\n})`;
  const from = head.length + fnHead.length + sliceOffsetInBody;
  const to = from + sliceLength;
  const all: SliceToken[] = [];
  try {
    acorn.parse(probe, {
      ecmaVersion: "latest",
      sourceType: "script",
      onToken: (t: SliceToken) => { all.push(t); },
    });
  } catch {
    return null;
  }
  return all.filter((t) => t.start >= from && t.end <= to);
}

/**
 * The slice's tokens as the parser reads them: first as a STATEMENT BODY (the verbatim shape),
 * else as a SINGLE EXPRESSION (`return (<slice>\n);`). `asExpression` says which parse produced
 * them. Null: the slice parses in neither shape.
 */
function parsedSliceTokens(slice: string): { tokens: SliceToken[]; asExpression: boolean } | null {
  const asBody = tokensInWrapper(slice, slice.length, 0);
  if (asBody !== null) return { tokens: asBody, asExpression: false };
  const asExpr = tokensInWrapper(`return (${slice}\n);`, slice.length, "return (".length);
  if (asExpr !== null) return { tokens: asExpr, asExpression: true };
  return null;
}

const OPENERS = new Set(["(", "[", "{", "${"]);
const CLOSERS = new Set([")", "]", "}"]);

/** A token after `.` / `?.` is a property name even when it spells a keyword (`g.return()`). */
function isPropertyNamePosition(prev: SliceToken | undefined): boolean {
  return prev !== undefined && (prev.type.label === "." || prev.type.label === "?.");
}

/**
 * §23.2.4a value-flow shape. A slice with no top-level `;` and no top-level `return` is a
 * SINGLE EXPRESSION (codegen injects the `return`); otherwise it is a statement body used
 * verbatim. A slice that parses only as an expression (an object literal `{ a: 1, b: 2 }`) is a
 * single expression. `parsed: false` — the slice parses in neither shape; the caller must refuse
 * it (E-FOREIGN-007 via the build check), never pick a shape for it.
 */
export function scanForeignSliceShape(src: string): { topLevelReturn: boolean; topLevelStmtSep: boolean; parsed: boolean } {
  const parsed = parsedSliceTokens(src);
  if (parsed === null) return { topLevelReturn: false, topLevelStmtSep: false, parsed: false };
  if (parsed.asExpression) return { topLevelReturn: false, topLevelStmtSep: false, parsed: true };
  const tokens = parsed.tokens;
  let depth = 0;
  let topLevelReturn = false;
  let topLevelStmtSep = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const label = t.type.label;
    if (OPENERS.has(label)) { depth++; continue; }
    if (CLOSERS.has(label)) { depth--; continue; }
    if (depth !== 0) continue;
    if (label === ";") topLevelStmtSep = true;
    else if (t.type.keyword === "return" && !isPropertyNamePosition(tokens[i - 1])) topLevelReturn = true;
  }
  return { topLevelReturn, topLevelStmtSep, parsed: true };
}

/**
 * The TOP-LEVEL bindings of the slice whose names are in `names` (the crossings): a `const` /
 * `let` / `var` / `function` / `class` (incl. `function*`) at depth 0. A binding inside a nested
 * `{}` / `()` / `[]`, a string, a comment or a template literal is not top level and does not
 * collide with a parameter of the sealed function. A slice that parses in neither shape reports
 * none; its E-FOREIGN-007 carries the parser's complaint.
 */
export function scanForeignSliceTopLevelBindings(src: string, names: Set<string>): string[] {
  const parsed = parsedSliceTokens(src);
  if (parsed === null || parsed.asExpression) return [];
  const tokens = parsed.tokens;
  const found = new Set<string>();
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const label = t.type.label;
    if (OPENERS.has(label)) { depth++; continue; }
    if (CLOSERS.has(label)) { depth--; continue; }
    if (depth !== 0 || isPropertyNamePosition(tokens[i - 1])) continue;
    const kw = t.type.keyword;
    const isBindingHead = kw === "const" || kw === "var" || kw === "function" || kw === "class"
      || (label === "name" && t.value === "let");
    if (!isBindingHead) continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].type.label === "*") j++;
    const nameTok = tokens[j];
    if (nameTok && nameTok.type.label === "name" && typeof nameTok.value === "string" && names.has(nameTok.value)) {
      found.add(nameTok.value);
    }
  }
  return [...found];
}
