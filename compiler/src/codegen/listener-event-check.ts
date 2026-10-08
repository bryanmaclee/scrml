/**
 * @module codegen/listener-event-check
 *
 * s457 3a — E-EVENT-UNBOUND, judged on the text the runtime executes.
 *
 * SPEC §5.2 "Handler values do not bind `event`": a handler whose listener the
 * compiler writes (a bare call / expression / assignment, an inline block, a
 * `${…}` value that is not itself a function) does not bind the name `event`;
 * the listener's own parameter is `_scrml_event`, outside the user namespace
 * (§47.1.1). So in the ASSEMBLED client text, a reference to `event` inside a
 * compiler-written listener that no enclosing scope binds — not the handler's
 * own lambdas / `const`s, not a row variable the compiler bound around it, not a
 * file-level `const event` / `function event` — names nothing the author
 * declared. (A browser would quietly resolve it to the deprecated `window.event`;
 * happy-dom and strict hosts throw a ReferenceError.)
 *
 * Why here and not on the source AST (the S458 review of the first version):
 * markup reaches codegen through several front ends — the TAB parse, the native
 * parser's component-body / `<match>`-arm / engine / meta re-parses, lifted
 * markup — and a source-side walk must model each one's value shape and every
 * scope a binder can come from; it was wrong in both directions (a `const event`
 * anywhere in the file silenced it; a binder anywhere in the handler silenced the
 * whole handler; a component body's handler was never seen). The assembled text
 * is the one place every position meets, and Acorn's scope model is exact.
 *
 * A listener is a function expression whose FIRST parameter is `_scrml_event`
 * (every compiler-written wrapper: emit-event-wiring, emit-each, emit-lift,
 * emit-variant-guard). The source attribute comes from the colouring entry
 * points' registry (`listenerSourceOf`); a listener that was not recorded is
 * reported at the file with its text.
 */

import { parse as acornParse } from "acorn";
import { rewriteCodeSegments } from "./code-segments.ts";
import { resolveProgramReferences, listenerSourceOf } from "./js-async-analysis.ts";
import { CGError } from "./errors.ts";

type N = Record<string, any> & { type: string; start: number; end: number };

/** The listener parameter every compiler-written wrapper declares. */
export const LISTENER_EVENT_PARAM = "_scrml_event";

function tryParse(js: string): N | null {
  for (const sourceType of ["script", "module"] as const) {
    try {
      return acornParse(js, {
        ecmaVersion: "latest",
        sourceType,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
      }) as unknown as N;
    } catch {
      // try the other grammar
    }
  }
  return null;
}

/**
 * `await` inside a function a LATER pass makes `async` does not parse yet; for
 * scope analysis the operator is irrelevant, so it becomes `void ` (same length,
 * same unary precedence) in code positions — every offset is unchanged.
 */
function neutralizeAwait(js: string): string {
  if (!js.includes("await")) return js;
  return rewriteCodeSegments(js, (seg) =>
    seg.replace(/(?<![A-Za-z0-9_$.])await(?![A-Za-z0-9_$])/g, (m, off: number, whole: string) =>
      /\bfor\s*$/.test(whole.slice(0, off)) ? m : "void "),
  );
}

export interface UnboundEventListener {
  /** The listener function's text in `code`. */
  text: string;
  start: number;
  end: number;
  /** The free name found (`event`, or a name `injectedNames` added). */
  name: string;
}

/**
 * The names a listener's parameter would bind, besides `event`. A `<channel>`
 * `onclient:error` listener's event is called `error` (§38.10.1 table: "Injected
 * value: `error` … bound to the parameter name in the call expression"); when
 * the call names no plain parameter (`onclient:error=setV(error.type)`), the
 * listener's parameter is `_scrml_event` and that `error` binds nothing.
 */
export type InjectedNames = (listenerText: string) => readonly string[];

/** Every name an `InjectedNames` may return (the §38.10.1 table's non-`event` names). */
const INJECTED_NAME_CANDIDATES: readonly string[] = ["error"];

