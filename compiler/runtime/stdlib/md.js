// scrml:md — runtime shim. GENERATED — do not edit.
//
// This file is impl#1's library-mode compile of stdlib/md/index.scrml (the one md reader,
// SPEC §67.8), written by scripts/gen-md-shim.ts. Edit the scrml source and regenerate:
//   bun scripts/gen-md-shim.ts
// source-sha256: 6339c73c828dce6144fdb40958ea2e098ca67d6acd53ba861e3fddb34dcb0054
// Generated library module — scrml compiler output
// ES module: import { name } from './this-file.js'
const _scrml_g = globalThis; // the host-global alias (SPEC §47.1.1); a shim is copied alone into _scrml/

export const MdSeg = _scrml_g.Object.freeze({ Lit: function(text) { return { variant: "Lit", data: { text } }; }, Slot: function(index) { return { variant: "Slot", data: { index } }; }, variants: ["Lit", "Slot"] });
export const MdInline = _scrml_g.Object.freeze({ Text: function(text) { return { variant: "Text", data: { text } }; }, Slot: function(index) { return { variant: "Slot", data: { index } }; }, Code: function(text) { return { variant: "Code", data: { text } }; }, Em: function(children) { return { variant: "Em", data: { children } }; }, Strong: function(children) { return { variant: "Strong", data: { children } }; }, Del: function(children) { return { variant: "Del", data: { children } }; }, Link: function(dest, title, children) { return { variant: "Link", data: { dest, title, children } }; }, Image: function(src, alt, title) { return { variant: "Image", data: { src, alt, title } }; }, SoftBreak: "SoftBreak", HardBreak: "HardBreak", variants: ["Text", "Slot", "Code", "Em", "Strong", "Del", "Link", "Image", "SoftBreak", "HardBreak"] });
export const MdAlign = _scrml_g.Object.freeze({ Default: "Default", Left: "Left", Center: "Center", Right: "Right", variants: ["Default", "Left", "Center", "Right"] });
export const MdBlock = _scrml_g.Object.freeze({ Paragraph: function(children) { return { variant: "Paragraph", data: { children } }; }, Heading: function(level, children) { return { variant: "Heading", data: { level, children } }; }, CodeBlock: function(lang, text) { return { variant: "CodeBlock", data: { lang, text } }; }, Quote: function(children) { return { variant: "Quote", data: { children } }; }, List: function(ordered, start, tight, items) { return { variant: "List", data: { ordered, start, tight, items } }; }, Rule: "Rule", Table: function(align, head, rows) { return { variant: "Table", data: { align, head, rows } }; }, variants: ["Paragraph", "Heading", "CodeBlock", "Quote", "List", "Rule", "Table"] });

