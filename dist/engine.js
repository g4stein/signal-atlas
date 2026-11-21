export const MINUTE = 60000
export const M15 = 15 * MINUTE
const HOUR = 4 * M15
const H4 = 4 * HOUR
export const MARKETS = [
  { id: 'BTC-USD', name: 'BTC/USD', title: 'Bitcoin', icon: '₿', color: '#f0af63', kind: 'Crypto', digits: 2, base: 67500, cost: 0.001 },
  { id: 'ETH-USD', name: 'ETH/USD', title: 'Ethereum', icon: 'Ξ', color: '#b5a5ff', kind: 'Crypto', digits: 2, base: 3400, cost: 0.001 },
  { id: 'EUR-USD', name: 'EUR/USD', title: 'Euro / US Dollar', icon: '€', color: '#82b9ff', kind: 'Forex', digits: 5, base: 1.086, cost: 0.00012 },
  { id: 'GBP-USD', name: 'GBP/USD', title: 'British Pound / US Dollar', icon: '£', color: '#e48ad2', kind: 'Forex', digits: 5, base: 1.273, cost: 0.00015 },
  { id: 'USD-JPY', name: 'USD/JPY', title: 'US Dollar / Japanese Yen', icon: '¥', color: '#6fddbf', kind: 'Forex', digits: 3, base: 152.9, cost: 0.00013 },
]
export const versions = { base: 'Baseline v1', strict: 'Momentum filter v2' }
export const resolved = new Set(['Target', 'Stop', 'Time exit'])
const waiting = new Set(['Waiting', 'Open'])
const finite = Number.isFinite
const last = a => a.at(-1)
const average = a => a.reduce((sum, val) => sum + val, 0) / a.length
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

export function aggregate(bars, minutes) {
  if (minutes === 15) return bars
  const interval = minutes * MINUTE
  const groupSize = interval / M15
  const output = []
  let group
  for (const bar of bars) {
    const t = Math.floor(bar.t / interval) * interval
    if (group?.t !== t) group = { ...bar, t, count: 0 }
    if (group.count > 0) group.v = group.v == null || bar.v == null ? null : group.v + bar.v
    group.count++
    group.h = Math.max(group.h, bar.h)
    group.l = Math.min(group.l, bar.l)
    group.c = bar.c
    if (group.count === groupSize) {
      const { count, ...complete } = group
      output.push(complete)
    }
  }
  return output
}

export function demoBars(market) {
  const index = MARKETS.indexOf(market)
  let seed = 457 + index * 7121
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const start = Date.UTC(2025, 8, 8)
  const scale = market.kind === 'Crypto' ? 1 : 0.31
  const direction = index === 4 ? -1 : 1
  let price = market.base * .965
  return Array.from({ length: 1904 }, (_, n) => {
    const o = price
    const cycle = Math.sin((n + index * 38) / 41) * .0006 + Math.cos((n + index * 28) / 15) * .00056
    const bias = Math.sin(n / 142 + index) * .00028 + .000035
    const lastTrend = n >= 1400 && n < 1536 ? direction * .00038 : 0
    const impulse = n === 1533 ? direction * .006 : 0
    price = o * (1 + scale * (cycle + bias + lastTrend + impulse + (random() - .5) * .00255))
    const h = Math.max(o, price) * (1 + scale * (.00022 + random() * .00136))
    const l = Math.min(o, price) * (1 - scale * (.00019 + random() * .00122))
    const v = market.kind === 'Crypto' ? Math.round((30 + 130 * random() + Math.abs(price / o - 1) * 27500) * 10) / 10 : null
    return { t: start + n * M15, o, h, l, c: price, v }
  })
}

function validBar(b) {
  return Number.isSafeInteger(b.t) && b.t > 0 && b.t <= Date.now() - M15 && b.t % M15 === 0
    && [b.o, b.h, b.l, b.c].every(n => finite(n) && n > 0)
    && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c)
    && (b.v === null || (finite(b.v) && b.v >= 0))
}

