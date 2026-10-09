#!/usr/bin/env node
/**
 * StudioMaster launcher — opens the app without `npm run dev` or a terminal
 * that has to stay open. Used by StudioMaster.cmd / the desktop shortcut and
 * `npm start`.
 *
 *   1. Installs dependencies if package-lock.json changed since the last install
 *      (e.g. after `git pull`).
 *   2. Rebuilds the app if any source is newer than the last build.
 *   3. Starts the built app detached (main-process output goes to
 *      logs/studiomaster.log) and exits, so the console window closes.
 *
 * If StudioMaster is already running, the app's single-instance lock just
 * brings the existing window to the front.
 *
 * Console text is ASCII on purpose: the Windows console may not render Hebrew.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = join(ROOT, 'apps', 'desktop')
const OUT_FILES = ['main/index.js', 'preload/index.js', 'renderer/index.html'].map((f) =>
  join(APP_DIR, 'out', f),
)
const INSTALL_STAMP = join(ROOT, 'node_modules', '.studiomaster-install-stamp')
const LOG_DIR = join(ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, 'studiomaster.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024
/** A crash within this window is reported here instead of vanishing silently. */
const STARTUP_WATCH_MS = 2500

function fail(message) {
  console.error(`\n[StudioMaster] ${message}`)
  process.exit(1)
}

function npm(args) {
  // shell: npm is npm.cmd on Windows, which Node won't spawn directly.
  const res = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true })
  return res.status === 0
}

function lockHash() {
  return createHash('sha256')
    .update(readFileSync(join(ROOT, 'package-lock.json')))
    .digest('hex')
}

/**
 * 1. `npm install` when the lockfile differs from the one last installed. A
 * failed install (e.g. no internet) never blocks the app if it can still run.
 * Returns true when dependencies were (re)installed.
 */
function ensureDependencies() {
  const hash = lockHash()
  const haveDeps = existsSync(join(ROOT, 'node_modules', 'electron'))
  if (haveDeps && !existsSync(INSTALL_STAMP)) {
    // Installed before this launcher existed (installer / manual npm install).
    writeFileSync(INSTALL_STAMP, hash)
    return false
  }
  if (haveDeps && readFileSync(INSTALL_STAMP, 'utf8').trim() === hash) return false
  console.log('Installing / updating dependencies (first run after an update)...')
  if (npm(['install', '--no-audit', '--no-fund'])) {
    writeFileSync(INSTALL_STAMP, hash)
    return true
  }
  if (!haveDeps) fail('npm install failed - see the output above.')
  console.warn('npm install failed - continuing with the installed dependencies.')
  return false
}

/** Newest modification time (ms) of any file under `dir`. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

function buildIsStale() {
  if (!OUT_FILES.every((f) => existsSync(f))) return true
  const builtAt = Math.min(...OUT_FILES.map((f) => statSync(f).mtimeMs))
  const sources = [
    join(APP_DIR, 'src'),
    ...readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p, 'src')),
  ]
  const configs = [join(APP_DIR, 'electron.vite.config.ts'), join(APP_DIR, 'package.json')]
  const newestSource = Math.max(
    ...sources.map(newestMtime),
    ...configs.map((f) => statSync(f).mtimeMs),
  )
  return newestSource > builtAt
}

/** 2. Rebuild only when something changed since the last build. */
function ensureBuild(force) {
  if (!force && !buildIsStale()) return
  console.log('Building StudioMaster (only after an update, takes a minute)...')
  if (npm(['run', 'build', '--workspace', '@studiomaster/desktop'])) return
  if (!OUT_FILES.every((f) => existsSync(f))) {
    fail('Build failed - see the output above. If a module is missing, run: npm install')
  }
  console.warn('Build failed - starting the previous build instead.')
}

function electronBinary() {
  const require = createRequire(join(APP_DIR, 'package.json'))
  try {
    return require('electron')
  } catch {
    // The binary download was skipped or interrupted during install — retry it.
    console.log('Downloading the Electron runtime...')
    const install = join(dirname(require.resolve('electron/package.json')), 'install.js')
    spawnSync(process.execPath, [install], { cwd: ROOT, stdio: 'inherit' })
    delete require.cache[require.resolve('electron')]
    try {
      return require('electron')
    } catch {
      fail(
        'Electron is not installed correctly. Delete node_modules\\electron and run npm install.',
      )
    }
  }
}

function openLog() {
  mkdirSync(LOG_DIR, { recursive: true })
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
    renameSync(LOG_FILE, `${LOG_FILE}.old`)
  }
  const fd = openSync(LOG_FILE, 'a')
  writeFileSync(fd, `\n===== StudioMaster started ${new Date().toISOString()} =====\n`)
  return fd
}

/** 3. Start the built app detached and leave once it is up. */
function launch() {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL // dev-server mode only
  delete env.ELECTRON_RUN_AS_NODE
  const log = openLog()
  const child = spawn(electronBinary(), [APP_DIR, ...process.argv.slice(2)], {
    cwd: APP_DIR,
    env,
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.once('error', (err) => fail(`Could not start StudioMaster: ${err.message}`))
  child.once('exit', (code) => {
    if (code) fail(`StudioMaster closed right after starting (code ${code}). See ${LOG_FILE}`)
    process.exit(0) // a second copy hands focus to the running one and exits 0
  })
  setTimeout(() => {
    child.unref()
    process.exit(0)
  }, STARTUP_WATCH_MS)
}

console.log('Starting StudioMaster...')
const reinstalled = ensureDependencies()
ensureBuild(reinstalled)
launch()