// ---------------------------------------------------------------------------
    // scrml:md — the markdown reader (SPEC §67)
    //
    // The ONE reader of scrml-md, the markdown dialect of the `<md>` element
    // (ruling S462 F4: "one md reader, written in scrml (`scrml:md`), used by BOTH
    // compilers"). The compiler calls it at build time to lower a static `<md>`
    // body; `<md of=…/>` ships it to read markdown from data. Build time and run
    // time read the same text the same way because there is only this reader.
    //
    // It reads a STRING and returns a TREE (`MdDoc`): a closed set of node kinds
    // and a list of `W-MD-*` diagnostics with positions. It never produces HTML
    // text. Whoever renders the tree builds elements from the closed §67.6 set and
    // writes content as text nodes and attribute values only.
    //
    // The dialect (§67.3, ruling S462 F3, "one way to do it with lints to guide"):
    // CommonMark core + GFM tables + strikethrough, ONE spelling per construct.
    //   IN   paragraphs · `#` headings · `*em*` · `**strong**` · `` `code` `` ·
    //        ``` fences · `[t](url "title")` · `![alt](src)` · `- ` and `1. ` lists ·
    //        `>` quotes · `---` · `| a | b |` tables · `~~del~~` · `\` escapes ·
    //        a trailing `\` hard break
    //   OUT  raw HTML, entity references, angle autolinks, reference links,
    //        footnotes, task lists, setext headings, indented code, and every
    //        second spelling of an IN construct. An OUT construct is read as TEXT
    //        (what you typed is what is shown) and reported with a W-MD-* code that
    //        names the scrml-md spelling.
    //
    // Bounded on hostile input (§67.9): block and inline nesting stop at 32 levels,
    // at most 32 link/image brackets are open at once, and link-tail scanning has a
    // budget linear in the input; past a bound the text is shown as typed and
    // W-MD-DEPTH-LIMIT / W-MD-SCAN-LIMIT says so. Every scan is linear.
    //
    // Usage:
    //   ${ import { parse, headingSlugs } from 'scrml:md' }
    //   const doc = parse("## Hello\n\nSome **bold** text.")
    //   // doc.blocks — MdBlock[]; doc.diags — MdDiag[]
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // The tree (§67.5)
    // ---------------------------------------------------------------------------

    // A piece of an attribute-valued string: literal text, or a text-only slot
    // (a `${…}` atom, phase 2). A data-led URL is one that holds a Slot.
    

    // Inline content. `Slot` is the text-only `${…}` atom (§67.4, ruling S462 F1):
    // its value is inserted as text and can never create structure. The phase-1
    // reader (a plain string in) never produces a Slot.
    

    

    
    
    

    // Block content. `CodeBlock.lang` is "" or matches [A-Za-z0-9_+-]+ (the only
    // part of an info string the reader keeps). `List.start` is the first ordered
    // number (1 for a bullet list).
    

    // A diagnostic: the W-MD code, its message (it names the scrml-md spelling),
    // the 0-based offset into the input, and the 1-based line and column.
    

    

    // The result of the §67.2 dedent rule over a static `<md>` body.
    //   text      the dedented body
    //   indent    the number of characters stripped from each counted line
    //   dropFirst true when the (blank) line right after `<md>` was dropped
    //   mixed     true when the stripped prefixes differ character for character
    //             (a tab on one line, spaces on another) — E-MD-INDENT-MIXED
    

    // A text-only slot handed to `parseSlots` (§67.4): the input offset of its
    // U+FFFC, and the exact source text of its `${…}` (restored inside code).
    

    // ---------------------------------------------------------------------------
    // Internal shapes
    // ---------------------------------------------------------------------------

    // One input line: its text, and the input offset of text[0].
    

    // The text-only slots of a static body (§67.4), ascending by offset: where
    // each `${…}` sits in the reader's input (as one U+FFFC) and its exact
    // source text, which is put back verbatim when the slot lands in code.
    //   ids  the caller's index of each slot (what `Slot(i)` carries)
    

    const SLOT_CHAR = "￼"

    // The index of the slot at input offset `off`, or -1. A U+FFFC the author
    // typed is not in the list, so it is an ordinary character.
    

    // `text`, whose character k sits at input offset `at` + k, with every slot
    // put back as its exact source text (a slot inside code is inert, §67.4).
    

    // A diagnostic before line/column are known.
    

    // The blocks of one container, whether each block was preceded by a blank
    // line (for list looseness), and the notes found.
    

    // Inline content of one block and the notes found.
    

    // The tail of an inline link after `]`: `(dest "title")`.
    //   ok         the tail parsed
    //   end        index just past the closing `)`
    //   used       characters scanned (charged to the scan budget)
    //   altTitle   a '…' or (…) title was seen (W-MD-LINK-TITLE)
    //   angleDest  a <…> destination was seen (W-MD-LINK-DESTINATION)
    //   overBudget the scan stopped on the budget (W-MD-SCAN-LIMIT)
    //   destA/destB  the destination's text range; titleA/titleB the title's
    //                (inside the quotes; titleA -1 when there is none)
    

    // ---------------------------------------------------------------------------
    // Limits (§67.9)
    // ---------------------------------------------------------------------------

    const MAX_DEPTH = 32      // block nesting (quotes, lists) and inline nesting
    const MAX_BRACKETS = 32   // link/image openers open at once

    // ---------------------------------------------------------------------------
    // Characters
    // ---------------------------------------------------------------------------

    

    

    // ASCII punctuation: the characters a backslash escapes (CommonMark 2.4).
    

    // Unicode whitespace for emphasis flanking (CommonMark 2.1). A line end and
    // the edge of the text count as whitespace.
    

    // Unicode punctuation for emphasis flanking: general categories P and S.
    

    

    

    // ---------------------------------------------------------------------------
    // Lines and indentation
    // ---------------------------------------------------------------------------

    // Columns of leading whitespace; a tab advances to the next multiple of 4.
    

    // Remove `n` columns of indentation. A tab that straddles column `n` leaves
    // its remaining columns as spaces.
    

    // Remove all leading whitespace.
    

    

    

    // ---------------------------------------------------------------------------
    // Block starts — what a line (inside its container, indentation <= 3) opens
    // ---------------------------------------------------------------------------

    // An opening code fence: 3+ backticks and an info string with no backtick.
    // Returns the fence length, or 0.
    

    // A `~~~` fence (the second spelling of a fence — W-MD-FENCE-TILDE).
    

    // ATX heading level (1–6) when `t` is a heading line, else 0.
    

    // The canonical thematic break: three or more `-` and nothing else.
    

    // A CommonMark thematic break that is not the canonical `---`: `***`, `___`,
    // or a spaced `- - -` (W-MD-THEMATIC-BREAK).
    

    // A setext underline of `=` (W-MD-SETEXT).
    

    // A list marker: `- ` (bullet) or `N. ` (ordered, 1–9 digits). Returns the
    // marker's width in characters, or 0. The marker must be followed by a space,
    // a tab or the end of the line.
    

    

    // A second spelling of a list marker: `* `, `+ ` (W-MD-BULLET-MARKER) or
    // `N) ` (W-MD-ORDERED-MARKER). Returns the code, or "".
    

    // ---- tables -------------------------------------------------------------

    // Indices of the unescaped `|` characters in `s`.
    

    // A canonical table row: it starts and ends with an unescaped `|` and has at
    // least one cell.
    

    // The cells of a canonical row, as Lines (trimmed, with their offsets).
    

    

    // A canonical delimiter row: a pipe row whose every cell is `---`, `:--`,
    // `--:` or `:-:`.
    

    // A delimiter row written without one or both outer pipes (W-MD-TABLE-PIPES).
    

    

    // Does a table start at lines[i]? (A canonical header row followed by a
    // canonical delimiter row with the same number of cells.)
    

    // A table written without its outer pipes (header has a `|`, the next line is
    // a delimiter row) but not in the canonical form.
    

    // ---- what interrupts a paragraph ----------------------------------------

    // Does lines[j] (non-blank) start a block that ends a paragraph? (Lazy
    // continuation is not scrml-md, so the same test ends a quote or list item.)
    // An ordered item interrupts a paragraph only when it starts at 1, and an
    // empty item never does (CommonMark 5.2).
    

    // Does `s` start a block in CommonMark through a second spelling (a `*` / `+`
    // / `N)` marker, a `***` break, a `~~~` fence)? Such a line is not a lazy
    // continuation in CommonMark either, so it is never reported as one.
    

    // ---------------------------------------------------------------------------
    // Blocks
    // ---------------------------------------------------------------------------

    // Read the lines of one container into blocks. `depth` is the container
    // nesting (0 at the top); quotes and lists are recognised below MAX_DEPTH.
    

    // Does `t` start a CommonMark link reference definition (`[label]: …`) or
    // footnote definition (`[^label]: …`)? The label may hold `\]` escapes and
    // line ends (no blank line — the caller passes one paragraph). Returns the
    // code to report, or "".
    

    
    

    // A table row of exactly `width` cells: extra cells dropped, missing cells
    // empty. `\|` in a cell is a literal `|`.
    

    // A paragraph starting at lines[i]: it runs until a blank line or a line that
    // starts another block. OUT constructs that look like blocks (indented code,
    // `~~~`, `***`, `* item`, setext underlines, reference definitions, raw HTML
    // lines) are paragraph text here, each with its W-MD note.
    

    // A block quote starting at lines[i]: consecutive lines that begin with `>`.
    // A non-blank line without `>` ends it (no lazy continuation); when it would
    // have continued the quote's paragraph in CommonMark it is W-MD-LAZY-CONTINUATION.
    

    // Does the content of `lines` end in an open paragraph? (Its last non-blank
    // line is paragraph text, not a fence, heading, rule or table row.)
    

    // A list starting at lines[i]. Items of one kind (bullet `-` or ordered `N.`)
    // follow each other, blank lines allowed between them. An item's content is
    // indented to the column after its marker (1–4 spaces; 5+ means 1). A list is
    // loose when a blank line separates two items or two blocks of one item.
    

    // ---------------------------------------------------------------------------
    // Inlines — CommonMark §6, the delimiter-run and bracket algorithm, over a
    // linked list of items held in parallel arrays (one arena per block).
    // ---------------------------------------------------------------------------

    // Item kinds.
    const K_TEXT = 0     // literal text
    const K_DELIM = 1    // a `*` / `_` / `~` run that may still become emphasis
    const K_NODE = 2     // a finished node
    const K_OPEN = 3     // a `[` or `![` that may still open a link or image

    // The arena: item i is (kind[i], txt[i], node[i]); nxt/prv link the items in
    // order; a delimiter item also sits on the delimiter list (dnx/dpv) with its
    // character, remaining count (cnt), original run length (olen) and whether it
    // can open / close. dep[i] is the nesting depth of a node item.
    

    

    // Append an item at the tail.
    

    

    // Append a delimiter run and push it on the delimiter list.
    

    // Unlink delimiter `d` from the delimiter list (its item stays, as text).
    

    // Unlink item `i` from the item list.
    

    // Record a note (W-MD-DEPTH-LIMIT at most once per block).
    

    // The nodes of items a..b (inclusive, in list order), adjacent text merged,
    // and the deepest node among them.
    

    

    // Replace items a..b (inclusive) by one node item, linked where they were.
    

    // The emphasis slot for openers_bottom: (character, closer length mod 3,
    // closer can open) — CommonMark 6.2 "process emphasis".
    

    // CommonMark 6.2 "process emphasis" over the delimiters above `bottom` (-1:
    // all). `*` makes em/strong; `~~` makes del; `_` and a single `~` match like
    // CommonMark / GFM but are second spellings, so the match is reported
    // (W-MD-EMPHASIS-UNDERSCORE / W-MD-STRIKETHROUGH) and the text stays literal.
    

    // Flanking (CommonMark 6.2): the run [p, p+len) of `ch` in `s`.
    

    // A slot next to the run counts as one letter (§67.4), whatever its value.
    

    // Resolve backslash escapes in a link destination or title.
    

    

    // The inline-link tail at s[q] == "(": `(dest)` or `(dest "title")`.
    // The destination is bare: no spaces or controls, parentheses balanced (at
    // most 32 deep). The title is double-quoted. At most `budget` characters
    // are examined.
    

    // Is text[i] a slot? (An author-typed U+FFFC is not.)
    

    // The attribute-valued string text[a..b): literal pieces with backslash
    // escapes resolved, and each slot as `MdSeg.Slot` (a data-led value, §67.4).
    

    // The content of a code span text[a..b) (CommonMark 6.1): line ends read as
    // spaces; a slot is put back as its exact source text (inert in code,
    // §67.4); in a table cell, `\|` is a literal `|` (GFM).
    

    // The plain text of inline nodes as an attribute value (an image's alt),
    // slots kept as slots.
    

    // One inline node (not a slot) as plain-text pieces.
    

    // The plain text of inline nodes (an image's alt text, a heading's slug).
    

    

    

    // Is there, at s[p] == "<", an angle autolink (`<scheme:…>` or `<a@b.c>`)?
    

    // Does raw HTML start at s[p] == "<"? A comment, a processing instruction,
    // a declaration or CDATA start; or a tag — `<name` / `</name` followed by
    // whitespace, `/` or `>`, closed by a `>` before the next `<` (CommonMark
    // 6.6, read generously: this only decides whether to report; the text is
    // literal either way). The scan stops at the next `<`, so it is linear.
    

    // The index of the first HTML character reference in `s`, or -1.
    

    // An HTML character reference at s[p] == "&".
    

    // The inline content of one block. `parts` are its lines (leading whitespace
    // already removed); they are joined with "\n" and read as one text.
    

    // Keep `at` (item -> text index) as long as the arena.
    

    // The input offset of text index `i`.
    

    // The maximal backtick runs of `s`, in order (position, length), and for
    // each length the indices of the runs that have it. A code span closes at
    // the first later run of exactly its opener's length; backslash escapes do
    // not apply inside a code span, so closers are raw runs (CommonMark 6.1).
    

    

    // The first run after run `r` whose length is exactly `l` (-1: none).
    

    // ---------------------------------------------------------------------------
    // Diagnostics
    // ---------------------------------------------------------------------------

    // The message for each code. Each names the scrml-md spelling (§67.3).
    

    const MESSAGES = [
        { code: "W-MD-RAW-HTML", text: "Raw HTML is not markdown in scrml-md: the tag is shown as text. Write the effect in markdown (`**bold**`, `*emphasis*`), or close `</md>` and write the element." },
        { code: "W-MD-ENTITY", text: "Character references are not decoded in scrml-md: `&…;` is shown as typed. Type the character itself." },
        { code: "W-MD-AUTOLINK", text: "Angle autolinks are not scrml-md: `<…>` is shown as text. Write `[text](url)`." },
        { code: "W-MD-REFERENCE-LINK", text: "Reference links are not scrml-md: `[text][ref]` and `[ref]: url` are shown as text. Write the link inline: `[text](url)`." },
        { code: "W-MD-FOOTNOTE", text: "Footnotes are not scrml-md: `[^…]` is shown as text. Write the note inline, or as a list at the end." },
        { code: "W-MD-TASK-LIST", text: "Task-list checkboxes are not scrml-md: `[ ]` / `[x]` is shown as text. Write a plain `- item`; for a checkbox, write an `<input type=checkbox>` element outside `<md>`." },
        { code: "W-MD-SETEXT", text: "Setext headings are not scrml-md: an underline of `=` or `-` characters does not make a heading, and a `---` line is a rule. Write `# Title` or `## Title`." },
        { code: "W-MD-INDENTED-CODE", text: "Indented code blocks are not scrml-md: the indented lines are paragraph text. Write a fenced code block between two lines of three backticks." },
        { code: "W-MD-EMPHASIS-UNDERSCORE", text: "`_` emphasis is not scrml-md: the underscores are shown as text. Write `*emphasis*` or `**strong**`." },
        { code: "W-MD-STRIKETHROUGH", text: "Single-`~` strikethrough is not scrml-md: the tildes are shown as text. Write `~~deleted~~`." },
        { code: "W-MD-BULLET-MARKER", text: "A `*` or `+` list marker is not scrml-md: the line is paragraph text. Write `- item`." },
        { code: "W-MD-ORDERED-MARKER", text: "A `1)` list marker is not scrml-md: the line is paragraph text. Write `1. item`." },
        { code: "W-MD-THEMATIC-BREAK", text: "A `***`, `___` or spaced break is not scrml-md: the line is paragraph text. Write `---` on its own line." },
        { code: "W-MD-FENCE-TILDE", text: "A `~~~` fence is not scrml-md: the lines are paragraph text. Write the fence with three backticks." },
        { code: "W-MD-HEADING-CLOSE", text: "A closing `#` sequence is not scrml-md: the trailing `#` characters are part of the heading text. Write `## Title` with no trailing `#`." },
        { code: "W-MD-HARD-BREAK-SPACES", text: "A two-space line break is not scrml-md: the line ends with a soft break. End the line with a backslash for a hard break." },
        { code: "W-MD-LINK-TITLE", text: "A single-quoted or parenthesized link title is not scrml-md: the link is shown as text. Write the title in double quotes: `[text](url \"title\")`." },
        { code: "W-MD-LINK-DESTINATION", text: "An angle-bracketed link destination is not scrml-md: the link is shown as text. Write the destination bare, with each space as `%20`." },
        { code: "W-MD-TABLE-PIPES", text: "A table row without a leading and a trailing `|` is not scrml-md: the lines are paragraph text. Write every row as `| a | b |`." },
        { code: "W-MD-LAZY-CONTINUATION", text: "Lazy continuation is not scrml-md: this line is not part of the quote or list item above it. Start it with `>`, or indent it to the item's content column." },
        { code: "W-MD-DEPTH-LIMIT", text: "Nesting deeper than 32 levels is not read: the deeper markers are shown as text." },
        { code: "W-MD-SCAN-LIMIT", text: "The link-scanning budget for this block is used up: the remaining link brackets are shown as text." }
    ]

    

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    // Read scrml-md. `src` is markdown text (a dedented static body, or data for
    // `<md of=…/>`). Every input is accepted: what is not scrml-md is text.
    

    // Read a STATIC body that holds text-only slots (§67.4, phase 2's entry).
    // `src` carries one U+FFFC at each slot's offset; `slots` gives each slot's
    // offset and the exact source text of its `${…}`. A slot becomes
    // `MdInline.Slot(i)` / `MdSeg.Slot(i)` (i = its index in `slots`); inside a
    // code span or fence it is put back as its source text. An entry whose
    // offset does not hold U+FFFC is ignored.
    

    

    // The §67.2 dedent rule for a static `<md>` body (the text between `<md>` and
    // `</md>`). The blank remainder of the opener's line is dropped; a first line
    // that holds content is kept as written and not counted. The closer's line,
    // when it holds only whitespace, is dropped and does NOT count: `</md>` sits
    // at the opener's indentation, one level left of the content, and counting
    // it would leave every content line indented (a heading at 4 spaces is not a
    // heading). Blank lines do not count and become empty. Every counted line
    // loses the minimum indentation, measured in characters; the stripped
    // prefixes must be the same characters on every counted line, else `mixed`
    // (E-MD-INDENT-MIXED).
    

    // The heading slug of `text` (§67.6), GitHub-style: lower-cased where the
    // case maps; Unicode letters, marks, digits and connector punctuation (`_`)
    // kept; a space becomes `-` and `-` stays; every other character dropped;
    // "section" when nothing is left.
    

    // The ids for the headings of a STATIC `<md>` body, in document order (nested
    // headings included). A slug already in `taken`, or produced earlier, gets the
    // first free `-1`, `-2`, … suffix. Data-sourced md gets no ids (§67.6).
    // Linear: a set of the ids in use, and for each base the next suffix to try.

function slotIndex(sl, off) {
  let lo = 0;
  let hi = sl.offs.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const v = sl.offs[mid];
    if (_scrml_structural_eq(v, off)) {
    return mid;
  }
    if (v < off) {
    lo = mid + 1;
  }
  else {
    hi = mid - 1;
  }
  }
  return -1;
}

function restoreSlots(text, at, sl) {
  if ((sl.offs.length === 0) || text.indexOf(SLOT_CHAR) < 0) {
    return text;
  }
  let out = "";
  let k = 0;
  while (k < text.length) {
    const c = text[k];
    const si = _scrml_structural_eq(c, SLOT_CHAR) ? slotIndex(sl, at + k) : -1;
    out = out + (si >= 0 ? sl.srcs[si] : c);
    k = k + 1;
  }
  return out;
}

function isSpaceOrTab(c) {
  return _scrml_structural_eq(c, " ") || _scrml_structural_eq(c, "\t");
}

function isBlank(s) {
  return _scrml_structural_eq(s.trim(), "");
}

function isAsciiPunct(c) {
  return (c.length === 1) && "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".indexOf(c) >= 0;
}

function isWs(c) {
  return _scrml_structural_eq(c, "") || /^\s$/u.test(c);
}

function isPunct(c) {
  return !_scrml_structural_eq(c, "") && /^[\p{P}\p{S}]$/u.test(c);
}

function isAsciiAlnum(c) {
  return /^[A-Za-z0-9]$/.test(c);
}

function isDigit(c) {
  return c >= "0" && c <= "9" && (c.length === 1);
}

function indentOf(s) {
  let col = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (_scrml_structural_eq(c, " ")) {
    col = col + 1;
  }
  else {
    if (_scrml_structural_eq(c, "\t")) {
    col = col + 4 - col % 4;
  }
  else {
    break;
  }
  }
    i = i + 1;
  }
  return col;
}

