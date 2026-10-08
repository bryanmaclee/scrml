/**
 * @module codegen/host-global-alias
 *
 * Compiler-emitted references to HOST GLOBALS go through one alias no user name
 * can reach (S457 ruling 2a; g-user-fn-named-host-global-hijacks-compiler-refs-s457).
 *
 * ## The defect this closes
 *
 * A compiler reference to a host global (`fetch`, `document`, `Response`, `JSON`,
 * ...) and a user's reference to a same-named user function are both FREE names in
 * the emitted JS, so nothing can tell them apart:
 *
 *   - client: the scope-aware user-function rename (fn-name-rename.ts) renames every
 *     free `fetch(` to the user's encoded `function fetch` — including the compiler's
 *     own `fetch(path, …)` inside `_scrml_fetch_with_csrf_retry`, so every server call
 *     ran the user's function. A user `function document` turned the click
 *     dispatcher's `t !== document` into `t !== _scrml_document_7`.
 *   - client: a user top-level `const location = …` is emitted under its own name in
 *     the chunk scope and captured every compiler `location` reference in the chunk.
 *   - server: a server function called by another server function is emitted as a
 *     module-scope `async function <name>`; a `server function Response` therefore
 *     shadowed `Response` for the whole bundle (`new Response(…)` on every route).
 *
 * ## The rule
 *
 * The emitted code spells every host global it uses as `_scrml_g.<name>`
 * (`_scrml_g.document.querySelector(…)`, `await _scrml_g.fetch(…)`,
 * `new _scrml_g.Response(…)`), where `_scrml_g` is `globalThis` captured once:
 *
 *   - client: the first line of the runtime core chunk (runtime-template.js), which is
 *     always shipped and never shares a scope with user code (a separate classic
 *     script, an ES module whose exports the chunk imports, or an embedded runtime
 *     placed outside the chunk IIFE);
 *   - every other artifact that uses it (server bundle, library module, tool module,
 *     worker bundle): `HOST_GLOBAL_ALIAS_DECL` at the top, via `withHostGlobalAlias`.
 *
 * `_scrml_g` is in the reserved `_scrml_` namespace (SPEC §47.1.1): no user program
 * can declare or reference it. User code is untouched — an author may still shadow a
 * global in their own code, and their own references keep meaning their binding.
 *
 * The alias is the global OBJECT, read as a property at each use — not a per-name
 * snapshot — so a host global replaced after load (a polyfill, instrumentation that
 * wraps `fetch`, a test mock) is seen exactly as a bare reference would see it.
 *
 * The runtime's own text keeps bare global names: no user binding is ever emitted
 * into its scope (and the rename pass fences it, emit-client.ts
 * joinAroundRuntimeSlot).
 *
 * The one name the alias itself reads is `globalThis`. On the client it is read in
 * the runtime's scope; in a server bundle a `server function globalThis` peer
 * callable would capture it, so that name is a reserved server binding (E-CG-016,
 * emit-server.ts).
 */

import { aliasFreeGlobalRefs } from "./fn-name-rename.ts";

/** The alias identifier. */
export const HOST_GLOBAL_ALIAS = "_scrml_g";

/**
 * Host globals a compiler reference may name: the ECMAScript global object's
 * properties plus the web / Bun / Node host names compiler output and inlined
 * runtime text use. `undefined` is absent on purpose: scrml has no `undefined`
 * token (§42.7, E-SYNTAX-042), so no user binding can take that name. Names a
 * module provides itself (`require`, `__dirname`, `__filename`, `module`,
 * `exports`) are not globals and are absent too.
 */
