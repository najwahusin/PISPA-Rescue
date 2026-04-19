/**
 * ================================================================
 * RESCUE THE HIKER — Single Room Game Server
 * ================================================================
 * One room at a time. Up to 50 players. 5-minute sessions.
 * Top 10 leaderboard shown at end to all screens.
 *
 * SETUP:
 *   1. npm install
 *   2. node server.js
 *   3. Host opens  → http://localhost:3000/host
 *   4. Players open → http://localhost:3000
 *
 * DEPLOY (Railway / Render / Fly.io):
 *   Push this folder to GitHub and connect to any Node.js host.
 *   The PORT env variable is set automatically by the platform.
 * ================================================================
 */

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

/* ── [CONFIG] ─────────────────────────────────────────────────── */
const PORT         = process.env.PORT || 3000;
const MAX_PLAYERS  = 50;
const SESSION_MINS = 5;           // game session length in minutes
const SESSION_MS   = SESSION_MINS * 60 * 1000;
const TOP_N        = 10;          // leaderboard size
const SCORE_SYNC_INTERVAL = 5000; // how often server broadcasts rankings (ms)
/* ─────────────────────────────────────────────────────────────── */

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

/* Serve static files from /public */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'host.html'))
);

/* ── ROOM STATE ───────────────────────────────────────────────── */
const room = {
  code:      null,         // 4-digit string e.g. "7823"
  state:     'idle',       // idle | waiting | playing | ended
  hostId:    null,         // socket.id of the host
  players:   new Map(),    // socketId → { name, score, finished, joinedAt }
  startedAt: null,         // Date.now() when game started
  timerRef:  null,         // setTimeout reference for auto-end
  syncRef:   null,         // setInterval reference for score broadcasts
};

/* ── HELPERS ──────────────────────────────────────────────────── */

