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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CODE = "E-ATTR-QUOTED-HANDLER";
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

  test("exempt words and static non-handler strings (href, to) stay static strings", () => {
    const { refusals, html } = compile("exempt", `<program>
<div one="x" online="y" onboarding="z">d</div>
<a href="javascript:void(0)">a</a>
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
