// mintows Browser Relay v0.47 - signaling/state relay only; WebRTC carries media directly.
const http=require('http');const fs=require('fs');const path=require('path');const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT||10000);const GATE=String(process.env.MINTOWS_GATE_PASSWORD||'').trim();
const TURN_URLS=String(process.env.MINTOWS_TURN_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
const TURN_USER=String(process.env.MINTOWS_TURN_USERNAME||'').trim();
const TURN_CRED=String(process.env.MINTOWS_TURN_CREDENTIAL||'').trim();
const ICE_POLICY=String(process.env.MINTOWS_ICE_TRANSPORT_POLICY||'all').trim()==='relay'?'relay':'all';
if(!GATE)console.warn('MINTOWS_GATE_PASSWORD is not set; authentication will fail.');
let agent=null,agentConnectedAt=null,agentLastMessageAt=null,agentAuthFailures=0,clientAuthFailures=0;const clients=new Map();
const remoteHtml=fs.readFileSync(path.join(__dirname,'remote.html'),'utf8');
function send(ws,obj){if(ws&&ws.readyState===1)try{ws.send(JSON.stringify(obj))}catch{}}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);
  if(u.pathname==='/'||u.pathname==='/remote'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(remoteHtml)}
  if(u.pathname==='/ice' && req.method==='POST'){
    let body=''; for await(const chunk of req) body+=chunk;
    try{
      const data=JSON.parse(body||'{}');
      if(!GATE || String(data.password||'')!==GATE){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'authentication failed'}));}
      const iceServers=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}];
      if(TURN_URLS.length && TURN_USER && TURN_CRED) iceServers.push({urls:TURN_URLS.length===1?TURN_URLS[0]:TURN_URLS,username:TURN_USER,credential:TURN_CRED});
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({ok:true,iceTransportPolicy:ICE_POLICY,iceServers,turnConfigured:TURN_URLS.length>0&&!!TURN_USER&&!!TURN_CRED,version:'0.47'}));
    }catch(e){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({ok:false,error:'bad request'}));}
  }
  if(u.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'mintows Browser Relay',version:'0.47',transport:'WebRTC',agentConnected:!!agent,clients:clients.size,agentConnectedAt,agentLastMessageAt,agentAuthFailures,clientAuthFailures,gateConfigured:!!GATE,gateLength:GATE.length,turnConfigured:TURN_URLS.length>0&&!!TURN_USER&&!!TURN_CRED,turnUrlCount:TURN_URLS.length,iceTransportPolicy:ICE_POLICY}))}
  res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({noServer:true,maxPayload:16*1024*1024});
server.on('upgrade',(req,socket,head)=>{let pathname='';try{pathname=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname}catch{socket.destroy();return}if(pathname!=='/ws'&&pathname!=='/agent'){socket.destroy();return}wss.handleUpgrade(req,socket,head,ws=>{ws._mintowsRole=pathname==='/agent'?'agent':'client';wss.emit('connection',ws,req)})});
wss.on('connection',(ws,req)=>{const role=ws._mintowsRole;console.log(`[${role.toUpperCase()}] connection`,req.socket.remoteAddress||'unknown');if(role==='agent'){let authed=false;ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(!authed){if(m.type!=='auth'||m.role!=='agent'||!GATE||String(m.password||'')!==GATE){agentAuthFailures++;send(ws,{type:'auth-error',error:'agent authentication failed'});return ws.close(1008,'authentication failed')}authed=true;if(agent&&agent!==ws)try{agent.close(4001,'replaced')}catch{}agent=ws;agentConnectedAt=new Date().toISOString();send(ws,{type:'auth-ok'});console.log('[AGENT] authenticated');return}agentLastMessageAt=new Date().toISOString();if(m.type==='state')for(const c of clients.values())send(c,m);else if(m.type==='webrtc-signal'){const c=clients.get(String(m.clientId||''));if(c)send(c,{type:'webrtc-signal',data:m.data})}else if(['file-chooser','file-upload-progress','file-uploaded','file-upload-error','file-download-start','file-download-chunk','file-download-end'].includes(m.type))for(const c of clients.values())send(c,m)}catch(e){console.warn('[AGENT] message error',e.message||e)}});ws.on('close',()=>{if(agent===ws)agent=null});return}
let authed=false;ws._clientId=require('crypto').randomUUID();ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(!authed){if(m.type!=='auth'||m.role!=='client'||!GATE||String(m.password||'')!==GATE){clientAuthFailures++;send(ws,{type:'auth-error',error:'ゲートパスワードが正しくありません'});return ws.close(1008,'authentication failed')}authed=true;clients.set(ws._clientId,ws);send(ws,{type:'auth-ok',clientId:ws._clientId});if(agent)send(agent,{type:'state-request'});console.log('[CLIENT] authenticated',ws._clientId);return}if(m.type==='webrtc-signal'){if(agent)send(agent,{type:'webrtc-signal',clientId:ws._clientId,data:m.data});return}if(agent&&agent.readyState===WebSocket.OPEN)send(agent,{type:'input',data:m});else send(ws,{type:'relay-error',error:'Windows Browser agent is offline'})}catch(e){console.warn('[CLIENT] message error',e.message||e)}});ws.on('close',()=>{clients.delete(ws._clientId);if(agent)send(agent,{type:'webrtc-client-left',clientId:ws._clientId})});});
server.listen(PORT,'0.0.0.0',()=>console.log(`mintows Browser Relay v0.47 listening on ${PORT}`));
