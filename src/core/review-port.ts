import type { Review } from './gate.ts'
import type { ChangedFile } from './types.ts'

export type ChangeRef = {
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

// The review-host REST calls the gate makes, kept this narrow so a fake can stand in for them in tests.
export type ReviewPort = {
  getPullRequest: (pr: ChangeRef) => Promise<PullRequest>
  listFiles: (pr: ChangeRef) => Promise<ChangedFile[]>
  readFile: (pr: ChangeRef, path: string, sha: string) => Promise<string | undefined>
  listReviews: (pr: ChangeRef) => Promise<Review[]>
  listLabels: (pr: ChangeRef) => Promise<string[]>
  addLabel: (pr: ChangeRef, label: string) => Promise<void>
  removeLabel: (pr: ChangeRef, label: string) => Promise<void>
  listComments: (pr: ChangeRef) => Promise<IssueComment[]>
  createComment: (pr: ChangeRef, body: string) => Promise<void>
  updateComment: (pr: ChangeRef, id: number, body: string) => Promise<void>
  setStatus: (pr: ChangeRef, status: CommitStatus) => Promise<void>
}
