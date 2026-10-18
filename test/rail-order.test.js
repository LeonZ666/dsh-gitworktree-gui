import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderRails } from '../index.js'

test('interleaved commits place a merged inner branch without avoidable crossings', () => {
  const commits = [
    { sha: 'ui2', parents: ['ui1'] }, { sha: 'ui1', parents: ['base'] },
    { sha: 'api2', parents: ['api1'] }, { sha: 'api1', parents: ['base'] },
    { sha: 'merge', parents: ['base', 'fix'] }, { sha: 'fix', parents: ['base'] },
    { sha: 'base', parents: [] },
  ]
  const lanes = new Map([['ui2',1],['ui1',1],['api2',2],['api1',2],['merge',0],['fix',4],['base',0]])
  const rails = [{ name:'ui',lane:1 },{ name:'api',lane:2 },{ name:'empty',lane:3,sharedTip:true },{ name:'merged:fix',lane:4 }]
  const result = orderRails(commits, lanes, rails)
  assert.ok(result.previousCrossings > result.crossings)
  assert.equal(result.crossings, 0)
  assert.equal(result.rails.find(r => r.name === 'merged:fix').lane, 1)
  assert.equal(result.rails.find(r => r.name === 'empty').lane, 4)
  assert.deepEqual(result.rails.map(r => r.lane), [1,2,3,4])
})
test('equal crossing scores preserve previous relative rail order', () => {
  const commits = [{sha:'a',parents:['base']},{sha:'b',parents:['base']},{sha:'base',parents:[]}]
  const result = orderRails(commits, new Map([['a',1],['b',2],['base',0]]), [{name:'a',lane:1},{name:'b',lane:2}])
  assert.deepEqual(result.rails.map(r => r.name), ['a','b'])
})
test('different valid topological interleavings never increase the crossing score', () => {
  const commits = {
    ui2:{sha:'ui2',parents:['ui1']},ui1:{sha:'ui1',parents:['base']},
    api2:{sha:'api2',parents:['api1']},api1:{sha:'api1',parents:['base']},
    merge:{sha:'merge',parents:['base','fix']},fix:{sha:'fix',parents:['base']},base:{sha:'base',parents:[]},
  }
  for (const sequence of [
    ['ui2','api2','merge','ui1','api1','fix','base'],
    ['merge','fix','api2','api1','ui2','ui1','base'],
    ['api2','ui2','ui1','merge','fix','api1','base'],
  ]) {
    const result = orderRails(sequence.map(sha=>commits[sha]),
      new Map([['ui2',1],['ui1',1],['api2',2],['api1',2],['merge',0],['fix',4],['base',0]]),
      [{name:'ui',lane:1},{name:'api',lane:2},{name:'empty',lane:3,sharedTip:true},{name:'fix',lane:4}])
    assert.ok(result.crossings <= result.previousCrossings)
    assert.equal(result.rails.at(-1).name,'empty')
    assert.equal(result.laneOf.get('merge'),0)
    assert.equal(result.laneOf.get('base'),0)
  }
})
