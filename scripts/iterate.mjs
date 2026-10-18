#!/usr/bin/env node
/**
 * One branch per version iteration, with versioned artifacts kept out of git.
 *
 *   node scripts/iterate.mjs start <version> [slug]
 *   node scripts/iterate.mjs context [version]
 *   node scripts/iterate.mjs artifact
 *   node scripts/iterate.mjs finish
 *
 * Artifacts live in `.artifacts/<version>/` (ignored). Iteration notes live in
 * `iterations/<version>.md` (tracked, small text). Nothing here pushes `main`;
 * `finish` merges through a pull request and only pushes the version tag.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2]
const TMP_CACHE = join(tmpdir(), 'dsh-plugin-iterate-npm-cache')
const RELEASE_BASE = 'https://github.com/LeonZ666/dsh-gitworktree-gui/releases/tag'
const NPM_BASE = 'https://www.npmjs.com/package/dsh-gitworktree-gui/v'

const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options })
const capture = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...options }).trim()
const attempt = (cmd, args) => {
  try {
    return capture(cmd, args)
  } catch {
    return undefined
  }
}
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  if (match === null) throw new Error(`invalid version ${JSON.stringify(version)}`)
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] }
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (a.prerelease === undefined && b.prerelease === undefined) return 0
  if (a.prerelease === undefined) return 1
  if (b.prerelease === undefined) return -1
  return a.prerelease.localeCompare(b.prerelease)
}

function currentTag() {
  return attempt('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
}

function assertClean() {
  const status = capture('git', ['status', '--porcelain'])
  if (status !== '') throw new Error('working tree is not clean; commit or stash first')
}

function assertMain() {
  run('git', ['fetch', 'origin', '--tags'])
  const behind = attempt('git', ['rev-list', '--count', 'HEAD..origin/main'])
  if (behind !== undefined && behind !== '0') run('git', ['pull', '--ff-only', 'origin', 'main'])
}

function iterationSlug(slug) {
  if (slug === undefined || slug === '') return ''
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (clean === '') throw new Error('slug has no usable characters')
  return `-${clean}`
}

function iterationDoc(version, branch, base) {
  return `# v${version} — iteration

- branch: \`${branch}\`
- base: \`${base ?? 'none'}\`
- release: ${RELEASE_BASE}/v${version}
- npm: ${NPM_BASE}/${version}

## Requirements

## Goals / non-goals

## Decisions

## Verification

## Leftovers
`
}

/** start <version> [slug] */
function start() {
  const version = process.argv[3]
  const slug = process.argv[4]
  if (version === undefined) throw new Error('usage: iterate.mjs start <version> [slug]')
  assertClean()
  run('git', ['switch', 'main'])
  assertMain()
  const current = pkg().version
  if (compareVersions(version, current) <= 0) throw new Error(`target ${version} must be greater than current ${current}`)

  const open = attempt('gh', ['pr', 'list', '--state', 'open', '--json', 'headRefName', '--jq', '.[].headRefName'])
  if (open !== undefined && open.split('\n').some(name => name.startsWith('iter/'))) {
    throw new Error('another iteration PR is open; finish or close it first')
  }

  const branch = `iter/v${version}${iterationSlug(slug)}`
  if (attempt('git', ['check-ref-format', '--branch', branch]) === undefined) {
    throw new Error(`invalid branch name ${branch}`)
  }
  if (attempt('git', ['rev-parse', '--verify', `refs/heads/${branch}`]) !== undefined) {
    throw new Error(`branch ${branch} already exists`)
  }

  run('git', ['switch', '-c', branch])
  run('npm', ['version', version, '--no-git-tag-version', '--no-audit', '--no-fund'], { stdio: 'inherit' })
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json root version does not match; run npm install --package-lock-only')
  }

  const changelogPath = join(root, 'CHANGELOG.md')
  let changelog = readFileSync(changelogPath, 'utf8')
  const heading = `## ${version} — ${new Date().toISOString().slice(0, 10)}`
  if (!new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(changelog)) {
    const firstEntry = changelog.indexOf('\n## ')
    const stub = `${heading}\n\n### Added\n\n- TBD\n\n`
    changelog = firstEntry === -1
      ? `${changelog.trimEnd()}\n\n${stub}`
      : `${changelog.slice(0, firstEntry + 1)}${stub}${changelog.slice(firstEntry + 1)}`
    writeFileSync(changelogPath, changelog)
  }

  const hooks = attempt('git', ['config', '--get', 'core.hooksPath'])
  if (hooks === undefined) run('git', ['config', 'core.hooksPath', '.githooks'])
  else if (hooks !== '.githooks') console.log(`note: core.hooksPath is ${hooks}; the repo hook is at .githooks`)

  const base = currentTag()
  const notes = join(root, 'iterations', `v${version}.md`)
  mkdirSync(dirname(notes), { recursive: true })
  if (existsSync(notes)) throw new Error(`${notes} already exists`)
  writeFileSync(notes, iterationDoc(version, branch, base))
  mkdirSync(join(root, '.artifacts', `v${version}`), { recursive: true })

  console.log(`\niteration v${version} started on ${branch}`)
  console.log(`  notes:     iterations/v${version}.md (fill it in)`)
  console.log(`  artifacts: .artifacts/v${version}/ (ignored)`)
  console.log('  next: develop, then `npm run iterate:artifact` and `npm run iterate:finish`\n')
}

