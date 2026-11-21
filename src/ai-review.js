import { MINUTE, research } from './engine.js'
import { closedBefore } from './research-cache.js'

export function buildReviewRequest(market, signal, bars, heldOut, chartImageBase64) {
  const data = research(closedBefore(bars, signal.setupAt))
  const bars1h = data.hourly.slice(-40)
  const ema20 = data.context.at(-1)
  const ema20Previous = data.context.at(-2)
  if (bars1h.length !== 40 || bars1h.at(-1).t + 60 * MINUTE !== signal.setupAt ||
      ema20 == null || ema20Previous == null) {
    throw Error('The closed candle history for this setup is unavailable. Load its original market data and try again.')
  }
  return {
    market: { id: market.id, name: market.name, kind: market.kind, digits: market.digits },
    signal: {
      id: signal.id, strategy: signal.strategy, direction: signal.direction, entry: signal.entry,
      stop: signal.stop, target: signal.target, risk: signal.risk, atr: signal.atr, rsi: signal.rsi,
      score: signal.score, setupAt: signal.setupAt, version: signal.version,
    },
    context: {
      bars1h, fourHour: { close: data.h4.at(-1).c, ema20, ema20Previous },
      support: signal.support, resistance: signal.resistance, heldOut,
    },
    ...(chartImageBase64 ? { chartImageBase64 } : {}),
  }
}

export function captureReviewChart(canvas) {
  const prefix = 'data:image/png;base64,'
  try {
    const image = canvas.toDataURL('image/png')
    if (image.startsWith(prefix) && image.length - prefix.length <= 512 * 1024) return image.slice(prefix.length)
  } catch {
    // The numerical review is available without a snapshot.
  }
}

export async function requestReview(payload) {
  let response
  try {
    response = await fetch('/api/ai-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw Error('The chart review could not connect. Try again.')
  }
  if (response.status === 404 || response.status === 405) {
    throw Error('The chart review API is unavailable on this host.')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) throw Error(result?.error || 'The chart review was unavailable. Try again.')
  if (!Array.isArray(result?.review?.riskFlags) || typeof result.model !== 'string' || !Number.isFinite(Date.parse(result.reviewedAt))) {
    throw Error('The chart review response was incomplete. Try again.')
  }
  return result
}
