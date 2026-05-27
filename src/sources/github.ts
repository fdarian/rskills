import { HttpClient } from "@effect/platform"
import { Duration, Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound, RateLimited } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import { serialize } from "#/uri.js"
import type { SkillEntry, SkillSource } from "./source.js"

type GitHubContentsItem = {
	name: string
	type: "file" | "dir" | "symlink" | "submodule"
}

function fetchGitHubContents(
	owner: string,
	repo: string,
	contentsPath: string,
): Effect.Effect<
	ReadonlyArray<GitHubContentsItem> | GitHubContentsItem,
	FetchFailed | NotFound | RateLimited,
	HttpClient.HttpClient
> {
	return Effect.gen(function* () {
		const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}`
		const client = yield* HttpClient.HttpClient
		const response = yield* client
			.get(url, {
				headers: { Accept: "application/vnd.github+json" },
			})
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
			return yield* new NotFound({ message: `Not found: ${url}` })
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
						message: `Failed to parse GitHub Contents API response from ${url}`,
						cause: error,
					}),
			),
		)

		return json as ReadonlyArray<GitHubContentsItem> | GitHubContentsItem
	})
}

function buildContentsPath(uri: ParsedUri): { owner: string; repo: string; contentsPath: string } {
	const segments = uri.identifier.split("/")
	const owner = segments[0] ?? ""
	const repo = segments[1] ?? ""
	const pathParts = segments.slice(2)
	const subpathPart = Option.isSome(uri.subpath) ? uri.subpath.value : undefined

	let contentsPath: string
	if (subpathPart !== undefined) {
		contentsPath = [...pathParts, subpathPart].join("/")
	} else {
		contentsPath = pathParts.join("/")
	}

	return { owner, repo, contentsPath }
}

export const GitHubSource: SkillSource = {
	scheme: "github",

	read: Effect.fn("GitHubSource.read")(function* (uri: ParsedUri) {
		const segments = uri.identifier.split("/")
		if (segments.length < 3) {
			return yield* new NotFound({
				message: `Invalid github identifier: ${uri.identifier}`,
			})
		}

		const owner = segments[0]
		const repo = segments[1]
		const path = segments.slice(2).join("/")
		const subpathOrSkillMd = Option.isSome(uri.subpath) ? uri.subpath.value : "SKILL.md"
		const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}/${subpathOrSkillMd}`

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

		if (response.status === 200) {
			return yield* response.text.pipe(
				Effect.catchAll(
					(error) =>
						new FetchFailed({
							message: `Failed to read response body from ${url}`,
							cause: error,
						}),
				),
			)
		}

		if (response.status === 404) {
			// Disambiguate: is this path actually a directory?
			const { owner: o, repo: r, contentsPath } = buildContentsPath(uri)
			const contentsResult = yield* fetchGitHubContents(o, r, contentsPath).pipe(
				Effect.catchTag("NotFound", (_) => Effect.succeed(null)),
				Effect.catchTag("RateLimited", (e) => Effect.fail(e)),
				Effect.catchTag("FetchFailed", (e) => Effect.fail(e)),
			)
			if (contentsResult !== null && Array.isArray(contentsResult)) {
				return yield* new IsDirectory({
					message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
				})
			}
			if (contentsResult !== null && !Array.isArray(contentsResult)) {
				// Contents API says it's a file but raw 404'd — inconsistency
				return yield* new FetchFailed({
					message: `Inconsistent state: raw URL 404'd but GitHub Contents API reports a file at ${url}`,
					cause: response,
				})
			}
			return yield* new NotFound({
				message: `Skill not found: ${uri.identifier}`,
			})
		}

		if (response.status === 403) {
			return yield* new RateLimited({
				message: `GitHub rate limit hit for ${url}`,
			})
		}

		return yield* new FetchFailed({
			message: `Failed to fetch ${url}: HTTP ${response.status}`,
			cause: response,
		})
	}),

	list: Effect.fn("GitHubSource.list")(function* (uri: ParsedUri) {
		const segments = uri.identifier.split("/")
		if (segments.length < 3) {
			return yield* new NotFound({
				message: `Invalid github identifier: ${uri.identifier}`,
			})
		}

		const { owner, repo, contentsPath } = buildContentsPath(uri)
		const result = yield* fetchGitHubContents(owner, repo, contentsPath)

		if (!Array.isArray(result)) {
			return yield* new NotFound({
				message: `${serialize(uri)} is a file, not a directory. Use 'rskills read' to read it.`,
			})
		}

		return result.map(
			(item): SkillEntry => ({
				name: item.name,
				type: item.type === "dir" ? "directory" : "file",
			}),
		)
	}),
}
