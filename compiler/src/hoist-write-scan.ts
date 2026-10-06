/**
 * §8.10.3 × §8.10 Tier 2 — can a loop body WRITE the database between iterations? (S456)
 *
 * The hoist moves every keyed read of a loop to ONE pre-fetch taken before
 * iteration 1. That is only the per-iteration answer when nothing the loop does
 * between two iterations can change the rows a later iteration reads: §8.10.3,
 * "The rewritten loop is observationally equivalent to the un-rewritten loop on
 * all side-effect orderings." §8.10.1 condition 4 already keeps a second `?{}` out
 * of the body, but a body that CALLS a function which writes (`bump(it.id)` whose
 * body is `?{UPDATE …}.run()`) wrote between iterations and the later reads saw
 * the stale pre-fetch (executed, S456: per-row "hello,hello!" vs hoisted
 * "hello,hello").
 *
 * The rule is fail-closed: a loop is hoisted only when the compiler can PROVE the
 * body cannot write. A `?{}` cannot sit in an arrow body (E-SQL-009), so code can
 * reach a write only by CALLING something; the proof is over the calls:
 *
 *   - a bare call `f(…)` is write-free when `f` is a function declared in this file,
 *     or imported from a `.scrml` module INSIDE the compilation, whose body is
 *     (transitively) write-free; a function of a read-only standard-library module
 *     (PURE_STDLIB_MODULES: `scrml:math`, `scrml:format`, …); or a built-in global in
 *     PURE_GLOBALS;
 *   - `new C(…)` is write-free when `C` is in PURE_CTORS;
 *   - a member call `x.m(…)` is write-free when its root `x` is a built-in namespace
 *     (PURE_NAMESPACES); or when `x` is a name this file declares (not an import),
 *     `m` is a built-in method name (BUILTIN_METHODS: `push`, `join`, `get`, …), AND
 *     no function value that may write ESCAPES anywhere in the compilation;
 *   - anything else — a function imported from outside the compilation (a host
 *     `.js` module, a package, a standard-library module that can reach a database or
 *     the network: `scrml:store`, `scrml:http`, …), an undeclared global (`fetch`), a
 *     computed callee while a writer escapes — may write.
 *
 * A function value ESCAPES when a writer (a may-write function, or a name imported
 * from outside the compilation) is referenced other than as a direct call — `items.map(bump)`,
 * `const repo = { save: bump }` — or a lambda calls one, in ANY file of the
 * compilation (an object built in one file reaches a loop in another as an
 * argument). Only then can `repo.save(x)` / `opts.cb(x)` reach a write without
 * naming the writer at the call, so only then are such calls refused.
 *
 * A CALL to a function imported from outside the compilation (a host `.js` module, a
 * package, a non-read-only standard-library module) also counts as an escape: its
 * RETURN value may carry a writer (`const repo = makeRepo(); repo.add(x)`) that never
 * appears as a reference. A `.scrml` module inside the compilation is analysed
 * instead (its functions' write facts are linked across files), and a read-only
 * standard-library module is known not to write — neither counts (S456 fix round F2:
 * `${round(2.5)}` in markup used to switch hoisting off for the whole program).
 *
 * A function is a WRITER when its body has a `?{}` that is not a plain read (see
 * `sqlIsPlainRead` — fail-closed: anything it cannot read as a lone SELECT is a
 * write), a `transaction { }` block, a foreign `_{}` block, or a call that may
 * write (least fixpoint over the compilation's functions).
 */

import { dirname, resolve as resolvePath } from "node:path";

export interface LoopWriteFacts {
  /** Local function name → may it write the database (transitively)? */
  fnMayWrite: Map<string, boolean>;
  /** Names bound by `import` / `use`. */
  imported: Set<string>;
  /** Imported names whose module's code is not analysed here and may write (§ top). */
  unknownImported: Set<string>;
  /** Imported names from a read-only standard-library module (PURE_STDLIB_MODULES). */
  pureImported: Set<string>;
  /** An imported name from a `.scrml` module in the compilation → that module's facts + its exported name. */
  importLinks: Map<string, { path: string; name: string }>;
  /** The compilation's facts by resolved file path (to follow `importLinks`). */
  byPath: Map<string, LoopWriteFacts>;
  /** Names the file declares (variables, parameters, loop binders, functions). */
  declared: Set<string>;
  /** A function value that may write is reachable through a non-call reference. */
  escapes: boolean;
}

