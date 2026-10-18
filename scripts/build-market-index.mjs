/**
 * Build the DSH plugin market index (format 1) for this package.
 *
 * The index is generated at release time and deployed by GitHub Actions; it is
 * never committed. `--check` validates the in-memory document without writing.
 *
 * Usage:
 *   node scripts/build-market-index.mjs                 # write to _site/market
 *   node scripts/build-market-index.mjs --out <dir>     # write elsewhere
 *   node scripts/build-market-index.mjs --check         # validate only, no network
 *   node scripts/build-market-index.mjs --from-npm      # real publish time, retries
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMarketIndex, INDEX_URL, validateMarketIndex } from './market-index-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const checkOnly = flag('--check')
const fromNpm = flag('--from-npm')
const outDir = resolve(root, value('--out') ?? '_site/market')
const outFile = resolve(outDir, 'index.json')

const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

/** Read the previous index so older releases stay listed. */
function previousIndex() {
  if (!existsSync(outFile)) return undefined
  try {
    return JSON.parse(readFileSync(outFile, 'utf8'))
  } catch {
    return undefined
  }
}

/** Read every published version and its publish time from npm, with retries. */
function npmVersions() {
  const npm = args_ => execFileSync('npm', args_, {
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? resolve(root, '.tmp-npm-cache') },
  }).trim()
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const listed = JSON.parse(npm(['view', pkg.name, 'versions', '--json']))
      const times = JSON.parse(npm(['view', pkg.name, 'time', '--json']))
      const names = (Array.isArray(listed) ? listed : [listed]).filter(version => version !== '0.0.0-stage')
      const records = names
        .map(version => ({ version, publishTimestamp: Math.floor(Date.parse(times?.[version]) / 1000) }))
        .filter(record => Number.isInteger(record.publishTimestamp) && record.publishTimestamp > 0)
      if (records.some(record => record.version === pkg.version)) return records
    } catch {}
    sleep(5000)
  }
  throw new Error(`npm does not report ${pkg.name}@${pkg.version}`)
}

const previous = previousIndex()
const versions = fromNpm
  ? npmVersions()
  : [
      ...(previous?.plugins?.[0]?.versions ?? []).map(({ version, publishTimestamp: stamp }) => ({ version, publishTimestamp: stamp })),
      { version: pkg.version, publishTimestamp: checkOnly ? 0 : Math.floor(Date.now() / 1000) },
    ]

const parsed = validateMarketIndex(pkg, buildMarketIndex(pkg, versions))

if (checkOnly) {
  console.log(`market index ok: ${pkg.name}@${pkg.version} -> ${parsed.plugins[0].versions[0].version} (${INDEX_URL})`)
} else {
  mkdirSync(resolve(outDir, 'icons'), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(parsed, null, 2)}\n`)
  copyFileSync(resolve(root, 'icon.svg'), resolve(outDir, 'icons/icon.svg'))
  console.log(`wrote ${outFile}: ${pkg.name}@${pkg.version} (${parsed.plugins[0].versions.length} version(s))`)
}
