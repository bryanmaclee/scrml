/**
 * S457 — two executed sinks (dispatch s457-executable-sinks-srcdoc-svg; SPEC §5.2 rule 2 S457 bullets,
 * rule 3 SVG animation values). Drives the REAL pipeline at every markup position:
 *   §1 `srcdoc` takes data in ANY form → E-ATTR-INTERP-EXECUTABLE (was: only the quoted `"${…}"`);
 *   §2 `srcdoc` controls — a static string, a bare presence attribute, a component prop named `srcdoc`;
 *   §3 an `on…` attribute an emitter would WRITE as text from data → refused; the sanctioned unquoted
 *      listener forms (and a declared component prop spelled `onX`) are untouched;
 *   §4 an SVG animation value (`to` / `from` / `by` / `values`) whose `attributeName` names a URL
 *      attribute (or is computed) is a guarded URL write at every position — and `to=${…}` is no longer
 *      silently dropped;
 *   §5 rule 2 on animation values: an unsafe LITERAL scheme before `${…}` is refused at compile time;
 *   §6 controls — a non-URL `attributeName` and a missing one are byte-identical (no guard);
 *   §7 the server's first-paint `<each>` rows guard an animation value too (EXECUTED).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";

const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compile(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `s457-sinks-${name}-`));
  _dirs.push(dir);
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const rd = (f) => (existsSync(join(dist, f)) ? readFileSync(join(dist, f), "utf8") : "");
  const errors = (result.errors ?? []).filter((d) => (d.severity ?? "error") === "error");
  return { errors, codes: errors.map((e) => e.code), client: rd(`${name}.client.js`), html: rd(`${name}.html`) };
}

// The nine markup positions (the S457 URL-guard dispatch's enumeration).
const POS = {
  top: (el) => `<program>\n<u> = "/a"\n${el("@u")}\n</program>\n`,
  componentProp: (el) => `<program>\n<u> = "/a"\nconst Lnk = <span props={ v: string }>${el("v")}</span>\n<Lnk v=@u/>\n</program>\n`,
  componentReactive: (el) => `<program>\n<u> = "/a"\nconst Lnk = <span>${el("@u")}</span>\n<Lnk/>\n</program>\n`,
  slot: (el) => `<program>\n<u> = "/a"\nconst Wrap = <div class="w">\${children}</div>\n<Wrap>${el("@u")}</Wrap>\n</program>\n`,
  each: (el) => `<program>\n<items> = [{ url: "/a" }]\n<ul>\n  <each in=@items as it>\n    <li>${el("it.url")}</li>\n  </each>\n</ul>\n</program>\n`,
  ifMount: (el) => `<program>\n<u> = "/a"\n<on> = true\n<div if=@on>${el("@u")}</div>\n</program>\n`,
  engine: (el) => `\${\n  type Light:enum = { Green, Red }\n}\n<u> = "/a"\n<engine for=Light initial=.Green>\n  <Green rule=.Red>\n    ${el("@u")}\n  </>\n  <Red rule=.Green></>\n</>\n<program>\n<p>\${@light}</p>\n</program>\n`,
  match: (el) => `\${\n  type Phase:enum = { Idle, Ready }\n  <phase>: Phase = .Idle\n  <u> = "/a"\n}\n<match for=Phase on=@phase>\n  <Idle>\n    ${el("@u")}\n  </>\n  <Ready><p>r</p></>\n</match>\n`,
  forLift: (el) => `<program>\n<items> = [{ url: "/a" }]\n<ul>\n\${ for (const it of @items) { lift ${el("it.url")} } }\n</ul>\n</program>\n`,
};

/** Every line of the client bundle that writes attribute `name`. */
function writesOf(client, name) {
  return client.split("\n").filter((l) => l.includes(`setAttribute(${JSON.stringify(name)},`));
}

// ---------------------------------------------------------------------------
// §1 srcdoc — every data form refused
// ---------------------------------------------------------------------------

const SRCDOC_FORMS = {
  expression: (x) => `<iframe srcdoc=\${${x}}></iframe>`,
  variable: (x) => `<iframe srcdoc=${x}></iframe>`,
  upperCase: (x) => `<iframe SRCDOC=\${${x}}></iframe>`,
  quoted: (x) => `<iframe srcdoc="\${${x}}"></iframe>`,
};

