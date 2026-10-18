# rskills

Read remote [skills](https://agentskills.io/) (`SKILL.md` + `references/` / `scripts/` / `templates/` / `assets/`) without installing them. Built for AI agents that need to peek at a skill before deciding to install.

## Install

```bash
brew install fdarian/tap/rskills
# or one-shot, no install:
npx rskills-cli <command>
```

## Usage

`<source>` is anything `npx skills add <source>` accepts:

| Source | Example |
|---|---|
| GitHub shorthand | `anthropics/skills`, `anthropics/skills/skills/pdf` |
| GitHub URL | `https://github.com/anthropics/skills/tree/main/skills/pdf` |
| Site with a [well-known skills index](https://github.com/vercel-labs/skills) | `https://fframes.studio` |
| Local path | `./my-skills`, `~/skills/pdf` |
| Single markdown file | `https://example.com/some/SKILL.md` |
| Local Claude Code skill | `claude://my-skill` |

A source can hold several skills. Pick one with `@skill` (GitHub shorthand) or `--skill <name>`; with exactly one skill in the source you can omit it.

### Read

```bash
# One skill in the repo: no selector needed
rskills read mickadesign/fluid-functionalism

# Several skills: pick one
rskills read anthropics/skills@pdf
rskills read anthropics/skills --skill pdf

# Another file inside the skill
rskills read anthropics/skills@pdf --file references/forms.md

rskills read claude://my-skill
rskills read claude://my-skill --raw   # literal file, no preprocessing
```

`read` strips YAML frontmatter and prints raw markdown to stdout. `--raw` returns the literal file. For `claude://` skills, inline `` !`shell` `` / ` ```! ` blocks are executed (respects `shell:` frontmatter and `disableSkillShellExecution` in settings) unless `--raw` is passed.

### List

```bash
rskills ls anthropics/skills                    # skills in the source
rskills ls anthropics/skills@xlsx               # entries of one skill
rskills ls anthropics/skills@xlsx --file scripts   # a subdirectory
```

`ls` mirrors Anthropic's `ls`/`Glob` tools: it lists directory entries, while `read` fetches file content. Reading a directory with `read` exits non-zero and points you to `ls`.

### Search

Searches [skills.sh](https://skills.sh). On an interactive terminal (no `--format`, `--json`, or `--token-*`), `search` opens a live picker: type to search, ↑/↓ to navigate, Enter for an action menu (read SKILL.md / copy identifier / copy install command / open on skills.sh / save to or remove from your [library](#library)), Esc to quit.

```bash
rskills search                 # interactive picker (TTY only)
rskills search react           # pre-fill the picker, or structured output when piped
rskills search react --limit 5 --format json
```

Results carry an `owner/repo@skill` identifier you can pass straight to `read` or `ls`.

<details>
<summary>How skills are found</summary>

- **GitHub**: one Git Trees API request lists the repo; a `SKILL.md` at the search root (the repo root or the path you gave) is the only skill, otherwise every `SKILL.md` below it is a skill named after its directory (skipping `node_modules`, `.git`, `dist`, `build`, `__pycache__`). If GitHub rate-limits you and you named a skill, the skills.sh copy is used instead.
- **Site URLs**: `/.well-known/agent-skills/index.json` is tried first, then the legacy `/.well-known/skills/index.json`, under the given URL and then the site root.
- **Local paths**: same discovery as GitHub, on disk.
- **`claude://<name>`** resolves under `<cwd>/.claude/skills/` then `~/.claude/skills/` (first match wins).
- GitLab, other git hosts, and `git@` / `ssh://` URLs are not supported yet.

</details>

### Library

Keep a personal list of skills you like and search it later.

```bash
rskills lib add anthropics/skills --skill pdf --tags docs,pdf --note "form filling"
rskills lib add ./my-skills/review --as my-review   # name it yourself
rskills lib search                  # everything saved
rskills lib search pdf --tags docs  # words must match; entries need every tag
rskills lib rm pdf
```

`lib add` takes the same `<source>` and `--skill` as `read`, and fails before saving if the source doesn't resolve to exactly one skill. Entries are named after the skill (`--as` overrides) and the name is unique, ignoring case. Adding the same source again refreshes its description and merges tags; a different source under a taken name is rejected until you pass `--as`.

`lib search` is non-interactive: every word of the query must appear in an entry's name, description, tags, note or source, with exact and partial name matches ranked first. `rskills read <source>` of a saved entry's `source` (plus `--skill`) prints the skill.

In the `search` picker, Enter on a result offers **Save to library** (or **Remove from library** when it is already saved); saved results are marked with ★.

<details>
<summary>Where it's stored</summary>

One JSON file, at `$RSKILLS_LIBRARY`, else `$XDG_CONFIG_HOME/rskills/library.json`, else `~/.config/rskills/library.json`. It sits in the config directory so you can keep it in your dotfiles.

Each entry is a reference, not a copy of the skill: its name, the `source` (and `--skill`) you passed, the `description` from `SKILL.md` frontmatter at save time, tags, an optional note, and when it was added. Skill content is always fetched fresh by `read`, so re-run `lib add` to refresh the description. Local paths are saved as absolute paths.

A missing file is an empty library; an unreadable or invalid file is an error that names the path, and the picker disables saving rather than overwrite it.

</details>

## Output

- `read` prints **raw markdown** to stdout regardless of `--format`. Pipe it anywhere.
- `ls` prints structured `{ entries: [{ name, type }] }`, TOON by default, switchable with `--format json|yaml|md|jsonl`.
- `search` prints structured results (`{ identifier, name, installs?, source }`) when not interactive, in the same formats.
- `lib add` and `lib rm` print the entry, `lib search` prints `{ results: [...] }`, in the same formats.
- Errors exit with non-zero status and print a short message.

## Built-ins from incur

rskills inherits incur's agent-friendly defaults:

- `--llms` / `--llms-full` — print a command manifest agents can read
- `--filter-output <keys>` — narrow structured output to specific fields
- `--format <toon|json|yaml|md|jsonl>` — pick the output serialization
- `--token-count`, `--token-limit`, `--token-offset` — token-aware output

Run `rskills --help` for the full list.
