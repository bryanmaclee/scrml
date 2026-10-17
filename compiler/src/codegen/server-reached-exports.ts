/**
 * s466 fix round 5 — which EXPORTED functions of an imported `.scrml` library
 * does server code in this compilation actually reach?
 *
 * Every exported function of a library is emitted into the library's
 * `.server.js` (emit-server `emitModuleValueExportLines`), so being in the
 * server bundle says nothing about whether server code ever runs it. The §7.3.2
 * closed-set check on parameter defaults (E-PARAM-DEFAULT-UNSUPPORTED) is
 * scoped to SERVER-PLACED functions; a library function that only client code
 * calls is a client function there, exactly as the same function declared in
 * the app file is.
 *
 * A library function is server-reached when, anywhere in the compilation:
 *   - SERVER-RUN code names it, directly or through any chain of bindings:
 *     a function the route map places off the client (server / middleware,
 *     CPS-split included — its whole body is read, an over-read), a channel's
 *     `onserver:*` handler expression, a §52 server cell's initialiser; or
 *   - it is an async exported function (its body runs a `?{}` query, or calls
 *     one — a server operation), or one of those names it.
 *
 * Reachability is by IDENTIFIER TOKEN over the whole subtree (every string
 * field at any depth), the same rule as route inference's pure-fn side
 * placement, followed through EVERY binding the token names (s466 fix round 6,
 * binding-provenance.ts — the identity check's binding follower): a file-scope
 * function, a `const w = (m) => fmt(m)` / `const w = fmt` / `let` (every value
 * it is given), an import, a re-export, `export *`. Over-collection marks too
 * much as server-reached — the check then refuses more, which is the
 * fail-closed direction. A binding whose provenance cannot be followed (a name
 * assigned in raw text, a name the imported module does not declare) marks
 * EVERY file-scope function of that module reached (fail closed).
 *
 * Only files some other file in the compilation imports get an entry. A file no
 * one imports (a library compiled on its own, an app file with exports) serves
 * consumers outside the compilation, so every exported function there stays
 * server-placed — callers read a missing entry that way.
 */
import { toPosix } from "../path-canonical.js";
import { bindingsOfFile, bindingsOfName, type Binding } from "../binding-provenance.ts";

type AnyNode = Record<string, unknown>;

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function collectTokens(node: unknown, out: Set<string>, seen: Set<unknown>): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    IDENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENT_RE.exec(node)) !== null) out.add(m[0]);
    return;
  }
  if (typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { for (const c of node) collectTokens(c, out, seen); return; }
  for (const key of Object.keys(node as object)) {
    if (key === "span") continue;
    collectTokens((node as AnyNode)[key], out, seen);
  }
}

interface FileFacts {
  /** posix key (matches import resolution). */
  filePath: string;
  /** the file AST's own `filePath` (the route map's function ids use it). */
  rawPath: string;
  /** file-scope function-decls by name (a name may be declared more than once). */
  fileScopeFns: Map<string, AnyNode[]>;
  /** every function-decl, nested included. */
  allFns: AnyNode[];
  /** server-run code that is not a function-decl: `onserver:*` handler values, server-cell initialisers. */
  serverRunNodes: unknown[];
  /** the provenance view of the file. */
  pv: { filePath: string; nodes: unknown; imports: unknown };
}

function factsOf(fileAST: AnyNode): FileFacts | null {
  const rawPath = typeof fileAST.filePath === "string" ? fileAST.filePath : null;
  if (!rawPath) return null;
  const filePath = toPosix(rawPath);
  const ast = (fileAST.ast ?? null) as AnyNode | null;
  const nodes = (fileAST.nodes ?? (ast ? ast.nodes : null) ?? []) as unknown[];
  const fileScopeFns = new Map<string, AnyNode[]>();
  const allFns: AnyNode[] = [];
  const serverRunNodes: unknown[] = [];
  const find = (node: unknown, insideFn: boolean, seen: Set<unknown>): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const c of node) find(c, insideFn, seen); return; }
    const n = node as AnyNode;
    let inner = insideFn;
    if (n.kind === "function-decl") {
      allFns.push(n);
      if (!insideFn && typeof n.name === "string" && n.name) {
        const list = fileScopeFns.get(n.name) ?? [];
        list.push(n);
        fileScopeFns.set(n.name, list);
      }
      inner = true;
    } else if (n.kind === "markup" && Array.isArray(n.attrs)) {
      for (const a of n.attrs as AnyNode[]) {
        if (a && typeof a.name === "string" && a.name.startsWith("onserver:")) serverRunNodes.push(a.value);
      }
    } else if (n.kind === "state-decl" && n.isServer === true) {
      serverRunNodes.push(n.initExpr ?? null, n.sqlNode ?? null, typeof n.init === "string" ? n.init : null);
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") find(v, inner, seen);
    }
  };
  find(nodes, false, new Set());
  const imports = (ast?.imports ?? fileAST.imports ?? []) as unknown;
  return { filePath, rawPath, fileScopeFns, allFns, serverRunNodes, pv: { filePath: rawPath, nodes, imports } };
}