function stripCols(line, n) {
  const s = line.text;
  let col = 0;
  let i = 0;
  while (i < s.length && col < n) {
    const c = s[i];
    if (_scrml_structural_eq(c, " ")) {
    col = col + 1;
  }
  else {
    if (_scrml_structural_eq(c, "\t")) {
    col = col + 4 - col % 4;
  }
  else {
    break;
  }
  }
    i = i + 1;
  }
  const extra = col > n ? " ".repeat(col - n) : "";
  return {text: extra + s.substring(i), offset: line.offset + i - extra.length};
}

function stripLead(line) {
  const s = line.text;
  let i = 0;
  while (i < s.length && isSpaceOrTab(s[i])) {
    i = i + 1;
  }
  return {text: s.substring(i), offset: line.offset + i};
}

function trimEnd(s) {
  let e = s.length;
  while (e > 0 && isSpaceOrTab(s[e - 1])) {
    e = e - 1;
  }
  return s.substring(0, e);
}

function note(code, offset) {
  return {code: code, offset: offset};
}

function fenceLen(t) {
  let n = 0;
  while (n < t.length && _scrml_structural_eq(t[n], "`")) {
    n = n + 1;
  }
  if (n < 3) {
    return 0;
  }
  if (t.substring(n).indexOf("`") >= 0) {
    return 0;
  }
  return n;
}

function isTildeFence(t) {
  return t.startsWith("~~~");
}

function headingLevel(t) {
  let n = 0;
  while (n < t.length && _scrml_structural_eq(t[n], "#")) {
    n = n + 1;
  }
  if (n < 1 || n > 6) {
    return 0;
  }
  if (_scrml_structural_eq(n, t.length) || isSpaceOrTab(t[n])) {
    return n;
  }
  return 0;
}

function isRule(t) {
  const s = trimEnd(t);
  if (s.length < 3) {
    return false;
  }
  for (const c of s) {
    if (!_scrml_structural_eq(c, "-")) {
    return false;
  }
  }
  return true;
}

function isAltRule(t) {
  if (isRule(t)) {
    return false;
  }
  const s = trimEnd(t);
  let ch = "";
  let n = 0;
  for (const c of s) {
    if (_scrml_structural_eq(c, " ") || _scrml_structural_eq(c, "\t")) {
    continue;
  }
    if (!_scrml_structural_eq(c, "-") && !_scrml_structural_eq(c, "*") && !_scrml_structural_eq(c, "_")) {
    return false;
  }
    if (!_scrml_structural_eq(ch, "") && !_scrml_structural_eq(c, ch)) {
    return false;
  }
    ch = c;
    n = n + 1;
  }
  return n >= 3;
}

function isEqualsLine(t) {
  const s = trimEnd(t);
  if (s.length < 1) {
    return false;
  }
  for (const c of s) {
    if (!_scrml_structural_eq(c, "=")) {
    return false;
  }
  }
  return true;
}

function markerWidth(t) {
  if (t.startsWith("-")) {
    if ((t.length === 1) || isSpaceOrTab(t[1])) {
    return 1;
  }
    return 0;
  }
  let n = 0;
  while (n < t.length && n < 10 && isDigit(t[n])) {
    n = n + 1;
  }
  if (n < 1 || n > 9 || n >= t.length || !_scrml_structural_eq(t[n], ".")) {
    return 0;
  }
  if ((n + 1 === t.length) || isSpaceOrTab(t[n + 1])) {
    return n + 1;
  }
  return 0;
}

function isOrderedMarker(t) {
  return !t.startsWith("-");
}

function altMarker(t) {
  if (/^[*+]([ \t]|$)/.test(t) && !isAltRule(t)) {
    return "W-MD-BULLET-MARKER";
  }
  let n = 0;
  while (n < t.length && n < 10 && isDigit(t[n])) {
    n = n + 1;
  }
  if (n >= 1 && n <= 9 && n < t.length && _scrml_structural_eq(t[n], ")") && ((n + 1 === t.length) || isSpaceOrTab(t[n + 1]))) {
    return "W-MD-ORDERED-MARKER";
  }
  return "";
}

function pipeIndices(s) {
  let out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (_scrml_structural_eq(c, "\\")) {
    i = i + 2;
    continue;
  }
    if (_scrml_structural_eq(c, "|")) {
    out.push(i);
  }
    i = i + 1;
  }
  return out;
}

function isPipeRow(t) {
  const s = trimEnd(t);
  if (s.length < 2 || !s.startsWith("|")) {
    return false;
  }
  const ps = pipeIndices(s);
  return ps.length >= 2 && _scrml_structural_eq(ps[ps.length - 1], s.length - 1);
}

function rowCells(line) {
  const s = trimEnd(line.text);
  const ps = pipeIndices(s);
  let out = [];
  let k = 0;
  while (k + 1 < ps.length) {
    const from = ps[k] + 1;
    const raw = s.substring(from, ps[k + 1]);
    let lead = 0;
    while (lead < raw.length && isSpaceOrTab(raw[lead])) {
    lead = lead + 1;
  }
    out.push({text: trimEnd(raw.substring(lead)), offset: line.offset + from + lead});
    k = k + 1;
  }
  return out;
}

function isDelimCell(c) {
  return /^:?-+:?$/.test(c);
}

function isDelimRow(t) {
  if (!isPipeRow(t)) {
    return false;
  }
  for (const c of rowCells({text: t, offset: 0})) {
    if (!isDelimCell(c.text)) {
    return false;
  }
  }
  return true;
}

function isLooseDelimRow(t) {
  let s = t.trim();
  if ((pipeIndices(s).length === 0)) {
    return false;
  }
  if (s.startsWith("|")) {
    s = s.substring(1);
  }
  if (s.endsWith("|")) {
    s = s.substring(0, s.length - 1);
  }
  for (const c of s.split("|")) {
    if (!isDelimCell(c.trim())) {
    return false;
  }
  }
  return true;
}

function alignOf(c) {
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  if (l && r) {
    return MdAlign.Center;
  }
  if (l) {
    return MdAlign.Left;
  }
  if (r) {
    return MdAlign.Right;
  }
  return MdAlign.Default;
}

function tableStartsAt(lines, i) {
  if (i + 1 >= lines.length) {
    return false;
  }
  const h = lines[i].text;
  const d = lines[i + 1].text;
  if (indentOf(h) > 3 || indentOf(d) > 3) {
    return false;
  }
  const ht = h.trim();
  const dt = d.trim();
  if (!isPipeRow(ht) || !isDelimRow(dt)) {
    return false;
  }
  return (rowCells({text: ht, offset: 0}).length === rowCells({text: dt, offset: 0}).length);
}

function looseTableAt(lines, i) {
  if (i + 1 >= lines.length || tableStartsAt(lines, i)) {
    return false;
  }
  const h = lines[i].text.trim();
  return pipeIndices(h).length > 0 && isLooseDelimRow(lines[i + 1].text);
}

function interrupts(lines, j, depth) {
  const s = lines[j].text;
  if (indentOf(s) > 3) {
    return false;
  }
  const t = s.trim();
  if (fenceLen(t) > 0 || headingLevel(t) > 0 || isRule(t)) {
    return true;
  }
  if (tableStartsAt(lines, j)) {
    return true;
  }
  if (depth >= MAX_DEPTH) {
    return false;
  }
  if (t.startsWith(">")) {
    return true;
  }
  const w = isAltRule(t) ? 0 : markerWidth(t);
  if (w > 0) {
    if (isBlank(t.substring(w))) {
    return false;
  }
    if (isOrderedMarker(t)) {
    return t.startsWith("1.");
  }
    return true;
  }
  return false;
}

function otherStart(s) {
  if (indentOf(s) > 3) {
    return false;
  }
  const t = s.trim();
  return !_scrml_structural_eq(altMarker(t), "") || isAltRule(t) || isTildeFence(t);
}

