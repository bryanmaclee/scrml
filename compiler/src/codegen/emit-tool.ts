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
import { sqlHandleRegExp, compareSqlHandles, UNRESOLVED_SQL_HANDLE } from "./sql-handle-name.ts";
import { getNodes, containsSql, containsSqlOrTransaction } from "./collect.ts";
import { bodyHasForeignOrSql, computeAsyncFnNames, emitLibraryFnMember, collectNonAwaitableAsyncCalls, syncCallbackErrorForSite, annotateNestedAsyncHelpers, asyncEscapeErrors, fileBoundNamesOf } from "./emit-library-shared.ts";
import type { AsyncEscapeSite } from "./local-async-fns.ts";
import { buildCalleeImportMap } from "./scheduling.ts";
import { emitLogicNode } from "./emit-logic.js";
import { emitEnumVariantObjects } from "./emit-client.js";
import { collectDbScopes, SERVER_STRUCTURAL_EQ_HELPER, generateHeadlessServerJs, localServerImportNameUsed } from "./emit-server.ts";
import { getToolServeConfig, isLibraryShapedFile } from "../tool-program.ts";
import type { ToolServeConfig } from "../tool-program.ts";
import { SERVER_LOG_HELPER, SERVER_PRINT_HELPER } from "./log-loc.ts";
import { FOREIGN_SEAL_FN, SERVER_FOREIGN_SEAL_HELPER } from "./foreign-seal.ts";
// §44 (S433) — the sqlite WAL + busy-timeout defaults, shared with emit-server.ts.
import { SQLITE_CONFIGURE_HELPER_LINES, sqliteWantsDefaults } from "./sqlite-defaults.ts";
// s445 — THE SQLite-file handle emission, shared with emit-server.ts.
import { sqliteFileHandle, ownedDbFilesFor, noteSqliteHandle, SQLITE_FILE_HELPER_IMPORT, sqliteFileHelperLines } from "./sqlite-file-target.ts";
import { asyncCombinatorHelperBlock, ASYNC_COMBINATOR_METHOD_ORDER } from "./async-combinators.ts";
import { emitExprField } from "./emit-expr.ts";
import { parseExprToNode } from "../expression-parser.ts";
import { CGError } from "./errors.ts";
import { buildTenantContext, compilationTenantOf, SERVER_TENANT_HELPER } from "./tenant-egress.ts";
import { SQL_ATTEMPT_FN, SERVER_SQL_ATTEMPT_HELPER } from "./sql-attempt.ts";
import { extractDesiredSchema } from "./db-authoritative.ts";
import { setTenantContextForRewriter, drainTenantViolationsFromRewriter } from "./rewrite.ts";
import {
  isLoopbackHost, isLegacyNumericIPv4, hostRefusal, bindPlan, displayUrlFor, probeIPv6, bindListeners, DEFAULT_HOST,
} from "../commands/listen.js";
import { paramSignature, indentBodyLines } from "./utils.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/**
 * §64.9 bind address of a headless serve-target (S447 ruling (iv): "generated
 * headless serve targets default to loopback, prod stays all-interfaces").
 *
 * The generated server binds `DEFAULT_HOST` (127.0.0.1 + its ::1 twin) unless
 * the `SCRML_HOST` environment variable names another address (`0.0.0.0` =
 * every interface + its `::` twin). The value is validated exactly as
 * `scrml dev --host` / `scrml serve --host` validate theirs (#1207): whitespace
 * / control characters and legacy numeric IPv4 shorthand (`0`, `127.1`, …) are
 * refused, as is an empty value; a refused value or a primary socket that cannot
 * bind exits 1 with a message on stderr.
 *
 * The validation, bind plan, IPv4/IPv6 twin and URL functions are NOT restated:
 * they are `commands/listen.js`'s own self-contained functions, re-printed by the
 * runtime's `Function.prototype.toString()` (Bun's printer, not the source text) into
 * the module (the generated server runs as a plain `bun <file>.js`, with no
 * compiler beside it to import from).
 */
export const SERVE_HOST_ENV = "SCRML_HOST";

const SERVE_BIND_FNS = [
  isLoopbackHost, isLegacyNumericIPv4, hostRefusal, bindPlan, displayUrlFor, probeIPv6, bindListeners,
];

function serveBindHelperLines(): string[] {
  const out: string[] = [];
  out.push(`// --- §64.9 bind address — loopback by default; ${SERVE_HOST_ENV} opts in (S447 ruling iv) ---`);
  out.push("// The functions inside are compiler/src/commands/listen.js's functions as printed by the");
  out.push("// runtime's Function.prototype.toString (not its source text), so this server validates");
  out.push("// and binds its host with the same code `scrml dev` / `scrml serve` run.");
  out.push("const _scrml_bind = (() => {");
  for (const fn of SERVE_BIND_FNS) {
    // Not re-indented: a template literal spanning lines must keep its text exactly.
    out.push(fn.toString().replace(/\r\n/g, "\n"));
  }
  out.push(`  function host(raw) {`);
  out.push(`    if (raw === undefined) return ${JSON.stringify(DEFAULT_HOST)};`);
  out.push(`    const refused = raw === ""`);
  out.push(`      ? { message: "is set but empty. Unset it to bind loopback, or name an address (e.g. 0.0.0.0 for every interface)." }`);
  out.push(`      : hostRefusal(raw);`);
  out.push(`    if (refused) {`);
  out.push(`      console.error(\`scrml serve-target: ${SERVE_HOST_ENV} \${refused.message}\`);`);
  out.push(`      process.exit(1);`);
  out.push(`    }`);
  out.push(`    return raw;`);
  out.push(`  }`);
  out.push(`  function listen(config, host) {`);
  out.push(`    const plan = bindPlan(host);`);
  out.push(`    const serve = (c) => Bun.serve(c);`);
  out.push(`    const { server, bound } = bindListeners(serve, config, plan, plan.twin, () => probeIPv6(serve), (m) => console.error(m.replace(/^\\[scrml\\]/, "scrml serve-target:")), (err) => {`);
  out.push(`      const where = config.port === 0 ? "an ephemeral port" : \`port \${config.port}\`;`);
  out.push(`      console.error(`);
  out.push(`        \`scrml serve-target: could not listen on host "\${host}" at \${where} — tried \${plan.primary}. \` +`);
  out.push(`        \`The address is not one of this machine's, the name does not resolve, or the port is already in use. \` +`);
  out.push(`        \`Set ${SERVE_HOST_ENV} to an address this machine owns (0.0.0.0 = every interface), or change serve=. \` +`);
  out.push(`        \`Underlying error: \${[err && err.code, err && err.message].filter(Boolean).join(" ")}\`,`);
  out.push(`      );`);
  out.push(`      process.exit(1);`);
  out.push(`    });`);
  out.push(`    if (isLoopbackHost(host)) {`);
  out.push(`      console.error(\`scrml serve-target listening on \${displayUrlFor(bound, host, server.port)}\`);`);
  out.push(`    } else {`);
  out.push(`      console.error(\`scrml serve-target listening on \${bound.join(" + ")} port \${server.port} — reachable from the network. Anyone who can reach this machine can use it.\`);`);
  out.push(`    }`);
  out.push(`    return server;`);
  out.push(`  }`);
  out.push(`  return { host, listen };`);
  out.push(`})();`);
  return out;
}

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

/**
 * g-serve-tool-treeshakes-main-only-import (S256) — the extra IMPORT-liveness
 * reachability root for a `serve=` tool's S207 local-`.scrml` import prune.
 *
 * That prune (emit-server.ts:generateServerJs) decides which deferred local
 * `.scrml` imports survive by scanning the ASSEMBLED ROUTE body for each import's
 * local name. But a serve= tool's composing `main`/setup + helper bodies are
 * emitted SEPARATELY (below, appended after the headless module), so an import
 * referenced ONLY there is invisible to that scan → dropped → boot-time
 * `ReferenceError`. Return the SOURCE text of every NON-import top-level statement
 * (main / helpers / bindings / routes) as an extra reachability root the prune
 * unions in. Source-token granularity matches the prune's own conservative
 * identifier check; import lines are EXCLUDED so an import can never keep itself
 * alive (a genuinely-dead import still drops — a headless tool has no client, so a
 * never-referenced import is truly dead).
 */
function collectServeImportReachabilitySrc(fileAST: ASTNode): string {
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  if (!sourceText) return "";
  const parts: string[] = [];
  for (const s of collectTopLevelStatements(fileAST)) {
    const k = (s as { kind?: string }).kind;
    if (k === "import-decl" || k === "use-decl") continue;
    const sp = (s as { span?: { start?: number; end?: number } }).span;
    if (sp && typeof sp.start === "number" && typeof sp.end === "number" && sp.end > sp.start) {
      parts.push(sourceText.slice(sp.start, sp.end));
    }
  }
  return parts.join("\n");
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
function buildDbHandleHeader(fileAST: ASTNode, emittedBody: string, awaitConfigure = false, errors?: unknown[]): string {
  const usedIdents = new Set<string>();
  const re = sqlHandleRegExp(); // every handle name (sql-handle-name.ts)
  let m: RegExpExecArray | null;
  while ((m = re.exec(emittedBody)) !== null) usedIdents.add(m[0]);
  // FAIL CLOSED (S451 review) — a lowering told no handle in a multi-database file.
  // Never declared (no `:memory:` stand-in); a compile error.
  if (usedIdents.delete(UNRESOLVED_SQL_HANDLE) && errors) {
    errors.push(new CGError(
      "E-INTERNAL-DB-HANDLE-UNRESOLVED",
      "E-INTERNAL-DB-HANDLE-UNRESOLVED: this file declares more than one database, and a database " +
      "query in it was lowered without knowing which database it runs on (§8.1.1). The compiler " +
      "refuses rather than run it on the file's first database. This is a compiler defect.",
      { file: typeof fileAST.filePath === "string" ? fileAST.filePath : "", start: 0, end: 0, line: 1, col: 1 },
      "error",
    ));
  }
  if (usedIdents.size === 0) return "";

  const dbScopes = collectDbScopes(fileAST as never);
  const lines: string[] = [];
  lines.push("// --- §44.2: Bun.SQL handle declarations (compiler-generated) ---");
  lines.push('import { SQL } from "bun";');
  const sorted = Array.from(usedIdents).sort(compareSqlHandles);
  // §44 (S433 fix-round, F2-2) — the file-backed sqlite handles this module declares,
  // collected as they are emitted and configured in one block after them.
  const sqliteConfiguredIdents: string[] = [];
  // s445-dev-db-side-file — the SAME SQLite-file emission as the server half
  // (codegen/sqlite-file-target.ts): the file the compile-time schema read resolved,
  // recorded relative to the project root and resolved at runtime against
  // SCRML_DATA_DIR ?? that root (§47.14); an owning handle (this file declares the
  // schema) opens at load and may create, a referencing one opens lazily and never
  // creates (§8.1.1). A tool is run from wherever the user's shell is (`bun
  // src/ports/dist/tick-tool.js` from the repo root), so a CWD-relative literal opened
  // — and created — a different file than the compiler read.
  const sourceFile = typeof fileAST.filePath === "string" ? fileAST.filePath : "";
  const sqliteFileHelperAt = lines.length;
  let sqliteFileProjectRoot: string | null = null;
  for (const ident of sorted) {
    const scope = dbScopes.get(ident);
    if (!scope) {
      lines.push(`const ${ident} = new SQL(":memory:"); // no <program db=> found (likely upstream E-SQL-004)`);
      continue;
    }
    const sqliteFile = scope.driver === "sqlite" && sourceFile
      ? sqliteFileHandle(
          scope.connectionString,
          sourceFile,
          (fileAST as any)._outputBaseDir,
          ownedDbFilesFor(getNodes(fileAST as never), sourceFile),
        )
      : null;
    if (sqliteFile !== null) {
      sqliteFileProjectRoot = sqliteFile.projectRoot;
      noteSqliteHandle(fileAST, sqliteFile.record, "tool");
      lines.push(`const ${ident} = ${sqliteFile.expr};`);
      if (sqliteFile.owns) sqliteConfiguredIdents.push(ident);
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
    if (sqliteWantsDefaults(scope.driver, connStr)) sqliteConfiguredIdents.push(ident);
  }
  // §44 (S433 fix-round, F2-2) — WAL + a 5s busy-timeout, the SAME emitter the server
  // half uses (`codegen/sqlite-defaults.ts`).
  //
  // ⛔ THIS CALL SITE WAS MISSED ON THE FIRST PASS AND THE OMISSION WAS NOT COSMETIC.
  // `buildDbHandleHeader` is reached from `assembleModuleHeaders` by BOTH
  // `generateToolJs` (`kind="tool"`) and `generateToolLibraryJs`, so a clean-compiling
  // tool program emitted its sqlite handle bare. MEASURED against a WAL database with a
  // write lock held by another process: the TOOL handle FAILED after 8ms
  // (`SQLITE_BUSY`) while the fixed SERVER handle WROTE after 1205ms. `journal_mode=WAL`
  // persisting in the FILE does not rescue it — **`busy_timeout` is PER-CONNECTION and
  // the tool's was 0** — so a scrml CLI tool sharing the adopter's database with the
  // scrml server was still blocked by the exact symptom
  // `g-native-sqlite-connection-lacks-wal-and-busy-timeout-config` names.
  //
  // ⛔ AND THE TOOL MAIN MODULE **AWAITS** IT, WHICH THE SERVER MUST NOT. A tool is
  // SHORT-LIVED and the §64.3 harness ends with `process.exit(code)` — a HARD exit that
  // kills a still-pending floating promise. MEASURED with the floating form: the tool's
  // `busy_timeout` DID land (it is the first statement queued on the connection, so it
  // is applied before `main()`'s own queries) and the contended write succeeded after
  // 1235ms — but `journal_mode = WAL` NEVER landed, because `process.exit` fired first
  // (`journal_mode` still `delete` after an UNCONTENDED tool run). Awaiting makes the
  // WAL upgrade deterministic for a tool-only adopter, who otherwise would never get it
  // from anywhere.
  //
  // This is safe HERE and would not be in emit-server: `generateToolJs` already emits
  // an unconditional top-level `await main(...)` in that same harness, so the module is
  // top-level-await-bearing by construction and nothing evaluates it with
  // `new Function` (the conformance tool runner spawns `bun <file>` as a real
  // subprocess; only `.server.js` goes through `evalServerModule`). The LIBRARY caller
  // keeps the floating form — it is long-lived enough not to need the barrier and it is
  // imported by other modules, so it gets no top-level await it did not already have.
  if (sqliteFileProjectRoot !== null) {
    lines.splice(sqliteFileHelperAt, 0, SQLITE_FILE_HELPER_IMPORT, "", ...sqliteFileHelperLines(sqliteFileProjectRoot), "");
  }
  // A referencing sqlite-file handle calls `_scrml_sqlite_configure` itself when it opens.
  if (sqliteConfiguredIdents.length > 0 || sqliteFileProjectRoot !== null) {
    lines.push("");
    lines.push(...SQLITE_CONFIGURE_HELPER_LINES);
    for (const ident of sqliteConfiguredIdents) {
      lines.push(`${awaitConfigure ? "await" : "void"} _scrml_sqlite_configure(${ident});`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// Runtime helpers a tool module may reference (its `?{}`/`==`/`log()` lowerings
// emit these). A tool bypasses the client runtime, so the helper DEFINITIONS
// must be inlined into the module — the same on-demand pattern the server emit
// uses. Table = call-signature → self-contained source.
// ---------------------------------------------------------------------------
// §14.8.10 tenant floor in a `kind="tool"` module. A tool runs OUTSIDE any
// request, so (S452 readings) a read of a tenant-scoped table without
// `.acrossTenants()` sees ZERO rows and a tenant-injected INSERT is refused by
// name at runtime; the compile-time refusals (E-TENANT-AGG / E-TENANT-WRITE)
// apply as in a web app. Armed from the file's own `<schema>` declarations and
// the compilation's one tenant set (S455) around the tool's SQL lowering, then
// released.
// ---------------------------------------------------------------------------
function beginToolTenantFloor(fileAST: ASTNode): boolean {
  const desired = extractDesiredSchema(fileAST as never);
  const dbScopes = collectDbScopes(fileAST as never);
  const ctx = buildTenantContext(
    { protectedByTable: new Map(), schemaByTable: new Map() } as never,
    desired.tenantTables,
    desired.schemaText,
    (ident: string) => dbScopes.get(ident)?.driver,
    // S455 — the compilation's one tenant set (runCG attaches it to the file AST).
    compilationTenantOf(fileAST),
  );
  if (ctx.tenantScopedTables.size === 0) return false;
  setTenantContextForRewriter(ctx);
  return true;
}
function endToolTenantFloor(armed: boolean, filePath: string, errors?: unknown[]): void {
  if (!armed) return;
  for (const v of drainTenantViolationsFromRewriter()) {
    errors?.push(new CGError(v.code, v.message, { file: filePath, start: 0, end: 0, line: 1, col: 1 }, "error"));
  }
  setTenantContextForRewriter(null);
}
/** The tenant-floor runtime names a tool body may call (all defined by SERVER_TENANT_HELPER). */
const TENANT_HELPER_CALL_RE = /\b_scrml_tenant_(?:scope|scope_none|write_key)\(/;
const TENANT_HELPER_NAMES = ["_scrml_tenant_scope", "_scrml_tenant_scope_none", "_scrml_tenant_write_key"];

const TOOL_RUNTIME_HELPERS: Array<{ sig: string; src: string }> = [
  { sig: "_scrml_structural_eq(", src: SERVER_STRUCTURAL_EQ_HELPER },
  { sig: "_scrml_log(", src: SERVER_LOG_HELPER },
  // §20.7 — print()/println() clean-stdout builtin. Joining this inlined set
  // means a `_scrml_print(` reference is INLINED (not an E-TOOL-005 gap): a
  // `kind="tool"` program is the primary print consumer (its stdout is parsed).
  { sig: "_scrml_print(", src: SERVER_PRINT_HELPER },
  // §19.8.3 (S451 R11) — a `?{}` handled by `!{}` / `match` lowers through
  // `_scrml_sql_attempt(`. Listed explicitly: the `_scrml_sql*` db-handle
  // exemption in the fail-closed scan below would otherwise wave it through
  // un-inlined.
  { sig: `${SQL_ATTEMPT_FN}(`, src: SERVER_SQL_ATTEMPT_HELPER },
  // §23.2.4a — a `_{}` slice (main's host I/O, or an inline value-returning
  // block) is built in its sealed scope by this helper (foreign-seal.ts).
  { sig: `${FOREIGN_SEAL_FN}(`, src: SERVER_FOREIGN_SEAL_HELPER },
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
  // §14.8.10 — the tenant floor's source filter / write key (one block, once).
  if (TENANT_HELPER_CALL_RE.test(body)) {
    parts.push(SERVER_TENANT_HELPER);
    for (const n of TENANT_HELPER_NAMES) inlinedNames.add(n);
  }
  // Phase-2 colorless-async — inline any collection-combinator helper the tool
  // body lowered an async callback to (`_scrml_<method>Async(`). Register each used
  // name so the fail-closed scan below does NOT flag it as an un-inlined dependency.
  const combBlock = asyncCombinatorHelperBlock(body);
  if (combBlock) {
    parts.push(combBlock);
    for (const method of ASYNC_COMBINATOR_METHOD_ORDER) {
      if (body.includes(`_scrml_${method}Async(`)) inlinedNames.add(`_scrml_${method}Async`);
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
export function collectAsyncFnNamesFromFile(
  ctxOrFileAST: CompileContext | ASTNode,
  seedAsync?: Set<string>,
  exportRegistry?: Map<
    string,
    Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>
  > | null,
): Set<string> {
  const { fileAST } = resolveFileAST(ctxOrFileAST);
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  // FIXPOINT over the file's call graph — an EXPORTED fn that is TRANSITIVELY
  // async (calls a `?{}`/`_{}` fn without its OWN `?{}` — e.g. a `report()`
  // calling a db `loadRows()`) is async too, so the importing tool `await`s it.
  // A direct-only scan would leave `report()` un-awaited → `[object Promise]`.
  // `seedAsync` carries this file's OWN async IMPORTED locals (a fn calling an
  // async fn imported from ANOTHER lib is async), so the transitive coloring is
  // cross-file-complete (the caller resolves it recursively + memoized).
  const fns = collectTopLevelStatements(fileAST).filter(isFunctionDecl);
  // Seam-A Gap 1 (GITI-037) — the per-file stdlib-Promise classifier inputs so a
  // fn calling `safeCallAsync` (or a `scrml:auth`/`http` async export) is
  // recognized async in the cross-module fixpoint too (else the importing file's
  // seed never learns this file's export is async). `.ast.imports` hoist per MOD.
  // Cleanup 8 — buildCalleeImportMap folds the `.ast.imports` hoist internally.
  const calleeMap = exportRegistry ? buildCalleeImportMap(fileAST as any) : null;
  return computeAsyncFnNames(fns, sourceText, seedAsync, calleeMap, exportRegistry ?? null);
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
// Source-token liveness — is `name` referenced anywhere in `src`? The tool's local-
// `.scrml` import tree-shake reuses the SERVER prune's predicate `localServerImportNameUsed`
// (emit-server.ts) rather than a second copy. The prior local `identReferencedInSrc` used
// `\b`, which CANNOT match a boundary before a leading `$` (both sides non-word), so a
// `$`-prefixed import local was judged dead and the whole import dropped → a dangling ref
// → runtime ReferenceError (g-tool-import-prune-drops-dollar-prefixed-local, S340-peter fixing
// a #508 HIGH; Rule 7 — one predicate, manual boundary guard, not a drifting `\b` copy).

function buildImportHeader(fileAST: ASTNode): string {
  const imports = ((fileAST.imports as unknown)
    ?? ((fileAST.ast as ASTNode | undefined)?.imports as unknown)
    ?? []) as ASTNode[];
  if (!Array.isArray(imports) || imports.length === 0) return "";
  // g-tool-over-imports-all-lib-exports (S339-peter) — the tool's non-import body
  // source, for tree-shaking local `.scrml` imports to the names actually used.
  const bodyRefSrc = collectServeImportReachabilitySrc(fileAST);
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
    let specs = (imp.specifiers as Array<{ imported: string; local: string }> | undefined) ?? [];
    if (specs.length === 0) continue;
    // g-tool-over-imports-all-lib-exports (S339-peter) — a LOCAL `.scrml` import's
    // specifier list may have been AUGMENTED by the component-expander helper-bind
    // pass (`component-expander.ts:4069`) with the lib's OTHER non-component exports,
    // to resolve an inlined component's helper calls. A headless `kind="tool"`
    // inlines NO components, so that augmentation is inapplicable — yet the extra
    // specifiers are emitted verbatim (the tool target has no bundler tree-shake),
    // so the tool over-imports the whole lib. Tree-shake a local-lib import to the
    // names the tool BODY references (the same conservative source-token liveness
    // the S207 prune uses). Non-`.scrml` (stdlib / vendor / bare) imports are left
    // alone. Fail-safe: no body source → keep every specifier (no regression).
    if (source.endsWith(".scrml") && bodyRefSrc) {
      specs = specs.filter((sp) => localServerImportNameUsed(bodyRefSrc, sp.local || sp.imported));
      if (specs.length === 0) continue; // every bound name is dead → drop the whole (dead) import
    }
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
 * The emit-server inputs a `kind="tool" serve=` program threads into the
 * headless route/fetch emit (§64, Fork 1A). Supplied by codegen/index.ts (which
 * owns the route-inference routeMap + the auth/middleware/protect stage results);
 * absent for a NON-serve tool (the CLI-tool path emits no routes).
 */
export interface ToolServeEmitDeps {
  routeMap: unknown;
  authMiddleware?: unknown;
  middlewareConfig?: unknown;
  batchPlan?: unknown;
  batchPlannerErrors?: Array<{ code: string; message: string; span?: unknown }>;
  protectAnalysis?: unknown;
  exportRegistry?: unknown;
}

/**
 * Generate the standalone-tool module JS for a `kind="tool"` program (§64).
 *
 * When the program carries a `serve=` listener (§64, Fork 1A) AND the caller
 * supplies `serveEmitDeps` (the route-inference routeMap + stage results), the
 * emit routes to the SERVE-HARNESS path (`generateServeHarnessToolJs`): a
 * compiler-owned `Bun.serve({ port, fetch, websocket? })` mounting the program's
 * `<endpoint>` / SSE routes (replacing the §64.7 hand-rolled `_{}` `Bun.serve`).
 * A NON-serve tool (or a serve= tool with no deps threaded) stays on the plain
 * CLI/long-running-`main` path below — byte-identical to the pre-Unit-2 emit.
 */
/**
 * Phase-2 colorless-async (F2 — S239 review) — the tool no-silent-leak drain. A
 * Promise-returning async call (a stdlib primitive OR a clean-family async-callback
 * COMBINATOR) that lands in a non-awaitable position (a sync-lambda body / param
 * default / raw region) cannot be auto-awaited — emit-expr emits it BARE (an
 * unawaited Promise → accept-all leak). Mirror the library/server/client drain
 * (`collectNonAwaitableAsyncCalls`) so the tool fails closed instead of leaking.
 * `calleeMap`/`exportRegistry` are null here — the tool's `asyncFnNames` already
 * carries the imported async names (the `asyncImportedNames` seed to
 * `computeAsyncFnNames`), which is the source of truth `isAsyncName` consults.
 */
/**
 * s440 — resolve nested helpers against the tool's async set (see local-async-fns.ts);
 * s441 (S440 F4) — and report every async fn a tool body uses as a VALUE.
 */
function annotateToolFns(fns: ASTNode[], asyncFnNames: Set<string>, filePath: string, errors: unknown[] | undefined, fileAST: unknown): void {
  const escapes: AsyncEscapeSite[] = [];
  const boundNames = fileBoundNamesOf(fileAST);
  for (const _f of fns) annotateNestedAsyncHelpers(_f, { asyncFnNames, boundNames }, /*sqlIsAsync*/ true, escapes);
  if (!errors) return;
  for (const err of asyncEscapeErrors(escapes, filePath)) {
    const es = err.span as { start?: number };
    const dup = (errors as CGError[]).some((x) => x && x.code === err.code && (x.span as { start?: number })?.start === es?.start);
    if (!dup) errors.push(err);
  }
}

function drainToolAsyncSyncCallbackLeaks(
  fns: ASTNode[],
  asyncFnNames: Set<string>,
  filePath: string,
  errors?: unknown[],
): void {
  if (!errors) return;
  const seen = new Set<string>();
  for (const fn of fns) {
    const params = (fn as { params?: unknown }).params;
    const span = (fn as { span?: unknown }).span;
    for (const site of collectNonAwaitableAsyncCalls(fn.body, null, null, asyncFnNames, params, span)) {
      const sp = (site.span ?? {}) as { start?: number };
      const key = `${site.name}@${sp.start ?? -1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(syncCallbackErrorForSite(site, null, filePath));
    }
  }
}

export function generateToolJs(
  ctxOrFileAST: CompileContext | ASTNode,
  errors?: unknown[],
  asyncImportedNames?: Set<string>,
  serveEmitDeps?: ToolServeEmitDeps,
): string {
  const { fileAST, filePath } = resolveFileAST(ctxOrFileAST);
  const sourceText = (fileAST._sourceText ?? null) as string | null;

  // §64 (Fork 1A, Unit 2) — the listener-owning `kind="tool" serve=` serve-target.
  const serveConfig = getToolServeConfig(fileAST);
  if (serveConfig && serveEmitDeps) {
    return generateServeHarnessToolJs(
      fileAST, filePath, serveConfig, serveEmitDeps, errors, asyncImportedNames,
    );
  }

  const stmts = collectTopLevelStatements(fileAST);
  const fns = stmts.filter(isFunctionDecl);
  const asyncFnNames = computeAsyncFnNames(fns, sourceText, asyncImportedNames);
  // s440 — nested helpers resolved against the tool's async set (see local-async-fns.ts).
  annotateToolFns(fns, asyncFnNames, filePath, errors, fileAST);
  // Foreign crossing-shadow errors (E-FOREIGN-006) surface via this sink.
  const foreignCrossingErrors: unknown[] = [];
  // E-SQL-006 (§44.3) — `.prepare()` on a `?{}` result in a tool fn body surfaces
  // via this dedicated narrow sink (mirror of `foreignCrossingErrors`).
  const preparedStmtErrors: unknown[] = [];

  const emitOpts = {
    boundary: "server" as const,
    serverFnNames: asyncFnNames,
    syncPeerCalls: [] as Array<{ name: string; span: unknown }>,
    foreignCrossingErrors,
    preparedStmtErrors,
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

  const _tenantArmed = beginToolTenantFloor(fileAST);
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
        if (code) for (const line of indentBodyLines(code, "  ")) bodyLines.push(line);
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
  endToolTenantFloor(_tenantArmed, filePath, errors);

  // F2 no-silent-leak — fail closed on any non-awaitable async (stdlib primitive or
  // async-callback combinator) the tool emitted BARE.
  drainToolAsyncSyncCallbackLeaks(fns, asyncFnNames, filePath, errors);

  const body = bodyLines.join("\n");

  // §20.5 (i29e, S239 FIX 6) — the `session` cookie-establishment builtin is
  // WEB-APP ONLY. A headless `kind="tool"` program is bearer-auth territory: it
  // has no cookie-session request/response context, so `session.*` (lowered to
  // `_scrml_req._scrml_sess.*` by emit-expr) has no wrapper and would crash at
  // runtime. Fire a build-blocking E-SESSION-CONTEXT rather than ship the broken
  // ref (mirrors the generateServerJs post-emission scan for the web-app path).
  // S239-2 FIX C (residual, LOW): this is a string-scan, so a tool that merely
  // embeds the literal `_scrml_req._scrml_sess.` in a user string/comment would
  // over-block (fail-safe — never ships a hole). A near-impossible contrivance for
  // an internal-identifier literal; a fully-sound site-recording fix is a follow-up.
  if (errors && body.includes("_scrml_req._scrml_sess.")) {
    errors.push(new CGError(
      "E-SESSION-CONTEXT",
      "E-SESSION-CONTEXT: the `session` cookie-establishment builtin is not available in " +
      "a headless `kind=\"tool\"` program — that shape uses bearer auth and has no " +
      "cookie-session request/response context. Remove the `session.*` call, or make this " +
      "a web-app `<program>` (drop `kind=\"tool\"`).",
      { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      "error",
    ));
  }

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
  // Surface any E-SQL-006 `.prepare()` diagnostics the SQL lowering collected.
  if (errors && preparedStmtErrors.length > 0) {
    for (const e of preparedStmtErrors) errors.push(e);
  }

  // §8.1.1 / §44.7 E-SQL-004 — a `kind="tool"` PROGRAM with a `?{}` SQL block that
  // resolves against no `<program db=>` / `<db src=>` scope. Mirrors the
  // generateServerJs gate: fire the SHALL-error instead of the silent
  // `new SQL(":memory:")` fallback (buildDbHandleHeader) which would give the tool
  // an ephemeral empty db (runtime data loss). Gated on a genuine `?{}` block
  // (`containsSql` — NOT an idempotency-shadow `_scrml_sql` ref, which is
  // E-CPS-NONIDEM-NO-STORAGE) and a non-library file (a module-with-db-context is
  // E-SQL-009, fired in generateToolLibraryJs). A tool program is never
  // library-shaped, but the guard keeps the two paths explicitly disjoint.
  if (errors && dbHandleMissingScope(fileAST as never, body)
      && containsSql(fileAST as never) && !isLibraryShapedFile(fileAST)) {
    errors.push(new CGError(
      "E-SQL-004",
      "E-SQL-004: a `?{}` SQL block has no `db=` declaration in any ancestor `<program>`. " +
      "Add a `db=` attribute to the enclosing `<program>` element, e.g. " +
      "`<program kind=\"tool\" db=\"./app.db\">` for SQLite or a `postgres://...` connection " +
      "string. Without it the query has no database connection.",
      { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      "error",
    ));
  }

  // Module headers (§21.3 imports · §44.2 Bun.SQL handle · inlined runtime
  // helpers) — shared with generateToolLibraryJs; must LEAD the module.
  // `true`: this module's §64.3 harness ends with `process.exit()`, so the sqlite
  // configure must be AWAITED or the WAL pragma is killed mid-flight (F2-2).
  const header = assembleModuleHeaders(fileAST, filePath, body, errors, true);
  return header + body + "\n" + harness.join("\n") + "\n";
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * §64 (Fork 1A, Unit 2) — emit a LISTENER-OWNING `kind="tool" serve=` module.
 *
 * The move: delegate the WHOLE §61 `<endpoint>` + §37 SSE route/handler/`fetch`
 * surface to `generateHeadlessServerJs` (Unit 1 — a self-contained headless
 * server module: enum backing objects, decode helpers, route handlers, the
 * private arm helper fns, `export const routes`, `export async function fetch`,
 * `export const _scrml_ws_handlers` when the program has §38 channels, its ES
 * imports + Bun.SQL db handles + inlined runtime helpers), then bolt a
 * compiler-owned `Bun.serve({ port, fetch, websocket? })` serve-harness on top —
 * replacing the §64.7 hand-rolled `_{}` `Bun.serve`. NO html, NO client bundle,
 * NO CSRF scaffold (the headless shape already omits them, Unit 1).
 *
 * The serve-harness iterates `routes` DIRECTLY (mirroring the web-app entry in
 * commands/build.js), passing `(request, server)` to a WS upgrade route (which
 * needs `server.upgrade`) and `(request)` to an HTTP route — the WinterCG
 * aggregate `fetch(request)` is single-arg and cannot upgrade a WS, so the
 * harness does not route through it. A `cors=`-emitted `/*` OPTIONS preflight
 * route matches any pathname for its method.
 *
 * §64.3 main-optional: with NO `function main` the serve-harness IS the active
 * handle (its `Bun.serve` keeps the process alive). A COMPOSING no-return `main`
 * (setup) is emitted + `await`ed BEFORE the harness holds the process; a
 * numeric-return `main` + `serve=` already fired E-TOOL-SERVE-MAIN-EXITS at TS.
 */
function generateServeHarnessToolJs(
  fileAST: ASTNode,
  filePath: string,
  serveConfig: ToolServeConfig,
  deps: ToolServeEmitDeps,
  errors?: unknown[],
  asyncImportedNames?: Set<string>,
): string {
  const cgErrors = (errors ?? []) as never[];
  // g-serve-tool-treeshakes-main-only-import (S256) — stash the composing-body
  // import reachability BEFORE emitting the headless module: its S207 local-`.scrml`
  // import prune runs INSIDE `generateHeadlessServerJs` and reads this field so an
  // import referenced only in `main`/a setup helper (emitted separately below)
  // survives the route-body-only liveness scan.
  (fileAST as { _serveImportReachabilityExtra?: string })._serveImportReachabilityExtra =
    collectServeImportReachabilitySrc(fileAST);
  // 1. The headless server module — the full §61/§37 route/fetch/ws surface. The
  //    §39 middleware config (`cors=`/`log=`/…) is the REAL config codegen/index.ts
  //    threads from `fileAST.middlewareConfig` (compute-program-config, §39.2); a
  //    `serve= cors=` tool's CORS preflight route + headers emit from it.
  const headlessModule = generateHeadlessServerJs(
    fileAST as never,
    deps.routeMap as never,
    cgErrors,
    (deps.authMiddleware ?? null) as never,
    (deps.middlewareConfig ?? null) as never,
    deps.batchPlan as never,
    deps.batchPlannerErrors as never,
    deps.protectAnalysis as never,
    (deps.exportRegistry ?? null) as never,
  );
  const hasRoutes = /export const routes = \[/.test(headlessModule);
  const hasWs = /export const _scrml_ws_handlers\b/.test(headlessModule);

  // 2. Emit the top-level fns the headless module did NOT emit — the composing
  //    `main` + any `main`-only helper. A fn the headless already emits (a server-
  //    boundary route fn, OR a private arm/value-export helper `function NAME(`)
  //    is skipped (no double-definition); the enum backing objects + imports + db
  //    handles all ride on the headless module.
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  const stmts = collectTopLevelStatements(fileAST);
  const fns = stmts.filter(isFunctionDecl);
  const asyncFnNames = computeAsyncFnNames(fns, sourceText, asyncImportedNames);
  // s440 — nested helpers resolved against the tool's async set (see local-async-fns.ts).
  annotateToolFns(fns, asyncFnNames, filePath, errors, fileAST);
  const foreignCrossingErrors: unknown[] = [];
  // E-SQL-006 (§44.3) — dedicated narrow .prepare() sink (mirror of foreignCrossingErrors).
  const preparedStmtErrors: unknown[] = [];
  const emitOpts = {
    boundary: "server" as const,
    serverFnNames: asyncFnNames,
    syncPeerCalls: [] as Array<{ name: string; span: unknown }>,
    foreignCrossingErrors,
    preparedStmtErrors,
    declaredNames: new Set<string>(),
  };
  const routeMap = deps.routeMap as { functions?: Map<string, { boundary?: string }> } | undefined;
  const isRouteFn = (fn: ASTNode): boolean => {
    const sp = (fn as { span?: { start?: number } }).span;
    const id = `${filePath}::${sp?.start}`;
    const r = routeMap?.functions?.get(id);
    return !!r && r.boundary === "server";
  };
  const headlessDefinesFn = (name: string): boolean =>
    new RegExp("function\\*?\\s+" + escapeRegExp(name) + "\\s*\\(").test(headlessModule);

  const extraLines: string[] = [];
  let mainFn: ASTNode | null = null;
  // A top-level `const`/`let` (or `export const`) the headless module already
  // emits (an exported value-export binding) — do not re-emit it (double-decl).
  const headlessDeclaresBinding = (name: string): boolean =>
    new RegExp("(?:export\\s+)?(?:const|let)\\s+" + escapeRegExp(name) + "\\b").test(headlessModule);

  const _tenantArmed = beginToolTenantFloor(fileAST);
  for (const stmt of stmts) {
    if (isFunctionDecl(stmt)) {
      const name = (stmt.name ?? "anon") as string;
      if (name === "main") mainFn = stmt;
      // The headless already emits route fns + private/value-export helpers.
      if (name !== "main" && (isRouteFn(stmt) || headlessDefinesFn(name))) continue;
      const params = (stmt.params ?? []) as unknown[];
      const paramList = params.map((p, i) => toolParamSignature(p, i)).join(", ");
      const star = stmt.isGenerator ? "*" : "";
      const asyncPrefix = asyncFnNames.has(name) ? "async " : "";
      extraLines.push(`${asyncPrefix}function${star} ${name}(${paramList}) {`);
      for (const bodyStmt of (stmt.body ?? []) as ASTNode[]) {
        if (!bodyStmt) continue;
        const code = emitLogicNode(bodyStmt, emitOpts as never);
        if (code) for (const line of code.split("\n")) extraLines.push(`  ${line}`);
      }
      extraLines.push("}");
      extraLines.push("");
      continue;
    }
    // A top-level `const`/`let` / other top-level logic — the PLAIN CLI tool path
    // emits these, and the headless ROUTE emit does NOT (it emits only EXPORTED
    // value bindings + §14 enum objects). A non-exported top-level `const`
    // referenced by an `<endpoint>` arm AND/OR `main` would otherwise be a runtime
    // `ReferenceError`. Emit it (unless the headless already declares it — no
    // double-decl); a `type X:enum` lowers to "" here (the enum object rides on
    // the headless module), so it is naturally skipped.
    const code = emitLogicNode(stmt as never, emitOpts as never);
    if (!code || !code.trim()) continue;
    const declared = [...code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    if (declared.length > 0 && declared.every((nm) => headlessDeclaresBinding(nm))) continue;
    for (const line of code.split("\n")) extraLines.push(line);
    extraLines.push("");
  }
  endToolTenantFloor(_tenantArmed, filePath, errors);

  // F2 no-silent-leak — fail closed on any non-awaitable async (stdlib primitive or
  // async-callback combinator) emitted BARE in a composing `main`/helper. (Route
  // fns ride on the headless module, which drains them via emit-server; dedup keeps
  // an overlapping report single.)
  drainToolAsyncSyncCallbackLeaks(fns, asyncFnNames, filePath, errors);

  const extraBody = extraLines.join("\n");

  // Inline the runtime helpers the composing `main`/helpers reference that the
  // headless module does NOT already define (log/print/structural-eq); fail-closed
  // (E-TOOL-005) on any other un-inlined `_scrml_*` helper the headless lacks.
  const extraHelperHeader = buildServeExtraHelperHeader(extraBody, headlessModule, filePath, errors);

  // 3. Resolve the listen PORT (§64.7) — literal / `${expr}` (typer already fired
  //    E-TOOL-SERVE-PORT-INVALID on an invalid shape; emit a safe 0 placeholder).
  let portJs: string;
  if (serveConfig.port.kind === "literal") {
    portJs = String(serveConfig.port.value);
  } else if (serveConfig.port.kind === "expr") {
    const node = parseExprToNode(serveConfig.port.raw, filePath, 0);
    portJs = emitExprField(node as never, serveConfig.port.raw, { mode: "server" } as never);
  } else {
    portJs = "0";
  }

  // 4. Surface any E-FOREIGN-006 crossing-shadow diagnostics from the extra-fn emit.
  if (errors && foreignCrossingErrors.length > 0) for (const e of foreignCrossingErrors) errors.push(e);
  // 4b. Surface any E-SQL-006 `.prepare()` diagnostics from the extra-fn emit.
  if (errors && preparedStmtErrors.length > 0) for (const e of preparedStmtErrors) errors.push(e);

  // 5. Assemble: banner + headless module + extra helper header + extra fns +
  //    the serve-harness. The headless module leads with its own ES imports (they
  //    hoist); the extra helper header is a plain function/const block after it.
  const out: string[] = [];
  out.push("// Generated listener-owning tool — scrml compiler output (§64, Fork 1A)");
  out.push(`// Headless serve-target: \`bun <this-file>.js\` starts Bun.serve on the declared port.`);
  out.push("");
  // §64.9 bind address — resolved + validated FIRST, before any of this module's
  // own top-level statements (db handles, user consts, a composing `main`), so a
  // refused SCRML_HOST exits before any user code in this module runs. (Static
  // ES imports still evaluate first — the language cannot order code ahead of them.)
  for (const line of serveBindHelperLines()) out.push(line);
  out.push(`const _scrml_serve_host = _scrml_bind.host(process.env.${SERVE_HOST_ENV});`);
  out.push("");
  out.push(headlessModule.replace(/\n+$/, ""));
  out.push("");
  if (extraHelperHeader) { out.push(extraHelperHeader.replace(/\n+$/, "")); out.push(""); }
  if (extraBody.trim()) { out.push(extraBody.replace(/\n+$/, "")); out.push(""); }

  out.push("// --- §64.3 serve-harness (Fork 1A) — compiler-emitted Bun.serve listener ---");
  if (!hasRoutes) {
    // A serve= program with no `<endpoint>`/SSE route serves nothing but a 404 —
    // define an empty routes array so the harness references a real binding.
    out.push("const routes = [];");
  }
  if (mainFn) {
    // §64.3 compose — run the no-return setup `main` BEFORE the serve-harness holds
    // the process (a numeric-return main + serve= is E-TOOL-SERVE-MAIN-EXITS at TS).
    out.push("await main(process.argv.slice(2));");
  }
  out.push(`const _scrml_serve_port = ${portJs};`);
  out.push(`const _scrml_server = _scrml_bind.listen({`);
  out.push("  port: _scrml_serve_port,");
  // Match the web-app entry's idleTimeout (S221 — a legit >10s route must not be
  // truncated by Bun's 10s default).
  out.push("  idleTimeout: 120,");
  out.push("  async fetch(request, server) {");
  out.push("    const url = new URL(request.url);");
  out.push("    for (const _scrml_route of routes) {");
  out.push("      if ((_scrml_route.path === url.pathname || _scrml_route.path === \"/*\") && _scrml_route.method === request.method) {");
  // A WS upgrade route needs the `server` handle for `server.upgrade`; an HTTP
  // route takes only the request (the WinterCG aggregate `fetch` is single-arg).
  out.push("        return _scrml_route.isWebSocket ? _scrml_route.handler(request, server) : _scrml_route.handler(request);");
  out.push("      }");
  out.push("    }");
  out.push("    return new Response(\"Not Found\", { status: 404 });");
  out.push("  },");
  if (hasWs) out.push("  websocket: _scrml_ws_handlers,");
  out.push("}, _scrml_serve_host);");
  // Expose the server handle on globalThis: §38.6 needs it for a channel-scoped
  // `broadcast()` (`_scrml_active_server.publish(topic, msg)`, mirrors build.js),
  // and it is the in-process boot/drive/STOP seam for a harness test (the DD H6
  // conformance shape — `_scrml_active_server.stop(true)`). Unconditional: a
  // headless serve-target has no client, so exposing its own server is harmless.
  out.push("globalThis._scrml_active_server = _scrml_server;");
  // The operator-visible startup line (STDERR — stdout stays clean for machine
  // output) is printed by `_scrml_bind.listen`, naming what actually bound.
  out.push("");
  return out.join("\n");
}

/**
 * Runtime-helper header for the composing `main`/helpers of a serve-harness tool:
 * inline each TOOL_RUNTIME_HELPER the extra-fn body references that the headless
 * module does NOT already define, and fail-closed (E-TOOL-005) on any other
 * un-inlined `_scrml_*` helper the headless lacks (never a silent ReferenceError).
 */
function buildServeExtraHelperHeader(
  extraBody: string,
  headlessModule: string,
  filePath: string,
  errors?: unknown[],
): string {
  if (!extraBody.trim()) return "";
  const parts: string[] = [];
  const inlinedNames = new Set<string>();
  for (const { sig, src } of TOOL_RUNTIME_HELPERS) {
    if (extraBody.includes(sig) && !headlessModule.includes(sig)) {
      parts.push(src);
      inlinedNames.add(sig.slice(0, -1));
    }
  }
  // §14.8.10 — the tenant floor's source filter / write key, unless the headless
  // module already defines it.
  if (TENANT_HELPER_CALL_RE.test(extraBody) && !headlessModule.includes("function _scrml_tenant_scope(")) {
    parts.push(SERVER_TENANT_HELPER);
    for (const n of TENANT_HELPER_NAMES) inlinedNames.add(n);
  }
  const referenced = new Set<string>();
  const re = /\b(_scrml_[A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(extraBody)) !== null) referenced.add(m[1]);
  for (const name of referenced) {
    if (inlinedNames.has(name)) continue;
    if (headlessModule.includes(name + "(")) continue; // headless defines/uses it
    if (name.startsWith("_scrml_sql")) continue;         // db handle (headless db header)
    if (TOOL_SELF_DEFINED_HELPERS.has(name)) continue;
    if (errors) {
      errors.push(new CGError(
        "E-TOOL-005",
        `E-TOOL-005: the \`serve=\` tool's \`main\`/setup references the runtime helper ` +
        `\`${name}\`, but neither the headless serve-target module nor the v1 tool-emit ` +
        `inlines it (§64) — the emitted module would throw \`ReferenceError: ${name} is not ` +
        `defined\`. Move the logic into an \`<endpoint>\`/route (served by the headless module), ` +
        `or use a supported form.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }
  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * Shared header assembly for a standalone / in-process module (`generateToolJs`
 * and `generateToolLibraryJs`): the ES import header, the Bun.SQL db handle(s)
 * (from the file's OWN `<db src>` / `<program db=>`), and the inlined runtime
 * helpers the body references — in module-LEADING order (ES imports hoist).
 */
function assembleModuleHeaders(
  fileAST: ASTNode,
  filePath: string,
  body: string,
  errors?: unknown[],
  // §44 (S433 fix-round, F2-2) — true ONLY from `generateToolJs`, whose §64.3 harness
  // already emits a top-level `await main(...)` AND ends with `process.exit(code)`.
  // That hard exit is what kills a floating configure promise before the WAL pragma
  // lands, so the tool MAIN module awaits it; the library caller leaves it floating.
  awaitSqliteConfigure = false,
): string {
  const runtimeHeader = buildRuntimeHelperHeader(body, filePath, errors);
  const dbHeader = buildDbHandleHeader(fileAST, body, awaitSqliteConfigure, errors);
  const importHeader = buildImportHeader(fileAST);
  return (
    (importHeader ? importHeader + "\n" : "") +
    (dbHeader ? dbHeader + "\n" : "") +
    (runtimeHeader ? runtimeHeader + "\n" : "")
  );
}

/**
 * W5b (#5) — true when the module references a `_scrml_sql` handle for which NO
 * `<db src>` / `<program db=>` scope exists: the genuine no-connection case that
 * `buildDbHandleHeader` would otherwise paper over with a silent `new
 * SQL(":memory:")` fallback (empty db → silent-bad-output at runtime). The
 * in-process emit fires E-SQL-009 on this rather than shipping the `:memory:`
 * stub — the loud half of the §21.5.1 / §44.7.1 reconciliation (the general
 * typer-level gate for the browser/library paths is the tracked gap
 * `g-e-sql-009-no-db-src-not-fired`).
 */
function dbHandleMissingScope(fileAST: ASTNode, body: string): boolean {
  const used = new Set<string>();
  const re = sqlHandleRegExp(); // every handle name (sql-handle-name.ts)
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) used.add(m[0]);
  used.delete(UNRESOLVED_SQL_HANDLE); // its own internal error (buildDbHandleHeader), not a missing-scope code
  if (used.size === 0) return false;
  const scopes = collectDbScopes(fileAST as never);
  for (const id of used) if (!scopes.get(id)) return true;
  return false;
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
  asyncImportedNames?: Set<string>,
): string {
  const { fileAST, filePath } = resolveFileAST(ctxOrFileAST);
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  const stmts = collectTopLevelStatements(fileAST);
  const fns = stmts.filter(isFunctionDecl);
  // Async-coloring: fixpoint over the call graph (a fn transitively calling an
  // async fn is itself async), seeded by direct `?{}`/`_{}` bodies AND the
  // CROSS-IMPORT async names — a lib fn calling an async fn imported from ANOTHER
  // lib must await it too (mirrors generateToolJs's Flag-C seed).
  const asyncFnNames = computeAsyncFnNames(fns, sourceText, asyncImportedNames);
  // s440 — nested helpers resolved against the tool's async set (see local-async-fns.ts).
  annotateToolFns(fns, asyncFnNames, filePath, errors, fileAST);
  const foreignCrossingErrors: unknown[] = [];
  // E-SQL-006 (§44.3) — dedicated narrow .prepare() sink (mirror of foreignCrossingErrors).
  const preparedStmtErrors: unknown[] = [];

  // Exported type names (`export type X:enum`) — used to `export` the emitted
  // enum backing objects so a consumer's `import { X }` resolves.
  const exportedTypeNames = new Set<string>();
  for (const s of stmts) {
    if (s.kind === "export-decl" && s.exportKind === "type" && typeof s.exportedName === "string") {
      exportedTypeNames.add(s.exportedName as string);
    }
  }

  const bodyLines: string[] = [];
  bodyLines.push("// Generated in-process library module — scrml compiler output (§44.7.1 W5b)");
  bodyLines.push('// A db-bound library consumed IN-PROCESS (by a `kind="tool"` or a server');
  bodyLines.push("// module): its `?{}` fns run against the module's OWN <db src> connection.");
  bodyLines.push("// ES module: import { name } from './this-file.js'");
  bodyLines.push("");

  // §14 enum type declarations → frozen runtime objects. An in-process module
  // bypasses the client/server bundles that normally emit them, so emit here —
  // WITH `export` for the exported enums (a consumer imports them by name).
  const enumDefLines = emitEnumVariantObjects(fileAST);
  if (enumDefLines.length > 0) {
    for (const l of enumDefLines) {
      const nm = l.match(/^const ([A-Za-z_$][\w$]*) =/);
      bodyLines.push(nm && exportedTypeNames.has(nm[1]) ? "export " + l : l);
    }
    bodyLines.push("");
  }

  const _tenantArmed = beginToolTenantFloor(fileAST);
  for (const stmt of stmts) {
    if (isFunctionDecl(stmt)) {
      const name = (stmt.name ?? "anon") as string;
      // `main` never belongs in a library (a library is imported, not run).
      if (name === "main") continue;
      // A `<transaction>`-bearing fn with NO plain `?{}` is a STAGED shape
      // (§44.6 / SPEC-ISSUE-018) — it is not async-colored (the seed omits
      // transaction), so a server-boundary transaction `await` would land in a
      // sync fn (SyntaxError). The routing gate keeps transaction-ONLY libs off
      // this path; this guards a MIXED `?{}`+`<transaction>` lib. FAIL-CLOSED for
      // an EXPORTED such fn (never a silent drop → the importing tool would hit a
      // runtime "export not found"); a non-exported transaction helper is skipped.
      if (containsSqlOrTransaction(stmt.body) && !containsSql(stmt.body)) {
        if (stmt.fromExport === true && errors) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: the exported library function \`${name}\` contains only a ` +
            `\`<transaction>\` block (no plain \`?{}\` SQL). In-process emission of a ` +
            `transaction-bearing function is STAGED (§44.6 / SPEC-ISSUE-018) and cannot ` +
            `yet be consumed in-process by a \`kind="tool"\` — split the transaction into ` +
            `\`?{}\` statements, or remove the import of \`${name}\`.`,
            (stmt.span as { file?: string; start?: number; end?: number; line?: number; col?: number })
              ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
        continue;
      }
      bodyLines.push(emitLibraryFnMember(stmt, {
        isExported: stmt.fromExport === true,
        asyncFnNames,
        foreignCrossingErrors,
        preparedStmtErrors,
      }));
      bodyLines.push("");
      continue;
    }

    if (stmt.kind === "export-decl") {
      const kind = stmt.exportKind as string | undefined;
      const name = stmt.exportedName as string | undefined;
      // function/fn — the paired `function-decl` (fromExport) above emitted it.
      if (kind === "function" || kind === "fn") continue;
      // type — no runtime value (the enum object, if any, is emitted above).
      if (kind === "type") continue;
      // value const/let — parse the initializer + lower it (client boundary,
      // synchronous). A markup-valued const is a component (mount-time), skip.
      if (kind === "const" || kind === "let") {
        if (!name) continue;
        const raw = String(stmt.raw ?? "");
        // Tolerate an optional `: <type>` annotation between NAME and `=`
        // (`export const MAX: number = 3`) — a valid, idiomatic shape. The type is
        // between NAME and `=` so it is naturally stripped (m[1] is the init only),
        // exactly as the client/page lowering strips it.
        const m = raw.match(/^\s*export\s+(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::\s*[^=]+?)?\s*=\s*([\s\S]+)$/);
        if (!m) {
          // A `?{}`-init export const (`export const total = ?{...}.get().c`) is
          // SPLIT by the parser — the export-decl `raw` ends at `=` and the SQL
          // becomes a separate node whose trailing `.get().c` accessor does NOT
          // survive lowering. It cannot emit cleanly as a plain in-process const →
          // FAIL-CLOSED (never a silent drop). Steer to a server fn. Any OTHER
          // non-matching shape falls to the pre-existing silent skip: with the
          // `: <type>` tolerance above there is no known valid-but-unemittable
          // shape, and a destructured `export const { … }` never reaches here (the
          // parser leaves its exportedName null → filtered at `if (!name)` above),
          // so a hard error here would only risk regressing an unforeseen valid one.
          const emptyInit = /^\s*export\s+(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::\s*[^=]+?)?\s*=\s*$/.test(raw);
          if (emptyInit && errors) {
            errors.push(new CGError(
              "E-CG-006",
              `E-CG-006: the exported binding \`${name}\` is initialized by a top-level \`?{}\` SQL ` +
              `read, which cannot be emitted as a plain in-process library const (§44.7.1 W5b — the ` +
              `parser splits the initializer and its \`.get()\`/\`.all()\` accessor is lost). Hoist the ` +
              `query into an exported server function — \`export function ${name}() { return ?{...} }\` ` +
              `— and call it, instead of \`export const ${name} = ?{...}\`.`,
              (stmt.span as { file?: string; start?: number; end?: number; line?: number; col?: number })
                ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ));
          }
          continue;
        }
        const init = m[1].trim();
        // A markup-valued const is a COMPONENT (mount-time), not a runtime value.
        if (!init || init.startsWith("<")) continue;
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
  // Drain any E-SQL-006 `.prepare()` diagnostics the SQL lowering collected.
  if (errors && preparedStmtErrors.length > 0) {
    for (const e of preparedStmtErrors) errors.push(e);
  }

  endToolTenantFloor(_tenantArmed, filePath, errors);
  const body = bodyLines.join("\n");

  // A db-context lib routed here whose `?{}` has NO `<db src>` would fall back to
  // `new SQL(":memory:")` (empty db, silent-bad-output). Fire E-SQL-009 in the
  // emit path so it fails LOUD rather than shipping the stub (the general
  // typer-level gate is tracked as `g-e-sql-009-no-db-src-not-fired`).
  if (dbHandleMissingScope(fileAST, body) && errors) {
    errors.push(new CGError(
      "E-SQL-009",
      "E-SQL-009: a `?{}` SQL block in an in-process library file resolves against no database " +
      "connection — the file declares no top-level `<db src=\"...\">` block (a module-with-db-context, " +
      "§44.7.1) and no `<program db=>` ancestor applies. Add a `<db src=\"...\">` block to the library, " +
      "or move the `?{}` server function to a file that has one.",
      { file: filePath, start: 0, end: 0, line: 1, col: 1 },
    ));
  }

  // Headers must LEAD the module (ES imports hoist): ES imports, the Bun.SQL db
  // handle (the module's OWN <db src>, §44.7.1), and inlined runtime helpers the
  // in-process fn bodies reference — assembled shared with generateToolJs.
  return assembleModuleHeaders(fileAST, filePath, body, errors) + body + "\n";
}
