import type { Review, ReviewState } from '../core/gate.ts'
import type { ChangedFile } from '../core/types.ts'
import { summarizeHunks } from '../core/unified-diff.ts'
import type { GitHubPort, PullRequestRef } from './port.ts'

import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

const PER_PAGE = 100

const REVIEW_STATES: Readonly<Record<string, ReviewState>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  DISMISSED: 'dismissed',
  COMMENTED: 'commented',
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 404

const ignoreNotFound = async <T>(request: Promise<T>): Promise<T | undefined> => {
  try {
    return await request
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

export const toChangedFile = (file: {
  filename: string
  previous_filename?: string
  additions: number
  deletions: number
  patch?: string
}): ChangedFile => {
  // GitHub drops the patch for binary files and very large diffs. With nothing added there is
  // nothing to check, so only an omitted patch with additions counts as unreadable.
  const addedLines =
    file.patch !== undefined
      ? summarizeHunks(file.patch).addedLines
      : file.additions === 0
        ? []
        : undefined
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    additions: file.additions,
    deletions: file.deletions,
    addedLines,
  }
}

export const toReviews = (
  reviews: ReadonlyArray<{
    user: { login: string; type: string } | null
    state: string
    commit_id: string | null
  }>,
): Review[] =>
  reviews.flatMap((review) => {
    const state = REVIEW_STATES[review.state]
    if (state === undefined || review.user === null) return []
    return [
      {
        reviewer: review.user.login,
        isBot: review.user.type === 'Bot',
        state,
        commit: review.commit_id ?? undefined,
      },
    ]
  })

export const createGitHubPort = (octokit: Octokit): GitHubPort => {
  const issue = (pr: PullRequestRef): { owner: string; repo: string; issue_number: number } => ({
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
  })
  const pull = (pr: PullRequestRef): { owner: string; repo: string; pull_number: number } => ({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
  })

  return {
    getPullRequest: async (pr) => {
      const { data } = await octokit.rest.pulls.get(pull(pr))
      return {
        author: data.user.login,
        baseSha: data.base.sha,
        headSha: data.head.sha,
        changedFiles: data.changed_files,
      }
    },
    listFiles: async (pr) => {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        ...pull(pr),
        per_page: PER_PAGE,
      })
      return files.map(toChangedFile)
    },
    readFile: async (pr, path, sha) => {
      const response = await ignoreNotFound(
        octokit.rest.repos.getContent({
          owner: pr.owner,
          repo: pr.repo,
          path,
          ref: sha,
          mediaType: { format: 'raw' },
        }),
      )
      // The raw media type returns the file body as a string; anything else means a directory.
      const data: unknown = response?.data
      return typeof data === 'string' ? data : undefined
    },
    listReviews: async (pr) => {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        ...pull(pr),
        per_page: PER_PAGE,
      })
      return toReviews(reviews)
    },
    listLabels: async (pr) => {
      const labels = await octokit.paginate(octokit.rest.issues.listLabelsOnIssue, {
        ...issue(pr),
        per_page: PER_PAGE,
      })
      return labels.map((label) => label.name)
    },
    addLabel: async (pr, label) => {
      await octokit.rest.issues.addLabels({ ...issue(pr), labels: [label] })
    },
    removeLabel: async (pr, label) => {
      await ignoreNotFound(octokit.rest.issues.removeLabel({ ...issue(pr), name: label }))
    },
    listComments: async (pr) => {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        ...issue(pr),
        per_page: PER_PAGE,
      })
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? '',
        isBot: comment.user?.type === 'Bot',
      }))
    },
    createComment: async (pr, body) => {
      await octokit.rest.issues.createComment({ ...issue(pr), body })
    },
    updateComment: async (pr, id, body) => {
      await octokit.rest.issues.updateComment({
        owner: pr.owner,
        repo: pr.repo,
        comment_id: id,
        body,
      })
    },
    setStatus: async (pr, status) => {
      await octokit.rest.repos.createCommitStatus({ owner: pr.owner, repo: pr.repo, ...status })
    },
  }
}
