// check.test.js — checkCore (check.scrml) is M2's gate on `lower`: every hole
// the M1 review found (F4 FieldAt, F5 instance, F7 Static transitions) has a
// negative test here, plus the positives that must stay accepted.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadBootstrap } from "./harness.js";

let mods, C;
beforeAll(() => { ({ mods } = loadBootstrap()); C = mods.core; }, { timeout: 60000 });

const check = (core) => mods.check.checkCore(core);

// Replace the body of the program's first function with `stmts`.
function withStmts(core, stmts) {
  return { ...core, fns: [{ ...core.fns[0], body: C.block(stmts) }, ...core.fns.slice(1)] };
}

// The counter program plus a struct-typed field `pt: Point` where
//   Point = { x: let int, y: int (fixed), z: Openness with a non-replace contract }
// `ptGrants` is the resolved grant set of the program field `pt`.
function pointCore(ptGrants) {
  const core = mods["counter.core"].counterCore();
  const sPoint = C.mkSym(100, "Point");
  const sX = C.mkSym(101, "x"), sY = C.mkSym(102, "y"), sZ = C.mkSym(103, "z");
  const sPt = C.mkSym(104, "pt"), wPt = C.mkSym(105, "pt");
  const point = C.TypeDef.StructDef(sPoint, [
    { sym: sX, ty: C.Type.Int, grants: C.replaceGrant() },
    { sym: sY, ty: C.Type.Int, grants: C.noGrants() },
    { sym: sZ, ty: C.Type.Int, grants: { replace: false, edits: [C.EditKind.Transition] } },
  ]);
  const fPt = {
    sym: sPt, ty: C.Type.Named(sPoint),
    init: C.Expr.StructOf(sPoint, [C.litInt(0), C.litInt(0), C.litInt(0)]),
    mode: C.FieldMode.Locked, role: C.FieldRole.Child, grants: ptGrants,
    graph: null, exported: false, wcap: wPt,
  };
  const prog = core.decls[0];
  return {
    core: { ...core, types: [point], decls: [{ ...prog, fields: [...prog.fields, fPt] }] },
    sPoint, sX, sY, sZ, wPt, shared: C.InstRef.Shared(core.program),
  };
}

const fieldAt = (...steps) => C.EditKind.FieldAt(steps);

describe("oracles are well-formed", () => {
  test("counter / dropdown / dropdown-fixture / valuesem: no diagnostics", () => {
    expect(check(mods["counter.core"].counterCore())).toEqual([]);
    expect(check(mods["dropdown.core"].dropdownCore())).toEqual([]);
    expect(check(mods["dropdown.core"].dropdownReorderCore())).toEqual([]);
    expect(check(mods["valuesem.core"].valuesemCore())).toEqual([]);
  });
});