export const HOST_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  // ECMAScript
  "globalThis", "Infinity", "NaN",
  "eval", "isFinite", "isNaN", "parseFloat", "parseInt",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "unescape",
  "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array", "BigUint64Array",
  "Boolean", "DataView", "Date", "Error", "EvalError", "FinalizationRegistry", "Float32Array",
  "Float64Array", "Function", "Int8Array", "Int16Array", "Int32Array", "Intl", "Iterator", "JSON",
  "Map", "Math", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect",
  "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol", "SyntaxError", "TypeError", "URIError",
  "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "WeakMap", "WeakRef", "WeakSet",
  // web platform (browser, worker, and Bun's WinterCG surface)
  "window", "self", "document", "location", "history", "navigator", "console", "crypto",
  "performance", "localStorage", "sessionStorage", "customElements",
  "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  "structuredClone", "atob", "btoa", "getComputedStyle", "matchMedia", "reportError",
  "postMessage", "addEventListener", "removeEventListener", "dispatchEvent",
  "URL", "URLSearchParams", "Request", "Response", "Headers", "FormData", "Blob", "File",
  "ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder",
  "AbortController", "AbortSignal", "Event", "EventTarget", "CustomEvent", "MessageChannel",
  "BroadcastChannel", "WebSocket", "EventSource", "Worker",
  "Node", "NodeFilter", "Element", "HTMLElement", "HTMLInputElement", "HTMLTemplateElement",
  "DocumentFragment", "Comment", "Text", "MutationObserver", "IntersectionObserver",
  "ResizeObserver", "DOMParser", "CSS",
  // Bun / Node host
  "Bun", "process", "Buffer",
]);

/**
 * `js` without its `HOST_GLOBAL_ALIAS_DECL` line — for an artifact that is embedded
 * into a larger module (the serve-target tool wraps a whole server bundle), which
 * then declares the alias once, above everything, via `withHostGlobalAlias`.
 */
export function stripHostGlobalAliasDecl(js: string): string {
  return js.split(HOST_GLOBAL_ALIAS_DECL + "\n").join("");
}

/**
 * `src` (runtime text the compiler inlines into a user-reachable artifact — a
 * server bundle, library module, tool, or worker) with every free host-global
 * reference spelled through the alias. The client keeps the bare original: the
 * client runtime never shares a scope with user code. Throws if `src` does not
 * parse — runtime text is compiler-owned and must.
 */
export function aliasHostGlobalsInRuntimeText(src: string): string {
  const out = aliasFreeGlobalRefs(src, HOST_GLOBAL_NAMES, HOST_GLOBAL_ALIAS);
  if (out === null) throw new Error("host-global-alias: inlined runtime text does not parse");
  return out;
}

/** The declaration placed at the top of a non-client artifact that uses the alias. */
export const HOST_GLOBAL_ALIAS_DECL =
  "const _scrml_g = globalThis; // host globals, under a name no scrml binding can reach (SPEC §47.1.1)";

const USES_ALIAS = /(?<![\w$.])_scrml_g\b(?!\s*=)/;
const DECLARES_ALIAS = /(?:^|[\n;{])\s*(?:const|let|var)\s+_scrml_g\b/;

/**
 * Prepend `HOST_GLOBAL_ALIAS_DECL` to a module-shaped artifact that references the
 * alias and does not already declare it. The file's own header comment (its leading
 * `//` lines, up to the first `// --- … ---` banner of an inlined helper) and a `#!`
 * line stay first; the declaration goes right after them, above every statement —
 * helpers read the alias at load (`const _SCRML_MEDIATED = _scrml_g.Symbol.for(…)`).
 * `import` declarations are hoisted, so a `const` above them is still valid.
 */
export function withHostGlobalAlias(js: string | null | undefined): string | null | undefined {
  if (!js || !USES_ALIAS.test(js) || DECLARES_ALIAS.test(js)) return js;
  const lines = js.split("\n");
  let i = 0;
  // The file's own header comment: leading `//` lines up to the first section
  // banner (`// --- … ---`, which opens an inlined helper's own comment block).
  while (i < lines.length && (i === 0 && lines[i].startsWith("#!") || (/^\s*\/\//.test(lines[i]) && !/^\s*\/\/ ---/.test(lines[i])))) i++;
  lines.splice(i, 0, HOST_GLOBAL_ALIAS_DECL);
  return lines.join("\n");
}
