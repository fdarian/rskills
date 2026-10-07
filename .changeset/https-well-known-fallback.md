---
"rskills-cli": patch
---

`https://` URIs that don't end in `.md` (e.g. `https://fframes.studio`) now resolve through the `well-known` source, matching `npx skills add <url>`

`well-known` now probes `/.well-known/agent-skills/index.json` before the legacy `/.well-known/skills/index.json` (under the given URL, then the site root), `ls` on a bare host lists its skills, and `well-known://host.tld` no longer mis-parses the host as a file subpath
