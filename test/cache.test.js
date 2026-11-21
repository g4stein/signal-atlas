import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { MARKETS, MINUTE, demoBars, research, backtest, latestSetups, issue, advance, stats } from '../src/engine.js'
import { DEMO } from '../src/config.js'
import { createResearchCache } from '../src/research-cache.js'
import { plotGeometry } from '../src/chart.js'

test('50 replay steps preserve scanner ranking and backtest each distinct setup history once', t => {
  const fixtures = MARKETS.map(market => ({ market, bars: demoBars(market), journal: new Map() }))
  const workload = []
  for (let step = 0; step <= 50; step++) {
    for (const {market,bars,journal} of fixtures) {
      const visible = bars.slice(0, DEMO.initialBars + step)
      const data = research(visible)
      for (const [id, stored] of journal) journal.set(id, advance(stored, visible))
      const setup = latestSetups(data, 'base')[0]
      if (!setup) continue
      const draft = issue(setup, market, 'demo', 'base', visible.at(-1).t + 15 * MINUTE)
      if (!journal.has(draft.id)) journal.set(draft.id, draft)
      const signal = journal.get(draft.id)
      if (['Waiting','Open'].includes(signal.outcome)) workload.push({ market, visible, signal })
    }
  }

  let baselineCalls = 0, cachedCalls = 0
  const cache = createResearchCache((...args) => { cachedCalls++; return backtest(...args) })
  const baselineStart = performance.now()
  const baseline = workload.map(({market,visible,signal}) => {
    baselineCalls++
    const sample = visible.filter(b => b.t + 15 * MINUTE <= signal.setupAt - 60 * MINUTE)
    return stats(backtest(research(sample), market, 'demo').late.filter(s => s.strategy === signal.strategy))
  })
  const baselineMs = performance.now() - baselineStart
  const cachedStart = performance.now()
  const actual = workload.map(({market,visible,signal}) =>
    cache.evidence('demo', market, visible, signal.setupAt, signal.setupAt - 60 * MINUTE, 'base', signal.strategy))
  const cachedMs = performance.now() - cachedStart

  assert.deepEqual(actual, baseline)
  const histories = new Set(workload.map(({market,signal}) => market.id + '|' + signal.setupAt))
  assert.equal(cachedCalls, histories.size)
  assert.ok(cachedCalls < baselineCalls)
  for (const { market, visible, signal } of workload.slice(-2)) {
    const before = cachedCalls
    for (let i = 0; i < 50; i++) cache.evidence('demo', market, visible, signal.setupAt, signal.setupAt - 60 * MINUTE, 'base', signal.strategy)
    assert.ok(cachedCalls - before <= 1)
  }

  t.diagnostic(`50 steps plus initial draw: baseline ${baselineCalls} backtests (${baselineMs.toFixed(1)} ms), cached ${histories.size} (${cachedMs.toFixed(1)} ms)`)
})

test('cache reuses identical rows and invalidates historical corrections and frame changes', () => {
  let calls = 0
  const cache = createResearchCache((...args) => { calls++; return backtest(...args) })
  const m = MARKETS[0]
  const bars = demoBars(m).slice(0, 1552)
  const previous = cache.dataset('demo',m,bars)
  const clones = bars.map(b => ({ ...b }))
  assert.equal(cache.dataset('demo',m,clones),previous)
  const frames = cache.frameStudies('demo',m,240,previous.h4)
  assert.equal(cache.frameStudies('demo',m,240,previous.h4.map(b => ({ ...b }))),frames)
  const setup = latestSetups(previous,'base')[0]
  const evidence = input => cache.evidence('demo',m,input,setup.setupAt,setup.setupAt-60*MINUTE,'base',setup.strategy)
  assert.equal(evidence(bars), evidence(clones))
  assert.equal(calls,1)
  const corrected = clones.with(100, { ...clones[100], c: clones[100].c + .01 })
  assert.notEqual(cache.dataset('demo',m,corrected),previous)
  evidence(corrected)
  assert.equal(calls,2)
})

test('chart geometry stays positive and drops lower panes in priority order', () => {
  const panes = ['volume','rsi','macd']
  assert.deepEqual(plotGeometry(320, 250, panes).panes, panes)
  assert.deepEqual(plotGeometry(320, 170, panes).panes,['volume'])
  assert.deepEqual(plotGeometry(80, 100, panes).panes,[])
  const small = plotGeometry(1,1,panes)
  assert.ok(small.right > 0 && small.bottom > small.top)
})
