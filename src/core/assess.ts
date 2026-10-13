import { createPathMatcher, findMatchingGlob } from './glob.ts'
import { compareTiers, maxTier, raiseTier, type Tier } from './tier.ts'
import type {
  Assessment,
  ChangedFile,
  ChangeReason,
  ContentPattern,
  FileReason,
  Policy,
} from './types.ts'

export type AssessmentInput = {
  policy: Policy
  files: readonly ChangedFile[]
  // Paths whose change could loosen the gate itself, such as the policy file and the gate's workflow.
  protectedPaths: readonly string[]
  // What the platform reports as the PR's file count; it can exceed `files` when the listing is capped.
  totalFiles: number
}

const MAX_LINE_LENGTH = 120

const pathsOf = (file: ChangedFile): readonly string[] =>
  file.previousPath !== undefined && file.previousPath !== file.path
    ? [file.path, file.previousPath]
    : [file.path]

const firstMatch = (globs: readonly string[], paths: readonly string[]): string | undefined =>
  paths.map((path) => findMatchingGlob(globs, path)).find((glob) => glob !== undefined)

const truncate = (line: string): string => {
  const trimmed = line.trim()
  return trimmed.length > MAX_LINE_LENGTH ? `${trimmed.slice(0, MAX_LINE_LENGTH)}…` : trimmed
}

const patternReason = (pattern: ContentPattern, file: ChangedFile): FileReason | undefined => {
  const base = { tier: pattern.tier, path: file.path, pattern: pattern.added.source }
  // Content the platform withheld can't be shown to be harmless, so it counts as a hit.
  if (file.addedLines === undefined) return { kind: 'unreadable', ...base }
  const line = file.addedLines.find((added) => pattern.added.test(added))
  return line === undefined ? undefined : { kind: 'pattern', ...base, line: truncate(line) }
}

const zoneReasons = (policy: Policy, file: ChangedFile): [FileReason, ...FileReason[]] => {
  const paths = pathsOf(file)
  const hits = policy.zones.flatMap((zone): FileReason[] => {
    const glob = firstMatch(zone.paths, paths)
    return glob === undefined ? [] : [{ kind: 'zone', tier: zone.tier, path: file.path, glob }]
  })
  const [first, ...rest] = hits
  return first === undefined
    ? [{ kind: 'default', tier: policy.defaultTier, path: file.path }]
    : [first, ...rest]
}

// Ties keep the earlier reason, so the candidate order below doubles as the reporting priority.
const strongest = (first: FileReason, others: readonly FileReason[]): FileReason =>
  others.reduce((kept, reason) => (compareTiers(reason.tier, kept.tier) > 0 ? reason : kept), first)

const createFileAssessor = (input: AssessmentInput): ((file: ChangedFile) => FileReason) => {
  const isProtected = createPathMatcher(input.protectedPaths)
  return (file) => {
    const paths = pathsOf(file)
    const protectedReasons: FileReason[] = paths.some(isProtected)
      ? [{ kind: 'protected', tier: 'very-risky', path: file.path }]
      : []
    const patternReasons = input.policy.patterns
      .filter((pattern) => firstMatch(pattern.paths, paths) !== undefined)
      .map((pattern) => patternReason(pattern, file))
      .filter((reason) => reason !== undefined)
    const zones = zoneReasons(input.policy, file)
    const candidates = [...protectedReasons, ...patternReasons, ...zones]
    return strongest(candidates[0] ?? zones[0], candidates.slice(1))
  }
}

const countChangedLines = (policy: Policy, files: readonly ChangedFile[]): number => {
  const isExcluded = createPathMatcher(policy.size.exclude)
  return files
    .filter((file) => !isExcluded(file.path))
    .reduce((sum, file) => sum + file.additions + file.deletions, 0)
}

const changeReasons = (
  input: AssessmentInput,
  fileTier: Tier,
  changedLines: number,
): ChangeReason[] => {
  const listed = input.files.length
  const incomplete: ChangeReason[] =
    input.totalFiles > listed
      ? [{ kind: 'incomplete', tier: 'very-risky', listed, total: input.totalFiles }]
      : []
  const threshold = input.policy.size.bumpAboveLines
  const size: ChangeReason[] =
    threshold !== undefined && changedLines > threshold
      ? [{ kind: 'size', tier: raiseTier(fileTier), changedLines, threshold }]
      : []
  return [...incomplete, ...size]
}

export const assessRisk = (input: AssessmentInput): Assessment => {
  const files = input.files.map(createFileAssessor(input))
  const fileTier = maxTier(files.map((reason) => reason.tier))
  const changedLines = countChangedLines(input.policy, input.files)
  const change = changeReasons(input, fileTier, changedLines)
  return {
    tier: maxTier([fileTier, ...change.map((reason) => reason.tier)]),
    files,
    change,
    changedLines,
  }
}
