import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('closing commit details aborts pending requests and ignores late responses', async () => {
  let plugin
  const pending = [], cleanups = [], updates = []
  let index = 0
  const React = {
    createElement: (...args) => args,
    useState: initial => {
      const key = index++
      return [initial, value => updates.push({ key, value })]
    },
    useEffect: effect => cleanups.push(effect()),
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
    URLSearchParams, AbortController,
    fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
  })
  plugin.components.CommitDetails({ sha: 'abcdef123', query: 'cwd=%2Frepo', t: key => key, onClose() {} })
  assert.equal(pending.length, 1)
  assert.equal(new URLSearchParams(pending[0].url.split('?')[1]).get('commit'), 'abcdef123')
  assert.equal(new URLSearchParams(pending[0].url.split('?')[1]).get('cwd'), '/repo')
  cleanups.filter(Boolean).forEach(cleanup => cleanup())
  assert.equal(pending[0].options.signal.aborted, true)
  const before = updates.length
  pending[0].resolve({ ok: true, json: async () => ({ ok: true, files: [{ path: 'late.txt' }] }) })
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.equal(updates.length, before)
})
