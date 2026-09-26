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
import { isWhenTextKind, parseStatementText, textBodiesOf, textContainsDeferStatement, textContainsDirectDeferStatement, textContainsNativeKind, textLambdaContainsDefer, textLoweredBodiesOf } from "./defer-structure.ts";
import { iterDestructuredNames } from "../type-system.ts";
import type { FileAST, Span } from "../types/ast.ts";

export type DeferCode =
  | "E-DEFER-OUTSIDE-FUNCTION"
  | "E-DEFER-NESTED"
  | "E-DEFER-CONTROL-FLOW"
  | "E-DEFER-UNHANDLED-FAILABLE"
  | "E-DEFER-UNSUPPORTED-SITE"
  | "E-DEFER-LATER-SHADOW"
  | "E-DEFER-DUPLICATE-FUNCTION"
  | "E-DEFER-AMBIGUOUS-LEAD";

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

const LOWERED_TEXT_MSG = (label: string, anyDepth: boolean): string =>
  `\`defer\` is only valid inside a function declaration body (\`function\`, \`fn\`, \`server function\`) ` +
  `or a block nested in one (§19.16.3). ${label.charAt(0).toUpperCase() + label.slice(1)} is not a function-declaration body` +
  (anyDepth
    ? ` — and it is lowered as text, so a \`defer\` anywhere in it (including in a function declared inside ` +
      `it) has no block exit to run at. Move the cleanup into a named function declared outside it, and call ` +
      `that function from here.`
    : `. Move the handler body into a named function declaration and reference it (\`onclick=handler()\`).`);

/**
 * S432 review A-3 — a text probe that could not analyse its text (`null`)
 * fails CLOSED: the diagnostic is reported, saying the body could not be
 * verified rather than claiming a `defer` was seen.
 */
const unverified = (probe: boolean | null, message: string): string =>
  probe === null
    ? `${message} (This body could not be parsed to verify that it contains no \`defer\`, so it is rejected ` +
      `rather than passed to code generation unchecked.)`
    : message;

