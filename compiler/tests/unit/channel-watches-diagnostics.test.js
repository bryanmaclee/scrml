// ---------------------------------------------------------------------------
// §38.13 — `<channel watches=<table>>` realtime feed (Phase 1 front-end):
// recognition + the six §38.13.8 diagnostics + `<onchange>` exhaustiveness +
// placement, end-to-end via compileScrml.
//
// Cross-stream partition (S92/S93): §34 Errors land in result.errors (CLI exit
// 1); W-/I- diagnostics land in result.warnings. A code is asserted against the
// stream it belongs to — a `result.errors.filter(W-…)` silently passes, so the
// warning checks read result.warnings.
//
// SPEC §38.13.1 (watches=/key=), §38.13.2 (RowChange), §38.13.3 (<onchange>),
// §38.13.4 (read-only forbidden set), §38.13.8 (the six codes).
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "channel-watches-"));
  try {
    const p = join(dir, "app.scrml");
    writeFileSync(p, src);
    const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(dir, "out") });
    return {
      errorCodes: (r.errors ?? []).map((e) => e.code),
      warningCodes: (r.warnings ?? []).map((e) => e.code),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const hasErr = (r, code) => r.errorCodes.includes(code);
const hasWarn = (r, code) => r.warningCodes.includes(code);

const SCHEMA_ORDERS = `  <schema>
    orders {
      id: int primary key
      status: string
      total: number
    }
  </schema>`;

const ONCHANGE_FULL = `    <onchange>
      <Inserted(row) : logIt(row)>
      <Updated(row) : logIt(row)>
      <Deleted(key) : logIt(key)>
    </onchange>`;

function pg(body) {
  return `<program db="postgres://localhost/app">\n${SCHEMA_ORDERS}\n${body}\n</program>\n`;
}

// ---------------------------------------------------------------------------

describe("§38.13 valid watches= channel — CLEAN (no watches diagnostics)", () => {
  const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
  test("fires none of the six §38.13.8 codes", () => {
    for (const c of [
      "E-CHANNEL-WATCHES-DRIVER",
      "E-CHANNEL-WATCHES-UNKNOWN-TABLE",
      "E-CHANNEL-WATCHES-CLIENT-WRITE",
      "E-CHANNEL-WATCHES-BROADCAST",
    ]) expect(hasErr(r, c)).toBe(false);
    for (const c of ["W-CHANNEL-WATCHES-NO-PK", "W-CHANNEL-WATCHES-NO-CONSUMER"]) {
      expect(hasWarn(r, c)).toBe(false);
    }
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
    expect(hasErr(r, "E-STRUCTURAL-ELEMENT-MISPLACED")).toBe(false);
    // watches=/key= bare-ident values do NOT false-fire E-SCOPE-001.
    expect(hasErr(r, "E-SCOPE-001")).toBe(false);
  });
});

describe("§38.13.1 E-CHANNEL-WATCHES-DRIVER — non-postgres driver", () => {
  test("sqlite driver → fires (Error)", () => {
    const r = compile(`<program db="sqlite:app.db">\n${SCHEMA_ORDERS}\n  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>\n</program>\n`);
    expect(hasErr(r, "E-CHANNEL-WATCHES-DRIVER")).toBe(true);
  });
  test("postgres driver → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-DRIVER")).toBe(false);
  });
});

describe("§38.13.1 E-CHANNEL-WATCHES-UNKNOWN-TABLE — table not <schema>-declared", () => {
  test("unknown table → fires (Error)", () => {
    const r = compile(pg(`  <channel name="widgets-feed" watches=widgets>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(true);
  });
  test("declared table → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-UNKNOWN-TABLE")).toBe(false);
  });
});

describe("§38.13.2 W-CHANNEL-WATCHES-NO-PK — no derivable PK, no key=", () => {
  const NOPK_SCHEMA = `  <schema>\n    events {\n      label: string\n      ts: number\n    }\n  </schema>`;
  test("no id/PK and no key= → fires (Warning stream)", () => {
    const r = compile(`<program db="postgres://localhost/app">\n${NOPK_SCHEMA}\n  <channel name="events-feed" watches=events>\n${ONCHANGE_FULL}\n  </channel>\n</program>\n`);
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(true);
    expect(hasErr(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false); // partition — never an error
  });
  test("key= override supplied → does NOT fire", () => {
    const r = compile(`<program db="postgres://localhost/app">\n${NOPK_SCHEMA}\n  <channel name="events-feed" watches=events key=label>\n${ONCHANGE_FULL}\n  </channel>\n</program>\n`);
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false);
  });
  test("table with an id column → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false);
  });
});

describe("§38.13.3 W-CHANNEL-WATCHES-NO-CONSUMER — no <onchange>", () => {
  test("no <onchange> → fires (Warning stream)", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders></channel>`));
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-CONSUMER")).toBe(true);
  });
  test("with <onchange> → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-CONSUMER")).toBe(false);
  });
});

describe("§38.13.3 <onchange> exhaustiveness — E-MATCH-NOT-EXHAUSTIVE", () => {
  test("missing the Deleted variant → fires", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>
    <onchange>
      <Inserted(row) : logIt(row)>
      <Updated(row) : logIt(row)>
    </onchange>
  </channel>`));
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(true);
  });
  test("a wildcard `<_>` arm satisfies exhaustiveness", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>
    <onchange>
      <Inserted(row) : logIt(row)>
      <_> : noop()
    </onchange>
  </channel>`));
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
  });
  test("all three variants present → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
  });
});