/**
 * Standard-library modules whose functions cannot write a database (no `?{}`, no
 * network, no file system; read by hand, S456): their calls are write-free and
 * their names do not escape. A callback handed to one (`debounce(bump)`) is still a
 * writer referenced by value — an escape. Every other `scrml:` module (store, http,
 * fs, auth, oauth, redis, process, host, cron, mcp, router, …) is outside-the-
 * compilation code: may write.
 */
const PURE_STDLIB_MODULES = /^scrml:(math|format|regex|path|crypto|random|data|time)(\/|$)/;

/** Built-in globals whose CALL cannot run scrml code that writes. */
const PURE_GLOBALS = new Set([
  "String", "Number", "Boolean", "BigInt", "Symbol", "Array", "Object", "Date",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
]);

/** Built-in namespaces whose members are host functions (no database access). */
const PURE_NAMESPACES = new Set([
  "Math", "JSON", "Object", "Array", "Number", "String", "Date", "Boolean", "BigInt", "Intl", "Symbol",
  "console",
]);

/**
 * Built-in method names: a member call `x.m(…)` on a declared, non-imported name is
 * write-free only for one of these (Array / String / Map / Set / Number / Date).
 * A callback they invoke is covered by the escape rule (a writer passed by value).
 */
const BUILTIN_METHODS = new Set([
  "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join", "map", "filter", "reduce",
  "reduceRight", "forEach", "find", "findIndex", "findLast", "findLastIndex", "some", "every",
  "includes", "indexOf", "lastIndexOf", "at", "flat", "flatMap", "fill", "sort", "reverse", "keys",
  "values", "entries", "toSorted", "toReversed", "toSpliced", "with", "copyWithin",
  "toString", "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd", "split", "replace",
  "replaceAll", "startsWith", "endsWith", "padStart", "padEnd", "repeat", "charAt", "charCodeAt",
  "codePointAt", "substring", "substr", "localeCompare", "match", "matchAll", "search", "normalize",
  "toFixed", "toPrecision", "toLocaleString", "valueOf", "toJSON", "toISOString", "getTime",
  "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getSeconds",
  "getMilliseconds", "toLocaleDateString", "toLocaleTimeString",
  "get", "set", "has", "add", "delete", "clear", "hasOwnProperty",
]);

/** Built-in constructors. */
const PURE_CTORS = new Set([
  "Map", "Set", "WeakMap", "WeakSet", "Array", "Object", "Date", "Error", "TypeError", "RangeError",
  "RegExp", "URL", "URLSearchParams",
]);

/** Words that precede `(` without being a call. */
const NOT_A_CALL = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "return", "typeof", "instanceof", "await",
  "async", "function", "fn", "match", "not", "is", "some", "and", "or", "in", "of", "new", "catch",
  "try", "throw", "yield", "lift", "fail", "let", "const", "var", "delete", "void", "when", "given",
]);

/** A `?{}` body the rule reads as a plain read: one SELECT, no write / locking word. */
export function sqlIsPlainRead(sqlBody: string): boolean {
  const text = String(sqlBody ?? "").replace(/'(?:[^']|'')*'/g, "''").trim();
  if (!/^select\b/i.test(text)) return false;
  if (text.includes(";")) return false;
  return !/\b(insert|update|delete|replace|upsert|merge|into|returning|create|drop|alter|truncate|pragma|attach|detach|vacuum|reindex|begin|commit|rollback|savepoint|release|for)\b/i.test(text);
}

type CallFact =
  | { kind: "bare"; name: string }
  | { kind: "member"; root: string | null; method: string }
  | { kind: "new"; name: string | null }
  | { kind: "computed" };

interface ScanOut {
  calls: CallFact[];
  /** Names referenced other than as a direct callee. */
  valueRefs: Set<string>;
  /** Calls made inside a lambda body (they run wherever the lambda value goes). */
  lambdaCalls: CallFact[];
  /** A write the scan saw directly (non-read `?{}`, transaction, foreign block). */
  directWrite: boolean;
}

