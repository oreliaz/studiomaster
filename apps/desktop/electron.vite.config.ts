import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Workspace packages are consumed as TypeScript source and must be bundled,
// so they are excluded from dependency externalization.
const bundledWorkspaceDeps = [
  '@studiomaster/shared',
  '@studiomaster/obs-controller',
  '@studiomaster/studio-launcher',
  '@studiomaster/lighting',
  '@studiomaster/ptz-control',
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
