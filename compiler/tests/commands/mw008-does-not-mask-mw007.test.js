/**
 * §40 / §20.5.1 — `E-MW-008` must not MASK `E-MW-007`, driven through the REAL CLI.
 *
 * ⚑ WHY THIS FILE EXISTS. The conformance suite had a test named "E-MW-008 does NOT
 * mask E-MW-007" that asserted through `compileScrml`. The S239 re-review pointed out
 * it proved less than its name: `E-MW-007` is emitted at the COMMAND layer
 * (`commands/select-request-onion.js`, consumed by `build.js` and `dev.js`), so the
 * library API cannot produce it at all and the test could never have observed masking
 * in either direction. It was renamed to what it actually checks; the real
 * non-masking claim needs the CLI, and lives here.
 *
 * `E-MW-008` is emitted in `codegen/index.ts`, which runs BEFORE the onion selection,
 * so "does the older sibling still fire?" is a genuine question and not a formality.
 *
 * Two spawns, both one-shot `scrml build` (no `scrml dev`, no long-running server —
 * the CI-flaky shape is the dev-server tests, not a single build).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "..", "bin", "scrml.js");

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "mw008-mask-")); });
afterAll(() => { try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {} });

let _n = 0;
/** Run the real `scrml build` and return { code, out }. stderr is captured on the
 *  SUCCESS path too — a zero-exit build can still carry diagnostics. */
function build(files) {
  const root = join(TMP, `c${_n++}`);
  const src = join(root, "src");
  for (const [rel, s] of Object.entries(files)) {
    const abs = join(src, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s);
  }
  try {
    const out = execFileSync("bun", [CLI, "build", src, "--output", join(root, "dist")], {
      encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: String(out ?? "") };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const prog = (attrs, fn) => `<program csrf="off"${attrs}>
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>go</button>
</program>`;

describe("E-MW-008 and E-MW-007 are discriminated on disjoint inputs (real CLI)", () => {
  test("a pipeline conflict with NO session config still reports E-MW-007, not E-MW-008", () => {
    // `log=` on both programs is E-MW-007's trigger. Neither declares session config,
    // so E-MW-008 has nothing to contest and must stay silent.
    const r = build({
      "index.scrml": prog(` log="true"`, "aGo"),
      "other/zzz.scrml": prog(` log="true"`, "bGo"),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-007");
    expect(r.out).not.toContain("E-MW-008");
  });

  test("a session-config conflict with NO pipeline attrs reports E-MW-008", () => {
    // The mirror image, through the same channel, so the pair is a real
    // discrimination rather than one assertion and a hope.
    const r = build({
      "index.scrml": prog(` sessionExpiry="7d" session-secure="false"`, "aGo"),
      "other/zzz.scrml": prog("", "bGo"),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-008");
    expect(r.out).not.toContain("E-MW-007");
  });
});
