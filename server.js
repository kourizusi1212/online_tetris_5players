const http=require("http"),fs=require("fs"),path=require("path"),WebSocket=require("ws");
const PORT=process.env.PORT||3000,rooms=new Map(),MAX=5;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split("?")[0]);if(u==="/")u="/index.html";const f=path.join(__dirname,"public",u);if(!f.startsWith(path.join(__dirname,"public"))){res.writeHead(403);return res.end()}fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end("Not found")}const t={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css"};res.writeHead(200,{"Content-Type":t[path.extname(f)]||"application/octet-stream"});res.end(d)})});
const wss=new WebSocket.Server({server});const send=(w,o)=>w.readyState===1&&w.send(JSON.stringify(o));const bc=(r,o)=>r.players.forEach(p=>send(p.ws,o));
wss.on("connection",ws=>{const p={ws,id:Math.random().toString(36).slice(2,9),room:null,name:"Player",score:0,lines:0,alive:true};
ws.on("message",b=>{let m;try{m=JSON.parse(b)}catch{return}
if(m.type==="join"){const c=String(m.room||"").trim().toUpperCase();if(!c)return send(ws,{type:"error",message:"ルームコードを入力してください。"});let r=rooms.get(c);if(!r)rooms.set(c,r={players:[]});if(r.players.length>=MAX)return send(ws,{type:"error",message:"満員です。"});p.room=c;p.name=String(m.name||"Player").slice(0,16);r.players.push(p);send(ws,{type:"joined",id:p.id,room:c});bc(r,{type:"players",players:r.players.map(x=>({id:x.id,name:x.name,score:x.score,lines:x.lines,alive:x.alive}))});return}
if(!p.room)return;const r=rooms.get(p.room);if(!r)return;
if(m.type==="start"){r.players.forEach(x=>{x.score=0;x.lines=0;x.alive=true});bc(r,{type:"start"})}
else if(m.type==="state"){p.score=+m.score||0;p.lines=+m.lines||0;p.alive=m.alive!==false;bc(r,{type:"opponentState",from:p.id,name:p.name,board:m.board,current:m.current,score:p.score,lines:p.lines,alive:p.alive})}
else if(m.type==="garbage"){const n=Math.max(0,Math.min(8,+m.amount||0));r.players.forEach(x=>x!==p&&x.alive&&send(x,{type:"garbage",amount:n}))}
else if(m.type==="gameover"){p.alive=false;bc(r,{type:"players",players:r.players.map(x=>({id:x.id,name:x.name,score:x.score,lines:x.lines,alive:x.alive}))})}
});
ws.on("close",()=>{if(!p.room)return;const r=rooms.get(p.room);if(!r)return;r.players=r.players.filter(x=>x!==p);if(r.players.length)bc(r,{type:"players",players:r.players.map(x=>({id:x.id,name:x.name,score:x.score,lines:x.lines,alive:x.alive}))});else rooms.delete(p.room)})});
server.listen(PORT,()=>console.log("Tetris server on "+PORT));