---
"rskills-cli": patch
---

Fix `read`/`ls` for skills-sh skills nested deep inside monorepos (e.g. `trycua/cua/cua-driver`, `qwenlm/qwen-code/cua-driver`). When the fixed raw-root candidates (`skills/`, `.agents/skills/`, `.claude/skills/`) 404, fall back to the GitHub recursive Git Trees API to locate SKILL.md before trying unpkg.
