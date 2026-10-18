import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { apply, collect } from '../index.js'

export async function startPanel({ repo, port = 0, idleMs = 30 * 60 * 1000, assets = dirname(fileURLToPath(import.meta.url)) }) {
  const cwd = realpathSync(repo)
  const initial = await collect(cwd, [cwd])
  const roots = [cwd, ...(initial.body.worktrees ?? []).map(tree => tree.path)]
  let route
  apply({
    effect: effect => effect(),
    webServer: { register: definition => { route = definition } },
    sessions: { get: () => undefined },
    workingDirectory: { defaultDirectory: cwd },
  }, { repo: cwd, allowedRoots: roots })
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
    ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ])
  let lastAccess = Date.now()
  const server = createServer(async (req, res) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    const ownOrigin = `http://127.0.0.1:${server.address().port}`
    if (!local || req.headers.host !== `127.0.0.1:${server.address().port}` ||
        (req.headers.origin && req.headers.origin !== ownOrigin)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    if (req.method !== 'GET') { res.writeHead(405).end('GET only'); return }
    lastAccess = Date.now()
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
    const url = new URL(req.url, ownOrigin)
    try {
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ app: 'git-worktree-panel', repo: cwd, pid: process.pid }))
      } else if (url.pathname === route.path) {
        await route.handler(req, res)
      } else if (files.has(url.pathname)) {
        const [file, type] = files.get(url.pathname)
        const body = await readFile(resolve(assets, file))
        res.writeHead(200, { 'content-type': type }).end(body)
      } else res.writeHead(404).end('Not found')
    } catch {
      if (!res.headersSent) res.writeHead(500)
      res.end('Panel request failed')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const timer = setInterval(() => {
    if (Date.now() - lastAccess >= idleMs) {
      server.close()
      server.closeIdleConnections()
    }
  }, Math.min(idleMs, 60_000))
  timer.unref()
  server.on('close', () => clearInterval(timer))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { repo: { type: 'string' }, port: { type: 'string', default: '0' } } })
  if (!values.repo) throw new Error('--repo is required')
  const panel = await startPanel({ repo: values.repo, port: Number(values.port) })
  const ready = { url: panel.url, repo: realpathSync(values.repo), pid: process.pid }
  if (process.send) process.send(ready)
  else console.log(JSON.stringify(ready))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { panel.server.close(); panel.server.closeAllConnections() })
}
