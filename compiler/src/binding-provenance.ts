/**
 * s466 fix round 6 — WHERE CAN A NAME'S VALUE COME FROM?
 *
 * One binding follower, shared by the two readers that must not be fooled by an
 * indirection:
 *   - the §7.3.2 identity check on parameter defaults (route-inference
 *     `reportServerDefaultIdentityReads` → free-name.ts `identityReadInDefaultDeep`):
 *     a default that reaches an identity read through ANY binding is refused;
 *   - the server-reached-exports closure (codegen/server-reached-exports.ts): a
 *     library function server code reaches through a `const` / alias / `let` is
 *     server-reached.
 *
 * For every name in a file, the PROVENANCE is the union of every place the file
 * gives it a value, at any depth (a name bound in two scopes is the union of
 * both — over-reading is the fail-closed direction for both readers):
 *   - `function` / `fn` declaration → its params + body (`fn`);
 *   - `const` / `let` / `lin` declaration, plain or destructured → its
 *     initialiser (`expr`); a `~` / bare reassignment (`tilde-decl`), an
 *     assignment expression `x = v` / `x += v` / `[x] = v` / `x.p = v` → `v`;
 *   - a cell `<x> = v` / `@x = v` / `@x.p = v` → `v`, under the name `@x`; a
 *     §52 server-authority cell (`<x server>`) is additionally `server-cell`;
 *   - `export const x = v` → `v`; `export { a as b }` → alias of `a`;
 *     `export { a } from "./m.scrml"` → alias into `m`; `export * from "./m.scrml"`
 *     → `star` (any name the file does not bind is looked up in `m`);
 *   - `import { a as b } from "./m.scrml"` → alias of `a` in `m`;
 *   - anything the follower cannot read precisely → `unresolved`: an import from a
 *     `.scrml` module this compilation does not hold, a re-export of one, a name
 *     assigned inside raw (unparsed) text, a declaration with no parsed
 *     initialiser.
 * A name with no entry is not a binding of this file (a builtin, a parameter of
 * an enclosing function, a JS / `scrml:` import).
 */
import { toPosix } from "./path-canonical.js";
import { parseExprToNode } from "./expression-parser.ts";

type AnyNode = Record<string, any>;

export type Binding =
  | { kind: "fn"; node: AnyNode; filePath: string }
  | { kind: "expr"; node: AnyNode; filePath: string }
  | { kind: "alias"; name: string; filePath: string }
  | { kind: "star"; filePath: string }
  | { kind: "server-cell"; name: string }
  | { kind: "unresolved"; why: string };

export interface ProvenanceFile {
  filePath: string;
  nodes: unknown;
  imports: unknown;
}

/** Every identifier a destructuring pattern (or a raw pattern string) binds. */
function patternNames(pat: unknown, out: string[]): void {
  if (!pat) return;
  if (typeof pat === "string") {
    const re = /(?<![.\w$])[A-Za-z_$][\w$]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pat)) !== null) out.push(m[0]);
    return;
  }
  if (typeof pat !== "object") return;
  if (Array.isArray(pat)) { for (const p of pat) patternNames(p, out); return; }
  const p = pat as AnyNode;
  if (p.kind === "escape-hatch" && typeof p.raw === "string") { patternNames(p.raw, out); return; }
  if (p.kind === "ident" && typeof p.name === "string") { out.push(p.name); return; }
  for (const key of ["bindName", "name", "restName", "rest", "local"]) {
    if (typeof p[key] === "string") out.push(p[key]);
  }
  for (const key of Object.keys(p)) {
    if (key === "span" || key === "fieldName" || key === "defaultExpr" || key === "default") continue;
    const v = p[key];
    if (v && typeof v === "object") patternNames(v, out);
  }
}

/**
 * The names a declaration node binds: `n.name` when it is a plain name, every name
 * of the destructuring pattern otherwise (s468 — shared with identity-flow.ts, which
 * resolves a name to the scope that declares it).
 */
export function declaredNamesOf(n: unknown): string[] {
  if (!n || typeof n !== "object") return [];
  const o = n as AnyNode;
  if (typeof o.name === "string") return [o.name];
  const names: string[] = [];
  patternNames(o.name, names);
  return names;
}

