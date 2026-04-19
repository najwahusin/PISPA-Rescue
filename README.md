# Rescue The Hiker — Room Server

Kahoot-style single room game server. One room, up to 50 simultaneous players, 5-minute sessions.

## Quick Start

### 1. Install Node.js
Download from https://nodejs.org (v18+)

### 2. Install dependencies
```
cd rescue_room
npm install
```

### 3. Start server
```
npm start
```

### 4. Open screens

| Screen | URL | Purpose |
|--------|-----|---------|
| Host / Admin | http://localhost:3000/host | Create room, get code, start game |
| Players | http://localhost:3000 | Enter code + name, play game |

---

## Event Day Flow

1. Run `npm start` on your laptop
2. Connect laptop to event WiFi / hotspot
3. Open `/host` on the projector — click **Cipta Bilik**
4. A 4-digit code appears — display it on the projector
5. Players go to your laptop's local IP on their phones (e.g. `http://192.168.1.10:3000`)
6. Players enter the code + their name → join waiting room
7. Host clicks **Mulakan Permainan** when everyone is ready
8. All 50 players play simultaneously
9. Game ends after 5 minutes (or when everyone finishes)
10. Top 10 leaderboard appears on all screens simultaneously — stays on screen permanently

**Find your local IP:**
- Windows: run `ipconfig` → look for IPv4 Address
- Mac/Linux: run `ifconfig` → look for `inet` under your WiFi adapter

---

## Cloud Deploy (for internet access)

### Railway.app (easiest)
1. Push this folder to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Done — Railway auto-detects Node.js and sets PORT

### Render.com (free tier)
1. New Web Service → connect GitHub repo
2. Build command: `npm install`
3. Start command: `npm start`

---

## File Structure

```
rescue_room/
├── server.js          ← game room server (Node.js + Socket.io)
├── package.json       ← dependencies
├── README.md          ← this file
└── public/
    ├── index.html     ← player game (your full game with room join)
    └── host.html      ← host/admin screen
```

---

## Configuration (server.js top section)

| Setting | Default | Description |
|---------|---------|-------------|
| `PORT` | 3000 | Server port (auto-set by hosting platforms) |
| `MAX_PLAYERS` | 50 | Max simultaneous players |
| `SESSION_MINS` | 5 | Game session length in minutes |
| `TOP_N` | 10 | Leaderboard size |
| `SCORE_SYNC_INTERVAL` | 5000ms | How often scores sync to host screen |
