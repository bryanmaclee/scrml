# s468-identity-arg-refusal — progress (append-only)

- 2026-10-17T23:30Z — start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a459ac2a2574845f2.
  Startup verified (worktree root, clean, merge-base == origin/main bbddfd7b9). `bun install` (puppeteer
  postinstall exits 1 — chromium download; not used by the unit/integration/conformance gate), `bun run pretest` OK.
- BASE: branch `s468-identity-arg-refusal` is cut from `origin/s468-cps-unbound-cluster` (d48cf9d56, PR #1442,
  not yet on main), NOT origin/main. Reason: the design reuses #1442's `free-name.ts` raw-text `@session` /
  `@currentUser` recognition (a template interpolation `${@session.userId}` in an argument is otherwise invisible
  to the identity follower) and its carried-local resolver shape (function-own provenance + mutating writes via
  `localsWrittenBy`). Land #1442 first.
- BRIEF.md = COMMON.md + BRIEF-identity-arg-refusal.md, verbatim.
- Baseline gate (pre-commit hook on the first commit, bd3e9e0d0 = #1442 head + docs): 37123 pass / 125 skip /
  13 todo / 0 fail, 1589 files, 1539 s.

## Reproducer (EXECUTED, origin/main bbddfd7b9)

`~/.cache/scrml-agent-tmp/s468-identity-arg-refusal/repro/r1.scrml` (scrml 0.8.0):

    <program db="./app.db" auth="required">
      function add(name: string, uid: string) {
        ?{`INSERT INTO posts (author, body) VALUES (${uid}, ${name})`}.run()
      }
      <button id="go" onclick=add("hi", @session.userId)>add</button>
    </program>

`bun repro/forge.mjs <compiler-root> r1.scrml <work>` compiles it, then POSTs to the `add` route with the
ATTACKER's session cookie (`userId: "attacker"`) and body `{name: "hi", uid: "victim"}`.
- base (origin/main bbddfd7b9): `COMPILE: ACCEPTED (exit 0)`; `status 200; rows = [{"author":"victim","body":"hi"}]`.
  The client emits `_scrml_fetch_add_3("hi", session.userId)` — the browser's projection value, sent in the body.
- r2 (`@currentUser.id` instead): same — ACCEPTED, row authored `victim` (client emits
  `_scrml_cs_reactive_get("currentUser").id`).
- head: `COMPILE: REFUSED — E-ARG-SERVER-IDENTITY: argument 2 (`uid`) of this call of server function `add`
  carries an identity — it is computed in the browser from `@session.userId` … Fix: remove the `uid` parameter
  and read the identity on the server, inside `add` — `const uid = session.userId`.` No artifacts written.

## Governing sentence

The ruling IS the governing text (brief): user-voice-scrml.md S468, "your recos on both", item (2):
> "(b): a value derived from `@session` / `@currentUser` used as an argument to a server function is a compile
> error naming the fix (read the session on the server); newly-rejecting, fail-closed, corpus MEASURED before
> landing (real code newly refused returns to bryan)."
Supporting normative sentence, §6.6.9: "`@session` is server-only identity and SHALL NEVER be marshalled from the
client — doing so would be a spoofing hole." Written into SPEC as a §12.4 bullet + §34 row (E-ARG-SERVER-IDENTITY,
minted: no existing E-ROUTE-*/E-AUTH-* row covers an argument — E-AUTH-001 is a client `@var` bound in `?{}`,
E-PARAM-DEFAULT-SERVER-IDENTITY is a parameter DEFAULT, E-RI-002 a CPS carried local / cell write).

## Locus

Brief hypothesis: binding-provenance.ts + free-name.ts (the gap marker). REFINED: the follower
(`identityReadInDefaultDeep`) was right and is reused unchanged in shape; what was missing was (1) any check at an
ARGUMENT position at all (route-inference.ts gained Step 6c over a compilation call index), and (2) a resolver that
answers at a LOCATION — parameters (call-site arguments), mutating writes, loop / `<each>` binders, per-scope locals.
That is new module `compiler/src/identity-flow.ts`; free-name.ts gained `resolveName(name, at)` + `rootAt` + a
per-binding `key`; binding-provenance.ts exports `declaredNamesOf`; `localsWrittenBy` gained a `cells` flag.
The §7.3.2 default check now uses the same resolver (closes the gap's param / mutation routes for CPS defaults).

## Design decisions

- Server-placed callee = route boundary `server` (wholly-server or CPS-split), not a channel `onserver:*` handler.
- Client context = not under a wholly-server function, a CPS server statement, a `?{}`, an `<endpoint>`, a `^{}`.
- A value computed ON THE SERVER is not followed (a server function body, a CPS server statement, a `?{}`, a call
  of a server function): a server result travelling back through the browser is ruling (2)(d), banked — NOT
  refused here. §52 server cells likewise are not identity for this check (they are for the default check, as before).
- Raw text the parser keeps unparsed (block-bodied callbacks) is checked whole, plus the raw arrow's parameters.
- A function passed as a markup attribute value: an event handler receives the event; a component prop is
  substituted by component expansion, whose calls of it are call sites of their own (verified: CE emits
  `relay(@session.userId)` in the expanded markup; the refusal follows `u` into it).
- A name assigned in raw text: the argument check follows the raw text that writes it (scanned whole); the default
  check keeps its long-standing fail-closed reading (`followRawAssigned: false`) — no newly-accepting change there.
