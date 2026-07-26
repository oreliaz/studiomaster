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

const DOCK_HTML = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>StudioMaster</title><style>
:root{color-scheme:dark}body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0f1115;color:#e7ebf2;padding:12px}
.tc{font-size:34px;font-variant-numeric:tabular-nums;text-align:center;margin:4px 0;direction:ltr}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#262b36;margin-inline-end:6px}
.dot.live{background:#ef4444}
button{width:100%;border:none;border-radius:8px;padding:12px;font-size:15px;color:#fff;cursor:pointer;margin:4px 0}
.rec{background:#ef4444}.rec.on{background:#7f1d1d}
.row{display:flex;gap:6px}.row button{background:#222833;font-size:13px;padding:10px}
.status{font-size:12px;color:#8b93a4;text-align:center;margin-bottom:6px}
</style></head><body>
<div class="status" id="conn">…</div>
<div class="tc"><span class="dot" id="dot"></span><span id="tc">00:00:00.000</span></div>
<button class="rec" id="rec" onclick="toggle()">● התחל הקלטה</button>
<div class="row">
<button onclick="mark('fix')">תיקון</button>
<button onclick="mark('highlight')">הדגשה</button>
<button onclick="mark('chapter')">פרק</button>
</div>
<script>
async function refresh(){try{const s=await (await fetch('/api/state')).json();
document.getElementById('conn').textContent=s.connection.status==='connected'?'מחובר ל-OBS':'מנותק';
const r=s.record;document.getElementById('tc').textContent=r.timecode;
const rec=document.getElementById('rec');rec.textContent=r.active?'■ עצור הקלטה':'● התחל הקלטה';rec.className='rec'+(r.active?' on':'');
document.getElementById('dot').className='dot'+(r.active?' live':'')}catch(e){}}
async function toggle(){await fetch('/api/record/toggle',{method:'POST'});refresh()}
async function mark(c){await fetch('/api/marker?cat='+c,{method:'POST'})}
setInterval(refresh,500);refresh();
</script></body></html>`
