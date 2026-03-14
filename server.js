const WebSocket = require('ws');
const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req,res)=>{res.writeHead(200);res.end('Rekabet Server');});
const wss = new WebSocket.Server({server});
const rooms = {};
wss.on('connection',(ws)=>{
ws.alive=true;
ws.on('pong',()=>{ws.alive=true;});
ws.on('message',(raw)=>{
let d;try{d=JSON.parse(raw);}catch(e){return;}
if(d.type==='create'){
let code;do{code=Math.random().toString(36).substr(2,5).toUpperCase();}while(rooms[code]);
rooms[code]={players:[ws],ts:Date.now()};
ws.room=code;ws.team=d.team||0;
ws.send(JSON.stringify({type:'created',code,team:ws.team}));
}else if(d.type==='join'){
const r=rooms[d.code];
if(!r){ws.send(JSON.stringify({type:'error',msg:'Oda yok!'}));return;}
if(r.players.length>=2){ws.send(JSON.stringify({type:'error',msg:'Oda dolu!'}));return;}
r.players.push(ws);ws.room=d.code;ws.team=d.team||1;
ws.send(JSON.stringify({type:'joined',code:d.code,team:ws.team}));
r.players.forEach(p=>{if(p!==ws&&p.readyState===1)p.send(JSON.stringify({type:'guest_joined',team:ws.team}));});
}else if(ws.room&&rooms[ws.room]){
rooms[ws.room].players.forEach(p=>{if(p!==ws&&p.readyState===1)p.send(raw);});
}
});
ws.on('close',()=>{
if(ws.room&&rooms[ws.room]){
rooms[ws.room].players=rooms[ws.room].players.filter(p=>p!==ws);
rooms[ws.room].players.forEach(p=>{if(p.readyState===1)p.send(JSON.stringify({type:'disconnected'}));});
if(rooms[ws.room].players.length===0)delete rooms[ws.room];
}});
});
setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.alive){ws.terminate();return;}ws.alive=false;ws.ping();});},30000);
server.listen(PORT,()=>console.log('Rekabet Server:',PORT));
