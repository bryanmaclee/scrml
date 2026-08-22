import { sep } from "node:path";
import { emitDestructurePatternText } from "./emit-destructure-pattern.ts";

/**
 * Build the HTTP route path for a server function.
 */
export function routePath(generatedRouteName: string): string {
  return `/_scrml/${generatedRouteName}`;
}

/**
 * Clean-URL page-prefix strip, separator-canonical (Issue #25).
 *
 * Both the dist WRITE path (`api.js` `pathFor`) and the served route URL
 * (`emit-server.ts` `computeServedPath`) strip a leading `pages/` segment from
 * `dirname(relative(outputBaseDir, source))` so filesystem-inferred routes
 * (§47.9.2) map `pages/customer/loads.scrml` → `/customer/loads`.
 *
 * The input is a `path.relative()` result → HOST separator (`\` on Windows).
 * The strip (`=== "pages"` / `startsWith("pages/")`) and every caller's later
 * `.split("/")` are `/`-oriented, so a raw Windows `pages\customer` misses BOTH
 * branches → nested pages keep the `pages\` prefix → the dist file lands under
 * `dist/pages/...` and the served route becomes `/pages\customer/...` → nested
 * routes 404 (top-level `pages\foo` has no separator, so `=== "pages"` fires and
 * it strips — hence the bug is nested-only). Normalize the HOST separator to `/`
 * FIRST, then strip the leading `pages` segment.
 *
 * We split on the platform `sep` (NOT a hardcoded `\`): on POSIX `sep === "/"`,
 * so this is a TRUE no-op — a literal backslash is a legal Unix filename char and
 * MUST be preserved unchanged (a hardcoded `\`→`/` would silently rename a POSIX
 * `we\ird` dir to `we/ird`, relocating output + routes). On Windows `sep === "\"`,
 * so the native backslashes normalize. Mirrors `migrate.js`'s `.split(sep).join("/")`.
 *
 * The strip stays segment-aligned: only an exact leading `pages` segment is
 * removed. `sub/pages/x` is NOT stripped (leading segment is `sub`), preserving
 * outputBase semantics for a non-`./` outputBase. Returns a `/`-separated
 * relative dir, or `"."` when it collapses to the output root.
 */
export function stripPagesPrefix(relDirRaw: string): string {
  const rel = relDirRaw.split(sep).join("/");
  if (rel === "pages") return ".";
  if (rel.startsWith("pages/")) return rel.slice("pages/".length);
  return rel;
}

/**
 * Escape a string for use in an HTML attribute value.
 */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Blank the CONTENTS of every string literal in `text` to equal-length spaces,
 * preserving overall length and every non-string offset. Single-, double- and
 * template-quoted strings are handled; a template's `${...}` interpolations are
 * left INTACT (their code — including any nested strings, which ARE masked — is
 * real, executing text). Escapes inside a string body are blanked as a unit.
 *
 * WHY (g-prune-server-only-stdlib-chunks-keeps-chunk-on-textual-occurrence):
 * the server-only-stdlib chunk-prune and the sibling read-line prune decide
 * keep/drop by scanning the assembled client body with a word-boundary regex
 * for each bound name. Raw text makes a name inside a STRING LITERAL — a plain
 * display label like `"call hashPassword on the server"` — read as a genuine
 * use, so a server-only chunk (argon2id / `Bun.password.*`) is kept and SHIPPED
 * to the browser on a textual coincidence (a §12 hard-split violation, silent).
 * Masking string bodies before the scan makes a token inside a literal count as
 * nothing while a real member/interp use (`obj.name`, `${name()}`) still counts.
 * Same shape + fix as the S338/S354 raw-text-launder guards in type-system.ts
 * (which carries a private twin `maskStringLiteralSpans` that could converge
 * onto this shared copy — a hygiene follow-up, not required here). Comments are
 * deliberately NOT masked: a stdlib name in a client-position comment is not a
 * live vector (server-fn-body comments lower to a fetch stub; a comment in a
 * client handler body does not compile), and the read-line prune relies on
 * comment markers (`// --- scrml reactive runtime ---`) surviving this pass.
 */
