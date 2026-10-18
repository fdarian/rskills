import { HttpClient } from "@effect/platform"
import { Duration, Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound, ParseFailed } from "#/errors.js"
import type { SourceOf } from "#/source.js"
import { fetchText } from "./http.js"
import { isDirectoryOf, listFromFilePaths, normalizeRelativePath } from "./paths.js"
import type { DiscoveredSkill, SkillSource } from "./source.js"

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

export const WellKnownSource: SkillSource<SourceOf<"WellKnown">> = {
	discover: Effect.fn("WellKnownSource.discover")(function* (source: SourceOf<"WellKnown">) {
		const resolved = yield* fetchIndex(source.baseUrl)
		return resolved.index.skills.map((entry): DiscoveredSkill => {
			const skillUrl = (file: string) =>
				`${resolved.baseUrl}/${resolved.wellKnownPath}/${entry.name}/${file}`
			return {
				name: entry.name,
				read: (file) =>
					Effect.gen(function* () {
						const requested = yield* normalizeRelativePath(Option.getOrElse(file, () => "SKILL.md"))
						if (
							entry.files !== undefined &&
							!entry.files.includes(requested) &&
							isDirectoryOf(entry.files, requested)
						) {
							return yield* new IsDirectory({
								message: `${requested} is a directory, not a file. Use 'rskills ls' to list its contents.`,
							})
						}
						return yield* fetchText(skillUrl(requested))
					}),
				list: (dir) =>
					Effect.gen(function* () {
						if (entry.files === undefined) {
							return yield* new NotFound({
								message: `Skill "${entry.name}" has no files array in the well-known index — cannot enumerate contents.`,
							})
						}
						const requested = yield* normalizeRelativePath(Option.getOrElse(dir, () => ""))
						const entries = listFromFilePaths(entry.files, requested)
						if (entries.length === 0) {
							return yield* new NotFound({
								message: `Directory not found in skill "${entry.name}": ${requested}`,
							})
						}
						return entries
					}),
			}
		})
	}),
}
