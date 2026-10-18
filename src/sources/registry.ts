import type { Effect, Option } from "effect"
import type { Source } from "#/source.js"
import { ClaudeSource } from "./claude.js"
import { GitHubSource } from "./github.js"
import { LocalSource } from "./local.js"
import type { DiscoveredSkill, SkillEnv, SkillError } from "./source.js"
import { UrlSource } from "./url.js"
import { WellKnownSource } from "./well-known.js"

export function discoverSkills(
	source: Source,
	selector: Option.Option<string>,
): Effect.Effect<ReadonlyArray<DiscoveredSkill>, SkillError, SkillEnv> {
	switch (source._tag) {
		case "GitHub":
			return GitHubSource.discover(source, selector)
		case "WellKnown":
			return WellKnownSource.discover(source, selector)
		case "Url":
			return UrlSource.discover(source, selector)
		case "Local":
			return LocalSource.discover(source, selector)
		case "Claude":
			return ClaudeSource.discover(source, selector)
	}
}
