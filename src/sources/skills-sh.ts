import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Duration, Effect, Option, Ref } from "effect"
import { FetchFailed, IsDirectory, NotFound, ParseFailed, RateLimited } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import { serialize } from "#/uri.js"
import { SkillsShCache } from "./skills-sh-cache.js"
import type { SkillEntry, SkillSearchResult, SkillSource } from "./source.js"

function createClient(baseUrl: string) {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		return client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)))
	})
}

const skillsShClient = createClient("https://skills.sh/api")

type GitHubContentsItem = {
	name: string
	type: "file" | "dir" | "symlink" | "submodule"
}

function fetchGitHubContents(
	owner: string,
	repo: string,
	contentsPath: string,
): Effect.Effect<
	ReadonlyArray<GitHubContentsItem> | GitHubContentsItem,
	FetchFailed | NotFound | RateLimited,
	HttpClient.HttpClient
> {
	return Effect.gen(function* () {
		const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}`
		const client = yield* HttpClient.HttpClient
		const response = yield* client
			.get(url, {
				headers: { Accept: "application/vnd.github+json" },
			})
			.pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${url}`,
							cause: error,
						}),
				),
			)

		if (response.status === 404) {
			return yield* new NotFound({ message: `Not found: ${url}` })
		}

		if (response.status === 403) {
			return yield* new RateLimited({ message: `GitHub rate limit hit for ${url}` })
		}

		if (response.status !== 200) {
			return yield* new FetchFailed({
				message: `Failed to fetch ${url}: HTTP ${response.status}`,
				cause: response,
			})
		}

		const json = yield* response.json.pipe(
			Effect.catchAll(
				(error) =>
					new FetchFailed({
						message: `Failed to parse GitHub Contents API response from ${url}`,
						cause: error,
					}),
			),
		)

		return json as ReadonlyArray<GitHubContentsItem> | GitHubContentsItem
	})
}

/**
 * Probe the four candidate raw roots to find where a skills-sh skill lives.
 * Returns the resolved raw root URL (no trailing slash) and the extracted
 * owner/repo for Contents API calls.
 */
function resolveSkillsShRoot(
	owner: string,
	repo: string,
	skillPath: string,
	cache: Ref.Ref<Map<string, string>>,
	cacheKey: string,
): Effect.Effect<
	{ rawRoot: string; ghOwner: string; ghRepo: string; ghSkillPath: string },
	FetchFailed | NotFound,
	HttpClient.HttpClient
> {
	return Effect.gen(function* () {
		const cached = (yield* Ref.get(cache)).get(cacheKey)
		if (cached !== undefined) {
			// Derive ghOwner/ghRepo/ghSkillPath from the cached root URL
			// Format: https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{rest}
			const rawPrefix = "https://raw.githubusercontent.com/"
			const afterPrefix = cached.slice(rawPrefix.length)
			const parts = afterPrefix.split("/")
			const ghOwner = parts[0] ?? owner
			const ghRepo = parts[1] ?? repo
			// parts[2] is "HEAD", parts[3..] is the skill path prefix
			const ghSkillPath = parts.slice(3).join("/")
			return { rawRoot: cached, ghOwner, ghRepo, ghSkillPath }
		}

		const candidates = [
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/skills/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.agents/skills/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.claude/skills/${skillPath}`,
		]

		const client = yield* HttpClient.HttpClient

		for (const candidate of candidates) {
			const probeUrl = `${candidate}/SKILL.md`
			const response = yield* client.get(probeUrl).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to probe ${probeUrl}`,
							cause: error,
						}),
				),
			)

			if (response.status === 200) {
				yield* Ref.update(cache, (map) => {
					const next = new Map(map)
					next.set(cacheKey, candidate)
					return next
				})
				const rawPrefix = "https://raw.githubusercontent.com/"
				const afterPrefix = candidate.slice(rawPrefix.length)
				const parts = afterPrefix.split("/")
				const ghOwner = parts[0] ?? owner
				const ghRepo = parts[1] ?? repo
				const ghSkillPath = parts.slice(3).join("/")
				return { rawRoot: candidate, ghOwner, ghRepo, ghSkillPath }
			}

			if (response.status === 404) {
				continue
			}

			return yield* new FetchFailed({
				message: `Failed to probe ${probeUrl}: HTTP ${response.status}`,
				cause: response,
			})
		}

		return yield* new NotFound({ message: `Skill not found via skills-sh: ${skillPath}` })
	})
}

