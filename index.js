/**
 * dsh-gitworktree-gui — host half (DSH).
 *
 * Serves one read-only route, `/api/dsh-gitworktree-gui/state`, that answers
 * everything the panel draws for one repository (worktrees, topology graph,
 * dirty entries, file list). The git work lives in `lib/core.js`, shared with
 * the Claude plugin; this file only owns the HTTP side and the trust fence.
 *
 * Trust fence: loopback socket AND loopback Host, plus an allowed-roots check
 * before any path is handed to git. The route never writes and never runs a
 * shell: git is spawned with execFile and a fixed argument vector.
 */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve as resolvePath, sep } from 'node:path'

import { collectState, orderRails, layoutGraph, singleFlight, parseChanges as parseChangeEntries, parseStatus, parseWorktrees } from './lib/core.js'

/** Stable cordis plugin name. */
export const name = 'dsh-gitworktree-gui'

/** Services required before the route can mount. */
export const inject = ['webServer', 'sessions', 'workingDirectory']

/** Route path (the browser half mirrors this literal, document-relative at call time). */
export const ROUTE_PATH = '/api/dsh-gitworktree-gui/state'

/** Per-spawn budget: a hung git must not pin the route. */
const GIT_TIMEOUT_MS = 8000
/** Guard rail for the output of a large repository. */
const GIT_MAX_BUFFER = 8 * 1024 * 1024
/** A payload younger than this is shared by every poller of the same directory. */
const CACHE_MS = 1500

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Strip the port from a Host header value, keeping IPv6 brackets. */
function hostName(host) {
  if (typeof host !== 'string' || host === '') return undefined
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    return close === -1 ? undefined : host.slice(1, close).toLowerCase()
  }
  const colon = host.lastIndexOf(':')
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase()
}

/** The shared fence: loopback peer and loopback Host, else 403. */
function isAllowed(req) {
  const peer = req?.socket?.remoteAddress
  if (typeof peer !== 'string' || !LOOPBACK.has(peer)) return false
  const host = hostName(req?.headers?.host)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/** Write one JSON body with no-store caching (and an ETag when asked). */
function writeJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

/** Run one git command in a directory; resolves `{ ok, stdout, stderr }`. */
function git(cwd, args, maxBuffer = GIT_MAX_BUFFER) {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', cwd, '--no-optional-locks', ...args],
      { timeout: GIT_TIMEOUT_MS, maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        done({
          ok: error === null,
          code: error?.code,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        })
      },
    )
  })
}

/** Real path when it exists, the resolved path otherwise (repos can be prunable). */
function realOrResolved(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolvePath(path)
  }
}

/** The environment `lib/core.js` runs against. */
const env = {
  git,
  real: realOrResolved,
  exists: async (path) => existsSync(path),
}

