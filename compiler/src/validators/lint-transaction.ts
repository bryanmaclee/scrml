/**
 * `transaction { }` placement + exit checker — SPEC §19.10.4 (S450).
 *
 * Runs on the live-shaped AST post-TAB, next to lint-defer.ts. The parser
 * (ast-builder.js parseTransactionBlock) produces
 *
 *   { kind: "transaction-block", body: LogicStatement[], span }
 *
 * at the top level of a `${}` logic block AND in every nested body (a function
 * body, if/else, loop and match-arm blocks).
 *
 * Codes (all hard errors):
 *
 *   - `E-ERROR-001` (§19.10.4) — a `transaction` block OUTSIDE a `!` function:
 *     inside a function not declared `!`, or (S453/B1b) at the top level of a
 *     `${}` logic block, outside any function. ("`transaction { }` SHALL be valid
 *     only inside `!` functions … E-ERROR-001 applies".)
 *   - `E-ERROR-007` (§19.10.4) — a `transaction` block inside another one.
 *   - `E-TRANSACTION-CONTROL-FLOW` (§19.10.4) — the exits §19.10.3 does not
 *     govern. TWO limbs remain after S453:
 *       (1) a `yield` inside a `transaction` block in a function. A `yield`
 *           SUSPENDS the block rather than leaving it, so neither of §19.10.3's
 *           endings applies. Fail-closed.
 *       (2) an exit that cannot reach the block's own `finally` because the
 *           emitted arm is a nested function: a `fail` / `?` inside an arm of a
 *           STATEMENT-position `match` (S450 fix round), and a `return` /
 *           `break` / `continue` inside an arm of ANY `match`, statement- or
 *           expression-position (S453/B1a). `emitMatchExpr` lowers both match
 *           positions as an IIFE, so such an exit returns from the arm only and
 *           the statements after the `match` keep running
 *           (g-stmt-match-block-return-falls-through).
 *
 *     ⚑ **RULED AT S453 and no longer refused (B1a):** a `return`, or a `break` /
 *     `continue` whose target is outside the block, anywhere else in the block.
 *     Those ROLL THE BLOCK BACK and the exit proceeds; only normal completion
 *     COMMITs (§19.10.3). The rollback is carried by the block's `try`/`finally`
 *     in emit-logic.ts — see the note at the exit checks below for why that is
 *     the right mechanism rather than the `fail`-style pre-return marking.
 *     `fail` and `?` (§19.5.2: `?` is a `fail`) stay governed and allowed.
 *
 * Text-carried bodies (`!{}` handler arms, single-statement `match` arms, a bare
 * `{ }` block) are PARSED into statement trees with the same helper lint-defer
 * uses (defer-structure.ts) and walked in the current transaction context; a
 * body that does not parse fails closed.
 *
 * A nested function declaration or lambda is its own control-flow scope: its
 * `return` is legal, and a `transaction` in it is checked against ITS `!`.
 *
 * @module lint-transaction
 */
import { isMetaKind } from "../types/ast.ts";
import { parseStatementText, textBodiesOf } from "./defer-structure.ts";
import type { FileAST, Span } from "../types/ast.ts";

export type TransactionCode = "E-ERROR-001" | "E-ERROR-007" | "E-TRANSACTION-CONTROL-FLOW";

export interface TransactionDiagnostic {
  code: TransactionCode;
  message: string;
  span: Span;
  severity: "error";
}

type Node = Record<string, unknown> & { kind?: string; span?: Span };

