/**
 * @module codegen/emit-tool
 *
 * SPEC §64 — Standalone Tool Target emit (`<program kind="tool">`).
 *
 * Emits a plain runnable ES module (a CLI tool or long-running server runnable
 * as `bun <emitted>.js`) — NOT a web application. Bypasses emit-html /
 * emit-client / CSRF / HTTP-web server-route emission entirely (§64.1). The
 * module contains:
 *   - the file's logic (fn/const/type declarations),
 *   - its `_{}` foreign blocks (lowered via emit-logic `case "foreign"`; the
 *     tool body's bare host-I/O `_{}` is admitted by §23.2.4, amended S238),
 *   - its `?{}` db calls (lowered server-side via `db=` + §44; the Bun.SQL
 *     handle declarations are injected like the server-emit path),
 *   - the `main()` invocation harness (§64.3), whose arm the RETURN-TYPE of
 *     `main` selects:
 *       `function main(...): number` → exit-harness (process.exit(code)),
 *       `function main(...)`         → invoke-only (declines to force exit;
 *                                      natural Bun/Node liveness decides).
 *
 * Composition: `lang=` / `db=` / `capabilities=` resolve exactly as a normal
 * <program> (§64.5); only the emit SHAPE differs. The per-statement lowering is
 * AST-driven via `emitLogicNode` at the SERVER boundary (a tool is a single
 * runnable process — `?{}` and `_{}` run in it directly, no client/server
 * split). Cross-fn calls to async helpers are auto-awaited via the S218
 * `serverFnNames` peer-await mechanism.
 */

import type { CompileContext } from "./context.ts";
import { getNodes } from "./collect.ts";
import { emitLogicNode, emitFnShortcutBody } from "./emit-logic.js";
import { emitEnumVariantObjects } from "./emit-client.js";
import { collectDbScopes, SERVER_STRUCTURAL_EQ_HELPER } from "./emit-server.ts";
import { SERVER_LOG_HELPER } from "./log-loc.ts";
import { emitExprField } from "./emit-expr.ts";
import { parseExprToNode } from "../expression-parser.ts";
import { CGError } from "./errors.ts";
import { paramSignature } from "./utils.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/** Extract the FileAST from a CompileContext-or-fileAST argument. */
function resolveFileAST(ctxOrFileAST: CompileContext | ASTNode): {
  fileAST: ASTNode;
  filePath: string;
} {
  if (ctxOrFileAST && typeof ctxOrFileAST === "object" && "fileAST" in ctxOrFileAST) {
    const ctx = ctxOrFileAST as CompileContext;
    return { fileAST: ctx.fileAST as ASTNode, filePath: (ctx.filePath as string) ?? "" };
  }
  const fileAST = ctxOrFileAST as ASTNode;
  return { fileAST, filePath: (fileAST.filePath as string) ?? "" };
}

/** Collect the top-level logic-block body statements, in source order. */
function collectTopLevelStatements(fileAST: ASTNode): ASTNode[] {
  const stmts: ASTNode[] = [];
  const nodes = getNodes(fileAST as never) as unknown as ASTNode[];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as ASTNode;
    if (n.kind === "logic" && Array.isArray(n.body)) {
      for (const s of n.body as ASTNode[]) if (s) stmts.push(s);
    }
    if (Array.isArray(n.children)) for (const c of n.children as ASTNode[]) visit(c);
  };
  for (const n of nodes) visit(n);
  return stmts;
}

/** A statement is a function declaration. */
function isFunctionDecl(stmt: ASTNode): boolean {
  return stmt.kind === "function-decl";
}

/** Deep-scan a fn body's AST for a directly-async signal (`_{}`/`?{}`). */
function bodyHasForeignOrSql(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as ASTNode;
  if (n.kind === "foreign" || n.kind === "sql") return true;
  if (n.foreignNode || n.sqlNode) return true;
  for (const k of Object.keys(n)) {
    if (k === "span") continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (bodyHasForeignOrSql(c)) return true; }
    else if (v && typeof v === "object") { if (bodyHasForeignOrSql(v)) return true; }
  }
  return false;
}