function parseBlocks(lines, depth, sl) {
  let blocks = [];
  let gaps = [];
  let notes = [];
  let gap = false;
  let depthNoted = false;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const s = line.text;
    if (isBlank(s)) {
    gap = true;
    i = i + 1;
    continue;
  }
    const ind = indentOf(s);
    const lead = stripLead(line);
    const t = lead.text;
    let handled = false;
    if (ind <= 3) {
    const fl = fenceLen(t);
    if (fl > 0) {
    const rawInfo = restoreSlots(t.substring(fl), lead.offset + fl, sl);
    const ent = entityIndex(rawInfo);
    if (ent >= 0) {
    notes.push(note("W-MD-ENTITY", lead.offset + fl + ent));
  }
    const info = unescape(rawInfo.trim());
    const word = info.split(/[ \t]/)[0];
    const lang = /^[A-Za-z0-9_+-]+$/.test(word) ? word : "";
    let body = [];
    let j = i + 1;
    let closed = false;
    while (j < n) {
    const cs = lines[j].text;
    const ct = cs.trim();
    if (indentOf(cs) <= 3 && ct.length >= fl && /^`+$/.test(ct)) {
    closed = true;
    break;
  }
    const cl = stripCols(lines[j], ind);
    body.push(restoreSlots(cl.text, cl.offset, sl));
    j = j + 1;
  }
    const text = (body.length === 0) ? "" : body.join("\n") + "\n";
    blocks.push(MdBlock.CodeBlock(lang, text));
    gaps.push(gap);
    gap = false;
    i = closed ? j + 1 : j;
    continue;
  }
    const level = headingLevel(t);
    if (level > 0) {
    let k = level;
    while (k < t.length && isSpaceOrTab(t[k])) {
    k = k + 1;
  }
    const content = trimEnd(t.substring(k));
    let e = content.length;
    while (e > 0 && _scrml_structural_eq(content[e - 1], "#")) {
    e = e - 1;
  }
    if (e < content.length && (_scrml_structural_eq(e, 0) || isSpaceOrTab(content[e - 1]))) {
    notes.push(note("W-MD-HEADING-CLOSE", lead.offset + k + e));
  }
    const inl = parseInlines([{text: content, offset: lead.offset + k}], sl, false);
    for (const x of inl.notes) {
    notes.push(x);
  }
    blocks.push(MdBlock.Heading(level, inl.nodes));
    gaps.push(gap);
    gap = false;
    i = i + 1;
    continue;
  }
    if (isRule(t)) {
    blocks.push(MdBlock.Rule);
    gaps.push(gap);
    gap = false;
    i = i + 1;
    continue;
  }
    if (tableStartsAt(lines, i)) {
    const head = rowCells(lead);
    const delims = rowCells(stripLead(lines[i + 1]));
    let align = [];
    for (const d of delims) {
    align.push(alignOf(d.text));
  }
    const hr = cellsRow(head, head.length, sl);
    for (const x of hr.notes) {
    notes.push(x);
  }
    let rows = [];
    let j = i + 2;
    while (j < n) {
    const rs = lines[j].text;
    if (isBlank(rs) || indentOf(rs) > 3 || !isPipeRow(rs.trim())) {
    break;
  }
    const r = cellsRow(rowCells(stripLead(lines[j])), head.length, sl);
    for (const x of r.notes) {
    notes.push(x);
  }
    rows.push(r.row);
    j = j + 1;
  }
    if (j < n && !isBlank(lines[j].text) && !interrupts(lines, j, depth) && !otherStart(lines[j].text)) {
    notes.push(note("W-MD-TABLE-PIPES", stripLead(lines[j]).offset));
  }
    blocks.push(MdBlock.Table(align, hr.row, rows));
    gaps.push(gap);
    gap = false;
    i = j;
    continue;
  }
    if (depth < MAX_DEPTH && !isAltRule(t)) {
    if (t.startsWith(">")) {
    const q = readQuote(lines, i, depth, sl);
    for (const x of q.notes) {
    notes.push(x);
  }
    blocks.push(q.block);
    gaps.push(gap);
    gap = false;
    i = q.next;
    continue;
  }
    if (markerWidth(t) > 0) {
    const l = readList(lines, i, depth, sl);
    for (const x of l.notes) {
    notes.push(x);
  }
    blocks.push(l.block);
    gaps.push(gap);
    gap = false;
    i = l.next;
    continue;
  }
  }
  else {
    if (depth >= MAX_DEPTH && !depthNoted && (t.startsWith(">") || markerWidth(t) > 0)) {
    notes.push(note("W-MD-DEPTH-LIMIT", lead.offset));
    depthNoted = true;
  }
  }
  }
    const p = readParagraph(lines, i, depth, sl);
    for (const x of p.notes) {
    notes.push(x);
  }
    blocks.push(p.block);
    gaps.push(gap);
    gap = false;
    i = p.next;
  }
  return {blocks: blocks, gaps: gaps, notes: notes};
}

function defKind(t) {
  if (/^\[\^(?:\\[\s\S]|[^\]\\])+\]:/.test(t)) {
    return "W-MD-FOOTNOTE";
  }
  if (/^\[(?:\\[\s\S]|[^\]\\])+\]:/.test(t)) {
    return "W-MD-REFERENCE-LINK";
  }
  return "";
}

function cellsRow(cells, width, sl) {
  let out = [];
  let notes = [];
  let k = 0;
  while (k < width) {
    if (k < cells.length) {
    const c = cells[k];
    const inl = parseInlines([c], sl, true);
    for (const x of inl.notes) {
    notes.push(x);
  }
    out.push({children: inl.nodes});
  }
  else {
    out.push({children: []});
  }
    k = k + 1;
  }
  return {row: {cells: out}, notes: notes};
}

function readParagraph(lines, i, depth, sl) {
  let notes = [];
  let parts = [];
  let deepNoted = false;
  let j = i;
  const n = lines.length;
  while (j < n) {
    const line = lines[j];
    const s = line.text;
    if (isBlank(s)) {
    break;
  }
    if (j > i && interrupts(lines, j, depth)) {
    if (isRule(s.trim())) {
    notes.push(note("W-MD-SETEXT", stripLead(line).offset));
  }
    break;
  }
    const lead = stripLead(line);
    const t = lead.text;
    const ind = indentOf(s);
    if (ind >= 4) {
    if (_scrml_structural_eq(j, i)) {
    notes.push(note("W-MD-INDENTED-CODE", lead.offset));
  }
  }
  else {
    if (j > i && (isEqualsLine(t) || /^-{1,2}[ \t]*$/.test(t))) {
    notes.push(note("W-MD-SETEXT", lead.offset));
  }
    if (/^<\/?[A-Za-z][A-Za-z0-9-]*([ \t]|\/?>|$)/.test(t) || /^<(!--|\?|![A-Za-z]|!\[CDATA\[)/.test(t)) {
    notes.push(note("W-MD-RAW-HTML", lead.offset));
  }
    if (isTildeFence(t)) {
    notes.push(note("W-MD-FENCE-TILDE", lead.offset));
  }
    if (isAltRule(t)) {
    notes.push(note("W-MD-THEMATIC-BREAK", lead.offset));
  }
    const am = altMarker(t);
    if (!_scrml_structural_eq(am, "")) {
    notes.push(note(am, lead.offset));
  }
    if (looseTableAt(lines, j)) {
    notes.push(note("W-MD-TABLE-PIPES", lead.offset));
  }
    if (depth >= MAX_DEPTH && !deepNoted && (t.startsWith(">") || markerWidth(t) > 0)) {
    notes.push(note("W-MD-DEPTH-LIMIT", lead.offset));
    deepNoted = true;
  }
    const def = defKind(t);
    if (!_scrml_structural_eq(def, "")) {
    notes.push(note(def, lead.offset));
  }
  }
    parts.push(lead);
    j = j + 1;
  }
  if (parts.length > 1) {
    let joined = "";
    for (const pt of parts) {
    joined = joined + (_scrml_structural_eq(joined, "") ? "" : "\n") + pt.text;
  }
    const def = defKind(joined);
    if (!_scrml_structural_eq(def, "")) {
    notes.push(note(def, parts[0].offset));
  }
  }
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = {text: trimEnd(last.text), offset: last.offset};
  const inl = parseInlines(parts, sl, false);
  for (const x of inl.notes) {
    notes.push(x);
  }
  return {block: MdBlock.Paragraph(inl.nodes), next: j, notes: notes};
}

function readQuote(lines, i, depth, sl) {
  let inner = [];
  let notes = [];
  let j = i;
  const n = lines.length;
  while (j < n) {
    const s = lines[j].text;
    if (isBlank(s) || indentOf(s) > 3) {
    break;
  }
    const lead = stripLead(lines[j]);
    if (!lead.text.startsWith(">")) {
    break;
  }
    let rest = {text: lead.text.substring(1), offset: lead.offset + 1};
    if (rest.text.startsWith(" ") || rest.text.startsWith("\t")) {
    rest = stripCols(rest, 1);
  }
    inner.push(rest);
    j = j + 1;
  }
  if (j < n && !isBlank(lines[j].text) && inner.length > 0 && !isBlank(inner[inner.length - 1].text) && !interrupts(lines, j, depth) && !otherStart(lines[j].text) && indentOf(lines[j].text) <= 3 && paragraphEndsWith(inner, depth + 1)) {
    notes.push(note("W-MD-LAZY-CONTINUATION", stripLead(lines[j]).offset));
  }
  const r = parseBlocks(inner, depth + 1, sl);
  for (const x of r.notes) {
    notes.push(x);
  }
  return {block: MdBlock.Quote(r.blocks), next: j, notes: notes};
}

function paragraphEndsWith(lines, depth) {
  const t = lines[lines.length - 1].text.trim();
  if (fenceLen(t) > 0 || /^`{3,}$/.test(t) || headingLevel(t) > 0 || isRule(t) || isPipeRow(t)) {
    return false;
  }
  if (depth < MAX_DEPTH && t.startsWith(">")) {
    return paragraphEndsWith([{text: t.substring(1), offset: 0}], depth + 1);
  }
  return true;
}

function readList(lines, i, depth, sl) {
  let notes = [];
  let items = [];
  let loose = false;
  const n = lines.length;
  const first = stripLead(lines[i]).text;
  const ordered = isOrderedMarker(first);
  const start = ordered ? parseInt(first.substring(0, markerWidth(first) - 1), 10) : 1;
  let j = i;
  while (j < n) {
    const lead = stripLead(lines[j]);
    const t = lead.text;
    const mw = markerWidth(t);
    const markerCol = indentOf(lines[j].text);
    const after = t.substring(mw);
    let spaces = indentOf(after);
    let width = mw + spaces;
    if (isBlank(after)) {
    width = mw + 1;
  }
  else {
    if (spaces > 4) {
    width = mw + 1;
  }
  }
    const firstLine = stripCols({text: after, offset: lead.offset + mw}, isBlank(after) ? 0 : width - mw);
    if (/^\[[ xX]\]([ \t]|$)/.test(firstLine.text)) {
    notes.push(note("W-MD-TASK-LIST", firstLine.offset));
  }
    let body = [isBlank(after) ? {text: "", offset: firstLine.offset} : firstLine];
    const contentCol = markerCol + width;
    let k = j + 1;
    const emptyThenBlank = isBlank(after) && k < n && isBlank(lines[k].text);
    while (k < n && !emptyThenBlank) {
    const s = lines[k].text;
    if (isBlank(s)) {
    body.push({text: "", offset: lines[k].offset});
    k = k + 1;
    continue;
  }
    if (indentOf(s) >= contentCol) {
    body.push(stripCols(lines[k], contentCol));
    k = k + 1;
    continue;
  }
    break;
  }
    let blanksAfter = 0;
    while (body.length > 1 && isBlank(body[body.length - 1].text)) {
    body = body.slice(0, body.length - 1);
    blanksAfter = blanksAfter + 1;
  }
    if (emptyThenBlank) {
    while (k < n && isBlank(lines[k].text)) {
    k = k + 1;
    blanksAfter = blanksAfter + 1;
  }
  }
    const r = parseBlocks(body, depth + 1, sl);
    for (const x of r.notes) {
    notes.push(x);
  }
    let g = 1;
    while (g < r.gaps.length) {
    if (r.gaps[g]) {
    loose = true;
  }
    g = g + 1;
  }
    items.push({children: r.blocks});
    if (k < n && !isBlank(lines[k].text) && _scrml_structural_eq(blanksAfter, 0) && indentOf(lines[k].text) <= 3 && !interrupts(lines, k, depth) && !otherStart(lines[k].text) && _scrml_structural_eq(markerWidth(stripLead(lines[k]).text), 0) && !isBlank(body[body.length - 1].text) && paragraphEndsWith(body, depth + 1)) {
    notes.push(note("W-MD-LAZY-CONTINUATION", stripLead(lines[k]).offset));
  }
    if (k < n && indentOf(lines[k].text) <= 3) {
    const nt = stripLead(lines[k]).text;
    if (markerWidth(nt) > 0 && !isAltRule(nt) && _scrml_structural_eq(isOrderedMarker(nt), ordered)) {
    if (blanksAfter > 0) {
    loose = true;
  }
    j = k;
    continue;
  }
  }
    j = k - blanksAfter;
    break;
  }
  return {block: MdBlock.List(ordered, start, !loose, items), next: j, notes: notes};
}

function newArena() {
  return {kind: [], txt: [], node: [], dep: [], nxt: [], prv: [], head: -1, tail: -1, dch: [], cnt: [], olen: [], canOpen: [], canClose: [], dnx: [], dpv: [], dlast: -1, notes: [], deepNoted: false};
}

function addItem(ar, kind, txt, node, dep) {
  const id = ar.kind.length;
  ar.kind.push(kind);
  ar.txt.push(txt);
  ar.node.push(node);
  ar.dep.push(dep);
  ar.nxt.push(-1);
  ar.prv.push(ar.tail);
  ar.dch.push("");
  ar.cnt.push(0);
  ar.olen.push(0);
  ar.canOpen.push(false);
  ar.canClose.push(false);
  ar.dnx.push(-1);
  ar.dpv.push(-1);
  if (ar.tail >= 0) {
    ar.nxt[ar.tail] = id;
  }
  else {
    ar.head = id;
  }
  ar.tail = id;
  return ar;
}

function addText(ar, s) {
  if (_scrml_structural_eq(s, "")) {
    return ar;
  }
  return addItem(ar, K_TEXT, s, MdInline.SoftBreak, 0);
}

function addDelim(ar, ch, len, open, close) {
  let a = addItem(ar, K_DELIM, ch.repeat(len), MdInline.SoftBreak, 0);
  const id = a.tail;
  a.dch[id] = ch;
  a.cnt[id] = len;
  a.olen[id] = len;
  a.canOpen[id] = open;
  a.canClose[id] = close;
  a.dpv[id] = a.dlast;
  if (a.dlast >= 0) {
    a.dnx[a.dlast] = id;
  }
  a.dlast = id;
  return a;
}

function dropDelim(ar, d) {
  const p = ar.dpv[d];
  const x = ar.dnx[d];
  if (p >= 0) {
    ar.dnx[p] = x;
  }
  if (x >= 0) {
    ar.dpv[x] = p;
  }
  else {
    ar.dlast = p;
  }
  ar.dpv[d] = -1;
  ar.dnx[d] = -1;
  return ar;
}

function dropItem(ar, i) {
  const p = ar.prv[i];
  const x = ar.nxt[i];
  if (p >= 0) {
    ar.nxt[p] = x;
  }
  else {
    ar.head = x;
  }
  if (x >= 0) {
    ar.prv[x] = p;
  }
  else {
    ar.tail = p;
  }
  return ar;
}

function addNote(ar, code, offset) {
  if (_scrml_structural_eq(code, "W-MD-DEPTH-LIMIT")) {
    if (ar.deepNoted) {
    return ar;
  }
    ar.deepNoted = true;
  }
  ar.notes.push(note(code, offset));
  return ar;
}

function collect(ar, a, b) {
  let out = [];
  let buf = "";
  let dep = 0;
  let i = a;
  while (i >= 0) {
    const k = ar.kind[i];
    if (_scrml_structural_eq(k, K_NODE)) {
    if (!_scrml_structural_eq(buf, "")) {
    out.push(MdInline.Text(buf));
    buf = "";
  }
    out.push(ar.node[i]);
    if (ar.dep[i] > dep) {
    dep = ar.dep[i];
  }
  }
  else {
    if (_scrml_structural_eq(k, K_DELIM)) {
    buf = buf + ar.dch[i].repeat(ar.cnt[i]);
  }
  else {
    buf = buf + ar.txt[i];
  }
  }
    if (_scrml_structural_eq(i, b)) {
    break;
  }
    i = ar.nxt[i];
  }
  if (!_scrml_structural_eq(buf, "")) {
    out.push(MdInline.Text(buf));
  }
  return {nodes: out, dep: dep};
}

function replaceRange(ar, a, b, node, dep) {
  const before = ar.prv[a];
  const after = ar.nxt[b];
  const id = ar.kind.length;
  let x = addItem(ar, K_NODE, "", node, dep);
  x = dropItem(x, id);
  x.prv[id] = before;
  x.nxt[id] = after;
  if (before >= 0) {
    x.nxt[before] = id;
  }
  else {
    x.head = id;
  }
  if (after >= 0) {
    x.prv[after] = id;
  }
  else {
    x.tail = id;
  }
  return x;
}

function slotOf(ch, len, canOpen) {
  const c = _scrml_structural_eq(ch, "*") ? 0 : _scrml_structural_eq(ch, "_") ? 1 : 2;
  return c * 6 + len % 3 * 2 + (canOpen ? 1 : 0);
}

function processEmphasis(ar0, bottom, at, starts, offs) {
  let ar = ar0;
  let openersBottom = [];
  let s = 0;
  let _scrml_tilde_1 = [];
  while (s < 18) {
    let _scrml_tilde_2 = openersBottom.push(bottom);
    s = s + 1;
  }
  let barrier = -1;
  let closer = -1;
  let d = ar.dlast;
  while (d >= 0 && !_scrml_structural_eq(d, bottom)) {
    closer = d;
    d = ar.dpv[d];
  }
  while (closer >= 0) {
    if (!ar.canClose[closer]) {
      closer = ar.dnx[closer];
      continue;
    }
    const ch = ar.dch[closer];
    const slot = slotOf(ch, ar.olen[closer], ar.canOpen[closer]);
    let opener = ar.dpv[closer];
    let found = false;
    while (opener >= 0 && !_scrml_structural_eq(opener, bottom) && !_scrml_structural_eq(opener, openersBottom[slot]) && opener > barrier) {
      if (_scrml_structural_eq(ar.dch[opener], ch) && ar.canOpen[opener]) {
        let ok = true;
        if (_scrml_structural_eq(ch, "~")) {
          ok = _scrml_structural_eq(ar.cnt[opener], ar.cnt[closer]);
        }
        else {
          if ((ar.canClose[opener] || ar.canOpen[closer]) && ((ar.olen[opener] + ar.olen[closer]) % 3 === 0) && !((ar.olen[opener] % 3 === 0) && (ar.olen[closer] % 3 === 0))) {
            ok = false;
          }
        }
        if (ok) {
          found = true;
          break;
        }
      }
      opener = ar.dpv[opener];
    }
    if (!found) {
      let _scrml_tilde_3 = openersBottom[slot] = ar.dpv[closer];
      const next = ar.dnx[closer];
      if (!ar.canOpen[closer]) {
        ar = dropDelim(ar, closer);
      }
      closer = next;
      continue;
    }
    if (_scrml_structural_eq(ch, "_") || _scrml_structural_eq(ch, "~") && _scrml_structural_eq(ar.cnt[closer], 1)) {
      ar = addNote(ar, _scrml_structural_eq(ch, "_") ? "W-MD-EMPHASIS-UNDERSCORE" : "W-MD-STRIKETHROUGH", posOf(starts, offs, at[opener]));
      const next = ar.dnx[closer];
      ar = dropDelim(ar, opener);
      ar = dropDelim(ar, closer);
      closer = next;
      continue;
    }
    const width = _scrml_structural_eq(ch, "~") ? 2 : ar.cnt[closer] >= 2 && ar.cnt[opener] >= 2 ? 2 : 1;
    const inner = _scrml_structural_eq(ar.nxt[opener], closer) ? {nodes: [], dep: 0} : collect(ar, ar.nxt[opener], ar.prv[closer]);
    if (inner.dep + 1 > MAX_DEPTH) {
      ar = addNote(ar, "W-MD-DEPTH-LIMIT", posOf(starts, offs, at[opener]));
      barrier = opener;
      const next = ar.dnx[closer];
      if (!ar.canOpen[closer]) {
        ar = dropDelim(ar, closer);
      }
      closer = next;
      continue;
    }
    const node = _scrml_structural_eq(ch, "~") ? MdInline.Del(inner.nodes) : _scrml_structural_eq(width, 2) ? MdInline.Strong(inner.nodes) : MdInline.Em(inner.nodes);
    let _scrml_tilde_4 = ar.cnt[opener] = ar.cnt[opener] - width;
    let _scrml_tilde_5 = ar.cnt[closer] = ar.cnt[closer] - width;
    if (_scrml_structural_eq(ar.nxt[opener], closer)) {
      const id = ar.kind.length;
      ar = addItem(ar, K_NODE, "", node, 1);
      ar = dropItem(ar, id);
      let _scrml_tilde_6 = ar.prv[id] = opener;
      let _scrml_tilde_7 = ar.nxt[id] = closer;
      let _scrml_tilde_8 = ar.nxt[opener] = id;
      let _scrml_tilde_9 = ar.prv[closer] = id;
    }
    else {
      ar = replaceRange(ar, ar.nxt[opener], ar.prv[closer], node, inner.dep + 1);
    }
    let _scrml_tilde_10 = ar.dnx[opener] = closer;
    let _scrml_tilde_11 = ar.dpv[closer] = opener;
    if (_scrml_structural_eq(ar.cnt[opener], 0)) {
      ar = dropDelim(ar, opener);
      ar = dropItem(ar, opener);
    }
    if (_scrml_structural_eq(ar.cnt[closer], 0)) {
      const next = ar.dnx[closer];
      ar = dropDelim(ar, closer);
      ar = dropItem(ar, closer);
      closer = next;
    }
  }
  while (ar.dlast >= 0 && !_scrml_structural_eq(ar.dlast, bottom)) {
    ar = dropDelim(ar, ar.dlast);
  }
  return ar;
}

function flanking(s, p, len, ch, slotBefore, slotAfter) {
  const before = slotBefore ? "a" : p > 0 ? s[p - 1] : "";
  const after = slotAfter ? "a" : p + len < s.length ? s[p + len] : "";
  const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
  const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
  if (_scrml_structural_eq(ch, "_")) {
    return {open: left && (!right || isPunct(before)), close: right && (!left || isPunct(after))};
  }
  return {open: left, close: right};
}

function unescape(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (_scrml_structural_eq(s[i], "\\") && i + 1 < s.length && isAsciiPunct(s[i + 1])) {
    out = out + s[i + 1];
    i = i + 2;
    continue;
  }
    out = out + s[i];
    i = i + 1;
  }
  return out;
}

function failTail(used, altTitle, angle, over) {
  return {ok: false, destA: 0, destB: 0, titleA: -1, titleB: -1, end: 0, used: used, altTitle: altTitle, angleDest: angle, overBudget: over};
}

function scanTail(s, q, budget) {
  let i = q + 1;
  let used = 0;
  while (i < s.length && (isSpaceOrTab(s[i]) || _scrml_structural_eq(s[i], "\n"))) {
    i = i + 1;
    used = used + 1;
  }
  if (i < s.length && _scrml_structural_eq(s[i], "<")) {
    return failTail(used, false, true, false);
  }
  const ds = i;
  let depth = 0;
  while (i < s.length) {
    used = used + 1;
    if (used > budget) {
    return failTail(used, false, false, true);
  }
    const c = s[i];
    if (_scrml_structural_eq(c, "\\") && i + 1 < s.length && isAsciiPunct(s[i + 1])) {
    i = i + 2;
    continue;
  }
    if (_scrml_structural_eq(c, "(")) {
    depth = depth + 1;
    if (depth > 32) {
    return failTail(used, false, false, false);
  }
  }
  else {
    if (_scrml_structural_eq(c, ")")) {
    if (_scrml_structural_eq(depth, 0)) {
    break;
  }
    depth = depth - 1;
  }
  else {
    if (c.charCodeAt(0) <= 32) {
    break;
  }
  }
  }
    i = i + 1;
  }
  if (!_scrml_structural_eq(depth, 0)) {
    return failTail(used, false, false, false);
  }
  const de = i;
  while (i < s.length && (isSpaceOrTab(s[i]) || _scrml_structural_eq(s[i], "\n"))) {
    i = i + 1;
  }
  let ta = -1;
  let tb = -1;
  if (i < s.length && _scrml_structural_eq(s[i], "\"") && i > ds) {
    const ts = i + 1;
    i = i + 1;
    while (i < s.length && !_scrml_structural_eq(s[i], "\"")) {
    used = used + 1;
    if (used > budget) {
    return failTail(used, false, false, true);
  }
    if (_scrml_structural_eq(s[i], "\\")) {
    i = i + 1;
  }
    i = i + 1;
  }
    if (i >= s.length) {
    return failTail(used, false, false, false);
  }
    ta = ts;
    tb = i;
    i = i + 1;
    while (i < s.length && (isSpaceOrTab(s[i]) || _scrml_structural_eq(s[i], "\n"))) {
    i = i + 1;
  }
  }
  else {
    if (i < s.length && (_scrml_structural_eq(s[i], "'") || _scrml_structural_eq(s[i], "(")) && i > ds) {
    return failTail(used, true, false, false);
  }
  }
  if (i >= s.length || !_scrml_structural_eq(s[i], ")")) {
    return failTail(used, false, false, false);
  }
  return {ok: true, destA: ds, destB: de, titleA: ta, titleB: tb, end: i + 1, used: used, altTitle: false, angleDest: false, overBudget: false};
}

function isSlotChar(text, i, starts, offs, sl) {
  if (i < 0 || i >= text.length || !_scrml_structural_eq(text[i], SLOT_CHAR)) {
    return false;
  }
  return slotIndex(sl, posOf(starts, offs, i)) >= 0;
}

function segsRange(text, a, b, starts, offs, sl) {
  let out = [];
  let piece = "";
  let k = a;
  while (k < b) {
    const si = _scrml_structural_eq(text[k], SLOT_CHAR) ? slotIndex(sl, posOf(starts, offs, k)) : -1;
    if (si >= 0) {
    if (!_scrml_structural_eq(piece, "")) {
    out.push(MdSeg.Lit(unescape(piece)));
    piece = "";
  }
    out.push(MdSeg.Slot(sl.ids[si]));
  }
  else {
    piece = piece + text[k];
  }
    k = k + 1;
  }
  if (!_scrml_structural_eq(piece, "")) {
    out.push(MdSeg.Lit(unescape(piece)));
  }
  return out;
}

function codeText(text, a, b, starts, offs, sl, cell) {
  let out = "";
  let k = a;
  while (k < b) {
    const c = text[k];
    if (_scrml_structural_eq(c, "\n")) {
    out = out + " ";
  }
  else {
    if (cell && _scrml_structural_eq(c, "\\") && k + 1 < b && _scrml_structural_eq(text[k + 1], "|")) {
    out = out + "|";
    k = k + 1;
  }
  else {
    if (_scrml_structural_eq(c, SLOT_CHAR) && slotIndex(sl, posOf(starts, offs, k)) >= 0) {
    out = out + sl.srcs[slotIndex(sl, posOf(starts, offs, k))];
  }
  else {
    out = out + c;
  }
  }
  }
    k = k + 1;
  }
  return out;
}

function plainSegs(nodes) {
  let out = [];
  let piece = "";
  for (const each of nodes) {
    for (const g of nestedSegs(each)) {
    if ((function(__v){return (typeof __v === "object" && __v !== null && typeof __v.variant === "string" ? __v.variant : __v) === "Slot";})(g)) {
    if (!_scrml_structural_eq(piece, "")) {
    out.push(MdSeg.Lit(piece));
    piece = "";
  }
    out.push(g);
  }
  else {
    piece = piece + litText(g);
  }
  }
  }
  if (!_scrml_structural_eq(piece, "")) {
    out.push(MdSeg.Lit(piece));
  }
  return out;
}

function nestedSegs(n) {
  return (function() {
    const _scrml_match_12 = n;
    const _scrml_tag_13 = (_scrml_match_12 != null && typeof _scrml_match_12 === "object") ? _scrml_match_12.variant : _scrml_match_12;
    if (_scrml_tag_13 === "Text") { const t = _scrml_match_12.data.text; return [ MdSeg.Lit ( t ) ]; }
    else if (_scrml_tag_13 === "Slot") { const k = _scrml_match_12.data.index; return [ MdSeg.Slot ( k ) ]; }
    else if (_scrml_tag_13 === "Code") { const t = _scrml_match_12.data.text; return [ MdSeg.Lit ( t ) ]; }
    else if (_scrml_tag_13 === "Em") { const cs = _scrml_match_12.data.children; return plainSegs ( cs ); }
    else if (_scrml_tag_13 === "Strong") { const cs = _scrml_match_12.data.children; return plainSegs ( cs ); }
    else if (_scrml_tag_13 === "Del") { const cs = _scrml_match_12.data.children; return plainSegs ( cs ); }
    else if (_scrml_tag_13 === "Link") { const d = _scrml_match_12.data.dest; const ti = _scrml_match_12.data.title; const cs = _scrml_match_12.data.children; return plainSegs ( cs ); }
    else if (_scrml_tag_13 === "Image") { const sr = _scrml_match_12.data.src; const a = _scrml_match_12.data.alt; const ti = _scrml_match_12.data.title; return a; }
    else if (_scrml_tag_13 === "SoftBreak") return [ MdSeg.Lit ( " " ) ];
    else if (_scrml_tag_13 === "HardBreak") return [ MdSeg.Lit ( " " ) ];
  })();
}

function plainText(nodes) {
  let out = "";
  for (const each of nodes) {
    const n = each;
    let _scrml_tilde_14 = null;
  const _scrml_match_15 = n;
  const _scrml_tag_16 = (_scrml_match_15 != null && typeof _scrml_match_15 === "object") ? _scrml_match_15.variant : _scrml_match_15;
  if (_scrml_tag_16 === "Text") {
    const t = _scrml_match_15.data.text;
    _scrml_tilde_14 = t;
  }
  else if (_scrml_tag_16 === "Slot") {
    const k = _scrml_match_15.data.index;
    _scrml_tilde_14 = "";
  }
  else if (_scrml_tag_16 === "Code") {
    const t = _scrml_match_15.data.text;
    _scrml_tilde_14 = t;
  }
  else if (_scrml_tag_16 === "Em") {
    const cs = _scrml_match_15.data.children;
    _scrml_tilde_14 = plainText ( cs );
  }
  else if (_scrml_tag_16 === "Strong") {
    const cs = _scrml_match_15.data.children;
    _scrml_tilde_14 = plainText ( cs );
  }
  else if (_scrml_tag_16 === "Del") {
    const cs = _scrml_match_15.data.children;
    _scrml_tilde_14 = plainText ( cs );
  }
  else if (_scrml_tag_16 === "Link") {
    const d = _scrml_match_15.data.dest; const ti = _scrml_match_15.data.title; const cs = _scrml_match_15.data.children;
    _scrml_tilde_14 = plainText ( cs );
  }
  else if (_scrml_tag_16 === "Image") {
    const sr = _scrml_match_15.data.src; const a = _scrml_match_15.data.alt; const ti = _scrml_match_15.data.title;
    _scrml_tilde_14 = segsText ( a );
  }
  else if (_scrml_tag_16 === "SoftBreak") {
    _scrml_tilde_14 = " ";
  }
  else if (_scrml_tag_16 === "HardBreak") {
    _scrml_tilde_14 = " ";
  }
  const piece = _scrml_tilde_14;
    out = out + piece;
  }
  return out;
}

function segsText(segs) {
  let out = "";
  for (const g of segs) {
    if ((function(__v){return (typeof __v === "object" && __v !== null && typeof __v.variant === "string" ? __v.variant : __v) === "Lit";})(g)) {
    out = out + litText(g);
  }
  }
  return out;
}

function litText(g) {
  return (function() {
    const _scrml_match_17 = g;
    const _scrml_tag_18 = (_scrml_match_17 != null && typeof _scrml_match_17 === "object") ? _scrml_match_17.variant : _scrml_match_17;
    if (_scrml_tag_18 === "Lit") { const t = _scrml_match_17.data.text; return t; }
    else if (_scrml_tag_18 === "Slot") { const k = _scrml_match_17.data.index; return ""; }
  })();
}

function isAutolinkAt(s, p) {
  let i = p + 1;
  let _scrml_tilde_19 = [];
  while (i < s.length && !_scrml_structural_eq(s[i], ">") && !_scrml_structural_eq(s[i], "<") && s[i].charCodeAt(0) > 32) {
    i = i + 1;
  }
  if (i >= s.length || !_scrml_structural_eq(s[i], ">")) {
    return false;
  }
  const body = s.substring(p + 1, i);
  return /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(body) || /^[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(body);
}

function isRawHtmlAt(s, p) {
  const rest = s.substring(p, p + 9);
  if (rest.startsWith("<!--") || rest.startsWith("<?") || rest.startsWith("<![CDATA[")) {
    return true;
  }
  if (/^<![A-Za-z]/.test(rest)) {
    return true;
  }
  let i = p + 1;
  if (i < s.length && _scrml_structural_eq(s[i], "/")) {
    i = i + 1;
  }
  if (i >= s.length || !/^[A-Za-z]$/.test(s[i])) {
    return false;
  }
  while (i < s.length && (isAsciiAlnum(s[i]) || _scrml_structural_eq(s[i], "-"))) {
    i = i + 1;
  }
  if (i >= s.length || !(isSpaceOrTab(s[i]) || _scrml_structural_eq(s[i], "\n") || _scrml_structural_eq(s[i], "/") || _scrml_structural_eq(s[i], ">"))) {
    return false;
  }
  while (i < s.length && !_scrml_structural_eq(s[i], "<") && !_scrml_structural_eq(s[i], ">")) {
    i = i + 1;
  }
  return i < s.length && _scrml_structural_eq(s[i], ">");
}

function entityIndex(s) {
  const m = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(s);
  if ((m === null || m === undefined)) {
    return -1;
  }
  return m.index;
}

function entityLen(s, p) {
  const m = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(s.substring(p, p + 40));
  if ((m === null || m === undefined)) {
    return 0;
  }
  return m[0].length;
}

function parseInlines(parts, sl, cell) {
  let text = "";
  let starts = [];
  let offs = [];
  let _scrml_tilde_20 = [];
  for (const pt of parts) {
    if (starts.length > 0) {
      text = text + "\n";
    }
    let _scrml_tilde_21 = starts.push(text.length);
    let _scrml_tilde_22 = offs.push(pt.offset);
    text = text + pt.text;
  }
  let ar = newArena();
  let at = [];
  let brItem = [];
  let brImage = [];
  let brActive = [];
  let brDelim = [];
  let brAt = [];
  let budget = 4 * text.length + 1024;
  let overNoted = false;
  const runs = backtickRuns(text);
  let runIdx = 0;
  let buf = "";
  let bufAt = 0;
  let p = 0;
  const n = text.length;
  while (p < n) {
    const c = text[p];
    const slotAt = _scrml_structural_eq(c, SLOT_CHAR) ? slotIndex(sl, posOf(starts, offs, p)) : -1;
    const special = slotAt >= 0 || _scrml_structural_eq(c, "\n") || _scrml_structural_eq(c, "\\") || _scrml_structural_eq(c, "`") || _scrml_structural_eq(c, "*") || _scrml_structural_eq(c, "_") || _scrml_structural_eq(c, "~") || _scrml_structural_eq(c, "[") || _scrml_structural_eq(c, "]") || _scrml_structural_eq(c, "!") && p + 1 < n && _scrml_structural_eq(text[p + 1], "[") || _scrml_structural_eq(c, "<") || _scrml_structural_eq(c, "&");
    if (!special) {
      if (_scrml_structural_eq(buf, "")) {
        bufAt = p;
      }
      buf = buf + c;
      p = p + 1;
      continue;
    }
    if (_scrml_structural_eq(c, "<") || _scrml_structural_eq(c, "&")) {
      const inDest = p >= 2 && _scrml_structural_eq(text[p - 1], "(") && _scrml_structural_eq(text[p - 2], "]");
      if (_scrml_structural_eq(c, "<")) {
        if (!inDest && isAutolinkAt(text, p)) {
          ar = addNote(ar, "W-MD-AUTOLINK", posOf(starts, offs, p));
        }
        else {
          if (!inDest && isRawHtmlAt(text, p)) {
            ar = addNote(ar, "W-MD-RAW-HTML", posOf(starts, offs, p));
          }
        }
      }
      else {
        if (entityLen(text, p) > 0) {
          ar = addNote(ar, "W-MD-ENTITY", posOf(starts, offs, p));
        }
      }
      if (_scrml_structural_eq(buf, "")) {
        bufAt = p;
      }
      buf = buf + c;
      p = p + 1;
      continue;
    }
    if (_scrml_structural_eq(c, "\\")) {
      if (p + 1 < n && _scrml_structural_eq(text[p + 1], "\n")) {
        ar = addText(ar, buf);
        at = padAt(at, ar, bufAt);
        buf = "";
        ar = addItem(ar, K_NODE, "", MdInline.HardBreak, 0);
        at = padAt(at, ar, p);
        p = p + 2;
        continue;
      }
      if (p + 1 < n && isAsciiPunct(text[p + 1])) {
        if (_scrml_structural_eq(buf, "")) {
          bufAt = p;
        }
        buf = buf + text[p + 1];
        p = p + 2;
        continue;
      }
      if (_scrml_structural_eq(buf, "")) {
        bufAt = p;
      }
      buf = buf + "\\";
      p = p + 1;
      continue;
    }
    ar = addText(ar, buf);
    at = padAt(at, ar, bufAt);
    buf = "";
    if (slotAt >= 0) {
      ar = addItem(ar, K_NODE, "", MdInline.Slot(sl.ids[slotAt]), 0);
      at = padAt(at, ar, p);
      p = p + 1;
      continue;
    }
    if (_scrml_structural_eq(c, "\n")) {
      let k = ar.tail;
      if (k >= 0 && _scrml_structural_eq(ar.kind[k], K_TEXT)) {
        const full = ar.txt[k];
        const trimmed = trimEnd(full);
        if (full.length - trimmed.length >= 2) {
          ar = addNote(ar, "W-MD-HARD-BREAK-SPACES", posOf(starts, offs, p));
        }
        let _scrml_tilde_23 = ar.txt[k] = trimmed;
      }
      ar = addItem(ar, K_NODE, "", MdInline.SoftBreak, 0);
      at = padAt(at, ar, p);
      p = p + 1;
      continue;
    }
    if (_scrml_structural_eq(c, "`")) {
      while (runIdx < runs.pos.length && runs.pos[runIdx] + runs.len[runIdx] <= p) {
        runIdx = runIdx + 1;
      }
      const len = runs.pos[runIdx] + runs.len[runIdx] - p;
      const close = closerRun(runs, runIdx, len);
      if (close < 0) {
        ar = addText(ar, "`".repeat(len));
        at = padAt(at, ar, p);
        p = p + len;
        runIdx = runIdx + 1;
        continue;
      }
      const cp = runs.pos[close];
      let code = codeText(text, p + len, cp, starts, offs, sl, cell);
      if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && !_scrml_structural_eq(code.trim(), "")) {
        code = code.substring(1, code.length - 1);
      }
      ar = addItem(ar, K_NODE, "", MdInline.Code(code), 0);
      at = padAt(at, ar, p);
      p = cp + len;
      runIdx = close + 1;
      continue;
    }
    if (_scrml_structural_eq(c, "*") || _scrml_structural_eq(c, "_") || _scrml_structural_eq(c, "~")) {
      let len = 1;
      while (p + len < n && _scrml_structural_eq(text[p + len], c)) {
        len = len + 1;
      }
      if (_scrml_structural_eq(c, "~") && len > 2) {
        ar = addText(ar, "~".repeat(len));
        at = padAt(at, ar, p);
        p = p + len;
        continue;
      }
      const f = flanking(text, p, len, c, isSlotChar(text, p - 1, starts, offs, sl), isSlotChar(text, p + len, starts, offs, sl));
      ar = addDelim(ar, c, len, f.open, f.close);
      at = padAt(at, ar, p);
      p = p + len;
      continue;
    }
    if (_scrml_structural_eq(c, "[") || _scrml_structural_eq(c, "!")) {
      const opensImage = _scrml_structural_eq(c, "!");
      const width = opensImage ? 2 : 1;
      if (brItem.length >= MAX_BRACKETS) {
        ar = addNote(ar, "W-MD-DEPTH-LIMIT", posOf(starts, offs, p));
        ar = addText(ar, opensImage ? "![" : "[");
        at = padAt(at, ar, p);
        p = p + width;
        continue;
      }
      ar = addItem(ar, K_OPEN, opensImage ? "![" : "[", MdInline.SoftBreak, 0);
      at = padAt(at, ar, p);
      let _scrml_tilde_24 = brItem.push(ar.tail);
      let _scrml_tilde_25 = brImage.push(opensImage);
      let _scrml_tilde_26 = brActive.push(true);
      let _scrml_tilde_27 = brDelim.push(ar.dlast);
      let _scrml_tilde_28 = brAt.push(p);
      p = p + width;
      continue;
    }
    if ((brItem.length === 0)) {
      ar = addText(ar, "]");
      at = padAt(at, ar, p);
      p = p + 1;
      continue;
    }
    const top = brItem.length - 1;
    const opener = brItem[top];
    const image = brImage[top];
    const active = brActive[top];
    const bottom = brDelim[top];
    const openAt = brAt[top];
    let _scrml_tilde_29 = brItem.pop();
    let _scrml_tilde_30 = brImage.pop();
    let _scrml_tilde_31 = brActive.pop();
    let _scrml_tilde_32 = brDelim.pop();
    let _scrml_tilde_33 = brAt.pop();
    let tail = failTail(0, false, false, false);
    if (active && p + 1 < n && _scrml_structural_eq(text[p + 1], "(")) {
      if (budget > 0) {
        tail = scanTail(text, p + 1, budget);
        budget = budget - tail.used;
      }
      if (tail.overBudget || budget <= 0) {
        if (!overNoted) {
          let _scrml_tilde_34 = ar.notes.push(note("W-MD-SCAN-LIMIT", posOf(starts, offs, p)));
          overNoted = true;
        }
      }
    }
    if (tail.ok) {
      ar = processEmphasis(ar, bottom, at, starts, offs);
      const inner = _scrml_structural_eq(ar.tail, opener) ? {nodes: [], dep: 0} : collect(ar, ar.nxt[opener], ar.tail);
      if (inner.dep + 1 > MAX_DEPTH) {
        ar = addNote(ar, "W-MD-DEPTH-LIMIT", posOf(starts, offs, openAt));
        ar = addText(ar, "]");
        at = padAt(at, ar, p);
        p = p + 1;
        continue;
      }
      const dest = segsRange(text, tail.destA, tail.destB, starts, offs, sl);
      const title = tail.titleA < 0 ? [] : segsRange(text, tail.titleA, tail.titleB, starts, offs, sl);
      const de = entityIndex(text.substring(tail.destA, tail.destB));
      if (de >= 0) {
        ar = addNote(ar, "W-MD-ENTITY", posOf(starts, offs, tail.destA + de));
      }
      if (tail.titleA >= 0) {
        const te = entityIndex(text.substring(tail.titleA, tail.titleB));
        if (te >= 0) {
          ar = addNote(ar, "W-MD-ENTITY", posOf(starts, offs, tail.titleA + te));
        }
      }
      const node = image ? MdInline.Image(dest, plainSegs(inner.nodes), title) : MdInline.Link(dest, title, inner.nodes);
      ar = replaceRange(ar, opener, ar.tail, node, inner.dep + 1);
      at = padAt(at, ar, openAt);
      if (!image) {
        let b = 0;
        while (b < brActive.length) {
          if (!brImage[b]) {
            let _scrml_tilde_35 = brActive[b] = false;
          }
          b = b + 1;
        }
      }
      p = tail.end;
      continue;
    }
    if (tail.altTitle) {
      ar = addNote(ar, "W-MD-LINK-TITLE", posOf(starts, offs, p));
    }
    else {
      if (tail.angleDest) {
        ar = addNote(ar, "W-MD-LINK-DESTINATION", posOf(starts, offs, p));
      }
      else {
        if (p + 1 < n && _scrml_structural_eq(text[p + 1], "[")) {
          ar = addNote(ar, "W-MD-REFERENCE-LINK", posOf(starts, offs, openAt));
        }
        else {
          if (!image && openAt + 1 < n && _scrml_structural_eq(text[openAt + 1], "^")) {
            ar = addNote(ar, "W-MD-FOOTNOTE", posOf(starts, offs, openAt));
          }
        }
      }
    }
    ar = addText(ar, "]");
    at = padAt(at, ar, p);
    p = p + 1;
  }
  ar = addText(ar, buf);
  at = padAt(at, ar, bufAt);
  ar = processEmphasis(ar, -1, at, starts, offs);
  if (ar.head < 0) {
    return {nodes: [], notes: ar.notes};
  }
  return {nodes: collect(ar, ar.head, ar.tail).nodes, notes: ar.notes};
}

function padAt(at, ar, p) {
  let a = at;
  while (a.length < ar.kind.length) {
    a.push(p);
  }
  return a;
}

function posOf(starts, offs, i) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (starts[mid] <= i) {
    lo = mid;
  }
  else {
    hi = mid - 1;
  }
  }
  if ((starts.length === 0)) {
    return i;
  }
  return offs[lo] + (i - starts[lo]);
}

