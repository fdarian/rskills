import { Command } from "@effect/platform"
import { Data, Effect } from "effect"

export class SystemActionFailed extends Data.TaggedError("SystemActionFailed")<{
	readonly message: string
}> {}

const runExpectingZero = (command: Command.Command, toolName: string) =>
	Command.exitCode(command).pipe(
		Effect.catchTag("SystemError", (error) =>
			error.reason === "NotFound"
				? new SystemActionFailed({ message: `${toolName} not found on PATH` })
				: new SystemActionFailed({ message: `${toolName} failed: ${error.message}` }),
		),
		Effect.catchTag("BadArgument", (error) =>
			Effect.fail(new SystemActionFailed({ message: `${toolName} failed: ${error.message}` })),
		),
		Effect.flatMap((code) =>
			code === 0
				? Effect.void
				: Effect.fail(new SystemActionFailed({ message: `${toolName} exited with code ${code}` })),
		),
	)

export const copyToClipboard = Effect.fn("copyToClipboard")(function* (text: string) {
	const platform = process.platform
	if (platform === "darwin") {
		return yield* runExpectingZero(Command.make("pbcopy").pipe(Command.feed(text)), "pbcopy")
	}
	if (platform === "win32") {
		return yield* runExpectingZero(Command.make("clip").pipe(Command.feed(text)), "clip")
	}
	const waylandOk = yield* runExpectingZero(
		Command.make("wl-copy").pipe(Command.feed(text)),
		"wl-copy",
	).pipe(
		Effect.as(true),
		Effect.catchTag("SystemActionFailed", () => Effect.succeed(false)),
	)
	if (waylandOk) {
		return
	}
	return yield* runExpectingZero(
		Command.make("xclip", "-selection", "clipboard").pipe(Command.feed(text)),
		"xclip",
	)
})

export const openUrl = Effect.fn("openUrl")(function* (url: string) {
	const platform = process.platform
	if (platform === "darwin") {
		return yield* runExpectingZero(Command.make("open", url), "open")
	}
	if (platform === "win32") {
		return yield* runExpectingZero(Command.make("cmd", "/c", "start", "", url), "start")
	}
	return yield* runExpectingZero(Command.make("xdg-open", url), "xdg-open")
})
