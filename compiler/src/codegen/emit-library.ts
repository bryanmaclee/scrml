import { CGError } from "./errors.ts";
import { getNodes } from "./collect.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";
import { emitLogicNode } from "./emit-logic.js";
import { emitEnumVariantObjects } from "./emit-client.js";
import { isServerOnlyNode, containsSqlOrTransaction } from "./collect.ts";
import { rewriteNotKeyword, rewriteIsOperator } from "./rewrite.ts";
import type { CompileContext } from "./context.ts";
// Seam-A colorless-async (GITI-037) — the structured async-fn emitter + its
// transitive coloring fixpoint (shared with emit-server ss1 / emit-tool), the
// per-file callee resolver, and the SERVER-mode stdlib auto-await classifier.
import { computeAsyncFnNames, computeNestedAsyncFnHolders, emitLibraryFnMember, collectNonAwaitableAsyncCalls, collectAliasedAsyncCalls, asyncStdlibSyncCallbackError, aliasedAsyncCallError } from "./emit-library-shared.ts";
import { buildCalleeImportMap } from "./scheduling.ts";
import { setServerAsyncClassifier } from "./emit-expr.ts";
import { asyncCombinatorHelperBlock } from "./async-combinators.ts";
// Runtime-helper SOURCES a structurally-emitted library member may reference.
// A library `.js` is an importable ES module with NO client runtime attached, so
// — exactly as `emit-tool.ts` does for a tool module — the helper DEFINITION has
// to travel with the emit or the reference is a ReferenceError at import time.
import { SERVER_STRUCTURAL_EQ_HELPER } from "./emit-server.ts";
import { SERVER_LOG_HELPER, SERVER_PRINT_HELPER } from "./log-loc.ts";

/** A loosely-typed AST node. */
type ASTNode = Record<string, unknown>;

/**
 * Phase-2 colorless-async — append any used collection-combinator helper
 * (`_scrml_someAsync` … `_scrml_flatMapAsync`) as a module FOOTER. JS function
 * declarations hoist to the module scope, so the helper is callable from the
 * user fns above it; the footer keeps user code first + the compiler runtime
 * last (readable). On-use + per-method (a module that lowers no async callback
 * carries none). Applied at every `generateLibraryJs` return.
 */
function withAsyncCombinators(moduleSrc: string): string {
  const block = asyncCombinatorHelperBlock(moduleSrc);
  return block ? moduleSrc + block : moduleSrc;
}

/**
 * Runtime helpers a LIBRARY module may reference, keyed by call signature —
 * the same on-demand table `emit-tool.ts` keeps (`TOOL_RUNTIME_HELPERS`), for
 * the same reason: a library `.js` is a bare importable ES module with NO client
 * runtime attached, so a `_scrml_*(…)` call the lowering emits is an
 * un-resolvable free identifier unless its DEFINITION ships with the module.
 *
 * ⚑ This became load-bearing when the fn router was widened to route by default
 * (see `emitControlFlowLibraryFns`). Under the old `match`-only opt-in almost
 * nothing routed, so the structural lowering's `==` → `_scrml_structural_eq(…)`
 * (SPEC §45, emitted for any operand pair not statically primitive) essentially
 * never reached a library module. Measured at this landing, routing by default
 * put an undefined `_scrml_structural_eq` reference into 28 corpus modules —
 * output that PARSES and then throws on first call, which is strictly worse than
 * the raw path's loud syntax error. Inlining the definition is what makes the
 * widening safe; `unmetRuntimeHelperRefs` covers everything NOT in this table.
 */
const LIB_RUNTIME_HELPERS: Array<{ sig: string; src: string }> = [
  { sig: "_scrml_structural_eq(", src: SERVER_STRUCTURAL_EQ_HELPER },
  { sig: "_scrml_log(", src: SERVER_LOG_HELPER },
  { sig: "_scrml_print(", src: SERVER_PRINT_HELPER },
];

/**
 * The `_scrml_*(…)` call references in `emitted` that this module can NOT
 * satisfy — i.e. neither an inlinable `LIB_RUNTIME_HELPERS` entry nor an
 * on-use async-combinator helper (`_scrml_<method>Async`, appended by
 * `withAsyncCombinators`).
 *
 * ⚑ READ THE EMITTED BYTES, DO NOT RE-DERIVE THE PREDICATE. Asking "would this
 * fn's lowering need a runtime helper?" from the AST means maintaining a second,
 * silently-drifting copy of every lowering rule in emit-expr / emit-logic. The
 * emitted text is the ground truth and it is already in hand. (Same discipline
 * as `emitMultiScrutineeMatch`'s IIFE-header async scan.)
 *
 * The live case is a `@cell` read/write inside a library fn: the lowering emits
 * `_scrml_reactive_get("x")` / `_scrml_reactive_set("x", …)`, which belong to the
 * browser reactive runtime a library module does not have and cannot inline (a
 * reactive cell is a live graph node, not a pure function). Such a fn stays on
 * the raw path, where its `@x` leaks verbatim and fails LOUDLY — the honest
 * outcome until a library-mode ruling on `@`-cells exists.
 */
/**
 * Un-lowered scrml-only syntax left in an otherwise-accepted structural emit —
 * the companion gate to `unmetRuntimeHelperRefs`, for constructs that need no
 * runtime helper and so slip past it.
 *
 * ⚑ THE ONE THAT FORCED THIS: `!{ … }` (a guarded expression). Measured on
 * `let v: int = !{ n }` in a match-free library fn:
 *
 *   base  `let v: int = !{ n }`   INVALID JS — fails loudly the moment it is imported
 *   arc   `let v = !{n};`         VALID JS. `!` applied to an object literal, so it
 *                                 evaluates to `false`, ALWAYS, in a fn typed `-> int`
 *
 * Both at exit 0 with ZERO diagnostics. The structural path re-prints the guard's
 * inner text without lowering it, and `!{…}` happens to be syntactically legal
 * JavaScript — which is exactly what makes it worse than the leak it replaced.
 * Turning a LOUD failure into a SILENT WRONG ANSWER is the one direction this
 * widening must never move in, and it is the same argument the
 * `LIB_RUNTIME_HELPERS` comment above makes for `_scrml_structural_eq`; that
 * guard simply cannot see a construct with no `_scrml_*` reference to catch.
 *
 * Read the EMITTED BYTES rather than the AST, for the reason
 * `unmetRuntimeHelperRefs` states — and here additionally because a guarded-expr's
 * node shape is not reliably visible where the router runs.
 */
