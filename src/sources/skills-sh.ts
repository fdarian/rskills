import { Duration, Effect, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { FetchFailed, ParseFailed } from "#/errors.js"
import type { SkillSearchResult } from "./source.js"

function createClient(baseUrl: string) {
	return Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		return client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)))
	})
}

const skillsShClient = createClient("https://skills.sh/api")

/**
 * Convert a skills.sh id to an identifier `rskills read` accepts: `owner/repo/skillId` becomes
 * `owner/repo@skillId`, and `host.tld/skillId` (a well-known site) becomes `host.tld@skillId`.
 * Other shapes have no readable source and yield none.
 */
const toSkillIdentifier = (id: string) => {
	const segments = id.split("/").filter((segment) => segment.length > 0)
	const first = segments[0]
	if (first === undefined) {
		return Option.none()
	}
	if (first.includes(".")) {
		return segments.length === 2 ? Option.some(`${first}@${segments[1]}`) : Option.none()
	}
	if (segments.length < 3) {
		return Option.none()
	}
	return Option.some(`${first}/${segments[1]}@${segments.slice(2).join("/")}`)
}

/** Split an `owner/repo@skillId` or `host.tld@skillId` identifier into its source and skill id. */
export function parseSkillIdentifier(identifier: string) {
	const atIndex = identifier.indexOf("@")
	if (atIndex <= 0 || atIndex === identifier.length - 1) {
		throw new Error(`Malformed skill identifier "${identifier}": expected <source>@skillId`)
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
			Effect.catch(
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
		Effect.catch(
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
	return valid.flatMap((result): Array<SkillSearchResult> => {
		const identifier = toSkillIdentifier(result.id)
		return Option.isSome(identifier)
			? [
					{
						scheme: "skills-sh",
						identifier: identifier.value,
						name: result.name,
						installs: result.installs,
					},
				]
			: []
	})
})