/** Parse a `component-def.raw` markup body the way the component expander does; `null` on failure. */
function parseComponentMarkup(raw: string, name: string, filePath: string): unknown[] | null {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const ce = require("../component-expander.ts") as {
      parseComponentBody: (r: string, n: string, f: string) => { nodes: unknown[]; errors: unknown[] };
    };
    const out = ce.parseComponentBody(raw, name, filePath);
    return Array.isArray(out.nodes) && out.nodes.length > 0 ? out.nodes : null;
  } catch {
    return null;
  }
}

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

  // The nearest enclosing node with a real source line — used when a diagnostic
  // lands on a node the front-end left without one (an expression escape-hatch
  // inside a statement; S430 round 6, G).
  let anchor: Node | null = null;
  // Set while walking a tree re-parsed from a node's TEXT (a component body):
  // its spans are relative to the synthesized source, so report at the owner.
  let forcedAnchor: Node | null = null;
  const hasLine = (x: Node | null | undefined): boolean => {
    const sp = x && (x.span as { line?: number; start?: number } | undefined);
    return !!sp && typeof sp.line === "number" && (sp.line > 1 || (typeof sp.start === "number" && sp.start > 0));
  };
  const isStatementNode = (x: Node): boolean => {
    const k = typeof x.kind === "string" ? x.kind : "";
    return k.endsWith("-stmt") || k.endsWith("-decl") ||
      k === "bare-expr" || k === "guarded-expr" || k === "propagate-expr" || k === "fail-expr" || k === "lift-expr";
  };
  const report = (code: DeferCode, n: Node, message: string) => {
    // An expression node's span can be relative to its own source snippet; a
    // statement's is a real source position.
    const at = forcedAnchor ?? (hasLine(n) && isStatementNode(n) ? n : (anchor ?? n));
    diagnostics.push({ code, severity: "error", span: spanOf(at, filePath), message: `${code}: ${message}` });
  };

  const controlFlow = (n: Node, what: string) =>
    report("E-DEFER-CONTROL-FLOW", n, `a deferred statement cannot contain ${what} — ${CONTROL_FLOW_WHY}`);

  // §19.16.6 (S430 round 6, B) — the defer lowering wraps the whole block in a
  // host `try { … }`, where two `function` declarations of one name are a
  // SyntaxError (strict-mode block scope). §7.3.3 deliberately leaves duplicate
  // functions alone elsewhere; in a block that contains a `defer` they are
  // rejected here, naming both, instead of crashing codegen.
  const checkDuplicateFunctions = (list: unknown[]): void => {
    const firstByName = new Map<string, Node>();
    for (const c of list) {
      const cn = c as Node;
      if (!cn || typeof cn !== "object" || cn.kind !== "function-decl" || typeof cn.name !== "string" || cn.fromExport === true) continue;
      const prev = firstByName.get(cn.name);
      if (!prev) { firstByName.set(cn.name, cn); continue; }
      const ln = (x: Node) => { const sp = x.span as { line?: number } | undefined; return sp && typeof sp.line === "number" ? `line ${sp.line}` : "an earlier line"; };
      report("E-DEFER-DUPLICATE-FUNCTION", cn,
        `\`function ${cn.name}\` (${ln(cn)}) is declared twice in a block that contains a \`defer\` ` +
        `(first at ${ln(prev)}). A block with a \`defer\` becomes a host \`try\` block (§19.16.6), where a ` +
        `second declaration of the same function name is not allowed. Rename one of them, or remove the ` +
        `duplicate.`);
    }
  };

  function walk(node: unknown, st: WalkState): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (st.inFunction && !st.defer && node.some((c) => c && typeof c === "object" && (c as Node).kind === "defer-stmt")) {
        checkDuplicateFunctions(node as unknown[]);
      }
      for (const c of node) walk(c, st);
      return;
    }
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Node;
    const kind = n.kind;
    const prevAnchor = anchor;
    if (hasLine(n) && isStatementNode(n)) anchor = n;
    try {
      walkNode(n, kind, st);
    } finally {
      anchor = prevAnchor;
    }
  }

  function walkNode(n: Node, kind: string | undefined, st: WalkState): void {

    // `^{}` meta and `_{}` foreign bodies are host-adjacent / opaque — not scrml
    // logic statement lists, so `defer` has no meaning there.
    if (typeof kind === "string" && (isMetaKind(kind) || kind === "foreign" || kind === "Foreign")) return;

    // --- raw-text bodies: a `defer` inside text the front-end did not parse as
    // statements (a block-bodied lambda / function expression carried as an
    // escape-hatch, an `on mount { }` body) would reach codegen verbatim (an
    // E-CODEGEN-INVALID-LOGIC with no root cause). The text is PARSED (native
    // statement parser) and a `Defer` node looked for — no word matching.
    if (kind === "escape-hatch" && typeof n.raw === "string" && n.raw.includes("defer")) {
      const r = textLambdaContainsDefer(n.raw as string);
      if (r !== false) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(r, LAMBDA_MSG));
        return;
      }
    }
    if (kind === "bare-expr" && n._onMountEffect === true && typeof n.expr === "string" &&
        (n.expr as string).includes("defer")) {
      const r = textContainsDeferStatement(n.expr as string, false);
      if (r !== false) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(r, TOP_LEVEL_MSG));
        return;
      }
    }
    // §19.16.3 rule 4 (S432 review A-1) — a `const Name = <markup>` component
    // definition is carried as RAW markup text (`component-def.raw`) until the
    // component expander re-parses it at each use. Parse it the same way here
    // and walk the markup with this walker (not in a function: a component
    // body is markup), so its handler attributes / `${ }` logic are checked
    // like any other markup. Diagnostics anchor on the definition.
    // The same for a `<match>` block whose arms reached the AST only as TEXT
    // (`armsRaw` without the live front-end's structured `armBodyChildren` —
    // the native front-end): parse the arm markup and walk it in place.
    if (kind === "match-block" && typeof n.armsRaw === "string" && !Array.isArray(n.armBodyChildren) &&
        (n.armsRaw as string).includes("defer")) {
      const parsed = parseComponentMarkup(n.armsRaw as string, "MatchArms", filePath);
      if (parsed === null) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(null, TOP_LEVEL_MSG));
      } else {
        const prevForced = forcedAnchor;
        forcedAnchor = n;
        try { walk(parsed, st); } finally { forcedAnchor = prevForced; }
      }
    }
    if (kind === "component-def" && typeof n.raw === "string" && (n.raw as string).includes("defer")) {
      const parsed = parseComponentMarkup(n.raw as string, typeof n.name === "string" ? n.name : "Component", filePath);
      if (parsed === null) {
        report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(null, TOP_LEVEL_MSG));
      } else {
        const prevForced = forcedAnchor;
        forcedAnchor = n;
        try { walk(parsed, { inFunction: false, defer: null }); } finally { forcedAnchor = prevForced; }
      }
      return;
    }
    // §19.16.3 rule 4 (S432, A1) — statement bodies a node carries AND codegen
    // lowers as TEXT, in any context: `when` handler bodies, `test` bodies, an
    // `on*=${ … }` handler attribute. None is a function-declaration body. The
    // text is PARSED and a `Defer` looked for (defer-structure.ts
    // textLoweredBodiesOf enumerates the node kinds).
    if (!st.defer) {
      let loweredHit = false;
      for (const tb of textLoweredBodiesOf(n)) {
        const hit = tb.anyDepth ? textContainsDeferStatement(tb.text, false) : textContainsDirectDeferStatement(tb.text);
        if (hit !== false) {
          report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(hit, LOWERED_TEXT_MSG(tb.label, tb.anyDepth)));
          loweredHit = true;
          // The handler attribute's own value (its `exprNode` escape-hatch) is
          // the same text: do not walk it again under the lambda rule (review A-2).
          if (tb.owner && typeof tb.owner === "object") seen.add(tb.owner as object);
        }
      }
      // A `when` node's only other child is `bodyExpr`, a best-effort EXPRESSION
      // parse of the same text; walking it would re-report the same `defer`
      // under the wrong rule (a function declared in the body reads as a lambda).
      if (loweredHit && isWhenTextKind(kind)) return;
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
      if (n.unbracedArm === true && !st.defer) {
        // §19.16.2 (S430 round 6) — the unbraced body of an if / else / loop arm.
        report("E-DEFER-UNSUPPORTED-SITE", n, UNSUPPORTED_SITE_MSG(
          "the unbraced body of an `if` / `else` / loop",
          "an unbraced arm has no written block for the deferred statement to attach to (and the live " +
          "front-end does not keep an unbraced `else` arm at all)"));
      }
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
    if (!d && !st.inFunction && !st.inLambda) {
      // §19.16.3 rule 4 (S432, A1) — the same text-carried bodies (a match / `!{}`
      // arm, a bare `{ }` block) OUTSIDE any function declaration: top-level
      // `${ }` logic, which is not a defer site at all. Without this a `defer`
      // there reached codegen verbatim (live: an inline arm / `!{}` arm / bare
      // block; native: every statement-position match arm).
      for (const tb of textBodiesOf(n)) {
        const r = tb.text === null ? false : textContainsDeferStatement(tb.text, false);
        if (r !== false) report("E-DEFER-OUTSIDE-FUNCTION", n, unverified(r, TOP_LEVEL_MSG));
      }
    }
    if (!d && st.inFunction && !st.inLambda) {
      // §19.16.2 (S430 round 5, F3/F4) — a bare `{ }` block and a
      // single-statement `match` / handler arm are carried as TEXT, so a
      // `defer` written there is never parsed as a defer statement (it would
      // reach codegen verbatim). Not a stage-1 defer site: fail closed. The text
      // is PARSED (native statement parser) and a `Defer` node looked for.
      for (const tb of textBodiesOf(n)) {
        const r = tb.text === null ? false : textContainsDeferStatement(tb.text, false);
        if (r !== false) report("E-DEFER-UNSUPPORTED-SITE", n, unverified(r, UNSUPPORTED_SITE_MSG(tb.label)));
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
               textContainsNativeKind(n.raw as string, true, ["Yield"]) !== false) controlFlow(n, "`yield`");
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
  checkAmbiguousLead((ast as { nodes?: unknown }).nodes ?? ast, report);
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
        // native bridge: a declaration flattened out of a bare `{ }` block lives in
        // that (lost) inner block, not in this one (translate-stmt.js).
        if (s.bareBlockScope !== undefined && s.bareBlockScope !== (f.list as Node[])[f.i]?.bareBlockScope) continue;
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
        `read a later declaration; this one could not be (e.g. it contains a block-bodied arrow function, ` +
        `which the front-end keeps as text). Fix: move the later declaration(s) above the \`defer\`, or ` +
        `rename them so they cannot collide, or move the arrow's body into a named function.`);
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

