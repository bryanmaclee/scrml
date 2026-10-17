// static-executable.test.js — s468-bootstrap-failopen-gaps: SPEC §5.2 "Static
// executable values (S464)" in the bootstrap, and the `{…}` value on a
// non-handler attribute.
//
// Governing text, SPEC §5.2:
//  - "Two static attribute values (no `${…}`) the browser runs without scrml
//    checking them SHALL each be a compile error (E-ATTR-STATIC-EXECUTABLE),
//    reported once per emitted attribute, in every position rule 2 below names
//    … on every code path that writes an attribute into output (fail closed):
//    1. Any static `srcdoc` (any case) … A bare `<iframe srcdoc>` (no value) …
//    stays legal. 2. A static navigate / load attribute whose scheme is not
//    admitted … The schemes are rule 2's fail-closed ALLOW-list, read by the
//    same scheme reader (one definition)."
//  - "A component call's prop is not an element attribute (judged where the
//    component writes it)."
//  - §5.2.4: "A `(…)`, `{…}` or `${…}` value of an attribute that is not an
//    event handler … SHALL be exactly one expression"; rule 2 "`srcdoc` in
//    every form": a `srcdoc` whose value is not a static string is
//    E-ATTR-INTERP-EXECUTABLE.
//
// The gaps: g-bootstrap-static-executable-values-not-refused-s464 (a static
// `srcdoc` and `href="javascript:…"` were written as the author wrote them;
// impl#1 refuses both) and the braced half of
// g-bootstrap-braced-nonhandler-value-and-quoted-handler-silently-empty-s462
// (`srcdoc={@doc}` / `href={@bad}` lowered to `attr=""`, no diagnostic).
//
// "One definition": the bootstrap compiler's reader is url.scrml, a scrml
// transcription of impl#1's compiler/src/runtime-url-guard.js. The first block
// below runs BOTH over the same inputs and requires the same answer, and the
// second requires the bootstrap's element-level verdict to equal impl#1's
// `classifyStaticExecutableAttr` over a grid of elements, attributes and
// values — a drift between the two implementations fails here.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";
import * as guard from "../../src/runtime-url-guard.js";
import { classifyStaticExecutableAttr, STATIC_NAV_LOAD_URL_ATTRS, IMAGE_LINK_REL_TOKENS } from "../../src/attr-injection-sink.ts";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "s.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const SE = "E-ATTR-STATIC-EXECUTABLE";
const P = (main, decls = "", before = "") => `${before}<program>
    let <an:string="href"/>
${decls}
    <main>
${main}
    </main>
</program>
`;
const $ = (sel) => document.querySelector(sel);

const URL_TEXTS = [
  "", "/x", "x.html", "//host/p", "#frag", "?q=1", "https://a.example/", "HTTP://A", "ftp://f", "mailto:a@b.c",
  "tel:+1", "sms:1", "javascript:alert(1)", "  JaVaScRiPt:alert(2)", "java\tscript:x", "java\nscript:x",
  "\u0001javascript:x", "vbscript:msgbox", "data:text/html,<b>x</b>", "data:image/png;base64,AAAA",
  "data:image/svg+xml,<svg/>", "data:image/PNG ,x", "data:image/png", "data:,", "webcal:x", "geo:1,2",
  "blob:https://a/x", "x:y", "1x:y", "a+b.c-d:z", "javascript&colon;x", "/a.png 1x, javascript:x 2x",
  "a.png, b.png 2x", "a.png,, javascript:x", "img.png (x, y) 1x, data:text/html,z", "/ok /ok2", "/ok javascript:x",
  "/a,javascript:x", "values;javascript:x", "/a;/b",
];

