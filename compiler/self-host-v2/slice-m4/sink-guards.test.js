// sink-guards.test.js — s462-bootstrap-sink-guards: the §5.2 executable-sink
// floor of the bootstrap, compiled from source by the bootstrap front end and
// (runtime half) run in happy-dom against the bootstrap runtime.
//
// The defect this closes (HIGH, Chromium-reproduced S462): `srcdoc=@cell`
// compiled with no diagnostic and wrote the data into the frame (its script
// ran), and `href=@cell` wrote `javascript:…` unguarded (`rt.attr` was a bare
// `setAttribute`) — a click ran it.
//
// Governing text, SPEC §5.2:
//  - rule 3: "Where the scheme of a URL-valued attribute comes from data, the
//    compiler cannot judge it, so the emitted program SHALL judge it on every
//    write." … "(ii) every non-literal value — `href=${expr}`, `href=@cell`
//    where it binds, a call-ref value, a component-substituted value, an
//    `<each>` row's `src=@.img`. The write is judged when the element is built
//    AND on every reactive re-write" … "Any other value SHALL be written as
//    `about:blank` instead, and the write SHALL report once to scrml's logging
//    surface … The report SHALL NOT contain the blocked value" … "The safe sets
//    and the scheme test SHALL be the ones rule 2 uses — one definition, not a
//    second list." … *Element scope* (`data` only on `object`, `action` only on
//    `form`, …).
//  - rule 2, "`srcdoc` in every form (S457)": "A `srcdoc` attribute (any case)
//    on an element whose value is not a static string … SHALL be a compile
//    error (E-ATTR-INTERP-EXECUTABLE)".
//  - rule 2, "Event-handler text from data (S457)": "Where an emitter would
//    instead WRITE an `on…` attribute from data … the write SHALL be a compile
//    error (E-ATTR-INTERP-EXECUTABLE)".
//  - rule 1: a quoted `on…` value with `${…}` is E-ATTR-INTERP-EXECUTABLE,
//    "EXCEPT the named non-event words `one`, `online` and `onboarding` …
//    The three exempt words are ordinary attributes".

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors, click } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Run `fn` with console.error captured; returns the captured lines. */
async function capturingErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.error = orig; }
  return lines;
}

const URL_PROGRAM = `type Row:struct = { id: int, url: string }

<lnk u:string>
</>
renders <a class="lnk" href=u>l</a>

<program>
    let <bad:string="javascript:alert(1)"/>
    let <good:string="/ok?a=1"/>
    let <pic:string="data:image/png;base64,AAAA"/>
    let <u:string="/start"/>
    let <spaced:string="  JaVaScRiPt:alert(4)"/>
    let <set:string="/a.png 1x, javascript:alert(5) 2x"/>
    let <list:string="/a;javascript:alert(2)"/>
    let <animated:string="fill"/>
    <rows:Row[]=([{ id: 1, url: "JaVaScRiPt:alert(3)" }, { id: 2, url: "https://example.com/" }])/>
    function flip() { @u = "vbscript:x" }

    <main>
        <a id="e" href=@bad>bound</a>
        <a id="g" href=@good>safe</a>
        <a id="p" href=(@good + "#top")>expression</a>
        <img id="i" src=@pic/>
        <a id="h" href=@pic>raster data on href</a>
        <a id="d" href=@u>reactive</a>
        <a id="sp" href=@spaced>leading space, mixed case</a>
        <a id="up" HREF=@bad>upper-case name</a>
        <img id="ss" srcset=@set/>
        <form id="f" action=@bad></form>
        <object id="ob" data=@bad></object>
        <div id="dv" data=@bad></div>
        <button id="flip" onclick=flip()>flip</button>
        <ul>
            <each in=@rows key=@.id as row>
                <li><a class="row" href=row.url>row</a></li>
            </each>
        </ul>
        <lnk u="javascript:alert(6)"/>
        <lnk u="/fine"/>
        <svg>
            <a href="/x"><set id="s1" attributeName="href" to=@bad/><text>s1</text></a>
            <rect width="1" height="1"><set id="s2" attributeName="fill" to=@bad/></rect>
            <a href="/x"><animate id="s3" attributeName="xlink:href" values=@list/><text>s3</text></a>
            <rect width="1" height="1"><set id="s4" attributeName=@animated to=@bad/></rect>
            <rect width="1" height="1"><set id="s5" attributeName=@animated to=@good/></rect>
        </svg>
    </main>
</program>
`;

