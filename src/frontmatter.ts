import { Option } from "effect"

export type FrontmatterParse = {
	readonly body: string
	readonly frontmatter: string | null
}

export function parseFrontmatter(content: string): FrontmatterParse {
	if (!content.startsWith("---\n")) {
		return { body: content, frontmatter: null }
	}
	const closeIndex = content.indexOf("\n---\n", 4)
	if (closeIndex === -1) {
		return { body: content, frontmatter: null }
	}
	return {
		body: content.slice(closeIndex + 5),
		frontmatter: content.slice(4, closeIndex),
	}
}

export function stripFrontmatter(content: string): string {
	return parseFrontmatter(content).body
}

export function parseFrontmatterName(frontmatter: string): Option.Option<string> {
	for (const line of frontmatter.split("\n")) {
		const match = /^name:\s*(.+?)\s*$/.exec(line)
		if (match?.[1] === undefined) {
			continue
		}
		return Option.some(match[1].replace(/^(["'])(.*)\1$/, "$2"))
	}
	return Option.none()
}

const BLOCK_SCALAR = /^([>|])[+-]?$/

export function parseFrontmatterDescription(frontmatter: string): Option.Option<string> {
	const lines = frontmatter.split("\n")
	const start = lines.findIndex((line) => /^description:/.test(line))
	if (start === -1) {
		return Option.none()
	}
	const value = (lines[start] ?? "").slice("description:".length).trim()
	const block = BLOCK_SCALAR.exec(value)
	if (block?.[1] === undefined) {
		return value === "" ? Option.none() : Option.some(value.replace(/^(["'])(.*)\1$/, "$2"))
	}
	const body: Array<string> = []
	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && !/^\s/.test(line)) {
			break
		}
		body.push(line)
	}
	while (body.at(-1)?.trim() === "") {
		body.pop()
	}
	if (body.length === 0) {
		return Option.none()
	}
	if (block[1] === "|") {
		const indent = Math.min(
			...body
				.filter((line) => line.trim() !== "")
				.map((line) => line.length - line.trimStart().length),
		)
		return Option.some(body.map((line) => line.slice(indent)).join("\n"))
	}
	return Option.some(
		body
			.map((line) => line.trim())
			.filter((line) => line !== "")
			.join(" "),
	)
}
