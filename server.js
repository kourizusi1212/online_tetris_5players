const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000), MAX=5;
const rooms=new Map();
const root=path.join(__dirname,'public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const id=()=>crypto.randomBytes(8).toString('hex');
const code=()=>{for(let i=0;i<100;i++){const c=String(1000+crypto.randomInt(9000));if(!rooms.has(c))return c}return null};
const send=(ws,m)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m))};
const clean=n=>String(n??'').trim().replace(/\s+/g,' ').slice(0,16)||'Player';
function snapshot(r){return {type:'room_state',room:r.code,started:r.started,winnerId:r.winnerId,players:r.players.map(p=>({id:p.id,name:p.name,score:p.score,lines:p.lines,alive:p.alive,ready:p.ready,host:p.id===r.host}))}}
function broadcast(r,m){r.players.forEach(p=>send(p.ws,m))}
function finishIfOne(r){if(!r.started)return;const alive=r.players.filter(p=>p.alive);if(alive.length===1){r.started=false;r.winnerId=alive[0].id;broadcast(r,{type:'winner',winnerId:alive[0].id,winnerName:alive[0].name});broadcast(r,snapshot(r))}}
function remove(ws){const r=ws.room&&rooms.get(ws.room);if(!r)return;const p=r.players.find(x=>x.ws===ws);if(r.started&&p){p.alive=false;send(ws,{type:'disconnected_game'});finishIfOne(r)};r.players=r.players.filter(x=>x.ws!==ws);if(r.host===ws.id)r.host=r.players[0]?.id||null;if(!r.players.length)rooms.delete(r.code);else {if(r.started)finishIfOne(r);broadcast(r,snapshot(r))}}
function join(ws,r,name){if(r.started)return send(ws,{type:'error',message:'この部屋はゲーム中です。'});if(r.players.length>=MAX)return send(ws,{type:'error',message:'満員です（最大5人）。'});const p={id:ws.id,ws,name:clean(name),score:0,lines:0,alive:true,ready:false,board:null,current:null,clearing:false};r.players.push(p);ws.room=r.code;if(!r.host)r.host=p.id;send(ws,{type:'joined',id:p.id,room:r.code});broadcast(r,snapshot(r))}
function create(ws,name){const c=code();if(!c)return send(ws,{type:'error',message:'ルームを作成できません。'});const r={code:c,players:[],host:null,started:false,winnerId:null};rooms.set(c,r);join(ws,r,name)}
function start(r,ws){if(ws.id!==r.host)return send(ws,{type:'error',message:'部屋主だけが開始できます。'});if(r.players.length<2)return send(ws,{type:'error',message:'2人以上で開始してください。'});r.started=true;r.winnerId=null;r.players.forEach(p=>{p.score=0;p.lines=0;p.alive=true;p.ready=false;p.board=null;p.current=null;p.clearing=false});broadcast(r,{type:'game_start'});broadcast(r,snapshot(r))}
const server=http.createServer((req,res)=>{let u=(req.url||'/').split('?')[0];if(u==='/')u='/index.html';const fp=path.resolve(root,'.'+u);if(fp!==root&&!fp.startsWith(root+path.sep))return res.writeHead(403).end();fs.stat(fp,(e,s)=>{if(e||!s.isFile())return res.writeHead(404).end('Not found');res.writeHead(200,{'Content-Type':mime[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(fp).pipe(res)})});
const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{ws.id=id();ws.room=null;send(ws,{type:'connected'});ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return send(ws,{type:'error',message:'通信データが不正です。'})}const t=m.type;if(t==='ping')return send(ws,{type:'pong'});if(!ws.room){if(t==='create')return create(ws,m.name);if(t==='join'){const c=String(m.room||'').replace(/\D/g,'').slice(0,4),r=rooms.get(c);if(!/^\d{4}$/.test(c))return send(ws,{type:'error',message:'4桁のルームコードを入力してください。'});if(!r)return send(ws,{type:'error',message:'そのルームはありません。'});return join(ws,r,m.name)}return}
const r=rooms.get(ws.room);if(!r)return;
const p=r.players.find(x=>x.ws===ws);if(!p)return;
if(t==='ready'){if(r.started)return;p.ready=!p.ready;return broadcast(r,snapshot(r))}
if(t==='start')return start(r,ws);
if(t==='board'){if(!r.started)return;if(Array.isArray(m.board)){p.board=m.board;p.current=m.current||null;p.clearing=!!m.clearing;for(const q of r.players)if(q!==p)send(q,{type:'board',id:p.id,board:p.board,current:p.current,clearing:p.clearing})}return}
if(t==='score'){if(!r.started)return;p.score=Math.max(0,Number(m.score)||0);p.lines=Math.max(0,Number(m.lines)||0);return broadcast(r,{type:'player_update',id:p.id,score:p.score,lines:p.lines,alive:p.alive})}
if(t==='garbage'){if(!r.started)return;const n=Math.max(0,Math.min(4,Number(m.lines)||0));if(n)r.players.filter(q=>q!==p&&q.alive).forEach(q=>send(q,{type:'garbage',lines:n,from:p.id}));return}
if(t==='alive'){if(!r.started)return;p.alive=!!m.alive;broadcast(r,{type:'player_update',id:p.id,score:p.score,lines:p.lines,alive:p.alive});return finishIfOne(r)}
if(t==='rematch'){if(r.started)return;r.winnerId=null;r.players.forEach(q=>{q.ready=false;q.score=0;q.lines=0;q.alive=true;q.board=null;q.current=null;q.clearing=false});return broadcast(r,snapshot(r))}
if(t==='leave')return ws.close();
});ws.on('close',()=>remove(ws))});
setInterval(()=>{for(const r of rooms.values())if(!r.players.length)rooms.delete(r.code)},60000);
server.listen(PORT,'0.0.0.0',()=>console.log('Online Tetris rebuilt listening on '+PORT));
