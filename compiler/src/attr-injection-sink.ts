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
 *
 * A URL whose literal text commits to NO scheme (`href="${url}"`) is not refused here: the scheme comes
 * from the data, and §5.2 rule 3 (S457) guards it at RUNTIME instead — `quotedUrlAttrNeedsRuntimeGuard`
 * below tells the emitters which quoted values need `_scrml_safe_url`. The scheme reader and the scheme
 * sets live in `runtime-url-guard.js`, shared verbatim with that runtime guard.
 */

import {
  _SCRML_URL_VALUED_ATTRS,
  _SCRML_SAFE_URL_SCHEMES,
  _SCRML_SAFE_DATA_IMAGE_TYPES,
  _SCRML_IMAGE_SOURCE_ATTRS,
  _SCRML_SVG_ANIMATION_ELEMENTS,
  _SCRML_SVG_ANIMATION_VALUE_ATTRS,
  _scrml_is_url_attr,
  _scrml_read_url_scheme,
  _scrml_url_scheme_admitted,
  _scrml_url_value_admitted,
  _scrml_animation_value_admitted,
} from "./runtime-url-guard.js";
import { jsInterpolationEnd } from "./codegen/sql-lex.ts";


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

/*
 * The URL-attribute set, the safe-scheme set, the raster `data:image` set and the scheme reader are
 * DEFINED in `runtime-url-guard.js` — the one file the runtime URL guard (§5.2 rule 3, S457) inlines
 * verbatim — so the compile-time literal-prefix rule and the runtime data rule cannot drift. This module
 * re-exports them under their compile-time names.
 */

/**
 * Attributes whose value is a URL (or a list of URLs), lowercased, element-insensitive. The list and
 * its sources are documented at `_SCRML_URL_VALUED_ATTRS` in `runtime-url-guard.js`.
 */
export const URL_VALUED_ATTRS: ReadonlySet<string> = _SCRML_URL_VALUED_ATTRS;

/**
 * Schemes after which interpolated text is admitted (and which the runtime guard admits in data). A
 * scheme written LITERALLY in the attribute cannot be changed by the interpolation that follows it
 * (the literal `:` ends the scheme).
 */
export const SAFE_LITERAL_URL_SCHEMES: ReadonlySet<string> = _SCRML_SAFE_URL_SCHEMES;

/** Raster image media types a `data:` URL may name on an image-loading attribute. */
export const SAFE_DATA_IMAGE_TYPES: ReadonlySet<string> = _SCRML_SAFE_DATA_IMAGE_TYPES;

/** Attributes whose URL is loaded as an image source (where a raster `data:` image is admitted). */
export const IMAGE_SOURCE_ATTRS: ReadonlySet<string> = _SCRML_IMAGE_SOURCE_ATTRS;

/**
 * What a scheme test over a literal URL prefix found. `rest` is the normalized text after `:`.
 * `relative` — the literal text can no longer begin with a scheme (a `/`, `?` or `#` came first, or the
 * run before `:` is not a scheme): whatever the interpolation supplies stays a relative URL.
 * `none` — the literal text commits to nothing (`""`, `java`): the interpolated DATA can supply the
 * scheme. Such a value is admitted at compile time and guarded at runtime (§5.2 rule 3).
 */
export type LiteralUrlScheme =
  | { kind: "none" }
  | { kind: "relative" }
  | { kind: "scheme"; scheme: string; rest: string }
  | { kind: "unprovable"; reason: string };

/**
 * Read the scheme the LITERAL text `prefix` (the attribute value up to its first `${`) commits the
 * URL to — the shared reader `_scrml_read_url_scheme` with escape decoding ON: the top-level lowering
 * puts the text into a JS template literal, which decodes `\x6a`, `\u{6a}` and `\t`, and an entity such
 * as `&#106;` is the HTML spelling of a scheme letter, so a `\` or `&` before the scheme ends is
 * `unprovable` (refused rather than decoded).
 */
export function readLiteralUrlScheme(prefix: string): LiteralUrlScheme {
  return _scrml_read_url_scheme(String(prefix ?? ""), true) as LiteralUrlScheme;
}

/**
 * Index of the first `${` in a quoted attribute value, counting the tokenizer-spaced `$ {` spelling
 * some lowerings also interpolate; -1 when there is none.
 */
