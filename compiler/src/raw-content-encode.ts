/**
 * raw-content-encode.ts — §4.17: a `<pre>` / `<code>` raw body is DISPLAY TEXT.
 *
 * change-id: s462-q21-raw-body-as-text.
 *
 * Ruling (user-voice-scrml.md S462 Q21, "I like a."): raw bodies are emitted with `<` and `>`
 * entity-encoded — what the author typed is what the page shows, and nothing in a raw body can
 * build an element, so nothing in it can execute. There is no list of dangerous names: EVERY `<`
 * and `>` is encoded. Two carve-outs, both measured on the corpus:
 *
 *   - `&` is NOT encoded. 1,608 corpus bodies display code through entities (`&lt;b&gt;`); the
 *     browser keeps decoding them, so they still display `<b>`. An entity can never build an
 *     element (it decodes to text), so leaving `&` alone opens nothing.
 *   - A nested `<code>` / `<pre>` ELEMENT with NO attributes stays an element. 326 corpus bodies
 *     are the bare `<pre><code>…</code></pre>` wrapper (all of them attribute-less). Only a
 *     BALANCED pair stays structural: an opener with no matching closer, or a closer with no
 *     opener, is text. The text inside the pair is encoded like the rest of the body.
 *     A nested tag WITH attributes (`<code class="lang-js">`) is text, not an element (corpus
 *     count 0 across 4,513 bodies) — an attribute is where active HTML lives (`on…=`, `style=`),
 *     and a name allow-list is exactly what the ruling declines.
 *
 * The one rule is `encodeRawContentBody`; every emitter that writes a raw body asks it:
 *   - an HTML-string sink (static HTML, an `if` template, a `<match>` / engine arm string, a
 *     component body, `^{ emit() }` output, SSR rows) writes the encoded string as is;
 *   - a DOM sink (`<each>` rows, `lift` markup) parses the encoded string through an INERT
 *     `<template>` (`rawContentDomLines`) — the string cannot hold an element other than the
 *     structural `<code>` / `<pre>`, and a `<template>`'s content never runs or loads anything.
 *     The DOM sink cannot use a text node: a text node shows `&lt;b&gt;` literally.
 *
 * Component props substituted into a raw body (`<pre>${t}</pre>` in a component body) are
 * substituted by the component expander BEFORE codegen, so encoding at emission encodes the
 * substituted text too.
 */

/** The raw-content element names (§4.17). */
export const RAW_CONTENT_TAG_NAMES: ReadonlySet<string> = new Set(["pre", "code"]);

/**
 * True when `node` is a raw-content ELEMENT: an HTML `<pre>` / `<code>` (ASCII
 * case-insensitive), not a component reference. The decision is SYNTACTIC, exactly the
 * block splitter's: a component name is uppercase-first (`<Pre>`, `<CODE>` are component
 * references, never raw content), so the tag's first character decides it.
 */
export function isRawContentElement(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { kind?: unknown; tag?: unknown; tagName?: unknown; name?: unknown };
  if (n.kind !== undefined && n.kind !== "markup") return false;
  const tag = typeof n.tag === "string" ? n.tag
    : typeof n.tagName === "string" ? n.tagName
    : typeof n.name === "string" ? n.name : null;
  if (tag === null || tag.length === 0) return false;
  if (/^[A-Z]/.test(tag)) return false;
  return RAW_CONTENT_TAG_NAMES.has(tag.toLowerCase());
}

/** A nested raw-content tag with no attributes: `<code>`, `</pre >`, … (ASCII case-insensitive). */
const STRUCTURAL_TAG = /<(\/?)(pre|code)[\t\n\f\r ]*>/gi;

/**
 * §4.17 (S462 Q21) — the HTML a raw body is written as. Every `<` and `>` is encoded as
 * `&lt;` / `&gt;`, except the `<` / `>` of a BALANCED, attribute-less nested `<code>…</code>`
 * or `<pre>…</pre>` pair, which is written as a lowercase tag. `&` is left alone.
 */
export function encodeRawContentBody(body: string): string {
  if (!/[<>]/.test(body)) return body;
  // 1. Pair the structural tags (a stack — a closer pairs only with the innermost open tag
  //    of the same name; anything unpaired stays text).
  const tokens: Array<{ start: number; end: number; name: string; close: boolean; kept: boolean }> = [];
  for (const m of body.matchAll(STRUCTURAL_TAG)) {
    tokens.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[2].toLowerCase(), close: m[1] === "/", kept: false });
  }
  const open: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.close) { open.push(i); continue; }
    const top = open.length > 0 ? tokens[open[open.length - 1]] : null;
    if (top && top.name === t.name) {
      top.kept = true;
      t.kept = true;
      open.pop();
    }
  }
  // 2. Write the body: kept tags as canonical lowercase tags, every other `<` / `>` encoded.
  let out = "";
  let pos = 0;
  for (const t of tokens) {
    if (!t.kept) continue;
    out += encodeAngles(body.slice(pos, t.start));
    out += t.close ? `</${t.name}>` : `<${t.name}>`;
    pos = t.end;
  }
  out += encodeAngles(body.slice(pos));
  return out;
}

function encodeAngles(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The DOM-sink form: JS statements that append the raw body to `parentVar`. The encoded
 * body is parsed by an inert `<template>` (its content never runs scripts or loads
 * resources, and the encoded string holds no element but the structural `<code>` /
 * `<pre>`), then the parsed nodes are moved under `parentVar` — so entities display as
 * the characters they name, exactly as in the static HTML. A body with no `<`, `>` or `&`
 * is appended as a plain text node (identical result, no parse).
 */
export function rawContentDomLines(body: string, parentVar: string, tplVar: string, indent = ""): string[] {
  // No `<`, `>` or `&`: nothing to encode and no entity to decode — a text node is the same.
  if (!/[<>&]/.test(body)) {
    return [`${indent}${parentVar}.appendChild(_scrml_g.document.createTextNode(${JSON.stringify(body)}));`];
  }
  return [
    `${indent}const ${tplVar} = _scrml_g.document.createElement("template");`,
    `${indent}${tplVar}.innerHTML = ${JSON.stringify(encodeRawContentBody(body))}; // §4.17 raw content: < and > encoded`,
    `${indent}${parentVar}.appendChild(${tplVar}.content);`,
  ];
}
