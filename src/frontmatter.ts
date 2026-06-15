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
