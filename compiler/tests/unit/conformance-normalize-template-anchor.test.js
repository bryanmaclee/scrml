// conformance-normalize-template-anchor.test.js — the whole-tree `dom` normalizer
// (conformance/normalize.ts) drops impl#1's conditional-mount anchor and NOTHING else.
//
// The strip is an impl-private exclusion keyed to impl#1's anchor naming
// (`genVar("scrml_tpl")` / `genVar("scrml_chain_tpl")` → `_scrml_scrml_tpl_N` /
// `_scrml_scrml_chain_tpl_N`) AND emptiness. An author `<template>` — whatever its id,
// including another `_scrml_…` id, and any anchor-named template that carries content —
// is author content and must survive (s439-bootstrap-m3-ingest review round 2, item 1).

import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { normalizeDom } from "../../../conformance/normalize.ts";

function body(html) {
  const w = new Window();
  w.document.body.innerHTML = html;
  return w.document.body;
}

describe("normalizeDom — impl#1 template anchors", () => {
  test("impl#1's if-guard / if-chain anchors are stripped — including the arm markup impl#1 keeps in `content`", () => {
    expect(normalizeDom(body('<button id="t">T</button><template id="_scrml_scrml_tpl_2"></template><p id="p">x</p>')))
      .toBe('<button id="t">T</button><p id="p">x</p>');
    expect(normalizeDom(body('<template id="_scrml_scrml_chain_tpl_17"></template><p>y</p>'))).toBe("<p>y</p>");
    // impl#1's real anchor (toggle-show's emitted page): the arm's markup lives in the template's content fragment.
    expect(normalizeDom(body('<button id="toggle">Toggle</button><template id="_scrml_scrml_tpl_2"><p id="panel">Panel open</p></template><p id="panel">Panel open</p>')))
      .toBe('<button id="toggle">Toggle</button><p id="panel">Panel open</p>');
  });

  test("an author template with another `_scrml_` id and content is kept (the review's witness)", () => {
    const out = normalizeDom(body('<template id="_scrml_x"><p>author content</p></template><p id="a">hi</p>'));
    expect(out).toContain('<template id="_scrml_x">');
    expect(out).toContain('<p id="a">hi</p>');
  });

  // (No test for "an anchor-named template with live children is kept": per the HTML spec a
  // <template>'s children — parsed OR appended — go to its `content` fragment, so a template never
  // has live child nodes. The no-children condition in isImpl1TemplateAnchor is kept as a guard,
  // but the exact impl#1 id is the real discriminator. See progress.md, round 2.)

  test("near-miss ids are kept", () => {
    for (const id of ["_scrml_scrml_tpl_", "_scrml_scrml_tpl_2x", "x_scrml_scrml_tpl_2", "_scrml_tpl_2", "_scrml_scrml_chain_tpl"]) {
      expect(normalizeDom(body(`<template id="${id}"></template>`))).toBe(`<template id="${id}"></template>`);
    }
  });
});
