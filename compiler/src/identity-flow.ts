/**
 * s468 (ruling S468 (2)(b), `g-param-default-identity-via-param-or-mutation-s467`) —
 * WHERE CAN A VALUE COME FROM, AT A LOCATION? The location-aware binding resolver
 * for the identity follower (free-name.ts `identityReadInDefaultDeep`), and the
 * index of every call of a function the compilation declares.
 *
 * The follower asks one question of a name: every place its value can come from.
 * binding-provenance.ts answers it per FILE (a name bound in two scopes is the union
 * of both). This module answers it at the place the name is READ:
 *
 *   - a parameter of a function / lambda in scope there → the parameter's default
 *     and the ARGUMENT every call of that function passes at its position (a call
 *     through a spread, `.call` / `.apply`, or raw text the parser keeps unparsed
 *     passes the whole call); a lambda passed to a method (`xs.forEach((x) => …)`)
 *     receives what the receiver and the other arguments hold; a lambda passed to a
 *     function of this compilation receives what that function passes when it calls
 *     the parameter; a handler lambda (`onclick=(e) => …`) receives the event;
 *   - a local of the function / lambda in scope there → its declarations in that
 *     body (binding-provenance over the body, filtered to bindings that belong to
 *     THIS scope) and every expression in that body that may write it by mutation
 *     (`o.push(v)`, `Object.assign(o, v)`, `f(o)`, `o.k = v`);
 *   - a loop / `<each>` binder in scope there → the iterated expression;
 *   - otherwise the FILE binding (binding-provenance `bindingsOfName`, `.scrml`
 *     imports and re-exports followed), filtered to the bindings that belong to the
 *     file scope, plus every expression in the file that may write it; a cell
 *     (`@x`) is always the file binding.
 *
 * Every resolution carries a `key` — the binding it resolved to — so the follower
 * visits each binding once however many names reach it.
 *
 * Over-reading is the fail-closed direction for the only reader (an identity check):
 * an owner scanned whole may carry more than the value it gives the name.
 */
import { bindingsOfFile, bindingsOfName, declaredNamesOf, type Binding } from "./binding-provenance.ts";
import type { IdentityNameResolution } from "./free-name.ts";
import { parseExprToNode, parseScrmlTextToEstree } from "./expression-parser.ts";
import { resolveProgramReferences } from "./codegen/js-async-analysis.ts";
import { toPosix } from "./path-canonical.js";

type AnyNode = Record<string, any>;

export interface IdentityFlowFile {
  filePath: string;
  nodes: unknown;
  imports: unknown;
}

export interface IdentityFlowInput {
  files: IdentityFlowFile[];
  resolveImport: ((source: string, importerPath: string) => string | null) | null;
  /** The plain names AND cells (`@x`) a node may write (assignment, update, mutating call). */
  writesOf: (node: unknown) => Set<string>;
}

/** One call of a function the compilation declares. */
export interface CallSite {
  /** The call node (`call`, a `call-ref` attribute value, or the raw-text node holding the call). */
  node: AnyNode;
  filePath: string;
  /** The argument expressions, in order; null when they cannot be read one by one (raw text). */
  args: AnyNode[] | null;
  /** The argument list was spread / passed whole (`f(...xs)`, `f.apply(t, xs)`) from this index on. */
  wholeFrom: number | null;
  /** The function is not CALLED here but passed along as a value (`xs.forEach(f)`, `onclick=f`). */
  byRef: boolean;
}

/** An owner the follower scans, with the location its free names resolve at. */
export interface LocatedOwner {
  params?: unknown;
  body?: unknown;
  _identityAt?: unknown;
}

const SCOPE_OWNER_KINDS = new Set(["function-decl", "lambda"]);
const DECL_KINDS = new Set(["let-decl", "const-decl", "lin-decl"]);

/** The leading identifier of a parameter entry (`"x"`, `"x: T"`, `{ name }`). */
function paramIdent(p: unknown): string | null {
  const raw = typeof p === "string" ? p : (p && typeof p === "object" ? (p as AnyNode).name : undefined);
  if (typeof raw !== "string") return null;
  const m = raw.trim().replace(/^\.\.\./, "").match(/^[A-Za-z_$][\w$]*/);
  return m ? m[0] : null;
}

/** The names one parameter binds (a destructured parameter binds several). */
function paramBoundNames(p: unknown): string[] {
  if (p && typeof p === "object") {
    const o = p as AnyNode;
    if (Array.isArray(o.boundNames) && o.boundNames.length > 0) return o.boundNames.filter((x: unknown) => typeof x === "string");
    if (o.pattern && typeof o.pattern === "object") return declaredNamesOf({ name: o.pattern });
  }
  const one = paramIdent(p);
  return one && one !== "__destructured__" ? [one] : [];
}