export function firstInterpolationIndex(value: string): number {
  const m = /\$\s*\{/.exec(String(value ?? ""));
  return m ? m.index : -1;
}

/**
 * §5.2 rule 3 (S457) — does the QUOTED URL-valued attribute `name="value"` need the RUNTIME scheme
 * guard? True when the value interpolates `${…}` and its literal text before the first interpolation
 * commits to NO scheme (`readLiteralUrlScheme` kind `none`: `href="${url}"`, `src="java${x}"`). A
 * literal prefix that proves a relative URL or a safe scheme needs no guard (its emitted write stays
 * byte-identical); an unsafe or unprovable one is refused at compile time (rule 2) and never emitted.
 */
export function quotedUrlAttrNeedsRuntimeGuard(name: string, value: string): boolean {
  if (typeof name !== "string" || typeof value !== "string") return false;
  if (!URL_VALUED_ATTRS.has(name.toLowerCase())) return false;
  const at = firstInterpolationIndex(value);
  if (at < 0) return false;
  return readLiteralUrlScheme(value.slice(0, at)).kind === "none";
}

// ---------------------------------------------------------------------------
// SVG animation value attributes (S457)
// ---------------------------------------------------------------------------

/** The element an attribute sits on, when the caller knows it: its tag and its attribute list. */
export interface AttrElementContext {
  tag?: string | null;
  attrs?: ReadonlyArray<unknown> | null;
}

/**
 * §5.2 (S457) — is attribute `name` of element `tag` an SVG animation VALUE (`to`, `from`, `by`,
 * `values` on `<set>`, `<animate>`, `<animateTransform>`, `<animateMotion>`, `<animateColor>`) that
 * writes a URL-valued attribute? `<a><set attributeName="href" to="${u}"/></a>` animates the link's
 * href to the data, so the value is a URL-attribute write (rules 2 and 3), judged as a URL of the
 * animated attribute.
 *
 * Returns:
 *   - the lowercased animated attribute (`"href"`, `"xlink:href"`, `"src"`, …) when `attributeName` is
 *     written literally and names a URL-valued attribute (by name, on any element — the target element
 *     is not known here, so fail closed);
 *   - `""` when `attributeName` is computed (an expression, a variable, a call, or a quoted value with
 *     `${…}`): any attribute may be animated, so the value is treated as a URL (fail closed);
 *   - `null` otherwise (not an animation element / value attribute, no `attributeName`, or a literal
 *     `attributeName` that is not a URL attribute) — an ordinary attribute.
 * Element tags compare case-insensitively (`animateTransform`).
 */
export function animationUrlTarget(
  tag: string | null | undefined,
  name: string,
  attrs: ReadonlyArray<unknown> | null | undefined,
): string | null {
  if (typeof tag !== "string" || typeof name !== "string") return null;
  if (!_SCRML_SVG_ANIMATION_ELEMENTS.has(tag.toLowerCase())) return null;
  if (!_SCRML_SVG_ANIMATION_VALUE_ATTRS.has(name.toLowerCase())) return null;
  // Every `attributeName` is read (a duplicate is fail-closed: the HTML parser keeps the first, a later
  // `setAttribute` the last — any one that names a URL attribute or is computed decides).
  let result: string | null = null;
  for (const a of attrs ?? []) {
    const attr = a as { name?: unknown; value?: unknown } | null;
    if (!attr || typeof attr.name !== "string" || attr.name.toLowerCase() !== "attributename") continue;
    // `lift`'s attribute-string path (emit-lift.js `parseAttrs`) carries the value as a plain string,
    // which that path writes as a static literal.
    const rawValue: unknown = attr.value;
    const v: { kind?: string; value?: unknown } | undefined = typeof rawValue === "string"
      ? { kind: "string-literal", value: rawValue }
      : (rawValue as { kind?: string; value?: unknown } | undefined);
    if (!v || v.kind === "absent") continue;
    if (v.kind === "string-literal" && typeof v.value === "string" && firstInterpolationIndex(v.value) < 0) {
      const target = v.value.trim().toLowerCase();
      if (_scrml_is_url_attr("", target) && result === null) result = target;
      continue;
    }
    return ""; // computed: any attribute may be animated
  }
  return result;
}

/**
 * The literal text before each interpolation that STARTS a `;`-separated entry of an animation `values`
 * list (or the whole value, for `to` / `from` / `by`): the text the scheme test reads. An entry whose text
 * before its first `${` holds an earlier interpolation is data-led (no literal prefix to judge; the
 * runtime guard reads it). `${…}` extents are read with `jsInterpolationEnd` (the shared slot reader);
 * when an extent cannot be read the scan stops — what follows stays runtime-guarded.
 */
function animationLiteralPrefixes(lowerName: string, value: string): string[] {
  const prefixes: string[] = [];
  let entryStart = 0;
  let entryHasSlot = false;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "$" && value[i + 1] === "{") {
      if (!entryHasSlot) prefixes.push(value.slice(entryStart, i));
      entryHasSlot = true;
      const end = jsInterpolationEnd(value, i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (ch === ";" && lowerName === "values") {
      entryStart = i + 1;
      entryHasSlot = false;
    }
    i++;
  }
  return prefixes;
}

/**
 * Rule 2 for an SVG animation value: does a quoted `to="…${x}"` / `values="…;javascript:${x}"` commit an
 * interpolation to an unsafe or unprovable LITERAL scheme? `target` is `animationUrlTarget`'s answer
 * ("" = computed `attributeName`: judged as a URL on an unknown attribute, so no raster `data:` image).
 */
function classifyAnimationValue(lowerName: string, value: string, target: string): InterpolatedAttrSink | null {
  for (const prefix of animationLiteralPrefixes(lowerName, value)) {
    const r = readLiteralUrlScheme(prefix);
    if (r.kind === "unprovable") return { kind: "url-unprovable", reason: r.reason };
    if (r.kind === "scheme" && !_scrml_url_scheme_admitted(target, r.scheme, r.rest)) {
      return { kind: "url-scheme", scheme: r.scheme };
    }
  }
  return null;
}

/**
 * §5.2 rule 3 for an SVG animation value: does the QUOTED `name="value"` need the runtime guard? `values`
 * is guarded whenever it interpolates (any entry after a `;` may be data-led); `to` / `from` / `by` when
 * the literal text before the first interpolation commits to no scheme, as for any URL attribute.
 */
export function quotedAnimationValueNeedsRuntimeGuard(name: string, value: string): boolean {
  if (typeof name !== "string" || typeof value !== "string") return false;
  const at = firstInterpolationIndex(value);
  if (at < 0) return false;
  if (name.toLowerCase() === "values") return true;
  return readLiteralUrlScheme(value.slice(0, at)).kind === "none";
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
export function classifyInterpolatedAttrSink(
  name: string,
  value: string,
  element?: AttrElementContext | null,
): InterpolatedAttrSink | null {
  if (typeof name !== "string" || typeof value !== "string") return null;
  const at = value.indexOf("${");
  if (at < 0) return null;
  if (isExecutableEventHandlerAttrName(name)) return { kind: "event-handler" };
  const lower = name.toLowerCase();
  if (lower === "srcdoc") return { kind: "srcdoc" };
  // S457 — an SVG animation value that writes a URL attribute (`<set attributeName="href" to="…">`).
  const target = element ? animationUrlTarget(element.tag, name, element.attrs) : null;
  if (target !== null) return classifyAnimationValue(lower, value, target);
  if (URL_VALUED_ATTRS.has(lower)) {
    const r = readLiteralUrlScheme(value.slice(0, at));
    if (r.kind === "unprovable") return { kind: "url-unprovable", reason: r.reason };
    if (r.kind === "scheme" && !_scrml_url_scheme_admitted(lower, r.scheme, r.rest)) {
      return { kind: "url-scheme", scheme: r.scheme };
    }
  }
  return null;
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
 * SPEC §5.2 rule 1 (S464) — a QUOTED event-handler attribute with no `${…}` (`onclick="alert(1)"`).
 * The browser would run its text as raw JavaScript, unchecked by scrml. (Code name owner-ruled,
 * S464.)
 */
export const ATTR_QUOTED_HANDLER_CODE = "E-ATTR-QUOTED-HANDLER";

/**
 * §5.2 rule 1 (S464) — is the QUOTED `name="value"` a static event-handler text? True when `name` is
 * an event-handler attribute by rule 1's name test (`isExecutableEventHandlerAttrName` — the one
 * reader) and `value` holds no `${…}` (a value with `${…}` is `classifyInterpolatedAttrSink`'s
 * `event-handler` refusal instead).
 */
export function isQuotedStaticHandler(name: string, value: string): boolean {
  if (typeof name !== "string" || typeof value !== "string") return false;
  if (value.indexOf("${") >= 0) return false;
  return isExecutableEventHandlerAttrName(name);
}

/**
 * §5.2 (S464 "(a) Refuse both") — a STATIC attribute value (no `${…}`) the browser would EXECUTE:
 * any `srcdoc`, or a URL-valued attribute (element-scoped as rule 3 scopes it; an SVG animation value
 * when `attributeName` names a URL attribute or is not static) whose scheme rule 2's safe set does not
 * admit (`<a href="javascript:…">`, `vbscript:`, `data:text/html`). (Code name provisional — the
 * owner's call.)
 */
export const ATTR_STATIC_EXECUTABLE_CODE = "E-ATTR-STATIC-EXECUTABLE";

export type StaticExecutableSink =
  | { kind: "srcdoc" }
  | { kind: "url-scheme"; scheme: string | null };

/**
 * Is the STATIC `name="value"` (a value holding no `${…}`) on the element `element` an executable
 * sink? The URL judgment is the RUNTIME guard's, applied to the literal value — the value written is
 * exactly the author's text (HTML output escapes `&`, so no entity is decoded): `_scrml_url_value_admitted`
 * (srcset / ping / archive lists judged per entry) and `_scrml_animation_value_admitted` (`values` per
 * `;` entry), with rule 2's safe set and scheme reader — one definition. A relative URL or a value with
 * no scheme is admitted. When the element is not known the URL-attribute set is read element-insensitive
 * (fail closed).
 */
export function classifyStaticExecutableAttr(
  name: string,
  value: string,
  element?: AttrElementContext | null,
): StaticExecutableSink | null {
  if (typeof name !== "string" || typeof value !== "string") return null;
  if (value.indexOf("${") >= 0) return null; // the interpolated form is classifyInterpolatedAttrSink's
  const lower = name.toLowerCase();
  if (lower === "srcdoc") return { kind: "srcdoc" };
  const schemeOf = (text: string): string | null => {
    const r = _scrml_read_url_scheme(text, false) as { kind: string; scheme?: string };
    return r.kind === "scheme" && typeof r.scheme === "string" ? r.scheme : null;
  };
  const target = element ? animationUrlTarget(element.tag, name, element.attrs) : null;
  if (target !== null) {
    if (_scrml_animation_value_admitted(lower, value, target)) return null;
    const bad = (lower === "values" ? value.split(";") : [value])
      .find((v) => !_scrml_url_value_admitted(target, v));
    return { kind: "url-scheme", scheme: bad !== undefined ? schemeOf(bad) : null };
  }
  const tag = element && typeof element.tag === "string" ? element.tag : "";
  if (!_scrml_is_url_attr(tag, lower)) return null;
  if (_scrml_url_value_admitted(lower, value)) return null;
  return { kind: "url-scheme", scheme: schemeOf(value) };
}

/** The author-facing message for a static executable attribute value (S464). */
export function staticExecutableMessage(
  sink: StaticExecutableSink,
  name: string,
  tag: string,
  where = "",
): string {
  const on = (tag ? ` on \`<${tag}>\`` : "") + (where ? ` ${where}` : "");
  const head = `${ATTR_STATIC_EXECUTABLE_CODE}: the \`${name}="…"\` attribute` + on;
  if (sink.kind === "srcdoc") {
    return head + " is an inline HTML document (`srcdoc`), which the browser runs — script included — " +
      "without scrml checking it. Point the frame at a page with `src=` instead (§5.2).";
  }
  return head + " is a URL" + (sink.scheme ? ` whose scheme is \`${sink.scheme}:\`` : " whose scheme is not admitted") +
    ". A URL attribute may name `http:`, `https:`, `ftp:`, `mailto:`, `tel:` or `sms:` (and, on an image " +
    "source, a raster `data:image/…`), or be relative; any other scheme (`javascript:`, `vbscript:`, " +
    "`data:text/html`, …) runs code scrml never checked. For behaviour, use an event handler " +
    "(`onclick=fn()`) (§5.2).";
}

/** The author-facing message for a quoted static event-handler attribute (S464). */
export function quotedHandlerMessage(name: string, tag: string, where = ""): string {
  const on = (tag ? ` on \`<${tag}>\`` : "") + (where ? ` ${where}` : "");
  return `${ATTR_QUOTED_HANDLER_CODE}: the quoted \`${name}="…"\` attribute` + on +
    " is an event handler written as a string. scrml does not hand quoted text to the browser to " +
    "run as JavaScript — an event attribute takes logic, unquoted: a call `" + name + "=fn()`, an " +
    "inline block `" + name + "={ … }`, or an expression `" + name + "=${…}` (§5.2, §5.2.3).";
}

/**
 * §5.2 (S457) — a value that is not a static string, written into an attribute the browser EXECUTES
 * in every form: `srcdoc` (an HTML document — script included) and an event-handler attribute
 * (handler text). `srcdoc=${@doc}`, `srcdoc=@doc`, `srcdoc=fn()`, an `<each>` row's `srcdoc=it.html`
 * and a component prop that reaches a `srcdoc` all put data into a document, exactly as the quoted
 * `srcdoc="${…}"` form does.
 *
 * The sanctioned UNQUOTED event forms (`onclick=f(x)`, `onclick=${() => f(x)}`) are wired as
 * listeners and never write the attribute; an emitter that would instead WRITE an event attribute's
 * value (a name it does not wire, e.g. `ONCLICK=${…}`, `onClick=` in `lift` markup) asks this at the
 * write. Returns the sink, or null for any other attribute.
 */
export function executableDataWriteSink(name: string): InterpolatedAttrSink | null {
  if (typeof name !== "string") return null;
  if (name.toLowerCase() === "srcdoc") return { kind: "srcdoc" };
  if (isExecutableEventHandlerAttrName(name)) return { kind: "event-handler" };
  return null;
}

/**
 * The author-facing message for a refusal. `where` names the position when the caller knows
 * it (e.g. "inside an `<each>` row"); empty otherwise. `form` is `"quoted"` for a quoted value
 * with `${…}` (the classifier above) and `"data"` for a value that is wholly data — an expression,
 * a variable, a call, a component prop (`executableDataWriteSink`).
 */
export function interpolatedAttrSinkMessage(
  sink: InterpolatedAttrSink,
  name: string,
  tag: string,
  where = "",
  form: "quoted" | "data" = "quoted",
): string {
  const on = (tag ? ` on \`<${tag}>\`` : "") + (where ? ` ${where}` : "");
  if (form === "data") {
    const head = `${ATTR_INTERP_EXECUTABLE_CODE}: the \`${name}=\` attribute` + on +
      " takes its value from data (an expression, a variable, a call or a component prop)";
    if (sink.kind === "srcdoc") {
      return head + ", and `srcdoc` is an HTML document — data written there can carry script. " +
        "scrml admits no `srcdoc` value at all (S464 — a static one is E-ATTR-STATIC-EXECUTABLE). Build the " +
        "frame from a URL (`src=`) or render the content as markup in the page (§5.2).";
    }
    // The spelling every emitter wires as a listener: `on` + the lowercase event name.
    const wired = "on" + name.slice(2).replace(/^[:\-]/, "").toLowerCase();
    return head + ", and it would be written as event-handler TEXT, which the browser compiles as " +
      "JavaScript. JavaScript is never built from data. Write the event attribute in lowercase " +
      `(\`${wired}=f(x)\` or \`${wired}=\${() => f(x)}\`) so it is wired as a listener (§5.2).`;
  }
  const head = `${ATTR_INTERP_EXECUTABLE_CODE}: the quoted \`${name}="…"\` attribute` + on +
    " interpolates `${…}`";
  switch (sink.kind) {
    case "event-handler":
      return head + " into event-handler text. JavaScript is never built from interpolated text " +
        "— a value can close a string and run code on the event. Pass the value as data: the " +
        `unquoted call form \`${name}=f(x)\` or an expression handler \`${name}=\${() => f(x)}\` (§5.2).`;
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
