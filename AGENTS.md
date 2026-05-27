# rskills

A Bun + Effect.ts CLI for reading remote Anthropic-style skills without installing them. Built on [incur](https://github.com/wevm/incur) for the CLI surface.

## What it does

- `rskills read <uri>` — fetch a skill file and print **raw markdown** to stdout (no envelope, in any `--format`). Reading a directory URI exits non-zero with an `IsDirectory` message pointing to `rskills ls`.
- `rskills ls <uri>` — list entries in a skill directory; returns structured `{ entries: [{ name, type }] }` (mirrors Anthropic's `ls`/`Glob` tools — `read` is files-only, `ls` is directories)
- `rskills search <query> [--source <name>] [--limit <n>]` — search skills; returns structured TOON by default, switchable via `--format json|yaml|md|jsonl`

## URI scheme

`<source>://<identifier>[/<subpath>]`

| Source | Identifier | Search? | Read? | List? |
|---|---|---|---|---|
| `skills-sh` | `<owner>/<repo>/<skill-path>` | ✓ (skills.sh API) | ✓ (resolves to GitHub raw, multi-candidate probe) | ✓ (GitHub Contents API against resolved root) |
| `github` | `<owner>/<repo>/<path>` | — | ✓ (raw.githubusercontent.com) | ✓ (GitHub Contents API) |
| `well-known` | `<host-or-base-url>` | ✓ (fetches `/.well-known/skills/index.json`) | ✓ | ✓ (derives from `files` array in index; `NotFound` if no `files`) |
| `https` | full `https://…md` URL | — | ✓ (must end in `.md`) | — |

## Subpath rules

The boundary between `identifier` and `subpath` is detected heuristically in `src/uri.ts`:

1. If any segment matches `references | scripts | templates | assets | SKILL.md`, split there (handles `pdf/references/foo.md`).
2. Else if the **last segment has a file extension** (`/\.\w+$/`), it's the subpath (handles top-level siblings like `pdf/reference.md`).
3. Otherwise the whole path is the identifier and `SKILL.md` is fetched.

`https://` URIs skip subpath detection — the URL is fetched as-is.

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
    HttpClient.HttpClient | SkillsShCache
  >
  search?: (query: string, limit: number) => Effect.Effect<
    SkillSearchResult[],
    FetchFailed | ParseFailed,
    HttpClient.HttpClient
  >
  list?: (uri: ParsedUri) => Effect.Effect<
    ReadonlyArray<SkillEntry>,
    FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument,
    HttpClient.HttpClient | SkillsShCache
  >
}
```

`list` is optional. Sources that don't implement it (e.g. `url`) cause `rskills ls` to exit with `"Source '<scheme>' does not support listing"`. When `read` is called on a path that turns out to be a directory, it must throw `IsDirectory` with a message suggesting `rskills ls`.

To add a new source:
1. Create `src/sources/my-source.ts`
2. Export a `SkillSource` object
3. Register it in `src/sources/registry.ts` (`allSources` array)

The runtime layer in `src/cli.ts` is `Layer.merge(FetchHttpClient.layer, SkillsShCacheLive)`. If a new source needs its own service (cache, auth, etc.), merge it in there.

## Stack

- **Bun** — runtime + package manager (`packageManager: bun@1.1.0`)
- **incur** — CLI surface (zod schemas, structured output, TOON default). [Notes on incur](#incur-quirks) below.
- **Effect.ts** — services, tagged errors, runtime composition
- **`@effect/platform` `HttpClient`** — all HTTP goes through this
- **Biome** — format + lint
- **TypeScript strict**, path alias `#/*` → `src/*`

## Coding principles

- No destructuring of objects — `obj.foo`, not `const { foo } = obj`
- No fake fallback values on error — throw tagged Effect errors and let the caller handle
- No global mutable state — wrap caches in Effect `Ref` services (see `skills-sh-cache.ts`)
- `Effect.gen` for sequencing, `Effect.fn("Name")` for traced spans
- `Effect.runPromise` only at the runtime edge (inside incur's `run` callbacks)

## Commands

```bash
bun install
bun run typecheck    # tsc --noEmit
bunx biome check .   # lint + format
bun run build        # bun build --target=bun (REQUIRED — default browser target fails on `node:os`)
bun run src/cli.ts read github://anthropics/skills/skills/pdf
```

## Incur quirks

Things that aren't obvious from incur's README:

- **`read` returns `z.string()`, not `z.object({...})`.** Scalar return values pass through every `--format` (md, toon, default) as raw text. Object returns get rendered as a key-value markdown table for `--format md`, which HTML-escapes content. If you ever wrap `read`'s output in an envelope, you'll break agent ergonomics.
- **Commands must be defined inline** in `cli.command('name', { ... })`. If you extract a command def to a const, TypeScript can't infer `c.args`/`c.options` types backwards through incur's generics — `c` becomes `any`. This is why everything lives in `src/cli.ts`.
- **`cli.serve()` argv handling is fragile.** When run via `bun src/cli.ts <args>`, `process.argv.slice(2)` starts with `src/cli.ts`, which incur interprets as a runtime/script token. The CLI manually strips `*.ts`/`*.js` from `argv[0]` before passing to `serve()` — see the comment at the bottom of `cli.ts`.
- **Build target.** Bun's bundler defaults to `browser`, which trips on `node:os` imports from incur. The `build` script has `--target=bun` for this reason.
