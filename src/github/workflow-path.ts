// GITHUB_WORKFLOW_REF looks like `owner/repo/.github/workflows/gate.yml@refs/heads/main`.
export const workflowPathFromRef = (ref: string | undefined): string | undefined => {
  const match = ref === undefined ? null : /^[^/]+\/[^/]+\/(?<path>[^@]+)@/.exec(ref)
  return match?.groups?.['path']
}
