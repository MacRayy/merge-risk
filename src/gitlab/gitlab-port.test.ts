import type { ChangeRef } from '../core/review-port.ts'
import { type GitLabDiff, toGitLabChangedFile } from './gitlab-api.ts'
import { createGitLabPort, type GitLabPortConfig } from './gitlab-port.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

  const approvalRoutes =
    (approvedBy: ReadonlyArray<{ username: string; bot?: boolean }>, resetOnPush: boolean) =>
    (url: string): Route => {
      if (url.includes('/approvals') && url.includes('/merge_requests/'))
        return { body: { approved_by: approvedBy.map((user) => ({ user })) } }
      if (url.includes('/projects/42/approvals'))
        return { body: { reset_approvals_on_push: resetOnPush } }
      return { body: mr }
    }

  it('head-stamps approvals (so the gate counts them) when reset-on-push is ON', async () => {
    stubFetch(approvalRoutes([{ username: 'alice' }], true))
    const reviews = await createGitLabPort(config()).listReviews(PR)
    expect(reviews).toEqual([
      { reviewer: 'alice', isBot: false, hasWriteAccess: true, state: 'approved', commit: 'head' },
    ])
  })

  it('fails closed — no commit stamp (uncounted) + warns — when reset-on-push is OFF', async () => {
    const warn = vi.fn()
    stubFetch(approvalRoutes([{ username: 'alice' }], false))
    const reviews = await createGitLabPort(config(warn)).listReviews(PR)
    expect(reviews[0]?.commit).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT counted'))
  })

  it('flags the token user and service-account approvals as bots so they cannot satisfy review', async () => {
    stubFetch(
      approvalRoutes(
        [
          { username: 'merge-risk-bot' },
          { username: 'project_42_bot_abc' },
          { username: 'bob', bot: true },
        ],
        true,
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
      if (url.includes('/projects/42/approvals')) return { body: { reset_approvals_on_push: true } }
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
