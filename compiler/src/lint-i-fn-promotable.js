/**
 * I-FN-PROMOTABLE — info-level lint that surfaces `function` declarations
 * whose bodies would pass `fn`-body constraints (§48.3), suggesting
 * promotion to `fn` for the pure / state-factory contract.
 *
 * **Status (S122 Unit EE):** initial ship — paired with the SPEC §56.X
 * amendment. CLI verb `bun scrml promote --fn` is a deferred follow-up;
 * the lint fires informationally only — adopters do the rewrite manually
 * for now (a one-keyword rename `function` → `fn`).
 *
 * **Spec:** SPEC §56.X. Single message shape (the constraint here is
 * binary — the body either satisfies §48.3 or it does not). Mirrors
 * I-MATCH-PROMOTABLE in being a Tier-N → Tier-N+1 ergonomic surface:
 * `fn` is the canonical pure form (§48.11; `pure function` is its
 * deprecated synonym), and the §48.3 prohibitions are exactly
 * the discriminator the lint probes.
 *
 * **Pipeline placement:** runs as a post-TS pass invoked from api.js,
 * alongside `runIMatchPromotable`. Needs the typed-AST (function-decl
 * nodes with their bodies and metadata) plus the per-file state-type
 * registry (used by `checkFnBodyProhibitions` for E-STATE-COMPLETE).
 *
 * **Probe mechanism:** invoke `checkFnBodyProhibitions` against a
 * discarded `TSError[]`. The walker already enforces E-FN-001..E-FN-005,
 * E-FN-007, E-FN-008, the §54.6.1 unconditional `@`-cell write check,
 * plus the localNames-aware outer-scope mutation check. Empty errors
 * + structural eligibility = I-FN-PROMOTABLE.
 *
 * **Structural eligibility — skip-list (no promotion suggestion):**
 *   - fnKind === "fn"                       (already promoted)
 *   - isAsync                               (§19.9.8 + S89: scrml has no async — but
 *                                            stdlib `async function` is a carve-out
 *                                            and is NOT promotable to fn since fn is sync)
 *   - isGenerator                           (no `fn*` form; fn is sync + returns once)
 *   - isServer                              (EXPLICIT `server` keyword — its own surface §12.5)
 *   - inferred-server (RI escalated)        (body-content-escalated to the server
 *                                            boundary: `?{}` SQL / server-only import /
 *                                            file-IO / protected-field / server callee.
 *                                            `node.isServer` is FALSE here — the keyword-
 *                                            vs-inference blind spot. §56.9.1)
 *   - canFail                               (`function name!()` failable — not fn)
 *   - isHandleEscapeHatch                   (the `handle()` escape hatch §39.3.1)
 *   - errors from probe                     (body has a §48.3 violation — not fn-eligible)
 *
 * **Output:** lint diagnostics in the standard shape — fed into the
 * `allLintDiagnostics` channel by api.js.
 *
 * @module lint-i-fn-promotable
 */

import { checkFnBodyProhibitions } from "./type-system.ts";

/**
 * Lint diagnostic shape returned to api.js. Mirrors I-MATCH-PROMOTABLE.
 *
 * @typedef {{
 *   line: number,
 *   column: number,
 *   code: string,
 *   severity: "info"|"warning"|"error",
 *   message: string,
 *   ghost?: string,
 *   correction?: string,
 * }} LintDiagnostic
 */

/**
 * Walk the typed-AST and collect I-FN-PROMOTABLE diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @param {Map<string, object> | undefined} stateTypeRegistry — type-name → ResolvedType
 *        (the cross-file state-type registry; passed through to
 *        `checkFnBodyProhibitions` so the probe can run E-STATE-COMPLETE.)
 * @param {Set<string> | undefined} inferredServerKeys — set of
 *        `${filePath}::${fnNode.span.start}` keys for functions route-inference
 *        escalated to the SERVER boundary (§12.2). Built in api.js from
 *        `riResult.routeMap.functions`. A function in this set runs on the
 *        server (by body-content `?{}`/`Bun.*`/file-IO/caller-context OR by the
 *        explicit `server` keyword) and therefore must NOT be suggested for
 *        promotion to a pure `fn` (§56.9.1 skip-list) — the keyword-only
 *        `node.isServer` flag misses the body-content-escalated case (the
 *        keyword-vs-inference blind spot, g-server-keyword-drift).
 * @returns {Array<LintDiagnostic & { filePath: string }>}
 */
