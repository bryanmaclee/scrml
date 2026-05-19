/**
 * §41.16 (S105) — tableFor end-to-end integration tests.
 *
 * These tests compile real .scrml fixtures through the full pipeline and
 * inspect the emitted HTML + JS for the expected shape of tableFor output.
 * Where the unit tests cover validator surface code-by-code, these tests
 * cover the cross-cutting integration: AST splice + downstream stages + emit.
 *
 *   §1 — End-to-end <table> + <thead> + <tbody> shape.
 *   §2 — Selection wiring: master + per-row checkboxes target declared cell.
 *   §3 — Sort surface: click handlers + sortedBy state write.
 *   §4 — Pick/omit change column emit order.
 *   §5 — Column slot override replaces <td> body; default-rendering otherwise.
 *   §6 — Composed surfaces (pick + sortable + selectable on one tableFor).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "table-for-integration-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({
    inputFiles: [abs],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
  });
}

function getHtml(result) {
  for (const [, v] of (result.outputs || [])) {
    if (typeof v === "object" && v && v.html) return v.html;
  }
  return "";
}

function getClientJs(result) {
  for (const [, v] of (result.outputs || [])) {
    if (typeof v === "object" && v && v.clientJs) return v.clientJs;
  }
  return "";
}

function realErrors(result) {
  return (result.errors || []).filter(e => e && e.severity !== "warning");
}

// ---------------------------------------------------------------------------
// §1 — End-to-end <table>+<thead>+<tbody> shape
// ---------------------------------------------------------------------------

describe("§1 end-to-end shape", () => {
  test("canonical example compiles + emits well-formed <table>", () => {
    const result = compile("e2e-basic.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Task:struct = {
    id:        integer
    title:     string req
    completed: boolean
  }
}
<program>
  <tasks> = []
  <tableFor for=Task rows=@tasks/>
</program>
`);
    expect(realErrors(result).filter(e => e.code?.startsWith("E-TABLEFOR-"))).toEqual([]);
    const html = getHtml(result);
    expect(html).toContain("<table");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    // <thead> contains a <tr> with three <th> (id, title, completed).
    const theadMatch = html.match(/<thead>(.*?)<\/thead>/s);
    expect(theadMatch).toBeTruthy();
    // Use [\\s>] after `th` to exclude `<thead>` itself from the count.
    const ths = (theadMatch[1].match(/<th[\s>]/g) || []).length;
    expect(ths).toBe(3);
  });

  test("client JS uses _scrml_reconcile_list with row PK keying", () => {
    const result = compile("e2e-reconcile.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Task:struct = {
    id:    integer
    title: string req
  }
}
<program>
  <tasks> = []
  <tableFor for=Task rows=@tasks/>
</program>
`);
    const js = getClientJs(result);
    expect(js).toContain("_scrml_reconcile_list");
    expect(js).toContain('_scrml_reactive_get("tasks")');
    // Keyed reconciliation uses row.id when available.
    expect(js).toMatch(/item\?\.id\s*!=\s*null/);
  });

  test("emitted output is canonical scrml — Pillar 5 invariant", () => {
    // The expanded markup should look like hand-authored scrml. We verify by
    // checking for the data-scrml-tablefor attribute (synth marker) — there
    // should be NO opaque _scrml_tablefor_* JS helpers; everything rides on
    // standard scrml primitives.
    const result = compile("e2e-pillar5.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows/>
</program>
`);
    const js = getClientJs(result);
    // NO new runtime hooks beyond what's already in the runtime.
    expect(js).not.toMatch(/_scrml_tablefor_/);
    // YES — standard scrml primitives.
    expect(js).toContain("_scrml_reactive_get");
    expect(js).toContain("_scrml_reconcile_list");
  });
});

// ---------------------------------------------------------------------------
// §2 — Selection wiring
// ---------------------------------------------------------------------------

describe("§2 selection wiring", () => {
  test("selectable= wires master checkbox to declared @cell", () => {
    const result = compile("e2e-select-master.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = []
  <selectedIds>: integer[] = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain('data-scrml-tablefor-master="selectedIds"');
  });

  test("selectable= wires per-row checkbox with row PK", () => {
    const result = compile("e2e-select-row.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <users> = []
  <selectedIds>: integer[] = []
  <tableFor for=User rows=@users selectable=@selectedIds/>
</program>
`);
    const js = getClientJs(result);
    // Per-row checkbox writes selectedIds via reactive_set.
    expect(js).toContain('_scrml_reactive_set("selectedIds"');
    // Checkbox uses row.id as the PK.
    expect(js).toContain("row.id");
  });

  test("selectedBy= override changes the PK field used", () => {
    const result = compile("e2e-select-by.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    email: string req
    name:  string req
  }
}
<program>
  <users> = []
  <selectedEmails>: string[] = []
  <tableFor for=User rows=@users selectable=@selectedEmails selectedBy="email"/>
</program>
`);
    const js = getClientJs(result);
    // PK should be row.email — the selectedBy override.
    expect(js).toContain("row.email");
  });
});

// ---------------------------------------------------------------------------
// §3 — Sort surface
// ---------------------------------------------------------------------------

describe("§3 sort surface", () => {
  test("sortable column emits onclick handler on <th>", () => {
    const result = compile("e2e-sort-th.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="name" sortable/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toMatch(/data-scrml-bind-onclick=/);
    expect(html).toMatch(/data-scrml-tablefor-sortable="name"/);
  });

  test("non-sortable column does NOT emit click handler", () => {
    const result = compile("e2e-no-sort.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="name"/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    // Should not have data-scrml-tablefor-sortable for the name field.
    expect(html).not.toContain('data-scrml-tablefor-sortable="name"');
  });

  test("sort click handler writes sortedBy on the rows cell", () => {
    const result = compile("e2e-sort-writes.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="name" sortable/>
  </tableFor>
</program>
`);
    const js = getClientJs(result);
    expect(js).toContain("sortedBy");
    expect(js).toContain("rows");  // the rows cell name
  });
});

// ---------------------------------------------------------------------------
// §4 — Pick/omit column ordering
// ---------------------------------------------------------------------------

describe("§4 pick/omit ordering", () => {
  test("pick array order drives column emit order", () => {
    const result = compile("e2e-pick-order.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    alpha: string req
    beta:  string req
    gamma: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows pick=["gamma", "alpha"]/>
</program>
`);
    const html = getHtml(result);
    const gammaIdx = html.indexOf(">Gamma<");
    const alphaIdx = html.indexOf(">Alpha<");
    const betaIdx = html.indexOf(">Beta<");
    expect(gammaIdx).toBeGreaterThan(0);
    expect(alphaIdx).toBeGreaterThan(gammaIdx);  // alpha comes AFTER gamma per pick order
    expect(betaIdx).toBe(-1);  // beta excluded
  });

  test("omit preserves struct declaration order with exclusions", () => {
    const result = compile("e2e-omit-order.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    alpha: string req
    beta:  string req
    gamma: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows omit=["beta"]/>
</program>
`);
    const html = getHtml(result);
    const alphaIdx = html.indexOf(">Alpha<");
    const gammaIdx = html.indexOf(">Gamma<");
    const betaIdx = html.indexOf(">Beta<");
    expect(alphaIdx).toBeGreaterThan(0);
    expect(gammaIdx).toBeGreaterThan(alphaIdx);
    expect(betaIdx).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// §5 — Column slot override
// ---------------------------------------------------------------------------

describe("§5 column slot override", () => {
  test("non-empty <column> body replaces default cell rendering", () => {
    const result = compile("e2e-slot-override.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Item:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items>
    <column field="name">
      <strong>\${row.name}</strong>
    </column>
  </tableFor>
</program>
`);
    const js = getClientJs(result);
    // The override emits <strong> markup.
    expect(js).toContain("strong");
    expect(js).toContain("row.name");
  });

  test("empty <column> uses default cell rendering", () => {
    const result = compile("e2e-slot-default.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Item:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <items> = []
  <tableFor for=Item rows=@items>
    <column field="name"/>
  </tableFor>
</program>
`);
    const js = getClientJs(result);
    // Default: bare ${row.name} text interpolation inside <td>.
    expect(js).toContain("row.name");
  });
});

// ---------------------------------------------------------------------------
// §6 — Composed surfaces
// ---------------------------------------------------------------------------

describe("§6 composed surfaces", () => {
  test("pick + sortable + selectable compose on one tableFor", () => {
    const result = compile("e2e-composed.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
    name:  string req
    role:  string req
  }
}
<program>
  <users> = []
  <selectedIds>: integer[] = []
  <tableFor for=User rows=@users
            pick=["email", "name", "role"]
            selectable=@selectedIds>
    <column field="email" sortable/>
    <column field="name" sortable/>
    <column field="role"/>
  </tableFor>
</program>
`);
    expect(realErrors(result).filter(e => e.code?.startsWith("E-TABLEFOR-"))).toEqual([]);
    const html = getHtml(result);
    // Selectable wired:
    expect(html).toContain('data-scrml-tablefor-master="selectedIds"');
    // Sortable on email + name:
    expect(html).toContain('data-scrml-tablefor-sortable="email"');
    expect(html).toContain('data-scrml-tablefor-sortable="name"');
    // Role NOT sortable:
    expect(html).not.toContain('data-scrml-tablefor-sortable="role"');
    // ID NOT in column emit (pick excludes it):
    expect(html).not.toContain(">Id<");
  });

  test("multiple tableFor calls in one file compile independently", () => {
    const result = compile("e2e-multi.scrml", `\${
  import { tableFor } from 'scrml:data'

  type User:struct = {
    id:    integer
    email: string req
  }
  type Task:struct = {
    id:    integer
    title: string req
  }
}
<program>
  <users> = []
  <tasks> = []
  <tableFor for=User rows=@users/>
  <tableFor for=Task rows=@tasks/>
</program>
`);
    expect(realErrors(result).filter(e => e.code?.startsWith("E-TABLEFOR-"))).toEqual([]);
    const html = getHtml(result);
    expect(html).toContain('data-scrml-tablefor="User"');
    expect(html).toContain('data-scrml-tablefor="Task"');
  });

  test("aligned + classed columns emit style + class on <th>/<td>", () => {
    const result = compile("e2e-align-class.scrml", `\${
  import { tableFor } from 'scrml:data'

  type Row:struct = {
    id:   integer
    name: string req
  }
}
<program>
  <rows> = []
  <tableFor for=Row rows=@rows>
    <column field="id" align="right" class="numeric"/>
    <column field="name" class="primary"/>
  </tableFor>
</program>
`);
    const html = getHtml(result);
    expect(html).toContain('style="text-align:right"');
    expect(html).toContain('class="numeric"');
    expect(html).toContain('class="primary"');
  });
});
