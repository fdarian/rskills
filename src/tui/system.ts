import { Data, Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class SystemActionFailed extends Data.TaggedError("SystemActionFailed")<{
	readonly message: string
}> {}

const runExpectingZero = Effect.fn("runExpectingZero")(function* (
	command: ChildProcess.Command,
	toolName: string,
) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const code = yield* spawner
		.exitCode(command)
		.pipe(
			Effect.catchTag("PlatformError", (error) =>
				error.reason._tag === "NotFound"
					? new SystemActionFailed({ message: `${toolName} not found on PATH` })
					: new SystemActionFailed({ message: `${toolName} failed: ${error.message}` }),
			),
		)
	if (code !== 0) {
		return yield* new SystemActionFailed({ message: `${toolName} exited with code ${code}` })
	}
})

const withStdin = (command: string, text: string, args: ReadonlyArray<string> = []) =>
	ChildProcess.make(command, args, { stdin: Stream.encodeText(Stream.make(text)) })

export const copyToClipboard = Effect.fn("copyToClipboard")(function* (text: string) {
	const platform = process.platform
	if (platform === "darwin") {
		return yield* runExpectingZero(withStdin("pbcopy", text), "pbcopy")
	}
	if (platform === "win32") {
		return yield* runExpectingZero(withStdin("clip", text), "clip")
	}
	const waylandOk = yield* runExpectingZero(withStdin("wl-copy", text), "wl-copy").pipe(
		Effect.as(true),
		Effect.catchTag("SystemActionFailed", () => Effect.succeed(false)),
	)
	if (waylandOk) {
		return
	}
	return yield* runExpectingZero(withStdin("xclip", text, ["-selection", "clipboard"]), "xclip")
})

export const openUrl = Effect.fn("openUrl")(function* (url: string) {
	const platform = process.platform
	if (platform === "darwin") {
		return yield* runExpectingZero(ChildProcess.make("open", [url]), "open")
	}
	if (platform === "win32") {
		return yield* runExpectingZero(ChildProcess.make("cmd", ["/c", "start", "", url]), "start")
	}
	return yield* runExpectingZero(ChildProcess.make("xdg-open", [url]), "xdg-open")
})
