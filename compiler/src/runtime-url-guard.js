// SPEC §5.2 — the URL scheme reader and the runtime URL-attribute guard (S456 rule 2, S457 rule 3).
//
// ONE source for both halves of the rule:
//   - the COMPILER reads it as an ES module: `attr-injection-sink.ts` takes the URL-valued attribute
//     set, the safe-scheme set and `_scrml_read_url_scheme` from here, to judge the LITERAL text of a
//     quoted attribute before its first `${` (compile-time refusal, E-ATTR-INTERP-EXECUTABLE);
//   - the RUNTIME inlines this file's source verbatim (`export ` stripped, runtime-template.js chunk
//     'urlguard'; emit-ssr-render.ts for the server's first-paint rows) and calls `_scrml_safe_url` on
//     every URL-attribute write whose value the compiler could not prove safe — the data supplies the
//     scheme there (`href="${url}"`, `href=${@u}`, an `<each>` row's `src=@.img`).
// Both halves therefore read a URL with the same steps and admit the same schemes. The `string(url)`
// refinement shape (§53.6.1, S457 "6a") is judged here too (`_scrml_url_shape_ok`, at the end). Do not
// write a second list or a second reader anywhere: change this file.
//
// This file is inlined into a classic browser script and into the server bundle, so it holds plain
// function and `const` declarations only — no imports, no TypeScript, and every top-level name carries
// the `_scrml_` / `_SCRML_` prefix the runtime reserves.

// Attributes whose value is a URL (or a list of URLs), lowercased. Element-insensitive on purpose
// (fail closed): `href` is a URL on `<a>`, `<area>`, `<link>`, `<base>` and SVG/MathML elements alike.
// Source: the HTML Living Standard attribute index — every attribute whose value is a "valid URL
// potentially surrounded by spaces", a "valid non-empty URL", or a set/list of them — plus the
// URL-valued attributes of § "Obsolete features" that browsers still parse, and SVG/XML
// `xlink:href` / `xml:base`.
export const _SCRML_URL_VALUED_ATTRS = new Set([
  "action", "archive", "background", "cite", "classid", "codebase", "data", "dynsrc", "formaction",
  "href", "icon", "imagesrcset", "itemid", "itemtype", "longdesc", "lowsrc", "manifest", "ping",
  "poster", "profile", "src", "srcset", "usemap", "xlink:href", "xml:base",
]);

// The elements on which the HTML standard makes an attribute of `_SCRML_URL_VALUED_ATTRS` a URL, for
// the names it scopes to particular elements (lowercased tags; HTML reads `<Link>` as `<link>`). A
// name absent from this table — `href`, `src`, `xlink:href`, `xml:base`, `itemid`, `itemtype` — is a
// URL on every element (SVG and MathML give `href` / `src`-like meaning to many elements, and the
// microdata attributes are global). The compile-time literal-prefix rule (§5.2 rule 2) refuses on any
// element (fail closed: an executable scheme written literally is never legitimate); the RUNTIME guard
// (§5.2 rule 3) uses this table, so a `data=` on a `<div>` or a custom element, or a component prop
// that happens to be named `data` / `icon` / `cite` / `action`, keeps the value the data gave it.
export const _SCRML_URL_ATTR_ELEMENTS = {
  action: ["form"],
  archive: ["object", "applet"],
  background: ["body", "table", "thead", "tbody", "tfoot", "tr", "td", "th"],
  cite: ["blockquote", "q", "del", "ins"],
  classid: ["object"],
  codebase: ["object", "applet"],
  data: ["object"],
  dynsrc: ["img"],
  formaction: ["button", "input"],
  icon: ["command", "menuitem"],
  imagesrcset: ["link"],
  longdesc: ["img", "iframe", "frame"],
  lowsrc: ["img"],
  manifest: ["html"],
  ping: ["a", "area"],
  poster: ["video"],
  profile: ["head"],
  srcset: ["img", "source"],
  usemap: ["img", "object", "input"],
};