/** Control-flow context while walking INSIDE a transaction block. */
interface TxnCtx {
  /** Loops opened inside the block (break/continue targets). */
  loopDepth: number;
  /** `switch` statements opened inside the block (break targets). */
  switchDepth: number;
  /** Labels declared inside the block. */
  labels: Set<string>;
  /** True when the block is inside a function (exit checks apply). */
  inFunction: boolean;
  /** True inside the arms of a STATEMENT-position `match` within the block. */
  inStmtMatchArm: boolean;
  /**
   * True inside the arms of ANY `match` within the block — statement- AND
   * expression-position. S453/B1a: `return` / `break` / `continue` now ROLL BACK
   * and proceed, which is sound only when the exit crosses no function boundary
   * on its way out of the emitted `try`/`finally`. `emitMatchExpr`
   * (codegen/emit-logic.ts `case "match-stmt"` / `case "match-expr"`) lowers BOTH
   * match positions as an IIFE, so an exit inside an arm returns from the arm and
   * never reaches the block's `finally` — the same swallowing defect the
   * `fail` / `?` arm limb refuses (g-stmt-match-block-return-falls-through).
   * Kept refused. This flag is deliberately WIDER than `inStmtMatchArm`: a
   * `fail` / `?` in an EXPRESSION-position arm is governed and fine (runtime-
   * verified S450), but an EXIT in one is not.
   */
  inMatchArm: boolean;
}

interface WalkState {
  /** The nearest enclosing function declaration, or null at top level / in a lambda. */
  fn: { name: string; canFail: boolean } | null;
  /** Non-null while inside a transaction block (reset at a function boundary). */
  txn: TxnCtx | null;
  /** Outside any transaction: true under an arm of a statement-position `match`
   *  in the current function (reset at a function boundary). */
  inStmtMatchArmOuter?: boolean;
  /** True inside a lambda body — `fn` is null there too, so this is what tells a
   *  lambda apart from the top level for the S453/B1b E-ERROR-001 message. */
  inLambda?: boolean;
}

const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt"]);

// S453/B1a narrowed this to `yield` alone. `return` / `break` / `continue` are
// RULED (§19.10.3): they roll back and the exit proceeds. A `yield` is a
// SUSPENSION, not an exit — the block would be re-entered after the resume, so
// rolling back is wrong and committing is undecided. Fail-closed.
const CONTROL_FLOW_WHY =
  "a `yield` SUSPENDS the block rather than leaving it, so neither of §19.10.3's endings applies: " +
  "rolling back would discard work the block is about to continue, and committing would end a " +
  "transaction that is still open (§19.10.4: no transaction is left open). " +
  "Move the `yield` out of the block — let the block complete, then yield its result.";

