import test from 'node:test'
import assert from 'node:assert/strict'
import { MARKETS, M15, fetchCoinbase } from '../src/engine.js'

test('Coinbase handles missing AbortSignal.timeout, fetches four chunks, and backs off on rate limits', async t => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
  Object.defineProperty(AbortSignal, 'timeout', { ...original, value: undefined })
  t.after(() => Object.defineProperty(AbortSignal, 'timeout', original))

  const requests = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    const query = new URL(url).searchParams
    const start = Date.parse(query.get('start'))
    return new Response(JSON.stringify(Array.from({ length: 285 }, (_, i) =>
      [(start + M15 * i) / 1000, 99, 103, 100, 101, 5])))
  })
  assert.equal((await fetchCoinbase(MARKETS[0])).length, 1140)
  assert.equal(requests.mock.callCount(), 4)
  requests.mock.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
  await assert.rejects(fetchCoinbase(MARKETS[0]), /rate limit \(HTTP 429\)/)
  await assert.rejects(fetchCoinbase(MARKETS[1]), /rate limit \(HTTP 429\)/)
  assert.equal(requests.mock.callCount(), 8)
})
