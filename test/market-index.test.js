/**
 * The market index shipped for the DSH Discover tab: it must parse with the
 * same validator DSH runs, and it must point at the version in package.json.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const INDEX_URL = 'https://leonz666.github.io/dsh-gitworktree-gui/market/index.json'

function readIndex() {
  return parseMarketIndex(JSON.parse(readFileSync(new URL('docs/market/index.json', root), 'utf8')), INDEX_URL)
}

test('the market index lists this package at the current version', () => {
  const index = readIndex()
  assert.equal(index.format, 1)
  const plugin = index.plugins.find(entry => entry.name === pkg.name)
  assert.ok(plugin, 'package is listed')
  const current = plugin.versions[0]
  assert.equal(current.version, pkg.version)
  assert.equal(current.engines.dsh, pkg.engines.dsh)
  assert.equal(current.source.type, 'npm')
  assert.equal(plugin.author, pkg.author)
  assert.equal(marketInstallTarget(plugin.name, current).spec, `${pkg.name}@${pkg.version}`)
})

test('the relative icon resolves next to the index', () => {
  const index = readIndex()
  assert.equal(index.plugins[0].icon, new URL('icons/icon.svg', INDEX_URL).href)
  assert.ok(existsSync(new URL('docs/market/icons/icon.svg', root)))
})

test('the prepared index stays out of the npm tarball', () => {
  assert.ok(!pkg.files.includes('docs'))
  assert.ok(pkg.files.includes('docs/*.md'))
})