const isMirrorKey = (k: string): boolean => k === "exprNode" || k.endsWith("Expr");

/** The root identifier of a member chain (`a.b.c` → `a`), or null. */
function memberRoot(e: any): string | null {
  let cur = e;
  while (cur && typeof cur === "object" && (cur.kind === "member" || cur.kind === "index" || cur.kind === "call")) {
    cur = cur.kind === "call" ? cur.callee : cur.object;
  }
  return cur && cur.kind === "ident" && typeof cur.name === "string" ? cur.name : null;
}

/** Remove `?{`…`}` sites and quoted string contents so their text is not read as code. */
function codeText(s: string): string {
  return s
    .replace(/\?\{`[^`]*`\}(?:\s*\.\s*\w+\s*\([^)]*\))*/g, " _sql_ ")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

/** Call facts + value references read from expression TEXT (the string form of a node). */
function scanText(text: string, out: ScanOut, inLambda: boolean): void {
  const s = codeText(text);
  const lambda = inLambda || /=>|\bfunction\b|\bfn\b/.test(s);
  const re = /(\.\s*)?(@?[A-Za-z_$][\w$]*)(\s*\()?/g;
  let m: RegExpExecArray | null;
  let prevNew = false;
  while ((m = re.exec(s)) !== null) {
    const isMember = !!m[1];
    const name = m[2];
    const isCall = !!m[3];
    if (name === "new") { prevNew = true; continue; }
    const wasNew = prevNew;
    prevNew = false;
    if (isMember) {
      if (isCall) {
        // root = the identifier that starts this chain (walk back over `a . b . c`)
        const before = s.slice(0, m.index);
        const rm = /(@?[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\]|\s*\([^()]*\))*\s*$/.exec(before);
        const f: CallFact = { kind: "member", root: rm ? rm[1] : null, method: name };
        out.calls.push(f);
        if (lambda) out.lambdaCalls.push(f);
      }
      continue;
    }
    if (wasNew) {
      const f: CallFact = { kind: "new", name };
      out.calls.push(f);
      if (lambda) out.lambdaCalls.push(f);
      continue;
    }
    if (isCall) {
      if (NOT_A_CALL.has(name)) continue;
      const f: CallFact = { kind: "bare", name };
      out.calls.push(f);
      if (lambda) out.lambdaCalls.push(f);
    } else {
      out.valueRefs.add(name);
    }
  }
}

/** Call facts + value references read from a structured ExprNode tree. */
function scanExpr(e: any, out: ScanOut, inLambda: boolean): void {
  if (!e || typeof e !== "object") return;
  if (Array.isArray(e)) { for (const x of e) scanExpr(x, out, inLambda); return; }
  // a `?{}` value: its query is classified by the statement scan, not read as code
  if (e.kind === "sql" || e.kind === "sql-ref") return;
  const push = (f: CallFact) => { out.calls.push(f); if (inLambda) out.lambdaCalls.push(f); };
  if (e.kind === "call") {
    const c = e.callee;
    // `?{…}.get()` — the query's own terminator, not a call into code
    if (c && c.kind === "member" && c.object && (c.object.kind === "sql" || c.object.kind === "sql-ref")) return;
    if (c && c.kind === "ident") push({ kind: "bare", name: c.name });
    else if (c && c.kind === "member") { push({ kind: "member", root: memberRoot(c), method: String(c.property ?? "") }); scanExpr(c.object, out, inLambda); }
    else { push({ kind: "computed" }); scanExpr(c, out, inLambda); }
    scanExpr(e.args, out, inLambda);
    return;
  }
  if (e.kind === "new") {
    const c = e.callee;
    push({ kind: "new", name: c && c.kind === "ident" ? c.name : null });
    scanExpr(e.args, out, inLambda);
    return;
  }
  if (e.kind === "ident") { if (typeof e.name === "string") out.valueRefs.add(e.name); return; }
  if (e.kind === "escape-hatch") {
    for (const k of Object.keys(e)) if (typeof e[k] === "string" && k !== "kind") scanText(e[k], out, true);
    return;
  }
  const lam = inLambda || e.kind === "lambda";
  for (const k of Object.keys(e)) {
    if (k === "span") continue;
    const v = e[k];
    if (v && typeof v === "object") {
      // a lambda's block body holds STATEMENTS
      if (e.kind === "lambda" && k === "body" && v.kind === "block") scanNode(v.stmts, out, true);
      else scanExpr(v, out, lam);
    }
  }
}

/** Scan statement nodes: structured mirrors, string forms, SQL sites, write blocks. */
function scanNode(root: any, out: ScanOut, inLambda: boolean, skipSite?: (n: any) => boolean, intoFunctions = false): void {
  const stack: Array<[any, boolean]> = [[root, inLambda]];
  while (stack.length > 0) {
    const [cur, lam] = stack.pop()!;
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) { for (const x of cur) stack.push([x, lam]); continue; }
    const kind = typeof cur.kind === "string" ? cur.kind : "";
    if (kind === "sql") {
      if (!(skipSite && skipSite(cur)) && !sqlIsPlainRead(cur.query ?? cur.body ?? "")) out.directWrite = true;
      const calls = Array.isArray(cur.chainedCalls) ? cur.chainedCalls : [];
      if (!(skipSite && skipSite(cur)) && calls.some((c: any) => c && c.method === "run")) out.directWrite = true;
      continue;
    }
    // declarations of names (their text names a binding, it does not reference one) and markup text
    if (kind === "import-decl" || kind === "use-decl" || kind === "export-decl" || kind === "text" || kind === "comment" || kind === "string-literal") continue;
    if (kind === "transaction-block" || kind.includes("foreign")) out.directWrite = true;
    if (kind === "function-decl" && !intoFunctions) {
      // a nested declaration is scanned as its own function; its NAME is declared, not called
      continue;
    }
    for (const k of Object.keys(cur)) {
      if (k === "span" || k === "id" || k === "kind") continue;
      const v = cur[k];
      if (typeof v === "string") {
        if (v.includes("?{")) {
          const re = /\?\{`([^`]*)`\}((?:\s*\.\s*\w+\s*\([^)]*\))*)/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(v)) !== null) {
            if (skipSite && skipSite(m[0])) continue;
            if (!sqlIsPlainRead(m[1] ?? "") || /\.\s*run\s*\(/.test(m[2] ?? "")) out.directWrite = true;
          }
        }
        if (k === "name" || k === "op" || k === "raw" && kind === "lit") continue;
        scanText(v, out, lam);
      } else if (v && typeof v === "object") {
        if (isMirrorKey(k)) scanExpr(v, out, lam);
        else stack.push([v, lam]);
      }
    }
  }
}

