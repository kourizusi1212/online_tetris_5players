const W=10,H=20,S=30;
const COLORS=["#22d3ee","#4f6cff","#ff9f43","#f8dc3e","#38d66b","#a855f7","#ff4f70"];
const SHAPES=[
 [[1,1,1,1]], [[1,0,0],[1,1,1]], [[0,0,1],[1,1,1]], [[1,1],[1,1]],
 [[0,1,1],[1,1,0]], [[0,1,0],[1,1,1]], [[1,1,0],[0,1,1]]
];
const boardC=document.getElementById("board"),ctx=boardC.getContext("2d");
const nextC=document.getElementById("next"),nctx=nextC.getContext("2d");
const holdC=document.getElementById("hold"),hctx=holdC.getContext("2d");
let socket,room="",myId="",players={},board,cur,next,hold=null,canHold=true;
let score=0,lines=0,level=1,running=false,over=false,paused=false,last=0,fall=0;

function empty(){return Array.from({length:H},()=>Array(W).fill(0))}
function piece(){let i=Math.floor(Math.random()*7);return{shape:SHAPES[i].map(r=>r.slice()),color:i+1,x:3,y:0}}
function reset(){board=empty();score=lines=0;level=1;next=piece();hold=null;canHold=true;cur=take();over=false;paused=false;update()}
function take(){let p=next;next=piece();return p}
function rot(m){return m[0].map((_,i)=>m.map(r=>r[i]).reverse())}
function collision(p,dx=0,dy=0,shape=p.shape){
 for(let y=0;y<shape.length;y++)for(let x=0;x<shape[y].length;x++)if(shape[y][x]){
  let nx=p.x+x+dx,ny=p.y+y+dy;
  if(nx<0||nx>=W||ny>=H||(ny>=0&&board[ny][nx]))return true;
 }return false;
}
function move(dx){if(!running||paused)return;if(!collision(cur,dx,0))cur.x+=dx}
function rotate(dir){if(!running||paused)return;let old=cur.shape, r=dir<0?old[0].map((_,i)=>old.map(a=>a[a.length-1-i])):rot(old);cur.shape=r;
 if(collision(cur)){for(const k of [-1,1,-2,2]){cur.x+=k;if(!collision(cur))return;cur.x-=k}cur.shape=old}}
