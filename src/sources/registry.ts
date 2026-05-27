import type { HttpClient } from "@effect/platform"
import { Console, Effect } from "effect"
import {
	type FetchFailed,
	type InvalidArgument,
	type IsDirectory,
	type NotFound,
	type ParseFailed,
	type RateLimited,
	UnsupportedScheme,
} from "../errors.js"
import type { ParsedUri } from "../uri.js"
import { GitHubSource } from "./github.js"
import { SkillsShSource } from "./skills-sh.js"
import type { SkillsShCache } from "./skills-sh-cache.js"
import type { SkillEntry, SkillSearchResult, SkillSource } from "./source.js"
import { UrlSource } from "./url.js"
import { WellKnownSource } from "./well-known.js"

const allSources: SkillSource[] = [SkillsShSource, WellKnownSource, GitHubSource, UrlSource]

export function resolveSource(
	scheme: string,
): Effect.Effect<SkillSource, UnsupportedScheme, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const source = allSources.find((s) => s.scheme === scheme)
		if (source === undefined) {
			return yield* new UnsupportedScheme({ scheme })
		}
		return source
	})
}

export function readFromUri(
	uri: ParsedUri,
): Effect.Effect<
	string,
	| FetchFailed
	| NotFound
	| ParseFailed
	| RateLimited
	| InvalidArgument
	| IsDirectory
	| UnsupportedScheme,
	HttpClient.HttpClient | SkillsShCache
> {
	return Effect.gen(function* () {
		const source = yield* resolveSource(uri.scheme)
		return yield* source.read(uri)
	})
}

export function listFromUri(
	uri: ParsedUri,
): Effect.Effect<
	ReadonlyArray<SkillEntry>,
	FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument | UnsupportedScheme,
	HttpClient.HttpClient | SkillsShCache
> {
	return Effect.gen(function* () {
		const source = yield* resolveSource(uri.scheme)
		if (source.list === undefined) {
			return yield* Effect.fail(new UnsupportedScheme({ scheme: uri.scheme }))
		}
		return yield* source.list(uri)
	})
}

export function looksLikeUrl(query: string): boolean {
	return query.includes(".") || query.startsWith("http")
}

export function searchAll(
	query: string,
	limit: number,
): Effect.Effect<SkillSearchResult[], never, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const searchables = allSources.filter((s) => {
			if (s.search === undefined) {
				return false
			}
			if (s.scheme === "well-known" && !looksLikeUrl(query)) {
				return false
			}
			return true
		})
		const results = yield* Effect.all(
			searchables.map((s) =>
				Effect.gen(function* () {
					if (s.search === undefined) {
						return [] as SkillSearchResult[]
					}
					return yield* s.search(query, limit)
				}).pipe(
					Effect.tapError((error) =>
						Console.error(`Search failed for source "${s.scheme}": ${error}`),
					),
					Effect.catchAll((_error) => Effect.succeed([] as SkillSearchResult[])),
				),
			),
			{ concurrency: "unbounded" },
		)
		return results.flat()
	})
}
