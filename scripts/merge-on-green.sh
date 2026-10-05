#!/usr/bin/env bash
# merge-on-green.sh — merge a PR only when the gate discipline is actually satisfied.
#
# PROVENANCE. The discipline this enforces was ratified by Peter across S438/S446/S450/S453
# ("merge on green", given per session, in words) and was first scripted at S438 on the P-Tech1
# clone — where it was never committed, so it existed on exactly one machine and every other
# clone did the check by hand. This file is a RE-AUTHORING from the recorded contract
# (scrml-support/user-voice-pjoliver11.md §S438/§S446/§S450/§S453), not a copy of that script;
# behaviour may differ in detail from the S438 original, which is unrecoverable.
#
# THE CONTRACT, verbatim from the ledger:
#   "it merges ONLY when `gate` + `windows` pass on the PR's CURRENT head AND `tracking`'s
#    failure-name set is byte-identical to main's newest push run, and prints why it refused
#    otherwise."   — user-voice-pjoliver11.md §S438
#   "`--auto` never used."  — §S438, §S446, §S450
#
# WHY `--auto` IS NEVER USED, since it looks like the obvious tool: auto-merge fires the instant
# the checks go green, including a session later. At S327 a parked auto-merge arm fired against an
# explicit "hold the merges" and landed #447. This script therefore re-checks and merges NOW, under
# the operator's current authorization, or refuses and exits non-zero.
#
# WHY `tracking` IS COMPARED AS A NAME SET AND NOT AS PASS/FAIL: the tracking job is
# `continue-on-error: true` at BOTH the job and the step level (.github/workflows/ci.yml), so its
# conclusion is `success` even when steps inside it fail. Its pass/fail therefore carries no signal
# at all. What carries signal is WHICH steps failed, compared against main — a regression shows up
# as a name present here and absent there. We read the step conclusions from the API rather than
# grepping the log: the structured answer cannot drift with log formatting (Rule 7 — do not ask the
# text what the structure already knows).
#
# DEPENDENCIES: bash + gh only. `jq` is deliberately NOT required — `gh --jq/-q` has jq built in,
# and S453 measured that at least one peter clone (AdiPDesk) had no `jq` installed, where a
# jq-dependent wait loop failed silently and read as "still pending" for 30 minutes.
#
# USAGE
#   scripts/merge-on-green.sh <pr-number> [--dry-run] [--squash|--merge|--rebase] [--base <branch>]
#
#   --dry-run   run every check and report the verdict; never merge. Always safe.
#   --base      the branch whose newest completed run is the tracking reference (default: main).
#
# EXIT CODES
#   0  merged (or, with --dry-run, would merge)
#   1  refused — a check is red, pending, or the tracking name set regressed
#   2  refused — the PR is not in a mergeable state (BEHIND / DIRTY / BLOCKED / closed)
#   3  refused — the head moved while we were checking (re-run; never merge a stale verdict)
#   4  usage or environment error (gh missing, not authenticated, bad PR)

set -uo pipefail

PR=""
DRY_RUN=0
MERGE_METHOD="--squash"
BASE="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --squash|--merge|--rebase) MERGE_METHOD="$1" ;;
    --base) shift; BASE="${1:-main}" ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    -*) echo "merge-on-green: unknown flag '$1'" >&2; exit 4 ;;
    *) PR="$1" ;;
  esac
  shift
done

if [ -z "$PR" ]; then
  echo "merge-on-green: a PR number is required. See --help." >&2
  exit 4
fi

command -v gh >/dev/null 2>&1 || { echo "merge-on-green: 'gh' is not on PATH." >&2; exit 4; }

say()  { printf '%s\n' "$*"; }
fail() { printf 'REFUSED — %s\n' "$*" >&2; }

# Run a gh query, keeping its EXIT STATUS separate from its OUTPUT. S453 burned three separate
# instances of a command's status being masked (two behind pipelines, one by a missing dependency),
# each of which rendered a broken probe as a benign answer. Never infer "none" from empty text.
gh_q() {
  local out rc
  out="$(gh "$@" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'GH-ERROR(%d): %s\n' "$rc" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')" >&2
    return "$rc"
  fi
  printf '%s' "$out"
}

say "merge-on-green: PR #$PR (base: $BASE)$([ "$DRY_RUN" -eq 1 ] && printf ' [DRY RUN]')"

# ---------------------------------------------------------------- 1. PR state
read_pr_info() {
  gh_q pr view "$PR" --json state,mergeable,mergeStateStatus,headRefOid,baseRefName,title \
    -q '[.state, .mergeable, .mergeStateStatus, .headRefOid, .baseRefName] | join(" ")'
}