export const SkillsShSource: SkillSource = {
	scheme: "skills-sh",

	search: Effect.fn("SkillsShSource.search")(function* (query: string, limit: number) {
		const client = yield* skillsShClient
		const response = yield* client
			.get("/search", {
				urlParams: { q: query, limit: String(limit) },
			})
			.pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: "Search request failed",
							cause: error,
						}),
				),
			)

		if (response.status !== 200) {
			return yield* new FetchFailed({
				message: `Search failed with status ${response.status}`,
				cause: response,
			})
		}

		const json = yield* response.json.pipe(
			Effect.catchAll(
				(error) =>
					new ParseFailed({
						message: "Failed to parse search response JSON",
						cause: error,
					}),
			),
		)

		if (!Array.isArray((json as Record<string, unknown>).skills)) {
			return yield* new ParseFailed({
				message: "Invalid search response: expected skills array",
				cause: json,
			})
		}

		const skills = (
			json as {
				skills: Array<{ id: string; source: string; installs: number }>
			}
		).skills
		return skills
			.filter(
				(result): result is { id: string; source: string; installs: number } =>
					typeof result.id === "string" &&
					typeof result.source === "string" &&
					typeof result.installs === "number",
			)
			.map(
				(result): SkillSearchResult => ({
					scheme: "skills-sh",
					identifier: result.id,
					description: `Indexed by skills.sh from ${result.source} (${result.installs} installs)`,
				}),
			)
	}),

	read: Effect.fn("SkillsShSource.read")(function* (uri: ParsedUri) {
		const segments = uri.identifier.split("/")
		if (segments.length < 3) {
			return yield* new NotFound({
				message: `Invalid skills-sh identifier: ${uri.identifier}`,
			})
		}

		const owner = segments[0] ?? ""
		const repo = segments[1] ?? ""
		const skillPath = segments.slice(2).join("/")
		const subpathOrSkillMd = Option.isSome(uri.subpath) ? uri.subpath.value : "SKILL.md"

		const cache = yield* SkillsShCache
		const resolvedRootCache = yield* Ref.get(cache)
		const cachedRoot = resolvedRootCache.get(uri.identifier)
		const client = yield* HttpClient.HttpClient

		if (cachedRoot !== undefined) {
			const url = `${cachedRoot}/${subpathOrSkillMd}`
			const response = yield* client.get(url).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${url}`,
							cause: error,
						}),
				),
			)

			if (response.status === 200) {
				return yield* response.text.pipe(
					Effect.catchAll(
						(error) =>
							new FetchFailed({
								message: `Failed to read response body from ${url}`,
								cause: error,
							}),
					),
				)
			}

			if (response.status === 404) {
				// Check if it's a directory via Contents API
				const rawPrefix = "https://raw.githubusercontent.com/"
				const afterPrefix = cachedRoot.slice(rawPrefix.length)
				const parts = afterPrefix.split("/")
				const ghOwner = parts[0] ?? owner
				const ghRepo = parts[1] ?? repo
				const ghSkillPath = parts.slice(3).join("/")
				const contentsPath = [ghSkillPath, subpathOrSkillMd].filter(Boolean).join("/")
				const contentsResult = yield* fetchGitHubContents(ghOwner, ghRepo, contentsPath).pipe(
					Effect.catchTag("NotFound", (_) => Effect.succeed(null)),
					Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
					Effect.catchTag("FetchFailed", (e) => Effect.fail(e)),
				)
				if (contentsResult !== null && Array.isArray(contentsResult)) {
					return yield* new IsDirectory({
						message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
					})
				}
				return yield* new NotFound({
					message: `Skill not found: ${uri.identifier}`,
				})
			}

			return yield* new FetchFailed({
				message: `Failed to fetch ${url}: HTTP ${response.status}`,
				cause: response,
			})
		}

		const candidates = [
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/skills/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.agents/skills/${skillPath}`,
			`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.claude/skills/${skillPath}`,
		]

		for (const candidate of candidates) {
			const url = `${candidate}/${subpathOrSkillMd}`
			const response = yield* client.get(url).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${url}`,
							cause: error,
						}),
				),
			)

			if (response.status === 200) {
				yield* Ref.update(cache, (map) => {
					const next = new Map(map)
					next.set(uri.identifier, candidate)
					return next
				})
				return yield* response.text.pipe(
					Effect.catchAll(
						(error) =>
							new FetchFailed({
								message: `Failed to read response body from ${url}`,
								cause: error,
							}),
					),
				)
			}

			if (response.status === 404) {
				continue
			}

			return yield* new FetchFailed({
				message: `Failed to fetch ${url}: HTTP ${response.status}`,
				cause: response,
			})
		}

		// All candidates 404'd — check if it's a directory
		// Try the first candidate path structure via Contents API
		const contentsPath = skillPath
		const contentsResult = yield* fetchGitHubContents(owner, repo, contentsPath).pipe(
			Effect.catchTag("NotFound", (_) => Effect.succeed(null)),
			Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
			Effect.catchTag("FetchFailed", (_) => Effect.succeed(null)),
		)
		if (contentsResult !== null && Array.isArray(contentsResult)) {
			return yield* new IsDirectory({
				message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
			})
		}

		return yield* new NotFound({
			message: `Skill not found: ${uri.identifier}`,
		})
	}),

	list: Effect.fn("SkillsShSource.list")(function* (uri: ParsedUri) {
		const segments = uri.identifier.split("/")
		if (segments.length < 3) {
			return yield* new NotFound({
				message: `Invalid skills-sh identifier: ${uri.identifier}`,
			})
		}

		const owner = segments[0] ?? ""
		const repo = segments[1] ?? ""
		const skillPath = segments.slice(2).join("/")
		const cache = yield* SkillsShCache

		const { ghOwner, ghRepo, ghSkillPath } = yield* resolveSkillsShRoot(
			owner,
			repo,
			skillPath,
			cache,
			uri.identifier,
		)

		const subpathPart = Option.isSome(uri.subpath) ? uri.subpath.value : undefined
		const contentsPath = subpathPart
			? [ghSkillPath, subpathPart].filter(Boolean).join("/")
			: ghSkillPath

		const result = yield* fetchGitHubContents(ghOwner, ghRepo, contentsPath)

		if (!Array.isArray(result)) {
			return yield* new NotFound({
				message: `${serialize(uri)} is a file, not a directory. Use 'rskills read' to read it.`,
			})
		}

		return result.map(
			(item): SkillEntry => ({
				name: item.name,
				type: item.type === "dir" ? "directory" : "file",
			}),
		)
	}),
}
