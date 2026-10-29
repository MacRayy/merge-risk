import type { ChangeRef } from '../core/review-port.ts'
import {
  type GitLabDiff,
  type GitLabNote,
  isFreshApproval,
  latestApprovalTimes,
  latestPushTime,
  toGitLabChangedFile,
} from './gitlab-api.ts'
import { createGitLabPort, type GitLabPortConfig } from './gitlab-port.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'

const note = (over: Partial<GitLabNote>): GitLabNote => ({
  id: 1,
  body: 'approved this merge request',
  system: true,
  created_at: '2026-01-01T00:00:00Z',
  author: { username: 'alice' },
  ...over,
})

describe('latestApprovalTimes', () => {
  it('keeps the newest approval time per user and ignores non-approval / non-system notes', () => {
    const times = latestApprovalTimes([
      note({ author: { username: 'alice' }, created_at: '2026-01-01T00:00:00Z' }),
      note({ author: { username: 'alice' }, created_at: '2026-01-03T00:00:00Z' }),
      note({ author: { username: 'bob' }, body: 'commented', created_at: '2026-01-05T00:00:00Z' }),
      note({ author: { username: 'carol' }, system: false, created_at: '2026-01-05T00:00:00Z' }),
    ])
    expect(times.get('alice')).toBe(Date.parse('2026-01-03T00:00:00Z'))
    expect(times.has('bob')).toBe(false)
    expect(times.has('carol')).toBe(false)
  })
})

describe('latestPushTime', () => {
  it('returns the max time across all versions regardless of order, undefined when none', () => {
    expect(
      latestPushTime([
        { created_at: '2026-01-01T00:00:00Z' },
        { created_at: '2026-01-03T00:00:00Z' },
        { created_at: '2026-01-02T00:00:00Z' },
      ]),
    ).toBe(Date.parse('2026-01-03T00:00:00Z'))
    expect(latestPushTime([])).toBeUndefined()
    expect(latestPushTime([{ created_at: 'not-a-date' }])).toBeUndefined()
  })
})

describe('isFreshApproval', () => {
  it('trusts the approval when the push time is unknown (every-tier fallback)', () => {
    expect(isFreshApproval(undefined, undefined)).toBe(true)
  })
  it('counts an approval at/after the push and rejects one before it', () => {
    expect(isFreshApproval(200, 100)).toBe(true)
    expect(isFreshApproval(100, 100)).toBe(true)
    expect(isFreshApproval(50, 100)).toBe(false)
    expect(isFreshApproval(undefined, 100)).toBe(false)
  })
})

const diff = (over: Partial<GitLabDiff> = {}): GitLabDiff => ({
  old_path: 'src/a.ts',
  new_path: 'src/a.ts',
  new_file: false,
  renamed_file: false,
  deleted_file: false,
  a_mode: '100644',
  b_mode: '100644',
  too_large: false,
  collapsed: false,
  diff: '',
  ...over,
})

describe('toGitLabChangedFile', () => {
  it('reads added lines from a normal hunk', () => {
    const file = toGitLabChangedFile(
      diff({ diff: '@@ -0,0 +1,2 @@\n+added one\n+added two\n-gone' }),
    )
    expect(file).toMatchObject({ path: 'src/a.ts', additions: 2, deletions: 1 })
    expect(file.addedLines).toEqual(['added one', 'added two'])
  })

  it('marks a binary file as unreadable (addedLines undefined → very risky)', () => {
    const file = toGitLabChangedFile(
      diff({ diff: 'Binary files a/logo.png and b/logo.png differ' }),
    )
    expect(file.addedLines).toBeUndefined()
  })

  it('marks an empty diff on an otherwise-modified file as unreadable', () => {
    expect(toGitLabChangedFile(diff({ diff: '' })).addedLines).toBeUndefined()
  })

  it('treats an empty diff with a structural reason (rename / delete / mode) as nothing added', () => {
    expect(
      toGitLabChangedFile(diff({ diff: '', renamed_file: true, old_path: 'src/b.ts' })).addedLines,
    ).toEqual([])
    expect(toGitLabChangedFile(diff({ diff: '', deleted_file: true })).addedLines).toEqual([])
    expect(
      toGitLabChangedFile(diff({ diff: '', a_mode: '100644', b_mode: '100755' })).addedLines,
    ).toEqual([])
  })

  it('fails closed: a new file with a withheld (empty) diff is unreadable, not empty', () => {
    expect(
      toGitLabChangedFile(diff({ diff: '', new_file: true, a_mode: '0', b_mode: '100644' }))
        .addedLines,
    ).toBeUndefined()
  })

  it('fails closed: a too_large/collapsed diff is unreadable even with a rename or mode flag', () => {
    expect(
      toGitLabChangedFile(
        diff({ diff: '', too_large: true, renamed_file: true, old_path: 'src/b.ts' }),
      ).addedLines,
    ).toBeUndefined()
    expect(
      toGitLabChangedFile(diff({ diff: '', collapsed: true, a_mode: '100644', b_mode: '100755' }))
        .addedLines,
    ).toBeUndefined()
  })

  it('carries the previous path only for a rename', () => {
    expect(
      toGitLabChangedFile(diff({ renamed_file: true, old_path: 'src/old.ts', diff: '@@ @@\n+x' }))
        .previousPath,
    ).toBe('src/old.ts')
    expect(toGitLabChangedFile(diff({ diff: '@@ @@\n+x' })).previousPath).toBeUndefined()
  })
})

