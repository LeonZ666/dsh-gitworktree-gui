import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('shared-tip rails render distinct reference lines without extra commit nodes', () => {
  let plugin
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }), useState: initial => [typeof initial === 'number' ? 480 : initial, () => {}], useEffect: () => {},
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
  })
  const tree = plugin.components.Graph({
    graph: {
      nodes: [{ sha: 'abc', row: 0, lane: 0, subject: 'initial', parents: [], refs: [], parentLanes: [] }],
      laneCount: 4,
      rails: [
        { name: 'feature-a', lane: 1, tip: 'abc', sharedTip: true },
        { name: 'feature-b', lane: 2, tip: 'abc', sharedTip: true },
        { name: 'old-feature', lane: 3, tip: 'outside', sharedTip: true, outOfWindow: true },
      ],
    },
    worktrees: [{ branch: 'feature-a', path: '/feature-a' }],
    onPick: path => { picked = path }, currentBranch: 'feature-a', t: key => key,
  })
  let picked
  const elements = []
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    elements.push(node)
    visit(node.children)
  }
  visit(tree)
  const lines = elements.filter(node => node.props?.key?.startsWith('ref-edge-'))
  assert.equal(lines.length, 3)
  assert.equal(lines[2].props.strokeDasharray, '3 3')
  assert.ok(JSON.stringify(tree).includes('graph.outside'))
  assert.notEqual(lines[0].props.d, lines[1].props.d)
  const tip = elements.find(node => node.props?.key === 'ref-tip-feature-a')
  tip.props.onClick()
  assert.equal(picked, '/feature-a')
  assert.ok(JSON.stringify(tree).includes('feature-a HEAD'))
  assert.equal(tip.props.className, 'gw-ref-tip is-current')
  assert.ok(lines[0].props.className.includes('is-current'))
  assert.ok(lines[0].props.d.includes('C'), 'branch connector has a smooth bend')
  assert.ok(elements.some(node => node.type === 'rect' && node.props.height === 18))
})

function renderGraph(props) {
  let plugin
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }), useState: initial => [typeof initial === 'number' ? 420 : initial, () => {}], useEffect: () => {},
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
  })
  return plugin.components.Graph({ worktrees: [], t: key => key, ...props })
}
function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...flatten(tree.children)]
}
test('real commit forks and merges use curves while same-lane history stays straight', () => {
  const nodes = [
    { sha: 'merge', row: 0, lane: 0, parents: ['main', 'branch'], parentLanes: [{ sha: 'main', lane: 0 }, { sha: 'branch', lane: 1 }], isTrunk: true },
    { sha: 'branch', row: 1, lane: 1, parents: ['main'], parentLanes: [{ sha: 'main', lane: 0 }] },
    { sha: 'main', row: 2, lane: 0, parents: [], parentLanes: [], isTrunk: true },
  ].map(node => ({ refs: [], subject: 'commit', short: node.sha, ...node }))
  const elements = flatten(renderGraph({ graph: { nodes, laneCount: 2 } }))
  assert.match(elements.find(node => node.props?.key === 'e-merge-branch').props.d, /C/)
  assert.match(elements.find(node => node.props?.key === 'e-branch-main').props.d, /C/)
  assert.doesNotMatch(elements.find(node => node.props?.key === 'e-merge-main').props.d, /C/)
})
test('unlabelled commits compact metadata and current rail nodes use current color', () => {
  const tree = renderGraph({
    currentBranch: 'feature',
    graph: {
      laneCount: 2, rails: [{ name: 'feature', lane: 1 }],
      nodes: [0, 1].map(row => ({ sha: `sha-${row}`, short: `sha-${row}`, row, lane: 1, parents: [], parentLanes: [], refs: [], subject: 'commit' })),
    },
  })
  const elements = flatten(tree)
  const node = elements.find(node => node.props?.key === 'n-sha-0')
  const own = flatten(node)
  const dot = own.find(item => item.props?.key === 'dot')
  const meta = own.find(item => item.props?.key === 'meta')
  assert.ok(dot.props.className.includes('is-current'))
  assert.ok(meta.props.y - dot.props.cy <= 24)
  const lastMeta = flatten(elements.find(node => node.props?.key === 'n-sha-1')).find(item => item.props?.key === 'meta')
  const svg = elements.find(node => node.type === 'svg')
  assert.ok(lastMeta.props.y < svg.props.height, 'oldest metadata remains inside the SVG')
})
test('dense graphs keep uniform track clearance and reserve readable label space', () => {
  const graph = {
    laneCount: 8, rails: [],
    nodes: Array.from({ length: 8 }, (_, lane) => ({ sha: `dense-${lane}`, row: lane, lane, parents: [], parentLanes: [], refs: [], subject: 'Dense graph', short: '1234567' })),
  }
  const elements = flatten(renderGraph({ graph }))
  const dots = elements.filter(node => node.props?.key === 'dot')
  const gaps = dots.slice(1).map((dot, i) => dot.props.cx - dots[i].props.cx)
  assert.ok(gaps.every(gap => gap === 32), 'track pitch stays at 32px even when the pane is narrow')
  const subject = elements.find(node => node.props?.key === 'subject')
  assert.equal(subject.props.x - dots.at(-1).props.cx, 24, 'rightmost track has a 24px text gutter')
  assert.ok(elements.find(node => node.type === 'svg').props.width - subject.props.x >= 200)
})
test('long branch connections turn near fork/merge and retain a straight branch rail', () => {
  const nodes = [
    { sha: 'tip', row: 0, lane: 1, parents: ['base'], parentLanes: [{ sha: 'base', lane: 0 }] },
    { sha: 'middle', row: 1, lane: 0, parents: [], parentLanes: [] },
    { sha: 'base', row: 2, lane: 0, parents: [], parentLanes: [] },
  ].map(node => ({ refs: [], subject: 'commit', short: node.sha, ...node }))
  const elements = flatten(renderGraph({ graph: { nodes, laneCount: 2 } }))
  const edge = elements.find(node => node.props?.key === 'e-tip-base').props.d
  assert.match(edge, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+C/, 'a long fork connection includes a vertical rail before its bend')
})

