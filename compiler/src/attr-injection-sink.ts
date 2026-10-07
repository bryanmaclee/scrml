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
 * Callers (all through `collectExecutableSinkErrors` or directly): VP-3 (post-CE — every
 * markup position, expanded component instances judged on their SUBSTITUTED values), the same
 * check re-run after ME (meta-emitted markup), the component expander (definition bodies), and
 * the `<each>` row attribute lowering in `codegen/emit-each.ts` (a backstop). Do not write a
 * second classifier: every path calls `classifyInterpolatedAttrSink`.
 *
 * Fail-closed choices (each named at its site): every `on…` attribute counts as a handler except
 * the closed `NON_EVENT_ON_WORDS` list (`one`, `online`, `onboarding`); the URL-attribute set is element-insensitive; a scheme is refused unless it is in the
 * fixed safe set; a backslash or `&` before the scheme terminator is refused because the
 * emitted template literal decodes JS escapes (`\x6a` → `j`) and the scheme can then not be
 * proven.
 */

// ---------------------------------------------------------------------------
// Event-handler attribute name (fail closed)
// ---------------------------------------------------------------------------

/**
 * The CLOSED list of `on…` attribute names that are ordinary English words, not event handlers
 * (S456 review round 2, N1). Matched by EXACT, case-insensitive whole-name equality — never by
 * prefix — so `onerror` / `onended` (which begin with `one`) stay handlers, and a new browser
 * event can only fall in here if it is literally named `e`, `line` or `boarding`.
 *  - `one`        — `on` + `e`: no DOM event is named `e`.
 *  - `online`     — `on` + `line`: the handler is `ononline` (event `online`); `online=` itself
 *                   is not one. No DOM event is named `line`.
 *  - `onboarding` — `on` + `boarding`: no DOM event is named `boarding`.
 * Keep it short and grep-able. Adding a word needs the same check: `word.slice(2)` is not, and
 * is not plausibly going to be, an event name.
 */
export const NON_EVENT_ON_WORDS: ReadonlySet<string> = new Set(["one", "online", "onboarding"]);

/**
 * SAFETY predicate — would a quoted `name="…"` attribute's text be executed as JavaScript?
 * INVERTED, fail closed (S456 review round 2, N1): EVERY attribute whose lowercased name begins
 * with `on` is an event-handler attribute — `onclick`, `ONCLICK`, `onbegin` / `onend` (SVG
 * animation, run on load), `onscrollsnapchange`, an event no list knows yet, scrml's `on:…`,
 * `onserver:…`, `onclient:…` — EXCEPT the exact names in `NON_EVENT_ON_WORDS`. A deny-list of
 * executable names (round 1's F3a) missed 19 Chromium handlers; browsers add events, so the
 * name set cannot be enumerated. The bare name `on` (no event part) is not a handler. This is NOT
 * `multi-statement-scan.ts`'s `isEventHandlerAttrName`, which recognises the UNQUOTED handler
 * shapes the parser lowers.
 */
export function isExecutableEventHandlerAttrName(name: string): boolean {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  if (lower.length <= 2 || !lower.startsWith("on")) return false;
  return !NON_EVENT_ON_WORDS.has(lower);
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
 * `http:` / `https:` / `ftp:` fetch or navigate, `mailto:` / `tel:` / `sms:` hand off to an
 * external handler. Every other scheme — `javascript:`, `vbscript:`, `data:` (an `<iframe src>`
 * / `<object data>` of `data:text/html` runs script; see `SAFE_DATA_IMAGE_TYPES` for the one
 * admitted `data:` shape), `blob:` (same-origin document), and any scheme not named here — is
 * refused (fail closed).
 */
export const SAFE_LITERAL_URL_SCHEMES: ReadonlySet<string> = new Set([
  "http", "https", "ftp", "mailto", "tel", "sms",
]);

/**
 * Raster image media types a `data:` URL may LITERALLY name before an interpolation, on an
 * image-loading attribute (`IMAGE_SOURCE_ATTRS`). A raster image is decoded, never executed —
 * `<img src="data:image/png;base64,${b64}">`. `image/svg+xml` is NOT here (SVG is a document that
 * can carry script), nor is any non-image type.
 */
export const SAFE_DATA_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "image/x-icon", "image/vnd.microsoft.icon",
]);

/** Attributes whose URL is loaded as an image source (where a raster `data:` image is admitted). */
export const IMAGE_SOURCE_ATTRS: ReadonlySet<string> = new Set(["src", "srcset", "imagesrcset", "poster"]);

/** What a scheme test over a literal URL prefix found. `rest` is the normalized text after `:`. */
export type LiteralUrlScheme =
  | { kind: "none" }
  | { kind: "scheme"; scheme: string; rest: string }
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
 *    text into a JS template literal, which decodes `\x6a`, `\u{6a}` and `\t`, and an entity
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
        return { kind: "scheme", scheme: candidate.toLowerCase(), rest: s.slice(i + 1) };
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
  if (isExecutableEventHandlerAttrName(name)) return { kind: "event-handler" };
  const lower = name.toLowerCase();
  if (lower === "srcdoc") return { kind: "srcdoc" };
  if (URL_VALUED_ATTRS.has(lower)) {
    const r = readLiteralUrlScheme(value.slice(0, at));
    if (r.kind === "unprovable") return { kind: "url-unprovable", reason: r.reason };
    if (r.kind === "scheme" && !SAFE_LITERAL_URL_SCHEMES.has(r.scheme)) {
      if (r.scheme === "data" && IMAGE_SOURCE_ATTRS.has(lower) && literalDataImageIsRaster(r.rest)) return null;
      return { kind: "url-scheme", scheme: r.scheme };
    }
  }
  return null;
}

/**
 * Does the literal text after `data:` commit to a raster image media type? The media type
 * must be COMPLETE in the literal text — terminated by `;` or `,` before the interpolation — so
 * the data cannot extend it (`data:image/png${x}` and `data:image/${t};…` are refused).
 */
function literalDataImageIsRaster(rest: string): boolean {
  const m = /^([^;,]*)[;,]/.exec(rest);
  if (!m) return false;
  return SAFE_DATA_IMAGE_TYPES.has(m[1].trim().toLowerCase());
}

/**
 * Identity of one source attribute (its own span + name), carried on every refusal as
 * `attrSinkKey` so api.js reports an attribute once across VP-3 / post-ME / the `<each>` backstop.
 */
export function attrSinkKey(
  own: { file?: unknown; start?: unknown; end?: unknown } | null | undefined,
  name: string,
  filePath = "",
): string {
  return `${(own && own.file) ?? filePath}:${own?.start}:${own?.end}:${name}`;
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
        "`http:`, `https:`, `ftp:`, `mailto:`, `tel:` and `sms:` — and, on an image source " +
        "attribute, a raster `data:image/png|jpeg|gif|webp|avif|bmp|x-icon` — may precede an " +
        "interpolation; for a handler, use " +
        `an event attribute (\`onclick=f(x)\`) instead of a \`javascript:\` URL (§5.2).`;
    case "url-unprovable":
      return head + ` into a URL whose scheme cannot be determined from the literal text: it ` +
        `contains ${sink.reason} before the scheme ends, and the compiled value decodes it. ` +
        "Write the scheme (or a path starting with `/`, `?` or `#`) as plain text (§5.2).";
  }
}
