/**
 * Unit tests for the block-analysis `type` member projection
 * (block-analysis.ts) — the ADDITIVE `typeShape` + `members[]` (struct fields /
 * enum variants) + `bodySpan` outputs, co-requested by giti (§4.3 AST semantic
 * merge) + flogence (same-file region-leasing).
 *
 * R26 / S138 discipline: every fixture drives the REAL `splitBlocks -> buildAST`
 * path so the member parse runs against the SAME raw source + spans the live
 * pipeline sees (a synthetic AST would not exercise the verbatim-source parse).
 *
 * The DRIFT GUARD (last describe) is the fork-B correctness anchor: the member
 * NAMES + KINDS this sidecar emits MUST equal the compiler's canonical
 * `parseStructBody` / `parseEnumBody` output — so the local span-aware parser
 * can never silently disagree with the grammar of record.
 */
import { test, expect, describe } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { buildBlockAnalysisForFile, buildBlockAnalysis, buildBlockAnalysisJson } from "../../src/block-analysis.ts";
import { parseStructBody, parseEnumBody } from "../../src/type-system.ts";

/** Compile scrml source to a real FileAST via the production BS+TAB path. */
function compileAST(src, path = "/abs/examples/demo/page.scrml") {
  return buildAST(splitBlocks(path, src)).ast;
}

/** All raw `type-decl` nodes in an AST, keyed by name (for the drift guard). */
function typeDeclsByName(ast) {
  const map = new Map();
  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "type-decl" && n.name) map.set(n.name, n);
      if (Array.isArray(n.children)) walk(n.children);
      if (Array.isArray(n.body)) walk(n.body);
    }
  }
  walk(ast.nodes);
  for (const t of ast.typeDecls || []) if (t && t.name) map.set(t.name, t);
  return map;
}

function typeBlock(src, name, path = "/abs/examples/demo/page.scrml") {
  const ba = buildBlockAnalysisForFile(compileAST(src, path), src);
  return ba.blocks.find((b) => b.kind === "type" && b.name === name);
}

// ---------------------------------------------------------------------------
// Struct fields
// ---------------------------------------------------------------------------

const STRUCT_SRC = `\${
  type Task:struct = {
    id:     number
    title:  string   // the human label
    column: string req
    order:  number
  }
}
<page><h1>x</h1></page>`;

