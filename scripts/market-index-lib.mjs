/**
 * Pure market-index construction and validation, shared by the CLI and tests.
 * The index follows DSH plugin market format 1 and is deployed by GitHub
 * Actions to `https://leonz666.github.io/dsh-gitworktree-gui/market/index.json`.
 */
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

export const INDEX_URL = 'https://leonz666.github.io/dsh-gitworktree-gui/market/index.json'

export const TITLE = { en: 'Git Worktree Panel', zh: 'Git 工作树面板' }
export const DESCRIPTION = {
  en: 'Read-only Git branch topology, worktrees, changes and file tree in the DSH right sidebar.',
  zh: '在 DSH 右栏只读查看分支拓扑、工作树、改动与文件树。',
}

const CATEGORIES = { 'developer-tools': { title: { en: 'Developer tools', zh: '开发者工具' } } }
const LABELS = {
  git: { title: { en: 'Git', zh: 'Git' } },
  'read-only': { title: { en: 'Read-only', zh: '只读' } },
}

/** Compare two SemVer strings by precedence, newest first. */
function newestFirst(left, right) {
  const split = version => version.split('-')
  const [leftCore, rightCore] = [split(left)[0].split('.').map(Number), split(right)[0].split('.').map(Number)]
  for (let index = 0; index < 3; index += 1) {
    if (leftCore[index] !== rightCore[index]) return rightCore[index] - leftCore[index]
  }
  return right.localeCompare(left)
}

/**
 * Build the unvalidated index document for one package and its release versions.
 * @param pkg - parsed package.json.
 * @param versions - `{ version, publishTimestamp }` records, any order.
 */
export function buildMarketIndex(pkg, versions) {
  return {
    format: 1,
    title: TITLE,
    description: DESCRIPTION,
    metadata: { categories: CATEGORIES, labels: LABELS },
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
      versions: [...versions]
        .sort((left, right) => newestFirst(left.version, right.version))
        .map(({ version, publishTimestamp }) => ({
          version,
          publishTimestamp,
          source: { type: 'npm' },
          engines: { dsh: pkg.engines.dsh },
        })),
    }],
  }
}

/**
 * Validate with the same rules DSH applies and cross-check the current version.
 * @returns the parsed index, versions sorted and icons resolved.
 */
export function validateMarketIndex(pkg, index) {
  const parsed = parseMarketIndex(index, INDEX_URL)
  const plugin = parsed.plugins.find(entry => entry.name === pkg.name)
  if (plugin === undefined) throw new Error(`index does not list ${pkg.name}`)
  const current = plugin.versions.find(entry => entry.version === pkg.version)
  if (current === undefined) throw new Error(`index does not list ${pkg.name}@${pkg.version}`)
  const target = marketInstallTarget(plugin.name, current)
  if (target.spec !== `${pkg.name}@${pkg.version}`) throw new Error(`unexpected install target ${target.spec}`)
  if (current.engines.dsh !== pkg.engines.dsh) throw new Error('index engines.dsh must match package.json')
  return parsed
}
