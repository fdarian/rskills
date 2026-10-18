import type { Effect, FileSystem, Option, Path } from "effect"
import type { HttpClient } from "effect/http"
import type { ChildProcessSpawner } from "effect/process"
import type {
	FetchFailed,
	InvalidArgument,
	IsDirectory,
	NotFound,
	ParseFailed,
	RateLimited,
} from "#/errors.js"
import type { Source } from "#/source.js"

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

export type SkillError =
	| FetchFailed
	| NotFound
	| ParseFailed
	| RateLimited
	| InvalidArgument
	| IsDirectory

export type SkillEnv =
	| HttpClient.HttpClient
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner

/** A skill located inside a source. `read`/`list` are bound to wherever discovery found it. */
export interface DiscoveredSkill {
	readonly name: string
	/** `file` is relative to the skill directory; none means `SKILL.md`. */
	readonly read: (
		file: Option.Option<string>,
		options: SkillReadOptions,
	) => Effect.Effect<string, SkillError, SkillEnv>
	/** `dir` is relative to the skill directory; none means the skill directory itself. */
	readonly list: (
		dir: Option.Option<string>,
	) => Effect.Effect<ReadonlyArray<SkillEntry>, SkillError, SkillEnv>
}

export interface SkillSource<S extends Source> {
	/**
	 * `selector` is a hint for providers that can avoid work when the caller
	 * already knows which skill it wants; final name matching is done by the
	 * caller (`selectSkill`).
	 */
	readonly discover: (
		source: S,
		selector: Option.Option<string>,
	) => Effect.Effect<ReadonlyArray<DiscoveredSkill>, SkillError, SkillEnv>
}