/** One name inside an identifier boundary, anywhere in `code`. */
const mentions = (code: string, name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`).test(code);

/**
 * The compiler-written listeners in `code` whose body references a free
 * `event` — or a free name `injectedNames` says that listener's parameter would
 * have bound — (one entry per listener, innermost listener for a nested one;
 * `event` reported before another name). Empty when `code` does not parse (an
 * invalid buffer is reported elsewhere).
 */
export function findUnboundEventListeners(code: string, injectedNames?: InjectedNames): UnboundEventListener[] {
  if (!code.includes(LISTENER_EVENT_PARAM)) return [];
  if (!mentions(code, "event") && !(injectedNames && INJECTED_NAME_CANDIDATES.some((n) => mentions(code, n)))) return [];
  const ast = tryParse(code) ?? tryParse(neutralizeAwait(code));
  if (!ast) return [];
  const listeners: N[] = [];
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    const n = node as N;
    if ((n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression")
      && Array.isArray(n.params) && n.params[0] && n.params[0].type === "Identifier"
      && n.params[0].name === LISTENER_EVENT_PARAM) {
      listeners.push(n);
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = (n as Record<string, unknown>)[k];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(ast);
  if (listeners.length === 0) return [];
  // A user FUNCTION value that a compiler wrapper invokes with the event —
  // `(${userFn})(_scrml_event)` (the `<each>` / lift row wrappers around a
  // `${(e) => …}` value, kept so the row variable resolves live) — IS the
  // user's listener (§5.2.1: a function value is the listener). Its own
  // references are the author's, judged exactly as at top level where the
  // value is registered directly: not by this check.
  const userListenerFns: N[] = [];
  const seen2 = new Set<object>();
  const walkCalls = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen2.has(node as object)) return;
    seen2.add(node as object);
    if (Array.isArray(node)) { for (const c of node) walkCalls(c); return; }
    const n = node as N;
    if (n.type === "CallExpression" && n.callee
      && (n.callee.type === "ArrowFunctionExpression" || n.callee.type === "FunctionExpression")
      && n.arguments && n.arguments[0] && n.arguments[0].type === "Identifier"
      && n.arguments[0].name === LISTENER_EVENT_PARAM) {
      userListenerFns.push(n.callee);
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      const v = (n as Record<string, unknown>)[k];
      if (v && typeof v === "object") walkCalls(v);
    }
  };
  walkCalls(ast);
  const refs = resolveProgramReferences(ast);
  const hit = new Map<N, string>();
  const injectedOf = new Map<N, readonly string[]>();
  const injected = (l: N): readonly string[] => {
    let v = injectedOf.get(l);
    if (v === undefined) { v = injectedNames ? injectedNames(code.slice(l.start, l.end)) : []; injectedOf.set(l, v); }
    return v;
  };
  for (const [id, binding] of refs) {
    const name = (id as N).name as string;
    if (binding !== undefined || (name !== "event" && !INJECTED_NAME_CANDIDATES.includes(name))) continue;
    if (userListenerFns.some((u) => u.start <= (id as N).start && (id as N).end <= u.end)) continue;
    let inner: N | null = null;
    for (const l of listeners) {
      if (l.start <= (id as N).start && (id as N).end <= l.end && (!inner || l.start >= inner.start)) inner = l;
    }
    if (!inner) continue;
    if (name !== "event" && !injected(inner).includes(name)) continue;
    if (hit.get(inner) !== "event") hit.set(inner, name);
  }
  return [...hit.entries()]
    .sort(([a], [b]) => a.start - b.start)
    .map(([l, name]) => ({ text: code.slice(l.start, l.end), start: l.start, end: l.end, name }));
}

/** E-EVENT-UNBOUND for every such listener, at its source attribute when recorded. */
export function eventUnboundErrors(
  code: string,
  filePath: string,
  fnNameMap?: ReadonlyMap<string, string> | null,
  /** What an UNRECORDED listener in `code` is (the worker bundle: `"when message"`). */
  defaultHook: string | null = null,
): CGError[] {
  const out: CGError[] = [];
  // The check runs on the text AFTER the user-function rename; the registry
  // holds each listener as it was colored, BEFORE it. Map encoded names back to
  // look a listener up.
  const inverse = new Map<string, string>();
  if (fnNameMap) for (const [author, encoded] of fnNameMap) if (encoded !== author) inverse.set(encoded, author);
  const unrename = (text: string): string => inverse.size === 0 ? text
    : text.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (w) => inverse.get(w) ?? w);
  const reported = new Set<string>();
  const sourceOf = (text: string) => listenerSourceOf(text) ?? listenerSourceOf(unrename(text));
  // §38.10.1: the `onclient:error` listener's event is named `error`.
  const injectedNames: InjectedNames = (text) => sourceOf(text)?.attrName === "onclient:error" ? ["error"] : [];
  for (const l of findUnboundEventListeners(code, injectedNames)) {
    const src = sourceOf(l.text);
    // One attribute can be wired by more than one listener (an engine arm's
    // delegated registry entry and its arm factory): report it once.
    const sp0 = src && src.span && typeof src.span === "object" ? (src.span as Record<string, unknown>) : null;
    const key = sp0 ? `${String(sp0.file)}:${String(sp0.start)}:${String(sp0.end)}:${src?.attrName}` : `text:${l.text}`;
    if (reported.has(key)) continue;
    reported.add(key);
    // A body re-parsed from synthesized text (a component body, a `<match>`
    // arm, `^{ emit() }` markup) carries spans in that text, not the file's:
    // say where it is (g-reparsed-body-spans-synthetic-s458).
    const synthFile = sp0 && typeof sp0.file === "string" && sp0.file !== filePath ? sp0.file : null;
    const where2 = synthFile === null ? ""
      : /#([A-Za-z_$][\w$]*)$/.test(synthFile) ? ` (in component \`${/#([A-Za-z_$][\w$]*)$/.exec(synthFile)![1]}\`)`
      : /^<match:[^:]*:([^>]*)>$/.test(synthFile) ? ` (in the \`<match>\` arm \`<${/^<match:[^:]*:([^>]*)>$/.exec(synthFile)![1]}>\`)`
      : synthFile === "__meta_emit__" ? " (in markup emitted by `^{ emit(…) }`)"
      : ` (in ${synthFile})`;
    const span = (src && src.span && typeof src.span === "object" ? src.span : null)
      ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
    const hook = src ? (src.attrName && /^when /.test(src.attrName) ? src.attrName : null) : defaultHook;
    const listing = src || hook ? "" : ` (emitted listener: \`${l.text.length > 160 ? l.text.slice(0, 157) + "…" : l.text}\`)`;
    const attr = src && src.attrName && /^on/i.test(src.attrName) ? src.attrName : null;
    const n = `\`${l.name}\``;
    let text: string;
    if (hook !== null) {
      // A worker / nested-program hook (§4.12.4, §46): its body sees the value
      // it names in parentheses, never the event object.
      text = `${n} in the \`${hook}\` hook is not bound. A \`when message\` / \`when error\` hook does not receive ` +
        `the event object (SPEC §4.12.4, §46) — its body sees only the value it names in parentheses ` +
        `(\`when message(data) { … }\` in the worker, \`when message from <#w> (data) { … }\` / ` +
        `\`when error from <#w> (e) { … }\` in the parent), and nothing in or around the body declares ${n}. ` +
        `Read the named value where the body reads ${n}${where2}.`;
    } else if (attr && /^onclient:/i.test(attr)) {
      // A `<channel>` client hook (§38.10.1): the event is bound to the call's
      // parameter NAME; with none named, the call has no event.
      text = `${n} in the \`${attr}=\` handler is not bound. A \`<channel>\` \`onclient:*\` handler receives the ` +
        `event only under the parameter name its call expression gives (SPEC §38.10.1) — this call names none ` +
        `(its first argument is not a plain name), and nothing in the file declares ${n}. Name the event as the ` +
        `call's first argument — \`${attr}=handle(e)\` — and read it in \`handle\`${where2}.`;
    } else {
      const where = attr ? `the \`${attr}=\` handler` : "an event handler";
      const shape = attr ? `\`${attr}=\${(e) => …}\`` : "`onclick=${(e) => …}`";
      text = `${n} in ${where} is not bound. A bare or inline-block handler does not receive ` +
        `the event object (SPEC §5.2, §5.2.3) — nothing in the handler or around it declares ${n}, and ` +
        `the compiler's listener parameter is not visible to it. Take the event as a parameter of a function ` +
        `you write — ${shape} — and use that parameter where the handler reads ${n}${listing}${where2}.`;
    }
    out.push(new CGError("E-EVENT-UNBOUND", `E-EVENT-UNBOUND: ${text}`, span as never));
  }
  return out;
}
