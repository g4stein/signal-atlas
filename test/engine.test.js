import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MARKETS, M15, aggregate, demoBars, parseCSV, mergeImports, studies,
  research, latestSetups, issue, advance, stats, compare, clearsGate,
} from '../src/engine.js'

const t0 = Date.UTC(2025, 0, 1)
const market = MARKETS[0]
const bar = (i, fields = {}) => ({ t: t0 + i * M15, o: 100, h: 103, l: 98, c: 101, v: 3, ...fields })
const series = (n, price) => Array.from({ length: n }, (_, i) => {
  const c = price?.(i) ?? 100
  return bar(i, { o: c, h: c + 2, l: c - 2, c })
})
const header = 'time,open,high,low,close,volume'
const rows = series(32).map(b => [b.t, b.o, b.h, b.l, b.c, b.v].join(','))
const file = (first = rows[0], options = {}) => [options.header ?? header, first, ...rows.slice(1)].join(options.newline ?? '\n')
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`)

test('aggregate aligns buckets and drops incomplete leading, trailing, and interior buckets', () => {
  const bars = series(19).slice(1).filter((_, i) => i !== 8)
  const output = aggregate(bars, 60)
  assert.deepEqual(output.map(b => b.t), [t0 + M15 * 4, t0 + M15 * 12])
  assert.equal(output[0].v, 12)
  assert.equal(aggregate(bars, 15), bars)
})

test('aggregate uses first open, last close, extrema, and propagates null volume', () => {
  const output = aggregate([
    bar(0, { o: 101, h: 110 }), bar(1, { l: 95, v: null }),
    bar(2), bar(3, { c: 102 }),
  ], 60)
  assert.deepEqual(output, [{ t: t0, o: 101, h: 110, l: 95, c: 102, v: null }])
})

test('parseCSV accepts BOM, CRLF, quoted headers, and quoted thousands separators', () => {
  const input = file(`"${t0}","67,500.00","68,000.00","67,000.00","67,900.00","1,234.50"`, {
    header: '\uFEFF"time","open","high","low","close","volume","note"',
    newline: '\r\n',
  }).replace('"1,234.50"', '"1,234.50","said ""hi"""')
  const result = parseCSV(input)
  assert.deepEqual(result[0], bar(0, { o:67500, h:68000, l:67000, c:67900, v:1234.5 }))
  assert.equal(result.length, 32)
})

test('parseCSV interprets zone-free ISO times as UTC and accepts explicit offsets and Unix seconds', () => {
  for (const timestamp of ['2025-01-01 00:00', '2025-01-01T00:00', '2025-01-01T05:30+05:30', String(t0 / 1000)]) {
    assert.equal(parseCSV(file(`${timestamp},100,103,98,101,`))[0].t, t0)
    assert.equal(parseCSV(file(`${timestamp},100,103,98,101,`))[0].v, null)
  }
})

test('parseCSV rejects ambiguous, misaligned, impossible, and unclosed timestamps', () => {
  for (const timestamp of ['01/02/2025', '2025-01-01T00:13Z', '2025-02-30T00:00Z',
    String(Math.floor(Date.now() / M15) * M15), '2099-01-01T00:00Z']) {
    assert.throws(() => parseCSV(file(`${timestamp},100,103,98,101,3`)), /Row 2.*closed, quarter-hour/)
  }
})

test('parseCSV rejects missing columns, duplicates, invalid OHLC, and ambiguous quoting', () => {
  assert.throws(() => parseCSV(file(rows[0], { header: 'time,open,low,close,volume' })), /Required columns/)
  assert.throws(() => parseCSV(file(rows[1])), /repeats/)
  assert.throws(() => parseCSV(file(`${t0},100,99,98,101,3`)), /valid OHLC/)
  assert.throws(() => parseCSV(file(`${t0},67,500,68000,67000,67900,3`)), /thousands separators/)
  assert.throws(() => parseCSV(file(`${t0},"100,103,98,101,3`)), /unclosed quoted field/)
})

test('parseCSV enforces the inclusive 32 to 16,000 row limits', () => {
  const input = n => [header, ...series(n).map(b => [b.t,b.o,b.h,b.l,b.c,b.v].join(','))].join('\n')
  assert.throws(() => parseCSV(input(31)), /32 and 16,000/)
  assert.equal(parseCSV(input(32)).length, 32)
  assert.equal(parseCSV(input(16000)).length, 16000)
  assert.throws(() => parseCSV(input(16001)), /32 and 16,000/)
})