describe("url.scrml IS runtime-url-guard.js — the same answer on every input (one definition)", () => {
  test("the sets are the same lists", () => {
    const u = mods.url;
    expect(u.urlValuedAttrs()).toEqual([...guard._SCRML_URL_VALUED_ATTRS]);
    for (const n of guard._SCRML_URL_VALUED_ATTRS) {
      const scope = Object.prototype.hasOwnProperty.call(guard._SCRML_URL_ATTR_ELEMENTS, n) ? guard._SCRML_URL_ATTR_ELEMENTS[n] : [];
      expect(u.urlAttrElements(n)).toEqual(scope);
    }
    expect(u.safeUrlSchemes()).toEqual([...guard._SCRML_SAFE_URL_SCHEMES]);
    expect(u.safeDataImageTypes()).toEqual([...guard._SCRML_SAFE_DATA_IMAGE_TYPES]);
    expect(u.imageSourceAttrs()).toEqual([...guard._SCRML_IMAGE_SOURCE_ATTRS]);
    expect(u.animationElements()).toEqual([...guard._SCRML_SVG_ANIMATION_ELEMENTS]);
    expect(u.animationValueAttrs()).toEqual([...guard._SCRML_SVG_ANIMATION_VALUE_ATTRS]);
    expect(u.staticNavLoadAttrs()).toEqual([...STATIC_NAV_LOAD_URL_ATTRS]);
    expect(u.imageLinkRelTokens()).toEqual([...IMAGE_LINK_REL_TOKENS]);
  });
  test("the scheme reader", () => {
    for (const t of URL_TEXTS) {
      const want = guard._scrml_read_url_scheme(t, false);
      const got = mods.url.readUrlScheme(t);
      expect([t, got.kind]).toEqual([t, want.kind]);
      if (want.kind === "scheme") expect([t, got.scheme, got.rest]).toEqual([t, want.scheme, want.rest]);
    }
  });
  test("the raster data:image test and the scheme admission", () => {
    for (const rest of ["image/png;base64,A", "image/png,", " image/GIF ;x", "image/svg+xml,x", "image/png", "text/html,x", ",", ""]) {
      expect([rest, mods.url.dataUrlIsRasterImage(rest)]).toEqual([rest, guard._scrml_data_url_is_raster_image(rest)]);
      for (const name of ["src", "href", "srcset", "poster", "background"]) {
        for (const scheme of ["data", "http", "javascript", "blob"]) {
          expect([name, scheme, rest, mods.url.urlSchemeAdmitted(name, scheme, rest)])
            .toEqual([name, scheme, rest, guard._scrml_url_scheme_admitted(name, scheme, rest)]);
        }
      }
    }
  });
  test("every URL attribute × every text (srcset / ping / archive lists included), and the element scoping", () => {
    const names = [...guard._SCRML_URL_VALUED_ATTRS, "title", "SRC", "Href"];
    for (const name of names) {
      for (const t of URL_TEXTS) {
        expect([name, t, mods.url.urlValueAdmitted(name, t)]).toEqual([name, t, guard._scrml_url_value_admitted(name, t)]);
      }
      for (const tag of ["", "a", "img", "form", "object", "div", "link", "video", "source", "button", "input", "td", "IMG"]) {
        expect([tag, name, mods.url.isUrlAttr(tag, name)]).toEqual([tag, name, guard._scrml_is_url_attr(tag, name)]);
      }
    }
  });
  test("animation values (`values` per `;` entry; a computed target \"\")", () => {
    for (const lower of ["to", "from", "by", "values"]) {
      for (const target of ["href", "src", "xlink:href", ""]) {
        for (const t of URL_TEXTS) {
          expect([lower, target, t, mods.url.animationValueAdmitted(lower, t, target)])
            .toEqual([lower, target, t, guard._scrml_animation_value_admitted(lower, t, target)]);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The element-level verdict, against impl#1's classifyStaticExecutableAttr.
// Each case is one element in one program; the bootstrap's
// E-ATTR-STATIC-EXECUTABLE spans are mapped back to the attribute.
// ---------------------------------------------------------------------------
const ATTR_VALUES = [
  "/x", "https://a/", "mailto:a@b", "javascript:alert(1)", " JaVaScRiPt:x", "vbscript:x", "data:text/html,x",
  "data:image/png;base64,AA", "data:image/svg+xml,x", "data:,", "webcal:x", "/a.png 1x, javascript:x 2x", "/ok javascript:x",
];
const HTML_CASES = [];
for (const [tag, names, extra] of [
  ["a", ["href", "ping", "HREF", "usemap", "itemid", "cite", "title", "data", "action"], ""],
  ["img", ["src", "srcset", "dynsrc", "lowsrc", "usemap", "longdesc"], ""],
  ["iframe", ["src"], ""],
  ["form", ["action"], ""],
  ["button", ["formaction"], ""],
  ["object", ["data", "archive", "codebase", "classid"], ""],
  ["div", ["data", "action", "background", "icon"], ""],
  ["video", ["poster", "src"], ""],
  ["link", ["href", "imagesrcset"], ` rel="icon"`],
  ["link", ["href"], ` rel="shortcut icon"`],
  ["link", ["href"], ` rel="stylesheet icon"`],
  ["link", ["href"], ` rel="x-icon"`],
  ["td", ["background"], ""],
]) {
  for (const name of names) for (const value of ATTR_VALUES) HTML_CASES.push({ tag, name, value, extra });
}

const VOID = new Set(["img", "link", "source", "input"]);

function relOf(extra) {
  const m = / rel="([^"]*)"/.exec(extra);
  return m ? [{ name: "rel", value: m[1] }] : [];
}

describe("the element-level verdict equals impl#1's classifyStaticExecutableAttr", () => {
  test(`HTML elements: ${HTML_CASES.length} element × attribute × value cases`, () => {
    let main = "";
    let src = P("@@MAIN@@");
    const at = [];
    const head = src.indexOf("@@MAIN@@");
    for (const c of HTML_CASES) {
      const open = `        <${c.tag}${c.extra} `;
      const attrStart = head + main.length + open.length;
      main += VOID.has(c.tag) ? `${open}${c.name}="${c.value}"/>\n` : `${open}${c.name}="${c.value}">x</${c.tag}>\n`;
      at.push({ ...c, attrStart });
    }
    src = src.replace("@@MAIN@@", main);
    const r = run(src);
    expect(r.parseDiags).toEqual([]);
    const refused = new Set(r.diags.filter((d) => d.code === SE).map((d) => d.span.start));
    const mismatches = [];
    for (const c of at) {
      const want = classifyStaticExecutableAttr(c.name, c.value, { tag: c.tag, attrs: [...relOf(c.extra), { name: c.name, value: c.value }] }) !== null;
      const got = refused.has(c.attrStart);
      if (want !== got) mismatches.push(`<${c.tag}${c.extra} ${c.name}="${c.value}">: impl#1 ${want ? "refuses" : "admits"}, bootstrap ${got ? "refuses" : "admits"}`);
    }
    expect(mismatches).toEqual([]);
    // and nothing else was refused
    expect(refused.size).toBe(at.filter((c) => classifyStaticExecutableAttr(c.name, c.value, { tag: c.tag, attrs: [...relOf(c.extra), { name: c.name, value: c.value }] }) !== null).length);
  });

  test("SVG animation values: a static / computed `attributeName`, `values` per entry, inside `<image>` (with and without its own `href`)", () => {
    const cases = [];
    for (const parent of ["a", "image", "g"]) {
      for (const anim of ["set", "animate", "animateTransform"]) {
        for (const [an, anAttrs] of [["href", `attributeName="href"`], ["fill", `attributeName="fill"`], ["", "attributeName=@an"], ["src", `attributeName=" SRC "`]]) {
          for (const [vn, vv] of [["to", "javascript:x"], ["to", "/ok"], ["to", "data:image/png,AA"], ["values", "/a;javascript:x"], ["values", "/a;/b"], ["from", "vbscript:x"], ["by", "https://x/"]]) {
            for (const own of ["", ` href="#t"`]) cases.push({ parent, anim, an, anAttrs, vn, vv, own });
          }
        }
      }
    }
    let main = "";
    let src = P("@@MAIN@@");
    const head = src.indexOf("@@MAIN@@");
    const at = [];
    for (const c of cases) {
      const open = `        <svg><${c.parent}><${c.anim} ${c.anAttrs}${c.own} `;
      at.push({ ...c, attrStart: head + main.length + open.length });
      main += `${open}${c.vn}="${c.vv}"/></${c.parent}></svg>\n`;
    }
    src = src.replace("@@MAIN@@", main);
    const r = run(src);
    expect(r.parseDiags).toEqual([]);
    const refused = new Set(r.diags.filter((d) => d.code === SE).map((d) => d.span.start));
    const mismatches = [];
    for (const c of at) {
      const anAttr = c.an === "" ? { name: "attributeName", value: { kind: "variable-ref", name: "@an" } } : { name: "attributeName", value: c.anAttrs.slice(15, -1) };
      const attrs = [anAttr, ...(c.own ? [{ name: "href", value: "#t" }] : []), { name: c.vn, value: c.vv }];
      const want = classifyStaticExecutableAttr(c.vn, c.vv, { tag: c.anim, attrs, parentTag: c.parent }) !== null;
      const got = refused.has(c.attrStart);
      if (want !== got) mismatches.push(`<${c.parent}><${c.anim} ${c.anAttrs}${c.own} ${c.vn}="${c.vv}">: impl#1 ${want ? "refuses" : "admits"}, bootstrap ${got ? "refuses" : "admits"}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe("§5.2 (S464) — the two static families, positions, and what stays legal", () => {
  test("the gap's reproduction: a static `srcdoc` and `href=\"javascript:…\"` (written as the author wrote them) → refused, once each", () => {
    const r = run(P(`        <iframe srcdoc="<p>static</p>"></iframe>\n        <a href="javascript:alert(1)">j</a>\n        <a href="/fine">ok</a>`));
    expect(r.diags.map((d) => d.code)).toEqual([SE, SE]);
    expect(r.diags[0].message).toContain("`srcdoc=\"…\"` attribute on `<iframe>`");
    expect(r.diags[0].message).toContain("§5.2");
    expect(r.diags[1].message).toContain("(`javascript:`) is not admitted");
  });
  test("`srcdoc` in any case, and an empty static value — refused; a bare `<iframe srcdoc>` stays legal", () => {
    expect(codes(P(`        <iframe SRCDOC="x"></iframe>\n        <iframe srcdoc=""></iframe>`))).toEqual([SE, SE]);
    clean(P(`        <iframe srcdoc></iframe>`));
  });
  test("every position: an `<each>` row, a declaration's renders (once, however many uses), slot content of a use, an `if=` element", () => {
    const decls = [
      `    <rows:Row[]=([{ id: 1 }])/>`,
      `    let <shown:bool=true/>`,
      `    <lnk t:string/>`,
      `    renders <a href="javascript:x">\${t}</a>`,
      `    <box n:string/>`,
      `    renders <div><slot/></div>`,
    ].join("\n");
    const main = [
      `        <each in=@rows key=@.id as r><a href="vbscript:x">row</a></each>`,
      `        <lnk t="a"/>`,
      `        <lnk t="b"/>`,
      `        <box n="1"><a href="javascript:y">slot</a></box>`,
      `        <a if=@shown href="data:text/html,x">cond</a>`,
    ].join("\n");
    const r = run(P(main, decls, "type Row:struct = { id: int }\n"));
    expect(r.diags.map((d) => d.code)).toEqual([SE, SE, SE, SE]);
    // the declaration's renders is reported ONCE (at the definition), not per use
    expect(r.diags.filter((d) => d.message.includes("(`javascript:`)")).length).toBe(2);
  });
  test("a use's own attribute is a prop, not an element attribute — not judged here (§5.2: judged where the component writes it)", () => {
    const decl = `<lnk u:string>\n</>\nrenders <a href=u>l</a>\n\n`;
    clean(P(`        <lnk u="javascript:x"/>`, "", decl));
  });
  test("what stays legal: relative, http(s), mailto, tel, a raster `data:image` where an image loads, metadata URL attributes, an out-of-scope name", async () => {
    const main = [
      `        <a id="r" href="/users/1">r</a>`,
      `        <a id="h" href="https://example.com/">h</a>`,
      `        <a id="m" href="mailto:a@b.c">m</a>`,
      `        <img id="i" src="data:image/png;base64,AAAA"/>`,
      `        <link id="ic" rel="icon" href="data:image/png;base64,AAAA"/>`,
      `        <a id="u" usemap="javascript:x">u</a>`,
      `        <div id="dv" data="javascript:x" action="javascript:x">d</div>`,
      `        <q id="c" cite="javascript:x">c</q>`,
    ].join("\n");
    await loadProgram(clean(P(main)), "static-exec-legal", []);
    expect($("#r").getAttribute("href")).toBe("/users/1");
    expect($("#i").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect($("#dv").getAttribute("data")).toBe("javascript:x");
  });
  test("a raster `data:image` is refused where it is a navigation (`<a href>`), and on `<link rel=\"stylesheet icon\">`", () => {
    expect(codes(P(`        <a href="data:image/png;base64,AA">x</a>\n        <link rel="stylesheet icon" href="data:image/png;base64,AA"/>`))).toEqual([SE, SE]);
  });
});

describe("check.scrml C18 — the Core backstop: no Static attribute is executable text, whatever produced the Core", () => {
  const coreWith = (mutate) => {
    const core = clean(P(`        <a id="x" href="/x">x</a>\n        <iframe id="f" src="/p"></iframe>\n        <svg><image><set attributeName="href" to="/i.png"/></image></svg>`));
    const els = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.variant === "El") els.push(n.data);
      Object.values(n).forEach(walk);
    })(core);
    mutate(els);
    return mods.check.checkCore(core);
  };
  const setStatic = (els, tag, name, value) => {
    const el = els.find((e) => e.tag === tag);
    const a = el.attrs.find((x) => x.variant === "Static" && x.data.name === name);
    if (a) a.data.value = value; else el.attrs.push({ variant: "Static", data: { name, value } });
  };
  test("a lowered clean program passes C18", () => {
    expect(coreWith(() => {})).toEqual([]);
  });
  test("a `javascript:` href, a static srcdoc and a static handler name planted in Core → C18 each", () => {
    const out = coreWith((els) => {
      setStatic(els, "a", "href", "javascript:alert(1)");
      setStatic(els, "iframe", "srcdoc", "<script>x</script>");
      setStatic(els, "a", "onclick", "alert(1)");
    });
    expect(out.length).toBe(3);
    for (const line of out) expect(line.startsWith("C18: ")).toBe(true);
    expect(out.some((l) => l.includes("E-ATTR-QUOTED-HANDLER"))).toBe(true);
    expect(out.filter((l) => l.includes("E-ATTR-STATIC-EXECUTABLE")).length).toBe(2);
  });
  test("an animation value: a raster image onto an `<image>`'s href stays legal (parent unknown in Core — never stricter than the refusal); `javascript:` does not", () => {
    expect(coreWith((els) => setStatic(els, "set", "to", "data:image/png;base64,AA"))).toEqual([]);
    expect(coreWith((els) => setStatic(els, "set", "to", "javascript:x")).length).toBe(1);
  });
});

describe("§5.2.4 / §5.2 rule 2 — a `{…}` value on a non-handler attribute is refused, never written as `\"\"`", () => {
  const decls = `    let <doc:string="<p>x</p>"/>\n    let <bad:string="javascript:alert(1)"/>\n    function go() { @bad = "/x" }`;
  test("`srcdoc={@doc}` → E-ATTR-INTERP-EXECUTABLE (data into an HTML document; was `srcdoc=\"\"`)", () => {
    expect(codes(P(`        <iframe srcdoc={@doc}></iframe>`, decls))).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  });
  test("`href={@bad}` and `title={@bad}` → E-BOOTSTRAP-UNSUPPORTED naming the `(…)` form (was `attr=\"\"`, value dropped)", () => {
    const r = run(P(`        <a href={@bad}>a</a>\n        <p title={@bad}>t</p>`, decls));
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toContain("`href=(…)`");
    expect(r.diags[0].message).toContain("§5.2.4");
  });
  test("twins: the `(…)` expression form binds (and is guarded); an inline-block HANDLER `onclick={ … }` is unchanged", async () => {
    await loadProgram(clean(P(`        <a id="b" href=(@bad)>a</a>\n        <button id="g" onclick={ go() }>g</button>`, decls)), "braced-twins", []);
    expect($("#b").getAttribute("href")).toBe("about:blank");
  });
});
