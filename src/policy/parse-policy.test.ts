import { parsePolicy, PolicyError } from './parse-policy.ts'

import { describe, expect, it } from 'vitest'

const minimal = `
version: 1
default-tier: risky
tiers:
  safe: { approvals: 0 }
  risky: { approvals: 1 }
  very-risky: { approvals: 1, guide: Read every line. }
`

describe('parsePolicy', () => {
  it('reads a full policy', () => {
    const policy = parsePolicy(`${minimal}
zones:
  - tier: very-risky
    paths: ['migrations/**']
patterns:
  - tier: very-risky
    paths: ['**/*.sql']
    added: '\\bdrop\\b'
    ignore-case: true
size:
  bump-above-lines: 600
  exclude: [yarn.lock]
`)
    expect(policy.defaultTier).toBe('risky')
    expect(policy.tiers['very-risky']).toEqual({ approvals: 1, guide: 'Read every line.' })
    expect(policy.zones).toEqual([{ tier: 'very-risky', paths: ['migrations/**'] }])
    expect(policy.patterns[0]?.added.test('DROP TABLE x')).toBe(true)
    expect(policy.size).toEqual({ bumpAboveLines: 600, exclude: ['yarn.lock'] })
  })

  it('fills in the optional sections', () => {
    expect(parsePolicy(minimal)).toMatchObject({
      zones: [],
      patterns: [],
      size: { bumpAboveLines: undefined, exclude: [] },
    })
  })

  it.each([
    ['an unknown tier', minimal.replace('default-tier: risky', 'default-tier: critical')],
    ['a missing tier', minimal.replace('  safe: { approvals: 0 }\n', '')],
    ['an unknown key', `${minimal}\nzone: []`],
    ['an unsupported version', minimal.replace('version: 1', 'version: 2')],
    ['an invalid pattern', `${minimal}\npatterns: [{ tier: risky, paths: ['*'], added: '(' }]`],
    ['a zone without paths', `${minimal}\nzones: [{ tier: risky, paths: [] }]`],
  ])('rejects %s', (_, text) => {
    expect(() => parsePolicy(text)).toThrow(PolicyError)
  })

  it('rejects text that is not YAML', () => {
    expect(() => parsePolicy('tiers: [')).toThrow(/not valid YAML/)
  })
})
