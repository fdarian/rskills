# rskills

Read remote Anthropic-style skills (`SKILL.md` + `references/` / `scripts/` / `templates/` / `assets/`) without installing them. Built for AI agents that need to peek at a skill before deciding to install.

## Install

```bash
bun install -g rskills
# or one-shot:
bunx rskills <command>
```

## Usage

### Read

```bash
# Fetch SKILL.md (raw markdown to stdout)
rskills read skills-sh://vercel-labs/json-render/json-render-react
rskills read github://anthropics/skills/skills/pdf
rskills read https://example.com/some/SKILL.md

# Fetch a sub-resource (references, scripts, templates, assets, or any .md sibling)
rskills read github://anthropics/skills/skills/pdf/reference.md
rskills read skills-sh://vercel-labs/skills/references/foo.md
```

### List

```bash
# List top-level entries of a skill
rskills ls github://anthropics/skills/skills/xlsx
rskills ls skills-sh://anthropics/skills/xlsx

# List a subdirectory within a skill
rskills ls github://anthropics/skills/skills/xlsx/scripts
rskills ls skills-sh://anthropics/skills/xlsx/scripts
```

`ls` mirrors Anthropic's `ls`/`Glob` tools — it lists directory entries, while `read` fetches file content. Reading a directory path with `read` will error and suggest using `ls` instead.

### Search

```bash
rskills search react --source skills-sh --limit 5
rskills search https://mintlify.com/docs --source well-known
rskills search react --limit 5 --format json   # switch output format
```

## URI format

`<source>://<identifier>[/<subpath>]`

| Source | Example | Search | Read | List |
|---|---|---|---|---|
| `skills-sh` | `skills-sh://vercel-labs/json-render/json-render-react` | ✓ | ✓ | ✓ |
| `github` | `github://anthropics/skills/skills/pdf` | — | ✓ | ✓ |
| `well-known` | `well-known://mintlify.com/docs` | ✓ | ✓ | ✓ (requires `files` array in index) |
| `https` | `https://example.com/SKILL.md` (must end in `.md`) | — | ✓ | — |

### Subpath detection

No subpath → fetches `SKILL.md`. With a subpath, rskills detects the boundary heuristically:

1. **Known subdir** (`references`, `scripts`, `templates`, `assets`, `SKILL.md`) — splits there
2. **Extension on last segment** — that segment is the subpath
3. Otherwise the whole path is the identifier

## Output

- `read` prints **raw markdown** to stdout regardless of `--format`. Pipe it anywhere.
- `ls` prints structured `{ entries: [{ name, type }] }` — TOON by default, switchable with `--format json|yaml|md|jsonl`.
- `search` prints structured results — TOON by default, switchable with `--format json|yaml|md|jsonl`.
- Errors exit with non-zero status and print a short message.
- Reading a directory path with `read` exits non-zero with a message pointing to `rskills ls`.

## Built-ins from incur

rskills inherits incur's agent-friendly defaults:

- `--llms` / `--llms-full` — print a command manifest agents can read
- `--filter-output <keys>` — narrow structured output to specific fields
- `--format <toon|json|yaml|md|jsonl>` — pick the output serialization
- `--token-count`, `--token-limit`, `--token-offset` — token-aware output

Run `rskills --help` for the full list.

## License

MIT
