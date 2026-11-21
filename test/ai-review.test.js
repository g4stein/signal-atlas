import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/ai-review.js'
import { MARKETS, demoBars, issue, latestSetups, research } from '../src/engine.js'
import { buildReviewRequest, captureReviewChart, requestReview } from '../src/ai-review.js'

const market = MARKETS[0]
const bars = demoBars(market)
const setup = latestSetups(research(bars.slice(0, 1552)), 'base')[0]
const signal = issue(setup, market, 'demo', 'base', setup.setupAt)
const evidence = { count: 0, targets: 0, decisive: 0, entered: 0, avg: null, drawdown: 0 }
const payload = buildReviewRequest(market, signal, bars, evidence)
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kw8sAAAAASUVORK5CYII='
const review = {
  verdict: 'caution', confidence: 65, regime: 'choppy', riskFlags: ['Overlapping 1H wicks'],
  summary: 'The 1H candle overlaps the supplied entry and nearby support.',
  invalidationNote: 'A move through the supplied stop invalidates the setup.',
}

function setEnv(t, key, value) {
  const original = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  t.after(() => {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  })
}

async function call(body = payload, { method = 'POST', headers = { 'content-type': 'application/json' } } = {}) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = JSON.parse(value) },
  }
  await handler({ method, headers, body }, response)
  return response
}

function geminiOutput(value = review) {
  return Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'not output' }, { text: JSON.stringify(value) }] } }],
  })
}

test('review context ends at the setup close and never includes future candle prices', () => {
  const reviewInput = buildReviewRequest(market, signal, bars, evidence, png)
  const cutoff = bars.filter(bar => bar.t < signal.setupAt)
  assert.deepEqual(reviewInput, buildReviewRequest(market, signal, cutoff, evidence, png))
  assert.equal(reviewInput.context.bars1h.length, 40)
  assert.equal(reviewInput.context.bars1h.at(-1).t + 3600000, signal.setupAt)
  assert.equal(reviewInput.signal.entry, signal.entry)
  assert.equal(reviewInput.context.support, signal.support)
  assert.equal(captureReviewChart({ toDataURL: () => 'data:image/png;base64,' + png }), png)
  assert.equal(captureReviewChart({ toDataURL: () => 'data:,' }), undefined)
  assert.throws(() => buildReviewRequest(market, signal, bars.slice(0, 50), evidence), /history.*unavailable/)
})

test('API only accepts POST and reports a missing key without calling Gemini', async t => {
  setEnv(t, 'GEMINI_API_KEY')
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected upstream fetch') })
  const wrongMethod = await call(payload, { method: 'GET' })
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.Allow, 'POST')
  const noKey = await call()
  assert.equal(noKey.statusCode, 503)
  assert.deepEqual(noKey.body, { error: 'GEMINI_API_KEY is not configured on the server.' })
  assert.equal(upstream.mock.callCount(), 0)
})

test('API uses Hydrogen, a header-only key, medium thinking, structured JSON, and optional PNG', async t => {
  setEnv(t, 'GEMINI_API_KEY', 'mock-key')
  setEnv(t, 'GEMINI_MODEL')
  const upstream = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent')
    assert.equal(options.headers['x-goog-api-key'], 'mock-key')
    assert.ok(options.signal instanceof AbortSignal)
    assert.ok(!options.body.includes('mock-key'))
    const body = JSON.parse(options.body)
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' })
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.equal(body.generationConfig.responseSchema.properties.riskFlags.maxItems, 4)
    const [numbers, image] = body.contents[0].parts
    assert.deepEqual(JSON.parse(numbers.text), payload)
    if (image) assert.deepEqual(image.inlineData, { mimeType: 'image/png', data: png })
    return geminiOutput()
  })
  for (const body of [payload, { ...payload, chartImageBase64: png }]) {
    const response = await call(body)
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.model, 'gemini-4-hydrogen')
    assert.ok(Date.parse(response.body.reviewedAt))
    assert.deepEqual(response.body.review, review)
  }
  assert.equal(upstream.mock.callCount(), 2)
})

test('API rejects oversized input, bad PNGs and candles, and alternate models before network calls', async t => {
  setEnv(t, 'GEMINI_API_KEY', 'mock-key')
  setEnv(t, 'GEMINI_MODEL')
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected upstream fetch') })
  assert.equal((await call('{"x":')).statusCode, 400)
  assert.equal((await call(payload, { headers: {} })).statusCode, 415)
  assert.equal((await call({ ...payload, chartImageBase64: 'x'.repeat(520 * 1024) })).statusCode, 413)
  assert.equal((await call({ ...payload, chartImageBase64: 'data:image/png;base64,' + png })).statusCode, 400)
  assert.equal((await call({ ...payload, context: { ...payload.context, bars1h: payload.context.bars1h.slice(0, -1) } })).statusCode, 400)
  process.env.GEMINI_MODEL = 'gemini-other'
  assert.equal((await call()).statusCode, 503)
  assert.equal(upstream.mock.callCount(), 0)
})

test('API rejects incomplete or extra review fields and translates upstream rate limits and timeouts', async t => {
  setEnv(t, 'GEMINI_API_KEY', 'mock-key')
  setEnv(t, 'GEMINI_MODEL', 'gemini-4-hydrogen')
  const upstream = t.mock.method(globalThis, 'fetch', async () => geminiOutput({ ...review, entry: 100 }))
  assert.equal((await call()).statusCode, 502)
  upstream.mock.mockImplementation(async () => Response.json({}, { status: 429 }))
  assert.equal((await call()).statusCode, 429)
  upstream.mock.mockImplementation(async () => { throw new DOMException('', 'TimeoutError') })
  assert.equal((await call()).statusCode, 504)
})

test('client posts to the same-origin API and shows missing route or server configuration errors', async t => {
  const server = t.mock.method(globalThis, 'fetch', async (url, { method, body }) => {
    assert.equal(url, '/api/ai-review')
    assert.equal(method, 'POST')
    assert.deepEqual(JSON.parse(body), payload)
    return Response.json({ review, model: 'gemini-4-hydrogen', reviewedAt: new Date().toISOString() })
  })
  assert.deepEqual((await requestReview(payload)).review, review)
  server.mock.mockImplementation(async () => new Response('<p>Missing</p>', { status: 404 }))
  await assert.rejects(requestReview(payload), /unavailable on this host/)
  server.mock.mockImplementation(async () => Response.json({ error: 'GEMINI_API_KEY is not configured on the server.' }, { status: 503 }))
  await assert.rejects(requestReview(payload), /GEMINI_API_KEY is not configured/)
})
