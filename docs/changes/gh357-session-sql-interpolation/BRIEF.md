> # ⚠ REVISE BEFORE DISPATCH — dpa-021 RATIFIED S319
>
> **Direction B stands; the stated FORM does not, and this brief is missing a BLOCKER.**
>
> 1. **One raw prologue binding CANNOT serve both accessor forms.** `session` is an object whose
>    `.get()` reads an *inner* record, so a naive bind converts a method call into a raw property read at
>    the wrong level — and with a request-controlled key that discloses the live session id and the full
>    record **including `csrfToken`** at HTTP 200. The hazard is a **confidentiality break**, not
>    `semantics-changed`. Use a **Proxy** binding.
> 2. **BLOCKER absent from this brief:** `_anySessionBuiltin` matches AST `member`/`index` nodes, but a
>    `?{}` carries its query as a **string** — an interpolation-only `session` use is structurally
>    invisible, so a binding gated on today's detection **would never be emitted and #357 would stay
>    open**. Fix precedent in the same file: `astSqlQueryUsesCurrentUser`.
> 3. **KEEP the AST lowering.** Three security gates match the literal string `_scrml_req._scrml_sess.`;
>    retiring it for a bare binding silently blinds all three.
> 4. **B needs FOUR parts, not one.** Corrections: the hazard is BOTH forms (`session.<customKey>` too);
>    corpus is 7 files / 2 real uses; the path is `compiler/src/codegen/rewrite.ts`.
>
> **Adjacent HIGH, NOT fixed by B — do not conflate:** `g-session-ambient-unlowered-trust-boundary-inversion`.

---

# BRIEF — GH #357: bind `session` in the server handler prologue (direction B)

change-id: `gh357-session-sql-interpolation`
authored: 2026-08-03 (S316-bryan) · agent: `scrml-js-codegen-engineer` (iso worktree, opus, bg)
gap: `g-session-not-rewritten-inside-sql-interpolation` (HIGH, `docs/known-gaps.md:200`)
adopter: **dc** (third adopter; handle only — do NOT write their app or org name into any commit,
comment, test name, or artifact; pa-base §1 third-party identity)
DONE-PROBE: bun test compiler/tests/integration/gh357-session-sql-interpolation.test.js
probe-intent: green — asserts the emitted `.server.js` binds `session` and that an authenticated
request through the real handler returns 200 instead of throwing `ReferenceError`.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full before anything else; follow its §"Task-Shape Routing"
for a compiler-source codegen task.

**Map currency:** maps reflect HEAD `e80b692e` (refreshed S314). HEAD is `09d17541` — 14 commits
later, **4 of them codegen** (`a0f2f18b` #385, `7b5c02a2` #386, `b6c8b97f` #387, `09d17541` #388, all
in the `export const` / emit-client / serve=tool area). The other 10 are spec/scoping/docs/CI. Treat
map content as a verify-against-source hypothesis if a named file looks moved.

Report: `Maps consulted: [list]; load-bearing finding: <one sentence>` OR `Maps consulted but not
load-bearing.`

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: `<ABSOLUTE-WORKTREE-PATH>` (echo your real `pwd` and use THAT).

