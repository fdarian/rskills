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

function getLastSegment(identifier: string): string {
	const segments = identifier.split("/").filter((s) => s.length > 0)
	const last = segments[segments.length - 1]
	if (last === undefined) {
		return identifier
	}
	return last
}

function fetchIndex(baseUrl: string) {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const indexUrl = `${baseUrl}/.well-known/skills/index.json`
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

		return json as { skills: Array<{ name: string; description?: string; files?: string[] }> }
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

export const WellKnownSource: SkillSource = {
	scheme: "well-known",

	read: Effect.fn("WellKnownSource.read")(function* (uri: ParsedUri) {
		const baseUrl = buildBaseUrl(uri.identifier)
		const skillName = getLastSegment(uri.identifier)
		const index = yield* fetchIndex(baseUrl)

		const skill = index.skills.find((s) => s.name === skillName)
		if (!skill) {
			return yield* new NotFound({
				message: `Skill "${skillName}" not found in well-known index at ${baseUrl}`,
			})
		}

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

		const fileUrl = `${baseUrl}/.well-known/skills/${skillName}/${subpathOrSkillMd}`

		return yield* fetchText(fileUrl)
	}),

	search: Effect.fn("WellKnownSource.search")(function* (query: string, limit: number) {
		const baseUrl = buildBaseUrl(query)
		const index = yield* fetchIndex(baseUrl).pipe(
			Effect.catchTag("NotFound", (error) =>
				Effect.fail(
					new FetchFailed({
						message: error.message,
						cause: error,
					}),
				),
			),
		)

		const results = index.skills.slice(0, limit).map(
			(skill): SkillSearchResult => ({
				scheme: "well-known",
				identifier: skill.name,
				description: skill.description || "",
			}),
		)

		return results
	}),

	list: Effect.fn("WellKnownSource.list")(function* (uri: ParsedUri) {
		const baseUrl = buildBaseUrl(uri.identifier)
		const skillName = getLastSegment(uri.identifier)
		const index = yield* fetchIndex(baseUrl)

		const skill = index.skills.find((s) => s.name === skillName)
		if (!skill) {
			return yield* new NotFound({
				message: `Skill "${skillName}" not found in well-known index at ${baseUrl}`,
			})
		}

		if (skill.files === undefined) {
			return yield* new NotFound({
				message: `Skill "${skillName}" has no files array in the well-known index — cannot enumerate contents.`,
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