test('mergeImports deduplicates overlap, rejects rewrites and insertions, and trims oldest rows', () => {
  const full = series(16002)
  const merged = mergeImports(full.slice(0, 16000), full.slice(15999))
  assert.equal(merged.length, 16000)
  assert.equal(merged[0], full[2])
  assert.equal(merged.at(-1), full.at(-1))
  assert.throws(() => mergeImports([bar(0), bar(2)], [bar(1)]), /inserts a candle/)
  assert.throws(() => mergeImports([bar(0)], [bar(0, { c: 102 })]), /already saved/)
})

test('EMA seeds from an SMA, MACD signal first appears at index 33, and bands use population SD', () => {
  const bars = series(52, i => 100 + i)
  bars[20] = { ...bars[20], c: 135 }
  const s = studies(bars)
  assert.equal(s.ema20[18], null)
  near(s.ema20[19], 109.5)
  near(s.ema20[20], 109.5 + (135 - 109.5) * 2 / 21)
  assert.equal(s.ema50[48], null)
  near(s.ema50[49], 124.5 + 15 / 50)
  assert.equal(s.macd.findIndex(x => x !== null), 25)
  assert.equal(s.macdSignal.findIndex(x => x !== null), 33)
  near(s.macdSignal[33], s.macd.slice(25,34).reduce((a,b) => a+b) / 9)
  near(s.band[19].upper, 109.5 + 2 * Math.sqrt(33.25))
  near(s.band[19].lower, 109.5 - 2 * Math.sqrt(33.25))
})

test('Wilder RSI and ATR match hand-derived seeds and next values', () => {
  const closes = [100, 103, 101, 104, 102, 105, 103, 106, 104, 107, 105, 108, 106, 109, 107, 113]
  const bars = series(closes.length, i => closes[i])
  const s = studies(bars)
  assert.equal(s.rsi[13], null)
  near(s.rsi[14], 60)
  near(s.rsi[15], 100 - 100 / (1 + 25.5 / 13))
  assert.equal(s.atr[12], null)
  near(s.atr[13], 4.5)
  near(s.atr[14], (13 * 4.5 + 4) / 14)
  near(s.atr[15], (13 * s.atr[14] + 8) / 14)
})

test('RSI handles gains-only, losses-only, and a flat window', () => {
  assert.equal(studies(series(15, i => 100 + i)).rsi[14], 100)
  assert.equal(studies(series(15, i => 100 - i)).rsi[14], 0)
  assert.equal(studies(series(15)).rsi[14], 50)
})

test('setups use closed context, remain identical with future history, and reject stale context or a gap', () => {
  const bars = demoBars(market)
  const prefix = research(bars.slice(0, 1552))
  const setup = latestSetups(prefix, 'base')[0]
  assert.ok(setup)
  const full = research(bars)
  const withFuture = { ...full, bars: prefix.bars, hourly: prefix.hourly }
  assert.deepEqual(latestSetups(withFuture, 'base')[0], setup)
  const cutoff = setup.setupAt - 4 * 60 * 60000
  const h4 = prefix.h4.filter(b => b.t + 4 * 60 * 60000 < cutoff)
  assert.deepEqual(latestSetups({ ...prefix, h4 }, 'base'), [])
  assert.deepEqual(latestSetups(research(bars.slice(0,1552).filter((_, i) => i !== 1545)), 'base'), [])
})

const setup = { setupAt: t0, entry: 100, stop: 98, target: 104, direction: 1, risk: 2 }
const signal = issue(setup, market, 'demo', 'base', t0)
const missed = (i) => bar(i, { o: 99, h: 99.5, l: 98.5, c: 99 })
const opened = (i) => bar(i, { o: 101, h: 103, l: 99, c: 102 })
const entered = (i) => bar(i, { o: 99, h: 103, l: 99, c: 102 })

