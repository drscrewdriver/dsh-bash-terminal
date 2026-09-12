// Build the browser client bundle for dsh-bash-terminal.
// Output: lib/client.js (primary, consumed by DSH loader/reload precheck) and
// dist/client.js (legacy compatibility) — a __ModuleLoader__.load({ id, factory })
// wrapper around the esbuild CJS bundle; shared deps (react, @deepseek-ai/*)
// resolve through the loader's require.

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "dist"), { recursive: true });
mkdirSync(join(root, "lib"), { recursive: true });

await build({
  entryPoints: [join(root, "src", "client.tsx")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  outfile: join(root, "dist", "client.core.js"),
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  jsx: "automatic",
  // Pin the TS options instead of letting esbuild discover a tsconfig by walking
  // up from the entry point: an in-repo build found the repo-root tsconfig.json
  // (emitting a leading "use strict";) while the same source built from an
  // out-of-repo worktree did not — two different committed artifacts for one
  // source. These are the values that tsconfig actually supplied, so behavior is
  // unchanged; only the stray line disappears.
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
writeFileSync(join(root, "lib", "client.js"), wrapper);
writeFileSync(join(root, "dist", "client.js"), wrapper);
console.log("built lib/client.js + dist/client.js (" + wrapper.length + " bytes)");
