/**
 * element-refusal.ts — §4.17: scrml does not admit `<script>` or `<style>` AT ALL.
 *
 * change-id: s462-impl1-script-style-everywhere.
 *
 * SPEC §4.17: "`<script>` and `<style>` are NOT raw-content in scrml because scrml
 * does not admit those elements at all. … `<style>` triggers `E-STYLE-001` …, and
 * `<script>` triggers `E-SCRIPT-001` … The match on the tag name is exact, not a
 * prefix — `<noscript>` is an ordinary element and is unaffected."
 *
 * Before S462 the refusal lived only on the block splitter's markup-opener path.
 * Every OTHER place markup is parsed or built let the element through:
 *   - `lift <script>${@code}</script>` / `lift <script src=@u>` / `lift <style>…`
 *     lowered to `document.createElement("script")` — cell data ran as JS and a
 *     data-chosen URL loaded as a script;
 *   - markup-as-a-value (`@f ? <script>…</script> : <b/>`), `return <script>…`,
 *     a component body (`const C = <div><script>…</script></div>`) — same, or the
 *     element reached the served HTML verbatim;
 *   - an `<each>` body / a `<match>` arm / an engine state-child body — re-split
 *     from text by the builder with the sub-splitter's errors discarded, so the
 *     element was silently dropped (fail-safe, but never refused);
 *   - a `<pre>` / `<code>` raw-content body — a literal `<script>` passed through
 *     to the served HTML, where the browser parses it as a live element.
 *
 * This module holds the ONE rule every site asks (`refusedElementCode`), the shared
 * message text, the structural check the AST builder runs over EVERY element node
 * of a finished tree (`collectRefusedElements` — decided from parsed nodes, not from
 * text — including the text of every raw-content body it reaches), and the raw-content
 * scan (`scanRawContentForRefusedTags`), a fail-closed text rule over the verbatim
 * `<pre>` / `<code>` body. Codegen keeps a backstop (`refuseElementLowering` /
 * `refuseRawContentLowering` in `codegen/refused-lowering-errors.ts`): an element or a
 * raw body it is asked to emit that is refused here is never emitted, and is reported.
 */

/** The two refused element names → their codes. Lowercase keys; the match is exact. */
export const REFUSED_ELEMENTS: ReadonlyMap<string, "E-SCRIPT-001" | "E-STYLE-001"> = new Map([
  ["script", "E-SCRIPT-001"],
  ["style", "E-STYLE-001"],
]);

/**
 * §4.17 — the code a tag name is refused with, or null. Exact name, ASCII
 * case-insensitive: `script` / `SCRIPT` / `Script` are refused; `noscript`,
 * `scripts`, `script_x`, `style-x` are not.
 */
export function refusedElementCode(tag: unknown): "E-SCRIPT-001" | "E-STYLE-001" | null {
  if (typeof tag !== "string") return null;
  return REFUSED_ELEMENTS.get(tag.toLowerCase()) ?? null;
}

/**
 * The diagnostic text. `where` names the position (it is appended so the author can
 * see why an element nested in logic is refused exactly as a top-level one is).
 */
export function refusedElementMessage(code: string, tag: string, where?: string): string {
  const at = where ? ` (${where})` : "";
  if (code === "E-STYLE-001") {
    return `<${tag}> blocks are not supported in scrml${at}. Use #{} for CSS.\n` +
      `  scrml does not admit the <style> element at any position (SPEC §4.17).`;
  }
  return `<${tag}> elements are not supported in scrml${at}. Use \${...} for scrml logic.\n` +
    `  Hint: for genuine foreign JS, use the \`_{...}\` foreign-code block (SPEC §23). ` +
    `scrml does not admit the <script> element at any position (SPEC §4.17).`;
}

export interface RefusedElementSite {
  code: "E-SCRIPT-001" | "E-STYLE-001";
  tag: string;
  node: { [k: string]: unknown };
  span: { file?: string; start: number; end: number; line: number; col: number } | null;
}

/** The raw-content element names (§4.17) — their text children are the verbatim body. */
const RAW_CONTENT_TAGS = new Set(["pre", "code"]);

/** Text of a text node, whichever parser built it. */
function textOf(n: { [k: string]: unknown }): string | null {
  for (const k of ["value", "text", "raw", "content"]) if (typeof n[k] === "string") return n[k] as string;
  return null;
}

/**
 * Walk a finished AST (any object graph) and return every element scrml does not
 * admit:
 *   - an element node: `kind === "markup"` whose `tag` is refused;
 *   - a refused start tag inside a RAW-CONTENT body: the text child of a `<pre>` /
 *     `<code>` node (§4.17), which is copied verbatim into the served HTML and parsed
 *     by the browser (scanRawContentForRefusedTags).
 * The walk is structural — it visits every object reachable from `root` (statement
 * bodies, `lift` targets, markup values inside expressions, `return` values, component
 * definitions, each / match / engine bodies, attribute values that hold markup), so a
 * new place that produces element nodes, or a raw body, is covered without being
 * listed here — whichever parser (block splitter re-split, native parser, meta re-parse)
 * built the subtree.
 *
 * A refused node is neutralized in place so it cannot cascade: its attributes and
 * children are cleared (a `src=@u` / `${@code}` body is not analysed further) and it
 * is never treated as a component reference (`<SCRIPT>` is not a phantom component).
 * The node itself is KEPT — codegen's backstop refuses it again (and the pipeline
 * drops that second report as a duplicate), so a check whose report is lost can
 * never turn into a silent pass. A raw body is left as written (the backstop refuses
 * to emit it).
 */
