/**
 * The DSH market index: built in memory, validated with the same parser DSH
 * runs, and checked against package.json. Nothing here reads a committed file;
 * the index is deployed by CI, never stored in the repository.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

import { buildMarketIndex, INDEX_URL, validateMarketIndex } from '../scripts/market-index-lib.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const versions = [
  { version: pkg.version, publishTimestamp: 1792400000 },
  { version: '0.0.1', publishTimestamp: 1791000000 },
]

test('the index lists the current version with the package engines', () => {
  const index = validateMarketIndex(pkg, buildMarketIndex(pkg, versions))
  const plugin = index.plugins.find(entry => entry.name === pkg.name)
  assert.ok(plugin, 'package is listed')
  const current = plugin.versions.find(entry => entry.version === pkg.version)
  assert.equal(current.engines.dsh, pkg.engines.dsh)
  assert.equal(current.source.type, 'npm')
  assert.equal(plugin.author, pkg.author)
  assert.equal(marketInstallTarget(plugin.name, current).spec, `${pkg.name}@${pkg.version}`)
})

test('older releases stay listed and versions sort newest first', () => {
  const index = validateMarketIndex(pkg, buildMarketIndex(pkg, versions))
  assert.deepEqual(index.plugins[0].versions.map(entry => entry.version), [pkg.version, '0.0.1'])
})

test('the relative icon resolves next to the index', () => {
  const index = validateMarketIndex(pkg, buildMarketIndex(pkg, versions))
  assert.equal(index.plugins[0].icon, new URL('icons/icon.svg', INDEX_URL).href)
})

test('an index whose engines disagree with package.json is rejected', () => {
  const mismatched = { ...pkg, engines: { ...pkg.engines, dsh: '>=99.0.0' } }
  assert.throws(() => validateMarketIndex(mismatched, buildMarketIndex(pkg, versions)))
})

test('the index parses with the official validator', () => {
  const parsed = parseMarketIndex(buildMarketIndex(pkg, versions), INDEX_URL)
  assert.equal(parsed.format, 1)
  assert.ok(parsed.plugins[0].versions.length >= 1)
})
