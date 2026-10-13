import { build } from 'esbuild'

// Bundled ESM still meets CommonJS dependencies that call `require`; the banner gives them one.
const banner = {
  js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
}

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'info',
}

await build({
  ...shared,
  banner,
  entryPoints: ['src/github/main.ts'],
  outfile: 'dist/action/index.mjs',
})

await build({
  ...shared,
  banner: { js: `#!/usr/bin/env node\n${banner.js}` },
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/cli/index.mjs',
})