// Is attribute `name` a URL on element `tag`? `tag` may be empty when the caller does not know it —
// then every name in `_SCRML_URL_VALUED_ATTRS` counts (fail closed).
export function _scrml_is_url_attr(tag, name) {
  const lowerName = String(name).toLowerCase();
  if (!_SCRML_URL_VALUED_ATTRS.has(lowerName)) return false;
  if (!tag) return true;
  const scope = Object.prototype.hasOwnProperty.call(_SCRML_URL_ATTR_ELEMENTS, lowerName)
    ? _SCRML_URL_ATTR_ELEMENTS[lowerName]
    : null;
  return scope === null || scope.indexOf(String(tag).toLowerCase()) !== -1;
}

// Schemes that never run the URL's text as script in any URL attribute: `http:` / `https:` / `ftp:`
// fetch or navigate; `mailto:` / `tel:` / `sms:` hand off to an external handler. Every other scheme —
// `javascript:`, `vbscript:`, `data:` (an `<iframe src>` of `data:text/html` runs script; see
// `_SCRML_SAFE_DATA_IMAGE_TYPES` for the one admitted shape), `blob:` (a same-origin document), and any
// scheme not named here — is refused (fail closed).
export const _SCRML_SAFE_URL_SCHEMES = new Set(["http", "https", "ftp", "mailto", "tel", "sms"]);

// Raster image media types a `data:` URL may name on an image-loading attribute. A raster image is
// decoded, never executed. `image/svg+xml` is NOT here (an SVG document can carry script).
export const _SCRML_SAFE_DATA_IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "image/x-icon", "image/vnd.microsoft.icon",
]);

// Attributes whose URL is loaded as an image source (where a raster `data:` image is admitted).
export const _SCRML_IMAGE_SOURCE_ATTRS = new Set(["src", "srcset", "imagesrcset", "poster"]);

// Read the scheme a URL text commits to, the way the WHATWG URL parser reads it:
//   - leading C0 controls and spaces are stripped ("remove any leading C0 control or space");
//   - ASCII tab / LF / CR are removed anywhere ("remove all ASCII tab or newline"), so
//     `java<TAB>script:` IS `javascript:`;
//   - the scheme is the run before the first `:` when that run is ALPHA *( ALPHA / DIGIT / "+" / "-" /
//     "." ) and no `/`, `?` or `#` came first; it is compared lowercased.
// Returns one of:
//   { kind: "scheme", scheme, rest } — `rest` is the normalized text after the `:`;
//   { kind: "relative" }             — the text can no longer begin with a scheme: a `/`, `?` or `#`
//                                      came first, or the run before `:` is not a scheme (the URL
//                                      parser then reads a relative URL);
//   { kind: "none" }                 — the text ended before committing either way (`""`, `java`): text
//                                      that FOLLOWS it can still supply a scheme;
//   { kind: "unprovable", reason }   — only when `decodesEscapes` is true: a `\` or `&` came before the
//                                      scheme ended. The compiler passes true for the literal text of a
//                                      quoted attribute, which it emits as a JS template literal (that
//                                      decodes `\x6a`) and which HTML would read `&#106;` in; neither
//                                      is ever needed in a real scheme, so it is refused, not decoded.
//                                      The runtime passes false: it reads the final string the browser
//                                      will parse, where a `\` or `&` is just a character.
export function _scrml_read_url_scheme(text, decodesEscapes) {
  let s = String(text);
  let start = 0;
  while (start < s.length && s.charCodeAt(start) <= 0x20) start++;
  s = s.slice(start).replace(/[\t\n\r]/g, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (decodesEscapes && (c === "\\" || c === "&")) {
      return { kind: "unprovable", reason: c === "\\" ? "an escape sequence (`\\`)" : "a character reference (`&`)" };
    }
    if (c === "/" || c === "?" || c === "#") return { kind: "relative" };
    if (c === ":") {
      const candidate = s.slice(0, i);
      if (/^[A-Za-z][A-Za-z0-9+.\-]*$/.test(candidate)) {
        return { kind: "scheme", scheme: candidate.toLowerCase(), rest: s.slice(i + 1) };
      }
      return { kind: "relative" };
    }
  }
  return { kind: "none" };
}

