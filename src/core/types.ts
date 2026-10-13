import type { Tier } from './tier.ts'

export type ChangedFile = {
  path: string
  previousPath: string | undefined
  additions: number
  deletions: number
  // Undefined when the platform withheld the content (binary file, or a diff too large to show).
  addedLines: readonly string[] | undefined
}

export type TierRequirement = {
  approvals: number
  guide: string | undefined
}

export type Zone = {
  tier: Tier
  paths: readonly string[]
}

export type ContentPattern = {
  tier: Tier
  paths: readonly string[]
  added: RegExp
}

export type Policy = {
  defaultTier: Tier
  tiers: Readonly<Record<Tier, TierRequirement>>
  zones: readonly Zone[]
  patterns: readonly ContentPattern[]
  size: {
    bumpAboveLines: number | undefined
    exclude: readonly string[]
  }
}

export type FileReason =
  | { kind: 'protected'; tier: Tier; path: string }
  | { kind: 'pattern'; tier: Tier; path: string; pattern: string; line: string }
  | { kind: 'unreadable'; tier: Tier; path: string; pattern: string }
  | { kind: 'zone'; tier: Tier; path: string; glob: string }
  | { kind: 'default'; tier: Tier; path: string }

export type ChangeReason =
  | { kind: 'size'; tier: Tier; changedLines: number; threshold: number }
  | { kind: 'incomplete'; tier: Tier; listed: number; total: number }

export type Reason = FileReason | ChangeReason

export type Assessment = {
  tier: Tier
  files: readonly FileReason[]
  change: readonly ChangeReason[]
  changedLines: number
}
