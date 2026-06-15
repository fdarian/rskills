import { Effect, Fiber } from "effect"
import { Box, render, Text, useApp, useInput } from "ink"
import { useEffect, useRef, useState } from "react"
import { type AppRuntime, makeAppRuntime } from "#/runtime-layer.js"
import { readFromUri } from "#/sources/registry.js"
import { SkillsShSource } from "#/sources/skills-sh.js"
import type { SkillSearchResult } from "#/sources/source.js"
import { parse } from "#/uri.js"
import { humanizeInstalls } from "./humanize.js"
import { getInstallCommand } from "./install-command.js"
import { copyToClipboard, openUrl } from "./system.js"

type PickerOutcome = { readonly kind: "quit" } | { readonly kind: "read"; readonly id: string }

type SearchStatus = "idle" | "loading" | "ready" | "error"

const ACTIONS = [
	{ key: "read", label: "read SKILL.md" },
	{ key: "copy-id", label: "copy identifier" },
	{ key: "copy-install", label: "copy install command" },
	{ key: "open", label: "open on skills.sh" },
] as const

type ActionKey = (typeof ACTIONS)[number]["key"]

function searchSkills(query: string, limit: number) {
	return Effect.gen(function* () {
		if (SkillsShSource.search === undefined) {
			return yield* Effect.dieMessage("skills-sh source does not implement search")
		}
		return yield* SkillsShSource.search(query, limit)
	})
}

/** Derive the `owner/repo` identifier from a skills-sh id (`owner/repo/skillId`). */
function deriveSource(identifier: string) {
	const parts = identifier.split("/").filter((segment) => segment.length > 0)
	if (parts.length >= 2) {
		return `${parts[0]}/${parts[1]}`
	}
	return identifier
}

/** Index of the previous word boundary before `position` (skips trailing spaces, then a word). */
function wordBoundaryBefore(text: string, position: number) {
	let index = position
	while (index > 0 && text[index - 1] === " ") {
		index--
	}
	while (index > 0 && text[index - 1] !== " ") {
		index--
	}
	return index
}

type SearchPickerProps = {
	readonly runtime: AppRuntime
	readonly initialQuery: string
	readonly limit: number
	readonly onOutcome: (outcome: PickerOutcome) => void
}

