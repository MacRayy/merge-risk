import { evaluateLocally } from './evaluate.ts'
import { createGitPort } from './git-port.ts'
import { renderText } from './render-text.ts'

import { parseArgs } from 'node:util'

const USAGE = `Usage: merge-risk evaluate [--base <ref>] [--policy <path>] [--workflow <glob>] [--json]

Scores the current branch's committed changes against <ref> (default: origin/main).
--workflow names the gate's workflow file (default: .github/workflows/merge-risk.{yml,yaml}).`

const main = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      base: { type: 'string', default: 'origin/main' },
      policy: { type: 'string', default: '.merge-risk.yml' },
      workflow: { type: 'string', default: '.github/workflows/merge-risk.{yml,yaml}' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help || positionals[0] !== 'evaluate') {
    console.log(USAGE)
    process.exitCode = values.help ? 0 : 1
    return
  }
  const evaluation = await evaluateLocally({
    git: createGitPort(process.cwd()),
    base: values.base,
    policyPath: values.policy,
    workflowPath: values.workflow,
  })
  console.log(values.json ? JSON.stringify(evaluation.assessment, null, 2) : renderText(evaluation))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
