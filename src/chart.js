import { MINUTE } from './engine.js'
import { CHART } from './config.js'

export const indicators = {
  ema20: ['EMA 20', '#b39bff'],
  ema50: ['EMA 50', '#ebbf73'],
  bands: ['Bollinger Bands', '#8eb5f4'],
  levels: ['Support / Resistance', '#80a6cb'],
  signal: ['Signal levels', '#6cdbc0'],
  volume: ['Volume', '#8895b9'],
  rsi: ['RSI 14', '#dc99f0'],
  macd: ['MACD', '#91adff'],
}
export const defaultIndicators = ['ema20', 'ema50', 'signal', 'volume']
const colors = { grid: '#282a39', dim: '#9699b1', green: '#54cdae', red: '#ed788e', ink: '#e3ddf4', plot: '#171923' }
const mono = '11px ui-monospace, monospace'

export function plotGeometry(width, height, allowedPanes) {
  const right = Math.min(width, Math.max(CHART.minPlotWidth, width - (width < CHART.compactWidth ? CHART.compactAxis : CHART.priceAxis)))
  const bottomAxis = Math.max(1, height - CHART.timeAxis)
  const top = Math.max(0, Math.min(CHART.top, bottomAxis - 1))
  const panes = [...allowedPanes]
  const paneHeight = () => panes.length === 3 ? CHART.compactPaneHeight : CHART.paneHeight
  while (panes.length && bottomAxis - top - panes.length * paneHeight() < CHART.minPriceHeight) panes.pop()
  const paneH = paneHeight()
  return { right, top, bottomAxis, bottom: bottomAxis - panes.length * paneH, panes, paneH }
}

