---
"rskills-cli": patch
---

Fix `read`/`ls` for skills-sh skills nested deep in monorepos (e.g. `trycua/cua/cua-driver`). When the fixed raw-root candidates 404, fall back to the skills.sh file-set download endpoint, then to GitHub's recursive Git Trees API.