export function runIFnPromotable(files, stateTypeRegistry, inferredServerKeys) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;

  for (const file of files) {
    const filePath = file.filePath || "";

    // Collect every `function`-keyword declaration (fnKind !== "fn") in the
    // file. Walk all reachable bodies; `function` decls can sit at file scope,
    // inside `${ }` logic blocks, inside conditional branches, etc.
    //
    // The typed-AST entry shape mirrors I-MATCH-PROMOTABLE: `file.ast.nodes`
    // is the canonical node-array; older shapes may attach nodes directly on
    // `file.nodes`. Handle both.
    const root = file.ast ?? file;
    const candidates = [];
    if (Array.isArray(root.nodes)) {
      for (const n of root.nodes) collectFunctionDecls(n, candidates);
    }
    if (Array.isArray(root.components)) {
      for (const c of root.components) collectFunctionDecls(c, candidates);
    }

    // Build the set of non-pure (i.e. non-`fn`) function names in this file —
    // mirrors what runTS does internally before invoking
    // `checkFnBodyProhibitions`. This makes the E-FN-003 "calls a non-pure
    // function" check meaningful in the probe.
    const nonPureFnNames = collectNonPureFnNames(root);

    for (const node of candidates) {
      if (!isStructurallyEligible(node, filePath, inferredServerKeys)) continue;

      // Probe: invoke checkFnBodyProhibitions against a discarded errors
      // sink. The walker is non-mutating w.r.t. the AST; if it produces
      // zero diagnostics, the body satisfies the §48.3 fn-body contract.
      const sink = [];
      try {
        checkFnBodyProhibitions(
          node,
          node.body ?? [],
          sink,
          filePath,
          stateTypeRegistry,
          nonPureFnNames,
          /* scopeChain */ undefined,
        );
      } catch {
        // Defensive: probe must never block compilation. On any unexpected
        // failure inside the walker, silently skip this candidate.
        continue;
      }

      if (sink.length === 0) {
        diagnostics.push({
          ...makeFnPromotableDiag(node),
          filePath,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Recursively walk a file's nodes collecting every `function-decl` whose
 * `fnKind` is `"function"` (i.e. the long-form keyword, not the `fn`
 * shorthand). Skips nested function bodies during the harvest — we
 * still enumerate them (so a promotable inner function is also seen)
 * by recursing into their `body` arrays.
 *
 * @param {object} node — current AST node (file or any descendant)
 * @param {object[]} out — accumulator
 */
function collectFunctionDecls(node, out) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) collectFunctionDecls(item, out);
    return;
  }

  if (node.kind === "function-decl" && node.fnKind === "function") {
    out.push(node);
  }

  // Recurse into known container fields. Mirrors the recursion shape
  // already used by checkFnBodyProhibitions' inner walkers.
  for (const key of [
    "nodes", "body", "children", "consequent", "alternate",
    "then", "else", "arms", "armBody", "cases",
  ]) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) collectFunctionDecls(item, out);
    } else if (v && typeof v === "object") {
      collectFunctionDecls(v, out);
    }
  }
}

/**
 * Collect non-pure (i.e. non-`fn`) function names declared in this file.
 * Used by the probe so the E-FN-003 "fn calls a non-pure fn" check
 * inside `checkFnBodyProhibitions` runs faithfully — without this set,
 * a `function` body that calls another `function` would not fire E-FN-003
 * and would spuriously be tagged promotable.
 *
 * Returns a Set<string> of bare callee names (no `()` suffix). The cross-
 * file registry is out of scope for this lint pass — within-file resolution
 * is sufficient to catch the common case + avoids cross-file work.
 *
 * @param {object} file — typed FileAST
 * @returns {Set<string>}
 */
