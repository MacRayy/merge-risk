import { evaluateLocally } from './evaluate.ts'
import { createGitPort } from './git-port.ts'
import { renderText } from './render-text.ts'

import { parseArgs } from 'node:util'

export const EVALUATE_USAGE = `Usage: merge-risk evaluate [--base <ref>] [--policy <path>] [--workflow <glob>] [--json]

Scores the current branch's committed changes against <ref> (default: origin/main).
--workflow names the gate's workflow file (default: .github/workflows/merge-risk.{yml,yaml}).`

// The local preview command: a cheap dry run that mirrors what CI will decide, using the git CLI
// rather than any review-host API.
export const runEvaluate = async (argv: readonly string[]): Promise<void> => {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    options: {
      base: { type: 'string', default: 'origin/main' },
      policy: { type: 'string', default: '.merge-risk.yml' },
      workflow: { type: 'string', default: '.github/workflows/merge-risk.{yml,yaml}' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(EVALUATE_USAGE)
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
