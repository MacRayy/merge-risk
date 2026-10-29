import type { ChangeRef, IssueComment, ReviewPort } from '../core/review-port.ts'
import {
  approvalReview,
  approvalsSchema,
  CHECK_STATUS,
  diffSchema,
  externalCheckSchema,
  isFreshApproval,
  latestApprovalTimes,
  latestPushTime,
  mrSchema,
  noteSchema,
  STATUS_STATE,
  toGitLabChangedFile,
  versionSchema,
} from './gitlab-api.ts'

import { z } from 'zod'

export type GitLabPortConfig = {
  // The v4 API root, e.g. https://gitlab.com/api/v4 (CI_API_V4_URL).
  apiUrl: string
  // The MR's project: numeric id or url-encoded path (the target project for fork MRs).
  projectId: string
  token: string
  // The token user's username, so the gate recognises its own report note under any token.
  selfUsername: string
  warn: (message: string) => void
}

const parseCount = (value: string | null | undefined): number => {
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
      // Offset pagination via X-Next-Page; require a strictly larger integer so a missing/bad cursor stops.
      const next = Number(res.headers.get('x-next-page'))
      return Number.isInteger(next) && next > page ? [...items, ...(await fetchPage(next))] : items
    }
    return await fetchPage(1)
  }

  // listReviews (head SHA) + listLabels both read the MR; memoise the GET so one run spends one request.
  // NOT used by getPullRequest — run-gate calls that again to detect a mid-run push (needs a live read).
  const mrCache = new Map<number, Promise<z.infer<typeof mrSchema>>>()
  const getMr = async (pr: ChangeRef): Promise<z.infer<typeof mrSchema>> => {
    const cached = mrCache.get(pr.number)
    if (cached !== undefined) return await cached
    const pending = getJson(mrBase(pr), mrSchema)
    mrCache.set(pr.number, pending)
    return await pending
  }

  // listReviews (approval timing) + listComments both page the notes; memoise so one run pages them once.
  const notesCache = new Map<number, Promise<Array<z.infer<typeof noteSchema>>>>()
  const getNotes = async (pr: ChangeRef): Promise<Array<z.infer<typeof noteSchema>>> => {
    const cached = notesCache.get(pr.number)
    if (cached !== undefined) return await cached
    const pending = paginate(`${mrBase(pr)}/notes`, noteSchema)
    notesCache.set(pr.number, pending)
    return await pending
  }

  const changedFileCount = async (
    pr: ChangeRef,
    changesCount: string | null | undefined,
  ): Promise<number> => {
    const res = await request('GET', `${mrBase(pr)}/diffs?per_page=1`)
    ensureOk(res, `${mrBase(pr)}/diffs`)
    // Guard on the header being present (Number(null) is 0): no X-Total → fall back to the summary count.
    const header = res.headers.get('x-total')
    const total = Number(header)
    return header !== null && Number.isInteger(total) && total >= 0
      ? total
      : parseCount(changesCount)
  }

  const readExternalCheckId = async (context: string): Promise<number | undefined> => {
    try {
      const checks = await paginate(`${projectBase}/external_status_checks`, externalCheckSchema)
      // Only post against a check named for this gate; guessing could satisfy/block another team's check.
      return checks.find((check) => check.name === context)?.id
    } catch {
      // No external status checks (not Ultimate / no permission): the commit status + job exit code gate.
      return undefined
    }
  }

  // Post a status without failing the run; warn on transport AND HTTP errors (fetch resolves 4xx/5xx).
  const postBestEffort = async (
    path: string,
    body: Readonly<Record<string, unknown>>,
    what: string,
  ): Promise<void> => {
    const res = await request('POST', path, body).catch(() => undefined)
    if (res?.ok !== true) {
      const detail =
        res === undefined
          ? 'network error'
          : `GitLab ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`
      warn(`merge-risk: could not post ${what} (${detail})`)
    }
  }

  return {
    getPullRequest: async (pr) => {
      const mr = await getJson(mrBase(pr), mrSchema)
      if (mr.diff_refs === null) {
        // GitLab is still generating the diff (just after open/push); there's nothing to score yet.
        throw new Error(
          'merge-risk: the MR diff is not ready yet (GitLab is still generating it); retry the job in a moment.',
        )
      }
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
      const [mr, approvals, versions, notes] = await Promise.all([
        getMr(pr),
        getJson(`${mrBase(pr)}/approvals`, approvalsSchema),
        paginate(`${mrBase(pr)}/versions`, versionSchema),
        getNotes(pr),
      ])
      // Count an approval only if it post-dates the last push — per-commit strictness on every tier,
      // without the Premium/Maintainer-only project setting.
      const lastPushAt = latestPushTime(versions)
      const approvedAt = latestApprovalTimes(notes)
      const headSha = mr.diff_refs?.head_sha
      return approvals.approved_by.map((entry) => {
        const fresh = isFreshApproval(approvedAt.get(entry.user.username), lastPushAt)
        return approvalReview(entry.user, fresh ? headSha : undefined, selfUsername)
      })
    },
    listLabels: async (pr) => (await getMr(pr)).labels,
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
      const notes = await getNotes(pr)
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
