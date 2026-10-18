# Releasing

`main` is always releasable. Each version iteration is one branch, one squashed
PR, one tag. Generated artifacts never enter the repository: the market index is
built by CI and deployed to Pages, `npm pack` output stays in `.artifacts/` or on
the GitHub Release.

## Iteration loop

```sh
# one branch per version, from main, in this same directory
npm run iterate:start -- 0.7.0 graph-filters

# fill in iterations/v0.7.0.md (requirements, decisions, verification)
# edit code; the desktop profile installs this directory with `link:`
#   client.js changes: refresh the Web page
#   index.js / lib/ changes: restart DSH

npm run verify
npm run iterate:artifact     # pnpm tarball + manifest into .artifacts/v0.7.0/
npm run iterate:finish       # PR → checks → squash merge → tag v0.7.0
```

- `iter/v0.7.0-graph-filters` is the only branch for this iteration; do not
  stack iterations, and do not branch from the previous iteration branch.
- `iterations/vX.Y.Z.md` is tracked (small text, the iteration's context).
- `.artifacts/vX.Y.Z/` is ignored and holds the tarball + `manifest.json`
  (version, branch, commit, sha256, predictable release/npm URLs).
- `iterate:context [version]` prints past notes, the current artifact manifest,
  the diff since the last tag, and the release URL.
- Never `git add -A`; check `git status`. Never `git clean -fdX` mid-iteration —
  it also deletes `.artifacts/` and `node_modules/`.

`iterate:finish` is resumable: it reuses an open PR, waits for checks, merges
with `--squash --match-head-commit`, switches to `main`, tags only if the tag
does not already exist, and pushes just the tag. If a run stops after the merge,
run `npm run iterate:finish` again from `main` to finish the tag/release step.

## Version rules

- `patch` — fixes, visuals, no interface/config change.
- `minor` — new features, config keys, host support.
- `major` — removed/renamed config or route, changed data contract, or a
  `engines.dsh` bump that drops older DSH versions.

`iterate:start` bumps `package.json` and `package-lock.json` (npm does both) and
refuses to start unless `CHANGELOG.md` already has a `## X.Y.Z` section.

## What CI does

- `Release` (tag `v*`): verifies the tag names the merged version and is an
  ancestor of `main`, runs `npm run verify`, publishes to npm with provenance
  (`--tag next` for a `-rc.N` tag), and creates the GitHub Release with the
  tarball. Both publish and release creation are idempotent.
- `Pages` (`release: published`): rebuilds the format-1 market index from every
  npm version and deploys
  `https://leonz666.github.io/dsh-gitworktree-gui/market/index.json`.
- `generated-files` (push/PR): fails when a generated path is tracked.

## One-time: protect main

Run this **after** the `generated-files` workflow exists on `main` (bootstrap:
merge the workflow first, then enable the ruleset). Required contexts are the
bare check names.

```sh
gh api --method POST repos/LeonZ666/dsh-gitworktree-gui/rulesets \
  -H 'Accept: application/vnd.github+json' --input - <<'JSON'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "generated-files" },
          { "context": "test (20)" },
          { "context": "test (22)" },
          { "context": "test (24)" } ] } }
  ]
}
JSON
```

Verify: `gh api repos/LeonZ666/dsh-gitworktree-gui/rulesets --jq '.[] | {id,name,enforcement}'`.
Emergency disable: `gh api -X PATCH repos/LeonZ666/dsh-gitworktree-gui/rulesets/<id> -f enforcement=disabled`.

If you change the CI job name or the Node matrix, update the required contexts
in the same change, or PRs will be unable to merge.

## npm credentials

Trusted Publishing (preferred): npmjs.com → `dsh-gitworktree-gui` → Settings →
Trusted Publisher → GitHub Actions: owner `LeonZ666`, repo
`dsh-gitworktree-gui`, workflow `release.yml`. Then delete the
`NODE_AUTH_TOKEN` env from the publish step.

Fallback: create an npm Automation token and
`gh secret set NPM_TOKEN -R LeonZ666/dsh-gitworktree-gui`; keep the env line.

Without either, the tag run fails at publish; the tag remains, so fix
credentials and rerun the workflow.

## Failure handling

| Situation | Action |
| --- | --- |
| checks pending / not registered | rerun `iterate:finish`; it waits and reuses the PR |
| npm publish failed | fix credentials; rerun the Release workflow |
| npm published, Release/Pages failed | rerun that workflow; the index rebuilds from npm |
| merged but not tagged | run `npm run iterate:finish` from `main` |
| tag exists elsewhere | abort and inspect; never move a published tag |
| bad version published | `npm deprecate dsh-gitworktree-gui@X.Y.Z "reason"`; ship a patch |
| feature must be withdrawn | revert the squash commit via a PR; release a patch |
