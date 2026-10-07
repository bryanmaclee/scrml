/**
 * S456 ruling "your recs on 1 and 2" — SPEC §5.2 executable-sink rule: a QUOTED attribute whose `${…}`
 * lands in text the browser EXECUTES is refused (E-ATTR-INTERP-EXECUTABLE):
 *   (1) an event-handler attribute (`on…`, any case) — everywhere;
 *   (2) a URL-valued attribute whose literal value begins with a scheme other than
 *       http / https / mailto / tel; and `srcdoc`.
 *
 * §1 the one reader (`classifyInterpolatedAttrSink` / `readLiteralUrlScheme`) as a unit;
 * §2 every markup position (top level, component body, component with a reactive read,
 *    slot content, `<each>` row, engine state-child, `<match>` arm, `for … lift`) through
 *    the real pipeline; §3 the controls that stay admitted.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import {
  classifyInterpolatedAttrSink,
  readLiteralUrlScheme,
  isEventHandlerAttrNameFailClosed,
} from "../../src/attr-injection-sink.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CODE = "E-ATTR-INTERP-EXECUTABLE";
const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compile(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `s456-attr-sink-${name}-`));
  _dirs.push(dir);
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const cj = join(dist, `${name}.client.js`);
  const client = existsSync(cj) ? readFileSync(cj, "utf8") : "";
  const refusals = (result.errors ?? []).filter((d) => d.code === CODE);
  return { result, client, refusals };
}

// ---------------------------------------------------------------------------
// §1 — the one reader
// ---------------------------------------------------------------------------

describe("§1 classifyInterpolatedAttrSink — the shared reader", () => {
  test("no `${` → never a sink, whatever the attribute", () => {
    expect(classifyInterpolatedAttrSink("onclick", "go(1)")).toBeNull();
    expect(classifyInterpolatedAttrSink("href", "javascript:go(1)")).toBeNull();
    expect(classifyInterpolatedAttrSink("srcdoc", "<b>x</b>")).toBeNull();
  });

  test("event-handler names are case-insensitive and fail closed (any `on…`)", () => {
    for (const n of ["onclick", "ONCLICK", "OnClick", "oNcLiCk", "on:click", "onserver:msg", "onclient:x", "onwhatever"]) {
      expect(classifyInterpolatedAttrSink(n, "go('${x}')")).toEqual({ kind: "event-handler" });
    }
    expect(isEventHandlerAttrNameFailClosed("on")).toBe(false);
    expect(isEventHandlerAttrNameFailClosed("open")).toBe(false);
  });

  test("srcdoc with `${` is a sink in any case", () => {
    expect(classifyInterpolatedAttrSink("srcdoc", "<p>${x}</p>")).toEqual({ kind: "srcdoc" });
    expect(classifyInterpolatedAttrSink("SRCDOC", "${x}")).toEqual({ kind: "srcdoc" });
  });

  test("scheme-led URL attributes: non-safe literal schemes refused", () => {
    const cases = [
      ["href", "javascript:go('${x}')", "javascript"],
      ["href", "JaVaScRiPt:go('${x}')", "javascript"],
      ["href", " javascript:go('${x}')", "javascript"],
      ["href", "\u0001\n javascript:go('${x}')", "javascript"],
      ["href", "java\tscript:go('${x}')", "javascript"],
      ["href", "java\nscr\ript:go('${x}')", "javascript"],
      ["href", "vbscript:go(${x})", "vbscript"],
      ["src", "data:text/html,<b>${x}</b>", "data"],
      ["action", "javascript:${x}", "javascript"],
      ["formaction", "javascript:${x}", "javascript"],
      ["xlink:href", "javascript:${x}", "javascript"],
      ["XLINK:HREF", "javascript:${x}", "javascript"],
      ["data", "data:text/html,${x}", "data"],
      ["href", "blob:${x}", "blob"],
      ["href", "ftp://h/${x}", "ftp"],
    ];
    for (const [n, v, scheme] of cases) {
      expect(classifyInterpolatedAttrSink(n, v)).toEqual({ kind: "url-scheme", scheme });
    }
  });

  test("an escape or character reference before the scheme ends is unprovable → refused", () => {
    expect(classifyInterpolatedAttrSink("href", "java\\tscript:go('${x}')")?.kind).toBe("url-unprovable");
    expect(classifyInterpolatedAttrSink("href", "\\x6aavascript:go('${x}')")?.kind).toBe("url-unprovable");
    expect(classifyInterpolatedAttrSink("href", "&#106;avascript:go('${x}')")?.kind).toBe("url-unprovable");
  });

  test("admitted: relative paths, safe literal schemes, no literal scheme, non-URL attributes", () => {
    for (const v of ["/users/${x}", "?q=${x}", "#${x}", "users/${x}", "https://x.example/${x}",
      "HTTP://x/${x}", "mailto:${x}", "tel:${x}", "${x}", "java${x}", "/a?b=1&c=${x}", "a b:${x}"]) {
      expect(classifyInterpolatedAttrSink("href", v)).toBeNull();
    }
    expect(classifyInterpolatedAttrSink("title", "javascript:${x}")).toBeNull();
    expect(classifyInterpolatedAttrSink("class", "javascript:${x}")).toBeNull();
  });

  test("readLiteralUrlScheme reads only the literal prefix", () => {
    expect(readLiteralUrlScheme("")).toEqual({ kind: "none" });
    expect(readLiteralUrlScheme("/x:y")).toEqual({ kind: "none" });
    expect(readLiteralUrlScheme("Mailto:")).toEqual({ kind: "scheme", scheme: "mailto" });
    expect(readLiteralUrlScheme("1abc:")).toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// §2 — every markup position, through the pipeline
// ---------------------------------------------------------------------------

const POS = {
  top: (el) => `<program>
<nm> = "a"
\${ function go(n) { log(n) } }
${el("@nm")}
</program>
`,
  component: (el) => `<program>
\${ function go(n) { log(n) } }
const Btn = <span props={ label: string }>${el("label")}</span>
<Btn label="a"/>
</program>
`,
  componentReactive: (el) => `<program>
<nm> = "a"
\${ function go(n) { log(n) } }
const Btn = <span props={ label: string }>${el("@nm")}</span>
<Btn label="a"/>
</program>
`,
  unusedComponent: (el) => `<program>
<nm> = "a"
\${ function go(n) { log(n) } }
const Btn = <span>${el("@nm")}</span>
<p>no use</p>
</program>
`,
  slot: (el) => `<program>
<nm> = "a"
\${ function go(n) { log(n) } }
const Wrap = <div class="w">\${children}</div>
<Wrap>${el("@nm")}</Wrap>
</program>
`,
  each: (el) => `<program>
<items> = [{ name: "a" }]
\${ function go(n) { log(n) } }
<ul>
  <each in=@items as it>
    <li>${el("it.name")}</li>
  </each>
</ul>
</program>
`,
  engine: (el) => `\${
  type Light:enum = { Green, Red }
  function go(n) { log(n) }
}
<nm> = "a"
<engine for=Light initial=.Green>
  <Green rule=.Red>
    ${el("@nm")}
  </>
  <Red rule=.Green></>
</>
<program>
<p>\${@light}</p>
</program>
`,
  match: (el) => `\${
  type Phase:enum = { Idle, Ready }
  <phase>: Phase = .Idle
  <nm> = "a"
  function go(n) { log(n) }
}
<match for=Phase on=@phase>
  <Idle>
    ${el("@nm")}
  </>
  <Ready><p>r</p></>
</match>
`,
  forLift: (el) => `<program>
<items> = [{ name: "a" }]
\${ function go(n) { log(n) } }
<ul>
\${ for (const it of @items) { lift ${el("it.name")} } }
</ul>
</program>
`,
};

const SHAPES = {
  onclick: (x) => `<button onclick="go('\${${x}}')">b</button>`,
  ONCLICK: (x) => `<button ONCLICK="go('\${${x}}')">b</button>`,
  hrefJs: (x) => `<a href="javascript:go('\${${x}}')">a</a>`,
  srcData: (x) => `<iframe src="data:text/html,<b>\${${x}}</b>"></iframe>`,
  srcdoc: (x) => `<iframe srcdoc="<b>\${${x}}</b>"></iframe>`,
};

describe("§2 refused at every markup position, exactly once, no interpolated setAttribute", () => {
  for (const [pname, mk] of Object.entries(POS)) {
    for (const [sname, el] of Object.entries(SHAPES)) {
      test(`${sname} @ ${pname}`, () => {
        const { refusals, client } = compile(`${sname}-${pname}`.toLowerCase(), mk(el));
        expect(refusals.length).toBe(1);
        expect(refusals[0].severity).toBe("error");
        if (pname === "each") {
          // The `<each>` row lowering's backstop (same reader) refused the lowering too.
          expect(client).not.toMatch(/setAttribute\("(onclick|ONCLICK|href|src|srcdoc)", `/);
        }
      });
    }
  }

  test("the event-handler message names both data-passing forms", () => {
    const { refusals } = compile("msg", POS.top(SHAPES.onclick));
    expect(refusals[0].message).toContain("JavaScript is never built from interpolated text");
    expect(refusals[0].message).toContain("onclick=f(x)");
    expect(refusals[0].message).toContain("onclick=${() => f(x)}");
  });

  test("a component definition is reported at the definition, naming the component", () => {
    const { refusals } = compile("compmsg", POS.component(SHAPES.hrefJs));
    expect(refusals[0].message).toContain("in component `Btn`");
    expect(refusals[0].message).toContain("`javascript:`");
  });
});

// ---------------------------------------------------------------------------
// §3 — controls stay admitted
// ---------------------------------------------------------------------------

describe("§3 admitted controls", () => {
  const CONTROLS = {
    staticHandler: () => `<button onclick="go(1)">b</button>`,
    relative: (x) => `<a href="/users/\${${x}}">a</a>`,
    httpsPath: (x) => `<a href="https://x.example/u/\${${x}}">a</a>`,
    mailto: (x) => `<a href="mailto:\${${x}}">a</a>`,
    wholeUrl: (x) => `<a href="\${${x}}">a</a>`,
    title: (x) => `<b title="javascript:\${${x}}">t</b>`,
  };
  for (const [pname, mk] of Object.entries(POS)) {
    for (const [cname, el] of Object.entries(CONTROLS)) {
      test(`${cname} @ ${pname}`, () => {
        const { refusals } = compile(`c-${cname}-${pname}`.toLowerCase(), mk(el));
        expect(refusals.length).toBe(0);
      });
    }
  }

  test("top-level relative + https + mailto interpolate into setAttribute as before", () => {
    const { result, client } = compile("ctl", `<program>
<id> = 7
<a href="/users/\${@id}">r</a>
<a href="https://x.example/\${@id}">h</a>
<a href="mailto:\${@id}">m</a>
</program>
`);
    expect(result.errors ?? []).toEqual([]);
    expect(client).toContain('setAttribute("href", `/users/');
    expect(client).toContain('setAttribute("href", `https://x.example/');
    expect(client).toContain('setAttribute("href", `mailto:');
  });
});
