/**
 * DSH packaging contract: the manifest stays a standard combination bundle and
 * the browser half still claims the public seats it is written against. These
 * are the three things a DSH release can move out from under the plugin without
 * any of the data tests noticing.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

/** Seats the pane rides; each must be injected before it is registered. */
const SEATS = [
  'conversation.session.header.utilities',
  'sidebar.right.pane.tab',
  'sidebar.right.pane.tab.title',
]

/** Load the browser half and return the object it hands the module loader. */
function loadClient() {
  let plugin
  const React = { createElement: () => null, Fragment: 'fragment' }
  vm.runInNewContext(readFileSync(new URL('client.js', root), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
    document: {
      visibilityState: 'visible',
      head: { appendChild() {} },
      createElement: () => ({ setAttribute() {}, remove() {} }),
      addEventListener() {},
      removeEventListener() {},
    },
    localStorage: { getItem: () => null, removeItem() {} },
    URLSearchParams, AbortController,
    fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  })
  return plugin
}

test('the manifest declares the DSH bundle, client and version gate', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(new URL(manifest.dsh.bundle.patch, root)))

  const client = manifest.dsh.client
  assert.equal(client.platform, 'web')
  assert.equal(client.immediately, true)
  assert.ok(Array.isArray(client.inject) && client.inject.every(entry => typeof entry === 'string'))
  // The loader resolves a plugin's browser half through this export.
  assert.equal(manifest.exports['./client'], './client.js')
  assert.ok(existsSync(new URL(manifest.exports['./client'], root)))

  // Unmet engines.dsh refuses the install before pnpm runs; keep it declared.
  assert.match(manifest.engines.dsh, /^\s*>?=?\s*\d+\.\d+\.\d+/)
  assert.equal(manifest.private, undefined, 'a publishable package must not be private')

  const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /id: dsh-gitworktree-gui/)
  assert.match(patch, /name: dsh-gitworktree-gui/)
})

test('the browser half injects and registers the public DSH seats', () => {
  const plugin = loadClient()
  const calls = []
  const ctx = {
    effect: run => run(),
    locale: { register: () => {}, bind: () => key => key },
    slots: {
      inject: (name, run) => { calls.push(['inject', name]); return run() },
      register: (definition) => { calls.push(['register', definition.name]); return () => {} },
    },
    sidebarRightTabs: { register: definition => { calls.push(['tab-type', definition.kind]); return () => {} } },
    sidebarRight: { openTab: kind => calls.push(['open-tab', kind]), openTabs: [] },
  }
  plugin.apply(ctx)

  const injected = calls.filter(([kind]) => kind === 'inject').map(([, name]) => name).sort()
  const registered = calls.filter(([kind]) => kind === 'register').map(([, name]) => name).sort()
  assert.deepEqual(injected, [...SEATS].sort())
  assert.deepEqual(registered, [...SEATS].sort())
  assert.deepEqual(calls.find(([kind]) => kind === 'tab-type'), ['tab-type', 'gitworktree-gui'])
  assert.ok(plugin.inject.includes('sidebarRightTabs'))
  assert.ok(plugin.inject.includes('sidebarRight'))
})

test('the header trigger opens the pane kind the tab type declares', () => {
  const plugin = loadClient()
  const opened = []
  const registry = new Map()
  const ctx = {
    effect: run => run(),
    locale: { register: () => {}, bind: () => key => key },
    slots: {
      inject: (_name, run) => run(),
      register: (definition) => { registry.set(definition.id ?? definition.key, definition); return () => {} },
    },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: kind => opened.push(kind), openTabs: [] },
  }
  plugin.apply(ctx)
  const trigger = registry.get('gitworktree-gui-open')
  assert.ok(trigger, 'the header trigger is registered')
  // The seat injects the opener; it must target the kind the tab type declared.
  trigger.inject('s1').open()
  assert.deepEqual(opened, ['gitworktree-gui'])
})
