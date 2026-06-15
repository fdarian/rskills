# rskills-cli

## 0.2.0

### Minor Changes

- 08d4617: Default to `skills-sh://` when no source prefix is given. Bare identifiers like `anthropics/skills/skills/pdf` now work without an explicit scheme.
- 4781933: Strip YAML frontmatter by default for all `read` sources unless `--raw` is used.
- c836cc7: `search` now launches an interactive live-search TUI by default, agents still sees the toon format (non-TTY)

## 0.1.1

### Patch Changes

- 366b1f1: Fix release scripts
