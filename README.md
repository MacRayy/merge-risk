# merge-risk

Scores how risky a pull request is to merge, and gates the merge on the review that risk calls for.

| Tier         | What the reviewer does                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `safe`       | Nothing. The change merges once the checks are green.                                                                                  |
| `risky`      | Reviews the shape of the change (architecture, interfaces, function signatures, reuse) and tries it by hand on a deployed environment. |
| `very-risky` | Reviews in depth, implementation details included.                                                                                     |

The tier is reported on the PR as a label (`merge-risk:<tier>`), a comment that tells the reviewer
what to look at and why the PR got its tier, and a commit status that blocks the merge until the
tier's approvals are in.

## How a PR is scored

Each changed file gets the tier of the riskiest rule it matches, and the PR gets the tier of its
riskiest file. Risk is never averaged or summed, so one risky file can't hide among a hundred safe
ones.

- **Zones** map path globs to a tier. A file that matches no zone gets `default-tier`. A renamed
  file is checked under both its old and new path.
- **Patterns** match the lines a PR adds in the files they cover, such as a `DROP` in a SQL file. If
  the platform withholds a file's content (a binary file, or a diff too large to show), the pattern
  counts as matched.
- **Size** raises the tier by one step when the PR changes more lines than a threshold.
- **The gate itself** is always `very-risky`: the policy file and the workflow that runs the gate.
- **An incomplete listing** is `very-risky`. GitHub lists at most 3000 files of a PR.

## Policy

The policy lives in the repository it governs, at `.merge-risk.yml`. The gate always reads it from
the PR's base commit, so a PR can't loosen the rules it is judged by.

```yaml
version: 1

default-tier: risky

tiers:
  safe:
    approvals: 0
  risky:
    approvals: 1
    guide: Check the interfaces, then try the change on the stage deployment.
  very-risky:
    approvals: 1

zones:
  - tier: safe
    paths: ['**/*.md', 'docs/**']
  - tier: risky
    paths: ['src/**']
  - tier: very-risky
    paths: ['src/migrations/**', 'infrastructure/**', '.github/workflows/**']

patterns:
  - tier: very-risky
    paths: ['**/*.sql']
    added: '\b(DROP|TRUNCATE|DELETE\s+FROM)\b'
    ignore-case: true

size:
  bump-above-lines: 600
  exclude: ['yarn.lock', '**/*.snap']
```

`guide` replaces the default reviewer guide for a tier. Globs follow
[picomatch](https://github.com/micromatch/picomatch) and match dotfiles.

## Approvals

An approval counts when it comes from someone other than the author, from a person rather than a
bot, and on the PR's current head commit, so pushing after an approval needs a fresh one. Each
reviewer's latest verdict counts. A request for changes blocks the merge on any tier until the
reviewer approves or the review is dismissed.

Anyone else who can review counts, so on a public repository that includes people outside the team.
A collaborator who pushed commits onto someone else's PR can also approve it.

## GitHub setup

1. Add `.merge-risk.yml` to the default branch.
2. Add the workflow:

   ```yaml
   name: merge-risk

   on:
     pull_request_target:
       types: [opened, synchronize, reopened, edited, ready_for_review]
     pull_request_review:
       types: [submitted, edited, dismissed]

   permissions:
     contents: read
     pull-requests: write
     issues: write
     statuses: write

   concurrency:
     group: merge-risk-${{ github.event.pull_request.number }}
     cancel-in-progress: true

   jobs:
     gate:
       runs-on: ubuntu-latest
       steps:
         - uses: attrecto/merge-risk@v0
   ```

   The workflow never checks out the PR's code; it reads the diff through the API.

3. Protect the default branch with a ruleset that requires the `merge-risk` status. Leave the
   ruleset's own required approvals at 0, since the gate decides how many a PR needs. Keep the
   bypass list empty, or limit it to a break-glass team: anyone who can bypass the ruleset can merge
   without the gate.

### Known limits

- **The gate stops mistakes, not a malicious writer.** A commit status can be posted by anyone with
  write access: with a personal token, or from a workflow a PR adds or edits (`pull_request_review`
  runs take the workflow file from the PR). The latest status for a context is the one that counts,
  so a forged `success` wins. Posting the status from a dedicated GitHub App, and requiring that app
  as the status's source, would close this.
- **Use `GITHUB_TOKEN` or a GitHub App token.** The gate finds its own report comment by the marker
  on a bot's comment. Under a personal token it would post a new comment on every run.
- **Fork PRs don't pick up approvals.** Review runs from forks get a read-only token, so the status
  stays as it was until the next push re-runs the gate.
- **The gate must be a workflow of its own.** In a reusable workflow, the protected file is the
  caller, not the reusable workflow that holds the gate.
- **The gate checks that a review happened, not how deep it went.**

## Local preview

```sh
merge-risk evaluate --base origin/main
```

Scores the current branch's commits against the base's policy, the way the gate will. `--json`
prints the full assessment.

## Development

```sh
yarn install
yarn test
yarn lint
yarn type-check
yarn build   # rebuilds dist/, which must be committed with the source change
```
