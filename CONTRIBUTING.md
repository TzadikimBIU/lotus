# Contributing to Lotus

Lotus uses a lightweight trunk based flow

The goal is to keep `main` releasable without the ceremony and merge drift of full Git Flow

## Branch model

`main` is the integration branch and should always be releasable

`vault` contains smoke fixtures demo vault content and showcase notes

Normal code PRs should not target `vault`

`feature/<name>` is for new user facing functionality

`fix/<name>` is for bug fixes

`docs/<name>` is for documentation work

`release/vX.Y.Z` is temporary and only used while cutting a version

`hotfix/vX.Y.Z` is temporary and only used for urgent production fixes

Avoid long lived work branches

Rebase or merge `main` regularly if a PR stays open for more than a few days

## Pull requests

Open PRs against `main` unless the change is only for the `vault` branch

Keep PRs scoped to one behavior change or one documentation change

Every PR should explain what changed and why

Every PR should mention security execution signing logging filesystem and process impact when relevant

Every PR should list the local checks that were run

UI changes should include screenshots or smoke artifacts

Do not mix generated smoke artifacts local Obsidian config or scratch vault files into commits

Generated plugin bundle changes are expected only when the source change requires `main.js` to be rebuilt

## Vault branch changes

Changes to smoke fixtures or showcase notes belong on `vault`

If a feature needs both code and vault fixture updates open a code PR to `main` and a paired fixture PR to `vault`

Link the paired PRs in both descriptions

For maintainer release prep merge the code first then update `vault` before tagging

The smoke workflows fetch `vault`

Fixture changes can break code PRs even when the code branch is correct

Treat `vault` as part of the test contract

## Local checks

Run the smallest checks that cover your change

For normal code changes run `npm run build`

For Obsidian API and manifest compatibility run `npm run lint`

For basic execution coverage run `npm run smoke`

For workflow changes run workflow validation

For runtime execution group compiler signing or logging changes run the relevant smoke profile

Use `minimal` for baseline execution

Use `systems` for shell and native compiler coverage

Use `proofs` for solver coverage

Use `ebpf` for kernel tracing coverage

Use `full` when the change crosses several runner boundaries

## Security sensitive areas

Call out security impact in the PR when touching process spawning stdin stdout stderr timeouts or cancellation

Call out security impact when touching Docker Podman WSL SSH QEMU or custom execution groups

Call out security impact when touching reproducibility hashing or note signatures

Call out security impact when touching logging sinks redaction local files or remote HTTP endpoints

Call out security impact when touching code that reads or writes outside the active note or vault

These changes need focused review and smoke coverage

If behavior is intentionally unsafe because Lotus executes user code document the boundary clearly

## Release flow

Release work happens on a temporary `release/vX.Y.Z` branch from `main`

See [process](docs/process.md) for the release checklist

Tags are cut from reviewed `main` commits only

Do not tag feature branches
