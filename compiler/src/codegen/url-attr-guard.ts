/**
 * url-attr-guard — the emit-side half of SPEC §5.2 rule 3 (S457 ruling "a now with c discussed for
 * later"): every URL-attribute write whose value the compiler cannot prove safe is routed through the
 * runtime guard `_scrml_safe_url(el, name, value)` (defined in `../runtime-url-guard.js`, inlined into
 * the client runtime as the 'urlguard' chunk and into the server bundle for first-paint rows).
 *
 * Two questions, asked by every emitter that writes an attribute from data:
 *   - `dynamicUrlAttrNeedsGuard(tag, name)` — the value is wholly computed at runtime
 *     (`href=${expr}`, a component-substituted `href=@cell`, an `<each>` row's `src=it.img`, a
 *     call-ref): guard whenever `name` is a URL on `tag`.
 *   - `quotedUrlAttrNeedsGuard(tag, name, raw)` — a QUOTED value with `${…}`: guard only when its
 *     literal text before the first interpolation commits to no scheme (`href="${url}"`,
 *     `src="java${x}"`). A literal relative path or safe scheme (`href="/u/${id}"`,
 *     `href="https://x/${id}"`) is proven safe at compile time and its write stays byte-identical;
 *     an unsafe or unprovable literal scheme is refused at compile time (rule 2).
 *
 * `tag` is the emitted element's tag (lowercased by the reader); pass "" when unknown and every name
 * in the URL-attribute set counts (fail closed). The reader and every set live in
 * `../runtime-url-guard.js` — there is no second list here.
 */

import { _scrml_is_url_attr } from "../runtime-url-guard.js";
import {
  ATTR_INTERP_EXECUTABLE_CODE,
  animationUrlTarget,
  attrSinkKey,
  executableDataWriteSink,
  interpolatedAttrSinkMessage,
  quotedAnimationValueNeedsRuntimeGuard,
  quotedUrlAttrNeedsRuntimeGuard,
} from "../attr-injection-sink.ts";
import { CGError } from "./errors.ts";
import { recordRefusedLowering } from "./refused-lowering-errors.ts";

/** The runtime guard's name, as emitted. The post-emit chunk gate in emit-client.ts keys off it. */
export const URL_GUARD_FN = "_scrml_safe_url";

/** Is `name` a URL-valued attribute on element `tag` (empty tag → name only, fail closed)? */
export function isUrlAttrOn(tag: string | null | undefined, name: string): boolean {
  return _scrml_is_url_attr(tag ?? "", name) === true;
}

/**
 * The element's attribute list, when the caller has it. Needed for an SVG animation value
 * (`<set attributeName="href" to=…>`): whether `to` writes a URL depends on `attributeName`.
 */
export type ElementAttrs = ReadonlyArray<unknown> | null | undefined;

/**
 * The 4th guard argument for an SVG animation value attribute (S457): the URL attribute it animates
 * (`"href"`), `""` when `attributeName` is computed, or null when `name` is not such a value.
 */
export function urlGuardTarget(tag: string | null | undefined, name: string, attrs?: ElementAttrs): string | null {
  return animationUrlTarget(tag ?? "", name, attrs ?? null);
}

/**
 * A wholly runtime-computed attribute value: guard every URL attribute, and every SVG animation
 * value that writes one.
 */
export function dynamicUrlAttrNeedsGuard(tag: string | null | undefined, name: string, attrs?: ElementAttrs): boolean {
  return isUrlAttrOn(tag, name) || urlGuardTarget(tag, name, attrs) !== null;
}

/**
 * A quoted `${…}` attribute value: guard when it is a URL and its literal prefix commits to no scheme
 * (an animation `values` list: whenever it interpolates — any `;` entry may be data-led).
 */
export function quotedUrlAttrNeedsGuard(
  tag: string | null | undefined,
  name: string,
  raw: string,
  attrs?: ElementAttrs,
): boolean {
  if (urlGuardTarget(tag, name, attrs) !== null) return quotedAnimationValueNeedsRuntimeGuard(name, raw);
  return isUrlAttrOn(tag, name) && quotedUrlAttrNeedsRuntimeGuard(name, raw);
}

/**
 * `_scrml_safe_url(<el>, "<name>", <valueJs>)` — the guarded value expression. For an SVG animation
 * value (`target` from `urlGuardTarget`, non-null) the animated attribute is passed as a 4th argument:
 * `_scrml_safe_url(el, "to", v, "href")`.
 */
export function wrapUrlGuard(elExpr: string, name: string, valueJs: string, target?: string | null): string {
  const extra = typeof target === "string" ? `, ${JSON.stringify(target)}` : "";
  return `${URL_GUARD_FN}(${elExpr}, ${JSON.stringify(name)}, ${valueJs}${extra})`;
}

/**
 * §5.2 (S457) — the backstop every emitter asks immediately before it WRITES an attribute's value
 * from data (`setAttribute(name, <data>)`, or an SSR `name="<data>"`): a `srcdoc` (an HTML document)
 * or an event-handler attribute (handler text) is never written from data. VP-3 already refuses a
 * data `srcdoc` on every element; the event-handler names reach here only when an emitter does not
 * wire that spelling as a listener (`ONCLICK=${…}`, `onClick=` in `lift` markup) and would otherwise
 * write the data as JavaScript source. The refusal (E-ATTR-INTERP-EXECUTABLE) goes to the run-wide
 * refused-lowering sink (one per attribute, deduped by `anchor`); returns the comment the caller emits
 * INSTEAD of the write, or null when the write is not an executable sink.
 */
export function refuseExecutableDataWrite(
  name: string,
  tag: string | null | undefined,
  span: object | null | undefined,
  anchor: object | null | undefined,
  where = "",
): string | null {
  const sink = executableDataWriteSink(name);
  if (sink === null) return null;
  const err = new CGError(
    ATTR_INTERP_EXECUTABLE_CODE,
    interpolatedAttrSinkMessage(sink, name, String(tag ?? ""), where, "data"),
    span ?? { start: 0, end: 0 },
  );
  (err as { attrSinkKey?: string }).attrSinkKey = attrSinkKey(
    (span ?? null) as { file?: unknown; start?: unknown; end?: unknown } | null,
    name,
  );
  // The attribute's lowercased name: api.js drops this backstop report when VP-3 already refused
  // the same-named attribute in the same file (a re-parsed `<match>` arm has its own spans).
  (err as { attrSinkName?: string }).attrSinkName = name.toLowerCase();
  recordRefusedLowering(err, anchor ?? null);
  return `/* ${ATTR_INTERP_EXECUTABLE_CODE}: ${JSON.stringify(name)} is never written from data (executable sink) */`;
}
