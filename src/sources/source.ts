import type { HttpClient } from "@effect/platform"
import type { Effect } from "effect"
import type {
	FetchFailed,
	InvalidArgument,
	IsDirectory,
	NotFound,
	ParseFailed,
	RateLimited,
} from "../errors.js"
import type { ParsedUri } from "../uri.js"
import type { SkillsShCache } from "./skills-sh-cache.js"

export interface SkillSearchResult {
	readonly scheme: string
	readonly identifier: string
	readonly description: string
}

export interface SkillEntry {
	readonly name: string
	readonly type: "file" | "directory"
}

export interface SkillSource {
	readonly scheme: string
	readonly read: (
		uri: ParsedUri,
	) => Effect.Effect<
		string,
		FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument | IsDirectory,
		HttpClient.HttpClient | SkillsShCache
	>
	readonly search?: (
		query: string,
		limit: number,
	) => Effect.Effect<SkillSearchResult[], FetchFailed | ParseFailed, HttpClient.HttpClient>
	readonly list?: (
		uri: ParsedUri,
	) => Effect.Effect<
		ReadonlyArray<SkillEntry>,
		FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument,
		HttpClient.HttpClient | SkillsShCache
	>
}
