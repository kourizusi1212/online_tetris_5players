(() => {
"use strict";

const W = 10, H = 20, CELL = 30;
const COLORS = ["#26d8ee","#5472ff","#ff9e42","#ffe04a","#38d879","#ae62ff","#ff5878","#777"];
const SHAPES = [
  [[1,1,1,1]],
  [[1,0,0],[1,1,1]],
  [[0,0,1],[1,1,1]],
  [[1,1],[1,1]],
  [[0,1,1],[1,1,0]],
  [[0,1,0],[1,1,1]],
  [[1,1,0],[0,1,1]]
];

const $ = id => document.getElementById(id);
const boardCanvas = $("board"), ctx = boardCanvas.getContext("2d");
const nextCanvas = $("nextCanvas"), nctx = nextCanvas.getContext("2d");
const holdCanvas = $("holdCanvas"), hctx = holdCanvas.getContext("2d");

let ws = null;
let myId = "";
let roomCode = "";
let host = false;
let players = new Map();

let board = [];
let current = null;
let next = null;
let hold = null;
let canHold = true;
let score = 0, lines = 0, level = 1;
let running = false, gameOver = false, paused = false;
let lastTime = 0, fallTimer = 0;
let reconnectTimer = null;
let intentionalClose = false;

function emptyBoard(){ return Array.from({length:H}, () => Array(W).fill(0)); }
function cloneShape(shape){ return shape.map(r => r.slice()); }
function randomPiece(){
  const i = Math.floor(Math.random() * SHAPES.length);
  return { shape: cloneShape(SHAPES[i]), color: i + 1, x: 3, y: 0 };
}
function takeNext(){
  const p = next || randomPiece();
  next = randomPiece();
  return p;
}
function resetGame(){
  board = emptyBoard();
  score = 0; lines = 0; level = 1;
  next = randomPiece();
  hold = null; canHold = true;
  current = takeNext();
  running = false; gameOver = false; paused = false;
  $("gameMessage").classList.add("hidden");
  updateHud(); draw();
}
function collision(p, dx=0, dy=0, shape=p.shape){
  for(let y=0;y<shape.length;y++){
    for(let x=0;x<shape[y].length;x++){
      if(!shape[y][x]) continue;
      const nx = p.x + x + dx, ny = p.y + y + dy;
      if(nx < 0 || nx >= W || ny >= H) return true;
      if(ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}
function move(dx){
  if(!running || paused || gameOver) return;
  if(!collision(current,dx,0)){ current.x += dx; requestDraw(); }
}
function rotate(dir){
  if(!running || paused || gameOver) return;
  const old = cloneShape(current.shape);
  const m = current.shape;
  let rotated;
  if(dir > 0) rotated = m[0].map((_,i) => m.map(row => row[i]).reverse());
  else rotated = m[0].map((_,i) => m.map(row => row[m[0].length-1-i]));
  current.shape = rotated;
  if(collision(current)){
    let fixed = false;
    for(const kick of [-1,1,-2,2]){
      current.x += kick;
      if(!collision(current)){ fixed = true; break; }
      current.x -= kick;
    }
    if(!fixed) current.shape = old;
  requestDraw();
  }
}
function softDrop(){
  if(!running || paused || gameOver) return;
  if(!collision(current,0,1)){ current.y++; score++; requestDraw(); }
  else lockPiece();
  updateHud();
}
function hardDrop(){
  if(!running || paused || gameOver) return;
  let distance = 0;
  while(!collision(current,0,1)){ current.y++; distance++; }
  score += distance * 2;
  lockPiece();
  updateHud();
}
function holdPiece(){
  if(!running || paused || gameOver || !canHold) return;
  canHold = false;
  if(!hold){
    hold = {shape:cloneShape(current.shape), color:current.color};
    current = takeNext();
  }else{
    const old = {shape:cloneShape(current.shape), color:current.color};
    current = {shape:cloneShape(hold.shape), color:hold.color, x:3, y:0};
    hold = old;
  }
  if(collision(current)) finishGame();
  updateHud();
}
function lockPiece(){
  for(let y=0;y<current.shape.length;y++){
    for(let x=0;x<current.shape[y].length;x++){
      if(current.shape[y][x] && current.y+y >= 0 && current.x+x >= 0 && current.x+x < W)
        board[current.y+y][current.x+x] = current.color;
    }
  }

  let cleared = 0;
  for(let y=H-1;y>=0;y--){
    if(board[y].every(Boolean)){
      board.splice(y,1);
      board.unshift(Array(W).fill(0));
      cleared++; y++;
    }
  }
  if(cleared){
    lines += cleared;
    const points = [0,100,300,500,800][cleared] || 800;
    score += points * level;
    level = Math.floor(lines / 10) + 1;
    send({type:"score",score,lines});
    send({type:"garbage",lines:Math.min(4,cleared)});
  }
  current = takeNext();
  canHold = true;
  requestDraw();
  if(collision(current)) finishGame();
}
function addGarbage(count){
  for(let i=0;i<count;i++){
    board.shift();
    const hole = Math.floor(Math.random()*W);
    const row = Array(W).fill(8);
    row[hole] = 0;
    board.push(row);
  requestDraw();
  }
}
function finishGame(){
  gameOver = true; running = false;
  showMessage("GAME OVER");
  send({type:"alive",alive:false});
  send({type:"score",score,lines});
}
function showMessage(text){
  const el = $("gameMessage");
  el.textContent = text;
  el.classList.remove("hidden");
}
function clearMessage(){ $("gameMessage").classList.add("hidden"); }

function drawCell(c,x,y,color,size=CELL){
  if(y < 0) return;
  c.fillStyle = COLORS[color-1] || "#777";
  c.fillRect(x*size+1,y*size+1,size-2,size-2);
  c.fillStyle = "rgba(255,255,255,.20)";
  c.fillRect(x*size+3,y*size+3,size-6,5);
  c.strokeStyle = "rgba(0,0,0,.22)";
  c.strokeRect(x*size+1.5,y*size+1.5,size-3,size-3);
}
function drawMini(c, shape, color, size=20){
  c.clearRect(0,0,c.canvas.width,c.canvas.height);
  if(!shape) return;
  const width = shape[0].length*size;
  const height = shape.length*size;
  const ox = (c.canvas.width-width)/2, oy = (c.canvas.height-height)/2;
  shape.forEach((row,y)=>row.forEach((v,x)=>{
    if(v){
      c.fillStyle = COLORS[color-1] || "#777";
      c.fillRect(ox+x*size+1,oy+y*size+1,size-2,size-2);
    }
  }));
}
function draw(){
  ctx.clearRect(0,0,boardCanvas.width,boardCanvas.height);
  ctx.fillStyle="#060a13"; ctx.fillRect(0,0,300,600);
  ctx.strokeStyle="rgba(255,255,255,.055)"; ctx.lineWidth=1;
  for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*CELL+.5,0);ctx.lineTo(x*CELL+.5,600);ctx.stroke();}
  for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*CELL+.5);ctx.lineTo(300,y*CELL+.5);ctx.stroke();}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(board[y][x])drawCell(ctx,x,y,board[y][x]);
  if(current) current.shape.forEach((row,y)=>row.forEach((v,x)=>{if(v)drawCell(ctx,current.x+x,current.y+y,current.color)}));
  drawMini(nctx,next?.shape,next?.color);
  drawMini(hctx,hold?.shape,hold?.color);
}
let drawDirty = true;
function requestDraw(){ drawDirty = true; }
function updateHud(){
  $("scoreValue").textContent = score.toLocaleString();
  $("linesValue").textContent = lines;
  $("levelValue").textContent = level;
  requestDraw();
}
let lastRender = 0;
function loop(t){
  const dt = Math.min(100, t - lastTime || 0);
  lastTime = t;
  if(running && !paused && !gameOver){
    fallTimer += dt;
    const interval = Math.max(75, 800 - (level-1)*60);
    if(fallTimer >= interval){ softDrop(); fallTimer = 0; }
  }
  if(drawDirty && t-lastRender >= 16){
    draw();
    drawDirty = false;
    lastRender = t;
  }
  requestAnimationFrame(loop);
}

function send(obj){
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setStatus(text, good=false){
  $("connectionStatus").textContent = text;
  $("connectionStatus").classList.toggle("good",good);
}
function connect(){
  if(ws && (ws.readyState===WebSocket.OPEN || ws.readyState===WebSocket.CONNECTING)) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    setStatus("サーバーに接続しました。",true);
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    // If the user already joined, do not silently try to create a duplicate room.
  };
  ws.onmessage = event => {
    let m; try{m=JSON.parse(event.data)}catch{return;}
    handleMessage(m);
  };
  ws.onerror = () => setStatus("サーバーとの通信でエラーが発生しました。");
  ws.onclose = () => {
    if(intentionalClose) return;
    if(running){
      running=false;
      showMessage("サーバーとの接続が切れました");
    }else{
      setStatus("接続が切れました。再接続しています…");
    }
    if(!reconnectTimer) reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect()},1500);
  };
}
function handleMessage(m){
  switch(m.type){
    case "connected": break;
    case "joined":
      myId=m.id; roomCode=m.room;
      $("roomInput").value=roomCode;
      $("roomCode").textContent=roomCode;
      setStatus("ルームに入りました。",true);
      resetGame();
      break;
    case "room_state":
      roomCode=m.room || roomCode;
      players.clear();
      (m.players||[]).forEach(p=>players.set(p.id,p));
      host = players.get(myId)?.host === true;
      renderLobby();
      renderGamePlayers();
      if(!m.started && !$("gameScreen").classList.contains("hidden")){
        $("gameScreen").classList.add("hidden");
        $("lobbyScreen").classList.remove("hidden");
        running=false;
      }
      break;
    case "host_changed":
      break;
    case "game_start":
      resetGame();
      running=true;
      $("lobbyScreen").classList.add("hidden");
      $("gameScreen").classList.remove("hidden");
      $("gameRoomLabel").textContent=`ROOM ${roomCode}`;
      clearMessage();
      break;
    case "player_update":{
      const p=players.get(m.id);
      if(p){Object.assign(p,m);renderLobby();renderGamePlayers();}
      break;
    }
    case "garbage":
      if(running && !gameOver) {addGarbage(m.lines);updateHud();}
      break;
    case "error":
      setStatus(m.message || "エラーが発生しました。");
      break;
  }
}
function renderLobby(){
  $("roomPanel").classList.toggle("hidden", !roomCode);
  $("roomCode").textContent=roomCode || "----";
  $("countLabel").textContent=`${players.size} / ${5}`;
  const list=$("lobbyPlayers");
  list.innerHTML="";
  for(const p of players.values()){
    const el=document.createElement("div");
    el.className="lobby-player"+(p.id===myId?" me":"");
    el.innerHTML=`
      <div><div class="player-name">${escapeHtml(p.name)} ${p.id===myId?"(自分)":""}</div>
      <div class="player-meta">${p.host?"部屋主":"参加者"}</div></div>
      <div class="ready-dot ${p.ready?"":"wait"}">${p.ready?"✓ READY":"WAIT"}</div>`;
    list.appendChild(el);
  }
  const me=players.get(myId);
  $("readyBtn").textContent=me?.ready ? "READYを解除" : "READY";
  $("readyBtn").classList.toggle("off",!!me?.ready);
  $("lobbyStartBtn").classList.toggle("hidden",!host);
}
function renderGamePlayers(){
  const list=$("gamePlayers");
  list.innerHTML="";
  for(const p of players.values()){
    const el=document.createElement("div");
    el.className="opponent"+(p.id===myId?" me":"");
    const alive = p.alive !== false;
    const progress = Math.min(100,(p.lines||0)%10*10);
    el.innerHTML=`
      <div class="opponent-top"><div class="opponent-name">${escapeHtml(p.name)}${p.id===myId?" ★":""}</div>
      <div class="opponent-status ${alive?"":"dead"}">${alive?"PLAYING":"OUT"}</div></div>
      <div class="opponent-stats">SCORE ${Number(p.score||0).toLocaleString()}　LINES ${p.lines||0}</div>
      <div class="meter"><i style="width:${progress}%"></i></div>`;
    list.appendChild(el);
  }
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function name(){return $("nameInput").value.trim().slice(0,16)||"Player";}
function createRoom(){
  if(!ws || ws.readyState!==WebSocket.OPEN) return setStatus("サーバーへ接続中です。少し待ってください。");
  const requested=$("roomInput").value.replace(/\D/g,"").slice(0,4);
  send({type:"create",room:requested,name:name()});
  setStatus("ルームを作成しています…");
}
function joinRoom(){
  if(!ws || ws.readyState!==WebSocket.OPEN) return setStatus("サーバーへ接続中です。少し待ってください。");
  const code=$("roomInput").value.replace(/\D/g,"").slice(0,4);
  $("roomInput").value=code;
  if(code.length!==4) return setStatus("参加には4桁のルームコードが必要です。");
  send({type:"join",room:code,name:name()});
  setStatus("ルームに参加しています…");
}
function leave(){
  intentionalClose=true;
  send({type:"leave"});
  setTimeout(()=>location.reload(),100);
}
$("createBtn").onclick=createRoom;
$("joinBtn").onclick=joinRoom;
$("readyBtn").onclick=()=>send({type:"ready"});
$("lobbyStartBtn").onclick=()=>send({type:"start"});
$("backBtn").onclick=leave;
$("copyBtn").onclick=async()=>{
  try{
    await navigator.clipboard.writeText(roomCode);
    setStatus("ルームコードをコピーしました。",true);
  }catch{
    setStatus("コピーできませんでした。コードを手動でコピーしてください。");
  }
};
$("roomInput").addEventListener("input",()=>{$("roomInput").value=$("roomInput").value.replace(/\D/g,"").slice(0,4)});
$("roomInput").addEventListener("keydown",e=>{if(e.key==="Enter")joinRoom()});
$("nameInput").addEventListener("keydown",e=>{if(e.key==="Enter")createRoom()});

document.addEventListener("keydown",e=>{
  const tag=e.target?.tagName;
  if(tag==="INPUT" || tag==="TEXTAREA" || e.target?.isContentEditable) return;
  const key=e.key.toLowerCase();
  if(["a","d","z","c","w","s","q","p"," "].includes(key)) e.preventDefault();
  if(key==="a")move(-1);
  else if(key==="d")move(1);
  else if(key==="z")rotate(-1);
  else if(key==="c")rotate(1);
  else if(key==="s")softDrop();
  else if(key==="w" || key===" ")hardDrop();
  else if(key==="q")holdPiece();
  else if(key==="p" && running){paused=!paused; if(paused)showMessage("PAUSED");else clearMessage();}
});

connect();
resetGame();
requestAnimationFrame(loop);
})();