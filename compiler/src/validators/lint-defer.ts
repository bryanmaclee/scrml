/**
 * `defer` restriction checker — SPEC §19.16.3 (S430 P3 stage 1).
 *
 * Fires the structural `defer` diagnostics on the LIVE-shaped AST, so the live
 * (`ast-builder.js`) and native (`native-parser/`, via `translate-stmt.js`)
 * front-ends share ONE checker — both produce the same `defer-stmt` node:
 *
 *   { kind: "defer-stmt", body: LogicStatement[], blockForm: boolean, span }
 *
 * Codes (all hard errors):
 *
 *   - `E-DEFER-OUTSIDE-FUNCTION` — a `defer` with no enclosing function body
 *     (top-level `${}` logic, a `<program>`/`<page>`/state-block body). §19.16.3 (4).
 *   - `E-DEFER-NESTED`           — a `defer` inside a deferred body. §19.16.3 (2).
 *   - `E-DEFER-CONTROL-FLOW`     — a deferred body contains `return`, `fail`, `?`,
 *     or a `break`/`continue` whose target is outside the deferred body. §19.16.3 (1).
 *
 * Two further §19.16 codes are NOT here because they need information this
 * purely-structural pass does not have:
 *   - `E-DEFER-UNHANDLED-FAILABLE` (§19.16.3 (3)) needs the failable-function
 *     set — emitted by the type system (`type-system.ts`, the E-ERROR-002 site).
 *   - `E-DEFER-SERVER-IN-SPLIT` (§19.16.5) needs the CPS split — emitted by
 *     route inference (`route-inference.ts`, `analyzeCPSEligibility`).
 *
 * Function boundaries: a `function-decl` body (covers `function`, `fn`,
 * `server function`) and a structured `lambda` block body. A nested function
 * inside a deferred body is its OWN control-flow scope: its `return` / `fail` /
 * `?` are legal, and it may contain its own `defer`.
 *
 * Pipeline placement: post-TAB, next to `lint-async-user-source.ts` (api.js).
 * Needs only the parsed AST.
 *
 * @module lint-defer
 */
import { isMetaKind } from "../types/ast.ts";
import type { FileAST, Span } from "../types/ast.ts";

export type DeferCode =
  | "E-DEFER-OUTSIDE-FUNCTION"
  | "E-DEFER-NESTED"
  | "E-DEFER-CONTROL-FLOW";

export interface DeferDiagnostic {
  code: DeferCode;
  message: string;
  span: Span;
  severity: "error";
}

type Node = Record<string, unknown> & { kind?: string; span?: Span };

/** Control-flow context while walking INSIDE a deferred body. */
interface DeferCtx {
  /** Number of loops opened inside the deferred body (break/continue targets). */
  loopDepth: number;
  /** Number of `switch` statements opened inside the deferred body (break targets). */
  switchDepth: number;
  /** Labels declared inside the deferred body. */
  labels: Set<string>;
}

interface WalkState {
  /** True when some enclosing function body contains the current node. */
  inFunction: boolean;
  /** Non-null while inside a deferred body (reset at a nested function boundary). */
  defer: DeferCtx | null;
}

const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt"]);

