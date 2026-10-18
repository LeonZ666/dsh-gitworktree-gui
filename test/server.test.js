import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { startPanel } from '../codex/server.mjs'

function get(url, headers = {}, method = 'GET') {
  return new Promise((done, reject) => {
    const req = request(url, { headers, method }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', data => { text += data })
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}
test('standalone panel serves local assets and state with origin, host and path fences', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'panel-server-test-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const { server, url } = await startPanel({ repo, assets: resolve('codex/dist') })
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections() }))
  assert.equal((await get(url)).status, 200)
  assert.match((await get(`${url}/app.js`)).text, /__ModuleLoader__/)
  assert.equal((await get(`${url}/theme.css`)).status, 200)
  const state = await get(`${url}/api/dsh-gitworktree-gui/state`)
  assert.equal(JSON.parse(state.text).code, 'not-a-git-repo')
  assert.equal((await get(url, { host: 'evil.example' })).status, 403)
  assert.equal((await get(url, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await get(url, {}, 'POST')).status, 405)
  assert.equal((await get(`${url}/../../package.json`)).status, 404)
  assert.equal((await get(`${url}/api/dsh-gitworktree-gui/state?cwd=${encodeURIComponent(tmpdir())}`)).status, 403)
  assert.match(state.headers['content-security-policy'], /default-src 'self'/)
  assert.equal(state.headers['cache-control'], 'no-store')
})

test('merged route serves commit details and preserves ETag and root fences', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'panel-detail-route-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(repo, 'test.txt'), 'route detail\n')
  git('add', '.'); git('commit', '-q', '-m', 'initial')
  const sha = git('rev-parse', 'HEAD')
  const { server, url } = await startPanel({ repo, assets: resolve('codex/dist') })
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections() }))
  const endpoint = `${url}/api/dsh-gitworktree-gui/state`
  const detail = await get(`${endpoint}?commit=${sha}&file=test.txt`)
  assert.equal(detail.status, 200)
  assert.match(JSON.parse(detail.text).patch, /\+route detail/)
  assert.equal((await get(`${endpoint}?commit=${sha}&file=test.txt`, { 'if-none-match': detail.headers.etag })).status, 304)
  assert.equal((await get(endpoint, { 'if-none-match': detail.headers.etag })).status, 200)
  assert.equal((await get(`${endpoint}?commit=${sha}&cwd=${encodeURIComponent(tmpdir())}`)).status, 403)
})
