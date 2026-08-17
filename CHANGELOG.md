# rskills-cli

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
