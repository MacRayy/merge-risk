import type { Review } from '../core/gate.ts'
import type { ChangedFile } from '../core/types.ts'

export type PullRequestRef = {
  owner: string
  repo: string
  number: number
}

export type PullRequest = {
  author: string
  baseSha: string
  headSha: string
  changedFiles: number
}

export type IssueComment = {
  id: number
  body: string
  isBot: boolean
}

export type CommitStatus = {
  sha: string
  state: 'success' | 'pending' | 'failure' | 'error'
  context: string
  description: string
}

// The GitHub REST calls the gate makes, kept this narrow so a fake can stand in for them in tests.
export type GitHubPort = {
  getPullRequest: (pr: PullRequestRef) => Promise<PullRequest>
  listFiles: (pr: PullRequestRef) => Promise<ChangedFile[]>
  readFile: (pr: PullRequestRef, path: string, sha: string) => Promise<string | undefined>
  listReviews: (pr: PullRequestRef) => Promise<Review[]>
  listLabels: (pr: PullRequestRef) => Promise<string[]>
  addLabel: (pr: PullRequestRef, label: string) => Promise<void>
  removeLabel: (pr: PullRequestRef, label: string) => Promise<void>
  listComments: (pr: PullRequestRef) => Promise<IssueComment[]>
  createComment: (pr: PullRequestRef, body: string) => Promise<void>
  updateComment: (pr: PullRequestRef, id: number, body: string) => Promise<void>
  setStatus: (pr: PullRequestRef, status: CommitStatus) => Promise<void>
}