// Does the text after `data:` name a complete raster image media type — terminated by `;` or `,`?
export function _scrml_data_url_is_raster_image(rest) {
  const m = /^([^;,]*)[;,]/.exec(rest);
  if (!m) return false;
  return _SCRML_SAFE_DATA_IMAGE_TYPES.has(m[1].trim().toLowerCase());
}

// Is a URL whose scheme is `scheme` (rest = the text after its `:`) admitted on attribute `lowerName`?
export function _scrml_url_scheme_admitted(lowerName, scheme, rest) {
  if (_SCRML_SAFE_URL_SCHEMES.has(scheme)) return true;
  return scheme === "data" && _SCRML_IMAGE_SOURCE_ATTRS.has(lowerName) && _scrml_data_url_is_raster_image(rest);
}

// One URL (the whole text the browser will parse) — admitted, or not?
function _scrml_one_url_admitted(lowerName, url) {
  const r = _scrml_read_url_scheme(url, false);
  if (r.kind !== "scheme") return true; // relative, or no scheme at all
  return _scrml_url_scheme_admitted(lowerName, r.scheme, r.rest);
}

// The candidate URLs of a `srcset` / `imagesrcset` value, read the way the HTML "parse a srcset
// attribute" algorithm reads them: skip whitespace and commas; the URL is the run up to the next
// whitespace (trailing commas stripped — a `data:` URL keeps its inner commas); then the descriptors run
// to the next comma that is not inside parentheses.
function _scrml_srcset_urls(text) {
  const urls = [];
  const isWs = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\f" || ch === "\r";
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && (isWs(text[i]) || text[i] === ",")) i++;
    if (i >= n) break;
    const urlStart = i;
    while (i < n && !isWs(text[i])) i++;
    let url = text.slice(urlStart, i);
    if (/,+$/.test(url)) {
      urls.push(url.replace(/,+$/, ""));
      continue;
    }
    urls.push(url);
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if (ch === "," && depth === 0) { i++; break; }
      i++;
    }
  }
  return urls;
}

// Is `value` (already a string) admitted on the URL-valued attribute `name`? `srcset` / `imagesrcset`
// check every candidate URL; `ping` (space-separated) and `archive` (space- or comma-separated) check
// every entry; every other URL attribute holds one URL.
export function _scrml_url_value_admitted(name, value) {
  const lowerName = String(name).toLowerCase();
  if (lowerName === "srcset" || lowerName === "imagesrcset") {
    const urls = _scrml_srcset_urls(value);
    for (let i = 0; i < urls.length; i++) if (!_scrml_one_url_admitted(lowerName, urls[i])) return false;
    return true;
  }
  if (lowerName === "ping" || lowerName === "archive") {
    const parts = value.split(lowerName === "ping" ? /[\t\n\f\r ]+/ : /[\t\n\f\r ,]+/);
    for (let i = 0; i < parts.length; i++) if (parts[i] && !_scrml_one_url_admitted(lowerName, parts[i])) return false;
    return true;
  }
  return _scrml_one_url_admitted(lowerName, value);
}

// SVG animation elements (SMIL). Each one writes the value of ANOTHER attribute — the one its
// `attributeName` names, on its target element (the parent, or the element its `href` points at) — over
// time: `<a><set attributeName="href" to="javascript:…"/>…</a>` animates the link's href to that value,
// and a click then runs it (Chromium-confirmed, S457). So a value attribute of one of these elements
// whose `attributeName` names a URL-valued attribute IS a URL-attribute write (§5.2 rules 2 and 3).
// Lowercased (`animateTransform` is matched as `animatetransform`).
export const _SCRML_SVG_ANIMATION_ELEMENTS = new Set([
  "set", "animate", "animatecolor", "animatemotion", "animatetransform",
]);

