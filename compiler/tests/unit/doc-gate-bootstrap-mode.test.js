/**
 * doc-gate-bootstrap-mode.test.js — the S469 public-docs gate modes (owner rulings
 * "Ruled dialect, bootstrap-gated" + "Smarter skip markers", user-voice be6f90e).
 *
 *   - scripts/doc-gate-markers.js: the dialect opt-in, `<!-- gate: skip|spec-ahead — reason -->`,
 *     the mandatory reason, and the snippet-file dialect derivation.
 *   - scripts/snippet-drift.js: a gate marker between a snippet marker and its fence does not detach them.
 *   - scripts/claim-gate.js end to end: a ruled document compiles with the BOOTSTRAP; spec-ahead
 *     blocks are counted and listed; a spec-ahead block that now compiles is reported "remove the
 *     marker" (and fails under --strict); a reasonless marker fails; snippet-marked blocks are delegated.
 *   - scripts/snippet-gate.js end to end: a file cited by a ruled document compiles with the bootstrap.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import { parseDocMarkers, collectSnippetDialects } from "../../../scripts/doc-gate-markers.js";
import { parseDoc } from "../../../scripts/snippet-drift.js";
import { loadBoot } from "../../../scripts/scrml-boot.ts";

const ROOT = join(import.meta.dir, "../../..");
const F = "```";
const fence = (...body) => [`${F}scrml`, ...body, F];

// A program the bootstrap compiles (ruled spelling), one it refuses (a `^{}` meta context is not in it; s469-boot-css: was `#{}`, which it now compiles),
// and one impl#1 compiles but the bootstrap does not parse (legacy `<x> = v` cell).
const GOOD = ["<program>", "    let <count:int=0/>", "    function inc() {", "        @count = @count + 1;", "    }", "    <main><button onclick=inc()>+</button><p>${@count}</p></main>", "</program>"];
const AHEAD = ["<program>", "    <main>", "        <p>hi</p>", "        ^{ 1 }", "    </main>", "</program>"];
const LEGACY = ["<program>", "    <count> = 0", "    <p>${@count}</p>", "</program>"];

describe("parseDocMarkers — dialect opt-in", () => {
  test("no marker → impl1", () => {
    expect(parseDocMarkers("# x\n").dialect).toBe("impl1");
  });
  test("<!-- dialect: ruled --> → ruled", () => {
    const d = parseDocMarkers("# x\n<!-- dialect: ruled -->\n");
    expect(d.dialect).toBe("ruled");
    expect(d.dialectLine).toBe(2);
    expect(d.errors).toEqual([]);
  });
  test("front matter `dialect: ruled` → ruled", () => {
    expect(parseDocMarkers("---\ntitle: t\ndialect: ruled\n---\n# x\n").dialect).toBe("ruled");
  });
  test("an unknown dialect is an error, not a silent impl1", () => {
    const d = parseDocMarkers("<!-- dialect: rulde -->\n");
    expect(d.dialect).toBe("impl1");
    expect(d.errors[0].message).toContain("unknown dialect");
  });
  test("a dialect comment inside a fence is not an opt-in", () => {
    expect(parseDocMarkers(["```", "<!-- dialect: ruled -->", "```"].join("\n")).dialect).toBe("impl1");
  });
});

describe("parseDocMarkers — gate markers", () => {
  test("skip with a reason attaches to the next scrml fence (em dash, hyphen, colon)", () => {
    for (const sep of ["—", "-", "--", ":"]) {
      const d = parseDocMarkers([`<!-- gate: skip ${sep} a fragment -->`, "", ...fence("x")].join("\n"));
      expect(d.errors).toEqual([]);
      expect(d.blocks[0].gate).toEqual({ kind: "skip", reason: "a fragment", line: 1, codes: null });
    }
  });
  test("a marker with no reason is an error and does not skip", () => {
    const d = parseDocMarkers(["<!-- gate: skip -->", ...fence("x")].join("\n"));
    expect(d.blocks[0].gate).toBeNull();
    expect(d.errors[0].message).toContain("no reason");
  });
  test("spec-ahead with no reason is an error", () => {
    const d = parseDocMarkers(["<!-- dialect: ruled -->", "<!-- gate: spec-ahead — -->", ...fence("x")].join("\n"));
    expect(d.errors[0].message).toContain("no reason");
  });
  test("an unknown kind is an error", () => {
    const d = parseDocMarkers(["<!-- gate: skipp — typo -->", ...fence("x")].join("\n"));
    expect(d.errors[0].message).toContain("unknown gate marker");
  });
  test("a marker not followed by a scrml fence is an error", () => {
    const d = parseDocMarkers(["<!-- gate: skip — why -->", "prose", ...fence("x")].join("\n"));
    expect(d.errors[0].message).toContain("gates nothing");
    expect(d.blocks[0].gate).toBeNull();
  });
  test("spec-ahead outside a ruled document is an error", () => {
    const d = parseDocMarkers(["<!-- gate: spec-ahead — x -->", ...fence("x")].join("\n"));
    expect(d.errors[0].message).toContain("only meaningful in a document marked");
  });
  test("two gate markers on one block is an error", () => {
    const d = parseDocMarkers(["<!-- gate: skip — a -->", "<!-- gate: skip — b -->", ...fence("x")].join("\n"));
    expect(d.errors[0].message).toContain("two gate markers");
  });
  test("the legacy `// gate: skip` line: honoured in impl1, an error in ruled", () => {
    expect(parseDocMarkers(fence("// gate: skip", "x").join("\n")).blocks[0].legacySkip).not.toBeNull();
    const d = parseDocMarkers(["<!-- dialect: ruled -->", ...fence("// gate: skip", "x")].join("\n"));
    expect(d.errors[0].message).toContain("legacy `// gate: skip`");
  });
  test("gate and snippet markers attach in either order", () => {
    for (const lines of [
      ["<!-- snippet: docs/a.scrml -->", "<!-- gate: spec-ahead — x -->"],
      ["<!-- gate: spec-ahead — x -->", "<!-- snippet: docs/a.scrml -->"],
    ]) {
      const d = parseDocMarkers(["<!-- dialect: ruled -->", ...lines, ...fence("x")].join("\n"));
      expect(d.errors).toEqual([]);
      expect(d.blocks[0].gate.kind).toBe("spec-ahead");
      expect(d.blocks[0].snippet.path).toBe("docs/a.scrml");
    }
  });
});

describe("snippet-drift tolerates a gate marker between its marker and the fence", () => {
  test("the snippet marker still attaches", () => {
    const { blocks, dangling } = parseDoc(["<!-- snippet: docs/a.scrml -->", "<!-- gate: spec-ahead — x -->", ...fence("x")].join("\n"));
    expect(dangling).toEqual([]);
    expect(blocks[0].marker.path).toBe("docs/a.scrml");
  });
});

describe("collectSnippetDialects", () => {
  const docs = {
    "ruled.md": ["<!-- dialect: ruled -->", "<!-- snippet: s/a.scrml -->", ...fence("x"), "<!-- gate: spec-ahead — no db -->", "<!-- snippet: s/b.scrml#L1-L1 -->", ...fence("x")].join("\n"),
    "plain.md": ["<!-- snippet: s/c.scrml -->", ...fence("x")].join("\n"),
    "clash.md": ["<!-- snippet: s/a.scrml -->", ...fence("x")].join("\n"),
    "skip.md": ["<!-- gate: skip — why -->", "<!-- snippet: s/d.scrml -->", ...fence("x")].join("\n"),
  };
  const run = (names) => collectSnippetDialects((d) => docs[d], names);

  test("a ruled document's files are ruled; an excerpt's spec-ahead marks the file", () => {
    const r = run(["ruled.md", "plain.md"]);
    expect(r.errors).toEqual([]);
    expect(r.byFile.get("s/a.scrml").dialect).toBe("ruled");
    expect(r.byFile.get("s/a.scrml").specAhead).toBeNull();
    expect(r.byFile.get("s/b.scrml").specAhead.reason).toBe("no db");
    expect(r.byFile.get("s/c.scrml").dialect).toBe("impl1");
  });
  test("a file cited by a ruled and an impl1 document is an error", () => {
    const r = run(["ruled.md", "clash.md"]);
    expect(r.errors.map((e) => e.message).join("\n")).toContain("cannot be both dialects");
  });
  test("`gate: skip` on a snippet-marked block is an error (the file is compiled regardless)", () => {
    const r = run(["skip.md"]);
    expect(r.errors[0].message).toContain("compiled whole by snippet-gate regardless");
  });
});

// ─── end to end ─────────────────────────────────────────────────────────────

let dir;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "doc-gate-bootstrap-"));
  await loadBoot(); // warm the bootstrap bundle cache once (cold: built by impl#1)
}, 300_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The gates print POSIX paths on every OS (S469): `join` writes `\` on Windows, so an
// expected path built here is compared in its `/` form.
const posix = (p) => p.split(sep).join("/");
const write = (name, lines) => {
  const p = join(dir, name);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
};
const claim = (...args) => spawnSync("bun", ["scripts/claim-gate.js", ...args], { cwd: ROOT, encoding: "utf8" });
const snippet = (...args) => spawnSync("bun", ["scripts/snippet-gate.js", ...args], { cwd: ROOT, encoding: "utf8" });

describe("claim-gate — bootstrap mode", () => {
  test("ruled doc: good block passes on the bootstrap, spec-ahead counted, skip skipped, exit 0", () => {
    const md = write("ruled-ok.md", [
      "# t", "<!-- dialect: ruled -->",
      ...fence(...GOOD),
      "<!-- gate: spec-ahead — ^{} meta is not in the bootstrap -->",
      ...fence(...AHEAD),
      "<!-- gate: skip — a fragment -->",
      ...fence("not code"),
    ]);
    const r = claim(md);
    expect(r.stdout).toContain("[ruled]");
    expect(r.stdout).toContain("claim-gate: 1 passed, 1 skipped, 0 snippet-gated, 1 spec-ahead, 0 failed (3 total).");
    expect(r.stdout).toContain("— ^{} meta is not in the bootstrap  [bootstrap: E-BOOTSTRAP-UNSUPPORTED");
    expect(r.stdout).toMatch(/bootstrap \(ruled\) — 1 file\(s\), 1 pass, 1 skip, 0 snippet, 1 spec-ahead, 0 stale, 0 fail/);
    expect(r.status).toBe(0);
  }, 120_000);

  test("ruled doc: a block impl#1 accepts but the bootstrap refuses FAILS (the bootstrap decides)", () => {
    const md = write("ruled-legacy.md", ["<!-- dialect: ruled -->", ...fence(...LEGACY)]);
    const r = claim(md);
    expect(r.stderr).toContain("bootstrap compile-fail");
    expect(r.status).toBe(1);
  }, 120_000);

  test("the same legacy block in an impl1 doc still compiles with impl#1 (nothing silently ungated)", () => {
    const md = write("impl1-legacy.md", fence(...LEGACY));
    const r = claim(md);
    expect(r.stdout).toMatch(/impl1 — 1 file\(s\), 1 pass/);
    expect(r.status).toBe(0);
  }, 120_000);

  test("a spec-ahead block that now compiles is reported 'remove the marker'; --strict fails on it", () => {
    const md = write("ruled-stale.md", ["<!-- dialect: ruled -->", "<!-- gate: spec-ahead — pretend -->", ...fence(...GOOD)]);
    const r = claim(md);
    expect(r.stdout).toContain("STALE spec-ahead markers (1)");
    expect(r.stdout).toContain("remove the marker (was: pretend)");
    expect(r.status).toBe(0);
    const s = claim("--strict", md);
    expect(s.stderr).toContain("stale spec-ahead marker (--strict)");
    expect(s.status).toBe(1);
  }, 120_000);

  test("a marker with no reason fails the gate", () => {
    const md = write("ruled-noreason.md", ["<!-- dialect: ruled -->", "<!-- gate: skip -->", ...fence("not code")]);
    const r = claim(md);
    expect(r.stderr).toContain("has no reason");
    expect(r.status).toBe(1);
  }, 120_000);
});

describe("snippet-gate — bootstrap mode", () => {
  test("a file cited by a ruled document compiles on the bootstrap; spec-ahead files are listed", () => {
    const good = write("good.scrml", GOOD);
    const ahead = write("ahead.scrml", AHEAD);
    const legacy = write("legacy.scrml", LEGACY);
    const md = write("cites.md", [
      "<!-- dialect: ruled -->",
      `<!-- snippet: ${good} -->`, ...fence("x"),
      `<!-- gate: spec-ahead — no ^{} yet -->`, `<!-- snippet: ${ahead} -->`, ...fence("x"),
    ]);
    const r = snippet(`--docs=${md}`, good, ahead, legacy);
    expect(r.stdout).toContain(`PASS  ${posix(good)}  (bootstrap)`);
    expect(r.stdout).toContain(`AHEAD ${posix(ahead)}  (bootstrap; spec-ahead — no ^{} yet)`);
    expect(r.stdout).toContain(`PASS  ${posix(legacy)}\n`); // uncited → impl#1
    expect(r.stdout).toMatch(/impl1 — 1 file\(s\), 1 pass, 0 fail · bootstrap \(ruled\) — 2 file\(s\), 1 pass, 1 spec-ahead, 0 stale, 0 fail/);
    expect(r.status).toBe(0);
  }, 120_000);

  test("a spec-ahead file that now compiles is STALE (remove the marker); a ruled file that fails, fails", () => {
    const good = write("good2.scrml", GOOD);
    const legacy = write("legacy2.scrml", LEGACY);
    const md = write("cites2.md", [
      "<!-- dialect: ruled -->",
      `<!-- gate: spec-ahead — pretend -->`, `<!-- snippet: ${good} -->`, ...fence("x"),
      `<!-- snippet: ${legacy} -->`, ...fence("x"),
    ]);
    const r = snippet(`--docs=${md}`, good, legacy);
    expect(r.stdout).toContain("STALE");
    expect(r.stdout).toContain("remove the marker");
    expect(r.stdout).toContain(`FAIL  ${posix(legacy)}  (bootstrap)`);
    expect(r.status).toBe(1);
  }, 120_000);
});
