---
"rskills-cli": patch
---

Add the undocumented skills.sh file-set download endpoint (`/api/download/{owner}/{repo}/{skillId}`) as step 2 of the skills-sh `read`/`ls` cascade, between the GitHub raw probe and the GitHub Trees API discovery. It returns a skill's entire file set in one request, so `read`/`ls` can resolve monorepo-nested skills without needing the GitHub Trees API in most cases.