## Startup verification (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any other repo, STOP and report (the S90 CWD-routing failure). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git status --short` — clean.
4. `bun install` (worktrees do NOT inherit `node_modules`; the hook fails "cannot find package
   'acorn'" otherwise).
5. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`).

If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **Edit via Edit/Write on WORKTREE-ABSOLUTE paths.** ⚑ Do NOT follow older briefs in
  `docs/changes/` that mandate "edit via Bash on worktree-absolute paths" — that S126 mitigation is
  **RETIRED** (S314): the isolation guard now refuses Bash heredocs/redirects, and the
  `path-discipline.sh` PreToolUse hook that actually protects you covers Edit/Write.
- NEVER a bare relative path (resolves against the main checkout). NEVER a main-rooted absolute path.
- NEVER `cd` into the main repo — use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
- FIRST commit message includes your verbatim startup `pwd`: `WIP(gh357-session): start at <pwd>`.

# CRASH RECOVERY
Commit after EVERY meaningful edit (WIP commits expected). Keep an append-only timestamped
`progress.md` under `docs/changes/gh357-session-sql-interpolation/`. Clean `git status` before you
report DONE — "work is in the worktree, uncommitted" is not an acceptable terminal report.

---

# THE BUG — reproduced BY EXECUTION on `09d17541`, not by reading

`session.*` inside a `?{}` SQL interpolation survives into `.server.js` as a **bare, unbound
identifier**. The handler closes over a free variable → `ReferenceError` → **HTTP 500 on every
authenticated call**.

## Reproducer

```scrml
<program db="./test.db">
    ${
        server function loadMe() {
            if (!session.isAuth) {                                                    // ORDINARY
                return not
            }
            const rows = ?{ select id, email from users where id = ${session.userId} }  // INTERPOLATED
            return rows[0]
        }
        loadMe()
    }
    <p>me</>
</>
```

Emitted `.server.js` today:

```
168:    if (!_scrml_req._scrml_sess.isAuth) {                                  ✅ rewritten
171:    const rows = await _scrml_sql`select id, email from users where id = ${session.userId}`;   ❌ BARE
```

## Executing it (use this harness — it is fiddly and you will otherwise get a false PASS)

`node --check` PASSES on the broken file — a free variable is legal JS. Grepping the emit is not
proof either. **Execute it.** Two traps I hit:

- The route is wrapped by `_scrml_session_cookie_wrap`, which **re-derives** `_scrml_sess` from the
  request cookies. Setting `req._scrml_sess` directly is silently overwritten and you get `200`/`null`
  from the `isAuth` early-return, never reaching the SQL line.
- You must seed the session store **before importing** the module (it does
  `globalThis.__scrml_session_store ??= new Map()`).

```js
const SID = "sid-abc";
globalThis.__scrml_session_store = new Map([[SID, { userId: 1, role: "user" }]]);
const mod = await import("./<name>.server.js");
const TOK = "tok123";
const req = new Request("http://localhost/_scrml/__ri_route_loadMe_1", {
  method: "POST",
  headers: { "Cookie": `scrml_csrf=${TOK}; __Host-scrml_sid=${SID}`,
             "X-CSRF-Token": TOK, "Content-Type": "application/json" },
  body: "{}",
});
try { const res = await mod.routes[0].handler(req);
      console.log("status:", res.status, await res.text()); }
catch (e) { console.log("THROWN:", e.constructor.name + ":", e.message); }
```

Seed the sqlite db first (`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).
**Before your fix this prints `THROWN: ReferenceError: session is not defined`. After it, `status: 200`.**

# ROOT CAUSE — TRACED (not a hypothesis; verify anyway and say so)

1. `?{}` interpolations are captured as **raw text**: `params.push(interp.expr)`
   (`compiler/src/codegen/rewrite.ts:387`), carried as `string[]` into `buildTaggedTemplate`.
2. The server rewrite applied to those strings is `rewriteServerReactiveRefs`, whose regex arm
   `rewriteServerAtRef` (`rewrite.ts:2831`) matches **only `@name`**.
3. `session` is **sigil-less** → structurally invisible to that pass.
4. `session.*` → `_scrml_req._scrml_sess.*` lowering lives ONLY in the AST emitter
   (`emit-expr.ts:2278` member, `:2419` index), which interpolation text never reaches.
5. Unlike `route` — also sigil-less, but genuinely **bound** in the handler prologue as
   `const route = { query: … }` — `session` has **no emitted binding**, so the survivor is free.

⚠️ **The gap entry's recorded locus is WRONG** (`rewrite.ts:436` `rewriteSqlRefs`, "walks expression
nodes but not the interpolation children"). There are no expression children at that layer — they are
strings by construction. Correct the `locus=` field on the `@gap` marker as part of this change.

## Measured blast radius — `session` is the ONLY affected ambient

One probe, four interpolated ambients in one `?{}`-bearing server fn:

| interpolated | emitted | status |
|---|---|---|
| `@currentUser.id` | `_scrml_currentUser.id` | ✅ sigil-bearing, special-cased at `rewrite.ts:2834` |
| `@uid` | `_scrml_body["uid"]` | ✅ sigil-bearing |
| `route.query.id` | `route.query.id` | ✅ sigil-less but BOUND in the prologue |
| **`session.userId`** | **`session.userId`** | ❌ sigil-less and UNBOUND |

# THE FIX — direction B (bryan-RULED, S316)

**Emit a handler-scoped `session` binding in the server prologue, mirroring `route`.** Do not add a
fourth `session` lowering site; make the bare identifier resolve so nothing needs rewriting — in SQL
interpolations or anywhere else. Kill the class by construction.

`provenance: ruling:user-voice-scrml.md S316 — "B , auth"`, on a PA recommendation that named B the
limit-primitives answer with `route` as the in-prologue precedent.

## The load-bearing constraint — do NOT flatten the accessor

`session` is not a plain object today. Per `emit-expr.ts`:
- `session.<name>` → `_scrml_req._scrml_sess.<name>` (`:2278`)
- `session[<expr>]` → `_scrml_req._scrml_sess.get(<expr>)` (`:2280`, `:2421`)

A naive `const session = _scrml_req._scrml_sess;` makes `session[expr]` a **raw property read**,
silently changing behaviour for the dynamic-key form. That is a `semantics-changed` regression in
pa-base §8's silent class — the exact thing this project has shipped before and caught only by
executing.

So the binding MUST preserve the index form's `.get()` semantics. Establish first whether
`_scrml_sess` already satisfies both shapes (does it define `.get()` AND expose the standard keys as
properties?). Read `_scrml_session_middleware` / the `_scrml_sess` object shape in the emitted
prologue before choosing. If it does, a direct binding is sound and the AST lowering can stay or be
simplified — **your call, but prove it, and say which you did and why in the commit body.**
If it does not, keep the AST index lowering intact and bind only for the identifier-resolution case.

**Decide whether the existing AST lowering stays.** Both mechanisms coexisting is acceptable if you
show they agree; two mechanisms that disagree is how this bug class started. State your choice.

# CORPUS + DIRECTION OF CHANGE

**Direction: `semantics-changed`** if the accessor shape moves; **`newly-accepting` toward the
contract** for the interpolated case (§20.5:15427 already says `session` SHALL be available inside
server-escalated function bodies — it is the implementation that failed to bind it, so making it work
restores conformance rather than widening; quote that sentence in your commit body).

**Corpus, measured — do not assume:** exactly ONE `.scrml` source in the repo uses `session.` at all
(`samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-server-003.scrml:5`, the
ordinary position). **ZERO** use it inside a `?{}` interpolation. That is why 28k tests never caught
this — corpus-is-artifact, not evidence of design intent. Re-measure yourself and report the counts;
assumed-zero is not measured-zero.

# VERIFICATION — all five, in order

1. **The execution harness above** — `ReferenceError` before, `status: 200` after. Paste both.
2. **The blast-radius probe** — re-run the four-ambient file; `@currentUser`, `@uid` and `route` must
   emit exactly as they do today. Paste the four emitted lines.
3. **The ordinary position must not regress** — `if (!session.isAuth)` still lowers to
   `_scrml_req._scrml_sess.isAuth`, and `session[expr]` still reaches `.get()`. Both need a test.
4. **Full gated subset:** `bun test compiler/tests/{unit,integration,conformance}` — 0 failures.
5. **R26 empirical (MANDATORY — HIGH):** recompile
   `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` + `examples/` on the post-fix baseline
   via `bun --cwd "$WORKTREE_ROOT" "$WORKTREE_ROOT/compiler/bin/scrml.js" compile <src> --output-dir <tmp>`
   and diff the emitted `.server.js` set against the same sweep on `main`. Symptom check is **the
   artifact diff**, NOT "tests pass". **Do not mark DONE without it**, and paste the counts.

Add the DONE-PROBE test at `compiler/tests/integration/gh357-session-sql-interpolation.test.js`
covering: interpolated position resolves · ordinary position unchanged · index form keeps `.get()` ·
the executed-handler 200.

# REPORT BACK

- Whether the traced root cause **held / was refined / was wrong**.
- Your decision on the accessor shape + whether the AST lowering stays, with the evidence.
- The execution harness output, before and after.
- The blast-radius four lines + the corpus counts you measured.
- R26 artifact diff. Files touched + final SHA + clean `git status`.
- Anything this brief got wrong — it is a hypothesis too.

# DO NOT

- Do not write the adopter's app, org, or personal name anywhere. The handle is **dc**.
- Do not add a `session` case to `rewriteServerAtRef` — that is direction A, explicitly not ruled.
- Do not "fix" `route` — it works; it is the precedent, not a target.
- Do not run `git push`, open a PR, or touch `main`. The PA lands this after an independent
  adversarial pass.
