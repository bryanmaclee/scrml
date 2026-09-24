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

/**
 * The raw-TEXT statement bodies a node carries (S430 review F3) — fields whose
 * content codegen splices as statements but that no structural walk can see:
 *   - a live `bare-expr` `.expr` (a value-form `match` arm with a block body is a
 *     `bare-expr` whose text is `<pattern> :> { … }`);
 *   - a live `match-arm-inline` `.result`;
 *   - a `!{}` handler arm's `.handler` (block-bodied handlers are text);
 *   - the native parser's `match-expr` `.rawArms[]`.
 */
function rawBodyTexts(n: Node): string[] {
  const out: string[] = [];
  if (n.kind === "bare-expr" && typeof n.expr === "string") out.push(afterArmArrow(n.expr));
  if (n.kind === "match-arm-inline" && typeof n.result === "string") out.push(n.result);
  if (Array.isArray(n.rawArms)) for (const a of n.rawArms) if (typeof a === "string") out.push(afterArmArrow(a));
  if (Array.isArray(n.arms)) {
    for (const a of n.arms as unknown[]) {
      if (a && typeof a === "object" && typeof (a as Node).handler === "string") out.push((a as Node).handler as string);
    }
  }
  return out;
}

/**
 * A match ARM's text is `<pattern> <arrow> <body>`; its arm arrow (`:>`, or the
 * deprecated `=>` / `->`) is the FIRST arrow at paren/bracket depth 0. Return the
 * body after it (or the whole text when there is none), so the scanner never
 * mistakes a legacy `=>` arm arrow for an arrow-function head. An arrow nested
 * in parentheses (`list.map((x) => { … })`) is not depth 0 and is left alone.
 */
function afterArmArrow(text: string): string {
  const src = blankLiterals(text);
  let depth = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "{") return text; // a block before any arrow: not an arm head
    else if (depth === 0 && (c === ":" || c === "=" || c === "-") && src[i + 1] === ">") {
      return text.slice(i + 2);
    }
  }
  return text;
}

/**
 * Blank out string / template literals and comments (same length), so the
 * scanner never sees a keyword inside `"return"` or a `// fail` comment.
 */
function blankLiterals(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += " ";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { out += " "; i++; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Find the control transfers a deferred raw-text body contains that would leave
 * the deferred body: `return`, `fail`, a postfix `?` propagation, and a
 * `break` / `continue` with no enclosing loop (or `switch`, for `break`) — either
 * inside the text or around it (`loopOutside` / `breakTargetOutside`, the
 * structural context the text sits in, still INSIDE the deferred body).
 *
 * Brace-aware: a `{` opened by an arrow (`=> {`) or a `function (…) {` head is a
 * function body — nothing inside it is reported (its own `return` is legal,
 * §19.16.3 rule 1). A `{` opened by a `for` / `while` / `do` head is a loop, a
 * `switch (…) {` a break target.
 */
export function scanRawControlFlow(text: string, loopOutside = false, breakTargetOutside = false): string[] {
  const src = blankLiterals(text);
  const found: string[] = [];
  type Frame = "fn" | "loop" | "switch" | "block";
  const stack: Frame[] = [];
  const inFn = () => stack.includes("fn");
  const inLoop = () => loopOutside || stack.includes("loop");
  const inBreakTarget = () => breakTargetOutside || stack.includes("loop") || stack.includes("switch");

  // Classify a `{` at index i from the text before it.
  const classify = (i: number): Frame => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j >= 1 && src[j] === ">" && src[j - 1] === "=") return "fn";
    if (j >= 1 && /[A-Za-z_$]/.test(src[j])) {
      const m = /([A-Za-z_$][\w$]*)$/.exec(src.slice(0, j + 1));
      if (m && m[1] === "do") return "loop";
      if (m && m[1] === "else") return "block";
    }
    if (j >= 0 && src[j] === ")") {
      // Walk back to the matching `(`.
      let depth = 0;
      let k = j;
      for (; k >= 0; k--) {
        if (src[k] === ")") depth++;
        else if (src[k] === "(") { depth--; if (depth === 0) break; }
      }
      const head = src.slice(0, Math.max(0, k)).replace(/\s+$/, "");
      if (/(?:^|[^\w$.])function(?:\s*\*)?(?:\s+[A-Za-z_$][\w$]*)?$/.test(head)) return "fn";
      if (/(?:^|[^\w$.])(?:for|while)$/.test(head)) return "loop";
      if (/(?:^|[^\w$.])switch$/.test(head)) return "switch";
      // `(x) => {` — the arrow sits AFTER the paren group, handled above; a
      // method-shorthand `name(…) {` inside an object literal is a function body.
      if (/[A-Za-z_$][\w$]*$/.test(head) && !/(?:^|[^\w$.])(?:if|catch|with)$/.test(head)) return "fn";
    }
    return "block";
  };

  const re = /[{}]|\b(return|fail|break|continue)\b|\?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    const at = m.index;
    if (tok === "{") { stack.push(classify(at)); continue; }
    if (tok === "}") { stack.pop(); continue; }
    if (inFn()) continue;
    // A keyword used as a property name (`x.return`) is not a statement.
    let p = at - 1;
    while (p >= 0 && /[ \t]/.test(src[p])) p--;
    if (tok !== "?" && p >= 0 && src[p] === ".") continue;
    if (tok === "return") found.push("`return`");
    else if (tok === "fail") found.push("`fail`");
    else if (tok === "break") { if (!inBreakTarget()) found.push("a `break` that leaves it"); }
    else if (tok === "continue") { if (!inLoop()) found.push("a `continue` that leaves it"); }
    else if (tok === "?") {
      // Postfix `?` propagation: `?` after an operand, ending the statement —
      // NOT `?.` / `??` / a ternary `a ? b : c` / a `?{` SQL opener.
      const next = src.slice(at + 1);
      if (/^[.?{]/.test(next)) continue;
      if (at > 0 && src[at - 1] === "?") continue;
      if (!/^[ \t]*(?:$|[\n;}])/.test(next)) continue;
      if (p < 0 || !/[\w$)\]]/.test(src[p])) continue;
      found.push("a `?` propagation");
    }
  }
  return found;
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
      // Raw-text arm / handler bodies (S430 review F3). A value-form `match` arm
      // with a block body (`.A :> { return 5 }`), an inline match arm's result, a
      // `!{}` handler arm, and the native parser's `rawArms` are carried as TEXT,
      // not as statement nodes — the structural checks below cannot see a
      // `return` / `fail` / `?` / `break` / `continue` inside them, and codegen
      // splices that text verbatim into the lowered `finally`. Scan each such
      // field with the brace-aware scanner (function / arrow bodies are skipped;
      // loops inside the text are their own break/continue targets).
      for (const text of rawBodyTexts(n)) {
        for (const what of scanRawControlFlow(text, d.loopDepth > 0, d.loopDepth + d.switchDepth > 0)) {
          controlFlow(n, what);
        }
      }
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
