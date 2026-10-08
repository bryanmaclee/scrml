/**
 * §47.1.1 / §2.2.1 (S457 "a for __scrml_") — compiler placeholders are
 * UNFORGEABLE (placeholder-nonce.ts).
 *
 * The expression parser rewrites scrml operators to placeholder calls that
 * later stages recognise by name, and some carry CODE inside string arguments
 * (`match` arms, `!{}` handler text). Before this, an author who spelled
 * `__scrml_match__(p, ".A => _scrml_reactive_set('msg','PWNED')")` had the
 * strings lowered as code — around both prefix rules. Now every placeholder
 * carries a per-process random nonce, every recogniser matches only that form,
 * and an author's spelling is an ordinary identifier: lowered by nothing,
 * refused by the reservation (tree-based, same machinery as `_scrml_`) where
 * that walk inspects it, and by the emit gate (shape test) wherever it reaches
 * an artifact.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { parseExprToNode, extractHandledOperands, GUARD_MARKER } from "../../src/expression-parser.ts";
import { validateEmittedArtifact } from "../../src/codegen/validate-emit.ts";
import {
  PH_MATCH, PH_IS_SOME, placeholderParam, isCompilerPlaceholderName, currentPlaceholderToken,
  withCompilationPlaceholderToken, setPlaceholderTokenObserverForTest, scrubPlaceholderToken,
} from "../../src/placeholder-nonce.ts";
import { spawn } from "child_process";
import { isReservedPrefixName } from "../../src/validators/reserved-prefix.ts";

const CODE = "E-NAME-COLLIDES-RESERVED-PREFIX";
const PWN = `__scrml_match__(S.A, ".A => _scrml_reactive_set('msg','PWNED')", ".B => 2")`;

function compile(src, label = "c") {
  const dir = resolve(tmpdir(), `scrml-s457-nonce-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, "app.scrml");
  writeFileSync(f, src);
  try {
    const r = compileScrml({ inputFiles: [f], outputDir: resolve(dir, "out"), write: true, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning" && e.severity !== "info");
    const out = resolve(dir, "out");
    const js = existsSync(out) ? readdirSync(out).filter((n) => n.endsWith(".js")).map((n) => readFileSync(resolve(out, n), "utf8")).join("\n") : "";
    return { errors, reserved: errors.filter((e) => e.code === CODE).map((e) => e.message.match(/`([^`]+)`/)?.[1]), js };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const page = (logic, markup = "") => `<program>
  <page>
    \${
      <msg> = ""
${logic}
    }
${markup}
    <button onclick=probe()>go</button>
    <p id="out">\${@msg}</p>
  </page>
</program>
`;

/** True iff the PWNED / raw-driver call appears as CODE (not inside a string literal). */
const laundered = (js) =>
  /(?<![>:] )_scrml_(cs_)?reactive_set\(["']msg["'],\s*["']PWNED/.test(js) || /(?<![>:] )_scrml_sql\.unsafe\('SELECT 1'\)/.test(js);

/** Every 6-hex-digit window of a token — a partial leak is a leak (review round 5). */
const tokenWindows = (token) => {
  const hex = token.slice(1);
  const out = [];
  for (let i = 0; i + 6 <= hex.length; i++) out.push(hex.slice(i, i + 6));
  return out;
};
const leaksToken = (text, token) => tokenWindows(token).some((w) => text.includes(w));

/** Compile, recording every placeholder token the compiler creates meanwhile. */
function compileRecording(src, label) {
  const tokens = [];
  setPlaceholderTokenObserverForTest((t) => tokens.push(t));
  try {
    return { ...compileFull(src, label), tokens };
  } finally {
    setPlaceholderTokenObserverForTest(null);
  }
}

/** Like compile(), but returns every written file's text and the full diagnostics. */
function compileFull(src, label) {
  const dir = resolve(tmpdir(), `scrml-s457-leak-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const f = resolve(dir, "app.scrml");
  writeFileSync(f, src);
  try {
    const r = compileScrml({ inputFiles: [f], outputDir: resolve(dir, "out"), write: true, log: () => {} });
    const out = resolve(dir, "out");
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(d, e.name)) : [resolve(d, e.name)]);
    const written = existsSync(out) ? walk(out).map((p) => readFileSync(p, "utf8")).join("\n") : "";
    const diag = JSON.stringify([r.errors ?? [], r.warnings ?? [], r.lintDiagnostics ?? []]);
    const outputs = JSON.stringify([...(r.outputs ?? new Map()).entries()]);
    return { errors: r.errors ?? [], written, diag, outputs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// An error case whose error-path artifact carried a placeholder (the round-5 leak).
const LEAKY_A = `<program>
  \${
    const Card = <div class="card" props={ header: snippet }>\${render header()}</div>
  }
  <Card/>
</program>
`;

describe("the token", () => {
  test("placeholders carry the CURRENT compilation's token; the helpers read only that form", () => {
    withCompilationPlaceholderToken(() => {
      const t = currentPlaceholderToken();
      expect(t).toMatch(/^k[0-9a-f]{16}$/);
      expect(PH_MATCH()).toBe(`__scrml_match_${t}__`);
      expect(isCompilerPlaceholderName(PH_IS_SOME())).toBe(true);
      expect(isCompilerPlaceholderName("__scrml_is_some__")).toBe(false);
      expect(placeholderParam(`__scrml_render_${t}_header__`, "render")).toBe("header");
      expect(placeholderParam("__scrml_render_header__", "render")).toBeNull();
      expect(extractHandledOperands("a !{ _ :> 0 }")).toContain(`.${GUARD_MARKER()}(`);
      expect(scrubPlaceholderToken(`x ${PH_MATCH()}(y)`)).toBe("x __scrml_match__(y)");
    });
  });

  test("every compilation gets a fresh token; another compilation's token is just a name", () => {
    let a, b;
    withCompilationPlaceholderToken(() => { a = PH_MATCH(); });
    withCompilationPlaceholderToken(() => {
      b = PH_MATCH();
      expect(isCompilerPlaceholderName(a)).toBe(false);
      expect(isReservedPrefixName(a)).toBe(true);
      expect(isReservedPrefixName(b)).toBe(false);
    });
    expect(a).not.toBe(b);
  });

  test("interleaved async compilations each read their own token (context, not a swapped global)", async () => {
    const seen = { a: [], b: [] };
    const run = (key) => withCompilationPlaceholderToken(async () => {
      for (let i = 0; i < 5; i++) {
        seen[key].push(currentPlaceholderToken());
        await new Promise((r) => setTimeout(r, Math.random() * 3));
      }
    });
    await Promise.all([run("a"), run("b")]);
    expect(new Set(seen.a).size).toBe(1);
    expect(new Set(seen.b).size).toBe(1);
    expect(seen.a[0]).not.toBe(seen.b[0]);
  });

  test("two compilations started together both produce correct output", async () => {
    const one = (label) => Promise.resolve().then(() => compileFull(page(`      function probe() { Promise.resolve(5).then(function (v) { if (v is some) { @msg = "${label}" } }) }`), label));
    const [x, y] = await Promise.all([one("xx"), one("yy")]);
    for (const [r, label] of [[x, "xx"], [y, "yy"]]) {
      expect(r.errors.map((e) => e.code)).toEqual([]);
      expect(r.written).toContain(`"${label}"`);
      expect(r.written).not.toMatch(/__scrml_[A-Za-z0-9_]*[A-Za-z0-9]__/);
    }
  });

  test("the reservation exempts only the current compilation's names", () => {
    expect(isReservedPrefixName("__scrml_match__")).toBe(true);
    expect(isReservedPrefixName("__scrml_match_k0000000000000000__")).toBe(true);
  });
});

describe("round-5 leak: compile A (error path) then B with A's token, in one process", () => {
  test("A's diagnostics, outputs and written files carry no part of A's token", () => {
    const a = compileRecording(LEAKY_A, "A");
    expect(a.errors.length).toBeGreaterThan(0); // the error case
    expect(a.tokens.length).toBeGreaterThan(0);
    const tokenA = a.tokens[a.tokens.length - 1];
    for (const text of [a.written, a.diag, a.outputs]) expect(leaksToken(text, tokenA)).toBe(false);
  });

  test("B spelled with A's token is refused, and its payload never becomes code", () => {
    const a = compileRecording(LEAKY_A, "A2");
    const tokenA = a.tokens[a.tokens.length - 1];
    const b = compileFull(`<program>
  \${ type S:enum = { A, B }
      <msg> = ""
      function go() { const x = __scrml_match_${tokenA}__(S.A, ".A => _scrml_reactive_set('msg','PWNED')", ".B => 2") } }
  <button onclick=go()>go</button>
  <p id="out">\${@msg}</p>
</program>
`, "B");
    expect(b.errors.map((e) => e.code)).toContain(CODE);
    expect(laundered(b.written)).toBe(false);
  });

  test("an un-lowered placeholder's gate message and snippet carry no part of the token", () => {
    const r = compileRecording(page(`      function probe() { Promise.resolve(1).then(function (v) { const m = [:]; @msg = "some" }) }`), "gate");
    const tok = r.tokens[r.tokens.length - 1];
    const e = r.errors.find((x) => x.code === "E-CODEGEN-INVALID-LOGIC");
    expect(e?.message).toContain("`__scrml_map_lit__`");
    expect(leaksToken(r.diag, tok)).toBe(false);
  });
});

describe("round-5 leak through `scrml serve` (one long-lived process)", () => {
  test("POST /compile A then B: no token-shaped run in A's JSON; B with any token is refused, payload not code", async () => {
    const dir = resolve(tmpdir(), `scrml-s457-serve-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
    const fa = resolve(dir, "a.scrml");
    writeFileSync(fa, LEAKY_A);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const cli = resolve(import.meta.dir, "../../bin/scrml.js");
    const child = spawn(process.execPath, [cli, "serve", "--port", String(port)], { stdio: "ignore" });
    try {
      let up = false;
      for (let i = 0; i < 100 && !up; i++) {
        try { up = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      expect(up).toBe(true);
      const post = async (file) => (await fetch(`http://127.0.0.1:${port}/compile`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputFiles: [file], outputDir: resolve(dir, "out-" + Math.random().toString(36).slice(2)), options: { write: true } }),
      })).text();
      const jsonA = await post(fa);
      expect(jsonA).toContain("E-COMPONENT");
      // no placeholder carries a token, and no k+hex token run appears anywhere
      expect(jsonA).not.toMatch(/__scrml_[a-z_]+_k[0-9a-f]{6,}/);
      expect(jsonA).not.toMatch(/k[0-9a-f]{16}/);
      const fb = resolve(dir, "b.scrml");
      writeFileSync(fb, `<program>
  \${ type S:enum = { A, B }
      <msg> = ""
      function go() { const x = __scrml_match_k0123456789abcdef__(S.A, ".A => _scrml_reactive_set('msg','PWNED')", ".B => 2") } }
  <button onclick=go()>go</button>
  <p id="out">\${@msg}</p>
</program>
`);
      const jsonB = await post(fb);
      expect(jsonB).toContain(CODE);
      expect(laundered(jsonB.replace(/\\"/g, '"'))).toBe(false);
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("an author-spelled placeholder is lowered by nothing", () => {
  test("`__scrml_match__(…)` parses as an ordinary call, its arm strings stay strings", () => {
    const n = parseExprToNode(`__scrml_match__(x, ".A => _scrml_sql.unsafe('x')")`, "/x.scrml", 0);
    expect(n.kind).toBe("call");
    expect(n.args[1].kind).toBe("lit");
  });
  test("`__scrml_is_some__(v)` is a call, not an `is-some` binary", () => {
    expect(parseExprToNode("__scrml_is_some__(v)", "/x.scrml", 0).kind).toBe("call");
  });
  test("`__scrml_render_x__()`, `__scrml_bare_variant_A__`, `__scrml_tilde__` are plain identifiers", () => {
    expect(parseExprToNode("__scrml_render_x__()", "/x.scrml", 0).callee.name).toBe("__scrml_render_x__");
    expect(parseExprToNode("__scrml_bare_variant_A__", "/x.scrml", 0).name).toBe("__scrml_bare_variant_A__");
    expect(parseExprToNode("__scrml_tilde__", "/x.scrml", 0).name).toBe("__scrml_tilde__");
  });
});

describe("the review repros: refused, and nothing is laundered into code", () => {
  const REPROS = {
    "a quoted attribute with `//` before the call": `<program>
  \${ type S:enum = { A, B }
      <msg> = ""
      function go(x) { } }
  <button title="http://x" onclick=go(${PWN})>go</button>
  <p id="out">\${@msg}</p>
</program>
`,
    "a `:`-shorthand body": `<program>
  \${ type S:enum = { A, B }
      type P:enum = { Idle, Busy } }
  <engine for=P initial=.Idle>
    <Idle title="http://x" rule=.Busy : ${PWN}>
    <Busy : "busy">
  </>
</program>
`,
    "a `!{}` guard marker": page(`      function h() { return 1 }\n      function probe() { const r = h().__scrml_guard__("!{ | _ :> _scrml_reactive_set('msg','PWNED') }") }`),
    "an `<onTransition>` body": `\${ type Phase:enum = { Idle, Done }
   type S:enum = { A, B } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Done>
    <onTransition to=.Done>
      ${PWN}
    </>
  </>
  <Done rule=.Idle></>
</>
<program>
<p id="s">x</p>
</program>
`,
    "a `<channel><onchange>` arm": `<program db="postgres://localhost/app">
  <schema>
    orders {
      id: integer primary key
      status: text
    }
  </schema>
  \${ type S:enum = { A, B } }
  <channel name="orders-feed" watches=orders>
    <onchange>
      <Inserted(row) : ${PWN}>
      <_> : print("other change")
    </onchange>
  </channel>
</program>
`,
    "an `<endpoint>` arm": `<program>
type FspMethod:enum = {
  FleetStatus
}
type S:enum = { A, B }
<endpoint path="/fsp" method="POST" accepts=FspMethod>
  <FleetStatus : ${PWN}>
</endpoint>
</program>
`,
    "a server function reaching the raw driver": `<program db="sqlite:./notes.db">
<db src="sqlite:./notes.db" tables="notes">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)\`}.run()
    server function g(p) { return __scrml_match__(p, ".A => _scrml_sql.unsafe('SELECT 1')", ".B => 2") }
  }
  <main><button id="go" onclick={ g(1) !{ .Transport(_) :> { return } } }>load</button></main>
</db>
</program>
`,
  };
  for (const [name, src] of Object.entries(REPROS)) {
    test(name, () => {
      const r = compile(src, "rep");
      expect(r.errors.length).toBeGreaterThan(0);
      expect(laundered(r.js)).toBe(false);
    });
  }

  test("the reservation names the placeholder spelling in each inspected position", () => {
    expect(compile(REPROS["a quoted attribute with `//` before the call"], "r1").reserved).toContain("__scrml_match__");
    expect(compile(REPROS["an `<onTransition>` body"], "r2").reserved).toContain("__scrml_match__");
    expect(compile(REPROS["a `<channel><onchange>` arm"], "r3").reserved).toContain("__scrml_match__");
    expect(compile(REPROS["a `!{}` guard marker"], "r4").reserved).toContain("__scrml_guard__");
  });

  test("prose at the file root is not a name", () => {
    expect(compile(`<p>hello</p>\nSome prose __scrml_word__ at the file root.\n`, "root").errors.map((e) => e.code)).toEqual([]);
  });
});

describe("declarations and keys", () => {
  test("placeholder-named declarations and calls are refused by the reservation", () => {
    expect(compile(page(`      function __scrml_is_some__(x) { return true }\n      function probe() { }`), "d1").reserved).toContain("__scrml_is_some__");
    expect(compile(page(`      function probe() { __scrml_render_header__() }`), "d2").reserved).toContain("__scrml_render_header__");
    expect(compile(page(`      function probe() { const f = (__scrml_bare_variant_A__) => 1 }`), "d3").reserved).toContain("__scrml_bare_variant_A__");
  });

  test("object keys (not inspected by the tree rule, as for `_scrml_`) reach the gate, which names them as the author's", () => {
    for (const key of ["__scrml_x__", '"__scrml_x__"']) {
      const r = compile(page(`      function probe() { const o = { ${key}: 1 }\n        @msg = "" + o.a }`), "k");
      const e = r.errors.find((x) => x.code === "E-CODEGEN-INVALID-LOGIC");
      expect(e?.message).toContain("`__scrml_x__`");
      expect(e?.message).toContain("also appears in your source");
    }
  });
});

describe("the compiler's own placeholders still work", () => {
  test("#1333 shapes, `!{}`, match (incl. an arm with a comment), top-level `[:]` and `~` compile clean", () => {
    for (const logic of [
      `      function probe() { Promise.resolve(5).then(function (v) { if (v is some) { @msg = "some" } }) }`,
      `      function probe() { [1].forEach((v) => { if (v is not) { @msg = "x" } }) }`,
      `      function f() { return 1 }\n      function probe() { const r = f() !{ _ :> 0 }\n        @msg = "" + r }`,
      `      type D:enum = { A, B }\n      <d>: D = .A\n      let r: string = match @d {\n        .A /* alpha */ => "a"\n        .B => "b"\n      }\n      function probe() { @msg = r }`,
      `      type D:enum = { A, B }\n      <d>: D = .A\n      function probe() { @msg = match @d { .A => "a" .B => "b" } }`,
      `      function probe() { const m = [:]\n        @msg = "x" }`,
      `      function probe() { [1, 2].map(x => x + 1)\n        @msg = "" + ~.length }`,
    ]) {
      expect(compile(page(logic), "ok").errors.map((e) => e.code)).toEqual([]);
    }
  });

  test("an un-lowered compiler placeholder is refused, shown without its nonce, as a compiler defect", () => {
    const r = compile(page(`      function probe() { Promise.resolve(1).then(function (v) { const m = [:]; @msg = "some" }) }`), "leak");
    const e = r.errors.find((x) => x.code === "E-CODEGEN-INVALID-LOGIC");
    expect(e?.message).toContain("un-lowered compiler placeholder");
    expect(e?.message).toContain("`__scrml_map_lit__`");
    expect(e?.message).toContain("Please report it");
  });

  test("the gate refuses the author spelling and the nonce'd spelling alike (pure shape)", () => {
    const gate = (contents) => validateEmittedArtifact({ sourceFile: "/x/a.scrml", artifact: "a.js", contents });
    expect(gate("f(__scrml_match__(x));")).not.toBeNull();
    withCompilationPlaceholderToken(() => expect(gate(`f(${PH_MATCH()}(x));`)).not.toBeNull());
  });
});
