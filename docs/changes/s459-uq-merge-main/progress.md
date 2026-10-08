# s459-uq-merge-main — progress (append-only)

## 2026-10-08T13:37 startup
- WT /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a23452c1e1875fc71; branch s459-uq-merge from 417fa38a3.
- bun install + pretest OK. Start commit 3dd22ecd1.
- merge-base with origin/main 24922c0a1; 22 overlapping files (11 src, 7 tests, SPEC + 3 generated docs).

## merge (375027bbb) — hook 33338 pass / 0 fail
- 7 conflicts: emit-channel (onclient:close tail shared by registry + listener, `_scrml_g.setTimeout`),
  emit-worker (`_scrml_g.self.onmessage = function(_scrml_event)`), fn-name-rename (main's rewriteFreeRefs
  refactor + branch rule in the ref callback), each-block.test (both pins), generated docs (regen by script).
- semantic: s457 test's two `^{ emit() }` handler vehicles now refused by #1359 (§22.4.1, E-META-EVAL-002) —
  re-asserted as refused-with-no-listener; lift title pin `_scrml_g.String`.

## step 2 (fe88aab76) — host-global exception removed
- inRenamedPosition / isHostGlobalName / HOST_GLOBAL_NAMES deleted; every free user-fn ref renamed in every
  position. Probe: user fns document/NodeFilter/setTimeout/String/JSON/window/location/Math/console/Object/Array
  + each/bind/if page → each `_scrml_<name>_N` appears once (declaration only); compiler refs `_scrml_g.*`.
- host-global-scan --check exit 0 (0 violations; 119 threw = same set as main).

## `_scrml_` sweep
- listener-event-check: judges free `event`/injected names only; `_scrml_g.event` is a member (same as
  `window.event`, allowed before); user `_scrml_g` / `_scrml_event` refs refused E-NAME-COLLIDES-RESERVED-PREFIX
  (bare, inline block, ${}, assignment, lift, component body). SAFE.
- unquoted-attr-value.ts: no `_scrml_` logic. SAFE. fn-name-rename.ts: no prefix admission. SAFE.

## gates (tip d7063ea40)
- types-gate OK; root-level 2239/0; e2e-render-map 259/0; self-host slices 2016/0, lowered 99/0, lexer 337/0;
  lint OK; todomvc compile + node --check OK; browser-baseline PASS (48); snippet 128/0; compile floor PASS;
  FACTS/SPEC-INDEX/state/bootstrap-conformance --check current; conformance/run.ts 1387/1437 + 50 xfail
  (main 1379/1429 + 50 xfail; FAIL/XFAIL sets identical; +8 = the s457 cases).
- SPA counter runtime gzip 16383 (main 16383) < 16384; ratchet 8/0.
- corpus (main 6fcde7f7e compiler+corpus vs tip): 0 outcome changes, 0 syntax-failing; 2477 common units:
  971 raw-identical, 489 identical after `_scrml_event`->event, 10 differ = the S458 round-3 set (7 migrated
  sources, 13-worker, channel-basic-001, s450 IIFE). 9 W-TYPE-031-UNPROVEN drops = migrated conformance
  sources (main compiler on the migrated source gives the same codes).
- core suite unit+integration+conformance at d7063ea40: 31029 pass / 58 skip / 0 fail (31099 tests).
