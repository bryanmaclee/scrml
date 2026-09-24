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
 *   - `E-DEFER-UNHANDLED-FAILABLE` (§19.16.3 (3), totality limb) — a `!{}`
 *     handler on a deferred call without a catch-all `| _ :>` arm. (The
 *     bare-call limb needs the failable-function set and is emitted by the
 *     type system, `type-system.ts`, at the E-ERROR-002 site.)
 *
 *   - `E-DEFER-UNSUPPORTED-SITE` (§19.16.2, S430 round 5) — a `defer` in a bare
 *     `{ }` block, a single-statement (unbraced) arm, or an arm of a match / if /
 *     for used for its VALUE (a value-form expression, or a `match` that is a
 *     `fn`'s implicit-return tail).
 *   - `E-DEFER-LATER-SHADOW` (§19.16.2, S430 round 5) — a deferred statement reads
 *     a name a later `let` / `const` / `lin` in its block chain (re)binds.
 *
 * `E-DEFER-SERVER-IN-SPLIT` (§19.16.5) needs the CPS split — emitted by route
 * inference (`route-inference.ts`).
 *
 * NO TEXT SCANNING (S430 round 3, contract Rule 7). Arm / handler bodies the
 * front-end carries as text are PARSED into statement trees
 * (`defer-structure.ts` `parseStatementText`) and walked by this same walker;
 * a body that does not parse fails closed. A `defer` inside a lambda /
 * `on mount` body carried as text is found by PARSING that text
 * (`textContainsDeferStatement`), not by matching the word.
 *
 * Function boundaries: a `function-decl` body (covers `function`, `fn`,
 * `server function`) is where `defer` is legal. A `lambda` (arrow / function
 * expression) body is a fresh control-flow scope but does NOT admit `defer` in
 * stage 1 (§19.16.3 rule 4) — both front-ends carry a block-bodied lambda as
 * host-expression TEXT (an `escape-hatch`), as they do an `on mount { }` body;
 * a `defer` there is reported as E-DEFER-OUTSIDE-FUNCTION instead of reaching
 * codegen verbatim.
 * A nested function inside a deferred body is its OWN control-flow scope: its
 * `return` / `fail` / `?` are legal.
 *
 * Pipeline placement: post-TAB, next to `lint-async-user-source.ts` (api.js).
 * Needs only the parsed AST.
 *
 * @module lint-defer
 */
import { isMetaKind } from "../types/ast.ts";
import { parseStatementText, textBodiesOf, textContainsDeferStatement, textContainsNativeKind } from "./defer-structure.ts";
import { iterDestructuredNames } from "../type-system.ts";
import type { FileAST, Span } from "../types/ast.ts";

export type DeferCode =
  | "E-DEFER-OUTSIDE-FUNCTION"
  | "E-DEFER-NESTED"
  | "E-DEFER-CONTROL-FLOW"
  | "E-DEFER-UNHANDLED-FAILABLE"
  | "E-DEFER-UNSUPPORTED-SITE"
  | "E-DEFER-LATER-SHADOW";

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

const UNSUPPORTED_SITE_MSG = (where: string, why?: string): string =>
  `\`defer\` is not supported in ${where} in this stage (§19.16.2): ` +
  (why ?? `the front-end carries that body as text, not as a scrml statement list, so there is no block ` +
    `for the deferred statement to attach to`) +
  `. Write the body as a braced block of an \`if\` / \`match\` statement arm / function, or move the ` +
  `\`defer\` to the enclosing function's block.`;

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
    // statements (a block-bodied lambda / function expression carried as an
    // escape-hatch, an `on mount { }` body) would reach codegen verbatim (an
    // E-CODEGEN-INVALID-LOGIC with no root cause). The text is PARSED (native
    // statement parser) and a `Defer` node looked for — no word matching.
    if (kind === "escape-hatch" && typeof n.raw === "string" && n.raw.includes("defer") &&
        textContainsDeferStatement(n.raw as string, true)) {
      report("E-DEFER-OUTSIDE-FUNCTION", n, LAMBDA_MSG);
      return;
    }
    if (kind === "bare-expr" && n._onMountEffect === true && typeof n.expr === "string" &&
        (n.expr as string).includes("defer") && textContainsDeferStatement(n.expr as string, false)) {
      report("E-DEFER-OUTSIDE-FUNCTION", n, TOP_LEVEL_MSG);
      return;
    }

    // --- function boundaries: a fresh control-flow scope ---
    if (kind === "function-decl") {
      // A `match` STATEMENT that is the implicit-return tail of a `fn` / return-typed
      // function (§48) is used for its value exactly like a match expression.
      if (Array.isArray(n.body) && (n.fnKind === "fn" || n.hasReturnType === true)) {
        const body = n.body as Node[];
        for (let i = body.length - 1; i >= 0; i--) {
          const t = body[i];
          if (!t || t._compileTimeOnly) continue;
          if (t.kind === "match-stmt") (t as Node).__deferValueTail = true;
          break;
        }
      }

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
      if (n.inBareBlock === true && !st.defer) {
        // Native front-end: a `defer` DIRECTLY inside a bare `{ }` block (the
        // bridge flattens bare blocks — translate-stmt.js). Not a stage-1 defer
        // site (§19.16.2).
        report("E-DEFER-UNSUPPORTED-SITE", n, UNSUPPORTED_SITE_MSG("a bare `{ }` block"));
      }
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

    // §19.16.2 (S430 round 5) — the arm bodies of a VALUE-FORM `match` / `if` /
    // `for` expression produce the expression's value from their tail; a
    // `defer` directly in such an arm would wrap that tail in the defer block and
    // the value would be lost (measured: `let k = match m { .A :> { defer D(); 7 } }`
    // left k unset). Not a stage-1 defer site: fail closed.
    if (!st.defer && (kind === "match-expr" || kind === "if-expr" || kind === "for-expr" ||
        (kind === "match-stmt" && n.__deferValueTail === true))) {
      const armLists: unknown[][] = [];
      if ((kind === "match-expr" || kind === "match-stmt") && Array.isArray(n.body)) {
        for (const arm of n.body as Node[]) if (arm && arm.kind === "match-arm-block" && Array.isArray(arm.body)) armLists.push(arm.body as unknown[]);
      }
      if (kind === "if-expr") {
        if (Array.isArray(n.consequent)) armLists.push(n.consequent as unknown[]);
        if (Array.isArray(n.alternate)) armLists.push(n.alternate as unknown[]);
      }
      if (kind === "for-expr" && Array.isArray(n.body)) armLists.push(n.body as unknown[]);
      for (const list of armLists) {
        for (const s of list) {
          if (s && typeof s === "object" && (s as Node).kind === "defer-stmt") {
            report("E-DEFER-UNSUPPORTED-SITE", s as Node,
              UNSUPPORTED_SITE_MSG(`an arm of a value-producing \`${String(kind).replace(/-(expr|stmt)$/, "")}\``,
                "the arm's last expression is the value the expression produces, and the defer block would " +
                "capture it"));
          }
        }
      }
    }

    const d = st.defer;
    if (!d && st.inFunction && !st.inLambda) {
      // §19.16.2 (S430 round 5, F3/F4) — a bare `{ }` block and a
      // single-statement `match` / handler arm are carried as TEXT, so a
      // `defer` written there is never parsed as a defer statement (it would
      // reach codegen verbatim). Not a stage-1 defer site: fail closed. The text
      // is PARSED (native statement parser) and a `Defer` node looked for.
      for (const tb of textBodiesOf(n)) {
        if (tb.text !== null && textContainsDeferStatement(tb.text, false)) {
          report("E-DEFER-UNSUPPORTED-SITE", n, UNSUPPORTED_SITE_MSG(tb.label));
        }
      }
    }
    if (d) {
      // Text-carried arm / handler bodies (S430 round 3): PARSE each into a
      // statement tree and run this same walk over it, in the current deferred
      // context (so a loop around the arm is still a break/continue target). A
      // body that does not parse fails closed.
      for (const tb of textBodiesOf(n)) {
        const parsed = tb.text === null ? { ok: false as const } : parseStatementText(tb.text, filePath);
        if (!parsed.ok) {
          report("E-DEFER-CONTROL-FLOW", n,
            `the control flow of ${tb.label} inside this deferred statement could not be verified — ` +
            `its body did not parse as scrml statements, and a deferred statement must be proven ` +
            `not to \`return\` / \`fail\` / \`?\` / \`break\` / \`continue\` out of it (§19.16.3). ` +
            `Simplify the arm body, or move the logic into a named function and call it.`);
          continue;
        }
        walk(parsed.stmts, st);
      }

      // §19.16.3 rule 3 (S430 round 3, H3) — a `!{}` handler on a deferred call
      // must be TOTAL: every failure, including a transport failure that is not
      // in the callee's declared error enum (a CPS / server-function call's
      // CpsError), must land in an arm. Without a `_` arm the lowering would
      // propagate the unmatched error with a `return` from inside the `finally`,
      // overriding the function's real return value.
      if (kind === "guarded-expr") {
        const arms = Array.isArray(n.arms) ? (n.arms as Node[]) : [];
        if (!arms.some((a) => a && a.pattern === "_")) {
          report("E-DEFER-UNHANDLED-FAILABLE", n,
            "a `!{}` handler on a deferred call must handle EVERY failure in place, including ones " +
            "not listed in the callee's error type (a network / server failure of a server call) — " +
            "an unmatched failure has nowhere to go from a block that is already exiting (§19.16.3). " +
            "Add a catch-all arm: `| _ :> …`.");
        }
      }

      // §19.16.3 rule 1 (S430 round 5, F5) — `yield` / `yield*` suspends the
      // generator from inside a block that is already exiting.
      if (kind === "yield-stmt") controlFlow(n, "`yield`");
      else if (kind === "escape-hatch" && n.nativeKind === "Yield") controlFlow(n, "`yield`");
      else if (kind === "escape-hatch" && typeof n.raw === "string" && (n.raw as string).includes("yield") &&
               textContainsNativeKind(n.raw as string, true, ["Yield"])) controlFlow(n, "`yield`");
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
  checkLaterShadow((ast as { nodes?: unknown }).nodes ?? ast, filePath, report);
  return diagnostics;
}

// ---------------------------------------------------------------------------
// §19.16.2 (S430 round 5, F1) — E-DEFER-LATER-SHADOW
// ---------------------------------------------------------------------------
//
// A deferred statement sees the bindings in scope AT THE `defer` (§19.16.2); a
// binding declared LATER in the same block is not in scope for it. The
// lowering runs the deferred statement as a closure created inside the block,
// so JS lexical scoping would bind such a name to the LATER declaration (or
// throw — TDZ — when the block exits before it). Rather than make the closure
// resolve differently, the compiler FAILS CLOSED: a name the deferred statement
// reads that is (re)declared later in its enclosing block chain is a compile
// error; the author renames one of them.
//
// Structural: the deferred statement's free identifiers come from its TREE
// (`ident` nodes; names it declares itself and lambda / nested-function
// parameters are bound), and the later declarations from `let` / `const` /
// `lin` declaration nodes (every name a destructuring pattern binds). Function
// declarations are hoisted to the top of their block (the scope checker
// resolves them there too), so a later `function` is not a later binding. When
// part of the deferred statement cannot be seen as a tree and there IS a later
// declaration in the chain, the check fails closed ("could not be verified").

type ReportFn = (code: DeferCode, n: Node, message: string) => void;

const LATER_DECL_KINDS = new Set(["let-decl", "const-decl", "lin-decl"]);

function declNames(target: unknown): string[] {
  if (typeof target === "string") return target ? [target] : [];
  if (target && typeof target === "object") {
    const k = (target as Node).kind;
    if (k === "destructure-array" || k === "destructure-object") {
      return [...iterDestructuredNames(target as Parameters<typeof iterDestructuredNames>[0])];
    }
  }
  return [];
}

function paramNames(params: unknown): string[] {
  const out: string[] = [];
  for (const p of (Array.isArray(params) ? params : []) as unknown[]) {
    if (typeof p === "string") out.push(p.split(":")[0].trim());
    else if (p && typeof p === "object") {
      const nm = (p as Node).name;
      if (typeof nm === "string") out.push(nm);
      else out.push(...declNames(nm));
    }
  }
  return out.filter((x) => x.length > 0);
}

/** Free identifiers of deferred statements, or `null` when some part is not a tree. */
function deferredFreeNames(stmts: unknown[]): Set<string> | null {
  const free = new Set<string>();
  let unknown = false;
  const seen = new WeakSet<object>();
  const TEXT_FIELDS: Array<[string, string[]]> = [
    ["expr", ["exprNode", "sqlNode"]],
    ["init", ["initExpr", "sqlNode", "matchExpr", "ifExpr", "forExpr", "foreignNode"]],
    ["condition", ["condExpr"]],
    ["iterable", ["iterExpr", "cStyleParts"]],
  ];
  const visit = (n: unknown, bound: Set<string>): void => {
    if (unknown || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      // a statement list: its own declarations bind for the whole list
      const inner = new Set(bound);
      for (const s of n) {
        const sn = s as Node;
        if (sn && typeof sn === "object" && typeof sn.kind === "string" &&
            (LATER_DECL_KINDS.has(sn.kind) || sn.kind === "tilde-decl")) {
          for (const nm of declNames(sn.name)) inner.add(nm);
        }
        if (sn && sn.kind === "function-decl" && typeof sn.name === "string") inner.add(sn.name);
      }
      for (const c of n) visit(c, inner);
      return;
    }
    if (seen.has(n as object)) return;
    seen.add(n as object);
    const nn = n as Node;
    const k = nn.kind;
    if (k === "ident") {
      if (typeof nn.name === "string" && !bound.has(nn.name)) free.add(nn.name);
      return;
    }
    if (k === "escape-hatch") { unknown = true; return; }
    if (k === "lambda" || k === "function-decl") {
      const inner = new Set(bound);
      for (const p of paramNames(nn.params)) inner.add(p);
      if (typeof nn.name === "string") inner.add(nn.name);
      for (const key of Object.keys(nn)) if (key !== "span" && key !== "params") visit(nn[key], inner);
      return;
    }
    if (k === "for-stmt" || k === "for-expr") {
      const inner = new Set(bound);
      for (const nm of declNames(nn.variable)) inner.add(nm);
      for (const key of Object.keys(nn)) if (key !== "span") visit(nn[key], inner);
      return;
    }
    // A statement's source-text field without its structured mirror: not a tree.
    for (const [tk, mirrors] of TEXT_FIELDS) {
      const t = nn[tk];
      if (typeof t === "string" && t.trim() !== "" && typeof k === "string" && k.endsWith("-decl") === false &&
          (k === "bare-expr" || k === "return-stmt" || k === "if-stmt" || k === "while-stmt") &&
          !mirrors.some((m) => nn[m] != null)) {
        unknown = true;
        return;
      }
      if (typeof t === "string" && t.trim() !== "" && (k === "let-decl" || k === "const-decl" || k === "tilde-decl" || k === "state-decl") &&
          tk === "init" && !mirrors.some((m) => nn[m] != null)) {
        unknown = true;
        return;
      }
    }
    // Text-carried arm / handler / bare-block bodies: parse and walk.
    for (const tb of textBodiesOf(nn)) {
      if (tb.text === null) { unknown = true; return; }
      const parsed = parseStatementText(tb.text);
      if (!parsed.ok) { unknown = true; return; }
      visit(parsed.stmts, bound);
    }
    for (const key of Object.keys(nn)) {
      if (key === "span") continue;
      if (key === "arms" && k === "guarded-expr") continue;  // handler bodies walked via textBodiesOf
      if (key === "rawArms") continue;
      if ((k === "match-expr" || k === "match-stmt") && key === "body") {
        // arm PATTERNS are not reads; arm bodies were walked via textBodiesOf,
        // except structured `match-arm-block` bodies, walked here.
        for (const arm of (Array.isArray(nn.body) ? nn.body : []) as Node[]) {
          if (arm && arm.kind === "match-arm-block") visit(arm.body, bound);
        }
        continue;
      }
      visit(nn[key], bound);
    }
  };
  visit(stmts, new Set());
  return unknown ? null : free;
}

function lineOf(n: Node): string {
  const sp = n.span as { line?: number } | undefined;
  return sp && typeof sp.line === "number" ? `line ${sp.line}` : "a later line";
}

function checkLaterShadow(root: unknown, filePath: string, report: ReportFn): void {
  void filePath;
  type Frame = { list: unknown[]; i: number };
  const seen = new WeakSet<object>();

  const laterDecls = (chain: Frame[]): Map<string, Node> => {
    const out = new Map<string, Node>();
    for (const f of chain) {
      for (let j = f.i + 1; j < f.list.length; j++) {
        const s = f.list[j] as Node;
        if (!s || typeof s !== "object" || typeof s.kind !== "string" || !LATER_DECL_KINDS.has(s.kind)) continue;
        if (s._bareAssign === true) continue; // keywordless `x = ?{…}`: an assignment, not a declaration
        for (const nm of declNames(s.name)) if (!out.has(nm)) out.set(nm, s);
      }
    }
    return out;
  };

  const checkDefer = (d: Node, chain: Frame[]): void => {
    const later = laterDecls(chain);
    if (later.size === 0) return;
    const free = deferredFreeNames(Array.isArray(d.body) ? (d.body as unknown[]) : []);
    if (free === null) {
      report("E-DEFER-LATER-SHADOW", d,
        `this deferred statement could not be analysed for the names it reads, and its block ` +
        `declares ${[...later.keys()].map((x) => "`" + x + "`").join(", ")} after the \`defer\`. A deferred ` +
        `statement sees only the bindings in scope at the \`defer\` (§19.16.2) and must be proven not to ` +
        `read a later declaration. Simplify the deferred statement, or move the later declaration(s) ` +
        `above the \`defer\`.`);
      return;
    }
    for (const nm of free) {
      const decl = later.get(nm);
      if (!decl) continue;
      const declKw = decl.kind === "const-decl" ? "const" : decl.kind === "lin-decl" ? "lin" : "let";
      report("E-DEFER-LATER-SHADOW", d,
        `the deferred statement (${lineOf(d)}) reads \`${nm}\`, which is declared again later in its ` +
        `enclosing block (\`${declKw} ${nm}\`, ${lineOf(decl)}). A deferred statement sees only the ` +
        `bindings in scope at the \`defer\` (§19.16.2), but it runs at the block's exit, where the later ` +
        `\`${nm}\` would be captured instead (or read before it is initialised). Rename one of them.`);
    }
  };

  const walkList = (list: unknown[], chain: Frame[]): void => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const frame: Frame = { list, i };
      const sn = s as Node;
      if (sn && typeof sn === "object" && sn.kind === "defer-stmt") {
        checkDefer(sn, [...chain, frame]);
        continue; // no defer can nest in a deferred body (E-DEFER-NESTED)
      }
      walkNode(s, [...chain, frame]);
    }
  };

  const walkNode = (n: unknown, chain: Frame[]): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) {
      if (n.some((c) => c && typeof c === "object" && typeof (c as Node).kind === "string")) walkList(n, chain);
      return;
    }
    const nn = n as Node;
    if (nn.kind === "function-decl") {
      // a function body starts a fresh block chain
      if (Array.isArray(nn.body)) walkList(nn.body as unknown[], []);
      return;
    }
    for (const key of Object.keys(nn)) {
      if (key === "span") continue;
      walkNode(nn[key], chain);
    }
  };

  walkNode(root, []);
}