/** context [version] */
function context() {
  const wanted = process.argv[3]
  const docs = existsSync(join(root, 'iterations'))
    ? readdirSync(join(root, 'iterations')).filter(name => /^v.+\.md$/.test(name)).sort()
    : []
  if (wanted === undefined) {
    console.log(`iterations: ${docs.length === 0 ? 'none' : ''}`)
    for (const name of docs) {
      const version = name.replace(/^v/, '').replace(/\.md$/, '')
      const artifacts = existsSync(join(root, '.artifacts', `v${version}`, 'manifest.json'))
      console.log(`  ${version.padEnd(10)} notes=iterations/${name} artifacts=${artifacts ? 'yes' : 'no'}`)
    }
    console.log(`\nlast tag: ${currentTag() ?? 'none'}`)
    return
  }

  const version = wanted.replace(/^v/, '')
  const doc = join(root, 'iterations', `v${version}.md`)
  if (!existsSync(doc)) throw new Error(`missing iterations/v${version}.md`)
  console.log(readFileSync(doc, 'utf8'))
  const manifest = join(root, '.artifacts', `v${version}`, 'manifest.json')
  if (existsSync(manifest)) console.log(`artifacts:\n${readFileSync(manifest, 'utf8')}`)
  const previous = currentTag()
  if (previous !== undefined) {
    console.log(`\nchanges since ${previous}:`)
    run('git', ['--no-pager', 'diff', '--stat', `${previous}..HEAD`])
  }
  const release = attempt('gh', ['release', 'view', `v${version}`, '--json', 'url,assets', '--jq', '{url, assets: (.assets|length)}'])
  if (release !== undefined) console.log(`\nrelease: ${release}`)
}

/** artifact */
function artifact() {
  const { version } = pkg()
  const branch = capture('git', ['branch', '--show-current'])
  if (!branch.startsWith('iter/')) throw new Error(`artifacts are built on an iteration branch, not ${branch || 'detached HEAD'}`)
  assertClean()
  run('npm', ['run', 'verify'], { stdio: 'inherit' })

  const outDir = join(root, '.artifacts', `v${version}`)
  mkdirSync(outDir, { recursive: true })
  const packed = JSON.parse(
    capture('npm', ['pack', '--json', '--pack-destination', outDir, '--cache', TMP_CACHE], {
      env: { ...process.env, NPM_CONFIG_CACHE: TMP_CACHE },
    }),
  )
  const entry = Array.isArray(packed) ? packed[0] : packed
  const file = join(outDir, entry.filename)
  const bytes = statSync(file).size
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')

  const manifest = {
    version,
    branch,
    baseTag: currentTag(),
    commit: capture('git', ['rev-parse', 'HEAD']),
    builtAt: new Date().toISOString(),
    node: process.version,
    npm: capture('npm', ['--version']),
    verified: true,
    pack: { file: entry.filename, bytes, sha256 },
    notes: `iterations/v${version}.md`,
    release: `${RELEASE_BASE}/v${version}`,
    npmUrl: `${NPM_BASE}/${version}`,
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`\nartifact: ${file} (${bytes} bytes, sha256 ${sha256.slice(0, 12)}…)`)
  console.log(`manifest: .artifacts/v${version}/manifest.json`)
  console.log('artifacts are ignored; commit only source and iterations notes.\n')
}

function checkState() {
  const checks = attempt('gh', ['pr', 'checks', '--json', 'name,state'])
  if (checks === undefined) return 'waiting'
  const list = JSON.parse(checks)
  if (list.length === 0) return 'waiting'
  const failing = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']
  if (list.some(check => failing.includes(check.state))) return 'failed'
  const pending = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'STALE']
  if (list.some(check => pending.includes(check.state))) return 'waiting'
  return 'passed'
}

function waitForChecks(branch) {
  for (let attemptIndex = 0; attemptIndex < 60; attemptIndex += 1) {
    const state = checkState()
    if (state === 'passed') return
    if (state === 'failed') throw new Error('PR checks failed; fix them and re-run `iterate.mjs finish`')
    console.log(`waiting for checks on ${branch}… (${attemptIndex + 1}/60)`)
    sleep(15000)
  }
  throw new Error('timed out waiting for PR checks')
}

