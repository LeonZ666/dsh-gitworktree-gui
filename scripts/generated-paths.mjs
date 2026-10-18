/**
 * Path rules shared by the CI check, the pre-commit hook, and tests.
 *
 * A path is forbidden when it names a generated artifact or a local-only file.
 * Matching is deliberately segment-based so `.claude-plugin/` is not treated
 * as the `.claude/` state directory.
 */
export const FORBIDDEN = [
  { id: 'node_modules', test: path => path.split('/').includes('node_modules') },
  { id: 'codex-dist', test: path => path === 'codex/dist' || path.startsWith('codex/dist/') },
  { id: 'site', test: path => path === '_site' || path.startsWith('_site/') },
  { id: 'artifacts', test: path => path === '.artifacts' || path.startsWith('.artifacts/') },
  { id: 'tarball', test: path => path.endsWith('.tgz') },
  { id: 'tmp', test: path => path.split('/').some(segment => segment.startsWith('.tmp-')) },
  { id: 'claude-state', test: path => path === '.claude' || path.startsWith('.claude/') },
  { id: 'npmrc', test: path => path === '.npmrc.local' },
  { id: 'ds-store', test: path => path.split('/').includes('.DS_Store') },
  { id: 'docs-market', test: path => path === 'docs/market' || path.startsWith('docs/market/') },
]

/** The rule a path violates, or undefined when the path is allowed. */
export function violation(path) {
  return FORBIDDEN.find(rule => rule.test(path))
}

/**
 * Parse `git diff --name-status -z` tokens (ACMR only) into changed paths.
 * Rename/copy records are `status\0old\0new\0`; only the new path counts.
 * @param tokens - NUL-split tokens from git.
 * @returns the new path of each record.
 */
export function changedPaths(tokens) {
  const paths = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index]
    if (status === undefined || status === '') break
    if (status.startsWith('R') || status.startsWith('C')) {
      if (tokens[index + 2] !== undefined) paths.push(tokens[index + 2])
      index += 3
    } else {
      if (tokens[index + 1] !== undefined) paths.push(tokens[index + 1])
      index += 2
    }
  }
  return paths
}
