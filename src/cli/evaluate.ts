import { assessRisk } from '../core/assess.ts'
import type { Assessment, Policy } from '../core/types.ts'
import { parseUnifiedDiff } from '../core/unified-diff.ts'
import { parsePolicy, PolicyError } from '../policy/parse-policy.ts'
import type { GitPort } from './git-port.ts'

export type LocalEvaluation = {
  policy: Policy
  assessment: Assessment
}

export type LocalEvaluationInput = {
  git: GitPort
  base: string
  policyPath: string
  // Glob for the workflow that runs the gate, which the gate protects like the policy.
  workflowPath: string
}

// Mirrors the gate: the policy comes from the base, so the preview matches what CI will decide.
export const evaluateLocally = async ({
  git,
  base,
  policyPath,
  workflowPath,
}: LocalEvaluationInput): Promise<LocalEvaluation> => {
  const [policyText, diff] = await Promise.all([git.show(base, policyPath), git.diff(base)])
  if (policyText === undefined) throw new PolicyError(`No ${policyPath} on ${base}`)
  const policy = parsePolicy(policyText)
  const files = parseUnifiedDiff(diff)
  return {
    policy,
    assessment: assessRisk({
      policy,
      files,
      protectedPaths: [policyPath, workflowPath],
      totalFiles: files.length,
    }),
  }
}