describe("§5.2 rule 3 — every bound URL attribute is judged at runtime (one guard: impl#1's runtime-url-guard.js)", () => {
  let errors;
  beforeAll(async () => {
    errors = await capturingErrors(async () => {
      await loadProgram(clean(URL_PROGRAM), "sink-urls", []);
      click($("#flip"));
    });
  }, { timeout: 120000 });

  test("`href=@cell` holding `javascript:` is written as about:blank (it was written verbatim)", () => {
    expect($("#e").getAttribute("href")).toBe("about:blank");
  });
  test("a relative URL and a parenthesized expression are written unchanged", () => {
    expect($("#g").getAttribute("href")).toBe("/ok?a=1");
    expect($("#p").getAttribute("href")).toBe("/ok?a=1#top");
  });
  test("a raster data:image is admitted on an image source, refused on href", () => {
    expect($("#i").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect($("#h").getAttribute("href")).toBe("about:blank");
  });
  test("a reactive re-write is judged too (`/start` → `vbscript:x`)", () => {
    expect($("#d").getAttribute("href")).toBe("about:blank");
  });
  test("leading spaces and mixed case are read as the URL parser reads them", () => {
    expect($("#sp").getAttribute("href")).toBe("about:blank");
  });
  test("the attribute name is matched case-insensitively (`HREF=`)", () => {
    expect($("#up").getAttribute("href")).toBe("about:blank");
  });
  test("srcset judges every candidate URL", () => {
    expect($("#ss").getAttribute("srcset")).toBe("about:blank");
  });
  test("element scope: `action` on <form> and `data` on <object> are URLs; `data` on <div> is not", () => {
    expect($("#f").getAttribute("action")).toBe("about:blank");
    expect($("#ob").getAttribute("data")).toBe("about:blank");
    expect($("#dv").getAttribute("data")).toBe("javascript:alert(1)");
  });
  test("an <each> row's bound href is judged per row", () => {
    expect($$("a.row").map((a) => a.getAttribute("href"))).toEqual(["about:blank", "https://example.com/"]);
  });
  test("a value a declaration's field supplies is judged where the body writes it", () => {
    expect($$("a.lnk").map((a) => a.getAttribute("href"))).toEqual(["about:blank", "/fine"]);
  });
  test("SVG animation values: a static URL target, a non-URL target, `values` per entry, a computed target", () => {
    expect($("#s1").getAttribute("to")).toBe("about:blank");
    expect($("#s2").getAttribute("to")).toBe("javascript:alert(1)");
    expect($("#s3").getAttribute("values")).toBe("about:blank");
    expect($("#s4").getAttribute("to")).toBe("about:blank");
    expect($("#s5").getAttribute("to")).toBe("/ok?a=1");
  });
  test("every refusal reports once, naming the attribute — never the value", () => {
    // e, h, d (initial `/start` admitted; the re-write refused), sp, up, ss, f, ob, row 1, lnk 1, s1, s3, s4
    expect(errors.length).toBe(13);
    for (const line of errors) {
      expect(line).toContain("[scrml url-guard]");
      expect(line).toContain("about:blank");
      expect(line).not.toContain("alert(");
      expect(line).not.toContain("vbscript:x");
    }
  });
});

describe("the guard is not a style rule: `style=@s` is written as bound (impl#1 parity — §5.2 names no style sink)", () => {
  test("style=@cell is written unchanged", async () => {
    const src = `<program>
    let <s:string="color: red"/>
    <p id="st" style=@s>x</p>
</program>
`;
    await loadProgram(clean(src), "sink-style", []);
    expect($("#st").getAttribute("style")).toBe("color: red");
  });
});

describe("§5.2 rule 2 — `srcdoc` from data is a compile error in every form", () => {
  const prog = (body, extra = "") => `${extra}<program>
    let <doc:string="<script>parent.pwned = 1</script>"/>
    <pages:Page[]=([{ id: 1, html: "hello" }])/>
    <main>
${body}
    </main>
</program>
`;
  const PAGE = "type Page:struct = { id: int, html: string }\n";
  const one = (body, extra = "") => {
    const cs = codes(prog(body, PAGE + extra));
    expect(cs).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  };
  test("`srcdoc=@cell` (the S462 reproduction)", () => one(`        <iframe srcdoc=@doc></iframe>`));
  test("`SRCDOC=(…)` — any case, the expression form", () => one(`        <iframe SRCDOC=(@doc + "")></iframe>`));
  test("an <each> row's `srcdoc=row.html`", () => one(`        <each in=@pages key=@.id as pg><iframe srcdoc=pg.html></iframe></each>`));
  test("a declaration's field reaching `srcdoc` — once, at the definition, however many uses", () => {
    one(`        <frame d="a"/>\n        <frame d="b"/>`, `<frame d:string>\n</>\nrenders <iframe srcdoc=d></iframe>\n\n`);
  });
  test("the quoted `srcdoc=\"…${…}…\"` form: E-ATTR-INTERP-EXECUTABLE, not the reactive-template refusal", () => {
    one(`        <iframe srcdoc="<p>\${@doc}</p>"></iframe>`);
  });
  test("a static `srcdoc` is written as the author wrote it", async () => {
    const src = prog(`        <iframe id="fr" srcdoc="<p>static</p>"></iframe>`, PAGE);
    await loadProgram(clean(src), "sink-srcdoc-static", []);
    expect($("#fr").getAttribute("srcdoc")).toBe("<p>static</p>");
  });
});

describe("§5.2 rules 1–2 — handler text is never built from data", () => {
  const prog = (body) => `<program>
    let <code:string="alert(1)"/>
    function go(s: string) { @code = s }
    <main>
${body}
    </main>
</program>
`;
  test("a quoted `onclick=\"…${…}…\"`: E-ATTR-INTERP-EXECUTABLE (once)", () => {
    expect(codes(prog(`        <button onclick="go(\${@code})">x</button>`))).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  });
  test("a case variant with an expression value (`ONCLICK=(@code)`) would write handler text: refused once", () => {
    expect(codes(prog(`        <button ONCLICK=(@code)>x</button>`))).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  });
  test("a case variant with a handler form (`ONCLICK=go(\"y\")`, which impl#1 wires) stays the case-variant refusal", () => {
    const cs = codes(prog(`        <button ONCLICK=go("y")>x</button>`));
    expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(cs).not.toContain("E-ATTR-INTERP-EXECUTABLE");
  });
  test("a case variant with a quoted `${…}`: reported once (the parser), not twice", () => {
    expect(codes(prog(`        <button onClick="go(\${@code})">x</button>`))).toEqual(["E-ATTR-INTERP-EXECUTABLE"]);
  });
  test("a lowercase `on…` with a data value is wired as a listener, never written", async () => {
    const src = prog(`        <button id="b" onclick=go("y")>x</button>\n        <p id="c">\${@code}</p>`);
    await loadProgram(clean(src), "sink-on-listener", []);
    expect($("#b").hasAttribute("onclick")).toBe(false);
    click($("#b"));
    expect($("#c").textContent).toBe("y");
  });
  test("`one`, `online`, `onboarding` are ordinary attributes (exact whole names), not handlers", async () => {
    const src = prog(`        <div id="w" online=@code one="1" onboarding="yes"></div>`);
    await loadProgram(clean(src), "sink-on-words", []);
    expect($("#w").getAttribute("online")).toBe("alert(1)");
    expect($("#w").getAttribute("one")).toBe("1");
    expect($("#w").getAttribute("onboarding")).toBe("yes");
  });
});