function backtickRuns(s) {
  let pos = [];
  let len = [];
  let maxLen = 0;
  let i = 0;
  while (i < s.length) {
    if (_scrml_structural_eq(s[i], "`")) {
    let l = 1;
    while (i + l < s.length && _scrml_structural_eq(s[i + l], "`")) {
    l = l + 1;
  }
    pos.push(i);
    len.push(l);
    if (l > maxLen) {
    maxLen = l;
  }
    i = i + l;
    continue;
  }
    i = i + 1;
  }
  let byLen = [];
  let k = 0;
  while (k <= maxLen) {
    byLen.push([]);
    k = k + 1;
  }
  let r = 0;
  while (r < len.length) {
    byLen[len[r]].push(r);
    r = r + 1;
  }
  return {pos: pos, len: len, byLen: byLen};
}

function closerRun(runs, r, l) {
  if (l >= runs.byLen.length) {
    return -1;
  }
  const xs = runs.byLen[l];
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xs[mid] <= r) {
    lo = mid + 1;
  }
  else {
    hi = mid;
  }
  }
  return lo < xs.length ? xs[lo] : -1;
}

function messageFor(code) {
  for (const m of MESSAGES) {
    if (_scrml_structural_eq(m.code, code)) {
    return m.text;
  }
  }
  return code;
}

