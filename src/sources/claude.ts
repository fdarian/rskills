import { homedir } from "node:os"
import { FileSystem, Path } from "@effect/platform"
import { Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound } from "#/errors.js"
import type { ParsedUri } from "#/uri.js"
import { serialize } from "#/uri.js"
import type { SkillEntry, SkillSource } from "./source.js"

// Plugin roots (~/.claude/plugins/**/skills/) and a project/user namespace
// disambiguator (`claude://user/<name>`) are possible future additions.

function claudeSkillRoots(path: Path.Path): ReadonlyArray<string> {
	const cwd = process.cwd()
	return [path.join(cwd, ".claude", "skills"), path.join(homedir(), ".claude", "skills")]
}

function relativeFilePath(uri: ParsedUri, path: Path.Path): string {
	const subpathOrSkillMd = Option.isSome(uri.subpath) ? uri.subpath.value : "SKILL.md"
	return path.join(uri.identifier, subpathOrSkillMd)
}

function relativeListPath(uri: ParsedUri, path: Path.Path): string {
	if (Option.isSome(uri.subpath)) {
		return path.join(uri.identifier, uri.subpath.value)
	}
	return uri.identifier
}

const resolveReadFile = Effect.fn("ClaudeSource.resolveReadFile")(function* (uri: ParsedUri) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const relativeFile = relativeFilePath(uri, path)
	const roots = claudeSkillRoots(path)
	const probed: Array<string> = []

	for (const root of roots) {
		const fullPath = path.join(root, relativeFile)
		probed.push(fullPath)
		const exists = yield* fs.exists(fullPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to check ${fullPath}`,
						cause: error,
					}),
			),
		)
		if (!exists) {
			continue
		}
		const info = yield* fs.stat(fullPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to stat ${fullPath}`,
						cause: error,
					}),
			),
		)
		if (info.type === "Directory") {
			return yield* new IsDirectory({
				message: `${serialize(uri)} is a directory, not a file. Use 'rskills ls' to list its contents.`,
			})
		}
		return yield* fs.readFileString(fullPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to read ${fullPath}`,
						cause: error,
					}),
			),
		)
	}

	return yield* new NotFound({
		message: `Skill not found: ${uri.identifier}. Probed:\n${probed.map((p) => `  - ${p}`).join("\n")}`,
	})
})

const resolveListDirectory = Effect.fn("ClaudeSource.resolveListDirectory")(function* (
	uri: ParsedUri,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const relativeList = relativeListPath(uri, path)
	const roots = claudeSkillRoots(path)
	const probed: Array<string> = []

	for (const root of roots) {
		const dirPath = path.join(root, relativeList)
		probed.push(dirPath)
		const exists = yield* fs.exists(dirPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to check ${dirPath}`,
						cause: error,
					}),
			),
		)
		if (!exists) {
			continue
		}
		const info = yield* fs.stat(dirPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to stat ${dirPath}`,
						cause: error,
					}),
			),
		)
		if (info.type !== "Directory") {
			return yield* new NotFound({
				message: `${serialize(uri)} is a file, not a directory. Use 'rskills read' to read it.`,
			})
		}
		const names = yield* fs.readDirectory(dirPath).pipe(
			Effect.mapError(
				(error) =>
					new FetchFailed({
						message: `Failed to read directory ${dirPath}`,
						cause: error,
					}),
			),
		)
		const entries: Array<SkillEntry> = []
		for (const name of names) {
			const entryPath = path.join(dirPath, name)
			const entryInfo = yield* fs.stat(entryPath).pipe(
				Effect.mapError(
					(error) =>
						new FetchFailed({
							message: `Failed to stat ${entryPath}`,
							cause: error,
						}),
				),
			)
			entries.push({
				name,
				type: entryInfo.type === "Directory" ? "directory" : "file",
			})
		}
		return entries
	}

	return yield* new NotFound({
		message: `Skill directory not found: ${uri.identifier}. Probed:\n${probed.map((p) => `  - ${p}`).join("\n")}`,
	})
})

export const ClaudeSource: SkillSource = {
	scheme: "claude",

	read: Effect.fn("ClaudeSource.read")(function* (uri: ParsedUri) {
		if (uri.identifier.includes("/")) {
			return yield* new NotFound({
				message: `Invalid claude identifier: skill name must be a single segment (got "${uri.identifier}")`,
			})
		}
		return yield* resolveReadFile(uri)
	}),

	list: Effect.fn("ClaudeSource.list")(function* (uri: ParsedUri) {
		if (uri.identifier.includes("/")) {
			return yield* new NotFound({
				message: `Invalid claude identifier: skill name must be a single segment (got "${uri.identifier}")`,
			})
		}
		return yield* resolveListDirectory(uri)
	}),
}
