import type { Tier } from './tier.ts'
import type { Policy } from './types.ts'

export type ReviewState = 'approved' | 'changes-requested' | 'dismissed' | 'commented'

// In submission order, oldest first.
export type Review = {
  reviewer: string
  isBot: boolean
  state: ReviewState
  commit: string | undefined
}

export type GateInput = {
  policy: Policy
  tier: Tier
  author: string
  headCommit: string
  reviews: readonly Review[]
}

export type GateState = 'success' | 'pending' | 'failure'

export type GateDecision = {
  state: GateState
  summary: string
  requiredApprovals: number
  approvedBy: readonly string[]
  changesRequestedBy: readonly string[]
}

// A comment leaves a reviewer's earlier verdict standing, as it does on GitHub.
const latestVerdicts = (reviews: readonly Review[]): Review[] => [
  ...reviews
    .filter((review) => review.state !== 'commented')
    .reduce((latest, review) => latest.set(review.reviewer, review), new Map<string, Review>())
    .values(),
]

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

const summarize = (
  required: number,
  approvedBy: readonly string[],
  blockers: readonly string[],
): GateDecision => {
  const base = { requiredApprovals: required, approvedBy, changesRequestedBy: blockers }
  if (blockers.length > 0) {
    return { ...base, state: 'failure', summary: `Changes requested by ${blockers.join(', ')}` }
  }
  const missing = required - approvedBy.length
  if (missing > 0) {
    return { ...base, state: 'pending', summary: `Needs ${plural(missing, 'more approval')}` }
  }
  const summary = required === 0 ? 'No review required' : `Approved by ${approvedBy.join(', ')}`
  return { ...base, state: 'success', summary }
}

export const decideGate = (input: GateInput): GateDecision => {
  const verdicts = latestVerdicts(input.reviews).filter(
    (review) => !review.isBot && review.reviewer !== input.author,
  )
  // An approval vouches for the commit it was given on; a later push needs a fresh one.
  const approvedBy = verdicts
    .filter((review) => review.state === 'approved' && review.commit === input.headCommit)
    .map((review) => review.reviewer)
  const blockers = verdicts
    .filter((review) => review.state === 'changes-requested')
    .map((review) => review.reviewer)
  return summarize(input.policy.tiers[input.tier].approvals, approvedBy, blockers)
}
