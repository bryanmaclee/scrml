---
title: Components are states
published: false
description: Every framework picks one state primitive (useState, ref, createSignal, signal) and bolts on hooks rules, dependency arrays, store boilerplate, prop drilling, and context APIs to plug the gaps that one primitive cannot fill on its own. scrml unifies the lot. State is a type. `<Card>` declares one. `<Card>` instantiates one. The same model that makes `<input>` a state makes a user-defined component a state.
tags: webdev, javascript, programming, compiler
cover_image:
canonical_url:
---

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: `<input>` is already a state. `<Card>` should be too. One concept replaces useState, hooks rules, dependency arrays, Zustand, Pinia, Redux, context, and most prop drilling.**

> **Status (as of May 2026):** the conceptual frame (state-as-type, primitive `<x> = 0` reactive cells, compound state with structural-children, validators on cells, server-side authority via `<schema>` + `protect=` + `<db>` + `<channel>`) tracks the current spec. The single scrml example below is a 2026-04 design preview of the user-defined `<Card authority="server" table="cards">` "state object" surface — that exact declaration shape is still landing and the example may use older draft attribute names. The point of the example is structural (one declaration covers shape + sync + boundary); the canonical current spelling lives in the kickstarter v2 §11.3 (channel recipe) + §3 (compound state) + §11.1 (engine recipe). See `docs/articles/llm-kickstarter-v2-2026-05-04.md` for the up-to-date code. **Correction (2026-06):** an earlier version of this article said the compiler *generates* the optimistic-update and rollback path for `authority="server"`. That auto-persist route was retracted (§52.6.2, 2026-06-14) and never actually shipped. The compiler generates the read path (initial load, SSR pre-render, the boundary check) and lands assignments locally for an instant response; the persist write is your explicit `?{}` server function. The body below reflects the current model.

Every framework I have looked at picks one of `useState`, `ref`, `createSignal`, or `signal`, and then bolts on a stack of secondary mechanisms to plug the gaps that one primitive cannot fill on its own. Hooks rules. Dependency arrays. A store library. A context API. Prop drilling for everything in between. I have hobbled through React when I had to. I have written enough TypeScript to be annoyed by it. I have spent eighteen months and about twenty compiler attempts circling one question: what would happen if state were a type, and a component were a state?

It turns out the same thing happens that happened with the server boundary. A whole shelf of libraries falls off the shelf.

This is the third of six features the browser-language overview piece promised to unpack. State.

## What you write today, and what every line of it costs

A real React app, scoped to one screen. Card list, edit dialog, optimistic updates, server sync. The state surface looks roughly like this.

```tsx
// useCards.ts
import { create } from "zustand";

interface Card { id: string; title: string; column: "todo" | "doing" | "done"; }

interface CardsStore {
  cards: Card[];
  isLoading: boolean;
  error: string | null;
  fetchCards: () => Promise<void>;
  addCard: (input: Omit<Card, "id">) => Promise<void>;
}

export const useCardsStore = create<CardsStore>((set) => ({
  cards: [],
  isLoading: false,
  error: null,
  fetchCards: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/cards");
      const cards = (await res.json()) as Card[];
      set({ cards, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },
  addCard: async (input) => {
    const tempId = crypto.randomUUID();
    const optimistic = { ...input, id: tempId };
    set((s) => ({ cards: [...s.cards, optimistic] }));
    // ... POST to /api/cards, reconcile, rollback on failure ...
  },
}));
```

```tsx
// CardList.tsx
export function CardList() {
  const cards = useCardsStore((s) => s.cards);
  const isLoading = useCardsStore((s) => s.isLoading);
  const fetchCards = useCardsStore((s) => s.fetchCards);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  useEffect(() => { fetchCards(); }, [fetchCards]);

  if (isLoading) return <Spinner />;
  return (
    <ul>
      {cards.map((c) => (
        <CardRow
          key={c.id}
          card={c}
          isEditing={editingId === c.id}
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          onStartEdit={() => { setEditingId(c.id); setDraftTitle(c.title); }}
          onCancelEdit={() => setEditingId(null)}
        />
      ))}
    </ul>
  );
}
```