function isRestParam(p: unknown): boolean {
  if (typeof p === "string") return p.trim().startsWith("...");
  const o = p as AnyNode | null;
  return !!o && (o.isRest === true || o.rest === true || (typeof o.name === "string" && o.name.trim().startsWith("...")));
}

function isScopeOwner(n: AnyNode): boolean {
  if (SCOPE_OWNER_KINDS.has(n.kind)) return true;
  // A block-bodied arrow the parser keeps as raw text still declares its parameters.
  return n.kind === "escape-hatch" && Array.isArray(n.params);
}

function paramsOf(owner: AnyNode): unknown[] {
  return Array.isArray(owner.params) ? owner.params : [];
}

/** The statements / expression a scope owner's body holds (a lambda's expression body included). */
function bodyOf(owner: AnyNode): unknown {
  if (owner.kind === "lambda") {
    const b = owner.body;
    if (b && b.kind === "expr") return [b.value];
    if (b && b.kind === "block") return b.stmts;
    return [];
  }
  return owner.body;
}

/** A raw-text fragment a node holds unparsed (`escape-hatch`, a template literal, an untreed `bare-expr`). */
function rawTextOf(n: AnyNode): string | null {
  if (n.kind === "escape-hatch" && typeof n.raw === "string") return n.raw;
  if (n.kind === "lit" && n.litType === "template" && typeof n.raw === "string") return n.raw;
  if (n.kind === "bare-expr" && !n.exprNode && typeof n.expr === "string") return n.expr;
  return null;
}

export interface ResolverOpts {
  /** A §52 `<x server>` cell counts as an identity read (the §7.3.2 default check: yes). */
  serverCellIsIdentity: boolean;
  /**
   * Leave out a value source this predicate holds of (the argument check: a value
   * computed on the SERVER — a server function's body, a CPS server statement, a
   * `?{}` — is not a value the browser computed from the session; a server result
   * travelling back is the banked S468 (2)(d) question, not this refusal).
   */
  skip?: (node: unknown) => boolean;
  /**
   * A name assigned in raw text: follow the raw text that writes it (scanned whole)
   * — true — or refuse it as unfollowable (false; the §7.3.2 default check's
   * long-standing fail-closed reading, kept as is).
   */
  followRawAssigned: boolean;
}

export interface IdentityFlow {
  /** The resolver for `identityReadInDefaultDeep`: `(name, at)` → every value source of `name` read at `at`. */
  resolver: (filePath: string, opts: ResolverOpts) => (name: string, at?: unknown) => IdentityNameResolution;
  /** Every call of `fnNode` (a `function-decl`, or a lambda bound by a `const`) in the compilation. */
  callSitesOf: (fnNode: object) => CallSite[];
  /** Every call site in the compilation, keyed by the function it calls. */
  allCallSites: () => Map<object, CallSite[]>;
  /** The structural parent of a node (arrays transparent), or null. */
  parentOf: (node: unknown) => AnyNode | null;
  /** The file a node belongs to. */
  fileOf: (node: unknown) => string | null;
  /** The function-like node(s) `name` called at `at` resolves to (empty: not a function of this compilation). */
  calleeFnsAt: (name: string, at: unknown) => AnyNode[];
  /** Is `node` the value of a markup attribute (an event handler, a component prop)? */
  isAttributeValueUse: (node: AnyNode) => boolean;
}

