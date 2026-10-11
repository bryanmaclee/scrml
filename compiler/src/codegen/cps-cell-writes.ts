/**
 * S462 P0 — the cell writes of a CPS server batch, and how the batch returns them.
 *
 * A CPS-split function (§19.9.9) runs its server-tier statements in one or more
 * server batches. Reactive cells live in the browser (§6.6.9), so a cell the
 * batch writes has to travel back to the client — and ONLY its final value may
 * travel, never the intermediate data the batch consumed to compute it (the S462
 * finding: the login idiom `@out = ?{SELECT name, pw …}.get(); if (!verify(pass,
 * @out.pw)) { @out = "REJECTED" } …` shipped the row, password hash included, so
 * the CLIENT could run the check).
 *
 * Two return shapes, decided per batch by `planBatchCellReturn`:
 *
 *   "legacy" — the batch writes at most ONE cell, by ONE top-level statement
 *              (`@x = <server work>`) that is the batch's LAST statement, and
 *              nothing later in the batch reads it. The batch returns that value
 *              bare, exactly as before S462 (byte-identical output).
 *
 *   "cells"  — anything else. Every cell write in the batch lowers to
 *              `(_scrml_written["x"] = true, _scrml_body["x"] = v)`: a later read
 *              in the same batch (`_scrml_body["x"]`) sees the value the batch
 *              wrote, not the one the client sent (§19.9.9.7 R7 — before S462 it
 *              read the CLIENT's value, so the client chose the hash the server
 *              verified against). The batch returns
 *              `{ __scrml_cells: { <each cell it wrote>: <final value> } }` and the
 *              client applies those values in place.
 *
 * Write forms a server batch cannot carry are listed by `unsupportedBatchWrites`
 * and refused at compile time (E-RI-002, route-inference.ts) — never relocated.
 */

import { handledSqlGuardInner } from "./sql-attempt.ts";

type Node = Record<string, any>;

/** A cell write site found in a batch statement. */
export interface CellWriteSite {
  /** The cell's bare name (no `@`). */
  cell: string;
  /** The node that writes it. */
  node: Node;
  /** True for the TOP-LEVEL `state-decl` statement at `stmtIndex`. */
  topLevelDecl: boolean;
  stmtIndex: number;
}

/** A write a server batch cannot carry back to the client. */
export interface UnsupportedBatchWrite {
  cell: string | null;
  /** What it is, phrased for the diagnostic. */
  what: string;
  /** How to write it so the batch can carry it. */
  fix: string;
  span: unknown;
}

const REACTIVE_MUTATION_KINDS: Record<string, { what: string; fix: string }> = {
  "reactive-nested-assign": {
    what: "assigns to a field of the cell",
    fix: "assign the whole value instead (`@cell = { ...@cell, field: value }`)",
  },
  "reactive-array-mutation": {
    what: "mutates the cell's array in place",
    fix: "assign the whole value instead (`@cell = [...@cell, item]`)",
  },
  "reactive-explicit-set": {
    what: "sets the cell through an explicit setter",
    fix: "assign the cell (`@cell = value`)",
  },
};

function isCellIdent(n: unknown): n is { kind: "ident"; name: string } {
  return !!n && typeof n === "object" && (n as Node).kind === "ident" &&
    typeof (n as Node).name === "string" && (n as Node).name.length > 1 && (n as Node).name.charCodeAt(0) === 0x40 &&
    // `@session` / `@currentUser` are ambient identity, not cells (§6.6.9); their
    // server-side use is refused on its own (E-SESSION-AMBIENT-SERVER).
    (n as Node).name !== "@session" && (n as Node).name !== "@currentUser";
}

/** `@x op= …` / `@x++` / `++@x` inside an expression tree → the cell, else null. */
function exprWriteCell(e: Node): string | null {
  if (e.kind === "assign" && isCellIdent(e.target)) return e.target.name.slice(1);
  if (e.kind === "unary" && (e.op === "++" || e.op === "--") && isCellIdent(e.argument)) return e.argument.name.slice(1);
  return null;
}

