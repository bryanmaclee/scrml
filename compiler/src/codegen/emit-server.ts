import { CGError } from "./errors.ts";
import { genVar, getVarCounter, setVarCounter } from "./var-counter.ts";
import { routePath, paramSignature, paramName } from "./utils.ts";
import { collectFunctions, collectServerVarDecls, callableServerVarDecls, collectServerAuthorityTypes, serverVarDeclLoadKind, isServerOnlyNode } from "./collect.ts";
import { emitLogicNode, emitFnShortcutBody } from "./emit-logic.ts";
import { getNodes } from "./collect.ts";
import { collectChannelNodes, emitChannelServerJs, emitChannelWsHandlers, collectChannelFunctionMap, collectChannelCellMap, filterChannelImportSpecifiers } from "./emit-channel.ts";
import { serverRewriteEmitted, setVariantFieldsForRewriter, setProtectContextForRewriter, drainProtectInfosFromRewriter } from "./rewrite.js";
import { buildVariantFieldsRegistry, emitEnumVariantObjects, emitEnumLookupTables } from "./emit-client.js";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import type { CompileContext } from "./context.ts";
import { emitServerParamCheck, parsePredicateAnnotation } from "./emit-predicates.ts";
import { resolveDbDriver } from "./db-driver.ts";
import { returnTypeAllowsAbsence, SERVER_WIRE_ENCODER_HELPER } from "./wire-format.ts";
import { SERVER_LOG_HELPER } from "./log-loc.ts";
import { dirname as _pathDirname, resolve as _pathResolve, relative as _pathRelative } from "node:path";
import { parseExprToNode } from "../expression-parser.ts";
import { extractCalleeNames } from "./scheduling.ts";
import { emitParseVariantDecodeIIFE, type ParseVariantEnumLike } from "./emit-parse-variant.ts";
import { isSingleJsExpression } from "./validate-emit.ts";
// §14.8.9 — protected-column egress redaction (server→client confidentiality).
import { buildProtectContext, resolveProtectedOutputColumns, detectProtectedRawEgress, SERVER_PROTECT_HELPER, type ProtectContext } from "./protect-egress.ts";

// g-pure-module-server-emit (S207): sentinel line marking where deferred
// local-`.scrml` server imports are re-injected after usage-pruning. Pruned by
// pruneUnusedLocalServerImports() against the assembled body. Distinctive +
// comment-prefixed so it never collides with emitted JS and is a no-op if the
// prune pass is somehow skipped (it is a bare comment line).
const LOCAL_SERVER_IMPORT_SENTINEL = "// __SCRML_LOCAL_SERVER_IMPORTS__";

// GITI-012 / fix-server-eq-helper-import: structural-equality helper source.
// SPEC §45 emits `_scrml_structural_eq(a, b)` for any `==`/`!=` whose operands
// aren't statically primitive (see emit-expr.ts). The helper lives in the
// client runtime; .server.js never imports it. If any callsite survived the
// primitive shortcut, this is inlined at the top of the server module so the
// reference resolves at runtime. Extracted to a module constant so BOTH the
// route-handler path (generateServerJs) and the value-only path
// (generateValueOnlyServerJs, g-const-only-module-no-server-emit) inline the
// IDENTICAL helper — no drift.
const SERVER_STRUCTURAL_EQ_HELPER = [
  "",
  "// --- §45 Structural equality helper (inlined for server, no client runtime here) ---",
  "function _scrml_structural_eq(a, b) {",
  "  if (a === b) return true;",
  "  if (a === null || b === null || a === undefined || b === undefined) return false;",
  "  if (typeof a !== typeof b) return false;",
  "  if (typeof a !== \"object\") return a === b;",
  "  if (Array.isArray(a)) {",
  "    if (!Array.isArray(b) || a.length !== b.length) return false;",
  "    for (let i = 0; i < a.length; i++) {",
  "      if (!_scrml_structural_eq(a[i], b[i])) return false;",
  "    }",
  "    return true;",
  "  }",
  // Enum-variant check: `_tag` is a discriminator string set by the
  // emitter. `!= null` (loose) covers both null + undefined absence,
  // avoiding the bare `undefined` keyword (W-CG-UNDEFINED-INTERPOLATION).
  "  if (a._tag != null && b._tag != null) {",
  "    if (a._tag !== b._tag) return false;",
  "    const aKeys = Object.keys(a);",
  "    const bKeys = Object.keys(b);",
  "    if (aKeys.length !== bKeys.length) return false;",
  "    for (const key of aKeys) {",
  "      if (key === \"_tag\") continue;",
  "      if (!_scrml_structural_eq(a[key], b[key])) return false;",
  "    }",
  "    return true;",
  "  }",
  "  const aKeys = Object.keys(a);",
  "  const bKeys = Object.keys(b);",
  "  if (aKeys.length !== bKeys.length) return false;",
  "  for (const key of aKeys) {",
  "    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;",
  "    if (!_scrml_structural_eq(a[key], b[key])) return false;",
  "  }",
  "  return true;",
  "}",
  "",
].join("\n");

// Inject `helper` after the file header + imports block (the first blank-line
// boundary) so a hoisted helper sits above every reference. Shared by the
// post-emit helper-inline scans (structural-eq / wire / log). Mirrors the
// in-place `headerEndIdx` logic the route-handler path uses.
function injectAfterHeader(emitted: string, helper: string): string {
  const headerEndIdx = emitted.indexOf("\n\n");
  if (headerEndIdx === -1) return helper + emitted;
  return emitted.slice(0, headerEndIdx) + helper + emitted.slice(headerEndIdx);
}

// g-pure-module-server-emit (S207): conservative identifier-reference check.
// Returns true if `name` appears in `body` as a standalone identifier token
// (word-boundary, not a substring of a longer identifier). Used to decide
// whether a deferred local-`.scrml` server-import specifier is actually
// referenced in the emitted server body. Soundness > minimality: a false
// "used" keeps a harmless import; a false "unused" would drop a needed one,
// so the check errs toward keeping (any standalone occurrence counts).
function localServerImportNameUsed(body: string, name: string): boolean {
  if (!name) return false;
  // \b is unreliable for `$`-prefixed names but scrml import locals are plain
  // identifiers; guard the boundaries manually to avoid matching `name` inside
  // `otherName` / `name2` / `_name`.
  const re = new RegExp("(^|[^A-Za-z0-9_$])" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9_$]|$)");
  return re.test(body);
}

// Bug-51 collision guard (E-CG-016, §47): is `name` ALREADY declared at the
// TOP LEVEL of the assembled server body? Used before injecting a
// compiler-generated `const <Enum> = Object.freeze(...)` enum object to detect
// a clash with an existing top-level binding — most notably the
// compiler-injected `import { SQL } from "bun"` runtime handle, when an author
// names a page-local enum `SQL` (or any name that collides with another
// top-level decl). Without this check the bundle would carry two declarations
// of the same identifier and fail the emit-validation gate with a cryptic
// `Identifier '<X>' has already been declared` SyntaxError on otherwise-valid
// scrml. The scan is line-oriented over top-level decl/import forms:
//   const/let/var <name>      function/function* <name>      class <name>
//   import { ... <name> ... } / import { ... <name> as <x> }  (named specifier)
//   import <name> from ...     (default)
//   import * as <name> from ...(namespace)
// It is intentionally conservative — a top-level decl is one that begins a line
// (modulo leading whitespace); nested/block-scoped decls do not collide with a
// module-scope `const`, so a line-anchored scan is the correct altitude.
function topLevelBindingExists(body: string, name: string): boolean {
  if (!name) return false;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // const/let/var/(async )function/function*/class <name> at start-of-line.
  // NOTE: the `async ` alternative is REQUIRED — Issue #1's in-process peer
  // callables are emitted as `async function <name>`, and without it this guard
  // is blind to them (an adopter naming a server fn `routes`/`fetch`/an enum
  // name would get a cryptic "compiler defect" SyntaxError instead of E-CG-016).
  const declRe = new RegExp(
    "^\\s*(?:export\\s+)?(?:const|let|var|(?:async\\s+)?function\\*?|class)\\s+" + n + "\\b",
    "m",
  );
  if (declRe.test(body)) return true;
  // import <name> from ...  /  import * as <name> from ...
  const importDefaultRe = new RegExp(
    "^\\s*import\\s+(?:\\*\\s+as\\s+)?" + n + "\\b",
    "m",
  );
  if (importDefaultRe.test(body)) return true;
  // import { ... <name> ... } / import { ... x as <name> ... } — the LOCAL
  // binding is `<name>` either standalone or after `as`. Scan each import line
  // with a `{ ... }` clause for a named-specifier local matching `<name>`.
  const namedImportLineRe = /^\s*import\s*\{([^}]*)\}\s*from\b/gm;
  let m: RegExpExecArray | null;
  while ((m = namedImportLineRe.exec(body)) !== null) {
    const specs = m[1].split(",");
    for (const raw of specs) {
      const spec = raw.trim();
      if (spec.length === 0) continue;
      // local name is the part after `as`, else the whole specifier.
      const asIdx = spec.search(/\bas\b/);
      const local = (asIdx === -1 ? spec : spec.slice(asIdx + 2)).trim();
      if (local === name) return true;
    }
  }
  return false;
}

/**
 * S79 audit fix C.1 — parse `<program idempotency-ttl="...">` raw value into
 * a millisecond integer, or `null` for fall-back-to-default-24h.
 *
 * Accepted shapes:
 *   - bare integer ("3600000")  → that many millis
 *   - duration string with unit suffix:
 *       "Nms" / "Ns" / "Nm" / "Nh" / "Nd"
 *     where N is a non-negative decimal integer (no float, no leading sign).
 *   - whitespace + quoting tolerated by the caller's getMWAttr (already
 *     stripped). This helper trims defensively.
 *
 * Returns the resolved millisecond value, OR `null` when the value is null/
 * empty/malformed (caller falls back to 24h default). Silent fallback
 * matches the audit's documented v1 scope; future v2 may add a
 * W-MIDDLEWARE-TTL-INVALID lint.
 *
 * Distinct from `parseAfterDuration` (engine-side `<onTimeout after=>`),
 * which uses a different unit set (no `d`) and handles a `${expr}<unit>`
 * computed form. idempotency-ttl is a plain attribute — no computed-form.
 */
function parseIdempotencyTtl(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Bare integer (millis).
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Duration with unit suffix.
  const m = trimmed.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const mult = multipliers[unit];
  return mult !== undefined ? n * mult : null;
}

/**
 * S81 audit fix F.1 — parse `<program cors-max-age="...">` raw value into a
 * positive integer (seconds), or `null` for fall-back-to-default-86400.
 *
 * Accepted shape:
 *   - bare integer ("3600", "600", "604800") interpreted as seconds.
 *
 * Distinct from parseIdempotencyTtl (which accepts duration-string suffixes)
 * because Access-Control-Max-Age is conventionally expressed in seconds in
 * HTTP/spec docs and adopters reading MDN will copy the seconds value
 * directly. A future amendment may add the `"Nh"` / `"Nm"` suffix grammar if
 * adopter feedback shows the bare-seconds form to be a footgun.
 *
 * Returns null when raw is null/empty/non-integer/zero/negative — caller
 * falls back to the 86400 default with no diagnostic (silent fallback per
 * §39.2.1 amendment v1 scope).
 */
function parseCorsMaxAge(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ext 1 M1.4 — per-batch idempotency-key gating.
 *
 * Returns true iff the CPS stub for this route must emit the Ext 5
 * idempotency-key dedup middleware (SPEC §19.9.6). The gate is per-batch: the
 * monotonicity classifier (M1.4) writes an independent verdict onto each
 * `CPSBatch.monotonicity`. While the function still emits ONE server stub
 * (M1.5 splits it into N stubs, one per batch), that single stub serves every
 * batch's work — so it needs the dedup layer iff ANY batch is non-monotone.
 *
 * This is observationally identical to the pre-M1.4 function-level gate
 * (`cpsSplit.monotonicity === "non-monotone"`) for single-batch functions —
 * `classifyFunctionMonotonicity`'s conservative-max aggregate is exactly this
 * `some()` over batches. The change makes the per-batch verdict the
 * load-bearing surface in codegen, so M1.5's multi-stub emit can gate each
 * stub on its own `batch.monotonicity` with no further analyzer work.
 *
 * Falls back to the function-level verdict when batches carry no per-batch
 * verdict (Stage 5.5 not run, or a non-CPS path) — defensive; in the normal
 * pipeline analyzeMonotonicity always populates `batch.monotonicity`.
 */
function cpsNeedsIdempotencyDedup(
  cpsSplit: { monotonicity?: string; serverBatches?: Array<{ monotonicity?: string }> } | null | undefined,
): boolean {
  if (!cpsSplit) return false;
  const batches = cpsSplit.serverBatches;
  if (Array.isArray(batches) && batches.length > 0) {
    // Per-batch surface (M1.4). The single emitted stub needs dedup iff any
    // batch is non-monotone.
    if (batches.some((b) => b.monotonicity === "non-monotone")) return true;
    // Every batch carries a verdict and none is non-monotone → no dedup.
    if (batches.every((b) => b.monotonicity !== undefined)) return false;
  }
  // Defensive fallback — Stage 5.5 has not populated per-batch verdicts.
  return cpsSplit.monotonicity === "non-monotone";
}

/**
 * Ext 1 M1.5 — per-batch monotonicity verdict lookup.
 *
 * Returns the monotonicity verdict of batch `batchIndex` (M1.4 — the verdict
 * the classifier wrote onto `CPSBatch.monotonicity`). Used by the multi-stub
 * emit to gate EACH batch's Ext 5 idempotency-key dedup middleware on its OWN
 * verdict: in a function with one monotone + one non-monotone batch, only the
 * non-monotone stub pays the dedup tax.
 *
 * Falls back to the function-level verdict when the indexed batch carries no
 * per-batch verdict (Stage 5.5 not run) — defensive; in the normal pipeline
 * analyzeMonotonicity always populates `batch.monotonicity`.
 */
function cpsBatchMonotonicity(
  cpsSplit: { monotonicity?: string; serverBatches?: Array<{ monotonicity?: string }> } | null | undefined,
  batchIndex: number,
): string | undefined {
  if (!cpsSplit) return undefined;
  const batches = cpsSplit.serverBatches;
  if (Array.isArray(batches) && batchIndex >= 0 && batchIndex < batches.length) {
    const v = batches[batchIndex].monotonicity;
    if (v !== undefined) return v;
  }
  return cpsSplit.monotonicity;
}

/**
 * Ext 1 M1.5 — does THIS batch's stub need the Ext 5 idempotency-key dedup
 * middleware? True iff the batch's own monotonicity verdict is "non-monotone".
 * Monotone / machine-intrinsic batches skip the dedup layer entirely.
 */
function batchNeedsIdempotencyDedup(monotonicity: string | undefined): boolean {
  return monotonicity === "non-monotone";
}

/**
 * Bug 3a (S87 follow-on, 2026-05-12) — DB scope collector for `_scrml_sql`
 * declaration emission.
 *
 * Walks the file AST to enumerate every DB scope visible from server code.
 * Two source shapes are recognized:
 *
 *   1. `<program db="path">` — the per-program form (SPEC §40.2 + §44.2).
 *      Index.ts annotates these with `_dbScope = { dbVar, connectionString,
 *      driver }` at the codegen entry; we read that annotation directly.
 *      Scoped variable name: `_scrml_sql_<n>` (n = 1, 2, ...).
 *
 *   2. `<db src="path">` — the state-block markup form (SPEC §44.7.1).
 *      AST shape: `{ kind: "state", stateType: "db", attrs: [...] }`.
 *      Index.ts does NOT annotate these (they're state nodes, not markup
 *      `<program>`); we resolve the driver here and use the unscoped
 *      default name `_scrml_sql` (matches `context.ts:99` +
 *      `rewrite.ts:251` defaults).
 *
 * Both forms produce `{ dbVar, connectionString, driver }` records so the
 * downstream emit code can declare them uniformly:
 *
 *   import { SQL } from "bun";
 *   const _scrml_sql = new SQL(<connStr>);          // <db src=> form
 *   const _scrml_sql_1 = new SQL(<connStr1>);       // <program db=> form
 *
 * Bun.SQL accepts SQLite paths, `:memory:`, `postgres://...`,
 * `postgresql://...`, and `mysql://...` directly — driver dispatch happens
 * inside Bun. We only need to thread the literal connection string.
 *
 * Returns a `Map<dbVar, { connectionString, driver }>` so duplicate `<db>`
 * blocks (rare but legal in pure-fn modules) collapse into one declaration.
 *
 * Cross-references:
 *   - `compiler/src/codegen/index.ts:337-388` — `_dbScope` annotation site
 *   - `compiler/src/codegen/db-driver.ts` — driver classification
 *   - SPEC §44.2 (driver resolution), §40.2 (program db= attr)
 *   - `docs/changes/v0.3-bug-3a-sql-emission/progress.md` — dispatch notes
 */
export function collectDbScopes(
  fileAST: any,
): Map<string, { connectionString: string; driver: "sqlite" | "postgres" | "mysql" }> {
  const scopes = new Map<string, { connectionString: string; driver: "sqlite" | "postgres" | "mysql" }>();
  const nodes: any[] = getNodes(fileAST);

  function walk(children: any[]): void {
    if (!Array.isArray(children)) return;
    for (const node of children) {
      if (!node || typeof node !== "object") continue;

      // Form 1: `<program db=>` with `_dbScope` annotation from index.ts.
      if (node.kind === "markup" && node.tag === "program" && (node as any)._dbScope) {
        const ds = (node as any)._dbScope;
        if (typeof ds.dbVar === "string" && typeof ds.connectionString === "string") {
          scopes.set(ds.dbVar, {
            connectionString: ds.connectionString,
            driver: ds.driver ?? "sqlite",
          });
        }
      }

      // Form 2: `<db src=>` state-block. AST: { kind:"state", stateType:"db", attrs:[...] }.
      if (node.kind === "state" && node.stateType === "db") {
        const attrs: any[] = node.attrs ?? node.attributes ?? [];
        const srcAttr = attrs.find((a: any) => a && a.name === "src");
        const srcVal: string =
          srcAttr?.value?.kind === "string-literal"
            ? srcAttr.value.value
            : srcAttr?.value?.value ?? srcAttr?.value?.name ?? "";
        if (typeof srcVal === "string" && srcVal.length > 0) {
          const driverResult = resolveDbDriver(srcVal);
          const driver: "sqlite" | "postgres" | "mysql" = driverResult.ok
            ? driverResult.info.driver
            : "sqlite";
          // The default unscoped identifier matches `context.ts:99` and
          // `rewrite.ts:251` defaults — i.e. what the rewriter already
          // emitted into the body.
          if (!scopes.has("_scrml_sql")) {
            scopes.set("_scrml_sql", { connectionString: srcVal, driver });
          }
        }
      }

      // Recurse into markup children + state children.
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);

  // Fallback aliasing: if the unscoped `_scrml_sql` identifier is referenced
  // in the body but no `<db src=>` block contributed it, alias it to the
  // first `<program db=>` scope (the upstream index.ts annotation tags
  // descendants with the scoped name, but emit-server.ts does not currently
  // thread that scoped name into per-handler emit-logic opts — so SQL bodies
  // continue to use the default `_scrml_sql` identifier even when only
  // `<program db=>` is in scope). Without this aliasing the default
  // identifier would fall through to the :memory: WARNING fallback even
  // though a valid program-scoped connection string is available.
  if (!scopes.has("_scrml_sql")) {
    for (const [dbVar, info] of scopes) {
      if (dbVar.startsWith("_scrml_sql_")) {
        scopes.set("_scrml_sql", info);
        break;
      }
    }
  }
  return scopes;
}

/**
 * §12.6 (Library-mode emission) discriminator.
 *
 * Returns true iff a server-boundary function was escalated PURELY by body
 * content and therefore SHALL NOT emit a §12.3 HTTP-handler wrapper in
 * `--mode library`:
 *
 *   1. It has at least one escalation reason and EVERY reason is
 *      `kind:"server-only-resource"` (§12.2 Triggers 1/3 — a server-only
 *      import or `?{}` SQL). An `explicit-annotation` reason (explicit
 *      `server`) or a `protected-field-access` reason makes this false → the
 *      wrapper is retained.
 *   2. It carries NO explicit `route=` / `method=` (explicitRoute /
 *      explicitMethod are null) — an explicit route is an explicit endpoint
 *      declaration and retains the wrapper.
 *   3. SCOPE GUARD: the function body contains no TOP-LEVEL server-only node
 *      (inline `?{}` / transaction-block / server-context meta — the
 *      `isServerOnlyNode` set). Such a body does NOT emit cleanly as a plain
 *      library export today (separate staged lifecycle — W5a/W5b / E-CG-006),
 *      so suppressing its wrapper would strand it with neither a working
 *      export nor an endpoint. We leave those cases unchanged (out of scope).
 *
 * The import-escalated shape (a plain `export function` importing e.g.
 * `scrml:fs`) satisfies all three and is suppressed; it already emits a clean
 * `export function` in the library `.js`.
 */
function isBodyOnlyEscalation(route: any, fnNode: any): boolean {
  const reasons: Array<{ kind?: string }> = Array.isArray(route?.escalationReasons)
    ? route.escalationReasons
    : [];
  if (reasons.length === 0) return false;
  if (!reasons.every((r) => r && r.kind === "server-only-resource")) return false;
  if (route?.explicitRoute != null || route?.explicitMethod != null) return false;

  // Scope guard: no top-level server-only node in the function body.
  const body: any[] = Array.isArray(fnNode?.body) ? fnNode.body : [];
  if (body.some((stmt) => isServerOnlyNode(stmt))) return false;

  return true;
}

/**
 * ss1 (g-route-mis-inference-server-called-pure-helper) — emit a module's
 * exported VALUE bindings (constants + pure functions) as native ESM exports
 * in its `.server.js`.
 *
 * BACKGROUND. A `.server.js` emits route handlers (`__ri_route_*` + `routes` +
 * `fetch`) but, in default (browser) mode, has NO value-export emission path —
 * only `--mode library` emits plain bindings. So a sibling SERVER bundle that
 * imports a module's exported constant or pure function by-name
 * (`import { rolePath, SESSION_TTL_SECONDS } from "./models/auth.server.js"`)
 * link-errors at RUNTIME: `SyntaxError: Export named 'rolePath' not found`
 * (a missing ESM export is a link error, not a syntax error — green compile,
 * `node --check` passes). This is the SERVER analog of the CLIENT's cross-file
 * module registry footer (emit-client.ts `buildModuleRegistryFooter`); the
 * server uses native ESM, so we emit standard `export` declarations rather than
 * a `_scrml_modules` registry.
 *
 * WHAT IS EMITTED.
 *   - `export const NAME = <lowered-init>;`  for each `export const` VALUE decl.
 *   - `export function NAME(...) { <lowered-body> }`  for each exported pure
 *     `function`/`fn`, INCLUDING a route-classified one (e.g. `rolePath`): the
 *     plain `export function` is ADDITIVE — the route handler `_scrml_handler_*`
 *     + `export const __ri_route_*` + `routes` + `fetch` all STAY (no collision:
 *     the handler/route carry `_scrml_*` / `__ri_route_*` prefixes).
 *
 * WHAT IS NOT EMITTED (correctness).
 *   - TYPE exports (`export type`) + type re-exports (`export { T } from ...`) —
 *     types have no runtime export; emitting them reintroduces the link error
 *     that the sibling Fix A (S208) guarded against.
 *   - COMPONENT consts (`export const Card = <markup/>`) — a markup-valued const
 *     is a component resolved at markup-mount time, NOT a runtime JS value (same
 *     class the client's `buildModuleRegistryFooter` `declaredBinding` probe
 *     filters out). Detected by a leading `<` in the initializer.
 *   - Channels / re-export / rename / local — no runtime VALUE export here.
 *   - Any binding ALREADY declared in the assembled body (no double-decl).
 *
 * The function bodies are lowered with `boundary: "client"` ON PURPOSE: an
 * exported pure helper is environment-agnostic, and client lowering produces a
 * SYNCHRONOUS body. Server (`boundary:"server"`) lowering wraps a `match` in
 * `await (async function(){...})()` (it assumes the enclosing async route
 * handler), which would make a plain `export function` non-async-but-`await`ing
 * (a SyntaxError) AND silently turn a synchronous `match`-helper into a
 * Promise-returning one — breaking synchronous callers (`if (!isValidHosTransition(a,b))`).
 * `==` still lowers to `_scrml_structural_eq` and `not` to `null` identically in
 * both modes; pure helpers touch no reactive cells, so no `_scrml_reactive_get`
 * is emitted. Const initializers are parsed (`parseExprToNode`) and lowered
 * (`emitExprField`, server mode — string/number literals, no cell refs).
 *
 * Returns the emitted lines as an array (empty when nothing to emit). The caller
 * appends them to `lines` BEFORE the helper-inline scans (structural-eq / wire /
 * log / SQL) so a `_scrml_structural_eq(` introduced ONLY by an exported helper
 * still triggers the helper's top-of-file inlining.
 */
function emitModuleValueExportLines(
  fileAST: any,
  filePath: string,
  assembledBody: string,
): string[] {
  // Collect logic blocks (the `${ ... }` bodies). Mirrors emit-library's
  // collectLogicBlocks — exported value decls live in the file's logic body.
  const logicBlocks: any[] = [];
  const collectLogic = (nodeList: any[]): void => {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) logicBlocks.push(node);
      if (Array.isArray(node.children)) collectLogic(node.children);
    }
  };
  collectLogic(getNodes(fileAST));
  if (logicBlocks.length === 0) return [];

  // Already-declared guard: skip a binding whose name is already declared at
  // top level in the assembled body (avoids double-decl).
  const isAlreadyDeclared = (name: string): boolean => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var)\\s+${esc}\\b`,
      "m",
    );
    return re.test(assembledBody);
  };

  // Index the synthetic `function-decl` nodes (the EXPORT branch produces one
  // per exported function, carrying full params + body) by name. `emitLogicNode`
  // skips `fromExport` nodes, so we emit them here via `emitFnShortcutBody`.
  const fnDeclByName = new Map<string, any>();
  for (const logic of logicBlocks) {
    for (const stmt of (logic.body ?? [])) {
      if (stmt && stmt.kind === "function-decl" && stmt.fromExport === true && stmt.name) {
        fnDeclByName.set(stmt.name, stmt);
      }
    }
  }

  // Recursive server-only-body check. An exported function whose body contains
  // a `?{}` SQL / transaction / server-context-meta node ANYWHERE (top level or
  // nested in a loop / branch / match arm) is NOT an environment-agnostic pure
  // helper — it is a server OPERATION (e.g. a `runSeeds()` DB seeder). Emitting
  // it as a synchronous value export would (a) produce `await` outside an async
  // function and (b) lower its `?{}` to the client-cannot-evaluate `const x =
  // null` stub. Skip such functions entirely (their server route handler, if
  // any, is emitted above by the route path).
  const bodyHasServerOnlyNode = (nodes: any[]): boolean => {
    if (!Array.isArray(nodes)) return false;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (isServerOnlyNode(n)) return true;
      if (bodyHasServerOnlyNode(n.body)) return true;
      if (bodyHasServerOnlyNode(n.consequent)) return true;
      if (Array.isArray(n.alternate) ? bodyHasServerOnlyNode(n.alternate) : (n.alternate && bodyHasServerOnlyNode([n.alternate]))) return true;
      if (bodyHasServerOnlyNode(n.arms)) return true;
      if (bodyHasServerOnlyNode(n.cases)) return true;
      if (bodyHasServerOnlyNode(n.children)) return true;
    }
    return false;
  };

  const constLines: string[] = [];
  const fnBlocks: string[] = [];

  for (const logic of logicBlocks) {
    for (const stmt of (logic.body ?? [])) {
      if (!stmt || stmt.kind !== "export-decl") continue;
      const kind: string = stmt.exportKind;
      const name: string = stmt.exportedName;
      if (!name) continue;

      // Value constant. The export-decl carries no paired const-decl / initExpr,
      // only `raw` (tokenized source). Split off the initializer and lower it.
      if (kind === "const") {
        if (isAlreadyDeclared(name)) continue;
        const raw: string = String(stmt.raw ?? "");
        const m = raw.match(/^\s*export\s+const\s+\w+\s*=\s*([\s\S]+)$/);
        if (!m) continue;
        const init = m[1].trim();
        if (!init) continue;
        // A markup-valued const is a COMPONENT (resolved at markup-mount time),
        // not a runtime JS value — skip it. No scrml VALUE expression begins
        // with `<` (comparison operators are binary, never leading).
        if (init.startsWith("<")) continue;
        // A `?{}`-initialized const is a server-only SQL read, not a pure value.
        if (init.includes("?{")) continue;
        const initNode = parseExprToNode(init, filePath, 0);
        const lowered = emitExprField(initNode, init, { mode: "server" });
        constLines.push(`export const ${name} = ${lowered};`);
        continue;
      }

      // Exported pure function. Emit a plain `export function` ADDITIVELY.
      if (kind === "function" || kind === "fn") {
        if (isAlreadyDeclared(name)) continue;
        const fnNode = fnDeclByName.get(name);
        if (!fnNode || !Array.isArray(fnNode.body)) continue;
        // Skip a server-OPERATION function (its body does `?{}` SQL / a
        // transaction / server-context meta) — not a pure value export.
        if (bodyHasServerOnlyNode(fnNode.body)) continue;
        const params: any[] = fnNode.params ?? [];
        const paramSigs = params.map((p, i) => paramSignature(p, i));
        const generatorStar: string = fnNode.isGenerator ? "*" : "";
        const asyncPrefix: string = fnNode.isAsync ? "async " : "";
        const declaredNames = new Set<string>(
          params.map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean),
        );
        // Client-boundary lowering → synchronous body (see fn-doc rationale).
        const bodyCodes = emitFnShortcutBody(
          fnNode.body,
          { boundary: "client", declaredNames, insideFunctionBody: true },
          fnNode.fnKind,
          fnNode.hasReturnType,
        );
        const out: string[] = [];
        out.push(`export ${asyncPrefix}function${generatorStar} ${name}(${paramSigs.join(", ")}) {`);
        for (const code of bodyCodes) {
          for (const line of code.split("\n")) out.push(`  ${line}`);
        }
        out.push(`}`);
        fnBlocks.push(out.join("\n"));
        continue;
      }

      // All other export kinds (type / re-export / re-export-all / rename /
      // local / channel) have NO runtime VALUE export here — skip.
    }
  }

  if (constLines.length === 0 && fnBlocks.length === 0) return [];

  const out: string[] = [];
  out.push("");
  out.push("// --- ss1: module value exports (constants + pure fns) for cross-file server imports ---");
  // Consts first (dependency order / readability — a referencing fn reads them
  // at call time, but emitting consts first keeps the file readable).
  for (const l of constLines) out.push(l);
  if (constLines.length > 0 && fnBlocks.length > 0) out.push("");
  for (let i = 0; i < fnBlocks.length; i++) {
    out.push(fnBlocks[i]);
    if (i < fnBlocks.length - 1) out.push("");
  }
  out.push("");
  return out;
}

