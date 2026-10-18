import { Effect, Option } from "effect"
import { InvalidArgument, NotFound } from "#/errors.js"
import {
	parseFrontmatter,
	parseFrontmatterDescription,
	parseFrontmatterName,
} from "#/frontmatter.js"
import { resolveSkill } from "#/skills.js"
import { type LibraryEntry, loadLibrary, writeLibrary } from "./store.js"

export type { LibraryEntry } from "./store.js"
export { loadLibrary } from "./store.js"

export interface AddToLibraryRequest {
	readonly source: string
	readonly skill: Option.Option<string>
	readonly tags: ReadonlyArray<string>
	readonly note: Option.Option<string>
	readonly as: Option.Option<string>
}

export interface SearchLibraryRequest {
	readonly query: Option.Option<string>
	readonly tags: ReadonlyArray<string>
	readonly limit: number
}

/** Comma-separated tag option -> trimmed, lowercase, non-empty. */
export function parseTags(raw: Option.Option<string>): ReadonlyArray<string> {
	if (Option.isNone(raw)) {
		return []
	}
	return raw.value
		.split(",")
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag !== "")
}

const sameName = (entry: LibraryEntry, name: string) =>
	entry.name.toLowerCase() === name.toLowerCase()

const sameTarget = (entry: LibraryEntry, source: string, skill: Option.Option<string>) =>
	entry.source === source && entry.skill === Option.getOrUndefined(skill)

export const addToLibrary = Effect.fn("addToLibrary")(function* (request: AddToLibraryRequest) {
	const skill = yield* resolveSkill(request.source, request.skill)
	const content = yield* skill.read(Option.none(), { raw: true })
	const frontmatter = Option.fromNullishOr(parseFrontmatter(content).frontmatter)
	const description = Option.flatMap(frontmatter, parseFrontmatterDescription)
	const name = Option.getOrElse(request.as, () =>
		Option.getOrElse(Option.flatMap(frontmatter, parseFrontmatterName), () => skill.name),
	).trim()
	if (name === "") {
		return yield* new InvalidArgument({ message: "Library name must not be empty" })
	}

	const skillOption = Option.getOrUndefined(request.skill)
	const descriptionText = Option.getOrUndefined(description)
	const noteText = Option.getOrUndefined(request.note)

	const entries = yield* loadLibrary()
	const existing = entries.find((entry) => sameName(entry, name))
	if (existing === undefined) {
		const entry: LibraryEntry = {
			name,
			source: request.source,
			...(skillOption !== undefined ? { skill: skillOption } : {}),
			...(descriptionText !== undefined ? { description: descriptionText } : {}),
			tags: [...new Set(request.tags)],
			...(noteText !== undefined ? { note: noteText } : {}),
			addedAt: new Date().toISOString(),
		}
		yield* writeLibrary([...entries, entry])
		return entry
	}
	if (!sameTarget(existing, request.source, request.skill)) {
		const saved =
			existing.skill === undefined
				? existing.source
				: `${existing.source} --skill ${existing.skill}`
		return yield* new InvalidArgument({
			message: `Library already has "${existing.name}" (${saved}). Pass --as <other-name> to save this one under a different name.`,
		})
	}
	const keptNote = noteText ?? existing.note
	const updated: LibraryEntry = {
		name: existing.name,
		source: existing.source,
		...(existing.skill !== undefined ? { skill: existing.skill } : {}),
		...(descriptionText !== undefined ? { description: descriptionText } : {}),
		tags: [...new Set([...existing.tags, ...request.tags])],
		...(keptNote !== undefined ? { note: keptNote } : {}),
		addedAt: existing.addedAt,
	}
	yield* writeLibrary(entries.map((entry) => (entry === existing ? updated : entry)))
	return updated
})

export const removeFromLibrary = Effect.fn("removeFromLibrary")(function* (name: string) {
	const entries = yield* loadLibrary()
	const removed = entries.find((entry) => sameName(entry, name))
	if (removed === undefined) {
		return yield* new NotFound({ message: `Not in library: ${name}` })
	}
	yield* writeLibrary(entries.filter((entry) => entry !== removed))
	return removed
})

const rank = (entry: LibraryEntry, query: string) => {
	const name = entry.name.toLowerCase()
	if (name === query) {
		return 0
	}
	return name.includes(query) ? 1 : 2
}

export const searchLibrary = Effect.fn("searchLibrary")(function* (request: SearchLibraryRequest) {
	const entries = yield* loadLibrary()
	const query = Option.getOrElse(request.query, () => "")
		.trim()
		.toLowerCase()
	const tokens = query.split(/\s+/).filter((token) => token !== "")
	const tags = request.tags.map((tag) => tag.toLowerCase())
	return entries
		.filter((entry) => {
			const entryTags = entry.tags.map((tag) => tag.toLowerCase())
			if (!tags.every((tag) => entryTags.includes(tag))) {
				return false
			}
			const haystack = [entry.name, entry.description, ...entry.tags, entry.note, entry.source]
				.filter((field) => field !== undefined)
				.join("\n")
				.toLowerCase()
			return tokens.every((token) => haystack.includes(token))
		})
		.toSorted(
			(a, b) =>
				rank(a, query) - rank(b, query) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
		)
		.slice(0, request.limit)
})

/** For the TUI: skills.sh identifiers are `owner/repo@skill`, so only entries saved without `--skill` match. */
export function findSaved(
	entries: ReadonlyArray<LibraryEntry>,
	source: string,
): Option.Option<LibraryEntry> {
	return Option.fromNullishOr(
		entries.find((entry) => entry.source === source && entry.skill === undefined),
	)
}
