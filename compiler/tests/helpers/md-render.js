/**
 * Test helper — render a scrml:md tree (stdlib/md) as compact HTML text, so a test can state the
 * expected structure in one readable string.
 *
 * This is a TEST VIEW of the tree, not the language's renderer (SPEC §67.6: the compiler and the
 * `of=` runtime build elements from the closed set and write content as text nodes / attribute
 * values; neither goes through an HTML string). Text is escaped (`&` `<` `>` `"`), so a test that
 * expects `&lt;b&gt;` proves the reader produced the TEXT `<b>`, never an element.
 *
 *   html(parse(src))            the blocks, joined with no separator
 *   html(parse(src), { ids })   headings carry the given ids, in document order
 */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tag = (v) => (typeof v === "string" ? v : v.variant);

function segs(list) {
  return list.map((g) => (tag(g) === "Lit" ? g.data.text : `{slot${g.data.index}}`)).join("");
}

export function inline(nodes) {
  return nodes.map((n) => {
    switch (tag(n)) {
      case "Text": return esc(n.data.text);
      case "Slot": return `{slot${n.data.index}}`;
      case "Code": return `<code>${esc(n.data.text)}</code>`;
      case "Em": return `<em>${inline(n.data.children)}</em>`;
      case "Strong": return `<strong>${inline(n.data.children)}</strong>`;
      case "Del": return `<del>${inline(n.data.children)}</del>`;
      case "Link": {
        const t = segs(n.data.title);
        return `<a href="${esc(segs(n.data.dest))}"${t ? ` title="${esc(t)}"` : ""}>${inline(n.data.children)}</a>`;
      }
      case "Image": {
        const t = segs(n.data.title);
        return `<img src="${esc(segs(n.data.src))}" alt="${esc(segs(n.data.alt))}"${t ? ` title="${esc(t)}"` : ""}>`;
      }
      case "SoftBreak": return "\n";
      case "HardBreak": return "<br>";
      default: throw new Error("unknown inline " + JSON.stringify(n));
    }
  }).join("");
}

export function blocks(list, ctx = { ids: [], next: 0 }, tight = false) {
  return list.map((b) => {
    switch (tag(b)) {
      case "Paragraph": return tight ? inline(b.data.children) : `<p>${inline(b.data.children)}</p>`;
      case "Heading": {
        const id = ctx.ids[ctx.next++];
        return `<h${b.data.level}${id ? ` id="${id}"` : ""}>${inline(b.data.children)}</h${b.data.level}>`;
      }
      case "CodeBlock": return `<pre><code${b.data.lang ? ` class="language-${b.data.lang}"` : ""}>${esc(b.data.text)}</code></pre>`;
      case "Quote": return `<blockquote>${blocks(b.data.children, ctx)}</blockquote>`;
      case "List": {
        const t = b.data.ordered ? "ol" : "ul";
        const start = b.data.ordered && b.data.start !== 1 ? ` start="${b.data.start}"` : "";
        return `<${t}${start}>${b.data.items.map((it) => `<li>${blocks(it.children, ctx, b.data.tight)}</li>`).join("")}</${t}>`;
      }
      case "Rule": return "<hr>";
      case "Table": {
        const al = b.data.align.map((a) => (tag(a) === "Default" ? "" : ` style="text-align:${tag(a).toLowerCase()}"`));
        const row = (r, cell) => `<tr>${r.cells.map((c, i) => `<${cell}${al[i]}>${inline(c.children)}</${cell}>`).join("")}</tr>`;
        const body = b.data.rows.length ? `<tbody>${b.data.rows.map((r) => row(r, "td")).join("")}</tbody>` : "";
        return `<table><thead>${row(b.data.head, "th")}</thead>${body}</table>`;
      }
      default: throw new Error("unknown block " + JSON.stringify(b));
    }
  }).join("");
}

export function html(doc, opts = {}) {
  return blocks(doc.blocks, { ids: opts.ids ?? [], next: 0 });
}

/** The diagnostic codes of a parse, in order. */
export function codes(doc) {
  return doc.diags.map((d) => d.code);
}
