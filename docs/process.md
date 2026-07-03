# Process

Lotus releases are cut from `main` with a temporary release branch

This keeps normal development simple while still giving releases a reviewable checklist

## Branches

`main` is the releasable integration branch

All code PRs target `main`

`vault` stores smoke fixtures demo vault content and showcase notes

`feature/<name>` stores short lived feature work

`fix/<name>` stores short lived bugfix work

`release/vX.Y.Z` stores temporary release prep

Delete release branches after the tag ships

`hotfix/vX.Y.Z` stores urgent production fixes

Delete hotfix branches after merge and tag

## Pull request rules

Before merging to `main` require the smoke workflows to pass

Require the Linux smoke matrix

Require the Windows smoke matrix

Require any profile specific checks relevant to the change

Recommended repository settings live in GitHub repository configuration

Protect `main`

Require PR review before merge

Require status checks for Linux smoke and Windows smoke

Require branches to be up to date before merge

Disallow force pushes to `main` and `vault`

## Cutting vX.Y.Z

Start from a clean updated `main`

Create `release/vX.Y.Z`

Update `package.json`

Update the package lock file

Update `manifest.json`

Update `versions.json` when present

Install dependencies with the project npm lockfile

Build the plugin

Run local smoke coverage appropriate for the release

Run `minimal` for baseline execution

Run `systems` for shell and native compiler coverage

Run the full matrix or targeted elevated profiles when the release touches execution groups signing proofs eBPF containers or workflows

Open a PR from `release/vX.Y.Z` to `main`

Merge only after the required checks pass

The `Tag manifest version` workflow creates the release tag from `manifest.json` after the merge reaches `main`

If that tag already exists on another commit, bump `manifest.json` and rerun the PR instead of reusing the tag

Verify the `Production Release` workflow created a GitHub release containing `main.js` `manifest.json` and `styles.css`

Delete `release/vX.Y.Z`

## Hotfixes

Use `hotfix/vX.Y.Z` only for urgent fixes that must ship before normal feature work

Branch from `main`

Apply the minimal fix

Run focused smoke checks

Open a PR to `main`

Merge and tag from `main`

Do not batch unrelated cleanup into hotfixes
