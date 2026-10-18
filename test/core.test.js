import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import {
  collectState,
  layoutGraph,
  parseChanges,
  parseLog,
  parseStatus,
  parseWorktrees,
} from '../lib/core.js'

const env = {
  git: (cwd, args) =>
    new Promise((done) =>
      execFile('git', ['-C', cwd, '--no-optional-locks', ...args], { maxBuffer: 1 << 24 }, (error, stdout, stderr) =>
        done({ ok: error === null, stdout: String(stdout), stderr: String(stderr) }),
      ),
    ),
  real: (path) => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  },
  exists: async (path) => existsSync(path),
}

const roots = []
const sh = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gw-')))
  roots.push(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'a')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'one')
  return dir
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('parsers', () => {
  test('worktree porcelain', () => {
    const trees = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\nlocked why\n')
    assert.equal(trees.length, 2)
    assert.equal(trees[1].detached, true)
    assert.equal(trees[1].locked, 'why')
  })

  test('status v2 counts', () => {
    const out = parseStatus('# branch.oid abc\n# branch.head main\n# branch.ab +2 -1\n1 M. N... 1 1 1 a b f\n1 .M N... 1 1 1 a b g\n? h\nu UU N... 1 1 1 1 a b c i\n')
    assert.deepEqual([out.ahead, out.behind, out.staged, out.modified, out.untracked, out.conflicted], [2, 1, 1, 1, 1, 1])
  })

  test('changes: spaces, renames, and truncation is reported', () => {
    const { entries } = parseChanges('R  new name\0old name\0 M x.js\0?? dir/\0')
    assert.deepEqual(entries.map((e) => e.path), ['new name', 'x.js', 'dir/'])
    const cut = parseChanges(' M a\0 M b\0 M c\0', 2)
    assert.equal(cut.entries.length, 2)
    assert.equal(cut.truncated, true)
  })

  test('log: stash ref is dropped, duplicates collapse', () => {
    const line = ['s1', '', 'me', '1', 'subj', 'HEAD -> main, main, refs/stash, tag: v1'].join('\x1f')
    const [commit] = parseLog(line, new Set(['main']))
    assert.deepEqual(commit.refs.map((r) => `${r.kind}:${r.name}`), ['head:main', 'branch:main', 'tag:v1'])
  })

  test('layout: lane count follows the lane map', () => {
    const commits = [{ sha: 'c', parents: ['b'] }, { sha: 'b', parents: ['a'] }, { sha: 'a', parents: [] }]
    const { laneCount, rows } = layoutGraph(commits, new Map([['c', 2], ['b', 0], ['a', 0]]))
    assert.equal(laneCount, 3)
    assert.equal(rows[0].parentLanes[0].lane, 0)
  })
})

