import { changedFile, createTestPolicy } from '../test-support/fixtures.ts'
import { type AssessmentInput, assessRisk } from './assess.ts'
import type { Policy } from './types.ts'

import { describe, expect, it } from 'vitest'

const policy: Policy = createTestPolicy({
  defaultTier: 'risky',
  zones: [
    { tier: 'safe', paths: ['**/*.md', 'docs/**'] },
    { tier: 'risky', paths: ['src/**'] },
    { tier: 'very-risky', paths: ['src/migrations/**'] },
  ],
  patterns: [{ tier: 'very-risky', paths: ['**/*.sql'], added: /\bDROP\b/i }],
})

const assess = (overrides: Partial<AssessmentInput>): ReturnType<typeof assessRisk> =>
  assessRisk({
    policy,
    files: [],
    protectedPaths: ['.merge-risk.yml'],
    totalFiles: 0,
    ...overrides,
  })

describe('assessRisk', () => {
  it('is safe when nothing changed', () => {
    expect(assess({}).tier).toBe('safe')
  })

  it('scores a file by its riskiest matching zone', () => {
    const result = assess({ files: [changedFile('src/migrations/README.md')] })
    expect(result.tier).toBe('very-risky')
    expect(result.files[0]).toMatchObject({ kind: 'zone', glob: 'src/migrations/**' })
  })

  it('gives a file that matches no zone the default tier', () => {
    expect(assess({ files: [changedFile('package.json')] }).files[0]).toMatchObject({
      kind: 'default',
      tier: 'risky',
    })
  })

  it('takes the riskiest file, however many safe files surround it', () => {
    const files = [
      ...Array.from({ length: 50 }, (_, index) => changedFile(`docs/page-${index}.md`)),
      changedFile('src/migrations/001.ts'),
    ]
    expect(assess({ files }).tier).toBe('very-risky')
  })

  it('checks the old path of a renamed file, so moving a file out of a zone still counts', () => {
    const file = changedFile('docs/old-migration.md', { previousPath: 'src/migrations/001.ts' })
    expect(assess({ files: [file] }).tier).toBe('very-risky')
  })

  it('raises the tier when an added line matches a content pattern', () => {
    const file = changedFile('db/cleanup.sql', { addedLines: ['select 1', 'drop table guests'] })
    expect(assess({ files: [file] }).files[0]).toMatchObject({
      kind: 'pattern',
      tier: 'very-risky',
      line: 'drop table guests',
    })
  })

  it('leaves the zone tier when no added line matches the pattern', () => {
    const file = changedFile('db/report.sql', { addedLines: ['select 1'] })
    expect(assess({ files: [file] }).tier).toBe('risky')
  })

  it('treats content it cannot read as a pattern hit', () => {
    const file = changedFile('db/huge.sql', { addedLines: undefined })
    expect(assess({ files: [file] }).files[0]).toMatchObject({
      kind: 'unreadable',
      tier: 'very-risky',
    })
  })

  it('makes any change to a protected path very risky, whatever its zone says', () => {
    const result = assess({
      files: [changedFile('.merge-risk.yml')],
      protectedPaths: ['.merge-risk.yml'],
    })
    expect(result.files[0]).toMatchObject({ kind: 'protected', tier: 'very-risky' })
  })

  it('keeps a protected file protected when it is renamed away', () => {
    const file = changedFile('docs/old-policy.md', { previousPath: '.merge-risk.yml' })
    expect(assess({ files: [file] }).files[0]).toMatchObject({ kind: 'protected' })
  })

  it('raises the tier by one step for a large change, not counting excluded paths', () => {
    const sized = createTestPolicy({
      ...policy,
      size: { bumpAboveLines: 100, exclude: ['yarn.lock'] },
    })
    const small = [
      changedFile('docs/a.md', { additions: 60 }),
      changedFile('yarn.lock', { additions: 5000 }),
    ]
    const large = [
      changedFile('docs/a.md', { additions: 60 }),
      changedFile('docs/b.md', { additions: 41 }),
    ]
    expect(assess({ policy: sized, files: small })).toMatchObject({ tier: 'risky', change: [] })
    const result = assess({ policy: sized, files: large })
    expect(result.tier).toBe('risky')
    expect(result.change).toEqual([
      { kind: 'size', tier: 'risky', changedLines: 101, threshold: 100 },
    ])
  })

  it('is very risky when the platform could not list every changed file', () => {
    const result = assess({ files: [changedFile('docs/a.md')], totalFiles: 3001 })
    expect(result.tier).toBe('very-risky')
    expect(result.change[0]).toMatchObject({ kind: 'incomplete', listed: 1, total: 3001 })
  })
})
