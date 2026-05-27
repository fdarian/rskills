import { Effect, Option } from "effect"
import { ParseFailed, UnsupportedScheme } from "./errors.js"

export type Scheme = "skills-sh" | "well-known" | "github" | "https"

export interface ParsedUri {
	readonly scheme: Scheme
	readonly identifier: string
	readonly subpath: Option.Option<string>
}

const boundarySegments = new Set(["references", "scripts", "templates", "assets", "SKILL.md"])

function detectSubpath(segments: string[]): { identifier: string; subpath: Option.Option<string> } {
	const boundaryIndex = segments.findIndex((segment) => boundarySegments.has(segment))
	if (boundaryIndex !== -1) {
		return {
			identifier: segments.slice(0, boundaryIndex).join("/"),
			subpath: Option.some(segments.slice(boundaryIndex).join("/")),
		}
	}
	const lastSegment = segments[segments.length - 1]
	if (lastSegment !== undefined && /\.\w+$/.test(lastSegment)) {
		return {
			identifier: segments.slice(0, segments.length - 1).join("/"),
			subpath: Option.some(lastSegment),
		}
	}
	return { identifier: segments.join("/"), subpath: Option.none() }
}

export function parse(
	uriString: string,
): Effect.Effect<ParsedUri, ParseFailed | UnsupportedScheme> {
	return Effect.gen(function* () {
		if (uriString.startsWith("https://")) {
			return { scheme: "https" as const, identifier: uriString, subpath: Option.none() }
		}

		const schemeSeparatorIndex = uriString.indexOf("://")
		if (schemeSeparatorIndex === -1) {
			return yield* new ParseFailed({
				message: `Invalid URI: missing :// separator in "${uriString}"`,
			})
		}

		const scheme = uriString.slice(0, schemeSeparatorIndex)
		const rest = uriString.slice(schemeSeparatorIndex + 3)

		if (scheme !== "skills-sh" && scheme !== "well-known" && scheme !== "github") {
			return yield* new UnsupportedScheme({ scheme })
		}

		if (rest.length === 0) {
			return yield* new ParseFailed({ message: `Invalid URI: empty identifier in "${uriString}"` })
		}

		const segments = rest.split("/").filter((s) => s.length > 0)
		const { identifier, subpath } = detectSubpath(segments)

		return { scheme, identifier, subpath }
	})
}

export function serialize(parsed: ParsedUri): string {
	const subpathPart = Option.match(parsed.subpath, {
		onNone: () => "",
		onSome: (s) => `/${s}`,
	})
	return `${parsed.scheme}://${parsed.identifier}${subpathPart}`
}