function SearchPicker(props: SearchPickerProps) {
	const app = useApp()
	const [query, setQuery] = useState(props.initialQuery)
	const [cursor, setCursor] = useState(props.initialQuery.length)
	const [results, setResults] = useState<ReadonlyArray<SkillSearchResult>>([])
	const [status, setStatus] = useState<SearchStatus>(
		props.initialQuery.length > 0 ? "loading" : "idle",
	)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [screen, setScreen] = useState<"search" | "actions">("search")
	const [actionIndex, setActionIndex] = useState(0)
	const [feedback, setFeedback] = useState<string | null>(null)

	const fiberRef = useRef<Fiber.RuntimeFiber<void, never> | null>(null)
	const queryRef = useRef(query)
	queryRef.current = query

	useEffect(() => {
		if (query.length === 0) {
			if (fiberRef.current !== null) {
				props.runtime.runFork(Fiber.interrupt(fiberRef.current))
				fiberRef.current = null
			}
			setResults([])
			setStatus("idle")
			setErrorMessage(null)
			return
		}

		setStatus("loading")
		const timer = setTimeout(() => {
			if (fiberRef.current !== null) {
				props.runtime.runFork(Fiber.interrupt(fiberRef.current))
			}
			const effect = searchSkills(query, props.limit).pipe(
				Effect.match({
					onFailure: (error) => {
						if (queryRef.current !== query) {
							return
						}
						setErrorMessage(error.message)
						setStatus("error")
					},
					onSuccess: (found) => {
						if (queryRef.current !== query) {
							return
						}
						setResults(found)
						setSelectedIndex(0)
						setErrorMessage(null)
						setStatus("ready")
					},
				}),
			)
			fiberRef.current = props.runtime.runFork(effect)
		}, 250)

		return () => clearTimeout(timer)
	}, [query, props.limit, props.runtime])

	const moveSelection = (delta: number) => {
		setSelectedIndex((index) => {
			if (results.length === 0) {
				return 0
			}
			const next = index + delta
			if (next < 0) {
				return results.length - 1
			}
			if (next > results.length - 1) {
				return 0
			}
			return next
		})
	}

	const moveAction = (delta: number) => {
		setActionIndex((index) => {
			const next = index + delta
			if (next < 0) {
				return ACTIONS.length - 1
			}
			if (next > ACTIONS.length - 1) {
				return 0
			}
			return next
		})
	}

	const runAction = (actionKey: ActionKey) => {
		const selected = results[selectedIndex]
		if (selected === undefined) {
			return
		}

		if (actionKey === "read") {
			props.onOutcome({ kind: "read", id: selected.identifier })
			app.exit()
			return
		}

		if (actionKey === "copy-id") {
			setFeedback("Copying identifier…")
			const effect = copyToClipboard(selected.identifier).pipe(
				Effect.match({
					onFailure: (error) => `Copy failed: ${error.message}`,
					onSuccess: () => `Copied identifier: ${selected.identifier}`,
				}),
			)
			props.runtime.runPromise(effect).then(setFeedback)
			return
		}

		if (actionKey === "copy-install") {
			setFeedback("Fetching install command…")
			const effect = getInstallCommand(selected.identifier).pipe(
				Effect.flatMap((command) => copyToClipboard(command).pipe(Effect.as(command))),
				Effect.match({
					onFailure: (error) => `Copy install failed: ${error.message}`,
					onSuccess: (command) => `Copied install command: ${command}`,
				}),
			)
			props.runtime.runPromise(effect).then(setFeedback)
			return
		}

		const url = `https://www.skills.sh/${selected.identifier}`
		setFeedback(`Opening ${url}…`)
		const effect = openUrl(url).pipe(
			Effect.match({
				onFailure: (error) => `Open failed: ${error.message}`,
				onSuccess: () => `Opened ${url}`,
			}),
		)
		props.runtime.runPromise(effect).then(setFeedback)
	}

	useInput((input, key) => {
		if (screen === "actions") {
			if (key.escape) {
				setScreen("search")
				setFeedback(null)
				return
			}
			if (key.upArrow || (key.ctrl && input === "p")) {
				moveAction(-1)
				return
			}
			if (key.downArrow || (key.ctrl && input === "n")) {
				moveAction(1)
				return
			}
			if (key.return) {
				const action = ACTIONS[actionIndex]
				if (action !== undefined) {
					runAction(action.key)
				}
			}
			return
		}

		if (key.escape) {
			props.onOutcome({ kind: "quit" })
			app.exit()
			return
		}
		if (key.upArrow || (key.ctrl && input === "p")) {
			moveSelection(-1)
			return
		}
		if (key.downArrow || (key.ctrl && input === "n")) {
			moveSelection(1)
			return
		}
		if (key.return) {
			if (results.length > 0 && results[selectedIndex] !== undefined) {
				setActionIndex(0)
				setFeedback(null)
				setScreen("actions")
			}
			return
		}
		if (key.leftArrow) {
			setCursor((position) => Math.max(0, position - 1))
			return
		}
		if (key.rightArrow) {
			setCursor((position) => Math.min(query.length, position + 1))
			return
		}
		// delete entire line — ctrl+u (cmd+delete when the terminal maps it to ^U / 0x15)
		if (key.ctrl && input === "u") {
			setQuery("")
			setCursor(0)
			return
		}
		// delete previous word — opt+delete (meta+backspace) or ctrl+w
		if ((key.meta && (key.backspace || key.delete)) || (key.ctrl && input === "w")) {
			const start = wordBoundaryBefore(query, cursor)
			setQuery(query.slice(0, start) + query.slice(cursor))
			setCursor(start)
			return
		}
		// delete previous char
		if (key.backspace || key.delete) {
			if (cursor > 0) {
				setQuery(query.slice(0, cursor - 1) + query.slice(cursor))
				setCursor(cursor - 1)
			}
			return
		}
		// insert printable text at the cursor
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars from typed input is intentional
		const printable = input.replace(/[\x00-\x1F\x7F]/g, "")
		if (printable.length > 0 && !key.ctrl && !key.meta) {
			setQuery(query.slice(0, cursor) + printable + query.slice(cursor))
			setCursor(cursor + printable.length)
		}
	})

	if (screen === "actions") {
		return (
			<ActionsScreen
				result={results[selectedIndex]}
				actionIndex={actionIndex}
				feedback={feedback}
			/>
		)
	}

	return (
		<SearchScreen
			query={query}
			cursor={cursor}
			results={results}
			status={status}
			errorMessage={errorMessage}
			selectedIndex={selectedIndex}
		/>
	)
}

function QueryInput(props: { readonly value: string; readonly cursor: number }) {
	const before = props.value.slice(0, props.cursor)
	const atCursor = props.value.slice(props.cursor, props.cursor + 1)
	const after = props.value.slice(props.cursor + 1)
	return (
		<Text>
			{before}
			<Text inverse>{atCursor.length > 0 ? atCursor : " "}</Text>
			{after}
		</Text>
	)
}