Now the costs.

The `Card` interface lives in TypeScript only. The server schema lives somewhere else. They drift. You catch it in production.

`useState` has placement rules. Same call order every render. No conditionals. Hooks rules are real lint warnings because the runtime cannot recover from a mistake.

`useEffect` has a dependency array. Forget an entry, stale closure. Add an extra entry, infinite loop. The IDE helps. It is not a type-system answer.

`useCardsStore` is a Zustand boilerplate file because cross-component state cannot live in a hook. So you add a library. The library has its own mental model. Now you have two state primitives.

`editingId` and `draftTitle` are local to `CardList` because they are ephemeral. So they leak into every child as props. That is prop drilling. The fix is a context API. That is a third state primitive.

The optimistic update pattern (insert temp ID, POST, reconcile or rollback) is hand-written every time. Every team writes it slightly differently. Every team ships a bug in it eventually.

This is what one screen costs in a framework. The shape of the costs repeats across `useState`, `ref`, `createSignal`, `signal`. The primitive name changes. The bolt-on stack does not.

## The same screen in scrml

```scrml
< Card authority="server" table="cards">
    id: number
    title: string
    column: Column
</>

< EditState>
    editingId: number | not
    draftTitle: string
</>

<Card> @cards
<EditState> @ui

<ul>
    ${@cards.map(c => lift <CardRow card=c
                                   isEditing=${@ui.editingId == c.id}
                                   bind:draftTitle=@ui.draftTitle/>)}
</ul>

server fn renameCard(id: number, title: string(.length > 0 && .length < 200)) {
    ?{`UPDATE cards SET title = ${title} WHERE id = ${id}`}.run()
}
```

That is the screen. Both halves.

`<Card>` is a state type. The fields are typed. `authority="server"` and `table="cards"` say where the source of truth lives. The compiler reads the SQLite schema at compile time, generates the initial-load query, pre-renders the list in SSR, and enforces the client/server boundary (§52). The write itself stays one `?{}` server function you author, because that is the line where the real decisions live. The `Card` interface in TypeScript and the schema on disk cannot drift, because there is one declaration.

`<EditState>` is also a state type. No `authority=` attribute, so it is client-local by default (§52.2). The compiler emits zero sync infrastructure for it.

`<Card>` and `<EditState>` are instantiations. They look like HTML element opens because that is what they are at the type level. `<input>` is a state with a value, a lifecycle, and user interaction. `<Card>` is too. The grammar treats them the same way.

`@cards` and `@ui` are reactive. Reads in markup subscribe. Writes propagate. The compiler tracks the dependency graph at compile time (§31), so the runtime does no diffing to figure out what changed.

`bind:draftTitle=@ui.draftTitle` is the two-way binding form (§5.2.2). `<input bind:value=@x>` and `<CardRow bind:draftTitle=@ui.draftTitle>` are the same mechanism. There is no conceptual gap between "the input element is a state" and "the user-defined component is a state."

`title: string(.length > 0 && .length < 200)` is an inline type predicate (§53). The constraint is part of the type. A literal that fails the predicate fails the build (E-CONTRACT-001). A runtime value that fails the predicate is rejected at the server boundary before any database write (§53.9.4).

## What unifies all of this

One concept. State is a type.

`<input>` is a built-in state type. `<program>` is a built-in state type. `<channel>`, `<request>`, `<timer>`, `<keyboard>`, `<mouse>` are built-in state types (§36, §37, §38). `<Card>` is a user-defined state type. `@count` is a primitive reactive variable, which is the simplest case of the same idea.

Every one of them has the same compile-time guarantees:

1. A typed value. The shape is known to the compiler.
2. Predicate-checked writes. Inline constraints (§53) gate every assignment.
3. Reactive subscribers tracked at compile time. The dependency graph is built before the program runs.
4. Optional authority. State that lives on a server is declared `authority="server"` and gets its read path generated for free: the initial load, the SSR pre-render, and the boundary check. The write stays your `?{}`.
5. Optional state-machine rules. A reactive variable can be bound to an `<engine>` (§51) so transitions are typed too.

