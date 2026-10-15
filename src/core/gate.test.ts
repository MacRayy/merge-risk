import { createTestPolicy } from '../test-support/fixtures.ts'
import { decideGate, type GateInput, type Review } from './gate.ts'

import { describe, expect, it } from 'vitest'

const review = (reviewer: string, state: Review['state'], commit = 'head'): Review => ({
  reviewer,
  isBot: false,
  hasWriteAccess: true,
  state,
  commit,
})

const decide = (overrides: Partial<GateInput>): ReturnType<typeof decideGate> =>
  decideGate({
    policy: createTestPolicy(),
    tier: 'risky',
    author: 'author',
    headCommit: 'head',
    reviews: [],
    ...overrides,
  })

describe('decideGate', () => {
  it('passes a safe change without review', () => {
    expect(decide({ tier: 'safe' })).toMatchObject({
      state: 'success',
      summary: 'No review required',
    })
  })

  it('waits for the approvals the tier requires', () => {
    expect(decide({})).toMatchObject({ state: 'pending', summary: 'Needs 1 more approval' })
  })

  it('passes once someone other than the author approves the head commit', () => {
    expect(decide({ reviews: [review('alice', 'approved')] })).toMatchObject({
      state: 'success',
      approvedBy: ['alice'],
    })
  })

  it("ignores the author's own approval and approvals from bots", () => {
    const reviews = [review('author', 'approved'), { ...review('ci', 'approved'), isBot: true }]
    expect(decide({ reviews }).state).toBe('pending')
  })

  it('ignores verdicts from reviewers without write access', () => {
    const outsider = { hasWriteAccess: false }
    const reviews = [
      { ...review('stranger', 'approved'), ...outsider },
      { ...review('troll', 'changes-requested'), ...outsider },
    ]
    expect(decide({ reviews })).toMatchObject({ state: 'pending', changesRequestedBy: [] })
  })

  it('ignores an approval given on an earlier commit', () => {
    expect(decide({ reviews: [review('alice', 'approved', 'old')] }).state).toBe('pending')
  })

  it('blocks while a reviewer has requested changes, even on a safe change', () => {
    const reviews = [review('alice', 'approved'), review('bob', 'changes-requested', 'old')]
    expect(decide({ tier: 'safe', reviews })).toMatchObject({
      state: 'failure',
      summary: 'Changes requested by bob',
    })
  })

  it("uses each reviewer's latest verdict, which a later comment does not replace", () => {
    const reviews = [
      review('bob', 'changes-requested'),
      review('bob', 'approved'),
      review('bob', 'commented'),
    ]
    expect(decide({ reviews }).state).toBe('success')
  })

  it('clears a request for changes once it is dismissed', () => {
    const reviews = [review('bob', 'changes-requested'), review('bob', 'dismissed')]
    expect(decide({ tier: 'safe', reviews }).state).toBe('success')
  })

  it('counts every missing approval', () => {
    const policy = createTestPolicy({
      tiers: { ...createTestPolicy().tiers, 'very-risky': { approvals: 2, guide: undefined } },
    })
    expect(decide({ policy, tier: 'very-risky' }).summary).toBe('Needs 2 more approvals')
  })
})