describe("F4 — FieldAt is granted only along a well-typed, granted struct path", () => {
  test("REVIEW CASE: FieldAt([]) on the append-only `audit` is refused (empty path)", () => {
    const core = mods["valuesem.core"].valuesemCore();
    const wAudit = core.decls[0].fields[0].wcap;
    const bad = withStmts(core, [C.Stmt.Write(wAudit, C.InstRef.Shared(core.program), fieldAt(),
      C.Expr.ArrayOf([C.litStr("forged")]), C.Check.Static)]);
    const d = check(bad);
    expect(d.length).toBe(1);
    expect(d[0]).toContain("C3: <program>.audit: an empty FieldAt path");
  });

  test("a non-empty FieldAt into the append-only sequence `audit` is refused (not a struct)", () => {
    const core = mods["valuesem.core"].valuesemCore();
    const wAudit = core.decls[0].fields[0].wcap;
    const bad = withStmts(core, [C.Stmt.Write(wAudit, C.InstRef.Shared(core.program),
      fieldAt(C.fref(core.program, 0)), C.litStr("x"), C.Check.Static)]);
    expect(check(bad)).toEqual(["C3: <program>.audit: FieldAt step 0 steps into a value that is not a struct"]);
  });

  test("REVIEW CASE: FieldAt on the graph field `open` is refused — the rule= graph cannot be bypassed", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const closeCountry = core.fns[0];
    const w = closeCountry.body.stmts[0];                // Write(wOpen, Alias(country), Transition, .Closed)
    const wOpen = w.data.cap, inst = w.data.inst;
    const sDropdown = core.decls[0].sym;
    for (const path of [[], [C.fref(sDropdown, 3)]]) {
      const bad = withStmts(core, [C.Stmt.Write(wOpen, inst, C.EditKind.FieldAt(path),
        C.litVariant(core.types[0].data.sym, 1), C.Check.Static)]);
      const d = check(bad);
      expect(d.length).toBe(1);
      expect(d[0]).toStartWith("C3: <dropdown>.open: ");
    }
  });

  test("the path's owner must be the struct type at that step", () => {
    const { core, sPoint, wPt, shared } = pointCore({ replace: false, edits: [fieldAt()] });
    const wrongOwner = C.mkSym(1, "count");
    const bad = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(wrongOwner, 0)), C.litInt(1), C.Check.Static)]);
    expect(check(bad)).toEqual(["C3: <program>.pt: FieldAt step 0 names owner `count` but the value there is a `Point`"]);
    const oob = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(sPoint, 7)), C.litInt(1), C.Check.Static)]);
    expect(check(oob)).toEqual(["C3: <program>.pt: FieldAt step 0: `Point` has no field 7"]);
  });

  test("a sub-field with its own `let` is writable; a fixed sub-field is not (no outer replace)", () => {
    const { core, sPoint, wPt, shared } = pointCore({ replace: false, edits: [fieldAt()] });
    const okX = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(sPoint, 0)), C.litInt(1), C.Check.Static)]);
    expect(check(okX)).toEqual([]);
    const badY = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(sPoint, 1)), C.litInt(1), C.Check.Static)]);
    expect(check(badY)).toEqual(["C3: <program>.pt: the target struct field grants no write, and the field does not grant `replace`"]);
  });

  test("an outer `replace` subsumes plain sub-fields but may NOT bypass a sub-field's own contract", () => {
    const { core, sPoint, wPt, shared } = pointCore(C.replaceGrant());
    const okY = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(sPoint, 1)), C.litInt(1), C.Check.Static)]);
    expect(check(okY)).toEqual([]);
    const badZ = withStmts(core, [C.Stmt.Write(wPt, shared, fieldAt(C.fref(sPoint, 2)), C.litInt(1), C.Check.Static)]);
    expect(check(badZ)).toEqual(["C3: <program>.pt: the path reaches a field with its own non-replace contract; an outer `replace` may not bypass it"]);
  });
});

describe("F5 — a Write's instance must be an instance of the capability's declaration (C4); reads too (C5)", () => {
  test("REVIEW CASE: dropdown's `value` capability through Shared(program) is refused", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const wValue = core.decls[0].fields[2].wcap;
    const bad = withStmts(core, [C.Stmt.Write(wValue, C.InstRef.Shared(core.program), C.EditKind.Replace, C.litStr(""), C.Check.Static)]);
    expect(check(bad)).toEqual(["C4: the write to <dropdown>.value goes through Shared(program), an instance of <program>"]);
  });

  test("Lexical(k) with no enclosing declaration does not resolve", () => {
    const core = mods["counter.core"].counterCore();
    const wCount = core.decls[0].fields[0].wcap;
    const bad = withStmts(core, [C.Stmt.Write(wCount, C.InstRef.Lexical(0), C.EditKind.Replace, C.litInt(0), C.Check.Static)]);
    expect(check(bad)).toEqual(["C4: the write to <program>.count goes through an instance reference that does not resolve (Lexical(0))"]);
  });

  test("Alias(h) names the declaration of the use that binds h", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const wShowColor = core.decls[1].fields[1].wcap;
    const hCountry = core.decls[1].handles[0];
    const bad = withStmts(core, [C.Stmt.Write(wShowColor, C.InstRef.Alias(hCountry), C.EditKind.Replace, C.litBool(true), C.Check.Static)]);
    expect(check(bad)).toEqual(["C4: the write to <program>.showColor goes through Alias(country), an instance of <dropdown>"]);
  });

  test("Narrowed(c) must name a local bound to an instance handle", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const wValue = core.decls[0].fields[2].wcap;
    const stray = C.mkSym(200, "c2");
    const bad = withStmts(core, [C.Stmt.Write(wValue, C.InstRef.Narrowed(stray), C.EditKind.Replace, C.litStr(""), C.Check.Static)]);
    expect(check(bad)).toEqual(["C4: the write to <dropdown>.value goes through an instance reference that does not resolve (Narrowed(c2))"]);
  });

  test("a READ of dropdown's field through the program instance is refused (C5)", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const sDropdown = core.decls[0].sym;
    const bad = withStmts(core, [C.Stmt.Eval(C.readField(sDropdown, C.InstRef.Shared(core.program), 2))]);
    expect(check(bad)).toEqual(["C5: a read of <dropdown> goes through Shared(program), an instance of <program>"]);
  });
});

