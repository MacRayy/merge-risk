import { parseUnifiedDiff, summarizeHunks } from './unified-diff.ts'

import { describe, expect, it } from 'vitest'

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  '-const a = 1',
  '+const a = 2',
  '+++counter',
  ' unchanged',
  'diff --git a/new.sql b/new.sql',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.sql',
  '@@ -0,0 +1 @@',
  '+DROP TABLE guests',
  'diff --git a/gone.ts b/gone.ts',
  'deleted file mode 100644',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export {}',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 100%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  'diff --git a/logo.png b/logo.png',
  'new file mode 100644',
  'Binary files /dev/null and b/logo.png differ',
  '',
].join('\n')

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(diff)
  const byPath = new Map(files.map((file) => [file.path, file]))

  it('lists every file in the diff', () => {
    expect(files.map((file) => file.path)).toEqual([
      'src/a.ts',
      'new.sql',
      'gone.ts',
      'new/name.ts',
      'logo.png',
    ])
  })

  it('counts added and deleted lines, including added content that starts with ++', () => {
    expect(byPath.get('src/a.ts')).toMatchObject({
      additions: 2,
      deletions: 1,
      addedLines: ['const a = 2', '++counter'],
    })
  })

  it('takes the old path of a deleted file', () => {
    expect(byPath.get('gone.ts')).toMatchObject({ additions: 0, deletions: 1, addedLines: [] })
  })

  it('records where a renamed file came from', () => {
    expect(byPath.get('new/name.ts')).toMatchObject({ previousPath: 'old/name.ts', additions: 0 })
  })

  it('marks binary content as unreadable', () => {
    expect(byPath.get('logo.png')?.addedLines).toBeUndefined()
  })

  it('drops the tab git appends to a path that contains a space', () => {
    const spaced = [
      'diff --git a/my doc.md b/my doc.md',
      '--- a/my doc.md\t',
      '+++ b/my doc.md\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    expect(parseUnifiedDiff(spaced)[0]?.path).toBe('my doc.md')
  })

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('summarizeHunks', () => {
  it('reads a GitHub patch, which has no file headers', () => {
    expect(summarizeHunks('@@ -1 +1,2 @@\n-a\n+b\n+++c')).toEqual({
      addedLines: ['b', '++c'],
      deletions: 1,
    })
  })
})