PR_INFO="$(read_pr_info)" || exit 4
set -- $PR_INFO
PR_STATE="${1:-}"; MERGEABLE="${2:-}"; MERGE_STATE="${3:-}"; HEAD_SHA="${4:-}"; PR_BASE="${5:-}"

# `mergeStateStatus` is computed LAZILY by GitHub: for a few seconds after a push — and sometimes
# for an untouched old PR — it answers UNKNOWN, and the act of asking is what triggers the
# computation. UNKNOWN therefore means "not yet known", NOT "not mergeable", and refusing on the
# first UNKNOWN would reject a genuinely green PR. So re-ask, BOUNDED (§8: never make "forever" a
# reachable state, and report a timeout as a timeout rather than as a verdict).
# Found by bite-testing this script, which refused two real open PRs on a first-read UNKNOWN.
if [ "$PR_STATE" = "OPEN" ] && { [ "$MERGE_STATE" = "UNKNOWN" ] || [ -z "$MERGE_STATE" ]; }; then
  for attempt in 1 2 3 4 5; do
    say "  mergeStateStatus UNKNOWN — GitHub computes it on demand; re-asking ($attempt/5)"
    sleep 4
    PR_INFO="$(read_pr_info)" || exit 4
    set -- $PR_INFO
    PR_STATE="${1:-}"; MERGEABLE="${2:-}"; MERGE_STATE="${3:-}"; HEAD_SHA="${4:-}"; PR_BASE="${5:-}"
    [ "$MERGE_STATE" = "UNKNOWN" ] || [ -z "$MERGE_STATE" ] || break
  done
  if [ "$MERGE_STATE" = "UNKNOWN" ] || [ -z "$MERGE_STATE" ]; then
    fail "mergeStateStatus is still UNKNOWN after 5 re-reads over ~20s. That is a TIMEOUT, not a
         verdict — do not read it as either green or red. Re-run; if it persists, open the PR in a
         browser (viewing it forces the computation) and then re-run."
    exit 2
  fi
fi

if [ -z "$HEAD_SHA" ]; then
  fail "could not read PR #$PR's head SHA (gh returned nothing usable)."
  exit 4
fi

say "  head          ${HEAD_SHA:0:8}"
say "  state         $PR_STATE / mergeable=$MERGEABLE / mergeStateStatus=$MERGE_STATE"

[ "$PR_STATE" = "OPEN" ] || { fail "PR #$PR is $PR_STATE, not OPEN."; exit 2; }

case "$MERGE_STATE" in
  CLEAN) ;;
  BEHIND)
    fail "the branch is BEHIND $PR_BASE. Branch protection is strict:true, so update it first —
         'gh pr update-branch $PR' does it server-side, which avoids a local push (on a clone whose
         pre-push hook runs the full suite for an UPDATE, a local push can be rejected on
         pre-existing red). The checks then re-run and this script must be run again."
    exit 2 ;;
  DIRTY)
    fail "the branch has merge CONFLICTS with $PR_BASE. Resolve as a real 3-way merge — never a
         wholesale file-pull, which is a lost update when the file had an intervening write."
    exit 2 ;;
  BLOCKED)
    fail "mergeStateStatus is BLOCKED — a required check has not passed yet on ${HEAD_SHA:0:8}.
         The per-check verdicts below say which."
    ;;
  *)
    fail "mergeStateStatus is '$MERGE_STATE'; refusing to reason about an unknown state."
    exit 2 ;;
esac

# ------------------------------------------------- 2. gate + windows on THIS head
CHECKS="$(gh_q pr checks "$PR" --json name,state,link -q '.[] | [.name, .state, .link] | join(" ")')" \
  || { fail "could not read the check rollup for PR #$PR."; exit 1; }

if [ -z "$CHECKS" ]; then
  fail "the check rollup is EMPTY for ${HEAD_SHA:0:8}. That is not 'green' — it is 'no checks have
       reported', which is how a just-pushed head looks. Wait for CI and re-run."
  exit 1
fi

check_state() { printf '%s\n' "$CHECKS" | awk -v n="$1" '$1==n {print $2; found=1} END{if(!found) print "ABSENT"}'; }

GATE_STATE="$(check_state gate)"
WINDOWS_STATE="$(check_state windows)"
TRACKING_STATE="$(check_state tracking)"

say "  gate          $GATE_STATE"
say "  windows       $WINDOWS_STATE"
say "  tracking      $TRACKING_STATE (conclusion carries no signal — see the name-set check below)"

REFUSE=0
for pair in "gate:$GATE_STATE" "windows:$WINDOWS_STATE"; do
  nm="${pair%%:*}"; st="${pair##*:}"
  case "$st" in
    SUCCESS) ;;
    ABSENT)  fail "required check '$nm' is ABSENT on ${HEAD_SHA:0:8}."; REFUSE=1 ;;
    PENDING|QUEUED|IN_PROGRESS|"") fail "required check '$nm' is still $st on ${HEAD_SHA:0:8}."; REFUSE=1 ;;
    *)       fail "required check '$nm' is $st on ${HEAD_SHA:0:8}."; REFUSE=1 ;;
  esac
