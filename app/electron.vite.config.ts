import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // keep node deps (pdfjs-dist, mammoth, fast-xml-parser, electron-updater) external
  // so they load from node_modules at runtime instead of being bundled
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()]
  }
})
