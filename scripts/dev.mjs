import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname } from 'node:path'
import aiReview from '../api/ai-review.js'

const dist = new URL('../dist/', import.meta.url)
const files = new Set(await readdir(dist))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const port = Number(process.env.PORT || 4173)
createServer(async (req, res) => {
  const route = req.url.split('?')[0]
  if (route === '/api/ai-review') return aiReview(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const filename = route === '/' ? 'index.html' : route.slice(1)
  const type = mime[extname(filename)]
  if (!files.has(filename) || !type) {
    res.writeHead(404).end('Not found')
    return
  }
  try {
    const body = await readFile(new URL(filename, dist))
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(500).end('Static file unavailable')
  }
}).listen(port, '127.0.0.1', () => console.log(`Signal Atlas at http://127.0.0.1:${port}/`))
