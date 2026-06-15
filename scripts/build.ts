import { mkdirSync } from "node:fs"

mkdirSync("dist", { recursive: true })

/** Stub out react-devtools-core so Ink's devtools.js doesn't crash the Node bundle */
const devtoolsStubPlugin: import("bun").BunPlugin = {
	name: "react-devtools-core-stub",
	setup(build) {
		build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
			path: "react-devtools-core",
			namespace: "devtools-stub",
		}))
		build.onLoad({ filter: /.*/, namespace: "devtools-stub" }, () => ({
			contents: "export default { initialize() {}, connectToDevTools() {} }",
			loader: "js",
		}))
	},
}

const result = await Bun.build({
	entrypoints: ["src/cli.ts"],
	outdir: "dist",
	naming: "cli.js",
	target: "node",
	plugins: [devtoolsStubPlugin],
})

if (!result.success) {
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

const output = result.outputs[0]
if (output === undefined) {
	console.error("No output produced")
	process.exit(1)
}

console.log(`Built ${output.path} (${(output.size / 1024 / 1024).toFixed(2)} MB)`)
