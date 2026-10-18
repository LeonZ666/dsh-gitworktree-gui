/**
 * Build the DSH plugin market index (format 1) for this package.
 *
 * The index lists the npm releases of `dsh-gitworktree-gui` so the DSH
 * Discover tab can install an exact version. It is committed under
 * `docs/market/` and served by GitHub Pages.
 *
 * Usage:
 *   node scripts/build-market-index.mjs            # write the index
 *   node scripts/build-market-index.mjs --check    # validate only
 *   node scripts/build-market-index.mjs --from-npm # read publish time from npm
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const outDir = resolve(root, 'docs/market')
const outFile = resolve(outDir, 'index.json')
const iconSource = resolve(root, 'icon.svg')
const iconTarget = resolve(outDir, 'icons/icon.svg')
const INDEX_URL = 'https://leonz666.github.io/dsh-gitworktree-gui/market/index.json'

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const fromNpm = args.has('--from-npm')

const TITLE = { en: 'Git Worktree Panel', zh: 'Git 工作树面板' }
const DESCRIPTION = {
  en: 'Read-only Git branch topology, worktrees, changes and file tree in the DSH right sidebar.',
  zh: '在 DSH 右栏只读查看分支拓扑、工作树、改动与文件树。',
}

/** Read the previously committed index, if any. */
function readPrevious() {
  if (!existsSync(outFile)) return null
  try {
    return JSON.parse(readFileSync(outFile, 'utf8'))
  } catch {
    return null
  }
}

/** Unix seconds of this version's npm publish, retrying while the registry catches up. */
function publishTimestamp(previous) {
  const known = fromNpm
    ? undefined
    : previous?.plugins?.[0]?.versions?.find(version => version.version === pkg.version)
  if (known) return known.publishTimestamp
  if (!fromNpm) return Math.floor(Date.now() / 1000)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const printed = execFileSync('npm', ['view', pkg.name, 'time', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? resolve(root, '.tmp-npm-cache') },
      }).trim()
      const times = JSON.parse(printed)
      const iso = times?.[pkg.version]
      if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
        return Math.floor(Date.parse(iso) / 1000)
      }
    } catch {}
    execFileSync('sleep', ['3'])
  }
  throw new Error(`npm does not report a publish time for ${pkg.name}@${pkg.version}`)
}

/** Previous versions stay listed; the current one is inserted once and sorted newest first. */
function versions(previous) {
  const kept = (previous?.plugins?.[0]?.versions ?? []).filter(version => version.version !== pkg.version)
  return [{
    version: pkg.version,
    publishTimestamp: publishTimestamp(previous),
    source: { type: 'npm' },
    engines: { dsh: pkg.engines.dsh },
  }, ...kept].sort((left, right) => (left.version < right.version ? 1 : left.version > right.version ? -1 : 0))
}

const previous = readPrevious()
const index = {
  format: 1,
  title: TITLE,
  description: DESCRIPTION,
  metadata: {
    categories: { 'developer-tools': { title: { en: 'Developer tools', zh: '开发者工具' } } },
    labels: {
      git: { title: { en: 'Git', zh: 'Git' } },
      'read-only': { title: { en: 'Read-only', zh: '只读' } },
    },
  },
  plugins: [{
    name: pkg.name,
    title: TITLE,
    description: DESCRIPTION,
    icon: 'icons/icon.svg',
    author: pkg.author,
    homepage: pkg.homepage,
    repository: { url: 'https://github.com/LeonZ666/dsh-gitworktree-gui' },
    metadata: {
      category: 'developer-tools',
      labels: ['git', 'read-only'],
      keywords: ['git', 'worktree', 'topology', 'sidebar', 'read-only'],
    },
    versions: versions(previous),
  }],
}

// Validate with the same rules DSH applies before writing anything.
const parsed = parseMarketIndex(index, INDEX_URL)
const plugin = parsed.plugins[0]
const target = marketInstallTarget(plugin.name, plugin.versions[0])
if (target.spec !== `${pkg.name}@${pkg.version}`) {
  throw new Error(`unexpected install target ${target.spec}`)
}
if (plugin.versions[0].engines.dsh !== pkg.engines.dsh) {
  throw new Error('index engines.dsh must match package.json')
}

if (checkOnly) {
  if (!existsSync(outFile)) throw new Error(`missing ${outFile}; run npm run market:index`)
  const committed = parseMarketIndex(JSON.parse(readFileSync(outFile, 'utf8')), INDEX_URL)
  const current = committed.plugins[0]?.versions?.[0]
  if (committed.plugins[0]?.name !== pkg.name || current?.version !== pkg.version) {
    throw new Error(`docs/market/index.json is stale: expected ${pkg.name}@${pkg.version}`)
  }
  console.log(`market index ok: ${pkg.name}@${pkg.version} -> ${target.spec}`)
} else {
  mkdirSync(resolve(outDir, 'icons'), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(parsed, null, 2)}\n`)
  copyFileSync(iconSource, iconTarget)
  console.log(`wrote ${outFile}: ${pkg.name}@${pkg.version} (${plugin.versions.length} version(s))`)
}
