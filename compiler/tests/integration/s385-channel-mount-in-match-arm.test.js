/**
 * S385 — `g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm`
 *
 * A cross-file channel (SPEC §38.12) mounted via `<alias/>` INSIDE a `<match>`
 * arm was invisible to three separate AST walks, all of which descended only
 * into `node.children`:
 *
 *   1. `component-expander.ts` `_expandChannelNode` — the CHX inliner. A
 *      `<match>` is `kind: "match-block"` with NO `children`; its arm bodies
 *      hang off `armBodyChildren`. The mount was therefore never inlined, so
 *      the channel's cells never entered the type-system's scopeChain and any
 *      `@cell` read fired a false `E-STATE-UNDECLARED` — contradicting SPEC
 *      §6.1.2, which names "a CE-inlined cross-file channel cell (§38.12)" in
 *      the set that SHALL be in scope.
 *
 *   2. `emit-match.ts` — the S177 "consume the CE-expanded arm body" gate
 *      probed the RAW arm text for a PascalCase opener. A channel alias is the
 *      import's local name (camelCase), so it never matched and the arm fell
 *      back to the `armsRaw` re-parse, emitting the raw `<probeChan/>` tag
 *      VERBATIM into the HTML string.
 *
 *   3. `emit-channel.ts` `collectChannelNodes` / `collectChannelFunctionMap` /
 *      `collectChannelCellMap` — so even once inlined, the channel's WebSocket
 *      layer (route + IIFE + cell mirror) was never emitted at all.
 *
 * Net pre-fix behaviour: a hard `E-STATE-UNDECLARED` with the mount+read in the
 * same arm; and — where no read made it fail — a SILENT emission of a literal
 * `<probeChan />` tag with no channel wiring whatsoever.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const D = "$";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "s385-chan-match-arm-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(rel, src) {
  const abs = join(TMP, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, src);
  return abs;
}

const CHANNEL_SRC = `export <channel name="probe">
    ${D}{
        <items> = []
        <stamp> = ""
        export function beat(n) {
            @stamp = \`tick ${D}{n}\`
        }
    }
</>
`;

function hardErrors(result) {
  return (result.errors ?? []).filter((e) => !(e.code || "").startsWith("W-"));
}

describe("S385 — cross-file channel mounted inside a <match> arm", () => {
  test("mount + `@cell` read in the same arm compiles clean (no E-STATE-UNDECLARED)", () => {
    fx("a/chan.scrml", CHANNEL_SRC);
    const consumer = fx("a/app.scrml", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <probeChan/>
            <p>${D}{@stamp}</p>
        </>
    </>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "a-out"),
      write: false,
      log: () => {},
    });

    const undeclared = (result.errors ?? []).filter(
      (e) => (e.code || "") === "E-STATE-UNDECLARED",
    );
    expect(undeclared).toEqual([]);
    expect(hardErrors(result)).toEqual([]);
  });

  test("the arm-mounted channel actually emits its WebSocket layer", () => {
    fx("b/chan.scrml", CHANNEL_SRC);
    const consumer = fx("b/app.scrml", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <probeChan/>
            <p>${D}{@stamp}</p>
        </>
    </>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "b-out"),
      write: false,
      log: () => {},
    });
    expect(hardErrors(result)).toEqual([]);

    const out = result.outputs?.get(consumer);
    expect(out).toBeTruthy();

    // The channel's client-side WebSocket layer is emitted at FILE level, the
    // same shape a top-level mount produces.
    expect(out.clientJs).toMatch(/_scrml_ws[\w/-]*probe/);
    // ...and its cells are mirrored, so `${@stamp}` reads a cell that exists.
    expect(out.clientJs).toMatch(/syncShared\("stamp"/);

    // The raw alias tag must NOT survive into the emitted markup. Pre-fix this
    // shipped literally as `return "<probeChan />..."`.
    expect(out.clientJs).not.toMatch(/<probeChan/);
    expect(out.html ?? "").not.toMatch(/<probeChan/);
  });

  test("REGRESSION GUARD — a top-level mount is unchanged (read outside the match)", () => {
    fx("c/chan.scrml", CHANNEL_SRC);
    const consumer = fx("c/app.scrml", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <probeChan/>
    <div><p>${D}{@stamp}</p></div>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><p>ready</p></>
    </>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "c-out"),
      write: false,
      log: () => {},
    });
    expect(hardErrors(result)).toEqual([]);

    const out = result.outputs?.get(consumer);
    expect(out.clientJs).toMatch(/_scrml_ws[\w/-]*probe/);
    // Exactly one channel IIFE — the arm-body walk must not double-inline.
    const iifeCount = (out.clientJs.match(/const _scrml_ws_probe = /g) ?? []).length;
    expect(iifeCount).toBe(1);
  });

  test("REGRESSION GUARD — the arm-mounted channel is wired exactly once", () => {
    fx("d/chan.scrml", CHANNEL_SRC);
    const consumer = fx("d/app.scrml", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <probeChan/>
            <p>${D}{@stamp}</p>
        </>
    </>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "d-out"),
      write: false,
      log: () => {},
    });
    expect(hardErrors(result)).toEqual([]);

    const out = result.outputs?.get(consumer);
    const iifeCount = (out.clientJs.match(/const _scrml_ws_probe = /g) ?? []).length;
    expect(iifeCount).toBe(1);
  });

  test("OUT-OF-SCOPE GUARD — `<each in=@undeclared>` is still not checked", () => {
    // S385 brief, Observation 3 / variant G: `<each in=...>` reads are never
    // routed through the E-STATE-UNDECLARED predicate. Closing that is
    // newly-REJECTING and owes a measured corpus migration, so it is
    // explicitly NOT part of this fix. This test pins the status quo so the
    // arm-body walk above cannot silently start rejecting it.
    const consumer = fx("e/app.scrml", `<program>
    ${D}{
        <phase> = 1
    }
    <each in=@totallyUndeclaredName as x>
        <li>${D}{x}</li>
    </each>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "e-out"),
      write: false,
      log: () => {},
    });
    expect(hardErrors(result)).toEqual([]);
  });
});