describe('collectState', () => {
  test('not a repository', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gw-no-')))
    roots.push(dir)
    const body = await collectState(env, dir)
    assert.equal(body.code, 'not-a-git-repo')
  })

  test('branch forks off the trunk onto its own lane, stash stays out of the graph', async () => {
    const dir = repo()
    sh(dir, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(dir, 'f.txt'), 'f')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-q', '-m', 'feat work')
    sh(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, 'm.txt'), 'm')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-q', '-m', 'main work')
    writeFileSync(join(dir, 'a.txt'), 'dirty')
    sh(dir, 'stash')
    const body = await collectState(env, dir)
    assert.equal(body.ok, true)
    assert.equal(body.trunkBranch, 'main')
    const subjects = body.graph.nodes.map((n) => n.subject)
    assert.ok(!subjects.some((s) => /WIP|index on/.test(s)), `stash leaked: ${subjects}`)
    const feat = body.graph.nodes.find((n) => n.subject === 'feat work')
    assert.equal(feat.lane, 1)
    assert.ok(body.graph.nodes.filter((n) => n.lane === 0).length >= 2)
  })

  test('on the trunk only the tip is current; on a branch only its own work is', async () => {
    const dir = repo()
    sh(dir, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(dir, 'f.txt'), 'f')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-q', '-m', 'feat work')
    const onBranch = await collectState(env, dir)
    assert.deepEqual(onBranch.graph.nodes.filter((n) => n.isCurrent).map((n) => n.subject), ['feat work'])
    sh(dir, 'checkout', '-q', 'main')
    const onTrunk = await collectState(env, dir)
    assert.deepEqual(onTrunk.graph.nodes.filter((n) => n.isCurrent).map((n) => n.subject), ['one'])
  })

  test('worktree groups: detached with unique commits is never "safe"', async () => {
    const dir = repo()
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'gw-wt-')))
    roots.push(base)
    const clean = join(base, 'clean')
    const detached = join(base, 'detached')
    const dirty = join(base, 'dirty')
    sh(dir, 'worktree', 'add', '-q', '-b', 'clean', clean)
    sh(dir, 'worktree', 'add', '-q', '--detach', detached)
    writeFileSync(join(detached, 'd.txt'), 'd')
    sh(detached, 'add', '.')
    sh(detached, 'commit', '-q', '-m', 'only here')
    sh(dir, 'worktree', 'add', '-q', '-b', 'dirty', dirty)
    writeFileSync(join(dirty, 'x.txt'), 'x')
    const body = await collectState(env, dir)
    const group = (path) => body.worktrees.find((t) => t.path === path).group
    assert.equal(group(dir), 'root')
    assert.equal(group(clean), 'safe')
    assert.equal(group(detached), 'unmerged')
    assert.equal(group(dirty), 'uncommitted')
  })

  test('no main/master and a detached main tree: nothing is called safe', async () => {
    const dir = repo()
    sh(dir, 'branch', '-m', 'main', 'develop')
    sh(dir, 'checkout', '-q', '--detach')
    const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'gw-wt-'))), 'o')
    roots.push(other)
    sh(dir, 'worktree', 'add', '-q', '-b', 'topic', other)
    const body = await collectState(env, dir)
    const topic = body.worktrees.find((t) => t.path === other)
    assert.notEqual(topic.group, 'safe')
  })

  test('locked tree is not offered for deletion', async () => {
    const dir = repo()
    const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'gw-wt-'))), 'l')
    roots.push(other)
    sh(dir, 'worktree', 'add', '-q', '-b', 'lk', other)
    sh(dir, 'worktree', 'lock', other)
    const body = await collectState(env, dir)
    assert.equal(body.worktrees.find((t) => t.path === other).group, 'locked')
  })

  test('a session in a subdirectory selects the tree that contains it', async () => {
    const dir = repo()
    const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'gw-wt-'))), 'w')
    roots.push(other)
    sh(dir, 'worktree', 'add', '-q', '-b', 'sub', other)
    mkdirSync(join(other, 'src'))
    writeFileSync(join(other, 'src', 'z.txt'), 'z')
    const body = await collectState(env, join(other, 'src'))
    const selected = body.worktrees.filter((t) => t.isSelected)
    assert.equal(selected.length, 1)
    assert.equal(selected[0].path, other)
    assert.ok(body.changes.some((c) => c.path.includes('src')))
  })

  test('files: deleted files and nested noise are dropped, truncation is flagged', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'pkg', 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'pkg', 'node_modules', 'x.js'), 'x')
    writeFileSync(join(dir, 'pkg', 'keep.js'), 'k')
    sh(dir, 'add', '-f', '.')
    sh(dir, 'commit', '-q', '-m', 'two')
    rmSync(join(dir, 'a.txt'))
    const body = await collectState(env, dir)
    assert.deepEqual(body.files, ['pkg/keep.js'])
    assert.equal(body.filesTruncated, false)
  })

  test('statuses of a missing directory become "missing", not "safe"', async () => {
    const dir = repo()
    const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'gw-wt-'))), 'gone')
    roots.push(other)
    sh(dir, 'worktree', 'add', '-q', '-b', 'gone', other)
    rmSync(other, { recursive: true, force: true })
    const body = await collectState(env, dir)
    assert.equal(body.worktrees.find((t) => t.path.endsWith('/gone')).group, 'missing')
  })
})
