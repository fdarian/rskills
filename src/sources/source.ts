import type { CommandExecutor, FileSystem, HttpClient, Path } from "@effect/platform"
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
	readonly name: string
	readonly installs?: number
}

export interface SkillEntry {
	readonly name: string
	readonly type: "file" | "directory"
}

export interface SkillReadOptions {
	readonly raw?: boolean
}

export interface SkillSource {
	readonly scheme: string
	readonly read: (
		uri: ParsedUri,
		options?: SkillReadOptions,
	) => Effect.Effect<
		string,
		FetchFailed | NotFound | ParseFailed | RateLimited | InvalidArgument | IsDirectory,
		| HttpClient.HttpClient
		| SkillsShCache
		| FileSystem.FileSystem
		| Path.Path
		| CommandExecutor.CommandExecutor
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
		HttpClient.HttpClient | SkillsShCache | FileSystem.FileSystem | Path.Path
	>
}
