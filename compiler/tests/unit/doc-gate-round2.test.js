/**
 * doc-gate-round2.test.js — S469 docs-gate review round 2 (A1–A7).
 *
 *   A1  fences close only on a run of the same character at least as long as the opener.
 *   A2  claim-gate delegates a snippet-marked block only when snippet-gate really checks it.
 *   A3  a bootstrap crash is a failure even on a spec-ahead block.
 *   A3b a spec-ahead marker may pin its expected codes; a different set fails.
 *   A4  scrml-looking fences that cannot be gated are errors, not silent skips.
 *   A5  `skip-me` / `spec-ahead-ish` are unknown kinds.
 *   A6  printer refusals fail, warnings do not, front-matter/HTML dialect conflict.
 *   A7  docs/articles/archive is outside the drift check and the claim-gate surface.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import { parseDocMarkers } from "../../../scripts/doc-gate-markers.js";
import { parseDoc, isDriftScanned, inSnippetCorpus, discoverDocs } from "../../../scripts/snippet-drift.js";
import { bootCheck, classifySpecAhead, pinMismatch } from "../../../scripts/doc-boot-check.js";
import { loadBoot } from "../../../scripts/scrml-boot.ts";

const ROOT = join(import.meta.dir, "../../..");
const B3 = "```";
const B4 = "````";
const fence = (...body) => [`${B3}scrml`, ...body, B3];
const GOOD = ["<program>", "    let <count:int=0/>", "    <p>${@count}</p>", "</program>"];
// s469-boot-css: a `^{}` meta context (was `#{}`, which the bootstrap now compiles)
const AHEAD = ["<program>", "    <main>", "        <p>hi</p>", "        ^{ 1 }", "    </main>", "</program>"];

describe("A1 — fence lengths and characters", () => {
  test("a 4-backtick fence that shows ```scrml text opens no block and swallows nothing", () => {
    const d = parseDocMarkers([
      `${B4}markdown`, `${B3}scrml`, "<p>example</p>", B3, B4,
      ...fence("<program></program>"),
    ].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].body).toBe("<program></program>");
    expect(d.errors).toEqual([]);
  });
  test("a 3-backtick line cannot close a 4-backtick scrml fence", () => {
    const d = parseDocMarkers([`${B4}scrml`, "a", B3, "b", B4].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].bodyLines).toEqual(["a", B3, "b"]);
  });
  test("a backtick run cannot close a tilde fence, and a tilde scrml fence is gated", () => {
    const d = parseDocMarkers(["~~~scrml", "x", B3, "~~~"].join("\n"));
    expect(d.blocks.length).toBe(1);
    expect(d.blocks[0].bodyLines).toEqual(["x", B3]);
  });
  test("snippet-drift uses the same parser: a marker before a 4-backtick non-scrml fence dangles", () => {
    const { blocks, dangling } = parseDoc(["<!-- snippet: docs/a.scrml -->", `${B4}text`, `${B3}scrml`, B3, B4].join("\n"));
    expect(blocks).toEqual([]);
    expect(dangling.length).toBe(1);
  });
});

describe("A4 — scrml-looking fences that cannot be gated are errors", () => {
  test("`scrml title=…` and `SCRML` are gated", () => {
    expect(parseDocMarkers([`${B3}scrml title=app.scrml`, "x", B3].join("\n")).blocks.length).toBe(1);
    expect(parseDocMarkers([`${B3}SCRML`, "x", B3].join("\n")).blocks.length).toBe(1);
  });
  test("an info string that starts with scrml but is another word is an error", () => {
    const d = parseDocMarkers([`${B3}scrml-old`, "x", B3].join("\n"));
    expect(d.blocks.length).toBe(0);
    expect(d.errors[0].message).toContain("starts with `scrml` but is not `scrml`");
  });
  test("a scrml fence inside a blockquote is an error", () => {
    const d = parseDocMarkers(["> " + B3 + "scrml", "> x", "> " + B3].join("\n"));
    expect(d.errors[0].message).toContain("inside a blockquote");
  });
  test("an unclosed scrml fence is an error", () => {
    expect(parseDocMarkers([`${B3}scrml`, "x"].join("\n")).errors[0].message).toContain("unclosed scrml fence");
  });
});

describe("A5 / A3b — marker kinds and pins", () => {
  test("`skip-me` and `spec-ahead-ish` are unknown kinds", () => {
    for (const k of ["skip-me — x", "spec-ahead-ish — x"]) {
      const d = parseDocMarkers(["<!-- dialect: ruled -->", `<!-- gate: ${k} -->`, ...fence("x")].join("\n"));
      expect(d.errors[0].message).toContain("unknown gate marker");
      expect(d.blocks[0].gate).toBeNull();
    }
  });
  test("pins are parsed on spec-ahead", () => {
    const d = parseDocMarkers(["<!-- dialect: ruled -->", "<!-- gate: spec-ahead [E-PARSE-ARM, E-SCOPE-001] — why -->", ...fence("x")].join("\n"));
    expect(d.errors).toEqual([]);
    expect(d.blocks[0].gate.codes).toEqual(["E-PARSE-ARM", "E-SCOPE-001"]);
    expect(d.blocks[0].gate.reason).toBe("why");
  });
  test("pins on skip, and a malformed pin list, are errors", () => {
    expect(parseDocMarkers(["<!-- gate: skip [E-X] — why -->", ...fence("x")].join("\n")).errors[0].message).toContain("only allowed on `gate: spec-ahead`");
    expect(parseDocMarkers(["<!-- dialect: ruled -->", "<!-- gate: spec-ahead [oops] — why -->", ...fence("x")].join("\n")).errors[0].message).toContain("bad pinned code list");
  });
  test("pinMismatch compares distinct code sets", () => {
    expect(pinMismatch(null, ["E-A"])).toBeNull();
    expect(pinMismatch(["E-A", "E-B"], ["E-B", "E-A", "E-A"])).toBeNull();
    expect(pinMismatch(["E-A"], ["E-A", "E-B"])).toContain("pinned codes [E-A]");
  });
});

describe("A6 — the dialect conflict", () => {
  test("front matter `dialect: impl1` and an HTML `dialect: ruled` conflict", () => {
    const d = parseDocMarkers(["---", "dialect: impl1", "---", "<!-- dialect: ruled -->"].join("\n"));
    expect(d.errors[0].message).toContain("conflicting dialect declarations");
  });
});

describe("A3 / A6 — bootstrap results: crash, refusal, warnings", () => {
  const diag = (severity, code) => ({ severity, code, message: "m" });
  const fake = (result) => async () => ({ ok: result.ok, diagnostics: result.diagnostics });
  test("a crash (the compiler throws) is crash: true", async () => {
    const r = await bootCheck("/x.scrml", "x", async () => { throw new Error("boom"); });
    expect(r).toMatchObject({ ok: false, crash: true, codes: ["BOOTSTRAP-CRASH"] });
  });
  test("a printer refusal (an Error diagnostic, ok: false) fails", async () => {
    const r = await bootCheck("/x.scrml", "x", fake({ ok: false, diagnostics: [diag("error", "E-BOOTSTRAP-CORE-ILL-FORMED")] }));
    expect(r).toMatchObject({ ok: false, crash: false, codes: ["E-BOOTSTRAP-CORE-ILL-FORMED"] });
  });
  test("warnings and infos do not fail", async () => {
    const r = await bootCheck("/x.scrml", "x", fake({ ok: true, diagnostics: [diag("warning", "W-X"), diag("info", "I-Y")] }));
    expect(r).toMatchObject({ ok: true, codes: [] });
  });
  test("classifySpecAhead: crash and pin mismatch fail; a clean compile is stale", () => {
    expect(classifySpecAhead({ ok: false, crash: true, codes: ["BOOTSTRAP-CRASH"] }, null).verdict).toBe("crash");
    expect(classifySpecAhead({ ok: false, crash: true, codes: ["BOOTSTRAP-CRASH"] }, ["BOOTSTRAP-CRASH"]).verdict).toBe("crash");
    expect(classifySpecAhead({ ok: false, crash: false, codes: ["E-A"] }, ["E-B"]).verdict).toBe("pin-mismatch");
    expect(classifySpecAhead({ ok: false, crash: false, codes: ["E-A"] }, ["E-A"]).verdict).toBe("expected");
    expect(classifySpecAhead({ ok: false, crash: false, codes: ["E-A"] }, null).verdict).toBe("expected");
    expect(classifySpecAhead({ ok: true, crash: false, codes: [] }, ["E-A"]).verdict).toBe("stale");
  });
});

describe("A2 / A7 — what is drift-scanned and what is corpus", () => {
  test("NERDME.md and DESIGN.md are drift-scanned; the archive and docs/changes are not", () => {
    expect(isDriftScanned("NERDME.md")).toBe(true);
    expect(isDriftScanned("DESIGN.md")).toBe(true);
    expect(isDriftScanned("docs/tutorial.md")).toBe(true);
    expect(isDriftScanned("docs/articles/archive/orm-trap-devto-2026-04-29.md")).toBe(false);
    expect(isDriftScanned("docs/changes/x/BRIEF.md")).toBe(false);
    expect(discoverDocs(ROOT).some((d) => d.startsWith("docs/articles/archive/"))).toBe(false);
  });
  test("corpus membership", () => {
    expect(inSnippetCorpus("docs/tutorial-snippets/01-hello.scrml")).toBe(true);
    expect(inSnippetCorpus("examples/02-counter.scrml")).toBe(false);
  });
});

// ─── end to end ─────────────────────────────────────────────────────────────

let dir;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "doc-gate-r2-"));
  await loadBoot();
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

describe("claim-gate end to end", () => {
  test("A1: a ```scrml block after a 4-backtick example is still gated (and fails here)", () => {
    const md = write("four.md", [`${B4}md`, `${B3}scrml`, "x", B3, B4, ...fence("<program>", "<p>${@nope}</p>", "</program>")]);
    const r = claim(md);
    expect(r.stdout).toContain("(1 total)");
    expect(r.status).toBe(1);
  }, 120_000);

  test("A2: a snippet marker pointing at a missing file fails", () => {
    const md = write("missing.md", ["<!-- snippet: docs/does-not-exist.scrml -->", ...fence("x")]);
    const r = claim(md);
    expect(r.stderr).toContain("target docs/does-not-exist.scrml does not exist");
    expect(r.status).toBe(1);
  }, 120_000);

  test("A2: a snippet marker in a document the drift check does not scan fails", () => {
    const md = write("unscanned.md", ["<!-- snippet: docs/tutorial-snippets/01-hello.scrml -->", ...fence("x")]);
    const r = claim(md);
    expect(r.stderr).toContain("is not drift-scanned");
    expect(r.status).toBe(1);
  }, 120_000);

  test("A2: the tutorial's snippet blocks are delegated (drift-scanned, in the corpus)", () => {
    const r = claim("docs/tutorial.md");
    expect(r.stdout).toContain("18 snippet-gated");
    expect(r.stdout).toContain("0 failed");
    expect(r.status).toBe(0);
  }, 120_000);

  test("A3b: a pinned spec-ahead block fails when the codes differ, passes when they match", () => {
    const wrong = write("pin-wrong.md", ["<!-- dialect: ruled -->", "<!-- gate: spec-ahead [E-PARSE-ARM] — no ^{} -->", ...fence(...AHEAD)]);
    const rw = claim(wrong);
    expect(rw.stderr).toContain("spec-ahead pin-mismatch");
    expect(rw.status).toBe(1);
    const right = write("pin-right.md", ["<!-- dialect: ruled -->", "<!-- gate: spec-ahead [E-BOOTSTRAP-UNSUPPORTED] — no ^{} -->", ...fence(...AHEAD)]);
    const rr = claim(right);
    expect(rr.stdout).toContain("1 spec-ahead");
    expect(rr.status).toBe(0);
  }, 120_000);

  test("A4: a blockquoted scrml fence fails the gate", () => {
    const md = write("bq.md", ["> " + B3 + "scrml", "> x", "> " + B3]);
    const r = claim(md);
    expect(r.stderr).toContain("inside a blockquote");
    expect(r.status).toBe(1);
  }, 120_000);

  test("A7: docs/articles/archive and the bannered dated articles are not in the claim-gate surface; the ruled kickstarter is", () => {
    // The declared surface (no path argument), so the excludes apply. Paths print POSIX-style on
    // every OS (S469: the Windows job printed `docs\articles\…`).
    const r = claim("--list");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("docs/articles/llm-kickstarter-v2-2026-05-04.md");
    expect(r.stdout).not.toContain("archive");
    expect(r.stdout).not.toContain("i-am-jacks-");
    expect(r.stdout).not.toContain("if-you-give-a-dev-an-enum");
    expect(r.stdout).not.toContain("v0.2.0-announce");
    expect(r.stdout).not.toContain("v0.3.0-announce");
    expect(r.stdout).not.toContain("\\");
  }, 120_000);
  test("A7: run from another directory, the surface and its excludes are the same (the gate chdirs to the repo root)", () => {
    const fromRoot = claim("--list");
    const elsewhere = spawnSync("bun", [join(ROOT, "scripts/claim-gate.js"), "--list"], { cwd: tmpdir(), encoding: "utf8" });
    expect(elsewhere.status).toBe(0);
    expect(elsewhere.stdout).toBe(fromRoot.stdout);
    expect(elsewhere.stdout).not.toContain("i-am-jacks-");
  }, 120_000);
  test("A7: an explicit path still lists what is under it, POSIX-style", () => {
    const r = claim("--list", "docs/articles");
    expect(r.stdout).toContain("docs/articles/llm-kickstarter-v2-2026-05-04.md");
    expect(r.stdout).not.toContain("\\");
  }, 120_000);
});

describe("snippet-gate end to end", () => {
  test("A3b: a pinned spec-ahead file fails on a code mismatch", () => {
    const ahead = write("ahead-pin.scrml", AHEAD);
    const md = write("cites-pin.md", ["<!-- dialect: ruled -->", "<!-- gate: spec-ahead [E-SCOPE-001] — no ^{} -->", `<!-- snippet: ${ahead} -->`, ...fence("x")]);
    const r = snippet(`--docs=${md}`, ahead);
    expect(r.stdout).toContain("spec-ahead pin-mismatch");
    expect(r.status).toBe(1);
  }, 120_000);

  test("a ruled file that compiles still passes (sanity)", () => {
    const good = write("good-r2.scrml", GOOD);
    const md = write("cites-good.md", ["<!-- dialect: ruled -->", `<!-- snippet: ${good} -->`, ...fence("x")]);
    const r = snippet(`--docs=${md}`, good);
    expect(r.stdout).toContain(`PASS  ${posix(good)}  (bootstrap)`);
    expect(r.status).toBe(0);
  }, 120_000);
});