type Route = { body: unknown; status?: number; headers?: Record<string, string>; text?: string }

const response = ({ body, status = 200, headers = {}, text }: Route): Response =>
  new Response(text ?? JSON.stringify(body), { status, headers })

const PR: ChangeRef = { owner: '', repo: '', number: 7 }

const mr = {
  author: { username: 'nikolett' },
  diff_refs: { base_sha: 'base', head_sha: 'head' },
  changes_count: '3',
  labels: ['frontend'],
}

const stubFetch = (route: (url: string, method: string) => Route): void => {
  vi.stubGlobal('fetch', async (input: string, init?: { method?: string }) =>
    response(route(input, init?.method ?? 'GET')),
  )
}

const config = (warn = vi.fn()): GitLabPortConfig => ({
  apiUrl: 'https://gl/api/v4',
  projectId: '42',
  token: 'secret',
  selfUsername: 'merge-risk-bot',
  warn,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createGitLabPort', () => {
  it('reads the PR head/base/author and the file count from the X-Total header', async () => {
    stubFetch((url) =>
      url.includes('/diffs') ? { body: [], headers: { 'x-total': '128' } } : { body: mr },
    )
    const pull = await createGitLabPort(config()).getPullRequest(PR)
    expect(pull).toEqual({
      author: 'nikolett',
      baseSha: 'base',
      headSha: 'head',
      changedFiles: 128,
    })
  })

  it('falls back to changes_count when the X-Total header is absent', async () => {
    stubFetch((url) => (url.includes('/diffs') ? { body: [] } : { body: mr }))
    const pull = await createGitLabPort(config()).getPullRequest(PR)
    expect(pull.changedFiles).toBe(3)
  })

  type Approver = { username: string; bot?: boolean; approvedAt?: string }

  const approvalRoutes =
    (approvedBy: readonly Approver[], pushedAt: string) =>
    (url: string): Route => {
      if (url.includes('/versions')) return { body: [{ created_at: pushedAt }] }
      if (url.includes('/notes'))
        return {
          body: approvedBy
            .filter((user) => user.approvedAt !== undefined)
            .map((user, index) => ({
              id: index + 1,
              body: 'approved this merge request',
              system: true,
              created_at: user.approvedAt,
              author: { username: user.username },
            })),
        }
      if (url.includes('/approvals') && url.includes('/merge_requests/'))
        return {
          body: {
            approved_by: approvedBy.map((user) => ({
              user: { username: user.username, bot: user.bot },
            })),
          },
        }
      return { body: mr }
    }

  it('head-stamps an approval given after the last push (so the gate counts it)', async () => {
    stubFetch(
      approvalRoutes(
        [{ username: 'alice', approvedAt: '2026-01-02T00:00:00Z' }],
        '2026-01-01T00:00:00Z',
      ),
    )
    const reviews = await createGitLabPort(config()).listReviews(PR)
    expect(reviews).toEqual([
      { reviewer: 'alice', isBot: false, hasWriteAccess: true, state: 'approved', commit: 'head' },
    ])
  })

  it('fails closed — no commit stamp — on a stale approval given before the last push', async () => {
    stubFetch(
      approvalRoutes(
        [{ username: 'alice', approvedAt: '2026-01-01T00:00:00Z' }],
        '2026-01-02T00:00:00Z',
      ),
    )
    const reviews = await createGitLabPort(config()).listReviews(PR)
    expect(reviews[0]?.commit).toBeUndefined()
  })

  it('counts the approval on every tier even when no diff versions are returned', async () => {
    stubFetch((url) => {
      if (url.includes('/versions')) return { body: [] }
      if (url.includes('/notes')) return { body: [] }
      if (url.includes('/merge_requests/7/approvals'))
        return { body: { approved_by: [{ user: { username: 'alice' } }] } }
      return { body: mr }
    })
    const reviews = await createGitLabPort(config()).listReviews(PR)
    expect(reviews[0]?.commit).toBe('head')
  })

  it('takes the latest push time across all versions regardless of order (newest not first)', async () => {
    // The newest version is NOT element 0, so indexing [0] would wrongly treat the approval as fresh.
    stubFetch((url) => {
      if (url.includes('/versions'))
        return {
          body: [
            { created_at: '2026-01-01T00:00:00Z' },
            { created_at: '2026-01-03T00:00:00Z' },
            { created_at: '2026-01-02T00:00:00Z' },
          ],
        }
      if (url.includes('/notes'))
        return {
          body: [
            {
              id: 1,
              body: 'approved this merge request',
              system: true,
              created_at: '2026-01-02T12:00:00Z',
              author: { username: 'alice' },
            },
          ],
        }
      if (url.includes('/merge_requests/7/approvals'))
        return { body: { approved_by: [{ user: { username: 'alice' } }] } }
      return { body: mr }
    })
    const reviews = await createGitLabPort(config()).listReviews(PR)
    // Approved Jan 2, latest push Jan 3 → stale → uncounted (would be counted if [0]='Jan 1' were used).
    expect(reviews[0]?.commit).toBeUndefined()
  })

  it('pages the notes once across listReviews and listComments', async () => {
    const noteGets: string[] = []
    stubFetch((url, method) => {
      if (method === 'GET' && url.includes('/merge_requests/7/notes')) noteGets.push(url)
      if (url.includes('/merge_requests/7/approvals')) return { body: { approved_by: [] } }
      if (url.includes('/versions')) return { body: [] }
      if (url.includes('/notes')) return { body: [] }
      return { body: mr }
    })
    const port = createGitLabPort(config())
    await port.listReviews(PR)
    await port.listComments(PR)
    expect(noteGets).toHaveLength(1)
  })

  it('flags the token user and service-account approvals as bots so they cannot satisfy review', async () => {
    stubFetch(
      approvalRoutes(
        [
          { username: 'merge-risk-bot', approvedAt: '2026-01-02T00:00:00Z' },
          { username: 'project_42_bot_abc', approvedAt: '2026-01-02T00:00:00Z' },
          { username: 'bob', bot: true, approvedAt: '2026-01-02T00:00:00Z' },
        ],
        '2026-01-01T00:00:00Z',
      ),
    )
    const reviews = await createGitLabPort(config()).listReviews(PR)
    expect(reviews.map((review) => review.isBot)).toEqual([true, true, true])
  })

  it('throws a clear error when the MR diff is not ready (null diff_refs)', async () => {
    stubFetch((url) =>
      url.includes('/diffs')
        ? { body: [], headers: { 'x-total': '0' } }
        : { body: { ...mr, diff_refs: null, changes_count: null } },
    )
    await expect(createGitLabPort(config()).getPullRequest(PR)).rejects.toThrow('not ready')
  })

  it('tolerates a null changes_count and uses the X-Total header', async () => {
    stubFetch((url) =>
      url.includes('/diffs')
        ? { body: [], headers: { 'x-total': '5' } }
        : { body: { ...mr, changes_count: null } },
    )
    expect((await createGitLabPort(config()).getPullRequest(PR)).changedFiles).toBe(5)
  })

  it('fetches the MR once across listReviews and listLabels', async () => {
    const mrGets: string[] = []
    stubFetch((url, method) => {
      if (method === 'GET' && (url.split('?')[0] ?? '').endsWith('/merge_requests/7'))
        mrGets.push(url)
      if (url.includes('/merge_requests/7/approvals')) return { body: { approved_by: [] } }
      if (url.includes('/versions')) return { body: [] }
      if (url.includes('/notes')) return { body: [] }
      return { body: mr }
    })
    const port = createGitLabPort(config())
    await port.listReviews(PR)
    await port.listLabels(PR)
    expect(mrGets).toHaveLength(1)
  })

  it('recognises its own report note by the token username, and bot/system notes', async () => {
    stubFetch(() => ({
      body: [
        { id: 1, body: 'mine', system: false, author: { username: 'merge-risk-bot' } },
        { id: 2, body: 'human', system: false, author: { username: 'someone' } },
        { id: 3, body: 'sys', system: true, author: { username: 'someone' } },
      ],
    }))
    const comments = await createGitLabPort(config()).listComments(PR)
    expect(comments.map((comment) => comment.isBot)).toEqual([true, false, true])
  })

  it('posts a commit status and an external status check when one exists', async () => {
    const calls: Array<{ url: string; method: string }> = []
    stubFetch((url, method) => {
      calls.push({ url, method })
      if (url.includes('/external_status_checks')) return { body: [{ id: 9, name: 'merge-risk' }] }
      return { body: {} }
    })
    await createGitLabPort(config()).setStatus(PR, {
      sha: 'head',
      state: 'failure',
      context: 'merge-risk',
      description: 'very-risky: needs review',
    })
    const posts = calls.filter((call) => call.method === 'POST').map((call) => call.url)
    expect(posts.some((url) => url.includes('/statuses/head'))).toBe(true)
    expect(posts.some((url) => url.includes('/status_check_responses'))).toBe(true)
  })

  it('skips the external status check silently when none is configured', async () => {
    const calls: string[] = []
    stubFetch((url, method) => {
      if (method === 'POST') calls.push(url)
      if (url.includes('/external_status_checks')) return { body: [], status: 404 }
      return { body: {} }
    })
    await createGitLabPort(config()).setStatus(PR, {
      sha: 'head',
      state: 'success',
      context: 'merge-risk',
      description: 'safe',
    })
    expect(calls.some((url) => url.includes('/statuses/head'))).toBe(true)
    expect(calls.some((url) => url.includes('/status_check_responses'))).toBe(false)
  })
})
