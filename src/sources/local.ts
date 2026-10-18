import { FileSystem, Path } from "@effect/platform"
import { Effect, Option } from "effect"
import { FetchFailed, NotFound } from "#/errors.js"
import type { SourceOf } from "#/source.js"
import { isDirectory, listUnder, readFileUnder } from "./local-fs.js"
import { skillsFromDirectories, skippedDirectories } from "./paths.js"
import type { DiscoveredSkill, SkillSource } from "./source.js"

/** Directories (relative to `root`, `/`-separated) that contain a SKILL.md, skipping vendored/build output. */
const findSkillDirectories = Effect.fn("LocalSource.findSkillDirectories")(function* (
	root: string,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const found: Array<string> = []
	const visited = new Set<string>()
	const fsFailure = (message: string) => (cause: unknown) => new FetchFailed({ message, cause })

	const walk = (absolute: string, relative: string): Effect.Effect<void, FetchFailed> =>
		Effect.gen(function* () {
			// Symlink cycles would otherwise recurse forever.
			const real = yield* fs
				.realPath(absolute)
				.pipe(Effect.mapError(fsFailure(`Failed to resolve ${absolute}`)))
			if (visited.has(real)) {
				return
			}
			visited.add(real)
			const names = yield* fs
				.readDirectory(absolute)
				.pipe(Effect.mapError(fsFailure(`Failed to read directory ${absolute}`)))
			for (const name of names.slice().sort()) {
				if (skippedDirectories.has(name)) {
					continue
				}
				const child = path.join(absolute, name)
				// Dangling symlinks are skipped: there is nothing to discover behind them.
				const info = yield* Effect.option(fs.stat(child))
				if (Option.isNone(info)) {
					continue
				}
				const childRelative = relative.length === 0 ? name : `${relative}/${name}`
				if (info.value.type === "Directory") {
					yield* walk(child, childRelative)
				} else if (name === "SKILL.md" && relative.length > 0) {
					found.push(relative)
				}
			}
		})

	yield* walk(root, "")
	return found
})

function localSkill(name: string, dir: string): DiscoveredSkill {
	return {
		name,
		read: (file) => readFileUnder(dir, file),
		list: (listDir) => listUnder(dir, listDir),
	}
}

export const LocalSource: SkillSource<SourceOf<"Local">> = {
	discover: Effect.fn("LocalSource.discover")(function* (source: SourceOf<"Local">) {
		const path = yield* Path.Path
		const fs = yield* FileSystem.FileSystem
		if (!(yield* isDirectory(source.path))) {
			return yield* new NotFound({ message: `Not a directory: ${source.path}` })
		}
		const rootHasSkill = yield* fs
			.exists(path.join(source.path, "SKILL.md"))
			.pipe(
				Effect.mapError(
					(cause) => new FetchFailed({ message: `Failed to check ${source.path}`, cause }),
				),
			)
		if (rootHasSkill) {
			return [localSkill(path.basename(source.path), source.path)]
		}
		const directories = yield* findSkillDirectories(source.path)
		return skillsFromDirectories(directories).map((skill) =>
			localSkill(skill.name, path.join(source.path, skill.dir)),
		)
	}),
}