/**
 * §61 `<endpoint>` private-arm reachability — emit a LOCAL, non-exported pure
 * `fn` referenced (directly or transitively) from an `<endpoint>` arm body
 * (§61.2 — the canonical `<FleetStatus : fleetStatus()>` form) as a plain
 * SERVER-side `function NAME(...) { <body> }`. Without this the fn tree-shakes
 * out of the `.server.js` and the endpoint handler's `await fleetStatus()`
 * (§61.5) references an undefined symbol at runtime.
 *
 * The fnNodeIds come from `RouteMap.endpointServerHelperIds` (route-inference's
 * server-reachability closure). The matching `.client.js` SKIP is
 * `RouteMap.endpointClientSkipIds` (emit-functions, §61.6) — a server-ONLY
 * helper never leaks to the client bundle.
 *
 * Bodies are lowered with `boundary:"client"` — a SYNCHRONOUS pure body,
 * identical to `emitModuleValueExportLines`' rationale (a `boundary:"server"`
 * `match`-helper wraps in `await (async function(){...})()`, which makes a plain
 * `function` non-async-but-`await`ing — a SyntaxError — and silently turns a
 * synchronous helper into a Promise-returning one). The handler `await`s the
 * return value, and `await` of a non-Promise is a no-op, so sync emit is correct.
 */
