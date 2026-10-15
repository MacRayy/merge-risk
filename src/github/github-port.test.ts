import { canPush, reviewersToCheck, toChangedFile, toReviews } from './github-port.ts'

import { describe, expect, it } from 'vitest'

const file = {
  filename: 'src/a.ts',
  additions: 1,
  deletions: 1,
}

describe('toChangedFile', () => {
  it('reads the added lines from the patch', () => {
    expect(toChangedFile({ ...file, patch: '@@ -1 +1 @@\n-a\n+b' })).toEqual({
      path: 'src/a.ts',
      previousPath: undefined,
      additions: 1,
      deletions: 1,
      addedLines: ['b'],
    })
  })

  it('marks content as unreadable when GitHub omits the patch of a file with additions', () => {
    expect(toChangedFile(file).addedLines).toBeUndefined()
  })

  it('treats an omitted patch without additions as nothing added', () => {
    expect(toChangedFile({ ...file, additions: 0 }).addedLines).toEqual([])
  })

  it('keeps the old path of a renamed file', () => {
    expect(toChangedFile({ ...file, previous_filename: 'src/old.ts' }).previousPath).toBe(
      'src/old.ts',
    )
  })
})

describe('toReviews', () => {
  const user = { login: 'alice', type: 'User' }
  const writers = new Set(['alice'])

  it('maps the review states the gate understands', () => {
    const reviews = toReviews(
      [
        { user, state: 'APPROVED', commit_id: 'sha' },
        { user, state: 'CHANGES_REQUESTED', commit_id: 'sha' },
        { user, state: 'DISMISSED', commit_id: 'sha' },
        { user, state: 'COMMENTED', commit_id: null },
      ],
      writers,
    )
    expect(reviews.map((review) => [review.state, review.commit])).toEqual([
      ['approved', 'sha'],
      ['changes-requested', 'sha'],
      ['dismissed', 'sha'],
      ['commented', undefined],
    ])
  })

  it('drops pending reviews, unknown states and reviews from deleted accounts', () => {
    expect(
      toReviews(
        [
          { user, state: 'PENDING', commit_id: 'sha' },
          { user, state: 'SOMETHING_NEW', commit_id: 'sha' },
          { user: null, state: 'APPROVED', commit_id: 'sha' },
        ],
        writers,
      ),
    ).toEqual([])
  })

  it('flags reviews from bot accounts', () => {
    const [review] = toReviews(
      [{ user: { login: 'ci[bot]', type: 'Bot' }, state: 'APPROVED', commit_id: 'sha' }],
      writers,
    )
    expect(review).toMatchObject({ reviewer: 'ci[bot]', isBot: true })
  })

  it('flags whether the reviewer has write access', () => {
    const reviews = toReviews(
      [
        { user, state: 'APPROVED', commit_id: 'sha' },
        { user: { login: 'outsider', type: 'User' }, state: 'APPROVED', commit_id: 'sha' },
      ],
      writers,
    )
    expect(reviews.map((review) => [review.reviewer, review.hasWriteAccess])).toEqual([
      ['alice', true],
      ['outsider', false],
    ])
  })
})

describe('reviewersToCheck', () => {
  it('lists each human reviewer once, skipping bots and deleted accounts', () => {
    const alice = { login: 'alice', type: 'User' }
    expect(
      reviewersToCheck([
        { user: alice, state: 'COMMENTED', commit_id: 'sha' },
        { user: alice, state: 'APPROVED', commit_id: 'sha' },
        { user: { login: 'ci[bot]', type: 'Bot' }, state: 'APPROVED', commit_id: 'sha' },
        { user: null, state: 'APPROVED', commit_id: 'sha' },
      ]),
    ).toEqual(['alice'])
  })
})

describe('canPush', () => {
  it('trusts only a user GitHub says can push', () => {
    const withPush = (push: boolean): { user: { permissions: { push: boolean } } } => ({
      user: { permissions: { push } },
    })
    expect([withPush(true), withPush(false), { user: {} }, { user: null }].map(canPush)).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})
