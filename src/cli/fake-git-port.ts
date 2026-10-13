import type { GitPort } from './git-port.ts'

export type FakeGitState = {
  diff: string
  // File contents by ref, then by path.
  files: Record<string, Record<string, string>>
}

export const createFakeGitPort = (state: FakeGitState): GitPort => ({
  diff: async () => state.diff,
  show: async (ref, path) => state.files[ref]?.[path],
})
