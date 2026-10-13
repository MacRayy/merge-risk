import { isTier, maxTier, raiseTier } from './tier.ts'

import { describe, expect, it } from 'vitest'

describe('tiers', () => {
  it('takes the highest tier, and safe when there is none', () => {
    expect(maxTier(['risky', 'safe', 'very-risky', 'risky'])).toBe('very-risky')
    expect(maxTier([])).toBe('safe')
  })

  it('raises a tier by one step and stops at the top', () => {
    expect(raiseTier('safe')).toBe('risky')
    expect(raiseTier('risky')).toBe('very-risky')
    expect(raiseTier('very-risky')).toBe('very-risky')
  })

  it('recognises tier names only', () => {
    expect(isTier('risky')).toBe(true)
    expect(isTier('critical')).toBe(false)
    expect(isTier(1)).toBe(false)
  })
})
