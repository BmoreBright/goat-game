/**
 * G.O.A.T. Debate — multiplayer relay server
 * Host-authoritative: host runs game logic, server relays state + actions.
 *
 * Start:  node server/index.js
 * Default port: 3847  (override with PORT=)
 */
import http from 'http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';

const PORT = Number(process.env.PORT) || 3847;

const rooms = new Map(); // code -> room

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(4);
  for (let i = 0; i < 4; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    connected: p.connected,
    isHost: p.id === room.hostId,
  }));
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players) {
    if (exceptId && p.id === exceptId) continue;
    if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function findRoomByPlayer(playerId) {
  for (const [code, room] of rooms) {
    if (room.players.some(p => p.id === playerId)) return { code, room };
  }
  return null;
}

function removePlayer(playerId) {
  const found = findRoomByPlayer(playerId);
  if (!found) return;
  const { code, room } = found;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) return;
  const wasHost = room.players[idx].id === room.hostId;
  room.players[idx].connected = false;
  room.players[idx].ws = null;

  // Host migration: first still-connected player
  if (wasHost) {
    const next = room.players.find(p => p.connected);
    if (next) {
      room.hostId = next.id;
      send(next.ws, { type: 'you_are_host' });
    }
  }

  broadcast(room, { type: 'lobby', players: publicPlayers(room), hostId: room.hostId });

  // Drop empty rooms after a short grace (all disconnected)
  if (!room.players.some(p => p.connected)) {
    setTimeout(() => {
      const r = rooms.get(code);
      if (r && !r.players.some(p => p.connected)) rooms.delete(code);
    }, 60_000);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('G.O.A.T. Debate multiplayer server\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { type: 'error', message: 'Invalid JSON' });
    }

    const { type } = msg;

    if (type === 'create') {
      let code = makeCode();
      while (rooms.has(code)) code = makeCode();
      playerId = randomBytes(8).toString('hex');
      const name = (msg.name || 'Host').slice(0, 18);
      const room = {
        hostId: playerId,
        players: [{ id: playerId, name, seat: 0, connected: true, ws }],
        state: null,
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      send(ws, {
        type: 'joined',
        roomCode: code,
        playerId,
        seat: 0,
        isHost: true,
        players: publicPlayers(room),
      });
      return;
    }

    if (type === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.players.filter(p => p.connected).length >= 8) {
        return send(ws, { type: 'error', message: 'Room is full' });
      }
      playerId = randomBytes(8).toString('hex');
      const name = (msg.name || 'Player').slice(0, 18);
      // assign next free seat
      const taken = new Set(room.players.map(p => p.seat));
      let seat = 0;
      while (taken.has(seat)) seat += 1;
      room.players.push({ id: playerId, name, seat, connected: true, ws });
      send(ws, {
        type: 'joined',
        roomCode: code,
        playerId,
        seat,
        isHost: false,
        players: publicPlayers(room),
      });
      broadcast(room, { type: 'lobby', players: publicPlayers(room), hostId: room.hostId }, playerId);
      // catch-up state if game already running
      if (room.state) send(ws, { type: 'state', state: room.state });
      return;
    }

    if (!playerId) return send(ws, { type: 'error', message: 'Join a room first' });

    const found = findRoomByPlayer(playerId);
    if (!found) return send(ws, { type: 'error', message: 'Not in a room' });
    const { room } = found;
    const me = room.players.find(p => p.id === playerId);

    if (type === 'set_name') {
      me.name = String(msg.name || me.name).slice(0, 18);
      broadcast(room, { type: 'lobby', players: publicPlayers(room), hostId: room.hostId });
      return;
    }

    if (type === 'set_seat') {
      const seat = Number(msg.seat);
      if (Number.isNaN(seat) || seat < 0 || seat > 7) return;
      if (room.players.some(p => p.seat === seat && p.id !== playerId && p.connected)) {
        return send(ws, { type: 'error', message: 'Seat taken' });
      }
      me.seat = seat;
      broadcast(room, { type: 'lobby', players: publicPlayers(room), hostId: room.hostId });
      return;
    }

    // Host pushes authoritative snapshot
    if (type === 'state') {
      if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can push state' });
      room.state = msg.state;
      broadcast(room, { type: 'state', state: msg.state }, playerId);
      return;
    }

    // Client intent → host
    if (type === 'action') {
      const host = room.players.find(p => p.id === room.hostId);
      if (host?.ws) {
        send(host.ws, {
          type: 'action',
          from: playerId,
          seat: me.seat,
          action: msg.action,
          payload: msg.payload,
        });
      }
      return;
    }

    if (type === 'ping') {
      send(ws, { type: 'pong', t: Date.now() });
      return;
    }
  });

  ws.on('close', () => {
    if (playerId) removePlayer(playerId);
  });
});

server.listen(PORT, () => {
  console.log(`G.O.A.T. Debate multiplayer on ws://localhost:${PORT}`);
});
