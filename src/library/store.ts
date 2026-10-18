import { homedir } from "node:os"
import { Config, Effect, FileSystem, Option, Path, Schema } from "effect"
import { ParseFailed, WriteFailed } from "#/errors.js"

export const LibraryEntry = Schema.Struct({
	name: Schema.String,
	source: Schema.String,
	skill: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	tags: Schema.Array(Schema.String),
	note: Schema.optionalKey(Schema.String),
	addedAt: Schema.String,
})
export type LibraryEntry = typeof LibraryEntry.Type

const LibraryFile = Schema.Struct({
	version: Schema.Literal(1),
	skills: Schema.Array(LibraryEntry),
})

const decodeLibraryFile = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryFile))

const optionalEnv = (name: string) =>
	Config.String(name).pipe(
		Config.option,
		Effect.map((value) => Option.filter(value, (text) => text !== "")),
		// A ConfigError here means the config provider itself is broken, not that the variable is unset.
		Effect.orDie,
	)

export const libraryPath = Effect.fn("libraryPath")(function* () {
	const path = yield* Path.Path
	const override = yield* optionalEnv("RSKILLS_LIBRARY")
	if (Option.isSome(override)) {
		return path.resolve(override.value)
	}
	const xdg = yield* optionalEnv("XDG_CONFIG_HOME")
	const configHome = Option.isSome(xdg) ? xdg.value : path.join(homedir(), ".config")
	return path.join(configHome, "rskills", "library.json")
})

export const loadLibrary = Effect.fn("loadLibrary")(function* () {
	const fs = yield* FileSystem.FileSystem
	const file = yield* libraryPath()
	const unreadable = (cause: unknown) =>
		new ParseFailed({ message: `Failed to read library ${file}`, cause })
	const exists = yield* fs.exists(file).pipe(Effect.mapError(unreadable))
	if (!exists) {
		return []
	}
	const text = yield* fs.readFileString(file).pipe(Effect.mapError(unreadable))
	const decoded = yield* decodeLibraryFile(text).pipe(
		Effect.mapError(
			(cause) =>
				new ParseFailed({ message: `Invalid library file ${file}: ${cause.message}`, cause }),
		),
	)
	return decoded.skills
})

const byName = (a: LibraryEntry, b: LibraryEntry) => {
	const left = a.name.toLowerCase()
	const right = b.name.toLowerCase()
	return left < right ? -1 : left > right ? 1 : 0
}

export const writeLibrary = Effect.fn("writeLibrary")(function* (
	entries: ReadonlyArray<LibraryEntry>,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const file = yield* libraryPath()
	const temp = `${file}.tmp`
	const content = `${JSON.stringify({ version: 1, skills: entries.toSorted(byName) }, null, "\t")}\n`
	yield* Effect.gen(function* () {
		yield* fs.makeDirectory(path.dirname(file), { recursive: true })
		yield* fs.writeFileString(temp, content)
		yield* fs.rename(temp, file)
	}).pipe(
		Effect.mapError(
			(cause) => new WriteFailed({ message: `Failed to write library ${file}`, cause }),
		),
	)
})