Layer those as you need them. Leave them off where you don't. A counter is one line: `@count = 0`. A server-synced kanban is the example above. The mechanism is the same.

## What this kills

- **Hooks rules.** A reactive variable is a typed declaration, not a call-order convention. There is no `@var` call sequence to preserve across renders.
- **Dependency arrays.** The compiler builds the dependency graph from the source. A derived value subscribes to what it reads.
- **State libraries.** Zustand, Pinia, Redux, Jotai, MobX. Cross-component state is a state declared higher up, or a primitive reactive variable at file scope. There is no library to wire in.
- **Context APIs.** A `@var` at the enclosing scope is reachable from any component nested inside it (§6.2). No provider component, no consumer hook.
- **Most prop drilling.** State that does not need to be local does not have to travel through five components to reach where it is used.
- **Runtime validators on the wire.** Inline predicates (§53) are checked at the boundary because they are part of the type. There is no zod schema sitting next to the TS type.
- **Optimistic-update boilerplate.** A type with `authority="server"` gets the read path generated: the initial load, the SSR pre-render, the boundary check, and the instant-local update on assignment (§52). The persist write stays the developer's one `?{}` query, and that is on purpose. The write is where server IDs get assigned, where INSERT versus UPDATE gets chosen, and where invariants get enforced, so it is the one place a compiler should not guess for you. I am not asking developers to hand-write the same ten lines of fetch, reconcile, and rollback on every screen. Just the one line that carries a real decision.

That is most of a typical app's `package.json` state-management section. The reason it can be killed is that one primitive (state-as-type) is doing the work that five different primitives used to share.

## What is still real

This is a position piece, not a sales pitch. The point is not that scrml has no concepts. The point is that one concept covers what a stack of libraries used to.

- **Some state is genuinely global.** Auth session, theme, current user. Declare it at file scope, or in a top-level state block. The mechanism is the same, the placement is the developer's call.
- **Some forms are genuinely complex.** A multi-step wizard with cross-step validation is not five lines in any language. scrml gives you `<engine>` for the transition rules and inline predicates for the value constraints. The shape of the work is smaller. The work is still real.
- **Some state crosses a network.** `authority="server"` is the declaration; the read path is generated. The wire is still a wire. The compiler does not pretend latency is zero, and it does not pretend it can write your database for you. It stops asking the developer to hand-write the fetch, the SSR hydration, and the boundary check. The write stays an explicit `?{}`, where it belongs.
- **Mutability contracts are deeper than predicates alone.** Predicates are the value layer. Lifecycles (`null → number`) and machine transitions are the other two. I am writing the dedicated unpacking of all three in the next piece in this series. This article only touches the value layer because that is what the state-as-type frame needs.

The line between "framework plumbing" and "actual app logic" is a lot brighter when one side of it is a typed declaration instead of five libraries negotiating.

## The deeper claim

A reactive primitive that is not a type cannot prove anything about itself at compile time. The framework era treated reactivity as a runtime trick (a closure, a proxy, a signal) and built tooling, conventions, and library ecosystems on top to recover the guarantees the type system was supposed to give.

State as a type gets those guarantees back. The compiler knows what every reactive variable is, what shape every component instance has, where the source of truth lives, and which subscribers re-render when a write lands. It knows because the developer wrote it down once, in one declaration, that the compiler reads.

That is the design. Do it right, the first time, even if it takes more time. A little short of perfect is still pretty awesome.

## Further reading

- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2). The high-altitude six-feature overview that this piece zooms in on.
- [The server boundary disappears](https://dev.to/bryan_maclee/the-server-boundary-disappears-hap). The companion zoom-in: why the server fn lets the type system own the wire.
- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-2247). The package-list-collapses argument, with the state-management category enumerated.
- [What scrml's LSP can do that no other LSP can, and why giti follows from the same principle](https://dev.to/bryan_maclee/what-scrmls-lsp-can-do-that-no-other-lsp-can-and-why-giti-follows-from-the-same-principle-4899). What vertical integration unlocks for tooling and version control.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp). The starting-point overview if you haven't seen scrml before.
- [Null was a billion-dollar mistake. Falsy was the second.](https://dev.to/bryan_maclee/null-was-a-billion-dollar-mistake-falsy-was-the-second-3o61). On `not`, presence as a type-system question, and why scrml refuses to inherit JavaScript's truthiness rules.
- [Retraction — scrml's Living Compiler](./living-compiler-retraction-devto-2026-05-21.md). The "scrml's Living Compiler" article has been retracted; scrml chose a sealed, deterministic build-story model instead.
- [The ORM trap, and why scrml does not need one](./orm-trap-devto-2026-04-29.md). Companion piece: SQL as a primitive, not a thing you import.
- [Mutability contracts: predicates, lifecycles, machines](./mutability-contracts-devto-2026-04-29.md). The three layers of write-time guarantee the value layer of this piece is one third of.
- [CSS without a build step](./css-without-build-step-devto-2026-04-29.md). Native scope, native variables, no styled-components.
- [Realtime and workers as syntax](./realtime-and-workers-as-syntax-devto-2026-04-29.md). `<channel>` and `<program>` finishing the state-types-as-built-ins story.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS). The working compiler, examples, spec, benchmarks.

<!--

## Internal verification trail (private — agent-only, not for publish)

This block is an HTML comment so it does not render on dev.to.

- Bio: `/home/bryan/scrmlMaster/scrml-support/voice/user-bio.md` (v1, signed off 2026-04-27; project memory marks BAKED 2026-04-28).
- Private draft / verification log: `/home/bryan/scrmlMaster/scrml-support/voice/articles/components-are-states-draft-2026-04-29.md`.
- Companion published: `why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` (the six-feature overview this piece zooms in on; slate item #1).
- Companion published: `server-boundary-disappears-devto-2026-04-28.md` (slate item #2 in the same six-feature unpacking).
- Companion published: `npm-myth-devto-2026-04-28.md` and `lsp-and-giti-advantages-devto-2026-04-28.md` (style/frontmatter pattern, voice fidelity reference).
- Same-batch sibling drafts (will be patched to dev.to URLs post-publish): `./orm-trap-devto-2026-04-29.md`, `./mutability-contracts-devto-2026-04-29.md`, `./css-without-build-step-devto-2026-04-29.md`, `./realtime-and-workers-as-syntax-devto-2026-04-29.md`.
- Agent: `/home/bryan/.claude/agents/scrml-voice-author.md` (article mode, gate cleared per project memory bio-baked 2026-04-28).
- SPEC: `/home/bryan/scrmlMaster/scrmlTS/compiler/SPEC.md` (§1 design principles "state is a first-class type" line 115; §6 reactivity; §15 components; §51 machines; §52 state authority; §53 inline predicates; §31 dependency graph cited).

**Spec validation summary:**

- ✅ "State is a first-class type" — verbatim spec design principle (SPEC §1.1 line 115).
- ✅ `< Card authority="server" table="cards">` state type declaration syntax — SPEC §52.3.1 lines 18717-18728. Worked example with `<Card>` instantiation at SPEC §52.3.5 lines 18763-18803, including the exact pattern used in the article (server-authoritative `Card`, client-local `EditState`, `<Card> @cards` instance binding).
- ✅ `<input>` and `<program>` and `<channel>` and `<request>` and `<timer>` and `<keyboard>`/`<mouse>` as built-in state types — SPEC line 175 (state context grammar), §36 (input state types), §37 (SSE), §38 (channels), §6.7.5/6.7.6 (timer/poll), §6.7.7 (request).
- ✅ `bind:value=@var` and `bind:propName` for two-way reactive — SPEC §5.2.2 (line 994 `bind:value=@var` desugaring), §15.11.1 (component bind props).
- ✅ Inline predicates `string(.length > 0 && .length < 200)` — SPEC §53.2.1 grammar (line 19265-19293), §53.2.2 usage positions (line 19299-19309).
- ✅ Dependency graph at compile time — SPEC §31 (line 11745-11768 "Dependency Graph: Purpose, construction, route analysis").
- ✅ Read-authority infrastructure for `authority="server"` — SPEC §52.1 + §52.6.2: compiler generates initial-load-on-mount, SSR pre-render, and the E-AUTH boundary check; the persist write is the developer's explicit `?{}` server fn. The auto-persist / optimistic-update / rollback path was RETRACTED 2026-06-14 (§52.6.2 / §52.6.3) — never implemented (a `console.warn` no-op), and it contradicted §52's own flagship example (§52.4.5).
- ✅ Default authority is local; form state needs no declaration — SPEC §52.2 lines 18711-18713.
- ✅ `< machine>` binding for typed transitions — SPEC §6.1.1 line 1386 (`@var: MachineName = initialValue` syntax confirmed live as an opt-in layer).
- ✅ Corrected 2026-06: the body previously claimed the compiler "generates the optimistic-update path, generates the rollback." Per §52.6.2's retraction (2026-06-14) that auto-persist route was never implemented and contradicted §52.4.5; §52 is a read-authority layer (initial load + SSR pre-render + boundary check), and the persist write is the developer's `?{}`. Body + status banner updated to the current model.
- ⚠️ The article uses `<EditState> @ui` as the instance-binding form (matching the SPEC §52.3.5 worked example exactly). This binding form is current per the worked example. If the binding-form syntax has drifted between spec and implementation, this would need re-checking; per spec it is correct.

**Forbidden territory check (bio §6):** all clear.
- React hobble-through disclosure used in opener, bio-attested (voice-scrmlTS:3600). No "I shipped React in production" claim. The TypeScript-frustration line ("written enough TypeScript to be annoyed by it") is a verbatim-paraphrase of voice-archive:1506 ("when i have written TS, I get so annoyed that I have to explicate that a variable can be a null or a number"). Both within bio §2b hobble-through bucket.
- Framework-fatigue narrative avoided. Critique is structural ("the bolt-on stack does not change", "one primitive cannot fill on its own"), not autobiographical-recovery ("after years of React I'm tired"). The opener picks a fresh angle (one-primitive-plus-bolt-ons) distinct from server-boundary's "every framework dev has shipped a bug" and npm-myth's "back in the cab."
- "First-principles, full-stack language" / "designed end-to-end" framing preserved. Article does NOT call scrml "opinionated."
- User-attested motivations only: "love solving puzzles" via the puzzle framing in the opener (bio §6 confirmed user-valid 2026-04-27); "do it right, the first time" verbatim from voice-scrmlTS:2700 in the close; "obsessed with performance" implicit in the runtime-does-less framing but not falsely overclaimed.
- Active first-person for ship commitments preserved: "I am writing the dedicated unpacking of all three in the next piece in this series" — first person, not agentless.
- Reception-fabrication check: zero "people tell me", "the most common critique", "frequently dismissed", "what everyone keeps saying". The "framework era taught us this was too hard" / "the bolt-on stack does not change" lines are structural claims about the ecosystem, not invented audience reception.
- No em-dashes / en-dashes in body. Hyphens (`first-principles`, `compile-time`, `state-as-type`, `state-management`, `optimistic-update`, `prop-drilling`) preserved as regular hyphens.
- Authorship line present immediately under H1.
- TL;DR placed under authorship line, above the voice-paragraph opener.
- Vendor links (Zustand, Pinia, Redux, Jotai, MobX, etc.) named as references but no claim that the user has used them in production. They are named as examples of "the bolt-on stack" the article is contrasting with.

**Voice fidelity (bio §4):**
- Truck-driver framing kept implicit (used in puzzle-framing through "eighteen months and about twenty compiler attempts"). Not over-played.
- "I have hobbled through React when I had to" — voice-scrmlTS:3600 paraphrased with proper contraction (`I have` not `I've`, neutral; preserved "hobbled" / "hobble-through" vocabulary per bio §2b).
- "do it right, the first time" — voice-scrmlTS:2700 verbatim used in close.
- "a little short of perfect is still pretty awesome" — voice-archive:1292 verbatim used as kicker.
- Sentence shape: short imperative bursts in "What this kills" list, fragments allowed.
- No consultant-speak, no "leveraging", no "synergy".

-->
