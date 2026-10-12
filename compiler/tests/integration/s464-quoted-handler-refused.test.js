/**
 * S464 ruling — SPEC §5.2 rule 1: a QUOTED event-handler attribute with no `${…}`
 * (`onclick="alert(1)"`) is a compile error (E-ATTR-QUOTED-HANDLER, owner-ruled S464). The
 * browser would run its text as raw JavaScript, unchecked by scrml. The name test is rule 1's
 * (`isExecutableEventHandlerAttrName` — every `on…` name except the exact words `one` /
 * `online` / `onboarding`), the same reader as E-ATTR-INTERP-EXECUTABLE.
 *
 * §1 the predicate; §2 every markup position rule 2 enumerates, through the real pipeline,
 * reported once; §3 admitted controls (unquoted forms, exempt words, static non-handler strings,
 * declared component props, §4.17 raw-content display text).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { isQuotedStaticHandler } from "../../src/attr-injection-sink.ts";
import {
  refuseQuotedHandlerWrite,
  resetRefusedLowerings,
  drainRefusedLowerings,
} from "../../src/codegen/refused-lowering-errors.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CODE = "E-ATTR-QUOTED-HANDLER";
// A static handler attribute in emitted HTML: an `on…` name (not one/online/onboarding) followed by
// a quoted value, as TAG markup (preceded by an opener, not by `&lt;` display text).
const STATIC_HANDLER_IN_HTML = /<[a-zA-Z][^<>]*\s(?!one\b|online\b|onboarding\b)on[a-z:]+\s*=\s*"/i;
// A static handler written by JS: `setAttribute("on…", "<literal>")`.
const STATIC_HANDLER_IN_JS = /setAttribute\(\s*"(?!one"|online"|onboarding")on[^"]*"\s*,\s*"/i;
const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compile(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `s464-qh-${name}-`));
  _dirs.push(dir);
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const read = (ext) => {
    const p = join(dist, `${name}.${ext}`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
  const refusals = all.filter((d) => d.code === CODE);
  return { result, refusals, all, html: read("html"), client: read("client.js") };
}

// ---------------------------------------------------------------------------
// §1 — the predicate
// ---------------------------------------------------------------------------

describe("§1 isQuotedStaticHandler", () => {
  test("every on… name with a value holding no `${` is a quoted static handler", () => {
    for (const n of ["onclick", "ONCLICK", "OnClick", "on:click", "onserver:msg", "onclient:x", "onbegin", "onerror", "onended", "onwhatever"]) {
      expect(isQuotedStaticHandler(n, "alert(1)")).toBe(true);
      expect(isQuotedStaticHandler(n, "")).toBe(true);
    }
  });
  test("exempt words, the bare name `on`, and non-handler names are not", () => {
    for (const n of ["one", "ONE", "online", "onboarding", "on", "title", "href", "open"]) {
      expect(isQuotedStaticHandler(n, "alert(1)")).toBe(false);
    }
  });
  test("a value with `${…}` is E-ATTR-INTERP-EXECUTABLE's, not this rule's", () => {
    expect(isQuotedStaticHandler("onclick", "go('${x}')")).toBe(false);
  });
});

describe("§1b refuseQuotedHandlerWrite — the codegen backstop every attribute writer asks", () => {
  test("refuses (and records once per attribute) a quoted static handler on ANY tag; admits the rest", () => {
    resetRefusedLowerings();
    const attr = { span: { file: "f.scrml", start: 10, end: 30, line: 2, col: 3 } };
    expect(refuseQuotedHandlerWrite("onclick", "pwn()", attr, "button")).toBe(true);
    expect(refuseQuotedHandlerWrite("onclick", "pwn()", attr, "button")).toBe(true); // same attribute again
    // An unexpanded component still built as an element (`createElement("Btn")`) is not exempt.
    expect(refuseQuotedHandlerWrite("ONCLICK", "pwn()", { span: { file: "f.scrml", start: 40, end: 50 } }, "Btn")).toBe(true);
    expect(refuseQuotedHandlerWrite("onclick", "go('${x}')", attr, "button")).toBe(false);
    expect(refuseQuotedHandlerWrite("title", "pwn()", attr, "button")).toBe(false);
    expect(refuseQuotedHandlerWrite("online", "yes", attr, "div")).toBe(false);
    const errs = drainRefusedLowerings();
    expect(errs.map((e) => e.code)).toEqual(["E-ATTR-QUOTED-HANDLER", "E-ATTR-QUOTED-HANDLER"]);
    expect(errs.every((e) => e.severity === "error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — every position, refused once
// ---------------------------------------------------------------------------

const EL = `<button onclick="go(1)">b</button>`;

const POS = {
  top: `<program>
\${ function go(n) { log(n) } }
${EL}
</program>
`,
  component: `<program>
\${ function go(n) { log(n) } }
const Btn = <span props={ label: string }>\${label}${EL}</span>
<Btn label="a"/>
</program>
`,
  unusedComponent: `<program>
\${ function go(n) { log(n) } }
const Btn = <span>${EL}</span>
<p>no use</p>
</program>
`,
  slot: `<program>
\${ function go(n) { log(n) } }
const Wrap = <div class="w">\${children}</div>
<Wrap>${EL}</Wrap>
</program>
`,
  each: `<program>
<items> = [{ name: "a" }]
\${ function go(n) { log(n) } }
<ul>
  <each in=@items as it>
    <li>\${it.name}${EL}</li>
  </each>
</ul>
</program>
`,
  engine: `\${
  type Light:enum = { Green, Red }
  function go(n) { log(n) }
}
<engine for=Light initial=.Green>
  <Green rule=.Red>
    ${EL}
  </>
  <Red rule=.Green></>
</>
<program>
<p>\${@light}</p>
</program>
`,
  match: `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  function go(n) { log(n) }
}
<match for=Phase on=@phase>
  <Idle>
    ${EL}
  </>
  <Ready><p>r</p></>
</match>
`,
  forLift: `<program>
<items> = [{ name: "a" }]
\${ function go(n) { log(n) } }
<ul>
\${ for (const it of @items) { lift <li>\${it.name}${EL}</li> } }
</ul>
</program>
`,
  undeclaredRootAttr: `<program>
\${ function go(n) { log(n) } }
const Btn = <button>b</button>
<Btn onclick="go(1)"/>
</program>
`,
  // Fix round 1 (S239 F1) — a `<match>` arm body is re-parsed in codegen, so VP-3 never sees the
  // rows inside it; the codegen backstop (`refuseQuotedHandlerWrite`) refuses the write.
  eachInMatchArm: `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <items> = [{ name: "a", subs: [1] }]
  <c> = true
  function go(n) { log(n) }
}
const Btn = <button>b</button>
<match for=Phase on=@phase>
  <Idle>
    <ul><each in=@items as it><li>${EL}</li></each></ul>
  </>
  <Ready><p>r</p></>
</match>
`,
  nestedEachInMatchArm: `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <items> = [{ name: "a", subs: [1] }]
  <c> = true
  function go(n) { log(n) }
}
const Btn = <button>b</button>
<match for=Phase on=@phase>
  <Idle>
    <each in=@items as it><div><each in=it.subs as s>${EL}</each></div></each>
  </>
  <Ready><p>r</p></>
</match>
`,
  componentInEachInMatchArm: `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <items> = [{ name: "a", subs: [1] }]
  <c> = true
  function go(n) { log(n) }
}
const Btn = <button>b</button>
<match for=Phase on=@phase>
  <Idle>
    <each in=@items as it><Btn onclick="go(1)"/></each>
  </>
  <Ready><p>r</p></>
</match>
`,
  eachInEngineArm: `\${
  type Light:enum = { Green, Red }
  <items> = [{ name: "a" }]
  function go(n) { log(n) }
}
<engine for=Light initial=.Green>
  <Green rule=.Red>
    <each in=@items as it>${EL}</each>
  </>
  <Red rule=.Green></>
</>
<program>
<p>\${@light}</p>
</program>
`,
  eachInEach: `<program>
<items> = [{ name: "a", subs: [1] }]
\${ function go(n) { log(n) } }
<each in=@items as it>
  <div><each in=it.subs as s>${EL}</each></div>
</each>
</program>
`,
};

describe("§2 refused at every markup position, exactly once", () => {
  for (const [pname, src] of Object.entries(POS)) {
    test(pname, () => {
      const { refusals, html, client } = compile(pname.toLowerCase(), src);
      expect(refusals.length).toBe(1);
      expect(refusals[0].severity ?? "error").toBe("error");
      // Nothing that would run the quoted text is emitted.
      expect(html).not.toContain(`onclick="go(1)"`);
      expect(client).not.toMatch(/setAttribute\("onclick"/);
    });
  }

  test("`^{ emit(…) }` markup: the emit gate refuses every event-handler attribute first (E-META-EVAL-002)", () => {
    // §22.4.1 — emit() output admits a closed attribute list with no `on…` name, so a quoted
    // handler spliced in by ME never reaches the post-ME check; it is still refused, never emitted.
    const { result, html, client } = compile("metaemit", `<program>
\${ function go(n) { log(n) } }
^{ emit("<button onclick=\\"go(1)\\">b</button>") }
</program>
`);
    expect((result.errors ?? []).some((d) => d.code === "E-META-EVAL-002")).toBe(true);
    expect(html).not.toContain(`onclick="go(1)"`);
    expect(client).not.toContain("go(1)");
  });

  test("F1 — every `on…` spelling and an `if=`/`else` pair in a row inside a `<match>` arm: one refusal per attribute", () => {
    const { refusals, client } = compile("matcheachspell", `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <items> = [{ name: "a", subs: [1] }]
  <c> = true
  function go(n) { log(n) }
}
const Btn = <button>b</button>
<match for=Phase on=@phase>
  <Idle>
    <each in=@items as it><button onclick="go(1)" ONCLICK="go(2)" onmouseover="go(3)" onfocus="go(4)">b</button><a if=@c onclick="go(5)">x</a><b else onfocus="go(6)">y</b></each>
  </>
  <Ready><p>r</p></>
</match>
`);
    expect(refusals.length).toBe(6);
    expect(client).not.toMatch(/setAttribute\("on/i);
  });

  test("F2 — a quoted handler on a nested component call in a definition is reported once, at the definition", () => {
    const { refusals } = compile("nestedcomp", `<program>
const Inner = <button>in</button>
const Outer = <div class="o"><Inner onclick="go(1)"/></div>
<Outer/>
<Outer/>
</program>
`);
    expect(refusals.length).toBe(1);
    expect(refusals[0].message).toContain("in component `Outer`");
    expect(refusals[0].message).not.toContain("caller's prop value");
    // Round 2 (review N1): anchored at the ATTRIBUTE as written in Outer's definition.
    expect([refusals[0].span.line, refusals[0].span.col]).toEqual([3, 37]);
  });

  test("N1 — a quoted handler directly in a definition body is anchored at the attribute, multi-line body", () => {
    const { refusals } = compile("deflinecol", `<program>
const Outer = <div class="o">
    <p>pad</p>
    <button onclick="go(1)">b</button>
</div>
<Outer/>
</program>
`);
    expect(refusals.length).toBe(1);
    expect([refusals[0].span.line, refusals[0].span.col]).toEqual([4, 13]);
  });

  test("F3 — markup held by a snippet lambda (an unparsed expression) is judged too, once", () => {
    const { refusals } = compile("sniplambda", `<program>
<items> = [{ name: "a" }]
const List = <ul props={ items: asIs, row: snippet(it: asIs) }>\${ for (const it of items) { lift <li>\${render row(it)}</li> } }</ul>
<List items=@items row={ (x) => <b onclick="go(1)">\${x.name}</b> }/>
</program>
`);
    expect(refusals.length).toBe(1);
    expect(refusals[0].span.line).toBe(4);
  });

  test("the message names the three unquoted forms", () => {
    const { refusals } = compile("msg", POS.top);
    const m = refusals[0].message;
    expect(m).toContain("onclick=fn()");
    expect(m).toContain("onclick={ … }");
    expect(m).toContain("onclick=${…}");
  });

  test("a component definition is reported at the definition, naming the component", () => {
    const { refusals } = compile("compmsg", POS.unusedComponent);
    expect(refusals[0].message).toContain("in component `Btn`");
  });

  test("any case, SVG onbegin, scrml on:/onserver: spellings, empty value — each refused", () => {
    const { refusals } = compile("spellings", `<program>
\${ function go(n) { log(n) } }
<button ONCLICK="go(1)">a</button>
<svg><animate onbegin="go(1)"/></svg>
<button on:click="go(1)">b</button>
<img src="/x.png" onerror="">
</program>
`);
    expect(refusals.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// §3 — admitted controls
// ---------------------------------------------------------------------------

describe("§3 admitted controls", () => {
  test("F3 control — markup TEXT inside a string literal in an expression is not an element", () => {
    const { refusals } = compile("strmarkup", `<program>
<p title=\${"<b onclick=\\"x()\\">"}>t</p>
</program>
`);
    expect(refusals.length).toBe(0);
  });

  test("executed — the unquoted form at every §2 position compiles, and no artifact carries a static `on…=` handler", () => {
    for (const [pname, src] of Object.entries(POS)) {
      const fixed = src.replace(/(on[A-Za-z:]*)="go\(1\)"/g, "$1=go(1)");
      const { html, client, all } = compile(`ok-${pname}`.toLowerCase(), fixed);
      expect(all.filter((d) => d.code === CODE)).toEqual([]);
      expect(html).not.toMatch(STATIC_HANDLER_IN_HTML);
      expect(client).not.toMatch(STATIC_HANDLER_IN_JS);
    }
  });

  test("executed — the built sample corpus (samples/compilation-tests/dist) carries no static `on…=` handler", () => {
    const dist = join(import.meta.dir, "../../../samples/compilation-tests/dist");
    // Populated by `bun run pretest`; a missing corpus is a FAILURE, never a silent pass (review N4).
    expect(existsSync(dist)).toBe(true);
    const hits = [];
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(html|js)$/.test(n) && !/runtime/.test(n)) {
          const t = readFileSync(p, "utf8");
          if (STATIC_HANDLER_IN_HTML.test(t) || STATIC_HANDLER_IN_JS.test(t)) hits.push(p);
        }
      }
    };
    walk(dist);
    expect(hits).toEqual([]);
  });

  test("the unquoted handler forms compile clean", () => {
    const { refusals, result } = compile("unquoted", `<program>
<n> = 0
\${ function go(k) { @n = @n + k } }
<button onclick=go(1)>a</button>
<button onclick={ go(1); go(2) }>b</button>
<button onclick=\${() => go(3)}>c</button>
<p>\${@n}</p>
</program>
`);
    expect(refusals.length).toBe(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("exempt words and static non-handler strings (an admitted href, a non-URL `to`) stay static strings", () => {
    const { refusals, html } = compile("exempt", `<program>
<div one="x" online="y" onboarding="z">d</div>
<a href="/docs">a</a>
<svg><set attributeName="fill" to="red"/></svg>
</program>
`);
    expect(refusals.length).toBe(0);
    expect(html).toContain(`one="x"`);
  });

  test("a DECLARED component prop named like a handler is a prop, not an element attribute", () => {
    const { refusals } = compile("declprop", `<program>
const Tag = <span props={ onboard: string, onclick: string }>\${onclick}</span>
<Tag onboard="a" onclick="b"/>
</program>
`);
    expect(refusals.length).toBe(0);
  });

  test("§4.17 raw-content display text holding `onclick=\"…\"` / `onerror=\"…\"` is text, not an attribute", () => {
    const { refusals, html } = compile("raw", `<program>
<pre><button onclick="alert(1)">x</button></pre>
<code><img src=x onerror="alert(2)"></code>
</program>
`);
    expect(refusals.length).toBe(0);
    expect(html).toContain("onclick=");
  });
});

// ---------------------------------------------------------------------------
// Round 2 (review N2) — markup TEXT in an unparsed expression is read as markup
// ---------------------------------------------------------------------------

describe("N2 — text before the attribute (apostrophe, quote, backtick, //) does not hide it", () => {
  const lam = (body) => `<program>\n<items> = [{ name: "a" }]\nconst List = <ul props={ items: asIs, row: snippet(it: asIs) }>\${ for (const it of items) { lift <li>\${render row(it)}</li> } }</ul>\n<List items=@items row={ (x) => ${body} }/>\n</program>\n`;
  const SHAPES = {
    apos1: `<span><b>don't</b><i onclick="go(1)">y</i></span>`,
    apos2: `<span><b>it's</b><i onclick="go(1)">y</i><b>that's</b></span>`,
    txtdq: `<span>say "hi <i onclick="go(1)">y</i></span>`,
    txtbt: "<span>use ` here <i onclick=\"go(1)\">y</i></span>",
    txtcomment: `<span>see a // b <i onclick="go(1)">y</i></span>`,
    backtickValue: "<b onclick=`go(1)`>a</b>",
  };
  for (const [name, body] of Object.entries(SHAPES)) {
    test(name, () => {
      const { refusals } = compile(`n2-${name}`.toLowerCase(), lam(body));
      expect(refusals.length).toBe(1);
    });
  }
  test("an interpolated handler in lambda markup is E-ATTR-INTERP-EXECUTABLE", () => {
    const { all } = compile("n2-interp", lam("<b onclick=\"go(${x.name})\">${x.name}</b>"));
    expect(all.filter((d) => d.code === "E-ATTR-INTERP-EXECUTABLE").length).toBe(1);
  });
  test("controls: a handler-looking string in a title, a template literal, a comment, text — not elements", () => {
    for (const [i, body] of [
      `<b title="<b onclick='x()'>">\${x.name}</b>`,
      "<b>\${ `<i onclick=\"go(1)\">` }</b>",
      `<b>\${ /* <i onclick="go(1)"> */ x.name}</b>`,
      `<b>call onclick="go(1)" later</b>`,
    ].entries()) {
      const { refusals, all } = compile(`n2-ctl${i}`, lam(body));
      expect(refusals.length).toBe(0);
      expect(all.filter((d) => /^E-ATTR-(STATIC|INTERP)-EXECUTABLE$/.test(d.code))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Round 2 — S464 "(a) Refuse both": static executable values (E-ATTR-STATIC-EXECUTABLE)
// ---------------------------------------------------------------------------

describe("S464 (a) — a static srcdoc / a static URL with an unadmitted scheme is E-ATTR-STATIC-EXECUTABLE", () => {
  const SE = "E-ATTR-STATIC-EXECUTABLE";
  const se = (r) => r.all.filter((d) => d.code === SE);
  const MATCH = (el) => `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <items> = [{ name: "a" }]
}
<match for=Phase on=@phase>
  <Idle>
    <each in=@items as it>${el}</each>
  </>
  <Ready><p>r</p></>
