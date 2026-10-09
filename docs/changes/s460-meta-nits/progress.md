# s460-meta-nits progress

- 2026-10-09T00:36:47Z WIP(s460-meta-nits): start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af908a186f9bede28 (HEAD b1648b778)
- 2026-10-09T00:46:23Z Reproduced N1/N2a/N2b/N5 on b1648b778 with the reviewer harness (138 rows, out-base.txt in scratch). Probe: a <map id=pm> (no name) ALSO captures a page <img usemap=#pm> (hash-name reference matches id or name) — so N1 also refuses id on <map>. N1 code+tests committed.