export function parseCSV(input) {
  const rows = input.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(row => row.trim())
  const columns = rows[0].split(',').map(col => col.trim().replace(/^"|"$/g, '').toLowerCase())
  const fields = ['time', 'open', 'high', 'low', 'close', 'volume']
  const indices = fields.map(name => columns.indexOf(name))
  if (indices.slice(0, 5).includes(-1)) throw Error('Required columns are time, open, high, low, and close.')
  if (rows.length < 33 || rows.length > 16001) throw Error('Upload between 32 and 16,000 candle rows.')
  const candleByTime = new Map()
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i].split(',').map(item => item.trim().replace(/^"|"$/g, ''))
    const [stamp, open, high, low, close, volume] = indices.map(index => values[index] ?? '')
    const time = /^\d{10}$/.test(stamp) ? Number(stamp) * 1000
      : /^\d{13}$/.test(stamp) ? Number(stamp)
      : /(?:Z|[+-]\d\d:\d\d)$/i.test(stamp) ? Date.parse(stamp) : NaN
    const candle = { t: time, o: Number(open), h: Number(high), l: Number(low), c: Number(close), v: volume === '' ? null : Number(volume) }
    if (!validBar(candle)) throw Error(`Row ${i + 1} needs valid OHLC values and a closed, quarter-hour-aligned UTC timestamp.`)
    if (candleByTime.has(time)) throw Error(`Row ${i + 1} repeats a candle timestamp.`)
    candleByTime.set(time, candle)
  }
  return [...candleByTime.values()].sort((a, b) => a.t - b.t)
}

export function mergeImports(existing, incoming) {
  const combined = new Map(existing.map(bar => [bar.t, bar]))
  for (const bar of incoming) {
    const previous = combined.get(bar.t)
    if (previous && ['o','h','l','c'].some(field => previous[field] !== bar[field])) {
      throw Error('The file changes a candle already saved for this market. Use an append-only export from the same feed.')
    }
    if (!previous && existing.length && bar.t < last(existing).t) {
      throw Error('The file inserts a candle before the last saved candle. Append newer candles to preserve the journal.')
    }
    combined.set(bar.t, previous ?? bar)
  }
  return [...combined.values()].sort((a, b) => a.t - b.t).slice(-16000)
}

export async function fetchCoinbase(market) {
  const end = Math.floor(Date.now() / M15) * M15
  const chunks = await Promise.all([0, 1, 2, 3].map(async index => {
    const until = end - index * 285 * M15
    const since = until - 285 * M15
    const query = new URLSearchParams({ granularity: '900', start: new Date(since).toISOString(), end: new Date(until).toISOString() })
    const response = await fetch(`https://api.exchange.coinbase.com/products/${market.id}/candles?${query}`, { signal: AbortSignal.timeout(11000) })
    if (!response.ok) throw Error(`Coinbase returned HTTP ${response.status}.`)
    const body = await response.json()
    if (!Array.isArray(body)) throw Error('Unexpected Coinbase response.')
    return body.map(([t,l,h,o,c,v]) => ({ t:t * 1000,l,h,o,c,v })).filter(bar => bar.t >= since && bar.t < until && validBar(bar))
  }))
  const bars = [...new Map(chunks.flat().map(bar => [bar.t, bar])).values()].sort((a,b) => a.t - b.t)
  if (bars.length < 320) throw Error('Coinbase returned too little candle history.')
  return bars
}

function ema(bars, period) {
  let value = null
  const alpha = 2 / (period + 1)
  return bars.map((bar, i) => {
    if (i < period - 1) return null
    value = value === null ? average(bars.slice(0, period).map(b => b.c)) : value + alpha * (bar.c - value)
    return value
  })
}

function wilder(values, period) {
  let value
  return values.map((x, i) => {
    if (i < period - 1) return null
    value = value === undefined ? average(values.slice(0, period)) : (value * (period - 1) + x) / period
    return value
  })
}

