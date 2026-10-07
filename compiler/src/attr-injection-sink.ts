/**
 * attr-injection-sink — the ONE reader that decides whether a QUOTED attribute value's
 * `${…}` interpolation lands in a place the browser EXECUTES (SPEC §5.2 executable-sink rule, S456 ruling
 * "your recs on 1 and 2").
 *
 * A quoted attribute value containing `${…}` is compiled to a template literal written with
 * `setAttribute` (§5.5.3, §4.18). Three attribute families turn that text into code:
 *
 *   1. an EVENT-HANDLER attribute (`onclick="…"`, any case, `on:`/`onserver:`/`onclient:`): the
 *      browser compiles the attribute's text as a JavaScript function body. Interpolated data
 *      can close a string literal and run code on the event.
 *   2. `srcdoc` (iframe): the text is a whole HTML document — script included.
 *   3. a URL-valued attribute whose literal text BEGINS WITH A SCHEME other than a fixed safe
 *      one (`javascript:`, `vbscript:`, `data:`, `blob:`, …): the data lands inside a URL whose
 *      scheme makes it executable (`javascript:go('${x}')`).
 *
 * Callers: VP-3 (`validators/attribute-interpolation.ts`, the attribute-interpolation pass —
 * the refusal point for every markup position) and the `<each>` row attribute lowering in
 * `codegen/emit-each.ts` (a backstop that asks the SAME question). Do not write a second
 * classifier: both paths call `classifyInterpolatedAttrSink`.
 *
 * Fail-closed choices (each named at its site): any `on…` attribute name counts as a handler;
 * the URL-attribute set is element-insensitive; a scheme is refused unless it is in the
 * fixed safe set; a backslash or `&` before the scheme terminator is refused because the
 * emitted template literal decodes JS escapes (`\x6a` → `j`) and the scheme can then not be
 * proven.
 */

// ---------------------------------------------------------------------------
// Event-handler attribute name (fail closed)
// ---------------------------------------------------------------------------

/**
 * SAFETY predicate — is `name` an event-handler attribute as the BROWSER sees it? HTML
 * attribute names are case-insensitive (`ONCLICK`, `OnClick` and `onclick` are the same live
 * handler), so this decides case-INSENSITIVELY and fails closed: ANY `on…` name counts, known
 * event or not, which also covers the `on:` directive and the `onserver:` / `onclient:` channel
 * handlers. (Moved here from `codegen/emit-each.ts`, s456 review round 3, where
 * `ONCLICK="hit('${it.name}')"` bypassed a case-sensitive test.) This is NOT
 * `multi-statement-scan.ts`'s `isEventHandlerAttrName`, which recognises the handler SHAPES the
 * parser lowers (`on[a-z]+`) and is deliberately narrower.
 */
export function isEventHandlerAttrNameFailClosed(name: string): boolean {
  if (typeof name !== "string") return false;
  return name.length > 2 && name.slice(0, 2).toLowerCase() === "on";
}

// ---------------------------------------------------------------------------
// URL-valued attributes
// ---------------------------------------------------------------------------

/**
 * Attributes whose value is a URL (or a list that begins with one), lowercased. Element-
 * insensitive on purpose (fail closed): `href` is a URL on `<a>`, `<area>`, `<link>`, `<base>`
 * and SVG/MathML elements alike.
 *
 * Source: the HTML Living Standard attribute index (§ "Attributes", index of the HTML
 * attributes) — every attribute whose value is a "valid URL potentially surrounded by
 * spaces", a "valid non-empty URL", or a set/list of them: `action`, `cite`, `data`,
 * `formaction`, `href`, `itemid`, `itemtype`, `manifest`, `ping`, `poster`, `src`, `srcset`,
 * `imagesrcset`; plus the URL-valued attributes of § "Obsolete features" that browsers still
 * parse (`archive`, `background`, `classid`, `codebase`, `dynsrc`, `longdesc`, `lowsrc`,
 * `profile`, `icon`, `usemap`), and SVG/XML `xlink:href` / `xml:base`.
 */
export const URL_VALUED_ATTRS: ReadonlySet<string> = new Set([
  "action",
  "archive",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "dynsrc",
  "formaction",
  "href",
  "icon",
  "imagesrcset",
  "itemid",
  "itemtype",
  "longdesc",
  "lowsrc",
  "manifest",
  "ping",
  "poster",
  "profile",
  "src",
  "srcset",
  "usemap",
  "xlink:href",
  "xml:base",
]);

/**
 * Schemes after which interpolated text is admitted. A scheme written LITERALLY in the
 * attribute cannot be changed by the interpolation that follows it (the literal `:` ends the
 * scheme), and none of these schemes executes the URL's text as script in any URL attribute:
 * `http:` / `https:` fetch or navigate, `mailto:` / `tel:` hand off to an external handler.
 * Every other scheme — `javascript:`, `vbscript:`, `data:` (an `<iframe src>` / `<object data>`
 * of `data:text/html` runs script), `blob:` (same-origin document), and any scheme not named
 * here — is refused (fail closed).
 */
export const SAFE_LITERAL_URL_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"]);

/** What a scheme test over a literal URL prefix found. */
export type LiteralUrlScheme =
  | { kind: "none" }
  | { kind: "scheme"; scheme: string }
  | { kind: "unprovable"; reason: string };

