import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { collect, apply } from '../index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gitworktree-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  return { root, git }
}
test('empty repository remains readable', async t => {
  const { root } = fixture(t)
  const result = await collect(root, [root])
  assert.equal(result.body.ok, true)
  assert.deepEqual(result.body.graph.nodes, [])
})
test('corrupt index must not report a clean successful snapshot', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  writeFileSync(join(root, '.git/index'), 'invalid index')
  await assert.rejects(collect(root, [root]), /git status failed/)
})
test('detached worktree cannot be classified as merged', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('checkout', '--detach')
  git('commit', '--allow-empty', '-m', 'detached work')
  const { body } = await collect(root, [root])
  assert.equal(body.worktrees[0].group, 'unmerged')
  assert.equal(body.worktrees[0].unmerged, 1)
})
test('explicit directory outside roots is rejected', async t => {
  const { root } = fixture(t)
  assert.equal((await collect(root, [join(root, 'child')])).status, 403)
})
test('merge topology and clean/dirty worktree grouping remain correct', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  const linked = join(root, 'linked')
  git('worktree', 'add', '-b', 'feature', linked)
  execFileSync('git', ['-C', linked, 'commit', '--allow-empty', '-m', 'feature commit'])
  let result = await collect(root, [root])
  assert.equal(result.body.worktrees.find(tree => tree.branch === 'feature').group, 'unmerged')
  git('merge', '--no-ff', 'feature', '-m', 'merge feature')
  result = await collect(root, [root])
  assert.equal(result.body.worktrees.find(tree => tree.branch === 'feature').group, 'safe')
  assert.ok(result.body.graph.nodes.some(node => node.parents.length === 2))
  assert.ok(result.body.graph.nodes.some(node => node.lane > 0))
  writeFileSync(join(linked, 'file with spaces.txt'), 'change')
  result = await collect(linked, [root])
  assert.equal(result.body.worktrees.find(tree => tree.branch === 'feature').group, 'uncommitted')
  assert.equal(result.body.changes[0].path, 'file with spaces.txt')
})

test('route returns a read failure as HTTP 500 instead of a clean snapshot', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  writeFileSync(join(root, '.git/index'), 'invalid index')
  let handler, status, body
  apply({
    effect: fn => fn(),
    webServer: { register: route => { handler = route.handler } },
    sessions: { get: () => ({}) },
    workingDirectory: { get: () => root },
  }, { repo: root, allowedRoots: [root] })
  await handler({
    method: 'GET', url: '/api/dsh-gitworktree-gui/state?session=s1',
    headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' },
  }, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })
  assert.equal(status, 500)
  assert.equal(body.ok, false)
  assert.match(body.error, /git status failed/)
})
test('branches sharing the trunk tip each retain an independent right rail', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('branch', 'feature-a')
  git('branch', 'feature-b')
  const { body } = await collect(root, [root])
  const rails = body.graph.rails.filter(rail => rail.sharedTip)
  assert.equal(rails.length, 2)
  assert.equal(new Set(rails.map(rail => rail.lane)).size, 2)
  assert.ok(rails.every(rail => rail.lane > 0 && rail.tip === git('rev-parse', 'HEAD')))
  assert.equal(body.graph.nodes.length, 1, 'branch markers must not invent commits')
  assert.ok(body.graph.laneCount > Math.max(...rails.map(rail => rail.lane)))
})

