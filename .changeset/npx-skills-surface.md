---
"rskills-cli": minor
---

Breaking: `read`, `ls` and `search` now take the same sources as `npx skills add`, replacing the `<scheme>://` URIs.

- A source can hold several skills. Select one with `owner/repo@skill` or `--skill <name>`, and a file or directory inside it with `--file <path>`. With a single skill in the source, no selector is needed (`rskills read mickadesign/fluid-functionalism`). `ls` on a multi-skill source without a selector lists its skills.
- GitHub skills are discovered through the Git Trees API at any depth, so nested monorepo layouts work without a path.
- New sources: GitHub URLs (`https://github.com/o/r/tree/<ref>/<path>`, `github:o/r`) and local paths. GitLab and generic git remotes are rejected as unsupported.
- `search` is skills.sh only: `--source` is removed and results use `owner/repo@skill` identifiers.

Migration:

- `skills-sh://o/r/skill` becomes `o/r@skill`
- `github://o/r/path` becomes `o/r/path` or `https://github.com/o/r/tree/HEAD/path`
- `well-known://host` becomes `https://host`
- `<uri>/references/foo.md` becomes `<source> --file references/foo.md`
- `claude://name/references/foo.md` becomes `claude://name --file references/foo.md`
- `search --source well-known` is gone; use `ls https://host` to browse a site's skills