export function maskStringLiteralSpans(text: string): string {
  if (!text || !/["'`]/.test(text)) return text;
  const out = text.split("");
  const n = text.length;

  // Positioned just AFTER an opening quote at `start`; mask the string body,
  // recursing into any `${...}` (template only) so interpolated code stays
  // intact. Returns the index just after the closing quote (or n if unterminated).
  function maskString(start: number, quote: string): number {
    let i = start;
    while (i < n) {
      const c = text[i];
      if (c === "\\") { out[i] = " "; if (i + 1 < n) out[i + 1] = " "; i += 2; continue; }
      if (c === quote) return i + 1;
      if (quote === "`" && c === "$" && text[i + 1] === "{") {
        i = scanCode(i + 2); // `${` and its body stay intact; nested strings masked within
        continue;
      }
      out[i] = " ";
      i++;
    }
    return i;
  }

  // Positioned just after `${`; walk the interpolation's real code (left
  // intact), masking any nested string literals, until the matching `}`.
  function scanCode(start: number): number {
    let i = start;
    let depth = 1;
    while (i < n) {
      const c = text[i];
      if (c === '"' || c === "'" || c === "`") { i = maskString(i + 1, c); continue; }
      if (c === "{") { depth++; i++; continue; }
      if (c === "}") { depth--; i++; if (depth === 0) return i; continue; }
      i++;
    }
    return i;
  }

  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { i = maskString(i + 1, c); continue; }
    i++;
  }
  return out.join("");
}

const REGEX_PRECEDING_KEYWORDS = new Set<string>([
  "return", "typeof", "instanceof", "in", "of", "case", "delete", "void",
  "do", "else", "yield", "await", "throw", "new",
]);

/**
 * Indent each physical line of emitted JS `code` by `indent` — EXCEPT a line that
 * begins inside the RAW text of an unterminated multi-line template literal, where
 * the newline is string CONTENT, not layout, so a prefix would silently corrupt the
 * literal's cooked value (an email body / CSV / PEM blob / LLM prompt returned from
 * a server fn would ship with leading whitespace injected into every continuation
 * line — `g-server-fn-body-reindent-corrupts-multiline-template-literals`). Newlines
 * inside a `${…}` interpolation, or in ordinary code, ARE layout and get indented.
 * For any body with no multi-line template literal (the common case) the output is
 * byte-identical to a blind `code.split("\n").map(l => indent + l)`.
 *
 * THE ONE SHARED RE-INDENTER (S361). Three copies drifted before: emit-server's
 * (a template-aware lexer that desynced on regex literals) and two BLIND
 * `split("\n")+prefix` loops in emit-tool / emit-library-shared that corrupted a
 * multi-line template unconditionally. Converged here so a fix lands once.
 *
 * A mini JS lexer tracks the states that decide whether a newline is content or
 * layout: `'`/`"` strings, `` ` `` template raw text, `${…}` expr nesting
 * (brace-counted, templates nest), `//` / `/* *​/` comments, AND **regex literals**
 * (incl. `[…]` char classes, where `/` does not close). Regex-vs-division is
 * disambiguated by the previous significant token: `/` divides iff the prior
 * non-space char is an operand-end (`ident`/digit/`)`/`]`/`}`/quote/backtick) and the
 * prior word is not a regex-preceding keyword (`return /re/`, `typeof /re/`, …);
 * otherwise it opens a regex. Without regex handling a `name.replace(/['"]/g, "")`
 * before a template desynced the lexer (the `'` inside the regex opened a phantom
 * string) and the template's continuation lines were blindly indented — a real,
 * silent, node-check-clean corruption on the most ordinary sanitizer.
 */
export function indentBodyLines(code: string, indent: string): string[] {
  const out: string[] = [];
  let line = "";
  const stack: Array<{ k: "code" | "expr" | "sq" | "dq" | "tmpl" | "lc" | "bc" | "regex" | "rclass"; brace: number }> = [{ k: "code", brace: 0 }];
  const top = () => stack[stack.length - 1];
  let indentThisLine = true;
  // Regex-vs-division disambiguation state (code/expr context only):
  let prevSig = "";  // last significant (non-space) char
  let word = "";     // the identifier run ending at prevSig (for keyword lookup)
  const flush = (nl: boolean): void => {
    out.push((indentThisLine ? indent : "") + line);
    line = "";
    if (nl) indentThisLine = top().k !== "tmpl";
  };
  for (let i = 0; i < code.length; i++) {
    const c = code[i], n = code[i + 1];
    if (c === "\n") {
      if (top().k === "lc") stack.pop(); // a `//` line comment ends at the newline
      flush(true);
      continue;
    }
    line += c;
    const t = top();
    if (t.k === "lc") {
      // inside a line comment — ignore every delimiter until the newline (above)
    } else if (t.k === "bc") {
      if (c === "*" && n === "/") { line += n; i++; stack.pop(); } // end of block comment
    } else if (t.k === "sq") {
      if (c === "\\") { if (n != null) { line += n; i++; } }
      else if (c === "'") { stack.pop(); prevSig = "'"; }
    } else if (t.k === "dq") {
      if (c === "\\") { if (n != null) { line += n; i++; } }
      else if (c === '"') { stack.pop(); prevSig = '"'; }
    } else if (t.k === "tmpl") {
      if (c === "\\") { if (n != null) { line += n; i++; } }
      else if (c === "`") { stack.pop(); prevSig = "`"; }
      else if (c === "$" && n === "{") { line += n; i++; stack.push({ k: "expr", brace: 0 }); prevSig = ""; word = ""; }
    } else if (t.k === "regex") {
      if (c === "\\") { if (n != null) { line += n; i++; } }
      else if (c === "[") { stack.push({ k: "rclass", brace: 0 }); }
      else if (c === "/") {
        stack.pop();
        while (i + 1 < code.length && /[a-z]/i.test(code[i + 1])) { line += code[i + 1]; i++; } // flags
        prevSig = "/"; // closing delim = operand end
      }
    } else if (t.k === "rclass") {
      if (c === "\\") { if (n != null) { line += n; i++; } }
      else if (c === "]") { stack.pop(); }
    } else { // "code" or "expr"
      if (c === "/" && n === "/") { line += n; i++; stack.push({ k: "lc", brace: 0 }); }
      else if (c === "/" && n === "*") { line += n; i++; stack.push({ k: "bc", brace: 0 }); }
      else if (c === "/") {
        const divides = /[A-Za-z0-9_$)\]}"'`]/.test(prevSig) && !REGEX_PRECEDING_KEYWORDS.has(word);
        if (!divides) stack.push({ k: "regex", brace: 0 });
        else prevSig = "/";
        word = "";
      }
      else if (c === "'") { stack.push({ k: "sq", brace: 0 }); word = ""; }
      else if (c === '"') { stack.push({ k: "dq", brace: 0 }); word = ""; }
      else if (c === "`") { stack.push({ k: "tmpl", brace: 0 }); word = ""; }
      else if (c === "{") { t.brace++; prevSig = "{"; word = ""; }
      else if (c === "}") { if (t.k === "expr" && t.brace === 0) stack.pop(); else t.brace--; prevSig = "}"; word = ""; }
      else if (/\s/.test(c)) { /* whitespace: keep prevSig/word */ }
      else {
        prevSig = c;
        if (/[A-Za-z0-9_$]/.test(c)) word += c; else word = "";
      }
    }
  }
  flush(false);
  return out;
}

