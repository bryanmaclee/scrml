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
 *   - a bare call `f(…)` is write-free when `f` is a function declared in this file
 *     whose body is (transitively) write-free, or a built-in global in PURE_GLOBALS;
 *   - `new C(…)` is write-free when `C` is in PURE_CTORS;
 *   - a member call `x.m(…)` is write-free when its root `x` is a built-in namespace
 *     (PURE_NAMESPACES), or a name this file declares (not an import) AND no function
 *     value that may write ESCAPES anywhere in the file (see below);
 *   - anything else — an imported function, an undeclared global (`fetch`), a
 *     computed callee while a writer escapes — may write.
 *
 * A function value ESCAPES when a writer (a may-write local function, or any
 * imported name) is referenced other than as a direct call — `items.map(bump)`,
 * `const repo = { save: bump }` — or a lambda anywhere in the file calls one. Only
 * then can `repo.save(x)` / `cb(x)` reach a write without naming the writer at the
 * call, so only then are such calls refused.
 *
 * A function is a WRITER when its body has a `?{}` that is not a plain read (see
 * `sqlIsPlainRead` — fail-closed: anything it cannot read as a lone SELECT is a
 * write), a `transaction { }` block, a foreign `_{}` block, or a call that may
 * write (least fixpoint over the file's functions).
 */

export interface LoopWriteFacts {
  /** Local function name → may it write the database (transitively)? */
  fnMayWrite: Map<string, boolean>;
  /** Names bound by `import` / `use` (their bodies are not visible here). */
  imported: Set<string>;
  /** Names the file declares (variables, parameters, loop binders, functions). */
  declared: Set<string>;
  /** A function value that may write is reachable through a non-call reference. */
  escapes: boolean;
}

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
  | { kind: "member"; root: string | null }
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
        const f: CallFact = { kind: "member", root: rm ? rm[1] : null };
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
    else if (c && c.kind === "member") { push({ kind: "member", root: memberRoot(c) }); scanExpr(c.object, out, inLambda); }
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

/** Collect the write facts of one file's top-level nodes. */
export function buildLoopWriteFacts(fileNodes: unknown[]): LoopWriteFacts {
  const fnBodies = new Map<string, any[]>();
  const imported = new Set<string>();
  const declared = new Set<string>();
  const fileScan = emptyScan();
  const stack: any[] = [fileNodes];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) { for (const x of cur) stack.push(x); continue; }
    const kind = cur.kind;
    if (kind === "import-decl" || kind === "use-decl") {
      for (const n of Array.isArray(cur.names) ? cur.names : []) if (typeof n === "string") imported.add(n);
      for (const sp of Array.isArray(cur.specifiers) ? cur.specifiers : []) if (sp && typeof sp.local === "string") imported.add(sp.local);
      const head = typeof cur.raw === "string" ? cur.raw.split(/\bfrom\b/)[0] : "";
      for (const w of head.match(/[A-Za-z_$][\w$]*/g) ?? []) if (!["import", "use", "as", "type", "pinned"].includes(w)) imported.add(w);
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

  const facts: LoopWriteFacts = { fnMayWrite: new Map(), imported, declared, escapes: false };
  for (const [name, s] of fnScans) facts.fnMayWrite.set(name, s.directWrite || imported.has(name));
  // Least fixpoint: may-write and escape grow together until stable.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, s] of fnScans) {
      if (facts.fnMayWrite.get(name)) continue;
      if (s.calls.some((c) => callMayWrite(c, facts))) { facts.fnMayWrite.set(name, true); changed = true; }
    }
    if (!facts.escapes) {
      const writerRef = [...fileScan.valueRefs].some((n) => imported.has(n) || facts.fnMayWrite.get(n) === true);
      const lambdaWrites = fileScan.lambdaCalls.some((c) => callMayWrite(c, facts));
      if (writerRef || lambdaWrites) { facts.escapes = true; changed = true; }
    }
  }
  return facts;
}

/** May this call reach a database write? */
export function callMayWrite(c: CallFact, facts: LoopWriteFacts): boolean {
  switch (c.kind) {
    case "bare":
      if (c.name.startsWith("@")) return true;
      if (facts.imported.has(c.name)) return true;
      if (facts.fnMayWrite.has(c.name)) return facts.fnMayWrite.get(c.name) === true;
      return !PURE_GLOBALS.has(c.name);
    case "new":
      return !(c.name !== null && PURE_CTORS.has(c.name));
    case "member":
      if (c.root === null) return facts.escapes;
      if (facts.imported.has(c.root)) return true;
      if (PURE_NAMESPACES.has(c.root)) return false;
      if (!c.root.startsWith("@") && !facts.declared.has(c.root)) return true;
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
      c.kind === "member" ? `\`${c.root ?? "…"}.…(…)\`` : "a computed callee";
    return `the loop body calls ${what}, which the compiler cannot prove does not write the database — a write between iterations would not be seen by the pre-fetch (§8.10.3)`;
  }
  return null;
}
