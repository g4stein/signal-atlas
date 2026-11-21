import test from 'node:test'
import assert from 'node:assert/strict'
import { MARKETS, M15, advance, demoBars, issue, latestSetups, research } from '../src/engine.js'
import { journalCSV, mergeJournal, parseJournalCSV } from '../src/journal.js'
import { csvCell, readCSVLine } from '../src/csv.js'

const market = MARKETS[0]
const bars = demoBars(market)
const setup = latestSetups(research(bars.slice(0, 1552)), 'base')[0]
const pending = { ...issue(setup, market, 'demo', 'base', setup.setupAt), published: Date.UTC(2025,9,1) }
const settled = advance(pending, bars)
const roundTrip = entries => parseJournalCSV(journalCSV(entries))
const clean = data => JSON.parse(JSON.stringify(data))

test('journal CSV round-trips active and resolved records, including settlement state', () => {
  const opened = {
    ...pending, outcome:'Open', filled:pending.issued, fill:pending.entry,
    timeExit:pending.issued + 24*M15, seenThrough:pending.issued+M15,
  }
  assert.notEqual(settled.outcome, 'Waiting')
  assert.deepEqual(roundTrip([pending, opened, settled]), clean([pending, opened, settled]))
  assert.equal(journalCSV([pending]).split('\r\n').length, 3)
})

test('CSV export escapes embedded quotes, commas, and line breaks', () => {
  assert.equal(csvCell('hi, "chart"'), '"hi, ""chart"""')
  assert.equal(readCSVLine(csvCell('hi, "chart"'),2)[0].value, 'hi, "chart"')
  assert.equal(csvCell('hello\nworld'), '"hello\nworld"')
})

test('journal merge advances a matching pending signal without overwriting a completed outcome', () => {
  const id = pending.id
  assert.deepEqual(mergeJournal({}, [pending, pending]), { journal: { [id]: pending }, changed: 1 })
  assert.deepEqual(mergeJournal({ [id]: pending }, [settled]), { journal: { [id]: settled }, changed: 1 })
  assert.deepEqual(mergeJournal({ [id]: settled }, [pending,{...settled,netR:100}]), { journal: { [id]: settled }, changed: 0 })
  assert.equal(mergeJournal({ [id]: pending }, [{...settled,entry:1}]).changed,0)
})

test('journal import rejects incomplete exports, unrecognized enums, and invalid signal IDs', () => {
  assert.throws(() => parseJournalCSV('symbol,source\nBTC-USD,demo'), /complete Signal Atlas journal CSV/)
  assert.throws(() => roundTrip([{...pending,strategy:'custom'}]), /unknown market/)
  assert.throws(() => roundTrip([{...pending,id:'different'}]), /invalid signal ID/)
  assert.throws(() => roundTrip([{...pending,outcome:'Open'}]), /incomplete fill/)
})
