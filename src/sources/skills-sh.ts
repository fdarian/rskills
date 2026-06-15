import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Duration, Effect, Option, Ref } from "effect"
import { FetchFailed, IsDirectory, NotFound, ParseFailed, RateLimited } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import { serialize } from "#/uri.js"
import { type ResolvedSkillRoot, SkillsShCache } from "./skills-sh-cache.js"
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

type GitHubRawCandidate = {
	baseUrl: string
	prefix: string
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
 * Step 1: Probe the four candidate GitHub raw roots to find where a skills-sh
 * skill lives. Returns a BaseUrl root if found, or null if all 404.
 */
function createGitHubRawCandidates(
	owner: string,
	repo: string,
	skillPath: string,
): ReadonlyArray<GitHubRawCandidate> {
	const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`
	return [
		{
			baseUrl: `${rawBaseUrl}/${skillPath}`,
			prefix: "",
		},
		{
			baseUrl: `${rawBaseUrl}/skills/${skillPath}`,
			prefix: "skills",
		},
		{
			baseUrl: `${rawBaseUrl}/.agents/skills/${skillPath}`,
			prefix: ".agents/skills",
		},
		{
			baseUrl: `${rawBaseUrl}/.claude/skills/${skillPath}`,
			prefix: ".claude/skills",
		},
	]
}

function isValidSymlinkTarget(target: string): boolean {
	if (target.length === 0) {
		return false
	}

	if (target.startsWith("/")) {
		return false
	}

	if (target.includes("\\")) {
		return false
	}

	if (target.includes("?")) {
		return false
	}

	if (target.includes("#")) {
		return false
	}

	if (target.includes("://")) {
		return false
	}

	for (const char of target) {
		if (/\s/u.test(char) || /\p{C}/u.test(char)) {
			return false
		}
	}

	const segments = target.split("/")
	for (const segment of segments) {
		if (segment.length === 0) {
			return false
		}

		if (segment === "..") {
			return false
		}

		if (!/^[\w.-]+$/u.test(segment)) {
			return false
		}
	}

	return true
}

const fetchRawText = Effect.fn("fetchRawText")(
	(url: string): Effect.Effect<string | null, FetchFailed, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
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

			if (response.status === 404) {
				return null
			}

			if (response.status !== 200) {
				return yield* new FetchFailed({
					message: `Failed to fetch ${url}: HTTP ${response.status}`,
					cause: response,
				})
			}

			const text = yield* response.text.pipe(
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to read response body from ${url}`,
							cause: error,
						}),
				),
			)

			return text
		}),
)

