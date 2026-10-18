import { Effect, Fiber, Option } from "effect"
import { Box, render, Text, useApp, useInput } from "ink"
import { useEffect, useRef, useState } from "react"
import {
	addToLibrary,
	findSaved,
	type LibraryEntry,
	loadLibrary,
	removeFromLibrary,
} from "#/library/library.js"
import { type AppRuntime, makeAppRuntime } from "#/runtime-layer.js"
import { readSkill } from "#/skills.js"
import { parseSkillIdentifier, searchSkillsSh } from "#/sources/skills-sh.js"
import type { SkillSearchResult } from "#/sources/source.js"
import { humanizeInstalls } from "./humanize.js"
import { getInstallCommand } from "./install-command.js"
import { copyToClipboard, openUrl } from "./system.js"

type PickerOutcome = { readonly kind: "quit" } | { readonly kind: "read"; readonly id: string }

type SearchStatus = "idle" | "loading" | "ready" | "error"

type ActionKey = "read" | "copy-id" | "copy-install" | "open" | "save" | "remove"

type Action = { readonly key: ActionKey; readonly label: string }

/** Failing to load the library must not block searching, so it is state rather than a crash. */
type LibraryState =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly entries: ReadonlyArray<LibraryEntry> }
	| { readonly kind: "error"; readonly message: string }

function savedEntry(library: LibraryState, identifier: string) {
	return library.kind === "ready" ? findSaved(library.entries, identifier) : Option.none()
}

/** Save/remove is offered only once the library loaded, so a broken file is never overwritten. */
function buildActions(library: LibraryState, identifier: string): ReadonlyArray<Action> {
	const actions: ReadonlyArray<Action> = [
		{ key: "read", label: "Read SKILL.md" },
		{ key: "copy-id", label: "Copy identifier" },
		{ key: "copy-install", label: "Copy install command" },
		{ key: "open", label: "Open on skills.sh" },
	]
	if (library.kind !== "ready") {
		return actions
	}
	return Option.isSome(findSaved(library.entries, identifier))
		? [...actions, { key: "remove", label: "Remove from library" }]
		: [...actions, { key: "save", label: "Save to library" }]
}

const SAVED_MARKER = " ★"

function savedMarker(library: LibraryState, identifier: string) {
	return Option.isSome(savedEntry(library, identifier)) ? SAVED_MARKER : ""
}

