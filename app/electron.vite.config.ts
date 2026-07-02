import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // keep node deps (pdfjs-dist, mammoth, fast-xml-parser, electron-updater) external
  // so they load from node_modules at runtime instead of being bundled.
  // kokoro-js/transformers are devDependencies (the parked Read-with-me voice stack
  // is excluded from the packaged app), so externalizeDepsPlugin doesn't cover them —
  // list them explicitly or the bundler would inline megabytes of ML runtime.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { external: ['kokoro-js', '@huggingface/transformers'] } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()]
  }
})
