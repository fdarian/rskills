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
})
