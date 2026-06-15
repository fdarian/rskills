import { Effect, Fiber } from "effect"
import { Box, render, Text, useApp, useInput } from "ink"
import TextInput from "ink-text-input"
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

type SearchPickerProps = {
	readonly runtime: AppRuntime
	readonly initialQuery: string
	readonly limit: number
	readonly onOutcome: (outcome: PickerOutcome) => void
}

function SearchPicker(props: SearchPickerProps) {
	const app = useApp()
	const [query, setQuery] = useState(props.initialQuery)
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

	useInput((_input, key) => {
		if (screen === "actions") {
			if (key.escape) {
				setScreen("search")
				setFeedback(null)
				return
			}
			if (key.upArrow) {
				setActionIndex((i) => (i > 0 ? i - 1 : ACTIONS.length - 1))
				return
			}
			if (key.downArrow) {
				setActionIndex((i) => (i < ACTIONS.length - 1 ? i + 1 : 0))
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
		if (key.upArrow) {
			setSelectedIndex((i) => (i > 0 ? i - 1 : Math.max(results.length - 1, 0)))
			return
		}
		if (key.downArrow) {
			setSelectedIndex((i) => (results.length === 0 ? 0 : i < results.length - 1 ? i + 1 : 0))
			return
		}
		if (key.return) {
			if (results.length > 0 && results[selectedIndex] !== undefined) {
				setActionIndex(0)
				setFeedback(null)
				setScreen("actions")
			}
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
			onQueryChange={setQuery}
			results={results}
			status={status}
			errorMessage={errorMessage}
			selectedIndex={selectedIndex}
		/>
	)
}

type SearchScreenProps = {
	readonly query: string
	readonly onQueryChange: (value: string) => void
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
				<TextInput value={props.query} onChange={props.onQueryChange} />
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
				<Text dimColor>↑↓ navigate · enter · esc quit · {props.results.length} results</Text>
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
	const gutter = props.result.installs !== undefined ? humanizeInstalls(props.result.installs) : "—"
	const prefix = props.selected ? "❯ " : "  "
	const line = `${prefix}${gutter.padStart(5)}  ${props.result.identifier}`
	return (
		<Text {...(props.selected ? { color: "cyan" as const } : {})} wrap="truncate-end">
			{line}
		</Text>
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
			<Text>{`  ${props.result.identifier}`}</Text>
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
				<Text dimColor>↑↓ navigate · enter select · esc back</Text>
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
