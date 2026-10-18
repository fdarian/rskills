import { homedir } from "node:os"
import { resolve } from "node:path"
import { Effect, Option } from "effect"
import { ParseFailed, UnsupportedSource } from "#/errors.js"

export type Source =
	| {
			readonly _tag: "GitHub"
			readonly owner: string
			readonly repo: string
			readonly ref: Option.Option<string>
			readonly subpath: Option.Option<string>
			readonly skill: Option.Option<string>
	  }
	| { readonly _tag: "WellKnown"; readonly baseUrl: string }
	| { readonly _tag: "Url"; readonly url: string }
	| { readonly _tag: "Local"; readonly path: string }
	| { readonly _tag: "Claude"; readonly name: string }

export type SourceOf<Tag extends Source["_tag"]> = Extract<Source, { _tag: Tag }>

const rawGitHubHost = "raw.githubusercontent.com"
const unsupportedHosts = new Set(["gitlab.com", "www.gitlab.com", "bitbucket.org", rawGitHubHost])
const githubHosts = new Set(["github.com", "www.github.com"])

function isLocalPath(input: string): boolean {
	return (
		input === "." ||
		input === ".." ||
		input === "~" ||
		input.startsWith("/") ||
		input.startsWith("./") ||
		input.startsWith("../") ||
		input.startsWith("~/")
	)
}

function parseSubpath(
	raw: string,
	input: string,
): Effect.Effect<Option.Option<string>, ParseFailed> {
	const segments = raw.split("/").filter((segment) => segment.length > 0)
	if (segments.includes("..")) {
		return Effect.fail(new ParseFailed({ message: `Subpath must not contain "..": "${input}"` }))
	}
	return Effect.succeed(segments.length === 0 ? Option.none() : Option.some(segments.join("/")))
}

function stripGitSuffix(repo: string): string {
	return repo.endsWith(".git") ? repo.slice(0, -".git".length) : repo
}

function parseGitHubUrl(url: URL, input: string): Effect.Effect<Source, ParseFailed> {
	return Effect.gen(function* () {
		const segments = url.pathname.split("/").filter((segment) => segment.length > 0)
		const owner = segments[0]
		const repoSegment = segments[1]
		if (owner === undefined || repoSegment === undefined) {
			return yield* new ParseFailed({
				message: `Expected https://github.com/<owner>/<repo>[/tree/<ref>[/<path>]], got "${input}"`,
			})
		}
		const rest = segments.slice(2)
		if (rest.length === 0) {
			return {
				_tag: "GitHub" as const,
				owner,
				repo: stripGitSuffix(repoSegment),
				ref: Option.none(),
				subpath: Option.none(),
				skill: Option.none(),
			}
		}
		const ref = rest[1]
		if (rest[0] !== "tree" || ref === undefined) {
			return yield* new ParseFailed({
				message: `Unsupported GitHub URL shape (expected /tree/<ref>[/<path>]): "${input}"`,
			})
		}
		// A ref containing "/" can't be told apart from a subpath; the first segment is taken as the ref.
		return {
			_tag: "GitHub" as const,
			owner,
			repo: stripGitSuffix(repoSegment),
			ref: Option.some(ref),
			subpath: yield* parseSubpath(rest.slice(2).join("/"), input),
			skill: Option.none(),
		}
	})
}

function parseShorthand(input: string): Effect.Effect<Source, ParseFailed> {
	return Effect.gen(function* () {
		const atIndex = input.lastIndexOf("@")
		const location = atIndex === -1 ? input : input.slice(0, atIndex)
		const skill = atIndex === -1 ? undefined : input.slice(atIndex + 1)
		if (skill !== undefined && (skill.length === 0 || skill.includes("/"))) {
			return yield* new ParseFailed({
				message: `Invalid skill name after "@" in "${input}"`,
			})
		}
		const segments = location.split("/").filter((segment) => segment.length > 0)
		const owner = segments[0]
		const repo = segments[1]
		if (owner === undefined || repo === undefined) {
			return yield* new ParseFailed({
				message: `Unrecognized source "${input}". Expected owner/repo[/path][@skill], a GitHub or site URL, a local path, or claude://<name>`,
			})
		}
		return {
			_tag: "GitHub" as const,
			owner,
			repo: stripGitSuffix(repo),
			ref: Option.none(),
			subpath: yield* parseSubpath(segments.slice(2).join("/"), input),
			skill: skill === undefined ? Option.none() : Option.some(skill),
		}
	})
}

export function parseSource(
	rawInput: string,
): Effect.Effect<Source, ParseFailed | UnsupportedSource> {
	return Effect.gen(function* () {
		const input = rawInput.trim()
		if (input.length === 0) {
			return yield* new ParseFailed({ message: "Source must not be empty" })
		}

		if (input.startsWith("claude://")) {
			const name = input.slice("claude://".length)
			if (name.length === 0 || name.includes("/") || name === "." || name === "..") {
				return yield* new ParseFailed({
					message: `Invalid claude source: skill name must be a single segment (got "${name}")`,
				})
			}
			return { _tag: "Claude" as const, name }
		}

		if (isLocalPath(input)) {
			const expanded =
				input === "~"
					? homedir()
					: input.startsWith("~/")
						? `${homedir()}/${input.slice(2)}`
						: input
			return { _tag: "Local" as const, path: resolve(expanded) }
		}

		if (input.startsWith("github:")) {
			const rest = input.slice("github:".length)
			if (rest.startsWith("/")) {
				return yield* new ParseFailed({
					message: `Invalid github: source "${input}". Use github:<owner>/<repo>[/path][@skill]`,
				})
			}
			return yield* parseSource(rest)
		}

		if (
			input.startsWith("git@") ||
			input.startsWith("ssh://") ||
			input.startsWith("git://") ||
			input.startsWith("git+")
		) {
			return yield* new UnsupportedSource({
				message: `Git remote sources are not supported yet: "${input}". Use a GitHub owner/repo or https://github.com URL.`,
			})
		}

		if (input.startsWith("https://") || input.startsWith("http://")) {
			const url = yield* Effect.try({
				try: () => new URL(input),
				catch: (cause) => new ParseFailed({ message: `Invalid URL: "${input}"`, cause }),
			})
			if (githubHosts.has(url.hostname)) {
				return yield* parseGitHubUrl(url, input)
			}
			const isRawMarkdown = url.hostname === rawGitHubHost && url.pathname.endsWith(".md")
			if (isRawMarkdown) {
				return { _tag: "Url" as const, url: input }
			}
			if (unsupportedHosts.has(url.hostname) || url.pathname.endsWith(".git")) {
				return yield* new UnsupportedSource({
					message: `Hosted git and artifact sources are not supported yet: "${input}". Use a GitHub owner/repo or https://github.com URL.`,
				})
			}
			if (url.pathname.endsWith(".md")) {
				return { _tag: "Url" as const, url: input }
			}
			const path = url.pathname.replace(/\/+$/, "")
			return { _tag: "WellKnown" as const, baseUrl: `${url.origin}${path}` }
		}

		if (!input.includes(":")) {
			return yield* parseShorthand(input)
		}

		return yield* new ParseFailed({
			message: `Unrecognized source "${input}". Expected owner/repo[/path][@skill], a GitHub or site URL, a local path, or claude://<name>`,
		})
	})
}
