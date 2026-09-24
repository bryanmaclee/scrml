/**
 * Block-scope redeclaration checker — SPEC §7.3.3 (S430 round 5, F2).
 *
 * Inside a function body, a `let` / `const` / `lin` / `function` declaration
 * SHALL NOT redeclare a name already bound in the SAME block: another
 * `let` / `const` / `lin` / `function` declaration of that block, or — for the
 * function's own top-level block — one of the function's PARAMETERS.
 * `E-SCOPE-REDECLARE`.
 *
 * Before this check such a program reached codegen and failed there as an
 * unexplained E-CODEGEN-INVALID-LOGIC ("Identifier 'x' has already been
 * declared"). Worse, the SAME program compiled and ran once a `defer` was added
 * to the block — the defer lowering wraps the block in a `try`, which turns
 * the illegal redeclaration of a parameter into legal shadowing. A `defer`
 * must not change what compiles; the rule is stated and enforced here,
 * independent of `defer`.
 *
 * Shadowing in a NESTED block (an `if` / loop / arm body re-declaring an outer
 * name) is legal and untouched. Two `function` declarations of one name in one
 * block are left to the existing checks (JS itself accepts them at a function's
 * top level). File-level duplicates are E-SCOPE-010 (§7.6), not this code.
 *
 * Structural: declared names come from the declaration nodes (every name a
 * destructuring pattern binds, via the type system's `iterDestructuredNames`),
 * parameters from the function node.
 *
 * @module lint-redeclare
 */
import type { FileAST, Span } from "../types/ast.ts";
import { iterDestructuredNames } from "../type-system.ts";

export interface RedeclareDiagnostic {
  code: "E-SCOPE-REDECLARE";
  message: string;
  span: Span;
  severity: "error";
}

type Node = Record<string, unknown> & { kind?: string; span?: Span };

const LEXICAL_KINDS = new Set(["let-decl", "const-decl", "lin-decl"]);

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
    if (typeof p === "string") out.push(p.split(":")[0].split("=")[0].trim());
    else if (p && typeof p === "object") {
      const nm = (p as Node).name;
      if (typeof nm === "string") out.push(nm.split(":")[0].trim());
      else out.push(...declNames(nm));
    }
  }
  return out.filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
}

const kwOf = (k: string | undefined): string =>
  k === "const-decl" ? "const" : k === "lin-decl" ? "lin" : k === "function-decl" ? "function" : "let";

function lineOf(n: Node): string {
  const sp = n.span as { line?: number } | undefined;
  return sp && typeof sp.line === "number" ? `line ${sp.line}` : "an earlier line";
}

export function runRedeclareChecks(ast: FileAST | null | undefined): RedeclareDiagnostic[] {
  const out: RedeclareDiagnostic[] = [];
  if (!ast) return out;
  const filePath = (ast as { filePath?: string }).filePath ?? "";
  const seen = new WeakSet<object>();

  const report = (n: Node, message: string) => {
    out.push({
      code: "E-SCOPE-REDECLARE",
      severity: "error",
      span: (n.span as Span | undefined) ?? ({ file: filePath, start: 0, end: 0, line: 1, col: 1 } as Span),
      message: `E-SCOPE-REDECLARE: ${message}`,
    });
  };

  /** Check one statement list (a block). `params` only for a function's top-level block. */
  const checkBlock = (list: unknown[], params: string[] | null, fnName: string | null): void => {
    const bound = new Map<string, { node: Node | null; what: string }>();
    for (const p of params ?? []) bound.set(p, { node: null, what: "parameter" });
    for (const s of list) {
      const sn = s as Node;
      if (!sn || typeof sn !== "object" || typeof sn.kind !== "string") continue;
      // A keywordless `x = ?{…}` is carried as a const-decl tagged `_bareAssign`;
      // it is an ASSIGNMENT when `x` is already bound, not a declaration.
      if (sn._bareAssign === true) continue;
      const isLexical = LEXICAL_KINDS.has(sn.kind);
      const isFn = sn.kind === "function-decl" && typeof sn.name === "string" && sn.fromExport !== true;
      if (!isLexical && !isFn) continue;
      const names = isLexical ? declNames(sn.name) : [sn.name as string];
      // Native bridge: statements flattened out of a bare `{ }` block carry a
      // `bareBlockScope` id (translate-stmt.js) — that block was a scope of its
      // own, so its declarations are keyed separately (legal shadowing, S430
      // round 6, A).
      const scopeKey = sn.bareBlockScope === undefined ? "" : `#${String(sn.bareBlockScope)}`;
      for (const rawName of names) {
        const nm = rawName + scopeKey;
        const prev = bound.get(nm);
        if (prev) {
          // function vs function in one block: left to the existing checks.
          const prevIsFn = prev.node !== null && prev.node.kind === "function-decl";
          if (!(isFn && prevIsFn)) {
            const where = prev.node === null
              ? `a parameter of ${fnName ? "`" + fnName + "`" : "this function"}`
              : `a \`${kwOf(prev.node.kind as string)} ${rawName}\` in the same block (${lineOf(prev.node)})`;
            report(sn,
              `\`${kwOf(sn.kind)} ${rawName}\` (${lineOf(sn)}) redeclares \`${rawName}\`, which is already ${where}. ` +
              `A block binds each name once (§7.3.3). Rename one of them, or assign to the existing ` +
              `binding instead of declaring it again.`);
          }
          continue;
        }
        bound.set(nm, { node: sn, what: kwOf(sn.kind) });
      }
    }
  };

  const walk = (n: unknown, inFunction: boolean): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) {
      if (inFunction && n.some((c) => c && typeof c === "object" && typeof (c as Node).kind === "string")) {
        checkBlock(n, null, null);
      }
      for (const c of n) walk(c, inFunction);
      return;
    }
    const nn = n as Node;
    if (nn.kind === "function-decl" && Array.isArray(nn.body)) {
      const body = nn.body as unknown[];
      seen.add(body);
      checkBlock(body, paramNames(nn.params), typeof nn.name === "string" ? nn.name : null);
      for (const c of body) walk(c, true);
      return;
    }
    for (const key of Object.keys(nn)) {
      if (key === "span") continue;
      walk(nn[key], inFunction);
    }
  };

  walk((ast as { nodes?: unknown }).nodes ?? ast, false);
  return out;
}
