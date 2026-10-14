// security-await-pack — the wrong-password probe corpus as a permanent gate (S466, dpa-023 phase 1a).
//
// 424 shapes from nine adversarial review rounds of the §13.2 server-await fix
// (g-imported-async-server-fn-not-awaited-s465). Each shape is compiled, its server bundle loaded,
// and its `f` route called with a wrong and a right password. The floor: a wrong password is never
// answered WELCOME. See pack.js for the classes and README.md for the why.
//
// RED when: a shape not in KNOWN_FAIL accepts a wrong password; a KNOWN_FAIL shape stops accepting
// it (remove the entry); a shape not in UNJUDGED loses its server route; the shape count drifts.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPassword } from "../../../runtime/stdlib/auth.js";
import {
  loadFamilies, makeTemplateDb, runShape, PINNED_HASH, RIGHT_PASSWORD, WRONG_PASSWORD,
} from "./pack.js";
import { KNOWN_FAIL, UNJUDGED } from "./known-fail.js";

const EXPECTED_SHAPE_COUNT = 424;
const families = await loadFamilies();
const ids = families.flatMap(({ family, shapes }) => Object.keys(shapes).map((n) => `${family}/${n}`));

let root;
let templateDb;
let seq = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scrml-await-pack-"));
  templateDb = makeTemplateDb(root);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("security-await-pack: the instrument", () => {
  test(`the corpus holds ${EXPECTED_SHAPE_COUNT} shapes with unique ids`, () => {
    expect(ids.length).toBe(EXPECTED_SHAPE_COUNT);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every KNOWN_FAIL / UNJUDGED entry names a shape in the corpus", () => {
    const known = new Set(ids);
    expect(Object.keys(KNOWN_FAIL).filter((id) => !known.has(id))).toEqual([]);
    expect(Object.keys(UNJUDGED).filter((id) => !known.has(id))).toEqual([]);
  });

  test("the pinned hash is a real argon2id hash scrml:auth verifies", async () => {
    expect(PINNED_HASH.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(RIGHT_PASSWORD, PINNED_HASH)).toBe(true);
    expect(await verifyPassword(WRONG_PASSWORD, PINNED_HASH)).toBe(false);
  });
});

for (const { family, shapes, defaultLib } of families) {
  describe(`security-await-pack: ${family}`, () => {
    for (const [name, s] of Object.entries(shapes)) {
      const id = `${family}/${name}`;
      test(id, async () => {
        const r = await runShape(s, defaultLib, join(root, String(seq++)), templateDb);
        const verdict = `${id}: ${r.cls} — ${r.detail}`;
        if (KNOWN_FAIL[id]) {
          // Still failing as recorded. If this goes red the shape is FIXED: delete its entry.
          expect(verdict).toBe(`${id}: FAIL — ${r.detail}`);
        } else if (UNJUDGED[id]) {
          expect(verdict).toBe(`${id}: UNJUDGED — ${r.detail}`);
        } else {
          // THE FLOOR: a wrong password is never answered WELCOME.
          expect(r.cls === "FAIL" ? `WRONG PASSWORD ACCEPTED — ${verdict}` : "ok").toBe("ok");
          // An instrument hole must be named, not absorbed.
          expect(r.cls === "UNJUDGED" ? `NEW UNJUDGED SHAPE — ${verdict}` : "ok").toBe("ok");
        }
      }, 60_000);
    }
  });
}
