/**
 * Browser (execution) regression — #81 / S268 fix-round finding 1.
 *
 * A reactive value attribute on a COMPONENT ROOT that references a STRING prop
 * (`const Badge = <span title=(label) props={label:string}>`, `<Badge label="hi"/>`)
 * was substituted by the expander into `title=(label)` → lowered `((hi))`, where
 * `hi` is a FREE identifier. At DOMContentLoaded that throws a ReferenceError
 * INSIDE the shared wiring handler, so every UNRELATED binding after it on the
 * page never wires — a whole-page crash (strictly worse than the pre-#81 silent
 * drop). It slips the Acorn PARSE gate because `((hi))` is syntactically valid;
 * only EXECUTION catches the free reference.
 *
 * The S268 fix (emit-html.ts `loweredExprHasFreeIdentifier`, gated to `_expandedFrom`
 * roots) FAILED CLOSED: it dropped the unsafe attribute (W-CG-VALUE-ATTR-COMPONENT-PROP),
 * restoring the pre-#81 no-crash behavior — at the cost of silently losing the title.
 *
 * ⭐ S378-peter — ROOT FIX, supersedes the drop for the STRING-PROP shape.
 * The root cause was in the component expander: a string-literal prop referenced in an
 * `expr`/value attr was spliced as its BARE value (`label`->`hi`) rather than the quoted
 * JS literal, via a raw-text rewrite. `component-expander.ts` now routes a string-prop
 * expr attr through the structured, §42-aware parser + node-level substitution, so
 * `title=(label)` with `label="hi"` lowers to `title=("hi")` and WIRES correctly instead
 * of being dropped (g-string-prop-in-is-some-lowers-to-bare-identifier-kills-boot). The
 * `loweredExprHasFreeIdentifier` fail-closed guard STAYS as defense-in-depth for cases the
 * root fix does not reach (a non-string free identifier on an expanded root); this shape
 * simply no longer reaches it.
 *
 * This test EXECUTES the bundle (not just Acorn-parses it): mount HTML + run the
 * client bundle + fire DOMContentLoaded, then assert (a) no throw and (b) the
 * unrelated `data-n=(@count)` binding actually wired.
 */
import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

function compile(src, slug) {
  const tmpDir = resolve(testDir, `_tmp_${slug}`);
  const tmpInput = resolve(tmpDir, `${slug}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const r = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), log: () => {} });
    let html = null, clientJs = null;
    for (const [fp, o] of r.outputs) {
      if (fp.includes(slug)) { html = o.html ?? null; clientJs = o.clientJs ?? null; }
    }
    return { errors: r.errors ?? [], warnings: r.warnings ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Mount the emitted HTML + run the bundle + fire DOMContentLoaded. */
function mountAndRun(html, clientJs) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = cleanHtml;
  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { get: (n) => window._scrml_reactive_get(n), set: (n, v) => window._scrml_reactive_set(n, v) };
}

const REPRO = `<program>
\${ const Badge = <span title=(label) props={ label: string }>badge</> }
<count> = 0
<Badge label="hi"/>
<p data-n=(@count)>n</p>
</program>`;

describe("#81/S268 — component-root string-prop value-attr no longer crashes the page", () => {
  test("title=(label) now WIRES as the quoted literal (S378 root fix) — not dropped, not crashing", () => {
    const r = compile(REPRO, "i81crash-drop");
    expect(r.errors).toEqual([]);
    // S378: the string prop is spliced as the quoted literal, so the attr is SAFE —
    // the fail-closed drop no longer fires.
    expect(r.warnings.map((w) => w.code)).not.toContain("W-CG-VALUE-ATTR-COMPONENT-PROP");
    // The crashing free-identifier form `((hi))` is gone; the quoted literal is emitted.
    expect(r.clientJs).not.toContain("((hi))");
    expect(r.clientJs).toContain('("hi")');
    // The title binding is now WIRED (pre-S378 it was dropped).
    expect(r.html).toContain("data-scrml-bind-attr-title");
    // The unrelated binding survives in the markup.
    expect(r.html).toMatch(/data-scrml-bind-attr-data-n="[^"]+"/);
  });

  test("EXECUTION: DOMContentLoaded runs cleanly and the unrelated data-n=(@count) binding wires", () => {
    const r = compile(REPRO, "i81crash-exec");
    let threw = null;
    let api = null;
    try {
      api = mountAndRun(r.html, r.clientJs);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    // LOAD-BEARING assertion. happy-dom's dispatchEvent SWALLOWS a listener's
    // exception (it does not rethrow to the caller), so `threw` alone cannot
    // prove no-crash. The real dead-page symptom is that the ReferenceError
    // aborts the wiring handler PARTWAY, so every binding AFTER the crash site
    // never wires. This binding is emitted after the (now-dropped) title site;
    // pre-fix it stayed unwired (getAttribute → null). Mutation-verified: with
    // the fix reverted, `data-n` is null here.
    const p = document.querySelector("p");
    expect(p).not.toBeNull();
    expect(p.getAttribute("data-n")).toBe("0");
    // … and it is REACTIVE: updating @count re-writes the attribute.
    api.set("count", 7);
    expect(p.getAttribute("data-n")).toBe("7");
  });
});

/**
 * S378-peter — g-string-prop-in-is-some-lowers-to-bare-identifier-kills-boot.
 *
 * The same root as #81, in a §42-predicate CONDITION rather than a value attr:
 * `<span if=(note is some)>` inside a component with a `note:string` prop, called
 * `<Box note="present"/>`. Pre-fix the expander spliced the string value BARE into the
 * lowered condition — `(present !== null && present !== undefined)` — a ReferenceError
 * that throws in _scrml_boot and kills EVERY later wiring on the page, so an INDEPENDENT
 * `<p id="canary" if=@ok>` never mounts. Post-fix the string prop lowers to the quoted
 * literal `("present" !== null && …)`, the predicate is well-formed, and the whole page
 * boots.
 */
const REPRO_ISSOME = `<program>
const Box = <div props={ note: string }>
    <span if=(note is some)>HAS-NOTE</span>
    <em>always</em>
</div>
<ok> = true
<Box note="present"/>
<p id="canary" if=@ok>CANARY</p>
</program>`;

describe("S378 — a string prop in an `if=(… is some)` condition lowers to the quoted literal, not a bare id", () => {
  test("the emitted condition quotes the string value (no boot-killing free identifier)", () => {
    const r = compile(REPRO_ISSOME, "strprop-issome");
    expect(r.errors).toEqual([]);
    // Quoted literal present; the bare-identifier crash form is gone.
    expect(r.clientJs).toContain('"present" !== null');
    expect(r.clientJs).not.toMatch(/\(present !== null/);
  });

  test("EXECUTION: the independent `if=@ok` canary MOUNTS — boot is not killed", () => {
    const r = compile(REPRO_ISSOME, "strprop-issome-exec");
    let threw = null;
    try {
      mountAndRun(r.html, r.clientJs);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    // LOAD-BEARING: querySelector does NOT descend into <template>.content (a detached
    // fragment in happy-dom), so finding #canary in the live DOM proves it genuinely
    // MOUNTED — the harness-note trap the gap records (a string matched inside an
    // unmounted <template> and read as a false pass) cannot fire here. Pre-fix the boot
    // ReferenceError aborted before this independent block wired → querySelector === null.
    const canary = document.querySelector("#canary");
    expect(canary).not.toBeNull();
    expect(canary.textContent).toContain("CANARY");
  });
});