function emitEndpointServerHelperLines(
  fnNodes: any[],
  filePath: string,
  helperIds: Set<string>,
  assembledBody: string,
): string[] {
  if (!helperIds || helperIds.size === 0) return [];
  // Already-declared guard (mirrors emitModuleValueExportLines) — a helper that
  // is ALSO an exported value fn was already emitted by the value-export path.
  const isAlreadyDeclared = (name: string): boolean => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var)\\s+${esc}\\b`,
      "m",
    );
    return re.test(assembledBody);
  };
  const blocks: string[] = [];
  for (const fnNode of fnNodes) {
    const start = (fnNode?.span as any)?.start;
    if (typeof start !== "number") continue;
    if (!helperIds.has(`${filePath}::${start}`)) continue;
    const name: string = fnNode.name;
    if (!name || !Array.isArray(fnNode.body)) continue;
    if (isAlreadyDeclared(name)) continue;
    const params: any[] = fnNode.params ?? [];
    const paramSigs = params.map((p: any, i: number) => paramSignature(p, i));
    const asyncPrefix: string = fnNode.isAsync ? "async " : "";
    const declaredNames = new Set<string>(
      params.map((p: any) => (typeof p === "string" ? p : p?.name)).filter(Boolean),
    );
    // Client-boundary lowering → synchronous body (see fn-doc rationale).
    const bodyCodes = emitFnShortcutBody(
      fnNode.body,
      { boundary: "client", declaredNames, insideFunctionBody: true },
      fnNode.fnKind,
      fnNode.hasReturnType,
    );
    const out: string[] = [];
    out.push(`${asyncPrefix}function ${name}(${paramSigs.join(", ")}) {`);
    for (const code of bodyCodes) {
      for (const line of code.split("\n")) out.push(`  ${line}`);
    }
    out.push(`}`);
    blocks.push(out.join("\n"));
  }
  if (blocks.length === 0) return [];
  const out: string[] = [];
  out.push("");
  out.push("// --- §61 <endpoint> private server-side arm helpers (server-only; NOT bundled to client, §61.6) ---");
  for (let i = 0; i < blocks.length; i++) {
    out.push(blocks[i]);
    if (i < blocks.length - 1) out.push("");
  }
  out.push("");
  return out;
}

/**
 * g-const-only-module-no-server-emit (sPA ss1 item 2) — emit a MINIMAL,
 * value-only `.server.js` for a module that has NO server content (no server
 * fns / no `?{}` / no channels / no auth-middleware / etc.) but DOES export
 * runtime VALUE bindings (constants + pure functions) that a sibling SERVER
 * bundle imports by-name.
 *
 * BACKGROUND. `generateServerJs` short-circuits to `""` when a module has no
 * server content (no route handlers to emit). A const-only module therefore
 * emits no `.server.js`. But if a server-side consumer imports one of its
 * VALUE consts by-name (`import { MAX_ROWS } from './config.scrml'`), the
 * consumer's `.server.js` emits `import { MAX_ROWS } from './config.server.js'`
 * — pointing at a file that was never written → `Cannot find module` at
 * runtime (a GREEN compile; warned via W-SERVER-IMPORT-UNEMITTED MISSING-FILE).
 *
 * This is the SIBLING residual to the S208 fix: that fix made the route-handler
 * path emit a module's value exports ALONGSIDE its routes (the MISSING-EXPORT
 * branch); this fixes the case where there ARE no routes at all (the
 * MISSING-FILE branch). The orchestration layer (api.js) calls this ONLY for a
 * module that is actually server-imported-by-name (it has the cross-file
 * "who imports `./X.server.js`" knowledge), so client-only const modules are
 * NOT force-emitted (no dead `.server.js` churn).
 *
 * WHAT IS EMITTED. Reuses `emitModuleValueExportLines` — the SAME value-export
 * collector the route-handler path uses — so the correctness filters are
 * identical: VALUE consts + pure exported functions only; type exports,
 * markup-component consts, `?{}`-init consts, and server-OPERATION functions are
 * all SKIPPED. Returns `""` when the module has no emittable value export (the
 * caller then leaves the dangling import unresolved — the warning still fires,
 * which is correct: there is genuinely nothing to import).
 *
 * Helper inlining: a lowered value (a const `==` or a pure fn body) can emit
 * `_scrml_structural_eq(` / `_scrml_log(` / `_scrml_wire_encode(`. We run the
 * SAME post-emit helper-inline scans the route-handler path runs (shared helper
 * sources), so the emitted file `node --check`s clean and self-resolves with no
 * client-runtime import. A value export can never introduce `_scrml_sql`
 * (`?{}`-using consts/fns are filtered out) or idempotency calls (route-only),
 * so those two inliners are intentionally not run here.
 *
 * The var-counter is snapshotted + restored so mangled `_scrml_*_<N>` suffixes
 * in OTHER files don't shift (mirrors the route-handler call site).
 */
export function generateValueOnlyServerJs(fileAST: any): string {
  const filePath: string = fileAST.filePath;

  // Build the minimal file header (mirrors generateServerJs's first lines so
  // the `injectAfterHeader` `\n\n` boundary exists for hoisting helpers).
  const lines: string[] = [];
  lines.push("// Generated server value exports (compiler IR — not for direct consumption).");
  lines.push("// g-const-only-module-no-server-emit: this module has no server content but");
  lines.push("// exports runtime VALUE bindings a sibling server bundle imports by-name.");
  lines.push("");

  // Collect the value-export lines (consts + pure fns) via the shared collector.
  // The var-counter is snapshotted/restored so no other file's mangling shifts.
  const _veSnapshot = getVarCounter();
  const veLines = emitModuleValueExportLines(fileAST, filePath, lines.join("\n"));
  setVarCounter(_veSnapshot);
  if (veLines.length === 0) return ""; // nothing server-importable → emit nothing.
  for (const l of veLines) lines.push(l);

  let emitted = lines.join("\n");

  // Helper inlining — the SAME scans the route-handler path runs, for the
  // helpers a value export can actually introduce (structural-eq / wire / log).
  if (emitted.includes("_scrml_structural_eq(")) {
    emitted = injectAfterHeader(emitted, SERVER_STRUCTURAL_EQ_HELPER);
  }
  if (emitted.includes("_scrml_wire_encode(")) {
    emitted = injectAfterHeader(emitted, SERVER_WIRE_ENCODER_HELPER);
  }
  if (emitted.includes("_scrml_log(")) {
    emitted = injectAfterHeader(emitted, SERVER_LOG_HELPER);
  }

  return emitted;
}

// ---------------------------------------------------------------------------
// §61 — `<endpoint>` typed-inbound route-handler emission (W4,
// endpoint-primitive-2026-06-25).
//
// An `<endpoint>` emits a SERVER route-handler ONLY (§61.6 — no paired client
// fetch-stub; the foreign client has its own SDK). The compiler owns the request
// decode (§61.3 — `parseVariant` §41.13 over the body against `accepts=`), the
// exhaustive dispatch (§61.4), and the JSON response envelope (§61.5). It is
// CSRF-exempt by construction (§61.7 — a JSON+bearer endpoint carries no ambient
// cookie credential), so — unlike a §12.3 data-layer handler — it emits NO CSRF
// block and is NOT routed through the §12 CSRF gate.
// ---------------------------------------------------------------------------

/**
 * Deep-collect every `<endpoint>` (`endpoint-decl`) node. An `<endpoint>` nests
 * inside the `<program>` / `<page>` markup subtree (never a top-level node), so
 * mirror `checkEndpointDeclarations`'s deep recursion (body / children /
 * bodyChildren / branches). A shallow top-level scan misses every wrapped one.
 */
function collectEndpointDecls(nodes: any[]): any[] {
  const out: any[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (seen.has(node)) return;
    seen.add(node);
    if (node.kind === "endpoint-decl") out.push(node);
    if (Array.isArray(node.body)) walk(node.body);
    if (Array.isArray(node.children)) walk(node.children);
    if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren);
    if (Array.isArray(node.branches)) walk(node.branches);
  };
  walk(nodes);
  return out;
}

/** A single parsed arm payload binding (§18.0.1 / §51.0.B.1). */
interface EndpointArmBinding {
  discard: boolean;        // `_` — bind nothing
  field: string | null;    // named form `field: local` — the wire field name
  local: string | null;    // the per-arm local identifier
}

/**
 * Parse an arm's `payloadBindingsRaw` (the comma-joined text inside `(...)`) into
 * positional / named / discard bindings. Reuses the §18.0.1 / §51.0.B.1 binding
 * surface shapes: `prompt` (positional), `level: l` (named), `_` (discard).
 */
function parseArmBindings(raw: string | undefined | null): EndpointArmBinding[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const out: EndpointArmBinding[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "") continue;
    if (t === "_") { out.push({ discard: true, field: null, local: null }); continue; }
    const colon = t.indexOf(":");
    if (colon >= 0) {
      const field = t.slice(0, colon).trim();
      const local = t.slice(colon + 1).trim();
      out.push({ discard: false, field: field || null, local: local || null });
    } else {
      out.push({ discard: false, field: null, local: t });
    }
  }
  return out;
}

/**
 * Generate server-side route handler code for all server-boundary functions
 * in a file.
 */
export function generateServerJs(
  ctxOrFileAST: CompileContext | any,
  routeMapLegacy?: any,
  errorsLegacy?: CGError[],
  authMiddlewareLegacy?: any | null,
  middlewareConfigLegacy?: any | null,
  batchPlan?: any,
  batchPlannerErrors?: Array<{ code: string; message: string; span?: any }>,
  modeLegacy?: "browser" | "library",
  protectAnalysisLegacy?: unknown,
): string {
  // Support both new (ctx) and legacy (fileAST, routeMap, errors, authMW, mwConfig) signatures
  let fileAST: any;
  let routeMap: any;
  let errors: CGError[];
  let authMiddlewareEntry: any | null;
  let middlewareConfig: any | null;
  const ctxForCache: CompileContext | null =
    (ctxOrFileAST && "fileAST" in ctxOrFileAST && "registry" in ctxOrFileAST)
      ? ctxOrFileAST as CompileContext : null;
  if (ctxForCache) {
    fileAST = ctxForCache.fileAST;
    routeMap = ctxForCache.routeMap;
    errors = ctxForCache.errors;
    authMiddlewareEntry = ctxForCache.authMiddleware;
    middlewareConfig = ctxForCache.middlewareConfig;
  } else {
    fileAST = ctxOrFileAST;
    routeMap = routeMapLegacy;
    errors = errorsLegacy ?? [];
    authMiddlewareEntry = authMiddlewareLegacy ?? null;
    middlewareConfig = middlewareConfigLegacy ?? null;
  }
  const filePath: string = fileAST.filePath;
  const fnNodes: any[] = ctxForCache?.analysis?.fnNodes ?? collectFunctions(fileAST);

  // §14.8.9 — protected-column egress redaction context. Built from the PA
  // stage's ProtectAnalysis (threaded via the new ctx field or the trailing
  // positional). `_protectActive` is the master gate: when the app declares NO
  // `protect=` field, every redaction site below is a no-op and the server
  // bundle is byte-identical to the pre-floor emission (zero overhead).
  const _protectAnalysis: unknown =
    (ctxForCache as { protectAnalysis?: unknown } | null)?.protectAnalysis ?? protectAnalysisLegacy ?? null;
  const _protectCtx: ProtectContext = buildProtectContext(_protectAnalysis);
  const _protectActive: boolean = _protectCtx.protectedByTable.size > 0;

  // §14.8.9 fail-closed gate — E-PROTECT-004. Scan each server-fn SOURCE for a
  // protected-origin `?{}` reaching a RAW / compiler-unanalyzable egress (`_{}`
  // / manual `Response` / `asIs`) where origin-keyed structural redaction cannot
  // be guaranteed. The compiler never silently ships a protected column through
  // a path it cannot redact. (Gated on protect-active; a `reveal` declassifies.)
  if (_protectActive) {
    const _src: string = (fileAST as { _sourceText?: string })._sourceText ?? "";
    if (_src) {
      const _seenEProtect = new Set<string>();
      for (const fn of fnNodes) {
        const _sp = (fn as { span?: { start?: number; end?: number } }).span;
        if (!_sp || typeof _sp.start !== "number" || typeof _sp.end !== "number") continue;
        const _fnSrc = _src.slice(_sp.start, _sp.end);
        const _leak = detectProtectedRawEgress(_fnSrc, _protectCtx);
        if (_leak) {
          const _fnName = (fn as { name?: string }).name ?? "<anonymous>";
          const _dedupKey = `${_fnName}::${_leak.query}::${_leak.egressKind}`;
          if (_seenEProtect.has(_dedupKey)) continue;
          _seenEProtect.add(_dedupKey);
          errors.push(new CGError(
            "E-PROTECT-004",
            `E-PROTECT-004: server function \`${_fnName}\` selects a protected (\`protect=\`) column in \`${_leak.query}\` ` +
            `and reaches ${_leak.egressKind} — an egress the compiler cannot redact, so a protected column cannot be ` +
            `proven stripped at this boundary (§14.8.9). The compiler will not silently ship it. Resolution: declassify ` +
            `explicitly at the value with \`reveal("col")\`, project the protected column out of the SELECT, or return the ` +
            `row through the normal compiler-emitted response (not a manual \`Response\` / \`_{}\` / \`asIs\`).`,
            (_sp as any),
            "error",
          ));
        }
      }
    }
  }

  // §12.6 (Library-mode emission) — effective compile mode. Read from the
  // ctx when the new signature is used, else the trailing legacy positional
  // param; defaults to "browser" so every legacy positional call site (and all
  // browser-mode compiles) behave exactly as before.
  const effectiveMode: "browser" | "library" = ctxForCache?.mode ?? modeLegacy ?? "browser";

  // S95 Bug 2 — set up the variant-fields registry for the rewriter so that
  // `.Variant(args)` payload-bearing constructor calls in server-fn bodies
  // (event-handler / escape-hatch paths) lower to the canonical
  // `{ variant, data }` tagged-object literal. Mirrors the client setup in
  // emit-client.ts:generateClientJs. Released at the bottom of this function.
  const { fields: _scrmlVariantFields, collisions: _scrmlVariantCollisions } =
    buildVariantFieldsRegistry(fileAST);
  setVariantFieldsForRewriter(_scrmlVariantFields, _scrmlVariantCollisions);

  // §14.8.9 — arm the SERVER SQL-lowering pass to tag protected-origin `?{}`
  // SELECT results with the `_scrml_protect_tag(...)` descriptor. Released
  // alongside the variant registry at the bottom of this function. `null` when
  // protect is inactive (no `protect=` field) — a true no-op.
  setProtectContextForRewriter(_protectActive ? _protectCtx : null);

  // §8.9.2 / §19.10.5: determine whether a handler receives an implicit
  // per-handler transaction envelope. Applies iff:
  //   - the Batch Planner (Stage 7.5) recorded ≥ 1 CoalescingGroup with
  //     envelopeKind === "implicit-handler-tx" for this handler, AND
  //   - no E-BATCH-001 composition error fired for this handler.
  function needsImplicitEnvelope(funcName: string): boolean {
    if (!batchPlan || !(batchPlan as any).coalescedHandlers) return false;
    const groups = (batchPlan as any).coalescedHandlers.get(funcName);
    if (!groups || groups.length === 0) return false;
    const hasImplicit = groups.some((g: any) => g.envelopeKind === "implicit-handler-tx");
    if (!hasImplicit) return false;
    const suppressed = (batchPlannerErrors ?? []).some(
      (e) => e.code === "E-BATCH-001" && typeof e.message === "string" && e.message.includes(`'${funcName}'`),
    );
    return !suppressed;
  }
  const serverFns: Array<{ fnNode: any; route: any }> = [];
  // Bug 2b (channel-codegen-fixes-2026-06-12): onserver:* channel attribute
  // handlers are server-boundary but invoked from the WS `_scrml_ws_handlers`
  // path (§38.6.1 / §38.7), NOT an HTTP RPC route. They are emitted as plain
  // callable server functions (with broadcast injection) and DO NOT get a route
  // handler or a client fetch stub. Collected here, emitted below.
  const channelWsHandlerFns: Array<{ fnNode: any; route: any }> = [];

  for (const fnNode of fnNodes) {
    const fnNodeId = `${filePath}::${fnNode.span.start}`;
    const route = routeMap.functions.get(fnNodeId);
    if (!route || route.boundary !== "server") continue;

    // Bug 2b: divert onserver:* WS attribute handlers to the plain-function
    // emit path BEFORE the no-route E-CG-002 check (they legitimately have no
    // generated route name).
    if (route.isChannelWsHandler === true) {
      channelWsHandlerFns.push({ fnNode, route });
      continue;
    }

    // §12.6 (Library-mode emission). In `--mode library` there is no client
    // and nothing fetches a generated route, so the §12.3 infrastructure
    // bundle (route handler + client fetch call + event/reactive trigger +
    // ser/deser) is inapplicable as a whole. For a function escalated PURELY
    // by body content — escalationReasons all `kind:"server-only-resource"`
    // (§12.2 Triggers 1/3: a server-only import or `?{}` SQL) and NO explicit
    // `route=`/`method=` — the compiler SHALL NOT emit the HTTP-handler
    // wrapper; the function is exported as a plain server-side binding by the
    // library `.js` instead (consistent with §13.4: an escalated callee with
    // no wire caller generates no separate HTTP route, and §21.5: a library
    // file's sole output is its exported bindings).
    //
    // An EXPLICIT `export server function` / explicit `route=` (escalation
    // reasons include `kind:"explicit-annotation"`, or explicitRoute/Method is
    // set) RETAINS the wrapper — it preserves the host `mount(server)` /
    // page-route-library use case (Insight 22). A `protected-field-access`
    // reason also retains the wrapper (not a pure body-content escalation).
    //
    // SCOPE GUARD: this suppression is only safe when the function ALSO emits
    // cleanly as a plain export in the library `.js`. The import-escalated
    // shape (a plain `export function` importing e.g. `scrml:fs`) does. A
    // function whose body carries a top-level server-only node (inline `?{}` /
    // transaction) does NOT emit cleanly today (separate staged lifecycle —
    // W5a/W5b / E-CG-006 territory); suppressing its wrapper would leave it
    // with neither a working export nor an endpoint. We therefore additionally
    // require the function body to contain no top-level server-only node, so
    // such cases keep their current behavior (out of scope).
    if (effectiveMode === "library" && isBodyOnlyEscalation(route, fnNode)) {
      continue;
    }

    if (!route.generatedRouteName) {
      errors.push(new CGError(
        "E-CG-002",
        `E-CG-002: Server-boundary function \`${fnNode.name ?? "<anonymous>"}\` has no ` +
        `generated route name. This indicates an RI invariant violation.`,
        fnNode.span,
      ));
      continue;
    }

    serverFns.push({ fnNode, route });
  }

  const _scrml_handleNodeEarly: any | null = fnNodes.find((fn: any) => fn.isHandleEscapeHatch) ?? null;

  const channelNodes: any[] = ctxForCache?.analysis?.channelNodes ?? collectChannelNodes(getNodes(fileAST));
  // C18 (§38.6): map function-name → owning-channel-name. Server functions
  // declared inside a `<channel>` body get `broadcast(data)` / `disconnect()`
  // auto-injected as locals; functions outside the map don't.
  const channelFnMap: Map<string, string> = collectChannelFunctionMap(getNodes(fileAST));
  // Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): per-channel V5-strict cell
  // set, used to thread `channelOwnedCells` into emit-logic opts for each
  // channel-owned server-fn body emit. The bare-expr server arm lowers
  // `@cell = expr` (cell ∈ channelOwnedCells) to the broadcast wire frame
  // per SPEC §38.4 line 15998. Paired with the RI-side suppression of
  // E-RI-002 for channel-owned writes to channel cells.
  const channelCellMap: Map<string, Set<string>> = collectChannelCellMap(getNodes(fileAST));
  // C18 (§38.6): per-channel topic resolution map. Keyed by channel name; the
  // value is a JS expression-string evaluating to the topic at runtime. For
  // string-literal topics this is `JSON.stringify(value)`; for `topic=@var`
  // we currently fall back to the channel's `name` attribute (matches the
  // client IIFE topic-default behavior; dynamic `topic=@var` server-side is
  // §38.6.2 territory and is deferred per C18 SURVEY).
  const channelTopicMap: Map<string, string> = new Map();
  for (const chNode of channelNodes) {
    const attrs: any[] = chNode.attrs ?? chNode.attributes ?? [];
    const nameAttr = attrs.find((a: any) => a && a.name === "name");
    let chName = "channel";
    if (nameAttr) {
      const v = nameAttr.value;
      if (v?.kind === "string-literal") chName = v.value;
      else if (typeof v === "string") chName = v;
    }
    const topicAttr = attrs.find((a: any) => a && a.name === "topic");
    let topicExpr = JSON.stringify(chName);
    if (topicAttr) {
      const v = topicAttr.value;
      if (v?.kind === "string-literal") topicExpr = JSON.stringify(v.value);
      // dynamic topic=@var: leave as channel name fallback; §38.6.2 deferred
    }
    channelTopicMap.set(chName, topicExpr);
  }

  // C18 (§38.6): emit `broadcast(data)` / `disconnect()` injection lines for
  // a channel-owned server function. Returns indented JS lines that define
  // both as locals so the user's body can call them directly.
  //
  // - `broadcast(d)` publishes JSON-serialized `d` to the channel topic via
  //   the global server handle (`globalThis._scrml_active_server`), set by
  //   build.js / dev.js after `Bun.serve()`. Falls back to a no-op when no
  //   server is registered (test paths, isolated module imports, etc.).
  // - `disconnect()` from an HTTP-routed channel-owned server function has
  //   no "current client" identity (the call originates from an HTTP POST,
  //   not a WS connection). It is therefore a no-op in this context. The
  //   `onserver:close` / `onserver:message` paths that DO have `ws` in
  //   scope inject a different `disconnect()` shape inside emit-channel's
  //   _scrml_ws_handlers handler bodies (deferred per C18 SURVEY).
  function emitBroadcastInjection(channelName: string, indent: string): string[] {
    const topicExpr = channelTopicMap.get(channelName) ?? JSON.stringify(channelName);
    return [
      `${indent}// §38.6 broadcast/disconnect built-ins for channel "${channelName}"`,
      `${indent}const broadcast = (_scrml_data) => {`,
      `${indent}  const _scrml_srv = (typeof globalThis !== "undefined" && globalThis._scrml_active_server) || null;`,
      `${indent}  if (_scrml_srv && typeof _scrml_srv.publish === "function") {`,
      `${indent}    _scrml_srv.publish(${topicExpr}, JSON.stringify(_scrml_data));`,
      `${indent}  }`,
      `${indent}};`,
      `${indent}const disconnect = () => { /* §38.6: no-op from HTTP-routed server fn (no current client) */ };`,
    ];
  }

  // §8.11: detect if this file needs a synthetic __mountHydrate route
  // (≥2 `server @var` decls with callable initExprs → coalesce initial loads).
  const _mhAllServerVars = collectServerVarDecls(fileAST);
  const _mhCallableDecls = callableServerVarDecls(_mhAllServerVars);
  const _needsMountHydrate = _mhCallableDecls.length >= 2;

  // §52.3.5 Tier-1 server-authority TYPE instances need a `/__serverLoad/<var>`
  // route (the SELECT * read-authority load, §52.6.1). The emission gate must
  // fire on them even when there are no developer-authored server fns (G1
  // SCOPING §7 finding #2 — without this a Tier-1-only file early-returns ""
  // and the load route has nowhere to live).
  const _serverAuthorityInstances = collectServerAuthorityTypes(fileAST);
  const _hasServerAuthorityCells = _serverAuthorityInstances.length > 0;

  // §52.6.5 Pattern C (S216 disposition A): Tier-2 `<var server> = ?{…}` decls
  // whose inline `?{}` IS the mount load (param-FREE only — a param-bearing
  // query needs POST-body params, a bounded follow-on). Each gets a synthetic
  // `/__serverLoad/<var>` route running the cell's actual query. The emission
  // gate must fire on them even when there are no developer-authored server fns
  // (a Pattern-C-only file would otherwise early-return "" and the load route
  // would have nowhere to live — mirror of the Tier-1 _hasServerAuthorityCells
  // gate above).
  const _patternCLoadDecls = _mhAllServerVars.filter(
    (d) => serverVarDeclLoadKind(d) === "sql-load",
  );
  const _hasPatternCLoad = _patternCLoadDecls.length > 0;

  // §61.6 — an `<endpoint>` emits a server route-handler directly (bypassing the
  // function-route path), so the emission gate must fire on a file that has an
  // `<endpoint>` even when it has NO developer-authored server fns (mirror of the
  // Tier-1 / Pattern-C server-authority gates above). Collected ONCE here and
  // reused by the endpoint-handler emit block after the function-handler loop.
  const _endpointDecls = collectEndpointDecls(getNodes(fileAST));
  const _hasEndpointDecls = _endpointDecls.length > 0;

  if (
    serverFns.length === 0 &&
    !authMiddlewareEntry &&
    channelNodes.length === 0 &&
    !middlewareConfig &&
    !_scrml_handleNodeEarly &&
    !_needsMountHydrate &&
    !_hasServerAuthorityCells &&
    !_hasPatternCLoad &&
    !_hasEndpointDecls
  ) return "";

  const lines: string[] = [];
  lines.push("// Generated server route handlers");
  lines.push("// This file is compiler IR — not meant for direct consumption.");
  lines.push("");

  // Emit JS imports from use-decl and import-decl nodes (§40).
  // Local .scrml imports are rewritten to .server.js (compiled server output);
  // mirrors emit-client.ts handling but targets server-side artefacts. scrml:
  // and vendor: prefixed imports pass through unchanged — they are valid Bun
  // module specifiers handled by rewriteStdlibImports() / Bun's vendor resolution.
  //
  // Task #17 (S85): cross-file channel imports (kebab-named, string-literal
  // form in source — `import { "dispatch-board" as alias } from '...'`) are
  // filtered out via `filterChannelImportSpecifiers`. Channels are inlined
  // by CHX at the consumer site, not resolved via ES module bindings, so
  // emitting a JS import for them either produces a SyntaxError (bare kebab)
  // or a module-link error (no matching export on the channel-file side).
  // g-pure-module-server-emit (S207): server-import tree-shaking. A LOCAL
  // `.scrml` import is rewritten to `<mod>.server.js`, but that file is only
  // emitted when the imported MODULE has its own server content (server fns,
  // auth, channels, server-authority cells). A PURE-helper module (types +
  // pure `fn`s, no `?{}`) imported for CLIENT-side use only emits NO
  // `.server.js`, yet the unconditional `import { ... } from "<mod>.server.js"`
  // here dangles → the whole server bundle throws `Cannot find module` at
  // RUNTIME (green compile; node --check passes — a missing FILE, not a syntax
  // error). The two-sided gating (per-module `.server.js` emission vs the
  // consumer's unconditional import) disagree for a client-only-used module.
  //
  // Fix: DEFER local-`.scrml` named imports and prune them by ACTUAL server-
  // body usage. After the full server body is assembled below, a specifier is
  // kept only if its local name is referenced in the emitted JS; an import line
  // whose every specifier is unused (the bug case) is dropped entirely. Client/
  // server both emit ALL named specifiers incl. erased TYPE imports — usage-
  // pruning is also the only correct way to keep a `.server.js` import from
  // referencing a type that has no runtime (server) export. `scrml:`/vendor:
  // imports always resolve (stdlib shims / Bun vendor resolution) and default
  // imports are left as-is — both are emitted inline here, unchanged.
  const allImports: any[] = fileAST?.ast?.imports ?? fileAST?.imports ?? [];
  const deferredLocalImports: Array<{ jsSource: string; specs: Array<{ imported: string; local: string }> }> = [];
  let _localImportSentinelIdx = -1;
  for (const stmt of allImports) {
    if ((stmt.kind === "import-decl" || stmt.kind === "use-decl") && stmt.source && stmt.names?.length > 0) {
      let jsSource: string = stmt.source;
      const isLocalScrml = jsSource.endsWith(".scrml");
      if (isLocalScrml) {
        jsSource = jsSource.replace(/\.scrml$/, ".server.js");
      }
      if (stmt.isDefault) {
        // Default imports cannot be channel bindings (channels are always
        // named-export style). Emit unchanged.
        const names: string = stmt.names.join(", ");
        lines.push(`import ${names} from ${JSON.stringify(jsSource)};`);
        continue;
      }
      const kept = filterChannelImportSpecifiers(stmt, filePath, ctxForCache?.exportRegistry ?? null);
      if (kept.length === 0) continue; // All specifiers are channels — skip emit entirely.
      if (isLocalScrml) {
        // Defer: emit at the sentinel after usage is known (see prune pass below).
        if (_localImportSentinelIdx === -1) {
          _localImportSentinelIdx = lines.length;
          lines.push(LOCAL_SERVER_IMPORT_SENTINEL);
        }
        deferredLocalImports.push({
          jsSource,
          specs: kept.map((s) => ({ imported: s.imported, local: s.local })),
        });
        continue;
      }
      const names = kept.map((s) => (s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`)).join(", ");
      lines.push(`import { ${names} } from ${JSON.stringify(jsSource)};`);
    }
  }
  lines.push("");

  // Session/auth middleware (Option C hybrid)
  if (authMiddlewareEntry) {
    const { loginRedirect, csrf, sessionExpiry } = authMiddlewareEntry;

    lines.push("// --- Session middleware (compiler-generated) ---");
    lines.push(`const _scrml_session_expiry = ${JSON.stringify(sessionExpiry)};`);
    lines.push("");
    lines.push("function _scrml_session_middleware(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const sessionId = cookieHeader.match(/scrml_sid=([^;]+)/)?.[1] || null;");
    lines.push("  return { sessionId, isAuth: !!sessionId };");
    lines.push("}");
    lines.push("");

    lines.push("// --- Auth check middleware ---");
    lines.push(`function _scrml_auth_check(req) {`);
    lines.push(`  const session = _scrml_session_middleware(req);`);
    lines.push(`  if (!session.isAuth) {`);
    lines.push(`    return new Response(null, {`);
    lines.push(`      status: 302,`);
    lines.push(`      headers: { Location: ${JSON.stringify(loginRedirect)} },`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(`  return null;`);
    lines.push(`}`);
    lines.push("");

    if (csrf === "auto") {
      lines.push("// --- CSRF token generation and validation ---");
      lines.push("function _scrml_generate_csrf() {");
      lines.push("  return crypto.randomUUID();");
      lines.push("}");
      lines.push("");
      lines.push("function _scrml_validate_csrf(req, session) {");
      lines.push("  const token = req.headers.get('X-CSRF-Token') || '';");
      lines.push("  return token === session.csrfToken;");
      lines.push("}");
      lines.push("");
    }

    lines.push("// --- session.destroy() handler ---");
    lines.push("export const _scrml_session_destroy = {");
    lines.push(`  path: "/_scrml/session/destroy",`);
    lines.push(`  method: "POST",`);
    lines.push("  handler: async function(_scrml_req) {");
    lines.push("    return new Response(JSON.stringify({ ok: true }), {");
    lines.push("      status: 200,");
    lines.push("      headers: {");
    lines.push(`        'Set-Cookie': 'scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',`);
    lines.push("        'Content-Type': 'application/json',");
    lines.push("      },");
    lines.push("    });");
    lines.push("  },");
    lines.push("};");
    lines.push("");
  }

  // Baseline CSRF protection
  const hasStateMutatingRoutes = serverFns.some(({ route }) => {
    const m: string = route.explicitMethod ?? "POST";
    return m !== "GET" && m !== "HEAD";
  });

  if (!authMiddlewareEntry && hasStateMutatingRoutes) {
    lines.push("// --- Baseline CSRF protection (compiler-generated, double-submit cookie) ---");
    lines.push("function _scrml_ensure_csrf_cookie(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const existing = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || null;");
    lines.push("  return existing || crypto.randomUUID();");
    lines.push("}");
    lines.push("");
    lines.push("function _scrml_validate_csrf(req) {");
    lines.push("  const cookieHeader = req.headers.get('Cookie') || '';");
    lines.push("  const cookieToken = cookieHeader.match(/scrml_csrf=([^;]+)/)?.[1] || '';");
    lines.push("  const headerToken = req.headers.get('X-CSRF-Token') || '';");
    lines.push("  return cookieToken.length > 0 && cookieToken === headerToken;");
    lines.push("}");
    lines.push("");
  }

  // §39 Compiler-auto middleware infrastructure
  const _scrml_hasMW: boolean = middlewareConfig != null;
  const _scrml_hasCors: boolean = _scrml_hasMW && middlewareConfig.cors != null;
  const _scrml_hasLog: boolean = _scrml_hasMW && middlewareConfig.log != null && middlewareConfig.log !== 'off';
  const _scrml_hasRatelimit: boolean = _scrml_hasMW && middlewareConfig.ratelimit != null;
  const _scrml_hasSecureHeaders: boolean = _scrml_hasMW && middlewareConfig.headers === 'strict';
  const _scrml_handleNode: any | null = _scrml_handleNodeEarly;

  if (_scrml_hasMW || _scrml_handleNode) {
    lines.push("// --- §39 Compiler-auto middleware infrastructure ---");
    lines.push("");

    if (_scrml_hasCors) {
      const corsOrigin = JSON.stringify(middlewareConfig.cors);
      // S81 audit fix F.1 (§39.2.1 amendment): Max-Age is overridable via
      // <program cors-max-age=N>. Default 86400 (Firefox effective cap).
      // Silent fallback on null/malformed per v1 scope.
      const corsMaxAgeRaw = (middlewareConfig as { corsMaxAge?: string | null }).corsMaxAge ?? null;
      const corsMaxAgeSec = parseCorsMaxAge(corsMaxAgeRaw);
      const corsMaxAgeValue = corsMaxAgeSec !== null ? String(corsMaxAgeSec) : "86400";
      lines.push("// §39.2.1 CORS helpers");
      lines.push("function _scrml_cors_headers() {");
      lines.push("  return {");
      lines.push(`    'Access-Control-Allow-Origin': ${corsOrigin},`);
      lines.push("    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',");
      lines.push("    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',");
      lines.push(`    'Access-Control-Max-Age': '${corsMaxAgeValue}',`);
      lines.push("  };");
      lines.push("}");
      lines.push("export const _scrml_cors_options_route = {");
      lines.push("  path: '/*',");
      lines.push("  method: 'OPTIONS',");
      lines.push("  handler: function(_scrml_req) {");
      lines.push("    return new Response(null, { status: 204, headers: _scrml_cors_headers() });");
      lines.push("  },");
      lines.push("};");
      lines.push("");
    }

    if (_scrml_hasRatelimit) {
      const parts: string[] = middlewareConfig.ratelimit.split('/');
      const limit: number = parseInt(parts[0], 10);
      const unit: string = parts[1];
      const windowMs: number = unit === 'sec' ? 1000 : unit === 'min' ? 60000 : 3600000;
      lines.push("// §39.2.4 Rate limiter (in-memory sliding window, per IP)");
      lines.push("const _scrml_rate_map = new Map();");
      lines.push(`const _scrml_rate_limit = ${limit};`);
      lines.push(`const _scrml_rate_window = ${windowMs};`);
      lines.push("function _scrml_check_ratelimit(req) {");
      lines.push("  const forwarded = req.headers.get('x-forwarded-for');");
      lines.push("  const ip = forwarded ? forwarded.split(',')[0].trim()");
      lines.push("    : (typeof Bun !== 'undefined' && Bun.requestIP ? (Bun.requestIP(req)?.address ?? 'unknown') : 'unknown');");
      lines.push("  const now = Date.now();");
      lines.push("  const windowStart = now - _scrml_rate_window;");
      lines.push("  const hits = (_scrml_rate_map.get(ip) ?? []).filter(t => t > windowStart);");
      lines.push("  hits.push(now);");
      lines.push("  _scrml_rate_map.set(ip, hits);");
      lines.push("  if (hits.length > _scrml_rate_limit) {");
      lines.push(`    const retryAfter = Math.ceil(_scrml_rate_window / 1000);`);
      lines.push("    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {");
      lines.push("      status: 429,");
      lines.push("      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },");
      lines.push("    });");
      lines.push("  }");
      lines.push("  return null;");
      lines.push("}");
      lines.push("");
    }

    if (_scrml_hasSecureHeaders) {
      lines.push("// §39.2.5 Security headers");
      lines.push("function _scrml_apply_security_headers(response) {");
      lines.push("  response.headers.set('X-Content-Type-Options', 'nosniff');");
      lines.push("  response.headers.set('X-Frame-Options', 'SAMEORIGIN');");
      lines.push("  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');");
      lines.push("  response.headers.set('Content-Security-Policy', \"default-src 'self'\");");
      lines.push("  return response;");
      lines.push("}");
      lines.push("");
    }

    if (_scrml_hasLog) {
      const logMode: string = middlewareConfig.log;
      lines.push("// §39.2.2 Request/response logging");
      lines.push("function _scrml_log_request(method, path, status, ms) {");
      if (logMode === 'structured') {
        lines.push("  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), method, path, status, ms }) + '\\n');");
      } else {
        lines.push("  process.stdout.write(method + ' ' + path + ' ' + status + ' ' + ms + 'ms\\n');");
      }
      lines.push("}");
      lines.push("");
    }

    lines.push("// §39 Middleware pipeline wrapper");
    lines.push("// Pipeline: CORS → rate-limit → handle() PRE → CSRF → route → handle() POST → headers → logging");
    lines.push("function _scrml_mw_wrap(routeHandler) {");
    lines.push("  return async function _scrml_mw_handler(_scrml_mw_req) {");

    if (_scrml_hasLog) {
      lines.push("    const _scrml_mw_t0 = Date.now();");
    }

    if (_scrml_hasRatelimit) {
      lines.push("    const _scrml_rl = _scrml_check_ratelimit(_scrml_mw_req);");
      lines.push("    if (_scrml_rl) return _scrml_rl;");
    }

    if (_scrml_handleNode) {
      const handleBody: any[] = _scrml_handleNode.body ?? [];

      let resolveIdx = -1;
      for (let i = 0; i < handleBody.length; i++) {
        const code = emitLogicNode(handleBody[i], { boundary: "server" });
        if (code && code.includes('resolve(')) {
          resolveIdx = i;
          break;
        }
      }

      lines.push("    // handle() escape hatch body (§39.3) — wrapped in IIFE for return capture");
      lines.push("    const _scrml_mw_result = await (async () => {");

      lines.push("      // resolve() = route dispatch (CSRF check is per-route)");
      lines.push("      const resolve = async (_scrml_resolve_req) => {");
      lines.push("        return routeHandler(_scrml_resolve_req);");
      lines.push("      };");

      const handleParams: any[] = _scrml_handleNode.params ?? [];
      const requestParamName: string = typeof handleParams[0] === 'string' ? handleParams[0] : 'request';

      if (requestParamName !== '_scrml_mw_req') {
        lines.push(`      const ${requestParamName} = _scrml_mw_req;`);
      }

      for (const stmt of handleBody) {
        const code = emitLogicNode(stmt, { boundary: "server" });
        if (code) {
          for (const line of code.split('\n')) lines.push('      ' + line);
        }
      }

      lines.push("    })();");
    } else {
      lines.push("    // No handle() — direct route dispatch (CSRF check is per-route)");
      lines.push("    const _scrml_mw_result = await routeHandler(_scrml_mw_req);");
    }

    if (_scrml_hasSecureHeaders) {
      lines.push("    if (_scrml_mw_result instanceof Response) _scrml_apply_security_headers(_scrml_mw_result);");
    }

    if (_scrml_hasCors) {
      lines.push("    if (_scrml_mw_result instanceof Response) {");
      lines.push("      const _scrml_cors_h = _scrml_cors_headers();");
      lines.push("      for (const [k, v] of Object.entries(_scrml_cors_h)) {");
      lines.push("        _scrml_mw_result.headers.set(k, v);");
      lines.push("      }");
      lines.push("    }");
    }

    if (_scrml_hasLog) {
      lines.push("    const _scrml_mw_status = _scrml_mw_result instanceof Response ? _scrml_mw_result.status : 200;");
      lines.push("    _scrml_log_request(_scrml_mw_req.method, new URL(_scrml_mw_req.url, 'http://localhost').pathname, _scrml_mw_status, Date.now() - _scrml_mw_t0);");
    }

    lines.push("    return _scrml_mw_result;");
    lines.push("  };");
    lines.push("}");
    lines.push("");
  }

  // ---- Issue #1 (parent scrmlTS): server-fn → server-fn in-process calls ----
  // A server function invoked from a SIBLING server function's body needs a
  // plain in-process callable. The per-fn route handler (`_scrml_handler_*`) is
  // a Request->Response wrapper, not a callable, so a body-level `nextOrder()`
  // reference had no binding → "nextOrder is not defined" at runtime. We register
  // every "simple" server fn (non-CPS, non-SSE, non-channel) as a peer-callable
  // name so its call sites lower to `await <name>(...)` (emit-expr serverFnNames
  // path), and — AFTER the handler loop — emit `async function <name>(<params>)
  // { <body> }` for each peer that some server-fn body actually calls. Function
  // declarations hoist, so the emission order relative to the handlers is moot.
  // Restricting to simple fns keeps the emission surgical: CPS/SSE/channel fns
  // (whose bodies are split or context-bound) keep the pre-fix behavior, and a
  // program that never composes server fns is byte-unchanged.
  const _peerCallableInfo = new Map<string, { fnNode: any; paramNames: string[] }>();
  const _serverFnPeerNames = new Set<string>();
  // Issue #1 — bare-peer-call sites recorded by emit-expr during body emission
  // (a peer call in a non-awaitable position). Diagnosed AFTER all bodies are
  // emitted. Threaded into every server-mode emit context below.
  const _syncPeerCalls: Array<{ name: string; span: unknown }> = [];
  for (const { fnNode: _pfn, route: _proute } of serverFns) {
    const _pn = _pfn?.name;
    if (typeof _pn !== "string" || _pn.length === 0) continue;
    if (_proute?.cpsSplit || _proute?.isSSE) continue;
    if (channelFnMap.has(_pn)) continue;
    const _pparams: any[] = _pfn.params ?? [];
    const _pparamNames: string[] = _pparams.map((p: any, i: number) => paramName(p, i));
    _serverFnPeerNames.add(_pn);
    _peerCallableInfo.set(_pn, { fnNode: _pfn, paramNames: _pparamNames });
  }

  // EMISSION (`_calledPeerNames`): collect a peer from EVERY call site, structured
  // or raw, at any depth — including INSIDE lambda bodies and param defaults — so
  // the load-bearing invariant holds: every call emit-expr lowers (to `await
  // <peer>()` or a bare `<peer>()`) has a corresponding emitted `async function
  // <peer>`. `exprNodeCollectCallees`/`forEachCallInExprNode` deliberately stop at
  // `case "lambda"`, and a block-body callback parses as an `escape-hatch` whose
  // call lives only in its `.raw` text — so a peer reached solely through a lambda
  // would otherwise be invisible to emission while emit-expr still references it →
  // silent ReferenceError. The generic object walk below descends through
  // everything; raw escape-hatch callees are recovered with `extractCalleeNames`.
  // Over-collecting (a peer reached only through a SYNC callback, which is also
  // diagnosed) is harmless dead code; under-collecting is a crash.
  //
  // DIAGNOSTIC (E-SERVER-FN-IN-SYNC-CALLBACK): a peer call in a synchronous
  // callback returns an unawaited Promise. For STRUCTURED lambdas the position is
  // decided by emit-expr's `peerAwaitable` lowering, which records each bare call
  // into `_syncPeerCalls` (diagnosed after body emission — single source of
  // truth, no second classifier). The ONE shape emit-expr can't see is a
  // block-body callback (emitted as raw escape-hatch text); the walk diagnoses
  // those here.
  // Shared E-SERVER-FN-IN-SYNC-CALLBACK emitter — used by the escape-hatch walk
  // below AND by the post-emission `_syncPeerCalls` drain (structured lambdas).
  const _diagSyncCb = (peerName: string, span: any): void => {
    const _sp = (span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
    errors.push(new CGError(
      "E-SERVER-FN-IN-SYNC-CALLBACK",
      `E-SERVER-FN-IN-SYNC-CALLBACK: server function \`${peerName}\` is called inside a ` +
      `synchronous callback. A server function runs asynchronously, but \`await\` is ` +
      `not valid in a non-async callback (and making the callback async would make ` +
      `\`.map\`/\`.forEach\` yield Promises instead of values). Refactor to a \`for\` loop ` +
      `so the call runs in the server function's async body, e.g. ` +
      `\`for (const x of xs) { ... ${peerName}(x) ... }\`.`,
      { file: filePath ?? _sp.file ?? "", start: _sp.start ?? 0, end: _sp.end ?? 0, line: _sp.line ?? 1, col: _sp.col ?? 1 },
      "error",
    ));
  };
  const _calledPeerNames = new Set<string>();
  {
    const _seen = new WeakSet<object>();
    const _walk = (n: any): void => {
      if (!n || typeof n !== "object" || _seen.has(n)) return;
      _seen.add(n);

      // EMISSION — a structured call whose callee is a peer (any depth).
      if (n.kind === "call" && n.callee && n.callee.kind === "ident"
          && typeof n.callee.name === "string" && _serverFnPeerNames.has(n.callee.name)) {
        _calledPeerNames.add(n.callee.name);
      }
      // EMISSION — peer callees inside an escape-hatch's raw text (block-body
      // callbacks, raw JS). The call there is bare (no `await` lowering), so the
      // peer MUST be emitted for the bare reference to resolve.
      if (n.kind === "escape-hatch" && typeof n.raw === "string") {
        for (const c of extractCalleeNames(n.raw)) {
          if (_serverFnPeerNames.has(c)) _calledPeerNames.add(c);
        }
      }

      // ss22 #4 (g-peer-call-in-raw-template-unawaited) — EMISSION. A peer call
      // inside a TEMPLATE LITERAL interpolation (`` `…${peer()}…` ``) or a SQL
      // `?{}` param (`?{`… ${peer()} …`}`) now lowers to `await peer()`
      // (emit-expr.ts:emitServerTemplateLit / emit-logic.ts:taggedFromParams).
      // Those calls live only in a `lit` (litType "template") `.raw` text or a
      // `sql` node's `.query`/`.body` raw text — neither is a structured `call`
      // node, so the generic walk above never discovers them and the peer
      // callable was not emitted → `await peer()` referenced an undefined symbol.
      // Recover the callees textually (same shape as the escape-hatch scan).
      if (n.kind === "lit" && n.litType === "template" && typeof n.raw === "string"
          && n.raw.includes("${")) {
        for (const c of extractCalleeNames(n.raw)) {
          if (_serverFnPeerNames.has(c)) _calledPeerNames.add(c);
        }
      }
      if (n.kind === "sql") {
        const _sqlRaw = (typeof n.query === "string" ? n.query : "")
          + " " + (typeof n.body === "string" ? n.body : "");
        for (const c of extractCalleeNames(_sqlRaw)) {
          if (_serverFnPeerNames.has(c)) _calledPeerNames.add(c);
        }
      }

      // DIAGNOSTIC — non-async block-body callback. Structured lambdas are
      // diagnosed from `_syncPeerCalls` (recorded by emit-expr's position-accurate
      // lowering — see below), but a BLOCK-body callback parses as an
      // `escape-hatch` whose body is raw text emitted VERBATIM (emit-expr never
      // sees the inner call), so its sync-callback peer calls are diagnosed here.
      // Covers BOTH arrow (`x => { … }`) and `function(){ … }` callbacks; an
      // `async`-prefixed one is legitimate (the bare call resolves to a Promise
      // the async body awaits) and is left alone.
      if (n.kind === "escape-hatch" && typeof n.raw === "string"
          && (n.nativeKind === "ArrowFunctionExpression" || n.nativeKind === "FunctionExpression")
          && !/^\s*async\b/.test(n.raw)) {
        const _hit = extractCalleeNames(n.raw).find((c) => _serverFnPeerNames.has(c));
        if (_hit) _diagSyncCb(_hit, n.span);
      }

      // ss19 #12 (g-sql-in-arrow-body-invalid-js) — DIAGNOSTIC. A `?{}` SQL
      // block inside an arrow / function-expression body cannot be lowered: SQL
      // is lowered at the STATEMENT level of a server-function body (the per-stmt
      // sqlNode pass), but an arrow/lambda body parses as an OPAQUE escape-hatch
      // whose raw text is emitted VERBATIM (rewriteServerExprArrowBody). The
      // `?{...}` therefore leaks into the output as invalid JS — pre-fix this
      // surfaced as the generic E-CODEGEN-INVALID-JS ("compiler defect, please
      // report it"), which hid the real, fixable cause. We diagnose it precisely
      // here. The `?{` + backtick signature (a SQL tagged-template opener) avoids
      // false-positives on a ternary-object (`cond?{a:1}:b` has no backtick).
      // Pushing a FATAL error also suppresses the emitted-JS parse gate (api.js
      // Bug 70 hasPriorFatalError), so the user sees ONE actionable diagnostic.
      if (n.kind === "escape-hatch" && typeof n.raw === "string"
          && (n.nativeKind === "ArrowFunctionExpression" || n.nativeKind === "FunctionExpression")
          && /\?\{\s*`/.test(n.raw)) {
        const _sp = (n.span ?? {}) as { file?: string; start?: number; end?: number; line?: number; col?: number };
        errors.push(new CGError(
          "E-SQL-009",
          "E-SQL-009: a `?{}` SQL block appears inside an arrow / lambda body, where the " +
          "compiler cannot lower it. SQL blocks are lowered at the STATEMENT level of a " +
          "server-function body; an arrow / lambda body is opaque to that pass, so the " +
          "`?{...}` would leak verbatim into the emitted JavaScript. Move the SQL into the " +
          "enclosing server function's body — e.g. replace `const ins = (x) => { ?{`...`}.run() }` " +
          "with a server function `function ins(x) { ?{`...`}.run() }` and call it — or hoist the " +
          "query to a `const` / `let` statement at the function-body level and reference the " +
          "result inside the arrow.",
          { file: filePath ?? _sp.file ?? "", start: _sp.start ?? 0, end: _sp.end ?? 0, line: _sp.line ?? 1, col: _sp.col ?? 1 },
          "error",
        ));
      }

      for (const k in n) {
        const v = n[k];
        if (Array.isArray(v)) { for (const ch of v) _walk(ch); }
        else if (v && typeof v === "object") _walk(v);
      }
    };
    for (const { fnNode: _sfn } of serverFns) {
      for (const _stmt of (_sfn?.body ?? [])) _walk(_stmt);
    }
  }

  for (const { fnNode, route } of serverFns) {
    const name: string = fnNode.name ?? "anon";
    const routeName: string = route.generatedRouteName;
    const path: string = route.explicitRoute ? route.explicitRoute : routePath(routeName);
    const params: any[] = fnNode.params ?? [];
    // Bug fix: strip :Type annotations from string params (e.g. "mario:Mario" → "mario")
    const fnParamNames: string[] = params.map((p: any, i: number) =>
      typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? `_scrml_arg_${i}`)
    );

    // §36: SSE handler — server function* generators emit text/event-stream GET
    if (route.isSSE) {
      const handlerName = genVar(`handler_${name}`);
      const body: any[] = fnNode.body ?? [];

      lines.push(`async function ${handlerName}(_scrml_req) {`);

      lines.push(`  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');`);
      lines.push(`  const route = {`);
      lines.push(`    query: Object.fromEntries(_scrml_url.searchParams),`);
      lines.push(`    lastEventId: _scrml_req.headers.get('Last-Event-ID') ?? null,`);
      lines.push(`  };`);

      // GITI-025 (giti inbound 2026-05-30): bind each `server function*`
      // parameter from `route.query`. The client EventSource stub
      // (emit-functions.ts SSE branch) encodes call args into the URL query
      // string using the param name verbatim (`?from=5`); here the handler
      // reads them back so the generator body's free references (e.g. `from`
      // in `for (let i = from; ...)`) resolve. Without this, the param is an
      // unbound identifier → ReferenceError → swallowed by the stream catch →
      // silent EMPTY stream. Query values arrive as STRINGS; emit a coercion
      // that recovers numbers/booleans while preserving genuine strings, so
      // `countdown(5)` counts numerically (§37.4 / §37.11 worked example).
      // Mirrors the non-SSE path's `const X = _scrml_body[...]` binding, but
      // sourced from `route.query` (SSE is a GET stream — no JSON body).
      for (const _pName of fnParamNames) {
        // Absence is canonical JS `null` per SPEC §42.5/§42.8 (W-CG-UNDEFINED-
        // INTERPOLATION). The `=== null || === undefined` presence check is the
        // exempt paired form (route.query[k] is `undefined` for an absent key).
        lines.push(`  const ${_pName} = (() => { const _v = route.query[${JSON.stringify(_pName)}]; if (_v === null || _v === undefined) return null; if (_v === 'true') return true; if (_v === 'false') return false; if (_v !== '' && !Number.isNaN(Number(_v))) return Number(_v); return _v; })();`);
      }

      if (authMiddlewareEntry) {
        lines.push(`  // Auth check for SSE endpoint (compiler-generated)`);
        lines.push(`  const _scrml_authResult = _scrml_auth_check(_scrml_req);`);
        lines.push(`  if (_scrml_authResult) return _scrml_authResult;`);
      }

      lines.push(`  const _scrml_enc = new TextEncoder();`);
      lines.push(`  const _scrml_stream = new ReadableStream({`);
      lines.push(`    async start(_scrml_ctrl) {`);
      lines.push(`      try {`);
      lines.push(`        async function* _scrml_gen() {`);

      // S144 (GITI-021 + GITI-022): SSE server-fn* body — shared per-function
      // opts so a `let`/`const` in an outer statement is visible to a nested
      // reassignment (declaredNames Set), mirroring the CSRF/non-CSRF handler
      // paths. SSE generators are not channel-owned, so channelOwnedCells stays
      // null here.
      const _serverFnOptsSSE = {
        boundary: "server" as const,
        declaredNames: new Set<string>(fnParamNames),
        insideFunctionBody: true,
        // Issue #1: resolve sibling server-fn calls to in-process peer callables.
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
      };

      for (const stmt of body) {
        const code = emitLogicNode(stmt, _serverFnOptsSSE);
        if (code) {
          for (const line of code.split("\n")) {
            lines.push(`          ${line}`);
          }
        }
      }

      lines.push(`        }`);
      lines.push(`        for await (const _scrml_val of _scrml_gen()) {`);
      lines.push(`          const _scrml_hasEvent = _scrml_val && typeof _scrml_val === 'object' && 'event' in _scrml_val && 'data' in _scrml_val;`);
      lines.push(`          let _scrml_chunk = '';`);
      lines.push(`          if (_scrml_hasEvent) {`);
      lines.push(`            _scrml_chunk += \`event: \${_scrml_val.event}\\n\`;`);
      lines.push(`            if (_scrml_val.id != null) _scrml_chunk += \`id: \${_scrml_val.id}\\n\`;`);
      lines.push(`            _scrml_chunk += \`data: \${JSON.stringify(_scrml_val.data)}\\n\\n\`;`);
      lines.push(`          } else {`);
      lines.push(`            if (_scrml_val && typeof _scrml_val === 'object' && 'id' in _scrml_val) {`);
      lines.push(`              _scrml_chunk += \`id: \${_scrml_val.id}\\n\`;`);
      lines.push(`            }`);
      lines.push(`            _scrml_chunk += \`data: \${JSON.stringify(_scrml_val)}\\n\\n\`;`);
      lines.push(`          }`);
      lines.push(`          _scrml_ctrl.enqueue(_scrml_enc.encode(_scrml_chunk));`);
      lines.push(`        }`);
      lines.push(`      } catch (_scrml_err) {`);
      lines.push(`        // Stream error — close the controller`);
      lines.push(`      } finally {`);
      lines.push(`        _scrml_ctrl.close();`);
      lines.push(`      }`);
      lines.push(`    },`);
      lines.push(`    cancel() { /* client disconnected — cleanup handled in finally */ },`);
      lines.push(`  });`);
      lines.push(`  return new Response(_scrml_stream, {`);
      lines.push(`    headers: {`);
      lines.push(`      'Content-Type': 'text/event-stream',`);
      lines.push(`      'Cache-Control': 'no-cache',`);
      lines.push(`      'Connection': 'keep-alive',`);
      lines.push(`    },`);
      lines.push(`  });`);
      lines.push(`}`);
      lines.push("");

      lines.push(`export const ${routeName} = {`);
      lines.push(`  path: ${JSON.stringify(path)},`);
      lines.push(`  method: "GET",`);
      lines.push(`  handler: ${(_scrml_hasMW || _scrml_handleNode != null) ? `_scrml_mw_wrap(${handlerName})` : handlerName},`);
      lines.push(`};`);
      lines.push("");

      continue;
    }

    const httpMethod: string = route.explicitMethod ?? "POST";
    const isStateMutating: boolean = httpMethod !== "GET" && httpMethod !== "HEAD";
    const useBaselineCsrf: boolean = !authMiddlewareEntry && isStateMutating;

    // ----------------------------------------------------------------------
    // Ext 1 M1.5 — multi-stub emit.
    //
    // A non-CPS route, and a CPS route whose body forms a single server
    // batch, both emit exactly ONE handler + ONE route export — identical to
    // the pre-Ext-1 (A9 min-viable) shape.
    //
    // A CPS route whose multi-batch planner (M1.3) produced N>1 batches emits
    // N handlers — `<routeName>__batch_<i>` — and N route exports. Each batch
    // handler:
    //   - runs ONLY that batch's server statements (`batch.indices`),
    //   - gets its own Ext 4 `!`-wrap (every CPS stub is failable),
    //   - gets its own Ext 5 idempotency-key dedup middleware iff THIS batch's
    //     monotonicity verdict (M1.4) is "non-monotone" — monotone batches in
    //     a mixed function skip the dedup layer,
    //   - receives the original function params PLUS every prior batch's
    //     returned value (admissible cross-batch parameter forwarding, M1.3).
    //
    // `_emitBatches` is the per-route emission plan. For the single-handler
    // case it holds one entry whose `serverIndices` is the flat
    // `serverStmtIndices` (or `null` for a non-CPS route — meaning "emit the
    // whole body").
    const _cpsSplit: any = route.cpsSplit;
    const _serverBatches: any[] = (_cpsSplit && Array.isArray(_cpsSplit.serverBatches))
      ? _cpsSplit.serverBatches
      : [];
    const _isMultiBatch: boolean = !!_cpsSplit && _serverBatches.length > 1;
    type EmitBatch = {
      // Server-statement body indices for THIS batch. `null` = non-CPS route
      // (emit the entire body). Empty array = CPS route with no server work.
      serverIndices: number[] | null;
      // Per-batch monotonicity verdict (M1.4); drives the Ext 5 dedup gate.
      monotonicity: string | undefined;
      // 0-based batch ordinal; -1 for the single-handler (non-multi-batch) case.
      batchIndex: number;
      // The route name + path this batch's handler is exported under.
      batchRouteName: string;
      batchPath: string;
      // Names of the prior-batch result values forwarded into this batch's
      // handler as additional `_scrml_body` fields (cross-batch param
      // forwarding, M1.3). Each entry is the scrml cell name a prior batch
      // produced — the handler destructures it from `_scrml_body` and the
      // batch's server statements reference it directly. Empty for batch 0
      // and for the single-handler case.
      fwdResultNames: string[];
    };
    // Compute each batch's return cell — the scrml `state-decl` name of its
    // LAST server statement (the value the batch sends back, and forwards to
    // later batches). The function's final `returnVarName` is the last batch's
    // return; earlier batches return their own last `state-decl` name.
    function batchReturnCell(serverIndices: number[], isLast: boolean): string | null {
      if (isLast) return _cpsSplit?.returnVarName ?? null;
      if (serverIndices.length === 0) return null;
      const _bodyForRet: any[] = fnNode.body ?? [];
      const _last = _bodyForRet[serverIndices[serverIndices.length - 1]];
      return (_last && _last.kind === "state-decl" && typeof _last.name === "string")
        ? _last.name
        : null;
    }
    const _emitBatches: EmitBatch[] = [];
    if (_isMultiBatch) {
      // Multi-batch CPS route — one handler per batch. A batch is forwarded
      // every prior batch's return cell (admissible cross-batch parameter
      // forwarding, M1.3 — the value rides as a request-body field).
      const _fwdSoFar: string[] = [];
      for (let _bi = 0; _bi < _serverBatches.length; _bi++) {
        const _b = _serverBatches[_bi];
        const _bIndices: number[] = Array.isArray(_b.indices)
          ? [..._b.indices].sort((a: number, c: number) => a - c)
          : [];
        _emitBatches.push({
          serverIndices: _bIndices,
          monotonicity: _b.monotonicity,
          batchIndex: _bi,
          batchRouteName: `${routeName}__batch_${_bi}`,
          batchPath: `${path}__batch_${_bi}`,
          fwdResultNames: [..._fwdSoFar],
        });
        // Forward this batch's return cell (if any) to every later batch.
        const _ret = batchReturnCell(_bIndices, _bi === _serverBatches.length - 1);
        if (_ret && !_fwdSoFar.includes(_ret)) _fwdSoFar.push(_ret);
      }
    } else {
      // Single handler — non-CPS route, or a single-batch CPS route.
      _emitBatches.push({
        serverIndices: _cpsSplit ? _cpsSplit.serverStmtIndices : null,
        monotonicity: _cpsSplit ? cpsBatchMonotonicity(_cpsSplit, 0) : undefined,
        batchIndex: -1,
        batchRouteName: routeName,
        batchPath: path,
        fwdResultNames: [],
      });
    }

    for (const _batch of _emitBatches) {
      const _curRouteName: string = _batch.batchRouteName;
      const _curPath: string = _batch.batchPath;
      // Per-batch param list: the original function params, then each prior
      // batch's forwarded result. The handler destructures all of them from
      // `_scrml_body` identically — the wrapper (emit-functions.ts) places the
      // forwarded results into the request body.
      const paramNames: string[] = [...fnParamNames, ..._batch.fwdResultNames];

      // The CPS-split view this batch's handler runs over. For the single-
      // handler case it is the route's own cpsSplit (or `null` for a non-CPS
      // route — handler emits the whole body). For a multi-batch route it is
      // a synthetic per-batch view: `serverStmtIndices` is THIS batch's index
      // set, and `returnVarName` is the cell this batch produces. The last
      // batch produces the function's final `returnVarName`; an earlier batch
      // produces whatever its last server statement is a `state-decl` for.
      const _batchBody: any[] = fnNode.body ?? [];
      let _batchReturnVar: string | null = null;
      if (_cpsSplit) {
        if (!_isMultiBatch) {
          _batchReturnVar = _cpsSplit.returnVarName ?? null;
        } else {
          const _bIdx = _batch.serverIndices ?? [];
          const _isLastBatch = _batch.batchIndex === _serverBatches.length - 1;
          if (_isLastBatch) {
            _batchReturnVar = _cpsSplit.returnVarName ?? null;
          } else if (_bIdx.length > 0) {
            const _lastStmt = _batchBody[_bIdx[_bIdx.length - 1]];
            if (_lastStmt && _lastStmt.kind === "state-decl" && typeof _lastStmt.name === "string") {
              _batchReturnVar = _lastStmt.name;
            }
          }
        }
      }
      // The CPS view the existing handler-body emission consults. For the
      // single-handler case this IS `route.cpsSplit`; for a multi-batch route
      // it is the synthetic per-batch view described above.
      const cpsSplit: any = !_cpsSplit
        ? null
        : (_isMultiBatch
            ? { serverStmtIndices: _batch.serverIndices ?? [], returnVarName: _batchReturnVar }
            : _cpsSplit);

    const handlerName = genVar(`handler_${name}`);
    lines.push(`async function ${handlerName}(_scrml_req) {`);

    lines.push(`  // route.query injection (SPEC §20.3)`);
    lines.push(`  const _scrml_url = new URL(_scrml_req.url, 'http://localhost');`);
    lines.push(`  const route = { query: Object.fromEntries(_scrml_url.searchParams) };`);

    if (authMiddlewareEntry && isStateMutating) {
      lines.push(`  // Auth check (compiler-generated)`);
      lines.push(`  const _scrml_authResult = _scrml_auth_check(_scrml_req);`);
      lines.push(`  if (_scrml_authResult) return _scrml_authResult;`);
    }

    if (authMiddlewareEntry?.csrf === "auto" && isStateMutating) {
      lines.push(`  // CSRF validation (compiler-generated, auth path)`);
      lines.push(`  const _scrml_sessionForCsrf = _scrml_session_middleware(_scrml_req);`);
      lines.push(`  if (!_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)) {`);
      lines.push(`    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {`);
      lines.push(`      status: 403,`);
      lines.push(`      headers: { "Content-Type": "application/json" },`);
      lines.push(`    });`);
      lines.push(`  }`);
    }

    if (useBaselineCsrf) {
      lines.push(`  // Baseline CSRF: get or generate cookie token`);
      lines.push(`  const _scrml_csrf_token = _scrml_ensure_csrf_cookie(_scrml_req);`);
      lines.push(`  // CSRF validation (compiler-generated, baseline double-submit cookie)`);
      lines.push(`  if (!_scrml_validate_csrf(_scrml_req)) {`);
      // GITI-010: mint-on-403 bootstrap — include Set-Cookie so a cookie-less
      // first POST receives a token; client retries once with the new cookie.
      // _scrml_csrf_token is always valid here (existing or freshly-minted by
      // _scrml_ensure_csrf_cookie above). Re-emitting it on valid-cookie
      // requests is a no-op refresh.
      lines.push(`    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {`);
      lines.push(`      status: 403,`);
      lines.push(`      headers: {`);
      lines.push(`        "Content-Type": "application/json",`);
      lines.push(`        "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
      lines.push(`      },`);
      lines.push(`    });`);
      lines.push(`  }`);
    }

    if (useBaselineCsrf) {
      // §8.9.2: implicit per-handler transaction envelope (Tier 1 coalescing).
      // §44.6: transactions deferred to SPEC-ISSUE-018 — use sql.unsafe()
      // for BEGIN/COMMIT/ROLLBACK on the same Bun.SQL connection.
      const _envelope = needsImplicitEnvelope(name);
      // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS server endpoints.
      // For CPS-split functions, wrap the body in an outer try/catch that
      // serializes any thrown exception as a tagged scrml-error variant
      // (per §19.9.1 shape) with HTTP status 500. The CPS client wrapper
      // (emit-functions.ts D1 site) detects this shape and propagates it.
      const _ext4Wrap = !!route.cpsSplit;
      // A9 Ext 5 (§19.9.6): non-monotone CPS batches read the Idempotency-Key
      // header and consult the configured storage backend. On key-hit: return
      // the stored response without re-executing the body. On key-miss:
      // execute the body, store key+result, return. Monotone /
      // machine-intrinsic batches and non-CPS functions skip this layer.
      // Ext 1 M1.5: gated on THIS batch's own monotonicity verdict. In a
      // multi-batch route, only non-monotone batches' stubs pay the dedup tax;
      // for the single-handler case `_batch.monotonicity` is the M1.4
      // conservative-max aggregate (identical to the prior function-level gate).
      const _ext5Dedup = batchNeedsIdempotencyDedup(_batch.monotonicity);
      if (_ext5Dedup) {
        lines.push(`  // A9 Ext 5: idempotency-key dedup middleware (non-monotone CPS batch)`);
        lines.push(`  const _scrml_idem_key = _scrml_req.headers.get('Idempotency-Key');`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    const _scrml_idem_hit = await _scrml_idempotency_lookup(_scrml_idem_key);`);
        lines.push(`    if (_scrml_idem_hit) {`);
        lines.push(`      return new Response(_scrml_idem_hit.response_body, {`);
        lines.push(`        status: _scrml_idem_hit.response_status,`);
        lines.push(`        headers: { "Content-Type": "application/json", "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\` },`);
        lines.push(`      });`);
        lines.push(`    }`);
        lines.push(`  }`);
      }
      if (_ext4Wrap) {
        lines.push(`  // A9-Ext-4 D1: CPS server-side error envelope`);
        lines.push(`  try {`);
      }
      if (_envelope) {
        lines.push(`  // §8.9.2 implicit per-handler transaction`);
        lines.push(`  await _scrml_sql.unsafe("BEGIN DEFERRED");`);
        lines.push(`  try {`);
      }

      lines.push(`  const _scrml_result = await (async () => {`);

      lines.push(`    const _scrml_body = await _scrml_req.json();`);

      for (let i = 0; i < paramNames.length; i++) {
        lines.push(`    const ${paramNames[i]} = _scrml_body[${JSON.stringify(paramNames[i])}];`);
      }

      // §53.9.4: Emit server-side boundary checks for predicated params (baseline CSRF path).
      for (let i = 0; i < params.length; i++) {
        const _pParam = params[i];
        const _pAnnotation = (typeof _pParam === "object" && _pParam !== null) ? (_pParam as any).typeAnnotation : null;
        if (_pAnnotation) {
          const _pParsed = parsePredicateAnnotation(_pAnnotation);
          if (_pParsed) {
            const _pLines = emitServerParamCheck(paramNames[i], _pParsed.predicate, _pParsed.label, name, "    ");
            for (const l of _pLines) lines.push(l);
          }
        }
      }

      // C18 (§38.6): if this server function is declared inside a channel
      // body, inject `broadcast(data)` / `disconnect()` as locals so the
      // user's body can call them. Functions outside any channel scope get
      // no injection — references to broadcast/disconnect there fire
      // E-CHANNEL-004 (or, today, the typer's E-SCOPE-001 fallback).
      const _ownerChannel = channelFnMap.get(name);
      if (_ownerChannel) {
        for (const l of emitBroadcastInjection(_ownerChannel, "    ")) lines.push(l);
      }
      // Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): the V5-strict channel-
      // cell set visible to this function. Empty/`null` when the function
      // is not channel-owned; the emit-logic bare-expr server arm only
      // fires the broadcast-wire interception when this is non-null AND
      // contains the LHS cell name.
      const _channelOwnedCells = _ownerChannel ? channelCellMap.get(_ownerChannel) ?? null : null;

      // S144 (GITI-021 + GITI-022): a single per-function emit-logic opts object,
      // reused across every statement of this server-fn body so a `let`/`const`
      // declared in an outer statement is visible (via the shared `declaredNames`
      // Set) to a reassignment nested inside an if/for/while body. Without the
      // shared Set, each statement got fresh opts and a nested `label = expr`
      // reassignment of an already-declared `label` mis-lowered to `const label =
      // expr` (shadow / redeclare). Seed with the param names so a param
      // reassignment is also recognized as a rebind, and set
      // `insideFunctionBody: true` (mirrors the S34 client fix in
      // emit-functions.ts) so nested `@cell =` reassignments don't leak a
      // `_scrml_init_set` sidecar. `boundary` + `channelOwnedCells` thread the
      // GITI-020 broadcast-wire lowering through nested blocks.
      // A DEDICATED, narrow sink for emit-logic's pre-emit crossing-shadow guard
      // (E-FOREIGN-006, `case "foreign"`). Drained into the live `errors` array
      // after this function's body emits. Scoped ON PURPOSE: threading the broad
      // live `errors` array into emit-logic opts would also surface OTHER arms'
      // previously-swallowed errors (e.g. E-CG-003 match-lowering) that this
      // server-fn path never wired a sink for — a regression. This collector only
      // ever receives E-FOREIGN-006.
      const _foreignCrossingErrors: CGError[] = [];
      const _serverFnOpts = {
        boundary: "server" as const,
        channelOwnedCells: _channelOwnedCells,
        declaredNames: new Set<string>(paramNames),
        insideFunctionBody: true,
        // Issue #1: resolve sibling server-fn calls to in-process peer callables.
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
        foreignCrossingErrors: _foreignCrossingErrors,
      };

      const body: any[] = fnNode.body ?? [];
      // `cpsSplit` is the per-batch CPS view hoisted at the top of the batch
      // loop — for a multi-batch route it carries THIS batch's index set; for
      // the single-handler case it is `route.cpsSplit` verbatim.

      if (cpsSplit) {
        for (const idx of cpsSplit.serverStmtIndices) {
          if (idx < body.length) {
            const stmt = body[idx];
            if (stmt && stmt.kind === "state-decl" && cpsSplit.returnVarName === stmt.name) {
              // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the
              // continuation is `@x = ?{...}.method()`, the AST builder attached
              // a structured `sqlNode` so we can route through emit-logic case
              // "sql" instead of `emitExprField(initExpr, init, ...)` — which
              // would otherwise produce `/_* sql-ref:N *_/` from the SQL-placeholder
              // ExprNode that safeParseExprToNode preprocesses `?{}` into.
              if (stmt.sqlNode && stmt.sqlNode.kind === "sql") {
                const sqlStmt = serverRewriteEmitted(emitLogicNode(stmt.sqlNode, { boundary: "server", channelOwnedCells: _channelOwnedCells, serverFnNames: _serverFnPeerNames, syncPeerCalls: _syncPeerCalls })) ?? "";
                const sqlExpr = sqlStmt.replace(/;\s*$/, "");
                lines.push(`    const _scrml_cps_return = ${sqlExpr};`);
                continue;
              }
              // M-7C-D-12 Track 3: scrml absence sentinel is JS `null` per §42.5/§42.8.
              // The literal string "undefined" used as a fallback default would interpolate
              // the JS `undefined` keyword into compiled output, which is forbidden in scrml-
              // semantics output (OQ-5(a) ratified S90 → use "null" instead).
              const initExpr = emitExprField(stmt.initExpr, stmt.init ?? "null", { mode: "server", serverFnNames: _serverFnPeerNames, syncPeerCalls: _syncPeerCalls });
              lines.push(`    const _scrml_cps_return = ${initExpr};`);
              continue;
            }
            const code = serverRewriteEmitted(emitLogicNode(stmt, _serverFnOpts));
            if (code) {
              for (const line of code.split("\n")) {
                lines.push(`    ${line}`);
              }
            }
          }
        }
        if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
          const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1];
          const lastStmt = body[lastServerIdx];
          if (lastStmt && lastStmt.kind === "state-decl" && lastStmt.name === cpsSplit.returnVarName) {
            lines.push(`    return _scrml_cps_return;`);
          } else if (lastStmt && (lastStmt.kind === "let-decl" || lastStmt.kind === "const-decl")) {
            lines.push(`    return ${lastStmt.name};`);
          } else if (lastStmt && lastStmt.kind === "bare-expr") {
            const emitted = serverRewriteEmitted(emitLogicNode(lastStmt, _serverFnOpts));
            if (emitted) {
              const returnExpr = emitted.replace(/;$/, "");
              lines.push(`    return ${returnExpr};`);
            }
          }
        }
      } else {
        for (const stmt of body) {
          const code = serverRewriteEmitted(emitLogicNode(stmt, _serverFnOpts));
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`    ${line}`);
            }
          }
        }
      }

      // Drain the crossing-shadow guard's narrow sink into the live error stream.
      for (const e of _foreignCrossingErrors) errors.push(e);

      lines.push(`  })();`);
      if (_envelope) {
        lines.push(`  await _scrml_sql.unsafe("COMMIT");`);
      }
      // M-7C-D-12 Track 2 (§57 Wire Format): when the declared return type
      // is `T | not` (absence is a legitimate variant), wrap the success
      // result through `_scrml_wire_encode` so scrml-absence serializes as
      // the canonical envelope `{ __scrml_absent: true }` instead of raw
      // JSON `null`. For pure-`T` returns, keep the legacy raw `?? null`
      // emission — a `null` slipping through there is a bug, NOT scrml-
      // absence, and should not be encoded as such.
      const _retAnnotCsrf = (fnNode as { returnTypeAnnotation?: string }).returnTypeAnnotation;
      const _wireWrapCsrf = returnTypeAllowsAbsence(_retAnnotCsrf);
      // §14.8.9 — redact protected-origin columns at the egress sink BEFORE the
      // §57 wire envelope. `_scrml_result` is THIS route's client-facing result
      // (a peer-helper's internal return is a separate `async function` whose
      // returns are NOT redacted — server-internal data flow keeps the column).
      const _resultBaseCsrf = _protectActive ? "_scrml_protect_redact(_scrml_result)" : "_scrml_result";
      const _resultExprCsrf = _wireWrapCsrf
        ? `_scrml_wire_encode(${_resultBaseCsrf})`
        : `${_resultBaseCsrf} ?? null`;
      // A9 Ext 5: store the success result under the idempotency key so a
      // retry returns the same payload without re-executing the body.
      if (_ext5Dedup) {
        lines.push(`  // A9 Ext 5: store success response under idempotency key`);
        lines.push(`  const _scrml_resp_body = JSON.stringify(${_resultExprCsrf});`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    await _scrml_idempotency_store(_scrml_idem_key, _scrml_resp_body, 200);`);
        lines.push(`  }`);
        lines.push(`  return new Response(_scrml_resp_body, {`);
      } else {
        lines.push(`  return new Response(JSON.stringify(${_resultExprCsrf}), {`);
      }
      lines.push(`    status: 200,`);
      lines.push(`    headers: {`);
      lines.push(`      "Content-Type": "application/json",`);
      lines.push(`      "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
      lines.push(`    },`);
      lines.push(`  });`);
      if (_envelope) {
        lines.push(`  } catch (_scrml_batch_err) {`);
        lines.push(`    await _scrml_sql.unsafe("ROLLBACK");`);
        lines.push(`    throw _scrml_batch_err;`);
        lines.push(`  }`);
      }
      // A9-Ext-4 D1 close: catch any thrown error from the CPS body and
      // serialize as a tagged scrml-error variant (per §19.9.1).
      if (_ext4Wrap) {
        lines.push(`  } catch (_scrml_cps_err) {`);
        lines.push(`    const _scrml_error_payload = (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error)`);
        lines.push(`      ? _scrml_cps_err`);
        lines.push(`      : { __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} } };`);
        lines.push(`    return new Response(JSON.stringify(_scrml_error_payload), {`);
        lines.push(`      status: 500,`);
        lines.push(`      headers: {`);
        lines.push(`        "Content-Type": "application/json",`);
        lines.push(`        "Set-Cookie": \`scrml_csrf=\${_scrml_csrf_token}; Path=/; SameSite=Strict\`,`);
        lines.push(`      },`);
        lines.push(`    });`);
        lines.push(`  }`);
      }
    } else {
      lines.push(`  const _scrml_body = await _scrml_req.json();`);

      for (let i = 0; i < paramNames.length; i++) {
        lines.push(`  const ${paramNames[i]} = _scrml_body[${JSON.stringify(paramNames[i])}];`);
      }

      // §53.9.4: Emit server-side boundary checks for predicated params (non-CSRF path).
      for (let i = 0; i < params.length; i++) {
        const _pParam = params[i];
        const _pAnnotation = (typeof _pParam === "object" && _pParam !== null) ? (_pParam as any).typeAnnotation : null;
        if (_pAnnotation) {
          const _pParsed = parsePredicateAnnotation(_pAnnotation);
          if (_pParsed) {
            const _pLines = emitServerParamCheck(paramNames[i], _pParsed.predicate, _pParsed.label, name, "  ");
            for (const l of _pLines) lines.push(l);
          }
        }
      }

      // C18 (§38.6): broadcast/disconnect injection for channel-owned server
      // functions on the non-CSRF (auth-managed) path. Mirror of the CSRF
      // path injection above.
      const _ownerChannelNonCsrf = channelFnMap.get(name);
      if (_ownerChannelNonCsrf) {
        for (const l of emitBroadcastInjection(_ownerChannelNonCsrf, "  ")) lines.push(l);
      }
      // Bug-5 follow-on to C18 (§38.4): mirror of the CSRF-path cell-set
      // computation above. Threaded into emit-logic opts so the bare-expr
      // server arm lowers channel-cell writes to broadcast frames.
      const _channelOwnedCellsNonCsrf = _ownerChannelNonCsrf ? channelCellMap.get(_ownerChannelNonCsrf) ?? null : null;

      // S144 (GITI-021 + GITI-022): per-function shared emit-logic opts —
      // mirror of the CSRF path above (see comment there).
      // Dedicated narrow E-FOREIGN-006 sink — see the CSRF-path comment.
      const _foreignCrossingErrorsNonCsrf: CGError[] = [];
      const _serverFnOptsNonCsrf = {
        boundary: "server" as const,
        channelOwnedCells: _channelOwnedCellsNonCsrf,
        declaredNames: new Set<string>(paramNames),
        insideFunctionBody: true,
        // Issue #1: resolve sibling server-fn calls to in-process peer callables.
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
        foreignCrossingErrors: _foreignCrossingErrorsNonCsrf,
      };

      const body: any[] = fnNode.body ?? [];
      // `cpsSplit` is the per-batch CPS view hoisted at the top of the batch
      // loop (mirror of the CSRF path above).

      // A9-Ext-4 D1 (2026-05-08): always-`!`-wrap CPS server endpoints (non-CSRF path).
      // Mirror of the useBaselineCsrf=true site above. For CPS-split functions,
      // wrap the body in an outer try/catch that returns a tagged scrml-error
      // shape on any throw (network/SQL/validation/etc).
      const _ext4WrapNonCsrf = !!route.cpsSplit;
      // A9 Ext 5 (§19.9.6): non-monotone CPS batches read the Idempotency-Key
      // header and consult the configured storage backend (mirror of CSRF
      // path above). Ext 1 M1.5: gated on THIS batch's own monotonicity verdict.
      const _ext5DedupNonCsrf = batchNeedsIdempotencyDedup(_batch.monotonicity);
      if (_ext5DedupNonCsrf) {
        lines.push(`  // A9 Ext 5: idempotency-key dedup middleware (non-monotone CPS batch)`);
        lines.push(`  const _scrml_idem_key = _scrml_req.headers.get('Idempotency-Key');`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    const _scrml_idem_hit = await _scrml_idempotency_lookup(_scrml_idem_key);`);
        lines.push(`    if (_scrml_idem_hit) {`);
        lines.push(`      return new Response(_scrml_idem_hit.response_body, {`);
        lines.push(`        status: _scrml_idem_hit.response_status,`);
        lines.push(`        headers: { "Content-Type": "application/json" },`);
        lines.push(`      });`);
        lines.push(`    }`);
        lines.push(`  }`);
      }
      if (_ext4WrapNonCsrf) {
        lines.push(`  // A9-Ext-4 D1: CPS server-side error envelope`);
        lines.push(`  try {`);
      }

      // A9 Ext 5: when dedup is active, wrap body in an inner async IIFE so we
      // can capture the return value and store it under the idempotency key
      // before sending the response.
      // §14.8.9: ALSO wrap when protect is active (and Ext5 isn't already
      // wrapping) so the body's client-facing return is captured into
      // `_scrml_result` for the egress redact below. This is the COMMON
      // protect-bearing read path (protect= auto-injects auth → non-CSRF; a
      // simple read fn is non-CPS/non-Ext5).
      const _wrapResultNonCsrf = _ext5DedupNonCsrf || _protectActive;
      if (_wrapResultNonCsrf) {
        lines.push(`  const _scrml_result = await (async () => {`);
      }

      if (cpsSplit) {
        for (const idx of cpsSplit.serverStmtIndices) {
          if (idx < body.length) {
            const stmt = body[idx];
            if (stmt && stmt.kind === "state-decl" && cpsSplit.returnVarName === stmt.name) {
              // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): mirror of
              // the useBaselineCsrf=true CPS site above. Route SQL-init reactive
              // decls through emit-logic case "sql" via the structured sqlNode.
              if (stmt.sqlNode && stmt.sqlNode.kind === "sql") {
                const sqlStmt = serverRewriteEmitted(emitLogicNode(stmt.sqlNode, { boundary: "server", channelOwnedCells: _channelOwnedCellsNonCsrf, serverFnNames: _serverFnPeerNames, syncPeerCalls: _syncPeerCalls })) ?? "";
                const sqlExpr = sqlStmt.replace(/;\s*$/, "");
                lines.push(`    const _scrml_cps_return = ${sqlExpr};`);
                continue;
              }
              // M-7C-D-12 Track 3: scrml absence sentinel is JS `null` per §42.5/§42.8.
              // The literal string "undefined" used as a fallback default would interpolate
              // the JS `undefined` keyword into compiled output, which is forbidden in scrml-
              // semantics output (OQ-5(a) ratified S90 → use "null" instead).
              const initExpr = emitExprField(stmt.initExpr, stmt.init ?? "null", { mode: "server", serverFnNames: _serverFnPeerNames, syncPeerCalls: _syncPeerCalls });
              lines.push(`    const _scrml_cps_return = ${initExpr};`);
              continue;
            }
            const code = serverRewriteEmitted(emitLogicNode(stmt, _serverFnOptsNonCsrf));
            if (code) {
              for (const line of code.split("\n")) {
                lines.push(`    ${line}`);
              }
            }
          }
        }
        if (cpsSplit.returnVarName && cpsSplit.serverStmtIndices.length > 0) {
          const lastServerIdx = cpsSplit.serverStmtIndices[cpsSplit.serverStmtIndices.length - 1];
          const lastStmt = body[lastServerIdx];
          if (lastStmt && lastStmt.kind === "state-decl" && lastStmt.name === cpsSplit.returnVarName) {
            lines.push(`    return _scrml_cps_return;`);
          } else if (lastStmt && (lastStmt.kind === "let-decl" || lastStmt.kind === "const-decl")) {
            lines.push(`    return ${lastStmt.name};`);
          } else if (lastStmt && lastStmt.kind === "bare-expr") {
            const emitted = serverRewriteEmitted(emitLogicNode(lastStmt, _serverFnOptsNonCsrf));
            if (emitted) {
              const returnExpr = emitted.replace(/;$/, "");
              lines.push(`    return ${returnExpr};`);
            }
          }
        }
      } else {
        for (const stmt of body) {
          const code = serverRewriteEmitted(emitLogicNode(stmt, _serverFnOptsNonCsrf));
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }

      // Drain the crossing-shadow guard's narrow sink into the live error stream.
      for (const e of _foreignCrossingErrorsNonCsrf) errors.push(e);

      // §14.8.9 — protect-only raw path (protect active, no Ext5): close the
      // capture IIFE and return the REDACTED value. This handler returns a raw
      // value (the pre-floor behavior); the redact strips protected-origin
      // columns by descriptor before the value crosses to the client.
      if (_protectActive && !_ext5DedupNonCsrf) {
        lines.push(`  })();`);
        lines.push(`  return _scrml_protect_redact(_scrml_result);`);
      }

      // A9 Ext 5: close the inner IIFE, store the result, return as Response.
      if (_ext5DedupNonCsrf) {
        // M-7C-D-12 Track 2 (§57 Wire Format): same `T | not` envelope-wrap
        // rule as the CSRF path above — apply only when the return type
        // declares absence as a variant. The encoder helper is injected
        // post-emit via `finalEmitted.includes("_scrml_wire_encode(")` (see
        // bottom of generateServerJs), mirroring the structural-eq helper
        // precedent at line ~1296.
        const _retAnnotNonCsrf = (fnNode as { returnTypeAnnotation?: string }).returnTypeAnnotation;
        const _wireWrapNonCsrf = returnTypeAllowsAbsence(_retAnnotNonCsrf);
        // §14.8.9 — redact protected-origin columns at the egress sink (see the
        // CSRF-path note above for why this is client-facing-only).
        const _resultBaseNonCsrf = _protectActive ? "_scrml_protect_redact(_scrml_result)" : "_scrml_result";
        const _resultExprNonCsrf = _wireWrapNonCsrf
          ? `_scrml_wire_encode(${_resultBaseNonCsrf})`
          : `${_resultBaseNonCsrf} ?? null`;
        lines.push(`  })();`);
        lines.push(`  // A9 Ext 5: store success response under idempotency key`);
        lines.push(`  const _scrml_resp_body = JSON.stringify(${_resultExprNonCsrf});`);
        lines.push(`  if (_scrml_idem_key) {`);
        lines.push(`    await _scrml_idempotency_store(_scrml_idem_key, _scrml_resp_body, 200);`);
        lines.push(`  }`);
        lines.push(`  return new Response(_scrml_resp_body, {`);
        lines.push(`    status: 200,`);
        lines.push(`    headers: { "Content-Type": "application/json" },`);
        lines.push(`  });`);
      }

      // A9-Ext-4 D1 close: serialize any thrown error as a tagged scrml-error
      // shape so the client CPS wrapper observes a consistent §19.9.1 envelope.
      if (_ext4WrapNonCsrf) {
        lines.push(`  } catch (_scrml_cps_err) {`);
        lines.push(`    const _scrml_error_payload = (_scrml_cps_err && typeof _scrml_cps_err === 'object' && _scrml_cps_err.__scrml_error)`);
        lines.push(`      ? _scrml_cps_err`);
        lines.push(`      : { __scrml_error: true, type: "CpsError", variant: "ServerError", data: { message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err), fn: ${JSON.stringify(name)} } };`);
        lines.push(`    return new Response(JSON.stringify(_scrml_error_payload), {`);
        lines.push(`      status: 500,`);
        lines.push(`      headers: { "Content-Type": "application/json" },`);
        lines.push(`    });`);
        lines.push(`  }`);
      }
    }

    lines.push(`}`);
    lines.push("");

    // Ext 1 M1.5: route export uses the per-batch name + path. For the
    // single-handler case `_curRouteName`/`_curPath` are the route's own name
    // + path; for a multi-batch route each batch exports under
    // `<routeName>__batch_<i>` at `<path>__batch_<i>`.
    lines.push(`export const ${_curRouteName} = {`);
    lines.push(`  path: ${JSON.stringify(_curPath)},`);
    lines.push(`  method: ${JSON.stringify(httpMethod)},`);
    lines.push(`  handler: ${(_scrml_hasMW || _scrml_handleNode != null) ? `_scrml_mw_wrap(${handlerName})` : handlerName},`);
    lines.push(`};`);
    lines.push("");
    } // end per-batch emit loop (Ext 1 M1.5)
  }

  // ---- §61 `<endpoint>` typed-inbound route handlers (W4) ------------------
  // Emitted BEFORE the peer-callable loop below so an arm body's server-fn call
  // target registers into `_calledPeerNames` (the handler's `await dispatch(...)`
  // would otherwise reference an undefined symbol). Each `<endpoint>` decodes the
  // request body via `parseVariant` (§61.3), dispatches over the `accepts=` enum
  // (§61.4), envelopes the typed arm result as JSON (§61.5), and registers at the
  // author-stable `path=`/`method=` (§61.7). NO CSRF block (§61.7 — CSRF-exempt).
  if (_hasEndpointDecls) {
    // The arm value-return envelope (§61.5). The `:`-shorthand / code-default
    // body is lowered as a server VALUE-expression (REUSE `emitExprField` — do
    // NOT hand-roll), `await`-ed (the target may be sync or async), and its typed
    // return value serialized DIRECTLY as the JSON success body — the author owns
    // the exact wire by returning the exact shape (JSON-RPC is a convention via
    // the return value, NOT a baked-in mode). A self-closing `<Variant/>` arm is
    // a no-op handler → default-success with no body (204 No Content).
    const emitEndpointArmEnvelope = (arm: any, epDecl: any): string[] => {
      const out: string[] = [];
      const bodyRaw = typeof arm?.bodyRaw === "string" ? arm.bodyRaw.trim() : "";
      if (arm?.bodyForm === "self-closing" || bodyRaw === "") {
        out.push(`return new Response(null, { status: 204 });`);
        return out;
      }
      const expr = emitExprField(null, bodyRaw, {
        mode: "server",
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
      } as unknown as EmitExprContext);
      // §61.10 — a multi-statement bare body is NOT yet lowered (a future wave).
      // The three SUPPORTED forms (the `:`-shorthand single-expression arm, the
      // single-expression bare body, and the self-closing 204 arm handled above)
      // each lower to ONE value-expression the compiler envelopes as the JSON
      // response (§61.5). A 2+-statement bare body cannot be a single expression,
      // so the lowered `expr` is not parsable as `await (<expr>)` — which, left
      // unchecked, trips the generic `E-CODEGEN-INVALID-JS` emit gate with a
      // cryptic "compiler defect" message the adopter cannot act on. Detect the
      // multi-statement case HERE (the lowered expr does not parse as a single
      // JS expression consuming the whole string — reusing the emit gate's acorn)
      // and fire the clean, adopter-actionable named diagnostic instead. A single
      // value-expression that legitimately spans multiple source lines parses as
      // one expression and is unaffected.
      if (!isSingleJsExpression(expr)) {
        const _vLabel = arm?.isWildcard ? "_" : (typeof arm?.variantName === "string" ? arm.variantName : "?");
        const _epPath = typeof epDecl?.path === "string" ? epDecl.path : "?";
        const _epMethod = typeof epDecl?.method === "string" ? epDecl.method : "?";
        errors.push(new CGError(
          "E-ENDPOINT-MULTI-STATEMENT-ARM",
          `E-ENDPOINT-MULTI-STATEMENT-ARM: the <${_vLabel}> arm of <endpoint path="${_epPath}" method="${_epMethod}"> ` +
          `has a multi-statement body. <endpoint> arm bodies are currently a single value-expression (the value the ` +
          `compiler envelopes as the JSON response, §61.5); multi-statement handler bodies are a future wave (SPEC §61 ` +
          `limits). Resolution: reduce the arm to a single expression, or extract the logic into a server function and ` +
          `call it from the arm (e.g. \`<${_vLabel} : computeResult(...)>\`).`,
          (arm?.span ?? epDecl?.span ?? {}),
          "error",
        ));
        // Emit a parseable, inert placeholder so this arm does NOT additionally
        // trip the generic E-CODEGEN-INVALID-JS gate (the compile aborts on the
        // named error above; no artifact is written).
        return [`// §61.10 multi-statement bare body not lowered — see E-ENDPOINT-MULTI-STATEMENT-ARM.`];
      }
      out.push(`const _scrml_result = await (${expr});`);
      // §14.8.9 — the §61 `<endpoint>` JSON envelope is a client egress; redact
      // at the sink (the arm value's `?{}` was protect-tagged at lowering).
      if (_protectActive) {
        out.push(`return new Response(JSON.stringify(_scrml_protect_redact(_scrml_result)), {`);
      } else {
        out.push(`return new Response(JSON.stringify(_scrml_result), {`);
      }
      out.push(`  status: 200,`);
      out.push(`  headers: { "Content-Type": "application/json" },`);
      out.push(`});`);
      return out;
    };

    // §61.3 / §61.5 — one shared decode-failure envelope helper (minimal runtime,
    // the §60.7 LIMIT-PRIMITIVES boundary applied to the inbound edge). A
    // `parseVariant` `::ParseError` → 400 + the compiler-owned structured error
    // `{ error: { kind, message } }` (kind ∈ the §41.13 ParseError family).
    lines.push(`// --- §61.3/§61.5: <endpoint> request-decode failure envelope ---`);
    lines.push(`function _scrml_endpoint_decode_error(_scrml_decoded) {`);
    lines.push(`  const _scrml_data = _scrml_decoded.data || {};`);
    lines.push(`  let _scrml_message;`);
    lines.push(`  switch (_scrml_decoded.variant) {`);
    lines.push(`    case "MissingDiscriminator": _scrml_message = "request body is missing the variant discriminator field 'tag'"; break;`);
    lines.push(`    case "UnknownVariant": _scrml_message = "request body names an unknown variant '" + _scrml_data.tag + "'"; break;`);
    lines.push(`    case "InvalidPayload": _scrml_message = "request payload field '" + _scrml_data.field + "' is invalid: " + _scrml_data.reason; break;`);
    lines.push(`    default: _scrml_message = "request body is malformed: " + _scrml_data.reason;`);
    lines.push(`  }`);
    lines.push(`  return new Response(JSON.stringify({ error: { kind: _scrml_decoded.variant, message: _scrml_message } }), {`);
    lines.push(`    status: 400,`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");

    for (const _epDecl of _endpointDecls) {
      // The resolved `accepts=` EnumType the W3 typer annotated onto the decl
      // node (mirrors `<api>`'s `responseEnum`). A non-enum / unresolved
      // `accepts=` already fired a hard typer error (E-ENDPOINT-ACCEPTS-NOT-ENUM /
      // E-TYPE-UNKNOWN-NAME) — there is nothing decodable, so skip the emit.
      const _epEnum = (_epDecl as { acceptsEnum?: ParseVariantEnumLike }).acceptsEnum;
      if (!_epEnum || _epEnum.kind !== "enum") continue;
      const _epPath = typeof _epDecl.path === "string" ? _epDecl.path : null;
      const _epMethod = typeof _epDecl.method === "string" ? _epDecl.method : null;
      // A missing path/method already fired a W2 parse error — skip the emit.
      if (!_epPath || !_epMethod) continue;
      const _epId = _epDecl.id;
      const _epHandler = `_scrml_endpoint_${_epId}`;
      const _epRoute = `__ri_route_endpoint_${_epId}`;
      const _epArms: any[] = Array.isArray(_epDecl.arms) ? _epDecl.arms : [];

      // Register every arm-body server-fn call target as a peer so the loop below
      // emits it (otherwise `await dispatch(...)` references an undefined symbol).
      // Pure fns are emitted by the value-export path; only server fns need this.
      for (const _arm of _epArms) {
        if (_arm && typeof _arm.bodyRaw === "string" && _arm.bodyRaw.length > 0) {
          for (const _c of extractCalleeNames(_arm.bodyRaw)) {
            if (_serverFnPeerNames.has(_c)) _calledPeerNames.add(_c);
          }
        }
      }

      // §61.3 — synthesize the `parseVariant` request-decode IIFE against the
      // resolved `accepts=` enum (REUSE emit-parse-variant — NO new decoder).
      const _epDecode = emitParseVariantDecodeIIFE(_epEnum, "_scrml_body");

      lines.push(`// --- §61 <endpoint> ${_epMethod} ${_epPath} (accepts=${_epEnum.name}) ---`);
      lines.push(`async function ${_epHandler}(_scrml_req) {`);
      lines.push(`  const _scrml_body = await _scrml_req.json();`);
      lines.push(`  // §61.3 — decode the request body against accepts= (parseVariant §41.13).`);
      lines.push(`  const _scrml_decoded = ${_epDecode};`);
      lines.push(`  // §61.3 — a ::ParseError decode failure → the compiler-owned 400 envelope.`);
      lines.push(`  if (_scrml_decoded && _scrml_decoded.__scrml_error) {`);
      lines.push(`    return _scrml_endpoint_decode_error(_scrml_decoded);`);
      lines.push(`  }`);
      lines.push(`  // The decoded value is a bare string (unit variant) or { variant, data }.`);
      lines.push(`  const _scrml_tag = typeof _scrml_decoded === "string" ? _scrml_decoded : _scrml_decoded.variant;`);
      lines.push(`  // §61.4 — dispatch over the exhaustive arms (one per accepts= variant).`);
      lines.push(`  switch (_scrml_tag) {`);

      let _wildcardArm: any = null;
      for (const _arm of _epArms) {
        if (!_arm || typeof _arm !== "object") continue;
        if (_arm.isWildcard) { _wildcardArm = _arm; continue; }
        const _vName = _arm.variantName;
        if (typeof _vName !== "string") continue;
        lines.push(`    case ${JSON.stringify(_vName)}: {`);
        // §51.0.B.1 / §18.0.1 payload binding — positionally bind each arm local
        // to the matched variant's declared payload field (the decoded payload
        // variant carries `.data` keyed by the declared field name).
        const _vDef = _epEnum.variants.find((v) => v.name === _vName);
        const _declaredFields: string[] =
          (_vDef && _vDef.payload && typeof (_vDef.payload as any).keys === "function")
            ? Array.from((_vDef.payload as Map<string, unknown>).keys())
            : [];
        const _bindings = parseArmBindings(_arm.payloadBindingsRaw);
        for (let _bi = 0; _bi < _bindings.length; _bi++) {
          const _b = _bindings[_bi];
          if (_b.discard || !_b.local) continue;
          const _field = _b.field ?? _declaredFields[_bi];
          if (!_field) continue;
          lines.push(`      const ${_b.local} = _scrml_decoded.data[${JSON.stringify(_field)}];`);
        }
        for (const _l of emitEndpointArmEnvelope(_arm, _epDecl)) lines.push(`      ${_l}`);
        lines.push(`    }`);
      }

      // default: — the wildcard `<_>` arm if present, else a defensive 400
      // (exhaustiveness is compile-enforced §61.4 and parseVariant already
      // filtered unknown tags §61.3, so a non-wildcard endpoint never reaches a
      // real default — the arm is kept for runtime totality).
      lines.push(`    default: {`);
      if (_wildcardArm) {
        for (const _l of emitEndpointArmEnvelope(_wildcardArm, _epDecl)) lines.push(`      ${_l}`);
      } else {
        lines.push(`      return new Response(JSON.stringify({ error: { kind: "UnknownVariant", message: "endpoint received an unhandled variant '" + _scrml_tag + "'" } }), {`);
        lines.push(`        status: 400,`);
        lines.push(`        headers: { "Content-Type": "application/json" },`);
        lines.push(`      });`);
      }
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`}`);
      lines.push("");

      // §61.6 / §61.7 — register the server route-handler at the author-stable
      // `path=` for `method=` (verbatim — never a compiler-internal hash). The
      // record SHAPE matches the route-collection regex (~`routeNameRe` below)
      // so the WinterCG `routes` / `fetch` aggregate auto-collects it.
      lines.push(`export const ${_epRoute} = {`);
      lines.push(`  path: ${JSON.stringify(_epPath)},`);
      lines.push(`  method: ${JSON.stringify(_epMethod)},`);
      lines.push(`  handler: ${_epHandler},`);
      lines.push(`};`);
      lines.push("");
    }
  }

  // ---- Issue #1 (parent scrmlTS): emit in-process peer callables ----
  // For every "simple" server fn that some server-fn body actually calls (per the
  // `_calledPeerNames` AST call-graph scan above), emit a plain module-scope
  // `async function <name>(<params>) { <body> }` so a sibling's `await <name>(...)`
  // resolves in-process instead of referencing the undefined `<name>` symbol.
  // Gating on real call-graph usage keeps non-composing programs byte-identical
  // to the pre-fix output, and — unlike grepping the emitted handler text — does
  // not couple peer emission to the exact way a call site lowers.
  // Collision guard (Defect A / E-CG-016): a peer is emitted as an UNMANGLED
  // `async function <name>`, so a server fn named like a compiler-synthesized
  // top-level binding — `routes` / `fetch` (the WinterCG aggregate + handler), a
  // page-local enum, a module value-export (`export const`/`export function`,
  // emitted AFTER this loop), or anything already declared in the assembled body
  // (e.g. the `import { SQL } from "bun"` handle) — would emit the same identifier
  // twice and either fail the emit-validation gate with a cryptic "compiler
  // defect" SyntaxError or get silently dropped by the value-export already-
  // declared guard. Detect the clash up front and fail closed with the adopter-
  // actionable E-CG-016, skipping the peer so the bundle stays single-declared.
  // (`topLevelBindingExists` was also taught to see `async function`, so the
  // enum-injection guard below catches the reverse direction.)
  if (_calledPeerNames.size > 0) {
    const _reservedServerBindings = new Set<string>(["routes", "fetch"]);
    for (const _decl of ((fileAST as any).typeDecls ?? (fileAST as any).ast?.typeDecls ?? [])) {
      if (_decl && _decl.kind === "type-decl" && _decl.typeKind === "enum" && typeof _decl.name === "string") {
        _reservedServerBindings.add(_decl.name);
      }
    }
    // Module value-export names that collide with a peer (Cand5). Only a
    // plain-value `export const X = <value>` is emitted as a top-level binding by
    // `emitModuleValueExportLines` (AFTER this loop, so `_emittedBeforePeers`
    // can't see it) AND can clash with a peer. Exported FUNCTIONS never collide:
    // a pure exported fn is not a server fn (not a peer), and an exported SERVER
    // fn (body does `?{}`) is skipped by the value-export path — reserving those
    // would false-positive (e.g. trucking-dispatch's `driverNextStates`). Markup
    // (`<…>` = component) and `?{}` (server-only) const inits are likewise not
    // emitted as runtime values, so we mirror those skips.
    const _collectExportNames = (nodeList: any[]): void => {
      for (const node of (Array.isArray(nodeList) ? nodeList : [])) {
        if (!node || typeof node !== "object") continue;
        if (node.kind === "logic" && Array.isArray(node.body)) {
          for (const stmt of node.body) {
            if (stmt && stmt.kind === "export-decl" && stmt.exportKind === "const"
                && typeof stmt.exportedName === "string") {
              const _m = String(stmt.raw ?? "").match(/=\s*([\s\S]+)$/);
              const _init = _m ? _m[1].trim() : "";
              if (_init && !_init.startsWith("<") && !_init.includes("?{")) {
                _reservedServerBindings.add(stmt.exportedName);
              }
            }
          }
        }
        if (Array.isArray(node.children)) _collectExportNames(node.children);
      }
    };
    _collectExportNames(getNodes(fileAST));
    const _emittedBeforePeers = lines.join("\n");
    for (const _peerName of _calledPeerNames) {
      const _peerInfo = _peerCallableInfo.get(_peerName);
      if (!_peerInfo) continue;
      if (_reservedServerBindings.has(_peerName) || topLevelBindingExists(_emittedBeforePeers, _peerName)) {
        errors.push(new CGError(
          "E-CG-016",
          `E-CG-016: server function \`${_peerName}\` collides with a compiler-injected ` +
          `top-level server-bundle binding of the same name (e.g. the \`routes\` / \`fetch\` ` +
          `WinterCG exports, a page-local enum, or the \`import { SQL } from "bun"\` runtime ` +
          `handle). The generated server bundle cannot declare \`${_peerName}\` twice — it is ` +
          `both this in-process server-fn callable and the reserved binding. Resolution: rename ` +
          `the server function to a name that does not clash with a compiler-reserved server binding.`,
          (_peerInfo.fnNode.span ?? {}),
          "error",
        ));
        continue;
      }
      const _peerOpts = {
        boundary: "server" as const,
        channelOwnedCells: null,
        declaredNames: new Set<string>(_peerInfo.paramNames),
        insideFunctionBody: true,
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
      };
      const _peerBodyLines: string[] = [];
      for (const stmt of (_peerInfo.fnNode.body ?? [])) {
        const code = serverRewriteEmitted(emitLogicNode(stmt, _peerOpts));
        if (code) {
          for (const line of code.split("\n")) _peerBodyLines.push(`  ${line}`);
        }
      }
      lines.push(`// Issue #1: in-process peer callable for server function "${_peerName}"`);
      lines.push(`async function ${_peerName}(${_peerInfo.paramNames.join(", ")}) {`);
      // F4 (documented limitation per upstream review): a server-mode `@cell`
      // read lowers to `_scrml_body["cell"]`. The HTTP handler binds `_scrml_body`
      // from the request, but an in-process peer call has no request — so we bind
      // an empty `_scrml_body = {}` fallback (mirrors the §38.6.1 onserver-handler
      // precedent) to avoid a ReferenceError. This does NOT diverge from the HTTP
      // path in practice: the client wire protocol sends only the fn's PARAMS
      // (which the peer receives as named arguments here), never arbitrary
      // reactive cells — so a non-param `@cell` read is `undefined` on BOTH paths.
      // If a future protocol change starts shipping reactive cells in the request
      // body, a peer reading such a cell would need either a diagnostic or
      // explicit parameter-passing; flagged here so that change can't slip by
      // silently.
      if (_peerBodyLines.some((l) => l.includes("_scrml_body"))) {
        lines.push(`  const _scrml_body = {};`);
      }
      for (const l of _peerBodyLines) lines.push(l);
      lines.push(`}`);
      lines.push("");
    }
  }

  // Issue #1 — drain the bare-peer-call record. emit-expr recorded every sibling
  // server-fn call it lowered to a BARE `<peer>()` because the position was not
  // awaitable (a synchronous callback body or a parameter default). Each is a
  // bug — a server fn returns a Promise — so raise E-SERVER-FN-IN-SYNC-CALLBACK.
  // This runs AFTER both the handler loop and the peer-body loop, so it captures
  // sync-callback peer calls anywhere a server-fn body was emitted. (Block-body
  // callbacks are raw escape-hatch text emit-expr never sees; those were already
  // diagnosed by the AST walk above.)
  {
    const _seenSync = new Set<string>();
    for (const _spc of _syncPeerCalls) {
      const _sp = (_spc.span ?? {}) as { start?: number };
      const _key = `${_spc.name}@${_sp.start ?? -1}`;
      if (_seenSync.has(_key)) continue;
      _seenSync.add(_key);
      _diagSyncCb(_spc.name, _spc.span);
    }
  }

  // §8.11 Mount-Hydration Coalescing — synthetic __mountHydrate route.
  // Emitted iff ≥2 `server @var` decls carry callable initExprs. Body awaits
  // all loaders in parallel (Promise.all) and returns a keyed JSON object.
  // Tier 1 coalescing (§8.9.2) applies automatically when the loaders share
  // this handler (sibling DGNodes) — see §8.11.2.
  if (_needsMountHydrate) {
    const mhHandlerName = "_scrml_mountHydrate_handler";
    const mhRouteName = "_scrml_route___mountHydrate";
    lines.push("// --- §8.11 synthetic __mountHydrate route (compiler-generated) ---");
    lines.push(`async function ${mhHandlerName}(_scrml_req) {`);
    // Build the list of (name, server-rewritten initExpr) pairs.
    const mhEntries: Array<{ name: string; expr: string }> = [];
    for (const decl of _mhCallableDecls) {
      const name = decl.name as string;
      // M-7C-D-12 Track 3: fallback uses "null" not "undefined" per §42.5/§42.8.
      const expr = emitExprField((decl as any).initExpr, (decl as any).init ?? "null", { mode: "server" });
      mhEntries.push({ name, expr });
    }
    // Parallel await via Promise.all — matches §8.11.2 intent.
    lines.push(`  const [${mhEntries.map((_, i) => `_scrml_mh_v${i}`).join(", ")}] = await Promise.all([`);
    for (const e of mhEntries) {
      lines.push(`    Promise.resolve(${e.expr}),`);
    }
    lines.push(`  ]);`);
    lines.push(`  return new Response(JSON.stringify({`);
    mhEntries.forEach((e, i) => {
      lines.push(`    ${JSON.stringify(e.name)}: _scrml_mh_v${i},`);
    });
    lines.push(`  }), {`);
    lines.push(`    status: 200,`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    lines.push(`export const ${mhRouteName} = {`);
    lines.push(`  path: "/__mountHydrate",`);
    lines.push(`  method: "POST",`);
    lines.push(`  handler: ${mhHandlerName},`);
    lines.push(`};`);
    lines.push("");
  }

  // §52.3.5 / §52.6.1 — synthetic /__serverLoad/<var> route per Tier-1
  // server-authority TYPE instance. The handler runs the read-authority
  // `SELECT * FROM <table>` server-side and returns the rows as JSON; the
  // client-side load IIFE (emit-sync emitServerAuthorityLoad) POSTs to it on
  // mount and lands the rows via the ordinary reactive set. The WRITE is the
  // developer's own `?{}` server fn (§52.6.2, Q1=C) — no write route.
  for (const inst of _serverAuthorityInstances) {
    const varName = inst.name as string;
    const table = (inst as any).serverAuthorityTable as string;
    const slHandler = `_scrml_serverLoad_${varName}_handler`;
    const slRoute = `_scrml_route___serverLoad_${varName}`;
    // The table name comes from a `table="…"` literal in the type-decl; it is a
    // SQL identifier, not user input, so it is interpolated directly. (The
    // recogniser only accepts an opener `table=STRING`; there is no bound param.)
    lines.push(`// --- §52.6.1 server-authority load route for < ${varName} > (SELECT * FROM ${table}) ---`);
    lines.push(`async function ${slHandler}(_scrml_req) {`);
    // §14.8.9 / §52.8 — the SSR `/__serverLoad` prerender payload is a CLIENT
    // egress and SHALL apply the same protected-column redaction (else a
    // protected column ships in the first-paint payload, the W-AUTH-002 leak).
    // This `SELECT * FROM <table>` is hand-emitted (not via rewriteSqlRefs), so
    // tag `_scrml_rows` inline with the table's protected columns, then redact.
    const _slProtCols = _protectActive ? _protectCtx.protectedByTable.get(table) : undefined;
    if (_slProtCols && _slProtCols.size > 0) {
      lines.push(`  const _scrml_rows = _scrml_protect_tag(await _scrml_sql\`SELECT * FROM ${table}\`, ${JSON.stringify([..._slProtCols])});`);
      lines.push(`  return new Response(JSON.stringify(_scrml_protect_redact(_scrml_rows)), {`);
    } else {
      lines.push(`  const _scrml_rows = await _scrml_sql\`SELECT * FROM ${table}\`;`);
      lines.push(`  return new Response(JSON.stringify(_scrml_rows), {`);
    }
    lines.push(`    status: 200,`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    lines.push(`export const ${slRoute} = {`);
    lines.push(`  path: "/__serverLoad/${varName}",`);
    lines.push(`  method: "POST",`);
    lines.push(`  handler: ${slHandler},`);
    lines.push(`};`);
    lines.push("");
  }

  // §52.6.5 Pattern C (S216 disposition A) — synthetic /__serverLoad/<var>
  // route per Tier-2 `<var server> = ?{…}` decl whose inline `?{}` IS the mount
  // load. Unlike the Tier-1 path above (a FIXED `SELECT * FROM <table>`), this
  // runs the cell's ACTUAL `?{}` query server-side, lowered through the
  // canonical §44 SQL emitter (emitLogicNode case "sql" — same path a `?{}`
  // inside a server fn body takes), so the `.get()`/`.all()` terminator and any
  // bound params are handled identically. Param-free only (the filter already
  // excludes param-bearing forms); the query never leaks to the client (the
  // route is SERVER-only, and the client fetch POSTs an empty body).
  for (const decl of _patternCLoadDecls) {
    const varName = decl.name as string;
    const sqlNode = (decl as any).sqlNode;
    const slHandler = `_scrml_serverLoad_${varName}_handler`;
    const slRoute = `_scrml_route___serverLoad_${varName}`;
    // Lower the cell's `?{}` to its server-side form (e.g.
    // `(await _scrml_sql`SELECT …`)[0] ?? null;` for `.get()`).
    const sqlExpr = (serverRewriteEmitted(
      emitLogicNode(sqlNode, { boundary: "server" }),
    ) ?? "").replace(/;\s*$/, "");
    lines.push(`// --- §52.6.5 Pattern C server-cell load route for < ${varName} > (inline ?{}) ---`);
    lines.push(`async function ${slHandler}(_scrml_req) {`);
    // sqlExpr already begins with `await` (the §44 lowering emits
    // `(await _scrml_sql`…`)[0] ?? null` for `.get()`, `await _scrml_sql`…`` for
    // `.all()`); do NOT double-await.
    lines.push(`  const _scrml_result = ${sqlExpr};`);
    // §14.8.9 — SSR `/__serverLoad` Pattern-C payload is a client egress. The
    // `?{}` was lowered through rewriteSqlRefs (protect-tagged when it carries a
    // protected column); redact at the sink so the descriptor is honored.
    if (_protectActive) {
      lines.push(`  return new Response(JSON.stringify(_scrml_protect_redact(_scrml_result)), {`);
    } else {
      lines.push(`  return new Response(JSON.stringify(_scrml_result), {`);
    }
    lines.push(`    status: 200,`);
    lines.push(`    headers: { "Content-Type": "application/json" },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    lines.push(`export const ${slRoute} = {`);
    lines.push(`  path: "/__serverLoad/${varName}",`);
    lines.push(`  method: "POST",`);
    lines.push(`  handler: ${slHandler},`);
    lines.push(`};`);
    lines.push("");
  }

  // Bug 2b (channel-codegen-fixes-2026-06-12): onserver:* channel attribute
  // handlers as PLAIN callable server functions. Per §38.6.1 / §38.7 these are
  // invoked by name from the WS `_scrml_ws_handlers` message/lifecycle path
  // (`message(ws, raw) { ...; handleMessage(msg); }`), NOT from an HTTP RPC
  // route — so they emit as ordinary `function name(params) { ... }` here with
  // `broadcast()`/`disconnect()` injected (same as a channel-owned server fn),
  // and NO route handler / client fetch stub (route was suppressed in RI). The
  // body's channel-cell writes lower to the broadcast wire via emit-logic's
  // server-arm bare-expr handling (the `channelOwnedCells` opt), so the
  // function syncs to subscribers exactly as a channel publisher does.
  if (channelWsHandlerFns.length > 0) {
    for (const { fnNode, route } of channelWsHandlerFns) {
      const name: string = fnNode.name ?? "anon";
      const params: any[] = fnNode.params ?? [];
      const wsParamNames: string[] = params.map((p: any, i: number) =>
        typeof p === "string" ? p.split(":")[0].trim() : (p.name ?? `_scrml_arg_${i}`)
      );
      lines.push(`// §38.6.1 onserver:* handler "${name}" — invoked from _scrml_ws_handlers (no HTTP route)`);
      lines.push(`function ${name}(${wsParamNames.join(", ")}) {`);

      const _wsOwnerChannel = channelFnMap.get(name);
      if (_wsOwnerChannel) {
        for (const l of emitBroadcastInjection(_wsOwnerChannel, "  ")) lines.push(l);
      }
      const _wsChannelOwnedCells = _wsOwnerChannel ? channelCellMap.get(_wsOwnerChannel) ?? null : null;
      const _wsFnOpts = {
        boundary: "server" as const,
        channelOwnedCells: _wsChannelOwnedCells,
        declaredNames: new Set<string>(wsParamNames),
        insideFunctionBody: true,
        // Issue #1: resolve sibling server-fn calls to in-process peer callables.
        serverFnNames: _serverFnPeerNames,
        syncPeerCalls: _syncPeerCalls,
      };
      const wsBody: any[] = fnNode.body ?? [];
      const _wsBodyLines: string[] = [];
      for (const stmt of wsBody) {
        const code = serverRewriteEmitted(emitLogicNode(stmt, _wsFnOpts));
        if (code) {
          for (const line of code.split("\n")) _wsBodyLines.push(`  ${line}`);
        }
      }
      // Server-mode `@cell` reads lower to `_scrml_body["cell"]` (the HTTP
      // request-body shape). A WS-invoked handler has NO request body, so define
      // an empty fallback to avoid a bare `_scrml_body` ReferenceError. NOTE:
      // server-side authoritative channel-cell READ state is SPEC-silent (§38.4
      // defines the client-held + `__sync`-wire model, not a server cell store),
      // so a handler that READS a channel cell resolves to the empty default.
      // The canonical §38.6.1 onserver:message form (broadcast from the parsed
      // message, no channel-cell read) is unaffected. See DEFERRED note in the
      // change-id progress log.
      if (_wsBodyLines.some(l => l.includes("_scrml_body"))) {
        lines.push(`  const _scrml_body = {};`);
      }
      for (const l of _wsBodyLines) lines.push(l);
      lines.push(`}`);
      lines.push("");
    }
  }

  // Channel WebSocket infrastructure (§35)
  if (channelNodes.length > 0) {
    const wsHandlerLines = emitChannelWsHandlers(channelNodes, errors, filePath ?? "");
    for (const l of wsHandlerLines) lines.push(l);

    for (const chNode of channelNodes) {
      const chServerLines = emitChannelServerJs(
        chNode,
        errors,
        filePath ?? "",
        !!authMiddlewareEntry,
      );
      for (const l of chServerLines) lines.push(l);
    }
  }

  // S35 insight 22 — per-file WinterCG fetch handler + aggregate `routes`
  // array. Scans the just-emitted route manifest exports and appends:
  //   export const routes = [__ri_route_X, ...];
  //   export async function fetch(request) { ... }
  // Returns null on no match so the output composes with other handlers
  // via `scrml(req) ?? myApi(req)`. Does not touch CSRF inlining — Move 1
  // of Q4, CSRF stays per-handler until the scrml-server wrapper ships.
  const emitted = lines.join("\n");
  const routeNameRe = /^export const (_scrml_[A-Za-z0-9_]+|__ri_route_[A-Za-z0-9_]+) = \{\s*\n\s*path:/gm;
  const collected: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = routeNameRe.exec(emitted)) !== null) {
    collected.push(m[1]);
  }
  if (collected.length > 0) {
    lines.push("// --- S35 insight 22: aggregate routes + WinterCG fetch handler ---");
    lines.push(`export const routes = [${collected.join(", ")}];`);
    lines.push("");
    lines.push("export async function fetch(request) {");
    lines.push("  const url = new URL(request.url, 'http://localhost');");
    lines.push("  for (const r of routes) {");
    lines.push("    if (r.path === url.pathname && r.method === request.method) {");
    lines.push("      return r.handler(request);");
    lines.push("    }");
    lines.push("  }");
    lines.push("  return null;");
    lines.push("}");
    lines.push("");
  }

  // ss1 (g-route-mis-inference-server-called-pure-helper) — emit the module's
  // exported VALUE bindings (constants + pure functions) as native ESM exports,
  // so a sibling SERVER bundle's by-name import (`import { rolePath, ... } from
  // "./models/auth.server.js"`) resolves at runtime. Appended to `lines` HERE
  // (after the route handlers + `routes`/`fetch`, before `finalEmitted` is first
  // joined) so the helper-inline scans below (`_scrml_structural_eq` / wire / log
  // / SQL) also see references the exported helpers introduce. Additive — the
  // route content stays byte-stable; the mangling counter is snapshotted +
  // restored so no OTHER file's `_scrml_*_<N>` suffix shifts.
  {
    const _veSnapshot = getVarCounter();
    const _veLines = emitModuleValueExportLines(fileAST, filePath, lines.join("\n"));
    setVarCounter(_veSnapshot);
    for (const _l of _veLines) lines.push(_l);
  }

  // §61 <endpoint> private-arm reachability — retain endpoint-only private server
  // helpers. A `<FleetStatus : fleetStatus()>` arm (§61.2) calls a LOCAL pure
  // `fn` the handler runs server-side; without this it tree-shakes out and the
  // handler ReferenceErrors. Emitted AFTER the value-export block so the
  // helper-inline scans below also see any `_scrml_structural_eq` / `not` the
  // helper bodies introduce; the var-counter is snapshotted/restored (additive —
  // no other file's `_scrml_*_<N>` suffix shifts). Server-ONLY: the matching
  // .client.js skip is RouteMap.endpointClientSkipIds (emit-functions, §61.6).
  if (
    _hasEndpointDecls &&
    routeMap.endpointServerHelperIds &&
    routeMap.endpointServerHelperIds.size > 0
  ) {
    const _epSnapshot = getVarCounter();
    const _epHelperLines = emitEndpointServerHelperLines(
      fnNodes,
      filePath,
      routeMap.endpointServerHelperIds,
      lines.join("\n"),
    );
    setVarCounter(_epSnapshot);
    for (const _l of _epHelperLines) lines.push(_l);
  }

  // A9 Ext 5 (§19.9.6): idempotency-key storage helper inlining. When
  // `_scrml_idempotency_lookup(` / `_scrml_idempotency_store(` callsites
  // survive in the server output (they appear iff a CPS-eligible function
  // was classified non-monotone by Stage 5.5), inline the runtime helpers
  // at the top of the server module. SQL backend default; Bun.SQL via
  // _scrml_sql tag. Mirror of structural-equality inliner below; runs
  // FIRST so it's hoisted above the structural-equality block (no
  // ordering dependency, but cleaner).
  let finalEmitted = lines.join("\n");
  if (finalEmitted.includes("_scrml_idempotency_lookup(") || finalEmitted.includes("_scrml_idempotency_store(")) {
    // S79 audit fix C.1: idempotency TTL is overridable via
    // <program idempotency-ttl="..."> attribute. Default 24h (Stripe
    // convention; pre-S79 hardcoded value, preserved as default).
    // Accepted shapes: bare millis ("3600000"), or duration string with
    // ms/s/m/h/d unit suffix ("1h", "7d", "300s"). Invalid → fall back
    // to default with no diagnostic (current scope: silent fallback;
    // future v2 may add a W-MIDDLEWARE-TTL-INVALID lint).
    const ttlRaw = (middlewareConfig as { idempotencyTTL?: string | null } | null)
      ?.idempotencyTTL ?? null;
    const ttlMs = parseIdempotencyTtl(ttlRaw);
    const ttlComment = ttlRaw && ttlMs !== null
      ? `// TTL ${ttlMs}ms (overridden via <program idempotency-ttl=${JSON.stringify(ttlRaw)}>). Lazy eviction on read.`
      : "// TTL 24h (Stripe convention). Lazy eviction on read.";
    const ttlLine = ttlMs !== null
      ? `const _SCRML_IDEMPOTENCY_TTL_MS = ${ttlMs};`
      : "const _SCRML_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;";
    const helper = [
      "",
      "// --- A9 Ext 5: idempotency-key storage helpers (SPEC §19.9.6) ---",
      "// Backend: SQL shadow table _scrml_idempotency_keys via Bun.SQL (_scrml_sql).",
      ttlComment,
      ttlLine,
      "let _scrml_idempotency_table_ready = false;",
      "async function _scrml_idempotency_ensure_table() {",
      "  if (_scrml_idempotency_table_ready) return;",
      "  await _scrml_sql.unsafe(`CREATE TABLE IF NOT EXISTS _scrml_idempotency_keys (key TEXT PRIMARY KEY, response_body TEXT NOT NULL, response_status INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);",
      "  _scrml_idempotency_table_ready = true;",
      "}",
      "async function _scrml_idempotency_lookup(key) {",
      "  if (!key) return null;",
      "  await _scrml_idempotency_ensure_table();",
      "  const now = Date.now();",
      "  const rows = await _scrml_sql`SELECT response_body, response_status, expires_at FROM _scrml_idempotency_keys WHERE key = ${key} LIMIT 1`;",
      "  if (!rows || rows.length === 0) return null;",
      "  const row = rows[0];",
      "  if (row.expires_at <= now) return null;",
      "  return { response_body: row.response_body, response_status: row.response_status };",
      "}",
      "async function _scrml_idempotency_store(key, body, status) {",
      "  if (!key) return;",
      "  await _scrml_idempotency_ensure_table();",
      "  const now = Date.now();",
      "  const expires = now + _SCRML_IDEMPOTENCY_TTL_MS;",
      "  try {",
      "    await _scrml_sql`INSERT INTO _scrml_idempotency_keys (key, response_body, response_status, created_at, expires_at) VALUES (${key}, ${body}, ${status}, ${now}, ${expires})`;",
      "  } catch (_e) {",
      "    await _scrml_sql`UPDATE _scrml_idempotency_keys SET response_body = ${body}, response_status = ${status}, created_at = ${now}, expires_at = ${expires} WHERE key = ${key}`;",
      "  }",
      "}",
      "",
    ].join("\n");
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      finalEmitted = helper + finalEmitted;
    } else {
      finalEmitted = finalEmitted.slice(0, headerEndIdx) + helper + finalEmitted.slice(headerEndIdx);
    }
  }

  // GITI-012 / fix-server-eq-helper-import: structural-equality helper inlining.
  // SPEC §45 emits \`_scrml_structural_eq(a, b)\` for any \`==\`/\`!=\` whose operands
  // aren't statically primitive (see emit-expr.ts). The helper lives in the
  // client runtime; .server.js never imports it. If any callsite survived the
  // primitive shortcut, inline the helper at the top of the server module so
  // the reference resolves at runtime.
  if (finalEmitted.includes("_scrml_structural_eq(")) {
    // Inject AFTER the file header + imports block so the helper is hoisted
    // above any function that might call it (the first blank line following
    // the imports). Helper source is the shared SERVER_STRUCTURAL_EQ_HELPER.
    finalEmitted = injectAfterHeader(finalEmitted, SERVER_STRUCTURAL_EQ_HELPER);
  }

  // M-7C-D-12 Track 2 (§57 Wire Format) — encoder helper post-emit detection.
  //
  // The two type-gated emit sites above (CSRF + non-CSRF idempotency response
  // paths) call `_scrml_wire_encode(_scrml_result)` whenever the declared
  // return type is `T | not`. The encoder function itself is defined in
  // `compiler/src/codegen/wire-format.ts` as the inlinable `SERVER_WIRE_ENCODER_HELPER`
  // source string.
  //
  // Mirrors the structural-equality helper injection precedent at line ~1320:
  // detect the call signature in the final emitted source, then inject the
  // helper at the post-header boundary so the function definition is hoisted
  // above all routes that reference it. Type-gating at the emit site remains
  // the source of truth; this post-emit detection is purely the injection
  // trigger — if NO emit site fired the call, the helper is NOT injected.
  if (finalEmitted.includes("_scrml_wire_encode(")) {
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      finalEmitted = SERVER_WIRE_ENCODER_HELPER + finalEmitted;
    } else {
      finalEmitted = finalEmitted.slice(0, headerEndIdx) + SERVER_WIRE_ENCODER_HELPER + finalEmitted.slice(headerEndIdx);
    }
  }

  // §14.8.9 — protected-column egress redaction helper inlining. The tag/redact/
  // reveal calls emitted above (SQL-lowering tag, sink redact, reveal lowering)
  // reference `_scrml_protect_tag` / `_scrml_protect_redact` / `_scrml_protect_reveal`.
  // Inline the single helper block at the post-header boundary so the functions
  // are hoisted above every route that references them. Server-only — the
  // descriptor + the redaction never reach client.js. Gated purely on the
  // emitted call (a non-protect app emits none of these and is byte-unchanged).
  if (finalEmitted.includes("_scrml_protect_")) {
    finalEmitted = injectAfterHeader(finalEmitted, SERVER_PROTECT_HELPER);
  }

  // §20.6 — log() server helper inlining. A SERVER-side log() lowers to a
  // `_scrml_log(side, loc, ...args)` call (the client runtime is never
  // imported here). Inline the helper at the post-header boundary so it is
  // hoisted above every route that references it. Mirrors the structural-eq
  // + wire-encoder inlining above; gated purely on the emitted call (a
  // production-stripped or all-client-log build emits no `_scrml_log(` here).
  if (finalEmitted.includes("_scrml_log(")) {
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      finalEmitted = SERVER_LOG_HELPER + finalEmitted;
    } else {
      finalEmitted = finalEmitted.slice(0, headerEndIdx) + SERVER_LOG_HELPER + finalEmitted.slice(headerEndIdx);
    }
  }

  // Bug 3a (S87 follow-on, 2026-05-12) — `_scrml_sql` declaration emission.
  // SPEC §44.2 driver resolution + §40.2 program db= attr.
  //
  // Every server-fn route emitted above (and the idempotency / structural-eq
  // helpers) reference `_scrml_sql` (or scoped `_scrml_sql_<n>`) as the
  // tagged-template handle for Bun.SQL queries. Without a top-of-file
  // declaration these references throw `ReferenceError: _scrml_sql is not
  // defined` at first server-fn invocation — the gap surfaced by Wave 3 D2's
  // first real e2e SQL round-trip (Bug 3 dispatch, S87 commit `279bfc8`).
  //
  // Detection: scan the joined output for `_scrml_sql\b` and
  // `_scrml_sql_\d+\b` token usages. For each unique identifier referenced,
  // look up its connection string + driver via `collectDbScopes(fileAST)`
  // and emit `import { SQL } from "bun";` (once) + per-identifier
  // `const _scrml_sql<suffix> = new SQL(<connStr>);` declarations.
  //
  // The `import { SQL } from "bun"` line is emitted only when at least one
  // declaration is needed (server.js for files without `<db>`/`<program db=>`
  // remains import-free).
  //
  // Bun.SQL driver-prefix discipline: Bun.SQL DEFAULTS to PostgreSQL when
  // given a bare connection string with no recognized prefix. SQLite paths
  // (`./contacts.db`, `:memory:`) MUST be passed with a `sqlite:` prefix or
  // Bun.SQL attempts a postgres connection at module init and throws
  // `PostgresError: Connection closed`. We normalize the SQLite case here:
  // when the resolved driver is `sqlite` AND the connection string does not
  // already start with `sqlite:`, prepend `sqlite:` before passing to
  // `new SQL(...)`. Postgres / MySQL strings have explicit `postgres://` /
  // `mysql://` prefixes (per `db-driver.ts`) and pass through verbatim.
  // For SQLite relative paths (e.g. `./contacts.db`) resolution is
  // relative to CWD at runtime; this matches typical Bun.SQL usage.
  const sqlIdentRe = /\b_scrml_sql(?:_\d+)?\b/g;
  const usedIdents = new Set<string>();
  let _m: RegExpExecArray | null;
  while ((_m = sqlIdentRe.exec(finalEmitted)) !== null) {
    usedIdents.add(_m[0]);
  }
  if (usedIdents.size > 0) {
    const dbScopes = collectDbScopes(fileAST);
    const declLines: string[] = [];
    declLines.push("");
    declLines.push("// --- Bug 3a (§44.2): Bun.SQL handle declarations (compiler-generated) ---");
    declLines.push("import { SQL } from \"bun\";");
    // Emit declarations in stable order: default `_scrml_sql` first, then
    // scoped `_scrml_sql_<n>` ascending. The declaration order must precede
    // any code that references the handle (the idempotency / structural-eq
    // helpers above + every server-fn route below).
    const sortedIdents = Array.from(usedIdents).sort((a, b) => {
      if (a === "_scrml_sql") return -1;
      if (b === "_scrml_sql") return 1;
      const an = parseInt(a.replace("_scrml_sql_", ""), 10);
      const bn = parseInt(b.replace("_scrml_sql_", ""), 10);
      return an - bn;
    });
    for (const ident of sortedIdents) {
      const scope = dbScopes.get(ident);
      if (!scope) {
        // No matching scope was found in the file AST. This indicates an
        // upstream invariant violation — the body referenced a SQL handle
        // but no `<program db=>` / `<db src=>` declared one. Emit a
        // defensive fallback to `:memory:` and a comment so the resulting
        // file at least parses; the actual pipeline failure (E-SQL-004 —
        // `?{}` with no `db=` ancestor) should have fired upstream.
        declLines.push(
          `// WARNING: ${ident} referenced but no matching <program db=> / <db src=> found; ` +
          `falling back to :memory: (likely an upstream E-SQL-004 invariant violation).`,
        );
        declLines.push(`const ${ident} = new SQL(":memory:");`);
        continue;
      }
      // SQLite paths require `sqlite:` prefix or Bun.SQL defaults to
      // postgres at module init (see comment block above).
      let connStr = scope.connectionString;
      if (
        scope.driver === "sqlite" &&
        !connStr.startsWith("sqlite:") &&
        connStr !== ":memory:"
      ) {
        // ss19 #9 (g-db-src-compile-vs-runtime-path) — express the emitted path
        // relative to the project root (the runtime cwd) so every source file
        // that references the SAME physical db emits the SAME runtime path. The
        // compiler resolves `src=` file-relative (protect-analyzer), but the
        // emitted `sqlite:` literal is opened CWD-relative at runtime — so a
        // <page> in a subdir (`src="../m.db"`) opened a DIFFERENT file than the
        // root entry (`src="./m.db"`) when both run from the project root →
        // "no such table". We re-relativize ONLY for files NOT at the project
        // root; a root-level file keeps its verbatim src (the common single-dir
        // case stays byte-identical). `relative(root, absDb)` always yields a
        // path that, from cwd=root, resolves to absDb (a leading `..` for an
        // out-of-root db is correct, matching the file-relative resolution).
        const _baseDir = (fileAST as any)._outputBaseDir;
        if (
          typeof _baseDir === "string" && _baseDir.length > 0 &&
          typeof filePath === "string" && filePath.length > 0
        ) {
          const _resolvedBase = _pathResolve(_baseDir);
          const _sourceDir = _pathDirname(_pathResolve(filePath));
          if (_sourceDir !== _resolvedBase) {
            const _absDb = _pathResolve(_sourceDir, connStr);
            const _relToRoot = _pathRelative(_resolvedBase, _absDb);
            if (_relToRoot.length > 0) {
              connStr = _relToRoot.replace(/\\/g, "/");
            }
          }
        }
        connStr = "sqlite:" + connStr;
      }
      declLines.push(`const ${ident} = new SQL(${JSON.stringify(connStr)});`);
    }
    declLines.push("");
    const declBlock = declLines.join("\n");
    // Inject after the imports block (first blank line in the file). This
    // hoists the declarations above all helpers + routes so every reference
    // resolves at module-init.
    const headerEndIdx = finalEmitted.indexOf("\n\n");
    if (headerEndIdx === -1) {
      finalEmitted = declBlock + finalEmitted;
    } else {
      finalEmitted = finalEmitted.slice(0, headerEndIdx) + declBlock + finalEmitted.slice(headerEndIdx);
    }
  }

  // §14.8.9 — drain the protected-column strip records the SQL-lowering pass
  // collected, and surface one deduped `I-PROTECT-STRIP-001` (Info) per query so
  // the redaction is never silent: the dev sees exactly which protected columns
  // the egress floor removed. A `"*"` record is the wholesale strip of an
  // unresolvable dynamic-SQL row. Routed into the `errors` stream with severity
  // "info" — api.js partitions W-/I- info into result.warnings (non-fatal).
  if (_protectActive) {
    for (const info of drainProtectInfosFromRewriter()) {
      const _what = info.cols === "*"
        ? "ALL columns (the query's column origins are not statically resolvable — fail-closed wholesale strip)"
        : `protected column(s) ${info.cols.map((c) => `\`${c}\``).join(", ")}`;
      errors.push(new CGError(
        "I-PROTECT-STRIP-001",
        `I-PROTECT-STRIP-001: the egress floor strips ${_what} from the client response of \`${info.sql}\` ` +
        `(§14.8.9 — a \`protect=\` column never crosses the wire unredacted). To send a protected column ` +
        `deliberately, declassify it at the value with \`reveal("col")\`; to silence this, project the column out of the SELECT.`,
        { file: filePath, start: 0, end: 0 } as any,
        "info",
      ));
    }
  }
  // §14.8.9 — release the protect context (mirrors the variant-fields release).
  setProtectContextForRewriter(null);

  // S95 Bug 2 — release the per-file variant-fields registry from the rewriter.
  // generateClientJs (which runs after generateServerJs per codegen/index.ts)
  // will re-populate for its own pass; clearing here keeps state from leaking
  // when only the server emit runs (e.g. dry-run / partial pipelines).
  setVariantFieldsForRewriter(null, null);

  // g-pure-module-server-emit (S207): server-import tree-shaking — prune pass.
  // Now that the full server body is assembled, decide which deferred local-
  // `.scrml` imports survive: keep a specifier only if its local name is
  // referenced in the body, and drop an import line entirely when every
  // specifier is unused (the dangling-`.server.js` bug — a pure-helper module
  // imported for client-side use only). Replace the sentinel with the surviving
  // import lines (or remove it cleanly when none survive).
  if (_localImportSentinelIdx !== -1) {
    // The body to scan is finalEmitted MINUS the sentinel line itself (the
    // sentinel is a bare comment, so it cannot contain a real identifier use,
    // but exclude it for clarity). Imports themselves were deferred, so the
    // assembled finalEmitted contains no local-`.scrml` import line yet — any
    // occurrence of a local name is a genuine reference.
    const scanBody = finalEmitted.split(LOCAL_SERVER_IMPORT_SENTINEL).join("");
    const survivingLines: string[] = [];
    for (const imp of deferredLocalImports) {
      const keptSpecs = imp.specs.filter((s) => localServerImportNameUsed(scanBody, s.local));
      if (keptSpecs.length === 0) continue; // whole import unused → drop (the fix).
      const names = keptSpecs
        .map((s) => (s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`))
        .join(", ");
      survivingLines.push(`import { ${names} } from ${JSON.stringify(imp.jsSource)};`);
    }
    const replacement = survivingLines.join("\n");
    // Replace the sentinel line in place. If nothing survives, the sentinel
    // line collapses to empty; the surrounding blank line from `lines.push("")`
    // keeps the header spacing intact.
    finalEmitted = finalEmitted
      .split(LOCAL_SERVER_IMPORT_SENTINEL + "\n")
      .join(replacement === "" ? "" : replacement + "\n")
      // Fallback if the sentinel was the final line (no trailing newline).
      .split(LOCAL_SERVER_IMPORT_SENTINEL)
      .join(replacement);
  }

  // Bug-51 (§14.4): page-local enum-variant objects in the SERVER bundle.
  // A page-local `type X:enum` referenced inside a `server function` body
  // (e.g. `return ok ? Load.Ok : Load.Bad`) lowers to a member-access on a
  // frozen `const X = Object.freeze({...})`. `rewriteEnumVariantAccess`
  // (rewrite.ts) deliberately leaves `X.Member` AS-IS (only bare `.Member` /
  // `X::Member` are string-inlined), so the runtime needs the `const X` to
  // exist. `emitEnumVariantObjects` only emitted these into the CLIENT bundle;
  // server-fn bodies referenced `X.Member` as a free identifier → runtime
  // `ReferenceError: X is not defined`. Reuse the SAME emitter as the client
  // (byte-identical `Object.freeze` shape, so server↔client serialization of a
  // payload variant agrees), gated on reachability: emit only an enum whose
  // name is actually referenced in the assembled server body. This mirrors the
  // DB-scope-const reachability scan above (`usedIdents`) and keeps the server
  // bundle minimal (an enum string-inlined as `.Member` / used only in client
  // markup never appears here).
  //
  // ORDERING (Bug-51 follow-up): this block runs AFTER the server-import
  // tree-shaking prune pass above. The prune scans `finalEmitted` to decide
  // which deferred local-`.scrml` server imports survive; if an injected
  // `const <Enum> = Object.freeze` landed BEFORE the prune, an enum whose name
  // happened to match a client-only server-import local would spuriously count
  // as a "reference" and keep an otherwise-dead import (a dangling
  // `.server.js`). Injecting the enum consts after the prune keeps the prune's
  // reference scan honest. The reachability gate below scans the assembled
  // route-handler body (present before the prune either way), so it is
  // unaffected by the reordering; the consts still hoist above the route
  // handlers (header `\n\n` injection point).
  // ss22 item 5 (g-enum-toenum-not-lowered-server-side) — TWO-PART fix.
  //
  // PART 1 (lower): the structured-AST emit path (`emitExpr`) emits a
  // `<Enum>.toEnum(raw)` call VERBATIM — only the STRING-rewrite passes
  // (`rewriteEnumToEnum`, Pass 9 client / Pass 6 server) lower it, and a
  // `return <Enum>.toEnum(raw)` / `.map(row => ({ ... <Enum>.toEnum(x) ... }))`
  // body reaches codegen as a structured call-expr (or an arrow nested inside
  // one), bypassing the string pass. Left un-lowered, the server bundle throws
  // `TypeError: <Enum>.toEnum is not a function` at runtime (a frozen enum
  // object has no `toEnum` method) — compile exit-0, SILENT. We post-process the
  // ASSEMBLED server body, lowering `<Enum>.toEnum(...)` / `toEnum(<Enum>, ...)`
  // to `(<Enum>_toEnum[...] ?? null)` ONLY for statically-known enum names (so an
  // unrelated `obj.toEnum(...)` method is never touched). Mirrors the
  // `rewriteEnumToEnum` (rewrite.ts) regexes, name-scoped per enum so a non-enum
  // `SomeClass.toEnum(...)` is left intact.
  //
  // PART 2 (tables): the `<Enum>_toEnum` / `<Enum>_variants` lookup tables are
  // emitted into the CLIENT bundle only (§14.4.1). After Part 1 lowering, the
  // server body references `<Enum>_toEnum[...]` (and `<Enum>_variants` for any
  // `.variants` that lowered via the string path), so we emit those tables into
  // the SERVER bundle too — REACHABILITY-GATED: only the table kinds an enum
  // actually references in the assembled body are injected (mirrors the Bug-51
  // variant-object gate below). This MUST run BEFORE the Bug-51 enum-variant-
  // object block: Part 1 rewrites `<Enum>.toEnum(raw)` → `<Enum>_toEnum[raw]`,
  // dropping the bare `<Enum>` reference — so an enum used server-side ONLY via
  // `.toEnum` correctly gets its `_toEnum` table here, not a redundant frozen
  // `const <Enum> = Object.freeze(...)` object below.
  {
    const _enumNames: string[] = [];
    for (const decl of (fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [])) {
      if (decl && decl.kind === "type-decl" && decl.typeKind === "enum" && decl.name) {
        _enumNames.push(decl.name);
      }
    }
    if (_enumNames.length > 0) {
      // PART 1 — name-scoped toEnum lowering over the assembled body. Run the
      // shared rewrite only on segments mentioning a known enum's `.toEnum` /
      // `toEnum(<Enum>` so the regex never reaches an unrelated `.toEnum`.
      const _enumNameSet = new Set(_enumNames);
      // The `rewriteEnumToEnum` (rewrite.ts) regexes match ANY PascalCase
      // `X.toEnum(...)`; here we re-check each match's type name against the
      // known-enum set so a non-enum `SomeClass.toEnum(...)` is left intact.
      const _toEnumMethodRe = /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*toEnum\s*\(\s*([^)]+)\s*\)/g;
      const _toEnumFnRe = /\btoEnum\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*,\s*([^)]+)\s*\)/g;
      finalEmitted = finalEmitted.replace(_toEnumMethodRe, (m, typeName: string, arg: string) =>
        _enumNameSet.has(typeName) ? `(${typeName}_toEnum[${arg.trim()}] ?? null)` : m,
      );
      finalEmitted = finalEmitted.replace(_toEnumFnRe, (m, typeName: string, arg: string) =>
        _enumNameSet.has(typeName) ? `(${typeName}_toEnum[${arg.trim()}] ?? null)` : m,
      );

      // PART 2 — reachability gate: which `<Enum>_toEnum` / `<Enum>_variants`
      // identifiers now appear as standalone tokens in the assembled body.
      const _tableKindByEnum = new Map<string, Set<"toEnum" | "variants">>();
      for (const name of _enumNames) {
        const kinds = new Set<"toEnum" | "variants">();
        if (localServerImportNameUsed(finalEmitted, `${name}_toEnum`)) kinds.add("toEnum");
        if (localServerImportNameUsed(finalEmitted, `${name}_variants`)) kinds.add("variants");
        if (kinds.size > 0) _tableKindByEnum.set(name, kinds);
      }
      if (_tableKindByEnum.size > 0) {
        const _enumTableLines = emitEnumLookupTables(fileAST, { tableKindByEnum: _tableKindByEnum })
          // Collision guard: skip a table whose identifier is already bound at
          // the top level of the assembled bundle (mirrors the Bug-51 E-CG-016
          // guard; a `_toEnum` / `_variants` name collision is exceedingly rare,
          // so fail-safe by skipping the redundant inject rather than erroring).
          .filter((line) => {
            const nameMatch = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+=/.exec(line);
            if (!nameMatch) return false;
            return !topLevelBindingExists(finalEmitted, nameMatch[1]);
          });
        if (_enumTableLines.length > 0) {
          const _tableBlock =
            "\n// --- enum toEnum() lookup tables (compiler-generated, §14.4) ---\n" +
            _enumTableLines.join("\n") +
            "\n";
          const _hdrIdx = finalEmitted.indexOf("\n\n");
          if (_hdrIdx === -1) {
            finalEmitted = _tableBlock + finalEmitted;
          } else {
            finalEmitted = finalEmitted.slice(0, _hdrIdx) + _tableBlock + finalEmitted.slice(_hdrIdx);
          }
        }
      }
    }
  }

  const enumDefLines = emitEnumVariantObjects(fileAST);
  if (enumDefLines.length > 0) {
    // name → declaration span, for a precise E-CG-016 collision diagnostic.
    const enumDeclSpans = new Map<string, any>();
    for (const decl of (fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [])) {
      if (decl && decl.kind === "type-decl" && decl.typeKind === "enum" && decl.name) {
        enumDeclSpans.set(decl.name, decl.span ?? {});
      }
    }
    const referencedEnumLines: string[] = [];
    for (const line of enumDefLines) {
      // Each line is `const <Name> = Object.freeze({ ... });` — extract the
      // declared enum name and keep the def only if `<Name>` appears as a
      // standalone identifier somewhere in the assembled body (a `<Name>.Member`
      // member-access in a server-fn body, the only form needing the runtime
      // const). `localServerImportNameUsed` is the same word-boundary check
      // used for server-import tree-shaking.
      const nameMatch = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+=/.exec(line);
      if (!nameMatch) continue;
      const enumName = nameMatch[1];
      if (!localServerImportNameUsed(finalEmitted, enumName)) continue;
      // Collision guard (E-CG-016): the enum is referenced server-side, but its
      // name is ALREADY bound at the top level of the assembled bundle — most
      // commonly the compiler-injected `import { SQL } from "bun"` runtime
      // handle clashing with an author `type SQL:enum`. Injecting a second
      // `const <Enum>` here would yield two declarations of the same identifier
      // and fail the emit-validation gate with a cryptic
      // `Identifier '<X>' has already been declared` SyntaxError on otherwise-
      // valid scrml. Skipping silently would instead trade that for a runtime
      // `ReferenceError` on the enum's `.Member` refs (strictly worse), so we
      // fail closed with a clear, adopter-actionable diagnostic naming the
      // conflict and the fix (rename the enum).
      if (topLevelBindingExists(finalEmitted, enumName)) {
        errors.push(new CGError(
          "E-CG-016",
          `E-CG-016: page-local enum \`${enumName}\` collides with a compiler-injected ` +
          `top-level server-bundle binding of the same name (e.g. the \`import { SQL } ` +
          `from "bun"\` runtime handle, or a server-only import). The generated server ` +
          `bundle cannot declare \`${enumName}\` twice. Resolution: rename the enum to a ` +
          `name that does not clash with a compiler-reserved server binding ` +
          `(e.g. \`SQL\` is reserved when the page uses a \`<db>\` / \`?{}\` query).`,
          enumDeclSpans.get(enumName) ?? {},
          "error",
        ));
        continue;
      }
      referencedEnumLines.push(line);
    }
    if (referencedEnumLines.length > 0) {
      const enumBlock =
        "\n// --- enum variant objects (compiler-generated, §14.4) ---\n" +
        referencedEnumLines.join("\n") +
        "\n";
      // Inject after the header's first blank-line boundary so the frozen enum
      // consts are hoisted above every route handler that references them.
      const headerEndIdx = finalEmitted.indexOf("\n\n");
      if (headerEndIdx === -1) {
        finalEmitted = enumBlock + finalEmitted;
      } else {
        finalEmitted = finalEmitted.slice(0, headerEndIdx) + enumBlock + finalEmitted.slice(headerEndIdx);
      }
    }
  }

  return finalEmitted;
}
