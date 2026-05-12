---
title: Why scrml has to deprecate function and component overloading
published: false
date: 2026-05-06
description: Two features are leaving the language in v0.2.0. They shipped, they worked, and on a self-audit of scrml's own corpus nothing actually relied on them. Here is the conversation that killed them and the lesson the language is keeping.
tags: webdev, javascript, programming, compiler
source-conversation: scrml-support/docs/function-overloading-sliver-2026-05-06.md
companion-article: tier-ladder-promotion-devto-2026-05-04.md
cover_image:
canonical_url:
---

*by Bryan MacLee*

**TL;DR: Two scrml features, function overloading and component overloading, are dying in v0.2.0. They shipped, they worked, and on a self-audit nothing in scrml's own samples, examples, stdlib, or self-host modules actually relied on them. The companion piece, "The compiler that grows up with your app," shows the primitives that survived. This piece explains why these two didn't.**

Two features are leaving the language in v0.2.0. They shipped, they worked, and I had been quietly wondering for a while what I would actually use them for, given everything scrml's primitives already do. Last week I asked claude, the LLM I have been pair-programming the compiler with, to walk me through what using the function-overload mechanism for a real centralization problem would actually look like. The drafts confirmed what I had been suspecting. Fifteen minutes after the engine-shaped rewrite landed on screen, the features were dead.

If that sounds dismissive, hear me out. State-type-discriminated function overloading has been in the compiler for roughly a year and it did work. Sixty lines of codegen, cleanly written, tests covering it. Component overloading was a different beast: a SPEC-ISSUE that tracked the design intent but was never implemented in the compiler. So one half of what is leaving v0.2.0 is shipped code with users that turned out to be zero; the other half is a doc-only proposal that never quite earned implementation. With the language as it is today, neither shape can do anything `match` and `engine` don't already do better, and the self-audit couldn't surface a single case to the contrary.

About twenty compiler attempts behind me. Eighteen months of design. The thing that made me kill these two features was not a benchmark or a roadmap pruning. It was an introspective moment of epiphany'd defeat. I had insisted on and worked to add overloading as a first-class feature. I wanted scrml to have an easy bridge from JS. And perhaps without building that bridge for myself, I wouldn't have had the perspective to see the right path.

## What they were

Function overloading scrml-style let you declare two functions with the same name in two different state-type bodies. `function dothe(): UserFlow { ... }` lives inside `UserFlow`'s state-constructor. `function dothe(): AdminFlow { ... }` lives inside `AdminFlow`'s. The compiler tags each one with its enclosing state-type, builds a registry, and at the call site emits a dispatch shim that reads the argument's runtime state-type tag and routes to the matching body.

Component overloading was the same shape on the markup side: multiple definitions of `<Card>`, prop-type-discriminated. The exact syntax was tracked as SPEC-ISSUE-010, never pinned down, and never implemented in the compiler — it lived as design intent in the spec text and nowhere else.

The motivation is reasonable on paper. Two actor types, two implementations of the same operation, one name at the call site. Method dispatch.

## The conversation

