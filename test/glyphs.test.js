import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ago, clip, fileRows, isDirty, railRows } from '../lib/glyphs.js'

const node = (sha, row, lane, parents, parentLanes, extra = {}) => ({
  sha, row, lane, parents, parentLanes: parentLanes.map(([s, l]) => ({ sha: s, lane: l })), isCurrent: false, ...extra,
})
const text = (rows) => rows.map((runs) => runs.map((r) => r.text).join('').trimEnd())

describe('rails', () => {
  test('a straight trunk is one vertical rail of dots', () => {
    const rows = railRows([node('c', 0, 0, ['b'], [['b', 0]]), node('b', 1, 0, ['a'], [['a', 0]]), node('a', 2, 0, [], [])], 1)
    assert.deepEqual(text(rows), ['●', '●', '●'])
  })

  test('a fork closes with ╯ and a merge opens with ╮; the branch rides on its lane', () => {
    // m(merge: trunk b + branch f) / f on lane 1 / b / a
    const nodes = [
      node('m', 0, 0, ['b', 'f'], [['b', 0], ['f', 1]]),
      node('f', 1, 1, ['a'], [['a', 0]]),
      node('b', 2, 0, ['a'], [['a', 0]]),
      node('a', 3, 0, [], []),
    ]
    assert.deepEqual(text(railRows(nodes, 2)), ['◆ ╮', '│ ●', '● │', '● ╯'])
  })
})

describe('helpers', () => {
  test('clip counts wide characters twice and ends in an ellipsis', () => {
    assert.equal(clip('hello world', 6), 'hello…')
    assert.equal(clip('你好世界你好', 7).length <= 4, true)
    assert.equal(clip('short', 20), 'short')
  })

  test('ago', () => {
    assert.equal(ago(100, 100e3 + 30e3), 'now')
    assert.equal(ago(100, 100e3 + 3 * 3600e3), '3h')
    assert.equal(ago(0), '')
  })

  test('fileRows folds directories unless opened or searching', () => {
    const files = ['a/b/c.js', 'a/d.js', 'e.js']
    assert.deepEqual(fileRows(files, new Set()).map((r) => r.path), ['a', 'e.js'])
    assert.deepEqual(fileRows(files, new Set(['a'])).map((r) => r.path), ['a', 'a/b', 'a/d.js', 'e.js'])
    assert.equal(fileRows(files, new Set(), true).length, 5)
  })

  test('isDirty: a dirty directory entry covers the files below it', () => {
    const dirty = new Set(['.dsh', 'src/x.js'])
    assert.equal(isDirty(dirty, '.dsh/state.json'), true)
    assert.equal(isDirty(dirty, 'src/x.js'), true)
    assert.equal(isDirty(dirty, 'src/y.js'), false)
  })
})

import { agoLong, changeBadge, fitPx, graphSvgs, paneWidthPx, textWidth, xml } from '../lib/glyphs.js'

const graph = () => [
  node('m', 0, 0, ['b', 'f'], [['b', 0], ['f', 1]], { isTrunk: true, short: 'mmmmmmm', subject: 'Merge <feat> & co', author: 'me', time: 100, refs: [{ kind: 'head', name: 'main' }, { kind: 'branch', name: 'main' }, { kind: 'remote', name: 'origin/main' }, { kind: 'remote', name: 'origin/HEAD' }] }),
  node('f', 1, 1, ['a'], [['a', 0]], { subject: 'feat work', refs: [{ kind: 'branch', name: 'feat' }, { kind: 'tag', name: 'v1' }] }),
  node('b', 2, 0, ['a'], [['a', 0]], { isTrunk: true, subject: 'trunk work', refs: [] }),
  node('a', 3, 0, [], [], { isTrunk: true, subject: 'root', refs: [] }),
]

describe('svg graph', () => {
  test('one well-formed drawing: curves for merge and fork, halo, chips, escaped text', () => {
    const { width, parts } = graphSvgs(graph(), 2, { width: 400, currentBranch: 'main', now: 100e3 + 3 * 3600e3 })
    assert.equal(width, 400)
    assert.equal(parts.length, 1)
    const svg = parts[0].source
    assert.match(svg, /^<svg [^>]*width="400"[^>]*>.*<\/svg>$/s)
    assert.equal((svg.match(/<path [^>]*d="M[^"]*C/g) ?? []).length, 2) // merge out + fork in
    assert.match(svg, /r="8" fill="none"/) // HEAD halo
    assert.match(svg, />main<\/text>/)
    assert.match(svg, />← HEAD<\/text>/)
    assert.doesNotMatch(svg, /origin\/(main|HEAD)/) // mirrors of local branches are dropped
    assert.match(svg, />#v1<\/text>/)
    assert.match(svg, /Merge &lt;feat&gt; &amp; co/)
    assert.match(svg, /mmmmmmm · 3 小时前 · me/)
    assert.match(svg, /prefers-color-scheme: dark/)
  })

  test('long histories split into stacked bands; rows limits what is drawn', () => {
    const all = graphSvgs(graph(), 2, { width: 300, chunk: 2 })
    assert.equal(all.parts.length, 2)
    const [one, two] = all.parts.map((p) => Number(p.source.match(/viewBox="0 ([\d.]+) /)[1]))
    assert.equal(one + all.parts[0].height, two) // the bands meet edge to edge
    const cut = graphSvgs(graph(), 2, { width: 300, rows: 2 })
    assert.equal(cut.parts.length, 1)
    assert.doesNotMatch(cut.parts[0].source, />root</)
    assert.match(cut.parts[0].source, />feat work</)
  })

  test('text fitting counts wide characters double and ends in an ellipsis', () => {
    assert.equal(textWidth('ab你', 6), 24)
    assert.equal(fitPx('short', 100, 6), 'short')
    const cut = fitPx('a much longer subject line', 60, 6)
    assert.ok(cut.endsWith('…') && textWidth(cut, 6) <= 60, cut)
    assert.equal(xml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    assert.equal(paneWidthPx(10), 260)
    assert.equal(paneWidthPx(1000), 960)
  })

  test('change badges and long relative time', () => {
    assert.deepEqual(changeBadge({ x: ' ', y: 'M' }), { label: 'M', tone: 'warning' })
    assert.deepEqual(changeBadge({ x: '?', y: '?' }), { label: '?', tone: 'inactive' })
    assert.deepEqual(changeBadge({ x: 'A', y: ' ' }), { label: 'A', tone: 'success' })
    assert.deepEqual(changeBadge({ x: ' ', y: 'D' }), { label: 'D', tone: 'error' })
    assert.deepEqual(changeBadge({ x: 'R', y: ' ' }), { label: 'R', tone: 'claude' })
    assert.equal(agoLong(100, 100e3 + 10 * 3600e3), '10 小时前')
    assert.equal(agoLong(100, 100e3 + 30e3), '刚刚')
  })
})
