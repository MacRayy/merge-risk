import { createGitHubPort } from './github-port.ts'
import { createGitHubGate } from './run-gate.ts'
import { workflowPathFromRef } from './workflow-path.ts'

import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'

const SUPPORTED_EVENTS = ['pull_request', 'pull_request_target', 'pull_request_review']

const pullRequestNumber = (): number => {
  const pr: unknown = context.payload.pull_request
  if (
    !SUPPORTED_EVENTS.includes(context.eventName) ||
    typeof pr !== 'object' ||
    pr === null ||
    !('number' in pr) ||
    typeof pr.number !== 'number'
  ) {
    throw new Error(`merge-risk runs on ${SUPPORTED_EVENTS.join(', ')}; got ${context.eventName}`)
  }
  return pr.number
}

const main = async (): Promise<void> => {
  const gate = createGitHubGate({
    port: createGitHubPort(getOctokit(core.getInput('github-token', { required: true }))),
    policyPath: core.getInput('policy-path', { required: true }),
    workflowPath: workflowPathFromRef(process.env['GITHUB_WORKFLOW_REF']),
    statusContext: core.getInput('status-context', { required: true }),
  })
  const { tier, decision, superseded } = await gate.run({
    ...context.repo,
    number: pullRequestNumber(),
  })
  if (superseded) {
    core.info('merge-risk: the PR changed during the run; the run for the new commit reports.')
    return
  }
  core.setOutput('tier', tier)
  core.setOutput('state', decision.state)
  core.info(`merge-risk: ${tier} (${decision.state}): ${decision.summary}`)
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
