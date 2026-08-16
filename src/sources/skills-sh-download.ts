import { HttpClient } from "@effect/platform"
import { Duration, Effect } from "effect"
import { FetchFailed } from "#/errors.js"

type SkillsShDownloadFile = {
	path: string
	contents: string
}

type SkillsShDownloadResponse = {
	files?: unknown
}

function parseDownloadFiles(json: unknown): ReadonlyMap<string, string> | null {
	if (json === null || typeof json !== "object") {
		return null
	}

	const files = (json as SkillsShDownloadResponse).files
	if (!Array.isArray(files)) {
		return null
	}

	const fileMap = new Map<string, string>()
	for (const file of files) {
		if (
			file === null ||
			typeof file !== "object" ||
			typeof (file as Partial<SkillsShDownloadFile>).path !== "string" ||
			typeof (file as Partial<SkillsShDownloadFile>).contents !== "string"
		) {
			return null
		}
		const entry = file as SkillsShDownloadFile
		fileMap.set(entry.path, entry.contents)
	}

	return fileMap
}

/**
 * Step 2 of the skills-sh read cascade: an undocumented but unauthenticated
 * skills.sh endpoint (`GET /api/download/{owner}/{repo}/{skillId}`) that
 * returns a skill's entire file set — skill-relative path -> contents — in
 * one request. This is a possibly-stale skills.sh snapshot and a much larger
 * payload than the step 1 raw probe, so it's only tried after that misses.
 * Returns null on any non-200 status or unparseable body so the cascade
 * falls through to the GitHub Trees API.
 */
export const fetchSkillsShDownload = Effect.fn("fetchSkillsShDownload")(
	(
		owner: string,
		repo: string,
		skillId: string,
	): Effect.Effect<ReadonlyMap<string, string> | null, FetchFailed, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const url = `https://skills.sh/api/download/${owner}/${repo}/${skillId}`
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

			if (response.status !== 200) {
				return null
			}

			const json = yield* response.json.pipe(Effect.catchAll(() => Effect.succeed(null)))

			return parseDownloadFiles(json)
		}),
)
