/**
 * s427 round 4 — recover the `let` of a `for (let x of …)` head on nodes the NATIVE
 * parser produced.
 *
 * The live statement parser (ast-builder.js) records `letBinder: true` on a
 * for-stmt whose head binder is declared `let`: a write to a rendering loop's
 * binder takes effect only then, and is a compile error otherwise (emit-lift.js
 * checkLoopBinderWrites). Match-arm, engine-arm and component bodies are re-parsed
 * by `nativeParseFile` (compiler/native-parser), whose for-stmt translation keeps
 * no binder keyword — so a `let` binder there would read as `const` and a correct
 * program would be rejected. This recovers the keyword from the re-parsed source
 * text at the node's span (native spans are offsets into that text), without
 * touching the native parser. Only for-stmts carrying the native `forKind` marker
 * are inspected; a live-parsed node is never changed.
 */

const LET_HEAD = /^for\s*(?:await\s*)?\(\s*let\b/;

export function annotateNativeForBinders(nodes: unknown, sourceText: string): void {
  if (typeof sourceText !== "string" || !sourceText) return;
  const seen = new WeakSet<object>();
  const visit = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (n.kind === "for-stmt" && typeof n.forKind === "string" && n.letBinder !== true) {
      const start = n.span && typeof n.span.start === "number" ? n.span.start : -1;
      if (start >= 0 && LET_HEAD.test(sourceText.slice(start, start + 64))) n.letBinder = true;
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(nodes);
}
