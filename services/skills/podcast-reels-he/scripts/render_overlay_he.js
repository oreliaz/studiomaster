// Portable overlay compositor for podcast-reels-he (premium / hyperframes style).
// Forked from reels-pro/reelkit/render_overlay.js but with NO hardcoded machine paths:
// puppeteer and Chrome are resolved dynamically so it runs on any machine after
// install.ps1 has populated ../premium-engine (npm i puppeteer downloads Chrome too).
//
// ROBUST renderer (matches the WARREN/ajay fix):
//   1) Puppeteer renders ONLY the transparent overlay to a PNG SEQUENCE ON DISK,
//      with a double-requestAnimationFrame paint-sync per frame. Disk frames (not a
//      live stdin pipe) eliminate the live-pipe frame CORRUPTION/glitches, and the
//      paint-sync guarantees no stale/half-painted frame is ever captured.
//   2) TWO-PASS ffmpeg: pass 1 composites video ONLY (-an); pass 2 muxes a
//      separately-mixed clean audio track with -c:v copy. Mixing audio in the same
//      pass as an image2 sequence makes ffmpeg drop voice samples (image2 demuxer +
//      -shortest) -> words vanish + click/pop bursts ("חיתוכי מילים"). A pure
//      audio-only graph can't be dropped.
//
// Usage:
//   node render_overlay_he.js <index.html> <presenter.mp4> <out.mp4> <duration> \
//        [music.mp3] [cropXOffset|cw:ch:cx:cy] [voiceFades=""] [musicVol=0.13]

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function log(...a) { console.log('[overlay-he]', ...a); }

// ---- dynamic puppeteer resolution (no hardcoded paths) ----
function loadPuppeteer() {
  const here = __dirname;
  const cands = [
    process.env.PUPPETEER_MODULE_PATH,
    path.join(here, '..', 'premium-engine', 'node_modules', 'puppeteer'),
    path.join(here, '..', 'premium-engine', 'node_modules', 'puppeteer-core'),
    'puppeteer', 'puppeteer-core',
    // legacy fallbacks (original author's machine)
    'C:/Users/OR/Desktop/claude-code/hebrew-hyperframes/hebrew-reel/node_modules/puppeteer-core',
  ].filter(Boolean);
  for (const c of cands) {
    try { return { mod: require(c), from: c }; } catch (e) { /* try next */ }
  }
  throw new Error('puppeteer not found. Run install.ps1 (premium setup), or in ' +
    path.join(here, '..', 'premium-engine') + ' run: npm install puppeteer');
}

// ---- ffmpeg resolution ----
// This script always runs inside the queue's serialized slot (render_premium.py calls
// ensure_queued first), so we invoke the REAL ffmpeg directly rather than the queue
// shim — piping binary PNG frames through the shim's launcher hop is fragile.
function resolveFfmpeg() {
  if (process.env.FFMPEG_BIN && fs.existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
  const rq = process.env.RENDER_QUEUE_DIR
    || path.join(os.homedir(), 'Desktop', 'claude-code', 'render-queue');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(rq, 'config.json'), 'utf8'));
    if (cfg.ffmpeg_real && fs.existsSync(cfg.ffmpeg_real)) return cfg.ffmpeg_real;
  } catch (e) {}
  return 'ffmpeg';
}
const FFMPEG = resolveFfmpeg();

// ---- dynamic Chrome resolution ----
function resolveChrome(pptr) {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH))
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  // Scan the puppeteer browser cache FIRST and pick the NEWEST build. This is
  // deliberate: puppeteer's own bundled build (pptr.executablePath()) on this
  // machine is Chrome 131, which crashes the renderer on 1080x1920 screenshots
  // ("Target closed"). The newer cached build (147, used by reels-pro for the
  // WARREN renders) is stable, so prefer it over the bundled one.
  const cacheRoot = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    const builds = fs.readdirSync(cacheRoot)
      .map(d => path.join(cacheRoot, d, 'chrome-win64', 'chrome.exe'))
      .filter(p => fs.existsSync(p)).sort();
    if (builds.length) return builds[builds.length - 1];
  } catch (e) {}
  try { const p = pptr.executablePath && pptr.executablePath(); if (p && fs.existsSync(p)) return p; } catch (e) {}
  // system Chrome
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  ]) { if (fs.existsSync(p)) return p; }
  return null; // let full puppeteer fall back to its bundled browser
}