export class CandlestickChart {
  constructor(canvas, options) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.options = options
    this.limit = CHART.visibleBars
    this.tool = 'cursor'
    this.hover = null
    this.anchor = null
    new ResizeObserver(() => this.draw()).observe(canvas)
    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect()
      this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      this.draw()
    })
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw() })
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect()
      this.place(e.clientX - rect.left, e.clientY - rect.top)
    })
    canvas.addEventListener('keydown', e => this.onKey(e))
    canvas.addEventListener('blur', () => { this.hover = null; this.draw() })
  }

  update(data) {
    if (data.key !== this.data?.key) this.anchor = null
    this.data = data
    this.draw()
  }

  use(tool) {
    if (tool === 'undo') {
      if (this.anchor) this.anchor = null
      else this.options.remove()
    } else if (tool === 'zoom-in') {
      this.limit = Math.max(CHART.minBars, this.limit - CHART.zoomStep)
    } else if (tool === 'zoom-out') {
      this.limit = Math.min(CHART.maxBars, this.limit + CHART.zoomStep)
    } else {
      if (tool !== this.tool) this.anchor = null
      this.tool = tool
    }
    this.draw()
  }

  visibleBars() {
    return this.data?.all.slice(-this.limit) ?? []
  }

  onKey(event) {
    const g = this.geom
    if (!g) return
    const moves = { ArrowLeft: [-g.dx, 0], ArrowRight: [g.dx, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }
    const move = Object.hasOwn(moves, event.key) ? moves[event.key] : null
    if (!move && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    const current = this.hover ?? { x: (g.bars.length - .5) * g.dx, y: (g.top + g.bottom) / 2 }
    if (move) {
      this.hover = {
        x: Math.min((g.bars.length - .5) * g.dx, Math.max(g.dx / 2, current.x + move[0])),
        y: Math.min(g.bottom, Math.max(g.top, current.y + move[1])),
      }
      this.draw()
    } else {
      this.place(current.x, current.y)
    }
  }

  place(x, y) {
    if (!this.geom || this.tool === 'cursor') return
    const g = this.geom
    if (x < 0 || x >= g.right || y < g.top || y > g.bottom) return
    const index = Math.min(g.bars.length - 1, Math.floor(x / g.dx))
    const point = { t: g.bars[index].t, price: g.price(y) }
    if (this.tool === 'line') this.options.add({ type: 'line', a: point })
    if (this.tool === 'trend' && this.anchor) {
      if (this.anchor.t === point.t) return
      this.options.add({ type: 'trend', a: this.anchor, b: point })
      this.anchor = null
    } else if (this.tool === 'trend') {
      this.anchor = point
    }
    this.draw()
  }

  draw() {
    const { canvas, ctx, data } = this
    if (!data) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth, height = canvas.clientHeight
    if (!width || !height) { this.geom = null; return }
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const { all, studies: s, shown, levels, signal, frame, drawings, format } = data
    const bars = this.visibleBars()
    if (!bars.length) { this.geom = null; this.options.inspect(null); return }
    const shift = all.length - bars.length
    const allowedPanes = []
    if (shown.has('volume') && bars.some(b => b.v !== null)) allowedPanes.push('volume')
    if (shown.has('rsi')) allowedPanes.push('rsi')
    if (shown.has('macd')) allowedPanes.push('macd')
    const { right, top, bottom, bottomAxis, panes, paneH } = plotGeometry(width, height, allowedPanes)
    const projected = shown.has('signal') && signal ? [signal.stop, signal.entry, signal.target] : []
    if (shown.has('levels') && levels) projected.push(levels.support, levels.resistance)
    const overlay = projected.filter(Number.isFinite)
    const high = Math.max(...bars.map(b => b.h), ...overlay)
    const low = Math.min(...bars.map(b => b.l), ...overlay)
    const padding = Math.max(Number.MIN_VALUE, (high - low || high * CHART.flatRange) * CHART.pricePadding)
    const max = Math.min(Number.MAX_VALUE, high + padding), min = Math.max(0, low - padding)
    const dx = right / (bars.length + 3)
    const x = i => (i + .5) * dx
    const y = price => top + ((max - price) / (max - min)) * (bottom - top)
    const price = y => max - ((y - top) / (bottom - top)) * (max - min)
    this.geom = { right, top, bottom, bars, dx, price }
    const line = (x1, y1, x2, y2, color) => {
      ctx.strokeStyle = color
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    }
    const text = (value, px, py, color = colors.dim, align = 'left') => {
      ctx.font = mono; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(value, px, py)
    }
    const trace = (values, scale, color) => {
      ctx.beginPath()
      let started = false
      for (let i = 0; i < bars.length; i++) {
        const val = values[shift + i]
        if (val == null) { started = false; continue }
        if (started) ctx.lineTo(x(i), scale(val))
        else { ctx.moveTo(x(i), scale(val)); started = true }
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1
    }
    for (let n = 0; n <= 5; n++) {
      const py = top + (bottom - top) * n / 5
      line(0, py, right, py, colors.grid)
      text(format(price(py)), right + 7, py)
    }
    line(right, 0, right, bottomAxis, colors.grid)
    line(0, bottomAxis, width, bottomAxis, colors.grid)
    const tick = Math.max(4, Math.ceil(bars.length / Math.max(2, Math.floor(right / 86))))
    for (let i = Math.floor(tick / 2); i < bars.length; i += tick) {
      const date = new Date(bars[i].t)
      const label = frame === 240 || date.getUTCHours() === 0 ? date.toISOString().slice(5, 10) : date.toISOString().slice(11, 16)
      line(x(i), 0, x(i), bottomAxis, colors.grid)
      text(label, x(i), height - 11, colors.dim, 'center')
    }
    ctx.save()
    ctx.beginPath(); ctx.rect(0, top, right, bottom - top); ctx.clip()
    if (shown.has('bands')) {
      trace(s.band.map(b => b?.upper), y, indicators.bands[1])
      trace(s.band.map(b => b?.lower), y, indicators.bands[1])
    }
    for (const id of ['ema20', 'ema50']) if (shown.has(id)) trace(s[id], y, indicators[id][1])
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], px = x(i), w = Math.max(1.4, Math.min(13, dx * .63))
      const color = b.c >= b.o ? colors.green : colors.red
      line(px, y(b.h), px, y(b.l), color)
      ctx.fillStyle = color
      ctx.fillRect(px - w / 2, Math.min(y(b.o), y(b.c)), w, Math.max(1.3, Math.abs(y(b.o) - y(b.c))))
    }
    const tag = (value, label, color) => {
      const py = y(value)
      ctx.setLineDash([4, 4]); line(0, py, right, py, color); ctx.setLineDash([])
      if (label) {
        ctx.font = mono
        const labelWidth = ctx.measureText(label).width + 9
        ctx.fillStyle = colors.plot
        ctx.fillRect(right - labelWidth - 4, py - 7, labelWidth, 14)
        text(label, right - 8, py, color, 'right')
      }
    }
    if (shown.has('levels') && levels) {
      tag(levels.support, 'Support', indicators.levels[1])
      tag(levels.resistance, 'Resistance', indicators.levels[1])
    }
    if (shown.has('signal') && signal) {
      tag(signal.entry, 'Entry', '#bba9ff')
      tag(signal.stop, 'Stop', colors.red)
      tag(signal.target, 'Target', colors.green)
    }
    const timeX = time => {
      const first = bars[0].t
      if (time < first) return (time - first) / (frame * MINUTE) * dx
      const idx = bars.findIndex(b => b.t >= time)
      return idx < 0 ? right : x(idx)
    }
    for (const draw of drawings) {
      if (draw.type === 'line') tag(draw.a.price, '', '#ebbf73')
      else if (Math.min(draw.a.t, draw.b.t) <= bars.at(-1).t) line(timeX(draw.a.t), y(draw.a.price), timeX(draw.b.t), y(draw.b.price), '#ebbf73')
    }
    if (this.anchor) {
      ctx.fillStyle = '#ebbf73'
      ctx.beginPath(); ctx.arc(timeX(this.anchor.t), y(this.anchor.price), 3, 0, 2 * Math.PI); ctx.fill()
    }
    const current = bars.at(-1)
    const py = y(current.c)
    const quoteColor = current.c >= current.o ? colors.green : colors.red
    ctx.setLineDash([2, 5]); line(x(bars.length - 1), py, right, py, quoteColor); ctx.setLineDash([])
    ctx.restore()
    ctx.fillStyle = quoteColor; ctx.fillRect(right + 1, py - 8, width - right - 1, 16)
    text(format(current.c), right + 6, py, '#111923')

    panes.forEach((kind, index) => {
      const paneTop = bottom + index * paneH
      const paneBottom = paneTop + paneH
      line(0, paneTop, right, paneTop, colors.grid)
      if (kind === 'volume') {
        const maxVolume = Math.max(1, ...bars.map(b => b.v ?? 0))
        bars.forEach((b, i) => {
          const h = (b.v ?? 0) * (paneH - 14) / maxVolume
          ctx.fillStyle = b.c >= b.o ? '#306b64' : '#65394e'
          ctx.fillRect(x(i) - dx * .29, paneBottom - h, dx * .58, h)
        })
        text('VOL', 6, paneTop + 8)
      } else if (kind === 'rsi') {
        const sy = val => paneBottom - 2 - val * (paneH - 4) / 100
        line(0, sy(30), right, sy(30), colors.grid)
        line(0, sy(70), right, sy(70), colors.grid)
        trace(s.rsi, sy, indicators.rsi[1])
        text('RSI 14', 6, paneTop + 8)
        text('70', right + 7, sy(70))
        text('30', right + 7, sy(30))
      } else {
        const maxAbs = Math.max(1e-12, ...[...s.macd.slice(shift), ...s.macdSignal.slice(shift)].map(n => Math.abs(n ?? 0)))
        const sy = val => paneTop + paneH / 2 - val * (paneH - 8) / 2 / maxAbs
        line(0, sy(0), right, sy(0), colors.grid)
        trace(s.macd, sy, indicators.macd[1])
        trace(s.macdSignal, sy, '#ebbf73')
        text('MACD', 6, paneTop + 8)
      }
    })
    const hover = this.hover
    if (hover && hover.x < right && hover.y >= top && hover.y <= bottomAxis) {
      const index = Math.min(bars.length - 1, Math.max(0, Math.floor(hover.x / dx)))
      ctx.setLineDash([3, 4])
      line(x(index), 0, x(index), bottomAxis, '#788093')
      line(0, hover.y, right, hover.y, '#788093')
      ctx.setLineDash([])
      if (hover.y <= bottom) {
        ctx.fillStyle = '#3a3c50'; ctx.fillRect(right + 1, hover.y - 8, width - right - 1, 16)
        text(format(price(hover.y)), right + 6, hover.y, colors.ink)
      }
      this.options.inspect(bars[index])
    } else {
      this.options.inspect(current)
    }
  }
}
