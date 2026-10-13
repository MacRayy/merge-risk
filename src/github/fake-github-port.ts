import type { Review } from '../core/gate.ts'
import type { ChangedFile } from '../core/types.ts'
import type { CommitStatus, GitHubPort, IssueComment, PullRequest } from './port.ts'

export type FakeGitHubState = {
  pull: PullRequest
  files: ChangedFile[]
  // File contents by commit SHA, then by path.
  contents: Record<string, Record<string, string>>
  reviews: Review[]
  labels: string[]
  comments: IssueComment[]
  statuses: CommitStatus[]
  // Runs inside listFiles, to simulate a push landing mid-run.
  duringListFiles: (() => void) | undefined
  statusError: Error | undefined
}

export type FakeGitHub = {
  port: GitHubPort
  state: FakeGitHubState
}

export const createFakeGitHub = (initial: Partial<FakeGitHubState> = {}): FakeGitHub => {
  const state: FakeGitHubState = {
    pull: { author: 'author', baseSha: 'base-sha', headSha: 'head-sha', changedFiles: 0 },
    files: [],
    contents: {},
    reviews: [],
    labels: [],
    comments: [],
    statuses: [],
    duringListFiles: undefined,
    statusError: undefined,
    ...initial,
  }
  const port: GitHubPort = {
    getPullRequest: async () => ({ ...state.pull }),
    listFiles: async () => {
      const files = [...state.files]
      state.duringListFiles?.()
      return files
    },
    readFile: async (_pr, path, sha) => state.contents[sha]?.[path],
    listReviews: async () => [...state.reviews],
    listLabels: async () => [...state.labels],
    addLabel: async (_pr, label) => {
      state.labels.push(label)
    },
    removeLabel: async (_pr, label) => {
      state.labels = state.labels.filter((existing) => existing !== label)
    },
    listComments: async () => state.comments.map((comment) => ({ ...comment })),
    createComment: async (_pr, body) => {
      state.comments.push({ id: state.comments.length + 1, body, isBot: true })
    },
    updateComment: async (_pr, id, body) => {
      state.comments = state.comments.map((comment) =>
        comment.id === id ? { ...comment, body } : comment,
      )
    },
    setStatus: async (_pr, status) => {
      if (state.statusError !== undefined) throw state.statusError
      state.statuses.push(status)
    },
  }
  return { port, state }
}
