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
 * text), and the raw-content scan (`scanRawContentForRefusedTags`), which mirrors the
 * HTML tokenizer the browser will run over the verbatim `<pre>` / `<code>` body.
 * Codegen keeps a backstop (`codegen/refused-element-guard.ts`): an element it is
 * asked to build that is refused here is never emitted, and is reported.
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

/**
 * Walk a finished AST (any object graph) and return every element node scrml does
 * not admit: `kind === "markup"` whose `tag` is refused. The walk is structural — it
 * visits every object reachable from `root` (statement bodies, `lift` targets,
 * markup values inside expressions, `return` values, component definitions, each /
 * match / engine bodies, attribute values that hold markup), so a new place that
 * produces element nodes is covered without being listed here.
 *
 * A refused node is neutralized in place so it cannot cascade: its attributes and
 * children are cleared (a `src=@u` / `${@code}` body is not analysed further) and it
 * is never treated as a component reference (`<SCRIPT>` is not a phantom component).
 * The node itself is KEPT — codegen's backstop refuses it again (and the pipeline
 * drops that second report as a duplicate), so a check whose report is lost can
 * never turn into a silent pass.
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

const isAsciiAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isHtmlSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";

/**
 * §4.17 raw content — a `<pre>` / `<code>` body is copied verbatim into the served
 * HTML, where the BROWSER parses it as ordinary HTML. So the elements that body
 * builds are the ones the HTML tokenizer finds in it; this mirrors that tokenizer
 * (data state → tag open → tag name → attributes) and returns every start tag whose
 * name is refused, with its offset in `body`.
 *
 *   - a start tag's name runs to whitespace, `/` or `>`; a name that runs to the end
 *     of the body continues into the following `</pre>` text (`<` joins the name), so
 *     it is not `script`;
 *   - attribute values in `"` / `'` are skipped whole (`<a title="<script>">` builds
 *     an `<a>`); `<!-- … -->` comments (with the `<!-->` / `<!--->` abrupt closes and
 *     `--!>`), `<!…>` / `<?…>` bogus comments and end tags build no element;
 *   - fail-closed: RCDATA / RAWTEXT elements (`<textarea>`, `<title>`, `<xmp>`, …)
 *     are not modelled, so a refused tag inside one is still refused.
 */
export function scanRawContentForRefusedTags(body: string): Array<{ code: "E-SCRIPT-001" | "E-STYLE-001"; tag: string; offset: number }> {
  const hits: Array<{ code: "E-SCRIPT-001" | "E-STYLE-001"; tag: string; offset: number }> = [];
  const n = body.length;
  let i = 0;
  // Skip a tag's attributes after its name; returns the index after its `>` (or n).
  const skipAttributes = (j: number): number => {
    while (j < n) {
      const c = body[j];
      if (c === ">") return j + 1;
      if (isHtmlSpace(c) || c === "/") { j++; continue; }
      // attribute name: the first char may be anything (even `=`), then up to ws / `/` / `>` / `=`
      j++;
      while (j < n && !isHtmlSpace(body[j]) && body[j] !== "/" && body[j] !== ">" && body[j] !== "=") j++;
      while (j < n && isHtmlSpace(body[j])) j++;
      if (j < n && body[j] === "=") {
        j++;
        while (j < n && isHtmlSpace(body[j])) j++;
        if (j < n && (body[j] === '"' || body[j] === "'")) {
          const q = body[j];
          const close = body.indexOf(q, j + 1);
          if (close < 0) return n;
          j = close + 1;
        } else {
          while (j < n && !isHtmlSpace(body[j]) && body[j] !== ">") j++;
        }
      }
    }
    return n;
  };
  while (i < n) {
    if (body[i] !== "<") { i++; continue; }
    const c1 = body[i + 1] ?? "";
    if (body.startsWith("<!--", i)) {
      let j = i + 4;
      if (body[j] === ">") { i = j + 1; continue; }
      if (body.startsWith("->", j)) { i = j + 2; continue; }
      let end = n;
      for (let k = j; k < n; k++) {
        if (body.startsWith("-->", k)) { end = k + 3; break; }
        if (body.startsWith("--!>", k)) { end = k + 4; break; }
      }
      i = end;
      continue;
    }
    if (c1 === "!" || c1 === "?") {
      const gt = body.indexOf(">", i + 2);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    if (c1 === "/") {
      const c2 = body[i + 2] ?? "";
      if (isAsciiAlpha(c2)) {
        let j = i + 2;
        while (j < n && !isHtmlSpace(body[j]) && body[j] !== "/" && body[j] !== ">") j++;
        i = skipAttributes(j);
      } else if (c2 === ">") {
        i += 3;
      } else {
        const gt = body.indexOf(">", i + 2);
        i = gt < 0 ? n : gt + 1;
      }
      continue;
    }
    if (isAsciiAlpha(c1)) {
      let j = i + 1;
      while (j < n && !isHtmlSpace(body[j]) && body[j] !== "/" && body[j] !== ">") j++;
      const name = body.slice(i + 1, j);
      if (j < n) {
        const code = refusedElementCode(name);
        if (code !== null) hits.push({ code, tag: name, offset: i });
      }
      i = skipAttributes(j);
      continue;
    }
    i++;
  }
  return hits;
}
