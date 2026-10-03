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
 *   - `E-ERROR-001` (§19.10.4) — a `transaction` block inside a function that is
 *     not declared `!`. ("Using `transaction` in a non-`!` function SHALL be a
 *     compile error (E-ERROR-001 applies)".)
 *   - `E-ERROR-007` (§19.10.4) — a `transaction` block inside another one.
 *   - `E-TRANSACTION-CONTROL-FLOW` (§19.10.4, S450 interim) — a `return`, a
 *     `yield`, or a `break` / `continue` whose target is outside the block, inside
 *     a `transaction` block in a function. §19.10.3 defines the block's exits as
 *     normal completion (COMMIT), `fail` (ROLLBACK) and a SQL error (ROLLBACK);
 *     whether any OTHER exit commits or rolls back is not decided (searched
 *     §19.10, §8.9 — no governing sentence), so the compiler fails closed rather
 *     than pick one. `fail` and `?` (§19.5.2: `?` is a `fail`) are the governed
 *     exits and are allowed — EXCEPT (S450 fix round) inside an arm of a
 *     STATEMENT-position `match` within the block: that arm is lowered as a
 *     nested function, so the exit rolls back but returns from the arm only and
 *     the statements after the `match` run with no transaction open
 *     (g-stmt-match-block-return-falls-through). Same code, fail-closed; an
 *     expression-position `match` arm is unaffected.
 *
 * Top-level (`${}` outside any function) transaction blocks keep their prior
 * behaviour: only the nesting check (E-ERROR-007) applies there. §19.10.4 says
 * "valid only inside `!` functions"; the top-level question is routed, not
 * decided here.
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
}

interface WalkState {
  /** The nearest enclosing function declaration, or null at top level / in a lambda. */
  fn: { name: string; canFail: boolean } | null;
  /** Non-null while inside a transaction block (reset at a function boundary). */
  txn: TxnCtx | null;
}

const LOOP_KINDS = new Set(["for-stmt", "while-stmt", "do-while-stmt"]);

const CONTROL_FLOW_WHY =
  "§19.10.3 defines how a `transaction` block ends — it COMMITs on normal completion and " +
  "ROLLs BACK on `fail` or a SQL error — and does not say whether any other exit commits or " +
  "rolls back, so the compiler does not guess (§19.10.4: no transaction is left open). " +
  "Let the block complete and act on the result after it, or use `fail` to leave it with a rollback.";

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
      walkChildren(n, { fn: null, txn: null });
      return;
    }

    if (kind === "transaction-block") {
      if (st.txn) {
        report("E-ERROR-007", n,
          "Nested 'transaction' blocks are not supported. Use savepoints via '?{SAVEPOINT name}' " +
          "for nested transaction semantics. (§19.10.4)");
      }
      if (st.fn && !st.fn.canFail) {
        const name = st.fn.name;
        report("E-ERROR-001", n,
          `'transaction' used in function '${name}' which is not declared as failable. ` +
          `A 'transaction' block is valid only inside a '!' function (§19.10.4). ` +
          `Add '!' to the function signature: 'function ${name}(...)! -> {ErrorType}'.`);
      }
      const inner: WalkState = {
        fn: st.fn,
        txn: { loopDepth: 0, switchDepth: 0, labels: new Set(), inFunction: st.fn !== null, inStmtMatchArm: false },
      };
      walk(n.body, inner);
      return;
    }

    const t0 = st.txn;
    // Entering a STATEMENT-position `match` inside the block: everything under
    // its arms (structured or text-carried) is walked with inStmtMatchArm set.
    if (t0 && kind === "match-stmt" && t0.inFunction && !t0.inStmtMatchArm) {
      st = { fn: st.fn, txn: { ...t0, inStmtMatchArm: true } };
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
        if (kind === "return-stmt") controlFlow(n, "`return`");
        else if (kind === "yield-stmt") controlFlow(n, "`yield`");
        else if (kind === "break-stmt" || kind === "continue-stmt") {
          const label = typeof n.label === "string" && n.label.length > 0 ? n.label : null;
          const isBreak = kind === "break-stmt";
          const targetInside = label
            ? t.labels.has(label)
            : (isBreak ? t.loopDepth + t.switchDepth > 0 : t.loopDepth > 0);
          if (!targetInside) controlFlow(n, isBreak ? "a `break` whose target is outside it" : "a `continue` whose target is outside it");
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
