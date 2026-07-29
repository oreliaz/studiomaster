import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Separate-audio-per-microphone (requirement 2). When OBS records with
 * multi-track audio enabled — a distinct track per microphone — the recording
 * is a single container holding several audio streams. After the recording
 * stops, this splits each track into its own WAV in the session's `audio/`
 * folder, named by the OBS track title when present (e.g. mic-Guest.wav).
 *
 * Best-effort and dependency-light: it shells out to the same ffmpeg/ffprobe the
 * editing pipeline already requires, and never throws into the record flow — a
 * missing ffmpeg or a single-track file simply yields no split files.
 */

interface AudioStream {
  /** 0-based index among *audio* streams (maps to ffmpeg `0:a:<i>`). */
  audioIndex: number
  title?: string
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

/** Filesystem-safe track label. */
function sanitize(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40)
}

/** Probe the audio streams of a media file (empty if ffprobe is unavailable). */
export async function probeAudioStreams(file: string): Promise<AudioStream[]> {
  try {
    const { code, stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index:stream_tags=title',
      '-of',
      'json',
      file,
    ])
    if (code !== 0) return []
    const parsed = JSON.parse(stdout) as {
      streams?: { tags?: { title?: string } }[]
    }
    const streams = parsed.streams ?? []
    return streams.map((s, audioIndex) => ({ audioIndex, title: s.tags?.title }))
  } catch {
    return []
  }
}

export interface SplitResult {
  /** Absolute paths of the per-track WAV files written (empty if not split). */
  files: string[]
  /** Total audio tracks found in the recording. */
  trackCount: number
}

/**
 * Split a recording's audio tracks into per-track WAV files. No-op (returns an
 * empty file list) when the recording has one track or fewer, or when ffmpeg is
 * absent. `outDir` defaults to `<sessionDir>/audio`.
 */
export async function splitAudioTracks(
  recordingPath: string,
  sessionDir: string,
): Promise<SplitResult> {
  const streams = await probeAudioStreams(recordingPath)
  if (streams.length <= 1) return { files: [], trackCount: streams.length }

  const outDir = join(sessionDir, 'audio')
  try {
    mkdirSync(outDir, { recursive: true })
  } catch {
    return { files: [], trackCount: streams.length }
  }

  const files: string[] = []
  for (const stream of streams) {
    const n = stream.audioIndex + 1
    const label = stream.title ? `-${sanitize(stream.title)}` : ''
    const out = join(outDir, `track${n}${label}.wav`)
    try {
      const { code } = await run('ffmpeg', [
        '-y',
        '-i',
        recordingPath,
        '-map',
        `0:a:${stream.audioIndex}`,
        '-c:a',
        'pcm_s16le',
        out,
      ])
      if (code === 0) files.push(out)
    } catch {
      // Skip this track; keep going with the rest.
    }
  }
  return { files, trackCount: streams.length }
}
