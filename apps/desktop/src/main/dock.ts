import { createServer, type Server } from 'node:http'
import type { ObsConnectionState, ObsRecordState, ReviewMarkerCategory } from '@studiomaster/shared'

/**
 * Dock server (docs — the "OBS plugin" experience). Serves a compact control
 * page that the user adds to OBS as a **Custom Browser Dock**
 * (Docks → Custom Browser Docks → URL http://127.0.0.1:3939/dock). It exposes
 * the essentials — connection/record state, start/stop, and review markers —
 * so StudioMaster lives *inside* OBS without a native C++ plugin.
 */
export interface DockDeps {
  getState(): { connection: ObsConnectionState; record: ObsRecordState }
  toggleRecord(): Promise<ObsRecordState>
  addMarker(category: ReviewMarkerCategory): unknown
}

export const DOCK_PORT = 3939

export function startDockServer(deps: DockDeps, port = DOCK_PORT): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (url.pathname === '/dock') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(DOCK_HTML)
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
    res.statusCode = 404
    res.end('not found')
  })
  server.on('error', (err) => console.error('[dock] server error:', err))
  server.listen(port, '127.0.0.1')
  return server
}

const DOCK_HTML = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"/>
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
.mark-fix.flash{animation:flash .5s}
@keyframes flash{0%{background:#fff;color:#b91c1c}100%{}}
.row{display:flex;gap:6px}.row button{background:#222833;font-size:13px;padding:10px}
.status{font-size:12px;color:#8b93a4;text-align:center;margin-bottom:6px}
.count{font-size:12px;color:#8b93a4;text-align:center;margin-top:2px}
</style></head><body>
<div class="status" id="conn">…</div>
<div class="tc"><span class="dot" id="dot"></span><span id="tc">00:00:00.000</span></div>
<button class="rec" id="rec" onclick="toggle()">● התחל הקלטה</button>
<button class="mark-fix" id="markfix" onclick="mark('fix')">🔴 סמן טעות</button>
<div class="row">
<button onclick="mark('highlight')">הדגשה</button>
<button onclick="mark('chapter')">פרק</button>
</div>
<div class="count" id="count"></div>
<script>
var marks=0,base=0,baseAt=0,active=false;
function p(n,l){return String(n).padStart(l,'0')}
function fmt(ms){ms=Math.max(0,Math.floor(ms));return p(Math.floor(ms/3600000),2)+':'+p(Math.floor(ms%3600000/60000),2)+':'+p(Math.floor(ms%60000/1000),2)+'.'+p(Math.floor(ms%1000),3)}
async function refresh(){try{const s=await (await fetch('/api/state')).json();
document.getElementById('conn').textContent=s.connection.status==='connected'?'מחובר ל-OBS':'מנותק';
const r=s.record;active=!!r.active;base=r.timecodeMs||0;baseAt=performance.now();
const rec=document.getElementById('rec');rec.textContent=active?'■ עצור הקלטה':'● התחל הקלטה';rec.className='rec'+(active?' on':'');
document.getElementById('dot').className='dot'+(active?' live':'')}catch(e){}}
function tick(){var ms=active?base+(performance.now()-baseAt):base;document.getElementById('tc').textContent=fmt(ms)}
async function toggle(){await fetch('/api/record/toggle',{method:'POST'});setTimeout(refresh,200)}
async function mark(c){const b=document.getElementById('markfix');b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');
const res=await (await fetch('/api/marker?cat='+c,{method:'POST'})).json();
if(res&&res.ok){marks++;document.getElementById('count').textContent='סימונים בהקלטה: '+marks;}}
setInterval(refresh,1000);setInterval(tick,100);refresh();
</script></body></html>`
