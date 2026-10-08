# progress — s458-declared-props-d1

## 2026-10-07 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae6f33d76a517d33c`, branch `worktree-agent-ae6f33d76a517d33c`, base `46ed1f8ff` == origin/main.
- Read: DD `declared-props-reach-root-2026-10-07.md` (full), gap `g-declared-prop-reaches-expanded-root-s457` (on `land/s457-rename-handler`, not on main), SPEC §15.1–§15.10.1, §66.6, §66.14, §66.15.

### Governing sentences (quoted)
- §66.14 rule 4: "**Use-site attributes are CONSTRUCTION** — always allowed, from any file".
- §66.6.1: "A plain markup use `<x …/>` … is a **NEW INSTANCE** everywhere. Its attributes are that instance's values (construction, §66.14)".
- §15.10 (current E-COMPONENT-012 sentence): "the same prop name SHALL NOT appear in both the `props` block and as a bare attribute on the root element (E-COMPONENT-012: duplicate prop declaration)."
- §15.5: "Adding `id=` at a call site is allowed." vs §15.10: "Extra props provided at the call site that are not declared in the `props` block SHALL be a compile error (E-COMPONENT-011)."
- §66.6.7 O18 (OPEN): "whether `class=` / `style=` / `key=` on a plain use are markup attributes or construction (§66.14), is not ruled."

### Base probe (`.tmp/probe/four.scrml`, base 46ed1f8ff)
Every position leaks: top `title="Top" … id="c-top"` + bool disabled binding; lit adds `href="/lit"`;
`<each>` `setAttribute("title"|"href"|"disabled"|"id")`; `lift` the same; match arm `title="Arm" … id="c-arm"`.

## 2026-10-07 — step 1: the change (code + tests + SPEC + conformance, one commit)
- Locus hypothesis (emit-html `isDeclaredPropAttr` + emit-each + emit-lift) REFINED: the leak is created at ONE
  place, the CE merge in `expandComponentNode` (component-expander.ts, "caller wins" merge of every caller attr onto
  the root). Every expansion path (top-level walk, `<each>` bodies, `lift` targets, bare markup in logic, match/engine
  arms re-parsed later still came through CE) calls `expandComponentNode` (5 call sites, 1 function; the only
  `_expandedFrom:` writers are its primary + secondary-root returns). Declared caller props now leave `attrs` there
  (kept on `_callSiteProps` for TS only), so no emitter can see them — agreement by construction, not per-emitter.
- emit-html `isDeclaredPropAttr`: with the stamp present it now returns false (a declared-prop-named attr left on the
  root is the body's own write). Without it this dropped `href=${href}` written at the root.
- type-system: visits `_callSiteProps` exactly as `attrs` (E-SCOPE-001 on a caller value still fires — measured
  `disabled=false` on base); E-ERROR-002 call-site span lookup reads `_callSiteProps`.
- E-COMPONENT-012 narrowed to a valueless root attribute.
- Explicit-write miscompiles fixed (CE `registerAttrTextPropMaps`): (1) `href=${href}` / inner `<a href=${href}>` with
  an `${expr}` caller left `href` unbound (`const _scrml_v = (href)`); (2) quoted `href="/p/${href}"` with an `${expr}`
  caller left `${href}` unbound. Same root cause: expression-valued callers were absent from the string prop map.
  The quoted fix also closes g-component-prop-in-quoted-attr-substitutes-source-text-s456 (`/p/@u`, `/p/r.url`): a
  reactive value now stays a `${…}` interpolation instead of being spliced as source text.
- Tests: unit E-012 pins moved to the bare form + 4 valued-root-attr negatives; trucking baseline +3 E-DG-002
  (honest: the junk root write was the cells' only consumer; the each-in-lifted-component drop is the open gap);
  conformance dup-reject moved to bare form; 2 new cases (declared-prop-not-root-attr, declared-prop-explicit-root-write).
- Gate: unit+integration+conformance 29907 pass / 0 fail.
