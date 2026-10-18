import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { repo: { type: 'string' } } })
if (!values.repo) throw new Error('--repo is required')
const repo = realpathSync(values.repo)
const dir = join(tmpdir(), `git-worktree-panel-${process.getuid?.() ?? 'local'}`)
await mkdir(dir, { recursive: true, mode: 0o700 })
const record = join(dir, `${createHash('sha256').update(repo).digest('hex')}.json`)
let ready
try {
  const saved = JSON.parse(await readFile(record, 'utf8'))
  const url = new URL(saved.url)
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
    const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1000) })
    const health = await response.json()
    if (health.app === 'git-worktree-panel' && health.repo === repo) ready = saved
  }
} catch {}
if (!ready) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.mjs', import.meta.url)), '--repo', repo], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Panel startup timed out')) }, 15000)
    child.once('message', message => { clearTimeout(timer); resolve(message) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Panel exited before ready (${code})`)) })
  })
  child.disconnect()
  child.unref()
  await writeFile(record, JSON.stringify(ready), { mode: 0o600 })
}
console.log(JSON.stringify(ready))