// ---------------------------------------------------------------------------
// §19.16.1 (S432, B2) — E-DEFER-AMBIGUOUS-LEAD
// ---------------------------------------------------------------------------
//
// S430 round 6 made `defer` + whitespace + `[` open a defer statement
// (`defer ["a"].forEach(f)`). Where a binding NAMED `defer` is in scope, the
// same tokens were — before `defer` existed — an index of that binding:
// `defer [0] = 9`, `defer [0].m = 5`, `defer [0].forEach(f)`. The parser cannot
// tell the two apart from the tokens (both readings are well-formed), and
// choosing the defer reading silently changes what a pre-existing program does.
// So: a `[`-led single-statement `defer` while a binding named `defer` is in
// scope is a compile error naming both spellings — `defer[0]` (adjacent) indexes
// the binding, `defer { [0]… }` defers the statement. With no such binding
// the round-6 reading stands (the identifier reading would be an undeclared
// name, which never compiled).
//
// "In scope" is decided per outermost function declaration, coarsely and
// fail-closed: a binding named `defer` ANYWHERE in that function (a parameter,
// a local `let`/`const`/`lin`/`~`, a nested function's name or parameter, a loop
// or lambda binder) or at file level (a top-level declaration or import) makes
// every `[`-led defer in the function ambiguous. Over-approximating only rejects
// programs that both bind `defer` and write `defer [`; it never mis-reads one.

