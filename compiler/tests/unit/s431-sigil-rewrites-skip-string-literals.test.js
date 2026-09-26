/**
 * S431 — g-scrml-sigil-rewrites-reach-inside-every-string-literal (HIGH).
 *
 * scrml's TEXT-level rewrite passes rewrote scrml sigils INSIDE JS string literals:
 *
 *   const msg = "write ?{select 1} or Color::Red here"  →  "write __scrml_sql_placeholder__ or Color.Red here"
 *   const tag = "see <#w> for details"                  →  "see _scrml_input_w_ for details"
 *
 * Three STAGES of text passes were involved, each string-blind:
 *   - TAB  `preprocessWorkerAndStateRefs` (ast-builder.js) — `<#id>` → `_scrml_input_id_`;
 *   - PARSE `parseExpression` / `parseStatements` / `preprocessForAcorn` (expression-parser.ts)
 *     — `?{}`, `<#id>`, `::`, `match`, `render`, `~`, map literals, …;
 *   - CODEGEN `runPasses` (rewrite.ts) — the whole rewriteExpr / rewriteServerExpr pipeline.
 *
 * The fix is ONE mechanism (code-segments.ts `maskLiteralContents`) applied at each stage's
 * entry, not a guard per pass: literal/comment CONTENT is masked (length-preserving) before
 * any pass runs and restored afterwards. Template `${…}` interpolations and `?{…}` SQL blocks
 * stay CODE.
 *
 * §1 the masking primitive · §2 the pass × literal-kind matrix (fuzz) · §3 legit sigils
 * outside strings still lower · §4 full-compile positions · §5 the self-host message shape ·
 * §6 read-only detectors (route inference, E-FN heuristics) scan code only.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  maskLiteralContents,
  findLiteralContentRanges,
  blankLiteralContents,
  withLiteralsMasked,
} from "../../src/codegen/code-segments.ts";
import { rewriteExpr, rewriteServerExpr, rewriteExprArrowBody } from "../../src/codegen/rewrite.ts";
import { parseExprToNode, parseExpression, parseStatements } from "../../src/expression-parser.ts";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { compileScrml } from "../../src/api.js";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s431-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    const html = (out.html ?? "")
      .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    return {
      clientJs: out.clientJs ?? "",
      serverJs: out.serverJs ?? "",
      html,
      errors: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — the masking primitive
// ---------------------------------------------------------------------------

describe("§1 maskLiteralContents", () => {
  test("masks string, template-static and comment content; length-preserving", () => {
    const src = 'f("a <#w>", \'b ?{x}\', `c ${ g("d") + @n } e`) // f <#z>\n/* g ?{} */ h';
    const m = maskLiteralContents(src);
    try {
      expect(m.active).toBe(true);
      expect(m.masked.length).toBe(src.length);
      for (const s of ["<#w>", "?{x}", "<#z>", "?{}", '"d"'.slice(1, 2)]) {
        if (s === "d") continue;
        expect(m.masked.includes(s)).toBe(false);
      }
      // interpolation is CODE: g(, @n stay visible; the nested "d" is masked
      expect(m.masked).toContain("${ g(\"");
      expect(m.masked).toContain("+ @n }");
      expect(m.restore(m.masked)).toBe(src);
    } finally {
      m.release();
    }
  });

  test("newlines inside a masked template / block comment are kept in place", () => {
    const src = "a /* x\n?{} */ b `p\nq ?{}`";
    const m = maskLiteralContents(src);
    try {
      expect(m.masked.split("\n").length).toBe(src.split("\n").length);
      expect(m.restore(m.masked)).toBe(src);
    } finally {
      m.release();
    }
  });

  test("?{…} SQL blocks and regex literals are left verbatim (not masked)", () => {
    const src = 'x = ?{`select "a" from t where n = ${@id}`}.get(); y = /"<#w>"/.test(s); z = "<#w>"';
    const m = maskLiteralContents(src);
    try {
      expect(m.masked.startsWith('x = ?{`select "a" from t where n = ${@id}`}.get();')).toBe(true);
      expect(m.masked).toContain('/"<#w>"/.test(s)');
      expect(m.masked.endsWith('z = "<#w>"')).toBe(false);
    } finally {
      m.release();
    }
  });

  test("an unclosed quote on its line (prose apostrophe) is not a string", () => {
    expect(findLiteralContentRanges("lift <p>don't <#w></p>")).toEqual([]);
  });

  test("escaped quotes stay inside the literal", () => {
    const src = 'f("a \\" <#w>", @x)';
    expect(withLiteralsMasked(src, (t) => t.replace(/<#w>/g, "X").replace(/@x/g, "Y"))).toBe('f("a \\" <#w>", Y)');
  });

  test("nested sessions restore independently", () => {
    const outer = maskLiteralContents('a("<#w>")');
    try {
      const inner = maskLiteralContents(outer.masked + ' + b("?{}")');
      try {
        const back = outer.restore(inner.restore(inner.masked));
        expect(back).toBe('a("<#w>") + b("?{}")');
      } finally {
        inner.release();
      }
    } finally {
      outer.release();
    }
  });

  test("blankLiteralContents is a code-only detection view", () => {
    expect(/\?\{/.test(blankLiteralContents('return "a ?{} b"'))).toBe(false);
    expect(/\?\{/.test(blankLiteralContents("return ?{`select 1`}"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — the pass × literal-kind matrix (fuzz)
// ---------------------------------------------------------------------------

const PAYLOADS = {
  sql: "?{select 1}",
  sqlEmpty: "?{}",
  inputRef: "<#w>",
  workerSend: "<#w>.send(1)",
  requestRef: "<#r>.loading",
  inputBare: "_scrml_input_w_",
  enumColon: "Color::Red",
  enumColonBare: "::Red",
  enumDot: "Color.Red",
  bareVariant: "(.Active)",
  match: "match x { .A => 1 }",
  isNot: "x is not y",
  isSome: "x is some",
  isVariant: "x is .A",
  cell: "@count",
  fnKw: "use fn here",
  render: "render foo(1)",
  tilde: "a ~ b",
  not: "not x",
  orAnd: "a or b and c",
  eq: "x == y != z",
  nav: "navigate(p)",
  reset: "reset(@x)",
  replay: "replay(@a, @b)",
  transition: "transition(x)",
  struct: "Point { x: 1 }",
  toEnum: "Color.toEnum(x)",
  presence: "(x) => { y }",
  whenMsg: "when message from <#w>",
  plusPlus: "x + +y",
  mapLit: "[k: v]",
  comment: "a // b",
};
const KINDS = ["dq", "sq", "tpl"];
const lit = (k, s) => (k === "dq" ? `"${s}"` : k === "sq" ? `'${s}'` : "`" + s + "`");

function exprFor(kind, payload) {
  // Template kind also carries an interpolation with a nested literal. (The live sigil is
  // the outer `@live` arg: a `@cell` INSIDE a template interpolation is not lowered on the
  // parse → emitExpr path at all — a pre-existing defect, separate from this gap.)
  return kind === "tpl"
    ? "f(`" + payload + ' ${ g("' + payload + '") + 1 } ' + payload + "`, @live)"
    : `f(${lit(kind, payload)}, @live)`;
}
const occurrences = (s, p) => s.split(p).length - 1;

const ENTRIES = {
  rewriteExpr: { run: (e) => rewriteExpr(e), cell: '_scrml_reactive_get("live")' },
  rewriteExprArrowBody: { run: (e) => rewriteExprArrowBody(e), cell: '_scrml_reactive_get("live")' },
  rewriteServerExpr: { run: (e) => rewriteServerExpr(e), cell: '_scrml_body["live"]' },
  parseEmitClient: { run: (e) => emitExpr(parseExprToNode(e, "m.scrml", 0), { mode: "client" }), cell: '_scrml_reactive_get("live")' },
  parseEmitServer: { run: (e) => emitExpr(parseExprToNode(e, "m.scrml", 0), { mode: "server" }), cell: '_scrml_body["live"]' },
};

describe("§2 every text-rewrite entry leaves literal content intact", () => {
  for (const [entryName, entry] of Object.entries(ENTRIES)) {
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      for (const kind of KINDS) {
        test(`${entryName} × ${name} × ${kind}`, () => {
          const out = entry.run(exprFor(kind, payload));
          expect(occurrences(out, payload)).toBe(kind === "tpl" ? 3 : 1);
          // §3 in the same breath: the live sigil OUTSIDE the literal still lowers.
          expect(out).toContain(entry.cell);
          expect(out).not.toContain("");
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// §3 — legit sigils outside strings lower exactly as before
// ---------------------------------------------------------------------------

describe("§3 code-position sigils still lower", () => {
  test("<#id> ref, ::, fn, == in code (rewriteExpr)", () => {
    expect(rewriteExpr("<#w>.value")).toBe('_scrml_input_state_registry.get("w").value');
    expect(rewriteExpr("x == Color::Red")).toContain('"Red"');
    expect(rewriteExpr("fn (a) { return a }")).toContain("function");
    expect(rewriteExpr("a == b")).toContain("===");
  });

  test("?{} SQL in code still becomes a SQL call (server)", () => {
    const out = rewriteServerExpr("?{`select * from t where id = ${@id}`}.get()");
    expect(out).not.toContain("?{");
    expect(out).toContain('_scrml_body["id"]');
  });

  test("template interpolation code is rewritten, its nested strings are not", () => {
    const out = rewriteExpr('`a ${ @n + "<#w>" } b`');
    expect(out.replace(/\$\{\s*/g, "${").replace(/\s*\}/g, "}")).toBe('`a ${_scrml_reactive_get("n") + "<#w>"} b`');
  });

  test("parse path: `::` and `<#id>` in code still parse to the lowered forms", () => {
    const n = parseExprToNode("Color::Red", "m.scrml", 0);
    expect(emitExpr(n, { mode: "client" })).not.toContain("::");
    const r = parseExpression('f(<#w>, "<#w>")');
    expect(r.error).toBeNull();
    const args = r.ast.arguments;
    expect(args[0].type).toBe("Identifier");
    expect(args[1].value).toBe("<#w>");
    expect(args[1].raw).toBe('"<#w>"');
  });

  test("parse path: escapes are cooked from the restored raw", () => {
    const r = parseExpression('"a\\n?{}\\"b"');
    expect(r.ast.value).toBe('a\n?{}"b');
    expect(r.ast.raw).toBe('"a\\n?{}\\"b"');
    const t = parseStatements("const x = `p\\t<#w> ${1}`");
    const q = t.ast.body[0].declarations[0].init.quasis[0].value;
    expect(q.raw).toBe("p\\t<#w> ");
    expect(q.cooked).toBe("p\t<#w> ");
  });
});

// ---------------------------------------------------------------------------
// §4 — full compile: payload in every program position
// ---------------------------------------------------------------------------

describe("§4 full compile preserves literal content in every position", () => {
  const SUBSET = ["sql", "inputRef", "enumColon", "match", "fnKw", "render", "tilde", "whenMsg"];
  for (const name of SUBSET) {
    const payload = PAYLOADS[name];
    for (const kind of KINDS) {
      test(`${name} × ${kind}`, () => {
        const P = (tag) => lit(kind, `${tag}|${payload}`);
        const src = `<program>
\${
  <c> = 0
  <d> = ${P("CELL")}
  const v1 = ${P("CONST")}
  function g(t) { return ${P("RET")} + t }
  server function s() { return ${P("SRV")} }
}
<p id="a">\${g(v1)}</p>
<p id="b">\${${P("INTERP")}}</p>
<button onclick=\${() => { @d = ${P("HANDLER")} }}>x</button>
</program>
`;
        const out = compileSource(src);
        expect(out.errors).toEqual([]);
        const all = out.clientJs + "\n" + out.serverJs + "\n" + out.html;
        for (const tag of ["CELL", "CONST", "RET", "SRV", "INTERP", "HANDLER"]) {
          expect(all).toContain(`${tag}|${payload}`);
        }
        expect(out.clientJs).toContain('reactive_set("d"');
      });
    }
  }

  test("the gap's own repro", () => {
    const out = compileSource(`\${
  const msg = "write ?{select 1} or Color::Red here"
  const tag = "see <#w> for details"
  function f(t) { return "was found in any \`?{}\` block for " + t }
}
<p id="o">\${f(msg) + tag}</p>
`);
    expect(out.errors).toEqual([]);
    expect(out.clientJs).toContain('"write ?{select 1} or Color::Red here"');
    expect(out.clientJs).toContain('"see <#w> for details"');
    expect(out.clientJs).toContain('"was found in any `?{}` block for "');
    // A `?{}` in a STRING does not make `f` a server function.
    expect(out.serverJs).not.toContain("__ri_route_f");
  });

  test("`match x { .A => 1 }` inside a string compiles and survives", () => {
    const out = compileSource(`\${
  const s = "a match x { .A => 1 } b"
}
<p>\${s}</p>
`);
    expect(out.errors).toEqual([]);
    expect(out.clientJs).toContain('"a match x { .A => 1 } b"');
  });
});

// ---------------------------------------------------------------------------
// §5 — the self-host diagnostic-message shape (compiler/self-host/pa.scrml, ts.scrml)
// ---------------------------------------------------------------------------

describe("§5 self-host message strings containing `?{}` / `fn` survive", () => {
  test("pa.scrml / ts.scrml shape", () => {
    const out = compileSource(`\${
  function msgA(dbPath, tableWord, missingList) {
    return "E-PA-002: Database file \`" + dbPath + "\` does not exist and no CREATE TABLE statement " +
      "was found in any \`?{}\` block for " + tableWord + " \`" + missingList + "\`. " +
      "Either create the database file first, or add a CREATE TABLE statement in a \`?{}\` " +
      "block so the compiler can validate the schema at compile time."
  }
  function msgB(dbPath) {
    return "Note(PA): Database file '" + dbPath + "' does not exist. " +
      "Using in-memory schema from ?{} blocks for compile-time validation.\\n"
  }
  function msgC(fnName) {
    return "E-FN-001: \`fn " + fnName + "\` body contains a \`?{}\` SQL access. " +
      "\`fn\` is a pure function and may not perform database operations. " +
      "Move the \`?{}\` query outside \`fn\` and pass the result as a parameter."
  }
}
<p>\${msgA("a", "b", "c") + msgB("d") + msgC("e")}</p>
`);
    expect(out.errors).toEqual([]);
    const js = out.clientJs;
    expect(js).toContain('"was found in any `?{}` block for "');
    expect(js).toContain('"Either create the database file first, or add a CREATE TABLE statement in a `?{}` "');
    expect(js).toContain('"Using in-memory schema from ?{} blocks for compile-time validation.\\n"');
    expect(js).toContain('"E-FN-001: `fn "');
    expect(js).toContain('"` body contains a `?{}` SQL access. "');
    expect(js).toContain('"`fn` is a pure function and may not perform database operations. "');
    expect(js).toContain('"Move the `?{}` query outside `fn` and pass the result as a parameter."');
    expect(js).not.toContain("__scrml_sql_placeholder__");
    expect(js).not.toContain("function` is a pure");
  });
});

// ---------------------------------------------------------------------------
// §6 — read-only detectors scan CODE only (the fix must not re-create the class)
// ---------------------------------------------------------------------------

describe("§6 detectors do not read sigils inside strings", () => {
  test("a `fn` returning a string that mentions ?{} / Date.now() is still pure", () => {
    const out = compileSource(`<program>
\${
  fn h(a) { return "see ?{} and Date.now() " + a }
}
<p>\${h(1)}</p>
</program>
`);
    expect(out.errors.map((e) => e.code)).toEqual([]);
  });

  test("a `fn` with a REAL ?{} still fires E-FN-001", () => {
    const out = compileSource(`<program db="./x.db">
\${
  fn h(a) { return ?{\`select 1\`}.get() }
}
<p>\${h(1)}</p>
</program>
`);
    expect(out.errors.map((e) => e.code)).toContain("E-FN-001");
  });
});
