import { homedir } from "node:os"
import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { Effect } from "effect"
import { FetchFailed } from "#/errors.js"
import { parseFrontmatter } from "#/frontmatter.js"
import type { SkillReadOptions } from "./source.js"

export type ClaudeShell = "bash" | "powershell"

export const shellExecutionDisabledMessage = "[shell command execution disabled by policy]"

interface PlaceholderSpan {
	readonly start: number
	readonly end: number
	readonly command: string
}

function isWhitespace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r"
}

function isInlineBangPosition(body: string, bangIndex: number): boolean {
	if (bangIndex === 0) {
		return true
	}
	return isWhitespace(body[bangIndex - 1] ?? "")
}

function parseShellFromFrontmatterYaml(yaml: string): ClaudeShell {
	const lines = yaml.split("\n")
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("shell:")) {
			continue
		}
		let value = trimmed.slice("shell:".length).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		if (value.toLowerCase() === "powershell") {
			return "powershell"
		}
	}
	return "bash"
}

function findInlinePlaceholder(body: string, searchFrom: number): PlaceholderSpan | null {
	let pos = searchFrom
	while (pos < body.length) {
		const bangIndex = body.indexOf("!`", pos)
		if (bangIndex === -1) {
			return null
		}
		if (!isInlineBangPosition(body, bangIndex)) {
			pos = bangIndex + 2
			continue
		}
		const closeIndex = body.indexOf("`", bangIndex + 2)
		if (closeIndex === -1) {
			return null
		}
		const command = body.slice(bangIndex + 2, closeIndex)
		return { start: bangIndex, end: closeIndex + 1, command }
	}
	return null
}

function findFencedPlaceholder(body: string, searchFrom: number): PlaceholderSpan | null {
	let pos = searchFrom
	while (pos < body.length) {
		const openIndex = body.indexOf("```!", pos)
		if (openIndex === -1) {
			return null
		}
		const lineStart = openIndex === 0 ? 0 : body.lastIndexOf("\n", openIndex - 1) + 1
		const openLineEnd = body.indexOf("\n", openIndex)
		const openLine = body.slice(lineStart, openLineEnd === -1 ? body.length : openLineEnd)
		if (openLine.trim() !== "```!") {
			pos = openIndex + 4
			continue
		}
		const bodyStart = openLineEnd === -1 ? body.length : openLineEnd + 1
		let scan = bodyStart
		while (scan <= body.length) {
			const closeLineStart = scan
			const closeLineEnd = body.indexOf("\n", scan)
			const closeLine = body.slice(closeLineStart, closeLineEnd === -1 ? body.length : closeLineEnd)
			if (closeLine.trim() === "```") {
				const end = closeLineEnd === -1 ? body.length : closeLineEnd
				let command = body.slice(bodyStart, closeLineStart)
				if (command.endsWith("\n")) {
					command = command.slice(0, -1)
				}
				return { start: lineStart, end, command }
			}
			if (closeLineEnd === -1) {
				break
			}
			scan = closeLineEnd + 1
		}
		pos = openIndex + 4
	}
	return null
}

function collectPlaceholders(body: string): ReadonlyArray<PlaceholderSpan> {
	const spans: Array<PlaceholderSpan> = []
	let searchFrom = 0
	while (searchFrom < body.length) {
		const inline = findInlinePlaceholder(body, searchFrom)
		const fenced = findFencedPlaceholder(body, searchFrom)
		let next: PlaceholderSpan | null = null
		if (inline === null) {
			next = fenced
		} else if (fenced === null) {
			next = inline
		} else if (inline.start <= fenced.start) {
			next = inline
		} else {
			next = fenced
		}
		if (next === null) {
			break
		}
		spans.push(next)
		searchFrom = next.end
	}
	return spans
}

function shellCommand(shell: ClaudeShell, script: string): Command.Command {
	if (shell === "powershell") {
		return Command.make("pwsh", "-NoProfile", "-Command", script)
	}
	return Command.make("bash", "-c", script)
}

const runShellScript = Effect.fn("claude-preprocess.runShellScript")(function* (
	shell: ClaudeShell,
	script: string,
) {
	const executor = yield* CommandExecutor.CommandExecutor
	const cmd = shellCommand(shell, script)
	return yield* executor.string(cmd).pipe(
		Effect.mapError(
			(error) =>
				new FetchFailed({
					message: `Failed to run shell command: ${script}`,
					cause: error,
				}),
		),
	)
})

export const isShellExecutionDisabled = Effect.fn("claude-preprocess.isShellExecutionDisabled")(
	function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const settingsPaths = [
			path.join(process.cwd(), ".claude", "settings.json"),
			path.join(homedir(), ".claude", "settings.json"),
		]
		for (const settingsPath of settingsPaths) {
			const exists = yield* fs
				.exists(settingsPath)
				.pipe(Effect.catchAll(() => Effect.succeed(false)))
			if (!exists) {
				continue
			}
			const text = yield* fs
				.readFileString(settingsPath)
				.pipe(Effect.catchAll(() => Effect.succeed(null)))
			if (text === null) {
				continue
			}
			let parsed: unknown
			try {
				parsed = JSON.parse(text)
			} catch {
				continue
			}
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"disableSkillShellExecution" in parsed &&
				(parsed as { disableSkillShellExecution: unknown }).disableSkillShellExecution === true
			) {
				return true
			}
		}
		return false
	},
)

export const preprocessClaudeSkillContent = Effect.fn(
	"claude-preprocess.preprocessClaudeSkillContent",
)(function* (content: string, options: SkillReadOptions | undefined) {
	if (options?.raw === true) {
		return content
	}
	const parsed = parseFrontmatter(content)
	const shell =
		parsed.frontmatter === null ? "bash" : parseShellFromFrontmatterYaml(parsed.frontmatter)
	const disabled = yield* isShellExecutionDisabled()
	const spans = collectPlaceholders(parsed.body)
	if (spans.length === 0) {
		return parsed.body
	}
	let result = ""
	let cursor = 0
	for (const span of spans) {
		result += parsed.body.slice(cursor, span.start)
		if (disabled) {
			result += shellExecutionDisabledMessage
		} else {
			const output = yield* runShellScript(shell, span.command)
			result += output
		}
		cursor = span.end
	}
	result += parsed.body.slice(cursor)
	return result
})
