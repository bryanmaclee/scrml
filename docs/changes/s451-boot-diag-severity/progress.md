# s451-boot-diag-severity — progress

- start: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a667109ca5e9c2eca, base origin/main 25677da72.
- baseline counter (before): PASS 95 · FAIL 65 · NOT-TWINNED 511 · UNSUPPORTED 629 (graded 160); 25 "severity unobservable" failure lines.
- finding: the lower.scrml gate (`hasError`) already keys on the `E-` prefix, so W-/I- codes did NOT block the artifact before this change (the brief's (b) is stale on that point). The prefix is still wrong as a severity source: §34 makes E-DG-002 / E-TYPE-051 / E-CONTRACT-004-WARN Warning and 30+ W- codes Info.
