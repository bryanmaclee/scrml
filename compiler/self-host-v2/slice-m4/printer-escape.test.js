// printer-escape.test.js: the bootstrap printer (html.scrml) never prints a
// value that can end a raw-text or RCDATA element.
//
// The defect (S462 review, reproduced in Chromium): `escAttr` escaped only `&`
// and `"`. A view prints as <template> content, and that HTML is parsed again
// when the template is cloned. Inside a raw-text or RCDATA element (`noscript`
// with scripting on, `xmp`, `noembed`, `iframe`; `title` is RCDATA), the
// parser does not see attributes. It looks only for the element's closer. So
//   <noscript><p title="</noscript><script>window.pwned=1</script>">x</p></noscript>
// ended the `<noscript>` inside the attribute value, and the `<script>` ran
// (pwned=1). The same breakout worked through xmp, noembed, iframe and title.
// The fix: escAttr also escapes `<` → `&lt;` and `>` → `&gt;`. escText already
// escaped all three, and the text forms are pinned here too.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import "../slice-m1/load-program.js"; // registers happy-dom (DOMParser)

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const ELEMENTS = ["noscript", "xmp", "noembed", "iframe", "title"];
const PAYLOAD = (tag) => `</${tag}><script>window.pwned=1</script>`;

function printed(src) {
  const r = frontEnd(mods, [{ path: "c.scrml", src }]);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  return mods.print.printProgram(r.core, "c.client.js", "scrml-runtime.js").html;
}

/** The printed HTML with the shell's own runtime/client <script src=…> tags removed. */
const authored = (html) => html.replace(/<script src="[^"]*"><\/script>/g, "");

describe("escAttr: an attribute value cannot spell a closer", () => {
  test("`<` and `>` are escaped, along with `&` and `\"`", () => {
    expect(mods.html.escAttr(`a<b>c&d"e`)).toBe("a&lt;b&gt;c&amp;d&quot;e");
  });
  test("`&` is escaped first, so an existing entity is not double-read", () => {
    expect(mods.html.escAttr("&lt;")).toBe("&amp;lt;");
  });
  for (const tag of ELEMENTS) {
    test(`<${tag}> holding <p title="${PAYLOAD(tag)}">: the printed page has no script element and no early closer`, () => {
      const html = printed(`<program>\n    <${tag}><p title="${PAYLOAD(tag)}">x</p></${tag}>\n</program>\n`);
      const page = authored(html);
      expect(page).not.toContain("<script>");
      expect(page).not.toContain(`</${tag}><script`);
      expect(page).toContain(`title="&lt;/${tag}&gt;&lt;script&gt;window.pwned=1&lt;/script&gt;"`);
    });
  }
  test("the value round-trips: the DOM reads back the author's text", () => {
    const html = printed(`<program>\n    <div><p id="t" title="a<b>&c">x</p></div>\n</program>\n`);
    const doc = new DOMParser().parseFromString(authored(html), "text/html");
    const tpl = [...doc.querySelectorAll("template")].map((t) => t.content.querySelector("#t")).find((e) => e);
    expect(tpl.getAttribute("title")).toBe("a<b>&c");
  });
});

describe("escText: text in a raw-text or RCDATA element cannot spell a closer either", () => {
  test("`<`, `>` and `&` are escaped", () => {
    expect(mods.html.escText(PAYLOAD("noscript"))).toBe("&lt;/noscript&gt;&lt;script&gt;window.pwned=1&lt;/script&gt;");
  });
  for (const tag of ELEMENTS) {
    test(`<${tag}> holding a text closer: no script element is printed`, () => {
      const html = printed(`<program>\n    <${tag}>\${"${PAYLOAD(tag)}"}</${tag}>\n</program>\n`);
      const page = authored(html);
      expect(page).not.toContain("<script>");
      expect(page).not.toContain(`</${tag}><script`);
    });
  }
});