function interactiveGraph(props) {
  const state = []
  let cursor = 0, plugin
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }), useEffect: () => {},
    useState(initial) {
      const slot = cursor++
      if (!(slot in state)) state[slot] = initial === 0 ? 420 : initial
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value }]
    },
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React) } } },
  })
  return () => { cursor = 0; return flatten(plugin.components.Graph({ worktrees: [], t: key => key, ...props })) }
}
test('clicking any branch segment selects its entire path without switching worktrees', () => {
  const nodes = [
    {sha:'a2',lane:1,parents:['a1'],parentLanes:[{sha:'a1',lane:1}]},
    {sha:'a1',lane:1,parents:['main'],parentLanes:[{sha:'main',lane:0}]},
    {sha:'main',lane:0,parents:['root'],parentLanes:[{sha:'root',lane:0}],isTrunk:true},
    {sha:'root',lane:0,parents:[],parentLanes:[],isTrunk:true},
  ].map((node,row)=>({...node,row,subject:'commit',refs:[]}))
  const render = interactiveGraph({ graph: { nodes, laneCount:2, rails:[{name:'feature',lane:1}] }, onPick:()=>assert.fail('selection must not switch worktrees') })
  let elements = render()
  const segments = () => elements.filter(el=>el.props?.className==='gw-segment')
  assert.equal(segments().length, 3)
  segments()[0].props.onClick()
  elements = render()
  assert.equal(elements.filter(el=>el.props?.className?.includes('gw-edge ') && el.props.className.includes('is-selected')).length, 2)
  assert.equal(elements.filter(el=>el.props?.className==='gw-flow').length, 2)
  assert.equal(elements.filter(el=>el.props?.className?.includes('is-dim')).length, 1)
  assert.ok(segments().slice(0,2).every(el=>el.props['aria-pressed']===true))
  segments()[1].props.onClick()
  elements = render()
  assert.equal(elements.filter(el=>el.props?.className==='gw-flow').length, 0)
  segments()[2].props.onKeyDown({key:'Enter',preventDefault(){}})
  elements = render()
  assert.equal(elements.filter(el=>el.props?.className==='gw-flow').length, 1)
  segments()[2].props.onKeyDown({key:'Escape',preventDefault(){}})
  assert.equal(render().filter(el=>el.props?.className==='gw-flow').length, 0)
})
test('reference-only branch selection flows from the anchor toward its open endpoint', () => {
  const render = interactiveGraph({ graph: {
    nodes:[{sha:'base',row:0,lane:0,parents:[],parentLanes:[],refs:[],subject:'initial'}],
    rails:[{name:'empty',lane:1,tip:'base',sharedTip:true}],laneCount:2,
  } })
  render().find(el=>el.props?.className==='gw-segment').props.onClick()
  const flow = render().find(el=>el.props?.className==='gw-flow')
  assert.equal(flow.props.style['--gw-flow-shift'], '-32')
  render().find(el=>el.type==='button' && el.children.includes('graph.clear')).props.onClick()
  assert.equal(render().filter(el=>el.props?.className==='gw-flow').length, 0)
})

test('branch segments and reference tips report their node for the detail pane', () => {
  const nodes = [
    {sha:'a2',lane:1,parents:['a1'],parentLanes:[{sha:'a1',lane:1}]},
    {sha:'a1',lane:1,parents:['main'],parentLanes:[{sha:'main',lane:0}]},
    {sha:'main',lane:0,parents:['root'],parentLanes:[{sha:'root',lane:0}],isTrunk:true},
    {sha:'root',lane:0,parents:[],parentLanes:[],isTrunk:true},
  ].map((node,row)=>({...node,row,subject:'commit',refs:[]}))
  const inspected = []
  const render = interactiveGraph({
    graph: { nodes, laneCount:2, rails:[{name:'feature',lane:1}] },
    trunkBranch: 'main',
    onInspectBranch: name => inspected.push(name),
  })
  render().find(el => el.props?.className === 'gw-segment').props.onClick()
  assert.deepEqual(inspected, ['feature'])

  let picked
  const tipRender = interactiveGraph({
    graph: {
      nodes: [{sha:'abc',row:0,lane:0,parents:[],parentLanes:[],refs:[],subject:'initial'}],
      laneCount: 2,
      rails: [{name:'feature-a',lane:1,tip:'abc',sharedTip:true}],
    },
    worktrees: [{ branch:'feature-a', path:'/feature-a' }],
    onPick: path => { picked = path },
    onInspectWorktree: path => inspected.push(path),
  })
  tipRender().find(el => el.props?.key === 'ref-tip-feature-a').props.onClick()
  assert.equal(picked, '/feature-a')
  assert.ok(inspected.includes('/feature-a'))
})
