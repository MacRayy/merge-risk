import type { Review } from '../core/gate.ts'
import type { CommitStatus } from '../core/review-port.ts'
import type { ChangedFile } from '../core/types.ts'
import { summarizeHunks } from '../core/unified-diff.ts'

import { z } from 'zod'

const userSchema = z.object({ username: z.string(), bot: z.boolean().optional() })

export const mrSchema = z.object({
  author: userSchema,
  // Null while GitLab is still generating the diff just after an open/push; the caller retries.
  diff_refs: z.object({ base_sha: z.string(), head_sha: z.string() }).nullable(),
  // Null (alongside diff_refs) during that same async-generation window; `.nullish()` tolerates it.
  changes_count: z.string().nullish(),
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
  // GitLab withholds the patch (empty `diff`) for a diff it considers too large or collapses; these
  // flags are the authoritative "content was withheld" signal, independent of any rename/mode change.
  too_large: z.boolean().optional().default(false),
  collapsed: z.boolean().optional().default(false),
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

const UNREADABLE: DiffSummary = { addedLines: undefined, additions: 0, deletions: 0 }

// GitLab omits the diff for binary files (a "Binary files … differ" marker) and withholds it for a
// too-large/collapsed diff (an empty string on a file whose content it declined to send). Either way
// the content can't be shown harmless, so it counts as unreadable — mirrors the git-diff parser.
const diffSummary = (entry: GitLabDiff): DiffSummary => {
  if (entry.diff.startsWith(BINARY_MARKER)) return UNREADABLE
  // A withheld diff (too_large/collapsed) is unreadable regardless of any rename/mode flag — a rename
  // *with* a large content change carries renamed_file:true yet the content is still hidden, so the
  // flags must win over the "structural reason" heuristic below (otherwise it fails open).
  if (entry.too_large || entry.collapsed) return UNREADABLE
  if (entry.diff === '') {
    // A rename, delete, or mode-only change genuinely adds nothing. A *new* file with an empty diff is
    // GitLab withholding a too-large patch (new_file sets a_mode 0 → b_mode, so guard new_file out),
    // which must fail closed like a binary: unreadable → very-risky.
    const explainable =
      entry.renamed_file || entry.deleted_file || (entry.a_mode !== entry.b_mode && !entry.new_file)
    return explainable ? { addedLines: [], additions: 0, deletions: 0 } : UNREADABLE
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

type ApproverUser = { username: string; bot?: boolean | undefined }

// Project/group service accounts follow this naming; their approvals must not vouch for a change.
const BOT_USERNAME = /^(project|group)_\d+_bot(_|$)/

// The gate's own token user, a flagged bot, or a service account is not a human reviewer. This matters
// because MERGE_RISK_TOKEN is masked-but-unprotected (visible to every MR pipeline): without this, an
// MR author could POST .../approve from their own job and the bot approval would satisfy the gate.
export const isBotApprover = (user: ApproverUser, selfUsername: string): boolean =>
  user.bot === true || user.username === selfUsername || BOT_USERNAME.test(user.username)

// GitLab only lets a Developer+ approve, so a human approval carries write access. `commit` is stamped
// by the caller: the head SHA only when "reset approvals on push" is confirmed on (so the approval
// provably applies to the current head), otherwise undefined so the gate won't count a stale approval.
export const approvalReview = (
  user: ApproverUser,
  commit: string | undefined,
  selfUsername: string,
): Review => ({
  reviewer: user.username,
  isBot: isBotApprover(user, selfUsername),
  hasWriteAccess: true,
  state: 'approved',
  commit,
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
