import type { Review } from '../core/gate.ts'
import type { CommitStatus } from '../core/review-port.ts'
import type { ChangedFile } from '../core/types.ts'
import { summarizeHunks } from '../core/unified-diff.ts'

import { z } from 'zod'

const userSchema = z.object({ username: z.string() })

export const mrSchema = z.object({
  author: userSchema,
  diff_refs: z.object({ base_sha: z.string(), head_sha: z.string() }),
  changes_count: z.string().optional(),
  labels: z.array(z.string()).default([]),
})

export const approvalsSchema = z.object({
  approved_by: z.array(z.object({ user: userSchema })).default([]),
})

export const projectApprovalsSchema = z.object({
  reset_approvals_on_push: z.boolean().default(false),
})

export const diffSchema = z.object({
  old_path: z.string(),
  new_path: z.string(),
  new_file: z.boolean().default(false),
  renamed_file: z.boolean().default(false),
  deleted_file: z.boolean().default(false),
  a_mode: z.string().default(''),
  b_mode: z.string().default(''),
  diff: z.string().default(''),
})

export const noteSchema = z.object({
  id: z.number(),
  body: z.string().default(''),
  system: z.boolean().default(false),
  author: userSchema,
})

export const externalCheckSchema = z.object({ id: z.number(), name: z.string() })

export type GitLabDiff = z.infer<typeof diffSchema>

type DiffSummary = {
  addedLines: readonly string[] | undefined
  additions: number
  deletions: number
}

const BINARY_MARKER = 'Binary files '

// GitLab omits the diff for binary files (a "Binary files … differ" marker) and may withhold it for a
// collapsed/too-large diff (an empty string on a file with no structural reason to be empty). Either
// way the content can't be shown harmless, so it counts as unreadable — mirrors the git-diff parser.
const diffSummary = (entry: GitLabDiff): DiffSummary => {
  if (entry.diff.startsWith(BINARY_MARKER))
    return { addedLines: undefined, additions: 0, deletions: 0 }
  if (entry.diff === '') {
    // A rename, delete, or mode-only change genuinely adds nothing. A *new* file with an empty diff is
    // GitLab withholding a too-large patch (new_file sets a_mode 0 → b_mode, so guard new_file out),
    // which must fail closed like a binary: unreadable → very-risky.
    const explainable =
      entry.renamed_file || entry.deleted_file || (entry.a_mode !== entry.b_mode && !entry.new_file)
    return explainable
      ? { addedLines: [], additions: 0, deletions: 0 }
      : { addedLines: undefined, additions: 0, deletions: 0 }
  }
  const hunks = summarizeHunks(entry.diff)
  return {
    addedLines: hunks.addedLines,
    additions: hunks.addedLines.length,
    deletions: hunks.deletions,
  }
}

export const toGitLabChangedFile = (entry: GitLabDiff): ChangedFile => {
  const summary = diffSummary(entry)
  return {
    path: entry.new_path,
    previousPath: entry.renamed_file ? entry.old_path : undefined,
    additions: summary.additions,
    deletions: summary.deletions,
    addedLines: summary.addedLines,
  }
}

// GitLab only lets a Developer+ approve and its approvals API carries no bot/commit fields, so the gate
// treats every current approval as a write-access human vouching for the current head.
export const approvalReview = (username: string, headCommit: string): Review => ({
  reviewer: username,
  isBot: false,
  hasWriteAccess: true,
  state: 'approved',
  commit: headCommit,
})

// NOTE: a "request changes" blocker is intentionally not mapped. GitLab's REST MR response has no
// per-reviewer review verdict — `reviewers[].state` is the account status (active/blocked), not
// REQUESTED_CHANGES (that lives only in GraphQL). Rather than key a hard block on a field that never
// carries the verdict (which would silently never block), the gate relies on the approval count; a
// changes-requested block can be added later via the GraphQL reviewState.

export const STATUS_STATE: Readonly<Record<CommitStatus['state'], string>> = {
  success: 'success',
  pending: 'pending',
  failure: 'failed',
  error: 'failed',
}

export const CHECK_STATUS: Readonly<Record<CommitStatus['state'], string>> = {
  success: 'passed',
  pending: 'pending',
  failure: 'failed',
  error: 'failed',
}
