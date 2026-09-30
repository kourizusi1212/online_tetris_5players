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
let lastBoardSync = 0;

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
let gameMode = "select";
let clearingRows = [];
let clearAnimStart = 0;
let clearAnimDuration = 260;
let pendingCleared = 0;

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
  $("rematchBtn").classList.add("hidden");
  $("rematchBtn").textContent = gameMode === "single" ? "もう一度プレイ" : "再戦する";
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
  }
  requestDraw();
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
  if(clearingRows.length) return;
  for(let y=0;y<current.shape.length;y++){
    for(let x=0;x<current.shape[y].length;x++){
      if(current.shape[y][x] && current.y+y >= 0 && current.x+x >= 0 && current.x+x < W)
        board[current.y+y][current.x+x] = current.color;
    }
  }

  const rows = [];
  for(let y=0;y<H;y++) if(board[y].every(Boolean)) rows.push(y);

  if(rows.length){
    clearingRows = rows;
    pendingCleared = rows.length;
    clearAnimStart = performance.now();
    requestDraw();
    return;
  }

  spawnNextPiece();
}
function spawnNextPiece(){
  current = takeNext();
  canHold = true;
  requestDraw();
  if(collision(current)) finishGame();
}
function finishLineClear(){
  const cleared = pendingCleared;
  // 下の行から消して、上から空行を追加
  for(let i=clearingRows.length-1;i>=0;i--) board.splice(clearingRows[i],1);
  while(board.length < H) board.unshift(Array(W).fill(0));
  clearingRows = [];
  pendingCleared = 0;

  lines += cleared;
  const points = [0,100,300,500,800][cleared] || 800;
  score += points * level;
  level = Math.floor(lines / 10) + 1;
  if(gameMode === "online") {
    send({type:"score",score,lines});
    send({type:"garbage",lines:Math.min(4,cleared)});
  }
  spawnNextPiece();
  updateHud();
}
function getGhostY(){
  if(!current) return 0;
  let y = current.y;
  while(!collision({...current,y},0,1)) y++;
  return y;
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
  showMessage(gameMode === "single" ? "GAME OVER" : "GAME OVER");
  if(gameMode === "online") {
    send({type:"alive",alive:false});
    send({type:"score",score,lines});
  } else {
    $("rematchBtn").textContent = "もう一度プレイ";
    $("rematchBtn").classList.remove("hidden");
  }
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

  // ゴーストブロック：実際に着地する位置を半透明で表示
  if(current && !clearingRows.length){
    const gy = getGhostY();
    current.shape.forEach((row,y)=>row.forEach((v,x)=>{
      if(!v || gy+y < 0) return;
      const px=(current.x+x)*CELL+2, py=(gy+y)*CELL+2;
      ctx.fillStyle = "rgba(255,255,255,.10)";
      ctx.fillRect(px,py,CELL-4,CELL-4);
      ctx.strokeStyle = "rgba(255,255,255,.42)";
      ctx.lineWidth = 2;
      ctx.strokeRect(px,py,CELL-4,CELL-4);
    }));
  }

  if(current && !clearingRows.length) current.shape.forEach((row,y)=>row.forEach((v,x)=>{if(v)drawCell(ctx,current.x+x,current.y+y,current.color)}));

  // ライン消去演出：点滅→白い光が広がる
  if(clearingRows.length){
    const elapsed = performance.now() - clearAnimStart;
    const progress = Math.min(1, elapsed / clearAnimDuration);
    const pulse = 0.45 + Math.sin(progress * Math.PI * 4) * 0.25;
    clearingRows.forEach(y=>{
      ctx.fillStyle = `rgba(255,255,255,${Math.max(.18,pulse)})`;
      ctx.fillRect(0,y*CELL,300,CELL);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0,0.75-progress*.65)})`;
      const w = 300 * progress;
      ctx.fillRect((300-w)/2,y*CELL+3,w,CELL-6);
    });
  }

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

  if(clearingRows.length){
    requestDraw();
    if(t - clearAnimStart >= clearAnimDuration) finishLineClear();
  } else if(running && !paused && !gameOver){
    fallTimer += dt;
    const interval = Math.max(75, 800 - (level-1)*60);
    if(fallTimer >= interval){ softDrop(); fallTimer = 0; }
  }

  syncBoard(t);

  if(drawDirty && t-lastRender >= 16){
    draw();
    drawDirty = false;
    lastRender = t;
  }
  requestAnimationFrame(loop);
}

function syncBoard(now=performance.now(), force=false){
  if(gameMode !== "online") return;
  if(!running || gameOver || !ws || ws.readyState!==WebSocket.OPEN) return;
  if(!force && now-lastBoardSync<80) return;
  lastBoardSync=now;
  send({type:"board_state", board:board, current: current ? {shape:current.shape,x:current.x,y:current.y,color:current.color}:null});
}

function send(obj){
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setStatus(text, good=false){
  $("connectionStatus").textContent = text;
  $("connectionStatus").classList.toggle("good",good);
}
function enterSingleMode(){
  gameMode = "single";
  $("modeScreen").classList.add("hidden");
  $("lobbyScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  $("gameRoomLabel").textContent = "SINGLE PLAYER";
  $("backBtn").textContent = "モード選択へ";
  $("rematchBtn").textContent = "もう一度プレイ";
  resetGame();
  running = true;
  clearMessage();
}
function enterOnlineMode(){
  gameMode = "online";
  $("modeScreen").classList.add("hidden");
  $("gameScreen").classList.add("hidden");
  $("lobbyScreen").classList.remove("hidden");
  $("backBtn").textContent = "ロビーへ戻る";
  setStatus("オンラインモード");
}
function returnToModeSelect(){
  if(gameMode === "online" && ws && ws.readyState === WebSocket.OPEN && roomCode){
    intentionalClose=true;
    send({type:"leave"});
  }
  gameMode="select"; roomCode=""; host=false; players.clear(); running=false; gameOver=false;
  $("gameScreen").classList.add("hidden");
  $("lobbyScreen").classList.add("hidden");
  $("modeScreen").classList.remove("hidden");
  $("roomPanel").classList.add("hidden");
  $("roomCode").textContent="----";
  $("countLabel").textContent="0 / 5";
  $("lobbyPlayers").innerHTML="";
  setStatus("オンラインを選ぶとサーバーに接続します。");
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
  if(gameMode !== "online" && m.type !== "connected") return;
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
    case "game_winner": {
      gameOver = true;
      running = false;
      const isWinner = m.winnerId === myId;
      showMessage(isWinner ? "🎉 勝利！" : `🏆 ${escapeHtml(m.winnerName || "Player")} の勝利！`);
      $("rematchBtn").classList.remove("hidden");
      break;
    }
    case "game_start":
      resetGame();
      running=true;
      $("lobbyScreen").classList.add("hidden");
      $("gameScreen").classList.remove("hidden");
      $("gameRoomLabel").textContent=`ROOM ${roomCode}`;
      clearMessage();
      lastBoardSync=0;
      syncBoard(performance.now(),true);
      break;
    case "player_update":{
      const p=players.get(m.id);
      if(p){Object.assign(p,m);renderLobby();renderGamePlayers();}
      break;
    }
    case "board_state": {
      const p=players.get(m.id);
      if(p){ p.board=Array.isArray(m.board)?m.board:p.board; p.current=m.current||null; renderGamePlayers(); }
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
function drawOpponentBoard(canvas, p){
  const c = canvas.getContext("2d");
  const bw = 10, bh = 20;
  const size = Math.floor(Math.min(canvas.width / bw, canvas.height / bh));
  const ox = Math.floor((canvas.width - bw*size)/2);
  const oy = Math.floor((canvas.height - bh*size)/2);
  c.clearRect(0,0,canvas.width,canvas.height);
  c.fillStyle="#060a13"; c.fillRect(0,0,canvas.width,canvas.height);
  c.strokeStyle="rgba(255,255,255,.08)"; c.lineWidth=1;
  for(let x=0;x<=bw;x++){c.beginPath();c.moveTo(ox+x*size+.5,oy);c.lineTo(ox+x*size+.5,oy+bh*size);c.stroke();}
  for(let y=0;y<=bh;y++){c.beginPath();c.moveTo(ox,oy+y*size+.5);c.lineTo(ox+bw*size,oy+y*size+.5);c.stroke();}
  const b=Array.isArray(p.board)?p.board:[];
  for(let y=0;y<Math.min(bh,b.length);y++) for(let x=0;x<bw;x++) if(b[y]&&b[y][x]) drawCellMini(c,ox+x*size,oy+y*size,size,b[y][x]);
  const cur=p.current;
  if(cur && Array.isArray(cur.shape)){
    cur.shape.forEach((row,y)=>row.forEach((v,x)=>{
      if(v && cur.y+y>=0) drawCellMini(c,ox+(cur.x+x)*size,oy+(cur.y+y)*size,size,cur.color);
    }));
  }
}
function drawCellMini(c,x,y,size,color){
  c.fillStyle=COLORS[color-1]||"#777";
  c.fillRect(x+1,y+1,size-2,size-2);
  c.fillStyle="rgba(255,255,255,.18)";
  c.fillRect(x+3,y+3,Math.max(1,size-6),Math.max(2,Math.floor(size*.15)));
}

function renderGamePlayers(){
  const list=$("gamePlayers");
  list.innerHTML="";
  // 右側には自分自身を表示せず、対戦相手だけを表示する
  for(const p of players.values()){
    if(p.id===myId) continue;
    const el=document.createElement("div");
    el.className="opponent"+(p.id===myId?" me":"");
    const alive=p.alive!==false;
    el.innerHTML=`
      <div class="opponent-top"><div class="opponent-name">${escapeHtml(p.name)}${p.id===myId?" ★":""}</div>
      <div class="opponent-status ${alive?"":"dead"}">${alive?"PLAYING":"OUT"}</div></div>
      <canvas class="opponent-board" width="120" height="240"></canvas>
      <div class="opponent-stats">SCORE ${Number(p.score||0).toLocaleString()}　LINES ${p.lines||0}</div>`;
    list.appendChild(el);
    drawOpponentBoard(el.querySelector("canvas"),p);
  }
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function name(){return $("nameInput").value.trim().slice(0,16)||"Player";}
function createRoom(){
  if(gameMode !== "online") return;
  if(!ws || ws.readyState!==WebSocket.OPEN) return setStatus("サーバーへ接続中です。少し待ってください。");
  const requested=$("roomInput").value.replace(/\D/g,"").slice(0,4);
  send({type:"create",room:requested,name:name()});
  setStatus("ルームを作成しています…");
}
function joinRoom(){
  if(gameMode !== "online") return;
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
$("singleModeBtn").onclick=enterSingleMode;
$("onlineModeBtn").onclick=()=>{ enterOnlineMode(); connect(); };
$("createBtn").onclick=createRoom;
$("joinBtn").onclick=joinRoom;
$("readyBtn").onclick=()=>send({type:"ready"});
$("lobbyStartBtn").onclick=()=>send({type:"start"});
$("rematchBtn").onclick=()=>{ if(gameMode === "single"){ enterSingleMode(); } else send({type:"restart"}); };
$("backBtn").onclick=()=>{ if(gameMode === "online" && roomCode) { leave(); } else returnToModeSelect(); };
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
  const handled = ["a","d","z","c","w","s","q","p"," ","arrowleft","arrowright","arrowup","arrowdown"].includes(key);
  if(handled) e.preventDefault();

  // キーボード + 十字キーの両方に対応
  if(key==="a" || key==="arrowleft") move(-1);
  else if(key==="d" || key==="arrowright") move(1);
  else if(key==="z") rotate(-1);
  else if(key==="c" || key==="arrowup") rotate(1);
  else if(key==="s" || key==="arrowdown") softDrop();
  else if(key==="w" || key===" ") hardDrop();
  else if(key==="q") holdPiece();
  else if(key==="p" && running){
    paused=!paused;
    if(paused) showMessage("PAUSED"); else clearMessage();
  }
});

resetGame();
requestAnimationFrame(loop);
})();