export function studies(bars) {
  const ema20 = ema(bars, 20), ema50 = ema(bars, 50)
  const fast = ema(bars, 12), slow = ema(bars, 26)
  const macd = fast.map((x, i) => slow[i] === null ? null : x - slow[i])
  const macdSignal = [...Array(Math.min(25, bars.length)).fill(null), ...ema(macd.slice(25).map(c => ({ c })), 9)]
  const changes = bars.slice(1).map((bar, i) => bar.c - bars[i].c)
  const gains = [null, ...wilder(changes.map(x => Math.max(x, 0)), 14)]
  const losses = [null, ...wilder(changes.map(x => Math.max(-x, 0)), 14)]
  const rsi = bars.map((_, i) => gains[i] == null ? null : !losses[i] ? (gains[i] ? 100 : 50) : 100 - 100 / (1 + gains[i] / losses[i]))
  const atr = wilder(bars.map((bar, i) => Math.max(bar.h - bar.l, Math.abs(bar.h - (bars[i-1]?.c ?? bar.c)), Math.abs(bar.l - (bars[i-1]?.c ?? bar.c)))), 14)
  const band = bars.map((_, i) => {
    if (i < 19) return null
    const prices = bars.slice(i - 19, i + 1).map(b => b.c)
    const mean = average(prices)
    const dev = 2 * Math.sqrt(average(prices.map(x => (x - mean)**2)))
    return { lower: mean - dev, upper: mean + dev }
  })
  return { ema20, ema50, rsi, atr, macd, macdSignal, band }
}

export function research(bars) {
  const hourly = aggregate(bars, 60)
  const h4 = aggregate(bars, 240)
  return { bars, hourly, h4, context: ema(h4, 20), hourlyStudies: studies(hourly) }
}

function setupsAt(data, index) {
  const { hourly, h4, context, hourlyStudies: s } = data
  const candle = hourly[index], prev = hourly[index - 1]
  if (!prev || index < 50 || candle.t !== prev.t + HOUR || !s.atr[index]) return []
  let hi = h4.findIndex(bar => bar.t + H4 > candle.t + HOUR)
  hi = (hi === -1 ? h4.length : hi) - 1
  if (context[hi - 1] == null || candle.t + HOUR - (h4[hi].t + H4) > 4 * HOUR) return []
  const { c, o, l, h } = candle
  const direction = c >= s.ema20[index] ? 1 : -1
  const atr = s.atr[index], emaValue = s.ema20[index], rsi = s.rsi[index]
  if ((emaValue - s.ema50[index]) * direction <= 0
      || (h4[hi].c - context[hi]) * direction <= 0
      || (context[hi] - context[hi - 1]) * direction <= 0
      || (c - o) * direction <= 0) return []
  const momentum = (rsi - 50) * direction
  if (momentum < 1 || momentum > 30) return []
  const prior = hourly.slice(index - 20, index)
  const resistance = Math.max(...prior.map(bar => bar.h))
  const support = Math.min(...prior.map(bar => bar.l))
  const breakout = direction > 0 ? c > resistance : c < support
  const pullback = direction > 0
    ? Math.min(l, prev.l) <= emaValue + .28 * atr && c > prev.c
    : Math.max(h, prev.h) >= emaValue - .28 * atr && c < prev.c
  if (!breakout && !pullback) return []
  // A simultaneous breakout and pullback yields one hypothesis and one journal entry.
  const strategy = breakout ? 'Range breakout' : 'Trend pullback'
  const entry = direction > 0 ? h + .04 * atr : l - .04 * atr
  const risk = 1.2 * atr
  const stop = entry - direction * risk
  const target = entry + direction * risk * 2
  if (stop <= 0 || target <= 0) return []
  const strength = Math.abs(emaValue - s.ema50[index]) / atr
  return [{
    direction, strategy, entry, stop, target, risk, rsi, support, resistance, atr,
    strict: momentum >= 7 && strength >= .80,
    score: Math.round(clamp(46 + momentum * .85 + strength * 5 + (breakout ? 8 : 0), 0, 96)),
    setupAt: candle.t + HOUR,
  }]
}

export function latestSetups(data, version) {
  const current = last(data.bars)
  const hour = last(data.hourly)
  if (!current || !hour || current.t + M15 - (hour.t + HOUR) >= HOUR) return []
  return setupsAt(data, data.hourly.length - 1).filter(setup => version === 'base' || setup.strict)
}

export function issue(setup, market, source, version, issued) {
  return {
    ...setup, symbol: market.id, source, version, issued, cost: market.cost,
    id: [source, market.id, setup.setupAt].join('|'),
    expires: issued + 8 * M15, outcome: 'Waiting', seenThrough: issued,
  }
}

