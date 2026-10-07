import { HttpClient } from "@effect/platform"
import { Duration, Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound, ParseFailed } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import { serialize } from "#/uri.js"
import type { SkillEntry, SkillSearchResult, SkillSource } from "./source.js"

function buildBaseUrl(identifier: string): string {
	if (identifier.startsWith("http://") || identifier.startsWith("https://")) {
		return identifier
	}
	return `https://${identifier}`
}

/** Last path segment of the identifier URL; undefined for a bare host. */
function getSkillName(identifier: string): string | undefined {
	const segments = new URL(buildBaseUrl(identifier)).pathname.split("/").filter((s) => s.length > 0)
	return segments[segments.length - 1]
}

// Order mirrors vercel-labs/skills (src/providers/wellknown.ts): agent-skills first, legacy skills second.
const wellKnownPaths = [".well-known/agent-skills", ".well-known/skills"] as const

type WellKnownIndex = { skills: Array<{ name: string; description?: string; files?: string[] }> }

type ResolvedIndex = {
	readonly index: WellKnownIndex
	/** Origin + path the matching index was found under; skill files hang off `{baseUrl}/{wellKnownPath}/{skill}/`. */
	readonly baseUrl: string
	readonly wellKnownPath: (typeof wellKnownPaths)[number]
}

function fetchIndexAt(indexUrl: string) {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const response = yield* client.get(indexUrl).pipe(
			Effect.timeout(Duration.seconds(20)),
			Effect.catchAll(
				(error) =>
					new FetchFailed({
						message: `Failed to fetch well-known skills index from ${indexUrl}`,
						cause: error,
					}),
			),
		)

		if (response.status === 404) {
			return yield* new NotFound({
				message: `No well-known skills index found at ${indexUrl}`,
			})
		}

		if (response.status !== 200) {
			return yield* new FetchFailed({
				message: `Failed to fetch well-known skills index from ${indexUrl}: HTTP ${response.status}`,
				cause: response,
			})
		}

		const json = yield* response.json.pipe(
			Effect.catchAll(
				(error) =>
					new ParseFailed({
						message: `Failed to parse well-known skills index from ${indexUrl}`,
						cause: error,
					}),
			),
		)

		if (
			!json ||
			typeof json !== "object" ||
			!Array.isArray((json as Record<string, unknown>).skills)
		) {
			return yield* new ParseFailed({
				message: `Invalid well-known skills index format at ${indexUrl}: expected { skills: [...] }`,
				cause: json,
			})
		}

		return json as WellKnownIndex
	})
}

/** Tries each well-known path under the base URL, then (if the base has a path) under the origin root. */
function fetchIndex(baseUrl: string) {
	return Effect.gen(function* () {
		const parsed = new URL(baseUrl)
		const basePath = parsed.pathname.replace(/\/+$/, "")
		const roots = basePath === "" ? [parsed.origin] : [`${parsed.origin}${basePath}`, parsed.origin]

		let firstError: FetchFailed | ParseFailed | undefined
		const tried: string[] = []
		for (const wellKnownPath of wellKnownPaths) {
			for (const root of roots) {
				const indexUrl = `${root}/${wellKnownPath}/index.json`
				tried.push(indexUrl)
				const result = yield* Effect.either(fetchIndexAt(indexUrl))
				if (result._tag === "Right") {
					return { index: result.right, baseUrl: root, wellKnownPath } satisfies ResolvedIndex
				}
				if (result.left._tag !== "NotFound" && firstError === undefined) {
					firstError = result.left
				}
			}
		}

		if (firstError !== undefined) {
			return yield* firstError
		}
		return yield* new NotFound({
			message: `No well-known skills index found. Tried: ${tried.join(", ")}`,
		})
	})
}

function fetchText(url: string) {
	return Effect.gen(function* () {
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
			return yield* new NotFound({
				message: `Skill file not found at ${url}`,
			})
		}

		if (response.status !== 200) {
			return yield* new FetchFailed({
				message: `Failed to fetch ${url}: HTTP ${response.status}`,
				cause: response,
			})
		}

		return yield* response.text.pipe(
			Effect.catchAll(
				(error) =>
					new FetchFailed({
						message: `Failed to read response body from ${url}`,
						cause: error,
					}),
			),
		)
	})
}