export function parse(src) {
  return parseSlots(src, []);
}

export function parseSlots(src, slots) {
  const clean = src.split("\u0000").join("�");
  let order = [];
  let k = 0;
  while (k < slots.length) {
    const o = slots[k].offset;
    if (o >= 0 && o < clean.length && _scrml_structural_eq(clean[o], SLOT_CHAR)) {
    order.push(k);
  }
    k = k + 1;
  }
  order.sort((a, b) => slots[a].offset - slots[b].offset);
  let offs = [];
  let srcs = [];
  let ids = [];
  for (const x of order) {
    offs.push(slots[x].offset);
    srcs.push(slots[x].source);
    ids.push(x);
  }
  const sl = {offs: offs, srcs: srcs, ids: ids};
  let lines = [];
  let lineStarts = [];
  let start = 0;
  let i = 0;
  while (i <= clean.length) {
    if (_scrml_structural_eq(i, clean.length) || _scrml_structural_eq(clean[i], "\n") || _scrml_structural_eq(clean[i], "\r")) {
    lines.push({text: clean.substring(start, i), offset: start});
    lineStarts.push(start);
    if (i < clean.length && _scrml_structural_eq(clean[i], "\r") && i + 1 < clean.length && _scrml_structural_eq(clean[i + 1], "\n")) {
    i = i + 1;
  }
    start = i + 1;
  }
    i = i + 1;
  }
  const r = parseBlocks(lines, 0, sl);
  let sorted = r.notes.slice();
  sorted.sort((a, b) => a.offset - b.offset);
  let diags = [];
  const seen = new Set();
  for (const x of sorted) {
    const key = x.code + "@" + String(x.offset);
    if (seen.has(key)) {
    continue;
  }
    seen.add(key);
    const ln = lineIndex(lineStarts, x.offset);
    diags.push({code: x.code, message: messageFor(x.code), offset: x.offset, line: ln + 1, col: x.offset - lineStarts[ln] + 1});
  }
  return {blocks: r.blocks, diags: diags};
}

