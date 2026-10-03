/**
 * structural-body-closer-r24-bug-4.test.js — Generic `</>` closer support
 * for STRUCTURAL_RAW_BODY_ELEMENTS (`<match>` + `<each>`).
 *
 * S138 R24-BUG-4 — closes deferred Phase 5 of the match-block-form-scoping
 * arc. Per SPEC §4.4.2 "`</>` SHALL close the innermost open markup tag",
 * the generic closer applies uniformly — including to `<match>` and
 * `<each>` structural raw-body elements. Pre-S138 only `</tagname>` was
 * accepted; `</>` fired E-CTX-001.
 *
 * Coverage (matrix from BRIEF):
 *
 *   §1 — `<match>` + `</>` closer
 *     §1.1 :-shorthand arms
 *     §1.2 bare-body arms with </> per arm
 *     §1.3 mixed shorthand + bare-body
 *     §1.4 self-closing arms
 *
 *   §2 — `<match>` + `</match>` explicit closer (regression guard)
 *
 *   §3 — `<each>` + `</>` closer
 *     §3.1 :-shorthand item
 *     §3.2 bare-body item with </li>
 *
 *   §4 — `<each>` + `</each>` explicit closer (regression guard)
 *
 *   §5 — Nested same-kind structural elements
 *     §5.1 `<each>` nested in `<each>` with </> outer + </> inner
 *     §5.2 `<match>` nested in `<each>` arm body
 *
 *   §6 — Skip-zone correctness
 *     §6.1 Body contains ${ markup-interp `<x>` } — not counted in depth
 *     §6.2 Attr value contains `<` char — not counted in depth
 *     §6.3 HTML comment `<!-- <x> -->` in body — not counted
 *     §6.4 Line comment `// <x>` in body — not counted
 *     §6.5 Block comment `/* <x> *\/` in body — not counted
 *     §6.6 Single-quoted string with `<` — not counted
 *
 *   §7 — Genuinely unclosed (no </> or </tagname> ever) — E-CTX-001 fires
 *
 * Test pattern mirrors `each-block.test.js` — uses `splitBlocks` directly
 * to assert on BS-level closer-form attribution.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers — locate the `<match>` / `<each>` block in the parsed BS tree.
// ---------------------------------------------------------------------------

function findFirst(blocks, predicate) {
  for (const b of blocks || []) {
    if (predicate(b)) return b;
    const inner = findFirst(b.children, predicate);
    if (inner) return inner;
  }
  return null;
}

function findFirstByName(blocks, name) {
  return findFirst(blocks, (b) => b.type === "markup" && b.name === name);
}

function findAllByName(blocks, name) {
  const out = [];
  function walk(arr) {
    for (const b of arr || []) {
      if (b.type === "markup" && b.name === name) out.push(b);
      walk(b.children);
    }
  }
  walk(blocks);
  return out;
}

// ---------------------------------------------------------------------------
// §1 — `<match>` + `</>` closer
// ---------------------------------------------------------------------------

describe("§1: <match> with </> generic closer", () => {
  test("§1.1 — :-shorthand arms close with </>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Loading, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: <p>Idle</p>
    <Loading>: <p>Loading...</p>
    <Done>: <p>Done</p>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("generic");
  });

  test("§1.2 — bare-body arms with </> per arm close outer with </>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle><p>Idle</p></>
    <Done><p>Done</p></>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("generic");
  });

  test("§1.3 — mixed :-shorthand and bare-body arms close with </>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Loading, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: <p>Idle</p>
    <Loading><p>Loading...</p></>
    <Done>: <p>Done</p>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("generic");
  });

  test("§1.4 — self-closing arms close outer with </>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle/>
    <Done/>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("generic");
  });

  test("§1.5 — payload-binding arm `<Ready(count)>` closes with </>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Ready(count: int) }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: "waiting"
    <Ready(count)>: count
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("generic");
  });
});

// ---------------------------------------------------------------------------
// §2 — `<match>` + `</match>` explicit closer (regression guard)
// ---------------------------------------------------------------------------

describe("§2: <match> with </match> explicit closer (regression guard)", () => {
  test("§2.1 — :-shorthand arms close with </match>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: <p>Idle</p>
    <Done>: <p>Done</p>
</match>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("explicit");
  });

  test("§2.2 — bare-body arms close with </match>", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle><p>Idle</p></>
    <Done><p>Done</p></>
</match>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    const match = findFirstByName(bs.blocks, "match");
    expect(match).not.toBeNull();
    expect(match.closerForm).toBe("explicit");
  });
});

// ---------------------------------------------------------------------------
// §3 — `<each>` + `</>` closer
// ---------------------------------------------------------------------------

describe("§3: <each> with </> generic closer", () => {
  test("§3.1 — :-shorthand item closes with </>", () => {
    const src = `<program>
<items> = ["a", "b", "c"]

<each in=@items>
    <li : @.>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });

  test("§3.2 — bare-body item with </li> closes outer with </>", () => {
    const src = `<program>
<items> = ["a", "b", "c"]

<each in=@items>
    <li>${`@.`}</li>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });

  test("§3.3 — with <empty> sub-element + bare-body close with </>", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.>
    <empty>No items yet.</>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });
});

// ---------------------------------------------------------------------------
// §4 — `<each>` + `</each>` explicit closer (regression guard)
// ---------------------------------------------------------------------------

describe("§4: <each> with </each> explicit closer (regression guard)", () => {
  test("§4.1 — :-shorthand item closes with </each>", () => {
    const src = `<program>
<items> = ["a", "b", "c"]

<each in=@items>
    <li : @.>
</each>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("explicit");
  });
});

// ---------------------------------------------------------------------------
// §5 — Nested same-kind structural elements
// ---------------------------------------------------------------------------

describe("§5: Nested structural raw-body elements", () => {
  // NB — BS captures the outer raw-body element's body as a single text node;
  // nested same-kind structural elements are NOT recursively split at the BS
  // level. They are re-recognized during downstream AST-builder re-parsing
  // (via splitBlocks invoked on the captured body), where the W-EACH-KEY-001
  // / W-EACH-PROMOTABLE lints fire on each. These tests assert the BS-level
  // outer-closer attribution + that the outer body raw text captures the
  // entire inner structural element verbatim (no premature termination).

  test("§5.1 — <each> nested in <each> with </> outer + </> inner — outer captures inner verbatim", () => {
    const src = `<program>
<groups> = []

<each in=@groups as group>
    <each in=@items as item>
        <li : item.name>
    </>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
    // The inner <each in=@items ...> must appear in the outer's raw body.
    const bodyText = (each.children || []).find((c) => c.type === "text");
    expect(bodyText).not.toBeUndefined();
    expect(bodyText.raw).toContain("<each in=@items");
    expect(bodyText.raw).toContain("<li : item.name>");
  });

  test("§5.2 — <each> nested in <each> with </> outer + </each> inner — outer captures inner verbatim", () => {
    const src = `<program>
<groups> = []

<each in=@groups as group>
    <each in=@items as item>
        <li : item.name>
    </each>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
    // The outer's body must contain the inner's </each> explicit close.
    const bodyText = (each.children || []).find((c) => c.type === "text");
    expect(bodyText).not.toBeUndefined();
    expect(bodyText.raw).toContain("<each in=@items");
    expect(bodyText.raw).toContain("</each>");
  });

  test("§5.3 — <match> nested in <each> arm body — outer captures inner verbatim", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}
<items> = []

<each in=@items as item>
    <match for=Phase on=@phase>
        <Idle>: <p>Idle</p>
        <Done>: <p>Done</p>
    </>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
    // The outer <each>'s body must contain the entire nested <match>...</>.
    const bodyText = (each.children || []).find((c) => c.type === "text");
    expect(bodyText).not.toBeUndefined();
    expect(bodyText.raw).toContain("<match for=Phase");
    expect(bodyText.raw).toContain("<Idle>");
    expect(bodyText.raw).toContain("<Done>");
  });
});

// ---------------------------------------------------------------------------
// §6 — Skip-zone correctness
// ---------------------------------------------------------------------------

describe("§6: Skip-zone correctness — `<` inside skip zones does not affect depth", () => {
  test("§6.1 — ${...} interpolation block with markup-interp not counted", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li>\${ const x = "<p>nested</p>"; x }</li>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });

  test("§6.2 — attribute value with quoted `<` is not counted", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li title="contains < bracket">item</li>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });

  test("§6.3 — HTML comment <!-- <x> --> in body not counted", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <!-- <x>commented opener</x> -->
    <li : @.>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });

  test("§6.4 — single-quoted string with `<` not counted (as attr value)", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li title='single < quoted'>item</li>
</>
</>`;
    const bs = splitBlocks("t.scrml", src);
    expect(bs.errors.filter((e) => e.code === "E-CTX-001")).toHaveLength(0);
    expect(bs.errors.filter((e) => e.code === "E-CTX-003")).toHaveLength(0);
    const each = findFirstByName(bs.blocks, "each");
    expect(each).not.toBeNull();
    expect(each.closerForm).toBe("generic");
  });
});

// ---------------------------------------------------------------------------
// §7 — Genuinely unclosed (E-CTX-001 regression)
// ---------------------------------------------------------------------------

describe("§7: Genuinely unclosed structural raw-body fires E-CTX-001", () => {
  test("§7.1 — <match> with no closer at all fires E-CTX-001", () => {
    const src = `<program>
\${
    type Phase:enum = { Idle, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: <p>Idle</p>
    <Done>: <p>Done</p>`;
    const bs = splitBlocks("t.scrml", src);
    const e001 = bs.errors.filter((e) => e.code === "E-CTX-001");
    expect(e001.length).toBeGreaterThan(0);
  });

  test("§7.2 — <each> with no closer at all fires E-CTX-001", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.>`;
    const bs = splitBlocks("t.scrml", src);
    const e001 = bs.errors.filter((e) => e.code === "E-CTX-001");
    expect(e001.length).toBeGreaterThan(0);
  });

  test("§7.3 — E-CTX-001 message names both closer forms", () => {
    const src = `<program>
<items> = []

<each in=@items>
    <li : @.>`;
    const bs = splitBlocks("t.scrml", src);
    const e001 = bs.errors.find((e) => e.code === "E-CTX-001");
    expect(e001).not.toBeUndefined();
    expect(e001.message).toContain("</each>");
    expect(e001.message).toContain("</>");
  });
});

// ---------------------------------------------------------------------------
// §8 — End-to-end compile (full pipeline, not just BS) — sanity gate
// ---------------------------------------------------------------------------

describe("§8: End-to-end compilation of </> closers (full-pipeline sanity)", () => {
  test("§8.1 — match with </> closer produces clean compile (no E-CTX errors)", async () => {
    // Use compileScrml directly via the public api.js entry point.
    const { compileScrml } = await import("../../src/api.js");
    const { writeFileSync, mkdirSync, rmSync } = await import("fs");
    const { resolve } = await import("path");
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tmpDir = resolve(tmpdir(), `r24bug4-test-${uniq}`);
    mkdirSync(tmpDir, { recursive: true });
    const inputFile = resolve(tmpDir, "match.scrml");
    writeFileSync(
      inputFile,
      `<program>
\${
    type Phase:enum = { Idle, Loading, Done }
    <phase>: Phase = .Idle
}

<match for=Phase on=@phase>
    <Idle>: <p>Idle</p>
    <Loading>: <p>Loading...</p>
    <Done>: <p>Done</p>
</>
</>`
    );
    try {
      const result = compileScrml({
        inputFiles: [inputFile],
        write: false,
      });
      const ctxErrors = (result.errors || []).filter(
        (e) => e.code === "E-CTX-001" || e.code === "E-CTX-003"
      );
      expect(ctxErrors).toHaveLength(0);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test("§8.2 — each with </> closer produces clean compile (no E-CTX errors)", async () => {
    const { compileScrml } = await import("../../src/api.js");
    const { writeFileSync, mkdirSync, rmSync } = await import("fs");
    const { resolve } = await import("path");
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tmpDir = resolve(tmpdir(), `r24bug4-test-${uniq}`);
    mkdirSync(tmpDir, { recursive: true });
    const inputFile = resolve(tmpDir, "each.scrml");
    writeFileSync(
      inputFile,
      `<program>
<items> = ["a", "b", "c"]

<each in=@items>
    <li : @.>
</>
</>`
    );
    try {
      const result = compileScrml({
        inputFiles: [inputFile],
        write: false,
      });
      const ctxErrors = (result.errors || []).filter(
        (e) => e.code === "E-CTX-001" || e.code === "E-CTX-003"
      );
      expect(ctxErrors).toHaveLength(0);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
