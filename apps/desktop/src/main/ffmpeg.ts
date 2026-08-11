import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname } from 'node:path'

/**
 * Bundled ffmpeg/ffprobe resolution (docs §6.4). The app ships the static
 * `ffmpeg-static` / `ffprobe-static` binaries so nothing has to be installed
 * separately — no reliance on a system PATH ffmpeg. Resolution is done at
 * runtime via require so a missing package simply falls back to PATH (the
 * installer's winget ffmpeg), and neither typecheck nor bundling depends on it.
 */

const req = createRequire(__filename)

/** In a packaged app the binary is unpacked next to the asar, not inside it. */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

function resolve(mod: string, pick: (m: unknown) => string | undefined): string | null {
  try {
    const raw = pick(req(mod))
    if (!raw) return null
    const p = unpacked(raw)
    return existsSync(p) ? p : null
  } catch {
    return null // package not installed — fall back to PATH
  }
}

export const ffmpegPath = resolve('ffmpeg-static', (m) => (typeof m === 'string' ? m : undefined))
export const ffprobePath = resolve('ffprobe-static', (m) => (m as { path?: string })?.path)

/** ffmpeg/ffprobe executables, preferring the bundled binaries. */
export const ffmpeg = ffmpegPath ?? 'ffmpeg'
export const ffprobe = ffprobePath ?? 'ffprobe'

/** Directories holding the bundled binaries, for prepending to a child PATH. */
function binDirs(): string[] {
  const dirs = new Set<string>()
  if (ffmpegPath) dirs.add(dirname(ffmpegPath))
  if (ffprobePath) dirs.add(dirname(ffprobePath))
  return [...dirs]
}

/**
 * A child-process env with the bundled ffmpeg/ffprobe on PATH, so spawned tools
 * (the Python pilot and the vendored skills, which call bare `ffmpeg`) find them
 * even when the OS has none installed. Also exports FFMPEG_BIN/FFPROBE_BIN for
 * scripts that honour them.
 */
export function ffmpegEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const path = [...binDirs(), process.env.PATH ?? ''].filter(Boolean).join(delimiter)
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, PATH: path }
  if (ffmpegPath) env.FFMPEG_BIN = ffmpegPath
  if (ffprobePath) env.FFPROBE_BIN = ffprobePath
  return env
}
