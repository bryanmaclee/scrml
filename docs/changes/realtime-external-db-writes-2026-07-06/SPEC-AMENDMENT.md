# SPEC AMENDMENT — §38.13 Realtime Feed over External DB Writes (`<channel watches=>`)

**Change-id:** `realtime-external-db-writes-2026-07-06`
**Date:** 2026-07-06 (interim S241-adjacent session)
**Status:** DRAFT — apply-ready; **HELD** (not applied to `SPEC.md` yet — authored during S241-open to avoid `SPEC.md` line-collision; apply at landing after S241 wraps).
**Classification:** SPEC-TEXT / **Nominal** (spec-ahead-of-implementation). The `<channel watches=>` surface + the `E-CHANNEL-WATCHES-*` codes are NAMED here; the **§34 catalog rows + the impl (parser/typer/codegen/trigger-DDL/LISTEN-bridge) land WITH the impl wave** per Rule 4 / the §60·§61·§64 named-codes-land-with-impl precedent.
**Authority:** DD `../../../../scrml-support/docs/deep-dives/realtime-external-db-writes-2026-07-06.md` (substrate fork + surface) + design-insight (2026-07-06, scrml-support) + user rulings this session ("A + reserve B (deferred)"; "watches= is good"; "no debate, go straight to the SPEC amendment").

> **Apply instructions (at landing, section-relative — DO NOT hardcode line numbers; S241 shifted SPEC.md):**
> 1. Append **§38.13** (below) as a new §38 subsection, after §38.12.9 (the last §38.12 sub-subsection), before §39.
> 2. Amend **§38.3 Attributes** — add the `watches` row (§A below).
> 3. Amend **§4.15** + **§24.4** structural-element registries — add `<onchange>` (channel change-feed handler sub-element) (§B below).
> 4. Amend **§38.6** normative list — add the `broadcast()`-forbidden-in-`watches=`-channel note (§C below).
> 5. Amend **§52.6.7** — add the forward cross-ref sentence (§D below).
> 6. Regenerate `SPEC-INDEX.md` (`bun run scripts/regen-spec-index.ts`) + add the §38.13 Quick-Lookup topic rows.
> 7. §34 rows: NONE at this landing (Nominal / named-with-impl per Rule 4).

---

## §38.13 Realtime Feed over External DB Writes — `<channel watches=>`

> **Nominal (spec-ahead-of-implementation).** This subsection is normative for the SURFACE; the compiler wiring (trigger-DDL emission, the LISTEN bridge, `RowChange` synthesis, the `<onchange>` dispatch, the `E-CHANNEL-WATCHES-*` diagnostics) is the follow-on impl wave that flips this banner. Postgres-only (see §38.13.7).

§38.4–§38.6 realtime carries changes that originate **through a scrml write path** — a client cell-write (auto-sync, §38.4) or a server-fn `broadcast()` (§38.6). §52.6.7 documents the canonical *server-side* variant (explicit `?{}`-write **then** `broadcast()` in one server fn). All of these presume a **scrml call site**. A change that commits to the database from **outside the app** — another service, `psql`, a foreign-language ORM, a second scrml instance's `?{}` — has **no scrml function to fan out from**, so §52.6.7's "compose the two verbs at the same site" answer is unavailable by construction, and connected clients never learn of the change.

