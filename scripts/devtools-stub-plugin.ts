/** Stub out react-devtools-core so Ink's devtools.js import doesn't crash the bundle */
export const devtoolsStubPlugin: import("bun").BunPlugin = {
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