const tryGitHubRawProbe = Effect.fn("tryGitHubRawProbe")(
	(
		owner: string,
		repo: string,
		skillPath: string,
	): Effect.Effect<BaseUrlSkillRoot | null, FetchFailed, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const candidates = createGitHubRawCandidates(owner, repo, skillPath)
			for (const candidate of candidates) {
				const probeUrl = `${candidate.baseUrl}/SKILL.md`
				const probeResult = yield* fetchRawText(probeUrl)
				if (probeResult === null) {
					continue
				}

				return { _tag: "BaseUrl" as const, baseUrl: candidate.baseUrl }
			}

			const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`

			for (const candidate of candidates) {
				if (candidate.prefix.length === 0) {
					continue
				}

				const symlinkProbeUrl = `${rawBaseUrl}/${candidate.prefix}`
				const symlinkTarget = yield* fetchRawText(symlinkProbeUrl)
				if (symlinkTarget === null) {
					continue
				}

				const trimmedTarget = symlinkTarget.trim()
				if (!isValidSymlinkTarget(trimmedTarget)) {
					continue
				}

				const resolvedBaseUrl = `${rawBaseUrl}/${trimmedTarget}/${skillPath}`
				const resolvedProbeUrl = `${resolvedBaseUrl}/SKILL.md`
				const resolvedResult = yield* fetchRawText(resolvedProbeUrl)
				if (resolvedResult === null) {
					continue
				}

				return { _tag: "BaseUrl" as const, baseUrl: resolvedBaseUrl }
			}

			return null
		}),
)

/**
 * Step 2: Try fetching SKILL.md from unpkg using the npm package name from
 * the repo's package.json. Returns a BaseUrl root if found, or null if
 * package.json is missing / not parseable / unpkg returns 404.
 */
const tryUnpkgFallback = Effect.fn("tryUnpkgFallback")(
	(
		owner: string,
		repo: string,
	): Effect.Effect<BaseUrlSkillRoot | null, FetchFailed, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient

			const pkgJsonUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`
			const pkgResponse = yield* client.get(pkgJsonUrl).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${pkgJsonUrl}`,
							cause: error,
						}),
				),
			)

			if (pkgResponse.status !== 200) {
				return null
			}

			const pkgJson = yield* pkgResponse.json.pipe(Effect.catchAll(() => Effect.succeed(null)))

			if (
				pkgJson === null ||
				typeof pkgJson !== "object" ||
				typeof (pkgJson as Record<string, unknown>).name !== "string"
			) {
				return null
			}

			const packageName = (pkgJson as { name: string }).name
			const unpkgBase = `https://unpkg.com/${packageName}@latest`
			const skillMdUrl = `${unpkgBase}/SKILL.md`

			const unpkgResponse = yield* client.get(skillMdUrl).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${skillMdUrl}`,
							cause: error,
						}),
				),
			)

			if (unpkgResponse.status === 200) {
				return { _tag: "BaseUrl" as const, baseUrl: unpkgBase }
			}

			return null
		}),
)

/**
 * Extract the `npx skills add ...` install command from the skills.sh detail
 * page HTML. Returns the command string or null if not found.
 *
 * Note: skills.sh uses Next.js App Router — SKILL.md content is rendered as
 * HTML, not embedded as raw markdown. Only the install command can be reliably
 * extracted; raw SKILL.md content cannot be recovered from this page.
 */
const extractInstallCommand = Effect.fn("extractInstallCommand")(
	(
		owner: string,
		repo: string,
		skillId: string,
	): Effect.Effect<string | null, FetchFailed, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const pageUrl = `https://www.skills.sh/${owner}/${repo}/${skillId}`

			const response = yield* client.get(pageUrl).pipe(
				Effect.timeout(Duration.seconds(20)),
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to fetch ${pageUrl}`,
							cause: error,
						}),
				),
			)

			if (response.status !== 200) {
				return null
			}

			const html = yield* response.text.pipe(
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to read response body from ${pageUrl}`,
							cause: error,
						}),
				),
			)

			const match = html.match(
				/npx\s+skills\s+add\s+(?:https?:\/\/github\.com\/[^\s<"]+)(?:\s+--skill\s+[^\s<"]+)?/i,
			)
			if (match !== null) {
				return match[0]
			}

			return null
		}),
)

/**
 * Step 3: Scrape the skills.sh detail page to extract the install command for
 * use in error messages. Does not recover SKILL.md content (the page renders
 * it as HTML only, not as raw markdown).
 */
const tryScrapeDetailPage = Effect.fn("tryScrapeDetailPage")(
	(
		owner: string,
		repo: string,
		skillId: string,
	): Effect.Effect<string | null, FetchFailed, HttpClient.HttpClient> =>
		extractInstallCommand(owner, repo, skillId),
)

type BaseUrlSkillRoot = { readonly _tag: "BaseUrl"; readonly baseUrl: string }

type BaseUrlRoot = BaseUrlSkillRoot & {
	ghOwner: string
	ghRepo: string
	ghSkillPath: string
}

/**
 * Resolve the root for a skills-sh skill using a 3-step cascade:
 * 1. GitHub raw probe (4 candidates)
 * 2. unpkg fallback (via package.json name)
 * 3. skills.sh detail page (install command extraction for error only)
 *
 * Used by `list` which always needs a BaseUrl root with GitHub metadata.
 * Caches the result in SkillsShCache.
 */
function resolveSkillsShRoot(
	owner: string,
	repo: string,
	skillPath: string,
	skillId: string,
	cache: Ref.Ref<Map<string, ResolvedSkillRoot>>,
	cacheKey: string,
): Effect.Effect<BaseUrlRoot, FetchFailed | NotFound, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const cached = (yield* Ref.get(cache)).get(cacheKey)
		if (cached !== undefined && cached._tag === "BaseUrl") {
			return baseUrlRootWithGh(cached.baseUrl, owner, repo)
		}

		// Step 1: GitHub raw probe
		const githubResult = yield* tryGitHubRawProbe(owner, repo, skillPath)
		if (githubResult !== null) {
			yield* Ref.update(cache, (map) => {
				const next = new Map(map)
				next.set(cacheKey, githubResult)
				return next
			})
			return baseUrlRootWithGh(githubResult.baseUrl, owner, repo)
		}

		// Step 2: unpkg fallback
		const unpkgResult = yield* tryUnpkgFallback(owner, repo)
		if (unpkgResult !== null) {
			yield* Ref.update(cache, (map) => {
				const next = new Map(map)
				next.set(cacheKey, unpkgResult)
				return next
			})
			// unpkg base URL doesn't map to GitHub Contents API — keep original owner/repo/skillPath
			return {
				_tag: "BaseUrl" as const,
				baseUrl: unpkgResult.baseUrl,
				ghOwner: owner,
				ghRepo: repo,
				ghSkillPath: skillPath,
			}
		}

		// Step 3: scrape for install command, then error
		const installCommand = yield* tryScrapeDetailPage(owner, repo, skillId).pipe(
			Effect.catchTag("FetchFailed", () => Effect.succeed(null)),
		)

		const identifier = `${owner}/${repo}/${skillId}`
		if (installCommand !== null) {
			return yield* new NotFound({
				message: `Skill '${identifier}' not found via GitHub raw, unpkg, or skills.sh content extraction. Install command (from skills.sh): ${installCommand}`,
			})
		}

		return yield* new NotFound({
			message: `Skill '${identifier}' not found via GitHub raw, unpkg, or skills.sh content extraction.`,
		})
	})
}