function finish(signal, outcome, t, exitPrice) {
  const net = exitPrice == null ? null : signal.direction * (exitPrice - signal.fill) / signal.fill - signal.cost
  return { ...signal, outcome, finished: t, exitPrice, net, netR: net === null ? null : net * signal.fill / signal.risk }
}

export function advance(signal, bars) {
  if (!waiting.has(signal.outcome)) return signal
  let s = signal
  // Locate the first candle whose opening timestamp follows the last processed close.
  let lo = 0, hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].t < s.seenThrough) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < bars.length; i++) {
    const { t, o, h, l, c } = bars[i]
    if (t !== s.seenThrough) return finish(s, 'Data gap', t)
    const end = t + M15
    const long = s.direction > 0
    const entryHit = long ? h >= s.entry : l <= s.entry
    const stopHit = long ? l <= s.stop : h >= s.stop
    const targetHit = long ? h >= s.target : l <= s.target
    const gapStop = long ? o <= s.stop : o >= s.stop
    const gapTarget = long ? o >= s.target : o <= s.target
    const entryAtOpen = long ? o >= s.entry : o <= s.entry
    const wasOpen = s.outcome === 'Open'
    s = { ...s, seenThrough: end }
    if (!wasOpen && t >= s.expires) return finish(s, 'Expired', s.expires)
    if (!wasOpen && !entryHit) {
      if (stopHit || end >= s.expires) return finish(s, 'Expired', end)
      continue
    }
    if (!wasOpen) {
      const fill = long ? Math.max(o, s.entry) : Math.min(o, s.entry)
      if ((long && fill >= s.target) || (!long && fill <= s.target)) return finish(s, 'Expired', t)
      if (gapStop) return finish(s, 'Expired', t)
      if (!entryAtOpen && stopHit) return finish(s, 'Ambiguous', end)
      s = { ...s, outcome: 'Open', fill, filled: t, timeExit: t + 24 * M15 }
    }
    if (wasOpen && gapStop) return finish(s, 'Stop', t, o)
    if (wasOpen && gapTarget) return finish(s, 'Target', t, s.target)
    if (stopHit && targetHit) return finish(s, 'Ambiguous', end)
    if (stopHit) return finish(s, 'Stop', end, s.stop)
    if (targetHit) return finish(s, 'Target', end, s.target)
    if (end >= s.timeExit) return finish(s, 'Time exit', end, c)
  }
  return s
}

export function stats(entries) {
  const closed = entries.filter(s => resolved.has(s.outcome)).sort((a,b) => a.finished - b.finished)
  const decisive = closed.filter(s => s.outcome === 'Target' || s.outcome === 'Stop')
  const total = closed.reduce((sum, s) => sum + s.netR, 0)
  let equity = 0, peak = 0, drawdown = 0
  for (const s of closed) {
    equity += s.netR
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, peak - equity)
  }
  return {
    count: closed.length, targets: decisive.filter(s => s.outcome === 'Target').length,
    decisive: decisive.length, avg: closed.length ? total / closed.length : null,
    drawdown, entered: entries.filter(s => s.fill != null).length,
  }
}

export function backtest(data, market, source) {
  const split = Math.floor(data.hourly.length * .65)
  const splitAt = data.hourly[split]?.t
  const early = [], late = []
  if (!splitAt) return { early, late, splitAt }
  for (let i = 50; i < data.hourly.length; i++) {
    for (const setup of setupsAt(data, i)) {
      const before = i < split
      const signal = issue(setup, market, source, 'base', setup.setupAt)
      const scored = advance(signal, data.bars)
      if (scored.finished !== undefined && (before ? scored.finished <= splitAt : true)) (before ? early : late).push(scored)
    }
  }
  return { early, late, splitAt }
}

export function compare(entries) {
  return { base: stats(entries), strict: stats(entries.filter(s => s.strict)) }
}

export function clearsGate({ base, strict }, min) {
  return base.count >= min && strict.count >= min && strict.avg > 0 && strict.avg >= base.avg + .1 && strict.drawdown <= base.drawdown
}
