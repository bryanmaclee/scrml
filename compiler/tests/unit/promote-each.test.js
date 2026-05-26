/**
 * `bun scrml promote --each` — Unit Tests (S134 Landing 3)
 *
 * Tests the Tier-0 → Tier-1 iteration lift: `${ for (let x of @cell) { lift
 * <markup/> } }` → `<each in=@cell as x><markup/></each>`. SPEC §56.10.
 *
 * Coverage map → SPEC §56.10 subsections:
 *   §1  Core rewrites (per-row of §56.10.2 table 1-4: basic, key, else, count)
 *   §2  Skip behaviors (§56.10.2 rows 5-7: literal-array, fn-call, multi-lift)
 *   §3  :-shorthand (§56.10.3: default, --shorthand opt-in, multi-element fail)
 *   §4  key= inference (§56.10.4)
 *   §5  <empty> synthesis (§56.10.5)
 *   §6  Idempotency + safety (§56.10.6)
 *   §7  Format preservation (§56.10.7)
 *   §8  Exit codes (§56.10.8)
 *   §9  CLI surface (mutual exclusion, --dry-run, --check, --include/exclude)
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// `${` literal — JS template literals would interpolate, so split.
const D = "$" + "{";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpFile(name, source) {
  const dir = join(tmpdir(), "scrml-promote-each-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, source, "utf8");
  return { dir, filePath };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Capture process.exit + console output during a runPromote() call.
function captureRun(runPromote, args) {
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let exitCode = null;
  let stdout = "";
  let stderr = "";
  process.exit = (code) => {
    exitCode = code;
    throw new Error("__exit_intercept__");
  };
  console.log = (...a) => { stdout += a.join(" ") + "\n"; };
  console.error = (...a) => { stderr += a.join(" ") + "\n"; };
  try {
    try { runPromote(args); }
    catch (e) { if (e.message !== "__exit_intercept__") throw e; }
  } finally {
    process.exit = realExit;
    console.log = realLog;
    console.error = realErr;
  }
  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// §1 — Core rewrites (§56.10.2 rows 1-4)
// ---------------------------------------------------------------------------

describe("§1 Core rewrites — §56.10.2 rows 1-4", () => {
  test("row 1: simple for/lift → <each in=@cell as x><markup/></each>", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let c of @contacts) {
        lift <li>placeholder</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("r1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      expect(r.count).toBe(1);
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each in=@contacts as c>");
      expect(after).toContain("<li>placeholder</li>");
      expect(after).toContain("</each>");
      // Tier-0 wrapper is gone
      expect(after).not.toContain("for (let c of @contacts)");
    } finally {
      cleanup(dir);
    }
  });

  test("row 2: for/lift with key clause → <each ... key=expr>", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let c of @contacts key c.id) {
        lift <li>placeholder</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("r2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each in=@contacts as c key=c.id>");
      expect(after).toContain("<li>placeholder</li>");
    } finally {
      cleanup(dir);
    }
  });

  test("row 3: for/lift/else → <each>...<empty>...</empty></each>", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let c of @contacts) {
        lift <li>placeholder</li>;
    } else {
        lift <li class="empty">No contacts yet.</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("r3.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each in=@contacts as c>");
      expect(after).toContain("<li>placeholder</li>");
      expect(after).toContain("<empty>");
      expect(after).toContain('<li class="empty">No contacts yet.</li>');
      expect(after).toContain("</empty>");
      expect(after).toContain("</each>");
    } finally {
      cleanup(dir);
    }
  });

  test("row 7: body interpolation referencing iter-var preserved verbatim into <each> body", async () => {
    // §56.10.2 row 7: `as x` makes `x` legal inside `${...}` interpolation
    // per §17.7.3 alias semantics; bare-body emission preserves the original
    // variable name AND the interpolation form.
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string, email: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let item of @contacts) {
        lift <li>${D}item.name} - ${D}item.email}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("r7.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // <each> with `as item` makes `item` legal in interpolations
      expect(after).toContain("<each in=@contacts as item>");
      // Both interpolations preserved verbatim (still referring to `item`)
      expect(after).toContain(`${D}item.name}`);
      expect(after).toContain(`${D}item.email}`);
    } finally {
      cleanup(dir);
    }
  });

  test("row 4: C-style count-loop → <each of=N as i>", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
const N = 10
<ul>
    ${D} for (let i = 0; i < N; i++) {
        lift <li>row</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("r4.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each of=N as i>");
      expect(after).toContain("<li>row</li>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — Skip behaviors (§56.10.2 rows 5-7)
// ---------------------------------------------------------------------------

describe("§2 Skip behaviors — §56.10.2 rows 5-7", () => {
  test("row 5: literal array iterable → SKIPPED with reason", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<ul>
    ${D} for (let x of [1, 2, 3]) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("s5.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("no-sites");
      expect(r.skipped?.length ?? 0).toBeGreaterThan(0);
      expect(r.skipped[0].reason).toContain("not an `@cell` reference");
      // File untouched
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });

  test("row 5b: function-call iterable → SKIPPED with reason", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
fn getItems() { return [] }
<ul>
    ${D} for (let x of getItems()) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("s5b.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("no-sites");
      expect(r.skipped?.length ?? 0).toBeGreaterThan(0);
      expect(r.skipped[0].reason).toContain("not an `@cell` reference");
    } finally {
      cleanup(dir);
    }
  });

  test("row 6: multi-lift body → SKIPPED with reason", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<contacts> = []
<ul>
    ${D} for (let c of @contacts) {
        lift <li>a</li>;
        lift <li>b</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("s6.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("no-sites");
      expect(r.skipped?.length ?? 0).toBeGreaterThan(0);
      expect(r.skipped[0].reason).toContain("multiple `lift` statements");
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — :-shorthand application (§56.10.3)
// ---------------------------------------------------------------------------

describe("§3 :-shorthand application — §56.10.3", () => {
  test("default (no --shorthand): bare-body preserved with `as` clause", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let item of @contacts) {
        lift <li>${D}item.name}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("sh1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // bare-body keeps `as item`
      expect(after).toContain("<each in=@contacts as item>");
      expect(after).toContain(`<li>${D}item.name}</li>`);
      // No :-shorthand applied
      expect(after).not.toContain(": @.name");
    } finally {
      cleanup(dir);
    }
  });

  test("--shorthand + single-element + single-expr → applies :-shorthand, drops `as`", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let item of @contacts) {
        lift <li>${D}item.name}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("sh2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: true }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // Shorthand applied; `as` dropped per §56.10.3 example
      expect(after).toContain("<each in=@contacts>");
      expect(after).not.toContain("as item");
      expect(after).toContain("<li : @.name>");
    } finally {
      cleanup(dir);
    }
  });

  test("--shorthand fails heuristic → falls back to bare-body (no force)", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    // Multi-element body — heuristic fails per §56.10.3.
    const src = `<program>
type Contact:struct = { id: string, name: string, email: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let item of @contacts) {
        lift <li><span>${D}item.name}</span> <a href=${D}item.email}>email</a></li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("sh3.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: true }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // Heuristic failed — bare-body, `as` retained.
      expect(after).toContain("<each in=@contacts as item>");
      // No shorthand colon applied to the outer <li>
      const eachBlock = after.match(/<each [^>]*>[\s\S]*?<\/each>/)[0];
      expect(eachBlock).not.toMatch(/<li : /);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — key= inference (§56.10.4)
// ---------------------------------------------------------------------------

describe("§4 key= inference — §56.10.4", () => {
  test("explicit `key x.id` clause carries forward as `key=x.id`", async () => {
    // Already covered by §1 row 2; assert the precise serialization.
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let c of @contacts key c.id) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("k1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("key=c.id");
    } finally {
      cleanup(dir);
    }
  });

  test("no explicit `key`: <each> emitted WITHOUT key= attribute (lint fires on next compile)", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Tag:struct = { name: string, color: string }
<tags>: Tag[] = []

<ul>
    ${D} for (let t of @tags) {
        lift <li>${D}t.name}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("k2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each in=@tags as t>");
      // No key= attribute
      expect(after).not.toContain("key=");
    } finally {
      cleanup(dir);
    }
  });

  test("CLI does NOT auto-insert `key=__index__` sentinel (§56.10.4 normative)", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Tag:struct = { name: string, color: string }
<tags>: Tag[] = []

<ul>
    ${D} for (let t of @tags) {
        lift <li>${D}t.name}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("k3.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // Must NOT contain the __index__ sentinel
      expect(after).not.toContain("__index__");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — <empty> synthesis (§56.10.5)
// ---------------------------------------------------------------------------

describe("§5 <empty> synthesis — §56.10.5", () => {
  test("with `else { lift }`: <empty> wraps else-markup verbatim", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let item of @items) {
        lift <li>placeholder</li>;
    } else {
        lift <p class="muted">Nothing here.</p>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("e1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<empty>");
      expect(after).toContain('<p class="muted">Nothing here.</p>');
      expect(after).toContain("</empty>");
    } finally {
      cleanup(dir);
    }
  });

  test("without `else`: no <empty> element synthesized", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let item of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("e2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).not.toContain("<empty>");
      expect(after).not.toContain("</empty>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Idempotency + safety (§56.10.6)
// ---------------------------------------------------------------------------

describe("§6 Idempotency + safety — §56.10.6", () => {
  test("re-running on already-promoted file → no-op", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("i1.scrml", src);
    try {
      // First run promotes
      const r1 = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r1.status).toBe("promoted");
      const afterFirst = readFileSync(filePath, "utf8");
      // Second run on the now-<each> source — no sites left.
      const r2 = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r2.status).toBe("no-sites");
      const afterSecond = readFileSync(filePath, "utf8");
      expect(afterSecond).toBe(afterFirst);
    } finally {
      cleanup(dir);
    }
  });

  test("mixed file: only un-promoted sites change", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    // One <each> already exists, one Tier-0 site remains.
    const src = `<program>
<items> = []
<contacts> = []

<ul>
    <each in=@items as it>
        <li>${D}it}</li>
    </each>
</ul>

<ol>
    ${D} for (let c of @contacts) {
        lift <li>${D}c.name}</li>;
    } }
</ol>

</program>`;
    const { dir, filePath } = makeTmpFile("i2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      expect(r.count).toBe(1);
      const after = readFileSync(filePath, "utf8");
      // The existing <each> is untouched
      expect(after).toContain("<each in=@items as it>");
      // The new <each> from the @contacts site
      expect(after).toContain("<each in=@contacts as c>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — Format preservation (§56.10.7)
// ---------------------------------------------------------------------------

describe("§7 Format preservation — §56.10.7", () => {
  test("source outside the rewritten span preserved byte-for-byte", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
// HEADER COMMENT — must persist verbatim
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<div class="wrapper" id="x">
<ul>
    ${D} for (let c of @contacts) {
        lift <li>placeholder</li>;
    } }
</ul>
</div>

// FOOTER COMMENT — must persist verbatim
</program>`;
    const { dir, filePath } = makeTmpFile("f1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // Header + footer + type-decl + state-decl + wrapper attrs preserved
      expect(after).toContain("// HEADER COMMENT — must persist verbatim");
      expect(after).toContain("// FOOTER COMMENT — must persist verbatim");
      expect(after).toContain('<div class="wrapper" id="x">');
      expect(after).toContain("type Contact:struct = { id: string, name: string }");
      expect(after).toContain("<contacts>: Contact[] = []");
    } finally {
      cleanup(dir);
    }
  
  });

  test("comments inside loop body are preserved into <each> body location", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        // Per-item BODY comment — must persist
        lift <li>${D}x}</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("f3.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // Comment carried forward into the <each> body
      expect(after).toContain("// Per-item BODY comment — must persist");
    } finally {
      cleanup(dir);
    }
  });

  test("indentation of surrounding markup preserved (no trim/reformat)", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    // Tab-indented surrounding markup; the promote should leave it as-is.
    const src = `<program>
<items> = []

<section>
\t<ul>
\t\t${D} for (let x of @items) {
\t\t\tlift <li>x</li>;
\t\t} }
\t</ul>
</section>

</program>`;
    const { dir, filePath } = makeTmpFile("f2.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      const after = readFileSync(filePath, "utf8");
      // The tab-indented <section> + <ul> + </ul> + </section> persist
      expect(after).toContain("<section>");
      expect(after).toContain("\t<ul>");
      expect(after).toContain("\t</ul>");
      expect(after).toContain("</section>");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — Exit codes (§56.10.8)
// ---------------------------------------------------------------------------

describe("§8 Exit codes — §56.10.8", () => {
  test("no promotable sites → exit code 0 (informational)", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<ul>
    <li>no for-loops here</li>
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("ec0.scrml", src);
    try {
      const { exitCode } = captureRun(runPromote, ["--each", filePath]);
      // exitCode may be null (clean) or 0
      if (exitCode != null) expect(exitCode).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test("--check + promotable sites present → exit code non-zero", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("ec_check.scrml", src);
    try {
      const { exitCode } = captureRun(runPromote, ["--each", "--check", filePath]);
      expect(exitCode).toBe(1);
      // File untouched
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });

  test("targeted line with no site → status 'ambiguous'", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("ec_amb.scrml", src);
    try {
      // Target a line nowhere near the for-loop
      const r = promoteEachOnFile(filePath, 99, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("ambiguous");
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §9 — CLI surface
// ---------------------------------------------------------------------------

describe("§9 CLI surface — mutual exclusion, --dry-run, --check, --include", () => {
  test("--each + --match together → error (mutual exclusion)", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("mex.scrml", "<program>x</program>");
    try {
      const { exitCode, stderr } = captureRun(runPromote, ["--each", "--match", filePath]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Cannot combine --match, --engine, and --each");
    } finally {
      cleanup(dir);
    }
  });

  test("--each + --engine together → error (mutual exclusion)", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("mex2.scrml", "<program>x</program>");
    try {
      const { exitCode, stderr } = captureRun(runPromote, ["--each", "--engine", filePath]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Cannot combine --match, --engine, and --each");
    } finally {
      cleanup(dir);
    }
  });

  test("--shorthand without --each → error", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const { dir, filePath } = makeTmpFile("sh_err.scrml", "<program>x</program>");
    try {
      const { exitCode, stderr } = captureRun(runPromote, ["--match", "--shorthand", filePath]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--shorthand is meaningful only with --each");
    } finally {
      cleanup(dir);
    }
  });

  test("--dry-run --each: prints unified diff, leaves file unchanged", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("dry.scrml", src);
    try {
      const { stdout } = captureRun(runPromote, ["--each", "--dry-run", filePath]);
      expect(stdout).toContain("<each in=@items as x>");
      // File on disk MUST be unchanged
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });

  test("--each accepts directory + recurses .scrml files", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("subA.scrml", src);
    try {
      const { exitCode, stdout } = captureRun(runPromote, ["--each", dir, "--no-default-excludes"]);
      if (exitCode != null) expect(exitCode).toBe(0);
      // Should report a promotion
      expect(stdout).toContain("promoted");
      const after = readFileSync(filePath, "utf8");
      expect(after).toContain("<each in=@items as x>");
    } finally {
      cleanup(dir);
    }
  });

  test("printHelp lists --each in modes section", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const realLog = console.log;
    let stdout = "";
    console.log = (...a) => { stdout += a.join(" ") + "\n"; };
    try {
      runPromote(["--help"]);
    } finally {
      console.log = realLog;
    }
    expect(stdout).toContain("--each");
    expect(stdout).toContain("--shorthand");
    expect(stdout).toContain("Tier-0 iteration site");
  });
});

// ---------------------------------------------------------------------------
// §10 — Sanity-parse gate (rewritten source must still compile)
// ---------------------------------------------------------------------------

describe("§10 Sanity-parse gate", () => {
  test("rewritten source compiles cleanly (no new parse errors)", async () => {
    const { promoteEachOnFile } = await import("../../src/commands/promote.js");
    const src = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    ${D} for (let c of @contacts) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("p1.scrml", src);
    try {
      const r = promoteEachOnFile(filePath, null, { dryRun: false, check: false, shorthand: false }, dir);
      expect(r.status).toBe("promoted");
      // Now compile the rewritten file and verify no blocking errors.
      const result = compileScrml({ inputFiles: [filePath], write: false, gather: false, log: () => {} });
      const blocking = (result.errors || []).filter(e => !e.severity || e.severity === "error");
      expect(blocking.length).toBe(0);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// §11 — extended CLI coverage (--include/--exclude, --check on dir)
// ---------------------------------------------------------------------------

describe("§11 Extended CLI surface — file walk + filters", () => {
  test("--check on directory with mixed files: exits non-zero when any would promote", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("checkdir.scrml", src);
    try {
      const { exitCode } = captureRun(runPromote, ["--each", "--check", dir, "--no-default-excludes"]);
      expect(exitCode).toBe(1);
      // File untouched
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });

  test("--exclude with substring filter: excluded files are not visited", async () => {
    const { runPromote } = await import("../../src/commands/promote.js");
    const src = `<program>
<items> = []
<ul>
    ${D} for (let x of @items) {
        lift <li>x</li>;
    } }
</ul>

</program>`;
    const { dir, filePath } = makeTmpFile("excluded.scrml", src);
    try {
      const { exitCode } = captureRun(runPromote, ["--each", "--exclude=excluded", dir, "--no-default-excludes"]);
      if (exitCode != null) expect(exitCode).toBe(0);
      // File untouched because exclude matched
      expect(readFileSync(filePath, "utf8")).toBe(src);
    } finally {
      cleanup(dir);
    }
  });
});
