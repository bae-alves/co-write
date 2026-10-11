import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/main/csp'

/** Packaged builds load over file://, where response headers don't exist, so bake the CSP in. */
function productionCsp(serverOrigin: string): Plugin {
  return {
    name: 'co-write:production-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: buildCsp({ dev: false, serverOrigin }),
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    main: {},
    preload: {},
    renderer: {
      resolve: { alias: { '@': resolve('src/renderer/src') } },
      plugins: [
        react(),
        tailwindcss(),
        productionCsp(env['VITE_SERVER_URL'] ?? 'http://localhost:8080'),
      ],
    },
  }
})