/** `@x.f = …` / `@x[k] = …` / `@x.f++` — a write into a cell's value, in an expression. */
function exprMemberWriteCell(e: Node): string | null {
  const target = e.kind === "assign" ? e.target : (e.kind === "unary" && (e.op === "++" || e.op === "--") ? e.argument : null);
  let t = target;
  while (t && typeof t === "object" && (t.kind === "member" || t.kind === "index")) t = t.object;
  return t && t !== target && isCellIdent(t) ? t.name.slice(1) : null;
}

const RAW_WRITE_RE = /@([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|\?\?|&&|\|\|)?=(?!=)|(?:\+\+|--)\s*@([A-Za-z_$][A-Za-z0-9_$]*)|@([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\+\+|--)/;

/**
 * Walk ONE batch statement for cell writes. Supported sites are collected into
 * `sites`; forms the batch cannot carry go to `unsupported`.
 */
function walkStatement(
  stmt: Node,
  stmtIndex: number,
  sites: CellWriteSite[],
  unsupported: UnsupportedBatchWrite[],
  returns: UnsupportedBatchWrite[],
  stmtIsBatchReturnDecl: boolean,
): void {
  const seen = new WeakSet<object>();
  const visit = (n: unknown, inClosure: boolean, top: boolean): void => {
    if (!n || typeof n !== "object" || seen.has(n as object)) return;
    seen.add(n as object);
    if (Array.isArray(n)) { for (const c of n) visit(c, inClosure, false); return; }
    const node = n as Node;
    const kind = node.kind;

    if (kind === "function-decl") {
      // A nested function's body runs whenever it is called — not as part of the
      // batch's straight-line run, so a cell write in it cannot be carried. Walk
      // it as a closure: any write found there is refused.
      visit(node.body, true, false);
      return;
    }

    if (kind === "state-decl" && typeof node.name === "string") {
      if (inClosure) {
        unsupported.push({ cell: node.name, what: "writes the cell inside a closure", fix: "compute the value first, then assign the cell in the function body", span: node.span });
      } else if (node.shape === "derived" || Array.isArray(node.children)) {
        unsupported.push({ cell: node.name, what: "declares a derived or compound cell", fix: "declare the cell outside the function", span: node.span });
      } else {
        sites.push({ cell: node.name, node, topLevelDecl: top && stmtIsBatchReturnDecl, stmtIndex });
      }
      // fall through: the initializer may itself contain writes
    }

    if (typeof kind === "string" && REACTIVE_MUTATION_KINDS[kind]) {
      const m = REACTIVE_MUTATION_KINDS[kind];
      unsupported.push({ cell: typeof node.target === "string" ? node.target : null, what: m.what, fix: m.fix, span: node.span });
      return;
    }

    if (kind === "return-stmt" && !inClosure) {
      returns.push({ cell: null, what: "returns from the function inside server-side work that also writes a cell", fix: "assign a cell instead of returning, or move the return after the server work", span: node.span });
    }

    if (kind === "lambda") {
      for (const key of Object.keys(node)) { if (key !== "span") visit(node[key], true, false); }
      return;
    }
    if (kind === "escape-hatch" && typeof node.raw === "string" && RAW_WRITE_RE.test(node.raw)) {
      unsupported.push({ cell: null, what: "writes a cell inside code the compiler cannot lower on the server", fix: "assign the cell as its own statement", span: node.span });
    }

    // Expression-level writes.
    const cell = exprWriteCell(node);
    if (cell !== null) {
      if (inClosure) {
        unsupported.push({ cell, what: "writes the cell inside a closure", fix: "compute the value first, then assign the cell in the function body", span: node.span });
      } else {
        sites.push({ cell, node, topLevelDecl: false, stmtIndex });
      }
    } else {
      const memberCell = exprMemberWriteCell(node);
      if (memberCell !== null) {
        unsupported.push({ cell: memberCell, what: "writes into the cell's value in place", fix: "assign the whole value instead (`@cell = { ...@cell, field: value }`)", span: node.span });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      visit(node[key], inClosure, false);
    }
  };
  visit(stmt, false, true);
}

/** The statement a `!{}`-guarded `?{}` wraps (S455), or the statement itself. */
function unguard(stmt: Node): Node {
  return (handledSqlGuardInner(stmt) as Node | null) ?? stmt;
}

/** The per-batch return plan. */
export interface BatchCellPlan {
  mode: "legacy" | "cells";
  /** "cells" mode: every cell the batch may write, in first-write source order. */
  cells: string[];
  /** Write forms the batch cannot carry (refused by route inference). */
  unsupported: UnsupportedBatchWrite[];
}

/**
 * Decide how one server batch returns its cell writes.
 *
 * @param body          the function body
 * @param serverIndices the batch's statement indices (source order)
 * @param legacyReturnCell the cell the pre-S462 emission returns for this batch
 *                      (`returnVarName` / the batch's last `state-decl`), or null
 */
export function planBatchCellReturn(
  body: unknown[],
  serverIndices: number[],
  legacyReturnCell: string | null,
): BatchCellPlan {
  const sites: CellWriteSite[] = [];
  const unsupported: UnsupportedBatchWrite[] = [];
  const returns: UnsupportedBatchWrite[] = [];
  const indices = [...serverIndices].sort((a, b) => a - b);
  for (const idx of indices) {
    const raw = body[idx] as Node | undefined;
    if (!raw || typeof raw !== "object") continue;
    const stmt = unguard(raw);
    const isReturnDecl = stmt.kind === "state-decl" && legacyReturnCell !== null && stmt.name === legacyReturnCell;
    // A guarded statement's arms are pure values (S455 guardArmsAreValues) —
    // walk the guarded statement; its arms cannot write.
    walkStatement(stmt, idx, sites, unsupported, returns, isReturnDecl);
  }

  const cells: string[] = [];
  for (const s of sites) if (!cells.includes(s.cell)) cells.push(s.cell);

  // Legacy holds only for the exact pre-S462 shape: zero writes, or one write —
  // the top-level return decl as the LAST statement of the batch. Being last,
  // no later statement of the batch can read it, so the §19.9.9.7 batch-local
  // read question does not arise. (The decl's own initializer reading the cell —
  // `@n = @n + ?{…}` — reads the client's value by design.)
  const legacy = sites.length === 0 ||
    (sites.length === 1 && sites[0].topLevelDecl && sites[0].stmtIndex === indices[indices.length - 1]);
  // A `return` inside the batch would leave the batch before it hands back its
  // cells; the legacy shape never had cells to hand back, so it keeps its
  // pre-S462 behaviour.
  if (!legacy) unsupported.push(...returns);
  return { mode: legacy ? "legacy" : "cells", cells: legacy ? [] : cells, unsupported };
}

/**
 * The cell a batch of a MULTI-batch split returns bare (the legacy shape): its last
 * statement's cell when that statement is a top-level `state-decl`, else none.
 * emit-server.ts and emit-functions.ts both use this, so the two sides agree.
 *
 * S462 — the LAST batch used to return the split's `returnVarName`, which is the
 * function's FIRST reactive-server cell and so usually lives in an EARLIER batch.
 * The last batch then returned nothing and the client set that cell to `undefined`
 * after it, clobbering the value the earlier batch had delivered (measured on the
 * §19.9.9.5 `checkout` shape: `@reservationShown` ended `undefined`).
 */
export function multiBatchReturnCell(body: unknown[], sortedIndices: number[]): string | null {
  const last = sortedIndices.length > 0 ? unguard(body[sortedIndices[sortedIndices.length - 1]] as Node) : null;
  return last && last.kind === "state-decl" && typeof last.name === "string" ? last.name : null;
}

/**
 * Every batch of a split with the cell its legacy emission returns: a
 * single-batch split returns `returnVarName`; each batch of a multi-batch split
 * returns `multiBatchReturnCell`. A split with no planned batches is one batch
 * over `serverStmtIndices`.
 */
export function splitBatchesWithReturnCells(
  body: unknown[],
  split: { serverStmtIndices: number[]; returnVarName: string | null; serverBatches?: Array<{ indices?: number[] }> },
): Array<{ indices: number[]; returnCell: string | null }> {
  const batches = split.serverBatches;
  if (!Array.isArray(batches) || batches.length <= 1) {
    return [{ indices: [...split.serverStmtIndices], returnCell: split.returnVarName ?? null }];
  }
  return batches.map((b) => {
    const indices = Array.isArray(b.indices) ? [...b.indices].sort((x, y) => x - y) : [];
    return { indices, returnCell: multiBatchReturnCell(body, indices) };
  });
}

/** The server-module name of the batch's written-cell register. */
export const CPS_WRITTEN_VAR = "_scrml_written";

/**
 * The server-module local that holds cell `name` inside a "cells"-mode batch.
 * One plain local per cell — never a shared object: the batch's values are its
 * own, and a local is only ever REBOUND (a write into an object the request also
 * reaches would make the batch's values part of the request, which the §14.8.9
 * flow analysis rightly treats as an egress path).
 */
export function cpsCellLocal(name: string): string {
  return `_scrml_cell_${name}`;
}

/**
 * Server lines that open a "cells"-mode batch: a local per cell the batch writes,
 * seeded from the value the client sent (§6.6.9) so a read before the batch's
 * first write sees the client's value, and the register of which cells it actually
 * wrote (only those go back to the client).
 */
export function cpsCellsPrologue(indent: string, cells: string[]): string[] {
  return [
    `${indent}// §19.9.9.7 (S462) — the cells this batch writes, held by the batch itself. Only`,
    `${indent}// the final values of the ones it writes go back to the client; the data it read`,
    `${indent}// to compute them stays here.`,
    ...cells.map((c) => `${indent}let ${cpsCellLocal(c)} = _scrml_body[${JSON.stringify(c)}];`),
    `${indent}const ${CPS_WRITTEN_VAR} = {};`,
  ];
}

/**
 * Server lines that end a "cells"-mode batch: return the written cells' final
 * values, built as ONE object literal (no writes into a shared object): each value
 * leaves exactly as the cell holds it, so the §14.8.9 egress floor sees a row as
 * the row it is.
 */
export function cpsCellsEpilogue(indent: string, cells: string[]): string[] {
  return [
    `${indent}return {`,
    `${indent}  __scrml_cells: {`,
    ...cells.map((c) => {
      const k = JSON.stringify(c);
      return `${indent}    ...(${CPS_WRITTEN_VAR}[${k}] ? { ${k}: ${cpsCellLocal(c)} } : {}),`;
    }),
    `${indent}  },`,
    `${indent}};`,
  ];
}

/** The server statement that writes cell `name` with the (already-lowered) value expression. */
export function cpsCellWriteStatement(name: string, valueExpr: string): string {
  const k = JSON.stringify(name);
  // One line, so an enclosing block's indentation applies to the whole write.
  return `${CPS_WRITTEN_VAR}[${k}] = true; _scrml_body[${k}] = ${valueExpr};`;
}

/**
 * Client lines that apply a "cells"-mode batch result: each cell the batch may
 * write, set when the batch did write it.
 */
export function cpsCellsApplyLines(resultVar: string, cells: string[], indent: string): string[] {
  const out = [`${indent}// §19.9.9.7 (S462) — the server batch's cell writes, at their final values.`];
  for (const c of cells) {
    const k = JSON.stringify(c);
    out.push(`${indent}if (${k} in ${resultVar}.__scrml_cells) _scrml_reactive_set(${k}, ${resultVar}.__scrml_cells[${k}]);`);
  }
  return out;
}

/**
 * S465 (§19.9.9.8 rule 4) — the locals a CPS split carries from the statements
 * before its first server statement into the batch request (route-inference
 * `carriedLocals`). They follow the function's parameters in every stub's
 * argument list and are bound from `_scrml_body` in the batch handler.
 */
export function cpsCarriedLocals(cpsSplit: unknown): string[] {
  const c = (cpsSplit as { carriedLocals?: unknown } | null | undefined)?.carriedLocals;
  return Array.isArray(c) ? c.filter((n): n is string => typeof n === "string" && n.length > 0) : [];
}