function libraryErrorLine(message: string) {
	return `Library unavailable, saving disabled: ${message}`
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function deriveSource(identifier: string) {
	return parseSkillIdentifier(identifier).source
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
	const [library, setLibrary] = useState<LibraryState>({ kind: "loading" })

	const fiberRef = useRef<Fiber.Fiber<void, never> | null>(null)
	const queryRef = useRef(query)
	queryRef.current = query

	useEffect(() => {
		const effect = loadLibrary().pipe(
			Effect.match({
				onFailure: (error): LibraryState => ({ kind: "error", message: error.message }),
				onSuccess: (entries): LibraryState => ({ kind: "ready", entries }),
			}),
		)
		props.runtime.runPromise(effect).then(setLibrary)
	}, [props.runtime])

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
			const effect = searchSkillsSh(query, props.limit).pipe(
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

	const selectedResult = results[selectedIndex]
	const actions =
		selectedResult === undefined ? [] : buildActions(library, selectedResult.identifier)

	const moveAction = (delta: number) => {
		setActionIndex((index) => {
			const next = index + delta
			if (next < 0) {
				return actions.length - 1
			}
			if (next > actions.length - 1) {
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
			const command = getInstallCommand(selected.identifier)
			setFeedback("Copying install command…")
			const effect = copyToClipboard(command).pipe(
				Effect.as(command),
				Effect.match({
					onFailure: (error) => `Copy install failed: ${error.message}`,
					onSuccess: (command) => `Copied install command: ${command}`,
				}),
			)
			props.runtime.runPromise(effect).then(setFeedback)
			return
		}

		if (actionKey === "save") {
			setFeedback(`Saving ${selected.identifier}…`)
			const effect = addToLibrary({
				source: selected.identifier,
				skill: Option.none(),
				tags: [],
				note: Option.none(),
				as: Option.none(),
			}).pipe(
				Effect.match({
					onFailure: (error) => `Save failed: ${error.message}`,
					onSuccess: (saved) => {
						setLibrary((current) =>
							current.kind === "ready"
								? {
										kind: "ready",
										entries: [
											...current.entries.filter((entry) => !sameName(entry.name, saved.name)),
											saved,
										],
									}
								: current,
						)
						return `Saved to library as ${saved.name}`
					},
				}),
			)
			props.runtime.runPromise(effect).then(setFeedback)
			return
		}

		if (actionKey === "remove") {
			const saved = savedEntry(library, selected.identifier)
			if (Option.isNone(saved)) {
				return
			}
			setFeedback(`Removing ${saved.value.name}…`)
			const effect = removeFromLibrary(saved.value.name).pipe(
				Effect.match({
					onFailure: (error) => `Remove failed: ${error.message}`,
					onSuccess: (removed) => {
						setLibrary((current) =>
							current.kind === "ready"
								? {
										kind: "ready",
										entries: current.entries.filter((entry) => !sameName(entry.name, removed.name)),
									}
								: current,
						)
						return `Removed from library: ${removed.name}`
					},
				}),
			)
			props.runtime.runPromise(effect).then(setFeedback)
			return
		}

		const parsed = parseSkillIdentifier(selected.identifier)
		const url = `https://www.skills.sh/${parsed.source}/${parsed.skillId}`
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
				const action = actions[actionIndex]
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
				result={selectedResult}
				actions={actions}
				actionIndex={actionIndex}
				feedback={feedback}
				libraryError={library.kind === "error" ? library.message : null}
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
			library={library}
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
	readonly library: LibraryState
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
					library={props.library}
				/>
			</Box>
			{props.library.kind === "error" ? (
				<Box marginTop={1}>
					<Text color="yellow">{`  ${libraryErrorLine(props.library.message)}`}</Text>
				</Box>
			) : null}
			<Box marginTop={1}>
				<Text dimColor>↑↓ · enter · esc quit · {props.results.length} results</Text>
			</Box>
		</Box>
	)
}

type SearchBodyProps = {
	readonly results: ReadonlyArray<SkillSearchResult>
	readonly status: SearchStatus
	readonly errorMessage: string | null
	readonly selectedIndex: number
	readonly library: LibraryState
}

function SearchBody(props: SearchBodyProps) {
	if (props.errorMessage !== null) {
		return <Text color="red">{`  ${props.errorMessage}`}</Text>
	}
	if (props.results.length > 0) {
		const skillsColumnWidth = Math.max(
			"  Skills".length,
			...props.results.map(
				(result) =>
					`  ${result.name} ${deriveSource(result.identifier)}${savedMarker(props.library, result.identifier)}`
						.length,
			),
		)
		return (
			<Box flexDirection="column">
				<Box>
					<Box width={skillsColumnWidth}>
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
						columnWidth={skillsColumnWidth}
						saved={Option.isSome(savedEntry(props.library, result.identifier))}
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

function ResultRow(props: {
	readonly result: SkillSearchResult
	readonly selected: boolean
	readonly columnWidth: number
	readonly saved: boolean
}) {
	const source = deriveSource(props.result.identifier)
	const installs =
		props.result.installs !== undefined ? humanizeInstalls(props.result.installs) : "—"
	const prefix = props.selected ? "❯ " : "  "
	return (
		<Box>
			<Box width={props.columnWidth}>
				<Text {...(props.selected ? { color: "cyan" as const } : {})}>
					{`${prefix}${props.result.name}`}
				</Text>
				<Text dimColor>{` ${source}`}</Text>
				{props.saved ? <Text color="green">{SAVED_MARKER}</Text> : null}
			</Box>
			<Box marginLeft={2}>
				<Text>{installs}</Text>
			</Box>
		</Box>
	)
}

type ActionsScreenProps = {
	readonly result: SkillSearchResult | undefined
	readonly actions: ReadonlyArray<Action>
	readonly actionIndex: number
	readonly feedback: string | null
	readonly libraryError: string | null
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
				{props.actions.map((action, index) => (
					<Text
						key={action.key}
						{...(index === props.actionIndex ? { color: "cyan" as const } : {})}
					>
						{`${index === props.actionIndex ? "❯ " : "  "}${action.label}`}
					</Text>
				))}
			</Box>
			{props.libraryError !== null ? (
				<Box marginTop={1}>
					<Text color="yellow">{`  ${libraryErrorLine(props.libraryError)}`}</Text>
				</Box>
			) : null}
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
				return yield* readSkill({
					source: outcome.id,
					skill: Option.none(),
					file: Option.none(),
					raw: false,
				})
			}),
		)
		process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`)
	}

	await runtime.dispose()
}