// The animation attributes that carry the value written to the animated attribute. `values` is a
// `;`-separated list (SMIL splits it on `;`); `to`, `from` and `by` hold one value each.
export const _SCRML_SVG_ANIMATION_VALUE_ATTRS = new Set(["to", "from", "by", "values"]);

// Is the animation value `value` (already a string) admitted, when written to the animation attribute
// `lowerName` (`to` / `from` / `by` / `values`) of an element animating the attribute `target`? `target`
// is the lowercased URL-valued attribute `attributeName` names when the author wrote it literally, and ""
// when it is computed at runtime — then each value is judged as a URL on an unknown attribute (a raster
// `data:image` is not admitted, since the animated attribute may not be an image source).
function _scrml_animation_value_admitted(lowerName, value, target) {
  const entries = lowerName === "values" ? value.split(";") : [value];
  for (let i = 0; i < entries.length; i++) {
    if (!_scrml_url_value_admitted(target, entries[i])) return false;
  }
  return true;
}

// The runtime guard (SPEC §5.2 rule 3). The compiler routes every URL-attribute write it cannot prove
// safe through this call: `el.setAttribute("href", _scrml_safe_url(el, "href", value))`. Returns the
// value as `setAttribute` would write it (`String(value)`) when its scheme is admitted, and otherwise
// `"about:blank"` plus one report to scrml's logging surface (§19.6.8) naming the attribute and the
// element — never the value, which may carry data the page should not echo to a log. `el` may be null
// (the server's first-paint row renderer has no element).
//
// `target` is passed only for an SVG animation value attribute (`to` / `from` / `by` / `values` on
// `<set>`, `<animate>`, …): it names the URL-valued attribute being animated ("" when `attributeName` is
// computed at runtime), and every `;`-separated entry of `values` is judged.
export function _scrml_safe_url(el, name, value, target) {
  const text = String(value);
  const animated = typeof target === "string";
  const admitted = animated
    ? _scrml_animation_value_admitted(String(name).toLowerCase(), text, target)
    : _scrml_url_value_admitted(name, text);
  if (admitted) return text;
  const tag = el && typeof el.tagName === "string" ? "<" + el.tagName.toLowerCase() + "> " : "";
  const what = animated
    ? String(name) + "= value animating " + (target ? target + "=" : "a URL attribute named at runtime")
    : String(name) + "=";
  const err = new Error(
    "blocked a " + tag + what + " URL whose scheme is not admitted (SPEC §5.2): only http:, " +
    "https:, ftp:, mailto:, tel:, sms:, a relative URL, or a raster data:image on an image source may be " +
    "written from data. The attribute was set to about:blank.",
  );
  if (typeof _scrml_error_boundary_log === "function") {
    _scrml_error_boundary_log("url-guard", err);
  } else if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[scrml url-guard] " + err.message);
  }
  return "about:blank";
}

// The `url` named shape of a refinement type (SPEC §53.6.1, S457 ruling "6a"): `string(url)`. A value
// inhabits the shape when it is a string, the WHATWG URL parser accepts it as an absolute URL (no base
// — a relative URL such as `/users/1` does not inhabit it), AND the scheme this file's reader finds is
// one of `_SCRML_SAFE_URL_SCHEMES`. Every other scheme — `javascript:`, `vbscript:`, `data:` (a value
// type does not know which attribute it will reach, so no `data:` form is admitted), `blob:`, `file:`,
// and any scheme not named there — fails the shape (fail closed). The compiler's static zone imports
// this function to judge a string literal (type-system.ts); the runtime boundary check calls it
// (emit-predicates.ts), inlined from this file into the client runtime ('urlguard' chunk) and into the
// server bundle — one predicate at both enforcement sites.
export function _scrml_url_shape_ok(value) {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
  } catch (e) {
    return false;
  }
  const r = _scrml_read_url_scheme(value, false);
  return r.kind === "scheme" && _SCRML_SAFE_URL_SCHEMES.has(r.scheme);
}
