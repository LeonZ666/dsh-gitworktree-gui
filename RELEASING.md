# Releasing

`main` is always releasable. Feature work goes through a squashed PR; a release
is a version commit plus a tag. Generated files never enter the repository:
the market index is built in CI and deployed to GitHub Pages, and `npm pack`
output stays local (or on the GitHub Release).

## Feature loop

```sh
git switch main && git pull --ff-only
git switch -c feat/<slug>
# edit; the desktop profile installs this directory with `link:`
#   client.js changes: refresh the Web page
#   index.js / lib/ changes: restart DSH
npm run verify
git add <files>
git commit -m "feat: ..."
git push -u origin feat/<slug>
gh pr create --fill
# after CI is green:
gh pr merge --squash --delete-branch
```

- One PR, one change. Use `feat:` / `fix:` / `chore:` / `docs:` prefixes.
- Test a packaged install without touching the real profile:
  `DSH_HOME=/tmp/dsh-check dsh plugin --profile check add "$PWD"`.
- Never `git add -A`; check `git status` before committing.
- Ignored: `node_modules/`, `codex/dist/`, `_site/`, `*.tgz`, `.tmp-*`,
  `.claude/`, `.npmrc.local`.

## Release

1. Pick the version:
   - `patch` — fixes, visual tweaks, no interface/config change;
   - `minor` — new features, new config keys, new host support;
   - `major` — removed/renamed config or route, changed data contract, or a
     `engines.dsh` bump that drops older DSH versions.
2. Bump version and changelog on `main`:

   ```sh
   git switch main && git pull --ff-only
   npm version <patch|minor|major> --no-git-tag-version
   npm install --package-lock-only        # lock root version must match
   # edit CHANGELOG.md: Unreleased -> X.Y.Z - YYYY-MM-DD
   npm run verify
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git push origin main
   ```

3. Tag and push:

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

4. CI does the rest:
   - `Release` (`.github/workflows/release.yml`): tests, `npm pack`,
     `npm publish --provenance` (skips if the version already exists), and a
     GitHub Release with the tarball.
   - `Pages` (`.github/workflows/pages.yml`, on `release: published`): rebuilds
     the format-1 market index from **all npm versions** and deploys
     `https://leonz666.github.io/dsh-gitworktree-gui/market/index.json`.
     No commit is made to `main`.
5. Verify:

   ```sh
   npm view dsh-gitworktree-gui version
   curl -s https://leonz666.github.io/dsh-gitworktree-gui/market/index.json | head
   DSH_HOME=/tmp/dsh-rel dsh plugin --profile rel add dsh-gitworktree-gui@X.Y.Z
   ```

## npm credentials

The workflow publishes with npm **Trusted Publishing** (OIDC) by default:

1. npmjs.com → `dsh-gitworktree-gui` → Settings → Trusted Publisher →
   GitHub Actions: owner `LeonZ666`, repo `dsh-gitworktree-gui`, workflow
   `release.yml`.
2. Then delete the `NODE_AUTH_TOKEN` env from the publish step (it stays in the
   template as the token fallback).

Fallback: create an npm Automation token and
`gh secret set NPM_TOKEN -R LeonZ666/dsh-gitworktree-gui`; keep the
`NODE_AUTH_TOKEN` line.

Without either, the tag run fails at publish. The tag remains; fix credentials
and use `gh run rerun <id>`.

## Pre-release

```sh
npm version X.Y.Z-rc.1 --no-git-tag-version
# ... verify, commit, tag vX.Y.Z-rc.1
```

Publish with `--tag next` (the release workflow can add it when the tag contains
`-`). The market index lists pre-releases, but Discover prefers a stable version
when one is compatible.

## Failure handling

| Situation | Action |
| --- | --- |
| npm publish failed | fix credentials; rerun the Release workflow |
| npm published, Release/Pages failed | rerun that workflow; the index rebuilds from npm |
| index shows the wrong version | rerun `Pages` (`workflow_dispatch`); the builder retries npm |
| bad version published | `npm deprecate dsh-gitworktree-gui@X.Y.Z "reason"`; ship a patch |
| feature must be withdrawn | revert the squash commit via a PR; release a patch |
