import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Duration, Effect } from "effect"
import { FetchFailed, ParseFailed } from "#/errors.js"
import type { SkillSearchResult } from "./source.js"

function createClient(baseUrl: string) {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		return client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)))
	})
}

const skillsShClient = createClient("https://skills.sh/api")

/** Convert a skills.sh id (`owner/repo/skillId`) to the `owner/repo@skillId` identifier. */
const toSkillIdentifier = (id: string) =>
	Effect.gen(function* () {
		const segments = id.split("/").filter((segment) => segment.length > 0)
		if (segments.length < 3) {
			return yield* new ParseFailed({
				message: `Unexpected skills.sh id "${id}": expected owner/repo/skillId`,
			})
		}
		return `${segments[0]}/${segments[1]}@${segments.slice(2).join("/")}`
	})

/** Split an `owner/repo@skillId` identifier into its `owner/repo` source and skill id. */
export function parseSkillIdentifier(identifier: string) {
	const atIndex = identifier.indexOf("@")
	if (atIndex <= 0 || atIndex === identifier.length - 1) {
		throw new Error(`Malformed skill identifier "${identifier}": expected owner/repo@skillId`)
	}
	return { source: identifier.slice(0, atIndex), skillId: identifier.slice(atIndex + 1) }
}

export const searchSkillsSh = Effect.fn("searchSkillsSh")(function* (query: string, limit: number) {
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
	const valid = skills.filter(
		(result): result is { id: string; name: string; source: string; installs: number } =>
			typeof result.id === "string" &&
			typeof result.name === "string" &&
			typeof result.source === "string" &&
			typeof result.installs === "number",
	)
	return yield* Effect.forEach(valid, (result) =>
		toSkillIdentifier(result.id).pipe(
			Effect.map(
				(identifier): SkillSearchResult => ({
					scheme: "skills-sh",
					identifier,
					name: result.name,
					installs: result.installs,
				}),
			),
		),
	)
})