/**
 * Map: posix absolute path of every library some file in `files` imports →
 * the names of its file-scope bindings server code reaches (see above).
 *
 * `resolveImport(source, importerPath)` — module-resolver `resolveModulePath`.
 * `isOffClient(filePath, fnNode)` (the file AST's own path) — the route map places this function off the
 * client. `asyncExportNames(fileAST)` — the file's async exported functions.
 */
export function computeServerReachedExports(
  files: readonly unknown[],
  isOffClient: (filePath: string, fnNode: AnyNode) => boolean,
  asyncExportNames: (fileAST: unknown) => ReadonlySet<string>,
  resolveImport: (source: string, importerPath: string) => string | null,
): Map<string, Set<string>> {
  const facts = new Map<string, FileFacts>();
  const astByPath = new Map<string, unknown>();
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const ff = factsOf(f as AnyNode);
    if (!ff) continue;
    facts.set(ff.filePath, ff);
    astByPath.set(ff.filePath, f);
  }
  const holds = (abs: string): boolean => facts.has(toPosix(abs));
  const provenanceOf = (fp: string): Map<string, Binding[]> | null => {
    const ff = facts.get(toPosix(fp));
    return ff ? bindingsOfFile(ff.pv, resolveImport, holds) : null;
  };
  const imported = new Set<string>();
  for (const ff of facts.values()) {
    for (const bs of (provenanceOf(ff.filePath) ?? new Map<string, Binding[]>()).values()) {
      for (const b of bs) if (b.kind === "alias" || b.kind === "star") if (toPosix(b.filePath) !== ff.filePath) imported.add(toPosix(b.filePath));
    }
  }

  const reached = new Map<string, Set<string>>();
  const allReached = new Set<string>();
  const stack: Array<[string, string]> = [];
  const reach = (file: string, name: string): void => {
    let set = reached.get(file);
    if (!set) { set = new Set(); reached.set(file, set); }
    if (set.has(name)) return;
    set.add(name);
    stack.push([file, name]);
  };
  const reachAllOf = (file: string): void => {
    const ff = facts.get(file);
    if (!ff || allReached.has(file)) return;
    allReached.add(file);
    for (const name of ff.fileScopeFns.keys()) reach(file, name);
  };
  /** A token SERVER-RUN code in `file` names: reach it if the file binds it. */
  const follow = (file: string, tokens: Iterable<string>, viaImport: boolean): void => {
    for (const t of tokens) {
      const bs = bindingsOfName(file, t, viaImport, provenanceOf);
      if (bs.length > 0) reach(file, t);
    }
  };

  // Seeds.
  for (const ff of facts.values()) {
    const roots = new Set<string>();
    for (const fn of ff.allFns) {
      if (isOffClient(ff.rawPath, fn)) collectTokens(fn, roots, new Set());
    }
    for (const n of ff.serverRunNodes) collectTokens(n, roots, new Set());
    follow(ff.filePath, roots, false);
    for (const name of asyncExportNames(astByPath.get(ff.filePath))) {
      if (ff.fileScopeFns.has(name)) reach(ff.filePath, name);
    }
  }
  // Closure — every value source of a reached name is server-run code too.
  while (stack.length > 0) {
    const [file, name] = stack.pop()!;
    for (const b of bindingsOfName(file, name, true, provenanceOf)) {
      if (b.kind === "fn" || b.kind === "expr") {
        // Reached through `export *`: the binding lives in the source module —
        // mark it reached THERE (its emitter reads that module's set).
        if (toPosix(b.filePath) !== file) reach(toPosix(b.filePath), name);
        const toks = new Set<string>();
        collectTokens(b.node, toks, new Set());
        follow(toPosix(b.filePath), toks, false);
      } else if (b.kind === "alias") {
        const target = toPosix(b.filePath);
        if (bindingsOfName(target, b.name, true, provenanceOf).length > 0) reach(target, b.name);
      } else if (b.kind === "unresolved") {
        reachAllOf(file); // not followable precisely — fail closed
      }
    }
  }

  const out = new Map<string, Set<string>>();
  for (const file of imported) {
    if (!facts.has(file)) continue;
    out.set(file, reached.get(file) ?? new Set());
  }
  return out;
}