function findSkill(uri: ParsedUri, resolved: ResolvedIndex) {
	return Effect.gen(function* () {
		const skillName = getSkillName(uri.identifier)
		const skill = resolved.index.skills.find((s) => s.name === skillName)
		if (skill === undefined) {
			const available = resolved.index.skills.map((s) => s.name).join(", ")
			return yield* new NotFound({
				message: `Skill "${skillName ?? uri.identifier}" not found in well-known index at ${resolved.baseUrl}/${resolved.wellKnownPath}/index.json. Available: ${available}`,
			})
		}
		return skill
	})
}

export const WellKnownSource: SkillSource = {
	scheme: "well-known",

	read: Effect.fn("WellKnownSource.read")(function* (
		uri: ParsedUri,
		_options?: import("./source.js").SkillReadOptions,
	) {
		const resolved = yield* fetchIndex(buildBaseUrl(uri.identifier))
		const skill = yield* findSkill(uri, resolved)

		const subpathOrSkillMd = Option.isSome(uri.subpath) ? uri.subpath.value : "SKILL.md"

		// Check if the requested path is a directory prefix in the files list
		if (skill.files !== undefined) {
			const requestedPath = subpathOrSkillMd
			const isExactFile = skill.files.includes(requestedPath)
			if (!isExactFile) {
				const prefix = requestedPath.endsWith("/") ? requestedPath : `${requestedPath}/`
				const isDirectoryPrefix = skill.files.some((f) => f.startsWith(prefix))
				if (isDirectoryPrefix) {
					return yield* new IsDirectory({
						message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
					})
				}
			}
		}

		const fileUrl = `${resolved.baseUrl}/${resolved.wellKnownPath}/${skill.name}/${subpathOrSkillMd}`

		return yield* fetchText(fileUrl)
	}),

	search: Effect.fn("WellKnownSource.search")(function* (query: string, limit: number) {
		const resolved = yield* fetchIndex(buildBaseUrl(query)).pipe(
			Effect.catchTag("NotFound", (error) =>
				Effect.fail(
					new FetchFailed({
						message: error.message,
						cause: error,
					}),
				),
			),
		)

		const results = resolved.index.skills.slice(0, limit).map(
			(skill): SkillSearchResult => ({
				scheme: "well-known",
				identifier: skill.name,
				name: skill.name,
			}),
		)

		return results
	}),

	list: Effect.fn("WellKnownSource.list")(function* (uri: ParsedUri) {
		const resolved = yield* fetchIndex(buildBaseUrl(uri.identifier))

		if (getSkillName(uri.identifier) === undefined) {
			return resolved.index.skills.map((s): SkillEntry => ({ name: s.name, type: "directory" }))
		}

		const skill = yield* findSkill(uri, resolved)

		if (skill.files === undefined) {
			return yield* new NotFound({
				message: `Skill "${skill.name}" has no files array in the well-known index — cannot enumerate contents.`,
			})
		}

		const subpath = Option.isSome(uri.subpath) ? uri.subpath.value : undefined

		// Filter files to those matching subpath prefix
		let relevantFiles: string[]
		if (subpath !== undefined) {
			const prefix = subpath.endsWith("/") ? subpath : `${subpath}/`
			relevantFiles = skill.files
				.filter((f) => f.startsWith(prefix))
				.map((f) => f.slice(prefix.length))
		} else {
			relevantFiles = skill.files
		}

		// Extract first segment and deduplicate
		const seen = new Set<string>()
		const entries: SkillEntry[] = []
		for (const f of relevantFiles) {
			const slashIndex = f.indexOf("/")
			if (slashIndex === -1) {
				// It's a file at this level
				if (!seen.has(f)) {
					seen.add(f)
					entries.push({ name: f, type: "file" })
				}
			} else {
				// There's a subdirectory
				const dirName = f.slice(0, slashIndex)
				if (!seen.has(dirName)) {
					seen.add(dirName)
					entries.push({ name: dirName, type: "directory" })
				}
			}
		}

		return entries
	}),
}