function unloweredScrmlSyntax(emitted: string): string[] {
  const found: string[] = [];
  // `!{` — a guarded expression that did not lower. Legal JS, always falsy.
  if (/!\s*\{/.test(emitted)) found.push("!{ } guarded expression");
  // `_={` — foreign code that did not lower (belt-and-braces; the router already
  // excludes foreign-bearing fns by AST, this catches any path that gets past it).
  if (/_=\s*\{/.test(emitted)) found.push("_={ }= foreign block");
  return found;
}

function unmetRuntimeHelperRefs(emitted: string): string[] {
  const unmet = new Set<string>();
  const re = /\b(_scrml_[A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(emitted)) !== null) {
    const name = m[1];
    if (LIB_RUNTIME_HELPERS.some((h) => h.sig === `${name}(`)) continue;
    if (/^_scrml_[a-zA-Z]+Async$/.test(name)) continue; // async-combinator footer
    unmet.add(name);
  }
  return [...unmet];
}

/**
 * Append the definition of every `LIB_RUNTIME_HELPERS` entry the module body
 * actually references. On-use + per-helper: a module whose lowering emits none
 * of them carries none of them, so a library file this landing does not touch
 * stays byte-for-byte as it was. Mirrors `emit-tool.ts`'s
 * `buildRuntimeHelperHeader`, and is placed as a FOOTER for the same reason
 * `withAsyncCombinators` is — every entry is a `function` DECLARATION, which
 * hoists to module scope, so trailing placement keeps user code first and the
 * compiler runtime last without any resolution hazard.
 */
function withRuntimeHelpers(moduleSrc: string): string {
  let out = moduleSrc;
  for (const { sig, src } of LIB_RUNTIME_HELPERS) {
    if (moduleSrc.includes(sig)) out += "\n" + src;
  }
  return out;
}

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
 * (E-CODEGEN-INVALID-LOGIC). Browser mode lowers it via emit-logic.ts's
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
 * §23.6 (S238) — collect the inline value-returning `_={ … }=` foreign-code
 * nodes reachable from a library logic block. These are attached as a
 * `foreignNode` on the enclosing `const`/`let`-decl or `return-stmt` (the
 * §23.2.2 attachment, mirroring `sqlNode` for `?{}`). The library whole-block
 * slicer below emits raw source text, so without lowering the `_={ … }=` opener
 * would leak into the importable `.js` verbatim (invalid) rather than emitting
 * the §23.2.4a async-IIFE. We collect each attached foreign node here and splice
 * its emit-logic `case "foreign"` lowering over its raw span — exactly as the
 * guarded-expr path splices `!{}` lowerings. The `_{}` lang resolves against the
 * file's top-level `<foreign lang=…>` (§23.6; stamped by the typer).
 *
 * Only the value-returning ATTACHED form is collected: a BARE `kind:"foreign"`
 * statement is E-FOREIGN-004 (rejected upstream — never reaches clean codegen).
 */
function collectForeignNodes(node: unknown, out: ASTNode[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectForeignNodes(child, out);
    return;
  }
  const n = node as ASTNode;
  const fn = n.foreignNode as ASTNode | undefined;
  if (fn && fn.kind === "foreign") out.push(fn);
  for (const k of Object.keys(n)) {
    if (k === "foreignNode") continue; // already captured above
    const v = (n as Record<string, unknown>)[k];
    if (v && typeof v === "object") collectForeignNodes(v, out);
  }
}

/** True when `node`'s subtree contains an attached `foreignNode` (§23.2.2). */
function subtreeHasForeign(node: unknown): boolean {
  const found: ASTNode[] = [];
  collectForeignNodes(node, found);
  return found.length > 0;
}

/**
 * §23.6 (S238) — locate the `fn`/`function` keyword offset of every
 * `function-decl` whose body holds an inline `_={ … }=` foreign node. The
 * lowered foreign IIFE injects a boundary `await` (§23.2.4a), so these exports
 * must emit `async`. Returns `{ start, keywordLen }` where `start` is the
 * keyword offset in `sourceText` and `keywordLen` is 2 (`fn`) or 8 (`function`)
 * — the caller splices the keyword to `async function`.
 */
function collectAsyncFnKeywordTargets(
  logicBody: unknown,
  sourceText: string,
): Array<{ start: number; keywordLen: number }> {
  const out: Array<{ start: number; keywordLen: number }> = [];
  const seen = new Set<number>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    const n = node as ASTNode;
    if (n.kind === "function-decl" && subtreeHasForeign(n)) {
      const sp = n.span as Span | undefined;
      if (sp && typeof sp.start === "number" && !seen.has(sp.start)) {
        // The function-decl span starts at the `fn`/`function` keyword (the
        // `export`/`pure`/`server` modifiers sit BEFORE it — see §21.5.1). An
        // already-`async` keyword needs no rewrite.
        const head = sourceText.slice(sp.start, sp.start + 9);
        if (/^fn\b/.test(head)) { out.push({ start: sp.start, keywordLen: 2 }); seen.add(sp.start); }
        else if (/^function\b/.test(head)) { out.push({ start: sp.start, keywordLen: 8 }); seen.add(sp.start); }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span") continue;
      const v = (n as Record<string, unknown>)[k];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(logicBody);
  return out;
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
 * E-CODEGEN-INVALID-LOGIC emit gate. Such a fn lives ONLY in the `.server.js`
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
  errors: CGError[],
  extraRemovals: Array<{ start: number; end: number }> = [],
): string {
  // Seam-A colorless-async — `extraRemovals` are the NON-SQL async fns that
  // route through the structured `emitLibraryFnMember` (appended by the caller).
  // Merging them here BEFORE the guarded-expr lowering means a `!{}` inside an
  // async fn is SKIPPED (its span falls inside a removal) — emitLibraryFnMember
  // lowers it structurally instead, so it is not double-lowered here.
  const removals = [...collectSqlFnRemovalRanges(logicBody, sourceText), ...extraRemovals];

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

  // g-library-mode-toplevel-decl-match-leaks — a TOP-LEVEL `const/let X = match …`
  // (`node.matchExpr` on a const-/let-decl) is NOT a function-decl, so
  // `emitControlFlowLibraryFns` (which prunes + APPENDS the lowered fn — safe
  // because function declarations hoist) never routes it, and the raw `match`
  // leaks its scrml syntax into the library `.js` → §2.2.1 E-CODEGEN-INVALID-LOGIC.
  // A `const`/`let` does NOT hoist, so it must be lowered IN PLACE — hence a splice
  // here (not an append). Reuse the SAME browser decl lowering the emit-logic
  // const-/let-decl `matchExpr` arm uses (`emitLogicNode` → `emitMatchExprDecl`,
  // the tilde form `let _scrml_tilde = null; …; ${kw} X = _scrml_tilde;`), span-
  // spliced over the raw decl. The tilde form places each arm body in EXPRESSION
  // position, so a brace-delimited arm result (an object literal / block-body arm)
  // is a value, not a statement block that silently returns undefined. Nested
  // `const = match` inside a fn body is already handled (its fn routes structurally
  // via emitControlFlowLibraryFns), so only the top-level `logicBody` children are
  // scanned here. `match` lowers correctly cross-mode — library↔browser parity, no
  // language surface. Two parser shapes: a NON-export decl arrives as a const-/
  // let-decl carrying `matchExpr`; an EXPORT decl arrives SPLIT (export-decl + a
  // sibling match-stmt) and is re-associated below.
  if (Array.isArray(logicBody)) {
    const declBody = logicBody as ASTNode[];
    const spanOf = (n: ASTNode | undefined): Span | null => {
      const sp = n?.span as Span | undefined;
      return sp && typeof sp.start === "number" && typeof sp.end === "number" ? sp : null;
    };
    const insideRemoval = (sp: Span): boolean =>
      removals.some((r) => sp.start >= r.start && sp.end <= r.end);
    // A `match`/decl node span can OVERSHOOT its closing `}` into the start of the
    // NEXT statement (a parser span-accuracy quirk — filed g-match-decl-span-
    // overshoots-next-statement). Splicing on the raw end would clobber the next
    // decl's leading keyword. Trim back to the match's own closing `}`: it is the
    // last `}` at or before the span end, and the overshoot region is a
    // next-statement opener (`const`/`let`/`export`/identifier) that never holds a
    // `}`, so this is deterministic.
    const matchCloseEnd = (end: number): number => {
      const b = sourceText.lastIndexOf("}", end - 1);
      return b >= 0 ? b + 1 : end;
    };
    // The tilde lowering (emitMatchExprDecl) can be MULTI-LINE — module-local temps
    // (`let _scrml_tilde_N = null; …`) followed by the final `${kw} ${name} = …;`
    // binding. To EXPORT such a decl, only the FINAL binding gets the `export `
    // keyword (the temps must stay module-local). Prefix the last `${kw} ${name} =`
    // statement; a single-line lowering (`const X = <IIFE>`) is prefixed at its head.
    const exportify = (lowered: string, kw: string, name: string): string => {
      const marker = `${kw} ${name} = `;
      const idx = lowered.lastIndexOf(marker);
      return idx >= 0 ? lowered.slice(0, idx) + "export " + lowered.slice(idx) : `export ${lowered}`;
    };
    for (let di = 0; di < declBody.length; di++) {
      const node = declBody[di];
      if (!node) continue;
      const o = node as Record<string, unknown>;
      // Shape 1 — NON-export `const/let X = match …`: a const-/let-decl carrying a
      // `matchExpr` init (the same node the browser emit-logic decl arm consumes).
      if ((node.kind === "const-decl" || node.kind === "let-decl") && o.matchExpr) {
        const sp = spanOf(node);
        if (!sp || insideRemoval(sp)) continue;
        const name = typeof o.name === "string" ? o.name : null;
        if (!name) continue; // destructure LHS — leave to the raw path (out of scope)
        // Lower via the SAME browser decl path (emitLogicNode → emitMatchExprDecl,
        // the tilde form): it places each arm body in EXPRESSION position
        // (`_scrml_tilde = <arm>`), so a brace-delimited arm result — an object
        // literal `{ x: 1 }` or a block-body arm — is a value, not a statement
        // block that returns undefined (which a bare `return <arm>` IIFE would
        // silently produce). This is the cross-mode parity the gap requires.
        const lowered = emitLogicNode(
          node as Parameters<typeof emitLogicNode>[0],
          {} as Parameters<typeof emitLogicNode>[1],
        );
        if (lowered == null) continue;
        ops.push({ start: sp.start, end: matchCloseEnd(sp.end), text: lowered });
        continue;
      }
      // Shape 2 — EXPORT `export const/let X = match …`: the parser splits this into
      // an `export-decl` whose `raw` ends at the `=` (init NOT captured) IMMEDIATELY
      // followed by a sibling `match-stmt` node — the binding is disassociated from
      // its match init (browser drops the binding for the same reason). Re-associate
      // + lower to the value-IIFE, splicing over BOTH spans as one `export const X = …`.
      if (
        node.kind === "export-decl" &&
        (o.exportKind === "const" || o.exportKind === "let") &&
        typeof o.exportedName === "string" &&
        typeof o.raw === "string" && /=\s*$/.test(o.raw as string)
      ) {
        const next = declBody[di + 1];
        if (next && next.kind === "match-stmt") {
          const sp = spanOf(node);
          const nsp = spanOf(next);
          if (sp && nsp && !insideRemoval(sp) && !insideRemoval(nsp)) {
            const kw = o.exportKind as string;
            const name = o.exportedName as string;
            // Re-associate: synthesize the const-/let-decl the parser did NOT build
            // and lower it through the SAME tilde path as Shape 1 (correct for
            // brace-delimited arm bodies). Then export-prefix the final binding and
            // splice over `export … = match …` from the `export` keyword itself
            // (found by scanning back from the decl span) so no double-`export`.
            const synthetic = { kind: kw === "let" ? "let-decl" : "const-decl", name, matchExpr: next, span: { start: sp.start, end: matchCloseEnd(nsp.end) } };
            const lowered = emitLogicNode(
              synthetic as unknown as Parameters<typeof emitLogicNode>[0],
              {} as Parameters<typeof emitLogicNode>[1],
            );
            if (lowered != null) {
              const exportKw = sourceText.lastIndexOf("export", sp.start);
              const spliceStart = exportKw >= 0 ? exportKw : sp.start;
              ops.push({ start: spliceStart, end: matchCloseEnd(nsp.end), text: exportify(lowered, kw, name) });
              di++; // consume the match-stmt too
            }
          }
        }
      }
    }
  }

  // §23.6 (S238) — lower each inline value-returning `_={ … }=` foreign block to
  // its §23.2.4a async-IIFE (emit-logic `case "foreign"`) and splice it over the
  // raw `_={ … }=` span. Skip any foreign node inside a pruned server-fn span
  // (that fn's whole body lives in `.server.js`, where emit-server lowers the
  // foreign node itself — lowering here would splice into removed text). The
  // lowered IIFE is clean JS (no scrml `not`/`is`/`fn`/`type` keywords) so it
  // survives the downstream whole-block regex-transform pipeline.
  //
  // The lowering INJECTS the §23.2.4a boundary `await`, so the enclosing library
  // export MUST become `async` (a `fn` emitted plain would carry a top-level
  // `await` in a non-async function — invalid JS). We collect the fn-keyword
  // offset of every function whose body holds a foreign node and rewrite its
  // `fn`/`function` keyword to `async function` (the whole-block path's later
  // `fn`→`function` regex leaves `async function` alone).
  const foreignNodes: ASTNode[] = [];
  collectForeignNodes(logicBody, foreignNodes);
  const insideRemoval = (start: number, end: number): boolean =>
    removals.some((r) => start >= r.start && end <= r.end);
  // E-FOREIGN-006 crossing-shadow sink (§23.2.4a) — a dedicated narrow sink,
  // drained into `errors` after lowering. Without it, emit-logic `case "foreign"`
  // silently SKIPS the shadow check (`if (shadowed.length > 0 && sink)`) and
  // emits a redeclaring IIFE, surfacing later as the misleading
  // E-CODEGEN-INVALID-LOGIC "compiler defect". Mirrors emit-server's wiring.
  const foreignCrossingErrors: CGError[] = [];
  // NB: no `.prepare()` (E-SQL-006) sink is threaded here — this loop lowers ONLY
  // FOREIGN nodes (`collectForeignNodes` → emit-logic `case "foreign"`), which can
  // never dispatch to `case "sql"`, so it cannot produce an E-SQL-006. The live
  // `.prepare()` sinks are on the fn-body-emit paths (emit-library fn members,
  // emit-server, emit-tool), not this foreign-splice loop.
  for (const f of foreignNodes) {
    const sp = f.span as Span | undefined;
    if (!sp || typeof sp.start !== "number" || typeof sp.end !== "number") continue;
    if (insideRemoval(sp.start, sp.end)) continue;
    const lowered = emitLogicNode(
      f as Parameters<typeof emitLogicNode>[0],
      { foreignCrossingErrors } as unknown as Parameters<typeof emitLogicNode>[1],
    );
    if (lowered == null) continue;
    // Drop a trailing `;` — the foreign node span sits mid-expression (the RHS of
    // a `const`/`let` decl or a `return`), so a statement terminator here would
    // split the surrounding statement.
    ops.push({ start: sp.start, end: sp.end, text: lowered.replace(/;\s*$/, "") });
  }
  // Drain the crossing-shadow diagnostics into the live error stream. When a
  // shadow fired, emit-logic returned a `null /* E-FOREIGN-006 … */` sentinel
  // (spliced above) so the surrounding statement stays well-formed while the
  // named error stops the build.
  for (const e of foreignCrossingErrors) errors.push(e);

  // Async-mark every function whose body holds a (non-removed) foreign node.
  if (foreignNodes.length > 0) {
    const asyncSpliced = new Set<number>();
    for (const fn of collectAsyncFnKeywordTargets(logicBody, sourceText)) {
      if (insideRemoval(fn.start, fn.start + fn.keywordLen)) continue;
      if (asyncSpliced.has(fn.start)) continue;
      asyncSpliced.add(fn.start);
      // `fn X` → `async function X`; `function X` → `async function X`.
      ops.push({ start: fn.start, end: fn.start + fn.keywordLen, text: "async function" });
    }
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

/** MOD per-module by-name export metadata (the `isAsync` source of truth). */
type LibExportRegistry = Map<
  string,
  Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>
>;

/**
 * Seam-A colorless-async (GITI-037) — the library-mode STRUCTURED async emit.
 *
 * The whole-block text-splice path (below) emits a fn's body VERBATIM, so a fn
 * calling a Promise-returning stdlib primitive (`safeCallAsync`, a `scrml:auth`/
 * `scrml:http` async export) — directly OR transitively through a local peer —
 * was left sync + un-awaited: the Promise leaked (`r.ok === undefined`). This
 * routes every such NON-SQL async fn through the SAME structured
 * `emitLibraryFnMember` the ss1 / tool paths use, which colors it `async` and
 * awaits both the stdlib call AND its transitive async peers (the coloring +
 * await machinery unified on `computeAsyncFnNames`).
 *
 * Returns the source SPANS to prune from the block text (the caller merges them
 * into `pruneServerFnsAndLowerGuarded` so the verbatim copy is removed) plus the
 * structured JS to append. A `?{}`/transaction async fn is NOT routed here — it
 * is pruned to `.server.js` by `collectSqlFnRemovalRanges`; only pure/host-call
 * async fns stay in the client-facing library `.js`.
 *
 * No-silent-leak guard (axis-i): a stdlib-async call in a NON-awaitable position
 * (a sync `.some`/`.find`/`.map` callback body or a parameter default) cannot be
 * auto-awaited — emit-expr records it into the classifier's `syncCallSink`, which
 * we drain into a fatal `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` rather than leak.
 */
function emitAsyncLibraryFns(
  logicBody: unknown,
  sourceText: string,
  calleeMap: Map<string, string> | null,
  exportRegistry: LibExportRegistry | null,
  crossImportSeed: Set<string> | undefined,
  filePath: string,
  errors: CGError[],
): { removals: Array<{ start: number; end: number }>; lines: string[]; routedNames: Set<string> } {
  const none = { removals: [] as Array<{ start: number; end: number }>, lines: [] as string[], routedNames: new Set<string>() };
  if (!Array.isArray(logicBody) || !calleeMap || !exportRegistry || exportRegistry.size === 0) {
    return none;
  }
  // All function-decl nodes (exported via `fromExport` + local helpers) feed the
  // transitive fixpoint — a plain exported fn may reach a stdlib-async call only
  // through a local peer, so the peer must be in the coloring set too.
  const fns: ASTNode[] = [];
  for (const node of logicBody as ASTNode[]) {
    if (node && node.kind === "function-decl" && typeof node.name === "string") fns.push(node);
  }
  if (fns.length === 0) return none;
  // Coloring: `?{}`/foreign/isAsync seed UNION `crossImportSeed` (Seam-A Gap 3 —
  // the LOCAL names binding an async fn imported from another lib / a `scrml:`
  // vendor primitive, so a fn calling one is colored + its call awaited) UNION the
  // Gap-1 stdlib-Promise seed, then the call-graph fixpoint.
  // GITI-038 — Q1 (OWN-signature async): `guardNestedFnValues=true` so a nested
  // returned/held closure's async call does NOT color its enclosing factory. Q2
  // (needs AST re-emission) is `asyncFnNames` ∪ the nested-async-closure holders
  // (`composeFail` returns `dispatch` whose body awaits `safeCallAsync`): the factory
  // is non-async but MUST leave the verbatim path so `dispatch` picks up `async`+
  // `await` (verbatim would ship a bare Promise into the `!{}` check).
  const asyncFnNames = computeAsyncFnNames(fns, sourceText, crossImportSeed, calleeMap, exportRegistry, undefined, /*guardNestedFnValues*/ true);
  const nestedAsyncHolders = computeNestedAsyncFnHolders(fns, asyncFnNames, calleeMap, exportRegistry);

  // No-silent-leak backstop (bucket c) — run the structural detectors over ALL fns
  // (NOT just the colored ones): after [4] a raw-verbatim-body async call no longer
  // COLORS its fn, but it is still an unawaitable async boundary that must fail
  // closed. A param-default / sync-callback / raw-body async call → fail closed; an
  // indirect async call via a local alias (finding 6) → fail closed. Deduped
  // against the shared error stream (both generateLibraryJs and the ss1 path scan
  // the same fn body). Runs before the emit early-returns so a file whose ONLY
  // async signal is unawaitable still reports.
  const pushDeduped = (err: CGError): void => {
    const es = err.span as { start?: number };
    const dup = errors.some((x) => x.code === err.code && (x.span as { start?: number })?.start === es?.start);
    if (!dup) errors.push(err);
  };
  for (const fn of fns) {
    for (const site of collectNonAwaitableAsyncCalls(fn.body, calleeMap, exportRegistry, asyncFnNames, fn.params, fn.span)) {
      pushDeduped(asyncStdlibSyncCallbackError(site.name, site.span, filePath));
    }
    for (const a of collectAliasedAsyncCalls(fn.body, calleeMap, exportRegistry, asyncFnNames)) {
      pushDeduped(aliasedAsyncCallError(a.alias, a.resolved, a.span, filePath));
    }
  }

  if (asyncFnNames.size === 0 && nestedAsyncHolders.size === 0) return none;
  // Route NON-SQL fns that are async OR hold a nested async closure (GITI-038 Q2) —
  // a `?{}`/transaction body is pruned to `.server.js` by collectSqlFnRemovalRanges
  // (a client-facing raw `?{}` is invalid JS, §2.2.1).
  const toEmit = fns.filter(
    (fn) =>
      (asyncFnNames.has(fn.name as string) || nestedAsyncHolders.has(fn.name as string)) &&
      !containsSqlOrTransaction(fn),
  );
  if (toEmit.length === 0) return none;

  // Install the SERVER-mode stdlib auto-await classifier (+ fail-closed sink) so
  // emit-expr's `emitCall` auto-awaits the stdlib call inside the structured
  // body. Restored in `finally` (re-entrancy hygiene — a nested compile must not
  // inherit this file's map). Mirrors emit-server generateServerJs (:1119).
  const syncCallSink: Array<{ name: string; span: unknown }> = [];
  const prevClassifier = setServerAsyncClassifier({ calleeMap, exportRegistry, syncCallSink });
  const foreignCrossingErrors: unknown[] = [];
  // E-SQL-006 (§44.3) — dedicated narrow .prepare() sink (mirror of
  // `foreignCrossingErrors`), drained into `errors` after lowering.
  const preparedStmtErrors: unknown[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  const outLines: string[] = [];
  try {
    for (const fn of toEmit) {
      const sp = fn.span as Span | undefined;
      if (!sp || typeof sp.start !== "number" || typeof sp.end !== "number") continue;
      // Swallow a leading `export`/`pure`/`server` modifier (§21.5.1) — the
      // decl span starts at `function`/`fn` (mirrors collectSqlFnRemovalRanges).
      const lookback = sourceText.slice(Math.max(0, sp.start - 40), sp.start);
      const m = lookback.match(/((?:export\s+)?(?:pure\s+)?(?:server\s+)?)$/);
      const prefixLen = m ? m[1].length : 0;
      removals.push({ start: sp.start - prefixLen, end: sp.end });
      outLines.push(
        emitLibraryFnMember(fn, {
          isExported: fn.fromExport === true,
          asyncFnNames,
          foreignCrossingErrors,
          preparedStmtErrors,
          // GITI-038 — a nested-async-closure holder that is NOT itself async: emit
          // its body server-side (nested await legal) but keep its OWN signature sync.
          nonAsyncReemit:
            !asyncFnNames.has(fn.name as string) && nestedAsyncHolders.has(fn.name as string),
        }),
      );
    }
  } finally {
    setServerAsyncClassifier(prevClassifier);
  }
  // E-FOREIGN-006 crossing-shadow diagnostics from lowering an async fn body.
  for (const e of foreignCrossingErrors) if (e) errors.push(e as CGError);
  // E-SQL-006 .prepare() diagnostics from lowering an async fn body.
  for (const e of preparedStmtErrors) if (e) errors.push(e as CGError);
  return { removals, lines: outLines, routedNames: new Set(toEmit.map((f) => f.name as string)) };
}

/**
 * §18 / §7.5 / §14.10 cross-mode parity — route library function-decls through
 * the SAME structured `emitLibraryFnMember` the async / server / tool paths use,
 * instead of letting the whole-block text slicer emit their bodies VERBATIM.
 * Mirrors `emitAsyncLibraryFns`: returns the source SPANS to prune (the caller
 * merges them into the prune pass so the verbatim copy is removed) plus the
 * structured JS to append.
 *
 * ⚑ THE ROUTING POLARITY IS THE POINT, AND IT IS DELIBERATELY INVERTED FROM
 * WHAT THIS FUNCTION USED TO DO. It used to route a fn only when its body held
 * a `match` (`fnBodyContainsMatch`), i.e. one opt-in per construct someone
 * happened to trip over. That made the file's history a splice-pass-per-
 * construct: `!{}` guarded-expr, `_={}=` foreign, top-level `const = match`,
 * SQL fns, `match` — each a separate discovery, each a separate patch, and each
 * one leaving the NEXT scrml-only construct to leak verbatim into the importable
 * `.js`. Two more members of that same class were open when this landed:
 *   · a LOCAL type annotation — `let acc: int = …` (§7.5: *"Type annotations
 *     appear on variable declarations, function parameters, and function return
 *     types throughout scrml logic contexts"*). `cleanFnSignatures` strips the
 *     SIGNATURE annotations only, so the local's `: int` shipped verbatim.
 *   · bare/payload variant construction — `return .Ok(n)` (§14.10: *"A bare
 *     variant reference SHALL be resolved by the compiler when the type at the
 *     position can be inferred from … a function return type"*). `.Ok(n)`
 *     shipped verbatim.
 * Both are ALREADY LOWERED CORRECTLY by `emitLibraryFnMember` — the identical
 * body with a dummy `match` bolted on compiled clean and emitted `let acc = n *
 * 2;` / `return { variant: "Ok", data: { n: n } };`. The lowering was never
 * missing; only the routing predicate was.
 *
 * So the predicate is now "route UNLESS we must not", and every exclusion is
 * named with its reason (`rawFallbackReason`). Selection stays disjoint from the
 * async / SQL routers by construction:
 *   - `alreadyRouted` names are the async / nested-async-holder fns emitted
 *     structurally above — skip them.
 *   - a `?{}` / transaction fn is pruned to `.server.js` by
 *     `collectSqlFnRemovalRanges` (its whole body) — skip it.
 *
 * Detection is by AST node kind, NOT by span-splicing an inner node: an inner
 * node's own span bleeds across the enclosing `return ` and the fn's trailing
 * brace, so re-emitting the WHOLE fn from the AST (which the shared member
 * emitter already does correctly) is the sound unit.
 */
function emitControlFlowLibraryFns(
  logicBody: unknown,
  sourceText: string,
  alreadyRouted: Set<string>,
): { removals: Array<{ start: number; end: number }>; lines: string[] } {
  const removals: Array<{ start: number; end: number }> = [];
  const outLines: string[] = [];
  if (!Array.isArray(logicBody)) return { removals, lines: outLines };
  const emptyAsync = new Set<string>();
  for (const node of logicBody as ASTNode[]) {
    if (!node || node.kind !== "function-decl" || typeof node.name !== "string") continue;
    if (alreadyRouted.has(node.name)) continue;
    if (containsSqlOrTransaction(node)) continue;
    if (rawFallbackReason(node) !== null) continue;
    // ⚑ The span is VERIFIED against the source before it is spliced — see
    // `verifiedFnRemovalRange`. An unverifiable span means we cannot excise the
    // verbatim copy safely, so the fn stays on the raw path (inert) rather than
    // shipping a corrupted splice.
    const range = verifiedFnRemovalRange(node, sourceText);
    if (!range) continue;
    const emitted = emitLibraryFnMember(node, {
      isExported: node.fromExport === true,
      asyncFnNames: emptyAsync,
    });
    // ⚑ The LAST gate, and it reads the EMITTED BYTES rather than re-deriving a
    // predicate: if the structural lowering reached for a runtime helper this
    // module cannot ship (a `@cell` → `_scrml_reactive_get`, say), the emit
    // would PARSE and then throw on first call. Discard it and leave the fn on
    // the raw path, where the same construct fails loudly instead.
    if (unmetRuntimeHelperRefs(emitted).length > 0) continue;
    // ⚑ Companion gate: scrml-only syntax the structural path re-printed WITHOUT
    // lowering, which needs no runtime helper and so is invisible to the check
    // above. `!{ … }` is the live case and it is the worst possible shape —
    // legal JavaScript that is always `false`. Fall back to raw, where the same
    // construct fails loudly. See `unloweredScrmlSyntax`.
    if (unloweredScrmlSyntax(emitted).length > 0) continue;
    removals.push(range);
    outLines.push(emitted);
  }
  return { removals, lines: outLines };
}

/**
 * Compute the source range to excise for a routed library fn — INCLUDING its
 * `export`/`pure`/`server` modifier prefix (§21.5.1, which sits BEFORE the
 * function-decl span) — and return `null` when the AST span cannot be shown to
 * cover exactly that function's own text.
 *
 * ⚑ THIS GUARD EXISTS BECAUSE `function-decl` SPANS ARE NOT RELIABLE, AND THE
 * FAILURE IS SILENT TEXT CORRUPTION RATHER THAN A DIAGNOSTIC. Measured on
 * `compiler/native-parser/ast-expr.scrml` at this landing: every top-level
 * `export fn` there reports a span whose `start` is ~22 chars INSIDE its own
 * parameter list and whose `end` overshoots its closing `}` into the FOLLOWING
 * statement's comment (`makeIdent` → `start` at `n) {`, `end` inside
 * `// makeNumberL`). Splicing on those offsets emits
 * `export function makeIdent(name, spait — numeric literal.` — a mangled file
 * that is neither the raw text nor the structural emit. The sibling
 * `g-match-decl-span-overshoots-next-statement` note above records the same
 * defect class for match/decl spans; this is the function-decl limb of it.
 *
 * The routing widening (route-by-default) is what makes the guard necessary:
 * under the old `match`-only opt-in almost nothing in the corpus routed, so the
 * bad spans were never exercised. Widening the router without verifying the span
 * would have converted a leak into a corruption — strictly the worse direction.
 *
 * Verification is three cheap invariants over the candidate slice, ALL of which
 * hold for a correctly-spanned declaration and all of which the measured bad
 * spans fail:
 *   1. it STARTS with this fn's own declaration head — an optional
 *      `export`/`pure`/`server`/`async` modifier run, then `fn`/`function`,
 *      then (allowing a generator `*`) this node's own NAME;
 *   2. it ENDS at a `}`;
 *   3. its braces BALANCE (equal `{` / `}` counts) — this catches an `end` that
 *      overshoots to some LATER closing brace, which invariants 1 and 2 would
 *      both accept.
 * Invariant 3 is deliberately crude: a brace inside a string literal or comment
 * can unbalance a legitimate fn. That mis-fires toward the RAW fallback, which
 * is byte-identical to today's output — the safe direction — so a false
 * rejection costs an unlowered construct, never a corrupted emit.
 *
 * ⚑ RESIDUAL, FILED not fixed: `emitAsyncLibraryFns` and
 * `collectSqlFnRemovalRanges` splice on the SAME unverified spans and are NOT
 * guarded here. They route far fewer fns (async / `?{}`-bearing only), so the
 * hazard is pre-existing and unchanged by this landing; widening the guard to
 * them changes output for files this change is otherwise inert on, which is a
 * separate measurement. See `g-library-fn-decl-span-unverified-splice`.
 */
function verifiedFnRemovalRange(
  node: ASTNode,
  sourceText: string,
): { start: number; end: number } | null {
  const sp = node.span as Span | undefined;
  if (!sp || typeof sp.start !== "number" || typeof sp.end !== "number") return null;
  if (sp.end <= sp.start || sp.end > sourceText.length) return null;
  const name = node.name as string;
  // Swallow a leading `export`/`pure`/`server` modifier (§21.5.1) — the decl
  // span starts at `function`/`fn` (mirrors emitAsyncLibraryFns / collectSqlFnRemovalRanges).
  const lookback = sourceText.slice(Math.max(0, sp.start - 40), sp.start);
  const m = lookback.match(/((?:export\s+)?(?:pure\s+)?(?:server\s+)?)$/);
  const start = sp.start - (m ? m[1].length : 0);
  const slice = sourceText.slice(start, sp.end);
  // (1) the slice opens with THIS fn's declaration head.
  const head = new RegExp(
    `^(?:export\\s+)?(?:pure\\s+)?(?:server\\s+)?(?:async\\s+)?(?:fn|function)\\s*\\*?\\s*${
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }\\b`,
  );
  if (!head.test(slice)) return null;
  // (2) the slice closes on the declaration's closing brace.
  if (!slice.trimEnd().endsWith("}")) return null;
  // (3) braces balance across the slice.
  let depth = 0;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  return { start, end: sp.end };
}

/**
 * The RAW-TEXT FALLBACK predicate — returns a stated REASON string when a
 * library fn must stay on the whole-block verbatim path, or `null` when it
 * routes structurally (the default).
 *
 * This is the inverse of the old `fnBodyContainsMatch` opt-in, and the inversion
 * is the fix: an opt-in predicate has to be widened once per scrml construct
 * anybody trips over, so every construct nobody has tripped over yet leaks
 * verbatim into the importable `.js`. An opt-OUT predicate leaks only what is
 * NAMED here, with the reason attached.
 *
 * ⚑ THE ONE STANDING EXCLUSION — `if`-EXPRESSION-VALUE FORMS (`node.ifExpr` on a
 * `let`/`const` decl, lowered by emit-logic's `emitIfExprDecl`). Browser mode's
 * `if`-expression-value lowering is itself broken: an `if`-bound `let` compiles,
 * but the arm values assign to fresh block-scoped temps, so the binding stays
 * `null` at runtime — a SILENT-WRONG in both modes. The verbatim path, by
 * contrast, emits a plain JS `if` statement that is at least syntactically
 * valid. Routing an `if`-bearing fn here would therefore trade a working-or-
 * loudly-broken emit for a quietly-wrong one — the dangerous direction. It stays
 * raw until the shared `emitIfExprDecl` lowering is fixed; that is a lowering
 * fix, not a routing one.
 *
 * `match` lowers correctly in browser mode (byte- and run-identical), as do
 * local type annotations, bare/payload variant construction, `is`/`given`
 * operators, and struct literals — hence the default.
 */
function rawFallbackReason(fnNode: ASTNode): string | null {
  let reason: string | null = null;
  const walk = (n: unknown): void => {
    if (reason !== null || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    const o = n as Record<string, unknown>;
    if (o.ifExpr) {
      // g-if-expression-value-binding-lowers-null — see the block comment above.
      reason = "if-expression-value binding (emitIfExprDecl lowers to null)";
      return;
    }
    // ⚑ `_={ … }=` FOREIGN CODE — and this exclusion is the one that keeps the
    // widening honest. `emitLibraryFnMember` lowers a fn body at the CLIENT
    // boundary, and `emit-logic.ts` gates the real foreign emit on
    // `opts.boundary === "server"` (:2148). Off the server boundary a
    // `const x = _={ … }=` initializer becomes literally
    //   `const x = null; // foreign-init for x — _{} runs server-side; …`
    // so the function keeps its signature, PARSES, exports, and returns null —
    // silent-wrong output, which is strictly worse than the raw path's honest
    // verbatim copy. Measured: routing by default this way broke
    // `standalone-tool-target.test.js` "Flag C" — a foreign-only library
    // emitted `export function runOpen(…) { const out = null; return out; }`
    // where the base emits `export async function runOpen`, so an importing
    // §64 tool awaited a function that no longer does anything.
    //
    // ⚑ The corpus differential was BLIND to this: no library module in the
    // 118-file population carries a `_{}` foreign init, so the population
    // measured 0 regressions while a committed test failed. A zero over a path
    // the population never exercises is not coverage.
    //
    // The RIGHT long-term answer is probably that a library module has no
    // client/server split at all and should lower foreign at the server
    // boundary — but "what boundary is a library module?" is a language
    // question, not a codegen one, so it is routed rather than decided here.
    // Falling back to raw is inert (byte-identical to today) and honest.
    if (o.kind === "foreign" || o.foreignNode) {
      reason = "`_={ … }=` foreign code (emit-logic nulls a foreign init off the server boundary)";
      return;
    }
    // (A `!{ … }` guarded expression is caught AFTER emission instead — see
    // `unloweredScrmlSyntax`. Its AST shape is not reliably visible at this point in
    // the pipeline, and the emitted bytes are the ground truth anyway.)
    for (const key of Object.keys(o)) {
      const v = o[key];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(fnNode.body);
  return reason;
}

/**
 * §21.2 / §21.5 (export-enum-library-emit) — emit the runtime representation of
 * every ENUM type-decl in a library / type-module file, `export`-prefixed when
 * the enum was exported.
 *
 * An enum is NOT a TS-erasable type: it lowers to a runtime binding
 * `const X = Object.freeze({ …variant constructors…, variants:[…] })` (the SAME
 * shape a program / client bundle emits — reused verbatim via the shared
 * `emitEnumVariantObjects`, mirroring emit-tool.ts's standalone-module emit). A
 * consumer that `import { X }` and constructs `X.Variant(…)` — or `match`es on a
 * held value — REFERENCES this binding, so erasing it (the pre-fix behavior)
 * left the import resolving to `undefined`.
 *
 * Exportedness is keyed on the type-decl's `fromExport` flag — the synthetic
 * `type-decl` the ast-builder appends for `export type X:enum = {…}` (§21.2).
 * A NON-exported enum still gets a module-local `const` (the model's own helpers
 * may reference it); STRUCT / type-ALIAS decls carry no runtime binding (pure
 * types, TS-erased) and are omitted here. Per §21.2 the exported enum resolves
 * "the same way as a non-exported type" — hence the shared-emitter reuse.
 */
function emitEnumRuntimeReps(fileAST: Record<string, unknown>): string[] {
  const inner = fileAST.ast as Record<string, unknown> | undefined;
  const typeDecls =
    ((fileAST.typeDecls ?? inner?.typeDecls) as ASTNode[] | undefined) ?? [];
  const exportedEnumNames = new Set<string>();
  for (const decl of typeDecls) {
    if (
      decl && decl.kind === "type-decl" && decl.typeKind === "enum" &&
      decl.fromExport === true && typeof decl.name === "string"
    ) {
      exportedEnumNames.add(decl.name as string);
    }
  }
  const out: string[] = [];
  for (const line of emitEnumVariantObjects(fileAST)) {
    const m = line.match(/^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    out.push(m && exportedEnumNames.has(m[1]) ? `export ${line}` : line);
  }
  return out;
}

/**
 * Remove every scrml `type` declaration from a raw library block, TOGETHER WITH
 * any leading `export ` (§21.2 Form 2) — so the strip never leaves a dangling
 * `export` keyword (the malformed-JS bug that tripped E-CODEGEN-INVALID-LOGIC).
 * Three decl forms:
 *   1. braced spec  — `[export] type Name[:kind] = { … }`   (brace-aware: an enum
 *      body's nested `renders {}` / `transitions {}` is removed WHOLE)
 *   2. legacy self-host — `[export] type:kind Name { … }`
 *   3. brace-less alias — `[export] type Name[:kind] = <rhs>`   (`type Id = int`)
 *
 * ENUM decls are stripped here too — their value-bearing `Object.freeze` rep is
 * emitted separately by `emitEnumRuntimeReps`. STRUCT / ALIAS decls are pure
 * types with no runtime binding, so removal is their complete lowering.
 */
function stripScrmlTypeDecls(text: string): string {
  // Braced forms — brace-aware so a nested `{…}` in the body is consumed whole.
  const openerRe =
    /\b(?:export\s+)?type\b(?:\s*:\s*(?:enum|struct)\s+[A-Za-z_$][A-Za-z0-9_$]*|\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*\w+)?\s*=)\s*\{/g;
  let result = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(text)) !== null) {
    const openerStart = m.index;
    const braceStart = openerStart + m[0].length - 1; // index of the `{`
    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    result += text.slice(last, openerStart);
    last = i;
    openerRe.lastIndex = i;
  }
  result += text.slice(last);
  // Brace-less alias — `[export] type Name[:kind] = <rhs>` (no braces).
  return result.replace(
    /\b(?:export\s+)?type\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*\w+)?\s*=\s*[^\n;{}]+;?/g,
    "",
  );
}

/**
 * Strip scrml TYPE ANNOTATIONS from emitted `function` signatures — the param
 * annotations (`name: Type`) and the return type (`-> Type`) are scrml/TS syntax,
 * invalid in the ES-module output. Scoped to the signature between `function
 * NAME(` and the opening `{`, so it never touches object literals / ternaries in
 * the body. Untyped signatures pass through byte-unchanged (`a, b` → `a, b`). A
 * model-library file may declare typed pure helpers — `export fn f(x: int) ->
 * string { … }` — that the raw-text whole-block slicer would otherwise leak
 * verbatim (no stdlib module exercises this; delta-log is the first adopter).
 */
function cleanFnSignatures(text: string): string {
  return text.replace(
    /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?:->\s*[^{;]+?)?\s*\{/g,
    (_match, name: string, params: string) => {
      const cleaned = params
        .split(",")
        .map((p) => p.split(":")[0].trim())
        .filter((p) => p.length > 0)
        .join(", ");
      return `function ${name}(${cleaned}) {`;
    },
  );
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
  let exportRegistry: LibExportRegistry | null = null;
  if ("fileAST" in ctxOrFileAST) {
    const ctx = ctxOrFileAST as CompileContext;
    fileAST = ctx.fileAST;
    routeMap = ctx.routeMap;
    errors = ctx.errors;
    // Seam-A colorless-async — MOD's exportRegistry (isAsync source of truth).
    exportRegistry = (ctx.exportRegistry as LibExportRegistry | null | undefined) ?? null;
  } else {
    fileAST = ctxOrFileAST;
    routeMap = routeMapLegacy ?? {};
    errors = errorsLegacy ?? [];
  }
  const filePath = fileAST.filePath as string;
  const sourceText = (fileAST._sourceText ?? null) as string | null;
  // Seam-A colorless-async — the per-file `localName → sourceModuleAbsPath`
  // resolver feeding computeAsyncFnNames's Gap-1 stdlib-Promise seed. The
  // TABResult wrapper hoists imports to `.ast.imports`, so prefer `.ast` when
  // present (mirrors emit-server.ts:1096 / emit-functions.ts).
  // Cleanup 8 — buildCalleeImportMap folds the `.ast.imports` hoist internally.
  const libCalleeMap = buildCalleeImportMap(fileAST as any);
  const lines: string[] = [];

  lines.push("// Generated library module — scrml compiler output");
  lines.push("// ES module: import { name } from './this-file.js'");
  lines.push("");

  // §21.2/§21.5 — an exported enum is a VALUE-bearing runtime binding, not a
  // TS-erasable type. Emit each enum's `Object.freeze` rep (export-prefixed when
  // exported) up front so a consumer's `import { X }` + `X.Variant(…)` / `match`
  // resolves at runtime. Struct/alias decls stay pure types (no runtime rep).
  const enumReps = emitEnumRuntimeReps(fileAST);
  if (enumReps.length > 0) {
    for (const repLine of enumReps) lines.push(repLine);
    lines.push("");
  }

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
        // (E-CODEGEN-INVALID-LOGIC). blockStart === logicSpan.start since the splice
        // runs on the UNTRIMMED slice (guarded-expr spans are absolute into
        // sourceText). Reuses browser mode's emit-logic.ts `case "guarded-expr"`.
        // W5b — prune `?{}`/transaction-bearing fns (they live in `.server.js`,
        // not the client-facing library `.js`) AND lower §19 `!{}` guarded-exprs
        // in one reverse-ordered splice pass. A `?{}` SQL fn resolving against
        // the file's own `<db src>` (§44.7.1) would otherwise leak verbatim into
        // the library `.js` and trip the §2.2.1 E-CODEGEN-INVALID-LOGIC gate.
        // Seam-A colorless-async (GITI-037) — route every NON-SQL async fn
        // (safeCallAsync / transitive-async) through the structured
        // emitLibraryFnMember so it emits `async` + awaits the stdlib call and
        // its async peers. `asyncEmit.removals` are merged into the prune pass
        // (their verbatim text is removed); `asyncEmit.lines` are appended below.
        const asyncEmit = emitAsyncLibraryFns(
          logic.body,
          sourceText,
          libCalleeMap,
          exportRegistry,
          (fileAST as any)?._asyncImportedLocals as Set<string> | undefined,
          filePath,
          errors,
        );
        // g-library-mode-match-expr-fails-codegen — route the remaining SYNC fns
        // whose body holds an unlowered `match`/`if` expression through the same
        // structured member emitter (disjoint from the async / SQL routers). Its
        // removals join the async removals in the single prune-splice below so the
        // verbatim `match` text is excised; its lines are appended alongside.
        const controlFlowEmit = emitControlFlowLibraryFns(
          logic.body,
          sourceText,
          asyncEmit.routedNames,
        );
        blockText = pruneServerFnsAndLowerGuarded(
          blockText,
          logicSpan.start,
          logic.body,
          sourceText,
          errors,
          [...asyncEmit.removals, ...controlFlowEmit.removals],
        );
        // Strip the ${…} logic-wrapper as a MATCHED PAIR: the trailing `}` is the
        // wrapper close ONLY when a `${` prefix was actually present. A bare-fn
        // library file has no wrapper and ends in the fn's OWN `}`; stripping it
        // there truncates the fn → E-CODEGEN-INVALID-LOGIC
        // (g-library-bare-fn-no-trailing-newline-brace-strip). The bug hid in the
        // common case only because a trailing newline left the fn's `}` non-final.
        if (blockText.startsWith("${")) {
          blockText = blockText.slice(2);
          if (blockText.endsWith("}")) blockText = blockText.slice(0, -1);
        }
        blockText = blockText.trim();
        if (blockText) {
          // §21.2/§21.5 — remove scrml `type` decls (incl. any leading
          // `export`, so no dangling `export` is left); enum runtime reps are
          // emitted up top by emitEnumRuntimeReps, struct/alias are pure types.
          blockText = stripScrmlTypeDecls(blockText);
          // Convert fn → function
          blockText = blockText.replace(/\bfn\s+([A-Za-z_$])/g, "function $1");
          // Strip scrml type annotations from the emitted fn signatures.
          blockText = cleanFnSignatures(blockText);
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
        // Seam-A colorless-async — append the structured async fns (pruned from
        // the verbatim block above). Emitted OUTSIDE the `if (blockText)` guard:
        // a library whose ONLY content is an async fn has empty block text after
        // pruning, but the fn must still emit. Function declarations hoist, so
        // trailing placement after the imports/sync content is resolution-safe.
        if (asyncEmit.lines.length > 0) {
          for (const fnBlock of asyncEmit.lines) {
            lines.push(fnBlock);
            lines.push("");
          }
        }
        // g-library-mode-match-expr-fails-codegen — append the structured
        // match/if sync fns (pruned from the verbatim block above), same as the
        // async fns. Function declarations hoist, so trailing placement is safe.
        if (controlFlowEmit.lines.length > 0) {
          for (const fnBlock of controlFlowEmit.lines) {
            lines.push(fnBlock);
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
          // §21.2/§21.5 — remove scrml `type` decls incl. any leading `export`.
          text = stripScrmlTypeDecls(text);
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

        // Strip scrml type annotations from emitted fn signatures (gap + non-gap).
        text = cleanFnSignatures(text);

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

    return withRuntimeHelpers(withAsyncCombinators(lines.join("\n")));
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

  return withRuntimeHelpers(withAsyncCombinators(lines.join("\n")));
}
