import { CGError } from "./errors.ts";
import { getNodes } from "./collect.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";
import { emitLogicNode } from "./emit-logic.js";
import { isServerOnlyNode, containsSqlOrTransaction } from "./collect.ts";
import { rewriteNotKeyword, rewriteIsOperator } from "./rewrite.ts";
import type { CompileContext } from "./context.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/** A span object with start/end offsets. */
interface Span {
  start: number;
  end: number;
  file?: string;
  line?: number;
  col?: number;
}

/** A source region extracted for emission. */
interface SourceRegion {
  start: number;
  end: number;
  isGap: boolean;
  kind?: string;
}

/**
 * Strip inline ^{ ... } meta expressions, replacing with just the body content.
 * Handles nested braces correctly by counting depth.
 */
function stripInlineMeta(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "^" && i + 1 < text.length && text[i + 1] === "{") {
      // Found ^{ — extract the body by counting brace depth
      i += 2; // skip ^{
      let depth = 1;
      let body = "";
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        body += text[i];
        i++;
      }
      result += body.trim();
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}

/**
 * Collect every `guarded-expr` node reachable from a logic block, descending
 * into function bodies / nested blocks. The library whole-block extraction path
 * (below) slices raw source text and regex-transforms it; it does NOT route
 * function bodies through emitLogicNode, so the §19 host-containment call-site
 * handler (`EXPR !{ | ::Variant(...) :> ... }`, the public try/catch
 * replacement) survives as VERBATIM scrml `!{}` and trips the §2.2.1 emit gate
 * (E-CODEGEN-INVALID-JS). Browser mode lowers it via emit-logic.ts's
 * `case "guarded-expr"`. This collector lets the library path reuse that SAME
 * lowering by span-splicing the emitted JS over the raw `!{}` source.
 *
 * Only TOP-LEVEL guarded-expr nodes are returned: the lowering emitted by
 * emitLogicNode for an outer guarded-expr already recurses into its own arm
 * bodies (nested `!{}` lower there), so collecting a nested guarded-expr
 * separately would double-splice an overlapping span. The walk therefore stops
 * descending once it captures a guarded-expr.
 */
function collectGuardedExprs(node: unknown, out: ASTNode[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectGuardedExprs(child, out);
    return;
  }
  const n = node as ASTNode;
  if (n.kind === "guarded-expr") {
    out.push(n);
    return; // do not descend — emitLogicNode lowers nested arm bodies itself
  }
  for (const k of Object.keys(n)) {
    const v = (n as Record<string, unknown>)[k];
    if (v && typeof v === "object") collectGuardedExprs(v, out);
  }
}

/**
 * W5b (g-library-mode-sql-no-db-context) — collect the source-text spans of
 * every function declaration whose body carries a `?{}` SQL block / transaction
 * in a library file's logic block.
 *
 * A `?{}` SQL fn (resolving against the file's own top-level `<db src>`,
 * §44.7.1) is server-only — its raw `?{}` is invalid JS and cannot appear in
 * the importable library `.js` (the client-facing artifact). The whole-block
 * slicer below dumps the block verbatim, so the `?{}` would leak → the §2.2.1
 * E-CODEGEN-INVALID-JS emit gate. Such a fn lives ONLY in the `.server.js`
 * (its route-handler wrapper, retained by the §12.6 discriminator once its body
 * carries SQL). We prune it here.
 *
 * The criterion is the fn BODY carrying SQL/transaction — NOT mere server-
 * boundary classification. A body-content-escalated `scrml:fs` import fn (§12.6
 * (a)) or an explicit `export server function` with a pure JS body emits
 * cleanly as a plain library export and MUST stay; only a `?{}`/transaction
 * body (which would leak raw scrml) is pruned. A client-USED pure export stays.
 *
 * The `export` keyword and any `pure`/`server` modifier prefix (§21.5.1) sit
 * BEFORE the function-decl span, so we look back from `span.start` to include
 * them in the removal range.
 */
