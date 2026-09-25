const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 5;

function send(ws, data){ if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(room, data, except=null){
  for(const p of room.players) if(p.ws !== except) send(p.ws, data);
}
function roomState(room){
  return {
    type:"room",
    players: room.players.map(p=>({id:p.id,name:p.name,score:p.score||0,lines:p.lines||0,alive:p.alive!==false})),
    started: room.started
  };
}

const server = http.createServer((req,res)=>{
  let file = req.url === "/" ? "/index.html" : req.url;
  const safe = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const fp = path.join(__dirname,"public",safe);
  if(!fp.startsWith(path.join(__dirname,"public")) || !fs.existsSync(fp)){
    res.writeHead(404); return res.end("Not found");
  }
  const ext=path.extname(fp);
  const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});
  fs.createReadStream(fp).pipe(res);
});
const wss = new WebSocket.Server({server});

wss.on("connection", ws=>{
  ws.id=Math.random().toString(36).slice(2,9);
  ws.room=null; ws.name="Player"; ws.score=0; ws.lines=0; ws.alive=true;

  ws.on("message", raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="join"){
      const code=String(m.room||"").trim().toUpperCase().slice(0,12);
      if(!code) return send(ws,{type:"error",message:"ルームコードを入力してください"});
      let room=rooms.get(code);
      if(!room){room={players:[],started:false};rooms.set(code,room)}
      if(room.players.length>=MAX_PLAYERS) return send(ws,{type:"error",message:"このルームは満員です（最大5人）"});
      if(ws.room) return;
      ws.room=code; ws.name=String(m.name||"Player").slice(0,16); ws.score=0; ws.lines=0; ws.alive=true;
      room.players.push(ws);
      send(ws,{type:"joined",id:ws.id,room:code,max:MAX_PLAYERS});
      broadcast(room,roomState(room));
    }
    else if(m.type==="start" && ws.room){
      const room=rooms.get(ws.room); if(!room) return;
      room.started=true; room.players.forEach(p=>{p.score=0;p.lines=0;p.alive=true});
      broadcast(room,{type:"start"});
      broadcast(room,roomState(room));
    }
    else if(m.type==="score" && ws.room){
      const room=rooms.get(ws.room); if(!room) return;
      ws.score=Number(m.score)||0; ws.lines=Number(m.lines)||0;
      broadcast(room,{type:"playerUpdate",id:ws.id,score:ws.score,lines:ws.lines,alive:ws.alive});
    }
    else if(m.type==="garbage" && ws.room){
      const room=rooms.get(ws.room); if(!room) return;
      // A line clear sends garbage to every other alive player.
      for(const p of room.players){
        if(p!==ws && p.alive!==false) send(p,{type:"garbage",lines:Math.max(0,Math.min(4,Number(m.lines)||0)),from:ws.id});
      }
    }
    else if(m.type==="alive" && ws.room){
      ws.alive=!!m.alive;
      const room=rooms.get(ws.room);
      if(room){ broadcast(room,{type:"playerUpdate",id:ws.id,alive:ws.alive}); }
    }
    else if(m.type==="gameover" && ws.room){
      ws.alive=false;
      const room=rooms.get(ws.room);
      if(room){ broadcast(room,{type:"playerUpdate",id:ws.id,alive:false,score:ws.score,lines:ws.lines}); }
    }
  });

  ws.on("close",()=>{
    if(!ws.room)return;
    const room=rooms.get(ws.room);
    if(!room)return;
    room.players=room.players.filter(p=>p!==ws);
    if(room.players.length===0) rooms.delete(ws.room);
    else broadcast(room,roomState(room));
  });
});
server.listen(PORT,()=>console.log(`Online Tetris server listening on ${PORT}`));