/** The root identifier an assignment target writes through (`x`, `x.p`, `x[i].q` → `x`). */
function targetRoot(t: unknown): string | null {
  let cur = t as AnyNode | null;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident" && typeof cur.name === "string") return cur.name;
    if (cur.kind === "member" || cur.kind === "index") { cur = cur.object; continue; }
    return null;
  }
  return null;
}

/** Names assigned inside raw text (`x = …`, `x += …`, `@x = …`). Over-collects — fail closed. */
const RAW_ASSIGN_RE = /(?<![.\w$])(@?[A-Za-z_$][\w$]*)\s*(?:\[[^\]]*\]|\.[A-Za-z_$][\w$]*)*\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/g;

function rawText(n: AnyNode): string | null {
  if (n.kind === "escape-hatch" && typeof n.raw === "string") return n.raw;
  if (n.kind === "bare-expr" && !n.exprNode && typeof n.expr === "string") return n.expr;
  return null;
}

const _cache = new WeakMap<object, Map<string, Binding[]>>();

/**
 * The provenance map of one file. `resolveImport(source, importerPath)` → the
 * absolute path of a `.scrml` module, or null; `holds(absPath)` → does this
 * compilation hold it (a module it does not hold cannot be followed).
 */
export function bindingsOfFile(
  file: ProvenanceFile,
  resolveImport: ((source: string, importerPath: string) => string | null) | null | undefined,
  holds: (absPath: string) => boolean,
): Map<string, Binding[]> {
  const key = file as unknown as object;
  const cached = _cache.get(key);
  if (cached) return cached;
  const out = new Map<string, Binding[]>();
  _cache.set(key, out);
  const fp = file.filePath;
  const add = (name: unknown, b: Binding): void => {
    if (typeof name !== "string" || !name) return;
    const list = out.get(name) ?? [];
    list.push(b);
    out.set(name, list);
  };
  const addExpr = (names: string[], init: unknown, why: string): void => {
    for (const nm of names) {
      if (init && typeof init === "object") add(nm, { kind: "expr", node: init as AnyNode, filePath: fp });
      else add(nm, { kind: "unresolved", why });
    }
  };
  const declNames = (n: AnyNode): string[] => declaredNamesOf(n);
  const resolveSource = (src: string): string | null => {
    const abs = resolveImport ? resolveImport(src, fp) : null;
    return abs && holds(abs) ? abs : null;
  };
  const parseInit = (text: string | null): AnyNode | null => {
    if (!text) return null;
    try { return parseExprToNode(text, fp, 0) as unknown as AnyNode; } catch { return null; }
  };
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const c of node) visit(c); return; }
    const n = node as AnyNode;
    switch (n.kind) {
      case "function-decl":
        add(n.name, { kind: "fn", node: n, filePath: fp });
        break;
      case "const-decl":
      case "let-decl":
      case "lin-decl":
      case "tilde-decl": {
        if (n.kind === "let-decl" && n.initExpr == null && (n.init == null || n.init === "")) {
          // `let x` with no initialiser holds nothing yet; its assignments are collected where they occur.
          for (const nm of declNames(n)) add(nm, { kind: "expr", node: { kind: "lit", litType: "undefined", raw: "undefined" }, filePath: fp });
          break;
        }
        const init = n.initExpr ?? parseInit(typeof n.init === "string" ? n.init : null);
        addExpr(declNames(n), init, "its initialiser is not parsed");
        break;
      }
      case "state-decl": {
        if (typeof n.name === "string") {
          if (n.isServer === true) add("@" + n.name, { kind: "server-cell", name: "@" + n.name });
          const init = n.initExpr ?? n.sqlNode ?? parseInit(typeof n.init === "string" ? n.init : null);
          if (init) add("@" + n.name, { kind: "expr", node: init, filePath: fp });
          else if (n.init != null && n.init !== "") add("@" + n.name, { kind: "unresolved", why: "its initialiser is not parsed" });
        }
        break;
      }
      case "reactive-nested-assign":
        if (typeof n.target === "string") {
          const t = n.target.startsWith("@") ? n.target : "@" + n.target;
          addExpr([t], n.valueExpr ?? parseInit(typeof n.value === "string" ? n.value : null), "its value is not parsed");
        }
        break;
      case "assign": {
        const root = targetRoot(n.target);
        const names: string[] = [];
        if (root) names.push(root);
        else patternNames(n.target, names);
        addExpr(names, n.value, "its value is not parsed");
        break;
      }
      case "export-decl": {
        const ek = String(n.exportKind ?? "");
        if (typeof n.reExportSource === "string" && n.reExportSource) {
          const abs = resolveSource(n.reExportSource);
          if (ek === "re-export-all" || n.isReExportAll === true) {
            add("*", abs ? { kind: "star", filePath: abs } : { kind: "unresolved", why: "it is re-exported from a module outside this compilation" });
          } else {
            const specs = Array.isArray(n.renames) ? n.renames : [];
            for (const s of specs) {
              if (!s || typeof s.exported !== "string") continue;
              add(s.exported, abs ? { kind: "alias", name: String(s.local ?? s.exported), filePath: abs } : { kind: "unresolved", why: "it is re-exported from a module outside this compilation" });
            }
          }
        } else if (Array.isArray(n.renames)) {
          for (const s of n.renames) {
            if (s && typeof s.exported === "string" && typeof s.local === "string" && s.local !== s.exported) {
              add(s.exported, { kind: "alias", name: s.local, filePath: fp });
            }
          }
        } else if (typeof n.exportedName === "string" && (ek === "const" || ek === "let" || ek === "var")) {
          // s468 — the parsed initialiser, when the builder kept one (`valueInitExpr`):
          // the TREE node, so a location-aware reader (identity-flow.ts) can place it
          // and follow the calls of an exported lambda into its parameters.
          if (n.valueInitExpr && typeof n.valueInitExpr === "object") {
            add(n.exportedName, { kind: "expr", node: n.valueInitExpr, filePath: fp });
            break;
          }
          // An exported value otherwise keeps only its raw text (an exported function
          // also gets a synthetic `function-decl`, collected above).
          let init: string | null = typeof n.valueInit === "string" ? String(n.valueInit).trim() : null;
          if (init == null) {
            const m = String(n.raw ?? "").match(/^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*([\s\S]+)$/);
            init = m ? m[1].trim() : null;
          }
          const node2 = parseInit(init);
          if (node2) add(n.exportedName, { kind: "expr", node: node2, filePath: fp });
          else if (init != null || ek === "const") add(n.exportedName, { kind: "unresolved", why: "its exported initialiser is not parsed" });
        }
        break;
      }
      default:
        break;
    }
    const raw = rawText(n);
    if (raw) {
      RAW_ASSIGN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RAW_ASSIGN_RE.exec(raw)) !== null) add(m[1], { kind: "unresolved", why: "it is assigned in raw text the compiler does not parse" });
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(file.nodes);
  const imports = file.imports;
  for (const imp of Array.isArray(imports) ? imports : []) {
    if (!imp || imp.kind !== "import-decl" || typeof imp.source !== "string" || !imp.source.endsWith(".scrml")) continue;
    const abs = resolveSource(imp.source);
    for (const spec of (Array.isArray(imp.specifiers) ? imp.specifiers : [])) {
      if (spec && typeof spec.imported === "string" && typeof spec.local === "string") {
        add(spec.local, abs
          ? { kind: "alias", name: spec.imported, filePath: abs }
          : { kind: "unresolved", why: "it is imported from a module outside this compilation" });
      }
    }
  }
  return out;
}

/**
 * The bindings of `name` in `filePath`, with `export *` followed (only when the
 * name is reached through an import / re-export, i.e. `viaImport`). A name an
 * import reaches that the module does not bind at all is `unresolved`.
 */
export function bindingsOfName(
  filePath: string,
  name: string,
  viaImport: boolean,
  fileOf: (filePath: string) => Map<string, Binding[]> | null,
): Binding[] {
  const seen = new Set<string>();
  const go = (fp: string, depth: number): Binding[] => {
    const k = toPosix(fp);
    if (seen.has(k)) return [];
    seen.add(k);
    const m = fileOf(fp);
    if (!m) return [{ kind: "unresolved", why: "its module is outside this compilation" }];
    const own = m.get(name) ?? [];
    if (own.length > 0 || !viaImport) return own;
    const stars = m.get("*") ?? [];
    const out: Binding[] = [];
    for (const s of stars) {
      if (s.kind === "star") out.push(...go(s.filePath, depth + 1));
      else if (s.kind === "unresolved") out.push(s);
    }
    if (out.length === 0) out.push({ kind: "unresolved", why: "the module it is imported from does not declare it" });
    return out;
  };
  return go(filePath, 0);
}