describe("§38.13.4 E-CHANNEL-WATCHES-CLIENT-WRITE — synced-cell decl in body", () => {
  test("a V5-strict synced cell decl in the body → fires", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>
    <localCount> = 0
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-CLIENT-WRITE")).toBe(true);
  });
  test("no synced-cell decl → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-CLIENT-WRITE")).toBe(false);
  });
});

describe("§38.13.4 E-CHANNEL-WATCHES-BROADCAST — broadcast()/disconnect() in body", () => {
  test("a broadcast() call in the body → fires", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>
    \${ function ping() { broadcast({ x: 1 }) } }
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(true);
  });
  test("no broadcast/disconnect → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(false);
  });
});

describe("§38.13.3 <onchange> placement — E-STRUCTURAL-ELEMENT-MISPLACED", () => {
  test("<onchange> in a non-watches channel → fires", () => {
    const r = compile(pg(`  <channel name="chat">\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-STRUCTURAL-ELEMENT-MISPLACED")).toBe(true);
  });
  test("<onchange> inside a watches= channel → does NOT fire", () => {
    const r = compile(pg(`  <channel name="orders-feed" watches=orders>\n${ONCHANGE_FULL}\n  </channel>`));
    expect(hasErr(r, "E-STRUCTURAL-ELEMENT-MISPLACED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PA /code-review (S239) regressions — the diagnostics were half-baked.
// ---------------------------------------------------------------------------

describe("[#1] E-CHANNEL-WATCHES-BROADCAST — AST call-shape, NOT a raw-text regex", () => {
  test("a MEMBER call `audit.broadcast(row)` in an <onchange> arm → does NOT fire", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    <onchange>
      <Inserted(row) : audit.broadcast(row)>
      <Updated(row) : logIt(row)>
      <Deleted(key) : logIt(key)>
    </onchange>
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(false);
  });
  test("a STRING literal containing `broadcast(` → does NOT fire", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    \${ function ping() { logIt("re-broadcast(x) happened") } }
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(false);
  });
  test("a bare `disconnect()` primitive call → fires", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    \${ function ping() { disconnect() } }
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(true);
  });
  test("a bare `broadcast(x)` primitive call → fires", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    \${ function ping() { broadcast({ x: 1 }) } }
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-BROADCAST")).toBe(true);
  });
});

describe("[#2] E-CHANNEL-WATCHES-CLIENT-WRITE — a derived const is NOT a synced cell", () => {
  test("a V5-strict DERIVED const `const <x> = expr` (read-only) → does NOT fire", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    \${ @maxTotal = 5 }
    \${ const <threshold> = @maxTotal * 2 }
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-CLIENT-WRITE")).toBe(false);
  });
  test("a genuine synced cell `<x> = 0` → fires", () => {
    const r = compile(pg(`  <channel name="f" watches=orders>
    <counter> = 0
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-CHANNEL-WATCHES-CLIENT-WRITE")).toBe(true);
  });
});

describe("[#4] E-SCOPE-001 exemption is gated on the channel being a watches= feed", () => {
  test("`key=ghostVar` on a NON-watches channel → the unresolved ident scope-checks (E-SCOPE-001 fires)", () => {
    const r = compile(pg(`  <channel name="chat" key=ghostVar>
    <msgs> = []
  </channel>`));
    expect(hasErr(r, "E-SCOPE-001")).toBe(true);
  });
  test("watches=/key= bare idents on a real watches= feed do NOT false-fire E-SCOPE-001", () => {
    const r = compile(pg(`  <channel name="f" watches=orders key=id>
${ONCHANGE_FULL}
  </channel>`));
    expect(hasErr(r, "E-SCOPE-001")).toBe(false);
  });
});

describe("[#3 e2e] key= override against the watched table", () => {
  test("`key=totl` (typo, absent column) → W-CHANNEL-WATCHES-NO-PK (no silent ghost key)", () => {
    const r = compile(pg(`  <channel name="f" watches=orders key=totl>
${ONCHANGE_FULL}
  </channel>`));
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(true);
  });
  test("`key=Id` (case variant of `id`) → resolves, no W-CHANNEL-WATCHES-NO-PK", () => {
    const r = compile(pg(`  <channel name="f" watches=orders key=Id>
${ONCHANGE_FULL}
  </channel>`));
    expect(hasWarn(r, "W-CHANNEL-WATCHES-NO-PK")).toBe(false);
  });
});

describe("[#5] no watches= channel → no watches diagnostics / no crash (gated traversal)", () => {
  test("a plain channel + schema with NO watches= fires none of the six codes", () => {
    const r = compile(pg(`  <channel name="chat">
    <msgs> = []
  </channel>`));
    for (const c of ["E-CHANNEL-WATCHES-DRIVER", "E-CHANNEL-WATCHES-UNKNOWN-TABLE",
      "E-CHANNEL-WATCHES-CLIENT-WRITE", "E-CHANNEL-WATCHES-BROADCAST"]) {
      expect(hasErr(r, c)).toBe(false);
    }
    for (const c of ["W-CHANNEL-WATCHES-NO-PK", "W-CHANNEL-WATCHES-NO-CONSUMER"]) {
      expect(hasWarn(r, c)).toBe(false);
    }
  });
});
