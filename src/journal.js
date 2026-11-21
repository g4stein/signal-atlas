import { csvCell, readCSVLine } from './csv.js'
import { MARKETS, M15, versions } from './engine.js'
import { SIGNAL } from './config.js'

const timestampFields = [
  'published', 'setupAt', 'issued', 'expires', 'filled', 'finished', 'seenThrough', 'timeExit',
]
const numericFields = [
  'direction', 'entry', 'stop', 'target', 'fill', 'exitPrice', 'cost', 'net', 'netR',
  'risk', 'rsi', 'support', 'resistance', 'atr', 'score',
]
const fields = [
  'symbol', 'source', 'version', 'strategy', 'direction', 'published', 'setupAt', 'issued', 'expires',
  'entry', 'stop', 'target', 'filled', 'fill', 'finished', 'exitPrice', 'outcome', 'cost', 'net', 'netR',
  'id', 'risk', 'rsi', 'support', 'resistance', 'atr', 'strict', 'score', 'seenThrough', 'timeExit',
]
const outcomes = new Set(['Waiting','Open','Target','Stop','Time exit','Expired','Ambiguous','Data gap'])
const pending = new Set(['Waiting', 'Open'])
const priced = new Set(['Target', 'Stop', 'Time exit'])
const strategies = new Set(['Range breakout', 'Trend pullback'])
const dataSources = new Set(['demo','live','csv'])
const symbols = new Set(MARKETS.map(m => m.id))

export function journalCSV(entries) {
  const timestamp = new Set(timestampFields)
  const rows = entries.map(entry => fields.map(key => {
    const value = entry[key]
    return csvCell(timestamp.has(key) && value != null ? new Date(value).toISOString() : value)
  }).join(','))
  return [fields.join(','), ...rows].join('\r\n') + '\r\n'
}

export function parseJournalCSV(input) {
  const [head, ...lines] = input.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const columns = readCSVLine(head, 1).map(cell => cell.value)
  if (fields.some(field => !columns.includes(field)) || new Set(columns).size !== columns.length) {
    throw Error('Choose a complete Signal Atlas journal CSV exported with the current version.')
  }
  const entries = lines.map((line, i) => {
    const row = i + 2
    const fail = message => { throw Error(`Row ${row} ${message}`) }
    const values = readCSVLine(line, row)
    if (values.length !== columns.length) fail('does not match the journal CSV header.')
    const raw = Object.fromEntries(columns.map((name, index) => [name, values[index].value]))
    const record = {}
    for (const key of fields) {
      const value = raw[key]
      if (value === '') continue
      if (timestampFields.includes(key)) {
        const time = Date.parse(value)
        if (!Number.isFinite(time) || new Date(time).toISOString() !== value) fail(`has an invalid ${key} timestamp.`)
        record[key] = time
      } else if (numericFields.includes(key)) {
        const number = Number(value)
        if (!Number.isFinite(number)) fail(`has an invalid ${key} value.`)
        record[key] = number
      } else if (key === 'strict') {
        if (!['true', 'false'].includes(value)) fail('has an invalid strict-filter flag.')
        record.strict = value === 'true'
      } else record[key] = value
    }
    if (!symbols.has(record.symbol) || !dataSources.has(record.source) || !Object.hasOwn(versions, record.version)
      || !strategies.has(record.strategy) || !outcomes.has(record.outcome)) fail('has an unknown market, source, strategy, version, or outcome.')
    if (record.id !== [record.source,record.symbol,record.setupAt].join('|')) fail('has an invalid signal ID.')
    if (!['setupAt','issued','expires','seenThrough'].every(key => Number.isSafeInteger(record[key]) && record[key] % M15 === 0)
      || record.issued < record.setupAt || record.expires !== record.issued + SIGNAL.expiryBars * M15
      || record.seenThrough < record.issued) fail('has inconsistent signal times.')
    if (!['entry','stop','target','risk','atr','support','resistance'].every(key => record[key] > 0)
      || ![-1,1].includes(record.direction) || !Number.isFinite(record.cost) || record.cost < 0
      || !Number.isFinite(record.score) || !Number.isFinite(record.rsi) || typeof record.strict !== 'boolean'
      || (record.entry - record.stop) * record.direction <= 0
      || (record.target - record.entry) * record.direction <= 0) fail('has invalid signal levels or indicator values.')
    if (!pending.has(record.outcome) && !Number.isSafeInteger(record.finished)) fail('is missing its completion time.')
    if (record.outcome === 'Open' || priced.has(record.outcome)) {
      if (!(record.fill > 0) || !Number.isSafeInteger(record.filled) || record.timeExit !== record.filled + SIGNAL.exitBars * M15) fail('has an incomplete fill.')
    }
    if (priced.has(record.outcome) && (!(record.exitPrice > 0) || !Number.isFinite(record.net) || !Number.isFinite(record.netR))) {
      fail('has an incomplete priced outcome.')
    }
    if (!pending.has(record.outcome) && !priced.has(record.outcome)) {
      record.net = null
      record.netR = null
    }
    return record
  })
  if (!entries.length) throw Error('The journal CSV contains no signals.')
  return entries
}

const identityFields = ['version','strategy','direction','entry','stop','target','risk','strict','cost','issued','expires']

export function mergeJournal(existing, incoming) {
  const journal = { ...existing }
  let changed = 0
  for (const record of incoming) {
    const previous = journal[record.id]
    if (previous) {
      if (!pending.has(previous.outcome)) continue
      if (identityFields.some(key => previous[key] !== record[key])) continue
      if (record.seenThrough < previous.seenThrough) continue
      if (previous.outcome === 'Open' &&
          (previous.filled !== record.filled || previous.fill !== record.fill || record.outcome === 'Waiting')) continue
      if (record.seenThrough === previous.seenThrough && pending.has(record.outcome)) continue
    }
    journal[record.id] = record
    changed++
  }
  return { journal, changed }
}
