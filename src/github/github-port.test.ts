import { toChangedFile, toReviews } from './github-port.ts'

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

  it('maps the review states the gate understands', () => {
    const reviews = toReviews([
      { user, state: 'APPROVED', commit_id: 'sha' },
      { user, state: 'CHANGES_REQUESTED', commit_id: 'sha' },
      { user, state: 'DISMISSED', commit_id: 'sha' },
      { user, state: 'COMMENTED', commit_id: null },
    ])
    expect(reviews.map((review) => [review.state, review.commit])).toEqual([
      ['approved', 'sha'],
      ['changes-requested', 'sha'],
      ['dismissed', 'sha'],
      ['commented', undefined],
    ])
  })

  it('drops pending reviews, unknown states and reviews from deleted accounts', () => {
    expect(
      toReviews([
        { user, state: 'PENDING', commit_id: 'sha' },
        { user, state: 'SOMETHING_NEW', commit_id: 'sha' },
        { user: null, state: 'APPROVED', commit_id: 'sha' },
      ]),
    ).toEqual([])
  })

  it('flags reviews from bot accounts', () => {
    const [review] = toReviews([
      { user: { login: 'ci[bot]', type: 'Bot' }, state: 'APPROVED', commit_id: 'sha' },
    ])
    expect(review).toMatchObject({ reviewer: 'ci[bot]', isBot: true })
  })
})
