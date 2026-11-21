import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'

const src = new URL('../src/', import.meta.url)
const dist = new URL('../dist/', import.meta.url)
const files = (await readdir(src)).sort()
const existing = await readdir(dist).catch(error => {
  if (error.code !== 'ENOENT') throw error
  return []
})
const unexpected = existing.filter(file => !files.includes(file))
if (unexpected.length) throw Error('Remove stale dist files: ' + unexpected.join(', '))

if (process.argv.includes('--verify')) {
  if (files.length !== existing.length) throw Error('Missing dist files. Run npm run build.')
  for (const file of files) {
    const [source, output] = await Promise.all([readFile(new URL(file, src)), readFile(new URL(file, dist))])
    if (!source.equals(output)) throw Error(`dist/${file} differs from src. Run npm run build.`)
  }
  console.log('dist matches src')
} else {
  await mkdir(dist, { recursive: true })
  await Promise.all(files.map(file => copyFile(new URL(file, src), new URL(file, dist))))
  console.log(`Built ${files.length} static files`)
}
