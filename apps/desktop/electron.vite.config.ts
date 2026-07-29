import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Excluded from dependency externalization = bundled into the main process.
// - the workspace packages are consumed as TypeScript source, so must be bundled.
// - obs-websocket-js is an ESM package with a default export; if left external
//   and required from the CJS main bundle, the default import resolves to the
//   namespace ("OBSWebSocket is not a constructor"), so we bundle it instead.
const bundledWorkspaceDeps = [
  '@studiomaster/shared',
  '@studiomaster/obs-controller',
  '@studiomaster/studio-launcher',
  '@studiomaster/lighting',
  '@studiomaster/ptz-control',
  'obs-websocket-js',
]

const alias = {
  '@studiomaster/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@studiomaster/obs-controller': resolve(__dirname, '../../packages/obs-controller/src/index.ts'),
  '@studiomaster/studio-launcher': resolve(
    __dirname,
    '../../packages/studio-launcher/src/index.ts',
  ),
  '@studiomaster/lighting': resolve(__dirname, '../../packages/lighting/src/index.ts'),
  '@studiomaster/ptz-control': resolve(__dirname, '../../packages/ptz-control/src/index.ts'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspaceDeps })],
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspaceDeps })],
    resolve: { alias },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@studiomaster/shared': alias['@studiomaster/shared'] } },
  },
})
