import { describeChangeReason, describeFileReason, guideFor } from '../core/report.ts'
import { compareTiers } from '../core/tier.ts'
import type { LocalEvaluation } from './evaluate.ts'

export const renderText = ({ policy, assessment }: LocalEvaluation): string => {
  const files = [...assessment.files]
    .sort((a, b) => {
      const byTier = compareTiers(b.tier, a.tier)
      return byTier !== 0 ? byTier : a.path.localeCompare(b.path)
    })
    .map((reason) => `  ${reason.tier.padEnd(10)} ${reason.path}: ${describeFileReason(reason)}`)
  return [
    `Merge risk: ${assessment.tier}`,
    '',
    ...assessment.change.map(
      (reason) => `  ${reason.tier.padEnd(10)} ${describeChangeReason(reason)}`,
    ),
    ...files,
    '',
    guideFor(policy, assessment.tier),
    '',
  ].join('\n')
}
