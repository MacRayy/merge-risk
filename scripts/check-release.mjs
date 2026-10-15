import { execFileSync } from 'node:child_process'

// Guards a publish by hand as much as one from CI: only a clean, fully checked tree with a
// freshly built dist/ may go out.
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })

const dirty = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()

if (dirty() !== '') {
  console.error(`The working tree has uncommitted changes:\n${dirty()}`)
  process.exit(1)
}
for (const script of ['lint', 'type-check', 'test', 'format-check', 'build']) {
  run('yarn', [script])
}
if (dirty() !== '') {
  console.error(`dist/ is stale: run \`yarn build\` and commit it.\n${dirty()}`)
  process.exit(1)
}