/**
 * Read the scheme the LITERAL text `prefix` (the attribute value up to its first `${`)
 * commits the URL to, the way the WHATWG URL parser will read the runtime string:
 *  - leading C0 controls and spaces are stripped (URL parser, "remove any leading C0 control
 *    or space");
 *  - ASCII tab / LF / CR are removed anywhere (URL parser, "remove all ASCII tab or newline"),
 *    so `java<TAB>script:` IS `javascript:`;
 *  - the scheme is the run before the first `:` when that run is `ALPHA *( ALPHA / DIGIT /
 *    "+" / "-" / "." )` and no `/`, `?` or `#` came first; it is compared lowercased.
 *  - a `\` or `&` before the scheme terminator is UNPROVABLE: the top-level lowering puts the
 *    text into a JS template literal, which decodes `\x6a` / `j` / `\t`, and an entity
 *    such as `&#106;` is the HTML spelling of a scheme letter. Neither is ever needed in a
 *    real scheme, so it is refused rather than decoded.
 * `{kind:"none"}` means the literal text commits to NO scheme (a relative URL such as
 * `/users/`, or a prefix the interpolation itself completes, as in `href="${url}"` — a
 * data-supplied scheme, which the §5.2 executable-sink rule does not cover; open gap
 * g-quoted-url-attribute-data-supplied-scheme-s456).
 */
export function readLiteralUrlScheme(prefix: string): LiteralUrlScheme {
  let s = String(prefix ?? "");
  let start = 0;
  while (start < s.length && s.charCodeAt(start) <= 0x20) start++;
  s = s.slice(start).replace(/[\t\n\r]/g, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" || c === "&") {
      return { kind: "unprovable", reason: c === "\\" ? "an escape sequence (`\\`)" : "a character reference (`&`)" };
    }
    if (c === "/" || c === "?" || c === "#") return { kind: "none" };
    if (c === ":") {
      const candidate = s.slice(0, i);
      if (/^[A-Za-z][A-Za-z0-9+.\-]*$/.test(candidate)) {
        return { kind: "scheme", scheme: candidate.toLowerCase() };
      }
      return { kind: "none" };
    }
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

export type InterpolatedAttrSink =
  | { kind: "event-handler" }
  | { kind: "srcdoc" }
  | { kind: "url-scheme"; scheme: string }
  | { kind: "url-unprovable"; reason: string };

/**
 * Does the QUOTED attribute `name="value"` interpolate `${…}` into an executable sink?
 * Returns null when it does not (no `${`, or an attribute that is not one of the three
 * families, or a URL whose literal scheme is safe / absent).
 */
export function classifyInterpolatedAttrSink(name: string, value: string): InterpolatedAttrSink | null {
  if (typeof name !== "string" || typeof value !== "string") return null;
  const at = value.indexOf("${");
  if (at < 0) return null;
  if (isEventHandlerAttrNameFailClosed(name)) return { kind: "event-handler" };
  const lower = name.toLowerCase();
  if (lower === "srcdoc") return { kind: "srcdoc" };
  if (URL_VALUED_ATTRS.has(lower)) {
    const r = readLiteralUrlScheme(value.slice(0, at));
    if (r.kind === "unprovable") return { kind: "url-unprovable", reason: r.reason };
    if (r.kind === "scheme" && !SAFE_LITERAL_URL_SCHEMES.has(r.scheme)) {
      return { kind: "url-scheme", scheme: r.scheme };
    }
  }
  return null;
}

/** The diagnostic code for every refusal this module decides (SPEC §34). */
export const ATTR_INTERP_EXECUTABLE_CODE = "E-ATTR-INTERP-EXECUTABLE";

/**
 * The author-facing message for a refusal. `where` names the position when the caller knows
 * it (e.g. "inside an `<each>` row"); empty otherwise.
 */
export function interpolatedAttrSinkMessage(
  sink: InterpolatedAttrSink,
  name: string,
  tag: string,
  where = "",
): string {
  const head = `${ATTR_INTERP_EXECUTABLE_CODE}: the quoted \`${name}="…"\` attribute` +
    (tag ? ` on \`<${tag}>\`` : "") + (where ? ` ${where}` : "") + " interpolates `${…}`";
  switch (sink.kind) {
    case "event-handler":
      return head + " into event-handler text. JavaScript is never built from interpolated text " +
        "— a value can close a string and run code on the event. Pass the value as data: the " +
        `unquoted call form \`${name}=f(x)\` or an expression handler \`${name}=\${() => f(x)}\`. ` +
        "A quoted event attribute with no `${…}` stays a static string (§5.2).";
    case "srcdoc":
      return head + " into an iframe `srcdoc`, which is an HTML document — interpolated text " +
        "there can carry script. Build the frame from a URL (`src=`) or render the content as " +
        "markup in the page (§5.2).";
    case "url-scheme":
      return head + ` into a URL whose literal scheme is \`${sink.scheme}:\`. Data interpolated ` +
        "after an executable scheme (`javascript:`, `vbscript:`, `data:`, …) runs as code. Only " +
        "`http:`, `https:`, `mailto:` and `tel:` may precede an interpolation; for a handler, use " +
        `an event attribute (\`onclick=f(x)\`) instead of a \`javascript:\` URL (§5.2).`;
    case "url-unprovable":
      return head + ` into a URL whose scheme cannot be determined from the literal text: it ` +
        `contains ${sink.reason} before the scheme ends, and the compiled value decodes it. ` +
        "Write the scheme (or a path starting with `/`, `?` or `#`) as plain text (§5.2).";
  }
}
