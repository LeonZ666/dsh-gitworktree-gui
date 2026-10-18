import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Load the browser half against a React stub that keeps the element tree. */
function load() {
  let plugin
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: () => ({ current: null }),
    useState: (initial) => [typeof initial === 'number' ? 480 : initial, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    Fragment: 'Fragment',
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (module) => { plugin = module.factory(() => React) } } },
  })
  return plugin.components
}

function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  out.push(node)
  flatten(node.children, out)
  return out
}

const text = (element) => JSON.stringify(flatten(element))
/** Fake translator: keeps the key and renders its variables for assertions. */
const t = (key, vars) => vars === undefined
  ? key
  : `${key} ${Object.keys(vars).map((name) => `${name}=${vars[name]}`).join(' ')}`

const baseTree = {
  path: '/repo/wt',
  branch: 'feature/x',
  head: 'abcdef1234567890',
  short: 'abcdef1',
  detached: false,
  exists: true,
  isSelected: true,
  ahead: 2,
  behind: 0,
  upstream: 'origin/feature/x',
  dirty: { staged: 1, modified: 2, untracked: 0, conflicted: 0 },
  dirtyTotal: 3,
  lastCommit: { hash: 'abcdef1', date: '2026-01-01T00:00:00Z', subject: 'work in progress' },
}

test('worktree details list path, HEAD, upstream, tracking and dirty count', () => {
  const components = load()
  const rendered = text(components.WorktreeDetails({
    t, tree: baseTree, onClose() {}, onSwitch() {}, onInspectCommit() {},
  }))
  for (const needle of [
    'detail.worktree',
    '/repo/wt',
    'abcdef1',
    'work in progress',
    'origin/feature/x',
    'bar.aheadBehind ahead=2 behind=0',
    'detail.dirtyTotal',
    'dirty.modified 2',
    'bar.dirty',
  ]) {
    assert.ok(rendered.includes(needle), `missing ${needle}`)
  }
  // The viewed tree offers no "switch" action, only the commit shortcut.
  assert.ok(!rendered.includes('detail.openWorktree'))
  assert.ok(rendered.includes('detail.viewCommit'))
})

test('worktree details render a detached HEAD and a conflict state', () => {
  const components = load()
  const tree = {
    ...baseTree,
    branch: undefined,
    detached: true,
    short: 'deadbee',
    ahead: 0,
    behind: 3,
    upstream: undefined,
    dirty: { staged: 0, modified: 0, untracked: 0, conflicted: 1 },
    dirtyTotal: 1,
  }
  const rendered = text(components.WorktreeDetails({ t, tree, onClose() {} }))
  assert.ok(rendered.includes('bar.detached sha=deadbee'))
  assert.ok(rendered.includes('detail.upstreamNone'))
  assert.ok(rendered.includes('bar.conflict'))
  assert.ok(!rendered.includes('detail.openWorktree'))
})

test('a worktree that is gone reports the missing state', () => {
  const components = load()
  const rendered = text(components.WorktreeDetails({ t, tree: null, onClose() {} }))
  assert.ok(rendered.includes('detail.missing'))
})

test('branch details show tip, upstream, tracked worktree and merge state', () => {
  const components = load()
  const branch = {
    name: 'feature/x',
    sha: 'abcdef1234567890',
    upstream: 'origin/feature/x',
    ahead: 1,
    behind: 0,
    isCurrent: true,
    isTrunk: false,
  }
  const tree = { ...baseTree, isSelected: false, merged: false }
  const rendered = text(components.BranchDetails({
    t,
    branch,
    tree,
    node: { short: 'abcdef1', subject: 'tip work' },
    onClose() {},
    onSwitch() {},
    onInspectCommit() {},
  }))
  for (const needle of [
    'detail.branch',
    'feature/x',
    'abcdef1',
    'tip work',
    'origin/feature/x',
    '/repo/wt',
    'detail.currentBranch',
    'detail.unmerged',
    'detail.openWorktree',
    'detail.viewCommit',
  ]) {
    assert.ok(rendered.includes(needle), `missing ${needle}`)
  }
})

test('a branch without a worktree still renders, without a path', () => {
  const components = load()
  const branch = { name: 'old', sha: 'fedcba9876543210', isTrunk: true }
  const rendered = text(components.BranchDetails({ t, branch, tree: undefined, node: undefined, onClose() {} }))
  assert.ok(rendered.includes('detail.trunkBranch'))
  assert.ok(rendered.includes('detail.upstreamNone'))
  assert.ok(rendered.includes('detail.none'))
  // Trunk branches are merged by definition.
  assert.ok(rendered.includes('detail.merged'))
  assert.ok(!rendered.includes('detail.openWorktree'))
})

