import { TIERS } from '../core/tier.ts'
import type { Policy, TierRequirement } from '../core/types.ts'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export class PolicyError extends Error {
  override name = 'PolicyError'
}

const tierSchema = z.enum(TIERS)

const globsSchema = z.array(z.string().min(1)).min(1)

const requirementSchema = z.strictObject({
  approvals: z.int().min(0),
  guide: z.string().min(1).optional(),
})

const regexSource = z
  .string()
  .min(1)
  .refine(
    (source) => {
      try {
        return new RegExp(source) instanceof RegExp
      } catch {
        return false
      }
    },
    { message: 'Not a valid regular expression' },
  )

const policySchema = z.strictObject({
  version: z.literal(1),
  'default-tier': tierSchema,
  tiers: z.strictObject({
    safe: requirementSchema,
    risky: requirementSchema,
    'very-risky': requirementSchema,
  }),
  zones: z.array(z.strictObject({ tier: tierSchema, paths: globsSchema })).default([]),
  patterns: z
    .array(
      z.strictObject({
        tier: tierSchema,
        paths: globsSchema,
        added: regexSource,
        'ignore-case': z.boolean().default(false),
      }),
    )
    .default([]),
  size: z
    .strictObject({
      'bump-above-lines': z.int().positive().optional(),
      exclude: z.array(z.string().min(1)).default([]),
    })
    .default({ exclude: [] }),
})

type PolicyDocument = z.infer<typeof policySchema>

const toRequirement = (requirement: PolicyDocument['tiers']['safe']): TierRequirement => ({
  approvals: requirement.approvals,
  guide: requirement.guide,
})

const toPolicy = (document: PolicyDocument): Policy => ({
  defaultTier: document['default-tier'],
  tiers: {
    safe: toRequirement(document.tiers.safe),
    risky: toRequirement(document.tiers.risky),
    'very-risky': toRequirement(document.tiers['very-risky']),
  },
  zones: document.zones,
  patterns: document.patterns.map((pattern) => ({
    tier: pattern.tier,
    paths: pattern.paths,
    added: new RegExp(pattern.added, pattern['ignore-case'] ? 'i' : ''),
  })),
  size: { bumpAboveLines: document.size['bump-above-lines'], exclude: document.size.exclude },
})

const readYaml = (text: string): unknown => {
  try {
    return parseYaml(text)
  } catch (error) {
    throw new PolicyError(`The policy is not valid YAML: ${String(error)}`)
  }
}

export const parsePolicy = (text: string): Policy => {
  const result = policySchema.safeParse(readYaml(text))
  if (!result.success) {
    throw new PolicyError(`The policy is invalid:\n${z.prettifyError(result.error)}`)
  }
  return toPolicy(result.data)
}