export function buildIdentityFlow(input: IdentityFlowInput): IdentityFlow {
  const parent = new WeakMap<object, AnyNode | null>();
  const fileOfNode = new WeakMap<object, string>();
  const fileByPath = new Map<string, IdentityFlowFile>();
  /** Per file: every node that may write some name, and the names. */
  const writersByFile = new Map<string, Map<string, AnyNode[]>>();
  /** Every node of a file (for the call-site pass), in walk order. */
  const nodesByFile = new Map<string, AnyNode[]>();

  for (const f of input.files) {
    fileByPath.set(toPosix(f.filePath), f);
    const all: AnyNode[] = [];
    const seen = new WeakSet<object>();
    const walk = (node: unknown, owner: AnyNode | null): void => {
      if (!node || typeof node !== "object" || seen.has(node as object)) return;
      seen.add(node as object);
      if (Array.isArray(node)) { for (const c of node) walk(c, owner); return; }
      const n = node as AnyNode;
      parent.set(n, owner);
      fileOfNode.set(n, f.filePath);
      all.push(n);
      for (const k of Object.keys(n)) {
        if (k === "span") continue;
        const v = n[k];
        if (v && typeof v === "object") walk(v, n);
      }
    };
    walk(f.nodes, null);
    nodesByFile.set(f.filePath, all);
  }

  const parentOf = (node: unknown): AnyNode | null =>
    node && typeof node === "object" ? (parent.get(node as object) ?? null) : null;
  const fileOf = (node: unknown): string | null =>
    node && typeof node === "object" ? (fileOfNode.get(node as object) ?? null) : null;

  /**
   * Writers: the SMALLEST nodes that may write a name — an assignment, an update, a
   * call, raw text. (Not a whole statement: a `for` / `if` would make every identity
   * read in its body a source of every name written anywhere in it. A `for … of`
   * variable is a binder, resolved to its iterable.)
   */
  const WRITER_KINDS = new Set([
    "assign", "unary", "update", "call", "tilde-decl", "reactive-nested-assign", "reactive-array-mutation",
    "reactive-explicit-set", "state-decl",
  ]);
  const writersOf = (filePath: string): Map<string, AnyNode[]> => {
    let m = writersByFile.get(filePath);
    if (m) return m;
    m = new Map();
    writersByFile.set(filePath, m);
    for (const n of nodesByFile.get(filePath) ?? []) {
      const isWriter = WRITER_KINDS.has(n.kind) || n._bareAssign === true || rawTextOf(n) !== null;
      if (!isWriter) continue;
      let names: Set<string>;
      try { names = input.writesOf(n); } catch { continue; }
      for (const nm of names) {
        const list = m.get(nm) ?? [];
        list.push(n);
        m.set(nm, list);
      }
    }
    return m;
  };

  // ---- scopes ----------------------------------------------------------------

  /** The names a scope owner's own body declares (not a nested function's), with the decl nodes. */
  const directDeclCache = new WeakMap<object, Set<string>>();
  const directDecls = (owner: AnyNode): Set<string> => {
    const hit = directDeclCache.get(owner);
    if (hit) return hit;
    const out = new Set<string>();
    directDeclCache.set(owner, out);
    const seen = new WeakSet<object>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object" || seen.has(node as object)) return;
      seen.add(node as object);
      if (Array.isArray(node)) { for (const c of node) walk(c); return; }
      const n = node as AnyNode;
      if (n.kind === "function-decl") { if (typeof n.name === "string" && n.name) out.add(n.name); return; }
      if (isScopeOwner(n)) return;
      if (DECL_KINDS.has(n.kind) && n._bareAssign !== true) for (const nm of declaredNamesOf(n)) out.add(nm);
      for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
    };
    walk(bodyOf(owner));
    return out;
  };

  /** The binders that are not scope owners: a `for … of` variable, an `<each … as x>` name. */
  const binderSources = (n: AnyNode, child: AnyNode | null, name: string): AnyNode[] | null => {
    if (n.kind === "for-stmt" && n.variable) {
      const names = typeof n.variable === "string" ? [paramIdent(n.variable) ?? ""] : declaredNamesOf({ name: n.variable });
      if (!names.includes(name)) return null;
      if (child !== null && (child === n.iterExpr)) return null;
      const src = n.iterExpr ?? (typeof n.iterable === "string" ? parseLoose(n.iterable, n) : null);
      return src ? [src] : [];
    }
    if (n.kind === "each-block") {
      const names = [n.asName, ...(Array.isArray(n.asNames) ? n.asNames : [])].filter((x) => typeof x === "string");
      if (!names.includes(name)) return null;
      const out: AnyNode[] = [];
      for (const k of ["inExprRaw", "ofExprRaw"]) {
        const t = n[k];
        if (typeof t === "string" && t.trim()) {
          const p = parseLoose(t, n);
          if (p) out.push(p);
        }
      }
      return out;
    }
    return null;
  };

  /**
   * A string expression the tree does not hold (an `<each in=…>` expression, an
   * untreed `for` iterable), parsed ONCE per (node, text) and anchored at `at` (its
   * free names resolve there).
   */
  const looseCache = new WeakMap<object, Map<string, AnyNode | null>>();
  const parseLoose = (text: string, at: AnyNode): AnyNode | null => {
    let perNode = looseCache.get(at);
    if (!perNode) { perNode = new Map(); looseCache.set(at, perNode); }
    if (perNode.has(text)) return perNode.get(text) ?? null;
    const fp = fileOf(at) ?? "";
    let node: AnyNode | null;
    try { node = parseExprToNode(text, fp, 0) as unknown as AnyNode; } catch { node = null; }
    if (node && typeof node === "object") {
      // anchor the parsed tree where the text sits
      const seen = new WeakSet<object>();
      const anchor = (x: unknown, p: AnyNode): void => {
        if (!x || typeof x !== "object" || seen.has(x as object)) return;
        seen.add(x as object);
        if (Array.isArray(x)) { for (const c of x) anchor(c, p); return; }
        parent.set(x as object, p);
        fileOfNode.set(x as object, fp);
        for (const k of Object.keys(x as AnyNode)) if (k !== "span") anchor((x as AnyNode)[k], x as AnyNode);
      };
      anchor(node, at);
    }
    perNode.set(text, node);
    return node;
  };

  type Scope =
    | { kind: "param"; owner: AnyNode; index: number }
    | { kind: "local"; owner: AnyNode }
    | { kind: "binder"; node: AnyNode; sources: AnyNode[] }
    | { kind: "file"; filePath: string };

  /** Where `name`, read at `at`, is bound. */
  const scopeOf = (name: string, at: unknown): Scope => {
    let child: AnyNode | null = null;
    let cur: AnyNode | null = at && typeof at === "object" ? (at as AnyNode) : null;
    const fp = fileOf(at) ?? "";
    while (cur) {
      if (isScopeOwner(cur)) {
        const ps = paramsOf(cur);
        for (let i = 0; i < ps.length; i++) if (paramBoundNames(ps[i]).includes(name)) return { kind: "param", owner: cur, index: i };
        if (cur.kind !== "escape-hatch" && directDecls(cur).has(name)) return { kind: "local", owner: cur };
      } else {
        const src = binderSources(cur, child, name);
        if (src !== null) return { kind: "binder", node: cur, sources: src };
      }
      child = cur;
      cur = parentOf(cur);
    }
    return { kind: "file", filePath: fp };
  };

  const sameScope = (a: Scope, b: Scope): boolean => {
    if (a.kind !== b.kind) return false;
    if (a.kind === "file" && b.kind === "file") return toPosix(a.filePath) === toPosix(b.filePath);
    if (a.kind === "local" && b.kind === "local") return a.owner === b.owner;
    if (a.kind === "param" && b.kind === "param") return a.owner === b.owner && a.index === b.index;
    if (a.kind === "binder" && b.kind === "binder") return a.node === b.node;
    return false;
  };

  /** The location a binding's value is read at (where its free names resolve). */
  const bindingAt = (b: Binding): AnyNode | null => (b.kind === "fn" || b.kind === "expr") ? b.node : null;

  /** A function's scope position is its parent's (a `function f` binds `f` where it is declared). */
  const scopeOfBinding = (name: string, b: Binding): Scope | null => {
    const at = bindingAt(b);
    if (!at || !parent.has(at)) return null; // parsed afresh / not in a held tree: unknown position
    return scopeOf(name, b.kind === "fn" ? (parentOf(at) ?? at) : at);
  };

  const located = (node: AnyNode, params: unknown = []): LocatedOwner => ({ params, body: [node], _identityAt: node });

  /** binding-provenance over a scope owner's body (every depth; filtered by scope at the use). */
  const ownProvCache = new WeakMap<object, Map<string, Binding[]>>();
  const ownProvenance = (owner: AnyNode): Map<string, Binding[]> => {
    let m = ownProvCache.get(owner);
    if (!m) {
      m = bindingsOfFile({ filePath: fileOf(owner) ?? "", nodes: bodyOf(owner), imports: [] }, null, () => false);
      ownProvCache.set(owner, m);
    }
    return m;
  };

  // ---- call sites --------------------------------------------------------------

  let callIndex: Map<object, CallSite[]> | null = null;

  /** `name` at `at` → the function-like nodes it denotes (a `function-decl`; a `const` bound to a lambda). */
  const calleeFnsAt = (name: string, at: unknown): AnyNode[] => {
    if (typeof name !== "string" || !name || name.startsWith("@")) return [];
    const sc = scopeOf(name, at);
    if (sc.kind === "param" || sc.kind === "binder") return [];
    const fnLikeOf = (b: Binding): AnyNode | null => {
      if (b.kind === "fn") return b.node;
      if (b.kind === "expr" && b.node && b.node.kind === "lambda") return b.node;
      return null;
    };
    if (sc.kind === "local") {
      const out: AnyNode[] = [];
      for (const b of ownProvenance(sc.owner).get(name) ?? []) {
        const s = scopeOfBinding(name, b);
        if (s && !sameScope(s, sc)) continue;
        const f = fnLikeOf(b);
        if (f) out.push(f);
      }
      return out;
    }
    const out: AnyNode[] = [];
    forEachFileBinding(sc.filePath, name, (b) => { const f = fnLikeOf(b); if (f) out.push(f); }, () => {});
    return out;
  };

  /** The file-scope bindings of `name` in `filePath` (imports / re-exports followed). */
  const provenanceOf = (fp: string): Map<string, Binding[]> | null => {
    const f = fileByPath.get(toPosix(fp));
    if (!f) return null;
    return bindingsOfFile(f, input.resolveImport, (abs) => fileByPath.has(toPosix(abs)));
  };
  const forEachFileBinding = (
    filePath: string,
    name: string,
    onBinding: (b: Binding, fp: string) => void,
    onOther: (b: Binding) => void,
  ): void => {
    const seenAlias = new Set<string>();
    const resolveIn = (fp: string, nm: string, viaImport: boolean): void => {
      const key = `${toPosix(fp)}::${nm}`;
      if (seenAlias.has(key)) return;
      seenAlias.add(key);
      for (const b of bindingsOfName(fp, nm, viaImport, provenanceOf)) {
        if (b.kind === "alias") { resolveIn(b.filePath, b.name, b.filePath !== fp || viaImport); continue; }
        if (b.kind === "fn" || b.kind === "expr") {
          const s = scopeOfBinding(nm, b);
          // A binding that belongs to a function / lambda / loop scope is not this file binding.
          if (s !== null && s.kind !== "file") continue;
          onBinding(b, fp);
          continue;
        }
        onOther(b);
      }
    };
    resolveIn(filePath, name, false);
  };

  const buildCallIndex = (): Map<object, CallSite[]> => {
    const idx = new Map<object, CallSite[]>();
    // Only a name some function-like binding (a function, a `const` lambda, an
    // import) carries can denote one — a cheap pre-filter for the by-reference walk.
    const fnLikeNames = new Set<string>();
    for (const nodes of nodesByFile.values()) {
      for (const n of nodes) {
        if (n.kind === "function-decl" && typeof n.name === "string") fnLikeNames.add(n.name);
        else if ((DECL_KINDS.has(n.kind) || n.kind === "tilde-decl") && n.initExpr && n.initExpr.kind === "lambda") for (const nm of declaredNamesOf(n)) fnLikeNames.add(nm);
        else if (n.kind === "export-decl" && typeof n.exportedName === "string" && n.valueInitExpr && n.valueInitExpr.kind === "lambda") fnLikeNames.add(n.exportedName);
        else if (n.kind === "assign" && n.value && n.value.kind === "lambda" && n.target && n.target.kind === "ident" && typeof n.target.name === "string") fnLikeNames.add(n.target.name);
        else if (n.kind === "import-decl" && Array.isArray(n.specifiers)) {
          for (const s of n.specifiers) if (s && typeof s.local === "string") fnLikeNames.add(s.local);
        }
      }
    }
    for (const f of fileByPath.values()) {
      for (const imp of Array.isArray(f.imports) ? (f.imports as AnyNode[]) : []) {
        for (const s of (imp && Array.isArray(imp.specifiers) ? imp.specifiers : [])) if (s && typeof s.local === "string") fnLikeNames.add(s.local);
      }
    }
    const push = (fn: AnyNode, site: CallSite): void => {
      const list = idx.get(fn) ?? [];
      list.push(site);
      idx.set(fn, list);
    };
    const fnsAt = (name: string, at: unknown): AnyNode[] => (fnLikeNames.has(name) ? calleeFnsAt(name, at) : []);
    for (const [filePath, nodes] of nodesByFile) {
      for (const n of nodes) {
        if (n.kind === "call" && n.callee && typeof n.callee === "object") {
          const c = n.callee as AnyNode;
          const args: AnyNode[] = Array.isArray(n.args) ? n.args : [];
          if (c.kind === "ident" && typeof c.name === "string") {
            const spreadAt = args.findIndex((a) => a && a.kind === "spread");
            for (const fn of fnsAt(c.name, n)) push(fn, { node: n, filePath, args, wholeFrom: spreadAt >= 0 ? spreadAt : null, byRef: false });
          } else if (c.kind === "member" && c.object && c.object.kind === "ident" && (c.property === "call" || c.property === "apply")) {
            for (const fn of fnsAt(c.object.name, n)) {
              if (c.property === "call") push(fn, { node: n, filePath, args: args.slice(1), wholeFrom: args.slice(1).findIndex((a) => a && a.kind === "spread") >= 0 ? 0 : null, byRef: false });
              else push(fn, { node: n, filePath, args: args.slice(1), wholeFrom: 0, byRef: false });
            }
          }
          continue;
        }
        if (n.kind === "call-ref" && typeof n.name === "string") {
          const args: AnyNode[] = Array.isArray(n.argExprNodes) ? n.argExprNodes : [];
          const whole = Array.isArray(n.args) && args.length !== n.args.length;
          for (const fn of fnsAt(n.name, n)) push(fn, { node: n, filePath, args: whole ? null : args, wholeFrom: whole ? 0 : null, byRef: false });
          continue;
        }
        if (n.kind === "variable-ref" && typeof n.name === "string") {
          for (const fn of fnsAt(n.name, n)) push(fn, { node: n, filePath, args: [], wholeFrom: null, byRef: true });
          continue;
        }
        if (n.kind === "ident" && typeof n.name === "string" && !n.name.startsWith("@")) {
          // a function passed along as a value (not the callee of a call)
          const p = parentOf(n);
          if (p && p.kind === "call" && p.callee === n) continue;
          if (p && p.kind === "assign" && p.target === n) continue; // `f = …` rebinds f; it does not pass it
          if (p && p.kind === "member" && p.object === n && p.property !== undefined) {
            const gp = parentOf(p);
            if (gp && gp.kind === "call" && gp.callee === p) continue; // `f.call(…)` / `f.apply(…)` handled above; `f.x()` is not a call of f
          }
          const fns = fnsAt(n.name, n);
          if (fns.length === 0) continue;
          for (const fn of fns) if (fn !== p) push(fn, { node: n, filePath, args: [], wholeFrom: null, byRef: true });
          continue;
        }
        const raw = rawTextOf(n);
        if (raw !== null) {
          for (const name of rawCalledFreeNames(raw)) {
            for (const fn of fnsAt(name, n)) push(fn, { node: n, filePath, args: null, wholeFrom: 0, byRef: false });
          }
        }
      }
    }
    return idx;
  };

  const callSitesOf = (fnNode: object): CallSite[] => {
    if (!callIndex) callIndex = buildCallIndex();
    return callIndex.get(fnNode) ?? [];
  };

  /**
   * Is `node` (an ident, a lambda, a `variable-ref`) the VALUE of a markup attribute
   * (`onclick=f`, `onclick=${f}`, `onclick=${(e) => …}`, a component prop `onGo=f`)?
   */
  const isAttributeValueUse = (node: AnyNode): boolean => {
    let n: AnyNode = node;
    let p = parentOf(n);
    if (p && (p.kind === "variable-ref" || p.kind === "expr") && p.exprNode === n) { n = p; p = parentOf(p); }
    return !!p && typeof p.name === "string" && p.value === n && p.kind === undefined;
  };

  // ---- parameter sources -------------------------------------------------------

  /** Sources of a lambda's parameters from where the lambda is passed. */
  const lambdaArgSources = (lam: AnyNode, index: number): { owners: LocatedOwner[]; unresolved: string | null } => {
    const owners: LocatedOwner[] = [];
    const p = parentOf(lam);
    if (p && p.kind === "call" && Array.isArray(p.args) && p.args.includes(lam)) {
      const c = p.callee as AnyNode;
      for (const a of p.args) if (a !== lam && a && typeof a === "object") owners.push(located(a));
      if (c && (c.kind === "member" || c.kind === "index")) {
        if (c.object && typeof c.object === "object") owners.push(located(c.object));
        return { owners, unresolved: null };
      }
      if (c && c.kind === "ident" && typeof c.name === "string") {
        const fns = calleeFnsAt(c.name, p);
        if (fns.length === 0) return { owners, unresolved: null }; // a global / import: it is handed the other arguments
        const j = p.args.indexOf(lam);
        for (const g of fns) {
          const gp = paramsOf(g)[j];
          const pn = gp ? paramIdent(gp) : null;
          if (!pn) continue;
          // every call `pn(…)` inside g passes argument `index`; any other use of pn hands it on
          let other = false;
          const gseen = new WeakSet<object>();
          const walk = (x: unknown): void => {
            if (!x || typeof x !== "object" || gseen.has(x as object)) return;
            gseen.add(x as object);
            if (Array.isArray(x)) { for (const y of x) walk(y); return; }
            const o = x as AnyNode;
            if (o.kind === "ident" && o.name === pn) {
              const op = parentOf(o);
              const sc = scopeOf(pn, o);
              if (sc.kind === "param" && sc.owner === g) {
                if (op && op.kind === "call" && op.callee === o) {
                  const as: AnyNode[] = Array.isArray(op.args) ? op.args : [];
                  const spread = as.findIndex((a) => a && a.kind === "spread");
                  if (spread >= 0 && spread <= index) { for (const a of as.slice(spread)) owners.push(located(a)); }
                  else if (as[index]) owners.push(located(as[index]));
                } else other = true;
              }
            }
            const raw = rawTextOf(o);
            if (raw !== null && rawReadsName(raw, pn)) owners.push(located(o));
            for (const k of Object.keys(o)) if (k !== "span") walk(o[k]);
          };
          walk(bodyOf(g));
          if (other) return { owners, unresolved: `the callback is handed on by \`${typeof g.name === "string" ? g.name : "a function"}\`` };
        }
        return { owners, unresolved: null };
      }
      return { owners, unresolved: null };
    }
    // a handler: `onclick=(e) => …` receives the event (a component prop: see callArgOwners)
    if (isAttributeValueUse(lam)) return { owners, unresolved: null };
    // A lambda bound to a name — `const f = (u) => …`, `let f = …` / `f = …` (a
    // reassignment), `export const f = …` — receives what every call of that name
    // passes (the call index keys those calls to this lambda through the binding).
    if (p && (
      ((DECL_KINDS.has(p.kind) || p.kind === "tilde-decl") && p.initExpr === lam) ||
      (p.kind === "export-decl" && p.valueInitExpr === lam) ||
      (p.kind === "assign" && p.value === lam)
    )) {
      const r = callArgOwners(lam, index);
      return { owners: [...owners, ...r.owners], unresolved: r.unresolved };
    }
    return { owners, unresolved: "the callback's arguments cannot be followed" };
  };

  /** Sources of argument `index` at every call of `fn`. */
  const callArgOwners = (fn: AnyNode, index: number): { owners: LocatedOwner[]; unresolved: string | null } => {
    const owners: LocatedOwner[] = [];
    let unresolved: string | null = null;
    const rest = isRestParam(paramsOf(fn)[index]);
    for (const site of callSitesOf(fn)) {
      if (site.byRef) {
        const p = parentOf(site.node);
        // A markup attribute value: a DOM event handler receives the event; a
        // component prop is invoked by the component's expansion, whose calls of it
        // are call sites of their own (component expansion substitutes the name).
        if (isAttributeValueUse(site.node)) continue;
        if (p && p.kind === "call" && Array.isArray(p.args) && p.args.includes(site.node)) {
          const c = p.callee as AnyNode;
          for (const a of p.args) if (a !== site.node && a && typeof a === "object") owners.push(located(a));
          if (c && (c.kind === "member" || c.kind === "index") && c.object) owners.push(located(c.object));
          continue;
        }
        unresolved = unresolved ?? `\`${fn.name ?? "the function"}\` is passed as a value`;
        continue;
      }
      if (site.args === null) { owners.push(located(site.node)); continue; }
      if (site.wholeFrom !== null && site.wholeFrom <= index) { for (const a of site.args.slice(site.wholeFrom)) owners.push(located(a)); continue; }
      if (rest) { for (const a of site.args.slice(index)) owners.push(located(a)); continue; }
      const a = site.args[index];
      if (a && typeof a === "object") owners.push(located(a));
    }
    return { owners, unresolved };
  };

  const paramSources = (owner: AnyNode, index: number): { owners: LocatedOwner[]; unresolved: string | null } => {
    const out: LocatedOwner[] = [];
    const p = paramsOf(owner)[index] as AnyNode | undefined;
    const def = p && typeof p === "object" ? (p.defaultValue ?? p.defaultExpr ?? null) : null;
    if (def && typeof def === "object") out.push({ params: paramsOf(owner), body: [def], _identityAt: owner });
    if (owner.kind === "function-decl") {
      const r = callArgOwners(owner, index);
      return { owners: [...out, ...r.owners], unresolved: r.unresolved };
    }
    const r = lambdaArgSources(owner, index);
    return { owners: [...out, ...r.owners], unresolved: r.unresolved };
  };

  // ---- the resolver ------------------------------------------------------------

  const idOf = (() => {
    const ids = new WeakMap<object, number>();
    let next = 0;
    return (o: object): number => { let v = ids.get(o); if (v === undefined) { v = ++next; ids.set(o, v); } return v; };
  })();

  /**
   * A name ASSIGNED in raw text has no parsed value (binding-provenance marks it
   * `unresolved`); the raw node that writes it is one of the name's writers and is
   * scanned whole, so that provenance is followed, not refused.
   */
  const RAW_ASSIGN_WHY = "it is assigned in raw text the compiler does not parse";

  const resolver = (filePath: string, opts: ResolverOpts) => (name: string, at?: unknown): IdentityNameResolution => {
    const loc = at && typeof at === "object" ? (((at as AnyNode)._identityAt as AnyNode | undefined) ?? (at as AnyNode)) : null;
    const fp = (loc && fileOf(loc)) || filePath;
    const sc: Scope = name.startsWith("@") || !loc || !parent.has(loc) ? { kind: "file", filePath: fp } : scopeOf(name, loc);
    // An owner computed on the server is not a browser value (`opts.skip`).
    const keep = (o: unknown): boolean => !opts.skip || !opts.skip(o && typeof o === "object" && (o as AnyNode)._identityAt ? (o as AnyNode)._identityAt : o);
    const finish = (r: { owners: LocatedOwner[]; serverCell?: string | null; unresolved?: string | null; key: string }): IdentityNameResolution =>
      ({ ...r, owners: r.owners.filter(keep) });
    if (sc.kind === "param") {
      const r = paramSources(sc.owner, sc.index);
      return finish({ owners: r.owners, unresolved: r.unresolved, key: `param:${idOf(sc.owner)}:${sc.index}` });
    }
    if (sc.kind === "binder") {
      return finish({ owners: sc.sources.map((s) => located(s)), key: `binder:${idOf(sc.node)}:${name}` });
    }
    if (sc.kind === "local") {
      const owners: LocatedOwner[] = [];
      let unresolved: string | null = null;
      for (const b of ownProvenance(sc.owner).get(name) ?? []) {
        const s = scopeOfBinding(name, b);
        if (s && !sameScope(s, sc)) continue;
        if (b.kind === "fn") owners.push(b.node);
        else if (b.kind === "expr") owners.push(located(b.node));
        else if (b.kind === "unresolved" && !(opts.followRawAssigned && b.why === RAW_ASSIGN_WHY)) unresolved = unresolved ?? b.why;
      }
      for (const w of writersOf(fp).get(name) ?? []) {
        const s = scopeOf(name, w);
        if (sameScope(s, sc)) owners.push(located(w));
      }
      return finish({ owners, unresolved, key: `local:${idOf(sc.owner)}:${name}` });
    }
    // the file binding
    const owners: LocatedOwner[] = [];
    let serverCell: string | null = null;
    let unresolved: string | null = null;
    let any = false;
    forEachFileBinding(sc.filePath, name, (b) => {
      any = true;
      if (b.kind === "fn") owners.push(b.node);
      else if (b.kind === "expr") owners.push(located(b.node));
    }, (b) => {
      any = true;
      if (b.kind === "server-cell") { if (opts.serverCellIsIdentity) serverCell = serverCell ?? b.name; }
      else if (b.kind === "unresolved" && !(opts.followRawAssigned && b.why === RAW_ASSIGN_WHY)) unresolved = unresolved ?? b.why;
    });
    for (const w of writersOf(sc.filePath).get(name) ?? []) {
      if (!name.startsWith("@") && scopeOf(name, w).kind !== "file") continue;
      any = true;
      owners.push(located(w));
    }
    if (!any) return null;
    return finish({ owners, serverCell, unresolved, key: `file:${toPosix(sc.filePath)}:${name}` });
  };

  return {
    resolver,
    callSitesOf,
    allCallSites: () => { if (!callIndex) callIndex = buildCallIndex(); return callIndex; },
    parentOf,
    fileOf,
    calleeFnsAt,
    isAttributeValueUse,
  };
}

