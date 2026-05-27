import { HttpClient } from "@effect/platform"
import { Duration, Effect } from "effect"
import { FetchFailed, InvalidArgument, NotFound } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import type { SkillSource } from "./source.js"

export const UrlSource: SkillSource = {
	scheme: "https",

	read: Effect.fn("UrlSource.read")(function* (uri: ParsedUri) {
		const url = uri.identifier

		if (!url.endsWith(".md")) {
			return yield* new InvalidArgument({ message: "URL must end with .md" })
		}

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
			return yield* new NotFound({ message: `URL not found: ${url}` })
		}

		if (response.status !== 200) {
			return yield* new FetchFailed({
				message: `HTTP error ${response.status} for ${url}`,
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
	}),
}
