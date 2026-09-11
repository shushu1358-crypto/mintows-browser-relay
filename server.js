const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const GATE = String(process.env.MINTOWS_GATE_PASSWORD || '');
if (!GATE) console.warn('MINTOWS_GATE_PASSWORD is not set; all authentication attempts will fail.');
let agent = null;
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
    return res.end(JSON.stringify({ok:true,service:'mintows Browser Relay',agentConnected:!!agent,clients:clients.size}));
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({server, path:'/ws', maxPayload:8*1024*1024});
const agentWss = new WebSocketServer({server, path:'/agent', maxPayload:8*1024*1024});

agentWss.on('connection', ws=>{
  let authed=false;
  ws.on('message', raw=>{
    try {
      const m=JSON.parse(raw.toString());
      if(!authed){
        if(m.type!=='auth'||m.role!=='agent'||!GATE||String(m.password||'')!==GATE) return ws.close(1008,'authentication failed');
        authed=true;
        if(agent && agent!==ws) { try{agent.close();}catch{} }
        agent=ws; send(ws,{type:'auth-ok'}); return;
      }
      if(m.type==='frame') broadcast(m);
      else if(m.type==='state') broadcast(m);
    } catch(e) {}
  });
  ws.on('close',()=>{if(agent===ws) agent=null;});
});

wss.on('connection', ws=>{
  let authed=false;
  ws.on('message', raw=>{
    try{
      const m=JSON.parse(raw.toString());
      if(!authed){
        if(m.type!=='auth'||m.role!=='client'||!GATE||String(m.password||'')!==GATE){send(ws,{type:'auth-error',error:'ゲートパスワードが正しくありません'});return ws.close(1008,'authentication failed');}
        authed=true; clients.add(ws); send(ws,{type:'auth-ok'}); if(agent) send(agent,{type:'state-request'}); return;
      }
      if(agent && agent.readyState===1) agent.send(JSON.stringify({type:'input',data:m}));
    }catch(e){}
  });
  ws.on('close',()=>clients.delete(ws));
});

server.listen(PORT,'0.0.0.0',()=>console.log(`mintows Browser Relay listening on ${PORT}`));