/** The free names raw text CALLS (`f(…)`, `f.call(…)`, `f.apply(…)`) with at least one argument. */
export function rawCalledFreeNames(raw: string): string[] {
  const ast = parseScrmlTextToEstree(raw, false) ?? parseScrmlTextToEstree(raw, true);
  if (!ast) return [];
  const a = ast as unknown as { type?: string };
  const program = a.type === "Program"
    ? ast
    : ({ type: "Program", sourceType: "module", body: [{ type: "ExpressionStatement", expression: ast }] } as unknown as typeof ast);
  const free = new Set<unknown>();
  for (const [id, binding] of resolveProgramReferences(program as never)) if (binding === undefined) free.add(id);
  const out: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (x: unknown): void => {
    if (!x || typeof x !== "object" || seen.has(x as object)) return;
    seen.add(x as object);
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    const o = x as AnyNode;
    if (o.type === "CallExpression" && Array.isArray(o.arguments) && o.arguments.length > 0) {
      const c = o.callee as AnyNode;
      if (c && c.type === "Identifier" && free.has(c)) out.push(c.name);
      else if (c && c.type === "MemberExpression" && !c.computed && c.object && c.object.type === "Identifier" && free.has(c.object)
        && c.property && (c.property.name === "call" || c.property.name === "apply")) out.push(c.object.name);
    }
    for (const k of Object.keys(o)) if (k !== "loc") walk(o[k]);
  };
  walk(program);
  return out;
}

/** Does raw text read `name` as a free identifier? (acorn scope model) */
function rawReadsName(raw: string, name: string): boolean {
  const ast = parseScrmlTextToEstree(raw, false) ?? parseScrmlTextToEstree(raw, true);
  if (!ast) return raw.includes(name);
  const a = ast as unknown as { type?: string };
  const program = a.type === "Program"
    ? ast
    : ({ type: "Program", sourceType: "module", body: [{ type: "ExpressionStatement", expression: ast }] } as unknown as typeof ast);
  for (const [id, binding] of resolveProgramReferences(program as never)) {
    if ((id as AnyNode).name === name && binding === undefined) return true;
  }
  return false;
}
