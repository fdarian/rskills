import { HttpClient } from "@effect/platform"
import { Duration, Effect } from "effect"
import { FetchFailed, RateLimited } from "#/errors.js"

type GitHubTreeEntry = {
	path: string
	type: "blob" | "tree" | "commit"
}

type GitHubTreeResponse = {
	tree?: ReadonlyArray<GitHubTreeEntry>
	truncated?: boolean
}

/**
 * Suffix-matches tree blobs against `{skillPath}/SKILL.md` (case-insensitive),
 * including an exact match at the repo root. When multiple blobs match, the
 * shallowest (shortest) path wins so the result is deterministic. Returns the
 * directory containing SKILL.md, or null when nothing matches.
 */
function findSkillDirectory(
	entries: ReadonlyArray<GitHubTreeEntry>,
	skillPath: string,
): string | null {
	const suffixToMatch = `/${skillPath}/SKILL.md`.toLowerCase()
	const exactToMatch = `${skillPath}/SKILL.md`.toLowerCase()

	const matches = entries.filter((entry) => {
		if (entry.type !== "blob") {
			return false
		}
		const lowerPath = entry.path.toLowerCase()
		return lowerPath === exactToMatch || lowerPath.endsWith(suffixToMatch)
	})

	if (matches.length === 0) {
		return null
	}

	const shallowest = matches.reduce((shortest, current) =>
		current.path.length < shortest.path.length ? current : shortest,
	)

	return shallowest.path.slice(0, -"/SKILL.md".length)
}

/**
 * Discovery step used when the fixed raw-root candidates in skills-sh.ts
 * don't match (e.g. a skill nested deep inside a monorepo layout that no
 * finite candidate list can predict). Asks GitHub where SKILL.md actually
 * lives via the recursive Git Trees API and returns the directory containing
 * it, or null if there's no match — including when the response is
 * truncated, since a truncated listing can't be trusted as authoritative.
 */
export const findSkillDirectoryViaTreeApi = Effect.fn("findSkillDirectoryViaTreeApi")(
	(
		owner: string,
		repo: string,
		skillPath: string,
	): Effect.Effect<string | null, FetchFailed | RateLimited, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
			const client = yield* HttpClient.HttpClient
			const response = yield* client
				.get(url, { headers: { Accept: "application/vnd.github+json" } })
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
				return null
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
							message: `Failed to parse GitHub Trees API response from ${url}`,
							cause: error,
						}),
				),
			)

			const tree = (json as GitHubTreeResponse).tree
			if (!Array.isArray(tree)) {
				return null
			}

			return findSkillDirectory(tree, skillPath)
		}),
)
