import { createGate } from '../core/run-gate.ts'
import { createGitLabPort } from './gitlab-port.ts'

import { z } from 'zod'

const userSchema = z.object({ username: z.string() })

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value === '') throw new Error(`merge-risk: ${name} is required`)
  return value
}

// Learn the token's own username so the gate recognises its own report note under any token.
const readSelfUsername = async (apiUrl: string, token: string): Promise<string> => {
  const res = await fetch(`${apiUrl}/user`, { headers: { 'PRIVATE-TOKEN': token } })
  if (!res.ok) throw new Error(`merge-risk: could not read the token user (GitLab ${res.status})`)
  const body: unknown = await res.json()
  return userSchema.parse(body).username
}

// The GitLab CI entry point: reads the merge-request context from the predefined CI variables, runs
// the same gate the GitHub Action runs, and sets the job exit code so "Pipelines must succeed" blocks.
export const runGitLabGate = async (): Promise<void> => {
  const iid = process.env['CI_MERGE_REQUEST_IID']
  if (iid === undefined || iid === '') {
    console.log('merge-risk: not a merge request pipeline; nothing to gate.')
    return
  }
  const apiUrl = required('CI_API_V4_URL', process.env['CI_API_V4_URL'])
  const projectId = required('CI_PROJECT_ID', process.env['CI_PROJECT_ID'])
  const token = required('MERGE_RISK_TOKEN', process.env['MERGE_RISK_TOKEN'])
  const policyPath = process.env['MERGE_RISK_POLICY'] ?? '.merge-risk.yml'
  const statusContext = process.env['MERGE_RISK_STATUS_CONTEXT'] ?? 'merge-risk'

  const selfUsername = await readSelfUsername(apiUrl, token)
  const port = createGitLabPort({
    apiUrl,
    projectId,
    token,
    selfUsername,
    warn: (message) => {
      console.warn(message)
    },
  })
  const gate = createGate({
    port,
    policyPath,
    // Editing the pipeline that runs the gate is as sensitive as editing the policy.
    workflowPath: '.gitlab-ci.yml',
    statusContext,
  })
  const { tier, decision, superseded } = await gate.run({
    owner: '',
    repo: '',
    number: Number(iid),
  })
  if (superseded) {
    console.log('merge-risk: the MR changed during the run; the run for the new commit reports.')
    return
  }
  console.log(`merge-risk: ${tier} (${decision.state}): ${decision.summary}`)
  process.exitCode = decision.state === 'success' ? 0 : 1
}
