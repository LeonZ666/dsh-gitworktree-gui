import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as host from '../index.js'

test('the host module keeps the surface other embedders (DSH, the Codex server) import', () => {
  for (const key of ['name', 'inject', 'ROUTE_PATH', 'apply', 'collect', 'layoutGraph', 'parseChanges', 'parseStatus', 'parseWorktrees']) {
    assert.ok(key in host, key)
  }
  assert.deepEqual(host.parseChanges(' M a\0'), [{ x: ' ', y: 'M', path: 'a' }])
})

test('collect() is never served from the polling cache and keeps { status, body }', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-host-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'one')
  const first = await host.collect(root, [root])
  assert.equal(first.status, 200)
  assert.equal(first.body.changes.length, 0)
  writeFileSync(join(root, 'x.txt'), 'x')
  const second = await host.collect(root, [root])
  assert.equal(second.body.changes.length, 1, 'a second read right away must see the new file')
  const outside = await host.collect(root, [join(root, 'nope')])
  assert.equal(outside.status, 403)
})