done

# --------------------------------- 3. tracking failed-STEP name set vs the base's newest run
#
# Reference = the newest COMPLETED CI run on $BASE. "Newest" is not "newest successful": a base
# whose tracking tier has a standing failure must compare against that standing set, or every PR
# looks like a regression.
run_id_from_link() { printf '%s' "$1" | sed -n 's|.*/actions/runs/\([0-9][0-9]*\)/.*|\1|p'; }

tracking_failed_steps() { # $1 = run id -> sorted set of failed step names, one per line
  gh_q run view "$1" --json jobs \
    -q '.jobs[] | select(.name=="tracking") | .steps[] | select(.conclusion=="failure") | .name' \
    | sed '/^$/d' | LC_ALL=C sort
}

PR_TRACK_LINK="$(printf '%s\n' "$CHECKS" | awk '$1=="tracking"{print $3; exit}')"
PR_RUN_ID="$(run_id_from_link "${PR_TRACK_LINK:-}")"

BASE_RUN_ID="$(gh_q run list --branch "$BASE" --limit 20 \
  --json databaseId,status,workflowName \
  -q 'map(select(.status=="completed" and .workflowName=="CI")) | .[0].databaseId')" || BASE_RUN_ID=""

if [ -z "$PR_RUN_ID" ] || [ -z "$BASE_RUN_ID" ] || [ "$BASE_RUN_ID" = "null" ]; then
  fail "could not resolve both runs for the tracking comparison (pr='${PR_RUN_ID:-none}',
       $BASE='${BASE_RUN_ID:-none}'). Refusing rather than treating an unresolved probe as a pass."
  REFUSE=1
else
  PR_FAILS="$(tracking_failed_steps "$PR_RUN_ID")"; pr_rc=$?
  BASE_FAILS="$(tracking_failed_steps "$BASE_RUN_ID")"; base_rc=$?
  if [ "$pr_rc" -ne 0 ] || [ "$base_rc" -ne 0 ]; then
    fail "a tracking-step query errored; refusing (an errored probe is not an empty result)."
    REFUSE=1
  else
    PR_N="$(printf '%s' "$PR_FAILS" | sed '/^$/d' | wc -l | tr -d ' ')"
    BASE_N="$(printf '%s' "$BASE_FAILS" | sed '/^$/d' | wc -l | tr -d ' ')"
    say "  tracking name set: PR run $PR_RUN_ID = $PR_N failed step(s); $BASE run $BASE_RUN_ID = $BASE_N"
    if [ "$PR_FAILS" = "$BASE_FAILS" ]; then
      say "  tracking      name set byte-identical to $BASE ✓"
    else
      fail "the tracking failed-step name set DIFFERS from $BASE's newest completed run."
      printf '%s\n' "--- red only in THIS PR (the regression) ---" >&2
      LC_ALL=C comm -23 <(printf '%s\n' "$PR_FAILS") <(printf '%s\n' "$BASE_FAILS") | sed '/^$/d' | sed 's/^/    + /' >&2
      printf '%s\n' "--- red only on $BASE (fixed here, or flaky there) ---" >&2
      LC_ALL=C comm -13 <(printf '%s\n' "$PR_FAILS") <(printf '%s\n' "$BASE_FAILS") | sed '/^$/d' | sed 's/^/    - /' >&2
      REFUSE=1
    fi
  fi
fi

[ "$REFUSE" -eq 0 ] || { fail "not merging PR #$PR."; exit 1; }

# ------------------------------------------------------- 4. the head must not have moved
HEAD_NOW="$(gh_q pr view "$PR" --json headRefOid -q '.headRefOid')" || exit 4
if [ "$HEAD_NOW" != "$HEAD_SHA" ]; then
  fail "the head moved while checking (${HEAD_SHA:0:8} -> ${HEAD_NOW:0:8}). Every verdict above
       describes a commit that is no longer the tip. Re-run."
  exit 3
fi

say "  head unchanged at ${HEAD_SHA:0:8} ✓"
say "VERDICT: green — gate + windows pass on this head, tracking name set matches $BASE."

if [ "$DRY_RUN" -eq 1 ]; then
  say "DRY RUN: not merging. Re-run without --dry-run to merge."
  exit 0
fi

say "merging PR #$PR ($MERGE_METHOD, --delete-branch; never --auto)"
if gh pr merge "$PR" "$MERGE_METHOD" --delete-branch; then
  say "merged PR #$PR."
  exit 0
fi
fail "gh pr merge failed for PR #$PR — read its output above. The repository state is unchanged."
exit 1