describe("type members — struct fields", () => {
  test("typeShape is struct and every field is projected in source order", () => {
    const t = typeBlock(STRUCT_SRC, "Task");
    expect(t).toBeDefined();
    expect(t.typeShape).toBe("struct");
    expect(t.members.map((m) => m.name)).toEqual(["id", "title", "column", "order"]);
    for (const m of t.members) expect(m.memberKind).toBe("field");
  });

  test("field typeText is the verbatim type surface (validator preserved)", () => {
    const t = typeBlock(STRUCT_SRC, "Task");
    const byName = new Map(t.members.map((m) => [m.name, m]));
    expect(byName.get("id").typeText).toBe("number");
    expect(byName.get("title").typeText).toBe("string"); // trailing comment EXCLUDED
    expect(byName.get("column").typeText).toBe("string req"); // validator preserved verbatim
    expect(byName.get("order").typeText).toBe("number");
  });

  test("member span is ABSOLUTE and source.slice returns the exact field (name -> type)", () => {
    const t = typeBlock(STRUCT_SRC, "Task");
    const slice = (m) => STRUCT_SRC.slice(m.span.start, m.span.end);
    const byName = new Map(t.members.map((m) => [m.name, m]));
    expect(slice(byName.get("id"))).toBe("id:     number");
    // Trailing `// the human label` comment is NOT welded into the member span.
    expect(slice(byName.get("title"))).toBe("title:  string");
    expect(slice(byName.get("column"))).toBe("column: string req");
    expect(slice(byName.get("order"))).toBe("order:  number");
  });

  test("no args key on a struct field member", () => {
    const t = typeBlock(STRUCT_SRC, "Task");
    for (const m of t.members) expect("args" in m).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enum variants — the flogence canonical payload-union case
// ---------------------------------------------------------------------------

const POINTER_SRC = `\${
  type Pointer:enum = { Sha(hash:string), FileLine(path:string, lineNo:int), None }
}
<page><h1>x</h1></page>`;

describe("type members — enum variants (Pointer payload-union)", () => {
  test("typeShape is enum and variants are projected in source order", () => {
    const t = typeBlock(POINTER_SRC, "Pointer");
    expect(t.typeShape).toBe("enum");
    expect(t.members.map((m) => m.name)).toEqual(["Sha", "FileLine", "None"]);
    for (const m of t.members) expect(m.memberKind).toBe("variant");
  });

  test("a payload variant carries its verbatim signature + per-arg spans that slice back", () => {
    const t = typeBlock(POINTER_SRC, "Pointer");
    const byName = new Map(t.members.map((m) => [m.name, m]));

    const sha = byName.get("Sha");
    expect(sha.typeText).toBe("(hash:string)");
    expect(POINTER_SRC.slice(sha.span.start, sha.span.end)).toBe("Sha(hash:string)");
    expect(sha.args.map((a) => a.name)).toEqual(["hash"]);
    expect(sha.args[0].typeText).toBe("string");
    expect(POINTER_SRC.slice(sha.args[0].span.start, sha.args[0].span.end)).toBe("hash:string");

    const fl = byName.get("FileLine");
    expect(fl.typeText).toBe("(path:string, lineNo:int)");
    expect(POINTER_SRC.slice(fl.span.start, fl.span.end)).toBe("FileLine(path:string, lineNo:int)");
    expect(fl.args.map((a) => a.name)).toEqual(["path", "lineNo"]);
    expect(fl.args.map((a) => a.typeText)).toEqual(["string", "int"]);
    expect(POINTER_SRC.slice(fl.args[1].span.start, fl.args[1].span.end)).toBe("lineNo:int");
  });

  test("a unit variant has empty typeText + empty args + a name-only span", () => {
    const t = typeBlock(POINTER_SRC, "Pointer");
    const none = t.members.find((m) => m.name === "None");
    expect(none.typeText).toBe("");
    expect(none.args).toEqual([]);
    expect(POINTER_SRC.slice(none.span.start, none.span.end)).toBe("None");
  });
});

describe("type members — positional variant args get _<i> keys (parseEnumBody parity)", () => {
  const SRC = `\${
  type Res:enum = { Ok(int), Err(string), Pending }
}
<page><h1>x</h1></page>`;
  test("bare positional payload -> synthetic _0 arg key", () => {
    const t = typeBlock(SRC, "Res");
    const ok = t.members.find((m) => m.name === "Ok");
    expect(ok.args.map((a) => a.name)).toEqual(["_0"]);
    expect(ok.args[0].typeText).toBe("int");
    expect(t.members.find((m) => m.name === "Pending").args).toEqual([]);
  });
});

describe("type members — unit-only enum (all bare variants)", () => {
  const SRC = `\${
  type MarioState:enum = { Small, Big, Fire, Cape }
}
<page><h1>x</h1></page>`;
  test("every variant is a unit variant with empty args", () => {
    const t = typeBlock(SRC, "MarioState");
    expect(t.members.map((m) => m.name)).toEqual(["Small", "Big", "Fire", "Cape"]);
    for (const m of t.members) {
      expect(m.memberKind).toBe("variant");
      expect(m.typeText).toBe("");
      expect(m.args).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Refinement / alias — the catch-all shape carries NO members
// ---------------------------------------------------------------------------

describe("type members — refinement / alias", () => {
  test("a predicated refinement is typeShape refinement with empty members", () => {
    const t = typeBlock(`\${
  type PositiveInt = int(>0)
}
<page><h1>x</h1></page>`, "PositiveInt");
    expect(t.typeShape).toBe("refinement");
    expect(t.members).toEqual([]);
  });

  test("a plain union alias is typeShape refinement with empty members", () => {
    const t = typeBlock(`\${
  type Id = number | string
}
<page><h1>x</h1></page>`, "Id");
    expect(t.typeShape).toBe("refinement");
    expect(t.members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bodySpan — tight body-close, no trailing-trivia weld
// ---------------------------------------------------------------------------

describe("bodySpan — bounded at the body-close", () => {
  // The type decl is FOLLOWED by another statement so span.end overshoots into
  // the next token (the g-decl-span-overshoot systemic remainder). bodySpan must
  // stop at the body `}` — never weld the following token.
  const SRC = `\${
  type Phase:enum = { Idle, Busy }
  @count = 0
}
<page><h1>x</h1></page>`;

  test("type bodySpan ends at the closing brace (no weld into the following token)", () => {
    const t = typeBlock(SRC, "Phase");
    const bodyText = SRC.slice(t.bodySpan.start, t.bodySpan.end);
    expect(bodyText).toBe("type Phase:enum = { Idle, Busy }");
    expect(bodyText.endsWith("}")).toBe(true);
    // The raw span overshoots past the `}` — bodySpan is strictly tighter here.
    expect(t.bodySpan.end).toBeLessThan(t.span.end);
    expect(t.bodySpan.start).toBe(t.span.start);
  });

  test("bodySpan is present on EVERY block kind and never claims more than span", () => {
    const src = `\${
  type T:enum = { A, B }
  function f(x) { @c = x }
}
<page>
  <channel name="chat"/>
  const Badge = <span>hi</span>
  <h1>Demo</h1>
</page>`;
    const ba = buildBlockAnalysisForFile(compileAST(src), src);
    expect(ba.blocks.length).toBeGreaterThan(0);
    for (const b of ba.blocks) {
      expect(typeof b.bodySpan.start).toBe("number");
      expect(typeof b.bodySpan.end).toBe("number");
      expect(b.bodySpan.start).toBe(b.span.start);
      expect(b.bodySpan.end).toBeLessThanOrEqual(b.span.end);
      expect(b.bodySpan.end).toBeGreaterThan(b.bodySpan.start);
    }
  });
});

// ---------------------------------------------------------------------------
// Additive back-compat — fn / component / engine / channel unchanged
// ---------------------------------------------------------------------------

describe("additive back-compat — non-type blocks", () => {
  const SRC = `\${
  function bump(amount) { @counter = @counter + amount }
}
<page>
  <channel name="chat"/>
  const Badge = <span class="badge">hi</span>
  <h1>Demo</h1>
</page>`;

  test("fn / component / channel blocks carry NO typeShape and NO members", () => {
    const ba = buildBlockAnalysisForFile(compileAST(SRC), SRC);
    for (const b of ba.blocks) {
      if (b.kind === "type") continue;
      expect("typeShape" in b).toBe(false);
      expect("members" in b).toBe(false);
    }
  });

  test("a non-type block's keys are the existing 7 + bodySpan (existing fields byte-unchanged)", () => {
    const ba = buildBlockAnalysisForFile(compileAST(SRC), SRC);
    const fn = ba.blocks.find((b) => b.kind === "function");
    expect(Object.keys(fn)).toEqual([
      "id",
      "kind",
      "name",
      "span",
      "bodySpan",
      "reads",
      "writes",
      "footprintDepth",
    ]);
    // The existing field values are untouched.
    expect(fn.name).toBe("bump");
    expect(fn.reads).toEqual(["counter"]);
    expect(fn.writes).toEqual(["counter"]);
    expect(fn.footprintDepth).toBe("shallow");
  });
});

// ---------------------------------------------------------------------------
// Determinism — the byte-identical contract, now including the new fields
// ---------------------------------------------------------------------------

describe("determinism — two builds byte-identical (with members + bodySpan)", () => {
  const SRC = `\${
  type Pointer:enum = { Sha(hash:string), FileLine(path:string, lineNo:int), None }
  type Task:struct = { id: number, title: string }
  function f(x) { @c = x }
}
<page><channel name="chat"/><h1>x</h1></page>`;
  test("buildBlockAnalysisJson is byte-identical across two builds", () => {
    const j1 = buildBlockAnalysisJson(compileAST(SRC), SRC);
    const j2 = buildBlockAnalysisJson(compileAST(SRC), SRC);
    expect(j1).toBe(j2);
    // Sanity: the new fields actually appear in the serialized artifact.
    expect(j1).toContain('"typeShape"');
    expect(j1).toContain('"members"');
    expect(j1).toContain('"bodySpan"');
    expect(j1).toContain('"memberKind"');
  });
});

// ---------------------------------------------------------------------------
// Brace-less bar-form enum (§14.4 `type X:enum = .A | .B`) — the inline-expr
// path whose tight span the AST builder discards (recovered from source).
// ---------------------------------------------------------------------------

describe("type members — brace-less bar-form enum (§14.4)", () => {
  // Followed by a statement so span.end overshoots into the next token.
  const SRC = `\${
  type Bar:enum = .Pending | .Success | .Failed
  @count = 0
}
<page><h1>x</h1></page>`;

  test("bar-form unit variants are projected in source order with name-only spans", () => {
    const t = typeBlock(SRC, "Bar");
    expect(t.typeShape).toBe("enum");
    expect(t.members.map((m) => m.name)).toEqual(["Pending", "Success", "Failed"]);
    for (const m of t.members) {
      expect(m.memberKind).toBe("variant");
      expect(m.typeText).toBe("");
      expect(m.args).toEqual([]);
    }
    // The name-only span EXCLUDES the bar-form leading `.`.
    expect(SRC.slice(t.members[0].span.start, t.members[0].span.end)).toBe("Pending");
    expect(SRC.slice(t.members[2].span.start, t.members[2].span.end)).toBe("Failed");
  });

  test("bar-form bodySpan bounds the variant list (no weld into the following statement)", () => {
    const t = typeBlock(SRC, "Bar");
    expect(SRC.slice(t.bodySpan.start, t.bodySpan.end)).toBe(
      "type Bar:enum = .Pending | .Success | .Failed",
    );
    expect(t.bodySpan.end).toBeLessThan(t.span.end);
    expect(t.bodySpan.start).toBe(t.span.start);
  });

  test("bar-form PAYLOAD variant resolves its args", () => {
    const src = `\${
  type Res2:enum = .Ok(int) | .Err(msg:string) | .Pending
}
<page><h1>x</h1></page>`;
    const t = typeBlock(src, "Res2");
    expect(t.members.map((m) => m.name)).toEqual(["Ok", "Err", "Pending"]);
    const ok = t.members.find((m) => m.name === "Ok");
    expect(ok.typeText).toBe("(int)");
    expect(ok.args.map((a) => a.name)).toEqual(["_0"]);
    const err = t.members.find((m) => m.name === "Err");
    expect(err.args.map((a) => a.name)).toEqual(["msg"]);
    expect(err.args[0].typeText).toBe("string");
    expect(src.slice(err.span.start, err.span.end)).toBe("Err(msg:string)");
  });
});

// ---------------------------------------------------------------------------
// PA adversarial /code-review fixes (S239) — adjacent-shape edges the
// drift-guard + self-review could not reach.
// ---------------------------------------------------------------------------

describe("nested-colon variant arg is positional with the FULL type (depth-aware)", () => {
  // A `:` nested inside the arg's TYPE (`fn(e:Event)`) is NOT a name separator —
  // the arg is positional `_0` and its typeText is the whole `fn(e:Event)`. A
  // non-depth-aware indexOf would emit name:"fn(e", typeText:"Event)".
  const SRC = `\${
  type Ev:enum = { Click(fn(e:Event)), Move(x:int, y:int), Reset }
}
<page><h1>x</h1></page>`;

  test("a positional arg whose type contains a nested colon keeps the full typeText", () => {
    const t = typeBlock(SRC, "Ev");
    const click = t.members.find((m) => m.name === "Click");
    expect(click.args.map((a) => a.name)).toEqual(["_0"]);
    expect(click.args[0].typeText).toBe("fn(e:Event)");
    expect(SRC.slice(click.args[0].span.start, click.args[0].span.end)).toBe("fn(e:Event)");
    // A genuinely NAMED arg (top-level colon) is still named.
    const move = t.members.find((m) => m.name === "Move");
    expect(move.args.map((a) => a.name)).toEqual(["x", "y"]);
    expect(move.args.map((a) => a.typeText)).toEqual(["int", "int"]);
  });

  test("a nested-brace positional arg (`{ x:int, y:int }`) is one positional arg", () => {
    const src = `\${
  type Shape:enum = { Point({ x:int, y:int }), Empty }
}
<page><h1>x</h1></page>`;
    const t = typeBlock(src, "Shape");
    const pt = t.members.find((m) => m.name === "Point");
    expect(pt.args.map((a) => a.name)).toEqual(["_0"]);
    expect(pt.args[0].typeText).toBe("{ x:int, y:int }");
  });
});

describe("field-bearing error type (§19.3) emits struct-shaped members", () => {
  const SRC = `\${
  type AppErr:error = {
    code: number
    detail: string
  }
}
<page><h1>x</h1></page>`;

  test("typeShape is error and its fields are projected as struct-shaped members", () => {
    const t = typeBlock(SRC, "AppErr");
    expect(t.typeShape).toBe("error");
    expect(t.members.map((m) => m.name)).toEqual(["code", "detail"]);
    for (const m of t.members) expect(m.memberKind).toBe("field");
    const byName = new Map(t.members.map((m) => [m.name, m]));
    expect(byName.get("code").typeText).toBe("number");
    expect(SRC.slice(byName.get("detail").span.start, byName.get("detail").span.end)).toBe("detail: string");
  });
});

describe("tuple type resolves to no fields (tAsIs) — honest-empty members", () => {
  test("a tuple type is refinement + empty members (no splice-able fields)", () => {
    const t = typeBlock(`\${
  type Pair:tuple = { a, b }
}
<page><h1>x</h1></page>`, "Pair");
    // The type-system sends `tuple` to tAsIs (no fields), so members are empty.
    expect(t.typeShape).toBe("refinement");
    expect(t.members).toEqual([]);
  });
});

describe("refinement / body-less type bodySpan does NOT weld the following decl", () => {
  const SRC = `\${
  type A = string | number
  type B:enum = { X, Y }
}
<page><h1>x</h1></page>`;

  test("a refinement's bodySpan is bounded at its own RHS end", () => {
    const t = typeBlock(SRC, "A");
    expect(t.typeShape).toBe("refinement");
    const body = SRC.slice(t.bodySpan.start, t.bodySpan.end);
    expect(body).toBe("type A = string | number");
    // The next decl's tokens must NOT be inside the bodySpan.
    expect(body).not.toContain("type B");
    // The raw span overshoots past the RHS; bodySpan is strictly tighter.
    expect(t.bodySpan.end).toBeLessThan(t.span.end);
  });
});

describe("live provenance — members slice off the threaded _sourceText (no explicit source)", () => {
  // Locks the path the CLI write-loop actually uses: buildBlockAnalysis over the
  // wrapped { filePath, ast, _sourceText } object, source recovered via
  // sourceFromFile(_sourceText) — NOT an explicit `source` arg by construction.
  test("a member span slices back off _sourceText verbatim on the live wrapped-object path", () => {
    const SRC = `\${
  type Pointer:enum = { Sha(hash:string), None }
  type Task:struct = { id: number, title: string }
}
<page><h1>x</h1></page>`;
    const ast = compileAST(SRC, "/abs/examples/live/page.scrml");
    // The live pipeline hands a WRAPPED object with the RAW source on _sourceText.
    const wrapped = { filePath: "/abs/examples/live/page.scrml", ast, _sourceText: SRC };
    const [analysis] = buildBlockAnalysis([wrapped]);
    const pointer = analysis.blocks.find((b) => b.name === "Pointer");
    const sha = pointer.members.find((m) => m.name === "Sha");
    // Slice against the SAME _sourceText the sidecar recovered — must be verbatim.
    expect(SRC.slice(sha.span.start, sha.span.end)).toBe("Sha(hash:string)");
    expect(SRC.slice(sha.args[0].span.start, sha.args[0].span.end)).toBe("hash:string");
    const task = analysis.blocks.find((b) => b.name === "Task");
    const idField = task.members.find((m) => m.name === "id");
    expect(SRC.slice(idField.span.start, idField.span.end)).toBe("id: number");
    // bodySpan too (tight body-close off the threaded source).
    expect(SRC.slice(task.bodySpan.start, task.bodySpan.end).endsWith("}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DRIFT GUARD — member names/kinds MUST equal the canonical parser output
// ---------------------------------------------------------------------------

describe("drift guard — members equal canonical parseStructBody / parseEnumBody", () => {
  // A corpus spanning the declared shapes: struct (aligned + comment +
  // validator), payload-union enum, mixed unit/payload enum, unit-only enum,
  // positional payload, brace+newline struct, bar-form enum.
  //
  // NOTE: the corpus DELIBERATELY excludes a nested-colon variant arg
  // (`Click(fn(e:Event))`) — canonical parseEnumBody uses a non-depth-aware
  // indexOf(":") there and mis-keys it, so a key-comparison would spuriously
  // require this sidecar to reproduce that bug. The depth-aware behaviour is
  // asserted directly above ("nested-colon variant arg is positional").
  const CORPUS = `\${
  type Task:struct = {
    id:     number
    title:  string   // human label
    column: string req
  }
  type Pointer:enum = { Sha(hash:string), FileLine(path:string, lineNo:int), None }
  type DragMsg:enum = { Start(id: number), Drop(col: string), End }
  type MarioState:enum = { Small, Big, Fire, Cape }
  type Res:enum = { Ok(int), Err(string), Pending }
  type Bar:enum = .Pending | .Success | .Failed
  type Config:struct = {
    timeout: number
    retries: number
  }
}
<page><h1>x</h1></page>`;

  test("struct field names match parseStructBody keys; variant names + arg keys match parseEnumBody", () => {
    const ast = compileAST(CORPUS);
    const ba = buildBlockAnalysisForFile(ast, CORPUS);
    const rawByName = typeDeclsByName(ast);

    let checked = 0;
    for (const b of ba.blocks) {
      if (b.kind !== "type") continue;
      const node = rawByName.get(b.name);
      expect(node).toBeDefined();
      checked++;

      if (b.typeShape === "struct") {
        const canonNames = [...parseStructBody(node.raw, new Map()).keys()];
        expect(b.members.map((m) => m.name)).toEqual(canonNames);
        for (const m of b.members) expect(m.memberKind).toBe("field");
      } else if (b.typeShape === "enum") {
        const canonVariants = parseEnumBody(node.raw, new Map()).variants;
        expect(b.members.map((m) => m.name)).toEqual(canonVariants.map((v) => v.name));
        for (const v of canonVariants) {
          const m = b.members.find((x) => x.name === v.name);
          expect(m.memberKind).toBe("variant");
          const canonArgKeys = v.payload ? [...v.payload.keys()] : [];
          expect(m.args.map((a) => a.name)).toEqual(canonArgKeys);
        }
      }
    }
    // The corpus declares 7 named types (struct x2, enum x5 incl. the
    // brace-less bar-form Bar) — all must have been cross-checked.
    expect(checked).toBe(7);
  });
});