function emptyScan(): ScanOut {
  return { calls: [], valueRefs: new Set(), lambdaCalls: [], directWrite: false };
}

/** The leading identifier of a parameter / binder text (`id: int = 1` → `id`). */
function leadIdent(p: unknown): string | null {
  const s = typeof p === "string" ? p : (p && typeof p === "object" && typeof (p as any).name === "string" ? (p as any).name : "");
  const m = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(s);
  return m ? m[1] : null;
}

/** One file's raw scan: its functions, imports, declarations, and every reference. */
interface FileScan {
  fnScans: Map<string, ScanOut>;
  fileScan: ScanOut;
  facts: LoopWriteFacts;
}

function scanFile(
  fileNodes: unknown[],
  filePath: string | null,
  compilationPaths: Set<string>,
  escapes: { value: boolean },
  byPath: Map<string, LoopWriteFacts>,
): FileScan & { externalImported: Set<string> } {
  const fnBodies = new Map<string, any[]>();
  const imported = new Set<string>();
  // Names imported from a module whose code is NOT analysed here (a host `.js` module,
  // a package, a non-read-only standard-library module): may write.
  const externalImported = new Set<string>();
  const pureImported = new Set<string>();
  const importLinks = new Map<string, { path: string; name: string }>();
  const declared = new Set<string>();
  const fileScan = emptyScan();
  const stack: any[] = [fileNodes];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) { for (const x of cur) stack.push(x); continue; }
    const kind = cur.kind;
    if (kind === "import-decl" || kind === "use-decl") {
      // local name → the module's exported name (a specifier's `imported`, else itself)
      const names = new Map<string, string>();
      for (const n of Array.isArray(cur.names) ? cur.names : []) if (typeof n === "string") names.set(n, n);
      for (const sp of Array.isArray(cur.specifiers) ? cur.specifiers : []) {
        if (sp && typeof sp.local === "string") names.set(sp.local, typeof sp.imported === "string" ? sp.imported : sp.local);
      }
      const head = typeof cur.raw === "string" ? cur.raw.split(/\bfrom\b/)[0] : "";
      // every other word of the head (a default / namespace binding the structured
      // fields do not carry) — unlinked, so it is never assumed write-free
      const unlinked = new Set<string>();
      for (const w of head.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (!["import", "use", "as", "type", "pinned"].includes(w) && !names.has(w)) unlinked.add(w);
      }
      const source = typeof cur.source === "string" ? cur.source : (typeof cur.raw === "string" ? (/['"]([^'"]+)['"]/.exec(cur.raw)?.[1] ?? "") : "");
      const target = kind === "import-decl" && filePath !== null && /\.scrml$/.test(source) ? resolvePath(dirname(filePath), source) : null;
      const inCompilation = target !== null && compilationPaths.has(target);
      const pure = PURE_STDLIB_MODULES.test(source);
      for (const [local, exported] of names) {
        imported.add(local);
        if (pure) pureImported.add(local);
        else if (inCompilation) importLinks.set(local, { path: target!, name: exported });
        else externalImported.add(local);
      }
      for (const w of unlinked) {
        imported.add(w);
        if (pure) pureImported.add(w); else externalImported.add(w);
      }
      continue;
    }
    if (kind === "function-decl" && typeof cur.name === "string") {
      const list = fnBodies.get(cur.name) ?? [];
      list.push(cur.body);
      fnBodies.set(cur.name, list);
      declared.add(cur.name);
      for (const p of Array.isArray(cur.params) ? cur.params : []) { const n = leadIdent(p); if (n) declared.add(n); }
    }
    if (typeof cur.name === "string" && /-decl$/.test(String(kind))) declared.add(cur.name);
    if (kind === "for-stmt") { const n = leadIdent(cur.variable); if (n) declared.add(n); }
    if (kind === "lambda" && Array.isArray(cur.params)) for (const p of cur.params) { const n = leadIdent(p); if (n) declared.add(n); }
    for (const k of Object.keys(cur)) {
      if (k === "span") continue;
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  // Every reference / lambda call in the file (escape analysis).
  scanNode(fileNodes, fileScan, false, undefined, true);
  const fnScans = new Map<string, ScanOut>();
  for (const [name, bodies] of fnBodies) {
    const s = emptyScan();
    for (const b of bodies) scanNode(b, s, false);
    fnScans.set(name, s);
  }
  const facts: LoopWriteFacts = {
    fnMayWrite: new Map(), imported, unknownImported: externalImported, pureImported, importLinks,
    byPath, declared, escapes: false,
  };
  Object.defineProperty(facts, "escapes", { get: () => escapes.value, enumerable: true });
  // A local function shadowing an unknown import is not trusted.
  for (const [name, s] of fnScans) facts.fnMayWrite.set(name, s.directWrite || externalImported.has(name));
  return { fnScans, fileScan, facts, externalImported };
}

