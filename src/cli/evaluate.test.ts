import { PolicyError } from '../policy/parse-policy.ts'
import { evaluateLocally } from './evaluate.ts'
import { createFakeGitPort } from './fake-git-port.ts'
import { renderText } from './render-text.ts'

import { describe, expect, it } from 'vitest'

const policy = `
version: 1
default-tier: risky
tiers:
  safe: { approvals: 0 }
  risky: { approvals: 1 }
  very-risky: { approvals: 1 }
zones:
  - tier: safe
    paths: ['docs/**']
`

const diff = [
  'diff --git a/docs/a.md b/docs/a.md',
  '--- a/docs/a.md',
  '+++ b/docs/a.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/.merge-risk.yml b/.merge-risk.yml',
  '--- a/.merge-risk.yml',
  '+++ b/.merge-risk.yml',
  '@@ -1 +1 @@',
  '-version: 1',
  '+version: 1 ',
  '',
].join('\n')

const evaluate = async (
  git: ReturnType<typeof createFakeGitPort>,
): ReturnType<typeof evaluateLocally> =>
  await evaluateLocally({
    git,
    base: 'origin/main',
    policyPath: '.merge-risk.yml',
    workflowPath: '.github/workflows/merge-risk.{yml,yaml}',
  })

describe('evaluateLocally', () => {
  it("scores the branch's diff against the base's policy", async () => {
    const git = createFakeGitPort({ diff, files: { 'origin/main': { '.merge-risk.yml': policy } } })
    const evaluation = await evaluate(git)
    expect(evaluation.assessment.tier).toBe('very-risky')
    const text = renderText(evaluation)
    expect(text.split('\n').slice(0, 4)).toEqual([
      'Merge risk: very-risky',
      '',
      '  very-risky .merge-risk.yml: changes the merge gate itself',
      '  safe       docs/a.md: matches `docs/**`',
    ])
  })

  it('protects the gate workflow, as the gate does', async () => {
    const git = createFakeGitPort({
      diff: diff.replaceAll('docs/a.md', '.github/workflows/merge-risk.yaml'),
      files: { 'origin/main': { '.merge-risk.yml': policy } },
    })
    const { assessment } = await evaluate(git)
    expect(assessment.files[0]).toMatchObject({
      kind: 'protected',
      path: '.github/workflows/merge-risk.yaml',
    })
  })

  it('fails when the base has no policy', async () => {
    const git = createFakeGitPort({ diff, files: {} })
    await expect(evaluate(git)).rejects.toThrow(PolicyError)
  })
})
