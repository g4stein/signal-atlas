import { M15, research, studies, backtest, stats } from './engine.js'

function sameCandle(a, b) {
  return a === b || (a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v)
}

function sameSeries(a, b, length = b.length) {
  if (a === b || length === 0) return true
  // Compare candle content rather than object identity. Check the latest candle
  // first, then detect corrections to any earlier candle in the window.
  if (!sameCandle(a[length - 1], b[length - 1])) return false
  for (let i = 0; i < length - 1; i++) {
    if (!sameCandle(a[i], b[i])) return false
  }
  return true
}

export function closedBefore(bars, before) {
  let lo = 0, hi = bars.length
  while (lo < hi) {
    const i = (lo + hi) >> 1
    if (bars[i].t + M15 <= before) lo = i + 1
    else hi = i
  }
  return lo === bars.length ? bars : bars.slice(0, lo)
}

// Feed updates replace candle arrays and rows; cached snapshots are immutable.
export function createResearchCache(runBacktest = backtest) {
  const streams = new Map()
  function stream(source, market) {
    const key = source + '|' + market.id
    if (!streams.has(key)) streams.set(key, { frames: new Map() })
    return streams.get(key)
  }
  return {
    dataset(source, market, bars) {
      const entry = stream(source, market)
      if (!entry.data || entry.data.bars.length !== bars.length || !sameSeries(entry.data.bars, bars)) {
        entry.data = research(bars)
      }
      return entry.data
    },
    frameStudies(source, market, frame, bars) {
      const frames = stream(source, market).frames
      const cached = frames.get(frame)
      if (cached?.bars.length === bars.length && sameSeries(cached.bars, bars)) return cached.result
      const result = studies(bars)
      frames.set(frame, { bars, result })
      return result
    },
    evidence(source, market, bars, setupAt, cutoff, version, strategy) {
      const entry = stream(source, market)
      let cached = entry.evidence
      if (cached?.bars !== bars || cached?.setupAt !== setupAt || cached.cutoff !== cutoff) {
        const sample = closedBefore(bars, cutoff)
        // New 15m candles beyond the cutoff cannot change this setup's evidence.
        if (cached?.setupAt === setupAt && cached.cutoff === cutoff &&
            cached.sample.length === sample.length && sameSeries(cached.sample, sample)) {
          cached.bars = bars
        } else {
          cached = { bars, setupAt, cutoff, sample, results: new Map() }
          entry.evidence = cached
        }
      }
      const key = version + '|' + strategy
      if (!cached.results.has(key)) {
        cached.history ??= runBacktest(research(cached.sample), market, source)
        cached.results.set(key, stats(cached.history.late.filter(signal =>
          signal.strategy === strategy && (version === 'base' || signal.strict))))
      }
      return cached.results.get(key)
    },
  }
}
