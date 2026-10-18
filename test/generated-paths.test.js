import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { changedPaths, violation } from '../scripts/generated-paths.mjs'

const script = new URL('../scripts/check-generated.mjs', import.meta.url).pathname

const run = (cwd, args) => {
  try {
    return { code: 0, output: execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }) }
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-generated-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@t')
  return { dir, git }
}

test('forbidden paths are recognised', () => {
  for (const path of [
    'node_modules/react/index.js',
    'codex/dist/app.js',
    '_site/market/index.json',
    '.artifacts/v0.7.0/manifest.json',
    'dsh-gitworktree-gui-0.7.0.tgz',
    '.tmp-backup/full.bundle',
    '.claude/settings.json',
    '.npmrc.local',
    'docs/.DS_Store',
    'docs/market/index.json',
  ]) {
    assert.ok(violation(path), path)
  }
})

test('legitimate paths are not forbidden', () => {
  for (const path of [
    '.claude-plugin/marketplace.json',
    'docs/codex-panel.md',
    'iterations/v0.7.0.md',
    'foo.tgz.md',
    'assets/readme/panel.jpg',
    'scripts/generated-paths.mjs',
  ]) {
    assert.equal(violation(path), undefined, path)
  }
})

test('rename parsing keeps the new path only', () => {
  assert.deepEqual(changedPaths(['R100', '_site/a', 'src/a']), ['src/a'])
  assert.deepEqual(changedPaths(['R100', 'src/a', '_site/a']), ['_site/a'])
  assert.deepEqual(changedPaths(['A', 'src/a']), ['src/a'])
})

test('a tracked forbidden file fails even when it is ignored', t => {
  const { dir, git } = repo(t)
  writeFileSync(join(dir, 'README.md'), '# ok\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'x.tgz'), 'x')
  writeFileSync(join(dir, '.gitignore'), '*.tgz\n')
  git('add', '-f', 'x.tgz', '.gitignore')
  const result = run(dir, ['--tracked'])
  assert.equal(result.code, 1)
  assert.match(result.output, /x\.tgz/)
})

test('staged mode catches a force-added artifact', t => {
  const { dir, git } = repo(t)
  writeFileSync(join(dir, 'README.md'), '# ok\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'init')
  mkdirSync(join(dir, '.artifacts/v1'), { recursive: true })
  writeFileSync(join(dir, '.artifacts/v1/manifest.json'), '{}')
  git('add', '-f', '.artifacts/v1/manifest.json')
  const result = run(dir, ['--staged'])
  assert.equal(result.code, 1)
  assert.match(result.output, /\.artifacts\/v1\/manifest\.json/)
})

test('base mode catches a rename into a forbidden path', t => {
  const { dir, git } = repo(t)
  writeFileSync(join(dir, 'src.txt'), 'x')
  git('add', 'src.txt')
  git('commit', '-q', '-m', 'init')
  const base = git('rev-parse', 'HEAD').trim()
  execFileSync('mkdir', ['-p', join(dir, '_site')])
  git('mv', 'src.txt', '_site/src.txt')
  git('commit', '-q', '-m', 'move')
  const result = run(dir, ['--base', base])
  assert.equal(result.code, 1)
  assert.match(result.output, /_site\/src\.txt/)
})

test('deletion of a forbidden path is allowed', t => {
  const { dir, git } = repo(t)
  writeFileSync(join(dir, 'x.tgz'), 'x')
  git('add', 'x.tgz')
  git('commit', '-q', '-m', 'add')
  const base = git('rev-parse', 'HEAD').trim()
  git('rm', '-q', 'x.tgz')
  git('commit', '-q', '-m', 'remove')
  const result = run(dir, ['--base', base])
  assert.equal(result.code, 0, result.output)
})

test('an unresolvable base fails closed', t => {
  const { dir } = repo(t)
  const result = run(dir, ['--base', 'does-not-exist'])
  assert.equal(result.code, 2)
})