`<channel watches=<table>>` closes this gap. It is a **server-fed, read-only change-feed** — a distinct *mode* of `<channel>` (§38.1's transport machinery, reused) in which the compiler emits a database-side change capture (§38.13.7) that publishes each committed row change to the channel's topic; subscribed clients dispatch it through a typed `<onchange>` handler (§38.13.3). The channel is the **transport**; the source of truth is the database (and, where paired, a §52 server-authoritative store) — exactly §52.6.7's authority ⊥ transport separation.

```scrml
<program db="postgres://…">

  <orders authority="server" table=orders>     <!-- §52: initial load + SSR + the reactive @orders collection -->
      id: int
      status: string
      total: number
  </>
  <orders> @orders

  <channel name="orders-feed" watches=orders>   <!-- §38.13: live deltas from EXTERNAL commits to `orders` -->
      <onchange>
          | Inserted row :> { @orders = [...@orders, row] }
          | Updated  row :> { @orders = @orders.map(r => r.id == row.id ? row : r) }
          | Deleted  key :> { @orders = @orders.filter(r => r.id != key) }
      </onchange>
  </channel>

</program>
```

### 38.13.1 The `watches=` attribute

- `watches=<table>` names a database table the channel mirrors. The value is a **static literal table identifier** (no `${...}` interpolation — parallel to `name=`/`topic=` per §38.11) and SHALL name a table declared in a `<schema>` in the same program (the compiler needs the row shape + primary key to synthesize `RowChange` (§38.13.2) and emit the capture DDL (§38.13.7)). An unknown table SHALL emit `E-CHANNEL-WATCHES-UNKNOWN-TABLE`.
- A `watches=` channel is still a channel: `name=` (required — its WS route `/_scrml_ws/<name>`) and `topic=` (defaults to `name`) apply as in §38.3. The compiler publishes captured changes to the channel's active topic; clients subscribed to the topic receive them.
- `watches=` REQUIRES a Postgres database (`<program db="postgres://…">` / a `<db src>` resolving to the `postgres` driver, §44.2). On the `sqlite` or `mysql` driver it SHALL emit `E-CHANNEL-WATCHES-DRIVER` (see §38.13.7 for the driver rationale).
- `watches=` is orthogonal to `auth=` / `reconnect=` (they compose normally — a feed MAY be auth-gated).

### 38.13.2 The synthesized `RowChange` enum

For a `watches=<T>` channel the compiler **synthesizes** a per-feed change type from `T`'s `<schema>` row shape:

```
RowChange:enum = { Inserted(row: <RowT>), Updated(row: <RowT>), Deleted(key: <PKT>) }
```

where `<RowT>` is the struct of `T`'s columns and `<PKT>` is the type of `T`'s primary key. `Inserted` / `Updated` carry the full post-image row; `Deleted` carries only the primary key (the row is gone). The primary key is derived by the `id`-field convention (the §41.16 tableFor / §52 precedent); an explicit **`key=<column>`** attribute on the `<channel>` overrides it. A table with no derivable `id`/PK and no `key=` SHALL emit `W-CHANNEL-WATCHES-NO-PK` (the feed cannot key its deltas). `RowChange` is not a user-authored type; it exists only as the discriminant of the feed's `<onchange>` arms.

### 38.13.3 The `<onchange>` handler — typed, exhaustive, client-side

A `watches=` channel body contains exactly one `<onchange>` element: a typed dispatch over the synthesized `RowChange` (§38.13.2), reusing the match-block arm grammar (§18.0.1) + payload binding (§51.0.B.1) — the same inbound-typed-dispatch shape as `<endpoint accepts=:enum>` (§61.2):

```scrml
<onchange>
    | Inserted row :> { … }      <!-- row : the full inserted row -->
    | Updated  row :> { … }      <!-- row : the full post-update row -->
    | Deleted  key :> { … }      <!-- key : the primary key of the deleted row -->
</onchange>
```

- The arms SHALL be **exhaustive** over `RowChange`'s three variants (reuses the §18 exhaustiveness family — a missing variant is the `E-MATCH-NOT-EXHAUSTIVE`-class; no dedicated code). A wildcard `_` arm is legal.
- `<onchange>` arm bodies run **CLIENT-side** (they patch client state — typically a paired §52 collection, §38.13.5 — via canonical `@` access to program-scope cells). The server-side capture (§38.13.7) is entirely compiler-emitted; the adopter writes no server code for the feed.
- `<onchange>` is a scrml-defined structural element valid ONLY inside a `watches=` channel body (§4.15 / §24.4; `E-STRUCTURAL-ELEMENT-MISPLACED` elsewhere). A `watches=` channel with no `<onchange>` SHALL emit `W-CHANNEL-WATCHES-NO-CONSUMER` (nothing consumes the feed).

### 38.13.4 Read-only feed mode — the forbidden set

A `watches=` channel is a **one-way server→client** feed. It has no client-held synced cells and no app-side fan-out:

- It SHALL NOT declare V5-strict synced cells (`<x> = init`) in its body — a read-only feed has no bidirectional §38.4 sync path; apply changes to program-scope cells from `<onchange>` instead. A synced-cell declaration (or any client→server write path) in a `watches=` channel SHALL emit `E-CHANNEL-WATCHES-CLIENT-WRITE`.
- It SHALL NOT call `broadcast()` / `disconnect()` — the feed is fed by the database capture, not by app broadcast. Such a call SHALL emit `E-CHANNEL-WATCHES-BROADCAST` (a tighter sibling of §38.6's `E-CHANNEL-004`).

These keep `watches=` a **limited primitive** (S174): it does exactly one thing (mirror external commits to clients) and does not overlap the §38.4 synced-cell channel or the §38.6/§52.6.7 explicit-`broadcast()` channel. All three coexist; `watches=` is for external / uncontrolled change feeds, explicit `broadcast()` for app-controlled *batched* fan-out (the §52.6.7 world-tick / Colyseus patchRate shape — a `watches=` feed fires **per-row-commit**, so it is NOT a substitute for batched broadcast in high-frequency-write scenarios).

### 38.13.5 Composition with §52 authority

`watches=` carries **deltas**; a §52 `authority="server" table=<T>` cell owns the **collection** (§52 gives the initial load + SSR + the re-fetch-on-reconnect authoritative state). They compose: the `<onchange>` arms patch the §52 collection by primary key (the worked example above). This is precisely §52.6.7's "the channel is the transport, not the source of truth."

The feed clears the §52.6.7 P2/P3 auto-fan-out rejection by the **pipe-not-store** distinction: §52.6.7 rejected a `broadcast=` attribute partly because it "requires a server-held reactive store that doesn't exist." `watches=` needs **no** server-held reactive store — the **Postgres commit stream is the change-detector** (the capture reports exactly what changed); the compiler-emitted bridge is a *pipe* (DB change → transport), never a store holding diffs. Channel cells stay client-held (§38.4 intact); the feed lives on the §38 transport axis, never on the §52 authority declaration (putting it there would be the rejected P2 — god-ifying authority to swallow transport, S174). See §52.6.7 (amended, §D) for the forward reference.

### 38.13.6 Delivery guarantee

The v1 feed is a **liveness accelerator over re-fetchable authoritative state**, NOT a durable event log:

- **At-most-once.** A change committed while a client (or the server's capture listener) is disconnected is NOT replayed on reconnect.
- **Commit-ordered per table.** Changes to one watched table are delivered in commit order. There is **no** cross-table or cross-channel ordering guarantee.
- **Re-fetch is the consistency backstop.** On (re)connect the client SHALL re-establish authoritative state — which the paired §52 read-authority provides on load. An adopter relying on the feed alone across a restart WILL miss changes; that is by design for v1.
- The reserved **`durable`** tier (logical replication, §38.13.7 / the DD's "B reserved") would upgrade this to replay-across-restart; it is NOT v1.

### 38.13.7 Substrate — LISTEN/NOTIFY (Postgres); `durable` (logical replication) RESERVED

The v1 capture substrate is **Postgres LISTEN/NOTIFY**, chosen (DD 2026-07-06) because it is the only substrate the **compiler can fully own and emit** with no out-of-band adopter precondition:

- The compiler emits, per `watches=<T>` channel: (a) an `AFTER INSERT OR UPDATE OR DELETE` trigger + trigger function on `T` that `pg_notify`s the change (managed alongside the `<schema>` DDL in the schema-diff machinery); (b) a dedicated server-side `LISTEN` connection (reusing the program's resolved `postgres://` connection record) that, on each notification, re-SELECTs the changed row by primary key and publishes a `{ __type: "__change", op, row | key }` frame to the channel topic (the server→client push of §38.6/§38.8, reused); (c) the client-side dispatch of that frame into the `<onchange>` arms (the client IIFE of §38.7, extended with a `__change` case).
- **Multi-instance is free:** each scrml server instance holds its own `LISTEN` connection; one `NOTIFY` reaches all listening connections; each re-publishes to its local WS subscribers. `watches=` requires **no** cross-instance pub/sub backbone (contrast the intra-app `broadcast()` cross-instance fan-out, a separate concern).
- **Payload:** the trigger notifies the primary key (bounded — Postgres `NOTIFY` caps at 8000 bytes); the listener re-SELECTs the full row. This avoids the wide-row cap and never aborts the writer's transaction.
- **Why not logical replication (WAL/CDC):** it captures every change durably/replayably but requires `wal_level=logical` + a server restart + a `REPLICATION` role — **out-of-band adopter preconditions the emitted artifact cannot satisfy** — plus a replication-slot ops footgun and a worse multi-instance story. Its one unique win (durable replay) is mostly subsumed by §52 re-fetch-on-reconnect. It is **RESERVED** as a future opt-in `durable` tier, revived only on a witnessed replay-across-restart need. Full comparison: the DD.

### 38.13.8 Error codes (NAMED; §34 rows land WITH the impl per Rule 4)

- **`E-CHANNEL-WATCHES-DRIVER`** — `watches=` on a non-`postgres` driver (SQLite/MySQL unsupported v1).
- **`E-CHANNEL-WATCHES-UNKNOWN-TABLE`** — the `watches=` table is not declared in any `<schema>` in the program.
- **`E-CHANNEL-WATCHES-CLIENT-WRITE`** — a V5-strict synced-cell declaration or a client→server write path inside a read-only `watches=` channel body.
- **`E-CHANNEL-WATCHES-BROADCAST`** — a `broadcast()`/`disconnect()` call inside a `watches=` channel (it is DB-fed, not app-fanned).
- **`W-CHANNEL-WATCHES-NO-PK`** (Warning) — the watched table has no derivable `id`/primary key and no `key=` override; the feed cannot key its deltas.
- **`W-CHANNEL-WATCHES-NO-CONSUMER`** (Warning) — a `watches=` channel with no `<onchange>` handler.
- **`<onchange>` exhaustiveness** reuses the §18 match family (`E-MATCH-NOT-EXHAUSTIVE`-class over the synthesized 3-variant `RowChange`) — no dedicated code.
- **`<onchange>` misplacement** reuses `E-STRUCTURAL-ELEMENT-MISPLACED` (§4.15/§24.4).

### 38.13.9 Implementation status (Nominal)

SPEC-TEXT only at this landing. The impl wave: `<channel watches=>` + `key=` parse (ast/typer); `RowChange` synthesis from `<schema>`; `<onchange>` structural element + arm dispatch (reuse §18.0.1/§51.0.B.1); the six `E-CHANNEL-WATCHES-*`/`W-*` diagnostics + their §34 rows; trigger-DDL emission + drift-reconcile in the schema-diff machinery; the LISTEN bridge + `__change` frame + client dispatch in `emit-channel.ts`/`emit-server.ts` (reusing the `collectDbScopes` connection record + `server.publish`). Postgres-only. The `durable` (logical-replication) tier is out of the v1 impl.

### 38.13.10 Cross-references

§38.1 (channel placement/transport, reused), §38.3 (attributes, +`watches`/`key`), §38.4 (client-held cells — the read-only-feed distinction), §38.6 (`broadcast()` — forbidden in `watches=`), §38.6.1 (`onserver:message` param-binding — the client-dispatch analog), §38.11 (literal name/topic — `watches=` is literal too); §18.0.1 (match-block arms) + §51.0.B.1 (payload binding) + §61.2 (`<endpoint>` typed inbound arms — the direct precedent); §52 (`authority="server"` — the paired collection) + §52.6.7 (server-fan-out ruling — the P2/P3 rejection this clears via pipe-not-store); §44.2 (driver resolution — Postgres gate); §41.16/§52 (`id`-PK convention). Authority: DD `realtime-external-db-writes-2026-07-06.md` + design-insight 2026-07-06.

---

## §A — Amendment to §38.3 Attributes (add rows)

Add to the §38.3 attribute table, after the `reconnect` row:

| `watches` | No | table identifier (literal) | **(Nominal, §38.13)** Marks the channel a server-fed read-only change-feed over the named table's EXTERNAL commits. Static literal; the table SHALL be `<schema>`-declared; Postgres-only. Mutually exclusive with V5-strict synced cells + `broadcast()` in the body (§38.13.4). |
| `key` | No | column identifier (literal) | **(Nominal, §38.13)** Primary-key column override for a `watches=` feed's delta keying (default: the `id` convention). |

---

## §B — Amendment to §4.15 + §24.4 structural-element registries (add `<onchange>`)

Add `<onchange>` to the scrml-defined structural-element registry (§4.15) and the not-HTML registry (§24.4): a **channel change-feed handler** — valid ONLY inside a `watches=` `<channel>` body (§38.13.3); contains exhaustive match-arm dispatch over the synthesized `RowChange` enum; `E-STRUCTURAL-ELEMENT-MISPLACED` elsewhere. (Registry + `attribute-registry.js` wiring land with the impl per the §4/§24 structural-element procedure — PRIMER §12 "Adding a new scrml-special structural element".)

---

## §C — Amendment to §38.6 normative list (broadcast forbidden in watches=)

Add one normative bullet to §38.6:

- A `broadcast()` / `disconnect()` call inside a `watches=` channel (§38.13) SHALL emit `E-CHANNEL-WATCHES-BROADCAST` — a `watches=` channel is fed by the database change capture, not by app-side fan-out (§38.13.4). (This is a tighter sibling of `E-CHANNEL-004`.)

---

## §D — Amendment to §52.6.7 (forward cross-ref)

Add one sentence to §52.6.7 (after the "Reconsider auto-fan-out only when ALL THREE hold" block):

> **External-write realtime is a distinct case (§38.13).** The three reconsideration conditions above govern auto-fan-out of a change that originates *through a scrml server write*. A change that commits from OUTSIDE the app has no scrml call site to compose `broadcast()` into; `<channel watches=>` (§38.13) serves that case and clears these conditions not by satisfying condition (1) but by **sidestepping its premise** — the Postgres commit stream is the change-detector, so the feed is a *pipe* (DB change → transport), never a server-held reactive store. The feed lives on the §38 transport axis (a `watches=` channel), never on this §52 authority declaration — so it composes with a `authority="server"` store (that store owns the collection; the feed carries the deltas) without god-ifying the authority axis.