/** One file of the compilation, as the write scan reads it. */
export interface WriteScanFile {
  nodes: unknown[];
  filePath: string | null;
}

/**
 * The write facts of every file of a compilation (aligned with `files`). The escape
 * flag is ONE for the compilation: a writer passed by value in one file can reach a
 * loop in another.
 */
export function buildCompilationWriteFacts(files: WriteScanFile[]): LoopWriteFacts[] {
  const escapes = { value: false };
  const compilationPaths = new Set(files.map((f) => f.filePath).filter((p): p is string => typeof p === "string").map((p) => resolvePath(p)));
  const byPath = new Map<string, LoopWriteFacts>();
  const scans = files.map((f) => scanFile(f.nodes, f.filePath, compilationPaths, escapes, byPath));
  files.forEach((f, i) => { if (typeof f.filePath === "string") byPath.set(resolvePath(f.filePath), scans[i].facts); });
  // A CALL into a module whose code is not analysed may return a value carrying a writer
  // (a factory returning `{ add: (x) => … }` — the returned value is never a reference
  // here). Its result can reach any method call, so it counts as an escape.
  for (const { fileScan, externalImported } of scans) {
    if (fileScan.calls.some((c) =>
      (c.kind === "bare" && externalImported.has(c.name)) ||
      (c.kind === "member" && c.root !== null && externalImported.has(c.root)))) {
      escapes.value = true;
    }
  }
  // Least fixpoint: may-write and escape grow together until stable.
  for (let changed = true; changed;) {
    changed = false;
    for (const { fnScans, facts } of scans) {
      for (const [name, s] of fnScans) {
        if (facts.fnMayWrite.get(name)) continue;
        if (s.calls.some((c) => callMayWrite(c, facts))) { facts.fnMayWrite.set(name, true); changed = true; }
      }
    }
    if (!escapes.value) {
      for (const { fileScan, facts } of scans) {
        const writerRef = [...fileScan.valueRefs].some((n) => nameMayWrite(n, facts));
        const lambdaWrites = fileScan.lambdaCalls.some((c) => callMayWrite(c, facts));
        if (writerRef || lambdaWrites) { escapes.value = true; changed = true; break; }
      }
    }
  }
  return scans.map((x) => x.facts);
}

