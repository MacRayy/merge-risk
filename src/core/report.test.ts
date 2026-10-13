import { changedFile, createTestPolicy } from '../test-support/fixtures.ts'
import { assessRisk } from './assess.ts'
import { decideGate } from './gate.ts'
import { DEFAULT_GUIDES, renderReport, REPORT_MARKER } from './report.ts'
import type { ChangedFile, Policy } from './types.ts'

import { describe, expect, it } from 'vitest'

const render = (files: readonly ChangedFile[], policy: Policy = createTestPolicy()): string => {
  const assessment = assessRisk({ policy, files, protectedPaths: [], totalFiles: files.length })
  const decision = decideGate({
    policy,
    tier: assessment.tier,
    author: 'author',
    headCommit: 'head',
    reviews: [],
  })
  return renderReport({ policy, assessment, decision })
}

describe('renderReport', () => {
  it('carries the marker the gate finds its own comment by', () => {
    expect(render([]).startsWith(REPORT_MARKER)).toBe(true)
  })

  it('states the tier, the gate state and the default guide', () => {
    const report = render([changedFile('src/a.ts')])
    expect(report).toContain('## Merge risk: `risky`')
    expect(report).toContain('**Waiting for review:** Needs 1 more approval.')
    expect(report).toContain(DEFAULT_GUIDES.risky)
    expect(report).toContain('- `src/a.ts`: matches no zone')
  })

  it("uses the policy's own guide for the tier when it has one", () => {
    const policy = createTestPolicy({
      tiers: { ...createTestPolicy().tiers, risky: { approvals: 1, guide: 'Test it on stage.' } },
    })
    expect(render([changedFile('src/a.ts')], policy)).toContain('Test it on stage.')
  })

  it('lists only the files that decided the tier, capped at twenty', () => {
    const policy = createTestPolicy({ zones: [{ tier: 'safe', paths: ['docs/**'] }] })
    const files = [
      changedFile('docs/a.md'),
      ...Array.from({ length: 25 }, (_, index) => changedFile(`src/${index}.ts`)),
    ]
    const report = render(files, policy)
    expect(report).not.toContain('docs/a.md`:')
    expect(report).toContain('- …and 5 more')
    expect(report).toContain('safe: 1 · risky: 25 · very-risky: 0')
  })

  it('keeps a backtick in an added line from breaking the code span', () => {
    const policy = createTestPolicy({
      patterns: [{ tier: 'very-risky', paths: ['**'], added: /DROP/ }],
    })
    const report = render([changedFile('a.sql', { addedLines: ['DROP TABLE `guests`'] })], policy)
    expect(report).toContain("`DROP TABLE 'guests'`")
  })
})