function generateCode() {
  // 4-digit code, never starts with 0
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getLeaderboard() {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map((p, i) => ({
      rank:     i + 1,
      name:     p.name,
      score:    p.score,
      finished: p.finished,
    }));
}

function getPlayerList() {
  return [...room.players.entries()].map(([id, p]) => ({
    id,
    name:     p.name,
    score:    p.score,
    finished: p.finished,
  }));
}

function getRemainingMs() {
  if (!room.startedAt) return SESSION_MS;
  return Math.max(0, SESSION_MS - (Date.now() - room.startedAt));
}

function broadcastPlayerList() {
  io.emit('player_list', getPlayerList());
  io.emit('player_count', room.players.size);
}

function broadcastScores() {
  // Sent periodically during play — lightweight ranking snapshot
  const lb = getLeaderboard();
  io.emit('score_update', {
    leaderboard:  lb,
    remainingMs:  getRemainingMs(),
    playerCount:  room.players.size,
    finishCount:  [...room.players.values()].filter(p => p.finished).length,
  });
}

function endGame(reason) {
  if (room.state === 'ended') return;
  room.state = 'ended';

  clearTimeout(room.timerRef);
  clearInterval(room.syncRef);
  room.timerRef = null;
  room.syncRef  = null;

  const leaderboard = getLeaderboard();
  console.log(`[END] Game over — reason: ${reason}`);
  console.log(`      Players: ${room.players.size}, Top scorer: ${leaderboard[0]?.name || '—'} (${leaderboard[0]?.score || 0} pts)`);

  // Broadcast final leaderboard to everyone — stays on screen permanently
  io.emit('game_ended', {
    reason,
    leaderboard,
    totalPlayers: room.players.size,
  });
}

function resetRoom() {
  clearTimeout(room.timerRef);
  clearInterval(room.syncRef);
  room.code      = null;
  room.state     = 'idle';
  room.hostId    = null;
  room.players.clear();
  room.startedAt = null;
  room.timerRef  = null;
  room.syncRef   = null;
  console.log('[RESET] Room cleared');
}

/* ── SOCKET EVENTS ────────────────────────────────────────────── */
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  /* ── HOST: create room ─────────────────────────────────────── */
  socket.on('host_create', () => {
    if (room.state !== 'idle') {
      socket.emit('error_msg', 'A room is already active. Reset it first.');
      return;
    }
    room.code   = generateCode();
    room.state  = 'waiting';
    room.hostId = socket.id;
    socket.join('host-room');
    console.log(`[CREATE] Room code: ${room.code}`);
    socket.emit('room_created', { code: room.code });
    broadcastPlayerList();
  });

  /* ── HOST: start game ──────────────────────────────────────── */
  socket.on('host_start', () => {
    if (socket.id !== room.hostId) return;
    if (room.state !== 'waiting') {
      socket.emit('error_msg', 'Room is not in waiting state.');
      return;
    }
    if (room.players.size === 0) {
      socket.emit('error_msg', 'No players have joined yet.');
      return;
    }

    room.state     = 'playing';
    room.startedAt = Date.now();

    console.log(`[START] Game started with ${room.players.size} players`);

    // Tell everyone to start
    io.emit('game_start', {
      remainingMs: SESSION_MS,
      startedAt:   room.startedAt,
    });

    // Auto-end after session time
    room.timerRef = setTimeout(() => endGame('time_up'), SESSION_MS);

    // Broadcast scores every N seconds during play
    room.syncRef = setInterval(() => {
      if (room.state === 'playing') broadcastScores();
    }, SCORE_SYNC_INTERVAL);
  });

  /* ── HOST: force end ───────────────────────────────────────── */
  socket.on('host_end', () => {
    if (socket.id !== room.hostId) return;
    endGame('host_ended');
  });

  /* ── HOST: reset room ──────────────────────────────────────── */
  socket.on('host_reset', () => {
    if (socket.id !== room.hostId) return;
    resetRoom();
    io.emit('room_reset');
    console.log('[RESET] Host reset the room');
  });

  /* ── PLAYER: join room ─────────────────────────────────────── */
  socket.on('player_join', ({ code, name }) => {
    // Validate code
    if (!room.code || code !== room.code) {
      socket.emit('join_error', 'Kod tidak betul. Sila cuba lagi.');
      return;
    }
    if (room.state === 'idle') {
      socket.emit('join_error', 'Tiada bilik aktif dengan kod ini.');
      return;
    }
    if (room.state === 'ended') {
      socket.emit('join_error', 'Permainan sudah tamat.');
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('join_error', `Bilik penuh (had ${MAX_PLAYERS} pemain).`);
      return;
    }

    const playerName = (name || 'Anon').trim().slice(0, 16);

    room.players.set(socket.id, {
      name:     playerName,
      score:    0,
      finished: false,
      joinedAt: Date.now(),
    });

    console.log(`[JOIN] ${playerName} (${socket.id}) — ${room.players.size}/${MAX_PLAYERS}`);

    socket.emit('join_ok', {
      name:        playerName,
      playerCount: room.players.size,
      state:       room.state,
      // If game already started (late join), send remaining time
      remainingMs: room.state === 'playing' ? getRemainingMs() : null,
    });

    broadcastPlayerList();

    // Notify host
    io.to('host-room').emit('player_joined', {
      name:        playerName,
      playerCount: room.players.size,
    });
  });

  /* ── PLAYER: score update (sent while playing) ─────────────── */
  socket.on('score_update', ({ score }) => {
    const player = room.players.get(socket.id);
    if (!player || room.state !== 'playing') return;
    player.score = Math.max(0, Math.round(score));
  });

  /* ── PLAYER: finished (reached cave or died) ───────────────── */
  socket.on('player_finish', ({ score, method }) => {
    const player = room.players.get(socket.id);
    if (!player) return;
    player.score    = Math.max(0, Math.round(score));
    player.finished = true;

    console.log(`[FINISH] ${player.name} — ${player.score} pts (${method})`);

    broadcastPlayerList();

    // Check if ALL players have finished → end early
    const allDone = [...room.players.values()].every(p => p.finished);
    if (allDone && room.state === 'playing') {
      endGame('all_finished');
    }
  });

  /* ── DISCONNECT ────────────────────────────────────────────── */
  socket.on('disconnect', () => {
    const player = room.players.get(socket.id);
    if (player) {
      console.log(`[-] Left: ${player.name} (${socket.id})`);
      room.players.delete(socket.id);
      broadcastPlayerList();
    }
    // If host disconnects while room is active, warn remaining clients
    if (socket.id === room.hostId && room.state !== 'idle') {
      console.log('[WARN] Host disconnected!');
      io.emit('host_disconnected');
    }
  });
});

/* ── START ────────────────────────────────────────────────────── */
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════╗');
  console.log('  ║     Rescue The Hiker — Room Server     ║');
  console.log('  ╠════════════════════════════════════════╣');
  console.log(`  ║  Players : http://localhost:${PORT}        ║`);
  console.log(`  ║  Host    : http://localhost:${PORT}/host   ║`);
  console.log(`  ║  Max players : ${MAX_PLAYERS}                       ║`);
  console.log(`  ║  Session time: ${SESSION_MINS} minutes                  ║`);
  console.log('  ╚════════════════════════════════════════╝');
  console.log('');
});
