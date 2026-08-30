/**
 * S385 — `g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm`
 *
 * ## What this pins
 *
 * A cross-file channel (SPEC §38.12) mounted via `<alias/>` inside a `<match>`
 * arm or an `<each>` body is REFUSED with `E-CHANNEL-MOUNT-IN-CONDITIONAL`,
 * naming the shape and the one-line fix.
 *
 * ## Why refusal rather than support
 *
 * CHX inlines a channel by replacing the mount IN PLACE (§38.12.2). At
 * `<program>` level that lands the channel's cells, its exported functions and
 * its WebSocket layer at FILE scope — what §38.12.3's per-importer mirror needs.
 * Inside a conditional container it cannot:
 *
 *   - every collector feeding channel emission descends `node.children` only,
 *     and a `<match>` is `kind:"match-block"` with NO `children`;
 *   - an each-bearing arm is BLANKED by ast-builder (S316) and its body stashed
 *     as raw TEXT, so the mount is not even a node at CE time;
 *   - even with every collector taught to descend, the type-system binds the
 *     inlined cells in the ARM's lexical scope while the runtime mirror is
 *     file-scoped.
 *
 * Measured parity gap for an arm mount vs a top-level mount: the channel's
 * exported `beat` reaches `.server.js` 0 times vs 1, and the client carries 1
 * `stamp` init/set vs 4. Accepting the shape half-wired would take a loud
 * compile error and turn it into an app that ships dead `<probeChan />` markup
 * at exit 0 — a fail-closed → fail-open move, which base §8 does not admit as a
 * bug fix. So it fails CLOSED.
 *
 * The assertions below deliberately check CELL DECLS and the EXPORTED FUNCTION,
 * not just the WebSocket transport: the transport alone is satisfied by a
 * half-wired channel and would let this suite pass while the feature is broken.
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

function codes(result) {
  return (result.errors ?? []).map((e) => e.code || "");
}

function compileIn(dir, body) {
  fx(`${dir}/chan.scrml`, CHANNEL_SRC);
  const consumer = fx(`${dir}/app.scrml`, body);
  const result = compileScrml({
    inputFiles: [consumer],
    outputDir: join(TMP, `${dir}-out`),
    write: false,
    log: () => {},
  });
  return { result, consumer, out: result.outputs?.get(consumer) };
}

// ---------------------------------------------------------------------------
// REFUSED — every shape CHX cannot wire
// ---------------------------------------------------------------------------

describe("S385 — a channel mounted in a conditional container is REFUSED", () => {
  test("direct child of a `<match>` arm", () => {
    const { result } = compileIn("r1", `<program>
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
    expect(codes(result)).toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
  });

  test("NESTED one level inside the arm — `<div><probeChan/></div>`", () => {
    // The mount need not be a direct child of the arm wrapper. An earlier
    // iteration of this fix inspected only top-level wrapper children, accepted
    // this shape, and shipped `<div><probeChan /></div>` into the DOM verbatim.
    const { result, out } = compileIn("r2", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <div><probeChan/></div>
            <p>${D}{@stamp}</p>
        </>
    </>
</program>
`);
    expect(codes(result)).toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    // The build is REJECTED, which is the whole point — the author cannot ship
    // this. (Note: `compileScrml` still populates `outputs` on a failed compile,
    // and that in-memory client body does still carry the raw `<div><probeChan
    // /></div>` string. That is pre-existing behaviour of the failure path and
    // is exactly why the refusal has to be a hard error rather than a lint.)
    expect(hardErrors(result).length).toBeGreaterThan(0);
  });

  // ⚑ RULED FAIL-OPEN — the adopter's exact shape is NOT detected.
  //
  // An each-bearing bare-body arm is blanked by ast-builder (S316) BEFORE CE
  // runs and its body survives only as a raw source string, so there is no tree
  // to ask. A revision of this check DID scan that text stash; it was DELETED
  // because a text scan cannot tell a mount from a mention — a
  // `<!-- don't mount <probeChan/> here -->` comment inside such an arm made a
  // VALID file uncompilable (pinned CLEAN below, "a COMMENT naming the alias").
  // Masking comments/strings was considered and rejected as enumerate-forever.
  //
  // So this shape compiles CLEAN and ships dead markup. Known, filed,
  // deliberate. Closing it means giving CE a walkable arm body — an
  // ast-builder/S316 change — which is its own arc.
  test.todo(
    "REFUSE a channel mounted inside an EACH-BEARING match arm (the adopter's " +
    "shape). Blocked on CE having a walkable arm body: S316 blanks the arm " +
    "before CE runs, and the deleted text-scan alternative false-accused any " +
    "comment/<pre>/string naming the alias.",
  );

  test("arm mount with NO cell read — the shape that used to compile CLEAN and ship dead markup", () => {
    // Pre-S385 this exited 0 and emitted `return "<probeChan />…"` into the
    // client bundle: a bogus tag in the DOM, no route, no IIFE, no cell mirror.
    // Nothing failed, so nothing told the author. This is the fail-open case the
    // refusal exists to close.
    const { result } = compileIn("r4", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <probeChan/>
            <p>plain</p>
        </>
    </>
</program>
`);
    expect(codes(result)).toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
  });

  test("an `<each>` BODY mount says \"body\", never \"arm\", in BOTH clauses", () => {
    // The trailing back-reference was hardcoded to "this arm" while the opening
    // container label was computed, so an `<each>` mount read:
    //   "is mounted inside an `<each>` body … including inside this arm"
    // naming a construct that is not there.
    const { result } = compileIn("x1", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        <rows> = [1, 2]
    }
    <each in=@rows as r>
        <probeChan/>
    </each>
    <p>${D}{@stamp}</p>
</program>
`);
    const diag = (result.errors ?? []).find(
      (e) => e.code === "E-CHANNEL-MOUNT-IN-CONDITIONAL",
    );
    expect(diag).toBeTruthy();
    expect(diag.message).toMatch(/mounted inside an `<each>` body/);
    expect(diag.message).not.toMatch(/this arm/);
  });

  test("a `<match>` ARM mount still says \"arm\" in both clauses", () => {
    const { result } = compileIn("x2", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><probeChan/></>
    </>
</program>
`);
    const diag = (result.errors ?? []).find(
      (e) => e.code === "E-CHANNEL-MOUNT-IN-CONDITIONAL",
    );
    expect(diag).toBeTruthy();
    expect(diag.message).toMatch(/mounted inside a `<match>` arm/);
    expect(diag.message).toMatch(/including inside this arm/);
  });

  test("inside an `<engine>` STATE-CHILD body", () => {
    // Round-6. An `<engine>` is `kind: "engine-decl"`, which `_expandChannelNode`
    // reaches no better than a `<match>` — it descends markup/state/logic only.
    // A channel mounted in a state-child body compiled at exit 0 with ZERO
    // diagnostics, shipped the raw tag into clientJs and emitted no `_scrml_ws`
    // wiring: the identical silent dead-channel outcome as the match case.
    const { result } = compileIn("y1", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type LoadPhase:enum = { Idle, Done }
    }
    <engine for=LoadPhase initial=.Idle>
        <Idle rule=.Done></>
        <Done rule=.Idle><probeChan/></>
    </>
</program>
`);
    const diag = (result.errors ?? []).find(
      (e) => e.code === "E-CHANNEL-MOUNT-IN-CONDITIONAL",
    );
    expect(diag).toBeTruthy();
    expect(diag.message).toMatch(/mounted inside an `<engine>` state-child body/);
    // Container noun must track the label — never "this arm".
    expect(diag.message).toMatch(/including inside this state-child body/);
    expect(diag.message).not.toMatch(/this arm/);
  });

  test("REGRESSION GUARD — an alias colliding with an ENGINE state-child variant, mounted at top level", () => {
    // The engine analogue of the round-3 blocker. A state-child is
    // author-written markup whose TAG is a variant name, and the AST carries no
    // marker separating it from a mount (measured: identical key sets). Direct
    // `bodyChildren` entries are therefore never classified, so an alias named
    // `Done` beside a `<Done rule=…>` state-child must NOT be accused.
    const { result } = compileIn("y2", `<program>
    ${D}{
        import { "probe" as Done } from './chan.scrml'
        type LoadPhase:enum = { Idle, Done }
    }
    <Done/>
    <engine for=LoadPhase initial=.Idle>
        <Idle rule=.Done></>
        <Done rule=.Idle></>
    </>
    <p>${D}{@stamp}</p>
</program>
`);
    expect(codes(result)).not.toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hardErrors(result)).toEqual([]);
  });

  test("the message names the alias AND the top-level-mount fix", () => {
    const { result } = compileIn("r5", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><probeChan/></>
    </>
</program>
`);
    const diag = (result.errors ?? []).find(
      (e) => e.code === "E-CHANNEL-MOUNT-IN-CONDITIONAL",
    );
    expect(diag).toBeTruthy();
    expect(diag.message).toMatch(/probeChan/);
    expect(diag.message).toMatch(/<program>/);
    // It must carry a source location, not just prose.
    expect(diag.span?.line).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ACCEPTED — and FULLY wired. These are the negative controls.
// ---------------------------------------------------------------------------

describe("S385 — supported mount positions stay accepted AND fully wired", () => {
  test("top-level mount: transport + cell decls + exported server fn", () => {
    const { result, out } = compileIn("k1", `<program>
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
    expect(hardErrors(result)).toEqual([]);

    // Transport.
    expect(out.clientJs).toMatch(/_scrml_ws[\w/-]*probe/);
    // Cell mirror — NOT implied by the transport alone.
    expect(out.clientJs).toMatch(/syncShared\("stamp"/);
    // Cell decls actually emitted. A half-wired channel emits far fewer.
    const stampWrites = (out.clientJs.match(/_scrml_cs_(?:init_set|reactive_set)\("stamp"/g) ?? []).length;
    expect(stampWrites).toBeGreaterThanOrEqual(2);
    // The channel's exported function reaches the server bundle — calling
    // `beat(...)` is a ReferenceError without this.
    expect(out.serverJs ?? "").toMatch(/\bbeat\b/);
    // Exactly one channel IIFE.
    expect((out.clientJs.match(/const _scrml_ws_probe = /g) ?? []).length).toBe(1);
  });

  test("the documented workaround compiles and is fully wired", () => {
    // This is the fix the diagnostic tells the adopter to make: move the mount
    // out of the arm. The arm keeps BOTH the `${@stamp}` read and the `<each>`.
    const { result, out } = compileIn("k2", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <probeChan/>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <p>${D}{@stamp}</p>
            <each in=@items as i key=i.id><li>${D}{i.id}</li></each>
        </>
    </>
</program>
`);
    expect(hardErrors(result)).toEqual([]);
    expect(out.clientJs).toMatch(/_scrml_ws[\w/-]*probe/);
    expect(out.serverJs ?? "").toMatch(/\bbeat\b/);
  });

  test("REGRESSION GUARD — an `<if>` body mount is NOT refused (it is a markup node and works today)", () => {
    const { result, out } = compileIn("k3", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        <flag> = true
    }
    <if test=@flag>
        <probeChan/>
    </if>
    <p>${D}{@stamp}</p>
</program>
`);
    expect(codes(result)).not.toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hardErrors(result)).toEqual([]);
    expect(out.clientJs).toMatch(/_scrml_ws[\w/-]*probe/);
  });

  test("REGRESSION GUARD — a read inside a match arm with a top-level mount stays clean", () => {
    const { result } = compileIn("k4", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <probeChan/>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><p>${D}{@stamp}</p></>
    </>
</program>
`);
    // Mount position does not scope a channel — the arm read resolves fine.
    expect(codes(result)).not.toContain("E-STATE-UNDECLARED");
    expect(hardErrors(result)).toEqual([]);
  });

  test("a COMMENT naming the alias inside an each-bearing arm stays CLEAN", () => {
    // THE round-4 regression. The deleted text-scan path matched the alias
    // inside an HTML comment and refused a file whose mount is correctly at
    // `<program>` level — a valid file made uncompilable by a comment. Compiles
    // clean on `main`; must compile clean here.
    const { result } = compileIn("w1", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
        <rows> = [1, 2]
    }
    <probeChan/>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <!-- do not mount <probeChan/> here -->
            <each in=@rows as r><li>${D}{r}</li></each>
        </>
    </>
</program>
`);
    expect(codes(result)).not.toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hardErrors(result)).toEqual([]);
  });

  test("a `<pre>` block naming the alias inside an each-bearing arm stays CLEAN", () => {
    // Same class as the comment case: any textual MENTION of the alias.
    const { result } = compileIn("w2", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
        <rows> = [1, 2]
    }
    <probeChan/>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <pre>example: &lt;probeChan/&gt;</pre>
            <each in=@rows as r><li>${D}{r}</li></each>
        </>
    </>
</program>
`);
    expect(codes(result)).not.toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hardErrors(result)).toEqual([]);
  });

  test("OUT-OF-SCOPE GUARD — `<each in=@undeclared>` is still not checked", () => {
    // S385 brief, Observation 3 / variant G: `<each in=…>` reads are never
    // routed through the E-STATE-UNDECLARED predicate. Closing that is
    // newly-REJECTING and owes its own measured migration, so it stays open.
    // Pinned so the conditional-mount refusal cannot start rejecting it.
    const consumer = fx("k5/app.scrml", `<program>
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
      outputDir: join(TMP, "k5-out"),
      write: false,
      log: () => {},
    });
    expect(hardErrors(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Known-unfixed — recorded so CI carries the debt rather than a doc
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-3 review regressions
// ---------------------------------------------------------------------------

describe("S385 — the refusal must not misfire on a correctly-placed mount", () => {
  test("BLOCKER: a channel alias equal to an ENUM VARIANT NAME, mounted at top level", () => {
    // `match-block.armBodyChildren` holds SYNTHETIC wrapper nodes fabricated by
    // ast-builder as `{kind:"markup", tag: arm.variantName}` — indistinguishable
    // from author markup. An earlier iteration searched the wrapper ARRAY, so an
    // alias colliding with a variant name matched the fabrication and this file
    // was refused for being "inside a `<match>` arm" while the mount sits
    // correctly at `<program>` level. The instruction was unfollowable and the
    // file could not be compiled at all — a newly-rejecting regression on code
    // that compiles clean on `main`.
    //
    // The suite previously only ever used `probeChan`, which can never collide,
    // which is exactly why this shipped.
    const { result } = compileIn("v1", `<program>
    ${D}{
        import { "probe" as Ready } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <Ready/>
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><p>${D}{@stamp}</p></>
    </>
</program>
`);
    expect(codes(result)).not.toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hardErrors(result)).toEqual([]);
  });

  test("a colliding alias mounted INSIDE the arm is still refused (detection not merely disabled)", () => {
    // The guard above must not be implemented by ignoring colliding names.
    const { result } = compileIn("v2", `<program>
    ${D}{
        import { "probe" as Ready } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready><Ready/><p>${D}{@stamp}</p></>
    </>
</program>
`);
    expect(codes(result)).toContain("E-CHANNEL-MOUNT-IN-CONDITIONAL");
  });

  test("a mount inside a NESTED match reports EXACTLY ONCE", () => {
    // Previously every container searched its own subtree, so the outer and the
    // inner match each reported the same mount, with different spans, and
    // nothing de-duplicated. Each mount is now attributed to its NEAREST
    // enclosing container.
    const { result } = compileIn("v3", `<program>
    ${D}{
        import { "probe" as probeChan } from './chan.scrml'
        type Phase:enum = { Loading, Ready }
        <phase>: Phase = .Ready
        <inner>: Phase = .Loading
    }
    <match for=Phase on=@phase>
        <Loading><p>loading</p></>
        <Ready>
            <match for=Phase on=@inner>
                <Loading><p>i-loading</p></>
                <Ready><probeChan/></>
            </>
        </>
    </>
</program>
`);
    const hits = codes(result).filter((c) => c === "E-CHANNEL-MOUNT-IN-CONDITIONAL");
    expect(hits.length).toBe(1);
  });
});

describe("S385 — deferred", () => {
  test.todo(
    "REFUSE a channel mounted as a DIRECT child of an <engine> body (sibling " +
    "of the state-children, not inside one). It emits nothing at all — no tag, " +
    "no wiring — so it is silent too, but direct bodyChildren entries cannot be " +
    "classified without a variant-name oracle: a state-child and a mount have " +
    "identical AST key sets, so firing there would false-accuse an alias " +
    "colliding with a variant name.",
  );

  test.todo(
    "SUPPORT (not merely refuse) a channel mounted inside a <match> arm — " +
    "needs full parity: every channel collector descending armBodyChildren, the " +
    "S316 raw-arm stranding addressed, and the TS arm-lexical-scope vs runtime " +
    "file-scope mismatch reconciled. The last item contradicts §38.12.2's " +
    "in-place inline algorithm, so it is a SPEC question, not a bug fix.",
  );
});