/** finish */
function finish() {
  const { version } = pkg()
  const branch = capture('git', ['branch', '--show-current'])
  const onMain = branch === 'main'
  if (!onMain && !branch.startsWith('iter/')) throw new Error(`finish runs on an iteration branch, not ${branch || 'detached HEAD'}`)
  assertClean()
  if (onMain) return finishTaggedVersion()
  run('node', ['scripts/check-generated.mjs', '--tracked'], { stdio: 'inherit' })

  const head = capture('git', ['rev-parse', 'HEAD'])
  run('git', ['push', '-u', 'origin', branch])

  let pr = attempt('gh', ['pr', 'view', '--json', 'number,state,mergeCommit,url'])
  if (pr === undefined) {
    const notes = join(root, 'iterations', `v${version}.md`)
    run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `v${version}`, '--body-file', notes])
    pr = attempt('gh', ['pr', 'view', '--json', 'number,state,mergeCommit,url'])
  }
  if (pr === undefined) throw new Error('could not create or read the pull request')
  const info = JSON.parse(pr)

  if (info.state === 'OPEN') {
    waitForChecks(branch)
    run('git', ['switch', 'main'])
    run('git', ['pull', '--ff-only', 'origin', 'main'])
    run('gh', ['pr', 'merge', branch, '--squash', '--delete-branch', '--match-head-commit', head])
    info.state = 'MERGED'
    info.mergeCommit = JSON.parse(attempt('gh', ['pr', 'view', '--json', 'mergeCommit']) ?? '{}').mergeCommit
  } else if (info.state !== 'MERGED') {
    throw new Error(`pull request is ${info.state}; expected OPEN or MERGED`)
  }

  run('git', ['fetch', 'origin', '--prune'])
  run('git', ['merge', '--ff-only', 'origin/main'])
  const expected = info.mergeCommit?.oid
  if (expected !== undefined && capture('git', ['rev-parse', 'HEAD']) !== expected) {
    throw new Error('main HEAD does not match the merged commit; refusing to tag')
  }
  attempt('git', ['branch', '-D', branch])

  const tag = `v${version}`
  const local = attempt('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  const remote = attempt('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (local !== undefined && local !== capture('git', ['rev-parse', 'HEAD'])) {
    throw new Error(`local tag ${tag} points elsewhere; refusing to move it`)
  }
  if (remote !== undefined && remote !== '') {
    const peeled = attempt('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`])
    const peeledSha = peeled?.split('\t')[0]
    if (peeledSha !== undefined && peeledSha !== capture('git', ['rev-parse', 'HEAD'])) {
      throw new Error(`remote tag ${tag} points elsewhere; refusing to move it`)
    }
  }
  if (local === undefined) {
    run('git', ['tag', '-a', tag, '-m', tag])
  }
  if (remote === undefined || remote === '') {
    run('git', ['push', 'origin', `refs/tags/${tag}`])
  }

  for (let index = 0; index < 20; index += 1) {
    const release = attempt('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url'])
    if (release !== undefined) {
      console.log(`\nreleased: ${release}`)
      console.log(`market:   https://leonz666.github.io/dsh-gitworktree-gui/market/index.json`)
      return
    }
    sleep(15000)
  }
  console.log(`\ntag ${tag} pushed; the Release/Pages workflows are still running.`)
  console.log(`check: gh run list -R LeonZ666/dsh-gitworktree-gui --limit 5`)
}

/** Tag an already-merged version (recovery after a failed finish). */
function finishTaggedVersion() {
  const { version } = pkg()
  run('git', ['fetch', 'origin', '--tags'])
  run('git', ['merge', '--ff-only', 'origin/main'])
  const tag = `v${version}`
  const head = capture('git', ['rev-parse', 'HEAD'])
  const local = attempt('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  const remote = attempt('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (local !== undefined && local !== head) throw new Error(`local tag ${tag} points elsewhere`)
  if (remote !== undefined && remote !== '') {
    const peeled = attempt('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`])
    const sha = peeled?.split('\t')[0]
    if (sha !== undefined && sha !== head) throw new Error(`remote tag ${tag} points elsewhere`)
  }
  if (local === undefined) run('git', ['tag', '-a', tag, '-m', tag])
  if (remote === undefined || remote === '') run('git', ['push', 'origin', `refs/tags/${tag}`])
  console.log(`tag ${tag} is on ${head}; waiting for the Release workflow`)
}

try {
  if (command === 'start') start()
  else if (command === 'context') context()
  else if (command === 'artifact') artifact()
  else if (command === 'finish') finish()
  else {
    console.error('usage: iterate.mjs <start <version> [slug]|context [version]|artifact|finish>')
    process.exit(2)
  }
} catch (error) {
  console.error(`iterate: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
