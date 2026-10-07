---
"rskills-cli": patch
---

Support site URLs like `https://fframes.studio` (as in `npx skills add <url>`) by resolving them through the `well-known` source, which now also probes `/.well-known/agent-skills/index.json`.
