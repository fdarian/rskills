import { Effect, Option } from "effect"
import { FetchFailed, IsDirectory, NotFound, RateLimited } from "#/errors.js"
import { parseFrontmatter, parseFrontmatterName } from "#/frontmatter.js"
import type { SourceOf } from "#/source.js"
import { skillFromFileSet } from "./file-set.js"
import { fetchText, httpGet } from "./http.js"
import {
	basename,
	isDirectoryOf,
	joinPath,
	listFromFilePaths,
	normalizeRelativePath,
	skillsFromDirectories,
	skippedDirectories,
} from "./paths.js"
import { fetchSkillsShDownload } from "./skills-sh-download.js"
import type { DiscoveredSkill, SkillSource } from "./source.js"

type GitHubSourceValue = SourceOf<"GitHub">

type TreeEntry = {
	readonly path: string
	readonly type: "blob" | "tree" | "commit"
}

const fetchBlobPaths = Effect.fn("GitHubSource.fetchBlobPaths")(function* (
	source: GitHubSourceValue,
	ref: string,
) {
	const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${ref}?recursive=1`
	const response = yield* httpGet(url, { Accept: "application/vnd.github+json" })

	if (response.status === 404) {
		return yield* new NotFound({
			message: `GitHub repository or ref not found: ${source.owner}/${source.repo}@${ref}`,
		})
	}
	if (response.status === 403 || response.status === 429) {
		return yield* new RateLimited({ message: `GitHub rate limit hit for ${url}` })
	}
	if (response.status !== 200) {
		return yield* new FetchFailed({
			message: `Failed to fetch ${url}: HTTP ${response.status}`,
			cause: response,
		})
	}

	const json = yield* response.json.pipe(
		Effect.catch(
			(error) =>
				new FetchFailed({
					message: `Failed to parse GitHub Trees API response from ${url}`,
					cause: error,
				}),
		),
	)
	const tree = (json as { tree?: ReadonlyArray<TreeEntry> }).tree
	if (!Array.isArray(tree)) {
		return yield* new FetchFailed({
			message: `Unexpected GitHub Trees API response from ${url}`,
			cause: json,
		})
	}
	// A truncated tree is searched as-is: skills beyond the cutoff are not found.
	return tree.filter((entry) => entry.type === "blob").map((entry) => entry.path)
})

function githubSkill(
	source: GitHubSourceValue,
	ref: string,
	name: string,
	dir: string,
	repoBlobPaths: ReadonlyArray<string>,
): DiscoveredSkill {
	const prefix = dir.length === 0 ? "" : `${dir}/`
	const skillPaths = repoBlobPaths
		.filter((path) => path.startsWith(prefix))
		.map((path) => path.slice(prefix.length))
	const skillPathSet = new Set(skillPaths)

	return {
		name,
		read: (file) =>
			Effect.gen(function* () {
				const requested = yield* normalizeRelativePath(Option.getOrElse(file, () => "SKILL.md"))
				if (skillPathSet.has(requested)) {
					return yield* fetchText(
						`https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${joinPath(dir, requested)}`,
					)
				}
				if (isDirectoryOf(skillPaths, requested)) {
					return yield* new IsDirectory({
						message: `${requested} is a directory, not a file. Use 'rskills ls' to list its contents.`,
					})
				}
				return yield* new NotFound({ message: `File not found in skill "${name}": ${requested}` })
			}),
		list: (listDir) =>
			Effect.gen(function* () {
				const requested = yield* normalizeRelativePath(Option.getOrElse(listDir, () => ""))
				const entries = listFromFilePaths(skillPaths, requested)
				if (entries.length === 0) {
					return yield* new NotFound({
						message: skillPathSet.has(requested)
							? `${requested} is a file, not a directory. Use 'rskills read --file' to read it.`
							: `Directory not found in skill "${name}": ${requested}`,
					})
				}
				return entries
			}),
	}
}

function trimSlashes(path: string): string {
	return path.replace(/^\/+|\/+$/g, "")
}

const discoverFromTree = Effect.fn("GitHubSource.discoverFromTree")(function* (
	source: GitHubSourceValue,
	ref: string,
	blobPaths: ReadonlyArray<string>,
	selector: Option.Option<string>,
) {
	const rawRoot = trimSlashes(Option.getOrElse(source.subpath, () => ""))
	const root =
		rawRoot === "SKILL.md" || rawRoot.endsWith("/SKILL.md")
			? trimSlashes(rawRoot.slice(0, -"SKILL.md".length))
			: rawRoot
	const rootPrefix = root.length === 0 ? "" : `${root}/`

	if (root.length > 0 && !blobPaths.some((path) => path.startsWith(rootPrefix))) {
		return yield* new NotFound({
			message: `Path "${root}" not found in ${source.owner}/${source.repo}@${ref}`,
		})
	}

	if (blobPaths.includes(joinPath(root, "SKILL.md"))) {
		const name = root.length === 0 ? source.repo : basename(root)
		return [githubSkill(source, ref, name, root, blobPaths)]
	}

	const skillDirs = blobPaths
		.filter((path) => path.startsWith(rootPrefix) && basename(path) === "SKILL.md")
		.map((path) => path.slice(rootPrefix.length, -"/SKILL.md".length))
		.filter((relativeDir) => !relativeDir.split("/").some((part) => skippedDirectories.has(part)))
		.map((relativeDir) => joinPath(root, relativeDir))

	const candidates = skillsFromDirectories(skillDirs)
	const selected = selector
	const matchesByDirName =
		Option.isNone(selected) ||
		candidates.some((candidate) => candidate.name.toLowerCase() === selected.value.toLowerCase())

	if (matchesByDirName) {
		return candidates.map((candidate) =>
			githubSkill(source, ref, candidate.name, candidate.dir, blobPaths),
		)
	}

	// The selector may be a frontmatter `name` that differs from the directory name.
	return yield* Effect.forEach(
		candidates,
		(candidate) =>
			Effect.gen(function* () {
				const content = yield* fetchText(
					`https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref}/${joinPath(candidate.dir, "SKILL.md")}`,
				)
				const frontmatter = parseFrontmatter(content).frontmatter
				const frontmatterName =
					frontmatter === null ? Option.none() : parseFrontmatterName(frontmatter)
				return githubSkill(
					source,
					ref,
					Option.getOrElse(frontmatterName, () => candidate.name),
					candidate.dir,
					blobPaths,
				)
			}),
		{ concurrency: 8 },
	)
})

export const GitHubSource: SkillSource<GitHubSourceValue> = {
	discover: Effect.fn("GitHubSource.discover")(function* (
		source: GitHubSourceValue,
		selector: Option.Option<string>,
	) {
		const ref = Option.getOrElse(source.ref, () => "HEAD")
		const tree = yield* Effect.result(fetchBlobPaths(source, ref))
		if (tree._tag === "Success") {
			return yield* discoverFromTree(source, ref, tree.success, selector)
		}
		if (tree.failure._tag !== "RateLimited" || Option.isNone(selector)) {
			return yield* tree.failure
		}
		const files = yield* fetchSkillsShDownload(source.owner, source.repo, selector.value)
		if (files === null) {
			return yield* new RateLimited({
				message: `${tree.failure.message}; the skills.sh fallback has no copy of ${source.owner}/${source.repo}@${selector.value} either`,
			})
		}
		return [skillFromFileSet(selector.value, files)]
	}),
}
