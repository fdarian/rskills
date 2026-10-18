import { Effect, Option } from "effect"
import { IsDirectory, NotFound } from "#/errors.js"
import { isDirectoryOf, listFromFilePaths, normalizeRelativePath } from "./paths.js"
import type { DiscoveredSkill } from "./source.js"

/** A skill whose full file set (skill-relative path -> contents) is already in memory. */
export function skillFromFileSet(
	name: string,
	files: ReadonlyMap<string, string>,
): DiscoveredSkill {
	return {
		name,
		read: (file) =>
			Effect.gen(function* () {
				const requested = yield* normalizeRelativePath(Option.getOrElse(file, () => "SKILL.md"))
				const contents = files.get(requested)
				if (contents !== undefined) {
					return contents
				}
				if (isDirectoryOf(files.keys(), requested)) {
					return yield* new IsDirectory({
						message: `${requested} is a directory, not a file. Use 'rskills ls' to list its contents.`,
					})
				}
				return yield* new NotFound({ message: `File not found in skill "${name}": ${requested}` })
			}),
		list: (dir) =>
			Effect.gen(function* () {
				const requested = yield* normalizeRelativePath(Option.getOrElse(dir, () => ""))
				const entries = listFromFilePaths(files.keys(), requested)
				if (entries.length === 0) {
					return yield* new NotFound({
						message: `Directory not found in skill "${name}": ${requested}`,
					})
				}
				return entries
			}),
	}
}
