import { MARKETS, M15, MINUTE, versions, demoBars, parseCSV, mergeImports, fetchCoinbase, research, studies, latestSetups, issue, advance, stats, backtest, compare, clearsGate } from './engine.js'
import { CandlestickChart, indicators, defaultIndicators } from './chart.js'

const icons = {
  chart: '<path d="M3 3v17h18M6 14l4-4 4 2 6-7"/>',
  radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6.4-6.4"/>',
  book:'<path d="M5 4h14v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm14 12H6a2 2 0 0 0 0 4m2-11h7m-7-3h6"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  download:'<path d="M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  sliders:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="#20222e"/><circle cx="15" cy="12" r="2" fill="#20222e"/><circle cx="11" cy="17" r="2" fill="#20222e"/>',
  cross:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  line:'<path d="M3 12h18"/><circle cx="8" cy="12" r="2" fill="#171923"/>',
  trend:'<path d="m5 17 14-10"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/>',
  undo:'<path d="m8 6-5 5 5 5M3 11h11a6 6 0 0 1 6 6v2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  play:'<path d="m8 5 12 7-12 7z"/>',
  pause:'<path d="M9 5v14m6-14v14"/>',
  step:'<path d="m5 6 9 6-9 6zm13 0v12"/>',
  x:'<path d="m6 6 12 12M18 6 6 18"/>',
}
const $ = id => document.getElementById(id)
const byMarket = Object.fromEntries(MARKETS.map(m => [m.id, m]))
const sources = { demo: 'Demo replay', live: 'Coinbase Exchange', csv: 'Imported CSV' }
const views = { terminal: 'Terminal', scanner: 'Market scanner', journal: 'Signal journal', lab: 'Strategy lab' }
const storageKey = 'signal-atlas-v1'
const DEMO_START = 1552
const demo = Object.fromEntries(MARKETS.map(m => [m.id, demoBars(m)]))
const DEMO_END = demo[MARKETS[0].id].length
const market = () => byMarket[symbol]
const fmt = (m, n) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits }) : '—'
const signed = (n, places = 2) => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(places)
const pct = (n, places = 2) => n == null ? '—' : signed(n * 100, places) + '%'
const dateUTC = t => Number.isFinite(t) ? new Date(t).toISOString().slice(0,16).replace('T', ' ') + ' UTC' : '—'
const srcFor = m => mode === 'demo' ? 'demo' : m.kind === 'Crypto' && !imports[m.id]?.length ? 'live' : 'csv'
const chartKey = () => [srcFor(market()), symbol, frame].join('|')
const clean = x => String(x).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch])
const icon = name => `<i data-icon="${name}"></i>`
const dot = m => `<span class="dot" style="--asset:${m.color}"></span>`
const directionPill = d => d > 0 ? '<span class="pill up">Long</span>' : '<span class="pill down">Short</span>'
const changeClass = n => n > 0 ? 'up' : n < 0 ? 'down' : ''
const level = (name, value, className = '') => `<div><dt>${name}</dt><dd class="${className}">${value}</dd></div>`
const datasetCache = new Map()
const imports = {}
const exchange = {}
const exchangeErrors = {}
let state = readState()
let mode = state.mode ?? 'demo'
let symbol = MARKETS[0].id
let frame = 60
let view = 'terminal'
let timer, toastTimer, autoTimer, scanInProgress
let labCache
let lastScanCount = null