describe("§1 `srcdoc` takes data in any form → E-ATTR-INTERP-EXECUTABLE", () => {
  for (const [pname, mk] of Object.entries(POS)) {
    for (const [fname, el] of Object.entries(SRCDOC_FORMS)) {
      test(`${fname} @ ${pname}`, () => {
        const { codes, errors } = compile(`srcdoc-${fname}-${pname}`.toLowerCase(), mk(el));
        expect(codes).toContain("E-ATTR-INTERP-EXECUTABLE");
        // Reported once per emitted attribute.
        expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE").length).toBe(1);
        if (fname !== "quoted") {
          expect(errors.find((e) => e.code === "E-ATTR-INTERP-EXECUTABLE").message).toContain("takes its value from data");
        }
      });
    }
  }

  test("a call `srcdoc=f()` is refused", () => {
    const { codes } = compile("srcdoc-call", `<program>\n<u> = "/a"\n\${ function f() { return "<b>x</b>" } }\n<iframe srcdoc=f()></iframe>\n</program>\n`);
    expect(codes).toContain("E-ATTR-INTERP-EXECUTABLE");
  });

  test("a component prop reaching a `srcdoc` is refused once, at the definition, even for a literal caller value", () => {
    const { codes } = compile("srcdoc-prop", `<program>\nconst F = <div props={ d: string }><iframe srcdoc=d></iframe></div>\n<F d="<b>x</b>"/>\n<F d="<i>y</i>"/>\n</program>\n`);
    expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE").length).toBe(1);
  });

  test("the generated client never writes `srcdoc` from data when the compile is refused", () => {
    const { client } = compile("srcdoc-nowrite", `<program>\n<u> = "/a"\n<iframe srcdoc=\${@u}></iframe>\n</program>\n`);
    for (const w of writesOf(client, "srcdoc")) expect(w).not.toContain("_scrml_x");
  });
});

describe("§2 `srcdoc` controls", () => {
  test("a static string, a bare presence attribute, and a component prop named `srcdoc` compile clean", () => {
    const { codes, html } = compile("srcdoc-ok", `<program>
<u> = "x"
<iframe srcdoc="<p>hi</p>"></iframe>
<iframe srcdoc></iframe>
const Frame = <div props={ srcdoc: string }><p>\${srcdoc}</p></div>
<Frame srcdoc=@u/>
</program>
`);
    expect(codes).toEqual([]);
    expect(html).toContain('<iframe srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe>');
  });
});

// ---------------------------------------------------------------------------
// §3 event-handler TEXT from data
// ---------------------------------------------------------------------------

