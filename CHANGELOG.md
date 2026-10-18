# rskills-cli

## 0.4.0

### Minor Changes

- f9d60db: Add a personal skill library: `rskills lib add`, `lib rm` and `lib search` save skills as references (source, description, tags, note) in `~/.config/rskills/library.json` and search them later. The `search` picker can save and remove results and marks saved ones with a star.

### Patch Changes

- 4a4e4c1: Fix `rskills search` failing on skills.sh results from well-known sites (e.g. `ui-skills.com/<skill>`). They now appear as `host.tld@skill`, which `rskills read` accepts; unrecognised id shapes are skipped instead of failing the search.

## 0.3.0

### Minor Changes

- d486461: Breaking: `read`, `ls` and `search` now take the same sources as `npx skills add`, replacing the `<scheme>://` URIs.

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

### Patch Changes

- 4873427: Support site URLs like `https://fframes.studio` (as in `npx skills add <url>`) by resolving them through the `well-known` source, which now also probes `/.well-known/agent-skills/index.json`.

## 0.2.1

### Patch Changes

- 7a20162: Fix `read`/`ls` for skills-sh skills nested deep in monorepos (e.g. `trycua/cua/cua-driver`). When the fixed raw-root candidates 404, fall back to the skills.sh file-set download endpoint, then to GitHub's recursive Git Trees API.

## 0.2.0

### Minor Changes

- 08d4617: Default to `skills-sh://` when no source prefix is given. Bare identifiers like `anthropics/skills/skills/pdf` now work without an explicit scheme.
- 4781933: Strip YAML frontmatter by default for all `read` sources unless `--raw` is used.
- c836cc7: `search` now launches an interactive live-search TUI by default, agents still sees the toon format (non-TTY)

## 0.1.1

### Patch Changes

- 366b1f1: Fix release scripts