function readState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? {}
  } catch {
    return {}
  }
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
    return true
  } catch {
    toast('Browser storage is unavailable or full. Export your journal to keep a copy.')
    return false
  }
}
function toast(message) {
  clearTimeout(toastTimer)
  $('toast').textContent = message
  $('toast').hidden = false
  toastTimer = setTimeout(() => { $('toast').hidden = true }, 3800)
}
function hydrate(root = document) {
  root.querySelectorAll('i[data-icon]:empty').forEach(el => {
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[el.dataset.icon]}</svg>`
  })
}
function openImports() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('signal-atlas-imports', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('candles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function readImports() {
  const db = await openImports()
  try {
    const data = await Promise.all(MARKETS.map(m => new Promise((resolve, reject) => {
      const request = db.transaction('candles').objectStore('candles').get(m.id)
      request.onsuccess = () => resolve([m.id, request.result])
      request.onerror = () => reject(request.error)
    })))
    for (const [id, bars] of data) if (bars) imports[id] = bars
  } finally { db.close() }
}
async function saveImport(id, incoming) {
  const db = await openImports()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('candles', 'readwrite')
      const store = transaction.objectStore('candles')
      const request = store.get(id)
      let merged, mergeError
      request.onsuccess = () => {
        try {
          merged = mergeImports(request.result ?? [], incoming)
          store.put(merged, id)
        } catch (error) {
          mergeError = error
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(merged)
      transaction.onabort = () => reject(mergeError ?? transaction.error ?? Error('Unable to save the file in this browser.'))
    })
  } finally { db.close() }
}

function barsFor(m, source = srcFor(m)) {
  if (source === 'demo') return demo[m.id].slice(0, state.replay ?? DEMO_START)
  if (source === 'csv') return imports[m.id] ?? []
  return exchange[m.id] ?? []
}
function dataFor(m, source = srcFor(m)) {
  const key = [source, m.id].join('|')
  const bars = barsFor(m, source)
  const cached = datasetCache.get(key)
  if (cached && cached.bars.length === bars.length && cached.bars.at(-1) === bars.at(-1)) return cached
  const data = research(bars)
  datasetCache.set(key, data)
  return data
}
function available(m, source = srcFor(m)) {
  const bar = barsFor(m, source).at(-1)
  return bar && (source !== 'live' || Boolean(exchange[m.id]) && !exchangeErrors[m.id] && Date.now() - (bar.t + M15) < 2 * M15)
}
function statusFor(m) {
  if (exchangeErrors[m.id] && srcFor(m) === 'live') return 'Coinbase unavailable'
  if (!barsFor(m).length) return srcFor(m) === 'csv' ? 'Import 15m candles to analyze this market' : 'Load Coinbase candles with Run scan'
  if (!available(m)) return 'Cached candles · feed stale'
  return ''
}
function activeVersion(m, source = srcFor(m)) {
  const promotion = state.promoted?.[[source, m.id].join('|')]
  return promotion?.hold ? 'base' : promotion?.version ?? 'base'
}
function journal() { return Object.values(state.journal ?? {}) }

function persistScan() {
  // Re-read journal records inside the browser lock shared by tabs on this origin.
  const saved = readState()
  state.journal = { ...state.journal, ...saved.journal }
  state.promoted = { ...state.promoted, ...saved.promoted }
  state.historical = { ...state.historical, ...saved.historical }
  state.mode = mode
  state.replay = Math.max(state.replay ?? DEMO_START, saved.replay ?? DEMO_START)
  const entries = state.journal
  let issued = 0
  for (const m of MARKETS) {
    const source = srcFor(m)
    const data = dataFor(m, source)
    if (!data.bars.length) continue
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.symbol === m.id && entry.source === source) entries[id] = advance(entry, data.bars)
    }
    if (!available(m, source)) continue
    const key = [source, m.id].join('|')
    const historical = state.historical[key]
    if (historical && !state.promoted[key] && clearsGate(historical.heldOut, 15)) {
      const forward = Object.values(entries).filter(s => s.source === source && s.symbol === m.id && s.version === 'base')
      const prospective = compare(forward)
      if (clearsGate(prospective, 30)) {
        state.promoted[key] = { version: 'strict', at: data.bars.at(-1).t + M15, evidence: { ...historical, forward: prospective } }
      }
    }
    for (const setup of latestSetups(data, activeVersion(m, source))) {
      const close = data.bars.at(-1).t + M15
      // For exchange data, begin at the first whole 15m candle after publication.
      const effective = source === 'live' ? Math.ceil(Date.now() / M15) * M15 : close
      const s = issue(setup, m, source, activeVersion(m, source), effective)
      s.published = Date.now()
      if (!entries[s.id]) {
        if (!state.historical[key]) {
          const past = backtest(research(closedBefore(data.bars, setup.setupAt - 60 * MINUTE)), m, source)
          state.historical[key] = { heldOut: compare(past.late), splitAt: past.splitAt }
        }
        entries[s.id] = s
        issued++
      }
    }
  }
  persist()
  return issued
}
async function recordScan() {
  return navigator.locks ? navigator.locks.request(storageKey, persistScan) : persistScan()
}
function quoteChange(m) {
  const bars = barsFor(m)
  const index = bars.length - 1
  const current = bars[index]?.c
  const ref = bars[index - 96]
  const prior = ref && bars[index].t - ref.t === 96 * M15 ? ref.c : undefined
  return { current, change: prior ? current / prior - 1 : null }
}
function renderMarkets() {
  $('watchlist').innerHTML = MARKETS.map(m => {
    const { change } = quoteChange(m)
    return `<button class="watch ${m.id === symbol ? 'on' : ''}" data-market="${m.id}">${dot(m)}${m.name}<span class="ticker-change ${changeClass(change)}">${pct(change)}</span></button>`
  }).join('')
  $('market-strip').innerHTML = MARKETS.map(m => {
    const { current, change } = quoteChange(m)
    return `<button class="market-card ${m.id === symbol ? 'on' : ''}" data-market="${m.id}"><span class="symbol">${dot(m)}${m.name}</span><span class="prices"><span class="price">${fmt(m, current)}</span><span class="ticker-change ${changeClass(change)}">${pct(change)}</span></span></button>`
  }).join('')
}

function currentSetup(m) {
  const source = srcFor(m)
  if (!available(m, source)) return null
  const data = dataFor(m, source)
  const hourClose = (data.hourly.at(-1)?.t ?? NaN) + 60 * MINUTE
  const id = [source, m.id, hourClose].join('|')
  const saved = state.journal?.[id]
  return saved ?? latestSetups(data, activeVersion(m, source))[0] ?? null
}
const chart = new CandlestickChart($('chart'), {
  add(draw) {
    const key = chartKey()
    state.drawings ??= {}
    state.drawings[key] ??= []
    state.drawings[key].push(draw)
    persist(); renderChart()
  },
  remove() {
    state.drawings?.[chartKey()]?.pop()
    persist(); renderChart()
  },
  inspect(bar) {
    const m = market()
    $('ohlc').textContent = bar ? `O ${fmt(m, bar.o)}   H ${fmt(m, bar.h)}   L ${fmt(m, bar.l)}   C ${fmt(m, bar.c)}` : ''
    if (bar) $('ohlc').title = dateUTC(bar.t)
  },
})

function chartLevels(bars) {
  const recent = bars.slice(-21, -1)
  if (recent.length < 5) return null
  const support = Math.min(...recent.map(b => b.l))
  const resistance = Math.max(...recent.map(b => b.h))
  return { support, resistance }
}
function renderChart() {
  const m = market(), source = srcFor(m), data = dataFor(m, source)
  const all = frame === 60 ? data.hourly : frame === 240 ? data.h4 : data.bars
  const s = frame === 60 ? data.hourlyStudies : studies(all)
  const shown = new Set(state.indicators ?? defaultIndicators)
  const levels = chartLevels(all)
  const signal = currentSetup(m)
  const { current, change } = quoteChange(m)
  $('asset-badge').textContent = m.icon
  $('asset-badge').style.setProperty('--asset', m.color)
  $('asset-name').textContent = m.name
  $('chart-source').textContent = `${m.title} · ${sources[source]}`
  $('quote').textContent = fmt(m, current)
  $('change').className = `sub ${changeClass(change)}`
  $('change').textContent = change == null ? '' : `${pct(change)} · 24h`
  $('candle-info').textContent = all.length ? `${all.length} candles` : ''
  $('chart-empty').hidden = Boolean(all.length)
  $('chart-empty').textContent = statusFor(m) || 'Upload more candles for this timeframe.'
  $('chart-legend').innerHTML = [...shown].filter(id => id !== 'volume' || all.some(b => b.v !== null)).map(id => {
    const [label, color] = indicators[id]
    return `<span><b style="--series:${color}"></b>${label}</span>`
  }).join('')
  $('replay').hidden = mode !== 'demo'
  $('replay-date').textContent = data.bars.length ? dateUTC(data.bars.at(-1).t + M15).slice(5) : ''
  $('replay-step').disabled = (state.replay ?? DEMO_START) >= DEMO_END
  $('replay-play').disabled = $('replay-step').disabled
  document.querySelectorAll('[data-frame]').forEach(el => {
    const on = Number(el.dataset.frame) === frame
    el.classList.toggle('selected', on)
    el.setAttribute('aria-pressed', String(on))
  })
  chart.update({ all, studies: s, levels, signal, frame, shown, drawings: state.drawings?.[chartKey()] ?? [], key: chartKey(), format: n => fmt(m,n) })
  renderAnalysis(m, data, all, s, levels, signal)
}

function renderAnalysis(m, data, all, s, levels, signal) {
  const current = all.at(-1)?.c
  const ema20 = s.ema20.at(-1), ema50 = s.ema50.at(-1)
  const rsi = s.rsi.at(-1), atr = s.atr.at(-1)
  const h4c = data.h4.at(-1)?.c, ctx = data.context.at(-1)
  const bias = ctx == null ? 'Unconfirmed' : h4c >= ctx ? 'Bullish' : 'Bearish'
  const trend = ema20 == null || ema50 == null ? '—' : ema20 > ema50 ? 'Bullish' : 'Bearish'
  const title = signal?.strategy ?? 'No qualifying setup'
  const desc = signal ? `1H ${signal.strategy === 'Range breakout' ? 'range break' : 'EMA 20 retest'} aligned with the 4H trend. ${signal.outcome ?? 'Waiting'}${signal.outcome ? '' : ' for a scan'}.`
    : statusFor(m) || 'The latest closed 1H candle did not meet the 4H trend and entry rules.'
  const button = signal?.id ? `<button class="btn" data-signal="${clean(signal.id)}">View paper signal</button>` : ''
  const lastLines = signal ? level('Entry trigger', fmt(m, signal.entry)) + level('Stop', fmt(m, signal.stop), 'down') + level('Target', fmt(m, signal.target), 'up')
    : level('Support', fmt(m, levels?.support)) + level('Resistance', fmt(m, levels?.resistance)) + level('ATR 14', atr == null ? '—' : fmt(m, atr))
  $('analysis').innerHTML = `<div class="analysis-top"><h2>${icon('layers')}Technical analysis</h2><span class="pill">${frame === 15 ? '15m' : frame / 60 + 'H'}</span></div><div class="analysis-body">
  <div class="signal-summary"><div class="signal-title"><strong>${title}</strong>${signal ? directionPill(signal.direction) : ''}</div><p>${desc}</p></div>
  <div><h3>Market conditions</h3><dl class="detail-list">${level('4H context', bias, bias === 'Bullish' ? 'up' : bias === 'Bearish' ? 'down' : '')}${level('EMA trend', trend)}${level('RSI 14', rsi == null ? '—' : rsi.toFixed(1))}${level('ATR %', atr != null && current ? (atr / current * 100).toFixed(2) + '%' : '—')}</dl></div>
  <div><h3>${signal ? 'Paper trade levels' : 'Key levels'}</h3><dl class="detail-list">${lastLines}</dl></div>
  </div><div class="analysis-foot">${button}</div>`
  hydrate($('analysis'))
}

function table(headers, body) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`
}
const empty = msg => `<p class="empty">${msg}</p>`
const closedBefore = (bars, before) => bars.filter(b => b.t + M15 <= before)
function scanRows() {
  return MARKETS.flatMap(m => {
    const signal = currentSetup(m)
    if (!signal || (signal.outcome && !['Waiting','Open'].includes(signal.outcome))) return []
    const source = srcFor(m)
    const version = signal.version ?? activeVersion(m)
    const history = backtest(research(closedBefore(barsFor(m), signal.setupAt - 60 * MINUTE)), m, source)
    const evidence = stats(history.late.filter(s => s.strategy === signal.strategy && (version === 'base' || s.strict)))
    return [{ m, signal, evidence, rank: evidence.count >= 10 ? evidence.avg : null }]
  }).sort((a,b) => {
    if (a.rank !== null && b.rank !== null) return b.rank - a.rank || b.signal.score - a.signal.score
    if (a.rank !== null || b.rank !== null) return a.rank !== null ? -1 : 1
    return b.signal.score - a.signal.score
  })
}
function renderSetups() {
  const rows = scanRows()
  const stamp = rows.length ? rows.length + (rows.length === 1 ? ' qualifying setup' : ' qualifying setups') : 'No qualifying setups'
  const title = `<div class="table-heading"><h2>${icon('radar')}Ranked setups</h2><span class="sub">${stamp} · ${mode === 'demo' ? sources.demo : 'Market data'}</span></div>`
  const list = rows.length ? table(['Market', 'Setup', 'Bias', 'Entry trigger', 'Rule score', 'Held-out avg.'], rows.map(({m, signal: s, evidence}) => `<tr><td><button class="open-row" data-market="${m.id}">${m.name}</button></td><td>${s.id ? `<button class="open-row" data-signal="${clean(s.id)}">${s.strategy}</button>` : s.strategy}</td><td>${directionPill(s.direction)}</td><td class="numeric">${fmt(m, s.entry)}</td><td class="numeric">${s.score} / 100</td><td class="numeric ${changeClass(evidence.avg)}">${evidence.avg == null ? '—' : `${signed(evidence.avg)}R · n=${evidence.count}`}</td></tr>`).join(''))
    : empty('Run a scan or advance the replay to check for new 1H setups.')
  $('terminal-setups').innerHTML = title + list
  $('scanner-setups').innerHTML = title + list + `<div class="scan-note"><p>Markets with at least 10 resolved trades for the setup rank by average held-out return after estimated costs. Other setups rank by rule score, which measures indicator alignment.</p>${mode === 'live' ? `<p>Coinbase checks: ${MARKETS.filter(m => m.kind === 'Crypto' && srcFor(m) === 'live').map(m => `${m.name} ${statusFor(m) ? '· ' + statusFor(m) : '· available'}`).join(' / ') || 'Using imported crypto data'}. Import forex candles to include those pairs.</p>` : ''}</div>`
  hydrate($('terminal-setups')); hydrate($('scanner-setups'))
}
function filteredJournal() {
  const m = $('journal-market').value
  const source = $('journal-source').value
  const outcome = $('journal-outcome').value
  return journal().filter(s => s.source === source && (m === 'all' || s.symbol === m) && (outcome === 'all' || s.outcome === outcome)).sort((a,b) => b.issued - a.issued)
}
function renderJournal() {
  const entries = filteredJournal()
  const measures = stats(entries)
  const rate = measures.decisive ? (100 * measures.targets / measures.decisive).toFixed(1) + '%' : '—'
  const ambiguity = entries.filter(s => s.outcome === 'Ambiguous' || s.outcome === 'Data gap').length
  $('metrics').innerHTML = [
    ['Signals issued', entries.length, measures.entered + ' known fills'],
    ['Target hit rate', rate, measures.decisive + ' target or stop outcomes'],
    ['Avg. net return', measures.avg == null ? '—' : signed(measures.avg) + 'R', measures.count + ' priced outcomes'],
    ['Max. drawdown', measures.count ? measures.drawdown.toFixed(2) + 'R' : '—', ambiguity + ' ambiguous or missing-data outcomes'],
  ].map(([label,value,note]) => `<div class="panel metric"><span class="sub">${label}</span><strong>${value}</strong><span class="sub">${note}</span></div>`).join('')
  $('journal-table').innerHTML = entries.length ? table(['Market', 'Setup', 'Bias', 'Issued UTC', 'Version', 'Result', 'Net R'], entries.map(s => `<tr><td><button class="open-row" data-signal="${clean(s.id)}">${byMarket[s.symbol].name}</button></td><td>${s.strategy}</td><td>${directionPill(s.direction)}</td><td class="numeric">${dateUTC(s.issued).slice(0,-4)}</td><td>${versions[s.version]}</td><td><span class="pill ${s.outcome === 'Target' ? 'up' : s.outcome === 'Stop' ? 'down' : ''}">${s.outcome}</span></td><td class="numeric ${changeClass(s.netR)}">${signed(s.netR)}</td></tr>`).join(''))
    : empty('No signals match these filters.')
  $('export').disabled = !entries.length
}
function renderLab() {
  const m = market(), source = srcFor(m), bars = barsFor(m)
  const key = [source, m.id].join('|')
  const active = activeVersion(m)
  const promotion = state.promoted?.[key]
  const forward = journal().filter(s => s.symbol === m.id && s.source === source && s.version === 'base')
  const cutoff = forward.length ? forward.reduce((ts, s) => Math.min(ts, s.setupAt - 60 * MINUTE), Infinity) : Infinity
  const sample = closedBefore(bars, cutoff)
  if (labCache?.key !== key || labCache?.bar !== sample.at(-1)) {
    labCache = { key, bar: sample.at(-1), result: backtest(research(sample), m, source) }
  }
  const history = labCache.result
  const tested = state.historical?.[key]?.heldOut ?? compare(history.late)
  const splitAt = state.historical?.[key]?.splitAt ?? history.splitAt
  const paper = promotion?.evidence.forward ?? compare(forward)
  const compareTable = variants => table(['Strategy', 'Resolved', 'Avg. net R', 'Drawdown'], Object.entries(variants).map(([id,st]) => `<tr><td>${versions[id]}</td><td>${st.count}</td><td class="numeric ${changeClass(st.avg)}">${signed(st.avg)}</td><td class="numeric">${st.count ? st.drawdown.toFixed(2) : '—'}</td></tr>`).join(''))
  const outcomeNames = ['Stop','Time exit','Ambiguous','Data gap']
  const diagnostics = outcomeNames.map(outcome => [outcome, journal().filter(s => s.symbol === m.id && s.source === source && s.outcome === outcome).length])
  $('lab-content').innerHTML = `<section class="panel lab-card lab-top"><div class="table-heading"><div class="filters"><h2>Research market</h2><select id="lab-market" aria-label="Research market">${MARKETS.map(x => `<option value="${x.id}" ${x.id === symbol ? 'selected' : ''}>${x.name}</option>`).join('')}</select><span class="sub">${sources[source]}</span></div><span class="pill ${active === 'strict' ? 'up' : ''}">Active · ${versions[active]}</span></div><p>${promotion?.hold ? 'The baseline was restored. Automatic promotion is paused for this market and data source.' : promotion ? `The momentum filter was promoted on ${dateUTC(promotion.at)}. <button class="btn" id="restore-baseline">Restore baseline</button>` : 'The momentum filter is evaluated automatically after scans. It requires stronger RSI and wider EMA separation.'}</p></section>
  <div class="lab-grid"><section class="panel lab-card"><h2>Held-out replay</h2><p>${splitAt ? `Last 35% of pre-journal 1H candles from ${dateUTC(splitAt)}.` : 'Load more historical candles to evaluate the held-out window.'}</p>${compareTable(tested)}</section>
  <section class="panel lab-card"><h2>Forward paper comparison</h2><p>${promotion ? 'Outcomes frozen at promotion.' : 'Compares saved baseline signals with the subset the candidate would accept.'}</p>${compareTable(paper)}</section></div>
  <section class="panel lab-card"><h2>Promotion criteria</h2><p>At least 15 priced outcomes per strategy on held-out candles and 30 per strategy in the forward journal. The candidate must be positive after costs, improve average return by at least 0.10R, and stay at or below baseline drawdown in both windows.</p><dl class="detail-list">${diagnostics.map(([label, value]) => level(label, value)).join('')}</dl></section>`
}
function openSignal(id) {
  const s = state.journal?.[id]
  if (!s) return
  const m = byMarket[s.symbol]
  $('signal-detail').innerHTML = `<p><strong>${m.name} · ${s.strategy}</strong> ${directionPill(s.direction)}</p><p>${sources[s.source]} · ${versions[s.version]}</p><dl class="detail-list">
    ${level('Setup closed', dateUTC(s.setupAt))}${level('Logged at', dateUTC(s.published))}${level('Rule score', s.score + ' / 100')}${level('Setup RSI 14', s.rsi.toFixed(1))}${level('Setup ATR 14', fmt(m, s.atr))}${level('Eligible from', dateUTC(s.issued))}${level('Entry expires', dateUTC(s.expires))}
    ${level('Entry trigger', fmt(m,s.entry))}${level('Stop', fmt(m,s.stop), 'down')}${level('Target', fmt(m,s.target), 'up')}
    ${level('Outcome', s.outcome)}${level('Resolved', dateUTC(s.finished))}${level('Paper fill', fmt(m,s.fill))}${level('Exit', fmt(m,s.exitPrice))}${level('Round-trip cost', (s.cost * 100).toFixed(3) + '%')}${level('Net return', s.netR == null ? '—' : signed(s.netR) + 'R')}
    </dl><p>1R equals the original entry-to-stop distance. Once triggered, an open position exits after 24 15m candles if neither level is reached.</p>`
  $('signal-dialog').showModal()
}
function exportJournal() {
  const fields = ['symbol','source','version','strategy','direction','published','setupAt','issued','expires','entry','stop','target','filled','fill','finished','exitPrice','outcome','cost','net','netR']
  const rows = filteredJournal().map(s => fields.map(k => {
    const val = s[k]
    if (['published','setupAt','issued','expires','filled','finished'].includes(k) && val != null) return new Date(val).toISOString()
    return val ?? ''
  }).join(','))
  const url = URL.createObjectURL(new Blob([[fields.join(','), ...rows].join('\n') + '\n'], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'signal-atlas-journal.csv' })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function render() {
  renderMarkets()
  $('mode').value = mode
  $('mode').closest('.source').classList.toggle('live', mode === 'live')
  if (view === 'terminal') renderChart()
  if (view === 'terminal' || view === 'scanner') renderSetups()
  if (view === 'journal') renderJournal()
  if (view === 'lab') renderLab()
}
function setView(next) {
  view = next
  Object.keys(views).forEach(id => { $(id).hidden = id !== next })
  document.querySelectorAll('nav [data-view]').forEach(el => {
    const current = el.dataset.view === next
    el.classList.toggle('active', current)
    if (current) el.setAttribute('aria-current', 'page')
    else el.removeAttribute('aria-current')
  })
  $('crumb').textContent = views[next]
  render()
}
async function sceneScan({ silent = false, refresh = true } = {}) {
  if (scanInProgress) return scanInProgress
  const load = mode === 'live' && refresh
  if (load) for (const id of ['scan-main','scan-page','run-lab']) $(id).disabled = true
  scanInProgress = (async () => {
    try {
      if (load) await Promise.all(MARKETS.filter(m => srcFor(m) === 'live').map(async m => {
        try {
          exchange[m.id] = await fetchCoinbase(m)
          delete exchangeErrors[m.id]
        } catch (error) {
          exchangeErrors[m.id] = error.message
        }
      }))
      lastScanCount = await recordScan()
      render()
      if (!silent) {
        const failures = load ? Object.keys(exchangeErrors).filter(id => srcFor(byMarket[id]) === 'live').length : 0
        toast(failures ? `Scan complete · ${failures} exchange ${failures === 1 ? 'feed' : 'feeds'} unavailable · ${lastScanCount} new`
          : `Scan complete · ${lastScanCount} new paper ${lastScanCount === 1 ? 'signal' : 'signals'}`)
      }
    } catch (error) {
      console.error(error)
      toast('Scan failed. Try Run scan again.')
    }
  })()
  try { await scanInProgress }
  finally {
    scanInProgress = null
    for (const id of ['scan-main','scan-page','run-lab']) $(id).disabled = false
  }
}
function stopReplay() {
  clearInterval(timer)
  timer = null
  $('replay-play').innerHTML = icon('play')
  $('replay-play').setAttribute('aria-label','Play replay')
  $('replay-play').title = 'Play replay'
  hydrate($('replay-play'))
}
async function step() {
  if (mode !== 'demo' || scanInProgress) return
  state.replay = Math.min(DEMO_END, (state.replay ?? DEMO_START) + 1)
  if (state.replay === DEMO_END) stopReplay()
  await sceneScan({ silent: true, refresh: false })
}
function setMode(next) {
  if (timer) stopReplay()
  mode = next
  state.mode = next
  persist()
  clearInterval(autoTimer)
  if (mode === 'live') {
    $('journal-source').value = srcFor(market())
    autoTimer = setInterval(() => {
      if (mode === 'live' && !document.hidden) void sceneScan({ silent: true })
    }, 60000)
  } else $('journal-source').value = 'demo'
  render()
  void sceneScan({ silent: true })
}
document.addEventListener('click', event => {
  const btn = event.target.closest('button')
  if (!btn) return
  const action = btn.dataset
  if (action.view) setView(action.view)
  if (action.market) {
    symbol = action.market
    setView('terminal')
  }
  if (action.frame) {
    frame = Number(action.frame)
    renderChart()
  }
  if (action.tool) {
    chart.use(action.tool)
    if (['cursor','line','trend'].includes(action.tool)) {
      document.querySelectorAll('[data-tool]').forEach(el => {
        const applies = action.tool === el.dataset.tool
        el.classList.toggle('selected', applies)
        if (['cursor','line','trend'].includes(el.dataset.tool)) el.setAttribute('aria-pressed', String(applies))
      })
      if (action.tool !== 'cursor') toast(action.tool === 'line' ? 'Click a price on the chart to draw a level.' : 'Click two candles to draw a trend line.')
    }
  }
  if (action.close) $(action.close).close()
  if (action.signal) openSignal(action.signal)
  if (btn.id === 'restore-baseline') {
    const key = [srcFor(market()), symbol].join('|')
    if (state.promoted?.[key]?.version === 'strict') {
      state.promoted[key].hold = true
      persist()
      renderLab()
      toast('Baseline restored for future signals.')
    }
  }
})
$('mode').addEventListener('change', e => setMode(e.target.value))
for (const id of ['scan-main','scan-page','run-lab']) $(id).addEventListener('click', () => void sceneScan())
for (const id of ['journal-source','journal-market','journal-outcome']) $(id).addEventListener('change', renderJournal)
$('lab-content').addEventListener('change', e => {
  if (e.target.id === 'lab-market') { symbol = e.target.value; renderLab() }
})
$('export').addEventListener('click', exportJournal)
$('replay-step').addEventListener('click', () => void step())
$('replay-play').addEventListener('click', () => {
  if (timer) { stopReplay(); return }
  $('replay-play').innerHTML = icon('pause')
  $('replay-play').setAttribute('aria-label','Pause replay')
  $('replay-play').title = 'Pause replay'
  hydrate($('replay-play'))
  timer = setInterval(step, 700)
})
$('indicator-open').addEventListener('click', () => {
  $('indicators').innerHTML = Object.entries(indicators).map(([id,[label]]) => `<label><input type="checkbox" value="${id}" ${(state.indicators ?? defaultIndicators).includes(id) ? 'checked' : ''}>${label}</label>`).join('')
  $('indicator-dialog').showModal()
})
$('indicators').addEventListener('change', () => {
  state.indicators = [...$('indicators').querySelectorAll('input:checked')].map(el => el.value)
  persist()
  renderChart()
})
$('import-open').addEventListener('click', () => {
  $('import-error').textContent = ''
  $('import-file').value = ''
  $('import-symbol').value = symbol
  $('import-dialog').showModal()
})
$('import-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('import-error').textContent = ''
  const submit = $('import-form').querySelector('[type=submit]')
  submit.disabled = true
  try {
    const file = $('import-file').files[0]
    if (!file || file.size > 4000000) throw Error('Choose a CSV file under 4 MB.')
    const candles = parseCSV(await file.text())
    const id = $('import-symbol').value
    imports[id] = await saveImport(id, candles)
    symbol = id
    $('import-dialog').close()
    $('journal-source').value = 'csv'
    setMode('live')
    setView('terminal')
    toast(candles.length.toLocaleString() + ' candles loaded for ' + market().name + '.')
  } catch (error) {
    $('import-error').textContent = error.message
  } finally { submit.disabled = false }
})
window.addEventListener('storage', event => {
  if (event.key !== storageKey) return
  const saved = readState()
  state = { ...saved, mode }
  render()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden && timer) stopReplay()
  if (!document.hidden && mode === 'live') void sceneScan({ silent: true })
})

hydrate()
for (const m of MARKETS) {
  $('import-symbol').add(new Option(m.name, m.id))
  $('journal-market').add(new Option(m.name, m.id))
}
document.querySelectorAll('nav [data-view]').forEach(el => el.setAttribute('aria-label', views[el.dataset.view]))
document.querySelector('[data-tool="cursor"]').classList.add('selected')
render()
try { await readImports() } catch { if (mode === 'live') toast('Stored CSV candles are unavailable.') }
setMode(mode)
