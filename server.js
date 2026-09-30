const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 5;
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data) {
  for (const p of room.players) send(p, data);
}
function cleanName(value) {
  const n = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
  return n || "Player";
}
function validCode(code) {
  return /^[0-9]{4}$/.test(code);
}
function makeId() {
  return crypto.randomBytes(8).toString("hex");
}
function makeRoomCode() {
  for (let i = 0; i < 2000; i++) {
    const code = String(1000 + crypto.randomInt(9000));
    if (!rooms.has(code)) return code;
  }
  return null;
}
function publicPlayer(p, room) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    lines: p.lines,
    alive: p.alive,
    board: p.board || null,
    ready: room.ready.has(p.id),
    host: room.host === p.id
  };
}
function roomState(room) {
  return {
    type: "room_state",
    room: room.code,
    started: room.started,
    players: room.players.map(p => publicPlayer(p, room))
  };
}
function removePlayer(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;

  room.ready.delete(ws.id);
  room.players = room.players.filter(p => p !== ws);

  if (room.host === ws.id) {
    room.host = room.players[0]?.id || null;
    if (room.host) {
      const newHost = room.players.find(p => p.id === room.host);
      if (newHost) send(newHost, { type: "host_changed" });
    }
  }

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  broadcast(room, roomState(room));
}
function joinRoom(ws, room, name) {
  if (room.started) return send(ws, { type: "error", message: "その部屋はすでにゲーム中です。" });
  if (room.players.length >= MAX_PLAYERS) return send(ws, { type: "error", message: "この部屋は満員です（最大5人）。" });

  ws.roomCode = room.code;
  ws.name = cleanName(name);
  ws.score = 0;
  ws.lines = 0;
  ws.alive = true;
  ws.board = null;

  room.players.push(ws);
  if (!room.host) room.host = ws.id;

  send(ws, { type: "joined", room: room.code, id: ws.id });
  broadcast(room, roomState(room));
}
function createRoom(ws, requestedCode, name) {
  let code = requestedCode;
  if (code && !validCode(code)) {
    return send(ws, { type: "error", message: "ルームコードは4桁の数字で入力してください。" });
  }
  if (!code) code = makeRoomCode();
  if (!code) return send(ws, { type: "error", message: "ルームを作成できません。少し待って再試行してください。" });
  if (rooms.has(code)) return send(ws, { type: "error", message: "そのルームコードは使用中です。" });

  const room = {
    code,
    players: [],
    host: null,
    ready: new Set(),
    started: false,
    winnerId: null,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  joinRoom(ws, room, name);
}

const root = path.join(__dirname, "public");
const server = http.createServer((req, res) => {
  let requestPath = (req.url || "/").split("?")[0];
  if (requestPath === "/") requestPath = "/index.html";

  let decoded;
  try { decoded = decodeURIComponent(requestPath); }
  catch { res.writeHead(400); return res.end("Bad request"); }

  const filePath = path.resolve(root, "." + decoded);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  ws.id = makeId();
  ws.roomCode = null;
  ws.name = "Player";
  ws.score = 0;
  ws.lines = 0;
  ws.alive = true;
  ws.isAlive = true;

  send(ws, { type: "connected" });

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: "error", message: "通信データが正しくありません。" }); }

    const type = String(msg.type || "");

    if (type === "ping") return send(ws, { type: "pong" });

    if (!ws.roomCode) {
      if (type === "create") return createRoom(ws, String(msg.room || "").replace(/\D/g, "").slice(0, 4), msg.name);
      if (type === "join") {
        const code = String(msg.room || "").replace(/\D/g, "").slice(0, 4);
        if (!validCode(code)) return send(ws, { type: "error", message: "4桁のルームコードを入力してください。" });
        const room = rooms.get(code);
        if (!room) return send(ws, { type: "error", message: "そのルームは存在しません。" });
        return joinRoom(ws, room, msg.name);
      }
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) {
      ws.roomCode = null;
      return send(ws, { type: "error", message: "ルームが見つかりません。ページを再読み込みしてください。" });
    }

    if (type === "ready") {
      if (room.started) return;
      if (room.ready.has(ws.id)) room.ready.delete(ws.id);
      else room.ready.add(ws.id);
      return broadcast(room, roomState(room));
    }

    if (type === "start") {
      if (ws.id !== room.host) return send(ws, { type: "error", message: "部屋主だけが開始できます。" });
      if (room.players.length < 2) return send(ws, { type: "error", message: "2人以上で開始してください。" });
      if (room.players.some(p => !room.ready.has(p.id))) {
        return send(ws, { type: "error", message: "参加者全員をREADYにしてください。" });
      }
      room.started = true;
      room.players.forEach(p => { p.score = 0; p.lines = 0; p.alive = true; p.board = null; p.current = null; p.clearing = false; });
      broadcast(room, { type: "game_start" });
      return broadcast(room, roomState(room));
    }

    if (type === "board_state") {
      if (!room.started) return;
      if (!Array.isArray(msg.board) || msg.board.length !== 20) return;
      ws.board = msg.board.map(row => Array.isArray(row) ? row.slice(0,10) : Array(10).fill(0));
      ws.current = msg.current || null;
      ws.clearing = Boolean(msg.clearing);
      for (const p of room.players) {
        if (p !== ws) send(p, { type:"board_state", id:ws.id, board:ws.board, current:ws.current, clearing:ws.clearing });
      }
      return;
    }

    if (type === "score") {
      if (!room.started) return;
      ws.score = Math.max(0, Number(msg.score) || 0);
      ws.lines = Math.max(0, Number(msg.lines) || 0);
      return broadcast(room, {
        type: "player_update",
        id: ws.id, score: ws.score, lines: ws.lines, alive: ws.alive
      });
    }

    if (type === "garbage") {
      if (!room.started) return;
      const amount = Math.max(0, Math.min(4, Number(msg.lines) || 0));
      if (!amount) return;
      for (const p of room.players) {
        if (p !== ws && p.alive) send(p, { type: "garbage", lines: amount, from: ws.id });
      }
      return;
    }

    if (type === "alive") {
      if (!room.started) return;
      ws.alive = Boolean(msg.alive);
      broadcast(room, {
        type: "player_update",
        id: ws.id, score: ws.score, lines: ws.lines, alive: ws.alive
      });

      const alivePlayers = room.players.filter(p => p.alive);
      if (ws.alive === false && alivePlayers.length === 1 && room.started) {
        const winner = alivePlayers[0];
        room.winnerId = winner.id;
        room.started = false;
        return broadcast(room, {
          type: "game_winner",
          winnerId: winner.id,
          winnerName: winner.name
        });
      }
      return;
    }

    if (type === "restart") {
      if (room.started) return;
      room.winnerId = null;
      room.ready.clear();
      room.players.forEach(p => { p.score = 0; p.lines = 0; p.alive = true; p.board = null; p.current = null; p.clearing = false; });
      return broadcast(room, roomState(room));
    }

    if (type === "leave") {
      ws.close();
      return;
    }
  });

  ws.on("close", () => removePlayer(ws));
  ws.on("error", () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.length === 0 || (!room.started && now - room.createdAt > 6 * 60 * 60 * 1000)) {
      rooms.delete(code);
    }
  }
}, 60_000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Online Tetris server listening on ${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(cleanup);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
