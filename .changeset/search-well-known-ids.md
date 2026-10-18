---
"rskills-cli": patch
---

Fix `rskills search` failing on skills.sh results from well-known sites (e.g. `ui-skills.com/<skill>`). They now appear as `host.tld@skill`, which `rskills read` accepts; unrecognised id shapes are skipped instead of failing the search.
