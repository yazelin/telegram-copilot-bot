# Issue Workflow

## Picking Issues
- Always pick the oldest open issue (lowest number) that does NOT have `agent-stuck` or `needs-human-review` labels
- Read the full issue body and all comments before starting

## Branching
- Branch name: `issue-<number>-<short-slug>`
- Always branch from latest `main`
- One branch per issue, one PR per issue

## Pull Requests
- Title: `Implement #<number>: <short description>`
- Body must include:
  - `Closes #<number>` (for auto-close on merge)
  - Summary of what was implemented
  - How to validate (exact commands or steps)
- Request no reviewers (review.yml handles it automatically)

## Commit Messages
- Format: `feat: <description>` for new features
- Format: `fix: <description>` for bug fixes
- One logical commit per PR (squash on merge handles this)
