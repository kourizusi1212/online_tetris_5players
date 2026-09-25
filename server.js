const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 5;

function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(room, data, except = null) { for (const p of room.players) if (p.ws !== except) send(p.ws, data); }
function roomState(room) {
  return { type:"room", players:room.players.map(p=>({id:p.id,name:p.name,score:p.score||0,lines:p.lines||0,alive:p.alive!==false})), started:room.started };
}
function validCode(code){ return /^\d{6}$/.test(code); }
function newCode(){
  for(let i=0;i<1000;i++){
    const code=String(Math.floor(100000+Math.random()*900000));
    if(!rooms.has(code)) return code;
  }
  return null;
}
function addPlayer(ws, room, name, code){
  if(room.players.length>=MAX_PLAYERS) return false;
  ws.room=code; ws.name=String(name||"Player").slice(0,16); ws.score=0; ws.lines=0; ws.alive=true;
  room.players.push(ws);
  send(ws,{type:"joined",id:ws.id,room:code,max:MAX_PLAYERS});
  broadcast(room,roomState(room));
  return true;
}

const server=http.createServer((req,res)=>{
  let file=req.url==="/"?"/index.html":req.url.split("?")[0];
  const safe=path.normalize(file).replace(/^([.][.][\\/])+/,"");
  const root=path.join(__dirname,"public");
  const fp=path.join(root,safe);
  if(!fp.startsWith(root)||!fs.existsSync(fp)){res.writeHead(404);return res.end("Not found");}
  const ext=path.extname(fp);
  const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});
  fs.createReadStream(fp).pipe(res);
});
const wss=new WebSocket.Server({server});

wss.on("connection",ws=>{
  ws.id=Math.random().toString(36).slice(2,9); ws.room=null; ws.name="Player"; ws.score=0; ws.lines=0; ws.alive=true;
  send(ws,{type:"connected"});

  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return send(ws,{type:"error",message:"通信データが正しくありません"});}

    if(m.type==="create"){
      if(ws.room) return send(ws,{type:"error",message:"すでにルームに参加しています"});
      const code=newCode();
      if(!code) return send(ws,{type:"error",message:"ルームを作成できません。少し待って再試行してください"});
      const room={players:[],started:false,createdAt:Date.now()}; rooms.set(code,room);
      addPlayer(ws,room,m.name,code);
      return;
    }

    if(m.type==="join"){
      if(ws.room) return send(ws,{type:"error",message:"すでにルームに参加しています"});
      const code=String(m.room||"").trim();
      if(!validCode(code)) return send(ws,{type:"error",message:"ルームコードは6桁の数字で入力してください"});
      const room=rooms.get(code);
      if(!room) return send(ws,{type:"error",message:"そのルームは存在しません。作成者が先にルームを作成・参加してください"});
      if(room.started) return send(ws,{type:"error",message:"このルームはすでにゲーム中です"});
      if(room.players.length>=MAX_PLAYERS) return send(ws,{type:"error",message:"このルームは満員です（最大5人）"});
      addPlayer(ws,room,m.name,code);
      return;
    }

    if(m.type==="start"&&ws.room){const room=rooms.get(ws.room);if(!room)return;room.started=true;room.players.forEach(p=>{p.score=0;p.lines=0;p.alive=true});broadcast(room,{type:"start"});broadcast(room,roomState(room));return;}
    if(m.type==="score"&&ws.room){const room=rooms.get(ws.room);if(!room)return;ws.score=Number(m.score)||0;ws.lines=Number(m.lines)||0;broadcast(room,{type:"playerUpdate",id:ws.id,score:ws.score,lines:ws.lines,alive:ws.alive});return;}
    if(m.type==="garbage"&&ws.room){const room=rooms.get(ws.room);if(!room)return;for(const p of room.players)if(p!==ws&&p.alive!==false)send(p,{type:"garbage",lines:Math.max(0,Math.min(4,Number(m.lines)||0)),from:ws.id});return;}
    if(m.type==="alive"&&ws.room){ws.alive=!!m.alive;const room=rooms.get(ws.room);if(room)broadcast(room,{type:"playerUpdate",id:ws.id,alive:ws.alive});return;}
    if(m.type==="gameover"&&ws.room){ws.alive=false;const room=rooms.get(ws.room);if(room)broadcast(room,{type:"playerUpdate",id:ws.id,alive:false,score:ws.score,lines:ws.lines});}
  });

  ws.on("close",()=>{
    const code=ws.room;if(!code)return;
    const room=rooms.get(code);if(!room)return;
    room.players=room.players.filter(p=>p!==ws);
    if(room.players.length===0) rooms.delete(code); else broadcast(room,roomState(room));
  });
});

server.listen(PORT,()=>console.log(`Online Tetris server listening on ${PORT}`));
