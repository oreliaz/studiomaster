import { createServer, type Server } from 'node:http'
import type { ObsConnectionState, ObsRecordState, ReviewMarkerCategory } from '@studiomaster/shared'

/**
 * Dock server (docs — the "OBS plugin" experience). Serves a compact control
 * page that the user adds to OBS as a **Custom Browser Dock**
 * (Docks → Custom Browser Docks → URL http://127.0.0.1:3939/dock). It exposes
 * the essentials — connection/record state, start/stop, and review markers —
 * so StudioMaster lives *inside* OBS without a native C++ plugin.
 *
 * The dock follows the app's interface language (he/en); it is rebuilt per
 * request so switching the language and reloading the dock takes effect.
 */
export type DockLang = 'he' | 'en'

export interface DockDeps {
  getState(): { connection: ObsConnectionState; record: ObsRecordState }
  toggleRecord(): Promise<ObsRecordState>
  addMarker(category: ReviewMarkerCategory): unknown
  /** Toggle the Source Record filter on the active cameras (separate angles). */
  toggleSeparateAngles(): Promise<{ on: boolean; cameras: number }>
  /** Current UI language, so the dock matches the rest of the app. */
  getLang?(): DockLang
}

export const DOCK_PORT = 3939

export function startDockServer(deps: DockDeps, port = DOCK_PORT): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (url.pathname === '/dock') {
      const lang = (url.searchParams.get('lang') as DockLang) || deps.getLang?.() || 'he'
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(dockHtml(lang === 'en' ? 'en' : 'he'))
      return
    }
    if (url.pathname === '/api/state') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(deps.getState()))
      return
    }
    if (url.pathname === '/api/record/toggle' && req.method === 'POST') {
      void deps.toggleRecord().finally(() => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(deps.getState().record))
      })
      return
    }
    if (url.pathname === '/api/marker' && req.method === 'POST') {
      const cat = (url.searchParams.get('cat') as ReviewMarkerCategory) || 'note'
      const marker = deps.addMarker(cat)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: !!marker }))
      return
    }
    if (url.pathname === '/api/angles/toggle' && req.method === 'POST') {
      void deps
        .toggleSeparateAngles()
        .then((r) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(r))
        })
        .catch(() => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ on: false, cameras: 0 }))
        })
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[dock] port ${port} already in use — another StudioMaster (or app) is ` +
          `holding it; the OBS dock will use the running instance.`,
      )
    } else {
      console.error('[dock] server error:', err)
    }
  })
  server.listen(port, '127.0.0.1')
  return server
}

interface DockStrings {
  connected: string
  disconnected: string
  start: string
  stop: string
  markFix: string
  markIntro: string
  highlight: string
  chapter: string
  markCount: string
  introCount: string
  angles: string
  anglesOn: string
  anglesOff: string
  anglesNone: string
}

const STRINGS: Record<DockLang, DockStrings> = {
  he: {
    connected: 'מחובר ל-OBS',
    disconnected: 'מנותק',
    start: '● התחל הקלטה',
    stop: '■ עצור הקלטה',
    markFix: '🔴 סמן טעות',
    markIntro: '🎬 כאן נכנס פתיח',
    highlight: 'הדגשה',
    chapter: 'פרק',
    markCount: 'סימונים בהקלטה: ',
    introCount: 'נקודות פתיח: ',
    angles: '🎥 זוויות נפרדות',
    anglesOn: 'זוויות נפרדות: פועל ({n})',
    anglesOff: 'זוויות נפרדות: כבוי',
    anglesNone: 'לא נמצא Source Record במצלמות',
  },
  en: {
    connected: 'Connected to OBS',
    disconnected: 'Disconnected',
    start: '● Start recording',
    stop: '■ Stop recording',
    markFix: '🔴 Mark mistake',
    markIntro: '🎬 Intro goes here',
    highlight: 'Highlight',
    chapter: 'Chapter',
    markCount: 'Markers this recording: ',
    introCount: 'Intro cues: ',
    angles: '🎥 Separate angles',
    anglesOn: 'Separate angles: on ({n})',
    anglesOff: 'Separate angles: off',
    anglesNone: 'No Source Record filter on cameras',
  },
}

function dockHtml(lang: DockLang): string {
  const s = STRINGS[lang]
  const dir = lang === 'he' ? 'rtl' : 'ltr'
  const L = JSON.stringify(s)
  return `<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>StudioMaster</title><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0f1115;color:#e7ebf2;padding:12px}