I have been pair-programming the scrml compiler with Claude for several months. Most of our work is in the compiler; some of it is design discussion. I went into this side-quest with a posture I want to be honest about: I had a prior (*these features don't earn their keep*), and I was actively suspicious that an LLM working with me daily might tell me what I wanted to hear instead of doing the work. So I framed the question to demand the work, not the conclusion. *How is function overloading done in scrml today?* Claude answered the mechanism. I followed up: *if a dev wants the body centralized, written once instead of twice, what do they actually have to type?* Show me the code. Don't tell me whether the feature is good. Type it.

The scenario was small and realistic. Two actor types: `UserFlow` and `AdminFlow`. One operation: `sendNotification(message)`. Different rails per actor (email queue for users, pager for admins, plus an admin-audit row for admins). One shared rule: rate-limit by recent sends, no actor sends more than ten in a minute. Ten lines of business spec at most.

Claude wrote three drafts. None of them were good.

### Draft one: split the body across the two state-constructor scopes

```scrml
<program>${

  function checkRateLimit(actorId: string, kind: string) -> boolean {
    const recent = ?{
      SELECT COUNT(*) AS n FROM notifications_log
      WHERE actor_id = ${actorId}
        AND kind = ${kind}
        AND created_at > NOW() - INTERVAL '1 minute'
    };
    return recent.n < 10;
  }

  <UserFlow userId(string) email(string) name(string)>
    ${
      function sendNotification(message: string) -> string {
        if (not checkRateLimit(this.userId, "user")) {
          return "rate-limited";
        }
        const subject = "Notification for " + this.name;
        const body = "Hi " + this.name + ",\n\n" + message;
        const id = ?{
          INSERT INTO email_queue (to_addr, subject, body)
          VALUES (${this.email}, ${subject}, ${body})
          RETURNING id
        };
        return "queued:" + id;
      }
    }
  </>

  <AdminFlow adminId(string) pagerToken(string) role(string)>
    ${
      function sendNotification(message: string) -> string {
        if (not checkRateLimit(this.adminId, "admin")) {
          return "rate-limited";
        }
        const payload = "[ALERT][" + this.role + "] " + message;
        const id = ?{
          INSERT INTO pager_queue (token, payload)
          VALUES (${this.pagerToken}, ${payload})
          RETURNING id
        };
        ?{ INSERT INTO admin_audit (admin_id, action) VALUES (${this.adminId}, 'paged') };
        return "paged:" + id;
      }
    }
  </>

}</program>
```

Call site is fine: `target.sendNotification("server maintenance at 3am")`. The compiler dispatches by state-type tag.

The cost isn't at the call site. It's that the *shape* of `sendNotification` (rate-limit gate, then act, then return a stringly-typed status) is invisible. Two bodies, no contract. Anyone editing one and not the other silently drifts the rules.

This draft fragments the **bodies**.

### Draft two: give up on overloading; rename the functions

```scrml
function sendUserNotification(user: UserFlow, message: string) -> string {
  if (not checkRateLimit(user.userId, "user")) { return "rate-limited"; }
  // ... user body, same as above ...
}

function sendAdminNotification(admin: AdminFlow, message: string) -> string {
  if (not checkRateLimit(admin.adminId, "admin")) { return "rate-limited"; }
  // ... admin body, same as above ...
}
```

Bodies are centralized; the contract is at least visible. But every call site replaces the dispatch the compiler used to do:

```scrml
if (currentActor.__scrml_state_type == "UserFlow") {
  result = sendUserNotification(currentActor, msg);
} else {
  result = sendAdminNotification(currentActor, msg);
}
```

`__scrml_state_type` is a compiler-internal runtime tag. Reading it from user source is reaching under the hood. If a developer is uncomfortable doing that (and they should be), they reinvent a discriminator field on every state type by hand.

This draft fragments the **call sites**.

### Draft three: manual one-name top-level dispatcher

```scrml
function sendNotification(target, message: string) -> string {
  const tag = target.__scrml_state_type;
  if (tag == "UserFlow") {
    if (not checkRateLimit(target.userId, "user")) { return "rate-limited"; }
    // ... user body ...
    return "queued:" + id;
  } else if (tag == "AdminFlow") {
    if (not checkRateLimit(target.adminId, "admin")) { return "rate-limited"; }
    // ... admin body ...
    return "paged:" + id;
  } else {
    fail .UnknownActor("sendNotification: unknown actor type " + tag);
  }
}
```

The call site is `sendNotification(target, msg)` again. Inside the body, `target` has no type annotation (there is no type to give it that captures "either UserFlow or AdminFlow with all their distinct fields"), so the type system is turned off for the entire function. `target.userId` and `target.adminId` are bare property accesses with no checking. Hand-rolled exhaustiveness. Hand-rolled dispatch. Untyped parameter. The compiler gets to type-check the spaghetti.

This draft fragments the **type system**.

Three drafts. Three different things fragmented. I read them and felt the engineering question forming: *which is the least bad?* That question is the trap. As long as I am answering "one of these three," the feature stays alive, never on its own merits, just as the least-bad workaround.

Then I asked the question that killed it.

## "Isn't `recent` state?"

The drafts all included a helper called `checkRateLimit(actorId, kind) -> boolean`. Inside the helper was a SQL query that counted how many notifications the actor had sent in the last minute. The function returned true if the count was under ten.

I looked at it and said: hold on. The helper is a derived view of state — a SQL query against the notifications log, scoped to an actor, bounded by a window. That query *is* the data; the rate-limit gate is one expression on top of it (`recentSendCount(target) >= 10`). scrml routes the query server-side automatically; no boilerplate, no separate "service layer," no helper-of-a-helper-of-a-helper.

And once the gate is one expression, the stringly-typed return is the other half of the problem. `"rate-limited"`, `"queued:5"`, `"paged:7"` — a sum-type return value smuggled in as a string. The call site loses every typed-variant guarantee; downstream consumers stringly-compare instead of pattern-matching. Exactly the bug class that `enum` and `match` were specifically designed to kill.

Claude rewrote the example. The new version had no `sendNotification` overload at all — one function, dispatched at the match-arm:

```scrml
<program>${

  type SendOutcome:enum = {
    RateLimited,
    Queued(id: string),
    Paged(id: string)
  }

  type Actor:enum = {
    User(userId: string, email: string, name: string),
    Admin(adminId: string, pagerToken: string, role: string)
  }

  fn actorKey(a: Actor) -> string {
    match a {
      .User u  -> u.userId
      .Admin a -> a.adminId
    }
  }

  // Derived view of state: how many messages has this actor sent recently?
  // The body is a SQL query; the compiler routes it server-side automatically.
  function recentSendCount(target: Actor) -> number {
    const result = ?{
      SELECT COUNT(*) AS n FROM notifications_log
      WHERE actor_id = ${actorKey(target)}
        AND created_at > NOW() - INTERVAL '1 minute'
    }
    return result.n
  }

  // One send. No overloading. Match-on-arm IS the dispatch.
  function send(target: Actor, message: string) -> SendOutcome {
    if (recentSendCount(target) >= 10) { return .RateLimited }

    match target {
      .User u -> {
        let emailId = ?{
          INSERT INTO email_queue (to_addr, subject, body)
          VALUES (${u.email},
                  "Notification for " + u.name,
                  "Hi " + u.name + ",\n\n" + message)
          RETURNING id
        }
        return .Queued(emailId)
      }
      .Admin a -> {
        let pagerId = ?{
          INSERT INTO pager_queue (token, payload)
          VALUES (${a.pagerToken},
                  "[ALERT][" + a.role + "] " + message)
          RETURNING id
        }
        ?{ INSERT INTO admin_audit (admin_id, action)
           VALUES (${a.adminId}, 'paged') }
        return .Paged(pagerId)
      }
    }
  }

}</program>
```

Look at what disappeared. There is no `sendNotification` *overload*, because there is no need for one. There is one `send` function, written once, whose body dispatches by match-on-arm over the `Actor` enum. Each arm gets the variant's payload statically typed (`u: { userId, email, name }` in the User arm, `a: { adminId, pagerToken, role }` in the Admin arm) — the same per-actor type-safety that the overload mechanism was trying to provide, but uniformly, in one body, with the return type a typed `SendOutcome` variant instead of a string sum-type smuggled through `"queued:5"` / `"paged:7"` / `"rate-limited"`.

No string sum-type. No `if`-ladder over a runtime tag. No two function bodies that have to stay in sync. No reaching under the hood for `__scrml_state_type`. The whole "where do I centralize the overload?" question dissolved, because the dispatch primitive `match` does the discrimination directly. The actor types live in one enum, the send body lives in one function, and the arms of the match handle the variant-specific work with full type-system visibility into each variant's payload.

That is the moment the feature died. Not because it was broken. Because the language already had its dispatch primitives (typed `enum`s with payloads, `match` over discriminated unions, derived state for queries-as-data, and `<engine>` for genuinely stateful flows) that did the same job at a higher level of expressiveness, with full type-system visibility, with no string contracts and no hand-rolled dispatch. The bridge I had insisted on building was already in the language.

If you want to see those three primitives in action, that is what the [companion piece, *The compiler that grows up with your app*](./tier-ladder-promotion-devto-2026-05-04.md), shows in detail. The `if=` → `<match>` → `<engine>` ladder where state-children migrate verbatim and the wrapper is the only thing that changes. That ladder is the canonical path for case analysis on a discriminated value. Function and component overloading were a parallel path that did not earn its keep against the ladder.

## The sliver test

After the rewrite, I tried to invent a single case where function overloading would beat the engine-shaped re-expression. A pure, side-effect-free transformation whose body genuinely differs by state-type and isn't reasonably expressible as a `match` arm.

I came up empty. `format(user)` versus `format(admin)` is a `match`. `permissions(user)` versus `permissions(admin)` is a `match`. `displayName(user)` versus `displayName(admin)` is a `match`. Anything involving effect, time, or multi-step dispatch is the engine. Anything that's "compute X about an actor" is a derived cell. There is no fourth category that wants the parallel-method-bodies shape.

The sliver test, as I am calling it: if I cannot easily invent a case that needs the feature, the feature is empty enough to act on.

Then the same anti-sycophancy worry kicked in again. I had reached a conclusion in conversation with the same LLM that walked me through the example. I needed to know whether the conclusion was load-bearing or whether I had talked myself into something the data did not actually support. So I asked claude to dispatch a radical-doubt deep dive; explicitly framed to find evidence against the conclusion. *Take the case for keeping these features seriously. Find counter-evidence. The working assumption is that the sliver is NOT empty.*

The deep dive went broad. It looked at how this dispatch shape has played out across other languages that ship some flavor of it, the kinds of language designers who would push back hardest on the deletion, and the realistic use cases the mechanism was meant to serve. None of it surfaced a counter-case. Every reasonable use of the overload mechanism collapsed into one of `match`, `engine`, or derived state, with the existing primitives doing more work, more typed, with less ceremony. The radical-doubt framing did not change the conclusion; it confirmed it.

Component overloading collapsed under the same scrutiny, by a slightly different route. Because no code ever shipped, the question was not "delete this implementation" but "should we still ship it." A second debate ran the panel through that question, and the convergent reading was the same shape as the function-overload finding: every plausible "multi-definition overload" use case in the markup tree reduces to either two-different-components, a single component whose body is a `match`, or a `match for=state` over an enum. The case that the JSX call site is structurally asymmetric to a function call site (which is true for React, Vue, Solid, Svelte) does not survive scrml's specific shape, because scrml's `<match for=Type>` is itself a markup expression of the same kind as `<Foo/>`. There is nothing the multi-definition form does that one of those three doesn't do better.

## What goes away in v0.2.0

For function overloading: the dispatch emitter, the registry-building pass, the AST tag the parser was setting, the tests that asserted the registry's shape — gone. For component overloading: nothing in the codegen, because there was nothing in the codegen. What goes away there is the spec text and the pending issue that tracked it. The spec section that called overloading "the primary dispatch mechanism" is rewritten to point at `match` and `engine` instead. The pending spec issue that was supposed to nail down the overload syntax closes without resolution.

The replacement primitives are already in the language and already taught. See the companion piece for the full ladder.

## The lesson the language is keeping

Two features tried to do something the language could already do better. They shipped. They got a little spec text, a little codegen, a little registry. They sat there for the better part of a year before I asked the question, watched the drafts come back obviously worse than the engine-shaped alternative, and finally checked whether anything I had built actually relied on them.

The lesson is not "delete unused code." Plenty of unused code earns its keep by existing for the future. The lesson is *the sliver test*: if I cannot easily invent a case where this feature does something the existing primitives can't, the feature is paying interest on a debt with no creditor. v0.2.0 is the breaking-by-design release; this is the right moment to take that debt off the books.

Function overloading and component overloading reached for argument-type-discriminated method dispatch as a primitive. scrml already has argument-type discrimination: it is `match` over a discriminated union, or an `engine` whose transition arms are typed. The match-on-arm syntax IS the dispatch. The dispatch was never the missing primitive. The instinct to reach for it was. And yes, the instinct is mine. I had been suspicious for a while; the drafts on screen were what moved the suspicion from quiet to acted-on. I started this language with the intent that it be JS-identical with a slight superset. For a long time I tried to keep the easy dev-conversion path open, even though I had known for some time that scrml had grown past that. This is a language. It is its own. It should stand as such. The companion piece is about the ladder that catches the instinct early. This piece is about closing the dead end of the language because the ladder already covers it.

Two features. Fifteen minutes. Dead. Onward.

---

*Drafted with Claude. The verbatim conversation and the radical-doubt deep dive that produced this article are both preserved in the project's design archive. Companion: [The compiler that grows up with your app](./tier-ladder-promotion-devto-2026-05-04.md).*
