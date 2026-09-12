const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const GATE = String(process.env.MINTOWS_GATE_PASSWORD || '').trim();
if (!GATE) console.warn('MINTOWS_GATE_PASSWORD is not set; all authentication attempts will fail.');
let agent = null;
let agentConnectedAt = null;
let agentLastMessageAt = null;
let agentAuthFailures = 0;
let clientAuthFailures = 0;
const clients = new Set();
const remoteHtml = fs.readFileSync(path.join(__dirname, 'remote.html'), 'utf8');

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj) { for (const ws of clients) send(ws, obj); }

const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/remote') {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return res.end(remoteHtml);
  }
  if (url.pathname === '/health') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ok:true,service:'mintows Browser Relay',agentConnected:!!agent,clients:clients.size,agentConnectedAt,agentLastMessageAt,agentAuthFailures,clientAuthFailures,gateConfigured:!!GATE,gateLength:GATE.length}));
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8*1024*1024 });

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; }
  catch { socket.destroy(); return; }

  if (pathname !== '/ws' && pathname !== '/agent') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws._mintowsRole = pathname === '/agent' ? 'agent' : 'client';
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const role = ws._mintowsRole;
  console.log(`[${role.toUpperCase()}] WebSocket connection from`, req.socket.remoteAddress || 'unknown', 'path=', req.url);

  if (role === 'agent') {
    let authed = false;
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw.toString());
        if (!authed) {
          if (m.type !== 'auth' || m.role !== 'agent' || !GATE || String(m.password || '') !== GATE) {
            agentAuthFailures++;
            console.warn('[AGENT] authentication failed; receivedLength=', String(m.password || '').length, 'expectedLength=', GATE.length);
            try { ws.send(JSON.stringify({type:'auth-error', error:'agent authentication failed'})); } catch {}
            return ws.close(1008, 'authentication failed');
          }
          authed = true;
          if (agent && agent !== ws) { try { agent.close(4001, 'replaced by new agent'); } catch {} }
          agent = ws;
          agentConnectedAt = new Date().toISOString();
          send(ws, {type:'auth-ok'});
          console.log('[AGENT] authenticated; agentConnected=true');
          return;
        }
        agentLastMessageAt = new Date().toISOString();
        if (m.type === 'frame' || m.type === 'state' || m.type === 'audio') broadcast(m);
      } catch (e) {
        console.warn('[AGENT] message error:', e.message || e);
      }
    });
    ws.on('error', err => console.warn('[AGENT] socket error:', err.message || err));
    ws.on('close', (code, reason) => {
      console.log('[AGENT] closed', code, String(reason || ''));
      if (agent === ws) agent = null;
    });
    return;
  }

  let authed = false;
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw.toString());
      if (!authed) {
        if (m.type !== 'auth' || m.role !== 'client' || !GATE || String(m.password || '') !== GATE) {
          clientAuthFailures++;
          console.warn('[CLIENT] authentication failed; receivedLength=', String(m.password || '').length, 'expectedLength=', GATE.length);
          send(ws, {type:'auth-error', error:'ゲートパスワードが正しくありません'});
          return ws.close(1008, 'authentication failed');
        }
        authed = true;
        clients.add(ws);
        console.log('[CLIENT] authenticated; clients=', clients.size, 'agentConnected=', !!agent);
        send(ws, {type:'auth-ok'});
        if (agent) send(agent, {type:'state-request'});
        return;
      }
      if (agent && agent.readyState === WebSocket.OPEN) {
        agent.send(JSON.stringify({type:'input', data:m}));
      } else {
        send(ws, {type:'relay-error', error:'Windows Browser agent is offline'});
      }
    } catch (e) {
      console.warn('[CLIENT] message error:', e.message || e);
    }
  });
  ws.on('error', err => console.warn('[CLIENT] socket error:', err.message || err));
  ws.on('close', (code, reason) => {
    clients.delete(ws);
    console.log('[CLIENT] closed', code, String(reason || ''));
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`mintows Browser Relay listening on ${PORT}`));