/**
 * Compute the set of tool fn names that must be emitted `async` (and whose call
 * sites must be awaited). Seed = fns that directly do `?{}`/`_{}`/`async`; then
 * fixpoint-propagate over the call graph: a fn that calls an async fn is itself
 * async (it awaits). Call detection is a source-text scan of each fn's span for
 * `\bname\s*\(` — reliable and opacity-safe (it never re-parses).
 */
function computeAsyncFnNames(fns: ASTNode[], sourceText: string | null, seedAsync?: Set<string>): Set<string> {
  // Seed with cross-import async names (a tool's ASYNC imported library fns — a
  // `<foreign lang>` lib `export fn` emits `export async function`) so the
  // fixpoint also colors any LOCAL fn that calls one of them (§64 / Flag C).
  const async = new Set<string>(seedAsync ?? []);
  const bodyTextByName = new Map<string, string>();
  for (const fn of fns) {
    const name = fn.name as string | undefined;
    if (!name) continue;
    const span = fn.span as { start?: number; end?: number } | undefined;
    const text = sourceText && span && typeof span.start === "number" && typeof span.end === "number"
      ? sourceText.slice(span.start, span.end)
      : "";
    bodyTextByName.set(name, text);
    if (fn.isAsync === true || bodyHasForeignOrSql(fn.body)) async.add(name);
  }
  // Fixpoint — a fn calling any async fn becomes async.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      const name = fn.name as string | undefined;
      if (!name || async.has(name)) continue;
      const text = bodyTextByName.get(name) ?? "";
      for (const asyncName of async) {
        if (asyncName === name) continue;
        if (new RegExp(`\\b${asyncName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(text)) {
          async.add(name);
          changed = true;
          break;
        }
      }
    }
  }
  return async;
}

/** Format ONE tool function-declaration parameter: strip its `:Type`, keep a
 *  `= default` and a `...rest` prefix. Falls back to paramSignature for
 *  structured (destructured) params. */
function toolParamSignature(p: unknown, i: number): string {
  if (typeof p !== "string") return paramSignature(p as never, i);
  const s = p.trim();
  const colon = s.indexOf(":");
  if (colon < 0) return s; // no type annotation (may carry `= default` / `...rest`)
  const name = s.slice(0, colon).trim();
  const afterType = s.slice(colon + 1);
  const eq = afterType.indexOf("=");
  return eq >= 0 ? `${name} = ${afterType.slice(eq + 1).trim()}` : name;
}

/**
 * Build the `import { SQL } from "bun"` + `const _scrml_sql… = new SQL(…)`
 * handle declarations for the tool module — mirrors the emit-server injection
 * (§44.2), driven by which `_scrml_sql`/`_scrml_sql_<n>` identifiers the emitted
 * body references. Returns "" when the tool uses no `?{}`.
 */
function buildDbHandleHeader(fileAST: ASTNode, emittedBody: string): string {
  const usedIdents = new Set<string>();
  const re = /\b_scrml_sql(?:_\d+)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(emittedBody)) !== null) usedIdents.add(m[0]);
  if (usedIdents.size === 0) return "";

  const dbScopes = collectDbScopes(fileAST as never);
  const lines: string[] = [];
  lines.push("// --- §44.2: Bun.SQL handle declarations (compiler-generated) ---");
  lines.push('import { SQL } from "bun";');
  const sorted = Array.from(usedIdents).sort((a, b) => {
    if (a === "_scrml_sql") return -1;
    if (b === "_scrml_sql") return 1;
    return parseInt(a.replace("_scrml_sql_", ""), 10) - parseInt(b.replace("_scrml_sql_", ""), 10);
  });
  for (const ident of sorted) {
    const scope = dbScopes.get(ident);
    if (!scope) {
      lines.push(`const ${ident} = new SQL(":memory:"); // no <program db=> found (likely upstream E-SQL-004)`);
      continue;
    }
    let connStr = scope.connectionString;
    // Bun.SQL DEFAULTS to postgres for a bare string — SQLite paths need the
    // `sqlite:` prefix or module-init throws. Postgres/MySQL strings carry their
    // own `postgres://` / `mysql://` prefix and pass through verbatim.
    if (scope.driver === "sqlite" && !connStr.startsWith("sqlite:") && connStr !== ":memory:") {
      connStr = "sqlite:" + connStr;
    }
    lines.push(`const ${ident} = new SQL(${JSON.stringify(connStr)});`);
  }
  lines.push("");
  return lines.join("\n");
}

// Runtime helpers a tool module may reference (its `?{}`/`==`/`log()` lowerings
// emit these). A tool bypasses the client runtime, so the helper DEFINITIONS
// must be inlined into the module — the same on-demand pattern the server emit
// uses. Table = call-signature → self-contained source.
const TOOL_RUNTIME_HELPERS: Array<{ sig: string; src: string }> = [
  { sig: "_scrml_structural_eq(", src: SERVER_STRUCTURAL_EQ_HELPER },
  { sig: "_scrml_log(", src: SERVER_LOG_HELPER },
];

// Runtime-helper identifiers the tool module legitimately DEFINES itself (the
// db handle, the harness exit-code local) — never treated as an un-inlined gap.
const TOOL_SELF_DEFINED_HELPERS = new Set<string>([
  "_scrml_exit_code",
]);

/**
 * Inline the runtime helper definitions the emitted body references, and
 * fail-closed on any `_scrml_*` helper reference the tool emit does NOT yet
 * inline (rather than silently shipping a ReferenceError). Returns the header
 * block to prepend (may be "").
 */
function buildRuntimeHelperHeader(body: string, filePath: string, errors?: unknown[]): string {
  const parts: string[] = [];
  const inlinedNames = new Set<string>();
  for (const { sig, src } of TOOL_RUNTIME_HELPERS) {
    if (body.includes(sig)) {
      parts.push(src);
      inlinedNames.add(sig.slice(0, -1)); // strip trailing "("
    }
  }
  // Fail-closed: any `_scrml_<name>(` call reference NOT inlined, NOT a
  // `_scrml_sql` db handle (a tagged template, not a call), and NOT a
  // self-defined local, is an un-supported runtime dependency for the v1 tool
  // emit. Surface it loudly (§2.2.1 fail-closed) — never emit a broken module.
  const referenced = new Set<string>();
  const re = /\b(_scrml_[A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) referenced.add(m[1]);
  for (const name of referenced) {
    if (inlinedNames.has(name)) continue;
    if (name.startsWith("_scrml_sql")) continue;
    if (TOOL_SELF_DEFINED_HELPERS.has(name)) continue;
    if (errors) {
      errors.push(new CGError(
        "E-TOOL-005",
        `E-TOOL-005: the standalone-tool module references the runtime helper ` +
        `\`${name}\` (from a scrml language feature whose lowering needs it), but the ` +
        `v1 tool-emit path (§64) does not yet inline that helper — the emitted module ` +
        `would throw \`ReferenceError: ${name} is not defined\` at runtime. This feature ` +
        `is not yet supported in a \`kind="tool"\` program; use a supported form, or ` +
        `track the follow-up to inline \`${name}\` into the tool emit.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }
  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * The set of top-level function names in `fileAST` whose emit is `async` — a fn
 * declared `async`, OR one whose body holds an inline `_{}` / `?{}` (the §23.2.4a
 * async-IIFE injects a boundary `await`, forcing the enclosing fn async; this
 * matches emit-library.ts's async-marking rule for library exports). Consumed by
 * codegen/index.ts to await-color a TOOL's calls to ASYNC IMPORTED library fns:
 * a `<foreign lang>` lib's `export fn runOpen` becomes `export async function`,
 * so the importing tool must `await runOpen(...)`. `computeAsyncFnNames` only
 * sees a file's LOCAL fns — this closes the cross-import boundary (§64 / Flag C).
 */
export function collectAsyncFnNamesFromFile(ctxOrFileAST: CompileContext | ASTNode): Set<string> {
  const { fileAST } = resolveFileAST(ctxOrFileAST);
  const out = new Set<string>();
  for (const stmt of collectTopLevelStatements(fileAST)) {
    if (!isFunctionDecl(stmt)) continue;
    const name = stmt.name as string | undefined;
    if (!name) continue;
    if (stmt.isAsync === true || bodyHasForeignOrSql(stmt.body)) out.add(name);
  }
  return out;
}

/** True when `name` is a valid bare ECMAScript identifier (safe to emit
 *  unquoted in an `import { … }` clause; a kebab/quoted export name is not). */
function isValidJsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Build the ES import header for the tool module from the file's `import-decl`
 * nodes (§21.3 / §64). A tool has NO `_scrml_modules` registry — that is the
 * browser client path (emit-client.ts); a standalone runnable module needs REAL
 * ES imports so `bun <tool>.js` resolves its dependencies at runtime.
 *
 * Rewrites:
 *   - a local `.scrml` source → the imported library's `.js` module (emitted
 *     alongside per §21.5 library-emit; see codegen/index.ts A2 routing);
 *   - `scrml:NAME` / vendor: / bare specifiers pass through UNCHANGED, so the
 *     api.js write path (`rewriteStdlibImports` / `rewriteRelativeImportPaths`)
 *     resolves them exactly as it does for server/library output.
 *
 * The scrml `pinned` binding-modifier (§21.8.1) is a scrml-scope identity
 * contract, not an ES concept — it is dropped from the emitted `import`.
 */
function buildImportHeader(fileAST: ASTNode): string {
  const imports = ((fileAST.imports as unknown)
    ?? ((fileAST.ast as ASTNode | undefined)?.imports as unknown)
    ?? []) as ASTNode[];
  if (!Array.isArray(imports) || imports.length === 0) return "";
  const lines: string[] = [];
  for (const imp of imports) {
    if (!imp || imp.kind !== "import-decl") continue;
    const source = imp.source as string | null | undefined;
    if (!source) continue;
    // Local `.scrml` dep → its emitted `.js` library module; leave
    // `scrml:`/vendor:/bare specifiers untouched (resolved at write time).
    const jsSource = source.endsWith(".scrml")
      ? source.replace(/\.scrml$/, ".js")
      : source;
    if (imp.isDefault === true) {
      // Default imports resolve only against a VENDORED ES module (npm / a
      // hand-written `.js`) — a scrml library exports NAMED bindings only, so a
      // default import of a `.scrml` lib is rejected upstream by MOD
      // (E-IMPORT-004) and never reaches emit. Emitted verbatim for the vendored
      // case; the local binding name IS the export name (`names[0]`).
      const names = (imp.names as string[] | undefined) ?? [];
      if (names.length === 0) continue;
      lines.push(`import ${names.join(", ")} from ${JSON.stringify(jsSource)};`);
      continue;
    }
    const specs = (imp.specifiers as Array<{ imported: string; local: string }> | undefined) ?? [];
    if (specs.length === 0) continue;
    const named = specs
      .map((sp) => {
        // A quoted-string export name (a kebab-cased channel export, e.g.
        // `import { "dispatch-board" as board }`) is NOT a valid bare JS
        // identifier — emit it as a quoted module-export name so the ES import
        // is syntactically valid.
        const imported = isValidJsIdentifier(sp.imported) ? sp.imported : JSON.stringify(sp.imported);
        return sp.imported === sp.local ? imported : `${imported} as ${sp.local}`;
      })
      .join(", ");
    lines.push(`import { ${named} } from ${JSON.stringify(jsSource)};`);
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/**
 * Generate the standalone-tool module JS for a `kind="tool"` program (§64).
 */
export function generateToolJs(
  ctxOrFileAST: CompileContext | ASTNode,
  errors?: unknown[],
  asyncImportedNames?: Set<string>,
): string {
  const { fileAST, filePath } = resolveFileAST(ctxOrFileAST);
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  const stmts = collectTopLevelStatements(fileAST);
  const fns = stmts.filter(isFunctionDecl);
  const asyncFnNames = computeAsyncFnNames(fns, sourceText, asyncImportedNames);
  // Foreign crossing-shadow errors (E-FOREIGN-006) surface via this sink.
  const foreignCrossingErrors: unknown[] = [];

  const emitOpts = {
    boundary: "server" as const,
    serverFnNames: asyncFnNames,
    syncPeerCalls: [] as Array<{ name: string; span: unknown }>,
    foreignCrossingErrors,
    declaredNames: new Set<string>(),
  };

  const bodyLines: string[] = [];
  bodyLines.push("// Generated standalone tool — scrml compiler output (§64)");
  bodyLines.push("// Runnable module: `bun <this-file>.js <args…>`");
  bodyLines.push("");

  // §14 enum type declarations lower to frozen runtime objects (`const X =
  // Object.freeze({...})`) — a tool bypasses the client/server bundles that
  // normally emit them, so emit them here (reuse the shared emitter for a
  // byte-identical shape). Emitted before the fns that reference them.
  const enumDefLines = emitEnumVariantObjects(fileAST);
  if (enumDefLines.length > 0) {
    for (const l of enumDefLines) bodyLines.push(l);
    bodyLines.push("");
  }

  let mainFn: ASTNode | null = null;

  for (const stmt of stmts) {
    if (isFunctionDecl(stmt)) {
      const name = (stmt.name ?? "anon") as string;
      if (name === "main") mainFn = stmt;
      const params = (stmt.params ?? []) as unknown[];
      const paramList = params.map((p, i) => toolParamSignature(p, i)).join(", ");
      const star = stmt.isGenerator ? "*" : "";
      const asyncPrefix = asyncFnNames.has(name) ? "async " : "";
      bodyLines.push(`${asyncPrefix}function${star} ${name}(${paramList}) {`);
      const inner = (stmt.body ?? []) as ASTNode[];
      for (const bodyStmt of inner) {
        if (!bodyStmt) continue;
        const code = emitLogicNode(bodyStmt, emitOpts as never);
        if (code) for (const line of code.split("\n")) bodyLines.push(`  ${line}`);
      }
      bodyLines.push("}");
      bodyLines.push("");
      continue;
    }
    // Module-level const/let/type declarations and other top-level logic.
    const code = emitLogicNode(stmt, emitOpts as never);
    if (code && code.trim()) {
      bodyLines.push(code);
    }
  }

  const body = bodyLines.join("\n");

  // ---- main() harness (§64.3) — the return-type discriminator. --------------
  const harness: string[] = [];
  harness.push("");
  harness.push("// --- main() harness (§64.3) ---");
  if (mainFn) {
    const hasReturn = (mainFn.hasReturnType === true)
      || (typeof mainFn.returnTypeAnnotation === "string" && (mainFn.returnTypeAnnotation as string).trim().length > 0);
    if (hasReturn) {
      // Numeric-return → exit-harness: the return value IS the process exit code.
      harness.push("const _scrml_exit_code = await main(process.argv.slice(2));");
      harness.push("process.exit(_scrml_exit_code);");
    } else {
      // No declared return → invoke-only: await setup, then decline to force the
      // process down — natural Bun/Node event-loop liveness decides (an active
      // Bun.serve / stdin handle keeps it alive; a drained loop exits 0).
      harness.push("await main(process.argv.slice(2));");
    }
  } else {
    // No main — E-TOOL-001 already fired at TS; emit an honest no-op so the
    // artifact still parses (the build fails on the prior fatal error).
    harness.push("// (no `function main` — E-TOOL-001)");
  }

  // Surface any E-FOREIGN-006 crossing-shadow errors the foreign lowering
  // collected (the emit-logic `case "foreign"` writes them to this sink).
  if (errors && foreignCrossingErrors.length > 0) {
    for (const e of foreignCrossingErrors) errors.push(e);
  }

  // ---- runtime-helper header — inline the helpers the body references (§45
  // structural-eq, §20.6 log), fail-closed on any un-inlined `_scrml_*` dep. ----
  const runtimeHeader = buildRuntimeHelperHeader(body, filePath, errors);

  // ---- db handle header (§44.2) — only when the tool uses `?{}`. -------------
  const dbHeader = buildDbHandleHeader(fileAST, body);

  // ---- import header (§21.3 / §64) — ES imports MUST lead the module. --------
  const importHeader = buildImportHeader(fileAST);

  const header =
    (importHeader ? importHeader + "\n" : "") +
    (dbHeader ? dbHeader + "\n" : "") +
    (runtimeHeader ? runtimeHeader + "\n" : "");
  return header + body + "\n" + harness.join("\n") + "\n";
}

/**
 * §44.7.1 W5b (S239) — generate the IN-PROCESS library module JS for a db-bound
 * library consumed by a tool (or any server-side / in-process consumer, per the
 * D5 GENERALIZE ruling). Unlike the client-facing `generateLibraryJs` — which
 * PRUNES every `?{}` fn because a browser fetches it over a generated HTTP route
 * (§12.6) — this emits each exported fn as a REAL in-process callable:
 *
 *   - a `?{}` fn lowers to `await _scrml_sql\`…\`` against the module's OWN
 *     `<db src>` connection (§44.7.1 — the module owns its connection; a
 *     `<program db=>` in the importer does NOT override it),
 *   - a `_{}` foreign fn lowers to the §23.2.4a async IIFE,
 *   - a pure fn stays a plain synchronous `export function`.
 *
 * NO HTTP route, NO client null-stub, NO `main` harness (a library is imported,
 * not run). REUSES the proven `generateToolJs` machinery: `computeAsyncFnNames`
 * (async coloring), `emitLogicNode`/`emitFnShortcutBody` at `boundary:"server"`
 * (the in-process `?{}` / `_{}` lowering), `buildDbHandleHeader` (the Bun.SQL
 * handle from `collectDbScopes`), `buildRuntimeHelperHeader` (helper inlining),
 * and `buildImportHeader` (real ES imports).
 *
 * Only db-context tool-dep libraries are routed here (codegen/index.ts); a
 * pure-fn / `<foreign lang>`-only tool-dep lib stays on `generateLibraryJs`
 * (the A/B-landed path — no `?{}` to lower, no regression risk).
 */
export function generateToolLibraryJs(
  ctxOrFileAST: CompileContext | ASTNode,
  errors?: unknown[],
): string {
  const { fileAST, filePath } = resolveFileAST(ctxOrFileAST);
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  const stmts = collectTopLevelStatements(fileAST);
  const fns = stmts.filter(isFunctionDecl);
  const asyncFnNames = computeAsyncFnNames(fns, sourceText);
  const foreignCrossingErrors: unknown[] = [];

  const bodyLines: string[] = [];
  bodyLines.push("// Generated in-process library module — scrml compiler output (§44.7.1 W5b)");
  bodyLines.push('// A db-bound library consumed IN-PROCESS (by a `kind="tool"` or a server');
  bodyLines.push("// module): its `?{}` fns run against the module's OWN <db src> connection.");
  bodyLines.push("// ES module: import { name } from './this-file.js'");
  bodyLines.push("");

  // §14 enum type declarations → frozen runtime objects. An in-process module
  // bypasses the client/server bundles that normally emit them, so emit here.
  const enumDefLines = emitEnumVariantObjects(fileAST);
  if (enumDefLines.length > 0) {
    for (const l of enumDefLines) bodyLines.push(l);
    bodyLines.push("");
  }

  for (const stmt of stmts) {
    if (isFunctionDecl(stmt)) {
      const name = (stmt.name ?? "anon") as string;
      // `main` never belongs in a library (a library is imported, not run). A
      // §21.5 lib has none; guard defensively.
      if (name === "main") continue;
      const isExported = stmt.fromExport === true;
      const params = (stmt.params ?? []) as unknown[];
      const paramList = params.map((p, i) => paramSignature(p as never, i)).join(", ");
      const star = stmt.isGenerator ? "*" : "";
      const isAsync = asyncFnNames.has(name);
      const declaredNames = new Set<string>(
        params
          .map((p) => (typeof p === "string" ? p.split(/[:=]/)[0].trim() : (p as ASTNode)?.name))
          .filter((n): n is string => typeof n === "string" && n.length > 0),
      );
      // An async fn (a `?{}` / `_{}` body, or one calling an async fn) lowers at
      // the SERVER boundary — the in-process `?{}`→`await _scrml_sql\`…\`` and
      // `_{}`→async-IIFE lowering. A synchronous fn lowers at the CLIENT boundary
      // (a server-boundary `match` wraps in `await (async () => …)()`, which would
      // make a non-async fn `await` — a SyntaxError; cf. emit-server's
      // emitModuleValueExportLines rationale).
      const bodyOpts = isAsync
        ? { boundary: "server", serverFnNames: asyncFnNames, declaredNames, insideFunctionBody: true, foreignCrossingErrors }
        : { boundary: "client", declaredNames, insideFunctionBody: true };
      const bodyCodes = emitFnShortcutBody(
        (stmt.body ?? []) as never[],
        bodyOpts as never,
        stmt.fnKind as string | undefined,
        stmt.hasReturnType as boolean | undefined,
      );
      const exportPrefix = isExported ? "export " : "";
      const asyncPrefix = isAsync ? "async " : "";
      bodyLines.push(`${exportPrefix}${asyncPrefix}function${star} ${name}(${paramList}) {`);
      for (const code of bodyCodes) for (const line of code.split("\n")) bodyLines.push(`  ${line}`);
      bodyLines.push("}");
      bodyLines.push("");
      continue;
    }

    if (stmt.kind === "export-decl") {
      const kind = stmt.exportKind as string | undefined;
      const name = stmt.exportedName as string | undefined;
      // function/fn — the paired `function-decl` (fromExport) above emitted it.
      if (kind === "function" || kind === "fn") continue;
      // type — no runtime value.
      if (kind === "type") continue;
      // value const/let — parse the initializer + lower it (client boundary,
      // synchronous). A markup-valued const is a component (mount-time), skip.
      if (kind === "const" || kind === "let") {
        if (!name) continue;
        const raw = String(stmt.raw ?? "");
        const m = raw.match(/^\s*export\s+(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*([\s\S]+)$/);
        if (!m) continue;
        const init = m[1].trim();
        // Skip a markup-valued const (a component, mount-time) and a `?{}`-init
        // const (a top-level server-only SQL read — not a plain value binding;
        // out of the W5b `?{}`-fn scope).
        if (!init || init.startsWith("<") || init.includes("?{")) continue;
        const initNode = parseExprToNode(init, filePath, 0);
        const lowered = emitExprField(initNode as never, init, { mode: "client" } as never);
        bodyLines.push(`export ${kind} ${name} = ${lowered};`);
        bodyLines.push("");
        continue;
      }
      // re-export / re-export-all — rewrite a local `.scrml` source to its
      // emitted `.js` (a tool/in-process module uses real ES module resolution).
      if (kind === "re-export" || kind === "re-export-all") {
        const raw = String(stmt.raw ?? "").trim();
        if (raw) { bodyLines.push(raw.replace(/\.scrml(["'])/g, ".js$1")); bodyLines.push(""); }
        continue;
      }
      // rename / local (`export { a as b }` / `export { x }`) — re-export a
      // binding already declared in this module; emit the raw clause verbatim.
      if (kind === "rename" || kind === "local") {
        const raw = String(stmt.raw ?? "").trim();
        if (raw) { bodyLines.push(raw); bodyLines.push(""); }
        continue;
      }
      // channel / other — not a runtime VALUE export in an in-process lib (v1).
      continue;
    }

    // type-decl — scrml type syntax, no JS.
    if (stmt.kind === "type-decl") continue;
    // Other top-level logic (a non-exported const/let helper). Lower synchronous.
    const code = emitLogicNode(stmt as never, { boundary: "client" } as never);
    if (code && code.trim()) { bodyLines.push(code); bodyLines.push(""); }
  }

  // Drain any E-FOREIGN-006 crossing-shadow diagnostics the foreign lowering
  // collected (§23.2.4a) into the live error stream.
  if (errors && foreignCrossingErrors.length > 0) {
    for (const e of foreignCrossingErrors) errors.push(e);
  }

  const body = bodyLines.join("\n");

  // ---- headers — must LEAD the module (ES imports hoist; readability). --------
  // The db handle is the module's OWN <db src> (§44.7.1); the runtime helpers are
  // whatever the in-process fn bodies reference (§45 ==, §20.6 log); the ES import
  // header rewrites local `.scrml` deps to their emitted `.js` (buildImportHeader).
  const runtimeHeader = buildRuntimeHelperHeader(body, filePath, errors);
  const dbHeader = buildDbHandleHeader(fileAST, body);
  const importHeader = buildImportHeader(fileAST);

  const header =
    (importHeader ? importHeader + "\n" : "") +
    (dbHeader ? dbHeader + "\n" : "") +
    (runtimeHeader ? runtimeHeader + "\n" : "");
  return header + body + "\n";
}