function lineIndex(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (starts[mid] <= off) {
    lo = mid;
  }
  else {
    hi = mid - 1;
  }
  }
  return lo;
}

export function dedent(body) {
  const all = body.split("\n");
  if ((all.length === 1)) {
    return {text: body, indent: 0, dropFirst: false, mixed: false};
  }
  let dropFirst = false;
  let head = [];
  if (isBlank(all[0])) {
    dropFirst = true;
  }
  else {
    head = [all[0]];
  }
  let ls = all.slice(1);
  if (isBlank(ls[ls.length - 1])) {
    ls = ls.slice(0, ls.length - 1);
  }
  let counted = [];
  for (const l of ls) {
    if (!isBlank(l)) {
    counted.push(l);
  }
  }
  let min = -1;
  for (const l of counted) {
    let k = 0;
    while (k < l.length && isSpaceOrTab(l[k])) {
    k = k + 1;
  }
    if (min < 0 || k < min) {
    min = k;
  }
  }
  if (min < 0) {
    min = 0;
  }
  let mixed = false;
  if (counted.length > 0) {
    const prefix = counted[0].substring(0, min);
    for (const l of counted) {
    if (!_scrml_structural_eq(l.substring(0, min), prefix)) {
    mixed = true;
  }
  }
  }
  let out = [];
  for (const h of head) {
    out.push(h);
  }
  for (const l of ls) {
    if (isBlank(l)) {
    out.push("");
  }
  else {
    out.push(l.substring(min));
  }
  }
  return {text: out.join("\n"), indent: min, dropFirst: dropFirst, mixed: mixed};
}

function slugify(text) {
  let out = "";
  for (const c of text.toLowerCase()) {
    if (_scrml_structural_eq(c, " ") || _scrml_structural_eq(c, "-")) {
    out = out + "-";
  }
  else {
    if (/^[\p{L}\p{M}\p{N}\p{Pc}]$/u.test(c)) {
    out = out + c;
  }
  }
  }
  return _scrml_structural_eq(out, "") ? "section" : out;
}

export function headingSlugs(doc, taken) {
  const used = new Set(taken);
  const nextSuffix = new Map();
  let out = [];
  for (const t of headingTexts(doc.blocks)) {
    const base = slugify(t);
    let s = base;
    let k = nextSuffix.has(base) ? nextSuffix.get(base) : 1;
    while (used.has(s)) {
    s = base + "-" + String(k);
    k = k + 1;
  }
    if (!_scrml_structural_eq(s, base)) {
    nextSuffix.set(base, k);
  }
    used.add(s);
    out.push(s);
  }
  return out;
}

