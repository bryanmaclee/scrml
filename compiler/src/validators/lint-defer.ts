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
 * `server function`) is where `defer` is legal. A `lambda` (arrow / function
 * expression) body is a fresh control-flow scope but does NOT admit `defer` in
 * stage 1 (§19.16.3 rule 4) — both front-ends carry a block-bodied lambda as
 * host-expression TEXT (an `escape-hatch`), as they do an `on mount { }` body,
 * so a `defer` there is found by a statement-anchored scan of that text and
 * reported as E-DEFER-OUTSIDE-FUNCTION instead of reaching codegen verbatim.
 * A nested function inside a deferred body is its OWN control-flow scope: its
 * `return` / `fail` / `?` are legal.
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
  /** True inside a function-EXPRESSION / arrow body (defer not admitted, §19.16.3 rule 4). */
  inLambda?: boolean;
}

/**
 * A `defer` statement lead inside RAW host-expression text — the body of a
 * block-bodied arrow / function expression, or an `on mount { … }` body, both of
 * which the front-ends carry as text (an `escape-hatch` / a raw `bare-expr`)
 * rather than as a parsed statement list. Anchored at a statement boundary
 * (`{`, `;`, newline, start) and followed by a statement-lead character, so
 * `defer(x)` / `defer = 1` / `x.defer` never match.
 */
const RAW_DEFER_LEAD_RE =
  /(?:^|[{;\n])\s*defer[ \t]+(?!(?:or|and|is|as|of|in|instanceof|else)\b)(?:[A-Za-z_$@{]|\?\{)/;

/** Escape-hatch kinds that carry a FUNCTION-EXPRESSION body as raw text. */
function isRawFunctionExpression(n: Node): boolean {
  if (n.kind !== "escape-hatch" || typeof n.raw !== "string") return false;
  const nk = n.nativeKind;
  if (nk === "ArrowFunctionExpression" || nk === "FunctionExpression") return true;
  // The live expression parser gives up on a block-bodied lambda containing a
  // scrml-only statement (`ParseError`); recognise the lambda by its text.
  return /^\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(n.raw as string);
}

const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt"]);

function spanOf(n: Node, filePath: string): Span {
  return (n.span as Span | undefined) ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span;
}

const TOP_LEVEL_MSG =
  "`defer` is only valid inside a function declaration body (`function`, `fn`, `server function`) " +
  "or a block nested in one (§19.16.3). Top-level logic, `on mount` bodies and markup/state-block " +
  "bodies are page/module initialisation, which the compiler reorders — there is no single block " +
  "exit to run the deferred statement at. Move this into the function whose exit it belongs to.";

const LAMBDA_MSG =
  "`defer` is not supported inside an arrow-function or function-expression body in this stage " +
  "(§19.16.3) — those bodies are lowered as host-expression text, not as a scrml statement list. " +
  "Move the body into a named `function` / `fn` declaration and call it.";

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

    // --- raw-text bodies: a `defer` inside text the front-end did not parse as
    // statements would reach codegen verbatim (an E-CODEGEN-INVALID-LOGIC with no
    // root cause). Name the actual rule instead.
    if (isRawFunctionExpression(n) && RAW_DEFER_LEAD_RE.test(n.raw as string)) {
      report("E-DEFER-OUTSIDE-FUNCTION", n, LAMBDA_MSG);
      return;
    }
    if (kind === "bare-expr" && n._onMountEffect === true && typeof n.expr === "string" &&
        RAW_DEFER_LEAD_RE.test(n.expr as string)) {
      report("E-DEFER-OUTSIDE-FUNCTION", n, TOP_LEVEL_MSG);
      return;
    }

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
      // A function EXPRESSION / arrow body is a fresh control-flow scope, but
      // stage 1 does not admit `defer` in it (§19.16.3 rule 4): lambda bodies
      // are lowered as host-expression text, not as a scrml statement list, so
      // there is no statement list to attach the deferred body to.
      const inner: WalkState = { inFunction: false, defer: null, inLambda: true };
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
      } else if (st.inLambda) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, LAMBDA_MSG);
      } else if (!st.inFunction) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, TOP_LEVEL_MSG);
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
