import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const src = path.resolve(fileURLToPath(import.meta.url), '..', 'src')

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }
  },
  resolve: {
    alias: { '@': src }
  }
})
