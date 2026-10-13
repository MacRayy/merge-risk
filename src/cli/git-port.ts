import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const MAX_BUFFER = 256 * 1024 * 1024

export type GitPort = {
  // The branch's changes since it forked from `base`, as unified diff text.
  diff: (base: string) => Promise<string>
  show: (ref: string, path: string) => Promise<string | undefined>
}

export const createGitPort = (cwd: string): GitPort => {
  const git = async (args: readonly string[]): Promise<string> => {
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  }
  return {
    diff: async (base) =>
      await git(['diff', '--no-color', '--no-ext-diff', '-M', `${base}...HEAD`]),
    show: async (ref, path) => {
      try {
        return await git(['show', `${ref}:${path}`])
      } catch {
        return undefined
      }
    },
  }
}