export function collectRefusedElements(root: unknown): RefusedElementSite[] {
  const out: RefusedElementSite[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n as object)) continue;
    seen.add(n as object);
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]);
      continue;
    }
    const obj = n as { [k: string]: unknown };
    if (obj.kind === "markup") {
      const tag = (obj.tag ?? obj.tagName) as unknown;
      const code = refusedElementCode(tag);
      if (code !== null) {
        // `refusalSpan` — set where a builder knows the node's own `span` is local to a
        // re-parsed slice (a markup value inside an expression): the FILE position.
        const sp = (obj.refusalSpan ?? obj.span) as RefusedElementSite["span"];
        out.push({ code, tag: String(tag), node: obj, span: sp && typeof sp.start === "number" ? sp : null });
        if (Array.isArray(obj.attrs)) obj.attrs = [];
        if (Array.isArray(obj.attributes)) obj.attributes = [];
        if (Array.isArray(obj.children)) obj.children = [];
        // `<SCRIPT>` is the refused element, not a reference to a component named SCRIPT.
        if (typeof obj.tag === "string") obj.tag = obj.tag.toLowerCase();
        obj.isComponent = false;
        obj.refusedElement = code;
        continue;
      }
      if (typeof tag === "string" && RAW_CONTENT_TAGS.has(tag.toLowerCase()) && Array.isArray(obj.children)) {
        for (const c of obj.children as unknown[]) {
          if (!c || typeof c !== "object") continue;
          const child = c as { [k: string]: unknown };
          if (child.kind !== "text") continue;
          const body = textOf(child);
          if (!body) continue;
          const csp = child.span as RefusedElementSite["span"];
          for (const hit of scanRawContentForRefusedTags(body)) {
            const span = csp && typeof csp.start === "number"
              ? { ...csp, start: csp.start + hit.offset, end: csp.start + hit.offset + 1 + hit.tag.length, ...lineColAfter(csp, body, hit.offset) }
              : null;
            out.push({ code: hit.code, tag: hit.tag, node: child, span });
          }
        }
      }
    }
    for (const k of Object.keys(obj)) {
      if (k === "span" || k === "parent") continue;
      const v = obj[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  out.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
  return out;
}

/** line/col of `body[offset]`, counted from a span whose line/col is `body[0]`'s. */
function lineColAfter(sp: { line: number; col: number }, body: string, offset: number): { line: number; col: number } {
  const lead = body.slice(0, offset);
  const nl = lead.lastIndexOf("\n");
  if (nl < 0) return { line: sp.line, col: sp.col + offset };
  return { line: sp.line + (lead.match(/\n/g)?.length ?? 0), col: offset - nl };
}

/**
 * §4.17 raw content (S462) — a `<pre>` / `<code>` body is copied verbatim into the
 * served HTML, where the BROWSER parses it. The rule is FAIL-CLOSED and deliberately
 * does NOT model the HTML tokenizer: every case-insensitive `<script` / `<style` start
 * tag text in the body is refused — inside attribute values, comments, CDATA,
 * RCDATA / RAWTEXT elements (`<textarea>`, `<title>`, `<xmp>`, `<iframe>`, `<noembed>`,
 * `<noframes>`, `<noscript>`) included — because those contexts end where the body's
 * own text says they end (`<a title="</textarea><script>…">` inside a `<textarea>`
 * closes it), and a model that gets one of them wrong is a bypass. The name is exact:
 * `<script` / `<style` followed by whitespace, `/`, `>` or the end of the body.
 * `<scripts>`, `<script-x>`, `<stylesheet>` and the end tag `</script>` build no such
 * element; the entity-escaped display form `&lt;script&gt;` is text. (S462 review: the
 * earlier tokenizer mirror was bypassable through RCDATA / RAWTEXT elements.)
 */
export function scanRawContentForRefusedTags(body: string): Array<{ code: "E-SCRIPT-001" | "E-STYLE-001"; tag: string; offset: number }> {
  const hits: Array<{ code: "E-SCRIPT-001" | "E-STYLE-001"; tag: string; offset: number }> = [];
  for (const m of body.matchAll(/<(script|style)(?=[\t\n\f\r \/>]|$)/gi)) {
    const code = refusedElementCode(m[1]);
    if (code !== null) hits.push({ code, tag: m[1], offset: m.index ?? 0 });
  }
  return hits;
}
