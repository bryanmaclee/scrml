/**
 * @module codegen/emit-transition-css
 *
 * §38 transition directives — the `scrml-enter-*` / `scrml-exit-*` animation
 * classes, emitted into the file's OWN stylesheet.
 *
 * These keyframes used to be injected at runtime by an always-shipped
 * `document.createElement("style")` IIFE in `runtime-template.js` (runtime
 * chunk `'transitions'`). That is an INLINE style element, and
 * `<program headers="strict">` pins `default-src 'self'` (§39.2.5) — Chromium
 * refuses to apply it, so a strict-headers app lost every §38 transition and
 * the author had no way to fix it (§39.2.5's "override via `handle()`" escape
 * covers author-loaded external origins, not compiler-emitted content).
 *
 * Shipping the same rules in `<base>.css` — an ordinary same-origin
 * `<link rel="stylesheet">` — satisfies `default-src 'self'` with no adopter
 * change and no CSP widening. It also drops the injection IIFE (and its
 * `document.head.appendChild` at load) from the runtime.
 *
 * Emission is scoped to the transitions the FILE actually uses. A page with no
 * `transition:` / `in:` / `out:` directive emits nothing at all, so the vast
 * majority of compiled stylesheets are byte-identical to before.
 */

/** The §38 transition types the compiler recognises. Mirrors `SUPPORTED_TRANSITIONS` in emit-html.ts. */
const TRANSITION_KEYFRAMES: Record<string, string[]> = {
  fade: [
    "@keyframes scrml-fade-in { from { opacity: 0 } to { opacity: 1 } }",
    "@keyframes scrml-fade-out { from { opacity: 1 } to { opacity: 0 } }",
    ".scrml-enter-fade { animation: scrml-fade-in 300ms ease }",
    ".scrml-exit-fade { animation: scrml-fade-out 300ms ease }",
  ],
  slide: [
    "@keyframes scrml-slide-in { from { transform: translateY(-20px); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-slide-out { from { transform: none; opacity: 1 } to { transform: translateY(-20px); opacity: 0 } }",
    ".scrml-enter-slide { animation: scrml-slide-in 300ms ease }",
    ".scrml-exit-slide { animation: scrml-slide-out 300ms ease }",
  ],
  fly: [
    "@keyframes scrml-fly-in { from { transform: translateX(-100%); opacity: 0 } to { transform: none; opacity: 1 } }",
    "@keyframes scrml-fly-out { from { transform: none; opacity: 1 } to { transform: translateX(100%); opacity: 0 } }",
    ".scrml-enter-fly { animation: scrml-fly-in 300ms ease }",
    ".scrml-exit-fly { animation: scrml-fly-out 300ms ease }",
  ],
};

/** Emission order — deterministic regardless of the order the directives appear in source. */
const TRANSITION_ORDER = ["fade", "slide", "fly"] as const;

/**
 * Which §38 transition types does this file use?
 *
 * Reads the raw attribute names (`transition:<type>` / `in:<type>` /
 * `out:<type>`) off every markup node in the AST, the same three prefixes
 * emit-html.ts pre-scans when it decides to attach `scrml-enter-*` /
 * `scrml-exit-*` at runtime. Walking the AST rather than the binding registry
 * keeps this independent of codegen ordering — the stylesheet is assembled
 * before the registry is fully populated.
 */
export function collectUsedTransitions(nodes: unknown): Set<string> {
  const used = new Set<string>();
  // Some AST nodes carry back-references (a node reachable from two parents, a
  // cached sub-tree). Without this the walk can revisit — or loop forever.
  const seen = new WeakSet<object>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const rec = node as Record<string, unknown>;

    const attrs = rec.attrs;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const name = (attr as { name?: unknown } | null)?.name;
        if (typeof name !== "string") continue;
        let type: string | null = null;
        if (name.startsWith("transition:")) type = name.slice("transition:".length);
        else if (name.startsWith("in:")) type = name.slice("in:".length);
        else if (name.startsWith("out:")) type = name.slice("out:".length);
        if (type !== null && Object.prototype.hasOwnProperty.call(TRANSITION_KEYFRAMES, type)) {
          used.add(type);
        }
      }
    }

    // Transition directives can sit on markup anywhere the AST nests it —
    // component bodies, if-chain arms, each bodies, engine arms. Recurse over
    // every object-valued field rather than enumerating child-bearing kinds,
    // so a new nesting shape cannot silently drop a page's animation CSS.
    for (const key of Object.keys(rec)) {
      if (key === "attrs" || key === "span" || key === "loc" || key === "parent") continue;
      const value = rec[key];
      if (value && typeof value === "object") visit(value);
    }
  };

  visit(nodes);
  return used;
}

/**
 * The CSS for the transitions this file uses, or `null` when it uses none.
 */
export function generateTransitionCss(nodes: unknown): string | null {
  const used = collectUsedTransitions(nodes);
  if (used.size === 0) return null;

  const out: string[] = ["/* §38 transition directives */"];
  for (const type of TRANSITION_ORDER) {
    if (used.has(type)) out.push(...TRANSITION_KEYFRAMES[type]);
  }
  return out.join("\n");
}