test('advance waits for entry, models intrabar and opening fills, and tracks exit deadline', () => {
  assert.equal(advance(signal, []).outcome, 'Waiting')
  assert.equal(advance(signal, [missed(0)]).outcome, 'Waiting')
  const intrabar = advance(signal, [entered(0)])
  assert.equal(intrabar.outcome, 'Open')
  assert.equal(intrabar.fill, 100)
  assert.equal(intrabar.timeExit, t0 + 24 * M15)
  assert.equal(advance(signal, [opened(0)]).fill, 101)
  const short = issue({ ...setup, direction: -1, target: 96, stop: 102 }, market, 'demo', 'base', t0)
  assert.equal(advance(short, [bar(0,{o:101,h:101,l:95,c:96})]).outcome, 'Target')
})

test('advance computes target and stop returns after costs', () => {
  const hit = advance(signal, [bar(0, { o: 101, h: 105, l: 99 })])
  assert.equal(hit.outcome, 'Target')
  near(hit.net, 3 / 101 - .001)
  near(hit.netR, (3 - .101) / 2)
  const stop = advance(signal, [opened(0), bar(1, { o: 101, l: 97 })])
  assert.equal(stop.outcome, 'Stop')
  near(stop.netR, (-3 - .101) / 2)
})

test('advance honors gap-through-stop price and caps gap-through-target at the target', () => {
  const open = advance(signal, [opened(0)])
  for (const [o, outcome, exit] of [[95, 'Stop', 95], [106, 'Target', 104]]) {
    const result = advance(open, [bar(1,{o,h:o+1,l:o-1,c:o})])
    assert.equal(result.outcome, outcome)
    assert.equal(result.exitPrice, exit)
    assert.equal(result.finished, t0 + M15)
  }
})

test('advance expires an untriggered signal, allows the final eligible candle, and times out a fill', () => {
  assert.equal(advance(signal, Array.from({ length: 7 }, (_, i) => missed(i))).outcome, 'Waiting')
  assert.equal(advance(signal, Array.from({ length: 8 }, (_, i) => missed(i))).outcome, 'Expired')
  const onLast = advance(signal, [...Array.from({ length: 7 }, (_, i) => missed(i)), entered(7)])
  assert.equal(onLast.outcome, 'Open')
  assert.equal(advance(signal, [bar(0,{o:99,h:99.5,l:97,c:98})]).outcome, 'Expired')
  assert.equal(advance(signal, [bar(0,{o:105,h:106,l:99,c:101})]).outcome, 'Expired')
  const resolved = advance(signal, Array.from({ length: 24 }, (_, i) => entered(i)))
  assert.equal(resolved.outcome, 'Time exit')
  assert.equal(resolved.exitPrice, 102)
  assert.equal(resolved.finished, t0 + 24 * M15)
})

test('advance marks disputed intrabar ordering and data gaps without fabricating a fill', () => {
  assert.equal(advance(signal, [bar(0,{o:99,h:101,l:97,c:100})]).outcome, 'Ambiguous')
  assert.equal(advance(signal, [bar(0,{o:101,h:105,l:97,c:100})]).outcome, 'Ambiguous')
  const gap = advance(signal, [opened(1)])
  assert.equal(gap.outcome, 'Data gap')
  assert.equal(gap.netR, null)
  assert.equal(advance(gap, [opened(0)]), gap)
})

test('stats sorts by finish time and counts priced, decisive, and entered trades separately', () => {
  const records = [
    { outcome: 'Target', netR: 2, finished: 3, fill: 100, strict: true },
    { outcome: 'Stop', netR: -1, finished: 2, fill: 100 },
    { outcome: 'Time exit', netR: .5, finished: 1, fill: 100 },
    { outcome: 'Ambiguous', finished: 0 }, { outcome: 'Open', fill: 100 },
  ]
  assert.deepEqual(stats(records), { count: 3, targets: 1, decisive: 2, avg: .5, drawdown: 1, entered: 4 })
  assert.equal(compare(records).strict.count, 1)
})

test('promotion gate uses inclusive sample, average improvement, and drawdown boundaries', () => {
  const base = { count: 15, avg: .1, drawdown: 2 }
  const strict = { count: 15, avg: .2, drawdown: 2 }
  assert.equal(clearsGate({ base, strict }, 15), true)
  assert.equal(clearsGate({ base, strict }, 30), false)
  assert.equal(clearsGate({ base: { ...base, count: 30 }, strict: { ...strict, count: 30 } }, 30), true)
  assert.equal(clearsGate({ base, strict: { ...strict, avg: .199 } }, 15), false)
  assert.equal(clearsGate({ base, strict: { ...strict, drawdown: 2.01 } }, 15), false)
})
