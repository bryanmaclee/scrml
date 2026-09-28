# progress — s439-bootstrap-m3-tables

- startup: worktree verified, base == origin/main 9b2fd2cbd (typer #1117 present: `THE TYPER` hits analyze.scrml:23/152/3051). ingest.scrml / slice-m3 NOT on main at start (no footprint grade yet).
- BASE DIFFERENTIAL built before any edit (scratchpad m3-tables/diff.js; base = a copy of compiler/self-host-v2 at 9b2fd2cbd).
  459 programs: 6 slice programs + fixtures, 6 slice-m1 sources, 9 §66.19 blocks (from SPEC.md), the typer reviewers'
  r3 probe sets (spec/ 26 + spec3/ 9 + linked 66.19.3 + p3/p3a/p3c/p3d/p3e + probesB + p3f + p3g + probesA), and 228
  programs captured from every slice-m2 test's frontEnd call. Compared per program: FULL diag list (code+message+file+span,
  in order), Core (strict JSON, no Sym renumbering allowance), ASTs, every non-fact Tables field, exprType(nid) for every nid.
  base-vs-base: 459 programs, 241 with diagnostics, CHANGED 0. Bite proof: a one-word message edit → CHANGED 5.
- BASELINE: lines analyze 4491 / lower 996 / check 509. Suites (3 runs): slice-m1 1.42/1.52/1.50 s (73 pass);
  slice-m1 SLICE_CORE=lowered 4.07/4.20/4.41 s (73 pass); slice-m2 4.77/4.66/4.82 s (221 pass). Front end over all 459
  differential programs: ~250-270 ms total (the suites' wall is dominated by impl#1 compiling the bundle, not factOf).
- PRE-EDIT PROBES: (1) multi-fact nodes at base — 0 of 17,761 facts over the 459 programs share a NodeId (so a family
  split cannot change which fact a lookup finds); audit agrees: every speculative resolution in the binder is discarded
  (resolveAssign / placeMember re-resolve from st0). (2) impl#1: `match` over a narrowed `T | not` still demands a `not`
  arm (E-MATCH-012), and a `not :>` arm compiles and is NOT flagged by lint-no-default-arm (lexed as a keyword, not a
  binder) — so lookups return `Family | not` and every consumer match is total over its family + `not`.
- UNIT 1 (analyze + lower + slice-m2/tables.test.js): Fact (22 variants incl. FNone) → six family side-tables, chosen by
  WHICH CONSUMER ASKS:
    names   NameFact  {NLocal, NField, NInst, NStruct, NFn, NLength} — Name/At/AtItem/Member/callee nodes; asked by
            lower readName/memberExpr/callExpr and the typer's nameType/calleeFn. `.length` moved here from FOp: it is
            resolved on a MEMBER node and asked by the member consumer (memberExpr / typeMember), never by the operator one.
    values  ValueFact {VLit, VVariant, VOp, VStructOf} — literal/Variant/Unary/Binary/ObjectLit nodes; lower valueExpr/opOf,
            typer valueType/opOf (litFact/variantFact/structExpr collapse into one total valueExpr).
    effects EffectFact {EWrite, ESpread, EReset, EAssignLocal} — statement-position Assign/Call nodes; lower exprStmt,
            typer typeAssign/typeCallStmt (effectWrites/isReset/assignedLocal).
    binds   BindFact  {BBind, BParam, BGiven} — Local/Given stmts, fn items, params; lower letStmt/givenStmts/paramOf,
            typer typeLocal/typeGiven/typeFn.
    elems   ElemFact  {MHtml, MUse, MEach, MSlot} — elements; lower lowerElem, typer typeElem/typeEach.
    attrs   AttrKind (the existing enum, no wrapper) — attributes; lower attrKind, typer typeUse.
  Each family = { facts, at } with `at[nid]` = position (O(1) slotOf). One fact per node is kept by construction: the
  first fact CLAIMS the node across all six indexes (a later one is listed but never indexed = the old first-match scan).
  Typing gained `at` (typingOf, first entry per node = the old exprType scan). Tables stays ONE record (six family
  fields replace `facts`); lookups take the family table they read (`nameFact(t.names, nid)`).
  Differential: 459 programs CHANGED 0 — ASTs, Core (strict JSON), full diag lists, typing.exprs, exprType(nid) for
  every nid, and a per-node FACT PROJECTION (base first-fact vs new family lookups, 17,761 facts, no node answered by two
  families). Suites green: slice-m1 73/73, slice-m1 lowered 73/73, slice-m2 221/221 + tables.test 33/33; lint 0.
  Lines: analyze 4491 → 4542 (+51 net: the index, six table types, lookups and adders are new here; the typer's 22-arm accessors shrank to family-sized ones);
  lower 996 → 747 (−249); check 509 → 509 (reads Core only — no fact accessor). Total −198.
- UNIT 2 (slice-m1/bench/mutations.js): no existing site moved (every analyze/lower `from` text kept verbatim). +4 M3-tables
  mutations judged by tables.test.js (index update inserts, index pads one short, a `given` recorded in the names family,
  exprType's index one entry off). Harness: 70 mutations, 0 problems, all RED, unmutated mirror suite exit 0 — exit 0.
  (A "later fact re-points a claimed node" mutation was NOT added: the binder records no second fact for any node, so
  first-vs-last is unobservable and such a mutation cannot bite; likewise first-vs-last in typingOf — 0 duplicate typing
  entries in the slice programs.) Gate: unit+integration+conformance 25693 pass / 0 fail / 70 skip.
