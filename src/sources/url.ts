import { Effect, Option } from "effect"
import { InvalidArgument } from "#/errors.js"
import type { SourceOf } from "#/source.js"
import { fetchText } from "./http.js"
import type { SkillSource } from "./source.js"

export const UrlSource: SkillSource<SourceOf<"Url">> = {
	discover: (source) => {
		const pathname = new URL(source.url).pathname
		const name = pathname.slice(pathname.lastIndexOf("/") + 1).replace(/\.md$/, "")
		return Effect.succeed([
			{
				name,
				read: (file) =>
					Option.isSome(file)
						? Effect.fail(
								new InvalidArgument({
									message: "--file is not supported for https://…/*.md sources",
								}),
							)
						: fetchText(source.url),
				list: () =>
					Effect.fail(
						new InvalidArgument({ message: "Listing is not supported for https://…/*.md sources" }),
					),
			},
		])
	},
}
