/**
 * S449 ruling items 1 and 4 (ruling:user-voice-scrml.md S449 "RULED — 'your recs.'")
 * — the two newly-rejecting auth codes refuse the WRITE, through the real CLI.
 *
 * Both shapes used to compile to FAIL-OPEN server units: `@session.<field>` in a
 * server function read the caller's identity from the request body, and an
 * unrecognized `<program auth=…>` served a public application. A build that only
 * exits 1 still leaves those units in dist/, runnable by a `_server.js` from an
 * earlier build — the reason E-PROGRAM-NESTED-AUTH refuses the write
 * (commands/refusal-gate.js). The new codes join that set.
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
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s449-auth-refusal-")); });
afterAll(() => { try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {} });

let n = 0;
function project(source) {
  const root = join(TMP, `p${n++}`);
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "index.scrml"), source);
  return { root, src, dist: join(root, "dist") };
}
function build(p) {
  try {
    const out = execFileSync("bun", [CLI, "build", p.src, "--output", p.dist], { encoding: "utf8", cwd: p.root, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: String(out ?? "") };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("S449 auth refusals write no dist (real CLI)", () => {
  test("E-SESSION-AMBIENT-SERVER — a server `@session` read", () => {
    const p = project(`<program db="./notes.db" auth="required">
function saveNote(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${@session.userId}, \${body})\`}.run()
}
<button onclick=saveNote("x")>save</>
</program>
`);
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-SESSION-AMBIENT-SERVER");
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
  });

  for (const attr of [' auth="Required"', ' auth=""', " auth", ' auth="role:admin"']) {
    test(`E-AUTH-ATTR-INVALID — <program${attr}>`, () => {
      const p = project(`<program${attr}>\n<p>home</p>\n</program>\n`);
      const r = build(p);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("E-AUTH-ATTR-INVALID");
      expect(r.out).toContain("No files were written");
      expect(existsSync(p.dist)).toBe(false);
    });
  }

  test('E-AUTH-ATTR-INVALID — <page auth="Required"> in an application', () => {
    const root = join(TMP, `p${n++}`);
    const src = join(root, "src");
    mkdirSync(join(src, "pages"), { recursive: true });
    writeFileSync(join(src, "app.scrml"), `<program auth="required">\n<p>home</p>\n</program>\n`);
    writeFileSync(join(src, "pages", "login.scrml"), `<page auth="Required">\n<p>login</p>\n</page>\n`);
    const r = build({ root, src, dist: join(root, "dist") });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-AUTH-ATTR-INVALID");
    expect(existsSync(join(root, "dist"))).toBe(false);
  });

  test("the migrated `session.userId` form builds", () => {
    const p = project(`<program db="./notes.db" auth="required">
function saveNote(body: string) {
    ?{\`INSERT INTO notes (sid, body) VALUES (\${session.userId}, \${body})\`}.run()
}
<button onclick=saveNote("x")>save</>
</program>
`);
    const r = build(p);
    expect(r.out).not.toContain("E-SESSION-AMBIENT-SERVER");
    expect(r.out).not.toContain("No files were written");
    expect(existsSync(p.dist)).toBe(true);
  });
});
