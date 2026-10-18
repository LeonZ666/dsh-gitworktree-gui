#!/usr/bin/env node
/**
 * Reject generated artifacts in the working tree and in a PR's changes.
 *
 * Modes (combinable):
 *   --tracked          files already staged in the index (default when no mode)
 *   --staged           the index diff, for a pre-commit hook
 *   --base <commit>    net change of BASE...HEAD, for pull requests
 *
 * Fails closed: an unresolvable base exits 2 instead of reporting success.
 * The check runs `git ls-files` in every mode, so a file that was force-added
 * before the ignore rules existed is still caught.
 */
import { execFileSync } from 'node:child_process'

import { changedPaths, violation } from './generated-paths.mjs'

const args = process.argv.slice(2)
const has = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function git(arguments_, options = {}) {
  return execFileSync('git', arguments_, { encoding: 'utf8', ...options })
}

function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}

function report(paths, source) {
  const hits = paths
    .map(path => ({ path, rule: violation(path) }))
    .filter(entry => entry.rule !== undefined)
  for (const hit of hits) {
    console.error(`forbidden generated path (${hit.rule.id}) in ${source}: ${hit.path}`)
  }
  if (hits.length > 0) {
    console.error('remove it from the index with `git rm --cached <path>`, keep it ignored, and retry')
  }
  return hits.length
}

// Always: the index must not contain a generated path.
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean)
let violations = report(tracked, 'the index')

if (has('--staged')) {
  const tokens = git(['diff', '--cached', '--name-status', '-z', '--diff-filter=ACMR', '-M']).split('\0')
  violations += report(changedPaths(tokens), 'the staged changes')
}

const base = value('--base')
if (base !== undefined) {
  try {
    git(['rev-parse', '--verify', `${base}^{commit}`], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    fail(`cannot resolve base commit ${JSON.stringify(base)}; fetch it first (fail closed)`, 2)
  }
  const tokens = git(['diff', '--name-status', '-z', '--diff-filter=ACMR', '-M', `${base}...HEAD`]).split('\0')
  violations += report(changedPaths(tokens), `changes since ${base}`)
}

if (violations > 0) process.exit(1)
console.log('generated-files: ok')