type SearchScreenProps = {
	readonly query: string
	readonly cursor: number
	readonly results: ReadonlyArray<SkillSearchResult>
	readonly status: SearchStatus
	readonly errorMessage: string | null
	readonly selectedIndex: number
}

function SearchScreen(props: SearchScreenProps) {
	return (
		<Box flexDirection="column">
			<Box>
				<Text>{"  search › "}</Text>
				<QueryInput value={props.query} cursor={props.cursor} />
			</Box>
			<Box flexDirection="column" marginTop={1}>
				<SearchBody
					results={props.results}
					status={props.status}
					errorMessage={props.errorMessage}
					selectedIndex={props.selectedIndex}
				/>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>
					↑↓ · enter · esc quit · {props.results.length} results
				</Text>
			</Box>
		</Box>
	)
}

type SearchBodyProps = {
	readonly results: ReadonlyArray<SkillSearchResult>
	readonly status: SearchStatus
	readonly errorMessage: string | null
	readonly selectedIndex: number
}

function SearchBody(props: SearchBodyProps) {
	if (props.errorMessage !== null) {
		return <Text color="red">{`  ${props.errorMessage}`}</Text>
	}
	if (props.results.length > 0) {
		return (
			<Box flexDirection="column">
				<Box>
					<Box flexGrow={1}>
						<Text dimColor>{"  Skills"}</Text>
					</Box>
					<Box marginLeft={2}>
						<Text dimColor>Installs</Text>
					</Box>
				</Box>
				{props.results.map((result, index) => (
					<ResultRow
						key={result.identifier}
						result={result}
						selected={index === props.selectedIndex}
					/>
				))}
			</Box>
		)
	}
	if (props.status === "loading") {
		return <Text>{"  Searching…"}</Text>
	}
	if (props.status === "idle") {
		return <Text dimColor>{"  Type to search skills…"}</Text>
	}
	return <Text dimColor>{"  No matches"}</Text>
}

function ResultRow(props: { readonly result: SkillSearchResult; readonly selected: boolean }) {
	const source = deriveSource(props.result.identifier)
	const installs =
		props.result.installs !== undefined ? humanizeInstalls(props.result.installs) : "—"
	const prefix = props.selected ? "❯ " : "  "
	return (
		<Box>
			<Box flexGrow={1}>
				<Text {...(props.selected ? { color: "cyan" as const } : {})}>
					{`${prefix}${props.result.name}`}
				</Text>
				<Text dimColor>{` ${source}`}</Text>
			</Box>
			<Box marginLeft={2}>
				<Text>{installs}</Text>
			</Box>
		</Box>
	)
}

type ActionsScreenProps = {
	readonly result: SkillSearchResult | undefined
	readonly actionIndex: number
	readonly feedback: string | null
}

function ActionsScreen(props: ActionsScreenProps) {
	if (props.result === undefined) {
		return <Text>{"  No selection"}</Text>
	}
	return (
		<Box flexDirection="column">
			<Box>
				<Text>{`  ${props.result.name}`}</Text>
				<Text dimColor>{` ${deriveSource(props.result.identifier)}`}</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{ACTIONS.map((action, index) => (
					<Text
						key={action.key}
						{...(index === props.actionIndex ? { color: "cyan" as const } : {})}
					>
						{`${index === props.actionIndex ? "❯ " : "  "}${action.label}`}
					</Text>
				))}
			</Box>
			{props.feedback !== null ? (
				<Box marginTop={1}>
					<Text>{`  ${props.feedback}`}</Text>
				</Box>
			) : null}
			<Box marginTop={1}>
				<Text dimColor>↑↓ / ^p ^n navigate · enter select · esc back</Text>
			</Box>
		</Box>
	)
}

export async function runSearchPicker(options: {
	readonly initialQuery: string
	readonly limit: number
}) {
	const runtime = makeAppRuntime()
	const outcomeHolder: { current: PickerOutcome } = { current: { kind: "quit" } }

	const instance = render(
		<SearchPicker
			runtime={runtime}
			initialQuery={options.initialQuery}
			limit={options.limit}
			onOutcome={(outcome) => {
				outcomeHolder.current = outcome
			}}
		/>,
	)

	await instance.waitUntilExit()

	const outcome = outcomeHolder.current
	if (outcome.kind === "read") {
		const markdown = await runtime.runPromise(
			Effect.gen(function* () {
				const parsed = yield* parse(outcome.id)
				return yield* readFromUri(parsed)
			}),
		)
		process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`)
	}

	await runtime.dispose()
}
