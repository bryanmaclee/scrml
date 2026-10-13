FIX ROUND 1 — S239 adversarial review of your 4ab3a5a5f: verdict FIX. Continue on branch `s464-quoted-handler-refused` in your worktree; `git merge origin/main` first. Archive this message as `docs/changes/s464-quoted-handler-refused/BRIEF-fix-round-1.md` in your first commit. Same rules as before (path discipline, commit per change, prove each new test fails without the fix, measure corpus, push, no PR). Reviewer scratch (read-only for you): `/home/bryan-maclee/.cache/scrml-review-quoted-handler/` (`c*/` probe sources, `bs/pw.mjs` Chromium click test, `bs/run.mjs` bootstrap harness, `bs/sweep.mjs` corpus sweep).

0. The owner RULED the name: **E-ATTR-QUOTED-HANDLER** (S464). Remove every "provisional / owner's call" marker for it from SPEC §5.2 and §34 and the code comments.

1. F1 HIGH (PA-REPRODUCED by compile; reviewer confirmed in Chromium — the click ran `pwn()`): a quoted handler in an `<each>` row INSIDE a `<match>` arm is not refused. Repro:
```
<program>
${ type Phase:enum = { Idle, Ready } }
<phase>: Phase = .Idle
<items> = [{ name: "a" }]
<match for=Phase on=@phase>
  <Idle>
    <ul><each in=@items as it><li><button onclick="pwn()">b</button></li></each></ul>
  </>
  <Ready><p>r</p></>
</match>
</program>
```
→ compiles clean, client JS has `setAttribute("onclick", "pwn()")`. Also gets through: `ONCLICK`/`onmouseover`/`onfocus` there; an `if=`/`else` pair in the row; `<each …><Btn onclick="pwn()"/></each>` with `const Btn = <button>b</button>`. Reviewer's cause: codegen re-parses the match arm from a copy, so VP-3 never sees that each row; the CG backstop for each rows (`compiler/src/codegen/emit-each.ts` ~2783, PA-located-verify) only asks `classifyInterpolatedAttrSink`. Fix at the ROOT, not this one position: every codegen site that WRITES an attribute from markup (setAttribute / attribute string emit) must refuse a quoted static `on…` handler with the same predicate (`isQuotedStaticHandler`) — i.e. a CG backstop that makes the emit path fail closed regardless of which validator saw the node. Then enumerate: grep every emitted `setAttribute(` / attribute-text writer and confirm each is covered; add each-in-match-arm (+ each-in-engine-arm, nested each in match) to the §2 position table in `s464-quoted-handler-refused.test.js`, and an executed check that no emitted client/server/HTML artifact in the test corpus contains a static `on…=` attribute.

2. F2 LOW (introduced): `const Inner = <button>in</button>` · `const Outer = <div class="o"><Inner onclick="pwn()"/></div>` · `<Outer/>` ×2 → two errors anchored at the `<Outer/>` call sites with a wrong "caller's prop value is substituted" message; the text to fix is in Outer's definition. Report once, at the definition (as the `${…}` sibling does).

3. F3 MED latent: quoted handlers in snippet-lambda markup (`row={ (item) => <span onclick="pwn()">…</span> }`, cf. samples/compilation-tests/snippet-002-parametric.scrml) are never judged; today nothing reaches output only because impl#1 drops the lambda. Make the check judge markup held in attribute lambdas / snippet values too (fail closed), so it stays closed when snippet lowering is fixed. File the snippet-lowering breakage (`row` undefined at runtime) as a gap if not filed.

Do NOT touch (owner questions, out of scope): static `srcdoc="…"` handlers and static `href="javascript:…"` — the PA is taking those to the owner.

Report: per-finding verdict + reproducing command, the attribute-writer enumeration (each site + covered how), corpus counts, final SHA.