const [INDEX, PRESENTER, OUT, DURATION_S, MUSIC, CROPSPEC, VOICEFADES, MUSICVOL] = process.argv.slice(2);
const DURATION = parseFloat(DURATION_S);
const cropRect = (CROPSPEC && /^\d+:\d+:\d+:\d+$/.test(CROPSPEC)) ? CROPSPEC : null;
const cropOff = (!cropRect && CROPSPEC && CROPSPEC !== '') ? parseInt(CROPSPEC, 10) : 0;
const musicVol = MUSICVOL ? parseFloat(MUSICVOL) : 0.13;
const voiceFadeTimes = (VOICEFADES || '').split(',').map(s => parseFloat(s)).filter(x => !isNaN(x));
const W = 1080, H = 1920, FPS = 30;
const TOTAL = Math.round(DURATION * FPS);
const INDEX_URL = 'file:///' + path.resolve(INDEX).replace(/\\/g, '/');

async function main() {
  const { mod: puppeteer, from } = loadPuppeteer();
  const chrome = resolveChrome(puppeteer);
  log('puppeteer from', from);
  log('chrome', chrome || '(puppeteer default)');
  const launchOpts = {
    headless: 'new',
    // Same proven args as reels-pro's render_overlay.js (the WARREN renders use
    // these on this machine). Stability comes from the Chrome build selected in
    // resolveChrome (147, not the buggy bundled 131) — not from extra flags.
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1',
           '--hide-scrollbars', `--window-size=${W},${H}`,
           '--default-background-color=00000000'],
    protocolTimeout: 300000,   // tolerate a slow frame when the box is under memory/CPU pressure
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  };
  if (chrome) launchOpts.executablePath = chrome;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  page.on('pageerror', e => log('page.error:', e.message));
  await page.goto(INDEX_URL, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const imgs = [...document.querySelectorAll('img')];
    await Promise.all(imgs.map(im => im.complete ? Promise.resolve()
      : new Promise(r => { im.onload = r; im.onerror = r; })));
  });
  const ok = await page.evaluate(() => !!(window.gsap && window.__timelines && window.__timelines.reel));
  if (!ok) throw new Error('GSAP timeline not ready');
  await page.evaluate(() => { window.__timelines.reel.pause(); window.__timelines.reel.time(0); });

  // CTA zoom-in: over the final 5s, slowly push the presenter from 1.0 -> 1.12
  // (scale up, then centre-crop back to frame). z=1.0 before ZT so it's a no-op.
  const ZT = Math.max(0, DURATION - 5).toFixed(2);
  const ZE = `min(1.12,1+max(0,t-${ZT})*0.024)`;
  const ctaZoom = `scale=w='trunc(${W}*${ZE}/2)*2':h='trunc(${H}*${ZE}/2)*2':eval=frame,crop=${W}:${H}`;
  const presenterChain = cropRect
    ? `[0:v]crop=${cropRect.split(':').join(':')},scale=${W}:${H}:flags=lanczos,fps=${FPS},${ctaZoom},setsar=1[pv]`
    : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,`
      + `crop=${W}:${H}:(in_w-${W})/2+${cropOff}:(in_h-${H})/2,fps=${FPS},${ctaZoom},setsar=1[pv]`;

  // ---- 1) overlay -> PNG SEQUENCE ON DISK (paint-synced, no live pipe) ----
  const FRAMES_DIR = path.join(os.tmpdir(), `prh_frames_${path.basename(OUT, '.mp4')}_${process.pid}`);
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  async function seekAndShoot(t, fp) {
    await page.evaluate(async (t) => {
      window.__timelines.reel.time(t);
      for (const el of document.querySelectorAll('.clip')) {
        const s = parseFloat(el.getAttribute('data-start') || '0');
        const d = parseFloat(el.getAttribute('data-duration') || '0');
        el.style.visibility = (t >= s && t < s + d) ? 'visible' : 'hidden';
      }
      // wait for the browser to actually PAINT this frame before we capture it
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, t);
    await page.screenshot({ path: fp, type: 'png', omitBackground: true, captureBeyondViewport: false });
  }

  const t0 = Date.now(); let last = t0;
  for (let n = 0; n < TOTAL; n++) {
    const t = n / FPS;
    const fp = path.join(FRAMES_DIR, 'f_' + String(n + 1).padStart(5, '0') + '.png');
    try {
      await seekAndShoot(t, fp);
    } catch (e) {
      log(`frame ${n + 1} blip (${String(e.message).split('\n')[0]}); retrying`);
      await new Promise(r => setTimeout(r, 800));
      await seekAndShoot(t, fp);
    }
    if (Date.now() - last > 5000) {
      const el = (Date.now() - t0) / 1000, fps = (n + 1) / el;
      log(`overlay ${n + 1}/${TOTAL}  ${((n + 1) / TOTAL * 100).toFixed(0)}%  ${fps.toFixed(1)}fps  ETA ${((TOTAL - n - 1) / fps).toFixed(0)}s`);
      last = Date.now();
    }
  }
  await browser.close();
  const written = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).length;
  log(`overlay frames on disk: ${written}/${TOTAL}`);

  // ---- 2) TWO-PASS composite ----
  const hasMusic = MUSIC && fs.existsSync(MUSIC);
  const SILENT = path.join(os.tmpdir(), `prh_silent_${path.basename(OUT, '.mp4')}_${process.pid}.mp4`);

  // PASS 1/2 — composite VIDEO ONLY (no audio) from presenter + the PNG sequence
  // Optional static branding overlay (full-frame transparent PNG), composited on top, as-is.
  const LOGO = process.env.PRH_LOGO_PNG || '';
  const hasLogo = LOGO && fs.existsSync(LOGO);
  const vin = ['-y', '-i', PRESENTER, '-framerate', String(FPS), '-i', path.join(FRAMES_DIR, 'f_%05d.png')];
  if (hasLogo) vin.push('-loop', '1', '-i', LOGO);
  const vFilter = hasLogo
    ? `${presenterChain};[pv][1:v]overlay=0:0:format=auto:shortest=1[vo];[vo][2:v]overlay=0:0:format=auto[v]`
    : `${presenterChain};[pv][1:v]overlay=0:0:format=auto:shortest=1[v]`;
  const vargs = [...vin,
    '-filter_complex', vFilter,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-t', String(DURATION), '-movflags', '+faststart', SILENT];
  if (hasLogo) log(`compositing branding logo overlay: ${LOGO}`);
  log(`ffmpeg (${FFMPEG}) compositing video (pass 1/2)...`);
  let r = spawnSync(FFMPEG, vargs, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error('[overlay-he] video pass failed', r.status); process.exit(1); }

  // PASS 2/2 — mux a separately-mixed clean audio track (video stream copied)
  let voiceFilters = 'volume=1.0';
  for (const tf of voiceFadeTimes) {
    voiceFilters += `,volume=volume='1-0.92*exp(-pow((t-${tf.toFixed(2)})/0.18\\,2))':eval=frame`;
  }
  const aargs = ['-y', '-i', SILENT, '-i', PRESENTER];
  let aGraph;
  if (hasMusic) {
    aargs.push('-stream_loop', '-1', '-i', MUSIC);
    aGraph = `[1:a]${voiceFilters}[voice];[2:a]volume=${musicVol}[m];`
           + `[voice][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx];`
           + `[mx]alimiter=limit=0.95[aout]`;
  } else {
    aGraph = `[1:a]${voiceFilters},alimiter=limit=0.95[aout]`;
  }
  aargs.push('-filter_complex', aGraph, '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT);
  log(`ffmpeg muxing clean audio (pass 2/2)${hasMusic ? ` + music@${musicVol}` : ''} -> ${OUT}`);
  r = spawnSync(FFMPEG, aargs, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error('[overlay-he] audio pass failed', r.status); process.exit(1); }

  // verify + cleanup
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'default=nk=1:nw=1', OUT], { encoding: 'utf-8' });
  const got = parseInt((probe.stdout || '').trim(), 10);
  log(`OUT frames: ${got} (expected ~${TOTAL})`);
  fs.rmSync(SILENT, { force: true });
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  log('DONE ->', OUT);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