describe("F7 — `Check.Static` on a transition only when Core proves the edge (C6)", () => {
  function dd() {
    const core = mods["dropdown.core"].dropdownCore();
    const w = core.fns[0].body.stmts[0];
    return { core, wOpen: w.data.cap, inst: w.data.inst, sOpenness: core.types[0].data.sym };
  }

  test("Static to a literal variant reachable from every state is accepted (.Closed: edge or self-write)", () => {
    const { core, wOpen, inst, sOpenness } = dd();
    const ok = withStmts(core, [C.Stmt.Write(wOpen, inst, C.EditKind.Transition, C.litVariant(sOpenness, 0), C.Check.Static)]);
    expect(check(ok)).toEqual([]);
  });

  test("Static to a non-literal value (the toggle's conditional, in its own renders) is refused", () => {
    const core = mods["dropdown.core"].dropdownCore();
    const dropdown = core.decls[0];
    const div = dropdown.renders[0];
    const button = div.data.kids[0];
    const onClick = button.data.attrs[1];
    const toggle = onClick.data.body.stmts[0];          // Write(wOpen, Lexical(0), Transition, Match…, RuntimeEdge)
    expect(toggle.data.check).toBe("RuntimeEdge");
    // Re-point the SAME write at Static, in place (so its Lexical(0) still resolves).
    const staticToggle = C.Stmt.Write(toggle.data.cap, toggle.data.inst, toggle.data.edit, toggle.data.value, C.Check.Static);
    const attrs = [button.data.attrs[0], C.Attr.On("click", C.block([staticToggle]))];
    const kids = [C.View.El("button", attrs, button.data.kids), ...div.data.kids.slice(1)];
    const renders = [C.View.El(div.data.tag, div.data.attrs, kids)];
    const bad = { ...core, decls: [{ ...dropdown, renders }, core.decls[1]] };
    expect(check(bad)).toEqual(["C6: <dropdown>.open: a Static transition to a non-literal value is not provable in Core; use RuntimeEdge"]);
  });

  test("a transition value that is not a variant of the graph's enum is refused, whatever the check", () => {
    const { core, wOpen, inst } = dd();
    for (const chk of [C.Check.Static, C.Check.RuntimeEdge]) {
      const bad = withStmts(core, [C.Stmt.Write(wOpen, inst, C.EditKind.Transition, C.litStr("Opened"), chk)]);
      expect(check(bad)).toEqual(["C6: <dropdown>.open: the transition value is not a variant of `Openness`"]);
    }
    const otherEnum = withStmts(core, [C.Stmt.Write(wOpen, inst, C.EditKind.Transition, C.litVariant(C.mkSym(3, "Line"), 0), C.Check.Static)]);
    expect(check(otherEnum)).toEqual(["C6: <dropdown>.open: the transition value is not a variant of `Openness`"]);
  });

  test("Static to a variant NOT reachable from every state is refused (needs RuntimeEdge)", () => {
    const { core, wOpen, inst, sOpenness } = dd();
    // Make `.Opened` terminal: Closed → Opened only.
    const dropdown = core.decls[0];
    const open = dropdown.fields[3];
    const graph = { enumSym: open.graph.enumSym, edges: [{ origin: 0, targets: [1] }, { origin: 1, targets: [] }] };
    const fields = dropdown.fields.slice(0, 3).concat([{ ...open, graph }]);
    const core2 = { ...core, decls: [{ ...dropdown, fields }, core.decls[1]] };
    const bad = withStmts(core2, [C.Stmt.Write(wOpen, inst, C.EditKind.Transition, C.litVariant(sOpenness, 0), C.Check.Static)]);
    expect(check(bad)).toEqual(["C6: <dropdown>.open: a Static transition to a variant not reachable from every state; the edge needs a RuntimeEdge check"]);
    const ok = withStmts(core2, [C.Stmt.Write(wOpen, inst, C.EditKind.Transition, C.litVariant(sOpenness, 0), C.Check.RuntimeEdge)]);
    expect(check(ok)).toEqual([]);
  });

  test("RuntimeEdge on a write that is not a transition is refused", () => {
    const core = mods["counter.core"].counterCore();
    const wCount = core.decls[0].fields[0].wcap;
    const bad = withStmts(core, [C.Stmt.Write(wCount, C.InstRef.Shared(core.program), C.EditKind.Replace, C.litInt(0), C.Check.RuntimeEdge)]);
    expect(check(bad)).toEqual(["C6: <program>.count: a RuntimeEdge check on a write that is not a transition"]);
  });
});
