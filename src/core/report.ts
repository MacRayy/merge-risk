import type { GateDecision } from './gate.ts'
import { type Tier, TIERS } from './tier.ts'
import type { Assessment, ChangeReason, FileReason, Policy } from './types.ts'

export const REPORT_MARKER = '<!-- merge-risk:report -->'

const MAX_LISTED_REASONS = 20

export const DEFAULT_GUIDES: Readonly<Record<Tier, string>> = {
  safe: 'No review is required. The change can be merged once the checks are green.',
  risky:
    'Review the shape of the change rather than every line: architecture, interfaces, function ' +
    'signatures and reuse. Then try the change by hand on a deployed environment.',
  'very-risky':
    'Review in depth, implementation details included, and try the change by hand on a deployed ' +
    'environment.',
}

export const guideFor = (policy: Policy, tier: Tier): string =>
  policy.tiers[tier].guide ?? DEFAULT_GUIDES[tier]

// Backticks inside the value would close the code span early and garble the rest of the line.
const code = (text: string): string => `\`${text.replaceAll('`', "'")}\``

export const describeFileReason = (reason: FileReason): string => {
  switch (reason.kind) {
    case 'protected':
      return 'changes the merge gate itself'
    case 'pattern':
      return `adds a line matching ${code(reason.pattern)}: ${code(reason.line)}`
    case 'unreadable':
      return `content not available to check against ${code(reason.pattern)}`
    case 'zone':
      return `matches ${code(reason.glob)}`
    case 'default':
      return 'matches no zone'
  }
}

export const describeChangeReason = (reason: ChangeReason): string => {
  switch (reason.kind) {
    case 'size':
      return `${reason.changedLines} changed lines, above the ${reason.threshold}-line threshold`
    case 'incomplete':
      return `only ${reason.listed} of ${reason.total} changed files could be listed`
  }
}

const GATE_LABELS: Readonly<Record<GateDecision['state'], string>> = {
  success: 'Ready to merge',
  pending: 'Waiting for review',
  failure: 'Blocked',
}

const deciding = (assessment: Assessment): FileReason[] =>
  assessment.files.filter((reason) => reason.tier === assessment.tier)

const fileLines = (reasons: readonly FileReason[]): string[] => {
  const listed = reasons
    .slice(0, MAX_LISTED_REASONS)
    .map((reason) => `- ${code(reason.path)}: ${describeFileReason(reason)}`)
  const hidden = reasons.length - listed.length
  return hidden > 0 ? [...listed, `- …and ${hidden} more`] : listed
}

const tierCounts = (assessment: Assessment): string =>
  TIERS.map((tier) => {
    const count = assessment.files.filter((reason) => reason.tier === tier).length
    return `${tier}: ${count}`
  }).join(' · ')

export type ReportInput = {
  policy: Policy
  assessment: Assessment
  decision: GateDecision
}

export const renderReport = ({ policy, assessment, decision }: ReportInput): string =>
  [
    REPORT_MARKER,
    `## Merge risk: \`${assessment.tier}\``,
    '',
    `**${GATE_LABELS[decision.state]}:** ${decision.summary}.`,
    '',
    '### Reviewer guide',
    '',
    guideFor(policy, assessment.tier),
    '',
    '### Why this tier',
    '',
    ...assessment.change.map((reason) => `- ${describeChangeReason(reason)}`),
    ...fileLines(deciding(assessment)),
    '',
    `<sub>Files by tier: ${tierCounts(assessment)} · ${assessment.changedLines} changed lines</sub>`,
    '',
  ].join('\n')
