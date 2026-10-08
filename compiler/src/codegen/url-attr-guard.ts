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
import { quotedUrlAttrNeedsRuntimeGuard } from "../attr-injection-sink.ts";

/** The runtime guard's name, as emitted. The post-emit chunk gate in emit-client.ts keys off it. */
export const URL_GUARD_FN = "_scrml_safe_url";

/** Is `name` a URL-valued attribute on element `tag` (empty tag → name only, fail closed)? */
export function isUrlAttrOn(tag: string | null | undefined, name: string): boolean {
  return _scrml_is_url_attr(tag ?? "", name) === true;
}

/** A wholly runtime-computed attribute value: guard every URL attribute. */
export function dynamicUrlAttrNeedsGuard(tag: string | null | undefined, name: string): boolean {
  return isUrlAttrOn(tag, name);
}

/** A quoted `${…}` attribute value: guard when it is a URL and its literal prefix commits to no scheme. */
export function quotedUrlAttrNeedsGuard(tag: string | null | undefined, name: string, raw: string): boolean {
  return isUrlAttrOn(tag, name) && quotedUrlAttrNeedsRuntimeGuard(name, raw);
}

/** `_scrml_safe_url(<el>, "<name>", <valueJs>)` — the guarded value expression. */
export function wrapUrlGuard(elExpr: string, name: string, valueJs: string): string {
  return `${URL_GUARD_FN}(${elExpr}, ${JSON.stringify(name)}, ${valueJs})`;
}
