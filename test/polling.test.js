import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function mount({ hidden = false, selectedPath = '' } = {}) {
  let plugin, cleanup, snapshot
  const pending = [], timers = new Map()
  let nextTimer = 0
  const listeners = new Map()
  const storage = new Map(selectedPath ? [['dsh-gitworktree-gui:cwd:s1', selectedPath]] : [])
  const updates = []
  let hookIndex = 0
  const doc = {
    visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }
  const React = {
    createElement: (...args) => args,
    useState(initial) {
      const index = hookIndex++
      const value = typeof initial === 'function' ? initial() : initial
      return [value, update => {
        updates[index] = typeof update === 'function' ? update(updates[index] ?? value) : update
        if (value?.status) snapshot = typeof update === 'function' ? update(snapshot ?? value) : update
      }]
    },
    useRef: () => ({ current: null }),
    useMemo: fn => fn(),
    useEffect: fn => { cleanup = fn() },
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
    localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key) },
    document: doc,
    URLSearchParams, AbortController,
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, options })),
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++nextTimer; timers.set(id, fn); return id },
    clearInterval: id => timers.delete(id),
  })
  const tree = plugin.components.Panel({ t: key => key, sessionId: 's1' })
  return { pending, timers, tree, storage, updates, listeners, visibility: value => { doc.visibilityState = value; listeners.get('visibilitychange')?.() }, close: () => cleanup(), state: () => snapshot }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function tick(h) {
  const [id, fn] = h.timers.entries().next().value
  h.timers.delete(id)
  fn()
}
test('slow request schedules no overlapping poll; unmount aborts and cancels', async () => {
  const h = mount()
  assert.equal(h.pending.length, 1)
  assert.equal(h.timers.size, 0)
  h.pending[0].resolve({ ok: true, json: async () => ({ ok: true }) })
  await flush()
  assert.equal(h.timers.size, 1)
  tick(h)
  assert.equal(h.pending.length, 2)
  assert.equal(h.timers.size, 0)
  h.close()
  assert.equal(h.pending[1].options.signal.aborted, true)
  h.pending[1].resolve({ ok: true, json: async () => ({ ok: true, late: true }) })
  await flush()
  assert.equal(h.timers.size, 0)
  assert.equal(h.state().data.late, undefined)
})
test('repeated network and HTTP failures preserve the last snapshot as stale', async () => {
  const h = mount()
  h.pending[0].resolve({ ok: true, json: async () => ({ ok: true, cwd: '/repo' }) })
  await flush()
  tick(h)
  h.pending[1].reject(new Error('offline'))
  await flush()
  assert.equal(h.state().status, 'stale')
  tick(h)
  h.pending[2].resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: 'git status failed' }) })
  await flush()
  assert.equal(h.state().status, 'stale')
  assert.equal(h.state().data.cwd, '/repo')
  assert.equal(h.state().message, 'git status failed')
  h.close()
  assert.equal(h.timers.size, 0)
})

test('hidden pages stop polling and resume once on becoming visible', async () => {
  const h = mount({ hidden: true })
  assert.equal(h.pending.length, 0)
  h.visibility('visible')
  assert.equal(h.pending.length, 1)
  h.visibility('hidden')
  assert.equal(h.pending[0].options.signal.aborted, true)
  h.pending[0].reject(Object.assign(new Error('hidden'), { name: 'AbortError' }))
  await flush()
  assert.equal(h.timers.size, 0)
  h.visibility('visible')
  assert.equal(h.pending.length, 2)
  h.pending[1].resolve({ ok: true, json: async () => ({ ok: true }) })
  await flush()
  assert.equal(h.timers.size, 1)
  h.visibility('hidden')
  assert.equal(h.timers.size, 0)
  h.close()
  assert.equal(h.listeners.size, 0)
})
test('visibility changes during a slow request never start a concurrent request', async () => {
  const h = mount()
  h.visibility('hidden')
  h.visibility('visible')
  assert.equal(h.pending.length, 1)
  assert.equal(h.pending[0].options.signal.aborted, true)
  h.pending[0].reject(Object.assign(new Error('hidden'), { name: 'AbortError' }))
  await flush()
  tick(h)
  assert.equal(h.pending.length, 2)
  h.close()
})
test('return to session clears the saved override and reloads the session target', () => {
  const h = mount({ selectedPath: '/other-worktree' })
  let button
  const visit = node => {
    if (!Array.isArray(node)) return
    if (node[0] === 'button' && node[1]?.title === 'action.session') button = node
    node.forEach(visit)
  }
  visit(h.tree)
  assert.ok(button)
  button[1].onClick()
  assert.equal(h.storage.size, 0)
  assert.equal(h.updates[0], '')
  assert.equal(h.updates[2], 1)
  h.close()
})
