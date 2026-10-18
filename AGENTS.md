# dsh-gitworktree-gui — agent notes

DSH plugin package (right-Sidebar Git panel; also ships Codex/Claude adapters).
The release and iteration rules live in [RELEASING.md](RELEASING.md).

## Commands

```sh
npm run verify                                   # check + generated-files + tests + market check + pack dry-run
npm run iterate:start -- <version> [slug]        # branch iter/vX.Y.Z-slug, bump version, scaffold notes
npm run iterate:artifact                         # tarball + manifest into ignored .artifacts/vX.Y.Z/
npm run iterate:finish                           # PR -> checks -> squash merge -> tag vX.Y.Z
npm run iterate:context [version]                # read past iteration notes/artifacts
```

## "新增迭代" protocol

When the user's message starts with 新增迭代 / 开个迭代 / 新版本迭代 and includes a
requirement:

1. Confirm `pwd` is this repository and `git status --short` is empty. If dirty,
   stop and report the changed files instead of starting an iteration.
2. Choose the version: an explicit version if given; otherwise the next **minor**
   for a feature, **patch** for a bug fix, **major** for a breaking change or an
   `engines.dsh` bump that drops older DSH versions.
3. Derive a short kebab-case slug from the requirement (2–4 words).
4. Run `npm run iterate:start -- <version> <slug>`.
5. Fill `iterations/<version>.md`: put the user's requirement text under
   `Requirements`, and a concise restatement under `Goals / non-goals`. Leave
   `Decisions`, `Verification`, `Leftovers` for the implementation.
6. Report the branch, version, notes path and artifact directory. Do **not**
   commit, push, merge or tag unless the user asks.

## Guardrails

- `main` is protected: pull requests and the required checks only; never push
  `main` directly.
- Generated artifacts never enter git: `.artifacts/`, `_site/`, `codex/dist/`,
  `*.tgz`; the `generated-files` check enforces this.
- One open `iter/*` iteration at a time; `iterate:start` refuses a second one.
- Never run `git clean -fdX`; it deletes `.artifacts/`, `node_modules/` and
  `codex/dist/`.
- The desktop profile installs this directory with `link:`; after a change,
  refresh the page for `client.js`, restart DSH for `index.js`/`lib/`.
