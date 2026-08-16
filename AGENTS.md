# rskills

A Bun + Effect.ts CLI for reading remote [skills](https://agentskills.io/) without installing them. Built on [incur](https://github.com/wevm/incur) for the CLI surface.

## What it does

- `rskills read <uri>` — fetch a skill file and print markdown body content to stdout (frontmatter stripped by default; `--raw` returns the literal file, no envelope, in any `--format`). Reading a directory URI exits non-zero with an `IsDirectory` message pointing to `rskills ls`.
- `rskills ls <uri>` — list entries in a skill directory; returns structured `{ entries: [{ name, type }] }` (mirrors Anthropic's `ls`/`Glob` tools — `read` is files-only, `ls` is directories)
- `rskills search [query] [--source <name>] [--limit <n>]` — search skills. On an interactive terminal (stdin + stdout both TTY, no `--source`, no `--format`/`--json`/`--token-*`), opens a live Ink picker: type to search (debounced 250 ms, race-safe via Effect fiber interruption), ↑/↓ to navigate, Enter for an action menu (read SKILL.md / copy identifier / copy install command / open on skills.sh), Esc to quit. Skills-sh only in interactive mode. Otherwise (piped, `--format`, `--source`, etc.) emits structured output — TOON by default, switchable via `--format json|yaml|md|jsonl`; `query` is required in this mode.

## URI scheme

`<source>://<identifier>[/<subpath>]` — `<source>://` is optional; bare identifiers default to `skills-sh://`.

| Source | Identifier | Search? | Read? | List? |
|---|---|---|---|---|
| `skills-sh` | `<owner>/<repo>/<skill-path>` | ✓ (skills.sh API) | ✓ (5-step cascade: GitHub raw → skills.sh download → GitHub Trees API → unpkg → skills.sh page) | ✓ (GitHub Contents API, or the downloaded file set directly, against resolved root) |
| `github` | `<owner>/<repo>/<path>` | — | ✓ (raw.githubusercontent.com) | ✓ (GitHub Contents API) |
| `well-known` | `<host-or-base-url>` | ✓ (fetches `/.well-known/skills/index.json`) | ✓ | ✓ (derives from `files` array in index; `NotFound` if no `files`) |
| `https` | full `https://…md` URL | — | ✓ (must end in `.md`) | — |
| `claude` | `<skill-name>` (single segment) | — | ✓ (local filesystem) | ✓ |

## Subpath rules

The boundary between `identifier` and `subpath` is detected heuristically in `src/uri.ts`:

1. If any segment matches `references | scripts | templates | assets | SKILL.md`, split there (handles `pdf/references/foo.md`).
2. Else if the **last segment has a file extension** (`/\.\w+$/`), it's the subpath (handles top-level siblings like `pdf/reference.md`).
3. Otherwise the whole path is the identifier and `SKILL.md` is fetched.

`https://` URIs skip subpath detection — the URL is fetched as-is.

## claude local resolution

First non-HTTP source — reads via `@effect/platform` `FileSystem` + `Path` (Node layers in `cli.ts`), not `HttpClient`.

Resolve `<skill-name>` against Claude Code skill roots in order; first existing path wins:

1. `<cwd>/.claude/skills/<name>/<subpath-or-SKILL.md>` (project, relative to process cwd)
2. `~/.claude/skills/<name>/<subpath-or-SKILL.md>` (personal; `~` via `os.homedir()`)

`NotFound` lists probed absolute paths. Plugin roots (`~/.claude/plugins/**/skills/`) and `claude://user/<name>` are deferred (see comment in `src/sources/claude.ts`).

**Post-read processing**:

- YAML frontmatter stripping is global for all sources in `readFromUri` (`src/frontmatter.ts`); `read --raw` skips it and returns the literal file content.
- `claude://` additionally preprocesses inline shell placeholders in `src/sources/claude-preprocess.ts`; its `shell` frontmatter field selects `bash` (default) or `powershell` for execution.
- Execute inline `` !`cmd` `` (only when `!` is line-start or whitespace-prefixed; `KEY=!`cmd`` stays literal) and fenced ` ```! ` blocks; substitute stdout once (no re-scan). Non-zero exit still substitutes stdout.
- Honor `disableSkillShellExecution: true` in `<cwd>/.claude/settings.json` or `~/.claude/settings.json` — commands become `[shell command execution disabled by policy]`.

## skills-sh resolution cascade

`read` (and the `list`-supporting `resolveSkillsShRoot`) runs a 5-step cascade to locate a skill's SKILL.md:

### Step 1 — GitHub raw probe

Probes 4 candidate raw roots in order:
- `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{skillPath}/SKILL.md`
- `…/skills/{skillPath}/SKILL.md`
- `…/.agents/skills/{skillPath}/SKILL.md`
- `…/.claude/skills/{skillPath}/SKILL.md`

If all 4 return 404, probe the bare prefix blobs for `skills`, `.agents/skills`, and `.claude/skills`. A 200 raw response there is treated as a Git symlink target (guarded to a single-line path), then `/{target}/{skillPath}/SKILL.md` is probed. This handles repos where the public skills root is a symlink.

First 200 → resolved root cached as `{ _tag: "BaseUrl"; baseUrl: string }`. Subsequent reads append `/<subpathOrSKILL.md>`.

### Step 2 — skills.sh file-set download (`src/sources/skills-sh-download.ts`)

Triggered when step 1's 4 candidates (plus its symlink fallback) all 404. An undocumented, unauthenticated skills.sh endpoint returns a skill's entire file set in one request:

`GET https://skills.sh/api/download/{owner}/{repo}/{skillId}` → `{ "files": [{ "path": "SKILL.md", "contents": "..." }, ...] }`. `path` is skill-relative, not repo-relative.

It runs before the GitHub Trees API (step 3) because it needs only one request regardless of repo size, at the cost of possibly serving a stale skills.sh snapshot rather than live repo content. The endpoint is undocumented (found by reading `vercel-labs/skills`' `src/blob.ts`) and could disappear or change shape without notice — any non-200 status or unparseable body returns `null` and the cascade falls through to the Trees API.

A match → resolved root cached as `{ _tag: "FileSet"; files: ReadonlyMap<string, string> }`. `read` looks up the requested subpath (default `SKILL.md`) directly in the map; a key that's a prefix of other keys but not itself a key raises `IsDirectory`. `list` derives entries from the map's keys at the requested depth — no further network calls for either.

### Step 3 — GitHub Git Trees API discovery (`src/sources/github-tree.ts`)

Triggered when step 2 also finds no match — no finite candidate list generalizes to arbitrary monorepo layouts (e.g. `trycua/cua` keeps skills at `libs/cua-driver/rust/Skills/cua-driver/SKILL.md`).

1. Fetch `https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1`.
2. Suffix-match blob paths (case-insensitive) against `{skillPath}/SKILL.md`, including an exact match at repo root. Multiple matches resolve to the shortest (shallowest) path.
3. A `truncated: true` response is searched as-is (not treated as authoritative) — no match there falls through to unpkg.

A match → resolved root cached as `{ _tag: "BaseUrl"; baseUrl: "https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{matchedDir}" }`, same shape as step 1's, so subpath reads and `ls` resolve off it identically. A 403 from the Trees API surfaces as `RateLimited`, matching the GitHub Contents API convention used elsewhere in this file (`fetchGitHubContents`).

### Step 4 — unpkg fallback

Triggered when step 3 also finds no match. Some skills ship SKILL.md only in their npm package (generated at build time), not in the GitHub repo.

1. Fetch `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/package.json`. If not 200 or not parseable, skip.
2. Read `name` from the JSON.
3. Probe `https://unpkg.com/{name}@latest/SKILL.md`. If 200, cache root as `{ _tag: "BaseUrl"; baseUrl: "https://unpkg.com/{name}@latest" }`.

### Step 5 — skills.sh detail page (install command only)

Triggered when unpkg also 404s. Fetches `https://www.skills.sh/{owner}/{repo}/{skillId}` and extracts the `npx skills add …` install command from the rendered HTML.

**No SKILL.md content recovery**: skills.sh uses Next.js App Router — there is no `__NEXT_DATA__` blob and SKILL.md is rendered as HTML only, not embedded as raw markdown. Step 5 only provides the install command to include in the `NotFound` error message.

### `ResolvedSkillRoot` type

```ts
type ResolvedSkillRoot =
  | { readonly _tag: "BaseUrl"; readonly baseUrl: string }
  | { readonly _tag: "FileSet"; readonly files: ReadonlyMap<string, string> }
```

Cached in `SkillsShCache` (`Ref<Map<string, ResolvedSkillRoot>>`). `BaseUrl` roots (steps 1, 3, 4) resolve a subpath by appending it to `baseUrl` and fetching. `FileSet` roots (step 2) serve every subpath directly from the cached map, with no further network calls.

## Source plugin contract

A source is a plain object implementing `SkillSource` (`src/sources/source.ts`):

```ts
interface SkillEntry {
  name: string
  type: "file" | "directory"
}

interface SkillSource {
  scheme: string
  read: (uri: ParsedUri) => Effect.Effect<
    string,
    FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument | IsDirectory,
    HttpClient.HttpClient | SkillsShCache | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
  >
  search?: (query: string, limit: number) => Effect.Effect<
    SkillSearchResult[],
    FetchFailed | ParseFailed,
    HttpClient.HttpClient
  >
  list?: (uri: ParsedUri) => Effect.Effect<
    ReadonlyArray<SkillEntry>,
    FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument,
    HttpClient.HttpClient | SkillsShCache | FileSystem.FileSystem | Path.Path
  >
}
```

`list` is optional. Sources that don't implement it (e.g. `url`) cause `rskills ls` to exit with `"Source '<scheme>' does not support listing"`. When `read` is called on a path that turns out to be a directory, it must throw `IsDirectory` with a message suggesting `rskills ls`.

`SkillSearchResult` shape: `{ scheme: string; identifier: string; name: string; installs?: number }`. The CLI maps `scheme` → `source` in output, so consumers see `{ identifier, name, installs?, source }`. There is no `description` field. `installs` is a real count from the skills.sh API; well-known results omit it.

The interactive live picker (`src/tui/search-picker.tsx`, using Ink/React) is skills-sh-only and launched from `src/cli.ts` when TTY conditions are met. The shared Effect runtime is extracted to `src/runtime-layer.ts` (`runtimeLayer`, `makeAppRuntime`). Ink, React, and ink-text-input are devDependencies bundled into `dist/cli.js`.

To add a new source:
1. Create `src/sources/my-source.ts`
2. Export a `SkillSource` object
3. Register it in `src/sources/registry.ts` (`allSources` array)

The runtime layer is defined in `src/runtime-layer.ts` (`runtimeLayer = Layer.mergeAll(FetchHttpClient.layer, SkillsShCacheLive, NodeContext.layer)`) — HTTP sources use `FetchHttpClient`; `claude` uses `NodeContext` from `@effect/platform-node` for `FileSystem` + `Path`. Merge additional services there as needed.

## Stack

- **Bun** — runtime + package manager (`packageManager: bun@1.1.0`)
- **incur** — CLI surface (zod schemas, structured output, TOON default). [Notes on incur](#incur-quirks) below.
- **Effect.ts** — services, tagged errors, runtime composition
- **`@effect/platform-node`** — portable Node runtime services (`NodeContext`) for filesystem, path, and command execution
- **`@effect/platform` `HttpClient`** — all HTTP goes through this
- **Biome** — format + lint
- **TypeScript strict**, path alias `#/*` → `src/*`
- **Published artifact** — single bundled `dist/cli.js` that runs under Node; npm ships `dist/`, and runtime libraries are build-time `devDependencies` because Bun bundles them into the output

## Coding principles

- No destructuring of objects — `obj.foo`, not `const { foo } = obj`
- No fake fallback values on error — throw tagged Effect errors and let the caller handle
- No global mutable state — wrap caches in Effect `Ref` services (see `skills-sh-cache.ts`)
- `Effect.gen` for sequencing, `Effect.fn("Name")` for traced spans
- `Effect.runPromise` only at the runtime edge (inside incur's `run` callbacks)

## Commands

```bash
bun install
bun run check:type   # tsc --noEmit
bun run check:lint   # biome check .
bun run check        # CI baseline: type + lint
bun run build        # bundle to single node-runnable dist/cli.js
bun run build:binaries  # compile standalone executables (--compile --bytecode) for darwin/linux
bun run src/cli.ts read github://anthropics/skills/skills/pdf
```

CI runs `.github/workflows/check.yml`: format-and-commit first, then `bun run check`.

## Incur quirks

Things that aren't obvious from incur's README:

- **`read` returns `z.string()`, not `z.object({...})`.** Scalar return values pass through every `--format` (md, toon, default) as raw text. Object returns get rendered as a key-value markdown table for `--format md`, which HTML-escapes content. If you ever wrap `read`'s output in an envelope, you'll break agent ergonomics.
- **Commands must be defined inline** in `cli.command('name', { ... })`. If you extract a command def to a const, TypeScript can't infer `c.args`/`c.options` types backwards through incur's generics — `c` becomes `any`. This is why everything lives in `src/cli.ts`.
- **`cli.serve()` argv handling is fragile.** When run via `bun src/cli.ts <args>`, `process.argv.slice(2)` starts with `src/cli.ts`, which incur interprets as a runtime/script token. The CLI manually strips `*.ts`/`*.js` from `argv[0]` before passing to `serve()` — see the comment at the bottom of `cli.ts`.
- **Build target.** Bun's bundler defaults to `browser`, which trips on `node:os` imports from incur. The `build` script uses `--target=node` so Node builtins stay external for the bundled `dist/cli.js`, and `build:binaries` uses `--target=bun-<os>-<arch>` for the standalone executables.
