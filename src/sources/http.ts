import { Duration, Effect } from "effect"
import { HttpClient } from "effect/http"
import { FetchFailed, NotFound } from "#/errors.js"

export const httpGet = Effect.fn("httpGet")(function* (
	url: string,
	headers?: Record<string, string>,
) {
	const client = yield* HttpClient.HttpClient
	return yield* client.get(url, headers === undefined ? undefined : { headers }).pipe(
		Effect.timeout(Duration.seconds(20)),
		Effect.catch(
			(error) =>
				new FetchFailed({
					message: `Failed to fetch ${url}`,
					cause: error,
				}),
		),
	)
})

export const fetchText = Effect.fn("fetchText")(function* (url: string) {
	const response = yield* httpGet(url)
	if (response.status === 404) {
		return yield* new NotFound({ message: `Not found: ${url}` })
	}
	if (response.status !== 200) {
		return yield* new FetchFailed({
			message: `Failed to fetch ${url}: HTTP ${response.status}`,
			cause: response,
		})
	}
	return yield* response.text.pipe(
		Effect.catch(
			(error) =>
				new FetchFailed({
					message: `Failed to read response body from ${url}`,
					cause: error,
				}),
		),
	)
})
