# BRIEF — s462-md-phase1 (archived verbatim at dispatch time)

You are a dispatched dev agent on the scrml repo. PA session S462. You are building phase 1 of the new `<md>` element: the SPEC section, plus the `scrml:md` parser module written in scrml. Phase 2, the impl#1 compile-time hook that lowers static `<md>`, and phase 3, `<md of=…/>`, come later. Do NOT build them here.

READ FIRST, in full:
- the deep-dive /home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/md-element-2026-10-11.md;
- the five S462 rulings at the end of /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md: Q21 "I like a.", and `<md>` F1 "a", F2 "yes a.", F3 "a works. one way to do it with lints to guide", F4 "a". They are NORMATIVE. Quote them in your SPEC provenance;
- the relevant SPEC sections (find them via compiler/SPEC-INDEX.md): §4.15, §4.17, §4.18.1a, §5.2 (URL guard rule 3), §7.4.2, §26.6 (`prose`), OQ-6 (~SPEC.md:45448), §34;
- existing stdlib modules written in scrml (stdlib/*), to match their idiom, and how a stdlib module gets a JS shim and a parity test (compiler/runtime/stdlib, plus the shim parity test from #1394/#1399).

FIRST:
1. `git fetch origin && git merge origin/main`.
2. Archive this prompt verbatim to docs/changes/s462-md-phase1/BRIEF.md, then commit it with a progress.md.

Commit rules:
- Commit incrementally.
- Code and its tests go in one commit.
- Never use --no-verify and never disable hooks.
- Before each commit, wait until free memory is above 6GB and the load average is below 15.
- Commit in the foreground with timeout 600000.

PHASE 1 DELIVERABLES:

A) SPEC. Write a new section for `<md>` (pick the number to fit SPEC structure and register it in SPEC-INDEX). It must specify:
- static `<md>` body semantics: the fourth body-reading mode next to free-text, code-default and raw. The dedent rule strips the minimum indentation of the body lines, counting the closer's line.
- the dialect, exactly per F3: CommonMark core + GFM tables + strikethrough. IN: paragraphs, ATX headings, em/strong, inline code, fenced code, inline links/images, lists, blockquote, `---`, tables, `~~del~~`. OUT: raw HTML (shown as text, per Q21), indented code, setext headings, reference links, entity references, angle autolinks, footnotes, task lists. One way to write each construct. Each dropped construct gets a `W-MD-*` lint that names the canonical form; define the codes in §34.
- `${…}` inside `<md>` is TEXT-ONLY per F1: it never creates structure. Specify where interpolation is allowed: inline text, link text, and whether a link URL may interpolate (it must then pass the §5.2 guard at runtime).
- the output model: a CLOSED set of elements with fixed attribute sets. Content reaches the DOM only as text nodes or those attributes, never as HTML parsed from a string. URLs go through §5.2 rule 3. Heading ids: auto slugs for static `<md>`, none for data-sourced md.
- `<md of=@x/>` per F2: specify its semantics now, marked "build phase 3", with the same element set, the same guard, and no heading ids.
- styling: the output is plain elements that §26.6 `prose` and component-scoped `#{}` style. Resolve or annotate OQ-6 accordingly.
- F4: the single-reader architecture. The `scrml:md` module is the only md reader; impl#1 calls it at compile time, and `of=` ships it.
- provenance on every new normative statement, citing the rulings.

B) `stdlib/md/index.scrml`, the parser, written in idiomatic scrml (self-host ethos; not a mechanical port of a JS library):
- Input: a string. Output: a structured node tree (a closed enum/struct, e.g. `MdNode` variants for each element) plus a list of W-MD-* diagnostics with positions. It does NOT produce HTML strings.
- Implement the dialect exactly. Test the dropped constructs: each produces text plus its lint.
- Interpolation is out of scope for the parser's string input; phase 2 handles it by giving the compiler text-only slots. Design the node tree so text slots are representable, and note the design in progress.md.
- Write tests in the stdlib test style, covering every construct, every dropped construct, nesting, edge cases (emphasis rules within the subset, tables, fences with info strings), and hostile input (deep nesting limits, huge input, and sequences that look like HTML or entities). They must be safe and bounded.
- A JS shim plus parity, IF the stdlib build requires one to make the module importable now. Follow the existing pattern, including the async-parity and enum-shape parity tests.

C) Conformance cases for the parser module if the harness supports stdlib-level cases. Otherwise use unit tests.

Do NOT touch the compiler's `<md>` element handling (phase 2).

GATES (all):
- pre-commit
- tracking tiers (after pretest)
- `s34-census --check-new`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check
- snippet-gate and corpus-compile-floor
- the stdlib shim parity test

Resolve generated-doc conflicts by hunk and regenerate. Restore master-list.md from origin/main. Write only inside your worktree.

REPORT:
- WORKTREE_PATH, FINAL_SHA, BRANCH;
- the SPEC section number, plus a summary of every normative decision you had to make that the rulings did not cover (list each as a candidate question for bryan, with your recommendation);
- the parser design: node types, diagnostics, limits;
- the test count and the gates table.
Do NOT push.
