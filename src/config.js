export const DEMO = Object.freeze({
  seed: 457,
  marketSeedStep: 7121,
  start: Date.UTC(2025, 8, 8),
  length: 1904,
  initialBars: 1552,
  replayIntervalMs: 700,
})

export const SIGNAL = Object.freeze({
  expiryBars: 8,
  exitBars: 24,
  riskATR: 1.2,
  targetR: 2,
  entryBufferATR: .04,
  pullbackToleranceATR: .28,
  strictMomentum: 7,
  strictStrength: .80,
})

export const PROMOTION = Object.freeze({ historical: 15, forward: 30, averageGainR: .10 })

export const CHART = Object.freeze({
  visibleBars: 70, minBars: 16, maxBars: 200, zoomStep: 12,
  compactWidth: 400, compactAxis: 66, priceAxis: 83, timeAxis: 23,
  minPlotWidth: 1, minPriceHeight: 48, top: 29,
  compactPaneHeight: 39, paneHeight: 49, pricePadding: .08, flatRange: .002,
})

export const COINBASE = Object.freeze({ chunks: 4, chunkBars: 285, timeoutMs: 11000, pollMs: 60000 })

export const STORAGE = Object.freeze({
  localKey: 'signal-atlas-v1',
  database: 'signal-atlas-imports',
  version: 1,
  store: 'candles',
})
