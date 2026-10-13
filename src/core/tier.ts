export const TIERS = ['safe', 'risky', 'very-risky'] as const

export type Tier = (typeof TIERS)[number]

const rank = (tier: Tier): number => TIERS.indexOf(tier)

export const isTier = (value: unknown): value is Tier =>
  typeof value === 'string' && (TIERS as readonly string[]).includes(value)

export const compareTiers = (a: Tier, b: Tier): number => rank(a) - rank(b)

export const maxTier = (tiers: readonly Tier[]): Tier =>
  tiers.reduce<Tier>((highest, tier) => (compareTiers(tier, highest) > 0 ? tier : highest), 'safe')

export const raiseTier = (tier: Tier): Tier =>
  TIERS[Math.min(rank(tier) + 1, TIERS.length - 1)] ?? tier