export function runTransactionChecks(ast: FileAST | null | undefined): TransactionDiagnostic[] {
  const diagnostics: TransactionDiagnostic[] = [];
  if (!ast) return diagnostics;
  const filePath = (ast as { filePath?: string }).filePath ?? "";
  const seen = new WeakSet<object>();

  // The nearest enclosing statement with a real source line — a node parsed
  // out of handler / arm TEXT carries a span relative to that text.
  let anchor: Node | null = null;
  const hasLine = (x: Node | null | undefined): boolean => {
    const sp = x && (x.span as { line?: number; start?: number } | undefined);
    return !!sp && typeof sp.line === "number" && (sp.line > 1 || (typeof sp.start === "number" && sp.start > 0));
  };
  const isStatementNode = (x: Node): boolean => {
    const k = typeof x.kind === "string" ? x.kind : "";
    return k.endsWith("-stmt") || k.endsWith("-decl") || k.endsWith("-block") ||
      k === "bare-expr" || k === "guarded-expr" || k === "propagate-expr" || k === "fail-expr";
  };
  let inText = 0;
  const report = (code: TransactionCode, n: Node, message: string) => {
    const at = inText === 0 && hasLine(n) && isStatementNode(n) ? n : (anchor ?? n);
    const span = (at.span as Span | undefined) ?? ({ file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span);
    diagnostics.push({ code, severity: "error", span, message: `${code}: ${message}` });
  };
  const controlFlow = (n: Node, what: string) =>
    report("E-TRANSACTION-CONTROL-FLOW", n, `a \`transaction\` block cannot be left by ${what} — ${CONTROL_FLOW_WHY}`);
  // S450 fix round — a statement-position `match` arm is lowered into a nested
  // function (an IIFE), so a `fail` / `?` in it returns from the ARM only, not
  // from the transaction's function (g-stmt-match-block-return-falls-through).
  // The rollback runs, but the statements AFTER the `match` then run with no
  // transaction open and persist (autocommit). Rejected until that lowering is fixed.
  const failInStmtMatchArm = (n: Node, what: string) =>
    report("E-TRANSACTION-CONTROL-FLOW", n,
      `${what} inside a statement-position \`match\` arm cannot leave a \`transaction\` block yet — ` +
      `the arm is lowered as a nested function, so the ${what} would return from the arm only: the ` +
      `transaction would be rolled back while the statements after the \`match\` kept running outside it ` +
      `(g-stmt-match-block-return-falls-through). Use an expression-position \`match\` ` +
      `(\`let v = match … { .A :> fail … }\`) or an \`if\` / \`else if\` chain, or move the ${what} out of the arm.`);
  // S453/B1a — an EXIT (`return` / `break` / `continue`) inside a `match` arm in
  // the block. B1a makes these exits roll back and proceed, and the rollback is
  // carried by the block's `finally` — which an exit inside the arm IIFE never
  // reaches. So the shape would compile, roll back nothing, and let the
  // statements after the `match` run inside a transaction the author believes
  // they left. Same defect as the `fail` / `?` arm limb; kept refused.
  const exitInMatchArm = (n: Node, what: string) =>
    report("E-TRANSACTION-CONTROL-FLOW", n,
      `${what} inside a \`match\` arm cannot leave a \`transaction\` block — the arm is lowered as a ` +
      `nested function, so the ${what} would return from the arm only: the block's rollback would never ` +
      `run and the statements after the \`match\` would keep executing inside the open transaction ` +
      `(g-stmt-match-block-return-falls-through). Outside a \`match\` arm, ${what} out of a \`transaction\` ` +
      `block is valid and ROLLS the block BACK (§19.10.3). Use an expression-position \`match\` ` +
      `(\`let v = match … { … }\`) to pick a value and ${what} after the \`match\`, or an \`if\` / \`else if\` chain.`);

  function walk(node: unknown, st: WalkState): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) walk(c, st); return; }
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const n = node as Node;
    const prevAnchor = anchor;
    if (inText === 0 && hasLine(n) && isStatementNode(n)) anchor = n;
    try {
      walkNode(n, n.kind, st);
    } finally {
      anchor = prevAnchor;
    }
  }

  function walkChildren(n: Node, st: WalkState): void {
    for (const key of Object.keys(n)) {
      if (key === "span" || key === "parent" || key === "_scrmlTxnRollback") continue;
      walk(n[key], st);
    }
  }

  function walkNode(n: Node, kind: string | undefined, st: WalkState): void {
    // `^{}` meta and `_{}` foreign bodies are opaque host code.
    if (typeof kind === "string" && (isMetaKind(kind) || kind === "foreign" || kind === "Foreign")) return;

    // --- function boundaries: a fresh scope ---
    if (kind === "function-decl") {
      walkChildren(n, {
        fn: { name: typeof n.name === "string" ? n.name : "<anonymous>", canFail: n.canFail === true },
        txn: null,
      });
      return;
    }
    if (kind === "lambda") {
      walkChildren(n, { fn: null, txn: null, inLambda: true });
      return;
    }

    if (kind === "transaction-block") {
      if (st.txn) {
        report("E-ERROR-007", n,
          "Nested 'transaction' blocks are not supported. Use savepoints via '?{SAVEPOINT name}' " +
          "for nested transaction semantics. (§19.10.4)");
      }
      // §19.10.4 — "`transaction { }` SHALL be valid only inside `!` functions."
      // S453/B1b (RULED): that covers the TOP LEVEL (outside any function) as
      // well as a non-`!` function, so all three of them are one condition on
      // one code. Outside a `!` function a `fail` inside the block has nowhere to
      // go, which is the same reason §19.10.4's S451 bullet refuses manual
      // transaction control there (E-ERROR-015).
      if (!st.fn || !st.fn.canFail) {
        const name = st.fn ? st.fn.name : null;
        const where = name !== null
          ? `function '${name}', which is not declared as failable`
          : (st.inLambda === true
            ? "a lambda, which cannot be declared failable"
            : "a top-level logic block, outside any function");
        const howToFix = name !== null
          ? `Add '!' to the function signature: 'function ${name}(...)! -> {ErrorType}'.`
          : `Move the 'transaction' block into a '!' function and call it: ` +
            `'function apply()! -> {DbError} { transaction { … } }'.`;
        report("E-ERROR-001", n,
          `'transaction' used in ${where}. ` +
          `A 'transaction' block is valid only inside a '!' function (§19.10.4): its commit-or-rollback ` +
          `promise needs a failure path. ${howToFix}`);
      }
      if (st.fn && !st.txn && st.inStmtMatchArmOuter) {
        // S450 re-review nit — the converse shape: the transaction block itself sits
        // in a statement-position `match` arm (a nested function / IIFE in impl#1),
        // so a `fail` / `?` in the block rolls back but returns from the ARM only;
        // the fail is swallowed and the code after the `match` runs.
        report("E-TRANSACTION-CONTROL-FLOW", n,
          "a `transaction` block inside a statement-position `match` arm cannot report its `fail` / `?` yet — " +
          "the arm is lowered as a nested function, so the block's `fail` / `?` would roll the transaction back " +
          "but return from the arm only: the failure would be swallowed and the statements after the `match` " +
          "would keep running (g-stmt-match-block-return-falls-through). Move the `transaction` block outside " +
          "the `match`, or select with an expression-position `match` (`let v = match … { … }`) or an " +
          "`if` / `else if` chain.");
      }
      const inner: WalkState = {
        fn: st.fn,
        inLambda: st.inLambda,
        txn: {
          loopDepth: 0, switchDepth: 0, labels: new Set(),
          inFunction: st.fn !== null, inStmtMatchArm: false, inMatchArm: false,
        },
      };
      walk(n.body, inner);
      return;
    }

    const t0 = st.txn;
    // Entering a STATEMENT-position `match` inside the block: everything under
    // its arms (structured or text-carried) is walked with inStmtMatchArm set.
    if (t0 && kind === "match-stmt" && t0.inFunction && !t0.inStmtMatchArm) {
      st = { ...st, txn: { ...t0, inStmtMatchArm: true, inMatchArm: true } };
    }
    // S453/B1a — an EXPRESSION-position `match` is lowered by the SAME
    // `emitMatchExpr` IIFE, so an EXIT inside one of its arms is swallowed too.
    // `inStmtMatchArm` is deliberately NOT set here: a `fail` / `?` in an
    // expression-position arm is governed and was runtime-verified at S450.
    else if (t0 && kind === "match-expr" && t0.inFunction && !t0.inMatchArm) {
      st = { ...st, txn: { ...t0, inMatchArm: true } };
    }
    // Entering a statement-position `match` in a function OUTSIDE any transaction:
    // a `transaction` block under its arms is the converse shape (rejected above).
    // Text-carried (unbraced) arms are parsed so a `transaction` there is seen too.
    if (!t0 && st.fn && kind === "match-stmt") {
      st = { ...st, inStmtMatchArmOuter: true };
      for (const tb of textBodiesOf(n)) {
        if (tb.text === null || !/\btransaction\b/.test(tb.text)) continue;
        const parsed = parseStatementText(tb.text, filePath);
        if (!parsed.ok) {
          report("E-TRANSACTION-CONTROL-FLOW", n,
            `${tb.label} mentions \`transaction\` but did not parse as scrml statements, so it cannot be ` +
            `verified (§19.10.4). Move the \`transaction\` block outside the \`match\`.`);
          continue;
        }
        inText++;
        try { walk(parsed.stmts, st); } finally { inText--; }
      }
    }
    const t = st.txn;
    if (t) {
      // Text-carried arm / handler bodies: parse and walk in this context.
      for (const tb of textBodiesOf(n)) {
        // Sound pre-filter: every statement this checker acts on begins with one
        // of these words (or is a `?`), so text without any of them cannot contain
        // one. A hit is still decided by PARSING below, never by the match.
        if (tb.text !== null && !/\b(return|break|continue|yield|transaction|fail)\b|\?/.test(tb.text)) continue;
        const parsed = tb.text === null ? { ok: false as const } : parseStatementText(tb.text, filePath);
        if (!parsed.ok) {
          if (t.inFunction) {
            report("E-TRANSACTION-CONTROL-FLOW", n,
              `the control flow of ${tb.label} inside this \`transaction\` block could not be verified — ` +
              `its body did not parse as scrml statements, and a \`transaction\` block must be proven ` +
              `not to \`return\` / \`break\` / \`continue\` / \`yield\` out of it (§19.10.4). ` +
              `Simplify the arm body, or move the logic into a named function and call it.`);
          }
          continue;
        }
        inText++;
        try { walk(parsed.stmts, st); } finally { inText--; }
      }

      if (t.inFunction) {
        // S453/B1a (RULED) — `return` / `break` / `continue` out of the block ROLL
        // IT BACK and the exit proceeds; only normal completion COMMITs
        // (§19.10.3). No diagnostic, and no marking pass: the block's own
        // `try`/`finally` (emit-logic.ts `case "transaction-block"`) is the
        // rollback-before-exit machinery for them, and it is the CORRECT one —
        // the `finally` runs after the return EXPRESSION is evaluated, so a
        // `?{}` read in `return count` still runs inside the transaction. The
        // `fail` / `?` pre-return marking stays as it is, because an error
        // envelope has nothing to evaluate inside the block.
        // The ONE shape still refused is an exit inside a `match` arm, which the
        // `finally` cannot reach (see TxnCtx.inMatchArm).
        if (kind === "return-stmt") { if (t.inMatchArm) exitInMatchArm(n, "`return`"); }
        else if (kind === "yield-stmt") controlFlow(n, "`yield`");
        else if (kind === "break-stmt" || kind === "continue-stmt") {
          const label = typeof n.label === "string" && n.label.length > 0 ? n.label : null;
          const isBreak = kind === "break-stmt";
          const targetInside = label
            ? t.labels.has(label)
            : (isBreak ? t.loopDepth + t.switchDepth > 0 : t.loopDepth > 0);
          if (!targetInside && t.inMatchArm) {
            exitInMatchArm(n, isBreak ? "a `break` whose target is outside it" : "a `continue` whose target is outside it");
          }
        }
        if (t.inStmtMatchArm) {
          if (kind === "fail-expr" || (kind === "escape-hatch" && n.nativeKind === "Fail")) failInStmtMatchArm(n, "`fail`");
          else if (kind === "propagate-expr" || (kind === "escape-hatch" && n.nativeKind === "Propagate")) failInStmtMatchArm(n, "`?` propagation");
        }
      }

      if (typeof kind === "string" && (LOOP_KINDS.has(kind) || kind === "switch-stmt")) {
        const labels = new Set(t.labels);
        if (typeof n.label === "string" && n.label.length > 0) labels.add(n.label);
        walkChildren(n, {
          fn: st.fn,
          txn: {
            loopDepth: t.loopDepth + (LOOP_KINDS.has(kind) ? 1 : 0),
            switchDepth: t.switchDepth + (kind === "switch-stmt" ? 1 : 0),
            labels,
            inFunction: t.inFunction,
            inStmtMatchArm: t.inStmtMatchArm,
            inMatchArm: t.inMatchArm,
          },
        });
        return;
      }
    }

    walkChildren(n, st);
  }

  walk((ast as { nodes?: unknown }).nodes ?? ast, { fn: null, txn: null });
  return diagnostics;
}