const DEFER_NAME = "defer";

function bindingName(raw: string): string {
  return raw.replace(/^\s*(const|let|var|lin)\s+/, "").split(":")[0].split("=")[0].trim();
}

function paramBindsDefer(params: unknown): boolean {
  for (const p of (Array.isArray(params) ? params : []) as unknown[]) {
    if (typeof p === "string" && bindingName(p) === DEFER_NAME) return true;
    if (p && typeof p === "object") {
      const nm = (p as Node).name;
      if (typeof nm === "string" && bindingName(nm) === DEFER_NAME) return true;
      if (nm && typeof nm === "object" && declNames(nm).includes(DEFER_NAME)) return true;
    }
  }
  return false;
}

/** Does THIS node itself introduce a binding named `defer`? */
function nodeBindsDefer(n: Node): boolean {
  const k = n.kind;
  if (k === "let-decl" || k === "const-decl" || k === "lin-decl" || k === "tilde-decl") {
    return typeof n.name === "string" ? bindingName(n.name) === DEFER_NAME : declNames(n.name).includes(DEFER_NAME);
  }
  if (k === "function-decl") return n.name === DEFER_NAME || paramBindsDefer(n.params);
  if (k === "lambda") return paramBindsDefer(n.params);
  if (k === "for-stmt") {
    const v = n.variable;
    return typeof v === "string" ? bindingName(v) === DEFER_NAME : declNames(v).includes(DEFER_NAME);
  }
  if (k === "import-decl" && Array.isArray(n.names)) return (n.names as unknown[]).includes(DEFER_NAME);
  return false;
}

