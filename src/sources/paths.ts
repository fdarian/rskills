import { Effect } from "effect"
import { InvalidArgument } from "#/errors.js"
import type { SkillEntry } from "./source.js"

export const skippedDirectories: ReadonlySet<string> = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"__pycache__",
])

/** Normalizes a user-supplied path inside a skill; rejects anything that could escape it. */
export function normalizeRelativePath(input: string): Effect.Effect<string, InvalidArgument> {
	const segments = input.split("/").filter((segment) => segment.length > 0 && segment !== ".")
	if (input.startsWith("/") || segments.includes("..")) {
		return Effect.fail(
			new InvalidArgument({
				message: `Path must be relative to the skill and must not contain "..": "${input}"`,
			}),
		)
	}
	return Effect.succeed(segments.join("/"))
}

export function joinPath(base: string, child: string): string {
	if (base.length === 0) {
		return child
	}
	if (child.length === 0) {
		return base
	}
	return `${base}/${child}`
}

export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1)
}

/**
 * Turns directories containing a SKILL.md into named skills. Name is the
 * directory basename; on a name clash the shallowest directory wins.
 */
export function skillsFromDirectories(
	directories: ReadonlyArray<string>,
): Array<{ readonly name: string; readonly dir: string }> {
	const byDepth = directories
		.slice()
		.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
	const seen = new Set<string>()
	const skills: Array<{ name: string; dir: string }> = []
	for (const dir of byDepth) {
		const name = basename(dir)
		if (seen.has(name.toLowerCase())) {
			continue
		}
		seen.add(name.toLowerCase())
		skills.push({ name, dir })
	}
	return skills
}

/** True when `path` is a proper ancestor directory of at least one file path. */
export function isDirectoryOf(filePaths: Iterable<string>, path: string): boolean {
	const prefix = path.length === 0 ? "" : `${path}/`
	for (const filePath of filePaths) {
		if (filePath.startsWith(prefix) && filePath.length > prefix.length) {
			return true
		}
	}
	return false
}

/** One-level listing of `dir` derived from a flat list of file paths. Empty when `dir` has no files. */
export function listFromFilePaths(filePaths: Iterable<string>, dir: string): Array<SkillEntry> {
	const prefix = dir.length === 0 ? "" : `${dir}/`
	const seen = new Set<string>()
	const entries: Array<SkillEntry> = []
	for (const filePath of filePaths) {
		if (!filePath.startsWith(prefix)) {
			continue
		}
		const rest = filePath.slice(prefix.length)
		if (rest.length === 0) {
			continue
		}
		const slashIndex = rest.indexOf("/")
		const name = slashIndex === -1 ? rest : rest.slice(0, slashIndex)
		if (seen.has(name)) {
			continue
		}
		seen.add(name)
		entries.push({ name, type: slashIndex === -1 ? "file" : "directory" })
	}
	return entries
}
