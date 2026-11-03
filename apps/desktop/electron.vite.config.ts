import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig(() => {
  return {
    main: {},
    preload: {},
    renderer: {
      resolve: { alias: { '@': resolve('src/renderer/src') } },
      // No <meta> CSP: main sets the policy as a response header, because its `connect-src`
      // follows the server the user chose at runtime.
      plugins: [react(), tailwindcss()],
    },
  }
})