/**
 * Is a single-statement deferred body led by an array literal? Structural: the
 * leftmost operand of the statement's expression tree is an `array` node. When
 * the front-end could not structure the statement (an escape-hatch — e.g. the
 * invalid `[0] = 9`), its token text is the parser's own space-joined token
 * stream, whose first token is the lead.
 */
function deferIsBracketLed(d: Node): boolean {
  if (d.blockForm === true || !Array.isArray(d.body) || d.body.length === 0) return false;
  const s = d.body[0] as Node;
  if (!s || typeof s !== "object") return false;
  let e = (s.exprNode ?? s.initExpr ?? null) as Node | null;
  for (let guard = 0; e && guard < 64; guard++) {
    if (e.kind === "array") return true;
    if (e.kind === "call" || e.kind === "new") e = e.callee as Node;
    else if (e.kind === "member" || e.kind === "index") e = e.object as Node;
    else if (e.kind === "assign") e = e.target as Node;
    else if (e.kind === "binary") e = e.left as Node;
    else if (e.kind === "ternary") e = e.condition as Node;
    else break;
  }
  if (e && e.kind === "escape-hatch") {
    const text = typeof s.expr === "string" && s.expr.trim() !== "" ? s.expr : (typeof e.raw === "string" ? e.raw : "");
    return (text as string).trimStart().startsWith("[");
  }
  return false;
}

function checkAmbiguousLead(root: unknown, report: ReportFn): void {
  const anyBinds = (n: unknown, stopAtFunctions: boolean): boolean => {
    let found = false;
    const seen = new WeakSet<object>();
    const walk = (x: unknown): void => {
      if (found || !x || typeof x !== "object" || seen.has(x as object)) return;
      seen.add(x as object);
      if (Array.isArray(x)) { for (const c of x) walk(c); return; }
      const nn = x as Node;
      if (stopAtFunctions && nn.kind === "function-decl") {
        // at file level only the function's NAME binds; its body is its own scope
        if (nn.name === DEFER_NAME) found = true;
        return;
      }
      if (nodeBindsDefer(nn)) { found = true; return; }
      for (const key of Object.keys(nn)) if (key !== "span" && key !== "parent") walk(nn[key]);
    };
    walk(n);
    return found;
  };
  const fileBinds = anyBinds(root, true);

  const reportIn = (fn: Node): void => {
    const seen = new WeakSet<object>();
    const walk = (x: unknown): void => {
      if (!x || typeof x !== "object" || seen.has(x as object)) return;
      seen.add(x as object);
      if (Array.isArray(x)) { for (const c of x) walk(c); return; }
      const nn = x as Node;
      if (nn.kind === "defer-stmt" && deferIsBracketLed(nn)) {
        report("E-DEFER-AMBIGUOUS-LEAD", nn,
          `\`defer [\` is ambiguous here: a binding named \`defer\` is in scope, so this could index it ` +
          `(\`defer[…]\`) or defer a statement that starts with an array literal (§19.16.1). Write ` +
          `\`defer[…]\` with no space to index the binding, \`defer { […]… }\` to defer the statement, or ` +
          `rename the binding.`);
      }
      for (const key of Object.keys(nn)) if (key !== "span" && key !== "parent") walk(nn[key]);
    };
    walk(fn.body);
  };

  // Each OUTERMOST function declaration is one scope unit (its nested functions included).
  const seen = new WeakSet<object>();
  const findFns = (x: unknown): void => {
    if (!x || typeof x !== "object" || seen.has(x as object)) return;
    seen.add(x as object);
    if (Array.isArray(x)) { for (const c of x) findFns(c); return; }
    const nn = x as Node;
    if (nn.kind === "function-decl") {
      if (fileBinds || anyBinds(nn, false)) reportIn(nn);
      return;
    }
    for (const key of Object.keys(nn)) if (key !== "span" && key !== "parent") findFns(nn[key]);
  };
  findFns(root);
}
