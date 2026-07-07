/**
 * CONF-CHANNEL-WATCHES | §34 / §38.13.8 — realtime feed over external DB writes
 *
 * The six `<channel watches=<table>>` diagnostics (SPEC §38.13.8; Phase 1
 * front-end, realtime-external-db-writes-2026-07-06):
 *   - E-CHANNEL-WATCHES-DRIVER        (Error, §38.13.1 — non-postgres driver)
 *   - E-CHANNEL-WATCHES-UNKNOWN-TABLE (Error, §38.13.1 — table not <schema>'d)
 *   - E-CHANNEL-WATCHES-CLIENT-WRITE  (Error, §38.13.4 — synced-cell decl)
 *   - E-CHANNEL-WATCHES-BROADCAST     (Error, §38.13.4 — broadcast()/disconnect())
 *   - W-CHANNEL-WATCHES-NO-PK         (Warning, §38.13.2 — no derivable PK/key=)
 *   - W-CHANNEL-WATCHES-NO-CONSUMER   (Warning, §38.13.3 — no <onchange>)
 *
 * Firing site: SYM pass, compiler/src/symbol-table.ts walkValidateWatchesChannels.
 * Errors land in result.errors (CLI exit 1); the W- codes in result.warnings
 * (S92/S93 partition — asserted against the stream they belong to).
 */
import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const SCHEMA = `  <schema>
    orders {
      id: int primary key
      status: string
      total: number
    }
  </schema>`;
const ONCHANGE = `    <onchange>
      <Inserted(row) : logIt(row)>
      <Updated(row) : logIt(row)>
      <Deleted(key) : logIt(key)>
    </onchange>`;
const pg = (body) => `<program db="postgres://localhost/app">\n${SCHEMA}\n${body}\n</program>\n`;

describe("CONF-CHANNEL-WATCHES §38.13.8", () => {
  test("POS: sqlite driver → E-CHANNEL-WATCHES-DRIVER in result.errors", () => {
    const { errors } = compile(`<program db="sqlite:app.db">\n${SCHEMA}\n  <channel name="f" watches=orders>\n${ONCHANGE}\n  </channel>\n</program>\n`, "driver");
    expect(errors.some((e) => e.code === "E-CHANNEL-WATCHES-DRIVER")).toBe(true);
  });

  test("POS: undeclared table → E-CHANNEL-WATCHES-UNKNOWN-TABLE in result.errors", () => {
    const { errors } = compile(pg(`  <channel name="f" watches=widgets>\n${ONCHANGE}\n  </channel>`), "unknown");
    expect(errors.some((e) => e.code === "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(true);
  });

  test("POS: synced-cell decl in body → E-CHANNEL-WATCHES-CLIENT-WRITE in result.errors", () => {
    const { errors } = compile(pg(`  <channel name="f" watches=orders>\n    <x> = 0\n${ONCHANGE}\n  </channel>`), "clientwrite");
    expect(errors.some((e) => e.code === "E-CHANNEL-WATCHES-CLIENT-WRITE")).toBe(true);
  });

  test("POS: broadcast() in body → E-CHANNEL-WATCHES-BROADCAST in result.errors", () => {
    const { errors } = compile(pg(`  <channel name="f" watches=orders>\n    \${ function ping() { broadcast({}) } }\n${ONCHANGE}\n  </channel>`), "broadcast");
    expect(errors.some((e) => e.code === "E-CHANNEL-WATCHES-BROADCAST")).toBe(true);
  });

  test("POS: no PK/key= → W-CHANNEL-WATCHES-NO-PK in result.warnings (Warning, not error)", () => {
    const NOPK = `  <schema>\n    events {\n      label: string\n      ts: number\n    }\n  </schema>`;
    const { errors, warnings } = compile(`<program db="postgres://localhost/app">\n${NOPK}\n  <channel name="f" watches=events>\n${ONCHANGE}\n  </channel>\n</program>\n`, "nopk");
    const hit = warnings.find((w) => w.code === "W-CHANNEL-WATCHES-NO-PK");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warning");
    expect(errors.some((e) => e.code === "W-CHANNEL-WATCHES-NO-PK")).toBe(false);
  });

  test("POS: no <onchange> → W-CHANNEL-WATCHES-NO-CONSUMER in result.warnings", () => {
    const { warnings } = compile(pg(`  <channel name="f" watches=orders></channel>`), "noconsumer");
    const hit = warnings.find((w) => w.code === "W-CHANNEL-WATCHES-NO-CONSUMER");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warning");
  });

  test("NEG: a valid postgres watches= channel fires none of the six codes", () => {
    const { errors, warnings } = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE}\n  </channel>`), "clean");
    const all = [...errors, ...warnings].map((d) => d.code);
    for (const c of [
      "E-CHANNEL-WATCHES-DRIVER", "E-CHANNEL-WATCHES-UNKNOWN-TABLE",
      "E-CHANNEL-WATCHES-CLIENT-WRITE", "E-CHANNEL-WATCHES-BROADCAST",
      "W-CHANNEL-WATCHES-NO-PK", "W-CHANNEL-WATCHES-NO-CONSUMER",
      "E-MATCH-NOT-EXHAUSTIVE", "E-STRUCTURAL-ELEMENT-MISPLACED",
    ]) expect(all).not.toContain(c);
  });
});
