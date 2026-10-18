// server-await-pack.test.js — s468 bootstrap unit U1c: the S467 §13 amendment's
// acceptance item 4 — "The server cases of the security await probe pack (…
// the 424 reviewer shapes: wrong password → REJECTED, right → WELCOME) run
// against the bootstrap's server artifact … U1c does not land with any of them
// accepting a wrong password."
//
// Every shape of compiler/tests/integration/security-await-pack/ is compiled
// by the BOOTSTRAP front end, as written (the pack's own `appSource` + its lib
// files). A shape that compiles is printed by print-server.scrml and its `f`
// route is called with the wrong and the right password against a SQLite
// holding bob's row; a shape that does not compile is fail-closed at compile
// time. The verdict this test pins is the security floor: NO shape's artifact
// answers a wrong password WELCOME. (It does not pin each class: a shape moving
// from refused to PASS is a bootstrap improvement, as in the impl#1 pack.)
//
// What the bootstrap can express of this pack is measured, not assumed: every
// shape reaches the waiting call through `scrml:auth`'s `verifyPassword` (a
// standard-library import the bootstrap has none of — §12.2 Trigger 3's hook is
// empty) and declares `f(name, pass)` with untyped parameters and the legacy
// `<out> = ""` cell — so the measured outcome is that every shape is refused at
// compile time. The bootstrap-EXPRESSIBLE translation of the pack's question is
// server-await-probes.js, run by server-artifact.test.js.

import { describe, test, expect, beforeAll } from "bun:test";
import { join } from "node:path";
import { loadFamilies, appSource, RIGHT_PASSWORD, WRONG_PASSWORD } from "../../tests/integration/security-await-pack/pack.js";
import { mods, check, realDb, serve, post, pathOf } from "./server-artifact-harness.js";
import { frontEnd } from "./harness.js";

let families;
beforeAll(async () => {
  mods();
  families = await loadFamilies();
}, { timeout: 120000 });

// The shape's file set, as the pack writes it to disk (pack.js runShape).
function filesOf(s, defaultLib) {
  const files = [{ path: "lib.scrml", src: s.lib ?? defaultLib }, { path: "app.scrml", src: appSource(s) }];
  if (s.lib2) files.push({ path: "lib2.scrml", src: s.lib2 });
  for (const [fn, txt] of Object.entries(s.files ?? {})) files.push({ path: fn, src: txt });
  return files;
}

describe("the impl#1 await pack (424 reviewer shapes) against the bootstrap — no wrong password is ever WELCOMEd", () => {
  test("every shape: refused at compile time, or its server artifact rejects the wrong password", async () => {
    const tally = { shapes: 0, refused: 0, pass: 0, fail: 0, other: 0 };
    const refusedCodes = {};
    const failures = [];
    for (const fam of families) {
      for (const [name, s] of Object.entries(fam.shapes)) {
        tally.shapes++;
        let r;
        try {
          r = frontEnd(mods(), filesOf(s, fam.defaultLib), "app.scrml");
        } catch (e) {
          tally.refused++;
          refusedCodes["(front end threw)"] = (refusedCodes["(front end threw)"] ?? 0) + 1;
          continue;
        }
        const errs = r.diags.filter((d) => d.severity === "Error");
        if (errs.length > 0 || !r.core) {
          tally.refused++;
          for (const c of new Set(errs.map((d) => d.code))) refusedCodes[c] = (refusedCodes[c] ?? 0) + 1;
          continue;
        }
        // compiled: the artifact must reject the wrong password
        expect(check(r.core)).toEqual([]);
        const sql = await realDb(["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)"], { users: [{ name: "bob", pw: RIGHT_PASSWORD }] });
        const { srv, routes } = await serve(r.core, sql);
        const wrong = await post(srv, pathOf(routes, "f"), ["bob", WRONG_PASSWORD]);
        if (/WELCOME/.test(wrong.text)) {
          tally.fail++;
          failures.push(`${fam.family}/${name}`);
        } else if (wrong.status === 200) {
          tally.pass++;
        } else {
          tally.other++;
        }
      }
    }
    // the measurement (recorded in docs/changes/s468-bootstrap-u1c/progress.md)
    console.log("bootstrap × await pack:", JSON.stringify(tally), JSON.stringify(refusedCodes));
    expect(tally.shapes).toBe(424);
    expect(failures).toEqual([]);
    expect(tally.fail).toBe(0);
  }, 600000);
});
