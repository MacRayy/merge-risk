import type { ChangedFile, Policy } from '../core/types.ts'

export const createTestPolicy = (overrides: Partial<Policy> = {}): Policy => ({
  defaultTier: 'risky',
  tiers: {
    safe: { approvals: 0, guide: undefined },
    risky: { approvals: 1, guide: undefined },
    'very-risky': { approvals: 1, guide: undefined },
  },
  zones: [],
  patterns: [],
  size: { bumpAboveLines: undefined, exclude: [] },
  ...overrides,
})

export const changedFile = (path: string, overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  previousPath: undefined,
  additions: 1,
  deletions: 0,
  addedLines: ['changed'],
  ...overrides,
})
