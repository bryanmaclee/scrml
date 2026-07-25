/**
 * g-each-inline-prop-member.browser.test.js — regression gate for
 * g-each-inline-component-prop-member-unsubstituted (HIGH, S201) +
 * g-inlined-component-root-class-interp-raw (MED case-c, S200).
 * Authority: scrml-support/docs/deep-dives/each-inline-component-architecture-2026-06-17.md
 * (Approach B — patch the CE markup-attr substitution + the loop-emitter ${} lowering).
 *
 * Bug (the board's flagship shape): a `<each>`/`${for…lift}` rendering a cross-file
 * component (LoadCard) whose body renders ANOTHER (transitive) component
 * (LoadStatusBadge) and binds one of its OWN props as a MEMBER-ACCESS arg
 * (`<LoadStatusBadge status=load.status/>`) left `load`/`status` UNSUBSTITUTED.
 * The for-arg is `l`, so `load`/`status` were undefined at runtime:
 *   - `<each>` path → loud `E-SCOPE-001` over the inlined body (compile FAILS).
 *   - `${for…lift}` path → compiles clean (`node --check` OK) but ships a bare
 *     `load`/`status` → silent runtime `ReferenceError`.
 * ALSO (case-c): the inlined component root's `${}` attr interpolations
 * (`href="/x/${load.id}"`, root `class="pill ${cls(status)}"`) shipped RAW
 * (the literal `${…}` text, not the computed value).
 *
 * Fix — two layers:
 *   LAYER 1 (component-expander.ts substituteProps): substitute a component's own
 *   prop when it is the leading identifier of a member-access in a markup attr
 *   value (variable-ref member-name, string-literal ${} interp, no-exprNode expr)
 *   + source the class-merge base from the POST-substitution node. OUTER-FIRST
 *   walkAndExpand cascades load->l then transitive Badge status->load.status->l.status.
 *   LAYER 2 (emit-lift.js / emit-each.ts): lower ${} interpolation inside a
 *   string-literal attr value into a template literal (was JSON.stringify'd raw),
 *   live-keyed per item — closes the case-c root-class/href RAW emit.
 *
 * This gate asserts the substituted emit SHAPE + a happy-dom render of the
 * board-shape (nested component + member-arg prop + root-class/href interp), in
 * BOTH the `<each>` and `${for…lift}` forms (both share the CE root; for-lift is
 * the live-shipped board form, each is the canonical S130 form).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

// Transitive inner component — a status pill whose ROOT class carries a ${}
// interp referencing its OWN prop `status` (the case-c shape: g-inlined-
// component-root-class-interp-raw). `cls(status)` computes the pill colour.
const BADGE = `\${
    export fn cls(status: string) -> string {
        if (status == "hot") return "red"
        return "grey"
    }
    export fn label(status: string) -> string {
        if (status == "hot") return "HOT"
        return "cold"
    }

    export const Badge = <span class="pill \${cls(status)}" props={ status: string }>
        \${label(status)}
    </>
}
`;

// Middle component — binds its OWN prop `row` as (1) a root markup-attr ${} interp
// (`href="/x/${row.id}"`), (2) a nested-component MEMBER-ACCESS arg
// (`<Badge status=row.status/>`), (3) a per-item `if=` predicate (`row.weight is some`).
const CARD = `\${
    import { Badge } from './badge.scrml'

    export const Card = <a class="card" props={ row: asIs } href="/x/\${row.id}">
        <Badge status=row.status/>
        <span if=(row.weight is some) class="w">\${row.weight}</span>
    </>
}
`;

// `${for…lift}` form — the live-shipped board form. Pre-fix: compiles, but
// row/status unsubstituted → silent runtime ReferenceError + raw ${} in href/class.
const PAGE_FORLIFT = `<program>
\${
    import { Card } from './card.scrml'
}
<rows>: asIs[] = []
<div>
    \${
        for (let l of @rows) {
            lift <div><Card row=l/></div>
        }
    }
</div>
</program>
`;

// `<each>` form — the canonical S130 form. Pre-fix: E-SCOPE-001 on `row`/`status`.
const PAGE_EACH = `<program>
\${
    import { Card } from './card.scrml'
}
<rows>: asIs[] = []
<div>
    <each in=@rows as l>
        <div><Card row=l/></div>
    </each>
</div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-each-inline-prop-member");

function compileCase(pageSrc) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const pagePath = resolve(tmpDir, "page.scrml");
  const cardPath = resolve(tmpDir, "card.scrml");
  const badgePath = resolve(tmpDir, "badge.scrml");
  writeFileSync(pagePath, pageSrc);
  writeFileSync(cardPath, CARD);
  writeFileSync(badgePath, BADGE);
  try {
    const result = compileScrml({ inputFiles: [pagePath, cardPath, badgePath], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "page.html")),
      clientJs: read(resolve(outDir, "page.client.js")),
      cardJs: read(resolve(outDir, "card.client.js")),
      badgeJs: read(resolve(outDir, "badge.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — compile + substituted-emit-shape regression (FAILS pre-fix)
// ---------------------------------------------------------------------------

describe("g-each-inline-prop-member §1 — prop member-access base substituted in markup attrs", () => {
  test("`<each>` page compiles with no errors (pre-fix: E-SCOPE-001 on `row`)", () => {
    const { errors } = compileCase(PAGE_EACH);
    const scope = errors.filter((e) => e.code === "E-SCOPE-001");
    expect(scope).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("for-lift page compiles with no errors", () => {
    expect(compileCase(PAGE_FORLIFT).errors).toEqual([]);
  });

  for (const [form, page] of [["for-lift", PAGE_FORLIFT], ["each", PAGE_EACH]]) {
    test(`${form}: the nested-component member-arg substitutes the prop base (l.status, not row/status)`, () => {
      const { clientJs } = compileCase(page);
      // The Badge's `status=row.status` member-arg AND its inlined ${label(status)}
      // body resolve to the iter var: `l.status`.
      expect(clientJs).toContain("l.status");
      // No BARE unsubstituted prop name leaks into the loop body.
      expect(/setAttribute\("status",\s*row\b/.test(clientJs)).toBe(false);
      expect(/\blabel\(status\)/.test(clientJs)).toBe(false);
      expect(/\bcls\(status\)/.test(clientJs)).toBe(false);
    });

    test(`${form}: root href ${"${}"} interp lowered to a template literal (not raw, base substituted)`, () => {
      const { clientJs } = compileCase(page);
      // The raw `${row.id}` must NOT survive in a setAttribute string argument.
      expect(/setAttribute\("href",\s*"[^"]*\$\{/.test(clientJs)).toBe(false);
      // Lowered to a template literal evaluating l.id.
      expect(/setAttribute\("href",\s*`[^`]*\$\{l\.id\}/.test(clientJs)).toBe(true);
    });

    test(`${form}: inlined root class ${"${}"} interp lowered + status base substituted (case-c)`, () => {
      const { clientJs } = compileCase(page);
      // No raw `${cls(status)}` literal in a setAttribute string.
      expect(/setAttribute\("class",\s*"[^"]*\$\{/.test(clientJs)).toBe(false);
      // Lowered to a template literal calling cls(l.status).
      expect(/setAttribute\("class",\s*`[^`]*\$\{cls\(l\.status\)\}/.test(clientJs)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive (NO ReferenceError + cards render correctly)
// ---------------------------------------------------------------------------

describe("g-each-inline-prop-member §2 — board-shape renders at runtime (both forms)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  function mount(page) {
    const { html, clientJs, cardJs, badgeJs, runtimeJs } = compileCase(page);
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    // Script order: runtime -> badge -> card -> page (shared `var _scrml_modules`).
    const exec = new Function("window", "document",
      `${runtimeJs}\n${badgeJs}\n${cardJs}\n${clientJs}\n` +
      `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;`);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    if (globalThis.__set__) {
      // BUG-6: key the bare-global write through the page chunk's token.
      globalThis.__set__(chunkCellKey(clientJs)("rows"), [
        { id: 1, status: "hot", weight: 100 },
        { id: 2, status: "cold", weight: 200 },
      ]);
    }
    console.error = origErr;
    return { errs };
  }

  for (const [form, page] of [["for-lift", PAGE_FORLIFT], ["each", PAGE_EACH]]) {
    test(`${form}: populating @rows renders cards with NO ReferenceError`, () => {
      const { errs } = mount(page);
      const refErrors = errs.filter((e) => /ReferenceError|is not defined|scrml effect error/.test(e));
      expect(refErrors).toEqual([]);
      // Both cards present, each linking to its row id (href ${} evaluated).
      const links = document.querySelectorAll("a.card");
      expect(links.length).toBe(2);
      expect(links[0].getAttribute("href")).toBe("/x/1");
      expect(links[1].getAttribute("href")).toBe("/x/2");
      // Badge pill computed its colour from the substituted status (case-c).
      const pills = document.querySelectorAll("span.pill");
      expect(pills.length).toBe(2);
      expect(pills[0].getAttribute("class")).toContain("red");   // status "hot" -> cls "red"
      expect(pills[1].getAttribute("class")).toContain("grey");  // status "cold" -> cls "grey"
      expect(pills[0].textContent).toContain("HOT");
      expect(pills[1].textContent).toContain("cold");
    });
  }
});
