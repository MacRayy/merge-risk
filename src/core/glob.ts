import picomatch from 'picomatch'

export type PathMatcher = (path: string) => boolean

export const createPathMatcher = (globs: readonly string[]): PathMatcher =>
  picomatch([...globs], { dot: true })

export const findMatchingGlob = (globs: readonly string[], path: string): string | undefined =>
  globs.find((glob) => picomatch.isMatch(path, glob, { dot: true }))