/**
 * Replace `@varName` references in a CSS value string with CSS custom property
 * references: `var(--scrml-varName)`.
 *
 * @param value — raw CSS value text potentially containing @var refs
 * @returns CSS value with @var replaced by var(--scrml-varName)
 */
export function replaceCssVarRefs(value: string): string {
  return value.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, "var(--scrml-$1)");
}

export const VOID_ELEMENTS = new Set<string>([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * i81 — HTML BOOLEAN attributes, excluded from the reactive VALUE-attr emitter.
 *
 * A boolean attribute's semantics are carried by its PRESENCE, not its value:
 * `checked="false"` is still checked. Lowering one through the value path
 * (`setAttribute(name, String(v))`) is therefore actively WRONG — it would
 * render a `checked=(@isSelected)` checkbox permanently checked. Caught by R26
 * on examples/27-type-derived-table.scrml, where `<input checked=(@a && @b)>`
 * began emitting `setAttribute("checked", "false")`.
 *
 * These are NOT routed to the bool path either: `REACTIVE_BOOL_ATTRS`
 * (emit-html.ts) is a deliberate 3-element allowlist (disabled/readonly/
 * required) and widening it is a separate, out-of-scope decision — bool and
 * value are different lowerings. Excluding them here preserves the pre-i81
 * behavior (attribute dropped) rather than introducing a NEW wrong one.
 * Promoting the rest of this set onto the bool path is a follow-up.
 */
export const HTML_BOOLEAN_ATTRS = new Set<string>([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls",
  "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap",
  "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open",
  "playsinline", "readonly", "required", "reversed", "selected", "shadowrootclonable",
  "shadowrootdelegatesfocus", "shadowrootserializable",
]);

/**
 * A scrml function parameter — either a bare string (legacy "name:Type" form)
 * or a structured object produced by `parseParamList` in `ast-builder.js`.
 *
 * Structured shape (post-§7.3.2 — A3 default-parameter support):
 *   { name: string, typeAnnotation?: string, defaultValue?: string, isLin?: boolean, isRest?: boolean }
 *
 * Post-A5-FUP (2026-05-17): `name` may also be a structured DestructurePattern
 * AST node (`kind: "destructure-array" | "destructure-object"`) for params
 * shaped `function f([a, b])` or `function f({a, b})`. Codegen serializes
 * the pattern back to JS via emitDestructurePatternText.
 *
 * Param.defaultValue, when present, is the RAW source text of the default
 * expression (`"0"`, `"start"`, `'"hello"'`, `"() => 42"`). It compiles
 * directly into the emitted JS via `${name} = ${defaultValue}` per §7.3.2.
 */
export type ParamLike = string | {
  name?: unknown;
  typeAnnotation?: string;
  defaultValue?: string;
  isLin?: boolean;
  isRest?: boolean;
  [key: string]: unknown;
};

/**
 * Extract the bare parameter NAME (no type annotation, no default value).
 * Used at call sites (e.g. `fetchStub(${paramNames.join(", ")})`) where we
 * want the identifier only.
 *
 * Destructured params: returns a synthesized `_scrml_arg_N` placeholder since
 * the pattern has no single canonical name. Call sites that pass destructured
 * args to server-stubs need to switch to a separate argument-forwarding
 * strategy; the synthesized name preserves the existing JS-arity invariant.
 *
 * @param p the param entry from `fnNode.params`
 * @param i the param's index in the list (for synthesizing `_scrml_arg_N`)
 */
export function paramName(p: ParamLike, i: number): string {
  if (typeof p === "string") return p.split(":")[0].trim();
  if (typeof p.name === "string") return p.name;
  // Destructured (or otherwise non-string) param: use a synthetic placeholder.
  return `_scrml_arg_${i}`;
}

/**
 * Format ONE parameter for a function-DECLARATION signature.
 *
 * §7.3.2: default parameters compile directly to JavaScript default parameter
 * syntax. When `p.defaultValue` is present, the output is `name = defaultValue`;
 * otherwise the bare `name` is emitted. Rest-parameter (`...name`) prefix is
 * applied when `p.isRest === true`.
 *
 * A5-FUP (2026-05-17): when `p.name` is a structured DestructurePattern, the
 * pattern is serialized via emitDestructurePatternText for direct emission as
 * a JS destructuring binding pattern. Default-for-entire-pattern composes:
 * `function f({a, b} = {a: 0, b: 0})` → `function f({ a, b } = {a: 0, b: 0})`.
 *
 * NOT for call-site argument lists — use `paramName()` there.
 *
 * @param p the param entry from `fnNode.params`
 * @param i the param's index in the list (for synthesizing `_scrml_arg_N`)
 */
export function paramSignature(p: ParamLike, i: number): string {
  if (typeof p === "string") return p.split(":")[0].trim();
  const rest = p.isRest ? "..." : "";
  const def = typeof p.defaultValue === "string" && p.defaultValue.trim().length > 0
    ? ` = ${p.defaultValue}`
    : "";
  // A5-FUP: structured destructure-pattern in `p.name`. Serialize via the
  // shared codegen helper (also used by emit-logic / emit-control-flow /
  // emit-lift for let/const/for-stmt destructuring).
  if (p.name && typeof p.name === "object") {
    const pat = p.name as { kind?: unknown };
    if (pat.kind === "destructure-array" || pat.kind === "destructure-object") {
      return `${rest}${emitDestructurePatternText(pat as Parameters<typeof emitDestructurePatternText>[0])}${def}`;
    }
  }
  const name = typeof p.name === "string" ? p.name : `_scrml_arg_${i}`;
  return `${rest}${name}${def}`;
}