const snapshot = {
  ok: true,
  cwd: '/work/repo',
  repoRoot: '/work/repo',
  commonDir: '/work/other',
  generatedAt: '',
  trunkBranch: 'main',
  currentBranch: 'feature/review',
  remoteBranchCount: 2,
  worktrees: [
    {
      path: '/work/other', exists: true, branch: 'feature/panel', head: 'c849a657a8537362ea938597c33d51b018db4a3c',
      short: 'c849a65', detached: false, isSelected: false, isMain: true, merged: true, group: 'uncommitted',
      dirty: { staged: 0, modified: 6, untracked: 5, conflicted: 0 }, dirtyTotal: 11, ahead: 0, behind: 0,
      lastCommit: { hash: 'c849a65', date: '2026-10-18T04:43:11+08:00', subject: 'panel work' },
    },
    {
      path: '/work/repo', exists: true, branch: 'feature/review', head: '6e3a20bdf457111b41afafc35bc4078c18cc091e',
      short: '6e3a20b', detached: false, isSelected: true, isMain: false, merged: true, group: 'uncommitted',
      dirty: { staged: 0, modified: 2, untracked: 5, conflicted: 0 }, dirtyTotal: 7, ahead: 1, behind: 0,
      upstream: 'origin/feature/review',
      lastCommit: { hash: '6e3a20b', date: '2026-10-18T04:01:14+08:00', subject: 'merge work' },
    },
  ],
  graph: { nodes: [{ sha: '6e3a20bdf457111b41afafc35bc4078c18cc091e', short: '6e3a20b', parents: [], parentLanes: [], row: 0, lane: 0, subject: 'merge work', refs: [{ kind: 'head', name: 'feature/review' }], isTrunk: true }], laneCount: 1, rails: [] },
  branches: [
    { name: 'feature/review', sha: '6e3a20bdf457111b41afafc35bc4078c18cc091e', isCurrent: true, isTrunk: false, upstream: 'origin/feature/review', ahead: 1, behind: 0 },
    { name: 'main', sha: '6e3a20bdf457111b41afafc35bc4078c18cc091e', isCurrent: false, isTrunk: true },
  ],
  changes: [{ x: ' ', y: 'M', path: 'client.js' }],
  files: ['client.js'],
  filesTruncated: false,
  fileCount: 1,
}

function mountPanel(data, extra = {}) {
  let plugin
  const state = []
  const effects = new Set()
  let cursor = 0
  const storage = new Map()
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: () => ({ current: null }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useEffect(effect) {
      const index = cursor++
      if (!effects.has(index)) { effects.add(index); effect() }
    },
    useMemo(fn) { cursor++; return fn() },
    memo: (component) => component,
    Fragment: 'Fragment',
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (module) => { plugin = module.factory(() => React) } } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    URLSearchParams, AbortController,
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => data }),
    setTimeout: () => 0, clearTimeout() {},
  })
  const render = () => { cursor = 0; return flatten(plugin.components.Panel({ t, sessionId: 's1', ...extra })) }
  return { plugin, render }
}

async function mountedPanel(data, extra = {}) {
  const mounted = mountPanel(data, extra)
  mounted.render()
  for (let i = 0; i < 12; i++) await Promise.resolve()
  return { ...mounted, tree: mounted.render() }
}

test('panel renders the top worktree band, then the graph, then the sections', async () => {
  const { plugin, render, tree } = await mountedPanel(snapshot)
  const rendered = JSON.stringify(tree)
  for (const needle of [
    'bar.title',
    '/work/repo',
    'feature/review',
    'bar.aheadBehind ahead=1 behind=0',
    'bar.dirty',
    'dirty.modified 2',
    'dirty.untracked 5',
    'bar.counts local=2 remote=2 worktrees=2',
    'section.worktrees',
    'section.changes',
    'section.files',
  ]) {
    assert.ok(rendered.includes(needle), `missing ${needle}`)
  }
  // The graph is mounted as a component between the top band and the bottom.
  assert.ok(tree.some((element) => element.type === plugin.components.Graph))

  // The viewed worktree lives in the top band only: the bottom list has the others.
  const rows = tree.filter((element) => element.type === plugin.components.TreeRow)
  assert.deepEqual(rows.map((element) => element.props.tree.path), ['/work/other'])

  // Clicking a worktree row selects it and opens its detail pane in the bottom.
  rows[0].props.onPick('/work/other')
  const next = render()
  const detail = next.find((element) => element.type === plugin.components.WorktreeDetails)
  assert.ok(detail)
  assert.equal(detail.props.tree.path, '/work/other')
  assert.equal(detail.props.onClose !== undefined, true)
})

test('a repository with one worktree shows no WORKTREES section at the bottom', async () => {
  const single = { ...snapshot, worktrees: [snapshot.worktrees[1]] }
  const { plugin, tree } = await mountedPanel(single)
  const rendered = JSON.stringify(tree)
  assert.ok(rendered.includes('bar.title'))
  assert.ok(rendered.includes('/work/repo'))
  assert.ok(!rendered.includes('section.worktrees'))
  assert.ok(tree.some((element) => element.type === plugin.components.Section && element.props.title === 'section.changes'))
})

test('clicking a file in CHANGES or FILES opens its absolute path in a sidebar tab', async () => {
  const opened = []
  const { plugin, tree } = await mountedPanel(snapshot, { openFile: (path) => opened.push(path) })

  const change = tree.find((element) => typeof element.props?.className === 'string' && element.props.className.startsWith('gw-change'))
  assert.ok(change, 'a change row is rendered')
  assert.ok(change.props.className.includes('is-openable'))
  assert.equal(change.props.role, 'button')
  change.props.onClick()

  const file = tree.find((element) => element.type === plugin.components.FileNode && element.props.node.type === 'file')
  assert.ok(file, 'a file row is rendered')
  assert.equal(typeof file.props.onOpen, 'function')
  file.props.onOpen(file.props.node.path)

  assert.deepEqual(opened, ['/work/repo/client.js', '/work/repo/client.js'])
})

test('without an injected opener file rows stay passive', async () => {
  const { plugin, tree } = await mountedPanel(snapshot)
  const file = tree.find((element) => element.type === plugin.components.FileNode && element.props.node.type === 'file')
  assert.ok(file)
  assert.equal(file.props.onOpen, undefined)
  const change = tree.find((element) => typeof element.props?.className === 'string' && element.props.className.startsWith('gw-change'))
  assert.ok(change)
  assert.ok(!change.props.className.includes('is-openable'))
  assert.equal(change.props.onClick, undefined)
})