test('existing rail positions survive new commits and newly inserted branch names', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('branch', 'z-feature')
  const first = (await collect(root, [root])).body.graph.rails.find(r => r.name === 'z-feature').lane
  git('branch', 'a-feature')
  git('checkout', 'z-feature')
  git('commit', '--allow-empty', '-m', 'feature advances')
  const second = (await collect(root, [root])).body.graph.rails.find(r => r.name === 'z-feature').lane
  assert.equal(second, first)
})
test('exact file limit is complete; additional files report the real total', async t => {
  const { root } = fixture(t)
  for (let i = 0; i < 700; i++) writeFileSync(join(root, `file-${i}`), '')
  let body = (await collect(root, [root])).body
  assert.equal(body.fileCount, 700)
  assert.equal(body.filesTruncated, false)
  writeFileSync(join(root, 'extra'), '')
  body = (await collect(root, [root])).body
  assert.equal(body.fileCount, 701)
  assert.equal(body.files.length, 700)
  assert.equal(body.filesTruncated, true)
})
test('history limit retains an unmerged entry for a branch outside the visible window', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('checkout', '-b', 'old-feature')
  git('commit', '--allow-empty', '-m', 'unmerged old feature')
  git('checkout', 'main')
  let parent = git('rev-parse', 'HEAD')
  const tree = git('rev-parse', 'HEAD^{tree}')
  for (let i = 0; i < 121; i++) parent = git('commit-tree', tree, '-p', parent, '-m', `commit ${i}`)
  git('update-ref', 'refs/heads/main', parent)
  const { body } = await collect(root, [root])
  assert.equal(body.graph.nodes.length, 120)
  assert.equal(body.graph.truncated, true)
  assert.equal(body.graph.rails.find(r => r.name === 'old-feature').outOfWindow, true)
})
test('concurrent snapshots share work only after each caller passes the root fence', async t => {
  const { root } = fixture(t)
  const [a, b, rejected] = await Promise.all([collect(root, [root]), collect(root, [root]), collect(root, [join(root, 'child')])])
  assert.strictEqual(a.body, b.body)
  assert.equal(rejected.status, 403)
})
test('linked worktrees share concurrent graph history but keep their own branch state', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  const linked = join(root, 'linked')
  git('worktree', 'add', '-b', 'feature', linked)
  const [a, b] = await Promise.all([collect(root, [root]), collect(linked, [root])])
  assert.strictEqual(a.body.graph.rails, b.body.graph.rails)
  assert.equal(a.body.currentBranch, 'main')
  assert.equal(b.body.currentBranch, 'feature')
  assert.notEqual(a.body.cwd, b.body.cwd)
  assert.equal(a.body.graph.nodes.flatMap(node => node.refs).find(ref => ref.kind === 'head').name, 'main')
  assert.equal(b.body.graph.nodes.flatMap(node => node.refs).find(ref => ref.kind === 'head').name, 'feature')
})
test('reference-only branches do not leave holes between historical rails', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('checkout', '-b', 'fix')
  git('commit', '--allow-empty', '-m', 'fix')
  git('checkout', 'main')
  git('merge', '--no-ff', 'fix', '-m', 'merge fix')
  git('branch', '-d', 'fix')
  git('branch', 'empty-feature')
  const { body } = await collect(root, [root])
  assert.equal(body.graph.rails.find(rail => rail.name.startsWith('merged:')).lane, 1)
  assert.equal(body.graph.rails.find(rail => rail.name === 'empty-feature').lane, 2)
})

test('merged ancestor refs keep labels and history without duplicate open forks', async t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'initial')
  git('checkout', '-b', 'feature')
  git('commit', '--allow-empty', '-m', 'feature work')
  git('branch', 'feature-alias')
  const tip = git('rev-parse', 'HEAD')
  git('checkout', 'main')
  git('merge', '--no-ff', 'feature', '-m', 'merge feature')
  git('branch', 'new-feature')
  const { body } = await collect(root, [root])
  const featureRails = body.graph.rails.filter(r => ['feature', 'feature-alias'].includes(r.name))
  assert.equal(featureRails.length, 1, 'one real historical rail, no duplicate alias fork')
  assert.equal(featureRails[0].sharedTip, false)
  assert.ok(body.graph.rails.some(r => r.name === 'new-feature' && r.sharedTip))
  const names = body.graph.nodes.find(n => n.sha === tip).refs.map(r => r.name)
  assert.ok(names.includes('feature') && names.includes('feature-alias'))
  git('branch', 'stale', 'main~1')
  const next = (await collect(root, [root])).body
  assert.equal(next.graph.rails.some(r => r.name === 'stale'), false)
  assert.ok(next.branches.some(b => b.name === 'stale'))
})
