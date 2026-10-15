import { build } from 'esbuild'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Bundled ESM still meets CommonJS dependencies that call `require`; the banner gives them one.
const banner =
  "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
}

// node_modules/@scope/name/... or node_modules/name/... → the package's directory.
const packageDirOf = (input) => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]

const licenceText = (dir) => {
  const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name))
  return file === undefined ? undefined : readFileSync(join(dir, file), 'utf8').trim()
}

// The bundles are redistributed, and the licences of what they bundle require their notices to
// travel with the copies. Most of those packages carry no @license comment for esbuild to keep.
const writeNotices = (metafile, outfile) => {
  const dirs = [...new Set(Object.keys(metafile.inputs).map(packageDirOf))]
    .filter((dir) => dir !== undefined && existsSync(join(dir, 'package.json')))
    .sort((a, b) => a.localeCompare(b))
  const sections = dirs.map((dir) => {
    const { name, version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const text = licenceText(dir)
    if (text === undefined) throw new Error(`${name} has no licence file to include`)
    return `${name}@${version} (${license})\n\n${text}`
  })
  const separator = `\n\n${'-'.repeat(80)}\n\n`
  writeFileSync(
    join(dirname(outfile), 'THIRD-PARTY-NOTICES.txt'),
    `This bundle includes the following packages.${separator}${sections.join(separator)}\n`,
  )
}

const bundle = async (entry, outfile, bannerJs) => {
  const result = await build({ ...shared, banner: { js: bannerJs }, entryPoints: [entry], outfile })
  writeNotices(result.metafile, outfile)
}

await bundle('src/github/main.ts', 'dist/action/index.mjs', banner)
await bundle('src/cli/main.ts', 'dist/cli/index.mjs', `#!/usr/bin/env node\n${banner}`)
