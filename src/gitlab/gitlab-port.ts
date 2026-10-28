import type { ChangeRef, IssueComment, ReviewPort } from '../core/review-port.ts'
import {
  approvalReview,
  approvalsSchema,
  CHECK_STATUS,
  diffSchema,
  externalCheckSchema,
  mrSchema,
  noteSchema,
  projectApprovalsSchema,
  STATUS_STATE,
  toGitLabChangedFile,
} from './gitlab-api.ts'

import { z } from 'zod'

export type GitLabPortConfig = {
  // The v4 API root, e.g. https://gitlab.com/api/v4 (CI_API_V4_URL).
  apiUrl: string
  // Numeric id or url-encoded path; CI_PROJECT_ID is the reliable key.
  projectId: string
  token: string
  // The token user's username, so the gate recognises its own report note under any token.
  selfUsername: string
  // Where a soft advisory (e.g. approvals not reset on push) is surfaced.
  warn: (message: string) => void
}

const parseCount = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const createGitLabPort = ({
  apiUrl,
  projectId,
  token,
  selfUsername,
  warn,
}: GitLabPortConfig): ReviewPort => {
  const projectBase = `/projects/${encodeURIComponent(projectId)}`
  const mrBase = (pr: ChangeRef): string => `${projectBase}/merge_requests/${pr.number}`
  const authHeaders: Readonly<Record<string, string>> = { 'PRIVATE-TOKEN': token }

  const request = async (
    method: string,
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<Response> => {
    const init: RequestInit = {
      method,
      headers:
        body === undefined ? authHeaders : { ...authHeaders, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
    return await fetch(`${apiUrl}${path}`, init)
  }

  const ensureOk = (res: Response, path: string): void => {
    if (!res.ok) throw new Error(`GitLab API ${res.status} on ${path}`)
  }

  const getJson = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const res = await request('GET', path)
    ensureOk(res, path)
    const body: unknown = await res.json()
    return schema.parse(body)
  }

  // Recursive rather than looped so the sequential page fetches don't trip no-await-in-loop.
  const paginate = async <T>(path: string, schema: z.ZodType<T>): Promise<T[]> => {
    const sep = path.includes('?') ? '&' : '?'
    const fetchPage = async (page: number): Promise<T[]> => {
      const url = `${path}${sep}per_page=100&page=${page}`
      const res = await request('GET', url)
      ensureOk(res, url)
      const body: unknown = await res.json()
      const items = z.array(schema).parse(body)
      // GitLab's list endpoints use offset pagination (a numeric X-Next-Page, empty on the last page).
      // Require a strictly larger integer so a missing or non-numeric cursor stops rather than loops.
      const next = Number(res.headers.get('x-next-page'))
      return Number.isInteger(next) && next > page ? [...items, ...(await fetchPage(next))] : items
    }
    return await fetchPage(1)
  }

  const changedFileCount = async (
    pr: ChangeRef,
    changesCount: string | undefined,
  ): Promise<number> => {
    const res = await request('GET', `${mrBase(pr)}/diffs?per_page=1`)
    ensureOk(res, `${mrBase(pr)}/diffs`)
    // Number(null) is 0, so guard on the raw header being present — otherwise a missing X-Total would
    // return 0 and silently disable the incomplete-listing guard. No header → fall back to the summary
    // counter (its "N+" cap only over-reports, the safe direction).
    const header = res.headers.get('x-total')
    const total = Number(header)
    return header !== null && Number.isInteger(total) && total >= 0
      ? total
      : parseCount(changesCount)
  }

  const resetApprovalsOnPush = async (): Promise<boolean> => {
    try {
      return (await getJson(`${projectBase}/approvals`, projectApprovalsSchema))
        .reset_approvals_on_push
    } catch (error) {
      // 404 on this endpoint usually means the tier has no MR-approval settings (Premium+ feature).
      warn(
        `merge-risk: could not read project approval settings (${error instanceof Error ? error.message : String(error)}); assuming approvals are not reset on push.`,
      )
      return false
    }
  }

  const readExternalCheckId = async (context: string): Promise<number | undefined> => {
    try {
      const checks = await paginate(`${projectBase}/external_status_checks`, externalCheckSchema)
      // Only post against a check named for this gate; never guess, or a merge-risk verdict could
      // satisfy or block an unrelated team's required check.
      return checks.find((check) => check.name === context)?.id
    } catch {
      // No external status checks (not Ultimate / no permission): the commit status + job exit code gate.
      return undefined
    }
  }

  // Post a status without failing the run, but warn on BOTH a transport error and an HTTP-error
  // response (fetch resolves a 4xx/5xx, so a lost-scope 403 would otherwise be swallowed silently).
  const postBestEffort = async (
    path: string,
    body: Readonly<Record<string, unknown>>,
    what: string,
  ): Promise<void> => {
    const res = await request('POST', path, body).catch(() => undefined)
    if (res?.ok !== true) {
      warn(
        `merge-risk: could not post ${what} (${res === undefined ? 'network error' : `GitLab ${res.status}`})`,
      )
    }
  }

  return {
    getPullRequest: async (pr) => {
      const mr = await getJson(mrBase(pr), mrSchema)
      return {
        author: mr.author.username,
        baseSha: mr.diff_refs.base_sha,
        headSha: mr.diff_refs.head_sha,
        changedFiles: await changedFileCount(pr, mr.changes_count),
      }
    },
    listFiles: async (pr) =>
      (await paginate(`${mrBase(pr)}/diffs`, diffSchema)).map(toGitLabChangedFile),
    readFile: async (_pr, path, sha) => {
      const url = `${projectBase}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`
      const res = await request('GET', url)
      if (res.status === 404) return undefined
      ensureOk(res, url)
      return await res.text()
    },
    listReviews: async (pr) => {
      const [mr, approvals, resetOnPush] = await Promise.all([
        getJson(mrBase(pr), mrSchema),
        getJson(`${mrBase(pr)}/approvals`, approvalsSchema),
        resetApprovalsOnPush(),
      ])
      if (!resetOnPush && approvals.approved_by.length > 0) {
        warn(
          'merge-risk: "Remove all approvals when commits are added" is OFF; an approval given before a later push still counts. Enable it in Settings → Merge requests.',
        )
      }
      const headCommit = mr.diff_refs.head_sha
      return approvals.approved_by.map((entry) => approvalReview(entry.user.username, headCommit))
    },
    listLabels: async (pr) => (await getJson(mrBase(pr), mrSchema)).labels,
    addLabel: async (pr, label) => {
      ensureOk(
        await request('PUT', `${mrBase(pr)}?add_labels=${encodeURIComponent(label)}`),
        `${mrBase(pr)} add_labels`,
      )
    },
    removeLabel: async (pr, label) => {
      ensureOk(
        await request('PUT', `${mrBase(pr)}?remove_labels=${encodeURIComponent(label)}`),
        `${mrBase(pr)} remove_labels`,
      )
    },
    listComments: async (pr) => {
      const notes = await paginate(`${mrBase(pr)}/notes`, noteSchema)
      return notes.map(
        (note): IssueComment => ({
          id: note.id,
          body: note.body,
          isBot: note.system || note.author.username === selfUsername,
        }),
      )
    },
    createComment: async (pr, body) => {
      ensureOk(await request('POST', `${mrBase(pr)}/notes`, { body }), `${mrBase(pr)}/notes`)
    },
    updateComment: async (pr, id, body) => {
      ensureOk(
        await request('PUT', `${mrBase(pr)}/notes/${id}`, { body }),
        `${mrBase(pr)}/notes/${id}`,
      )
    },
    setStatus: async (pr, status) => {
      // 1) Commit status — visible on any tier; best-effort (not every project surfaces it as a gate).
      await postBestEffort(
        `${projectBase}/statuses/${status.sha}`,
        {
          state: STATUS_STATE[status.state],
          name: status.context,
          description: status.description,
        },
        `the commit status for ${status.sha}`,
      )
      // 2) External status check — the real, required merge gate on Ultimate; skipped silently elsewhere.
      const checkId = await readExternalCheckId(status.context)
      if (checkId !== undefined) {
        await postBestEffort(
          `${mrBase(pr)}/status_check_responses`,
          {
            sha: status.sha,
            external_status_check_id: checkId,
            status: CHECK_STATUS[status.state],
          },
          `the external status check for ${status.sha}`,
        )
      }
    },
  }
}