/** True when `path` is `root` or sits below it. */
function isUnder(path, root) {
  if (path === root) return true
  return path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Small stable hash of a string (FNV-1a), for ETags. */
function fingerprint(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Reads in flight, by directory: concurrent pollers share one collection, nothing finished is cached. */
const pendingSnapshots = new Map()

/**
 * Collect the whole panel payload for one directory.
 * @param cwd - requested absolute directory.
 * @param roots - allowed root directories.
 * @returns `{ status, body }`.
 */
async function collect(cwd, roots) {
  const resolvedCwd = realOrResolved(cwd)
  // Every caller passes the fence on its own before it may share a read.
  if (!roots.some((root) => isUnder(resolvedCwd, realOrResolved(root)))) {
    return {
      status: 403,
      body: { ok: false, code: 'outside-roots', error: 'forbidden: path outside allowed roots' },
    }
  }
  const body = await singleFlight(pendingSnapshots, resolvedCwd, () => collectState(env, resolvedCwd))
  return { status: 200, body }
}

/** The change list as a plain array, as earlier versions of this module returned it. */
function parseChanges(text) {
  return parseChangeEntries(text).entries
}

export { collect, collectCommit, orderRails, layoutGraph, parseChanges, parseStatus, parseWorktrees }

/** Read one immutable commit and, on demand, one changed file's patch. */
async function collectCommit(cwd, roots, revision, file) {
  const directory = realOrResolved(cwd)
  const fail = (status, error) => ({ status, body: { ok: false, error } })
  if (!roots.some(root => isUnder(directory, realOrResolved(root)))) return fail(403, 'forbidden: path outside allowed roots')
  if (typeof revision !== 'string' || !/^[a-f0-9]{7,64}$/i.test(revision)) return fail(400, 'invalid commit hash')
  const resolved = await git(directory, ['rev-parse', '--verify', `${revision}^{commit}`])
  if (!resolved.ok) return fail(404, 'commit not found or unreadable')
  const metadata = await git(directory, ['show', '--no-patch', '--no-show-signature', '--format=%H%x00%P%x00%an%x00%aI%x00%B', resolved.stdout.trim(), '--'])
  if (!metadata.ok) return fail(404, 'commit not found or unreadable')
  const [sha, parentText, author, date, ...messageParts] = metadata.stdout.split('\0')
  const parents = parentText.trim().split(' ').filter(Boolean)
  const parent = parents[0]
  const message = messageParts.join('\0').trimEnd()
  const args = parent
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', parent, sha, '--']
    : ['diff-tree', '--root', '--no-commit-id', '--no-renames', '--name-status', '-r', '-z', sha, '--']
  const listing = await git(directory, args)
  if (!listing.ok) throw new Error('git failed while reading commit files')
  const fields = listing.stdout.split('\0')
  const files = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] !== '' && fields[i + 1] !== '') files.push({ status: fields[i], path: fields[i + 1] })
  }
  const body = {
    ok: true, kind: 'commit', sha: sha.trim(), parents, author, date,
    message: message.slice(0, 32768), messageTruncated: message.length > 32768,
    comparisonParent: parent ?? null, files: files.slice(0, 300), fileCount: files.length,
    filesTruncated: files.length > 300,
  }
  if (file !== undefined && file !== null) {
    if (!files.some(entry => entry.path === file)) return fail(404, 'file is not part of this commit')
    const diffArgs = parent
      ? ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--unified=3', parent, sha, '--', file]
      : ['show', '--format=', '--no-show-signature', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--unified=3', sha, '--', file]
    const diff = await git(directory, ['--literal-pathspecs', ...diffArgs], 128 * 1024)
    if (!diff.ok && diff.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('git failed while reading commit patch')
    const lines = diff.stdout.split('\n')
    body.patch = lines.slice(0, 1200).join('\n')
    body.patchTruncated = diff.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || lines.length > 1200
    body.binary = /(?:^|\n)(?:Binary files |GIT binary patch)/.test(body.patch)
    body.file = file
  }
  return { status: 200, body }
}

/** Normalize the row config into the allowed-root list and the default repo. */
function readConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const roots = Array.isArray(raw.allowedRoots)
    ? raw.allowedRoots.filter((entry) => typeof entry === 'string' && isAbsolute(entry))
    : []
  const defaultRepo = typeof raw.repo === 'string' && isAbsolute(raw.repo) ? raw.repo : undefined
  return {
    roots: roots.length > 0 ? roots : [homedir()],
    defaultRepo,
  }
}

/**
 * Mount the route.
 * @param ctx - host context carrying webServer.
 * @param config - row config: `{ repo?, allowedRoots? }`.
 */
export function apply(ctx, config) {
  const { roots, defaultRepo } = readConfig(config)

  /** The effective working directory of one Session, when the request names one. */
  const sessionDirectory = (id) => {
    if (typeof id !== 'string' || id === '') return undefined
    try {
      const session = ctx.sessions.get(id)
      if (session === undefined) return undefined
      const directory = ctx.workingDirectory.get(session)
      return typeof directory === 'string' && isAbsolute(directory) ? directory : undefined
    } catch {
      return undefined
    }
  }

  /** The configured default directory, read defensively. */
  const fallbackDirectory = () => {
    try {
      const directory = ctx.workingDirectory.defaultDirectory
      if (typeof directory === 'string' && isAbsolute(directory)) return directory
    } catch {}
    return process.cwd()
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          if (!isAllowed(req)) {
            writeJson(res, 403, { ok: false, code: 'loopback-only', error: 'forbidden: loopback-only' })
            return
          }
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: `method not allowed: ${req.method}` })
            return
          }
          try {
            const url = new URL(req.url ?? ROUTE_PATH, 'http://127.0.0.1')
            const requested = url.searchParams.get('cwd')
            const explicit = typeof requested === 'string' && isAbsolute(requested)
            const fromSession = explicit ? undefined : sessionDirectory(url.searchParams.get('session'))
            const cwd = explicit ? requested : fromSession ?? defaultRepo ?? fallbackDirectory()
            // A Session's own directory is host-known, so it may sit outside the
            // user-selectable roots; an explicit `cwd` still has to pass the fence.
            const effectiveRoots = explicit ? roots : [...roots, cwd]
            const result = url.searchParams.has('commit')
              ? await collectCommit(cwd, effectiveRoots, url.searchParams.get('commit'), url.searchParams.get('file'))
              : await collect(cwd, effectiveRoots)
            // The tag ignores the timestamp, so an unchanged repository costs a 304.
            const { generatedAt: _stamp, ...stable } = result.body
            const etag = `"${fingerprint(JSON.stringify(stable))}"`
            if (result.status === 200 && req.headers['if-none-match'] === etag) {
              res.writeHead(304, { etag, 'cache-control': 'no-store' })
              res.end()
              return
            }
            writeJson(res, result.status, result.body, result.status === 200 ? { etag } : {})
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
    'dsh-gitworktree-gui: state route',
  )
}
