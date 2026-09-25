const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const rooms = new Map();

function send(ws, obj){ if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room,obj){ for(const p of room.players) send(p,obj); }
function roomState(room){
  return {type:"room", room:room.id, host:room.host, started:room.started,
    players:room.players.map(p=>({id:p.id,name:p.name,score:p.score||0,lines:p.lines||0,alive:p.alive!==false,ready:room.ready.has(p.id)}))};
}
function validCode(code){return /^\d{4}$/.test(code);}
function newCode(){
  for(let i=0;i<1000;i++){
    const code=String(Math.floor(1000+Math.random()*9000));
    if(!rooms.has(code)) return code;
  }
  return null;
}
function addPlayer(ws,room,name){
  if(room.players.length>=MAX_PLAYERS)return false;
  ws.room=room.id; ws.name=String(name||"Player").trim().slice(0,16)||"Player";
  ws.score=0; ws.lines=0; ws.alive=true;
  room.players.push(ws);
  if(!room.host) room.host=ws.id;
  send(ws,{type:"joined",id:ws.id,room:room.id,max:MAX_PLAYERS,host:room.host===ws.id});
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
  ws.id=Math.random().toString(36).slice(2,10); ws.room=null; ws.name="Player"; ws.score=0; ws.lines=0; ws.alive=true;
  send(ws,{type:"connected"});

  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw.toString())}catch{return send(ws,{type:"error",message:"通信データが正しくありません。"});}

    if(!ws.room && (m.type==="create"||m.type==="join")){
      const code=String(m.room||"").replace(/\D/g,"");
      if(m.type==="create"){
        const requested=code;
        if(requested && !validCode(requested)) return send(ws,{type:"error",message:"ルームコードは4桁の数字で入力してください。"});
        const id=requested||newCode();
        if(!id)return send(ws,{type:"error",message:"ルームを作成できません。少し待って再試行してください。"});
        if(rooms.has(id))return send(ws,{type:"error",message:"その部屋番号は使用中です。別の番号で作成してください。"});
        const room={id,players:[],ready:new Set(),started:false,host:null,createdAt:Date.now()};
        rooms.set(id,room); addPlayer(ws,room,m.name); return;
      }
      if(!validCode(code))return send(ws,{type:"error",message:"ルームコードは4桁の数字で入力してください。"});
      const room=rooms.get(code);
      if(!room)return send(ws,{type:"error",message:"その部屋は存在しません。作成者が先に部屋を作成してください。"});
      if(room.started)return send(ws,{type:"error",message:"その部屋はすでにゲーム中です。"});
      if(room.players.length>=MAX_PLAYERS)return send(ws,{type:"error",message:"この部屋は満員です（最大5人）。"});
      addPlayer(ws,room,m.name); return;
    }

    if(!ws.room)return;
    const room=rooms.get(ws.room); if(!room)return;

    if(m.type==="ready"&&!room.started){
      if(room.ready.has(ws.id))room.ready.delete(ws.id); else room.ready.add(ws.id);
      broadcast(room,roomState(room)); return;
    }
    if(m.type==="start"){
      if(ws.id!==room.host)return send(ws,{type:"error",message:"部屋主だけがゲームを開始できます。"});
      if(room.players.length<2)return send(ws,{type:"error",message:"2人以上で開始してください。"});
      if(room.players.some(p=>!room.ready.has(p.id)))return send(ws,{type:"error",message:"全員がREADYになってください。"});
      room.started=true; room.players.forEach(p=>{p.score=0;p.lines=0;p.alive=true});
      broadcast(room,{type:"start"}); broadcast(room,roomState(room)); return;
    }
    if(m.type==="score"&&room.started){ws.score=Number(m.score)||0;ws.lines=Number(m.lines)||0;broadcast(room,{type:"playerUpdate",id:ws.id,score:ws.score,lines:ws.lines,alive:ws.alive});return;}
    if(m.type==="garbage"&&room.started){for(const p of room.players)if(p!==ws&&p.alive!==false)send(p,{type:"garbage",lines:Math.max(0,Math.min(4,Number(m.lines)||0)),from:ws.id});return;}
    if(m.type==="alive"&&room.started){ws.alive=!!m.alive;broadcast(room,{type:"playerUpdate",id:ws.id,alive:ws.alive});return;}
    if(m.type==="gameover"&&room.started){ws.alive=false;broadcast(room,{type:"playerUpdate",id:ws.id,alive:false,score:ws.score,lines:ws.lines});}
  });

  ws.on("close",()=>{
    const code=ws.room;if(!code)return;
    const room=rooms.get(code);if(!room)return;
    room.players=room.players.filter(p=>p!==ws); room.ready.delete(ws.id);
    if(room.host===ws.id)room.host=room.players[0]?.id||null;
    if(room.players.length===0)rooms.delete(code); else broadcast(room,roomState(room));
  });
});

setInterval(()=>{
  for(const [code,room] of rooms){
    if(room.players.length===0)rooms.delete(code);
    else if(Date.now()-room.createdAt>1000*60*60*6 && !room.started)rooms.delete(code);
  }
},60000);

server.listen(PORT,()=>console.log(`Online Tetris server listening on ${PORT}`));