describe("§3 an `on…` attribute written as text from data is refused", () => {
  const REFUSED = {
    upperExpr: [(x) => `<button ONCLICK=\${${x}}>b</button>`, ["top", "componentProp", "componentReactive", "slot", "ifMount", "engine", "match"]],
    mixedExpr: [(x) => `<button Onclick=\${${x}}>b</button>`, ["top", "slot", "engine"]],
  };

  // S457 review round 2 (PA ruling (a)): `lift` wires every rule-1 `on…` name as a listener, as
  // `<each>` rows and emit-html do — it never writes handler text, and nothing is refused.
  const LIFT_WIRED = {
    upperExpr: [(x) => `<button ONCLICK=\${${x}}>b</button>`, "click"],
    mixedExpr: [(x) => `<button Onclick=\${${x}}>b</button>`, "click"],
    camelExpr: [(x) => `<button onClick=\${${x}}>b</button>`, "click"],
    camelVar: [(x) => `<button onClick=${x}>b</button>`, "click"],
    upperCall: [(x) => `<button ONCLICK=go(${x})>b</button>`, "click"],
    colonExpr: [(x) => `<button on:dblclick=\${${x}}>b</button>`, "dblclick"],
  };
  for (const [sname, [el, ev]] of Object.entries(LIFT_WIRED)) {
    test(`lift wires ${sname} as a "${ev}" listener`, () => {
      const src = POS.forLift(el).replace("</program>", "${ function go(v) { return v } }\n</program>");
      const { codes, client } = compile(`lift-wired-${sname}`.toLowerCase(), src);
      expect(codes).toEqual([]);
      expect(client).toContain(`.addEventListener(${JSON.stringify(ev)}, `);
      expect(client).not.toMatch(/setAttribute\("(ONCLICK|Onclick|onClick|on:dblclick)",/);
    });
  }
  test("lift: the exact words `one` / `online` are ordinary attributes (rule 1), not listeners", () => {
    const { codes, client } = compile("lift-online", POS.forLift((x) => `<div online=${x} one="1">d</div>`));
    expect(codes).toEqual([]);
    expect(client).toContain('setAttribute("online", ');
    expect(client).not.toContain('addEventListener("line"');
  });
  for (const [sname, [el, positions]] of Object.entries(REFUSED)) {
    for (const pname of positions) {
      test(`${sname} @ ${pname}`, () => {
        const { codes, client } = compile(`on-${sname}-${pname}`.toLowerCase(), POS[pname](el));
        expect(codes).toContain("E-ATTR-INTERP-EXECUTABLE");
        // No handler-text write is emitted.
        expect(client).not.toMatch(/setAttribute\("(ONCLICK|Onclick|onClick|on:click)",/);
      });
    }
  }

  test("the message names the wired lowercase spelling", () => {
    const { errors } = compile("on-msg", POS.top((x) => `<button ONCLICK=\${${x}}>b</button>`));
    const e = errors.find((d) => d.code === "E-ATTR-INTERP-EXECUTABLE");
    expect(e.message).toContain("event-handler TEXT");
    expect(e.message).toContain("`onclick=f(x)`");
  });

  test("control — the sanctioned listener forms compile clean at every position", () => {
    const FORMS = [
      (x) => `<button onclick=\${() => ${x}}>b</button>`,
      (x) => `<button onclick=go(${x})>b</button>`,
      (x) => `<svg><animate attributeName="x" onbegin=\${() => ${x}}/></svg>`,
    ];
    for (const [pname, mk] of Object.entries(POS)) {
      for (const el of FORMS) {
        const src = mk(el).replace("</program>", "${ function go(v) { return v } }\n</program>");
        const { codes } = compile(`on-ok-${pname}`, src.includes("</program>") ? src : mk(el));
        expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE")).toEqual([]);
      }
    }
  });

  test("control — a declared component prop spelled `onX` on an expanded root inside `lift` is not refused", () => {
    const { codes } = compile("on-prop-lift", `<program>
<v> = "a"
\${ function setV(x) { @v = x } }
const Field = <fieldset props={ onPick: function }><legend>f</legend></fieldset>
<div>\${ lift <div><Field onPick=setV/></div> }</div>
</program>
`);
    expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 SVG animation values — guarded at every position
// ---------------------------------------------------------------------------

const ANIM = {
  setToExpr: [(x) => `<svg><a><set attributeName="href" to=\${${x}}/><text>t</text></a></svg>`, "to", "href"],
  setToQuoted: [(x) => `<svg><a><set attributeName="href" to="\${${x}}"/><text>t</text></a></svg>`, "to", "href"],
  animValues: [(x) => `<svg><a><animate attributeName="href" values="\${${x}}"/><text>t</text></a></svg>`, "values", "href"],
  animXlinkTo: [(x) => `<svg><a><animate attributeName="xlink:href" from="/a" to="\${${x}}"/><text>t</text></a></svg>`, "to", "xlink:href"],
  animFromExpr: [(x) => `<svg><a><animate attributeName="href" from=\${${x}} to="/b"/><text>t</text></a></svg>`, "from", "href"],
  animTransformBy: [(x) => `<svg><a><animateTransform attributeName="href" by=\${${x}}/><text>t</text></a></svg>`, "by", "href"],
};

describe("§4 an SVG animation value writing a URL attribute is guarded at every position", () => {
  for (const [pname, mk] of Object.entries(POS)) {
    for (const [sname, [el, attr, target]] of Object.entries(ANIM)) {
      test(`${sname} @ ${pname}`, () => {
        const { codes, client } = compile(`anim-${sname}-${pname}`.toLowerCase(), mk(el));
        expect(codes).toEqual([]);
        const writes = writesOf(client, attr);
        // A quoted attribute in a component body reading a prop is substituted with the caller's
        // SOURCE TEXT today (static `to="@u"` — open gap g-component-prop-in-quoted-attr-substitutes-
        // source-text-s456): no data write. Every other position must write, and every write is guarded.
        const staticSubstitution = pname === "componentProp" && (el("v").split(` ${attr}=`)[1] ?? "").startsWith("\"");
        if (!staticSubstitution) expect(writes.length).toBeGreaterThan(0);
        for (const w of writes) {
          expect(w).toContain(`_scrml_safe_url(`);
          expect(w).toContain(`, ${JSON.stringify(target)})`);
        }
      });
    }
  }

  test("`to=${@u}` on <set> is no longer dropped from the emitted HTML", () => {
    const { html, client } = compile("anim-notdropped", POS.top(ANIM.setToExpr[0]));
    expect(html).toContain('data-scrml-bind-attr-to="');
    expect(client).toContain('_scrml_el.setAttribute("to", _scrml_safe_url(_scrml_el, "to", String(_scrml_x), "href"))');
  });

  test("a computed attributeName fails closed — the value is guarded with target \"\"", () => {
    const { codes, client } = compile("anim-computed", `<program>\n<n> = "width"\n<u> = "/a"\n<svg><a><set attributeName=\${@n} to=\${@u}/><text>t</text></a></svg>\n</program>\n`);
    expect(codes).toEqual([]);
    const writes = writesOf(client, "to");
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).toContain(`_scrml_safe_url(_scrml_el, "to", String(_scrml_x), "")`);
  });
});

// ---------------------------------------------------------------------------
// §5 rule 2 on animation values — literal unsafe schemes refused
// ---------------------------------------------------------------------------

describe("§5 rule 2: an unsafe literal scheme before `${…}` in an animation value is refused", () => {
  const CASES = {
    toJs: `<svg><a><set attributeName="href" to="javascript:\${@u}"/><text>t</text></a></svg>`,
    valuesSecondEntry: `<svg><a><animate attributeName="href" values="/a;javascript:\${@u}"/><text>t</text></a></svg>`,
    valuesAmpersand: `<svg><a><animate attributeName="href" values="/a;&#106;avascript:\${@u}"/><text>t</text></a></svg>`,
    computedNameVb: `<svg><a><set attributeName=\${@n} to="vbscript:\${@u}"/><text>t</text></a></svg>`,
    dataHtml: `<svg><a><set attributeName="xlink:href" to="data:text/html,\${@u}"/><text>t</text></a></svg>`,
  };
  for (const [name, el] of Object.entries(CASES)) {
    test(name, () => {
      const { codes } = compile(`r2-${name}`.toLowerCase(), `<program>\n<u> = "x"\n<n> = "href"\n${el}\n</program>\n`);
      expect(codes).toContain("E-ATTR-INTERP-EXECUTABLE");
    });
  }

  test("admitted: a literal safe scheme / relative path before the interpolation (byte-identical, no guard)", () => {
    const { codes, client } = compile("r2-ok", `<program>
<u> = "x"
<svg><a><set attributeName="href" to="https://x.example/\${@u}"/><text>t</text></a></svg>
<svg><a><set attributeName="href" to="/p/\${@u}"/><text>t</text></a></svg>
</program>
`);
    expect(codes).toEqual([]);
    expect(client).not.toContain("_scrml_safe_url");
  });

  test("a static literal value (no `${…}`) is the author's static string, as on href", () => {
    const { codes } = compile("r2-static", `<program>\n<svg><a><set attributeName="href" to="javascript:void(0)"/><text>t</text></a></svg>\n</program>\n`);
    expect(codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 controls
// ---------------------------------------------------------------------------

describe("§6 controls — animation values that write no URL attribute are not guarded", () => {
  test("attributeName names a non-URL attribute; no attributeName (animateMotion); a non-animation element's `to`", () => {
    const { codes, client } = compile("anim-ctl", `<program>
<u> = "javascript:x"
<svg><rect width="1" height="1"><set attributeName="width" to=\${@u}/><animate attributeName="fill" values="\${@u}"/></rect></svg>
<svg><circle r="1"><animateMotion path="M0,0" values=\${@u}/></circle></svg>
<div to=\${@u}>d</div>
</program>
`);
    expect(codes).toEqual([]);
    expect(client).not.toContain("_scrml_safe_url");
  });
});

// ---------------------------------------------------------------------------
// §7 — server first-paint rows (§52.8), EXECUTED
// ---------------------------------------------------------------------------

function compileBundles(source, filePath = "/test/app.scrml") {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const out = result.outputs.get(filePath);
  return { serverJs: out?.serverJs ?? "", clientJs: out?.clientJs ?? "", html: out?.html ?? "" };
}

async function composeFirstPaint(serverJs, html, dbRows) {
  const runnable = serverJs
    .replace(/^\s*import\s+\{\s*SQL\s*\}\s+from\s+"bun";\s*$/m, "")
    .replace(/^\s*import\s+\{[^}]*_scrml_db_file_exists[^}]*\}\s+from\s+"node:fs";\s*$/m, "")
    .replace(/^\s*const _scrml_sql = .*;\s*$/m, "")
    .replace(/^export\s+/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify("file:///app.scrml"));
  const _scrml_sql = () => Promise.resolve(dbRows.map((r) => ({ ...r })));
  const BunStub = { file: () => ({ text: async () => html }) };
  class ResponseStub {
    constructor(body, init) { this._body = body; this.status = init?.status; }
    async text() { return this._body; }
  }
  const mod = new Function("_scrml_sql", "Bun", "Response", `${runnable}\nreturn { _scrml_ssr_compose_handler };`)(
    _scrml_sql, BunStub, ResponseStub,
  );
  const resp = await mod._scrml_ssr_compose_handler({});
  return await resp.text();
}

describe("§7 server-rendered first-paint rows", () => {
  test('`<set attributeName="href" to="${@.url}">` in a row: a javascript: row renders about:blank', async () => {
    const src = `<program db="sqlite:./test.db">
\${
  < Link authority="server" table="links">
    id: number
    url: string
  </>
  <Link> @links
}
<ul><each in=@links key=@.id><li><svg><a href="/x"><set attributeName="href" to="\${@.url}"/><text>t</text></a></svg></li></each></ul>
</program>`;
    const { serverJs, html } = compileBundles(src);
    expect(serverJs).toContain('_scrml_safe_url(null, "to", ');
    expect(serverJs).toContain(', "href")');
    const logs = [];
    const orig = console.error;
    console.error = (...a) => logs.push(a.map(String).join(" "));
    let page;
    try {
      page = await composeFirstPaint(serverJs, html, [
        { id: 1, url: "javascript:alert(document.cookie)" },
        { id: 2, url: "/safe" },
      ]);
    } finally { console.error = orig; }
    const markup = page.slice(page.indexOf("<body>"));
    expect(markup).toContain('to="about:blank"');
    expect(markup).toContain('to="/safe"');
    expect(markup).not.toContain("javascript:");
    expect(logs.length).toBe(1);
    expect(logs[0]).not.toContain("document.cookie");
  });
});

// ---------------------------------------------------------------------------
// §8 S457 review round — declared component props in `<each>` / `lift`, and the de-dup key
// ---------------------------------------------------------------------------

describe("§8 a declared prop written onto an expanded root in `<each>` / `lift` (PA ruling (a))", () => {
  const ROW = {
    each: (el) => `<ul><each in=@items as it><li>${el}</li></each></ul>`,
    lift: (el) => `<ul>\${ for (const it of @items) { lift <li>${el}</li> } }</ul>`,
  };
  const page = (defs, body) => `<program>\n<items> = [{ d: "x", code: "y", url: "/u", t: "tip" }]\n\${ function f(v) { return v } }\n${defs}${body}\n</program>\n`;

  // srcdoc: refused at the write, wherever it is emitted.
  const FR = `const Fr = <iframe props={ srcdoc: string }></iframe>\n`;
  const SRCDOC = {
    var: `<Fr srcdoc=it.d/>`,
    expr: `<Fr srcdoc=\${it.d}/>`,
    call: `<Fr srcdoc=f(it.d)/>`,
    upper: `<Fr SRCDOC=\${it.d}/>`,
  };
  for (const [pos, wrap] of Object.entries(ROW)) {
    for (const [name, el] of Object.entries(SRCDOC)) {
      test(`declared srcdoc ${name} @ ${pos} → E-ATTR-INTERP-EXECUTABLE, never written`, () => {
        const def = name === "upper" ? `const Fr = <iframe props={ SRCDOC: string }></iframe>\n` : FR;
        const { codes, client } = compile(`decl-srcdoc-${name}-${pos}`, page(def, wrap(el)));
        expect(codes).toContain("E-ATTR-INTERP-EXECUTABLE");
        expect(client).not.toMatch(/setAttribute\("(srcdoc|SRCDOC)",/);
      });
    }
  }

  // on…: wired as a listener (each and lift alike), never written as handler text.
  const ONS = {
    onClickVar: [`const Btn = <button props={ onClick: string }>b</button>\n`, `<Btn onClick=it.code/>`, "click"],
    onClickExpr: [`const Btn = <button props={ onClick: string }>b</button>\n`, `<Btn onClick=\${it.code}/>`, "click"],
    upperVar: [`const Btn = <button props={ ONCLICK: string }>b</button>\n`, `<Btn ONCLICK=it.code/>`, "click"],
    upperExpr: [`const Btn = <button props={ ONCLICK: string }>b</button>\n`, `<Btn ONCLICK=\${it.code}/>`, "click"],
    mixedVar: [`const Btn = <button props={ Onclick: string }>b</button>\n`, `<Btn Onclick=it.code/>`, "click"],
    mixedExpr: [`const Btn = <button props={ Onclick: string }>b</button>\n`, `<Btn Onclick=\${it.code}/>`, "click"],
    customVar: [`const Btn = <button props={ onPick: string }>b</button>\n`, `<Btn onPick=it.code/>`, "pick"],
    customExpr: [`const Btn = <button props={ onPick: string }>b</button>\n`, `<Btn onPick=\${it.code}/>`, "pick"],
  };
  for (const [pos, wrap] of Object.entries(ROW)) {
    for (const [name, [def, el, ev]] of Object.entries(ONS)) {
      test(`declared ${name} @ ${pos} → a "${ev}" listener, no handler text`, () => {
        const { codes, client } = compile(`decl-on-${name}-${pos}`.toLowerCase(), page(def, wrap(el)));
        expect(codes).toEqual([]);
        expect(client).toContain(`.addEventListener(${JSON.stringify(ev)}, `);
        expect(client).not.toMatch(/setAttribute\("on[A-Za-z]|setAttribute\("O[Nn]/);
      });
    }
  }

  test("a URL-valued declared prop (`<Link href=it.url/>`) is still written, through the guard", () => {
    const def = `const Link = <a props={ href: string }>l</a>\n`;
    for (const [pos, wrap] of Object.entries(ROW)) {
      const { codes, client } = compile(`decl-href-${pos}`, page(def, wrap(`<Link href=it.url/>`)));
      expect(codes).toEqual([]);
      const writes = client.split("\n").filter((l) => l.includes('setAttribute("href",'));
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) expect(w).toContain('_scrml_safe_url(');
    }
  });

  test("a non-sink declared prop (`title`) is still written onto the root", () => {
    const def = `const Tip = <span props={ title: string }>t</span>\n`;
    for (const [pos, wrap] of Object.entries(ROW)) {
      const { codes, client } = compile(`decl-title-${pos}`, page(def, wrap(`<Tip title=it.t/>`)));
      expect(codes).toEqual([]);
      expect(client).toContain('setAttribute("title", ');
    }
  });

  test("trucking load-new.scrml compiles; its declared `onAddressInput=` props are listeners, not handler text", () => {
    const file = join(import.meta.dir, "../../../examples/23-trucking-dispatch/pages/dispatch/load-new.scrml");
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
    let client = "";
    (result.outputs ?? new Map()).forEach((o) => { client += (o && o.clientJs) || ""; });
    expect(client.length).toBeGreaterThan(0);
    expect(client).not.toMatch(/setAttribute\("on[A-Za-z]/);
    expect(client).toContain('.addEventListener("addressinput", ');
    // Non-sink declared props are written as before.
    expect(client).toContain('setAttribute("addressValue", ');
  });
});

describe("§9 codegen refusals of two distinct elements are two reports", () => {
  test("two `<button ONCLICK=${…}>` → two E-ATTR-INTERP-EXECUTABLE", () => {
    const { codes } = compile("two-onclick", `<program>\n<c> = "x"\n<button ONCLICK=\${@c}>1</button>\n<button ONCLICK=\${@c}>2</button>\n</program>\n`);
    expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE").length).toBe(2);
  });
  test("two `<iframe srcdoc=${…}>` in one `<match>` arm → two (the re-parsed arm copy is not a third)", () => {
    const { codes } = compile("two-srcdoc-arm", POS.match((x) => `<iframe srcdoc=\${${x}}></iframe>\n    <iframe srcdoc=\${${x}}></iframe>`));
    expect(codes.filter((c) => c === "E-ATTR-INTERP-EXECUTABLE").length).toBe(2);
  });
});