function baseUrlRootWithGh(baseUrl: string, owner: string, repo: string): BaseUrlRoot {
	const rawPrefix = "https://raw.githubusercontent.com/"
	if (baseUrl.startsWith(rawPrefix)) {
		const afterPrefix = baseUrl.slice(rawPrefix.length)
		const parts = afterPrefix.split("/")
		const ghOwner = parts[0] ?? owner
		const ghRepo = parts[1] ?? repo
		// parts[2] is the branch (HEAD), parts[3..] is the skill path prefix
		const ghSkillPath = parts.slice(3).join("/")
		return { _tag: "BaseUrl" as const, baseUrl, ghOwner, ghRepo, ghSkillPath }
	}
	// Non-GitHub root (e.g. unpkg): fall back to original owner/repo, no skill subpath
	return { _tag: "BaseUrl" as const, baseUrl, ghOwner: owner, ghRepo: repo, ghSkillPath: "" }
}

function fetchFromBaseUrl(
	baseUrl: string,
	subpathOrSkillMd: string,
): Effect.Effect<string, FetchFailed | NotFound, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const url = `${baseUrl}/${subpathOrSkillMd}`
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
			return yield* new NotFound({ message: `Not found: ${url}` })
		}

		return yield* new FetchFailed({
			message: `Failed to fetch ${url}: HTTP ${response.status}`,
			cause: response,
		})
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
				skills: Array<{ id: string; name: string; source: string; installs: number }>
			}
		).skills
		return skills
			.filter(
				(result): result is { id: string; name: string; source: string; installs: number } =>
					typeof result.id === "string" &&
					typeof result.name === "string" &&
					typeof result.source === "string" &&
					typeof result.installs === "number",
			)
			.map(
				(result): SkillSearchResult => ({
					scheme: "skills-sh",
					identifier: result.id,
					name: result.name,
					installs: result.installs,
				}),
			)
	}),

	read: Effect.fn("SkillsShSource.read")(function* (
		uri: ParsedUri,
		_options?: import("./source.js").SkillReadOptions,
	) {
		const segments = uri.identifier.split("/")
		if (segments.length < 3) {
			return yield* new NotFound({
				message: `Invalid skills-sh identifier: ${uri.identifier}`,
			})
		}

		const owner = segments[0] ?? ""
		const repo = segments[1] ?? ""
		const skillPath = segments.slice(2).join("/")
		const skillId = segments[segments.length - 1] ?? skillPath
		const subpathOrSkillMd = Option.isSome(uri.subpath) ? uri.subpath.value : "SKILL.md"

		const cache = yield* SkillsShCache
		const cachedRoot = (yield* Ref.get(cache)).get(uri.identifier)

		if (cachedRoot !== undefined) {
			if (cachedRoot._tag === "Content") {
				// Content-kind: only SKILL.md is available
				if (subpathOrSkillMd === "SKILL.md") {
					return cachedRoot.content
				}
				return yield* new NotFound({
					message:
						"This skill is dynamically generated; only SKILL.md is available via rskills (skills-sh detail page).",
				})
			}

			// BaseUrl-kind: fetch from the resolved base URL
			const result = yield* fetchFromBaseUrl(cachedRoot.baseUrl, subpathOrSkillMd).pipe(
				Effect.catchTag("NotFound", (notFound) =>
					Effect.gen(function* () {
						// Check if it might be a directory (only for GitHub raw roots)
						const rawPrefix = "https://raw.githubusercontent.com/"
						if (cachedRoot.baseUrl.startsWith(rawPrefix)) {
							const root = baseUrlRootWithGh(cachedRoot.baseUrl, owner, repo)
							const contentsPath = [root.ghSkillPath, subpathOrSkillMd].filter(Boolean).join("/")
							const contentsResult = yield* fetchGitHubContents(
								root.ghOwner,
								root.ghRepo,
								contentsPath,
							).pipe(
								Effect.catchTag("NotFound", () => Effect.succeed(null)),
								Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
								Effect.catchTag("FetchFailed", (e) => Effect.fail(e)),
							)
							if (contentsResult !== null && Array.isArray(contentsResult)) {
								return yield* new IsDirectory({
									message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
								})
							}
						}
						return yield* Effect.fail(notFound)
					}),
				),
			)
			return result
		}

		// No cache — run the full cascade

		// Step 1: GitHub raw probe
		const githubResult = yield* tryGitHubRawProbe(owner, repo, skillPath)
		if (githubResult !== null) {
			yield* Ref.update(cache, (map) => {
				const next = new Map(map)
				next.set(uri.identifier, githubResult)
				return next
			})
			const result = yield* fetchFromBaseUrl(githubResult.baseUrl, subpathOrSkillMd).pipe(
				Effect.catchTag("NotFound", () =>
					Effect.gen(function* () {
						// Check if it might be a directory
						const root = baseUrlRootWithGh(githubResult.baseUrl, owner, repo)
						const contentsPath = [root.ghSkillPath, subpathOrSkillMd].filter(Boolean).join("/")
						const contentsResult = yield* fetchGitHubContents(
							root.ghOwner,
							root.ghRepo,
							contentsPath,
						).pipe(
							Effect.catchTag("NotFound", () => Effect.succeed(null)),
							Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
							Effect.catchTag("FetchFailed", () => Effect.succeed(null)),
						)
						if (contentsResult !== null && Array.isArray(contentsResult)) {
							return yield* new IsDirectory({
								message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
							})
						}
						return yield* new NotFound({ message: `Skill not found: ${uri.identifier}` })
					}),
				),
			)
			return result
		}

		// Step 2: unpkg fallback
		const unpkgResult = yield* tryUnpkgFallback(owner, repo)
		if (unpkgResult !== null) {
			yield* Ref.update(cache, (map) => {
				const next = new Map(map)
				next.set(uri.identifier, unpkgResult)
				return next
			})
			const result = yield* fetchFromBaseUrl(unpkgResult.baseUrl, subpathOrSkillMd).pipe(
				Effect.catchTag(
					"NotFound",
					() => new NotFound({ message: `Skill not found: ${uri.identifier}` }),
				),
			)
			return result
		}

		// Step 3: scrape detail page for install command, then error
		const installCommand = yield* tryScrapeDetailPage(owner, repo, skillId).pipe(
			Effect.catchTag("FetchFailed", () => Effect.succeed(null)),
		)

		// Also check if the path is a directory before erroring
		const contentsResult = yield* fetchGitHubContents(owner, repo, skillPath).pipe(
			Effect.catchTag("NotFound", () => Effect.succeed(null)),
			Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
			Effect.catchTag("FetchFailed", () => Effect.succeed(null)),
		)
		if (contentsResult !== null && Array.isArray(contentsResult)) {
			return yield* new IsDirectory({
				message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
			})
		}

		const identifier = uri.identifier
		if (installCommand !== null) {
			return yield* new NotFound({
				message: `Skill '${identifier}' not found via GitHub raw, unpkg, or skills.sh content extraction. Install command (from skills.sh): ${installCommand}`,
			})
		}

		return yield* new NotFound({
			message: `Skill '${identifier}' not found via GitHub raw, unpkg, or skills.sh content extraction.`,
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
		const skillId = segments[segments.length - 1] ?? skillPath
		const cache = yield* SkillsShCache

		const resolvedRoot = yield* resolveSkillsShRoot(
			owner,
			repo,
			skillPath,
			skillId,
			cache,
			uri.identifier,
		)

		// If resolved via unpkg, GitHub Contents API may not correspond to the
		// npm package layout — but we can still try using the original owner/repo.
		const subpathPart = Option.isSome(uri.subpath) ? uri.subpath.value : undefined
		const contentsPath = subpathPart
			? [resolvedRoot.ghSkillPath, subpathPart].filter(Boolean).join("/")
			: resolvedRoot.ghSkillPath

		const result = yield* fetchGitHubContents(
			resolvedRoot.ghOwner,
			resolvedRoot.ghRepo,
			contentsPath,
		)

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