function spanOf(n: Node, filePath: string): Span {
  return (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span;
}

const CONTROL_FLOW_WHY =
  "a deferred statement runs while its block is already exiting, so it cannot redirect " +
  "control (§19.16.3). Move the control transfer out of the `defer`, or handle the case " +
  "in place.";

/**
 * Walk a FileAST and collect the structural §19.16.3 diagnostics.
 */
export function runDeferChecks(ast: FileAST | null | undefined): DeferDiagnostic[] {
  const diagnostics: DeferDiagnostic[] = [];
  if (!ast) return diagnostics;
  const filePath = (ast as { filePath?: string }).filePath ?? "";
  const seen = new WeakSet<object>();

  const report = (code: DeferCode, n: Node, message: string) => {
    diagnostics.push({ code, severity: "error", span: spanOf(n, filePath), message: `${code}: ${message}` });
  };

  const controlFlow = (n: Node, what: string) =>
    report("E-DEFER-CONTROL-FLOW", n, `a deferred statement cannot contain ${what} — ${CONTROL_FLOW_WHY}`);

  function walk(node: unknown, st: WalkState): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c, st);
      return;
    }
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Node;
    const kind = n.kind;

    // `^{}` meta and `_{}` foreign bodies are host-adjacent / opaque — not scrml
    // logic statement lists, so `defer` has no meaning there.
    if (typeof kind === "string" && (isMetaKind(kind) || kind === "foreign" || kind === "Foreign")) return;

    // --- function boundaries: a fresh control-flow scope ---
    if (kind === "function-decl") {
      const inner: WalkState = { inFunction: true, defer: null };
      for (const key of Object.keys(n)) {
        if (key === "span" || key === "parent") continue;
        walk(n[key], inner);
      }
      return;
    }
    if (kind === "lambda") {
      const inner: WalkState = { inFunction: true, defer: null };
      for (const key of Object.keys(n)) {
        if (key === "span" || key === "parent") continue;
        walk(n[key], inner);
      }
      return;
    }

    if (kind === "defer-stmt") {
      if (st.defer) {
        report("E-DEFER-NESTED", n,
          "a deferred statement cannot itself contain a `defer` — the deferred statement runs " +
          "while its block is already exiting, so there is no block left to attach the inner " +
          "`defer` to (§19.16.3). Write the inner statement directly in the outer deferred body.");
      } else if (!st.inFunction) {
        report("E-DEFER-OUTSIDE-FUNCTION", n,
          "`defer` is only valid inside a function body (`function`, `fn`, `server function`) or a " +
          "block nested in one (§19.16.3). Top-level logic and markup/state-block bodies are " +
          "page/module initialisation, which the compiler reorders — there is no single block exit " +
          "to run the deferred statement at. Move this into the function whose exit it belongs to.");
      }
      const inner: WalkState = {
        inFunction: st.inFunction,
        defer: { loopDepth: 0, switchDepth: 0, labels: new Set() },
      };
      walk(n.body, inner);
      return;
    }

    const d = st.defer;
    if (d) {
      if (kind === "return-stmt") controlFlow(n, "`return`");
      else if (kind === "fail-expr") controlFlow(n, "`fail`");
      else if (kind === "propagate-expr") controlFlow(n, "a `?` propagation");
      // Native front-end: a `?` / `fail` in an expression-CHILD position (e.g. the
      // initializer of `let v = f()?`) translates to an escape-hatch carrying the
      // native kind (translate-expr.js) rather than a statement node.
      else if (kind === "escape-hatch" && n.nativeKind === "Propagate") controlFlow(n, "a `?` propagation");
      else if (kind === "escape-hatch" && n.nativeKind === "Fail") controlFlow(n, "`fail`");
      else if (kind === "break-stmt" || kind === "continue-stmt") {
        const label = typeof n.label === "string" && n.label.length > 0 ? n.label : null;
        const isBreak = kind === "break-stmt";
        const targetInside = label
          ? d.labels.has(label)
          : (isBreak ? d.loopDepth + d.switchDepth > 0 : d.loopDepth > 0);
        if (!targetInside) {
          controlFlow(n, isBreak
            ? "a `break` that leaves it"
            : "a `continue` that leaves it");
        }
      }

      // Scope-opening constructs INSIDE the deferred body: descend with an
      // incremented target depth so their own break/continue are legal.
      if (typeof kind === "string" && (LOOP_KINDS.has(kind) || kind === "switch-stmt")) {
        const labels = new Set(d.labels);
        if (typeof n.label === "string" && n.label.length > 0) labels.add(n.label);
        const inner: WalkState = {
          inFunction: st.inFunction,
          defer: {
            loopDepth: d.loopDepth + (LOOP_KINDS.has(kind) ? 1 : 0),
            switchDepth: d.switchDepth + (kind === "switch-stmt" ? 1 : 0),
            labels,
          },
        };
        for (const key of Object.keys(n)) {
          if (key === "span" || key === "parent") continue;
          walk(n[key], inner);
        }
        return;
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "span" || key === "parent") continue;
      walk(n[key], st);
    }
  }

  walk((ast as { nodes?: unknown }).nodes ?? ast, { inFunction: false, defer: null });
  return diagnostics;
}
