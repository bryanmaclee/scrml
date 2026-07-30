/**
 * Phase A1b Step B19 — Channels placement + `@shared` modifier rejection
 * (PASS 14: walkValidateChannels).
 *
 * Per SPEC §38.1, §38.4 (line 15468), §34 catalog rows
 * E-CHANNEL-OUTSIDE-PROGRAM (v0.3 direction) and E-CHANNEL-SHARED-MODIFIER.
 *
 * **v0.3 direction reversal (Wave 1, 2026-05-12).** This test file was
 * rewritten when the channel placement contract reversed: under v0.3,
 * channels live INSIDE `<program>` (channels are app-scope shared-state
 * vehicles, one-program-per-application). File-top channels now fire
 * `E-CHANNEL-OUTSIDE-PROGRAM` (direction REVERSED from pre-v0.3
 * `E-CHANNEL-INSIDE-PROGRAM`).
 *
 * **What B19 owns (v0.3):**
 *   1. E-CHANNEL-OUTSIDE-PROGRAM — `<channel>` reached at programDepth === 0
 *      (i.e. no `<program>` ancestor in the markup tree).
 *   2. E-CHANNEL-SHARED-MODIFIER — any `state-decl` with `isShared: true`
 *      (i.e. source contains `@shared <name> = …`).
 *
 * **S87 Insight 30 dispensation (ratified 47/44/44):** Module-file
 * `<channel>` shape — a `<channel>` at file top in a file with no
 * `<program>` element anywhere (the PURE-CHANNEL-FILE shape per §38.12.6)
 * is canonical placement and DOES NOT fire `E-CHANNEL-OUTSIDE-PROGRAM`.
 * Engine-parity rationale per §21.8 / B14 (cross-file `<engine>` admits
 * the same module-file file-top placement). Coverage in §B19.11.
 *
 * **E-CHANNEL-INSIDE-PAGE — LIVE (wired S299).** This header previously listed
 * the fire-site as deferred "for the wave that lands `<page>` parser support".
 * That precondition was met long ago while the note still read as current, so
 * the §34-catalogued code sat with ZERO fire sites and a page-nested channel
 * compiled clean AND was wired program-scoped. `walkChannelPlacement` now
 * carries a `pageDepth` counter and fires the code — coverage in §B19.12,
 * regression guards in §B19.13. See g-channel-inside-page-never-fires.
 *
 * **Out of scope (deferred to later waves):**
 *   - V5-strict access validation inside channel body (B3 owns `@cellName`).
 *   - Cross-scope channel-cell visibility (B1 PASS 1 + B3 PASS 3 cover).
 *   - Channel attribute shape errors (E-CHANNEL-001/-005/-007 — codegen).
 *   - A8 exporter-as-route-SoT contract (deferred per §38.1; CHX continues
 *     to satisfy cross-file channel access under the Insight 30 dispensation).
 *
 * Coverage areas:
 *   §B19.1 — `<channel>` inside `<program>` does NOT fire E-CHANNEL-OUTSIDE-PROGRAM
 *   §B19.2 — `<channel>` at file top level in a file WITH `<program>` fires
 *   §B19.3 — `<channel>` inside a non-program markup (program-sibling) fires
 *   §B19.4 — V5-strict channel body (`<x> = init`) does NOT fire E-CHANNEL-SHARED-MODIFIER
 *   §B19.5 — `@shared` inside channel body fires E-CHANNEL-SHARED-MODIFIER
 *   §B19.6 — `@shared` inside `<program>` (no channel) still fires (§38.4 line 15468)
 *   §B19.7 — multiple violations: each fires its own diagnostic
 *   §B19.8 — diagnostic message shape (code + spec ref + canonical fix wording)
 *   §B19.9 — span attached on the offending node
 *   §B19.10 — channel inside `<program>` + cross-scope `@cellName` access (B3 intact)
 *   §B19.11 — S87 Insight 30: module-file `<channel>` dispensation (PURE-CHANNEL-FILE)
 *   §B19.12 — E-CHANNEL-INSIDE-PAGE fires on a `<channel>` with a `<page>` ancestor
 *             (incl. the route-file shape: top-level `<page>`, no `<program>`)
 *   §B19.13 — regression guards: canonical sibling shape, PURE-CHANNEL-FILE
 *             dispensation, and E-CHANNEL-OUTSIDE-PROGRAM all undisturbed
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileSym(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const sym = runSYM({ filePath, ast: tab.ast });
  return { ast: tab.ast, tabErrors: tab.errors, sym };
}

function errorsByCode(sym, code) {
  return sym.errors.filter(e => e.code === code);
}

// ---------------------------------------------------------------------------
// §B19.1 — `<channel>` inside `<program>` does NOT fire E-CHANNEL-OUTSIDE-PROGRAM
// ---------------------------------------------------------------------------

describe("§B19.1 <channel> inside <program> is allowed (v0.3 canonical)", () => {
  test("`<channel>` direct child of `<program>` — no E-CHANNEL-OUTSIDE-PROGRAM", () => {
    const source = `<program>
\${ <draft> = "" }
<channel name="chat">
\${ <messages> = [] }
</>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("multiple `<channel>` elements inside `<program>` all allowed", () => {
    const source = `<program>
\${ <x> = 0 }
<channel name="c1">
\${ <a> = 0 }
</>
<channel name="c2">
\${ <b> = 0 }
</>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B19.2 — `<channel>` at file top level (no <program> ancestor) fires
// ---------------------------------------------------------------------------

describe("§B19.2 <channel> at file top level fires E-CHANNEL-OUTSIDE-PROGRAM", () => {
  test("file-top `<channel>` sibling of `<program>` fires", () => {
    const source = `<channel name="chat">
\${ <messages> = [] }
</>
<program>
\${ <draft> = "" }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].severity).toBe("error");
    expect(fires[0].message).toContain("E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires[0].message).toContain("§38.1");
    expect(fires[0].message).toContain("chat");
  });

  // S87 Insight 30 dispensation: file-top `<channel>` in a MODULE FILE
  // (no `<program>` element anywhere — PURE-CHANNEL-FILE shape per §38.12.6)
  // is canonical and DOES NOT fire. The case below now lives in §B19.11.
});

// ---------------------------------------------------------------------------
// §B19.3 — `<channel>` inside non-program markup at file top fires
// ---------------------------------------------------------------------------

describe("§B19.3 <channel> inside non-program markup at file top fires", () => {
  test("`<channel>` inside `<foo>` at file top fires (no `<program>` ancestor)", () => {
    // Two top-level markups: <foo> and <program>. The channel inside <foo>
    // has no `<program>` ancestor — fires under v0.3 (channels need a
    // `<program>` ancestor, no exception for non-program wrappers).
    const source = `<foo>
<channel name="weird">
\${ <a> = 0 }
</>
</foo>
<program>
\${ <x> = 0 }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §B19.4 — V5-strict channel body does NOT fire E-CHANNEL-SHARED-MODIFIER
// ---------------------------------------------------------------------------

describe("§B19.4 V5-strict channel body does not fire E-CHANNEL-SHARED-MODIFIER", () => {
  test("<x> = init inside channel body — no E-CHANNEL-SHARED-MODIFIER", () => {
    const source = `<program>
\${ <draft> = "" }
<channel name="chat">
\${
  <messages> = []
  <count> = 0
}
</>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B19.5 — `@shared` inside channel body fires
// ---------------------------------------------------------------------------

describe("§B19.5 `@shared` inside channel body fires E-CHANNEL-SHARED-MODIFIER", () => {
  test("`@shared count = 0` inside `<channel>` body fires", () => {
    const source = `<program>
\${ <x> = 0 }
<channel name="chat">
\${
  @shared count = 0
}
</>
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].severity).toBe("error");
    expect(fires[0].message).toContain("E-CHANNEL-SHARED-MODIFIER");
    expect(fires[0].message).toContain("@shared");
    expect(fires[0].message).toContain("§38.4");
  });
});

// ---------------------------------------------------------------------------
// §B19.6 — `@shared` outside any channel still fires (§38.4 line 15468)
// ---------------------------------------------------------------------------

describe("§B19.6 `@shared` anywhere fires (§38.4 line 15468)", () => {
  test("`@shared` inside `<program>` (no channel) — still fires", () => {
    const source = `<program>
\${
  @shared total = 0
}
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toContain("@shared");
  });
});

// ---------------------------------------------------------------------------
// §B19.7 — multiple violations: each fires its own diagnostic
// ---------------------------------------------------------------------------

describe("§B19.7 multiple violations fire independent diagnostics", () => {
  test("two `@shared` decls inside in-program channel — two shared fires", () => {
    // Use semicolons so the parser produces TWO separate state-decls with
    // isShared:true (without semicolons, only the first @shared in a logic
    // block becomes a state-decl; subsequent @shared lines get folded into
    // the prior init expression by collectExpr() — pre-existing TAB
    // behavior, out of scope for B19).
    //
    // Channel placement (inside `<program>`) is v0.3-canonical so it does
    // NOT fire E-CHANNEL-OUTSIDE-PROGRAM; only the @shared modifier fires.
    const source = `<program>
\${ <draft> = "" }
<channel name="nested">
\${
  @shared messages = [];
  @shared count = 0;
}
</>
</program>`;
    const { sym } = compileSym(source);
    const placementFires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    const sharedFires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(placementFires).toHaveLength(0);
    expect(sharedFires).toHaveLength(2);
    const messages = sharedFires.map(f => f.message).join("\n");
    expect(messages).toContain("messages");
    expect(messages).toContain("count");
  });

  test("multiple top-level @shared (no channel anywhere) — each fires", () => {
    const source = `<program>
\${
  @shared a = 0;
  @shared b = 1;
  @shared c = 2;
}
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(fires).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §B19.8 — diagnostic message shape (canonical fix wording)
// ---------------------------------------------------------------------------

describe("§B19.8 diagnostic messages reference spec sections + canonical fix", () => {
  test("E-CHANNEL-OUTSIDE-PROGRAM message references §38.1 + child-of-`<program>` fix", () => {
    const source = `<channel name="x">
\${ <m> = [] }
</>
<program>
\${ <draft> = "" }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const msg = fires[0].message;
    expect(msg).toContain("§38.1");
    expect(msg).toContain("§34");
    expect(msg).toContain("INSIDE");
    expect(msg).toContain("v0.3");
    // Names the channel via name= when extractable.
    expect(msg).toMatch(/name="x"/);
  });

  test("E-CHANNEL-SHARED-MODIFIER message references §38.4 + V5-strict fix wording", () => {
    const source = `<program>
\${ @shared count = 0 }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const msg = fires[0].message;
    expect(msg).toContain("§38.4");
    expect(msg).toContain("§34");
    expect(msg).toContain("V5-strict");
    expect(msg).toContain("v0.next");
    // Mentions structural form fix.
    expect(msg).toContain("<count>");
  });
});

// ---------------------------------------------------------------------------
// §B19.9 — span attached on offending node
// ---------------------------------------------------------------------------

describe("§B19.9 diagnostic span attached on the offending node", () => {
  test("E-CHANNEL-OUTSIDE-PROGRAM span points to the channel-decl node", () => {
    const source = `<channel name="x">
\${ <m> = [] }
</>
<program>
\${ <draft> = "" }
</program>`;
    const { ast, sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const fire = fires[0];
    expect(fire.span).toBeDefined();
    expect(typeof fire.span.start).toBe("number");
    expect(typeof fire.span.end).toBe("number");
    expect(fire.span.end).toBeGreaterThan(fire.span.start);
  });

  test("E-CHANNEL-SHARED-MODIFIER span points to the state-decl node", () => {
    const source = `<program>
\${ @shared count = 0 }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const fire = fires[0];
    expect(fire.span).toBeDefined();
    expect(typeof fire.span.start).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// §B19.10 — channel inside `<program>` + cross-scope @cellName access (B3 unaffected)
// ---------------------------------------------------------------------------

describe("§B19.10 channel inside <program> keeps cross-scope @cellName access (B3) intact", () => {
  test("`@messages` access from `<program>` body — placement OK + B3 resolves cell", () => {
    const source = `<program>
<channel name="chat">
\${ <messages> = [] }
</>
\${
  function send() {
    const n = @messages.length
    return n
  }
}
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER")).toHaveLength(0);
    // The channel-body cell is registered in the file scope (channel body's
    // logic block does not introduce a new scope), so the symbol table
    // contains a record for `messages`.
    expect(sym.fileScope.stateCells.has("messages")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §B19.11 — S87 Insight 30: module-file `<channel>` dispensation
// (PURE-CHANNEL-FILE per §38.12.6 — file-top channel in a file with no
//  `<program>` element anywhere is canonical and DOES NOT fire).
//
// Engine-parity rationale per §21.8 / B14 — cross-file `<engine>` already
// admits the same module-file top-level placement; channels reuse the
// precedent rather than introducing a structural asymmetry.
// ---------------------------------------------------------------------------

describe("§B19.11 module-file `<channel>` dispensation (PURE-CHANNEL-FILE, S87 Insight 30)", () => {
  test("file-top `<channel>` in module file (no `<program>` anywhere) — no fire", () => {
    // PURE-CHANNEL-FILE shape: only a `<channel>` decl, no `<program>` at all.
    // Per Insight 30 (ratified S87 47/44/44 closing §38.1 OQ), this is the
    // canonical module-file shape — silent.
    const source = `<channel name="only">
\${ <m> = [] }
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("`export <channel>` at file top in module file — no fire", () => {
    // PURE-CHANNEL-FILE shape via `export <channel>` form (per §38.12 cross-file
    // inline-expansion CHX). This is the canonical trucking-dispatch consumer
    // shape — channels/dispatch-board.scrml exports the channel; consumer pages
    // mount it via `<dispatchBoard/>` and CHX inlines the body.
    const source = `export <channel name="dispatch-board">
\${
  <boardEvents> = []
  server function publishBoardEvent(eventType, loadId, status) {
    @boardEvents = [...@boardEvents, { type: eventType }]
  }
}
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("multiple `<channel>` decls at file top in module file — no fire", () => {
    // Module file with two PURE-CHANNEL-FILE-style channels. Both admitted.
    const source = `<channel name="c1">
\${ <a> = 0 }
</>
<channel name="c2">
\${ <b> = 0 }
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("file with `<program>` + file-top `<channel>` sibling — STILL fires (regression guard)", () => {
    // The genuine canonical-violation shape: file has `<program>` BUT the
    // channel is positioned outside it. The dispensation does NOT apply
    // (fileHasProgram === true).
    const source = `<channel name="chat">
\${ <messages> = [] }
</>
<program>
\${ <draft> = "" }
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM");
    expect(fires.length).toBeGreaterThanOrEqual(1);
  });

  test("file with `<program>` + `<channel>` INSIDE it — no fire (canonical, regression guard)", () => {
    // Pre-existing v0.3 canonical: channel descends from <program>. Unchanged
    // by the dispensation. Regression guard.
    const source = `<program>
<channel name="chat">
\${ <messages> = [] }
</>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("engine-parity check: file-top `<engine>` and file-top `<channel>` in module file both silent", () => {
    // Engine-parity rationale anchor (§21.8 / B14). Both surfaces admit the
    // same module-file top-level placement under Insight 30. The walker's
    // dispensation brings `<channel>` to parity with `<engine>`.
    //
    // Engines have their own walkers (B14) and do not fire E-CHANNEL-*. We
    // verify here only that the channel-placement walker does not fire on
    // EITHER markup at file top in a module file (no `<program>` anywhere).
    const engineOnly = `<engine for="Mood" var=N>
\${ <state> = .idle }
</>`;
    const channelOnly = `<channel name="presence">
\${ <users> = [] }
</>`;
    const engineSym = compileSym(engineOnly).sym;
    const channelSym = compileSym(channelOnly).sym;
    // Engine surface: walkChannelPlacement does not fire on engines (no
    // <channel> markup). Channel surface: dispensation silences the fire.
    expect(errorsByCode(engineSym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
    expect(errorsByCode(channelSym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("module-file `<channel>` retains `@shared` rejection (orthogonal walker)", () => {
    // `walkSharedModifier` is independent of placement — `@shared` anywhere
    // still fires E-CHANNEL-SHARED-MODIFIER per §38.4 line 15468. The
    // Insight 30 dispensation does NOT relax this.
    const source = `<channel name="legacy">
\${ @shared count = 0 }
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-SHARED-MODIFIER").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §B19.12 — E-CHANNEL-INSIDE-PAGE (wired S299; g-channel-inside-page-never-fires)
// ---------------------------------------------------------------------------
//
// The code was §34/§38.9-catalogued at severity Error with ZERO fire sites, so
// a `<channel>` nested in a `<page>` compiled clean AND was wired
// program-scoped — silent acceptance of a shape three SHALL sentences forbid:
//   - §38 preamble  (SPEC.md:20659) "Channels SHALL NOT live inside `<page>`
//     (channels are app-scope, not per-route)."
//   - §38.1 inv. 1  (SPEC.md:20701) "A `<channel>` inside `<page>` SHALL emit
//     `E-CHANNEL-INSIDE-PAGE` — channels are app-scope shared-state vehicles,
//     not per-route declarations."
//   - §38.2 normat. (SPEC.md:20747) same sentence, normative-statement list.
//
// NOTE on `<page>` attrs: the allowed set is exactly `{ db, auth, csrf,
// ratelimit }` — `route=` fires E-PAGE-ROUTE-ATTR-FORBIDDEN in TAB (routes are
// derived from file path), so these fixtures use bare `<page>`.

describe("§B19.12 <channel> inside <page> fires E-CHANNEL-INSIDE-PAGE", () => {
  test("`<channel>` direct child of `<page>` inside `<program>` — fires", () => {
    const source = `<program>
<page>
<channel name="chat" topic="lobby">
\${ <messages> = [] }
</>
<h1>Chat</h1>
</page>
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fires).toHaveLength(1);
    expect(fires[0].severity).toBe("error");
  });

  test("`<channel>` DEEPLY nested inside `<page>` (below intermediate markup) — fires", () => {
    // pageDepth is an ANCESTOR count, not a direct-child check.
    const source = `<program>
<page>
<div>
<section>
<channel name="deep">
\${ <m> = [] }
</>
</section>
</div>
</page>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(1);
  });

  test("ROUTE-FILE shape: top-level `<page>` with NO `<program>` anywhere — still fires", () => {
    // The real adopter shape, and the one most likely to be missed. Route files
    // open with a top-level `<page>` and contain no `<program>` at all (see
    // examples/23-trucking-dispatch/pages/driver/messages.scrml:20), so
    // `fileHasProgram === false` here. The inside-page fire is UNCONDITIONAL on
    // that flag by design: the PURE-CHANNEL-FILE dispensation is a FILE-TOP
    // dispensation, and this channel is nested inside `<page>`, not at file top.
    // If this fire were gated on `fileHasProgram` the way OUTSIDE-PROGRAM is,
    // the whole route-file corpus would silently keep the pre-fix behaviour.
    const source = `<page auth="required">
<channel name="chat">
\${ <messages> = [] }
</>
<p>hi</p>
</page>`;
    const { sym } = compileSym(source, "pages/driver/messages.scrml");
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(1);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("MUTUAL EXCLUSION — page-nested channel reports INSIDE-PAGE only, not OUTSIDE-PROGRAM", () => {
    // One placement mistake gets ONE diagnostic. Here the `<page>` sits at file
    // top (no `<program>` ancestor) in a file that DOES contain a `<program>`,
    // so the pre-fix walker would have fired E-CHANNEL-OUTSIDE-PROGRAM. The
    // more-specific inside-page code supersedes it — its message already names
    // the canonical placement, so both codes would be redundant.
    const source = `<page>
<channel name="chat">
\${ <messages> = [] }
</>
</page>
<program>
\${ <draft> = "" }
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(1);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("two page-nested channels fire independently, one diagnostic each", () => {
    const source = `<program>
<page>
<channel name="a">
\${ <x> = 0 }
</>
</page>
<page>
<channel name="b">
\${ <y> = 0 }
</>
</page>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(2);
  });

  test("message names the canonical placement + cross-references §38.1 (in-`<program>` shape)", () => {
    const source = `<program>
<page>
<channel name="chat">
\${ <messages> = [] }
</>
</page>
</program>`;
    const { sym } = compileSym(source);
    const [fire] = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fire).toBeDefined();
    // Code prefix, so the message is greppable by code.
    expect(fire.message).toContain("E-CHANNEL-INSIDE-PAGE");
    // Names the offending channel.
    expect(fire.message).toContain('name="chat"');
    // Names the canonical placement: child of <program>, sibling of <page>.
    expect(fire.message).toContain("<program>");
    expect(fire.message).toContain("SIBLING");
    // Cross-references the governing section (brief requirement).
    expect(fire.message).toContain("§38.1");
    // This file HAS a <program>, so the fix is local — it must NOT claim the
    // fix crosses files.
    expect(fire.message).not.toContain("crosses files");
  });

  test("ROUTE-FILE message is ACTIONABLE: says the fix crosses files, gives both remedies", () => {
    // The remediation-accuracy contract. A route file has no `<program>`, so
    // "move it to be a child of `<program>`, sibling of the `<page>`
    // declarations" is unactionable here: there is no `<program>` to be a child
    // of, the `<page>` has no siblings, and the fix necessarily edits ANOTHER
    // file. Asserting the message says so, because this is the dominant
    // multi-page shape and the population the original probe came from.
    const source = `<page auth="required">
<channel name="chat">
\${ <messages> = [] }
</>
</page>`;
    const { sym } = compileSym(source, "pages/chat.scrml");
    const [fire] = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fire).toBeDefined();
    // Makes the file-crossing explicit rather than implying a local move.
    expect(fire.message).toContain("no `<program>`");
    expect(fire.message).toContain("crosses files");
    // Remedy (a): the entry file's <program>.
    expect(fire.message).toContain("entry file");
    // Remedy (b): PURE-CHANNEL-FILE + a concrete mount snippet.
    expect(fire.message).toContain("§38.12.6");
    expect(fire.message).toContain("import {");
    expect(fire.message).toContain("/>");
    // Must NOT repeat the in-<program> claim that no use-site change is needed —
    // that is false when the declaration moves to another file.
    expect(fire.message).not.toContain("the use sites do not change");
  });

  test("ROUTE-FILE mount snippet uses the ACTUAL channel name, kebab-cased alias", () => {
    // Guard against a templated snippet that hardcodes one example name: the
    // suggestion has to be copy-pasteable for THIS channel. Kebab names are not
    // identifiers, so the alias is camel-cased — matching the real consumer
    // shape `import { "driver-events" as driverEvents }` in
    // examples/23-trucking-dispatch/pages/driver/messages.scrml:25.
    const source = `<page>
<channel name="driver-events">
\${ <driverEvents> = [] }
</>
</page>`;
    const { sym } = compileSym(source, "pages/driver/messages.scrml");
    const [fire] = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fire.message).toContain('import { "driver-events" as driverEvents }');
    expect(fire.message).toContain("'./channels/driver-events.scrml'");
    expect(fire.message).toContain("<driverEvents/>");
    // The literal from the other test must not leak in as a hardcoded template.
    expect(fire.message).not.toContain("chatChannel");
  });

  test("span is attached on the offending `<channel>` node", () => {
    const source = `<program>
<page>
<channel name="chat">
\${ <messages> = [] }
</>
</page>
</program>`;
    const { sym } = compileSym(source);
    const [fire] = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fire.span).toBeDefined();
    // Line 3 is the `<channel>` opener — not line 1, which would mean the span
    // fell back to the file-anchored default.
    expect(fire.span.line).toBe(3);
  });

  test("channel with no `name=` attr still fires with the generic label", () => {
    const source = `<program>
<page>
<channel>
\${ <m> = [] }
</>
</page>
</program>`;
    const { sym } = compileSym(source);
    const fires = errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE");
    expect(fires).toHaveLength(1);
    expect(fires[0].message).toContain("`<channel>`");
  });
});

// ---------------------------------------------------------------------------
// §B19.13 — regression guards for the shapes E-CHANNEL-INSIDE-PAGE must NOT
//           disturb. The pure-channel-file dispensation is the easiest of
//           these to break, so it is asserted against BOTH codes.
// ---------------------------------------------------------------------------

describe("§B19.13 E-CHANNEL-INSIDE-PAGE does not disturb canonical shapes", () => {
  test("CANONICAL: `<channel>` as SIBLING of `<page>` inside `<program>` — no fire", () => {
    // The shape the diagnostic's message tells authors to move TO. If this ever
    // fires, the fix has inverted the rule.
    const source = `<program>
<channel name="chat" topic="lobby">
\${ <messages> = [] }
</>
<page>
<h1>Chat</h1>
</page>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("DISPENSATION REGRESSION: PURE-CHANNEL-FILE fires NEITHER placement code", () => {
    // §38.12.6 / Insight 30 — file-top `<channel>` in a file with no
    // `<program>` anywhere is CANONICAL. The inside-page fire is unconditional
    // on fileHasProgram, so this guard proves it is nonetheless page-gated and
    // did not leak into the dispensed shape.
    const source = `<channel name="only">
\${ <m> = [] }
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("DISPENSATION REGRESSION: `export <channel>` module file fires NEITHER code", () => {
    // The trucking-dispatch cross-file shape (CHX exporter side).
    const source = `export <channel name="dispatch-board">
\${
  <boardEvents> = []
  server function publishBoardEvent(eventType) {
    @boardEvents = [...@boardEvents, { type: eventType }]
  }
}
</>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });

  test("OUTSIDE-PROGRAM REGRESSION: file-top channel + `<program>` sibling still fires, alone", () => {
    // No `<page>` involved: E-CHANNEL-OUTSIDE-PROGRAM behaviour is unchanged
    // and the new code stays silent.
    const source = `<channel name="chat">
\${ <messages> = [] }
</>
<program>
\${ <draft> = "" }
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(1);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(0);
  });

  test("a `<page>` with NO channel in it fires nothing (pageDepth alone is inert)", () => {
    const source = `<program>
<channel name="chat">
\${ <messages> = [] }
</>
<page>
\${ <draft> = "" }
<h1>Page</h1>
</page>
<page>
<h2>Other</h2>
</page>
</program>`;
    const { sym } = compileSym(source);
    expect(errorsByCode(sym, "E-CHANNEL-INSIDE-PAGE")).toHaveLength(0);
    expect(errorsByCode(sym, "E-CHANNEL-OUTSIDE-PROGRAM")).toHaveLength(0);
  });
});