function headingTexts(blocks) {
  let out = [];
  for (const each of blocks) {
    const b = each;
    let _scrml_tilde_36 = null;
  const _scrml_match_37 = b;
  const _scrml_tag_38 = (_scrml_match_37 != null && typeof _scrml_match_37 === "object") ? _scrml_match_37.variant : _scrml_match_37;
  if (_scrml_tag_38 === "Heading") {
    const l = _scrml_match_37.data.level; const cs = _scrml_match_37.data.children;
    _scrml_tilde_36 = [ plainText ( cs ) ];
  }
  else if (_scrml_tag_38 === "Quote") {
    const bs = _scrml_match_37.data.children;
    _scrml_tilde_36 = headingTexts ( bs );
  }
  else if (_scrml_tag_38 === "List") {
    const o = _scrml_match_37.data.ordered; const s = _scrml_match_37.data.start; const t = _scrml_match_37.data.tight; const its = _scrml_match_37.data.items;
    _scrml_tilde_36 = itemHeadingTexts ( its );
  }
  else if (_scrml_tag_38 === "Paragraph") {
    const cs = _scrml_match_37.data.children;
    _scrml_tilde_36 = [ ];
  }
  else if (_scrml_tag_38 === "CodeBlock") {
    const l = _scrml_match_37.data.lang; const t = _scrml_match_37.data.text;
    _scrml_tilde_36 = [ ];
  }
  else if (_scrml_tag_38 === "Rule") {
    _scrml_tilde_36 = [ ];
  }
  else if (_scrml_tag_38 === "Table") {
    const a = _scrml_match_37.data.align; const h = _scrml_match_37.data.head; const rs = _scrml_match_37.data.rows;
    _scrml_tilde_36 = [ ];
  }
  const inner = _scrml_tilde_36;
    for (const t of inner) {
    out.push(t);
  }
  }
  return out;
}

function itemHeadingTexts(items) {
  let out = [];
  for (const it of items) {
    for (const t of headingTexts(it.children)) {
    out.push(t);
  }
  }
  return out;
}


// --- §45 Structural equality helper (inlined for server, no client runtime here) ---
function _scrml_structural_eq(a, b, seen) {
  if (a === b) return true;
  if (a == null || b == null) return false; // loose: null and undefined are both absence
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b; // NaN here: the dpa-037 comparison-family build
  // The value's class, read by BRAND (not instanceof) so a Date from another
  // realm (an iframe, a vm context) is still a Date. Values of two different
  // classes are never equal; this also keeps an array from equalling an
  // object with the same index keys.
  const tag = _scrml_g.Object.prototype.toString.call(a);
  if (tag !== _scrml_g.Object.prototype.toString.call(b)) return false;
  // SameValueZero, the NaN rule the S440 dpa-037 ruling gives == (NaN is a
  // defined value and == is reflexive). Used for the number-valued slots below.
  const sameNum = (x, y) => x === y || (x !== x && y !== y);
  // An ArrayBuffer / DataView is raw memory, so it compares BYTE for byte (byte
  // identity, not numeric equality: two NaN bit patterns can differ).
  const bytesEq = (bufA, offA, bufB, offB, len) => {
    const x = new _scrml_g.Uint8Array(bufA, offA, len);
    const y = new _scrml_g.Uint8Array(bufB, offB, len);
    for (let i = 0; i < len; i++) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  };
  // Built-in classes (S440 ruling #8: date/timestamp are VALUE types, == by
  // instant). They keep their value in internal slots, not own enumerable
  // keys, so the struct branch at the bottom would see two empty key sets and
  // call any two of them equal. Each gets its own rule.
  if (_scrml_g.ArrayBuffer.isView(a)) {
    if (a.byteLength !== b.byteLength) return false;
    if (tag === "[object DataView]") return bytesEq(a.buffer, a.byteOffset, b.buffer, b.byteOffset, a.byteLength);
    // A typed array compares element by element, as numbers.
    for (let i = 0; i < a.length; i++) {
      if (!sameNum(a[i], b[i])) return false;
    }
    return true;
  }
  // A brand can be spoofed (Symbol.toStringTag), so every value below is read
  // through the class's OWN brand-checking method or getter: a spoof throws a
  // TypeError instead of being compared by whatever fields it happens to carry.
  const read = (cls, key, x) => {
    if (typeof cls !== "function") throw new _scrml_g.TypeError("scrml ==: no " + key + " reader for this class here");
    // Walk up: a polyfill (happy-dom's URL) may subclass the native class.
    let p = cls.prototype;
    let d;
    while (p && !(d = _scrml_g.Object.getOwnPropertyDescriptor(p, key))) p = _scrml_g.Object.getPrototypeOf(p);
    return d.get ? d.get.call(x) : d.value.call(x);
  };
  switch (tag) {
    case "[object Date]":
      return sameNum(read(_scrml_g.Date, "getTime", a), read(_scrml_g.Date, "getTime", b));
    case "[object RegExp]":
      // source is brand-checked; flags (a generic getter) is only read once
      // source has proven both are RegExps.
      return read(_scrml_g.RegExp, "source", a) === read(_scrml_g.RegExp, "source", b) &&
        read(_scrml_g.RegExp, "flags", a) === read(_scrml_g.RegExp, "flags", b);
    case "[object ArrayBuffer]": {
      const len = read(_scrml_g.ArrayBuffer, "byteLength", a);
      return len === read(_scrml_g.ArrayBuffer, "byteLength", b) && bytesEq(a, 0, b, 0, len);
    }
    case "[object URL]":
      // URL's toString is brand-checked and returns the href.
      return read(typeof _scrml_g.URL !== "undefined" && _scrml_g.URL, "toString", a) === read(typeof _scrml_g.URL !== "undefined" && _scrml_g.URL, "toString", b);
    case "[object URLSearchParams]":
      return read(typeof _scrml_g.URLSearchParams !== "undefined" && _scrml_g.URLSearchParams, "toString", a) ===
        read(typeof _scrml_g.URLSearchParams !== "undefined" && _scrml_g.URLSearchParams, "toString", b);
    // No synchronously readable value: equal only when the same object, which
    // the a === b check above has already ruled out.
    case "[object Promise]":
    case "[object WeakMap]":
    case "[object WeakSet]":
    case "[object Blob]":
    case "[object File]":
      return false;
    case "[object Error]":
      // message is an own NON-enumerable key, so check it (and the name) here;
      // the struct branch below then compares the enumerable fields (type and
      // cause on the §19 error classes). Accepted cost of realm-safe matching:
      // an Error subclass that sets no name of its own == a base Error.
      if (a.name !== b.name || a.message !== b.message) return false;
      break;
  }
  // A polyfilled Blob (happy-dom, jsdom) carries no Blob brand; catch it by class.
  if (typeof _scrml_g.Blob !== "undefined" && (a instanceof _scrml_g.Blob || b instanceof _scrml_g.Blob)) return false;
  // §45.2 lists what == compares structurally: primitives, structs, enums,
  // maps (and, above, the built-in value classes; below, arrays and host
  // Map / Set). A struct, an enum value, and a §59 map are PLAIN records —
  // prototype null or a realm's Object.prototype (read realm-safely: that
  // prototype's own prototype is null). Any other object is not a scrml
  // value — a DOM node, an Event, a host-class instance — and compares by
  // IDENTITY, the lowering §45.2 gives asIs values; a === b above has
  // already ruled identity out. (Read by its own enumerable keys, two
  // same-tag DOM elements — no own keys — would be "equal".) Error keeps its
  // branch: the §19 error classes are values compared by name / message /
  // fields.
  if (tag !== "[object Error]" && tag !== "[object Map]" && tag !== "[object Set]" && !_scrml_g.Array.isArray(a)) {
    const pa = _scrml_g.Object.getPrototypeOf(a);
    const pb = _scrml_g.Object.getPrototypeOf(b);
    if ((pa !== null && _scrml_g.Object.getPrototypeOf(pa) !== null) || (pb !== null && _scrml_g.Object.getPrototypeOf(pb) !== null)) return false;
  }
  // Cycle guard: value-cycles are FORBIDDEN in scrml (§6.5.1 reassignment-
  // canonical), but a malformed JS-host value reaching == could still carry
  // one. Track visited (a, b) pairs so a revisit terminates instead of
  // stack-overflowing. seen maps each a-object to the WeakSet of b-objects
  // already compared against it. The standard structural-eq cycle convention
  // is assume-equal-on-revisit: the only way to reach a matching (a, b)
  // revisit is a structurally-matching cyclic shape.
  if (seen == null) seen = new _scrml_g.WeakMap();
  let seenBs = seen.get(a);
  if (seenBs == null) {
    seenBs = new _scrml_g.WeakSet();
    seen.set(a, seenBs);
  } else if (seenBs.has(b)) {
    return true;
  }
  seenBs.add(b);
  // JS Map / Set (host interop values; the §59 value-native map is a tagged
  // plain object with its own branch below). Equal when the entries pair up
  // ONE-TO-ONE. A primitive key/element can only pair with itself, found by
  // the collection's own SameValueZero lookup. An object key/element pairs
  // with a not-yet-used structurally-equal one. A Map value compares
  // structurally, with the NaN rule. Trial comparisons pass a FRESH cycle
  // guard: a failed trial must not leave its pair in seen, where a later
  // revisit would read it as equal.
  if (tag === "[object Map]" || tag === "[object Set]") {
    if (a.size !== b.size) return false;
    const isMap = tag === "[object Map]";
    const valEq = (x, y, s) => sameNum(x, y) || _scrml_structural_eq(x, y, s);
    const bObjects = [];
    for (const entry of b) {
      const key = isMap ? entry[0] : entry;
      if (key !== null && typeof key === "object") bObjects.push(entry);
    }
    const used = new _scrml_g.Array(bObjects.length).fill(false);
    for (const entry of a) {
      const key = isMap ? entry[0] : entry;
      if (key === null || typeof key !== "object") {
        if (!b.has(key)) return false;
        if (isMap && !valEq(entry[1], b.get(key), seen)) return false;
        continue;
      }
      let found = -1;
      for (let i = 0; i < bObjects.length && found < 0; i++) {
        if (used[i]) continue;
        const bEntry = bObjects[i];
        if (isMap
          ? _scrml_structural_eq(key, bEntry[0]) && valEq(entry[1], bEntry[1])
          : _scrml_structural_eq(key, bEntry)) found = i;
      }
      if (found < 0) return false;
      used[found] = true;
    }
    return true;
  }
  // Array comparison (for tuple-like fields)
  if (_scrml_g.Array.isArray(a)) {
    if (!_scrml_g.Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!_scrml_structural_eq(a[i], b[i], seen)) return false;
    }
    return true;
  }
  // §59 Value-native map: order-INDEPENDENT structural equality (§59.9). Two
  // maps are equal iff they have the same canonical-key set with structurally-
  // equal values, regardless of insertion / iteration order. This holds EVEN
  // for @ordered maps — == ignores order (the `order` sidecar is NOT compared);
  // @ordered governs iteration, not equality. Gate on the __scrml_map tag FIRST
  // so non-map values fall through to the array / enum / struct branches with
  // their existing behavior unchanged.
  if (a.__scrml_map === true || b.__scrml_map === true) {
    if (a.__scrml_map !== true || b.__scrml_map !== true) return false;
    var aEntries = a.entries;
    var bEntries = b.entries;
    var aMapKeys = _scrml_g.Object.keys(aEntries);
    var bMapKeys = _scrml_g.Object.keys(bEntries);
    if (aMapKeys.length !== bMapKeys.length) return false;
    for (var mk = 0; mk < aMapKeys.length; mk++) {
      var ckey = aMapKeys[mk];
      // Same canonical-key set (canonical strings are collision-free for
      // distinct values, §59.5 — so key-string presence IS key-identity).
      if (!_scrml_g.Object.prototype.hasOwnProperty.call(bEntries, ckey)) return false;
      if (!_scrml_structural_eq(aEntries[ckey].v, bEntries[ckey].v, seen)) return false;
    }
    return true;
  }
  // Enum: compare tag + payload
  if (a._tag != null && b._tag != null) {
    if (a._tag !== b._tag) return false;
    // Unit variant (no payload beyond _tag)
    const aKeys = _scrml_g.Object.keys(a);
    const bKeys = _scrml_g.Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (key === "_tag") continue;
      if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
    }
    return true;
  }
  // Struct: field-by-field comparison
  const aKeys = _scrml_g.Object.keys(a);
  const bKeys = _scrml_g.Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!_scrml_g.Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!_scrml_structural_eq(a[key], b[key], seen)) return false;
  }
  return true;
}