function collectSqlFnRemovalRanges(
  logicBody: unknown,
  sourceText: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!Array.isArray(logicBody)) return ranges;
  const seen = new Set<string>();
  for (const node of logicBody as ASTNode[]) {
    if (!node || typeof node !== "object") continue;
    const n = node as ASTNode;
    if (n.kind !== "function-decl" && n.kind !== "export-decl") continue;
    if (!containsSqlOrTransaction(n)) continue;
    const sp = n.span as Span | undefined;
    if (!sp || typeof sp.start !== "number" || typeof sp.end !== "number") continue;
    const key = `${sp.start}:${sp.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Extend backward to swallow `export` + optional `pure`/`server` modifiers
    // (§21.5.1). Anchored at end-of-lookback so only keywords immediately
    // preceding the function-decl span are captured.
    const lookback = sourceText.slice(Math.max(0, sp.start - 40), sp.start);
    const m = lookback.match(/((?:export\s+)?(?:pure\s+)?(?:server\s+)?)$/);
    const prefixLen = m ? m[1].length : 0;
    ranges.push({ start: sp.start - prefixLen, end: sp.end });
  }
  return ranges;
}

/**
 * Prune `?{}`/transaction-bearing functions from the library block AND splice
 * the AST-lowered emission of every `guarded-expr` node over its raw `!{}`
 * source. Both operate on absolute offsets into `sourceText`; `blockSource` is
 * the UNTRIMMED raw slice `sourceText.slice(logicSpan.start, logicSpan.end)`, so
 * block-relative offset = `span.x - blockStart`. All edits are collected then
 * applied highest-start-first in ONE pass, so earlier offsets stay valid as
 * later edits mutate the tail.
 *
 * A guarded-expr that falls INSIDE a pruned fn span is dropped (the whole fn is
 * removed, so lowering an expression inside it would be dead work AND would
 * splice into text that no longer exists). A guarded-expr elsewhere lowers as
 * before: the lowered JS is valid JS with no scrml `not`/`is`/`fn`/`type`
 * keywords, so it survives the downstream regex-transform pipeline.
 */
function pruneServerFnsAndLowerGuarded(
  blockSource: string,
  blockStart: number,
  logicBody: unknown,
  sourceText: string,
): string {
  const removals = collectSqlFnRemovalRanges(logicBody, sourceText);

  const guarded: ASTNode[] = [];
  collectGuardedExprs(logicBody, guarded);

  type SpliceOp = { start: number; end: number; text: string };
  const ops: SpliceOp[] = [];

  // Server-fn removals — splice to empty (the fn lives in `.server.js`).
  for (const r of removals) ops.push({ start: r.start, end: r.end, text: "" });

  // §19 host-containment `!{}` — lower each guarded-expr, skipping any that
  // fall inside a pruned server-fn span.
  for (const g of guarded) {
    const sp = g.span as Span | undefined;
    if (!sp || typeof sp.start !== "number" || typeof sp.end !== "number") continue;
    if (removals.some((r) => sp.start >= r.start && sp.end <= r.end)) continue;
    // A guarded-expr at library scope is always inside a function body (a bare
    // top-level `${...}` host-containment call is a program-mode shape); emit
    // with insideFunctionBody so an unhandled-variant arm escalates via `return`.
    const lowered = emitLogicNode(
      g as Parameters<typeof emitLogicNode>[0],
      { insideFunctionBody: true } as Parameters<typeof emitLogicNode>[1],
    );
    if (lowered == null) continue;
    ops.push({ start: sp.start, end: sp.end, text: lowered });
  }

  if (ops.length === 0) return blockSource;

  // Highest-start-first so earlier offsets stay valid as we mutate.
  ops.sort((a, b) => b.start - a.start);
  let text = blockSource;
  for (const op of ops) {
    const relStart = op.start - blockStart;
    const relEnd = op.end - blockStart;
    if (relStart < 0 || relEnd > text.length || relStart >= relEnd) continue;
    text = text.slice(0, relStart) + op.text + text.slice(relEnd);
  }
  return text;
}

/**
 * Generate ES module output for a scrml file in library mode.
 *
 * Library mode emits importable ES modules — no browser runtime, no IIFE,
 * no DOMContentLoaded bootstrapping. This is used for:
 *   - scrml stdlib modules (e.g. stdlib/compiler/*.scrml → *.js)
 *   - Any scrml file intended to be imported by other JS/scrml code
 *
 * Strategy:
 *   When source text is available (_sourceText), we extract each statement's
 *   original source code via its span. This preserves proper JS formatting
 *   (the AST raw field has tokenizer-spaced text like "this . code" which
 *   isn't valid JS).
 *
 *   When source text is NOT available (e.g. synthetic ASTs in tests), we
 *   fall back to emitting from AST raw/expr fields and emitLogicNode().
 *
 * @param fileAST — resolved FileAST from the compiler pipeline
 * @param routeMap — route map from RI stage
 * @param errors — error accumulator (mutated)
 * @returns ES module source code string
 */
export function generateLibraryJs(
  ctxOrFileAST: CompileContext | Record<string, unknown>,
  routeMapLegacy?: object | null,
  errorsLegacy?: CGError[],
): string {
  // Support both new (ctx) and legacy (fileAST, routeMap, errors) signatures
  let fileAST: Record<string, unknown>;
  let routeMap: object;
  let errors: CGError[];
  if ("fileAST" in ctxOrFileAST) {
    const ctx = ctxOrFileAST as CompileContext;
    fileAST = ctx.fileAST;
    routeMap = ctx.routeMap;
    errors = ctx.errors;
  } else {
    fileAST = ctxOrFileAST;
    routeMap = routeMapLegacy ?? {};
    errors = errorsLegacy ?? [];
  }
  const filePath = fileAST.filePath as string;
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  const lines: string[] = [];

  lines.push("// Generated library module — scrml compiler output");
  lines.push("// ES module: import { name } from './this-file.js'");
  lines.push("");

  // ---------------------------------------------------------------------------
  // Collect logic blocks from the AST
  // scrml files have: markup(program) → logic(${ ... }) → body[...]
  // ---------------------------------------------------------------------------
  const logicBlocks: ASTNode[] = [];
  const nodes = getNodes(fileAST);
  function collectLogicBlocks(nodeList: unknown[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      const n = node as ASTNode;
      if (n.kind === "logic" && Array.isArray(n.body)) {
        logicBlocks.push(n);
      }
      if (Array.isArray(n.children)) collectLogicBlocks(n.children as unknown[]);
    }
  }
  collectLogicBlocks(nodes as unknown[]);

  // ---------------------------------------------------------------------------
  // Source-text path: extract the logic block's content directly from source
  //
  // This preserves original formatting and captures ALL code in the logic
  // block — including helper functions that the AST may absorb into adjacent
  // export-decl raw text. We extract the region between consecutive nodes'
  // spans to get inter-node code (like non-exported helper functions).
  // ---------------------------------------------------------------------------
  if (sourceText && logicBlocks.length > 0) {
    for (const logic of logicBlocks) {
      const body = (logic.body ?? []) as ASTNode[];

      // Build ordered list of (start, end) spans, filling gaps between them
      // to capture non-node content (helper functions, comments, etc.)
      const regions: SourceRegion[] = [];
      let lastSkippedEnd = -1;

      // ---------------------------------------------------------------------------
      // Whole-block extraction: instead of tracking individual node spans and
      // gaps (which misses component-def nodes that the pipeline transforms),
      // extract the entire logic block content between ${ and }, then strip
      // scrml-specific syntax.
      // ---------------------------------------------------------------------------
      const logicSpan = logic.span as Span | undefined;
      if (logicSpan && typeof logicSpan.start === "number" && typeof logicSpan.end === "number") {
        let blockText = sourceText.slice(logicSpan.start, logicSpan.end);
        // §19 host-containment — lower every `EXPR !{ | ::Variant(...) :> ... }`
        // call-site handler (the public try/catch replacement) by span-splicing
        // the AST-lowered emission over its raw `!{}` source. The library
        // whole-block path below only regex-transforms text; without this splice
        // the `!{}` survives verbatim and trips the §2.2.1 emit gate
        // (E-CODEGEN-INVALID-JS). blockStart === logicSpan.start since the splice
        // runs on the UNTRIMMED slice (guarded-expr spans are absolute into
        // sourceText). Reuses browser mode's emit-logic.ts `case "guarded-expr"`.
        // W5b — prune `?{}`/transaction-bearing fns (they live in `.server.js`,
        // not the client-facing library `.js`) AND lower §19 `!{}` guarded-exprs
        // in one reverse-ordered splice pass. A `?{}` SQL fn resolving against
        // the file's own `<db src>` (§44.7.1) would otherwise leak verbatim into
        // the library `.js` and trip the §2.2.1 E-CODEGEN-INVALID-JS gate.
        blockText = pruneServerFnsAndLowerGuarded(
          blockText,
          logicSpan.start,
          logic.body,
          sourceText,
        );
        // Strip the ${ prefix and } suffix
        if (blockText.startsWith("${")) blockText = blockText.slice(2);
        if (blockText.endsWith("}")) blockText = blockText.slice(0, -1);
        blockText = blockText.trim();
        if (blockText) {
          // Strip scrml type declarations. Two syntax forms exist:
          // 1. Spec syntax: `type Name:kind = { ... }` (colon after name, equals before braces)
          // 2. Legacy/self-host syntax: `type:kind Name { ... }` (colon after type keyword)
          blockText = blockText.replace(/\btype\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*\w+)?\s*=\s*\{[^]*?\}/g, "");
          blockText = blockText.replace(/\btype\s*:\s*(?:enum|struct)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\{[^]*?\}/g, "");
          // Convert fn → function
          blockText = blockText.replace(/\bfn\s+([A-Za-z_$])/g, "function $1");
          // Strip inline ^{} meta
          blockText = stripInlineMeta(blockText);
          // Extract meta imports: destructuring and namespace
          const importRe = /const\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
          let m: RegExpExecArray | null;
          while ((m = importRe.exec(blockText)) !== null) {
            const names = m[1].trim().replace(/(\w+)\s*:\s*(\w+)/g, "$1 as $2");
            lines.push(`import { ${names} } from "${m[2]}";`);
          }
          const nsImportRe = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
          while ((m = nsImportRe.exec(blockText)) !== null) {
            lines.push(`import * as ${m[1]} from "${m[2]}";`);
          }
          // Strip ^{ await import(...) } meta blocks
          blockText = stripInlineMeta(blockText);
          // Strip bare `const { ... } = await import("string-literal")` declarations
          // (already emitted as ES imports above). The string-literal arg shape
          // mirrors the importRe/nsImportRe emit patterns — only those forms
          // were converted to ES imports, so only those forms get stripped.
          // S80 bugfix: prior regexes used `[^)]+` which is not paren-aware and
          // greedy-truncated `await import(new URL(...).href)` and similar
          // complex-arg calls to the first `)`, leaving residue. Constraining
          // to quoted-string args matches the emit symmetry.
          blockText = blockText.replace(/const\s*\{[^}]+\}\s*=\s*await\s+import\s*\(\s*["'][^"']+["']\s*\)\s*;?/g, "");
          blockText = blockText.replace(/const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*await\s+import\s*\(\s*["'][^"']+["']\s*\)\s*;?/g, "");
          blockText = blockText.trim();
          // Rewrite scrml `not`/`is not`/`is some`/`is .Variant` keywords to JS equivalents
          // Apply per-line, skipping comment lines to avoid mangling English text
          blockText = blockText.split("\n").map(line =>
            line.trimStart().startsWith("//") ? line : rewriteIsOperator(rewriteNotKeyword(line))
          ).join("\n");
          if (blockText) {
            lines.push(blockText);
            lines.push("");
          }
        }
        continue;
      }

      // Fallback: node-by-node processing (when logic block has no span)
      for (let i = 0; i < body.length; i++) {
        const stmt = body[i];
        if (!stmt) continue;


        // Meta blocks: extract `await import()` calls and emit as ES imports
        if (isMetaKind(stmt.kind)) {
          if (sourceText && stmt.span) {
            const span = stmt.span as Span;
            const metaText = sourceText.slice(span.start, span.end);
            // Find `const { ... } = await import("...")` patterns and emit as ES imports
            const importRe = /const\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
            let m: RegExpExecArray | null;
            while ((m = importRe.exec(metaText)) !== null) {
              // Convert destructuring rename syntax (a: b) to import rename syntax (a as b)
              const names = m[1].trim().replace(/(\w+)\s*:\s*(\w+)/g, "$1 as $2");
              const source = m[2];
              lines.push(`import { ${names} } from "${source}";`);
            }
            // Find `const name = await import("...")` (namespace import) patterns
            const nsImportRe = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
            while ((m = nsImportRe.exec(metaText)) !== null) {
              const name = m[1];
              const source = m[2];
              lines.push(`import * as ${name} from "${source}";`);
            }
          }
          if (stmt.span) {
            const sp = stmt.span as Span;
            lastSkippedEnd = Math.max(lastSkippedEnd, sp.end);
          }
          continue;
        }

        // Skip component-def ONLY if it's a real component (has props/template).
        // The AST builder classifies PascalCase `const X = ...` as component-def,
        // but in library mode these are regular constants that must be emitted.
        if (stmt.kind === "component-def" && (stmt.template || stmt.props)) {
          if (stmt.span) {
            const sp = stmt.span as Span;
            lastSkippedEnd = Math.max(lastSkippedEnd, sp.end);
          }
          continue;
        }

        // Skip type-decl — scrml type system syntax, not valid JS.
        // The AST parser splits `type:enum Name { ... }` into a type-decl node
        // (covering `type:enum`) followed by a bare-expr node (covering `Name { ... }`).
        // We skip the type-decl and mark it so the next bare-expr companion is also skipped.
        if (stmt.kind === "type-decl") {
          if (stmt.span) {
            const sp = stmt.span as Span;
            lastSkippedEnd = Math.max(lastSkippedEnd, sp.end);
          }
          // Skip the companion bare-expr that contains the enum/struct body
          const next = body[i + 1] as ASTNode | undefined;
          if (next?.kind === "bare-expr" && next.span) {
            const nextSp = next.span as Span;
            lastSkippedEnd = Math.max(lastSkippedEnd, nextSp.end);
            i++; // advance past the companion node
          }
          continue;
        }

        // Security: block server-only nodes
        if (isServerOnlyNode(stmt)) {
          errors.push(new CGError(
            "E-CG-006",
            `E-CG-006: Server-only node (${stmt.kind as string}) found in library JS output.`,
            (stmt.span as Span) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
          continue;
        }

        const stmtSpan = stmt.span as Span | undefined;
        if (stmtSpan && typeof stmtSpan.start === "number" && typeof stmtSpan.end === "number") {
          // For export-decl, the span doesn't include the `export` keyword.
          // Look backward from span.start to find `export` in the source.
          let start = stmtSpan.start;
          if (stmt.kind === "export-decl") {
            const lookback = sourceText.slice(Math.max(0, start - 20), start);
            const exportIdx = lookback.lastIndexOf("export");
            if (exportIdx >= 0) {
              start = Math.max(0, start - 20) + exportIdx;
            }
          }
          // For component-def (PascalCase/UPPER_CASE const), the span starts at
          // the name, not the `const`/`let` keyword. Look backward to capture it.
          if (stmt.kind === "component-def") {
            const lookback = sourceText.slice(Math.max(0, start - 20), start);
            const constIdx = lookback.lastIndexOf("const");
            const letIdx = lookback.lastIndexOf("let");
            const declIdx = Math.max(constIdx, letIdx);
            if (declIdx >= 0) {
              start = Math.max(0, start - 20) + declIdx;
            }
          }

          // Also capture any content between previous region end and this start
          // (helper functions, variable declarations, comments between exports)
          // Use lastSkippedEnd to avoid including skipped nodes' source text in gaps
          if (regions.length > 0) {
            const prevEnd = Math.max(regions[regions.length - 1].end, lastSkippedEnd);
            if (start > prevEnd) {
              const gap = sourceText.slice(prevEnd, start).trim();
              if (gap) {
                regions.push({ start: prevEnd, end: start, isGap: true });
              }
            }
          } else if (i > 0) {
            // Check for content before the first emittable node
            // by looking at earlier body nodes' spans, but skip past any
            // skipped nodes (type-decl, component-def, meta)
            const firstMeta = body.find(s => s && isMetaKind(s.kind) && s.span);
            let gapStart = -1;
            if (firstMeta?.span) {
              const fmSpan = firstMeta.span as Span;
              gapStart = fmSpan.end;
            }
            // Ensure we don't include skipped node text in the gap
            gapStart = Math.max(gapStart, lastSkippedEnd);
            if (gapStart >= 0 && start > gapStart) {
              const gap = sourceText.slice(gapStart, start).trim();
              if (gap) {
                regions.push({ start: gapStart, end: start, isGap: true });
              }
            }
          }

          regions.push({ start, end: stmtSpan.end, isGap: false, kind: stmt.kind as string });
        }
      }

      // Emit all regions
      for (const region of regions) {
        let text = sourceText.slice(region.start, region.end).trim();
        if (!text) continue;

        // Post-process gap regions: compile scrml-specific syntax to JS
        if (region.isGap) {
          // Strip scrml type declarations. Two syntax forms exist:
          // 1. Spec syntax: `type Name:kind = { ... }` (colon after name, equals before braces)
          // 2. Legacy/self-host syntax: `type:kind Name { ... }` (colon after type keyword)
          text = text.replace(/\btype\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*\w+)?\s*=\s*\{[^]*?\}/g, "");
          text = text.replace(/\btype\s*:\s*(?:enum|struct)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\{[^]*?\}/g, "");
          // Convert `fn name` to `function name` for complete fn declarations in gaps
          text = text.replace(/\bfn\s+([A-Za-z_$])/g, "function $1");
          // Strip bare `fn` keywords that are fragments (fn keyword without a name —
          // the name is in the next node's span). These are artifacts of span splitting.
          text = text.replace(/\bfn\s*$/gm, "");
          text = text.trim();
          if (!text) continue;
        }

        // For non-gap regions, also convert fn keyword
        if (!region.isGap) {
          text = text.replace(/\bfn\s+([A-Za-z_$])/g, "function $1");
          // Strip trailing bare `fn` (artifact of overlapping AST spans —
          // the fn keyword for the next declaration leaks into this node's span)
          text = text.replace(/\bfn\s*$/g, "").trimEnd();
        }

        // Strip inline ^{ } meta expressions — replace with just the body content.
        // Must handle nested braces: ^{ JSON.stringify({ a, b }) } → JSON.stringify({ a, b })
        text = stripInlineMeta(text);

        // Rewrite scrml `not`/`is not`/`is some`/`is .Variant` keywords to JS equivalents
        // Apply per-line, skipping comment lines to avoid mangling English text
        text = text.split("\n").map(line =>
          line.trimStart().startsWith("//") ? line : rewriteIsOperator(rewriteNotKeyword(line))
        ).join("\n");

        lines.push(text);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Fallback path: emit from AST nodes (no source text available)
  // Used by unit tests with synthetic ASTs.
  // ---------------------------------------------------------------------------
  for (const logic of logicBlocks) {
    const body = (logic.body ?? []) as ASTNode[];
    for (const stmt of body) {
      if (!stmt) continue;
      if (isMetaKind(stmt.kind)) continue;

      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "E-CG-006",
          `E-CG-006: Server-only node (${stmt.kind as string}) found in library JS output.`,
          (stmt.span as Span) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
        continue;
      }

      if (stmt.kind === "export-decl") {
        const raw = ((stmt.raw ?? "") as string).trim();
        if (raw) {
          lines.push(raw);
          lines.push("");
        }
        continue;
      }

      if (stmt.kind === "function-decl") {
        // F1 (ast-builder-grammar-fixes): synthetic function-decls produced
        // by the EXPORT branch carry `fromExport: true`. The paired
        // export-decl already emits the full `export function foo() {...}`
        // source via its raw text, so emitting the function-decl too would
        // double-emit. Skip these synthetic nodes here.
        if ((stmt as Record<string, unknown>).fromExport === true) {
          continue;
        }
        const name = (stmt.name ?? "anon") as string;
        const params = (stmt.params ?? []) as Array<string | Record<string, unknown>>;
        const paramNames = params.map((p, i) =>
          typeof p === "string" ? p : ((p as Record<string, unknown>).name as string ?? `_scrml_arg_${i}`)
        );
        const generatorStar = stmt.isGenerator ? "*" : "";
        const asyncPrefix = stmt.isAsync ? "async " : "";
        lines.push(`${asyncPrefix}function${generatorStar} ${name}(${paramNames.join(", ")}) {`);
        const bodyStmts = (stmt.body ?? []) as ASTNode[];
        for (const bodyStmt of bodyStmts) {
          if (!bodyStmt) continue;
          if (isServerOnlyNode(bodyStmt)) continue;
          const code = emitLogicNode(bodyStmt);
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
        lines.push(`}`);
        lines.push("");
        continue;
      }

      const code = emitLogicNode(stmt);
      if (code) {
        lines.push(code);
      }
    }
  }

  return lines.join("\n");
}