.tc{font-size:32px;font-variant-numeric:tabular-nums;text-align:center;margin:4px 0;direction:ltr}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#262b36;margin-inline-end:6px}
.dot.live{background:#ef4444}
button{width:100%;border:none;border-radius:8px;padding:12px;font-size:15px;color:#fff;cursor:pointer;margin:4px 0}
.rec{background:#ef4444}.rec.on{background:#7f1d1d}
/* Big, unmissable error-marking button — the primary in-OBS action. */
.mark-fix{background:linear-gradient(180deg,#f43f5e,#b91c1c);font-size:22px;font-weight:800;
  padding:22px 12px;border-radius:14px;box-shadow:0 4px 14px rgba(239,68,68,.45);
  letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.mark-fix:active{transform:translateY(1px)}
/* Prominent "insert intro here" cue — the second primary in-OBS action. */
.mark-intro{background:linear-gradient(180deg,#38bdf8,#0369a1);font-size:20px;font-weight:800;
  padding:18px 12px;border-radius:14px;box-shadow:0 4px 14px rgba(56,189,248,.4);
  letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.mark-intro:active{transform:translateY(1px)}
.flash{animation:flash .5s}
@keyframes flash{0%{background:#fff;color:#b91c1c}100%{}}
.row{display:flex;gap:6px}.row button{background:#222833;font-size:13px;padding:10px}
/* Separate-angles toggle (Source Record on the active cameras). */
.angles{background:linear-gradient(180deg,#f59e0b,#b45309);font-weight:700;font-size:15px;
  border-radius:12px;padding:14px 12px}
.angles.on{background:linear-gradient(180deg,#22c55e,#15803d)}
.angles:active{transform:translateY(1px)}
.status{font-size:12px;color:#8b93a4;text-align:center;margin-bottom:6px}
.count{font-size:12px;color:#8b93a4;text-align:center;margin-top:2px}
</style></head><body>
<div class="status" id="conn">…</div>
<div class="tc"><span class="dot" id="dot"></span><span id="tc">00:00:00.000</span></div>
<button class="rec" id="rec" onclick="toggle()"></button>
<button class="mark-fix" onclick="mark('fix',this)"></button>
<button class="mark-intro" onclick="mark('intro',this)"></button>
<div class="row">
<button id="bhl" onclick="mark('highlight',this)"></button>
<button id="bch" onclick="mark('chapter',this)"></button>
</div>
<button class="angles" id="angles" onclick="toggleAngles()"></button>
<div class="count" id="anglesstatus"></div>
<div class="count" id="count"></div>
<div class="count" id="introcount"></div>
<script>
var L=${L};
var marks=0,intros=0,base=0,baseAt=0,active=false;
document.querySelector('.mark-fix').textContent=L.markFix;
document.querySelector('.mark-intro').textContent=L.markIntro;
document.getElementById('bhl').textContent=L.highlight;
document.getElementById('bch').textContent=L.chapter;
document.getElementById('angles').textContent=L.angles;
function p(n,l){return String(n).padStart(l,'0')}
function fmt(ms){ms=Math.max(0,Math.floor(ms));return p(Math.floor(ms/3600000),2)+':'+p(Math.floor(ms%3600000/60000),2)+':'+p(Math.floor(ms%60000/1000),2)+'.'+p(Math.floor(ms%1000),3)}
async function refresh(){try{const s=await (await fetch('/api/state')).json();
document.getElementById('conn').textContent=s.connection.status==='connected'?L.connected:L.disconnected;
const r=s.record;active=!!r.active;base=r.timecodeMs||0;baseAt=performance.now();
const rec=document.getElementById('rec');rec.textContent=active?L.stop:L.start;rec.className='rec'+(active?' on':'');
document.getElementById('dot').className='dot'+(active?' live':'')}catch(e){}}
function tick(){var ms=active?base+(performance.now()-baseAt):base;document.getElementById('tc').textContent=fmt(ms)}
async function toggle(){await fetch('/api/record/toggle',{method:'POST'});setTimeout(refresh,200)}
async function mark(c,b){if(b){b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');}
const res=await (await fetch('/api/marker?cat='+c,{method:'POST'})).json();
if(res&&res.ok){if(c==='intro'){intros++;document.getElementById('introcount').textContent=L.introCount+intros;}
else{marks++;document.getElementById('count').textContent=L.markCount+marks;}}}
async function toggleAngles(){var b=document.getElementById('angles');b.disabled=true;
try{const r=await (await fetch('/api/angles/toggle',{method:'POST'})).json();
var st=document.getElementById('anglesstatus');
if(!r||!r.cameras){b.className='angles';st.textContent=L.anglesNone;}
else if(r.on){b.className='angles on';st.textContent=L.anglesOn.replace('{n}',r.cameras);}
else{b.className='angles';st.textContent=L.anglesOff;}}catch(e){}b.disabled=false;}
setInterval(refresh,1000);setInterval(tick,100);refresh();
</script></body></html>`
}
