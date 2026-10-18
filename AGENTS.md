# rskills

A Bun + Effect.ts CLI for reading remote [skills](https://agentskills.io/) without installing them. Built on [incur](https://github.com/wevm/incur) for the CLI surface.

## What it does

`<source>` is anything `npx skills add <source>` accepts (mirrors `vercel-labs/skills` `src/source-parser.ts`). A source may hold several skills; pick one with `@skill` or `--skill`, and a file inside it with `--file`.

- `rskills read <source>[@skill] [--skill <name>] [--file <path>] [--raw]` — print a skill file (default `SKILL.md`) to stdout. Frontmatter is stripped; `--raw` returns the literal file, no envelope, in any `--format`. A directory `--file` exits non-zero with `IsDirectory` pointing to `rskills ls`.
- `rskills ls <source>[@skill] [--skill <name>] [--file <dir>]` — structured `{ entries: [{ name, type }] }` (mirrors Anthropic's `ls`/`Glob`: `read` is files-only, `ls` is directories). On a multi-skill source with no selector it lists the skill names as `directory` entries instead of erroring.
- `rskills search [query] [--limit <n>]` — skills.sh search only; results are `{ identifier: "owner/repo@skill", name, installs?, source }`. On an interactive terminal (stdin + stdout both TTY, no `--format`/`--json`/`--token-*`) opens a live Ink picker: type to search (debounced 250 ms, race-safe via Effect fiber interruption), ↑/↓ to navigate, Enter for an action menu (read SKILL.md / copy identifier / copy install command / open on skills.sh), Esc to quit. Otherwise emits structured output (TOON by default); `query` is required there.

## Source parsing

`parseSource` (`src/source.ts`) turns the raw string into a `Source` tagged union (`GitHub | WellKnown | Url | Local | Claude`). First match wins:

1. `claude://<name>` — the only custom scheme; single segment.
2. Local path (`/`, `./`, `../`, `.`, `..`, `~`, `~/`) — resolved to absolute, `~` via `os.homedir()`.
3. `github:<x>` — recurse on `<x>`.
4. `git@`, `ssh://`, `git://`, `git+…` — `UnsupportedSource`.
5. `http(s)://`:
   - `github.com` → `GitHub` (`/<o>/<r>`, `/tree/<ref>[/<path>]`; `.git` stripped). The first segment after `tree` is the ref, so refs containing `/` aren't supported.
   - `raw.githubusercontent.com` with a `.md` pathname → `Url`.
   - `gitlab.com`, `bitbucket.org`, any other `raw.githubusercontent.com` URL, or a `*.git` path → `UnsupportedSource`.
   - pathname ends in `.md` → `Url`, fetched as-is.
   - anything else → `WellKnown` with `origin + pathname` (trailing slash stripped, query/hash dropped), so `https://fframes.studio` works like `npx skills add <url>`.
6. No `:` → GitHub shorthand `owner/repo[/sub/path][@skill]`.
7. Otherwise `ParseFailed`.

Subpaths containing `..` are rejected; `--file` goes through `normalizeRelativePath` (`src/sources/paths.ts`) which rejects absolute paths and `..`.

## Skill selection

`src/skills.ts` (`readSkill` / `listSkill`) runs: `parseSource` → `resolveSelector` → `discoverSkills` → `selectSkill` → `skill.read` / `skill.list`.

- Selector = `@skill` (GitHub shorthand only) merged with `--skill`; both given and different (case-insensitive) → `InvalidArgument`. `--skill` on `Url` / `Claude` sources → `InvalidArgument` (they are already one skill).
- Selector given: case-insensitive name match, else `NotFound` listing available names. No selector: exactly one skill is used; zero → `NotFound`; several → `InvalidArgument` listing names.
- Only `ls` with no selector and no `--file` on a multi-skill source skips selection and lists the skills.

## Providers

Each provider in `src/sources/` exports a `SkillSource` (`src/sources/source.ts`); `registry.ts` dispatches on `Source._tag`.

```ts
interface DiscoveredSkill {
  name: string
  read(file: Option<string>, options: { raw?: boolean }): Effect<string, SkillError, SkillEnv>
  list(dir: Option<string>): Effect<ReadonlyArray<SkillEntry>, SkillError, SkillEnv>
}
interface SkillSource<S extends Source> {
  discover(source: S, selector: Option<string>): Effect<ReadonlyArray<DiscoveredSkill>, SkillError, SkillEnv>
}
```

`discover` returns every skill the source holds; `read`/`list` are closures bound to wherever it found them, with paths relative to the skill directory. `selector` is only a hint to skip work — the caller does the final name match. `SkillSearchResult` (`{ scheme, identifier, name, installs? }`) lives in the same file; the CLI maps `scheme` → `source`.

To add a source: add a `Source` variant in `src/source.ts`, a provider in `src/sources/`, and a case in `registry.ts`. Reuse `file-set.ts` (skill held in memory) and `paths.ts` (`listFromFilePaths`, `isDirectoryOf`, `skillsFromDirectories`) so `IsDirectory` / `NotFound` behave the same everywhere.

### GitHub (`github.ts`)

One `GET api.github.com/repos/{o}/{r}/git/trees/{ref|HEAD}?recursive=1` gives every blob path; discovery and `ls` then run in memory, and `read` fetches `raw.githubusercontent.com/{o}/{r}/{ref}/{skillDir}/{file}`.

- Search root = subpath (or repo root). A `SKILL.md` directly at the root is the one skill (a subpath ending in `SKILL.md` is trimmed to its directory).
- Otherwise every `SKILL.md` under the root, skipping `node_modules`, `.git`, `dist`, `build`, `__pycache__`. Skill name = directory basename; on a clash the shallowest wins. A truncated tree is searched as-is.
- If the selector matches no directory name, candidates' `SKILL.md` frontmatter `name` is fetched and matched instead (`frontmatter.ts`).
- Tree API 404 → `NotFound`, 403/429 → `RateLimited`.
- **skills.sh download fallback** (`skills-sh-download.ts`): only on `RateLimited` *and* a selector. `GET https://skills.sh/api/download/{o}/{r}/{skill}` returns `{ files: [{ path, contents }] }` (skill-relative paths), served via `skillFromFileSet`. The endpoint is undocumented (found in `vercel-labs/skills` `src/blob.ts`), may serve a stale snapshot, and any non-200 or unparseable body yields `null`, surfacing the original `RateLimited`.

### Well-known (`well-known.ts`)

`fetchIndex` copies the probe order of `vercel-labs/skills` (`src/providers/wellknown.ts`); first valid index wins:

1. `{base}/.well-known/agent-skills/index.json`
2. `{origin}/.well-known/agent-skills/index.json` (only when the base has a path)
3. `{base}/.well-known/skills/index.json` (legacy)
4. `{origin}/.well-known/skills/index.json` (only when the base has a path)

Skills = index entries (name from the entry, not the URL); files are fetched from `{root}/{wellKnownPath}/{skill}/{file}`. `ls` needs the entry's `files[]` (else `NotFound`). Only the `files[]` model is supported, not the v0.2.0 `url`/archive entries.

### Local (`local.ts`) and Url (`url.ts`)

- `Local`: same discovery rules as GitHub but over `FileSystem` (root `SKILL.md`, else a recursive scan with the same skip list; symlink cycles guarded). Shared FS helpers in `local-fs.ts`.
- `Url`: one skill named after the file; `--file` and `ls` → `InvalidArgument`.

### Claude (`claude.ts`)

Reads via `effect` `FileSystem` + `Path`. `<name>` is looked up in `<cwd>/.claude/skills/<name>` then `~/.claude/skills/<name>`; first existing directory wins, and `NotFound` lists the probed paths. `--file` selects the file inside it. Plugin roots (`~/.claude/plugins/**/skills/`) and `claude://user/<name>` are not supported (see the comment in `claude.ts`).

Content goes through `claude-preprocess.ts` unless `--raw`:

- Executes inline `` !`cmd` `` (only when `!` is line-start or whitespace-prefixed; `KEY=!`cmd`` stays literal) and fenced ` ```! ` blocks; substitutes stdout once (no re-scan). Non-zero exit still substitutes stdout.
- The skill's `shell` frontmatter field selects `bash` (default) or `powershell`.
- `disableSkillShellExecution: true` in `<cwd>/.claude/settings.json` or `~/.claude/settings.json` turns commands into `[shell command execution disabled by policy]`.

YAML frontmatter stripping is applied to every source in `readSkill` (`src/frontmatter.ts`), not per provider.

## Search and TUI

`searchSkillsSh` (`src/sources/skills-sh.ts`) calls the skills.sh search API; it is the only search backend. The picker is `src/tui/search-picker.tsx` (Ink/React), launched from `src/cli.ts`. Its read action goes through `readSkill`; the install command is built locally as `npx skills add owner/repo --skill <skill>`.

The shared Effect runtime is `src/runtime-layer.ts` (`runtimeLayer = Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)`): HTTP providers use `HttpClient`, `Local`/`Claude` and the TUI use `FileSystem` + `Path` + `ChildProcessSpawner` (`effect/process`) from `NodeServices`. Ink, React, and ink-text-input are devDependencies bundled into `dist/cli.js`.

## Stack

- **pnpm** — package manager (`packageManager` in `package.json`)
- **Bun** — script runtime + bundler (`Bun.build`, standalone binaries)
- **incur** — CLI surface (zod schemas, structured output, TOON default). [Notes on incur](#incur-quirks) below.
- **Effect.ts v4** — services, tagged errors, runtime composition
- **`@effect/platform-node`** — portable Node runtime services (`NodeServices`) for filesystem, path, and child processes
- **`effect/http` `HttpClient`** — all HTTP goes through this
- **Biome** — format + lint
- **TypeScript strict**, path alias `#/*` → `src/*`
- **Published artifact** — single bundled `dist/cli.js` that runs under Node; npm ships `dist/`, and runtime libraries are build-time `devDependencies` because Bun bundles them into the output

## Coding principles

- No destructuring of objects — `obj.foo`, not `const { foo } = obj`
- No fake fallback values on error — throw tagged Effect errors and let the caller handle
- No global mutable state — if a cache is needed, wrap it in an Effect `Ref` service
- `Effect.gen` for sequencing, `Effect.fn("Name")` for traced spans
- `Effect.runPromise` only at the runtime edge (inside incur's `run` callbacks)

## Commands

```bash
pnpm install
pnpm run check:type   # tsc --noEmit
pnpm run check:lint   # biome check .
pnpm run check        # CI baseline: type + lint
pnpm run build        # bundle to single node-runnable dist/cli.js
pnpm run build:binaries  # compile standalone executables (--compile --bytecode) for darwin/linux
bun run src/cli.ts read anthropics/skills@pdf
```

CI runs `.github/workflows/check.yml`: format-and-commit first, then `pnpm run check`.

## Incur quirks

Things that aren't obvious from incur's README:

- **`read` returns `z.string()`, not `z.object({...})`.** Scalar return values pass through every `--format` (md, toon, default) as raw text. Object returns get rendered as a key-value markdown table for `--format md`, which HTML-escapes content. If you ever wrap `read`'s output in an envelope, you'll break agent ergonomics.
- **Commands must be defined inline** in `cli.command('name', { ... })`. If you extract a command def to a const, TypeScript can't infer `c.args`/`c.options` types backwards through incur's generics — `c` becomes `any`. This is why everything lives in `src/cli.ts`.
- **`cli.serve()` argv handling is fragile.** When run via `bun src/cli.ts <args>`, `process.argv.slice(2)` starts with `src/cli.ts`, which incur interprets as a runtime/script token. The CLI manually strips `*.ts`/`*.js` from `argv[0]` before passing to `serve()` — see the comment at the bottom of `cli.ts`.
- **Build target.** Bun's bundler defaults to `browser`, which trips on `node:os` imports from incur. The `build` script uses `--target=node` so Node builtins stay external for the bundled `dist/cli.js`, and `build:binaries` uses `--target=bun-<os>-<arch>` for the standalone executables.