/** The write facts of a single file compiled alone. */
export function buildLoopWriteFacts(fileNodes: unknown[], filePath: string | null = null): LoopWriteFacts {
  return buildCompilationWriteFacts([{ nodes: fileNodes, filePath }])[0];
}

/**
 * May the function a name denotes write? A local function: its fixpoint fact. A
 * read-only stdlib import: no. An import from a `.scrml` module in the compilation:
 * that module's fact for the exported name (an export the scan did not find — a
 * re-export, a const — may write). Any other import: may write. Not a function: no.
 */
function nameMayWrite(name: string, facts: LoopWriteFacts): boolean {
  if (facts.pureImported.has(name)) return false;
  const link = facts.importLinks.get(name);
  if (link) {
    const target = facts.byPath.get(link.path);
    return !target || target.fnMayWrite.get(link.name) !== false;
  }
  if (facts.unknownImported.has(name)) return true;
  return facts.fnMayWrite.get(name) === true;
}

/** May this call reach a database write? */
export function callMayWrite(c: CallFact, facts: LoopWriteFacts): boolean {
  switch (c.kind) {
    case "bare":
      if (c.name.startsWith("@")) return true;
      if (facts.imported.has(c.name)) return nameMayWrite(c.name, facts);
      if (facts.fnMayWrite.has(c.name)) return facts.fnMayWrite.get(c.name) === true;
      return !PURE_GLOBALS.has(c.name);
    case "new":
      return !(c.name !== null && PURE_CTORS.has(c.name));
    case "member":
      if (c.root !== null && facts.pureImported.has(c.root)) return false;
      if (c.root !== null && facts.imported.has(c.root)) return true;
      if (c.root !== null && PURE_NAMESPACES.has(c.root)) return false;
      if (c.root !== null && !c.root.startsWith("@") && !facts.declared.has(c.root)) return true;
      if (!BUILTIN_METHODS.has(c.method)) return true;
      return facts.escapes;
    case "computed":
      return facts.escapes;
  }
}

/**
 * Why a loop body may write the database between iterations, or null when it
 * provably cannot. `isSite` recognises the loop's own keyed read (it is the read
 * being hoisted, not a write).
 */
export function loopBodyWriteReason(body: unknown, facts: LoopWriteFacts, isSite: (n: any) => boolean): string | null {
  const s = emptyScan();
  scanNode(body, s, false, isSite);
  if (s.directWrite) {
    return "the loop body can write the database (a `transaction`, a foreign block, or a non-read query) — a write between iterations would not be seen by the pre-fetch (§8.10.3)";
  }
  for (const c of s.calls) {
    if (!callMayWrite(c, facts)) continue;
    const what =
      c.kind === "bare" ? `\`${c.name}(…)\`` :
      c.kind === "new" ? `\`new ${c.name ?? "…"}(…)\`` :
      c.kind === "member" ? `\`${c.root ?? "…"}.${c.method}(…)\`` : "a computed callee";
    return `the loop body calls ${what}, which the compiler cannot prove does not write the database — a write between iterations would not be seen by the pre-fetch (§8.10.3)`;
  }
  return null;
}
