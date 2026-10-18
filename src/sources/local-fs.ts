import { FileSystem, Path } from "@effect/platform"
import { Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound } from "#/errors.js"
import { normalizeRelativePath } from "./paths.js"
import type { SkillEntry } from "./source.js"

function fsFailure(message: string) {
	return (cause: unknown) => new FetchFailed({ message, cause })
}

const statIfExists = Effect.fn("localFs.statIfExists")(function* (target: string) {
	const fs = yield* FileSystem.FileSystem
	const exists = yield* fs
		.exists(target)
		.pipe(Effect.mapError(fsFailure(`Failed to check ${target}`)))
	if (!exists) {
		return Option.none()
	}
	const info = yield* fs.stat(target).pipe(Effect.mapError(fsFailure(`Failed to stat ${target}`)))
	return Option.some(info)
})

export const isDirectory = Effect.fn("localFs.isDirectory")(function* (target: string) {
	const info = yield* statIfExists(target)
	return Option.isSome(info) && info.value.type === "Directory"
})

export const readFileUnder = Effect.fn("localFs.readFileUnder")(function* (
	baseDir: string,
	file: Option.Option<string>,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const requested = yield* normalizeRelativePath(Option.getOrElse(file, () => "SKILL.md"))
	const target = path.join(baseDir, requested)
	const info = yield* statIfExists(target)
	if (Option.isNone(info)) {
		return yield* new NotFound({ message: `File not found: ${target}` })
	}
	if (info.value.type === "Directory") {
		return yield* new IsDirectory({
			message: `${requested} is a directory, not a file. Use 'rskills ls' to list its contents.`,
		})
	}
	return yield* fs
		.readFileString(target)
		.pipe(Effect.mapError(fsFailure(`Failed to read ${target}`)))
})

export const listUnder = Effect.fn("localFs.listUnder")(function* (
	baseDir: string,
	dir: Option.Option<string>,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const requested = yield* normalizeRelativePath(Option.getOrElse(dir, () => ""))
	const target = path.join(baseDir, requested)
	const info = yield* statIfExists(target)
	if (Option.isNone(info)) {
		return yield* new NotFound({ message: `Directory not found: ${target}` })
	}
	if (info.value.type !== "Directory") {
		return yield* new NotFound({
			message: `${requested} is a file, not a directory. Use 'rskills read --file' to read it.`,
		})
	}
	const names = yield* fs
		.readDirectory(target)
		.pipe(Effect.mapError(fsFailure(`Failed to read directory ${target}`)))
	const entries: Array<SkillEntry> = []
	for (const name of names.slice().sort()) {
		const entryPath = path.join(target, name)
		const entryInfo = yield* fs
			.stat(entryPath)
			.pipe(Effect.mapError(fsFailure(`Failed to stat ${entryPath}`)))
		entries.push({ name, type: entryInfo.type === "Directory" ? "directory" : "file" })
	}
	return entries
})
