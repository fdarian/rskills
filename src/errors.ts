import { Data } from "effect"

export class NotFound extends Data.TaggedError("NotFound")<{
	readonly message: string
}> {}

export class FetchFailed extends Data.TaggedError("FetchFailed")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class ParseFailed extends Data.TaggedError("ParseFailed")<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class UnsupportedScheme extends Data.TaggedError("UnsupportedScheme")<{
	readonly scheme: string
}> {}

export class InvalidArgument extends Data.TaggedError("InvalidArgument")<{
	readonly message: string
}> {}

export class RateLimited extends Data.TaggedError("RateLimited")<{
	readonly message: string
}> {}

export class IsDirectory extends Data.TaggedError("IsDirectory")<{
	readonly message: string
}> {}
