import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: '../assets/*', dest: 'assets' },
        { src: '../style.css', dest: '.' },
        { src: '../script.js', dest: '.' },
      ]
    })
  ],
  server: {
    fs: { allow: ['..'] }
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
})
