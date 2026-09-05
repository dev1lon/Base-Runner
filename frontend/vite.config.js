import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'node:fs'

const src = path.resolve(fileURLToPath(import.meta.url), '..', 'src')

export default defineConfig({
  plugins: [react(), {
    name: 'game-sources',
    configureServer(server) {
      const sources = {
        '/script.js': path.resolve(src, '../../script.js'),
        '/run-engine.js': path.resolve(src, '../../backend/src/run-engine.js'),
      }
      server.middlewares.use((req, res, next) => {
        const file = sources[req.url?.split('?')[0]]
        if (!file) return next()
        res.setHeader('Content-Type', 'application/javascript')
        res.end(readFileSync(file))
      })
    },
  }],
  server: {
    fs: { allow: ['..'] }
  },
  resolve: {
    alias: { '@': src }
  }
})
