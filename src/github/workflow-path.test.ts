import { workflowPathFromRef } from './workflow-path.ts'

import { describe, expect, it } from 'vitest'

describe('workflowPathFromRef', () => {
  it('extracts the workflow file from GITHUB_WORKFLOW_REF', () => {
    expect(
      workflowPathFromRef('attrecto/monorepo/.github/workflows/merge-risk.yml@refs/heads/main'),
    ).toBe('.github/workflows/merge-risk.yml')
  })

  it('returns nothing when the variable is missing or malformed', () => {
    expect(workflowPathFromRef(undefined)).toBeUndefined()
    expect(workflowPathFromRef('not-a-ref')).toBeUndefined()
  })
})
