// Build the browser client bundle for dsh-bash-terminal.
// Output: dist/client.js — a __ModuleLoader__.load({ id, factory }) wrapper
// around the esbuild CJS bundle; shared deps (react, @deepseek-ai/*) resolve
// through the loader's require.

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "dist"), { recursive: true });

await build({
  entryPoints: [join(root, "src", "client.jsx")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  outfile: join(root, "dist", "client.core.js"),
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  jsx: "automatic",
  // Pin the TS options instead of letting esbuild discover a tsconfig by walking
  // up from the entry point. The repo root has a tsconfig.json, so in-repo builds
  // silently inherited it and emitted a leading "use strict"; while a byte-for-byte
  // identical build from a worktree outside the repo (no tsconfig above it) did not
  // — same source, two different committed artifacts. These values are what the
  // root tsconfig actually supplied. The one observable delta is that stray
  // "use strict"; (inert: the core is wrapped in a function expression by the
  // loader shim below, so it was never a directive prologue), now gone everywhere.
  tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true } },
  logLevel: "warning"
});

const core = readFileSync(join(root, "dist", "client.core.js"), "utf8");
const wrapper = `window.__ModuleLoader__.load({
	id: "dsh-bash-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${core}
		return module.exports;
	}
});
`;
writeFileSync(join(root, "dist", "client.js"), wrapper);
console.log("built dist/client.js (" + wrapper.length + " bytes)");
