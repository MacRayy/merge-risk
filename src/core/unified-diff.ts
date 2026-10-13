import type { ChangedFile } from './types.ts'

export type HunkSummary = {
  addedLines: string[]
  deletions: number
}

// Hunk bodies only: every line from the first `@@` on. Header lines never reach this function, so
// an added line whose content starts with `++` is still counted.
export const summarizeHunks = (hunks: string): HunkSummary => {
  const lines = hunks.split('\n')
  const start = lines.findIndex((line) => line.startsWith('@@'))
  const body = start === -1 ? lines : lines.slice(start)
  return {
    addedLines: body.filter((line) => line.startsWith('+')).map((line) => line.slice(1)),
    deletions: body.filter((line) => line.startsWith('-')).length,
  }
}

const headerValue = (headers: readonly string[], prefix: string): string | undefined =>
  headers.find((line) => line.startsWith(prefix))?.slice(prefix.length)

const sidePath = (header: string | undefined, side: 'a/' | 'b/'): string | undefined => {
  // Git ends the header with a tab when the path contains a space.
  const value = header?.split('\t')[0]
  if (value === undefined || value === '/dev/null') return undefined
  return value.startsWith(side) ? value.slice(side.length) : value
}

const pathFromDiffLine = (line: string): string => {
  const index = line.lastIndexOf(' b/')
  return index === -1 ? line : line.slice(index + ' b/'.length)
}

const parseFileChunk = (chunk: string): ChangedFile => {
  const lines = chunk.split('\n')
  const hunkStart = lines.findIndex((line) => line.startsWith('@@'))
  const headers = hunkStart === -1 ? lines : lines.slice(0, hunkStart)
  const renamedFrom = headerValue(headers, 'rename from ')
  const path =
    headerValue(headers, 'rename to ') ??
    sidePath(headerValue(headers, '+++ '), 'b/') ??
    sidePath(headerValue(headers, '--- '), 'a/') ??
    pathFromDiffLine(lines[0] ?? '')
  const isBinary = headers.some((line) => line.startsWith('Binary files '))
  const hunks = summarizeHunks(hunkStart === -1 ? '' : lines.slice(hunkStart).join('\n'))
  return {
    path,
    previousPath: renamedFrom,
    additions: hunks.addedLines.length,
    deletions: hunks.deletions,
    addedLines: isBinary ? undefined : hunks.addedLines,
  }
}

// Parses `git diff` output, which must be produced with `core.quotePath=false` so that paths
// outside ASCII arrive unquoted.
export const parseUnifiedDiff = (diff: string): ChangedFile[] =>
  diff
    .split(/^diff --git /m)
    .filter((chunk) => chunk.trim() !== '')
    .map(parseFileChunk)