function soft(){if(!running||paused)return;if(!collision(cur,0,1)){cur.y++;score++}else lock()}
function hard(){if(!running||paused)return;let d=0;while(!collision(cur,0,1)){cur.y++;d++}score+=d*2;lock()}
function holdPiece(){if(!running||paused||!canHold)return;canHold=false;
 if(!hold){hold={shape:cur.shape.map(r=>r.slice()),color:cur.color};cur=take()}
 else{let t={shape:hold.shape.map(r=>r.slice()),color:hold.color,x:3,y:0};hold={shape:cur.shape.map(r=>r.slice()),color:cur.color};cur=t}
 if(collision(cur))endGame(); update()
}
function lock(){
 cur.shape.forEach((r,y)=>r.forEach((v,x)=>{if(v&&cur.y+y>=0)board[cur.y+y][cur.x+x]=cur.color}));
 let n=0;
 for(let y=H-1;y>=0;y--)if(board[y].every(Boolean)){board.splice(y,1);board.unshift(Array(W).fill(0));n++;y++}
 if(n){lines+=n;score += [0,100,300,500,800][n]*level;level=Math.floor(lines/10)+1;if(socket&&socket.readyState===1){socket.send(JSON.stringify({type:"score",score,lines}));socket.send(JSON.stringify({type:"garbage",lines:Math.min(4,n)}))}}
 cur=take();canHold=true;if(collision(cur))endGame();update()
}
function addGarbage(n){
 for(let i=0;i<n;i++){board.shift();let hole=Math.floor(Math.random()*W),r=Array(W).fill(8);r[hole]=0;board.push(r)}
}
function endGame(){over=true;running=false;document.getElementById("message").textContent="GAME OVER";if(socket)socket.send(JSON.stringify({type:"gameover"}))}
function drawCell(c,x,y,color,size=S){c.fillStyle=COLORS[color-1]||"#777";c.fillRect(x*size+1,y*size+1,size-2,size-2);c.fillStyle="#ffffff33";c.fillRect(x*size+3,y*size+3,size-6,5)}
function drawMini(c,sh,color,size=18){c.clearRect(0,0,c.canvas.width,c.canvas.height);if(!sh)return;let ox=(c.canvas.width-sh[0].length*size)/2,oy=(c.canvas.height-sh.length*size)/2;sh.forEach((r,y)=>r.forEach((v,x)=>{if(v){c.fillStyle=COLORS[color-1];c.fillRect(ox+x*size+1,oy+y*size+1,size-2,size-2)}}))}
function draw(){
 ctx.clearRect(0,0,300,600);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(board[y][x])drawCell(ctx,x,y,board[y][x]);
 if(cur)cur.shape.forEach((r,y)=>r.forEach((v,x)=>{if(v&&cur.y+y>=0)drawCell(ctx,cur.x+x,cur.y+y,cur.color)}));
 drawMini(nctx,next.shape,next.color,18);drawMini(hctx,hold&&hold.shape,hold&&hold.color,18);
 if(paused||over){ctx.fillStyle="#000b";ctx.fillRect(0,0,300,600);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="bold 28px system-ui";ctx.fillText(over?"GAME OVER":"PAUSED",150,290)}
}
function update(){document.getElementById("score").textContent=score;document.getElementById("lines").textContent=lines;document.getElementById("level").textContent=level;draw()}
function loop(t){let dt=t-last;last=t;if(running&&!paused&&!over){fall+=dt;if(fall>Math.max(80,750-(level-1)*55)){soft();fall=0}}update();requestAnimationFrame(loop)}
function renderPlayers(){let el=document.getElementById("playerList");el.innerHTML="";
 Object.values(players).forEach(p=>{let d=document.createElement("div");d.className="player"+(p.id===myId?" me":"")+(p.alive===false?" dead":"");d.innerHTML=`<b>${esc(p.name)}</b><br><small>${p.alive===false?"脱落":"プレイ中"}　スコア ${p.score||0}</small><div class="bar"><i style="width:${Math.min(100,(p.lines||0)%100)}%"></i></div>`;el.appendChild(d)})
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function startGame(){if(socket?.readyState===1)socket.send(JSON.stringify({type:"start"}))}
function openRoom(mode){
 const name=document.getElementById("name").value.trim()||"Player";
 let code=document.getElementById("room").value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);
 if(mode==="create"){
   code="";
 }else if(!code){
   document.getElementById("lobbyMsg").textContent="参加するルームコードを入力してください。";
   return;
 }

 const proto=location.protocol==="https:"?"wss":"ws";
 socket=new WebSocket(`${proto}://${location.host}`);
 document.getElementById("createRoom").disabled=true;
 document.getElementById("join").disabled=true;
 document.getElementById("lobbyMsg").textContent=mode==="create"?"ルームを作成しています…":"ルームに接続しています…";

 socket.onopen=()=>{
   socket.send(JSON.stringify({type:mode,room:code,name}));
 };
 socket.onmessage=e=>{
  let m=JSON.parse(e.data);
  if(m.type==="joined"){
    myId=m.id; room=m.room;
    document.getElementById("room").value=m.room;
    document.getElementById("roomLabel").textContent=`ROOM: ${m.room}`;
    document.getElementById("lobby").classList.add("hidden");
    document.getElementById("gameUI").classList.remove("hidden");
    reset();
    if(m.created) document.getElementById("message").textContent=`ルーム作成完了！ コード: ${m.room}`;
  }
  if(m.type==="room"){players={};m.players.forEach(p=>players[p.id]=p);renderPlayers()}
  if(m.type==="start"){reset();running=true;document.getElementById("message").textContent=""}
  if(m.type==="playerUpdate"){if(players[m.id])Object.assign(players[m.id],m);renderPlayers()}
  if(m.type==="garbage"){addGarbage(m.lines);update()}
  if(m.type==="error"){
    document.getElementById("lobbyMsg").textContent=m.message;
    document.getElementById("createRoom").disabled=false;
    document.getElementById("join").disabled=false;
    if(socket && socket.readyState===WebSocket.OPEN) socket.close();
  }
 };
 socket.onclose=()=>{
   document.getElementById("createRoom").disabled=false;
   document.getElementById("join").disabled=false;
   if(!document.getElementById("gameUI").classList.contains("hidden")) document.getElementById("message").textContent="サーバーから切断されました";
 };
}

document.getElementById("createRoom").onclick=()=>openRoom("create");document.getElementById("join").onclick=()=>openRoom("join");document.getElementById("startBtn").onclick=startGame;
document.addEventListener("keydown",e=>{
 if(["a","d","w","s","z","c","q"," ","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key.toLowerCase()))e.preventDefault();
 switch(e.key.toLowerCase()){
  case"a":move(1);break; case"d":move(-1);break; case"z":rotate(-1);break; case"c":rotate(1);break;
  case"w":case" ":hard();break; case"s":soft();break; case"q":holdPiece();break;
  case"p":if(running)paused=!paused;break;
 }
});
reset();requestAnimationFrame(loop);