function collectNonPureFnNames(file) {
  const names = new Set();
  visitForNonPure(file);
  return names;

  function visitForNonPure(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visitForNonPure(item);
      return;
    }
    if (
      node.kind === "function-decl" &&
      node.fnKind === "function" &&
      typeof node.name === "string"
    ) {
      names.add(node.name);
    }
    for (const key of [
      "nodes", "body", "children", "consequent", "alternate",
      "then", "else", "arms", "armBody", "cases",
    ]) {
      const v = node[key];
      if (Array.isArray(v)) {
        for (const item of v) visitForNonPure(item);
      } else if (v && typeof v === "object") {
        visitForNonPure(v);
      }
    }
  }
}

/**
 * Structural eligibility — fast-reject the function-decls that should
 * NEVER fire I-FN-PROMOTABLE regardless of body content. See module
 * doc-comment "skip-list" for the full rationale.
 *
 * @param {object} node — function-decl node
 * @param {string} [filePath] — owning file path (for the inferred-server key)
 * @param {Set<string> | undefined} [inferredServerKeys] — RI server-boundary
 *        keys (`${filePath}::${span.start}`); see `runIFnPromotable` param doc
 * @returns {boolean}
 */
function isStructurallyEligible(node, filePath, inferredServerKeys) {
  if (!node || node.kind !== "function-decl") return false;
  if (node.fnKind === "fn") return false;               // already promoted
  if (node.isAsync) return false;                       // sync vs async mismatch
  if (node.isGenerator) return false;                   // no fn* form
  if (node.isServer) return false;                      // EXPLICIT `server` keyword
  // Route-inference (§12.2) escalated this function to the server boundary by
  // BODY CONTENT (`?{}` SQL, a `scrml:fs`/server-only import, file-IO, a
  // protected-field access, or a transitive server callee) — NOT the `server`
  // keyword. `node.isServer` is the deprecated keyword flag and is FALSE for
  // this inferred-server case (the keyword-vs-inference blind spot,
  // g-server-keyword-drift). A server function is never a pure-`fn` candidate,
  // so skip it. The key shape mirrors route-inference's `makeFunctionNodeId`
  // (`${filePath}::${fnNode.span.start}`). Defensive: only consult the set when
  // both it and a usable `span.start` are present (a single-file / no-RI call
  // path passes `undefined` and falls through to the probe, unchanged).
  if (
    inferredServerKeys &&
    inferredServerKeys.size > 0 &&
    node.span &&
    typeof node.span.start === "number" &&
    inferredServerKeys.has(`${filePath || ""}::${node.span.start}`)
  ) {
    return false;
  }
  if (node.canFail) return false;                       // failable form is `function name!()`
  if (node.isHandleEscapeHatch) return false;           // §39.3.1 escape hatch
  if (!Array.isArray(node.body)) return false;          // nothing to probe
  return true;
}

/**
 * Build the diagnostic envelope for a promotable `function` decl.
 *
 * @param {object} node — function-decl node
 * @returns {LintDiagnostic}
 */
function makeFnPromotableDiag(node) {
  const span = node.span ?? {};
  const line = typeof span.line === "number" ? span.line : 1;
  const column = typeof span.col === "number" ? span.col
    : typeof span.column === "number" ? span.column : 1;
  const name = typeof node.name === "string" ? node.name : "<anonymous>";

  const message =
    `Line ${line}: I-FN-PROMOTABLE — \`function ${name}\` body meets the \`fn\` body ` +
    `constraints (§48.3.3). Consider promoting to \`fn ${name}\` for the pure / ` +
    `state-factory contract. \`fn\` is the canonical pure form ` +
    `(§48.11); the §48.3 prohibitions you already satisfy become enforced invariants ` +
    `at the declaration site. See SPEC §56.`;

  return {
    line,
    column,
    code: "I-FN-PROMOTABLE",
    severity: "info",
    message,
    ghost: `function ${name}(...) with fn-eligible body`,
    correction: `rename keyword: function ${name} → fn ${name}`,
  };
}
