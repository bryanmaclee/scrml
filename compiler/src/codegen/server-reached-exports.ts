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
 *   - a function the route map places off the client (server / middleware,
 *     CPS-split included — its whole body is read, an over-read) names it,
 *     directly or through any chain of file-scope functions and `.scrml`
 *     imports; or
 *   - it is an async exported function (its body runs a `?{}` query, or calls
 *     one — a server operation), or one of those names it.
 *
 * Reachability is by IDENTIFIER TOKEN over the whole function subtree (every
 * string field at any depth), the same rule as route inference's pure-fn side
 * placement. Over-collection marks too much as server-reached — the check then
 * refuses more, which is the fail-closed direction. A name imported from a
 * `.scrml` module that does not declare it as a file-scope function (a
 * re-export, a const) cannot be followed precisely, so EVERY file-scope
 * function of that module is treated as reached (fail closed).
 *
 * Only files some other file in the compilation imports get an entry. A file no
 * one imports (a library compiled on its own, an app file with exports) serves
 * consumers outside the compilation, so every exported function there stays
 * server-placed — callers read a missing entry that way.
 */
import { toPosix } from "../path-canonical.js";

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
  /** import local name → the `.scrml` module (posix abs path) + imported name. */
  imports: Map<string, { absSource: string; imported: string }>;
}

function factsOf(fileAST: AnyNode, resolveImport: (source: string, importerPath: string) => string | null): FileFacts | null {
  const rawPath = typeof fileAST.filePath === "string" ? fileAST.filePath : null;
  if (!rawPath) return null;
  const filePath = toPosix(rawPath);
  const ast = (fileAST.ast ?? null) as AnyNode | null;
  const nodes = (fileAST.nodes ?? (ast ? ast.nodes : null) ?? []) as unknown[];
  const fileScopeFns = new Map<string, AnyNode[]>();
  const allFns: AnyNode[] = [];
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
    }
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") find(v, inner, seen);
    }
  };
  find(nodes, false, new Set());
  const imports = new Map<string, { absSource: string; imported: string }>();
  const importDecls = (ast?.imports ?? fileAST.imports ?? []) as AnyNode[];
  for (const imp of Array.isArray(importDecls) ? importDecls : []) {
    if (!imp || imp.kind !== "import-decl" || typeof imp.source !== "string") continue;
    if (!imp.source.endsWith(".scrml")) continue;
    const absSource = resolveImport(imp.source, rawPath);
    if (!absSource) continue;
    for (const spec of (Array.isArray(imp.specifiers) ? imp.specifiers : []) as AnyNode[]) {
      if (spec && typeof spec.imported === "string" && typeof spec.local === "string") {
        imports.set(spec.local, { absSource: toPosix(absSource), imported: spec.imported });
      }
    }
  }
  return { filePath, rawPath, fileScopeFns, allFns, imports };
}

/**
 * Map: posix absolute path of every library some file in `files` imports →
 * the names of its file-scope functions server code reaches (see above).
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
    const ff = factsOf(f as AnyNode, resolveImport);
    if (!ff) continue;
    facts.set(ff.filePath, ff);
    astByPath.set(ff.filePath, f);
  }
  const imported = new Set<string>();
  for (const ff of facts.values()) for (const e of ff.imports.values()) imported.add(e.absSource);

  const reached = new Map<string, Set<string>>();
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
    if (!ff) return;
    for (const name of ff.fileScopeFns.keys()) reach(file, name);
  };
  const follow = (ff: FileFacts, tokens: Set<string>): void => {
    for (const t of tokens) {
      if (ff.fileScopeFns.has(t)) reach(ff.filePath, t);
      const imp = ff.imports.get(t);
      if (!imp) continue;
      const src = facts.get(imp.absSource);
      if (!src) continue;
      if (src.fileScopeFns.has(imp.imported)) reach(src.filePath, imp.imported);
      else reachAllOf(src.filePath); // not followable precisely — fail closed
    }
  };

  // Seeds.
  for (const ff of facts.values()) {
    const roots = new Set<string>();
    for (const fn of ff.allFns) {
      if (isOffClient(ff.rawPath, fn)) collectTokens(fn, roots, new Set());
    }
    follow(ff, roots);
    for (const name of asyncExportNames(astByPath.get(ff.filePath))) {
      if (ff.fileScopeFns.has(name)) reach(ff.filePath, name);
    }
  }
  // Closure.
  while (stack.length > 0) {
    const [file, name] = stack.pop()!;
    const ff = facts.get(file);
    if (!ff) continue;
    const toks = new Set<string>();
    for (const fn of ff.fileScopeFns.get(name) ?? []) collectTokens(fn, toks, new Set());
    toks.delete(name);
    follow(ff, toks);
  }

  const out = new Map<string, Set<string>>();
  for (const file of imported) {
    if (!facts.has(file)) continue;
    out.set(file, reached.get(file) ?? new Set());
  }
  return out;
}