</match>
`;
  const POS2 = {
    top: (el) => `<program>\n${el}\n</program>\n`,
    componentDef: (el) => `<program>\nconst C = <div>${el}</div>\n<C/>\n<C/>\n</program>\n`,
    each: (el) => `<program>\n<items> = [{ name: "a" }]\n<each in=@items as it>${el}</each>\n</program>\n`,
    eachInMatchArm: MATCH,
    forLift: (el) => `<program>\n<items> = [1]\n<ul>\${ for (const it of @items) { lift <li>${el}</li> } }</ul>\n</program>\n`,
    snippetLambda: (el) => `<program>\n<items> = [{ name: "a" }]\nconst List = <ul props={ items: asIs, row: snippet(it: asIs) }>\${ for (const it of items) { lift <li>\${render row(it)}</li> } }</ul>\n<List items=@items row={ (x) => <span>${el}</span> }/>\n</program>\n`,
  };
  const SHAPES2 = {
    hrefJs: `<a href="javascript:doThing()">a</a>`,
    hrefVb: `<a href="VBScript:x">a</a>`,
    iframeDataHtml: `<iframe src="data:text/html,hi"></iframe>`,
    srcdoc: `<iframe srcdoc="<p>x</p>"></iframe>`,
    svgSet: `<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>`,
    srcsetCandidate: `<img src="/a.png" srcset="/a.png 1x, javascript:x 2x">`,
  };
  for (const [pname, mk] of Object.entries(POS2)) {
    for (const [sname, el] of Object.entries(SHAPES2)) {
      test(`${sname} @ ${pname}`, () => {
        const r = compile(`se-${sname}-${pname}`.toLowerCase(), mk(el));
        expect(se(r).length).toBe(1);
        expect(r.html + r.client).not.toMatch(/javascript:|vbscript:|data:text\/html|srcdoc="/i);
      });
    }
  }
  test("admitted: relative, https, mailto, raster data:image on an image source, `data` on a non-object element, a non-URL `to`", () => {
    const r = compile("se-ok", `<program>
<a href="/docs">a</a>
<a href="https://x.example/p">b</a>
<a href="mailto:a@b.c">c</a>
<a href="">d</a>
<img src="data:image/png;base64,AAAA">
<div data="javascript:x">e</div>
<svg><set attributeName="fill" to="red"/></svg>
</program>
`);
    expect(se(r)).toEqual([]);
    expect(r.result.errors ?? []).toEqual([]);
  });
  test("an <md> destination is judged once, by E-MD-URL-SCHEME (not twice)", () => {
    const r = compile("se-md", `<program>\n<div>\n    <md>\n        [click](javascript:alert(1))\n    </md>\n</div>\n</program>\n`);
    expect(se(r)).toEqual([]);
    expect(r.all.filter((d) => d.code === "E-MD-URL-SCHEME").length).toBe(1);
  });
});
