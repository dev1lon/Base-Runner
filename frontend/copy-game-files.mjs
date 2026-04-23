import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const game = join(dir, '..')
const dist = join(dir, 'dist')

copyFileSync(join(game, 'script.js'), join(dist, 'script.js'))
copyFileSync(join(game, 'style.css'), join(dist, 'style.css'))

const assetsSrc = join(game, 'assets')
const assetsDst = join(dist, 'assets')
mkdirSync(assetsDst, { recursive: true })
for (const f of readdirSync(assetsSrc)) {
  copyFileSync(join(assetsSrc, f), join(assetsDst, f))
}

console.log('Game files copied to dist/')
